// ARENA map — HALO
// ============================ MAP DESIGN CONTRACT ============================
// Name / PLACE: "Halo" — an orbital STATION RING slung around a deep reactor VOID,
//   in hard vacuum above a planet. A donut of walkways circling a glowing core-drop;
//   the middle is negative space. NOT an arena, NOT a bowl — a habitat torus in space.
// ★ PRIMARY SPATIAL SHAPE: RING / DONUT around a central VOID. Play circulates AROUND
//   the ring — an OUTER lane + an INNER lane at two radii (base tier) with SPOKE
//   bridges crossing the void between them, and an UPPER gantry ring above. The center
//   is the void + reactor core (open negative space). (Caldera=filled bowl+plug,
//   Helix=figure-8 track, Causeway=long corridor — this donut-around-a-hole is unique.)
// ★ VERTICALITY: y0.6→7, THREE+ tiers — the OUTER ring + INNER ring (base, y0.6), the
//   base SPOKE bridges (y0.6), the UPPER GANTRY ring (y7) with its two void-crossing
//   catwalks, and the rising CORE LIFT that carries you up out of the void. The central
//   void is the vertical negative space (the drop). Read: a floating donut with a hole.
// ★ SIGHTLINE: TANGENTIAL. Sightlines CURVE AWAY around the ring — you rarely see the
//   far side; the core/void hard-blocks every straight-across shot, so you fight AROUND
//   the ring, never through the middle. Only short spoke-crossing peeks reach across.
//   (Distinct from Causeway's long straight lanes + Caldera's radial convex bowl.)
// ★ THEME/PALETTE/LIGHT: orbital SPACE STATION — dark brushed metal + glass, a black
//   STARFIELD sky, MAGENTA + GREEN neon accents, a glowing reactor CORE in the void; a
//   planet + distant station modules beyond the hull windows. Cold clean sci-fi; a cyan
//   key from the core, magenta/green rim. (Space/starfield mood — distinct from every
//   other map: Caldera=volcano red, Causeway=storm teal, Helix=daylight sky.)
// SIGNATURE SET-PIECE: the reactor CORE suspended in the central void — a glowing,
//   PULSING column of light (emissive + intensity animation) — with a rising/falling
//   CORE LIFT platform you ride up out of the void; spoke bridges over the drop; a
//   planet limb + a starfield + distant instanced station modules beyond the windows.
// BOUNDARY: the central VOID (fall in = the void kill-plane + catch floor) and the
//   station OUTER HULL wall with lit windows to space. Not a plain box.
// FLOW LOOP: circulate the OUTER ring OR the INNER ring OR the UPPER gantry; cross the
//   void on the base spokes OR the gantry catwalks; climb via the 4 access ramps or
//   wall-run the corner pylons; ride the core lift up from the void. ≥2 routes between
//   any two points, no dead ends (every ring closes on itself; spokes + ramps + lift
//   interconnect the tiers).
// SPAWN LOGIC: 4 on the OUTER ring at the cardinals + 2 on the INNER ring on the
//   opposite diagonal, each facing TANGENTIALLY along its lane; the core/void blocks
//   any straight cross-ring peek, so no two spawns share a direct sightline.
// PICKUP INTENT: power/barrel on the exposed GANTRY bridge (the high, most-watched
//   crossing over the void); minor barrels on the outer lanes + a spoke mouth to pull
//   rotations across the void.
// ============================================================================
import * as THREE from 'three';
import { MapEnv } from '../MapEnv.js';

const ACCENT = 0x18b6d8;   // shared cyan wall-run language
const MAGENTA = 0xd838c8;  // station neon
const GREEN = 0x38e070;    // station neon
const _q = new THREE.Quaternion();
const _yUp = new THREE.Vector3(0, 1, 0);

export class Halo extends MapEnv {
  buildEnvironment() {
    this.fog(0x070b16, 55, 230);   // deep-space haze pushed back so the lit ring reads clear
    this._buildSky();
    this._buildLights();
    this._buildMaterials();
    this._buildStructure();
    this._buildRingTrim();
    this._buildHullDetail();
    this._buildCore();
    this._buildSurroundings();
    this.ambientParticles('motes', 120, { x: 22, y: 12, z: 22 }, { x: 0, y: 4, z: 0 }, 0x9fd8ff);
  }

  // ===== MATERIALS =========================================================
  _buildMaterials() {
    // brushed-metal deck: dark plating with fine tangential brushing + panel seams
    const brushed = this.tex('brushed', (g, s) => {
      g.fillStyle = '#1a2029'; g.fillRect(0, 0, s, s);
      for (let i = 0; i < 220; i++) { g.strokeStyle = `rgba(${80 + (i * 3) % 40},${95 + (i * 2) % 40},${110 + (i * 5) % 40},0.05)`; g.beginPath(); g.moveTo(0, (i * 7) % s); g.lineTo(s, (i * 7) % s + 2); g.stroke(); }
      g.strokeStyle = 'rgba(8,12,18,0.9)'; g.lineWidth = 3;                       // panel seams
      for (let i = 0; i <= s; i += 64) { g.beginPath(); g.moveTo(0, i); g.lineTo(s, i); g.stroke(); g.beginPath(); g.moveTo(i, 0); g.lineTo(i, s); g.stroke(); }
    }, { repeat: [3, 3] });
    this.material('deck', { map: brushed, color: 0x2a3340, rough: 0.5, metal: 0.7, emissive: 0x0a1420, emissiveI: 0.35 }); // ring decks
    this.material('gantry', { map: brushed, color: 0x222b36, rough: 0.45, metal: 0.75, emissive: 0x1a0a20, emissiveI: 0.35 }); // upper gantry (magenta-tinted)
    // hull: darker panelled steel with a subtle sheen
    const hullTex = this.tex('hull', (g, s) => {
      g.fillStyle = '#12161e'; g.fillRect(0, 0, s, s);
      g.strokeStyle = 'rgba(6,9,14,1)'; g.lineWidth = 4;
      for (let i = 0; i <= s; i += 48) { g.beginPath(); g.moveTo(0, i); g.lineTo(s, i); g.stroke(); }
      for (let i = 0; i <= s; i += 96) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, s); g.stroke(); }
      for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(90,110,130,0.06)`; g.fillRect((i * 61) % s, (i * 113) % s, 3, 3); }
    }, { repeat: [4, 2] });
    this.material('hull', { map: hullTex, color: 0x1a2129, rough: 0.6, metal: 0.65, emissive: 0x060a10, emissiveI: 0.4 });
    this.material('run', { color: 0x203a44, rough: 0.4, metal: 0.6, emissive: ACCENT, emissiveI: 0.6 });   // wall-run accent (shared cyan)
    this.material('strut', { color: 0x161c24, rough: 0.55, metal: 0.7 });                                   // structural struts
    // emissive accent materials (basic/additive glows — no extra lights)
    this.material('cyan', { basic: true, color: ACCENT, additive: true });
    this.material('magenta', { basic: true, color: MAGENTA, additive: true });
    this.material('green', { basic: true, color: GREEN, additive: true });
    this.material('window', { color: 0x1a2634, rough: 0.15, metal: 0.2, emissive: 0x6fd0ff, emissiveI: 0.5, transparent: true, opacity: 0.85 });
    this.material('coreMat', { color: 0x0c1a22, rough: 0.3, metal: 0.4, emissive: ACCENT, emissiveI: 1.4 }); // glowing reactor core
  }

  // ===== STRUCTURE (colliders → merged solids, rings baked as smooth tori) ==
  _buildStructure() {
    // Classify each collider by role and render it. Ring bars are also OVERLAID with a
    // smooth torus (baked, 0 draws) so the square-ring colliders READ as round station
    // rings. We still render the collider boxes (thin, hidden under the torus lip) so
    // the walk surface matches the visible deck exactly.
    for (const s of this.data.solids) {
      const { min: a, max: b } = s;
      const h = b.y - a.y;
      if (a.y <= -40) continue;                                  // catch floor: invisible (deep in the void)
      let mat;
      if (s.wallrun && h >= 5 && (b.x - a.x <= 2 || b.z - a.z <= 2)) mat = 'run';   // wall-run kicker pylons
      else if (s.wallrun) mat = 'hull';                          // outer hull wall (wall-runnable inner face)
      else if (a.y >= 6.3) mat = 'gantry';                       // upper gantry ring + gantry bridges
      else mat = 'deck';                                         // base rings + base spokes
      this.solid(a.x, a.y, a.z, b.x, b.y, b.z, mat);
    }
    // smooth station rings baked as flat tori sitting on the collider deck tops (0 draws)
    this._ringTorus(0.6, 19, 2.0, 'deck');    // outer ring (mid-radius 19, deck ±2)
    this._ringTorus(0.6, 10, 2.0, 'deck');    // inner ring (mid-radius 10, deck ±2)
    this._ringTorus(7.0, 14.5, 1.5, 'gantry');// upper gantry ring (mid-radius 14.5, deck ±1.5)
    for (const rp of this.data.ramps) this._ramp(rp);
  }

  // bake a flat annular ring (torus flattened to a disk band) onto the deck top
  _ringTorus(y, radius, halfWidth, matKey) {
    const g = new THREE.TorusGeometry(radius, halfWidth, 2, 48);
    g.scale(1, 1, 0.14);                                  // flatten the tube into a thin deck band
    g.rotateX(Math.PI / 2);
    g.translate(0, y - 0.02, 0);
    this.addGeo(g, matKey);
  }

  _ramp(rp) {
    const ax = rp.axis;
    const len = ax === 'x' ? rp.max.x - rp.min.x : rp.max.z - rp.min.z;
    const wid = ax === 'x' ? rp.max.z - rp.min.z : rp.max.x - rp.min.x;
    const rise = rp.h1 - rp.h0, ang = Math.atan2(rise, len);
    const g = new THREE.BoxGeometry(ax === 'x' ? Math.hypot(len, rise) : wid, 0.24, ax === 'x' ? wid : Math.hypot(len, rise));
    const m = this.mesh(g, 'gantry', { shadow: true });
    m.position.set((rp.min.x + rp.max.x) / 2, (rp.h0 + rp.h1) / 2, (rp.min.z + rp.max.z) / 2);
    if (ax === 'x') m.rotation.z = rp.h0 > rp.h1 ? ang : -ang;
    else m.rotation.x = rp.h0 > rp.h1 ? -ang : ang;
  }

  // ===== RING TRIM (cyan edge strips + railings, instanced/merged) ==========
  _buildRingTrim() {
    // glowing cyan edge strips ringing the inner+outer decks + magenta on the gantry —
    // baked as thin tori (0 draws). Sells the neon-lane read + the ring silhouette.
    for (const [y, r, key] of [[0.63, 21, 'cyan'], [0.63, 17, 'cyan'], [0.63, 12, 'cyan'], [0.63, 8, 'cyan']]) {
      const g = new THREE.TorusGeometry(r, 0.08, 6, 64); g.rotateX(Math.PI / 2); g.translate(0, y, 0);
      this.addGeo(g, key);
    }
    for (const r of [16, 13]) { const g = new THREE.TorusGeometry(r, 0.07, 6, 64); g.rotateX(Math.PI / 2); g.translate(0, 7.03, 0); this.addGeo(g, 'magenta'); }
    // guard-rail posts (instanced) along the outer ring outer edge + gantry outer edge —
    // one draw each, reads as a walkway with a lip toward the void/hull.
    const post = new THREE.BoxGeometry(0.06, 0.66, 0.06);
    const railT = [], gRailT = [];
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      railT.push({ pos: { x: Math.cos(a) * 20.6, y: 0.93, z: Math.sin(a) * 20.6 } });   // outer edge toward hull
      if (i % 2 === 0) gRailT.push({ pos: { x: Math.cos(a) * 15.7, y: 7.33, z: Math.sin(a) * 15.7 } });
    }
    this.instance(post, this.material('strut'), railT, { shadow: false });
    this.instance(post.clone(), this.material('strut'), gRailT, { shadow: false });

    // GANTRY SUPPORT STRUTS — angled struts from the base outer ring up to the gantry
    // ring (real architecture holding the upper ring aloft). Baked cylinders (0 draws).
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + 0.26;
      const bot = new THREE.Vector3(Math.cos(a) * 18.5, 0.6, Math.sin(a) * 18.5);
      const top = new THREE.Vector3(Math.cos(a) * 14.5, 7, Math.sin(a) * 14.5);
      this._strut(bot, top, 0.16, 'strut');
    }
    // wall-run stripe on the 4 corner kicker pylons (cyan language)
    const stripe = new THREE.BoxGeometry(0.14, 6.2, 0.5);
    const st = [];
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      st.push({ pos: { x: sx * 14, y: 3.8, z: sz * 14 }, rot: { x: 0, y: sx * sz > 0 ? Math.PI / 4 : -Math.PI / 4, z: 0 } });
    }
    this.instance(stripe, this.material('cyan'), st, { shadow: false });
  }

  // bake a cylinder segment a→b into the merged batch (0 extra draw calls)
  _strut(a, b, r, matKey) {
    const dir = new THREE.Vector3().subVectors(b, a), len = dir.length();
    const g = new THREE.CylinderGeometry(r, r, len, 6);
    _q.setFromUnitVectors(_yUp, dir.clone().normalize());
    g.applyMatrix4(new THREE.Matrix4().compose(a.clone().addScaledVector(dir, 0.5), _q, new THREE.Vector3(1, 1, 1)));
    this.addGeo(g, matKey);
  }

  // ===== HULL DETAIL (windows to space + accent lights, instanced) ==========
  _buildHullDetail() {
    // lit window strips set into the 4 hull walls — glass panels to space (instanced).
    const win = new THREE.BoxGeometry(2.4, 2.2, 0.15);
    const wins = [];
    for (let i = 0; i < 9; i++) { const x = -18 + i * 4.5; wins.push({ pos: { x, y: 4.2, z: 20.85 } }); wins.push({ pos: { x, y: 4.2, z: -20.85 } }); }
    const winsSide = [];
    for (let i = 0; i < 9; i++) { const z = -18 + i * 4.5; winsSide.push({ pos: { x: 20.85, y: 4.2, z }, rot: { x: 0, y: Math.PI / 2, z: 0 } }); winsSide.push({ pos: { x: -20.85, y: 4.2, z }, rot: { x: 0, y: Math.PI / 2, z: 0 } }); }
    this.instance(win, this.material('window'), wins.concat(winsSide), { shadow: false });
    // green + magenta accent light bars ringing the hull base (instanced additive quads)
    const bar = new THREE.PlaneGeometry(3, 0.14);
    const barsG = [], barsM = [];
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2, r = 23.2;
      const t = { pos: { x: Math.cos(a) * r, y: 1.2 + (i % 3), z: Math.sin(a) * r }, rot: { x: 0, y: -a + Math.PI / 2, z: 0 } };
      (i % 2 ? barsG : barsM).push(t);
    }
    this.instance(bar, this.material('green'), barsG, { shadow: false, cull: false });
    this.instance(bar.clone(), this.material('magenta'), barsM, { shadow: false, cull: false });
  }

  // ===== SIGNATURE: the reactor CORE in the central void ====================
  _buildCore() {
    // A glowing reactor column suspended DEAD-CENTRE in the void — the pulsing set-piece
    // that HARD-BLOCKS the straight cross-ring sightline. Kept slender (r≈1.6) so the
    // core LIFT (which rides at x6, alongside) never clips it. Standalone meshes (few).
    const shaft = new THREE.CylinderGeometry(1.6, 1.9, 26, 18, 1, true);
    this._core = this.mesh(shaft, 'coreMat', { shadow: false, receive: false });
    this._core.position.set(0, -6, 0);
    // bright inner plasma column (additive, thinner) — the light-source read
    const plasma = new THREE.CylinderGeometry(0.85, 0.85, 30, 14);
    this._plasma = this.mesh(plasma, this.material('coreGlow', { basic: true, color: 0x8fe8ff, additive: true }), { shadow: false, receive: false });
    this._plasma.position.set(0, -4, 0);
    // three cyan containment rings hugging the core (baked tori, 0 draws)
    for (const y of [1.5, 5.5, -2.5]) { const g = new THREE.TorusGeometry(2.1, 0.16, 8, 28); g.rotateX(Math.PI / 2); g.translate(0, y, 0); this.addGeo(g, 'cyan'); }
    // a beacon cap spiking above the ring plane (king-of-hill read over the void)
    this._beacon = this.mesh(new THREE.CylinderGeometry(0.12, 0.5, 1.8, 10), this.material('cyan'), { shadow: false });
    this._beacon.position.set(0, 8.6, 0);
    // REACTOR CORE practical — a strong cyan light in the core spilling onto the inner ring,
    // spoke bridges + underside of the gantry (the signature glow doing real work now).
    this.light('point', { color: 0x8fe4ff, intensity: 3.0, dist: 34, pos: { x: 0, y: 2, z: 0 } });
  }

  // ===== SURROUNDINGS (starfield + planet + distant station modules) ========
  _buildSurroundings() {
    // a planet limb below/beyond the hull — a big emissive sphere partially in view
    const planet = this.mesh(new THREE.SphereGeometry(120, 32, 24), this.material('planet', { color: 0x1b3a6a, rough: 1, metal: 0, emissive: 0x142c55, emissiveI: 0.6 }), { shadow: false, receive: false });
    planet.position.set(-60, -170, 140);
    // a thin atmosphere rim (additive shell)
    const atmo = this.mesh(new THREE.SphereGeometry(126, 24, 18), this.material('atmo', { basic: true, color: 0x3a6fd0, transparent: true, opacity: 0.14, additive: true }), { shadow: false, receive: false });
    atmo.position.copy(planet.position);
    // distant instanced STATION MODULES drifting in the black (backdrop silhouettes)
    const modGeo = new THREE.BoxGeometry(1, 1, 1);
    const modMat = this.material('module', { color: 0x10161e, rough: 0.9, metal: 0.4, emissive: 0x0a1018, emissiveI: 0.5 });
    const mods = [];
    for (let i = 0; i < 26; i++) {
      const a = this.constructor._h(i) * Math.PI * 2;
      const r = 150 + this.constructor._h(i * 2) * 130;
      const y = 20 + (this.constructor._h(i * 3) - 0.5) * 160;
      const sc = 6 + this.constructor._h(i * 5) * 22;
      mods.push({ pos: { x: Math.cos(a) * r, y, z: Math.sin(a) * r }, rot: { x: this.constructor._h(i * 7) * 3, y: a, z: this.constructor._h(i * 9) * 3 }, scale: { x: sc, y: sc * (0.3 + this.constructor._h(i * 4) * 0.5), z: sc * (0.4 + this.constructor._h(i * 6)) } });
    }
    this.instance(modGeo, modMat, mods, { shadow: false, cull: false });
    // tiny running lights on the distant modules (instanced additive specks)
    const spGeo = new THREE.PlaneGeometry(1.4, 1.4);
    const sp = [];
    for (let i = 0; i < 40; i++) { const m = mods[i % mods.length]; sp.push({ pos: { x: m.pos.x * 0.98, y: m.pos.y + 4, z: m.pos.z * 0.98 } }); }
    this.instance(spGeo, this.material('green'), sp.filter((_, k) => k % 2 === 0), { shadow: false, cull: false });
    this.instance(spGeo.clone(), this.material('magenta'), sp.filter((_, k) => k % 2 === 1), { shadow: false, cull: false });
  }

  _buildSky() {
    // deep-space black with a dense starfield + a faint nebula gradient toward the planet
    this.sky(0x02030a, 0x0a0818, (env) => {
      env.skySpecks(320, 0xffffff, 380, 1.0);       // white stars
      env.skySpecks(90, 0x9fd8ff, 340, 1.4);        // cool bright stars
      env.skySpecks(60, 0xffd0a0, 360, 1.2);        // warm stars
    });
  }

  _buildLights() {
    // cold clean sci-fi rig, PROPERLY LIT for readable combat: a cyan-white sun key with
    // shadow, a strong hemisphere/ambient fill so the ring + spokes read against the void
    // (no near-black pits), then PRACTICAL fixtures — the reactor core (in _buildCore) plus
    // magenta/green ring lamps + gantry panel lights — layered ON TOP of the neon accents.
    // KEY — the cyan-white station sun (THE shadow caster).
    this.light('dir', { color: 0xd4e8ff, intensity: 1.6, dir: { x: 0.35, y: -1, z: -0.4 }, shadow: true, shadowSize: 40 });
    // FILL — cool sky above / magenta-ground bounce below, raised so shadowed deck reads.
    this.light('hemi', { sky: 0x4a5f88, ground: 0x241432, intensity: 1.15 });
    // FILL floor — a low cool ambient that lifts the darkest ring corners off black.
    this.light('ambient', { color: 0x3a4a66, intensity: 0.4 });

    // PRACTICAL RING FIXTURES — magenta + green lamps standing on the outer ring deck at the
    // cardinals, throwing real light across the outer/inner lanes + spoke mouths (the play
    // space), not just glowing strips. Placed at r≈18, chest-high, dist covers lane→void.
    const ringFix = [
      { color: MAGENTA, x: 18, z: 0 }, { color: MAGENTA, x: -18, z: 0 },
      { color: GREEN, x: 0, z: 18 }, { color: GREEN, x: 0, z: -18 },
    ];
    for (const f of ringFix) this.light('point', { color: f.color, intensity: 2.2, dist: 22, pos: { x: f.x, y: 3.2, z: f.z } });
    // PRACTICAL GANTRY PANEL — a cool white fixture over the upper gantry ring/catwalk so the
    // high crossing (the most-watched pickup route over the void) is clearly lit from above.
    this.light('point', { color: 0xbfe0ff, intensity: 2.0, dist: 24, pos: { x: 0, y: 9.5, z: 0 } });
    // (reactor-core point light added in _buildCore.)
    // TOTAL = dir + hemi + ambient + 4 ring points + 1 gantry point + 1 core point = 8 lights.
  }

  updateEnv(dt, t) {
    // reactor core PULSE — animate emissive intensity (never toggle .visible on WebGPU).
    if (this._core) this._core.material.emissiveIntensity = 1.1 + Math.sin(t * 1.6) * 0.5;
    if (this._plasma) { const s = 1 + Math.sin(t * 1.6) * 0.08; this._plasma.scale.set(s, 1, s); }
    if (this._beacon) this._beacon.rotation.y = t * 0.8;
  }

  static _h(n) { const s = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return s - Math.floor(s); }
}
