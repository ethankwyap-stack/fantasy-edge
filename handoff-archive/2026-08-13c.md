# Fantasy Edge — Handoff (Aug 13 2026, session 2)

Project: `/Users/ethanyap/fantasy-edge`. **Read `CLAUDE.md` in that folder first** — stack, deploy steps, and a long Gotchas list this file does not repeat.

Previous handoff archived at `handoff-archive/2026-08-13b.md`. Everything in it that is still true is carried forward below — **do not go read it**, it is now actively misleading (it describes three analyses as "queued" that are built, and one that is impossible).

Ethan's standing goal for this whole line of work, in his words: **"rigorous data analytics" that "translate to winning results."** Actionable findings tied to a decision he can make, not trivia.

Note the file is `HANDOFF.md` (uppercase) in git. macOS is case-insensitive so `handoff.md` also resolves — don't create a second lowercase copy, you'll be editing the same tracked file.

---

## TL;DR

1. **SEVEN analyses are DONE with committed numbers.** All live in `scripts/league-history.js`, output in `league-history-2025.json`. **Do not redo any.** Flags: `--bench-value`, `--sleeper-hit-rate`, `--bench-audit [--team N]`, `--schedule-luck`, `--faab-roi`, `--trade-accuracy`, `--draft-accuracy`, plus `--all` / `--selftest`.
2. **ONE analysis remains: RB handcuff hit-rate.** It is **BLOCKED on an Ethan decision** — the definition of a "hit." Do not pick it yourself. See "The decision still open."
3. **The consensus draft-board backtest is permanently impossible.** No 2025-era analyst files exist. Proven, not assumed. `--draft-accuracy` is the substitute that was built instead. Do not re-attempt it.
4. **The postmortem page is DONE and shipped**, expanded from 3 acts to 5, now served from the live site at `/2025-postmortem` AND published as a claude.ai Artifact. **These are two separate copies that do not sync.**
5. **Everything is committed and pushed.** Working tree clean, zero unpushed commits. `git push` auto-deploys this project.
6. Season used throughout: **2025** (the only completed season).

---

## What was accomplished this session

Ethan asked to "complete 1 2 and 3" from the previous queue: consensus backtest, trade accuracy, projection accuracy. Also asked that **anything that ranks shows full rankings by fantasy team.**

### The road not taken — the consensus backtest is impossible

First thing checked, before writing any code:

```
git log --format='%h %ad %s' --date=short --diff-filter=A -- 'draft-guide*.json' analyst-ranks.json
```

**Every analyst file first appears Aug 2026.** There are no 2025-era analyst boards anywhere in git history. Backtesting today's 2026 consensus against 2025 results would be worse than useless. `[verified]`

Ethan was asked and chose the **degraded 2025 backtest**: score the two consensus inputs that *do* have 2025 data (ESPN projection, and the league's own draft order as a real market signal) against actual finish. That merged into what became `--draft-accuracy`. `[he confirmed]`

He also chose, for trades: **report rostered AND started points, both.** `[he confirmed]`

### Study 6 — `--trade-accuracy`

Three stacked ESPN traps had to be cracked (all now in CLAUDE.md Gotchas, see below).

**Results — trade VOLUME (league-wide, complete):**

| # | Team | Trades |
|---|---|---|
| **1** | **Bucky Irving 🤤 (ETHAN, team id 1)** | **14** |
| 2 | Jalen Kirk | 13 |
| 2 | Lamar-a-lago | 13 |
| 4 | Nico Suave | 12 |
| 5 | 2 gurls 1 kupp | 9 |
| 6 | Njigbas in Paris | 7 |
| 7 | Dart that Dihker in KaiME | 6 |
| 8 | EaTN McCokkey | 5 |
| 9 | Myer Lemon | 4 |
| 10 | Skat's Super CTE | 2 |
| 11 | Damardiac Arrest | 1 |
| 12 | Ashton of Ass | 0 |

43 executed trades league-wide.

**Results — net points, ETHAN'S 14 TRADES ONLY** (league-wide net points is impossible, see Gotchas). Sign convention: **positive = Ethan gained.**

| Counterparty | Trades | Ethan's net |
|---|---|---|
| Nico Suave | 2 | **+204.4** |
| 2 gurls 1 kupp | 1 | +1.9 |
| Damardiac Arrest | 1 | −8.3 |
| Lamar-a-lago | 1 | −31.7 |
| Jalen Kirk | 3 | −53.8 |
| Myer Lemon | 1 | −70.2 |
| EaTN McCokkey | 2 | −71.7 |
| Dart that Dihker in KaiME | 3 | **−267.8** |
| **TOTAL** | **14** | **−297.2 rostered / −126.8 started** |

He won **4 of 14**. Worst single trade, Week 4: gave Jaxson Dart + DK Metcalf (259.5 pts of production) for Justin Fields (37.8) = −221.7.

**Validation:** counterparty gains sum to exactly +297.2 against Ethan's −297.2. Conservation holds. `[verified]`

### Study 7 — `--draft-accuracy`

**Every team finished under ESPN's projection** (league avg −616.2) because ESPN projects healthy 17-game seasons. Rank on the **centered** column.

| # | Team | Actual | Projected | Miss | vs league avg |
|---|---|---|---|---|---|
| **1** | **Bucky Irving 🤤 (ETHAN)** | 2803.8 | 2862.2 | −58.4 | **+557.8** |
| 2 | Ashton of Ass | 2615.9 | 3003.9 | −388.0 | +228.2 |
| 3 | Jalen Kirk | 2303.6 | 2772.6 | −469.0 | +147.2 |
| 4 | Myer Lemon | 2061.6 | 2568.1 | −506.5 | +109.7 |
| 5 | Njigbas in Paris | 2008.2 | 2542.7 | −534.5 | +81.7 |
| 6 | EaTN McCokkey | 2194.1 | 2802.0 | −607.9 | +8.3 |
| 7 | Skat's Super CTE | 2347.7 | 2984.6 | −636.9 | −20.7 |
| 8 | Nico Suave | 2378.5 | 3046.8 | −668.3 | −52.1 |
| 9 | 2 gurls 1 kupp | 2566.5 | 3317.4 | −750.9 | −134.7 |
| 10 | Lamar-a-lago | 2518.0 | 3347.5 | −829.5 | −213.3 |
| 11 | Damardiac Arrest | 1998.2 | 2845.5 | −847.3 | −231.1 |
| 12 | Dart that Dihker in KaiME | 1937.7 | 3034.6 | −1096.9 | −480.7 |

**Ethan had the best draft in the league by 330 points.**

**Projection accuracy** — mean absolute positional rank error over 166 picks:

| Position | ESPN | Market (league draft order) | Winner |
|---|---|---|---|
| Overall | **10.76** | 11.33 | ESPN |
| QB (n=24) | 8.33 | **7.92** | MARKET |
| RB (n=56) | **8.50** | 9.50 | ESPN |
| WR (n=67) | **14.75** | 15.34 | ESPN |
| TE (n=19) | **6.42** | 6.84 | ESPN |

Biggest bust: Jayden Daniels, proj 372 → 114. Biggest hit: Quinshon Judkins, pick 141, proj 50 → 170.

### The synthesis that matters to Ethan

Across all seven studies: **he acquires talent well and fails to deploy it.**
- Draft: **1st of 12** (+557.8 vs league avg)
- Waivers: 48 pickups (2nd-most), 511 pts produced, **only 26% started — worst in league**
- Bench: **222.4 pts** left unstarted (7th of 12)
- Schedule luck: **−0.3** (no excuse available)
- Trades: **−297.2, 4 wins in 14 — the one place he is measurably negative**

He asked directly "so basically i traded my team away because i had a good draft?" The honest answer given: substantially yes, **but benching (222.4) cost more than trading did in points that actually counted (126.8 started)**, and those two figures are different counterfactuals that must not be summed — the bench figure is measured on the roster he had *after* the trades.

### The postmortem page

`site/2025-postmortem.html` went 3 acts → 5. New **Act I** (best draft in the league + projection accuracy) and new **Act V** (trades). Existing acts renumbered. Verdict rewritten from 4 to 5 priorities — two old items no longer survived the new data, and "trust the draft board" was added because the old page implied the board was suspect and it measurably isn't.

Then a route was added so it's served from his own site.

---

## State

| Thing | State | Confidence |
|---|---|---|
| Git | Clean tree, **all pushed**. Head `dce43ac`. 4 commits this session: `1efb2c8` (studies), `aad19a3` (CLAUDE.md), `0758970` (postmortem), `dce43ac` (route). | [verified — `git status` + `git log origin/main..HEAD` empty] |
| `scripts/league-history.js` | 7 studies. ~530 lines. | [verified — `--all` ran clean] |
| `league-history-2025.json` | Regenerated by `--all`, committed. Full row-level data for all 7. | [verified] |
| `--selftest` | Passes, no network. Now also asserts `seasonStat()` pins `statSplitTypeId 0`. | [verified — ran] |
| Live route `/2025-postmortem` | Added to `server.js`, behind the existing secret-link gate. Prod returns 401 without cookie (= gate working). | [verified locally: 200 w/ cookie, 401 without, bytes match repo file, index still 200. Prod only checked for 401.] |
| Artifact copy | `https://claude.ai/code/artifact/5040c067-4f88-47c9-93e5-602df3f80bad` — republished with the 5-act version. Favicon set to 🏈 (original unknown). | [verified — publish succeeded] |
| **Artifact ≠ repo file** | Two separate copies. A repo edit + `git push` does NOT update the artifact; it needs a separate `Artifact` call passing that `url`. | [verified — this exact confusion happened this session] |
| Auto-memory | 2 new files + MEMORY.md index lines: `espn-trade-contents-are-participant-only.md`, `ethan-drafts-well-deploys-badly.md`. | [verified — written] |
| `CLAUDE.md` | Updated with 4 new Gotchas + study count. | [verified] |
| `.env` (`LEAGUE_ID`, `ESPN_S2`, `SWID`, `APP_SECRET`, `SEASON=2026`) | Working. ESPN cookies valid this session (all fetches 200). Season is a query param, independent of `.env`'s `SEASON`. | [verified] |
| League id | 916578979. Ethan is **team id 1**, `Bucky Irving 🤤`. | [verified — now PROVEN, see Gotchas] |
| `playwright-core` | **NOT installed** in this repo, despite CLAUDE.md describing a headless-verification workflow with it. Headless render check could not run. | [verified — MODULE_NOT_FOUND, twice] |
| Cost | Zero. Free ESPN API only. No keys, no new services. | [verified] |

---

## Where my thinking was

**On the trade study nearly shipping wrong, twice.** The first run reported 26 trades with Ethan in *all 26* — obviously wrong. Two separate bugs were hiding under one symptom: every trade files two `TRADE_ACCEPT` records (double-counting), AND ESPN only returns trade contents to participants (so only his trades ever resolve). Either bug alone would have produced a plausible-looking table. **The thing that caught it was noticing his count equalled the league total** — a shape check, not a value check. Worth doing that kind of check on any new league-wide aggregate.

**On why I trust the trade numbers now.** Counterparty gains sum to +297.2 against Ethan's −297.2. That conservation identity is free and is the cheapest regression test for this study — same role the 1731.7-vs-1731.8 check plays for the weekly-points path. **Re-check it after any change to `earned()`.** `[verified]`

**On the projection-inflation problem, which I nearly shipped wrong.** The first `--draft-accuracy` run had all 12 teams negative. Reporting the raw delta as a ranking would have been a real methodological error — it ranks injury luck, not skill. Centering on the league mean fixes it. **If any future study compares actual against ESPN projections, it needs the same treatment.**

**On `bestLineup()` being greedy, not optimal** — carried forward, still true, still unmeasured. It fills the most-constrained slot first. Can in principle be beaten by Hungarian assignment. Error direction is known and safe (greedy can only UNDER-state points-left-on-bench), magnitude never measured. `[unverified — never measured]`

**On what I did not chase.** The 58 unresolvable `TRADE_ACCEPT` records represent ~29 trades between other teams whose contents are invisible. I confirmed no week range recovers them, but I did **not** test whether a different ESPN endpoint (e.g. the mobile API, or a different `view`) exposes them. My belief is it's a genuine privacy scope and not worth chasing, but that's an inference, not a test. `[unverified]`

**On the product implication I raised and he engaged with.** The Start/Sit tab is the highest-leverage surface in this product for Ethan specifically — more than the draft board or trade finder. The draft board is measurably *fine*. He didn't dispute this.

---

## For the next session to figure out

### The RB handcuff hit-rate — the only remaining analysis

Ethan's framing, verbatim: *"injuries always happen (running backs especially) so how valuable is a handcuff and what is the percentage that they hit."*

- **BLOCKED on the definition of a "hit" — ask him, do not choose.** See next section.
- **Reuse before building:** `scripts/boom-rates.js` already has an nflverse snap-counts pipeline. Depth-chart / backup identification probably falls out of that plus `proTeamId` grouping. **Do not build a new data pipeline without looking there first.**
- `STARTABLE` in `league-history.js` already encodes the top-24 RB cutoff.
- Injury windows: `/api/nfl?feed=injuries` (`api/nfl.js`) is existing, working and free.
- **Why it matters:** it compares directly against the earlier finding that speculative RB/WR sleeper picks hit only ~1 in 5 (RB 18.8%, WR 20.9%). If handcuffs beat 1-in-5, late-round capital should go to handcuffs. If not, it shouldn't. **Report the two rates side by side — that comparison is the whole point.**
- **Ethan wants full 12-team rankings on anything rankable.** He said so explicitly this session. If the handcuff study can produce a per-team number (e.g. who rostered handcuffs most effectively), rank all 12 with his team marked.

### Optional, not requested

- **Forward test of the consensus board.** Since the 2025 backtest is impossible, the only real test is forward: freeze today's 2026 consensus and score it at season's end. Was offered to Ethan as an option; **he chose the degraded backtest instead and did not ask for this.** Don't build it unprompted.
- **Measure greedy vs optimal in `bestLineup()`.** Would firm up every bench number. Low value — direction of error is already known and safe.

---

## The decision still open

**The "hit" definition for the RB handcuff study. ASK HIM — do not guess.** The answer changes the number a lot and he has opinions.

Candidates:
- **(a)** Handcuff becomes a startable RB (top-24) for some stretch after the starter is injured. *My lean* — reuses `STARTABLE` which already exists.
- **(b)** Handcuff outscores what the starter would have scored over the injury window.
- **(c)** Binary: starter missed 2+ games AND handcuff saw 15+ carries in that window.

Nothing else is blocked on him.

---

## Gotchas

**New this session — the four that cost real effort:**

- **`statSplitTypeId` is a FOURTH stat discriminator**, alongside `seasonId` / `statSourceId` / `scoringPeriodId`. A player carries two preseason-projection entries identical on all three of those: `statSplitTypeId: 0` = season TOTAL (Ja'Marr Chase 340.0), `statSplitTypeId: 2` = PER GAME (17.8). Taking the wrong one is a **silent ~20x error** with nothing on screen. `seasonStat()` in `league-history.js` pins `0`; a `--selftest` assert covers it. [verified]

- **Trade data has three stacked traps, all silent:**
  1. A `TRADE_ACCEPT` transaction carries an **empty `items` array**. The players swapped live on the `TRADE_PROPOSAL` it points at via `relatedTransactionId` — which stays `status: PENDING` even after acceptance.
  2. **Every executed trade files TWO accepts**, one per team, each pointing at a *different* proposal id carrying the *same* players. Counting accepts double-counts every trade. **Dedup on the sorted player-set signature, not the id.**
  3. **ESPN returns proposal CONTENTS only to a participant.** With Ethan's cookie, 28 of 28 resolvable proposals involve team 1; widening the scan to weeks 0–18 resolves zero others. **League-wide trade net-points is NOT obtainable and no amount of week-looping fixes it.** Volume IS league-wide (accepts are returned for everyone; team count = accept count, league total = accepts/2).
  [verified — all three reproduced]

- **This proves Ethan is team id 1.** Previously only assumed (CLAUDE.md said so, he never confirmed outright). Which trades are visible is now positive evidence. [verified]

- **ESPN preseason projections are systematically inflated — every team finishes under them** (2025 league avg −616.2, all 12 negative). They assume healthy 17-game seasons, so raw "actual minus projected" ranks injury luck, not skill. **Center on the league mean.** Never present the raw delta as a skill metric. [verified]

- **The consensus draft-board backtest is impossible for 2025 and always will be.** Every `draft-guide*.json` and `analyst-ranks.json` first appears in git in Aug 2026. **Do not re-attempt it.** [verified — `git log --diff-filter=A`]

- **`site/2025-postmortem.html` has TWO homes that do not sync.** The repo copy is served from the live site via `git push`; the claude.ai Artifact copy needs a separate `Artifact` call passing `url: https://claude.ai/code/artifact/5040c067-4f88-47c9-93e5-602df3f80bad`. Publishing without that `url` creates a *separate* artifact instead of updating his. Ethan hit this confusion directly ("i don't see any changes here"). [verified]

- **That file is artifact-shaped on purpose** — no doctype, no `<head>`, no `<meta charset>` — because the Artifact host injects those. The server route therefore sends `Content-Type: text/html; charset=utf-8` explicitly. **Without it the team-name emoji (🤤) and every en-dash render as mojibake.** Don't "fix" the file by adding a doctype; it would break the artifact publish. [verified]

- **`playwright-core` is not installed here**, despite CLAUDE.md documenting a headless-verification workflow using it. Two attempts failed with MODULE_NOT_FOUND. Fell back to a static structural check (tag balance + per-table column counts). **The postmortem page's visual layout is unverified** — if it matters, install it or eyeball it in a browser. [verified — it is genuinely absent]

**Carried forward, still true:**

- **`playerPoolEntry.appliedStatTotal` on a week-scoped `mRoster` call is CUMULATIVE season-to-date, not that week's score.** Matches in Week 1 only, so it survives the obvious spot-check. Use `weekPts()`. Sanity-check any team-season total against the known 1731.8 PF figure; anything outside ~1350–2100 for a 14-week 2025 team is wrong. [carried forward, verified last session]
- **2025 was NOT a FAAB league.** `WAIVERS_TRADITIONAL`, `isUsingAcquisitionBudget: false`. Every `bidAmount` is a genuine 0. **No historical bid data exists and none can be recovered — do not go looking.** [carried forward]
- **`mTransactions2` returns an EMPTY array without `scoringPeriodId`** on a completed season. Loop the weeks. Type enum is `TRADE_ACCEPT`, **not** `TRADE_ACCEPTED`. When an x-fantasy-filter 400s, read the response's `cause` field — ESPN enumerates valid values for you. [carried forward]
- **The league communication endpoint 404s for this league.** Dead end, four variants tried. [carried forward]
- **Lineup eligibility must come from the player's `eligibleSlots`**, never inferred from position. Exclude slot ids 20 (BENCH) and 21 (IR) — `lineupSlotCounts` includes them with nonzero counts (`20: 7, 21: 1`). [carried forward]
- **2025 `matchupPeriodCount` is 14.** [carried forward]
- **Team ids are 1,2,3,4,6,7,8,9,10,11,12,13** — 5 and 14 do not exist. Never assume contiguous. [carried forward]
- **Use an allowlist, not a denylist, when filtering positions.** D/ST have negative `playerId`s and fall through as `pos: '?'`. [carried forward]
- **QB/TE/K/D-ST make hit-rate style metrics structurally misleading** — shallow pools, tiny denominators. Always position-split or exclude. [carried forward]
- **ESPN league views must be repeated `&view=` params**, not comma-joined. [carried forward]

**Everything else in `CLAUDE.md` is unchanged and still applies.**

---

## Reboot / persistence

Everything durable is committed and pushed to `origin/main`. `git push` auto-deploys via the Vercel Git integration, so the live site already has the new route.

**Weak links:**
- `HANDOFF.md` is **tracked** but was not committed as part of this session's four commits (it's being written now). Commit it.
- The claude.ai Artifact lives only on Anthropic's servers — not in git. If it matters, the repo copy at `site/2025-postmortem.html` is the source of truth.
- No background processes were started. The local server test on port 4651 was killed. The always-on LaunchAgent on port 4650 was never touched — **it is still running the OLD code** and will not serve `/2025-postmortem` until restarted. If localhost misbehaves, check `lsof -ti:4650` for an orphaned `node server.js` (PPID 1) blocking the KeepAlive LaunchAgent.

---

## Don't redo

- **Do not redo any of the seven analyses.** All numbers are in `league-history-2025.json` and the tables above.
- **Do not attempt the consensus backtest.** Proven impossible.
- **Do not go looking for 2025 FAAB bid data.** It does not exist.
- **Do not go looking for other teams' trade contents.** ESPN scopes them to participants.
- **Do not try the league communication endpoint.**
- **Do not re-derive the ESPN API patterns** — all captured in Gotchas.
- **Do not re-verify the 1731.7 vs 1731.8 cross-check or the +297.2 trade conservation check.** Both done.

---

## How to work with Ethan

- **Every response starts with "Ethan,"**.
- **Lead with the outcome and the number**, not the methodology.
- **He reacts to rankings.** Prefer ranked tables with his own team marked over prose. He asked explicitly this session for "full rankings by fantasy team" on anything rankable — treat that as standing.
- Terse and direct. Define jargon inline. Terminal steps **one command at a time**, say what he should see, then wait.
- **Zero cost, always.** This whole project is free. If something would cost money, say so and offer the free path.
- He wants findings tied to **a decision he can make**. "Interesting" is not the bar.
- **He asks good clarifying questions when a table is ambiguous** — he caught a sign-convention problem in the trade table this session ("so a negative is good?"). State sign conventions explicitly in any table with directional values.
- Never re-run a failed command unchanged; after two failures of one approach, switch.
- Save inline scripts to the scratchpad and invoke by path.

---

## The next task

**The RB handcuff hit-rate study**, which Ethan said he would start in a new chat.

**First action: ask him the "hit" definition** (three candidates in "The decision still open"). Do not pick one silently. Everything else about the study is unblocked and the reuse path is mapped above.
