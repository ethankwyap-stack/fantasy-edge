#!/usr/bin/env node
// Renders top50.json as a standalone board page. Palette and positional hues are inherited from
// index.html so the page reads as part of the same app, not a separate document.
//   node scripts/top50-page.js [outfile]
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const T = JSON.parse(fs.readFileSync(path.join(ROOT, 'top50.json'), 'utf8'));
const OUT = process.argv[2] || path.join(ROOT, 'site', 'top50.html');

const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const top = T.players.slice(0, 50);
const maxVbd = Math.max(...top.map(p => p.vbd));
// One real cliff device, not a decorative one: mark where VBD drops hard between consecutive
// overall ranks. Same idea as tierize() in index.html — a break is measured, never asserted.
const CLIFF = 10;
const posCount = {};
for (const p of top) posCount[p.pos] = (posCount[p.pos] || 0) + 1;
const movers = [...top].sort((a, b) => (Math.round(b.mktOverall) - b.overall) - (Math.round(a.mktOverall) - a.overall));
const risk = top.filter(p => p.news?.dir === 'risk');

const payload = top.map(p => ({
  o: p.overall, n: p.name, p: p.pos, pr: p.posRank, t: p.team, v: p.vbd,
  c: p.consensus, m: p.mktOverall ? Math.round(p.mktOverall) : null,
  votes: p.votes, ov: p.overallVotes, fav: p.favored,
  proj: p.proj, fl: p.floor, ce: p.ceiling,
  b: p.boom, vd: p.verdict, bg: p.badges, vw: p.vetWR, sos: p.playoffSos,
  vn: p.videoNotes, es: p.expertSleeper, nw: p.news,
}));

const html = `<title>Fantasy Edge Top 50</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700&family=JetBrains+Mono:wght@400;500;700&family=Source+Sans+3:wght@400;600&display=swap">
<style>
/* Palette inherited from index.html so this reads as the same product. Light theme is a
   re-tuned counterpart, not an inversion: the four positional hues keep their identity but
   darken enough to hold contrast on a pale ground. */
:root{
  --ground:#f4f6fa; --surface:#ffffff; --raised:#eef1f7; --line:#dde2ec;
  --text:#131a29; --dim:#5b6478; --faint:#8a94a8;
  --qb:#c02626; --rb:#15803d; --wr:#1d4ed8; --te:#a15c07;
  --good:#15803d; --warn:#a15c07; --bad:#c02626;
  --barbg:#e4e8f0; --shadow:0 1px 2px rgba(19,26,41,.06),0 8px 24px -12px rgba(19,26,41,.14);
}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
  --ground:#0f1420; --surface:#161d2c; --raised:#1a2233; --line:#28324c;
  --text:#e8ecf4; --dim:#8a94a8; --faint:#6b768e;
  --qb:#f87171; --rb:#4ade80; --wr:#60a5fa; --te:#fbbf24;
  --good:#4ade80; --warn:#fbbf24; --bad:#f87171;
  --barbg:#232d45; --shadow:0 1px 2px rgba(0,0,0,.4),0 10px 30px -14px rgba(0,0,0,.7);
}}
:root[data-theme="dark"]{
  --ground:#0f1420; --surface:#161d2c; --raised:#1a2233; --line:#28324c;
  --text:#e8ecf4; --dim:#8a94a8; --faint:#6b768e;
  --qb:#f87171; --rb:#4ade80; --wr:#60a5fa; --te:#fbbf24;
  --good:#4ade80; --warn:#fbbf24; --bad:#f87171;
  --barbg:#232d45; --shadow:0 1px 2px rgba(0,0,0,.4),0 10px 30px -14px rgba(0,0,0,.7);
}
*{box-sizing:border-box}
body{
  background:var(--ground); color:var(--text);
  font:16px/1.6 "Source Sans 3",system-ui,-apple-system,sans-serif;
  margin:0; padding:28px 20px 72px;
}
.wrap{max-width:1080px; margin:0 auto; display:flex; flex-direction:column; gap:28px}
.mono{font-family:"JetBrains Mono",ui-monospace,monospace; font-variant-numeric:tabular-nums}

/* ---- masthead ---- */
header{display:flex; flex-direction:column; gap:10px}
.eyebrow{
  font-family:"JetBrains Mono",monospace; font-size:11px; letter-spacing:.14em;
  text-transform:uppercase; color:var(--faint);
}
h1{
  font-family:Archivo,system-ui,sans-serif; font-weight:700; font-size:clamp(30px,5vw,44px);
  letter-spacing:-.025em; line-height:1.05; margin:0; text-wrap:balance;
}
.standfirst{color:var(--dim); max-width:64ch; margin:0}
.standfirst b{color:var(--text); font-weight:600}

/* ---- provenance ---- */
.sources{
  display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:1px;
  background:var(--line); border:1px solid var(--line); border-radius:10px; overflow:hidden;
}
.src{background:var(--surface); padding:10px 12px; display:flex; flex-direction:column; gap:2px}
.src .who{font-weight:600; font-size:13px; line-height:1.3}
.src .when{font-family:"JetBrains Mono",monospace; font-size:11px; color:var(--faint)}
.src .kind{
  font-family:"JetBrains Mono",monospace; font-size:10px; letter-spacing:.08em;
  text-transform:uppercase; color:var(--dim);
}

/* ---- stat tiles ---- */
.tiles{display:grid; grid-template-columns:repeat(auto-fit,minmax(190px,1fr)); gap:12px}
.tile{
  background:var(--surface); border:1px solid var(--line); border-radius:10px;
  padding:14px 16px; display:flex; flex-direction:column; gap:4px; box-shadow:var(--shadow);
}
.tile .lbl{
  font-family:"JetBrains Mono",monospace; font-size:10px; letter-spacing:.1em;
  text-transform:uppercase; color:var(--faint);
}
.tile .big{font-family:Archivo,sans-serif; font-weight:700; font-size:26px; letter-spacing:-.02em}
.tile .sub{font-size:13px; color:var(--dim); line-height:1.4}
.split{display:flex; gap:10px; align-items:baseline; flex-wrap:wrap}
.split span{font-family:"JetBrains Mono",monospace; font-weight:700; font-size:19px}

/* ---- filters ---- */
.filters{display:flex; gap:7px; flex-wrap:wrap; align-items:center}
.fchip{
  background:var(--surface); border:1px solid var(--line); color:var(--dim);
  border-radius:7px; padding:5px 12px; font-size:13px; font-weight:600; cursor:pointer;
  font-family:"Source Sans 3",sans-serif;
}
.fchip:hover{border-color:var(--faint)}
.fchip[aria-pressed="true"]{background:var(--text); color:var(--ground); border-color:var(--text)}
.fchip:focus-visible{outline:2px solid var(--wr); outline-offset:2px}

/* ---- board ---- */
.board{border:1px solid var(--line); border-radius:12px; overflow:hidden; background:var(--surface); box-shadow:var(--shadow)}
.head,.row{display:grid; grid-template-columns:44px 58px minmax(150px,1.4fr) minmax(110px,1fr) 74px 62px; gap:12px; align-items:center}
.head{
  padding:9px 16px; border-bottom:1px solid var(--line); background:var(--raised);
  font-family:"JetBrains Mono",monospace; font-size:10px; letter-spacing:.1em;
  text-transform:uppercase; color:var(--faint);
}
.head .r,.row .r{text-align:right}
.rowwrap{border-bottom:1px solid var(--line)}
.rowwrap:last-child{border-bottom:0}
.row{
  width:100%; padding:9px 16px; background:none; border:0; text-align:left;
  color:inherit; font:inherit; cursor:pointer;
}
.row:hover{background:var(--raised)}
.row:focus-visible{outline:2px solid var(--wr); outline-offset:-2px}
.rank{font-family:"JetBrains Mono",monospace; font-weight:700; font-size:15px; color:var(--dim); text-align:right}
.pos{
  font-family:"JetBrains Mono",monospace; font-weight:700; font-size:12px;
  padding:2px 0; border-radius:5px; text-align:center; letter-spacing:.02em;
}
.pos-QB{color:var(--qb); background:color-mix(in srgb,var(--qb) 13%,transparent)}
.pos-RB{color:var(--rb); background:color-mix(in srgb,var(--rb) 13%,transparent)}
.pos-WR{color:var(--wr); background:color-mix(in srgb,var(--wr) 13%,transparent)}
.pos-TE{color:var(--te); background:color-mix(in srgb,var(--te) 13%,transparent)}
.who{display:flex; flex-direction:column; min-width:0}
.who .nm{font-weight:600; letter-spacing:-.01em; line-height:1.25; overflow:hidden; text-overflow:ellipsis; white-space:nowrap}
.who .tm{font-family:"JetBrains Mono",monospace; font-size:10.5px; color:var(--faint); letter-spacing:.06em}
.bar{height:9px; border-radius:3px; background:var(--barbg); overflow:hidden}
.bar i{display:block; height:100%; border-radius:3px}
.vbd{font-family:"JetBrains Mono",monospace; font-weight:700; font-size:14px; text-align:right}
.mv{font-family:"JetBrains Mono",monospace; font-size:12px; font-weight:700; text-align:right}
.mv.up{color:var(--good)} .mv.dn{color:var(--bad)} .mv.flat{color:var(--faint)}
.cliff{
  display:flex; align-items:center; gap:10px; padding:6px 16px;
  background:var(--raised); border-bottom:1px solid var(--line);
  font-family:"JetBrains Mono",monospace; font-size:11px; color:var(--dim); letter-spacing:.05em;
}
.cliff::before,.cliff::after{content:""; flex:1; height:1px; background:var(--line)}

/* ---- expanded detail ---- */
.detail{padding:2px 16px 18px 16px; background:var(--raised); display:flex; flex-direction:column; gap:14px}
.detail[hidden]{display:none}
.verdict{font-size:15px; line-height:1.5; margin:0; max-width:70ch}
.votes{display:flex; gap:6px; flex-wrap:wrap}
.vote{
  font-family:"JetBrains Mono",monospace; font-size:11px; background:var(--surface);
  border:1px solid var(--line); border-radius:6px; padding:3px 8px; color:var(--dim);
}
.vote b{color:var(--text)}
.vote.fav{border-color:var(--te); color:var(--te)}
.facts{display:grid; grid-template-columns:repeat(auto-fit,minmax(190px,1fr)); gap:10px}
.fact{background:var(--surface); border:1px solid var(--line); border-radius:8px; padding:9px 11px}
.fact .k{
  font-family:"JetBrains Mono",monospace; font-size:9.5px; letter-spacing:.1em;
  text-transform:uppercase; color:var(--faint); display:block; margin-bottom:3px;
}
.fact .v{font-size:13.5px; line-height:1.45}
.note{
  border-left:3px solid var(--line); padding:2px 0 2px 12px; font-size:13.5px;
  line-height:1.5; color:var(--dim); max-width:72ch;
}
.note.risk{border-left-color:var(--bad)}
.note.tailwind{border-left-color:var(--good)}
.note b{color:var(--text); font-weight:600}
.note .stamp{font-family:"JetBrains Mono",monospace; font-size:11px; color:var(--faint)}
.tags{display:flex; gap:5px; flex-wrap:wrap}
.tag{
  font-family:"JetBrains Mono",monospace; font-size:10px; letter-spacing:.04em;
  background:var(--surface); border:1px solid var(--line); border-radius:5px;
  padding:2px 7px; color:var(--dim);
}
.tag.warnflag{color:var(--bad); border-color:color-mix(in srgb,var(--bad) 45%,var(--line))}
.tag.goodflag{color:var(--good); border-color:color-mix(in srgb,var(--good) 45%,var(--line))}

/* ---- method ---- */
.method{border-top:1px solid var(--line); padding-top:20px; display:flex; flex-direction:column; gap:12px}
.method h2{font-family:Archivo,sans-serif; font-size:15px; font-weight:700; letter-spacing:.01em; margin:0}
.method p{margin:0; font-size:14px; color:var(--dim); max-width:78ch; line-height:1.6}
.method b{color:var(--text); font-weight:600}
.method ul{margin:0; padding-left:18px; display:flex; flex-direction:column; gap:6px}
.method li{font-size:14px; color:var(--dim); max-width:76ch}

@media (max-width:640px){
  body{padding:20px 12px 56px}
  .head,.row{grid-template-columns:32px 50px minmax(0,1fr) 58px 50px; gap:8px}
  .head .barh,.row .bar{display:none}
  .detail,.row,.head,.cliff{padding-left:12px; padding-right:12px}
}
@media (prefers-reduced-motion:reduce){*{animation:none!important; transition:none!important}}
</style>

<div class="wrap">
<header>
  <div class="eyebrow">Fantasy Edge &middot; 12-team PPR &middot; ${esc(T.generated.slice(0, 10))}</div>
  <h1>The top 50, priced by six boards at once</h1>
  <p class="standfirst">Every source that ranks a player casts <b>one equal vote</b> on his positional rank. The blended rank is read back as points off ESPN's own projection curve, then <b>value over replacement</b> puts a QB, an RB and a tight end on the same scale. Tap any row for the six votes behind it.</p>
</header>

<section class="sources" aria-label="Sources">
${T.sources.filter(s => !s.staleAsOf).map(s => `  <div class="src"><span class="kind">${esc(s.kind)}</span><span class="who">${esc(s.name)}</span><span class="when">${esc(s.asOf)}</span></div>`).join('\n')}
  <div class="src"><span class="kind">analyst</span><span class="who">Smyth &mdash; 2026 PDF board</span><span class="when">184 ranked</span></div>
  <div class="src"><span class="kind">analyst</span><span class="who">Holka &mdash; top 150</span><span class="when">150 ranked</span></div>
</section>

<section class="tiles" aria-label="Summary">
  <div class="tile">
    <span class="lbl">Positional split, top 50</span>
    <div class="split">
      ${['RB', 'WR', 'QB', 'TE'].map(k => `<span class="pos-${k}" style="background:none;padding:0">${posCount[k] || 0} ${k}</span>`).join('')}
    </div>
    <span class="sub">Replacement sits at RB28 / WR32 / QB12 / TE12, so the backs stack early.</span>
  </div>
  <div class="tile">
    <span class="lbl">Biggest cliff</span>
    <span class="big mono">after&nbsp;#8</span>
    <span class="sub">Jonathan Taylor to CeeDee Lamb drops 30 points &mdash; more than the next eleven gaps combined. A smaller 12-point step sits after #5.</span>
  </div>
  <div class="tile">
    <span class="lbl">Board is highest on</span>
    <span class="big">${esc(movers[0].name.split(' ').slice(-1)[0])} <span class="mono" style="color:var(--good)">+${Math.round(movers[0].mktOverall) - movers[0].overall}</span></span>
    <span class="sub">${esc(movers[0].name)} goes ${Math.round(movers[0].mktOverall)} on the market, ${movers[0].overall} here. ${esc(movers[1].name)} (+${Math.round(movers[1].mktOverall) - movers[1].overall}) and ${esc(movers[2].name)} (+${Math.round(movers[2].mktOverall) - movers[2].overall}) follow.</span>
  </div>
  <div class="tile">
    <span class="lbl">Carrying a health flag</span>
    <span class="big mono">${risk.length}</span>
    <span class="sub">${risk.map(p => esc(p.name)).join(', ')} &mdash; all already priced in, see the note.</span>
  </div>
</section>

<div class="filters" role="group" aria-label="Filter by position">
  <button class="fchip" aria-pressed="true" data-f="ALL">All 50</button>
  <button class="fchip" aria-pressed="false" data-f="RB">RB</button>
  <button class="fchip" aria-pressed="false" data-f="WR">WR</button>
  <button class="fchip" aria-pressed="false" data-f="QB">QB</button>
  <button class="fchip" aria-pressed="false" data-f="TE">TE</button>
  <button class="fchip" aria-pressed="false" data-f="FLAG">News flags</button>
</div>

<div class="board">
  <div class="head" aria-hidden="true">
    <div class="r">#</div><div>Pos</div><div>Player</div><div class="barh">Value over replacement</div><div class="r">VBD</div><div class="r">vs mkt</div>
  </div>
  <div id="rows"></div>
</div>

<section class="method">
  <h2>How this was built &mdash; and what it can't tell you</h2>
  <p>Six sources vote: three current boards (<b>Field Yates</b>, the <b>CBS consensus</b> of Eisenberg/Richard/Cummings, and <b>FFC's ADP</b> from 7,658 mock drafts run Aug 17&ndash;24), two analyst boards already in the repo (<b>Smyth's</b> 2026 PDF board and <b>Holka's</b> top 150), and <b>ESPN's own projection order</b>. All six rank all fifty of these players, so nothing here rests on a single opinion.</p>
  <ul>
    <li><b>A source that omits a player casts no vote.</b> Absence means "not rated", never "rated last" &mdash; the same rule the draft board uses.</li>
    <li><b>Smyth breaks ties, he doesn't overrule.</b> His vote triples only when every source already sits within five positional ranks of the others; where they genuinely disagree it drops back to equal weight.</li>
    <li><b>Boom/bust is shown, not ranked on.</b> It comes from 2025 and its positional baseline averages every rated player, so it flatters almost everyone in a top 50 and abstains entirely for anyone missing &mdash; which would quietly turn "no data" into a penalty.</li>
    <li><b>The injury news is reported, not applied.</b> Every board here was published on or after Aug 24, and Love's ankle, Hall's groin and the Higgins ACL all broke before that. The market has already priced them; moving players by hand would count the same news twice.</li>
    <li><b>Playoff strength of schedule grades weeks 15&ndash;17 on last season's defenses.</b> That makes it an October trade signal, not a fact about December.</li>
  </ul>
  <p>Rank order is value over replacement, which is why it parts company with straight ADP: it rewards scarcity at a position, so it lifts an early QB1 and a bell-cow back above receivers the market drafts sooner. The <b>vs mkt</b> column is that disagreement, in draft slots.</p>
</section>
</div>

<script>
const P = ${JSON.stringify(payload)};
const MAX = ${maxVbd}, CLIFF = ${CLIFF};
const rows = document.getElementById('rows');
const hue = p => 'var(--' + p.toLowerCase() + ')';
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
let filter = 'ALL';

function detail(p) {
  const bits = [];
  if (p.vd) bits.push('<p class="verdict">' + esc(p.vd) + '</p>');

  bits.push('<div class="votes">' + p.votes.map(v =>
    '<span class="vote' + (p.fav && v.src === 'Smyth' ? ' fav' : '') + '">' + esc(v.src) + ' <b>' + esc(p.p) + v.rank + '</b></span>'
  ).join('') + (p.fav ? '<span class="vote fav">close vote &mdash; Smyth weighted &times;3</span>' : '') + '</div>');

  const f = [];
  if (p.m) f.push(['Market draft slot', 'Goes <b>' + p.m + '</b> overall &mdash; ' + (p.m > p.o ? 'this board is ' + (p.m - p.o) + ' slots higher' : p.m < p.o ? 'this board is ' + (p.o - p.m) + ' slots lower' : 'the board agrees')]);
  if (p.proj) f.push(['ESPN projection', '<b>' + p.proj + '</b> pts' + (p.fl && p.ce ? ' &middot; floor ' + p.fl + ' / ceiling ' + p.ce : '')]);
  if (p.b && p.b.g >= 4) f.push(['2025 weekly shape', '<b>' + Math.round(p.b.boom * 100) + '%</b> boom / <b>' + Math.round(p.b.bust * 100) + '%</b> bust over ' + p.b.g + ' games &middot; median ' + p.b.median]);
  else f.push(['2025 weekly shape', '<span style="color:var(--faint)">no rated season &mdash; abstains</span>']);
  if (p.vw) f.push(['Prior per-game target share', 'Band <b>' + esc(p.vw.grade) + '</b> &middot; ' + p.vw.share + '% &rarr; ' + p.vw.wr2Rate + '% hit a top-24 season']);
  if (p.sos && p.sos.rank != null) f.push(['Playoff weeks 15&ndash;17', esc(p.sos.opponents.join(', ')) + ' &middot; avg def rank <b>' + p.sos.rank + '</b>/32']);
  bits.push('<div class="facts">' + f.map(([k, v]) => '<div class="fact"><span class="k">' + k + '</span><span class="v">' + v + '</span></div>').join('') + '</div>');

  if (p.nw) bits.push('<div class="note ' + esc(p.nw.dir) + '"><span class="stamp">' + esc(p.nw.date) + ' &middot; ' + esc(p.nw.src) + '</span><br>' + esc(p.nw.note) + '</div>');
  if (p.es) bits.push('<div class="note"><b>Expert sleeper call</b> &mdash; ' + esc(typeof p.es === 'string' ? p.es : (p.es.why || '')) + '</div>');
  if (p.vn) for (const n of p.vn) bits.push('<div class="note"><span class="stamp">' + esc(n.analyst) + ' &middot; week ' + n.week + '</span><br>' + esc(n.note) + '</div>');
  if (p.bg && p.bg.length) bits.push('<div class="tags">' + p.bg.map(b => '<span class="tag">' + esc(b) + '</span>').join('') + '</div>');
  return bits.join('');
}

function render() {
  let html = '', prev = null;
  for (const p of P) {
    const show = filter === 'ALL' ? true : filter === 'FLAG' ? !!p.nw : p.p === filter;
    if (filter === 'ALL' && prev && prev.v - p.v >= CLIFF) {
      html += '<div class="cliff">' + (prev.v - p.v) + '-point drop</div>';
    }
    prev = p;
    if (!show) continue;
    const mv = p.m ? p.m - p.o : 0;
    const cls = mv > 0 ? 'up' : mv < 0 ? 'dn' : 'flat';
    html += '<div class="rowwrap">' +
      '<button class="row" aria-expanded="false" data-o="' + p.o + '">' +
        '<span class="rank">' + p.o + '</span>' +
        '<span class="pos pos-' + p.p + '">' + p.p + p.pr + '</span>' +
        '<span class="who"><span class="nm">' + esc(p.n) + (p.nw ? ' <span class="tag ' + (p.nw.dir === 'risk' ? 'warnflag' : 'goodflag') + '">' + (p.nw.dir === 'risk' ? 'watch' : 'trending up') + '</span>' : '') + '</span>' +
          '<span class="tm">' + esc(p.t || '') + ' &middot; consensus ' + p.p + p.c + '</span></span>' +
        '<span class="bar"><i style="width:' + Math.max(2, Math.round(p.v / MAX * 100)) + '%;background:' + hue(p.p) + '"></i></span>' +
        '<span class="vbd" style="color:' + hue(p.p) + '">' + p.v + '</span>' +
        '<span class="mv ' + cls + '">' + (mv > 0 ? '+' + mv : mv === 0 ? '&mdash;' : mv) + '</span>' +
      '</button>' +
      '<div class="detail" hidden id="d' + p.o + '">' + detail(p) + '</div>' +
    '</div>';
  }
  rows.innerHTML = html;
}

rows.addEventListener('click', e => {
  const btn = e.target.closest('.row'); if (!btn) return;
  const d = document.getElementById('d' + btn.dataset.o);
  const open = btn.getAttribute('aria-expanded') === 'true';
  btn.setAttribute('aria-expanded', String(!open));
  d.hidden = open;
});

document.querySelectorAll('.fchip').forEach(b => b.addEventListener('click', () => {
  filter = b.dataset.f;
  document.querySelectorAll('.fchip').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  render();
}));

render();
</script>`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, html);
console.log(`Wrote ${OUT} (${(html.length / 1024).toFixed(1)} KB, ${top.length} players)`);
