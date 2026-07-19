// Serves the dashboard + /api/espn proxy. Runs locally (node server.js) and on Vercel.
const http = require('http');
const fs = require('fs');
const path = require('path');
const espn = require('./api/espn.js');

// ponytail: single-page app — static read so Vercel's bundler traces and includes it
const INDEX = fs.readFileSync(path.join(__dirname, 'index.html'));
const ANALYSIS_PATH = path.join(__dirname, 'draft-analysis.json');
const ANALYSIS = fs.readFileSync(ANALYSIS_PATH); // static read for Vercel tracing

const PORT = process.env.PORT || 4650;
http.createServer((req, res) => {
  if (req.url.startsWith('/api/espn')) return espn(req, res);
  if (req.url.startsWith('/draft-analysis.json')) {
    res.setHeader('Content-Type', 'application/json');
    // re-read locally so the always-on LaunchAgent picks up a git pull without restart
    try { return res.end(fs.readFileSync(ANALYSIS_PATH)); } catch { return res.end(ANALYSIS); }
  }
  res.setHeader('Content-Type', 'text/html');
  res.end(INDEX);
}).listen(PORT, () => console.log('Fantasy Edge → http://localhost:' + PORT));
