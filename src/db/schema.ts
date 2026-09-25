import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { FEELS, SESSION_SOURCES, type RoutineIcon } from "@/lib/types";

export const feelEnum = pgEnum("feel", FEELS);
export const sessionSourceEnum = pgEnum("session_source", SESSION_SOURCES);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .defaultNow()
    .notNull(),
};

export const profiles = pgTable(
  "profiles",
  {
    clerkUserId: text("clerk_user_id").primaryKey(),
    timezone: text("timezone").notNull().default("UTC"),
    ...timestamps,
  },
  (table) => [
    check("profiles_timezone_not_empty", sql`char_length(${table.timezone}) > 0`),
  ],
);

export const routines = pgTable(
  "routines",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => profiles.clerkUserId, { onDelete: "cascade" }),
    name: text("name").notNull(),
    icon: text("icon").$type<RoutineIcon>().notNull(),
    cadenceHours: integer("cadence_hours").notNull(),
    typicalMinutes: integer("typical_minutes").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("routines_user_name_unique").on(table.userId, sql`lower(${table.name})`),
    index("routines_user_created_idx").on(table.userId, table.createdAt),
    check("routines_name_length", sql`char_length(${table.name}) between 1 and 40`),
    check("routines_cadence_range", sql`${table.cadenceHours} between 1 and 2160`),
    check("routines_typical_minutes_range", sql`${table.typicalMinutes} between 1 and 600`),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => profiles.clerkUserId, { onDelete: "cascade" }),
    routineId: uuid("routine_id")
      .notNull()
      .references(() => routines.id, { onDelete: "cascade" }),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }).notNull(),
    durationSeconds: integer("duration_seconds").notNull(),
    timezone: text("timezone").notNull(),
    utcOffsetMinutes: smallint("utc_offset_minutes").notNull(),
    localDate: date("local_date", { mode: "string" }).notNull(),
    localMinute: smallint("local_minute").notNull(),
    localWeekday: smallint("local_weekday").notNull(),
    feel: feelEnum("feel"),
    source: sessionSourceEnum("source").notNull().default("manual"),
    ...timestamps,
  },
  (table) => [
    index("sessions_routine_started_idx").on(table.routineId, table.startedAt.desc()),
    index("sessions_user_started_idx").on(table.userId, table.startedAt.desc()),
    check("sessions_duration_range", sql`${table.durationSeconds} between 1 and 86400`),
    check("sessions_utc_offset_range", sql`${table.utcOffsetMinutes} between -840 and 840`),
    check("sessions_local_minute_range", sql`${table.localMinute} between 0 and 1439`),
    check("sessions_local_weekday_range", sql`${table.localWeekday} between 1 and 7`),
    check("sessions_timezone_not_empty", sql`char_length(${table.timezone}) > 0`),
  ],
);

export type Profile = typeof profiles.$inferSelect;
export type RoutineRow = typeof routines.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
