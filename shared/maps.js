// ARENA — shared/maps.js
// The map REGISTRY. Each map's collider/spawn/mechanic DATA lives in its own
// module under shared/mapdata/<id>.js (THREE-free; the server + client-collision
// import it). The client VISUALS are bespoke per-map classes under
// src/world/maps/<id>.js (see MapRenderer.js). The old "recolored box" maps were
// thrown out; this set is genuinely distinct code-built environments.
import { box, V, normalizeMap } from './mapkit.js';
import { customToMapData } from './custommap.js';
import { buildLiveWorld } from './mapsim.js';

// --- bespoke map data modules (add each new map here) ---
import { data as spire } from './mapdata/spire.js';
import { data as causeway } from './mapdata/causeway.js';
import { data as caldera } from './mapdata/caldera.js';
import { data as helix } from './mapdata/helix.js';
import { data as bastion } from './mapdata/bastion.js';
import { data as warren } from './mapdata/warren.js';
import { data as drift } from './mapdata/drift.js';
import { data as halo } from './mapdata/halo.js';
import { data as foundry } from './mapdata/foundry.js';

const REGISTERED = [spire, causeway, caldera, helix, bastion, warren, drift, halo, foundry];

// Built-in maps ship no authored pickups — scatter a few AMMO crates at good interior
// floor spots so every base map has resupply. DETERMINISTIC (no RNG, pure function of
// the map geometry) so the client + server compute IDENTICAL positions/ids and their
// pickup state stays in sync. Custom maps author their own pickups and are left alone.
function pickAmmoSpots(map, n = 3) {
  const w = buildLiveWorld(map, { doors: {}, destroyed: new Set() }, 0);
  const solids = w.aabbs, ramps = w.ramps;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const s of solids) {
    if (s.max.y < -10 || (s.max.x - s.min.x) > 120) continue; // catch floor / giant slab
    minX = Math.min(minX, s.min.x); maxX = Math.max(maxX, s.max.x);
    minZ = Math.min(minZ, s.min.z); maxZ = Math.max(maxZ, s.max.z);
  }
  if (!isFinite(minX)) return [];
  const floorAt = (x, z) => {
    let best = null;
    for (const s of solids) { if (s.max.y < -10) continue; if (x >= s.min.x && x <= s.max.x && z >= s.min.z && z <= s.max.z && (best === null || s.max.y > best)) best = s.max.y; }
    for (const r of ramps) { if (x >= r.min.x && x <= r.max.x && z >= r.min.z && z <= r.max.z) { const t = r.axis === 'x' ? (x - r.min.x) / (r.max.x - r.min.x) : (z - r.min.z) / (r.max.z - r.min.z); const top = r.h0 + (r.h1 - r.h0) * t; if (best === null || top > best) best = top; } }
    return best;
  };
  const inHazard = (x, z, y) => (map.hazards || []).some((h) => h.type !== 'void' && x > h.min.x && x < h.max.x && z > h.min.z && z < h.max.z && y < h.max.y + 0.5);
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  const step = Math.max(2, Math.min(maxX - minX, maxZ - minZ) / 12);
  const minSep = Math.max(7, step * 2);
  // pool: on-floor spawn-pair MIDPOINTS first (contested routes between spawns),
  // ordered by pair distance; then a centre-out grid to fill island maps.
  const pool = [];
  const sp = (map.spawns || []).map((s) => s.pos);
  for (let i = 0; i < sp.length; i++) for (let j = i + 1; j < sp.length; j++) {
    const mx = (sp[i].x + sp[j].x) / 2, mz = (sp[i].z + sp[j].z) / 2;
    const f = floorAt(mx, mz); if (f === null || f < -10 || inHazard(mx, mz, f)) continue;
    pool.push({ x: mx, y: f, z: mz, pri: Math.hypot(sp[i].x - sp[j].x, sp[i].z - sp[j].z) });
  }
  pool.sort((a, b) => b.pri - a.pri);
  const grid = [];
  for (let x = minX + step; x < maxX; x += step) for (let z = minZ + step; z < maxZ; z += step) {
    const f = floorAt(x, z); if (f === null || f < -10 || inHazard(x, z, f)) continue;
    if (sp.some((s) => Math.hypot(s.x - x, s.z - z) < 3)) continue;
    grid.push({ x, y: f, z, pri: 0 });
  }
  grid.sort((a, b) => Math.hypot(a.x - cx, a.z - cz) - Math.hypot(b.x - cx, b.z - cz));
  const picked = [];
  for (const m of pool.concat(grid)) { if (picked.length >= n) break; if (picked.every((p) => Math.hypot(p.x - m.x, p.z - m.z) >= minSep)) picked.push(m); }
  return picked.map((p) => ({ x: +p.x.toFixed(2), y: +(p.y + 0.8).toFixed(2), z: +p.z.toFixed(2) }));
}
function scatterAmmo(map) {
  if (map.td) return; // the TD arena runs its own economy — no ammo crates
  if (map.custom || (Array.isArray(map.pickups) && map.pickups.length)) return;
  const spots = pickAmmoSpots(map, 3);
  if (spots.length) map.pickups = spots.map((s, i) => ({ id: `ammo_${map.id}_${i}`, kind: 'ammo', pos: s, respawnMs: 15000 }));
}

export const MAPS = {};
for (const d of REGISTERED) { const m = normalizeMap(d); scatterAmmo(m); MAPS[d.id] = m; }

export const DEFAULT_MAP = 'spire';

export function getMap(id) { return MAPS[id] || MAPS[DEFAULT_MAP]; }
export function registerMap(d) { MAPS[d.id] = normalizeMap(d); return MAPS[d.id]; }

// --- CUSTOM MAPS ------------------------------------------------------------
// Built-in maps keep their insertion order first; custom maps append after and
// are tracked here so mapList() can badge them + the raw JSON can be re-served.
const BUILTIN_IDS = new Set(Object.keys(MAPS));
// raw authored custom-map JSON, id -> custom (so the editor can re-fetch/edit it)
export const CUSTOM_RAW = new Map();

// Register (or replace) a custom map: converts + normalizes its collider DATA
// into the live registry (so getMap/mapList/Game.setMap see it) AND remembers
// the raw custom JSON. Never throws on a malformed map (guards + falls back).
export function registerCustomMap(custom) {
  try {
    const data = customToMapData(custom);
    if (!data || !data.id) return null;
    registerMap(data);
    CUSTOM_RAW.set(data.id, custom);
    return MAPS[data.id];
  } catch { return null; }
}

// Remove a custom map from the live registry + raw store (built-ins are safe).
export function unregisterCustomMap(id) {
  if (BUILTIN_IDS.has(id)) return false;
  const had = CUSTOM_RAW.delete(id);
  delete MAPS[id];
  return had;
}

const hex = (n) => (typeof n === 'number' ? '#' + n.toString(16).padStart(6, '0') : null);
export function mapList() {
  // td maps are mode-bound (switching to TOWER DEFENSE loads them) — hidden here
  return Object.values(MAPS).filter((m) => !m.td).map((m) => ({
    id: m.id, name: m.name, theme: (m.theme && m.theme.name) || m.name,
    accent: hex(m.theme && m.theme.accent), mood: hex(m.theme && m.theme.mood),
    custom: CUSTOM_RAW.has(m.id) || undefined,
  }));
}

// back-compat re-exports (mapdata modules import helpers from ./mapkit.js directly)
export const THEME_PRESETS = {};
export { box as mapBox, V as mapV };
