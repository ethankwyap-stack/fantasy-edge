---
name: fantasy-video-inject
description: Turn a fantasy football YouTube video (rankings, a stat study, an archetype breakdown) into a draft-guide*.json source that feeds the Fantasy Edge board and research prompt. Use when Ethan pastes a fantasy football video link and wants it "injected" into the research/board — a new analyst source, or a new video from an existing analyst.
---

# Fantasy video inject

Turns a fantasy football YouTube video into a `draft-guide*.json` file in the
repo root, following the pattern documented in `CLAUDE.md` under "Analyst
boards live in `draft-guide*.json`".

## Steps

1. **Watch it.** Use the `/watch` skill on the URL (default `balanced` detail
   is fine; for a long video, `--detail transcript` is enough since these
   videos are almost entirely spoken numbers/reasoning, not visuals worth
   reading frames for — reach for frames only if the value is in an on-screen
   table/graphic, e.g. a draft board render).

2. **Decide: ranked board or note-only study?**
   - A clean, stated 1-N (or 1-N per position) order for most/all of the
     field → give it `posRank` (see `draft-guide.json`, `draft-guide-smyth.json`
     for the shape: `posRank`, optional `tier`/`grade`, `note`).
   - Anything else — a stat-splits exercise, an archetype study, mixed/partial
     rank mentions, reasoning without a full order — → **note-only, no
     `posRank`** (see `draft-guide-fsc-archetypes.json`,
     `draft-guide-smyth-adjusted-ppg.json`). This is the safer default: a
     note-only file feeds its reasoning into the research prompt but casts
     **zero vote** in the board's consensus rank, so it can't silently
     distort VBD/tiers on partial data. Only use `posRank` when the video
     genuinely states an order for the player.

3. **Name the file** `draft-guide-<analyst>[-<topic>].json` — lowercase,
   kebab. If this analyst already has a file for a different video/topic,
   give the new one a distinct suffix rather than overwriting (Smyth has
   `draft-guide-smyth.json` for his QB/TE ranked board and
   `draft-guide-smyth-adjusted-ppg.json` for his adjusted-PPG study — same
   analyst, two files, because the content isn't the same shape).

4. **Write the JSON.** Structure:
   ```json
   {
    "_note": "what this file is, why note-only or ranked, what NOT to extend past",
    "_source": "video URL and title",
    "_updated": "today's date",
    "_confidence": "how the data was captured (captions vs frames), and any name-matching caveats",
    "analyst": "Name",
    "ranksAre": "positional (X only)" | "none - notes only" | etc,
    "players": { "lowercase espn full name": { "posRank": "...", "note": "..." }, ... }
   }
   ```
   Keys MUST be the lowercase ESPN full name — check the exact spelling
   against `draft-guide.json` or `analyst-ranks.json` before writing a key
   (`grep -io '"partial-name[a-z ]*"' draft-guide*.json analyst-ranks.json`).
   Getting this wrong means the entry silently never matches a real player.

5. **Never guess a garbled name.** If captions mangle a name badly enough
   that you're not confident, drop that entry rather than attribute a real
   stat line to the wrong player — a wrong guess corrupts that player's
   consensus rank with someone else's data. Note the drop in `_confidence`.
   If Ethan later confirms who it was (as he did for "Mark" → Marvin
   Harrison Jr.), add the entry back in.

6. **Validate and wire it up:**
   ```bash
   node -e "JSON.parse(require('fs').readFileSync('draft-guide-<file>.json','utf8'))"
   node scripts/draft-research.js --analyst-ranks
   node scripts/draft-research.js --selftest
   ```
   The `--analyst-ranks` run should log one more file in its analyst count
   than before, and the per-analyst vote counts (`{"Smyth":47,...}`) should
   only include `posRank` entries — a note-only file must not appear there.

7. **Document it.** Add one sentence to the "Analyst boards live in
   `draft-guide*.json`" gotcha in `CLAUDE.md` describing the new file: what
   video, ranked or note-only, and why.

## What this does NOT do

- Does not touch the board's tiers/VBD directly — only `--analyst-ranks`
  output (ranked files) and the research prompt (all files) are affected.
- Does not re-run the paid Claude research (`node scripts/draft-research.js`
  with no flags) — that's a separate, explicit, costly step Ethan runs
  himself when he wants fresh writeups.
