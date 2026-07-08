// ARENA — shared/mapsim.js
// Deterministic, THREE-free helpers for map mechanics that BOTH client and
// server must compute identically. Time-based motion (moving platforms, door
// animation timing) is a pure function of server time, so client prediction and
// server authority agree without networking each position. Stateful mechanics
// (barrel/destructible HP, door open/closed trigger) are networked in snapshots.

// Moving platform world position at server time `t` (seconds). Ping-pongs between
// `from` and `to` with a smooth ease so it settles at the ends; `phase` (0..1)
// offsets it so platforms don't all move in lockstep.
export function platformPos(p, t) {
  const period = p.period || 4;
  const u = ((t / period) + (p.phase || 0)) % 1;
  const tri = 1 - Math.abs(1 - 2 * u);          // 0→1→0
  const e = tri * tri * (3 - 2 * tri);          // smoothstep ease
  return {
    x: p.from.x + (p.to.x - p.from.x) * e,
    y: p.from.y + (p.to.y - p.from.y) * e,
    z: p.from.z + (p.to.z - p.from.z) * e,
  };
}

// Platform velocity (m/s) at time t — used to CARRY riders. Central difference.
export function platformVel(p, t) {
  const h = 1 / 120;
  const a = platformPos(p, t - h), b = platformPos(p, t + h);
  return { x: (b.x - a.x) / (2 * h), y: (b.y - a.y) / (2 * h), z: (b.z - a.z) / (2 * h) };
}

// A platform's solid AABB at time t (its box translated to the current position;
// the box is defined by half-extents `size` around the moving centre-top).
export function platformAabb(p, t) {
  const c = platformPos(p, t);
  const s = p.size || { x: 2, y: 0.3, z: 2 };
  return {
    min: { x: c.x - s.x, y: c.y - s.y, z: c.z - s.z },
    max: { x: c.x + s.x, y: c.y + s.y, z: c.z + s.z },
    platform: true,
  };
}

// Build the LIVE collision world for a map given dynamic state (open doors and
// broken destructibles removed; platforms placed at their current position).
// `state` = { doors:{id:openFrac}, destroyed:Set(ids) }. Used by BOTH the client
// (prediction) and the server (authority) so movement stays identical.
export function buildLiveWorld(map, state, t) {
  const aabbs = [];
  const ramps = map.ramps ? map.ramps.slice() : [];
  for (const s of map.solids || []) aabbs.push(s);
  // destructibles that aren't broken are solid
  for (const d of map.destructibles || []) {
    if (!state?.destroyed?.has?.(d.id)) aabbs.push({ min: d.min, max: d.max, surface: d.surface || 'metal' });
  }
  // doors: solid until (mostly) open. openFrac >= 0.85 → passable.
  for (const dr of map.doors || []) {
    const open = state?.doors?.[dr.id] ?? 0;
    if (open < 0.85) aabbs.push(doorAabb(dr, open));
  }
  // moving platforms at their current position
  for (const p of map.platforms || []) aabbs.push(platformAabb(p, t));
  return { aabbs, ramps };
}

// A door's AABB given how far it's slid open (openFrac 0..1 along its axis).
export function doorAabb(dr, openFrac) {
  const off = (dr.openOffset || { x: 0, y: 3, z: 0 });
  const f = openFrac;
  return {
    min: { x: dr.min.x + off.x * f, y: dr.min.y + off.y * f, z: dr.min.z + off.z * f },
    max: { x: dr.max.x + off.x * f, y: dr.max.y + off.y * f, z: dr.max.z + off.z * f },
    surface: 'metal',
  };
}
