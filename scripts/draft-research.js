// One-shot draft research (manual re-run via workflow_dispatch): gathers free data
// (ESPN current top 450 + 2024/2025 weekly actuals, Sleeper depth charts, NFL schedule,
//  expert-sleepers.json), batches ~20 players per position group to Claude,
// writes draft-analysis.json.
// Dry-runs without ANTHROPIC_API_KEY: all fetches + sample prompt, no Claude call.
const fs = require('fs');
const path = require('path');

const { LEAGUE_ID, ESPN_S2, SWID, SEASON = '2026' } = process.env;
const POS = { 1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'DST' };
const BADGES = ['split-touches', 'depth-risk', 'injury-history', 'rookie', 'new-team', 'easy-playoffs', 'tough-playoffs', 'breakout', 'decline-risk', 'workhorse', 'td-dependent', 'handcuff', 'elite', 'sleeper'];
const FFL = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl';
const OUT = path.join(__dirname, '..', 'draft-analysis.json');
// Expert sleeper consensus, refreshed by hand (see the file's own note). Missing file = no sleeper input, not an error.
const EXPERTS = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'expert-sleepers.json'), 'utf8')).players || {}; } catch { return {}; } })();

async function getJson(url, { filter, cookies } = {}) {
  const headers = {};
  if (cookies) headers.Cookie = `SWID=${SWID}; espn_s2=${ESPN_S2}`;
  if (filter) headers['X-Fantasy-Filter'] = JSON.stringify(filter);
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${res.status} on ${url}${res.status === 401 ? ' (cookies expired — re-grab from browser)' : ''}`);
  return res.json();
}

// Past-season weekly actuals via public leaguedefaults endpoint (no cookies needed)
async function pastSeason(yr) {
  const data = await getJson(`${FFL}/seasons/${yr}/segments/0/leaguedefaults/3?view=kona_player_info`, {
    filter: { players: { limit: 500, sortAppliedStatTotal: { sortPriority: 1, sortAsc: false, value: `00${yr}` }, filterStatsForTopScoringPeriodIds: { value: 18, additionalValue: [`00${yr}`] } } },
  });
  const byId = {};
  for (const x of data.players || []) byId[x.player.id] = x.player;
  return byId;
}

// One line per past season: games, total, PPG, weekly stdev, usage (stat ids 58/53/23),
// plus efficiency per opportunity (42=rec yds, 24=rush yds) — the Smyth axis ESPN volume alone misses.
function summarize(p, yr, pos) {
  if (!p) return null;
  const weeks = (p.stats || []).filter(s => s.statSourceId === 0 && s.statSplitTypeId === 1 && s.seasonId === yr && s.scoringPeriodId > 0);
  if (!weeks.length) return null;
  const pts = weeks.map(w => w.appliedTotal || 0);
  const total = pts.reduce((a, b) => a + b, 0);
  const gp = pts.length, ppg = total / gp;
  const stdev = Math.sqrt(pts.reduce((a, b) => a + (b - ppg) ** 2, 0) / gp);
  const sum = id => Math.round(weeks.reduce((a, w) => a + (+(w.stats?.[id]) || 0), 0));
  const tgt = sum('58'), rec = sum('53'), car = sum('23'), recYds = sum('42'), rushYds = sum('24');
  const eff = [];
  if (tgt) eff.push(`${(total / tgt).toFixed(2)}pts/tgt`, `${(recYds / tgt).toFixed(1)}yds/tgt`);
  if (car) eff.push(`${(rushYds / car).toFixed(1)}ypc`);
  if (pos !== 'QB' && car + rec) eff.push(`${(total / (car + rec)).toFixed(2)}pts/touch`);
  return `${gp}gp ${total.toFixed(0)}pts ${ppg.toFixed(1)}ppg wk-stdev ${stdev.toFixed(1)}, ${tgt}tgt/${rec}rec/${car}car`
    + (eff.length ? `; eff ${eff.join(', ')}` : '');
}

const seasonProj = p => { const s = (p.stats || []).find(s => s.statSourceId === 1 && s.seasonId === +SEASON && s.scoringPeriodId === 0); return s ? Math.round(s.appliedTotal) : 0; };

// ---- nflverse: real play-by-play-derived usage, free, no key ----
// Adds what ESPN's fantasy API does not expose: target share, air-yards share, WOPR, EPA.
// The current season's file appears once games are played, so this also works in-season.
const NFLVERSE = yr => `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${yr}.csv`;

// Minimal quote-aware CSV split — some columns hold comma-free lists but quoting still happens.
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

// Fetch + parse one nflverse CSV. Returns null (never throws) so a flaky GitHub
// download degrades the report instead of killing a $3 Claude run.
async function csvRows(url, label) {
  let text;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(120000) });
    if (!r.ok) return null; // season not started yet, or file not published
    text = await r.text();
  } catch (e) {
    console.warn(`  ${label} fetch failed (${e.message}) — continuing without it`);
    return null;
  }
  const lines = text.split('\n');
  const ix = {}; csvSplit(lines[0]).forEach((c, i) => ix[c] = i);
  const rows = [];
  for (let i = 1; i < lines.length; i++) if (lines[i]) rows.push(csvSplit(lines[i]));
  return { ix, rows };
}

// Run a per-year loader against the current season, then last season. Once games
// are played the current file appears and wins.
async function bySeason(fn) {
  for (const yr of [+SEASON, +SEASON - 1]) {
    const data = await fn(yr);
    if (data && Object.keys(data).length) return { data, yr };
  }
  return {};
}

async function nflverseUsage(yr) {
  const c = await csvRows(NFLVERSE(yr), `nflverse usage ${yr}`);
  if (!c) return null;
  const agg = {};
  for (const f of c.rows) {
    if (f[c.ix.season_type] !== 'REG') continue;
    const name = (f[c.ix.player_display_name] || '').toLowerCase();
    if (!name) continue;
    const n = k => +f[c.ix[k]] || 0;
    const a = agg[name] ||= { g: 0, tgtShare: 0, ayShare: 0, wopr: 0, recEpa: 0, rushEpa: 0, passEpa: 0, fd: 0, cpoe: 0, cpoeG: 0, tgt: 0, airYds: 0 };
    a.g++;
    a.tgtShare += n('target_share'); a.ayShare += n('air_yards_share'); a.wopr += n('wopr');
    a.recEpa += n('receiving_epa'); a.rushEpa += n('rushing_epa'); a.passEpa += n('passing_epa');
    a.fd += n('receiving_first_downs') + n('rushing_first_downs');
    a.tgt += n('targets'); a.airYds += n('receiving_air_yards');
    if (f[c.ix.passing_cpoe]) { a.cpoe += n('passing_cpoe'); a.cpoeG++; }
  }
  return agg;
}

// Offensive snap share — the free stand-in for routes run (PFF/FTN route data is paid).
// offense_pct is a 0-1 fraction in this file, verified against real rows.
async function snapShare(yr) {
  const c = await csvRows(`https://github.com/nflverse/nflverse-data/releases/download/snap_counts/snap_counts_${yr}.csv`, `snap counts ${yr}`);
  if (!c) return null;
  const agg = {};
  for (const f of c.rows) {
    if (f[c.ix.game_type] !== 'REG') continue;
    const name = (f[c.ix.player] || '').toLowerCase();
    if (!name) continue;
    const a = agg[name] ||= { g: 0, pct: 0 };
    a.g++; a.pct += +f[c.ix.offense_pct] || 0;
  }
  return agg;
}

// Yards before/after contact per rush — separates a back creating value from one riding his line.
// Weighted by carries, not an average of weekly averages.
async function rushContact(yr) {
  const c = await csvRows(`https://github.com/nflverse/nflverse-data/releases/download/pfr_advstats/advstats_week_rush_${yr}.csv`, `rush advstats ${yr}`);
  if (!c) return null;
  const agg = {};
  for (const f of c.rows) {
    if (f[c.ix.game_type] !== 'REG') continue;
    const name = (f[c.ix.pfr_player_name] || '').toLowerCase();
    if (!name) continue;
    const n = k => +f[c.ix[k]] || 0;
    const a = agg[name] ||= { car: 0, ybc: 0, yac: 0, broken: 0 };
    a.car += n('carries'); a.ybc += n('rushing_yards_before_contact'); a.yac += n('rushing_yards_after_contact');
    a.broken += n('rushing_broken_tackles');
  }
  return agg;
}

// ESPN's free public news feed, tagged with the athletes each story is about.
// Hard-capped at 50 articles upstream (limit= is ignored), so expect ~70 tagged
// players — camp/coaching-change context for the top of the board, not full coverage.
async function espnNews() {
  const byPlayer = {};
  try {
    const r = await fetch('https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?limit=50', { signal: AbortSignal.timeout(30000) });
    if (!r.ok) return byPlayer;
    for (const a of (await r.json()).articles || []) {
      if (!a.headline) continue;
      for (const c of a.categories || []) {
        if (c.type !== 'athlete') continue;
        const n = (c.description || c.athlete?.displayName || '').toLowerCase();
        if (n) (byPlayer[n] ||= []).push({ h: a.headline, d: (a.published || '').slice(0, 10), s: (a.description || '').slice(0, 160) });
      }
    }
  } catch (e) {
    console.warn(`  ESPN news fetch failed (${e.message}) — continuing without it`);
  }
  return byPlayer;
}

// One line of advanced usage; only the parts that mean something for the position.
function usageLine(pos, a, snap, rush) {
  const bits = [];
  if (a && a.g) {
    const per = v => (v / a.g).toFixed(2), pct = v => (v / a.g * 100).toFixed(1) + '%';
    bits.push(`${a.g}g`);
    if (pos === 'QB') {
      bits.push(`pass EPA/g ${per(a.passEpa)}`);
      if (a.cpoeG) bits.push(`CPOE ${(a.cpoe / a.cpoeG).toFixed(1)}`);
      if (a.rushEpa) bits.push(`rush EPA/g ${per(a.rushEpa)}`);
    } else {
      if (a.tgtShare) bits.push(`target share ${pct(a.tgtShare)}`, `air-yards share ${pct(a.ayShare)}`, `WOPR ${per(a.wopr)}`);
      if (a.tgt) bits.push(`aDOT ${(a.airYds / a.tgt).toFixed(1)}`);
      if (a.recEpa) bits.push(`rec EPA/g ${per(a.recEpa)}`);
      if (a.rushEpa) bits.push(`rush EPA/g ${per(a.rushEpa)}`);
      bits.push(`${a.fd} first downs`);
    }
  }
  if (snap && snap.g) bits.push(`snap share ${(snap.pct / snap.g * 100).toFixed(0)}% over ${snap.g}g`);
  if (rush && rush.car) bits.push(`${(rush.ybc / rush.car).toFixed(1)} yds before contact/rush`, `${(rush.yac / rush.car).toFixed(1)} after`, `${rush.broken} broken tackles`);
  return bits.length ? bits.join(', ') : null;
}

const SYSTEM = `You are an expert PPR fantasy football draft analyst preparing a rigorous 2026 draft board. It is pre-draft July 2026 — rosters are empty; past-season data is the substance, and your job is to interpret it for the FUTURE, not recite it. For each player you get: 2026 ESPN projection + ADP + overall draft rank, 2024/2025 weekly-derived actuals (games played, total points, PPG, weekly stdev, targets/receptions/carries), play-by-play-derived advanced usage where available (target share, air-yards share, WOPR, aDOT, EPA per game, CPOE for QBs, offensive snap share, and yards before/after contact per rush — weigh these heavily, they separate real opportunity from touchdown luck), depth-chart competition on their NFL team, recent ESPN news headlines for some players (late-July camp reports, coaching changes, injuries — treat a genuinely informative one as the freshest signal and let it override stale season-long data, but ignore generic league-wide roundups that say nothing specific about the player, and note most players have none — absence of news is not a negative), and playoff-week (15-17) opponents + bye. For EACH player return:
- tier: 1-8 within this position group; a new tier must mark a real dropoff in expected value, not equal slices
- verdict: one line, max 120 chars — why this player deserves this rank
- report: 3-5 sentences citing the data given: past usage/production trend interpreted forward, the ceiling case, the floor case, depth-chart/touch competition, and playoff schedule when notable
- floor and ceiling: season-total PPR points, roughly 15th and 85th percentile outcomes (weigh PPG, weekly variance, and games-missed risk)
- badges: only from the allowed list, only where the data clearly supports them

The "sleeper" badge is special. Apply it when a player is a genuine late-round value the field is underrating — his realistic ceiling clearly beats his ADP, usually because opportunity is opening up ahead of him, or because his per-opportunity efficiency is strong on limited volume. Some players arrive with an "expert sleeper call" line naming analysts who already flagged them; treat that as a strong signal and normally badge them, but you are the final judge — if the data given contradicts the call, skip the badge and say why in the report. You may also badge a sleeper no expert named if the usage data makes the case. Do NOT badge anyone drafted early: a sleeper must have an ADP outside roughly the top 100. When you badge a sleeper, the report must name the specific opening or efficiency edge and the round you would start taking him.

Frame every player on two axes before you rank them: VOLUME (target share, snap share, WOPR, carries, touches) and EFFICIENCY per opportunity (points per target, yards per target, points per touch, aDOT, yards after contact, EPA). Efficiency normally falls as volume rises, so the four quadrants mean different things: high volume + good efficiency is the safe, expensive profile; high volume + poor efficiency is a warning that the volume itself is at risk of being taken away; low volume + strong efficiency is the breakout candidate who only needs opportunity; low volume + poor efficiency is a fade. Name the player's quadrant explicitly in the report and let it drive the verdict, the floor, and the ceiling. Where a metric is missing for a player, say what you are inferring from instead rather than assuming the worst.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['players'],
  properties: {
    players: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'tier', 'verdict', 'report', 'floor', 'ceiling', 'badges'],
        properties: {
          name: { type: 'string', description: 'exact player name as given' },
          tier: { type: 'integer', description: '1-8 within position group' },
          verdict: { type: 'string', description: 'one line, max 120 chars' },
          report: { type: 'string' },
          floor: { type: 'number' },
          ceiling: { type: 'number' },
          badges: { type: 'array', items: { type: 'string', enum: BADGES } },
        },
      },
    },
  },
};

async function main() {
  console.log('Fetching current-season top 450 (own league, needs cookies)…');
  const pool = await getJson(`${FFL}/seasons/${SEASON}/segments/0/leagues/${LEAGUE_ID}?view=kona_player_info`, {
    cookies: true,
    filter: { players: { limit: 450, sortDraftRanks: { sortPriority: 1, sortAsc: true, value: 'PPR' } } },
  });
  const players = (pool.players || []).map(x => x.player).filter(p => POS[p.defaultPositionId]).slice(0, 450);
  console.log(`  ${players.length} players`);

  console.log('Fetching 2025 + 2024 weekly actuals (public)…');
  const [s2025, s2024] = await Promise.all([pastSeason(2025), pastSeason(2024)]);
  console.log(`  2025: ${Object.keys(s2025).length} players, 2024: ${Object.keys(s2024).length}`);

  console.log('Fetching nflverse advanced usage (target share / air yards / EPA / snaps / contact)…');
  const [adv, snaps, contact] = await Promise.all([bySeason(nflverseUsage), bySeason(snapShare), bySeason(rushContact)]);
  const { data: nvUsage, yr: usageYr } = adv;
  const count = (label, x) => console.log(x.data ? `  ${label} ${x.yr}: ${Object.keys(x.data).length} players` : `  ${label}: none available`);
  count('usage', adv); count('snaps', snaps); count('rush contact', contact);

  console.log('Fetching ESPN news headlines (free public feed)…');
  const news = await espnNews();
  console.log(`  ${Object.keys(news).length} players tagged in recent stories`);

  console.log('Fetching Sleeper depth charts…');
  const sleeper = await getJson('https://api.sleeper.app/v1/players/nfl');
  const sByName = {};
  for (const sp of Object.values(sleeper)) if (sp.full_name) sByName[sp.full_name.toLowerCase()] = sp;

  console.log('Fetching NFL schedule…');
  const sched = await getJson(`${FFL}/seasons/${SEASON}?view=proTeamSchedules_wl`);
  const proMap = {};
  for (const pt of sched.settings?.proTeams || []) proMap[pt.id] = pt;
  const opp = (proTeamId, wk) => {
    const g = (proMap[proTeamId]?.proGamesByScoringPeriod?.[wk] || [])[0];
    if (!g) return 'BYE';
    const home = g.homeProTeamId === proTeamId;
    return (home ? '' : '@') + (proMap[home ? g.awayProTeamId : g.homeProTeamId]?.abbrev || '?').toUpperCase();
  };
  const bye = proTeamId => { for (let w = 1; w <= 18; w++) if (opp(proTeamId, w) === 'BYE') return w; return '?'; };

  // ---- one data block per player ----
  const items = players.map((p, i) => {
    const pos = POS[p.defaultPositionId];
    const ab = (proMap[p.proTeamId]?.abbrev || 'FA').toUpperCase();
    const adp = p.ownership?.averageDraftPosition;
    const sp = sByName[p.fullName.toLowerCase()];
    const l = [`${p.fullName} (${pos}, ${ab}) — 2026 proj ${seasonProj(p)}, ADP ${adp ? adp.toFixed(1) : '?'}, overall draft rank ${i + 1}`];
    l.push(`  2025: ${summarize(s2025[p.id], 2025, pos) || 'no data (rookie or missed season)'}`);
    l.push(`  2024: ${summarize(s2024[p.id], 2024, pos) || 'no data'}`);
    const key = p.fullName.toLowerCase();
    const u = usageLine(pos, nvUsage?.[key], snaps.data?.[key], contact.data?.[key]);
    if (u) l.push(`  ${usageYr || snaps.yr || contact.yr} advanced usage: ${u}`);
    if (sp) {
      const comp = Object.values(sleeper)
        .filter(x => x.team && x.team === sp.team && x.position === sp.position && x.full_name && x.full_name !== sp.full_name && x.depth_chart_order != null)
        .sort((a, b) => a.depth_chart_order - b.depth_chart_order).slice(0, 4)
        .map(x => `${x.full_name} #${x.depth_chart_order}`).join(', ');
      l.push(`  depth: ${sp.depth_chart_position || pos} #${sp.depth_chart_order ?? '?'}, yrs exp ${sp.years_exp ?? '?'}${sp.injury_status ? ', injury: ' + sp.injury_status : ''}; same-team ${pos}: ${comp || 'none listed'}`);
    } else l.push(`  depth: no Sleeper match`); // DST/name-suffix mismatch, cosmetic
    const heads = news[key] || [];
    if (heads.length) l.push(`  recent news: ${heads.slice(0, 3).map(h => `"${h.h}"${h.s ? ` — ${h.s}` : ''} (${h.d})`).join('; ')}`);
    const ex = EXPERTS[key];
    if (ex) l.push(`  expert sleeper call: named by ${ex.by.join(', ')} — ${ex.why}`);
    l.push(`  playoffs wk15 ${opp(p.proTeamId, 15)}, wk16 ${opp(p.proTeamId, 16)}, wk17 ${opp(p.proTeamId, 17)}; bye wk${bye(p.proTeamId)}`);
    return { p, pos, rank: i + 1, text: l.join('\n') };
  });

  console.log(`News matched ${items.filter(x => news[x.p.fullName.toLowerCase()]).length}/${items.length} of the draft pool`);
  const exHit = items.filter(x => EXPERTS[x.p.fullName.toLowerCase()]).length;
  console.log(`Expert sleeper calls matched ${exHit}/${Object.keys(EXPERTS).length} (misses are names ESPN ranks outside the pool, or spelled differently)`);

  // ---- batches of ≤20, grouped by position ----
  const byPos = {};
  for (const x of items) (byPos[x.pos] ||= []).push(x);
  const batches = [];
  for (const pos of Object.keys(byPos)) for (let j = 0; j < byPos[pos].length; j += 20) batches.push({ pos, items: byPos[pos].slice(j, j + 20) });
  console.log(`${batches.length} batches: ` + batches.map(b => `${b.pos}×${b.items.length}`).join(', '));

  const userMsg = b => `Position group: ${b.pos} — ${b.items.length} players, listed in current draft-rank order. Analyze every one.\n\n${b.items.map(x => x.text).join('\n')}`;

  if (!process.env.ANTHROPIC_API_KEY) {
    console.log(`--- sample batch prompt (${batches[0].pos}) ---\n${userMsg(batches[0])}\n--- end sample ---`);
    return console.log(`Dry run complete: ${items.length} players, ${batches.length} batches ready. Set ANTHROPIC_API_KEY to generate.`);
  }

  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic();
  const out = { generated: new Date().toISOString(), season: +SEASON, players: {} };
  const usage = { in: 0, out: 0 };
  for (let k = 0; k < batches.length; k++) {
    const b = batches[k];
    console.log(`Batch ${k + 1}/${batches.length} (${b.pos} ×${b.items.length})…`);
    const call = () => client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: 'user', content: userMsg(b) }],
    });
    let res;
    try { res = await call(); } catch (e) {
      console.log(`  error, retrying once in 20s: ${e.message}`);
      await new Promise(r => setTimeout(r, 20000));
      res = await call();
    }
    usage.in += res.usage?.input_tokens || 0; usage.out += res.usage?.output_tokens || 0;
    const parsed = JSON.parse(res.content.filter(c => c.type === 'text').map(c => c.text).join(''));
    for (const a of parsed.players) {
      const item = b.items.find(x => x.p.fullName.toLowerCase() === a.name.toLowerCase());
      if (!item) { console.log(`  UNMATCHED name from Claude: ${a.name}`); continue; }
      out.players[item.p.fullName.toLowerCase()] = { tier: a.tier, verdict: a.verdict, report: a.report, floor: a.floor, ceiling: a.ceiling, badges: a.badges, proj: seasonProj(item.p), rank: item.rank };
    }
    console.log(`  ${parsed.players.length} analyzed (total ${Object.keys(out.players).length})`);
  }
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  console.log(`Done: ${Object.keys(out.players).length}/${items.length} players → draft-analysis.json. Tokens: ${usage.in} in / ${usage.out} out.`);
}
main().catch(e => { console.error(e); process.exit(1); });
