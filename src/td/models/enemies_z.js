// TOWER DEFENSE — enemies_z.js: ZOMBIE family enemy models (code-built).
// shambler / sprinter / brute / bloater / screamer.
// Contract: BUILDERS[id](THREE, def) -> { group, parts };
//           ANIMATE[id](parts, group, t, moving, extras).
// Style: low-poly chunky silhouettes, MeshStandardMaterial + additive
// MeshBasicMaterial glow only. Local origin at base center, feet at y=0.
// Built at size 1 inside a wrapper group scaled by def.size.

// -- palette ----------------------------------------------------------------
const ROT = 0x5a7a3a;       // rotted skin
const ROT_DARK = 0x3a4a26;  // darker rot / rags
const GORE = 0x8a2a1e;      // exposed gore (faint emissive)
const BONE = 0xd8cfc0;      // bone
const IRON = 0x3a4148;      // worn iron (debris / chains)
const SICK = 0x9fe86a;      // sick-green glow (bloater / screamer throat)

// -- shared helpers ---------------------------------------------------------
function stdMat(THREE, color, o = {}) {
  const m = new THREE.MeshStandardMaterial({
    color, roughness: o.rough ?? 0.85, metalness: o.metal ?? 0.05,
  });
  if (o.emissive) { m.emissive = new THREE.Color(o.emissive); m.emissiveIntensity = o.emissiveI ?? 0.6; }
  return m;
}
function glowMat(THREE, color, opacity = 0.8) {
  return new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false,
  });
}
function add(parent, mesh, x = 0, y = 0, z = 0, cast = true) {
  mesh.position.set(x, y, z); mesh.castShadow = cast; parent.add(mesh); return mesh;
}
function box(THREE, parent, m, w, h, d, x, y, z) {
  return add(parent, new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m), x, y, z);
}
function cyl(THREE, parent, m, rt, rb, h, x, y, z, seg = 8) {
  return add(parent, new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m), x, y, z);
}
function sph(THREE, parent, m, r, x, y, z, ws = 12, hs = 9) {
  return add(parent, new THREE.Mesh(new THREE.SphereGeometry(r, ws, hs), m), x, y, z);
}
function cone(THREE, parent, m, r, h, x, y, z, seg = 6) {
  return add(parent, new THREE.Mesh(new THREE.ConeGeometry(r, h, seg), m), x, y, z);
}
// wrap: inner group at unit scale, outer scaled by def.size
function wrap(THREE, def) {
  const group = new THREE.Group();
  const body = new THREE.Group();
  body.scale.setScalar(def.size || 1);
  group.add(body);
  return { group, body };
}
// limb group with pivot at (x,y,z) — child meshes positioned relative to pivot
function pivot(THREE, parent, x, y, z) {
  const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g;
}

// ===========================================================================
// SHAMBLER — classic walker. Slumped head, one long dragging arm, torn
// ribcage gap showing gore, knee-bent legs, one twisted foot.
// ===========================================================================
function buildShambler(THREE, def) {
  const { group, body } = wrap(THREE, def);
  const skin = stdMat(THREE, ROT), rag = stdMat(THREE, ROT_DARK, { rough: 0.95 });
  const gore = stdMat(THREE, GORE, { emissive: 0x4a0e06, emissiveI: 0.45 });
  const bone = stdMat(THREE, BONE, { rough: 0.6 });
  const parts = {};

  // hips + slumped torso (leaning forward + slightly right)
  box(THREE, body, rag, 0.44, 0.22, 0.3, 0, 0.86, 0);
  const torso = pivot(THREE, body, 0, 0.97, 0);
  torso.rotation.x = 0.22; torso.rotation.z = 0.08;
  parts.torso = torso;
  box(THREE, torso, rag, 0.56, 0.56, 0.32, 0, 0.28, 0);
  // torn ribcage gap: gore slab recessed + bone ribs framing it
  box(THREE, torso, gore, 0.3, 0.34, 0.08, 0.06, 0.24, 0.15);
  for (let i = 0; i < 3; i++) box(THREE, torso, bone, 0.34, 0.045, 0.05, 0.06, 0.13 + i * 0.11, 0.185);
  // slumped head (tilted hard forward-left, chin to chest)
  const head = pivot(THREE, torso, -0.04, 0.56, 0.05);
  head.rotation.x = 0.5; head.rotation.z = -0.22;
  parts.head = head;
  box(THREE, head, skin, 0.3, 0.3, 0.3, 0, 0.12, 0);
  box(THREE, head, skin, 0.16, 0.1, 0.1, 0, 0.02, 0.17);         // jaw
  add(head, new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.02), glowMat(THREE, 0xcfe86a, 0.7)), -0.08, 0.16, 0.155, false); // one dead eye
  // LONG dragging arm (right) — reaches nearly to ground
  const armR = pivot(THREE, torso, 0.33, 0.5, 0.02);
  armR.rotation.z = -0.12; armR.rotation.x = 0.1;
  parts.armR = armR;
  box(THREE, armR, skin, 0.14, 0.62, 0.14, 0, -0.31, 0);
  box(THREE, armR, skin, 0.12, 0.5, 0.12, 0.02, -0.8, 0.02);
  box(THREE, armR, skin, 0.15, 0.12, 0.18, 0.03, -1.06, 0.05);   // dragging hand
  // shorter bent arm (left)
  const armL = pivot(THREE, torso, -0.33, 0.48, 0.02);
  armL.rotation.x = -0.5;
  parts.armL = armL;
  box(THREE, armL, skin, 0.14, 0.44, 0.14, 0, -0.22, 0);
  box(THREE, armL, rag, 0.13, 0.3, 0.13, 0, -0.5, 0.1);
  // knee-bent legs
  const legL = pivot(THREE, body, -0.16, 0.82, 0);
  parts.legL = legL;
  box(THREE, legL, rag, 0.18, 0.44, 0.18, 0, -0.22, 0.03).rotation.x = 0.18;
  box(THREE, legL, skin, 0.15, 0.4, 0.15, 0, -0.6, -0.02);
  box(THREE, legL, rag, 0.17, 0.1, 0.3, 0, -0.77, 0.07);         // foot
  const legR = pivot(THREE, body, 0.17, 0.82, 0);
  parts.legR = legR;
  box(THREE, legR, rag, 0.18, 0.44, 0.18, 0, -0.22, 0.03).rotation.x = 0.14;
  box(THREE, legR, skin, 0.15, 0.4, 0.15, 0, -0.6, -0.02);
  const footR = box(THREE, legR, rag, 0.17, 0.1, 0.3, 0, -0.77, 0.05);
  footR.rotation.y = 0.9;                                        // twisted foot
  return { group, parts };
}
function animShambler(parts, group, t, moving) {
  const w = moving ? t * 4.2 : t * 1.1;
  const a = moving ? 0.42 : 0.06;
  parts.legL.rotation.x = Math.sin(w) * a;
  parts.legR.rotation.x = Math.sin(w + Math.PI) * a;
  parts.torso.rotation.z = 0.08 + Math.sin(w) * 0.07;            // lurching roll
  parts.torso.rotation.x = 0.22 + Math.sin(w * 0.5) * 0.05;
  parts.armL.rotation.x = -0.5 + Math.sin(w + 1.2) * 0.18;
  parts.armR.rotation.x = 0.1 + Math.sin(w + Math.PI) * 0.12;    // drag arm trails
  parts.head.rotation.z = -0.22 + Math.sin(t * 1.7) * 0.1;       // slow head loll
  group.position.y = Math.abs(Math.sin(w)) * (moving ? 0.03 : 0);
}

// ===========================================================================
// SPRINTER — lean, forward-pitched, digitigrade legs, whip arms trailing,
// exposed spine ridge, jaw hanging on sinew.
// ===========================================================================
function buildSprinter(THREE, def) {
  const { group, body } = wrap(THREE, def);
  body.position.y = 0.18 * (def.size || 1); // toe pads touch ground at y=0
  const skin = stdMat(THREE, ROT), dark = stdMat(THREE, ROT_DARK);
  const bone = stdMat(THREE, BONE, { rough: 0.55 });
  const gore = stdMat(THREE, GORE, { emissive: 0x4a0e06, emissiveI: 0.4 });
  const parts = {};

  // forward-pitched lean torso
  const torso = pivot(THREE, body, 0, 1.0, 0);
  torso.rotation.x = 0.62;
  parts.torso = torso;
  box(THREE, torso, skin, 0.36, 0.62, 0.24, 0, 0.26, 0);
  box(THREE, torso, dark, 0.3, 0.26, 0.22, 0, -0.06, 0.01);      // narrow waist
  box(THREE, torso, gore, 0.2, 0.4, 0.04, 0, 0.26, 0.12);        // flayed chest strip
  // exposed spine ridge — bone knuckles down the back
  parts.spine = [];
  for (let i = 0; i < 5; i++) {
    const v = cone(THREE, torso, bone, 0.05, 0.14, 0, 0.5 - i * 0.15, -0.14, 4);
    v.rotation.x = -0.9; parts.spine.push(v);
  }
  // head thrust forward, jaw hanging on sinew
  const head = pivot(THREE, torso, 0, 0.62, 0.1);
  head.rotation.x = -0.5;                                        // counter-tilt: face forward
  parts.head = head;
  box(THREE, head, skin, 0.26, 0.24, 0.28, 0, 0.1, 0.04);
  add(head, new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, 0.02), glowMat(THREE, 0xcfe86a, 0.8)), -0.07, 0.12, 0.185, false);
  add(head, new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, 0.02), glowMat(THREE, 0xcfe86a, 0.8)), 0.07, 0.12, 0.185, false);
  cyl(THREE, head, gore, 0.015, 0.015, 0.12, 0.05, -0.02, 0.12, 5); // sinew strand
  const jaw = pivot(THREE, head, 0, -0.02, 0.1);
  parts.jaw = jaw;
  box(THREE, jaw, bone, 0.16, 0.07, 0.16, 0, -0.09, 0.02).rotation.x = 0.5; // dangling jawbone
  // whip arms trailing behind
  const armL = pivot(THREE, torso, -0.22, 0.42, 0);
  armL.rotation.x = -1.9; armL.rotation.z = 0.25;
  parts.armL = armL;
  box(THREE, armL, skin, 0.09, 0.5, 0.09, 0, -0.25, 0);
  box(THREE, armL, skin, 0.07, 0.46, 0.07, 0, -0.68, 0.05);
  cone(THREE, armL, bone, 0.04, 0.16, 0, -0.96, 0.08, 4).rotation.x = Math.PI;
  const armR = pivot(THREE, torso, 0.22, 0.42, 0);
  armR.rotation.x = -1.7; armR.rotation.z = -0.25;
  parts.armR = armR;
  box(THREE, armR, skin, 0.09, 0.5, 0.09, 0, -0.25, 0);
  box(THREE, armR, skin, 0.07, 0.46, 0.07, 0, -0.68, 0.05);
  cone(THREE, armR, bone, 0.04, 0.16, 0, -0.96, 0.08, 4).rotation.x = Math.PI;
  // digitigrade legs: thigh forward, shank back, toe pad
  const mkLeg = (sx) => {
    const hip = pivot(THREE, body, sx * 0.15, 0.92, -0.05);
    const thigh = box(THREE, hip, dark, 0.15, 0.46, 0.18, 0, -0.2, 0.1);
    thigh.rotation.x = -0.55;
    const shank = pivot(THREE, hip, 0, -0.42, 0.22);
    box(THREE, shank, skin, 0.11, 0.44, 0.12, 0, -0.18, -0.09).rotation.x = 0.75;
    const foot = pivot(THREE, shank, 0, -0.36, -0.26);
    box(THREE, foot, dark, 0.11, 0.34, 0.11, 0, -0.12, 0.06).rotation.x = -0.35;
    box(THREE, foot, skin, 0.12, 0.08, 0.24, 0, -0.28, 0.14);    // toe pad
    return hip;
  };
  parts.legL = mkLeg(-1); parts.legR = mkLeg(1);
  return { group, parts };
}
function animSprinter(parts, group, t, moving) {
  const w = moving ? t * 11 : t * 1.6;
  const a = moving ? 0.8 : 0.08;
  parts.legL.rotation.x = Math.sin(w) * a;
  parts.legR.rotation.x = Math.sin(w + Math.PI) * a;
  parts.torso.rotation.x = 0.62 + Math.sin(w * 2) * (moving ? 0.06 : 0.02);
  parts.torso.rotation.y = Math.sin(w) * (moving ? 0.1 : 0);
  // whip arms flail behind
  parts.armL.rotation.x = -1.9 + Math.sin(w + 0.9) * (moving ? 0.35 : 0.05);
  parts.armR.rotation.x = -1.7 + Math.sin(w + 2.4) * (moving ? 0.35 : 0.05);
  parts.jaw.rotation.z = Math.sin(t * 6.5) * 0.25;               // jaw swings on sinew
  parts.jaw.rotation.x = Math.sin(w * 2 + 1) * 0.15;
  group.position.y = Math.abs(Math.sin(w)) * (moving ? 0.07 : 0);
}

// ===========================================================================
// BRUTE — massive. Slab shoulders with embedded rebar, tiny sunken head,
// knuckle-dragging fists bigger than the head, chained cuff remnant.
// ===========================================================================
function buildBrute(THREE, def) {
  const { group, body } = wrap(THREE, def);
  body.position.y = 0.11 * (def.size || 1); // knuckles graze ground at y=0
  const skin = stdMat(THREE, ROT), dark = stdMat(THREE, ROT_DARK);
  const gore = stdMat(THREE, GORE, { emissive: 0x4a0e06, emissiveI: 0.4 });
  const iron = stdMat(THREE, IRON, { metal: 0.55, rough: 0.5 });
  const parts = {};

  // squat legs
  const legL = pivot(THREE, body, -0.26, 0.62, 0);
  parts.legL = legL;
  box(THREE, legL, dark, 0.3, 0.42, 0.32, 0, -0.2, 0);
  box(THREE, legL, dark, 0.32, 0.14, 0.42, 0, -0.55, 0.05);
  const legR = pivot(THREE, body, 0.26, 0.62, 0);
  parts.legR = legR;
  box(THREE, legR, dark, 0.3, 0.42, 0.32, 0, -0.2, 0);
  box(THREE, legR, dark, 0.32, 0.14, 0.42, 0, -0.55, 0.05);
  // torso wedge — huge up top
  const torso = pivot(THREE, body, 0, 0.78, 0);
  torso.rotation.x = 0.16;
  parts.torso = torso;
  box(THREE, torso, skin, 0.7, 0.5, 0.5, 0, 0.22, 0);
  box(THREE, torso, gore, 0.34, 0.26, 0.06, -0.12, 0.2, 0.26);   // torn chest patch
  // SLAB shoulders (the silhouette)
  box(THREE, torso, dark, 1.34, 0.3, 0.6, 0, 0.62, -0.02);
  box(THREE, torso, skin, 0.42, 0.22, 0.55, -0.52, 0.8, 0);      // shoulder humps
  box(THREE, torso, skin, 0.42, 0.22, 0.55, 0.52, 0.8, 0);
  // embedded rebar + debris jutting from left slab
  for (const [rx, rz, tilt] of [[-0.6, -0.1, -0.45], [-0.44, 0.12, -0.2], [-0.68, 0.14, -0.6]]) {
    const r = cyl(THREE, torso, iron, 0.025, 0.025, 0.5, rx, 0.98, rz, 5);
    r.rotation.z = tilt; r.rotation.x = rz;
  }
  box(THREE, torso, iron, 0.2, 0.06, 0.24, 0.5, 0.93, 0.05).rotation.z = 0.3; // plate shard
  // tiny head sunk between the slabs
  const head = pivot(THREE, torso, 0, 0.74, 0.24);
  parts.head = head;
  box(THREE, head, skin, 0.22, 0.2, 0.22, 0, 0.1, 0);
  add(head, new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.03, 0.02), glowMat(THREE, 0xffb36a, 0.7)), 0, 0.12, 0.115, false); // eye slit
  // knuckle-dragging arms, fists bigger than the head
  const mkArm = (sx) => {
    const sh = pivot(THREE, torso, sx * 0.72, 0.6, 0.05);
    sh.rotation.z = sx * 0.12;
    box(THREE, sh, skin, 0.26, 0.7, 0.26, 0, -0.32, 0);
    box(THREE, sh, skin, 0.23, 0.6, 0.23, 0, -0.85, 0.05);
    const fist = box(THREE, sh, dark, 0.4, 0.36, 0.42, sx * 0.03, -1.22, 0.08);
    fist.rotation.x = 0.15;
    return { sh, fist };
  };
  const aL = mkArm(-1), aR = mkArm(1);
  parts.armL = aL.sh; parts.armR = aR.sh;
  // chained cuff remnant on right wrist
  const cuff = add(aR.sh, new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.045, 6, 10), iron), 0.03, -1.0, 0.06);
  cuff.rotation.x = Math.PI / 2;
  const chain = pivot(THREE, aR.sh, 0.14, -1.05, 0.12);
  parts.chain = chain;
  for (let i = 0; i < 3; i++) {
    const link = add(chain, new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.018, 5, 8), iron), 0.02, -0.06 - i * 0.09, 0.02);
    link.rotation.y = i * 1.3;
  }
  return { group, parts };
}
function animBrute(parts, group, t, moving) {
  const w = moving ? t * 2.6 : t * 0.7;
  const a = moving ? 0.34 : 0.04;
  parts.legL.rotation.x = Math.sin(w) * a;
  parts.legR.rotation.x = Math.sin(w + Math.PI) * a;
  // heavy shoulder heave — arms swing opposite legs, dragging knuckles
  parts.armL.rotation.x = Math.sin(w + Math.PI) * a * 0.8;
  parts.armR.rotation.x = Math.sin(w) * a * 0.8;
  parts.torso.rotation.z = Math.sin(w) * (moving ? 0.09 : 0.015); // side-to-side bulk sway
  parts.torso.rotation.x = 0.16 + Math.abs(Math.sin(w)) * (moving ? 0.05 : 0);
  parts.head.rotation.y = Math.sin(t * 0.9) * 0.25;
  parts.chain.rotation.x = Math.sin(w * 1.7) * 0.5;              // chain swings
  parts.chain.rotation.z = Math.cos(w * 1.3) * 0.3;
  group.position.y = Math.abs(Math.sin(w)) * (moving ? 0.04 : 0);
}

// ===========================================================================
// BLOATER — swollen. Enormous glowing pustule belly, smaller boils, spindly
// limbs barely holding it, fluid drip cones.
// ===========================================================================
function buildBloater(THREE, def) {
  const { group, body } = wrap(THREE, def);
  const skin = stdMat(THREE, ROT), dark = stdMat(THREE, ROT_DARK);
  const pus = stdMat(THREE, 0x7a8a2a, { emissive: SICK, emissiveI: 0.9, rough: 0.5 });
  const boil = stdMat(THREE, 0x6a7a2e, { emissive: SICK, emissiveI: 0.55, rough: 0.5 });
  const drip = stdMat(THREE, 0x5a6a24, { emissive: SICK, emissiveI: 0.7 });
  const parts = {};

  // enormous pustule belly (dominant mass)
  const belly = sph(THREE, body, pus, 0.55, 0, 0.95, 0.08, 14, 11);
  belly.scale.set(1.05, 0.95, 1.0);
  parts.belly = belly;
  add(body, new THREE.Mesh(new THREE.SphereGeometry(0.6, 12, 9), glowMat(THREE, SICK, 0.12)), 0, 0.95, 0.08, false); // sick halo
  // smaller boils clustered on the mass
  parts.boils = [];
  for (const [bx, by, bz, r] of [
    [0.4, 1.2, 0.28, 0.14], [-0.42, 1.05, 0.3, 0.12], [0.3, 0.68, 0.38, 0.11],
    [-0.28, 1.32, -0.1, 0.1], [0.48, 0.9, -0.25, 0.12], [-0.2, 0.72, 0.44, 0.09],
  ]) parts.boils.push(sph(THREE, body, boil, r, bx, by, bz, 8, 6));
  // small head atop the mass, half-swallowed
  const head = pivot(THREE, body, 0, 1.5, 0.16);
  head.rotation.x = 0.2;
  parts.head = head;
  box(THREE, head, skin, 0.24, 0.22, 0.24, 0, 0.1, 0);
  box(THREE, head, dark, 0.14, 0.08, 0.08, 0, 0.0, 0.13);        // swollen-shut face
  add(head, new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.02), glowMat(THREE, SICK, 0.8)), -0.06, 0.1, 0.125, false);
  // spindly arms splayed out, barely balancing
  const armL = pivot(THREE, body, -0.5, 1.25, 0.05);
  armL.rotation.z = 0.9;
  parts.armL = armL;
  cyl(THREE, armL, skin, 0.05, 0.06, 0.5, 0, -0.25, 0, 6);
  cyl(THREE, armL, skin, 0.04, 0.05, 0.4, 0, -0.62, 0.06, 6);
  const armR = pivot(THREE, body, 0.5, 1.25, 0.05);
  armR.rotation.z = -0.9;
  parts.armR = armR;
  cyl(THREE, armR, skin, 0.05, 0.06, 0.5, 0, -0.25, 0, 6);
  cyl(THREE, armR, skin, 0.04, 0.05, 0.4, 0, -0.62, 0.06, 6);
  // spindly bowed legs under the bulk
  const legL = pivot(THREE, body, -0.22, 0.55, 0);
  parts.legL = legL;
  cyl(THREE, legL, dark, 0.06, 0.07, 0.55, -0.06, -0.27, 0, 6).rotation.z = 0.22;
  box(THREE, legL, dark, 0.14, 0.07, 0.22, -0.12, -0.52, 0.04);
  const legR = pivot(THREE, body, 0.22, 0.55, 0);
  parts.legR = legR;
  cyl(THREE, legR, dark, 0.06, 0.07, 0.55, 0.06, -0.27, 0, 6).rotation.z = -0.22;
  box(THREE, legR, dark, 0.14, 0.07, 0.22, 0.12, -0.52, 0.04);
  // fluid drip cones hanging off the belly underside
  parts.drips = [];
  for (const [dx, dz, l] of [[0.2, 0.3, 0.22], [-0.25, 0.2, 0.3], [0.05, 0.42, 0.18], [-0.1, -0.3, 0.24]]) {
    const d = cone(THREE, body, drip, 0.05, l, dx, 0.5 - l * 0.5, dz, 5);
    d.rotation.x = Math.PI; parts.drips.push(d);
  }
  return { group, parts };
}
function animBloater(parts, group, t, moving) {
  const w = moving ? t * 3.4 : t * 0.9;
  const a = moving ? 0.3 : 0.03;
  parts.legL.rotation.x = Math.sin(w) * a;
  parts.legR.rotation.x = Math.sin(w + Math.PI) * a;
  // belly breathes — queasy pulse
  const p = 1 + Math.sin(t * 2.3) * 0.05 + Math.sin(t * 5.1) * 0.015;
  parts.belly.scale.set(1.05 * p, 0.95 / p, 1.0 * p);
  for (let i = 0; i < parts.boils.length; i++) {
    const q = 1 + Math.sin(t * 3 + i * 1.9) * 0.18;
    parts.boils[i].scale.setScalar(q);
  }
  parts.armL.rotation.z = 0.9 + Math.sin(w + 0.7) * 0.12;        // flailing for balance
  parts.armR.rotation.z = -0.9 - Math.sin(w + 2.1) * 0.12;
  parts.head.rotation.z = Math.sin(t * 1.4) * 0.12;
  group.rotation.z = Math.sin(w) * (moving ? 0.06 : 0.01);       // top-heavy waddle
  group.position.y = Math.abs(Math.sin(w)) * (moving ? 0.03 : 0);
}

// ===========================================================================
// SCREAMER — banshee. Unhinged jaw over a glowing throat, chest cavity split
// open with ribs flared outward, long claw fingers, hunched high shoulders.
// ===========================================================================
function buildScreamer(THREE, def) {
  const { group, body } = wrap(THREE, def);
  const skin = stdMat(THREE, ROT), dark = stdMat(THREE, ROT_DARK);
  const gore = stdMat(THREE, GORE, { emissive: 0x5a1208, emissiveI: 0.6 });
  const bone = stdMat(THREE, BONE, { rough: 0.55 });
  const parts = {};

  // gaunt legs
  const legL = pivot(THREE, body, -0.13, 0.85, 0);
  parts.legL = legL;
  box(THREE, legL, dark, 0.13, 0.5, 0.15, 0, -0.24, 0);
  box(THREE, legL, skin, 0.11, 0.36, 0.11, 0, -0.62, -0.02);
  box(THREE, legL, dark, 0.12, 0.08, 0.24, 0, -0.81, 0.05);
  const legR = pivot(THREE, body, 0.13, 0.85, 0);
  parts.legR = legR;
  box(THREE, legR, dark, 0.13, 0.5, 0.15, 0, -0.24, 0);
  box(THREE, legR, skin, 0.11, 0.36, 0.11, 0, -0.62, -0.02);
  box(THREE, legR, dark, 0.12, 0.08, 0.24, 0, -0.81, 0.05);
  // hunched torso, shoulders shoved HIGH
  const torso = pivot(THREE, body, 0, 0.95, 0);
  torso.rotation.x = 0.28;
  parts.torso = torso;
  box(THREE, torso, skin, 0.4, 0.6, 0.26, 0, 0.28, 0);
  // hunched high shoulder pauldrons of flesh — above head base
  box(THREE, torso, dark, 0.26, 0.3, 0.3, -0.3, 0.62, -0.04).rotation.z = 0.35;
  box(THREE, torso, dark, 0.26, 0.3, 0.3, 0.3, 0.62, -0.04).rotation.z = -0.35;
  cone(THREE, torso, bone, 0.05, 0.2, -0.34, 0.8, -0.04, 4);     // shoulder spurs
  cone(THREE, torso, bone, 0.05, 0.2, 0.34, 0.8, -0.04, 4);
  // chest cavity split open: glowing gore core + ribs flared OUTWARD
  box(THREE, torso, gore, 0.2, 0.4, 0.1, 0, 0.3, 0.12);
  add(torso, new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.32, 0.06), glowMat(THREE, SICK, 0.35)), 0, 0.3, 0.17, false);
  parts.ribsL = []; parts.ribsR = [];
  for (let i = 0; i < 4; i++) {
    const y = 0.12 + i * 0.12;
    const rl = box(THREE, torso, bone, 0.05, 0.04, 0.26, -0.16, y, 0.16);
    rl.rotation.y = -0.85 - i * 0.08; parts.ribsL.push(rl);
    const rr = box(THREE, torso, bone, 0.05, 0.04, 0.26, 0.16, y, 0.16);
    rr.rotation.y = 0.85 + i * 0.08; parts.ribsR.push(rr);
  }
  // head between the high shoulders — thrown BACK mid-shriek
  const head = pivot(THREE, torso, 0, 0.66, 0.06);
  head.rotation.x = -0.55;
  parts.head = head;
  box(THREE, head, skin, 0.26, 0.24, 0.26, 0, 0.12, 0);
  add(head, new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.02), glowMat(THREE, SICK, 0.9)), -0.07, 0.17, 0.135, false); // hollow eyes
  add(head, new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.02), glowMat(THREE, SICK, 0.9)), 0.07, 0.17, 0.135, false);
  // unhinged jaw + glowing throat
  const jaw = pivot(THREE, head, 0, 0.02, 0.1);
  parts.jaw = jaw;
  box(THREE, jaw, skin, 0.2, 0.08, 0.2, 0, -0.1, 0.03).rotation.x = 0.9;
  const throat = add(head, new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.12, 0.08), glowMat(THREE, SICK, 0.85)), 0, 0.02, 0.1, false);
  parts.throat = throat;
  // long arms with claw fingers, raised half-spread
  const mkArm = (sx) => {
    const sh = pivot(THREE, torso, sx * 0.28, 0.56, 0);
    sh.rotation.z = sx * 1.0; sh.rotation.x = -0.3;
    box(THREE, sh, skin, 0.1, 0.5, 0.1, 0, -0.25, 0);
    box(THREE, sh, skin, 0.08, 0.42, 0.08, 0, -0.64, 0.04);
    for (let f = 0; f < 3; f++) {
      const claw = cone(THREE, sh, bone, 0.025, 0.26, (f - 1) * 0.05, -0.96, 0.06 + f * 0.02, 4);
      claw.rotation.x = Math.PI - 0.25;
    }
    return sh;
  };
  parts.armL = mkArm(-1); parts.armR = mkArm(1);
  return { group, parts };
}
function animScreamer(parts, group, t, moving) {
  const w = moving ? t * 5.2 : t * 1.3;
  const a = moving ? 0.5 : 0.06;
  parts.legL.rotation.x = Math.sin(w) * a;
  parts.legR.rotation.x = Math.sin(w + Math.PI) * a;
  // shriek cycle — jaw gapes wide, throat flares, ribs shudder
  const shriek = Math.max(0, Math.sin(t * 2.2));
  parts.jaw.rotation.x = 0.2 + shriek * 0.9;
  parts.throat.material.opacity = 0.35 + shriek * 0.55;
  parts.head.rotation.x = -0.55 - shriek * 0.25;
  const shud = Math.sin(t * 14) * 0.06 * shriek;
  for (let i = 0; i < parts.ribsL.length; i++) {
    parts.ribsL[i].rotation.y = -0.85 - i * 0.08 - shud;
    parts.ribsR[i].rotation.y = 0.85 + i * 0.08 + shud;
  }
  parts.armL.rotation.z = -1.0 - shriek * 0.35 + Math.sin(w) * 0.08;
  parts.armR.rotation.z = 1.0 + shriek * 0.35 - Math.sin(w) * 0.08;
  parts.torso.rotation.x = 0.28 - shriek * 0.1;
  parts.torso.rotation.y = Math.sin(w * 0.5) * (moving ? 0.12 : 0.04);
  group.position.y = Math.abs(Math.sin(w)) * (moving ? 0.05 : 0);
}

// ===========================================================================
export const BUILDERS = {
  shambler: (THREE, def) => buildShambler(THREE, def),
  sprinter: (THREE, def) => buildSprinter(THREE, def),
  brute:    (THREE, def) => buildBrute(THREE, def),
  bloater:  (THREE, def) => buildBloater(THREE, def),
  screamer: (THREE, def) => buildScreamer(THREE, def),
};

export const ANIMATE = {
  shambler: animShambler,
  sprinter: animSprinter,
  brute:    animBrute,
  bloater:  animBloater,
  screamer: animScreamer,
};
