<img src="src/app/icon.svg" width="72" height="72" alt="Nowish logo">

# Nowish

Should I shower now? You've asked yourself this. Possibly today.

Nowish answers it. Log how long your showers actually take (the real number, not the one you'd tell a date) and it learns your rhythm well enough to say "Yes, now.", "Nowish." or "Not now." It works for laundry and the gym too, or anything else you do on a schedule and would rather not think about.

Your sessions are private to your account. You can export them to CSV whenever you want to feel seen.

Try it at [nowish-flame.vercel.app](https://nowish-flame.vercel.app).

## Run it locally

It's Next.js, Clerk, Drizzle and Postgres. You'll need Node 20.9+, pnpm, Docker and a Clerk app.

```bash
pnpm install
cp .env.example .env.local   # then add your Clerk keys
docker compose up -d postgres
pnpm db:migrate
pnpm dev
```

Postgres runs on port 5433, so it won't fight whatever already lives on 5432.

## Check your work

`pnpm check` runs types, lint, tests and a production build. It finishes faster than your shower.
