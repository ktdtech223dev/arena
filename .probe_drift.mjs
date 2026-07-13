import { getMap } from 'file:///E:/NiggaGames/range/shared/maps.js';
import { buildLiveWorld } from 'file:///E:/NiggaGames/range/shared/mapsim.js';

const map = getMap('drift');
const world = buildLiveWorld(map, { doors: {}, destroyed: new Set() }, 0);
const { aabbs, ramps } = world;

const STAND = 1.8, RAD = 0.35, VOID_TOP = -6; // void hazard top; walkable surfaces are above this

function inRect(p, x, z) {
  return x >= p.min.x && x <= p.max.x && z >= p.min.z && z <= p.max.z;
}
// highest top surface at (x,z). opts.aboveVoid => ignore surfaces at/below VOID_TOP (catch floor etc.)
function floorAt(x, z, opts = {}) {
  let best = null, src = null;
  for (const s of aabbs) {
    if (!inRect(s, x, z)) continue;
    const top = s.max.y;
    if (opts.aboveVoid && top <= VOID_TOP) continue;
    if (best === null || top > best) { best = top; src = s; }
  }
  for (const r of ramps) {
    if (!inRect(r, x, z)) continue;
    const t = r.axis === 'x' ? (x - r.min.x) / (r.max.x - r.min.x) : (z - r.min.z) / (r.max.z - r.min.z);
    const top = r.h0 + (r.h1 - r.h0) * t;
    if (opts.aboveVoid && top <= VOID_TOP) continue;
    if (best === null || top > best) { best = top; src = { ramp: true, r }; }
  }
  return best === null ? null : { y: best, src };
}

const out = { spawns: [], holes: [], malformed: [], perimeter: {}, rampFootprintSpawns: [], overlaps: [], stats: {} };

// ---- bounds (union of all solids, excluding catch floor for the play bounds) ----
let mnx = Infinity, mnz = Infinity, mxx = -Infinity, mxz = -Infinity;
let pmnx = Infinity, pmnz = Infinity, pmxx = -Infinity, pmxz = -Infinity; // play (above void)
for (const s of aabbs) {
  mnx = Math.min(mnx, s.min.x); mnz = Math.min(mnz, s.min.z);
  mxx = Math.max(mxx, s.max.x); mxz = Math.max(mxz, s.max.z);
  if (s.max.y > VOID_TOP) {
    pmnx = Math.min(pmnx, s.min.x); pmnz = Math.min(pmnz, s.min.z);
    pmxx = Math.max(pmxx, s.max.x); pmxz = Math.max(pmxz, s.max.z);
  }
}
out.stats.fullBounds = { minx: mnx, minz: mnz, maxx: mxx, maxz: mxz };
out.stats.playBounds = { minx: pmnx, minz: pmnz, maxx: pmxx, maxz: pmxz };
out.stats.numSolids = aabbs.length;
out.stats.numRamps = ramps.length;

// ---- 1) SPAWNS ----
for (let i = 0; i < map.spawns.length; i++) {
  const sp = map.spawns[i].pos;
  const f = floorAt(sp.x, sp.z);                 // includes catch floor
  const fPlay = floorAt(sp.x, sp.z, { aboveVoid: true }); // walkable surface only
  const rec = { i, pos: sp, floor: f ? +f.y.toFixed(3) : null, floorPlay: fPlay ? +fPlay.y.toFixed(3) : null, flags: [] };
  const feet = sp.y;
  if (fPlay === null) rec.flags.push('spawn-no-floor(no walkable surface under spawn; only void/catch)');
  else if (fPlay.y < feet - 3) rec.flags.push(`spawn-no-floor(floor ${fPlay.y.toFixed(2)} is ${(feet - fPlay.y).toFixed(2)}m below feet ${feet})`);
  // straddle: solids whose box straddles the spawn column (feet..head)
  const embeds = [];
  for (const s of aabbs) {
    if (s.min.x < sp.x && sp.x < s.max.x && s.min.z < sp.z && sp.z < s.max.z && s.min.y < feet + STAND && s.max.y > feet) {
      // ignore the floor slab the player rests ON (its top ~= feet, occupies below feet)
      const isRestFloor = Math.abs(s.max.y - feet) < 0.06 && s.max.y <= feet + 0.06;
      if (!isRestFloor) embeds.push({ min: s.min, max: s.max, topY: s.max.y, wallrun: !!s.wallrun });
    }
  }
  if (embeds.length) { rec.flags.push('spawn-in-geometry'); rec.embeddedIn = embeds; }
  // ramp footprint (movement-core snaps player UP unconditionally within a ramp XZ footprint)
  for (const r of ramps) {
    if (inRect(r, sp.x, sp.z)) {
      const t = r.axis === 'x' ? (sp.x - r.min.x) / (r.max.x - r.min.x) : (sp.z - r.min.z) / (r.max.z - r.min.z);
      const top = r.h0 + (r.h1 - r.h0) * t;
      rec.flags.push(`in-ramp-footprint(rampTop=${top.toFixed(2)} vs feet ${feet})`);
      out.rampFootprintSpawns.push({ i, top: +top.toFixed(2), feet });
    }
  }
  out.spawns.push(rec);
}

// ---- 2) FLOOR COVERAGE / HOLES ----
// This map is islands-over-void by DESIGN. Compute walkable footprint (surfaces above void).
// Report the fraction of the play-bounds grid that is walkable, and any *isolated void pockets*
// fully enclosed by walkable cells (which would be a real hole, not the intended perimeter void).
const STEP = 1.5;
let total = 0, walk = 0;
const grid = {}; // key "gx,gz" -> walkable bool
const gxN = Math.ceil((pmxx - pmnx) / STEP), gzN = Math.ceil((pmxz - pmnz) / STEP);
for (let gx = 0; gx <= gxN; gx++) for (let gz = 0; gz <= gzN; gz++) {
  const x = pmnx + gx * STEP, z = pmnz + gz * STEP;
  const f = floorAt(x, z, { aboveVoid: true });
  const w = f !== null;
  grid[gx + ',' + gz] = w;
  total++; if (w) walk++;
}
out.stats.gridSamples = total;
out.stats.walkableSamples = walk;
out.stats.walkableFrac = +(walk / total).toFixed(3);
out.stats.note = 'Drift is islands-over-void BY DESIGN: most of the footprint is intended void (perimeter + inter-island gaps). Low walkable frac is expected.';

// Enclosed void pockets: void cell whose flood-fill (4-neigh, void-only) does NOT reach the grid border.
const seen = {};
function keyOf(gx, gz) { return gx + ',' + gz; }
let enclosedPockets = 0; const pocketCenters = [];
for (let gx = 0; gx <= gxN; gx++) for (let gz = 0; gz <= gzN; gz++) {
  if (grid[keyOf(gx, gz)]) continue;      // walkable, skip
  if (seen[keyOf(gx, gz)]) continue;
  // BFS this void component
  const stack = [[gx, gz]]; const cells = []; let touchesBorder = false;
  seen[keyOf(gx, gz)] = true;
  while (stack.length) {
    const [cx, cz] = stack.pop(); cells.push([cx, cz]);
    if (cx === 0 || cz === 0 || cx === gxN || cz === gzN) touchesBorder = true;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, nz = cz + dz;
      if (nx < 0 || nz < 0 || nx > gxN || nz > gzN) continue;
      const k = keyOf(nx, nz);
      if (seen[k] || grid[k]) continue;
      seen[k] = true; stack.push([nx, nz]);
    }
  }
  if (!touchesBorder) {
    enclosedPockets++;
    let sx = 0, sz = 0; for (const [cx, cz] of cells) { sx += pmnx + cx * STEP; sz += pmnz + cz * STEP; }
    pocketCenters.push({ center: { x: +(sx / cells.length).toFixed(1), z: +(sz / cells.length).toFixed(1) }, cells: cells.length, approxArea_m2: +(cells.length * STEP * STEP).toFixed(1) });
  }
}
out.holes = pocketCenters;
out.stats.enclosedVoidPockets = enclosedPockets;

// ---- 3) PERIMETER / walls ----
// Is the play area bounded by walls/rails, or intended-island-with-void? Check hazards.
out.perimeter.hazards = (map.hazards || []).map(h => ({ id: h.id, type: h.type, min: h.min, max: h.max, dps: h.dps }));
out.perimeter.hasVoidHazard = (map.hazards || []).some(h => h.type === 'void');
out.perimeter.catchFloor = aabbs.filter(s => s.max.y <= VOID_TOP).map(s => ({ min: s.min, max: s.max }));
out.perimeter.note = 'Intended island-with-void: no perimeter walls expected. Falling off = void hazard -> death -> respawn. Verify a catch floor exists below.';

// ---- 4) MALFORMED ----
function bad(v) { return v === undefined || v === null || Number.isNaN(v); }
const seenBoxes = new Set();
for (const s of aabbs) {
  const issues = [];
  for (const ax of ['x', 'y', 'z']) {
    if (bad(s.min[ax]) || bad(s.max[ax])) issues.push(`NaN/undef ${ax}`);
    if (s.min[ax] >= s.max[ax]) issues.push(`min>=max on ${ax} (${s.min[ax]}>=${s.max[ax]})`);
  }
  const key = JSON.stringify([s.min, s.max]);
  if (seenBoxes.has(key)) issues.push('exact duplicate');
  seenBoxes.add(key);
  if (issues.length) out.malformed.push({ min: s.min, max: s.max, issues });
}
for (const r of ramps) {
  const issues = [];
  for (const ax of ['x', 'z']) if (r.min[ax] >= r.max[ax]) issues.push(`ramp min>=max on ${ax}`);
  if (bad(r.h0) || bad(r.h1)) issues.push('ramp NaN h');
  if (issues.length) out.malformed.push({ ramp: true, min: r.min, max: r.max, issues });
}

// ---- EXTRA: barrels/destructibles sitting on a spawn (dynamic pushers) ----
for (let i = 0; i < map.spawns.length; i++) {
  const sp = map.spawns[i].pos;
  for (const b of map.barrels || []) {
    const d = Math.hypot(b.pos.x - sp.x, b.pos.z - sp.z);
    if (d < 1.0 && Math.abs(b.pos.y - sp.y) < 2) out.overlaps.push({ spawn: i, kind: 'barrel', id: b.id, dist: +d.toFixed(2), barrelPos: b.pos });
  }
}

console.log(JSON.stringify(out, null, 2));
