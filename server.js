// Serves the dashboard + /api/espn proxy. Runs locally (node server.js) and on Vercel.
const http = require('http');
const fs = require('fs');
const path = require('path');
const espn = require('./api/espn.js');

// ponytail: single-page app — static read so Vercel's bundler traces and includes it
const INDEX = fs.readFileSync(path.join(__dirname, 'index.html'));

const PORT = process.env.PORT || 4650;
http.createServer((req, res) => {
  if (req.url.startsWith('/api/espn')) return espn(req, res);
  res.setHeader('Content-Type', 'text/html');
  res.end(INDEX);
}).listen(PORT, () => console.log('Fantasy Edge → http://localhost:' + PORT));
