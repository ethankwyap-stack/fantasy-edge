#!/usr/bin/env node
// Boom/bust rate engine — free, local, no key. Reads nflverse weekly player stats
// (the same GitHub release files draft-research.js uses) and writes boom-rates.json.
//
// WHY: the league prices season-total projection, which everyone can see and which
// hides the shape of the distribution. 8/8/8/8 and 2/2/2/26 have the same average but
// only the second wins a head-to-head week. This league also seeds by TOTAL POINTS with
// 8 of 12 making the playoffs, so spike weeks are worth more here than average.
//
//   boom = share of his games that finished top-5 at his position THAT WEEK
//          (computed within each week across all players at the position — not against
//          a season-long cutoff, which would just re-measure being good overall)
//   bust = share of games under an absolute floor: 8 PPR for RB/WR/TE, 12 for QB.
//          8 is roughly a flex-startable floor; a QB week is scored on a much higher
//          baseline (starters average ~18), so 12 is the equivalent "he lost you the
//          position" line. Absolute, not relative — a bust is a bust in any week.
//   median = honest center for a skewed distribution; mean is dragged by the spikes.
//
// Usage: node scripts/boom-rates.js [--selftest]
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'boom-rates.json');
const CACHE = path.join(ROOT, '.nflverse-cache');
const SEASON = +(process.env.SEASON || 2026);
const POS = new Set(['QB', 'RB', 'WR', 'TE']);
const BOOM_N = 5;
const BUST = { QB: 12, RB: 8, WR: 8, TE: 8 };

// ponytail: csvSplit/csvRows are copied from draft-research.js rather than exported —
// that file runs its CLI dispatch at require time, so importing it would kick off a run.
// Extract to scripts/lib.js if a third script needs them.
function csvSplit(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

// nflverse URLs use the RELEASE TAG (stats_player), not the file name. Guessing 404s.
const URL = yr => `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${yr}.csv`;

// Cached on disk so re-runs and offline runs work without re-downloading 8MB.
async function weekly(yr) {
  const file = path.join(CACHE, `stats_player_week_${yr}.csv`);
  let text = null;
  try { text = fs.readFileSync(file, 'utf8'); } catch { }
  if (!text) {
    try {
      const r = await fetch(URL(yr), { signal: AbortSignal.timeout(120000) });
      if (!r.ok) return null; // season not started / file not published yet
      text = await r.text();
      fs.mkdirSync(CACHE, { recursive: true });
      fs.writeFileSync(file, text);
    } catch (e) { console.warn(`  weekly stats ${yr} fetch failed (${e.message})`); return null; }
  }
  const lines = text.split('\n');
  const ix = {}; csvSplit(lines[0]).forEach((c, i) => ix[c] = i);
  const games = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const f = csvSplit(lines[i]);
    if (f[ix.season_type] !== 'REG') continue;
    const pos = f[ix.position], name = (f[ix.player_display_name] || '').toLowerCase();
    if (!POS.has(pos) || !name) continue;
    games.push({ name, pos, week: +f[ix.week], pts: +f[ix.fantasy_points_ppr] || 0 });
  }
  return games.length ? games : null;
}

const median = a => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const r2 = n => Math.round(n * 100) / 100;

// The whole engine. Booms are decided per (week, position): rank that week's scores,
// top BOOM_N are booms. Everything else derives from the player's own game log.
function rates(games) {
  const boomSet = new Set(); // `${week}|${pos}|${name}`
  const byWeekPos = {};
  for (const g of games) (byWeekPos[`${g.week}|${g.pos}`] ||= []).push(g);
  for (const k in byWeekPos)
    byWeekPos[k].sort((a, b) => b.pts - a.pts).slice(0, BOOM_N).forEach(g => boomSet.add(`${k}|${g.name}`));

  const out = {};
  for (const g of games) {
    const p = out[g.name] ||= { pos: g.pos, pts: [], booms: 0 };
    p.pts.push(g.pts);
    if (boomSet.has(`${g.week}|${g.pos}|${g.name}`)) p.booms++;
  }
  for (const name in out) {
    const p = out[name], g = p.pts.length;
    out[name] = {
      pos: p.pos, g,
      boom: r2(p.booms / g), boomWeeks: p.booms,
      bust: r2(p.pts.filter(x => x < BUST[p.pos]).length / g),
      median: r2(median(p.pts)), mean: r2(p.pts.reduce((a, b) => a + b, 0) / g),
      best: r2(Math.max(...p.pts)),
    };
  }
  return out;
}

async function main() {
  let games = null, season = null;
  for (const yr of [SEASON, SEASON - 1]) { games = await weekly(yr); if (games) { season = yr; break; } }
  if (!games) { console.error('No nflverse weekly data available for ' + SEASON + ' or ' + (SEASON - 1)); process.exit(1); }

  const players = rates(games);
  // Never present a stale year as current — same rule as usageLine()'s [year] tags.
  for (const n in players) players[n].season = season;

  let pool = [];
  try { pool = Object.keys(require(path.join(ROOT, 'draft-analysis.json')).players); } catch { }
  // ESPN keeps suffixes and punctuation nflverse drops (and vice versa). Alias the ESPN
  // spelling onto the same numbers rather than losing the player; exact match wins.
  // Nicknames aren't a spelling difference norm() can strip — ESPN uses the name the player
  // goes by, nflverse the legal one. Verified against the 2025 CSV: Marquise Brown has 16 rows,
  // "Hollywood Brown" zero. Only add a pair here after confirming BOTH sides in the raw data —
  // a wrong alias silently grafts one player's weeks onto another.
  const NICK = { 'hollywood brown': 'marquise brown' };
  const norm = n => (NICK[n] || n).replace(/\s+(jr|sr|ii|iii|iv)\.?$/, '').replace(/[^a-z ]/g, '');
  const byNorm = {}; for (const n in players) (byNorm[norm(n)] ||= []).push(n);
  for (const n of pool) {
    if (players[n]) continue;
    const hit = byNorm[norm(n)];
    if (hit && hit.length === 1) players[n] = players[hit[0]]; // ambiguous norm = leave unmatched
  }
  const matched = pool.filter(n => players[n]);
  const missed = pool.filter(n => !players[n]);

  fs.writeFileSync(OUT, JSON.stringify({
    generated: new Date().toISOString(), season, stale: season !== SEASON,
    boomRule: `top ${BOOM_N} at position within each week (PPR)`, bustPoints: BUST,
    players,
  }, null, 1));

  console.log(`boom-rates.json — ${Object.keys(players).length} players, season ${season}${season !== SEASON ? ` (STALE: no ${SEASON} games yet)` : ''}, ESPN pool matched ${matched.length}/${pool.length}`);
  if (missed.length) console.log('  unmatched (no ' + season + ' regular-season game, or name spelled differently): ' + missed.slice(0, 40).join(', ') + (missed.length > 40 ? ` …+${missed.length - 40}` : ''));
}

function selftest() {
  const assert = require('assert');
  // 3 weeks, one position. A spike guy, a steady guy, and 5 filler scorers so the
  // top-5 line actually bites (top-5 is per week, not a season cutoff).
  const g = [];
  const wk = (week, rows) => rows.forEach(([name, pts]) => g.push({ name, pos: 'WR', week, pts }));
  wk(1, [['spike', 40], ['steady', 9], ['a', 30], ['b', 25], ['c', 20], ['d', 15], ['e', 12]]);
  wk(2, [['spike', 1], ['steady', 9], ['a', 30], ['b', 25], ['c', 20], ['d', 15], ['e', 12]]);
  wk(3, [['spike', 35], ['steady', 10], ['a', 30], ['b', 25], ['c', 20], ['d', 15], ['e', 12]]);
  const r = rates(g);
  assert.strictEqual(r.spike.g, 3);
  assert.strictEqual(r.spike.boom, 0.67, 'top-5 in wk1+wk3, 6th in wk2');
  assert.strictEqual(r.spike.bust, 0.33, 'the 1-point week is under 8');
  assert.strictEqual(r.spike.median, 35);
  assert.strictEqual(r.steady.boom, 0, 'never top 5 in a week despite never busting');
  assert.strictEqual(r.steady.bust, 0, 'all games clear the 8-point floor');
  assert.strictEqual(r.steady.median, 9);
  // Same mean, opposite shape — the whole point of the metric.
  assert.ok(r.spike.mean > r.steady.mean && r.steady.boom < r.spike.boom);
  // A week with fewer than 5 players can't manufacture extra booms.
  const tiny = rates([{ name: 'x', pos: 'TE', week: 1, pts: 3 }]);
  assert.strictEqual(tiny.x.boom, 1); assert.strictEqual(tiny.x.bust, 1);
  console.log('selftest: all assertions passed');
}

if (process.argv.includes('--selftest')) selftest();
else main();
