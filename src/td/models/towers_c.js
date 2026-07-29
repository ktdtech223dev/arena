// towers_c.js — ARENA co-op TD tower models, batch C.
// Builders: depot, shieldgen, gravwell, bounty, plasma.
// Contract: BUILDERS[id](THREE, tiers) => { group, parts }
//   tiers = [tierA 0-3, tierB 0-3]. Local origin at base center.
// Style: MeshStandardMaterial for lit geo, MeshBasicMaterial (additive,
// depthWrite off) for glow only. Chunky low-poly silhouettes.

const PAL = {
  gunmetal: 0x2a3340,
  steel: 0x1a2028,
  iron: 0x3a4148,
  damage: 0xff8a4a,
  buff: 0x9fe86a,
  debuff: 0x7db2ff,
  econ: 0xffd166,
  gold: 0xffd166,
};

function stdMats(THREE) {
  return {
    gunmetal: new THREE.MeshStandardMaterial({ color: PAL.gunmetal, roughness: 0.65, metalness: 0.5 }),
    steel: new THREE.MeshStandardMaterial({ color: PAL.steel, roughness: 0.55, metalness: 0.6 }),
    iron: new THREE.MeshStandardMaterial({ color: PAL.iron, roughness: 0.8, metalness: 0.35 }),
  };
}

function glowMat(THREE, color, opacity = 0.85) {
  return new THREE.MeshBasicMaterial({
    color, transparent: true, opacity,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
}

function lit(mesh) { mesh.castShadow = true; return mesh; }

function box(THREE, mat, w, h, d, x, y, z) {
  const m = lit(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat));
  m.position.set(x, y, z);
  return m;
}

function cyl(THREE, mat, rt, rb, h, seg, x, y, z) {
  const m = lit(new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat));
  m.position.set(x, y, z);
  return m;
}

function isMaxed(tiers) { return tiers[0] >= 3 || tiers[1] >= 3; }

// Shared plinth: cylinder r0.85->1.05 h0.5 + glow trim ring (gold when maxed).
function addPlinth(THREE, group, mats, accent, tiers) {
  const base = cyl(THREE, mats.gunmetal, 0.85, 1.05, 0.5, 12, 0, 0.25, 0);
  group.add(base);
  const trim = new THREE.Mesh(
    new THREE.TorusGeometry(0.9, 0.05, 8, 28),
    glowMat(THREE, isMaxed(tiers) ? PAL.gold : accent)
  );
  trim.rotation.x = -Math.PI / 2;
  trim.position.y = 0.5;
  group.add(trim);
}

// ---------------------------------------------------------------- depot
// Supply bunker: crate stacks, ammo-can wall, fold-out counter with
// bullet-tip rows, camo-net poles. A: crate layers. B: resupply ring pad.
function buildDepot(THREE, tiers) {
  const [tA, tB] = tiers;
  const group = new THREE.Group();
  const mats = stdMats(THREE);
  addPlinth(THREE, group, mats, PAL.econ, tiers);

  // Main corrugated bunker crate.
  group.add(box(THREE, mats.gunmetal, 1.2, 0.7, 0.9, -0.1, 0.85, -0.12));
  // Corrugation ribs on the bunker face.
  group.add(box(THREE, mats.steel, 1.26, 0.08, 0.96, -0.1, 0.7, -0.12));
  group.add(box(THREE, mats.steel, 1.26, 0.08, 0.96, -0.1, 1.0, -0.12));

  // Base crate pair on top; tier A stacks more layers.
  group.add(box(THREE, mats.iron, 0.55, 0.4, 0.55, -0.4, 1.4, -0.12));
  group.add(box(THREE, mats.iron, 0.5, 0.35, 0.5, 0.18, 1.38, -0.2));
  for (let i = 0; i < tA; i++) {
    const y = 1.78 + i * 0.36;
    group.add(box(THREE, mats.iron, 0.48 - i * 0.05, 0.34, 0.48 - i * 0.05,
      -0.32 + (i % 2) * 0.16, y, -0.14));
  }

  // Ammo-can wall along the right flank.
  for (let i = 0; i < 4; i++) {
    group.add(box(THREE, mats.steel, 0.26, 0.3, 0.22, 0.62, 0.66, -0.42 + i * 0.28));
  }

  // Fold-out counter out front with a row of bullet tips.
  group.add(box(THREE, mats.iron, 1.05, 0.07, 0.4, -0.05, 0.92, 0.62));
  const brass = new THREE.MeshStandardMaterial({ color: 0x8a7040, roughness: 0.4, metalness: 0.8 });
  const tipGlow = glowMat(THREE, PAL.econ, 0.7);
  for (let i = 0; i < 5; i++) {
    const x = -0.45 + i * 0.2;
    group.add(cyl(THREE, brass, 0.045, 0.045, 0.16, 8, x, 1.03, 0.62));
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 5), tipGlow);
    tip.position.set(x, 1.13, 0.62);
    group.add(tip);
  }

  // Camo-net poles + net panel over the back.
  group.add(cyl(THREE, mats.iron, 0.035, 0.035, 1.3, 6, -0.72, 1.15, -0.52));
  group.add(cyl(THREE, mats.iron, 0.035, 0.035, 1.3, 6, 0.55, 1.15, -0.55));
  const net = box(THREE, mats.iron, 1.5, 0.035, 0.85, -0.08, 1.8 + tA * 0.12, -0.5);
  net.rotation.z = 0.12;
  net.rotation.x = -0.08;
  group.add(net);

  // Tier B: glowing resupply ring pad around the base.
  if (tB >= 1) {
    const pad = new THREE.Mesh(
      new THREE.TorusGeometry(1.18, 0.06, 8, 32),
      glowMat(THREE, isMaxed(tiers) ? PAL.gold : PAL.econ, 0.75)
    );
    pad.rotation.x = -Math.PI / 2;
    pad.position.y = 0.06;
    group.add(pad);
  }
  if (tB >= 2) {
    const pad2 = new THREE.Mesh(
      new THREE.TorusGeometry(1.34, 0.045, 8, 32),
      glowMat(THREE, PAL.econ, 0.55)
    );
    pad2.rotation.x = -Math.PI / 2;
    pad2.position.y = 0.05;
    group.add(pad2);
  }
  if (tB >= 3) {
    const disc = new THREE.Mesh(
      new THREE.CylinderGeometry(1.12, 1.12, 0.02, 24),
      glowMat(THREE, PAL.gold, 0.22)
    );
    disc.position.y = 0.055;
    group.add(disc);
  }

  return { group, parts: {} };
}

// ------------------------------------------------------------- shieldgen
// Aegis projector: tripod legs -> gyro rings -> faceted emitter sphere,
// additive dome shell above. A: wider dome. B: orbiting stabilizer pylons.
function buildShieldgen(THREE, tiers) {
  const [tA, tB] = tiers;
  const group = new THREE.Group();
  const mats = stdMats(THREE);
  addPlinth(THREE, group, mats, PAL.buff, tiers);

  // Tripod legs leaning inward, with foot pads.
  for (let i = 0; i < 3; i++) {
    const legPivot = new THREE.Group();
    legPivot.rotation.y = (i / 3) * Math.PI * 2;
    const leg = box(THREE, mats.gunmetal, 0.16, 1.25, 0.2, 0.52, 1.02, 0);
    leg.rotation.z = 0.32;
    legPivot.add(leg);
    legPivot.add(box(THREE, mats.steel, 0.3, 0.14, 0.3, 0.68, 0.56, 0));
    group.add(legPivot);
  }

  // Gyro: horizontal ring (slow spinner) + fixed vertical ring.
  const spinner = new THREE.Group();
  spinner.position.y = 1.62;
  group.add(spinner);
  const ringH = lit(new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.07, 8, 20), mats.iron));
  ringH.rotation.x = Math.PI / 2;
  spinner.add(ringH);
  const ringV = lit(new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.055, 8, 20), mats.steel));
  group.add(ringV);
  ringV.position.y = 1.62;

  // Faceted emitter sphere.
  const emitMat = new THREE.MeshStandardMaterial({
    color: 0x35502a, roughness: 0.35, metalness: 0.4,
    emissive: PAL.buff, emissiveIntensity: 0.55, flatShading: true,
  });
  const core = lit(new THREE.Mesh(new THREE.IcosahedronGeometry(0.3, 0), emitMat));
  core.position.y = 1.62;
  group.add(core);

  // Transparent dome shell segment above; tier A widens it.
  const domeR = 0.85 + tA * 0.17;
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(domeR, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2.15),
    glowMat(THREE, isMaxed(tiers) ? PAL.gold : PAL.buff, 0.16)
  );
  dome.position.y = 1.62;
  group.add(dome);
  const domeRim = new THREE.Mesh(
    new THREE.TorusGeometry(domeR * 0.95, 0.035, 6, 26),
    glowMat(THREE, PAL.buff, 0.6)
  );
  domeRim.rotation.x = Math.PI / 2;
  domeRim.position.y = 1.62 + domeR * 0.28;
  group.add(domeRim);

  // Tier B: orbiting stabilizer pylons riding the spinner.
  for (let i = 0; i < tB; i++) {
    const a = (i / Math.max(tB, 1)) * Math.PI * 2 + 0.5;
    const px = Math.cos(a) * 0.82, pz = Math.sin(a) * 0.82;
    const pylon = box(THREE, mats.gunmetal, 0.14, 0.5, 0.14, px, 0.08, pz);
    spinner.add(pylon);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 5), glowMat(THREE, PAL.buff, 0.8));
    tip.position.set(px, 0.4, pz);
    spinner.add(tip);
  }

  return { group, parts: { spinner } };
}

// -------------------------------------------------------------- gravwell
// Containment claw: 3 curved claws gripping a void orb, tilted accretion
// ring, frozen debris. A: claw extensions + debris. B: second ring + debris.
function buildGravwell(THREE, tiers) {
  const [tA, tB] = tiers;
  const group = new THREE.Group();
  const mats = stdMats(THREE);
  addPlinth(THREE, group, mats, PAL.debuff, tiers);

  group.add(cyl(THREE, mats.steel, 0.42, 0.55, 0.3, 10, 0, 0.65, 0));

  // Three curved claws, each an arc of leaning boxes.
  for (let i = 0; i < 3; i++) {
    const claw = new THREE.Group();
    claw.rotation.y = (i / 3) * Math.PI * 2;
    const s1 = box(THREE, mats.gunmetal, 0.24, 0.72, 0.3, 0.68, 0.95, 0);
    s1.rotation.z = 0.35;
    claw.add(s1);
    const s2 = box(THREE, mats.gunmetal, 0.2, 0.6, 0.26, 0.5, 1.5, 0);
    s2.rotation.z = 0.95;
    claw.add(s2);
    const s3 = box(THREE, mats.iron, 0.16, 0.44, 0.2, 0.24, 1.82, 0);
    s3.rotation.z = 1.45;
    claw.add(s3);
    if (tA >= 1) {
      const ext = box(THREE, mats.iron, 0.12, 0.34, 0.16, 0.0, 1.94, 0);
      ext.rotation.z = 1.9;
      claw.add(ext);
    }
    if (tA >= 2) {
      // Knuckle spikes flaring outward.
      const spike = box(THREE, mats.steel, 0.1, 0.3, 0.12, 0.78, 1.35, 0);
      spike.rotation.z = -0.5;
      claw.add(spike);
    }
    group.add(claw);
  }

  // Dark void orb.
  const orbMat = new THREE.MeshStandardMaterial({ color: 0x07090d, roughness: 0.25, metalness: 0.7 });
  const orb = lit(new THREE.Mesh(new THREE.SphereGeometry(0.4, 14, 10), orbMat));
  orb.position.y = 1.5;
  group.add(orb);

  // Accretion ring(s) on a slow spinner.
  const spinner = new THREE.Group();
  spinner.position.y = 1.5;
  group.add(spinner);
  const accent = isMaxed(tiers) ? PAL.gold : PAL.debuff;
  const ring1 = new THREE.Mesh(new THREE.TorusGeometry(0.68, 0.045, 8, 30), glowMat(THREE, accent, 0.8));
  ring1.rotation.x = Math.PI / 2 - 0.45;
  spinner.add(ring1);
  if (tB >= 1) {
    const ring2 = new THREE.Mesh(new THREE.TorusGeometry(0.82, 0.035, 8, 30), glowMat(THREE, PAL.debuff, 0.6));
    ring2.rotation.x = Math.PI / 2 + 0.5;
    ring2.rotation.y = 0.6;
    spinner.add(ring2);
  }
  if (tB >= 3) {
    const ring3 = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.03, 8, 30), glowMat(THREE, PAL.debuff, 0.45));
    ring3.rotation.x = Math.PI / 2 - 0.15;
    spinner.add(ring3);
  }

  // Debris cubes frozen mid-orbit around the orb.
  const debrisCount = 4 + tA + tB * 2;
  for (let i = 0; i < debrisCount; i++) {
    const a = i * 2.4 + 0.7;
    const r = 0.62 + (i % 3) * 0.14;
    const s = 0.07 + (i % 3) * 0.03;
    const d = box(THREE, mats.iron, s, s, s,
      Math.cos(a) * r, Math.sin(i * 1.7) * 0.35, Math.sin(a) * r);
    d.rotation.set(i * 0.9, i * 1.3, i * 0.5);
    spinner.add(d);
  }

  return { group, parts: { spinner } };
}

// ---------------------------------------------------------------- bounty
// Gilded strongbox shrine: chest on pedestal, coin stacks, floating gem
// with halo, banner tassels. A: more coins. B: candelabra prongs.
function buildBounty(THREE, tiers) {
  const [tA, tB] = tiers;
  const group = new THREE.Group();
  const mats = stdMats(THREE);
  addPlinth(THREE, group, mats, PAL.econ, tiers);

  const goldMat = new THREE.MeshStandardMaterial({ color: PAL.gold, roughness: 0.32, metalness: 0.85 });

  // Pedestal + chest with cracked-open lid and gold trim bands.
  group.add(box(THREE, mats.steel, 0.9, 0.28, 0.7, 0, 0.64, 0));
  group.add(box(THREE, mats.iron, 0.8, 0.42, 0.58, 0, 0.99, 0));
  const lid = box(THREE, mats.iron, 0.8, 0.2, 0.58, 0, 1.26, -0.09);
  lid.rotation.x = -0.5;
  group.add(lid);
  group.add(box(THREE, goldMat, 0.84, 0.07, 0.62, 0, 0.86, 0));
  group.add(box(THREE, goldMat, 0.1, 0.46, 0.6, 0, 1.0, 0.01));
  // Glow spilling from the open chest.
  const spill = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.05, 0.44), glowMat(THREE, PAL.econ, 0.6));
  spill.position.set(0, 1.22, 0.03);
  group.add(spill);

  // Coin stacks around the pedestal; tier A piles on more.
  const coinCount = 3 + tA * 2;
  for (let i = 0; i < coinCount; i++) {
    const a = 0.4 + i * 0.85;
    const r = 0.62 + (i % 2) * 0.14;
    group.add(cyl(THREE, goldMat, 0.11, 0.11, 0.1 + (i % 3) * 0.07, 10,
      Math.cos(a) * r, 0.55 + (0.1 + (i % 3) * 0.07) / 2, Math.sin(a) * r));
  }

  // Floating gold gem + halo ring on a slow spinner.
  const spinner = new THREE.Group();
  spinner.position.y = 1.95;
  group.add(spinner);
  const gem = lit(new THREE.Mesh(new THREE.OctahedronGeometry(0.22, 0), goldMat));
  spinner.add(gem);
  const halo = new THREE.Mesh(
    new THREE.TorusGeometry(0.36, 0.035, 8, 26),
    glowMat(THREE, isMaxed(tiers) ? PAL.gold : PAL.econ, 0.8)
  );
  halo.rotation.x = Math.PI / 2;
  spinner.add(halo);

  // Banner poles + tassels behind the chest.
  for (const sx of [-1, 1]) {
    group.add(cyl(THREE, mats.iron, 0.03, 0.03, 1.4, 6, sx * 0.66, 1.2, -0.5));
    const tassel = box(THREE, mats.steel, 0.2, 0.55, 0.03, sx * 0.66, 1.55, -0.46);
    tassel.rotation.x = 0.12;
    group.add(tassel);
  }

  // Tier B: candelabra prongs with glow tips.
  if (tB >= 1) {
    const arms = tB + 1;
    for (let i = 0; i < arms; i++) {
      const a = (i / arms) * Math.PI * 2 + 0.9;
      const px = Math.cos(a) * 0.85, pz = Math.sin(a) * 0.85;
      group.add(cyl(THREE, goldMat, 0.035, 0.05, 0.9 + tB * 0.12, 6, px, 0.95 + tB * 0.06, pz));
      const flame = new THREE.Mesh(new THREE.SphereGeometry(0.075, 6, 5), glowMat(THREE, PAL.econ, 0.9));
      flame.position.set(px, 1.46 + tB * 0.12, pz);
      group.add(flame);
    }
  }

  return { group, parts: { spinner } };
}

// ---------------------------------------------------------------- plasma
// Solar lance array: tuning-fork prong emitter with plasma beads, focus
// lens discs in front, cooling manifold behind. B: prong pairs (2/3/4
// beads). A: thicker prongs + more lenses.
function buildPlasma(THREE, tiers) {
  const [tA, tB] = tiers;
  const group = new THREE.Group();
  const mats = stdMats(THREE);
  addPlinth(THREE, group, mats, PAL.damage, tiers);

  // Support column.
  group.add(cyl(THREE, mats.steel, 0.3, 0.42, 0.55, 10, 0, 0.77, 0));

  // Aiming head.
  const yawNode = new THREE.Group();
  yawNode.position.y = 1.12;
  group.add(yawNode);

  // Fork body.
  yawNode.add(box(THREE, mats.gunmetal, 0.7, 0.42, 0.7, 0, 0.1, -0.05));

  // Cooling manifold behind with fins.
  yawNode.add(box(THREE, mats.steel, 0.5, 0.34, 0.35, 0, 0.12, -0.58));
  for (let i = 0; i < 3; i++) {
    yawNode.add(box(THREE, mats.iron, 0.56, 0.05, 0.3, 0, -0.02 + i * 0.14, -0.62));
  }
  // Top sight vane.
  yawNode.add(box(THREE, mats.iron, 0.08, 0.16, 0.5, 0, 0.38, -0.1));

  // Prong pairs + plasma beads. Beads: 2 at B0-1, 3 at B2, 4 at B3.
  const beads = 2 + Math.max(0, tB - 1);
  const thick = 0.09 + tA * 0.02;
  const beadGlow = glowMat(THREE, isMaxed(tiers) ? PAL.gold : PAL.damage, 0.95);
  for (let i = 0; i < beads; i++) {
    const px = (i - (beads - 1) / 2) * 0.34;
    for (const sy of [-1, 1]) {
      const prong = box(THREE, mats.gunmetal, thick, thick, 0.95, px, 0.1 + sy * 0.17, 0.55);
      prong.rotation.x = sy * -0.06;
      yawNode.add(prong);
    }
    const bead = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), beadGlow);
    bead.position.set(px, 0.1, 0.88);
    yawNode.add(bead);
  }

  // Focus lens discs stacked in front (1 + tierA).
  const lensMat = new THREE.MeshStandardMaterial({
    color: 0x552a1a, roughness: 0.3, metalness: 0.5,
    emissive: PAL.damage, emissiveIntensity: 0.35,
  });
  for (let i = 0; i <= tA; i++) {
    const lens = lit(new THREE.Mesh(
      new THREE.CylinderGeometry(0.26 - i * 0.03, 0.26 - i * 0.03, 0.05, 14), lensMat));
    lens.rotation.x = Math.PI / 2;
    lens.position.set(0, 0.1, 1.08 + i * 0.14);
    yawNode.add(lens);
  }

  return { group, parts: { yawNode } };
}

export const BUILDERS = {
  depot: buildDepot,
  shieldgen: buildShieldgen,
  gravwell: buildGravwell,
  bounty: buildBounty,
  plasma: buildPlasma,
};
