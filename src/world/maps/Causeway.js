// ARENA map — CAUSEWAY
// ============================ MAP DESIGN CONTRACT ============================
// Name / PLACE: "Causeway" — a storm-lashed sea bridge at dusk, a kilometre of
//   roadway strung between two coasts on rusting suspension towers. NOT an arena.
// ★ PRIMARY SPATIAL SHAPE: long corridor + flanks. One long central roadway deck
//   down the Z axis, LOW flank catwalks either side, arch-pylons crossing it.
//   (Spire=vertical tower; this axis is unique here.)
// ★ VERTICALITY: y0→9, THREE tiers — low flank catwalks (y0), the roadway deck
//   (y3), the pylon-top beams + end perches (y9). Modest tiering; the play is the
//   LENGTH, not the climb (the opposite emphasis to Spire's tower).
// ★ SIGHTLINE: LONG. Sniper lanes run the full span, periodically CHOPPED by the
//   arch-pylons + a central deck gap → peek/relocate rhythm. (Spire = mixed/CQC
//   with one vertical line; this is the long-range map.)
// ★ THEME/PALETTE/LIGHT: stormy dusk over open sea. Wet dark concrete + rusted
//   steel + teal water + warm amber sodium lamps under a heavy overcast; cold
//   blue-grey key, rain. (Spire = dry neon night — distinct mood + palette.)
// SIGNATURE SET-PIECE: the two suspension towers with slung cables + the swaying
//   central FERRY platform bridging the broken mid-deck; lamp-lit arch pylons.
// FLOW LOOP: run the deck end-to-end (ride/skip the ferry gap) · OR drop to a
//   flank catwalk to slip past a lane and ramp back up · OR wall-run a pylon leg /
//   tower to the y9 beams + end perches. ≥2 routes between the ends.
// SPAWN LOGIC: opposite deck ends facing down the span (nearest pylon blocks the
//   clean lane) + two flank spawns facing across. No shared spawn sightline.
// PICKUP INTENT: power pickup mid-span on the exposed ferry line (longest, most
//   watched sightline); minor pickups on the flanks to bait the low route.
// ============================================================================
import * as THREE from 'three';
import { MapEnv } from '../MapEnv.js';

export class Causeway extends MapEnv {
  buildEnvironment() {
    this.fog(0x16262e, 34, 190);
    this._buildSky();
    this._buildLights();
    this._buildMaterials();
    this._buildStructure();
    this._buildCables();
    this._buildLamps();
    this._buildCoast();
    this.ambientParticles('rain', 240, { x: 14, y: 16, z: 40 }, { x: 0, y: 8, z: 0 }, 0xafc9e0);
  }

  _buildMaterials() {
    const wet = this.tex('wet', (g, s) => {
      g.fillStyle = '#20272b'; g.fillRect(0, 0, s, s);
      g.strokeStyle = 'rgba(20,26,30,0.9)'; g.lineWidth = 2;                    // expansion joints
      for (let i = 0; i <= s; i += 64) { g.beginPath(); g.moveTo(0, i); g.lineTo(s, i); g.stroke(); }
      g.fillStyle = 'rgba(120,150,160,0.05)'; for (let i = 0; i < 60; i++) g.fillRect((i * 53) % s, (i * 97) % s, 2, 2);
    }, { repeat: [2, 8] });
    this.material('deck', { map: wet, color: 0x2b3236, rough: 0.55, metal: 0.25 });   // wet concrete
    this.material('catwalk', { color: 0x33291f, rough: 0.7, metal: 0.5, emissive: 0x120b06, emissiveI: 0.5 }); // rusted grating
    const rust = this.tex('rust', (g, s) => {
      g.fillStyle = '#3a2c1e'; g.fillRect(0, 0, s, s);
      for (let i = 0; i < 200; i++) { g.fillStyle = `rgba(${120 + (i * 7) % 90},${60 + (i * 5) % 50},20,0.4)`; g.fillRect((i * 61) % s, (i * 113) % s, 3 + (i % 4), 3 + (i % 3)); }
    }, { repeat: [1, 3] });
    this.material('steel', { map: rust, color: 0x5a4433, rough: 0.6, metal: 0.7, emissive: 0x1a0e04, emissiveI: 0.4 }); // rusted steel pylons
    this.material('run', { color: 0x264452, rough: 0.5, metal: 0.5, emissive: 0x18b6d8, emissiveI: 0.5 });  // wall-run accent (shared cyan language)
    this.material('tower', { map: rust, color: 0x40342a, rough: 0.7, metal: 0.6 });
    this.material('cable', { color: 0x14181a, rough: 0.5, metal: 0.8 });
    this.material('lamp', { basic: true, color: 0xffc266, additive: true });
    this.material('perch', { color: 0x2a3236, rough: 0.6, metal: 0.4, emissive: 0x0e1a1e, emissiveI: 0.5 });
  }

  _buildStructure() {
    for (const s of this.data.solids) {
      const { min: a, max: b } = s;
      const h = b.y - a.y, w = Math.min(b.x - a.x, b.z - a.z);
      let mat;
      if (a.y <= -13) mat = null;                                  // sea-bed catch floor: invisible (under the water)
      else if (s.wallrun && w < 2) mat = 'run';                    // wall-run pylon legs
      else if (s.wallrun) mat = 'tower';                           // wall-run tower end walls
      else if (a.y <= 0 && h <= 1) mat = a.x < -5.7 || a.x > 5.7 ? 'catwalk' : 'deck'; // flanks vs deck
      else if (a.y >= 8.5 && h <= 1) mat = 'perch';                // top perches + pylon beams
      else mat = 'steel';
      if (mat) this.solid(a.x, a.y, a.z, b.x, b.y, b.z, mat);
    }
    for (const rp of this.data.ramps) this._ramp(rp);
    this._railings();
  }

  _ramp(rp) {
    const len = rp.max.z - rp.min.z, wid = rp.max.x - rp.min.x, rise = rp.h1 - rp.h0;
    const ang = Math.atan2(rise, len);
    const g = new THREE.BoxGeometry(wid, 0.28, Math.hypot(len, rise));
    const m = this.mesh(g, 'catwalk', { shadow: true });
    m.position.set((rp.min.x + rp.max.x) / 2, (rp.h0 + rp.h1) / 2, (rp.min.z + rp.max.z) / 2);
    m.rotation.x = rp.h0 > rp.h1 ? -ang : ang;
  }

  _railings() {
    // low guard rails along the catwalk sea-edges (instanced posts) — reads as a walkway
    const post = new THREE.BoxGeometry(0.06, 0.7, 0.06);
    const T = [];
    for (let z = -29; z <= 29; z += 2) { T.push({ pos: { x: -10.4, y: 0.35, z } }); T.push({ pos: { x: 10.4, y: 0.35, z } }); }
    this.instance(post, this.material('steel'), T, { shadow: false });
    // continuous top rail
    const railGeo = new THREE.BoxGeometry(0.08, 0.08, 58);
    for (const x of [-10.4, 10.4]) { const r = this.mesh(railGeo, 'run'); r.position.set(x, 0.72, 0); }
  }

  _buildCables() {
    // suspension cables slung from each tower top down the span (parabolic sag) +
    // vertical hangers. ALL merged into ONE 'cable' draw call (repeated elements —
    // instanced/merged per the perf contract), non-collider. Signature silhouette.
    this.material('cable');
    const segs = 26;
    for (const side of [-5.6, 5.6]) {
      let prev = null;
      for (let i = 0; i <= segs; i++) {
        const z = -30 + (60 * i) / segs;
        const t = i / segs, sag = Math.sin(t * Math.PI);
        const y = 13.5 - sag * 6.5;                          // hangs from ~y13.5 towers, sags to y7
        const p = new THREE.Vector3(side, y, z);
        if (prev) this._segment(prev, p, 0.05);
        prev = p;
        if (i % 3 === 0) this._segment(p, new THREE.Vector3(side, 3.2, z), 0.025); // deck hanger
      }
    }
  }

  // bake a cylinder segment a→b into the merged 'cable' batch (0 extra draw calls)
  _segment(a, b, r) {
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length();
    const g = new THREE.CylinderGeometry(r, r, len, 5);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    const mid = a.clone().addScaledVector(dir, 0.5);
    g.applyMatrix4(new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1)));
    this.addGeo(g, 'cable');
  }

  _buildLamps() {
    // amber sodium lamp heads on the pylon beams — emissive housings PLUS a real amber
    // point at every lamp so the whole deck reads under the overcast, not just glowing
    // strips. Lamps are strung down the span so light pools overlap end-to-end.
    const head = new THREE.SphereGeometry(0.16, 8, 6);
    const T = [];
    for (const z of [-20, -8, 4, 16]) { T.push({ pos: { x: -5.6, y: 8.2, z } }); T.push({ pos: { x: 5.6, y: 8.2, z } }); }
    for (const z of [-30, 30]) { T.push({ pos: { x: 0, y: 8.5, z } }); }
    this.instance(head, this.material('lamp'), T, { shadow: false });
    // Real amber sodium pools down the centre of the deck — one per pylon station, hung
    // just below the beams (y6.5) with dist that overlaps neighbours (~12 apart) so the
    // roadway never falls into a black pit between lamps. Warm 0xffb14a sodium colour.
    for (const z of [-24, -12, 0, 12, 24]) {
      this.light('point', { color: 0xffb14a, intensity: 2.4, dist: 22, pos: { x: 0, y: 6.5, z } });
    }
    // Cooler tower floodlights at the two shore-end towers, throwing across the end
    // decks + perches so the long-lane spawns/perches read from range.
    for (const z of [-30, 30]) {
      this.light('point', { color: 0xcfe0ec, intensity: 2.2, dist: 24, pos: { x: 0, y: 9.5, z } });
    }
  }

  _buildCoast() {
    // distant storm coastlines at both Z ends + scattered sea buoys — the backdrop
    // that sells "bridge between two shores". Instanced dark landmass blocks.
    const g = new THREE.BoxGeometry(1, 1, 1);
    const land = this.material('coast', { color: 0x0c1618, rough: 1, emissive: 0x0a1416, emissiveI: 0.4 });
    const T = [];
    for (let i = 0; i < 40; i++) {
      const end = i < 20 ? -1 : 1;
      const j = i % 20;
      const x = -120 + j * 13 + this.constructor._h(i) * 8;
      const hgt = 8 + this.constructor._h(i * 3) * 34;
      const zc = end * (120 + this.constructor._h(i * 5) * 60);
      T.push({ pos: { x, y: hgt / 2 - 12, z: zc }, scale: { x: 10 + this.constructor._h(i * 7) * 16, y: hgt, z: 14 } });
    }
    this.instance(g, land, T, { shadow: false, cull: false });
    // faint warm shore lights
    this.skySpecks(90, 0xffcf8a, 150, 0.8);
    // a few buoy lights bobbing on the sea (static emissive specks near water)
    const buoy = new THREE.SphereGeometry(0.2, 6, 5);
    const B = [];
    for (let i = 0; i < 10; i++) { const ang = this.constructor._h(i * 9) * Math.PI * 2; const r = 20 + this.constructor._h(i * 4) * 30; B.push({ pos: { x: Math.cos(ang) * r * (this.constructor._h(i) > 0.5 ? 1 : -1), y: -0.6, z: Math.sin(ang) * (30 + i * 6) } }); }
    this.instance(buoy, this.material('buoylight', { basic: true, color: 0xff5a4a, additive: true }), B, { shadow: false });
  }

  _buildSky() {
    // heavy overcast dusk: dark teal-grey top → murky amber horizon, no stars,
    // plus low cloud bands (instanced stretched quads drifting).
    this.sky(0x1b2c33, 0x30302a, (env) => {
      const cloud = new THREE.PlaneGeometry(120, 26);
      const cmat = env.material('cloud', { basic: true, color: 0x243036, transparent: true, opacity: 0.5 });
      const T = [];
      for (let i = 0; i < 14; i++) {
        const ang = env.constructor._h(i) * Math.PI * 2;
        const r = 200 + env.constructor._h(i * 2) * 80;
        T.push({ pos: { x: Math.cos(ang) * r, y: 60 + env.constructor._h(i * 3) * 70, z: Math.sin(ang) * r }, rot: { x: 0, y: -ang + Math.PI / 2, z: 0 }, scale: { x: 1, y: 0.6 + env.constructor._h(i * 5), z: 1 } });
      }
      env._clouds = env.instance(cloud, cmat, T, { shadow: false, cull: false });
    });
  }

  _buildLights() {
    // KEY: cold overcast moonlight, slightly lifted so wet surfaces catch a clear
    // top-light and the shadow caster reads without crushing to black.
    this.light('dir', { color: 0x9fb6c4, intensity: 1.25, dir: { x: 0.3, y: -1, z: -0.5 }, shadow: true, shadowSize: 38 });
    // FILL: the big readability lever. A strong teal sky / cool-ground hemisphere lifts
    // every shadowed corner of the deck and flank catwalks to clearly visible while
    // keeping the storm's cold contrast. Backed by a low flat ambient so the darkest
    // pits (under pylons, ferry gap) never go near-black.
    this.light('hemi', { sky: 0x4a6b78, ground: 0x18282e, intensity: 1.35 });
    this.light('ambient', { color: 0x2a4048, intensity: 0.42 });
  }

  updateEnv(dt, t) {
    // slow cloud drift for storm motion
    if (this._clouds) this._clouds.rotation.y = t * 0.006;
  }

  static _h(n) { const s = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return s - Math.floor(s); }
}
