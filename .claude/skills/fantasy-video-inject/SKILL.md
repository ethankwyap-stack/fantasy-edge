---
name: fantasy-video-inject
description: Turn a fantasy football video or TikTok (waiver targets, buy-low/sell-high, start/sit, usage takes) into a week-tagged entry in video-notes.json, which feeds the waiver-alert Claude prompt and the Start/Sit + Trades tabs. Use when Ethan pastes a fantasy football video/TikTok link in-season and wants it "injected".
---

# Fantasy video inject (in-season)

The draft is over. Videos no longer become analyst *boards* — a season-long
`posRank` is meaningless once games are being played, and the board's
consensus rank is a draft-day mechanism. In-season, a video becomes a
**week-tagged note** in `video-notes.json`.

Read: notes are **opinion, never value math.** They never touch VBD, tiers,
consensus rank, or trade valuations. They render as text and they go into the
Claude prompt — that's it.

## Where a note ends up

| Consumer | What it does |
|---|---|
| `scripts/waiver-alert.js` | Injects fresh notes into the Claude prompt under "Video/podcast takes I injected", explicitly ranked below the usage data |
| `index.html` Start/Sit tab | 🎬 line under the player's name |
| `index.html` Trades tab | 🎬 line under any proposal involving that player |

Served by `server.js` at `/video-notes.json` (static literal path — Vercel only
bundles files it can trace; don't make it dynamic).

## Steps

1. **Watch it.** `/watch` on the URL. `--detail transcript` is enough for a
   talking-head take; reach for frames only if the value is in an on-screen
   table (a snap-count chart, a target-share graphic).

   TikToks work the same way — yt-dlp handles them. A 60-second TikTok is
   usually ONE take about ONE player: that's a single note, not a file.

2. **Pull only the takes that are actionable this week.** Season-long
   "he's a top-12 WR" is worthless now. What's worth a note:
   - waiver/FAAB targets and a stated bid or priority
   - buy-low / sell-high calls, with the reason
   - start/sit leans, especially matchup- or usage-based
   - a role change (snaps, routes, red-zone work, a backfield split)
   - an injury read that's more specific than the wire's "questionable"

   Drop hot takes with no mechanism behind them. A note is only useful if it
   tells Claude something the usage numbers don't already say.

3. **Append to `video-notes.json`.** One file, all analysts. Shape:

   ```json
   {
     "_note": "...", "_ttlWeeks": 3, "_updated": "YYYY-MM-DD",
     "notes": {
       "lowercase espn full name": [
         { "week": 7, "analyst": "Smyth", "note": "…", "source": "video URL" }
       ]
     }
   }
   ```

   - `week` is **REQUIRED** — it's the NFL week the take was made, and it's
     what makes the note expire. A note without it is treated as week 0 and
     vanishes immediately. Get the current week from the app header or
     `league.scoringPeriodId`; don't guess it from the date.
   - `analyst` is the person's name, so Ethan can see whose take it is. Unlike
     the draft guides, a duplicate name here is harmless — nobody votes.
   - Each name maps to an **array**; append, never overwrite. Two analysts on
     the same player is signal.
   - `note` is one or two sentences carrying the *reason*, not the verdict.
     "Start him" is useless; "Start him — Ravens are 30th vs TE and he ran 82%
     of routes in Week 6" is a note.

4. **Names must be the lowercase ESPN full name.** Same rule as the draft
   guides — a wrong key silently matches nobody:
   ```bash
   grep -io '"partial-name[a-z ]*"' draft-guide.json analyst-ranks.json
   ```
   Never guess a garbled name. Drop the entry and say so.

5. **Prune while you're in there.** Anything older than `_ttlWeeks` (3) is
   already filtered out of both consumers, so it's dead weight — delete
   expired entries rather than letting the file grow all season. Bump
   `_updated`.

6. **Validate:**
   ```bash
   node -e "JSON.parse(require('fs').readFileSync('video-notes.json','utf8'))"
   node --env-file=.env scripts/waiver-alert.js   # dry run w/o API key
   ```
   The dry run prints the prompt — confirm your note appears under
   "Video/podcast takes I injected" with the right week tag. If it doesn't,
   the name key didn't match or the week is past TTL.

   Front-end check: restart `node server.js` (it caches index.html at
   startup), open the Start/Sit tab, look for the 🎬 line. The `vnotesOf`
   console.assert block covers TTL + tagging on every page load.

7. **No CLAUDE.md edit needed** for a routine note — the file is a data drop,
   not a new code path. Do update CLAUDE.md if you change the note *shape* or
   the TTL.

## What this does NOT do

- Does not create `draft-guide*.json` files. Those are frozen draft-day
  sources. If Ethan wants a pre-draft board injected next August, use git
  history for the old version of this skill.
- Does not change any number in the app. If a video convinces you a player's
  value is wrong, that's a note explaining why — not an edit to a rank.
- Does not run the paid research script.
