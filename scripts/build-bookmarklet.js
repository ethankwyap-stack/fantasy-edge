// Turns bookmarklet.js into the single-line `javascript:` URL you paste into a Safari bookmark.
// Usage: node scripts/build-bookmarklet.js            → live site
//        node scripts/build-bookmarklet.js localhost   → http://localhost:4650 (needs ?key= once)
//        add `league2` → the 10-team league board
const fs = require('fs'), path = require('path');

let src = fs.readFileSync(path.join(__dirname, '..', 'bookmarklet.js'), 'utf8');

if (process.argv.includes('localhost')) {
  src = src.replace("'https://fantasy-edge-lyart.vercel.app/'", "'http://localhost:4650/'")
           .replace("'https://fantasy-edge-lyart.vercel.app'", "'http://localhost:4650'");
}

// `league2` targets the 10-team league board (?league=2). Must run AFTER the localhost
// swap, which matches the bare URL string.
if (process.argv.includes('league2')) src = src.replace(/(vercel\.app|:4650)\/'/, "$1/?league=2'");
// Also rename the target window: both bookmarklets reusing the name 'fe' would fight
// over one tab, and the loser silently navigates the board to the wrong league.
if (process.argv.includes('league2')) src = src.replace("'fe')", "'fe2')");

// ponytail: regex minify, no build tool. Safe only because bookmarklet.js has no
// regex literals, no template strings, and no `//` inside string literals.
const min = src
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/\s*\n\s*/g, ' ')
  .replace(/\s{2,}/g, ' ')
  .trim();

console.log('javascript:' + encodeURI(min).replace(/#/g, '%23'));
