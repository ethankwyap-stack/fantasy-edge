---
name: fantasy-data-traps
description: Use when the user is writing code that reads ESPN fantasy football API data, nflverse NFL stats files, Sleeper player data, or fantasy ADP feeds — e.g. "pull my ESPN league", "parse nflverse weekly stats", "compute target share", "backtest projections", "build a fantasy football tool". Catches the silent data traps that return valid-looking wrong numbers with no error.
---

# Fantasy Data Traps

Fantasy football data sources pack several aggregations into one field and never error
when you take the wrong one. The result looks plausible and is wrong by 2x–20x. This skill
is a checklist of traps measured on real data, each with the symptom and the fix.

## When this skill is active

Before writing or reviewing any code that touches these sources, read the matching
reference file and apply every rule in it:

| Source | Reference |
|---|---|
| ESPN fantasy API (`lm-api-reads.fantasy.espn.com`, `kona_player_info`, `mRoster`, `mMatchup`, `mTransactions2`) | `references/espn-api.md` |
| nflverse release files (`github.com/nflverse/nflverse-data/releases`) | `references/nflverse.md` |
| Sleeper, ADP feeds, joining names across sources | `references/joins.md` |
| Any study, rate, backtest or ranking comparison | `references/analysis-rules.md` |

## What to do

1. Identify every data source the code reads.
2. For each one, check the code against its reference file, rule by rule.
3. For each rule the code breaks, report it in this format:

```
TRAP: <one-line name>
WHERE: <file:line>
SYMPTOM: <what the wrong number looks like>
FIX: <the exact filter / parameter / change>
```

4. Apply the fix if the user asked for code changes. Otherwise list the traps only.
5. Add one cheap regression check per fixed trap — an assert against a known-true number
   (e.g. a team's real season points total) is the cheapest test this data allows.
6. If no trap applies, say "No known traps hit" and name the sources you checked.

## Rules that apply everywhere

- **Never trust a number because it looks plausible.** Every trap in the references
  produces a believable value. Check one result against a number you already know.
- **Absence casts no vote.** A player missing from a source is unknown, not zero. Never
  turn a missing rank, rate or projection into a low score.
- **Credentials come from environment variables only.** ESPN private-league cookies
  (`SWID`, `espn_s2`) must never be hardcoded or committed.

See `examples/example-review.md` for a full worked review.
