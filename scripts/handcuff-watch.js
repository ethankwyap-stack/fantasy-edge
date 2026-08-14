// In-season handcuff watch — free, no key. Answers "who just got hurt, who's the real
// backup, and is he worth a FAAB bid" using [[handcuffs-beat-sleepers]] (63% NFL-wide
// hit rate on a CONFIRMED clear backfield, vs 18.8% on a speculative sleeper pick).
//
// Three free sources, cross-referenced:
//   1. ESPN's public injuries feed         -> who's Out/Doubtful/IR right now
//   2. Sleeper's full player dump          -> each team's RB depth chart order
//   3. nflverse weekly (via boom-rates.js) -> this season's carry share, once games exist
//   4. this league's rosters + FAAB        -> is the handcuff free, and how much to bid
//
// Usage: node --env-file=.env scripts/handcuff-watch.js [--selftest]
//   (dry run without TELEGRAM_BOT_TOKEN: prints the table, saves state, doesn't send)
const fs = require('fs');
const { weekly } = require('./boom-rates'); // require.main-guarded there, no run kicked off

const { LEAGUE_ID, ESPN_S2, SWID, SEASON = '2026', MY_TEAM_ID = '1', TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } = process.env;
const STATE_FILE = 'handcuff-state.json';
const OUT_STATUSES = new Set(['Out', 'Doubtful', 'Injured Reserve', 'IR']);
const CLEAR_SHARE = 0.55; // handcuff carries this season / team RB carries this season

// ESPN's injuries feed keys teams by full display name ("Arizona Cardinals"); Sleeper
// keys players by team abbreviation ("ARI"). Small, stable — NFL teams rename rarely.
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

async function fetchInjuredRBs() {
  const r = await fetch('https://site.api.espn.com/apis/site/v2/sports/football/nfl/injuries');
  if (!r.ok) throw new Error(`ESPN injuries feed ${r.status}`);
  const j = await r.json();
  const out = [];
  for (const team of j.injuries || []) {
    const abbr = TEAM_ABBR[team.displayName];
    for (const i of team.injuries || []) {
      if (i.athlete?.position?.abbreviation !== 'RB') continue;
      if (!OUT_STATUSES.has(i.status)) continue;
      out.push({ name: i.athlete.displayName, team: abbr, status: i.status });
    }
  }
  return out;
}

async function fetchDepthCharts() {
  const r = await fetch('https://api.sleeper.app/v1/players/nfl');
  if (!r.ok) throw new Error(`Sleeper dump ${r.status}`);
  const j = await r.json();
  const byTeam = {}; // team -> [{name, order, active}] sorted by depth_chart_order
  for (const p of Object.values(j)) {
    if (p.position !== 'RB' || !p.team || !p.depth_chart_order) continue;
    (byTeam[p.team] ||= []).push({
      name: p.full_name, order: p.depth_chart_order,
      active: p.status === 'Active' && !p.injury_status,
    });
  }
  for (const t in byTeam) byTeam[t].sort((a, b) => a.order - b.order);
  return byTeam;
}

// Only a real starter/clear No.2 is worth handcuffing — an IR'd 4th-stringer with no
// depth-chart slot isn't "out", he was never playing. Without this check, pickHandcuff()
// resolves his "backup" to whoever chart[0] is: the actual RB1, mislabeled as a handcuff.
function isHandcuffWorthy(name, team, byTeam) {
  const meEntry = (byTeam[team] || []).find(r => r.name === name);
  return !!meEntry && meEntry.order <= 2;
}

// Given the starter's name+team and the depth chart, the handcuff is the next active
// RB behind him (skips anyone else also marked out — a second injury shouldn't hand
// the "handcuff" label to a third-stringer without saying so).
function pickHandcuff(starterName, team, byTeam) {
  const chart = byTeam[team];
  if (!chart) return null;
  const meIdx = chart.findIndex(r => r.name === starterName);
  const pool = meIdx === -1 ? chart : chart.filter((_, i) => i !== meIdx);
  return pool.find(r => r.active) || null;
}

// Season-to-date carry share for `handcuff` among his team's RBs, using nflverse
// weekly (already downloaded for boom-rates.js — not refetched). Returns null before
// any games exist for the season; the caller reads that as "depth chart only, unconfirmed".
function roleSignal(games, handcuffName, team) {
  if (!games) return null;
  const teamCarries = {};
  let total = 0;
  for (const g of games) {
    if (g.pos !== 'RB' || g.team !== team) continue;
    teamCarries[g.name] = (teamCarries[g.name] || 0) + (g.carries || 0);
    total += g.carries || 0;
  }
  if (total < 10) return null; // effectively no games played yet this season
  const mine = teamCarries[handcuffName] || 0;
  if (mine < 5) return { share: mine / total, label: 'unconfirmed — too few carries yet' };
  const share = mine / total;
  return { share, label: share >= CLEAR_SHARE ? 'clear backfield' : 'committee' };
}

function suggestion(roleLabel, leagueStatus) {
  if (leagueStatus.owner === 'you') return 'already yours — no action';
  if (leagueStatus.owner) return `owned by ${leagueStatus.owner} — no action`;
  if (roleLabel === 'clear backfield') return 'bid 10-15% of remaining budget — confirmed clear back, [[handcuffs-beat-sleepers]] rate applies';
  if (roleLabel === 'committee') return 'skip or $1 flier — committee backfields are where the 63% rate breaks down';
  return 'light bid ~5% — depth chart order only, confirm role once he actually plays';
}

async function leagueStatusOf(name, teams, myTeamId) {
  const lower = name.toLowerCase();
  for (const t of teams) if (t.players.some(p => p.fullName.toLowerCase() === lower))
    return { owner: t.id === myTeamId ? 'you' : t.name };
  return { owner: null };
}

async function fetchLeague() {
  const qs = ['mTeam', 'mRoster', 'mSettings'].map(v => `view=${v}`).join('&');
  const url = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${SEASON}/segments/0/leagues/${LEAGUE_ID}?${qs}`;
  const res = await fetch(url, { headers: { Cookie: `SWID=${SWID}; espn_s2=${ESPN_S2}` } });
  if (!res.ok) throw new Error(`ESPN ${res.status} (401 = cookies expired, re-grab from browser)`);
  const d = await res.json();
  const acq = d.settings?.acquisitionSettings || {};
  const faab = acq.isUsingAcquisitionBudget ? { total: acq.acquisitionBudget || 0 } : null;
  const teams = (d.teams || []).map(t => ({
    id: t.id, name: t.name || `Team ${t.id}`,
    players: (t.roster?.entries || []).map(e => e.playerPoolEntry?.player).filter(Boolean),
    spent: t.transactionCounter?.acquisitionBudgetSpent || 0,
  }));
  return { teams, faab };
}

async function main() {
  console.log('Fetching current NFL injuries, depth charts, and this league\'s rosters...\n');
  const [injured, byTeam, league, games] = await Promise.all([
    fetchInjuredRBs(), fetchDepthCharts(), fetchLeague(),
    weekly(+SEASON).catch(() => null),
  ]);
  const myTeamId = +MY_TEAM_ID;
  const myBudget = league.faab ? league.faab.total - (league.teams.find(t => t.id === myTeamId)?.spent || 0) : null;

  if (!injured.length) { console.log('No RB starters currently Out/Doubtful/IR league-wide.'); return; }

  const rows = [];
  for (const inj of injured) {
    if (!inj.team) continue; // team name didn't map — skip rather than guess
    if (!isHandcuffWorthy(inj.name, inj.team, byTeam)) continue;
    const cuff = pickHandcuff(inj.name, inj.team, byTeam);
    if (!cuff) continue;
    const role = roleSignal(games, cuff.name, inj.team);
    const status = await leagueStatusOf(cuff.name, league.teams, myTeamId);
    rows.push({ inj, cuff, roleLabel: role?.label, status, action: suggestion(role?.label, status) });
  }

  if (!rows.length) { console.log('Found injured RBs, but none matched a depth-chart backup.'); return; }

  console.log(`${'Injured starter'.padEnd(22)} ${'Team'.padEnd(5)} ${'Handcuff'.padEnd(22)} ${'Role'.padEnd(24)} Action`);
  for (const r of rows)
    console.log(`${(r.inj.name + ' (' + r.inj.status + ')').padEnd(22)} ${r.inj.team.padEnd(5)} ${r.cuff.name.padEnd(22)} ${(r.roleLabel || 'no games yet').padEnd(24)} ${r.action}`);

  if (myBudget != null) console.log(`\nYour remaining FAAB: $${myBudget}`);
  console.log('\nRole signal needs real season carries — early in the year most of these will read');
  console.log('"no games yet" and lean on depth chart order alone. That is expected, not a bug.');

  await alertOnFreeAgents(rows, myBudget);
}

// Only free-agent handcuffs are worth a phone ping — "already yours" / "owned by X" need
// no action. Dedup by the (injured, handcuff) pair so the same still-injured, still-free
// handcuff doesn't re-alert every run; a NEW pairing (different injury, or he got claimed
// and freed again) sends again, same idea as lineup-alert.js's per-week signature.
function alertSig(rows) {
  return rows.map(r => `${r.inj.name}>${r.cuff.name}`).sort().join('|');
}

async function alertOnFreeAgents(rows, myBudget) {
  const actionable = rows.filter(r => !r.status.owner);
  if (!actionable.length) return console.log('\nNo free-agent handcuffs to alert on.');

  const thisSig = alertSig(actionable);
  let state = {}; try { state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { }
  if (state.sent === thisSig) return console.log('\nSame free-agent handcuffs as last run — not re-alerting.');
  fs.writeFileSync(STATE_FILE, JSON.stringify({ sent: thisSig }));

  const lines = actionable.map(r =>
    `${r.cuff.name} (${r.inj.team}) — backup for ${r.inj.name} (${r.inj.status}), ${r.roleLabel || 'no games yet'}\n${r.action}`);
  const text = '🏈 Handcuff watch:\n\n' + lines.join('\n\n') +
    (myBudget != null ? `\n\nYour remaining FAAB: $${myBudget}` : '');

  if (!TELEGRAM_BOT_TOKEN) return console.log('\nNo TELEGRAM_BOT_TOKEN — dry run, state saved, not sending.');
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text }),
  });
  console.log('\nSent Telegram alert.');
}

function selftest() {
  const assert = require('assert');
  const byTeam = { ARI: [
    { name: 'James Conner', order: 1, active: true },
    { name: 'Trey Benson', order: 2, active: true },
    { name: 'Bam Knight', order: 3, active: true },
  ] };
  assert.strictEqual(pickHandcuff('James Conner', 'ARI', byTeam).name, 'Trey Benson', 'picks next active, not self');
  const byTeamHurtBackup = { ARI: [
    { name: 'James Conner', order: 1, active: true },
    { name: 'Trey Benson', order: 2, active: false },
    { name: 'Bam Knight', order: 3, active: true },
  ] };
  assert.strictEqual(pickHandcuff('James Conner', 'ARI', byTeamHurtBackup).name, 'Bam Knight', 'skips a backup who is himself inactive');
  assert.strictEqual(pickHandcuff('Nobody', 'ZZZ', byTeam), null, 'unknown team returns null, not a throw');

  assert.strictEqual(isHandcuffWorthy('James Conner', 'ARI', byTeam), true, 'RB1 is worth handcuffing');
  assert.strictEqual(isHandcuffWorthy('Trey Benson', 'ARI', byTeam), true, 'RB2 is worth handcuffing');
  assert.strictEqual(isHandcuffWorthy('Bam Knight', 'ARI', byTeam), false, 'RB3 is not');
  assert.strictEqual(isHandcuffWorthy('Chris Collier', 'LV', {}), false, 'not even on the depth chart is not');

  const games = [
    { name: 'Trey Benson', pos: 'RB', team: 'ARI', carries: 20 },
    { name: 'Bam Knight', pos: 'RB', team: 'ARI', carries: 5 },
  ];
  assert.strictEqual(roleSignal(games, 'Trey Benson', 'ARI').label, 'clear backfield', '20/25 = 80% should read clear');
  assert.strictEqual(roleSignal(games, 'Bam Knight', 'ARI').label, 'committee', '5/25 = 20% should read committee');
  assert.strictEqual(roleSignal(null, 'Trey Benson', 'ARI'), null, 'no games at all -> null, not a guess');
  assert.strictEqual(roleSignal([{ name: 'Trey Benson', pos: 'RB', team: 'ARI', carries: 2 }], 'Trey Benson', 'ARI'), null, 'under the 10-carry team floor -> null');

  assert.strictEqual(suggestion('clear backfield', { owner: null }), 'bid 10-15% of remaining budget — confirmed clear back, [[handcuffs-beat-sleepers]] rate applies');
  assert.strictEqual(suggestion('committee', { owner: null }), 'skip or $1 flier — committee backfields are where the 63% rate breaks down');
  assert.strictEqual(suggestion(undefined, { owner: null }), 'light bid ~5% — depth chart order only, confirm role once he actually plays');
  assert.strictEqual(suggestion('clear backfield', { owner: 'you' }), 'already yours — no action');
  assert.strictEqual(suggestion('clear backfield', { owner: 'Nico Suave' }), 'owned by Nico Suave — no action');

  const rowsA = [{ inj: { name: 'Zach Charbonnet' }, cuff: { name: 'Emanuel Wilson' } }];
  const rowsB = [{ inj: { name: 'Zach Charbonnet' }, cuff: { name: 'Emanuel Wilson' } }];
  assert.strictEqual(alertSig(rowsA), alertSig(rowsB), 'same pairing -> same signature, so a re-run does not re-alert');
  const rowsC = [{ inj: { name: 'James Conner' }, cuff: { name: 'Trey Benson' } }];
  assert.notStrictEqual(alertSig(rowsA), alertSig(rowsC), 'a different injury/handcuff pairing is new advice');

  console.log('selftest: all assertions passed');
}

module.exports = { pickHandcuff, roleSignal, suggestion, isHandcuffWorthy, alertSig };

if (require.main === module) {
  if (process.argv.includes('--selftest')) selftest();
  else main().catch(e => { console.error(e.message); process.exit(1); });
}
