// TOWER DEFENSE — TDWorld.js: the code-built TD arena.
// A canyon plateau: enemies spawn at the PORTAL, follow the winding PATH ribbon
// to the CORE TOWER. Buildable ground flanks the path. Exposes the same world
// interfaces the RANGE mode provides (colliders {aabbs,ramps}, range
// {spawnPoint,spawnYaw,solidMeshes,...}) so the player controller + every gun
// works unchanged. No custom-map support by design.
import * as THREE from 'three';

export const PATH = [
  { x: -46, z: -34 }, { x: -30, z: -34 }, { x: -30, z: -10 }, { x: -6, z: -10 },
  { x: -6, z: -30 }, { x: 18, z: -30 }, { x: 18, z: 2 }, { x: -14, z: 2 },
  { x: -14, z: 22 }, { x: 12, z: 22 }, { x: 12, z: 38 }, { x: 38, z: 38 },
];
export const CORE_POS = { x: 42, y: 0, z: 38 };
export const PATH_W = 4;      // ribbon width (no building ON the path)
export const GROUND_Y = 0;

// world-pos → param along the polyline (for spacing/aura math) + path length
export function pathLength() {
  let L = 0;
  for (let i = 1; i < PATH.length; i++) L += Math.hypot(PATH[i].x - PATH[i - 1].x, PATH[i].z - PATH[i - 1].z);
  return L;
}
export function pointAt(dist) {
  let d = dist;
  for (let i = 1; i < PATH.length; i++) {
    const a = PATH[i - 1], b = PATH[i];
    const seg = Math.hypot(b.x - a.x, b.z - a.z);
    if (d <= seg) { const t = d / seg; return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, dirX: (b.x - a.x) / seg, dirZ: (b.z - a.z) / seg }; }
    d -= seg;
  }
  const a = PATH[PATH.length - 2], b = PATH[PATH.length - 1];
  const seg = Math.hypot(b.x - a.x, b.z - a.z);
  return { x: b.x, z: b.z, dirX: (b.x - a.x) / seg, dirZ: (b.z - a.z) / seg };
}
export function distToPath(x, z) {
  let best = Infinity;
  for (let i = 1; i < PATH.length; i++) {
    const a = PATH[i - 1], b = PATH[i];
    const abx = b.x - a.x, abz = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((x - a.x) * abx + (z - a.z) * abz) / (abx * abx + abz * abz)));
    best = Math.min(best, Math.hypot(x - (a.x + abx * t), z - (a.z + abz * t)));
  }
  return best;
}

export class TDWorld {
  constructor(ctx) {
    this.ctx = ctx;
    this.group = new THREE.Group();
    ctx.scene.add(this.group);
    this.solidMeshes = [];
    this.aabbs = [];
    this.ramps = [];
    this._mats = new Map();
    this._build();
    // world interfaces the reused systems read
    this.colliders = { aabbs: this.aabbs, ramps: this.ramps };
    this.range = {
      spawnPoint: new THREE.Vector3(30, GROUND_Y, 24), spawnYaw: 140,
      consoleMesh: null, anchors: {}, solidMeshes: this.solidMeshes,
    };
    this.course = { running: false, currentTime: 0, bestTime: null, reset() {}, fixedUpdate() {} };
  }

  _mat(key, color, opts = {}) {
    let m = this._mats.get(key);
    if (m) return m;
    m = new THREE.MeshStandardMaterial({ color, roughness: opts.rough ?? 0.85, metalness: opts.metal ?? 0.1 });
    if (opts.emissive) { m.emissive = new THREE.Color(opts.emissive); m.emissiveIntensity = opts.emissiveI ?? 0.6; }
    this._mats.set(key, m);
    return m;
  }

  _solid(x0, y0, z0, x1, y1, z1, mat, opts = {}) {
    const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
    const m = new THREE.Mesh(g, mat);
    m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    m.castShadow = !!opts.shadow; m.receiveShadow = true;
    this.group.add(m);
    this.solidMeshes.push(m);
    if (!opts.noCollide) this.aabbs.push({ min: { x: x0, y: y0, z: z0 }, max: { x: x1, y: y1, z: z1 }, ...(opts.wallrun ? { wallrun: true } : {}) });
    return m;
  }

  _build() {
    const S = 62; // half-extent
    // sky + fog + lights (dusk canyon)
    this.ctx.scene.fog = new THREE.Fog(0x1a1410, 60, 240);
    this.ctx.scene.background = new THREE.Color(0x241a12);
    const key = new THREE.DirectionalLight(0xffc9a0, 1.7);
    key.position.set(40, 60, -30); key.castShadow = true;
    key.shadow.camera.left = -70; key.shadow.camera.right = 70; key.shadow.camera.top = 70; key.shadow.camera.bottom = -70;
    this.group.add(key);
    this.group.add(new THREE.HemisphereLight(0x8a6a4a, 0x241a12, 1.1));
    this.group.add(new THREE.AmbientLight(0x6a5240, 0.55));

    // ground plateau
    this._solid(-S, -1, -S, S, GROUND_Y, S, this._mat('gnd', 0x4a4034));
    // rim walls (playable bounds; wall-runnable for fun)
    const wallMat = this._mat('wall', 0x3a3028);
    this._solid(-S, 0, -S - 2, S, 9, -S, wallMat, { wallrun: true, shadow: true });
    this._solid(-S, 0, S, S, 9, S + 2, wallMat, { wallrun: true, shadow: true });
    this._solid(-S - 2, 0, -S, -S, 9, S, wallMat, { wallrun: true, shadow: true });
    this._solid(S, 0, -S, S + 2, 9, S, wallMat, { wallrun: true, shadow: true });

    // PATH ribbon (visual, no collider — flush on the ground)
    const pathMat = this._mat('path', 0x2a2320, { rough: 0.95 });
    const edgeMat = this._mat('pathe', 0x120d0a, { emissive: 0x9fe86a, emissiveI: 0.35 });
    for (let i = 1; i < PATH.length; i++) {
      const a = PATH[i - 1], b = PATH[i];
      const cx = (a.x + b.x) / 2, cz = (a.z + b.z) / 2;
      const lx = Math.abs(b.x - a.x), lz = Math.abs(b.z - a.z);
      const w = PATH_W;
      const g = new THREE.BoxGeometry(lx + (lx ? 0 : w), 0.06, lz + (lz ? 0 : w));
      const m = new THREE.Mesh(g, pathMat);
      m.position.set(cx, GROUND_Y + 0.03, cz); m.receiveShadow = true;
      this.group.add(m);
      // glowing lane edges
      for (const s of [-1, 1]) {
        const eg = lx
          ? new THREE.BoxGeometry(lx + w, 0.05, 0.16)
          : new THREE.BoxGeometry(0.16, 0.05, lz + w);
        const e = new THREE.Mesh(eg, edgeMat);
        e.position.set(cx + (lx ? 0 : s * (w / 2)), GROUND_Y + 0.05, cz + (lz ? 0 : 0));
        if (lx) e.position.z = cz + s * (w / 2);
        this.group.add(e);
      }
    }

    // PORTAL at path start (enemy spawn): jagged arch + sick green glow
    const p0 = PATH[0];
    const portMat = this._mat('portal', 0x1a2a14, { emissive: 0x66ff44, emissiveI: 1.4 });
    this._solid(p0.x - 3.4, 0, p0.z - 3.2, p0.x - 2.4, 7, p0.z + 3.2, this._mat('portF', 0x241a12), { shadow: true });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3, 0.35, 10, 24), portMat);
    ring.position.set(p0.x - 2.2, 3.4, p0.z); ring.rotation.y = Math.PI / 2;
    this.group.add(ring);
    this.portalGlow = ring;

    // CORE TOWER at path end
    const c = CORE_POS;
    const coreBase = this._mat('coreb', 0x2a3340, { metal: 0.6, rough: 0.4 });
    this._solid(c.x - 3, 0, c.z - 3, c.x + 3, 1.2, c.z + 3, coreBase, { shadow: true });
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.8, 7, 10), coreBase);
    pillar.position.set(c.x, 4.6, c.z); pillar.castShadow = true;
    this.group.add(pillar); this.solidMeshes.push(pillar);
    this.aabbs.push({ min: { x: c.x - 1.6, y: 1.2, z: c.z - 1.6 }, max: { x: c.x + 1.6, y: 8, z: c.z + 1.6 } });
    const heart = new THREE.Mesh(new THREE.OctahedronGeometry(1.5),
      new THREE.MeshStandardMaterial({ color: 0x18b6d8, emissive: 0x7df9ff, emissiveIntensity: 1.6, metalness: 0.4, roughness: 0.2 }));
    heart.position.set(c.x, 9.6, c.z);
    this.group.add(heart);
    this.coreHeart = heart;

    // scattered rocks/cover off-path (players wallrun/jump these while fighting)
    const rockMat = this._mat('rock', 0x554838);
    const rocks = [[-40, 10, 3], [-22, -24, 2.4], [4, 14, 2.8], [26, -14, 3.4], [34, 10, 2.2], [-2, 34, 2.6], [-34, 32, 3], [44, -30, 2.6]];
    for (const [x, z, s] of rocks) {
      const g = new THREE.IcosahedronGeometry(s, 0);
      g.scale(1, 0.72, 1);
      const m = new THREE.Mesh(g, rockMat);
      m.position.set(x, GROUND_Y + s * 0.34, z); m.castShadow = true; m.receiveShadow = true;
      this.group.add(m); this.solidMeshes.push(m);
      this.aabbs.push({ min: { x: x - s * 0.8, y: 0, z: z - s * 0.8 }, max: { x: x + s * 0.8, y: s * 0.75, z: z + s * 0.8 } });
    }
  }

  update(dt, t) {
    if (this.coreHeart) { this.coreHeart.rotation.y = t * 0.8; this.coreHeart.position.y = 9.6 + Math.sin(t * 1.4) * 0.25; }
    if (this.portalGlow) this.portalGlow.rotation.z = t * 0.5;
  }
}
