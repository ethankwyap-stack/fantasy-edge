#!/usr/bin/env node
// Rookie WR -> WR1 study. Free, local, nflverse only, no key.
//
// QUESTION: how often does a rookie WR finish as a fantasy WR1, and what did the
// hits have in common?
//
// WR1 = top 12 WR by SEASON-TOTAL PPR that year (Ethan's call). WR2 = top 24.
// Ranked against every WR in the NFL that season, not a 12-team league slice.
//
// Two rules copied from the rest of this repo:
//   - Absence casts no vote. A player with no rookie_season in players.csv is
//     reported in `unknownRookieYear`, never counted as a miss.
//   - Opportunity is separate from outcome. A rookie who never got targets never
//     had a shot at WR1, so the headline rate is reported twice: over ALL rookie
//     WRs who played, and over the ones who actually earned a role early
//     (EARLY_SHARE of team targets through week EARLY_WK).
//
// Usage: node scripts/rookie-wr.js [--selftest]   env: SEASONS=2016-2025
const fs = require('fs');
const path = require('path');
const { csvSplit } = require('./boom-rates');

const ROOT = path.join(__dirname, '..');
const CACHE = path.join(ROOT, '.nflverse-cache');
const OUT = path.join(ROOT, 'rookie-wr.json');
const WR1 = 12, WR2 = 24;
const EARLY_WK = 4, EARLY_SHARE = 0.18; // ~a clear top-2 target on most teams
const MIN_G = 4;                        // under 4 games there is no season to rank

// Fantasy ADP, not NFL draft capital. THE question is "what did it cost me on draft
// day", and NFL round is a bad proxy for that (Puka Nacua went NFL round 5 but was a
// known name by September). Fantasy Football Calculator's public API is free, keyless,
// PPR, 12-team, and goes back past 2016. It publishes 15 rounds (~180 picks); a rookie
// who is NOT in that list was genuinely undrafted in a normal 12-team PPR league.
const ADP_URL = yr => `https://fantasyfootballcalculator.com/api/v1/adp/ppr?teams=12&year=${yr}`;
const ADP_ROUNDS = 15, TEAMS = 12;

const [Y0, Y1] = (process.env.SEASONS || '2016-2025').split('-').map(Number);
const SEASONS = Array.from({ length: Y1 - Y0 + 1 }, (_, i) => Y0 + i);

const url = (tag, file) => `https://github.com/nflverse/nflverse-data/releases/download/${tag}/${file}`;

// Every season here is FINISHED, so a cached file can never go stale — unlike
// boom-rates.js's in-progress-season rule. Still guard it: never cache-read a
// season that has not ended.
async function csv(tag, file, cacheable = true) {
  const p = path.join(CACHE, file);
  if (cacheable) { try { return fs.readFileSync(p, 'utf8'); } catch { } }
  const r = await fetch(url(tag, file), { signal: AbortSignal.timeout(180000) });
  if (!r.ok) throw new Error(`${file}: HTTP ${r.status}`);
  const t = await r.text();
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(p, t);
  return t;
}

function parse(text, keep) {
  const lines = text.split('\n'), ix = {};
  csvSplit(lines[0]).forEach((c, i) => ix[c] = i);
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const f = csvSplit(lines[i]);
    const row = keep(f, ix);
    if (row) out.push(row);
  }
  return out;
}

// Name key shared by both sources. Suffixes and punctuation are the only real traps
// (D.K. Metcalf / DK Metcalf, Brian Thomas Jr.).
const norm = n => (n || '').toLowerCase().replace(/[.'`-]/g, '').replace(/\s+(jr|sr|ii|iii|iv|v)$/, '').replace(/\s+/g, ' ').trim();

const num = v => { const n = +v; return Number.isFinite(n) ? n : 0; };
const r3 = n => Math.round(n * 1000) / 1000;
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;

// --- the analysis, pure so --selftest can drive it ------------------------------
// games: [{id,name,season,week,pts,targets,target_share}], rookies: Map id -> {rookie_season,draft_pick,...}
// adp: { season -> { normName -> adp } }. A rookie missing from a season's list is
// UNDRAFTED, which is a real fact here — unlike the absence rules elsewhere in this
// repo, because the ADP list is complete by construction (it IS the whole draft board).
function study(games, players, adp = {}) {
  const seasons = {}, hits = [], all = [];
  for (const g of games) (seasons[g.season] ||= []).push(g);

  for (const yr of Object.keys(seasons).map(Number).sort()) {
    const byPlayer = {};
    for (const g of seasons[yr]) (byPlayer[g.id] ||= []).push(g);

    const totals = Object.entries(byPlayer)
      .map(([id, gs]) => ({ id, name: gs[0].name, pts: gs.reduce((a, g) => a + g.pts, 0), g: gs.length, gs }))
      .sort((a, b) => b.pts - a.pts);
    totals.forEach((t, i) => t.rank = i + 1);

    for (const t of totals) {
      const p = players[t.id];
      if (!p || !p.rookie_season) continue;      // absence casts no vote
      if (p.rookie_season !== yr) continue;
      if (t.g < MIN_G) continue;
      const early = t.gs.filter(g => g.week <= EARLY_WK).map(g => g.target_share).filter(x => x > 0);
      const rec = {
        name: t.name, season: yr, rank: t.rank, ppr: Math.round(t.pts * 10) / 10, games: t.g,
        draftRound: p.draft_round || null, draftPick: p.draft_pick || null,
        targets: t.gs.reduce((a, g) => a + g.targets, 0),
        targetShare: r3(mean(t.gs.map(g => g.target_share)) || 0),
        earlyTargetShare: early.length ? r3(mean(early)) : null,
        wr1: t.rank <= WR1, wr2: t.rank <= WR2,
      };
      const a = (adp[yr] || {})[norm(t.name)];
      rec.adp = a || null;
      rec.adpRound = a ? Math.min(ADP_ROUNDS, Math.ceil(a / TEAMS)) : null;
      rec.fantasyUndrafted = !a;
      // Early role is unknown, not false, if he played no games in weeks 1-4.
      rec.earlyRole = rec.earlyTargetShare === null ? null : rec.earlyTargetShare >= EARLY_SHARE;
      all.push(rec);
      if (rec.wr1) hits.push(rec);
    }
  }

  const bucket = (rows, key) => {
    const b = {};
    for (const r of rows) { const k = key(r); if (k === null) continue; (b[k] ||= { n: 0, wr1: 0, wr2: 0 }); b[k].n++; if (r.wr1) b[k].wr1++; if (r.wr2) b[k].wr2++; }
    for (const k in b) { b[k].wr1Rate = r3(b[k].wr1 / b[k].n); b[k].wr2Rate = r3(b[k].wr2 / b[k].n); }
    return b;
  };
  const withRole = all.filter(r => r.earlyRole === true);

  return {
    seasons: `${Math.min(...Object.keys(seasons))}-${Math.max(...Object.keys(seasons))}`,
    rookieWRs: all.length,
    wr1: hits.length, wr1Rate: r3(hits.length / all.length),
    wr2: all.filter(r => r.wr2).length, wr2Rate: r3(all.filter(r => r.wr2).length / all.length),
    perSeason: bucket(all, r => r.season),
    // The number that actually matters: of rookies who WON a role early, how many hit.
    earnedRoleEarly: {
      n: withRole.length,
      wr1: withRole.filter(r => r.wr1).length, wr1Rate: withRole.length ? r3(withRole.filter(r => r.wr1).length / withRole.length) : null,
      wr2: withRole.filter(r => r.wr2).length, wr2Rate: withRole.length ? r3(withRole.filter(r => r.wr2).length / withRole.length) : null,
    },
    byDraftRound: bucket(all, r => r.draftRound ? (r.draftRound === 1 ? '1' : r.draftRound === 2 ? '2' : r.draftRound <= 4 ? '3-4' : '5+') : 'undrafted'),
    // The bucket Ethan actually drafts from. 'undrafted' = outside 15 rounds of 12-team PPR.
    byFantasyRound: bucket(all, r => r.fantasyUndrafted ? 'undrafted' : r.adpRound <= 3 ? 'rd 1-3' : r.adpRound <= 6 ? 'rd 4-6' : r.adpRound <= 10 ? 'rd 7-10' : 'rd 11-15'),
    lateOrUndrafted: (() => {
      const late = all.filter(r => r.fantasyUndrafted || r.adpRound > 10);
      return { n: late.length, wr1: late.filter(r => r.wr1).length, wr2: late.filter(r => r.wr2).length, hits: late.filter(r => r.wr2) };
    })(),
    byEarlyShare: bucket(all, r => r.earlyTargetShare === null ? null : r.earlyTargetShare >= 0.25 ? '25%+' : r.earlyTargetShare >= EARLY_SHARE ? '18-25%' : r.earlyTargetShare >= 0.12 ? '12-18%' : '<12%'),
    hits: hits.sort((a, b) => a.season - b.season || a.rank - b.rank),
    // Top-24 finishers, WR1s included — the wider, more useful net for a 12-team league.
    hitsWR2: all.filter(r => r.wr2).sort((a, b) => a.season - b.season || a.rank - b.rank),
    all,
  };
}

// --- selftest -------------------------------------------------------------------
function selftest() {
  const mk = (id, season, week, pts, ts) => ({ id, name: id, season, week, pts, targets: 8, target_share: ts });
  const games = [];
  for (let w = 1; w <= 17; w++) {
    games.push(mk('star', 2020, w, 20, 0.30));   // rookie, huge
    games.push(mk('quiet', 2020, w, 2, 0.05));   // rookie, no role
    games.push(mk('vet', 2020, w, 15, 0.25));    // not a rookie
    // 12 filler vets so the top-12 line actually sits above 'quiet'
    for (let i = 0; i < 12; i++) games.push(mk('filler' + i, 2020, w, 10, 0.15));
  }
  games.push(mk('cameo', 2020, 1, 30, 0.4));     // 1 game — must not be ranked
  const players = {
    star: { rookie_season: 2020, draft_round: 1, draft_pick: 5 },
    quiet: { rookie_season: 2020, draft_round: 6, draft_pick: 200 },
    vet: { rookie_season: 2016, draft_round: 1, draft_pick: 3 },
    cameo: { rookie_season: 2020, draft_round: 3, draft_pick: 90 },
    ghost: { rookie_season: null },
    ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => ['filler' + i, { rookie_season: 2010 }])),
  };
  const s = study(games, players, { 2020: { star: 40 } });   // star = ADP 40 -> round 4; quiet absent -> undrafted
  const a = (c, m) => { if (!c) throw new Error('SELFTEST FAIL: ' + m); console.log('  ok: ' + m); };
  a(s.rookieWRs === 2, 'MIN_G drops the 1-game cameo; vet is not a rookie');
  a(s.wr1 === 1 && s.hits[0].name === 'star', 'top-12 finish is the WR1 flag');
  a(s.earnedRoleEarly.n === 1 && s.earnedRoleEarly.wr1Rate === 1 && s.earnedRoleEarly.wr2Rate === 1, 'early-role split counts only the rookie who won a role, for WR1 and WR2');
  a(s.hitsWR2.length === s.wr2 && s.hitsWR2.some(r => r.name === 'star'), 'WR2 list includes the WR1s');
  a(s.all.find(r => r.name === 'quiet').earlyRole === false, 'low early share is a real false, not null');
  a(s.all.find(r => r.name === 'star').adpRound === 4, 'ADP maps to a 12-team fantasy round');
  a(s.all.find(r => r.name === 'quiet').fantasyUndrafted === true, 'missing from the ADP list means fantasy-undrafted');
  a(!s.all.some(r => r.name === 'ghost'), 'unknown rookie_season casts no vote');
  console.log('selftest passed');
}

async function main() {
  if (process.argv.includes('--selftest')) return selftest();

  console.log('players.csv ...');
  const players = {};
  let unknown = 0;
  parse(await csv('players', 'players.csv', false), (f, ix) => {
    const id = f[ix.gsis_id]; if (!id) return null;
    players[id] = {
      rookie_season: num(f[ix.rookie_season]) || null,
      draft_round: num(f[ix.draft_round]) || null,
      draft_pick: num(f[ix.draft_pick]) || null,
      draft_team: f[ix.draft_team] || null,
    };
    if (!players[id].rookie_season) unknown++;
    return null;
  });
  console.log(`  ${Object.keys(players).length} players, ${unknown} with no rookie_season`);

  const games = [];
  for (const yr of SEASONS) {
    process.stdout.write(`weekly ${yr} ... `);
    const text = await csv('stats_player', `stats_player_week_${yr}.csv`);
    const rows = parse(text, (f, ix) => {
      if (f[ix.season_type] !== 'REG') return null;   // playoff weeks contaminate rates
      if (f[ix.position] !== 'WR') return null;
      const id = f[ix.player_id]; if (!id) return null;
      return {
        id, name: f[ix.player_display_name], season: num(f[ix.season]), week: num(f[ix.week]),
        pts: num(f[ix.fantasy_points_ppr]), targets: num(f[ix.targets]),
        target_share: num(f[ix.target_share]), team: f[ix.team],
      };
    });
    games.push(...rows);
    console.log(`${rows.length} WR games`);
  }

  const adp = {};
  for (const yr of SEASONS) {
    const f = path.join(CACHE, `adp_ppr_12_${yr}.json`);
    let j;
    try { j = JSON.parse(fs.readFileSync(f, 'utf8')); }
    catch {
      const r = await fetch(ADP_URL(yr), { signal: AbortSignal.timeout(60000) });
      if (!r.ok) throw new Error(`ADP ${yr}: HTTP ${r.status}`);
      j = await r.json();
      fs.writeFileSync(f, JSON.stringify(j));
    }
    adp[yr] = Object.fromEntries(j.players.map(p => [norm(p.name), p.adp]));
    console.log(`adp ${yr}: ${j.players.length} players (${j.meta.total_drafts} drafts)`);
  }

  const res = study(games, players, adp);
  res.generated = new Date().toISOString();
  res.method = `WR1 = top ${WR1} WR by season PPR total, NFL-wide. Rookie = players.csv rookie_season. Min ${MIN_G} games. Early role = mean target share >= ${EARLY_SHARE} in weeks 1-${EARLY_WK}.`;
  fs.writeFileSync(OUT, JSON.stringify(res, null, 2));

  console.log(`\n${res.seasons}: ${res.wr1}/${res.rookieWRs} rookie WRs finished WR1 (${(res.wr1Rate * 100).toFixed(1)}%), WR2 ${(res.wr2Rate * 100).toFixed(1)}%`);
  console.log(`won a role by week ${EARLY_WK}: WR1 ${res.earnedRoleEarly.wr1}/${res.earnedRoleEarly.n} (${(res.earnedRoleEarly.wr1Rate * 100).toFixed(1)}%), WR2 ${res.earnedRoleEarly.wr2}/${res.earnedRoleEarly.n} (${(res.earnedRoleEarly.wr2Rate * 100).toFixed(1)}%)`);
  console.log('\nby draft round:'); console.table(res.byDraftRound);
  console.log('by FANTASY draft round (12-team PPR ADP):'); console.table(res.byFantasyRound);
  console.log(`round 11+ or undrafted: ${res.lateOrUndrafted.wr2}/${res.lateOrUndrafted.n} hit WR2, ${res.lateOrUndrafted.wr1} hit WR1`);
  console.table(res.lateOrUndrafted.hits.map(h => ({ season: h.season, name: h.name, rank: h.rank, adp: h.adp, adpRd: h.adpRound, early: h.earlyTargetShare })));
  console.log('by early target share:'); console.table(res.byEarlyShare);
  console.log('\nWR2 hits (top 24, WR1s included):'); console.table(res.hitsWR2.map(h => ({ season: h.season, name: h.name, rank: h.rank, ppr: h.ppr, nflRd: h.draftRound, adp: h.adp, adpRd: h.adpRound, early: h.earlyTargetShare })));
  console.log('\nWR1 hits:'); console.table(res.hits.map(h => ({ season: h.season, name: h.name, rank: h.rank, ppr: h.ppr, pick: h.draftPick, tgtShare: h.targetShare, early: h.earlyTargetShare })));
  console.log(`\nwrote ${path.relative(ROOT, OUT)}`);
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { study };
