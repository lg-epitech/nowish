"use client";

import { clsx } from "clsx";
import { Play, Settings2, Square, X } from "lucide-react";
import { useCallback, useMemo, useState, type ReactNode } from "react";

import { DayRibbon } from "@/components/charts/day-ribbon";
import { History } from "@/components/history";
import { LogPanel, type LogValues } from "@/components/log-panel";
import { RoutineIcon } from "@/components/routine-icon";
import { RhythmSection, TimeSpentSection, TimingSection } from "@/components/stats";
import { useTimer } from "@/hooks/use-timer";
import {
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
import type { Routine, Session } from "@/lib/types";

type Panel = { kind: "log"; initial?: Partial<LogValues> } | { kind: "edit"; session: Session } | null;

interface Feedback {
  session: Session;
  deltaMinutes: number | null;
}

export interface RoutineHandlers {
  onCreateSession: (values: LogValues) => Promise<Session>;
  onUpdateSession: (session: Session, values: LogValues) => Promise<void>;
  onDeleteSession: (session: Session) => Promise<void>;
  onEditRoutine: () => void;
}

function question(name: string, at: number, now: number, selected: boolean, options: FormatOptions) {
  if (!selected) return `${name} now?`;
  const day = relativeDay(at, now, options);
  const clock = formatClock(at, options);
  return day === "today" ? `${name} at ${clock}?` : `${name} ${day} at ${clock}?`;
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

export function RoutineView({
  routine,
  sessions,
  now,
  options,
  handlers,
  demoAction,
  compact = false,
  headingLevel = 1,
}: {
  routine: Routine;
  sessions: Session[];
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
  const timer = useTimer(routine.id);

  const insights = useMemo(
    () =>
      buildInsights({
        sessions,
        prior: { cadenceHours: routine.cadenceHours, typicalMinutes: routine.typicalMinutes },
        now,
        timeZone: options.timeZone,
      }),
    [sessions, routine.cadenceHours, routine.typicalMinutes, now, options.timeZone],
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
      session,
      deltaMinutes: usualBefore === null ? null : session.durationSeconds / 60 - usualBefore,
    });
  }

  async function undo() {
    if (!handlers || !feedback) return;
    setUndoing(true);
    try {
      await handlers.onDeleteSession(feedback.session);
      setFeedback(null);
    } finally {
      setUndoing(false);
    }
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

        {feedback ? (
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
        ) : last ? (
          <p className="actions__last">
            Last time: <strong>{formatMinutes(last.minutes)}</strong>, {formatMoment(last.start, now, options)}
          </p>
        ) : null}
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
        <p className="why__confidence">
          {insights.sessionCount === 0
            ? `Until you log a few, Nowish uses your guess: ${formatMinutes(routine.typicalMinutes)}, about every ${formatGap(routine.cadenceHours)}.`
            : insights.confidence === "solid"
              ? `Based on ${insights.sessionCount} sessions, with recent ones counting more.`
              : `Based on ${insights.sessionCount} ${insights.sessionCount === 1 ? "session" : "sessions"}. It gets sharper after about 15.`}
        </p>
      </div>

      <TimeSpentSection insights={insights} noun={noun} options={options} />

      {compact ? null : (
        <>
          <TimingSection insights={insights} options={options} />
          <RhythmSection insights={insights} options={options} />
          <History
            sessions={sessions}
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
          />
        </>
      )}
    </div>
  );
}
