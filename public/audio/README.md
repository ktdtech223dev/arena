# ARENA audio samples (`public/audio/`)

Drop **CC0** `.wav` files here to replace RANGE's synthesized sounds with real
recordings. This directory is served at `/audio/` by Vite in dev and shipped in
`dist/` for prod. **Real files win; any missing file falls back to the procedural
synth** (`src/core/Audio.js`) — the game never breaks and never goes silent if a
file is absent. So this whole folder is optional: ship zero files and ARENA still
sounds like RANGE.

## How it works

- `src/audio/manifest.js` maps each **cue** to a filename here (and to a synth
  fallback name).
- `src/audio/AudioBank.js` `fetch()`es each file on load and decodes it. A
  fetch/decode failure for any cue is **expected and fine** — that cue simply uses
  its synth fallback. Present files are the primary source; they play pooled (rapid
  overlapping shots don't cut off) and positional (PannerNode) for remote players.

## Format

- Container/codec: **`.wav`** (PCM). Mono preferred (positional panning is applied
  by the engine; a stereo file's own panning would fight the 3D panner). 44.1 or
  48 kHz. Keep one-shots short and trimmed (no leading silence) so hits feel tight.
- Normalize to roughly -3 dBFS peak; the master bus has a limiter, so leave a
  little headroom.

## Exact filenames expected

Guns:
- `pistol_fire.wav`
- `smg_fire.wav`
- `shotgun_fire.wav`
- `rifle_fire.wav`
- `sniper_fire.wav`

Reload / weapon mechanics:
- `reload_magout.wav`
- `reload_magin.wav`
- `reload_rack.wav`
- `shell_insert.wav`
- `dryfire.wav`

Movement:
- `footstep_01.wav`
- `footstep_02.wav`
- `footstep_03.wav`
- `footstep_04.wav`  (4 variants; the engine cycles/varies them so steps don't fatigue)
- `jump.wav`
- `land_soft.wav`
- `land_hard.wav`
- `slide.wav`
- `wallrun.wav`

Feedback:
- `hit.wav`
- `hitmarker.wav`
- `kill.wav`
- `equip.wav`

UI:
- `ui_click.wav`

## Where to get CC0 sources

All of these are public-domain / CC0 and safe to drop in with zero attribution
requirements (attribution still appreciated where the source asks):

- **Kenney** — https://kenney.nl/assets (CC0). "Impact Sounds", "Interface Sounds",
  "Sci-Fi Sounds" cover UI, hits, and footsteps.
- **Sonniss GDC Game Audio Bundle** — https://sonniss.com/gameaudiogdc (royalty-free
  for commercial use). Huge gun/foley/impact libraries; grab weapon fire + reload
  foley here.
- **Freesound (CC0 filter)** — https://freesound.org/search/?f=license:%22Creative+Commons+0%22
  Search "pistol fire", "smg", "shotgun", "sniper", "mag out", "footstep concrete",
  "slide", etc., filter to CC0, trim, and rename to the filenames above.

Rename your chosen files to match the list exactly, drop them in this folder, and
they take over automatically on next load — no code changes needed.
