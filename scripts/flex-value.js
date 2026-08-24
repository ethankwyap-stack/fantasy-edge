// Is a WR a better PPR flex than an RB? NFL-wide, free (nflverse via boom-rates weekly()).
// League shape (hard-coded, from mSettings): 12 teams, 1QB/2RB/2WR/1TE/1FLEX.
const { weekly } = require('./boom-rates.js');

const TEAMS = 12, START = { RB: 2 * TEAMS, WR: 2 * TEAMS, TE: 1 * TEAMS };
const SEASONS = (process.env.SEASONS || '2021,2022,2023,2024,2025').split(',').map(Number);
const MIN_G = 4;                       // same abstain rule as boom-rates
const FLEX_GOOD = 15;                  // a week that actually wins you the flex slot

const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
const median = a => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// season -> pos -> players sorted by ppg, with weekly rows kept
function seasonTable(rows) {
  const by = new Map();
  for (const r of rows) {
    if (!['RB', 'WR', 'TE'].includes(r.pos)) continue;
    const k = r.pos + '|' + r.name;
    if (!by.has(k)) by.set(k, { name: r.name, pos: r.pos, wk: [] });
    by.get(k).wk.push(r.pts);
  }
  const out = { RB: [], WR: [], TE: [] };
  for (const p of by.values()) {
    if (p.wk.length < MIN_G) continue;   // absence casts no vote
    p.g = p.wk.length; p.ppg = mean(p.wk); p.med = median(p.wk);
    p.good = p.wk.filter(x => x >= FLEX_GOOD).length / p.g;
    out[p.pos].push(p);
  }
  for (const k of Object.keys(out)) out[k].sort((a, b) => b.ppg - a.ppg);
  return out;
}

// average across seasons of the player finishing at positional rank `n`
function atRank(tables, pos, n) {
  const hit = tables.map(t => t[pos][n - 1]).filter(Boolean);
  if (!hit.length) return null;
  return { ppg: mean(hit.map(p => p.ppg)), med: mean(hit.map(p => p.med)), good: mean(hit.map(p => p.good)), n: hit.length };
}

async function main() {
  const tables = [];
  for (const y of SEASONS) tables.push(seasonTable(await weekly(y)));

  // 1. rank-for-rank: RBn vs WRn
  console.log(`\nSeasons ${SEASONS.join(',')} — per-game PPR at each positional finish (min ${MIN_G} g)`);
  console.log('rank   RB ppg   WR ppg   diff | RB med  WR med | RB %15+  WR %15+');
  for (const n of [1, 6, 12, 18, 24, 30, 36, 42, 48]) {
    const r = atRank(tables, 'RB', n), w = atRank(tables, 'WR', n);
    if (!r || !w) continue;
    console.log(
      `${String(n).padStart(3)}  ${r.ppg.toFixed(1).padStart(7)}  ${w.ppg.toFixed(1).padStart(7)}  ${(w.ppg - r.ppg >= 0 ? '+' : '') + (w.ppg - r.ppg).toFixed(1).padStart(5)} |`,
      `${r.med.toFixed(1).padStart(6)} ${w.med.toFixed(1).padStart(6)} |`,
      `${(r.good * 100).toFixed(0).padStart(6)}%  ${(w.good * 100).toFixed(0).padStart(6)}%`);
  }

  // 2. the actual flex pool: who is left after every team fills RB/RB/WR/WR/TE
  console.log('\nFlex pool (what is actually available after 12 teams fill their fixed slots):');
  const pool = { RB: [], WR: [], TE: [] };
  for (const t of tables) for (const pos of ['RB', 'WR', 'TE'])
    pool[pos].push(...t[pos].slice(START[pos]).slice(0, 24));   // next 24 = plausible flex starters
  for (const pos of ['RB', 'WR', 'TE']) {
    const p = pool[pos];
    console.log(`  ${pos}${START[pos] + 1}-${START[pos] + 24}: ${mean(p.map(x => x.ppg)).toFixed(1)} ppg, ` +
      `median week ${mean(p.map(x => x.med)).toFixed(1)}, ${(mean(p.map(x => x.good)) * 100).toFixed(0)}% of weeks 15+`);
  }

  // 3. crossover: how far down the WR list before a WR stops beating RB n
  console.log('\nCrossover — the WR rank whose ppg first drops below each RB rank:');
  for (const n of [6, 12, 18, 24, 30]) {
    const r = atRank(tables, 'RB', n);
    let cross = null;
    for (let k = 1; k <= 60; k++) { const w = atRank(tables, 'WR', k); if (w && w.ppg < r.ppg) { cross = k; break; } }
    console.log(`  RB${n} (${r.ppg.toFixed(1)} ppg)  ≈  WR${cross ? cross - 1 : '60+'}`);
  }
}

function selftest() {
  console.assert(median([1, 2, 3]) === 2 && median([1, 2, 3, 4]) === 2.5, 'median');
  const t = seasonTable([...Array(3)].map((_, i) => ({ pos: 'WR', name: 'a', week: i + 1, pts: 10 })));
  console.assert(t.WR.length === 0, `MIN_G: a ${MIN_G - 1}-game player must abstain`);
  const t2 = seasonTable([...Array(5)].map((_, i) => ({ pos: 'WR', name: 'a', week: i + 1, pts: i < 2 ? 20 : 5 })));
  console.assert(Math.abs(t2.WR[0].good - 0.4) < 1e-9, 'good = share of weeks >= 15');
  console.assert(atRank([{ WR: [] }], 'WR', 1) === null, 'absent rank returns null, never 0');
  console.assert(START.RB === 24 && START.WR === 24, 'league starts 2RB/2WR');
  console.log('selftest ok');
}

if (require.main === module) (process.argv.includes('--selftest') ? (selftest(), 0) : main());
