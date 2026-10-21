#!/usr/bin/env node
// Pre-submission gate for Agensi skill zips. Fails loudly on anything their scan or a
// buyer would trip over: personal data, secrets, third-party analyst content, a bad
// folder/frontmatter shape, symlinks, binaries, non-executable scripts.
//
// Usage:
//   node agensi/check.js                 # check every folder in agensi/skills/
//   node agensi/check.js path/to/skill   # check one folder (any location)
//   node agensi/check.js --zip           # check, then build agensi/dist/<name>.zip
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const HERE = __dirname;
const SKILLS = path.join(HERE, 'skills');
const DIST = path.join(HERE, 'dist');

// Personal + licensed strings that must never ship. Lowercase, substring match.
// Analyst names are here because their boards/videos are copyrighted, not ours to resell.
const BANNED = ['ethan', 'lyart', 'ethan16', '253245609', 'hall alumni', 'smyth', 'holka',
  'fsc', 'flock fantasy', 'telegram', 'my_team_id', 'app_secret', 'fe_key', 'portafile'];

// Real secret VALUES from the local .env, read but never printed — a pasted cookie or
// league id is the leak a string list can't anticipate.
function secretValues() {
  try {
    return fs.readFileSync(path.join(HERE, '..', '.env'), 'utf8').split('\n')
      .map(l => l.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, ''))
      .filter(v => v.length >= 6);
  } catch { return []; }
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    return e.isDirectory() && !e.isSymbolicLink() ? walk(p) : [p];
  });
}

function check(dir) {
  const errs = [], name = path.basename(dir);
  const md = path.join(dir, 'SKILL.md');
  if (!fs.existsSync(md)) return [`no SKILL.md at ${name}/SKILL.md`];
  const fm = fs.readFileSync(md, 'utf8').match(/^---\n([\s\S]*?)\n---/);
  if (!fm) errs.push('SKILL.md has no frontmatter');
  else {
    const get = k => (fm[1].match(new RegExp(`^${k}:\\s*(.+)$`, 'm')) || [])[1]?.trim();
    if (get('name') !== name) errs.push(`frontmatter name "${get('name')}" must equal folder "${name}"`);
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) errs.push(`folder "${name}" must be a lowercase-hyphen slug`);
    if (!/^Use when/i.test(get('description') || '')) errs.push('description must start with "Use when"');
  }
  if (!walk(dir).some(f => /references|examples/.test(path.relative(dir, f)))) errs.push('needs at least one references/ or examples/ file');

  const secrets = secretValues();
  for (const f of walk(dir)) {
    const rel = path.relative(dir, f);
    if (fs.lstatSync(f).isSymbolicLink()) { errs.push(`symlink: ${rel}`); continue; }
    if (/(^|\/)(\.DS_Store|Thumbs\.db)$/.test(rel)) { errs.push(`OS junk: ${rel}`); continue; }
    const buf = fs.readFileSync(f);
    if (buf.includes(0)) { errs.push(`binary file: ${rel}`); continue; }
    const text = buf.toString('utf8'), low = text.toLowerCase();
    for (const b of BANNED) if (low.includes(b)) errs.push(`banned string "${b}" in ${rel}`);
    if (secrets.some(s => text.includes(s))) errs.push(`a value from .env appears in ${rel}`);
    if (rel.startsWith('scripts/') && !(fs.statSync(f).mode & 0o111)) errs.push(`not executable: ${rel}`);
  }
  return errs;
}

const args = process.argv.slice(2);
const dirs = args.filter(a => !a.startsWith('--'));
const targets = dirs.length ? dirs.map(d => path.resolve(d))
  : fs.readdirSync(SKILLS).map(d => path.join(SKILLS, d)).filter(d => fs.statSync(d).isDirectory());

let bad = 0;
for (const d of targets) {
  const errs = check(d);
  console.log(`${errs.length ? 'FAIL' : 'ok  '} ${path.basename(d)}`);
  errs.forEach(e => console.log('     - ' + e));
  bad += errs.length;
}
if (bad) process.exit(1);

if (args.includes('--zip')) {
  fs.mkdirSync(DIST, { recursive: true });
  for (const d of targets) {
    const out = path.join(DIST, path.basename(d) + '.zip');
    fs.rmSync(out, { force: true });
    // one top-level folder named after the skill, SKILL.md at its root (Agensi's rule)
    execFileSync('zip', ['-qr', out, path.basename(d), '-x', '*.DS_Store', '*/.fantasy-cache/*'], { cwd: path.dirname(d) });
    console.log(`built ${path.relative(process.cwd(), out)}`);
  }
}
