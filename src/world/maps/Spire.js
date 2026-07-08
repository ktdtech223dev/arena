// ARENA map — SPIRE
// ============================ MAP DESIGN CONTRACT ============================
// Name / PLACE: "Spire" — the gutted core of a collapsed neon skyscraper at night,
//   fought floor-to-floor around an open elevator shaft. NOT an arena.
// ★ PRIMARY SPATIAL SHAPE: vertical tower / stacked levels (4 ring-tiers around a
//   central open shaft). Unique in the set.
// ★ VERTICALITY: y 0→18, FOUR distinct tiers (0/5/10/15) + overhang ledges. The
//   movement kit is the vertical circulation: wall-run the 4 shaft columns + the
//   two runnable shell walls to skip tiers; wall-jump between shaft columns and
//   overhang ledges; slide down the ramps. Flat traversal barely exists here.
// ★ SIGHTLINE: mixed — tight ring walkways (CQC) crossed by ONE long vertical
//   sightline straight up/down the shaft (a top-tier player can duel a bottom one).
// ★ THEME/PALETTE/LIGHT: night, cold moonlight key (blue-white) + magenta/cyan
//   neon accents, deep-blue fog, dark concrete + glass. Distinct mood in the set.
// SIGNATURE SET-PIECE: "the shaft" — the open central elevator shaft with a broken
//   glowing lift car riding it and a neon core strip running its full height.
// FLOW LOOP: spiral up the ring via alternating ramps (+X 0→5, −Z 5→10, +Z 10→15),
//   OR wall-run the shaft columns / runnable shell walls as vertical shortcuts, OR
//   ride the lift; drop back down the shaft. ≥2 routes between every tier.
// SPAWN LOGIC: opposite ground corners + two upper-tier ledges, facing inward,
//   never sharing a sightline at spawn (ring bars block cross-tier peeks).
// PICKUP INTENT: power pickup on the exposed shaft-center lift (high risk); minor
//   pickups at ring corners to pull players around each tier.
// ============================================================================
import * as THREE from 'three';
import { MapEnv } from '../MapEnv.js';

export class Spire extends MapEnv {
  buildEnvironment() {
    this.fog(0x101a2e, 40, 170);
    this._buildSky();
    this._buildLights();
    this._buildMaterials();
    this._buildArchitecture();
    this._buildShaft();
    this._buildCity();
    this.ambientParticles('motes', 90, { x: 12, y: 9, z: 12 }, { x: 0, y: 9, z: 0 }, 0x6fd0ff);
  }

  _buildMaterials() {
    const concrete = this.tex('concrete', (g, s) => {
      g.fillStyle = '#12161f'; g.fillRect(0, 0, s, s);
      g.strokeStyle = 'rgba(90,120,150,0.10)'; g.lineWidth = 1;
      for (let i = 0; i <= s; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, s); g.moveTo(0, i); g.lineTo(s, i); g.stroke(); }
      g.fillStyle = 'rgba(0,0,0,0.25)'; for (let i = 0; i < 40; i++) g.fillRect((i * 71) % s, (i * 137) % s, 3, 3);
    }, { repeat: [3, 3] });
    this.material('floor', { map: concrete, color: 0x28303c, rough: 0.9, metal: 0.05 });
    this.material('tier', { map: concrete, color: 0x222a36, rough: 0.85, metal: 0.1 });
    this.material('wall', { color: 0x171d28, rough: 0.8, metal: 0.15, emissive: 0x0a0f18, emissiveI: 0.4 });
    this.material('run', { color: 0x1c2740, rough: 0.5, metal: 0.4, emissive: 0x18b6d8, emissiveI: 0.45 });  // wall-run = shared CYAN language
    this.material('column', { color: 0x161c28, rough: 0.4, metal: 0.6, emissive: 0x18b6d8, emissiveI: 0.4 }); // shaft columns are wall-runnable → cyan too (shaft keeps its magenta core light/strip)
    this.material('neon', { basic: true, color: 0x7df9ff, additive: true });
    this.material('rail', { color: 0x2a3444, metal: 0.7, rough: 0.35, emissive: 0x1a3a4a, emissiveI: 0.5 });
    this.material('ramp', { color: 0x2c3646, rough: 0.7, metal: 0.2, emissive: 0x143a4a, emissiveI: 0.4 });
  }

  _buildArchitecture() {
    // render colliders as real surfaces, classified by role (guarantees visual↔collider match)
    for (const s of this.data.solids) {
      const { min: a, max: b } = s;
      const h = b.y - a.y, thin = Math.min(b.x - a.x, b.z - a.z) < 1.2;
      let mat;
      if (a.y <= 0 && h <= 2.1) mat = 'floor';
      else if (s.wallrun && thin && a.x > -4 && b.x < 4 && a.z > -4 && b.z < 4) mat = 'column';
      else if (s.wallrun) mat = 'run';
      else if (h > 6) mat = 'wall';
      else mat = 'tier';
      this.solid(a.x, a.y, a.z, b.x, b.y, b.z, mat);
    }
    // ramps as sloped decks
    for (const rp of this.data.ramps) this._ramp(rp);
    // window strips punched into the tall shell walls (emissive frames, non-collider)
    this._windows();
    // railings along the ring tier inner edges (instanced posts)
    this._railings();
  }

  _ramp(rp) {
    const ax = rp.axis;
    const len = ax === 'x' ? rp.max.x - rp.min.x : rp.max.z - rp.min.z;
    const wid = ax === 'x' ? rp.max.z - rp.min.z : rp.max.x - rp.min.x;
    const rise = rp.h1 - rp.h0;
    const ang = Math.atan2(rise, len);
    const g = new THREE.BoxGeometry(ax === 'x' ? Math.hypot(len, rise) : wid, 0.3, ax === 'x' ? wid : Math.hypot(len, rise));
    const m = this.mesh(g, 'ramp', { shadow: true });
    m.position.set((rp.min.x + rp.max.x) / 2, (rp.h0 + rp.h1) / 2, (rp.min.z + rp.max.z) / 2);
    if (ax === 'x') m.rotation.z = -ang * Math.sign(rp.max.x - rp.min.x || 1) * (rp.h0 > rp.h1 ? 1 : -1);
    else m.rotation.x = ang * (rp.h0 > rp.h1 ? -1 : 1);
    // neon edge strip
    const eg = new THREE.BoxGeometry(g.parameters.width, 0.06, 0.12);
    const e = this.mesh(eg, 'neon'); e.position.copy(m.position); e.position.y += 0.2; e.rotation.copy(m.rotation);
  }

  _windows() {
    const frame = this.material('winframe', { color: 0x0c1018, metal: 0.6, rough: 0.4, emissive: 0x2a6cff, emissiveI: 0.6 });
    const glow = new THREE.PlaneGeometry(1.4, 2.0);
    const glowMat = this.material('winglow', { basic: true, color: 0x2a6cff, transparent: true, opacity: 0.5, additive: true });
    const T = [];
    for (let tier = 0; tier < 4; tier++) {
      const y = 2.2 + tier * 5;
      for (let x = -10; x <= 10; x += 5) { T.push({ pos: { x, y, z: 13.5 }, rot: { x: 0, y: 0, z: 0 } }); T.push({ pos: { x, y, z: -13.5 }, rot: { x: 0, y: Math.PI, z: 0 } }); }
      for (let z = -10; z <= 10; z += 5) { T.push({ pos: { x: 13.5, y, z }, rot: { x: 0, y: -Math.PI / 2, z: 0 } }); T.push({ pos: { x: -13.5, y, z }, rot: { x: 0, y: Math.PI / 2, z: 0 } }); }
    }
    this.instance(glow, glowMat, T, { shadow: false });
  }

  _railings() {
    const post = new THREE.BoxGeometry(0.08, 1.0, 0.08);
    const T = [];
    for (let tier = 1; tier <= 3; tier++) {
      const y = tier * 5 + 0.5;
      for (let a = -3; a <= 3; a += 1.5) { T.push({ pos: { x: a, y, z: 3.2 } }); T.push({ pos: { x: a, y, z: -3.2 } }); T.push({ pos: { x: 3.2, y, z: a } }); T.push({ pos: { x: -3.2, y, z: a } }); }
    }
    this.instance(post, this.material('rail'), T, { shadow: false });
  }

  _buildShaft() {
    // neon core strip up the full shaft
    const core = this.mesh(new THREE.CylinderGeometry(0.18, 0.18, 18, 8), 'neon');
    core.position.set(0, 9, 0);
    // signature: the broken glowing lift car (the moving platform) gets a cage
    // — build a static cage frame around the lift's travel as decoration
    const cageMat = this.material('cage', { color: 0x202832, metal: 0.7, rough: 0.4, emissive: 0x00d0ff, emissiveI: 0.4 });
    for (const cx of [-2.6, 2.6]) for (const cz of [-2.6, 2.6]) {
      const p = this.mesh(new THREE.BoxGeometry(0.14, 18, 0.14), cageMat); p.position.set(cx, 9, cz);
    }
    // cables
    for (const cx of [-0.6, 0.6]) { const c = this.mesh(new THREE.CylinderGeometry(0.03, 0.03, 17, 5), 'rail'); c.position.set(cx, 9, 0); }
  }

  _buildSky() {
    this.sky(0x0b1428, 0x05070e, (env, sky) => {
      env.skySpecks(220, 0xbfe0ff, 380, 1.1);       // stars
      // moon glow
      const moon = env.mesh(new THREE.SphereGeometry(9, 20, 16), env.material('moon', { basic: true, color: 0xbfd4ff, transparent: true, opacity: 0.9 }));
      moon.position.set(-160, 120, -240);
    });
  }

  _buildLights() {
    // KEY — cold moonlight through the gutted shell, THE shadow caster.
    this.light('dir', { color: 0xc4d6ff, intensity: 1.6, dir: { x: 0.4, y: -1, z: 0.3 }, shadow: true, shadowSize: 30 });
    // FILL — cold-blue night sky over dark-blue ground; raised hard so every
    // shadowed ring walkway stays clearly readable (was 0.5 → near-black pits).
    this.light('hemi', { sky: 0x3a5c94, ground: 0x141a26, intensity: 1.35 });
    // flat floor under the fill so the darkest tier corners never crush to black.
    this.light('ambient', { color: 0x2a3a56, intensity: 0.55 });

    // PRACTICALS — placed fixtures lighting the actual play space:
    // magenta shaft core (identity light, runs the full shaft height).
    this.light('point', { color: 0xff2ad0, intensity: 2.6, dist: 24, pos: { x: 0, y: 11, z: 0 } });
    this.light('point', { color: 0xff2ad0, intensity: 2.2, dist: 20, pos: { x: 0, y: 4, z: 0 } });
    // cyan tier work-lamps — pushed OUT onto the walkway ring (offset from shaft
    // center) so each throws light across the walkway + chokepoints, not just down
    // the core. Wide dist so one lamp lifts two adjacent tiers; alternating corners.
    this.light('point', { color: 0x4fe0ff, intensity: 2.6, dist: 22, pos: { x: 8, y: 2.5, z: -8 } });    // tiers 0-1
    this.light('point', { color: 0x4fe0ff, intensity: 2.6, dist: 22, pos: { x: -8, y: 9, z: 8 } });      // tiers 1-2
    this.light('point', { color: 0x4fe0ff, intensity: 2.6, dist: 22, pos: { x: 8, y: 15.5, z: 8 } });    // tiers 2-3
    // warm city window-spill raking in through the shell from the moon-lit skyline.
    this.light('point', { color: 0xffcf8a, intensity: 1.6, dist: 22, pos: { x: -11, y: 9, z: -11 } });
  }

  _buildCity() {
    // distant skyscraper silhouettes beyond the shell (instanced, no shadow, cheap)
    const g = new THREE.BoxGeometry(1, 1, 1);
    const mat = this.material('city', { color: 0x0c1220, emissive: 0x1a2c50, emissiveI: 0.5, rough: 1 });
    const T = [];
    for (let i = 0; i < 60; i++) {
      const ang = (i / 60) * Math.PI * 2 + this.constructor._h(i);
      const r = 60 + this.constructor._h(i * 3) * 80;
      const hgt = 20 + this.constructor._h(i * 7) * 90;
      const w = 6 + this.constructor._h(i * 5) * 12;
      T.push({ pos: { x: Math.cos(ang) * r, y: hgt / 2 - 8, z: Math.sin(ang) * r }, scale: { x: w, y: hgt, z: w } });
    }
    this.instance(g, mat, T, { shadow: false, cull: false });
    // windows on city towers: a faint emissive speck field
    this.skySpecks(140, 0xffd88a, 120, 0.9);
  }

  static _h(n) { const s = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return s - Math.floor(s); }
}
