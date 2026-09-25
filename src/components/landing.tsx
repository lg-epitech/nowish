"use client";

import { SignInButton } from "@clerk/nextjs";
import { useMemo } from "react";

import { RoutineView } from "@/components/routine-view";
import { useNow } from "@/hooks/use-now";
import type { FormatOptions } from "@/lib/format";
import { sampleSessions } from "@/lib/sample-sessions";
import { browserTimezone } from "@/lib/time";
import type { Routine } from "@/lib/types";

const DEMO_ROUTINE: Routine = {
  id: "demo-shower",
  name: "Shower",
  icon: "shower-head",
  cadenceHours: 24,
  typicalMinutes: 10,
  sessionCount: 0,
  lastStartedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function SignInCta({ label }: { label: string }) {
  return (
    <SignInButton mode="modal" forceRedirectUrl="/">
      <button className="btn btn--primary btn--large" type="button">
        {label}
      </button>
    </SignInButton>
  );
}

export function Landing() {
  const now = useNow();
  const timeZone = now === null ? "UTC" : browserTimezone();
  const options = useMemo<FormatOptions>(() => ({ timeZone }), [timeZone]);
  // Regenerate the sample once an hour so the demo stays anchored to "now".
  const hour = now === null ? null : Math.floor(now / 3_600_000);
  const sessions = useMemo(
    () =>
      hour === null
        ? []
        : sampleSessions({
            routineId: DEMO_ROUTINE.id,
            now: hour * 3_600_000,
            days: 120,
            timeZone,
            seed: 42,
            slots: [
              { minute: 450, spread: 22, chance: 0.86, minutes: 11, minutesSpread: 2.5 },
              { minute: 1335, spread: 35, chance: 0.22, minutes: 17, minutesSpread: 4 },
            ],
          }),
    [hour, timeZone],
  );

  return (
    <div className="landing">
      <section className="landing__intro">
        <h1 className="landing__title">Should I shower now?</h1>
        <p className="landing__lede">
          Log how long your showers actually take. Nowish learns when you usually go and how long you wait between
          them, then answers the question for right now.
        </p>
        <div className="landing__cta">
          <SignInCta label="Start with your showers" />
          <p>Then add laundry, the gym, or anything else you do on a rhythm.</p>
        </div>
      </section>

      <section className="landing__demo" aria-label="Live example">
        <p className="landing__demo-note">
          A live example, computed for this minute from four months of made-up showers: most mornings around 7:30, some
          late evenings.
        </p>
        {now !== null ? (
          <RoutineView
            routine={DEMO_ROUTINE}
            sessions={sessions}
            now={now}
            options={options}
            compact
            headingLevel={2}
            demoAction={<SignInCta label="Log your own" />}
          />
        ) : (
          <div className="loading" aria-busy="true">
            <span className="loading__line loading__line--short" />
            <span className="loading__line" />
          </div>
        )}
      </section>
    </div>
  );
}
