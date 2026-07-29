# Fantasy Edge — Handoff (Jul 28 2026, late evening)

Project: `/Users/ethanyap/fantasy-edge`. Read `CLAUDE.md` in that folder first — stack, deploy steps, and a long Gotchas list that now includes every data-source trap found this session. This file covers only what a fresh session needs beyond it.

## TL;DR

Everything is built, committed, and pushed. **The one open item is a decision only Ethan makes: when to spend roughly $3 on a `draft-research` run.** He said explicitly he wants to save money and will say when, in the coming days. Do not trigger it, do not "just check" it. Nothing is broken and nothing needs deploying.

## What was accomplished this session

Added Smyth-style volume-and-efficiency metrics to `scripts/draft-research.js`, plus ESPN news context. Two commits, both pushed to `main`:

- `fbed0f1` — snap share, efficiency per opportunity, aDOT, yards before/after contact, and a volume/efficiency quadrant framework in the prompt.
- `c839741` — ESPN news headlines (headline + description + date, up to 3 per player) folded into each player's data block.

All verified in the **free** local dry run (`node --env-file=.env scripts/draft-research.js`), which does every fetch, prints one sample prompt, and exits before calling Claude. 300 players, 18 batches, clean finish. No paid run was made.

How correctness was established, not assumed:
- Yards before contact plus after contact reconciles with yards per carry computed from ESPN's entirely separate data, for every back checked (Gibbs 3.5 + 1.6 = 5.1 vs 5.0; Taylor 2.6 + 2.3 = 4.9 vs 4.9). Two independent sources agreeing means both parse correctly.
- aDOT recomputed by hand ranks deep WRs ~13 yards, TEs ~5, RBs ~1 — the expected ordering.
- News join logs `News matched 31/300` every run.

## Corrections to the previous handoff (it was wrong three ways)

1. The rush-contact download URL 404s as written. **nflverse URLs use the release TAG, not the file family**: `releases/download/pfr_advstats/advstats_week_rush_2025.csv`. Same trap for `snap_counts` and `stats_player`.
2. `snap_counts_2025.csv` is **2.4 MB with 26,613 rows**, not the 167 KB / 1,896 rows claimed. It downloads fine, but treat it as a large file.
3. `advstats_season_rec.csv` really does cover only 2018–2020 (that correction was right, and Ethan has been told). aDOT is therefore computed as nflverse `receiving_air_yards / targets`.

## Verified state

| Thing | State |
|---|---|
| Branch / HEAD | `main`, commit `c839741`, working tree clean, pushed |
| `draft-analysis.json` | Unchanged — 298 players, generated 2026-07-28T13:03:56Z. The new metrics do NOT appear until a research run happens |
| Live site | https://fantasy-edge-lyart.vercel.app — current, unaffected by this session (only the research script changed) |
| Deploy needed? | **No.** Nothing user-facing changed |
| Secrets | `.env` locally (gitignored): LEAGUE_ID, ESPN_S2, SWID, APP_SECRET. `ANTHROPIC_API_KEY` exists ONLY as a GitHub repo secret, deliberately |
| Cost | Vercel free, Actions free, ESPN/Sleeper/nflverse free. Only spend is ~$3 per manual `draft-research` run |

Open the app with `/?key=$APP_SECRET` (value in `.env`). A bare URL correctly returns 401.

## The open task — refresh ranks, ONLY when Ethan says go

1. `gh workflow run draft-research.yml` — ~25 min, ~$3.
2. `git pull`.
3. `vercel deploy --prod --yes` — **ask first**, deploys are confirm-first.
4. Open the live site with the key, tap a row, confirm the report timestamp is new and reports mention volume/efficiency quadrants.

Worth doing once within a few days of his actual draft, since depth charts and camp news move a lot in August.

## What the research prompt now sends per player

2026 projection + ADP + rank; 2024/2025 weekly actuals with efficiency (points per target, yards per target, yards per carry, points per touch); advanced usage (target share, air-yards share, WOPR, aDOT, EPA, CPOE for QBs, snap share, yards before/after contact, broken tackles); depth chart; recent ESPN news where it exists; playoff opponents and bye.

## Gotchas beyond CLAUDE.md

- **Never put `ANTHROPIC_API_KEY` in `.env`.** The paid run lives in GitHub Actions by design. Locally the script dry-runs — that is intended behavior, not a failure.
- ESPN's news feed is capped at 50 articles upstream and per-team news returns empty, so ~31 of 300 players get headlines. The prompt tells the model to ignore generic roundups and not treat missing news as a negative — keep that guard if you touch the prompt.
- nflverse downloads are slow and flaky; the 8 MB weekly file has timed out at 120s before. `csvRows()` returns null and the run degrades loudly rather than aborting a paid run. **Preserve that for any new download.**
- Piping the dry run through `head` kills node early via SIGPIPE and makes it look like a feature produced nothing. Write to a file, then grep it.
- `draft-analysis.json` must never be gitignored — the Action commits it.
- Vercel file tracing: `server.js` must read `index.html` and `draft-analysis.json` with static `readFileSync(path.join(__dirname, ...))`.

## Don't redo

Draft board with tiers, reports, floor/ceiling bars, badges, filters, snake pick tracker. The research pipeline and its workflow. The hourly Telegram waiver alert. The secret-link gate. ESPN injuries/news proxy and Sleeper caching. The four Smyth metrics and the news feed — built and verified this session.

## Ideas raised and set aside

Red-zone and goal-line usage lives only in nflverse play-by-play, 100 MB+ per season — too heavy. True routes run is paid data. Both were declined at zero cost, not forgotten.

## How to work with Ethan

College student learning development, not fluent in git or deployment — terminal steps one command at a time, say what he should see, wait for confirmation. **Cost is his biggest anxiety**: name every service and whether it can ever bill him, never say "probably free," and never spend the $3 without an explicit go-ahead. Never claim something works without having exercised it. Lead every reply with the outcome. Confirm before deploys, deletes, or anything outward-facing.
