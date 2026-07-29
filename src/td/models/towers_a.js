// ARENA co-op Tower Defense — tower models, batch A.
// Five code-built towers: gatling, railcannon, mortar, tesla, cryo.
// Contract: BUILDERS[id](THREE, tiers) -> { group, parts }
//   tiers = [tierA 0-3, tierB 0-3]
//   parts.yawNode — aiming head (yaw-rotated by the view) where required.
//   parts.spinner — optional node the view slowly rotates.
// Style: MeshStandardMaterial (lit) + MeshBasicMaterial additive glow only.

const COL = {
  gunmetal: 0x2a3340,
  steel: 0x1a2028,
  iron: 0x3a4148,
  damage: 0xff8a4a,
  buff: 0x9fe86a,
  debuff: 0x7db2ff,
  economy: 0xffd166,
  gold: 0xffd166,
  frost: 0xb8d4e8,
};

function makeMats(THREE, accent, maxed) {
  const acc = new THREE.MeshStandardMaterial({
    color: accent, roughness: 0.45, metalness: 0.35,
    emissive: accent, emissiveIntensity: 0.35,
  });
  return {
    gunmetal: new THREE.MeshStandardMaterial({ color: COL.gunmetal, roughness: 0.7, metalness: 0.55 }),
    steel: new THREE.MeshStandardMaterial({ color: COL.steel, roughness: 0.55, metalness: 0.7 }),
    iron: new THREE.MeshStandardMaterial({ color: COL.iron, roughness: 0.85, metalness: 0.35 }),
    accent: acc,
    glow: new THREE.MeshBasicMaterial({
      color: maxed ? COL.gold : accent, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }),
  };
}

function add(THREE, parent, geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, lit = true) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.castShadow = lit;
  m.receiveShadow = lit;
  parent.add(m);
  return m;
}

// Cylinder aligned from point a to point b.
function strut(THREE, parent, mat, ax, ay, az, bx, by, bz, r, seg = 6) {
  const from = new THREE.Vector3(ax, ay, az);
  const to = new THREE.Vector3(bx, by, bz);
  const dir = to.clone().sub(from);
  const len = dir.length();
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), mat);
  m.position.copy(from).add(to).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

// Shared plinth: cylinder r0.85->1.05 h0.5 gunmetal + glow trim ring (gold at max tier).
function addPlinth(THREE, group, mats) {
  add(THREE, group, new THREE.CylinderGeometry(0.85, 1.05, 0.5, 12), mats.gunmetal, 0, 0.25, 0);
  add(THREE, group, new THREE.TorusGeometry(0.9, 0.045, 6, 24), mats.glow, 0, 0.47, 0, -Math.PI / 2, 0, 0, false);
}

// ---------------------------------------------------------------- gatling ---
function buildGatling(THREE, tiers) {
  const [a, b] = tiers;
  const mats = makeMats(THREE, COL.damage, a >= 3 || b >= 3);
  const group = new THREE.Group();
  addPlinth(THREE, group, mats);

  // Squat armored pedestal.
  add(THREE, group, new THREE.BoxGeometry(1.05, 0.35, 1.05), mats.iron, 0, 0.67, 0);

  const yaw = new THREE.Group();
  yaw.position.y = 0.85;
  group.add(yaw);

  // Turret head.
  add(THREE, yaw, new THREE.BoxGeometry(0.85, 0.5, 1.05), mats.gunmetal, 0, 0.27, -0.05);

  // Ammo drum on the left flank (bigger with tier A).
  const drumR = 0.26 + 0.04 * Math.min(a, 2);
  add(THREE, yaw, new THREE.CylinderGeometry(drumR, drumR, 0.34, 12), mats.steel, -0.6, 0.27, -0.18, 0, 0, Math.PI / 2);
  add(THREE, yaw, new THREE.CylinderGeometry(drumR * 0.55, drumR * 0.55, 0.38, 10), mats.iron, -0.6, 0.27, -0.18, 0, 0, Math.PI / 2);

  // Belt feed sagging from head top into the drum.
  const beltGeo = new THREE.BoxGeometry(0.14, 0.07, 0.3);
  add(THREE, yaw, beltGeo, mats.iron, -0.22, 0.58, -0.16, 0, 0, 0.5);
  add(THREE, yaw, beltGeo, mats.iron, -0.42, 0.5, -0.17, 0, 0, 1.0);
  add(THREE, yaw, beltGeo, mats.iron, -0.56, 0.4, -0.18, 0, 0, 1.5);

  // Spent-shell chute on the right side.
  add(THREE, yaw, new THREE.BoxGeometry(0.16, 0.3, 0.2), mats.steel, 0.5, 0.1, 0.1, 0, 0, -0.45);

  const parts = { yawNode: yaw };

  // Barrel assembly: single barrel, or 3-barrel rotary with motor block at A2+.
  const barrels = new THREE.Group();
  barrels.position.set(0, 0.3, 0.5);
  yaw.add(barrels);
  const bLen = 0.9 + 0.15 * b; // tier B: longer barrel
  if (a >= 2) {
    // Motor block behind the rotary cluster.
    add(THREE, yaw, new THREE.BoxGeometry(0.42, 0.42, 0.3), mats.steel, 0, 0.3, 0.4);
    const barrelGeo = new THREE.CylinderGeometry(0.06, 0.06, bLen, 8);
    for (let i = 0; i < 3; i++) {
      const ang = (i / 3) * Math.PI * 2;
      add(THREE, barrels, barrelGeo, mats.steel, Math.cos(ang) * 0.1, Math.sin(ang) * 0.1, bLen / 2 + 0.1, Math.PI / 2, 0, 0);
    }
    add(THREE, barrels, new THREE.CylinderGeometry(0.15, 0.15, 0.12, 10), mats.iron, 0, 0, 0.12, Math.PI / 2, 0, 0);
    parts.spinner = barrels;
  } else {
    add(THREE, barrels, new THREE.CylinderGeometry(0.08, 0.09, bLen, 10), mats.steel, 0, 0, bLen / 2 + 0.1, Math.PI / 2, 0, 0);
  }

  // Tier B: reinforced AP jacket plates + shrouded barrel.
  if (b >= 1) {
    const plateGeo = new THREE.BoxGeometry(0.1, 0.44, 0.7);
    add(THREE, yaw, plateGeo, mats.iron, -0.5, 0.3, 0.05, 0, 0, 0.12);
    add(THREE, yaw, plateGeo, mats.iron, 0.5, 0.3, 0.05, 0, 0, -0.12);
    add(THREE, barrels, new THREE.CylinderGeometry(0.16, 0.18, 0.45 + 0.15 * b, 10), mats.gunmetal, 0, 0, 0.55, Math.PI / 2, 0, 0);
  }
  if (b >= 2) add(THREE, yaw, new THREE.BoxGeometry(0.6, 0.1, 0.7), mats.iron, 0, 0.57, 0.05);
  if (b >= 3) add(THREE, yaw, new THREE.BoxGeometry(0.95, 0.16, 0.4), mats.gunmetal, 0, 0.06, 0.45);
  if (a >= 1) add(THREE, yaw, new THREE.BoxGeometry(0.2, 0.16, 0.5), mats.accent, -0.32, 0.58, 0.15);
  if (a >= 3) add(THREE, yaw, new THREE.CylinderGeometry(0.2, 0.24, 0.3, 10), mats.steel, -0.6, 0.27, 0.25, 0, 0, Math.PI / 2);

  // Muzzle glow.
  add(THREE, barrels, new THREE.CylinderGeometry(0.1, 0.1, 0.05, 10), mats.glow, 0, 0, bLen + 0.12, Math.PI / 2, 0, 0, false);

  return { group, parts };
}

// ------------------------------------------------------------- railcannon ---
function buildRailcannon(THREE, tiers) {
  const [a, b] = tiers;
  const mats = makeMats(THREE, COL.damage, a >= 3 || b >= 3);
  const group = new THREE.Group();
  addPlinth(THREE, group, mats);

  // Static turntable base.
  add(THREE, group, new THREE.CylinderGeometry(0.6, 0.7, 0.25, 12), mats.iron, 0, 0.62, 0);

  // Cable loom from the plinth up into the mount.
  strut(THREE, group, mats.steel, 0.62, 0.5, -0.45, 0.28, 0.78, -0.2, 0.04);
  strut(THREE, group, mats.steel, -0.62, 0.5, -0.45, -0.28, 0.78, -0.2, 0.04);

  const yaw = new THREE.Group();
  yaw.position.y = 0.82;
  group.add(yaw);

  // Recoil sled: long low cradle the rails ride on.
  add(THREE, yaw, new THREE.BoxGeometry(0.7, 0.18, 1.5), mats.gunmetal, 0, 0.08, 0.15);
  add(THREE, yaw, new THREE.BoxGeometry(0.5, 0.12, 0.9), mats.steel, 0, 0.2, 0.3);

  // Twin parallel rails with a visible gap, stretched by tier A.
  const railLen = 2.0 + 0.25 * a;
  const railGeo = new THREE.BoxGeometry(0.1, 0.14, railLen);
  const railZ = railLen / 2 - 0.7;
  add(THREE, yaw, railGeo, mats.steel, -0.14, 0.36, railZ);
  add(THREE, yaw, railGeo, mats.steel, 0.14, 0.36, railZ);
  // Rail spacer clamps.
  const clampGeo = new THREE.BoxGeometry(0.44, 0.1, 0.16);
  add(THREE, yaw, clampGeo, mats.iron, 0, 0.3, -0.35);
  add(THREE, yaw, clampGeo, mats.iron, 0, 0.3, railLen - 1.15);

  // Capacitor stack behind.
  add(THREE, yaw, new THREE.CylinderGeometry(0.28, 0.3, 0.4, 12), mats.gunmetal, 0, 0.28, -0.95);
  add(THREE, yaw, new THREE.CylinderGeometry(0.2, 0.24, 0.34, 12), mats.iron, 0, 0.62, -0.95);
  if (a >= 3) add(THREE, yaw, new THREE.CylinderGeometry(0.14, 0.17, 0.28, 10), mats.steel, 0, 0.9, -0.95);

  // Tier A: glowing capacitor rings.
  for (let i = 0; i < a; i++) {
    add(THREE, yaw, new THREE.TorusGeometry(0.3, 0.035, 6, 18), mats.glow, 0, 0.2 + i * 0.24, -0.95, -Math.PI / 2, 0, 0, false);
  }

  // Rail charge glow strip in the gap.
  add(THREE, yaw, new THREE.BoxGeometry(0.06, 0.06, railLen * 0.85), mats.glow, 0, 0.36, railZ, 0, 0, 0, false);

  // Tier B: shock-muzzle ring(s) at the rail tips.
  if (b >= 1) {
    add(THREE, yaw, new THREE.TorusGeometry(0.2 + 0.03 * b, 0.045, 6, 18), mats.accent, 0, 0.36, railLen - 0.75);
    add(THREE, yaw, new THREE.TorusGeometry(0.28 + 0.04 * b, 0.03, 6, 18), mats.glow, 0, 0.36, railLen - 0.68, 0, 0, 0, false);
  }
  if (b >= 2) add(THREE, yaw, new THREE.BoxGeometry(0.56, 0.08, 0.5), mats.iron, 0, 0.47, railLen - 1.2);
  if (b >= 3) {
    add(THREE, yaw, new THREE.BoxGeometry(0.12, 0.3, 0.6), mats.gunmetal, -0.34, 0.34, railLen - 1.2);
    add(THREE, yaw, new THREE.BoxGeometry(0.12, 0.3, 0.6), mats.gunmetal, 0.34, 0.34, railLen - 1.2);
  }

  return { group, parts: { yawNode: yaw } };
}

// ----------------------------------------------------------------- mortar ---
function buildMortar(THREE, tiers) {
  const [a, b] = tiers;
  const mats = makeMats(THREE, COL.damage, a >= 3 || b >= 3);
  const group = new THREE.Group();
  addPlinth(THREE, group, mats);

  // Sandbag ring (gap on +x side for the ammo crate).
  const bagGeo = new THREE.SphereGeometry(1, 8, 6);
  for (let i = 0; i < 6; i++) {
    const ang = Math.PI * 0.35 + (i / 6) * Math.PI * 1.65;
    const bag = add(THREE, group, bagGeo, mats.iron, Math.cos(ang) * 0.72, 0.58, Math.sin(ang) * 0.72, 0, -ang, 0);
    bag.scale.set(0.36, 0.16, 0.2);
  }

  // Open ammo crate with visible shells.
  add(THREE, group, new THREE.BoxGeometry(0.44, 0.26, 0.36), mats.steel, 0.58, 0.63, 0.1);
  const shellGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.3, 8);
  add(THREE, group, shellGeo, mats.accent, 0.48, 0.78, 0.02, 0.12, 0, 0.1);
  add(THREE, group, shellGeo, mats.accent, 0.6, 0.78, 0.12, -0.1, 0, -0.08);
  add(THREE, group, shellGeo, mats.accent, 0.68, 0.78, 0.0, 0.05, 0, -0.2);

  // Blast shield plate at the front.
  add(THREE, group, new THREE.BoxGeometry(0.9, 0.55, 0.08), mats.gunmetal, 0, 0.85, 0.66, -0.28, 0, 0);

  const yaw = new THREE.Group();
  yaw.position.y = 0.55;
  group.add(yaw);

  // Base plate + bipod.
  add(THREE, yaw, new THREE.CylinderGeometry(0.34, 0.4, 0.1, 10), mats.iron, 0, 0.03, -0.1);
  strut(THREE, yaw, mats.steel, -0.28, 0.02, 0.25, -0.1, 0.62, -0.05, 0.035);
  strut(THREE, yaw, mats.steel, 0.28, 0.02, 0.25, 0.1, 0.62, -0.05, 0.035);

  // Fat stubby tube(s) at 45 degrees. Tier B: 2 then 3 tubes.
  const nTubes = b >= 3 ? 3 : b >= 1 ? 2 : 1;
  const xs = nTubes === 1 ? [0] : nTubes === 2 ? [-0.22, 0.22] : [-0.3, 0, 0.3];
  const tubeGeo = new THREE.CylinderGeometry(0.16, 0.19, 1.0, 12);
  const bandGeo = new THREE.TorusGeometry(0.17, 0.04, 6, 14);
  for (const x of xs) {
    add(THREE, yaw, tubeGeo, mats.gunmetal, x, 0.42, -0.05, Math.PI / 4, 0, 0);
    // Muzzle band at the mouth.
    add(THREE, yaw, bandGeo, mats.steel, x, 0.76, 0.29, Math.PI / 4 + Math.PI / 2, 0, 0);
    // Tier A: scorched tube-mouth glow.
    if (a >= 1) add(THREE, yaw, new THREE.CylinderGeometry(0.13, 0.13, 0.04, 10), mats.glow, x, 0.77, 0.3, Math.PI / 4, 0, 0, false);
  }

  // Tier A: napalm canisters racked beside the emplacement.
  const canGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.3, 10);
  for (let i = 0; i < a; i++) {
    add(THREE, group, canGeo, mats.accent, -0.58 + i * 0.02, 0.66, -0.25 + i * 0.22, 0, 0, 0.16);
  }
  if (a >= 2) add(THREE, group, new THREE.BoxGeometry(0.34, 0.08, 0.7), mats.iron, -0.58, 0.54, -0.02);
  if (a >= 3) add(THREE, yaw, new THREE.BoxGeometry(0.5, 0.14, 0.3), mats.accent, 0, 0.14, -0.4);
  if (b >= 2) add(THREE, yaw, new THREE.BoxGeometry(0.16 + 0.44 * (nTubes - 1), 0.1, 0.24), mats.iron, 0, 0.36, -0.28, Math.PI / 4, 0, 0);

  return { group, parts: { yawNode: yaw } };
}

// ------------------------------------------------------------------ tesla ---
function buildTesla(THREE, tiers) {
  const [a, b] = tiers;
  const mats = makeMats(THREE, COL.debuff, a >= 3 || b >= 3);
  const group = new THREE.Group();
  addPlinth(THREE, group, mats);

  // Ceramic insulator stack: ribbed discs, taller with tier A.
  const nDiscs = 4 + a;
  const discGeo = new THREE.CylinderGeometry(0.3, 0.34, 0.09, 12);
  const stackBase = 0.62;
  for (let i = 0; i < nDiscs; i++) {
    add(THREE, group, discGeo, mats.iron, 0, stackBase + i * 0.22, 0);
  }
  const stackTop = stackBase + (nDiscs - 1) * 0.22;
  add(THREE, group, new THREE.CylinderGeometry(0.13, 0.15, stackTop - 0.4, 10), mats.gunmetal, 0, (stackTop + 0.4) / 2, 0);

  // Grounding cables to 3 anchor pegs.
  const pegGeo = new THREE.BoxGeometry(0.14, 0.18, 0.14);
  for (let i = 0; i < 3; i++) {
    const ang = (i / 3) * Math.PI * 2 + 0.5;
    const px = Math.cos(ang) * 0.72, pz = Math.sin(ang) * 0.72;
    add(THREE, group, pegGeo, mats.steel, px, 0.56, pz);
    strut(THREE, group, mats.steel, Math.cos(ang) * 0.2, stackBase + 0.5, Math.sin(ang) * 0.2, px, 0.64, pz, 0.03);
  }

  // Crown orb.
  const orbY = stackTop + 0.42;
  add(THREE, group, new THREE.SphereGeometry(0.28, 14, 10), mats.accent, 0, orbY, 0);
  add(THREE, group, new THREE.SphereGeometry(0.36, 12, 8), mats.glow, 0, orbY, 0, 0, 0, 0, false);

  // Yaw head at the orb: arcing prong ring (prong count grows with tier B).
  const yaw = new THREE.Group();
  yaw.position.y = orbY;
  group.add(yaw);
  const ring = new THREE.Group();
  yaw.add(ring);
  add(THREE, ring, new THREE.TorusGeometry(0.52, 0.035, 6, 20), mats.gunmetal, 0, -0.08, 0, -Math.PI / 2, 0, 0);
  const prongGeo = new THREE.ConeGeometry(0.05, 0.3, 6);
  const nProngs = 3 + b;
  for (let i = 0; i < nProngs; i++) {
    const ang = (i / nProngs) * Math.PI * 2;
    add(THREE, ring, prongGeo, mats.steel, Math.cos(ang) * 0.52, 0.06, Math.sin(ang) * 0.52, 0.5 * Math.sin(ang), 0, -0.5 * Math.cos(ang));
  }

  // Tier A: orbiting satellite orbs.
  const satGeo = new THREE.SphereGeometry(0.09, 10, 8);
  for (let i = 0; i < a; i++) {
    const ang = (i / Math.max(a, 1)) * Math.PI * 2 + 1.0;
    add(THREE, ring, satGeo, mats.glow, Math.cos(ang) * 0.62, 0.28, Math.sin(ang) * 0.62, 0, 0, 0, false);
  }
  if (b >= 2) add(THREE, group, new THREE.TorusGeometry(0.4, 0.03, 6, 18), mats.glow, 0, stackBase + 0.44, 0, -Math.PI / 2, 0, 0, false);
  if (b >= 3) add(THREE, group, new THREE.CylinderGeometry(0.44, 0.5, 0.14, 12), mats.gunmetal, 0, 0.56, 0);

  return { group, parts: { yawNode: yaw, spinner: ring } };
}

// ------------------------------------------------------------------- cryo ---
function buildCryo(THREE, tiers) {
  const [a, b] = tiers;
  const mats = makeMats(THREE, COL.debuff, a >= 3 || b >= 3);
  const frost = new THREE.MeshStandardMaterial({ color: COL.frost, roughness: 0.35, metalness: 0.1 });
  const group = new THREE.Group();
  addPlinth(THREE, group, mats);

  // Cryostat dewar tank + dome cap.
  add(THREE, group, new THREE.CylinderGeometry(0.48, 0.52, 1.2, 14), mats.gunmetal, 0, 1.1, 0);
  const dome = add(THREE, group, new THREE.SphereGeometry(0.48, 14, 8), mats.steel, 0, 1.7, 0);
  dome.scale.y = 0.55;

  // Frost ribs.
  const ribGeo = new THREE.TorusGeometry(0.52, 0.045, 6, 20);
  const nRibs = 3 + (a >= 2 ? 1 : 0);
  for (let i = 0; i < nRibs; i++) {
    add(THREE, group, ribGeo, frost, 0, 0.75 + i * 0.32, 0, -Math.PI / 2, 0, 0);
  }

  // Coolant pipes wrapping down to the plinth + valve block.
  strut(THREE, group, mats.steel, 0.3, 1.9, 0.25, 0.62, 0.52, 0.5, 0.05);
  strut(THREE, group, mats.steel, -0.35, 1.85, -0.2, -0.6, 0.52, -0.48, 0.05);
  add(THREE, group, new THREE.BoxGeometry(0.24, 0.2, 0.2), mats.iron, 0.5, 0.9, 0.42);

  // Vent nozzles + static frost cones.
  const nozGeo = new THREE.ConeGeometry(0.09, 0.22, 8);
  const frostGeo = new THREE.ConeGeometry(0.15, 0.5, 8);
  for (let i = 0; i < 3; i++) {
    const ang = (i / 3) * Math.PI * 2 + 0.9;
    const nx = Math.cos(ang), nz = Math.sin(ang);
    add(THREE, group, nozGeo, mats.steel, nx * 0.56, 1.35, nz * 0.56, Math.PI / 2 * nz, 0, -Math.PI / 2 * nx);
    add(THREE, group, frostGeo, mats.glow, nx * 0.88, 1.3, nz * 0.88, Math.PI / 2 * nz + 0.2 * nz, 0, -Math.PI / 2 * nx - 0.2 * nx, false);
  }

  // Floating ice crystal (grows with tier A). Spinner node.
  const spinner = new THREE.Group();
  spinner.position.y = 2.3 + 0.12 * a;
  group.add(spinner);
  const crystalR = 0.26 + 0.1 * a;
  const core = add(THREE, spinner, new THREE.OctahedronGeometry(crystalR, 0), mats.accent, 0, 0, 0);
  core.scale.y = 1.5;
  const shell = add(THREE, spinner, new THREE.OctahedronGeometry(crystalR * 1.3, 0), mats.glow, 0, 0, 0, 0, Math.PI / 4, 0, false);
  shell.scale.y = 1.5;
  if (a >= 2) add(THREE, spinner, new THREE.TorusGeometry(crystalR * 1.5, 0.03, 6, 18), mats.glow, 0, 0, 0, -Math.PI / 2, 0, 0, false);
  if (a >= 3) {
    const shardGeo = new THREE.OctahedronGeometry(0.1, 0);
    add(THREE, spinner, shardGeo, mats.glow, 0.55, -0.1, 0, 0, 0, 0, false);
    add(THREE, spinner, shardGeo, mats.glow, -0.55, -0.1, 0, 0, 0, 0, false);
  }

  // Tier B: radiator fins around the tank.
  if (b >= 1) {
    const finGeo = new THREE.BoxGeometry(0.06, 0.6, 0.28);
    const nFins = 2 + 2 * b;
    for (let i = 0; i < nFins; i++) {
      const ang = (i / nFins) * Math.PI * 2 + 0.3;
      add(THREE, group, finGeo, mats.iron, Math.cos(ang) * 0.62, 1.05, Math.sin(ang) * 0.62, 0, -ang + Math.PI / 2, 0);
    }
  }
  if (b >= 3) add(THREE, group, new THREE.TorusGeometry(0.56, 0.04, 6, 20), mats.glow, 0, 0.62, 0, -Math.PI / 2, 0, 0, false);

  return { group, parts: { spinner } };
}

export const BUILDERS = {
  gatling: (THREE, tiers) => buildGatling(THREE, tiers),
  railcannon: (THREE, tiers) => buildRailcannon(THREE, tiers),
  mortar: (THREE, tiers) => buildMortar(THREE, tiers),
  tesla: (THREE, tiers) => buildTesla(THREE, tiers),
  cryo: (THREE, tiers) => buildCryo(THREE, tiers),
};
