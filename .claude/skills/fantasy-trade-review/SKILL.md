---
name: fantasy-trade-review
description: Full trade evaluation for Ethan's ESPN league — measured weekly shape (not season totals), a two-level Monte Carlo differential, a breakeven point, and a for/against/judge subagent debate. Use when Ethan asks whether to accept, propose, or decline a trade.
---

# Fantasy trade review

Derived from the Bowers+Wilson / Waddle+LaPorta review (Aug 2026). Every step
below is one that **actually changed the answer**. Steps that produced noise
are listed in "What does not work" — do not re-run them.

## The one rule

**Never quote a season win total.** Backtested on 2025, this simulator's
season win prediction is *worse than assuming every team goes 7-7*
(MAE 2.13 vs 1.83, Spearman **-0.203**). What is measured and sound:

| Component | Accuracy | Use it? |
|---|---|---|
| Team points/week | within ~8%, 92.9% interval coverage | yes |
| Player projection rank (all) | Spearman 0.777 | yes |
| ...RB / WR | 0.807 / 0.682 | yes |
| ...**TE / QB** | **0.416 / 0.358** | flag it out loud |
| Volatility (cv) persistence | 0.669, beats positional median | yes |
| **Season win total** | **worse than a coin flip** | **never** |

A *differential* between two versions of the same roster survives where a
level does not — most unmodelled noise (injuries, waivers, lineup errors)
cancels. That is why step 3 exists.

## Step 1 — weekly shape, never season totals

```
node scripts/trade-profile.js "jaylen waddle" "brock bowers" "sam laporta"
```

Prints, per player per season: games, ppg, **median**, best game, top-3 weeks,
sd, % good games, % bad games — plus the positional baseline for what a real
top-12 finisher looks like week to week. `YEARS=2023,2024,2025` narrows it.
`--selftest` runs assertions, no network.

**Report the median, not the mean.** A durable boom/bust player (Michael
Wilson: 12.98 ppg, **8.4 median**) reads like a starter on the average and is
a flex on the median. The median is the honest number for a weekly decision.

Measured baselines (2023-25, real weeks) — quote these so "good game" and
"bad game" are not guesses:

| | top-12 WR | top-12 TE |
|---|---|---|
| ppg | ~17.5 | ~12.0 |
| weeks 20+ / 15+ | 36% | 30% |
| weeks 15-or-less / 10-or-less | 46% | 44% |
| weeks 30+ | 8% | **1.5%** |

Two things this reframes every time: a WR's 20-point game is a *spike*, not a
"good" game; and a TE essentially never explodes, so a TE who does is rare.

## Step 2 — the role-vs-production test

**The single most decisive check in the whole review.** Before believing any
"new team unlocks him" story, read the player's prior-season **per-game**
target share out of `vet-wr.json`.

- Good share + bad points -> the new team fixes nothing. It is talent.
- Bad share + bad points -> the story might be real.

Waddle 2025: 23.0% per-game share (a genuine WR1 workload) and 12.13 ppg.
Denver fixes opportunity; opportunity was never broken. That one line moved
the verdict from 50/50 to a call.

Bands (1,266 WR-seasons): >=25% -> 58.2% top-24 | 20-25% -> 29.5% |
15-20% -> 15.4% | <15% -> 1.9%. **Per-game, never season-total** — a season
total buries an injured star in the bottom band.

The team-change discount (6.9% movers vs 18.7% stayers) is **confounded** —
bad WRs are the ones who get traded. Caution flag, never a mechanism.

## Step 3 — two-level Monte Carlo on the differential

Pattern (see `scratchpad/sim.js` for the live-roster loader):

1. **Outer loop** (~3000): draw one projection-error world. Each player's true
   ppg shifts by the *measured* preseason error sd — `{QB:3.1, RB:3.4,
   WR:3.4, TE:2.9, K:2.0, DST:2.0}` (2025, n=161, MAE 2.62, bias +0.54).
   Cache the draw per player name so both scenarios see the same world.
2. **Inner loop** (~60): simulate the season. Evaluate KEEP and TRADE **inside
   the same world**, and swap the counterparty's roster too.
3. Report **P(trade helps)** and an **80% range**. Never a point estimate.

Per-player weekly sd comes from `boom-rates.json` as a coefficient of
variation (`sd/mean`); an unrated player gets his position's median cv, never
zero. Under 4 games abstains.

## Step 4 — the breakeven sweep

Re-run step 3 with the disputed player's ppg overridden across a range. This
converts an argument into one number Ethan can hold:

> Breakeven ~14.8 ppg. ESPN says 12.5 (take it). Yahoo/FSC say 16 (decline).

That is the whole decision, stated once.

## Step 5 — the adversarial debate

Only after steps 1-4 have real numbers. Spawn **three** subagents:

1. **FOR** the trade, 2. **AGAINST** the trade — both in parallel, both given
   the *identical* data block (every measured number above, the sim result,
   the breakeven, and the accuracy table including the weak positions).
   Require each to end with `WEAKEST POINT IN MY CASE:`.
3. **JUDGE** — gets both arguments plus the same data, and must:
   separate measured claims from story; **name where either side misused a
   number**; adjudicate the genuine cruxes; deliver TAKE/DECLINE with a
   confidence; and state the one piece of new information that would flip it.

The judge is what earns this step. In the live run it caught the pro-trade
side quoting an average where the median was honest, and caught the
anti-trade side applying a durability discount to one TE but not the sicker
one — then made the argument neither side did: *unreliable evidence for X is
not evidence for not-X*, so discarding the simulator does not land you on
"decline", it lands you on the raw numbers.

Subagent reports are not shown to Ethan. **Relay both cases and the verdict.**

## What does not work

- **Season win totals** (step 1 rule). Also: any claim of the form "you go
  7.99 wins instead of 7.84" is noise dressed as math.
- **A single shared valuation.** Mutual gain needs disagreement — see
  `_cval` / `_mval` in `index.html`.
- **Backtesting the consensus board.** Every `draft-guide*.json` first appears
  in git in Aug 2026; there is no 2025-era analyst board. Impossible, always.
- **Reasoning from position reputation.** "TEs are boring" is true of the
  position (1.5% of weeks 30+) and was false of Bowers (a 43.3 game). The
  group rate is not the player.

## Gotchas

- `weekly()` from `scripts/boom-rates.js` returns **already-normalized** rows
  — `{name, pos, week, pts, team, opponent_team, carries}`. There is no
  `player_display_name` / `fantasy_points_ppr` / `season_type`. Writing a
  filter against raw nflverse column names yields a **silently empty** result.
  Inspect one row before writing the loop.
- Filter `week <= 18`; nflverse weekly files carry postseason rows.
- Absence casts no vote. A player missing from a season, or under 4 games, is
  *unknown*, never a zero.
- Seeding is **record-first**; total points is only the tiebreaker. So the
  question is always "does this win more weeks", not "does this score more".
- Ethan is team id **1**. Match teams by id — names change mid-season.
- Never read `.env`. Live-roster scripts take credentials via
  `node --env-file=.env`.

---

# Worked example — Bowers+Wilson for Waddle+LaPorta (Aug 22 2026)

The review this skill was extracted from. Ethan **receives** Brock Bowers (TE,
LV) + Michael Wilson (WR, ARI); **gives** Jaylen Waddle (WR, traded to DEN for
a 1st + 3rd) + Sam LaPorta (TE, DET).

## Step 1 output — weekly shape

`node scripts/trade-profile.js "jaylen waddle" "brock bowers" "sam laporta" "michael wilson"`

2025, real weeks:

| Player | G | ppg | median | best | sd | good% | bust% |
|---|---|---|---|---|---|---|---|
| Waddle (WR) | 16 | 12.13 | 13.2 | **23.0** | 6.87 | 12 | 38 |
| Bowers (TE) | 12 | 14.68 | 11.5 | **43.3** | 10.12 | 25 | 42 |
| LaPorta (TE) | 9 | 11.88 | 10.3 | 21.7 | 6.45 | 44 boom | **44** |
| M. Wilson (WR) | 17 | 12.98 | **8.4** | 37.2 | 10.6 | 12 | 41 |
| Bowers **2024** | 17 | **15.45** | 15.0 | 31.3 | 7.89 | **53** | 29 |

Reframes the whole trade:
- Waddle's *best game of the season was 23.0* — against a top-12 WR baseline
  where 8% of weeks clear 30. His ceiling was the story, and it was absent.
- Wilson's 12.98 ppg beats Waddle's — on an **8.4 median**. Average lies here.
- Bowers' healthy 2024 (15.45 ppg, 53% good weeks) is a better read of him
  than his injured 2025. **Pull more than one season.**

Waddle's career line was the other decisive pull — 15.5 / 15.2 / 14.2 / 10.0
/ 12.1 ppg, best games 29.0 / **40.1** / 28.2 / 28.4 / 23.0. He *has* a
40-point game in him (2022), so "no ceiling" was wrong; but he has **never
averaged 17 and never finished top-12** in five seasons.

## Step 2 — the role test (this decided it)

Waddle 2025 per-game target share: **23.0%** — a real WR1 workload — for
12.13 ppg. Denver fixes opportunity. Opportunity was never broken. Expect
13-14 ppg, not 16.

## Steps 3-4 — differential and breakeven

P(trade improves wins) **61.6%**; median **+0.30** wins; 80% range **-0.97 to
+1.53**. Breakeven: **Waddle at ~14.8 ppg**. ESPN projects 12.5 (take it);
Yahoo/FSC argue 16 (decline). Sweep: 12.5 -> 63.0% | 14 -> 55.6% |
15 -> 47.8% | 16 -> 40.2% | 17 -> 36.4%.

## Step 5 — the debate

**FOR:** you are trading a WR3, not a WR1. Bowers is TE1-baseline +2.7/wk at
an 8% bust rate; only 1.5% of TE weeks clear 30 and he has a 43-point game.
*Self-declared weakness:* TE is the model's worst position (0.416) and the
Denver bull case sits above breakeven.

**AGAINST:** 14.8 is *below three of Waddle's five seasons*. +0.30 wins is a
rounding error measured by an instrument already proven unreliable. LaPorta is
already a top-12 TE; you are buying ~2.8 ppg. You are the favorite — favorites
want floors, and this swaps a 13.2 median for an 8.4 median.
*Self-declared weakness:* "Denver fixes him" is a story, not a measurement.

**JUDGE — TAKE, 65% confidence.** What it caught that neither side did:

1. FOR quoted Wilson's **mean** where the **median** was the honest number.
2. AGAINST applied a durability discount to Bowers (12 of 17 games) but not to
   LaPorta (9 of 17), who was the sicker one — its biggest flaw.
3. **AGAINST used the simulator's unreliability to argue for declining. But
   the simulator is the thing saying take.** Discarding a broken instrument
   does not land you on the opposite conclusion — it lands you on the raw
   numbers, which still favor Bowers. *Unreliable evidence for X is not
   evidence for not-X.*
4. On floors: AGAINST was right on the principle and wrong on the application.
   Bowers busts 8%, LaPorta 44%. Swapping them is the largest **floor** gain
   on the board; the variance added is at flex, and it is smaller.

**Verdict:** you are not buying Bowers' ceiling — you are buying out of
LaPorta's 44% bust rate and selling a WR who was given a full role and
returned 12 points a week.

**What would flip it:** a measured 2026 Waddle target share in Denver at or
above **27%**. Watch weeks 1-3. At 23% again, the trade is settled in Ethan's
favor.

## Corrections made mid-review — expect these

Three times the first read was wrong and the data fixed it. Budget for it:

- "Waddle has no ceiling" — false, 40.1 in 2022. One season is not a player.
- "Bowers is the safe one, Waddle the upside one" — **backwards**. Bowers had
  both the lower bust rate (8% vs 38%) and the higher ceiling.
- "You're the favorite so decline the volatile side" — right principle,
  wrong direction; the trade *raises* the floor.
