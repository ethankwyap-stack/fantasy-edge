#!/usr/bin/env node
// Veteran WR screen — free, local, no key. Answers "how likely is this non-rookie WR to
// finish top-24 PPR?" from ONE input: his prior-season target share.
//
// WHY this exists separately from rookie-wr.js: a rookie has no history, so that study
// had to proxy his role from the outside (who else is in the WR room, how much the team
// throws). Backtested here on 1,266 veteran WR-seasons, those proxies add nothing on top
// of the veteran's own prior share — and at the top band they run backwards, because a
// true alpha is not hurt by good teammates. So for a veteran: read his share and stop.
//
// **Share MUST be per-GAME**, never a season total. A season total silently punishes
// missed games and inverts the read on exactly the players worth buying: Malik Nabers'
// 2025 is 7.0% season-total (bottom band) and 29.6% per-game (top band). Same family as
// the appliedStatTotal / statSplitTypeId traps — one number, several aggregations, and
// nothing errors when you take the wrong one. --selftest asserts it.
//
// Usage:
//   node scripts/vet-wr.js --backtest            # rebuild the bands from 2017-YEAR
//   node --env-file=.env scripts/vet-wr.js       # grade this league's WRs + free agents
//   node scripts/vet-wr.js --selftest            # no network, no cost
const fs = require('fs');
const path = require('path');
const { csvSplit } = require('./boom-rates.js');

const ROOT = path.join(__dirname, '..');
const CACHE = path.join(ROOT, '.nflverse-cache');
const OUT = path.join(ROOT, 'vet-wr.json');
const SEASON = +(process.env.SEASON || 2026);
const [Y0, Y1] = (process.env.SEASONS || `2016-${SEASON - 1}`).split('-').map(Number);
const MIN_G = 4;      // under 4 games a share is arithmetic, not signal (same as boom-rates)
const WR2 = 24;       // top-24 is the honest target; WR1 is too rare to plan around
const GAMES = 17;     // NFL regular season, used to put team targets on a per-game footing

// Bands measured by --backtest on 2017-2025. Kept as a constant so the live screen works
// offline and so a change to them is a visible diff, not a silent re-fit.
const BANDS = [
  [0.25, 'A', 58.2, 158],
  [0.20, 'B', 29.5, 190],
  [0.15, 'C', 15.4, 227],
  [0.00, 'D', 1.9, 691],
];
const band = s => BANDS.find(b => s >= b[0]);

// nflverse keeps the suffix, Sleeper drops it. Same join trap as boom-rates.js's NICK map.
const norm = n => (n || '').toLowerCase().replace(/[.'`-]/g, '')
  .replace(/\s+(jr|sr|ii|iii|iv|v)$/, '').replace(/\s+/g, ' ').trim();

const URL = yr => `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${yr}.csv`;

// Same cache rule as boom-rates.js: a finished season's file never changes, the in-progress
// one is rewritten weekly, so never READ the cache for the current season.
async function raw(yr) {
  const file = path.join(CACHE, `stats_player_week_${yr}.csv`);
  if (yr !== SEASON) { try { return fs.readFileSync(file, 'utf8'); } catch { } }
  const r = await fetch(URL(yr), { signal: AbortSignal.timeout(120000) });
  if (!r.ok) return null;
  const text = await r.text();
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(file, text);
  return text;
}

// One season -> per-player targets/games/team, per-team target and attempt totals, and the
// set of WRs who finished inside the top-24 that year.
function parse(text) {
  const lines = text.split('\n');
  const ix = {}; csvSplit(lines[0]).forEach((c, i) => ix[c] = i);
  const P = {}, teamTgt = {}, teamAtt = {};
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const f = csvSplit(lines[i]);
    if (f[ix.season_type] !== 'REG') continue;   // playoff rows would contaminate the rates
    const team = f[ix.team], tgt = +f[ix.targets] || 0;
    if (team) {
      teamTgt[team] = (teamTgt[team] || 0) + tgt;
      teamAtt[team] = (teamAtt[team] || 0) + (+f[ix.attempts] || 0);
    }
    const pos = f[ix.position];
    if (!['WR', 'TE', 'RB'].includes(pos)) continue;   // team target denominator needs all three
    const n = norm(f[ix.player_display_name]);
    if (!n) continue;
    const p = P[n] ||= { pos, tgt: 0, pts: 0, g: 0, teams: {} };
    p.tgt += tgt; p.pts += +f[ix.fantasy_points_ppr] || 0; p.g++;
    if (team) p.teams[team] = (p.teams[team] || 0) + 1;
  }
  for (const p of Object.values(P)) p.team = Object.entries(p.teams).sort((a, b) => b[1] - a[1])[0]?.[0];
  const rank = {};
  Object.entries(teamAtt).sort((a, b) => b[1] - a[1]).forEach(([t], i) => rank[t] = i + 1);
  const hits = new Set(Object.entries(P)
    .filter(([, p]) => p.pos === 'WR' && p.g >= MIN_G)
    .sort((a, b) => b[1].pts - a[1].pts).slice(0, WR2).map(([n]) => n));
  return { P, teamTgt, rank, hits };
}

// THE metric. Per-game, both sides. A season total on either side is the bug this guards.
const shareOf = (p, teamTgt) => (p.tgt / p.g) / ((teamTgt[p.team] || 1) / GAMES);

// Backtest: for every WR-season Y with a >=MIN_G season in Y-1, does prior share predict
// a top-24 finish? Also re-checks the two rookie-study proxies for whether they add lift.
function backtest(years) {
  const rows = [];
  for (const y of Object.keys(years).map(Number).sort()) {
    const cur = years[y], prev = years[y - 1];
    if (!cur || !prev) continue;
    for (const [n, p] of Object.entries(cur.P)) {
      if (p.pos !== 'WR' || p.g < MIN_G || !p.team) continue;
      const pr = prev.P[n];
      if (!pr || pr.g < MIN_G || !pr.team) continue;   // rookie or absent: casts no vote
      let room = 0;
      for (const [m, q] of Object.entries(cur.P)) {
        if (m === n || q.team !== p.team) continue;
        if ((prev.P[m]?.tgt || 0) >= 70) room++;
      }
      rows.push({
        name: n, season: y, priorShare: shareOf(pr, prev.teamTgt), room,
        paRank: prev.rank[p.team] || 99, moved: pr.team !== p.team, hit: cur.hits.has(n),
      });
    }
  }
  const rate = r => r.length ? +(100 * r.filter(x => x.hit).length / r.length).toFixed(1) : null;
  const bands = BANDS.map(([lo, g], i) => {
    const hi = i ? BANDS[i - 1][0] : Infinity;
    const b = rows.filter(r => r.priorShare >= lo && r.priorShare < hi);
    return {
      grade: g, min: lo, n: b.length, wr2Rate: rate(b),
      // the two rookie-study proxies, re-measured inside each band
      roomClean: rate(b.filter(r => r.room <= 1)), roomCrowded: rate(b.filter(r => r.room >= 2)),
      highVolume: rate(b.filter(r => r.paRank <= 16)), lowVolume: rate(b.filter(r => r.paRank > 16)),
    };
  });
  return {
    n: rows.length, hits: rows.filter(r => r.hit).length, bands,
    moved: { n: rows.filter(r => r.moved).length, wr2Rate: rate(rows.filter(r => r.moved)) },
    stayed: { wr2Rate: rate(rows.filter(r => !r.moved)) },
    note: 'moved is confounded — the WRs who get released are the bad ones. Caution flag, not a mechanism.',
  };
}

async function espn(views) {
  const { LEAGUE_ID, ESPN_S2, SWID } = process.env;
  if (!LEAGUE_ID) return null;
  const qs = views.map(v => `view=${v}`).join('&');   // repeated &view=, never comma-joined
  const r = await fetch(`https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${SEASON}/segments/0/leagues/${LEAGUE_ID}?${qs}`,
    { headers: { Cookie: `SWID=${SWID}; espn_s2=${ESPN_S2}` } });
  if (!r.ok) throw new Error(`ESPN ${r.status} — cookies may have expired`);
  return r.json();
}

// Grade every rostered + free-agent veteran WR off last season's per-game share.
async function live(prev) {
  const lg = await espn(['mTeam', 'mRoster']);
  if (!lg) return null;
  const sl = await (await fetch('https://api.sleeper.app/v1/players/nfl')).json();
  const owner = {};
  for (const t of lg.teams) for (const e of (t.roster?.entries || [])) owner[norm(e.playerPoolEntry.player.fullName)] = t.id;

  const rows = [];
  for (const sp of Object.values(sl)) {
    if (sp.position !== 'WR' || !sp.full_name || !sp.team || sp.years_exp === 0) continue;
    const n = norm(sp.full_name), p = prev.P[n];
    // No qualifying prior season = no vote. Never graded D — that would read a rookie or an
    // injured-out year as a measured bad role.
    if (!p || p.g < MIN_G) continue;
    const share = shareOf(p, prev.teamTgt);
    const [, grade, wr2Rate] = band(share);
    rows.push({
      name: sp.full_name, grade, wr2Rate, share: +(share * 100).toFixed(1),
      games: p.g, targets: p.tgt, nflTeam: sp.team, priorNflTeam: p.team,
      moved: sp.team !== p.team, ownedBy: owner[n] ?? null,
    });
  }
  rows.sort((a, b) => b.share - a.share);
  const teams = Object.fromEntries(lg.teams.map(t => [t.id, t.name || String(t.id)]));
  return { teams, rows };
}

function selftest() {
  const a = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('  ok  ' + m); };

  // The whole point of the file: per-game, not season-total.
  // Nabers' real 2025: 35 targets in 4 games on a ~500-target offense.
  const teamTgt = { NYG: 500 };                           // ~29.4 team targets per game
  const hurt = { tgt: 35, g: 4, team: 'NYG' };            // elite role, 4 games
  const meh = { tgt: 80, g: 17, team: 'NYG' };            // ordinary role, full season
  a(band(shareOf(hurt, teamTgt))[1] === 'A', 'injured elite role grades A, not D');
  a(band(hurt.tgt / teamTgt.NYG)[1] === 'D', 'season-total share would have buried him — the bug this guards');
  a(band(shareOf(meh, teamTgt))[1] === 'C', 'ordinary full season grades C');
  a(shareOf(hurt, teamTgt) > shareOf(meh, teamTgt), 'missed games never lower the per-game share');

  // Backtest wiring: MIN_G, the absence rule, and the top-24 line.
  const mk = (tgt, g, pts) => ({ pos: 'WR', tgt, pts, g, team: 'AA', teams: { AA: g } });
  const season = extra => ({
    P: { alpha: mk(150, 17, 300), thin: mk(20, 2, 10), ...extra },
    teamTgt: { AA: 500 }, rank: { AA: 1 }, hits: new Set(['alpha']),
  });
  const bt = backtest({ 2024: season({}), 2025: season({ rook: mk(120, 17, 250) }) });
  a(bt.n === 1, `only alpha votes — thin (<${MIN_G}g) and no-prior-season players are excluded`);
  a(bt.hits === 1 && bt.bands.find(b => b.grade === 'A').n === 1, 'alpha lands in the A band and counts as a hit');

  console.log('selftest passed');
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--selftest')) return selftest();

  const years = {};
  for (let y = Y0; y <= Y1; y++) {
    const text = await raw(y);
    if (text) years[y] = parse(text);
  }
  const seasons = Object.keys(years);
  if (!seasons.length) throw new Error('no nflverse seasons available');
  console.log(`seasons loaded: ${seasons.join(', ')}`);

  const out = { generated: new Date().toISOString(), method: `WR2 = top ${WR2} PPR. Share is PER-GAME. Min ${MIN_G} games.` };

  if (args.includes('--backtest') || !process.env.LEAGUE_ID) {
    out.backtest = backtest(years);
    console.log(`\nbacktest: ${out.backtest.n} veteran WR-seasons, ${out.backtest.hits} top-${WR2} hits`);
    for (const b of out.backtest.bands) {
      console.log(`  ${b.grade} share>=${(b.min * 100).toFixed(0)}%  n=${String(b.n).padStart(4)}  WR2 ${String(b.wr2Rate).padStart(5)}%   room clean/crowded ${b.roomClean}/${b.roomCrowded}   volume hi/lo ${b.highVolume}/${b.lowVolume}`);
    }
    console.log(`  moved teams: ${out.backtest.moved.wr2Rate}% (n=${out.backtest.moved.n}) vs stayed ${out.backtest.stayed.wr2Rate}%`);
  }

  const l = await live(years[Y1]);
  if (l) {
    out.live = l;
    const g = r => `${r.grade} ${String(r.share).padStart(5)}% ${String(r.wr2Rate).padStart(5)}%  ${r.name.padEnd(22)} ${r.priorNflTeam}${r.moved ? '->' + r.nflTeam : ''}  ${r.games}g ${r.targets}tgt`;
    const mine = process.env.MY_TEAM_ID || '1';
    console.log(`\n=== your WRs (team ${mine}) ===`);
    l.rows.filter(r => String(r.ownedBy) === mine).forEach(r => console.log('  ' + g(r)));
    console.log('\n=== best free agents ===');
    l.rows.filter(r => r.ownedBy === null).slice(0, 12).forEach(r => console.log('  ' + g(r)));
    console.log('\n=== A/B grades on other rosters (trade targets) ===');
    l.rows.filter(r => r.ownedBy !== null && String(r.ownedBy) !== mine && 'AB'.includes(r.grade))
      .forEach(r => console.log(`  ${g(r)}  [${l.teams[r.ownedBy]}]`));
  } else {
    console.log('\n(no LEAGUE_ID — backtest only. Run with `node --env-file=.env` for the live screen.)');
  }

  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log(`\nwrote ${path.relative(ROOT, OUT)}`);
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { shareOf, band, backtest, parse, norm, BANDS };
