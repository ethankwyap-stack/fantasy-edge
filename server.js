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
// Boom/bust rates (scripts/boom-rates.js). Same literal-path rule for Vercel tracing.
const BOOM_PATH = path.join(__dirname, 'boom-rates.json');
const BOOM = (() => { try { return fs.readFileSync(BOOM_PATH); } catch { return Buffer.from('{"players":{}}'); } })();
// In-season video notes (fantasy-video-inject skill). Same literal-path rule for Vercel tracing.
const VNOTES_PATH = path.join(__dirname, 'video-notes.json');
const VNOTES = (() => { try { return fs.readFileSync(VNOTES_PATH); } catch { return Buffer.from('{"notes":{}}'); } })();
// Playoff-weeks (15-17) strength of schedule (scripts/league-history.js --playoff-sos).
// Same literal-path rule for Vercel tracing; a missing file is fine — the tab just says so.
const SOS_PATH = path.join(__dirname, 'playoff-sos.json');
const SOS = (() => { try { return fs.readFileSync(SOS_PATH); } catch { return Buffer.from('{"rows":[]}'); } })();
// 2025 season postmortem data story. Same literal-path rule for Vercel tracing.
// The file is also published as a claude.ai Artifact, so it stays artifact-shaped:
// no doctype, no <head>, no <meta charset>. That's why this route sends charset
// explicitly — without it the team-name emoji and every en-dash render as mojibake.
const POSTMORTEM_PATH = path.join(__dirname, 'site', '2025-postmortem.html');
const POSTMORTEM = (() => { try { return fs.readFileSync(POSTMORTEM_PATH); } catch { return null; } })();

const PORT = process.env.PORT || 4650;
const SECRET = espn.loadEnv().APP_SECRET;
http.createServer((req, res) => {
  // secret-link gate: visit /?key=SECRET once, cookie remembers you
  if (SECRET) {
    const u = new URL(req.url, 'http://x');
    const key = u.searchParams.get('key');
    if (key === SECRET) {
      // Keep every other param across the redirect — ?key=X&league=2 must not land on a bare /.
      u.searchParams.delete('key');
      const rest = u.searchParams.toString();
      res.writeHead(302, { 'Set-Cookie': `fe_key=${SECRET}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax`, Location: u.pathname + (rest ? '?' + rest : '') });
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
  if (req.url.startsWith('/boom-rates.json')) {
    res.setHeader('Content-Type', 'application/json');
    try { return res.end(fs.readFileSync(BOOM_PATH)); } catch { return res.end(BOOM); }
  }
  if (req.url.startsWith('/video-notes.json')) {
    res.setHeader('Content-Type', 'application/json');
    try { return res.end(fs.readFileSync(VNOTES_PATH)); } catch { return res.end(VNOTES); }
  }
  if (req.url.startsWith('/playoff-sos.json')) {
    res.setHeader('Content-Type', 'application/json');
    try { return res.end(fs.readFileSync(SOS_PATH)); } catch { return res.end(SOS); }
  }
  if (req.url.startsWith('/2025-postmortem')) {
    if (!POSTMORTEM) { res.statusCode = 404; return res.end('Postmortem page not found.'); }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    try { return res.end(fs.readFileSync(POSTMORTEM_PATH)); } catch { return res.end(POSTMORTEM); }
  }
  res.setHeader('Content-Type', 'text/html');
  res.end(INDEX);
}).listen(PORT, () => console.log('Fantasy Edge → http://localhost:' + PORT));
