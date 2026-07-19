// Proxy to ESPN fantasy API — keeps cookies server-side, never in the browser.
const fs = require('fs');
const path = require('path');

function loadEnv() {
  // Vercel: env vars. Local: .env file.
  if (process.env.ESPN_S2) return process.env;
  const env = {};
  try {
    for (const line of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split('\n')) {
      const m = line.match(/^(\w+)=(.*)$/);
      if (m) env[m[1]] = m[2].trim();
    }
  } catch {}
  return env;
}

module.exports = async (req, res) => {
  const env = loadEnv();
  const { LEAGUE_ID, ESPN_S2, SWID, SEASON = '2026' } = env;
  if (!LEAGUE_ID || !ESPN_S2 || !SWID) {
    res.statusCode = 500;
    return res.end(JSON.stringify({ error: 'Missing LEAGUE_ID / ESPN_S2 / SWID in .env' }));
  }
  const q = new URL(req.url, 'http://x').searchParams;
  const views = (q.get('view') || 'mTeam').split(',').map(v => 'view=' + v).join('&');
  const url = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${SEASON}/segments/0/leagues/${LEAGUE_ID}?${views}`;
  const headers = { Cookie: `SWID=${SWID}; espn_s2=${ESPN_S2}` };
  if (q.get('filter')) headers['X-Fantasy-Filter'] = q.get('filter');
  const r = await fetch(url, { headers });
  res.statusCode = r.status;
  res.setHeader('Content-Type', 'application/json');
  res.end(await r.text());
};
module.exports.loadEnv = loadEnv;
