# Fantasy Edge — Handoff (Aug 13 2026)

Project: `/Users/ethanyap/fantasy-edge`. **Read `CLAUDE.md` in that folder first** — stack, deploy steps, and a long Gotchas list this file does not repeat.

Previous handoff (Aug 12, the bench-value + sleeper-hit-rate analysis session) archived at `handoff-archive/2026-08-13a.md`. Everything in it that is still true is carried forward below — do not go read it unless something here points you there.

Ethan's standing goal for this whole line of work, in his words: **"rigorous data analytics" that "translate to winning results."** He wants actionable findings tied to a decision he can actually make (start/sit process, FAAB bid sizing, trade evaluation, trust in the draft board), not interesting trivia.

---

## TL;DR

1. **FIVE analyses are now DONE with real committed numbers.** Two from the previous session (Week-1 bench value, draft sleeper hit-rate) and **three built this session** (full-season bench audit, schedule luck / all-play, waiver ROI). All five live in `scripts/league-history.js` and their output in `league-history-2025.json`, both committed. **Do not redo any of them.**
2. **Two analyses remain queued** (numbers 4-7 of Ethan's original 7-item list, minus the three completed): consensus draft-board backtest, trade accuracy, projection accuracy, RB handcuff hit-rate. Details and design questions for each are below.
3. **A major data bug was found and fixed this session** — see Gotchas, item 1. It silently produced numbers ~2x too high and only became visible in Week 2. If any future weekly analysis is built, it must use `weekPts()`, never `appliedStatTotal`.
4. **A structural finding: 2025 was NOT a FAAB league.** It ran traditional priority waivers (`WAIVERS_TRADITIONAL`, `isUsingAcquisitionBudget: false`). There is **zero historical bid data** to learn FAAB strategy from. 2026 is the first FAAB season. This kills the original "FAAB ROI" framing and it is not recoverable — do not go hunting for the bid data, it does not exist.
5. **In-flight and NOT finished when this handoff was written: an HTML data-story page** summarizing these findings, in the style of a Joel Smyth data video. Ethan asked for it in the same breath as this handoff. See "The next task."
6. Season used throughout: **2025** (the only completed season — 2026 was drafted Aug 2026 and has played no games).

---

## What was accomplished this session

Ethan said "start with the first 3" from the queued list. All three built, run, verified, and committed in one commit: `ebda30e Add bench audit, schedule luck, and waiver ROI studies`.

### Analysis 1 — Full-season points left on the bench

Per week, per team: actual started points vs. the **best legal lineup** that could have been started from that same roster. Slot-eligibility aware (uses each player's real `eligibleSlots`, not their position).

**Ranked, best → worst (least points wasted first). Ethan is team id 1, `Bucky Irving 🤤`:**

| # | Team | Left on bench | Per wk | Scored | Possible | Lineup accuracy |
|---|---|---|---|---|---|---|
| 1 | Njigbas in Paris | 125.1 | 8.9 | 1944.8 | 2069.9 | 94.0% |
| 2 | Lamar-a-lago | 165.5 | 11.8 | 1653.4 | 1818.9 | 90.9% |
| 3 | 2 gurls 1 kupp | 199.3 | 14.2 | 1590.1 | 1789.4 | 88.9% |
| 4 | Nico Suave | 206.2 | 14.7 | 1664.3 | 1870.5 | 89.0% |
| 5 | Jalen Kirk | 209.1 | 14.9 | 1731.7 | 1940.8 | 89.2% |
| 6 | Myer Lemon | 214.4 | 15.3 | 1663.6 | 1878.0 | 88.6% |
| **7** | **Bucky Irving 🤤 (ETHAN)** | **222.4** | **15.9** | **1656.9** | **1879.3** | **88.2%** |
| 8 | Dart that Dihker in KaiME | 236.2 | 16.9 | 1437.9 | 1674.1 | 85.9% |
| 9 | Skat's Super CTE | 253.3 | 18.1 | 1613.8 | 1867.1 | 86.4% |
| 10 | Damardiac Arrest | 260.1 | 18.6 | 1367.3 | 1627.4 | 84.0% |
| 11 | EaTN McCokkey | 260.6 | 18.6 | 1694.6 | 1955.2 | 86.7% |
| 12 | Ashton of Ass | 328.2 | 23.4 | 1513.4 | 1841.6 | 82.2% |

**Ethan is 7th of 12 — below median.** Gap to the champion is 97 pts (~7/wk, roughly one win).

**The headline correlation:** the top 2 in lineup accuracy finished 13-1 and 10-4. The bottom 3 finished 5-9, 4-10, 4-10. This is the cleanest signal in the whole dataset and is the natural spine of any presentation of this work.

**Ethan's five worst weeks (team 1):**

| Wk | Left | Actual | Best possible | Top benched players |
|---|---|---|---|---|
| 4 | 37.8 | 148.5 | 186.3 | Dak Prescott 30.96, DK Metcalf 23.6, Jaxson Dart 19.84 |
| 1 | 34.7 | 71.2 | 105.9 | Courtland Sutton 18.1, Jacory Croskey-Merritt 14.2, Tyler Loop 13 |
| 11 | 33.5 | 140.2 | 173.7 | Michael Wilson 33.5, Emanuel Wilson 13.9, Jakobi Meyers 11.4 |
| 2 | 21.4 | 121.1 | 142.5 | Jauan Jennings 19.9, George Pickens 17.8, Tetairoa McMillan 16 |
| 3 | 20.7 | 101.2 | 121.9 | George Pickens 17.8, Elic Ayomanor 13.8, DK Metcalf 12.2 |

Weeks 1-4 are his leakiest stretch — early-season start/sit is where his process is weakest, which is exactly when the site's Start/Sit tab matters most. That is a shippable product insight, not just a stat.

### Analysis 2 — Schedule luck (all-play record)

Compares each team's actual W-L against a hypothetical "played every other team every week" record. `luckWins` = actual wins minus all-play-expected wins.

**Ranked by TRUE strength (all-play win %), best → worst:**

| # | Team | Actual | All-play | Win% | Expected W | Luck |
|---|---|---|---|---|---|---|
| 1 | Njigbas in Paris | 13-1 | 119-35 | 77.3% | 10.8 | +2.2 |
| 2 | EaTN McCokkey | 8-6 | 96-58 | 62.3% | 8.7 | −0.7 |
| 3 | Jalen Kirk | 7-7 | 90-64 | 58.4% | 8.2 | −1.2 |
| 4 | Nico Suave | 6-8 | 87-67 | 56.5% | 7.9 | **−1.9** |
| 5 | Myer Lemon | 8-6 | 84-70 | 54.5% | 7.6 | +0.4 |
| 6 | Lamar-a-lago | 10-4 | 83-71 | 53.9% | 7.5 | **+2.5** |
| **7** | **Bucky Irving 🤤 (ETHAN)** | **7-7** | **80-74** | **51.9%** | **7.3** | **−0.3** |
| 8 | Skat's Super CTE | 7-7 | 70-84 | 45.5% | 6.4 | +0.6 |
| 9 | 2 gurls 1 kupp | 5-9 | 69-85 | 44.8% | 6.3 | −1.3 |
| 10 | Ashton of Ass | 4-10 | 56-98 | 36.4% | 5.1 | −1.1 |
| 11 | Dart that Dihker in KaiME | 5-9 | 47-107 | 30.5% | 4.3 | +0.7 |
| 12 | Damardiac Arrest | 4-10 | 43-111 | 27.9% | 3.9 | +0.1 |

**Ethan was the 7th-strongest team and finished exactly 7th-ish. No luck excuse in either direction (−0.3).**

Two actionable reads, already given to him:
- **`Lamar-a-lago`'s 10-4 was inflated** — only the 6th-strongest team, +2.5 lucky wins, soft schedule.
- **`Nico Suave`'s 6-8 was unlucky** — 4th-strongest team, −1.9 luck. **Named to Ethan as the trade target**: their record makes their roster look worse than it is. If he acts on this in 2026, that is where the idea came from.

Note Ethan is 7th in BOTH tables. That symmetry is the honest summary: a middling team that managed its lineup like a middling team.

### Analysis 3 — Waiver ROI (originally scoped as "FAAB ROI")

**The framing broke on contact with the data, in an informative way.** `mSettings` for 2025 returns `acquisitionType: "WAIVERS_TRADITIONAL"`, `isUsingAcquisitionBudget: false`, `acquisitionBudget: 100` (a dead field — unused). Every single `bidAmount` on every transaction is a genuine `0`.

Decision made: **report `faab: false` explicitly and print a NOTE**, rather than averaging a meaningless `0 pts/$` that would look like a real (terrible) ROI number. The study still reports pickup VALUE, just not price.

| Team | Pickups | Pts rostered | Pts actually started | Started % |
|---|---|---|---|---|
| Myer Lemon | 29 | 620.5 | 278.2 | 45% |
| Lamar-a-lago | 27 | 565.4 | 337.8 | 60% |
| Jalen Kirk | 44 | 552.8 | 247.5 | 45% |
| **Bucky Irving 🤤 (ETHAN)** | **48** | **511.0** | **134.7** | **26%** |
| Damardiac Arrest | 19 | 510.3 | 262.6 | 51% |
| Skat's Super CTE | 11 | 400.9 | 139.1 | 35% |
| Dart that Dihker in KaiME | 22 | 394.1 | 216.9 | 55% |
| Njigbas in Paris | 27 | 375.3 | 115.4 | 31% |
| EaTN McCokkey | 11 | 344.0 | 128.2 | 37% |
| Nico Suave | 26 | 310.6 | 178.5 | 57% |
| 2 gurls 1 kupp | 14 | 249.0 | 97.0 | 39% |
| Ashton of Ass | 5 | 219.4 | 109.0 | 50% |

League totals: 283 pickups, 5053.3 pts rostered.

**The finding that matters, and the one Ethan reacted to:** he made 48 pickups (2nd-most in the league) but started only 26% of the points they produced — **the worst rostered-to-started ratio in the league.** He churns the wire hard and then does not trust what he picks up.

Concrete examples from his own team: **Elic Ayomanor scored 50.2 pts on his bench and was never started once. Michael Wilson scored 33.5 in a single week, also never started.**

**This compounds with Analysis 1.** His 222 wasted bench points are not mostly draft picks he misjudged — they are waiver adds he acquired correctly and then benched. That is a single, specific, fixable behavior, and it is the strongest actionable conclusion of the entire session.

His best pickups (team 1, 2025):

| Player | Pos | Added wk | Pts rostered | Pts started | Weeks held |
|---|---|---|---|---|---|
| Elic Ayomanor | WR | 2 | 50.2 | 0 | 6 |
| Chris Boswell | K | 8 | 50.0 | 50.0 | 6 |
| Sean Tucker | RB | 11 | 48.5 | 39.6 | 4 |
| J.J. McCarthy | QB | 8 | 40.1 | 14.7 | 5 |
| Michael Wilson | WR | 11 | 33.5 | 0 | 1 |
| Kimani Vidal | RB | 6 | 22.8 | 0 | 1 |

League's best pickups of 2025, for context: Jared Goff (Skat's Super CTE, wk3) 163.5 pts; Alec Pierce (Damardiac Arrest, wk4) 100.8; Christian Watson (Myer Lemon, wk7) 100.5; Trevor Lawrence (Lamar-a-lago, wk6) 100.0; Quentin Johnston (2 gurls 1 kupp, wk2) 95.8; Rachaad White (Damardiac Arrest, wk4) 95.5.

---

## State

| Thing | State | Confidence |
|---|---|---|
| `scripts/league-history.js` | Committed at `ebda30e`. Now has FIVE studies: `--bench-value`, `--sleeper-hit-rate`, `--bench-audit [--team N]`, `--schedule-luck`, `--faab-roi`, plus `--all` and `--selftest`. `--season YYYY` flag, defaults 2025. | [verified — ran this session, all five produce output] |
| `league-history-2025.json` | Committed. Output of `--all`, contains full row-level data for all five studies, not just the summaries quoted above. | [verified — regenerated and committed this session] |
| `--selftest` | Passes, no network. Asserts startable cutoffs, bench/IR slot ids, and (new this session) that `bestLineup()` respects `eligibleSlots` — a 30-pt WR must not be allowed to fill an RB slot. | [verified — ran] |
| Git | `ebda30e` committed on `main`. **NOT pushed as of writing this handoff.** Note that per CLAUDE.md, `git push` DOES auto-deploy this project via the Vercel Git integration. | [verified — `git log` checked; push status unverified, check `git status` first] |
| Auto-memory | One new memory written this session: `weekly-roster-points-are-cumulative.md`, plus its `MEMORY.md` index line. | [verified — file written] |
| `CLAUDE.md` | **NOT yet updated with this session's gotchas.** The `appliedStatTotal` trap and the 2025-is-not-FAAB finding both belong in its Gotchas list and are not there yet. | [verified — not done] |
| HTML data-story page | **NOT STARTED.** Requested by Ethan in the same message as this handoff. See "The next task." | [verified — does not exist] |
| `.env` (`LEAGUE_ID`, `ESPN_S2`, `SWID`, `SEASON=2026`) | Present and working for 2025 queries. Season is a query param, independent of `.env`'s `SEASON`. ESPN cookies were valid this session. | [verified — all fetches returned 200] |
| League id | 916578979 | [verified] |
| Live site, deploy trigger, alerts | Untouched this session. | [carried forward, not re-verified] |
| Cost | Zero. Everything is the free ESPN API. No new services, no keys. | [verified] |

---

## Where my thinking was

**On Ethan being team id 1.** The previous handoff flagged this as assumed-not-confirmed. This session I proceeded on it (CLAUDE.md says "Ethan is ESPN team #1") and reported all his personal numbers as team 1 = `Bucky Irving 🤤`. **He did not object when shown "you're 7th of 12" and detailed personal weekly numbers**, which is decent circumstantial confirmation but is not the same as him saying yes. `[unverified — worth one explicit question if a future analysis hinges on it]`

**On the validation that made me trust the fixed numbers.** After fixing the cumulative-points bug I needed a way to know the new numbers were right, not just different. `CLAUDE.md` records that in 2025 the 5th seed had **1731.8** points-for. My fixed run produces **1731.7** for `Jalen Kirk`. That match across an independently-recorded figure is why I believe the corrected output. **Any future change to the weekly-points path should re-check against this same number** — it is the cheapest available regression test for this data. `[verified]`

**On `bestLineup()` being greedy, not optimal.** It fills the most-constrained slot first (fewest eligible players) and gives it the highest scorer. This can in principle be beaten by an exact assignment algorithm (Hungarian). I judged it not worth it and left a `ponytail:` comment saying so. **I did not empirically measure how often greedy loses points to the true optimum.** If a future session wants to harden this, that measurement is the thing to do — and if greedy is meaningfully wrong, every "points left on bench" number above is slightly UNDERSTATED (the true optimum is >= greedy's). The direction of the error is known and safe; the magnitude is not. `[unverified — never measured]`

**On the thing I found but did not chase.** `mTransactions2` called WITHOUT `scoringPeriodId` returns an empty array on a completed season — it looks like "no transactions ever happened" rather than erroring. I worked around it by looping weeks 1-14. I never established whether that is a completed-season quirk or true always. If a future session builds trade analysis (queued item), **it will hit this exact wall** and should just loop the weeks from the start rather than concluding there is no data. `[verified — the empty response; the WHY is unverified]`

**On what I'd say the whole session proved.** Ethan's problem in 2025 was not talent acquisition and it was not luck. He acquired well (48 pickups, 2nd-most, 511 points of production) and his record was exactly what he deserved (−0.3 luck). His problem is **deployment** — getting the right 9 players into the lineup. That reframes what the Fantasy Edge site should be optimizing for: the Start/Sit tab is the highest-leverage surface in the product for him specifically, more than the draft board or the trade finder. I believe this but did not push it to him as a product recommendation. It is worth raising.

---

## For the next session to figure out

Four analyses remain from Ethan's original priority list. He has not re-prioritized since. Design questions per item; opinions marked so they can be skimmed.

### A. Consensus draft-board backtest
Validates the live site's own `consensus()` in `index.html` — does the blended rank (ESPN + ADP + every analyst) actually beat ESPN-alone or ADP-alone?
- **Blocker to check FIRST:** the `draft-guide*.json` and `analyst-ranks.json` files in the repo today are the **2026** versions. A 2025 backtest needs 2025-era inputs. `git log` those files for 2025-dated commits before assuming today's files are a valid backtest input. If they don't exist, this analysis may be **impossible as specified** — say so rather than silently backtesting 2026 ranks against 2025 results, which would be worse than useless.
- My lean: check the git history first, and if the 2025 inputs are gone, offer Ethan the alternative of a *forward* test — freeze today's 2026 consensus and score it at the end of the 2026 season.

### B. Trade accuracy
Which historical trades won or lost, and why.
- Needs `mTransactions2` per week (see the gotcha above — loop the weeks, don't call it unscoped), filtered to `TRADE_ACCEPT`. **The valid enum values are confirmed:** `DRAFT, TRADE_ACCEPT, WAIVER, TRADE_VETO, FUTURE_ROSTER, ROSTER, RETRO_ROSTER, TRADE_PROPOSAL, TRADE_UPHOLD, FREEAGENT, TRADE_DECLINE, WAIVER_ERROR, TRADE_ERROR`. Note it is `TRADE_ACCEPT`, **not** `TRADE_ACCEPTED` — I got a 400 on the latter.
- Reuse the `weeklyRosters()` + `weekPts()` machinery already built for the waiver study; the "points after the fact" comparison is the same shape.
- The "why" is qualitative — once winners/losers are identified, look at workload/injury/scheme rather than just reporting a point differential.

### C. Projection accuracy
ESPN preseason projection vs. actual finish. Mechanically the simplest of the four.
- `statSourceId=1, seasonId=2025, scoringPeriodId=0` = preseason projection. `statSourceId=0` same filters = actual. Both coexist in the same `stats[]` array.
- Natural pairing with (A) — they share a "draft-time expected value" computation.
- **Position-split it.** QB/TE/K/D-ST shallow pools skewed both of the previous session's analyses and will skew this one too.

### D. RB handcuff hit-rate
Ethan's framing, verbatim: *"injuries always happen (running backs especially) so how valuable is a handcuff and what is the percentage that they hit."*
- **Still needs a definition of "hit" — this is the actual blocker.** Candidates: (a) handcuff becomes a startable RB (top-24) for some stretch after the starter is injured; (b) handcuff outscores what the starter would have scored over the injury window; (c) binary — starter missed 2+ games AND handcuff saw 15+ carries in that window. **My lean is (a)**, because it reuses the top-24 startable cutoff already built into `STARTABLE` in `league-history.js`. Ask him, or state the choice loudly when reporting.
- **Reuse before building:** `scripts/boom-rates.js` already has an nflverse snap-counts pipeline. Depth-chart/backup identification probably falls out of that plus `proTeamId` grouping. Do not build a new data pipeline for this without looking there first.
- Injury windows: `/api/nfl?feed=injuries` (`api/nfl.js`) is an existing, working, free ESPN feed — documented in CLAUDE.md. Use it rather than re-deriving.
- **Why it matters:** it directly compares against the previous session's finding that speculative RB/WR "sleeper" picks hit only ~1 in 5 (RB 18.8%, WR 20.9%). If handcuffs hit meaningfully better than 1-in-5, late-round draft capital should go to handcuffs. If not, it shouldn't. **Report the two hit rates side by side** — that comparison is the whole point.

---

## The decision still open

**Nothing is blocked on an Ethan decision right now.** He has prioritized; the remaining four are blocked only on being built.

One thing worth ASKING rather than guessing: **the "hit" definition for the handcuff study (item D above).** Do not pick it silently — the answer changes the number a lot and he has opinions about what he actually wants to know.

---

## Gotchas

**Lead item — the bug that bit this session, and it is a nasty one:**

- **`playerPoolEntry.appliedStatTotal` on a week-scoped `mRoster` call is the player's CUMULATIVE SEASON-TO-DATE total, NOT that week's score.** It happens to equal the weekly value in Week 1, so the bug is completely invisible on a Week-1 spot check — which is exactly the spot check a reasonable person does. It produced team season totals of ~3188 when the true figure was ~1657, roughly 2x, and the output still *looked* plausible in shape. **The correct source is the `stats[]` entry filtered on `seasonId === SEASON && statSourceId === 0 && scoringPeriodId === wk`.** This is the same family as the existing CLAUDE.md `seasonId` warning: ESPN packs multiple aggregations into one field and nothing errors when you take the wrong one. `scripts/league-history.js` now has a `weekPts()` helper with this documented above it — **use it, never `appliedStatTotal`.** [verified — reproduced, fixed, and re-validated against the known 1731.8 PF figure]

- **Sanity-check any team-season total against a known number before trusting it.** CLAUDE.md records the 2025 5th seed at 1731.8 PF; the fixed code reproduces 1731.7 for `Jalen Kirk`. That is the cheapest regression test available for this dataset. A per-team total outside roughly 1350-2100 for a 14-week 2025 season is wrong. [verified]

- **2025 was NOT a FAAB league.** `WAIVERS_TRADITIONAL`, `isUsingAcquisitionBudget: false`. `acquisitionBudget: 100` appears in the settings but is a dead field. Every `bidAmount` is a real `0`. **The $1000 FAAB setup described in CLAUDE.md is the 2026 configuration and is NEW this year** — there is no historical bid data and none can be recovered. Do not treat `0 pts/$` as a computed ROI; `faabROI()` returns a `faab: false` flag specifically so this can never be silently misread. [verified]

- **`mTransactions2` returns an EMPTY array when called without `scoringPeriodId`** on a completed season — no error, just `transactions: []`, which reads as "this league never made a transaction." Loop the weeks (`{ sp: wk }`) instead. [verified]

- **ESPN transaction type enum is `TRADE_ACCEPT`, not `TRADE_ACCEPTED`.** The latter 400s. Full valid list is in "For the next session," item B. Same class of trap: the 400 response body helpfully enumerates the valid values, so if a filter 400s, read the `cause` field rather than guessing. [verified — this is how the list above was obtained]

- **The league communication endpoint (`/communication/?view=kona_league_communication`) 404s with "This Communication Group does not exist"** for this league, with or without a topic filter. The valid topic enum is `ACTIVITY_TRANSACTIONS` (not `ACTIVITY_TRANSACTIONAL`), but it 404s either way. **This is a dead end — do not spend time on it.** Per-week `mTransactions2` is the working path. [verified — tried four variants]

- **Lineup-slot eligibility must come from the player's `eligibleSlots` array, never inferred from position.** A bench RB cannot fill an empty WR slot. There is a `--selftest` assertion covering this. [verified]

- **Slot ids `20` (BENCH) and `21` (IR) must be excluded from any "optimal lineup" computation**, and `lineupSlotCounts` from `mSettings` includes them with nonzero counts (`20: 7, 21: 1`) — so a naive read of that object will try to "start" seven bench players. [verified]

- **2025 `matchupPeriodCount` is 14.** Weeks are 1-14 for the regular season. Playoff matchups exist in the `mMatchup` schedule beyond that and are filtered out of the schedule-luck study. [verified]

- **Team ids in this league are 1,2,3,4,6,7,8,9,10,11,12,13 — ids 5 and 14 do not exist.** Never assume a contiguous 1-12 range. [verified, carried forward from previous session]

**Carried forward, still true, from the previous session:**

- **Use an allowlist, not a denylist, when filtering positions.** D/ST players have negative `playerId`s, are excluded from batch player fetches, and fall through as `pos: '?'` — which a denylist on `'D/ST'` does not catch. This silently added 12 zero-point ghost starters once. [carried forward]
- **`mDraftDetail`'s `picks[].playerId` is negative for D/ST.** Filtered with `id > 0`. If an analysis needs 100% pick coverage (192 picks, only 178 resolve to a skill position), resolve this gap first. [carried forward]
- **QB/TE/K/D-ST make "bench vs starter" and "sleeper hit rate" style metrics structurally misleading** — shallow pools, tiny denominators, one injury promotes a backup by default. Always position-split or exclude. [carried forward]
- **`mRoster` with `&scoringPeriodId=N` returns THAT WEEK's historical lineup slots** — this is what makes week-by-week historical analysis possible at all. [carried forward, re-verified this session]
- **`kona_player_info` + `x-fantasy-filter` `filterIds` fetches any player by id** regardless of current roster — needed for players dropped mid-season. Batch size 200 works. [carried forward]
- **ESPN league views must be repeated `&view=` params, not comma-joined.** [carried forward from CLAUDE.md]

**Everything else in `CLAUDE.md` is unchanged and still applies.**

---

## Reboot / persistence

Nothing here needs to survive a restart — no server changes, no deploys, no background processes started. The work product is two committed files. Standard project persistence (launchd KeepAlive on the local server, localStorage draft state, committed JSON) is unchanged.

**One weak link:** commit `ebda30e` was not pushed as of writing. If the machine were lost, the work is local-only. Pushing also auto-deploys (per CLAUDE.md, the Vercel Git integration is live), which is harmless here since nothing in the live site's code path changed — only a script and a data file.

---

## Don't redo

- **Do not redo any of the five completed analyses.** All numbers are in `league-history-2025.json` and reproduced in the tables above. To answer a follow-up, read this file or that JSON first. Only re-run if Ethan wants a genuinely different scope (a different season, or his team only).
- **Do not re-derive the ESPN API patterns** — the weekly-roster pattern, the any-player-by-id fetch, the `statSourceId`/`scoringPeriodId`/`seasonId` filter combo, the per-week transaction loop, the transaction type enum. All captured in Gotchas.
- **Do not go looking for 2025 FAAB bid data.** It does not exist. The league did not use FAAB that year.
- **Do not try the league communication endpoint.** It 404s for this league. Four variants tried.
- **Do not re-verify that the corrected weekly numbers are right** — the 1731.7 vs 1731.8 cross-check was done.

---

## How to work with Ethan

- **Every response starts with "Ethan,"**.
- Lead with the outcome and the number, not the methodology. This session's answers led with the headline stat then supporting detail, and he did not push back once.
- Terse and direct. Define jargon inline. He is learning — terminal steps go **one command at a time**, say what he should see, then wait for his confirmation.
- Zero cost, always. This whole project is free (ESPN API, nflverse GitHub releases, no keys). If something would cost money, say so and offer the free path.
- He wants findings tied to **a decision he can make**. "Interesting" is not the bar; "here is what to do differently" is.
- He reacts to rankings and comparisons. When he asked for the ranked-by-team versions of the first two analyses, that was the format clicking — **prefer ranked tables with his own team marked** over prose summaries.
- Never re-run a failed command unchanged; after two failures of one approach, switch approaches.
- Save inline scripts to the scratchpad and invoke by path rather than re-pasting them.

---

## The next task

**Ethan's exact request, made in the same message that asked for this handoff:** *"i want to do a handoff, make sure this key data is kept somewhere so i can exit this chat and not risk losing this. perhaps also create an html thing that describes this (like a joel smythe data tiktok)."*

So there are two deliverables and **only the first is done**:

1. ~~This handoff file.~~ **DONE** — you are reading it. All key data is preserved in the tables above and in the committed `league-history-2025.json`.
2. **AN HTML DATA-STORY PAGE — NOT STARTED. This is the next task.**

What he means by "like a Joel Smyth data TikTok": Joel Smyth is a fantasy analyst whose work is already ingested into this project (see `draft-guide-smyth*.json` and CLAUDE.md's notes on his PDF and videos). His style is **a data study presented as a narrative** — a specific claim, the numbers that support it, on-screen tables and charts, landing on "so here is what you should do." Ethan is asking for these three analyses packaged that way, not a raw dump.

Guidance for building it:
- **The spine of the story is already identified** (see "Where my thinking was"): *Ethan's 2025 problem was not talent and it was not luck — it was deployment.* Act 1: he was exactly as good as his record (schedule luck −0.3, 7th of 12 in both tables — no excuse available). Act 2: he acquired talent well (48 pickups, 2nd-most, 511 points). Act 3: he started only 26% of it, the worst ratio in the league, and left 222 points on his bench. Payoff: closing half that gap is worth roughly a win, and it costs nothing.
- The strongest visual is the **lineup-accuracy vs. final-record correlation** — top 2 went 13-1 and 10-4, bottom 3 went 5-9, 4-10, 4-10.
- The most quotable individual facts: **Elic Ayomanor scored 50.2 points on his bench and never started once.** Week 4 he benched Dak Prescott for 31 points.
- **Read `~/design-taste/TASTE.md` before designing** (per Ethan's global instructions) — his logged visual references are elemental + cosmic, dark, bold type over imagery, structural motion. `~/design-taste/brandbook.html` has the actual palette and type specimens. There is also a `dataviz` skill and an `artifact-design` skill that should be loaded before writing chart code or the page.
- Publishing as an Artifact (private, shareable link) is likely what he wants since he mentioned wanting it to survive leaving the chat — but **it must be self-contained**: no external CDN, fonts, or images.
- All source numbers are in the tables in this file and, at full row-level detail, in `/Users/ethanyap/fantasy-edge/league-history-2025.json`.

**Also outstanding, lower priority:** `CLAUDE.md` has not been updated with this session's two durable gotchas (the `appliedStatTotal` cumulative trap, and 2025-not-being-FAAB). Per Ethan's global rules, a non-obvious trap that cost real effort belongs in the project's CLAUDE.md Gotchas. Worth doing before the session ends, or flagging to `/improve`.
