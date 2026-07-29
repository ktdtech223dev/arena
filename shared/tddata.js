// TOWER DEFENSE — shared/tddata.js (THREE-free; imported by BOTH the server sim
// and the client view, so enemy positions, costs, waves and trees are identical).
//
// TD is a SERVER game mode (co-op: the whole crew fights the same horde on the
// FOUNDRY map). This module owns: the enemy path + math, enemy defs, wave
// composition (tuned HARD), the 15 tower defs (costs raised; sfx/vfx keys for
// the client), the branching-upgrade rule, and the per-WEAPON upgrade trees
// (TD loadout: start with the pistol, buy up to TWO guns total, upgrade them).

// ---------------------------------------------------------------------------
// PATH + map math (used by server enemy sim AND client rendering — identical).
// ---------------------------------------------------------------------------
export const TD_PATH = [
  { x: -46, z: -34 }, { x: -30, z: -34 }, { x: -30, z: -10 }, { x: -6, z: -10 },
  { x: -6, z: -30 }, { x: 18, z: -30 }, { x: 18, z: 2 }, { x: -14, z: 2 },
  { x: -14, z: 22 }, { x: 12, z: 22 }, { x: 12, z: 38 }, { x: 38, z: 38 },
];
export const TD_CORE = { x: 42, y: 0, z: 38 };
export const TD_ARMORY = { x: 34, y: 0, z: 16 };   // walk up + press E → weapon shop
export const TD_PATH_W = 4;

let _len = 0;
for (let i = 1; i < TD_PATH.length; i++) _len += Math.hypot(TD_PATH[i].x - TD_PATH[i - 1].x, TD_PATH[i].z - TD_PATH[i - 1].z);
export function tdPathLength() { return _len; }

export function tdPointAt(dist) {
  let d = dist;
  for (let i = 1; i < TD_PATH.length; i++) {
    const a = TD_PATH[i - 1], b = TD_PATH[i];
    const seg = Math.hypot(b.x - a.x, b.z - a.z);
    if (d <= seg) { const t = d / seg; return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, dirX: (b.x - a.x) / seg, dirZ: (b.z - a.z) / seg }; }
    d -= seg;
  }
  const a = TD_PATH[TD_PATH.length - 2], b = TD_PATH[TD_PATH.length - 1];
  const seg = Math.hypot(b.x - a.x, b.z - a.z);
  return { x: b.x, z: b.z, dirX: (b.x - a.x) / seg, dirZ: (b.z - a.z) / seg };
}

export function tdDistToPath(x, z) {
  let best = Infinity;
  for (let i = 1; i < TD_PATH.length; i++) {
    const a = TD_PATH[i - 1], b = TD_PATH[i];
    const abx = b.x - a.x, abz = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((x - a.x) * abx + (z - a.z) * abz) / (abx * abx + abz * abz)));
    best = Math.min(best, Math.hypot(x - (a.x + abx * t), z - (a.z + abz * t)));
  }
  return best;
}

// deterministic per-enemy lane offset (server + client agree via the id)
export function tdLane(id) { return (((id * 2654435761) % 97) / 97 - 0.5) * 2.4; }

/** World position of an enemy from its wire state (dist + id + def). */
export function tdEnemyPos(id, def, dist, t = 0) {
  const p = tdPointAt(dist);
  const lane = tdLane(id) + (def.jitter ? Math.sin(t * 7.3 + id) * def.jitter * 0.5 : 0);
  const nx = -p.dirZ, nz = p.dirX;
  const fly = def.fly ? def.fly + Math.sin(t * 2.2 + id) * 0.25 : 0;
  return { x: p.x + nx * lane, y: fly, z: p.z + nz * lane, yaw: Math.atan2(p.dirX, p.dirZ) };
}

// ---------------------------------------------------------------------------
// ENEMIES — bounties TIGHTENED (~35% down) + the horde hits harder and earlier.
// ---------------------------------------------------------------------------
export const ENEMY_DEFS = {
  shambler:  { family: 'zombie', name: 'SHAMBLER',      hp: 70,  speed: 1.7, armor: 0, coreDmg: 4,  bounty: 4,   size: 1.0 },
  sprinter:  { family: 'zombie', name: 'SPRINTER',      hp: 40,  speed: 3.9, armor: 0, coreDmg: 3,  bounty: 5,   size: 0.85 },
  brute:     { family: 'zombie', name: 'BRUTE',         hp: 420, speed: 1.15, armor: 5, coreDmg: 14, bounty: 16,  size: 1.5 },
  bloater:   { family: 'zombie', name: 'BLOATER',       hp: 160, speed: 1.35, armor: 0, coreDmg: 9,  bounty: 9,   size: 1.25, boomOnDeath: 3 },
  screamer:  { family: 'zombie', name: 'SCREAMER',      hp: 95,  speed: 2.1, armor: 0, coreDmg: 4,  bounty: 11,  size: 0.95, hasteAura: 1.35, hasteR: 6 },
  drone:     { family: 'alien',  name: 'DRONE',         hp: 55,  speed: 2.8, armor: 0, coreDmg: 3,  bounty: 5,   size: 0.8,  fly: 2.2 },
  skitterer: { family: 'alien',  name: 'SKITTERER',     hp: 30,  speed: 4.8, armor: 0, coreDmg: 2,  bounty: 4,   size: 0.7,  jitter: 1.4 },
  warden:    { family: 'alien',  name: 'WARDEN',        hp: 230, speed: 1.8, armor: 3, coreDmg: 10, bounty: 15,  size: 1.3,  shield: 120, shieldRegen: 16 },
  stalker:   { family: 'alien',  name: 'PHASE STALKER', hp: 135, speed: 3.0, armor: 0, coreDmg: 6,  bounty: 13,  size: 1.0,  phaseS: 1.3, phaseEvery: 3.2 },
  queen:     { family: 'alien',  name: 'HIVE QUEEN',    hp: 4200, speed: 0.95, armor: 8, coreDmg: 60, bounty: 170, size: 2.4, fly: 1.4, spawns: 'skitterer', spawnEvery: 3.2 },
};
export const ENEMY_IDS = Object.keys(ENEMY_DEFS); // stable wire indices

// Wave composer — MUCH harder curve: steeper hp ramp starting sooner, denser
// packs, specials arrive earlier, minibosses every 5, the QUEEN every 10.
export function composeWave(n) {
  const hpMult = 1 + (n - 1) * 0.22 + Math.pow(Math.max(0, n - 7), 1.5) * 0.035;
  const mix = [];
  const add = (id, count, gapS = 0.8) => mix.push({ id, count: Math.max(1, Math.round(count)), gapS });
  if (n % 10 === 0) { add('queen', Math.max(1, Math.floor(n / 12)), 2); add('warden', n / 3, 1.1); add('stalker', n / 3, 0.9); add('skitterer', n * 1.4, 0.28); }
  else if (n % 5 === 0) { add('brute', 1 + n / 4, 1.8); add('bloater', n / 2.2, 1.1); add('screamer', n / 4, 1.6); add('sprinter', n, 0.4); }
  else {
    add('shambler', 5 + n * 1.7, 0.65);
    if (n >= 2) add('sprinter', n * 1.2, 0.42);
    if (n >= 2) add('skitterer', n * 1.0, 0.34);
    if (n >= 3) add('drone', n * 0.8, 0.75);
    if (n >= 4) add('screamer', n / 3, 1.6);
    if (n >= 5) add('stalker', n / 3, 1.3);
    if (n >= 6) add('warden', n / 4, 1.9);
    if (n >= 7) add('bloater', n / 3, 1.5);
  }
  return { hpMult, mix, bonus: 25 + n * 8 };
}

export const TD_START_GOLD = 250;
export const TD_CORE_HP = 100;
export const TD_SELL_FRAC = 0.65;

// ---------------------------------------------------------------------------
// TOWERS — 15 units. Costs RAISED (tight economy); sfx/vfx keys drive the
// client's per-tower audio + attack visuals. Same branching rule as before.
// ---------------------------------------------------------------------------
export const UNIT_DEFS = [
  { id: 'gatling', name: 'GATLING TURRET', icon: '🔫', cost: 170, role: 'damage', range: 14, rate: 3.2, dmg: 6,
    sfx: 'td_gatling', vfx: 'bullet',
    paths: [
      [{ name: 'RIFLED BARRELS', cost: 120, mod: { dmg: +4 } },
       { name: 'SPIN-UP MOTOR', cost: 240, mod: { rate: +2.4 } },
       { name: 'MINIGUN ARRAY', cost: 560, mod: { rate: +4, dmg: +4 } }],
      [{ name: 'AP ROUNDS', cost: 130, mod: { armorPierce: 0.5 } },
       { name: 'TUNGSTEN CORE', cost: 290, mod: { dmg: +10, armorPierce: 1 } },
       { name: 'RAIL-GATLING', cost: 640, mod: { dmg: +18, range: +4 } }],
    ] },
  { id: 'railcannon', name: 'RAILCANNON', icon: '⚡', cost: 360, role: 'damage', range: 26, rate: 0.5, dmg: 60, pierceLine: 0,
    sfx: 'td_rail', vfx: 'rail',
    paths: [
      [{ name: 'PENETRATOR', cost: 210, mod: { pierceLine: 3 } },
       { name: 'LANCE SHOT', cost: 400, mod: { pierceLine: 99, dmg: +30 } },
       { name: 'ORBITAL SPIKE', cost: 860, mod: { dmg: +120 } }],
      [{ name: 'CONCUSSIVE SLUG', cost: 200, mod: { stunS: 0.6 } },
       { name: 'SHOCK PAYLOAD', cost: 380, mod: { stunS: 1.2, splash: 3 } },
       { name: 'THUNDERHEAD', cost: 800, mod: { stunS: 2, splash: 5, dmg: +40 } }],
    ] },
  { id: 'mortar', name: 'MORTAR POST', icon: '💥', cost: 300, role: 'damage', range: 30, rate: 0.45, dmg: 30, splash: 4,
    sfx: 'td_mortar', vfx: 'mortar',
    paths: [
      [{ name: 'NAPALM SHELLS', cost: 230, mod: { burnDps: 8, burnS: 3 } },
       { name: 'WHITE PHOSPHOR', cost: 430, mod: { burnDps: 16, burnS: 4 } },
       { name: 'FIRESTORM', cost: 860, mod: { splash: +3, burnDps: +14 } }],
      [{ name: 'CLUSTER BOMBS', cost: 240, mod: { cluster: 3 } },
       { name: 'CARPET LOAD', cost: 460, mod: { cluster: 6, dmg: +10 } },
       { name: 'MIRV', cost: 940, mod: { cluster: 9, splash: +2 } }],
    ] },
  { id: 'tesla', name: 'TESLA PYLON', icon: '🌩️', cost: 250, role: 'damage', range: 11, rate: 1.1, dmg: 14, chain: 2,
    sfx: 'td_tesla', vfx: 'chain',
    paths: [
      [{ name: 'ARC LATTICE', cost: 180, mod: { chain: +2 } },
       { name: 'STORM COIL', cost: 350, mod: { chain: +3, dmg: +8 } },
       { name: 'TEMPEST NODE', cost: 740, mod: { chain: +4, range: +4, dmg: +12 } }],
      [{ name: 'STATIC FORKS', cost: 190, mod: { stunS: 0.35 } },
       { name: 'NEURAL SHOCK', cost: 360, mod: { stunS: 0.7, dmg: +6 } },
       { name: 'PARALYSIS FIELD', cost: 760, mod: { stunS: 1.1, chain: +2 } }],
    ] },
  { id: 'cryo', name: 'CRYO EMITTER', icon: '❄️', cost: 210, role: 'debuff', range: 9, rate: 0, aura: true, slow: 0.35,
    sfx: 'td_cryo', vfx: 'frost',
    paths: [
      [{ name: 'DEEP CHILL', cost: 160, mod: { slow: 0.5 } },
       { name: 'FLASH FREEZE', cost: 350, mod: { freezeS: 1.2, freezeEvery: 6 } },
       { name: 'ABSOLUTE ZERO', cost: 720, mod: { slow: 0.65, freezeS: 2 } }],
      [{ name: 'BRITTLE FROST', cost: 170, mod: { vulnMult: 1.2 } },
       { name: 'SHATTERPOINT', cost: 370, mod: { vulnMult: 1.4 } },
       { name: 'GLASS CURSE', cost: 740, mod: { vulnMult: 1.7, range: +3 } }],
    ] },
  { id: 'acid', name: 'ACID SPRAYER', icon: '🧪', cost: 230, role: 'debuff', range: 10, rate: 0.9, dmg: 4, acidDps: 6, acidS: 3,
    sfx: 'td_acid', vfx: 'acid',
    paths: [
      [{ name: 'CORROSIVE POOLS', cost: 180, mod: { poolS: 2.5 } },
       { name: 'MELTDOWN MIX', cost: 370, mod: { acidDps: +8, poolS: 4 } },
       { name: 'DISSOLVER', cost: 740, mod: { acidDps: +14, armorStrip: 1 } }],
      [{ name: 'ENFEEBLING FUMES', cost: 190, mod: { slow: 0.2 } },
       { name: 'NERVE AGENT', cost: 380, mod: { slow: 0.35, acidS: +2 } },
       { name: 'PLAGUE CLOUD', cost: 760, mod: { range: +4, acidDps: +10 } }],
    ] },
  { id: 'hive', name: 'HIVE DRONE BAY', icon: '🐝', cost: 330, role: 'damage', range: 18, rate: 0.8, dmg: 9, drones: 2,
    sfx: 'td_hive', vfx: 'drone',
    paths: [
      [{ name: 'SWARM DOCTRINE', cost: 220, mod: { drones: +2 } },
       { name: 'QUEEN PROTOCOL', cost: 440, mod: { drones: +3, dmg: +4 } },
       { name: 'LOCUST CLOUD', cost: 900, mod: { drones: +4, rate: +0.5 } }],
      [{ name: 'KAMIKAZE CELLS', cost: 240, mod: { boomDmg: 24, splash: 2 } },
       { name: 'THERMITE PAYLOAD', cost: 450, mod: { boomDmg: 48, burnDps: 8, burnS: 2 } },
       { name: 'NOVA DRONES', cost: 920, mod: { boomDmg: 90, splash: +2 } }],
    ] },
  { id: 'sniper', name: 'SNIPER NEST', icon: '🎯', cost: 280, role: 'damage', range: 60, rate: 0.4, dmg: 45, targeting: 'strong',
    sfx: 'td_sniper', vfx: 'rail',
    paths: [
      [{ name: 'HEADHUNTER', cost: 210, mod: { critChance: 0.25, critMult: 2.5 } },
       { name: 'DEADEYE', cost: 430, mod: { critChance: 0.45, dmg: +25 } },
       { name: 'ONE SHOT PROTOCOL', cost: 920, mod: { critMult: 5, rate: +0.15 } }],
      [{ name: 'SPOTTER SCOPE', cost: 200, mod: { markMult: 1.25, markS: 3 } },
       { name: 'MARKED FOR DEATH', cost: 400, mod: { markMult: 1.5, markS: 5 } },
       { name: 'DEATH SENTENCE', cost: 820, mod: { markMult: 1.8, range: +15 } }],
    ] },
  { id: 'banner', name: 'WAR BANNER', icon: '🚩', cost: 220, role: 'buff', range: 10, aura: true, buffDmg: 1.2,
    sfx: 'td_banner', vfx: 'aura_buff',
    paths: [
      [{ name: 'BATTLE FERVOR', cost: 190, mod: { buffRate: 1.15 } },
       { name: 'BLOODLUST', cost: 370, mod: { buffRate: 1.3, buffDmg: +0.1 } },
       { name: 'WARCRY ETERNAL', cost: 740, mod: { buffDmg: +0.25, buffRate: +0.1 } }],
      [{ name: 'WARHORN', cost: 170, mod: { range: +4 } },
       { name: 'RALLYING CALL', cost: 350, mod: { range: +4, buffDmg: +0.1 } },
       { name: 'LEGION STANDARD', cost: 720, mod: { range: +6, buffDmg: +0.15 } }],
    ] },
  { id: 'overclocker', name: 'OVERCLOCKER', icon: '⚙️', cost: 290, role: 'buff', range: 9, aura: true, buffRate: 1.25,
    sfx: 'td_overclock', vfx: 'aura_buff',
    paths: [
      [{ name: 'SURGE CYCLES', cost: 220, mod: { surgeMult: 2, surgeEvery: 10, surgeS: 3 } },
       { name: 'REDLINE', cost: 440, mod: { surgeMult: 2.6, surgeS: 4 } },
       { name: 'SINGULARITY CLOCK', cost: 880, mod: { buffRate: +0.35 } }],
      [{ name: 'EFFICIENCY GRID', cost: 200, mod: { range: +4 } },
       { name: 'POWER MESH', cost: 400, mod: { range: +4, buffRate: +0.15 } },
       { name: 'CITY GRID', cost: 820, mod: { range: +7 } }],
    ] },
  { id: 'depot', name: 'AMMO DEPOT', icon: '📦', cost: 200, role: 'buff', range: 11, aura: true, playerResupply: true,
    sfx: 'td_depot', vfx: 'aura_buff',
    paths: [
      [{ name: 'HOLLOWPOINTS', cost: 180, mod: { critChance: 0.1, critMult: 1.8, auraCrit: true } },
       { name: 'MATCH-GRADE', cost: 350, mod: { critChance: 0.2, auraCrit: true } },
       { name: 'EXPERIMENTAL LOADS', cost: 720, mod: { critChance: 0.3, critMult: 2.4, auraCrit: true } }],
      [{ name: 'COMBAT STIMS', cost: 190, mod: { playerDmgMult: 1.2 } },
       { name: 'FIELD LAB', cost: 370, mod: { playerDmgMult: 1.35 } },
       { name: 'SUPER SOLDIER RIG', cost: 740, mod: { playerDmgMult: 1.6, range: +3 } }],
    ] },
  { id: 'shieldgen', name: 'SHIELD GENERATOR', icon: '🛡️', cost: 320, role: 'buff', range: 12, aura: true, coreShield: 20,
    sfx: 'td_shield', vfx: 'aura_shield',
    paths: [
      [{ name: 'CORE WEAVE', cost: 240, mod: { coreRegen: 1 } },
       { name: 'AEGIS LOOP', cost: 460, mod: { coreRegen: 2, coreShield: +20 } },
       { name: 'SANCTUARY', cost: 900, mod: { coreRegen: 4, coreShield: +40 } }],
      [{ name: 'REPULSOR BUBBLE', cost: 250, mod: { pulsePush: 6, pulseEvery: 5 } },
       { name: 'KINETIC BASTION', cost: 480, mod: { pulsePush: 10, pulseSlow: 0.3 } },
       { name: 'EVENT HORIZON', cost: 940, mod: { pulsePush: 14, pulseEvery: -1.5 } }],
    ] },
  { id: 'gravwell', name: 'GRAVITY WELL', icon: '🌀', cost: 260, role: 'debuff', range: 8, aura: true, slow: 0.25, pull: 2,
    sfx: 'td_grav', vfx: 'aura_grav',
    paths: [
      [{ name: 'CRUSH FIELD', cost: 210, mod: { auraDps: 5 } },
       { name: 'IMPLOSION LENS', cost: 410, mod: { auraDps: 11, pull: +2 } },
       { name: 'NEUTRON HEART', cost: 860, mod: { auraDps: 20, slow: 0.4 } }],
      [{ name: 'WIDE HORIZON', cost: 200, mod: { range: +3 } },
       { name: 'DEEP FIELD', cost: 390, mod: { range: +3, pull: +2 } },
       { name: 'GALACTIC DRAG', cost: 800, mod: { range: +5, slow: 0.45 } }],
    ] },
  { id: 'bounty', name: 'BOUNTY BEACON', icon: '💰', cost: 250, role: 'economy', range: 12, aura: true, goldMult: 1.2,
    sfx: 'td_bounty', vfx: 'aura_gold',
    paths: [
      [{ name: 'COMPOUND INTEREST', cost: 230, mod: { interest: 0.03 } },
       { name: 'WAR PROFITEER', cost: 440, mod: { interest: 0.05, goldMult: +0.1 } },
       { name: 'GOLD RUSH', cost: 880, mod: { interest: 0.07, waveBonus: 40 } }],
      [{ name: 'KILLSTREAK LEDGER', cost: 210, mod: { streakGold: 2 } },
       { name: 'JACKPOT PROTOCOL', cost: 420, mod: { streakGold: 4, goldMult: +0.1 } },
       { name: 'MIDAS ARRAY', cost: 860, mod: { goldMult: +0.25, range: +4 } }],
    ] },
  { id: 'plasma', name: 'PLASMA LANCE', icon: '🔆', cost: 380, role: 'damage', range: 16, rate: 0, beamDps: 18, rampMult: 2.5, rampS: 3,
    sfx: 'td_plasma', vfx: 'beam',
    paths: [
      [{ name: 'MELT-THROUGH', cost: 260, mod: { armorPierce: 1, beamDps: +8 } },
       { name: 'SUNBORE', cost: 500, mod: { beamDps: +16, rampMult: +1 } },
       { name: 'STARKILLER', cost: 1000, mod: { beamDps: +30, rampS: -1 } }],
      [{ name: 'SPLIT BEAM', cost: 280, mod: { beams: 2 } },
       { name: 'PRISM ARRAY', cost: 520, mod: { beams: 3 } },
       { name: 'SOLAR CHOIR', cost: 1040, mod: { beams: 4, beamDps: +10 } }],
    ] },
];
export const UNIT_BY_ID = Object.fromEntries(UNIT_DEFS.map((d) => [d.id, d]));

// BTD-style lockout: a path at tier ≥2 caps the other at tier 1.
export function canUpgrade(tiers, pathIdx) {
  const mine = tiers[pathIdx], other = tiers[1 - pathIdx];
  if (mine >= 3) return false;
  if (other >= 2 && mine >= 1) return false;
  return true;
}

// stat merge convention: DELTA keys accumulate; other numerics are absolute.
export const DELTA_KEYS = new Set(['dmg', 'rate', 'range', 'chain', 'splash', 'drones', 'beamDps', 'burnDps', 'acidDps', 'goldMult', 'buffDmg', 'buffRate', 'coreShield', 'coreRegen', 'pull', 'rampMult', 'rampS', 'pulseEvery']);
export function applyMods(stats, mod) {
  for (const [k, v] of Object.entries(mod)) {
    if (typeof v !== 'number') { stats[k] = v; continue; }
    if (DELTA_KEYS.has(k)) stats[k] = (stats[k] ?? 0) + v;
    else stats[k] = v;
  }
  return stats;
}

// ---------------------------------------------------------------------------
// TD LOADOUT — start with the PISTOL only; buy guns at the ARMORY (E). You can
// hold at most TWO guns; buying a third replaces one you choose. Every gun has
// its own two-path upgrade tree (same lockout rule as towers): client applies
// handling mods (rpm/mag/reload/spread), the server applies dmgMult to shots.
// ---------------------------------------------------------------------------
export const TD_MAX_GUNS = 2;
export const TD_SHOP = [
  { id: 'smg',      cost: 320 },
  { id: 'shotgun',  cost: 480 },
  { id: 'revolver', cost: 540 },
  { id: 'ar',       cost: 650 },
  { id: 'burst',    cost: 760 },
  { id: 'dmr',      cost: 820 },
  { id: 'sniper',   cost: 1150 },
  { id: 'arclance', cost: 1500 },
];

// per-gun trees. mod keys: dmgMult (SERVER) · rpmMult/magMult/reloadMult/spreadMult (CLIENT)
const T = (name, cost, mod) => ({ name, cost, mod });
export const WEAPON_TREES = {
  pistol: { paths: [
    [T('MATCH TRIGGER', 140, { rpmMult: 1.15 }), T('COMPETITION SLIDE', 280, { rpmMult: 1.3, spreadMult: 0.85 }), T('MACHINE PISTOL', 560, { rpmMult: 1.6, magMult: 1.5 })],
    [T('+P ROUNDS', 150, { dmgMult: 1.25 }), T('OVERPRESSURE', 300, { dmgMult: 1.5 }), T('HAND CANNON', 600, { dmgMult: 1.9 })],
  ] },
  smg: { paths: [
    [T('LIGHT BOLT', 180, { rpmMult: 1.15 }), T('CYCLONE ACTION', 360, { rpmMult: 1.35 }), T('BUZZSAW', 720, { rpmMult: 1.6, magMult: 1.4 })],
    [T('HOT LOADS', 190, { dmgMult: 1.25 }), T('SHREDDER AMMO', 380, { dmgMult: 1.5 }), T('ROOM CLEARER', 760, { dmgMult: 1.85, spreadMult: 0.85 })],
  ] },
  shotgun: { paths: [
    [T('CHOKE BORE', 200, { spreadMult: 0.8 }), T('FLECHETTES', 400, { spreadMult: 0.65, dmgMult: 1.2 }), T('SLUG STORM', 800, { dmgMult: 1.6 })],
    [T('SPEED PUMP', 210, { rpmMult: 1.25 }), T('DOUBLE FEED', 420, { rpmMult: 1.45, magMult: 1.35 }), T('AUTO SCATTER', 840, { rpmMult: 1.8 })],
  ] },
  revolver: { paths: [
    [T('LONG BARREL', 200, { dmgMult: 1.25 }), T('MAGNUM FRAME', 400, { dmgMult: 1.55 }), T('JUDGEMENT', 820, { dmgMult: 2.1 })],
    [T('SPEED LOADER', 190, { reloadMult: 0.75 }), T('FANNING HAMMER', 380, { rpmMult: 1.4 }), T('DEAD EYE', 780, { rpmMult: 1.6, spreadMult: 0.7 })],
  ] },
  ar: { paths: [
    [T('HEAVY BARREL', 220, { dmgMult: 1.25 }), T('MARKSMAN CORE', 440, { dmgMult: 1.5, spreadMult: 0.85 }), T('WAR RIFLE', 880, { dmgMult: 1.9 })],
    [T('GAS TUNE', 230, { rpmMult: 1.2 }), T('DRUM MAG', 460, { magMult: 1.6 }), T('SUPPRESSION DOCTRINE', 900, { rpmMult: 1.45, magMult: 1.4 })],
  ] },
  burst: { paths: [
    [T('TIGHT COUPLING', 240, { spreadMult: 0.8 }), T('FOUR-ROUND SEAR', 480, { dmgMult: 1.3 }), T('EXECUTIONER', 940, { dmgMult: 1.75 })],
    [T('QUICK RESET', 240, { rpmMult: 1.25 }), T('HYPERBURST', 480, { rpmMult: 1.5 }), T('DEATH TAP', 960, { rpmMult: 1.8, magMult: 1.3 })],
  ] },
  dmr: { paths: [
    [T('MATCH AMMO', 250, { dmgMult: 1.3 }), T('AP CORE', 500, { dmgMult: 1.6 }), T('ANTI-MATERIEL', 1000, { dmgMult: 2.1 })],
    [T('LIGHT BOLT', 250, { rpmMult: 1.25 }), T('RECOIL SYSTEM', 500, { rpmMult: 1.45, spreadMult: 0.8 }), T('BATTLE RHYTHM', 980, { rpmMult: 1.7 })],
  ] },
  sniper: { paths: [
    [T('HARDENED SPIKES', 300, { dmgMult: 1.3 }), T('COIL AMPLIFIER', 600, { dmgMult: 1.7 }), T('GODSLAYER', 1200, { dmgMult: 2.4 })],
    [T('FAST CYCLING', 300, { rpmMult: 1.3 }), T('DUAL RAILS', 600, { rpmMult: 1.55 }), T('STORM OF SPIKES', 1180, { rpmMult: 1.9, magMult: 1.6 })],
  ] },
  arclance: { paths: [
    [T('FOCUS CRYSTAL', 340, { dmgMult: 1.3 }), T('OVERCHARGE CELLS', 680, { dmgMult: 1.65 }), T('SUNLANCE', 1350, { dmgMult: 2.1 })],
    [T('COOLANT LOOP', 340, { rpmMult: 1.2, magMult: 1.3 }), T('TWIN EMITTERS', 680, { rpmMult: 1.45 }), T('INFINITE BEAM', 1350, { magMult: 2, rpmMult: 1.6 })],
  ] },
};

// player self-upgrades (unchanged tracks, pricier)
export const PLAYER_UPGRADES = [
  { id: 'pdmg',   name: 'WEAPON DAMAGE', icon: '🗡️', tiers: 5, cost: (t) => 180 + t * 160, per: '+12% damage', mult: 0.12 },
  { id: 'pspeed', name: 'MOBILITY',      icon: '👟', tiers: 5, cost: (t) => 150 + t * 130, per: '+7% speed',   mult: 0.07 },
  { id: 'phealth', name: 'PLATING',      icon: '❤️', tiers: 5, cost: (t) => 160 + t * 150, per: '+20 max hp',  flat: 20 },
];
