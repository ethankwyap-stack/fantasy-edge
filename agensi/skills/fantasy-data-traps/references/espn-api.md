# ESPN fantasy API traps

Base: `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/{YEAR}/segments/0/leagues/{LEAGUE_ID}`.
Private leagues need cookies `SWID` (keep the curly braces) and `espn_s2`, read from env vars.
They expire about once a year; a 401 means re-copy them from the browser.

## 1. `stats[]` has FOUR discriminators — filter on all of them

Every player's `stats[]` array mixes seasons, sources, periods and split types.

| Field | Values |
|---|---|
| `seasonId` | the year. Other seasons live in the SAME array. |
| `statSourceId` | `0` = actual, `1` = projection |
| `scoringPeriodId` | `0` = whole season, `N` = week N |
| `statSplitTypeId` | `0` = season total, `1` = single week, `2` = per-game average |

- Missing `seasonId` filter → you average two seasons together, or grab last year's projection.
- Season projection: `statSourceId 1, scoringPeriodId 0, statSplitTypeId 0`. The same entry
  with `statSplitTypeId 2` is the per-game number (~17x smaller). Silent ~20x error.
- Weekly projection: `statSourceId 1, scoringPeriodId N, statSplitTypeId 1`. Not `0`.
- Weekly actual: `statSourceId 0, scoringPeriodId N, statSplitTypeId 1`.

## 2. `appliedStatTotal` on a week-scoped roster call is CUMULATIVE

`playerPoolEntry.appliedStatTotal` on `mRoster` with `scoringPeriodId=N` is season-to-date,
not that week. It equals the weekly score in Week 1 only, so a Week 1 spot check passes.
Symptom: team season totals about 2x too high, still plausible in shape.
Fix: read the week's `stats[]` entry (rule 1). Sanity range for a 14-week PPR team season:
roughly 1,350–2,100 points.

## 3. Repeat `view=`, never comma-join it

`?view=mTeam,mSettings` returns 200 and silently drops `settings`.
`?view=mTeam&view=mSettings` returns both.

## 4. `kona_player_info` needs `scoringPeriodId` in the URL

Without `&scoringPeriodId=N` in the query string, week-N stats come back empty with no error.
Use header `X-Fantasy-Filter: {"players":{"limit":700,"sortPercOwned":{"sortAsc":false,"sortPriority":1}}}`
to get ~700 players in one call. Past seasons' weekly projections are served too.
A player who did not play has NO stat row — "no row = did not play" needs no injury feed.

## 5. `mTransactions2` returns `[]` without a week

On a finished season, calling it without `scoringPeriodId` returns `transactions: []` —
reads as "no trades ever". Loop the weeks. The enum is `TRADE_ACCEPT`, not `TRADE_ACCEPTED`
(400). When an `X-Fantasy-Filter` 400s, read the response `cause` field — it lists valid values.

## 6. Trades: three stacked traps

1. A `TRADE_ACCEPT` has an EMPTY `items` array. The players live on the `TRADE_PROPOSAL`
   it points at via `relatedTransactionId` (which stays `PENDING` even after acceptance).
2. Each executed trade files TWO accepts, one per team, pointing at different proposal ids
   with the same players. Dedup on the sorted player-id set, not the id.
3. Proposal contents are returned only to a participant. League-wide trade analysis is
   impossible from one manager's cookie. Volume (accept count / 2) is the only league-wide stat.

## 7. Waiver/FAAB settings

- `settings.acquisitionSettings.isUsingAcquisitionBudget` is the real FAAB flag.
  `acquisitionBudget: 100` is present on non-FAAB leagues too and means nothing there.
  Gate any bid analysis on the flag, never on bids happening to be 0.
- Team spend: `team.transactionCounter.acquisitionBudgetSpent`.

## 8. Lineup slots

- Use each player's own `eligibleSlots`. Never infer slots from position.
- `lineupSlotCounts` includes slot `20` (bench) and `21` (IR) with nonzero counts. Exclude them
  from any "best lineup" calculation or you will "start" every bench player.
- Locked player = already has a week-N actual entry. It cannot tell "not started" from
  "started, zero points" — only safe before kickoff.

## 9. Preseason projections are inflated

They assume full healthy seasons, so every team finishes under them. "Actual minus
projected" ranks injury luck, not skill. Center on the league mean before ranking.

## 10. Match teams by id, never by name

Team names are manager-editable and change mid-season.

## 11. Playoff seeding field reads wrong

`playoffSeedingRule: TOTAL_POINTS_SCORED` is the TIEBREAKER. Seeds go by record first.
Verify against the league's real final standings before modelling seeding.
