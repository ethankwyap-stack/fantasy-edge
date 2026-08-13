// League-history analysis toolkit — bench-value and draft-sleeper-hit-rate studies.
// Season is a query param, independent of .env's SEASON, so this works on any
// completed season regardless of what's currently being drafted/played.
//   node --env-file=.env scripts/league-history.js --bench-value [--season 2025]
//   node --env-file=.env scripts/league-history.js --sleeper-hit-rate [--season 2025]
//   node --env-file=.env scripts/league-history.js --all [--season 2025]   (writes league-history-<season>.json)
//
// Findings from the 2025 run (see league-history-2025.json / HANDOFF.md for detail):
// - Week-1 bench-value: starters averaged 195.0 season-end pts vs 114.8 for bench
//   (RB/WR/TE only — QB/K/D-ST excluded, see note below). Benching mostly worked.
// - Sleeper hit-rate: RB 18.8%, WR 20.9% of players drafted outside the startable
//   range at their position (QB13+/RB25+/WR25+/TE13+) finished back inside it.
//   QB (50%) and TE (71.4%) are inflated by shallow position pools — small
//   denominator, one injury "promotes" a backup almost by default. Treat those
//   two numbers as noise, not signal.
const fs = require('fs');
const path = require('path');

const { LEAGUE_ID, ESPN_S2, SWID } = process.env;
const arg = (flag, dflt) => { const i = process.argv.indexOf(flag); return i > -1 ? process.argv[i + 1] : dflt; };
const has = flag => process.argv.includes(flag);
const SEASON = +arg('--season', 2025);

const POS = { 1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'D/ST' };
// lineupSlotId numbering is separate from defaultPositionId (POS above) — don't conflate them.
const SLOT = { 0: 'QB', 2: 'RB', 4: 'WR', 6: 'TE', 23: 'FLEX', 16: 'D/ST', 17: 'K', 20: 'BENCH', 21: 'IR' };
// startable range per position for a 12-team league — used by both studies to
// decide what counts as "should be starting" vs "bench/upside" at that position.
const STARTABLE = { QB: 12, RB: 24, WR: 24, TE: 12 };

// views MUST go out as repeated &view= params — the comma-joined form silently omits `settings` (see CLAUDE.md)
async function espn(view, opts = {}) {
  let url = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${SEASON}/segments/0/leagues/${LEAGUE_ID}?view=${view}`;
  if (opts.sp) url += `&scoringPeriodId=${opts.sp}`;
  const headers = { Cookie: `SWID=${SWID}; espn_s2=${ESPN_S2}` };
  if (opts.filter) headers['x-fantasy-filter'] = JSON.stringify(opts.filter);
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`ESPN ${res.status} on ${view} (401 = cookies expired, re-grab from browser)`);
  return res.json();
}

async function fetchTeams() {
  const d = await espn('mTeam');
  return Object.fromEntries(d.teams.map(t => [t.id, t.name || `${t.location} ${t.nickname}`]));
}

// Any-player-by-id lookup, independent of current roster — needed for players
// dropped/traded away mid-season who wouldn't appear in a "current roster" query.
async function fetchPlayerTotals(ids) {
  const totals = {};
  for (let i = 0; i < ids.length; i += 200) {
    const filter = { players: { filterIds: { value: ids.slice(i, i + 200) } } };
    const d = await espn('kona_player_info', { filter });
    for (const pr of d.players || []) {
      const p = pr.player;
      const s = (p.stats || []).find(s => s.seasonId === SEASON && s.scoringPeriodId === 0 && s.statSourceId === 0);
      totals[p.id] = { name: p.fullName, pos: POS[p.defaultPositionId] || p.defaultPositionId, pts: s ? s.appliedTotal : 0 };
    }
  }
  return totals;
}

// ── Study 1: Week-1 bench vs starter value ─────────────────────────────────
async function benchValue() {
  const teams = await fetchTeams();
  const wk1 = await espn('mRoster', { sp: 1 }); // scoringPeriodId returns THAT week's historical lineup, not current
  const allIds = [...new Set(wk1.teams.flatMap(t => t.roster.entries.map(e => e.playerId)))].filter(id => id > 0);
  const totals = await fetchPlayerTotals(allIds);

  const rows = [];
  for (const t of wk1.teams) {
    for (const e of t.roster.entries) {
      const info = totals[e.playerId] || { name: `id${e.playerId}`, pos: '?', pts: 0 };
      rows.push({ team: teams[t.id], teamId: t.id, slot: SLOT[e.lineupSlotId] || e.lineupSlotId, isBench: e.lineupSlotId === 20 || e.lineupSlotId === 21, ...info });
    }
  }

  // allowlist, not denylist: D/ST players (negative playerId) never get fetched by
  // fetchPlayerTotals, so they fall back to pos:'?' — a denylist on 'D/ST' misses that
  // and lets 12 zero-point ghost "starters" drag the average down.
  const skill = rows.filter(r => ['RB', 'WR', 'TE'].includes(r.pos));
  const starters = skill.filter(r => !r.isBench), bench = skill.filter(r => r.isBench);
  const avg = arr => arr.reduce((a, b) => a + b.pts, 0) / (arr.length || 1);

  return {
    season: SEASON,
    starterAvg: +avg(starters).toFixed(1), starterN: starters.length,
    benchAvg: +avg(bench).toFixed(1), benchN: bench.length,
    rows,
  };
}

// ── Study 2: draft-round sleeper hit rate ──────────────────────────────────
async function sleeperHitRate() {
  const teams = await fetchTeams();
  const draft = await espn('mDraftDetail');
  const picks = draft.draftDetail.picks.filter(p => p.playerId > 0); // negative ids are D/ST, excluded
  const totals = await fetchPlayerTotals(picks.map(p => p.playerId));

  const rows = picks.map(p => {
    const t = totals[p.playerId] || { name: `id${p.playerId}`, pos: '?', pts: 0 };
    return { overall: p.overallPickNumber, round: p.roundId, team: teams[p.teamId], name: t.name, pos: t.pos, pts: t.pts };
  }).filter(r => STARTABLE[r.pos]); // QB/RB/WR/TE only

  for (const pos of Object.keys(STARTABLE)) {
    const players = rows.filter(r => r.pos === pos);
    [...players].sort((a, b) => a.overall - b.overall).forEach((p, i) => p.draftPosRank = i + 1);
    [...players].sort((a, b) => b.pts - a.pts).forEach((p, i) => p.finishPosRank = i + 1);
  }

  const byPos = {};
  for (const pos of Object.keys(STARTABLE)) {
    const bench = rows.filter(r => r.pos === pos && r.draftPosRank > STARTABLE[pos]);
    const panned = bench.filter(r => r.finishPosRank <= STARTABLE[pos]);
    byPos[pos] = { attempts: bench.length, hits: panned.length, hitRate: bench.length ? +(100 * panned.length / bench.length).toFixed(1) : null };
  }

  const panned = rows.filter(r => r.draftPosRank > STARTABLE[r.pos] && r.finishPosRank <= STARTABLE[r.pos])
    .sort((a, b) => a.finishPosRank - b.finishPosRank);

  return { season: SEASON, byPos, panned, rows };
}

(async () => {
  if (has('--selftest')) {
    console.assert(STARTABLE.RB === 24 && STARTABLE.WR === 24, 'startable cutoffs');
    console.assert(SLOT[20] === 'BENCH' && SLOT[21] === 'IR', 'bench/IR slot ids');
    console.log('selftest OK (no network)');
    return;
  }

  const out = {};
  if (has('--bench-value') || has('--all')) {
    console.log(`Fetching Week-1 bench-vs-starter value for ${SEASON}...`);
    out.benchValue = await benchValue();
    console.log(`  starters avg ${out.benchValue.starterAvg} (n=${out.benchValue.starterN}) vs bench avg ${out.benchValue.benchAvg} (n=${out.benchValue.benchN})`);
  }
  if (has('--sleeper-hit-rate') || has('--all')) {
    console.log(`Fetching draft-round sleeper hit-rate for ${SEASON}...`);
    out.sleeperHitRate = await sleeperHitRate();
    for (const [pos, s] of Object.entries(out.sleeperHitRate.byPos)) console.log(`  ${pos}: ${s.hits}/${s.attempts} (${s.hitRate}%)`);
  }
  if (!Object.keys(out).length) {
    console.log('Usage: --bench-value | --sleeper-hit-rate | --all | --selftest  [--season YYYY]');
    return;
  }

  const outFile = path.join(__dirname, '..', `league-history-${SEASON}.json`);
  fs.writeFileSync(outFile, JSON.stringify({ generated: new Date().toISOString(), ...out }, null, 1));
  console.log(`Wrote ${outFile}`);
})();
