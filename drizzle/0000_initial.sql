CREATE TYPE "public"."feel" AS ENUM('good', 'okay', 'bad');--> statement-breakpoint
CREATE TYPE "public"."session_source" AS ENUM('manual', 'timer');--> statement-breakpoint
CREATE TABLE "profiles" (
	"clerk_user_id" text PRIMARY KEY NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profiles_timezone_not_empty" CHECK (char_length("profiles"."timezone") > 0)
);
--> statement-breakpoint
CREATE TABLE "routines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"icon" text NOT NULL,
	"cadence_hours" integer NOT NULL,
	"typical_minutes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "routines_name_length" CHECK (char_length("routines"."name") between 1 and 40),
	CONSTRAINT "routines_cadence_range" CHECK ("routines"."cadence_hours" between 1 and 2160),
	CONSTRAINT "routines_typical_minutes_range" CHECK ("routines"."typical_minutes" between 1 and 600)
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"routine_id" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"duration_seconds" integer NOT NULL,
	"timezone" text NOT NULL,
	"utc_offset_minutes" smallint NOT NULL,
	"local_date" date NOT NULL,
	"local_minute" smallint NOT NULL,
	"local_weekday" smallint NOT NULL,
	"feel" "feel",
	"source" "session_source" DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_duration_range" CHECK ("sessions"."duration_seconds" between 1 and 86400),
	CONSTRAINT "sessions_utc_offset_range" CHECK ("sessions"."utc_offset_minutes" between -840 and 840),
	CONSTRAINT "sessions_local_minute_range" CHECK ("sessions"."local_minute" between 0 and 1439),
	CONSTRAINT "sessions_local_weekday_range" CHECK ("sessions"."local_weekday" between 1 and 7),
	CONSTRAINT "sessions_timezone_not_empty" CHECK (char_length("sessions"."timezone") > 0)
);
--> statement-breakpoint
ALTER TABLE "routines" ADD CONSTRAINT "routines_user_id_profiles_clerk_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("clerk_user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_profiles_clerk_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("clerk_user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_routine_id_routines_id_fk" FOREIGN KEY ("routine_id") REFERENCES "public"."routines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "routines_user_name_unique" ON "routines" USING btree ("user_id",lower("name"));--> statement-breakpoint
CREATE INDEX "routines_user_created_idx" ON "routines" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "sessions_routine_started_idx" ON "sessions" USING btree ("routine_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "sessions_user_started_idx" ON "sessions" USING btree ("user_id","started_at" DESC NULLS LAST);