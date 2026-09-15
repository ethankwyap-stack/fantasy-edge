#!/usr/bin/env node
// Weekly usage report — Smyth-style ROLE data for every rostered QB/RB/WR/TE in the league plus
// the best free agents: snap share, target share, air-yards share, aDOT, WOPR, carry share,
// red-zone / goal-line touches, FTN charting on his targets, and a role-vs-production flag.
// All free nflverse release files, no key. Season-to-date, so it sharpens every Tuesday.
//
//   node --env-file=.env scripts/usage-report.js     -> usage-report.json
//   node scripts/usage-report.js --selftest          (no network)
//
// Never cache-read: every file here is the IN-PROGRESS season and is rewritten weekly (same trap
// as .nflverse-cache in boom-rates.js — a cache hit silently serves Week 1 in Week 8).
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { csvSplit } = require('./boom-rates.js');

const SEASON = +(process.env.SEASON || new Date().getFullYear());
const OUT = path.join(__dirname, '..', 'usage-report.json');
const REL = 'https://github.com/nflverse/nflverse-data/releases/download';
const POS = ['QB', 'RB', 'WR', 'TE'];
const FA_PER_POS = { QB: 6, RB: 15, WR: 15, TE: 8 };
// Role-vs-production: flag when a player's role rank and points rank sit this far apart, inside
// the startable-ish pool. ponytail: fixed rank gap, not a fitted expected-points model — upgrade
// to xPPR (regress points on opportunity) once there are enough weeks to fit it without noise.
const POOL = { RB: 36, WR: 48, TE: 18 };
const GAP = { RB: 12, WR: 12, TE: 6 };

const norm = s => String(s || '').toLowerCase().replace(/\s+(jr|sr|ii|iii|iv|v)\.?$/, '').replace(/[^a-z]/g, '');
const num = v => (v === '' || v == null || v === 'NA' ? null : +v);
const r1 = v => (v == null || !isFinite(v) ? null : Math.round(v * 10) / 10);
const pct = (a, b) => (b ? r1((100 * a) / b) : null);

function rows(text) {
  const lines = text.split('\n').filter(Boolean);
  const head = csvSplit(lines[0]);
  return lines.slice(1).map(l => { const c = csvSplit(l), o = {}; head.forEach((h, i) => { o[h] = c[i]; }); return o; });
}

async function get(tag, file) {
  const r = await fetch(`${REL}/${tag}/${file}`, { signal: AbortSignal.timeout(180000) });
  if (!r.ok) throw new Error(`${file}: HTTP ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  return rows(file.endsWith('.gz') ? zlib.gunzipSync(buf).toString('utf8') : buf.toString('utf8'));
}

// Pure: season-to-date usage per player id. Inputs are parsed CSV rows.
function build({ stats, snaps, pbp, ftn }) {
  const reg = r => (r.season_type || r.game_type || 'REG') === 'REG';
  const P = {}, team = {};
  for (const s of stats.filter(reg)) {
    if (!POS.includes(s.position)) continue;
    const t = s.recent_team; // ponytail: a mid-season trade credits the whole season to the new team
    const T = (team[t] ||= { carries: 0, targets: 0 });
    T.carries += num(s.carries) || 0; T.targets += num(s.targets) || 0;
    P[s.player_id] = {
      id: s.player_id, name: s.player_display_name, pos: s.position, team: t, games: num(s.games) || 0,
      ppg: null, pts: num(s.fantasy_points_ppr) || 0,
      targets: num(s.targets) || 0, carries: num(s.carries) || 0, airYards: num(s.receiving_air_yards) || 0,
      tgtShare: r1(100 * (num(s.target_share) || 0)), airShare: r1(100 * (num(s.air_yards_share) || 0)),
      wopr: num(s.wopr) == null ? null : +(+s.wopr).toFixed(3),
      epa: r1((num(s.passing_epa) || 0) + (num(s.rushing_epa) || 0)), cpoe: r1(num(s.passing_cpoe)),
      snapPct: null, rzTgt: 0, rzCar: 0, glCar: 0, ftn: { tgt: 0, pa: 0, screen: 0, motion: 0, catchable: 0, contested: 0, drops: 0 },
    };
  }
  for (const p of Object.values(P)) {
    p.ppg = p.games ? r1(p.pts / p.games) : null;
    // aDOT: a player with no targets has no depth, not a depth of 0
    p.adot = p.targets ? r1(p.airYards / p.targets) : null;
    p.carryShare = pct(p.carries, team[p.team]?.carries);
  }

  // Snap share: mean offense_pct over the weeks he appears. No snap row = null (never 0 — unmatched
  // name is absence, not a measured bench role).
  const byNameTeam = {};
  for (const p of Object.values(P)) byNameTeam[norm(p.name) + '|' + p.team] = p;
  const snapAcc = {};
  for (const s of snaps.filter(reg)) {
    const p = byNameTeam[norm(s.player) + '|' + s.team];
    if (!p) continue;
    (snapAcc[p.id] ||= []).push(num(s.offense_pct) || 0);
  }
  for (const [id, a] of Object.entries(snapAcc)) P[id].snapPct = r1((100 * a.reduce((x, y) => x + y, 0)) / a.length);

  // Red zone (inside the 20) and goal line (inside the 5), from play-by-play.
  const ftnBy = {};
  for (const f of ftn) ftnBy[f.nflverse_game_id + '|' + f.nflverse_play_id] = f;
  const yes = v => v === 'TRUE' || v === '1' || v === 'true';
  for (const pl of pbp.filter(reg)) {
    const yl = num(pl.yardline_100);
    const rec = P[pl.receiver_player_id], rush = P[pl.rusher_player_id];
    if (rec && yes(pl.pass_attempt) && !yes(pl.sack)) {
      if (yl != null && yl <= 20) rec.rzTgt++;
      const f = ftnBy[pl.game_id + '|' + pl.play_id];
      if (f) {
        const F = rec.ftn; F.tgt++;
        F.pa += yes(f.is_play_action); F.screen += yes(f.is_screen_pass); F.motion += yes(f.is_motion);
        F.catchable += yes(f.is_catchable_ball); F.contested += yes(f.is_contested_ball); F.drops += yes(f.is_drop);
      }
    }
    if (rush && yes(pl.rush_attempt)) {
      if (yl != null && yl <= 20) rush.rzCar++;
      if (yl != null && yl <= 5) rush.glCar++;
    }
  }
  for (const p of Object.values(P)) {
    const F = p.ftn;
    p.ftn = F.tgt ? { charted: F.tgt, playAction: pct(F.pa, F.tgt), screen: pct(F.screen, F.tgt), motion: pct(F.motion, F.tgt),
      catchable: pct(F.catchable, F.tgt), contested: pct(F.contested, F.tgt), drops: F.drops } : null;
  }
  flagRoles(Object.values(P));
  return Object.values(P);
}

// Role score: WR/TE = WOPR; RB = weighted opportunities per game (a target is worth ~2 carries in
// PPR). QB gets no flag — his role is "starts", which snap share already shows.
const roleOf = p => (p.pos === 'RB' ? (p.games ? (p.carries + 2 * p.targets) / p.games : 0) : p.wopr || 0);
function flagRoles(players) {
  for (const pos of Object.keys(POOL)) {
    const at = players.filter(p => p.pos === pos && p.games > 0);
    const rank = key => { const o = {}; [...at].sort((a, b) => key(b) - key(a)).forEach((p, i) => { o[p.id] = i + 1; }); return o; };
    const roleR = rank(roleOf), ptsR = rank(p => p.ppg || 0);
    for (const p of at) {
      p.roleRank = roleR[p.id]; p.ptsRank = ptsR[p.id];
      const gap = p.ptsRank - p.roleRank;
      p.flag = p.roleRank <= POOL[pos] && gap >= GAP[pos] ? 'buy-low'
        : p.ptsRank <= POOL[pos] && -gap >= GAP[pos] ? 'sell-high' : null;
    }
  }
}

async function espnRosters() {
  const { LEAGUE_ID, ESPN_S2, SWID } = process.env;
  if (!LEAGUE_ID) throw new Error('LEAGUE_ID missing — run with --env-file=.env');
  const r = await fetch(`https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${SEASON}/segments/0/leagues/${LEAGUE_ID}?view=mTeam&view=mRoster`,
    { headers: { Cookie: `SWID=${SWID}; espn_s2=${ESPN_S2}` } });
  if (!r.ok) throw new Error(`ESPN ${r.status} — cookies may have expired`);
  return r.json();
}

// Pure: keep every rostered player + the top free agents per position by role.
function attach(players, lg) {
  const owner = {};
  for (const t of lg.teams) for (const e of t.roster?.entries || []) owner[norm(e.playerPoolEntry.player.fullName)] = t.id;
  const out = [];
  for (const p of players) { p.ownedBy = owner[norm(p.name)] ?? null; if (p.ownedBy != null) out.push(p); }
  for (const pos of POS) {
    const fa = players.filter(p => p.pos === pos && p.ownedBy == null && p.games > 0)
      .sort((a, b) => (pos === 'QB' ? (b.ppg || 0) - (a.ppg || 0) : roleOf(b) - roleOf(a)));
    out.push(...fa.slice(0, FA_PER_POS[pos]));
  }
  return out;
}

async function main() {
  const [stats, snaps, pbp, ftn, lg] = await Promise.all([
    get('stats_player', `stats_player_reg_${SEASON}.csv`),
    get('snap_counts', `snap_counts_${SEASON}.csv`),
    get('pbp', `play_by_play_${SEASON}.csv.gz`),
    get('ftn_charting', `ftn_charting_${SEASON}.csv`).catch(e => { console.log(`WARNING ftn charting unavailable (${e.message}) — FTN columns blank`); return []; }),
    espnRosters(),
  ]);
  const players = build({ stats, snaps, pbp, ftn });
  const rows = attach(players, lg);
  const weeks = [...new Set(snaps.map(s => +s.week))].sort((a, b) => a - b);
  const owned = rows.filter(r => r.ownedBy != null);
  const noSnap = owned.filter(r => r.snapPct == null).length;
  const unmatched = lg.teams.flatMap(t => (t.roster?.entries || []).map(e => e.playerPoolEntry.player))
    .filter(p => [1, 2, 3, 4].includes(p.defaultPositionId) && !owned.some(r => norm(r.name) === norm(p.fullName)))
    .map(p => p.fullName);
  fs.writeFileSync(OUT, JSON.stringify({
    generated: new Date().toISOString(), season: SEASON, weeks,
    teams: Object.fromEntries(lg.teams.map(t => [t.id, t.name || String(t.id)])),
    unmatched, rows,
  }));
  console.log(`usage-report.json — season ${SEASON}, weeks ${weeks.join(',')}: ${owned.length} rostered + ${rows.length - owned.length} free agents`);
  console.log(`  rostered with no snap row: ${noSnap}; rostered with no ${SEASON} stats (didn't play / name mismatch): ${unmatched.length} ${unmatched.slice(0, 12).join(', ')}`);
  console.log(`  flags: ${rows.filter(r => r.flag === 'buy-low').length} buy-low, ${rows.filter(r => r.flag === 'sell-high').length} sell-high`);
}

function selftest() {
  const assert = require('assert');
  const S = (id, name, pos, team, o = {}) => ({ player_id: id, player_display_name: name, position: pos, recent_team: team, season_type: 'REG', games: '1', fantasy_points_ppr: '10', targets: '0', carries: '0', receiving_air_yards: '0', target_share: '0', air_yards_share: '0', wopr: '0', ...o });
  const stats = [
    S('a', 'Rb One', 'RB', 'X', { carries: '15', targets: '5', fantasy_points_ppr: '4' }),
    S('b', 'Rb Two', 'RB', 'X', { carries: '5', fantasy_points_ppr: '30' }),
    S('c', 'Wr Deep Jr.', 'WR', 'X', { targets: '10', receiving_air_yards: '150', wopr: '0.6' }),
    S('d', 'Wr None', 'WR', 'X'),
    S('p', 'Playoff Guy', 'RB', 'X', { season_type: 'POST', carries: '99' }),
  ];
  const snaps = [
    { player: 'Rb One', team: 'X', offense_pct: '0.8', game_type: 'REG', week: '1' },
    { player: 'Rb One', team: 'X', offense_pct: '0.6', game_type: 'REG', week: '2' },
    { player: 'Wr Deep', team: 'X', offense_pct: '1', game_type: 'REG', week: '1' },
  ];
  const pbp = [
    { game_id: 'g', play_id: '1', season_type: 'REG', yardline_100: '4', rusher_player_id: 'a', rush_attempt: '1', pass_attempt: '0', sack: '0' },
    { game_id: 'g', play_id: '2', season_type: 'REG', yardline_100: '18', receiver_player_id: 'c', pass_attempt: '1', rush_attempt: '0', sack: '0' },
    { game_id: 'g', play_id: '3', season_type: 'REG', yardline_100: '50', receiver_player_id: 'c', pass_attempt: '1', rush_attempt: '0', sack: '0' },
  ];
  const ftn = [{ nflverse_game_id: 'g', nflverse_play_id: '2', is_play_action: 'TRUE', is_screen_pass: 'FALSE', is_motion: 'TRUE', is_catchable_ball: 'TRUE', is_contested_ball: 'FALSE', is_drop: 'FALSE' }];
  const P = Object.fromEntries(build({ stats, snaps, pbp, ftn }).map(p => [p.id, p]));

  assert.ok(!P.p, 'postseason rows must be excluded');
  assert.strictEqual(P.a.carryShare, 75, 'carry share = 15 of the team\'s 20 regular-season carries');
  assert.strictEqual(P.a.snapPct, 70, 'snap share is the mean of weekly offense_pct, as a percent');
  assert.strictEqual(P.c.snapPct, 100, 'name suffix (Jr.) must not break the snap join');
  assert.strictEqual(P.b.snapPct, null, 'no snap row = null, never 0');
  assert.strictEqual(P.c.adot, 15, 'aDOT = air yards / targets');
  assert.strictEqual(P.d.adot, null, 'zero targets = no aDOT, not 0');
  assert.deepStrictEqual([P.a.rzCar, P.a.glCar, P.c.rzTgt], [1, 1, 1], 'red zone <=20, goal line <=5');
  assert.strictEqual(P.c.ftn.charted, 1, 'only FTN-charted targets count');
  assert.strictEqual(P.c.ftn.playAction, 100);
  assert.strictEqual(P.d.ftn, null, 'no charted targets = null');

  // role vs production: big role + few points = buy-low; tiny role + big points = sell-high
  const mk = (id, carries, ppg) => ({ id, pos: 'RB', games: 1, carries, targets: 0, ppg });
  const pool = Array.from({ length: 40 }, (_, i) => mk('r' + i, 40 - i, 40 - i));
  pool[0].ppg = 5;   // #1 role, scores like RB35
  pool[39].ppg = 45; // #40 role, scores RB1
  flagRoles(pool);
  assert.strictEqual(pool[0].flag, 'buy-low');
  assert.strictEqual(pool[39].flag, 'sell-high');
  assert.strictEqual(pool[10].flag, null, 'role and points in line = no flag');

  const lg = { teams: [{ id: 1, roster: { entries: [{ playerPoolEntry: { player: { fullName: 'Rb Two' } } }] } }] };
  const kept = attach(build({ stats, snaps, pbp, ftn }), lg);
  assert.strictEqual(kept.find(p => p.id === 'b').ownedBy, 1);
  assert.strictEqual(kept.find(p => p.id === 'a').ownedBy, null, 'unrostered player kept as a free agent');
  console.log('selftest OK (no network)');
}

if (process.argv.includes('--selftest')) selftest();
else main().catch(e => { console.error(e); process.exit(1); });
