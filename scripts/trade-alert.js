// Hourly GitHub Actions job (same window as waiver-alert): drives the LIVE site headlessly
// (playwright-core + system Chrome — the same pattern used for manual verification) and reads
// today's trade proposals straight out of the client's own findTrades()/tradeKey(), rather than
// reimplementing consensus()/boomFactor()/newsFactor() server-side. That keeps one valuation
// engine, not two that can drift apart. Diffs against trade-state.json and only pings Telegram
// for proposals that are genuinely NEW since the last run — the tab itself needs no cron at all,
// since it already reloads every 5 minutes with fresh injury/news data (index.html:818).
const fs = require('fs');

const { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, APP_SECRET, MY_TEAM_ID = '1', SITE_URL = 'https://fantasy-edge-lyart.vercel.app' } = process.env;
const STATE_FILE = 'trade-state.json';

// Pure diff: which of today's trade keys weren't in the previously-seen set.
// firstRun seeds silently (same rule as waiver-alert's trending/news/usage seeding) — an empty
// state file means "never checked before," not "zero trades existed before."
function newProposals(current, seenKeys, firstRun) {
  return firstRun ? [] : current.filter(t => !seenKeys.has(t.key));
}

async function fetchTrades() {
  const { chromium } = require('playwright-core');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    // localStorage.myTeam is read at load() time (index.html:294) — must be set before the app boots.
    await page.addInitScript(team => { localStorage.setItem('myTeam', team); }, MY_TEAM_ID);
    await page.goto(`${SITE_URL}/?key=${APP_SECRET}`);
    await page.waitForSelector('text=Trades', { timeout: 20000 });
    await page.click('text=Trades');
    await page.waitForTimeout(2000); // let the async load() finish and re-render
    return await page.evaluate(() =>
      findTrades().filter(p => p.themGain > 0).map(p => ({
        key: tradeKey(p),
        team: teamName(p.t),
        send: p.s.map(x => x.name),
        get: p.g.map(x => x.name),
        meGain: p.meGain,
        themGain: p.themGain,
      }))
    );
  } finally {
    await browser.close();
  }
}

function fmt(t) {
  return `Send ${t.send.join(' + ')} to ${t.team} for ${t.get.join(' + ')} (+${t.meGain} you, +${t.themGain} them)`;
}

async function main() {
  let state = {};
  try { state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch {}
  const firstRun = !Array.isArray(state.seen);

  const trades = await fetchTrades();
  const fresh = newProposals(trades, new Set(state.seen || []), firstRun);

  state.seen = [...new Set([...(state.seen || []), ...trades.map(t => t.key)])].slice(-500);
  fs.writeFileSync(STATE_FILE, JSON.stringify(state));

  if (firstRun) return console.log(`First run — seeded ${trades.length} existing trade(s), no alert.`);
  if (!fresh.length) return console.log(`${trades.length} trade(s) live, none new since last run.`);

  console.log(`${fresh.length} new trade(s):\n` + fresh.map(fmt).join('\n'));

  if (!TELEGRAM_BOT_TOKEN) return console.log('No TELEGRAM_BOT_TOKEN — dry run, state saved, not sending.');

  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: '🔁 Fantasy Edge — new trade(s):\n\n' + fresh.map(fmt).join('\n') }),
  });
  console.log('Sent to Telegram.');
}

// node scripts/trade-alert.js --selftest — pure diff logic, no network/browser/cost
function selftest() {
  const assert = require('assert');
  const cur = [{ key: 'a' }, { key: 'b' }, { key: 'c' }];
  assert.deepStrictEqual(newProposals(cur, new Set(), true), [], 'first run must not alert on pre-existing trades');
  assert.deepStrictEqual(newProposals(cur, new Set(['a', 'b']), false).map(t => t.key), ['c'], 'only unseen keys should surface');
  assert.deepStrictEqual(newProposals([], new Set(['a']), false), [], 'no current trades must be empty, not a throw');
  assert.deepStrictEqual(newProposals(cur, new Set(['a', 'b', 'c']), false), [], 'nothing new must be empty');
  console.log('selftest: all assertions passed');
}

if (process.argv.includes('--selftest')) selftest();
else main().catch(e => { console.error(e); process.exit(1); });
