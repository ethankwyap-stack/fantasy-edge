# Fantasy Edge — Handoff (Aug 12 2026)

Project: `/Users/ethanyap/fantasy-edge`. **Read `CLAUDE.md` in that folder first** — stack, deploy steps, and a long Gotchas list this file does not repeat.

Previous handoff (Aug 8, deploy-trigger fix) archived at `handoff-archive/2026-08-12a.md` — nothing in it is relevant to this thread; it was pure infra housekeeping, already done, not touched this session.

Ethan asked "how much does bench talent actually matter," which turned into a broader "what data analysis can I do with league history to actually win this year" conversation. The two completed analyses started as ad-hoc scratchpad one-liners, then got promoted into a real, committed script (`scripts/league-history.js`) plus a committed results file (`league-history-2025.json`) once Ethan asked to make sure the session's work wasn't lost. **Re-run anytime with `node --env-file=.env scripts/league-history.js --all`** — no re-derivation needed.

---

## TL;DR

1. **Two analyses are DONE and have real numbers** (see below) — don't redo them, just reference the results if Ethan asks follow-ups. Everything else is queued, not started.
2. **Seven analyses are queued, in Ethan's stated priority order** (his exact words, lightly organized):
   1. Points-left-on-bench audit, full season, his team specifically (not just Week 1)
   2. Schedule luck vs. skill (all-play record)
   3. FAAB ROI (waiver bid $ vs. points gained)
   4. Consensus draft-board backtest (does the site's blended rank beat ESPN-alone/ADP-alone?)
   5. Trade accuracy — which historical trades won/lost and why, to learn from it
   6. Projection accuracy — ESPN preseason projections vs. actual results
   7. **RB handcuff hit-rate** — added mid-session, not yet scoped in detail (see its own section below). Ethan's framing: "injuries always happen (running backs especially) so how valuable is a handcuff and what is the percentage that they hit."
3. **Season used: 2025** (most recent completed season on this league — 2026 was just drafted Aug 2026 and hasn't played a game). All six queued analyses should default to 2025 unless Ethan says otherwise.
4. **Scope for queued items 1-6: whole league**, same as the two completed ones, unless Ethan narrows it (he explicitly said "whole league" for the first two; assume same default for the rest, confirm if unsure).
5. **The two completed analyses already surfaced real actionable numbers** — worth leading with those in the next session rather than diving straight into new fetches, in case Ethan wants to react to them first (e.g. "which team was Ethan's?" wasn't established this session — see Open Questions).

---

## What was accomplished this session

Two analyses, both against **2025 season, ESPN league 916578979, all 12 teams**.

### 1. Week-1 bench vs. starter value (does "wasted bench talent" matter?)

Compared Week-1 starting lineups to full-season point totals for every drafted player, split starter vs. bench.

**Result:** with QB/K/D-ST excluded (backup QBs distort bench averages since only 1 QB slot exists), Week-1 **starters averaged 195.0 season-end points** vs. **114.8 for bench** (skill positions, RB/WR/TE only, n=72 starters / n=71 bench). Only 2 of 12 teams had bench skill players outscore starters on average. **Conclusion: Week-1 start/sit calls were mostly right — benching worked as intended, on average.**

Individual misses that did happen (bench guys who ended up producing): Chris Olave (268 pts, Rd8), Travis Etienne (253.9, Rd9), Javonte Williams (242.8, Rd10), Courtland Sutton (219.7, Rd4), Jaylen Warren (217.1, Rd8), Stefon Diggs (210.3, Rd7) — notably these were mostly solid Rd4-9 picks buried behind an even better player on a stacked roster, not "should've known" mistakes.

Worst Week-1 starters in hindsight: James Conner (33.3 pts, injury), Tyreek Hill (53.5), Malik Nabers (57.1), Travis Hunter (63.8) — mostly unpredictable busts/injuries, not bad process.

### 2. Draft-round "upside/sleeper pick" hit rate

Reframed per Ethan's clarification: not about Week-1 lineup decisions, but about **draft-day speculative picks** — players drafted outside the "startable" positional range (QB13+, RB25+, WR25+, TE13+ for a 12-team league) — and whether they actually became usable (finished season back inside that range).

Method: ranked all 178 skill-position draft picks (of 192 total; D/ST and a couple edge cases excluded, see Gotchas) by both **draft-day positional rank** (order picked among same-position players, via `overallPickNumber`) and **season-end positional rank** (by `appliedTotal` points).

**Result: league-wide hit rate 26/94 (27.7%)** of "upside" picks panned out. But that's inflated by shallow QB/TE pools (small denominator, one injury promotes a backup "by default"):

| Position | Bench/upside picks | Panned out | Hit rate |
|---|---|---|---|
| RB | 32 | 6 | **18.8%** |
| WR | 43 | 9 | **20.9%** |
| QB | 12 | 6 | 50.0% (shallow pool — inflated) |
| TE | 7 | 5 | 71.4% (tiny sample — inflated) |

**The real number for "sleeper" strategy (RB/WR): ~1 in 5 hits.** Biggest hits: George Pickens (WR32→WR5), Chris Olave (WR40→WR6), Travis Etienne (RB34→RB10), Wan'Dale Robinson (WR63→WR13), Quinshon Judkins (RB50→RB24, barely made it).

By team, best upside-pick hit rate: "Ashton of Ass" 4/7 (57%) — Caleb Williams, Stafford, Olave, Javonte Williams all hit. Worst: "Njigbas in Paris" and "Jalen Kirk", 1/9 each.

Full team names in this league (funny/normal mix, verified this session): Bucky Irving 🤤 (id1), Nico Suave (id2), Dart that Dihker in KaiME (id3), Jalen Kirk (id4), Njigbas in Paris (id6), 2 gurls 1 kupp (id7), Myer Lemon (id8), Ashton of Ass (id9), Damardiac Arrest (id10), Lamar-a-lago (id11), Skat's Super CTE (id12), EaTN McCokkey (id13). **Note: team ids 5 and 14 don't exist** — not investigated, just noted as observed via `mTeam`.

---

## State

| Thing | State | Confidence |
|---|---|---|
| `scripts/league-history.js` | Committed. Reproduces both completed studies: `--bench-value`, `--sleeper-hit-rate`, `--all`, `--selftest` (no network). `--season YYYY` flag, defaults 2025. Has a real bug already found-and-fixed this session (see Gotchas — D/ST ghost-starter bug) — trust the current committed version, not the numbers from earlier in this chat's raw tool output if they ever disagree. | [verified — ran twice, second run matches the numbers below] |
| `league-history-2025.json` | Committed output of `--all` — both studies' full row-level data, not just the summary stats quoted in this file | [verified — this session's actual run] |
| Original scratchpad one-liners (`bench-analysis.js`, `wk1-results.json`, etc.) | Superseded by the script above — those were session-specific temp files, already gone, don't look for them | [n/a, intentionally not preserved] |
| Repo / git | `scripts/league-history.js`, `league-history-2025.json`, `HANDOFF.md`, `handoff-archive/2026-08-12a.md` staged this session — **confirm they got committed**, check `git log -1` | [staged, not yet confirmed committed — verify first] |
| `.env` has `LEAGUE_ID`, `ESPN_S2`, `SWID`, `SEASON=2026` | Confirmed present and working for 2025 queries (season is a query param, not tied to `.env`'s `SEASON`) | [verified] |
| Deploy trigger, live site, etc. | Unchanged from Aug 8 handoff — still working, not touched | [carried forward, not re-verified this session] |

---

## Where my thinking was

**On which team is Ethan's.** Never established this session — Ethan asked league-wide questions throughout, never said "show me my team." CLAUDE.md's Gotchas say "Ethan is ESPN team #1 (name changes each season)" — so team id 1, "Bucky Irving 🤤", in the 2025 data pulled this session. **Worth confirming, not assuming** — team names are manager-editable and CLAUDE.md explicitly warns names drift, but id-1-is-Ethan should still hold since ESPN team ids are stable per franchise slot. Cross-check against `members[].displayName`/`isLeagueManager` if it matters for a specific analysis (e.g. the queued trade-accuracy or FAAB-ROI items will want to filter to "my team" at some point even though today's scope was whole-league).

**On why 2025 and not 2026.** 2026 was just drafted (per CLAUDE.md: "Draft completed Aug 2026") and no games have been played — there's no "end of season" yet. 2025 is the only season with a complete draft-to-finish arc to analyze. This should hold for all six queued items too.

**On the QB/TE inflation problem.** Both completed analyses hit the same trap: shallow positions (QB, TE, D/ST, K) make "bench" or "sleeper" comparisons misleading because the startable cutoff is close to the total draftable pool. Worth deliberately excluding or footnoting QB/TE/K/D-ST in the queued items too, especially **#6 (projection accuracy)** and **#3 (FAAB ROI)** where the same shallow-pool skew could produce a misleadingly rosy or harsh number if not position-split.

**138 vs 192 picks caveat (unresolved, low-stakes).** `mDraftDetail` returned 192 total picks; only 178 resolved to a skill position (QB/RB/WR/TE) via `kona_player_info`. The gap is mostly D/ST (excluded on purpose — negative playerIds, not fetched) but there may be 1-2 K or unusual entries in there too — not chased down, didn't matter for either completed analysis. If a future analysis needs 100% pick coverage (e.g. draft-capital-by-position vs. final standing, mentioned but not queued), re-check this gap first.

---

## For the next session to figure out

**Six queued analyses, in priority order Ethan gave.** For each: the open design questions worth resolving before running it (I have opinions below, marked so they're easy to skim/skip).

### 1. Points-left-on-bench audit, full season (his team, all weeks — not just Week 1)
- Need per-week roster snapshots (`mRoster` + `scoringPeriodId=N` for N=1..17ish, same pattern discovered this session — see API Patterns below) crossed with each week's *actual* points (statSourceId=0, scoringPeriodId=N — NOT season total).
- Design call: "best possible lineup" needs real lineup-slot-eligibility logic (a bench RB can't fill an empty WR slot). `eligibleSlots` is on the player object (seen this session, e.g. Dak Prescott's `eligibleSlots":[0,7,20,21]`) — use it, don't assume position = slot.
- Suggest: scope to Ethan's team only first (fast, directly actionable), whole-league as a stretch goal.

### 2. Schedule luck vs. skill (all-play record)
- Needs every team's weekly score (mMatchup/mBoxscore by week) — compute actual W-L vs. "played every team every week" W-L.
- Ties directly to the **`playoffSeedingRule: TOTAL_POINTS_SCORED` is a tiebreaker, not primary** gotcha already in CLAUDE.md (seeding is record-first) — this analysis is the natural companion to that finding, worth cross-referencing.

### 3. FAAB ROI (waiver bid $ vs. points gained)
- Needs transaction history — **not yet explored this session, unknown ESPN view for this.** Likely `mTransactions2` or similar (untested). Will need `bidAmount` per FAAB win, plus points scored by that player in the weeks after acquisition (probably: from acquisition week to when dropped, or to season end).
- Design call: what's the "points gained" window? Full rest-of-season vs. just games played before being dropped again. Ask Ethan or make a reasonable default and flag it.

### 4. Consensus draft-board backtest
- This one's different from the other five — it validates the **live site's own code** (`consensus()` in `index.html`, described at length in CLAUDE.md's Gotchas). Needs `analyst-ranks.json` + ESPN + ADP as they existed at 2025 draft time (or as close as can be reconstructed — draft-guide files may have been updated since, worth checking git history/dates) vs. 2025 actual finish.
- Caveat: the analyst-rank files in the repo now are the *current* (2026 draft) versions — may not reflect what existed for the 2025 draft. Check git log on `analyst-ranks.json`/`draft-guide*.json` for 2025-era commits before assuming today's files are a valid backtest input.

### 5. Trade accuracy — did past trades actually win, and why
- Needs `mTransactions2` (trades specifically) for 2025, then same "points after the fact" comparison as FAAB ROI. Should reuse whatever transaction-fetching code gets built for #3.
- "Why" is the qualitative part — once the winners/losers are identified, look at what made the winning side's players outperform (workload, injury luck, scheme fit) rather than just reporting the point differential.

### 6. Projection accuracy — ESPN preseason projection vs. actual
- Simplest of the six, mechanically: `stats[]` entries with `statSourceId=1, seasonId=2025, scoringPeriodId=0` (preseason projection) vs. `statSourceId=0` (actual) — **both already pulled and printed this session** (see the Dak Prescott sample JSON in this session's tool output, both stat entries visible side by side). Just needs to be done at scale across all drafted players and compared/plotted.
- Natural pairing with #4 (consensus backtest) — could share the "draft-time expected value" computation.

### 7. RB handcuff hit-rate (added mid-session, lowest-scoped so far)
- Ethan's framing, verbatim: "injuries always happen (running backs especially) so how valuable is a handcuff and what is the percentage that they hit." This was raised as a conceptual question mid-conversation, not yet run — no fetches done, no numbers exist yet for this one.
- **Definitions to nail down with him or via reasonable default, before building:**
  - "Handcuff" = the backup RB on the same NFL team as a startable RB who was drafted, typically a late-round/waiver pick. Needs an RB depth-chart-by-team mapping — likely derivable from `proTeamId` grouping across drafted RBs, cross-checked against snap-share/usage data (the repo's `boom-rates.js`/nflverse snap_counts pipeline already does something adjacent — check `scripts/boom-rates.js` before building this from scratch, per the ladder in ponytail: reuse before rewrite).
  - "Hit" = ambiguous, needs a definition. Candidates: (a) handcuff becomes startable (top-24 RB, same cutoff used in analysis #2 this session) for some stretch after the starter is injured, (b) handcuff outscores what the drafted starter would have scored over the injury window, (c) simple binary — did the starter miss 2+ games AND did the handcuff see meaningful volume (e.g. 15+ carries) in that window. **Ask Ethan which he means, or pick (a) since it reuses the startable-cutoff logic already built for analysis #2 in this session.**
  - Needs injury data — CLAUDE.md already documents `/api/nfl?feed=injuries` (ESPN's free public injury feed, slimmed server-side) as an existing, working source. That's the natural injury-window input rather than re-deriving from scratch.
- **Why this matters for "winning this year" (Ethan's stated goal for the whole line of analysis):** directly informs draft strategy — is it worth a late-round pick / a bench spot on a proven starter's backup, or is that draft capital better spent on an unrelated upside flier (ties directly back to analysis #2's ~1-in-5 sleeper hit rate from this session — worth comparing the two hit rates side by side once both exist).

---

## The decision still open

None of the six are blocked on a decision — they're blocked on being built. Ethan has already prioritized them in the order listed. Start with #1 unless he says otherwise when the new chat opens.

---

## Gotchas

**New this session (add to CLAUDE.md if any of these prove durable across the next 6 analyses — not added yet, this was pure ad-hoc analysis):**

- **`mRoster` view, when called with `&scoringPeriodId=N`, returns that week's historical lineup** (`lineupSlotId` per player as it was that week) — this is NOT the same as the default `mRoster` call, which returns the *current* roster/lineup only. This is the key that makes any week-by-week historical lineup analysis possible. Verified: `scoringPeriodId=1` on a 2025 query returned Week-1 slot assignments even though the season is long over.
- **`kona_player_info` + `x-fantasy-filter: {"players":{"filterIds":{"value":[...]}}}` header fetches name/position/full stats for ANY player by id**, independent of whether they're on a team's *current* roster — necessary for players who were dropped/traded away mid-season and wouldn't show up in a "current roster" query. Batch size 200 worked fine in one call.
- **Season-total actual points** = `stats[]` entry with `statSourceId:0, scoringPeriodId:0, seasonId:<year>` (`appliedTotal`). **Preseason/current projection** = same shape but `statSourceId:1`. Both coexist in the same player's `stats[]` array — filter carefully, same rule as the existing `seasonId` gotcha in CLAUDE.md but now also needs a `statSourceId` filter depending on projection-vs-actual intent.
- **Lineup slot ids used this session**: `0`=QB, `2`=RB, `4`=WR, `6`=TE, `23`=FLEX, `16`=D/ST(starter), `17`=K, `20`=BENCH, `21`=IR. (`defaultPositionId` on the player object, separate numbering, is 1=QB/2=RB/3=WR/4=TE/5=K — don't confuse the two id systems, they look similar but aren't.)
- **QB/TE/K/D-ST "bench" or "sleeper" comparisons are structurally misleading** — shallow position pools inflate hit-rate-style metrics. Always split by position and treat QB/TE separately, or exclude them, when doing bench-vs-starter or draft-round-vs-finish analysis. Both completed analyses this session had to do this after an initial pass looked artificially rosy for QB.
- **D/ST players (negative playerId) silently fall through `fetchPlayerTotals`** (they're excluded from the batch fetch, same as the draft-picks gotcha below) — in the bench-value study this showed up as `pos:'?'` on the fallback object, and an early version of the script filtered bench/starter skill positions with a *denylist* (`pos !== 'D/ST'`), which does NOT catch `'?'` — result: 12 zero-point D/ST "starters" (one per team) silently dragged the starter average from 195.0 down to 167.1. **Fixed** by switching to an allowlist (`['RB','WR','TE'].includes(pos)`) in `scripts/league-history.js`. If any of the queued analyses re-derive a similar starter/bench split, use an allowlist, not a denylist, for the same reason.
- **mDraftDetail's `picks[].playerId` is negative for D/ST** — filtered out with `id > 0` this session; not investigated further since D/ST wasn't relevant to either analysis, but the next session should handle this properly if any queued item needs full 192-pick coverage.

**Everything in `CLAUDE.md` is otherwise unchanged and still applies** — not re-verified this session since no code was touched, just read for the ESPN API shape/season conventions.

---

## Reboot / persistence

N/A this session — no server changes, no deploys, nothing that needs to survive a restart. Standard project persistence (launchd KeepAlive, localStorage draft state, committed JSON files) unchanged from prior handoffs.

---

## Don't redo

- **Don't redo the two completed analyses** (Week-1 bench-vs-starter value, draft-round sleeper hit rate) — results are captured in full above with exact numbers. If Ethan asks a follow-up on either, answer from this file first; only re-run the fetch if he wants different scope (e.g. "just my team" or a different season).
- **Don't re-derive the ESPN API patterns** (`mRoster&scoringPeriodId=N` for historical lineups, `kona_player_info` + `x-fantasy-filter` for any-player-by-id stats, the `statSourceId`/`scoringPeriodId`/`seasonId` filter combo) — all captured under Gotchas above, tested and confirmed working this session.

---

## How to work with Ethan

Same as prior handoffs (not re-derived, carried forward from CLAUDE.md's global instructions + past sessions): every response starts with "Ethan,", he's cost-sensitive (though this whole project is already zero-cost — ESPN API is free, no new services needed for any of the six queued items), terse and direct, lead with the outcome/number not the methodology walkthrough (this session's answers led with the headline stat, then supporting detail — matched well, no correction from him). He explicitly asked for "rigorous data analytics" that "translate to winning results" — he wants actionable findings, not just interesting trivia, so keep tying every result back to a decision he can actually make (start/sit process, FAAB bid sizing, trade evaluation, trust in the draft board).

---

## The next task

**Build analysis #1 first: full-season points-left-on-bench audit, Ethan's team (ESPN team id 1 — confirm this is still him before running), 2025 season, all weeks.** Then proceed down the list (#2 schedule luck, #3 FAAB ROI, #4 consensus backtest, #5 trade accuracy, #6 projection accuracy) unless Ethan reprioritizes when the new chat opens. Open with: "Ethan, I have the handoff from the bench-value analysis session — want me to start with the full-season points-left-on-bench audit for your team?" rather than assuming silently.
