# Fantasy Edge — Session Handoff (Jul 19 2026)

ESPN fantasy football helper suite for Ethan's private PPR league (ID 916578979, Ethan = team 1, 12 teams, pre-draft). Repo: `~/fantasy-edge`. Read `~/fantasy-edge/CLAUDE.md` for stack + gotchas.

## What's DONE and verified
- **Live dashboard: https://fantasy-edge-lyart.vercel.app** (Vercel team `ethan16`, project `fantasy-edge`). Verified headlessly: 200 draft-board players render from the real league. Auto-refreshes every 5 min.
- 4 tabs: Draft board (VBD rankings, manual tap ✕/★), Start/Sit (empty until draft — expected), Waivers (Sleeper trending matched to league), Trades (all zeros until draft — expected).
- ESPN cookies + league ID in gitignored `.env` (SWID, ESPN_S2, LEAGUE_ID, SEASON=2026); same values set as Vercel production env vars.
- Claude-judged Telegram alert written: `scripts/waiver-alert.js` + `.github/workflows/waiver-alert.yml` (daily 7am PT, Opus 4.8, ~1–3¢/day). Committed locally, NOT yet running.
- LaunchAgent plist created: `~/Library/LaunchAgents/com.ethanyap.fantasy-edge.plist` (always-on localhost:4650). NOT yet loaded.
- Two local commits exist; no remote yet.

## REMAINING STEPS
None — all completed Jul 19 2026. Repo pushed (github.com/ethankwyap-stack/fantasy-edge), LaunchAgent loaded (localhost:4650 → 200), all 6 secrets set (new dedicated "Fantasy Bot" instead of reusing stock-agent's finance bot; fresh Anthropic key), workflow test run succeeded and Telegram message received.

## Key gotchas (also in CLAUDE.md)
- ESPN projections: `stats[]` entry with `statSourceId=1 && seasonId=2026`; `scoringPeriodId=0` = season, `=N` = week N. Without the seasonId filter you grab last season.
- Vercel build requires `server.js` entrypoint and only bundles traced files — index.html is loaded via static `readFileSync(path.join(__dirname,...))`. Don't make that dynamic. `.vercelignore` excludes `.env`.
- ESPN cookies expire ~yearly → 401 means re-grab from browser (Application → Cookies). Cookies were pasted in chat once; rotating later (log out/in of ESPN) is wise.
- Long secrets from Ethan: ask for a real Cmd+C paste — a screenshot/Live-Text paste once produced Cyrillic lookalike characters.
- Headless verification: playwright-core + system Chrome (`channel:'chrome'`), no chromium download needed.
