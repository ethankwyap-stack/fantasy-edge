# Fantasy Edge — Handoff (Jul 19 2026)

Read `~/fantasy-edge/CLAUDE.md` first (stack + gotchas). Two parts below: what's DONE (don't redo), and the ONE task to build: the **rigorous draft board**. Ethan approved the scope via /questions — build it, verify it, don't re-ask.

## DONE this session (verified, don't touch)

- Hourly change-driven Telegram waiver alert shipped & verified live (runs 29685837618 seeded state + Claude NO_ALERT; 29685854698 exited free at diff gate). `scripts/waiver-alert.js` + `.github/workflows/waiver-alert.yml`. Docs/memory updated, all pushed (HEAD 3aa17bd).

## TASK: rigorous draft board (Ethan's decided choices — do not re-litigate)

Goal: draft board ranks backed by real research — why each player deserves the rank: past-year data interpreted for the future, ceiling/floor, schedule, team depth/touch competition. His four answers (via AskUserQuestion):

1. **Engine: Claude on free data.** Script gathers free data per player, Claude writes the analysis. ~$2.50–3/run approved. Use **claude-opus-4-8**, `thinking:{type:'adaptive'}`, structured outputs via `output_config:{format:{type:'json_schema', schema}}` (guarantees parseable JSON; schema needs `additionalProperties:false` + `required`). ~15 batched calls of ~20 players, grouped by position. max_tokens 16000, non-streaming OK.
2. **Pool: top 300** (by ESPN PPR draft rank).
3. **Display: ALL of** — expandable full report per player, ceiling/floor range bar, tier groupings with visible breaks, risk/opportunity badges (fixed enum: split-touches, depth-risk, injury-history, rookie, new-team, easy-playoffs, tough-playoffs, breakout, decline-risk, workhorse, td-dependent, handcuff, elite).
4. **Refresh: manual re-run** (once now, again near draft day). No cron.

## Architecture (settled)

- `scripts/draft-research.js` (new): gather data → batch to Claude → write `draft-analysis.json` at repo root `{generated, season, players: {nameLower: {tier, verdict, report, floor, ceiling, badges, proj, rank}}}`.
- ANTHROPIC_API_KEY exists ONLY as a GitHub repo secret (NOT in .env) → generation runs via new workflow `.github/workflows/draft-research.yml`: `workflow_dispatch` only, `permissions: contents: write`, env needs ANTHROPIC_API_KEY + LEAGUE_ID + ESPN_S2 + SWID, runs script then git-commits draft-analysis.json back to the repo.
- Serve it: server.js must add a route for `/draft-analysis.json` using a **static** `fs.readFileSync(path.join(__dirname,'draft-analysis.json'))` at module top (Vercel tracing gotcha — same as INDEX; file must exist at deploy time, commit a `{}` placeholder if needed). server.js currently serves INDEX for every non-/api path.
- index.html draft tab: fetch `/draft-analysis.json`, merge into player rows by lowercase fullName. Keep existing VBD sort + tap-to-draft (tDraft/tMine, localStorage). Add: tier break rows, badge chips, floor—proj—ceiling bar, click row to expand report. Existing styles: dark theme, `.badge`, `.pos-*` classes; row() at ~line 108, views.draft() at ~115, renderBody() search re-render at ~165 (slice(0,200) — bump to 300).
- After Actions run: `git pull`, verify on localhost:4650 (LaunchAgent always-on), then ASK Ethan before `vercel deploy --prod --yes` (deploys are confirm-first).

## Data sources (verified this session)

- **Current season (needs cookies):** own-league `kona_player_info`, filter `{players:{limit:300, sortDraftRanks:{sortPriority:1,sortAsc:true,value:'PPR'}}}`. Projections: statSourceId=1 && seasonId=2026; scoringPeriodId 0=season, N=week. `player.ownership.averageDraftPosition` = ADP.
- **Past seasons (NO cookies needed — verified live):** `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2025/segments/0/leaguedefaults/3?view=kona_player_info` with X-Fantasy-Filter `{"players":{"limit":500,"sortAppliedStatTotal":{"sortPriority":1,"sortAsc":false,"value":"002025"},"filterStatsForTopScoringPeriodIds":{"value":18,"additionalValue":["002025"]}}}` → per-week actual stats (statSourceId=0, statSplitTypeId=1, one entry per scoringPeriodId). Same for 2024. Match to current players by ESPN player `id` (stable across seasons). Compute per season: games played, total pts, PPG, weekly stdev (→ ceiling/floor base), targets/rec/carries (stat ids 58/53/23).
- **Depth charts:** Sleeper `https://api.sleeper.app/v1/players/nfl` (huge, fetch once) → `depth_chart_order`, `depth_chart_position`, `years_exp`, `injury_status`, `team`. Match by lowercase full_name (DST/suffix mismatches cosmetic). Per player, list same-NFL-team same-position competitors with their depth order → Claude judges touch-splitting.
- **Schedule:** `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026?view=proTeamSchedules_wl` → settings.proTeams[].proGamesByScoringPeriod (+ abbrev, id). Playoff opponents = weeks 15–17; bye week = missing scoringPeriodId. Abbrev map for Sleeper: WSH→WAS, JAX→JAC.
- proTeamId→abbrev needed to link ESPN player to Sleeper team.

## Claude prompt design (per batch)

System: expert PPR draft analyst. Given per-player data (2026 proj+ADP, 2024/2025 PPG+games+usage+variance, depth-chart competition, playoff schedule), for each player return: tier (1–8 within position, break = real dropoff), verdict (one line ≤120 chars: why this rank), report (3–5 sentences citing the data: trend interpretation, ceiling case, floor case, depth/schedule factors), floor + ceiling (season PPR points, ~15th/85th percentile outcomes), badges (from the fixed enum only). Pre-draft 2026: rosters empty is fine; past-season data is the substance.

## Gotchas carried forward

- `gh secret set` / `source .env` classifier-blocked → if secrets work needed, give Ethan `! command` one step at a time. (No new secrets needed for this task — reuse existing 6.)
- ESPN 401 = cookies expired → Ethan re-grabs from browser.
- Don't break server.js/index.html Vercel static-tracing (readFileSync at top, no dynamic paths).
- .gitignore has state.json; draft-analysis.json must NOT be gitignored (it's committed by Actions).
- Local dry-run pattern: script should do all free fetches + log sample prompt and exit gracefully when ANTHROPIC_API_KEY unset (worked well for waiver-alert; enables `node --env-file=.env scripts/draft-research.js` testing before the Actions run).
- Actions commit step: `git config user.name github-actions`, commit only draft-analysis.json, `git push`; guard "nothing to commit".

## Verification bar (Ethan's standard: observed, not "should work")

1. Local dry-run: fetches all 4 data sources, builds per-player data for 300 players, logs one sample batch prompt, exits clean.
2. `gh workflow run draft-research.yml` → logs show ~15 Claude calls OK, draft-analysis.json committed with 300 analyzed players.
3. `git pull`, open localhost:4650 draft board: tiers/badges/range bars render, a row expands to full report, tap-to-draft still works, search works.
4. Ask Ethan before Vercel prod deploy; after his yes: deploy + reload live URL.
5. After shipping: update project memory file, CLAUDE.md, and this file.
