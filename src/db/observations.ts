import { and, desc, eq } from "drizzle-orm";

import { getDb } from "@/db";
import { getOwnedRoutine } from "@/db/routines";
import { observations, sessions, type ObservationRow } from "@/db/schema";
import { zonedParts } from "@/lib/time";
import { MAX_OBSERVATIONS_READ, type Observation } from "@/lib/types";
import type { CreateObservationInput, UpdateObservationInput } from "@/lib/validation";

function toObservation(row: ObservationRow): Observation {
  return {
    id: row.id,
    routineId: row.routineId,
    observedAt: row.observedAt.toISOString(),
    timezone: row.timezone,
    utcOffsetMinutes: row.utcOffsetMinutes,
    localDate: row.localDate,
    localMinute: row.localMinute,
    localWeekday: row.localWeekday,
    feel: row.feel,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Wall-clock fields are derived on the server, as for sessions. */
function momentFields(observedAt: Date, timezone: string) {
  return { observedAt, timezone, ...zonedParts(observedAt, timezone) };
}

export async function listObservations(userId: string, routineId: string) {
  const routine = await getOwnedRoutine(userId, routineId);
  if (!routine) return null;

  const rows = await getDb()
    .select()
    .from(observations)
    .where(and(eq(observations.routineId, routineId), eq(observations.userId, userId)))
    .orderBy(desc(observations.observedAt), desc(observations.id))
    .limit(MAX_OBSERVATIONS_READ + 1);

  return {
    observations: rows.slice(0, MAX_OBSERVATIONS_READ).map(toObservation),
    truncated: rows.length > MAX_OBSERVATIONS_READ,
  };
}

export async function createObservation(
  userId: string,
  routineId: string,
  input: CreateObservationInput,
): Promise<Observation | null> {
  const routine = await getOwnedRoutine(userId, routineId);
  if (!routine) return null;

  const [row] = await getDb()
    .insert(observations)
    .values({ userId, routineId, feel: input.feel, ...momentFields(new Date(input.observedAt), input.timezone) })
    .returning();

  if (!row) throw new Error("Observation insert did not return a row");
  return toObservation(row);
}

export async function updateObservation(
  userId: string,
  observationId: string,
  input: UpdateObservationInput,
): Promise<Observation | null> {
  const [row] = await getDb()
    .update(observations)
    .set({
      ...(input.feel !== undefined ? { feel: input.feel } : {}),
      ...(input.observedAt && input.timezone ? momentFields(new Date(input.observedAt), input.timezone) : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(observations.id, observationId), eq(observations.userId, userId)))
    .returning();

  return row ? toObservation(row) : null;
}

export async function deleteObservation(userId: string, observationId: string) {
  const [deleted] = await getDb()
    .delete(observations)
    .where(and(eq(observations.id, observationId), eq(observations.userId, userId)))
    .returning({ id: observations.id });

  return deleted !== undefined;
}

/**
 * Replaces a session that was really only a check, in one transaction, so the
 * routine never shows both or neither.
 */
export async function convertSession(
  userId: string,
  sessionId: string,
  input: CreateObservationInput,
): Promise<Observation | null> {
  return getDb().transaction(async (tx) => {
    const [deleted] = await tx
      .delete(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)))
      .returning({ routineId: sessions.routineId });

    if (!deleted) return null;

    const [row] = await tx
      .insert(observations)
      .values({
        userId,
        routineId: deleted.routineId,
        feel: input.feel,
        ...momentFields(new Date(input.observedAt), input.timezone),
      })
      .returning();

    if (!row) throw new Error("Observation insert did not return a row");
    return toObservation(row);
  });
}
