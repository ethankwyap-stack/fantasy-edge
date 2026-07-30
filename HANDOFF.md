# Fantasy Edge — Handoff (Jul 29 2026, late evening)

Project: `/Users/ethanyap/fantasy-edge`. **Read `CLAUDE.md` in that folder first** — stack, deploy steps, and a long Gotchas list that this file does not repeat. This file covers only what a fresh session needs beyond it.

Ethan is doing the next task **in a new chat**, which is why this file exists.

## TL;DR

Today's work is **finished, committed, pushed, and deployed to production** — commit `f40350c`, working tree clean, live site verified by a headless browser. Do not re-verify it and do not re-deploy.

**The next task is two steps of a sentiment feature, and step 1 is free:**

1. Run `node --env-file=.env scripts/draft-research.js --sentiment-list` in `/Users/ethanyap/fantasy-edge`, show Ethan the ~50 names, and tune the scoring weights if he says they look wrong. Costs nothing, no network beyond free APIs, takes ~2 minutes.
2. Then build the `last30days` sentiment fetch stage with a hard `--limit 3` probe, so he sees real output and real cost on three players before anything runs on fifty.

**Nothing in step 2 is built yet.** No `sentiment.json`, no fetch script. Step 1's selector IS built and working.

## What was accomplished today (evening session)

Ethan asked how the research run works, then asked how to integrate two new inputs: Joel Smythe's draft guide when it publishes, and the `last30days` skill for player sentiment. He explicitly said **don't build yet, help me understand** — so that turn was explanation only. He then ran `/improve`, which reviewed the pipeline, and approved five fixes.

Shipped in `f40350c`:

- **K/DST dropped from the research pool.** `index.html` never displayed them, so 64 of the top 450 players — 4 of 25 Claude batches, ~16% of the paid run — were being analyzed and thrown away. Pool is now **386 players / 21 batches**.
- **The paid run is resumable.** `draft-analysis.json` is written after every batch; `--resume` skips players already in it; the retry call now sits *inside* its try/catch (it was outside, so a second failure killed the process and discarded every batch already paid for); a twice-failed batch logs `BATCH FAILED` and continues; `stop_reason === 'max_tokens'` is treated as a failure instead of surfacing as an opaque JSON parse error.
- **Mixed-season data is now labelled.** `bySeason()` resolves a year *per source*, so `usageLine()` tags any bit whose year differs from the line header (`snap share 62% [2025]`). Latent today — everything falls back to 2025 — but it goes live the moment 2026 nflverse files start publishing at different times.
- **`smythe-guide.json` scaffolded empty** and wired in, same pattern as `expert-sleepers.json`.
- **`--sentiment-list` selector built** (details below).

**Found while verifying, not from the review:** the documented 300→450 pool expansion never reached the board. `index.html` capped the render at `slice(0,300)`, so every player past 300 was paid for and unreachable. The fetch limit I "fixed" first was never the binding constraint. Both caps now sit at 450 and a headless browser counts **386 rendered rows** on the live site.

**A bug I introduced and caught:** a new `ppgOf()` omitted the `seasonId` filter on ESPN `stats[]` — the exact trap this project's own CLAUDE.md warns about in writing — which would have averaged 2024 and 2025 into one "last-season PPG" used to rank players. Fixed, and `--selftest` now asserts it.

**Also resolved:** the previous handoff's "Uncommitted work from an EARLIER session — ask Ethan before committing" is done. Those changes (top-450 pool, long-press sleeper mark, `expert-sleepers.json`) went into `f40350c` with today's work, on his explicit "commit" then "push and deploy".

## Verified state (every row checked by command, Jul 29 late evening)

| Thing | State |
|---|---|
| Branch / HEAD | `main` at `f40350c`, **working tree clean**, pushed to `origin/main` |
| Deploy | Deployed to production this session. `https://fantasy-edge-lyart.vercel.app` returns **401** bare and **302** with `?key=` — both correct, that is the secret gate |
| Live board | Headless Chrome on the **live** URL counts **386 rendered rows**, zero page errors. Screenshot looked correct (tiers, badges, VBD bars intact) |
| Local server | Running, port 4650, PID **46014** (launchd KeepAlive restarts it) |
| `draft-analysis.json` | 298 players, `generated` **2026-07-28T13:03:56Z**. **Stale**: it predates both the Smyth efficiency metrics and `expert-sleepers.json`, and has nothing for ranks 299–386 |
| `smythe-guide.json` | Exists, `players` is **empty**. Run logs `Smythe guide matched 0/0` |
| Secrets | `.env` locally (gitignored): `LEAGUE_ID`, `ESPN_S2`, `SWID`, `APP_SECRET`. `ANTHROPIC_API_KEY` exists **only** as a GitHub repo secret, deliberately |
| Cost today | **Zero.** No Anthropic calls were made. Every verification used free ESPN/nflverse/Sleeper endpoints and a local browser |
| Only paid thing in the project | The manual `draft-research` run. Previously ~$3 at 25 batches; now 21 batches, so expect somewhat less — that is an estimate, not a measurement |

Ethan's ESPN identity, needed for draft URLs: SWID `{25A17E71-A2D2-40A8-9E59-02C0A821495E}`. **League IDs change every single mock** (seen: `1413280972`, `1508486820`, `2118343226`) — never hardcode one. Mock draft URL needs all four params or ESPN shows "Page not found": `https://fantasy.espn.com/football/draft?leagueId={ID}&seasonId=2026&teamId={N}&memberId={SWID}`.

## The next task, step 1 — review the sentiment shortlist (FREE)

```
cd /Users/ethanyap/fantasy-edge
node --env-file=.env scripts/draft-research.js --sentiment-list
```

Re-fetches all the free data (~2 min), prints the shortlist, then **exits before any Claude call**. Safe to run repeatedly.

**What the selector does** (`sentimentList()` in `scripts/draft-research.js`). Pool is players with ADP ≤ 150. A player **qualifies** only if signals genuinely *disagree*:

- no 2025 games at all — rookie or missed season (+25)
- positional rank by draft order differs from positional rank by 2025 PPG by ≥ 4 (+ the gap, capped at 30)
- a Smythe rank gap ≥ 12 (+20) — currently inert, the guide file is empty
- fresh news **and** an injury flag together (a situation actually in flux)

`fresh news` (+10) and `injury flag` (+10) add weight but **cannot qualify a player alone**. That was a deliberate correction: on the first version, "has a headline" gave 12 of 50 slots to Gibbs, Bijan, McCaffrey and other top-10 consensus players — precisely the ones no crowd poll could change. If Ethan wants to loosen it, the weights and the `qualifies` flag are all in that one function.

Top of the current output, for comparison:

```
 36  Justin Jefferson (WR, ADP 12) — ranked WR6 but WR32 by 2025 PPG; fresh news
 35  Jordyn Tyson (WR, ADP 97) — no 2025 games (rookie/missed); fresh news
 31  Patrick Mahomes (QB, ADP 103) — ranked QB15 but QB4 by 2025 PPG; fresh news; injury flag
 30  Quentin Johnston (WR, ADP 144) — ranked WR54 but WR17 by 2025 PPG
 25  Jeremiyah Love (RB, ADP 17) — no 2025 games (rookie/missed)
```

50 of 132 in-range players qualified. **Show him the list and ask which names look wrong** — do not tune the weights on your own judgement of football. If the list looks like noise to him, the correct outcome may be to drop the sentiment feature entirely and save the effort; say that out loud rather than pushing forward.

## The next task, step 2 — the sentiment fetch stage (build after he approves step 1)

**Cost, corrected — this matters, cost is his top anxiety.** Earlier in the session Ethan was told sentiment would be "credit-metered spend". That was **too pessimistic** and I corrected it before writing this file. From the skill's own `CONFIGURATION.md`:

- **Free and keyless:** Reddit (default free path), Hacker News, Polymarket, GitHub (via his `gh` auth), YouTube + YouTube comments (via `yt-dlp`, which is installed).
- **Credit-gated via `SCRAPECREATORS_API_KEY`:** TikTok, Instagram, and their comment sources — but ScrapeCreators documents **10,000 free calls**, and those sources use ~3 calls per run each.
- X/Twitter needs separate auth he does not have configured (`XAI_API_KEY`, `AUTH_TOKEN`+`CT0`, etc. all absent).

So ~50 player queries is a few hundred calls, well inside the free allowance. **What I could NOT verify: how many of his 10K ScrapeCreators calls are already spent** — that needs his dashboard, and I have no URL for it. Tell him it looks free and say that balance is the one unchecked thing, rather than asserting free outright. If he wants certainty, `EXCLUDE_SOURCES=tiktok,instagram,tiktok_comments,instagram_comments` keeps the run on entirely free sources, and Reddit is where fantasy football is actually discussed anyway.

**Verified facts about the tool:**

- Path: `~/.claude/plugins/cache/last30days-skill/last30days/3.18.4/skills/last30days/scripts/last30days.py`. Version **3.18.4**. Preflight reports `status: ready`, `safe: true`.
- Available sources: `reddit, tiktok, instagram, x, youtube, hackernews, polymarket, github, grounding`.
- Credentials present: **GitHub** and **ScrapeCreators** only. Absent: google, openai, openrouter, perplexity, xai.
- Machine-readable output: `--emit=json` (defaults to `--json-profile=agent`, schema version 1.2). Docs at `docs/reference/json-export.md` in that same directory. Fields worth using per result: `title`, `source`, `url`, `published_at`, `summary`, `engagement` (native counters), `relevance_score`, `cluster`.
- **The trap that must be handled:** `source_status` distinguishes `no-results` (source completed cleanly, genuinely nothing) from `rate-limited`, `auth-failed`, `unreachable`, `timeout`, `schema-drift`, `error`. **Only `no-results` means "nobody is talking about this player."** Passing a failed fetch through as silence would invent a negative signal about a player — the same class of bug the existing prompt already guards against for ESPN news ("absence of news is not a negative"). The docs say this outright: consumers must not read failure states as absence of discussion.
- Query shape that already worked: Ethan ran `Jahmyr Gibbs vs Bijan Robinson fantasy football` earlier today and got 45 results. Per-player, use `"<Player Name> <Team> fantasy football"`.

**The design Ethan agreed to** (his words: "this makes sense"):

- A **separate stage**, not inline in the research pass — a query takes ~40s, so 386 players is impossible. It writes `sentiment.json`, which `draft-research.js` then reads exactly like it reads `expert-sleepers.json` and `smythe-guide.json` (there is already a `curated(filename)` helper for that, reuse it).
- **Cache with a TTL** (3–5 days pre-draft) so re-running research never re-fetches.
- `--limit 3` on the first run, non-negotiable — he sees output and cost on three players before fifty.
- Per player, keep: direction (rising / falling / contested), the 2–3 highest-engagement verbatim takes **with source and engagement counts**, and any concrete beat-writer facts buried in them (camp snap counts, "running with the ones"). Not a numeric sentiment score — a score hides the reasoning the model needs.
- **Prompt framing, already decided:** sentiment enters as evidence about **price/perception, not about the player**. The system prompt in `draft-research.js` already carries the source-precedence paragraph this plugs into — facts, then measured data, then a named analyst's reasoning, then crowd sentiment — plus "popularity and confidence are not correctness". Read that paragraph before writing the sentiment block so the two agree.
- **Specificity gate:** "took 80% of first-team snaps Tuesday" counts; "he's gonna eat this year 🔥" does not, at any engagement level. Same rule the prompt already applies to generic ESPN roundups.
- **Fence crowd text as quoted data, never as instructions.** Reddit and X bodies are attacker-writable in principle. Low stakes here (JSON-schema output, no tool access) but do not interpolate raw post text as if it were part of the prompt's own voice.

## Gotchas — the ones that actually bit someone

- **`server.js` reads `index.html` once at startup.** Editing `index.html` changes nothing on `localhost:4650` until restart. A headless test once reported a new button MISSING purely because of this and it looked like broken code. Fix: `lsof -ti:4650 | xargs kill`, launchd restarts it in ~2s. If localhost misbehaves after an edit, check for an orphaned `node server.js` with PPID 1 blocking the LaunchAgent.
- **Any function reading ESPN `stats[]` must filter `seasonId`.** Entries from other seasons live in the same array. `summarize()` and `ppgOf()` both do; copy the filter into anything new. This bit me today in brand-new code despite being documented.
- **Piping the research dry run through `head` kills node via SIGPIPE** and looks like the feature produced nothing. Write to a file, then grep it. (`tail` is fine.)
- **`timeout` is not installed on this Mac** — `command not found`. Use node's own `AbortSignal.timeout` or just let it run.
- **playwright-core is at `/Users/ethanyap/.npm/_npx/e41f203b7505f1fb/node_modules/playwright-core`**, not in this project and not in `/opt/homebrew`. There is no `node_modules` in the project at all. Launch with `chromium.launch({channel:'chrome'})`.
- **Headless tests must load `?key=<APP_SECRET>`** or every route 401s. `window.S` is **not** a global — probe the DOM (`document.querySelectorAll('.pos').length` gives the row count) rather than app state.
- **Never put `ANTHROPIC_API_KEY` in `.env`.** The paid run lives in GitHub Actions by design; locally the script dry-runs, which is intended, not a failure.
- **nflverse downloads are slow and flaky** — the 8MB weekly file has timed out at 120s. `csvRows()` returns null and degrades loudly rather than aborting a paid run. **Preserve that for any new download**, including the sentiment stage.
- nflverse URLs use the release **TAG**, not the file family: `releases/download/pfr_advstats/advstats_week_rush_2025.csv`.
- **`draft-analysis.json` must never be gitignored** — the Action commits it.
- Vercel file tracing: `server.js` must read `index.html` and `draft-analysis.json` with static `readFileSync(path.join(__dirname, ...))`. Don't switch to dynamic paths.
- **`git status` does not report `handoff.md`** in this repo — it is neither tracked nor matched by any ignore file I could find, and `git check-ignore` says it is not ignored. Unexplained; harmless; don't spend time on it, and don't assume a clean `git status` means this file doesn't exist.
- **Never connect programmatically to a draft Ethan is in** — it kicks him out. If any listener is ever running: `pkill -f sniff2.js; pkill -f wslisten.js`.
- Read `.completedPick` children with `textContent`; `innerText` returns `""` there.
- **Ethan uses Safari**, not Chrome. Its console is `Option+Cmd+C` and only works when a web page window is frontmost.

## Proven impossible — do not revive

- **ESPN's REST API never exposes mock-draft picks.** `?view=mDraftDetail` returns 200 with his cookies but `picksMade` stays `0` forever, during (~110 polls) and after the draft. Do not re-test polling.
- **Mock leagues get deleted afterwards**, so importing a finished mock is impossible.
- **Fantasy Edge must never open its own draft websocket connection.** ESPN allows one per team and kicks the older one; a Playwright session once disconnected Ethan from his own live draft and he set a hard requirement that it never happen again. The bookmarklet is acceptable precisely because it opens **zero** connections.
- A raw Node `WebSocket` to ESPN's draft server is rejected (close 1006) — needs browser headers. Recorded so nobody retries.
- **The DOM-readability question is answered yes** and `window.open` + `postMessage` cross-origin delivery **works** — both confirmed on the real `fantasy.espn.com` origin and then by Ethan in a live mock. Do not re-investigate; the clipboard fallback was never needed.

## Don't redo

Draft board with tiers, reports, floor/ceiling bars, badges, filters, snake pick tracker. The research pipeline and its workflow. The hourly Telegram waiver alert. The secret-link gate. The ESPN injuries/news proxy and Sleeper caching. The Smyth volume/efficiency metrics. The draft-sync bookmarklet (**per-draft workflow: Reset the board, click `FE Sync`, check the green badge**). The Reset button already exists. **"Mock mode" was built and deliberately reverted** — he decided Reset covers it; do not rebuild it.

Ideas already declined at zero cost: red-zone/goal-line usage (nflverse play-by-play, 100MB+ per season) and true routes run (paid data).

## Reboot / persistence

`server.js` is a launchd KeepAlive job — it survives restart and relaunches on crash. Draft board state (drafted / mine / manual sleeper marks) is **localStorage only**, so it is per-browser and lost if he clears site data; that is accepted. `draft-analysis.json` and the curated JSON files are in git. Waiver-alert `state.json` persists between GitHub Actions runs via actions/cache and is gitignored locally. Nothing in the next task adds a persistence risk, though `sentiment.json` should be gitignored or committed deliberately — decide with him, don't default.

## The other open item — the paid research run

**Not authorized. Do not trigger it, do not "just check" it.** Ethan decides when, and he has been told to wait until Smythe's guide and the sentiment decision are settled so he pays for one run instead of three.

When he says go: 1) `gh workflow run draft-research.yml` (21 batches now, not 25). 2) `git pull`. 3) `vercel deploy --prod --yes` — **ask first**. 4) Open the live site with the key, tap a row, confirm the report timestamp is new.

Worth doing within a few days of his real draft, since depth charts and camp news move a lot in August. Note the live board currently shows 386 rows but only 298 have analysis, so ranks 299–386 render with no tier or verdict and sort to the bottom under "Ceiling". Only the paid run fixes that.

## The third open item — Joel Smythe's guide

He rates Smythe's guides highly and wants them factored in. **The scaffold is shipped and waiting**: when the 2026 guide publishes, he pastes it or a link, and it becomes a transcription job into `smythe-guide.json` — keys are lowercase ESPN full names, values `{rank, tier, note}`. No code changes needed, deliberately, so this is not happening under draft-day pressure. The prompt already treats Smythe as a strong prior on *interpretation* (especially rookies and new situations) but explicitly not an override of the usage data.

## How to work with Ethan

College student learning development, not fluent in git or deployment — give terminal and browser steps **one at a time**, say what he should see, and wait for his confirmation or screenshot before the next step. He uses **Safari**. **Cost is his biggest anxiety**: name every service and whether it can ever bill him, never say "probably free", never spend on the research run without an explicit go-ahead. Never claim something works without having exercised it — he asks "test it out before you tell me it's done". Lead every reply with the outcome, detail after. Confirm before deploys, deletes, or anything outward-facing; approval is scoped to that one action. He changes direction mid-task — revert cleanly rather than leaving half-built features behind. Short confirmations ("proceed", "yes do both") mean do exactly the pending step, nothing more. Screenshots are bug reports or "where do I click" questions — read the image before answering. He gets impatient with long waits, so prefer one decisive test over a passive poll.
