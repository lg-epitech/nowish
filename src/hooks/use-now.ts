"use client";

import { useSyncExternalStore } from "react";

const MINUTE = 60_000;
const listeners = new Set<() => void>();
let snapshot: number | null = null;
let timeout: ReturnType<typeof setTimeout> | undefined;

function emit() {
  snapshot = Date.now();
  for (const listener of listeners) listener();
}

function schedule() {
  clearTimeout(timeout);
  timeout = setTimeout(() => {
    emit();
    schedule();
  }, MINUTE - (Date.now() % MINUTE) + 50);
}

function onVisibilityChange() {
  if (document.visibilityState === "visible") {
    emit();
    schedule();
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);

  if (listeners.size === 1) {
    snapshot = Date.now();
    schedule();
    document.addEventListener("visibilitychange", onVisibilityChange);
  }

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      clearTimeout(timeout);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    }
  };
}

function getSnapshot() {
  snapshot ??= Date.now();
  return snapshot;
}

/**
 * The current time, refreshed on each new minute and whenever the tab comes
 * back. `null` on the server so the first client render matches it.
 */
export function useNow(): number | null {
  return useSyncExternalStore(subscribe, getSnapshot, () => null);
}
