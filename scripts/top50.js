#!/usr/bin/env node
// Top 50 overall PPR value board, built the same way index.html builds the draft board:
// every source that ranks a player casts ONE equal vote on his POSITIONAL rank, the blended
// fractional rank is read back as points off ESPN's own projection curve, and VBD against a
// 12-team replacement level puts the positions on one scale.
//
// What is different from index.html: that board reads ESPN live for projections + ADP. This
// runs offline against captured boards, because the fantasy data hosts are not reachable from
// every environment. So the market vote here is a real ADP file (FFC mock drafts) and the
// current expert votes are captured boards with their own dates — each source carries `asOf`
// and a stale source is reported, never silently blended in as if it were today's.
//
// Sources live in top50-sources.json. Deliberately NOT named draft-guide*.json: draft-research.js
// globs that pattern and would fork these into extra analyst votes on the draft board.
//
//   node scripts/top50.js            # build top50.json
//   node scripts/top50.js --selftest # assertions, no network, no files written
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const read = f => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));

// 12-team PPR starters: QB1 RB2 WR2 TE1 + FLEX. Same numbers index.html derives at league size 12.
const REPL = { QB: 12, RB: 28, WR: 32, TE: 12 };
// Equal weights, and Smyth as a TIEBREAKER only — identical rule to index.html's consensus():
// his vote triples ONLY when every source already sits within CLOSE positional ranks, so he can
// decide where inside a cluster a player lands but can never overrule a real disagreement.
const WEIGHTS = { market: 1, expert: 1, analyst: 1, espn: 1 };
const FAVOR = { Smyth: 3 }, CLOSE = 5;
// A rate over 1-3 games is arithmetic, not signal (same constant as boom-rates.js).
const MIN_G = 4;

const norm = s => (s || '').toLowerCase()
  .replace(/[.'’]/g, '').replace(/\s+(jr|sr|ii|iii|iv)\b/g, '').replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------- consensus math
// Consensus rank is fractional (RB7.5) but VBD needs POINTS. Read them off the position's own
// projection curve at that rank: the curve's SHAPE is ESPN's, the ORDER is the consensus.
function valueAt(curve, r) {
  const lo = Math.floor(r), hi = Math.ceil(r), last = curve.length - 1;
  const at = i => curve[Math.max(0, Math.min(last, i - 1))] || 0;
  return at(lo) + (at(hi) - at(lo)) * (r - lo);
}

// votes: [{src, rank, w}] on POSITIONAL rank. A source that omits a player casts no vote —
// absence is "not rated", never "rated last". Holka stops at 150, Smyth's board at 60 per
// position, and every captured board has a cutoff.
function blend(votes) {
  const ranks = votes.map(v => v.rank);
  const close = Math.max(...ranks) - Math.min(...ranks) <= CLOSE;
  const w = votes.map(v => (close && FAVOR[v.src] ? v.w * FAVOR[v.src] : v.w));
  const favored = close && votes.some(v => FAVOR[v.src]);
  const tot = w.reduce((a, b) => a + b, 0);
  return { rank: votes.reduce((t, v, i) => t + v.rank * w[i], 0) / tot, favored };
}

// ---------------------------------------------------------------- risk tilt
// Same shape as boomFactor() in index.html: a player who busts less often than his position's
// average is worth slightly more than his raw projection, and vice versa. A player with fewer
// than MIN_G games abstains (factor 1) exactly like a player missing from the file — a bust
// rate off two games would otherwise swing the board on noise.
const BOOM_K = 0.35;
function riskTilt(boom, key, pos, baseline) {
  const b = boom[key];
  if (!b || typeof b.bust !== 'number' || b.pos !== pos || b.g < MIN_G) return { f: 1, why: null };
  if (baseline[pos] == null) return { f: 1, why: null };
  const f = 1 + BOOM_K * (baseline[pos] - b.bust);
  return { f, why: b };
}
function bustBaseline(boom) {
  const out = {};
  for (const pos of Object.keys(REPL)) {
    const all = Object.values(boom).filter(x => x.pos === pos && typeof x.bust === 'number' && x.g >= MIN_G);
    out[pos] = all.length ? all.reduce((t, x) => t + x.bust, 0) / all.length : null;
  }
  return out;
}

// ---------------------------------------------------------------- build
function build() {
  const src = read('top50-sources.json');
  const analystRanks = read('analyst-ranks.json').players;
  const analysis = read('draft-analysis.json').players;
  const boomFile = read('boom-rates.json');
  // boom-rates.json is keyed on the RAW ESPN full name ("ja'marr chase", "kenneth walker iii").
  // Every lookup here is on a norm()-ed key, so the file MUST be re-keyed on load — without this
  // Chase, St. Brown, Achane and Walker all silently "abstain" and read as unrated. That is worse
  // than a visible error: abstention is supposed to mean "no data", so a join miss disguises
  // itself as the absence rule working correctly. A selftest asserts the re-key.
  const boom = {};
  for (const [k, v] of Object.entries(boomFile.players)) boom[norm(k)] = v;
  const vetWR = (() => { try { return read('vet-wr.json'); } catch { return null; } })();
  const rookieWR = (() => { try { return read('rookie-wr.json'); } catch { return null; } })();
  const sos = (() => { try { return read('playoff-sos.json'); } catch { return null; } })();
  const videoNotes = (() => { try { return read('video-notes.json'); } catch { return null; } })();
  const sleepers = (() => { try { return read('expert-sleepers.json'); } catch { return null; } })();

  // --- player registry, keyed on normalized name ---
  const P = new Map();
  const get = (name, pos, team) => {
    const k = norm(name);
    if (!P.has(k)) P.set(k, { key: k, name, pos, team, votes: [], flags: [] });
    const p = P.get(k);
    if (pos && !p.pos) p.pos = pos;
    if (team && !p.team) p.team = team;
    if (name.length > p.name.length) p.name = name;   // prefer the fuller spelling
    return p;
  };

  const stale = [];
  for (const board of src.boards) {
    if (board.staleAsOf) { stale.push(board); continue; }
    // An overall board is converted to POSITIONAL rank, because that is what the votes blend on.
    const seen = {};
    let overall = 0;
    for (const row of board.players) {
      const p = get(row.name, row.pos, row.team);
      seen[row.pos] = (seen[row.pos] || 0) + 1;
      p.votes.push({ src: board.name, kind: board.kind, rank: seen[row.pos], w: WEIGHTS[board.kind] });
      // The board's own OVERALL slot, kept alongside the positional vote. It is not part of the
      // blend (that would double-count the same opinion), but it is the only cross-position scale
      // available, so it breaks VBD ties and shows where the market actually drafts a player.
      (p.overallVotes ||= []).push({ src: board.name, rank: ++overall });
    }
  }

  // --- local analyst boards (Smyth's 2026 PDF board, Holka's top 150) ---
  const analystSeen = {};
  for (const [name, entries] of Object.entries(analystRanks)) {
    for (const e of entries) {
      if (!e.rank || !REPL[e.pos]) continue;
      const p = get(name, e.pos, null);
      p.votes.push({ src: e.analyst, kind: 'analyst', rank: e.rank, w: WEIGHTS.analyst, note: e.note });
      analystSeen[e.analyst] = (analystSeen[e.analyst] || 0) + 1;
    }
  }

  // --- ESPN's own preseason projection: the points CURVE, and one vote on order ---
  // A 0 projection is ESPN saying "not playing", not "ranked low" — index.html's guard. Nothing
  // with a 0 can be rescued onto this board by an analyst's stale July rank.
  const projOf = {};
  for (const [name, a] of Object.entries(analysis)) {
    const k = norm(name);
    projOf[k] = a.proj;
    const p = P.get(k);
    if (p) { p.proj = a.proj; p.verdict = a.verdict; p.report = a.report; p.badges = a.badges; p.floor = a.floor; p.ceiling = a.ceiling; }
  }
  // Position for the curve: the boards give it for the players they rank; boom-rates covers the
  // rest of the pool from last season's actuals.
  const posOf = {};
  for (const p of P.values()) if (p.pos) posOf[p.key] = p.pos;
  for (const [k, b] of Object.entries(boom)) if (!posOf[norm(k)] && REPL[b.pos]) posOf[norm(k)] = b.pos;

  const curve = {};
  for (const pos of Object.keys(REPL)) {
    curve[pos] = Object.keys(projOf)
      .filter(k => posOf[k] === pos && projOf[k] > 0)
      .map(k => projOf[k]).sort((a, b) => b - a);
  }

  // ESPN's projection order is one more vote, but only among players the boards already know —
  // ranking the whole 386-player pool here would let a July projection outvote four August boards.
  for (const pos of Object.keys(REPL)) {
    const rated = [...P.values()].filter(p => p.pos === pos && p.proj > 0).sort((a, b) => b.proj - a.proj);
    rated.forEach((p, i) => p.votes.push({ src: src.espnAsOf ? `ESPN proj (${src.espnAsOf})` : 'ESPN proj', kind: 'espn', rank: i + 1, w: WEIGHTS.espn }));
  }

  // --- blend, price, rank ---
  const baseline = bustBaseline(boom);
  const out = [];
  for (const p of P.values()) {
    if (!p.pos || !REPL[p.pos] || !p.votes.length) continue;
    // Needs at least one CURRENT vote (market or expert). An analyst-only player is one no
    // August board ranks — that is a no, not a sleeper.
    if (!p.votes.some(v => v.kind === 'market' || v.kind === 'expert')) { p.flags.push('no current board ranks him'); continue; }
    const b = blend(p.votes);
    p.consensus = b.rank;
    p.favored = b.favored;
    const c = curve[p.pos];
    p.cval = valueAt(c, b.rank);
    p.vbd = p.cval - valueAt(c, Math.min(REPL[p.pos], c.length));
    const tilt = riskTilt(boom, p.key, p.pos, baseline);
    p.tilt = tilt.f;
    p.boom = tilt.why;
    // The tilt is REPORTED, not ranked on. Two reasons it cannot drive an overall board:
    // (1) the positional bust baseline is an average over every rated player at the position,
    //     so a top-50 player is almost always better than it — the factor is ~+15-25% for
    //     essentially everyone here and ~1.00 for anyone the file misses, which turns "no data"
    //     into a penalty and breaks the absence-casts-no-vote rule in the one place it matters.
    // (2) the mean factor differs BY POSITION (TE ~1.24 vs QB ~1.12 in 2025), so applying it
    //     across positions silently reweights the position scarcity that VBD just computed.
    // index.html applies it only inside the trade engine, where both sides are priced the same
    // way and abstention is symmetric. Here it is an annotation: who is safe, who is volatile.
    p.adjVbd = p.vbd;
    p.mktOverall = p.overallVotes ? p.overallVotes.reduce((t, v) => t + v.rank, 0) / p.overallVotes.length : null;
    out.push(p);
  }
  // ESPN's projection curve is integer points and flat in stretches, so VBD ties are common and
  // the map's insertion order is not a ranking. Break them on the boards' own average overall
  // slot rather than leaving the order to chance.
  out.sort((a, b) => (b.vbd - a.vbd) || ((a.mktOverall ?? 999) - (b.mktOverall ?? 999)));

  // --- annotate the top of the board with every study the repo already ran ---
  // vet-wr.json grades a WR by his PRIOR-SEASON PER-GAME target share, which is the whole point
  // of that study: a season-total share punishes missed games and inverts the read on exactly the
  // players worth buying. Bands: A >=25% share -> 58% WR2 rate, B 20-25% -> 30%, C 15-20% -> 15%,
  // D <15% -> 2%. A WR with no >=4-game prior season is absent, not graded D.
  const vetBand = {};
  if (vetWR) for (const r of (vetWR.live?.rows || [])) if (r.name) vetBand[norm(r.name)] = r;
  // playoff-sos.json ranks weeks 15-17 opponents 1 (stingiest) to 32 (most generous) per position.
  // Graded on LAST season's defenses, so it is a trade/stash signal for October, not a fact about
  // December — the study's own shelf-life note.
  const sosByTeam = {};
  if (sos) for (const r of (sos.rows || [])) sosByTeam[r.team] = r;
  // ESPN and nflverse spell two teams differently and playoff-sos.json is keyed the nflverse way:
  // LAR -> LA and WSH -> WAS. Get the direction wrong and those teams' players silently get no
  // playoff matchup at all rather than an error (it dropped Nacua and Kyren Williams once).
  const TEAM_ALIAS = { WSH: 'WAS', LAR: 'LA' };
  const sleeperPlayers = sleepers?.players || {};

  out.forEach((p, i) => {
    p.overall = i + 1;
    p.posRank = out.filter((x, j) => j <= i && x.pos === p.pos).length;
    if (vetBand[p.key]) p.vetWR = vetBand[p.key];
    const team = TEAM_ALIAS[p.team] || p.team;
    if (sosByTeam[team]) p.playoffSos = { team, opponents: sosByTeam[team].opponents, rank: sosByTeam[team].avgOppDefRank?.[p.pos] ?? null };
    if (videoNotes?.notes?.[p.key]) p.videoNotes = videoNotes.notes[p.key];
    if (sleeperPlayers[p.key]) p.expertSleeper = sleeperPlayers[p.key];
    if (src.newsFlags?.[p.key]) p.news = src.newsFlags[p.key];
  });

  return { out, stale, analystSeen, newsFlags: src.newsFlags || {}, boomStale: boomFile.stale, boomSeason: boomFile.season, sources: src.boards, unranked: [...P.values()].filter(p => p.flags.length) };
}

// ---------------------------------------------------------------- selftest
function selftest() {
  let fail = 0;
  const ok = (c, m) => { if (!c) { console.error('FAIL: ' + m); fail++; } else console.log('  ok — ' + m); };

  // valueAt interpolates, so a half-rank difference cannot round away to nothing.
  ok(Math.abs(valueAt([100, 90, 80], 1.5) - 95) < 1e-9, 'valueAt interpolates between whole ranks');
  ok(valueAt([100, 90, 80], 9) === 80, 'valueAt clamps past the end of the curve');

  // Absence casts no vote: a player two boards omit is blended from the boards that DO rank him.
  ok(Math.abs(blend([{ src: 'A', rank: 10, w: 1 }, { src: 'B', rank: 20, w: 1 }]).rank - 15) < 1e-9,
    'blend averages only the votes that exist');

  // Smyth is a tiebreaker, not an override.
  const closeVote = blend([{ src: 'ESPN', rank: 6, w: 1 }, { src: 'Smyth', rank: 4, w: 1 }]);
  ok(Math.abs(closeVote.rank - 4.5) < 1e-9 && closeVote.favored, 'close vote leans to Smyth (x3)');
  const farVote = blend([{ src: 'ESPN', rank: 12, w: 1 }, { src: 'Smyth', rank: 1, w: 1 }]);
  ok(Math.abs(farVote.rank - 6.5) < 1e-9 && !farVote.favored, 'far vote falls back to equal weights');

  // Risk tilt must abstain on a thin sample rather than tilting the board on noise.
  const base = { WR: 0.30 };
  ok(riskTilt({ x: { pos: 'WR', bust: 0.10, g: 16 } }, 'x', 'WR', base).f > 1, 'low bust rate tilts up');
  ok(riskTilt({ x: { pos: 'WR', bust: 0.50, g: 16 } }, 'x', 'WR', base).f < 1, 'high bust rate tilts down');
  ok(riskTilt({ x: { pos: 'WR', bust: 0.10, g: 2 } }, 'x', 'WR', base).f === 1, 'thin sample abstains (MIN_G)');
  ok(riskTilt({}, 'x', 'WR', base).f === 1, 'missing player abstains');
  ok(riskTilt({ x: { pos: 'RB', bust: 0.10, g: 16 } }, 'x', 'WR', base).f === 1, 'position mismatch abstains');

  // Suffix/punctuation normalization, so "James Cook III" and "Chris Godwin Jr." join.
  ok(norm("Ja'Marr Chase") === 'jamarr chase', 'norm strips apostrophes');
  ok(norm('James Cook III') === 'james cook', 'norm strips suffixes');
  ok(norm('Chris Godwin Jr.') === 'chris godwin', 'norm strips Jr.');

  // The join that already bit once: boom-rates.json keys are raw ESPN names, every lookup is
  // normalized. If the re-key on load is ever removed, these four go back to reading as unrated.
  const rawBoom = require(path.join(ROOT, 'boom-rates.json')).players;
  const rekeyed = {};
  for (const [k, v] of Object.entries(rawBoom)) rekeyed[norm(k)] = v;
  for (const n of ["Ja'Marr Chase", 'Amon-Ra St. Brown', "De'Von Achane", 'Kenneth Walker III'])
    ok(rekeyed[norm(n)] && rekeyed[norm(n)].g >= MIN_G, `boom-rates joins on normalized key: ${n}`);
  ok(!rekeyed[norm('Jeremiyah Love')], 'a 2026 rookie is genuinely absent, not a join miss');

  console.log(fail ? `\n${fail} assertion(s) FAILED` : '\nall assertions passed');
  process.exit(fail ? 1 : 0);
}

if (require.main === module) {
  if (process.argv.includes('--selftest')) selftest();
  const { out, stale, analystSeen, boomStale, boomSeason, sources, unranked, newsFlags } = build();
  console.log(`Sources blended: ${sources.filter(b => !b.staleAsOf).map(b => `${b.name} [${b.asOf}]`).join(', ')}`);
  if (stale.length) console.log(`Stale sources DROPPED: ${stale.map(b => `${b.name} (stamped ${b.staleAsOf})`).join(', ')}`);
  console.log(`Local analyst votes: ${JSON.stringify(analystSeen)}`);
  console.log(`Boom/bust from ${boomSeason}${boomStale ? ' (stale)' : ''}`);
  const flagged = out.slice(0, 50).filter(p => p.news).length;
  console.log(`News flags: ${flagged}/${Object.keys(newsFlags).length} landed inside the top 50 (dated facts, reported not applied — the boards already post-date them)`);
  console.log(`${out.length} players priced; ${unranked.length} had analyst votes but no current board`);
  const f = path.join(ROOT, 'top50.json');
  fs.writeFileSync(f, JSON.stringify({
    generated: new Date().toISOString(),
    sources: sources.map(b => ({ name: b.name, kind: b.kind, asOf: b.asOf, staleAsOf: b.staleAsOf || undefined })),
    boomSeason, boomStale,
    players: out.slice(0, 60).map(p => ({
      overall: p.overall, name: p.name, pos: p.pos, posRank: p.posRank, team: p.team,
      consensus: +p.consensus.toFixed(2), vbd: Math.round(p.vbd),
      mktOverall: p.mktOverall ? +p.mktOverall.toFixed(1) : null,
      overallVotes: p.overallVotes || null,
      tilt: +p.tilt.toFixed(3), proj: p.proj, floor: p.floor, ceiling: p.ceiling,
      votes: p.votes.map(v => ({ src: v.src, rank: v.rank })), favored: p.favored,
      boom: p.boom ? { g: p.boom.g, boom: p.boom.boom, bust: p.boom.bust, median: p.boom.median, sd: p.boom.sd } : null,
      verdict: p.verdict, badges: p.badges,
      vetWR: p.vetWR ? { grade: p.vetWR.grade, share: p.vetWR.share, wr2Rate: p.vetWR.wr2Rate, games: p.vetWR.games } : null,
      playoffSos: p.playoffSos || null,
      videoNotes: p.videoNotes || null, expertSleeper: p.expertSleeper || null,
      news: p.news || null,
    })),
  }, null, 1));
  console.log(`Wrote ${f}`);
  console.log('\n #  POS   PLAYER                    VBD  CONSENSUS  MKT#   MOVE');
  for (const p of out.slice(0, 50)) {
    const mv = p.mktOverall ? Math.round(p.mktOverall) - p.overall : 0;
    console.log(`${String(p.overall).padStart(2)}  ${(p.pos + p.posRank).padEnd(5)} ${p.name.padEnd(24)} ${String(Math.round(p.vbd)).padStart(4)}  ${(p.pos + p.consensus.toFixed(1)).padEnd(9)} ${String(Math.round(p.mktOverall)).padStart(4)}  ${mv > 0 ? '+' + mv : mv}`);
  }
}

module.exports = { valueAt, blend, riskTilt, bustBaseline, norm, REPL, MIN_G };
