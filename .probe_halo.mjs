import { getMap } from 'file:///E:/NiggaGames/range/shared/maps.js';
import { buildLiveWorld } from 'file:///E:/NiggaGames/range/shared/mapsim.js';

const map = getMap('halo');
const world = buildLiveWorld(map, { doors: {}, destroyed: new Set() }, 0);
const R = 0.35, STAND = 1.8;

const solids = world.aabbs;
const ramps = world.ramps;

// floorAt: highest top surface across solids + ramps whose XZ rect contains (x,z)
function floorAt(x, z) {
  let best = null, src = null;
  for (const b of solids) {
    if (x >= b.min.x && x <= b.max.x && z >= b.min.z && z <= b.max.z) {
      if (best === null || b.max.y > best) { best = b.max.y; src = 'solid'; }
    }
  }
  for (const rp of ramps) {
    if (x >= rp.min.x && x <= rp.max.x && z >= rp.min.z && z <= rp.max.z) {
      const t = rp.axis === 'x' ? (x - rp.min.x) / (rp.max.x - rp.min.x) : (z - rp.min.z) / (rp.max.z - rp.min.z);
      const top = rp.h0 + (rp.h1 - rp.h0) * t;
      if (best === null || top > best) { best = top; src = 'ramp'; }
    }
  }
  return best === null ? null : { y: best, src };
}

// floorAt but only surfaces within a vertical play window near a reference y
function floorNear(x, z, refY, up = 3, down = 6) {
  let best = null, src = null;
  for (const b of solids) {
    if (x >= b.min.x && x <= b.max.x && z >= b.min.z && z <= b.max.z) {
      if (b.max.y <= refY + up && b.max.y >= refY - down) {
        if (best === null || b.max.y > best) { best = b.max.y; src = 'solid'; }
      }
    }
  }
  for (const rp of ramps) {
    if (x >= rp.min.x && x <= rp.max.x && z >= rp.min.z && z <= rp.max.z) {
      const t = rp.axis === 'x' ? (x - rp.min.x) / (rp.max.x - rp.min.x) : (z - rp.min.z) / (rp.max.z - rp.min.z);
      const top = rp.h0 + (rp.h1 - rp.h0) * t;
      if (top <= refY + up && top >= refY - down) { if (best === null || top > best) { best = top; src = 'ramp'; } }
    }
  }
  return best === null ? null : { y: best, src };
}

const out = { bounds: {}, spawns: [], malformed: [], duplicates: [], holes: [], perimeter: {}, rampFootprintSpawns: [] };

// ---- bounds ----
let mnx = Infinity, mny = Infinity, mnz = Infinity, mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
for (const b of solids) {
  mnx = Math.min(mnx, b.min.x); mny = Math.min(mny, b.min.y); mnz = Math.min(mnz, b.min.z);
  mxx = Math.max(mxx, b.max.x); mxy = Math.max(mxy, b.max.y); mxz = Math.max(mxz, b.max.z);
}
out.bounds = { min: { x: mnx, y: mny, z: mnz }, max: { x: mxx, y: mxy, z: mxz } };
out.solidCount = solids.length;
out.rampCount = ramps.length;

// ---- malformed / duplicates ----
const seen = new Map();
for (let i = 0; i < solids.length; i++) {
  const b = solids[i];
  const bad = [];
  for (const ax of ['x', 'y', 'z']) {
    if (!(b.max[ax] > b.min[ax])) bad.push(`${ax}:min${b.min[ax]}>=max${b.max[ax]}`);
    if ([b.min[ax], b.max[ax]].some(v => Number.isNaN(v) || !Number.isFinite(v))) bad.push(`${ax}:NaN/Inf`);
  }
  if (bad.length) out.malformed.push({ i, box: b, bad });
  const key = `${b.min.x},${b.min.y},${b.min.z},${b.max.x},${b.max.y},${b.max.z}`;
  if (seen.has(key)) out.duplicates.push({ i, dupOf: seen.get(key), key });
  else seen.set(key, i);
}
for (let i = 0; i < ramps.length; i++) {
  const rp = ramps[i];
  const bad = [];
  if (!(rp.max.x > rp.min.x)) bad.push('x deg');
  if (!(rp.max.z > rp.min.z)) bad.push('z deg');
  if ([rp.h0, rp.h1, rp.min.x, rp.max.x, rp.min.z, rp.max.z].some(v => Number.isNaN(v))) bad.push('NaN');
  if (bad.length) out.malformed.push({ ramp: i, rp, bad });
}

// ---- spawns ----
for (let i = 0; i < map.spawns.length; i++) {
  const sp = map.spawns[i].pos;
  const f = floorAt(sp.x, sp.z);
  const rec = { i, pos: sp, floor: f };
  if (!f) rec.flag = 'spawn-no-floor(null)';
  else if (f.y < sp.y - 3) rec.flag = `spawn-no-floor(floor ${f.y} is ${(sp.y - f.y).toFixed(2)}m below feet)`;
  // straddle: any solid whose box straddles the spawn point vertically through the body
  const straddle = [];
  for (let k = 0; k < solids.length; k++) {
    const b = solids[k];
    if (b.min.x < sp.x && sp.x < b.max.x && b.min.z < sp.z && sp.z < b.max.z && b.min.y < sp.y + STAND && b.max.y > sp.y) {
      straddle.push({ k, box: b });
    }
  }
  if (straddle.length) rec.straddle = straddle;
  // ramp footprint containment (movement snaps player UP to ramp top unconditionally)
  const inRamp = [];
  for (let k = 0; k < ramps.length; k++) {
    const rp = ramps[k];
    if (sp.x >= rp.min.x - R && sp.x <= rp.max.x + R && sp.z >= rp.min.z - R && sp.z <= rp.max.z + R) {
      const t = rp.axis === 'x' ? (sp.x - rp.min.x) / (rp.max.x - rp.min.x) : (sp.z - rp.min.z) / (rp.max.z - rp.min.z);
      const tc = Math.max(0, Math.min(1, t));
      const top = rp.h0 + (rp.h1 - rp.h0) * tc;
      const slope = Math.abs(rp.h1 - rp.h0) / (rp.axis === 'x' ? rp.max.x - rp.min.x : rp.max.z - rp.min.z);
      const angleDeg = Math.atan(slope) * 180 / Math.PI;
      inRamp.push({ k, rampTop: +top.toFixed(3), popUp: +(top - sp.y).toFixed(3), slopeAngleDeg: +angleDeg.toFixed(1) });
    }
  }
  if (inRamp.length) { rec.underRamp = inRamp; out.rampFootprintSpawns.push({ i, pos: sp, inRamp }); }
  out.spawns.push(rec);
}

// ---- floor coverage grid (holes) ----
// Sample the interior XZ bounds; classify each sample. "Void" (no floor in play range)
// is expected in the ring center by design — we cluster void samples and report where
// they are, plus flag any interior floor gaps that break a walkway.
const step = 1.0;
const playTop = 8, playBot = -3; // rings 0.6..7 tier; below -3 is the void hazard
const cols = Math.ceil((mxx - mnx) / step);
const rows = Math.ceil((mxz - mnz) / step);
let voidCount = 0, floorCount = 0;
const voidPts = [];
for (let ix = 0; ix <= cols; ix++) {
  for (let iz = 0; iz <= rows; iz++) {
    const x = mnx + ix * step, z = mnz + iz * step;
    // any walkable surface in the play tier (exclude the deep catch floor at -45)
    let hasFloor = false;
    const f = floorNear(x, z, 2, 6, 4); // surfaces roughly in [-2, 8]
    if (f && f.y > -3) hasFloor = true;
    if (hasFloor) floorCount++;
    else { voidCount++; voidPts.push({ x, z }); }
  }
}
out.grid = { step, samples: (cols + 1) * (rows + 1), withPlayFloor: floorCount, voidSamples: voidCount };

// characterize the void region: is it a single central blob (intended) or scattered?
// compute centroid + extent of void samples that are INSIDE the outer play footprint (|x|,|z| <= 21)
const innerVoid = voidPts.filter(p => Math.abs(p.x) <= 21 && Math.abs(p.z) <= 21);
if (innerVoid.length) {
  const cx = innerVoid.reduce((s, p) => s + p.x, 0) / innerVoid.length;
  const cz = innerVoid.reduce((s, p) => s + p.z, 0) / innerVoid.length;
  const rmax = Math.max(...innerVoid.map(p => Math.hypot(p.x, p.z)));
  const rmin = Math.min(...innerVoid.map(p => Math.hypot(p.x, p.z)));
  out.innerVoid = { count: innerVoid.length, centroid: { x: +cx.toFixed(2), z: +cz.toFixed(2) }, radialRange: [+rmin.toFixed(2), +rmax.toFixed(2)] };
}

// ---- perimeter: is the outer play footprint walled? ----
// walk the outer ring edge ring (radius ~20.6) at 16 angles, check for a hull wall just outside
function solidAt(x, y, z) {
  for (const b of solids) if (x >= b.min.x && x <= b.max.x && z >= b.min.z && z <= b.max.z && y >= b.min.y && y <= b.max.y) return b;
  return null;
}
const perim = [];
for (let a = 0; a < 16; a++) {
  const ang = (a / 16) * Math.PI * 2;
  // just past the outer deck edge (square ~21) sample for a hull wall at chest height
  const x = Math.cos(ang) * 23, z = Math.sin(ang) * 23;
  const wall = solidAt(x, 3, z);
  perim.push({ angDeg: Math.round(ang * 180 / Math.PI), x: +x.toFixed(1), z: +z.toFixed(1), walled: !!wall });
}
out.perimeter = { samples: perim, allWalled: perim.every(p => p.walled), openCount: perim.filter(p => !p.walled).length, open: perim.filter(p => !p.walled) };

// ---- hazard / catch floor sanity ----
out.hazards = map.hazards;
out.catchFloor = solids.filter(b => b.max.y <= -40).map(b => ({ min: b.min, max: b.max }));
out.platforms = map.platforms;

console.log(JSON.stringify(out, null, 2));
