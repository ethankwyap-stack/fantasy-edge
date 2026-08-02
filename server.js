// Serves the dashboard + /api/espn proxy. Runs locally (node server.js) and on Vercel.
const http = require('http');
const fs = require('fs');
const path = require('path');
const espn = require('./api/espn.js');
const nfl = require('./api/nfl.js');

// ponytail: single-page app — static read so Vercel's bundler traces and includes it
const INDEX = fs.readFileSync(path.join(__dirname, 'index.html'));
const ANALYSIS_PATH = path.join(__dirname, 'draft-analysis.json');
const ANALYSIS = fs.readFileSync(ANALYSIS_PATH); // static read for Vercel tracing
// Merged analyst boards (scripts/draft-research.js --analyst-ranks). Literal path for the same
// tracing reason; a missing file is fine — the board just falls back to ESPN-only value.
const RANKS_PATH = path.join(__dirname, 'analyst-ranks.json');
const RANKS = (() => { try { return fs.readFileSync(RANKS_PATH); } catch { return Buffer.from('{"players":{}}'); } })();

const PORT = process.env.PORT || 4650;
const SECRET = espn.loadEnv().APP_SECRET;
http.createServer((req, res) => {
  // secret-link gate: visit /?key=SECRET once, cookie remembers you
  if (SECRET) {
    const key = new URL(req.url, 'http://x').searchParams.get('key');
    if (key === SECRET) {
      res.writeHead(302, { 'Set-Cookie': `fe_key=${SECRET}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax`, Location: '/' });
      return res.end();
    }
    if (!(req.headers.cookie || '').includes('fe_key=' + SECRET)) {
      res.statusCode = 401;
      return res.end('Fantasy Edge is private. Open the secret link you were given (ends in ?key=...).');
    }
  }
  if (req.url.startsWith('/api/espn')) return espn(req, res);
  if (req.url.startsWith('/api/nfl')) return nfl(req, res);
  if (req.url.startsWith('/draft-analysis.json')) {
    res.setHeader('Content-Type', 'application/json');
    // re-read locally so the always-on LaunchAgent picks up a git pull without restart
    try { return res.end(fs.readFileSync(ANALYSIS_PATH)); } catch { return res.end(ANALYSIS); }
  }
  if (req.url.startsWith('/analyst-ranks.json')) {
    res.setHeader('Content-Type', 'application/json');
    try { return res.end(fs.readFileSync(RANKS_PATH)); } catch { return res.end(RANKS); }
  }
  res.setHeader('Content-Type', 'text/html');
  res.end(INDEX);
}).listen(PORT, () => console.log('Fantasy Edge → http://localhost:' + PORT));
