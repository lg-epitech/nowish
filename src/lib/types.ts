export const FEELS = ["good", "okay", "bad"] as const;

export type Feel = (typeof FEELS)[number];

export const SESSION_SOURCES = ["manual", "timer"] as const;

export type SessionSource = (typeof SESSION_SOURCES)[number];

export const ROUTINE_ICONS = [
  "shower-head",
  "bath",
  "washing-machine",
  "shirt",
  "dumbbell",
  "footprints",
  "bike",
  "shopping-basket",
  "cooking-pot",
  "sprout",
  "sparkles",
  "moon",
  "book-open",
] as const;

export type RoutineIcon = (typeof ROUTINE_ICONS)[number];

/** How often a routine is expected to happen, used until real gaps exist. */
export const CADENCES = [
  { hours: 8, label: "A few times a day" },
  { hours: 24, label: "Daily" },
  { hours: 48, label: "Every other day" },
  { hours: 84, label: "Twice a week" },
  { hours: 168, label: "Weekly" },
  { hours: 336, label: "Every two weeks" },
  { hours: 720, label: "Monthly" },
] as const;

export const MAX_ROUTINES = 24;

/** The most recent sessions the insights engine reads for one routine. */
export const MAX_SESSIONS_READ = 1500;

export interface Routine {
  id: string;
  name: string;
  icon: RoutineIcon;
  cadenceHours: number;
  typicalMinutes: number;
  sessionCount: number;
  lastStartedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Session {
  id: string;
  routineId: string;
  startedAt: string;
  durationSeconds: number;
  timezone: string;
  utcOffsetMinutes: number;
  /** Wall-clock date where the session happened, `YYYY-MM-DD`. */
  localDate: string;
  /** Wall-clock minute of the day where the session started, 0–1439. */
  localMinute: number;
  /** ISO weekday where the session started, 1 (Monday) – 7 (Sunday). */
  localWeekday: number;
  feel: Feel | null;
  source: SessionSource;
  createdAt: string;
  updatedAt: string;
}

export interface RoutinesResponse {
  routines: Routine[];
}

export interface SessionsResponse {
  sessions: Session[];
  truncated: boolean;
}
