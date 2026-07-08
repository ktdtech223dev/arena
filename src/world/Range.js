// world/Range.js — RangeWorld: THE FACILITY. All static level geometry,
// lighting, sky, code-generated canvas textures, colliders and the anchor
// layout every other system builds on (contract §4 / §C1).
//
// Coordinate conventions: +Y up, firing line at z≈0, DOWNRANGE = −Z.
// Zones (plan view):
//   MAIN GALLERY    x[-14, 14]  z[-105, 12]  ceiling 9
//   PRECISION WING  x[-26,-15]  z[-105,  2]  shares the hall, colonnade divider
//   CQC ROOM        x[-42,-18]  z[  -4, 18]  ceiling 4.2, corridor from gallery
//   MOVING BAY      x[ 15, 30]  z[ -45, -5]  ceiling 7, colonnade to gallery
//   CONCOURSE       x[ 15, 31]  z[  -4,  7]  links gallery → course start
//   MOVE COURSE     x[ 31, 45]  z[ -99,  7]  ceiling 14, return corridor x[42,45]
//
// All custom shading is TSL node materials (contract §11) — never raw GLSL.
import * as THREE from 'three/webgpu';
import { float, sin, time, uniform, vec3 } from 'three/tsl';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// deterministic rng for texture noise
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

// Box-projected world-space UVs so one texture tiles at constant density on
// every face of every merged box, regardless of box size.
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

export class RangeWorld {
  constructor(ctx) {
    this.ctx = ctx;
    const scene = ctx.scene;
    this.colliders = ctx.world.colliders;

    // ---- public contract surface -----------------------------------------
    this.spawnPoint = V(0, 0, 9);
    this.spawnYaw = 0; // facing −Z
    this.solidMeshes = [];
    this.consoleMesh = null;
    this.anchors = {
      spawn: { pos: V(0, 0, 9), yaw: 0 },
      console: { pos: V(2.2, 0, 6.5) },
      gallery: [],
      precision: [],
      movingH: [],
      movingV: [],
      movingC: [],
      peekers: [],
      cqc: [],
      dummy: { pos: V(8, 0, -15) },
      drillVolume: { min: V(-10, 0.8, -30), max: V(10, 3.2, -8) },
      course: { start: null, finish: null, gates: [] },
    };

    // ---- internals --------------------------------------------------------
    this._batches = new Map();   // key -> [{x0,x1,y0,y1,z0,z1}]
    this._decalMats = new Map();
    this._accentLights = [];
    this._accentScale = 1;

    this._buildTextures();
    this._buildMaterials();

    scene.background = new THREE.Color(0x04070c);
    scene.fog = new THREE.Fog(0x070b12, 22, 165);

    this._buildSky();
    this._buildLights();

    this._buildShell();
    this._buildGallery();
    this._buildPrecision();
    this._buildBay();
    this._buildCqc();
    this._buildCourse();
    this._buildConsole();

    this._flushBatches();
    this._registerTunables();
  }

  // ==========================================================================
  // textures / materials
  // ==========================================================================

  _buildTextures() {
    const T = (this.tex = {});

    T.floor = canvasTex(256, 256, (g) => {
      g.fillStyle = '#1b212b';
      g.fillRect(0, 0, 256, 256);
      const rnd = mulberry(7);
      for (let i = 0; i < 320; i++) {
        g.fillStyle = `rgba(255,255,255,${(0.01 + rnd() * 0.02).toFixed(3)})`;
        g.fillRect(rnd() * 256, rnd() * 256, 1 + rnd() * 2, 1 + rnd() * 2);
      }
      for (let i = 0; i < 140; i++) {
        g.fillStyle = `rgba(0,0,0,${(0.03 + rnd() * 0.05).toFixed(3)})`;
        g.fillRect(rnd() * 256, rnd() * 256, 2 + rnd() * 5, 2 + rnd() * 5);
      }
      g.strokeStyle = '#232b38';
      g.lineWidth = 1;
      for (let i = 64; i < 256; i += 64) {
        g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 256); g.stroke();
        g.beginPath(); g.moveTo(0, i); g.lineTo(256, i); g.stroke();
      }
      g.strokeStyle = '#2e3a4c';
      g.lineWidth = 3;
      g.strokeRect(1.5, 1.5, 253, 253);
    });

    T.wall = canvasTex(256, 256, (g) => {
      const grad = g.createLinearGradient(0, 0, 0, 256);
      grad.addColorStop(0, '#28303d');
      grad.addColorStop(1, '#222935');
      g.fillStyle = grad;
      g.fillRect(0, 0, 256, 256);
      const rnd = mulberry(31);
      for (let i = 0; i < 160; i++) {
        g.fillStyle = `rgba(255,255,255,${(0.008 + rnd() * 0.016).toFixed(3)})`;
        g.fillRect(rnd() * 256, rnd() * 256, 2 + rnd() * 4, 1 + rnd() * 2);
      }
      g.fillStyle = '#1a212c';
      g.fillRect(0, 82, 256, 3);
      g.fillRect(0, 170, 256, 3);
      g.fillRect(126, 0, 2, 256);
      g.fillStyle = '#333e4f';
      for (const y of [83.5, 171.5]) {
        for (let x = 16; x < 256; x += 48) {
          g.beginPath(); g.arc(x, y, 2.2, 0, Math.PI * 2); g.fill();
        }
      }
    });

    T.metal = canvasTex(128, 128, (g) => {
      g.fillStyle = '#343d49';
      g.fillRect(0, 0, 128, 128);
      const rnd = mulberry(99);
      for (let i = 0; i < 220; i++) {
        g.fillStyle = `rgba(255,255,255,${(0.01 + rnd() * 0.03).toFixed(3)})`;
        g.fillRect(rnd() * 128, rnd() * 128, 6 + rnd() * 20, 1);
      }
      g.strokeStyle = 'rgba(0,0,0,0.25)';
      g.lineWidth = 2;
      g.strokeRect(1, 1, 126, 126);
    });

    // 45° hazard stripes that tile seamlessly (period 64 on both axes)
    T.hazard = canvasTex(128, 128, (g) => {
      g.fillStyle = '#23262d';
      g.fillRect(0, 0, 128, 128);
      g.fillStyle = '#df8a28';
      for (let y = 0; y < 128; y++) {
        for (let x = -128; x < 192; x += 64) {
          g.fillRect(x + (y % 64), y, 32, 1);
        }
      }
    });

    T.pad = canvasTex(128, 128, (g) => {
      g.strokeStyle = 'rgba(255,255,255,0.95)';
      g.lineWidth = 5;
      g.strokeRect(10, 10, 108, 108);
      g.lineWidth = 3;
      g.beginPath(); g.moveTo(64, 44); g.lineTo(64, 84); g.stroke();
      g.beginPath(); g.moveTo(44, 64); g.lineTo(84, 64); g.stroke();
    }, { repeat: false });

    T.ring = canvasTex(256, 256, (g) => {
      g.strokeStyle = 'rgba(255,255,255,0.95)';
      g.lineWidth = 7;
      g.setLineDash([26, 14]);
      g.beginPath(); g.arc(128, 128, 112, 0, Math.PI * 2); g.stroke();
      g.setLineDash([]);
      g.lineWidth = 3;
      g.beginPath(); g.arc(128, 128, 92, 0, Math.PI * 2); g.stroke();
    }, { repeat: false });

    T.numerals = {};
    for (const d of [5, 10, 25, 50, 100]) {
      T.numerals[d] = canvasTex(256, 148, (g) => {
        g.clearRect(0, 0, 256, 148);
        g.font = '900 118px Arial, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillStyle = 'rgba(215,238,255,0.88)';
        g.fillText(String(d), 128, 80);
        g.fillStyle = 'rgba(125,249,255,0.55)';
        g.fillRect(30, 132, 196, 6);
      }, { repeat: false });
    }

    T.console = canvasTex(512, 320, (g) => {
      g.fillStyle = '#04131c';
      g.fillRect(0, 0, 512, 320);
      g.strokeStyle = 'rgba(125,249,255,0.5)';
      g.lineWidth = 2;
      g.strokeRect(6, 6, 500, 308);
      g.fillStyle = '#7df9ff';
      g.font = 'bold 34px Consolas, monospace';
      g.fillText('RANGE CONTROL', 24, 52);
      g.fillStyle = 'rgba(125,249,255,0.25)';
      g.fillRect(24, 66, 464, 2);
      g.font = '20px Consolas, monospace';
      g.fillStyle = 'rgba(160,220,235,0.8)';
      g.fillText('TARGETS ......... ONLINE', 24, 104);
      g.fillText('DRILLS .......... READY', 24, 132);
      g.fillText('COURSE .......... ARMED', 24, 160);
      g.fillText('SIM CORE ........ 120 Hz', 24, 188);
      for (let i = 0; i < 14; i++) {
        const h = 16 + ((i * 41) % 52);
        g.fillStyle = `rgba(125,249,255,${(0.25 + ((i * 29) % 50) / 100).toFixed(2)})`;
        g.fillRect(300 + i * 14, 240 - h, 9, h);
      }
      g.font = 'bold 26px Consolas, monospace';
      g.fillStyle = '#eaffff';
      g.fillText('PRESS [E] TO OPERATE', 24, 292);
    }, { repeat: false });

    T.sky = canvasTex(8, 256, (g) => {
      const grad = g.createLinearGradient(0, 0, 0, 256);
      grad.addColorStop(0.0, '#152540');
      grad.addColorStop(0.45, '#0c1626');
      grad.addColorStop(0.75, '#071019');
      grad.addColorStop(1.0, '#04070c');
      g.fillStyle = grad;
      g.fillRect(0, 0, 8, 256);
      g.fillStyle = 'rgba(80,160,180,0.10)';
      g.fillRect(0, 190, 8, 14);
    }, { repeat: false });
  }

  _buildMaterials() {
    const T = this.tex;
    const std = (o) => new THREE.MeshStandardMaterial(o);
    const basic = (c) => new THREE.MeshBasicMaterial({ color: c });

    // TSL pulse for wall-run edge strips (node material — runs on both backends)
    this._uPulseSpeed = uniform(2.4);
    this._uPulseDepth = uniform(0.35);
    const pulse01 = sin(time.mul(this._uPulseSpeed)).mul(0.5).add(0.5);
    const level = float(1).sub(this._uPulseDepth).add(pulse01.mul(this._uPulseDepth));
    const pulseMat = new THREE.MeshBasicNodeMaterial();
    pulseMat.colorNode = vec3(0.49, 0.976, 1.0).mul(level.mul(1.7));

    const mats = (this.mats = {
      floor: std({ map: T.floor, roughness: 0.95, metalness: 0.04 }),
      wall: std({ map: T.wall, roughness: 0.9, metalness: 0.06 }),
      ceil: std({ map: T.wall, color: 0x707c92, roughness: 0.95, metalness: 0.03 }),
      metal: std({ map: T.metal, roughness: 0.45, metalness: 0.65 }),
      metalDark: std({ map: T.metal, color: 0x767f8f, roughness: 0.5, metalness: 0.7 }),
      wallrun: std({ color: 0x2b4a57, roughness: 0.42, metalness: 0.55, emissive: 0x0d3540, emissiveIntensity: 0.55 }),
      ramp: std({ color: 0x8a5420, roughness: 0.55, metalness: 0.4, emissive: 0x341a06, emissiveIntensity: 0.35 }),
      hazard: std({ map: T.hazard, roughness: 0.6, metalness: 0.3 }),
      trimCyan: basic(0x7df9ff),
      trimOrange: basic(0xffa040),
      trimMagenta: basic(0xff5fd2),
      trimWhite: basic(0xd8ecff),
      pulse: pulseMat,
    });

    // batch defs: material, raycast surface, uv density, solidity
    this._defs = {
      floor: { mat: mats.floor, surface: 'concrete', uv: 0.25 },
      wall: { mat: mats.wall, surface: 'concrete', uv: 0.25 },
      ceil: { mat: mats.ceil, surface: 'concrete', uv: 0.25, cast: false },
      metal: { mat: mats.metal, surface: 'metal', uv: 0.45 },
      ramp: { mat: mats.ramp, surface: 'metal', uv: 0.4 },
      metalDark: { mat: mats.metalDark, surface: 'metal', uv: 0.45 },
      wallrun: { mat: mats.wallrun, surface: 'metal', uv: 0.35 },
      hazard: { mat: mats.hazard, surface: 'metal', uv: 0.5 },
      trimCyan: { mat: mats.trimCyan, solid: false, cast: false, uv: 1 },
      trimOrange: { mat: mats.trimOrange, solid: false, cast: false, uv: 1 },
      trimMagenta: { mat: mats.trimMagenta, solid: false, cast: false, uv: 1 },
      trimWhite: { mat: mats.trimWhite, solid: false, cast: false, uv: 1 },
      pulse: { mat: mats.pulse, solid: false, cast: false, uv: 1 },
    };
  }

  // ==========================================================================
  // batching helpers — every solid box gets a matching collider automatically
  // ==========================================================================

  /** Queue an axis-aligned box for the merged batch `key`. Solid batches also
   *  register a collider (unless opts.collider === false). */
  _box(key, x0, x1, y0, y1, z0, z1, opts = {}) {
    let list = this._batches.get(key);
    if (!list) this._batches.set(key, (list = []));
    list.push({ x0, x1, y0, y1, z0, z1 });
    const def = this._defs[key];
    if (def.solid !== false && opts.collider !== false) {
      this.colliders.addBox(V(x0, y0, z0), V(x1, y1, z1), {
        wallrun: !!opts.wallrun,
        surface: def.surface,
      });
    }
  }

  _mergeBoxes(list, uvScale) {
    if (!RangeWorld._tpl) RangeWorld._tpl = new THREE.BoxGeometry(1, 1, 1);
    const tpl = RangeWorld._tpl;
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
      const mesh = new THREE.Mesh(this._mergeBoxes(list, def.uv), def.mat);
      mesh.castShadow = def.cast !== false;
      mesh.receiveShadow = def.receive !== false && def.solid !== false;
      mesh.matrixAutoUpdate = false;
      if (def.solid !== false) {
        mesh.userData.surface = def.surface;
        this.solidMeshes.push(mesh);
      }
      this.ctx.scene.add(mesh);
    }
    this._batches.clear();
  }

  /** Sloped-top solid (ramp visual). Base y=0, top h0 at z0 → h1 at z1.
   *  Registers the matching heightfield ramp collider. */
  _wedge(matKey, x0, x1, z0, z1, h0, h1) {
    const A = [x0, 0, z0], B = [x1, 0, z0], C = [x1, 0, z1], D = [x0, 0, z1];
    const E = [x0, h0, z0], F = [x1, h0, z0], G = [x1, h1, z1], H = [x0, h1, z1];
    const tris = [];
    const quad = (a, b, c, d) => tris.push(a, b, c, a, c, d);
    quad(A, B, C, D);                    // bottom (−y)
    quad(E, H, G, F);                    // sloped top
    if (h0 > 0.001) quad(A, E, F, B);    // −z end
    if (h1 > 0.001) quad(D, C, G, H);    // +z end
    quad(A, D, H, E);                    // −x side
    quad(B, F, G, C);                    // +x side
    const posArr = new Float32Array(tris.length * 3);
    for (let i = 0; i < tris.length; i++) {
      posArr[i * 3] = tris[i][0];
      posArr[i * 3 + 1] = tris[i][1];
      posArr[i * 3 + 2] = tris[i][2];
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
    geom.computeVertexNormals();
    const def = this._defs[matKey];
    projectUVs(geom, def.uv);
    geom.computeBoundingSphere();
    const mesh = new THREE.Mesh(geom, def.mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.userData.surface = def.surface;
    this.ctx.scene.add(mesh);
    this.solidMeshes.push(mesh);
    this.colliders.addRamp(V(x0, 0, z0), V(x1, Math.max(h0, h1), z1), 'z', h0, h1, { surface: def.surface });
    return mesh;
  }

  /** Flat (or vertical) textured decal plane. Not solid, no collider. */
  _decal(tex, w, h, x, y, z, opts = {}) {
    const color = opts.color ?? 0xffffff;
    const opacity = opts.opacity ?? 1;
    const key = tex.uuid + '|' + color + '|' + opacity;
    let mat = this._decalMats.get(key);
    if (!mat) {
      mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, color, opacity });
      this._decalMats.set(key, mat);
    }
    const geom = new THREE.PlaneGeometry(w, h);
    if (!opts.vertical) {
      geom.rotateX(-Math.PI / 2); // lies flat, texture-top pointing −Z (readable from spawn)
      if (opts.rotY) geom.rotateY(opts.rotY);
    }
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(x, y, z);
    mesh.renderOrder = 2;
    mesh.castShadow = false;
    this.ctx.scene.add(mesh);
    return mesh;
  }

  /** Wall-runnable wall: tinted body + pulsing edge strips, wallrun collider. */
  _wallrunWall(x0, x1, y0, y1, z0, z1) {
    this._box('wallrun', x0, x1, y0, y1, z0, z1, { wallrun: true });
    // pulsing top strip + vertical end strips → reads instantly as wall-run
    this._box('pulse', x0 - 0.04, x1 + 0.04, y1, y1 + 0.09, z0, z1);
    this._box('pulse', x0 - 0.04, x1 + 0.04, y0, y1, z0 - 0.04, z0 + 0.06);
    this._box('pulse', x0 - 0.04, x1 + 0.04, y0, y1, z1 - 0.06, z1 + 0.04);
  }

  // ==========================================================================
  // sky / lights
  // ==========================================================================

  _buildSky() {
    const geom = new THREE.SphereGeometry(430, 32, 16);
    const mat = new THREE.MeshBasicMaterial({
      map: this.tex.sky,
      side: THREE.BackSide,
      fog: false,
      depthWrite: false,
    });
    const sky = new THREE.Mesh(geom, mat);
    sky.frustumCulled = false;
    this.ctx.scene.add(sky);
  }

  _buildLights() {
    const scene = this.ctx.scene;

    this.hemi = new THREE.HemisphereLight(0x36506c, 0x10141b, 0.7);
    scene.add(this.hemi);

    this.key = new THREE.DirectionalLight(0xcfe0ff, 2.0);
    this.key.position.set(16, 58, -6);
    this.key.target.position.set(0, 0, -32);
    this.key.castShadow = true;
    const sc = this.key.shadow.camera;
    sc.left = -36; sc.right = 36; sc.top = 36; sc.bottom = -36;
    sc.near = 10; sc.far = 130;
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.bias = -0.00035;
    this.key.shadow.normalBias = 0.025;
    scene.add(this.key);
    scene.add(this.key.target);

    this.fill = new THREE.DirectionalLight(0x2a4a66, 0.45);
    this.fill.position.set(-40, 30, -70);
    scene.add(this.fill);

    // emissive-matched accent point lights (≤6)
    const pts = [
      [0x7df9ff, 9, 14, 2.2, 2.0, 6.3],     // console
      [0xbfe9ff, 26, 55, 0, 7.4, -40],      // mid-gallery
      [0xff5fd2, 20, 40, 22.5, 5.4, -25],   // moving bay
      [0xffa040, 26, 70, 36, 10, -45],      // movement course
      [0xcfe0ff, 10, 22, -30, 3.4, 7],      // cqc room
    ];
    for (const [c, i, d, x, y, z] of pts) {
      const l = new THREE.PointLight(c, i, d, 1.8);
      l.position.set(x, y, z);
      scene.add(l);
      this._accentLights.push({ light: l, base: i });
    }
  }

  // ==========================================================================
  // shell: floors, ceilings, outer walls, colonnades, roof beams
  // ==========================================================================

  _buildShell() {
    const B = (...a) => this._box(...a);

    // ---- floor slabs (top y = 0) ----
    B('floor', -27, 15, -0.5, 0, -106, 13);   // hall (gallery + precision + corridor)
    B('floor', 15, 31, -0.5, 0, -46, 8);      // moving bay + concourse
    B('floor', 31, 46, -0.5, 0, -100, 8);     // course hall + return corridor
    B('floor', -43, -27, -0.5, 0, -5, 19);    // cqc west part
    B('floor', -27, -18, -0.5, 0, 13, 19);    // cqc east sliver

    // ---- hall ceilings (y 9) with central skylight x[-6,6] z[-98,-4] ----
    B('ceil', -27, -6, 9, 9.8, -106, 13);
    B('ceil', 6, 15, 9, 9.8, -106, 13);
    B('ceil', -6, 6, 9, 9.8, -106, -98);
    B('ceil', -6, 6, 9, 9.8, -4, 13);
    // skylight rim glow
    this._box('trimCyan', -6.12, -6, 8.86, 8.98, -98, -4);
    this._box('trimCyan', 6, 6.12, 8.86, 8.98, -98, -4);

    // ---- bay + concourse ceiling (y 7) ----
    B('ceil', 15, 31, 7, 7.8, -46, 8);

    // ---- course ceiling (y 14) with skylight x[33,39.2] z[-92,-8] ----
    B('ceil', 30, 33, 14, 14.8, -100, 8);
    B('ceil', 39.2, 46, 14, 14.8, -100, 8);
    B('ceil', 33, 39.2, 14, 14.8, -100, -92);
    B('ceil', 33, 39.2, 14, 14.8, -8, 8);
    this._box('trimOrange', 33, 33.12, 13.86, 13.98, -92, -8);
    this._box('trimOrange', 39.08, 39.2, 13.86, 13.98, -92, -8);

    // ---- cqc ceiling (y 4.2) + corridor ceiling (y 3) ----
    B('ceil', -43, -18, 4.2, 4.9, -5, 19);
    B('ceil', -18, -14.5, 3, 3.6, 3.4, 7.6);

    // ---- gallery outer walls ----
    B('wall', -15, 15, 0, 9, 12, 13);                 // south (behind spawn)
    B('metalDark', -27, 15, 0, 9, -106, -105);        // north backstop (downrange)
    B('wall', -27, -26, 0, 9, -106, 3);               // west outer (precision side)
    B('wall', -26, -15, 0, 9, 2, 3);                  // precision south wall

    // backstop hazard chevrons
    this._decal(this.tex.hazard, 12, 3.2, 0, 2.4, -104.93, { vertical: true });
    this._decal(this.tex.hazard, 7, 2.4, -20.5, 2.0, -104.93, { vertical: true });

    // ---- west colonnade (gallery ↔ precision divider, x[-15,-14]) ----
    for (const z of [-101, -88, -75, -62, -49, -36, -23, -10]) {
      B('wall', -15, -14, 0, 9, z - 0.6, z + 0.6);
    }
    const westLow = [
      [-105, -101.6], [-100.4, -88.6], [-87.4, -75.6], [-74.4, -62.6],
      [-61.4, -49.6], [-48.4, -36.6], [-35.4, -23.6], [-22.4, -10.6],
      [-9.4, -3], [0, 2], // walk gap z[-3,0]
    ];
    for (const [a, b] of westLow) B('wall', -14.92, -14.08, 0, 1.1, a, b);
    B('wall', -14.98, -14.02, 7, 9, -105, 2); // header

    // ---- gallery west wall z[2,12] with CQC-corridor doorway z[4.2,6.8] ----
    B('wall', -15, -14, 0, 9, 2, 4.2);
    B('wall', -15, -14, 2.6, 9, 4.2, 6.8);    // lintel (door 2.6 high)
    B('wall', -15, -14, 0, 9, 6.8, 12);
    // door jambs
    this._box('trimCyan', -14.6, -14.35, 0, 2.7, 4.14, 4.24);
    this._box('trimCyan', -14.6, -14.35, 0, 2.7, 6.76, 6.86);

    // ---- gallery east wall (x[14,15]) ----
    B('wall', 14, 15, 0, 9, -105, -45);       // solid past the bay
    // bay colonnade z[-45,-5]: columns + low walls + 2 door gaps
    for (const [a, b] of [[-45, -43.8], [-36, -34.8], [-27, -25.8], [-18, -16.8], [-6.2, -5]]) {
      B('wall', 14, 15, 0, 9, a, b);
    }
    for (const [a, b] of [[-43.8, -36], [-34.8, -32], [-29, -27], [-25.8, -18], [-16.8, -13], [-10, -6.2]]) {
      B('wall', 14.08, 14.92, 0, 1.1, a, b);  // door gaps at z[-32,-29] and z[-13,-10]
    }
    B('wall', 14.02, 14.98, 6.5, 9, -45, -5); // header
    // magenta jambs on the bay door gaps
    for (const z of [-32, -29, -13, -10]) {
      this._box('trimMagenta', 14.35, 14.65, 0, 3.2, z - 0.05, z + 0.05);
    }
    B('wall', 14, 15, 0, 9, -5, -2);
    B('wall', 14, 15, 3.5, 9, -2, 5);         // big concourse opening z[-2,5], 3.5 high
    B('wall', 14, 15, 0, 9, 5, 12);
    this._box('trimOrange', 14.35, 14.65, 0, 3.6, -2.1, -2.0);
    this._box('trimOrange', 14.35, 14.65, 0, 3.6, 5.0, 5.1);

    // ---- gallery roof beams ----
    for (const z of [-95, -75, -55, -35, -15]) {
      B('metalDark', -14.5, 14.5, 8.45, 9, z - 0.3, z + 0.3);
    }
    // ceiling light strips
    this._box('trimWhite', -10.5, -9.5, 8.85, 8.95, -100, 0);
    this._box('trimWhite', 9.5, 10.5, 8.85, 8.95, -100, 0);

    // ---- moving bay shell ----
    B('wall', 15, 20, 0, 7, -5, -4);          // north wall w/ doorway x[20,23]
    B('wall', 20, 23, 2.8, 7, -5, -4);
    B('wall', 23, 31, 0, 7, -5, -4);
    B('wall', 15, 31, 0, 7, -46, -45);        // south wall
    B('wall', 30, 31, 0, 14, -99, -4);        // east wall, shared with course hall
    B('wall', 30, 31, 7, 14, -4, 8);          // fascia over the concourse→course pass
    for (const z of [-35, -15]) {
      B('metalDark', 15.1, 29.9, 6.5, 7, z - 0.25, z + 0.25); // bay roof beams
    }
    this._box('trimMagenta', 29.9, 30.02, 5.0, 5.12, -45, -5);  // bay accent strips
    this._box('trimMagenta', 15.1, 29.9, 6.9, 7.0, -45.1, -45.0);
    this._box('trimWhite', 21, 22, 6.9, 7.0, -44, -6);

    // ---- concourse south wall ----
    B('wall', 15, 31, 0, 7, 7, 8);
    B('wall', 31, 46, 0, 14, 7, 8);

    // ---- course hall shell ----
    B('wall', 30, 46, 0, 14, -100, -99);      // north wall
    B('wall', 45, 46, 0, 14, -100, 8);        // east outer wall
    // divider between main lane and return corridor, x[41.2,42], door z[-97,-94]
    B('wall', 41.2, 42, 0, 6, -99, -97);
    B('wall', 41.2, 42, 3, 6, -97, -94);      // lintel (door 3 high)
    B('wall', 41.2, 42, 0, 6, -94, 2);
    for (const z of [-80, -55, -30, -5]) {
      B('metalDark', 31.1, 44.9, 13.4, 14, z - 0.35, z + 0.35); // course roof beams
    }
    // course accent strips
    this._box('trimOrange', 30.98, 31.08, 9.8, 9.95, -99, -4);
    this._box('trimOrange', 41.12, 41.22, 5.9, 6.02, -99, 2);
    this._box('trimWhite', 44.92, 45.02, 3.0, 3.12, -99, 7);    // return corridor guide
  }

  // ==========================================================================
  // main gallery contents
  // ==========================================================================

  _buildGallery() {
    const B = (...a) => this._box(...a);
    const T = this.tex;

    // firing-line desks (low, shoot-over) with a walk gap at x[-1.3,1.3]
    for (const [x0, x1] of [[-11, -1.3], [1.3, 11]]) {
      B('metalDark', x0, x1, 0, 1.05, -0.35, 0.55);
      this._box('trimCyan', x0, x1, 1.05, 1.09, -0.35, -0.27);
    }

    // glowing distance lines + painted numerals at 5/10/25/50/100 m
    for (const d of [5, 10, 25, 50, 100]) {
      this._box('trimCyan', -14, 14, 0.01, 0.035, -d - 0.09, -d + 0.09);
      this._decal(T.numerals[d], 2.6, 1.5, -10.6, 0.05, -d + 2.1);
      this._decal(T.numerals[d], 2.6, 1.5, 10.6, 0.05, -d + 2.1);
    }
    // longitudinal lane lines
    for (const x of [-12, -6, 6, 12]) {
      this._box('trimCyan', x - 0.03, x + 0.03, 0.01, 0.03, -100, -2);
    }

    // gallery target anchors: 2 per distance, some elevated on platforms
    const gal = [
      [-5, 0, -5, 5], [5, 0, -5, 5],
      [-8, 0, -10, 10], [2, 0, -10, 10],
      [-4, 0, -25, 25], [8, 1.6, -25, 25],
      [-9, 0, -50, 50], [0, 2.2, -50, 50],
      [-6, 0, -100, 100], [6, 1.2, -100, 100],
    ];
    for (const [x, y, z, dist] of gal) {
      this.anchors.gallery.push({ pos: V(x, y, z), dist });
      this._decal(T.pad, 1.4, 1.4, x, y + 0.045, z, { color: 0x7df9ff, opacity: 0.8 });
    }
    // elevated target platforms (metal, with colliders + edge glow)
    const plats = [
      [6.8, 9.2, 1.6, -26.2, -23.8],
      [-1.3, 1.3, 2.2, -51.3, -48.7],
      [4.9, 7.1, 1.2, -101.1, -98.9],
    ];
    for (const [x0, x1, h, z0, z1] of plats) {
      B('metal', x0, x1, 0, h, z0, z1);
      this._box('trimCyan', x0, x1, h, h + 0.04, z1 - 0.08, z1 + 0.02);
    }

    // DPS dummy pad (clear spot ~15 m out)
    this._decal(T.pad, 1.8, 1.8, 8, 0.045, -15, { color: 0xffa040, opacity: 0.9 });
    // spawn pad
    this._decal(T.pad, 1.6, 1.6, 0, 0.045, 9, { color: 0x7df9ff, opacity: 0.6 });

    // skirting accents on the south wall
    this._box('trimCyan', -14.5, 14.5, 0.1, 0.18, 11.9, 12.02);
  }

  // ==========================================================================
  // precision wing
  // ==========================================================================

  _buildPrecision() {
    const B = (...a) => this._box(...a);

    // precision firing desk at z≈0 with central walk gap
    for (const [x0, x1] of [[-24.4, -21.2], [-19.8, -16.6]]) {
      B('metalDark', x0, x1, 0, 1.05, -0.35, 0.55);
      this._box('trimCyan', x0, x1, 1.05, 1.09, -0.35, -0.27);
    }

    // 6 bullseye boards 40–100 m, mounted on thin posts (smaller with range)
    const boards = [
      [-22.5, 1.7, -40, 0.6],
      [-18.5, 1.5, -52, 0.5],
      [-21.0, 1.8, -64, 0.45],
      [-19.0, 1.4, -76, 0.4],
      [-23.0, 1.9, -88, 0.34],
      [-20.5, 1.6, -100, 0.3],
    ];
    for (const [x, y, z, size] of boards) {
      this.anchors.precision.push({ pos: V(x, y, z), size });
      B('metalDark', x - 0.07, x + 0.07, 0, y - size - 0.06, z - 0.07, z + 0.07);
    }

    // distance tick lines across the wing at board ranges
    for (const z of [-40, -52, -64, -76, -88, -100]) {
      this._box('trimCyan', -26, -15.5, 0.01, 0.03, z - 0.05, z + 0.05);
    }
  }

  // ==========================================================================
  // moving-target bay
  // ==========================================================================

  _buildBay() {
    const B = (...a) => this._box(...a);
    const T = this.tex;

    // 3 horizontal ping-pong rails (visible track beams, varied depth/height)
    const rails = [
      // [beamX0, beamX1, beamY0, beamY1, z, fromX, toX, rideY, period]
      [16.6, 27.4, 0, 0.15, -12, 17, 27, 1.4, 5.5],
      [17.3, 28.7, 1.85, 2.0, -22, 18, 28, 2.5, 7.0],   // elevated rail on posts
      [16.6, 25.4, 0, 0.15, -33, 17, 25, 1.0, 4.5],
    ];
    for (const [bx0, bx1, by0, by1, z, fx, tx, ry, period] of rails) {
      B('metalDark', bx0, bx1, by0, by1, z - 0.15, z + 0.15);
      this._box('trimMagenta', bx0, bx1, by1, by1 + 0.04, z - 0.05, z + 0.05);
      this.anchors.movingH.push({ from: V(fx, ry, z), to: V(tx, ry, z), period });
    }
    // posts for the elevated rail
    B('metalDark', 17.3, 17.7, 0, 1.85, -22.2, -21.8);
    B('metalDark', 28.3, 28.7, 0, 1.85, -22.2, -21.8);

    // 2 vertical riser shafts against the east wall
    for (const [z, period] of [[-14, 3.2], [-30, 4.4]]) {
      B('metalDark', 28.45, 28.75, 0, 4.4, z - 1.05, z - 0.75);
      B('metalDark', 28.45, 28.75, 0, 4.4, z + 0.75, z + 1.05);
      B('metalDark', 28.45, 28.75, 4.25, 4.4, z - 1.05, z + 1.05);
      this._box('trimMagenta', 28.72, 28.78, 0.1, 4.25, z - 0.98, z - 0.92);
      this._box('trimMagenta', 28.72, 28.78, 0.1, 4.25, z + 0.92, z + 0.98);
      this.anchors.movingV.push({ from: V(28.6, 0.8, z), to: V(28.6, 3.6, z), period });
    }

    // 2 circle-strafer areas (floor ring markings)
    const circles = [
      [20.5, -18, 2.2, 5.0],
      [23.0, -38, 2.8, 6.8],
    ];
    for (const [x, z, radius, period] of circles) {
      this._decal(T.ring, radius * 2, radius * 2, x, 0.045, z, { color: 0xff5fd2, opacity: 0.85 });
      this.anchors.movingC.push({ center: V(x, 1.2, z), radius, period });
    }

    // 2 peeker cover walls (target hides behind/below, pops up exposed)
    const peekers = [
      [19, -42, 1.4, 2.2],
      [26, -9, 1.9, 2.7],
    ];
    for (const [x, z, upTime, downTime] of peekers) {
      B('metal', x - 0.9, x + 0.9, 0, 1.3, z - 0.15, z + 0.15);
      this._box('trimMagenta', x - 0.9, x + 0.9, 1.3, 1.36, z - 0.1, z + 0.1);
      this.anchors.peekers.push({
        pos: V(x, 1.55, z - 0.6),
        hidePos: V(x, 0.3, z - 0.6),
        upTime, downTime,
      });
    }
  }

  // ==========================================================================
  // CQC room (tight corridors + doorways) and its approach corridor
  // ==========================================================================

  _buildCqc() {
    const B = (...a) => this._box(...a);
    const H = 4.2; // room height

    // approach corridor x[-18,-15], z[4.2,6.8] (gallery doorway already cut)
    B('wall', -18, -15, 0, 3, 3.4, 4.2);
    B('wall', -18, -15, 0, 3, 6.8, 7.6);

    // outer walls
    B('wall', -19, -18, 0, H, -4, 4.2);       // east wall w/ doorway z[4.2,6.8]
    B('wall', -19, -18, 2.6, H, 4.2, 6.8);
    B('wall', -19, -18, 0, H, 6.8, 18);
    B('wall', -42, -41, 0, H, -4, 18);        // west
    B('wall', -42, -18, 0, H, -4, -3);        // north
    B('wall', -42, -18, 0, H, 17, 18);        // south

    // internal divider V1 (x≈-27.15) with two doorways
    B('wall', -27.3, -27, 0, H, -3, 0.5);
    B('wall', -27.3, -27, 2.6, H, 0.5, 2.9);  // door 1
    B('wall', -27.3, -27, 0, H, 2.9, 11);
    B('wall', -27.3, -27, 2.6, H, 11, 13.4);  // door 2
    B('wall', -27.3, -27, 0, H, 13.4, 17);

    // internal divider H1 (z≈7) with doorway x[-35.6,-33.2]
    B('wall', -41, -35.6, 0, H, 6.85, 7.15);
    B('wall', -35.6, -33.2, 2.6, H, 6.85, 7.15);
    B('wall', -33.2, -27.3, 0, H, 6.85, 7.15);

    // stub wall shaping the entry corridor + cover crates
    B('wall', -23.8, -23.5, 0, H, 1, 8);
    B('metal', -21.7, -20.7, 0, 1.0, 8.7, 9.7);
    B('metal', -32, -31, 0, 1.1, 12.3, 13.3);

    // cyan skirting + doorway jambs
    this._box('trimCyan', -40.9, -28, 0.1, 0.16, -2.9, -2.82);
    this._box('trimCyan', -18.98, -18.9, 0.1, 0.16, -3, 17);
    for (const [z0, z1] of [[0.5, 2.9], [11, 13.4]]) {
      this._box('trimCyan', -27.35, -26.95, 2.6, 2.68, z0, z1);
    }

    // 8 close-quarters anchors, 3–10 m apart
    const spots = [
      [-21.5, 0.5], [-24.5, 7.5], [-20.5, 13.5], [-30.5, 1.5],
      [-38.5, 4.0], [-30.5, 10.0], [-38.5, 14.5], [-33.5, 12.5],
    ];
    for (const [x, z] of spots) {
      this.anchors.cqc.push({ pos: V(x, 0, z) });
      this._decal(this.tex.pad, 1.1, 1.1, x, 0.045, z, { color: 0x7df9ff, opacity: 0.5 });
    }
  }

  // ==========================================================================
  // movement course (flow: entry ramp → start plate → slide ramp down →
  // slide-under gap → wallrun pair 1 → wall-jump gap → wallrun pair 2 →
  // wall-jump ascent → 6 m ledge → air-strafe pillar weave → finish →
  // return corridor back to start)
  // ==========================================================================

  _buildCourse() {
    const B = (...a) => this._box(...a);
    const X0 = 31, X1 = 41.2, CX = (X0 + X1) / 2; // main lane bounds / center

    // start platform (top y=2.5) + entry ramp up from the concourse
    B('metal', X0, X1, 0, 2.5, -4.5, 1.5);
    this._wedge('metal', 32, 37, 1.5, 6.5, 2.5, 0);   // walk-up ramp
    this._box('trimOrange', 33.6, 38.6, 2.51, 2.54, -3.5, -0.5); // start plate
    this._box('trimOrange', X0, X1, 2.5, 2.56, -4.56, -4.44);    // ramp lip

    // slide ramp down (orange tinted, heightfield collider via addRamp)
    this._wedge('ramp', X0, X1, -14.5, -4.5, 0, 2.5);
    // hazard edge strips along the slope (visual only, rotated to match)
    const slopeLen = Math.hypot(10, 2.5);
    const slopeAng = Math.atan2(2.5, 10);
    for (const x of [X0 + 0.4, X1 - 0.4]) {
      const strip = new THREE.Mesh(
        new THREE.BoxGeometry(0.18, 0.05, slopeLen),
        this.mats.trimOrange,
      );
      strip.position.set(x, 1.28, -9.5);
      strip.rotation.x = -slopeAng;
      this.ctx.scene.add(strip);
    }
    // hazard paint at the ramp foot and before the slide-under
    this._decal(this.tex.hazard, 10, 1.1, CX, 0.04, -15.2, { opacity: 0.9 });
    this._decal(this.tex.hazard, 10, 1.1, CX, 0.04, -16.6, { opacity: 0.9 });

    // slide-under obstacle: clearance 1.3 under a hazard-striped beam
    B('hazard', X0, X1, 1.3, 3.8, -18.8, -17.4);
    this._box('trimOrange', X0, X1, 1.3, 1.36, -18.86, -18.8);

    // wallrun pairs: inner faces 4 m apart, 14 m long, 4 m tall,
    // 6 m wall-jump gap between the pairs
    for (const [z0, z1] of [[-38, -24], [-58, -44]]) {
      this._wallrunWall(33.6, 34.1, 0, 4, z0, z1);
      this._wallrunWall(38.1, 38.6, 0, 4, z0, z1);
    }

    // wall-jump ascent: 3 staggered walls climbing to the 6 m ledge
    this._wallrunWall(33.2, 33.7, 0, 4.2, -67, -63);
    this._wallrunWall(37.5, 38.0, 0, 5.4, -69, -65);
    this._wallrunWall(33.2, 33.7, 0, 6.2, -70, -67.4);

    // the 6 m ledge
    B('metal', X0, X1, 0, 6, -77.5, -70);
    this._box('trimOrange', X0, X1, 6.0, 6.06, -70.12, -70.0);

    // air-strafe pillar weave (5 pillars, launch off the ledge)
    const pillars = [
      [33.8, -80], [38.4, -83.2], [33.8, -86.4], [38.4, -89.6], [CX, -92.8],
    ];
    for (const [x, z] of pillars) {
      B('metal', x - 0.45, x + 0.45, 0, 13, z - 0.45, z + 0.45);
      this._box('trimOrange', x - 0.49, x + 0.49, 2.6, 2.75, z - 0.49, z + 0.49);
    }

    // finish plate + center guide line
    this._box('trimOrange', 33.6, 38.6, 0.01, 0.04, -97.5, -94.5);
    this._box('trimOrange', CX - 0.06, CX + 0.06, 0.01, 0.03, -94.5, -19);

    // course anchors
    this.anchors.course.start = { pos: V(CX, 2.5, -2), size: V(9, 4, 5) };
    this.anchors.course.finish = { pos: V(CX, 0, -96), size: V(9, 4, 6) };
    this.anchors.course.gates = [
      { pos: V(CX, 2.6, -10), radius: 1.1 },   // over the slide ramp
      { pos: V(CX, 3.4, -41), radius: 1.1 },   // in the wall-jump gap
      { pos: V(35.6, 7.0, -73.5), radius: 1.2 }, // above the ledge
      { pos: V(CX, 3.0, -88), radius: 1.1 },   // mid pillar weave
    ];
    for (const g of this.anchors.course.gates) {
      this._decal(this.tex.pad, 1.2, 1.2, g.pos.x, 0.048, g.pos.z, { color: 0xffa040, opacity: 0.55 });
    }
  }

  // ==========================================================================
  // control console podium (E to open range menu)
  // ==========================================================================

  _buildConsole() {
    const g = new THREE.Group();
    g.position.set(2.2, 0, 6.5);
    g.rotation.y = -0.12;

    const add = (mesh) => {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.surface = 'metal';
      g.add(mesh);
      this.solidMeshes.push(mesh);
    };

    const base = new THREE.Mesh(new THREE.BoxGeometry(0.95, 1.0, 0.55), this.mats.metalDark);
    base.position.y = 0.5;
    add(base);

    const neck = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.34, 0.18), this.mats.metalDark);
    neck.position.set(0, 1.12, -0.06);
    add(neck);

    const screenPivot = new THREE.Group();
    screenPivot.position.set(0, 1.32, 0);
    screenPivot.rotation.x = -0.55; // angled up toward the player
    g.add(screenPivot);

    const back = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.58, 0.06), this.mats.metalDark);
    back.castShadow = true;
    back.userData.surface = 'metal';
    screenPivot.add(back);
    this.solidMeshes.push(back);

    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(0.84, 0.52),
      new THREE.MeshBasicMaterial({ map: this.tex.console }),
    );
    face.position.z = 0.035;
    face.userData.surface = 'metal';
    screenPivot.add(face);
    this.solidMeshes.push(face);

    const trim = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.05, 0.03), this.mats.trimCyan);
    trim.position.set(0, 0.98, 0.28);
    g.add(trim);

    this.ctx.scene.add(g);
    this.consoleMesh = g;
    this.colliders.addBox(V(1.65, 0, 5.9), V(2.75, 1.65, 7.1), { surface: 'metal' });
  }

  // ==========================================================================
  // tunables (contract §8)
  // ==========================================================================

  _registerTunables() {
    const T = this.ctx.tunables;
    const fog = this.ctx.scene.fog;
    T.push({ cat: 'world', key: 'fogNear', obj: fog, prop: 'near', min: 5, max: 80, step: 1 });
    T.push({ cat: 'world', key: 'fogFar', obj: fog, prop: 'far', min: 60, max: 400, step: 5 });
    T.push({ cat: 'world', key: 'keyLight', obj: this.key, prop: 'intensity', min: 0, max: 5, step: 0.05 });
    T.push({ cat: 'world', key: 'hemiLight', obj: this.hemi, prop: 'intensity', min: 0, max: 2.5, step: 0.05 });
    T.push({ cat: 'world', key: 'fillLight', obj: this.fill, prop: 'intensity', min: 0, max: 2, step: 0.05 });
    T.push({ cat: 'world', key: 'accentPulseHz', obj: this._uPulseSpeed, prop: 'value', min: 0, max: 8, step: 0.1 });
    T.push({ cat: 'world', key: 'accentPulseDepth', obj: this._uPulseDepth, prop: 'value', min: 0, max: 1, step: 0.02 });
    T.push({
      cat: 'world', key: 'accentLights',
      get: () => this._accentScale,
      set: (v) => {
        this._accentScale = v;
        for (const { light, base } of this._accentLights) light.intensity = base * v;
      },
      min: 0, max: 3, step: 0.05,
    });
  }
}
