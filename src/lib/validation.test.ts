import { describe, expect, it } from "vitest";

import {
  createObservationSchema,
  createRoutineSchema,
  createSessionSchema,
  updateObservationSchema,
  updateRoutineSchema,
  updateSessionSchema,
} from "./validation";

const validSession = {
  startedAt: "2026-09-20T07:30:00.000Z",
  durationSeconds: 720,
  timezone: "Europe/Paris",
};

describe("session validation", () => {
  it("defaults feel and source for a quick log", () => {
    expect(createSessionSchema.parse(validSession)).toEqual({
      ...validSession,
      feel: null,
      source: "manual",
    });
  });

  it("rejects sessions that end in the future", () => {
    const startedAt = new Date(Date.now() - 60_000).toISOString();
    const parsed = createSessionSchema.safeParse({ ...validSession, startedAt, durationSeconds: 3600 });

    expect(parsed.success).toBe(false);
  });

  it("rejects unknown timezones and out-of-range durations", () => {
    expect(createSessionSchema.safeParse({ ...validSession, timezone: "Nowhere/Land" }).success).toBe(false);
    expect(createSessionSchema.safeParse({ ...validSession, durationSeconds: 0 }).success).toBe(false);
    expect(createSessionSchema.safeParse({ ...validSession, durationSeconds: 86_401 }).success).toBe(false);
  });

  it("rejects fields the client does not own", () => {
    expect(createSessionSchema.safeParse({ ...validSession, localMinute: 12 }).success).toBe(false);
  });

  it("moves start time and timezone together on edit", () => {
    expect(updateSessionSchema.safeParse({ durationSeconds: 600 }).success).toBe(true);
    expect(updateSessionSchema.safeParse({ startedAt: validSession.startedAt }).success).toBe(false);
    expect(updateSessionSchema.safeParse({}).success).toBe(false);
  });
});

describe("check validation", () => {
  const validCheck = { observedAt: "2026-09-20T07:30:00.000Z", timezone: "Europe/Paris", feel: "bad" };

  it("needs a rating, because an unrated check says nothing", () => {
    expect(createObservationSchema.parse(validCheck)).toEqual(validCheck);
    expect(createObservationSchema.safeParse({ ...validCheck, feel: undefined }).success).toBe(false);
    expect(createObservationSchema.safeParse({ ...validCheck, feel: null }).success).toBe(false);
  });

  it("rejects checks in the future and durations it does not have", () => {
    const observedAt = new Date(Date.now() + 60 * 60_000).toISOString();

    expect(createObservationSchema.safeParse({ ...validCheck, observedAt }).success).toBe(false);
    expect(createObservationSchema.safeParse({ ...validCheck, durationSeconds: 600 }).success).toBe(false);
  });

  it("moves the time and timezone together on edit", () => {
    expect(updateObservationSchema.safeParse({ feel: "good" }).success).toBe(true);
    expect(updateObservationSchema.safeParse({ observedAt: validCheck.observedAt }).success).toBe(false);
    expect(updateObservationSchema.safeParse({}).success).toBe(false);
  });
});

describe("routine validation", () => {
  it("accepts a new thing to track", () => {
    expect(
      createRoutineSchema.parse({
        name: "  Laundry ",
        icon: "washing-machine",
        cadenceHours: 168,
        typicalMinutes: 90,
      }).name,
    ).toBe("Laundry");
  });

  it("bounds names, icons and cadence", () => {
    const base = { name: "Gym", icon: "dumbbell", cadenceHours: 48, typicalMinutes: 60 };

    expect(createRoutineSchema.safeParse({ ...base, name: "" }).success).toBe(false);
    expect(createRoutineSchema.safeParse({ ...base, icon: "rocket" }).success).toBe(false);
    expect(createRoutineSchema.safeParse({ ...base, cadenceHours: 0 }).success).toBe(false);
    expect(updateRoutineSchema.safeParse({}).success).toBe(false);
  });
});
