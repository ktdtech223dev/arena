// ARENA — src/world/MapEnv.js
// Base class for a BESPOKE map environment. Each map is its own subclass that
// builds a complete, code-built PLACE (real architecture, surroundings, skybox,
// lighting, materials) in buildEnvironment(). This base provides only the shared
// machinery + perf-disciplined helpers so map authors can build rich spaces
// cheaply and consistently:
//   • a MERGED static batch (many boxes → a few draw calls per material)
//   • INSTANCING for repeated elements (railings, pillars, panels)
//   • cached procedural canvas textures + node materials (WebGPU/WebGL2)
//   • a code-built gradient skybox + a budgeted lighting rig
//   • default networked dynamic objects (doors/barrels/platforms/destructibles)
//     wired to the shared collider data + snapshot state
//   • a cheap self-owned ambient particle layer
//   • full dispose (frees geo/mats/textures/lights, restores scene fog/bg)
//
// COLLISION stays server-authoritative: the shared map DATA (solids/ramps/…) is
// the collision truth; the visuals here MATCH those bounds and add non-colliding
// architecture/detail/surroundings on top. Public API (used by MapRenderer):
//   constructor(ctx,data) · syncDynamic(state,t) · update(dt,t) · dispose() · resize()
import * as THREE from 'three';
import { MeshStandardNodeMaterial, MeshBasicNodeMaterial } from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { platformPos } from '../../shared/mapsim.js';

const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _e = new THREE.Euler();

export class MapEnv {
  constructor(ctx, data) {
    this.ctx = ctx;
    this.data = data;
    this.group = new THREE.Group();
    this.group.name = 'map:' + (data.id || '?');
    ctx.scene.add(this.group);

    this._geos = [];   // tracked geometries to dispose
    this._mats = new Map(); // key -> material (cached + tracked)
    this._texs = [];   // tracked textures
    this._lights = []; // tracked lights
    this._batch = new Map(); // matKey -> [geometry,…] (baked-transform static merge)
    this._doorH = {};  // id -> { mesh, base:{x,y,z}, off }
    this._barrelH = {}; // id -> mesh
    this._platH = [];  // { mesh, def }
    this._destrH = {}; // id -> { mesh, rubble }
    this._ambient = null;
    this._destroyedSeen = new Set();

    this._prevFog = ctx.scene.fog;
    this._prevBg = ctx.scene.background;

    // subclass builds the whole static world (may call sky()/fog()/light()/solid()…)
    this.buildEnvironment();
    this._flushBatch();
    this._buildDynamicObjects();
  }

  // ===== SUBCLASS OVERRIDES ===============================================
  buildEnvironment() { /* build architecture + surroundings + sky + lighting */ }
  updateEnv(dt, t) { /* optional per-frame animation */ }

  // ===== MATERIAL + TEXTURE HELPERS ======================================
  // Cache a node material by key. opts: { color, rough, metal, emissive, emissiveI,
  // map(texture), transparent, opacity, basic(bool), side, flat }
  material(key, opts = {}) {
    if (this._mats.has(key)) return this._mats.get(key);
    let mat;
    if (opts.basic) {
      mat = new MeshBasicNodeMaterial({ color: opts.color ?? 0xffffff });
      if (opts.map) mat.map = opts.map;
      if (opts.transparent) { mat.transparent = true; mat.opacity = opts.opacity ?? 1; }
      if (opts.additive) { mat.blending = THREE.AdditiveBlending; mat.depthWrite = false; }
      mat.toneMapped = opts.toneMapped ?? true;
    } else {
      mat = new MeshStandardNodeMaterial({
        color: opts.color ?? 0x888888,
        roughness: opts.rough ?? 0.85,
        metalness: opts.metal ?? 0.1,
      });
      if (opts.map) mat.map = opts.map;
      if (opts.emissive != null) { mat.emissive = new THREE.Color(opts.emissive); mat.emissiveIntensity = opts.emissiveI ?? 1; }
      if (opts.transparent) { mat.transparent = true; mat.opacity = opts.opacity ?? 1; }
      if (opts.flat) mat.flatShading = true;
    }
    if (opts.side) mat.side = opts.side;
    this._mats.set(key, mat);
    return mat;
  }

  // Cache a procedural canvas texture. drawFn(ctx2d, size). opts:{repeat,size}
  tex(key, drawFn, opts = {}) {
    const cacheKey = 'tex:' + key;
    if (this._mats.has(cacheKey)) return this._mats.get(cacheKey);
    const size = opts.size || 256;
    const c = document.createElement('canvas'); c.width = c.height = size;
    drawFn(c.getContext('2d'), size);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    if (opts.repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(opts.repeat[0], opts.repeat[1]); }
    this._texs.push(t);
    this._mats.set(cacheKey, t);
    return t;
  }

  // ===== STATIC GEOMETRY (merged for low draw calls) =====================
  // Queue an axis-aligned box into the merged batch for `matKey`.
  solid(x0, y0, z0, x1, y1, z1, matKey) {
    const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    this._queue(g, matKey);
  }
  // Queue an arbitrary geometry (already positioned) into the merged batch.
  addGeo(g, matKey) { this._queue(g, matKey); }
  _queue(g, matKey) {
    let arr = this._batch.get(matKey);
    if (!arr) this._batch.set(matKey, (arr = []));
    arr.push(g);
  }
  // A standalone mesh (not merged) — for a signature piece or a transformed geo.
  mesh(geometry, mat, opts = {}) {
    const m = new THREE.Mesh(geometry, typeof mat === 'string' ? this.material(mat) : mat);
    m.castShadow = !!opts.shadow;
    m.receiveShadow = opts.receive !== false;
    if (opts.pos) m.position.set(opts.pos.x, opts.pos.y, opts.pos.z);
    this._geos.push(geometry);
    this.group.add(m);
    return m;
  }
  // Instanced repeated element. transforms: [{pos,rot?,scale?}]
  instance(geometry, mat, transforms, opts = {}) {
    const inst = new THREE.InstancedMesh(geometry, typeof mat === 'string' ? this.material(mat) : mat, transforms.length);
    inst.castShadow = !!opts.shadow;
    inst.receiveShadow = opts.receive !== false;
    for (let i = 0; i < transforms.length; i++) {
      const t = transforms[i];
      _v.set(t.pos.x, t.pos.y, t.pos.z);
      _e.set(t.rot?.x || 0, t.rot?.y || 0, t.rot?.z || 0);
      _q.setFromEuler(_e);
      const s = t.scale || 1;
      _m4.compose(_v, _q, typeof s === 'number' ? { x: s, y: s, z: s } : s);
      inst.setMatrixAt(i, _m4);
    }
    inst.instanceMatrix.needsUpdate = true;
    inst.frustumCulled = opts.cull !== false;
    this._geos.push(geometry);
    this.group.add(inst);
    return inst;
  }

  _flushBatch() {
    for (const [matKey, geos] of this._batch) {
      if (!geos.length) continue;
      let merged;
      if (geos.length === 1) {
        merged = geos[0];
      } else {
        // mergeGeometries requires a UNIFORM index-state (and attribute set) across
        // inputs — but some primitives are non-indexed (IcosahedronGeometry et al.)
        // while Box/Cylinder/Torus are indexed. Mixing them makes it return null and
        // build a Mesh(null) that crashes the whole map load. De-index every geometry
        // first so the batch is always uniform + mergeable; never crash if it still
        // can't merge (fall back to skipping that batch).
        const norm = geos.map((g) => (g.index ? g.toNonIndexed() : g));
        try { merged = mergeGeometries(norm, false); } catch { merged = null; }
        for (let i = 0; i < geos.length; i++) { if (norm[i] !== geos[i]) norm[i].dispose?.(); geos[i].dispose?.(); }
        if (!merged) { console.warn('[MapEnv] batch merge failed, skipped:', matKey); continue; }
      }
      const mesh = new THREE.Mesh(merged, this.material(matKey));
      mesh.castShadow = matKey.startsWith('nocast') ? false : true;
      mesh.receiveShadow = true;
      this._geos.push(merged);
      this.group.add(mesh);
    }
    this._batch.clear();
  }

  // ===== SKY + LIGHTING + FOG ============================================
  sky(topHex, botHex, extra) {
    const geo = new THREE.SphereGeometry(400, 32, 16);
    const t = new THREE.Color(topHex), b = new THREE.Color(botHex);
    const mat = new THREE.MeshBasicMaterial({ side: THREE.BackSide, fog: false, depthWrite: false, vertexColors: true, toneMapped: false });
    const pos = geo.attributes.position, col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 400; // -1..1
      const f = Math.pow(Math.max(0, Math.min(1, (y + 1) / 2)), 0.7);
      const r = b.r + (t.r - b.r) * f, g = b.g + (t.g - b.g) * f, bl = b.b + (t.b - b.b) * f;
      col[i * 3] = r; col[i * 3 + 1] = g; col[i * 3 + 2] = bl;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const skyMesh = new THREE.Mesh(geo, mat);
    this._geos.push(geo); this._mats.set('__skymat', mat);
    this.group.add(skyMesh);
    this.ctx.scene.background = b.clone().multiplyScalar(0.6);
    if (extra) extra(this, skyMesh); // subclass adds stars/clouds/sun/aurora
    return skyMesh;
  }
  // A cheap starfield / speck layer as one Points-free instanced quad set.
  skySpecks(count, color, spread = 380, size = 1.2) {
    const g = new THREE.PlaneGeometry(size, size);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false });
    const inst = new THREE.InstancedMesh(g, mat, count);
    for (let i = 0; i < count; i++) {
      const th = hash(i * 2.13) * Math.PI * 2, ph = Math.acos(1 - hash(i * 7.7) * 1.3);
      const r = spread * (0.8 + hash(i * 3.3) * 0.2);
      _v.set(r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph) * 0.7 + 40, r * Math.sin(ph) * Math.sin(th));
      _q.identity(); const s = 0.4 + hash(i * 5.1) * 1.6;
      _m4.compose(_v, _q, { x: s, y: s, z: s });
      inst.setMatrixAt(i, _m4);
    }
    inst.frustumCulled = false;
    this._geos.push(g); this._mats.set('__speckmat', mat);
    this.group.add(inst);
    return inst;
  }
  fog(color, near, far) { this.ctx.scene.fog = new THREE.Fog(color, near, far); }
  // budgeted lights: type 'dir'|'point'|'hemi'|'ambient'
  light(type, opts = {}) {
    let L;
    if (type === 'dir') {
      L = new THREE.DirectionalLight(opts.color ?? 0xffffff, opts.intensity ?? 1);
      if (opts.dir) L.position.set(-opts.dir.x, -opts.dir.y, -opts.dir.z).multiplyScalar(40);
      else L.position.set(30, 60, 20);
      if (opts.shadow) {
        L.castShadow = true;
        L.shadow.mapSize.set(2048, 2048);
        const s = opts.shadowSize ?? 40;
        Object.assign(L.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: 200 });
        L.shadow.bias = -0.0004;
      }
    } else if (type === 'hemi') {
      L = new THREE.HemisphereLight(opts.sky ?? 0x8090a0, opts.ground ?? 0x202020, opts.intensity ?? 0.6);
    } else if (type === 'ambient') {
      L = new THREE.AmbientLight(opts.color ?? 0x404040, opts.intensity ?? 1);
    } else { // point
      L = new THREE.PointLight(opts.color ?? 0xffffff, opts.intensity ?? 1, opts.dist ?? 20, opts.decay ?? 2);
      if (opts.pos) L.position.set(opts.pos.x, opts.pos.y, opts.pos.z);
    }
    this._lights.push(L);
    this.group.add(L);
    return L;
  }

  // ===== AMBIENT PARTICLES (self-owned, cheap) ===========================
  // mode: 'embers'|'snow'|'dust'|'spores'|'motes'|'rain'. area:{x,y,z} half-extents around center.
  ambientParticles(mode, count, area = { x: 22, y: 14, z: 22 }, center = { x: 0, y: 7, z: 0 }, color) {
    count = Math.min(count, 260);
    const g = new THREE.PlaneGeometry(1, 1);
    const cols = { embers: 0xff7a2a, snow: 0xdff2ff, dust: 0xc8b48a, spores: 0x9fe86a, motes: 0x7df9ff, rain: 0x9fd0ff };
    const mat = new THREE.MeshBasicMaterial({ color: color ?? cols[mode] ?? 0xffffff, transparent: true, opacity: mode === 'rain' ? 0.35 : 0.8, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false });
    const inst = new THREE.InstancedMesh(g, mat, count);
    const seeds = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) { seeds[i * 3] = hash(i * 1.7); seeds[i * 3 + 1] = hash(i * 3.1); seeds[i * 3 + 2] = hash(i * 9.2); }
    this._geos.push(g); this._mats.set('__ambmat' + mode, mat);
    this._ambient = { inst, mode, count, area, center, seeds, size: mode === 'snow' ? 0.14 : mode === 'dust' ? 0.1 : 0.09 };
    inst.frustumCulled = false;
    this.group.add(inst);
    return inst;
  }
  _stepAmbient(t) {
    const A = this._ambient; if (!A) return;
    const { inst, mode, count, area, center, seeds, size } = A;
    const cam = this.ctx.camera;
    for (let i = 0; i < count; i++) {
      const sx = seeds[i * 3], sy = seeds[i * 3 + 1], sz = seeds[i * 3 + 2];
      let x, y, z;
      const rise = mode === 'embers' || mode === 'spores' || mode === 'motes';
      const fall = mode === 'snow' || mode === 'dust' || mode === 'rain';
      const speed = mode === 'rain' ? 14 : mode === 'snow' ? 1.2 : rise ? 0.8 : 0.6;
      let cyc = (t * speed / (area.y * 2) + sy);
      cyc -= Math.floor(cyc);
      y = center.y + (rise ? cyc * 2 - 1 : 1 - cyc * 2) * area.y;
      x = center.x + (sx * 2 - 1) * area.x + Math.sin(t * 0.5 + sx * 20) * (mode === 'rain' ? 0 : 0.6);
      z = center.z + (sz * 2 - 1) * area.z + Math.cos(t * 0.5 + sz * 20) * (mode === 'rain' ? 0 : 0.6);
      _v.set(x, y, z);
      if (cam) _q.copy(cam.quaternion); else _q.identity();
      const s = mode === 'rain' ? size * 6 : size;
      _m4.compose(_v, _q, mode === 'rain' ? { x: size * 0.3, y: s, z: 1 } : { x: s, y: s, z: s });
      inst.setMatrixAt(i, _m4);
    }
    inst.instanceMatrix.needsUpdate = true;
  }

  // ===== DYNAMIC NETWORKED OBJECTS (default visuals) =====================
  _buildDynamicObjects() {
    const d = this.data;
    // doors
    for (const dr of d.doors || []) {
      const g = new THREE.BoxGeometry(dr.max.x - dr.min.x, dr.max.y - dr.min.y, dr.max.z - dr.min.z);
      const m = new THREE.Mesh(g, this.material('__door', { color: 0x2a3038, metal: 0.7, rough: 0.4, emissive: 0x7df9ff, emissiveI: 0.15 }));
      m.position.set((dr.min.x + dr.max.x) / 2, (dr.min.y + dr.max.y) / 2, (dr.min.z + dr.max.z) / 2);
      m.castShadow = true; this._geos.push(g); this.group.add(m);
      this._doorH[dr.id] = { mesh: m, base: m.position.clone(), off: dr.openOffset || { x: 0, y: dr.max.y - dr.min.y, z: 0 } };
    }
    // barrels (red explosive)
    for (const b of d.barrels || []) {
      const g = new THREE.CylinderGeometry(0.42, 0.46, 1.08, 12);
      const m = new THREE.Mesh(g, this.material('__barrel', { color: 0xcc2a1a, metal: 0.5, rough: 0.5, emissive: 0xff4020, emissiveI: 0.35 }));
      m.position.set(b.pos.x, b.pos.y + 0.54, b.pos.z); m.castShadow = true;
      this._geos.push(g); this.group.add(m);
      this._barrelH[b.id] = m;
    }
    // platforms (moving)
    for (const p of d.platforms || []) {
      const s = p.size || { x: 2, y: 0.3, z: 2 };
      const g = new THREE.BoxGeometry(s.x * 2, s.y * 2, s.z * 2);
      const m = new THREE.Mesh(g, this.material('__plat', { color: 0x30404e, metal: 0.6, rough: 0.4, emissive: 0x7df9ff, emissiveI: 0.25 }));
      m.castShadow = true; this._geos.push(g); this.group.add(m);
      this._platH.push({ mesh: m, def: p });
    }
    // destructibles
    for (const w of d.destructibles || []) {
      const g = new THREE.BoxGeometry(w.max.x - w.min.x, w.max.y - w.min.y, w.max.z - w.min.z);
      const m = new THREE.Mesh(g, this.material('__destr', { color: 0x4a4438, rough: 0.9, emissive: 0x000000 }));
      m.position.set((w.min.x + w.max.x) / 2, (w.min.y + w.max.y) / 2, (w.min.z + w.max.z) / 2);
      m.castShadow = true; this._geos.push(g); this.group.add(m);
      this._destrH[w.id] = { mesh: m };
    }
    // hazards (visual-only danger zones)
    for (const hz of d.hazards || []) {
      const g = new THREE.PlaneGeometry(hz.max.x - hz.min.x, hz.max.z - hz.min.z);
      g.rotateX(-Math.PI / 2);
      const cols = { lava: 0xff3a00, spike: 0x9099a0, void: 0x160a26, electric: 0x4da6ff, toxic: 0x88ff2a, water: 0x123540 };
      const solidType = hz.type === 'void' || hz.type === 'water';
      const m = new THREE.Mesh(g, this.material('__haz' + hz.type, { basic: true, color: cols[hz.type] ?? 0xff3a00, transparent: true, opacity: solidType ? 0.85 : 0.7, additive: !solidType }));
      m.position.set((hz.min.x + hz.max.x) / 2, hz.max.y + 0.02, (hz.min.z + hz.max.z) / 2);
      this._geos.push(g); this.group.add(m);
      if ((hz.type === 'lava' || hz.type === 'electric') && hz.glow) this.light('point', { color: cols[hz.type], intensity: 1.2, dist: 12, pos: { x: (hz.min.x + hz.max.x) / 2, y: hz.max.y + 1.5, z: (hz.min.z + hz.max.z) / 2 } });
    }
  }

  syncDynamic(state, t) {
    if (!state) return;
    if (state.doors) for (const id in state.doors) { const h = this._doorH[id]; if (h) { const f = state.doors[id]; h.mesh.position.set(h.base.x + h.off.x * f, h.base.y + h.off.y * f, h.base.z + h.off.z * f); } }
    if (state.barrels) { const alive = new Set(state.barrels); for (const id in this._barrelH) this._barrelH[id].visible = alive.has(id); }
    if (state.destroyed) {
      const set = state.destroyed instanceof Set ? state.destroyed : new Set(state.destroyed);
      for (const id in this._destrH) {
        const gone = set.has(id);
        this._destrH[id].mesh.visible = !gone;
        if (gone && !this._destroyedSeen.has(id)) {
          this._destroyedSeen.add(id);
          const p = this._destrH[id].mesh.position;
          this.ctx.fx?.particles?.burst?.({ position: p.clone(), count: 26, color: 0x9a8a70, speed: 5, spread: 1, life: 0.8, size: 0.18, gravity: 9 });
        }
      }
    }
  }

  update(dt, t) {
    for (const p of this._platH) { const pos = platformPos(p.def, t); p.mesh.position.set(pos.x, pos.y, pos.z); }
    this._stepAmbient(t);
    this.updateEnv(dt, t);
  }

  resize() {}

  dispose() {
    this.ctx.scene.remove(this.group);
    for (const g of this._geos) g.dispose?.();
    for (const m of this._mats.values()) m.dispose?.();
    for (const t of this._texs) t.dispose?.();
    // lights removed with the group; nothing else to free
    this.ctx.scene.fog = this._prevFog;
    this.ctx.scene.background = this._prevBg;
    this._geos.length = 0; this._mats.clear(); this._texs.length = 0;
  }
}

// deterministic pseudo-random for placement (no Math.random in build → stable)
function hash(n) { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }
export { hash as mapHash };
