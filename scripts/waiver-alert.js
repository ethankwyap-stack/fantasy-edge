// Hourly GitHub Actions job (6am–9pm PT): fetches free data, diffs against cached
// state.json, and only calls Claude / sends Telegram when something actually changed
// (new trending player, injury-status change on my roster). Dedups sent advice.
const fs = require('fs');
const crypto = require('crypto');

const { LEAGUE_ID, ESPN_S2, SWID, SEASON = '2026', TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, MY_TEAM_ID = '1' } = process.env;
const POS = { 1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'DST' };
const STATE_FILE = 'state.json';
const sha = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);

async function espn(views, filter) {
  // views MUST go out as repeated &view= params — the comma-joined form silently omits `settings`
  const qs = views.split(',').map(v => `view=${v}`).join('&');
  const url = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${SEASON}/segments/0/leagues/${LEAGUE_ID}?${qs}`;
  const headers = { Cookie: `SWID=${SWID}; espn_s2=${ESPN_S2}` };
  if (filter) headers['X-Fantasy-Filter'] = JSON.stringify(filter);
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`ESPN ${res.status} on ${views} (401 = cookies expired, re-grab from browser)`);
  return res.json();
}

// stat helpers — actuals are statSourceId=0, projections statSourceId=1; scoringPeriodId 0 = season
const stat = (p, srcId, wk) => (p.stats || []).find(s => s.statSourceId === srcId && s.seasonId === +SEASON && s.scoringPeriodId === wk);
const seasonProj = p => { const s = stat(p, 1, 0); return s ? Math.round(s.appliedTotal) : 0; };
const seasonActual = p => { const s = stat(p, 0, 0); return s ? s.appliedTotal : null; };
const weekProj = (p, wk) => { const s = stat(p, 1, wk); return s ? +s.appliedTotal.toFixed(1) : null; };

// targets/receptions/rush attempts (ESPN stat ids 58/53/23) for the last 3 completed weeks
function usageLine(p, week) {
  const parts = [];
  for (let w = Math.max(1, week - 3); w < week; w++) {
    const s = stat(p, 0, w);
    if (s?.stats) parts.push(`wk${w} ${Math.round(s.stats['58'] || 0)}tgt/${Math.round(s.stats['53'] || 0)}rec/${Math.round(s.stats['23'] || 0)}car`);
  }
  return parts.join(', ');
}

function opponent(proTeamId, wk, proMap) {
  const g = (proMap[proTeamId]?.proGamesByScoringPeriod?.[wk] || [])[0];
  if (!g) return null; // bye
  const home = g.homeProTeamId === proTeamId;
  const oppId = home ? g.awayProTeamId : g.homeProTeamId;
  return { id: oppId, label: (home ? '' : '@') + (proMap[oppId]?.abbrev || '?').toUpperCase() };
}

async function main() {
  // ---- free data fetches (no Claude yet) ----
  const league = await espn('mTeam,mRoster,mPositionalRatings,mSettings');
  const week = league.scoringPeriodId || 0;
  const ratings = league.positionAgainstOpponent?.positionalRatings || {};

  // FAAB: league is continuous waivers with an acquisition budget, so every add is a bid.
  const acq = league.settings?.acquisitionSettings || {};
  const faab = acq.isUsingAcquisitionBudget ? { total: acq.acquisitionBudget || 0, min: acq.minimumBid || 1 } : null;

  const rostered = new Set();
  let myRoster = [];
  const teams = [];
  for (const t of league.teams || []) {
    const players = (t.roster?.entries || []).map(e => e.playerPoolEntry?.player).filter(Boolean);
    players.forEach(p => rostered.add(p.fullName.toLowerCase()));
    teams.push({ id: t.id, name: t.name || `Team ${t.id}`, players, spent: t.transactionCounter?.acquisitionBudgetSpent || 0 });
    if (t.id === +MY_TEAM_ID) myRoster = players;
  }
  const myBudget = faab ? faab.total - (teams.find(t => t.id === +MY_TEAM_ID)?.spent || 0) : null;

  const playerData = await espn('kona_player_info', {
    players: {
      limit: 300,
      sortDraftRanks: { sortPriority: 1, sortAsc: true, value: 'PPR' },
      filterStatsForTopScoringPeriodIds: { value: 4, additionalValue: [`00${SEASON}`, `10${SEASON}`] },
    },
  });
  const espnByName = {};
  for (const x of playerData.players || []) espnByName[x.player.fullName.toLowerCase()] = x.player;

  const trending = await (await fetch('https://api.sleeper.app/v1/players/nfl/trending/add?limit=40')).json();
  const all = await (await fetch('https://api.sleeper.app/v1/players/nfl')).json();

  const schedData = await (await fetch(`https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${SEASON}?view=proTeamSchedules_wl`)).json();
  const proMap = {};
  for (const pt of schedData.settings?.proTeams || []) proMap[pt.id] = pt;

  // ---- diff gate: only wake Claude when something changed ----
  let state = {};
  try { state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch {}
  const firstRun = !Array.isArray(state.trending);

  const trendingIds = trending.map(t => t.player_id);
  const newTrending = firstRun ? trendingIds : trendingIds.filter(id => !state.trending.includes(id));
  const injuriesNow = Object.fromEntries(myRoster.map(p => [p.fullName, p.injuryStatus || 'ACTIVE']));
  const injuryChanges = firstRun ? [] : Object.entries(injuriesNow)
    .filter(([name, st]) => (state.injuries?.[name] || 'ACTIVE') !== st)
    .map(([name, st]) => `${name}: ${state.injuries?.[name] || 'ACTIVE'} → ${st}`);

  state.trending = trendingIds;
  state.injuries = injuriesNow;
  state.sent = state.sent || [];

  if (!firstRun && !newTrending.length && !injuryChanges.length) {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state));
    return console.log('No changes since last run (trending stable, no injury updates) — exiting free, no Claude call.');
  }
  console.log(`Changes detected: ${newTrending.length} new trending, ${injuryChanges.length} injury changes${firstRun ? ' (first run — seeding state)' : ''}`);

  // ---- enrichment ----
  const wkNow = Math.max(1, week); // pre-draft week=0 → use week 1 schedule
  const oppStrength = (pos, oppId) => {
    const posId = { QB: 1, RB: 2, WR: 3, TE: 4, K: 5, DST: 16 }[pos];
    const avg = ratings[posId]?.ratingsByOpponent?.[oppId]?.average;
    return avg != null ? `, allows ${(+avg).toFixed(1)}/gm to ${pos}` : '';
  };

  const enrich = (name, pos) => {
    const ep = espnByName[name.toLowerCase()];
    if (!ep) return '';
    const bits = [];
    const proj = seasonProj(ep);
    if (proj) bits.push(`season proj ${proj}`);
    const wp = weekProj(ep, wkNow);
    if (wp != null && proj) bits.push(`wk${wkNow} proj ${wp} (pace ${(proj / 17).toFixed(1)})`);
    const use = week > 1 ? usageLine(ep, week) : '';
    if (use) bits.push(use);
    const opp = opponent(ep.proTeamId, wkNow, proMap);
    if (opp) bits.push(`next ${opp.label}${oppStrength(pos, opp.id)}`);
    const playoffs = [15, 16, 17].map(w => opponent(ep.proTeamId, w, proMap)?.label || 'BYE').join(',');
    bits.push(`playoffs ${playoffs}`);
    return bits.join('; ');
  };

  const freeAgents = trending
    .map(t => ({ ...all[t.player_id], count: t.count }))
    .filter(p => p?.full_name && !rostered.has(p.full_name.toLowerCase()) && ['QB', 'RB', 'WR', 'TE'].includes(p.position))
    .map(p => `${p.full_name} (${p.position}, ${p.team || 'FA'}) — ${p.count} adds/24h; ${enrich(p.full_name, p.position) || 'no ESPN data'}`);

  const rosterLines = myRoster.map(p => {
    const pos = POS[p.defaultPositionId];
    const inj = p.injuryStatus && p.injuryStatus !== 'ACTIVE' ? `, INJURY: ${p.injuryStatus}` : '';
    return `${p.fullName} (${pos})${inj} — ${enrich(p.fullName, pos)}`;
  });

  // rival awareness: positional thinness across other teams
  const minAt = { QB: 2, RB: 4, WR: 4, TE: 2 };
  const thin = [];
  for (const t of teams) {
    if (t.id === +MY_TEAM_ID || !t.players.length) continue;
    const counts = {};
    t.players.forEach(p => { const pos = POS[p.defaultPositionId]; counts[pos] = (counts[pos] || 0) + 1; });
    const needs = Object.keys(minAt).filter(pos => (counts[pos] || 0) < minAt[pos]);
    if (needs.length) thin.push(`${t.name} thin at ${needs.join('/')}`);
  }

  // who can actually outbid me — a thin rival with no budget left is not a threat
  const budgetLines = faab ? teams
    .map(t => ({ name: t.id === +MY_TEAM_ID ? `${t.name} (ME)` : t.name, left: faab.total - t.spent }))
    .sort((a, b) => b.left - a.left)
    .map(t => `${t.name}: $${t.left} of $${faab.total} left`) : [];

  // handcuff detection: unrostered RB2s on my starting RBs' NFL teams
  const norm = ab => ({ WSH: 'WAS', JAX: 'JAC' }[ab] || ab);
  const myRBTeams = new Set(myRoster.filter(p => p.defaultPositionId === 2).map(p => norm((proMap[p.proTeamId]?.abbrev || '').toUpperCase())));
  const handcuffs = Object.values(all)
    .filter(p => p.position === 'RB' && p.depth_chart_order === 2 && p.team && myRBTeams.has(norm(p.team)) && p.full_name && !rostered.has(p.full_name.toLowerCase()))
    .map(p => `${p.full_name} (${p.team}) — RB2 behind my starter`);

  // buy-low / sell-high: rostered players where actual PPG diverges most from projected PPG
  const tradeSignals = [];
  if (week > 1) {
    const div = [];
    for (const t of teams) for (const p of t.players) {
      const act = seasonActual(espnByName[p.fullName.toLowerCase()] || p);
      const proj = seasonProj(espnByName[p.fullName.toLowerCase()] || p);
      if (act == null || !proj) continue;
      const d = act / (week - 1) - proj / 17;
      div.push({ line: `${p.fullName} (${t.name}) actual ${(act / (week - 1)).toFixed(1)}/gm vs proj ${(proj / 17).toFixed(1)}/gm`, d, mine: t.id === +MY_TEAM_ID });
    }
    div.sort((a, b) => a.d - b.d);
    tradeSignals.push(...div.slice(0, 5).filter(x => !x.mine).map(x => `BUY-LOW: ${x.line}`));
    tradeSignals.push(...div.slice(-5).reverse().filter(x => x.mine).map(x => `SELL-HIGH: ${x.line}`));
  }

  const prompt = `Week ${week}. Changes this run: ${[...injuryChanges, `${newTrending.length} new trending players`].join('; ')}.

My roster:
${rosterLines.join('\n') || '(empty — league has not drafted yet; only mention pre-draft-relevant notes)'}

Trending free agents in my league:
${freeAgents.join('\n') || '(none)'}

Rival rosters:
${thin.join('\n') || '(no data — pre-draft)'}
${faab ? `
FAAB budgets remaining (continuous waivers, bids process daily at 10am ET, minimum bid $${faab.min}). My remaining budget: $${myBudget}:
${budgetLines.join('\n')}
` : ''}

Handcuff stash candidates:
${handcuffs.join('\n') || '(none)'}

Trade signals (actual vs projected PPG divergence):
${tradeSignals.join('\n') || '(none — no games played yet)'}`;

  console.log('--- prompt ---\n' + prompt + '\n--- end prompt ---');

  if (!process.env.ANTHROPIC_API_KEY) {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state));
    return console.log('No ANTHROPIC_API_KEY — dry run, state saved, stopping before Claude.');
  }

  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic();
  const response = await client.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 1024,
    thinking: { type: 'adaptive' },
    system: (faab ? `This league uses FAAB continuous waivers: every add is a blind bid, minimum $${faab.min}, and bids process daily at 10am ET. For EVERY add you recommend, give a bid as a dollar range AND as a percent of my remaining budget (e.g. "bid $45-60, 5-6% of your $1000"). Size the bid to how much the player actually moves my starting lineup, not to how many people are adding him, and check the budget table: if the rivals who need his position are nearly broke, bid at the low end. Say "wait" if he will still be there tomorrow.\n\n` : '') +
      'You are an expert PPR fantasy football advisor. Recommend at most 3 concrete moves (e.g. "Add X, drop Y", "Start A over B", "Stash handcuff X", "Trade for X, he\'s a buy-low", "Shop Y while he\'s hot"), each with a one-line reason and a conviction score 1-5. Only include moves scoring 4+ (a clear, substantial edge: breakout usage change, injury opening a starting role, must-add before waivers clear, a rival about to grab the same player, a clearly mispriced trade target). Routine churn, marginal upgrades, and "worth monitoring" chatter do NOT qualify. If nothing scores 4+, reply with exactly NO_ALERT and nothing else. Be terse — this goes to a phone notification. No markdown.',
    messages: [{ role: 'user', content: prompt }],
  });
  const advice = response.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();

  if (advice === 'NO_ALERT' || advice.startsWith('NO_ALERT')) {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state));
    return console.log('No substantial moves — staying silent.');
  }

  // dedup: never re-send a recommendation line we've already sent
  const lines = advice.split('\n').map(l => l.trim()).filter(Boolean);
  const fresh = lines.filter(l => !state.sent.includes(sha(l)));
  if (!fresh.length) {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state));
    return console.log('All recommendations already sent previously — staying silent.\n' + advice);
  }
  state.sent.push(...fresh.map(sha));
  state.sent = state.sent.slice(-300);
  fs.writeFileSync(STATE_FILE, JSON.stringify(state));

  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: '🏈 Fantasy Edge — recommended moves:\n\n' + fresh.join('\n') }),
  });
  console.log('Sent:\n' + fresh.join('\n'));
}
main().catch(e => { console.error(e); process.exit(1); });
