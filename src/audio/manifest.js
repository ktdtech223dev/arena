// audio/manifest.js — ARENA sample manifest (ARENA-ARCHITECTURE §4 / §8).
//
// Two maps, both keyed by a "cue" (the logical sound event ARENA fires):
//
//   MANIFEST      cue -> real .wav filename (relative to /audio/). AudioBank tries
//                 to fetch+decode each of these; a real sample, when present, is
//                 the PRIMARY source and always wins.
//   CUE_TO_SYNTH  cue -> the existing core/Audio.js synth sound NAME to fall back
//                 to when the .wav is missing / fails to decode. Real files win;
//                 a missing file still plays SOMETHING (never silent, never throws).
//
// The synth names on the right MUST exist in src/core/Audio.js's SOUNDS bank.
// Zero external asset files are required to ship — every cue has a synth fallback.

// cue -> filename under /audio/ (all .wav, CC0 drop-ins; see public/audio/README.md)
export const MANIFEST = {
  // ---- guns ---- (real samples from the Vunsunta firearm pack, transcoded to
  // small mono OGGs; see public/audio/README.md. Missing ones still synth-fallback.)
  pistol_fire:    'pistol_fire.ogg',
  smg_fire:       'smg_fire.ogg',
  shotgun_fire:   'shotgun_fire.ogg',
  ar_fire:        'ar_fire.ogg',
  rifle_fire:     'ar_fire.ogg',      // alias (remote AR fire cue) → same sample
  sniper_fire:    'sniper_fire.ogg',
  dmr_fire:       'dmr_fire.ogg',
  revolver_fire:  'revolver_fire.ogg',
  burst_fire:     'burst_fire.ogg',   // FAMAS-derived; used by the burst rifle

  // ---- reload / weapon mechanics ----
  reload_magout:  'reload_magout.wav',
  reload_magin:   'reload_magin.wav',
  reload_rack:    'reload_rack.wav',
  shell_insert:   'shell_insert.wav',
  dryfire:        'dryfire.wav',

  // ---- movement ----
  footstep_01:    'footstep_01.wav',
  footstep_02:    'footstep_02.wav',
  footstep_03:    'footstep_03.wav',
  footstep_04:    'footstep_04.wav',
  jump:           'jump.wav',
  land_soft:      'land_soft.wav',
  land_hard:      'land_hard.wav',
  slide:          'slide.wav',
  wallrun:        'wallrun.wav',

  // ---- feedback ----
  hit:            'hit.wav',
  hitmarker:      'hitmarker.wav',
  kill:           'kill.wav',
  equip:          'equip.wav',

  // ---- ui ----
  ui_click:       'ui_click.wav',
};

// cue -> synth sound NAME in core/Audio.js SOUNDS (procedural fallback).
// Every cue in MANIFEST is covered here so a missing/failed sample is inaudible-
// difference safe (it just plays the hand-synthesized version instead).
export const CUE_TO_SYNTH = {
  // ---- guns ---- (the synth bank has pistol/smg/shotgun/sniper fire directly;
  // the "rifle" cue maps to the assault-rifle synth 'ar_fire')
  pistol_fire:    'pistol_fire',
  smg_fire:       'smg_fire',
  shotgun_fire:   'shotgun_fire',
  ar_fire:        'ar_fire',
  rifle_fire:     'ar_fire',
  sniper_fire:    'sniper_fire',
  dmr_fire:       'dmr_fire',
  revolver_fire:  'revolver_fire',
  burst_fire:     'ar_fire',   // no dedicated synth for the new burst rifle → AR foley

  // ---- reload / weapon mechanics ----
  // generic reload cues map to the assault-rifle foley (the mid-weight "default"
  // mag-out / mag-in / rack); shell_insert -> shotgun shell foley; dryfire direct.
  reload_magout:  'ar_magout',
  reload_magin:   'ar_magin',
  reload_rack:    'ar_rack',
  shell_insert:   'shotgun_shell',
  dryfire:        'dryfire',

  // ---- movement ---- (all footstep variants share the one synth footstep, which
  // already applies its own pitch/gain variation per play so they don't fatigue)
  footstep_01:    'footstep',
  footstep_02:    'footstep',
  footstep_03:    'footstep',
  footstep_04:    'footstep',
  jump:           'jump',
  land_soft:      'land_soft',
  land_hard:      'land_hard',
  slide:          'slide_start',
  wallrun:        'wallrun_loop',

  // ---- feedback ----
  hit:            'impact_target',
  hitmarker:      'hitmarker',
  kill:           'kill_confirm',
  equip:          'equip',

  // ---- ui ----
  ui_click:       'ui_click',
};
