// world/Arena.js — Arena: the CODE-BUILT multiplayer proving-grounds VISUALS.
// (ARENA-ARCHITECTURE.md §3 / §8.)
//
// The authoritative COLLISION lives in shared/constants.js — this module reads
// ARENA_COLLIDERS / ARENA_RAMPS / ARENA_SPAWNS / ARENA_WORLD and builds a solid,
// visible mesh for EVERY collider box + ramp wedge so visuals and colliders agree
// byte-for-byte with the server. Wall-run walls (wallrun:true) get a distinct tint
// plus a pulsing glowing edge accent so players read them instantly.
//
// Everything is built into ONE THREE.Group (this.group) added to ctx.scene, plus
// scene lighting, subtle fog, and a gradient sky sphere. Non-colliding decoration
// (floor grid texture, accent strips, spawn pads) is added freely; NO extra solid
// walls the server won't collide, NO invented collider geometry.
//
// Conventions: +Y up, floor top y=0. All custom shading is TSL node materials
// (never raw GLSL) so it runs on both WebGPU and the WebGL2 fallback.
import * as THREE from 'three/webgpu';
import { float, sin, time, uniform, vec3 } from 'three/tsl';
import {
  ARENA_COLLIDERS, ARENA_RAMPS, ARENA_SPAWNS, ARENA_WORLD,
} from '../../shared/constants.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// deterministic rng for texture noise (mulberry32)
function mulberry(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCanvas(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  return c;
}

function canvasTex(w, h, draw, { repeat = true } = {}) {
  const t = new THREE.CanvasTexture(makeCanvas(w, h, draw));
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Box-projected world-space UVs so a texture tiles at constant density on every
// face of a merged box regardless of box size.
function projectUVs(geom, s) {
  const pos = geom.attributes.position;
  const nor = geom.attributes.normal;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i), py = pos.getY(i), pz = pos.getZ(i);
    const ax = Math.abs(nor.getX(i)), ay = Math.abs(nor.getY(i)), az = Math.abs(nor.getZ(i));
    let u, v;
    if (ay >= ax && ay >= az) { u = px; v = pz; }
    else if (ax >= az) { u = pz; v = py; }
    else { u = px; v = py; }
    uv[i * 2] = u * s;
    uv[i * 2 + 1] = v * s;
  }
  geom.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

export class Arena {
  constructor(ctx) {
    this.ctx = ctx;
    const scene = ctx.scene;

    // ---- public contract surface -----------------------------------------
    this.group = new THREE.Group();
    this.group.name = 'Arena';
    this.spawns = ARENA_SPAWNS;
    this.colliders = { aabbs: ARENA_COLLIDERS, ramps: ARENA_RAMPS };
    this.world = ARENA_WORLD;

    // ---- internals --------------------------------------------------------
    this._batches = new Map();    // key -> [{x0,x1,y0,y1,z0,z1}]
    this._meshes = [];            // owned meshes/geoms for dispose
    this._materials = [];         // owned materials for dispose
    this._textures = [];          // owned textures for dispose
    this._lights = [];            // owned lights for dispose
    this._sceneAdded = [];        // things added directly to the scene (fog/bg/sky)
    this._accentLights = [];      // { light, base }
    this._accentScale = 1;

    this._buildTextures();
    this._buildMaterials();
    this._buildEnvironment();     // fog + gradient sky + background
    this._buildLights();

    this._buildColliderGeometry(); // solid mesh per AABB (matches the server)
    this._buildRampGeometry();     // solid wedge per ramp (matches the server)
    this._buildDecoration();       // floor grid, accent strips, spawn pads (no colliders)

    this._flushBatches();
    this._registerTunables();

    scene.add(this.group);
  }

  // ==========================================================================
  // textures
  // ==========================================================================

  _track(obj, bag) { bag.push(obj); return obj; }

  _buildTextures() {
    const T = (this.tex = {});

    // floor: dark tech panel with a fine + coarse grid, subtle speckle
    T.floor = canvasTex(256, 256, (g) => {
      g.fillStyle = '#141a24';
      g.fillRect(0, 0, 256, 256);
      const rnd = mulberry(11);
      for (let i = 0; i < 300; i++) {
        g.fillStyle = `rgba(255,255,255,${(0.008 + rnd() * 0.02).toFixed(3)})`;
        g.fillRect(rnd() * 256, rnd() * 256, 1 + rnd() * 2, 1 + rnd() * 2);
      }
      for (let i = 0; i < 120; i++) {
        g.fillStyle = `rgba(0,0,0,${(0.03 + rnd() * 0.05).toFixed(3)})`;
        g.fillRect(rnd() * 256, rnd() * 256, 2 + rnd() * 5, 2 + rnd() * 5);
      }
      // fine grid
      g.strokeStyle = 'rgba(70,110,140,0.10)';
      g.lineWidth = 1;
      for (let i = 32; i < 256; i += 32) {
        g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 256); g.stroke();
        g.beginPath(); g.moveTo(0, i); g.lineTo(256, i); g.stroke();
      }
      // coarse grid (brighter, cyan)
      g.strokeStyle = 'rgba(125,249,255,0.18)';
      g.lineWidth = 2;
      g.beginPath(); g.moveTo(0, 0); g.lineTo(0, 256); g.stroke();
      g.beginPath(); g.moveTo(0, 0); g.lineTo(256, 0); g.stroke();
    });
    this._track(T.floor, this._textures);

    // wall: cool metal panel with seams + rivets
    T.wall = canvasTex(256, 256, (g) => {
      const grad = g.createLinearGradient(0, 0, 0, 256);
      grad.addColorStop(0, '#2a323f');
      grad.addColorStop(1, '#20262f');
      g.fillStyle = grad;
      g.fillRect(0, 0, 256, 256);
      const rnd = mulberry(29);
      for (let i = 0; i < 150; i++) {
        g.fillStyle = `rgba(255,255,255,${(0.006 + rnd() * 0.014).toFixed(3)})`;
        g.fillRect(rnd() * 256, rnd() * 256, 2 + rnd() * 4, 1 + rnd() * 2);
      }
      g.fillStyle = '#191f27';
      g.fillRect(0, 84, 256, 3);
      g.fillRect(0, 172, 256, 3);
      g.fillRect(126, 0, 2, 256);
      g.fillStyle = '#39485c';
      for (const y of [85.5, 173.5]) {
        for (let x = 16; x < 256; x += 48) {
          g.beginPath(); g.arc(x, y, 2.0, 0, Math.PI * 2); g.fill();
        }
      }
    });
    this._track(T.wall, this._textures);

    // metal: brushed structure surface for platforms/cover/flanks
    T.metal = canvasTex(128, 128, (g) => {
      g.fillStyle = '#323b47';
      g.fillRect(0, 0, 128, 128);
      const rnd = mulberry(71);
      for (let i = 0; i < 220; i++) {
        g.fillStyle = `rgba(255,255,255,${(0.01 + rnd() * 0.03).toFixed(3)})`;
        g.fillRect(rnd() * 128, rnd() * 128, 6 + rnd() * 20, 1);
      }
      g.strokeStyle = 'rgba(0,0,0,0.25)';
      g.lineWidth = 2;
      g.strokeRect(1, 1, 126, 126);
    });
    this._track(T.metal, this._textures);

    // spawn pad decal: bracketed square + center chevrons
    T.pad = canvasTex(128, 128, (g) => {
      g.clearRect(0, 0, 128, 128);
      g.strokeStyle = 'rgba(255,255,255,0.95)';
      g.lineWidth = 5;
      // corner brackets
      const L = 26;
      const corner = (x, y, dx, dy) => {
        g.beginPath();
        g.moveTo(x, y + dy * L); g.lineTo(x, y); g.lineTo(x + dx * L, y);
        g.stroke();
      };
      corner(14, 14, 1, 1);
      corner(114, 14, -1, 1);
      corner(14, 114, 1, -1);
      corner(114, 114, -1, -1);
      // center cross
      g.lineWidth = 3;
      g.beginPath(); g.moveTo(64, 48); g.lineTo(64, 80); g.stroke();
      g.beginPath(); g.moveTo(48, 64); g.lineTo(80, 64); g.stroke();
    }, { repeat: false });
    this._track(T.pad, this._textures);

    // gradient sky (vertical strip stretched over a big inverted sphere)
    T.sky = canvasTex(8, 256, (g) => {
      const grad = g.createLinearGradient(0, 0, 0, 256);
      grad.addColorStop(0.0, '#16263f');
      grad.addColorStop(0.42, '#0d1727');
      grad.addColorStop(0.72, '#08111c');
      grad.addColorStop(1.0, '#05080e');
      g.fillStyle = grad;
      g.fillRect(0, 0, 8, 256);
      // faint horizon glow band
      g.fillStyle = 'rgba(90,170,190,0.10)';
      g.fillRect(0, 188, 8, 16);
    }, { repeat: false });
    this._track(T.sky, this._textures);
  }

  // ==========================================================================
  // materials
  // ==========================================================================

  _buildMaterials() {
    const T = this.tex;
    const std = (o) => this._track(new THREE.MeshStandardMaterial(o), this._materials);
    const basic = (c) => this._track(new THREE.MeshBasicMaterial({ color: c }), this._materials);

    // TSL pulse for wall-run edge strips (node material — runs on both backends)
    this._uPulseSpeed = uniform(2.4);
    this._uPulseDepth = uniform(0.4);
    const pulse01 = sin(time.mul(this._uPulseSpeed)).mul(0.5).add(0.5);
    const level = float(1).sub(this._uPulseDepth).add(pulse01.mul(this._uPulseDepth));
    const pulseMat = new THREE.MeshBasicNodeMaterial();
    pulseMat.colorNode = vec3(0.42, 0.95, 1.0).mul(level.mul(1.7));
    this._track(pulseMat, this._materials);

    // TSL slow pulse for the spawn-pad glow (softer, cyan)
    this._uSpawnSpeed = uniform(1.6);
    const spawn01 = sin(time.mul(this._uSpawnSpeed)).mul(0.5).add(0.5);
    const spawnLevel = float(0.55).add(spawn01.mul(0.45));
    const spawnMat = new THREE.MeshBasicNodeMaterial();
    spawnMat.colorNode = vec3(0.49, 0.976, 1.0).mul(spawnLevel.mul(1.5));
    spawnMat.transparent = true;
    spawnMat.opacity = 0.9;
    spawnMat.depthWrite = false;
    this._track(spawnMat, this._materials);

    const mats = (this.mats = {
      floor: std({ map: T.floor, roughness: 0.94, metalness: 0.05 }),
      wall: std({ map: T.wall, roughness: 0.88, metalness: 0.1 }),
      metal: std({ map: T.metal, roughness: 0.5, metalness: 0.6 }),
      platform: std({ map: T.metal, color: 0x8892a2, roughness: 0.55, metalness: 0.5 }),
      // upper block reads as the arena's centerpiece — warm accent emissive
      hub: std({ color: 0x3a4658, map: T.metal, roughness: 0.4, metalness: 0.55, emissive: 0x122436, emissiveIntensity: 0.5 }),
      cover: std({ map: T.metal, color: 0x707c8e, roughness: 0.6, metalness: 0.45 }),
      ramp: std({ color: 0x8a5420, map: T.metal, roughness: 0.55, metalness: 0.4, emissive: 0x341a06, emissiveIntensity: 0.35 }),
      // wall-run walls: distinct teal tint + emissive so they read as runnable
      wallrun: std({ color: 0x2b4a57, roughness: 0.42, metalness: 0.55, emissive: 0x0d3540, emissiveIntensity: 0.6 }),
      trimCyan: basic(0x7df9ff),
      trimOrange: basic(0xffa040),
      pulse: pulseMat,
      spawn: spawnMat,
    });

    // batch defs: material, uv density, whether it casts shadow
    this._defs = {
      floor: { mat: mats.floor, uv: 0.25 },
      wall: { mat: mats.wall, uv: 0.22 },
      metal: { mat: mats.metal, uv: 0.4 },
      platform: { mat: mats.platform, uv: 0.35 },
      hub: { mat: mats.hub, uv: 0.4 },
      cover: { mat: mats.cover, uv: 0.5 },
      wallrun: { mat: mats.wallrun, uv: 0.35 },
      trimCyan: { mat: mats.trimCyan, uv: 1, cast: false },
      trimOrange: { mat: mats.trimOrange, uv: 1, cast: false },
      pulse: { mat: mats.pulse, uv: 1, cast: false },
    };
  }

  // ==========================================================================
  // batching — merge same-material boxes into one geometry (few draw calls)
  // ==========================================================================

  _box(key, x0, x1, y0, y1, z0, z1) {
    let list = this._batches.get(key);
    if (!list) this._batches.set(key, (list = []));
    list.push({ x0, x1, y0, y1, z0, z1 });
  }

  _mergeBoxes(list, uvScale) {
    if (!Arena._tpl) Arena._tpl = new THREE.BoxGeometry(1, 1, 1);
    const tpl = Arena._tpl;
    const tp = tpl.attributes.position.array; // 24 verts
    const tn = tpl.attributes.normal.array;
    const ti = tpl.index.array;               // 36 indices
    const n = list.length;
    const pos = new Float32Array(n * 72);
    const nor = new Float32Array(n * 72);
    const uv = new Float32Array(n * 48);
    const idx = n * 24 > 65000 ? new Uint32Array(n * 36) : new Uint16Array(n * 36);
    for (let i = 0; i < n; i++) {
      const b = list[i];
      const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, cz = (b.z0 + b.z1) / 2;
      const sx = b.x1 - b.x0, sy = b.y1 - b.y0, sz = b.z1 - b.z0;
      for (let v = 0; v < 24; v++) {
        const o = (i * 24 + v) * 3;
        const px = cx + tp[v * 3] * sx;
        const py = cy + tp[v * 3 + 1] * sy;
        const pz = cz + tp[v * 3 + 2] * sz;
        pos[o] = px; pos[o + 1] = py; pos[o + 2] = pz;
        const nx = tn[v * 3], ny = tn[v * 3 + 1], nz = tn[v * 3 + 2];
        nor[o] = nx; nor[o + 1] = ny; nor[o + 2] = nz;
        const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
        let u, w;
        if (ay >= ax && ay >= az) { u = px; w = pz; }
        else if (ax >= az) { u = pz; w = py; }
        else { u = px; w = py; }
        const uo = (i * 24 + v) * 2;
        uv[uo] = u * uvScale;
        uv[uo + 1] = w * uvScale;
      }
      for (let k = 0; k < 36; k++) idx[i * 36 + k] = ti[k] + i * 24;
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geom.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geom.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geom.setIndex(new THREE.BufferAttribute(idx, 1));
    geom.computeBoundingSphere();
    return geom;
  }

  _flushBatches() {
    for (const [key, list] of this._batches) {
      if (!list.length) continue;
      const def = this._defs[key];
      const geom = this._mergeBoxes(list, def.uv);
      const mesh = new THREE.Mesh(geom, def.mat);
      mesh.castShadow = def.cast !== false;
      mesh.receiveShadow = def.cast !== false;
      mesh.matrixAutoUpdate = false;
      this.group.add(mesh);
      this._meshes.push(mesh);
    }
    this._batches.clear();
  }

  // ==========================================================================
  // collider geometry — one solid box per ARENA_COLLIDERS entry (server-exact)
  // ==========================================================================

  _buildColliderGeometry() {
    // classify each authoritative AABB by its role so it gets the right look,
    // WITHOUT changing its bounds. Floor slab gets the grid; wall-run boxes get
    // the teal tint (+ glow accents added in _buildDecoration); everything else
    // is structural metal. Roles are derived purely from the box shape/position
    // so visuals track the data even if the numbers are retuned.
    for (const c of ARENA_COLLIDERS) {
      const { min, max } = c;
      const w = max.x - min.x, h = max.y - min.y, d = max.z - min.z;

      if (c.wallrun) {
        this._box('wallrun', min.x, max.x, min.y, max.y, min.z, max.z);
        continue;
      }
      // floor slab: very wide + thin, sits below y=0
      if (min.y < 0 && h <= 3 && w > 20 && d > 20) {
        this._box('floor', min.x, max.x, min.y, max.y, min.z, max.z);
        continue;
      }
      // perimeter walls: tall + thin in one horizontal axis, span the arena
      if (max.y >= 6 && (w <= 2 || d <= 2)) {
        this._box('wall', min.x, max.x, min.y, max.y, min.z, max.z);
        continue;
      }
      // central hub: the small upper block (top y=5, footprint 6x6)
      if (min.y >= 3 && h >= 1.5) {
        this._box('hub', min.x, max.x, min.y, max.y, min.z, max.z);
        continue;
      }
      // central main platform (big footprint, top y=3)
      if (w >= 10 && d >= 10) {
        this._box('platform', min.x, max.x, min.y, max.y, min.z, max.z);
        continue;
      }
      // everything else: cover blocks + outer flank platforms
      this._box('cover', min.x, max.x, min.y, max.y, min.z, max.z);
    }
  }

  // ==========================================================================
  // ramp geometry — one solid sloped wedge per ARENA_RAMPS entry (server-exact)
  // ==========================================================================

  _buildRampGeometry() {
    for (const r of ARENA_RAMPS) {
      this._wedge(r);
    }
  }

  // Solid sloped-top wedge matching a heightfield ramp collider. The ramp's top
  // height varies from h0 (at the min end of `axis`) to h1 (at the max end).
  _wedge(r) {
    const x0 = r.min.x, x1 = r.max.x, z0 = r.min.z, z1 = r.max.z;
    const axis = r.axis || 'x';
    const h0 = r.h0, h1 = r.h1;

    // top-surface height at a given corner, per the ramp's slope axis
    const topAt = (x, z) => {
      const t = axis === 'x'
        ? (x - r.min.x) / (r.max.x - r.min.x)
        : (z - r.min.z) / (r.max.z - r.min.z);
      return h0 + (h1 - h0) * t;
    };

    // base corners (y=0) and top corners (sloped)
    const A = [x0, 0, z0], B = [x1, 0, z0], C = [x1, 0, z1], D = [x0, 0, z1];
    const E = [x0, topAt(x0, z0), z0], F = [x1, topAt(x1, z0), z0];
    const G = [x1, topAt(x1, z1), z1], H = [x0, topAt(x0, z1), z1];

    const tris = [];
    const quad = (a, b, c, d) => tris.push(a, b, c, a, c, d);
    quad(A, B, C, D);   // bottom (−y)
    quad(E, H, G, F);   // sloped top
    quad(A, E, F, B);   // −z end
    quad(D, C, G, H);   // +z end
    quad(A, D, H, E);   // −x side
    quad(B, F, G, C);   // +x side

    const posArr = new Float32Array(tris.length * 3);
    for (let i = 0; i < tris.length; i++) {
      posArr[i * 3] = tris[i][0];
      posArr[i * 3 + 1] = tris[i][1];
      posArr[i * 3 + 2] = tris[i][2];
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
    geom.computeVertexNormals();
    const def = this._defs.metal;
    projectUVs(geom, 0.4);
    geom.computeBoundingSphere();
    const mesh = new THREE.Mesh(geom, this.mats.ramp);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    this.group.add(mesh);
    this._meshes.push(mesh);

    // orange edge strips down the two slope sides so the ramp reads at a glance
    const len = Math.hypot(x1 - x0, Math.max(h0, h1));
    // strips run along whichever axis the slope travels
    if (axis === 'x') {
      const ang = Math.atan2(h1 - h0, x1 - x0);
      const midY = (h0 + h1) / 2;
      for (const z of [z0 + 0.25, z1 - 0.25]) {
        const strip = new THREE.Mesh(
          new THREE.BoxGeometry(len, 0.05, 0.16),
          this.mats.trimOrange,
        );
        strip.position.set((x0 + x1) / 2, midY + 0.04, z);
        strip.rotation.z = ang;
        strip.castShadow = false;
        this.group.add(strip);
        this._meshes.push(strip);
      }
    } else {
      const ang = Math.atan2(h1 - h0, z1 - z0);
      const midY = (h0 + h1) / 2;
      for (const x of [x0 + 0.25, x1 - 0.25]) {
        const strip = new THREE.Mesh(
          new THREE.BoxGeometry(0.16, 0.05, len),
          this.mats.trimOrange,
        );
        strip.position.set(x, midY + 0.04, (z0 + z1) / 2);
        strip.rotation.x = -ang;
        strip.castShadow = false;
        this.group.add(strip);
        this._meshes.push(strip);
      }
    }
  }

  // ==========================================================================
  // non-colliding decoration: floor markings, structure edge accents,
  // wall-run glow, spawn pads. NONE of this adds collision.
  // ==========================================================================

  _buildDecoration() {
    // ---- perimeter of the play space: cyan skirting along the inner floor edge
    const R = 21.9; // just inside the perimeter walls (they start at ±22)
    this._box('trimCyan', -R, R, 0.02, 0.09, -R - 0.05, -R + 0.05);
    this._box('trimCyan', -R, R, 0.02, 0.09, R - 0.05, R + 0.05);
    this._box('trimCyan', -R - 0.05, -R + 0.05, 0.02, 0.09, -R, R);
    this._box('trimCyan', R - 0.05, R + 0.05, 0.02, 0.09, -R, R);

    // ---- center crosshair lines on the floor (readable symmetry cue)
    this._box('trimCyan', -0.04, 0.04, 0.012, 0.03, -21, 21);
    this._box('trimCyan', -21, 21, 0.012, 0.03, -0.04, 0.04);

    // ---- edge accents on structural pieces derived from the collider data ----
    for (const c of ARENA_COLLIDERS) {
      const { min, max } = c;
      const w = max.x - min.x, h = max.y - min.y, d = max.z - min.z;

      if (c.wallrun) {
        // WALL-RUN GLOW: pulsing top strip + vertical end strips so the runnable
        // walls pop against everything else.
        this._box('pulse', min.x - 0.04, max.x + 0.04, max.y, max.y + 0.09, min.z, max.z);
        this._box('pulse', min.x - 0.04, max.x + 0.04, min.y, max.y, min.z - 0.04, min.z + 0.06);
        this._box('pulse', min.x - 0.04, max.x + 0.04, min.y, max.y, max.z - 0.06, max.z + 0.04);
        continue;
      }
      // skip the floor slab + perimeter walls (they get their own treatment)
      if (min.y < 0) continue;
      if (max.y >= 6 && (w <= 2 || d <= 2)) continue;

      // top-edge accent trim on platforms / hub / cover / flanks
      const isHub = min.y >= 3 && h >= 1.5;
      const key = isHub ? 'trimCyan' : 'trimCyan';
      const inset = 0.06;
      // frame the top face with four thin strips
      this._box(key, min.x, max.x, max.y, max.y + 0.04, min.z, min.z + inset);
      this._box(key, min.x, max.x, max.y, max.y + 0.04, max.z - inset, max.z);
      this._box(key, min.x, min.x + inset, max.y, max.y + 0.04, min.z, max.z);
      this._box(key, max.x - inset, max.x, max.y, max.y + 0.04, min.z, max.z);
    }

    // ---- perimeter wall accent band (cyan line partway up, all four walls) ----
    const WY = 2.2;
    this._box('trimCyan', -22, 22, WY, WY + 0.06, -22.02, -21.96);
    this._box('trimCyan', -22, 22, WY, WY + 0.06, 21.96, 22.02);
    this._box('trimCyan', -22.02, -21.96, WY, WY + 0.06, -22, 22);
    this._box('trimCyan', 21.96, 22.02, WY, WY + 0.06, -22, 22);

    // ---- clean flat "pickup" spots reserved for later (subtle ring markers,
    // NO pickups added). Placed on open flat ground and on the hub. ----
    this._pickupSpots = [
      V(0, 5.01, 0),      // atop the upper block
      V(-13, 0.01, -13),  // NW open floor
      V(13, 0.01, 13),    // SE open floor
      V(-13, 0.01, 13),   // SW open floor
      V(13, 0.01, -13),   // NE open floor
    ];
    for (const p of this._pickupSpots) {
      // faint dashed cyan disc — a hint, not a pickup
      this._floorRing(p.x, p.y, p.z, 0.7, 0x7df9ff, 0.25);
    }

    // ---- spawn pads: glowing bracketed square + pulsing disc at each spawn ----
    for (const s of ARENA_SPAWNS) {
      this._spawnPad(s.pos.x, s.pos.y, s.pos.z, s.yaw);
    }
  }

  // dashed cyan floor ring decal (non-colliding hint marker)
  _floorRing(x, y, z, radius, color, opacity) {
    const tex = canvasTex(128, 128, (g) => {
      g.clearRect(0, 0, 128, 128);
      g.strokeStyle = 'rgba(255,255,255,0.95)';
      g.lineWidth = 5;
      g.setLineDash([14, 10]);
      g.beginPath(); g.arc(64, 64, 52, 0, Math.PI * 2); g.stroke();
    }, { repeat: false });
    this._track(tex, this._textures);
    const mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, depthWrite: false, color, opacity,
    });
    this._track(mat, this._materials);
    const geom = new THREE.PlaneGeometry(radius * 2, radius * 2);
    geom.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(x, y + 0.005, z);
    mesh.renderOrder = 2;
    mesh.castShadow = false;
    this.group.add(mesh);
    this._meshes.push(mesh);
  }

  // glowing spawn pad: pulsing textured disc oriented toward the spawn yaw
  _spawnPad(x, y, z, yaw) {
    const geom = new THREE.PlaneGeometry(1.6, 1.6);
    geom.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geom, this._spawnPadMat());
    mesh.position.set(x, y + 0.02, z);
    mesh.rotation.y = (yaw * Math.PI) / 180;
    mesh.renderOrder = 3;
    mesh.castShadow = false;
    this.group.add(mesh);
    this._meshes.push(mesh);

    // a low soft point light per spawn so the pads read as energized (cheap: 4-6)
    const l = new THREE.PointLight(0x7df9ff, 3.0, 6, 2.2);
    l.position.set(x, y + 0.8, z);
    this.group.add(l);
    this._lights.push(l);
    this._accentLights.push({ light: l, base: 3.0 });
  }

  _spawnPadMat() {
    if (this._spawnPadMaterial) return this._spawnPadMaterial;
    const tex = canvasTex(128, 128, (g) => {
      g.clearRect(0, 0, 128, 128);
      g.strokeStyle = 'rgba(255,255,255,0.95)';
      // bracketed square
      g.lineWidth = 6;
      const L = 24;
      const corner = (cx, cy, dx, dy) => {
        g.beginPath();
        g.moveTo(cx, cy + dy * L); g.lineTo(cx, cy); g.lineTo(cx + dx * L, cy);
        g.stroke();
      };
      corner(16, 16, 1, 1); corner(112, 16, -1, 1);
      corner(16, 112, 1, -1); corner(112, 112, -1, -1);
      // forward arrow (points toward -Z of the plane before yaw rotation)
      g.lineWidth = 5;
      g.beginPath();
      g.moveTo(64, 38); g.lineTo(50, 58); g.moveTo(64, 38); g.lineTo(78, 58);
      g.moveTo(64, 38); g.lineTo(64, 88);
      g.stroke();
    }, { repeat: false });
    this._track(tex, this._textures);
    // reuse the pulsing spawn node material for the emissive glow, but the shape
    // comes from an alpha-mapped basic material so the brackets/arrow show.
    const mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, depthWrite: false,
      color: 0x7df9ff, opacity: 0.95, blending: THREE.AdditiveBlending,
    });
    this._track(mat, this._materials);
    this._spawnPadMaterial = mat;
    return mat;
  }

  // ==========================================================================
  // environment: fog + gradient sky + background
  // ==========================================================================

  _buildEnvironment() {
    const scene = this.ctx.scene;

    // remember prior scene state so dispose() can restore single-player range
    this._prevBackground = scene.background;
    this._prevFog = scene.fog;

    scene.background = new THREE.Color(0x05080e);
    scene.fog = new THREE.Fog(0x08111c, 26, 130);

    // gradient sky sphere (inverted, unlit, ignores fog)
    const geom = new THREE.SphereGeometry(300, 32, 16);
    const mat = new THREE.MeshBasicMaterial({
      map: this.tex.sky,
      side: THREE.BackSide,
      fog: false,
      depthWrite: false,
    });
    this._track(mat, this._materials);
    const sky = new THREE.Mesh(geom, mat);
    sky.frustumCulled = false;
    sky.matrixAutoUpdate = false;
    this.group.add(sky);
    this._meshes.push(sky);
    this._sky = sky;
  }

  // ==========================================================================
  // lighting: directional key + hemisphere ambient + emissive accent points,
  // soft shadows with a tight frustum around the play space.
  // ==========================================================================

  _buildLights() {
    // hemisphere ambient (sky/ground fill)
    this.hemi = new THREE.HemisphereLight(0x3a5a78, 0x10141b, 0.75);
    this.group.add(this.hemi);
    this._lights.push(this.hemi);

    // directional key — angled across the arena, tight shadow frustum
    this.key = new THREE.DirectionalLight(0xdfeaff, 2.1);
    this.key.position.set(24, 46, 18);
    this.key.target.position.set(0, 0, 0);
    this.key.castShadow = true;
    const sc = this.key.shadow.camera;
    sc.left = -30; sc.right = 30; sc.top = 30; sc.bottom = -30;
    sc.near = 8; sc.far = 110;
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.bias = -0.00035;
    this.key.shadow.normalBias = 0.028;
    this.group.add(this.key);
    this.group.add(this.key.target);
    this._lights.push(this.key);

    // soft cool fill from the opposite side (no shadow)
    this.fill = new THREE.DirectionalLight(0x2a4a66, 0.5);
    this.fill.position.set(-30, 26, -24);
    this.group.add(this.fill);
    this._lights.push(this.fill);

    // emissive-matched accent point lights over the central structure (few)
    const pts = [
      [0x7df9ff, 14, 24, 0, 6.5, 0],    // center hub uplight
      [0x9fd0ff, 8, 20, -14, 4, 4],     // NW cover
      [0x9fd0ff, 8, 20, 12, 4, -4],     // SE cover
    ];
    for (const [c, i, dist, x, y, z] of pts) {
      const l = new THREE.PointLight(c, i, dist, 1.9);
      l.position.set(x, y, z);
      this.group.add(l);
      this._lights.push(l);
      this._accentLights.push({ light: l, base: i });
    }
  }

  // ==========================================================================
  // tunables (matches RangeWorld's tunable pattern; harmless if unused)
  // ==========================================================================

  _registerTunables() {
    const T = this.ctx.tunables;
    if (!Array.isArray(T)) return;
    const fog = this.ctx.scene.fog;
    T.push({ cat: 'arena', key: 'fogNear', obj: fog, prop: 'near', min: 5, max: 80, step: 1 });
    T.push({ cat: 'arena', key: 'fogFar', obj: fog, prop: 'far', min: 60, max: 300, step: 5 });
    T.push({ cat: 'arena', key: 'keyLight', obj: this.key, prop: 'intensity', min: 0, max: 5, step: 0.05 });
    T.push({ cat: 'arena', key: 'hemiLight', obj: this.hemi, prop: 'intensity', min: 0, max: 2.5, step: 0.05 });
    T.push({ cat: 'arena', key: 'fillLight', obj: this.fill, prop: 'intensity', min: 0, max: 2, step: 0.05 });
    T.push({ cat: 'arena', key: 'wallrunPulseHz', obj: this._uPulseSpeed, prop: 'value', min: 0, max: 8, step: 0.1 });
    T.push({ cat: 'arena', key: 'wallrunPulseDepth', obj: this._uPulseDepth, prop: 'value', min: 0, max: 1, step: 0.02 });
    T.push({ cat: 'arena', key: 'spawnPulseHz', obj: this._uSpawnSpeed, prop: 'value', min: 0, max: 6, step: 0.1 });
    T.push({
      cat: 'arena', key: 'accentLights',
      get: () => this._accentScale,
      set: (v) => {
        this._accentScale = v;
        for (const { light, base } of this._accentLights) light.intensity = base * v;
      },
      min: 0, max: 3, step: 0.05,
    });
  }

  // ==========================================================================
  // lifecycle
  // ==========================================================================

  // no screen-dependent content, but provided for the module contract
  resize(_w, _h) {}

  dispose() {
    const scene = this.ctx.scene;

    // remove + restore scene environment to single-player state
    scene.background = this._prevBackground ?? null;
    scene.fog = this._prevFog ?? null;

    // detach the whole group
    scene.remove(this.group);

    for (const m of this._meshes) {
      if (m.geometry) m.geometry.dispose?.();
      m.parent?.remove(m);
    }
    for (const l of this._lights) {
      l.dispose?.();
      l.parent?.remove(l);
    }
    for (const mat of this._materials) mat.dispose?.();
    for (const t of this._textures) t.dispose?.();

    this._meshes.length = 0;
    this._lights.length = 0;
    this._materials.length = 0;
    this._textures.length = 0;
    this._accentLights.length = 0;
    this._batches.clear();
  }
}
