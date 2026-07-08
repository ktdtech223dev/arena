// ARENA — shared/maps.js
// The map REGISTRY. Each map's collider/spawn/mechanic DATA lives in its own
// module under shared/mapdata/<id>.js (THREE-free; the server + client-collision
// import it). The client VISUALS are bespoke per-map classes under
// src/world/maps/<id>.js (see MapRenderer.js). The old "recolored box" maps were
// thrown out; this set is genuinely distinct code-built environments.
import { box, V, normalizeMap } from './mapkit.js';
import { customToMapData } from './custommap.js';

// --- bespoke map data modules (add each new map here) ---
import { data as spire } from './mapdata/spire.js';
import { data as causeway } from './mapdata/causeway.js';
import { data as caldera } from './mapdata/caldera.js';
import { data as helix } from './mapdata/helix.js';
import { data as bastion } from './mapdata/bastion.js';
import { data as warren } from './mapdata/warren.js';
import { data as drift } from './mapdata/drift.js';
import { data as halo } from './mapdata/halo.js';

const REGISTERED = [spire, causeway, caldera, helix, bastion, warren, drift, halo];

export const MAPS = {};
for (const d of REGISTERED) MAPS[d.id] = normalizeMap(d);

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
  return Object.values(MAPS).map((m) => ({
    id: m.id, name: m.name, theme: (m.theme && m.theme.name) || m.name,
    accent: hex(m.theme && m.theme.accent), mood: hex(m.theme && m.theme.mood),
    custom: CUSTOM_RAW.has(m.id) || undefined,
  }));
}

// back-compat re-exports (mapdata modules import helpers from ./mapkit.js directly)
export const THEME_PRESETS = {};
export { box as mapBox, V as mapV };
