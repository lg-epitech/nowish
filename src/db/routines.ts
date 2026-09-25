import { and, asc, eq, sql } from "drizzle-orm";

import { getDb } from "@/db";
import { profiles, routines, sessions, type RoutineRow } from "@/db/schema";
import { MAX_ROUTINES, type Routine } from "@/lib/types";
import type { CreateRoutineInput, UpdateRoutineInput } from "@/lib/validation";

/** Every new account starts with the routine Nowish was built for. */
export const STARTER_ROUTINE = {
  name: "Shower",
  icon: "shower-head",
  cadenceHours: 24,
  typicalMinutes: 10,
} as const;

export class RoutineError extends Error {
  constructor(
    readonly code: "limit" | "duplicate",
    message: string,
  ) {
    super(message);
  }
}

function toIso(value: Date | string | null) {
  if (value === null) return null;
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function toRoutine(
  row: RoutineRow,
  sessionCount = 0,
  lastStartedAt: Date | string | null = null,
): Routine {
  return {
    id: row.id,
    name: row.name,
    icon: row.icon,
    cadenceHours: row.cadenceHours,
    typicalMinutes: row.typicalMinutes,
    sessionCount,
    lastStartedAt: toIso(lastStartedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function isUniqueViolation(error: unknown) {
  const code =
    (error as { code?: string })?.code ?? (error as { cause?: { code?: string } })?.cause?.code;
  return code === "23505";
}

/**
 * Creates the profile on first sight, together with the starter routine, so a
 * new account lands on something useful instead of an empty screen.
 */
export async function ensureProfile(userId: string, timezone: string) {
  const db = getDb();

  await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(profiles)
      .values({ clerkUserId: userId, timezone })
      .onConflictDoNothing()
      .returning({ id: profiles.clerkUserId });

    if (created) {
      await tx.insert(routines).values({ userId, ...STARTER_ROUTINE });
    }
  });
}

export async function listRoutines(userId: string): Promise<Routine[]> {
  const rows = await getDb()
    .select({
      routine: routines,
      sessionCount: sql<number>`count(${sessions.id})::int`,
      lastStartedAt: sql<Date | string | null>`max(${sessions.startedAt})`,
    })
    .from(routines)
    .leftJoin(sessions, eq(sessions.routineId, routines.id))
    .where(eq(routines.userId, userId))
    .groupBy(routines.id)
    .orderBy(asc(routines.createdAt), asc(routines.id));

  return rows.map((row) => toRoutine(row.routine, row.sessionCount, row.lastStartedAt));
}

export async function getOwnedRoutine(userId: string, routineId: string) {
  const [row] = await getDb()
    .select()
    .from(routines)
    .where(and(eq(routines.id, routineId), eq(routines.userId, userId)))
    .limit(1);

  return row ?? null;
}

export async function createRoutine(userId: string, input: CreateRoutineInput): Promise<Routine> {
  const { timezone, ...values } = input;
  await ensureProfile(userId, timezone ?? "UTC");

  const db = getDb();

  try {
    return await db.transaction(async (tx) => {
      const [{ count }] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(routines)
        .where(eq(routines.userId, userId));

      if (count >= MAX_ROUTINES) {
        throw new RoutineError("limit", `You can track up to ${MAX_ROUTINES} things`);
      }

      const [row] = await tx.insert(routines).values({ userId, ...values }).returning();
      if (!row) throw new Error("Routine insert did not return a row");
      return toRoutine(row);
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new RoutineError("duplicate", `You already track “${values.name}”`);
    }
    throw error;
  }
}

export async function updateRoutine(
  userId: string,
  routineId: string,
  input: UpdateRoutineInput,
): Promise<Routine | null> {
  try {
    const [row] = await getDb()
      .update(routines)
      .set({ ...input, updatedAt: new Date() })
      .where(and(eq(routines.id, routineId), eq(routines.userId, userId)))
      .returning();

    if (!row) return null;

    const [summary] = await getDb()
      .select({
        sessionCount: sql<number>`count(*)::int`,
        lastStartedAt: sql<Date | string | null>`max(${sessions.startedAt})`,
      })
      .from(sessions)
      .where(eq(sessions.routineId, row.id));

    return toRoutine(row, summary?.sessionCount ?? 0, summary?.lastStartedAt ?? null);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new RoutineError("duplicate", `You already track “${input.name}”`);
    }
    throw error;
  }
}

export async function deleteRoutine(userId: string, routineId: string) {
  const [deleted] = await getDb()
    .delete(routines)
    .where(and(eq(routines.id, routineId), eq(routines.userId, userId)))
    .returning({ id: routines.id });

  return deleted !== undefined;
}
