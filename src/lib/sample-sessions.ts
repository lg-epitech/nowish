import { MS_PER_DAY, MS_PER_MINUTE, zonedParts } from "@/lib/time";
import type { Feel, Session } from "@/lib/types";

export interface SampleSlot {
  /** Usual local start minute. */
  minute: number;
  /** Standard deviation of the start, in minutes. */
  spread: number;
  /** Chance this slot happens on a given day. */
  chance: number;
  minutes: number;
  minutesSpread: number;
  /** ISO weekdays this slot can happen on; all days when omitted. */
  weekdays?: readonly number[];
}

export interface SampleSpec {
  routineId: string;
  now: number;
  days: number;
  timeZone: string;
  seed: number;
  slots: readonly SampleSlot[];
}

/** Small, fast, seedable PRNG (mulberry32). */
export function seededRandom(seed: number) {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normal(random: () => number) {
  const u = Math.max(random(), Number.EPSILON);
  const v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function localToInstant(localDate: string, minute: number, timeZone: string) {
  const midnightUtc = Date.parse(`${localDate}T00:00:00Z`);
  const guess = midnightUtc + minute * MS_PER_MINUTE;
  const offset = zonedParts(guess, timeZone).utcOffsetMinutes;
  return guess - offset * MS_PER_MINUTE;
}

export function sampleSessions(spec: SampleSpec): Session[] {
  const random = seededRandom(spec.seed);
  const sessions: Session[] = [];

  for (let day = spec.days; day >= 0; day -= 1) {
    const { localDate, localWeekday } = zonedParts(spec.now - day * MS_PER_DAY, spec.timeZone);

    for (const slot of spec.slots) {
      if (slot.weekdays && !slot.weekdays.includes(localWeekday)) continue;
      if (random() > slot.chance) continue;

      const offset = normal(random) * slot.spread;
      const minute = Math.round(Math.min(1439, Math.max(0, slot.minute + offset)));
      const start = localToInstant(localDate, minute, spec.timeZone);
      const minutes = Math.max(1, slot.minutes + normal(random) * slot.minutesSpread);
      const durationSeconds = Math.round(minutes * 60);

      if (start + durationSeconds * 1000 > spec.now) continue;

      const z = Math.abs(offset) / Math.max(1, slot.spread);
      const roll = random();
      const feel: Feel | null =
        roll < 0.35 ? null : z < 1 ? (roll < 0.85 ? "good" : "okay") : roll < 0.6 ? "okay" : "bad";
      const parts = zonedParts(start, spec.timeZone);
      const iso = new Date(start).toISOString();

      sessions.push({
        id: `${spec.routineId}-${sessions.length.toString().padStart(4, "0")}`,
        routineId: spec.routineId,
        startedAt: iso,
        durationSeconds,
        timezone: spec.timeZone,
        utcOffsetMinutes: parts.utcOffsetMinutes,
        localDate: parts.localDate,
        localMinute: parts.localMinute,
        localWeekday: parts.localWeekday,
        feel,
        source: "manual",
        createdAt: iso,
        updatedAt: iso,
      });
    }
  }

  return sessions;
}
