# Fantasy Edge — Handoff (Aug 13 2026, session 4)

Project: `/Users/ethanyap/fantasy-edge`. **Read `CLAUDE.md` in that folder first** — stack, deploy steps, and a long Gotchas list this file does not repeat.

Previous handoff archived at `handoff-archive/2026-08-13d.md`. Everything from it that is still true is carried forward below — **do not go read it**. It describes nine completed analyses and an empty queue; that is still accurate, and this session added two shipped in-season *tools* on top (not analyses).

Note the file is `HANDOFF.md` (uppercase) in git. macOS is case-insensitive so `handoff.md` also resolves — don't create a second lowercase copy, you'll be editing the same tracked file.

Ethan's standing goal for this line of work, in his words: **"rigorous data analytics" that "translate to winning results."** Actionable findings tied to a decision he can make, not trivia.

---

## TL;DR

1. **Everything from this session is BUILT, VERIFIED, COMMITTED, PUSHED, and LIVE.** Three commits: `391ab36`, `9647fee`, `8d58a8c`. Nothing is half-done. `[verified — git log, live curl]`
2. **Two new things exist:** (a) `scripts/lineup-alert.js` — a Sunday cron that Telegrams him when his set lineup is worse than the optimal one; (b) the Start/Sit tab is now a **win-probability** tab, not a projection list.
3. **A third, smaller piece:** K/D-ST week-to-week variance is now *measured* from ESPN weekly actuals (`league-history.js --kdst-variance`, study 10) and feeds the win-probability math.
4. **The nine prior analyses are untouched and still correct. Do not redo any.**
5. **Nothing is blocked on Ethan.** No decision pending.
6. **He asked for the to-do list and then ended the session.** The four candidate next items are in "The next task" below — he did NOT pick one. **Ask, don't guess.**

---

## What was accomplished this session

He opened with "these tests are really insightful, are there any other deeper analysis stuff you can do that will definitely benefit me this year." I proposed five in-season ideas ranked by decision impact. He picked **#2 then #1**, in that order, explicitly.

### Thing 1 — `scripts/lineup-alert.js` (the Sunday guardrail)

**Why this one first:** the 2025 postmortem's headline failure was *deployment*, not acquisition — 222.4 points left on the bench, and only 26% of the points his own waiver pickups produced ever got started (worst in the league). That is a "forgot on Sunday" problem, which a diagnosis cannot fix and an alert can.

- Reads the lineup ESPN **currently has set**, builds the best legal lineup off this week's projections, alerts only when the gap clears `MIN_GAP` (default 5 pts, env-overridable).
- Reuses `bestLineup()` from `league-history.js` rather than reimplementing it.
- `.github/workflows/lineup-alert.yml` — Sundays `0 14 * * 0` and `30 16 * * 0` UTC (10am / 12:30pm ET, both pre-kickoff). Thursday/Monday deliberately not covered.
- State in `lineup-state.json` (gitignored, actions/cache) — one advice signature per week, so identical advice never re-fires but changed advice does.
- `--selftest` passes (7 assertions, no network). Live dry run on his real roster: **Week 1, 0 locked, +0 pts — his lineup is already optimal, no alert.** `[verified — ran both]`

### Thing 2 — Start/Sit became a win-probability tab (`index.html`)

**The argument:** the league seeds **record-first** (points are only the tiebreaker — this is already in CLAUDE.md and was verified against 2025 final standings). So the real question a start/sit decision answers is "does this raise my chance of winning THIS matchup", not "does this raise my projected total". The two disagree exactly when the matchup is lopsided: a favourite wants the floor, an underdog needs the spike.

- Both sides modelled `Normal(Σ weekly projections, Σ per-player variance)`; win% = normal CDF (A&S 7.1.26 erf approximation) on the difference.
- Volatility is a **coefficient of variation (sd/mean)** applied to this week's projection — the ratio transfers across seasons, the absolute sd does not.
- `boom-rates.js` now writes a per-player `sd` (sample, n−1; `null` for a 1-game player).
- Needed `mMatchup` added to the `espn()` view list in `load()`; `oppOf()` keys on `matchupPeriodId`.
- Headline gives him his stance in words ("You're a 57.5% favourite — protect the floor" / "You're a 3.3% underdog — you need variance").
- Table below lists only swaps where the two currencies **disagree**.

### Thing 3 — measured K/D-ST variance (study 10)

He then asked "why is kicker and dst out", and after I explained, "would it be stronger to include it or no". Straight answer: **yes**, because omitting them is not neutral — it asserts cv 0 on two roster spots, which understates spread and makes every win probability overconfident.

- New `league-history.js --kdst-variance`: walks all 14 weeks of 2025 league rosters, reads ESPN weekly actuals for every rostered K and D/ST.
- **Result: K cv 0.568 (mean 8.6, sd 4.9, n=188 games played). D/ST cv 0.919 (mean 7.3, sd 6.7, n=220).** The defense is the swingiest slot on the roster, bigger than any skill position. `[verified — ran it]`
- **Effect on his Week 1 read: 57.5% → 54.5%**, toward the coin flip, exactly the predicted direction. An assert pins that direction.
- Positional, not per-player, on purpose: K and D/ST get streamed, so a per-player rate is precision he can't use.
- Lands in `boom-rates.json` under `posVar` (the only data file the browser already fetches — no new server route, no new fetch).

---

## State

| Thing | State | Confidence |
|---|---|---|
| Git | Clean, 3 commits pushed to `origin/main` this session (`391ab36`, `9647fee`, `8d58a8c`), plus this handoff. | [verified — `git log`, push output] |
| Live site | `https://fantasy-edge-lyart.vercel.app` — auto-deployed on push. Confirmed the new code is actually serving (grepped live HTML for `kdstDist`, and `/boom-rates.json` returns the `posVar` block). | [verified — curl with cookie jar] |
| `scripts/lineup-alert.js` | New, 150 lines. `--selftest` passes. Live dry run clean. | [verified] |
| `.github/workflows/lineup-alert.yml` | New. **Has never actually fired** — first real run is the coming Sunday 14:00 UTC. | [unverified — check the Actions tab after Sunday] |
| GitHub secret `SEASON` | **Probably does not exist** — `waiver-alert.yml` doesn't use it. The script falls back to `new Date().getFullYear()` = 2026, which is correct, so this is harmless. | [unverified — never listed the secrets] |
| `index.html` | Start/Sit rewritten. All `console.assert` blocks pass in a real browser, zero page errors. | [verified — headless Chrome] |
| `scripts/boom-rates.js` | Two edits: writes per-player `sd`; **carries forward the `posVar` key** on regen. `--selftest` passes. | [verified — ran, and confirmed posVar survives a full regen] |
| `scripts/league-history.js` | **10 studies now.** `--kdst-variance` added; `weeklyRosters()` rows gained a `played` flag; the whole CLI IIFE is now behind `require.main === module` and the file exports `{bestLineup, SLOT, STARTABLE}`. `--selftest` passes. | [verified — ran] |
| `boom-rates.json` | Regenerated. 621 players, season 2025, `stale: true`, pool matched **323**/386 (was 322 — normal drift, not a bug). Now carries `sd` per player and top-level `posVar`. | [verified] |
| `league-history-2025.json` | Merged, now holds 10 studies + `generated`. | [verified — merge path exercised] |
| `playwright-core` | Installed with `--no-save`, so it is in `node_modules` but **NOT in `package.json`**. A fresh clone won't have it. This is deliberate (keeps it out of the Vercel bundle). | [verified] |
| Local server | LaunchAgent on port 4650, restarted several times this session via `kill $(lsof -ti:4650)`. Serving current code. | [verified] |
| Cost | Zero. ESPN API + nflverse GitHub release files. No new keys, no new services. | [verified] |

---

## Where my thinking was

**On why the Sunday alert came before the clever one.** He asked for both, and I built them in his stated order, but the ordering was also right on merit: the alert attacks a *measured, expensive, repeated* failure (222 bench points) with about 150 lines. The win-probability tab is more interesting and less certain to pay off. If a future session has to choose what to protect, protect the alert.

**On the shape of the win-probability recommendations, which looks like a bug and isn't.** From a points-optimal lineup, *every* legal swap costs projected points — by definition, since the lineup was chosen to maximise points. So the tab's only possible recommendation is "give up X points to buy Y% win probability." My first selftest fixture asserted the opposite (a swap that gains points AND win prob) and failed, which is how I noticed. The fixture now asserts the correct direction. **Do not "fix" the tab so it shows points-positive swaps — there aren't any.**

**On the independence assumption.** Players are treated as uncorrelated. A QB+WR stack is genuinely correlated, which understates variance for stacked lineups. I left it because he doesn't currently stack on purpose, and there's a `ponytail:` comment saying so. If he ever drafts/starts a stack deliberately, this is the first thing to revisit.

**On the locked-player rule in the alert.** LOCKED = the player already has a week-N actual stats entry (`statSourceId: 0`). That catches anyone whose game has finished. It does **not** distinguish "hasn't kicked off" from "playing right now, zero points so far" — ESPN publishes the entry at kickoff. This is safe **only because the cron runs before the 1pm ET window.** If anyone ever moves that cron later, this becomes a real bug that will tell him to bench a player mid-game.

**On what I did not verify.** The alert has never fired for real — no Telegram message has ever been sent by it. The dry run proved the fetch, the math, and the state file, and stopped before the send because `TELEGRAM_BOT_TOKEN` isn't in the local `.env`. The Telegram send path itself is copied from `trade-alert.js`, which does work. `[unverified — the actual send]`

**On the 322 → 323 pool-match drift.** `boom-rates.json` now matches 323 of 386 rather than the 322 documented in CLAUDE.md. I did not chase it. It moved when I regenerated the file from a freshly downloaded nflverse CSV, so the most likely explanation is that nflverse added a row upstream. Harmless either way (absence casts no vote), but it's the kind of thing that looks alarming later.

**One thing that smelled and I didn't chase.** `weekProj()` in `index.html` hardcodes `s.seasonId===2026` as a literal rather than reading a constant. It's correct today and I added the `statSplitTypeId===1` filter next to it, but it will silently return 0 for every player in 2027.

---

## For the next session to figure out

- **Does the Sunday alert actually fire and send?** First real run is the coming Sunday 14:00 UTC. Check the Actions tab. If it failed, the likeliest causes in order: a missing GitHub secret, ESPN cookies expired (401), or the cache step not restoring `lineup-state.json`.
- **Is `MIN_GAP = 5` the right threshold?** Pure guess, not derived. Too low and he mutes it; too high and it misses real losses. There is now data to derive it from — 2025's per-week optimal-vs-actual gaps are already computed in `--bench-audit`. Nobody has looked.
- **Is the normal distribution the right model for a weekly fantasy total?** Real weekly scores are right-skewed, so a normal probably slightly understates the underdog's tail — which would mean the tab is *marginally* too discouraging about chasing variance. Not measured. Would need a backtest against 2025 weekly matchups, which is genuinely possible with data already on disk.

---

## The decision still open

**None.** He made every call this session (build #2 then #1; yes to including K/DST). Nothing is waiting on him.

---

## Gotchas

**Lead item, the one that would have bitten silently:**

- **`boom-rates.json` is fully regenerated every Tuesday by `.github/workflows/refresh-data.yml`.** The K/D-ST variance (`posVar`) is written into that file by a *different* script (`league-history.js --kdst-variance`) because nflverse's weekly file has **no K or D/ST rows at all**. Without a carry-forward, the Tuesday cron would wipe it, and the Start/Sit tab would quietly revert to treating those two slots as certainties — no error, no visible sign, just a subtly overconfident number. `boom-rates.js` now preserves the key on regen and I confirmed it survives. **Keep that carry-forward.**

**New this session:**

- **A weekly ESPN projection is `statSplitTypeId: 1`, NOT 0.** Same seasonId / statSourceId / scoringPeriodId, different aggregation — 0 is the season total. Taking the wrong one is a silent ~20x error. (Related but distinct from the existing season-total trap where 0 = total and 2 = per-game.) Verified live: Bijan Robinson wk1 = 19.28 at split 1; his season total = 352.97 at split 0.
- **`league-history.js` and `boom-rates.js` are now importable; `draft-research.js` still is not.** Both are behind `require.main === module`. `lineup-alert.js` imports `bestLineup` and would otherwise kick off a full 10-study ESPN run on require. Keep the guard.
- **`weekPts()` returns 0 for both "played and scored 0" and "no game at all."** A D/ST can legitimately score 0 or negative, so a `pts > 0` filter biases the mean up. That's why `weeklyRosters()` rows now carry an explicit `played` flag.
- **`teamName()` in `index.html` takes a team OBJECT, not an id.** I wrote `teamName(oppId)` first and got `undefined` in the heading.
- **Local verification needs `playwright-core`, and the driver script must live inside the repo** — a script in the scratchpad can't resolve the module from `node_modules`. Copy it to `.drive.tmp.js` in the repo root, run it, delete it.
- **The live site 302-redirects the `?key=` link** (it sets the cookie then bounces to `/`). A plain `curl` gets an empty 302 body; use `curl -sL -c /tmp/cj -b /tmp/cj`.

**Carried forward, still true (full list in CLAUDE.md):**

- **`site/2025-postmortem.html` has TWO homes that do not sync.** Repo copy ships via `git push`; the artifact needs a separate `Artifact` call passing `url: https://claude.ai/code/artifact/5040c067-4f88-47c9-93e5-602df3f80bad`. Publishing without that `url` creates a *separate* artifact. Ethan has hit this confusion directly before.
- **That file is artifact-shaped on purpose** — no doctype, no `<head>`. The server route sends `charset=utf-8` explicitly; without it the 🤤 and every en-dash render as mojibake. Don't "fix" it by adding a doctype.
- **`playerPoolEntry.appliedStatTotal` on a week-scoped `mRoster` call is CUMULATIVE season-to-date.** Use `weekPts()`. Sanity-check any team-season total against the known 1731.8 figure.
- **`statSplitTypeId` is a fourth stat discriminator** — for *season* entries 0 = total, 2 = per game; a silent ~20x error.
- **Any function reading ESPN `stats[]` MUST filter `seasonId`.**
- **Trade contents are participant-only**; league-wide trade net-points is impossible. This also proves Ethan is **team id 1**.
- **2025 was not a FAAB league.** No bid data exists, don't look. 2026 IS FAAB ($1000, $1 min, processes 10am ET daily).
- **nflverse weekly files include postseason rows** — filter `season_type == REG`.
- **Lineup eligibility comes from `eligibleSlots`**, never inferred from position; exclude slots 20 (BENCH) / 21 (IR).
- **Team ids are 1,2,3,4,6,7,8,9,10,11,12,13** — 5 and 14 do not exist.
- **2025 `matchupPeriodCount` is 14.**
- **ESPN league views must be repeated `&view=` params**, never comma-joined (the browser's `espn()` helper splits and rebuilds for this reason).
- **ESPN preseason projections are systematically inflated** — every team finishes under. Center on the league mean.
- **`.nflverse-cache` must never be read for the in-progress season.**
- **Absence casts no vote** — this rule now appears in six places (analyst boards, boom rates, handcuff start-rate, sentiment, K/DST fallback, unrated volatility). Never let a missing player read as a low/zero value.

---

## Reboot / persistence

Everything durable is committed and pushed to `origin/main`; **`git push` auto-deploys** via the Vercel Git integration (fixed Aug 8 2026 — no manual `vercel deploy` needed).

**Weak links:**
- `lineup-state.json` and `trade-state.json` live only in actions/cache. Losing them means one duplicate alert, nothing worse.
- `playwright-core` is `--no-save`, so `npm ci` or a fresh clone won't have it. Reinstall with `npm i --no-save playwright-core` when verification is needed.
- The always-on LaunchAgent on port 4650 caches `index.html` at startup — **front-end edits need a server restart before any verification.** If localhost misbehaves, check `lsof -ti:4650` for an orphaned `node server.js` (PPID 1), kill it, launchd restarts it.
- The claude.ai artifact copy of the postmortem lives only on Anthropic's servers, not in git.

---

## Don't redo

- **Do not redo any of the ten studies.** Numbers are in `league-history-2025.json`.
- **Do not rebuild the Start/Sit tab to show points-positive swaps.** There is no such thing from an optimal lineup — see "Where my thinking was".
- **Do not attempt the consensus draft-board backtest.** Proven impossible — every analyst file first appears in git in Aug 2026.
- **Do not go looking for 2025 FAAB bid data.** It does not exist.
- **Do not go looking for other teams' trade contents.** ESPN scopes them to participants.
- **Do not try the league communication endpoint.** 404s, four variants tried.
- **Do not re-run the handcuff study on one season** and quote the result (10 windows is too thin; use the 3-season 63%).
- **Do not re-derive the ESPN API patterns** — all in CLAUDE.md Gotchas.

---

## How to work with Ethan

- **Every response starts with "Ethan,"**.
- **Lead with the outcome and the number**, not the methodology.
- **He reacts to rankings.** Full 12-team tables with his own team marked, over prose. Standing request.
- **He has ADHD and says so.** When he asks "where do I see this", he wants the literal click path and one command at a time — not an architecture tour. Short numbered steps.
- **He asks the sharp follow-up.** This session: "why is kicker and dst out" → "would it be stronger to include it or no". Give a straight recommendation with the reason, then offer to build it. He said yes both times.
- Terse and direct. Define jargon inline. Terminal steps **one command at a time**, then wait.
- **Zero cost, always.**
- He wants findings tied to **a decision he can make**. "Interesting" is not the bar.
- Never re-run a failed command unchanged; after two failures of one approach, switch.

---

## The next task

**UNSPECIFIED — ask him. Do not guess or start anything.**

He asked "what else is on to do", got the list below, and then ended the session to open a fresh chat. He did **not** pick one.

The list as given to him, in the order I recommended:

1. **Start the projection-calibration log — this week.** Every week, record what each source predicted (ESPN, the consensus rank, each analyst board) vs what actually happened, per position. After ~5 weeks it says which source is actually better at which position in this scoring, and Start/Sit can weight accordingly. **It cannot be backfilled — if it doesn't start at Week 1 it's dead for the season.** It is also the *forward* test of the draft board that the 2025 backtest proved impossible. This is the only item with a deadline.
2. **The pending Jeremiah Love video note.** Already sitting in auto-memory as pending — a buy-low trade target from an FSC video, waiting on Week 1 so it can be week-tagged. Week 1 is now live. Use the `fantasy-video-inject` skill; it writes to `video-notes.json`, NOT to a `draft-guide*.json`.
3. **FAAB bid ceilings.** New rule set this year and he'll be bidding blind. Computable free from nflverse: what fraction of players added in week N actually produce startable weeks after, by position. Given he started only 26% of the points his pickups produced, the honest answer may be "bid less, deploy more."
4. **Playoff-weeks (15–17) schedule strength.** Cheap one-off, feeds trades and stashes. Useful in October, useless in December.

Two smaller loose ends, both real:
- **The per-team handcuff table never made it onto `site/2025-postmortem.html`.** The data is in `league-history-2025.json` under `handcuffTeams.byTeam`. Act VI exists but only carries the NFL-wide 63% number. Remember it would need shipping to **both** homes.
- **Act VI's visual layout has still never been eyeballed in a browser** (carried forward from last session — a static structural check was done instead).
