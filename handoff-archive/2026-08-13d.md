# Fantasy Edge — Handoff (Aug 13 2026, session 3)

Project: `/Users/ethanyap/fantasy-edge`. **Read `CLAUDE.md` in that folder first** — stack, deploy steps, and a long Gotchas list this file does not repeat.

Previous handoff archived at `handoff-archive/2026-08-13c.md`. Everything in it that is still true is carried forward below — **do not go read it**, it describes the handcuff study as the one remaining open task and blocked on a decision. It is neither. It is built and shipped.

Ethan's standing goal for this whole line of work, in his words: **"rigorous data analytics" that "translate to winning results."** Actionable findings tied to a decision he can make, not trivia.

Note the file is `HANDOFF.md` (uppercase) in git. macOS is case-insensitive so `handoff.md` also resolves — don't create a second lowercase copy, you'll be editing the same tracked file.

---

## TL;DR

1. **NINE analyses are DONE with committed numbers. There is no open analysis queue.** Seven live in `scripts/league-history.js`; the eighth (`--handcuff-teams`) was added there this session; the ninth is the NFL-wide `scripts/handcuff.js`. **Do not redo any.**
2. **The RB handcuff question — the only thing the last handoff left open — is answered.** Ethan chose definition (a), "becomes a startable RB." **Handcuffs hit 63%, speculative RB sleepers hit 18.8%, 3.4x better.**
3. **The postmortem page went 5 acts → 6.** New Act VI is the handcuff study. Shipped to **both** homes (repo/live site AND the claude.ai artifact — they do not sync, see Gotchas).
4. **Everything is committed and pushed.** `git push` auto-deploys this project.
5. **Nothing is blocked on Ethan.** No decision is pending.
6. Season used for all league studies: **2025**. The handcuff study uses **2023–2025** NFL data.

---

## What was accomplished this session

Ethan opened with "read handoff what is left to be done", was told the handcuff study was the only item and was asked the "hit" definition. He picked **(a) becomes a startable RB (top-24)** — the recommended option, which reuses `STARTABLE` — and replied "hit" to confirm.

### Study 8 — `scripts/handcuff.js` (NFL-wide)

New standalone script. Free, local, no key — imports `weekly()` from `boom-rates.js` rather than duplicating the nflverse loader.

**Definitions, all deliberate:**
- **starter** = per team per week, the RB with most carries over his last 3 played weeks (rolling, so a mid-season change of hands is caught).
- **out-window** = 2+ **consecutive** weeks the starter has no row. **Two is the floor because a bye week is exactly one** — a 1-week rule would count every bye in the NFL as an injury. There is a selftest for this.
- **handcuff** = the RB who actually took the carries in that window. **The realized handcuff, not the preseason-expected one.**
- **HIT** = that back was a top-24 RB (ranked within each week, same rule as boom-rates) in **half or more** of the window's weeks.

**Result: 29 hits / 46 windows = 63.0%.** Against `--sleeper-hit-rate`'s RB figure of 18.8%, that is **3.4x**.

| Season | Windows | Hit | Rate |
|---|---|---|---|
| 2023 | 19 | 12 | 63.2% |
| 2024 | 17 | 11 | 64.7% |
| 2025 | 10 | 6 | 60.0% |
| **All** | **46** | **29** | **63.0%** |

**Why three seasons and not one:** 2025 alone gives 10 windows. That is too thin to quote a rate off. The year-to-year stability (a six-point band) is what makes the number usable — if it swung 30→90% it would be noise. `[verified]`

**The honest limit, stated on the page and in the memory file:** 63% is the rate for the back who *actually* took the carries. Who was drafted as the handcuff in August is **not recoverable from this data**. Present it as the ceiling on a correct pick, never the floor on any pick.

### Study 9 — `--handcuff-teams` in `league-history.js`

Ethan then asked for the per-team rankings (offered at the end of the previous answer, he took it). Joins the NFL windows onto the league's weekly ESPN rosters.

**He owned exactly one handcuff in 2025 and benched it.**

| # | Team | Owned | Started/benched wks | Pts started | Pts benched | Start rate |
|---|---|---|---|---|---|---|
| 1 | Lamar-a-lago | 3 | 6 / 3 | 93.9 | 12.4 | 66.7% |
| 2 | Jalen Kirk | 4 | 5 / 5 | 81.7 | 45.5 | 50.0% |
| 3 | Damardiac Arrest | 1 | 6 / 2 | 75.8 | 5.2 | 75.0% |
| 4 | Dart that Dihker in KaiME | 2 | 6 / 0 | 56.3 | 0 | 100% |
| 5 | Nico Suave | 3 | 2 / 3 | 55.1 | 22.0 | 40.0% |
| 6 | Myer Lemon | 1 | 2 / 0 | 45.0 | 0 | 100% |
| **7** | **Bucky Irving 🤤 (ETHAN, team id 1)** | **1** | **0 / 1** | **0.0** | **22.8** | **0%** |
| 8 | EaTN McCokkey | 1 | 0 / 1 | 0.0 | 20.7 | 0% |
| 9–12 | Njigbas in Paris, 2 gurls 1 kupp, Ashton of Ass, Skat's Super CTE | 0 | — | 0 | 0 | n/a |

Rank on **pts started** (higher better). **`startRate` is `null`, not 0, for a team that owned none** — a manager who never had the chance did not fail at it. Same "absence casts no vote" rule as everywhere else in this repo.

**The three findings that matter:**
1. **His one handcuff was Kimani Vidal** (Hampton's replacement, wks 6–13). Owned one week, benched, 22.8 pts. **Dart that Dihker had the same player and started him five weeks for 56.3.** Vidal was *already* named in Act IV as a bench failure — this is the same failure seen from a second angle.
2. **Handcuffs sat free on the wire.** Michael Carter unowned 5 of 11 weeks, Vidal 1. Nobody in this league was playing this strategy.
3. **The two 100% start rates belong to teams that owned fewer.** Volume without deployment, again.

**Jalen Kirk is the one manager actually running the strategy** — 4 handcuffs (RJ Harvey/Dobbins, Kareem Hunt/Pacheco, Michael Carter/Conner, Rico Dowdle/Hubbard), but only a 50% start rate. Ethan asked for this breakdown specifically; it's in `league-history-2025.json` under `handcuffTeams.byTeam[].handcuffs`.

**Coverage: 9 of 10 windows.** Kenny Gainwell (Warren's replacement) was never rostered by anyone all season — reported in `unmatched`, never silently dropped.

### The postmortem page — Act VI

`site/2025-postmortem.html` went 5 acts → 6. New **Act VI** ("Handcuffs hit 63% of the time. Your late-round dart throws hit 19%") with the season table, the 2025 examples, and an explicit honest-limits section. The verdict went from five priorities to six — "Spend late picks on handcuffs, not sleepers" inserted at #5, ahead of "trust the draft board." Standfirst and footer updated (the footer now flags Act VI as the one act that is not league data).

**Shipped to both homes.** Repo copy pushed (auto-deploys); artifact republished at the same URL.

**The per-team table from Study 9 is NOT on the page yet.** Ethan was asked and moved on to the Jalen Kirk question instead. It is the obvious next addition if he wants one.

---

## State

| Thing | State | Confidence |
|---|---|---|
| Git | Clean, all pushed. 4 commits this session: `0d68c71` (handcuff study), `0856836` (Act VI), standfirst fix, and the per-team study + merge fix. | [verified — `git status`, `git push` succeeded] |
| `scripts/handcuff.js` | New. `--selftest` passes. Defaults to 3 seasons; `SEASONS=2025` env overrides. Exports `{handcuffs, weekly, WEEKS, STARTABLE_RB}`. | [verified — ran both] |
| `scripts/boom-rates.js` | Two small edits: `weekly()` rows now carry `team`+`carries` (unused there), and `main()` is behind a `require.main === module` guard so importing it doesn't kick off a run. `--selftest` still passes. | [verified — ran] |
| `scripts/league-history.js` | 8 studies now. `--handcuff-teams` added. Two new selftest asserts for name normalising. | [verified — ran] |
| `league-history-2025.json` | All 9 keys present (8 studies + `generated`). | [verified — key list printed] |
| Live route `/2025-postmortem` | Unchanged mechanism, new content, pushed. | [pushed; live render NOT eyeballed this session] |
| Artifact copy | `https://claude.ai/code/artifact/5040c067-4f88-47c9-93e5-602df3f80bad` — republished with 6 acts. | [verified — publish succeeded] |
| Auto-memory | New file `handcuffs-beat-sleepers.md` + MEMORY.md index line. | [verified] |
| Cost | Zero. nflverse GitHub release files + ESPN API. No keys, no new services. | [verified] |

---

## Where my thinking was

**On the output-file bug, which is the most important thing in this handoff.** Running `--handcuff-teams` alone **overwrote** `league-history-2025.json`, wiping the other seven studies. It was pre-existing (every single-study run did this), it produced **valid JSON** so nothing errored and the file still looked complete, and I only caught it because I printed the key list. It now merges the previous file. **If any future study is added, keep the merge.** `[verified — key list before and after]`

**On why I widened to three seasons.** The first run was 2025-only: 10 windows, 60%. I did not trust a rate off 10 events and said so before quoting it. Three seasons gives 46 and the stability is itself the evidence. **A one-season version of this number should not be presented to him.**

**On the realized-vs-expected handcuff distinction.** This is the single most misleadable part of the study. The data can tell you who *took* the carries; it cannot tell you who was *drafted* as the handcuff. Every presentation of 63% has to carry that caveat or it becomes a promise it can't keep. It's on the page, in the script header, and in the memory file.

**On `startRate: null`.** Four teams owned zero handcuffs. Reporting them as 0% start rate would rank them alongside Ethan and EaTN, who owned one and sat it — a completely different failure. Same family as the boom-rate and analyst-vote rules already in CLAUDE.md.

**On what I did not verify.** The live page render. `playwright-core` is still not installed in this repo (carried forward from last session, still true). I did a static structural check instead — tag balance plus per-table column counts, all 8 tables clean. **Act VI's visual layout is unverified in a browser.** `[unverified]`

**On the name-matching.** ESPN vs nflverse spellings are handled by a `norm()` + `NICK` map copied in spirit from `boom-rates.js`. Only one 2025 handcuff went unmatched (Gainwell) and I confirmed it's genuine non-ownership rather than a spelling miss by checking he isn't on any roster under a variant. A wrong `NICK` entry would graft one player's weeks onto another — **confirm both spellings before adding one.**

---

## For the next session

**There is no queued analysis.** Everything Ethan has asked for is built. Options if he wants more, none of them requested:

- **Put the per-team handcuff table into Act VI.** He was offered it and didn't answer before changing topic. Lowest-effort, highest-fit.
- **Forward test of the consensus board.** The 2025 backtest is permanently impossible (see Don't Redo). A forward test is the only real one. **He chose the degraded backtest instead last session and has not asked for this.**
- **Install `playwright-core`** if visual verification of the postmortem starts mattering.
- **Measure greedy vs optimal in `bestLineup()`.** Error direction is already known and safe (greedy can only under-state points left on the bench). Low value.

---

## Gotchas

**New this session:**

- **A single-study run used to CLOBBER `league-history-<season>.json`.** It wrote `{generated, thatOneStudy}` over a file holding seven others. Valid JSON, no error, looks complete. **Now merges the previous file — keep it that way.** [verified]

- **`boom-rates.js` main() is now behind `require.main === module`.** Without that guard, `require('./boom-rates')` from `handcuff.js` would kick off a full boom-rate run as a side effect of an import. The same trap is why `boom-rates.js` originally copied `csvSplit` from `draft-research.js` instead of importing it — **`draft-research.js` still runs its CLI dispatch at require time and must not be imported.** [verified]

- **A bye week is exactly one missed week.** Any "player missed games" rule built off absence-of-a-row **must** require 2+ consecutive weeks or it counts every bye in the NFL as an injury. `MIN_OUT = 2` in handcuff.js, with a selftest fixture that fails if it drops to 1. [verified]

- **63% is the REALIZED handcuff rate, not the drafted-handcuff rate.** The data names who took the carries, not who was drafted to. Never present it as a guarantee for a specific August pick. Committee backfields (ARI, NYG 2025) are where it breaks. [verified]

- **`startRate` must be `null`, not 0, for a team that owned no handcuffs.** Zero would rank "never had the chance" alongside "had it and sat it." Same rule as absent analysts and missing boom rates. [verified]

- **Artifact publishing requires this session to have read the artifact first.** The `Artifact` call failed with "hasn't viewed the latest version" even though nothing had changed it — it's a per-session read guard, not evidence of a conflicting edit. `WebFetch` the URL, then republish. **Do not reach for `force: true`.** [verified — happened this session, contents were identical]

**Carried forward, still true (full list in CLAUDE.md):**

- **`site/2025-postmortem.html` has TWO homes that do not sync.** Repo copy ships via `git push`; the artifact needs a separate `Artifact` call passing `url: https://claude.ai/code/artifact/5040c067-4f88-47c9-93e5-602df3f80bad`. Publishing without that `url` creates a *separate* artifact. Ethan has hit this confusion directly before.
- **That file is artifact-shaped on purpose** — no doctype, no `<head>`. The server route sends `Content-Type: text/html; charset=utf-8` explicitly; without it the 🤤 and every en-dash render as mojibake. Don't "fix" it by adding a doctype.
- **`playwright-core` is not installed here** despite CLAUDE.md documenting a workflow using it.
- **ESPN preseason projections are systematically inflated** — every team finishes under. Center on the league mean.
- **`playerPoolEntry.appliedStatTotal` on a week-scoped `mRoster` call is CUMULATIVE.** Use `weekPts()`. Sanity-check team-season totals against the known 1731.8 figure.
- **`statSplitTypeId` is a fourth stat discriminator** — 0 = season total, 2 = per game, a silent ~20x error.
- **Trade contents are participant-only**; league-wide trade net-points is impossible.
- **2025 was not a FAAB league.** No bid data exists, don't look.
- **nflverse weekly files include postseason rows** — filter `season_type == REG`.
- **Lineup eligibility comes from `eligibleSlots`**, never inferred from position; exclude slots 20/21.
- **Team ids are 1,2,3,4,6,7,8,9,10,11,12,13** — 5 and 14 do not exist.
- **2025 `matchupPeriodCount` is 14.** NFL windows past week 14 are clipped in `handcuffTeams()` — there is no roster to judge them against, so they are not counted as misses.

---

## Reboot / persistence

Everything durable is committed and pushed to `origin/main`; `git push` auto-deploys via the Vercel Git integration, so the live site already has Act VI.

**Weak links:**
- The claude.ai artifact lives only on Anthropic's servers, not in git. `site/2025-postmortem.html` is the source of truth.
- No background processes started this session. The always-on LaunchAgent on port 4650 was never touched and **is still running older code**. If localhost misbehaves, check `lsof -ti:4650` for an orphaned `node server.js` (PPID 1).
- `.nflverse-cache` now holds the 2023/2024/2025 weekly CSVs. Gitignored, re-downloadable, safe to delete.

---

## Don't redo

- **Do not redo any of the nine analyses.** Numbers are in `league-history-2025.json` and the tables above.
- **Do not attempt the consensus draft-board backtest.** Proven impossible — every analyst file first appears in git in Aug 2026.
- **Do not go looking for 2025 FAAB bid data.** It does not exist.
- **Do not go looking for other teams' trade contents.** ESPN scopes them to participants.
- **Do not try the league communication endpoint.** 404s, four variants tried.
- **Do not re-run the handcuff study on one season** and quote the result.
- **Do not re-derive the ESPN API patterns** — all in CLAUDE.md Gotchas.

---

## How to work with Ethan

- **Every response starts with "Ethan,"**.
- **Lead with the outcome and the number**, not the methodology.
- **He reacts to rankings.** Full 12-team tables with his own team marked, over prose. He asked for this explicitly and it is standing.
- **State sign conventions and direction explicitly** in any table with directional values — he has caught an ambiguous one before.
- Terse and direct. Define jargon inline. Terminal steps **one command at a time**, then wait.
- **Zero cost, always.**
- He wants findings tied to **a decision he can make**. "Interesting" is not the bar.
- **He follows a thread.** This session he went headline → per-team ranking → one specific manager's detail. Keep the row-level data queryable in the JSON rather than only printing summaries.
- Never re-run a failed command unchanged; after two failures of one approach, switch.

---

## The next task

**None assigned.** He ended the session by asking for this handoff and said he'd open a new chat. Open by asking what he wants next rather than starting anything — the analysis queue is genuinely empty for the first time in this line of work.

If he wants a suggestion, the per-team handcuff table in Act VI is the smallest useful thing outstanding.
