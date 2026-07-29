// TOWER DEFENSE — Units.js: tower MODEL builders (visual only; the tower sim is
// server-authoritative — server/TdSim.js). Models grow with upgrade tiers (extra
// barrels, coils, banners) and maxed paths glow gold — a maxed tower reads
// across the map. Rebuilt whenever a unit's tiers change on the wire.
import * as THREE from 'three';
import { BUILDERS as TOWERS_A } from './models/towers_a.js';
import { BUILDERS as TOWERS_B } from './models/towers_b.js';
import { BUILDERS as TOWERS_C } from './models/towers_c.js';

// the polished per-tower model registry (15 bespoke designs; the generic
// chassis below stays as a safety fallback for any missing/throwing builder)
const POLISHED = { ...TOWERS_A, ...TOWERS_B, ...TOWERS_C };

const T3_GLOW = 0xffd166;
const ACCENT = { damage: 0xff8a4a, buff: 0x9fe86a, debuff: 0x7db2ff, economy: 0xffd166 };

function mat(color, opts = {}) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: opts.rough ?? 0.6, metalness: opts.metal ?? 0.35 });
  if (opts.emissive) { m.emissive = new THREE.Color(opts.emissive); m.emissiveIntensity = opts.emissiveI ?? 0.8; }
  return m;
}
function box(parent, m, w, h, d, x, y, z, ry = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z); mesh.rotation.y = ry; mesh.castShadow = true;
  parent.add(mesh); return mesh;
}
function cyl(parent, m, r0, r1, h, x, y, z, seg = 10) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, h, seg), m);
  mesh.position.set(x, y, z); mesh.castShadow = true;
  parent.add(mesh); return mesh;
}

/** Build a tower model for (def, tiers). Returns { group, parts:{yawNode,spinner?} } */
export function buildUnitModel(def, tiers = [0, 0]) {
  const polished = POLISHED[def.id];
  if (polished) {
    try { return polished(THREE, tiers); } catch { /* fall back to the generic chassis */ }
  }
  return buildGenericUnitModel(def, tiers);
}

function buildGenericUnitModel(def, tiers = [0, 0]) {
  const g = new THREE.Group();
  const acc = ACCENT[def.role] || 0xffffff;
  const t3 = tiers[0] >= 3 || tiers[1] >= 3;
  const glowC = t3 ? T3_GLOW : acc;
  const body = mat(0x2a3340, { metal: 0.5, rough: 0.45 });
  const glow = mat(0x101820, { emissive: glowC, emissiveI: 1.1 });
  const parts = { yawNode: null };
  cyl(g, body, 0.85, 1.05, 0.5, 0, 0.25, 0, 12);
  cyl(g, glow, 0.9, 0.9, 0.08, 0, 0.55, 0, 12);
  const yaw = new THREE.Group(); yaw.position.y = 0.6; g.add(yaw);
  parts.yawNode = yaw;
  const total = tiers[0] + tiers[1];

  switch (def.id) {
    case 'gatling': {
      box(yaw, body, 0.7, 0.5, 0.9, 0, 0.5, 0);
      const barrels = tiers[0] >= 2 ? 3 : 1;
      for (let i = 0; i < barrels; i++) cyl(yaw, mat(0x1a2028, { metal: 0.7 }), 0.07, 0.07, 0.9, (i - (barrels - 1) / 2) * 0.18, 0.5, 0.55).rotation.x = Math.PI / 2;
      if (tiers[1] >= 1) box(yaw, glow, 0.16, 0.1, 0.5, 0, 0.82, 0.2);
      if (t3) box(yaw, glow, 0.8, 0.12, 0.12, 0, 0.2, 0.4);
      break; }
    case 'railcannon': {
      box(yaw, body, 0.5, 0.5, 0.6, 0, 0.4, -0.2);
      const rail = box(yaw, mat(0x1a2028, { metal: 0.8 }), 0.22, 0.22, 1.7 + total * 0.15, 0, 0.55, 0.5);
      box(rail, glow, 0.26, 0.06, 1.2, 0, 0.15, 0);
      if (tiers[1] >= 1) cyl(yaw, glow, 0.2, 0.2, 0.1, 0, 0.55, 1.3, 8);
      break; }
    case 'mortar': {
      const tube = cyl(yaw, body, 0.3, 0.4, 1.2 + tiers[1] * 0.1, 0, 0.9, 0);
      tube.rotation.x = -0.7;
      if (tiers[0] >= 1) cyl(yaw, mat(0x3a1a0a, { emissive: 0xff6a1a, emissiveI: 0.9 }), 0.32, 0.32, 0.1, 0, 1.2, -0.35, 10);
      if (tiers[1] >= 2) for (const s of [-1, 1]) cyl(yaw, body, 0.14, 0.18, 0.7, s * 0.4, 0.7, 0).rotation.x = -0.7;
      break; }
    case 'tesla': {
      cyl(yaw, body, 0.16, 0.3, 1.4, 0, 0.7, 0);
      const orbs = 1 + Math.max(tiers[0], tiers[1] >= 2 ? 2 : 0);
      for (let i = 0; i < orbs; i++) {
        const o = new THREE.Mesh(new THREE.SphereGeometry(0.16 + (i === 0 ? 0.1 : 0), 10, 8), glow);
        o.position.set(Math.sin(i * 2.1) * 0.3 * Math.min(i, 1), 1.5 + i * 0.22, Math.cos(i * 2.1) * 0.3 * Math.min(i, 1));
        yaw.add(o);
      }
      break; }
    case 'cryo': {
      const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42 + total * 0.05, 0), mat(0x0a2a3a, { emissive: 0x7df9ff, emissiveI: 1.2 }));
      core.position.y = 1.1; yaw.add(core); parts.spinner = core;
      for (let i = 0; i < 2 + tiers[1]; i++) box(yaw, mat(0x18313f, { metal: 0.4 }), 0.1, 0.7, 0.1, Math.sin(i * 2.4) * 0.5, 0.75, Math.cos(i * 2.4) * 0.5);
      break; }
    case 'acid': {
      cyl(yaw, mat(0x2a3a1a), 0.4, 0.5, 0.8, 0, 0.5, 0);
      const tank = new THREE.Mesh(new THREE.SphereGeometry(0.34 + tiers[0] * 0.05, 10, 8), mat(0x1a3a12, { emissive: 0x88ff2a, emissiveI: 0.9 }));
      tank.position.y = 1.15; yaw.add(tank); parts.spinner = tank;
      cyl(yaw, body, 0.06, 0.06, 0.7, 0, 0.75, 0.45).rotation.x = Math.PI / 2;
      break; }
    case 'hive': {
      box(yaw, body, 0.9, 0.7, 0.9, 0, 0.55, 0);
      for (let i = 0; i < 2 + tiers[0]; i++) box(yaw, glow, 0.16, 0.16, 0.16, Math.sin(i * 2.4) * 0.35, 1.05, Math.cos(i * 2.4) * 0.35);
      if (tiers[1] >= 1) box(yaw, mat(0x3a1a0a, { emissive: 0xff6a1a, emissiveI: 0.8 }), 0.5, 0.1, 0.5, 0, 0.95, 0);
      break; }
    case 'sniper': {
      box(yaw, body, 0.5, 0.4, 0.5, 0, 0.5, 0);
      cyl(yaw, mat(0x1a2028, { metal: 0.8 }), 0.06, 0.06, 1.9 + tiers[0] * 0.2, 0, 0.75, 0.8).rotation.x = Math.PI / 2;
      if (tiers[1] >= 1) box(yaw, glow, 0.14, 0.14, 0.3, 0.2, 0.9, 0.4);
      break; }
    case 'banner': {
      cyl(yaw, mat(0x4a3a2a), 0.05, 0.07, 2.2 + tiers[1] * 0.2, 0, 1.1, 0, 8);
      parts.flag = box(yaw, mat(0x5a1a1a, { emissive: 0xff6b6b, emissiveI: 0.5 + tiers[0] * 0.2 }), 0.9 + tiers[0] * 0.15, 0.55, 0.04, 0.5, 1.9, 0);
      break; }
    case 'overclocker': {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.5 + tiers[1] * 0.08, 0.08, 8, 20), glow);
      ring.position.y = 1.2; yaw.add(ring); parts.spinner = ring;
      cyl(yaw, body, 0.2, 0.3, 1.1, 0, 0.55, 0);
      break; }
    case 'depot': {
      box(yaw, body, 1.0, 0.6, 0.8, 0, 0.4, 0);
      for (let i = 0; i <= Math.min(2, total); i++) box(yaw, mat(0x4a3a1a, { emissive: 0xffcf6a, emissiveI: 0.5 }), 0.32, 0.2, 0.5, -0.28 + i * 0.28, 0.82, 0);
      break; }
    case 'shieldgen': {
      cyl(yaw, body, 0.35, 0.45, 0.9, 0, 0.55, 0);
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.42 + tiers[0] * 0.06, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x10202e, { emissive: 0x4da6ff, emissiveI: 1 }));
      dome.position.y = 1.05; yaw.add(dome);
      break; }
    case 'gravwell': {
      const orb = new THREE.Mesh(new THREE.SphereGeometry(0.4 + tiers[0] * 0.05, 12, 10), mat(0x14102a, { emissive: 0xb15bff, emissiveI: 1.3 }));
      orb.position.y = 1.25; yaw.add(orb); parts.spinner = orb;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.62 + tiers[1] * 0.1, 0.05, 8, 22), glow);
      ring.position.y = 1.25; ring.rotation.x = Math.PI / 2.4; yaw.add(ring);
      break; }
    case 'bounty': {
      cyl(yaw, mat(0x4a3a1a, { metal: 0.7 }), 0.3, 0.42, 1.0, 0, 0.6, 0, 8);
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.26 + total * 0.04), mat(0x3a2a0a, { emissive: 0xffd166, emissiveI: 1.4 }));
      gem.position.y = 1.45; yaw.add(gem); parts.spinner = gem;
      break; }
    case 'plasma': {
      box(yaw, body, 0.5, 0.5, 0.7, 0, 0.5, 0);
      const beams = Math.min(1 + (tiers[1] >= 1 ? tiers[1] : 0), 4);
      for (let i = 0; i < beams; i++) cyl(yaw, glow, 0.08, 0.12, 0.8, (i - (beams - 1) / 2) * 0.24, 0.72, 0.4, 8).rotation.x = Math.PI / 2;
      break; }
  }
  return { group: g, parts };
}

export { ACCENT };
