CREATE TABLE "observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"routine_id" uuid NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"timezone" text NOT NULL,
	"utc_offset_minutes" smallint NOT NULL,
	"local_date" date NOT NULL,
	"local_minute" smallint NOT NULL,
	"local_weekday" smallint NOT NULL,
	"feel" "feel" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "observations_utc_offset_range" CHECK ("observations"."utc_offset_minutes" between -840 and 840),
	CONSTRAINT "observations_local_minute_range" CHECK ("observations"."local_minute" between 0 and 1439),
	CONSTRAINT "observations_local_weekday_range" CHECK ("observations"."local_weekday" between 1 and 7),
	CONSTRAINT "observations_timezone_not_empty" CHECK (char_length("observations"."timezone") > 0)
);
--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_user_id_profiles_clerk_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("clerk_user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_routine_id_routines_id_fk" FOREIGN KEY ("routine_id") REFERENCES "public"."routines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "observations_routine_observed_idx" ON "observations" USING btree ("routine_id","observed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "observations_user_observed_idx" ON "observations" USING btree ("user_id","observed_at" DESC NULLS LAST);