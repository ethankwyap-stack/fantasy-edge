# Fantasy Edge — Handoff (Jul 28 2026)

Read `CLAUDE.md` first (stack + gotchas). Everything planned so far is SHIPPED and verified live.

## State (verified Jul 28 2026)

- Draft board with Claude-written research: tiers, verdict + full report on tap, floor/proj/ceiling bar, badge chips, position filters, hide-drafted, sort toggle, snake pick tracker.
- `draft-analysis.json` regenerated Jul 28 13:03 UTC (298 players) by `gh workflow run draft-research.yml`; the workflow commits it back to main.
- Data feeds: ESPN league + past seasons, Sleeper dump (localStorage `sn2`, 24h), `/api/nfl?feed=injuries|news`, nflverse weekly usage CSVs.
- Hourly Telegram waiver alert (GitHub Actions, change-driven).
- Secret-link gate on all routes.
- Deployed to prod Jul 28; live URL verified headless: 301 rows, 8 tier breaks, report expands.

## To refresh ranks before draft day

1. `gh workflow run draft-research.yml` (~25 min, ~$3).
2. `git pull`.
3. `vercel deploy --prod --yes` (ask Ethan first).
4. Verify live: open `/?key=$APP_SECRET`, tap a row, confirm the report text matches the new run's timestamp.

## Nothing else is pending.
