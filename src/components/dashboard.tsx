"use client";

import { clsx } from "clsx";
import { Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { LogValues } from "@/components/log-panel";
import { RoutineForm, type RoutineValues } from "@/components/routine-form";
import { RoutineIcon } from "@/components/routine-icon";
import { RoutineView } from "@/components/routine-view";
import { useNow } from "@/hooks/use-now";
import { api, errorMessage } from "@/lib/api";
import type { FormatOptions } from "@/lib/format";
import { browserTimezone, MS_PER_MINUTE } from "@/lib/time";
import type { Routine, Session } from "@/lib/types";

const SELECTED_KEY = "nowish:routine";

function durationFrom(values: LogValues) {
  const timerSeconds = values.timerSeconds;
  return values.source === "timer" && timerSeconds && Math.round(timerSeconds / 60) === values.minutes
    ? timerSeconds
    : values.minutes * 60;
}

function withSession(routine: Routine, sessions: Session[]): Routine {
  const last = sessions.reduce<string | null>(
    (latest, session) => (latest === null || session.startedAt > latest ? session.startedAt : latest),
    null,
  );
  return { ...routine, sessionCount: sessions.length, lastStartedAt: last };
}

export function Dashboard() {
  const now = useNow();
  const [routines, setRoutines] = useState<Routine[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Record<string, Session[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [form, setForm] = useState<"new" | "edit" | null>(null);
  const [reload, setReload] = useState(0);

  const timeZone = now === null ? "UTC" : browserTimezone();
  const options = useMemo<FormatOptions>(() => ({ timeZone }), [timeZone]);

  useEffect(() => {
    let active = true;

    api
      .listRoutines(browserTimezone())
      .then(({ routines: loaded }) => {
        if (!active) return;
        const stored = window.localStorage.getItem(SELECTED_KEY);
        setRoutines(loaded);
        setSelectedId(loaded.some((routine) => routine.id === stored) ? stored : (loaded[0]?.id ?? null));
        setError(null);
      })
      .catch((loadError) => {
        if (active) setError(errorMessage(loadError, "Your routines didn’t load."));
      });

    return () => {
      active = false;
    };
  }, [reload]);

  const selected = routines?.find((routine) => routine.id === selectedId) ?? null;
  const selectedSessions = selectedId ? sessions[selectedId] : undefined;

  useEffect(() => {
    if (!selectedId || selectedSessions) return;
    let active = true;

    api
      .listSessions(selectedId)
      .then((page) => {
        if (!active) return;
        setSessions((current) => ({ ...current, [selectedId]: page.sessions }));
        setSessionsError(null);
      })
      .catch((loadError) => {
        if (active) setSessionsError(errorMessage(loadError, "Sessions didn’t load."));
      });

    return () => {
      active = false;
    };
  }, [selectedId, selectedSessions, reload]);

  function select(id: string) {
    setSelectedId(id);
    setForm(null);
    window.localStorage.setItem(SELECTED_KEY, id);
  }

  function replaceSessions(routineId: string, update: (current: Session[]) => Session[]) {
    const next = update(sessions[routineId] ?? []);
    setSessions((current) => ({ ...current, [routineId]: next }));
    setRoutines((list) => list?.map((routine) => (routine.id === routineId ? withSession(routine, next) : routine)) ?? list);
  }

  async function createRoutine(values: RoutineValues) {
    const { routine } = await api.createRoutine({ ...values, timezone: browserTimezone() });
    setRoutines((current) => [...(current ?? []), routine]);
    setSessions((current) => ({ ...current, [routine.id]: [] }));
    select(routine.id);
  }

  async function updateRoutine(values: RoutineValues) {
    if (!selected) return;
    const { routine } = await api.updateRoutine(selected.id, values);
    setRoutines((current) => current?.map((item) => (item.id === routine.id ? routine : item)) ?? current);
    setForm(null);
  }

  async function deleteRoutine() {
    if (!selected) return;
    await api.deleteRoutine(selected.id);
    const remaining = (routines ?? []).filter((routine) => routine.id !== selected.id);
    setRoutines(remaining);
    setForm(null);
    if (remaining[0]) select(remaining[0].id);
    else setSelectedId(null);
  }

  if (error) {
    return (
      <div className="dashboard">
        <div className="notice notice--error" role="alert">
          <span>{error}</span>
          <button type="button" className="link-button" onClick={() => setReload((count) => count + 1)}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (!routines || now === null) {
    return (
      <div className="dashboard" aria-busy="true">
        <div className="loading">
          <span className="loading__line loading__line--short" />
          <span className="loading__line" />
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard">
      <nav className="switcher" aria-label="What to check">
        {routines.map((routine) => (
          <button
            key={routine.id}
            type="button"
            className={clsx("switcher__item", routine.id === selectedId && "switcher__item--on")}
            aria-pressed={routine.id === selectedId}
            onClick={() => select(routine.id)}
          >
            <RoutineIcon icon={routine.icon} size={17} />
            {routine.name}
          </button>
        ))}
        <button
          type="button"
          className={clsx("switcher__item switcher__item--add", form === "new" && "switcher__item--on")}
          aria-pressed={form === "new"}
          onClick={() => setForm((current) => (current === "new" ? null : "new"))}
        >
          <Plus size={17} aria-hidden="true" />
          Track something
        </button>
      </nav>

      {form === "new" ? (
        <RoutineForm
          existingNames={routines.map((routine) => routine.name)}
          onSubmit={createRoutine}
          onCancel={() => setForm(null)}
        />
      ) : null}

      {form === "edit" && selected ? (
        <RoutineForm
          key={selected.id}
          routine={selected}
          existingNames={routines.filter((routine) => routine.id !== selected.id).map((routine) => routine.name)}
          onSubmit={updateRoutine}
          onCancel={() => setForm(null)}
          onDelete={deleteRoutine}
        />
      ) : null}

      {!selected && form !== "new" ? (
        <div className="empty">
          <h1>Nothing to check yet</h1>
          <p>Add something you do on a rhythm, like showers or laundry, and Nowish will learn when it suits you.</p>
          <button type="button" className="btn btn--primary" onClick={() => setForm("new")}>
            <Plus size={16} aria-hidden="true" />
            Track something
          </button>
        </div>
      ) : null}

      {selected && form === null ? (
        sessionsError && !selectedSessions ? (
          <div className="notice notice--error" role="alert">
            <span>{sessionsError}</span>
            <button type="button" className="link-button" onClick={() => setReload((count) => count + 1)}>
              Try again
            </button>
          </div>
        ) : selectedSessions ? (
          <RoutineView
            key={selected.id}
            routine={selected}
            sessions={selectedSessions}
            now={now}
            options={options}
            handlers={{
              onEditRoutine: () => setForm("edit"),
              onCreateSession: async (values) => {
                const durationSeconds = durationFrom(values);
                const { session } = await api.createSession(selected.id, {
                  startedAt: new Date(values.finishedAt - durationSeconds * 1000).toISOString(),
                  durationSeconds,
                  timezone: options.timeZone,
                  feel: values.feel,
                  source: values.source,
                });
                replaceSessions(selected.id, (current) => [...current, session]);
                return session;
              },
              onUpdateSession: async (session, values) => {
                const originalEnd = Date.parse(session.startedAt) + session.durationSeconds * 1000;
                const moved = Math.abs(values.finishedAt - originalEnd) >= MS_PER_MINUTE;
                const minutesChanged = Math.round(session.durationSeconds / 60) !== values.minutes;
                const durationSeconds = minutesChanged ? values.minutes * 60 : session.durationSeconds;
                const { session: updated } = await api.updateSession(session.id, {
                  durationSeconds,
                  feel: values.feel,
                  ...(moved || minutesChanged
                    ? {
                        startedAt: new Date((moved ? values.finishedAt : originalEnd) - durationSeconds * 1000).toISOString(),
                        timezone: moved ? options.timeZone : session.timezone,
                      }
                    : {}),
                });
                replaceSessions(selected.id, (current) => current.map((item) => (item.id === updated.id ? updated : item)));
              },
              onDeleteSession: async (session) => {
                await api.deleteSession(session.id);
                replaceSessions(selected.id, (current) => current.filter((item) => item.id !== session.id));
              },
            }}
          />
        ) : (
          <div className="loading" aria-busy="true">
            <span className="loading__line loading__line--short" />
            <span className="loading__line" />
          </div>
        )
      ) : null}
    </div>
  );
}
