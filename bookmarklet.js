// Fantasy Edge draft sync — paste the minified version of this into a Safari bookmark,
// then click it while inside an ESPN mock draft. It only READS the DOM: zero network
// connections, so it can never disconnect Ethan from his own draft.
// Regenerate the one-liner with: node scripts/build-bookmarklet.js
(function () {
  var FE = 'https://fantasy-edge-lyart.vercel.app/';
  var ORIGIN = 'https://fantasy-edge-lyart.vercel.app';

  // Reuse the same tab across clicks; window.open here runs inside a real click gesture.
  if (!window.__feWin || window.__feWin.closed) window.__feWin = window.open(FE, 'fe');

  var badge = document.getElementById('__feBadge');
  if (!badge) {
    badge = document.createElement('div');
    badge.id = '__feBadge';
    badge.style.cssText = 'position:fixed;bottom:12px;right:12px;z-index:2147483647;background:#0f1420;color:#4ade80;font:12px -apple-system,sans-serif;padding:6px 10px;border-radius:8px;border:1px solid #4ade80';
    document.body.appendChild(badge);
  }

  // ESPN keeps this grid current by itself, so re-reading on a timer is enough.
  // innerText on .completedPick returns "" (cells are off-screen) — must use child textContent.
  function scrape() {
    return [].slice.call(document.querySelectorAll('.completedPick')).map(function (el) {
      function t(sel) { var n = el.querySelector(sel); return n ? (n.textContent || '').trim() : ''; }
      return {
        pick: t('.pick-number'),
        player: (t('.playerFirstName') + ' ' + t('.playerLastName')).trim(),
        team: t('.playerProTeam')
      };
    }).filter(function (p) { return p.player; });
  }

  // Always send the FULL list, so a message lost while the tab was still loading costs nothing.
  function tick() {
    var picks = scrape();
    var open = window.__feWin && !window.__feWin.closed;
    if (open) { try { window.__feWin.postMessage(picks, ORIGIN); } catch (e) {} }
    badge.textContent = 'FE sync: ' + picks.length + ' picks' + (open ? '' : ' — tab closed, click again');
  }

  if (window.__feTimer) clearInterval(window.__feTimer);
  window.__feTimer = setInterval(tick, 2000);
  tick();
})();
