# Fantasy Edge — Handoff (Jul 31 2026, later session #2)

Project: `/Users/ethanyap/fantasy-edge`. **Read `CLAUDE.md` in that folder first** — stack, deploy steps, and a long Gotchas list this file does not repeat (including a new entry from this session, see below).

**Ethan's draft is in 5 days (~Aug 5 2026).** Everything here is scoped around that deadline.

## TL;DR

1. **The paid Claude batch research run has NOT happened yet.** This session did prep work (see below) but stopped before triggering `gh workflow run draft-research.yml` because context ran low — that trigger is the next session's first real task.
2. **Full-shortlist sentiment fetch is DONE and DONE RIGHT.** `sentiment.json` now has all 27 shortlisted players, each with reddit + youtube + tiktok takes (48 TikTok takes total, all attributable to `@joelsmyth`). [verified, this session]
3. **A real bug was found and fixed this session**: TikTok was silently never being queried. See "What was accomplished" and the new CLAUDE.md Gotcha — read it before touching `sentimentFetch()` again.
4. **Nothing is committed yet.** `git status` shows 4 modified files: `CLAUDE.md`, `HANDOFF.md`, `scripts/draft-research.js`, `sentiment.json`. Local `main` is also already 2 commits ahead of `origin/main` (`228c9a6`, `2921d74` — FAAB waiver UI + traded-pick-skip, from an earlier session, unrelated to this work). [verified via `git status` / `git log origin/main..HEAD`, this session]
5. `--selftest` passes as of the current (fixed) `draft-research.js`. [verified, this session]

## What was accomplished this session

Ethan said "read handoff.md and run all the research." I read the prior `HANDOFF.md`, which said the one open question before the paid run was: full `--sentiment-fetch` on the ~27-player shortlist first, or go with the existing 3-player smoke-test data? I asked Ethan via AskUserQuestion — he chose **full shortlist first**.

I ran `node --env-file=.env scripts/draft-research.js --sentiment-fetch --limit 27` in the background (~20-30 min expected). It completed and wrote `sentiment.json` for 27 players — but **zero of them had any TikTok takes**, despite the TikTok/Joel Smyth wiring from the prior session (`TIKTOK_CREATORS='joelsmyth'`, `SENT_SOURCES='reddit,youtube,tiktok'`).

I investigated by hand-running `last30days.py` directly with various `--search` combinations:
- `--search tiktok` alone → TikTok source runs fine, finds `@joelsmyth` videos.
- `--search reddit,tiktok` (2 sources) → both run fine.
- `--search reddit,youtube,tiktok` (3 sources) → **the headless/no-`--plan` fallback planner silently truncates to `sources=[reddit,youtube]`** — TikTok is dropped with zero error and zero mention in `source_status`. Confirmed by grepping the planner's own log line (`[Planner]   sq1 ... sources=[...]`).
- I also tried forcing it via an explicit `--plan` JSON with all 3 sources — same result, except the 3rd source silently became `grounding` (web search) instead of tiktok. So the cap isn't specific to the deterministic fallback; it's a 2-source-per-subquery ceiling in this installed version, at least for headless (no interactive planner) use.

**Root cause: a 2-source cap in `last30days` (v3.18.4, this Mac's plugin cache), not a bug in `draft-research.js`'s original logic** — the original 3-source `--search reddit,youtube,tiktok` call was reasonable code that happened to hit an undocumented ceiling in the dependency.

**Fix applied** (`scripts/draft-research.js`, `sentimentFetch()`, around line 287): split the one 3-source call into **two calls per player** — `--search reddit,youtube` first, then `--search tiktok --tiktok-creators joelsmyth` second — and merge `.results` / `.source_status` from both before scoring takes. This dodges the 2-source cap entirely since neither call asks for more than 2... actually asks for at most 2 (reddit+youtube) and 1 (tiktok) respectively, safely under the ceiling either way.

I smoke-tested the fix on 2 players (`--limit 2 --refresh`) — confirmed both came back with `sources: ['reddit','youtube','tiktok']` and real TikTok takes (e.g. "Jonathon Brooks Looking Like RB1 😳🔥"). Then re-ran the full 27-player fetch fresh (`--limit 27 --refresh`) — **all 27 now have TikTok sources, 48 TikTok takes total.** [verified, this session]

I added the finding to `CLAUDE.md`'s Gotchas (search "2-source cap" or "silently caps") so nobody re-wires a 3-source `--search` call and loses hours re-discovering this.

I did **not** yet: commit anything, push, or trigger the paid GitHub Action. Context ran low, so I stopped here to write this handoff rather than rushing the paid/irreversible step.

## State

| Thing | State | Confidence |
|---|---|---|
| `sentiment.json` | 27 players, all 3 sources (reddit/youtube/tiktok), generated ~2026-07-31 evening | [verified, this session] |
| `scripts/draft-research.js` | Modified, uncommitted. Has ALL prior-session edits (model swap, 450-char cap, 12-team context, TikTok wiring) PLUS this session's 2-call fix in `sentimentFetch()` | [verified — my edits] |
| `CLAUDE.md` | Modified, uncommitted — added the "2-source cap" Gotcha | [verified — my edit] |
| `--selftest` | Passes on current code | [verified, this session] |
| Real Claude output from the new prompt/sources (the paid batch run) | **Still never tested.** No paid call has happened at all yet — not this session, not before. | [unverified] |
| `origin/main` HEAD | `5b785a6` | [verified via `git fetch`, this session] |
| Local `main` HEAD | 2 commits ahead of origin: `228c9a6`, `2921d74` (FAAB waiver UI, traded-pick-skip — both pre-date this session, unrelated) | [verified, this session] |
| Local git status | `M CLAUDE.md`, `M HANDOFF.md`, `M scripts/draft-research.js`, `M sentiment.json` — nothing else dirty | [verified, this session] |
| `.github/workflows/draft-research.yml` | Unchanged. Runs `node scripts/draft-research.js` against a **fresh checkout of `origin/main`**, then commits `draft-analysis.json` back as `ethankwyap-stack` | [verified — read the file, this session] |
| Joel Smyth TikTok handle `@joelsmyth` | Now producing real, on-topic takes (verified by content, e.g. rookie RB commentary matching the player queried) — much stronger confirmation than the prior session's cross-corroboration-only check | [verified via actual fetched content, this session] |
| `smythe-guide.json` | Still empty scaffold, still expected | [carried forward] |

## Where my thinking was

The 2-source cap smelled like it could be `last30days` capping based on API rate/cost concerns for headless runs specifically (to stop an unsupervised cron script from fanning out too wide), rather than a hard architectural limit — I did not chase that theory. I also didn't check whether a NEWER version of the `last30days` plugin fixes this (there could be one at `~/.claude/plugins/cache/last30days-skill/last30days/` with a version newer than `3.18.4` — I didn't look). If a future session hits this cap on a *different* multi-source combination (e.g. adding X or Instagram later), the two-call-per-source-group pattern in `sentimentFetch()` is the known-working workaround; check for a plugin update first before re-deriving it.

I did not check whether the 2-call approach doubles the wall-clock time meaningfully — the 27-player run took roughly the same "~20-30 min" ballpark as the first (broken) run, so it doesn't seem to matter in practice, but I didn't time it precisely.

## For the next session to figure out

1. **Nothing left to decide before triggering the paid run** — Ethan already answered the one open question (full sentiment shortlist, done). The next session should go straight to execution, not re-ask.
2. **Is the 450-char report cap actually working?** Never verified against a real API response — carried forward, still true, will only be answerable after the paid run.
3. **After the Action completes and pushes `draft-analysis.json`, does Vercel prod need a manual redeploy?** Prior session's belief: yes, `git pull && vercel deploy --prod --yes` needed, since nothing auto-triggers a Vercel deploy from a GitHub Action push. Still unverified against the live site.
4. **Board render caps.** After the fresh full run, confirm `draft-analysis.json` has all 386 players and `index.html`'s render cap still matches (it was already fixed to 386 per CLAUDE.md Gotchas — just confirm nothing regressed).

## The decision still open

None. Ethan already chose "full shortlist first" this session — that's done. Proceed straight to commit + push + trigger, no more questions needed on that front.

## Gotchas (carried forward + new this session)

- **NEW this session, added to CLAUDE.md: `last30days`'s headless query planner silently caps a subquery at 2 sources.** Passing 3+ sources in one `--search` call (or one `--plan` subquery) drops the 3rd with zero error — not even a `source_status` entry. Verified via planner log comparison. Fix used in `sentimentFetch()`: two separate calls (reddit+youtube, then tiktok alone) instead of one 3-source call. Full detail in `CLAUDE.md` Gotchas.
- **`gh workflow run` uses `origin/main`, not local disk.** Unlike `vercel deploy --prod` (ships whatever's on disk), the GitHub Action does a fresh `git checkout`. **The current uncommitted `scripts/draft-research.js` fix (the TikTok 2-source-cap workaround) will NOT be picked up by the Action until committed and pushed.** This is the single most important thing for the next session not to skip — if you trigger the Action without pushing first, you get the OLD (TikTok-broken) code, silently.
- **`sentiment.json` also needs to be committed and pushed** before triggering the Action, same reasoning — it's read from disk by `draft-research.js`, which the Action checks out fresh.
- **Vercel prod likely does not auto-update after the Action's commit.** Plan on `git pull && vercel deploy --prod --yes` as a manual step after the run, unless proven otherwise.
- **`server.js` reads `index.html` once at startup, but re-reads `draft-analysis.json` on every request.** Only `index.html` needs a restart after edits.
- **Any function reading ESPN `stats[]` must filter `seasonId`.** `--selftest` asserts this.
- **Piping the research dry run through `head` kills node via SIGPIPE.** Write to a file, then grep it.
- **`timeout` is not installed on this Mac.**
- **Headless tests must load `?key=<APP_SECRET>`** or every route 401s.
- **Never put `ANTHROPIC_API_KEY` in `.env`.** Lives only as a GitHub Actions repo secret.
- **nflverse downloads are slow and flaky** — degrades loudly (returns null) rather than aborting a paid run.
- **`draft-analysis.json` must never be gitignored** — the Action commits it.
- **Never connect programmatically to a draft Ethan is in** — kicks him out.
- **Ethan uses Safari**, not Chrome.
- **Local git can be ahead of production-relevant reality in either direction** — `vercel deploy --prod` ships disk state, independent of `git push`. Run `vercel ls` and/or open the live site, don't infer from `git log` alone.

## Proven impossible — do not revive

(Unchanged, carried forward as-is.)

- ESPN's REST API never exposes mock-draft picks (`?view=mDraftDetail` stays `picksMade: 0` forever).
- Mock leagues get deleted afterward — importing a finished mock is impossible.
- Fantasy Edge must never open its own draft websocket connection — kicks Ethan's real session. The bookmarklet (zero connections) is the correct design; don't revisit.
- Raw Node `WebSocket` to ESPN's draft server is rejected (close 1006).
- DOM-readability + `window.open`/`postMessage` cross-origin delivery works and is confirmed live — don't re-investigate.

## Don't redo

Draft board (tiers, reports, floor/ceiling, badges, filters, snake tracker), the research pipeline itself (only tune prompts/sources, don't rebuild it), the hourly Telegram waiver alert, the secret-link gate, ESPN injuries/news proxy + Sleeper caching, Smythe volume/efficiency metrics, the draft-sync bookmarklet, the sentiment shortlist selector (`--sentiment-list`, working), the sentiment fetch stage (`--sentiment-fetch`, working, now genuinely 3-source as of this session). The full 27-player sentiment fetch — already done, don't re-run unless you want fresher takes (5-day TTL, `--refresh` to force). "Mock mode" was built and deliberately reverted — do not rebuild it. The traded-7th-round-pick skip on the draft board — already shipped.

## Reboot / persistence

`server.js` is a launchd KeepAlive job. Draft board state (drafted/mine/manual sleeper marks) is localStorage only. `draft-analysis.json`, `sentiment.json`, and curated JSON files are committed to git.

## How to work with Ethan

College student learning development, not fluent in git/deployment — one terminal/browser step at a time, say what he should see, wait for confirmation. He uses Safari. **Cost is his #1 anxiety** — name every service and whether it can bill him, never say "probably free." He already authorized the paid run (prior session) and already answered the sentiment-scope question (this session, chose "full shortlist first") — don't re-ask either. Never claim something works without testing it. Lead every reply with the outcome. Confirm before deploys/deletes. Short confirmations ("yes", "proceed") mean do exactly the pending step, nothing more.

## The next task

**Commit, push, and trigger the paid draft research run.** Concretely:
1. `git add CLAUDE.md scripts/draft-research.js sentiment.json` (and `HANDOFF.md` if you want the trail preserved) and commit — the TikTok fix and the full 27-player sentiment data MUST be pushed before the Action runs, or it uses stale/broken code.
2. `git push`.
3. Trigger `gh workflow run draft-research.yml` (paid — this is the actual Claude Opus 5 batch call over 386 players / 21 batches; confirm Ethan still wants to proceed now if any time has passed, but he already said yes to this run).
4. After it completes (`gh run watch` or `gh run list`), verify `draft-analysis.json` on `origin/main`: 386 players present, a `report` field spot-checked at ≤450 chars, and crowd-chatter lines showing TikTok/YouTube sourcing for the players that have `sentiment.json` entries.
5. Check whether Vercel prod needs a manual redeploy (`git pull && vercel deploy --prod --yes`) to pick up the new file, and do it if so.
