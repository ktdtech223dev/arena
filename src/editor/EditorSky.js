// RANGE — src/editor/EditorSky.js
// The editor's SKY + LIGHTING rig. Mirrors the SKYBOX_PRESETS the CustomEnv
// renderer uses in play so the editor isn't a void and roughly matches how the
// finished map will look (WYSIWYG). Owns a gradient sky sphere, an optional
// starfield, a fog, a directional KEY light, a hemisphere FILL, and an ambient
// term. setPreset(name) rebuilds the rig live when the toolbar preset changes.
//
// Self-contained + fully disposable. Kept separate from any game env module.
import { SKYBOX_PRESETS } from '../../shared/custommap.js';

export class EditorSky {
  constructor(THREE, scene) {
    this.THREE = THREE;
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'editor:sky';
    scene.add(this.group);
    this._geos = [];
    this._mats = [];
    this._lights = [];
    this._skyMesh = null;
    this._specks = null;
    this.current = null;
  }

  presetName() { return this.current; }

  setPreset(name) {
    const preset = SKYBOX_PRESETS[name] ? name : 'night';
    this.current = preset;
    this._clear();
    const P = SKYBOX_PRESETS[preset];
    const THREE = this.THREE;

    // gradient sky sphere (BackSide, unlit, no fog)
    const geo = new THREE.SphereGeometry(400, 32, 16);
    const top = new THREE.Color(P.skyTop), bot = new THREE.Color(P.skyBot);
    const pos = geo.attributes.position;
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 400;
      const f = Math.pow(Math.max(0, Math.min(1, (y + 1) / 2)), 0.7);
      col[i * 3] = bot.r + (top.r - bot.r) * f;
      col[i * 3 + 1] = bot.g + (top.g - bot.g) * f;
      col[i * 3 + 2] = bot.b + (top.b - bot.b) * f;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.MeshBasicMaterial({ side: THREE.BackSide, fog: false, depthWrite: false, vertexColors: true, toneMapped: false });
    this._skyMesh = new THREE.Mesh(geo, mat);
    this._geos.push(geo); this._mats.push(mat);
    this.group.add(this._skyMesh);
    this.scene.background = bot.clone().multiplyScalar(0.6);

    // fog
    if (P.fog) this.scene.fog = new THREE.Fog(P.fog[0], P.fog[1], P.fog[2]);

    // starfield
    if (P.stars > 0) this._buildStars(P.stars, P.accent);

    // directional KEY
    const key = new THREE.DirectionalLight(P.key.color, P.key.intensity);
    const d = P.key.dir;
    key.position.set(-d[0], -d[1], -d[2]).multiplyScalar(60);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 1, far: 260 });
    key.shadow.bias = -0.0004;
    this._lights.push(key); this.group.add(key);

    // hemisphere FILL
    const hemi = new THREE.HemisphereLight(P.hemi.sky, P.hemi.ground, P.hemi.intensity);
    this._lights.push(hemi); this.group.add(hemi);

    // ambient
    const amb = new THREE.AmbientLight(0xffffff, P.amb ?? 0.5);
    this._lights.push(amb); this.group.add(amb);
  }

  _buildStars(count, color) {
    const THREE = this.THREE;
    count = Math.min(count, 360);
    const g = new THREE.PlaneGeometry(1.2, 1.2);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false });
    const inst = new THREE.InstancedMesh(g, mat, count);
    const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4();
    const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
    for (let i = 0; i < count; i++) {
      const th = hash(i * 2.13) * Math.PI * 2, ph = Math.acos(1 - hash(i * 7.7) * 1.3);
      const r = 380 * (0.8 + hash(i * 3.3) * 0.2);
      _v.set(r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph) * 0.7 + 40, r * Math.sin(ph) * Math.sin(th));
      _q.identity();
      const s = 0.4 + hash(i * 5.1) * 1.6;
      _m.compose(_v, _q, { x: s, y: s, z: s });
      inst.setMatrixAt(i, _m);
    }
    inst.frustumCulled = false;
    this._geos.push(g); this._mats.push(mat);
    this._specks = inst;
    this.group.add(inst);
  }

  _clear() {
    for (const l of this._lights) this.group.remove(l);
    if (this._skyMesh) this.group.remove(this._skyMesh);
    if (this._specks) this.group.remove(this._specks);
    for (const g of this._geos) g.dispose?.();
    for (const m of this._mats) m.dispose?.();
    this._geos.length = 0; this._mats.length = 0; this._lights.length = 0;
    this._skyMesh = null; this._specks = null;
  }

  dispose() {
    this._clear();
    this.scene.remove(this.group);
    this.scene.fog = null;
    this.scene.background = null;
  }
}
