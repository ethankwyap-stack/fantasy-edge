// Weekly projection-calibration log. Records, per position, how well each source's rank
// order predicted actual weekly results — so after ~5 weeks it's clear which source to trust
// more per position for Start/Sit. This is the forward test of the draft board CLAUDE.md
// calls impossible to do retroactively (no analyst files exist before Aug 2026).
// CANNOT BE BACKFILLED — a week not logged here is gone for the season.
//
//   node --env-file=.env scripts/calibration-log.js [--week N]
//   node --env-file=.env scripts/calibration-log.js --selftest
//
// Sources compared, each as a RANK ORDER within a position (not raw points):
// - espnProj: ESPN's own weekly points projection — dynamic, updates every week.
// - marketADP: preseason average draft position (ownership.averageDraftPosition) — static,
//   frozen at draft day, expected to decay in usefulness as the season moves on.
// - each ranked analyst in the draft-guide*.json files (currently Holka, Smyth) — static
//   preseason posRank. Note-only guides (no posRank) cast no vote here, same as the board.
// ponytail: this is NOT index.html's blended `consensus()` — that mixes every source into
// one number in the browser. Here each source is scored SEPARATELY on purpose: the question
// is which individual source deserves weight, and a blend would hide that.
//
// Correlation is Spearman rank correlation between a source's predicted rank and the
// player's actual-points rank that week, over players who (a) have that source's rank and
// (b) played (an ESPN weekly actual entry exists). Absence from a source casts no vote.
const fs = require('fs');
const path = require('path');

const { LEAGUE_ID, ESPN_S2, SWID } = process.env;
const SEASON = +(process.env.SEASON || new Date().getFullYear());
const arg = (flag, dflt) => { const i = process.argv.indexOf(flag); return i > -1 ? +process.argv[i + 1] : dflt; };
const ROOT = path.join(__dirname, '..');
const LOG_FILE = path.join(ROOT, 'calibration-log.json');
const POS = { 1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'D/ST' };

async function espn(views, opts = {}) {
  const url = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${SEASON}/segments/0/leagues/${LEAGUE_ID}?`
    + views.map(v => `view=${v}`).join('&');
  const headers = { Cookie: `SWID=${SWID}; espn_s2=${ESPN_S2}` };
  if (opts.filter) headers['x-fantasy-filter'] = JSON.stringify(opts.filter);
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`ESPN ${res.status} (401 = cookies expired, re-grab from browser)`);
  return res.json();
}

// weekly entries carry statSplitTypeId 1 (see CLAUDE.md — 0 is the season total, a ~20x trap)
const stat = (p, wk, src) => (p?.stats || []).find(s =>
  s.seasonId === SEASON && s.statSourceId === src && s.scoringPeriodId === wk && s.statSplitTypeId === 1);

function loadGuides() {
  return fs.readdirSync(ROOT)
    .filter(f => /^draft-guide.*\.json$/.test(f))
    .map(f => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8')))
    .filter(g => g.players && Object.keys(g.players).length);
}

// pairs: [[actualRank, sourceRank], ...] both already 1..n within the position
function spearman(pairs) {
  const n = pairs.length;
  if (n < 4) return null; // too few graded players to mean anything
  const d2 = pairs.reduce((sum, [a, b]) => sum + (a - b) ** 2, 0);
  return +(1 - (6 * d2) / (n * (n * n - 1))).toFixed(3);
}

// values: [{id, v}] — lower v = better rank (caller flips sign for "higher is better" sources)
function rankOf(values) {
  const sorted = [...values].sort((a, b) => a.v - b.v);
  const out = {};
  sorted.forEach((x, i) => { out[x.id] = i + 1; });
  return out;
}

async function fetchWeekRows(wk) {
  const guides = loadGuides();
  const pool = await espn(['kona_player_info'], {
    filter: { players: { limit: 600, sortDraftRanks: { sortPriority: 1, sortAsc: true, value: 'PPR' } } },
  });
  const rows = [];
  for (const x of pool.players || []) {
    const p = x.player;
    const pos = POS[p.defaultPositionId];
    if (!pos) continue;
    const actual = stat(p, wk, 0)?.appliedTotal;
    if (actual == null) continue; // didn't play (or game not yet final) — no actual to grade against
    const proj = stat(p, wk, 1)?.appliedTotal ?? null;
    const adp = p.ownership?.averageDraftPosition ?? null;
    const key = p.fullName.toLowerCase();
    const analystRanks = {};
    for (const g of guides) {
      const e = g.players[key];
      const n = e?.posRank ? +String(e.posRank).replace(/\D/g, '') : null;
      if (n) analystRanks[g.analyst] = n;
    }
    rows.push({ id: p.id, name: p.fullName, pos, actual, proj, adp, analystRanks });
  }
  return rows;
}

// Turns one week's rows into { position: { source: {n, spearman} } }
function gradeWeek(rows) {
  const byPos = {};
  for (const r of rows) (byPos[r.pos] ||= []).push(r);

  const out = {};
  for (const [pos, players] of Object.entries(byPos)) {
    const actualRank = rankOf(players.map(p => ({ id: p.id, v: -p.actual }))); // higher actual = better
    const sources = { espnProj: p => (p.proj != null ? -p.proj : null), marketADP: p => p.adp };
    const analystNames = [...new Set(players.flatMap(p => Object.keys(p.analystRanks)))];
    for (const name of analystNames) sources[name] = p => p.analystRanks[name] ?? null;

    out[pos] = {};
    for (const [src, getV] of Object.entries(sources)) {
      const have = players.filter(p => getV(p) != null);
      if (!have.length) continue;
      const srcRank = rankOf(have.map(p => ({ id: p.id, v: getV(p) })));
      const pairs = have.map(p => [actualRank[p.id], srcRank[p.id]]);
      const rho = spearman(pairs);
      if (rho != null) out[pos][src] = { n: pairs.length, spearman: rho };
    }
  }
  return out;
}

async function main() {
  let wk = arg('--week', null);
  if (wk == null) {
    const d = await espn(['mTeam']);
    wk = d.scoringPeriodId - 1; // Tuesday morning: current period has already advanced past the finished week
  }
  if (wk < 1) return console.log(`Computed week ${wk} — nothing finished yet, skipping.`);
  console.log(`Grading week ${wk}…`);

  const rows = await fetchWeekRows(wk);
  console.log(`  ${rows.length} players with a week-${wk} actual`);
  const graded = gradeWeek(rows);
  for (const [pos, sources] of Object.entries(graded)) {
    console.log(`  ${pos}: ` + Object.entries(sources).map(([s, v]) => `${s} ρ=${v.spearman} (n=${v.n})`).join(', '));
  }

  let log = { weeks: {} };
  try { log = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8')); } catch { }
  log.weeks[wk] = graded;
  log.generated = `week ${wk}`;
  fs.writeFileSync(LOG_FILE, JSON.stringify(log, null, 2));
  console.log(`Wrote ${LOG_FILE}`);
}

function selftest() {
  const assert = require('assert');
  // hand-built week: 5 RBs, actual points descending A>B>C>D>E. espnProj agrees exactly
  // (rho should be 1). marketADP is reversed (rho should be -1). One analyst only ranked 3
  // of the 5 (n=3, too few — spearman() returns null and it must be dropped, not zeroed).
  const rows = [
    { id: 1, name: 'A', pos: 'RB', actual: 30, proj: 28, adp: 25, analystRanks: { X: 1 } },
    { id: 2, name: 'B', pos: 'RB', actual: 25, proj: 24, adp: 20, analystRanks: { X: 2 } },
    { id: 3, name: 'C', pos: 'RB', actual: 20, proj: 20, adp: 15, analystRanks: { X: 3 } },
    { id: 4, name: 'D', pos: 'RB', actual: 15, proj: 16, adp: 10, analystRanks: {} },
    { id: 5, name: 'E', pos: 'RB', actual: 10, proj: 12, adp: 5, analystRanks: {} },
  ];
  const graded = gradeWeek(rows);
  assert.strictEqual(graded.RB.espnProj.spearman, 1, 'perfect agreement must be rho 1');
  assert.strictEqual(graded.RB.marketADP.spearman, -1, 'reversed order must be rho -1');
  assert.ok(!graded.RB.X, 'a source with only 3 graded players (n<4) must be dropped, not scored');

  assert.strictEqual(spearman([[1, 1], [2, 2], [3, 3]]), null, 'n<4 returns null');
  assert.strictEqual(spearman([[1, 1], [2, 2], [3, 3], [4, 4]]), 1, 'n=4 perfect agreement');
  console.log('selftest OK (no network)');
}

if (process.argv.includes('--selftest')) selftest();
else main().catch(e => { console.error(e); process.exit(1); });
