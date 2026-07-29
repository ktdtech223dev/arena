// towers_b.js — code-built tower models, batch B: acid, hive, sniper, banner, overclocker.
// Contract: BUILDERS[id](THREE, tiers) -> { group, parts }. tiers = [tierA 0-3, tierB 0-3].
// Style: MeshStandardMaterial (lit) + MeshBasicMaterial additive glow only. Origin at base center.

const GUNMETAL = 0x2a3340;
const DARKSTEEL = 0x1a2028;
const IRON = 0x3a4148;
const GOLD = 0xffd166;
const ACC_DAMAGE = 0xff8a4a;
const ACC_BUFF = 0x9fe86a;
const ACC_DEBUFF = 0x7db2ff;

function stdMat(THREE, color, roughness = 0.6, metalness = 0.55) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

function glowMat(THREE, color, opacity = 0.9) {
  return new THREE.MeshBasicMaterial({
    color, transparent: true, opacity,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
}

function put(parent, mesh, x = 0, y = 0, z = 0) {
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

function lit(THREE, parent, geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  return put(parent, m, x, y, z);
}

function glow(THREE, parent, geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = false;
  return put(parent, m, x, y, z);
}

// Shared plinth: cylinder r0.85 -> 1.05, h 0.5, gunmetal + role-accent glow trim ring.
// Trim goes GOLD when either path is maxed.
function plinth(THREE, group, accent, maxed) {
  const base = lit(THREE, group,
    new THREE.CylinderGeometry(0.85, 1.05, 0.5, 12),
    stdMat(THREE, GUNMETAL, 0.7, 0.5), 0, 0.25, 0);
  const trim = glow(THREE, group,
    new THREE.TorusGeometry(0.9, 0.045, 6, 18),
    glowMat(THREE, maxed ? GOLD : accent, 0.95), 0, 0.48, 0);
  trim.rotation.x = -Math.PI / 2;
  return base;
}

// ---------------------------------------------------------------- ACID
// Hazard-striped chem vat + articulated spray arm, drip stains, bubbling dome cap.
function buildAcid(THREE, tiers) {
  const [a, b] = tiers;
  const maxed = a >= 3 || b >= 3;
  const accent = ACC_DEBUFF;
  const group = new THREE.Group();
  const parts = {};

  const mSteel = stdMat(THREE, DARKSTEEL, 0.55, 0.6);
  const mGun = stdMat(THREE, GUNMETAL, 0.65, 0.5);
  const mIron = stdMat(THREE, IRON, 0.5, 0.65);
  const mHaz = stdMat(THREE, GOLD, 0.55, 0.3);
  const mStain = new THREE.MeshStandardMaterial({
    color: 0x22405a, roughness: 0.35, metalness: 0.2,
    emissive: accent, emissiveIntensity: 0.25,
  });
  const gAcc = glowMat(THREE, maxed ? GOLD : accent);

  plinth(THREE, group, accent, maxed);

  // Drip stains running down the plinth slope.
  for (let i = 0; i < 3; i++) {
    const ang = 0.7 + i * 2.1;
    const d = lit(THREE, group, new THREE.BoxGeometry(0.16, 0.42, 0.03), mStain,
      Math.cos(ang) * 0.94, 0.26, Math.sin(ang) * 0.94);
    d.rotation.y = -ang + Math.PI / 2;
    d.rotation.x = 0.22 * (Math.cos(ang) >= 0 ? 1 : 1); // lean against the cone slope
    d.lookAt(0, 0.26, 0);
    d.rotateX(-0.2);
  }

  // Pedestal + bulbous main vat with rivet bands.
  lit(THREE, group, new THREE.CylinderGeometry(0.5, 0.6, 0.45, 10), mSteel, 0, 0.72, 0);
  const vat = lit(THREE, group, new THREE.SphereGeometry(0.6, 12, 10), mGun, 0, 1.4, 0);
  vat.scale.set(1, 1.12, 1);
  for (const y of [1.18, 1.58]) {
    const band = lit(THREE, group, new THREE.TorusGeometry(0.585, 0.05, 6, 14), mIron, 0, y, 0);
    band.rotation.x = Math.PI / 2;
  }
  // Hazard stripe band around the vat equator.
  lit(THREE, group, new THREE.CylinderGeometry(0.635, 0.635, 0.16, 12), mSteel, 0, 1.4, 0);
  for (let i = 0; i < 4; i++) {
    const ang = i * (Math.PI / 2) + 0.4;
    const s = lit(THREE, group, new THREE.BoxGeometry(0.14, 0.13, 0.03), mHaz,
      Math.cos(ang) * 0.645, 1.4, Math.sin(ang) * 0.645);
    s.rotation.y = -ang + Math.PI / 2;
    s.rotation.z = 0.6;
  }

  // Bubbling dome cap.
  lit(THREE, group, new THREE.CylinderGeometry(0.3, 0.36, 0.12, 10), mIron, 0, 2.03, 0);
  glow(THREE, group, new THREE.SphereGeometry(0.24, 10, 8), gAcc, 0, 2.12, 0);
  glow(THREE, group, new THREE.SphereGeometry(0.06, 6, 5), gAcc, 0.14, 2.32, 0.05);
  glow(THREE, group, new THREE.SphereGeometry(0.045, 6, 5), gAcc, -0.1, 2.42, -0.08);

  // Articulated spray arm (yaw head). Path B beefs it up.
  const yawNode = new THREE.Group();
  yawNode.position.set(0, 1.95, 0);
  group.add(yawNode);
  const armScale = 1 + b * 0.13;
  lit(THREE, yawNode, new THREE.CylinderGeometry(0.14, 0.18, 0.22, 8), mIron, 0, 0, 0);
  const armLen = 0.62 * armScale;
  const arm = lit(THREE, yawNode, new THREE.BoxGeometry(0.11, 0.11, armLen), mGun, 0, 0.12, armLen / 2 + 0.05);
  arm.rotation.x = -0.18;
  const elbowZ = (armLen + 0.08) * Math.cos(0.18);
  lit(THREE, yawNode, new THREE.SphereGeometry(0.09 * armScale, 8, 6), mIron, 0, 0.24, elbowZ);
  // Nozzle cluster hanging from the elbow.
  const hub = lit(THREE, yawNode, new THREE.CylinderGeometry(0.1 * armScale, 0.13 * armScale, 0.14, 8), mSteel,
    0, 0.1, elbowZ + 0.06);
  const nNoz = 3 + Math.min(b, 2);
  for (let i = 0; i < nNoz; i++) {
    const ang = (i / nNoz) * Math.PI * 2;
    const nz = lit(THREE, yawNode, new THREE.ConeGeometry(0.035, 0.14, 6), mIron,
      Math.cos(ang) * 0.07 * armScale, -0.02, elbowZ + 0.06 + Math.sin(ang) * 0.07 * armScale);
    nz.rotation.x = Math.PI;
  }
  glow(THREE, yawNode, new THREE.SphereGeometry(0.06 * armScale, 6, 5), gAcc, 0, -0.1, elbowZ + 0.06);
  if (b >= 2) {
    // Second arm segment with feeder hose ring.
    const seg = lit(THREE, yawNode, new THREE.BoxGeometry(0.09, 0.09, 0.34), mGun, 0, 0.3, elbowZ * 0.45);
    seg.rotation.x = 0.35;
    const hose = lit(THREE, yawNode, new THREE.TorusGeometry(0.14, 0.03, 6, 10), mSteel, 0, 0.34, 0.1);
    hose.rotation.y = Math.PI / 2;
  }

  // Path A: second tank + glowing sludge lines.
  if (a >= 1) {
    const t2 = lit(THREE, group, new THREE.SphereGeometry(0.34 + a * 0.03, 10, 8), mGun, -0.66, 1.05, -0.2);
    t2.scale.set(1, 1.2, 1);
    const b2 = lit(THREE, group, new THREE.TorusGeometry(0.33 + a * 0.03, 0.04, 6, 12), mIron, -0.66, 1.05, -0.2);
    b2.rotation.x = Math.PI / 2;
    lit(THREE, group, new THREE.CylinderGeometry(0.05, 0.05, 0.5, 6), mSteel, -0.4, 1.35, -0.12)
      .rotation.z = 1.1;
  }
  if (a >= 2) {
    for (let i = 0; i < 3; i++) {
      const ang = i * 2.1 + 0.9;
      const line = glow(THREE, group, new THREE.BoxGeometry(0.045, 0.6, 0.02), gAcc,
        Math.cos(ang) * 0.6, 1.42, Math.sin(ang) * 0.6);
      line.lookAt(0, 1.42, 0);
    }
  }
  if (a >= 3) {
    const ring = glow(THREE, group, new THREE.TorusGeometry(0.4, 0.035, 6, 14), gAcc, 0, 2.0, 0);
    ring.rotation.x = Math.PI / 2;
    glow(THREE, group, new THREE.SphereGeometry(0.05, 6, 5), gAcc, -0.66, 1.55, -0.2);
  }

  parts.yawNode = yawNode;
  return { group, parts };
}

// ---------------------------------------------------------------- HIVE
// Hexagonal drone coop: stacked hex cells, landing pad ring w/ blinkers, docked drones.
function buildHive(THREE, tiers) {
  const [a, b] = tiers;
  const maxed = a >= 3 || b >= 3;
  const accent = ACC_DAMAGE;
  const group = new THREE.Group();
  const parts = {};

  const mSteel = stdMat(THREE, DARKSTEEL, 0.55, 0.6);
  const mGun = stdMat(THREE, GUNMETAL, 0.65, 0.5);
  const mIron = stdMat(THREE, IRON, 0.5, 0.65);
  const gAcc = glowMat(THREE, maxed ? GOLD : accent);
  const gWarhead = glowMat(THREE, ACC_DAMAGE);

  plinth(THREE, group, accent, maxed);

  // Landing pad ring with blinkers (slow spinner).
  const spinner = new THREE.Group();
  spinner.position.y = 0.56;
  group.add(spinner);
  const pad = lit(THREE, spinner, new THREE.TorusGeometry(0.78, 0.07, 6, 18), mIron, 0, 0, 0);
  pad.rotation.x = -Math.PI / 2;
  for (let i = 0; i < 4; i++) {
    const ang = i * (Math.PI / 2);
    glow(THREE, spinner, new THREE.SphereGeometry(0.05, 6, 5), gAcc,
      Math.cos(ang) * 0.78, 0.07, Math.sin(ang) * 0.78);
  }

  // Core hex column.
  lit(THREE, group, new THREE.CylinderGeometry(0.46, 0.52, 1.25, 6), mGun, 0, 1.15, 0);

  // Hex cells bolted around the core; some open with glow fronts. Layers grow with path A.
  const cellMatOpen = gAcc;
  const layers = 1 + Math.min(a, 3);
  let cellIdx = 0;
  for (let L = 0; L < layers; L++) {
    const y = 0.95 + L * 0.42;
    const n = L === 0 ? 3 : 3;
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2 + L * 0.6;
      const cx = Math.cos(ang) * 0.62, cz = Math.sin(ang) * 0.62;
      const cell = lit(THREE, group, new THREE.CylinderGeometry(0.22, 0.22, 0.34, 6), mSteel, cx, y, cz);
      cell.rotation.z = Math.PI / 2;
      cell.rotation.y = -ang;
      // Every other cell reads "open" with a glow face.
      if (cellIdx % 2 === 0) {
        const face = glow(THREE, group, new THREE.CircleGeometry(0.15, 6),
          cellIdx % 4 === 0 ? cellMatOpen : gAcc,
          Math.cos(ang) * 0.82, y, Math.sin(ang) * 0.82);
        face.lookAt(Math.cos(ang) * 2, y, Math.sin(ang) * 2);
      }
      cellIdx++;
    }
  }

  // Docked drone silhouettes (folded): body + 2 swept wings. Path B tips them with warheads.
  const droneCount = 1 + Math.min(a, 2) + Math.min(b, 2);
  const mDrone = stdMat(THREE, IRON, 0.45, 0.7);
  for (let i = 0; i < droneCount; i++) {
    const ang = 0.5 + i * 1.5;
    const dr = new THREE.Group();
    dr.position.set(Math.cos(ang) * 0.72, 0.68 + (i % 2) * 0.02, Math.sin(ang) * 0.72);
    dr.rotation.y = -ang;
    group.add(dr);
    lit(THREE, dr, new THREE.BoxGeometry(0.1, 0.06, 0.26), mDrone, 0, 0, 0);
    const w1 = lit(THREE, dr, new THREE.BoxGeometry(0.2, 0.02, 0.09), mDrone, 0.1, 0.03, -0.03);
    w1.rotation.y = 0.5;
    const w2 = lit(THREE, dr, new THREE.BoxGeometry(0.2, 0.02, 0.09), mDrone, -0.1, 0.03, -0.03);
    w2.rotation.y = -0.5;
    if (b >= 1 && i < b + 1) {
      const tip = glow(THREE, dr, new THREE.ConeGeometry(0.04, 0.1, 6), gWarhead, 0, 0, 0.17);
      tip.rotation.x = Math.PI / 2;
    }
  }

  // Yaw head: sensor cap that tracks launch direction.
  const capY = 0.95 + layers * 0.42 + 0.18;
  const yawNode = new THREE.Group();
  yawNode.position.y = capY;
  group.add(yawNode);
  lit(THREE, yawNode, new THREE.CylinderGeometry(0.3, 0.42, 0.22, 6), mIron, 0, 0, 0);
  const eye = glow(THREE, yawNode, new THREE.CircleGeometry(0.09, 8), gAcc, 0, 0.02, 0.41);
  eye.lookAt(0, capY, 2);
  lit(THREE, yawNode, new THREE.CylinderGeometry(0.02, 0.02, 0.4, 5), mSteel, 0.12, 0.3, -0.08);
  glow(THREE, yawNode, new THREE.SphereGeometry(0.035, 6, 5), gAcc, 0.12, 0.5, -0.08);

  // Path B >= 3: warhead rack on the cap.
  if (b >= 3) {
    const rack = lit(THREE, yawNode, new THREE.BoxGeometry(0.4, 0.08, 0.18), mSteel, 0, 0.16, 0.12);
    for (let i = 0; i < 3; i++) {
      const wtip = glow(THREE, yawNode, new THREE.ConeGeometry(0.035, 0.1, 6), gWarhead,
        -0.12 + i * 0.12, 0.16, 0.25);
      wtip.rotation.x = Math.PI / 2;
    }
  }

  parts.yawNode = yawNode;
  parts.spinner = spinner;
  return { group, parts };
}

// ---------------------------------------------------------------- SNIPER
// Watchtower nest: 4 stilts, sandbag ring platform, long AM rifle on pintle, awning.
function buildSniper(THREE, tiers) {
  const [a, b] = tiers;
  const maxed = a >= 3 || b >= 3;
  const accent = ACC_DAMAGE;
  const group = new THREE.Group();
  const parts = {};

  const mSteel = stdMat(THREE, DARKSTEEL, 0.55, 0.6);
  const mGun = stdMat(THREE, GUNMETAL, 0.65, 0.5);
  const mIron = stdMat(THREE, IRON, 0.5, 0.65);
  const mCanvas = stdMat(THREE, 0x4a4a3c, 0.9, 0.05);
  const mBag = stdMat(THREE, 0x555a4c, 0.95, 0.02);
  const gAcc = glowMat(THREE, maxed ? GOLD : accent);

  plinth(THREE, group, accent, maxed);

  // Four stilts leaning inward to the platform.
  for (let i = 0; i < 4; i++) {
    const ang = Math.PI / 4 + i * (Math.PI / 2);
    const s = lit(THREE, group, new THREE.BoxGeometry(0.12, 1.45, 0.12), mGun,
      Math.cos(ang) * 0.62, 1.18, Math.sin(ang) * 0.62);
    s.rotation.z = -Math.cos(ang) * 0.16; // lean inward toward the platform
    s.rotation.x = Math.sin(ang) * 0.16;
  }
  // Cross-brace.
  const brace = lit(THREE, group, new THREE.BoxGeometry(0.9, 0.07, 0.07), mIron, 0, 1.1, 0);
  brace.rotation.y = Math.PI / 4;

  // Platform + sandbag ring.
  lit(THREE, group, new THREE.CylinderGeometry(0.72, 0.66, 0.12, 10), mSteel, 0, 1.88, 0);
  const bags = lit(THREE, group, new THREE.TorusGeometry(0.62, 0.1, 6, 12), mBag, 0, 1.99, 0);
  bags.rotation.x = -Math.PI / 2;
  for (let i = 0; i < 4; i++) {
    const ang = 0.4 + i * 1.65;
    const lump = lit(THREE, group, new THREE.SphereGeometry(0.09, 7, 5), mBag,
      Math.cos(ang) * 0.62, 2.05, Math.sin(ang) * 0.62);
    lump.scale.set(1.4, 0.7, 1);
    lump.rotation.y = -ang;
  }

  // Canvas awning slab on two posts (rear of platform).
  lit(THREE, group, new THREE.CylinderGeometry(0.03, 0.03, 0.62, 6), mIron, -0.35, 2.24, -0.5);
  lit(THREE, group, new THREE.CylinderGeometry(0.03, 0.03, 0.62, 6), mIron, 0.35, 2.24, -0.5);
  const awn = lit(THREE, group, new THREE.BoxGeometry(1.0, 0.05, 0.72), mCanvas, 0, 2.56, -0.36);
  awn.rotation.x = 0.28;

  // Rifle on pintle (yaw head).
  const yawNode = new THREE.Group();
  yawNode.position.y = 2.02;
  group.add(yawNode);
  lit(THREE, yawNode, new THREE.CylinderGeometry(0.07, 0.1, 0.3, 8), mIron, 0, 0.1, 0);
  const rifle = new THREE.Group();
  rifle.position.y = 0.3;
  yawNode.add(rifle);
  lit(THREE, rifle, new THREE.BoxGeometry(0.14, 0.16, 0.55), mGun, 0, 0, 0.05);
  const barrelLen = 1.1 + a * 0.25;
  lit(THREE, rifle, new THREE.CylinderGeometry(0.038, 0.045, barrelLen, 8), mSteel, 0, 0.02, 0.32 + barrelLen / 2)
    .rotation.x = Math.PI / 2;
  // Muzzle brake.
  lit(THREE, rifle, new THREE.BoxGeometry(0.09, 0.09, 0.16), mIron, 0, 0.02, 0.32 + barrelLen);
  // Scope + glint disc.
  lit(THREE, rifle, new THREE.CylinderGeometry(0.045, 0.045, 0.3, 8), mSteel, 0, 0.14, 0.1)
    .rotation.x = Math.PI / 2;
  const glint = glow(THREE, rifle, new THREE.CircleGeometry(0.05, 8), gAcc, 0, 0.14, 0.26);
  glint.rotation.x = 0; // faces +z by default
  // Stock.
  const stock = lit(THREE, rifle, new THREE.BoxGeometry(0.1, 0.14, 0.3), mIron, 0, -0.03, -0.32);
  stock.rotation.x = 0.15;

  // Path A: rangefinder mast on the platform.
  if (a >= 2) {
    lit(THREE, group, new THREE.CylinderGeometry(0.025, 0.03, 0.85, 6), mIron, 0.55, 2.45, -0.25);
    lit(THREE, group, new THREE.BoxGeometry(0.2, 0.05, 0.05), mSteel, 0.55, 2.8, -0.25);
    glow(THREE, group, new THREE.SphereGeometry(0.04, 6, 5), gAcc, 0.55, 2.92, -0.25);
  }
  if (a >= 3) {
    glow(THREE, group, new THREE.CircleGeometry(0.06, 8), gAcc, 0.65, 2.8, -0.22)
      .lookAt(2, 2.8, 2);
  }

  // Path B: spotter dish on a side arm of the rifle mount.
  if (b >= 1) {
    const dishScale = 1 + (b - 1) * 0.25;
    lit(THREE, yawNode, new THREE.BoxGeometry(0.3, 0.05, 0.06), mIron, -0.24, 0.26, -0.05);
    const dish = lit(THREE, yawNode, new THREE.CylinderGeometry(0.14 * dishScale, 0.05 * dishScale, 0.07, 10), mSteel,
      -0.38, 0.3, -0.05);
    dish.rotation.x = Math.PI / 2;
    glow(THREE, yawNode, new THREE.SphereGeometry(0.035 * dishScale, 6, 5), gAcc, -0.38, 0.3, 0.0);
  }
  if (b >= 3) {
    const dish2 = lit(THREE, yawNode, new THREE.CylinderGeometry(0.08, 0.03, 0.05, 8), mSteel, 0.3, 0.34, -0.1);
    dish2.rotation.x = Math.PI / 2;
    glow(THREE, yawNode, new THREE.SphereGeometry(0.025, 6, 5), gAcc, 0.3, 0.34, -0.06);
  }

  parts.yawNode = yawNode;
  return { group, parts };
}

// ---------------------------------------------------------------- BANNER
// War standard: planted pole, kinked two-panel flag, skull totem, tassels, stakes.
function buildBanner(THREE, tiers) {
  const [a, b] = tiers;
  const maxed = a >= 3 || b >= 3;
  const accent = ACC_BUFF;
  const group = new THREE.Group();
  const parts = {};

  const mSteel = stdMat(THREE, DARKSTEEL, 0.55, 0.6);
  const mIron = stdMat(THREE, IRON, 0.5, 0.65);
  const mBone = stdMat(THREE, 0xb8b0a0, 0.8, 0.05);
  const mFlag = new THREE.MeshStandardMaterial({
    color: 0x3f6a2a, roughness: 0.85, metalness: 0.05,
    emissive: ACC_BUFF, emissiveIntensity: 0.12, side: 2, // THREE.DoubleSide
  });
  const mRope = stdMat(THREE, 0x6a5a3c, 0.9, 0.02);
  const gAcc = glowMat(THREE, maxed ? GOLD : accent);
  const gEmber = glowMat(THREE, ACC_DAMAGE, 0.95);

  plinth(THREE, group, accent, maxed);

  // Planted pole with collar.
  lit(THREE, group, new THREE.CylinderGeometry(0.055, 0.075, 2.65, 8), mIron, 0, 1.8, 0);
  lit(THREE, group, new THREE.CylinderGeometry(0.11, 0.13, 0.14, 8), mSteel, 0, 0.56, 0);

  // Ground stakes angled into the plinth with a guy rope.
  for (let i = 0; i < 3; i++) {
    const ang = 0.9 + i * 2.1;
    const st = lit(THREE, group, new THREE.BoxGeometry(0.08, 0.4, 0.08), mSteel,
      Math.cos(ang) * 0.72, 0.6, Math.sin(ang) * 0.72);
    st.rotation.z = -Math.cos(ang) * 0.5;
    st.rotation.x = Math.sin(ang) * 0.5;
  }
  const rope = lit(THREE, group, new THREE.CylinderGeometry(0.015, 0.015, 1.35, 5), mRope, 0.36, 1.25, 0.28);
  rope.rotation.z = 0.55;
  rope.rotation.x = -0.4;

  // Kinked flag slab: two panels with a bend so it reads waving.
  const p1 = lit(THREE, group, new THREE.BoxGeometry(0.72, 0.52, 0.035), mFlag, 0.42, 2.72, 0);
  p1.rotation.y = 0.1;
  const p2 = lit(THREE, group, new THREE.BoxGeometry(0.5, 0.48, 0.035), mFlag, 0.98, 2.68, 0.14);
  p2.rotation.y = 0.65;
  // Glow sigil on the lead panel.
  const sigil = glow(THREE, group, new THREE.CircleGeometry(0.13, 8), gAcc, 0.42, 2.72, 0.03);
  sigil.rotation.y = 0.1;

  // Crossbar + rope tassels.
  const bar = lit(THREE, group, new THREE.CylinderGeometry(0.03, 0.03, 0.85, 6), mIron, 0.4, 3.0, 0);
  bar.rotation.z = Math.PI / 2;
  for (const tx of [0.16, 0.66]) {
    lit(THREE, group, new THREE.CylinderGeometry(0.012, 0.012, 0.26, 5), mRope, tx, 2.86, 0.06);
    lit(THREE, group, new THREE.SphereGeometry(0.035, 6, 5), mRope, tx, 2.7, 0.06);
  }

  // Skull totem topper.
  const skull = lit(THREE, group, new THREE.SphereGeometry(0.16, 10, 8), mBone, 0, 3.28, 0);
  skull.scale.set(0.92, 1, 0.98);
  lit(THREE, group, new THREE.BoxGeometry(0.14, 0.09, 0.1), mBone, 0, 3.14, 0.05);
  glow(THREE, group, new THREE.SphereGeometry(0.028, 6, 5), gAcc, -0.06, 3.3, 0.13);
  glow(THREE, group, new THREE.SphereGeometry(0.028, 6, 5), gAcc, 0.06, 3.3, 0.13);

  // Path A: second pennant lower on the pole, then glow trim, then gold crown.
  if (a >= 1) {
    const q1 = lit(THREE, group, new THREE.BoxGeometry(0.5, 0.34, 0.03), mFlag, -0.32, 2.05, 0);
    q1.rotation.y = Math.PI + 0.15;
    const q2 = lit(THREE, group, new THREE.BoxGeometry(0.34, 0.3, 0.03), mFlag, -0.7, 2.0, -0.12);
    q2.rotation.y = Math.PI + 0.7;
  }
  if (a >= 2) {
    glow(THREE, group, new THREE.BoxGeometry(0.72, 0.04, 0.045), gAcc, 0.42, 2.45, 0)
      .rotation.y = 0.1;
  }
  if (a >= 3) {
    const crown = glow(THREE, group, new THREE.TorusGeometry(0.14, 0.025, 6, 10), glowMat(THREE, GOLD), 0, 3.42, 0);
    crown.rotation.x = -Math.PI / 2;
  }

  // Path B: brazier bowls with ember glow.
  const braziers = Math.min(b, 2);
  for (let i = 0; i < braziers; i++) {
    const ang = 2.2 + i * 2.0;
    const bx = Math.cos(ang) * 0.66, bz = Math.sin(ang) * 0.66;
    lit(THREE, group, new THREE.CylinderGeometry(0.05, 0.07, 0.32, 6), mIron, bx, 0.66, bz);
    lit(THREE, group, new THREE.CylinderGeometry(0.16, 0.09, 0.14, 8), mSteel, bx, 0.88, bz);
    glow(THREE, group, new THREE.SphereGeometry(0.09, 7, 5), gEmber, bx, 0.95, bz);
  }
  if (b >= 3) {
    for (let i = 0; i < braziers; i++) {
      const ang = 2.2 + i * 2.0;
      glow(THREE, group, new THREE.ConeGeometry(0.07, 0.22, 6), gEmber,
        Math.cos(ang) * 0.66, 1.1, Math.sin(ang) * 0.66);
    }
  }

  return { group, parts };
}

// ---------------------------------------------------------------- OVERCLOCKER
// Humming reactor: core cylinder, floating ring crown with glow vanes, heat sinks, cables.
function buildOverclocker(THREE, tiers) {
  const [a, b] = tiers;
  const maxed = a >= 3 || b >= 3;
  const accent = ACC_BUFF;
  const group = new THREE.Group();
  const parts = {};

  const mSteel = stdMat(THREE, DARKSTEEL, 0.55, 0.6);
  const mGun = stdMat(THREE, GUNMETAL, 0.65, 0.5);
  const mIron = stdMat(THREE, IRON, 0.5, 0.65);
  const gAcc = glowMat(THREE, maxed ? GOLD : accent);
  const gCore = glowMat(THREE, accent, 0.75);

  plinth(THREE, group, accent, maxed);

  // Core cylinder with inner glow column.
  lit(THREE, group, new THREE.CylinderGeometry(0.3, 0.36, 1.15, 12), mGun, 0, 1.07, 0);
  glow(THREE, group, new THREE.CylinderGeometry(0.2, 0.2, 1.3, 10), gCore, 0, 1.1, 0);
  lit(THREE, group, new THREE.CylinderGeometry(0.34, 0.3, 0.12, 12), mIron, 0, 1.68, 0);

  // Cable bus: three conduits from plinth edge up into the core.
  for (let i = 0; i < 3; i++) {
    const ang = 0.4 + i * 2.1;
    const c = lit(THREE, group, new THREE.CylinderGeometry(0.04, 0.04, 0.85, 6), mSteel,
      Math.cos(ang) * 0.52, 0.85, Math.sin(ang) * 0.52);
    c.rotation.z = -Math.cos(ang) * 0.45;
    c.rotation.x = Math.sin(ang) * 0.45;
  }

  // Heat-sink towers: finned columns flanking the core.
  for (const sx of [-0.68, 0.68]) {
    lit(THREE, group, new THREE.BoxGeometry(0.2, 0.85, 0.2), mSteel, sx, 0.92, -0.1);
    for (let f = 0; f < 3; f++) {
      lit(THREE, group, new THREE.BoxGeometry(0.3, 0.035, 0.3), mIron, sx, 0.68 + f * 0.26, -0.1);
    }
  }

  // Floating ring crown (spinner) — rises higher with every tier.
  const crown = new THREE.Group();
  crown.position.y = 1.95 + (a + b) * 0.14;
  group.add(crown);
  const ring1 = lit(THREE, crown, new THREE.TorusGeometry(0.62, 0.06, 6, 20), mGun, 0, 0, 0);
  ring1.rotation.x = Math.PI / 2;
  for (let i = 0; i < 6; i++) {
    const ang = (i / 6) * Math.PI * 2;
    const v = glow(THREE, crown, new THREE.BoxGeometry(0.07, 0.2, 0.03), gAcc,
      Math.cos(ang) * 0.62, 0, Math.sin(ang) * 0.62);
    v.rotation.y = -ang + Math.PI / 2;
  }
  glow(THREE, crown, new THREE.SphereGeometry(0.12, 8, 6), gCore, 0, 0, 0);

  // Path A: outer segmented rings + more vanes.
  if (a >= 1) {
    const ring2 = lit(THREE, crown, new THREE.TorusGeometry(0.92, 0.05, 6, 22), mIron, 0, 0.06, 0);
    ring2.rotation.x = Math.PI / 2;
  }
  if (a >= 2) {
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI * 2 + 0.5;
      const v = glow(THREE, crown, new THREE.BoxGeometry(0.06, 0.16, 0.03), gAcc,
        Math.cos(ang) * 0.92, 0.06, Math.sin(ang) * 0.92);
      v.rotation.y = -ang + Math.PI / 2;
    }
  }
  if (a >= 3) {
    const ring3 = lit(THREE, crown, new THREE.TorusGeometry(1.18, 0.045, 6, 24), mSteel, 0, 0.12, 0);
    ring3.rotation.x = Math.PI / 2;
    const halo = glow(THREE, crown, new THREE.TorusGeometry(1.18, 0.02, 6, 24), glowMat(THREE, GOLD, 0.8), 0, 0.12, 0);
    halo.rotation.x = Math.PI / 2;
  }

  // Path B: tilted accelerator ring + top halo.
  if (b >= 1) {
    const tRing = lit(THREE, crown, new THREE.TorusGeometry(0.78, 0.045, 6, 20), mIron, 0, 0.1, 0);
    tRing.rotation.x = Math.PI / 2 - 0.5;
  }
  if (b >= 2) {
    for (let i = 0; i < 4; i++) {
      const ang = (i / 4) * Math.PI * 2 + 0.3;
      glow(THREE, crown, new THREE.SphereGeometry(0.045, 6, 5), gAcc,
        Math.cos(ang) * 0.78, 0.1 + Math.sin(ang) * 0.35 * 0.5, Math.sin(ang) * 0.78 * 0.878);
    }
  }
  if (b >= 3) {
    const halo2 = glow(THREE, crown, new THREE.TorusGeometry(0.32, 0.03, 6, 14), glowMat(THREE, GOLD, 0.85), 0, 0.42, 0);
    halo2.rotation.x = Math.PI / 2;
  }

  parts.spinner = crown;
  return { group, parts };
}

export const BUILDERS = {
  acid: (THREE, tiers) => buildAcid(THREE, tiers),
  hive: (THREE, tiers) => buildHive(THREE, tiers),
  sniper: (THREE, tiers) => buildSniper(THREE, tiers),
  banner: (THREE, tiers) => buildBanner(THREE, tiers),
  overclocker: (THREE, tiers) => buildOverclocker(THREE, tiers),
};
