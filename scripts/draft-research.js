// One-shot draft research (manual re-run via workflow_dispatch): gathers free data
// (ESPN current top 300 + 2024/2025 weekly actuals, Sleeper depth charts, NFL schedule),
// batches ~20 players per position group to Claude, writes draft-analysis.json.
// Dry-runs without ANTHROPIC_API_KEY: all fetches + sample prompt, no Claude call.
const fs = require('fs');
const path = require('path');

const { LEAGUE_ID, ESPN_S2, SWID, SEASON = '2026' } = process.env;
const POS = { 1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'DST' };
const BADGES = ['split-touches', 'depth-risk', 'injury-history', 'rookie', 'new-team', 'easy-playoffs', 'tough-playoffs', 'breakout', 'decline-risk', 'workhorse', 'td-dependent', 'handcuff', 'elite'];
const FFL = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl';
const OUT = path.join(__dirname, '..', 'draft-analysis.json');

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

// One line per past season: games, total, PPG, weekly stdev, usage (stat ids 58/53/23)
function summarize(p, yr) {
  if (!p) return null;
  const weeks = (p.stats || []).filter(s => s.statSourceId === 0 && s.statSplitTypeId === 1 && s.seasonId === yr && s.scoringPeriodId > 0);
  if (!weeks.length) return null;
  const pts = weeks.map(w => w.appliedTotal || 0);
  const total = pts.reduce((a, b) => a + b, 0);
  const gp = pts.length, ppg = total / gp;
  const stdev = Math.sqrt(pts.reduce((a, b) => a + (b - ppg) ** 2, 0) / gp);
  const sum = id => Math.round(weeks.reduce((a, w) => a + (+(w.stats?.[id]) || 0), 0));
  return `${gp}gp ${total.toFixed(0)}pts ${ppg.toFixed(1)}ppg wk-stdev ${stdev.toFixed(1)}, ${sum('58')}tgt/${sum('53')}rec/${sum('23')}car`;
}

const seasonProj = p => { const s = (p.stats || []).find(s => s.statSourceId === 1 && s.seasonId === +SEASON && s.scoringPeriodId === 0); return s ? Math.round(s.appliedTotal) : 0; };

const SYSTEM = `You are an expert PPR fantasy football draft analyst preparing a rigorous 2026 draft board. It is pre-draft July 2026 — rosters are empty; past-season data is the substance, and your job is to interpret it for the FUTURE, not recite it. For each player you get: 2026 ESPN projection + ADP + overall draft rank, 2024/2025 weekly-derived actuals (games played, total points, PPG, weekly stdev, targets/receptions/carries), depth-chart competition on their NFL team, and playoff-week (15-17) opponents + bye. For EACH player return:
- tier: 1-8 within this position group; a new tier must mark a real dropoff in expected value, not equal slices
- verdict: one line, max 120 chars — why this player deserves this rank
- report: 3-5 sentences citing the data given: past usage/production trend interpreted forward, the ceiling case, the floor case, depth-chart/touch competition, and playoff schedule when notable
- floor and ceiling: season-total PPR points, roughly 15th and 85th percentile outcomes (weigh PPG, weekly variance, and games-missed risk)
- badges: only from the allowed list, only where the data clearly supports them`;

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
          tier: { type: 'integer', minimum: 1, maximum: 8 },
          verdict: { type: 'string', maxLength: 120 },
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
  console.log('Fetching current-season top 300 (own league, needs cookies)…');
  const pool = await getJson(`${FFL}/seasons/${SEASON}/segments/0/leagues/${LEAGUE_ID}?view=kona_player_info`, {
    cookies: true,
    filter: { players: { limit: 300, sortDraftRanks: { sortPriority: 1, sortAsc: true, value: 'PPR' } } },
  });
  const players = (pool.players || []).map(x => x.player).filter(p => POS[p.defaultPositionId]).slice(0, 300);
  console.log(`  ${players.length} players`);

  console.log('Fetching 2025 + 2024 weekly actuals (public)…');
  const [s2025, s2024] = await Promise.all([pastSeason(2025), pastSeason(2024)]);
  console.log(`  2025: ${Object.keys(s2025).length} players, 2024: ${Object.keys(s2024).length}`);

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
    l.push(`  2025: ${summarize(s2025[p.id], 2025) || 'no data (rookie or missed season)'}`);
    l.push(`  2024: ${summarize(s2024[p.id], 2024) || 'no data'}`);
    if (sp) {
      const comp = Object.values(sleeper)
        .filter(x => x.team && x.team === sp.team && x.position === sp.position && x.full_name && x.full_name !== sp.full_name && x.depth_chart_order != null)
        .sort((a, b) => a.depth_chart_order - b.depth_chart_order).slice(0, 4)
        .map(x => `${x.full_name} #${x.depth_chart_order}`).join(', ');
      l.push(`  depth: ${sp.depth_chart_position || pos} #${sp.depth_chart_order ?? '?'}, yrs exp ${sp.years_exp ?? '?'}${sp.injury_status ? ', injury: ' + sp.injury_status : ''}; same-team ${pos}: ${comp || 'none listed'}`);
    } else l.push(`  depth: no Sleeper match`); // DST/name-suffix mismatch, cosmetic
    l.push(`  playoffs wk15 ${opp(p.proTeamId, 15)}, wk16 ${opp(p.proTeamId, 16)}, wk17 ${opp(p.proTeamId, 17)}; bye wk${bye(p.proTeamId)}`);
    return { p, pos, rank: i + 1, text: l.join('\n') };
  });

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
