# Agensi listings

Sellable skills, built clean of personal league data and third-party analyst content.

- Check + build: `node agensi/check.js --zip` → `agensi/dist/<name>.zip` (gitignored)
- The check fails on banned strings, `.env` values, bad frontmatter, symlinks, binaries,
  and non-executable scripts. Run it before every upload.
- Test the WR script: `node agensi/skills/wr-screen/scripts/wr-screen.js --selftest`

## Listing 1 — fantasy-data-traps

- **Title:** Fantasy Football Data Traps
- **Price:** $9 one-time
- **Tagline:** Catches the ESPN and nflverse bugs that return believable wrong numbers.
- **Description:** Building a fantasy football tool with ESPN's API or nflverse stats? Those
  sources pack several aggregations into one field and never error when you grab the wrong
  one. This skill reviews your code against 30+ measured traps — cumulative weekly points,
  season-vs-per-game projections, comma-joined views that silently drop data, postseason
  rows in weekly files, team-code mismatches, rank comparisons that invent error — and gives
  the exact fix for each, plus a regression check.
- **Use cases:** reviewing an ESPN league script; building a projections backtest; joining
  nflverse to Sleeper/ESPN; computing target share.
- **Limits:** knowledge only, runs no code. Covers ESPN, nflverse, Sleeper, FFC ADP — not
  Yahoo's API.
- **Network:** none.

## Listing 2 — wr-screen

- **Title:** WR Screen — Measured Top-24 Odds for Any Wide Receiver
- **Price:** $15 one-time
- **Tagline:** One number predicts a WR2 season. This skill reads it for you.
- **Description:** Tested on 1,266 veteran WR seasons: last year's per-game target share
  sorts receivers into bands that finish top-24 PPR at 58% / 30% / 15% / 2%. Rookies are
  graded on weeks 1–4 target share — every top-12 rookie season in ten years came from the
  18%+ group. Ask about any WR, trade, or waiver add and get the band, the odds, and a
  buy-low / sell-high read. Works for any platform; free public data; no account or key.
- **Use cases:** "is this WR a buy-low"; "compare the WRs in this trade"; "which rookie WRs
  are real"; "rank the WRs on my waiver wire".
- **Limits:** base rates for a band, not a promise for one player. WR only.
- **Network:** downloads public CSVs from `github.com/nflverse/nflverse-data` releases
  (CC-BY 4.0, attribution: nflverse). Writes `./.fantasy-cache` only. Installs nothing.

## Not packaged yet

- Start/sit win probability + handcuff watch — needs the math pulled out of index.html
  and rosters from Sleeper or pasted input instead of ESPN cookies.
- Trade review — its simulator (`scratchpad/sim.js`) is not in the repo; rebuild first.
- fantasy-video-inject — too thin without the app; skip.

## Open questions for Agensi (emailed)

1. How do bundled `scripts/` run under MCP-only delivery?
2. What US tax forms are needed, and is there a payout minimum?
3. Is a skill accepted if its source is in a (now private) GitHub repo?
