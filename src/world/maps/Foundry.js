// ARENA map — FOUNDRY (the co-op Tower Defense arena)
// ============================ MAP DESIGN CONTRACT ============================
// Dusk-canyon plateau. Renders the shared collider set (ground/rims/rocks/core
// base) + the TD dressing: the glowing horde LANE from the PORTAL to the CORE
// tower, and the ARMORY pad (E = weapon shop). Enemy/unit/FX rendering is owned
// by TdView (net-driven) — this env is the static stage. Warm dusk key + green
// lane accents so the horde reads against the ground.
// ============================================================================
import * as THREE from 'three';
import { MapEnv } from '../MapEnv.js';
import { TD_PATH, TD_PATH_W, TD_CORE, TD_ARMORY } from '../../../shared/tddata.js';

export class Foundry extends MapEnv {
  buildEnvironment() {
    this.fog(0x2a1c12, 55, 240);
    this.sky(0x3a2415, 0x120b06, (env) => env.skySpecks(90, 0xffb14a, 380, 1.0));
    this.light('dir', { color: 0xffc9a0, intensity: 1.7, dir: { x: 0.5, y: -1, z: -0.4 }, shadow: true, shadowSize: 70 });
    this.light('hemi', { sky: 0x8a6a4a, ground: 0x241a12, intensity: 1.15 });
    this.light('ambient', { color: 0x6a5240, intensity: 0.55 });

    // ---- collider geometry (ground / rims / rocks / core base) ----
    this.material('gnd', { color: 0x4a4034, rough: 0.9 });
    this.material('wall', { color: 0x3a3028, rough: 0.85 });
    this.material('rock', { color: 0x554838, rough: 0.9 });
    this.material('coreb', { color: 0x2a3340, metal: 0.6, rough: 0.4 });
    this.material('armory', { color: 0x203040, metal: 0.5, rough: 0.5, emissive: 0xffcf6a, emissiveI: 0.25 });
    for (const s of this.data.solids) {
      const { min: a, max: b } = s;
      const w = b.x - a.x, h = b.y - a.y, d = b.z - a.z;
      let mat = 'gnd';
      if (s.wallrun) mat = 'wall';
      else if (h > 1.4 && w < 12 && d < 12) mat = 'rock';
      else if (Math.abs((a.x + b.x) / 2 - TD_CORE.x) < 4 && Math.abs((a.z + b.z) / 2 - TD_CORE.z) < 4) mat = 'coreb';
      else if (Math.abs((a.x + b.x) / 2 - TD_ARMORY.x) < 3 && Math.abs((a.z + b.z) / 2 - TD_ARMORY.z) < 3) mat = 'armory';
      this.solid(a.x, a.y, a.z, b.x, b.y, b.z, mat);
    }

    // ---- the LANE: dark ribbon + glowing edges ----
    this.material('lane', { color: 0x241d18, rough: 0.95 });
    this.material('laneEdge', { basic: true, color: 0x9fe86a, transparent: true, opacity: 0.55, additive: true });
    for (let i = 1; i < TD_PATH.length; i++) {
      const a = TD_PATH[i - 1], b = TD_PATH[i];
      const lx = Math.abs(b.x - a.x), lz = Math.abs(b.z - a.z);
      const cx = (a.x + b.x) / 2, cz = (a.z + b.z) / 2;
      const g = new THREE.BoxGeometry(lx + (lx ? TD_PATH_W * 0 : TD_PATH_W), 0.06, lz + (lz ? 0 : TD_PATH_W));
      // widen along the travel axis so corners join
      const g2 = new THREE.BoxGeometry((lx || TD_PATH_W) + (lx ? TD_PATH_W : 0), 0.06, (lz || TD_PATH_W) + (lz ? TD_PATH_W : 0));
      g.dispose();
      g2.translate(cx, 0.03, cz);
      this.addGeo(g2, 'lane');
      for (const sgn of [-1, 1]) {
        const eg = lx
          ? new THREE.BoxGeometry(lx + TD_PATH_W, 0.05, 0.16)
          : new THREE.BoxGeometry(0.16, 0.05, lz + TD_PATH_W);
        eg.translate(lx ? cx : cx + sgn * (TD_PATH_W / 2), 0.06, lx ? cz + sgn * (TD_PATH_W / 2) : cz);
        this.addGeo(eg, 'laneEdge');
      }
    }

    // ---- PORTAL (west): jagged ring, sickly green ----
    const p0 = TD_PATH[0];
    this.material('portal', { basic: true, color: 0x66ff44, transparent: true, opacity: 0.85, additive: true });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3, 0.35, 10, 24),
      this._mats.get('portal'));
    ring.position.set(p0.x - 2.2, 3.4, p0.z); ring.rotation.y = Math.PI / 2;
    this.group.add(ring);
    this._portal = ring;
    const inner = new THREE.Mesh(new THREE.CircleGeometry(2.6, 22),
      new THREE.MeshBasicMaterial({ color: 0x123a0c, transparent: true, opacity: 0.9, toneMapped: false }));
    inner.position.set(p0.x - 2.18, 3.4, p0.z); inner.rotation.y = Math.PI / 2;
    this.group.add(inner);
    this.light('point', { color: 0x66ff44, intensity: 2.2, dist: 16, pos: { x: p0.x, y: 3.5, z: p0.z } });

    // ---- CORE tower crown: floating crystal heart ----
    const heart = new THREE.Mesh(new THREE.OctahedronGeometry(1.5),
      new THREE.MeshStandardMaterial({ color: 0x18b6d8, emissive: 0x7df9ff, emissiveIntensity: 1.6, metalness: 0.4, roughness: 0.2 }));
    heart.position.set(TD_CORE.x, 9.6, TD_CORE.z);
    this.group.add(heart);
    this._heart = heart;
    this.light('point', { color: 0x7df9ff, intensity: 2.4, dist: 20, pos: { x: TD_CORE.x, y: 9.5, z: TD_CORE.z } });

    // ---- ARMORY beacon: floating crate + gold shaft ----
    this.material('armGlow', { basic: true, color: 0xffcf6a, transparent: true, opacity: 0.35, additive: true });
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 5, 14, 1, true), this._mats.get('armGlow'));
    shaft.position.set(TD_ARMORY.x, 2.8, TD_ARMORY.z);
    this.group.add(shaft);
    const crate = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.6, 0.7),
      new THREE.MeshStandardMaterial({ color: 0x4a3a1a, emissive: 0xffcf6a, emissiveIntensity: 0.5, metalness: 0.5, roughness: 0.5 }));
    crate.position.set(TD_ARMORY.x, 1.6, TD_ARMORY.z);
    this.group.add(crate);
    this._crate = crate;

    this.ambientParticles?.('embers', 90, { x: 40, y: 10, z: 40 }, { x: 0, y: 4, z: 0 }, 0xff7a2a);
  }

  updateEnv(dt, t) {
    if (this._heart) { this._heart.rotation.y = t * 0.8; this._heart.position.y = 9.6 + Math.sin(t * 1.4) * 0.25; }
    if (this._portal) this._portal.rotation.z = t * 0.5;
    if (this._crate) { this._crate.rotation.y = t * 0.9; this._crate.position.y = 1.6 + Math.sin(t * 2) * 0.12; }
  }
}
