// core/Audio.js — AudioEngine: the entire synthesized sound suite for RANGE.
//
// ZERO samples, zero files. Every sound in ARCHITECTURE.md §7 is hand-synthesized
// into an AudioBuffer at init (sample-by-sample DSP: filtered noise bursts, tone
// sweeps, decaying inharmonic partials, soft-clip distortion, feedback-comb boom
// tails), so playback is just a cheap AudioBufferSourceNode.
//
// Node chain (contract §5.A): sfxGain -> [tone filter] -> masterGain ->
// DynamicsCompressor (limiter-ish: threshold -10, ratio 12) -> destination.
//
// - play(name, { volume, rate, position (THREE.Vector3-like), delay })
// - startLoop(name, { volume, position }) -> { stop(fadeSec), setVolume, setRate }
// - render(dt) syncs the AudioContext listener to ctx.camera world transform.
// - Resumes the AudioContext on first pointerdown/keydown (own window listeners).
// - volMaster / volSfx read from settings at init + live via settings.onChange.
// - ±variation random pitch/gain per play (default 4%) so repetition never fatigues.
// - ~32 voice cap; steals the quietest/oldest one-shot gracefully.
// - Unknown names: console.warn once per name, return a no-op handle. Never throw.

const TAU = Math.PI * 2;

/* ========================================================================== */
/* DSP toolkit — all functions ADD into a Float32Array at sample rate `sr`.   */
/* ========================================================================== */

// Shared attack / hold / exp-decay envelope. tau <= 0 means sustain forever.
function envAt(t, attack, hold, tau) {
  if (t < attack) return attack > 0 ? t / attack : 1;
  if (t < attack + hold) return 1;
  return tau > 0 ? Math.exp(-(t - attack - hold) / tau) : 1;
}

// Filtered noise burst. Swept one-pole lowpass lp0 -> lp1 (exp) over `dur`,
// optional one-pole highpass, optional pink-noise coloration (Paul Kellet).
function addNoise(out, sr, o) {
  const t0 = o.t0 || 0;
  const dur = o.dur;
  const attack = o.attack ?? 0.0015;
  const hold = o.hold || 0;
  const tau = o.tau ?? dur * 0.25;
  const lp0 = o.lp0 ?? o.lp ?? 20000;
  const lp1 = o.lp1 ?? lp0;
  const hp = o.hp || 0;
  const gain = o.gain ?? 1;
  const pink = !!o.pink;

  const i0 = Math.max(0, Math.floor(t0 * sr));
  const n = Math.min(out.length - i0, Math.floor(dur * sr));
  if (n <= 0) return;

  const lpRatio = lp1 / lp0;
  const hpA = hp > 0 ? 1 - Math.exp(-TAU * hp / sr) : 0;
  let lpS = 0, hpS = 0;
  let b0 = 0, b1 = 0, b2 = 0; // pink filter state

  for (let k = 0; k < n; k++) {
    const t = k / sr;
    const env = envAt(t, attack, hold, tau);
    if (env < 0.0005 && t > attack + hold) break;

    let x = Math.random() * 2 - 1;
    if (pink) {
      b0 = 0.99765 * b0 + x * 0.0990460;
      b1 = 0.96300 * b1 + x * 0.2965164;
      b2 = 0.57000 * b2 + x * 1.0526913;
      x = (b0 + b1 + b2 + x * 0.1848) * 0.25;
    }
    const fc = lp0 * Math.pow(lpRatio, t / dur);
    const a = 1 - Math.exp(-TAU * fc / sr);
    lpS += a * (x - lpS);
    x = lpS;
    if (hpA > 0) { hpS += hpA * (x - hpS); x -= hpS; }
    out[i0 + k] += x * env * gain;
  }
}

// Oscillator with exponential (default) or linear freq sweep f0 -> f1 over dur,
// optional vibrato. type: 'sine' | 'tri' | 'saw' | 'square'.
function addTone(out, sr, o) {
  const t0 = o.t0 || 0;
  const dur = o.dur;
  const f0 = o.f0;
  const f1 = o.f1 ?? f0;
  const type = o.type || 'sine';
  const attack = o.attack ?? 0.002;
  const hold = o.hold || 0;
  const tau = o.tau ?? dur * 0.25;
  const gain = o.gain ?? 1;
  const vibHz = o.vibHz || 0;
  const vibDepth = o.vibDepth || 0;
  const lin = o.curve === 'lin';

  const i0 = Math.max(0, Math.floor(t0 * sr));
  const n = Math.min(out.length - i0, Math.floor(dur * sr));
  if (n <= 0) return;

  const ratio = f1 / f0;
  let p = 0;

  for (let k = 0; k < n; k++) {
    const t = k / sr;
    const env = envAt(t, attack, hold, tau);
    if (env < 0.0005 && t > attack + hold) break;

    let f = lin ? f0 + (f1 - f0) * (t / dur) : f0 * Math.pow(ratio, t / dur);
    if (vibDepth) f *= 1 + vibDepth * Math.sin(TAU * vibHz * t);
    p += f / sr;
    const ph = p - Math.floor(p);

    let s;
    switch (type) {
      case 'saw':    s = 2 * ph - 1; break;
      case 'square': s = ph < 0.5 ? 1 : -1; break;
      case 'tri':    s = 4 * Math.abs(ph - 0.5) - 1; break;
      default:       s = Math.sin(TAU * ph);
    }
    out[i0 + k] += s * env * gain;
  }
}

// Sum of exponentially decaying sines — metallic rings, dings, click bodies.
// partials: [{ f, a, tau }]
function addPartials(out, sr, o) {
  const t0 = o.t0 || 0;
  const gain = o.gain ?? 1;
  const attack = o.attack ?? 0.0008;
  for (const p of o.partials) {
    addTone(out, sr, {
      t0, dur: attack + p.tau * 7, f0: p.f, attack, tau: p.tau, gain: gain * p.a,
    });
  }
}

// Whole-buffer tanh soft clip (drive >= 1 adds grit and glues layers).
function softClip(buf, drive) {
  const norm = Math.tanh(drive);
  for (let i = 0; i < buf.length; i++) buf[i] = Math.tanh(buf[i] * drive) / norm;
}

// Feedback comb with one-pole damping in the loop — cheap boom/room tail.
// damp is the lowpass coefficient (0..1, higher = brighter feedback).
function combTail(buf, sr, { delay, fb, damp = 0.3, wet = 0.3 }) {
  const d = Math.max(1, Math.floor(delay * sr));
  const y = new Float32Array(buf.length);
  let lp = 0;
  for (let i = 0; i < buf.length; i++) {
    const fbIn = i >= d ? y[i - d] : 0;
    lp += damp * (fbIn - lp);
    y[i] = buf[i] + fb * lp;
  }
  for (let i = 0; i < buf.length; i++) buf[i] += wet * (y[i] - buf[i]);
}

function normalize(buf, peak = 0.9) {
  let max = 0;
  for (let i = 0; i < buf.length; i++) {
    const a = Math.abs(buf[i]);
    if (a > max) max = a;
  }
  if (max < 1e-6) return;
  const s = peak / max;
  for (let i = 0; i < buf.length; i++) buf[i] *= s;
}

// Click-proofing for one-shots.
function fadeEnds(buf, sr, inMs = 1.2, outMs = 10) {
  const nIn = Math.min(buf.length, Math.floor(sr * inMs / 1000));
  const nOut = Math.min(buf.length, Math.floor(sr * outMs / 1000));
  for (let i = 0; i < nIn; i++) buf[i] *= i / nIn;
  for (let i = 0; i < nOut; i++) buf[buf.length - 1 - i] *= i / nOut;
}

// Seamless loop: crossfade the last `xf` seconds into the head, truncate tail.
function makeLoop(data, sr, xf) {
  const n = Math.min(Math.floor(xf * sr), Math.floor(data.length / 3));
  const L = data.length - n;
  const out = new Float32Array(L);
  for (let i = 0; i < L; i++) out[i] = data[i];
  for (let k = 0; k < n; k++) {
    const w = k / n;
    out[k] = data[k] * Math.sqrt(w) + data[L + k] * Math.sqrt(1 - w);
  }
  return out;
}

/* ========================================================================== */
/* Foley building blocks                                                       */
/* ========================================================================== */

// Mechanical clack: noise tick + metallic partial stack + weight-scaled thunk.
// tone = fundamental of the metallic ring, weight 0..1 = how heavy the part is.
function clack(b, sr, { t0 = 0, tone = 2200, weight = 0.5, gain = 1, ring = 0.018 }) {
  addNoise(b, sr, {
    t0, dur: 0.02 + weight * 0.025, attack: 0.0006,
    tau: 0.005 + weight * 0.009, lp0: 3500 + tone, lp1: 1200, gain,
  });
  addPartials(b, sr, {
    t0, gain: gain * 0.75, partials: [
      { f: tone, a: 1, tau: ring },
      { f: tone * 1.71, a: 0.5, tau: ring * 0.7 },
      { f: tone * 2.93, a: 0.28, tau: ring * 0.5 },
    ],
  });
  if (weight > 0.15) {
    addTone(b, sr, {
      t0, dur: 0.1, f0: 170 - weight * 70, f1: 62,
      tau: 0.018 + weight * 0.04, gain: gain * weight * 1.1,
    });
  }
}

// Part sliding in rails / mag sliding out — band-swept noise scrape.
function slideFoley(b, sr, { t0 = 0, dur = 0.1, f0 = 1600, f1 = 800, gain = 0.5 }) {
  addNoise(b, sr, {
    t0, dur, attack: dur * 0.25, hold: dur * 0.2, tau: dur * 0.3,
    hp: Math.min(f0, f1) * 0.35, lp0: f0, lp1: f1, gain,
  });
}

// Firm low thunk (mag seating, heavy part landing).
function thunk(b, sr, { t0 = 0, weight = 0.5, gain = 1 }) {
  addNoise(b, sr, {
    t0, dur: 0.07, attack: 0.001, tau: 0.02 + weight * 0.02,
    lp0: 900 - weight * 350, lp1: 200, gain,
  });
  addTone(b, sr, {
    t0, dur: 0.12, f0: 200 - weight * 90, f1: 85 - weight * 35,
    tau: 0.03 + weight * 0.03, gain: gain * (0.7 + weight * 0.6),
  });
}

// Gunshot assembler — a proper layered one-shot with a real amplitude envelope:
//
//   (1) TRANSIENT  — a sharp <2ms broadband filtered-noise impulse: the crack/snap
//                    of the muzzle. Scaled by the firePunch tunable + a subPunch mix.
//   (2) BODY       — a fast downward-pitch-swept tonal element (tri + a touch of saw)
//                    that gives the gun its tuned "voice" and mid punch.
//   (3) BLAST      — a band-passed, enveloped noise layer: the gassy expansion.
//   (4) SUB THUMP  — a low 40–90 Hz sine blip for weight & chest.
//   (5) TAIL       — the airy hiss + comb-feedback boom that rings out (long for big
//                    guns), scaled by the boomTail tunable.
//
// The whole sum is soft-clipped (tanh) so the layers glue and drive into loudness
// without ever slamming into a full-scale square (which is what makes synths harsh).
//
// IMPORTANT balance note: _renderBuffer() peak-normalizes every buffer to 0.9, so the
// BODY + SUB must define the peak — the transient is deliberately kept short and rides
// ON TOP of them via soft-clip grit rather than spiking alone (a lone 1-sample crack
// spike would get normalized to 0.9 and pull the whole body down to a thin tick).
function gunshot(b, sr, P, o) {
  const len = b.length / sr;
  const punch = P.firePunch;
  const subMix = P.subPunch ?? 1;

  // (2) BODY — pitch-swept tonal core (built FIRST so it dominates the peak).
  //     Triangle fundamental for a round body + a quiet saw octave for bite.
  addTone(b, sr, {
    dur: Math.min(len, o.bodyTau * 7), f0: o.bodyF0, f1: o.bodyF1,
    type: 'tri', attack: 0.0006, tau: o.bodyTau, gain: o.bodyGain,
  });
  addTone(b, sr, {
    dur: Math.min(len, o.bodyTau * 4), f0: o.bodyF0 * 1.5, f1: o.bodyF1 * 1.5,
    type: 'saw', attack: 0.0008, tau: o.bodyTau * 0.6, gain: o.bodyGain * 0.22,
  });

  // (4) SUB THUMP — the low-end weight. Sine blip, own slower decay.
  addTone(b, sr, {
    dur: Math.min(len, o.subTau * 6), f0: o.subF0, f1: o.subF1,
    attack: 0.001, tau: o.subTau, gain: o.subGain * subMix,
  });

  // (3) BLAST — band-passed gassy noise, swept downward. The bulk of the "roar".
  addNoise(b, sr, {
    dur: o.blastDur, attack: 0.0009, tau: o.blastTau,
    hp: o.blastHp, lp0: o.blastLp0, lp1: o.blastLp1, gain: o.blastGain,
  });

  // (1) TRANSIENT — the sharp crack. <2ms attack, very fast decay, sits on top.
  addNoise(b, sr, {
    dur: o.crackDur, attack: 0.0004, tau: o.crackDur * 0.32,
    lp0: 15000, lp1: 5000, hp: o.crackHp, gain: o.crackGain * punch,
  });

  // (5a) TAIL — long airy hiss for the bigger guns (crackle of the report echo).
  if (o.airGain && len > 0.18) {
    addNoise(b, sr, {
      t0: 0.03, dur: len - 0.05, attack: 0.025, tau: o.airTau,
      hp: 420, lp0: 3800, lp1: 900, gain: o.airGain, pink: true,
    });
  }

  // Glue + loudness. tanh drive fuses the layers and adds grit without hard edges.
  softClip(b, o.drive);

  // (5b) TAIL — comb-feedback boom bounce, scaled by the boomTail tunable.
  const wet = Math.min(0.9, o.tailWet * P.boomTail);
  if (wet > 0.01) {
    combTail(b, sr, { delay: o.tailDelay, fb: o.tailFb, damp: o.tailDamp, wet });
  }
}

/* ========================================================================== */
/* Sound bank — EVERY name from ARCHITECTURE.md §7.                            */
/* dur seconds, gain = mix level at playback, varMult scales random variation, */
/* fire = re-rendered when firePunch/boomTail tunables change,                 */
/* loop/loopXf = rendered seamless for startLoop.                              */
/* ========================================================================== */

const SOUNDS = {
  /* ---------------- UI ---------------- */
  ui_click: { dur: 0.09, gain: 0.35, synth(b, sr) {
    addTone(b, sr, { dur: 0.07, f0: 1900, f1: 1250, tau: 0.022, gain: 1 });
    addNoise(b, sr, { dur: 0.012, attack: 0.0005, tau: 0.004, lp0: 7000, hp: 1000, gain: 0.35 });
  } },
  ui_tick: { dur: 0.05, gain: 0.28, synth(b, sr) {
    addTone(b, sr, { dur: 0.04, f0: 2500, f1: 2300, tau: 0.011, gain: 1 });
  } },
  ui_open: { dur: 0.2, gain: 0.32, synth(b, sr) {
    addTone(b, sr, { t0: 0, dur: 0.09, f0: 700, f1: 950, tau: 0.045, type: 'tri', gain: 0.9 });
    addTone(b, sr, { t0: 0.07, dur: 0.12, f0: 1050, f1: 1400, tau: 0.055, type: 'tri', gain: 1 });
  } },
  ui_close: { dur: 0.2, gain: 0.32, synth(b, sr) {
    addTone(b, sr, { t0: 0, dur: 0.09, f0: 1400, f1: 1050, tau: 0.045, type: 'tri', gain: 1 });
    addTone(b, sr, { t0: 0.07, dur: 0.12, f0: 950, f1: 700, tau: 0.055, type: 'tri', gain: 0.9 });
  } },

  /* ---------------- movement ---------------- */
  footstep: { dur: 0.16, gain: 0.5, varMult: 2.2, synth(b, sr) {
    addNoise(b, sr, { dur: 0.13, attack: 0.003, tau: 0.035, lp0: 520, lp1: 150, gain: 1 });
    addTone(b, sr, { dur: 0.08, f0: 135, f1: 72, tau: 0.03, gain: 0.6 });
    addNoise(b, sr, { dur: 0.02, attack: 0.0008, tau: 0.005, lp0: 3200, hp: 700, gain: 0.14 });
  } },
  jump: { dur: 0.24, gain: 0.5, synth(b, sr) {
    // cloth swish rising + push-off thump
    addNoise(b, sr, { dur: 0.2, attack: 0.02, tau: 0.06, hp: 280, lp0: 700, lp1: 1900, gain: 0.8, pink: true });
    addTone(b, sr, { dur: 0.1, f0: 130, f1: 62, tau: 0.045, gain: 0.55 });
  } },
  land_soft: { dur: 0.2, gain: 0.55, varMult: 1.4, synth(b, sr) {
    addNoise(b, sr, { dur: 0.11, attack: 0.002, tau: 0.032, lp0: 430, lp1: 130, gain: 1 });
    addTone(b, sr, { dur: 0.1, f0: 105, f1: 55, tau: 0.05, gain: 0.8 });
  } },
  land_hard: { dur: 0.42, gain: 0.85, synth(b, sr) {
    // weighty double thud
    addNoise(b, sr, { dur: 0.12, attack: 0.001, tau: 0.045, lp0: 950, lp1: 160, gain: 1.1 });
    addTone(b, sr, { dur: 0.14, f0: 92, f1: 40, tau: 0.08, gain: 1.2 });
    addNoise(b, sr, { t0: 0.1, dur: 0.1, attack: 0.002, tau: 0.035, lp0: 500, lp1: 130, gain: 0.75 });
    addTone(b, sr, { t0: 0.1, dur: 0.12, f0: 70, f1: 36, tau: 0.06, gain: 0.85 });
    softClip(b, 1.7);
  } },
  slide_start: { dur: 0.28, gain: 0.5, synth(b, sr) {
    addNoise(b, sr, { dur: 0.22, attack: 0.006, tau: 0.08, hp: 210, lp0: 1500, lp1: 520, gain: 0.9 });
    addNoise(b, sr, { dur: 0.2, attack: 0.004, tau: 0.09, lp0: 300, gain: 0.7, pink: true });
  } },
  slide_loop: { dur: 1.6, gain: 0.45, loop: true, loopXf: 0.3, synth(b, sr) {
    addNoise(b, sr, { dur: 1.6, attack: 0.005, tau: 0, hp: 240, lp0: 1150, gain: 0.6 });   // scrape mids
    addNoise(b, sr, { dur: 1.6, attack: 0.005, tau: 0, lp0: 320, gain: 0.85, pink: true }); // ground rumble
    addNoise(b, sr, { dur: 1.6, attack: 0.005, tau: 0, hp: 900, lp0: 3200, gain: 0.18 });  // grit
  } },
  wallrun_loop: { dur: 1.7, gain: 0.35, loop: true, loopXf: 0.3, synth(b, sr) {
    addNoise(b, sr, { dur: 1.7, attack: 0.01, tau: 0, hp: 380, lp0: 2400, gain: 0.9, pink: true }); // airy whoosh
    addNoise(b, sr, { dur: 1.7, attack: 0.01, tau: 0, hp: 1100, lp0: 4500, gain: 0.25 });
  } },
  walljump: { dur: 0.3, gain: 0.55, synth(b, sr) {
    addNoise(b, sr, { dur: 0.22, attack: 0.012, tau: 0.07, hp: 260, lp0: 750, lp1: 2500, gain: 0.85, pink: true });
    addTone(b, sr, { dur: 0.1, f0: 150, f1: 70, tau: 0.045, gain: 0.6 });
  } },

  /* ---------------- gunfire (5 DISTINCT characters) ---------------- */
  // pistol: tight dry crack, quick. Snappy mid body, small sub, short punchy tail.
  pistol_fire: { dur: 0.34, gain: 0.9, fire: true, synth(b, sr, P) {
    gunshot(b, sr, P, {
      crackDur: 0.022, crackHp: 1600, crackGain: 1.15,
      bodyF0: 420, bodyF1: 120, bodyTau: 0.028, bodyGain: 0.95,
      blastDur: 0.14, blastTau: 0.03, blastHp: 260, blastLp0: 5200, blastLp1: 650, blastGain: 0.85,
      subF0: 95, subF1: 55, subTau: 0.05, subGain: 0.7,
      drive: 2.2,
      tailDelay: 0.028, tailFb: 0.32, tailDamp: 0.28, tailWet: 0.09,
    });
  } },
  // smg: snappy, brighter, short — must stay tight & clean at ~15/sec (no mud).
  smg_fire: { dur: 0.22, gain: 0.72, fire: true, synth(b, sr, P) {
    gunshot(b, sr, P, {
      crackDur: 0.016, crackHp: 2000, crackGain: 1.2,
      bodyF0: 520, bodyF1: 160, bodyTau: 0.018, bodyGain: 0.9,
      blastDur: 0.1, blastTau: 0.02, blastHp: 340, blastLp0: 6000, blastLp1: 900, blastGain: 0.78,
      subF0: 105, subF1: 65, subTau: 0.032, subGain: 0.5,
      drive: 2.0,
      tailDelay: 0.02, tailFb: 0.22, tailDamp: 0.34, tailWet: 0.045,
    });
  } },
  // shotgun: deep chest BOOM, huge low-end, medium tail.
  shotgun_fire: { dur: 1.0, gain: 1.05, fire: true, synth(b, sr, P) {
    gunshot(b, sr, P, {
      crackDur: 0.03, crackHp: 700, crackGain: 1.2,
      bodyF0: 210, bodyF1: 52, bodyTau: 0.1, bodyGain: 1.35,
      blastDur: 0.5, blastTau: 0.11, blastHp: 120, blastLp0: 3400, blastLp1: 220, blastGain: 1.1,
      subF0: 62, subF1: 34, subTau: 0.22, subGain: 1.15,
      airGain: 0.28, airTau: 0.24,
      drive: 2.6,
      tailDelay: 0.066, tailFb: 0.5, tailDamp: 0.2, tailWet: 0.28,
    });
  } },
  // ar: punchy mid report with body — the workhorse crack + solid thump.
  ar_fire: { dur: 0.5, gain: 0.9, fire: true, synth(b, sr, P) {
    gunshot(b, sr, P, {
      crackDur: 0.02, crackHp: 1250, crackGain: 1.2,
      bodyF0: 340, bodyF1: 90, bodyTau: 0.05, bodyGain: 1.15,
      blastDur: 0.3, blastTau: 0.06, blastHp: 200, blastLp0: 5400, blastLp1: 420, blastGain: 0.95,
      subF0: 82, subF1: 46, subTau: 0.08, subGain: 0.85,
      airGain: 0.16, airTau: 0.14,
      drive: 2.4,
      tailDelay: 0.05, tailFb: 0.4, tailDamp: 0.24, tailWet: 0.13,
    });
  } },
  // sniper: huge cannon boom + long airy tail. Loudest / biggest of all.
  sniper_fire: { dur: 1.8, gain: 1.1, fire: true, synth(b, sr, P) {
    gunshot(b, sr, P, {
      crackDur: 0.04, crackHp: 560, crackGain: 1.35,
      bodyF0: 180, bodyF1: 40, bodyTau: 0.16, bodyGain: 1.45,
      blastDur: 0.7, blastTau: 0.17, blastHp: 90, blastLp0: 4200, blastLp1: 150, blastGain: 1.2,
      subF0: 52, subF1: 28, subTau: 0.34, subGain: 1.25,
      airGain: 0.46, airTau: 0.55,
      drive: 2.8,
      tailDelay: 0.088, tailFb: 0.56, tailDamp: 0.17, tailWet: 0.34,
    });
  } },
  /* ---------------- EXOTIC (rocket launcher, slot 6) ---------------- */
  // exotic_fire: a heavy ROCKET LAUNCH — deep whoosh + a thunky launch transient +
  // a receding hiss tail. Big and weighty, NOT a gunshot: no sharp crack, no sub-boom;
  // the energy is in the gassy low-mid whoosh and the long departing rocket hiss.
  exotic_fire: { dur: 0.9, gain: 1.05, synth(b, sr) {
    // (1) LAUNCH TRANSIENT — a thunky low mechanical pop as the rocket leaves the tube.
    //     Weighty, not bright: the ignition + tube slap, no rifle crack.
    thunk(b, sr, { t0: 0, weight: 0.85, gain: 1.15 });
    addNoise(b, sr, { dur: 0.05, attack: 0.0018, tau: 0.02, lp0: 1400, lp1: 320, gain: 0.7 });
    // (2) IGNITION WHOOSH — the deep gassy expansion of the motor, swept upward slightly
    //     then bloomed. Band-passed low-mid noise carries the bulk of the weight.
    addNoise(b, sr, { t0: 0.005, dur: 0.5, attack: 0.02, hold: 0.05, tau: 0.22,
      hp: 90, lp0: 900, lp1: 1700, gain: 1.15, pink: true });
    addNoise(b, sr, { t0: 0.01, dur: 0.42, attack: 0.03, tau: 0.2,
      hp: 200, lp0: 2200, lp1: 700, gain: 0.55 });
    // low motor rumble for chest weight (motion, not a tonal boom)
    addTone(b, sr, { t0: 0, dur: 0.55, f0: 74, f1: 52, tau: 0.28, type: 'tri', gain: 0.9 });
    addTone(b, sr, { t0: 0.02, dur: 0.4, f0: 150, f1: 96, tau: 0.2, type: 'tri', gain: 0.35 });
    // (3) RECEDING HISS TAIL — the rocket departing downrange: bright airy noise that
    //     thins and darkens as it flies away.
    addNoise(b, sr, { t0: 0.12, dur: 0.72, attack: 0.05, tau: 0.4,
      hp: 520, lp0: 3200, lp1: 700, gain: 0.42, pink: true });
    softClip(b, 2.1);
    combTail(b, sr, { delay: 0.045, fb: 0.4, damp: 0.22, wet: 0.14 });
  } },

  // explosion: the BIGGEST, most impactful sound in the game. Sharp crack transient ->
  // deep booming low-end body (30–80 Hz sine/tri blip) -> long rumbling lowpassed noise
  // tail, all tanh soft-clipped for maximum weight and loudness.
  explosion: { dur: 1.8, gain: 1.2, synth(b, sr) {
    // (1) CRACK — the sharp broadband detonation front. Very fast, sits on top.
    addNoise(b, sr, { dur: 0.03, attack: 0.0004, tau: 0.01, hp: 300, lp0: 12000, lp1: 3000, gain: 1.2 });
    addNoise(b, sr, { dur: 0.06, attack: 0.0006, tau: 0.02, hp: 120, lp0: 5000, lp1: 800, gain: 1.0 });
    // (2) BOOM BODY — deep 30–80 Hz low-end blip: the concussive punch to the chest.
    addTone(b, sr, { dur: 0.5, f0: 78, f1: 32, tau: 0.16, type: 'sine', attack: 0.002, gain: 1.5 });
    addTone(b, sr, { dur: 0.4, f0: 120, f1: 46, tau: 0.12, type: 'tri', attack: 0.002, gain: 0.85 });
    addTone(b, sr, { t0: 0.02, dur: 0.35, f0: 55, f1: 28, tau: 0.18, type: 'sine', gain: 1.1 });
    // (3) BODY ROAR — the fireball's gassy mid expansion, swept down hard.
    addNoise(b, sr, { t0: 0.004, dur: 0.55, attack: 0.001, tau: 0.2,
      hp: 70, lp0: 4200, lp1: 260, gain: 1.25, pink: true });
    // (4) LONG RUMBLING TAIL — debris + echo through a closing lowpass.
    addNoise(b, sr, { t0: 0.14, dur: 1.5, attack: 0.06, tau: 0.55,
      lp0: 900, lp1: 90, gain: 0.7, pink: true });
    addTone(b, sr, { t0: 0.1, dur: 1.2, f0: 44, f1: 26, tau: 0.5, type: 'sine', gain: 0.5 });
    // Glue + brute loudness, then a big room boom bounce for scale.
    softClip(b, 2.8);
    combTail(b, sr, { delay: 0.09, fb: 0.62, damp: 0.16, wet: 0.32 });
  } },

  // seeker_launch: several quick overlapping small whoosh/pops (5-ish staggered) as the
  // seekers scatter — bright, zippy, short. Each is a tiny rising whoosh + a pop tick.
  seeker_launch: { dur: 0.6, gain: 0.7, varMult: 0.4, synth(b, sr) {
    const seeker = (t0, f0, f1, pan) => {
      // tiny pop tick
      addNoise(b, sr, { t0, dur: 0.02, attack: 0.0005, tau: 0.006, hp: 1400, lp0: 9000, gain: 0.45 * pan });
      // rising zippy whoosh
      addNoise(b, sr, { t0: t0 + 0.004, dur: 0.14, attack: 0.006, tau: 0.05,
        hp: 700, lp0: 1800, lp1: 4200, gain: 0.55 * pan, pink: true });
      // a bright pitch-up tail so each reads as a small darting projectile
      addTone(b, sr, { t0, dur: 0.12, f0, f1, tau: 0.045, type: 'tri', gain: 0.4 * pan });
    };
    seeker(0.0,  1200, 2600, 1.0);
    seeker(0.03, 1050, 2300, 0.85);
    seeker(0.055, 1400, 2900, 0.9);
    seeker(0.085, 980,  2150, 0.8);
    seeker(0.12, 1300, 2750, 0.9);
    softClip(b, 1.5);
  } },

  // exotic_load: chunky mechanical rocket-load — a heavy slot/clunk + a latch snap.
  exotic_load: { dur: 0.5, gain: 0.72, synth(b, sr) {
    // heavy rocket sliding into the tube
    slideFoley(b, sr, { t0: 0, dur: 0.16, f0: 1050, f1: 420, gain: 0.6 });
    // the big seat/clunk as it bottoms out
    thunk(b, sr, { t0: 0.14, weight: 0.95, gain: 1.2 });
    clack(b, sr, { t0: 0.15, tone: 1150, weight: 0.85, gain: 1.0, ring: 0.024 });
    // latch snap locking it in
    clack(b, sr, { t0: 0.3, tone: 2100, weight: 0.45, gain: 0.85, ring: 0.014 });
    addPartials(b, sr, { t0: 0.31, gain: 0.3, partials: [{ f: 700, a: 1, tau: 0.06 }] });
    softClip(b, 1.5);
  } },

  /* ---------------- SAWBLADE (ricochet launcher, slot 7) ---------------- */
  // sawblade_fire: a mechanical BLADE LAUNCH — a taut spring/rail zip + a spinning-blade
  // whir onset. Metallic and aggressive: the rail release then the disc spinning up.
  sawblade_fire: { dur: 0.4, gain: 0.85, synth(b, sr) {
    // (1) RAIL RELEASE — a taut spring/rail zip: fast pitch-up metallic transient.
    addTone(b, sr, { t0: 0, dur: 0.09, f0: 900, f1: 2600, tau: 0.035, type: 'saw', gain: 0.6 });
    addNoise(b, sr, { t0: 0, dur: 0.05, attack: 0.0006, tau: 0.016, hp: 1200, lp0: 9000, gain: 0.5 });
    // metallic launch clack
    clack(b, sr, { t0: 0.005, tone: 2000, weight: 0.4, gain: 0.75, ring: 0.014 });
    // (2) BLADE WHIR ONSET — a bright buzzy spin-up: a saw tone with fast vibrato
    //     (the teeth), swept up as it accelerates, riding a thin airy whir.
    addTone(b, sr, { t0: 0.01, dur: 0.34, f0: 320, f1: 640, attack: 0.01, tau: 0.15,
      type: 'saw', vibHz: 68, vibDepth: 0.22, gain: 0.5 });
    addTone(b, sr, { t0: 0.02, dur: 0.3, f0: 640, f1: 1280, attack: 0.015, tau: 0.13,
      type: 'saw', vibHz: 90, vibDepth: 0.18, gain: 0.22 });
    addNoise(b, sr, { t0: 0.02, dur: 0.3, attack: 0.02, tau: 0.14,
      hp: 900, lp0: 4200, lp1: 1600, gain: 0.3, pink: true });
    softClip(b, 1.9);
  } },

  // sawblade_bounce: a metallic RICOCHET — bright short "ting/clang" + a fast pitch-down
  // whine tail. Plays a LOT as blades bounce, so kept short/tight so rapid bounces don't
  // fatigue: a sharp clang transient and a quick descending whine that decays fast.
  sawblade_bounce: { dur: 0.28, gain: 0.6, varMult: 1.6, synth(b, sr) {
    // (1) TING/CLANG — sharp bright metallic strike transient.
    addNoise(b, sr, { dur: 0.012, attack: 0.0003, tau: 0.004, hp: 2000, lp0: 11000, gain: 0.55 });
    addPartials(b, sr, { gain: 0.9, partials: [
      { f: 3050, a: 1, tau: 0.03 }, { f: 4720, a: 0.55, tau: 0.02 },
      { f: 6400, a: 0.3, tau: 0.014 }, { f: 1980, a: 0.5, tau: 0.035 },
    ] });
    // (2) FAST PITCH-DOWN WHINE TAIL — short descending metallic whine (the blade
    //     skipping off), decays quickly so machine-gun bounces stay tight.
    addTone(b, sr, { t0: 0.005, dur: 0.22, f0: 2400, f1: 780, attack: 0.002, tau: 0.06,
      type: 'saw', vibHz: 40, vibDepth: 0.04, gain: 0.35 });
    softClip(b, 1.5);
  } },

  // sawblade_load: feeding blades — a ratchet/stack clack: several rapid ratchet ticks
  // as blades stack, then a firm seat.
  sawblade_load: { dur: 0.42, gain: 0.68, synth(b, sr) {
    // ratchet run — quick bright metallic ticks
    clack(b, sr, { t0: 0.0,  tone: 2600, weight: 0.2, gain: 0.6, ring: 0.01 });
    clack(b, sr, { t0: 0.05, tone: 2750, weight: 0.2, gain: 0.55, ring: 0.009 });
    clack(b, sr, { t0: 0.1,  tone: 2500, weight: 0.25, gain: 0.6, ring: 0.01 });
    slideFoley(b, sr, { t0: 0.02, dur: 0.14, f0: 2400, f1: 1300, gain: 0.3 });
    // firm seat of the blade stack
    thunk(b, sr, { t0: 0.24, weight: 0.55, gain: 0.9 });
    clack(b, sr, { t0: 0.25, tone: 1900, weight: 0.45, gain: 0.85, ring: 0.016 });
    softClip(b, 1.4);
  } },

  // crisp mechanical firing-pin click on an empty chamber — a hard dry snap.
  dryfire: { dur: 0.12, gain: 0.55, synth(b, sr) {
    // sharp broadband tick (the pin strike)
    addNoise(b, sr, { dur: 0.006, attack: 0.0003, tau: 0.002, lp0: 11000, hp: 2200, gain: 0.7 });
    // metallic firing-pin ring
    addPartials(b, sr, { gain: 1, partials: [
      { f: 2750, a: 1, tau: 0.01 }, { f: 4380, a: 0.5, tau: 0.007 }, { f: 6700, a: 0.28, tau: 0.005 },
    ] });
    // a little mechanical body so it reads as metal, not a plink
    addTone(b, sr, { dur: 0.03, f0: 620, f1: 260, tau: 0.01, type: 'tri', gain: 0.35 });
    // faint hammer-fall echo
    addPartials(b, sr, { t0: 0.03, gain: 0.4, partials: [{ f: 3200, a: 1, tau: 0.006 }] });
    softClip(b, 1.4);
  } },

  /* ---------------- reload foley ---------------- */
  pistol_magout: { dur: 0.22, gain: 0.6, synth(b, sr) {
    clack(b, sr, { t0: 0, tone: 3200, weight: 0.25, gain: 0.85, ring: 0.014 });
    slideFoley(b, sr, { t0: 0.03, dur: 0.12, f0: 2200, f1: 900, gain: 0.5 });
  } },
  pistol_magin: { dur: 0.2, gain: 0.65, synth(b, sr) {
    thunk(b, sr, { t0: 0, weight: 0.35, gain: 1 });
    clack(b, sr, { t0: 0.07, tone: 3000, weight: 0.2, gain: 0.7, ring: 0.012 });
  } },
  pistol_rack: { dur: 0.26, gain: 0.65, synth(b, sr) {
    clack(b, sr, { t0: 0, tone: 2600, weight: 0.35, gain: 0.85, ring: 0.016 });
    slideFoley(b, sr, { t0: 0.02, dur: 0.08, f0: 1700, f1: 950, gain: 0.35 });
    clack(b, sr, { t0: 0.1, tone: 2100, weight: 0.45, gain: 1, ring: 0.018 });
  } },

  smg_magout: { dur: 0.22, gain: 0.6, synth(b, sr) {
    clack(b, sr, { t0: 0, tone: 2800, weight: 0.35, gain: 0.85, ring: 0.015 });
    slideFoley(b, sr, { t0: 0.03, dur: 0.12, f0: 1800, f1: 800, gain: 0.5 });
  } },
  smg_magin: { dur: 0.2, gain: 0.65, synth(b, sr) {
    thunk(b, sr, { t0: 0, weight: 0.45, gain: 1 });
    clack(b, sr, { t0: 0.08, tone: 2600, weight: 0.25, gain: 0.7, ring: 0.013 });
  } },
  smg_rack: { dur: 0.24, gain: 0.65, synth(b, sr) {
    clack(b, sr, { t0: 0, tone: 2400, weight: 0.4, gain: 0.85, ring: 0.016 });
    slideFoley(b, sr, { t0: 0.02, dur: 0.07, f0: 1500, f1: 850, gain: 0.35 });
    clack(b, sr, { t0: 0.09, tone: 1950, weight: 0.5, gain: 1, ring: 0.018 });
  } },

  ar_magout: { dur: 0.26, gain: 0.62, synth(b, sr) {
    clack(b, sr, { t0: 0, tone: 2400, weight: 0.5, gain: 0.9, ring: 0.018 });
    slideFoley(b, sr, { t0: 0.04, dur: 0.14, f0: 1600, f1: 700, gain: 0.55 });
  } },
  ar_magin: { dur: 0.24, gain: 0.68, synth(b, sr) {
    thunk(b, sr, { t0: 0, weight: 0.6, gain: 1.05 });
    clack(b, sr, { t0: 0.09, tone: 2450, weight: 0.35, gain: 0.75, ring: 0.015 });
  } },
  ar_rack: { dur: 0.3, gain: 0.65, synth(b, sr) {
    clack(b, sr, { t0: 0, tone: 2150, weight: 0.5, gain: 0.9, ring: 0.018 });
    slideFoley(b, sr, { t0: 0.02, dur: 0.1, f0: 1300, f1: 650, gain: 0.4 });
    clack(b, sr, { t0: 0.13, tone: 1750, weight: 0.65, gain: 1.05, ring: 0.02 });
  } },
  ar_bolt: { dur: 0.22, gain: 0.68, synth(b, sr) {
    clack(b, sr, { t0: 0, tone: 1900, weight: 0.7, gain: 1.1, ring: 0.02 });
    addPartials(b, sr, { t0: 0.005, gain: 0.4, partials: [{ f: 1350, a: 1, tau: 0.05 }] }); // spring ring
    clack(b, sr, { t0: 0.06, tone: 2200, weight: 0.3, gain: 0.5, ring: 0.012 });
  } },

  shotgun_shell: { dur: 0.24, gain: 0.62, synth(b, sr) {
    slideFoley(b, sr, { t0: 0, dur: 0.1, f0: 1150, f1: 700, gain: 0.6 });
    clack(b, sr, { t0: 0.1, tone: 2050, weight: 0.3, gain: 0.8, ring: 0.012 });
    clack(b, sr, { t0: 0.15, tone: 1600, weight: 0.2, gain: 0.4, ring: 0.01 });
  } },
  shotgun_pump: { dur: 0.42, gain: 0.7, synth(b, sr) {
    // crunchy two-stage clack-clack: back... forward (heavier)
    clack(b, sr, { t0: 0, tone: 1500, weight: 0.7, gain: 1, ring: 0.02 });
    slideFoley(b, sr, { t0: 0.03, dur: 0.1, f0: 900, f1: 480, gain: 0.5 });
    clack(b, sr, { t0: 0.17, tone: 1280, weight: 0.9, gain: 1.15, ring: 0.022 });
    addPartials(b, sr, { t0: 0.18, gain: 0.3, partials: [{ f: 640, a: 1, tau: 0.05 }] }); // body rattle
  } },

  sniper_magout: { dur: 0.3, gain: 0.62, synth(b, sr) {
    clack(b, sr, { t0: 0, tone: 1900, weight: 0.8, gain: 0.95, ring: 0.02 });
    slideFoley(b, sr, { t0: 0.05, dur: 0.16, f0: 1250, f1: 480, gain: 0.55 });
  } },
  sniper_magin: { dur: 0.28, gain: 0.7, synth(b, sr) {
    thunk(b, sr, { t0: 0, weight: 0.9, gain: 1.1 });
    clack(b, sr, { t0: 0.12, tone: 2000, weight: 0.4, gain: 0.75, ring: 0.015 });
  } },
  sniper_bolt: { dur: 0.58, gain: 0.7, synth(b, sr) {
    // heavy three-stage clunk: unlock — pull — slam home
    clack(b, sr, { t0: 0, tone: 1700, weight: 0.6, gain: 0.9, ring: 0.018 });
    clack(b, sr, { t0: 0.17, tone: 1400, weight: 0.7, gain: 0.95, ring: 0.02 });
    slideFoley(b, sr, { t0: 0.18, dur: 0.11, f0: 800, f1: 420, gain: 0.5 });
    clack(b, sr, { t0: 0.36, tone: 1150, weight: 0.95, gain: 1.2, ring: 0.024 });
    addPartials(b, sr, { t0: 0.37, gain: 0.35, partials: [{ f: 780, a: 1, tau: 0.07 }] });
  } },

  /* ---------------- DMR (slot 8) — sharp marksman crack + mag foley ---------- */
  dmr_fire: { dur: 0.7, gain: 1.0, fire: true, synth(b, sr, P) {
    gunshot(b, sr, P, {
      crackDur: 0.024, crackHp: 900, crackGain: 1.3,
      bodyF0: 260, bodyF1: 62, bodyTau: 0.08, bodyGain: 1.3,
      blastDur: 0.4, blastTau: 0.09, blastHp: 150, blastLp0: 4800, blastLp1: 300, blastGain: 1.05,
      subF0: 68, subF1: 38, subTau: 0.12, subGain: 1.0,
      airGain: 0.24, airTau: 0.22,
      drive: 2.5,
      tailDelay: 0.062, tailFb: 0.46, tailDamp: 0.2, tailWet: 0.2,
    });
  } },
  dmr_magout: { dur: 0.28, gain: 0.62, synth(b, sr) {
    clack(b, sr, { t0: 0, tone: 2300, weight: 0.55, gain: 0.9, ring: 0.018 });
    slideFoley(b, sr, { t0: 0.05, dur: 0.15, f0: 1500, f1: 640, gain: 0.55 });
  } },
  dmr_magin: { dur: 0.26, gain: 0.68, synth(b, sr) {
    thunk(b, sr, { t0: 0, weight: 0.65, gain: 1.05 });
    clack(b, sr, { t0: 0.1, tone: 2300, weight: 0.4, gain: 0.75, ring: 0.015 });
  } },
  dmr_rack: { dur: 0.3, gain: 0.66, synth(b, sr) {
    clack(b, sr, { t0: 0, tone: 2000, weight: 0.55, gain: 0.9, ring: 0.018 });
    slideFoley(b, sr, { t0: 0.02, dur: 0.1, f0: 1250, f1: 620, gain: 0.4 });
    clack(b, sr, { t0: 0.13, tone: 1650, weight: 0.7, gain: 1.05, ring: 0.02 });
  } },

  /* ---------------- REVOLVER (slot 9) — magnum boom + swing-cylinder foley ---- */
  revolver_fire: { dur: 0.85, gain: 1.08, fire: true, synth(b, sr, P) {
    gunshot(b, sr, P, {
      crackDur: 0.026, crackHp: 800, crackGain: 1.35,
      bodyF0: 300, bodyF1: 58, bodyTau: 0.095, bodyGain: 1.4,
      blastDur: 0.42, blastTau: 0.1, blastHp: 130, blastLp0: 4200, blastLp1: 260, blastGain: 1.1,
      subF0: 58, subF1: 32, subTau: 0.2, subGain: 1.25,
      airGain: 0.28, airTau: 0.26,
      drive: 2.7,
      tailDelay: 0.072, tailFb: 0.52, tailDamp: 0.19, tailWet: 0.26,
    });
  } },
  revolver_swing: { dur: 0.34, gain: 0.6, synth(b, sr) {
    clack(b, sr, { t0: 0, tone: 2400, weight: 0.4, gain: 0.75, ring: 0.014 });       // cylinder latch release
    addTone(b, sr, { t0: 0.04, dur: 0.16, f0: 240, f1: 180, tau: 0.07, type: 'tri', gain: 0.3 }); // crane swings out
    clack(b, sr, { t0: 0.22, tone: 1800, weight: 0.5, gain: 0.7, ring: 0.016 });     // swing stop
  } },
  revolver_eject: { dur: 0.4, gain: 0.62, synth(b, sr) {
    slideFoley(b, sr, { t0: 0, dur: 0.1, f0: 1400, f1: 700, gain: 0.5 });            // ejector rod stroke
    for (let i = 0; i < 6; i++) clack(b, sr, { t0: 0.08 + i * 0.03, tone: 2600 + (i % 3) * 200, weight: 0.15, gain: 0.4, ring: 0.008 }); // 6 cases clatter out
  } },
  revolver_load: { dur: 0.7, gain: 0.6, synth(b, sr) {
    for (let i = 0; i < 6; i++) clack(b, sr, { t0: 0.02 + i * 0.05, tone: 1900 + (i % 2) * 250, weight: 0.3, gain: 0.5, ring: 0.012 }); // speedloader drops 6 rounds
    thunk(b, sr, { t0: 0.4, weight: 0.5, gain: 0.8 });                               // seat
    slideFoley(b, sr, { t0: 0.45, dur: 0.14, f0: 1100, f1: 600, gain: 0.35 });       // speedloader twists free
  } },
  revolver_close: { dur: 0.3, gain: 0.66, synth(b, sr) {
    addTone(b, sr, { t0: 0, dur: 0.12, f0: 200, f1: 260, tau: 0.05, type: 'tri', gain: 0.3 }); // cylinder swings in
    clack(b, sr, { t0: 0.16, tone: 1500, weight: 0.75, gain: 1.15, ring: 0.022 });   // heavy snap shut
    addPartials(b, sr, { t0: 0.17, gain: 0.35, partials: [{ f: 700, a: 1, tau: 0.06 }] });
    softClip(b, 1.4);
  } },

  equip: { dur: 0.22, gain: 0.6, synth(b, sr) {
    slideFoley(b, sr, { t0: 0, dur: 0.13, f0: 700, f1: 2300, gain: 0.55 }); // raise swish
    clack(b, sr, { t0: 0.13, tone: 2650, weight: 0.3, gain: 0.8, ring: 0.013 });
  } },
  holster: { dur: 0.22, gain: 0.55, synth(b, sr) {
    clack(b, sr, { t0: 0, tone: 2450, weight: 0.25, gain: 0.7, ring: 0.012 });
    slideFoley(b, sr, { t0: 0.04, dur: 0.13, f0: 2300, f1: 700, gain: 0.5 }); // lower swish
  } },

  /* ---------------- impacts ---------------- */
  impact_concrete: { dur: 0.2, gain: 0.6, varMult: 1.6, synth(b, sr) {
    addNoise(b, sr, { dur: 0.11, attack: 0.001, tau: 0.028, lp0: 2600, lp1: 320, gain: 1 });
    addNoise(b, sr, { dur: 0.05, attack: 0.0006, tau: 0.012, hp: 900, lp0: 6500, gain: 0.45 });
    addNoise(b, sr, { t0: 0.02, dur: 0.14, attack: 0.01, tau: 0.05, lp0: 500, lp1: 200, gain: 0.5, pink: true }); // dust
    addTone(b, sr, { dur: 0.06, f0: 190, f1: 95, tau: 0.022, gain: 0.5 });
  } },
  impact_metal: { dur: 0.5, gain: 0.55, varMult: 1.6, synth(b, sr) {
    addNoise(b, sr, { dur: 0.02, attack: 0.0005, tau: 0.006, hp: 1200, lp0: 9000, gain: 0.8 });
    addPartials(b, sr, { gain: 0.9, partials: [ // inharmonic tink + ring
      { f: 1560, a: 1, tau: 0.13 }, { f: 2872, a: 0.6, tau: 0.1 },
      { f: 4180, a: 0.38, tau: 0.075 }, { f: 838, a: 0.45, tau: 0.16 },
      { f: 6230, a: 0.2, tau: 0.05 },
    ] });
    addTone(b, sr, { dur: 0.05, f0: 260, f1: 130, tau: 0.018, gain: 0.4 });
  } },
  impact_target: { dur: 0.24, gain: 0.7, varMult: 1.5, synth(b, sr) {
    addNoise(b, sr, { dur: 0.13, attack: 0.001, tau: 0.04, lp0: 950, lp1: 220, gain: 1.2 });
    addTone(b, sr, { dur: 0.1, f0: 150, f1: 68, tau: 0.05, gain: 1 });
    addNoise(b, sr, { dur: 0.03, attack: 0.0008, tau: 0.008, hp: 500, lp0: 3000, gain: 0.3 });
    softClip(b, 1.4);
  } },
  ricochet: { dur: 0.6, gain: 0.45, varMult: 1.8, synth(b, sr) {
    addNoise(b, sr, { dur: 0.05, attack: 0.0006, tau: 0.014, hp: 1600, lp0: 9500, gain: 0.6 });
    addTone(b, sr, { t0: 0.01, dur: 0.5, f0: 2650, f1: 640, attack: 0.004, tau: 0.17, vibHz: 33, vibDepth: 0.035, gain: 0.85 });
    addTone(b, sr, { t0: 0.02, dur: 0.4, f0: 1900, f1: 480, attack: 0.006, tau: 0.12, vibHz: 27, vibDepth: 0.05, gain: 0.3 });
  } },

  /* ---------------- MELEE (knife/bat, §1C) ---------------- */
  // knife_swing: a fast airy whoosh — thin band of noise swept UP as the blade
  // cuts the air, short and sharp.
  knife_swing: { dur: 0.22, gain: 0.6, varMult: 1.4, synth(b, sr) {
    addNoise(b, sr, { dur: 0.16, attack: 0.02, hold: 0.01, tau: 0.06, hp: 500, lp0: 1400, lp1: 4200, gain: 0.85, pink: true });
    addNoise(b, sr, { dur: 0.1, attack: 0.012, tau: 0.04, hp: 1200, lp0: 6500, gain: 0.3 }); // airy top edge
    softClip(b, 1.3);
  } },
  // knife_hit: a wet flesh thunk + a small bright metallic tick as the edge bites.
  knife_hit: { dur: 0.24, gain: 0.85, varMult: 1.2, synth(b, sr) {
    thunk(b, sr, { t0: 0, weight: 0.5, gain: 1.0 });                                // wet body
    addNoise(b, sr, { dur: 0.05, attack: 0.001, tau: 0.02, lp0: 800, lp1: 220, gain: 0.7, pink: true }); // squelch
    addPartials(b, sr, { t0: 0.002, gain: 0.35, partials: [{ f: 3200, a: 1, tau: 0.012 }, { f: 5200, a: 0.4, tau: 0.008 }] }); // metallic tick
    softClip(b, 1.5);
  } },
  // bat_swing: a heavier, LOWER whoosh — more air, longer, than the knife.
  bat_swing: { dur: 0.34, gain: 0.68, varMult: 1.2, synth(b, sr) {
    addNoise(b, sr, { dur: 0.28, attack: 0.03, hold: 0.02, tau: 0.1, hp: 200, lp0: 700, lp1: 2200, gain: 0.95, pink: true });
    addTone(b, sr, { t0: 0.01, dur: 0.18, f0: 220, f1: 120, tau: 0.08, type: 'tri', gain: 0.35 }); // low air-pressure body
    softClip(b, 1.4);
  } },
  // bat_hit: a BIG meaty thud — heavy low thunk + a deep sine + soft-clip weight.
  bat_hit: { dur: 0.4, gain: 1.05, varMult: 1.0, synth(b, sr) {
    thunk(b, sr, { t0: 0, weight: 0.9, gain: 1.25 });                               // heavy body
    addTone(b, sr, { t0: 0, dur: 0.26, f0: 110, f1: 44, tau: 0.12, type: 'sine', gain: 1.2 }); // deep chest whump
    addNoise(b, sr, { dur: 0.08, attack: 0.001, tau: 0.03, lp0: 900, lp1: 180, gain: 0.8, pink: true }); // impact splat
    addTone(b, sr, { t0: 0.01, dur: 0.14, f0: 190, f1: 80, tau: 0.06, type: 'tri', gain: 0.5 });
    softClip(b, 2.2);
    combTail(b, sr, { delay: 0.03, fb: 0.3, damp: 0.24, wet: 0.1 });
  } },
  // melee_whiff: a pure airy whoosh miss — no impact at all, just cut air.
  melee_whiff: { dur: 0.24, gain: 0.5, varMult: 1.5, synth(b, sr) {
    addNoise(b, sr, { dur: 0.2, attack: 0.03, hold: 0.02, tau: 0.08, hp: 350, lp0: 1100, lp1: 3200, gain: 0.8, pink: true });
    softClip(b, 1.2);
  } },

  /* ---------------- hit feedback ---------------- */
  hitmarker: { dur: 0.07, gain: 0.5, varMult: 0.5, synth(b, sr) {
    addTone(b, sr, { dur: 0.05, f0: 2150, f1: 1980, tau: 0.016, type: 'tri', gain: 1 });
    addNoise(b, sr, { dur: 0.006, attack: 0.0004, tau: 0.002, hp: 1500, lp0: 9000, gain: 0.25 });
  } },
  kill_confirm: { dur: 0.3, gain: 0.55, varMult: 0.25, synth(b, sr) {
    addTone(b, sr, { t0: 0, dur: 0.09, f0: 880, tau: 0.05, type: 'tri', gain: 0.9 });
    addTone(b, sr, { t0: 0.085, dur: 0.2, f0: 1318, tau: 0.09, type: 'tri', gain: 1 });
    addTone(b, sr, { t0: 0.085, dur: 0.2, f0: 2637, tau: 0.05, gain: 0.18 }); // sparkle
  } },
  headshot: { dur: 0.38, gain: 0.55, varMult: 0.25, synth(b, sr) {
    addNoise(b, sr, { dur: 0.008, attack: 0.0004, tau: 0.003, hp: 2000, lp0: 10000, gain: 0.3 });
    addPartials(b, sr, { gain: 1, partials: [ // bright glassy ding (also bullseye)
      { f: 2350, a: 1, tau: 0.14 }, { f: 2368, a: 0.7, tau: 0.12 },
      { f: 4700, a: 0.45, tau: 0.09 }, { f: 7050, a: 0.22, tau: 0.06 },
    ] });
  } },

  /* ---------------- countdown / fanfare ---------------- */
  beep: { dur: 0.18, gain: 0.45, varMult: 0, synth(b, sr) {
    addTone(b, sr, { dur: 0.16, f0: 880, attack: 0.006, hold: 0.1, tau: 0.02, type: 'tri', gain: 0.8 });
    addTone(b, sr, { dur: 0.16, f0: 1760, attack: 0.006, hold: 0.1, tau: 0.02, gain: 0.12 });
  } },
  beep_go: { dur: 0.32, gain: 0.5, varMult: 0, synth(b, sr) {
    addTone(b, sr, { dur: 0.3, f0: 1318, attack: 0.005, hold: 0.18, tau: 0.035, type: 'tri', gain: 0.85 });
    addTone(b, sr, { dur: 0.3, f0: 2637, attack: 0.005, hold: 0.18, tau: 0.035, gain: 0.14 });
  } },
  lap_best: { dur: 0.8, gain: 0.55, varMult: 0, synth(b, sr) {
    const note = (t0, f, hold, tau, g = 1) => {
      addTone(b, sr, { t0, dur: hold + tau * 6, f0: f, attack: 0.004, hold, tau, type: 'tri', gain: 0.85 * g });
      addTone(b, sr, { t0, dur: hold + tau * 6, f0: f * 2, attack: 0.004, hold, tau, gain: 0.12 * g });
    };
    note(0, 784, 0.06, 0.04);      // G5
    note(0.12, 988, 0.06, 0.04);   // B5
    note(0.24, 1318, 0.14, 0.16, 1.1); // E6, held
  } },

  /* ---------------- 1E accolade / medal stings ---------------- */
  // accolade: a crisp two-note rising sting (a beat above the kill-confirm ding).
  accolade: { dur: 0.34, gain: 0.6, varMult: 0.15, synth(b, sr) {
    const note = (t0, f, tau, g = 1) => { addTone(b, sr, { t0, dur: tau * 6, f0: f, attack: 0.003, tau, type: 'tri', gain: 0.9 * g }); addTone(b, sr, { t0, dur: tau * 5, f0: f * 2, attack: 0.003, tau, gain: 0.14 * g }); };
    note(0, 1046, 0.05);        // C6
    note(0.075, 1568, 0.11, 1.05); // G6, held
    addNoise(b, sr, { dur: 0.01, attack: 0.0004, tau: 0.004, hp: 2000, lp0: 10000, gain: 0.15 });
  } },
  // accolade_move: a whooshier, brighter 3-note rip for MOVEMENT medals (cyan-flavored).
  accolade_move: { dur: 0.44, gain: 0.62, varMult: 0.1, synth(b, sr) {
    addNoise(b, sr, { dur: 0.16, attack: 0.006, tau: 0.06, hp: 700, lp0: 3000, lp1: 6000, gain: 0.28, pink: true }); // rising whoosh
    const note = (t0, f, tau, g = 1) => { addTone(b, sr, { t0, dur: tau * 6, f0: f, attack: 0.003, tau, type: 'tri', gain: 0.85 * g }); addTone(b, sr, { t0, dur: tau * 5, f0: f * 2.01, attack: 0.003, tau, gain: 0.12 * g }); };
    note(0, 1175, 0.045); note(0.06, 1568, 0.045); note(0.12, 2093, 0.12, 1.1); // D6-G6-C7 rip
  } },
  // accolade_big: a fuller three-note major fanfare for the biggest medals.
  accolade_big: { dur: 0.7, gain: 0.68, varMult: 0.05, synth(b, sr) {
    const note = (t0, f, hold, tau, g = 1) => { addTone(b, sr, { t0, dur: hold + tau * 6, f0: f, attack: 0.004, hold, tau, type: 'tri', gain: 0.9 * g }); addTone(b, sr, { t0, dur: hold + tau * 6, f0: f * 2, attack: 0.004, hold, tau, gain: 0.16 * g }); addTone(b, sr, { t0, dur: hold + tau * 5, f0: f * 3, attack: 0.004, hold, tau, gain: 0.07 * g }); };
    note(0, 784, 0.05, 0.05);      // G5
    note(0.1, 1046, 0.05, 0.05);   // C6
    note(0.2, 1568, 0.18, 0.2, 1.15); // G6, held bright
    addNoise(b, sr, { dur: 0.012, attack: 0.0004, tau: 0.004, hp: 2200, lp0: 11000, gain: 0.18 });
  } },

  /* ==================================================================== */
  /* TD TOWER SFX — dedicated per-tower cues for ARENA Tower Defense.     */
  /* All SHORT and mixed quiet (gain 0.2–0.45) so they sit UNDER gunfire. */
  /* Keys match TD_SFX in src/td/TdView.js exactly.                       */
  /* ==================================================================== */

  // gatling: snappy mechanical burst tick — dry bright tick + tiny metal clack.
  td_gatling: { dur: 0.09, gain: 0.32, varMult: 1.6, synth(b, sr) {
    addNoise(b, sr, { dur: 0.02, attack: 0.0004, tau: 0.006, hp: 900, lp0: 8500, lp1: 2600, gain: 0.9 });
    clack(b, sr, { t0: 0.002, tone: 2500, weight: 0.25, gain: 0.6, ring: 0.01 });
    addTone(b, sr, { dur: 0.05, f0: 420, f1: 150, tau: 0.016, type: 'tri', gain: 0.55 });
    softClip(b, 1.6);
  } },

  // rail: sharp crack + long descending electric whine as the rail discharges.
  td_rail: { dur: 0.5, gain: 0.4, synth(b, sr) {
    addNoise(b, sr, { dur: 0.025, attack: 0.0003, tau: 0.008, hp: 1400, lp0: 12000, lp1: 3500, gain: 1.1 });
    addNoise(b, sr, { dur: 0.09, attack: 0.001, tau: 0.03, hp: 300, lp0: 5000, lp1: 900, gain: 0.6 });
    // long descending whine — the rail ringing down after the shot
    addTone(b, sr, { t0: 0.015, dur: 0.46, f0: 3400, f1: 480, attack: 0.004, tau: 0.15,
      type: 'saw', vibHz: 26, vibDepth: 0.025, gain: 0.4 });
    addTone(b, sr, { t0: 0.02, dur: 0.36, f0: 1700, f1: 320, attack: 0.006, tau: 0.11, gain: 0.22 });
    softClip(b, 1.8);
  } },

  // mortar: deep muffled thump + a thin shell whistle receding upward-then-down.
  td_mortar: { dur: 0.5, gain: 0.42, synth(b, sr) {
    thunk(b, sr, { t0: 0, weight: 0.9, gain: 1.1 });
    addTone(b, sr, { t0: 0, dur: 0.24, f0: 80, f1: 42, tau: 0.1, type: 'sine', gain: 1.0 });
    addNoise(b, sr, { dur: 0.16, attack: 0.001, tau: 0.05, lp0: 1100, lp1: 220, gain: 0.7, pink: true });
    // shell whistle tail: thin sine rising then thinning out as the round departs
    addTone(b, sr, { t0: 0.09, dur: 0.4, f0: 1500, f1: 2600, attack: 0.05, tau: 0.14,
      vibHz: 14, vibDepth: 0.03, gain: 0.14 });
    softClip(b, 1.8);
  } },

  // tesla: crackling zap — a spray of micro noise bursts + jittery high tones.
  td_tesla: { dur: 0.2, gain: 0.34, varMult: 1.6, synth(b, sr) {
    for (let i = 0; i < 7; i++) {
      const t0 = i * 0.022 + (i % 3) * 0.004;
      addNoise(b, sr, { t0, dur: 0.014, attack: 0.0003, tau: 0.004,
        hp: 1800, lp0: 12000, lp1: 5000, gain: 0.7 - i * 0.06 });
      addTone(b, sr, { t0, dur: 0.03, f0: 2600 + (i * 977) % 2200, f1: 1400 + (i * 613) % 1400,
        tau: 0.008, type: 'square', gain: 0.16 });
    }
    addTone(b, sr, { dur: 0.16, f0: 130, f1: 95, tau: 0.06, type: 'square', gain: 0.12 }); // arc body buzz
    softClip(b, 1.9);
  } },

  // cryo: glassy shimmer + icy hiss — high detuned glass partials over pink air.
  td_cryo: { dur: 0.38, gain: 0.3, synth(b, sr) {
    addPartials(b, sr, { gain: 0.8, partials: [
      { f: 3520, a: 1, tau: 0.09 }, { f: 3540, a: 0.7, tau: 0.08 },
      { f: 5280, a: 0.5, tau: 0.06 }, { f: 7040, a: 0.3, tau: 0.045 },
      { f: 2640, a: 0.45, tau: 0.11 },
    ] });
    // icy hiss, closing down like frost settling
    addNoise(b, sr, { dur: 0.32, attack: 0.01, tau: 0.11, hp: 2600, lp0: 11000, lp1: 4200, gain: 0.3, pink: true });
    addTone(b, sr, { t0: 0.02, dur: 0.2, f0: 1760, f1: 1180, attack: 0.02, tau: 0.08, gain: 0.14 });
  } },

  // acid: wet spurt + sizzle — a low squelchy burst then a thin frying hiss.
  td_acid: { dur: 0.34, gain: 0.32, varMult: 1.4, synth(b, sr) {
    // wet spurt: dark pink blip with a downward glug tone
    addNoise(b, sr, { dur: 0.07, attack: 0.002, tau: 0.024, lp0: 750, lp1: 200, gain: 1.0, pink: true });
    addTone(b, sr, { dur: 0.09, f0: 300, f1: 90, tau: 0.03, type: 'sine', gain: 0.7 });
    // sizzle: bright crackly noise decaying as the acid eats in
    addNoise(b, sr, { t0: 0.05, dur: 0.28, attack: 0.02, tau: 0.1, hp: 2200, lp0: 9000, lp1: 3000, gain: 0.32 });
    addNoise(b, sr, { t0: 0.07, dur: 0.2, attack: 0.015, tau: 0.07, hp: 1000, lp0: 4000, lp1: 1500, gain: 0.2, pink: true });
    softClip(b, 1.5);
  } },

  // hive: buzzy wing-swarm chirp — detuned saw buzzes with fast flutter vibrato.
  td_hive: { dur: 0.26, gain: 0.3, varMult: 1.3, synth(b, sr) {
    addTone(b, sr, { dur: 0.22, f0: 340, f1: 520, attack: 0.008, tau: 0.08,
      type: 'saw', vibHz: 52, vibDepth: 0.2, gain: 0.55 });
    addTone(b, sr, { t0: 0.01, dur: 0.2, f0: 510, f1: 760, attack: 0.01, tau: 0.07,
      type: 'saw', vibHz: 67, vibDepth: 0.24, gain: 0.35 });
    addTone(b, sr, { t0: 0.02, dur: 0.16, f0: 1020, f1: 1450, attack: 0.012, tau: 0.055,
      type: 'tri', vibHz: 80, vibDepth: 0.16, gain: 0.2 });
    addNoise(b, sr, { dur: 0.18, attack: 0.01, tau: 0.06, hp: 900, lp0: 3600, lp1: 1800, gain: 0.2, pink: true });
    softClip(b, 1.6);
  } },

  // sniper (tower): tight supersonic crack — all snap, tiny body, no boom tail.
  td_sniper: { dur: 0.16, gain: 0.42, synth(b, sr) {
    addNoise(b, sr, { dur: 0.018, attack: 0.0003, tau: 0.005, hp: 1800, lp0: 14000, lp1: 5000, gain: 1.2 });
    addNoise(b, sr, { dur: 0.06, attack: 0.0008, tau: 0.02, hp: 400, lp0: 6000, lp1: 1100, gain: 0.6 });
    addTone(b, sr, { dur: 0.05, f0: 480, f1: 140, tau: 0.016, type: 'tri', attack: 0.0006, gain: 0.8 });
    addTone(b, sr, { dur: 0.07, f0: 110, f1: 60, tau: 0.024, gain: 0.4 });
    softClip(b, 2.0);
  } },

  // banner: short war-horn blast — low brassy saw stack swelling then releasing.
  td_banner: { dur: 0.75, gain: 0.38, varMult: 0.3, synth(b, sr) {
    const horn = (f, g) => {
      addTone(b, sr, { dur: 0.68, f0: f * 0.97, f1: f, attack: 0.06, hold: 0.3, tau: 0.1,
        type: 'saw', vibHz: 5.5, vibDepth: 0.008, gain: g });
    };
    horn(196, 0.5);   // G3 fundamental
    horn(294, 0.3);   // D4 fifth
    horn(392, 0.18);  // G4 octave
    addTone(b, sr, { dur: 0.6, f0: 98, f1: 98, attack: 0.07, hold: 0.26, tau: 0.09, type: 'tri', gain: 0.3 }); // chest
    addNoise(b, sr, { dur: 0.5, attack: 0.06, hold: 0.2, tau: 0.09, hp: 500, lp0: 2400, lp1: 1400, gain: 0.1, pink: true }); // breath
    softClip(b, 1.7);
  } },

  // overclock: rising power-up whirr — motor spinning up with a brightening whine.
  td_overclock: { dur: 0.4, gain: 0.3, varMult: 0.5, synth(b, sr) {
    addTone(b, sr, { dur: 0.36, f0: 220, f1: 980, attack: 0.02, hold: 0.14, tau: 0.07,
      type: 'saw', vibHz: 40, vibDepth: 0.06, gain: 0.45 });
    addTone(b, sr, { t0: 0.02, dur: 0.34, f0: 440, f1: 1960, attack: 0.03, hold: 0.12, tau: 0.06,
      type: 'tri', gain: 0.3 });
    addNoise(b, sr, { dur: 0.34, attack: 0.03, hold: 0.1, tau: 0.08, hp: 600, lp0: 1600, lp1: 5200, gain: 0.25, pink: true });
    clack(b, sr, { t0: 0.0, tone: 2100, weight: 0.2, gain: 0.35, ring: 0.01 }); // engage click
    softClip(b, 1.5);
  } },

  // depot: metallic ammo clack + latch — box drop, shells settle, latch snaps.
  td_depot: { dur: 0.3, gain: 0.34, varMult: 1.2, synth(b, sr) {
    clack(b, sr, { t0: 0, tone: 1600, weight: 0.7, gain: 0.9, ring: 0.018 });      // ammo box clack
    slideFoley(b, sr, { t0: 0.03, dur: 0.09, f0: 1900, f1: 1000, gain: 0.3 });     // shells shifting
    clack(b, sr, { t0: 0.07, tone: 2700, weight: 0.15, gain: 0.35, ring: 0.008 }); // small rattle
    clack(b, sr, { t0: 0.16, tone: 2200, weight: 0.45, gain: 0.8, ring: 0.014 });  // latch snap
    softClip(b, 1.4);
  } },

  // shield: soft resonant dome pulse — round detuned sine swell, no transient.
  td_shield: { dur: 0.42, gain: 0.3, varMult: 0.4, synth(b, sr) {
    addTone(b, sr, { dur: 0.38, f0: 520, f1: 490, attack: 0.05, hold: 0.08, tau: 0.11, gain: 0.7 });
    addTone(b, sr, { t0: 0.01, dur: 0.34, f0: 782, f1: 736, attack: 0.06, hold: 0.06, tau: 0.09, gain: 0.35 });
    addTone(b, sr, { t0: 0.02, dur: 0.3, f0: 1042, f1: 985, attack: 0.07, tau: 0.08, gain: 0.16 });
    addTone(b, sr, { dur: 0.3, f0: 260, f1: 245, attack: 0.05, tau: 0.1, type: 'tri', gain: 0.3 }); // low dome body
    combTail(b, sr, { delay: 0.03, fb: 0.35, damp: 0.4, wet: 0.18 });
  } },

  // grav: deep sub warble descending — slow-wobbled sine sinking into the floor.
  td_grav: { dur: 0.48, gain: 0.4, varMult: 0.5, synth(b, sr) {
    addTone(b, sr, { dur: 0.44, f0: 95, f1: 38, attack: 0.015, hold: 0.06, tau: 0.15,
      type: 'sine', vibHz: 11, vibDepth: 0.09, gain: 1.0 });
    addTone(b, sr, { t0: 0.01, dur: 0.36, f0: 190, f1: 76, attack: 0.02, tau: 0.12,
      type: 'tri', vibHz: 9, vibDepth: 0.07, gain: 0.35 });
    addNoise(b, sr, { dur: 0.3, attack: 0.02, tau: 0.1, lp0: 260, lp1: 90, gain: 0.3, pink: true }); // dark air
    softClip(b, 1.7);
  } },

  // bounty: bright coin chime arpeggio — three quick glassy dings rising.
  td_bounty: { dur: 0.36, gain: 0.32, varMult: 0.3, synth(b, sr) {
    const coin = (t0, f, g) => addPartials(b, sr, { t0, gain: g, partials: [
      { f, a: 1, tau: 0.07 }, { f: f * 2.01, a: 0.4, tau: 0.05 }, { f: f * 2.98, a: 0.18, tau: 0.035 },
    ] });
    coin(0, 1568, 0.7);       // G6
    coin(0.06, 1976, 0.75);   // B6
    coin(0.12, 2637, 0.85);   // E7, top sparkle
    addNoise(b, sr, { dur: 0.008, attack: 0.0004, tau: 0.003, hp: 3000, lp0: 12000, gain: 0.12 });
  } },

  // plasma: harmonic beam hum pulse — odd-harmonic sine stack that blooms & fades.
  td_plasma: { dur: 0.3, gain: 0.32, varMult: 0.6, synth(b, sr) {
    const base = 220;
    addTone(b, sr, { dur: 0.26, f0: base, f1: base * 1.06, attack: 0.02, hold: 0.08, tau: 0.06,
      vibHz: 30, vibDepth: 0.02, gain: 0.6 });
    addTone(b, sr, { dur: 0.24, f0: base * 3, f1: base * 3.18, attack: 0.025, hold: 0.06, tau: 0.05,
      vibHz: 30, vibDepth: 0.02, gain: 0.3 });
    addTone(b, sr, { dur: 0.2, f0: base * 5, f1: base * 5.3, attack: 0.03, tau: 0.045, gain: 0.14 });
    addTone(b, sr, { dur: 0.18, f0: base * 7, f1: base * 7.4, attack: 0.03, tau: 0.04, gain: 0.07 });
    addNoise(b, sr, { dur: 0.14, attack: 0.01, tau: 0.05, hp: 1400, lp0: 5200, lp1: 2400, gain: 0.12 }); // ionized air
    softClip(b, 1.6);
  } },
};

/* ========================================================================== */
/* Engine                                                                      */
/* ========================================================================== */

export class AudioEngine {
  constructor(ctx) {
    this.ctx = ctx;

    const AC = window.AudioContext || window.webkitAudioContext;
    this.actx = new AC({ latencyHint: 'interactive' });
    this.sampleRate = this.actx.sampleRate;

    // Audio tunables (registered below in ctx.tunables, cat 'audio').
    this.params = {
      firePunch: 1.0,   // transient/crack gain of gunshots (re-synthesizes)
      subPunch: 1.0,    // low sub-thump weight of gunshots (re-synthesizes)
      boomTail: 1.0,    // gunshot boom-tail wet amount (re-synthesizes)
      brightness: 1.0,  // master lowpass cutoff scale (live)
      variation: 0.04,  // ±random pitch/gain per play
    };

    // -- node chain: sfxGain -> toneFilter -> masterGain -> limiter -> out --
    this.limiter = this.actx.createDynamicsCompressor();
    this.limiter.threshold.value = -10;
    this.limiter.ratio.value = 12;
    this.limiter.knee.value = 4;
    this.limiter.attack.value = 0.002;
    this.limiter.release.value = 0.18;

    this.masterGain = this.actx.createGain();
    this.sfxGain = this.actx.createGain();
    this.toneFilter = this.actx.createBiquadFilter();
    this.toneFilter.type = 'lowpass';
    this.toneFilter.frequency.value = 19500;
    this.toneFilter.Q.value = 0.7071;

    this.sfxGain.connect(this.toneFilter);
    this.toneFilter.connect(this.masterGain);
    this.masterGain.connect(this.limiter);
    this.limiter.connect(this.actx.destination);

    // -- volumes: initial read + live-follow settings ------------------------
    const clamp01 = (v) => Math.min(1.5, Math.max(0, Number(v) || 0));
    this.masterGain.gain.value = clamp01(ctx.settings.get('volMaster', 0.8));
    this.sfxGain.gain.value = clamp01(ctx.settings.get('volSfx', 1.0));
    ctx.settings.onChange('volMaster', (v) => {
      this.masterGain.gain.setTargetAtTime(clamp01(v), this.actx.currentTime, 0.03);
    });
    ctx.settings.onChange('volSfx', (v) => {
      this.sfxGain.gain.setTargetAtTime(clamp01(v), this.actx.currentTime, 0.03);
    });

    // -- state ----------------------------------------------------------------
    this.buffers = new Map();       // name -> AudioBuffer
    this._voices = [];              // live voices (one-shots + loops)
    this.maxVoices = 32;
    this._warnedMissing = new Set();
    this._fireTimer = 0;
    this._sweepT = 0;
    this._noop = Object.freeze({ stop() {}, setVolume() {}, setRate() {} });

    this._renderAllBuffers();
    this._registerTunables();
    this._bindResume();
  }

  /* ---- public API --------------------------------------------------------- */

  /** One-shot playback. Returns a handle { stop, setVolume, setRate } (never throws). */
  play(name, opts = {}) {
    const def = SOUNDS[name];
    const buf = this.buffers.get(name);
    if (!def || !buf) return this._missing(name);
    // Before the first user gesture nothing can be heard — skip quietly so a
    // backlog of stale one-shots doesn't burst out on resume.
    if (this.actx.state !== 'running') return this._noop;
    const { volume = 1, rate = 1, position = null, delay = 0 } = opts;
    return this._spawnVoice(def, buf, { volume, rate, position, delay, loop: false, fadeIn: 0 });
  }

  /** Seamless loop. Handle: { stop(fadeSec=0.1), setVolume(v), setRate(r) }. */
  startLoop(name, opts = {}) {
    const def = SOUNDS[name];
    const buf = this.buffers.get(name);
    if (!def || !buf) return this._missing(name);
    const { volume = 1, position = null } = opts;
    // Loops started while suspended simply begin once the context resumes.
    return this._spawnVoice(def, buf, { volume, rate: 1, position, delay: 0, loop: true, fadeIn: 0.06 });
  }

  /** Per-frame: sync AudioContext listener to the world camera; housekeeping. */
  render(dt) {
    const cam = this.ctx.camera;
    if (cam) {
      cam.updateMatrixWorld();
      const e = cam.matrixWorld.elements;
      // basis columns: X=(e0,e1,e2) Y=(e4,e5,e6) Z=(e8,e9,e10); forward = -Z
      let fx = -e[8], fy = -e[9], fz = -e[10];
      let ux = e[4], uy = e[5], uz = e[6];
      const fl = Math.hypot(fx, fy, fz) || 1;
      const ul = Math.hypot(ux, uy, uz) || 1;
      fx /= fl; fy /= fl; fz /= fl;
      ux /= ul; uy /= ul; uz /= ul;

      const l = this.actx.listener;
      if (l.positionX) {
        l.positionX.value = e[12];
        l.positionY.value = e[13];
        l.positionZ.value = e[14];
        l.forwardX.value = fx;
        l.forwardY.value = fy;
        l.forwardZ.value = fz;
        l.upX.value = ux;
        l.upY.value = uy;
        l.upZ.value = uz;
      } else {
        l.setPosition(e[12], e[13], e[14]);
        l.setOrientation(fx, fy, fz, ux, uy, uz);
      }
    }

    // Periodic sweep for voices whose onended never fired (edge cases).
    this._sweepT += dt || 0;
    if (this._sweepT > 2) {
      this._sweepT = 0;
      for (let i = this._voices.length - 1; i >= 0; i--) {
        if (this._voices[i].ended) this._voices.splice(i, 1);
      }
    }
  }

  /** Debug helper (not part of the contract): audition the whole bank from console. */
  debugPlayAll(gapMs = 400) {
    const names = Object.keys(SOUNDS).filter((n) => !SOUNDS[n].loop);
    names.forEach((n, i) => {
      setTimeout(() => { console.log('[audio]', n); this.play(n); }, i * gapMs);
    });
  }

  /* ---- internals ----------------------------------------------------------- */

  _spawnVoice(def, buf, o) {
    if (this._voices.length >= this.maxVoices) {
      const freed = this._steal();
      if (!freed && !o.loop) return this._noop; // all slots are protected loops
    }

    const actx = this.actx;
    const now = actx.currentTime;
    const varAmt = this.params.variation * (def.varMult ?? 1);
    const rate = Math.max(0.05, o.rate * (1 + (Math.random() * 2 - 1) * varAmt));
    const vol = Math.max(0, (def.gain ?? 1) * o.volume * (1 + (Math.random() * 2 - 1) * varAmt));

    const src = actx.createBufferSource();
    src.buffer = buf;
    src.loop = o.loop;
    src.playbackRate.value = rate;

    const gain = actx.createGain();
    if (o.fadeIn > 0) {
      gain.gain.value = 0.0001;
      gain.gain.setTargetAtTime(Math.max(0.0001, vol), now, o.fadeIn / 3);
    } else {
      gain.gain.value = vol;
    }

    let panner = null;
    if (o.position) {
      panner = actx.createPanner();
      panner.panningModel = 'equalpower';
      panner.distanceModel = 'inverse';
      panner.refDistance = 3;
      panner.maxDistance = 500;
      panner.rolloffFactor = 1;
      if (panner.positionX) {
        panner.positionX.value = o.position.x;
        panner.positionY.value = o.position.y;
        panner.positionZ.value = o.position.z;
      } else {
        panner.setPosition(o.position.x, o.position.y, o.position.z);
      }
      src.connect(panner);
      panner.connect(gain);
    } else {
      src.connect(gain);
    }
    gain.connect(this.sfxGain);

    const voice = {
      src, gain, panner,
      defGain: def.gain ?? 1,
      loop: o.loop,
      startedAt: now + o.delay,
      ended: false,
    };
    this._voices.push(voice);

    src.onended = () => {
      voice.ended = true;
      try {
        src.disconnect();
        gain.disconnect();
        panner?.disconnect();
      } catch { /* already gone */ }
      const i = this._voices.indexOf(voice);
      if (i >= 0) this._voices.splice(i, 1);
    };

    try {
      src.start(now + Math.max(0, o.delay));
    } catch {
      voice.ended = true;
    }

    const self = this;
    return {
      stop(fadeSec = 0.1) {
        if (voice.ended) return;
        const t = self.actx.currentTime;
        try {
          voice.gain.gain.cancelScheduledValues(t);
          voice.gain.gain.setTargetAtTime(0.0001, t, Math.max(0.005, fadeSec / 3));
          voice.src.stop(t + fadeSec + 0.08);
        } catch { /* not started yet / already stopped */ }
      },
      setVolume(v) {
        if (voice.ended) return;
        voice.gain.gain.setTargetAtTime(
          Math.max(0.0001, voice.defGain * v), self.actx.currentTime, 0.03);
      },
      setRate(r) {
        if (voice.ended) return;
        voice.src.playbackRate.setTargetAtTime(
          Math.max(0.05, r), self.actx.currentTime, 0.03);
      },
    };
  }

  // Free one slot: fade out the quietest/oldest one-shot. Loops are protected.
  _steal() {
    let best = null;
    let bestScore = Infinity;
    for (const v of this._voices) {
      if (v.loop || v.ended) continue;
      const age = this.actx.currentTime - v.startedAt;
      const score = v.gain.gain.value - age * 0.05; // quieter + older first
      if (score < bestScore) {
        bestScore = score;
        best = v;
      }
    }
    if (!best) return false;
    const t = this.actx.currentTime;
    try {
      best.gain.gain.setTargetAtTime(0.0001, t, 0.01);
      best.src.stop(t + 0.05);
    } catch { /* fine */ }
    return true;
  }

  _missing(name) {
    if (!this._warnedMissing.has(name)) {
      this._warnedMissing.add(name);
      console.warn(`[audio] unknown sound name '${name}' — playing nothing`);
    }
    return this._noop;
  }

  _renderBuffer(name) {
    const def = SOUNDS[name];
    const sr = this.sampleRate;
    let data = new Float32Array(Math.max(16, Math.ceil(def.dur * sr)));
    def.synth(data, sr, this.params);
    if (def.loop) {
      data = makeLoop(data, sr, def.loopXf ?? 0.25);
    } else {
      fadeEnds(data, sr);
    }
    normalize(data, 0.9);
    const buf = this.actx.createBuffer(1, data.length, sr);
    buf.copyToChannel(data, 0);
    this.buffers.set(name, buf);
  }

  _renderAllBuffers() {
    const t0 = performance.now();
    for (const name of Object.keys(SOUNDS)) this._renderBuffer(name);
    console.log(
      `[audio] synthesized ${this.buffers.size} sounds in ${(performance.now() - t0).toFixed(1)} ms`);
  }

  // Debounced re-synthesis of the 5 gunshots when a synth tunable moves.
  _rerenderFireSounds() {
    clearTimeout(this._fireTimer);
    this._fireTimer = setTimeout(() => {
      for (const name of Object.keys(SOUNDS)) {
        if (SOUNDS[name].fire) this._renderBuffer(name);
      }
    }, 80);
  }

  _applyBrightness() {
    const fc = Math.min(20000, Math.max(600, 19500 * this.params.brightness));
    this.toneFilter.frequency.setTargetAtTime(fc, this.actx.currentTime, 0.05);
  }

  _registerTunables() {
    this.ctx.tunables.push(
      {
        cat: 'audio', key: 'firePunch', label: 'Fire punch (transient)',
        min: 0.2, max: 2.5, step: 0.05,
        get: () => this.params.firePunch,
        set: (v) => { this.params.firePunch = v; this._rerenderFireSounds(); },
      },
      {
        cat: 'audio', key: 'subPunch', label: 'Fire sub thump (low-end)',
        min: 0, max: 2.5, step: 0.05,
        get: () => this.params.subPunch,
        set: (v) => { this.params.subPunch = v; this._rerenderFireSounds(); },
      },
      {
        cat: 'audio', key: 'boomTail', label: 'Fire boom tail',
        min: 0, max: 2.5, step: 0.05,
        get: () => this.params.boomTail,
        set: (v) => { this.params.boomTail = v; this._rerenderFireSounds(); },
      },
      {
        cat: 'audio', key: 'brightness', label: 'Brightness (LP cutoff scale)',
        min: 0.15, max: 1.2, step: 0.01,
        get: () => this.params.brightness,
        set: (v) => { this.params.brightness = v; this._applyBrightness(); },
      },
      {
        cat: 'audio', key: 'variation', label: 'Pitch/gain variation',
        min: 0, max: 0.12, step: 0.005,
        get: () => this.params.variation,
        set: (v) => { this.params.variation = v; },
      },
    );
  }

  // Browsers gate audio behind a user gesture: resume on first pointer/key.
  _bindResume() {
    const tryResume = () => {
      if (this.actx.state === 'suspended') {
        this.actx.resume().then(() => {
          if (this.actx.state === 'running') unbind();
        }).catch(() => { /* keep listening */ });
      } else {
        unbind();
      }
    };
    const unbind = () => {
      window.removeEventListener('pointerdown', tryResume);
      window.removeEventListener('keydown', tryResume);
    };
    window.addEventListener('pointerdown', tryResume);
    window.addEventListener('keydown', tryResume);
  }
}
