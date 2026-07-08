// ARENA — src/world/blockmesh.js
// SHARED per-block mesh builder for CUSTOM maps. Turns ONE block descriptor
// { type, x,y,z, sx,sy,sz, ry, color?, wallrun?, emissive? } into a single
// THREE.Object3D, transformed / rotated / sized / coloured to match the collider
// that shared/custommap.js derives for it. Used by BOTH the play scene
// (CustomEnv) and the first-person editor, so it takes THREE as a parameter and
// stays dependency-light (no imports, no module-level THREE). Never throws on a
// malformed block — falls back to a plain box.
//
// Materials are cached in a caller-owned `materialCache` (a Map) keyed by
// color|emissive|emissiveOnly, so a whole map of same-coloured blocks shares one
// material. Solids use MeshStandardMaterial (lit); pure-cosmetic neon uses a
// MeshBasicMaterial (additive, unlit) so it reads as a light strip.
//
// Shape per type (mirrors BLOCK_TYPES in shared/custommap.js):
//   cube/wall/floor/platform/beam/angled/prop → Box
//   pillar (round)                            → Cylinder (Y axis)
//   arch                                      → two legs + a top lintel
//   ramp/stairs/slide                         → a sloped box (top face = ramp)
//   runwall                                   → box + a bright cyan wall-run stripe
//   jumppad                                   → low pad + an upward-arrow glow
//   neon                                      → thin emissive strip (basic/additive)

import { BLOCK_TYPES } from '../../shared/custommap.js';

export const BLOCK_MESH_VERSION = 1;

// shared wall-run / slide accent (the cyan movement language across the game)
const RUN_CYAN = 0x18b6d8;

// ---------------------------------------------------------------------------
// material cache — key by color + emissive + flags so identical blocks share.
// `materialCache` is a Map the caller owns (one per env). Missing → build.
// ---------------------------------------------------------------------------
function litMat(THREE, cache, color, emissive, emissiveI, metal, rough) {
  const key = `lit:${color}|${emissive || 0}|${emissiveI || 0}|${metal || 0}|${rough || 0}`;
  let m = cache.get(key);
  if (m) return m;
  m = new THREE.MeshStandardMaterial({
    color: (color != null ? color : 0x8794a4),
    roughness: rough != null ? rough : 0.82,
    metalness: metal != null ? metal : 0.12,
  });
  if (emissive) { m.emissive = new THREE.Color(emissive); m.emissiveIntensity = emissiveI != null ? emissiveI : 0.5; }
  cache.set(key, m);
  return m;
}

function basicMat(THREE, cache, color, additive) {
  const key = `basic:${color}|${additive ? 1 : 0}`;
  let m = cache.get(key);
  if (m) return m;
  m = new THREE.MeshBasicMaterial({ color: (color != null ? color : 0xffffff), toneMapped: false });
  if (additive) { m.transparent = true; m.blending = THREE.AdditiveBlending; m.depthWrite = false; m.opacity = 0.95; }
  cache.set(key, m);
  return m;
}

// resolve a block's size / color / emissive with safe fallbacks from BLOCK_TYPES.
function blockDefaults(block) {
  const def = BLOCK_TYPES[block?.type] || null;
  const dsize = def?.size || [2, 2, 2];
  const sx = safe(block?.sx, dsize[0]);
  const sy = safe(block?.sy, dsize[1]);
  const sz = safe(block?.sz, dsize[2]);
  const color = (typeof block?.color === 'number') ? block.color : (def?.color != null ? def.color : 0x8794a4);
  // emissive: explicit on block, else the type's emissive default (slide/runwall/etc.)
  let emissive = (typeof block?.emissive === 'number') ? block.emissive : (def?.emissive != null ? def.emissive : 0);
  return { def, sx, sy, sz, color, emissive };
}

function safe(v, d) { return (typeof v === 'number' && isFinite(v) && v !== 0) ? v : d; }

// ---------------------------------------------------------------------------
// buildBlockMesh — the public builder. Returns a THREE.Object3D positioned at
// block.x/y/z and yaw-rotated block.ry. `materialCache` is a Map (caller owns).
// ---------------------------------------------------------------------------
export function buildBlockMesh(THREE, block, materialCache) {
  const cache = materialCache instanceof Map ? materialCache : new Map();
  const b = block || {};
  const { def, sx, sy, sz, color, emissive } = blockDefaults(b);
  const type = b.type || 'cube';

  let obj;
  try {
    obj = buildShape(THREE, cache, type, def, sx, sy, sz, color, emissive, b);
  } catch {
    obj = null;
  }
  if (!obj) {
    // never throw — fall back to a plain box so a bad block still renders.
    obj = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), litMat(THREE, cache, color, emissive, 0.5));
    obj.castShadow = true; obj.receiveShadow = true;
  }

  obj.position.set(
    (typeof b.x === 'number' && isFinite(b.x)) ? b.x : 0,
    (typeof b.y === 'number' && isFinite(b.y)) ? b.y : 0,
    (typeof b.z === 'number' && isFinite(b.z)) ? b.z : 0,
  );
  obj.rotation.y = (typeof b.ry === 'number' && isFinite(b.ry)) ? b.ry : 0;
  return obj;
}

// dispatch to the per-type shape; returns an Object3D whose LOCAL origin is the
// block center (so the caller's position/rotation apply about the center).
function buildShape(THREE, cache, type, def, sx, sy, sz, color, emissive, b) {
  const wallrun = (b.wallrun != null) ? !!b.wallrun : !!def?.wallrun;

  // --- ROUND pillar -> cylinder about Y ---
  if (def?.round || type === 'pillar') {
    const r = Math.min(sx, sz) / 2;
    const geo = new THREE.CylinderGeometry(r, r, sy, 16);
    const m = new THREE.Mesh(geo, litMat(THREE, cache, color, emissive, 0.4));
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }

  // --- ARCH -> two legs + a top lintel (approximate; matches the aabb footprint) ---
  if (def?.arch || type === 'arch') {
    return buildArch(THREE, cache, sx, sy, sz, color, emissive);
  }

  // --- RAMP / STAIRS / SLIDE -> a sloped box (top face becomes the ramp surface) ---
  if (def?.cat === 'ramp' || type === 'ramp' || type === 'stairs' || type === 'slide') {
    return buildRamp(THREE, cache, type, def, sx, sy, sz, color, emissive, b);
  }

  // --- RUNWALL -> box + a bright cyan wall-run stripe down each face ---
  if (wallrun || type === 'runwall') {
    return buildRunwall(THREE, cache, sx, sy, sz, color);
  }

  // --- JUMPPAD -> a low pad + an upward-arrow emissive glow ---
  if (def?.pad || type === 'jumppad') {
    return buildJumppad(THREE, cache, sx, sy, sz, color, emissive || 0xb15bff);
  }

  // --- NEON -> a thin emissive strip (basic, additive, unlit) ---
  if (def?.emissiveOnly || type === 'neon') {
    const geo = new THREE.BoxGeometry(sx, sy, sz);
    const m = new THREE.Mesh(geo, basicMat(THREE, cache, emissive || color || RUN_CYAN, true));
    return m;
  }

  // --- default BOX (cube/wall/floor/platform/beam/angled/prop) ---
  const geo = new THREE.BoxGeometry(sx, sy, sz);
  const m = new THREE.Mesh(geo, litMat(THREE, cache, color, emissive, emissive ? 0.4 : 0));
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

// arch: two vertical legs at ±(sx/2) and a horizontal top lintel spanning them.
function buildArch(THREE, cache, sx, sy, sz, color, emissive) {
  const root = new THREE.Group();
  const mat = litMat(THREE, cache, color, emissive, 0);
  const legW = Math.min(sx * 0.28, 1.0);
  const legH = sy * 0.72;
  const topH = sy - legH;
  const legGeo = new THREE.BoxGeometry(legW, legH, sz);
  const lz = 0;
  const l1 = new THREE.Mesh(legGeo, mat); l1.position.set(-(sx / 2 - legW / 2), -(sy / 2) + legH / 2, lz);
  const l2 = new THREE.Mesh(legGeo, mat); l2.position.set((sx / 2 - legW / 2), -(sy / 2) + legH / 2, lz);
  const topGeo = new THREE.BoxGeometry(sx, topH, sz);
  const top = new THREE.Mesh(topGeo, mat); top.position.set(0, (sy / 2) - topH / 2, lz);
  for (const m of [l1, l2, top]) { m.castShadow = true; m.receiveShadow = true; root.add(m); }
  return root;
}

// ramp: a thin slab tilted so its TOP face rises along the block's longer
// horizontal axis. The collider (shared/custommap) rises along the longer of
// x/z; slide/emissive ramps get a cyan glow + edge strip.
function buildRamp(THREE, cache, type, def, sx, sy, sz, color, emissive, b) {
  const root = new THREE.Group();
  const slideish = !!(def?.slide) || type === 'slide' || emissive;
  const emi = slideish ? (emissive || RUN_CYAN) : 0;
  const mat = litMat(THREE, cache, color, emi, emi ? 0.55 : 0, 0.2, 0.7);
  // rise along the longer horizontal axis (matches customToMapData axis pick)
  const axisZ = sz >= sx;
  const run = axisZ ? sz : sx;
  const rise = sy;
  const ang = Math.atan2(rise, run);
  const hyp = Math.hypot(run, rise);
  const thick = 0.3;
  const wid = axisZ ? sx : sz;
  const geo = axisZ ? new THREE.BoxGeometry(wid, thick, hyp) : new THREE.BoxGeometry(hyp, thick, wid);
  const deck = new THREE.Mesh(geo, mat);
  deck.castShadow = true; deck.receiveShadow = true;
  const flip = !!b.rampFlip;
  if (axisZ) deck.rotation.x = (flip ? 1 : -1) * ang;
  else deck.rotation.z = (flip ? -1 : 1) * ang;
  root.add(deck);
  // stairs: add a couple of step lips so it reads as stairs (cosmetic only)
  if (def?.steps || type === 'stairs') {
    const stepMat = litMat(THREE, cache, color, 0, 0, 0.2, 0.8);
    const n = 4;
    for (let i = 0; i < n; i++) {
      const f = (i + 0.5) / n;
      const along = (f - 0.5) * run;
      const y = (f - 0.5) * rise;
      const sg = axisZ ? new THREE.BoxGeometry(wid, 0.12, run / n * 0.9) : new THREE.BoxGeometry(run / n * 0.9, 0.12, wid);
      const st = new THREE.Mesh(sg, stepMat); st.castShadow = true; st.receiveShadow = true;
      if (axisZ) st.position.set(0, y + 0.16, along); else st.position.set(along, y + 0.16, 0);
      root.add(st);
    }
  }
  // slide/emissive ramp: bright edge strip along the slope
  if (slideish) {
    const stripMat = basicMat(THREE, cache, emissive || RUN_CYAN, true);
    const sg = axisZ ? new THREE.BoxGeometry(0.12, 0.06, hyp) : new THREE.BoxGeometry(hyp, 0.06, 0.12);
    const strip = new THREE.Mesh(sg, stripMat);
    strip.rotation.copy(deck.rotation);
    strip.position.set(axisZ ? wid / 2 - 0.1 : 0, 0.2, axisZ ? 0 : 0);
    if (!axisZ) strip.position.z = wid / 2 - 0.1;
    root.add(strip);
  }
  return root;
}

// runwall: a thin tall box + a bright cyan emissive stripe on the two big faces
// (the shared wall-run language). Body dark, stripe glowing.
function buildRunwall(THREE, cache, sx, sy, sz, color) {
  const root = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), litMat(THREE, cache, color || 0x1c3a44, RUN_CYAN, 0.35, 0.4, 0.5));
  body.castShadow = true; body.receiveShadow = true;
  root.add(body);
  // stripe runs along the LONG horizontal axis on the thin faces
  const thinX = sx <= sz;
  const stripMat = basicMat(THREE, cache, RUN_CYAN, true);
  const long = thinX ? sz : sx;
  const sg = thinX ? new THREE.BoxGeometry(0.05, sy * 0.5, long * 0.92) : new THREE.BoxGeometry(long * 0.92, sy * 0.5, 0.05);
  for (const s of [-1, 1]) {
    const st = new THREE.Mesh(sg, stripMat);
    if (thinX) st.position.set(s * (sx / 2 + 0.01), 0, 0);
    else st.position.set(0, 0, s * (sz / 2 + 0.01));
    root.add(st);
  }
  return root;
}

// jumppad: a low pad with an upward-arrow emissive glow on top.
function buildJumppad(THREE, cache, sx, sy, sz, color, emissive) {
  const root = new THREE.Group();
  const pad = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), litMat(THREE, cache, color || 0x2a1a4a, emissive, 0.5, 0.3, 0.6));
  pad.castShadow = true; pad.receiveShadow = true;
  root.add(pad);
  // upward arrow: two angled bars forming a chevron, glowing, just above the pad
  const glow = basicMat(THREE, cache, emissive, true);
  const barLen = Math.min(sx, sz) * 0.5;
  const bl = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.04, barLen), glow);
  const br = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.04, barLen), glow);
  bl.position.set(-barLen * 0.28, sy / 2 + 0.03, 0); bl.rotation.y = Math.PI / 4;
  br.position.set(barLen * 0.28, sy / 2 + 0.03, 0); br.rotation.y = -Math.PI / 4;
  root.add(bl); root.add(br);
  return root;
}

// ---------------------------------------------------------------------------
// blockAabbHelper — a wireframe box matching the block's world AABB footprint,
// for the editor's selection highlight. Positioned + yaw-rotated like the block.
// ---------------------------------------------------------------------------
export function blockAabbHelper(THREE, block) {
  const b = block || {};
  const { sx, sy, sz } = blockDefaults(b);
  const geo = new THREE.BoxGeometry(sx, sy, sz);
  const edges = new THREE.EdgesGeometry(geo);
  const mat = new THREE.LineBasicMaterial({ color: 0x7df9ff, transparent: true, opacity: 0.9, depthTest: false });
  const wire = new THREE.LineSegments(edges, mat);
  geo.dispose();
  wire.position.set(typeof b.x === 'number' ? b.x : 0, typeof b.y === 'number' ? b.y : 0, typeof b.z === 'number' ? b.z : 0);
  wire.rotation.y = (typeof b.ry === 'number' && isFinite(b.ry)) ? b.ry : 0;
  wire.renderOrder = 999;
  return wire;
}
