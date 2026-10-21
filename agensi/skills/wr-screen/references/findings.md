# Measured findings behind the grades

Data: nflverse weekly player stats (`stats_player` release), regular season only.
Top-24 = top 24 WRs by season PPR total, NFL-wide. Minimum 4 games to count a season.

## Veterans — prior-season per-game target share

1,266 veteran WR-seasons, 2017–2025, 196 top-24 finishes.

| Band | Per-game share | Top-24 rate | n |
|---|---|---|---|
| A | 25%+ | 58.2% | 158 |
| B | 20–25% | 29.5% | 190 |
| C | 15–20% | 15.4% | 227 |
| D | under 15% | 1.9% | 691 |

**Why per game:** a season-total share divides by the team's full-season targets, so missed
games lower it. A receiver with a 29.6% per-game share over 4 healthy games reads 7.0% as a
season total — band D instead of band A. The injured elite receivers are exactly the
buy-low targets, so the wrong formula inverts the most valuable read.

**What did not help (tested inside each band):**
- WR room crowding: in band A, clean rooms 63.3% vs crowded 55.1% — inside noise.
  A true top target is not hurt by good teammates.
- Team pass volume: band A 59.3% (high volume) vs 56.7% (low) — inside noise.
- Both only showed a difference in band C (26.1% vs 10.8%), too narrow to build on.
- Changing teams: 6.9% top-24 vs 18.7% for stayers, but confounded — the receivers who get
  released are usually the weaker ones. Caution flag, not a mechanism.

## Rookies — weeks 1–4 target share

326 rookie WRs, 2016–2025, minimum 4 games. 7 finished top 12 (2.1%); 19 finished top 24 (5.8%).

| Weeks 1–4 share | Top-12 | Top-24 | n |
|---|---|---|---|
| 25%+ | 22.2% | 44.4% | 9 |
| 18–25% | 20.8% | 29.2% | 24 |
| 12–18% | 0% | 8.7% | 46 |
| under 12% | 0% | 3.0% | 135 |

- **Every** top-12 rookie season in ten years came from the 18%+ group. Below 18%: 0 of 181.
- Top-24 does leak from lower shares (8 of 181), so early share is a strong filter for
  top-24 and an absolute one for top-12.
- By fantasy draft cost (12-team PPR ADP): rookies drafted in rounds 7–10 hit top-24 33%
  of the time (n=27); rounds 11–15 4.9% (n=41); undrafted 2.4% (n=255). The late-round
  rookie WR dart is close to worthless; the mid-round one is the play.
- 112 rookies had no weeks 1–4 games; they get no grade.
