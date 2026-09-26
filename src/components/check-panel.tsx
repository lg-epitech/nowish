"use client";

import { useId, useState, type FormEvent } from "react";

import { ConfirmDelete, FeelField, MomentField, useMoment } from "@/components/panel-controls";
import type { FormatOptions } from "@/lib/format";
import { MS_PER_MINUTE } from "@/lib/time";
import type { Feel } from "@/lib/types";

export interface CheckValues {
  observedAt: number;
  feel: Feel;
}

/** Edits a check: when you looked, and how it looked. */
export function CheckPanel({
  noun,
  initial,
  now,
  options,
  onSubmit,
  onCancel,
  onDelete,
}: {
  noun: string;
  initial: CheckValues;
  now: number;
  options: FormatOptions;
  onSubmit: (values: CheckValues) => Promise<void>;
  onCancel: () => void;
  onDelete: () => Promise<void>;
}) {
  const id = useId();
  const moment = useMoment(initial.observedAt, true, options.timeZone);
  const [feel, setFeel] = useState<Feel>(initial.feel);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    const observedAt = moment.resolve(Date.now());

    if (!Number.isFinite(observedAt)) {
      setError("Pick when you checked.");
      return;
    }
    if (observedAt > Date.now() + MS_PER_MINUTE) {
      setError("That time is in the future. Pick a time that has passed.");
      return;
    }

    void run(() => onSubmit({ observedAt: Math.min(observedAt, Date.now()), feel }), "That didn’t save. Try again.");
  }

  return (
    <form className="panel log" onSubmit={submit} aria-labelledby={`${id}-title`}>
      <div>
        <h2 id={`${id}-title`} className="panel__title">
          Edit check
        </h2>
        <p className="field__hint check-panel__lede">A look without doing it. It shapes timing, never your {noun} rhythm.</p>
      </div>

      <MomentField
        legend="When did you check?"
        inputLabel="Checked at"
        moment={moment}
        now={now}
        timeZone={options.timeZone}
      />

      <FeelField legend="How did it look?" value={feel} onChange={(next) => next && setFeel(next)} />

      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="panel__actions">
        <button className="btn btn--primary" type="submit" disabled={saving}>
          Save changes
        </button>
        <button className="btn btn--quiet" type="button" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <ConfirmDelete noun="check" onDelete={() => void run(onDelete, "That didn’t delete. Try again.")} />
      </div>
    </form>
  );
}
