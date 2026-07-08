// ARENA — shared/mapkit.js
// THREE-free helpers for authoring map DATA (colliders/spawns/mechanics). Used by
// the per-map data modules AND the server (headless). Vectors are {x,y,z}.
export const V = (x, y, z) => ({ x, y, z });
export const box = (x0, y0, z0, x1, y1, z1, extra = {}) => ({ min: { x: x0, y: y0, z: z0 }, max: { x: x1, y: y1, z: z1 }, ...extra });
export const ramp = (x0, z0, x1, z1, h0, h1, axis = 'x') => ({ min: { x: x0, y: 0, z: z0 }, max: { x: x1, y: Math.max(h0, h1), z: z1 }, axis, h0, h1 });
export const spawn = (x, y, z, yaw) => ({ pos: { x, y, z }, yaw });

// fill empty mechanic arrays so consumers can assume they exist
export function normalizeMap(m) {
  for (const k of ['solids', 'ramps', 'spawns', 'barrels', 'hazards', 'doors', 'platforms', 'destructibles', 'foliage', 'props']) {
    if (!m[k]) m[k] = [];
  }
  return m;
}
