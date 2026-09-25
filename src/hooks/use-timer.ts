"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

const EVENT = "nowish:timer";
const key = (routineId: string) => `nowish:timer:${routineId}`;

function subscribe(listener: () => void) {
  window.addEventListener("storage", listener);
  window.addEventListener(EVENT, listener);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener(EVENT, listener);
  };
}

/** A stopwatch per routine that survives reloads and syncs across tabs. */
export function useTimer(routineId: string) {
  const stored = useSyncExternalStore(
    subscribe,
    () => window.localStorage.getItem(key(routineId)),
    () => null,
  );
  const startedAt = stored && Number(stored) > 0 ? Number(stored) : null;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (startedAt === null) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [startedAt]);

  const start = useCallback(() => {
    const current = Date.now();
    setNow(current);
    window.localStorage.setItem(key(routineId), String(current));
    window.dispatchEvent(new Event(EVENT));
  }, [routineId]);

  const clear = useCallback(() => {
    window.localStorage.removeItem(key(routineId));
    window.dispatchEvent(new Event(EVENT));
  }, [routineId]);

  return {
    startedAt,
    elapsedSeconds: startedAt === null ? 0 : Math.max(0, (Math.max(now, startedAt) - startedAt) / 1000),
    start,
    clear,
  };
}
