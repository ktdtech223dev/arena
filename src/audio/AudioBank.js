// audio/AudioBank.js — ARENA sample bank with graceful procedural fallback.
//
// Replaces the beep-boop synth as the PRIMARY audio source with real .wav sample
// playback (ARENA-ARCHITECTURE §4 / §8), while keeping RANGE's hand-synthesized
// AudioEngine (core/Audio.js) as the always-available fallback. Design goals:
//
//   - NEVER throw, NEVER block the game loop. loadAll() runs async on construct;
//     the game plays synth fallback until (and if ever) samples arrive.
//   - A fetch/decode FAILURE for a cue is EXPECTED and fine — the file may simply
//     not be shipped. That cue quietly falls back to CUE_TO_SYNTH via ctx.audio.
//   - Real files win. If a buffer loaded for a cue, we play the sample; otherwise
//     we delegate to ctx.audio.play(synthName, {position, volume, rate}).
//   - Pooled AudioBufferSourceNodes so rapid overlapping shots don't cut off (a
//     BufferSource is single-use; we just spawn a fresh one per hit, capped).
//   - Positional playback (PannerNode) when a THREE.Vector3 position is given,
//     matching the AudioEngine panner setup so local + remote audio feel the same.
//   - Routes through ctx.audio.sfxGain, so it inherits the existing settings-driven
//     volMaster / volSfx gains + the master limiter chain (no duplicate wiring).
//
// It reuses ctx.audio for: the AudioContext (ctx.audio.actx), the sfx gain node
// (ctx.audio.sfxGain), the listener (actx.listener, synced by AudioEngine.render),
// and as the procedural fallback engine.

import { MANIFEST, CUE_TO_SYNTH } from './manifest.js';

const AUDIO_BASE = '/audio/'; // Vite serves public/audio/* here (and dist/ in prod)

// Per-cue live-voice cap so a machine-gun cue can't spawn unbounded nodes.
const MAX_VOICES_PER_CUE = 12;

export class AudioBank {
  /**
   * @param {object} ctx  the game context; must carry ctx.audio (AudioEngine).
   */
  constructor(ctx) {
    this.ctx = ctx;
    this.engine = ctx.audio;              // core/Audio.js AudioEngine (fallback + wiring)
    this.actx = ctx.audio?.actx || null;  // shared AudioContext

    this._buffers = new Map();   // cue -> AudioBuffer (only cues whose sample loaded)
    this._failed = new Set();    // cues that failed to load -> use synth fallback
    this._voices = new Map();    // cue -> [{ src, gain, panner, ended }] live sample voices
    this._destroyed = false;

    // `loaded` is a Promise that resolves once loadAll settles (all cues attempted).
    // It also flips the boolean `_ready` true. Never rejects.
    this._ready = false;
    this.loaded = this._loadAll().then(() => { this._ready = true; });
  }

  /* ---- loading ------------------------------------------------------------- */

  async _loadAll() {
    if (!this.actx) return; // no audio context (headless / unsupported) — all synth
    const cues = Object.keys(MANIFEST);
    // Load in parallel; a rejection for any one cue is caught and marked failed.
    await Promise.all(cues.map((cue) => this._loadCue(cue)));
  }

  async _loadCue(cue) {
    const file = MANIFEST[cue];
    if (!file) { this._failed.add(cue); return; }
    try {
      const res = await fetch(AUDIO_BASE + file, { cache: 'force-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const arr = await res.arrayBuffer();
      // decodeAudioData: use the Promise form; some engines still want the callback
      // form, so wrap defensively. Either way a failure lands in catch -> fallback.
      const buf = await this._decode(arr);
      if (this._destroyed) return;
      if (buf) this._buffers.set(cue, buf);
      else this._failed.add(cue);
    } catch {
      // EXPECTED when the .wav isn't shipped — silently mark for synth fallback.
      this._failed.add(cue);
    }
  }

  _decode(arrayBuffer) {
    return new Promise((resolve) => {
      let settled = false;
      const ok = (b) => { if (!settled) { settled = true; resolve(b || null); } };
      const no = () => { if (!settled) { settled = true; resolve(null); } };
      try {
        const p = this.actx.decodeAudioData(arrayBuffer, ok, no);
        // Promise-returning implementations:
        if (p && typeof p.then === 'function') p.then(ok, no);
      } catch {
        no();
      }
    });
  }

  /* ---- public API ---------------------------------------------------------- */

  /**
   * Play a cue. If a real sample loaded for it, play the sample (pooled, optionally
   * positional); otherwise fall back to the core synth via ctx.audio.play().
   *
   * @param {string} cue
   * @param {object} [opts]
   * @param {import('three').Vector3|{x,y,z}|null} [opts.position=null] world pos -> PannerNode
   * @param {number} [opts.volume=1]  linear gain multiplier
   * @param {number} [opts.rate=1]    playbackRate (pitch/speed)
   * @returns {void}
   */
  play(cue, opts = {}) {
    const { position = null, volume = 1, rate = 1 } = opts;
    const buf = this._buffers.get(cue);

    // No sample (never loaded, or failed) -> procedural fallback.
    if (!buf) {
      this._fallback(cue, { position, volume, rate });
      return;
    }

    const actx = this.actx;
    // Before the first user gesture the context is suspended and nothing is audible;
    // skip so a backlog of stale one-shots doesn't burst out on resume (mirrors
    // AudioEngine.play behavior).
    if (!actx || actx.state !== 'running') return;

    try {
      this._playSample(cue, buf, { position, volume, rate });
    } catch {
      // Any node/graph hiccup -> fall back rather than break the game.
      this._fallback(cue, { position, volume, rate });
    }
  }

  _fallback(cue, { position, volume, rate }) {
    const engine = this.engine;
    if (!engine || typeof engine.play !== 'function') return;
    const name = CUE_TO_SYNTH[cue] || cue;
    // AudioEngine.play handles its own positional panning, voice pooling, volume,
    // rate, variation, and settings-driven gains. Never throws.
    engine.play(name, { position: position || null, volume, rate });
  }

  _playSample(cue, buf, { position, volume, rate }) {
    const actx = this.actx;
    const now = actx.currentTime;

    // Cap live voices for this cue: reap ended ones, then steal the oldest if full.
    let pool = this._voices.get(cue);
    if (!pool) { pool = []; this._voices.set(cue, pool); }
    for (let i = pool.length - 1; i >= 0; i--) {
      if (pool[i].ended) pool.splice(i, 1);
    }
    if (pool.length >= MAX_VOICES_PER_CUE) {
      const victim = pool.shift();
      try { victim.src.stop(); } catch { /* already stopped */ }
    }

    const src = actx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = Math.max(0.05, rate);

    const gain = actx.createGain();
    gain.gain.value = Math.max(0, volume);

    let panner = null;
    if (position) {
      panner = actx.createPanner();
      panner.panningModel = 'equalpower';
      panner.distanceModel = 'inverse';
      panner.refDistance = 3;
      panner.maxDistance = 500;
      panner.rolloffFactor = 1;
      if (panner.positionX) {
        panner.positionX.value = position.x;
        panner.positionY.value = position.y;
        panner.positionZ.value = position.z;
      } else {
        panner.setPosition(position.x, position.y, position.z);
      }
      src.connect(panner);
      panner.connect(gain);
    } else {
      src.connect(gain);
    }

    // Route into the existing sfx bus (inherits volSfx/volMaster + limiter).
    const dest = this.engine?.sfxGain || actx.destination;
    gain.connect(dest);

    const voice = { src, gain, panner, ended: false };
    pool.push(voice);

    src.onended = () => {
      voice.ended = true;
      try { src.disconnect(); gain.disconnect(); panner?.disconnect(); } catch { /* gone */ }
      const p = this._voices.get(cue);
      if (p) {
        const i = p.indexOf(voice);
        if (i >= 0) p.splice(i, 1);
      }
    };

    try {
      src.start(now);
    } catch {
      voice.ended = true;
    }
  }

  /* ---- introspection (debug overlay) --------------------------------------- */

  /** @returns {{ loaded:number, fallback:number, total:number, ready:boolean }} */
  stats() {
    const total = Object.keys(MANIFEST).length;
    const loaded = this._buffers.size;
    return {
      loaded,
      fallback: total - loaded, // cues without a real sample (failed OR still loading)
      total,
      ready: this._ready,
    };
  }

  /** True once loadAll has settled (samples that were going to load have loaded). */
  get isReady() { return this._ready; }

  /** Release sample buffers/voices (e.g. leaving ARENA mode). */
  destroy() {
    this._destroyed = true;
    for (const pool of this._voices.values()) {
      for (const v of pool) {
        try { v.src.stop(); v.src.disconnect(); v.gain.disconnect(); v.panner?.disconnect(); } catch { /* gone */ }
      }
    }
    this._voices.clear();
    this._buffers.clear();
  }
}
