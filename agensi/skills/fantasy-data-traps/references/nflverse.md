# nflverse traps

Free, keyless GitHub release files: `https://github.com/nflverse/nflverse-data/releases/download/{TAG}/{FILE}`.
Licenses vary per release (most are CC-BY 4.0; check each release page before redistributing).
Download at runtime; do not bundle the CSVs.

## 1. The URL uses the RELEASE TAG, not the file name

| File | Tag |
|---|---|
| `stats_player_week_{YEAR}.csv` | `stats_player` |
| `snap_counts_{YEAR}.csv` | `snap_counts` |
| `advstats_week_rush_{YEAR}.csv` | `pfr_advstats` |
| `players.csv` | `players` |

Guessing the tag from the file name 404s.

## 2. Weekly files include postseason rows

Weeks 19–22 are playoffs. Filter `season_type == 'REG'` or playoff games contaminate every
weekly rate.

## 3. Never read a cache of the IN-PROGRESS season

The current season's file is rewritten every week. A cached copy silently reports Week 1
numbers in Week 8. Cache finished seasons only; always re-download the current one.
`players.csv` is rewritten as players enter the league — never cache-read it either.

## 4. Target share must be PER GAME

A season-total share (player targets / team season targets) punishes missed games. A
receiver with an elite role who played 4 games reads as a bottom-tier role. Use
`(player targets / player games) / (team targets / team games)`.

## 5. Values that look impossible but are real

- Negative air-yards share: behind-the-line targets. Real.
- A 50%+ single-game target share: real when the team threw few passes.
- A snap-counts row with no stats row: a real zero, not missing data.
- `offense_pct` in snap counts is a 0–1 fraction, not a percent.

## 6. Columns that do not exist where you expect

- `advstats_season_rec` covers only 2018–2020; the weekly receiving advstats have no aDOT.
  Compute aDOT as `receiving_air_yards / targets`.
- Rush yards before/after contact must be weighted by carries, not averaged across weeks.
- There are NO kicker or D/ST rows in the weekly player file. Get K/DST from your
  fantasy platform's actuals.

## 7. Team abbreviations differ from ESPN

| ESPN | nflverse |
|---|---|
| `LAR` | `LA` |
| `WSH` | `WAS` |

Without the map, those teams silently vanish from team-level rankings.

## 8. Per-source season resolution

When some files for the new season exist and others don't, a "latest season" lookup can
mix years. Tag every number with its season if it differs from the rest of the line.
