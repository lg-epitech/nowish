"use client";

import { clsx } from "clsx";
import { useState, type ReactNode } from "react";

import { MS_PER_MINUTE, zonedParts } from "@/lib/time";
import type { Feel } from "@/lib/types";

export const FEEL_OPTIONS: { id: Feel; label: string }[] = [
  { id: "good", label: "Good" },
  { id: "okay", label: "Okay" },
  { id: "bad", label: "Bad" },
];

const MOMENT_OPTIONS = [
  { id: "now", label: "Just now", minutesAgo: 0 },
  { id: "15", label: "15 min ago", minutesAgo: 15 },
  { id: "60", label: "1 h ago", minutesAgo: 60 },
  { id: "custom", label: "Earlier", minutesAgo: null },
] as const;

type MomentChoice = (typeof MOMENT_OPTIONS)[number]["id"];

export function toLocalInput(ms: number, timeZone: string) {
  const { localDate, localMinute } = zonedParts(ms, timeZone);
  const hours = String(Math.floor(localMinute / 60)).padStart(2, "0");
  const minutes = String(localMinute % 60).padStart(2, "0");
  return `${localDate}T${hours}:${minutes}`;
}

/** A moment picked as "just now", a little while ago, or an exact earlier time. */
export function useMoment(initial: number, exactFirst: boolean, timeZone: string) {
  const [choice, setChoice] = useState<MomentChoice>(exactFirst ? "custom" : "now");
  const [exact, setExact] = useState(() => toLocalInput(initial, timeZone));

  return {
    choice,
    setChoice,
    exact,
    setExact,
    /** The picked moment; quick choices count back from `reference`. */
    resolve(reference: number) {
      const option = MOMENT_OPTIONS.find((item) => item.id === choice)!;
      if (option.minutesAgo !== null) return reference - option.minutesAgo * MS_PER_MINUTE;
      return new Date(exact).getTime();
    },
  };
}

export function MomentField({
  legend,
  inputLabel,
  moment,
  now,
  timeZone,
  children,
}: {
  legend: string;
  inputLabel: string;
  moment: ReturnType<typeof useMoment>;
  now: number;
  timeZone: string;
  /** A hint under the field. */
  children?: ReactNode;
}) {
  return (
    <fieldset className="field">
      <legend className="field__label">{legend}</legend>
      <div className="chips">
        {MOMENT_OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            className={clsx("chip", moment.choice === option.id && "chip--on")}
            aria-pressed={moment.choice === option.id}
            onClick={() => moment.setChoice(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>
      {moment.choice === "custom" ? (
        <input
          className="input log__when"
          type="datetime-local"
          aria-label={inputLabel}
          value={moment.exact}
          max={toLocalInput(now, timeZone)}
          onChange={(event) => moment.setExact(event.target.value)}
        />
      ) : null}
      {children}
    </fieldset>
  );
}

export function FeelField({
  legend,
  value,
  onChange,
  optional = false,
  hint,
}: {
  legend: string;
  value: Feel | null;
  onChange: (feel: Feel | null) => void;
  /** Optional ratings can be cleared by pressing the chosen one again. */
  optional?: boolean;
  hint?: string;
}) {
  return (
    <fieldset className="field">
      <legend className="field__label">{legend}</legend>
      <div className="segmented" role="group">
        {FEEL_OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            className={clsx("segmented__option", value === option.id && "segmented__option--on")}
            aria-pressed={value === option.id}
            onClick={() => onChange(optional && value === option.id ? null : option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>
      {hint ? <p className="field__hint">{hint}</p> : null}
    </fieldset>
  );
}

export function ConfirmDelete({ noun, onDelete }: { noun: string; onDelete: () => void }) {
  const [confirming, setConfirming] = useState(false);

  return confirming ? (
    <span className="confirm">
      <span>Delete this {noun}?</span>
      <button type="button" className="link-button link-button--danger" onClick={onDelete}>
        Delete
      </button>
      <button type="button" className="link-button" onClick={() => setConfirming(false)}>
        Keep
      </button>
    </span>
  ) : (
    <button type="button" className="link-button panel__aside" onClick={() => setConfirming(true)}>
      Delete
    </button>
  );
}
