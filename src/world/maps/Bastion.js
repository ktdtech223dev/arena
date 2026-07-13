// ARENA map — BASTION
// ============================ MAP DESIGN CONTRACT ============================
// Name / PLACE: "Bastion" — a weathered stone-and-timber fortress caught mid-siege
//   under a cold storm sky; a high walled KEEP glaring down on a churned siege field
//   of trenches and craters, split by a shattered curtain wall. NOT a symmetric arena.
// ★ PRIMARY SPATIAL SHAPE: ASYMMETRIC HIGH/LOW SPLIT. The −Z half is a raised, walled
//   KEEP with battlement walkways ringing a courtyard; the +Z half is a LOW siege
//   FIELD cut with trenches BELOW grade. A great curtain WALL with a shattered BREACH
//   + a portcullis GATE divides them. The two halves are shaped nothing alike.
//   (Spire=tower, Causeway=corridor, Caldera=radial bowl — this is the asymmetric one.)
// ★ VERTICALITY: y-2→13, a STEEP split. Low trench/moat floor (y-2, below grade) ·
//   siege field grade (y0) · keep courtyard + breach landing (y3) · east wall ledge
//   (y6) · battlements & curtain-wall top (y10) · keep-tower roof perch (y13). A
//   dramatic high-vs-low gap: the keep towers a full 12 m over the trench floor.
// ★ SIGHTLINE: ASYMMETRIC. The HIGH keep/battlements own long commanding lanes down
//   onto the open field; the LOW field is tight, its trenches corner every advance so
//   attackers leapfrog cover. The wall BREACH is the pinch every route funnels through.
//   (No other map is asymmetric like this — one side sees far, the other must sneak.)
// ★ THEME/PALETTE/LIGHT: overcast SIEGE. Weathered grey-green stone + dark timber +
//   cold iron, hanging banners, torch embers. Heavy grey storm clouds, a dim cold-blue
//   key raking low. Medieval-industrial. Shared CYAN accent (0x18b6d8) marks wall-runs.
//   (Spire=neon night, Causeway=teal storm, Caldera=red volcano — distinct mood.)
// SIGNATURE SET-PIECE: the great curtain WALL with a shattered BREACH + rubble mound,
//   the raised portcullis GATE, a round-turreted keep TOWER with crenellated battlements,
//   and the flooded MOAT/ravine ringing the low side.
// FLOW LOOP: from the field, push the BREACH ramp up onto the keep · OR ride the east
//   earthwork ramp to the wall-top · OR take the west siege LIFT to the battlements ·
//   OR trigger the GATE · OR wall-run the flagged walls. Up top, run the battlement ring
//   to the tower perch, then drop back to the field. ≥2 low→high routes, no dead ends.
// SPAWN LOGIC: keep spawns staggered in the courtyard + on a battlement (tower/parapet
//   break the lanes); field spawns staggered in the open + a below-grade trench, tight
//   and cornered. No two spawns share a straight sightline.
// PICKUP INTENT: power pickup on the exposed breach landing (the contested pinch every
//   route crosses); minor pickups in the keep courtyard + on the field to bait routes.
// ============================================================================
import * as THREE from 'three';
import { MapEnv } from '../MapEnv.js';

export class Bastion extends MapEnv {
  buildEnvironment() {
    this.fog(0x2b3940, 42, 210); // cold storm haze — lifted off near-black + pushed back so the field reads far
    this._buildSky();
    this._buildLights();
    this._buildMaterials();
    this._buildStructure();
    this._buildTower();
    this._buildBattlements();
    this._buildBanners();
    this._buildTorches();
    this._buildMoat();
    this._buildSurroundings();
    this.ambientParticles('embers', 150, { x: 20, y: 12, z: 30 }, { x: 0, y: 5, z: 2 }, 0xff8a3a);
  }

  // ===== MATERIALS ========================================================
  _buildMaterials() {
    // weathered grey-green ashlar stone — the keep + curtain wall
    const stone = this.tex('stone', (g, s) => {
      g.fillStyle = '#3a423e'; g.fillRect(0, 0, s, s);
      g.strokeStyle = 'rgba(20,26,24,0.85)'; g.lineWidth = 3;                    // mortar courses
      for (let y = 0; y <= s; y += 42) {
        g.beginPath(); g.moveTo(0, y); g.lineTo(s, y); g.stroke();
        const off = ((y / 42) % 2) * 42;                                          // running-bond offset
        for (let x = off; x <= s; x += 84) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 42); g.stroke(); }
      }
      for (let i = 0; i < 120; i++) { g.fillStyle = `rgba(${60 + (i * 7) % 40},${70 + (i * 5) % 36},${58 + (i * 3) % 30},0.28)`; g.fillRect((i * 53) % s, (i * 97) % s, 3 + (i % 5), 3 + (i % 4)); } // lichen mottle
    }, { repeat: [3, 2] });
    this.material('stone', { map: stone, color: 0x424a44, rough: 0.92, metal: 0.05 });
    this.material('keep', { map: stone, color: 0x39413c, rough: 0.9, metal: 0.06, emissive: 0x0a1210, emissiveI: 0.35 }); // keep walls (slightly darker)
    this.material('parapet', { map: stone, color: 0x474f48, rough: 0.88, metal: 0.05 }); // crenellations/parapets
    // dark timber — trench walls, cover, palisade
    const timber = this.tex('timber', (g, s) => {
      g.fillStyle = '#2a2018'; g.fillRect(0, 0, s, s);
      for (let i = 0; i < 22; i++) { g.fillStyle = `rgba(${40 + (i * 5) % 26},${30 + (i * 3) % 20},18,0.9)`; g.fillRect(0, (i * 12) % s, s, 5 + (i % 3)); } // planks
      g.strokeStyle = 'rgba(12,8,4,0.8)'; g.lineWidth = 2; for (let i = 0; i < 8; i++) { g.beginPath(); g.moveTo((i * 33) % s, 0); g.lineTo((i * 33) % s, s); g.stroke(); }
    }, { repeat: [2, 1] });
    this.material('timber', { map: timber, color: 0x322619, rough: 0.95, metal: 0.02 });
    // churned mud / earthworks — field grade + trench floors + ramps
    const mud = this.tex('mud', (g, s) => {
      g.fillStyle = '#2c2b24'; g.fillRect(0, 0, s, s);
      for (let i = 0; i < 150; i++) { g.fillStyle = `rgba(${40 + (i * 3) % 24},${38 + (i * 2) % 20},${28},0.5)`; const x = (i * 61) % s, y = (i * 113) % s; g.beginPath(); g.arc(x, y, 4 + (i % 6), 0, 7); g.fill(); }
    }, { repeat: [4, 4] });
    this.material('mud', { map: mud, color: 0x2e2d26, rough: 1, metal: 0 });
    this.material('trench', { map: timber, color: 0x2a2318, rough: 0.96, metal: 0.03, emissive: 0x080604, emissiveI: 0.4 }); // dark trench revetment
    // iron — portcullis, hardware
    this.material('iron', { color: 0x2b2f31, rough: 0.5, metal: 0.75, emissive: 0x0a0f10, emissiveI: 0.3 });
    // wall-run accent — the shared cyan language on runnable faces
    this.material('run', { color: 0x2a3a3e, rough: 0.5, metal: 0.35, emissive: 0x18b6d8, emissiveI: 0.6 });
    // banners (heraldic cloth), torch flame, water
    this.material('banner', { color: 0x3a5a58, rough: 0.85, metal: 0, side: THREE.DoubleSide, emissive: 0x0c2624, emissiveI: 0.5 });
    this.material('flame', { basic: true, color: 0xff9a3a, additive: true });
    this.material('moat', { basic: true, color: 0x1a3438, transparent: true, opacity: 0.72 });
    this.material('cliff', { color: 0x1c2320, rough: 1, metal: 0, emissive: 0x0a120e, emissiveI: 0.3 });
  }

  // ===== STATIC STRUCTURE (classify every collider by role, merged) =======
  _buildStructure() {
    for (const s of this.data.solids) {
      const { min: a, max: b } = s;
      const h = b.y - a.y, w = Math.min(b.x - a.x, b.z - a.z);
      let mat;
      if (a.y <= -18) mat = null;                                    // world catch floor: invisible (under the moat)
      else if (s.wallrun) {
        // runnable faces: thin wall segments get the cyan accent stripe treatment (added
        // separately below); the wall body itself reads as stone/keep so the space is legible.
        mat = 'keep';
      }
      else if (a.y >= 9.5 && a.y < 11 && h <= 1.2) mat = 'parapet';  // battlement walkway tops + parapet lips
      else if (a.y >= 12) mat = 'parapet';                           // tower roof cap
      else if (a.y <= -1.9) mat = 'trench';                          // below-grade trench floors
      else if (a.y <= 0.1 && h <= 1) mat = 'mud';                    // siege field grade + trench lips
      else if (a.y >= 2.3 && a.y < 3.7 && h <= 1) mat = (a.z < 1) ? 'stone' : 'mud'; // keep courtyard(stone) vs breach/landing(mud rubble)
      else if (b.x - a.x <= 2.4 || b.z - a.z <= 2.4) mat = 'timber'; // thin cover blocks / stubs
      else mat = 'stone';                                            // curtain wall + keep body
      if (mat) this.solid(a.x, a.y, a.z, b.x, b.y, b.z, mat);
    }
    for (const rp of this.data.ramps) this._ramp(rp);
    this._runAccents();
  }

  // build a sloped floor slab for a ramp heightfield (matches walk surface)
  _ramp(rp) {
    const ax = rp.axis;
    const len = ax === 'x' ? rp.max.x - rp.min.x : rp.max.z - rp.min.z;
    const wid = ax === 'x' ? rp.max.z - rp.min.z : rp.max.x - rp.min.x;
    const rise = rp.h1 - rp.h0, ang = Math.atan2(rise, len);
    // trench-access ramps read as timber; the rest as packed mud earthworks
    const isTrench = Math.min(rp.h0, rp.h1) < -1;
    const g = new THREE.BoxGeometry(ax === 'x' ? Math.hypot(len, rise) : wid, 0.3, ax === 'x' ? wid : Math.hypot(len, rise));
    const m = this.mesh(g, isTrench ? 'trench' : 'mud', { shadow: true });
    m.position.set((rp.min.x + rp.max.x) / 2, (rp.h0 + rp.h1) / 2, (rp.min.z + rp.max.z) / 2);
    if (ax === 'x') m.rotation.z = rp.h0 > rp.h1 ? ang : -ang;
    else m.rotation.x = rp.h0 > rp.h1 ? -ang : ang;
  }

  // cyan wall-run accent stripes on the vertical runnable faces (the shared language).
  // ONE instanced draw for all stripes — cheap, reads the climb lines clearly.
  _runAccents() {
    const stripe = new THREE.BoxGeometry(0.14, 4.4, 0.5);       // a vertical accent bar
    const T = [];
    // curtain-wall runnable segments — inner (field-facing, z=2.02) vertical stripes
    for (const x of [-16, -12, -8, 9, 12, 15]) T.push({ pos: { x, y: 4.6, z: 2.06 } });
    // gatehouse jamb accents flanking the portcullis
    T.push({ pos: { x: 3.1, y: 4.6, z: 2.06 } }); T.push({ pos: { x: 6.9, y: 4.6, z: 2.06 } });
    // keep side walls (inner faces) — climb lines up to the battlement
    for (const z of [-26, -18, -10]) { T.push({ pos: { x: -15.94, y: 7, z }, rot: { x: 0, y: Math.PI / 2, z: 0 } }); T.push({ pos: { x: 15.94, y: 7, z }, rot: { x: 0, y: Math.PI / 2, z: 0 } }); }
    // field outer walls (inner faces) — climb lines from the field up to y6 ledges/top
    for (const z of [10, 18, 26]) { T.push({ pos: { x: -15.94, y: 3, z }, rot: { x: 0, y: Math.PI / 2, z: 0 }, scale: { x: 1, y: 1.3, z: 1 } }); T.push({ pos: { x: 15.94, y: 3, z }, rot: { x: 0, y: Math.PI / 2, z: 0 }, scale: { x: 1, y: 1.3, z: 1 } }); }
    this.instance(stripe, this.material('run'), T, { shadow: false });
    // wall-run stripes on the keep tower faces (all four sides read climbable)
    const tstripe = new THREE.BoxGeometry(0.14, 8, 0.4);
    const TT = [
      { pos: { x: -10, y: 8, z: -20.9 } }, { pos: { x: -8, y: 8, z: -20.9 } },      // south tower face
      { pos: { x: -13.1, y: 8, z: -24 }, rot: { x: 0, y: Math.PI / 2, z: 0 } },     // west tower face
      { pos: { x: -6.9, y: 8, z: -24 }, rot: { x: 0, y: Math.PI / 2, z: 0 } },      // east tower face
    ];
    this.instance(tstripe, this.material('run'), TT, { shadow: false });
  }

  // ===== KEEP TOWER — round crenellated turret capping the square shaft ====
  _buildTower() {
    // a cylindrical turret drum sitting atop the square tower shaft (real architecture),
    // ringed by crenellations — the highest commanding silhouette.
    const drum = new THREE.CylinderGeometry(3.4, 3.6, 2.2, 16);
    const dm = this.mesh(drum, 'keep', { shadow: true });
    dm.position.set(-10, 14.4, -24);
    // conical slate roof on the turret
    const cone = new THREE.ConeGeometry(3.8, 3.4, 16);
    const cm = this.mesh(cone, this.material('roof', { color: 0x2a3236, rough: 0.7, metal: 0.2, emissive: 0x0a1214, emissiveI: 0.4 }), { shadow: true });
    cm.position.set(-10, 17.2, -24);
    // turret crenellations (instanced merlons round the drum rim)
    const merlon = new THREE.BoxGeometry(0.7, 1, 0.6);
    const M = [];
    for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; M.push({ pos: { x: -10 + Math.cos(a) * 3.5, y: 16, z: -24 + Math.sin(a) * 3.5 }, rot: { x: 0, y: -a, z: 0 } }); }
    this.instance(merlon, this.material('parapet'), M, { shadow: true });
    // a cyan beacon crowning the tower (shared accent, aids orientation)
    const beacon = this.mesh(new THREE.CylinderGeometry(0.12, 0.32, 1.2, 8), this.material('beacon', { basic: true, color: 0x18b6d8, additive: true }));
    beacon.position.set(-10, 19.4, -24);
  }

  // ===== BATTLEMENTS — crenellated merlons along the walkway edges ========
  _buildBattlements() {
    // merlons (upright stone teeth) marching along every battlement + curtain-wall top
    // edge — the defining fortress silhouette. ONE instanced draw for all of them.
    const merlon = new THREE.BoxGeometry(0.8, 1.1, 0.5);
    const T = [];
    // west + east battlement inner edges (facing courtyard) and outer edges
    for (let z = -30; z <= -4; z += 1.8) {
      T.push({ pos: { x: -17.6, y: 10.75, z } }); T.push({ pos: { x: 17.6, y: 10.75, z } });   // outer
      T.push({ pos: { x: -14, y: 10.75, z } }); T.push({ pos: { x: 14, y: 10.75, z } });        // inner
    }
    // rear battlement edge
    for (let x = -17; x <= 17; x += 1.8) T.push({ pos: { x, y: 10.75, z: -32 } });
    // curtain wall-top merlons (both segments) facing the field
    for (let x = -17.5; x <= -5.5; x += 1.8) { T.push({ pos: { x, y: 10.75, z: 2 } }); T.push({ pos: { x, y: 10.75, z: -2 } }); }
    for (let x = 7.5; x <= 17.5; x += 1.8) { T.push({ pos: { x, y: 10.75, z: 2 } }); T.push({ pos: { x, y: 10.75, z: -2 } }); }
    this.instance(merlon, this.material('parapet'), T, { shadow: true });

    // arched machicolation arcade under the curtain-wall top (real arches, non-collider)
    this._buildArches();
  }

  // blind arcade of pointed arches along the curtain wall face — baked into the batch
  _buildArches() {
    const archMat = 'stone';
    for (const seg of [[-18, -5], [7, 18]]) {
      for (let x = seg[0] + 1; x < seg[1]; x += 2) {
        // two legs + a shallow lintel forming an arch recess on the field face (z≈2.3)
        this.addGeo(this._boxGeo(x - 0.1, 3, 2.15, x + 0.1, 8, 2.45), archMat);
        this.addGeo(this._boxGeo(x + 1.4, 3, 2.15, x + 1.6, 8, 2.45), archMat);
        this.addGeo(this._boxGeo(x - 0.1, 7.8, 2.15, x + 1.6, 8.4, 2.45), archMat);
      }
    }
  }

  // ===== HANGING BANNERS — heraldic cloth on the keep walls ===============
  _buildBanners() {
    const cloth = new THREE.PlaneGeometry(1.4, 3.2);
    this._banners = [];
    const spots = [
      { x: -15.7, y: 7, z: -16, ry: Math.PI / 2 }, { x: -15.7, y: 7, z: -24, ry: Math.PI / 2 },
      { x: 15.7, y: 7, z: -16, ry: -Math.PI / 2 }, { x: 15.7, y: 7, z: -24, ry: -Math.PI / 2 },
      { x: -6, y: 7, z: -29.7, ry: 0 }, { x: 6, y: 7, z: -29.7, ry: 0 },
    ];
    const mat = this.material('banner');
    for (const s of spots) {
      const m = this.mesh(cloth.clone(), mat, { shadow: false });
      m.position.set(s.x, s.y, s.z); m.rotation.y = s.ry;
      m.receiveShadow = false;
      this._banners.push(m);
    }
  }

  // ===== TORCHES — emissive flame heads + a couple grounding point lights ==
  _buildTorches() {
    const flame = new THREE.SphereGeometry(0.18, 8, 6);
    const F = [];
    // torches bracket the breach/gate (the busy pinch) + line the courtyard walls
    for (const p of [[-5, 4, 2.2], [7, 4, 2.2], [-10, 5, -3.5], [10, 5, -3.5], [0, 5, -29.5], [-15.6, 4, -8], [15.6, 4, -8]]) F.push({ pos: { x: p[0], y: p[1], z: p[2] } });
    // a few embery torches down in the field/trenches
    for (const p of [[-11, 1.4, 12], [12, 1.4, 22], [0, -0.6, 26]]) F.push({ pos: { x: p[0], y: p[1], z: p[2] } });
    this._torches = this.instance(flame, this.material('flame'), F, { shadow: false });
    // PRACTICAL TORCH LIGHTS — real warm point lights sitting AT the torch/brazier heads
    // so they pool orange light onto the stone of the play space, not just glow. These
    // are cheap (no shadows) and cover the busy pinches + the darkest low ground:
    //   • the contested BREACH / gate (the pinch every route crosses)
    //   • the keep COURTYARD walls (so the high half reads under the moonlight)
    //   • the below-grade FIELD trenches (the near-black corners the fill can't fully lift)
    // Intensities raised ~12× (decay stays 2) so these read as REAL FILL on the stone,
    // not cosmetic ~0.1-at-5m glows. Two extra fills lift the darkest reachable spots the
    // audit called out: the deep keep courtyard centre + the rear keep-wall interior.
    for (const p of [
      { c: 0xffa048, i: 32, d: 24, x: 0, y: 5, z: 2 },       // breach/gate brazier — brightest, contested pinch
      { c: 0xff8a3a, i: 26, d: 20, x: -10, y: 6, z: -3.5 },  // courtyard west wall torch
      { c: 0xff8a3a, i: 26, d: 20, x: 10, y: 6, z: -3.5 },   // courtyard east wall torch
      { c: 0xff9440, i: 26, d: 22, x: 0, y: 3.5, z: -15 },   // deep keep-courtyard centre fill (darkest reachable keep spot)
      { c: 0xff7a30, i: 24, d: 22, x: 0, y: 6, z: -28 },     // rear keep wall brazier — lights the tower base + battlements
      { c: 0xff8a3a, i: 24, d: 20, x: 0, y: 5, z: -24 },     // rear keep-wall interior fill (tower-base gap)
      { c: 0xff7326, i: 24, d: 22, x: -11, y: 2.4, z: 12 },  // field/trench ember — lifts the near low ground
      { c: 0xff7326, i: 24, d: 22, x: 6, y: 0.6, z: 25 },    // deep trench ember — the darkest field corner
    ]) this.light('point', { color: p.c, intensity: p.i, dist: p.d, pos: { x: p.x, y: p.y, z: p.z } });
  }

  // ===== MOAT / RAVINE — flooded ditch ringing the low side ===============
  _buildMoat() {
    // additive water sheen quads over each moat hazard + a stone counterscarp lip so the
    // ravine reads as a real flooded ditch, not a flat kill-plane.
    for (const hz of this.data.hazards) {
      const g = new THREE.PlaneGeometry(hz.max.x - hz.min.x, hz.max.z - hz.min.z); g.rotateX(-Math.PI / 2);
      const m = this.mesh(g, 'moat'); m.position.set((hz.min.x + hz.max.x) / 2, hz.max.y, (hz.min.z + hz.max.z) / 2);
      m.receiveShadow = false;
    }
    // sloped stone counterscarp walls dropping from grade into the moat (baked)
    const wallMat = 'stone';
    // east + west moat inner banks
    this.addGeo(this._boxGeo(17.9, -6, 6, 18.1, 0, 34), wallMat);
    this.addGeo(this._boxGeo(-18.1, -6, 6, -17.9, 0, 34), wallMat);
    this.addGeo(this._boxGeo(-18, -6, 33.9, 18, 6, 34.1), wallMat); // far siege-wall skirt already solid; skirt below
  }

  // ===== SURROUNDINGS — storm cliffs + distant siege camp backdrop ========
  _buildSurroundings() {
    // jagged dark cliffs rising beyond the moat on all sides (the natural boundary that
    // makes the fortress read as perched on a crag). Instanced landmass blocks.
    const rock = new THREE.BoxGeometry(1, 1, 1);
    const T = [];
    for (let i = 0; i < 44; i++) {
      const side = i % 4;                                        // N/E/S/W rings
      const h = Bastion._h(i * 3);
      const dist = 42 + h * 26;
      const along = (Bastion._h(i * 7) - 0.5) * 120;
      let x, z;
      if (side === 0) { x = along; z = -dist - 8; }
      else if (side === 1) { x = dist; z = along; }
      else if (side === 2) { x = along; z = dist + 8; }
      else { x = -dist; z = along; }
      const hgt = 14 + Bastion._h(i * 5) * 40;
      T.push({ pos: { x, y: hgt / 2 - 20, z }, scale: { x: 12 + Bastion._h(i) * 20, y: hgt, z: 12 + Bastion._h(i * 11) * 18 }, rot: { x: 0, y: Bastion._h(i * 13) * 0.6, z: 0 } });
    }
    this.instance(rock, this.material('cliff'), T, { shadow: false, cull: false });
    // distant besiegers' camp: faint warm campfire specks + tent silhouettes on the +Z ridge
    this.skySpecks(70, 0xff9a4a, 150, 1.1);
    const tent = new THREE.ConeGeometry(3, 4, 5);
    const TT = [];
    for (let i = 0; i < 12; i++) { const x = -50 + i * 9 + Bastion._h(i) * 6; TT.push({ pos: { x, y: -2, z: 70 + Bastion._h(i * 3) * 20 }, rot: { x: 0, y: Bastion._h(i * 5) * 6, z: 0 } }); }
    this.instance(tent, this.material('camp', { color: 0x241d16, rough: 1, emissive: 0x120a04, emissiveI: 0.3 }), TT, { shadow: false, cull: false });
  }

  // ===== SKY — heavy overcast storm with drifting cloud bands =============
  _buildSky() {
    // cold grey-green storm sky: dark slate zenith → murky pale-grey horizon, no stars,
    // low bruised cloud bands drifting slowly.
    this.sky(0x222b2e, 0x424843, (env) => {
      const cloud = new THREE.PlaneGeometry(150, 34);
      const cmat = env.material('cloud', { basic: true, color: 0x2c3538, transparent: true, opacity: 0.55 });
      const T = [];
      for (let i = 0; i < 16; i++) {
        const ang = Bastion._h(i) * Math.PI * 2;
        const r = 210 + Bastion._h(i * 2) * 90;
        T.push({ pos: { x: Math.cos(ang) * r, y: 55 + Bastion._h(i * 3) * 80, z: Math.sin(ang) * r }, rot: { x: 0, y: -ang + Math.PI / 2, z: 0 }, scale: { x: 1, y: 0.5 + Bastion._h(i * 5), z: 1 } });
      }
      env._clouds = env.instance(cloud, cmat, T, { shadow: false, cull: false });
    });
  }

  // ===== LIGHTING — cold moonlight KEY + strong cold FILL + warm torches ====
  // Readability rig: one cold directional key (THE shadow caster) rakes long shadows
  // across the field; a strong cold hemisphere + low ambient floor lift the trenches
  // and shadowed keep so nothing goes near-black; warm practical torches (below, in
  // _buildTorches) pool colour on the stone. Neon cyan trim stays as accent on top.
  _buildLights() {
    // cold overcast moonlight key raking low from beyond the keep (long shadows across
    // the field). Brighter + slightly bluer than before so the lit faces really read.
    this.light('dir', { color: 0xaec4d0, intensity: 1.55, dir: { x: 0.35, y: -0.9, z: 0.55 }, shadow: true, shadowSize: 46 });
    // cool hemisphere FILL — the single biggest readability lever. Pale cold-blue storm
    // sky from above, damp grey-green earth bounce from below; raised hard so shadowed
    // battlements + below-grade trenches stay clearly visible.
    this.light('hemi', { sky: 0x6f8a96, ground: 0x2a322e, intensity: 1.55 });
    // flat ambient floor so the very darkest corners (trench undersides, arch recesses,
    // moat banks) never crush to black. Kept cool + low so contrast + mood survive.
    this.light('ambient', { color: 0x39464c, intensity: 0.62 });
  }

  // ===== PER-FRAME =========================================================
  updateEnv(dt, t) {
    if (this._clouds) this._clouds.rotation.y = t * 0.005;        // slow storm drift
    if (this._banners) for (let i = 0; i < this._banners.length; i++) this._banners[i].rotation.z = Math.sin(t * 1.3 + i) * 0.06; // banners sway in the wind
    if (this._torches) this._torches.scale.setScalar(1 + Math.sin(t * 7) * 0.08); // flame flicker
  }

  // ── helpers ──
  _boxGeo(x0, y0, z0, x1, y1, z1) {
    const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    return g;
  }

  static _h(n) { const s = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return s - Math.floor(s); }
}
