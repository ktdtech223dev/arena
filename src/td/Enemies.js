// TOWER DEFENSE — Enemies.js: enemy MODEL builders + procedural animation.
// (The enemy SIM is server-authoritative — see server/TdSim.js. This module only
// builds and animates the code-built bodies: the ZOMBIE family — rotted green
// shamblers with hanging arms and swaying gait — and the ALIEN family —
// chitinous violet skitterers/flyers with glow eyes and phase shimmer.)
import * as THREE from 'three';
import { ENEMY_DEFS } from '../../shared/tddata.js';

const ZOMBIE_SKIN = 0x5a7a3a, ZOMBIE_DARK = 0x3a4a26, GORE = 0x8a2a1e;
const ALIEN_SHELL = 0x4a2a6e, ALIEN_GLOW = 0xc96af0, ALIEN_EYE = 0x66ff88;

function mat(color, opts = {}) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: opts.rough ?? 0.8, metalness: opts.metal ?? 0.08 });
  if (opts.emissive) { m.emissive = new THREE.Color(opts.emissive); m.emissiveIntensity = opts.emissiveI ?? 0.8; }
  if (opts.transparent) { m.transparent = true; m.opacity = opts.opacity ?? 1; }
  return m;
}
function box(parent, m, w, h, d, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z); mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

function buildZombie(def) {
  const g = new THREE.Group();
  const s = def.size;
  const skin = mat(ZOMBIE_SKIN), dark = mat(ZOMBIE_DARK), gore = mat(GORE, { emissive: 0x5a0a06, emissiveI: 0.4 });
  const parts = {};
  const torso = box(g, dark, 0.62 * s, 0.7 * s, 0.36 * s, 0, 1.05 * s, 0);
  box(torso, gore, 0.3 * s, 0.34 * s, 0.06 * s, 0.1 * s, -0.05 * s, 0.19 * s);
  const head = box(g, skin, 0.34 * s, 0.34 * s, 0.34 * s, 0, 1.6 * s, 0.04 * s);
  head.rotation.x = 0.25;
  box(head, mat(0x111111, { emissive: 0xffe08a, emissiveI: 0.5 }), 0.07, 0.05, 0.02, -0.08 * s, 0.02, 0.18 * s);
  parts.head = head;
  parts.armL = box(g, skin, 0.16 * s, 0.7 * s, 0.16 * s, -0.42 * s, 1.1 * s, 0.1 * s);
  parts.armR = box(g, skin, 0.16 * s, 0.7 * s, 0.16 * s, 0.42 * s, 1.1 * s, 0.1 * s);
  parts.armL.geometry.translate(0, -0.3 * s, 0); parts.armR.geometry.translate(0, -0.3 * s, 0);
  parts.legL = box(g, dark, 0.2 * s, 0.72 * s, 0.2 * s, -0.16 * s, 0.72 * s, 0);
  parts.legR = box(g, dark, 0.2 * s, 0.72 * s, 0.2 * s, 0.16 * s, 0.72 * s, 0);
  parts.legL.geometry.translate(0, -0.36 * s, 0); parts.legR.geometry.translate(0, -0.36 * s, 0);
  if (def === ENEMY_DEFS.brute) box(g, dark, 0.9 * s, 0.3 * s, 0.5 * s, 0, 1.5 * s, 0);
  if (def === ENEMY_DEFS.bloater) parts.belly = box(g, mat(0x7a8a2a, { emissive: 0x9fe86a, emissiveI: 0.5 }), 0.7 * s, 0.5 * s, 0.5 * s, 0, 0.85 * s, 0.1 * s);
  if (def === ENEMY_DEFS.screamer) parts.maw = box(g, gore, 0.16 * s, 0.2 * s, 0.1 * s, 0, 1.55 * s, 0.2 * s);
  return { group: g, parts };
}

function buildAlien(def) {
  const g = new THREE.Group();
  const s = def.size;
  const shell = mat(ALIEN_SHELL, { metal: 0.35, rough: 0.45 });
  const glow = mat(0x2a1440, { emissive: ALIEN_GLOW, emissiveI: 1.1 });
  const parts = {};
  if (def.fly) {
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.5 * s, 14, 10), shell);
    body.scale.set(1, 0.55, 1); body.position.y = 1.6 * s; body.castShadow = true;
    g.add(body); parts.body = body;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55 * s, 0.07 * s, 8, 20), glow);
    ring.rotation.x = Math.PI / 2; ring.position.y = 1.6 * s;
    g.add(ring); parts.ring = ring;
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.14 * s, 10, 8), mat(0x0a1a0e, { emissive: ALIEN_EYE, emissiveI: 1.6 }));
    eye.position.set(0, 1.5 * s, 0.4 * s); g.add(eye);
    parts.feelers = [];
    for (const dx of [-0.25, 0, 0.25]) { const f = box(g, shell, 0.05 * s, 0.5 * s, 0.05 * s, dx * s, 1.15 * s, 0); f.geometry.translate(0, -0.2 * s, 0); parts.feelers.push(f); }
  } else {
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.44 * s, 12, 9), shell);
    body.scale.set(1.3, 0.7, 1); body.position.y = 0.72 * s; body.castShadow = true;
    g.add(body); parts.body = body;
    box(g, glow, 0.1 * s, 0.06 * s, 0.7 * s, 0, 0.95 * s, 0);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.11 * s, 8, 8), mat(0x0a1a0e, { emissive: ALIEN_EYE, emissiveI: 1.8 }));
    eye.position.set(0, 0.8 * s, 0.5 * s); g.add(eye);
    parts.legs = [];
    for (const [dx, dz] of [[-0.5, 0.3], [0.5, 0.3], [-0.5, -0.3], [0.5, -0.3]]) {
      const leg = box(g, shell, 0.08 * s, 0.8 * s, 0.08 * s, dx * s, 0.5 * s, dz * s);
      leg.geometry.translate(0, -0.34 * s, 0);
      leg.rotation.z = dx > 0 ? -0.5 : 0.5;
      parts.legs.push(leg);
    }
    if (def.shield) { const sh = new THREE.Mesh(new THREE.SphereGeometry(0.95 * s, 14, 10), mat(0x184a6e, { emissive: 0x4da6ff, emissiveI: 0.5, transparent: true, opacity: 0.28 })); sh.position.y = 0.75 * s; g.add(sh); parts.shieldMesh = sh; }
  }
  return { group: g, parts };
}

/** Build one enemy body. Returns { group, parts } — animate with animateEnemy. */
export function buildEnemyModel(def) {
  return def.family === 'zombie' ? buildZombie(def) : buildAlien(def);
}

/** Per-frame procedural animation (t = enemy-local clock, moving = speed>0). */
export function animateEnemy(def, parts, group, t, moving, extras = {}) {
  const w = moving ? Math.min(1, def.speed / 2) : 0;
  if (def.family === 'zombie') {
    const sw = Math.sin(t * (4 + def.speed)) * 0.5 * w;
    if (parts.legL) { parts.legL.rotation.x = sw; parts.legR.rotation.x = -sw; }
    if (parts.armL) { parts.armL.rotation.x = -0.9 + Math.sin(t * 3.1) * 0.18 * w; parts.armR.rotation.x = -0.75 + Math.cos(t * 2.7) * 0.22 * w; }
    group.rotation.z = Math.sin(t * 2.2) * 0.05 * w;
    if (parts.belly) parts.belly.scale.setScalar(1 + Math.sin(t * 5) * 0.06);
    if (parts.maw) parts.maw.scale.y = 1 + Math.max(0, Math.sin(t * 6)) * 1.6;
  } else {
    if (parts.legs) for (let i = 0; i < parts.legs.length; i++) parts.legs[i].rotation.x = Math.sin(t * 10 + i * 1.7) * 0.5 * w;
    if (parts.ring) parts.ring.rotation.z = t * 3;
    if (parts.feelers) for (let i = 0; i < parts.feelers.length; i++) parts.feelers[i].rotation.x = Math.sin(t * 3 + i) * 0.3;
    if (parts.shieldMesh) { parts.shieldMesh.visible = (extras.shieldPct || 0) > 2; parts.shieldMesh.material.opacity = 0.16 + 0.12 * Math.sin(t * 4) + 0.12 * ((extras.shieldPct || 0) / 100); }
  }
}
