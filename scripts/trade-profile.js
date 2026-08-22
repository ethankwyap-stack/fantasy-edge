// Trade profile: positional baselines + per-player career/weekly shape.
// node scripts/trade-profile.js "jaylen waddle" "brock bowers" ...
// No network cost beyond nflverse's free CSVs (cached for finished seasons).
const { weekly } = require('./boom-rates.js');

const YEARS = (process.env.YEARS || '2021,2022,2023,2024,2025').split(',').map(Number);
const BASE_YEARS = YEARS.slice(-3);
// "good"/"bad" game thresholds per position, in PPR points
const GOOD = { WR: 20, RB: 20, TE: 15, QB: 22 }, BAD = { WR: 15, RB: 15, TE: 10, QB: 15 };
const TOPN = { QB: 12, RB: 24, WR: 12, TE: 12 };

const pct = (a, f) => +(100 * a.filter(f).length / a.length).toFixed(1);
const sum = a => a.reduce((x, y) => x + y, 0);

async function load(yr) {
  const by = {};
  for (const r of await weekly(yr)) {
    if (r.week > 18) continue;             // playoff rows are not fantasy-regular-season
    (by[r.name] = by[r.name] || { pos: r.pos, p: [] }).p.push(r.pts);
  }
  return by;
}

// What a real top-N finisher at this position actually looks like week to week.
function baseline(by, pos) {
  const top = Object.entries(by).filter(([, v]) => v.pos === pos)
    .map(([n, v]) => ({ n, tot: sum(v.p), g: v.p.length, p: v.p }))
    .sort((a, b) => b.tot - a.tot).slice(0, TOPN[pos]).filter(x => x.g >= 10);
  const all = top.flatMap(x => x.p);
  if (!all.length) return null;
  return {
    ppg: +(sum(all) / all.length).toFixed(2),
    median: +all.slice().sort((a, b) => a - b)[Math.floor(all.length / 2)].toFixed(1),
    pctGood: pct(all, v => v >= GOOD[pos]), pctBad: pct(all, v => v <= BAD[pos]),
    pct30: pct(all, v => v >= 30), weeks: all.length,
  };
}

function selftest() {
  const by = { a: { pos: 'TE', p: [30, 10, 20, 5, 12, 18, 9, 14, 11, 16] },
               b: { pos: 'TE', p: [1, 1, 1] } };
  const t = baseline(by, 'TE');
  console.assert(t.weeks === 10, 'thin player (<10 g) must not enter the baseline');
  console.assert(t.pctGood === 40, 'TE good = 15+, expected 40, got ' + t.pctGood);
  console.assert(t.pctBad === 30, 'TE bad = 10 or less, expected 30, got ' + t.pctBad);
  console.assert(baseline({}, 'WR') === null, 'no players must return null, never a zero');
  console.log('selftest ok');
}

(async () => {
  if (process.argv[2] === '--selftest') return selftest();
  const names = process.argv.slice(2).map(s => s.toLowerCase());
  if (!names.length) { console.error('usage: node scripts/trade-profile.js "player name" ...'); process.exit(1); }
  const seasons = {};
  for (const yr of YEARS) seasons[yr] = await load(yr);

  const out = { baselines: {}, players: {} };
  for (const pos of ['QB', 'RB', 'WR', 'TE'])
    for (const yr of BASE_YEARS) {
      const b = baseline(seasons[yr], pos);
      if (b) (out.baselines[pos] = out.baselines[pos] || {})[yr] = b;
    }

  for (const name of names) {
    const rows = out.players[name] = {};
    for (const yr of YEARS) {
      const e = seasons[yr][name];
      if (!e) continue;                     // absence casts no vote — never a zero
      const p = e.p.slice().sort((a, b) => b - a), g = p.length;
      const good = GOOD[e.pos], bad = BAD[e.pos];
      const mean = sum(p) / g;
      // sample sd (n-1); a 1-game season has no measurable spread
      const sd = g > 1 ? Math.sqrt(sum(p.map(v => (v - mean) ** 2)) / (g - 1)) : null;
      rows[yr] = {
        pos: e.pos, g, ppg: +mean.toFixed(2),
        median: +p[Math.floor(g / 2)].toFixed(1),
        best: +p[0].toFixed(1), top3: p.slice(0, 3).map(v => +v.toFixed(1)),
        sd: sd === null ? null : +sd.toFixed(2),
        pctGood: pct(p, v => v >= good), pctBad: pct(p, v => v <= bad),
        thin: g < 4 || null,                // under 4 games is arithmetic, not signal
      };
    }
  }
  console.log(JSON.stringify(out, null, 1));
})();
