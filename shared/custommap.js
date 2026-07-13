// ARENA — shared/custommap.js  (Phase 2 keystone)
// The CUSTOM MAP format + its deterministic conversion to the game's collider
// DATA. THREE-free and imported by BOTH the client (editor + render + prediction)
// and the headless server (collision + gameplay-object spawns), so a custom map
// collides IDENTICALLY on both — netcode/hit-reg is unchanged from built-ins.
//
// A custom map is authored in the first-person editor as a list of BLOCKS (each a
// code-built primitive with a transform + material + type props), LIGHTS, and
// GAMEPLAY OBJECTS (weapon/health/armor/powerup spawns + player spawns), plus a
// skybox/lighting preset + metadata. `customToMapData()` turns that into the
// normalized {solids, ramps, spawns, hazards, pickups, ...} the server + client
// consume — the SAME shape built-in maps produce (see shared/maps.js / mapkit.js).

// ---------------------------------------------------------------------------
// BLOCK TYPES — the editor palette + how each generates a collider.
//   collide: 'aabb' (axis-aligned box) | 'ramp' (heightfield) | 'none'
//   size:    default full extents [x,y,z]
//   color:   default hex; wallrun: default wall-run flag
// ---------------------------------------------------------------------------
export const BLOCK_TYPES = {
  // --- structural ---
  cube:     { cat: 'structural', label: 'Block',    collide: 'aabb', size: [2, 2, 2], color: 0x8794a4 },
  wall:     { cat: 'structural', label: 'Wall',     collide: 'aabb', size: [4, 3, 0.3], color: 0x7c8998 },
  floor:    { cat: 'structural', label: 'Floor',    collide: 'aabb', size: [6, 0.4, 6], color: 0x6f7c8a },
  pillar:   { cat: 'structural', label: 'Pillar',   collide: 'aabb', size: [1, 4, 1], color: 0x8a95a4, round: true },
  platform: { cat: 'structural', label: 'Platform', collide: 'aabb', size: [4, 0.4, 4], color: 0x74838f },
  beam:     { cat: 'structural', label: 'Catwalk',  collide: 'aabb', size: [1.4, 0.3, 8], color: 0x5f6a76 },
  arch:     { cat: 'structural', label: 'Arch',     collide: 'aabb', size: [4, 4, 1], color: 0x7c8998, arch: true },
  angled:   { cat: 'structural', label: 'Angled',   collide: 'aabb', size: [4, 0.3, 4], color: 0x74838f },
  // --- ramps / slopes (walkable heightfields) ---
  ramp:     { cat: 'ramp', label: 'Ramp',   collide: 'ramp', size: [4, 3, 4], color: 0x6b7b8a },
  stairs:   { cat: 'ramp', label: 'Stairs', collide: 'ramp', size: [3, 3, 5], color: 0x6b7b8a, steps: true },
  slide:    { cat: 'ramp', label: 'Slide',  collide: 'ramp', size: [3, 4, 6], color: 0x2a5a66, slide: true, emissive: 0x18b6d8 },
  // --- movement pieces ---
  runwall:  { cat: 'movement', label: 'Wall-run',  collide: 'aabb', size: [0.4, 5, 8], color: 0x1c3a44, wallrun: true, emissive: 0x18b6d8 },
  jumppad:  { cat: 'movement', label: 'Jump Pad',  collide: 'aabb', size: [2, 0.3, 2], color: 0x2a1a4a, emissive: 0xb15bff, pad: true, boost: 14 },
  // --- cosmetic / light ---
  neon:     { cat: 'cosmetic', label: 'Neon Strip', collide: 'none', size: [4, 0.15, 0.15], color: 0x18b6d8, emissive: 0x18b6d8, emissiveOnly: true },
  prop:     { cat: 'cosmetic', label: 'Prop',       collide: 'none', size: [1, 1, 1], color: 0x9aa6b4 },

  // --- props / set pieces (decor; solid unless collide:'none'). `shaped` = has a
  //     custom mesh so the play renderer won't flatten it into a merged box. ---
  crate:    { cat: 'props', label: 'Crate',      collide: 'aabb', size: [1.2, 1.2, 1.2], color: 0x8a6a3a, crate: true, shaped: true },
  container:{ cat: 'props', label: 'Container',  collide: 'aabb', size: [6, 2.6, 2.5], color: 0x2f6f8f, container: true, shaped: true },
  girder:   { cat: 'props', label: 'Girder',     collide: 'aabb', size: [0.5, 0.5, 8], color: 0x5a6470 },
  fence:    { cat: 'props', label: 'Railing',    collide: 'aabb', size: [4, 1.2, 0.12], color: 0x3a4650, fence: true, shaped: true },
  beacon:   { cat: 'props', label: 'Beacon',     collide: 'aabb', size: [0.5, 2.6, 0.5], color: 0x223040, emissive: 0xff5a1e, beacon: true, shaped: true },
  holo:     { cat: 'props', label: 'Holo Panel', collide: 'none', size: [2, 1.2, 0.08], color: 0x18b6d8, emissive: 0x18b6d8, emissiveOnly: true },
  rock:     { cat: 'props', label: 'Rock',       collide: 'aabb', size: [2.2, 1.8, 2.2], color: 0x555a60, rock: true, shaped: true },

  // --- hazards (damage volumes; walk through → take dps. no collider) ---
  lava:     { cat: 'hazard', label: 'Lava',   collide: 'none', size: [4, 0.3, 4], color: 0xff3a00, emissive: 0xff3a00, hazard: true, hazType: 'lava',     dps: 35, glow: true },
  toxic:    { cat: 'hazard', label: 'Toxic',  collide: 'none', size: [4, 0.3, 4], color: 0x88ff2a, emissive: 0x66cc22, hazard: true, hazType: 'toxic',    dps: 22 },
  tesla:    { cat: 'hazard', label: 'Tesla',  collide: 'none', size: [3, 0.3, 3], color: 0x4da6ff, emissive: 0x4da6ff, hazard: true, hazType: 'electric', dps: 45, glow: true },
  spikes:   { cat: 'hazard', label: 'Spikes', collide: 'none', size: [2, 0.6, 2], color: 0x9099a0, hazard: true, hazType: 'spike', dps: 55 },

  // --- interactive / dynamic (server-simulated: proximity doors, breakables, barrels) ---
  door:     { cat: 'interactive', label: 'Door',       collide: 'aabb', size: [3, 3.4, 0.4], color: 0x2a3038, emissive: 0x7df9ff, door: true },
  breakwall:{ cat: 'interactive', label: 'Breakable',  collide: 'aabb', size: [3, 3, 0.6], color: 0x5a5346, destructible: true, hp: 120 },
  breakcrate:{ cat: 'interactive', label: 'Weak Crate', collide: 'aabb', size: [1.6, 1.6, 1.6], color: 0x6a5a3a, destructible: true, hp: 45 },
  barrel:   { cat: 'interactive', label: 'Barrel',     collide: 'aabb', size: [0.9, 1.1, 0.9], color: 0xcc2a1a, emissive: 0xff4020, barrel: true, hp: 25 },
};

// placeable LIGHTS (own list — counts against the per-map light cap). Each preset
// resolves to a `base` THREE light (point|spot) with a default color/intensity/dist
// so authors get variety without a bigger light model. customToMapData + the mesh
// builders only care about the resolved kind (point|spot) + color.
export const LIGHT_KINDS = {
  point: { label: 'Point', base: 'point', color: 0xffffff, dist: 16, intensity: 2.0 },
  spot:  { label: 'Spot',  base: 'spot',  color: 0xffffff, dist: 22, intensity: 2.6 },
  torch: { label: 'Torch', base: 'point', color: 0xff8a3c, dist: 12, intensity: 2.4 },
  ember: { label: 'Ember', base: 'point', color: 0xff4a1e, dist: 10, intensity: 2.0 },
  cool:  { label: 'Cool',  base: 'point', color: 0x8ab6ff, dist: 18, intensity: 2.0 },
  neon:  { label: 'Neon',  base: 'point', color: 0xb15bff, dist: 14, intensity: 2.2 },
  flood: { label: 'Flood', base: 'spot',  color: 0xffffff, dist: 32, intensity: 3.4 },
};
export const MAX_CUSTOM_LIGHTS = 24;  // editor enforces + warns at this cap (perf)

// weapons a RANDOM weapon spawner can roll (guns only — melee excluded so a random
// spawner always grants a firearm). Server rolls authoritatively (see Pickups.js).
export const RANDOM_WEAPON_POOL = ['pistol', 'smg', 'shotgun', 'ar', 'sniper', 'dmr', 'revolver', 'exotic', 'sawblade'];

// what a player spawns holding on a CUSTOM map (the rest must be found as pickups).
// Everywhere else keeps the full arsenal. Tunable in one place.
export const CUSTOM_START_WEAPONS = ['knife', 'pistol'];

// GAMEPLAY OBJECT kinds
export const OBJECT_KINDS = {
  weapon:  { label: 'Weapon Spawn', color: 0xffd166, respawnMs: 8000 },
  ammo:    { label: 'Ammo',         color: 0xffcf6a, respawnMs: 15000 },
  health:  { label: 'Health',       color: 0x51e898, respawnMs: 12000, amount: 50 },
  armor:   { label: 'Armor',        color: 0x7df9ff, respawnMs: 20000, amount: 50 },
  powerup: { label: 'Power-up',     color: 0xb15bff, respawnMs: 30000 },
  spawn:   { label: 'Player Spawn', color: 0xff8fcf },
};

// starter POWER-UP set (buffs applied server-side while active)
export const POWERUPS = {
  speed:      { label: 'Speed',      color: 0x7df9ff, durMs: 12000, speedMult: 1.35 },
  damage:     { label: 'Damage',     color: 0xff6b6b, durMs: 12000, dmgMult: 1.5 },
  quad:       { label: 'Quad Damage', color: 0xb15bff, durMs: 15000, dmgMult: 4 },
  overshield: { label: 'Overshield', color: 0x9fe6ff, durMs: 0, shield: 100 },
};

// weapon ids a WEAPON SPAWN can grant (mirrors the weapon roster)
export const SPAWN_WEAPONS = ['pistol', 'smg', 'shotgun', 'ar', 'sniper', 'dmr', 'revolver', 'exotic', 'sawblade', 'knife', 'bat'];

// SKYBOX + LIGHTING presets so custom maps aren't void/dark. Each carries the
// gradient sky colors, fog, a directional KEY + hemisphere FILL rig — reused by
// the CustomEnv renderer (Phase 1D philosophy: readable, neon as accent).
export const SKYBOX_PRESETS = {
  night:   { name: 'Night',   accent: 0x7df9ff, mood: 0x0a1020, skyTop: 0x0b1428, skyBot: 0x05070e, fog: [0x0a1220, 40, 200], key: { color: 0xc4d6ff, intensity: 1.5, dir: [0.4, -1, 0.3] }, hemi: { sky: 0x3a5c94, ground: 0x141a26, intensity: 1.3 }, amb: 0.5, stars: 220 },
  day:     { name: 'Day',     accent: 0x18b6d8, mood: 0x203040, skyTop: 0x2f6fb0, skyBot: 0xcfe3f2, fog: [0xbcd4e6, 60, 260], key: { color: 0xfff2d8, intensity: 1.85, dir: [-0.4, -1, 0.25] }, hemi: { sky: 0x9fc4e6, ground: 0x40484a, intensity: 1.35 }, amb: 0.6, stars: 0 },
  dusk:    { name: 'Dusk',    accent: 0xffb14a, mood: 0x1a1220, skyTop: 0x2a1e3a, skyBot: 0xd06a3a, fog: [0x4a2a3a, 50, 220], key: { color: 0xffb27a, intensity: 1.6, dir: [0.3, -0.8, -0.4] }, hemi: { sky: 0x6a4a5a, ground: 0x1a1214, intensity: 1.2 }, amb: 0.5, stars: 60 },
  space:   { name: 'Space',   accent: 0xb15bff, mood: 0x060810, skyTop: 0x060810, skyBot: 0x02030a, fog: [0x05060e, 60, 260], key: { color: 0xcfe0ff, intensity: 1.4, dir: [0.3, -0.9, 0.3] }, hemi: { sky: 0x2a3450, ground: 0x0a0e18, intensity: 1.1 }, amb: 0.45, stars: 320 },
  volcanic:{ name: 'Volcanic', accent: 0xff5a1e, mood: 0x1a0c08, skyTop: 0x180a06, skyBot: 0x5a2408, fog: [0x3a1a0c, 45, 200], key: { color: 0xffb680, intensity: 1.7, dir: [-0.3, -1, 0.2] }, hemi: { sky: 0x7a4526, ground: 0x2a0a00, intensity: 1.4 }, amb: 0.5, stars: 40 },
};
export const LIGHTING_PRESETS = SKYBOX_PRESETS; // sky + lighting picked together (a preset per fiction)

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
const clampNum = (v, lo, hi, d) => (typeof v === 'number' && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);

// World AABB of a box (center c, full size s) rotated by Euler ry (yaw) — we only
// snap rotation to yaw for collision so the AABB stays tight (90°→dims swap). For
// non-axis yaws the AABB conservatively bounds the rotated footprint.
function rotatedAabb(c, s, ry) {
  const hx = s[0] / 2, hy = s[1] / 2, hz = s[2] / 2;
  const cos = Math.abs(Math.cos(ry || 0)), sin = Math.abs(Math.sin(ry || 0));
  const ex = hx * cos + hz * sin;   // rotated half-extents in X/Z (yaw only)
  const ez = hx * sin + hz * cos;
  return { min: { x: c[0] - ex, y: c[1] - hy, z: c[2] - ez }, max: { x: c[0] + ex, y: c[1] + hy, z: c[2] + ez } };
}

// A blank custom map (editor "new"). `now` passed in (server stamps it).
export function newCustomMap(name, author, now) {
  return {
    id: 'custom_' + (name || 'map').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) + '_' + ((now || 0) % 100000),
    name: name || 'Untitled', author: author || 'anon', created: now || 0, version: 1, custom: true,
    skybox: 'night',
    blocks: [
      // a starter floor so the space isn't void
      { type: 'floor', x: 0, y: -0.2, z: 0, sx: 40, sy: 0.4, sz: 40, ry: 0, color: 0x54606c },
    ],
    lights: [],
    objects: [
      { kind: 'spawn', x: -6, y: 0, z: -6, yaw: 45 },
      { kind: 'spawn', x: 6, y: 0, z: 6, yaw: 225 },
    ],
  };
}

// ---------------------------------------------------------------------------
// customToMapData — THE deterministic converter (server + client both call it).
// Produces the normalized map-data shape built-in maps use, PLUS a `blocks` /
// `lights` / `skybox` visual payload the CustomEnv renderer reads. Never throws.
// ---------------------------------------------------------------------------
export function customToMapData(custom) {
  const c = custom || {};
  const preset = SKYBOX_PRESETS[c.skybox] || SKYBOX_PRESETS.night;
  const solids = [];
  const ramps = [];
  const spawns = [];
  const pickups = [];
  const pads = [];
  const doors = [];
  const destructibles = [];
  const barrels = [];
  const hazards = [];
  let minY = 0;

  const blocksArr = c.blocks || [];
  for (let i = 0; i < blocksArr.length; i++) {
    const b = blocksArr[i];
    const def = BLOCK_TYPES[b.type];
    if (!def) continue;
    const s = [b.sx || def.size[0], b.sy || def.size[1], b.sz || def.size[2]];
    const box = rotatedAabb([b.x || 0, b.y || 0, b.z || 0], s, b.ry || 0);
    minY = Math.min(minY, box.min.y);

    // --- DYNAMIC / networked types: routed to their own arrays and simulated by
    //     the shared map sim (server MapState + buildLiveWorld on both sides). They
    //     are NOT static solids — buildLiveWorld toggles their collision from live
    //     state (door open frac / destroyed set). A stable per-block id links the
    //     collider ↔ authoritative state ↔ client visual. ---
    if (def.door) {
      const h = box.max.y - box.min.y;
      doors.push({ id: 'cm_door_' + i, min: box.min, max: box.max, openOffset: { x: 0, y: h + 0.1, z: 0 }, trigger: 'proximity' });
      continue;
    }
    if (def.destructible) {
      destructibles.push({ id: 'cm_destr_' + i, min: box.min, max: box.max, hp: b.hp || def.hp || 100, surface: def.surface || 'concrete' });
      continue;
    }
    if (def.barrel) {
      barrels.push({ id: 'cm_barrel_' + i, pos: { x: b.x || 0, y: box.min.y, z: b.z || 0 }, hp: b.hp || def.hp || 25 });
      continue;
    }
    if (def.hazard) {
      hazards.push({ id: 'cm_hz_' + i, type: def.hazType || 'lava', min: box.min, max: box.max, dps: b.dps || def.dps || 30, glow: !!def.glow });
      continue;
    }

    if (def.collide === 'aabb') {
      const solid = { min: box.min, max: box.max };
      if (b.wallrun ?? def.wallrun) solid.wallrun = true;
      if ((b.type === 'jumppad') || def.pad) pads.push({ min: box.min, max: box.max, boost: b.boost || def.boost || 14 });
      solids.push(solid);
    } else if (def.collide === 'ramp') {
      // ramp rises along its longer horizontal axis; ry snapped chooses x vs z and
      // the flip. base = box.min.y, top = box.max.y (rise = sy).
      const lenX = box.max.x - box.min.x, lenZ = box.max.z - box.min.z;
      const axis = lenZ >= lenX ? 'z' : 'x';
      const flip = !!b.rampFlip;
      const base = box.min.y, top = box.max.y;
      ramps.push({ min: { x: box.min.x, y: base, z: box.min.z }, max: { x: box.max.x, y: top, z: box.max.z }, axis, h0: flip ? top : base, h1: flip ? base : top });
    }
    // 'none' → cosmetic, no collider
  }

  // placed lights (capped)
  const lights = (c.lights || []).slice(0, MAX_CUSTOM_LIGHTS).map((l) => ({
    kind: l.kind === 'spot' ? 'spot' : 'point',
    x: l.x || 0, y: l.y || 0, z: l.z || 0,
    color: (typeof l.color === 'number') ? l.color : 0xffffff,
    intensity: clampNum(l.intensity, 0, 6, 2), dist: clampNum(l.dist, 3, 40, 16),
  }));

  // gameplay objects → spawns + pickups
  for (const o of (c.objects || [])) {
    if (o.kind === 'spawn') spawns.push({ pos: { x: o.x || 0, y: o.y || 0, z: o.z || 0 }, yaw: o.yaw || 0, team: o.team });
    else if (o.kind === 'weapon' || o.kind === 'ammo' || o.kind === 'health' || o.kind === 'armor' || o.kind === 'powerup') {
      // a weapon spawn set to 'random' becomes a POOLED spawner: the server rolls a
      // random gun from `pool` on each (re)spawn (authoritative). `weapon` stays
      // undefined so the roll is the source of truth.
      const isRandom = o.kind === 'weapon' && o.weapon === 'random';
      pickups.push({
        id: o.id || (o.kind + '_' + pickups.length),
        kind: o.kind, pos: { x: o.x || 0, y: (o.y || 0) + 0.6, z: o.z || 0 },
        weapon: isRandom ? undefined : o.weapon,
        pool: isRandom ? RANDOM_WEAPON_POOL.slice() : undefined,
        amount: o.amount, powerup: o.powerup,
        respawnMs: o.respawnMs || (OBJECT_KINDS[o.kind]?.respawnMs || 10000),
      });
    }
  }

  // safety net: a catch floor + void hazard far below so a fall respawns (never
  // an infinite drop), and a default spawn if the author placed none.
  const floorY = minY - 60;
  solids.push({ min: { x: -400, y: floorY - 1, z: -400 }, max: { x: 400, y: floorY, z: 400 } });
  hazards.push({ id: 'cm_void', type: 'void', min: { x: -400, y: floorY, z: -400 }, max: { x: 400, y: minY - 6, z: 400 }, dps: 200 });
  if (!spawns.length) spawns.push({ pos: { x: 0, y: 1, z: 0 }, yaw: 0 });

  return {
    id: c.id || 'custom', name: c.name || 'Custom', custom: true,
    theme: { name: preset.name, accent: preset.accent, mood: preset.mood },
    solids, ramps, spawns, hazards, pickups, pads,
    barrels, platforms: [], doors, destructibles, foliage: [], props: [],
    // visual payload for CustomEnv
    blocks: c.blocks || [], lights, skybox: c.skybox || 'night',
  };
}

// ---------------------------------------------------------------------------
// validateCustomMap — server-side gate so a bad map can't break the server.
// Returns { ok, errors:[], warnings:[] }. Enforces sane sizes + a spawn.
// ---------------------------------------------------------------------------
export const CUSTOM_LIMITS = { maxBlocks: 1200, maxLights: MAX_CUSTOM_LIGHTS, maxObjects: 200, maxExtent: 400, minSpawns: 1, warnSpawns: 2, warnBlocks: 700 };

export function validateCustomMap(custom) {
  const errors = [], warnings = [];
  const c = custom || {};
  if (!c || typeof c !== 'object') return { ok: false, errors: ['not an object'], warnings };
  const blocks = Array.isArray(c.blocks) ? c.blocks : [];
  const objects = Array.isArray(c.objects) ? c.objects : [];
  const lights = Array.isArray(c.lights) ? c.lights : [];
  if (!c.name || typeof c.name !== 'string') errors.push('missing name');
  if (blocks.length > CUSTOM_LIMITS.maxBlocks) errors.push(`too many blocks (${blocks.length} > ${CUSTOM_LIMITS.maxBlocks})`);
  if (objects.length > CUSTOM_LIMITS.maxObjects) errors.push(`too many objects (${objects.length})`);
  if (lights.length > CUSTOM_LIMITS.maxLights) errors.push(`too many lights (${lights.length} > ${CUSTOM_LIMITS.maxLights})`);
  for (const b of blocks) {
    if (!BLOCK_TYPES[b?.type]) { errors.push(`unknown block type '${b?.type}'`); break; }
    if (Math.abs(b.x) > CUSTOM_LIMITS.maxExtent || Math.abs(b.y) > CUSTOM_LIMITS.maxExtent || Math.abs(b.z) > CUSTOM_LIMITS.maxExtent) { errors.push('a block is out of bounds'); break; }
  }
  const spawns = objects.filter((o) => o?.kind === 'spawn');
  if (spawns.length < CUSTOM_LIMITS.minSpawns) errors.push('needs at least one player spawn');
  if (spawns.length < CUSTOM_LIMITS.warnSpawns) warnings.push('fewer than 2 spawns — players may spawn on top of each other');
  // on custom maps players start with only the starter loadout (knife + pistol) and
  // must find guns — warn if the author placed no weapon spawns to pick up.
  if (!objects.some((o) => o?.kind === 'weapon')) warnings.push('no weapon spawns — players will be stuck with the starter loadout (add Weapon spawns, incl. a Random one)');
  if (blocks.length > CUSTOM_LIMITS.warnBlocks) warnings.push('heavy map (many blocks) — may run below target on low-end machines');
  return { ok: errors.length === 0, errors, warnings };
}
