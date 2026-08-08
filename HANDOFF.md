# Fantasy Edge — Handoff (Aug 8 2026)

Project: `/Users/ethanyap/fantasy-edge`. **Read `CLAUDE.md` in that folder first** — stack, deploy steps, and a long Gotchas list this file does not repeat. That file was updated heavily this session.

Previous handoff (Jul 31, pre-draft) archived at `handoff-archive/2026-07-31.md`. Its still-true warnings are carried forward below.

**Ethan has already drafted.** The project's focus has shifted from draft prep to **in-season management: trading, waivers, start/sit.** [he confirmed — his opening ask this session was explicitly "since I already drafted this can help with trading"]

---

## TL;DR

1. **Everything built this session is committed, pushed, and live.** Working tree clean, local `HEAD` = `origin/main` = `0efb07d`, production verified by fetching the live page. [verified this session]
2. **Do NOT re-verify or rebuild**: the two-valuation trade finder, boom/bust rates, the seed-odds simulator, the Smyth PDF ingest, or the weekly refresh cron. All done and observed working.
3. **ONE open item, and it is the reason Ethan is opening a new chat:** pushing to GitHub does **not** trigger a Vercel deployment, even though the Vercel project **is** GitHub-connected. He is bringing a **screenshot of the fantasy-edge Vercel dashboard → Settings → Git** to diagnose it. [verified: two pushes this session produced zero deployments]
4. **Why it matters:** the new weekly cron commits fresh data every Tuesday and depends on that trigger to reach the live site. Until it fires, the cron is half wired and someone must run `vercel deploy --prod --yes` by hand.
5. I was **wrong once this session and corrected it** — I claimed the project wasn't GitHub-connected, inferring it from the symptom. The Vercel API shows it *is* connected. Don't repeat that inference; the link exists, the trigger doesn't fire.

---

## What was accomplished this session

Ethan supplied Joel Smyth's 2026 Draft Guide PDF and asked what could be done with it, for trading. That expanded into a feature-building session; he asked for one agent per build.

**1. Smyth's PDF became his single ranked analyst source.**
- Parsed `~/Downloads/Joel Smyth's Draft Guide 2026.pdf` (30 pages, 28MB) via `pdftotext -layout` into `draft-guide-smyth-2026-guide.json` — 184 players (QB1-32 / RB1-60 / WR1-60 / TE1-32), with his 2025 adjusted-PPG figure in the `note` for 123 of them. Counts verified against the PDF exactly.
- **This exposed a live bug**: Ethan had FOUR ranked Smyth files. `analystRanks()` keys votes by the `analyst` field and pushes one entry per FILE, so Smyth was silently casting four votes per player in `consensus()` and outvoting every other source. Fixed by stripping `posRank`/`overall` from the three video-derived files (`draft-guide-smyth.json`, `-wr`, `-rb`) — they are note-only now. **Rule: one analyst = one ranked file.**
- A later agent read the PDF's **image-only pages** (`pdftoppm -r 150 -png`, then actually looked at them) into `draft-guide-smyth-context.json`, also note-only: the luck metric (p18), OL run-block table (p14), playcaller table (p15), efficiency/gamescript scatters (p16-17), 16 player-card previews (p21-24).

**2. Boom/bust engine** — `scripts/boom-rates.js` → `boom-rates.json`, served by `server.js`, displayed in the app.
- boom = share of a player's games finishing **top-5 at his position within that specific week** (not a season-long cutoff, which would just re-measure being good overall). bust = under 8 PPR (12 for QB). Also median/mean/best/games.
- Built off nflverse weekly CSVs — free GitHub release files, no key.
- 322 of the 386-player pool matched; the misses are 2026 rookies and players who missed 2025 entirely (Brandon Aiyuk and Tank Dell genuinely have zero 2025 rows — verified in the raw CSV, not name mismatches).

**3. Seed-odds Monte Carlo simulator** — `scripts/seed-odds.js` → `seed-odds.json`.
- **This corrected a significant error of mine.** I read `settings.scheduleSettings.playoffSeedingRule = "TOTAL_POINTS_SCORED"` and told Ethan the league seeds by total points, then used that to argue his league rewards upside. It is the **TIEBREAKER only**. Verified against the league's own 2025 final standings: seed 5 (7-7, 1731.8 PF — 2nd-highest points in the league) finished BELOW seed 3 (8-6, 1694.8) and seed 4 (8-6, 1663.6). **Record first, points second.**
- Consequence, and it inverts the strategy advice: Ethan is a **favorite** (3rd-strongest roster, **84.1% to make the 8-of-12 playoffs**), and variance is a **cost** to a favorite — 100% playoff odds at zero variance vs 84.1% at real variance. **Prefer floor, not upside**, except in weeks he's projected to lose. Never argue "chase total points."
- Converged: 83.8 / 84.1 / 84.0% top-8 at 5k / 20k / 60k iterations, so 20k is plenty.

**4. Two-valuation trade finder** (in `index.html`).
- The old one returned **zero** trades for his team across ~30k enumerated candidates. That was an artifact of the model, not his roster: a single shared valuation applied to both sides makes mutual gain nearly impossible by construction, since only lineup-slot differences can create joint value. Real trades come from **disagreement**.
- Now: `consensus()` computes `_cval` (HIS value — ESPN + ADP + all analysts incl. Smyth, then tilted toward floor by boom/bust) AND `_mval` (THEIR perceived value — ESPN projection rank + market ADP only, what a normal manager sees). `findTrades()` keeps a deal only if positive under BOTH, ranked by his gain, and the UI shows both numbers.
- Top 3 it produced live: send **Davante Adams** → get **Tee Higgins** (+12 him / +13 them); send **Sam LaPorta** → get **Harold Fannin Jr.** (+8 / +2); send **Saquon Barkley** → get **Chase Brown** (+7 / +6).

**5. Waiver alert gained opportunity deltas** (`scripts/waiver-alert.js`) — from week 3, diffs snap share and target share between the latest two published nflverse weeks and flags jumps (+25 pts snaps w/ ≥25 snaps; +10 pts targets w/ ≥6 targets). Free agents sorted first. Route share has no free source (PFF/FTN only), so snap share substitutes.

**6. In-season correctness fixes** (Ethan asked for these directly after asking "will data auto-update once the season starts"):
- **Stale-cache bug**: `weekly()` in boom-rates.js cached the 8MB CSV and never re-fetched. During the season that file is rewritten weekly, so it would have silently reported Week 1 numbers in Week 8 with no error. Now the cache is read only for FINISHED seasons. Verified by watching the cached file's mtime actually move.
- **`MIN_G = 4`**: a rate over 1-3 games is arithmetic, not signal — one good Week 1 renders as a 100% boom rate. Under 4 games: no chip, expanded row explains why, `boomFactor()` abstains.
- **Hardcoded stale label**: the UI literally said "last season, stale", which would have mislabelled genuinely current 2026 data. Now driven by the file's own `stale` flag.
- **`.github/workflows/refresh-data.yml`**: Tuesdays 6am PT, Sept–Dec (`cron: '0 13 * 9-12 2'`), regenerates both JSON files and commits. Selftests run FIRST so a broken engine fails loudly instead of committing bad numbers.

---

## State

| Thing | State | Confidence |
|---|---|---|
| Git working tree | **Clean**, 0 uncommitted files | [verified] |
| `HEAD` / `origin/main` | Both `0efb07d`, in sync | [verified] |
| Live site | `https://fantasy-edge-lyart.vercel.app` — serving all of this session's code (`MIN_G`, `yrTag`, `_mval`, "too few to rate" all present in the fetched HTML) | [verified by curl of production] |
| Vercel git connection | EXISTS: `type: github`, `ethankwyap-stack/fantasy-edge`, `productionBranch: main` | [verified via Vercel API] |
| Vercel git **trigger** | **Does NOT fire.** Two pushes → zero deployments | [verified] |
| Deploy method that works | `vercel deploy --prod --yes` from the project dir | [verified, used 3× this session] |
| `boom-rates.json` | 619 players, season **2025**, `stale: true`, 322/386 pool matched | [verified] |
| `seed-odds.json` | Ethan rank 3, 122.6 proj/wk, **84.1% top-8**, 1733.6 expected pts | [verified at 20k iters] |
| `analyst-ranks.json` | `188 players ranked by 10 analyst(s): {"Smyth":184,"Holka":150}` | [verified — the "10 analysts" count includes note-only files that cast no vote; only Smyth and Holka rank] |
| Local server | `node server.js` on **port 4650**, launchd KeepAlive | [verified — killed it, launchd restarted it] |
| All selftests | `boom-rates.js`, `seed-odds.js`, `draft-research.js` — all pass | [verified] |
| Browser asserts | Zero console errors/failed asserts on live page load | [verified headless] |
| Cost | Everything this session was **$0** — nflverse and ESPN public endpoints are free/keyless. No paid Opus run was triggered. | [verified] |

---

## Where my thinking was

**On the Vercel trigger.** I ruled out, by checking: project not paused, no `ignoreCommand`, commit author email (`ethankw.yap@gmail.com`) matches his Vercel account — that last one is the usual silent blocker and it's fine. The repo has **zero repo-level webhooks**, but that's expected and NOT evidence either way, because Vercel's GitHub App uses app-level webhooks. My leading hypothesis, untested: **the Vercel GitHub App has lost or never had repo access / the installation is stale.** I couldn't confirm — `gh api user/installations` returned nothing, my GitHub token lacks the scope. The standard fix for exactly this symptom is disconnect-and-reconnect in Settings → Git, which reinstalls the app permission. That's what the screenshot should show.

Worth noting: the **July 31 handoff already carried this same warning** ("Vercel prod does not auto-update after a GitHub Action commits `draft-analysis.json`. Manual `git pull && vercel deploy --prod --yes` needed"). So this has been true for at least a week and was never root-caused. It is not a new regression from this session's changes.

**On the trade finder's output.** The Adams→Higgins deal is the top result, but Higgins is the better player and the "+13 to them" comes entirely from ADP. I flagged this to Ethan as needing his eyeball before he offers it. The engine is working as designed; the question is whether the market valuation is a good enough proxy for what a specific manager believes. Unresolved.

**On the boom-rate tilt.** `BOOM_K` controls how hard low-bust players are priced up. I did not tune it against anything — it's a judgment call that the tilt should be present but not dominant. If trades start looking implausible, that constant is the first knob.

**Untested at scale.** Nothing here has run against real in-season data, because the 2026 season hasn't started. The waiver alert's spike thresholds were tuned on ONE replayed 2025 season. Whether nflverse publishes fast enough to beat Sleeper trending is genuinely untestable until games are played.

---

## For the next session to figure out

1. **Why the Vercel git trigger doesn't fire.** Evidence above. Leading hypothesis: stale GitHub App installation. Ethan is bringing a screenshot of Settings → Git. Start there.
2. **Whether to make the cron self-sufficient instead.** Adding a `vercel deploy` step to `refresh-data.yml` needs a `VERCEL_TOKEN` stored as a GitHub Actions secret. That is a **new API key**, which is against his standing "no new keys unless unavoidable" rule — so it's the fallback, only if reconnecting the dashboard fails. **Ask him; do not create a token unilaterally.**
3. **Waiver-alert thresholds need retuning** once ~4 real 2026 weeks exist (late September). They're currently tuned on one replayed season.
4. **`SEASON` handling in the cron.** `refresh-data.yml` uses `${{ vars.SEASON || 2026 }}`. If no repository variable named `SEASON` exists, it defaults to 2026, which is correct for this year and will silently be wrong in 2027. [unverified — I did not check whether that repo variable exists]

---

## The decision still open

**How to guarantee the weekly data actually reaches the live site.** Two options, and this is Ethan's call — **ask him, don't pick**:
- **(a)** Fix the dashboard Git connection. Free, no new key, matches his standing rules. Preferred, but depends on diagnosing the trigger.
- **(b)** Add a `VERCEL_TOKEN` secret + explicit deploy step in the workflow. Guaranteed to work, but creates a new API key.

He already knows both options; I laid them out and he chose to bring a screenshot, which implies he's trying (a) first.

---

## Gotchas

**Lead item — bit me this session:**
- **A `git push` does NOT deploy this project**, despite the Vercel project being GitHub-connected. Verified twice. Production only updates via `vercel deploy --prod --yes`. **Any workflow that ends by committing a data file (`draft-research.yml`, `refresh-data.yml`) therefore changes nothing users see.** Never assume a commit ships.
- **I inferred "not connected" from the symptom and stated it as fact. It was wrong** — the Vercel API showed the link exists. Check the setting before naming a cause.
- **A `S.boom` test fixture MUST include `g`.** The positional bust baseline now filters out thin samples, so a fixture without a game count drops out of the average, `posBust` goes null, and every factor collapses to 1. This broke the `risk tilt inverted` assert exactly once, caught in the browser.
- **`.nflverse-cache` must never be read for the in-progress season** — see State/accomplishments above. The cache IS still written, and a failed fetch falls back to it with a loud `WARNING`.

**Carried forward, still true:**
- **`server.js` reads `index.html` once at startup** — front-end edits need a server restart before ANY verification. `draft-analysis.json` etc. re-read per request.
- **If localhost:4650 misbehaves**, check `lsof -ti:4650` for an orphaned `node server.js` (PPID 1) blocking the KeepAlive LaunchAgent. Kill the orphan; launchd restarts it fresh. This happened this session.
- **Headless tests must load `?key=$APP_SECRET`** or every route 401s. The `/` route 302s — follow redirects (`curl -L`) or you'll read an empty body.
- **playwright-core is NOT in the project's node_modules.** It lives at `/Users/ethanyap/.npm/_npx/e41f203b7505f1fb/node_modules/playwright-core`. Use `channel: 'chrome'`.
- **Player rows are `<tr>` elements**, not `.row` — a wrong selector reports 0 rows and looks like a broken page.
- **Any function reading ESPN `stats[]` MUST filter `seasonId`** or it averages two seasons together. `--selftest` asserts this.
- **ESPN league views must repeat**: `&view=a&view=b`. `?view=a,b` returns 200 but silently omits `settings`.
- **`last30days`'s headless query planner silently caps a subquery at 2 sources** — this is why the sentiment fetch makes two separate calls (reddit+youtube, then tiktok alone). Don't "simplify" it back to one 3-source call.
- **nflverse URLs use the RELEASE TAG, not the filename.** Guessing the tag from the filename 404s.
- **nflverse weekly files include postseason rows** (weeks 19-22) — filter `season_type == REG`.
- **Never put `ANTHROPIC_API_KEY` in `.env`** — GitHub Actions secret only.
- **`draft-analysis.json` must never be gitignored** — the Action commits it.
- **`gh workflow run` uses `origin/main`, not local disk** — uncommitted changes are invisible to Actions.
- **`timeout` is not installed on this Mac.**
- **Never connect programmatically to a draft Ethan is in** — it kicks him out. Scrape the DOM in his own tab (the bookmarklet), never the websocket.
- **Ethan uses Safari**, not Chrome.
- **A source that omits a player casts no vote.** Applies to analyst boards AND boom rates. Absence must never read as a low rank / low boom rate. A 0 ESPN projection means IR — ESPN alone ranks those.

---

## Reboot / persistence

`server.js` is a launchd KeepAlive job — survives restart, self-heals unless an orphan holds port 4650. Draft board state (drafted/mine/sleepers) is **localStorage only** and does not survive a browser data clear. All JSON data files are committed to git. The waiver alert's `state.json` persists between Actions runs via actions/cache and is gitignored. Weak link: the Vercel deploy trigger (see above) — nothing else depends on a manual step.

---

## Don't redo

The draft board, VBD/tier engine, research pipeline, hourly Telegram waiver alert, secret-link gate, ESPN injuries/news proxy, Sleeper caching, draft-sync bookmarklet, sentiment fetch machinery — all pre-existing and working. From THIS session: the trade finder rebuild, boom-rate engine + UI, seed-odds simulator, Smyth PDF ingest (both text and image pages), the cache/MIN_G/stale-label fixes, and `refresh-data.yml`. All committed, pushed, deployed, and observed working. Re-verifying them is wasted budget.

---

## How to work with Ethan

College student learning development. **One terminal command per step**, say what he should see, wait for his confirmation or screenshot before the next. **Cost is his #1 anxiety** — name every service and whether it can bill him; never say "probably free." Every response starts with "Ethan,". He dislikes being told what to pick on choices that are purely his ("no i will decide on a limit") — answer the "why," then let him choose. Lead with the outcome, not the process. When he asks "why"/"how," slow down and explain the mechanism rather than restating the plan. He catches real errors — this session he pushed back on a vague "Week 4" claim and was right, and he was right that the Vercel project is connected.

---

## The next task

**Diagnose why pushing to GitHub doesn't trigger a Vercel deployment.** Ethan is opening a fresh chat and bringing a **screenshot of the fantasy-edge project in the Vercel dashboard → Settings → Git**.

What to look for in it: whether the connected repo is shown, whether recent commits are listed, and whether there's any warning about the GitHub App's permissions. If it looks connected but lists no recent commits, disconnect and reconnect — that reinstalls the app permission and is the standard fix for this exact symptom.

After it's fixed, confirm the trigger works by pushing a trivial commit and watching `vercel ls fantasy-edge` for a NEW deployment (the CLI ones are authored `ethankwyap-8990`; a git-triggered one will look different). Do not declare it fixed without seeing that deployment appear.

If reconnecting doesn't work, surface option (b) from "The decision still open" — the `VERCEL_TOKEN` route — and **ask him before creating any token.**
