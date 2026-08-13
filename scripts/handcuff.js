#!/usr/bin/env node
// RB handcuff hit-rate — free, local, no key. Reads the same nflverse weekly file
// boom-rates.js uses (imported, not re-downloaded).
//
// THE QUESTION: injuries always happen to RBs, so how often does the backup actually
// become startable? The answer only means something next to the alternative use of a
// late-round pick: speculative RB sleepers hit 18.8% of the time (--sleeper-hit-rate).
// If handcuffs beat that, late capital belongs in handcuffs. If not, it doesn't.
//
// DEFINITIONS (Ethan chose (a), "becomes a startable RB"):
//   starter    = per team, per week: the RB with the most carries over his last 3 played
//                weeks. Rolling, so a mid-season change of hands is picked up.
//   out-window = 2+ CONSECUTIVE weeks the starter has no row in the file. Two is the
//                floor on purpose: a bye week is exactly one, so a 1-week rule would
//                count every bye in the league as an injury.
//   handcuff   = the RB who actually took the carries during that window. This is the
//                REALIZED handcuff, not the preseason-expected one — who was drafted as
//                the handcuff is not recoverable from this data, and saying otherwise
//                would flatter the number.
//   HIT        = that handcuff finished top-24 among RBs by PPR points in HALF OR MORE
//                of the window's weeks. Top-24 is ranked within each week (same rule as
//                boom-rates), not against a season cutoff.
//
// Usage: SEASON=2025 node scripts/handcuff.js [--selftest]
const { weekly } = require('./boom-rates'); // require.main-guarded there, so this does not kick off a run

const SEASON = +(process.env.SEASON || 2025);
const STARTABLE_RB = 24;   // matches STARTABLE.RB in league-history.js
const FORM = 3;            // rolling window used to name the starter
const MIN_OUT = 2;         // consecutive missed weeks before it counts as an injury (bye = 1)
const MIN_CARRIES = 20;    // a starter must have actually been one
const SLEEPER_RB = 0.188;  // from --sleeper-hit-rate, for the comparison that is the point
const WEEKS = 17;          // week 18 is rest week; it would manufacture fake absences

const r1 = n => Math.round(n * 1000) / 10;

function handcuffs(games) {
  // top-24 RBs per week, ranked within the week
  const startable = new Set(); // `${week}|${name}`
  const byWeek = {};
  for (const g of games) if (g.pos === 'RB' && g.week <= WEEKS) (byWeek[g.week] ||= []).push(g);
  for (const w in byWeek)
    byWeek[w].sort((a, b) => b.pts - a.pts).slice(0, STARTABLE_RB).forEach(g => startable.add(`${w}|${g.name}`));

  // index: team -> week -> [rb rows]
  const teams = {};
  for (const w in byWeek) for (const g of byWeek[w]) ((teams[g.team] ||= {})[g.week] ||= []).push(g);

  const windows = [];
  for (const team in teams) {
    const wk = teams[team];
    let skip = 0; // don't re-open a window we're already inside
    for (let w = FORM + 1; w <= WEEKS; w++) {
      if (w < skip) continue;
      // starter = most carries over the last FORM weeks that had games
      const recent = {};
      for (let b = w - 1; b >= 1 && b >= w - FORM; b--)
        for (const g of wk[b] || []) recent[g.name] = (recent[g.name] || 0) + g.carries;
      const [starter, car] = Object.entries(recent).sort((a, b) => b[1] - a[1])[0] || [];
      if (!starter || car < MIN_CARRIES) continue;

      // how many consecutive weeks from w is he missing?
      let end = w;
      while (end <= WEEKS && !(wk[end] || []).some(g => g.name === starter)) end++;
      const out = end - w;
      if (out < MIN_OUT) continue;
      skip = end;

      // the RB who took the work in that window
      const load = {};
      for (let x = w; x < end; x++) for (const g of wk[x] || []) if (g.name !== starter) load[g.name] = (load[g.name] || 0) + g.carries;
      const [cuff] = Object.entries(load).sort((a, b) => b[1] - a[1])[0] || [];
      if (!cuff) continue;

      let good = 0;
      for (let x = w; x < end; x++) if (startable.has(`${x}|${cuff}`)) good++;
      windows.push({ team, starter, weeks: [w, end - 1], out, handcuff: cuff, startableWeeks: good, hit: good * 2 >= out });
    }
  }
  return windows.sort((a, b) => b.startableWeeks - a.startableWeeks || a.team.localeCompare(b.team));
}

async function main() {
  // One season is ~10 windows — too thin to quote a rate off. Default to three.
  const yrs = (process.env.SEASONS || `${SEASON - 2},${SEASON - 1},${SEASON}`).split(',').map(Number);
  const w = [];
  for (const yr of yrs) {
    const games = await weekly(yr);
    if (!games) { console.warn(`  no nflverse data for ${yr} — skipped`); continue; }
    handcuffs(games).forEach(x => w.push({ ...x, season: yr }));
  }
  if (!w.length) { console.error('No data for any season'); process.exit(1); }
  const hits = w.filter(x => x.hit);
  const rate = hits.length / w.length;

  console.log(`\nRB handcuff hit-rate — ${yrs.join('/')}, ${w.length} injury windows (starter out ${MIN_OUT}+ straight weeks)`);
  console.log(`  HIT = the RB who took the carries was a top-${STARTABLE_RB} RB in half or more of those weeks\n`);
  console.log(`  handcuffs hit        ${hits.length}/${w.length} = ${r1(rate)}%`);
  console.log(`  speculative RB sleeper picks hit  ${r1(SLEEPER_RB)}%   <- the alternative use of the same pick`);
  console.log(`  => handcuffs are ${(rate / SLEEPER_RB).toFixed(1)}x ${rate > SLEEPER_RB ? 'BETTER' : 'WORSE'}\n`);

  for (const yr of yrs) {
    const s = w.filter(x => x.season === yr);
    if (s.length) console.log(`  ${yr}: ${s.filter(x => x.hit).length}/${s.length} = ${r1(s.filter(x => x.hit).length / s.length)}%`);
  }
  console.log('\n  yr    team  starter -> handcuff                       weeks   startable  hit');
  for (const x of w)
    console.log(`  ${x.season}  ${x.team.padEnd(4)}  ${(x.starter + ' -> ' + x.handcuff).padEnd(40)} ${(x.weeks[0] + '-' + x.weeks[1]).padEnd(7)} ${String(x.startableWeeks + '/' + x.out).padEnd(10)} ${x.hit ? 'HIT' : '-'}`);
  console.log('');
}

function selftest() {
  const assert = require('assert');
  const g = [];
  // filler so the weekly top-24 line actually exists
  const filler = w => { for (let i = 0; i < 30; i++) g.push({ name: 'f' + i, pos: 'RB', week: w, pts: 30 - i, team: 'ZZ' + i, carries: 10 }); };
  for (let w = 1; w <= 10; w++) filler(w);
  // AAA: starter plays wks 1-4 with real volume, misses 5-6, backup scores top-24 in both
  for (let w = 1; w <= 4; w++) g.push({ name: 'star', pos: 'RB', week: w, pts: 20, team: 'AAA', carries: 18 });
  for (let w = 1; w <= 4; w++) g.push({ name: 'cuff', pos: 'RB', week: w, pts: 3, team: 'AAA', carries: 2 });
  for (const w of [5, 6]) g.push({ name: 'cuff', pos: 'RB', week: w, pts: 26, team: 'AAA', carries: 20 });
  for (let w = 7; w <= 10; w++) { g.push({ name: 'star', pos: 'RB', week: w, pts: 20, team: 'AAA', carries: 18 }); g.push({ name: 'cuff', pos: 'RB', week: w, pts: 3, team: 'AAA', carries: 2 }); }
  // BBB: identical shape but the starter misses exactly ONE week — a bye, not an injury
  for (let w = 1; w <= 10; w++) if (w !== 5) g.push({ name: 'bstar', pos: 'RB', week: w, pts: 20, team: 'BBB', carries: 18 });
  for (let w = 1; w <= 10; w++) g.push({ name: 'bcuff', pos: 'RB', week: w, pts: 26, team: 'BBB', carries: w === 5 ? 20 : 2 });

  const w = handcuffs(g);
  assert.strictEqual(w.length, 1, 'one window: the bye must not open one');
  assert.strictEqual(w[0].team, 'AAA');
  assert.strictEqual(w[0].handcuff, 'cuff');
  assert.deepStrictEqual(w[0].weeks, [5, 6]);
  assert.strictEqual(w[0].startableWeeks, 2);
  assert.ok(w[0].hit);
  // a window is opened once, not re-opened on every week of the absence
  assert.strictEqual(w.filter(x => x.team === 'AAA').length, 1);
  // half-or-more rule: 1 of 2 startable weeks still hits, 0 of 2 does not
  const dud = g.filter(x => !(x.name === 'cuff' && (x.week === 5 || x.week === 6)))
    .concat([5, 6].map(week => ({ name: 'cuff', pos: 'RB', week, pts: 1, team: 'AAA', carries: 20 })));
  assert.strictEqual(handcuffs(dud).find(x => x.team === 'AAA').hit, false, '0 startable weeks is not a hit');
  console.log('selftest: all assertions passed');
}

// league-history.js imports handcuffs() + weekly() to join these windows onto rosters.
module.exports = { handcuffs, weekly, WEEKS, STARTABLE_RB };

if (require.main === module) {
  if (process.argv.includes('--selftest')) selftest();
  else main();
}
