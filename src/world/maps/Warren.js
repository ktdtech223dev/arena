// ARENA map — WARREN
// ============================ MAP DESIGN CONTRACT ============================
// Name / PLACE: "Warren" — a buried military bunker / catacomb, a cramped maze of
//   raw-concrete corridors and rusted-steel bulkheads gnawed out under the earth.
//   The most CLAUSTROPHOBIC place in the set. NOT an open arena.
// ★ PRIMARY SPATIAL SHAPE: DENSE MAZE / INTERIORS. A tight labyrinth of corridors,
//   small corner rooms and doorways wrapped in a RING corridor around one larger
//   central CISTERN chamber. Fully enclosed by the bunker shell. (Causeway=long
//   span, Caldera=open bowl, Spire=tower — this is the interior-maze axis.)
// ★ VERTICALITY: y-2 → 0 → 4, THREE tiers — a LOWER flooded SUMP (y-2, toxic) reached
//   by stairs, the MAIN maze level (y0), and narrow VENT catwalk ducts (y4) crawling
//   over the rooms near the ceiling. Modest climb, real tiering (stairs + vent crawls).
// ★ SIGHTLINE: SHORT, cornered, INTERIOR — room-to-room, doorway peeks and ambush
//   corners only. NO long lanes anywhere (the tightest sightlines in the set); every
//   spawn pair is broken by a wall.
// ★ THEME/PALETTE/LIGHT: dark underground bunker/catacomb. Raw concrete + rusted steel
//   bulkheads + pipes, EMERGENCY RED lighting with a few cold cyan work-lights, damp
//   and oppressive under a tight red fog. (Distinct dark-red interior mood — unlike
//   Caldera's open lava-orange or Causeway's teal storm.)
// SIGNATURE SET-PIECE: the central CISTERN reactor room the corridors feed into, with
//   proximity BLAST DOORS pinching the sections and slow-PULSING red ALARM LAMPS
//   (intensity animated in updateEnv — never toggled .visible → no pipeline hitch).
// BOUNDARY: INTERIOR — the bunker's outer concrete shell (walls + ceiling) fully
//   encloses play; the flooded sump has a shallow TOXIC hazard (low dps) as area
//   denial, not a kill-pit. Beyond the vent grates: dark voids + pipe runs (more
//   structure implied). No falling out.
// FLOW LOOP: run the RING corridor loop between the corner rooms and cistern · OR
//   take the VENT catwalk bypass over the rooms · OR drop the STAIRS into the sump and
//   back. ≥2 routes between every chamber; every room has ≥2 exits (the ring keeps the
//   blast doors from ever hard-locking anyone out).
// SPAWN LOGIC: one spawn per corner room + two on the E/W ring spurs, all facing into
//   cover; interior walls + edge dividers break every spawn-to-spawn sightline.
// PICKUP INTENT: power pickup in the exposed central cistern (most-contested, doors
//   feed it); minor pickups in the corner rooms + down in the risky toxic sump.
// ============================================================================
import * as THREE from 'three';
import { MapEnv } from '../MapEnv.js';

export class Warren extends MapEnv {
  buildEnvironment() {
    this.fog(0x2a1010, 8, 40);            // red fog → claustrophobia (lifted + pushed back for readability)
    this._buildSky();
    this._buildLights();
    this._buildMaterials();
    this._buildStructure();
    this._buildPipes();
    this._buildBulkheads();
    this._buildAlarms();
    this._buildSurroundings();
    this.ambientParticles('dust', 150, { x: 18, y: 4, z: 18 }, { x: 0, y: 2.2, z: 0 }, 0x8a5a4a);
  }

  // ===== MATERIALS =========================================================
  _buildMaterials() {
    // raw poured concrete — stained, form-tie marks, damp streaks
    const conc = this.tex('conc', (g, s) => {
      g.fillStyle = '#3a3330'; g.fillRect(0, 0, s, s);
      for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(${20 + (i * 7) % 26},${18 + (i * 5) % 22},${16 + (i * 3) % 18},0.5)`; g.fillRect((i * 53) % s, (i * 97) % s, 2, 2); }
      g.strokeStyle = 'rgba(12,10,9,0.8)'; g.lineWidth = 2;               // form-panel seams
      for (let i = 0; i <= s; i += 64) { g.beginPath(); g.moveTo(0, i); g.lineTo(s, i); g.stroke(); g.beginPath(); g.moveTo(i, 0); g.lineTo(i, s); g.stroke(); }
      g.fillStyle = 'rgba(10,8,7,0.9)'; for (let i = 0; i < 24; i++) { g.beginPath(); g.arc((i * 71) % s, ((i * 39) % 4) * 64 + 4, 2.4, 0, 7); g.fill(); } // form-tie holes
      g.strokeStyle = 'rgba(60,20,14,0.10)'; g.lineWidth = 3;             // faint rust/damp streaks
      for (let i = 0; i < 10; i++) { const x = (i * 89) % s; g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 12, s); g.stroke(); }
    }, { repeat: [3, 2] });
    this.material('conc', { map: conc, color: 0x39322e, rough: 0.96, metal: 0.04, emissive: 0x1a0604, emissiveI: 0.35 }); // walls/floor, faint red bounce
    this.material('ceil', { map: conc, color: 0x241f1c, rough: 1, metal: 0.02, emissive: 0x120302, emissiveI: 0.3 });     // darker ceiling

    // rusted steel bulkhead — riveted plate
    const rust = this.tex('rust', (g, s) => {
      g.fillStyle = '#4a382a'; g.fillRect(0, 0, s, s);
      for (let i = 0; i < 220; i++) { g.fillStyle = `rgba(${110 + (i * 7) % 80},${52 + (i * 5) % 44},18,0.42)`; g.fillRect((i * 61) % s, (i * 113) % s, 3 + (i % 4), 3 + (i % 3)); }
      g.strokeStyle = 'rgba(18,10,4,0.8)'; g.lineWidth = 3;               // plate edges
      for (let i = 0; i <= s; i += 128) { g.beginPath(); g.moveTo(0, i); g.lineTo(s, i); g.stroke(); }
      g.fillStyle = 'rgba(20,12,6,0.9)'; for (let i = 0; i < 40; i++) { g.beginPath(); g.arc((i * 33) % s + 8, ((i % 2) ? 20 : 140), 3, 0, 7); g.fill(); } // rivets
    }, { repeat: [2, 1] });
    this.material('steel', { map: rust, color: 0x5a4432, rough: 0.62, metal: 0.75, emissive: 0x1c0c04, emissiveI: 0.4 });

    // rusted-grating catwalk / vent duct floor
    this.material('grate', { color: 0x2a2018, rough: 0.7, metal: 0.6, emissive: 0x180a04, emissiveI: 0.45 });
    // damp cistern chamber concrete (a touch bluer / wetter than corridor concrete)
    this.material('cistern', { map: conc, color: 0x2e3234, rough: 0.7, metal: 0.15, emissive: 0x14060a, emissiveI: 0.4 });
    // WALL-RUN accent — shared cyan emissive language (~0x18b6d8)
    this.material('run', { color: 0x1c3a42, rough: 0.5, metal: 0.4, emissive: 0x18b6d8, emissiveI: 0.6 });
    // emissive lamp housings
    this.material('redlamp', { basic: true, color: 0xff2a1e, additive: true });
    this.material('cyanlamp', { basic: true, color: 0x2ce0ff, additive: true });
    this.material('pipe', { color: 0x2a221c, rough: 0.55, metal: 0.7, emissive: 0x100704, emissiveI: 0.4 });
    this.material('sludge', { basic: true, color: 0x3aff2a, additive: true }); // toxic sheen (matches hazard tint)
  }

  // ===== STATIC STRUCTURE (all colliders classified by role) ================
  _buildStructure() {
    for (const s of this.data.solids) {
      const { min: a, max: b } = s;
      const h = b.y - a.y, thin = Math.min(b.x - a.x, b.z - a.z);
      let mat;
      if (s.wallrun) mat = 'run';                                  // wall-run faces → cyan accent
      else if (a.y >= 4.9) mat = 'ceil';                           // shell ceiling cap
      else if (a.y <= -2.3 && h < 1) mat = 'conc';                 // sump floor
      else if (a.y >= 3.5 && h < 1) mat = 'grate';                 // vent catwalk decks
      else if (h <= 0.9 && thin > 3) mat = 'conc';                 // floor slabs
      else if (a.x <= -20 || b.x >= 20 || a.z <= -20 || b.z >= 20) mat = 'steel'; // outer shell walls (bulkhead)
      else if (Math.abs(a.x) < 6.1 && Math.abs(a.z) < 6.1 && Math.abs(b.x) < 6.1 && Math.abs(b.z) < 6.1) mat = 'cistern'; // cistern walls
      else mat = 'conc';                                           // interior maze partitions
      this.solid(a.x, a.y, a.z, b.x, b.y, b.z, mat);
    }
    for (const rp of this.data.ramps) this._ramp(rp);
    this._grating();
    this._runStripes();
  }

  _ramp(rp) {
    const ax = rp.axis;
    const len = ax === 'x' ? rp.max.x - rp.min.x : rp.max.z - rp.min.z;
    const wid = ax === 'x' ? rp.max.z - rp.min.z : rp.max.x - rp.min.x;
    const rise = rp.h1 - rp.h0, ang = Math.atan2(rise, len);
    const g = new THREE.BoxGeometry(ax === 'x' ? Math.hypot(len, rise) : wid, 0.28, ax === 'x' ? wid : Math.hypot(len, rise));
    const m = this.mesh(g, 'grate', { shadow: true });
    m.position.set((rp.min.x + rp.max.x) / 2, (rp.h0 + rp.h1) / 2, (rp.min.z + rp.max.z) / 2);
    if (ax === 'x') m.rotation.z = rp.h0 > rp.h1 ? ang : -ang;
    else m.rotation.x = rp.h0 > rp.h1 ? -ang : ang;
  }

  _grating() {
    // slot lines on the vent catwalk decks (instanced thin dark bars) — reads as duct grating
    const bar = new THREE.BoxGeometry(0.05, 0.02, 1.4);
    const T = [];
    for (const [x0, x1, z] of [[-14, 14, -12.2], [-14, 14, 12.2]]) { for (let x = x0 + 1; x < x1; x += 0.9) T.push({ pos: { x, y: 4.02, z } }); }
    for (const z of [-11, -6, 0, 6, 11]) { T.push({ pos: { x: 12.2, y: 4.02, z }, rot: { x: 0, y: Math.PI / 2, z: 0 } }); T.push({ pos: { x: -12.2, y: 4.02, z }, rot: { x: 0, y: Math.PI / 2, z: 0 } }); }
    this.instance(bar, this.material('steel'), T, { shadow: false });
  }

  _runStripes() {
    // cyan wall-run stripes climbing the flagged {wallrun} faces — the shared movement
    // language. One instanced set (0 extra draw calls beyond the batch).
    const stripe = new THREE.BoxGeometry(0.09, 3.6, 0.5);
    const T = [];
    // cistern corner wall-run faces (near each doorway jamb)
    for (const [x, z, ry] of [
      [-5.7, -3.4, 0], [5.7, -3.4, 0], [-5.7, 3.4, 0], [5.7, 3.4, 0],       // E/W cistern jambs
      [-3.4, -5.7, Math.PI / 2], [3.4, -5.7, Math.PI / 2], [-3.4, 5.7, Math.PI / 2], [3.4, 5.7, Math.PI / 2], // N/S jambs
    ]) T.push({ pos: { x, y: 2.1, z }, rot: { x: 0, y: ry, z: 0 } });
    // ambush-baffle run faces in NW / SW rooms (the flagged baffles)
    T.push({ pos: { x: -11.14, y: 2.1, z: -10.5 }, rot: { x: 0, y: 0, z: 0 } });
    this.instance(stripe, this.material('run'), T, { shadow: false });
  }

  // ===== PIPES + CONDUITS (real architecture, merged) =======================
  _buildPipes() {
    // rusted pipe runs hugging the corridor ceilings — the signature bunker texture.
    // All baked into ONE merged 'pipe' draw call via addGeo (perf).
    const runPipe = (a, b, r) => {
      const dir = new THREE.Vector3().subVectors(b, a); const len = dir.length();
      const g = new THREE.CylinderGeometry(r, r, len, 7);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
      g.applyMatrix4(new THREE.Matrix4().compose(a.clone().addScaledVector(dir, 0.5), q, new THREE.Vector3(1, 1, 1)));
      this.addGeo(g, 'pipe');
    };
    // ceiling pipe lines running the ring corridor (x and z runs just under the ceiling)
    for (const z of [-7.2, 7.2]) { runPipe(new THREE.Vector3(-19, 4.4, z), new THREE.Vector3(19, 4.4, z), 0.16); }
    for (const x of [-7.2, 7.2]) { runPipe(new THREE.Vector3(x, 4.6, -19), new THREE.Vector3(x, 4.6, 19), 0.13); }
    // vertical drops into the cistern (conduit bundles)
    for (const [x, z] of [[-5.4, -5.4], [5.4, 5.4], [-5.4, 5.4]]) runPipe(new THREE.Vector3(x, 0, z), new THREE.Vector3(x, 4.6, z), 0.11);
    // thinner conduits crossing the corner rooms
    for (const [x0, x1, z, y] of [[-14, -8.5, -12.5, 4.5], [8.5, 14, -12.5, 4.5], [-14, -8.5, 12.5, 4.5], [8.5, 14, 12.5, 4.5]])
      runPipe(new THREE.Vector3(x0, y, z), new THREE.Vector3(x1, y, z), 0.09);
    // a fat main trunk pipe crossing the cistern high up (signature silhouette)
    runPipe(new THREE.Vector3(-6, 4.3, -3), new THREE.Vector3(6, 4.3, 3), 0.24);
  }

  // ===== BULKHEAD ARCHES + DOOR FRAMES (instanced) ==========================
  _buildBulkheads() {
    // arched bulkhead frames around the cistern doorways — riveted steel rings that
    // sell "reactor room". Instanced torus-arches (one draw call).
    const arch = new THREE.TorusGeometry(1.5, 0.16, 6, 12, Math.PI);
    const T = [];
    // four cistern doorway arches (top of each mid-wall gap)
    for (const [x, z, ry] of [[0, -6, 0], [0, 6, 0], [-6, 0, Math.PI / 2], [6, 0, Math.PI / 2]])
      T.push({ pos: { x, y: 2.4, z }, rot: { x: 0, y: ry, z: 0 } });
    this.instance(arch, this.material('steel'), T, { shadow: false });
    // door-frame jamb posts on the ring-spur mouths (thick riveted uprights)
    const post = new THREE.BoxGeometry(0.3, 4.6, 0.3);
    const P = [];
    for (const [x, z] of [[-3, -8.5], [3, -8.5], [-3, 8.5], [3, 8.5], [-8.5, -3], [-8.5, 3], [8.5, -3], [8.5, 3]])
      P.push({ pos: { x, y: 2.3, z } });
    this.instance(post, this.material('steel'), P, { shadow: false });
    // a heavy console block in the cistern center (reactor core stub — signature)
    const core = this.mesh(new THREE.CylinderGeometry(0.9, 1.1, 1.4, 12), 'steel', { shadow: true });
    core.position.set(0, 0.7, 0);
    const coreGlow = this.mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.3, 12), 'cyanlamp'); coreGlow.position.set(0, 1.55, 0);
  }

  // ===== ALARMS + WORK-LIGHTS (≤5 lights, ≤1 shadow) ========================
  _buildAlarms() {
    // Emissive alarm lamp housings (instanced, cheap) placed high in each chamber; the
    // few REAL lights below do the lighting. Red alarms PULSE (intensity in updateEnv).
    const dome = new THREE.SphereGeometry(0.18, 8, 6);
    const R = [];
    for (const [x, z] of [[0, -6], [0, 6], [-6, 0], [6, 0], [-12.5, -12.5], [12.5, -12.5], [-12.5, 12.5], [12.5, 12.5], [0, 0]])
      R.push({ pos: { x, y: 4.2, z } });
    this._alarmDomes = this.instance(dome, this.material('redlamp'), R, { shadow: false });
    // cold cyan work-lights (caged) on a couple of corridor walls
    const cage = new THREE.SphereGeometry(0.13, 6, 5);
    const C = [];
    for (const [x, z] of [[-7.2, -7.2], [7.2, 7.2], [0, -12], [0, 12]]) C.push({ pos: { x, y: 3.8, z } });
    this.instance(cage, this.material('cyanlamp'), C, { shadow: false });

    // ===== REAL LIGHTING RIG =================================================
    // Buried bunker: NO sun. Readability comes from a strong FILL floor + a practical
    // in EVERY room, corridor spur, the cistern and the sump so no corner is black —
    // while the RED emergency practicals keep the oppressive mood and the emissive
    // neon stays as accent on top. Only the 1 directional casts a shadow (perf).

    // -- KEY (the ONLY shadow caster): a cold, dim shaft of night seeping down a vent
    //    shaft from directly above — grounds silhouettes/gives ground shadows without
    //    breaking the "sealed underground" fiction. Kept low so red practicals dominate.
    this.light('dir', {
      color: 0x8faec4, intensity: 0.55, dir: { x: 0.12, y: 1, z: 0.08 },
      shadow: true, shadowSize: 26,
    });

    // -- FILL (the single biggest readability lever): a lifted red/black hemisphere so
    //    every shadowed pocket is clearly visible, plus a faint flat ambient to erase
    //    near-black pits in the maze corners. Warm-red from above keeps the palette.
    this.light('hemi', { sky: 0x6a2a22, ground: 0x241012, intensity: 1.05 });   // was 0.35 → readable
    this.light('ambient', { color: 0x3a1c1a, intensity: 0.55 });                // flat floor, no black corners

    // -- PRACTICAL PLACED LIGHTS — one at every fixture in the play space --------
    // CISTERN (central reactor room): a bright red alarm glow (pulses) + the core's
    // cold cyan work-light so the most-contested room reads crisply.
    this._redA = this.light('point', { color: 0xff2e18, intensity: 2.8, dist: 20, pos: { x: 0, y: 3.8, z: 0 } });   // cistern alarm (pulses)
    this.light('point', { color: 0x2ce0ff, intensity: 1.8, dist: 12, pos: { x: 0, y: 1.9, z: 0 } });                // reactor-core cyan work-light

    // FOUR CORNER ROOMS — a red emergency practical high in each so the maze corners
    // are lit onto the geometry, not just glowing domes. (NE gets the pulsing pair.)
    this.light('point',  { color: 0xff2412, intensity: 2.3, dist: 15, pos: { x: -11.5, y: 3.7, z: -11.5 } });        // NW room
    this._redB = this.light('point', { color: 0xff3016, intensity: 2.3, dist: 15, pos: { x: 11.5, y: 3.7, z: -11.5 } }); // NE room (pulses, offset phase)
    this.light('point',  { color: 0xff2412, intensity: 2.3, dist: 15, pos: { x: 11.5, y: 3.7, z: 11.5 } });          // SE room

    // RING-CORRIDOR SPURS — cold cyan work-lights on the N/S/E/W spur walls so the ring
    // loop and doorway chokepoints stay lit between the red rooms (identity + contrast).
    this.light('point', { color: 0x2ce0ff, intensity: 1.6, dist: 12, pos: { x: -7.2, y: 3.4, z: 0 } });   // W spur (blast-door mouth)
    this.light('point', { color: 0x2ce0ff, intensity: 1.6, dist: 12, pos: { x: 7.2, y: 3.4, z: 0 } });    // E spur (blast-door mouth)
    this.light('point', { color: 0xff5230, intensity: 1.6, dist: 13, pos: { x: 0, y: 3.4, z: -7.2 } });   // N spur (warm-red)
    this.light('point', { color: 0xff5230, intensity: 1.6, dist: 13, pos: { x: 0, y: 3.4, z: 7.2 } });    // S spur (warm-red)

    // FLOODED SUMP (lower tier, y-2, toxic): a lone red emergency lamp above the pit so
    // the darkest, deepest room in the map is still fightable — sickly green sludge below.
    this.light('point', { color: 0xff2a14, intensity: 2.2, dist: 16, pos: { x: -13.3, y: 1.4, z: 16.5 } });
  }

  // ===== SURROUNDINGS + SUMP GLOW + SKY GLIMPSE =============================
  _buildSurroundings() {
    // toxic sump sheen — an additive green sheet just above the sludge hazard (sells the
    // flooded, poisoned lower level; matches the hazard's area-denial read).
    for (const hz of this.data.hazards) {
      const g = new THREE.PlaneGeometry(hz.max.x - hz.min.x, hz.max.z - hz.min.z); g.rotateX(-Math.PI / 2);
      const m = this.mesh(g, 'sludge'); m.position.set((hz.min.x + hz.max.x) / 2, hz.max.y + 0.03, (hz.min.z + hz.max.z) / 2); m.receiveShadow = false;
    }
    // "more structure beyond" — dark pipe voids glimpsed above the vent grates: a few
    // stretched dark quads + pipe stubs sitting just outside the shell ceiling gaps.
    const voidPipe = new THREE.CylinderGeometry(0.14, 0.14, 6, 6);
    const T = [];
    for (const [x, z, ry] of [[-16, -16, 0], [16, -16, Math.PI / 2], [-16, 16, Math.PI / 4], [16, 16, 0], [0, -18, Math.PI / 3]])
      T.push({ pos: { x, y: 5.6, z }, rot: { x: Math.PI / 2, y: ry, z: 0 } });
    this.instance(voidPipe, this.material('pipe'), T, { shadow: false, cull: false });
    // faint distant sump drip specks (green) far below, seen implied through the sump
    this.skySpecks(30, 0x3aff2a, 40, 0.5);
  }

  _buildSky() {
    // barely-visible skybox — near-black with the faintest cold blue seep (a hint of
    // night sky through a distant vent shaft). Kept very dark per the interior mood.
    this.sky(0x05070a, 0x0a0304, (env) => { env.skySpecks(40, 0x223040, 200, 0.7); });
  }

  _buildLights() { /* real lights are placed in _buildAlarms (kept together for budget) */ }

  updateEnv(dt, t) {
    // slow red ALARM PULSE — animate INTENSITY (never .visible, which would recompile
    // the WebGPU pipeline and hitch). Two lamps out of phase for a creeping throb.
    if (this._redA) this._redA.intensity = 1.8 + Math.sin(t * 1.6) * 1.1;
    if (this._redB) this._redB.intensity = 1.3 + Math.sin(t * 1.6 + 2.1) * 0.8;
  }
}
