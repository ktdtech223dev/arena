import { getMap } from 'file:///E:/NiggaGames/range/shared/maps.js';
import { buildLiveWorld } from 'file:///E:/NiggaGames/range/shared/mapsim.js';

const map = getMap('bastion');
const world = buildLiveWorld(map, { doors: {}, destroyed: new Set() }, 0);
const { aabbs, ramps } = world;

const CATCH_TOP = -19; // catch floor top y; anything at/below this is "void catch", not real play floor
const EPS = 1e-9;

function inRect(o, x, z) {
  return x > o.min.x - EPS && x < o.max.x + EPS && z > o.min.z - EPS && z < o.max.z + EPS;
}
function rampTop(r, x, z) {
  const t = r.axis === 'x' ? (x - r.min.x) / (r.max.x - r.min.x) : (z - r.min.z) / (r.max.z - r.min.z);
  const tc = Math.max(0, Math.min(1, t));
  return r.h0 + (r.h1 - r.h0) * tc;
}
// Highest top surface at (x,z) across ALL solids + ramps (incl catch floor). null if none.
function floorAt(x, z) {
  let best = null, src = null;
  for (const s of aabbs) {
    if (inRect(s, x, z)) { if (best === null || s.max.y > best) { best = s.max.y; src = s; } }
  }
  for (const r of ramps) {
    if (inRect(r, x, z)) { const t = rampTop(r, x, z); if (best === null || t > best) { best = t; src = r; } }
  }
  return best === null ? null : { y: best, src };
}
// Highest REAL floor (exclude the catch floor). null if only catch floor / nothing.
function floorReal(x, z) {
  let best = null;
  for (const s of aabbs) {
    if (s.max.y <= CATCH_TOP + 0.5) continue;
    if (inRect(s, x, z)) { if (best === null || s.max.y > best) best = s.max.y; }
  }
  for (const r of ramps) {
    if (Math.max(r.h0, r.h1) <= CATCH_TOP + 0.5) continue;
    if (inRect(r, x, z)) { const t = rampTop(r, x, z); if (best === null || t > best) best = t; }
  }
  return best;
}

const out = { spawns: [], malformed: [], duplicates: [], holes: [], bounds: null, spotChecks: {} };

// ---- bounds (union of solids) ----
let bx0 = Infinity, bx1 = -Infinity, bz0 = Infinity, bz1 = -Infinity, by0 = Infinity, by1 = -Infinity;
for (const s of aabbs) {
  bx0 = Math.min(bx0, s.min.x); bx1 = Math.max(bx1, s.max.x);
  bz0 = Math.min(bz0, s.min.z); bz1 = Math.max(bz1, s.max.z);
  by0 = Math.min(by0, s.min.y); by1 = Math.max(by1, s.max.y);
}
out.bounds = { x: [bx0, bx1], z: [bz0, bz1], y: [by0, by1] };

// ---- (4) malformed + duplicates ----
const seen = new Map();
for (let i = 0; i < aabbs.length; i++) {
  const s = aabbs[i];
  const bad = [];
  for (const ax of ['x', 'y', 'z']) {
    if (!(s.max[ax] > s.min[ax])) bad.push(`min>=max on ${ax} (${s.min[ax]}..${s.max[ax]})`);
    if ([s.min[ax], s.max[ax]].some(Number.isNaN)) bad.push(`NaN on ${ax}`);
  }
  if (bad.length) out.malformed.push({ i, box: [s.min, s.max], issues: bad });
  const key = `${s.min.x},${s.min.y},${s.min.z},${s.max.x},${s.max.y},${s.max.z}`;
  if (seen.has(key)) out.duplicates.push({ i, dupOf: seen.get(key), box: key });
  else seen.set(key, i);
}
for (const r of ramps) {
  const bad = [];
  for (const ax of ['x', 'y', 'z']) if (!(r.max[ax] > r.min[ax])) bad.push(`ramp min>=max on ${ax}`);
  if (bad.length) out.malformed.push({ ramp: true, box: [r.min, r.max], issues: bad });
}

// ---- (1) spawns ----
map.spawns.forEach((sp, i) => {
  const { x, y, z } = sp.pos;
  const head = y + 1.8;
  const fa = floorAt(x, z);
  const fr = floorReal(x, z);
  const straddlers = [];
  for (const s of aabbs) {
    if (s.max.y <= CATCH_TOP + 0.5) continue;
    // treat the floor you stand on (top ~ feet) as not-straddling
    if (s.min.x < x - EPS && x < s.max.x - EPS && s.min.z < z - EPS && z < s.max.z - EPS &&
        s.min.y < head - 0.02 && s.max.y > y + 0.02) {
      straddlers.push({ box: [s.min, s.max], surf: s.surface });
    }
  }
  const rec = { i, pos: sp.pos, floorAll: fa ? +fa.y.toFixed(2) : null, floorReal: fr === null ? null : +fr.toFixed(2), flags: [], straddlers };
  if (fr === null) rec.flags.push('spawn-no-floor(null real floor)');
  else if (fr < y - 3) rec.flags.push(`floor ${(y - fr).toFixed(1)}m below feet`);
  if (fr !== null && fr > y + 0.5) rec.flags.push(`BURIED: real floor y${fr.toFixed(2)} is ${(fr - y).toFixed(1)}m ABOVE feet`);
  if (straddlers.length) rec.flags.push(`spawn-in-geometry (${straddlers.length} solid straddles capsule)`);
  out.spawns.push(rec);
});

// ---- (2)/(3) hole scan ----
const STEP = 0.5;
const PX0 = -19, PX1 = 19, PZ0 = -35, PZ1 = 35;
// intended void: moat hazards (XZ footprints) + anything outside the walled core
const moats = (map.hazards || []).filter(h => h.type === 'water').map(h => ({ x0: h.min.x, x1: h.max.x, z0: h.min.z, z1: h.max.z }));
function inMoat(x, z) { return moats.some(m => x >= m.x0 && x <= m.x1 && z >= m.z0 && z <= m.z1); }
// core walled footprint (inside the boundary walls)
const CORE = { x0: -18, x1: 18, z0: -34, z1: 34 };
function inCore(x, z) { return x >= CORE.x0 && x <= CORE.x1 && z >= CORE.z0 && z <= CORE.z1; }

const nx = Math.round((PX1 - PX0) / STEP), nz = Math.round((PZ1 - PZ0) / STEP);
const voidGrid = []; // [ix][iz] boolean = unintended void
for (let ix = 0; ix <= nx; ix++) {
  voidGrid[ix] = [];
  for (let iz = 0; iz <= nz; iz++) {
    const x = PX0 + ix * STEP, z = PZ0 + iz * STEP;
    const fr = floorReal(x, z);
    const isVoid = (fr === null); // no real floor -> would fall to catch/void
    voidGrid[ix][iz] = isVoid && inCore(x, z) && !inMoat(x, z);
  }
}
// flood-fill cluster the unintended void cells
const visited = voidGrid.map(col => col.map(() => false));
const clusters = [];
for (let ix = 0; ix <= nx; ix++) for (let iz = 0; iz <= nz; iz++) {
  if (!voidGrid[ix][iz] || visited[ix][iz]) continue;
  const stack = [[ix, iz]]; visited[ix][iz] = true;
  const cells = [];
  while (stack.length) {
    const [cx, cz] = stack.pop(); cells.push([cx, cz]);
    for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const ax = cx + dx, az = cz + dz;
      if (ax < 0 || az < 0 || ax > nx || az > nz) continue;
      if (voidGrid[ax][az] && !visited[ax][az]) { visited[ax][az] = true; stack.push([ax, az]); }
    }
  }
  let cx0 = Infinity, cx1 = -Infinity, cz0 = Infinity, cz1 = -Infinity;
  for (const [a, b] of cells) {
    const x = PX0 + a * STEP, z = PZ0 + b * STEP;
    cx0 = Math.min(cx0, x); cx1 = Math.max(cx1, x); cz0 = Math.min(cz0, z); cz1 = Math.max(cz1, z);
  }
  clusters.push({
    n: cells.length,
    x: [cx0, cx1], z: [cz0, cz1],
    center: [+((cx0 + cx1) / 2).toFixed(2), +((cz0 + cz1) / 2).toFixed(2)],
    sizeXZ: [+(cx1 - cx0 + STEP).toFixed(2), +(cz1 - cz0 + STEP).toFixed(2)],
  });
}
clusters.sort((a, b) => b.n - a.n);
out.holes = clusters;

// ---- targeted spot checks (probe the suspicious seams directly) ----
function probe(label, x, z) {
  const fr = floorReal(x, z), fa = floorAt(x, z);
  out.spotChecks[label] = { at: [x, z], floorReal: fr === null ? null : +fr.toFixed(2), floorAll: fa ? +fa.y.toFixed(2) : null };
}
probe('keep_edge_z-3.0_x0', 0, -3.0);
probe('slot_z-2.5_x0', 0, -2.5);   // between keep(z-3) and wall(z-2)
probe('slot_z-2.5_x-10', -10, -2.5);
probe('wall_z-2.0_x0', 0, -2.0);
probe('ravine_z4_x-12', -12, 4);   // between wall(z2) and field(z6), off-center
probe('ravine_z4_x12', 12, 4);
probe('landing_z4_x0', 0, 4);
probe('field_edge_z6_x0', 0, 6);
probe('wtrench_center', -8, 14);   // west trench center (should be y-2 if open, y0 if buried)
probe('etrench_center', 8, 22);
probe('reartrench_center', 0, 26);

console.log(JSON.stringify(out, null, 2));
