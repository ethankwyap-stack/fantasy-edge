// Daily GitHub Actions job: gathers your roster, trending pickups, and injuries,
// asks Claude for concrete moves, pings Telegram. Same pattern as stock-agent.
const Anthropic = require('@anthropic-ai/sdk');

const { LEAGUE_ID, ESPN_S2, SWID, SEASON = '2026', TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, MY_TEAM_ID = '1' } = process.env;
const POS = { 1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'DST' };

async function espn(views, filter) {
  const url = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${SEASON}/segments/0/leagues/${LEAGUE_ID}?view=${views}`;
  const headers = { Cookie: `SWID=${SWID}; espn_s2=${ESPN_S2}` };
  if (filter) headers['X-Fantasy-Filter'] = JSON.stringify(filter);
  return (await fetch(url, { headers })).json();
}

function seasonProj(p) {
  const s = (p.stats || []).find(s => s.statSourceId === 1 && s.scoringPeriodId === 0 && s.seasonId === +SEASON);
  return s ? Math.round(s.appliedTotal) : 0;
}

async function main() {
  const league = await espn('mTeam,mRoster');
  const week = league.scoringPeriodId || 0;
  const rostered = new Set();
  let myRoster = [];
  for (const t of league.teams || []) {
    const players = (t.roster?.entries || []).map(e => e.playerPoolEntry?.player).filter(Boolean);
    players.forEach(p => rostered.add(p.fullName.toLowerCase()));
    if (t.id === +MY_TEAM_ID) myRoster = players;
  }

  const playerData = await espn('kona_player_info', { players: { limit: 300, sortDraftRanks: { sortPriority: 1, sortAsc: true, value: 'PPR' } } });
  const projById = {};
  for (const x of playerData.players || []) projById[x.player.fullName.toLowerCase()] = seasonProj(x.player);

  const trending = await (await fetch('https://api.sleeper.app/v1/players/nfl/trending/add?limit=40')).json();
  const all = await (await fetch('https://api.sleeper.app/v1/players/nfl')).json();
  const freeAgents = trending
    .map(t => ({ ...all[t.player_id], count: t.count }))
    .filter(p => p?.full_name && !rostered.has(p.full_name.toLowerCase()) && ['QB', 'RB', 'WR', 'TE'].includes(p.position))
    .map(p => `${p.full_name} (${p.position}, ${p.team || 'FA'}) — ${p.count} adds/24h, season proj ${projById[p.full_name.toLowerCase()] ?? '?'}`);

  const rosterLines = myRoster.map(p =>
    `${p.fullName} (${POS[p.defaultPositionId]}) — proj ${seasonProj(p)}${p.injuryStatus && p.injuryStatus !== 'ACTIVE' ? ', INJURY: ' + p.injuryStatus : ''}`);

  if (!rosterLines.length && !freeAgents.length) return console.log('Nothing to report.');

  const client = new Anthropic();
  const response = await client.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 1024,
    thinking: { type: 'adaptive' },
    system: 'You are an expert PPR fantasy football advisor. Recommend at most 3 concrete moves (e.g. "Add X, drop Y", "Start A over B", "Monitor C\'s injury"), each with a one-line reason and a conviction score 1-5. Only include moves scoring 4+ (a clear, substantial edge: breakout usage change, injury opening a starting role, must-add before waivers clear). Routine churn, marginal upgrades, and "worth monitoring" chatter do NOT qualify. If nothing scores 4+, reply with exactly NO_ALERT and nothing else. Be terse — this goes to a phone notification. No markdown.',
    messages: [{
      role: 'user',
      content: `Week ${week}. My roster:\n${rosterLines.join('\n') || '(empty — league has not drafted yet; only mention pre-draft-relevant notes)'}\n\nTrending free agents in my league:\n${freeAgents.join('\n') || '(none)'}`
    }],
  });
  const advice = response.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
  if (advice === 'NO_ALERT' || advice.startsWith('NO_ALERT')) return console.log('No substantial moves — staying silent.');

  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: '🏈 Fantasy Edge — recommended moves:\n\n' + advice }),
  });
  console.log('Sent:\n' + advice);
}
main().catch(e => { console.error(e); process.exit(1); });
