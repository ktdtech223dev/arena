// ARENA client — net/ModeView.js: world-space visuals for game-mode objects,
// driven entirely by snap.mode: the KOTH hill (a glowing volume that tints by
// holder), CTF flags (pole + team-colored banner at base/dropped/carried pos),
// and the ODDBALL skull (a bobbing glowing orb). Pooled, code-built, no assets;
// materials are basic/additive (auto node-material on WebGPU — no raw GLSL).
import * as THREE from 'three';

const TEAM_COLS = [0xff6b6b, 0x7db2ff];

export class ModeView {
  constructor(ctx) {
    this.ctx = ctx;
    this.group = new THREE.Group();
    ctx.scene.add(this.group);
    this._zone = null; this._flags = null; this._orb = null;
    this._t = 0;
    this._modeId = null;
  }

  _mat(color, opacity) {
    return new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  }

  _buildZone(z) {
    const w = z.max.x - z.min.x, h = z.max.y - z.min.y, d = z.max.z - z.min.z;
    const g = new THREE.Group();
    const vol = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), this._mat(0x9fe86a, 0.10));
    const rim = new THREE.Mesh(new THREE.BoxGeometry(w, 0.14, d), this._mat(0x9fe86a, 0.5));
    rim.position.y = -h / 2 + 0.08;
    g.add(vol); g.add(rim);
    g.position.set((z.min.x + z.max.x) / 2, (z.min.y + z.max.y) / 2, (z.min.z + z.max.z) / 2);
    this.group.add(g);
    return { g, volMat: vol.material, rimMat: rim.material };
  }

  _buildFlag(team) {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.4, 8), new THREE.MeshBasicMaterial({ color: 0xb9c2cc, toneMapped: false }));
    pole.position.y = 1.2;
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.55), new THREE.MeshBasicMaterial({ color: TEAM_COLS[team], side: THREE.DoubleSide, toneMapped: false }));
    banner.position.set(0.48, 2.0, 0);
    const glow = new THREE.Mesh(new THREE.CircleGeometry(0.8, 20), this._mat(TEAM_COLS[team], 0.3));
    glow.rotation.x = -Math.PI / 2; glow.position.y = 0.03;
    g.add(pole); g.add(banner); g.add(glow);
    this.group.add(g);
    return { g, banner };
  }

  _buildOrb() {
    const g = new THREE.Group();
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 12), new THREE.MeshBasicMaterial({ color: 0xe8d9ff, toneMapped: false }));
    const halo = new THREE.Mesh(new THREE.SphereGeometry(0.5, 14, 12), this._mat(0xb15bff, 0.4));
    g.add(core); g.add(halo);
    this.group.add(g);
    return { g, halo };
  }

  _clear() {
    for (const e of [this._zone, this._orb, ...(this._flags || [])]) {
      if (!e) continue;
      e.g.traverse((o) => { if (o.isMesh) { o.geometry?.dispose?.(); o.material?.dispose?.(); } });
      this.group.remove(e.g);
    }
    this._zone = null; this._flags = null; this._orb = null;
  }

  /** Apply the latest snap.mode. Rebuilds on mode change; else updates positions. */
  sync(m, myId) {
    if (!m) { if (this._modeId) { this._clear(); this._modeId = null; } return; }
    if (m.id !== this._modeId) { this._clear(); this._modeId = m.id; }
    // KOTH hill
    if (m.zone) {
      if (!this._zone) this._zone = this._buildZone(m.zone);
      const mineHold = m.zone.occ === myId;
      const col = m.zone.occ ? (mineHold ? 0x7df9ff : 0xff6b6b) : 0x9fe86a;
      this._zone.volMat.color.setHex(col); this._zone.rimMat.color.setHex(col);
    }
    // CTF flags
    if (m.flags) {
      if (!this._flags) this._flags = m.flags.map((f) => this._buildFlag(f.team));
      m.flags.forEach((f, i) => {
        const v = this._flags[i]; if (!v) return;
        v.g.position.set(f.x, f.y, f.z);
        v.g.visible = true;
      });
    }
    // ODDBALL skull
    if (m.orb) {
      if (!this._orb) this._orb = this._buildOrb();
      this._orb.g.position.set(m.orb.x, m.orb.y, m.orb.z);
    }
  }

  update(dt) {
    this._t += dt;
    if (this._orb) { this._orb.g.rotation.y = this._t * 1.4; this._orb.halo.material.opacity = 0.3 + 0.15 * Math.sin(this._t * 3); }
    if (this._flags) for (const f of this._flags) f.g.rotation.y = Math.sin(this._t * 0.8) * 0.12;
  }

  dispose() { this._clear(); this.ctx.scene.remove(this.group); }
}
