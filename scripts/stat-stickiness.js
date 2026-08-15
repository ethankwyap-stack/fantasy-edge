#!/usr/bin/env node
// Stat stickiness study — free, local, no key. Answers "which stats actually predict
// NEXT season's fantasy points" instead of just describing last season's. Points don't
// predict points well (regression to the mean); a player's ROLE (targets, snaps, air
// yards) and his measured SKILL (separation, yards over expected) are much more stable
// year to year — this is the standard "opportunity beats outcome" finding in public
// football analytics, checked here against this project's own player pool.
//
// For each year Y in 2018..2024: pull a player's usage/skill metrics from that season,
// pair them with his NEXT season's (Y+1) PPG, pool every year together, and correlate.
// A metric with a strong correlation is "sticky" — worth weighting. A metric that
// barely beats "his own points predicted his own future points" (the baseline row) is
// noise dressed up as signal.
//
// Usage: node scripts/stat-stickiness.js [--selftest]
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'stat-stickiness.json');
const CACHE = path.join(ROOT, '.nflverse-cache');
const MIN_G = 4; // same floor as boom-rates.js — under 4 games a rate is arithmetic, not signal
// 2018 is where pfr_advstats (rush before/after contact) starts; 2024->2025 is the last
// finished pair as of this build. Every year here is a completed season, so every fetch
// is safely cacheable — no in-progress-season trap like boom-rates.js has to guard.
const YEARS = [2018, 2019, 2020, 2021, 2022, 2023, 2024];

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

// Every year fetched here is finished, so a disk cache is always safe (no stale-current-season risk).
async function fetchCached(url, file, gz) {
  const cachePath = path.join(CACHE, file);
  try { return fs.readFileSync(cachePath, gz ? undefined : 'utf8'); } catch { }
  const r = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!r.ok) return null;
  const buf = Buffer.from(await r.arrayBuffer());
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(cachePath, buf);
  return gz ? buf : buf.toString('utf8');
}

async function csvRows(url, file, gz) {
  let text = await fetchCached(url, file, gz);
  if (text == null) return null;
  if (gz) text = zlib.gunzipSync(text).toString('utf8');
  const lines = text.split('\n');
  const ix = {}; csvSplit(lines[0]).forEach((c, i) => ix[c] = i);
  const rows = [];
  for (let i = 1; i < lines.length; i++) if (lines[i]) rows.push(csvSplit(lines[i]));
  return { ix, rows };
}

// Same file boom-rates.js downloads (shared cache filename — no duplicate fetch across scripts).
// Unlike boom-rates.js this never touches the in-progress season, so it's always cacheable.
async function seasonStats(yr) {
  const c = await csvRows(`https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${yr}.csv`, `stats_player_week_${yr}.csv`);
  if (!c) return null;
  const out = {};
  for (const f of c.rows) {
    if (f[c.ix.season_type] !== 'REG') continue;
    const pos = f[c.ix.position], name = (f[c.ix.player_display_name] || '').toLowerCase();
    if (!name || !['QB', 'RB', 'WR', 'TE'].includes(pos)) continue;
    const n = k => +f[c.ix[k]] || 0;
    const p = out[name] ||= { pos, g: 0, pts: 0, tgtShare: 0, ayShare: 0, wopr: 0, cpoe: 0, cpoeG: 0, passEpa: 0, rushEpa: 0, recEpa: 0 };
    p.g++; p.pts += n('fantasy_points_ppr');
    p.tgtShare += n('target_share'); p.ayShare += n('air_yards_share'); p.wopr += n('wopr');
    p.passEpa += n('passing_epa'); p.rushEpa += n('rushing_epa'); p.recEpa += n('receiving_epa');
    if (f[c.ix.passing_cpoe]) { p.cpoe += n('passing_cpoe'); p.cpoeG++; }
  }
  return out;
}

async function snapShare(yr) {
  const c = await csvRows(`https://github.com/nflverse/nflverse-data/releases/download/snap_counts/snap_counts_${yr}.csv`, `snap_counts_${yr}.csv`);
  if (!c) return null;
  const out = {};
  for (const f of c.rows) {
    if (f[c.ix.game_type] !== 'REG') continue;
    const name = (f[c.ix.player] || '').toLowerCase();
    if (!name) continue;
    const p = out[name] ||= { g: 0, pct: 0 };
    p.g++; p.pct += +f[c.ix.offense_pct] || 0;
  }
  return out;
}

// Copied from draft-research.js's rushContact rather than shared — that file runs its CLI
// dispatch at require time, so importing it would kick off a full research run.
async function rushContact(yr) {
  const c = await csvRows(`https://github.com/nflverse/nflverse-data/releases/download/pfr_advstats/advstats_week_rush_${yr}.csv`, `advstats_week_rush_${yr}.csv`);
  if (!c) return null;
  const out = {};
  for (const f of c.rows) {
    if (f[c.ix.game_type] !== 'REG') continue;
    const name = (f[c.ix.pfr_player_name] || '').toLowerCase();
    if (!name) continue;
    const n = k => +f[c.ix[k]] || 0;
    const p = out[name] ||= { g: 0, car: 0, ybc: 0, yac: 0, broken: 0 };
    p.g++; p.car += n('carries'); p.ybc += n('rushing_yards_before_contact'); p.yac += n('rushing_yards_after_contact');
    p.broken += n('rushing_broken_tackles');
  }
  return out;
}

// NFL Next Gen Stats — official player-tracking data, free via nflverse. week==0 rows
// are the season-aggregate line (verified: 2023 REG has 115 week-0 rows vs ~60-85 per
// individual week). Separation and YAC-over-expected are genuine tracked SKILL, not a
// derived rate — the closest thing to a non-luck metric available for free.
let ngsCache = null;
async function ngsSeason(yr) {
  if (!ngsCache) {
    const [rec, rush] = await Promise.all([
      csvRows('https://github.com/nflverse/nflverse-data/releases/download/nextgen_stats/ngs_receiving.csv.gz', 'ngs_receiving.csv.gz', true),
      csvRows('https://github.com/nflverse/nflverse-data/releases/download/nextgen_stats/ngs_rushing.csv.gz', 'ngs_rushing.csv.gz', true),
    ]);
    ngsCache = { rec, rush };
  }
  const out = {};
  const { rec, rush } = ngsCache;
  if (rec) for (const f of rec.rows) {
    if (f[rec.ix.season_type] !== 'REG' || +f[rec.ix.week] !== 0 || +f[rec.ix.season] !== yr) continue;
    const name = (f[rec.ix.player_display_name] || '').toLowerCase();
    if (!name) continue;
    out[name] = { ...out[name], sep: +f[rec.ix.avg_separation] || null, yacOE: +f[rec.ix.avg_yac_above_expectation] || null };
  }
  if (rush) for (const f of rush.rows) {
    if (f[rush.ix.season_type] !== 'REG' || +f[rush.ix.week] !== 0 || +f[rush.ix.season] !== yr) continue;
    const name = (f[rush.ix.player_display_name] || '').toLowerCase();
    if (!name) continue;
    out[name] = { ...out[name], ryoe: +f[rush.ix.rush_yards_over_expected_per_att] || null, stackedBox: +f[rush.ix.percent_attempts_gte_eight_defenders] || null };
  }
  return out;
}

async function buildYear(yr) {
  const [stats, snap, rush, ngs] = await Promise.all([seasonStats(yr), snapShare(yr), rushContact(yr), ngsSeason(yr)]);
  if (!stats) return null;
  const out = {};
  for (const name in stats) {
    const s = stats[name];
    if (s.g < MIN_G) continue;
    const sn = snap && snap[name], ru = rush && rush[name], ng = ngs && ngs[name];
    out[name] = {
      pos: s.pos, g: s.g, ppg: s.pts / s.g,
      tgtSharePct: s.g ? s.tgtShare / s.g * 100 : null,
      aySharePct: s.g ? s.ayShare / s.g * 100 : null,
      woprPerG: s.g ? s.wopr / s.g : null,
      cpoe: s.cpoeG ? s.cpoe / s.cpoeG : null,
      passEpaPerG: s.g ? s.passEpa / s.g : null,
      snapSharePct: sn && sn.g ? sn.pct / sn.g * 100 : null,
      ybcPerCar: ru && ru.car ? ru.ybc / ru.car : null,
      yacPerCar: ru && ru.car ? ru.yac / ru.car : null,
      brokenPerG: ru && ru.g ? ru.broken / ru.g : null,
      ngsSep: ng ? ng.sep : null,
      ngsYacOE: ng ? ng.yacOE : null,
      ngsRyoe: ng ? ng.ryoe : null,
      ngsStackedBox: ng ? ng.stackedBox : null,
    };
  }
  return out;
}

// Metrics tested per position group, each paired against next-year PPG. "ppg" itself
// is included as the baseline every other metric has to beat.
const METRICS = {
  QB: [
    ['ppg', 'own PPG (baseline)'], ['cpoe', 'CPOE (completion % over expected)'], ['passEpaPerG', 'passing EPA/game'],
  ],
  RB: [
    ['ppg', 'own PPG (baseline)'], ['snapSharePct', 'snap share'], ['tgtSharePct', 'target share'],
    ['ybcPerCar', 'yards before contact/rush'], ['yacPerCar', 'yards after contact/rush'], ['brokenPerG', 'broken tackles/game'],
    ['ngsRyoe', 'NGS rush yards over expected/att'], ['ngsStackedBox', 'NGS % runs vs 8+ defenders'],
  ],
  'WR/TE': [
    ['ppg', 'own PPG (baseline)'], ['tgtSharePct', 'target share'], ['aySharePct', 'air-yards share'], ['woprPerG', 'WOPR/game'],
    ['snapSharePct', 'snap share'], ['ngsSep', 'NGS avg separation'], ['ngsYacOE', 'NGS YAC over expected'],
  ],
};
const posGroup = pos => pos === 'WR' || pos === 'TE' ? 'WR/TE' : pos;

function pearson(pairs) {
  const n = pairs.length;
  if (n < 8) return null; // too few pairs to trust a correlation
  const mx = pairs.reduce((a, [x]) => a + x, 0) / n, my = pairs.reduce((a, [, y]) => a + y, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (const [x, y] of pairs) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; syy += (y - my) ** 2; }
  if (!sxx || !syy) return null;
  return sxy / Math.sqrt(sxx * syy);
}
const r2 = n => n == null ? null : Math.round(n * 1000) / 1000;

function correlate(yearData) {
  const results = { QB: [], RB: [], 'WR/TE': [] };
  for (const grp in METRICS) {
    for (const [key, label] of METRICS[grp]) {
      const pairs = [];
      for (const yr of YEARS) {
        const cur = yearData[yr], next = yearData[yr + 1];
        if (!cur || !next) continue;
        for (const name in cur) {
          if (posGroup(cur[name].pos) !== grp) continue;
          const nextP = next[name];
          if (!nextP || posGroup(nextP.pos) !== grp) continue;
          const v = cur[name][key];
          if (v == null || Number.isNaN(v)) continue;
          pairs.push([v, nextP.ppg]);
        }
      }
      const r = pearson(pairs);
      results[grp].push({ key, label, r: r2(r), n: pairs.length });
    }
    results[grp].sort((a, b) => Math.abs(b.r || 0) - Math.abs(a.r || 0));
  }
  return results;
}

async function main() {
  console.log(`Pulling ${YEARS[0]}-${YEARS[YEARS.length - 1] + 1} (${YEARS.length + 1} seasons) across 4 free nflverse sources...`);
  const yearData = {};
  for (const yr of [...YEARS, YEARS[YEARS.length - 1] + 1]) {
    console.log(`  ${yr}...`);
    yearData[yr] = await buildYear(yr);
  }
  const results = correlate(yearData);

  for (const grp in results) {
    console.log(`\n${grp} — predicting NEXT season's PPG (r = correlation, higher |r| = stickier)`);
    for (const row of results[grp]) console.log(`  ${(row.r ?? 0).toFixed(3).padStart(7)}  n=${String(row.n).padEnd(5)} ${row.label}`);
  }

  fs.writeFileSync(OUT, JSON.stringify({
    generated: new Date().toISOString(),
    method: 'Pearson r between a stat measured in year Y and the same player\'s PPR PPG in year Y+1, pooled across years, min 4 games played in both years.',
    yearsUsed: YEARS, minGames: MIN_G,
    results,
  }, null, 1));
  console.log(`\nstat-stickiness.json written.`);
}

function selftest() {
  const assert = require('assert');
  // Perfect line: r must be 1.
  assert.strictEqual(pearson([[1, 2], [2, 4], [3, 6], [4, 8], [5, 10], [6, 12], [7, 14], [8, 16]]), 1);
  // Perfect inverse: r must be -1.
  assert.strictEqual(pearson([[1, 8], [2, 7], [3, 6], [4, 5], [5, 4], [6, 3], [7, 2], [8, 1]]), -1);
  // No linear relationship: r near 0.
  const flat = pearson([[1, 5], [2, 5], [3, 5], [4, 5], [5, 5], [6, 5], [7, 5], [8, 5]]);
  assert.strictEqual(flat, null, 'zero-variance y has no defined correlation');
  // Fewer than 8 pairs is refused, not silently reported as a real correlation.
  assert.strictEqual(pearson([[1, 2], [2, 4]]), null);

  const yearData = {
    2020: { alice: { pos: 'WR', ppg: 10, tgtSharePct: 30 }, bob: { pos: 'WR', ppg: 4, tgtSharePct: 8 } },
    2021: { alice: { pos: 'WR', ppg: 12, tgtSharePct: 28 }, bob: { pos: 'WR', ppg: 5, tgtSharePct: 9 } },
  };
  const savedYears = YEARS.slice();
  YEARS.length = 0; YEARS.push(2020);
  const r = correlate(yearData);
  const tgt = r['WR/TE'].find(m => m.key === 'tgtSharePct');
  assert.strictEqual(tgt.n, 2, 'both players paired year over year');
  assert.strictEqual(tgt.r, null, 'below the n<8 floor, pearson refuses to report a correlation');
  YEARS.length = 0; YEARS.push(...savedYears);

  console.log('selftest: all assertions passed');
}

module.exports = { pearson, correlate };

if (require.main === module) {
  if (process.argv.includes('--selftest')) selftest();
  else main();
}
