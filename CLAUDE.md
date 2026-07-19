# Fantasy Edge

ESPN fantasy football (PPR, private league) helper suite: draft board (VBD, manual tap), start/sit, waiver finder w/ Sleeper trending, trade finder. Zero cost.

## Stack
Plain HTML/JS single page (`index.html`), Node proxy for ESPN cookies (`api/espn.js`, Vercel-function-shaped), local server `server.js`, daily Telegram waiver alert via GitHub Actions.

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
