// Sunday lineup guardrail. The 2025 postmortem's headline failure was deployment, not
// acquisition: 222.4 pts left on the bench and only 26% of waiver-pickup points ever started.
// This is the fix for that — it reads the lineup ESPN currently has set, computes the best
// LEGAL lineup off this week's projections, and only pings Telegram when the gap is real.
//
//   node --env-file=.env scripts/lineup-alert.js            (dry run without TELEGRAM_BOT_TOKEN)
//   node --env-file=.env scripts/lineup-alert.js --selftest (pure logic, no network, no cost)
//
// Deliberate limits:
// - LOCKED = the player already has a week-N actual-stats entry (statSourceId 0). That catches
//   anyone whose game has finished. It does NOT catch a game in progress with 0 points scored
//   yet — ESPN publishes the entry as soon as the game starts, but a player who has genuinely
//   done nothing yet is indistinguishable from one who hasn't kicked off.
//   ponytail: good enough because this runs BEFORE the 1pm ET window; add a proTeamSchedule
//   kickoff-time lookup only if a late-window recommendation ever fires wrongly.
// - Projections are ESPN's own weekly numbers, not the board's consensus. The consensus rank
//   is a season-long draft valuation; it has no weekly matchup component, so it is the wrong
//   instrument here.
const fs = require('fs');
const { bestLineup, SLOT, NFLVERSE_ABBR } = require('./league-history.js');

const { LEAGUE_ID, ESPN_S2, SWID, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } = process.env;
const SEASON = +(process.env.SEASON || new Date().getFullYear());
const MY_TEAM_ID = +(process.env.MY_TEAM_ID || 1);
// Derived Aug 2026 by simulating this exact metric (projected-vs-projected, pre-kickoff)
// across all 168 team-weeks of 2025: median gap is 0 (ESPN's default lineup is usually
// already close), 90th pctile 2.3, 95th pctile 3.0. 5 sat above nearly the whole
// distribution and would have missed real misses (Ethan's own weeks had 1.3/1.4-pt gaps
// that never fired). 3 still filters noise (~5% of team-weeks clear it) but catches them.
const MIN_GAP = +(process.env.MIN_GAP || 3); // projected points; below this it isn't worth a push notification
const STATE_FILE = 'lineup-state.json';
const POS = { 1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'D/ST' };
const BENCHED = s => s === 20 || s === 21;

// views MUST go out as repeated &view= params — the comma-joined form silently omits `settings`
async function espn(views) {
  const url = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${SEASON}/segments/0/leagues/${LEAGUE_ID}?`
    + views.map(v => `view=${v}`).join('&');
  const res = await fetch(url, { headers: { Cookie: `SWID=${SWID}; espn_s2=${ESPN_S2}` } });
  if (!res.ok) throw new Error(`ESPN ${res.status} (401 = cookies expired, re-grab from browser)`);
  return res.json();
}

// The FOUR stat discriminators again (seasonId / statSourceId / scoringPeriodId / statSplitTypeId).
// Weekly entries carry statSplitTypeId 1; the season-total entries carry 0. Verified live Aug 2026:
// Bijan wk1 = src 1 / split 1 / 19.28, while src 1 / sp 0 / split 0 = 352.97 for the season.
const stat = (p, wk, src) => (p?.stats || []).find(s =>
  s.seasonId === SEASON && s.statSourceId === src && s.scoringPeriodId === wk && s.statSplitTypeId === 1);

// Best legal lineup among the players who can still be moved, with locked starters left
// exactly where they are and their slots taken off the board.
function optimize(players, slotCounts) {
  const open = { ...slotCounts };
  for (const p of players) if (p.locked && !BENCHED(p.slot)) open[p.slot] = (open[p.slot] || 0) - 1;
  const movable = players.filter(p => !p.locked);
  const best = bestLineup(movable, open);
  const startingNow = movable.filter(p => !BENCHED(p.slot));
  const inIds = new Set(best.picked.map(p => p.id));
  return {
    gain: +(best.total - startingNow.reduce((a, p) => a + p.pts, 0)).toFixed(1),
    start: best.picked.filter(p => BENCHED(players.find(x => x.id === p.id).slot)),
    sit: startingNow.filter(p => !inIds.has(p.id)),
  };
}

async function fetchRoster() {
  const d = await espn(['mRoster', 'mSettings']);
  const wk = d.scoringPeriodId;
  const team = d.teams.find(t => t.id === MY_TEAM_ID);
  if (!team) throw new Error(`No team ${MY_TEAM_ID} in league ${LEAGUE_ID}`);
  const players = (team.roster?.entries || []).map(e => {
    const p = e.playerPoolEntry?.player;
    return {
      id: e.playerId,
      name: p?.fullName || `id${e.playerId}`,
      pos: POS[p?.defaultPositionId] || '?',
      slot: e.lineupSlotId,
      elig: p?.eligibleSlots || [],
      pts: stat(p, wk, 1)?.appliedTotal ?? 0,     // this week's projection
      locked: !!stat(p, wk, 0),                    // has a week-N actual = game already under way
      proTeamId: p?.proTeamId,
    };
  });
  return { wk, players, slotCounts: d.settings.rosterSettings.lineupSlotCounts };
}

// Bell-cow RB matchup note. Backtested Aug 2026 (see sos-tier-matchup scratch test):
// top-15-carries RBs gain/lose ~3.3 pts above their own average vs a bottom-8 vs top-8
// run defense — everyday backs only show ~1.1, and WRs show ~no tiered effect at all
// (scheme neutralizes it). So this is RB-only, bell-cow-only, on purpose — don't extend
// it to WR/TE, the data says that signal isn't there.
const BELLCOW_N = 15;
const DEF_TOP = 8, DEF_BOTTOM = 25; // rank <=8 stingiest, >=25 most generous (of 32)
// A full-season average reacts too slowly to an in-season change (new DC, a lost starter):
// an 8-week-old sample keeps outvoting recent games for weeks after the change. A trailing
// window trades that lag for more noise from a smaller sample — 6 weeks is the balance point.
const TRAILING_WEEKS = 6;

// rank 1 = fewest PPR pts/game allowed to RB over the trailing window (stingiest), 32 = most
// generous. Windowed on the games actually present, so it works with a partial season too.
function rankRBAllowed(games, trailingWeeks = TRAILING_WEEKS) {
  const rbGames = games.filter(g => g.pos === 'RB' && g.opponent_team);
  const maxWeek = rbGames.reduce((m, g) => Math.max(m, g.week), 0);
  const cutoff = maxWeek - trailingWeeks + 1;
  const allowed = {};
  for (const g of rbGames) {
    if (g.week < cutoff) continue;
    const t = allowed[g.opponent_team] ||= { pts: 0, wks: new Set() };
    t.pts += g.pts; t.wks.add(g.week);
  }
  return Object.entries(allowed)
    .map(([team, t]) => ({ team, avg: t.pts / t.wks.size }))
    .sort((a, b) => a.avg - b.avg)
    .reduce((m, r, i) => (m[r.team] = { rank: i + 1, avg: +r.avg.toFixed(1) }, m), {});
}

// Copied from handcuff-watch.js's TEAM_ABBR (not exported there — see its csvSplit-style
// copy-not-export note in boom-rates.js). ESPN's injuries feed keys teams by full display
// name; this maps that to the ESPN abbreviation, then NFLVERSE_ABBR fixes the two spelling
// mismatches (LAR/LA, WSH/WAS) to match the nflverse abbreviation `opp` is already in.
const TEAM_ABBR = {
  'Arizona Cardinals': 'ARI', 'Atlanta Falcons': 'ATL', 'Baltimore Ravens': 'BAL',
  'Buffalo Bills': 'BUF', 'Carolina Panthers': 'CAR', 'Chicago Bears': 'CHI',
  'Cincinnati Bengals': 'CIN', 'Cleveland Browns': 'CLE', 'Dallas Cowboys': 'DAL',
  'Denver Broncos': 'DEN', 'Detroit Lions': 'DET', 'Green Bay Packers': 'GB',
  'Houston Texans': 'HOU', 'Indianapolis Colts': 'IND', 'Jacksonville Jaguars': 'JAX',
  'Kansas City Chiefs': 'KC', 'Las Vegas Raiders': 'LV', 'Los Angeles Chargers': 'LAC',
  'Los Angeles Rams': 'LAR', 'Miami Dolphins': 'MIA', 'Minnesota Vikings': 'MIN',
  'New England Patriots': 'NE', 'New Orleans Saints': 'NO', 'New York Giants': 'NYG',
  'New York Jets': 'NYJ', 'Philadelphia Eagles': 'PHI', 'Pittsburgh Steelers': 'PIT',
  'San Francisco 49ers': 'SF', 'Seattle Seahawks': 'SEA', 'Tampa Bay Buccaneers': 'TB',
  'Tennessee Titans': 'TEN', 'Washington Commanders': 'WAS',
};
// Front-seven positions whose absence actually loosens a run defense. A rank is a season
// (or trailing-window) AVERAGE across the whole defense — it has no idea a specific starter
// is out for THIS game, so this is a best-effort caveat, not a recomputed rank.
const RUN_DEF_POS = new Set(['DT', 'DE', 'NT', 'LB', 'ILB', 'OLB', 'MLB']);
const OUT_STATUSES = new Set(['Out', 'Doubtful', 'Injured Reserve', 'IR']);

async function frontSevenInjuries() {
  const r = await fetch('https://site.api.espn.com/apis/site/v2/sports/football/nfl/injuries');
  if (!r.ok) throw new Error(`ESPN injuries feed ${r.status}`);
  const j = await r.json();
  const byTeam = {}; // nflverse-abbrev team -> [{name, pos, status}]
  for (const team of j.injuries || []) {
    const espnAbbr = TEAM_ABBR[team.displayName];
    if (!espnAbbr) continue;
    const abbr = NFLVERSE_ABBR[espnAbbr] || espnAbbr;
    for (const i of team.injuries || []) {
      const pos = i.athlete?.position?.abbreviation;
      if (!RUN_DEF_POS.has(pos) || !OUT_STATUSES.has(i.status)) continue;
      (byTeam[abbr] ||= []).push({ name: i.athlete.displayName, pos, status: i.status });
    }
  }
  return byTeam;
}

// top-N RBs league-wide by season-to-date carries — the volume tier the backtest showed
// actually has a matchup-sensitive signal. Absence (a rookie splitting carries) just
// means he isn't bell-cow yet, not that he's excluded unfairly.
function bellCowNames(games, n = BELLCOW_N) {
  const carries = {};
  for (const g of games) if (g.pos === 'RB') carries[g.name] = (carries[g.name] || 0) + g.carries;
  return new Set(Object.entries(carries).sort((a, b) => b[1] - a[1]).slice(0, n).map(([name]) => name));
}

async function rbSosNotes(wk, players) {
  const { weekly } = require('./boom-rates'); // require.main-guarded there — this does not kick off a run
  const games = await weekly(SEASON);
  if (!games) return []; // no games played yet this season

  const bellCow = bellCowNames(games);
  const defRank = rankRBAllowed(games);
  const myRBs = players.filter(p => p.pos === 'RB' && bellCow.has(p.name.toLowerCase()));
  if (!myRBs.length) return [];

  const [schedData, injuries] = await Promise.all([
    (await fetch(`https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${SEASON}?view=proTeamSchedules_wl`)).json(),
    frontSevenInjuries().catch(e => { console.warn(`front-seven injury check failed (${e.message}) — notes will skip the caveat`); return {}; }),
  ]);
  const proMap = {}; (schedData.settings?.proTeams || []).forEach(t => proMap[t.id] = t);
  const nflverseAbbr = a => NFLVERSE_ABBR[a] || a;

  const notes = [];
  for (const p of myRBs) {
    const team = proMap[p.proTeamId];
    const g = (team?.proGamesByScoringPeriod?.[wk] || [])[0];
    if (!g) continue; // bye
    const oppId = g.homeProTeamId === team.id ? g.awayProTeamId : g.homeProTeamId;
    const opp = nflverseAbbr(proMap[oppId]?.abbrev);
    const r = defRank[opp];
    if (!r) continue;
    const hurt = injuries[opp];
    const caveat = hurt?.length ? ` (⚕️ ${opp} front seven: ${hurt.map(h => `${h.name} ${h.status}`).join(', ')} — rank may not reflect this)` : '';
    if (r.rank <= DEF_TOP) notes.push(`🛑 ${p.name} (bell-cow) faces ${opp}, the #${r.rank} run defense over the last ${TRAILING_WEEKS} weeks (${r.avg} pts/g allowed) — tougher matchup than usual.${caveat}`);
    else if (r.rank >= DEF_BOTTOM) notes.push(`🟢 ${p.name} (bell-cow) faces ${opp}, the #${r.rank} run defense over the last ${TRAILING_WEEKS} weeks (${r.avg} pts/g allowed) — soft matchup, lean in.${caveat}`);
  }
  return notes;
}

// Rest-of-season version of the same signal, for the trade finder: instead of THIS week's
// opponent, average every REMAINING week's opponent run-D rank. The NFL schedule is fixed
// and fully known in advance, so unlike the backtest there's no leakage concern here.
// Fantasy seasons run through week 17 (matches PLAYOFF_WEEKS in league-history.js).
const LAST_WEEK = 17;
async function restOfSeasonRBSoS(games, schedData) {
  const bellCow = bellCowNames(games);
  const defRank = rankRBAllowed(games);
  const maxWeek = games.filter(g => g.pos === 'RB' && g.opponent_team).reduce((m, g) => Math.max(m, g.week), 0);
  const proTeams = (schedData.settings?.proTeams || []).filter(t => t.abbrev && t.abbrev !== 'FA');
  const nflverseAbbr = a => NFLVERSE_ABBR[a] || a;
  const proMap = {}; proTeams.forEach(t => proMap[t.id] = t);
  const teamByAbbr = {}; proTeams.forEach(t => teamByAbbr[nflverseAbbr(t.abbrev)] = t);

  // A player's current team, off the most recent nflverse row (handles an in-season trade).
  const teamOf = {};
  for (const g of games) if (g.pos === 'RB') teamOf[g.name] = g.team;

  const out = {};
  for (const name of bellCow) {
    const team = teamByAbbr[teamOf[name]];
    if (!team) continue;
    const ranks = [];
    for (let wk = maxWeek + 1; wk <= LAST_WEEK; wk++) {
      const g = (team.proGamesByScoringPeriod?.[wk] || [])[0];
      if (!g) continue; // bye
      const oppId = g.homeProTeamId === team.id ? g.awayProTeamId : g.homeProTeamId;
      const r = defRank[nflverseAbbr(proMap[oppId]?.abbrev)];
      if (r) ranks.push(r.rank);
    }
    if (ranks.length) out[name] = { avgRank: +(ranks.reduce((a, b) => a + b, 0) / ranks.length).toFixed(1), weeks: ranks.length };
  }
  return out;
}

const fmt = (wk, r, rbNotes) => {
  let msg = r.gain >= MIN_GAP
    ? `⚠️ Week ${wk} lineup is leaving ${r.gain} projected pts on the bench.\n\n`
      + r.start.map(p => `START ${p.name} (${p.pos}, ${p.pts.toFixed(1)}) → ${p.slot}`).join('\n')
      + `\n` + r.sit.map(p => `SIT   ${p.name} (${p.pos}, ${p.pts.toFixed(1)})`).join('\n')
    : `Week ${wk} lineup update:`;
  if (rbNotes.length) msg += `\n\n` + rbNotes.join('\n');
  return msg;
};

// One advice signature per week — re-alerting the identical swap/matchup note every run is
// how an alert gets muted. A changed recommendation (injury news, a different bench player,
// a run-D that moved in/out of the top/bottom-8) does re-fire.
const sig = (wk, r, rbNotes) => `${wk}:${[...r.start, ...r.sit].map(p => p.id).sort().join(',')}:${rbNotes.join('|')}`;

async function main() {
  const { wk, players, slotCounts } = await fetchRoster();
  const r = optimize(players, slotCounts);
  console.log(`Week ${wk}: ${players.filter(p => p.locked).length} locked, optimal lineup is +${r.gain} pts`);

  const rbNotes = await rbSosNotes(wk, players);
  if (rbNotes.length) console.log(rbNotes.join('\n'));

  if (r.gain < MIN_GAP && !rbNotes.length) return console.log(`Under the ${MIN_GAP}-pt threshold and no bell-cow matchup notes — no alert.`);
  const msg = fmt(wk, r, rbNotes);
  console.log(msg);

  let state = {}; try { state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { }
  if (state.sent === sig(wk, r, rbNotes)) return console.log('Same advice as the last run — not re-sending.');
  fs.writeFileSync(STATE_FILE, JSON.stringify({ sent: sig(wk, r, rbNotes) }));

  if (!TELEGRAM_BOT_TOKEN) return console.log('No TELEGRAM_BOT_TOKEN — dry run, state saved, not sending.');
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: msg }),
  });
  console.log('Sent to Telegram.');
}

async function selftest() {
  const assert = require('assert');
  const counts = { 2: 1, 4: 1, 20: 3 };
  const P = (id, name, elig, slot, pts, locked) => ({ id, name, pos: 'RB', elig, slot, pts, locked });

  // a bench player who outprojects the starter at his own position must surface
  let r = optimize([P(1, 'startRB', [2, 20], 2, 5), P(2, 'benchRB', [2, 20], 20, 15), P(3, 'wr', [4, 20], 4, 9)], counts);
  assert.strictEqual(r.gain, 10, `gain, got ${r.gain}`);
  assert.deepStrictEqual([r.start.map(p => p.name), r.sit.map(p => p.name)], [['benchRB'], ['startRB']]);

  // eligibility, not position: a WR-only bench player can't be told to take the RB slot
  r = optimize([P(1, 'startRB', [2, 20], 2, 5), P(2, 'benchWRonly', [4, 20], 20, 30), P(3, 'wr', [4, 20], 4, 29)], counts);
  assert.strictEqual(r.gain, 1, `WR-only can only take the WR slot, got ${r.gain}`);

  // a LOCKED starter is never benched, and his slot is off the board
  r = optimize([P(1, 'played', [2, 20], 2, 5, true), P(2, 'benchRB', [2, 20], 20, 15)], counts);
  assert.strictEqual(r.gain, 0, `locked starter must not be swapped, got ${r.gain}`);
  assert.deepStrictEqual(r.start, []);

  // a LOCKED bench player is never recommended either (his game is already gone)
  r = optimize([P(1, 'startRB', [2, 20], 2, 5), P(2, 'lockedBench', [2, 20], 20, 40, true)], counts);
  assert.strictEqual(r.gain, 0, `locked bench player must not be started, got ${r.gain}`);

  // already optimal = zero, not a negative
  assert.strictEqual(optimize([P(1, 'a', [2, 20], 2, 20), P(2, 'b', [2, 20], 20, 3)], counts).gain, 0);

  // the weekly stat picker must pin split 1 — the season-total entry matches on the other three
  const fake = { stats: [
    { seasonId: SEASON, statSourceId: 1, scoringPeriodId: 1, statSplitTypeId: 1, appliedTotal: 19.3 },
    { seasonId: SEASON, statSourceId: 1, scoringPeriodId: 1, statSplitTypeId: 0, appliedTotal: 353.0 },
    { seasonId: SEASON - 1, statSourceId: 1, scoringPeriodId: 1, statSplitTypeId: 1, appliedTotal: 999 },
  ] };
  assert.strictEqual(stat(fake, 1, 1).appliedTotal, 19.3, 'weekly projection, not the season total');

  // same advice must not re-fire; different advice must
  const a = { start: [{ id: 2 }], sit: [{ id: 1 }] };
  assert.strictEqual(sig(3, a, []), sig(3, { start: [{ id: 1 }], sit: [{ id: 2 }] }, []), 'signature is order-independent');
  assert.notStrictEqual(sig(3, a, []), sig(4, a, []), 'a new week is new advice');
  assert.notStrictEqual(sig(3, a, []), sig(3, a, ['matchup note']), 'a new RB-SoS note is new advice too');
  assert.ok(SLOT[20] === 'BENCH' && BENCHED(21), 'bench/IR ids');

  // bell-cow RB SoS: rank 1 = fewest pts/g allowed, and volume tiering is by CARRIES not points
  const G = (name, week, opp, pts, carries) => ({ name, pos: 'RB', week, opponent_team: opp, pts, carries });
  const rbGames = [
    G('workhorse', 1, 'AAA', 10, 20), G('workhorse', 2, 'BBB', 20, 22),
    G('backup', 1, 'BBB', 5, 4), G('backup', 2, 'AAA', 3, 3),
  ];
  const ranks = rankRBAllowed(rbGames);
  assert.strictEqual(ranks.AAA.rank, 1, 'AAA allowed fewer RB pts on average, should rank 1 (stingiest)');
  assert.strictEqual(ranks.BBB.rank, 2, 'BBB allowed more, should rank 2');
  const bc = bellCowNames(rbGames, 1);
  assert.ok(bc.has('workhorse') && !bc.has('backup'), 'top carries wins the bell-cow slot, not top points');

  // trailing window: a defense's old games must age out once enough new ones exist
  const trailGames = [
    { pos: 'RB', week: 1, opponent_team: 'OLD', pts: 0, carries: 0 },
    { pos: 'RB', week: 6, opponent_team: 'NEW', pts: 5, carries: 0 },
    { pos: 'RB', week: 7, opponent_team: 'NEW', pts: 5, carries: 0 },
  ];
  const trailRanks = rankRBAllowed(trailGames, 3); // window = weeks 5-7
  assert.ok(!trailRanks.OLD, 'week-1 data must age out of a 3-week trailing window ending at week 7');
  assert.ok(trailRanks.NEW, 'in-window team must still be ranked');

  // rest-of-season SoS: averages every REMAINING week's opponent rank, not just the next one
  const rosGames = [
    G('bellcow', 1, 'TOUGH', 10, 20), G('bellcow', 2, 'TOUGH', 8, 20), // 40 carries -> bell-cow
    G('filler', 1, 'SOFT', 30, 5), G('filler', 2, 'SOFT', 25, 5), // gives SOFT a defRank entry too
  ];
  const fakeSched = { settings: { proTeams: [
    { id: 1, abbrev: 'MEE', proGamesByScoringPeriod: { 3: [{ homeProTeamId: 1, awayProTeamId: 2 }], 4: [{ homeProTeamId: 3, awayProTeamId: 1 }] } },
    { id: 2, abbrev: 'TOUGH' }, { id: 3, abbrev: 'SOFT' },
  ] } };
  const ros = await restOfSeasonRBSoS([...rosGames, { name: 'bellcow', pos: 'RB', team: 'MEE' }], fakeSched);
  assert.ok(ros.bellcow, 'bell-cow with a resolvable team must get a rest-of-season score');
  assert.strictEqual(ros.bellcow.weeks, 2, 'weeks 3 and 4 both count, not just the next one');
  console.log('selftest OK (no network)');
}

// Guarded so a verification script can import rbSosNotes() against real historical data
// without triggering a live run (same pattern as league-history.js / boom-rates.js).
if (require.main === module) {
  if (process.argv.includes('--selftest')) selftest().catch(e => { console.error(e); process.exit(1); });
  else main().catch(e => { console.error(e); process.exit(1); });
}
module.exports = { rankRBAllowed, bellCowNames, rbSosNotes, frontSevenInjuries, restOfSeasonRBSoS };
