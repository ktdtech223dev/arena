// ARENA map — HELIX
// ============================ MAP DESIGN CONTRACT ============================
// Name / PLACE: "Helix" — a bright cyber test-track: a figure-8 racetrack floating
//   in clean daylight high above a soft cloudscape city. NOT an arena — a looping
//   interchange you run continuously.
// ★ PRIMARY SPATIAL SHAPE: FIGURE-8 / DOUBLE LOOP. Two interlocking ring-decks — a
//   LOW loop (west) and a HIGH loop (east) — thread over-and-under each other along
//   a shared center strip, joined at two crossover junctions. A continuous looping
//   track. (No other map in the set is a loop — this axis is unique here.)
// ★ VERTICALITY: y0→7, a weaving OVER-UNDER with THREE effective tiers — the LOW
//   loop deck (y1), the long CLIMBING RAMPS + crossover landings (mid), and the
//   HIGH loop deck (y7). You spiral between them; the play is the weave, not a tower.
// ★ SIGHTLINE: curved/looping MEDIUM range with BLIND corners on every bend and only
//   short cross-lane peeks at the two over/under junctions — almost NO long straight
//   lane. (Opposite of Causeway's full-span sniper lanes.)
// ★ THEME/PALETTE/LIGHT: clean BRIGHT DAYLIGHT cyber test-track — white / light-grey
//   composite decks, cyan-teal glowing lane edges, chrome + glass barriers, clear
//   blue sky with a soft high sun; airy and open. (The bright clean map, opposite
//   the dark ones.)
// SIGNATURE SET-PIECE: the two crossover junctions where the loops thread through
//   each other; continuous glowing cyan lane-edge strips following every curve; a
//   suspended timing GANTRY arch over the center over/under with a hanging clock ring.
// FLOW LOOP: run either loop full-circle · switch loops at the N or S crossover ramp
//   · spiral low↔high on the center on-ramp / east return ramp · wall-run the gantry
//   posts or the far-end glass kickers up to the high deck. ≥4 routes between tiers,
//   no dead ends.
// SPAWN LOGIC: two on each loop (opposite straights, blind bend between them) + one on
//   each crossover landing facing outward along its own loop. No shared sightline —
//   every pair is separated by a curve or an over/under deck.
// PICKUP INTENT: power pickups at the two loop apexes (most exposed, most-watched
//   outer curves); barrels + the frangible timing-gate on the high N straight bait
//   the crossover fights.
// ============================================================================
import * as THREE from 'three';
import { MapEnv } from '../MapEnv.js';

const LO_C = { x: -13, z: 0 }, HI_C = { x: 13, z: 0 }; // loop centers
const INN = 10, OUT = 13.4, RMID = 11.7;                // ring extents + torus mid-radius
const LOY = 1, HIY = 7;                                 // deck top heights

export class Helix extends MapEnv {
  buildEnvironment() {
    this.fog(0xdff2ff, 60, 300);
    this._buildSky();
    this._buildLights();
    this._buildMaterials();
    this._buildDecks();
    this._buildHubs();
    this._buildLoopTori();
    this._buildEdgeStrips();
    this._buildGantry();
    this._buildRamps();
    this._buildBarriers();
    this._buildCloudscape();
    this.ambientParticles('motes', 150, { x: 30, y: 12, z: 20 }, { x: 0, y: 6, z: 0 }, 0x7df9ff);
  }

  // ---- MATERIALS: bright composite / chrome / glass / cyan ----------------
  _buildMaterials() {
    const comp = this.tex('comp', (g, s) => {
      g.fillStyle = '#e9edf1'; g.fillRect(0, 0, s, s);                 // light composite base
      g.strokeStyle = 'rgba(150,165,178,0.55)'; g.lineWidth = 2;       // panel seams
      for (let i = 0; i <= s; i += 64) { g.beginPath(); g.moveTo(0, i); g.lineTo(s, i); g.stroke(); g.beginPath(); g.moveTo(i, 0); g.lineTo(i, s); g.stroke(); }
      g.fillStyle = 'rgba(120,140,155,0.12)'; for (let i = 0; i < 80; i++) g.fillRect((i * 53) % s, (i * 97) % s, 2, 2);
      g.strokeStyle = 'rgba(24,182,216,0.20)'; g.lineWidth = 6;        // faint cyan lane centerline
      g.beginPath(); g.moveTo(s / 2, 0); g.lineTo(s / 2, s); g.stroke();
    }, { repeat: [3, 3] });
    this.material('deck', { map: comp, color: 0xdfe6ec, rough: 0.5, metal: 0.2 });        // low loop deck
    this.material('deckHi', { map: comp, color: 0xeef3f7, rough: 0.45, metal: 0.25 });    // high loop deck (brighter)
    this.material('chrome', { color: 0xb9c6d0, rough: 0.25, metal: 0.9, emissive: 0x0b1418, emissiveI: 0.3 });
    this.material('cyan', { color: 0x0e2c34, rough: 0.4, metal: 0.5, emissive: 0x18b6d8, emissiveI: 1.15 });   // wall-run + lane accent
    this.material('cyanGlow', { basic: true, color: 0x2fd8ff, additive: true });           // pure emissive edge strips
    this.material('glass', { color: 0x9fd8e8, rough: 0.08, metal: 0.2, transparent: true, opacity: 0.24, side: THREE.DoubleSide });
    this.material('ramp', { map: comp, color: 0xd6dee6, rough: 0.5, metal: 0.3, emissive: 0x0a1c22, emissiveI: 0.4 });
    this.material('gantry', { color: 0x8fa0ac, rough: 0.3, metal: 0.8, emissive: 0x0a1418, emissiveI: 0.3 });
  }

  // ---- DECK COLLIDERS rendered to match collision truth -------------------
  _buildDecks() {
    for (const s of this.data.solids) {
      const { min: a, max: b } = s;
      const h = b.y - a.y, w = Math.min(b.x - a.x, b.z - a.z);
      let mat;
      if (a.y <= -44) continue;                        // catch floor: invisible (far below the clouds)
      else if (this._isHub(s)) continue;                // hub drums drawn as smooth cylinders in _buildHubs
      else if (s.wallrun) mat = 'cyan';                 // gantry posts + glass kickers = cyan wall-run
      else if (Math.abs(b.y - HIY) < 0.3 && h <= 1) mat = 'deckHi'; // high loop decks/landings
      else if (Math.abs(b.y - LOY) < 0.3 && h <= 1) mat = 'deck';   // low loop decks/landings
      else mat = 'chrome';
      this.solid(a.x, a.y, a.z, b.x, b.y, b.z, mat);
    }
  }

  // a solid is a central hub drum if it's the tall wide box straddling a loop center
  _isHub(s) {
    const cx = (s.min.x + s.max.x) / 2, wx = s.max.x - s.min.x, hy = s.max.y - s.min.y;
    return wx > 8 && wx < 16 && hy > 3 && (Math.abs(cx - LO_C.x) < 0.6 || Math.abs(cx - HI_C.x) < 0.6);
  }

  // ---- central STRUCTURAL HUB drums drawn as smooth chrome cylinders --------
  _buildHubs() {
    for (const s of this.data.solids) {
      if (!this._isHub(s)) continue;
      const cx = (s.min.x + s.max.x) / 2, cz = (s.min.z + s.max.z) / 2;
      const rTop = (s.max.z - s.min.z) / 2, rBot = rTop * 1.15;
      const hgt = s.max.y - s.min.y;
      // chrome drum (standalone signature piece)
      const drum = this.mesh(new THREE.CylinderGeometry(rTop, rBot, hgt, 20), 'chrome', { shadow: true });
      drum.position.set(cx, (s.min.y + s.max.y) / 2, cz);
      // stacked cyan accent bands baked into the merged batch (0 extra draws)
      for (const fy of [0.25, 0.55, 0.85]) {
        const band = new THREE.CylinderGeometry(rTop + 0.06, rTop + 0.06, 0.18, 20, 1, true);
        band.translate(cx, s.min.y + hgt * fy, cz);
        this.addGeo(band, 'cyan');
      }
    }
  }

  // ---- SMOOTH LOOP TORI overlaid on the square rings so they READ as loops -
  _buildLoopTori() {
    // A thin flat torus ring hugging each loop deck's outer curve (visual only, baked
    // into the merged batch → 0 extra draws). Sold as the smooth track curve the
    // AABB square-ring only approximates.
    for (const [C, y, mat] of [[LO_C, LOY, 'deck'], [HI_C, HIY, 'deckHi']]) {
      const g = new THREE.TorusGeometry(RMID, 1.7, 8, 40);
      g.scale(1, 1, 0.12);                              // flatten to a low kerb ring
      const m = new THREE.Matrix4().makeRotationX(Math.PI / 2);
      m.setPosition(C.x, y - 0.02, C.z);
      g.applyMatrix4(m);
      this.addGeo(g, mat);
      // inner chrome guide-rail torus, thin
      const gi = new THREE.TorusGeometry(INN - 0.15, 0.12, 6, 40);
      gi.rotateX(Math.PI / 2); gi.translate(C.x, y + 0.55, C.z);
      this.addGeo(gi, 'chrome');
    }
  }

  // ---- CONTINUOUS GLOWING CYAN LANE-EDGE STRIPS following every curve ------
  _buildEdgeStrips() {
    // instanced short cyan bars stepped around both loops (inner + outer edge) → ONE
    // draw call for the whole glowing figure-8 lane trim. The shared cyan language.
    const bar = new THREE.BoxGeometry(0.9, 0.1, 0.28);
    const T = [];
    const N = 40;
    for (const [C, y] of [[LO_C, LOY], [HI_C, HIY]]) {
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2;
        for (const r of [OUT - 0.35, INN + 0.35]) {
          T.push({ pos: { x: C.x + Math.cos(a) * r, y: y + 0.06, z: C.z + Math.sin(a) * r }, rot: { x: 0, y: -a, z: 0 } });
        }
      }
    }
    this.instance(bar, this.material('cyanGlow'), T, { shadow: false, cull: false });
  }

  // ---- SIGNATURE: suspended TIMING GANTRY over the center over/under -------
  _buildGantry() {
    // A chrome arch straddling the shared center strip with a hanging cyan clock-ring
    // — marks the two crossover junctions. Posts are the wall-run colliders; the arch
    // + ring are non-collider signature meshes.
    for (const zc of [7, -7]) {
      // arch beam (torus half) spanning the center, baked
      const g = new THREE.TorusGeometry(3.4, 0.22, 8, 24, Math.PI);
      const m = new THREE.Matrix4().makeRotationZ(0);
      m.setPosition(0, 7.2, zc);
      g.applyMatrix4(m);
      this.addGeo(g, 'gantry');
    }
    // hanging cyan timing clock-rings (signature meshes, 2 standalone)
    for (const zc of [7, -7]) {
      const ring = this.mesh(new THREE.TorusGeometry(1.15, 0.09, 8, 30), 'cyan', { shadow: false });
      ring.position.set(0, 8.6, zc);
      ring.rotation.x = Math.PI / 2;
    }
    // cross-beam banners between the two gantries (instanced thin chrome struts)
    const strut = new THREE.BoxGeometry(0.12, 0.12, 14);
    this.instance(strut, this.material('gantry'), [
      { pos: { x: -3.2, y: 9.4, z: 0 } }, { pos: { x: 3.2, y: 9.4, z: 0 } },
    ], { shadow: false });
  }

  // ---- CLIMBING RAMPS rendered as angled planes matching the heightfields --
  _buildRamps() {
    for (const rp of this.data.ramps) {
      const wid = rp.max.x - rp.min.x, len = rp.max.z - rp.min.z;
      const rise = rp.h1 - rp.h0;
      if (rp.axis === 'x') {
        const run = rp.max.x - rp.min.x, ang = Math.atan2(rise, run);
        const g = new THREE.BoxGeometry(Math.hypot(run, rise), 0.22, len);
        const mm = this.mesh(g, 'ramp', { shadow: true });
        mm.position.set((rp.min.x + rp.max.x) / 2, (rp.h0 + rp.h1) / 2, (rp.min.z + rp.max.z) / 2);
        mm.rotation.z = -ang;
      } else {
        const run = rp.max.z - rp.min.z, ang = Math.atan2(rise, run);
        const g = new THREE.BoxGeometry(wid, 0.22, Math.hypot(run, rise));
        const mm = this.mesh(g, 'ramp', { shadow: true });
        mm.position.set((rp.min.x + rp.max.x) / 2, (rp.h0 + rp.h1) / 2, (rp.min.z + rp.max.z) / 2);
        mm.rotation.x = rp.h0 > rp.h1 ? -ang : ang;
      }
    }
  }

  // ---- BOUNDARY: low glass barriers edging the drop (designed, not a wall) --
  _buildBarriers() {
    // instanced glass panel posts + a continuous glass lip around both loops' OUTER
    // edge — the see-through barrier that sells "elevated track over open sky".
    const post = new THREE.BoxGeometry(0.08, 0.9, 0.08);
    const glass = new THREE.PlaneGeometry(2.05, 0.8);
    const P = [], G = [];
    const N = 34;
    for (const [C, y] of [[LO_C, LOY], [HI_C, HIY]]) {
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2;
        const r = OUT + 0.05;
        const x = C.x + Math.cos(a) * r, z = C.z + Math.sin(a) * r;
        P.push({ pos: { x, y: y + 0.45, z } });
        G.push({ pos: { x, y: y + 0.5, z }, rot: { x: 0, y: -a + Math.PI / 2, z: 0 } });
      }
    }
    this.instance(post, this.material('chrome'), P, { shadow: false, cull: false });
    this.instance(glass, this.material('glass'), G, { shadow: false, cull: false });
  }

  // ---- SKYBOX: clear bright daylight sky ----------------------------------
  _buildSky() {
    this.sky(0x3f86d6, 0xcfe6f4, (env) => {
      // soft high sun disc
      const sun = new THREE.Mesh(
        new THREE.CircleGeometry(14, 32),
        env.material('sun', { basic: true, color: 0xfff6dc, additive: true })
      );
      sun.position.set(70, 150, -180); sun.lookAt(0, 0, 0);
      env.group.add(sun); env._geos.push(sun.geometry);
      // faint high haze bands (instanced stretched quads) — airy cloud sheen up top
      const band = new THREE.PlaneGeometry(160, 30);
      const bmat = env.material('hiband', { basic: true, color: 0xf2f8ff, transparent: true, opacity: 0.3 });
      const T = [];
      for (let i = 0; i < 10; i++) {
        const ang = env.constructor._h(i) * Math.PI * 2;
        const r = 260 + env.constructor._h(i * 2) * 60;
        T.push({ pos: { x: Math.cos(ang) * r, y: 90 + env.constructor._h(i * 3) * 80, z: Math.sin(ang) * r }, rot: { x: 0, y: -ang + Math.PI / 2, z: 0 }, scale: { x: 1, y: 0.5 + env.constructor._h(i * 5) * 0.8, z: 1 } });
      }
      env._hiband = env.instance(band, bmat, T, { shadow: false, cull: false });
    });
  }

  // ---- SURROUNDINGS: a soft cloudscape + hint of a clean city far below ----
  _buildCloudscape() {
    // billowing cloud slabs drifting far under the track (instanced) — the floor of
    // the sky world; the void drops into this.
    const cloud = new THREE.PlaneGeometry(26, 26);
    cloud.rotateX(-Math.PI / 2);
    const cmat = this.material('cloud', { basic: true, color: 0xffffff, transparent: true, opacity: 0.55 });
    const T = [];
    for (let i = 0; i < 46; i++) {
      const ang = this.constructor._h(i) * Math.PI * 2;
      const r = 20 + this.constructor._h(i * 2) * 130;
      const sc = 1 + this.constructor._h(i * 4) * 2.4;
      T.push({ pos: { x: Math.cos(ang) * r, y: -18 - this.constructor._h(i * 3) * 16, z: Math.sin(ang) * r }, scale: { x: sc, y: 1, z: sc } });
    }
    this._clouds = this.instance(cloud, cmat, T, { shadow: false, cull: false });
    // distant clean-city glints far below (tiny emissive specks) — a city under cloud
    this.skySpecks(80, 0xbfe6ff, 180, 1.0);
    // a few chrome pylon-spires rising from the cloud floor around the track (instanced backdrop)
    const spire = new THREE.CylinderGeometry(0.6, 1.2, 30, 8);
    const S = [];
    for (let i = 0; i < 12; i++) {
      const ang = this.constructor._h(i * 5) * Math.PI * 2;
      const r = 55 + this.constructor._h(i * 7) * 40;
      S.push({ pos: { x: Math.cos(ang) * r, y: -20, z: Math.sin(ang) * r }, scale: { x: 1, y: 0.6 + this.constructor._h(i) * 1.4, z: 1 } });
    }
    this.instance(spire, this.material('spire', { color: 0xafc0cc, rough: 0.35, metal: 0.75 }), S, { shadow: false, cull: false });
  }

  // ---- PER-MAP LIGHTING: bright airy daylight (9 lights, 1 shadow dir) ------
  // A proper DAYLIGHT rig: strong warm sun KEY + high sky FILL so no deck corner
  // goes dark, plus cyan track-edge PRACTICALS at both loops + the crossovers so
  // the neon reads as real light spilling onto the play surface (not just glow strips).
  _buildLights() {
    // KEY: strong warm high sun, THE shadow caster. Softened bias/contrast so the
    // bright decks keep crisp-but-not-crushed shadows.
    this.light('dir', { color: 0xfff2d8, intensity: 1.75, dir: { x: -0.35, y: -1, z: 0.4 }, shadow: true, shadowSize: 46 });
    // FILL (most important): high blue-sky hemisphere bounce + airy ambient so the
    // darkest shadowed corner of any deck stays clearly readable.
    this.light('hemi', { sky: 0xcfe8fb, ground: 0x9fb6c6, intensity: 1.35 });
    this.light('ambient', { color: 0xe6f2ff, intensity: 0.6 });
    // PRACTICALS — cyan track-edge accents at each LOOP APEX (outer curve, the most
    // exposed play space) lighting the actual deck, + the two crossover junctions.
    // Loop centers: LO_C x=-13 y=1, HI_C x=13 y=7; apex offset along ±z outer curve.
    this.light('point', { color: 0x2fd8ff, intensity: 2.2, dist: 20, pos: { x: LO_C.x, y: LOY + 3.5, z: 12 } });   // low loop N apex
    this.light('point', { color: 0x2fd8ff, intensity: 2.2, dist: 20, pos: { x: LO_C.x, y: LOY + 3.5, z: -12 } });  // low loop S apex
    this.light('point', { color: 0x2fd8ff, intensity: 2.2, dist: 20, pos: { x: HI_C.x, y: HIY + 3.5, z: 12 } });   // high loop N apex
    this.light('point', { color: 0x2fd8ff, intensity: 2.2, dist: 20, pos: { x: HI_C.x, y: HIY + 3.5, z: -12 } });  // high loop S apex
    // one warm-white crossover practical lighting the shared center over/under strip
    this.light('point', { color: 0xdff2ff, intensity: 2.0, dist: 18, pos: { x: 0, y: 5, z: 0 } });
  }

  updateEnv(dt, t) {
    if (this._clouds) this._clouds.rotation.y = t * 0.004;   // slow drift of the cloud floor
    if (this._hiband) this._hiband.rotation.y = -t * 0.003;  // high haze counter-drift
  }

  static _h(n) { const s = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return s - Math.floor(s); }
}
