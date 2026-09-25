"use client";

import { clsx } from "clsx";
import { useId, useState, type FormEvent } from "react";

import { RoutineIcon, routineIconLabel } from "@/components/routine-icon";
import { CADENCES, ROUTINE_ICONS, type Routine, type RoutineIcon as RoutineIconId } from "@/lib/types";

export interface RoutineValues {
  name: string;
  icon: RoutineIconId;
  cadenceHours: number;
  typicalMinutes: number;
}

const SUGGESTIONS: RoutineValues[] = [
  { name: "Laundry", icon: "washing-machine", cadenceHours: 168, typicalMinutes: 90 },
  { name: "Gym", icon: "dumbbell", cadenceHours: 48, typicalMinutes: 60 },
  { name: "Groceries", icon: "shopping-basket", cadenceHours: 168, typicalMinutes: 45 },
  { name: "Walk", icon: "footprints", cadenceHours: 24, typicalMinutes: 30 },
  { name: "Cleaning", icon: "sparkles", cadenceHours: 168, typicalMinutes: 60 },
  { name: "Nap", icon: "moon", cadenceHours: 24, typicalMinutes: 25 },
];

export function RoutineForm({
  routine,
  existingNames,
  onSubmit,
  onCancel,
  onDelete,
}: {
  routine?: Routine;
  existingNames: string[];
  onSubmit: (values: RoutineValues) => Promise<void>;
  onCancel: () => void;
  onDelete?: () => Promise<void>;
}) {
  const id = useId();
  const [values, setValues] = useState<RoutineValues>(
    routine
      ? {
          name: routine.name,
          icon: routine.icon,
          cadenceHours: routine.cadenceHours,
          typicalMinutes: routine.typicalMinutes,
        }
      : { name: "", icon: "sparkles", cadenceHours: 24, typicalMinutes: 15 },
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const taken = new Set(existingNames.map((name) => name.toLocaleLowerCase()));
  const suggestions = SUGGESTIONS.filter((item) => !taken.has(item.name.toLocaleLowerCase()));
  const cadenceKnown = CADENCES.some((cadence) => cadence.hours === values.cadenceHours);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const name = values.name.trim();

    if (!name) {
      setError("Give it a name, like “Laundry”.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await onSubmit({ ...values, name });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "That didn’t save. Try again.");
      setSaving(false);
    }
  }

  return (
    <form className="panel routine-form" onSubmit={submit} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="panel__title">
        {routine ? `Edit ${routine.name}` : "Track something new"}
      </h2>

      {!routine && suggestions.length > 0 ? (
        <div className="chips" role="group" aria-label="Suggestions">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion.name}
              type="button"
              className={clsx("chip", values.name === suggestion.name && "chip--on")}
              onClick={() => setValues(suggestion)}
            >
              <RoutineIcon icon={suggestion.icon} size={16} />
              {suggestion.name}
            </button>
          ))}
        </div>
      ) : null}

      <label className="field">
        <span className="field__label">Name</span>
        <input
          className="input"
          value={values.name}
          maxLength={40}
          placeholder="Laundry"
          autoFocus={!routine}
          onChange={(event) => setValues((current) => ({ ...current, name: event.target.value }))}
        />
      </label>

      <fieldset className="field">
        <legend className="field__label">Icon</legend>
        <div className="icon-picker" role="radiogroup" aria-label="Icon">
          {ROUTINE_ICONS.map((icon) => (
            <button
              key={icon}
              type="button"
              role="radio"
              aria-checked={values.icon === icon}
              aria-label={routineIconLabel(icon)}
              title={routineIconLabel(icon)}
              className={clsx("icon-picker__option", values.icon === icon && "icon-picker__option--on")}
              onClick={() => setValues((current) => ({ ...current, icon }))}
            >
              <RoutineIcon icon={icon} size={20} />
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="field">
        <legend className="field__label">About how often?</legend>
        <div className="chips">
          {CADENCES.map((cadence) => (
            <button
              key={cadence.hours}
              type="button"
              className={clsx("chip", values.cadenceHours === cadence.hours && "chip--on")}
              aria-pressed={values.cadenceHours === cadence.hours}
              onClick={() => setValues((current) => ({ ...current, cadenceHours: cadence.hours }))}
            >
              {cadence.label}
            </button>
          ))}
          {!cadenceKnown ? <span className="chip chip--on">Every {values.cadenceHours} h</span> : null}
        </div>
        <p className="field__hint">A starting guess. Your logged sessions take over as they add up.</p>
      </fieldset>

      <label className="field field--inline">
        <span className="field__label">Usually takes</span>
        <span className="input-unit">
          <input
            className="input input--number"
            type="number"
            min={1}
            max={600}
            value={values.typicalMinutes}
            onChange={(event) =>
              setValues((current) => ({
                ...current,
                typicalMinutes: Math.min(600, Math.max(1, Math.round(Number(event.target.value) || 1))),
              }))
            }
          />
          <span>min</span>
        </span>
      </label>

      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="panel__actions">
        <button className="btn btn--primary" type="submit" disabled={saving}>
          {routine ? "Save changes" : "Start tracking"}
        </button>
        <button className="btn btn--quiet" type="button" onClick={onCancel} disabled={saving}>
          Cancel
        </button>

        {onDelete && routine ? (
          confirmingDelete ? (
            <span className="confirm">
              <span>
                Delete {routine.name}
                {routine.sessionCount > 0
                  ? ` and its ${routine.sessionCount} logged ${routine.sessionCount === 1 ? "session" : "sessions"}`
                  : ""}
                ?
              </span>
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
              Delete {routine.name}
            </button>
          )
        ) : null}
      </div>
    </form>
  );
}
