"use client";

import { Download, Eye, Pencil, Timer } from "lucide-react";
import { useState } from "react";

import { formatMinuteOfDay, formatMinutes } from "@/lib/format";
import type { Observation, Session } from "@/lib/types";

const FEEL_LABELS = { good: "Good timing", okay: "Okay timing", bad: "Bad timing" } as const;
const PAGE = 14;

type Entry =
  | { kind: "session"; at: string; localDate: string; localMinute: number; session: Session }
  | { kind: "check"; at: string; localDate: string; localMinute: number; observation: Observation };

function entriesOf(sessions: readonly Session[], observations: readonly Observation[]): Entry[] {
  return [
    ...sessions.map((session) => ({
      kind: "session" as const,
      at: session.startedAt,
      localDate: session.localDate,
      localMinute: session.localMinute,
      session,
    })),
    ...observations.map((observation) => ({
      kind: "check" as const,
      at: observation.observedAt,
      localDate: observation.localDate,
      localMinute: observation.localMinute,
      observation,
    })),
  ];
}

function dayLabel(localDate: string, locale?: string) {
  return new Intl.DateTimeFormat(locale, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(
    Date.parse(`${localDate}T12:00:00Z`),
  );
}

function csvCell(value: string | number | null) {
  const text = value === null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function clock(localMinute: number) {
  return `${String(Math.floor(localMinute / 60)).padStart(2, "0")}:${String(localMinute % 60).padStart(2, "0")}`;
}

/** Sessions and checks in one file; checks have no duration or source. */
export function sessionsToCsv(sessions: readonly Session[], observations: readonly Observation[] = []) {
  const header = ["started_at_utc", "local_date", "local_time", "timezone", "duration_minutes", "feel", "source", "kind"];
  const rows = entriesOf(sessions, observations)
    .sort((left, right) => left.at.localeCompare(right.at))
    .map((entry) => {
      const row =
        entry.kind === "session"
          ? [
              entry.at,
              entry.localDate,
              clock(entry.localMinute),
              entry.session.timezone,
              (entry.session.durationSeconds / 60).toFixed(2),
              entry.session.feel,
              entry.session.source,
              "session",
            ]
          : [
              entry.at,
              entry.localDate,
              clock(entry.localMinute),
              entry.observation.timezone,
              null,
              entry.observation.feel,
              null,
              "check",
            ];

      return row.map(csvCell).join(",");
    });

  return [header.join(","), ...rows].join("\n");
}

function download(filename: string, contents: string) {
  const url = URL.createObjectURL(new Blob([contents], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function History({
  sessions,
  observations = [],
  routineName,
  locale,
  onEdit,
  onEditCheck,
}: {
  sessions: readonly Session[];
  observations?: readonly Observation[];
  routineName: string;
  locale?: string;
  onEdit?: (session: Session) => void;
  onEditCheck?: (observation: Observation) => void;
}) {
  const [shown, setShown] = useState(PAGE);
  const ordered = entriesOf(sessions, observations).sort((left, right) => right.at.localeCompare(left.at));
  const visible = ordered.slice(0, shown);
  const groups: { date: string; entries: Entry[] }[] = [];

  for (const entry of visible) {
    const group = groups.at(-1);
    if (group && group.date === entry.localDate) group.entries.push(entry);
    else groups.push({ date: entry.localDate, entries: [entry] });
  }

  if (ordered.length === 0) return null;

  return (
    <section className="section" aria-labelledby="history-title">
      <header className="section__head section__head--row">
        <div>
          <h2 id="history-title">History</h2>
          <p>Times are shown where each one happened. Checks shape timing only.</p>
        </div>
        <button
          type="button"
          className="btn btn--quiet"
          onClick={() =>
            download(
              `nowish-${routineName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.csv`,
              sessionsToCsv(sessions, observations),
            )
          }
        >
          <Download size={16} aria-hidden="true" />
          Download CSV
        </button>
      </header>

      <div className="history">
        {groups.map((group) => (
          <div className="history__day" key={group.date}>
            <h3>{dayLabel(group.date, locale)}</h3>
            <ul>
              {group.entries.map((entry) => {
                const time = formatMinuteOfDay(entry.localMinute, locale);

                if (entry.kind === "check") {
                  const { observation } = entry;
                  return (
                    <li key={`check-${observation.id}`} className="history__row history__row--check">
                      <span className="history__time">{time}</span>
                      <span className="history__minutes history__check">
                        <Eye size={14} aria-hidden="true" />
                        Check
                      </span>
                      <span className="history__feel">{FEEL_LABELS[observation.feel]}</span>
                      <span className="history__source" />
                      {onEditCheck ? (
                        <button
                          type="button"
                          className="icon-button"
                          onClick={() => onEditCheck(observation)}
                          aria-label={`Edit the check at ${time} on ${dayLabel(group.date, locale)}`}
                        >
                          <Pencil size={15} aria-hidden="true" />
                        </button>
                      ) : null}
                    </li>
                  );
                }

                const { session } = entry;
                return (
                  <li key={session.id} className="history__row">
                    <span className="history__time">{time}</span>
                    <span className="history__minutes">{formatMinutes(session.durationSeconds / 60)}</span>
                    <span className="history__feel">{session.feel ? FEEL_LABELS[session.feel] : ""}</span>
                    <span className="history__source">
                      {session.source === "timer" ? (
                        <>
                          <Timer size={14} aria-hidden="true" />
                          <span>Timed</span>
                        </>
                      ) : null}
                    </span>
                    {onEdit ? (
                      <button
                        type="button"
                        className="icon-button"
                        onClick={() => onEdit(session)}
                        aria-label={`Edit the session at ${time} on ${dayLabel(group.date, locale)}`}
                      >
                        <Pencil size={15} aria-hidden="true" />
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      {ordered.length > shown ? (
        <button type="button" className="btn btn--quiet history__more" onClick={() => setShown((count) => count + 30)}>
          Show older entries
        </button>
      ) : null}
    </section>
  );
}
