# Fantasy Edge — Handoff (Jul 31 2026, evening session #3)

Project: `/Users/ethanyap/fantasy-edge`. **Read `CLAUDE.md` in that folder first** — stack, deploy steps, and a long Gotchas list this file does not repeat.

**Ethan's draft is ~5 days out (~Aug 5 2026).** [carried forward, unverified this session — he hasn't restated the date, confirm if it matters]

## TL;DR

1. **New feature built and smoke-tested this session: `--situation-fetch`.** Extends the existing sentiment-fetch machinery (already free, already working) to cover the top-N ADP players, not just the 27-player rookie/committee shortlist. This closes a real gap Ethan found: established, healthy, high-ADP players whose offseason SITUATION changed (new OC, new QB, scheme change) were invisible to every existing signal. [verified — code written, tested live on 2 real players this session]
2. **Nothing is committed yet.** `git status`: `M scripts/draft-research.js`, `M sentiment.json`. Local `main` and `origin/main` are in sync otherwise (both at `1282a44`). [verified, this session]
3. **The paid Claude Opus batch run has NOT been re-triggered.** `draft-analysis.json` still reflects the pre-situation-fetch data (generated 2026-07-31T20:16 UTC) — it does NOT yet know about Achane's Willis/Slowik risk or anything else `--situation-fetch` will surface.
4. **Ethan is about to run, in a fresh chat**: `node --env-file=.env scripts/draft-research.js --situation-fetch --limit 50` (he said "limit 50" — he did NOT specify `--top`, so it'll default to `--top 200`). That command is safe to run as-is — it's free, resumable, writes after every player.

## What was accomplished this session

Ethan asked why De'Von Achane ranks tier-2/rank-10 on the board despite what he called a bad "situation." I looked at his `draft-analysis.json` entry — it's built entirely from box-score/usage stats (2 years 300+ pts, 18.8% target share, WOPR, YPC) with no team-context signal at all. I web-searched and confirmed a real gap: Miami has **Malik Willis at QB (not Tua)** and **new OC Bobby Slowik** in 2026, Vegas rates Miami as one of the league's worst offenses, and Willis's own rushing means fewer checkdowns — i.e. real risk to the receiving-volume floor the board's rank-10 leans on. None of the board's existing signals (usage stats, ESPN news [capped ~73 tagged players], the 27-player sentiment shortlist, expert-sleepers.json) would ever catch this for an established player like Achane, because the sentiment shortlist only triggers for rookies/no-2025-data or shared-backfield RBs — a healthy proven starter never qualifies.

Ethan asked how many OTHER players have the same blind spot, and how much it'd cost to check the top 200 + sleepers. I explained: reusing the *existing* free `last30days`-based sentiment path (reddit/YouTube keyless, TikTok on the free ScrapeCreators tier — same one built for the 27-player shortlist) costs **$0 in new service fees**, just runtime (~40-80s/player). He also asked whether trusted YouTube sources (Joel Smyth, Yahoo Fantasy) would surface — I discovered mid-conversation that this was **already built** in the last commit (`b9932d2`): `YT_CHANNELS = 'BDGE Fantasy Football, Yahoo Fantasy Football'` already rides in the query text as a soft bias, and TikTok is already hard-pinned to `@joelsmyth`. So there was nothing new to add there — I told him this directly rather than re-building something that already existed.

He said "fold it in and build this." Since the YouTube/TikTok targeting already existed, the actual build was: **widen which players get the existing fetch**, not add new source-targeting. Changes to `scripts/draft-research.js`:

- New `situationList(items, topN)` function: unions (a) every player with `adp <= topN`, and (b) the FULL sleeper shortlist (uncapped — `sentimentList(items, Infinity)`), deduped by player key. Reasoning in the code comment: an established top-N player needs situation-risk coverage, and a deep sleeper outside top-N still needs the existing rookie/committee coverage — neither list alone covers both.
- Refactored `sentimentFetch(items, limit)` → `sentimentFetch(list)`: now takes a plain array of already-selected player items instead of computing the shortlist internally. This let both `--sentiment-fetch` (old, still works, unchanged behavior) and the new `--situation-fetch` share one fetch/write/cache loop.
- New CLI flag: `--situation-fetch [--top N] [--limit N]` — `--top` defaults to 200 (ADP cutoff), `--limit` defaults to 20 (how many players to actually fetch this invocation, since 200+ players is hours of runtime). Updated the file's header-comment flag docs.

Tested: `--selftest` still passes [verified]. Dry-run with `--top 5 --limit 0` confirmed the merge logic (pool math: "top 5 ADP (4) + sleeper shortlist (27) = 31 unique players") and that 0-limit is a safe no-op [verified]. Live smoke test with `--top 15 --limit 2` actually fetched **Jahmyr Gibbs** and **Bijan Robinson** for real — both came back with all 3 sources (reddit/youtube/tiktok), 3 takes each, `sentiment.json` now has 29 players (was 27) [verified — real network calls, real output inspected].

Ethan then asked two clarifying questions I answered but did NOT act on:
- **"Why should I have limits?"** — I told him honestly: the limit isn't a cost/safety cap (this path is free either way), it's just wall-clock pacing carried over from the old 3-player-at-a-time habit. The script writes to `sentiment.json` after every single player, so it's fully crash-safe/resumable — a big `--limit` is not risky, just slow to sit through. He said **"no i will decide on a limit"** — do not suggest a specific number to him again, he's picked 50.
- **"Explain what this research does and how it wouldn't go stale after 5 days"** — I explained `SENT_TTL_DAYS = 5` only controls whether a *future fetch run* skips (fresh) or auto-re-fetches (stale) a player — no `--refresh` flag needed for stale entries, they refresh automatically on the next `--situation-fetch`/`--sentiment-fetch` call. An old entry doesn't vanish or stop being used meanwhile; it stays in the Opus prompt tagged with its age (e.g. "12d old") so Claude can discount it rather than trust it blindly.

## State

| Thing | State | Confidence |
|---|---|---|
| `scripts/draft-research.js` | Modified, uncommitted. Has the new `situationList()` + refactored `sentimentFetch()` + `--situation-fetch` flag | [verified — my edit, tested] |
| `sentiment.json` | 29 players (27 original shortlist + Gibbs + Robinson from this session's smoke test), generated ~2026-07-31 21:38 UTC | [verified, this session] |
| `draft-analysis.json` | UNCHANGED — still generated 2026-07-31T20:16 UTC, does not reflect any situation-risk data yet, live site matches this file exactly (confirmed by diff against the deployed copy earlier this session) | [verified, this session] |
| `origin/main` | `1282a44`, same as local `HEAD` — no divergence either direction | [verified via `git fetch`, this session] |
| Local git status | `M scripts/draft-research.js`, `M sentiment.json` — nothing else dirty | [verified, this session] |
| Live site (`fantasy-edge-lyart.vercel.app`) | Byte-identical to local `draft-analysis.json` as of ~21 min before this session started; prod deploy is current for that file | [verified earlier this session, may drift if he redeploys before reading this] |
| `--selftest` | Passes on current code | [verified, this session] |
| `--situation-fetch --top 15 --limit 2` | Ran for real, 2/2 succeeded, all 3 sources each | [verified, this session] |

## Where my thinking was

I did not test `--situation-fetch` at real scale (50+ players) — only 2. If a run at `--limit 50` behaves differently (rate limits, a source starting to fail partway through, `last30days` choking on volume), that's unverified territory. Watch the first real 50-player run for anything that doesn't match the 2-player smoke test.

I did not re-run the paid Opus batch analysis after adding sentiment for Gibbs/Robinson — so even though `sentiment.json` has fresh data for those two, `draft-analysis.json` (and the live board) does not reflect it yet. The situation-fetch data is inert until a paid run consumes it.

I did not check the actual dollar cost of the next paid Opus run relative to before — the situation-context lines are small (a few sentences per matched player), so I estimated "negligible, cents" by reasoning about relative prompt size, not by pulling real numbers from his Anthropic console (I don't have access to that). If he pushes on an exact figure, say plainly that it's not visible to me.

I have NOT written the fades/situation-risk note query text to be any different from the existing general "{name} fantasy football" query — I judged the existing query (plus the YT_CHANNELS bias) would surface situational chatter same as it did for Gibbs/Robinson, based on the Achane precedent from web search. This is a judgment call, not verified against a player who's actually facing a big situation change (Gibbs/Robinson weren't chosen for that reason, they were just the top-2-ADP smoke test).

## For the next session to figure out

1. **Nothing to decide before the `--limit 50` run** — Ethan already knows what he's about to do (see TL;DR #4). Don't re-explain the flags, don't re-ask about the limit.
2. **After the situation-fetch run finishes**, check how much of the 200+27 pool it covered (it logs a running count) — at `--limit 50` per invocation, multiple runs are needed for full coverage. Tell him the remaining count plainly, don't assume he wants to keep going without asking.
3. **Whether/when to trigger the paid Opus re-run** is still open — situation-fetch data sitting in `sentiment.json` unused doesn't help him until `draft-analysis.json` is regenerated. That's a real $ spend (unknown exact amount, uses `ANTHROPIC_API_KEY` as a GitHub Actions secret, triggered via `gh workflow run draft-research.yml` per `.github/workflows/draft-research.yml`) — confirm with him before triggering, don't assume yes just because he authorized sentiment fetches.
4. **Commit strategy**: `scripts/draft-research.js` and `sentiment.json` are both uncommitted. The GitHub Action checks out `origin/main` fresh (not local disk) — so if/when he wants the paid run to use the new situation-fetch data, both files need to be committed AND pushed first, same lesson as the prior session's TikTok-fix handoff.

## The decision still open

None forced right now. Ethan has already decided: run `--situation-fetch --limit 50` next, in a new chat. The open decision for LATER (not now) is when to trigger the paid re-run — surface it as a question when the situation-fetch coverage looks sufficient to him, don't decide it for him.

## Gotchas (carried forward + new this session)

- **New this session**: `sentimentFetch()` signature changed from `(items, limit)` to `(list)` — it now takes a pre-selected array, not a full item pool + limit. If you see old code or notes referencing `sentimentFetch(items, N)`, it's stale; both call sites (`--sentiment-fetch` and `--situation-fetch`) now build their list first (`sentimentList(...).map(s => s.x)` or `situationList(...)`) and pass it in.
- **`gh workflow run` uses `origin/main`, not local disk.** Any uncommitted `draft-research.js`/`sentiment.json` changes are invisible to the Action until pushed. [carried forward — this is the single easiest mistake to make next]
- **`last30days`'s headless query planner silently caps a subquery at 2 sources** — this is WHY `sentimentFetch`/`situationList`'s underlying fetch does two separate `last30days` calls (reddit+youtube, then tiktok alone) instead of one 3-source call. Don't "simplify" that back to one call. [carried forward from prior session]
- **Vercel prod does not auto-update after a GitHub Action commits `draft-analysis.json`.** Manual `git pull && vercel deploy --prod --yes` needed after any paid run. [carried forward, still unverified against a real end-to-end run per prior handoff]
- **`server.js` reads `index.html` once at startup** — only front-end edits need a restart; `draft-analysis.json`/`sentiment.json` re-read every request.
- **Any function reading ESPN `stats[]` must filter `seasonId`.** `--selftest` asserts this.
- **`timeout` is not installed on this Mac** — use `run_in_background` + a real wait/Monitor instead, or `wait <pid>` IN THE SAME shell invocation (a `wait PID` in a fresh Bash call does NOT block on a background job started in a prior Bash call — learned the hard way this session when a "wait" returned instantly while the process was still running).
- **Headless tests must load `?key=<APP_SECRET>`** or every route 401s.
- **Never put `ANTHROPIC_API_KEY` in `.env`.** Lives only as a GitHub Actions repo secret.
- **`draft-analysis.json` must never be gitignored** — the Action commits it.
- **Never connect programmatically to a draft Ethan is in** — kicks him out.
- **Ethan uses Safari**, not Chrome.

## Don't redo

The draft board itself, the research pipeline's core structure, the hourly Telegram waiver alert, the secret-link gate, ESPN injuries/news proxy + Sleeper caching, the draft-sync bookmarklet, the original 27-player sentiment shortlist/fetch (`--sentiment-list`/`--sentiment-fetch`, unchanged behavior, still works), the YouTube channel soft-bias and TikTok creator pin (already existed before this session — do NOT re-add, it's real and working, verified live this session with Gibbs/Robinson takes actually citing `@joelsmyth`-style sources). The traded-7th-round-pick skip. FAAB waiver UI.

## Reboot / persistence

`server.js` is a launchd KeepAlive job. Draft board state is localStorage only. `draft-analysis.json`, `sentiment.json`, and curated JSON files are committed to git (once committed — the current session's changes are NOT yet).

## How to work with Ethan

College student learning development — one terminal step at a time, say what he should see, wait for confirmation. Uses Safari. **Cost is his #1 anxiety** — name every service and whether it can bill him, never say "probably free." He pushed back once this session on being told what limit to pick ("no i will decide on a limit") — don't suggest specific numbers for things that are purely his call; answer the "why" and let him choose. He wants certainty over hedging on cost questions, and said plainly when he wanted a fuller explanation instead of just an action (the TTL/staleness question) — slow down and explain mechanism when he asks "why"/"how," don't just restate the plan.

## The next task

Ethan is opening a fresh chat and running:
```
node --env-file=.env scripts/draft-research.js --situation-fetch --limit 50
```
(no `--top` given, so it defaults to 200). This is safe, free, resumable, and matches what he already decided — do not re-explain or re-confirm, just be ready to help interpret the output when he reports back, and to remind him (if he doesn't bring it up) that `sentiment.json`/`scripts/draft-research.js` need to be committed + pushed before any paid Opus re-run can see the new data.
