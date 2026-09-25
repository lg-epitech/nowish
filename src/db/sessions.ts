import { and, desc, eq } from "drizzle-orm";

import { getDb } from "@/db";
import { getOwnedRoutine } from "@/db/routines";
import { sessions, type SessionRow } from "@/db/schema";
import { zonedParts } from "@/lib/time";
import { MAX_SESSIONS_READ, type Session } from "@/lib/types";
import type { CreateSessionInput, UpdateSessionInput } from "@/lib/validation";

const FUTURE_TOLERANCE_MS = 5 * 60_000;

export class SessionError extends Error {
  constructor(message: string) {
    super(message);
  }
}

function toSession(row: SessionRow): Session {
  return {
    id: row.id,
    routineId: row.routineId,
    startedAt: row.startedAt.toISOString(),
    durationSeconds: row.durationSeconds,
    timezone: row.timezone,
    utcOffsetMinutes: row.utcOffsetMinutes,
    localDate: row.localDate,
    localMinute: row.localMinute,
    localWeekday: row.localWeekday,
    feel: row.feel,
    source: row.source,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Wall-clock fields are derived on the server so stats never trust the client's math. */
function localFields(startedAt: Date, timezone: string) {
  const parts = zonedParts(startedAt, timezone);

  return {
    startedAt,
    timezone,
    utcOffsetMinutes: parts.utcOffsetMinutes,
    localDate: parts.localDate,
    localMinute: parts.localMinute,
    localWeekday: parts.localWeekday,
  };
}

export async function listSessions(userId: string, routineId: string) {
  const routine = await getOwnedRoutine(userId, routineId);
  if (!routine) return null;

  const rows = await getDb()
    .select()
    .from(sessions)
    .where(and(eq(sessions.routineId, routineId), eq(sessions.userId, userId)))
    .orderBy(desc(sessions.startedAt), desc(sessions.id))
    .limit(MAX_SESSIONS_READ + 1);

  return {
    sessions: rows.slice(0, MAX_SESSIONS_READ).map(toSession),
    truncated: rows.length > MAX_SESSIONS_READ,
  };
}

export async function createSession(
  userId: string,
  routineId: string,
  input: CreateSessionInput,
): Promise<Session | null> {
  const routine = await getOwnedRoutine(userId, routineId);
  if (!routine) return null;

  const [row] = await getDb()
    .insert(sessions)
    .values({
      userId,
      routineId,
      durationSeconds: input.durationSeconds,
      feel: input.feel,
      source: input.source,
      ...localFields(new Date(input.startedAt), input.timezone),
    })
    .returning();

  if (!row) throw new Error("Session insert did not return a row");
  return toSession(row);
}

export async function updateSession(
  userId: string,
  sessionId: string,
  input: UpdateSessionInput,
): Promise<Session | null> {
  const db = getDb();
  const [existing] = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)))
    .limit(1);

  if (!existing) return null;

  const startedAt = input.startedAt ? new Date(input.startedAt) : existing.startedAt;
  const durationSeconds = input.durationSeconds ?? existing.durationSeconds;

  if (startedAt.getTime() + durationSeconds * 1000 > Date.now() + FUTURE_TOLERANCE_MS) {
    throw new SessionError("A session cannot end in the future");
  }

  const [row] = await db
    .update(sessions)
    .set({
      durationSeconds,
      ...(input.feel !== undefined ? { feel: input.feel } : {}),
      ...(input.startedAt && input.timezone ? localFields(startedAt, input.timezone) : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)))
    .returning();

  return row ? toSession(row) : null;
}

export async function deleteSession(userId: string, sessionId: string) {
  const [deleted] = await getDb()
    .delete(sessions)
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)))
    .returning({ id: sessions.id });

  return deleted !== undefined;
}
