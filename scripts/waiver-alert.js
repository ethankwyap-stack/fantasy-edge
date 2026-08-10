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

// ---- opportunity deltas: week-over-week role changes from free nflverse CSVs ----
// Sleeper trending is lagging (by then the claim is contested); usage is leading.
// URLs use the RELEASE TAG, not the filename — guessing the tag 404s.
// ponytail: snap share stands in for route share — routes-run is PFF/FTN paid data,
// and nflverse has no free equivalent. Upgrade path: swap in routes if it ever ships free.
const csvSplit = line => { // minimal quote-aware split, same shape as draft-research.js
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur); return out;
};

// Returns null (never throws) so a flaky GitHub download degrades the alert instead of killing it.
async function csvRows(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(120000) });
    if (!r.ok) return null; // season not started, or file not published yet
    const lines = (await r.text()).split('\n');
    const ix = {}; csvSplit(lines[0]).forEach((c, i) => ix[c] = i);
    const rows = [];
    for (let i = 1; i < lines.length; i++) if (lines[i]) rows.push(csvSplit(lines[i]));
    return { ix, rows };
  } catch (e) { console.warn(`  usage CSV fetch failed (${e.message}) — continuing without opportunity deltas`); return null; }
}

// name -> week -> { snapPct (0-1), snaps, tgtShare (0-1), tgt, pos, team }
async function weeklyUsage(yr) {
  const [snap, stats] = await Promise.all([
    csvRows(`https://github.com/nflverse/nflverse-data/releases/download/snap_counts/snap_counts_${yr}.csv`),
    csvRows(`https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${yr}.csv`),
  ]);
  if (!snap && !stats) return null;
  const by = {};
  const cell = (c, f, k) => f[c.ix[k]];
  if (snap) for (const f of snap.rows) {
    if (cell(snap, f, 'game_type') !== 'REG') continue;
    const name = (cell(snap, f, 'player') || '').toLowerCase(); if (!name) continue;
    const w = +cell(snap, f, 'week');
    const e = (by[name] ||= {})[w] ||= {};
    e.snapPct = +cell(snap, f, 'offense_pct') || 0; // 0-1 fraction in this file, NOT a percentage
    e.snaps = +cell(snap, f, 'offense_snaps') || 0;
    e.pos = cell(snap, f, 'position'); e.team = cell(snap, f, 'team');
  }
  if (stats) for (const f of stats.rows) {
    if (cell(stats, f, 'season_type') !== 'REG') continue;
    const name = (cell(stats, f, 'player_display_name') || '').toLowerCase(); if (!name) continue;
    const w = +cell(stats, f, 'week');
    const e = (by[name] ||= {})[w] ||= {};
    e.tgtShare = +cell(stats, f, 'target_share') || 0;
    e.tgt = +cell(stats, f, 'targets') || 0;
    e.pos ||= cell(stats, f, 'position'); e.team ||= cell(stats, f, 'team');
  }
  return Object.keys(by).length ? by : null;
}

// Thresholds — FIRST GUESS, tune against live data once the season is running.
// Reasoning: a 20-point snap-share jump is the size of a committee back becoming
// the starter or a WR3 moving into the WR2 role; smaller moves are game-script noise.
// MIN_SNAPS on the CURRENT week keeps a 2-snap-to-6-snap blowup out (a real role is
// double-digit snaps), and MIN_TGT does the same for the target-share rule, where
// share is a ratio that swings wildly on a 3-target sample.
// Calibrated by replaying 2025 (`--playback 2025 6`): at +0.20/+0.08 a single week
// produced 45 hits, mostly TE rotation churn. +0.25/+0.10 cuts that to the ~20 that are
// actually role changes. Still a first guess — retune once 2026 weeks exist.
const SPIKE = { snapJump: 0.25, tgtJump: 0.10, minSnaps: 25, minTgt: 6 };
const FANTASY_POS = new Set(['QB', 'RB', 'WR', 'TE', 'FB', 'HB']);

// Compare week `wk` against `wk - 1`. Both weeks must have a row: a player absent last
// week (bye/inactive) has no baseline, and calling that a spike floods the alert.
function usageSpikes(by, wk) {
  const out = [];
  for (const [name, weeks] of Object.entries(by)) {
    const now = weeks[wk], prev = weeks[wk - 1];
    if (!now || !prev || !FANTASY_POS.has(now.pos)) continue;
    // A player can have a snap row but no stats row (zero production), so default every read:
    // an undefined baseline is a real zero here, not missing data.
    const [pSnap, nSnap, pTgtS, nTgtS] = [prev.snapPct || 0, now.snapPct || 0, prev.tgtShare || 0, now.tgtShare || 0];
    const dSnap = nSnap - pSnap, dTgt = nTgtS - pTgtS;
    const reasons = [];
    if (dSnap >= SPIKE.snapJump && (now.snaps || 0) >= SPIKE.minSnaps)
      reasons.push(`snap share ${Math.round(pSnap * 100)}%→${Math.round(nSnap * 100)}% (${now.snaps} snaps)`);
    if (dTgt >= SPIKE.tgtJump && (now.tgt || 0) >= SPIKE.minTgt)
      reasons.push(`target share ${Math.round(pTgtS * 100)}%→${Math.round(nTgtS * 100)}% (${prev.tgt || 0}→${now.tgt} tgt)`);
    if (reasons.length) out.push({ name, pos: now.pos, team: now.team, wk, mag: Math.max(dSnap, dTgt * 2), text: reasons.join(', ') });
  }
  return out.sort((a, b) => b.mag - a.mag);
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

  // camp/preseason buzz — ESPN's free public news feed, same one the draft board uses
  const newsJson = await (await fetch('https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?limit=50')).json();
  const articles = (newsJson.articles || [])
    .map(a => ({
      url: a.links?.web?.href || a.headline,
      headline: a.headline || '',
      players: (a.categories || []).filter(c => c.type === 'athlete')
        .map(c => c.description || c.athlete?.displayName).filter(Boolean),
    }))
    .filter(a => a.headline && a.players.length); // only articles ESPN tagged to a player

  // Opportunity deltas. Skipped entirely before week 3 — you need two completed weeks
  // to have a week-over-week delta at all, so preseason does zero network work here.
  let spikes = [];
  if (week >= 3) {
    const by = await weeklyUsage(+SEASON);
    if (!by) console.log('Opportunity deltas: no nflverse weekly data for this season yet — skipping.');
    else {
      // Use the latest week actually published (nflverse lags a day or two mid-week).
      const latest = Math.max(...Object.values(by).flatMap(w => Object.keys(w).map(Number)).filter(w => w < week));
      spikes = latest >= 2 ? usageSpikes(by, latest) : [];
      console.log(`Opportunity deltas: week ${latest} vs ${latest - 1} — ${spikes.length} usage spike(s).`);
    }
  } else console.log('Opportunity deltas: preseason / week < 3, no week-over-week data available — skipping.');

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
  const newsFirstSeed = !Array.isArray(state.newsUrls); // pre-existing cache without this field yet
  const seenUrls = new Set(state.newsUrls || []);
  const newArticles = (firstRun || newsFirstSeed) ? [] : articles.filter(a => !seenUrls.has(a.url));

  // Usage dedup keyed by player+week, so an hourly re-run never re-reports the same spike.
  // An older cached state has no usageSeen: seed it silently rather than treating every
  // spike as new (same shape as newsUrls above). Cap the batch so a lost cache mid-season
  // can't flood the phone with 40 lines.
  const usageFirstSeed = !Array.isArray(state.usageSeen);
  const seenUsage = new Set(state.usageSeen || []);
  const key = s => `${s.name}|${s.wk}`;
  const newSpikes = (firstRun || usageFirstSeed) ? [] : spikes.filter(s => !seenUsage.has(key(s))).slice(0, 8);

  state.trending = trendingIds;
  state.usageSeen = [...new Set([...(state.usageSeen || []), ...spikes.map(key)])].slice(-400);
  state.injuries = injuriesNow;
  state.newsUrls = articles.map(a => a.url).slice(-300);
  state.sent = state.sent || [];

  if (!firstRun && !newTrending.length && !injuryChanges.length && !newArticles.length && !newSpikes.length) {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state));
    return console.log('No changes since last run (trending stable, no injury updates, no new news, no usage spikes) — exiting free, no Claude call.');
  }
  console.log(`Changes detected: ${newTrending.length} new trending, ${injuryChanges.length} injury changes, ${newArticles.length} new news articles, ${newSpikes.length} usage spikes${firstRun ? ' (first run — seeding state)' : ''}`);

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

  const newsLines = newArticles.map(a => `${a.headline} [${a.players.join(', ')}]`);

  // Video notes (video-notes.json, written by the fantasy-video-inject skill). Week-tagged and
  // TTL'd: an in-season take goes stale fast, and an undated one would read as current forever.
  const vn = (() => { try { return JSON.parse(fs.readFileSync(require('path').join(__dirname, '..', 'video-notes.json'), 'utf8')); } catch { return {}; } })();
  const vTtl = vn._ttlWeeks || 3;
  const videoLines = Object.entries(vn.notes || {}).flatMap(([name, ns]) => (ns || [])
    .filter(n => week - (n.week ?? 0) <= vTtl)
    // key printed as stored — title-casing mangles "iii"/"mccaffrey", and Claude doesn't need the caps
    .map(n => `${name} [wk${n.week}, ${n.analyst || 'video'}]: ${n.note}`));

  // Free agents first — a spike on a rostered player is context, a spike on an available one is the move.
  const spikeLines = newSpikes
    .map(s => ({ ...s, fa: !rostered.has(s.name) }))
    .sort((a, b) => (b.fa - a.fa) || (b.mag - a.mag))
    .map(s => {
      const disp = s.name.replace(/\b\w/g, c => c.toUpperCase());
      return `${s.fa ? 'FREE AGENT' : 'rostered'}: ${disp} (${s.pos}, ${s.team}) — ${s.text}${s.fa ? `; ${enrich(disp, s.pos) || 'no ESPN data'}` : ''}`;
    });

  const prompt = `Week ${week}. Changes this run: ${[...injuryChanges, `${newTrending.length} new trending players`, `${newArticles.length} new news articles`, `${newSpikes.length} usage spikes`].join('; ')}.

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
${tradeSignals.join('\n') || '(none — no games played yet)'}

Opportunity deltas — week-over-week jumps in actual role (snap share stands in for route share):
${spikeLines.join('\n') || '(none)'}

Camp/preseason news since last check (player tags in brackets):
${newsLines.join('\n') || '(none)'}

Video/podcast takes I injected (week-tagged; opinion, not data — weigh below the usage numbers above):
${videoLines.join('\n') || '(none)'}`;

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
      'A free-agent opportunity delta (a week-over-week jump in snap share or target share) is the strongest add signal you get, because it leads the box score and the national trending lists — treat a big one on an available player as move-worthy on its own, and it still needs a bid range like any other add. The same jump on an already-rostered player is context or a trade angle, not an add. ' +
      'You are an expert PPR fantasy football advisor. Recommend at most 3 concrete moves (e.g. "Add X, drop Y", "Start A over B", "Stash handcuff X", "Trade for X, he\'s a buy-low", "Shop Y while he\'s hot"), each with a one-line reason and a conviction score 1-5. Only include moves scoring 4+ (a clear, substantial edge: breakout usage change, injury opening a starting role, must-add before waivers clear, a rival about to grab the same player, a clearly mispriced trade target). The camp/preseason news section is a signal to weigh, not an automatic trigger — a beat-writer note that a player "won the starting job" or "is running with the 1s" over a rostered or waiver-relevant player can justify a move on its own; roster-move speculation, injury updates already reflected in injury status, and generic camp-hype filler do NOT qualify by themselves. Routine churn, marginal upgrades, and "worth monitoring" chatter do NOT qualify. If nothing scores 4+, reply with exactly NO_ALERT and nothing else. Be terse — this goes to a phone notification. No markdown.',
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
// node scripts/waiver-alert.js --selftest — free, no network, covers the delta logic
// a preseason dry run can never reach.
function selftest() {
  const assert = require('assert');
  const wk = (snapPct, snaps, tgtShare, tgt, pos = 'WR') => ({ snapPct, snaps, tgtShare, tgt, pos, team: 'XX' });
  const got = usageSpikes({
    riser:    { 1: wk(0.40, 25, 0.15, 6), 2: wk(0.75, 55, 0.16, 7) },  // snap share +35 — spike
    targets:  { 1: wk(0.80, 55, 0.10, 4), 2: wk(0.82, 56, 0.24, 9) },  // target share +14 — spike
    tinyrole: { 1: wk(0.03, 2, 0, 0),     2: wk(0.30, 8, 0, 0) },      // 2→8 snaps — below minSnaps
    smallgain:{ 1: wk(0.50, 40, 0.10, 5), 2: wk(0.62, 48, 0.13, 6) },  // +12 snap / +3 tgt — noise
    ratio:    { 1: wk(0.60, 45, 0.05, 2), 2: wk(0.61, 45, 0.30, 3) },  // huge share on 3 tgt — below minTgt
    returning:{ 2: wk(0.90, 60, 0.30, 12) },                           // no week-1 baseline
    kicker:   { 1: wk(0.10, 5, 0, 0, 'K'), 2: wk(0.90, 60, 0, 0, 'K') },
  }, 2);
  assert.deepStrictEqual(got.map(s => s.name).sort(), ['riser', 'targets'], 'only real role changes with a real baseline fire');
  assert.match(got.find(s => s.name === 'riser').text, /40%→75%/, 'snap share is reported as a percentage, not the raw 0-1 fraction');
  assert.strictEqual(usageSpikes({}, 5).length, 0, 'no data must be empty, not a throw');
  console.log('selftest: all assertions passed');
}

// node scripts/waiver-alert.js --playback 2025 6 — replays two real completed weeks
// through the same detector. The only way to validate thresholds before the season starts.
async function playback() {
  const [yr, wk] = process.argv.slice(3).map(Number);
  const by = await weeklyUsage(yr || 2025);
  if (!by) return console.log('no data');
  const out = usageSpikes(by, wk || 6);
  console.log(`${yr} week ${wk} vs ${wk - 1}: ${out.length} spikes\n` + out.map(s => `  ${s.name} (${s.pos}, ${s.team}) — ${s.text}`).join('\n'));
}

const FLAGS = new Set(process.argv.slice(2));
if (FLAGS.has('--selftest')) selftest();
else if (FLAGS.has('--playback')) playback().catch(e => { console.error(e); process.exit(1); });
else main().catch(e => { console.error(e); process.exit(1); });
