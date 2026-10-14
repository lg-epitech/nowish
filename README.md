<img src="src/app/icon.svg" width="72" height="72" alt="Nowish logo">

# Nowish

Is the shower free? Will the laundry room be busy? Nowish learns from your congestion reports and gives each activity one score: the estimated percentage chance that its area is usable. Higher is better.

Rate the area **Clear**, **Some congestion**, or **Busy** when you log a session, or save a quick check without doing the activity. Unrated sessions still teach duration and activity statistics; they do not imply that the area was clear. Your entries stay private to your account, and you can export them to CSV.

The score combines all rated sessions and checks for the selected activity. It estimates availability, independently of how often you do the activity or when you last did it. The next 24 hours use the same score on a fixed 0–100% scale.

## How the score works

- Clear contributes 1, some congestion 0.5, and busy 0. These are usability proxies; historical good/okay/bad timing ratings use the same mapping.
- Reports at similar clock times carry more weight, using a 45-minute Gaussian smoothing scale and matching clock times across midnight. Same-weekday reports provide the local estimate. Other days of the same weekday/weekend type and then the overall history contribute through bounded priors; unrelated day types never add comparable evidence.
- Historical influence halves every 45 days. Reports within 15 minutes receive continuous correlation weights, with no half-hour bucket boundaries. Identical repeated taps share one vote, distant bursts cannot suppress independent reports, and each date supplies at most one effective vote.
- A neutral prior and a bounded contribution from the overall history keep sparse hours conservative. With no ratings the score is 50%, labeled “No reports yet.”
- Recent rated sessions and checks are combined with decaying weights to adjust current conditions. The adjustment has a capped strength that halves every 20 minutes. Conflicting reports remain mixed even if their timestamps differ slightly; an unrated session does not erase them.
- Evidence strength reflects recent reports near this hour on the same weekday/weekend type, with the exact weekday counting most. Reports from other day types cannot strengthen this label. It describes historical coverage, not measured prediction accuracy.

Suggestions select the earliest time with at least 65% estimated usability, a 10-point improvement, and moderate comparable historical evidence. A fading busy report alone does not establish a future recovery window.

The 45-minute smoothing scale preserves narrow busy periods better than 90 minutes in synthetic checks; broader smoothing can perform better for flat or noisy patterns. These checks validate behavior, not real-world calibration.

The percentage is a heuristic estimate, not a calibrated probability or a guarantee of access. Missing reports do not mean that an area is free. History loads in bounded cursor pages until every entry has been read; a failed page prevents partial statistics from being displayed.

Try it at [nowish-flame.vercel.app](https://nowish-flame.vercel.app).

## Run it locally

Next.js, Clerk, Drizzle and Postgres. You'll need Node 20.9+, pnpm, Docker and a Clerk app.

```bash
pnpm install
cp .env.example .env.local   # then add your Clerk keys
docker compose up -d postgres
pnpm db:migrate
pnpm dev
```

Postgres runs on port 5433.

## Check your work

`pnpm check` runs types, lint, tests and a production build. Tests cover scoring, sparse and stale evidence, weekday patterns, midnight and DST, fresh reports, repeated checks, full-history pagination, and activity statistics.
