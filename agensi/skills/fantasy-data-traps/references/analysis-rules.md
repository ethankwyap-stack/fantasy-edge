# Analysis rules for fantasy studies

## Small samples abstain

Under 4 games, a rate is arithmetic, not signal. One good Week 1 reads as a 100% boom
rate. Return "too few games", not a number, and make downstream code treat it as neutral.
Any test fixture must include the game count, or every entry falls out of the baseline.

## Absence casts no vote

A source that omits a player has no opinion on him. Never fill the gap with a low rank,
a 0% rate, or a 0 projection. A rookie with no history gets "no data", not a bad grade.

## Bye weeks look like injuries

A bye is one missed week. Require 2+ consecutive absences before calling something an
injury window.

## Report the median for skewed weekly scores

Weekly fantasy points are right-skewed. A boom/bust receiver with a 13 ppg mean can have
an 8-point median. Report both.

## Rank comparisons

- **Drop rows before ranking.** If comparing projected rank to actual rank, remove players
  with no actual row BEFORE ranking either side. Ranking first shifts everyone below a gap
  by one slot and invents error.
- **Rank both sides inside the same set.** If the projected side ranks only the top 30 but
  the actual side ranks all 90 players with a row, every player "falls" on average. That is
  a pool-size artifact. Re-rank actuals within the graded set.
- **Rank error is bounded at the top.** Rank 1 can only fall. Compare volatility across rank
  bands in points space (`|proj - actual| / proj`), not mean absolute rank error, and report
  the signed mean next to the absolute one.

## Player-weeks are not independent

Thousands of player-week rows may come from a few hundred players. For confidence
intervals, bootstrap by resampling PLAYERS with all their weeks. A plain t-test on
player-weeks reports p-values far smaller than the data supports.
Correct across positions (e.g. Holm) when you test four positions at once.

## Variance transfers as a ratio

Use coefficient of variation (`sd / mean`) to carry a player's volatility from last season
to this week's projection. The absolute sd does not transfer. Kickers and D/ST are the
most volatile slots; leaving them out of a win-probability model makes it overconfident.

## Two valuations for trades

If both sides of a simulated trade use the same player values, mutual gain is nearly
impossible and the finder returns nothing. Model your value and the other manager's
(market) value separately; keep trades that are positive under both.

## Remove by id, not object identity

If you clone player objects to re-label them, an identity check (`includes(p)`) matches
nothing. Always compare player ids.
