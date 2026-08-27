# Fantasy Edge

A decision-support suite for a private ESPN fantasy football league (PPR). It turns raw
league, market, and play-by-play data into ranked, explainable recommendations — draft
board, start/sit, waiver pickups, trade targets — and pushes alerts to Telegram when
something actually changes.

Built and run at zero infrastructure cost.

## What it does

| Tool | What it answers |
|---|---|
| **Draft board** | Who is the best pick right now, and by how much? Value-based drafting (VBD) with computed tiers and cliff detection. |
| **Start / Sit** | Which lineup maximizes projected points this week? |
| **Waiver finder** | Who should I bid on, and how much of my FAAB budget? |
| **Trade finder** | Which two rosters have a mutually profitable swap? |
| **Seed simulator** | Monte Carlo over the remaining schedule — what are my playoff odds? |
| **Live draft sync** | A bookmarklet scrapes an in-progress ESPN draft and crosses picks off the board in real time. |

## The interesting part: consensus, not one source

An early version just ranked players by ESPN's projections. That is one opinion.

The board now blends, per position: ESPN's projection rank, market ADP, and every
analyst board dropped into the repo as a JSON file. The blended rank maps back onto a
points curve, then VBD and tiers run on top of that.

Three rules keep it honest:

- **A source that omits a player casts no vote.** An analyst whose board stops at 150
  does not silently rank everyone else last.
- **One analyst, one ranked file.** Ingesting the same analyst's board from four videos
  would let him vote four times.
- **Opinion never touches value math.** In-season video takes are shown as context next
  to a recommendation; they never move VBD, tiers, or projections.

Adding an analyst is a file drop, not a code change.

## Data sources — all free, no paid APIs

- **ESPN Fantasy API** — league state, rosters, projections, FAAB budgets
- **Sleeper** — trending adds, depth charts, injury status
- **nflverse** — play-by-play derived stats: target share, air-yards share, WOPR, EPA,
  CPOE, snap share, yards before/after contact
- **ESPN public site API** — injuries and news, tagged to players
- **Analyst boards** — transcribed from public videos and published PDFs
- **Social sentiment** — Reddit / YouTube / TikTok, for a narrow shortlist of players
  where the crowd knows something the box score does not

## Stack

Plain HTML + JS single page, no framework. Node server, deployed as a Vercel function.
Seven GitHub Actions workflows run the scheduled jobs. State persists through the
Actions cache. Alerts are change-driven — the LLM is only called when the underlying
data actually moved, which is what keeps the cost at zero.

## Engineering notes

A few problems that were more interesting than they looked:

- **Tiers are computed, not declared.** Splitting a position wherever the VBD gap is
  "big" produces 127 tiers, because a position-wide median gap is dragged to zero by the
  flat tail. The gap has to be measured against a *local* rolling median.
- **Seeding is record-first.** The league setting is literally named
  `playoffSeedingRule: TOTAL_POINTS_SCORED`, which reads like a points-only league. It
  is the tiebreaker. Reading it the other way inverts every conclusion the playoff
  simulator draws — verified against the league's actual final standings, where the
  second-highest scoring team missed the cut.
- **Silent API failures.** ESPN accepts `?view=a,b` with a 200 and quietly omits half
  the response; it needs repeated `&view=` params. A search tool silently capped a query
  at two sources and dropped the third with no error. Both were found by checking output
  against a known-good baseline rather than trusting the status code.
- **Absence is not a zero.** Whether it is an analyst who skipped a player or a rookie
  with no prior-season snaps, a missing input must not be scored as a bad one.

## Running it

```bash
node server.js   # http://localhost:4650
```

Needs a `.env` with `LEAGUE_ID`, `ESPN_S2`, `SWID`. No secrets are committed —
production values live in Vercel and GitHub Actions secrets.

---

Built by Ethan Yap · UC Davis
