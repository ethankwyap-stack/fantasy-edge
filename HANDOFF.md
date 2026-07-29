# Fantasy Edge — Handoff (Jul 29 2026, midday)

Project: `/Users/ethanyap/fantasy-edge`. **Read `CLAUDE.md` in that folder first** — stack, deploy steps, and a long Gotchas list. This file covers only what a fresh session needs beyond it.

## STATUS UPDATE (Jul 29 2026, evening) — option B is BUILT, SHIPPED, and CONFIRMED WORKING

**Everything below about option B being unbuilt is now historical.** It was built, deployed to
production, and Ethan confirmed it working in a live ESPN mock draft the same day.

- `bookmarklet.js` (readable source) + `scripts/build-bookmarklet.js` (prints the one-line
  `javascript:` URL for a Safari bookmark named `FE Sync`, already installed in his Favorites bar).
- `index.html` gained the cross-origin `message` listener with an `espn.com` origin check.
- **The cross-origin question is ANSWERED: `window.open` + `postMessage` works.** The clipboard
  fallback was never needed. Do not re-investigate this.
- Verified by Playwright serving a fake draft page on the real `https://fantasy.espn.com` origin:
  picks crossed off, unmatched names surfaced, non-ESPN messages rejected, second click reused
  the tab, board not clobbered by repeat messages. Then confirmed by Ethan on a real mock.
- **Per-draft workflow: Reset the board, then click `FE Sync`, then check the green badge.**
- **Still unverified: a real (non-mock) draft.** Same ESPN draft room expected; the badge is the
  check on the day, manual ✕ is the fallback.

See the CLAUDE.md Gotchas for the origin check, the render-only-on-change rule, and why synced
picks disappear rather than showing struck through. Remaining open item is unchanged: the ~$3
research run, on Ethan's explicit go-ahead only.

## TL;DR (historical — written before option B was built)

Ethan has **approved building one feature: "option B"** — a bookmarklet that runs inside his ESPN mock-draft tab, reads the picks off ESPN's page, and sends them to the Fantasy Edge draft board open in a second tab, so players cross off automatically and he stops tapping ✕ for every pick.

**Feasibility is now PROVEN, not assumed** (see "What was proven today"). The previous open question — can picks be read out of ESPN's page — is answered yes, by a console probe Ethan ran inside a live mock draft. **Do not re-test that.**

Nothing has been built yet. No app code changed today. Nothing needs deploying.

**The one unsolved design problem is cross-origin delivery** — the ESPN tab and the Fantasy Edge tab are different websites, so they cannot share `localStorage`. A recommended solution is written out below under "The next task." It is reasoned from the browser security model but **not yet tested** — verify it early, it is the load-bearing assumption.

## What was proven today

Ethan pasted a read-only diagnostic into Safari's JavaScript console **while inside a live ESPN mock draft** (league `2118343226`, teamId 1). He screenshotted the output. These are facts from that output, not inferences:

**ESPN's draft page renders every pick as ordinary DOM elements.**
- `.draft-board-grid-pick-cell` × 192 — the full board grid, 16 rounds × 12 teams.
- `.completedPick` — one per pick already made.
- Inside each `.completedPick`: `.pick-number` (text like `"1.1"`, `"6.1"` — that is round.pick), `.playerFirstName`, `.playerLastName`, `.playerProTeam` (`"DET"`, `"ARI"`, `"JAX"`).

This extraction ran and returned real data:
```js
[...document.querySelectorAll('.completedPick')].map(el => {
  const t = s => (el.querySelector(s)?.textContent || '').trim();
  return { pick: t('.pick-number'), player: t('.playerFirstName') + ' ' + t('.playerLastName'), team: t('.playerProTeam') };
})
```
Sample of what came back: `1.1 Jahmyr Gibbs DET`, `2.12 Trey McBride ARI`, `3.1 Josh Jacobs GB`, `6.1 Bhayshul Tuten JAX`.

**It updates itself live.** The first probe found **54** completed picks; the second, ~3 minutes later **in the same tab with no reload**, found **63**. ESPN keeps that grid current on its own, so a bookmarklet only has to re-read the DOM on a timer. No websocket, no network call, no extra connection — therefore **no risk of disconnecting Ethan**, which was the hard constraint that killed every earlier design.

**Two traps found in that same output:**
- `el.innerText` on a `.completedPick` returns `""` (the cells are off-screen / not laid out). Read the **child elements' `textContent`**, never `innerText`, or you get empty strings and it will look like the whole approach failed.
- The player list lower on the page uses **virtualized** `fixedDataTable*` rows — only visible rows exist in the DOM. Do not read picks from there. The board grid is fully rendered; the table is not.

## What is still PROVEN IMPOSSIBLE — do not revive

Carried forward from the previous session, all established by real commands:

- **ESPN's REST API never exposes mock-draft picks.** `.../seasons/2026/segments/0/leagues/{ID}?view=mDraftDetail` returns HTTP 200 with Ethan's cookies, but `picksMade` stays `0` forever — during the draft (~110 polls) and after it ends. Not replica lag, not hiding in `mRoster`/`mTeam`. **Do not re-test polling.**
- **Mock leagues get deleted afterwards**, so importing a finished mock is also impossible.
- **Fantasy Edge must NEVER open its own connection to a draft websocket.** ESPN allows one connection per team and kicks the older one. A Playwright session joining as Ethan **disconnected him from his own live draft** — he confirmed it happened. He then stated a hard requirement: *"during the actual mock draft when this site works and can connect i cannot be disconnected."* The bookmarklet is acceptable precisely because it opens **zero** connections.
- A raw Node `WebSocket` to ESPN's draft server is rejected (close code 1006) — it needs browser headers. Irrelevant now, recorded so nobody retries it.

## Verified state (every row checked by command, Jul 29 midday)

| Thing | State |
|---|---|
| Branch / HEAD | `main` at `f925230`. Working tree **not clean** — see "Uncommitted work" below |
| App code | **Unchanged today.** Today was investigation only |
| Local server | Running, port 4650, PID 45962. `curl http://localhost:4650/` returns **401** = secret gate working correctly |
| Live site | `https://fantasy-edge-lyart.vercel.app` returns **401** to a bare request = correct. Untouched today, nothing to deploy |
| Stray listeners | **None.** `pgrep` for `sniff`/`wslisten`/`poll.sh` returns nothing. Ethan's ESPN connection slot is free |
| Secrets | `.env` locally (gitignored): `LEAGUE_ID`, `ESPN_S2`, `SWID`, `APP_SECRET`. `ANTHROPIC_API_KEY` exists ONLY as a GitHub repo secret, deliberately |
| Cost | Everything today was free (browser console reads). Vercel free, Actions free, ESPN/Sleeper/nflverse free. Only spend in the whole project is ~$3 per manual `draft-research` run |

Ethan's ESPN identity, needed for draft URLs: SWID `{25A17E71-A2D2-40A8-9E59-02C0A821495E}`. **League IDs change every single mock** (seen: `1413280972`, `1508486820`, `2118343226`) — never hardcode one. His mock draft URL needs all four params or ESPN shows "Page not found": `https://fantasy.espn.com/football/draft?leagueId={ID}&seasonId=2026&teamId={N}&memberId={SWID}`.

## How the draft board stores picks (read from `index.html` today)

The bookmarklet has to end up affecting these, so here is the exact shape:

- `index.html:78` — app state `S`, with `S.drafted = new Set(JSON.parse(localStorage.d || '[]'))` and `S.mine` from `localStorage.m`.
- `index.html:173` — `toggle(set, key, id)` writes the set back to `localStorage[key]` and calls `render()`.
- `index.html:174` — `window.tDraft = id => toggle(S.drafted, 'd', id)` — this is what tapping ✕ calls.
- Players are keyed by **ESPN numeric player id** (`p.id`), and each has `p.fullName`.
- **Precedent for name matching:** Sleeper trending players are already matched to ESPN players by lowercase full name (see CLAUDE.md Gotchas). ESPN's own draft page supplies the names, so matching should be cleaner than Sleeper's, but expect misses on suffixes (`Luther Burden III`) and D/ST. Report unmatched names visibly rather than silently dropping picks — a silently missed pick is worse than manual tapping.

## The next task — build option B

**The problem to solve first, before writing anything else:** the ESPN tab is on `fantasy.espn.com` and the Fantasy Edge tab is on `fantasy-edge-lyart.vercel.app` (or `localhost:4650`). Different origins. **The bookmarklet cannot write to Fantasy Edge's `localStorage` directly** — the browser forbids it. This is the whole difficulty of option B and it must be settled before any UI work.

**Recommended design (reasoned, NOT yet tested — verify this first):**
1. The bookmarklet, on its first click, calls `window.open('<fantasy-edge-url>?key=<APP_SECRET>', 'fe')` and keeps the returned window handle. A named window means clicking again reuses the same tab instead of spawning new ones. A bookmarklet click is a real user gesture, so the popup blocker should allow it — confirm that.
2. On a timer (every ~2s), it re-scrapes `.completedPick` and calls `handle.postMessage(picks, '<fantasy-edge-origin>')`. `postMessage` is the sanctioned way to send data across origins.
3. `index.html` gains a `window.addEventListener('message', ...)` that **checks `event.origin`**, maps incoming names to player ids, and adds them to `S.drafted`.

If `window.open`/`postMessage` turns out not to work, the fallback that definitely works: the bookmarklet copies a compact pick list to the clipboard and Fantasy Edge grows a paste box. Cruder, one manual step per refresh, zero unknowns.

**Constraints on the build:**
- **Test only on a throwaway mock**, never a draft Ethan cares about. Reading the DOM cannot disconnect him, but a bug that opens a connection could.
- Origin check on the message listener is not optional — without it any website could inject fake picks into his board.
- Ethan already has the `.completedPick` selectors confirmed on the real page; trust them over guessing at ESPN's markup.
- Keep the manual ✕ tapping working. The bookmarklet is an addition, not a replacement — if the sync breaks mid-draft he needs the fallback in the same session.

## Uncommitted work from an EARLIER session — do not assume it's yours

`git status` shows modifications to `CLAUDE.md`, `index.html`, `scripts/draft-research.js`, plus untracked `expert-sleepers.json`. **None of it is from today or from the session before it.** Judging by the CLAUDE.md Gotchas these are the top-450 draft pool, the long-press sleeper mark, and the expert-sleeper consensus file. They look finished but were never committed. **Ask Ethan before committing them** — and note that any bookmarklet work will add more changes to `index.html` on top of these.

## Gotchas

- **`server.js` reads `index.html` once at startup.** Editing `index.html` changes nothing on `localhost:4650` until restart — a headless test once reported a new button as MISSING purely because of this, and it looked like broken code. Fix: `lsof -ti:4650 | xargs kill`, launchd restarts it in ~2 seconds.
- **Never connect programmatically to a draft Ethan is in** — it kicks him out. If any listener is ever running: `pkill -f sniff2.js; pkill -f wslisten.js`.
- Read `.completedPick` children with `textContent`; `innerText` returns `""` there.
- Headless tests of Fantasy Edge must load `http://localhost:4650/?key=<APP_SECRET>` or every route 401s.
- **playwright-core lives at `/Users/ethanyap/.npm/_npx/e41f203b7505f1fb/node_modules/playwright-core`**, NOT `/opt/homebrew/lib/node_modules`. Launch with `chromium.launch({channel:'chrome'})`.
- **Ethan uses Safari**, not Chrome. Its console is `Option+Cmd+C`, and it only works when a web page window is frontmost — greyed-out Develop menu items mean the Settings window still has focus. He will need the bookmarklet installed in Safari's Favorites bar.
- **Never put `ANTHROPIC_API_KEY` in `.env`.** The paid run lives in GitHub Actions by design. Locally the research script dry-runs — intended, not a failure.
- ESPN's news feed is capped at 50 articles upstream and per-team news returns empty, so only ~31 of 300 players get headlines. The prompt tells the model not to treat missing news as negative — keep that guard.
- nflverse downloads are slow and flaky; the 8 MB weekly file has timed out at 120s. `csvRows()` returns null and degrades loudly rather than aborting a paid run. **Preserve that for any new download.**
- nflverse URLs use the release **TAG**, not the file family: `releases/download/pfr_advstats/advstats_week_rush_2025.csv`.
- Piping the research dry run through `head` kills node via SIGPIPE and looks like the feature produced nothing. Write to a file, then grep it.
- `draft-analysis.json` must never be gitignored — the Action commits it.
- Vercel file tracing: `server.js` must read `index.html` and `draft-analysis.json` with static `readFileSync(path.join(__dirname, ...))`.

## The other open item — the paid research run

Unchanged: refreshing ranks costs roughly **$3** and only Ethan decides when. **Do not trigger it, do not "just check" it.**

When he says go: 1) `gh workflow run draft-research.yml` (~25 min, ~$3). 2) `git pull`. 3) `vercel deploy --prod --yes` — **ask first**. 4) Open the live site with the key, tap a row, confirm the report timestamp is new.

Worth doing within a few days of his real draft, since depth charts and camp news move a lot in August.

## Don't redo

Draft board with tiers, reports, floor/ceiling bars, badges, filters, snake pick tracker. The research pipeline and its workflow. The hourly Telegram waiver alert. The secret-link gate. The ESPN injuries/news proxy and Sleeper caching. The Smyth volume/efficiency metrics. **The Reset button already exists** at `index.html:319`. **"Mock mode" was built and deliberately reverted** — he decided the Reset button covers it; do not rebuild it. **The REST-polling approach to mock drafts is disproven.** **The DOM-readability question is answered yes** — do not re-probe it.

Ideas already declined at zero cost: red-zone/goal-line usage (nflverse play-by-play, 100 MB+ per season) and true routes run (paid data).

## How to work with Ethan

College student learning development, not fluent in git or deployment — give terminal and browser steps **one at a time**, say what he should see, and wait for his confirmation or screenshot before the next step. He uses **Safari**. **Cost is his biggest anxiety**: name every service and whether it can ever bill him, never say "probably free," never spend the $3 without an explicit go-ahead. Never claim something works without having exercised it. Lead every reply with the outcome. Confirm before deploys, deletes, or anything outward-facing. He changes direction mid-task — when he does, revert cleanly rather than leaving half-built features behind. He gets impatient with long waits, so prefer one decisive test over a passive poll.
