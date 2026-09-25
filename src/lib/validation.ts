import { z } from "zod";

import { isIanaTimezone } from "@/lib/time";
import { FEELS, ROUTINE_ICONS, SESSION_SOURCES } from "@/lib/types";

/** Logged sessions may end a little in the future to absorb clock drift. */
const FUTURE_TOLERANCE_MS = 5 * 60_000;
const EARLIEST_SESSION = Date.parse("2000-01-01T00:00:00Z");

const timezoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine(isIanaTimezone, "Must be a valid IANA timezone");

const routineFields = {
  name: z.string().trim().min(1).max(40),
  icon: z.enum(ROUTINE_ICONS),
  cadenceHours: z.number().int().min(1).max(2160),
  typicalMinutes: z.number().int().min(1).max(600),
};

export const createRoutineSchema = z
  .object({ ...routineFields, timezone: timezoneSchema.optional() })
  .strict();

export const updateRoutineSchema = z
  .object(routineFields)
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, "Nothing to update");

const sessionFields = {
  startedAt: z.iso.datetime({ offset: true }),
  durationSeconds: z.number().int().min(1).max(86_400),
  timezone: timezoneSchema,
  feel: z.enum(FEELS).nullable(),
};

function checkSessionTiming(
  session: { startedAt?: string; durationSeconds?: number },
  context: z.RefinementCtx,
) {
  if (session.startedAt === undefined) return;

  const start = Date.parse(session.startedAt);

  if (start < EARLIEST_SESSION) {
    context.addIssue({ code: "custom", path: ["startedAt"], message: "Too far in the past" });
  }

  if (start + (session.durationSeconds ?? 0) * 1000 > Date.now() + FUTURE_TOLERANCE_MS) {
    context.addIssue({
      code: "custom",
      path: ["startedAt"],
      message: "A session cannot end in the future",
    });
  }
}

export const createSessionSchema = z
  .object({
    ...sessionFields,
    feel: sessionFields.feel.default(null),
    source: z.enum(SESSION_SOURCES).default("manual"),
  })
  .strict()
  .superRefine(checkSessionTiming);

export const updateSessionSchema = z
  .object(sessionFields)
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, "Nothing to update")
  .refine(
    (value) => (value.startedAt === undefined) === (value.timezone === undefined),
    "startedAt and timezone must be updated together",
  )
  .superRefine(checkSessionTiming);

export const idSchema = z.uuid();

export type CreateRoutineInput = z.infer<typeof createRoutineSchema>;
export type UpdateRoutineInput = z.infer<typeof updateRoutineSchema>;
export type CreateSessionInput = z.infer<typeof createSessionSchema>;
export type UpdateSessionInput = z.infer<typeof updateSessionSchema>;
