# Joining players across sources

## Name normalization

Normalize both sides with the same function:

```js
const norm = n => (n || '').toLowerCase().replace(/[.'`-]/g, '')
  .replace(/\s+(jr|sr|ii|iii|iv|v)$/, '').replace(/\s+/g, ' ').trim();
```

- Suffixes: nflverse keeps "Jr.", Sleeper drops it.
- Initials: "D.K. Metcalf" vs "DK Metcalf".
- Nicknames are the real trap: ESPN "Hollywood Brown" = nflverse "Marquise Brown".
  Keep an explicit nickname map, and confirm BOTH spellings in the raw files before adding
  an entry — a wrong entry grafts one player's games onto another.
- D/ST names never match across sources. Expect it.

## Report unmatched players, never drop them

Print every name that failed to join. A silent drop reads as "this player has no data",
which then becomes a fake low rating.

## Sleeper

- `https://api.sleeper.app/v1/players/nfl` is free and keyless, ~5MB. Cache it for 24h.
- Trim to active QB/RB/WR/TE/K/DEF before storing in a browser.
- If you change the stored row shape, change the cache key, or old rows deserialize wrong.
- `depth_chart_order` is the pre-season role signal. `years_exp === 0` = rookie.

## ADP

- Fantasy Football Calculator: `https://fantasyfootballcalculator.com/api/v1/adp/ppr?teams=12&year=YYYY`
  — free, keyless, ~15 rounds, past seasons available. A past year's ADP never changes, so it
  is safe to cache.
- A player missing from an ADP list IS undrafted (the list is the whole board). This is the
  one place absence is a real false.
