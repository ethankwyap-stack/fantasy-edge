// Local dev server: static files + the same /api/espn handler Vercel uses.
const http = require('http');
const fs = require('fs');
const path = require('path');
const espn = require('./api/espn.js');

http.createServer((req, res) => {
  if (req.url.startsWith('/api/espn')) return espn(req, res);
  const file = path.join(__dirname, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
  fs.readFile(file, (err, data) => {
    if (err) { res.statusCode = 404; return res.end('not found'); }
    res.setHeader('Content-Type', file.endsWith('.html') ? 'text/html' : 'text/plain');
    res.end(data);
  });
}).listen(4650, () => console.log('Fantasy Edge → http://localhost:4650'));
