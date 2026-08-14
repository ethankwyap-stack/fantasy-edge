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
// TRAP: `statSplitTypeId` is a THIRD discriminator alongside seasonId/statSourceId/
// scoringPeriodId. A player has TWO preseason-projection entries that match on all
// three of those: statSplitTypeId 0 = season TOTAL (Ja'Marr Chase 340.0), 2 = PER GAME
// (17.8). Grabbing the wrong one is a silent ~20x error. Always pin statSplitTypeId 0.
const seasonStat = (p, src) => (p?.stats || [])
  .find(s => s.seasonId === SEASON && s.scoringPeriodId === 0 && s.statSourceId === src && s.statSplitTypeId === 0);

async function fetchPlayerTotals(ids) {
  const totals = {};
  for (let i = 0; i < ids.length; i += 200) {
    const filter = { players: { filterIds: { value: ids.slice(i, i + 200) } } };
    const d = await espn('kona_player_info', { filter });
    for (const pr of d.players || []) {
      const p = pr.player;
      totals[p.id] = {
        name: p.fullName, pos: POS[p.defaultPositionId] || p.defaultPositionId,
        pts: seasonStat(p, 0)?.appliedTotal ?? 0,
        proj: seasonStat(p, 1)?.appliedTotal ?? null, // null = ESPN never projected him (undrafted rookie etc.) — no vote, not a zero
      };
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
      // Distinguishes "played and scored 0" from "no game at all" — weekPts returns 0 for both,
      // and a D/ST can legitimately score 0 or negative, so a pts>0 filter would bias the mean up.
      played: !!(e.playerPoolEntry?.player?.stats || [])
        .find(s => s.seasonId === SEASON && s.statSourceId === 0 && s.scoringPeriodId === wk),
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

// ── Study 6: trade accuracy ───────────────────────────────────────────────
// Three traps stacked here, all silent:
//  1. A TRADE_ACCEPT carries an EMPTY `items` array. The players actually swapped live
//     on the TRADE_PROPOSAL it points at via relatedTransactionId (which stays
//     status:PENDING even once accepted — the ACCEPT is the executed record).
//  2. EVERY executed trade files TWO TRADE_ACCEPTs, one per participating team, each
//     pointing at a DIFFERENT proposal id carrying the SAME players. Counting accepts
//     double-counts every trade. Dedup on the player-set signature, not the id.
//  3. ESPN only returns proposal CONTENTS to a participant. With Ethan's cookie
//     (team 1) 28 of 28 resolvable proposals involve team 1, and widening the week
//     range 0-18 resolves zero others. So league-wide net-points is NOT obtainable;
//     trade VOLUME is (accepts are returned league-wide). Both are reported, scoped.
//  Proposals also carry `type:'DROP'` items (roster-space side effects) — only
//  `type:'TRADE'` items are the actual consideration.
async function tradeAccuracy() {
  const teams = await fetchTeams();
  const reg = (await espn('mSettings')).settings.scheduleSettings.matchupPeriodCount;
  const weeks = Array.from({ length: reg }, (_, i) => i + 1);
  const rosters = await weeklyRosters(weeks);

  const filter = { transactions: { filterType: { value: ['TRADE_ACCEPT', 'TRADE_PROPOSAL'] } } };
  const proposals = {}, accepts = [];
  // transactions are scanned past the regular season (offer/accept can land in wk 0 or
  // the playoff weeks) even though points only ever accrue in weeks 1..reg
  for (let wk = 0; wk <= reg + 4; wk++) {
    for (const t of (await espn('mTransactions2', { sp: wk, filter })).transactions || []) {
      if (t.type === 'TRADE_PROPOSAL') proposals[t.id] = t;
      else if (t.type === 'TRADE_ACCEPT') accepts.push(t);
    }
  }

  // What a player was worth to a team from the trade week onward: points scored in
  // the weeks he was actually on that team's roster. Rostered and started split out,
  // same shape as the waiver study — a trade you win on paper but bench is not a win.
  const earned = (playerId, teamId, fromWk) => {
    let pts = 0, started = 0, name = `id${playerId}`, pos = '?';
    for (const wk of weeks) {
      if (wk < fromWk) continue;
      const p = (rosters[wk]?.[teamId] || []).find(p => p.id === playerId);
      if (!p) continue;
      name = p.name; pos = p.pos; pts += p.pts;
      if (p.slot !== 20 && p.slot !== 21) started += p.pts;
    }
    return { name, pos, pts: +pts.toFixed(1), started: +started.toFixed(1) };
  };

  // volume is league-wide and complete: one accept per participant, so a team's accept
  // count IS its trade count, and the league total is half the accepts.
  const volume = {};
  for (const [id, name] of Object.entries(teams)) volume[id] = { teamId: +id, team: name, trades: 0 };
  for (const a of accepts) if (volume[a.teamId]) volume[a.teamId].trades++;

  const trades = [], seenSig = new Set();
  for (const a of accepts) {
    const items = (proposals[a.relatedTransactionId]?.items || []).filter(i => i.type === 'TRADE' && i.playerId > 0);
    if (!items.length) continue;
    // dedup: the counterparty's accept describes the identical swap under a different id
    const sig = items.map(i => `${i.playerId}:${i.fromTeamId}>${i.toTeamId}`).sort().join(',');
    if (seenSig.has(sig)) continue;
    seenSig.add(sig);
    const wk = Math.min(Math.max(a.scoringPeriodId, 1), reg); // points only accrue in the regular season
    const sides = {};
    for (const it of items) {
      for (const id of [it.fromTeamId, it.toTeamId]) if (id > 0) sides[id] ||= { teamId: id, team: teams[id], got: [], gave: [] };
      // the player's value accrues to whoever RECEIVED him; the sender's loss is that same figure
      const v = earned(it.playerId, it.toTeamId, wk);
      sides[it.toTeamId]?.got.push(v);
      sides[it.fromTeamId]?.gave.push(v);
    }
    for (const s of Object.values(sides)) {
      s.gotPts = +s.got.reduce((a, p) => a + p.pts, 0).toFixed(1);
      s.gavePts = +s.gave.reduce((a, p) => a + p.pts, 0).toFixed(1);
      s.netPts = +(s.gotPts - s.gavePts).toFixed(1);
      s.gotStarted = +s.got.reduce((a, p) => a + p.started, 0).toFixed(1);
      s.gaveStarted = +s.gave.reduce((a, p) => a + p.started, 0).toFixed(1);
      s.netStarted = +(s.gotStarted - s.gaveStarted).toFixed(1);
    }
    trades.push({ id: a.id, week: wk, sides: Object.values(sides) });
  }

  const byTeam = {};
  for (const t of trades) for (const s of t.sides) {
    const b = byTeam[s.teamId] ||= { teamId: s.teamId, team: s.team, trades: 0, won: 0, netPts: 0, netStarted: 0 };
    b.trades++; b.netPts += s.netPts; b.netStarted += s.netStarted;
    if (s.netPts > 0) b.won++;
  }
  for (const b of Object.values(byTeam)) {
    b.netPts = +b.netPts.toFixed(1); b.netStarted = +b.netStarted.toFixed(1);
    b.winRate = +(100 * b.won / b.trades).toFixed(1);
  }
  return {
    season: SEASON,
    leagueTrades: Math.round(accepts.length / 2), // 2 accepts per executed trade
    visibleTrades: trades.length,
    scopeNote: 'ESPN returns trade CONTENTS only to a participant. Net-points rows below cover only trades involving the cookie owner (team 1); `volume` is league-wide and complete.',
    volume: Object.values(volume).sort((a, b) => b.trades - a.trades),
    byTeam: Object.values(byTeam).sort((a, b) => b.netPts - a.netPts),
    trades: trades.sort((a, b) => a.week - b.week),
  };
}

// ── Study 7: draft / projection accuracy ──────────────────────────────────
// Two predictors of a player's 2025 finish, both of which have real 2025 data:
//   ESPN  — its own preseason season-total projection
//   MARKET— what this league's 12 managers actually paid (draft slot)
// Scored against actual finish as mean absolute POSITIONAL rank error. Lower wins.
// (The site's blended consensus() can't be backtested here: every draft-guide*.json
// in the repo is 2026-only, first committed Aug 2026. See handoff.)
async function draftAccuracy() {
  const teams = await fetchTeams();
  const picks = (await espn('mDraftDetail')).draftDetail.picks.filter(p => p.playerId > 0);
  const totals = await fetchPlayerTotals(picks.map(p => p.playerId));

  const rows = picks.map(p => {
    const t = totals[p.playerId] || { name: `id${p.playerId}`, pos: '?', pts: 0, proj: null };
    return { overall: p.overallPickNumber, round: p.roundId, teamId: p.teamId, team: teams[p.teamId], ...t };
  }).filter(r => STARTABLE[r.pos] && r.proj != null); // QB/RB/WR/TE, and only players ESPN actually projected

  for (const pos of Object.keys(STARTABLE)) {
    const ps = rows.filter(r => r.pos === pos);
    [...ps].sort((a, b) => b.proj - a.proj).forEach((p, i) => p.projRank = i + 1);
    [...ps].sort((a, b) => a.overall - b.overall).forEach((p, i) => p.marketRank = i + 1);
    [...ps].sort((a, b) => b.pts - a.pts).forEach((p, i) => p.actualRank = i + 1);
  }
  for (const r of rows) {
    r.projErr = Math.abs(r.projRank - r.actualRank);
    r.marketErr = Math.abs(r.marketRank - r.actualRank);
    r.overProj = +(r.pts - r.proj).toFixed(1); // points above/below what ESPN said
  }

  const mean = (arr, k) => arr.length ? +(arr.reduce((a, r) => a + r[k], 0) / arr.length).toFixed(2) : null;
  const byPos = {};
  for (const pos of Object.keys(STARTABLE)) {
    const ps = rows.filter(r => r.pos === pos);
    byPos[pos] = {
      n: ps.length, espnRankErr: mean(ps, 'projErr'), marketRankErr: mean(ps, 'marketErr'),
      winner: mean(ps, 'projErr') < mean(ps, 'marketErr') ? 'ESPN' : 'MARKET',
      espnMeanMiss: mean(ps, 'overProj'), // + = ESPN under-projected the position as a whole
    };
  }

  const byTeam = {};
  for (const r of rows) {
    const b = byTeam[r.teamId] ||= { teamId: r.teamId, team: r.team, picks: 0, actual: 0, proj: 0, errSum: 0 };
    b.picks++; b.actual += r.pts; b.proj += r.proj; b.errSum += r.marketErr;
  }
  for (const b of Object.values(byTeam)) {
    b.actual = +b.actual.toFixed(1); b.proj = +b.proj.toFixed(1);
    b.overProj = +(b.actual - b.proj).toFixed(1);
    b.avgRankErr = +(b.errSum / b.picks).toFixed(2); delete b.errSum;
  }
  // EVERY team lands below projection — ESPN projects full healthy 17-game seasons, so
  // the raw delta is dominated by a league-wide optimism bias, not by draft skill.
  // Centering on the league mean is what turns it into a comparable skill metric.
  const teamRows = Object.values(byTeam);
  const leagueAvgOverProj = +(teamRows.reduce((a, b) => a + b.overProj, 0) / teamRows.length).toFixed(1);
  for (const b of teamRows) b.vsLeagueAvg = +(b.overProj - leagueAvgOverProj).toFixed(1);

  return {
    season: SEASON, leagueAvgOverProj,
    overall: { n: rows.length, espnRankErr: mean(rows, 'projErr'), marketRankErr: mean(rows, 'marketErr') },
    byPos,
    byTeam: teamRows.sort((a, b) => b.overProj - a.overProj),
    biggestBusts: [...rows].sort((a, b) => a.overProj - b.overProj).slice(0, 15),
    biggestHits: [...rows].sort((a, b) => b.overProj - a.overProj).slice(0, 15),
    rows,
  };
}

// ── Study 10: K and D/ST week-to-week variance ─────────────────────────────
// The Start/Sit tab models each side's weekly total as Normal(Σ projections, Σ variance).
// Leaving K/D-ST out of that isn't neutral — it asserts those two roster spots have ZERO
// variance, and they are two of the swingiest slots there are. nflverse's weekly file only
// covers QB/RB/WR/TE, so boom-rates.js can't rate them; ESPN's own weekly actuals can.
//
// POSITIONAL, not per-player, and that is deliberate: kickers and defenses get streamed, so
// he will not own the same one in Week 12. A per-player rate would be precision he can't use.
// Key names follow index.html's POS map ('DST'), not this file's ('D/ST') — the browser is
// the consumer, so it owns the spelling.
const r1 = x => +x.toFixed(1);
const KDST_KEY = { K: 'K', 'D/ST': 'DST' };
async function kdstVariance() {
  const settings = (await espn('mSettings')).settings;
  const weeks = Array.from({ length: settings.scheduleSettings.matchupPeriodCount }, (_, i) => i + 1);
  const rosters = await weeklyRosters(weeks);

  const pts = { K: [], DST: [] };
  for (const wk of weeks) for (const roster of Object.values(rosters[wk]))
    for (const p of roster) { const k = KDST_KEY[p.pos]; if (k && p.played) pts[k].push(p.pts); }

  const out = {};
  for (const [pos, xs] of Object.entries(pts)) {
    if (xs.length < 20) { out[pos] = { n: xs.length, note: 'too few games played to rate' }; continue; }
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((a, x) => a + (x - mean) ** 2, 0) / (xs.length - 1)); // sample sd
    out[pos] = { n: xs.length, mean: r1(mean), sd: r1(sd), cv: +(sd / mean).toFixed(3), season: SEASON };
  }
  return { season: SEASON, byPos: out };
}
// The browser only fetches boom-rates.json, so that's where these land — one served file, no
// new route. boom-rates.js CARRIES THIS KEY FORWARD when it regenerates weekly; if you ever
// rewrite that file's writer, keep the carry-forward or the tab silently loses its K/DST
// variance and goes back to pretending those slots are certain.
function writePosVar(byPos) {
  const f = path.join(__dirname, '..', 'boom-rates.json');
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  j.posVar = byPos;
  fs.writeFileSync(f, JSON.stringify(j, null, 1));
  console.log(`  merged posVar into ${f}`);
}

// ── Study 8: who actually owned the handcuffs ──────────────────────────────
// handcuff.js finds, NFL-wide, every window where a starting RB missed 2+ straight
// weeks and names the back who took the carries. This joins those windows onto the
// league's weekly rosters: who rostered that back while it mattered, and who started him.
//
// Two different failures, kept apart on purpose:
//   MISSED   = nobody in the league rostered him that week — free on the wire.
//   BENCHED  = someone owned him and sat him. That is the Act III/IV failure again.
//
// ESPN spells names its own way (suffixes, nicknames); same normalise rule as
// boom-rates.js. An unmatched handcuff is reported, never silently dropped.
const NICK = { 'hollywood brown': 'marquise brown', 'cam skattebo': 'cameron skattebo' };
const norm = n => { const l = n.toLowerCase(); return (NICK[l] || l).replace(/\s+(jr|sr|ii|iii|iv)\.?$/, '').replace(/[^a-z ]/g, '').trim(); };

async function handcuffTeams() {
  const { handcuffs, weekly } = require('./handcuff');
  const games = await weekly(SEASON);
  if (!games) throw new Error(`No nflverse weekly data for ${SEASON}`);

  const teams = await fetchTeams();
  const settings = (await espn('mSettings')).settings;
  const lastWeek = settings.scheduleSettings.matchupPeriodCount;
  const weeks = Array.from({ length: lastWeek }, (_, i) => i + 1);
  const rosters = await weeklyRosters(weeks);

  // NFL windows can run past the fantasy regular season; those weeks have no roster
  // to judge, so they are clipped out rather than counted as a miss.
  const windows = handcuffs(games).map(w => ({ ...w, from: w.weeks[0], to: Math.min(w.weeks[1], lastWeek) }))
    .filter(w => w.from <= lastWeek);

  const byTeam = {}; for (const id of Object.keys(teams)) byTeam[id] = { team: teams[id], captured: 0, startedWeeks: 0, benchedWeeks: 0, ptsStarted: 0, ptsBenched: 0, handcuffs: [] };
  const rows = [], unmatched = [];

  for (const w of windows) {
    const target = norm(w.handcuff);
    const owners = {}; // teamId -> {started:[], benched:[]}
    let seen = false;
    for (let wk = w.from; wk <= w.to; wk++) {
      for (const id of Object.keys(teams)) {
        const p = (rosters[wk]?.[id] || []).find(x => norm(x.name) === target);
        if (!p) continue;
        seen = true;
        const o = owners[id] ||= { started: [], benched: [] };
        (p.slot !== 20 && p.slot !== 21 ? o.started : o.benched).push({ week: wk, pts: p.pts });
      }
    }
    if (!seen) { unmatched.push(w.handcuff); continue; } // never rostered all season, or a name ESPN spells differently
    for (const [id, o] of Object.entries(owners)) {
      const b = byTeam[id];
      b.captured++;
      b.startedWeeks += o.started.length; b.benchedWeeks += o.benched.length;
      b.ptsStarted += o.started.reduce((a, x) => a + x.pts, 0);
      b.ptsBenched += o.benched.reduce((a, x) => a + x.pts, 0);
      b.handcuffs.push({ handcuff: w.handcuff, for: w.starter, weeks: [w.from, w.to], started: o.started.length, benched: o.benched.length });
    }
    rows.push({
      ...w,
      owners: Object.entries(owners).map(([id, o]) => ({ team: teams[id], started: o.started.length, benched: o.benched.length })),
      freeWeeks: (w.to - w.from + 1) - new Set(Object.values(owners).flatMap(o => [...o.started, ...o.benched].map(x => x.week))).size,
    });
  }

  for (const b of Object.values(byTeam)) {
    b.ptsStarted = +b.ptsStarted.toFixed(1); b.ptsBenched = +b.ptsBenched.toFixed(1);
    // Of the handcuff weeks you owned, how many did you actually start? Null, not 0,
    // when you owned none — a manager who never had the chance did not fail at it.
    const owned = b.startedWeeks + b.benchedWeeks;
    b.startRate = owned ? +(b.startedWeeks / owned * 100).toFixed(1) : null;
  }

  return {
    season: SEASON, windows: windows.length, matchedWindows: rows.length, unmatched,
    note: `NFL windows clipped to fantasy weeks 1-${lastWeek}. "captured" = windows where you rostered the handcuff at least one week.`,
    byTeam: Object.values(byTeam).sort((a, b) => b.ptsStarted - a.ptsStarted || b.captured - a.captured),
    rows,
  };
}

// ── Study 11: FAAB ceiling — startable-week rate of waiver adds, by position ──
// 2026 is this league's FIRST year running real FAAB ($1000/$1 min — see faabROI); he'll be
// bidding blind. Can't score BID SIZE against outcome (2025 had none — no bid data exists,
// see faabROI's own note), but it gives the base rate that should set his ceilings: of
// players actually added off waivers in this league, what share of the weeks they were held
// afterward were "startable" — his NFL-wide weekly PPR points that week fell inside the
// position's startable cutoff (STARTABLE: QB12/RB24/WR24/TE12) among EVERY player at that
// position in the NFL that week, not just this 12-team league. High rate = bid aggressively;
// low rate = spread FAAB thin, most pickups are replacement-level. K/D-ST excluded —
// nflverse's weekly file carries no rows for them (same limit as study 10).
async function faabCeilings() {
  const { weekly } = require('./boom-rates'); // require.main-guarded there — this does not kick off a run
  const games = await weekly(SEASON);
  if (!games) throw new Error(`No nflverse weekly data for ${SEASON}`);

  const byWeekPos = {};
  for (const g of games) (byWeekPos[`${g.week}|${g.pos}`] ||= []).push(g.pts);
  const cutoff = {};
  for (const [k, pts] of Object.entries(byWeekPos)) {
    const pos = k.split('|')[1];
    const n = STARTABLE[pos]; if (!n) continue;
    cutoff[k] = [...pts].sort((a, b) => b - a)[Math.min(n, pts.length) - 1];
  }
  const byNormName = {};
  for (const g of games) (byNormName[norm(g.name)] ||= {})[g.week] = g;

  const teams = await fetchTeams();
  const settings = (await espn('mSettings')).settings;
  const lastWeek = settings.scheduleSettings.matchupPeriodCount;
  const weeks = Array.from({ length: lastWeek }, (_, i) => i + 1);
  const rosters = await weeklyRosters(weeks);

  const filter = { transactions: { filterType: { value: ['WAIVER', 'FREEAGENT'] } } };
  const adds = [];
  for (const wk of weeks) {
    const d = await espn('mTransactions2', { sp: wk, filter });
    for (const t of d.transactions || []) {
      if (t.status !== 'EXECUTED') continue;
      for (const it of t.items || []) {
        if (it.type !== 'ADD' || it.playerId <= 0) continue;
        adds.push({ week: wk, teamId: t.teamId, playerId: it.playerId });
      }
    }
  }

  const rows = [];
  for (const a of adds) {
    let name = null, pos = null;
    for (let wk = a.week; wk <= lastWeek && !name; wk++) {
      const p = (rosters[wk]?.[a.teamId] || []).find(p => p.id === a.playerId);
      if (p) { name = p.name; pos = p.pos; }
    }
    if (!name || !STARTABLE[pos]) continue; // K/D-ST, or dropped before ever appearing on a roster snapshot
    const g = byNormName[norm(name)];
    if (!g) continue; // no nflverse match this season (rookie name variant etc.) — absence casts no vote

    let heldWeeks = 0, startableWeeks = 0;
    for (let wk = a.week; wk <= lastWeek; wk++) {
      const wg = g[wk];
      if (!wg) continue; // bye or didn't play that week
      heldWeeks++;
      if (wg.pts >= (cutoff[`${wk}|${pos}`] ?? Infinity)) startableWeeks++;
    }
    if (heldWeeks) rows.push({ week: a.week, teamId: a.teamId, team: teams[a.teamId], name, pos, heldWeeks, startableWeeks, rate: +(100 * startableWeeks / heldWeeks).toFixed(1) });
  }

  const byPos = {};
  for (const pos of Object.keys(STARTABLE)) {
    const ps = rows.filter(r => r.pos === pos);
    const held = ps.reduce((a, r) => a + r.heldWeeks, 0);
    const startable = ps.reduce((a, r) => a + r.startableWeeks, 0);
    byPos[pos] = { adds: ps.length, weeksHeld: held, startableWeeks: startable, startableRate: held ? +(100 * startable / held).toFixed(1) : null };
  }

  return {
    season: SEASON,
    note: 'startable = NFL-wide weekly rank inside QB12/RB24/WR24/TE12 that week, not just this league. No 2025 bid data exists (traditional waivers) so this is a base rate, not a bid-vs-outcome curve.',
    byPos, rows: rows.sort((a, b) => b.rate - a.rate),
  };
}

// ---- study 12: playoff-weeks (15-17) strength of schedule -----------------
// Which NFL teams draw the toughest/easiest run of opposing defenses across the
// FANTASY playoff weeks (15-17) — a trade/stash signal for October, not a start/sit
// one (by December this is moot, the games have been played). Defense-allowed rates
// come from the most recently COMPLETED season (SEASON, the study's usual meaning);
// the schedule itself is read for the NEXT season, SEASON+1, since that's the one whose
// weeks 15-17 haven't happened yet. Run e.g. `--season 2025 --playoff-sos` to get the
// 2026 playoff-week schedule graded against 2025 defensive performance.
const PLAYOFF_WEEKS = [15, 16, 17];
// ESPN vs nflverse spell two teams differently; every other abbrev matches as-is.
const NFLVERSE_ABBR = { LAR: 'LA', WSH: 'WAS' };

async function playoffSoS() {
  const { weekly } = require('./boom-rates'); // require.main-guarded there — this does not kick off a run
  const defenseYear = SEASON, scheduleYear = SEASON + 1;
  const games = await weekly(defenseYear);
  if (!games) throw new Error(`No nflverse weekly data for ${defenseYear} (needed as the defense-allowed baseline)`);

  // rank 1 = stingiest defense (fewest PPR pts/game allowed at that position), 32 = most generous
  const allowed = {};
  for (const g of games) {
    if (!g.opponent_team) continue;
    const t = allowed[g.opponent_team] ||= {};
    const p = t[g.pos] ||= { pts: 0, wks: new Set() };
    p.pts += g.pts; p.wks.add(g.week);
  }
  const ranks = {};
  for (const pos of ['QB', 'RB', 'WR', 'TE']) {
    Object.entries(allowed)
      .filter(([, byPos]) => byPos[pos]?.wks.size)
      .map(([team, byPos]) => ({ team, avg: byPos[pos].pts / byPos[pos].wks.size }))
      .sort((a, b) => a.avg - b.avg)
      .forEach((r, i) => { (ranks[r.team] ||= {})[pos] = { rank: i + 1, avg: r1(r.avg) }; });
  }

  const schedData = await (await fetch(`https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${scheduleYear}?view=proTeamSchedules_wl`)).json();
  const proTeams = (schedData.settings?.proTeams || []).filter(t => t.abbrev && t.abbrev !== 'FA');
  const proMap = {}; proTeams.forEach(t => proMap[t.id] = t);
  const nflverseAbbr = a => NFLVERSE_ABBR[a] || a;

  const rows = [];
  for (const t of proTeams) {
    const opponents = PLAYOFF_WEEKS.map(wk => {
      const g = (t.proGamesByScoringPeriod?.[wk] || [])[0];
      if (!g) return null; // bye
      const oppId = g.homeProTeamId === t.id ? g.awayProTeamId : g.homeProTeamId;
      return nflverseAbbr(proMap[oppId]?.abbrev);
    });
    const byPos = {};
    for (const pos of ['QB', 'RB', 'WR', 'TE']) {
      const oppRanks = opponents.filter(Boolean).map(a => ranks[a]?.[pos]?.rank).filter(r => r != null);
      byPos[pos] = oppRanks.length ? r1(oppRanks.reduce((a, b) => a + b, 0) / oppRanks.length) : null;
    }
    rows.push({ team: nflverseAbbr(t.abbrev), opponents, byes: opponents.filter(o => o === null).length, avgOppDefRank: byPos });
  }

  return { defenseYear, scheduleYear, weeks: PLAYOFF_WEEKS, rows: rows.sort((a, b) => a.team.localeCompare(b.team)) };
}

// Guarded so lineup-alert.js can import bestLineup() without kicking off a full study run
// (same rule as boom-rates.js). Do NOT import this file without the guard in place.
if (require.main === module) (async () => {
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
    // seasonStat must pin statSplitTypeId 0 — the per-game (2) entry matches on every
    // other filter and is ~20x smaller. Picking it would silently gut every projection.
    const fake = { stats: [
      { seasonId: SEASON, scoringPeriodId: 0, statSourceId: 1, statSplitTypeId: 2, appliedTotal: 17.8 },
      { seasonId: SEASON, scoringPeriodId: 0, statSourceId: 1, statSplitTypeId: 0, appliedTotal: 340.0 },
      { seasonId: SEASON - 1, scoringPeriodId: 0, statSourceId: 1, statSplitTypeId: 0, appliedTotal: 999 },
    ] };
    console.assert(seasonStat(fake, 1).appliedTotal === 340.0, `season-total projection, got ${seasonStat(fake, 1)?.appliedTotal}`);
    // handcuff name matching: ESPN keeps suffixes nflverse drops, and vice versa.
    console.assert(norm('Tyrone Tracy Jr.') === norm('tyrone tracy'), 'suffix stripped both ways');
    console.assert(norm('Cam Skattebo') === norm('cameron skattebo'), 'nickname aliased');
    // playoff-SoS abbrev fix: ESPN's LAR/WSH must resolve to nflverse's LA/WAS, everyone else passes through
    console.assert(NFLVERSE_ABBR.LAR === 'LA' && NFLVERSE_ABBR.WSH === 'WAS' && !NFLVERSE_ABBR.KC, 'nflverse abbrev fix');
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
  if (has('--trade-accuracy') || has('--all')) {
    console.log(`Fetching trade accuracy for ${SEASON}...`);
    out.tradeAccuracy = await tradeAccuracy();
    console.log(`  ${out.tradeAccuracy.leagueTrades} executed trades league-wide; ${out.tradeAccuracy.visibleTrades} have visible contents (participant-only)`);
    console.log('  -- trade VOLUME (league-wide, complete) --');
    for (const v of out.tradeAccuracy.volume) console.log(`  ${v.team}: ${v.trades} trades`);
    console.log('  -- net points (only trades involving team 1) --');
    for (const b of out.tradeAccuracy.byTeam)
      console.log(`  ${b.team}: ${b.trades} trades, net ${b.netPts > 0 ? '+' : ''}${b.netPts} pts rostered / ${b.netStarted > 0 ? '+' : ''}${b.netStarted} started${b.trades ? ` (${b.won}/${b.trades} won)` : ''}`);
  }
  if (has('--draft-accuracy') || has('--all')) {
    console.log(`Fetching draft/projection accuracy for ${SEASON}...`);
    out.draftAccuracy = await draftAccuracy();
    const o = out.draftAccuracy.overall;
    console.log(`  mean positional rank error over ${o.n} picks — ESPN ${o.espnRankErr} vs market ${o.marketRankErr} → ${o.espnRankErr < o.marketRankErr ? 'ESPN' : 'THE ROOM'} was the better predictor`);
    for (const [pos, s] of Object.entries(out.draftAccuracy.byPos))
      console.log(`    ${pos} (n=${s.n}): ESPN ${s.espnRankErr}, market ${s.marketRankErr} → ${s.winner}`);
    console.log(`  every team lands under projection (league avg ${out.draftAccuracy.leagueAvgOverProj}) — ESPN projects healthy 17-game seasons, so rank on the centered column:`);
    for (const b of out.draftAccuracy.byTeam)
      console.log(`  ${b.team}: ${b.actual} actual vs ${b.proj} projected = ${b.overProj} (${b.vsLeagueAvg > 0 ? '+' : ''}${b.vsLeagueAvg} vs league avg, ${b.picks} picks)`);
  }
  if (has('--kdst-variance') || has('--all')) {
    console.log(`Measuring K / D-ST week-to-week variance for ${SEASON}...`);
    out.kdstVariance = await kdstVariance();
    for (const [pos, v] of Object.entries(out.kdstVariance.byPos))
      console.log(`  ${pos}: ${v.note || `mean ${v.mean}, sd ${v.sd} → cv ${v.cv} over ${v.n} games played`}`);
    writePosVar(out.kdstVariance.byPos);
  }
  if (has('--handcuff-teams') || has('--all')) {
    console.log(`Joining NFL handcuff windows onto ${SEASON} rosters...`);
    out.handcuffTeams = await handcuffTeams();
    console.log(`  ${out.handcuffTeams.matchedWindows}/${out.handcuffTeams.windows} windows had the handcuff rostered by someone in this league`);
    if (out.handcuffTeams.unmatched.length) console.log(`  never rostered here (or ESPN spells them differently): ${out.handcuffTeams.unmatched.join(', ')}`);
    for (const b of out.handcuffTeams.byTeam)
      console.log(`  ${b.team}: ${b.captured} handcuffs owned, started ${b.startedWeeks} wks / benched ${b.benchedWeeks} — ${b.ptsStarted} pts started, ${b.ptsBenched} left on the bench${b.startRate === null ? '' : ` (${b.startRate}% start rate)`}`);
    for (const r of out.handcuffTeams.rows)
      console.log(`    wk${r.from}-${r.to} ${r.starter} out → ${r.handcuff}: ${r.owners.map(o => `${o.team} (${o.started} st/${o.benched} bn)`).join(', ') || 'nobody'}${r.freeWeeks ? `, free on the wire ${r.freeWeeks} wk` : ''}`);
  }
  if (has('--faab-ceilings') || has('--all')) {
    console.log(`Computing FAAB ceilings (startable-week rate of waiver adds) for ${SEASON}...`);
    out.faabCeilings = await faabCeilings();
    for (const [pos, s] of Object.entries(out.faabCeilings.byPos))
      console.log(`  ${pos}: ${s.adds} adds, ${s.startableWeeks}/${s.weeksHeld} weeks held were startable${s.startableRate === null ? '' : ` (${s.startableRate}%)`}`);
  }
  if (has('--playoff-sos') || has('--all')) {
    console.log(`Fetching playoff-weeks (15-17) strength of schedule for ${SEASON + 1} (graded on ${SEASON} defense)...`);
    out.playoffSoS = await playoffSoS();
    console.log('  avg opposing-defense rank across weeks 15-17 (1 = toughest, 32 = easiest):');
    for (const r of out.playoffSoS.rows)
      console.log(`  ${r.team}: QB ${r.avgOppDefRank.QB ?? '—'}, RB ${r.avgOppDefRank.RB ?? '—'}, WR ${r.avgOppDefRank.WR ?? '—'}, TE ${r.avgOppDefRank.TE ?? '—'}${r.byes ? ` (${r.byes} bye)` : ''}`);
    // Own top-level file, not merged into league-history-<season>.json — the site's
    // server.js reads a literal path (Vercel tracing), same reason boom-rates.json
    // and video-notes.json each get their own file instead of nesting under one blob.
    const sosFile = path.join(__dirname, '..', 'playoff-sos.json');
    fs.writeFileSync(sosFile, JSON.stringify(out.playoffSoS, null, 1));
    console.log(`  wrote ${sosFile}`);
  }
  if (!Object.keys(out).length) {
    console.log('Usage: --bench-value | --sleeper-hit-rate | --bench-audit [--team N] | --schedule-luck | --faab-roi | --trade-accuracy | --draft-accuracy | --handcuff-teams | --kdst-variance | --faab-ceilings | --playoff-sos | --all | --selftest  [--season YYYY]');
    return;
  }

  const outFile = path.join(__dirname, '..', `league-history-${SEASON}.json`);
  // MERGE, don't overwrite: running one study used to blow away the other seven,
  // silently, leaving a file that looks complete because it is still valid JSON.
  let prev = {}; try { prev = JSON.parse(fs.readFileSync(outFile, 'utf8')); } catch { }
  fs.writeFileSync(outFile, JSON.stringify({ ...prev, generated: new Date().toISOString(), ...out }, null, 1));
  console.log(`Wrote ${outFile}`);
})();

module.exports = { bestLineup, SLOT, STARTABLE };
