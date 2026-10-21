---
name: wr-screen
description: Use when the user asks about a fantasy football wide receiver's outlook — e.g. "will this WR be a WR2", "is this WR a buy low", "should I trade for this receiver", "which rookie WRs are real", "rank these WRs", "WR waiver pickup". Grades any NFL WR's measured odds of a top-24 PPR finish from free nflverse data. Works for any league platform (ESPN, Sleeper, Yahoo); needs no account or key.
---

# WR Screen

Grades a wide receiver's odds of a top-24 PPR season from the one input that predicts it,
measured on 10 seasons of NFL data:

- **Veterans:** last season's target share, **per game** (not season total).
- **Rookies:** target share in weeks 1–4 of their rookie season.

Everything else (team pass volume, WR room crowding, "change of scenery") was tested and
adds nothing for veterans. See `references/findings.md` before explaining any number.

## Requirements

- Node.js 18 or later. No packages to install.
- Internet access to `github.com` (free nflverse release files, no key).
- The script writes a cache only to `./.fantasy-cache` in the current directory.

## What to do

1. Get the WR names from the user. If they gave a roster or trade, take every WR in it.
2. Run the script from the user's project directory:

   ```
   node <skill-dir>/scripts/wr-screen.js "Player One" "Player Two"
   ```

   For a ranked list instead: `node <skill-dir>/scripts/wr-screen.js --top 40`.
   Add `--season YYYY` to grade a different season, `--json` for machine output.
   First run downloads ~20MB; later runs use the cache for finished seasons.
3. Report a table in this format:

   | WR | Type | Grade | Top-24 odds | Share | Why |
   |---|---|---|---|---|---|

4. Then give the read, using these rules:
   - **Grade A/B veteran on bad points last year** = buy-low. The role was there; the
     points were noise or injury. Say so.
   - **Grade C/D veteran on good points last year** = sell-high. Production outran role.
   - **No grade** = not enough data (rookie before week 1–4 games, or under 4 games last
     season). Say "no measured read" — never call it a bad grade.
   - **Team change** = caution flag only. It is confounded (released WRs are usually the
     weaker ones); never present it as a cause.
   - **Rookie 25%+ band** has only 9 past players. Say the sample is small.
5. If the user asks about a trade, grade every WR on both sides and compare top-24 odds,
   not names.

## Self-check

`node <skill-dir>/scripts/wr-screen.js --selftest` runs the logic tests with no network.
Run it first if output looks wrong.

## Limits

- Top-24 odds are base rates for the band, not a prediction for one player.
- Grades a WR, not TE or RB.
- A player whose name is spelled differently from nflverse returns "no grade". Retry
  with the nflverse spelling (e.g. "Marquise Brown", not "Hollywood Brown").

See `examples/example-session.md` for a full worked session.
