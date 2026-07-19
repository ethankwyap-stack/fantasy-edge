# Fantasy Edge — Build Handoff (written Jul 19 2026)

Read `~/fantasy-edge/CLAUDE.md` first (stack + gotchas). This file specs ONE task: upgrade the daily Telegram waiver alert into an hourly, change-driven, deep-analysis alert. Ethan has already approved this exact scope — build it, verify it, don't re-ask.

## Current state (all verified working)

- Repo `~/fantasy-edge`, pushed to private github.com/ethankwyap-stack/fantasy-edge.
- Live dashboard: https://fantasy-edge-lyart.vercel.app; always-on localhost:4650 via LaunchAgent.
- `scripts/waiver-alert.js` + `.github/workflows/waiver-alert.yml`: runs daily 7am PT (cron `0 14 * * *`), gathers roster + Sleeper trending + ESPN season projections, Claude (claude-opus-4-8, adaptive thinking) recommends moves with a conviction 1–5 score, only sends Telegram if something scores 4+, replies exactly `NO_ALERT` otherwise and the script skips sending. Last test run: success, correctly stayed silent (pre-draft).
- All 6 repo secrets set: LEAGUE_ID, SWID, ESPN_S2, ANTHROPIC_API_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID. Dedicated bot "Fantasy Bot" (NOT stock-agent's finance bot), Ethan's chat_id 8183709698.
- League: ID 916578979, Ethan = team 1 (MY_TEAM_ID env, default '1'), 12 teams, PPR, **pre-draft** — rosters empty, no games played, so most in-season data will be empty until the season starts. Build with graceful empty handling; that's expected, not a bug.

## What to build (Ethan's decided choices — do not re-litigate)

1. **Hourly change-detection loop, 7am–9pm PT** (his pick). Cron `0 14-23,0-4 * * *` UTC (PDT offset; drifts 1h after Nov PST switch — acceptable, note with a `ponytail:` comment). Each run:
   - Fetch free data first (ESPN league + Sleeper trending + injuries). NO Claude call yet.
   - Diff against `state.json` cached between runs via actions/cache (stock-agent pattern: `key: waiver-state-${{ github.run_id }}`, `restore-keys: waiver-state-`). Changes that count: new player entering Sleeper trending top-40, injury-status change on Ethan's roster.
   - No changes → log and exit ($0, no API call). Changes → build enriched prompt → Claude → conviction-4+ gate (keep existing NO_ALERT mechanism).
   - **Dedup**: hash each sent recommendation into state.json; never re-send the same advice on later runs.
2. **Data enrichment for the Claude prompt** (already promised to Ethan):
   - Targets/touches last 3 weeks per candidate (PPR core). ESPN stat IDs: 58=targets, 53=receptions, 23=rush attempts; actuals are `statSourceId=0`, weekly = `scoringPeriodId=N`. Use X-Fantasy-Filter `filterStatsForTopScoringPeriodIds` on kona_player_info to get recent weeks.
   - Opponent strength: league view `mPositionalRatings` (fantasy points allowed vs position per pro team) — verify the view returns data; if empty preseason, omit lines gracefully.
   - Upcoming + playoff (weeks 15–17) schedule: `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026?view=proTeamSchedules_wl` → proTeams[].proGamesByScoringPeriod.
   - Trend: this-week projection vs rest-of-season pace.
3. **Rival awareness** (his pick): from the existing mTeam,mRoster fetch, compute each rival team's positional counts/thinness → warn when a rival likely wants the same pickup; handcuff detection = Sleeper `all` players data has `depth_chart_order`/`team` — flag unrostered RB2s on the same NFL team as Ethan's starting RBs as stash candidates.
4. **Buy-low/sell-high trade signals** (his pick): league-wide rostered players where actual PPG diverges most from projected PPG (top ~5 each way) → prompt lines; Claude may recommend trade targets. In-season only, empty pre-draft.
5. Keep: conviction-4+ system prompt (extend it to allow trade-signal and handcuff-stash move types), terse no-markdown phone format, existing send/skip logic.

## Verification bar (Ethan's standard: observed working, not "should work")

- Run the workflow live (`gh workflow run waiver-alert.yml`), read logs: first run seeds state (everything "new" → Claude call OK), second dispatch immediately after must exit at the diff gate with no Claude call. Both observed = done.
- Pre-draft the enrichment lines will be mostly empty — verify they render without crashing (log the built prompt).
- Local test possible: `cd ~/fantasy-edge && node scripts/waiver-alert.js` with `.env` (has ESPN values; ANTHROPIC/TELEGRAM vars are NOT in .env — repo secrets only), so full end-to-end only via Actions.

## Gotchas carried forward

- ESPN projections: `statSourceId=1 && seasonId=2026`; `scoringPeriodId=0`=season. Without seasonId you grab last season.
- ESPN 401 = cookies expired → Ethan re-grabs from browser.
- `gh secret set`/`source .env` are classifier-blocked for the agent — if secrets work is needed, give Ethan a `! command` to run himself, one step at a time.
- Sleeper→ESPN name match is lowercase full-name; DST mismatches cosmetic.
- Don't touch server.js/index.html Vercel tracing (static readFileSync — see CLAUDE.md).
- After shipping: update `~/.claude/projects/-Users-ethanyap/memory/project_fantasy_edge.md`, this file, and CLAUDE.md.
