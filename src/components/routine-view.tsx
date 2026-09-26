"use client";

import { clsx } from "clsx";
import { Play, Settings2, Square, X } from "lucide-react";
import { useCallback, useMemo, useState, type ReactNode } from "react";

import { DayRibbon } from "@/components/charts/day-ribbon";
import { CheckPanel, type CheckValues } from "@/components/check-panel";
import { History } from "@/components/history";
import { LogPanel, type LogValues } from "@/components/log-panel";
import { FEEL_OPTIONS } from "@/components/panel-controls";
import { RoutineIcon } from "@/components/routine-icon";
import { RhythmSection, TimeSpentSection, TimingSection } from "@/components/stats";
import { useTimer } from "@/hooks/use-timer";
import { errorMessage } from "@/lib/api";
import {
  FEEL_LABELS,
  formatClock,
  formatDelta,
  formatDuration,
  formatGap,
  formatMinutes,
  formatMoment,
  HEADLINES,
  reasonText,
  relativeDay,
  verdictSummary,
  type FormatOptions,
} from "@/lib/format";
import { buildInsights, indexAt, verdictFor } from "@/lib/insights";
import { MS_PER_MINUTE } from "@/lib/time";
import type { Feel, Observation, Routine, Session } from "@/lib/types";

type Panel =
  | { kind: "log"; initial?: Partial<LogValues> }
  | { kind: "edit"; session: Session }
  | { kind: "check"; observation: Observation }
  | null;

type Feedback =
  | { kind: "session"; session: Session; deltaMinutes: number | null }
  | { kind: "check"; observation: Observation };

/** Tapping another rating this soon after a check corrects it instead of adding one. */
const CHECK_CORRECTION_MS = 5 * MS_PER_MINUTE;

export interface RoutineHandlers {
  onCreateSession: (values: LogValues) => Promise<Session>;
  onUpdateSession: (session: Session, values: LogValues) => Promise<void>;
  onDeleteSession: (session: Session) => Promise<void>;
  onConvertSession: (session: Session, values: CheckValues) => Promise<void>;
  onCreateCheck: (feel: Feel) => Promise<Observation>;
  onUpdateCheck: (observation: Observation, values: Partial<CheckValues>) => Promise<Observation>;
  onDeleteCheck: (observation: Observation) => Promise<void>;
  onEditRoutine: () => void;
}

function question(name: string, at: number, now: number, selected: boolean, options: FormatOptions) {
  if (!selected) return `${name} now?`;
  const day = relativeDay(at, now, options);
  const clock = formatClock(at, options);
  return day === "today" ? `${name} at ${clock}?` : `${name} ${day} at ${clock}?`;
}

/** One tap to say how right now looks, without logging the thing itself. */
function CheckIn({
  noun,
  current,
  busy,
  error,
  onPick,
}: {
  noun: string;
  current: Feel | null;
  busy: boolean;
  error: string | null;
  onPick: (feel: Feel) => void;
}) {
  return (
    <div className="checkin">
      <div className="checkin__row" role="group" aria-label={`Just checked? Rate right now without logging a ${noun}`}>
        <span className="checkin__label" aria-hidden="true">
          Just checked?
        </span>
        {FEEL_OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            className={clsx("chip", `chip--${option.id}`, current === option.id && "chip--on")}
            aria-pressed={current === option.id}
            disabled={busy}
            onClick={() => onPick(option.id)}
          >
            <span className="chip__dot" aria-hidden="true" />
            {FEEL_LABELS[option.id]}
          </button>
        ))}
      </div>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function RunningTimer({
  noun,
  elapsedSeconds,
  onDone,
  onDiscard,
}: {
  noun: string;
  elapsedSeconds: number;
  onDone: () => void;
  onDiscard: () => void;
}) {
  return (
    <div className="timer" role="timer" aria-live="off">
      <span className="timer__dot" aria-hidden="true" />
      <span className="timer__label">Timing your {noun}</span>
      <span className="timer__value">{formatDuration(elapsedSeconds)}</span>
      <button type="button" className="btn btn--primary" onClick={onDone}>
        <Square size={14} fill="currentColor" aria-hidden="true" />
        Done
      </button>
      <button type="button" className="btn btn--quiet" onClick={onDiscard}>
        Discard
      </button>
    </div>
  );
}

function counted(count: number, noun: string) {
  return `${count} ${count === 1 ? noun : `${noun}s`}`;
}

function confidenceText(sessionCount: number, checkCount: number, confidence: string, routine: Routine) {
  const checks = checkCount > 0 ? counted(checkCount, "check") : null;

  if (sessionCount === 0) {
    const guess = `Until you log a few, Nowish uses your guess: ${formatMinutes(routine.typicalMinutes)}, about every ${formatGap(routine.cadenceHours)}.`;
    return checks ? `${guess} Your ${checks} already shape the timing.` : guess;
  }

  const basis = checks ? `${counted(sessionCount, "session")} and ${checks}` : counted(sessionCount, "session");
  return confidence === "solid"
    ? `Based on ${basis}, with recent ones counting more.`
    : `Based on ${basis}. It gets sharper after about 15 sessions.`;
}

export function RoutineView({
  routine,
  sessions,
  observations = [],
  now,
  options,
  handlers,
  demoAction,
  compact = false,
  headingLevel = 1,
}: {
  routine: Routine;
  sessions: Session[];
  observations?: Observation[];
  now: number;
  options: FormatOptions;
  /** Omit for a read-only view, such as the signed-out demo. */
  handlers?: RoutineHandlers;
  demoAction?: ReactNode;
  compact?: boolean;
  headingLevel?: 1 | 2;
}) {
  const noun = routine.name.toLocaleLowerCase();
  const [selectedAt, setSelectedAt] = useState<number | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const timer = useTimer(routine.id);

  const insights = useMemo(
    () =>
      buildInsights({
        sessions,
        observations,
        prior: { cadenceHours: routine.cadenceHours, typicalMinutes: routine.typicalMinutes },
        now,
        timeZone: options.timeZone,
      }),
    [sessions, observations, routine.cadenceHours, routine.typicalMinutes, now, options.timeZone],
  );
  const verdictAt = useCallback((index: number) => verdictFor(insights, index), [insights]);

  const { forecast } = insights;
  const selected = selectedAt === null ? 0 : indexAt(forecast, selectedAt);
  const verdict = verdictAt(selected);
  const reasons = verdict.reasons
    .map((reason) => reasonText(reason, options))
    .filter((text): text is string => text !== null);
  const history = insights.sessions.map((session) => session.minutes);
  const last = insights.timeSpent.last;
  const Heading = headingLevel === 1 ? "h1" : "h2";

  async function logSession(values: LogValues) {
    if (!handlers) return;
    const usualBefore = insights.timeSpent.typicalMinutes;
    const session = await handlers.onCreateSession(values);
    if (values.source === "timer") timer.clear();
    setPanel(null);
    setSelectedAt(null);
    setFeedback({
      kind: "session",
      session,
      deltaMinutes: usualBefore === null ? null : session.durationSeconds / 60 - usualBefore,
    });
  }

  const recentCheck =
    feedback?.kind === "check" && now - Date.parse(feedback.observation.createdAt) < CHECK_CORRECTION_MS
      ? feedback.observation
      : null;

  async function logCheck(feel: Feel) {
    if (!handlers || recentCheck?.feel === feel) return;
    setChecking(true);
    setCheckError(null);

    try {
      const observation = recentCheck
        ? await handlers.onUpdateCheck(recentCheck, { feel })
        : await handlers.onCreateCheck(feel);
      setSelectedAt(null);
      setFeedback({ kind: "check", observation });
    } catch (checkFailure) {
      setCheckError(errorMessage(checkFailure, "That check didn’t save. Try again."));
    } finally {
      setChecking(false);
    }
  }

  async function undo() {
    if (!handlers || !feedback) return;
    setUndoing(true);
    try {
      if (feedback.kind === "session") await handlers.onDeleteSession(feedback.session);
      else await handlers.onDeleteCheck(feedback.observation);
      setFeedback(null);
    } finally {
      setUndoing(false);
    }
  }

  function editCheck(observation: Observation) {
    setFeedback((current) => (current?.kind === "check" && current.observation.id === observation.id ? current : null));
    setPanel({ kind: "check", observation });
  }

  function finishTimer() {
    if (timer.startedAt === null) return;
    const seconds = Math.max(60, timer.elapsedSeconds);
    setFeedback(null);
    setPanel({
      kind: "log",
      initial: {
        minutes: Math.round(seconds / 60),
        finishedAt: Date.now(),
        source: "timer",
        timerSeconds: Math.round(seconds),
      },
    });
  }

  const panelNode =
    handlers && panel?.kind === "log" ? (
      <LogPanel
        key={`log-${panel.initial?.source ?? "manual"}`}
        noun={noun}
        history={history}
        fallbackMinutes={routine.typicalMinutes}
        initial={panel.initial}
        mode="create"
        now={now}
        options={options}
        onSubmit={logSession}
        onCancel={() => setPanel(null)}
      />
    ) : handlers && panel?.kind === "edit" ? (
      <LogPanel
        key={`edit-${panel.session.id}`}
        noun={noun}
        history={history}
        fallbackMinutes={routine.typicalMinutes}
        initial={{
          minutes: panel.session.durationSeconds / 60,
          finishedAt: Date.parse(panel.session.startedAt) + panel.session.durationSeconds * 1000,
          feel: panel.session.feel,
          source: panel.session.source,
        }}
        mode="edit"
        now={now}
        options={options}
        onSubmit={async (values) => {
          await handlers.onUpdateSession(panel.session, values);
          setPanel(null);
        }}
        onDelete={async () => {
          await handlers.onDeleteSession(panel.session);
          setPanel(null);
        }}
        onConvert={async (values) => {
          await handlers.onConvertSession(panel.session, values);
          setPanel(null);
        }}
        onCancel={() => setPanel(null)}
      />
    ) : handlers && panel?.kind === "check" ? (
      <CheckPanel
        key={`check-${panel.observation.id}`}
        noun={noun}
        initial={{ observedAt: Date.parse(panel.observation.observedAt), feel: panel.observation.feel }}
        now={now}
        options={options}
        onSubmit={async (values) => {
          const observation = await handlers.onUpdateCheck(panel.observation, values);
          setFeedback((current) =>
            current?.kind === "check" && current.observation.id === observation.id ? { kind: "check", observation } : current,
          );
          setPanel(null);
        }}
        onDelete={async () => {
          await handlers.onDeleteCheck(panel.observation);
          setFeedback((current) =>
            current?.kind === "check" && current.observation.id === panel.observation.id ? null : current,
          );
          setPanel(null);
        }}
        onCancel={() => setPanel(null)}
      />
    ) : null;

  let actions: ReactNode;

  if (selected !== 0) {
    actions = (
      <div className="actions">
        <button type="button" className="btn btn--quiet" onClick={() => setSelectedAt(null)}>
          Back to now
        </button>
      </div>
    );
  } else if (!handlers) {
    actions = <div className="actions">{demoAction}</div>;
  } else if (timer.startedAt !== null && panel?.kind !== "log") {
    actions = (
      <RunningTimer noun={noun} elapsedSeconds={timer.elapsedSeconds} onDone={finishTimer} onDiscard={timer.clear} />
    );
  } else if (!panel) {
    actions = (
      <div className="actions">
        <button
          type="button"
          className="btn btn--primary btn--large"
          onClick={() => {
            setFeedback(null);
            setPanel({ kind: "log" });
          }}
        >
          <RoutineIcon icon={routine.icon} size={18} />
          Log {noun}
        </button>
        <button type="button" className="btn btn--quiet btn--large" onClick={timer.start}>
          <Play size={16} aria-hidden="true" />
          Start timer
        </button>

        {feedback?.kind === "session" ? (
          <p className="feedback" role="status">
            <span>
              Logged <strong>{formatMinutes(feedback.session.durationSeconds / 60)}</strong>
              {feedback.deltaMinutes === null ? ". Nowish starts learning from here." : `, ${formatDelta(feedback.deltaMinutes)}.`}
            </span>
            <button type="button" className="link-button" onClick={undo} disabled={undoing}>
              Undo
            </button>
            <button type="button" className="icon-button" onClick={() => setFeedback(null)} aria-label="Dismiss">
              <X size={15} aria-hidden="true" />
            </button>
          </p>
        ) : feedback?.kind === "check" ? (
          <p className="feedback" role="status">
            <span>
              Noted: <strong>{FEEL_LABELS[feedback.observation.feel].toLocaleLowerCase()}</strong> at{" "}
              {formatClock(Date.parse(feedback.observation.observedAt), options)}, not counted as a {noun}.
            </span>
            <button type="button" className="link-button" onClick={() => editCheck(feedback.observation)}>
              Edit
            </button>
            <button type="button" className="link-button" onClick={undo} disabled={undoing}>
              Undo
            </button>
            <button type="button" className="icon-button" onClick={() => setFeedback(null)} aria-label="Dismiss">
              <X size={15} aria-hidden="true" />
            </button>
          </p>
        ) : last ? (
          <p className="actions__last">
            Last time: <strong>{formatMinutes(last.minutes)}</strong>, {formatMoment(last.start, now, options)}
          </p>
        ) : null}

        <CheckIn
          noun={noun}
          current={recentCheck?.feel ?? null}
          busy={checking}
          error={checkError}
          onPick={logCheck}
        />
      </div>
    );
  } else {
    actions = null;
  }

  return (
    <div className={clsx("routine", compact && "routine--compact")}>
      <section className="hero" data-kind={verdict.kind} aria-labelledby={`verdict-${routine.id}`}>
        <div className="hero__top">
          <p className="hero__question">
            <RoutineIcon icon={routine.icon} size={20} />
            <span>{question(routine.name, verdict.at, now, selected !== 0, options)}</span>
          </p>
          {handlers ? (
            <button type="button" className="icon-button" onClick={handlers.onEditRoutine} aria-label={`Edit ${routine.name}`}>
              <Settings2 size={18} aria-hidden="true" />
            </button>
          ) : null}
        </div>

        <Heading id={`verdict-${routine.id}`} className="hero__verdict">
          <span className="signal" aria-hidden="true" />
          {HEADLINES[verdict.kind]}
        </Heading>
        <p className="hero__summary" aria-live="polite">
          {verdictSummary(verdict, now, options)}
        </p>

        {actions}
        {panelNode}
      </section>

      {insights.sessionCount > 0 ? (
        <DayRibbon
          forecast={forecast}
          selected={selected}
          verdict={verdict}
          verdictAt={verdictAt}
          onSelect={(index) => setSelectedAt(index === 0 ? null : forecast.points[index].at)}
          options={options}
          noun={noun}
        />
      ) : null}

      <div className="why">
        <ul className="why__list">
          {reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
        <p className="why__confidence">{confidenceText(insights.sessionCount, insights.checkCount, insights.confidence, routine)}</p>
      </div>

      <TimeSpentSection insights={insights} noun={noun} options={options} />

      {compact ? null : (
        <>
          <TimingSection insights={insights} options={options} />
          <RhythmSection insights={insights} options={options} />
          <History
            sessions={sessions}
            observations={observations}
            routineName={routine.name}
            locale={options.locale}
            onEdit={
              handlers
                ? (session) => {
                    setFeedback(null);
                    setPanel({ kind: "edit", session });
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }
                : undefined
            }
            onEditCheck={
              handlers
                ? (observation) => {
                    editCheck(observation);
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }
                : undefined
            }
          />
        </>
      )}
    </div>
  );
}
