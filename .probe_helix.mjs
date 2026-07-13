import { getMap } from 'file:///E:/NiggaGames/range/shared/maps.js';
import { buildLiveWorld } from 'file:///E:/NiggaGames/range/shared/mapsim.js';

const map = getMap('helix');
const world = buildLiveWorld(map, { doors: {}, destroyed: new Set() }, 0);
const { aabbs, ramps } = world;

const EPS = 1e-9;
const rampTop = (r, x, z) => {
  const t = r.axis === 'x' ? (x - r.min.x) / (r.max.x - r.min.x) : (z - r.min.z) / (r.max.z - r.min.z);
  return r.h0 + (r.h1 - r.h0) * t;
};
const inRect = (o, x, z) => x >= o.min.x - EPS && x <= o.max.x + EPS && z >= o.min.z - EPS && z <= o.max.z + EPS;

// highest top surface at (x,z), plus which source
function floorAt(x, z) {
  let best = null, src = null;
  for (const s of aabbs) {
    if (inRect(s, x, z)) { if (best === null || s.max.y > best) { best = s.max.y; src = s; } }
  }
  for (const r of ramps) {
    if (inRect(r, x, z)) { const t = rampTop(r, x, z); if (best === null || t > best) { best = t; src = r; } }
  }
  return { y: best, src };
}

// ---- bounds ----
let bx0 = Infinity, bx1 = -Infinity, bz0 = Infinity, bz1 = -Infinity, by0 = Infinity, by1 = -Infinity;
for (const s of aabbs.concat(ramps)) {
  bx0 = Math.min(bx0, s.min.x); bx1 = Math.max(bx1, s.max.x);
  bz0 = Math.min(bz0, s.min.z); bz1 = Math.max(bz1, s.max.z);
  by0 = Math.min(by0, s.min.y); by1 = Math.max(by1, s.max.y);
}

const out = { bounds: { bx0, bx1, bz0, bz1, by0, by1 }, aabbCount: aabbs.length, rampCount: ramps.length };

// ---- (1) SPAWNS ----
out.spawns = map.spawns.map((sp, i) => {
  const { x, y, z } = sp.pos;
  const f = floorAt(x, z);
  const noFloor = f.y === null || (y - f.y) > 3;
  // spawn-in-geometry: some solid straddles the spawn (strict), body from y..y+1.8
  let inGeo = null;
  for (const s of aabbs) {
    if (s.min.x < x && x < s.max.x && s.min.z < z && z < s.max.z && s.min.y < y + 1.8 && s.max.y > y + EPS) {
      inGeo = { min: s.min, max: s.max }; break;
    }
  }
  return { i, pos: sp.pos, floorY: f.y, dFeetToFloor: f.y === null ? null : +(y - f.y).toFixed(3), noFloor, inGeo };
});

// ---- (4) MALFORMED / duplicates ----
const malformed = [];
for (const s of aabbs) {
  if (!(s.min.x < s.max.x) || !(s.min.y < s.max.y) || !(s.min.z < s.max.z)) malformed.push({ kind: 'min>=max', s: { min: s.min, max: s.max } });
  for (const k of ['x', 'y', 'z']) { if (Number.isNaN(s.min[k]) || Number.isNaN(s.max[k])) malformed.push({ kind: 'NaN', s }); }
}
const seen = new Map(); const dups = [];
for (const s of aabbs) {
  const key = `${s.min.x},${s.min.y},${s.min.z},${s.max.x},${s.max.y},${s.max.z}`;
  if (seen.has(key)) dups.push(key); else seen.set(key, 1);
}
out.malformed = malformed; out.dups = dups;

// ---- (2) FLOOR COVERAGE / holes within PLAY tiers ----
// The map is an elevated figure-8 over a void (catch floor at y=-45). By design, off-deck = void.
// Interior-hole detection here is scoped to the WALKABLE tiers: sample the grid, and for each
// cell classify the highest NON-catchfloor surface. Report cells that a designer would expect to
// be deck but read as a big drop.
const step = 1.0;
let sampleN = 0, playCells = 0;
const tierLo = [], tierHi = [];
for (let x = bx0; x <= bx1; x += step) {
  for (let z = bz0; z <= bz1; z += step) {
    sampleN++;
    const f = floorAt(x, z);
    if (f.y === null) continue;
    // exclude catch floor (-45) — everything above it counts as a real surface
    if (f.y > -40) { playCells++; if (f.y < 4) tierLo.push({ x, z, y: +f.y.toFixed(2) }); else tierHi.push({ x, z, y: +f.y.toFixed(2) }); }
  }
}
out.coverage = { sampleN, playCells, loCells: tierLo.length, hiCells: tierHi.length };

// ---- RAMP USABILITY: is each ramp's climbing surface EXPOSED (not buried under a higher solid)?
// For each ramp, sample its footprint; at each point compare ramp top vs highest OTHER solid top.
// If a solid's top is >= ramp top over most of the footprint, the ramp is buried/unusable.
out.rampUsability = ramps.map((r, idx) => {
  const nx = 12, nz = 12; let exposed = 0, buried = 0, total = 0;
  let minExposedX = Infinity, maxExposedX = -Infinity, minExposedZ = Infinity, maxExposedZ = -Infinity;
  for (let i = 0; i <= nx; i++) {
    for (let j = 0; j <= nz; j++) {
      const x = r.min.x + (r.max.x - r.min.x) * i / nx;
      const z = r.min.z + (r.max.z - r.min.z) * j / nz;
      const t = rampTop(r, x, z);
      let solidTop = -Infinity;
      for (const s of aabbs) { if (inRect(s, x, z) && s.max.y > -40) solidTop = Math.max(solidTop, s.max.y); }
      total++;
      // ramp usable at this point if no solid rises above the ramp surface (allow tiny tol)
      if (solidTop > t + 0.05) { buried++; }
      else { exposed++; minExposedX = Math.min(minExposedX, x); maxExposedX = Math.max(maxExposedX, x); minExposedZ = Math.min(minExposedZ, z); maxExposedZ = Math.max(maxExposedZ, z); }
    }
  }
  const exposedWidth = maxExposedX === -Infinity ? 0 : (r.axis === 'x' ? (maxExposedZ - minExposedZ) : (maxExposedX - minExposedX));
  return {
    idx, axis: r.axis, rect: { min: r.min, max: r.max }, h0: r.h0, h1: r.h1,
    exposedFrac: +(exposed / total).toFixed(2),
    exposedLateralWidth: exposedWidth === 0 ? 0 : +exposedWidth.toFixed(2),
    verdict: exposed / total < 0.35 ? 'MOSTLY-BURIED' : (exposedWidth < 0.7 && exposedWidth > 0 ? 'TOO-NARROW' : 'ok'),
  };
});

// ---- RAMP END-TO-DECK continuity: at each ramp end, is there a deck surface at the ramp height to step onto?
out.rampEnds = [];
for (const [idx, r] of ramps.entries()) {
  for (const end of ['lo', 'hi']) {
    // pick the end where ramp height is h0 (min side) or h1 (max side)
    const atMin = end === 'lo';
    const ex = r.axis === 'x' ? (atMin ? r.min.x : r.max.x) : (r.min.x + r.max.x) / 2;
    const ez = r.axis === 'z' ? (atMin ? r.min.z : r.max.z) : (r.min.z + r.max.z) / 2;
    const h = atMin ? r.h0 : r.h1;
    // step just beyond the ramp end along its axis, look for a solid deck within 0.4m height
    const dx = r.axis === 'x' ? (atMin ? -0.6 : 0.6) : 0;
    const dz = r.axis === 'z' ? (atMin ? -0.6 : 0.6) : 0;
    const px = ex + dx, pz = ez + dz;
    let bestDeck = null;
    for (const s of aabbs) { if (inRect(s, px, pz) && s.max.y > -40 && Math.abs(s.max.y - h) < 0.4) { if (bestDeck === null || Math.abs(s.max.y - h) < Math.abs(bestDeck - h)) bestDeck = s.max.y; } }
    out.rampEnds.push({ ramp: idx, end, height: h, atXZ: { x: +px.toFixed(2), z: +pz.toFixed(2) }, deckFound: bestDeck !== null, deckY: bestDeck });
  }
}

// ---- Deck edge continuity spot check: sample the low & high ring centerlines to confirm no gap in the walkable ring
function ringProbe(cx, cz, y, inn, out2) {
  const rMid = (inn + out2) / 2; // centerline radius through the deck bars (approx; square ring)
  const gaps = [];
  const M = 72;
  for (let i = 0; i < M; i++) {
    const a = (i / M) * Math.PI * 2;
    // walk the SQUARE ring: project onto the nearest bar. Use max(|dx|,|dz|)=rMid boundary.
    // Sample along a square perimeter at radius rMid.
    let x, z;
    const c = Math.cos(a), s = Math.sin(a);
    const scale = rMid / Math.max(Math.abs(c), Math.abs(s));
    x = cx + c * scale; z = cz + s * scale;
    const f = floorAt(x, z);
    if (f.y === null || Math.abs(f.y - y) > 0.5) gaps.push({ a: +(a * 180 / Math.PI).toFixed(0), x: +x.toFixed(2), z: +z.toFixed(2), floorY: f.y });
  }
  return gaps;
}
out.lowRingGaps = ringProbe(-13, 0, 1, 10, 13.4);
out.highRingGaps = ringProbe(13, 0, 7, 10, 13.4);

console.log(JSON.stringify(out, null, 1));
