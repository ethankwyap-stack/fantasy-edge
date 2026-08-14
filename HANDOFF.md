# Fantasy Edge — Handoff (Aug 13 2026, session 5)

Project: `/Users/ethanyap/fantasy-edge`. **Read `CLAUDE.md` in that folder first** — stack, deploy steps, and a long Gotchas list this file does not repeat (this session added one new entry to it, see Gotchas below).

Previous handoff archived at `handoff-archive/2026-08-13-session4.md`. Everything in it that's still true is carried forward below — **do not go re-read it**, this file supersedes it. Note the file may be tracked as `HANDOFF.md` (uppercase) in git; macOS is case-insensitive so `handoff.md` also resolves — don't create a second lowercase copy.

Ethan's standing goal, in his words: **"rigorous data analytics" that "translate to winning results."** Actionable findings tied to a decision he can make, not trivia.

---

## TL;DR

1. **Code is WRITTEN and VERIFIED but NOT COMMITTED, NOT PUSHED, NOT LIVE.** `git status` shows 3 modified files, uncommitted. This is different from session 4, which shipped everything. **First thing to check: has Ethan asked for a commit yet, or does he still want to review/extend first?** He explicitly asked to defer one more piece of work (see #3) before wrapping — don't commit/push without checking whether he wants that folded in first, or wants it as a separate commit.
2. **This session did two things:** (a) ran a rigorous backtest series answering "does strength-of-schedule (SoS) actually predict fantasy performance," landing on a nuanced, position-and-role-specific answer; (b) built that finding into a real feature — `scripts/lineup-alert.js` now also sends a **bell-cow RB matchup note** on top of its existing Sunday lineup-gap alert.
3. **One deferred task, explicitly requested, not yet started:** feed a *rest-of-season* version of the same bell-cow RB SoS signal into the trade finder's `_cval` (private valuation) in `index.html`. Ethan said "build it later add to handoff" — this is that later. Full spec in "The next task" below.
4. **Nothing from session 4 was touched or broken.** Win-probability Start/Sit tab, K/D-ST variance, the lineup-alert cron itself — all untouched.
5. **The decision still open:** none from Ethan's side on what was built — he approved every step live (asked clarifying questions via AskUserQuestion, got answers, built accordingly). The only open thing is **whether/when to commit** — ask him.

---

## What was accomplished this session

Ethan asked how the existing `--playoff-sos` study (weeks 15-17 strength-of-schedule) is evaluated, then pushed for an escalating series of backtests to check whether it's actually accurate. This was NOT proactively suggested — he drove every step (see the exact sequence below), which matters for tone: don't re-propose this whole arc as if it were a suggestion, it's already-completed work he asked for directly.

### Backtest series (four one-off scratch tests, none committed — by design, "before you save it, run a test" was his framing throughout)

All lived in a scratchpad dir, now gone (session-scoped temp dir) — the numbers are preserved here, the code is not. If exact numbers are needed again, they'd have to be re-derived; the logic is simple (see each bullet).

1. **`sos-backtest.js`** — does a defense's FULL prior-season allowed-rank predict its rank specifically in the FOLLOWING season's weeks 15-17 (i.e. does `--playoff-sos`'s own methodology actually work)? Spearman rank correlation, 2022→2023, 2023→2024, 2024→2025. **Result: near zero / noisy** (QB avg -0.05, RB avg 0.03, WR avg -0.03, TE avg 0.19) — much weaker than correlating against the *full* next season (QB 0.09, RB 0.34, WR -0.03, TE 0.20).
2. **`sos-window-trend.js`** — is weeks-15-17 uniquely bad for this signal, or is any 3-week window this noisy? Slid a 3-week window across the whole next season. **Result: correlation peaks early (weeks 3-5) and decays toward the playoff window** — so weeks 15-17 specifically are the worst part of the season to try to predict this way, not a random draw.
3. **`sos-insession-trend.js`** — instead of last year's data, use THIS season's own weeks 1-through-N to predict THIS season's weeks 15-17. Tested cutoffs N=3..14. **Result: flat/weak throughout** (overall avg corr 0.01-0.08), best cutoff week 4 at only 0.08 — no in-season cutoff meaningfully improves the prediction.
4. **`sos-player-accuracy.js`** — moved from team-level rank correlation to individual PLAYER output: does opponent defensive rank actually move a given player's own points (points above his own season average, leave-that-week-out defensive rank to avoid leakage)? 22,693 player-weeks, 2022-2025. **Result: real but small.** QB corr 0.121 (+1.2 pts facing top-8 vs bottom-8 D), RB corr 0.085 (+1.3 pts), WR corr 0.034 (+0.2 pts), TE corr 0.057 (+0.7 pts). All under ~1.5% variance explained.

At this point Ethan asked me to confirm the conclusion ("so basically strength of schedule has a minute effect?") — I said yes. **He then pushed back**, specifically citing that a WR facing a shutdown CB, or an RB facing a strong interior run defense, should show a real effect that team-wide averaging might be hiding. This pushback was correct and led to the fifth test:

5. **`sos-tier-matchup.js`** — the key test. Split WR into elite (top-12 by season TARGETS, not points — points would be circular) vs everyone else; RB into bell-cow (top-15 by season CARRIES) vs everyone else. Compared each tier's points-above-own-average facing top-8 vs bottom-8 defenses. **This is the finding everything downstream is built on:**
   - **RB: hypothesis confirmed, strongly.** Bell-cow backs show a **+3.3 pt gap** (bottom-8 vs top-8 run D) above their own average. Depth RBs only show +1.1. A true workhorse is ~3x more matchup-sensitive than a committee back — this signal was being averaged away by the team-wide test.
   - **WR: hypothesis rejected, and inverted.** Elite-target WRs show almost NO gap (+0.15, noise), while depth WRs show a bigger gap (+0.51). Read: NFL defenses don't uniformly "shut down" true WR1s — they scheme extra help (safety over the top, bracket coverage) regardless of overall defensive quality, so a true WR1's volume/usage stays high either way. A depth WR3/4 is left on an island against whatever corner is on the field, so *his* output swings more with defense quality.
   - **Conclusion Ethan and I landed on together: RB-only, bell-cow-only signal is real and worth building. WR — even elite WR — is not, at any tier.** `[verified — ran all 5 tests against real nflverse data this session]`

### Feature built: bell-cow RB matchup note in `scripts/lineup-alert.js`

Ethan asked "what can we build to leverage this" — I recommended folding it into the existing Sunday lineup-alert cron (cheapest integration, no new UI, no new cron) over two alternatives (a Start/Sit win-prob multiplier, or a standalone manual-run flag). He picked that.

- `rankRBAllowed(games, trailingWeeks)` — ranks all 32 NFL teams 1 (stingiest) to 32 (most generous) on PPR pts/game allowed to RB, over a **trailing window** (see fix #1 below).
- `bellCowNames(games, n=15)` — top-15 RBs league-wide by season-to-date CARRIES (not points — deliberately not circular with the effect being measured).
- `rbSosNotes(wk, players)` — orchestrates: fetches nflverse `weekly(SEASON)`, ESPN `proTeamSchedules_wl` for the CURRENT season (not next season like `--playoff-sos`), resolves each of Ethan's rostered RBs' opponent for week `wk`, and if he owns a bell-cow back in a top-8 or bottom-8 run-D matchup, emits a note (🛑 tough matchup / 🟢 soft matchup).
- Folded into the same Telegram message as the lineup-gap alert, same dedup signature (`sig()` now includes the RB notes so a changed matchup note re-fires even if the lineup itself is already optimal — and the alert now fires on **either** condition, not just the lineup gap).
- **Deliberately excludes WR/TE entirely** — the backtest says there's nothing there. Don't add it later without a fresh backtest.

Then Ethan asked the sharp follow-up: "what happens if the strength of schedule changes, or if an interior lineman is injured." Correctly identified two real gaps, both were his idea to name, both got built:

**Fix 1 — trailing window (lag problem).** `rankRBAllowed()` was a full-season average, which reacts slowly to an in-season defensive change (new DC, a lost starter) — an 8-week-old sample keeps outvoting recent games. Changed to a **trailing 6-week window** (`TRAILING_WEEKS = 6` constant), windowed on whatever games exist so it still degrades gracefully on a partial season. Selftest covers a game aging out of the window.

**Fix 2 — injury caveat (personnel-blindness problem).** A rank is a team-level stats aggregate with zero personnel awareness — it has no idea a specific starter is out for THIS week's game. Added `frontSevenInjuries()`: pulls ESPN's live public injuries feed (same endpoint `handcuff-watch.js` already uses; `TEAM_ABBR` map copied not shared, same copy-not-export pattern as `csvSplit`), filters to DT/DE/NT/LB positions with Out/Doubtful/IR status, and appends a caveat line to the matchup note rather than trying to recompute the rank. **Important limitation, confirmed this session: ESPN's injuries feed is real-time only** — there is no free historical-injuries API, so this caveat is only ever "today's" report. That's correct for production (checking this week's injuries for this week's game) but means it could not be validated week-by-week the way the rest of the backtest was — only the mechanism (name/position/status matching, team-abbreviation crosswalk) was verified, using live current injury data against historical 2025 schedule/matchup data.

### Verification performed this session (all `[verified]`, ran the commands, saw the output)

- `node scripts/lineup-alert.js --selftest` — passes, now 9 assertions (was 7 in session 4): added trailing-window aging-out test, RB-SoS-note-changes-signature test, plus the original 7.
- `node -c scripts/lineup-alert.js` and `node -c scripts/league-history.js` — syntax clean.
- Live dry run against real 2026 ESPN roster (`node --env-file=.env scripts/lineup-alert.js`) — ran clean end-to-end, correctly produced NO alert (Week 1, lineup already optimal, no 2026 games played yet so no RB-SoS data exists yet either). This is expected, not a failure — but it means **the actual note-generation code path had never fired with real matchup output** until the next step.
- Made `lineup-alert.js` importable (`require.main === module` guard added — it wasn't guarded before this session, meaning requiring it would have triggered a live `main()` run; this was a latent bug, now fixed to match the pattern already used by `league-history.js`/`boom-rates.js`).
- Ran `rbSosNotes()` against REAL completed 2025 season data (nflverse + ESPN's 2025 schedule) with real players (Bijan Robinson/ATL, Saquon Barkley/PHI, Christian McCaffrey/SF) across real weeks. Got back correctly-matched, sane output — e.g. "Saquon Barkley (bell-cow) faces LAC, the #1 run defense over the last 6 weeks (12.8 pts/g allowed) — tougher matchup than usual." This is the strongest verification done: real opponent resolution, real rank computation, real formatting, all correct.
- Ran `frontSevenInjuries()` live — pulled real current (Aug 2026) injury data, correctly filtered to front-seven positions and Out/IR statuses, correctly matched to the right NFL team including the LA/LAR abbreviation edge case.
- **Still not verified, and cannot be until the season starts:** the actual GitHub Actions cron trigger with this new code, a real Telegram send containing the RB-SoS note (formatting/emoji/length in Telegram itself), the dedup signature in a real repeat-run scenario, and the very first real 2026 in-season note.

---

## State

| Thing | State | Confidence |
|---|---|---|
| Git | **3 files modified, UNCOMMITTED**: `CLAUDE.md`, `scripts/league-history.js`, `scripts/lineup-alert.js`. Last real commit is still `a1c9a57` (session 4's "Add Playoff SoS tab"). Nothing from this session is pushed or live. | `[verified — git status/diff --stat this session]` |
| Live site | Unchanged from session 4 — `https://fantasy-edge-lyart.vercel.app`. This session's work does not touch `index.html` or anything user-facing on the live site (it's a backend cron script only). | `[unverified this session — not touched, assumed same as session 4]` |
| `scripts/lineup-alert.js` | +183 lines this session. New exports: `rankRBAllowed`, `bellCowNames`, `rbSosNotes`, `frontSevenInjuries`. `--selftest` passes (9 assertions). Verified against real 2025 data. | `[verified]` |
| `scripts/league-history.js` | One-line change: `module.exports` now also exports `NFLVERSE_ABBR` (needed by lineup-alert.js's injury-team-matching). Nothing else touched. | `[verified — diff is 1 line]` |
| `CLAUDE.md` | One new Gotchas entry describing the bell-cow RB SoS feature and its two fixes (trailing window, injury caveat). | `[verified — read it back]` |
| `.github/workflows/lineup-alert.yml` | **Untouched this session.** Still fires Sundays 14:00 + 16:30 UTC. First run with the NEW code will be whenever this gets committed+pushed AND a Sunday with games arrives — i.e. **not this coming Sunday unless committed before then AND the season has started.** Season hasn't started (Aug 13 2026, preseason). | `[verified — file not in git diff]` |
| Backtest scratch scripts (`sos-backtest.js`, `sos-window-trend.js`, `sos-insession-trend.js`, `sos-player-accuracy.js`, `sos-tier-matchup.js`, `verify-rb-sos.js`, `verify-rb-sos2.js`) | **Gone.** Lived in the session's scratchpad temp dir, which does not persist. Numbers are preserved in "What was accomplished" above; code would need to be rewritten if re-run is ever wanted. This was intentional — Ethan's framing throughout was "before you save it, run a test," i.e. these were never meant to be committed. | `[verified — scratchpad is session-scoped, confirmed gone]` |
| Cost | Zero. Same free sources as always (nflverse GitHub releases, ESPN public + private-league APIs). No new keys, no new services. | `[verified — nothing new added]` |

---

## Where my thinking was

**On why RB-only and not WR, even though Ethan's original intuition (shutdown CB) was about WR specifically.** The data flatly disagreed with his WR intuition and I said so directly rather than building a token WR feature to please the ask. He accepted this immediately and pivoted to "what can we build" without pushback — worth noting for tone: he responds well to a straight "the data says no" as long as it's backed by the actual numbers, not just asserted. Don't hedge this finding if a future session revisits it.

**On why the trade-finder piece got deferred instead of built immediately.** No blocker — he simply said "build it later." My spec for it (below, in "The next task") is complete enough to build cold, so there was no need to keep asking him about it before writing this handoff. If a future session starts fresh and reads this file, it should be able to build it without re-deriving anything, only reusing already-verified logic (`rankRBAllowed`, `bellCowNames` from `lineup-alert.js`).

**On the "rest of season" framing for the trade-finder piece — this is a real design decision not yet made, flagged in "For the next session to figure out" below.** The lineup-alert feature only looks at ONE week (this week's matchup). A trade-value signal needs to look at the REST of a bell-cow RB's schedule to be useful for a trade decision made today. I have NOT designed exactly how many remaining weeks to average, whether to weight near-term weeks more than far ones (schedules can be looked up in full since the NFL schedule is fixed and known in advance — no leakage concern the way the original backtest had), or how big a `_cval` nudge is appropriate (needs to be small — this is a real but modest effect, +3.3 pts/week at the extreme, not a valuation-flipping signal). This needs actual design thought, not just wiring.

**On why I didn't just build the trade-finder piece immediately despite having a clean spec.** Ethan explicitly said "build it later" — respecting that literally rather than reinterpreting it as "build it now since you have time." If a fresh session reads this and Ethan hasn't re-raised it, don't assume he wants it built without checking — the handoff docs preserve the request, but "later" was his word, not "now."

---

## For the next session to figure out

- **Should this session's uncommitted changes be committed as-is, or does Ethan want the trade-finder piece folded into the same commit?** Ask him — don't assume either way. If he says "just commit what's there," do a clean commit of the 3 modified files with a message describing the bell-cow RB SoS lineup-alert feature (this is descriptive, not requesting new work).
- **The rest-of-season averaging window for the trade-finder signal (see "The next task")** — needs a real design decision, not just default to "all remaining weeks equally weighted." A team's SoS 12 weeks out is much less certain to matter than next week's, if only because a trade doesn't need to price in an event that far away with much confidence, and NFL defenses do actually change over a season (this is literally what fix #1 above addressed for the weekly version).
- **How big should the `_cval` nudge be?** The backtest found ~3.3 pts/week gap at the tier extreme (top-8 vs bottom-8 defense). A rest-of-season average will regress toward the mean (few players face all-tough or all-soft schedules), so the realistic nudge for most bell-cow RBs will be much smaller than 3.3 pts/week. Needs a sanity check against real 2026 schedules once games start, or at minimum against 2025 schedules as a dry run, before shipping — don't guess a multiplier out of thin air.

---

## The decision still open

**None on what was built this session** — Ethan drove every step and approved each one live (used `AskUserQuestion` once, to clarify WR-tier-vs-defense-tier segmentation for the `sos-tier-matchup` test; he answered "player tier x defense tier," which is what got built).

**One open scheduling decision:** whether/when to commit this session's work, and whether to build the trade-finder piece before or after that commit. **Ask him, don't guess.**

---

## Gotchas

**New this session — the highest-value one to carry forward:**

- **`lineup-alert.js` was NOT `require.main`-guarded before this session** — requiring it as a module (as the new verification script needed to) would have immediately triggered a live `main()` run (real ESPN fetch, real Telegram send attempt) as a side effect of `require()`. Fixed to match the pattern `league-history.js`/`boom-rates.js` already used. **If any future script needs to import from `lineup-alert.js`, this guard is why it's safe to do so now — but don't assume every script in this repo is safely importable; check for the guard first, this was a real near-miss.**
- **ESPN's public injuries feed has no historical mode.** It only ever returns *today's* report. Any feature that wants "was X injured on date Y" cannot be built from this source — there is no free historical alternative currently in use in this repo either. This bit the injury-caveat verification (had to settle for "mechanism is correct" rather than "matched the actual week-6-2025 injury report," which is simply unobtainable for free).
- **Bell-cow tiering must use a volume stat (carries/targets), never points, when the thing being measured is itself points-based** — this was a live circularity bug caught during design, not after the fact: tiering RBs/WRs by season points and THEN measuring their points-vs-defense-tier would partly measure "good players get more points" rather than "matchup affects points." `targets` and `carries` are both present in the nflverse weekly CSV (confirmed via `head -1 ... | grep -i target`) specifically to avoid this.

**Carried forward from session 4, still true (full list in CLAUDE.md):**

- **A weekly ESPN projection is `statSplitTypeId: 1`, NOT 0** (0 = season total). Silent ~20x error if wrong.
- **`league-history.js` and `boom-rates.js` are importable, guarded by `require.main === module`; `draft-research.js` is NOT** — never import it.
- **`weekPts()` returns 0 for both "scored 0" and "no game"** — use the `played` flag, not `pts > 0`.
- **Local server on port 4650 caches `index.html` at startup** — front-end edits need a restart before verification. This session didn't touch `index.html` so this didn't come up, but it's still true.
- **`playwright-core` is `--no-save`**, not in `package.json` — reinstall with `npm i --no-save playwright-core` if a fresh clone needs browser verification.
- **`git push` auto-deploys** via Vercel's Git integration (fixed Aug 8 2026) — but this session has NOT pushed anything, so nothing has auto-deployed.
- **Absence casts no vote** — now a load-bearing rule in seven places (added: bell-cow tiering — a player with a thin sample just isn't tiered "elite," never scored as if he faced no matchup effect).
- **ESPN league views must be repeated `&view=` params**, never comma-joined.
- **`.nflverse-cache` must never be read for the in-progress season** — `weekly(SEASON)` always downloads fresh for the current year by design; this session's live verification runs each re-downloaded rather than using a cache, which is correct behavior, not a bug (visible in the "downloading" log line every time).

---

## Reboot / persistence

**This session's work is NOT durable yet** — it exists only as uncommitted local changes in the working tree. If the machine is reset, a branch is discarded, or `git checkout .`/`git clean` is run before a commit, **all of this session's code is lost** (the analysis/numbers are preserved in this handoff, the code is not, and would need to be rewritten from the descriptions above).

Once committed and pushed: everything durable follows session 4's pattern (`git push` auto-deploys, weak links are `lineup-state.json`/`trade-state.json` in actions/cache only, losing them just means one duplicate alert).

---

## Don't redo

- **Do not re-run the SoS backtest series from scratch** — the five tests and their numbers are fully documented above. If the exact code is needed again it's simple to rewrite (each is ~50-80 lines using `weekly()` from `boom-rates.js` plus a rank/correlation helper), but the *findings* don't need re-deriving.
- **Do not build a WR version of the bell-cow SoS feature.** Tested, rejected, inverted. This is a closed question unless new data changes the picture.
- **Do not remove the `require.main` guard from `lineup-alert.js`** — it's now safely importable, keep it that way.
- **Do not re-litigate the RB-only / bell-cow-only scope** without a fresh backtest — it's not an arbitrary choice, it's what the data supported.
- Everything in session 4's "Don't redo" list still applies (the ten league-history studies, the Start/Sit tab shape, the consensus-backtest impossibility, etc.) — see `handoff-archive/2026-08-13-session4.md` if the specifics are needed, though ideally CLAUDE.md's Gotchas already covers anything load-bearing.

---

## How to work with Ethan

- **Every response starts with "Ethan,"** (per his global CLAUDE.md instructions).
- **He drives multi-step analysis himself, one test at a time** — this session's pattern was: ask a question → get an answer → ask a sharper follow-up based on that answer → repeat. Don't front-load a big analysis plan; let him steer test-by-test, especially for "is this feature actually justified by data" work.
- **He pushes back with real football-analytics intuition, not just skepticism** — his WR/shutdown-CB pushback was correct in spirit even though the WR data didn't bear it out; the RB half of the same pushback was fully vindicated. Take his domain pushback seriously and go test it, don't just defend the original conclusion.
- **"Ask me any questions now if needed" is a real invitation** — he used it once this session and I used `AskUserQuestion` to clarify an ambiguous methodology choice before running the test, rather than guessing. He answered promptly and it produced the right test on the first try.
- **He verifies rigor directly** — "so it's tested and works?" led to a real gap being found (the live dry-run never exercised the actual note-generation code, only synthetic fixtures) and fixed with real historical-data verification in the same turn. Don't oversell "verified" — be precise about what was and wasn't actually exercised.
- **He has ADHD and says so** (`/i-have-adhd` — not a real slash command, just his way of asking for short/direct answers). Keep answers to concrete facts, no architecture tours, one command at a time for terminal steps.
- **"Build it later add to handoff" is a literal instruction, not a soft one** — don't build ahead of what he asked, and don't let a fresh session forget it either. That's the point of this file.
- Terse and direct. Lead with the outcome and the number. Zero cost, always.

---

## The next task

**Build the rest-of-season bell-cow RB SoS multiplier into the trade finder.** This is the one deferred, explicitly-requested item — everything else this session is finished.

**Full spec, as given by Ethan (via a prior turn's summary) and refined by me:**

- **Where:** `index.html`, feed into `_cval` (Ethan's private valuation), **not** `_mval` (market/consensus valuation). This matches the existing pattern — `boomFactor()` already tilts `_cval` based on boom/bust data, this is the same shape of signal. See CLAUDE.md's "Trade finder needs two valuations" gotcha for why this split exists and must be preserved (a single shared valuation makes the trade finder unable to find any trades — verified previously, don't collapse the two).
- **Reuse, don't reimplement:** `rankRBAllowed()` and `bellCowNames()` already exist in `scripts/lineup-alert.js` and are exported (`module.exports = { rankRBAllowed, bellCowNames, rbSosNotes, frontSevenInjuries }`). The trailing-6-week run-D-allowed rank and top-15-by-carries bell-cow tiering are already correct and selftested — don't rewrite them, import or port them.
- **New piece needed:** for each bell-cow RB, average his **remaining** scheduled opponents' run-D rank (not just this week, unlike the lineup-alert feature) to get a rest-of-season SoS score. The NFL schedule is fixed and fully known in advance (same `proTeamSchedules_wl` ESPN endpoint `playoffSoS()` in `league-history.js` already uses, just for the current season and all remaining weeks instead of weeks 15-17 only) — no data-availability blocker here.
- **Effect:** tougher-than-average schedule ahead → nudge `_cval` down slightly (sell-high candidate); easier-than-average → nudge `_cval` up slightly (buy-low candidate). **Magnitude needs real design work, not a guess** — see "For the next session to figure out" above. Start conservative; the backtest's +3.3 pt/week gap was the extreme (top-8 vs bottom-8 single-week matchup), a season-average nudge should be meaningfully smaller than that per-week figure once regression to the mean is accounted for.
- **UI:** surface the reasoning as a line in the trade proposal's existing expanded-row reasoning (same place other `_cval` tilts like boom/bust already show their reasoning), not a new UI section.
- **Scope discipline:** RB-only, bell-cow-only — same as the shipped lineup-alert feature, same justification (WR/depth-RB showed no usable signal in the `sos-tier-matchup` backtest). Do not extend to WR/TE without a fresh backtest first.
- **Before shipping:** run it against real 2025 (or in-progress 2026, once games exist) schedule data as a sanity check the way `verify-rb-sos.js`/`verify-rb-sos2.js` did for the lineup-alert feature this session — confirm the rest-of-season averages look sane for a few known bell-cow backs before trusting the `_cval` nudge in a live trade evaluation.
