// TOWER DEFENSE — src/td/models/enemies_a.js
// ALIEN family enemy models: drone, skitterer, warden, stalker, queen.
// Code-built, low-poly, silhouette-first (identifiable at 40m by outline).
//
// Contract:
//   BUILDERS[id](THREE, def) -> { group, parts }
//     - built at unit scale inside a wrapper group scaled by def.size
//     - ground units: feet at y=0 · flyers: body centered high (view adds hover)
//     - something head-like sits above 72% of total height (server headshot band)
//   ANIMATE[id](parts, group, t, moving, extras) — procedural, never touches
//     opacity (phase shimmer for the stalker is handled by the view).
//
// Materials: MeshStandardMaterial (lit, castShadow) + MeshBasicMaterial ONLY
// for additive glow (transparent, AdditiveBlending, depthWrite false).

const CHITIN = 0x4a2a6e;    // chitin violet
const CHITIN_DK = 0x35204f; // dark chitin
const MEMBRANE = 0xc96af0;  // membrane glow
const EYE = 0x66ff88;       // eye glow

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function stdMat(THREE, color, o = {}) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: o.rough ?? 0.55, metalness: o.metal ?? 0.28 });
  if (o.emissive) { m.emissive = new THREE.Color(o.emissive); m.emissiveIntensity = o.emissiveI ?? 1.4; }
  return m;
}
function addMat(THREE, color, opacity = 0.85, doubleSide = false) {
  const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });
  if (doubleSide) m.side = THREE.DoubleSide;
  return m;
}
function put(THREE, parent, geo, m, x = 0, y = 0, z = 0, lit = true) {
  const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = lit;
  parent.add(o); return o;
}
function box(THREE, parent, m, w, h, d, x, y, z, lit = true) {
  return put(THREE, parent, new THREE.BoxGeometry(w, h, d), m, x, y, z, lit);
}
/** hanging limb segment: box with pivot at its TOP (rotate to swing). */
function limb(THREE, parent, m, w, len, d, x, y, z) {
  const g = new THREE.BoxGeometry(w, len, d); g.translate(0, -len / 2, 0);
  return put(THREE, parent, g, m, x, y, z);
}
/** tail segment: box with pivot at its FRONT, extending backward (-Z). */
function tailSeg(THREE, parent, m, w, h, len, x, y, z) {
  const g = new THREE.BoxGeometry(w, h, len); g.translate(0, 0, -len / 2);
  return put(THREE, parent, g, m, x, y, z);
}
/** remember current rotation as the animation rest pose. */
function rest(m) { m.userData.bx = m.rotation.x; m.userData.by = m.rotation.y; m.userData.bz = m.rotation.z; return m; }
function wrapper(THREE, def) {
  const root = new THREE.Group(); const g = new THREE.Group();
  root.add(g); root.scale.setScalar(def.size);
  return { root, g };
}

// ---------------------------------------------------------------------------
// DRONE — hovering lens-disc: glowing equator ring, single big eye,
// three dangling feelers, dorsal fin sails. (flyer)
// ---------------------------------------------------------------------------
function buildDrone(THREE, def) {
  const { root, g } = wrapper(THREE, def);
  const parts = { feelers: [], fins: [] };
  const shell = stdMat(THREE, CHITIN);
  const dark = stdMat(THREE, CHITIN_DK, { rough: 0.45, metal: 0.35 });
  const glow = addMat(THREE, MEMBRANE, 0.9);
  const eyeM = stdMat(THREE, 0x0a2012, { emissive: EYE, emissiveI: 2.2 });

  const bob = new THREE.Group(); g.add(bob); parts.bobber = bob;

  // lens-disc body
  const disc = put(THREE, bob, new THREE.SphereGeometry(0.58, 14, 8), shell, 0, 1.5, 0);
  disc.scale.set(1, 0.4, 1);
  const dome = put(THREE, bob, new THREE.SphereGeometry(0.34, 12, 8), dark, 0, 1.6, 0);
  dome.scale.set(1, 0.55, 1);
  const keel = put(THREE, bob, new THREE.ConeGeometry(0.28, 0.34, 10), dark, 0, 1.3, 0);
  keel.rotation.x = Math.PI; // point down

  // glowing equator ring + orbit nodes (spun as a group about Y)
  const spin = new THREE.Group(); spin.position.y = 1.5; bob.add(spin); parts.ringSpin = spin;
  const ring = put(THREE, spin, new THREE.TorusGeometry(0.62, 0.045, 6, 24), glow, 0, 0, 0, false);
  ring.rotation.x = Math.PI / 2;
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    put(THREE, spin, new THREE.SphereGeometry(0.07, 8, 6), glow, Math.cos(a) * 0.62, 0, Math.sin(a) * 0.62, false);
  }

  // single big eye + socket ring
  parts.eye = put(THREE, bob, new THREE.SphereGeometry(0.17, 12, 8), eyeM, 0, 1.47, 0.46);
  put(THREE, bob, new THREE.TorusGeometry(0.2, 0.045, 6, 16), dark, 0, 1.47, 0.47);

  // head-like sensor node on top (headshot band)
  put(THREE, bob, new THREE.SphereGeometry(0.09, 8, 6), eyeM, 0, 1.79, 0.06);

  // dorsal fin sails
  for (let i = 0; i < 3; i++) {
    const f = box(THREE, bob, dark, 0.045, 0.3 - i * 0.05, 0.3, 0, 1.76 - i * 0.03, -0.04 - i * 0.24);
    f.rotation.x = -0.25 - i * 0.16; parts.fins.push(rest(f));
  }

  // three dangling feeler tentacles (2 segments each)
  for (let i = 0; i < 3; i++) {
    const up = limb(THREE, bob, shell, 0.055, 0.34, 0.055, (i - 1) * 0.24, 1.32, i === 1 ? -0.14 : 0.08);
    const lo = limb(THREE, up, dark, 0.045, 0.3, 0.045, 0, -0.34, 0);
    parts.feelers.push({ up: rest(up), lo: rest(lo) });
  }
  return { group: root, parts };
}

// ---------------------------------------------------------------------------
// SKITTERER — low 6-legged blade-bug: angular shell plates, raised mantis
// head + scythe forelimbs, glowing abdomen tip. (fast ground swarm)
// ---------------------------------------------------------------------------
function buildSkitterer(THREE, def) {
  const { root, g } = wrapper(THREE, def);
  const parts = { legs: [], scythes: [] };
  const shell = stdMat(THREE, CHITIN);
  const dark = stdMat(THREE, CHITIN_DK, { rough: 0.42, metal: 0.35 });
  const glow = addMat(THREE, MEMBRANE, 0.9);
  const eyeM = stdMat(THREE, 0x0a2012, { emissive: EYE, emissiveI: 2.4 });

  // angular chitin shell plates
  const p1 = box(THREE, g, shell, 0.56, 0.16, 0.66, 0, 0.5, -0.02); p1.rotation.x = -0.08;
  const p2 = box(THREE, g, dark, 0.44, 0.13, 0.4, 0, 0.6, 0.14); p2.rotation.x = 0.18;
  const p3 = box(THREE, g, dark, 0.4, 0.12, 0.34, 0, 0.55, -0.34); p3.rotation.x = -0.32;

  // abdomen + glowing tip spike
  const ab = put(THREE, g, new THREE.SphereGeometry(0.26, 10, 8), dark, 0, 0.46, -0.56);
  ab.scale.set(0.9, 0.7, 1.5);
  parts.tip = put(THREE, g, new THREE.SphereGeometry(0.09, 8, 6), glow, 0, 0.44, -0.94, false);
  const spike = put(THREE, g, new THREE.ConeGeometry(0.05, 0.22, 8), shell, 0, 0.44, -1.0);
  spike.rotation.x = -Math.PI / 2; // point backward

  // raised mantis head (headshot band) + twin eye dots + antennae
  const neck = box(THREE, g, shell, 0.16, 0.32, 0.16, 0, 0.8, 0.28); neck.rotation.x = 0.35;
  parts.head = rest(box(THREE, g, dark, 0.24, 0.2, 0.28, 0, 1.0, 0.34));
  put(THREE, parts.head, new THREE.SphereGeometry(0.05, 8, 6), eyeM, -0.08, 0.04, 0.13);
  put(THREE, parts.head, new THREE.SphereGeometry(0.05, 8, 6), eyeM, 0.08, 0.04, 0.13);
  for (const sx of [-1, 1]) {
    const ant = limb(THREE, parts.head, shell, 0.03, 0.26, 0.03, sx * 0.07, 0.1, 0.06);
    ant.rotation.x = -2.6; ant.rotation.z = sx * 0.35;
  }

  // raised scythe forelimbs
  for (const sx of [-1, 1]) {
    const arm = limb(THREE, g, shell, 0.07, 0.42, 0.07, sx * 0.2, 0.68, 0.24);
    arm.rotation.x = -2.2; arm.rotation.z = sx * 0.3; // raised up-forward, flared
    const blade = limb(THREE, arm, dark, 0.035, 0.5, 0.12, 0, -0.42, 0);
    blade.rotation.x = 1.7; // folded down-forward like a mantis
    parts.scythes.push(rest(arm));
  }

  // six legs
  for (let i = 0; i < 3; i++) for (const sx of [-1, 1]) {
    const leg = limb(THREE, g, shell, 0.05, 0.52, 0.05, sx * 0.3, 0.46, 0.22 - i * 0.25);
    leg.rotation.z = -sx * 0.72; leg.rotation.x = (i - 1) * 0.3;
    parts.legs.push(rest(leg));
  }
  return { group: root, parts };
}

// ---------------------------------------------------------------------------
// WARDEN — heavy quadruped: layered carapace shingles with glowing seams,
// head shield crest, stubby ram horns, shield emitter nubs on the back.
// ---------------------------------------------------------------------------
function buildWarden(THREE, def) {
  const { root, g } = wrapper(THREE, def);
  const parts = { legs: [], emitters: [] };
  const shell = stdMat(THREE, CHITIN);
  const dark = stdMat(THREE, CHITIN_DK, { rough: 0.42, metal: 0.38 });
  const glow = addMat(THREE, MEMBRANE, 0.8);
  const eyeM = stdMat(THREE, 0x0a2012, { emissive: EYE, emissiveI: 2.2 });

  // body block + chest
  box(THREE, g, shell, 0.78, 0.55, 1.05, 0, 0.85, -0.02);
  box(THREE, g, dark, 0.66, 0.45, 0.35, 0, 0.9, 0.55);

  // layered armor shingles down the spine + glowing seams between plates
  for (let i = 0; i < 4; i++) {
    const p = box(THREE, g, i % 2 ? shell : dark, 0.95 - i * 0.06, 0.13, 0.44, 0, 1.16 - i * 0.02, 0.32 - i * 0.3);
    p.rotation.x = -0.12 - i * 0.06;
  }
  for (let i = 0; i < 3; i++) box(THREE, g, glow, 0.8, 0.035, 0.07, 0, 1.13 - i * 0.02, 0.17 - i * 0.3, false);

  // head: skull + rising shield crest + ram horns + eyes (headshot band)
  const head = new THREE.Group(); head.position.set(0, 1.05, 0.62); g.add(head);
  parts.head = rest(head);
  box(THREE, head, shell, 0.4, 0.34, 0.42, 0, 0.1, 0.18);
  const crest = box(THREE, head, dark, 0.72, 0.5, 0.09, 0, 0.38, -0.02); crest.rotation.x = -0.3;
  for (const sx of [-1, 1]) {
    const horn = put(THREE, head, new THREE.ConeGeometry(0.07, 0.24, 8), dark, sx * 0.22, 0.12, 0.38);
    horn.rotation.x = 1.3;
    put(THREE, head, new THREE.SphereGeometry(0.05, 8, 6), eyeM, sx * 0.13, 0.06, 0.4);
  }

  // four legs (upper + lower + hoof)
  for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    const up = limb(THREE, g, shell, 0.17, 0.42, 0.2, sx * 0.44, 0.82, sz * 0.36);
    up.rotation.x = sz * 0.25;
    const lo = limb(THREE, up, dark, 0.13, 0.4, 0.15, 0, -0.42, 0);
    lo.rotation.x = -sz * 0.4;
    const hoof = box(THREE, lo, dark, 0.16, 0.09, 0.22, 0, -0.38, 0.03);
    hoof.rotation.x = sz * 0.15;
    parts.legs.push({ up: rest(up), lo: rest(lo) });
  }

  // shield emitter nubs (view adds the bubble)
  for (const [x, y, z] of [[-0.24, 1.26, -0.18], [0, 1.3, -0.44], [0.24, 1.26, -0.18]]) {
    put(THREE, g, new THREE.CylinderGeometry(0.06, 0.08, 0.16, 8), dark, x, y, z);
    parts.emitters.push(put(THREE, g, new THREE.SphereGeometry(0.055, 8, 6), glow, x, y + 0.11, z, false));
  }
  return { group: root, parts };
}

// ---------------------------------------------------------------------------
// STALKER — tall thin biped: elongated limbs with backward knees, narrow head
// with glow visor slit, blade forearms, tail whip, membrane webbing panels.
// ---------------------------------------------------------------------------
function buildStalker(THREE, def) {
  const { root, g } = wrapper(THREE, def);
  const parts = { legs: [], arms: [], tail: [] };
  const shell = stdMat(THREE, CHITIN);
  const dark = stdMat(THREE, CHITIN_DK, { rough: 0.42, metal: 0.35 });
  const glow = addMat(THREE, MEMBRANE, 0.9);
  const web = addMat(THREE, MEMBRANE, 0.35, true);

  // pelvis, torso spars, chest — with membrane webbing between the spars
  box(THREE, g, dark, 0.3, 0.22, 0.26, 0, 1.0, 0);
  for (const sx of [-1, 1]) {
    const spar = box(THREE, g, shell, 0.09, 0.6, 0.11, sx * 0.11, 1.3, 0);
    spar.rotation.z = -sx * 0.06;
  }
  box(THREE, g, shell, 0.36, 0.3, 0.24, 0, 1.62, 0.02);
  put(THREE, g, new THREE.PlaneGeometry(0.2, 0.52), web, 0, 1.3, 0.09, false);
  put(THREE, g, new THREE.PlaneGeometry(0.2, 0.52), web, 0, 1.3, -0.09, false);

  // narrow head + glow visor slit (headshot band) + shoulder spikes
  const head = new THREE.Group(); head.position.set(0, 1.85, 0.04); g.add(head);
  parts.head = rest(head);
  box(THREE, head, dark, 0.17, 0.22, 0.38, 0, 0, 0.06);
  box(THREE, head, glow, 0.15, 0.035, 0.05, 0, 0.02, 0.26, false);
  for (const sx of [-1, 1]) {
    const spk = put(THREE, g, new THREE.ConeGeometry(0.05, 0.22, 8), dark, sx * 0.26, 1.76, 0);
    spk.rotation.z = -sx * 0.64;
  }

  // blade forearms
  for (const sx of [-1, 1]) {
    const up = limb(THREE, g, shell, 0.075, 0.5, 0.075, sx * 0.26, 1.6, 0.02);
    up.rotation.x = 0.35; up.rotation.z = -sx * 0.15;
    limb(THREE, up, dark, 0.035, 0.62, 0.11, 0, -0.5, 0).rotation.x = -0.5;
    parts.arms.push(rest(up));
  }

  // digitigrade legs: thigh forward, backward knee, level foot
  for (const sx of [-1, 1]) {
    const thigh = limb(THREE, g, shell, 0.1, 0.55, 0.12, sx * 0.15, 0.95, 0);
    thigh.rotation.x = 0.55;
    const shin = limb(THREE, thigh, dark, 0.075, 0.55, 0.085, 0, -0.55, 0);
    shin.rotation.x = -1.15;
    const foot = box(THREE, shin, dark, 0.09, 0.07, 0.3, 0, -0.53, 0.06);
    foot.rotation.x = 0.6;
    parts.legs.push({ thigh: rest(thigh), shin: rest(shin) });
  }

  // tail whip (3 chained segments, curling up)
  let tp = g, tx = 0, ty = 0.98, tz = -0.14;
  for (const len of [0.4, 0.36, 0.3]) {
    const seg = tailSeg(THREE, tp, shell, 0.07, 0.07, len, tx, ty, tz);
    seg.rotation.x = 0.3; parts.tail.push(rest(seg));
    tp = seg; tx = 0; ty = 0; tz = -len;
  }
  return { group: root, parts };
}

// ---------------------------------------------------------------------------
// QUEEN — BOSS hovering egg-carrier: bloated segmented abdomen with glowing
// egg pods, crown of horns, four arm-scythes, tentacle skirt, twin eye
// clusters. Big crown silhouette + brightest glow mass. (flyer, 2.4x)
// ---------------------------------------------------------------------------
function buildQueen(THREE, def) {
  const { root, g } = wrapper(THREE, def);
  const parts = { tentacles: [], scythes: [], podGlows: [] };
  const shell = stdMat(THREE, CHITIN);
  const dark = stdMat(THREE, CHITIN_DK, { rough: 0.45, metal: 0.35 });
  const glow = addMat(THREE, MEMBRANE, 0.85);
  const eyeM = stdMat(THREE, 0x0a2012, { emissive: EYE, emissiveI: 2.4 });

  const bob = new THREE.Group(); g.add(bob); parts.bobber = bob;

  // bloated segmented abdomen (throb group)
  const abg = new THREE.Group(); abg.position.set(0, 0.95, -0.32); bob.add(abg);
  parts.abGroup = abg;
  const ab1 = put(THREE, abg, new THREE.SphereGeometry(0.46, 14, 10), dark, 0, 0, 0);
  ab1.scale.set(1, 0.85, 1.15);
  const ab2 = put(THREE, abg, new THREE.SphereGeometry(0.32, 12, 8), shell, 0, -0.06, -0.3);
  ab2.scale.set(1, 0.85, 1.05);
  put(THREE, abg, new THREE.SphereGeometry(0.16, 10, 8), dark, 0, -0.12, -0.46);

  // egg pods — first three are OPEN (glow cores)
  const podAt = [[0.34, 0.2, 0.05], [-0.34, 0.2, 0], [0, 0.35, -0.24], [0.4, -0.05, -0.16], [-0.4, -0.05, -0.22], [0.2, -0.26, 0.02]];
  podAt.forEach(([x, y, z], i) => {
    put(THREE, abg, new THREE.SphereGeometry(0.1, 8, 6), shell, x, y, z);
    if (i < 3) parts.podGlows.push(put(THREE, abg, new THREE.SphereGeometry(0.07, 8, 6), glow, x * 1.18, y * 1.18, z + (z > -0.1 ? 0.04 : -0.04), false));
  });

  // brightest glow mass under the abdomen
  parts.wombGlow = put(THREE, abg, new THREE.SphereGeometry(0.3, 10, 8), glow, 0, -0.28, -0.18, false);
  parts.wombGlow.scale.set(1, 0.55, 1.15);

  // thorax + chest plate
  const thorax = put(THREE, bob, new THREE.SphereGeometry(0.32, 12, 9), shell, 0, 1.3, 0.05);
  thorax.scale.set(0.95, 1.15, 0.9);
  box(THREE, bob, dark, 0.4, 0.4, 0.16, 0, 1.38, 0.26).rotation.x = 0.15;

  // head + twin eye clusters (headshot band)
  const head = new THREE.Group(); head.position.set(0, 1.72, 0.2); bob.add(head);
  parts.head = rest(head);
  box(THREE, head, dark, 0.28, 0.3, 0.32, 0, 0, 0);
  for (const sx of [-1, 1]) {
    put(THREE, head, new THREE.SphereGeometry(0.07, 8, 6), eyeM, sx * 0.1, 0.04, 0.15);
    put(THREE, head, new THREE.SphereGeometry(0.04, 6, 5), eyeM, sx * 0.14, 0.1, 0.12);
    put(THREE, head, new THREE.SphereGeometry(0.035, 6, 5), eyeM, sx * 0.05, 0.11, 0.14);
  }

  // crown of horns (royal silhouette)
  for (let k = -2; k <= 2; k++) {
    const len = 0.42 - Math.abs(k) * 0.09;
    const horn = put(THREE, head, new THREE.ConeGeometry(0.05, len, 8), shell, k * 0.09, 0.15 + len / 2, -0.04 - Math.abs(k) * 0.04);
    horn.rotation.z = -k * 0.28;
  }

  // four arm-scythes (raised, blades hanging)
  const shoulders = [[-0.32, 1.42, 0.12, 2.7, -2.5], [0.32, 1.42, 0.12, -2.7, -2.5], [-0.28, 1.18, 0.16, 2.5, -2.4], [0.28, 1.18, 0.16, -2.5, -2.4]];
  for (const [x, y, z, rz, brz] of shoulders) {
    const up = limb(THREE, bob, shell, 0.08, 0.45, 0.08, x, y, z);
    up.rotation.z = rz;
    limb(THREE, up, dark, 0.035, 0.55, 0.11, 0, -0.45, 0).rotation.z = brz;
    parts.scythes.push(rest(up));
  }

  // skirt of tentacles
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const tn = limb(THREE, bob, i % 2 ? shell : dark, 0.065, 0.6, 0.065, Math.cos(a) * 0.28, 1.05, 0.03 + Math.sin(a) * 0.22);
    tn.rotation.z = -Math.cos(a) * 0.3; tn.rotation.x = Math.sin(a) * 0.25;
    tn.userData.ph = a; parts.tentacles.push(rest(tn));
  }
  return { group: root, parts };
}

// ---------------------------------------------------------------------------
// BUILDERS + ANIMATE
// ---------------------------------------------------------------------------
export const BUILDERS = {
  drone: (THREE, def) => buildDrone(THREE, def),
  skitterer: (THREE, def) => buildSkitterer(THREE, def),
  warden: (THREE, def) => buildWarden(THREE, def),
  stalker: (THREE, def) => buildStalker(THREE, def),
  queen: (THREE, def) => buildQueen(THREE, def),
};

export const ANIMATE = {
  drone: (parts, group, t, moving) => {
    const w = moving ? 1 : 0.5;
    parts.bobber.position.y = Math.sin(t * 2.2) * 0.07;
    parts.bobber.rotation.z = Math.sin(t * 1.6) * 0.06;
    parts.bobber.rotation.x = moving ? 0.1 : 0.02;
    parts.ringSpin.rotation.y = t * 2.8;
    parts.feelers.forEach((f, i) => {
      f.up.rotation.x = Math.sin(t * 2.3 + i * 2.1) * 0.28 * (0.6 + 0.4 * w);
      f.up.rotation.z = Math.cos(t * 1.9 + i * 1.3) * 0.22;
      f.lo.rotation.x = Math.sin(t * 2.3 + i * 2.1 - 1.1) * 0.4;
    });
    parts.fins.forEach((f, i) => { f.rotation.z = Math.sin(t * 3.1 + i) * 0.06; });
  },

  skitterer: (parts, group, t, moving) => {
    const w = moving ? 1 : 0;
    parts.legs.forEach((l, i) => { l.rotation.x = l.userData.bx + Math.sin(t * 16 + i * 2.4) * 0.5 * w; });
    parts.scythes.forEach((a, i) => {
      a.rotation.x = a.userData.bx + Math.sin(t * 3.4 + i * 2.6) * 0.2 + Math.sin(t * 9 + i) * 0.1 * w;
    });
    const p = 1 + 0.3 * (0.5 + 0.5 * Math.sin(t * 7));
    parts.tip.scale.setScalar(p);
    parts.head.rotation.y = Math.sin(t * 5.3) * 0.12 * w + Math.sin(t * 1.3) * 0.08;
  },

  warden: (parts, group, t, moving, extras = {}) => {
    const w = moving ? 1 : 0;
    parts.legs.forEach((L, i) => {
      const ph = (i % 2) * Math.PI + (i >> 1) * 1.4;
      L.up.rotation.x = L.up.userData.bx + Math.sin(t * 5 + ph) * 0.38 * w;
      L.lo.rotation.x = L.lo.userData.bx + Math.sin(t * 5 + ph - 0.7) * 0.28 * w;
    });
    parts.head.rotation.x = Math.sin(t * 1.7) * 0.06 + Math.sin(t * 10) * 0.03 * w;
    const sp = (extras.shieldPct || 0) / 100;
    parts.emitters.forEach((e, i) => { e.scale.setScalar(0.7 + 0.5 * sp + 0.18 * Math.sin(t * 6 + i * 2.1)); });
  },

  stalker: (parts, group, t, moving) => {
    const w = moving ? 1 : 0;
    parts.legs.forEach((L, i) => {
      const ph = i * Math.PI;
      L.thigh.rotation.x = L.thigh.userData.bx + Math.sin(t * 7 + ph) * 0.6 * w;
      L.shin.rotation.x = L.shin.userData.bx + Math.sin(t * 7 + ph - 0.9) * 0.45 * w;
    });
    parts.arms.forEach((a, i) => {
      a.rotation.x = a.userData.bx + Math.sin(t * 7 + i * Math.PI + Math.PI) * 0.35 * w + Math.sin(t * 2.1 + i) * 0.06;
    });
    parts.tail.forEach((s, i) => {
      s.rotation.y = Math.sin(t * 3.1 - i * 0.9) * 0.28;
      s.rotation.x = s.userData.bx + Math.sin(t * 2.3 - i * 0.7) * 0.12;
    });
    parts.head.rotation.y = Math.sin(t * 0.9) * 0.35;
  },

  queen: (parts, group, t, moving) => {
    parts.bobber.position.y = Math.sin(t * 1.7) * 0.06;
    parts.bobber.rotation.z = Math.sin(t * 1.2) * 0.04;
    parts.tentacles.forEach((m) => {
      const ph = m.userData.ph;
      m.rotation.x = m.userData.bx + Math.sin(t * 2.6 + ph * 2) * 0.22;
      m.rotation.z = m.userData.bz + Math.cos(t * 2.2 + ph * 2) * 0.22;
    });
    parts.scythes.forEach((a, i) => {
      a.rotation.z = a.userData.bz + Math.sin(t * 1.9 + i * 1.6) * 0.1;
      a.rotation.x = Math.sin(t * 2.4 + i) * 0.1;
    });
    const th = 1 + 0.045 * Math.sin(t * 3.6);
    parts.abGroup.scale.setScalar(th);
    parts.podGlows.forEach((p, i) => { p.scale.setScalar(1 + 0.25 * (0.5 + 0.5 * Math.sin(t * 4.2 + i * 2.1))); });
    parts.wombGlow.scale.set(1 + 0.1 * Math.sin(t * 3.6), 0.55, 1.25);
    parts.head.rotation.y = Math.sin(t * 0.7) * 0.2;
  },
};
