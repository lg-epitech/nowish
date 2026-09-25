"use client";

import { Download, Pencil, Timer } from "lucide-react";
import { useState } from "react";

import { formatMinuteOfDay, formatMinutes } from "@/lib/format";
import type { Session } from "@/lib/types";

const FEEL_LABELS = { good: "Good timing", okay: "Okay timing", bad: "Bad timing" } as const;
const PAGE = 14;

function dayLabel(localDate: string, locale?: string) {
  return new Intl.DateTimeFormat(locale, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(
    Date.parse(`${localDate}T12:00:00Z`),
  );
}

function csvCell(value: string | number | null) {
  const text = value === null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function sessionsToCsv(sessions: readonly Session[]) {
  const header = ["started_at_utc", "local_date", "local_time", "timezone", "duration_minutes", "feel", "source"];
  const rows = [...sessions]
    .sort((left, right) => left.startedAt.localeCompare(right.startedAt))
    .map((session) =>
      [
        session.startedAt,
        session.localDate,
        `${String(Math.floor(session.localMinute / 60)).padStart(2, "0")}:${String(session.localMinute % 60).padStart(2, "0")}`,
        session.timezone,
        (session.durationSeconds / 60).toFixed(2),
        session.feel,
        session.source,
      ]
        .map(csvCell)
        .join(","),
    );

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
  routineName,
  locale,
  onEdit,
}: {
  sessions: readonly Session[];
  routineName: string;
  locale?: string;
  onEdit?: (session: Session) => void;
}) {
  const [shown, setShown] = useState(PAGE);
  const ordered = [...sessions].sort((left, right) => right.startedAt.localeCompare(left.startedAt));
  const visible = ordered.slice(0, shown);
  const groups: { date: string; sessions: Session[] }[] = [];

  for (const session of visible) {
    const group = groups.at(-1);
    if (group && group.date === session.localDate) group.sessions.push(session);
    else groups.push({ date: session.localDate, sessions: [session] });
  }

  if (sessions.length === 0) return null;

  return (
    <section className="section" aria-labelledby="history-title">
      <header className="section__head section__head--row">
        <div>
          <h2 id="history-title">History</h2>
          <p>Times are shown where each session happened.</p>
        </div>
        <button
          type="button"
          className="btn btn--quiet"
          onClick={() =>
            download(`nowish-${routineName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.csv`, sessionsToCsv(sessions))
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
              {group.sessions.map((session) => (
                <li key={session.id} className="history__row">
                  <span className="history__time">{formatMinuteOfDay(session.localMinute, locale)}</span>
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
                      aria-label={`Edit the session at ${formatMinuteOfDay(session.localMinute, locale)} on ${dayLabel(group.date, locale)}`}
                    >
                      <Pencil size={15} aria-hidden="true" />
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {ordered.length > shown ? (
        <button type="button" className="btn btn--quiet history__more" onClick={() => setShown((count) => count + 30)}>
          Show older sessions
        </button>
      ) : null}
    </section>
  );
}
