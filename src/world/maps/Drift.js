// ARENA map — DRIFT
// ============================ MAP DESIGN CONTRACT ============================
// Name / PLACE: "Drift" — a constellation of sunlit floating sky-islands adrift at
//   high altitude over a bottomless void, a warm serene-but-deadly archipelago you
//   cross by leaping the open air. NOT an arena, NOT a continuous ground.
// ★ PRIMARY SPATIAL SHAPE: SCATTERED ISLANDS + GAPS. Separate floating platforms —
//   a big central HUB, four corner isles, two flanking mid-isles, two high perches —
//   connected ONLY by gap-jumps, thin arcing bridge-ramps, wall-run pillars and a
//   moving stepping-stone. Fragmented (Spire=tower, Causeway=corridor, Caldera=bowl:
//   this is the only broken-up archipelago).
// ★ VERTICALITY: FOUR discrete island heights — mids/hub (y3), corner isles (y6),
//   high perches (y9), stepping-stones (y3) — with the deep VOID between them. The
//   traversal (jump + wall-run between isles) IS the verticality, not a climb.
// ★ SIGHTLINE: FRAGMENTED + OPEN SKY. You peek ACROSS the gaps to other isles (long
//   open air lines) but each isle is small cover with cover-boulders breaking the
//   clean lanes — lots of exposed air, no enclosed lanes. (Unique vs every other map.)
// ★ THEME/PALETTE/LIGHT: BRIGHT SUNNY high-altitude sky — warm golden sun, deep blue
//   zenith, soft white clouds far below, warm sandstone rock bodies + green grassy
//   tops, cyan wall-run accents. Airy, serene, deadly. (The one bright warm outdoor
//   map — opposite the dark neon/storm/volcano moods.)
// SIGNATURE SET-PIECE: the big central HUB isle; thin arcing bridges + a moving
//   stepping-stone drifting over the hub seam; waterfalls + vines spilling off the
//   island cliff-edges down into the cloud sea.
// BOUNDARY: the VOID (fall = death via the void hazard). Cliff faces edge every
//   isle; a cloud layer + distant unreachable islands form the parallax backdrop.
// FLOW LOOP: hub -> stepping-stone hop -> mid isle -> arc-bridge ramp up to a corner
//   -> ride the flank mover to the next corner OR wall-run a pillar up to a perch ->
//   ramp back down to the hub. Every isle reachable by >=2 routes; no dead ends.
// SPAWN LOGIC: mids/perches/opposite corners, facing inward; cover-boulders + the
//   hub spine + height gaps break every cross-spawn peek. No shared spawn sightline.
// PICKUP INTENT: power pickup on the exposed HUB center (most-watched open isle);
//   minor pickups on the mid isles to pull rotations onto the stepping-stone hops.
// ============================================================================
import * as THREE from 'three';
import { MapEnv } from '../MapEnv.js';

export class Drift extends MapEnv {
  buildEnvironment() {
    this.fog(0xbfe4f2, 60, 320);        // light, bright, distant — airy high altitude
    this._buildSky();
    this._buildLights();
    this._buildMaterials();
    this._buildIslands();               // tops, rock bodies, undersides, edge vines/falls
    this._buildBridges();               // arcing bridge decks over the ramps
    this._buildPillarAccents();         // cyan wall-run stripes on the pillars
    this._buildSurroundings();          // cloud sea + distant floating isles
    this.ambientParticles('motes', 200, { x: 30, y: 20, z: 34 }, { x: 0, y: 8, z: 0 }, 0xfff0b0);
  }

  // ===== MATERIALS ========================================================
  _buildMaterials() {
    const grass = this.tex('grass', (g, s) => {
      g.fillStyle = '#4e8c34'; g.fillRect(0, 0, s, s);
      for (let i = 0; i < 260; i++) {                                   // dappled grass blades
        const v = 60 + (i * 7) % 70;
        g.fillStyle = `rgba(${v},${120 + (i * 5) % 70},${40 + (i * 3) % 30},0.5)`;
        g.fillRect((i * 53) % s, (i * 97) % s, 2, 3 + (i % 3));
      }
      g.fillStyle = 'rgba(220,235,150,0.10)';                           // sun-warm highlight
      for (let i = 0; i < 40; i++) g.fillRect((i * 61) % s, (i * 113) % s, 5, 2);
    }, { repeat: [3, 3] });
    this.material('grass', { map: grass, color: 0x6ba64a, rough: 0.9, metal: 0.02, emissive: 0x1a3010, emissiveI: 0.25 });

    const sand = this.tex('sand', (g, s) => {
      g.fillStyle = '#b98a55'; g.fillRect(0, 0, s, s);
      for (let i = 0; i < 90; i++) {                                    // sandstone strata bands
        g.fillStyle = `rgba(${150 + (i * 3) % 60},${100 + (i * 2) % 40},${60 + (i) % 30},0.5)`;
        g.fillRect(0, (i * 29) % s, s, 3 + (i % 4));
      }
      for (let i = 0; i < 60; i++) { g.fillStyle = 'rgba(90,60,30,0.35)'; g.beginPath(); g.arc((i * 71) % s, (i * 137) % s, 2 + (i % 3), 0, 7); g.fill(); }
    }, { repeat: [2, 2] });
    this.material('rock', { map: sand, color: 0xb08453, rough: 0.95, metal: 0.03, emissive: 0x2a1c0e, emissiveI: 0.22 }); // warm sandstone body
    this.material('rockDark', { map: sand, color: 0x86603a, rough: 1, metal: 0.02 });                                     // shadowed underside
    this.material('run', { color: 0x2c6b78, rough: 0.5, metal: 0.4, emissive: 0x18b6d8, emissiveI: 0.7 });                // wall-run accent (shared cyan)
    this.material('bridge', { color: 0x9a7448, rough: 0.85, metal: 0.05, emissive: 0x241606, emissiveI: 0.3 });           // plank bridge deck
    this.material('vine', { color: 0x3f7a2e, rough: 0.9, metal: 0, emissive: 0x0e2408, emissiveI: 0.4 });                 // hanging vines
    this.material('fall', { basic: true, color: 0xbfe8ff, transparent: true, opacity: 0.5, additive: true });             // waterfall veil
    this.material('cloud', { basic: true, color: 0xffffff, transparent: true, opacity: 0.62 });                           // cloud sea puffs
    this.material('farIsle', { color: 0x8fb6c8, rough: 1, metal: 0, emissive: 0x24485a, emissiveI: 0.3 });                // distant hazy isles
  }

  // ===== ISLANDS ==========================================================
  // classify each collider from the shared DATA and render it, then sculpt a real
  // ROCK UNDERSIDE + edge vines/waterfalls under each grassy TOP slab so the isles
  // read as floating landmasses, not floating cubes.
  _buildIslands() {
    const tops = [];   // remembered grassy tops -> get undersides + edge detail
    for (const s of this.data.solids) {
      const { min: a, max: b } = s;
      const h = b.y - a.y, w = Math.min(b.x - a.x, b.z - a.z);
      if (b.y <= -6) continue;                                 // catch floor: invisible (deep under the clouds)
      if (s.wallrun) { this.solid(a.x, a.y, a.z, b.x, b.y, b.z, 'run'); continue; } // wall-run pillars
      if (h <= 0.7 && w > 3) {                                 // a grassy island TOP slab
        this.solid(a.x, a.y, a.z, b.x, b.y, b.z, 'grass');
        tops.push(s);
      } else if (h <= 0.7) {                                   // small stepping-stone box top
        this.solid(a.x, a.y, a.z, b.x, b.y, b.z, 'grass');
        tops.push(s);
      } else if (b.y >= 8.5 && h < 3) {                        // perch back-walls (tall thin cover)
        this.solid(a.x, a.y, a.z, b.x, b.y, b.z, 'rock');
      } else {                                                 // rock bodies + cover boulders
        this.solid(a.x, a.y, a.z, b.x, b.y, b.z, 'rock');
      }
    }
    this._buildUndersides(tops);
    this._buildEdgeDetail(tops);
  }

  // rock undersides: a tapering cone + a couple of jagged icosahedron chunks baked
  // beneath each top slab (all merged into the 'rockDark' batch — 0 extra draw calls)
  _buildUndersides(tops) {
    for (const s of tops) {
      const cx = (s.min.x + s.max.x) / 2, cz = (s.min.z + s.max.z) / 2;
      const wx = s.max.x - s.min.x, wz = s.max.z - s.min.z;
      const rad = Math.min(wx, wz) * 0.5;
      const isBig = Math.max(wx, wz) > 6;
      const depth = isBig ? 7 : 4.5;
      // main tapering cone (wide at the slab, pointed into the void)
      const cone = new THREE.ConeGeometry(rad * 1.02, depth, isBig ? 9 : 7, 1);
      cone.translate(cx, s.min.y - depth / 2 + 0.1, cz);
      this.addGeo(cone, 'rockDark');
      // a few jagged rock chunks clinging under the rim
      const n = isBig ? 5 : 3;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + this.constructor._h(cx * 3 + i);
        const rr = rad * (0.5 + this.constructor._h(i + cz) * 0.35);
        const chunk = new THREE.IcosahedronGeometry(0.7 + this.constructor._h(i * 3 + cx) * 1.1, 0);
        chunk.translate(cx + Math.cos(a) * rr, s.min.y - 0.6 - this.constructor._h(i * 7) * (depth * 0.4), cz + Math.sin(a) * rr);
        this.addGeo(chunk, 'rockDark');
      }
    }
  }

  // vines hanging off the cliff rims + a couple of waterfalls spilling into the clouds
  _buildEdgeDetail(tops) {
    const vineT = [], fallList = [];
    for (const s of tops) {
      const wx = s.max.x - s.min.x, wz = s.max.z - s.min.z;
      if (Math.max(wx, wz) <= 4) continue;                    // skip tiny stepping-stones
      const isBig = Math.max(wx, wz) > 6;
      // hanging vines: sample points along the four cliff edges
      const per = isBig ? 6 : 3;
      const edges = [
        { fx: s.min.x, fz: s.min.z, dx: wx, dz: 0 },
        { fx: s.min.x, fz: s.max.z, dx: wx, dz: 0 },
        { fx: s.min.x, fz: s.min.z, dx: 0, dz: wz },
        { fx: s.max.x, fz: s.min.z, dx: 0, dz: wz },
      ];
      for (const e of edges) for (let i = 1; i < per; i++) {
        const t = i / per;
        const x = e.fx + e.dx * t, z = e.fz + e.dz * t;
        const len = 1.2 + this.constructor._h(x * 5 + z) * 2.2;
        vineT.push({ pos: { x, y: s.min.y - len / 2, z }, scale: { x: 1, y: len, z: 1 } });
      }
      // one waterfall on the big/tall isles (south edge) spilling into the void
      if (isBig || s.max.y >= 6) {
        const fx = (s.min.x + s.max.x) / 2, fz = s.max.z;
        fallList.push({ x: fx, y: s.min.y, z: fz, drop: 5 + (s.max.y) * 0.6 });
      }
    }
    // vines: one instanced draw of thin drooping quads
    if (vineT.length) {
      const vg = new THREE.PlaneGeometry(0.5, 1);
      this.instance(vg, this.material('vine'), vineT, { shadow: false, cull: true });
    }
    // waterfalls: instanced translucent veils
    if (fallList.length) {
      const fg = new THREE.PlaneGeometry(1.6, 1);
      const T = fallList.map(f => ({ pos: { x: f.x, y: f.y - f.drop / 2, z: f.z + 0.05 }, scale: { x: 1, y: f.drop, z: 1 } }));
      this._falls = this.instance(fg, this.material('fall'), T, { shadow: false, cull: false });
    }
  }

  // ===== ARCING BRIDGES over the ramps ====================================
  // the mid->corner and hub->perch ramps are the collision floor; render a thin
  // arced plank deck riding each ramp so it reads as a bridge, not a bare slope.
  _buildBridges() {
    for (const rp of this.data.ramps) {
      const len = rp.max.z - rp.min.z, wid = rp.max.x - rp.min.x, rise = rp.h1 - rp.h0;
      const ang = Math.atan2(rise, len);
      const g = new THREE.BoxGeometry(wid, 0.22, Math.hypot(len, rise));
      const m = this.mesh(g, 'bridge', { shadow: true });
      m.position.set((rp.min.x + rp.max.x) / 2, (rp.h0 + rp.h1) / 2 + 0.02, (rp.min.z + rp.max.z) / 2);
      m.rotation.x = rp.h0 > rp.h1 ? -ang : ang;
      // slim side rails with cyan glow (instanced along the deck)
      const rail = new THREE.BoxGeometry(0.08, 0.5, Math.hypot(len, rise));
      for (const sx of [-wid / 2 + 0.12, wid / 2 - 0.12]) {
        const r = this.mesh(rail, 'run');
        r.position.set((rp.min.x + rp.max.x) / 2 + sx, (rp.h0 + rp.h1) / 2 + 0.3, (rp.min.z + rp.max.z) / 2);
        r.rotation.x = rp.h0 > rp.h1 ? -ang : ang;
      }
    }
  }

  // ===== WALL-RUN PILLAR accents =========================================
  // cyan energy stripes climbing the wall-run pillars (the shared traversal language)
  _buildPillarAccents() {
    const stripeT = [], capT = [];
    for (const s of this.data.solids) {
      if (!s.wallrun) continue;
      const cx = (s.min.x + s.max.x) / 2, cz = (s.min.z + s.max.z) / 2;
      const y = (s.min.y + s.max.y) / 2, hgt = s.max.y - s.min.y;
      for (const [dx, dz, ry] of [[0.62, 0, 0], [-0.62, 0, 0], [0, 0.62, Math.PI / 2], [0, -0.62, Math.PI / 2]]) {
        stripeT.push({ pos: { x: cx + dx, y, z: cz + dz }, rot: { x: 0, y: ry, z: 0 }, scale: { x: 1, y: hgt / 6.6, z: 1 } });
      }
      capT.push({ pos: { x: cx, y: s.max.y + 0.15, z: cz } });    // glowing cap crystal
    }
    if (stripeT.length) {
      const stripe = new THREE.BoxGeometry(0.1, 6.6, 0.34);
      this.instance(stripe, this.material('run'), stripeT, { shadow: false });
      const cap = new THREE.OctahedronGeometry(0.4, 0);
      this.instance(cap, this.material('runCap', { basic: true, color: 0x9beef6, additive: true }), capT, { shadow: false });
    }
  }

  // ===== SURROUNDINGS: cloud sea + distant isles ==========================
  _buildSurroundings() {
    // a soft CLOUD SEA far below (instanced flattened puffs at varied depth) — the
    // parallax floor of the void, so you feel the altitude when you peer over a cliff.
    const puff = new THREE.SphereGeometry(1, 7, 5);
    const cloudT = [];
    for (let i = 0; i < 120; i++) {
      const a = this.constructor._h(i) * Math.PI * 2;
      const r = 12 + this.constructor._h(i * 2) * 150;
      const y = -18 - this.constructor._h(i * 3) * 24;
      const sc = 6 + this.constructor._h(i * 5) * 18;
      cloudT.push({ pos: { x: Math.cos(a) * r, y, z: Math.sin(a) * r }, scale: { x: sc, y: sc * 0.4, z: sc } });
    }
    this._clouds = this.instance(puff, this.material('cloud'), cloudT, { shadow: false, cull: false });

    // DISTANT floating isles on the horizon (unreachable backdrop, hazy) — sells the
    // archipelago stretching beyond this arena. Instanced boxes + underside cones.
    const farTop = new THREE.BoxGeometry(1, 0.5, 1);
    const farBody = new THREE.ConeGeometry(0.7, 2.2, 6, 1);
    const topT = [], bodyT = [];
    for (let i = 0; i < 22; i++) {
      const a = this.constructor._h(i * 1.7) * Math.PI * 2;
      const r = 150 + this.constructor._h(i * 2.3) * 120;
      const y = -6 + this.constructor._h(i * 3.1) * 60;
      const sc = 8 + this.constructor._h(i * 4.7) * 20;
      const p = { x: Math.cos(a) * r, y, z: Math.sin(a) * r };
      topT.push({ pos: p, scale: { x: sc, y: sc * 0.4, z: sc } });
      bodyT.push({ pos: { x: p.x, y: y - sc * 0.5, z: p.z }, scale: { x: sc, y: sc, z: sc } });
    }
    this.instance(farBody, this.material('farIsle'), bodyT, { shadow: false, cull: false });
    this.instance(farTop, this.material('farIsleTop', { color: 0x7fae6a, rough: 1, emissive: 0x1e3a14, emissiveI: 0.3 }), topT, { shadow: false, cull: false });
  }

  // ===== SKY + LIGHTS =====================================================
  _buildSky() {
    // bright sunny high-altitude sky: deep blue zenith -> warm pale horizon, + a
    // glowing sun disc and a faint high cloud band.
    this.sky(0x2f7fd6, 0xdfeef2, (env, skyMesh) => {
      // sun disc (additive glow) low in the NE
      const sun = new THREE.Mesh(new THREE.CircleGeometry(22, 24), env.material('sun', { basic: true, color: 0xfff2c0, additive: true }));
      sun.position.set(-140, 90, -220); sun.lookAt(0, 20, 0); sun.renderOrder = -1;
      env._geos.push(sun.geometry); env.group.add(sun);
      const halo = new THREE.Mesh(new THREE.CircleGeometry(48, 24), env.material('sunHalo', { basic: true, color: 0xffe08a, transparent: true, opacity: 0.32, additive: true }));
      halo.position.copy(sun.position); halo.lookAt(0, 20, 0); halo.renderOrder = -2;
      env._geos.push(halo.geometry); env.group.add(halo);
      // faint high cloud band ringing the horizon
      const band = new THREE.PlaneGeometry(160, 30);
      const bmat = env.material('skyband', { basic: true, color: 0xffffff, transparent: true, opacity: 0.22 });
      const T = [];
      for (let i = 0; i < 12; i++) {
        const ang = (i / 12) * Math.PI * 2;
        T.push({ pos: { x: Math.cos(ang) * 300, y: 70 + env.constructor._h(i) * 60, z: Math.sin(ang) * 300 }, rot: { x: 0, y: -ang + Math.PI / 2, z: 0 }, scale: { x: 1, y: 0.6 + env.constructor._h(i * 3), z: 1 } });
      }
      env.instance(band, bmat, T, { shadow: false, cull: false });
    });
  }

  _buildLights() {
    // KEY — warm golden high sun; the ONLY shadow caster. Punchy sunlight for a bright day.
    this.light('dir', { color: 0xfff0cc, intensity: 1.9, dir: { x: 0.55, y: -0.85, z: 0.5 }, shadow: true, shadowSize: 46 });
    // FILL — the big readability lift: strong blue-sky wash from above + warm grass/sandstone
    // bounce from below so island UNDERSIDES + shadowed rock faces never fall into black.
    this.light('hemi', { sky: 0xaddcff, ground: 0x7a6a40, intensity: 1.35 });
    // FILL — soft airy ambient so the darkest cliff corners stay clearly visible.
    this.light('ambient', { color: 0xcfe8f4, intensity: 0.55 });

    // PRACTICALS — warm serene accent lamps sitting at the fiction's fixtures: the hub
    // set-piece + the two contested mid isles + the two high perches. Positioned just above
    // each deck to actually pour warm light onto the play space (walkways, spawns, chokes),
    // layered ON TOP of the neon accents. Point lights don't cast shadows here (cheap).
    this.light('point', { color: 0xffd89a, intensity: 2.6, dist: 22, pos: { x: 0, y: 6.5, z: 0 } });   // HUB centrepiece glow (signature isle)
    this.light('point', { color: 0xffcf90, intensity: 2.2, dist: 18, pos: { x: 19, y: 6, z: 0 } });    // E-mid isle warm lamp (spawn + choke)
    this.light('point', { color: 0xffcf90, intensity: 2.2, dist: 18, pos: { x: -19, y: 6, z: 0 } });   // W-mid isle warm lamp (spawn + choke)
    this.light('point', { color: 0xffe0a8, intensity: 2.0, dist: 20, pos: { x: 0, y: 12, z: -26 } });  // N high perch lantern
    this.light('point', { color: 0xffe0a8, intensity: 2.0, dist: 20, pos: { x: 0, y: 12, z: 26 } });   // S high perch lantern
  }

  updateEnv(dt, t) {
    if (this._clouds) this._clouds.rotation.y = t * 0.008;   // slow drifting cloud sea
    if (this._falls) {
      // gentle shimmer of the waterfall veils
      const s = 1 + Math.sin(t * 2) * 0.04;
      this._falls.scale.x = s;
    }
  }

  static _h(n) { const s = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return s - Math.floor(s); }
}
