// Does ESPN's pre-week PPR positional ranking predict that week's actual result?
// 2023-2025, projected top-30 RB/WR and top-12 QB/TE, graded by rank error.
//
//   node --env-file=.env scripts/rank-accuracy.js --selftest   (pure logic, no network)
//   node --env-file=.env scripts/rank-accuracy.js --spotcheck  (2025 wk1 RB, one call)
//   node --env-file=.env scripts/rank-accuracy.js             (full 54-call run)
//
// Two traps this file exists to avoid:
// 1. DROP BEFORE RANKING. A player with no weekly actual row (injured/bye/inactive/benched)
//    is dropped. Ranking first and filtering after shifts every player below the hole up a
//    slot and manufactures error that the projection never made. Filter and rank do not
//    commute.
// 2. RANK ERROR IS BOUNDED AT THE TOP OF A BAND. The projected RB1 can only fall; the
//    projected RB20 moves both ways. So mean |rank error| is mechanically compressed at the
//    edges and cannot answer "is the top more volatile". Hence the signed mean per slice AND
//    a points-space error, which has no rank ceiling. When they disagree, points is the answer.
const fs = require('fs');

const { LEAGUE_ID, ESPN_S2, SWID } = process.env;
const SEASONS = (process.env.SEASONS || '2023,2024,2025').split(',').map(Number);
const WEEKS = 18;
const POS = { 1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE' };
const BAND = { QB: 12, RB: 30, WR: 30, TE: 12 };
// Ethan's tiers (Sep 7 2026), on |realRank - projRank|. Derived from the stored raw signed
// errors on every run, never accumulated as counters — a boundary change is a one-line edit.
const TIERS = [['accurate', 0, 2], ['less accurate', 3, 5], ['not accurate', 6, Infinity]];
const SLICES = { QB: [[1, 6], [7, 12]], TE: [[1, 6], [7, 12]],
                 RB: [[1, 6], [7, 12], [13, 20], [21, 30]], WR: [[1, 6], [7, 12], [13, 20], [21, 30]] };
const OUT = 'rank-accuracy.json';
const RAW = 'rank-accuracy-raw.json';

// The FOUR stat discriminators (seasonId / statSourceId / scoringPeriodId / statSplitTypeId).
// A weekly entry is statSplitTypeId 1; statSplitTypeId 0 on scoringPeriodId 0 is the SEASON
// TOTAL — grabbing it is a silent ~20x error. src 1 = projection, src 0 = actual.
const stat = (p, yr, wk, src) => (p?.stats || []).find(s =>
  s.seasonId === yr && s.statSourceId === src && s.scoringPeriodId === wk && s.statSplitTypeId === 1);

const tierOf = e => TIERS.find(([, lo, hi]) => Math.abs(e) >= lo && Math.abs(e) <= hi)[0];
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
const r2 = n => n === null ? null : +n.toFixed(2);

// One kona_player_info call returns the whole 700-player pool for that scoringPeriodId.
async function pool(yr, wk) {
  const filter = { players: { limit: 700, sortPercOwned: { sortAsc: false, sortPriority: 1 } } };
  const url = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${yr}`
    + `/segments/0/leagues/${LEAGUE_ID}?scoringPeriodId=${wk}&view=kona_player_info`;
  const res = await fetch(url, { headers: {
    Cookie: `SWID=${SWID}; espn_s2=${ESPN_S2}`, 'X-Fantasy-Filter': JSON.stringify(filter) } });
  if (!res.ok) throw new Error(`ESPN ${res.status} ${yr} wk${wk} (401 = cookies expired)`);
  return (await res.json()).players || [];
}

// The whole study in one function, so --selftest can drive it with fixtures.
// rows: [{name, pos, proj, actual|null}]. A null actual is dropped BEFORE either ranking.
function gradeWeek(rows) {
  const out = [];
  for (const pos of Object.keys(BAND)) {
    const live = rows.filter(r => r.pos === pos && r.actual !== null && r.actual !== undefined);
    const byProj = [...live].sort((a, b) => b.proj - a.proj);
    const byReal = [...live].sort((a, b) => b.actual - a.actual);
    const realRank = new Map(byReal.map((r, i) => [r, i + 1]));
    byProj.slice(0, BAND[pos]).forEach((r, i) => {
      const projRank = i + 1;
      out.push({ name: r.name, pos, projRank, realRank: realRank.get(r),
        err: realRank.get(r) - projRank,                                  // signed, raw
        projPts: r.proj, actualPts: r.actual,
        ptsErr: r.proj > 0 ? Math.abs(r.proj - r.actual) / r.proj : null }); // unbounded
    });
  }
  return out;
}

function summarize(recs) {
  const tiers = {}; for (const [t] of TIERS) tiers[t] = 0;
  for (const r of recs) tiers[tierOf(r.err)]++;
  const n = recs.length;
  const pct = {}; for (const t of Object.keys(tiers)) pct[t] = n ? +(100 * tiers[t] / n).toFixed(1) : null;
  return { n, tiers, pct,
    meanAbsErr: r2(mean(recs.map(r => Math.abs(r.err)))),
    meanSignedErr: r2(mean(recs.map(r => r.err))),
    meanPtsErr: r2(mean(recs.filter(r => r.ptsErr !== null).map(r => r.ptsErr))) };
}

function sliceUp(recs, pos) {
  const o = {};
  for (const [lo, hi] of SLICES[pos]) {
    const s = recs.filter(r => r.projRank >= lo && r.projRank <= hi);
    o[`${lo}-${hi}`] = summarize(s);
  }
  return o;
}

function report(all) {
  const res = { generated: new Date().toISOString(), seasons: SEASONS, tiers: TIERS.map(t => t.slice(0, 3)),
    note: 'meanPtsErr is the valid cross-slice volatility measure; rank error is bounded at band edges.',
    byPosition: {}, worstMisses: [] };
  for (const pos of Object.keys(BAND)) {
    const p = all.filter(r => r.pos === pos);
    res.byPosition[pos] = { combined: summarize(p), slices: sliceUp(p, pos), bySeason: {} };
    for (const yr of SEASONS) res.byPosition[pos].bySeason[yr] = summarize(p.filter(r => r.season === yr));
  }
  res.worstMisses = [...all].sort((a, b) => Math.abs(b.err) - Math.abs(a.err)).slice(0, 20);
  return res;
}

function selftest() {
  const A = require('assert');
  // (a) the 4-field discriminator: the season-total entry must never be picked as a weekly one
  const p = { stats: [
    { seasonId: 2025, statSourceId: 1, scoringPeriodId: 0, statSplitTypeId: 0, appliedTotal: 340 },
    { seasonId: 2025, statSourceId: 1, scoringPeriodId: 1, statSplitTypeId: 1, appliedTotal: 17.8 },
    { seasonId: 2024, statSourceId: 1, scoringPeriodId: 1, statSplitTypeId: 1, appliedTotal: 99 } ] };
  A.equal(stat(p, 2025, 1, 1).appliedTotal, 17.8, '4-field discriminator');

  // (b) drop-then-rank: removing a rowless mid-pack player must not change anyone's error
  const mk = (n, proj, actual) => ({ name: n, pos: 'QB', proj, actual });
  const withHim = gradeWeek([mk('a', 30, 30), mk('b', 20, null), mk('c', 10, 20), mk('d', 5, 10)]);
  const without = gradeWeek([mk('a', 30, 30), mk('c', 10, 20), mk('d', 5, 10)]);
  A.deepEqual(withHim.map(r => r.err), without.map(r => r.err), 'drop before rank');
  A.ok(withHim.every(r => r.err === 0), 'no fabricated error from the hole');

  // (c) the band is read off projRank, not real rank
  const many = Array.from({ length: 40 }, (_, i) => mk('p' + i, 100 - i, i));
  const g = gradeWeek(many);
  A.equal(g.length, 12, 'QB band is top 12 by projection');
  A.ok(g.every(r => r.projRank <= 12), 'band selected by projRank');

  // (d) tier boundaries
  A.equal(tierOf(2), 'accurate'); A.equal(tierOf(3), 'less accurate');
  A.equal(tierOf(5), 'less accurate'); A.equal(tierOf(6), 'not accurate');
  A.equal(tierOf(-7), 'not accurate', 'tiers use the absolute error');

  // (e) tiers are computed from the stored raw errors, and totals never lose a row
  const recs = [{ err: 0 }, { err: 4 }, { err: -9 }, { err: 2 }];
  const s = summarize(recs);
  A.equal(s.n, 4);
  A.equal(Object.values(s.tiers).reduce((a, b) => a + b, 0), 4, 'tier counts sum to n');
  A.equal(s.meanSignedErr, r2((0 + 4 - 9 + 2) / 4), 'signed mean kept separately from absolute');
  A.notEqual(s.meanSignedErr, s.meanAbsErr, 'signed and absolute are distinct');

  console.log('selftest OK');
}

async function collect(yr, wk) {
  const rows = [];
  for (const pl of await pool(yr, wk)) {
    const pos = POS[pl.player?.defaultPositionId];
    if (!pos) continue;
    const pr = stat(pl.player, yr, wk, 1), ac = stat(pl.player, yr, wk, 0);
    if (!pr) continue;
    rows.push({ name: pl.player.fullName, pos, proj: pr.appliedTotal,
      actual: ac ? ac.appliedTotal : null });
  }
  return rows;
}

async function spotcheck() {
  const rows = await collect(2025, 1);
  const g = gradeWeek(rows).filter(r => r.pos === 'RB').slice(0, 12);
  console.log('2025 wk1 RB — projected top 12 vs where they actually finished:');
  for (const r of g) console.log(
    `  proj RB${String(r.projRank).padStart(2)} ${r.name.padEnd(24)} ${String(r.projPts).padStart(6)} proj`
    + ` -> RB${String(r.realRank).padStart(2)} ${String(r.actualPts).padStart(6)} actual  [${tierOf(r.err)}]`);
}

async function main() {
  const all = [];
  for (const yr of SEASONS) {
    for (let wk = 1; wk <= WEEKS; wk++) {
      const rows = await collect(yr, wk);
      const g = gradeWeek(rows).map(r => ({ ...r, season: yr, week: wk }));
      all.push(...g);
      console.log(`${yr} wk${String(wk).padStart(2)}: ${rows.length} players, ${g.length} graded`);
    }
  }
  const res = report(all);
  fs.writeFileSync(OUT, JSON.stringify(res, null, 2));
  // Raw graded player-weeks, for scripts/rank-accuracy-stats.js. Every headline number is
  // derived from this array, so a test can re-derive it instead of trusting the summary.
  fs.writeFileSync(RAW, JSON.stringify(all));
  for (const pos of Object.keys(BAND)) {
    const c = res.byPosition[pos].combined;
    console.log(`\n${pos} (n=${c.n})  accurate ${c.pct['accurate']}% | less ${c.pct['less accurate']}% | not ${c.pct['not accurate']}%`);
    console.log(`   mean |err| ${c.meanAbsErr}  signed ${c.meanSignedErr}  pts err ${c.meanPtsErr}`);
    for (const [k, s] of Object.entries(res.byPosition[pos].slices))
      console.log(`   proj ${k.padEnd(6)} n=${String(s.n).padStart(4)}  |err| ${s.meanAbsErr}  signed ${s.meanSignedErr}  ptsErr ${s.meanPtsErr}`);
  }
  console.log(`\nwrote ${OUT} + ${RAW} (${all.length} graded player-weeks)`);
}

if (require.main === module) {
  const a = process.argv.slice(2);
  if (a.includes('--selftest')) selftest();
  else if (a.includes('--spotcheck')) spotcheck().catch(e => { console.error(e.message); process.exit(1); });
  else main().catch(e => { console.error(e.message); process.exit(1); });
}

module.exports = { gradeWeek, summarize, tierOf, stat, TIERS, BAND };
