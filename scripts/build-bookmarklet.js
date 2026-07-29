// Turns bookmarklet.js into the single-line `javascript:` URL you paste into a Safari bookmark.
// Usage: node scripts/build-bookmarklet.js            → live site
//        node scripts/build-bookmarklet.js localhost   → http://localhost:4650 (needs ?key= once)
const fs = require('fs'), path = require('path');

let src = fs.readFileSync(path.join(__dirname, '..', 'bookmarklet.js'), 'utf8');

if (process.argv[2] === 'localhost') {
  src = src.replace("'https://fantasy-edge-lyart.vercel.app/'", "'http://localhost:4650/'")
           .replace("'https://fantasy-edge-lyart.vercel.app'", "'http://localhost:4650'");
}

// ponytail: regex minify, no build tool. Safe only because bookmarklet.js has no
// regex literals, no template strings, and no `//` inside string literals.
const min = src
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/\s*\n\s*/g, ' ')
  .replace(/\s{2,}/g, ' ')
  .trim();

console.log('javascript:' + encodeURI(min).replace(/#/g, '%23'));
