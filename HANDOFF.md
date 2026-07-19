# Fantasy Edge — Handoff

## Status: BUILT & VERIFIED (Jul 19 2026)

The hourly change-driven waiver alert specced here is shipped. All four approved
features are live in `scripts/waiver-alert.js` + `.github/workflows/waiver-alert.yml`:

1. Hourly 7am–9pm PT change-detection loop — free-data diff (Sleeper trending top-40 entrants, roster injury changes) against `state.json` cached via actions/cache; no changes → exit with zero Claude cost. Sent advice deduped by line hash.
2. Prompt enrichment — targets/rec/carries last 3 wks (stat ids 58/53/23, statSourceId=0), mPositionalRatings opponent strength, proTeamSchedules_wl upcoming + playoff (wk 15–17) opponents, wk-proj-vs-season-pace trend. All render gracefully empty pre-draft (verified).
3. Rival awareness — positional thinness per rival team; RB2 handcuff stash detection via Sleeper depth_chart_order.
4. Buy-low/sell-high — actual-vs-projected PPG divergence, top 5 each way (in-season only).

Verified live per the bar: run 29685837618 seeded state + Claude call succeeded
(NO_ALERT, correct pre-draft); run 29685854698 restored cache and exited free at
the diff gate. Local dry-run (`node --env-file=.env scripts/waiver-alert.js`,
no ANTHROPIC key in .env) reproduced both paths.

## No pending task. Gotchas live in CLAUDE.md; project memory is current.

Carried-forward operational notes:
- `gh secret set` / `source .env` are classifier-blocked for the agent — hand Ethan a `! command` one step at a time if secrets change.
- ESPN 401 = cookies expired → Ethan re-grabs from browser.
- When the season starts, sanity-check one in-season run: usage lines, ratings, and trade signals should populate; they've only been verified as graceful-empty.
