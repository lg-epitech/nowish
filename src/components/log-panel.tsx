"use client";

import { clsx } from "clsx";
import { Minus, Plus } from "lucide-react";
import { useId, useState, type FormEvent } from "react";

import { formatClock, formatMinutes, type FormatOptions } from "@/lib/format";
import { quantile } from "@/lib/insights/math";
import { MS_PER_MINUTE, zonedParts } from "@/lib/time";
import type { Feel, SessionSource } from "@/lib/types";

export interface LogValues {
  minutes: number;
  finishedAt: number;
  feel: Feel | null;
  source: SessionSource;
  /** Exact seconds from the timer, used when the minutes were not changed. */
  timerSeconds?: number;
}

const MAX_MINUTES = 1440;

const FINISH_OPTIONS = [
  { id: "now", label: "Just now", minutesAgo: 0 },
  { id: "15", label: "15 min ago", minutesAgo: 15 },
  { id: "60", label: "1 h ago", minutesAgo: 60 },
  { id: "custom", label: "Earlier", minutesAgo: null },
] as const;

type FinishChoice = (typeof FINISH_OPTIONS)[number]["id"];

const FEEL_OPTIONS: { id: Feel; label: string }[] = [
  { id: "good", label: "Good" },
  { id: "okay", label: "Okay" },
  { id: "bad", label: "Bad" },
];

function toLocalInput(ms: number, timeZone: string) {
  const { localDate, localMinute } = zonedParts(ms, timeZone);
  const hours = String(Math.floor(localMinute / 60)).padStart(2, "0");
  const minutes = String(localMinute % 60).padStart(2, "0");
  return `${localDate}T${hours}:${minutes}`;
}

/** Suggestions from the user's own spread of times, the usual one marked. */
export function quickPicks(history: readonly number[], fallback: number) {
  if (history.length < 3) {
    const base = Math.max(1, Math.round(fallback));
    return {
      usual: base,
      picks: [...new Set([Math.max(1, base - 5), Math.max(1, base - 2), base, base + 5, base + 10])].sort((a, b) => a - b),
    };
  }

  const usual = Math.max(1, Math.round(quantile(history, 0.5)!));
  const picks = [0.1, 0.25, 0.5, 0.75, 0.9].map((q) => Math.max(1, Math.round(quantile(history, q)!)));
  return { usual, picks: [...new Set([...picks, usual])].sort((a, b) => a - b) };
}

export function LogPanel({
  noun,
  history,
  fallbackMinutes,
  initial,
  mode,
  now,
  options,
  onSubmit,
  onCancel,
  onDelete,
}: {
  noun: string;
  history: readonly number[];
  fallbackMinutes: number;
  initial?: Partial<LogValues>;
  mode: "create" | "edit";
  now: number;
  options: FormatOptions;
  onSubmit: (values: LogValues) => Promise<void>;
  onCancel: () => void;
  onDelete?: () => Promise<void>;
}) {
  const id = useId();
  const { usual, picks } = quickPicks(history, fallbackMinutes);
  const [minutes, setMinutes] = useState(() => Math.max(1, Math.round(initial?.minutes ?? usual)));
  const [draft, setDraft] = useState(String(minutes));
  const [finish, setFinish] = useState<FinishChoice>(mode === "edit" ? "custom" : "now");
  const [customFinish, setCustomFinish] = useState(() =>
    toLocalInput(initial?.finishedAt ?? now, options.timeZone),
  );
  const [feel, setFeel] = useState<Feel | null>(initial?.feel ?? null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  function setBoth(value: number) {
    const next = Math.min(MAX_MINUTES, Math.max(1, Math.round(value)));
    setMinutes(next);
    setDraft(String(next));
  }

  function finishedAt(reference: number) {
    const option = FINISH_OPTIONS.find((item) => item.id === finish)!;
    if (option.minutesAgo !== null) return reference - option.minutesAgo * MS_PER_MINUTE;
    return new Date(customFinish).getTime();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const finishedMs = finishedAt(Date.now());

    if (!Number.isFinite(finishedMs)) {
      setError("Pick when it finished.");
      return;
    }
    if (finishedMs > Date.now() + MS_PER_MINUTE) {
      setError("That finish time is in the future. Pick a time that has passed.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await onSubmit({
        minutes,
        finishedAt: Math.min(finishedMs, Date.now()),
        feel,
        source: initial?.source ?? "manual",
        timerSeconds: initial?.timerSeconds,
      });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "That didn’t save. Try again.");
      setSaving(false);
    }
  }

  const previewFinish = finishedAt(now);
  const startsAt = (Number.isFinite(previewFinish) ? previewFinish : now) - minutes * MS_PER_MINUTE;

  return (
    <form className="panel log" onSubmit={submit} aria-labelledby={`${id}-title`}>
      <fieldset className="log__duration">
        <legend id={`${id}-title`} className="log__question">
          How long did it actually take?
        </legend>

        <div className="stepper">
          <button type="button" className="stepper__button" onClick={() => setBoth(minutes - 1)} aria-label="One minute less">
            <Minus size={20} aria-hidden="true" />
          </button>
          <label className="stepper__value">
            <input
              inputMode="numeric"
              pattern="[0-9]*"
              aria-label="Minutes"
              value={draft}
              onChange={(event) => {
                const digits = event.target.value.replace(/\D/g, "").slice(0, 4);
                setDraft(digits);
                if (digits) setMinutes(Math.min(MAX_MINUTES, Math.max(1, Number(digits))));
              }}
              onBlur={() => setBoth(minutes)}
            />
            <span>min</span>
          </label>
          <button type="button" className="stepper__button" onClick={() => setBoth(minutes + 1)} aria-label="One minute more">
            <Plus size={20} aria-hidden="true" />
          </button>
        </div>

        <div className="chips" role="group" aria-label="Quick picks">
          {picks.map((pick) => (
            <button
              key={pick}
              type="button"
              className={clsx("chip", pick === minutes && "chip--on")}
              aria-pressed={pick === minutes}
              onClick={() => setBoth(pick)}
            >
              {formatMinutes(pick)}
              {pick === usual ? <small>usual</small> : null}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="field">
        <legend className="field__label">When did it finish?</legend>
        <div className="chips">
          {FINISH_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              className={clsx("chip", finish === option.id && "chip--on")}
              aria-pressed={finish === option.id}
              onClick={() => setFinish(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
        {finish === "custom" ? (
          <input
            className="input log__when"
            type="datetime-local"
            aria-label="Finished at"
            value={customFinish}
            max={toLocalInput(now, options.timeZone)}
            onChange={(event) => setCustomFinish(event.target.value)}
          />
        ) : null}
        <p className="field__hint">
          Started around {formatClock(startsAt, options)}.
        </p>
      </fieldset>

      <fieldset className="field">
        <legend className="field__label">How was the timing?</legend>
        <div className="segmented" role="group">
          {FEEL_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              className={clsx("segmented__option", feel === option.id && "segmented__option--on")}
              aria-pressed={feel === option.id}
              onClick={() => setFeel((current) => (current === option.id ? null : option.id))}
            >
              {option.label}
            </button>
          ))}
        </div>
        <p className="field__hint">Optional. Ratings teach Nowish which hours suit you best.</p>
      </fieldset>

      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="panel__actions">
        <button className="btn btn--primary" type="submit" disabled={saving}>
          {mode === "edit" ? "Save changes" : `Log ${formatMinutes(minutes)}`}
        </button>
        <button className="btn btn--quiet" type="button" onClick={onCancel} disabled={saving}>
          Cancel
        </button>

        {onDelete ? (
          confirmingDelete ? (
            <span className="confirm">
              <span>Delete this {noun}?</span>
              <button
                type="button"
                className="link-button link-button--danger"
                onClick={async () => {
                  setSaving(true);
                  try {
                    await onDelete();
                  } catch (deleteError) {
                    setError(deleteError instanceof Error ? deleteError.message : "That didn’t delete. Try again.");
                    setSaving(false);
                  }
                }}
              >
                Delete
              </button>
              <button type="button" className="link-button" onClick={() => setConfirmingDelete(false)}>
                Keep
              </button>
            </span>
          ) : (
            <button type="button" className="link-button panel__aside" onClick={() => setConfirmingDelete(true)}>
              Delete
            </button>
          )
        ) : null}
      </div>
    </form>
  );
}
