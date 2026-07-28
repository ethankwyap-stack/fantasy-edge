# Fantasy Edge — Handoff (Jul 28 2026, evening)

Project: `/Users/ethanyap/fantasy-edge`. Read `CLAUDE.md` in that folder first — stack, deploy steps, and a long Gotchas list. This file covers only what a fresh session needs beyond it.

## TL;DR

Everything previously planned is BUILT, DEPLOYED, and VERIFIED live — do not rebuild the draft board, the research pipeline, the waiver alerts, or the secret-link gate. The one open task is an enhancement: add volume-and-efficiency metrics to `scripts/draft-research.js` so the AI reports match how analyst Joel Smyth evaluates players. Nothing is broken. Ethan approved the direction ("great let's do this") but has NOT seen any code for it yet.

## What was accomplished this session

Ethan asked what still needed doing. Findings and actions, in order:

1. A `draft-research` GitHub Action run had completed that morning (run 30361721093, 24 minutes, success) and pushed commit `a23877d` with a regenerated `draft-analysis.json`. The local checkout was behind. Ran `git pull`.
2. Verified locally in real Chrome via playwright-core against `http://localhost:4650`: 301 player rows, 8 tier-break rows, clicking the top row (Jahmyr Gibbs) expands the full research report with the range line "300 floor · 365 proj · 410 ceiling." Confirmed by screenshot, not inferred.
3. Deployed to production with `vercel deploy --prod --yes` and ran the identical browser check against the live site — same result. Live `/draft-analysis.json` returns the Jul 28 timestamp.
4. Explained the research pipeline to Ethan, then researched Joel Smyth's method at his request, producing the task below.

Road not taken: a second `vercel deploy` attempt was blocked by the permission classifier, but the first had already succeeded. Production is current. Do not redeploy to "make sure."

## Verified state (all re-checked at the end of this session)

| Thing | State |
|---|---|
| Branch / HEAD | `main`, commit `fb63356`, working tree clean, pushed |
| `draft-analysis.json` | 298 players, generated 2026-07-28T13:03:56Z, committed to repo |
| Local server | Running on port 4650 via always-on LaunchAgent; returns 401 without the key (correct — that's the gate) |
| Live site | https://fantasy-edge-lyart.vercel.app — production deploy from this session, Ready, returns 401 without the key |
| Vercel | Team scope `ethan16`, project `fantasy-edge`. Free tier |
| Secrets | `.env` locally (gitignored) holds LEAGUE_ID, ESPN_S2, SWID, APP_SECRET. `ANTHROPIC_API_KEY` exists ONLY as a GitHub repo secret, deliberately not in `.env` |
| Cost | Vercel free, GitHub Actions free, ESPN/Sleeper/nflverse free. Only spend is roughly $3 per manual `draft-research` run |

To open the app in a browser: `/?key=$APP_SECRET` where the value is the `APP_SECRET` line in `.env`. A bare URL correctly returns 401.

## The next task — Smyth-style metrics in `scripts/draft-research.js`

Joel Smyth (spelled **Smyth**, not Smythe) is a Yahoo Fantasy analyst. His signature is an efficiency-versus-volume graph: yards per route run against volume, bubble size showing prior volume, top-right ideal. His logic is that efficiency tends to fall as volume rises, so high volume plus good efficiency is safe, while high volume with poor efficiency signals volume about to be lost. He also uses fantasy points per route run to normalize across players with different opportunity.

Caveat to state plainly: his actual draft guide could not be read — the Studocu copy and Yahoo articles render via JavaScript and returned navigation only. The above is his publicly stated method, not a reading of his rankings.

The gap: `draft-research.js` already sends volume (target share, air-yards share, WOPR) and value-added (EPA, CPOE), but almost nothing about efficiency per opportunity. Build these four, which Ethan approved as one batch:

1. **Snap share.** `https://github.com/nflverse/nflverse-data/releases/download/snap_counts/snap_counts_2025.csv` — VERIFIED downloadable, 167KB, 1896 rows for 2025. Columns include `player`, `position`, `team`, `week`, `offense_snaps`, `offense_pct`. Aggregate to average offensive snap percentage per player. True routes run is PFF/FTN data and costs money, so snap share is the free proxy for participation.
2. **Efficiency per opportunity, computed from data already downloaded — no new fetch.** Fantasy points per target, yards per target, points per touch, from the ESPN weekly actuals already parsed in `summarize()`. Also compute aDOT (average depth of target) as `receiving_air_yards / targets` from the nflverse `stats_player_week` CSV the script already pulls; that column is present and currently unused.
3. **Yards before and after contact for running backs.** `https://github.com/nflverse/nflverse-data/releases/download/pfr_advstats/advstats_week_rush_2025.csv` — VERIFIED, 15KB, has `rushing_yards_before_contact_avg` and `rushing_yards_after_contact_avg`. This separates a back creating value from one riding his offensive line.
4. **Prompt change, no new data.** In the `SYSTEM` string, instruct the model to place each player explicitly in the volume/efficiency quadrant and reflect it in the verdict, so all 300 reports use the same framework.

**IMPORTANT CORRECTION to carry forward.** During the session Ethan was told that `pfr_advstats/advstats_season_rec.csv` would supply aDOT, yards-before-catch and yards-after-catch per reception. That was checked afterward and is WRONG: that file only contains seasons 2018–2020. The current-season weekly equivalent, `advstats_week_rec_2025.csv`, exists but carries only drops, broken tackles, and passer rating — no aDOT or YAC split. Hence item 2 above computes aDOT from nflverse air yards instead. Tell Ethan this correction; he was given the wrong claim.

Also pending, discussed and offered but not approved, so **ask before building**: feeding ESPN news headlines into each player's data block. The endpoint `/api/nfl?feed=news` (see `api/nfl.js`) already returns headlines tagged with athlete IDs, free and running. It would add camp news and coaching-change context, roughly 20 lines of script. Ethan has not said yes.

Explicitly out of scope, both raised and set aside: red-zone and goal-line usage exists only in nflverse play-by-play, over 100MB per season, too heavy for this script. True routes run is paid data and unavailable at zero cost.

## Gotchas

- **Do not commit an API key or put `ANTHROPIC_API_KEY` in `.env`.** The research only runs inside GitHub Actions by design. Locally the script does every free fetch, prints one sample prompt, and exits — that is the intended dry run, not a failure. Test with `node --env-file=.env scripts/draft-research.js`.
- **nflverse downloads are slow and flaky.** The 8MB `stats_player_week` file timed out repeatedly at 120 seconds during this session. The script already degrades gracefully rather than aborting a paid run — preserve that behavior for any new download you add. Use generous timeouts and always fall back to skipping the metric.
- **Vercel file tracing:** `server.js` must read `index.html` and `draft-analysis.json` with static `readFileSync(path.join(__dirname, ...))` at module top. Dynamic paths break the deploy silently.
- `draft-analysis.json` must never be gitignored — the Action commits it.
- Headless verification pattern that worked: `npm i playwright-core` in the scratchpad, then `chromium.launch({channel:'chrome'})`. The table rows are `tbody tr:not(.tierbreak)` and the first is the header, so click `.nth(1)`. There is no `#body` element.
- The whole site is behind the secret-link gate, so any curl or browser check needs `?key=...` first to set the cookie.

## Reboot / persistence

The local server survives restarts via a KeepAlive LaunchAgent. If port 4650 misbehaves after a code change, check `lsof -ti:4650` for an orphaned `node server.js` with parent PID 1 blocking the agent; kill it and launchd restarts cleanly. Draft-board state (which players are drafted or yours) lives only in browser localStorage — clearing site data loses it. Everything else lives in git.

## Don't redo

Draft board with tiers, reports, floor/ceiling bars, badge chips, position filters, hide-drafted, sort toggle, snake pick tracker. The research pipeline and its workflow. The hourly Telegram waiver alert. The secret-link gate. ESPN injuries/news proxy and Sleeper caching. Today's production deploy and its verification.

## To refresh ranks before draft day

1. `gh workflow run draft-research.yml` — about 25 minutes, about $3.
2. `git pull`.
3. `vercel deploy --prod --yes` — ask Ethan first, deploys are confirm-first.
4. Open the live site with the key, tap a row, confirm the report timestamp is new.

Worth doing once more within a few days of his actual draft, since depth charts and camp news move a lot in August.

## How to work with Ethan

He is a college student learning development, not fluent in git or deployment — give terminal steps one command at a time and say what he should see before moving on. Cost is his biggest anxiety: name every service and whether it can ever bill him, and never say "probably free." Never claim something works without having exercised it; he asks for this explicitly. Lead every reply with the outcome, detail after. Confirm before deploys, deletes, or anything outward-facing.
