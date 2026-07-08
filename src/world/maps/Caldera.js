// ARENA map — CALDERA
// ============================ MAP DESIGN CONTRACT ============================
// Name / PLACE: "Caldera" — the throat of an active volcano, fought in the open
//   bowl of the crater around a glowing basalt plug ringed by molten lava. NOT an arena.
// ★ PRIMARY SPATIAL SHAPE: open bowl + raised center. A wide flat crater floor,
//   stepped terraces rising to the caldera wall, and ONE dominant raised plug at
//   the middle. (Spire=vertical tower, Causeway=long corridor — unique axis here.)
// ★ VERTICALITY: y0→7, tiers = crater floor (y0), terrace ledge (y2.5), rim walk
//   (y5), and the plug TOP (y7) spiking ABOVE the rim as the king-of-the-hill.
//   Read: a shallow bowl with one tall thumb of rock — not Spire's stacked shaft,
//   not Causeway's flat spans.
// ★ SIGHTLINE: OPEN + radial. Long convex sightlines sweep across the bowl rim-to-
//   floor, but the central plug HARD-BLOCKS every straight-across shot → you fight
//   around a pillar, never through it. (Distinct from Causeway's straight lanes.)
// ★ THEME/PALETTE/LIGHT: active volcano — black basalt, molten orange lava, drifting
//   ash under a smoke-choked sky; harsh warm key + red under-glow from the lava,
//   embers rising. Red/orange/black. (Spire=blue neon, Causeway=teal storm — distinct.)
// SIGNATURE SET-PIECE: the central lava-veined plug rising from a glowing MOAT, a
//   rising lava-heated platform on the west, cracked fissures venting light, and the
//   ash plume boiling out of the caldera into the sky.
// FLOW LOOP: spiral down the terraces to the open floor · cross to the plug via the
//   east ramp OR wall-run its faces (the moat punishes a straight walk-up) · hold the
//   plug top · rotate the rim · ride the west lift. ≥2 routes to the center + rim.
// SPAWN LOGIC: staggered floor/terrace/rim positions facing the center; the plug
//   blocks any rim-to-rim spawn peek. No shared spawn sightline.
// PICKUP INTENT: power pickup on the exposed plug top (king-of-hill); minor pickups
//   on the terraces + floor to pull rotations through the lava fissures.
// ============================================================================
import * as THREE from 'three';
import { MapEnv } from '../MapEnv.js';

export class Caldera extends MapEnv {
  buildEnvironment() {
    this.fog(0x3a1a0c, 40, 170); // warm ash haze, pulled back so the bowl reads clear
    this._buildSky();
    this._buildLights();
    this._buildMaterials();
    this._buildTerraces();
    this._buildPlug();
    this._buildLavaGlow();
    this._buildOutside();
    this.ambientParticles('embers', 160, { x: 18, y: 12, z: 18 }, { x: 0, y: 6, z: 0 }, 0xff7a2a);
  }

  _buildMaterials() {
    const basalt = this.tex('basalt', (g, s) => {
      g.fillStyle = '#161010'; g.fillRect(0, 0, s, s);
      for (let i = 0; i < 90; i++) { g.fillStyle = `rgba(${20 + (i * 3) % 20},${16 + (i * 2) % 14},${14},1)`; const x = (i * 47) % s, y = (i * 89) % s, r = 6 + (i % 7) * 4; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); }
      g.strokeStyle = 'rgba(255,90,20,0.10)'; g.lineWidth = 1;                 // faint lava veins
      for (let i = 0; i < 10; i++) { g.beginPath(); g.moveTo((i * 31) % s, 0); g.lineTo((i * 53) % s, s); g.stroke(); }
    }, { repeat: [2, 2] });
    this.material('rock', { map: basalt, color: 0x2a2320, rough: 0.95, metal: 0.05, emissive: 0x2a0a00, emissiveI: 0.35 });
    this.material('rim', { map: basalt, color: 0x241d1a, rough: 0.9, metal: 0.08, emissive: 0x3a1000, emissiveI: 0.4 });
    this.material('wall', { map: basalt, color: 0x1a1512, rough: 1, metal: 0, emissive: 0x1a0600, emissiveI: 0.3 });
    this.material('plug', { map: basalt, color: 0x2e2622, rough: 0.85, metal: 0.1, emissive: 0xff3400, emissiveI: 0.55 }); // hot glowing plug
    this.material('run', { color: 0x3a2418, rough: 0.6, metal: 0.3, emissive: 0x18c0e0, emissiveI: 0.55 }); // wall-run accent (shared cyan language)
    this.material('lavaGlow', { basic: true, color: 0xff6a1e, additive: true });
    this.material('vein', { basic: true, color: 0xff8a2a, additive: true });
  }

  _buildTerraces() {
    for (const s of this.data.solids) {
      const { min: a, max: b } = s;
      const h = b.y - a.y;
      let mat;
      if (s.wallrun) mat = 'plug';                          // the plug body (its ramp face reads hot; wall-run stripes added below)
      else if (h > 10) mat = 'wall';                        // caldera outer wall
      else if (a.y <= 0 && (b.x - a.x) > 20) mat = 'rock';  // crater floor
      else mat = 'rim';                                     // terrace/rim ledges
      this.solid(a.x, a.y, a.z, b.x, b.y, b.z, mat);
    }
    for (const rp of this.data.ramps) this._ramp(rp);
  }

  _ramp(rp) {
    const ax = rp.axis;
    const len = ax === 'x' ? rp.max.x - rp.min.x : rp.max.z - rp.min.z;
    const wid = ax === 'x' ? rp.max.z - rp.min.z : rp.max.x - rp.min.x;
    const rise = rp.h1 - rp.h0, ang = Math.atan2(rise, len);
    const g = new THREE.BoxGeometry(ax === 'x' ? Math.hypot(len, rise) : wid, 0.3, ax === 'x' ? wid : Math.hypot(len, rise));
    const m = this.mesh(g, 'rim', { shadow: true });
    m.position.set((rp.min.x + rp.max.x) / 2, (rp.h0 + rp.h1) / 2, (rp.min.z + rp.max.z) / 2);
    if (ax === 'x') m.rotation.z = rp.h0 > rp.h1 ? ang : -ang;
    else m.rotation.x = rp.h0 > rp.h1 ? -ang : ang;
  }

  _buildPlug() {
    // wall-run stripes down the three non-ramp plug faces (cyan language)
    const stripe = new THREE.BoxGeometry(0.12, 6.6, 0.5);
    const runMat = this.material('run');
    const faces = [
      { pos: { x: -3.56, y: 3.5, z: 0 }, rot: { x: 0, y: 0, z: 0 } },
      { pos: { x: 0, y: 3.5, z: -3.56 }, rot: { x: 0, y: Math.PI / 2, z: 0 } },
      { pos: { x: 0, y: 3.5, z: 3.56 }, rot: { x: 0, y: Math.PI / 2, z: 0 } },
    ];
    this.instance(stripe, runMat, faces, { shadow: false });
    // lava veins crawling up the plug (emissive)
    const vein = new THREE.BoxGeometry(0.08, 7, 0.08);
    const V = [];
    for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; V.push({ pos: { x: Math.cos(a) * 3.45, y: 3.5, z: Math.sin(a) * 3.45 }, rot: { x: 0, y: -a, z: (this.constructor._h(i) - 0.5) * 0.3 } }); }
    this.instance(vein, this.material('vein'), V, { shadow: false });
    // a beacon crown on the king-hill top
    const crown = this.mesh(new THREE.CylinderGeometry(0.1, 0.4, 1.4, 8), 'vein'); crown.position.set(0, 7.7, 0);
  }

  _buildLavaGlow() {
    // PRACTICAL LAVA-GLOW RIG — real point lights at every molten fixture so the play
    // space is lit by firelight, not just emissive strips. Warm firelight throws onto
    // the plug faces, the moat rim, the fissure floor, and up the central plug.
    // Central plug pillar: two stacked lights climb the plug so its faces + the ramp
    // read hot top-to-bottom, and the moat rim around it is bathed in orange.
    this.light('point', { color: 0xff5a1e, intensity: 3, dist: 22, pos: { x: 0, y: 1.2, z: 0 } });   // moat/plug base — brightest hearth
    this.light('point', { color: 0xff7a2e, intensity: 1.8, dist: 16, pos: { x: 0, y: 5.5, z: 0 } });  // up the plug — lights the king-hill top + upper faces
    // Moat glow spread to the N & S bars so the walkways flanking the plug are readable.
    this.light('point', { color: 0xff5218, intensity: 2.2, dist: 16, pos: { x: 0, y: 0.8, z: -4.5 } });// N moat bar
    this.light('point', { color: 0xff5218, intensity: 2.2, dist: 16, pos: { x: 0, y: 0.8, z: 4.5 } }); // S moat bar
    // Fissures venting light on the open crater floor — pull rotations + kill the dark corners.
    this.light('point', { color: 0xff6a22, intensity: 2.4, dist: 18, pos: { x: 7.5, y: 0.8, z: -8.5 } });  // fissure cal_c1 (NE floor)
    this.light('point', { color: 0xff6a22, intensity: 2.4, dist: 18, pos: { x: -7.5, y: 0.8, z: 8.5 } });  // fissure cal_c2 (SW floor)
    // raise the moat/crack sheen brightness with additive quads just above each hazard
    for (const hz of this.data.hazards) {
      const g = new THREE.PlaneGeometry(hz.max.x - hz.min.x, hz.max.z - hz.min.z); g.rotateX(-Math.PI / 2);
      const m = this.mesh(g, 'lavaGlow'); m.position.set((hz.min.x + hz.max.x) / 2, hz.max.y + 0.05, (hz.min.z + hz.max.z) / 2);
      m.receiveShadow = false;
    }
  }

  _buildOutside() {
    // the smoke-choked ash plume + jagged outer volcano cone silhouette (backdrop).
    // outer cone slope beyond the caldera wall (decoration, non-collider)
    const cone = new THREE.CylinderGeometry(26, 60, 40, 24, 1, true);
    const coneMat = this.material('cone', { color: 0x140c0a, rough: 1, side: THREE.BackSide, emissive: 0x200800, emissiveI: 0.3 });
    const cm = this.mesh(cone, coneMat, { shadow: false, receive: false }); cm.position.set(0, 6, 0);
    // ash plume: stacked drifting dark quads billowing upward from the plug
    const puff = new THREE.PlaneGeometry(20, 20);
    const pmat = this.material('ash', { basic: true, color: 0x1c1512, transparent: true, opacity: 0.5 });
    const T = [];
    for (let i = 0; i < 16; i++) { const yy = 14 + i * 6; const rr = 3 + i * 1.4; const a = this.constructor._h(i) * 6.28; T.push({ pos: { x: Math.cos(a) * rr, y: yy, z: Math.sin(a) * rr }, scale: { x: 1 + i * 0.18, y: 1 + i * 0.18, z: 1 } }); }
    this._plume = this.instance(puff, pmat, T, { shadow: false, cull: false });
    // embery sky specks (rising ash lit orange)
    this.skySpecks(120, 0xff7a3a, 130, 1.1);
  }

  _buildSky() {
    // smoke sky: deep red-black zenith → murky ash-orange horizon (glow from the crater)
    this.sky(0x180a06, 0x5a2408, (env) => { env.skySpecks(60, 0xffb070, 300, 1.4); });
  }

  _buildLights() {
    // KEY: warm ashen sun punching through the smoke — the single shadow caster.
    this.light('dir', { color: 0xffb680, intensity: 1.7, dir: { x: -0.3, y: -1, z: 0.2 }, shadow: true, shadowSize: 32 }); // warm ash key
    // FILL: strong hemisphere lifting shadowed terraces + rim to clearly readable, warm
    // ash from above / red lava bounce from below. This is what kills the near-black pits.
    this.light('hemi', { sky: 0x7a4526, ground: 0x40140a, intensity: 1.5 }); // ash sky / red under-bounce
    // AMBIENT: a warm floor so no corner of the bowl reads black even out of the lava's reach.
    this.light('ambient', { color: 0x5a3018, intensity: 0.45 }); // warm baseline
  }

  updateEnv(dt, t) {
    if (this._plume) this._plume.rotation.y = t * 0.05;   // slow boiling plume
  }

  static _h(n) { const s = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return s - Math.floor(s); }
}
