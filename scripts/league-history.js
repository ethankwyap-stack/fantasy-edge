// League-history analysis toolkit — bench-value and draft-sleeper-hit-rate studies.
// Season is a query param, independent of .env's SEASON, so this works on any
// completed season regardless of what's currently being drafted/played.
//   node --env-file=.env scripts/league-history.js --bench-value [--season 2025]
//   node --env-file=.env scripts/league-history.js --sleeper-hit-rate [--season 2025]
//   node --env-file=.env scripts/league-history.js --bench-audit [--team 1]
//   node --env-file=.env scripts/league-history.js --schedule-luck
//   node --env-file=.env scripts/league-history.js --faab-roi
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

// ── Shared: every team's weekly roster + that week's ACTUAL points ─────────
// TRAP: `playerPoolEntry.appliedStatTotal` on a week-scoped mRoster call is the
// player's CUMULATIVE season-to-date total, NOT that week's score. It happens to
// match in Week 1, which makes the bug invisible until Week 2 (team totals came
// out ~2x too high). The week's actual score is the stats[] entry filtered on
// seasonId + statSourceId:0 + scoringPeriodId:wk — same filter rule as everywhere else.
const weekPts = (p, wk) => (p?.stats || [])
  .find(s => s.seasonId === SEASON && s.statSourceId === 0 && s.scoringPeriodId === wk)?.appliedTotal ?? 0;

async function weeklyRosters(weeks) {
  const out = {};
  for (const wk of weeks) {
    const d = await espn('mRoster', { sp: wk });
    out[wk] = Object.fromEntries(d.teams.map(t => [t.id, (t.roster?.entries || []).map(e => ({
      id: e.playerId,
      name: e.playerPoolEntry?.player?.fullName || `id${e.playerId}`,
      pos: POS[e.playerPoolEntry?.player?.defaultPositionId] || '?',
      slot: e.lineupSlotId,
      // eligibleSlots is on the player — a bench RB can't fill a WR slot, so never
      // infer slot eligibility from position.
      elig: e.playerPoolEntry?.player?.eligibleSlots || [],
      pts: weekPts(e.playerPoolEntry?.player, wk),
    }))]));
  }
  return out;
}

// Best legal lineup for one week. Greedy: fill the most-constrained slot first
// (fewest eligible players), highest scorer wins it.
// ponytail: greedy, not optimal assignment — swap in Hungarian only if a spot-check
// shows greedy losing points to a real lineup.
function bestLineup(players, slotCounts) {
  const open = [];
  for (const [slot, n] of Object.entries(slotCounts)) {
    if (+slot === 20 || +slot === 21) continue; // BENCH / IR are not startable
    for (let i = 0; i < n; i++) open.push(+slot);
  }
  const left = [...players];
  let total = 0; const picked = [];
  while (open.length) {
    open.sort((a, b) => left.filter(p => p.elig.includes(a)).length - left.filter(p => p.elig.includes(b)).length);
    const slot = open.shift();
    const cands = left.filter(p => p.elig.includes(slot)).sort((a, b) => b.pts - a.pts);
    if (!cands.length) continue;
    const best = cands[0];
    left.splice(left.indexOf(best), 1);
    total += best.pts; picked.push({ slot: SLOT[slot] || slot, ...best });
  }
  return { total: +total.toFixed(1), picked };
}

// ── Study 3: full-season points left on the bench ──────────────────────────
async function benchAudit(onlyTeam) {
  const teams = await fetchTeams();
  const settings = (await espn('mSettings')).settings;
  const slotCounts = settings.rosterSettings.lineupSlotCounts;
  const weeks = Array.from({ length: settings.scheduleSettings.matchupPeriodCount }, (_, i) => i + 1);
  const rosters = await weeklyRosters(weeks);

  const byTeam = {};
  for (const id of Object.keys(teams)) {
    if (onlyTeam && +id !== +onlyTeam) continue;
    const wks = [];
    for (const wk of weeks) {
      const players = rosters[wk]?.[id] || [];
      if (!players.length) continue;
      const started = players.filter(p => p.slot !== 20 && p.slot !== 21);
      const actual = +started.reduce((a, p) => a + p.pts, 0).toFixed(1);
      // IR players are excluded from the optimal too — they were not startable.
      const best = bestLineup(players.filter(p => p.slot !== 21), slotCounts);
      const missedBy = [...players].filter(p => p.slot === 20)
        .map(p => ({ name: p.name, pos: p.pos, pts: p.pts }))
        .sort((a, b) => b.pts - a.pts).slice(0, 3);
      wks.push({ week: wk, actual, optimal: best.total, left: +(best.total - actual).toFixed(1), topBench: missedBy });
    }
    const left = wks.reduce((a, w) => a + w.left, 0);
    byTeam[id] = {
      team: teams[id], weeks: wks,
      totalActual: +wks.reduce((a, w) => a + w.actual, 0).toFixed(1),
      totalOptimal: +wks.reduce((a, w) => a + w.optimal, 0).toFixed(1),
      totalLeft: +left.toFixed(1), avgLeftPerWeek: +(left / (wks.length || 1)).toFixed(1),
    };
  }
  return { season: SEASON, byTeam };
}

// ── Study 4: schedule luck (all-play record vs actual) ────────────────────
async function scheduleLuck() {
  const teams = await fetchTeams();
  const d = await espn('mMatchup');
  const regular = (await espn('mSettings')).settings.scheduleSettings.matchupPeriodCount;

  const scores = {}; // week -> teamId -> points
  const actual = {}; // teamId -> {w,l,t}
  for (const m of d.schedule) {
    if (m.matchupPeriodId > regular || m.playoffTierType && m.playoffTierType !== 'NONE') continue;
    const wk = m.matchupPeriodId;
    scores[wk] ||= {};
    for (const side of ['home', 'away']) {
      const s = m[side]; if (!s) continue;
      scores[wk][s.teamId] = s.totalPoints;
      actual[s.teamId] ||= { w: 0, l: 0, t: 0 };
    }
    if (!m.home || !m.away) continue;
    const [h, a] = [m.home, m.away];
    if (h.totalPoints > a.totalPoints) { actual[h.teamId].w++; actual[a.teamId].l++; }
    else if (h.totalPoints < a.totalPoints) { actual[a.teamId].w++; actual[h.teamId].l++; }
    else { actual[h.teamId].t++; actual[a.teamId].t++; }
  }

  const rows = Object.keys(actual).map(id => {
    let aw = 0, al = 0;
    for (const wk of Object.keys(scores)) {
      const mine = scores[wk][id]; if (mine == null) continue;
      for (const [oid, pts] of Object.entries(scores[wk])) {
        if (+oid === +id) continue;
        if (mine > pts) aw++; else if (mine < pts) al++;
      }
    }
    const rec = actual[id];
    const allPlayPct = aw + al ? aw / (aw + al) : 0;
    const played = rec.w + rec.l + rec.t;
    return {
      teamId: +id, team: teams[id], actual: `${rec.w}-${rec.l}${rec.t ? '-' + rec.t : ''}`,
      allPlay: `${aw}-${al}`, allPlayPct: +(100 * allPlayPct).toFixed(1),
      expectedWins: +(allPlayPct * played).toFixed(1),
      luckWins: +(rec.w - allPlayPct * played).toFixed(1),
    };
  }).sort((a, b) => b.luckWins - a.luckWins);

  return { season: SEASON, rows };
}

// ── Study 5: waiver / FAAB ROI ────────────────────────────────────────────
// Transactions are only returned per scoringPeriodId — an unscoped mTransactions2
// call returns an empty array on a completed season. Loop the weeks.
// NOTE: `bidAmount` is only meaningful if the season actually ran FAAB. 2025 was
// `WAIVERS_TRADITIONAL` with `isUsingAcquisitionBudget:false`, so every bid is a
// genuine $0 — reported as `faab:false`, not silently averaged into a fake 0 pts/$.
async function faabROI() {
  const teams = await fetchTeams();
  const settings = (await espn('mSettings')).settings;
  const faab = !!settings.acquisitionSettings?.isUsingAcquisitionBudget;
  const weeks = Array.from({ length: settings.scheduleSettings.matchupPeriodCount }, (_, i) => i + 1);
  const rosters = await weeklyRosters(weeks);

  const filter = { transactions: { filterType: { value: ['WAIVER', 'FREEAGENT'] } } };
  const adds = [];
  for (const wk of weeks) {
    const d = await espn('mTransactions2', { sp: wk, filter });
    for (const t of d.transactions || []) {
      if (t.status !== 'EXECUTED') continue; // CANCELED / failed bids cost nothing
      for (const it of t.items || []) {
        if (it.type !== 'ADD' || it.playerId <= 0) continue;
        adds.push({ week: wk, teamId: t.teamId, playerId: it.playerId, bid: t.bidAmount || 0, type: t.type });
      }
    }
  }

  // Points gained = points the player scored in weeks he was on THAT team's roster,
  // from the acquisition week onward. Rostered-but-benched still counts: the bid
  // bought the asset, and start/sit is a separate skill (that's study --bench-audit).
  const rows = adds.map(a => {
    let pts = 0, wksHeld = 0, started = 0, name = `id${a.playerId}`, pos = '?';
    for (const wk of weeks) {
      if (wk < a.week) continue;
      const p = (rosters[wk]?.[a.teamId] || []).find(p => p.id === a.playerId);
      if (!p) continue;
      name = p.name; pos = p.pos; wksHeld++; pts += p.pts;
      if (p.slot !== 20 && p.slot !== 21) started += p.pts;
    }
    return { ...a, team: teams[a.teamId], name, pos, wksHeld, pts: +pts.toFixed(1), startedPts: +started.toFixed(1), ptsPerDollar: a.bid ? +(pts / a.bid).toFixed(2) : null };
  }).sort((a, b) => b.pts - a.pts);

  const paid = rows.filter(r => r.bid > 0);
  const byTeam = {};
  for (const r of rows) {
    const t = byTeam[r.teamId] ||= { team: r.team, adds: 0, spent: 0, pts: 0, startedPts: 0 };
    t.adds++; t.spent += r.bid; t.pts += r.pts; t.startedPts += r.startedPts;
  }
  for (const t of Object.values(byTeam)) {
    t.pts = +t.pts.toFixed(1); t.startedPts = +t.startedPts.toFixed(1);
    t.ptsPerDollar = t.spent ? +(t.pts / t.spent).toFixed(2) : null;
  }

  return {
    season: SEASON, faab,
    totals: {
      adds: rows.length, paidAdds: paid.length,
      spent: paid.reduce((a, r) => a + r.bid, 0),
      pts: +rows.reduce((a, r) => a + r.pts, 0).toFixed(1),
      ptsPerDollarOnPaid: +(paid.reduce((a, r) => a + r.pts, 0) / (paid.reduce((a, r) => a + r.bid, 0) || 1)).toFixed(2),
      freeAddPts: +rows.filter(r => !r.bid).reduce((a, r) => a + r.pts, 0).toFixed(1),
    },
    byTeam: Object.values(byTeam).sort((a, b) => b.pts - a.pts),
    rows,
  };
}

(async () => {
  if (has('--selftest')) {
    console.assert(STARTABLE.RB === 24 && STARTABLE.WR === 24, 'startable cutoffs');
    console.assert(SLOT[20] === 'BENCH' && SLOT[21] === 'IR', 'bench/IR slot ids');
    // bestLineup respects eligibleSlots, not position: the 30-pt player is WR-only,
    // so he cannot take the RB slot even though he outscores everyone.
    const bl = bestLineup([
      { name: 'wr', elig: [4, 20], pts: 30 },
      { name: 'rb1', elig: [2, 20], pts: 10 },
      { name: 'rb2', elig: [2, 20], pts: 5 },
    ], { 2: 1, 4: 1, 20: 5 });
    console.assert(bl.total === 40, `eligibility respected, got ${bl.total}`);
    // BENCH/IR slots must never be filled as "startable"
    console.assert(bl.picked.length === 2, 'bench slots excluded from optimal');
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
  if (has('--bench-audit') || has('--all')) {
    const team = arg('--team', null);
    console.log(`Fetching full-season bench audit for ${SEASON}${team ? ` (team ${team})` : ''}...`);
    out.benchAudit = await benchAudit(team);
    for (const t of Object.values(out.benchAudit.byTeam).sort((a, b) => b.totalLeft - a.totalLeft))
      console.log(`  ${t.team}: left ${t.totalLeft} pts on the bench (${t.avgLeftPerWeek}/wk) — scored ${t.totalActual} of a possible ${t.totalOptimal}`);
  }
  if (has('--schedule-luck') || has('--all')) {
    console.log(`Fetching schedule luck for ${SEASON}...`);
    out.scheduleLuck = await scheduleLuck();
    for (const r of out.scheduleLuck.rows)
      console.log(`  ${r.team}: ${r.actual} actual, all-play ${r.allPlay} (${r.allPlayPct}%) → ${r.luckWins > 0 ? '+' : ''}${r.luckWins} lucky wins`);
  }
  if (has('--faab-roi') || has('--all')) {
    console.log(`Fetching FAAB ROI for ${SEASON}...`);
    out.faabROI = await faabROI();
    const t = out.faabROI.totals;
    if (!out.faabROI.faab) console.log(`  NOTE: ${SEASON} ran traditional priority waivers, not FAAB — no bid data exists. Reporting pickup value only.`);
    console.log(`  ${t.adds} pickups league-wide, ${t.pts} pts rostered${out.faabROI.faab ? `, $${t.spent} spent, ${t.ptsPerDollarOnPaid} pts/$` : ''}`);
    for (const b of out.faabROI.byTeam) console.log(`  ${b.team}: ${b.adds} pickups → ${b.pts} pts rostered, ${b.startedPts} actually started${out.faabROI.faab ? ` ($${b.spent}, ${b.ptsPerDollar} pts/$)` : ''}`);
  }
  if (!Object.keys(out).length) {
    console.log('Usage: --bench-value | --sleeper-hit-rate | --bench-audit [--team N] | --schedule-luck | --faab-roi | --all | --selftest  [--season YYYY]');
    return;
  }

  const outFile = path.join(__dirname, '..', `league-history-${SEASON}.json`);
  fs.writeFileSync(outFile, JSON.stringify({ generated: new Date().toISOString(), ...out }, null, 1));
  console.log(`Wrote ${outFile}`);
})();
