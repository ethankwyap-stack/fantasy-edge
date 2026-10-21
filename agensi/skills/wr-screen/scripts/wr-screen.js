#!/usr/bin/env node
// WR screen: how likely is this wide receiver to finish top-24 PPR this season?
//
// Veterans are graded on ONE input: last season's PER-GAME target share.
// Rookies are graded on their weeks 1-4 target share this season.
// Rates below were measured on nflverse data (veterans 2017-2025, rookies 2016-2025);
// see references/findings.md. They are constants so the grade is reproducible offline.
//
// Network: downloads free public CSVs from github.com/nflverse/nflverse-data releases.
// No API key, no account, no other hosts. Writes a cache only to ./.fantasy-cache in the
// current directory. Installs nothing.
//
// Usage:
//   node wr-screen.js "Puka Nacua" "Malik Nabers"   # grade named WRs
//   node wr-screen.js --top 40                       # top 40 graded WRs
//   node wr-screen.js --season 2026 --json "..."     # pick season, JSON output
//   node wr-screen.js --selftest                     # no network
const fs = require('fs');
const path = require('path');

const CACHE = path.join(process.cwd(), '.fantasy-cache');
const MIN_G = 4;          // under 4 games a share is arithmetic, not signal
const EARLY_WK = 4;       // rookie role window

// [min per-game share, band, top-24 rate %, sample size]
const VET = [
  [0.25, 'A', 58.2, 158],
  [0.20, 'B', 29.5, 190],
  [0.15, 'C', 15.4, 227],
  [0.00, 'D', 1.9, 691],
];
// [min weeks 1-4 share, band, top-12 rate %, top-24 rate %, sample size]
const ROOKIE = [
  [0.25, '25%+', 22.2, 44.4, 9],
  [0.18, '18-25%', 20.8, 29.2, 24],
  [0.12, '12-18%', 0, 8.7, 46],
  [0.00, '<12%', 0, 3.0, 135],
];

const vetGrade = s => { const b = VET.find(x => s >= x[0]); return { band: b[1], top24: b[2], n: b[3] }; };
const rookieGrade = s => {
  if (s === null || s === undefined) return null;
  const b = ROOKIE.find(x => s >= x[0]);
  return { band: b[1], top12: b[2], top24: b[3], n: b[4] };
};

// THE metric. Per game on both sides — a season total punishes missed games and grades an
// injured alpha as a bottom-tier role.
const shareOf = (p, teamTgt, teamG) => (p.tgt / p.g) / ((teamTgt[p.team] || 1) / (teamG[p.team] || 17));

const norm = n => (n || '').toLowerCase().replace(/[.'`-]/g, '')
  .replace(/\s+(jr|sr|ii|iii|iv|v)$/, '').replace(/\s+/g, ' ').trim();

function csvSplit(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

// One season of nflverse weekly player stats -> per-WR targets/games/team and per-team totals.
function parse(text) {
  const lines = text.split('\n'), ix = {};
  csvSplit(lines[0]).forEach((c, i) => ix[c] = i);
  const P = {}, teamTgt = {}, weeks = {};
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const f = csvSplit(lines[i]);
    if (f[ix.season_type] !== 'REG') continue;   // playoff weeks contaminate rates
    const team = f[ix.team], tgt = +f[ix.targets] || 0, wk = +f[ix.week];
    if (team) { teamTgt[team] = (teamTgt[team] || 0) + tgt; (weeks[team] ||= new Set()).add(wk); }
    if (f[ix.position] !== 'WR') continue;
    const n = norm(f[ix.player_display_name]);
    if (!n) continue;
    const p = P[n] ||= { name: f[ix.player_display_name], id: f[ix.player_id], tgt: 0, g: 0, teams: {}, early: [] };
    p.tgt += tgt; p.g++;
    if (team) p.teams[team] = (p.teams[team] || 0) + 1;
    const ts = +f[ix.target_share];
    if (wk <= EARLY_WK && ts > 0) p.early.push(ts);
  }
  for (const p of Object.values(P)) p.team = Object.entries(p.teams).sort((a, b) => b[1] - a[1])[0]?.[0];
  const teamG = Object.fromEntries(Object.entries(weeks).map(([t, s]) => [t, s.size]));
  return { P, teamTgt, teamG };
}

// data = { prev: parse(last season), cur: parse(this season), rookies: Set of player ids }
function grade(name, data) {
  const n = norm(name), cur = data.cur.P[n], prev = data.prev.P[n];
  const id = cur?.id || prev?.id;
  if (id && data.rookies.has(id)) {
    const early = cur?.early.length ? cur.early.reduce((a, b) => a + b, 0) / cur.early.length : null;
    const g = rookieGrade(early);
    return {
      name: cur?.name || name, type: 'rookie', grade: g?.band ?? null, top24: g?.top24 ?? null, top12: g?.top12 ?? null,
      share: early === null ? null : +(early * 100).toFixed(1),
      note: g ? `weeks 1-${EARLY_WK} target share; ${g.n} past rookies in this band` : `no weeks 1-${EARLY_WK} games yet — no grade`,
    };
  }
  // No qualifying prior season = no grade. Never D: that would read an injured-out year
  // or a missing row as a measured bad role.
  if (!prev || prev.g < MIN_G || !prev.team) {
    return { name: cur?.name || prev?.name || name, type: 'veteran', grade: null, top24: null, share: null, note: `no ${MIN_G}+ game prior season — no grade` };
  }
  const s = shareOf(prev, data.prev.teamTgt, data.prev.teamG), g = vetGrade(s);
  return {
    name: prev.name, type: 'veteran', grade: g.band, top24: g.top24, share: +(s * 100).toFixed(1),
    note: `last season ${prev.g}g ${prev.tgt} tgt (${prev.team})${cur?.team && cur.team !== prev.team ? `, now ${cur.team} — team change, read with caution` : ''}`,
  };
}

const REL = 'https://github.com/nflverse/nflverse-data/releases/download';
async function download(tag, file, cacheRead) {
  const p = path.join(CACHE, file);
  if (cacheRead) { try { return fs.readFileSync(p, 'utf8'); } catch { } }
  const r = await fetch(`${REL}/${tag}/${file}`, { signal: AbortSignal.timeout(180000) });
  if (!r.ok) return null;   // e.g. a season with no file published yet
  const t = await r.text();
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(p, t);
  return t;
}

async function load(season) {
  // A finished season never changes, so its cache is safe. The current season and
  // players.csv are rewritten weekly — never read those from cache.
  const prevText = await download('stats_player', `stats_player_week_${season - 1}.csv`, true);
  if (!prevText) throw new Error(`no nflverse file for ${season - 1}`);
  const curText = await download('stats_player', `stats_player_week_${season}.csv`, false);
  const playersText = await download('players', 'players.csv', false);
  const rookies = new Set();
  if (playersText) {
    const lines = playersText.split('\n'), ix = {};
    csvSplit(lines[0]).forEach((c, i) => ix[c] = i);
    for (let i = 1; i < lines.length; i++) {
      const f = csvSplit(lines[i]);
      if (+f[ix.rookie_season] === season) rookies.add(f[ix.gsis_id]);
    }
  }
  return { prev: parse(prevText), cur: curText ? parse(curText) : { P: {} }, rookies, hasPlayers: !!playersText };
}

function selftest() {
  const a = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('  ok  ' + m); };
  a(typeof grade === 'function', 'grade() exists');
  const teamTgt = { NYG: 500 }, teamG = { NYG: 17 };
  a(vetGrade(shareOf({ tgt: 35, g: 4, team: 'NYG' }, teamTgt, teamG)).band === 'A', 'injured elite role grades A');
  a(vetGrade(35 / 500).band === 'D', 'season-total share would bury him');
  a(rookieGrade(0.20).band === '18-25%', 'rookie 20% early share lands in 18-25%');
  a(rookieGrade(null) === null, 'rookie with no early games gets no grade');
  const csv = 'player_id,player_display_name,position,team,season_type,week,targets,target_share\n1,A,WR,X,REG,1,10,0.3\n1,A,WR,X,POST,19,10,0.3\n';
  a(parse(csv).P.a.g === 1, 'playoff rows are dropped');
  const r = grade('nobody', { prev: { P: {}, teamTgt: {}, teamG: {} }, cur: { P: {} }, rookies: new Set() });
  a(r.grade === null, 'no prior season and not a rookie = no grade, never D');
  const rk = grade('A', { prev: { P: {}, teamTgt: {}, teamG: {} }, cur: parse(csv), rookies: new Set(['1']) });
  a(rk.type === 'rookie' && rk.grade === '25%+', 'rookie is graded on early share, not prior season');
  console.log('selftest passed');
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--selftest')) return selftest();
  const opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const now = new Date();
  // Jan-Feb still belongs to last season's NFL year.
  const season = +(opt('--season') || process.env.SEASON || (now.getMonth() >= 2 ? now.getFullYear() : now.getFullYear() - 1));
  const names = args.filter((a, i) => !a.startsWith('--') && !['--season', '--top'].includes(args[i - 1]));

  const data = await load(season);
  if (!data.hasPlayers) console.error('WARNING: players.csv unavailable — rookies cannot be identified, all graded as veterans');
  let rows;
  if (names.length) rows = names.map(n => grade(n, data));
  else {
    const all = new Set([...Object.keys(data.prev.P), ...Object.keys(data.cur.P)]);
    rows = [...all].map(n => grade(n, data)).filter(r => r.grade)
      .sort((x, y) => (y.top24 - x.top24) || (y.share - x.share)).slice(0, +(opt('--top') || 40));
  }
  if (args.includes('--json')) return console.log(JSON.stringify({ season, rows }, null, 2));
  console.log(`WR screen, ${season} season (top-24 PPR odds)\n`);
  for (const r of rows) {
    const g = r.grade ? `${r.grade.padEnd(6)} ${String(r.top24).padStart(5)}%` : 'none         ';
    console.log(`${g}  ${String(r.share ?? '-').padStart(5)}%  ${r.type.padEnd(7)}  ${r.name.padEnd(24)} ${r.note}`);
  }
}

module.exports = { shareOf, vetGrade, rookieGrade, parse, grade, norm };
if (require.main === module) main().catch(e => { console.error(e.message); process.exit(1); });
