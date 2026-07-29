// TOWER DEFENSE — data.js: every unit / enemy / wave / player-upgrade definition.
// Pure data (THREE-free). 15 units (damage / buff / debuff / economy), each with
// TWO branching upgrade paths × 3 tiers, BTD-style LOCKOUT: taking tier 2+ in one
// path caps the other at tier 1. Upgrades change stats AND visuals (builders read
// tier levels). Enemies: the ZOMBIE family (ground shamblers) and ALIEN family
// (glowy skitterers/flyers) — brand-new code-built models, never player rigs.

// ---------------------------------------------------------------------------
// UNITS. def: { id, name, icon, cost, role: 'damage'|'buff'|'debuff'|'economy',
//   range, rate (attacks/s), dmg, splash?, aura?, special...,
//   paths: [ [t1,t2,t3], [t1,t2,t3] ] } — upgrade: { name, cost, mod:{...} }
// mods merge onto the unit's live stats; special keys handled in Units.js.
// ---------------------------------------------------------------------------
export const UNIT_DEFS = [
  { id: 'gatling', name: 'GATLING TURRET', icon: '🔫', cost: 120, role: 'damage', range: 14, rate: 3.2, dmg: 6,
    paths: [
      [{ name: 'RIFLED BARRELS', cost: 90, mod: { dmg: +4 } },
       { name: 'SPIN-UP MOTOR', cost: 180, mod: { rate: +2.4 } },
       { name: 'MINIGUN ARRAY', cost: 420, mod: { rate: +4, dmg: +4 } }],
      [{ name: 'AP ROUNDS', cost: 100, mod: { armorPierce: 0.5 } },
       { name: 'TUNGSTEN CORE', cost: 220, mod: { dmg: +10, armorPierce: 1 } },
       { name: 'RAIL-GATLING', cost: 480, mod: { dmg: +18, range: +4 } }],
    ] },
  { id: 'railcannon', name: 'RAILCANNON', icon: '⚡', cost: 260, role: 'damage', range: 26, rate: 0.5, dmg: 60, pierceLine: 0,
    paths: [
      [{ name: 'PENETRATOR', cost: 160, mod: { pierceLine: 3 } },
       { name: 'LANCE SHOT', cost: 300, mod: { pierceLine: 99, dmg: +30 } },
       { name: 'ORBITAL SPIKE', cost: 650, mod: { dmg: +120 } }],
      [{ name: 'CONCUSSIVE SLUG', cost: 150, mod: { stunS: 0.6 } },
       { name: 'SHOCK PAYLOAD', cost: 280, mod: { stunS: 1.2, splash: 3 } },
       { name: 'THUNDERHEAD', cost: 600, mod: { stunS: 2, splash: 5, dmg: +40 } }],
    ] },
  { id: 'mortar', name: 'MORTAR POST', icon: '💥', cost: 220, role: 'damage', range: 30, rate: 0.45, dmg: 30, splash: 4,
    paths: [
      [{ name: 'NAPALM SHELLS', cost: 170, mod: { burnDps: 8, burnS: 3 } },
       { name: 'WHITE PHOSPHOR', cost: 320, mod: { burnDps: 16, burnS: 4 } },
       { name: 'FIRESTORM', cost: 640, mod: { splash: +3, burnDps: +14 } }],
      [{ name: 'CLUSTER BOMBS', cost: 180, mod: { cluster: 3 } },
       { name: 'CARPET LOAD', cost: 340, mod: { cluster: 6, dmg: +10 } },
       { name: 'MIRV', cost: 700, mod: { cluster: 9, splash: +2 } }],
    ] },
  { id: 'tesla', name: 'TESLA PYLON', icon: '🌩️', cost: 180, role: 'damage', range: 11, rate: 1.1, dmg: 14, chain: 2,
    paths: [
      [{ name: 'ARC LATTICE', cost: 130, mod: { chain: +2 } },
       { name: 'STORM COIL', cost: 260, mod: { chain: +3, dmg: +8 } },
       { name: 'TEMPEST NODE', cost: 560, mod: { chain: +4, range: +4, dmg: +12 } }],
      [{ name: 'STATIC FORKS', cost: 140, mod: { stunS: 0.35 } },
       { name: 'NEURAL SHOCK', cost: 270, mod: { stunS: 0.7, dmg: +6 } },
       { name: 'PARALYSIS FIELD', cost: 580, mod: { stunS: 1.1, chain: +2 } }],
    ] },
  { id: 'cryo', name: 'CRYO EMITTER', icon: '❄️', cost: 150, role: 'debuff', range: 9, rate: 0, aura: true, slow: 0.35,
    paths: [
      [{ name: 'DEEP CHILL', cost: 120, mod: { slow: 0.5 } },
       { name: 'FLASH FREEZE', cost: 260, mod: { freezeS: 1.2, freezeEvery: 6 } },
       { name: 'ABSOLUTE ZERO', cost: 540, mod: { slow: 0.65, freezeS: 2 } }],
      [{ name: 'BRITTLE FROST', cost: 130, mod: { vulnMult: 1.2 } },
       { name: 'SHATTERPOINT', cost: 280, mod: { vulnMult: 1.4 } },
       { name: 'GLASS CURSE', cost: 560, mod: { vulnMult: 1.7, range: +3 } }],
    ] },
  { id: 'acid', name: 'ACID SPRAYER', icon: '🧪', cost: 170, role: 'debuff', range: 10, rate: 0.9, dmg: 4, acidDps: 6, acidS: 3,
    paths: [
      [{ name: 'CORROSIVE POOLS', cost: 140, mod: { poolS: 2.5 } },
       { name: 'MELTDOWN MIX', cost: 280, mod: { acidDps: +8, poolS: 4 } },
       { name: 'DISSOLVER', cost: 560, mod: { acidDps: +14, armorStrip: 1 } }],
      [{ name: 'ENFEEBLING FUMES', cost: 150, mod: { slow: 0.2 } },
       { name: 'NERVE AGENT', cost: 290, mod: { slow: 0.35, acidS: +2 } },
       { name: 'PLAGUE CLOUD', cost: 580, mod: { range: +4, acidDps: +10 } }],
    ] },
  { id: 'hive', name: 'HIVE DRONE BAY', icon: '🐝', cost: 240, role: 'damage', range: 18, rate: 0.8, dmg: 9, drones: 2,
    paths: [
      [{ name: 'SWARM DOCTRINE', cost: 170, mod: { drones: +2 } },
       { name: 'QUEEN PROTOCOL', cost: 330, mod: { drones: +3, dmg: +4 } },
       { name: 'LOCUST CLOUD', cost: 680, mod: { drones: +4, rate: +0.5 } }],
      [{ name: 'KAMIKAZE CELLS', cost: 180, mod: { boomDmg: 24, splash: 2 } },
       { name: 'THERMITE PAYLOAD', cost: 340, mod: { boomDmg: 48, burnDps: 8, burnS: 2 } },
       { name: 'NOVA DRONES', cost: 700, mod: { boomDmg: 90, splash: +2 } }],
    ] },
  { id: 'sniper', name: 'SNIPER NEST', icon: '🎯', cost: 200, role: 'damage', range: 60, rate: 0.4, dmg: 45, targeting: 'strong',
    paths: [
      [{ name: 'HEADHUNTER', cost: 160, mod: { critChance: 0.25, critMult: 2.5 } },
       { name: 'DEADEYE', cost: 320, mod: { critChance: 0.45, dmg: +25 } },
       { name: 'ONE SHOT PROTOCOL', cost: 700, mod: { critMult: 5, rate: +0.15 } }],
      [{ name: 'SPOTTER SCOPE', cost: 150, mod: { markMult: 1.25, markS: 3 } },
       { name: 'MARKED FOR DEATH', cost: 300, mod: { markMult: 1.5, markS: 5 } },
       { name: 'DEATH SENTENCE', cost: 620, mod: { markMult: 1.8, range: +15 } }],
    ] },
  { id: 'banner', name: 'WAR BANNER', icon: '🚩', cost: 160, role: 'buff', range: 10, aura: true, buffDmg: 1.2,
    paths: [
      [{ name: 'BATTLE FERVOR', cost: 140, mod: { buffRate: 1.15 } },
       { name: 'BLOODLUST', cost: 280, mod: { buffRate: 1.3, buffDmg: +0.1 } },
       { name: 'WARCRY ETERNAL', cost: 560, mod: { buffDmg: +0.25, buffRate: +0.1 } }],
      [{ name: 'WARHORN', cost: 130, mod: { range: +4 } },
       { name: 'RALLYING CALL', cost: 260, mod: { range: +4, buffDmg: +0.1 } },
       { name: 'LEGION STANDARD', cost: 540, mod: { range: +6, buffDmg: +0.15 } }],
    ] },
  { id: 'overclocker', name: 'OVERCLOCKER', icon: '⚙️', cost: 210, role: 'buff', range: 9, aura: true, buffRate: 1.25,
    paths: [
      [{ name: 'SURGE CYCLES', cost: 170, mod: { surgeMult: 2, surgeEvery: 10, surgeS: 3 } },
       { name: 'REDLINE', cost: 330, mod: { surgeMult: 2.6, surgeS: 4 } },
       { name: 'SINGULARITY CLOCK', cost: 660, mod: { buffRate: +0.35 } }],
      [{ name: 'EFFICIENCY GRID', cost: 150, mod: { range: +4 } },
       { name: 'POWER MESH', cost: 300, mod: { range: +4, buffRate: +0.15 } },
       { name: 'CITY GRID', cost: 620, mod: { range: +7 } }],
    ] },
  { id: 'depot', name: 'AMMO DEPOT', icon: '📦', cost: 140, role: 'buff', range: 11, aura: true, playerResupply: true,
    paths: [
      [{ name: 'HOLLOWPOINTS', cost: 130, mod: { critChance: 0.1, critMult: 1.8, auraCrit: true } },
       { name: 'MATCH-GRADE', cost: 260, mod: { critChance: 0.2, auraCrit: true } },
       { name: 'EXPERIMENTAL LOADS', cost: 540, mod: { critChance: 0.3, critMult: 2.4, auraCrit: true } }],
      [{ name: 'COMBAT STIMS', cost: 140, mod: { playerDmgMult: 1.2 } },
       { name: 'FIELD LAB', cost: 280, mod: { playerDmgMult: 1.35 } },
       { name: 'SUPER SOLDIER RIG', cost: 560, mod: { playerDmgMult: 1.6, range: +3 } }],
    ] },
  { id: 'shieldgen', name: 'SHIELD GENERATOR', icon: '🛡️', cost: 230, role: 'buff', range: 12, aura: true, coreShield: 20,
    paths: [
      [{ name: 'CORE WEAVE', cost: 180, mod: { coreRegen: 1 } },
       { name: 'AEGIS LOOP', cost: 340, mod: { coreRegen: 2, coreShield: +20 } },
       { name: 'SANCTUARY', cost: 680, mod: { coreRegen: 4, coreShield: +40 } }],
      [{ name: 'REPULSOR BUBBLE', cost: 190, mod: { pulsePush: 6, pulseEvery: 5 } },
       { name: 'KINETIC BASTION', cost: 360, mod: { pulsePush: 10, pulseSlow: 0.3 } },
       { name: 'EVENT HORIZON', cost: 700, mod: { pulsePush: 14, pulseEvery: -1.5 } }],
    ] },
  { id: 'gravwell', name: 'GRAVITY WELL', icon: '🌀', cost: 190, role: 'debuff', range: 8, aura: true, slow: 0.25, pull: 2,
    paths: [
      [{ name: 'CRUSH FIELD', cost: 160, mod: { auraDps: 5 } },
       { name: 'IMPLOSION LENS', cost: 310, mod: { auraDps: 11, pull: +2 } },
       { name: 'NEUTRON HEART', cost: 640, mod: { auraDps: 20, slow: 0.4 } }],
      [{ name: 'WIDE HORIZON', cost: 150, mod: { range: +3 } },
       { name: 'DEEP FIELD', cost: 290, mod: { range: +3, pull: +2 } },
       { name: 'GALACTIC DRAG', cost: 600, mod: { range: +5, slow: 0.45 } }],
    ] },
  { id: 'bounty', name: 'BOUNTY BEACON', icon: '💰', cost: 180, role: 'economy', range: 12, aura: true, goldMult: 1.25,
    paths: [
      [{ name: 'COMPOUND INTEREST', cost: 170, mod: { interest: 0.04 } },
       { name: 'WAR PROFITEER', cost: 330, mod: { interest: 0.07, goldMult: +0.1 } },
       { name: 'GOLD RUSH', cost: 650, mod: { interest: 0.1, waveBonus: 60 } }],
      [{ name: 'KILLSTREAK LEDGER', cost: 160, mod: { streakGold: 2 } },
       { name: 'JACKPOT PROTOCOL', cost: 320, mod: { streakGold: 4, goldMult: +0.15 } },
       { name: 'MIDAS ARRAY', cost: 640, mod: { goldMult: +0.35, range: +4 } }],
    ] },
  { id: 'plasma', name: 'PLASMA LANCE', icon: '🔆', cost: 280, role: 'damage', range: 16, rate: 0, beamDps: 18, rampMult: 2.5, rampS: 3,
    paths: [
      [{ name: 'MELT-THROUGH', cost: 200, mod: { armorPierce: 1, beamDps: +8 } },
       { name: 'SUNBORE', cost: 380, mod: { beamDps: +16, rampMult: +1 } },
       { name: 'STARKILLER', cost: 760, mod: { beamDps: +30, rampS: -1 } }],
      [{ name: 'SPLIT BEAM', cost: 210, mod: { beams: 2 } },
       { name: 'PRISM ARRAY', cost: 400, mod: { beams: 3 } },
       { name: 'SOLAR CHOIR', cost: 780, mod: { beams: 4, beamDps: +10 } }],
    ] },
];

// BTD-style lockout: path X at tier>=2 caps path Y at tier 1.
export function canUpgrade(unit, pathIdx) {
  const mine = unit.tiers[pathIdx], other = unit.tiers[1 - pathIdx];
  if (mine >= 3) return false;
  if (other >= 2 && mine >= 1) return false; // other path committed → this one capped at 1
  return true;
}

// ---------------------------------------------------------------------------
// ENEMIES — family 'zombie' | 'alien'. speed m/s, hp base (scales per wave),
// armor (flat reduction), coreDmg (leak damage), bounty (gold), special flags.
// ---------------------------------------------------------------------------
export const ENEMY_DEFS = {
  shambler:  { family: 'zombie', name: 'SHAMBLER',   hp: 60,  speed: 1.6, armor: 0, coreDmg: 4,  bounty: 6,  size: 1.0 },
  sprinter:  { family: 'zombie', name: 'SPRINTER',   hp: 34,  speed: 3.6, armor: 0, coreDmg: 3,  bounty: 7,  size: 0.85 },
  brute:     { family: 'zombie', name: 'BRUTE',      hp: 320, speed: 1.1, armor: 4, coreDmg: 12, bounty: 25, size: 1.5 },
  bloater:   { family: 'zombie', name: 'BLOATER',    hp: 130, speed: 1.3, armor: 0, coreDmg: 8,  bounty: 14, size: 1.25, boomOnDeath: 3 },
  screamer:  { family: 'zombie', name: 'SCREAMER',   hp: 80,  speed: 2.0, armor: 0, coreDmg: 4,  bounty: 16, size: 0.95, hasteAura: 1.3, hasteR: 6 },
  drone:     { family: 'alien',  name: 'DRONE',      hp: 45,  speed: 2.6, armor: 0, coreDmg: 3,  bounty: 8,  size: 0.8, fly: 2.2 },
  skitterer: { family: 'alien',  name: 'SKITTERER',  hp: 26,  speed: 4.4, armor: 0, coreDmg: 2,  bounty: 6,  size: 0.7, jitter: 1.4 },
  warden:    { family: 'alien',  name: 'WARDEN',     hp: 180, speed: 1.7, armor: 2, coreDmg: 9,  bounty: 22, size: 1.3, shield: 90, shieldRegen: 12 },
  stalker:   { family: 'alien',  name: 'PHASE STALKER', hp: 110, speed: 2.8, armor: 0, coreDmg: 6, bounty: 20, size: 1.0, phaseS: 1.2, phaseEvery: 3.5 },
  queen:     { family: 'alien',  name: 'HIVE QUEEN', hp: 2600, speed: 0.9, armor: 6, coreDmg: 60, bounty: 260, size: 2.4, fly: 1.4, spawns: 'skitterer', spawnEvery: 4 },
};

// wave composer: scaling counts + hp multiplier; boss every 10, minibosses every 5.
export function composeWave(n) {
  const hpMult = 1 + (n - 1) * 0.16 + Math.pow(Math.max(0, n - 10), 1.35) * 0.02;
  const mix = [];
  const add = (id, count, gapS = 0.9) => mix.push({ id, count: Math.max(1, Math.round(count)), gapS });
  if (n % 10 === 0) { add('queen', 1 + Math.floor(n / 20), 2); add('warden', n / 4, 1.4); add('skitterer', n, 0.35); }
  else if (n % 5 === 0) { add('brute', 1 + n / 5, 2.2); add('bloater', n / 3, 1.4); add('sprinter', n / 1.5, 0.5); }
  else {
    add('shambler', 4 + n * 1.4, 0.8);
    if (n >= 2) add('sprinter', n * 0.9, 0.55);
    if (n >= 3) add('skitterer', n * 0.8, 0.4);
    if (n >= 4) add('drone', n * 0.6, 0.9);
    if (n >= 6) add('screamer', n / 4, 2);
    if (n >= 7) add('stalker', n / 4, 1.6);
    if (n >= 8) add('warden', n / 6, 2.4);
    if (n >= 9) add('bloater', n / 4, 1.8);
  }
  return { hpMult, mix, bonus: 40 + n * 12 };
}

// ---------------------------------------------------------------------------
// PLAYER self-upgrades (spend gold on yourself between waves).
// ---------------------------------------------------------------------------
export const PLAYER_UPGRADES = [
  { id: 'pdmg',  name: 'WEAPON DAMAGE', icon: '🗡️', tiers: 5, cost: (t) => 120 + t * 110, per: '+15% damage',  mult: 0.15 },
  { id: 'pspeed', name: 'MOBILITY',     icon: '👟', tiers: 5, cost: (t) => 100 + t * 90,  per: '+8% speed',    mult: 0.08 },
  { id: 'phealth', name: 'PLATING',     icon: '❤️', tiers: 5, cost: (t) => 110 + t * 100, per: '+20 max hp',   flat: 20 },
];
