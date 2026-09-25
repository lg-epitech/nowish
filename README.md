<img src="src/app/icon.svg" width="72" height="72" alt="Nowish logo">

# Nowish

Nowish answers one question: is now a good time?

It started with showers. You log how long each one actually took, and Nowish learns when you usually go and how long you wait between them. Open it and it says **Yes, now.**, **Nowish.** (a better moment is coming soon), or **Not now.**, with the reasons and the next good window. Add anything else you do on a rhythm, such as laundry, the gym or groceries, and each gets its own verdict and stats.

## What you see

- **The verdict** for right now, with a one-line summary and the reasons behind it. Drag across the 24-hour ribbon (7 days for weekly things) to check any other moment.
- **Log** asks first how long it actually took. Quick picks come from your own history, with your usual time marked. You can also say when it finished and, optionally, whether the timing felt good. **Start timer** measures it for you and survives a reload.
- **Time actually spent**: your usual minutes, the middle half of your sessions, the last session against your usual, minutes per week, the last 30 sessions as columns, the 30-day trend, and the median by time of day.
- **When you usually start**: your usual times and their share of sessions, how far sessions drift from them, your best-rated hours, a start-time density with one tick per session, and a weekday × time heatmap.
- **How often**: your usual gap and its spread, time since the last one, sessions per week, streaks, and weekly counts.
- **History**, grouped by day in the timezone each session happened in, with edit, delete and CSV export.

Every chart has a table view, so no number is only reachable by hovering.

## How the verdict is computed

Everything runs in `src/lib/insights`, a pure TypeScript module with unit tests. The browser computes it from your sessions, so the verdict stays current every minute without a round trip.

1. **Recency.** Each session is weighted by `0.5^(age / 45 days)`, so habits can change.
2. **Habit (0–1).** A wrapped Gaussian kernel density of start times over the 24-hour circle (bandwidth 50 → 30 minutes as data grows). Sessions rated good count 1.3×, bad 0.35×. Weekdays and weekends get separate curves once each has enough data, and routines with a gap of two days or more also use a weekday factor. The curve is blended with a flat prior while you have few sessions.
3. **Readiness (0–1).** A smoothed empirical CDF of past gaps, measured start to start. Gaps are weighted by how close to this time of day they ended, which is why a morning shower after an evening one isn't treated as "too soon" for someone who does both. Your stated cadence counts as 1.5 pseudo-gaps until real ones outweigh it. Readiness is `F(elapsed) / F(typical gap)`, capped at 1.
4. **Score** `= readiness × (0.25 + 0.75 × habit)`, evaluated every 5 minutes for the next 48 hours (30 minutes for 14 days on weekly routines).
5. **Decision.**
   - More than 90% of your gaps are shorter than the current one: **now** (overdue).
   - Readiness below 0.35: **not now**, pointing to the next good window.
   - Otherwise it looks half a usual gap ahead. Once you're due, waiting has a cost (`e^(−wait / 0.35 gap)`), so a later moment has to be clearly better.
   - Now within 85% of the best moment ahead, and either due or at a usual time: **now**.
   - The best moment is within 90 minutes: **nowish**.
   - Otherwise: **not now**.
6. **Expected duration** is a recency-weighted median, weighted again toward sessions at a similar time of day, so evening showers can run longer than morning ones.

## Stack

- Next.js 16 App Router, React 19 and TypeScript
- Clerk authentication
- PostgreSQL 17 in Docker Compose locally, Neon on Vercel
- Drizzle ORM with checked-in SQL migrations
- Vitest for the insights engine, formatting and validation

## Start locally

Requirements: Node.js 20.9+, pnpm and Docker.

```bash
pnpm install
cp .env.example .env.local   # then add your Clerk keys
docker compose up -d postgres
pnpm db:migrate
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

Compose binds PostgreSQL to `127.0.0.1:5433`, so it can run next to another project on 5432:

```text
postgresql://nowish:nowish@localhost:5433/nowish
```

With the [Clerk CLI](https://clerk.com/docs/cli) you can link an app and write the keys for you: `clerk link`, then `clerk env pull`.

## Deploy on Vercel

1. Import the repository in Vercel.
2. Add a Neon database from the Vercel Marketplace (Storage → Neon). It injects `POSTGRES_URL` for queries and `POSTGRES_URL_NON_POOLING` for migrations. `DATABASE_URL` also works as a fallback.
3. Add the Clerk variables from `.env.example` for Production and Preview.
4. Deploy. `vercel.json` runs `pnpm db:migrate` before `pnpm build`, so a deployment fails instead of serving code against an outdated schema.

Before real users sign in, create a Clerk production instance and set up your own Google OAuth credentials; development instances use shared ones.

## Data

- `profiles`: one row per Clerk user and their last known timezone. The first visit creates it together with a starter **Shower** routine.
- `routines`: name, icon, the cadence and typical minutes you guessed (used until real data outweighs them).
- `sessions`: start time (UTC), duration in seconds, IANA timezone and UTC offset, and the server-derived local date, minute and weekday, so stats keep the wall-clock time where each session happened even when you travel. Also an optional timing rating and whether it was typed in or timed.

Deleting a routine deletes its sessions. Every query is scoped to the signed-in user; the browser never supplies a user id.

## Commands

```bash
pnpm dev          # development server
pnpm db:migrate   # apply checked-in migrations
pnpm db:generate  # generate a migration after schema changes
pnpm db:studio    # inspect the database
pnpm test         # unit tests
pnpm typecheck    # TypeScript
pnpm lint         # ESLint
pnpm build        # production build
pnpm check        # all of the above
```

## API

All routes require a signed-in Clerk user and answer with `Cache-Control: private, no-store`.

- `GET /api/routines?tz=Europe/Paris` lists routines with session counts, creating the profile and starter routine on first use
- `POST /api/routines`, `PATCH /api/routines/:id`, `DELETE /api/routines/:id`
- `GET /api/routines/:id/sessions` returns the latest 1,500 sessions
- `POST /api/routines/:id/sessions`
- `PATCH /api/sessions/:id`, `DELETE /api/sessions/:id`
