# Example review

**User:** Here's my script that totals each team's points for last season. Numbers look right.

```js
for (let wk = 1; wk <= 14; wk++) {
  const lg = await get(`...leagues/${LEAGUE}?view=mRoster,mMatchup&scoringPeriodId=${wk}`);
  for (const t of lg.teams)
    for (const e of t.roster.entries)
      if (e.lineupSlotId !== 20) total[t.name] += e.playerPoolEntry.appliedStatTotal;
}
```

**Skill output:**

```
TRAP: appliedStatTotal is cumulative on a week-scoped roster call
WHERE: totals.js:5
SYMPTOM: season totals ~2x too high (e.g. 3,188 instead of 1,657); Week 1 alone looks right
FIX: sum the stats[] entry with seasonId === YEAR && statSourceId === 0 && scoringPeriodId === wk && statSplitTypeId === 1

TRAP: comma-joined view param
WHERE: totals.js:2
SYMPTOM: one view's data silently missing (200 OK)
FIX: ?view=mRoster&view=mMatchup&scoringPeriodId=...

TRAP: IR slot counted as a starter
WHERE: totals.js:5
SYMPTOM: IR players' points added to the team total
FIX: exclude lineupSlotId 20 (bench) AND 21 (IR)

TRAP: team keyed by display name
WHERE: totals.js:5
SYMPTOM: a mid-season rename splits one team into two rows
FIX: key total[] by t.id
```

Regression check added:

```js
// known: this team's real 2025 points-for from the league standings page
console.assert(Math.abs(total[5] - 1731.8) < 1, 'team 5 season total drifted');
```
