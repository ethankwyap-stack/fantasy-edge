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
const { bestLineup, SLOT } = require('./league-history.js');

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
    };
  });
  return { wk, players, slotCounts: d.settings.rosterSettings.lineupSlotCounts };
}

const fmt = (wk, r) => `⚠️ Week ${wk} lineup is leaving ${r.gain} projected pts on the bench.\n\n`
  + r.start.map(p => `START ${p.name} (${p.pos}, ${p.pts.toFixed(1)}) → ${p.slot}`).join('\n')
  + `\n` + r.sit.map(p => `SIT   ${p.name} (${p.pos}, ${p.pts.toFixed(1)})`).join('\n');

// One advice signature per week — re-alerting the identical swap every run is how an alert
// gets muted. A changed recommendation (injury news, a different bench player) does re-fire.
const sig = (wk, r) => `${wk}:${[...r.start, ...r.sit].map(p => p.id).sort().join(',')}`;

async function main() {
  const { wk, players, slotCounts } = await fetchRoster();
  const r = optimize(players, slotCounts);
  console.log(`Week ${wk}: ${players.filter(p => p.locked).length} locked, optimal lineup is +${r.gain} pts`);

  if (r.gain < MIN_GAP) return console.log(`Under the ${MIN_GAP}-pt threshold — no alert.`);
  const msg = fmt(wk, r);
  console.log(msg);

  let state = {}; try { state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { }
  if (state.sent === sig(wk, r)) return console.log('Same advice as the last run — not re-sending.');
  fs.writeFileSync(STATE_FILE, JSON.stringify({ sent: sig(wk, r) }));

  if (!TELEGRAM_BOT_TOKEN) return console.log('No TELEGRAM_BOT_TOKEN — dry run, state saved, not sending.');
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: msg }),
  });
  console.log('Sent to Telegram.');
}

function selftest() {
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
  assert.strictEqual(sig(3, a), sig(3, { start: [{ id: 1 }], sit: [{ id: 2 }] }), 'signature is order-independent');
  assert.notStrictEqual(sig(3, a), sig(4, a), 'a new week is new advice');
  assert.ok(SLOT[20] === 'BENCH' && BENCHED(21), 'bench/IR ids');
  console.log('selftest OK (no network)');
}

if (process.argv.includes('--selftest')) selftest();
else main().catch(e => { console.error(e); process.exit(1); });
