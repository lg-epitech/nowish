"use client";

import { clsx } from "clsx";
import { Minus, Plus } from "lucide-react";
import { useId, useState, type FormEvent } from "react";

import { ConfirmDelete, FEEL_OPTIONS, FeelField, MomentField, useMoment } from "@/components/panel-controls";
import { FEEL_LABELS, formatClock, formatMinutes, type FormatOptions } from "@/lib/format";
import { quantile } from "@/lib/insights/math";
import { MS_PER_MINUTE } from "@/lib/time";
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
  onConvert,
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
  /** Saves the session as a check instead, for one that never happened. */
  onConvert?: (values: { observedAt: number; feel: Feel }) => Promise<void>;
}) {
  const id = useId();
  const { usual, picks } = quickPicks(history, fallbackMinutes);
  const [minutes, setMinutes] = useState(() => Math.max(1, Math.round(initial?.minutes ?? usual)));
  const [draft, setDraft] = useState(String(minutes));
  const finish = useMoment(initial?.finishedAt ?? now, mode === "edit", options.timeZone);
  const [feel, setFeel] = useState<Feel | null>(initial?.feel ?? null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [converting, setConverting] = useState(false);

  function setBoth(value: number) {
    const next = Math.min(MAX_MINUTES, Math.max(1, Math.round(value)));
    setMinutes(next);
    setDraft(String(next));
  }

  /** The picked finish time, or null after showing why it can't be used. */
  function checkedFinish(reference: number) {
    const finishedMs = finish.resolve(reference);

    if (!Number.isFinite(finishedMs)) {
      setError("Pick when it finished.");
      return null;
    }
    if (finishedMs > reference + MS_PER_MINUTE) {
      setError("That finish time is in the future. Pick a time that has passed.");
      return null;
    }

    return Math.min(finishedMs, reference);
  }

  async function run(action: () => Promise<void>, fallback: string) {
    setSaving(true);
    setError(null);

    try {
      await action();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : fallback);
      setSaving(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const finishedAt = checkedFinish(Date.now());
    if (finishedAt === null) return;

    void run(
      () =>
        onSubmit({
          minutes,
          finishedAt,
          feel,
          source: initial?.source ?? "manual",
          timerSeconds: initial?.timerSeconds,
        }),
      "That didn’t save. Try again.",
    );
  }

  function convert(checkFeel: Feel, reference: number) {
    const observedAt = checkedFinish(reference);
    if (observedAt === null || !onConvert) return;
    void run(() => onConvert({ observedAt, feel: checkFeel }), "That didn’t change. Try again.");
  }

  const previewFinish = finish.resolve(now);
  const finishesAt = Number.isFinite(previewFinish) ? previewFinish : now;
  const startsAt = finishesAt - minutes * MS_PER_MINUTE;

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

      <MomentField
        legend="When did it finish?"
        inputLabel="Finished at"
        moment={finish}
        now={now}
        timeZone={options.timeZone}
      >
        <p className="field__hint">Started around {formatClock(startsAt, options)}.</p>
      </MomentField>

      <FeelField
        legend="How was the timing?"
        value={feel}
        onChange={setFeel}
        optional
        hint="Optional. Ratings teach Nowish which hours suit you best."
      />

      {onConvert ? (
        converting ? (
          <div className="convert" role="group" aria-label="Save as a check instead">
            <span>How did it look at {formatClock(finishesAt, options)}?</span>
            <div className="chips">
              {FEEL_OPTIONS.map((option) => (
                <button key={option.id} type="button" className="chip" disabled={saving} onClick={() => convert(option.id, Date.now())}>
                  {FEEL_LABELS[option.id]}
                </button>
              ))}
            </div>
            <button type="button" className="link-button" onClick={() => setConverting(false)}>
              Keep as a {noun}
            </button>
          </div>
        ) : (
          <p className="convert">
            <span>Only checked, didn’t actually do it?</span>
            <button type="button" className="link-button" onClick={() => setConverting(true)}>
              Save it as a check instead
            </button>
          </p>
        )
      ) : null}

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
          <ConfirmDelete noun={noun} onDelete={() => void run(onDelete, "That didn’t delete. Try again.")} />
        ) : null}
      </div>
    </form>
  );
}
