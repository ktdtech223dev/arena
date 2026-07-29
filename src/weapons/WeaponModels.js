// RANGE — WeaponModels.js (agent E)
// buildWeaponModel(def) -> { group, parts, meta }
//
// Five UNIQUE code-built guns from THREE primitives + flat MeshStandardMaterial
// colors + small emissive accents. Local space: muzzle points down -Z, grip is
// near the origin, +Y up. Real-ish proportions (pistol ~0.24 m … sniper ~1.2 m).
//
// parts (contract §5.E):
//   pistol : slide, hammer, mag, trigger
//   smg    : bolt, mag, stock, trigger
//   shotgun: pump, mag (tube), trigger, shellPort
//   ar     : bolt, mag, chargingHandle, trigger
//   sniper : bolt, boltHandle, mag, scope, trigger
// EVERY model: parts.muzzle (empty at muzzle tip), parts.shellEject (empty at
// ejection port). All named parts are Groups so GunAnim can offset them.
//
// meta (internal to this subsystem — Viewmodel/GunAnim consume it):
//   { sightY, hip:{pos,rot}, adsZ, gripR:{pos,rot}, gripL:{pos,rot} }
import * as THREE from 'three';

// ---------------------------------------------------------------------------
// material + primitive helpers
// ---------------------------------------------------------------------------
const MAT_CACHE = new Map();

function M(color, opts = {}) {
  const { rough = 0.55, metal = 0.35, emissive = 0x000000, glow = 1.4 } = opts;
  const key = `${color}|${rough}|${metal}|${emissive}|${glow}`;
  let m = MAT_CACHE.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      roughness: rough,
      metalness: metal,
      emissive,
      emissiveIntensity: emissive ? glow : 1,
    });
    MAT_CACHE.set(key, m);
  }
  return m;
}

function box(parent, mat, w, h, d, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  mesh.rotation.set(rx, ry, rz);
  parent.add(mesh);
  return mesh;
}

// cylinder with its axis along local Z (length runs front/back)
function cylZ(parent, mat, r, len, x = 0, y = 0, z = 0, seg = 14, rBack = null) {
  const g = new THREE.CylinderGeometry(rBack ?? r, r, len, seg);
  g.rotateX(Math.PI / 2);
  const mesh = new THREE.Mesh(g, mat);
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

// cylinder along local Y
function cylY(parent, mat, r, len, x = 0, y = 0, z = 0, seg = 12) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), mat);
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

// cylinder along local X
function cylX(parent, mat, r, len, x = 0, y = 0, z = 0, seg = 10) {
  const g = new THREE.CylinderGeometry(r, r, len, seg);
  g.rotateZ(Math.PI / 2);
  const mesh = new THREE.Mesh(g, mat);
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

// thin disc facing ±Z (scope lenses)
function disc(parent, mat, r, x, y, z, seg = 18) {
  return cylZ(parent, mat, r, 0.004, x, y, z, seg);
}

function part(parent, x = 0, y = 0, z = 0) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

// trigger guard loop (torus in the vertical/長 plane)
function guard(parent, mat, r, x, y, z) {
  const g = new THREE.TorusGeometry(r, 0.0035, 6, 14);
  g.rotateY(Math.PI / 2);
  const mesh = new THREE.Mesh(g, mat);
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

// simple post-and-notch iron sights on the top line
function ironSights(parent, mat, glowMat, topY, frontZ, rearZ) {
  box(parent, mat, 0.006, 0.012, 0.006, 0, topY + 0.006, frontZ);            // front post
  box(parent, glowMat, 0.004, 0.004, 0.004, 0, topY + 0.013, frontZ);        // glowing dot
  box(parent, mat, 0.007, 0.010, 0.008, -0.007, topY + 0.005, rearZ);        // rear left ear
  box(parent, mat, 0.007, 0.010, 0.008, 0.007, topY + 0.005, rearZ);         // rear right ear
}

// small picatinny-ish rail strip: base + 3 teeth
function rail(parent, mat, len, x, y, z) {
  box(parent, mat, 0.022, 0.006, len, x, y, z);
  const n = Math.max(2, Math.floor(len / 0.025));
  for (let i = 0; i < n; i++) {
    box(parent, mat, 0.024, 0.004, 0.008, x, y + 0.004, z - len / 2 + (i + 0.5) * (len / n));
  }
}

function trigger(parent, matDark, y, z) {
  const t = part(parent, 0, y, z);              // pivot at blade top
  box(t, matDark, 0.006, 0.022, 0.007, 0, -0.011, 0, 0.12);
  return t;
}

// ---------------------------------------------------------------------------
// PISTOL — gunmetal + cyan, ~0.24 m
// ---------------------------------------------------------------------------
function buildPistol() {
  const g = new THREE.Group();
  const body = M(0x3a3f47, { rough: 0.45, metal: 0.6 });
  const dark = M(0x22252b, { rough: 0.6, metal: 0.4 });
  const gripM = M(0x2c2f36, { rough: 0.8, metal: 0.1 });
  const cyan = M(0x0b3d46, { rough: 0.4, metal: 0.2, emissive: 0x35e0ff, glow: 1.8 });
  const parts = {};

  // frame
  box(g, body, 0.03, 0.032, 0.155, 0, 0.018, -0.03);
  box(g, dark, 0.031, 0.012, 0.05, 0, 0.006, -0.1);                  // dust rail block
  // grip (raked back, bottom toward shooter)
  box(g, gripM, 0.028, 0.095, 0.046, 0, -0.045, 0.028, -0.24);
  box(g, cyan, 0.0292, 0.01, 0.046, 0, -0.012, 0.02, -0.24);         // cyan grip band
  // slide (animated: blowback +Z)
  const slide = part(g, 0, 0.05, -0.04);
  parts.slide = slide;
  box(slide, body, 0.034, 0.032, 0.19);
  box(slide, dark, 0.0355, 0.02, 0.03, 0, -0.002, 0.07);             // rear serrations
  box(slide, dark, 0.0355, 0.02, 0.02, 0, -0.002, -0.075);           // front serrations
  box(slide, cyan, 0.0355, 0.005, 0.1, 0, -0.0135, -0.02);           // cyan slide stripe
  box(slide, dark, 0.012, 0.014, 0.05, 0.012, 0.01, -0.01);          // ejection port inlay
  ironSights(slide, dark, cyan, 0.016, -0.085, 0.088);
  // barrel poking out of slide front
  cylZ(g, dark, 0.008, 0.03, 0, 0.048, -0.145, 12);
  // hammer (pivot at bottom; rest cocked back)
  const hammer = part(g, 0, 0.042, 0.062);
  hammer.rotation.x = 0.45;
  parts.hammer = hammer;
  box(hammer, dark, 0.01, 0.024, 0.008, 0, 0.012, 0);
  // magazine (inside grip, cyan baseplate)
  const mag = part(g, 0, -0.045, 0.028);
  mag.rotation.x = -0.24;
  parts.mag = mag;
  box(mag, dark, 0.023, 0.1, 0.038, 0, -0.004, 0);
  box(mag, cyan, 0.026, 0.008, 0.042, 0, -0.056, 0);
  // trigger + guard
  parts.trigger = trigger(g, dark, 0.004, -0.012);
  guard(g, body, 0.02, 0, -0.014, -0.014);

  parts.muzzle = part(g, 0, 0.048, -0.163);
  parts.shellEject = part(g, 0.02, 0.055, -0.015);

  return {
    group: g,
    parts,
    meta: {
      sightY: 0.072,
      hip: { pos: [0.21, -0.215, -0.36], rot: [0, 0.05, 0.03] },
      adsZ: -0.26,
      gripR: { pos: [0, -0.05, 0.03], rot: [0.12, 0, 0] },
      gripL: { pos: [-0.012, -0.075, 0.024], rot: [0.15, 0.35, 0.5] },
    },
  };
}

// ---------------------------------------------------------------------------
// SMG — dark polymer + orange, ~0.45 m, curved mag, folding wire stock
// ---------------------------------------------------------------------------
function buildSmg() {
  const g = new THREE.Group();
  const poly = M(0x23252b, { rough: 0.7, metal: 0.15 });
  const dark = M(0x17181c, { rough: 0.6, metal: 0.3 });
  const steel = M(0x3d4149, { rough: 0.45, metal: 0.65 });
  const orange = M(0x4a2405, { rough: 0.5, metal: 0.1, emissive: 0xff8c2b, glow: 1.7 });
  const parts = {};

  // receiver
  box(g, poly, 0.044, 0.06, 0.24, 0, 0.02, -0.04);
  rail(g, dark, 0.2, 0, 0.054, -0.04);
  box(g, orange, 0.0455, 0.004, 0.16, 0, 0.006, -0.05);              // orange side stripe
  // barrel shroud with vents
  box(g, poly, 0.04, 0.044, 0.08, 0, 0.024, -0.2);
  for (let i = 0; i < 3; i++) {
    box(g, orange, 0.042, 0.006, 0.014, 0, 0.03, -0.175 - i * 0.024); // glowing vents
  }
  cylZ(g, steel, 0.0075, 0.05, 0, 0.024, -0.255, 12);
  cylZ(g, dark, 0.011, 0.022, 0, 0.024, -0.245, 12);                 // muzzle ring
  // bolt (animated: reciprocates +Z) — knob riding a side slot
  const bolt = part(g, 0.024, 0.03, -0.06);
  parts.bolt = bolt;
  box(bolt, steel, 0.012, 0.014, 0.05);
  cylX(bolt, dark, 0.006, 0.014, 0.008, 0, 0);                       // charging knob
  box(g, dark, 0.002, 0.006, 0.14, 0.023, 0.03, -0.05);              // slot line
  // curved magazine — 3 angled segments curving forward
  const mag = part(g, 0, -0.02, -0.075);
  parts.mag = mag;
  box(mag, dark, 0.024, 0.055, 0.05, 0, -0.025, 0, 0.1);
  box(mag, dark, 0.0235, 0.055, 0.048, 0, -0.073, -0.008, 0.28);
  box(mag, dark, 0.023, 0.05, 0.046, 0, -0.115, -0.026, 0.45);
  box(mag, orange, 0.0245, 0.012, 0.047, 0, -0.138, -0.038, 0.45);   // orange baseplate
  // folding wire stock
  const stock = part(g, 0, 0.02, 0.08);
  parts.stock = stock;
  box(stock, steel, 0.008, 0.008, 0.13, -0.014, 0, 0.065);
  box(stock, steel, 0.008, 0.008, 0.13, 0.014, 0, 0.065);
  box(stock, poly, 0.04, 0.05, 0.014, 0, -0.005, 0.135);
  box(stock, orange, 0.042, 0.008, 0.015, 0, -0.028, 0.135);         // orange butt pad line
  // grip + vertical foregrip
  box(g, poly, 0.026, 0.075, 0.036, 0, -0.04, 0.045, -0.28);
  box(g, poly, 0.024, 0.06, 0.028, 0, -0.045, -0.14, 0.18);
  box(g, orange, 0.026, 0.008, 0.03, 0, -0.072, -0.146, 0.18);       // foregrip tip
  // sights + trigger
  ironSights(g, dark, orange, 0.062, -0.155, 0.06);
  parts.trigger = trigger(g, dark, -0.01, -0.02);
  guard(g, poly, 0.019, 0, -0.026, -0.022);

  parts.muzzle = part(g, 0, 0.024, -0.282);
  parts.shellEject = part(g, 0.025, 0.026, -0.035);

  return {
    group: g,
    parts,
    meta: {
      sightY: 0.078,
      hip: { pos: [0.215, -0.225, -0.4], rot: [0, 0.06, 0.02] },
      adsZ: -0.3,
      gripR: { pos: [0, -0.055, 0.05], rot: [0.1, 0, 0] },
      gripL: { pos: [0, -0.085, -0.145], rot: [0.2, 0, 0] },
    },
  };
}

// ---------------------------------------------------------------------------
// SHOTGUN — steel + wood-tone composite, ~0.95 m, pump + tube mag
// ---------------------------------------------------------------------------
function buildShotgun() {
  const g = new THREE.Group();
  const steel = M(0x4a4e55, { rough: 0.4, metal: 0.75 });
  const dark = M(0x212429, { rough: 0.55, metal: 0.4 });
  const wood = M(0x6b4a2e, { rough: 0.75, metal: 0.05 });
  const amber = M(0x4a2a05, { rough: 0.5, metal: 0.1, emissive: 0xffb13d, glow: 1.6 });
  const parts = {};

  // receiver
  box(g, steel, 0.048, 0.066, 0.22, 0, 0.012, 0);
  box(g, amber, 0.05, 0.006, 0.12, 0, 0.03, 0.02);                   // amber receiver strip
  box(g, dark, 0.014, 0.02, 0.05, 0.022, 0.012, -0.03);              // ejection port inlay
  // barrel + tube mag
  cylZ(g, steel, 0.0125, 0.46, 0, 0.036, -0.34, 14);
  cylZ(g, dark, 0.015, 0.03, 0, 0.036, -0.555, 14);                  // muzzle collar
  const mag = part(g, 0, -0.002, -0.28);                             // tube magazine
  parts.mag = mag;
  cylZ(mag, dark, 0.011, 0.32, 0, 0, 0, 12);
  cylZ(mag, amber, 0.0118, 0.012, 0, 0, -0.14, 12);                  // follower glow ring
  // pump (animated: slides +Z) — ribbed wood sleeve around the tube
  const pump = part(g, 0, 0.014, -0.31);
  parts.pump = pump;
  box(pump, wood, 0.052, 0.052, 0.15, 0, -0.014, 0);
  for (let i = 0; i < 3; i++) {
    box(pump, dark, 0.054, 0.006, 0.01, 0, -0.014, -0.05 + i * 0.05);
  }
  box(pump, steel, 0.012, 0.02, 0.15, -0.03, -0.014, 0);             // action bar (left)
  // stock — tapered wood + dark butt pad
  box(g, wood, 0.042, 0.06, 0.1, 0, 0.004, 0.155, -0.06);
  box(g, wood, 0.04, 0.075, 0.17, 0, -0.012, 0.28, -0.1);
  box(g, dark, 0.042, 0.085, 0.02, 0, -0.02, 0.365, -0.1);
  // pistol-ish wrist under receiver rear
  box(g, wood, 0.032, 0.05, 0.05, 0, -0.045, 0.09, -0.35);
  // bead sight + trigger
  box(g, amber, 0.006, 0.006, 0.006, 0, 0.052, -0.55);
  ironSights(g, dark, amber, 0.045, -0.54, -0.08);
  parts.trigger = trigger(g, dark, -0.022, 0.045);
  guard(g, dark, 0.02, 0, -0.038, 0.042);
  // loading port (underside) — where shells go in during reload
  const shellPort = part(g, 0, -0.032, 0.0);
  parts.shellPort = shellPort;
  box(shellPort, dark, 0.024, 0.006, 0.06, 0, 0, 0);

  parts.muzzle = part(g, 0, 0.036, -0.575);
  parts.shellEject = part(g, 0.026, 0.016, -0.03);

  return {
    group: g,
    parts,
    meta: {
      sightY: 0.056,
      hip: { pos: [0.235, -0.25, -0.46], rot: [0, 0.05, 0.02] },
      adsZ: -0.36,
      gripR: { pos: [0, -0.06, 0.09], rot: [0.25, 0, 0] },
      gripL: { pos: [0, -0.055, -0.31], rot: [0.1, 0, 0] },
    },
  };
}

// ---------------------------------------------------------------------------
// AR — olive/tan + red emissive charge indicator, ~0.80 m
// ---------------------------------------------------------------------------
function buildAr() {
  const g = new THREE.Group();
  const olive = M(0x5a5f41, { rough: 0.65, metal: 0.2 });
  const tan = M(0x8c7a56, { rough: 0.7, metal: 0.1 });
  const dark = M(0x24261f, { rough: 0.55, metal: 0.35 });
  const steel = M(0x43464d, { rough: 0.45, metal: 0.7 });
  const red = M(0x420708, { rough: 0.45, metal: 0.1, emissive: 0xff2b2b, glow: 2.2 });
  const parts = {};

  // receiver (upper + lower)
  box(g, olive, 0.046, 0.042, 0.26, 0, 0.03, -0.02);
  box(g, olive, 0.044, 0.036, 0.2, 0, -0.006, 0.0);
  rail(g, dark, 0.24, 0, 0.055, -0.02);
  box(g, red, 0.0475, 0.008, 0.05, 0, 0.026, 0.04);                  // charge indicator strip
  box(g, dark, 0.014, 0.022, 0.06, 0.022, 0.024, -0.02);             // ejection port frame
  // handguard with vents + side rail stubs
  box(g, tan, 0.046, 0.046, 0.19, 0, 0.028, -0.245);
  for (let i = 0; i < 4; i++) {
    box(g, dark, 0.048, 0.008, 0.012, 0, 0.028, -0.17 - i * 0.042);
  }
  box(g, dark, 0.058, 0.01, 0.05, 0, 0.028, -0.3);                   // side rail stubs
  // barrel + birdcage muzzle device
  cylZ(g, steel, 0.009, 0.1, 0, 0.028, -0.38, 12);
  box(g, dark, 0.022, 0.022, 0.045, 0, 0.028, -0.437);
  box(g, red, 0.024, 0.004, 0.03, 0, 0.028, -0.437);                 // glowing brake slot
  // bolt (animated: cycles +Z behind the port)
  const bolt = part(g, 0.018, 0.024, -0.02);
  parts.bolt = bolt;
  box(bolt, steel, 0.01, 0.018, 0.055);
  // charging handle (animated: pulls +Z) — T handle at rear top
  const ch = part(g, 0, 0.052, 0.1);
  parts.chargingHandle = ch;
  box(ch, dark, 0.012, 0.01, 0.05, 0, 0, -0.01);
  box(ch, dark, 0.05, 0.01, 0.014, 0, 0, 0.018);
  // magazine — 2 angled segments curving forward
  const mag = part(g, 0, -0.024, -0.06);
  parts.mag = mag;
  box(mag, dark, 0.026, 0.07, 0.062, 0, -0.033, -0.004, 0.14);
  box(mag, dark, 0.025, 0.06, 0.058, 0, -0.09, -0.026, 0.34);
  box(mag, red, 0.027, 0.01, 0.06, 0, -0.117, -0.038, 0.34);         // red follower window
  // stock — buffer tube + adjustable stock
  cylZ(g, olive, 0.015, 0.1, 0, 0.02, 0.16, 10);
  box(g, olive, 0.04, 0.055, 0.11, 0, 0.005, 0.265, -0.06);
  box(g, dark, 0.042, 0.075, 0.018, 0, -0.005, 0.322, -0.06);
  box(g, olive, 0.03, 0.016, 0.09, 0, 0.038, 0.26);                  // cheek riser
  // grip + angled foregrip stub
  box(g, dark, 0.026, 0.08, 0.04, 0, -0.055, 0.065, -0.35);
  box(g, tan, 0.024, 0.05, 0.03, 0, -0.06, -0.26, 0.5);
  // sights + trigger
  ironSights(g, dark, red, 0.06, -0.33, 0.07);
  parts.trigger = trigger(g, dark, -0.022, 0.02);
  guard(g, dark, 0.02, 0, -0.038, 0.017);

  parts.muzzle = part(g, 0, 0.028, -0.462);
  parts.shellEject = part(g, 0.026, 0.026, -0.02);

  return {
    group: g,
    parts,
    meta: {
      sightY: 0.079,
      hip: { pos: [0.225, -0.235, -0.45], rot: [0, 0.055, 0.02] },
      adsZ: -0.32,
      gripR: { pos: [0, -0.07, 0.07], rot: [0.15, 0, 0] },
      gripL: { pos: [0, -0.055, -0.26], rot: [0.15, 0, 0] },
    },
  };
}

// ---------------------------------------------------------------------------
// SNIPER — navy + green scope glint, ~1.20 m, bolt action, huge scope, bipod
// ---------------------------------------------------------------------------
function buildSniper() {
  const g = new THREE.Group();
  const navy = M(0x232c40, { rough: 0.55, metal: 0.35 });
  const navy2 = M(0x2c3854, { rough: 0.6, metal: 0.25 });
  const dark = M(0x171b26, { rough: 0.5, metal: 0.5 });
  const steel = M(0x4c5262, { rough: 0.4, metal: 0.8 });
  const green = M(0x0a3822, { rough: 0.4, metal: 0.1, emissive: 0x53ff9c, glow: 1.8 });
  const parts = {};

  // receiver + chassis
  box(g, navy, 0.048, 0.06, 0.3, 0, 0.016, 0.05);
  box(g, navy2, 0.044, 0.05, 0.16, 0, 0.008, -0.18);
  box(g, green, 0.049, 0.005, 0.2, 0, 0.036, 0.05);                  // green accent line
  rail(g, dark, 0.16, 0, 0.05, 0.03);
  // barrel — long, tapered, with slotted brake
  cylZ(g, steel, 0.011, 0.42, 0, 0.03, -0.45, 14, 0.014);
  box(g, dark, 0.026, 0.026, 0.05, 0, 0.03, -0.645);
  box(g, green, 0.028, 0.004, 0.036, 0, 0.03, -0.645);               // brake glow slot
  // scope — big tube, objective bell, lens discs, mount rings
  const scope = part(g, 0, 0.085, -0.01);
  parts.scope = scope;
  cylZ(scope, dark, 0.02, 0.17, 0, 0, 0, 16);
  cylZ(scope, dark, 0.03, 0.055, 0, 0, -0.1, 16, 0.024);             // objective bell
  cylZ(scope, dark, 0.024, 0.04, 0, 0, 0.1, 16);                     // ocular
  disc(scope, green, 0.026, 0, 0, -0.128);                           // objective glint (green)
  disc(scope, M(0x060a08, { rough: 0.2, metal: 0.1 }), 0.02, 0, 0, 0.121); // dark ocular lens
  box(scope, navy, 0.014, 0.03, 0.02, 0, -0.028, -0.05);             // front ring
  box(scope, navy, 0.014, 0.03, 0.02, 0, -0.028, 0.045);             // rear ring
  cylY(scope, dark, 0.008, 0.016, 0, 0.026, 0.03, 8);                // elevation turret
  cylX(scope, dark, 0.008, 0.016, 0.024, 0, 0.03, 8);                // windage turret
  // bolt (animated: translates ±Z) + boltHandle (animated: rotates around Z)
  const bolt = part(g, 0, 0.035, 0.1);
  parts.bolt = bolt;
  cylZ(bolt, steel, 0.011, 0.11, 0, 0, 0, 12);
  const boltHandle = part(bolt, 0.012, 0, 0.035);
  boltHandle.rotation.z = -0.55;                                     // rest: handle down-right
  parts.boltHandle = boltHandle;
  cylX(boltHandle, steel, 0.006, 0.04, 0.02, 0, 0, 8);
  cylY(boltHandle, dark, 0.009, 0.018, 0.042, -0.006, 0, 8);         // knob
  // magazine — box mag with green window
  const mag = part(g, 0, -0.03, 0.0);
  parts.mag = mag;
  box(mag, dark, 0.03, 0.075, 0.07, 0, -0.033, 0, 0.06);
  box(mag, green, 0.031, 0.008, 0.066, 0, -0.06, 0.004, 0.06);
  // stock — full chassis, cheekpad, butt hook, thumbhole slot
  box(g, navy, 0.042, 0.055, 0.24, 0, 0.005, 0.31, -0.03);
  box(g, navy2, 0.03, 0.02, 0.12, 0, 0.045, 0.3);                    // cheekpad
  box(g, dark, 0.044, 0.1, 0.022, 0, -0.015, 0.51, -0.03);           // butt pad
  box(g, navy, 0.02, 0.05, 0.06, 0, -0.055, 0.47);                   // butt hook
  box(g, dark, 0.028, 0.07, 0.036, 0, -0.05, 0.14, -0.3);            // grip
  // bipod stubs — folded back under the handguard front
  box(g, steel, 0.008, 0.008, 0.09, -0.018, -0.028, -0.24, -0.5);
  box(g, steel, 0.008, 0.008, 0.09, 0.018, -0.028, -0.24, -0.5);
  // trigger
  parts.trigger = trigger(g, dark, -0.016, 0.09);
  guard(g, dark, 0.02, 0, -0.032, 0.086);

  parts.muzzle = part(g, 0, 0.03, -0.675);
  parts.shellEject = part(g, 0.026, 0.035, 0.06);

  return {
    group: g,
    parts,
    meta: {
      sightY: 0.085,
      hip: { pos: [0.245, -0.26, -0.5], rot: [0, 0.05, 0.02] },
      adsZ: -0.34,
      gripR: { pos: [0, -0.06, 0.14], rot: [0.2, 0, 0] },
      gripL: { pos: [0, -0.045, -0.22], rot: [0.1, 0, 0] },
    },
  };
}

// ---------------------------------------------------------------------------
// THE EXOTIC — slot 6 rocket launcher. Fat tube/barrel, a loaded warhead tip
// poking out the front (hidden on fire, back on reload), top sight, grip +
// trigger, shoulder rest. Orange/black hazard + emissive warning accents.
// Heaviest silhouette (~1.05 m). Named parts: trigger, warhead, pump, loader.
// ---------------------------------------------------------------------------
function buildExotic() {
  const g = new THREE.Group();
  const body = M(0x2b2d31, { rough: 0.6, metal: 0.4 });      // matte black body
  const dark = M(0x161719, { rough: 0.55, metal: 0.35 });
  const steel = M(0x484c54, { rough: 0.4, metal: 0.7 });
  const hazard = M(0xd7791a, { rough: 0.55, metal: 0.25 });   // hazard orange plate
  const warn = M(0x431003, { rough: 0.45, metal: 0.1, emissive: 0xff5a1e, glow: 2.4 }); // emissive warning
  const warhead = M(0x522017, { rough: 0.5, metal: 0.2, emissive: 0xff7a2a, glow: 1.6 });
  const parts = {};

  // main launch tube — big fat cylinder running front/back
  cylZ(g, body, 0.055, 0.62, 0, 0.03, -0.16, 18);
  cylZ(g, dark, 0.06, 0.05, 0, 0.03, 0.14, 18);               // rear collar / blast shroud
  cylZ(g, dark, 0.062, 0.04, 0, 0.03, -0.45, 18);             // front muzzle collar
  // rear exhaust venturi (open-back launcher look)
  cylZ(g, steel, 0.05, 0.06, 0, 0.03, 0.16, 16, 0.062);
  // hazard stripes wrapping the tube (angled boxes riding the top)
  for (let i = 0; i < 4; i++) {
    box(g, i % 2 === 0 ? hazard : dark, 0.114, 0.016, 0.03, 0, 0.086, -0.34 + i * 0.09);
  }
  // emissive warning band near the front + arming lights
  cylZ(g, warn, 0.058, 0.02, 0, 0.03, -0.4, 18);
  box(g, warn, 0.01, 0.01, 0.01, 0.05, 0.06, -0.1);
  box(g, warn, 0.01, 0.01, 0.01, -0.05, 0.06, -0.1);

  // top carry handle + sight block
  box(g, dark, 0.03, 0.05, 0.14, 0, 0.11, -0.02);
  box(g, steel, 0.026, 0.02, 0.05, 0, 0.14, -0.02);           // sight rail
  ironSights(g, dark, warn, 0.155, -0.06, 0.05);

  // loaded WARHEAD — a fat rounded nose poking out the front of the tube.
  // Animatable: hidden on fire, re-seats on reload. Parent group at the tip.
  const wh = part(g, 0, 0.03, -0.47);
  parts.warhead = wh;
  cylZ(wh, warhead, 0.05, 0.06, 0, 0, 0.02, 16);              // warhead body inside collar
  cylZ(wh, warhead, 0.05, 0.07, 0, 0, -0.05, 16, 0.012);      // tapered nose cone
  box(wh, warn, 0.014, 0.014, 0.014, 0, 0.048, -0.05);        // glowing nose tip
  // four little fins around the warhead base
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + Math.PI / 4;
    box(wh, dark, 0.008, 0.03, 0.05, Math.cos(a) * 0.05, Math.sin(a) * 0.05 + 0.0, 0.02,
      0, 0, a - Math.PI / 2);
  }

  // pump / fore-grip slider under the tube (support hand rides this on reload)
  const pump = part(g, 0, -0.03, -0.24);
  parts.pump = pump;
  box(pump, dark, 0.05, 0.05, 0.11, 0, 0, 0);
  for (let i = 0; i < 3; i++) box(pump, steel, 0.052, 0.006, 0.012, 0, 0, -0.03 + i * 0.03);
  box(pump, hazard, 0.052, 0.01, 0.09, 0, -0.026, 0);

  // side loader hatch (breech) — swings/lights on reload
  const loader = part(g, 0.052, 0.03, 0.06);
  parts.loader = loader;
  box(loader, steel, 0.014, 0.06, 0.11, 0, 0, 0);
  box(loader, warn, 0.016, 0.02, 0.02, 0, 0.024, -0.03);      // hatch indicator light

  // pistol grip + trigger + trigger guard, near origin
  box(g, body, 0.032, 0.1, 0.05, 0, -0.06, 0.06, -0.2);
  box(g, hazard, 0.034, 0.012, 0.05, 0, -0.108, 0.05, -0.2);  // grip base plate
  parts.trigger = trigger(g, dark, -0.02, 0.055);
  guard(g, dark, 0.022, 0, -0.038, 0.05);

  // shoulder rest — a padded pad at the very back
  box(g, dark, 0.09, 0.11, 0.03, 0, 0.02, 0.205);
  box(g, hazard, 0.094, 0.014, 0.032, 0, -0.04, 0.205);       // rest lower pad line
  box(g, body, 0.03, 0.04, 0.09, 0, 0.005, 0.15);             // rest neck

  parts.muzzle = part(g, 0, 0.03, -0.48);
  parts.shellEject = part(g, 0.055, 0.05, 0.06);              // side breech (no real shells)

  return {
    group: g,
    parts,
    meta: {
      sightY: 0.16,
      hip: { pos: [0.25, -0.27, -0.5], rot: [0, 0.05, 0.02] },
      adsZ: -0.36,
      gripR: { pos: [0, -0.075, 0.06], rot: [0.2, 0, 0] },
      gripL: { pos: [0, -0.05, -0.24], rot: [0.15, 0, 0] },   // support hand on the pump
    },
  };
}

// ---------------------------------------------------------------------------
// SAWBLADE LAUNCHER — slot 7. A bladed disc visible in an open top magazine
// housing, a launch rail/slot at the muzzle, angular tech body. Magenta/steel
// + emissive accents (~0.62 m). Named parts: trigger, blade (spinning disc),
// mag, feeder.
// ---------------------------------------------------------------------------
function buildSawblade() {
  const g = new THREE.Group();
  const steelBody = M(0x3c4048, { rough: 0.45, metal: 0.65 });
  const dark = M(0x1a1c21, { rough: 0.55, metal: 0.4 });
  const steel = M(0x596069, { rough: 0.35, metal: 0.8 });
  const mag = M(0xff2fb0, { rough: 0.4, metal: 0.2, emissive: 0xff2fb0, glow: 2.2 }); // magenta emissive
  const magDim = M(0x3a0b2c, { rough: 0.5, metal: 0.2, emissive: 0xff2fb0, glow: 1.0 });
  const bladeMat = M(0xb9c2cc, { rough: 0.25, metal: 0.9 });  // bright steel blade
  const bladeGlow = M(0x2a0f22, { rough: 0.3, metal: 0.3, emissive: 0xff5ec8, glow: 1.8 });
  const parts = {};

  // angular receiver body (wedge-ish stacked boxes)
  box(g, steelBody, 0.05, 0.07, 0.3, 0, 0.02, -0.05);
  box(g, dark, 0.052, 0.03, 0.16, 0, 0.056, -0.02);           // top spine
  box(g, magDim, 0.054, 0.006, 0.2, 0, 0.006, -0.03);         // magenta side glow strip
  // chamfer plates for the tech look
  box(g, dark, 0.03, 0.03, 0.1, 0.028, 0.05, -0.14, 0, 0, 0.5);
  box(g, dark, 0.03, 0.03, 0.1, -0.028, 0.05, -0.14, 0, 0, -0.5);

  // launch rail / slot at the muzzle — an open horizontal slot the blade exits
  box(g, steel, 0.06, 0.016, 0.12, 0, 0.03, -0.24);           // upper rail lip
  box(g, steel, 0.06, 0.016, 0.12, 0, -0.006, -0.24);         // lower rail lip
  box(g, mag, 0.05, 0.004, 0.1, 0, 0.012, -0.245);            // glowing slot channel
  box(g, dark, 0.014, 0.036, 0.12, 0.03, 0.012, -0.24);       // rail side wall R
  box(g, dark, 0.014, 0.036, 0.12, -0.03, 0.012, -0.24);      // rail side wall L

  // open TOP magazine housing — a box cage that shows the blade stack
  const magG = part(g, 0, 0.075, 0.04);
  parts.mag = magG;
  box(magG, dark, 0.05, 0.09, 0.12, 0, 0.02, 0);              // mag housing back wall
  box(magG, steel, 0.006, 0.09, 0.12, 0.025, 0.02, 0);        // R rail of the cage
  box(magG, steel, 0.006, 0.09, 0.12, -0.025, 0.02, 0);       // L rail of the cage
  box(magG, mag, 0.05, 0.008, 0.12, 0, 0.066, 0);             // glowing top load line
  // a stack of stored blade edges peeking in the housing
  for (let i = 0; i < 3; i++) {
    disc(magG, bladeMat, 0.03, 0, -0.01 + i * 0.024, -0.03 + i * 0.02, 14);
  }

  // the loaded BLADE — a spinning disc sitting in the launch position, visible
  // through the open side. GunAnim spins parts.blade around its face (Z axis).
  const blade = part(g, 0, 0.015, -0.14);
  parts.blade = blade;
  // disc facing ±Z so it spins in view like a sawblade
  cylZ(blade, bladeMat, 0.05, 0.01, 0, 0, 0, 20);
  // teeth around the rim (little angled boxes)
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    box(blade, bladeMat, 0.012, 0.018, 0.012,
      Math.cos(a) * 0.056, Math.sin(a) * 0.056, 0, 0, 0, a + Math.PI / 2);
  }
  cylZ(blade, bladeGlow, 0.018, 0.014, 0, 0, 0, 14);          // glowing hub
  box(blade, dark, 0.006, 0.006, 0.02, 0, 0, 0);              // hub bolt

  // feeder arm — pushes the next blade from the mag into the rail (animatable)
  const feeder = part(g, 0, 0.05, 0.02);
  parts.feeder = feeder;
  box(feeder, steel, 0.036, 0.012, 0.03, 0, 0, 0);
  box(feeder, mag, 0.02, 0.006, 0.01, 0, 0.009, -0.014);      // feeder tip light

  // barrel/emitter stub at the very front
  cylZ(g, steel, 0.02, 0.06, 0, 0.012, -0.31, 12);
  cylZ(g, mag, 0.022, 0.014, 0, 0.012, -0.335, 12);           // emitter glow ring

  // grip + trigger + guard
  box(g, steelBody, 0.03, 0.09, 0.045, 0, -0.055, 0.05, -0.22);
  box(g, mag, 0.032, 0.01, 0.045, 0, -0.098, 0.04, -0.22);    // magenta grip cap
  box(g, dark, 0.026, 0.05, 0.03, 0, -0.045, -0.2, 0.2);      // vertical foregrip
  box(g, mag, 0.028, 0.006, 0.028, 0, -0.07, -0.206, 0.2);
  parts.trigger = trigger(g, dark, -0.012, 0.045);
  guard(g, dark, 0.02, 0, -0.03, 0.04);

  // top sight
  ironSights(g, dark, mag, 0.072, -0.2, 0.09);

  parts.muzzle = part(g, 0, 0.015, -0.31);
  parts.shellEject = part(g, 0.03, 0.03, -0.06);              // rail side (no brass; sparks)

  return {
    group: g,
    parts,
    meta: {
      sightY: 0.087,
      hip: { pos: [0.225, -0.235, -0.45], rot: [0, 0.055, 0.02] },
      adsZ: -0.34,
      gripR: { pos: [0, -0.065, 0.05], rot: [0.18, 0, 0] },
      gripL: { pos: [0, -0.05, -0.2], rot: [0.15, 0, 0] },
    },
  };
}

// ---------------------------------------------------------------------------
// DMR — gunmetal + amber, ~0.95 m. Long marksman rifle w/ a compact optic, long
// free-float handguard + barrel, angled mag, cheek-riser stock. Named parts:
// bolt (reciprocates per shot), mag, scope, trigger.
// ---------------------------------------------------------------------------
function buildDmr() {
  const g = new THREE.Group();
  const body = M(0x33383f, { rough: 0.5, metal: 0.55 });
  const dark = M(0x1c1f24, { rough: 0.55, metal: 0.4 });
  const steel = M(0x474c54, { rough: 0.4, metal: 0.75 });
  const tan = M(0x7a6a48, { rough: 0.7, metal: 0.1 });
  const amber = M(0x4a2f06, { rough: 0.45, metal: 0.15, emissive: 0xffb347, glow: 1.9 });
  const parts = {};

  // receiver (long, slim)
  box(g, body, 0.044, 0.05, 0.34, 0, 0.02, 0.0);
  rail(g, dark, 0.26, 0, 0.05, -0.02);
  box(g, amber, 0.046, 0.005, 0.06, 0, 0.03, 0.05);                 // receiver accent stripe
  box(g, dark, 0.014, 0.02, 0.055, 0.022, 0.02, -0.01);             // ejection port frame
  // long free-float handguard + long marksman barrel
  box(g, tan, 0.04, 0.042, 0.26, 0, 0.024, -0.28);
  for (let i = 0; i < 5; i++) box(g, dark, 0.042, 0.006, 0.012, 0, 0.03, -0.19 - i * 0.04);  // vents
  cylZ(g, steel, 0.0095, 0.2, 0, 0.024, -0.5, 12);
  box(g, dark, 0.02, 0.02, 0.05, 0, 0.024, -0.6);                   // muzzle brake
  box(g, amber, 0.022, 0.003, 0.03, 0, 0.024, -0.6);                // brake glow slot
  // compact marksman OPTIC on the rail (smaller than the sniper's)
  const scope = part(g, 0, 0.08, -0.03);
  parts.scope = scope;
  cylZ(scope, dark, 0.016, 0.14, 0, 0, 0, 14);
  cylZ(scope, dark, 0.022, 0.04, 0, 0, -0.08, 14, 0.018);           // objective bell
  disc(scope, amber, 0.02, 0, 0, -0.101);                           // objective glint
  disc(scope, M(0x05080a, { rough: 0.2, metal: 0.1 }), 0.014, 0, 0, 0.071); // ocular lens
  box(scope, body, 0.012, 0.028, 0.018, 0, -0.026, -0.04);          // front ring
  box(scope, body, 0.012, 0.028, 0.018, 0, -0.026, 0.04);           // rear ring
  // bolt (animated: reciprocates +Z per shot)
  const bolt = part(g, 0.017, 0.026, 0.02);
  parts.bolt = bolt;
  box(bolt, steel, 0.011, 0.016, 0.05);
  cylX(bolt, dark, 0.006, 0.012, 0.008, 0, 0);                      // charging knob
  // magazine — angled box, mid-length
  const mag = part(g, 0, -0.022, -0.04);
  parts.mag = mag;
  box(mag, dark, 0.024, 0.075, 0.05, 0, -0.036, -0.004, 0.12);
  box(mag, dark, 0.023, 0.055, 0.048, 0, -0.09, -0.02, 0.3);
  box(mag, amber, 0.025, 0.008, 0.05, 0, -0.115, -0.03, 0.3);       // amber follower window
  // stock — marksman, cheek riser + butt pad
  cylZ(g, body, 0.014, 0.08, 0, 0.018, 0.2, 10);                    // buffer tube
  box(g, body, 0.038, 0.055, 0.13, 0, 0.006, 0.3, -0.05);
  box(g, dark, 0.04, 0.08, 0.02, 0, -0.006, 0.37, -0.05);           // butt pad
  box(g, body, 0.028, 0.016, 0.1, 0, 0.04, 0.3);                    // cheek riser
  // grip + trigger
  box(g, dark, 0.026, 0.08, 0.04, 0, -0.052, 0.09, -0.32);
  parts.trigger = trigger(g, dark, -0.02, 0.04);
  guard(g, dark, 0.02, 0, -0.036, 0.036);
  ironSights(g, dark, amber, 0.058, -0.34, 0.09);

  parts.muzzle = part(g, 0, 0.024, -0.625);
  parts.shellEject = part(g, 0.026, 0.026, 0.0);

  return {
    group: g,
    parts,
    meta: {
      sightY: 0.092,
      hip: { pos: [0.23, -0.24, -0.46], rot: [0, 0.055, 0.02] },
      adsZ: -0.34,
      gripR: { pos: [0, -0.065, 0.09], rot: [0.16, 0, 0] },
      gripL: { pos: [0, -0.05, -0.28], rot: [0.15, 0, 0] },
    },
  };
}

// ---------------------------------------------------------------------------
// REVOLVER — polished steel + wood + gold engraving, ~0.30 m. Short heavy barrel
// with underlug + ejector rod, fat 6-chamber CYLINDER (swings out on reload,
// indexes on fire), exposed hammer, raked wood grip. Named parts: cylinder
// (pivots out), hammer, ejector, trigger.
// ---------------------------------------------------------------------------
function buildRevolver() {
  const g = new THREE.Group();
  const steel = M(0x4a4f57, { rough: 0.35, metal: 0.8 });
  const dark = M(0x1b1d22, { rough: 0.5, metal: 0.5 });
  const wood = M(0x5a3a22, { rough: 0.75, metal: 0.05 });
  const gold = M(0x4a3606, { rough: 0.4, metal: 0.45, emissive: 0xffcf6a, glow: 1.7 });
  const parts = {};

  // frame + top strap
  box(g, steel, 0.026, 0.05, 0.12, 0, 0.02, -0.05);
  box(g, steel, 0.026, 0.014, 0.17, 0, 0.045, -0.07);              // top strap over the barrel
  box(g, gold, 0.027, 0.004, 0.05, 0, 0.052, -0.02);               // engraved accent
  // barrel — short, heavy, ribbed, with underlug
  cylZ(g, steel, 0.011, 0.15, 0, 0.03, -0.16, 14);
  box(g, steel, 0.02, 0.016, 0.14, 0, 0.02, -0.16);                // barrel rib (top)
  box(g, dark, 0.018, 0.02, 0.13, 0, 0.006, -0.16);                // underlug
  // ejector rod under the barrel
  const ejector = part(g, 0, 0.004, -0.14);
  parts.ejector = ejector;
  cylZ(ejector, gold, 0.006, 0.12, 0, 0, 0, 8);
  cylZ(ejector, steel, 0.009, 0.02, 0, 0, -0.06, 10);              // ejector tip
  // front blade + rear notch sights
  box(g, dark, 0.005, 0.012, 0.008, 0, 0.05, -0.225);
  box(g, gold, 0.003, 0.005, 0.004, 0, 0.058, -0.225);
  box(g, dark, 0.018, 0.008, 0.006, 0, 0.05, 0.02);
  // CYLINDER — pivot at the front-left crane so it swings OUT to the left on reload
  const cylPivot = part(g, -0.014, 0.02, -0.045);
  parts.cylinder = cylPivot;
  const cyl = part(cylPivot, 0.014, 0, 0);
  cylZ(cyl, steel, 0.026, 0.07, 0, 0, 0, 16);                      // cylinder body
  for (let i = 0; i < 6; i++) {                                    // 6 chambers (dark bores)
    const a = (i / 6) * Math.PI * 2;
    cylZ(cyl, dark, 0.005, 0.075, Math.cos(a) * 0.016, Math.sin(a) * 0.016, 0, 8);
  }
  cylZ(cyl, gold, 0.028, 0.006, 0, 0, 0.03, 16);                   // gold rear ring
  for (let i = 0; i < 6; i++) {                                    // flutes
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    box(cyl, dark, 0.006, 0.006, 0.05, Math.cos(a) * 0.024, Math.sin(a) * 0.024, 0, 0, 0, a);
  }
  // hammer (animated: drops on fire)
  const hammer = part(g, 0, 0.05, 0.03);
  hammer.rotation.x = 0.4;
  parts.hammer = hammer;
  box(hammer, dark, 0.012, 0.026, 0.01, 0, 0.013, 0);
  box(hammer, steel, 0.014, 0.008, 0.008, 0, 0.026, 0.002);       // spur
  // raked wood grip + gold cap
  box(g, wood, 0.026, 0.1, 0.05, 0, -0.05, 0.045, -0.26);
  box(g, wood, 0.028, 0.06, 0.04, 0, -0.02, 0.06, -0.3);          // backstrap swell
  box(g, gold, 0.027, 0.008, 0.05, 0, -0.096, 0.03, -0.26);       // grip cap
  parts.trigger = trigger(g, dark, -0.006, 0.0);
  guard(g, steel, 0.018, 0, -0.026, -0.004);

  parts.muzzle = part(g, 0, 0.03, -0.235);
  parts.shellEject = part(g, -0.02, 0.02, -0.045);                // cylinder face (reload eject)

  return {
    group: g,
    parts,
    meta: {
      sightY: 0.056,
      hip: { pos: [0.2, -0.2, -0.34], rot: [0, 0.05, 0.04] },
      adsZ: -0.24,
      gripR: { pos: [0, -0.05, 0.04], rot: [0.14, 0, 0] },
      gripL: { pos: [-0.02, -0.06, -0.02], rot: [0.2, 0.3, 0.4] },
    },
  };
}

// ---------------------------------------------------------------------------
// KNIFE — slot 10 dedicated melee. A held combat knife ~0.28 m: a wrapped handle
// sitting at the grip, a swept blade extending forward (−Z). parts.blade is a
// Group holding the whole blade so GunAnim's melee-swing arc pivots it. Steel +
// cyan glint edge. Held at the hip-right like the other viewmodels.
// ---------------------------------------------------------------------------
function buildKnife() {
  const g = new THREE.Group();
  const steel = M(0xb9c2cc, { rough: 0.28, metal: 0.9 });
  const dark = M(0x1a1c21, { rough: 0.55, metal: 0.4 });
  const grip = M(0x2a2d33, { rough: 0.85, metal: 0.1 });
  const cyan = M(0x0b3d46, { rough: 0.35, metal: 0.2, emissive: 0x35e0ff, glow: 1.9 });
  const parts = {};

  // handle (wrapped grip) sitting right at the origin / grip
  box(g, grip, 0.02, 0.026, 0.1, 0, 0, 0.03);
  for (let i = 0; i < 4; i++) box(g, dark, 0.022, 0.004, 0.008, 0, 0, 0.008 + i * 0.022); // wrap ridges
  box(g, grip, 0.024, 0.03, 0.014, 0, 0, 0.082);                    // pommel
  // guard / bolster between handle and blade
  box(g, steel, 0.03, 0.03, 0.014, 0, 0, -0.022);

  // BLADE group (animated swing pivot) — extends forward −Z from the guard
  const blade = part(g, 0, 0, -0.03);
  parts.blade = blade;
  box(blade, steel, 0.016, 0.006, 0.16, 0, 0, -0.08);              // spine slab
  // tapered edge: a couple of stacked thin plates narrowing toward the point
  box(blade, steel, 0.022, 0.004, 0.14, 0, -0.004, -0.075);
  box(blade, steel, 0.014, 0.003, 0.06, 0, -0.006, -0.14);         // point taper
  box(blade, cyan, 0.001, 0.003, 0.15, 0.011, -0.003, -0.078);     // glowing edge line
  box(blade, dark, 0.004, 0.007, 0.05, 0, 0.002, -0.04);           // fuller groove

  parts.muzzle = part(g, 0, 0, -0.19);                              // "tip" of the blade
  parts.shellEject = part(g, 0.02, 0.01, 0.0);                      // unused for melee

  return {
    group: g,
    parts,
    meta: {
      sightY: 0.02,
      // held BLADE-UP (vertical), not pointed forward: pitch the model up ~75° so
      // the −Z blade reads as an upright ready stance, tucked to the lower-right.
      hip: { pos: [0.26, -0.26, -0.4], rot: [1.32, 0.28, 0.12] },
      adsZ: -0.24,
      gripR: { pos: [0, 0, 0.04], rot: [0.1, 0, 0] },
      gripL: { pos: [-0.04, -0.05, -0.12], rot: [0.2, 0.3, 0.4] },
    },
  };
}

// ---------------------------------------------------------------------------
// BAT — slot 11 dedicated melee. A heavy bat/pipe ~0.7 m: a taped handle at the
// grip and a thick barrel extending forward (−Z). parts.blade is the whole bat
// HEAD group so the momentum swing pivots the heavy end. Worn steel + tape wrap
// + amber hazard band. Held hip-right.
// ---------------------------------------------------------------------------
function buildBat() {
  const g = new THREE.Group();
  const metal = M(0x555a62, { rough: 0.5, metal: 0.7 });
  const dark = M(0x1c1e22, { rough: 0.6, metal: 0.35 });
  const tape = M(0x2b2620, { rough: 0.85, metal: 0.05 });
  const amber = M(0x4a2f06, { rough: 0.5, metal: 0.15, emissive: 0xffb347, glow: 1.6 });
  const parts = {};

  // taped handle at the grip
  cylZ(g, tape, 0.017, 0.16, 0, 0, 0.05, 12);
  for (let i = 0; i < 5; i++) cylZ(g, dark, 0.0182, 0.006, 0, 0, -0.01 + i * 0.028, 12); // tape ridges
  cylZ(g, metal, 0.022, 0.02, 0, 0, 0.126, 12);                    // knob / pommel

  // BAT HEAD group (animated swing pivot) — thick barrel forward −Z
  const blade = part(g, 0, 0, -0.03);
  parts.blade = blade;
  cylZ(blade, metal, 0.026, 0.34, 0, 0, -0.2, 16, 0.02);           // tapered barrel (thick front)
  cylZ(blade, metal, 0.033, 0.06, 0, 0, -0.37, 16, 0.03);          // heavy end cap
  cylZ(blade, dark, 0.034, 0.014, 0, 0, -0.4, 16);                 // end ring
  // amber hazard bands wrapping the head
  cylZ(blade, amber, 0.028, 0.016, 0, 0, -0.14, 16);
  cylZ(blade, amber, 0.032, 0.016, 0, 0, -0.3, 16);
  // a few rivets/dents for a used look
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2;
    box(blade, dark, 0.008, 0.008, 0.008, Math.cos(a) * 0.028, Math.sin(a) * 0.028, -0.26);
  }

  parts.muzzle = part(g, 0, 0, -0.43);                              // "tip" of the bat head
  parts.shellEject = part(g, 0.02, 0.01, 0.0);                      // unused for melee

  return {
    group: g,
    parts,
    meta: {
      sightY: 0.03,
      // held HEAD-UP (vertical), resting on the shoulder rather than pointed
      // forward: pitch the model up ~65° so the bat head rises out of frame.
      hip: { pos: [0.28, -0.3, -0.42], rot: [1.15, 0.22, 0.1] },
      adsZ: -0.3,
      gripR: { pos: [0, 0, 0.06], rot: [0.12, 0, 0] },
      gripL: { pos: [0, 0, -0.02], rot: [0.15, 0, 0] },
    },
  };
}

// ---------------------------------------------------------------------------
// BR-3 TRIDENT — 'burst'. AR family but a bullpup: the action + translucent
// 3-round-stack magazine sit BEHIND the grip, so the snout is short and the
// slab runs long. Signature: 3-port muzzle brake. Gunmetal + ember (damage
// accent), ~0.66 m. Named parts: mag, boltHandle (side charger), trigger.
// ---------------------------------------------------------------------------
function buildBurst() {
  const g = new THREE.Group();
  const gun = M(0x2a3340, { rough: 0.55, metal: 0.4 });
  const dark = M(0x1a2028, { rough: 0.55, metal: 0.35 });
  const iron = M(0x3a4148, { rough: 0.45, metal: 0.6 });
  const ember = M(0x4a1c08, { rough: 0.45, metal: 0.15, emissive: 0xff8a4a, glow: 2.0 });
  // translucent mag shell — the one see-through material in the armory
  const shell = new THREE.MeshStandardMaterial({
    color: 0x9fb6c6, roughness: 0.25, metalness: 0.1,
    transparent: true, opacity: 0.3, depthWrite: false,
  });
  const parts = {};

  // bullpup slab — receiver runs long behind the grip, wedge chamfers on top
  box(g, gun, 0.048, 0.062, 0.4, 0, 0.02, 0.06);
  box(g, dark, 0.05, 0.018, 0.3, 0, 0.058, 0.02);                    // flat-top spine
  rail(g, dark, 0.18, 0, 0.07, -0.02);
  box(g, iron, 0.028, 0.028, 0.22, 0.03, 0.042, 0.12, 0, 0, 0.6);    // R wedge chamfer
  box(g, iron, 0.028, 0.028, 0.22, -0.03, 0.042, 0.12, 0, 0, -0.6);  // L wedge chamfer
  box(g, dark, 0.05, 0.078, 0.024, 0, 0.004, 0.27);                  // butt pad
  box(g, ember, 0.049, 0.005, 0.1, 0, 0.049, 0.16);                  // rear accent stripe
  // short snout + barrel
  box(g, iron, 0.042, 0.048, 0.1, 0, 0.026, -0.17);
  box(g, dark, 0.044, 0.008, 0.012, 0, 0.045, -0.19);                // snout vent
  cylZ(g, iron, 0.0095, 0.07, 0, 0.03, -0.25, 12);
  // signature 3-PORT muzzle brake — squared block, three glowing port slots
  box(g, dark, 0.032, 0.032, 0.062, 0, 0.03, -0.312);
  for (let i = 0; i < 3; i++) {
    box(g, ember, 0.036, 0.005, 0.009, 0, 0.03, -0.294 - i * 0.017);
  }
  // side charging handle riding a slot on the left wall
  const boltHandle = part(g, -0.027, 0.038, 0.0);
  parts.boltHandle = boltHandle;
  box(boltHandle, iron, 0.01, 0.012, 0.045);
  box(boltHandle, dark, 0.022, 0.01, 0.014, -0.012, 0, 0.016);       // grab tab
  box(g, dark, 0.002, 0.005, 0.14, -0.0245, 0.038, 0.02);            // slot line
  // translucent magazine behind the grip — glowing 3-round burst stack inside
  const mag = part(g, 0, -0.01, 0.16);
  mag.rotation.x = -0.1;
  parts.mag = mag;
  for (let i = 0; i < 3; i++) {
    box(mag, ember, 0.017, 0.011, 0.042, 0, -0.036 - i * 0.019, 0);  // the burst stack
  }
  box(mag, shell, 0.026, 0.082, 0.05, 0, -0.055, 0);                 // clear shell over it
  box(mag, dark, 0.028, 0.01, 0.052, 0, -0.1, 0);                    // baseplate
  // grip forward of the mag well + trigger + guard + sights
  box(g, gun, 0.026, 0.08, 0.04, 0, -0.05, -0.02, -0.34);
  parts.trigger = trigger(g, dark, -0.02, -0.05);
  guard(g, dark, 0.02, 0, -0.036, -0.054);
  ironSights(g, dark, ember, 0.075, -0.15, 0.19);

  parts.muzzle = part(g, 0, 0.03, -0.345);
  parts.shellEject = part(g, 0.026, 0.03, 0.1);                      // bullpup rear port

  return {
    group: g,
    parts,
    meta: {
      sightY: 0.094,
      hip: { pos: [0.225, -0.235, -0.44], rot: [0, 0.055, 0.02] },
      adsZ: -0.31,
      gripR: { pos: [0, -0.06, -0.02], rot: [0.15, 0, 0] },
      gripL: { pos: [0, -0.045, -0.17], rot: [0.15, 0, 0] },
    },
  };
}

// ---------------------------------------------------------------------------
// ARC LANCE — 'arclance'. Energy beam rifle ~0.9 m: split-prong barrel with a
// glowing beam channel between the prongs, accelerator coil rings stepping
// down the throat, heat vanes, and a swappable cyan energy cell under the
// receiver. Gunmetal + cyan. Named parts: cell (reload swaps it), trigger.
// ---------------------------------------------------------------------------
function buildArclance() {
  const g = new THREE.Group();
  const gun = M(0x2a3340, { rough: 0.5, metal: 0.45 });
  const dark = M(0x1a2028, { rough: 0.55, metal: 0.35 });
  const iron = M(0x3a4148, { rough: 0.4, metal: 0.7 });
  const cyan = M(0x0a2e40, { rough: 0.4, metal: 0.2, emissive: 0x35e0ff, glow: 2.0 });
  // pure-glow beam between the prongs (the one additive material here)
  const beam = new THREE.MeshBasicMaterial({
    color: 0x7df3ff, transparent: true, opacity: 0.75,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const parts = {};

  // receiver — slim energy housing with a charge line
  box(g, gun, 0.046, 0.06, 0.3, 0, 0.02, 0.05);
  box(g, dark, 0.048, 0.018, 0.2, 0, 0.055, 0.03);                   // top spine
  box(g, cyan, 0.047, 0.005, 0.16, 0, 0.03, 0.02);                   // charge line
  rail(g, dark, 0.14, 0, 0.068, 0.03);
  // accelerator coil rings stepping down the throat
  for (let i = 0; i < 3; i++) {
    cylZ(g, iron, 0.034 - i * 0.004, 0.02, 0, 0.026, -0.13 - i * 0.06, 12);
    cylZ(g, cyan, 0.026 - i * 0.004, 0.008, 0, 0.026, -0.13 - i * 0.06, 12);
  }
  cylZ(g, dark, 0.018, 0.22, 0, 0.026, -0.2, 10);                    // core conduit
  // split-prong barrel — upper/lower blades, beam channel glowing between
  box(g, iron, 0.014, 0.03, 0.26, 0, 0.058, -0.36);                  // upper prong
  box(g, iron, 0.014, 0.03, 0.26, 0, -0.006, -0.36);                 // lower prong
  box(g, cyan, 0.016, 0.008, 0.04, 0, 0.058, -0.47);                 // upper tip emitter
  box(g, cyan, 0.016, 0.008, 0.04, 0, -0.006, -0.47);                // lower tip emitter
  box(g, beam, 0.005, 0.036, 0.24, 0, 0.026, -0.36);                 // BEAM channel
  // heat vanes flaring off the receiver top
  for (let i = 0; i < 3; i++) {
    box(g, dark, 0.062, 0.005, 0.018, 0, 0.048, -0.03 - i * 0.035);
  }
  // energy CELL under the receiver — cyan core in a dark sleeve, ends glowing
  const cell = part(g, 0, -0.032, 0.02);
  parts.cell = cell;
  cylZ(cell, cyan, 0.015, 0.11, 0, 0, 0, 12);                        // glowing core
  cylZ(cell, dark, 0.019, 0.07, 0, 0, 0, 12);                        // sleeve band
  box(cell, iron, 0.012, 0.01, 0.02, 0, -0.018, 0);                  // release latch
  // skeleton stock + grip + trigger + sights
  box(g, gun, 0.03, 0.02, 0.16, 0, 0.03, 0.26);                      // stock top bar
  box(g, dark, 0.036, 0.09, 0.02, 0, -0.01, 0.33);                   // butt plate
  box(g, gun, 0.024, 0.05, 0.016, 0, -0.01, 0.24, 0.35);             // stock strut
  box(g, dark, 0.026, 0.08, 0.04, 0, -0.05, 0.1, -0.32);             // grip
  box(g, cyan, 0.027, 0.008, 0.04, 0, -0.088, 0.09, -0.32);          // grip cap glow
  parts.trigger = trigger(g, dark, -0.018, 0.05);
  guard(g, dark, 0.02, 0, -0.034, 0.046);
  ironSights(g, dark, cyan, 0.072, -0.2, 0.09);

  parts.muzzle = part(g, 0, 0.026, -0.49);
  parts.shellEject = part(g, 0.026, 0.03, 0.02);                     // heat vent (no brass)

  return {
    group: g,
    parts,
    meta: {
      sightY: 0.09,
      hip: { pos: [0.23, -0.24, -0.46], rot: [0, 0.055, 0.02] },
      adsZ: -0.33,
      gripR: { pos: [0, -0.06, 0.1], rot: [0.16, 0, 0] },
      gripL: { pos: [0, -0.04, -0.16], rot: [0.15, 0, 0] },
    },
  };
}

// ---------------------------------------------------------------------------
// BREACHER — 'breacher'. Mag-fed box shotgun ~0.72 m, nothing like the pump
// M8: squared receiver, thick perforated heat shroud (through-hole pins), a
// glowing breach-door strip on the right wall, fat box mag, angled foregrip.
// Worn iron + ember. Named parts: mag, trigger.
// ---------------------------------------------------------------------------
function buildBreacher() {
  const g = new THREE.Group();
  const gun = M(0x2a3340, { rough: 0.55, metal: 0.4 });
  const dark = M(0x1a2028, { rough: 0.55, metal: 0.35 });
  const iron = M(0x3a4148, { rough: 0.5, metal: 0.55 });
  const ember = M(0x4a1c08, { rough: 0.45, metal: 0.15, emissive: 0xff8a4a, glow: 1.9 });
  const parts = {};

  // squared receiver
  box(g, gun, 0.054, 0.07, 0.24, 0, 0.014, 0.03);
  box(g, dark, 0.056, 0.02, 0.16, 0, 0.052, 0.02);                   // top cap
  rail(g, dark, 0.14, 0, 0.064, 0.02);
  // breach-door frame + glow strip on the right wall
  box(g, dark, 0.008, 0.036, 0.1, 0.028, 0.014, 0.0);
  box(g, ember, 0.009, 0.008, 0.09, 0.0285, 0.014, 0.0);             // glow strip
  // thick heat shroud with through-hole perforation pins
  cylZ(g, iron, 0.031, 0.28, 0, 0.028, -0.25, 12);
  for (let i = 0; i < 4; i++) {
    cylX(g, dark, 0.0085, 0.066, 0, 0.028, -0.15 - i * 0.06, 8);     // L/R holes
    cylY(g, dark, 0.0085, 0.066, 0, 0.028, -0.18 - i * 0.06, 8);     // T/B holes
  }
  cylZ(g, dark, 0.0155, 0.05, 0, 0.028, -0.4, 12);                   // bore + muzzle collar
  cylZ(g, ember, 0.032, 0.012, 0, 0.028, -0.375, 12);                // hot ring
  // fat BOX MAG — double-stack shells, ember follower window
  const mag = part(g, 0, -0.032, -0.02);
  parts.mag = mag;
  box(mag, dark, 0.036, 0.095, 0.075, 0, -0.042, -0.008, 0.12);
  box(mag, iron, 0.037, 0.012, 0.07, 0, -0.014, 0.0, 0.12);          // feed collar
  box(mag, ember, 0.037, 0.01, 0.07, 0, -0.092, -0.017, 0.12);       // follower window
  // angled foregrip under the shroud
  box(g, gun, 0.026, 0.06, 0.03, 0, -0.05, -0.24, 0.45);
  box(g, ember, 0.027, 0.007, 0.03, 0, -0.078, -0.252, 0.45);        // tip light
  // solid stock + butt pad
  box(g, gun, 0.04, 0.06, 0.16, 0, 0.005, 0.22, -0.07);
  box(g, dark, 0.042, 0.08, 0.02, 0, -0.012, 0.3, -0.07);            // butt pad
  // grip + trigger + sights
  box(g, dark, 0.028, 0.075, 0.04, 0, -0.05, 0.11, -0.3);
  parts.trigger = trigger(g, dark, -0.02, 0.06);
  guard(g, dark, 0.02, 0, -0.036, 0.056);
  ironSights(g, dark, ember, 0.068, -0.37, 0.08);

  parts.muzzle = part(g, 0, 0.028, -0.425);
  parts.shellEject = part(g, 0.03, 0.02, 0.0);

  return {
    group: g,
    parts,
    meta: {
      sightY: 0.086,
      hip: { pos: [0.23, -0.245, -0.45], rot: [0, 0.05, 0.02] },
      adsZ: -0.34,
      gripR: { pos: [0, -0.06, 0.11], rot: [0.18, 0, 0] },
      gripL: { pos: [0, -0.065, -0.24], rot: [0.2, 0, 0] },
    },
  };
}

// ---------------------------------------------------------------------------
// HORNET — 'hornet'. Micro-rocket carbine ~0.58 m: boxy launcher body carrying
// an OPEN 4-tube rocket rack up front (orange rocket noses visible in the
// tubes) plus a targeting fin mast on top. Gunmetal + ember. Named parts:
// rack (noses hide per shot), trigger.
// ---------------------------------------------------------------------------
function buildHornet() {
  const g = new THREE.Group();
  const gun = M(0x2a3340, { rough: 0.55, metal: 0.4 });
  const dark = M(0x1a2028, { rough: 0.55, metal: 0.35 });
  const iron = M(0x3a4148, { rough: 0.45, metal: 0.6 });
  const ember = M(0x4a1c08, { rough: 0.45, metal: 0.15, emissive: 0xff8a4a, glow: 2.1 });
  const parts = {};

  // boxy launcher body
  box(g, gun, 0.062, 0.072, 0.22, 0, 0.016, 0.06);
  box(g, dark, 0.064, 0.02, 0.14, 0, 0.055, 0.05);                   // top cap
  box(g, ember, 0.063, 0.006, 0.1, 0, 0.006, 0.04);                  // arming stripe
  box(g, dark, 0.064, 0.075, 0.02, 0, 0.014, 0.18);                  // back plate
  // open 4-TUBE ROCKET RACK — 2×2 tubes, orange nose cones peeking out
  const rack = part(g, 0, 0.02, -0.15);
  parts.rack = rack;
  box(rack, dark, 0.074, 0.078, 0.018, 0, 0, 0.1);                   // rack rear plate
  box(rack, iron, 0.078, 0.012, 0.16, 0, 0.048, 0.02);               // top strap
  box(rack, iron, 0.078, 0.012, 0.16, 0, -0.048, 0.02);              // bottom strap
  for (const [tx, ty] of [[-0.019, 0.019], [0.019, 0.019], [-0.019, -0.019], [0.019, -0.019]]) {
    cylZ(rack, iron, 0.015, 0.17, tx, ty, 0, 10);                    // tube
    cylZ(rack, ember, 0.003, 0.028, tx, ty, -0.09, 10, 0.01);        // rocket nose cone
  }
  // targeting fin mast on top — swept sensor blade with a glow tip
  box(g, iron, 0.008, 0.055, 0.026, 0, 0.09, 0.1);
  box(g, dark, 0.008, 0.02, 0.055, 0, 0.105, 0.075, 0.5);            // swept blade
  box(g, ember, 0.011, 0.011, 0.011, 0, 0.122, 0.1);                 // sensor tip
  // grip + shoulder pad + trigger + sights
  box(g, gun, 0.026, 0.078, 0.04, 0, -0.05, 0.08, -0.32);
  box(g, dark, 0.05, 0.09, 0.024, 0, 0.005, 0.2);                    // shoulder pad
  parts.trigger = trigger(g, dark, -0.018, 0.03);
  guard(g, dark, 0.02, 0, -0.034, 0.026);
  ironSights(g, dark, ember, 0.078, -0.2, 0.02);

  parts.muzzle = part(g, 0, 0.02, -0.26);
  parts.shellEject = part(g, 0.034, 0.03, 0.06);                     // side vent (no brass)

  return {
    group: g,
    parts,
    meta: {
      sightY: 0.095,
      hip: { pos: [0.23, -0.24, -0.44], rot: [0, 0.055, 0.02] },
      adsZ: -0.32,
      gripR: { pos: [0, -0.06, 0.08], rot: [0.16, 0, 0] },
      gripL: { pos: [0, -0.06, -0.13], rot: [0.2, 0, 0] },
    },
  };
}

// ---------------------------------------------------------------------------
// CAROM — 'carom'. Disc trick-launcher ~0.6 m, deliberately unlike the
// sawblade RIPTIDE: a vertical disc-magazine WHEEL rides the rear (rim-lit
// discs slotted around it), an angled launch-ramp mouth, and a forward gyro
// ring. Gunmetal + lime (buff accent). Named parts: wheel (spins on X),
// trigger.
// ---------------------------------------------------------------------------
function buildCarom() {
  const g = new THREE.Group();
  const gun = M(0x2a3340, { rough: 0.55, metal: 0.4 });
  const dark = M(0x1a2028, { rough: 0.55, metal: 0.35 });
  const iron = M(0x3a4148, { rough: 0.4, metal: 0.7 });
  const lime = M(0x1c3a10, { rough: 0.45, metal: 0.15, emissive: 0x9fe86a, glow: 2.0 });
  const discM = M(0xb9c2cc, { rough: 0.3, metal: 0.85 });
  const parts = {};

  // wedge body
  box(g, gun, 0.05, 0.06, 0.28, 0, 0.012, -0.03);
  box(g, dark, 0.052, 0.02, 0.16, 0, 0.048, -0.06);                  // top spine
  box(g, lime, 0.051, 0.005, 0.18, 0, 0.0, -0.05);                   // side accent line
  // vertical disc-magazine WHEEL at the rear — spins around X, discs at the rim
  const wheel = part(g, 0, 0.062, 0.11);
  parts.wheel = wheel;
  cylX(wheel, dark, 0.052, 0.026, 0, 0, 0, 16);                      // drum
  cylX(wheel, iron, 0.012, 0.034, 0, 0, 0, 8);                       // axle hub
  for (let i = 0; i < 4; i++) {                                      // rim-lit stored discs
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const dy = Math.cos(a) * 0.04, dz = Math.sin(a) * 0.04;
    cylX(wheel, discM, 0.018, 0.008, 0, dy, dz, 12);                 // disc edge-on
    cylX(wheel, lime, 0.019, 0.003, 0, dy, dz, 12);                  // rim light
  }
  box(g, iron, 0.006, 0.1, 0.1, 0.028, 0.06, 0.11);                  // wheel cage R
  box(g, iron, 0.006, 0.1, 0.1, -0.028, 0.06, 0.11);                 // wheel cage L
  // angled launch-ramp mouth — open jaw the disc banks out of
  box(g, iron, 0.056, 0.012, 0.14, 0, 0.042, -0.21, -0.3);           // upper lip (angled)
  box(g, iron, 0.056, 0.012, 0.14, 0, -0.004, -0.21);                // lower lip
  box(g, lime, 0.048, 0.005, 0.12, 0, 0.014, -0.21, -0.15);          // glowing ramp channel
  box(g, dark, 0.012, 0.032, 0.13, 0.026, 0.014, -0.21, -0.15);      // jaw wall R
  box(g, dark, 0.012, 0.032, 0.13, -0.026, 0.014, -0.21, -0.15);     // jaw wall L
  // forward GYRO RING around the mouth
  const gyro = new THREE.Mesh(new THREE.TorusGeometry(0.046, 0.007, 8, 18), iron);
  gyro.position.set(0, 0.018, -0.285);
  g.add(gyro);
  box(g, lime, 0.009, 0.009, 0.009, 0, 0.068, -0.285);               // gyro apex bead
  // grip + foregrip + trigger + sights
  box(g, gun, 0.026, 0.08, 0.04, 0, -0.05, 0.05, -0.3);
  box(g, lime, 0.027, 0.007, 0.04, 0, -0.088, 0.04, -0.3);           // grip cap
  box(g, dark, 0.024, 0.05, 0.028, 0, -0.048, -0.14, 0.25);          // angled foregrip
  parts.trigger = trigger(g, dark, -0.016, 0.0);
  guard(g, dark, 0.02, 0, -0.032, -0.004);
  ironSights(g, dark, lime, 0.06, -0.14, 0.02);

  parts.muzzle = part(g, 0, 0.018, -0.29);
  parts.shellEject = part(g, 0.03, 0.03, 0.05);                      // side slot (sparks)

  return {
    group: g,
    parts,
    meta: {
      sightY: 0.078,
      hip: { pos: [0.225, -0.235, -0.44], rot: [0, 0.055, 0.02] },
      adsZ: -0.33,
      gripR: { pos: [0, -0.06, 0.05], rot: [0.17, 0, 0] },
      gripL: { pos: [0, -0.055, -0.14], rot: [0.16, 0, 0] },
    },
  };
}

// ---------------------------------------------------------------------------
// KINETIC — 'kinetic'. Force repeater ~0.52 m: a piston-driven slab barrel
// with the shock-spring coil exposed on the spine (pulse-blue rings), pressure
// gauges on both cheeks, vented sides. Gunmetal + pulse blue. Named parts:
// piston (slams back per shot), trigger.
// ---------------------------------------------------------------------------
function buildKinetic() {
  const g = new THREE.Group();
  const gun = M(0x2a3340, { rough: 0.55, metal: 0.4 });
  const dark = M(0x1a2028, { rough: 0.55, metal: 0.35 });
  const iron = M(0x3a4148, { rough: 0.4, metal: 0.7 });
  const pulse = M(0x122a3d, { rough: 0.4, metal: 0.2, emissive: 0x9fd0ff, glow: 2.1 });
  const parts = {};

  // receiver
  box(g, gun, 0.048, 0.06, 0.18, 0, 0.016, 0.05);
  box(g, dark, 0.05, 0.02, 0.12, 0, 0.05, 0.05);                     // top cap
  box(g, dark, 0.05, 0.07, 0.02, 0, 0.012, 0.15);                    // back plate
  // slab barrel — square ram housing, no round bore
  box(g, gun, 0.05, 0.05, 0.2, 0, 0.026, -0.14);
  box(g, dark, 0.054, 0.056, 0.03, 0, 0.026, -0.25);                 // ram face collar
  box(g, pulse, 0.056, 0.007, 0.02, 0, 0.026, -0.235);               // face glow slot
  box(g, iron, 0.03, 0.03, 0.05, 0, 0.026, -0.28);                   // impact head
  // vented sides on the slab
  for (let i = 0; i < 3; i++) {
    box(g, dark, 0.052, 0.007, 0.014, 0, 0.044, -0.08 - i * 0.045);
  }
  // PISTON on the spine — rod + block that slam back on each shot
  const piston = part(g, 0, 0.066, -0.05);
  parts.piston = piston;
  cylZ(piston, iron, 0.011, 0.16, 0, 0, 0, 10);
  box(piston, dark, 0.03, 0.026, 0.034, 0, 0.002, 0.09);             // piston block
  box(piston, pulse, 0.032, 0.006, 0.01, 0, 0.002, 0.075);           // block charge light
  // exposed shock-spring coil around the piston rod (emissive pulse rings)
  for (let i = 0; i < 5; i++) {
    cylZ(g, pulse, 0.016, 0.007, 0, 0.066, -0.1 + i * 0.024, 10);
  }
  // pressure gauges on both cheeks
  cylX(g, dark, 0.015, 0.012, 0.028, 0.042, 0.06, 12);
  cylX(g, pulse, 0.006, 0.014, 0.028, 0.042, 0.06, 8);               // needle glow
  cylX(g, dark, 0.015, 0.012, -0.028, 0.042, 0.06, 12);
  // sight risers so the posts clear the piston rod
  box(g, iron, 0.01, 0.02, 0.012, 0, 0.062, -0.2);                   // front riser
  box(g, iron, 0.014, 0.014, 0.012, 0, 0.065, 0.1);                  // rear riser
  ironSights(g, dark, pulse, 0.08, -0.2, 0.1);
  // grip + foregrip + trigger
  box(g, gun, 0.026, 0.078, 0.04, 0, -0.048, 0.06, -0.3);
  box(g, pulse, 0.027, 0.007, 0.04, 0, -0.085, 0.05, -0.3);          // grip cap
  box(g, dark, 0.024, 0.055, 0.026, 0, -0.046, -0.13, 0.2);          // foregrip
  parts.trigger = trigger(g, dark, -0.014, 0.01);
  guard(g, dark, 0.02, 0, -0.03, 0.006);

  parts.muzzle = part(g, 0, 0.026, -0.305);
  parts.shellEject = part(g, 0.026, 0.03, 0.02);                     // pressure vent

  return {
    group: g,
    parts,
    meta: {
      sightY: 0.098,
      hip: { pos: [0.215, -0.225, -0.4], rot: [0, 0.06, 0.02] },
      adsZ: -0.3,
      gripR: { pos: [0, -0.055, 0.06], rot: [0.12, 0, 0] },
      gripL: { pos: [0, -0.08, -0.13], rot: [0.2, 0, 0] },
    },
  };
}

// ---------------------------------------------------------------------------
const BUILDERS = {
  pistol: buildPistol,
  smg: buildSmg,
  shotgun: buildShotgun,
  ar: buildAr,
  sniper: buildSniper,
  exotic: buildExotic,
  sawblade: buildSawblade,
  dmr: buildDmr,
  revolver: buildRevolver,
  burst: buildBurst,
  arclance: buildArclance,
  breacher: buildBreacher,
  hornet: buildHornet,
  carom: buildCarom,
  kinetic: buildKinetic,
  knife: buildKnife,
  bat: buildBat,
};

/**
 * Build the code-made model for a gun def. Returns { group, parts, meta }.
 * Unknown ids fall back to the pistol so nothing ever hard-fails.
 */
export function buildWeaponModel(def) {
  const builder = BUILDERS[def?.id] || buildPistol;
  const model = builder();
  model.group.name = `weapon_${def?.id ?? 'unknown'}`;
  // no shadows in the viewmodel scene — keep every mesh cheap
  model.group.traverse((o) => {
    o.castShadow = false;
    o.receiveShadow = false;
    o.matrixAutoUpdate = true;
  });
  return model;
}
