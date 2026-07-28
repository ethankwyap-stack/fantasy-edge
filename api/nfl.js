// Free public NFL feeds from ESPN's site API — no key, no account, no cost.
// Slimmed server-side and cached: the raw injuries payload is ~9MB, the slim one ~200KB.
const TTL = 36e5; // 1 hour
// ponytail: plain in-memory cache. Vercel cold starts just refetch — a shared cache
// would mean a KV store (a paid account), and a refetch is free either way.
const cache = {};

const FEEDS = {
  injuries: {
    url: 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/injuries',
    // name (lowercased, to match ESPN fantasy + Sleeper) → latest status + beat-writer note
    slim: j => {
      const out = {};
      for (const team of j.injuries || []) {
        for (const i of team.injuries || []) {
          const n = i.athlete?.displayName;
          if (!n) continue;
          out[n.toLowerCase()] = {
            status: i.status || '',
            pos: i.athlete?.position?.abbreviation || '',
            team: team.displayName || '',
            date: i.date || '',
            note: i.shortComment || i.longComment || ''
          };
        }
      }
      return out;
    }
  },
  news: {
    url: 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?limit=50',
    // headline + the players ESPN tagged in it, so the board can show news per player
    slim: j => (j.articles || []).map(a => ({
      h: a.headline || '',
      d: a.published || '',
      u: a.links?.web?.href || '',
      p: (a.categories || []).filter(c => c.type === 'athlete')
        .map(c => (c.description || c.athlete?.displayName || '').toLowerCase()).filter(Boolean)
    })).filter(a => a.h)
  }
};

module.exports = async (req, res) => {
  const feed = new URL(req.url, 'http://x').searchParams.get('feed');
  const f = FEEDS[feed];
  res.setHeader('Content-Type', 'application/json');
  if (!f) {
    res.statusCode = 400;
    return res.end(JSON.stringify({ error: 'Unknown feed. Use ?feed=injuries or ?feed=news' }));
  }
  const hit = cache[feed];
  if (hit && Date.now() - hit.t < TTL) return res.end(hit.body);
  try {
    const r = await fetch(f.url);
    if (!r.ok) throw new Error('ESPN feed ' + r.status);
    const body = JSON.stringify({ fetched: new Date().toISOString(), data: f.slim(await r.json()) });
    cache[feed] = { t: Date.now(), body };
    res.end(body);
  } catch (e) {
    // stale beats empty — a draft-day blip shouldn't blank the board
    if (hit) return res.end(hit.body);
    res.statusCode = 502;
    res.end(JSON.stringify({ error: String(e), data: feed === 'news' ? [] : {} }));
  }
};
