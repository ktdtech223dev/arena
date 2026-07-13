import { getMap } from 'file:///E:/NiggaGames/range/shared/maps.js';
import { buildLiveWorld } from 'file:///E:/NiggaGames/range/shared/mapsim.js';

const RADIUS = 0.35, STAND = 1.8;
const map = getMap('warren');
const world = buildLiveWorld(map, { doors: {}, destroyed: new Set() }, 0);
const solids = world.aabbs;   // [{min,max,...}]
const ramps = world.ramps;    // [{min,max,axis,h0,h1}]

const CEIL_TOP = 4.7; // surfaces above this are ceiling/structure, not a walkable floor

// rect-contains test with tiny epsilon
const inRect = (x, z, mnx, mxx, mnz, mxz, e = 1e-9) =>
  x >= mnx - e && x <= mxx + e && z >= mnz - e && z <= mxz + e;

function rampTop(r, x, z) {
  if (!inRect(x, z, r.min.x, r.max.x, r.min.z, r.max.z)) return null;
  const t = r.axis === 'x'
    ? (x - r.min.x) / (r.max.x - r.min.x)
    : (z - r.min.z) / (r.max.z - r.min.z);
  const tc = Math.max(0, Math.min(1, t));
  return r.h0 + (r.h1 - r.h0) * tc;
}

// highest top surface at (x,z), optionally capped to <= cap (to ignore ceiling)
function floorAt(x, z, cap = Infinity) {
  let best = null;
  for (const s of solids) {
    if (!inRect(x, z, s.min.x, s.max.x, s.min.z, s.max.z)) continue;
    const top = s.max.y;
    if (top > cap) continue;
    if (best === null || top > best) best = top;
  }
  for (const r of ramps) {
    const top = rampTop(r, x, z);
    if (top === null) continue;
    if (top > cap) continue;
    if (best === null || top > best) best = top;
  }
  return best;
}

// ---------- footprint bounds (exclude catch floor y<-30) ----------
let xmn = Infinity, xmx = -Infinity, zmn = Infinity, zmx = -Infinity;
for (const s of solids) {
  if (s.max.y < -30) continue; // catch floor backstop
  xmn = Math.min(xmn, s.min.x); xmx = Math.max(xmx, s.max.x);
  zmn = Math.min(zmn, s.min.z); zmx = Math.max(zmx, s.max.z);
}
const bounds = { xmn, xmx, zmn, zmx };

// ---------- (1) SPAWNS ----------
const spawnIssues = [];
for (let i = 0; i < map.spawns.length; i++) {
  const sp = map.spawns[i].pos;
  const f = floorAt(sp.x, sp.z, CEIL_TOP);
  let flag = null;
  if (f === null) flag = 'spawn-no-floor:null';
  else if (f < sp.y - 3) flag = `spawn-no-floor:drop ${(sp.y - f).toFixed(2)}m (floor ${f.toFixed(2)})`;
  // in-geometry: solid straddles the spawn point vertically over the capsule
  const straddlers = [];
  for (const s of solids) {
    if (s.max.y < -30) continue;
    if (sp.x > s.min.x && sp.x < s.max.x && sp.z > s.min.z && sp.z < s.max.z &&
        s.min.y < sp.y + STAND && s.max.y > sp.y + 1e-6) {
      straddlers.push({ min: s.min, max: s.max });
    }
  }
  spawnIssues.push({ i, pos: sp, floor: f, flag, straddlers, straddleCount: straddlers.length });
}

// ---------- (2) FLOOR COVERAGE / HOLES ----------
const step = 1.0;
const holes = [];
const xs = [], zs = [];
for (let x = Math.ceil(bounds.xmn); x <= Math.floor(bounds.xmx); x += step) xs.push(x);
for (let z = Math.ceil(bounds.zmn); z <= Math.floor(bounds.zmx); z += step) zs.push(z);
let sampleCount = 0;
for (const x of xs) for (const z of zs) {
  // stay inside the shell interior
  if (x < -20 || x > 20 || z < -20 || z > 20) continue;
  sampleCount++;
  const f = floorAt(x, z, CEIL_TOP);
  // hole = no walkable surface below vent level, OR only the catch floor far below
  if (f === null || f <= -5) holes.push({ x, z, f });
}
// cluster holes (grid adjacency within 1.6m)
function clusterPts(pts) {
  const clusters = [];
  const used = new Set();
  for (let i = 0; i < pts.length; i++) {
    if (used.has(i)) continue;
    const stack = [i]; used.add(i);
    const group = [];
    while (stack.length) {
      const k = stack.pop(); group.push(pts[k]);
      for (let j = 0; j < pts.length; j++) {
        if (used.has(j)) continue;
        if (Math.abs(pts[j].x - pts[k].x) <= 1.6 && Math.abs(pts[j].z - pts[k].z) <= 1.6) {
          used.add(j); stack.push(j);
        }
      }
    }
    const gx = group.map(p => p.x), gz = group.map(p => p.z);
    clusters.push({
      n: group.length,
      cx: (Math.min(...gx) + Math.max(...gx)) / 2,
      cz: (Math.min(...gz) + Math.max(...gz)) / 2,
      sizeX: Math.max(...gx) - Math.min(...gx),
      sizeZ: Math.max(...gz) - Math.min(...gz),
    });
  }
  return clusters;
}
const holeClusters = clusterPts(holes);

// ---------- (3) MALFORMED ----------
const malformed = [];
const seen = new Map();
for (let idx = 0; idx < solids.length; idx++) {
  const s = solids[idx];
  const bad = [];
  for (const ax of ['x', 'y', 'z']) {
    if (!(s.max[ax] > s.min[ax])) bad.push(`${ax}: min ${s.min[ax]} >= max ${s.max[ax]}`);
    if ([s.min[ax], s.max[ax]].some(v => Number.isNaN(v))) bad.push(`${ax}: NaN`);
  }
  if (bad.length) malformed.push({ idx, min: s.min, max: s.max, bad });
  const key = JSON.stringify([s.min, s.max]);
  if (seen.has(key)) malformed.push({ idx, dupOf: seen.get(key), min: s.min, max: s.max, bad: ['duplicate'] });
  else seen.set(key, idx);
}

// ---------- (4) HEADROOM under the shell ceiling ----------
// ceiling underside = min.y of the big ceiling slab
let ceilUnder = null;
for (const s of solids) {
  if (s.min.y >= 4.9 && (s.max.x - s.min.x) > 30 && (s.max.z - s.min.z) > 30) ceilUnder = s.min.y;
}
// walkable deck tops within interior (exclude floor at 0, sump, walls, ceiling)
const deckTops = new Set();
for (const s of solids) {
  const top = s.max.y;
  if (top > 3.0 && top < 4.7 && (s.max.x - s.min.x) * (s.max.z - s.min.z) > 1) deckTops.add(+top.toFixed(2));
}
const headroom = ceilUnder !== null
  ? [...deckTops].map(t => ({ deckTop: t, clearance: +(ceilUnder - t).toFixed(2) }))
  : [];

// ---------- REPORT ----------
console.log(JSON.stringify({
  bounds,
  nSolids: solids.length, nRamps: ramps.length,
  sampleCount,
  spawns: spawnIssues,
  holeCount: holes.length,
  holeClusters,
  malformed,
  ceilUnder,
  headroom,
}, null, 2));
