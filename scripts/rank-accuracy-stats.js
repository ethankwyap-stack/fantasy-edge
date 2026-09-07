// Statistical tests over scripts/rank-accuracy.js's raw output. No network, free, no new deps.
//
//   node scripts/rank-accuracy-stats.js --selftest
//   node scripts/rank-accuracy-stats.js            (reads rank-accuracy-raw.json)
//
// Why each test exists:
// - Player-weeks are NOT independent observations. The same player appears up to 18 times a
//   season and a genuinely mis-projected player contributes many correlated rows. A plain
//   t-test over 4,536 rows would treat that as 4,536 independent facts and report a
//   ludicrously tiny p-value. Every interval here is a CLUSTER bootstrap, resampling PLAYERS
//   (with all their weeks attached), which is the honest unit.
// - "ESPN is bad" needs a baseline. `permTest` shuffles the projected order WITHIN each
//   position-week among exactly the players who were graded, so it asks: does ESPN order
//   these same 30 men better than a coin flip would? That is answerable with the data on
//   hand and does not need the full pool re-fetched.
// - The signed-error sign test measures the WALL directly, rather than inferring it.
const fs = require('fs');
const B = +(process.env.BOOT || 2000);
const RAW = 'rank-accuracy-raw.json';
const SLICES = { QB: [[1, 6], [7, 12]], TE: [[1, 6], [7, 12]],
                 RB: [[1, 6], [7, 12], [13, 20], [21, 30]], WR: [[1, 6], [7, 12], [13, 20], [21, 30]] };

const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const r3 = n => n === null || n === undefined ? null : +n.toFixed(3);
const pct = (a, q) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))]; };

// Deterministic RNG so a re-run reproduces the same intervals (mulberry32).
function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0;
  let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

const byPlayer = recs => { const m = new Map();
  for (const r of recs) { if (!m.has(r.name)) m.set(r.name, []); m.get(r.name).push(r); } return m; };

// Cluster bootstrap: resample PLAYERS with replacement, keep every week that player owns.
// `stat` gets the resampled row array and returns one number.
function clusterBoot(recs, stat, seed = 1) {
  const groups = [...byPlayer(recs).values()];
  const rand = rng(seed), out = [];
  for (let b = 0; b < B; b++) {
    const s = [];
    for (let i = 0; i < groups.length; i++) s.push(...groups[Math.floor(rand() * groups.length)]);
    const v = stat(s);
    if (v !== null && !Number.isNaN(v)) out.push(v);
  }
  return { est: stat(recs), lo: pct(out, 0.025), hi: pct(out, 0.975) };
}

// Bootstrap p-value for "difference is zero": the share of resamples landing on the far side
// of zero, doubled. Not a t-test — no normality is assumed anywhere in this file.
function bootDiff(a, b, stat, seed = 7) {
  const ga = [...byPlayer(a).values()], gb = [...byPlayer(b).values()];
  const rand = rng(seed), diffs = [];
  for (let i = 0; i < B; i++) {
    const sa = [], sb = [];
    for (let j = 0; j < ga.length; j++) sa.push(...ga[Math.floor(rand() * ga.length)]);
    for (let j = 0; j < gb.length; j++) sb.push(...gb[Math.floor(rand() * gb.length)]);
    diffs.push(stat(sa) - stat(sb));
  }
  const est = stat(a) - stat(b);
  const side = est >= 0 ? diffs.filter(d => d <= 0).length : diffs.filter(d => d >= 0).length;
  return { est: r3(est), lo: r3(pct(diffs, 0.025)), hi: r3(pct(diffs, 0.975)),
    p: r3(Math.min(1, 2 * side / diffs.length)) };
}

// Does ESPN order these same players better than chance? Shuffle projRank within each
// (season, week, position) group over exactly the graded set, recompute mean |err|.
function permTest(recs, seed = 11) {
  const key = r => `${r.season}|${r.week}|${r.pos}`;
  const groups = new Map();
  for (const r of recs) { if (!groups.has(key(r))) groups.set(key(r), []); groups.get(key(r)).push(r); }
  const obs = mean(recs.map(r => Math.abs(r.err)));
  const rand = rng(seed), nulls = [];
  for (let b = 0; b < B; b++) {
    let tot = 0, n = 0;
    for (const g of groups.values()) {
      const ranks = g.map(r => r.projRank);
      for (let i = ranks.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [ranks[i], ranks[j]] = [ranks[j], ranks[i]]; }
      for (let i = 0; i < g.length; i++) { tot += Math.abs(g[i].realRank - ranks[i]); n++; }
    }
    nulls.push(tot / n);
  }
  const better = nulls.filter(v => v <= obs).length;
  return { observed: r3(obs), chanceMean: r3(mean(nulls)),
    chanceLo: r3(pct(nulls, 0.025)), chanceHi: r3(pct(nulls, 0.975)),
    p: r3((better + 1) / (nulls.length + 1)) };
}

// Spearman rho between projected and actual rank, per position-week, averaged. Direct
// "is there any signal at all" reading, independent of the tier boundaries.
function spearman(recs) {
  const key = r => `${r.season}|${r.week}|${r.pos}`;
  const groups = new Map();
  for (const r of recs) { if (!groups.has(key(r))) groups.set(key(r), []); groups.get(key(r)).push(r); }
  const rhos = [];
  for (const g of groups.values()) {
    const n = g.length; if (n < 3) continue;
    // projRank is already 1..n dense; realRank is a rank within a much larger pool, so
    // re-rank the actuals WITHIN the graded set or rho is distorted by the pool size.
    const order = [...g].sort((a, b) => a.realRank - b.realRank);
    const rr = new Map(order.map((r, i) => [r, i + 1]));
    const d2 = g.reduce((a, r) => a + (r.projRank - rr.get(r)) ** 2, 0);
    rhos.push(1 - 6 * d2 / (n * (n * n - 1)));
  }
  return rhos;
}

function selftest() {
  const A = require('assert');
  // clusterBoot must treat one player's many weeks as ONE observation, not many: a dataset
  // of 2 players x 50 weeks has to give a far wider interval than 100 distinct players.
  const mk = (name, err) => ({ name, err, pos: 'RB', projRank: 1, realRank: 1 + err, ptsErr: 0.4, season: 2025, week: 1 });
  const few = [], many = [];
  for (let i = 0; i < 50; i++) { few.push(mk('a', 0), mk('b', 20)); many.push(mk('p' + i, 0), mk('q' + i, 20)); }
  const st = s => mean(s.map(r => r.err));
  const wide = clusterBoot(few, st), narrow = clusterBoot(many, st);
  // 2 clusters of 50 rows vs 100 clusters of 1: the same 100 rows, ~4x the interval width.
  A.ok((wide.hi - wide.lo) > 3 * (narrow.hi - narrow.lo), 'clustering must widen the interval');

  // a perfect ranker must beat the shuffled null; a random one must not
  const perfect = Array.from({ length: 30 }, (_, i) => mk('x' + i, 0));
  perfect.forEach((r, i) => { r.projRank = i + 1; r.realRank = i + 1; });
  A.ok(permTest(perfect).p < 0.01, 'a perfect order must beat chance');

  // spearman: perfect agreement is rho 1, exact reversal is rho -1
  A.equal(r3(mean(spearman(perfect))), 1, 'perfect order -> rho 1');
  const rev = perfect.map((r, i) => ({ ...r, realRank: 30 - i }));
  A.equal(r3(mean(spearman(rev))), -1, 'reversed order -> rho -1');

  // bootDiff must report a p near 1 when the two samples are the same thing
  const d = bootDiff(many, many.map(r => ({ ...r })), st);
  A.equal(d.est, 0, 'identical samples differ by zero');
  console.log('selftest OK');
}

function main() {
  if (!fs.existsSync(RAW)) { console.error(`missing ${RAW} — run: node --env-file=.env scripts/rank-accuracy.js`); process.exit(1); }
  const all = JSON.parse(fs.readFileSync(RAW));
  const out = { generated: new Date().toISOString(), bootstraps: B, n: all.length,
    unit: 'cluster bootstrap resamples PLAYERS, not player-weeks', byPosition: {} };
  console.log(`${all.length} graded player-weeks, ${byPlayer(all).size} distinct players, ${B} bootstraps\n`);

  for (const pos of Object.keys(SLICES)) {
    const p = all.filter(r => r.pos === pos);
    const players = byPlayer(p).size;
    const accurate = s => 100 * s.filter(r => Math.abs(r.err) <= 2).length / s.length;
    const pe = s => mean(s.filter(r => r.ptsErr !== null).map(r => r.ptsErr));
    const ae = s => mean(s.map(r => Math.abs(r.err)));

    const acc = clusterBoot(p, accurate);
    const perm = permTest(p);
    const rho = spearman(p);
    const rhoCI = { est: r3(mean(rho)), lo: r3(pct(rho, 0.025)), hi: r3(pct(rho, 0.975)) };
    const posSign = 100 * p.filter(r => r.err > 0).length / p.length;

    // the headline volatility comparison: top slice vs bottom slice, both measures
    const sl = SLICES[pos];
    const top = p.filter(r => r.projRank >= sl[0][0] && r.projRank <= sl[0][1]);
    const bot = p.filter(r => r.projRank >= sl[sl.length - 1][0] && r.projRank <= sl[sl.length - 1][1]);
    const dPts = bootDiff(top, bot, pe);
    const dRank = bootDiff(top, bot, ae);

    out.byPosition[pos] = { n: p.length, players, accuratePct: { est: r3(acc.est), lo: r3(acc.lo), hi: r3(acc.hi) },
      vsChance: perm, spearman: rhoCI, pctErrorPositive: r3(posSign),
      topVsBottom: { slices: [`${sl[0][0]}-${sl[0][1]}`, `${sl[sl.length-1][0]}-${sl[sl.length-1][1]}`],
        pointsErrDiff: dPts, rankErrDiff: dRank } };

    console.log(`${pos}  n=${p.length} over ${players} players`);
    console.log(`  accurate (<=2 ranks)   ${r3(acc.est)}%   95% CI [${r3(acc.lo)}, ${r3(acc.hi)}]`);
    console.log(`  mean |err|             ${perm.observed}   vs shuffled chance ${perm.chanceMean} [${perm.chanceLo}, ${perm.chanceHi}]   p=${perm.p}`);
    console.log(`  Spearman rho           ${rhoCI.est}   95% of weeks [${rhoCI.lo}, ${rhoCI.hi}]`);
    console.log(`  errors that are falls  ${r3(posSign)}%   (50% = no wall)`);
    console.log(`  top ${out.byPosition[pos].topVsBottom.slices[0]} vs ${out.byPosition[pos].topVsBottom.slices[1]}:`);
    console.log(`     points err diff     ${dPts.est}  CI [${dPts.lo}, ${dPts.hi}]  p=${dPts.p}   <- the valid one`);
    console.log(`     rank  err diff      ${dRank.est}  CI [${dRank.lo}, ${dRank.hi}]  p=${dRank.p}   <- bounded, read with care\n`);
  }
  fs.writeFileSync('rank-accuracy-stats.json', JSON.stringify(out, null, 2));
  console.log('wrote rank-accuracy-stats.json');
}

if (require.main === module) { process.argv.includes('--selftest') ? selftest() : main(); }
module.exports = { clusterBoot, bootDiff, permTest, spearman };
