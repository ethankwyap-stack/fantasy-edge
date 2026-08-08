// Monte Carlo playoff-SEEDING simulator. Simulates every remaining matchup of the
// 14-week regular season many times and reports each team's final-seed distribution.
//   node --env-file=.env scripts/seed-odds.js [--iters N] [--zero-variance] [--out FILE]
//   node scripts/seed-odds.js --selftest     (no network, no cost)
//
// SEEDING RULE — verified against this league's own 2024 + 2025 final standings:
// ESPN's settings.scheduleSettings.playoffSeedingRule = "TOTAL_POINTS_SCORED" is the
// TIEBREAKER, not the primary order. 2025 finals: seed 3 (8-6, 1694.8 PF) sat above
// seed 4 (8-6, 1663.6) — points broke a record tie — while seed 5 (7-7, 1731.8 PF, the
// highest PF of the three) sat BELOW both. Record first, points second. Flip here if
// the league ever switches to a genuine points-only league.
const SEEDING = { primary: 'record', tiebreak: 'pointsFor' };

const fs = require('fs');
const path = require('path');

const { LEAGUE_ID, ESPN_S2, SWID, SEASON = '2026', MY_TEAM_ID = '1' } = process.env;
const POS = { 1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'DST' };
const PLAYOFF_TEAMS = 8;

const arg = (flag, dflt) => { const i = process.argv.indexOf(flag); return i > -1 ? process.argv[i + 1] : dflt; };
const has = flag => process.argv.includes(flag);

// ── ESPN ─────────────────────────────────────────────────────────────────────
// views MUST go out as repeated &view= params — the comma-joined form silently omits `settings`
async function espn(views) {
  const qs = views.split(',').map(v => `view=${v}`).join('&');
  const url = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${SEASON}/segments/0/leagues/${LEAGUE_ID}?${qs}`;
  const res = await fetch(url, { headers: { Cookie: `SWID=${SWID}; espn_s2=${ESPN_S2}` } });
  if (!res.ok) throw new Error(`ESPN ${res.status} on ${views} (401 = cookies expired, re-grab from browser)`);
  return res.json();
}
// EVERY read of stats[] filters seasonId — entries from other seasons live in the same array.
const stat = (p, srcId, wk) => (p.stats || []).find(s => s.statSourceId === srcId && s.seasonId === +SEASON && s.scoringPeriodId === wk);

// ── Weekly mean + variance ───────────────────────────────────────────────────
// THE pluggable seam. Returns {mean, sd} in PPR points for one player in one week.
// Default mean: ESPN's own week-N projection when it has published one, else the
// season projection spread over 17 weeks.
// Default sd: mean × a positional coefficient of variation. These CVs are the model's
// weakest assumption — they are league-wide constants, not per-player.
// ponytail: swap in boom-rates.json (per-player weekly medians / boom-bust) by rewriting
// this one function; nothing else in the file knows where the numbers came from.
const CV = { QB: 0.40, RB: 0.55, WR: 0.60, TE: 0.65, K: 0.45, DST: 0.75 };
let ZERO_VAR = false;
function weekly(p, wk) {
  const mean = p.wk[wk] ?? p.seasonProj / 17;
  return { mean, sd: ZERO_VAR ? 0 : mean * (CV[p.pos] ?? 0.55) };
}

// ── RNG (seeded, so a run is reproducible) ───────────────────────────────────
function mulberry32(a) {
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
// Box-Muller, one draw per call (the spare is not worth the state).
const gauss = rnd => { const u = 1 - rnd(), v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

// ── Optimal lineup ───────────────────────────────────────────────────────────
// QB1 RB2 WR2 TE1 FLEX1(RB/WR/TE) DST1 K1. Greedy per position then best leftover to
// FLEX IS optimal here — no player is eligible for a dedicated slot he isn't sorted into.
const START = { QB: 1, RB: 2, WR: 2, TE: 1, DST: 1, K: 1 }, FLEXOK = ['RB', 'WR', 'TE'];
function starters(scored) { // scored: [{pos, pts, ...}] → the 9 that start
  const by = { QB: [], RB: [], WR: [], TE: [], DST: [], K: [] };
  for (const p of scored) by[p.pos]?.push(p);
  let out = [], rest = [];
  for (const pos in START) {
    const s = by[pos].sort((a, b) => b.pts - a.pts);
    out.push(...s.slice(0, START[pos]));
    if (FLEXOK.includes(pos)) rest.push(...s.slice(START[pos]));
  }
  const flex = rest.sort((a, b) => b.pts - a.pts)[0];
  if (flex) out.push(flex);
  return out;
}
const lineupTotal = scored => starters(scored).reduce((t, p) => t + p.pts, 0);

// ── Seeding ──────────────────────────────────────────────────────────────────
// Returns team ids in seed order 1..N.
function seedOrder(rows) {
  return rows.slice().sort((a, b) => {
    if (SEEDING.primary === 'record') {
      const pa = (a.w + a.t / 2) / (a.w + a.l + a.t), pb = (b.w + b.t / 2) / (b.w + b.l + b.t);
      if (pb !== pa) return pb - pa;
    }
    return b.pf - a.pf;
  }).map(r => r.id);
}

// ── Simulation ───────────────────────────────────────────────────────────────
function simulate(teams, remaining, base, iters, seed = 1) {
  const rnd = mulberry32(seed);
  const weeks = [...new Set(remaining.map(m => m.wk))];
  // Lineups are locked from PROJECTIONS, before the week is played — the same information a
  // manager actually has. Picking the optimal lineup after seeing realized scores would hand
  // every deep roster a free best-of-N bonus (~8 pts/wk for a team carrying 2 QBs and 3 TEs)
  // that no real manager collects.
  // ponytail: no mid-week injury swaps, no waiver adds — the starting nine are fixed for the
  // rest of the season. Upgrade path: re-derive starters per iteration from a sampled
  // availability flag if injuries matter more than the seed spread they'd move.
  const lineups = Object.fromEntries(teams.map(t => [t.id, Object.fromEntries(weeks.map(wk =>
    [wk, starters(t.players.map(p => { const { mean, sd } = weekly(p, wk); return { pos: p.pos, pts: mean, mean, sd }; }))]))]));
  const seedCount = Object.fromEntries(teams.map(t => [t.id, new Array(teams.length).fill(0)]));
  const ptsSum = Object.fromEntries(teams.map(t => [t.id, 0]));

  for (let i = 0; i < iters; i++) {
    const rec = {};
    for (const t of teams) rec[t.id] = { id: t.id, w: base[t.id].w, l: base[t.id].l, t: base[t.id].t, pf: base[t.id].pf };
    for (const wk of weeks) {
      const score = {};
      for (const t of teams) {
        let s = 0;
        for (const p of lineups[t.id][wk]) s += Math.max(0, p.mean + (p.sd ? p.sd * gauss(rnd) : 0));
        score[t.id] = s;
      }
      for (const m of remaining) {
        if (m.wk !== wk) continue;
        const h = score[m.home], a = score[m.away];
        rec[m.home].pf += h; rec[m.away].pf += a;
        if (h > a) { rec[m.home].w++; rec[m.away].l++; }
        else if (a > h) { rec[m.away].w++; rec[m.home].l++; }
        else { rec[m.home].t++; rec[m.away].t++; }
      }
    }
    const order = seedOrder(Object.values(rec));
    if (order.length !== teams.length) throw new Error(`assign: ${order.length} seeds, expected ${teams.length}`);
    order.forEach((id, ix) => seedCount[id][ix]++);
    for (const t of teams) ptsSum[t.id] += rec[t.id].pf;
  }

  return teams.map(t => ({
    id: t.id, name: t.name,
    // Deterministic strength: mean optimal-lineup total, averaged over the weeks actually simulated
    // (week 1 alone is misleading — ESPN has published a real wk-1 projection but nothing for wk 2-14).
    projWeekly: +(weeks.reduce((s, wk) =>
      s + lineups[t.id][wk].reduce((a, p) => a + p.mean, 0), 0) / (weeks.length || 1)).toFixed(1),
    seedProbs: seedCount[t.id].map(c => c / iters),
    top8: seedCount[t.id].slice(0, PLAYOFF_TEAMS).reduce((a, b) => a + b, 0) / iters,
    expPts: +(ptsSum[t.id] / iters).toFixed(1),
  }));
}

// ── Load real league ─────────────────────────────────────────────────────────
async function load() {
  const lg = await espn('mTeam,mRoster,mSettings,mMatchup,mMatchupScore');
  const sched = lg.settings.scheduleSettings;
  if (sched.playoffSeedingRule !== 'TOTAL_POINTS_SCORED')
    console.warn(`  note: playoffSeedingRule is ${sched.playoffSeedingRule}, not the TOTAL_POINTS_SCORED this file was verified against`);
  const regWeeks = sched.matchupPeriodCount;

  const teams = lg.teams.map(t => ({
    id: t.id, name: t.name || t.abbrev,
    players: (t.roster?.entries || []).map(e => {
      const p = e.playerPoolEntry.player;
      const wk = {};
      for (let w = 1; w <= regWeeks; w++) { const s = stat(p, 1, w); if (s) wk[w] = s.appliedTotal; }
      return { name: p.fullName, pos: POS[p.defaultPositionId] || '?', seasonProj: stat(p, 1, 0)?.appliedTotal || 0, wk };
    }),
  }));

  // Completed matchups come from ESPN's own record (it owns ties + adjustments);
  // only UNDECIDED matchups inside the regular season get simulated.
  const base = Object.fromEntries(lg.teams.map(t => [t.id, {
    w: t.record.overall.wins, l: t.record.overall.losses, t: t.record.overall.ties, pf: t.record.overall.pointsFor,
  }]));
  const remaining = lg.schedule
    .filter(m => m.matchupPeriodId <= regWeeks && m.winner === 'UNDECIDED' && m.home && m.away)
    .map(m => ({ wk: m.matchupPeriodId, home: m.home.teamId, away: m.away.teamId }));
  return { teams, base, remaining, regWeeks, sched };
}

// ── Self-check ───────────────────────────────────────────────────────────────
function selftest() {
  const assert = require('assert');
  const ok = (c, m) => assert.ok(c, m);
  // Synthetic 4-team league, 2 weeks, no network.
  const mk = (id, mult) => ({ id, name: 'T' + id, players:
    ['QB', 'RB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'DST', 'K'].map((pos, i) =>
      ({ name: pos + i, pos, seasonProj: 17 * (10 + i) * mult, wk: {} })) });
  const teams = [mk(1, 1.4), mk(2, 1.2), mk(3, 1.0), mk(4, 0.8)];
  const base = Object.fromEntries(teams.map(t => [t.id, { w: 0, l: 0, t: 0, pf: 0 }]));
  // Full round-robin — the zero-variance check below only holds on a BALANCED schedule.
  // On the real 12-team/14-week schedule two adjacent pairs legitimately swap on strength of
  // schedule (verified: Rome 12-2 seeds above Skat 10-4 despite Skat projecting 0.2/wk higher).
  const remaining = [ { wk: 1, home: 1, away: 2 }, { wk: 1, home: 3, away: 4 },
                      { wk: 2, home: 1, away: 3 }, { wk: 2, home: 2, away: 4 },
                      { wk: 3, home: 1, away: 4 }, { wk: 3, home: 2, away: 3 } ];

  // 1. lineup math: QB1 RB2 WR2 TE1 FLEX1 DST1 K1 = 9 starters, bench the worst RB.
  const r = [['QB',30],['RB',20],['RB',18],['RB',17],['RB',2],['WR',19],['WR',15],['TE',12],['DST',9],['K',8]]
    .map(([pos, pts]) => ({ pos, pts }));
  const exp = 30 + 20 + 18 + 19 + 15 + 12 + 17 + 9 + 8;
  ok(lineupTotal(r) === exp, `lineupTotal ${lineupTotal(r)} != ${exp}`);

  // 2. seeding is record-first, points-second (the whole premise).
  const order = seedOrder([{ id: 'a', w: 8, l: 6, t: 0, pf: 1663 }, { id: 'b', w: 8, l: 6, t: 0, pf: 1694 },
                           { id: 'c', w: 7, l: 7, t: 0, pf: 1731 }]);
  ok(order.join() === 'b,a,c', `seedOrder record-first broken: ${order}`);

  // 3. probabilities sum to 1 and 4 distinct seeds are assigned every season.
  ZERO_VAR = false;
  const res = simulate(teams, remaining, base, 400, 7);
  for (const t of res) {
    const s = t.seedProbs.reduce((a, b) => a + b, 0);
    ok(Math.abs(s - 1) < 1e-9, `seedProbs sum ${s} for ${t.name}`);
  }
  for (let s = 0; s < 4; s++) {
    const col = res.reduce((a, t) => a + t.seedProbs[s], 0);
    ok(Math.abs(col - 1) < 1e-9, `seed ${s + 1} assigned ${col} times per season`);
  }

  // 4. zero-variance control: deterministic, and seed order == raw projection order.
  ZERO_VAR = true;
  const a = simulate(teams, remaining, base, 3, 11), b = simulate(teams, remaining, base, 3, 99);
  ok(JSON.stringify(a) === JSON.stringify(b), 'zero-variance run is not deterministic');
  const byProj = a.slice().sort((x, y) => y.projWeekly - x.projWeekly).map(t => t.id);
  const bySeed = a.slice().sort((x, y) => x.seedProbs.indexOf(1) - y.seedProbs.indexOf(1)).map(t => t.id);
  ok(JSON.stringify(byProj) === JSON.stringify(bySeed), `zero-var seed order ${bySeed} != proj order ${byProj}`);
  for (const t of a) ok(t.seedProbs.some(p => p === 1), `${t.name} not deterministic at zero variance`);
  // 5. mid-season path: completed games already banked in `base` carry into the seeding.
  // (Can't be checked against the live league yet — the 2026 season hasn't kicked off.)
  ZERO_VAR = true;
  // The worst roster seeds last from a cold start; bank it 10 wins and it climbs.
  const cold = simulate(teams, remaining, base, 2, 3).find(t => t.id === 4).seedProbs.indexOf(1);
  const hot = simulate(teams, remaining, { ...base, 4: { w: 10, l: 0, t: 0, pf: 5000 } }, 2, 3)
    .find(t => t.id === 4).seedProbs.indexOf(1);
  ok(cold === 3 && hot === 1, `banked wins ignored: worst team seeded ${cold + 1} cold, ${hot + 1} with 10 banked wins`);
  ZERO_VAR = false;
  console.log('seed-odds selftest: all assertions passed');
}

// ── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  if (has('--selftest')) return selftest();
  ZERO_VAR = has('--zero-variance');
  const iters = +arg('--iters', 20000);
  const { teams, base, remaining, regWeeks, sched } = await load();
  const played = teams.length * regWeeks / 2 - remaining.length;
  console.log(`League: ${teams.length} teams, ${regWeeks}-week regular season, ${sched.playoffTeamCount} playoff spots.`);
  console.log(`Seeding: ${SEEDING.primary} first, ${SEEDING.tiebreak} as tiebreak (verified vs 2024/2025 final standings).`);
  console.log(`${played} matchups already decided, ${remaining.length} to simulate × ${iters} seasons${ZERO_VAR ? ' (ZERO VARIANCE)' : ''}.`);

  const t0 = Date.now();
  const res = simulate(teams, remaining, base, iters).sort((a, b) => b.top8 - a.top8);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);

  // sanity assertions on the real run — not eyeballed
  for (const t of res) {
    const s = t.seedProbs.reduce((a, b) => a + b, 0);
    if (Math.abs(s - 1) > 1e-9) throw new Error(`${t.name} seedProbs sum to ${s}`);
  }
  for (let s = 0; s < teams.length; s++) {
    const col = res.reduce((a, t) => a + t.seedProbs[s], 0);
    if (Math.abs(col - 1) > 1e-9) throw new Error(`seed ${s + 1} assigned ${col} times per season`);
  }

  console.log('\n  rk  team                     proj/wk   top-8   exp pts');
  res.forEach((t, i) => {
    const mine = t.id === +MY_TEAM_ID;
    console.log(`${mine ? '►' : ' '}${String(i + 1).padStart(3)}  ${t.name.slice(0, 22).padEnd(24)} ${String(t.projWeekly).padStart(6)}  ${(t.top8 * 100).toFixed(1).padStart(5)}%  ${String(t.expPts).padStart(7)}${mine ? '   ← YOU' : ''}`);
  });
  const me = res.find(t => t.id === +MY_TEAM_ID);
  if (me) console.log(`\nYour seed distribution (${me.name}):\n  ` +
    me.seedProbs.map((p, i) => `${i + 1}:${(p * 100).toFixed(1)}%`).join('  '));

  const out = arg('--out', path.join(__dirname, '..', 'seed-odds.json'));
  fs.writeFileSync(out, JSON.stringify({
    generated: new Date().toISOString(), season: +SEASON, iters, zeroVariance: ZERO_VAR,
    seedingRule: SEEDING, playoffTeams: sched.playoffTeamCount, myTeamId: +MY_TEAM_ID,
    matchupsSimulated: remaining.length, variance: { model: 'truncated normal, sd = mean × positional CV', cv: CV },
    teams: res,
  }, null, 1));
  console.log(`\nseed-odds: ${iters} seasons simulated in ${secs}s — you make the playoffs in ${(me ? me.top8 * 100 : 0).toFixed(1)}% of them → ${path.basename(out)}`);
})();
