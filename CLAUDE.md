# Fantasy Edge

ESPN fantasy football (PPR, private league) helper suite: draft board (VBD, manual tap), start/sit, waiver finder w/ Sleeper trending, trade finder. Zero cost.

## Stack
Plain HTML/JS single page (`index.html`), Node proxy for ESPN cookies (`api/espn.js`, Vercel-function-shaped), local server `server.js`, hourly (7am–9pm PT) change-driven Telegram waiver alert via GitHub Actions — diffs Sleeper trending + roster injuries against state.json (actions/cache) and only calls Claude on changes; dedups sent advice.

## Live deployment
LIVE at https://fantasy-edge-lyart.vercel.app (Vercel team scope `ethan16`, project fantasy-edge; env vars LEAGUE_ID, ESPN_S2, SWID, SEASON set in production). Deploy: `vercel deploy --prod --yes`. Alerts: GitHub Actions secrets (same + ANTHROPIC_API_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID — reuse stock-agent bot; note stock-agent names its token secret TELEGRAM_TOKEN).

## Local run
`node server.js` → http://localhost:4650. Needs `.env` with LEAGUE_ID, ESPN_S2, SWID.

## Gotchas
- Vercel's build REQUIRES a server entrypoint (server.js) and only bundles files it can trace — index.html is loaded via a static `readFileSync(path.join(__dirname,...))` at module top so it gets included. Don't switch to dynamic file paths.
- `.vercelignore` excludes `.env`; secrets live in Vercel env vars, not files.
- server.js listens on `process.env.PORT || 4650` — Vercel injects PORT.
- ESPN private league needs cookies SWID (with curly braces) and espn_s2 from browser dev tools on fantasy.espn.com. They expire ~yearly; if API returns 401, re-grab them.
- ESPN player projections: `stats[]` entry with `statSourceId=1` AND `seasonId=2026`; `scoringPeriodId=0` = season total, `=N` = week N. Verified live Jul 19 2026. Without the seasonId filter you can grab LAST season's entry.
- League is pre-draft (Jul 2026): rosters empty, so Start/Sit shows an empty-state note and Trades shows all zeros until draft day. Expected, not a bug.
- Headless verification: playwright-core + system Chrome (`channel:'chrome'`), driver at scratchpad drive.js pattern.
- Sleeper trending players matched to ESPN by lowercase full name — DST/name-suffix mismatches expected, cosmetic only.
- Draft board state (drafted/mine) lives in localStorage only.
- Alert state (state.json: trending ids, injury map, sent-advice hashes) persists between Actions runs via actions/cache (`key: waiver-state-${{ github.run_id }}` + restore-keys prefix). Gitignored; delete it locally to force a "first run".
- waiver-alert.js dry-runs without ANTHROPIC_API_KEY (`node --env-file=.env scripts/waiver-alert.js`): does all free fetches, logs the prompt, saves state, stops before Claude.
- Alert cron is PDT-pinned UTC (`0 14-23,0-4`); drifts 1h after the Nov PST switch — accepted.
- ESPN weekly actuals: `statSourceId=0`, stat ids 58=targets, 53=receptions, 23=rush att; use X-Fantasy-Filter `filterStatsForTopScoringPeriodIds` on kona_player_info. NFL schedules: `seasons/{yr}?view=proTeamSchedules_wl` → proTeams[].proGamesByScoringPeriod.
- Secret-link gate: `/?key=$APP_SECRET` (in `.env` + Vercel env) sets HttpOnly cookie `fe_key`; all routes incl. /api/espn 401 without it. New device/browser needs the full link once.
- Sleeper full-player dump (~5MB) is cached in localStorage (`sn2`, 24h TTL) as id→[name,age,exp,depthOrder,injuryStatus,team], trimmed to active QB/RB/WR/TE/K/DEF (~3.2k players, 125KB — smaller than the old name-only `sn`). Cache key MUST be bumped whenever that row shape changes, or stale entries deserialize as the wrong type.
- `/api/nfl?feed=injuries|news` (api/nfl.js) proxies ESPN's free public site API — no key, no account. Injuries is ~9MB raw so it's slimmed server-side to ~184KB (name→status/note/date) and memory-cached 1h; on fetch failure it serves stale rather than blanking. News carries ESPN's athlete tags, so headlines map to players.
- draft-research.js also pulls nflverse weekly CSVs (target share, air-yards share, WOPR, EPA, CPOE) — free GitHub release files, no key. It tries the current season first and falls back to last season, so the same code works in-season once games are played. Negative air-yards share is real nflverse output (behind-the-LOS targets), not a parse bug.
- If localhost:4650 misbehaves after a code change: check `lsof -ti:4650` for an orphaned `node server.js` (PPID 1) blocking the KeepAlive LaunchAgent (`launchctl list` shows exit 1). Kill the orphan; launchd restarts fresh.
