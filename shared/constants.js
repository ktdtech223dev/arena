// ARENA — shared constants. Dependency-free, THREE-free, imported by BOTH the
// browser client (via Vite) and the headless Node server. Plain data only.
// This is the SINGLE SOURCE for tick rates, movement/capsule tuning, crew
// identities, and the arena collider + spawn data (so client render and server
// sim use identical collision). See ARENA-ARCHITECTURE.md.

// ---- netcode timing --------------------------------------------------------
export const TICK_RATE = 128;       // server authoritative Hz
export const SNAP_RATE = 128;       // snapshots/sec (per client)
export const INPUT_RATE = 60;       // client input frames/sec
export const INTERP_DELAY_MS = 100; // render remotes this far in the past
export const EXTRAP_MAX_MS = 120;   // cap dead-reckoning when a snap is late
export const HISTORY_MS = 1000;     // per-player position history for lag comp
export const RESPAWN_MS = 2500;     // respawn delay after death
export const MAX_PLAYERS = 6;

export const SERVER_DT = 1 / TICK_RATE;   // seconds per server tick
export const INPUT_DT_MS = 1000 / INPUT_RATE;

// input button bitmask (InputCmd.buttons)
export const BTN = { JUMP: 1, CROUCH: 2, SPRINT: 4 };

// ---- capsule / eye ---------------------------------------------------------
export const CAPSULE = {
  radius: 0.35,
  standHeight: 1.8,
  crouchHeight: 1.0,
  eyeOffset: 0.18, // eye = height - eyeOffset
};

// ---- movement tuning (mirrors src/player/Movement.js — kept in ONE place so
// the shared movement-core and the client feel are identical) ---------------
export const MOVE = {
  gravity: 25,
  terminal: 55,
  groundAccel: 60,
  maxSpeed: 8,
  sprintSpeed: 10,
  groundFriction: 8,
  stopSpeed: 2.5,
  airAccel: 40,
  airWishSpeed: 1.2,
  airControl: 12,
  airFriction: 0.05,
  jumpForce: 8.5,
  coyoteTime: 0.12,
  jumpBuffer: 0.15,
  variableJumpCut: 0.55,
  slideBoost: 3.5,
  slideBoostSpeedCap: 11,
  slideCooldown: 0.8,
  slideFriction: 1.2,
  slideMinSpeed: 3.0,
  slideSteerRate: 6,
  slideMaxSpeed: 16,
  wallMinSpeed: 4,
  wallAttachDot: 0.35,
  wallGravityStart: 0.05,
  wallGravityEnd: 0.6,
  wallMaxDuration: 2.5,
  wallUpBoost: 2,
  wallSpeedBoost: 1.5,
  wallAccel: 9,
  wallStickForce: 6,
  wallRollDeg: 12,
  wallJumpAway: 6,
  wallJumpUp: 7,
  wallJumpGrace: 0.1,
  landHardSpeed: 12,
  weightSpeedPenalty: 0.06,
  weightSpeedMin: 0.7,
};

// ---- crew identities (fixed colors) ----------------------------------------
export const CREW = [
  { key: 'keshawn', name: 'Keshawn', color: 0x7df9ff }, // cyan
  { key: 'sean',    name: 'Sean',    color: 0xff6b6b }, // red
  { key: 'amari',   name: 'Amari',   color: 0xffd166 }, // gold
  { key: 'dart',    name: 'Dart',    color: 0x9b5de5 }, // violet
  { key: 'tyheim',  name: 'Tyheim',  color: 0x51e898 }, // green
  { key: 'arisa',   name: 'Arisa',   color: 0xff8fcf }, // pink
];

// ---- combat (server reuses RANGE gun stats; minimal set the server needs) ---
// weaponId -> { damage, headMult, falloff:{start,end,minMult}, rpm }
// (kept here so the headless server doesn't import client weapon code).
export const WEAPON_COMBAT = {
  // 1A: pistol/smg falloff steepened to match the client defs (weapons-data.js) so
  // MP damage-at-range mirrors the range test — both fall off hard past mid range.
  pistol:  { damage: 34,  headMult: 1.8, falloff: { start: 16,  end: 42,  minMult: 0.3 } },
  smg:     { damage: 16,  headMult: 1.6, falloff: { start: 13,  end: 34,  minMult: 0.25 } },
  shotgun: { damage: 12,  headMult: 1.4, falloff: { start: 7,   end: 22,  minMult: 0.2 }, pellets: 8, spreadDeg: 3.4 },
  ar:      { damage: 24,  headMult: 1.7, falloff: { start: 30,  end: 80,  minMult: 0.6 } },
  sniper:  { damage: 140, headMult: 1.5, falloff: { start: 120, end: 300, minMult: 0.8 } },
  // 1B new guns (mirror weapons-data.js): DMR = mid-long precision; revolver = slow hand-cannon.
  dmr:     { damage: 62,  headMult: 1.9, falloff: { start: 40,  end: 120, minMult: 0.55 } },
  revolver:{ damage: 78,  headMult: 2.0, falloff: { start: 20,  end: 55,  minMult: 0.4 } },
  // burst rifle: each of the 3 rounds resolves as a normal hitscan shot server-side.
  burst:   { damage: 30,  headMult: 1.75, falloff: { start: 35, end: 95,  minMult: 0.6 } },
  // ARC LANCE (dual-mode): primary = fast hitscan beam; alt 'arclance_alt' lobs a
  // grenade (arc + fuse + splash from GRENADE/PROJECTILES.grenade).
  arclance:      { damage: 13, headMult: 1.5, falloff: { start: 25, end: 70, minMult: 0.5 } },
  arclance_alt:  { damage: 0,  headMult: 1,   falloff: null, projectile: 'grenade' },
  // Projectile weapons: `projectile` names a PROJECTILES entry — the server
  // spawns a networked projectile instead of resolving hitscan. damage/headMult
  // here are unused for these (the projectile carries its own damage).
  exotic:   { damage: 0, headMult: 1, falloff: null, projectile: 'rocket' },
  sawblade: { damage: 0, headMult: 1, falloff: null, projectile: 'sawblade' },
  // 1C melee (knife/bat): kept here for parity so the server never crashes on
  // these ids. Real melee damage comes from MELEE below via resolveMelee().
  knife:    { damage: 45, headMult: 1, falloff: null },
  bat:      { damage: 58, headMult: 1, falloff: null },
};

// ---- 1C: dedicated melee weapons (server-read source of truth) --------------
// THREE-free plain data, imported by BOTH the client (weapons-data tunables +
// Weapon.js sweep) and the headless server (resolveMelee). Light = LMB, heavy =
// RMB. arcDeg is the half-angle of the swing sweep the server fans rays across.
// knife: fast/short/light + long-reach heavy LUNGE. bat: slow/heavy knockback +
// momentum bonus (hits harder the faster you move).
export const MELEE = {
  knife: { lightDamage: 45, lightRange: 2.6, lightCooldownMs: 360, heavyDamage: 80, heavyRange: 3.9, heavyCooldownMs: 720, knockback: 3, momentum: 0, arcDeg: 24 },
  bat:   { lightDamage: 58, lightRange: 3.0, lightCooldownMs: 700, heavyDamage: 104, heavyRange: 3.4, heavyCooldownMs: 1150, knockback: 11, momentum: 3, arcDeg: 32 },
};

// ---- 1E: accolade / medal thresholds (server-authoritative; also exposed as
// client debug tunables so they're visible + adjustable). The server reads its
// own imported copy; these are the shipping defaults. ------------------------
export const ACCOLADES = {
  multiWindowMs: 4000,   // sequential kills within this window chain a multikill
  longshotDist: 45,      // kill at/beyond this range (m) = LONGSHOT
  fastSpeed: 9,          // horizontal speed (m/s) at/above which a kill is IN MOTION
  trickshotDist: 28,     // a midair kill at/beyond this range = TRICKSHOT (else MIDAIR)
};

// ---- headshot hitbox (server) ---------------------------------------------
// A dedicated head sphere sits atop the body capsule; a ray within HEAD_R of its
// center is a headshot (bigger multiplier than the capsule-fraction guess).
export const HEAD = { centerFrac: 0.92, radius: 0.19, mult: 2.0 }; // centerY = feet + height*centerFrac

// ---- networked projectiles (server-authoritative, sent in snapshots) -------
// The server simulates these each tick vs ARENA_WORLD + player capsules and
// broadcasts booms. Clients render them from snapshots. See ARENA-ARCHITECTURE §13.
export const PROJECTILES = {
  // Sawblade: travel-time disc, ricochets off WALLS up to maxBounces, carves
  // THROUGH players (damages each once per leg). NOT hitscan.
  sawblade: {
    kind: 'sawblade', speed: 46, gravity: 0, radius: 0.28, life: 4.5,
    damage: 55, maxBounces: 2, pierce: true,
  },
  // Rocket: travel-time; on impact/expiry → SPLASH (falloff to edge) + spawns
  // seekers that home the nearest enemy.
  rocket: {
    kind: 'rocket', speed: 62, gravity: 0, radius: 0.4, life: 5,
    directDamage: 55, splashDamage: 115, splashRadius: 5.5, splashMinFrac: 0.25,
    seekers: 5, seekRadius: 9,
  },
  // Seeker: homing sub-munition spawned by a rocket blast.
  seeker: {
    kind: 'seeker', speed: 34, gravity: 0, radius: 0.7, life: 3.0,
    damage: 34, splashRadius: 2.2, splashDamage: 34, splashMinFrac: 0.4,
    turn: 7.0, // rad/s max steering
  },
  // Grenade: thrown (G), arcs under gravity, bounces off walls/floor, explodes
  // on a fuse timer → big splash.
  grenade: {
    kind: 'grenade', speed: 17, gravity: 22, radius: 0.22, life: 0,
    fuse: 1.6, bounce: 0.42, friction: 0.75,
    splashDamage: 130, splashRadius: 5.2, splashMinFrac: 0.2,
    throwUp: 4.5, // extra +Y on throw so it arcs
  },
};

// grenade loadout
export const GRENADE = { cooldownMs: 4000, max: 2, regenMs: 12000 };

// ---- arena data (authoritative geometry: client renders it, server collides
// against it). AABBs are world-space; wallrun:true walls are wall-runnable.
// Floor top is y=0. See src/world/Arena.js for the matching visuals. ---------
export const DEFAULT_ARENA = 'proving-grounds';

const box = (x0, y0, z0, x1, y1, z1, extra = {}) => ({
  min: { x: x0, y: y0, z: z0 }, max: { x: x1, y: y1, z: z1 }, ...extra,
});

export const ARENA_COLLIDERS = [
  // floor + perimeter walls (contain the play space, ~44×44)
  box(-22, -2, -22, 22, 0, 22),          // floor slab
  box(-22, 0, -23, 22, 8, -22),          // wall -Z
  box(-22, 0, 22, 22, 8, 23),            // wall +Z
  box(-23, 0, -22, -22, 8, 22),          // wall -X
  box(22, 0, -22, 23, 8, 22),            // wall +X

  // central two-tier structure
  box(-6, 0, -6, 6, 3, 6),               // main platform (top y=3)
  box(-3, 3, -3, 3, 5, 3),               // upper block (top y=5)

  // cover blocks (spread, low, for duels)
  box(-14, 0, 2, -11, 1.4, 5),
  box(11, 0, -5, 14, 1.4, -2),
  box(2, 0, 11, 5, 1.4, 14),
  box(-5, 0, -14, -2, 1.4, -11),

  // wall-run lane (two parallel runnable walls forming a route past center)
  box(-10, 0, -1, -9.5, 4.5, 9, { wallrun: true }),
  box(9.5, 0, -9, 10, 4.5, 1, { wallrun: true }),

  // outer flank platforms (wall-jump targets)
  box(-19, 0, -8, -16, 2.2, -4),
  box(16, 0, 4, 19, 2.2, 8),

  // --- extended wall-run network: thin tall runnable walls forming routes you
  // can chain (run → wall-jump to a ledge → run again → reach the high ground) ---
  box(-16.5, 0, 6, -16, 5, 18, { wallrun: true }),    // -X back straight
  box(16, 0, -18, 16.5, 5, -6, { wallrun: true }),    // +X front straight
  box(-6, 0, 15, 6, 5, 15.5, { wallrun: true }),      // +Z cross wall
  box(-6, 0, -15.5, 6, 5, -15, { wallrun: true }),    // -Z cross wall
  box(-15.5, 3, -4, -15, 7.5, 6, { wallrun: true }),  // -X high run (skybridge level)
  box(15, 3, -6, 15.5, 7.5, 4, { wallrun: true }),    // +X high run
  box(6.5, 0, 7, 7, 5, 13, { wallrun: true }),        // NE corner connector
  box(-7, 0, -13, -6.5, 5, -7, { wallrun: true }),    // SW corner connector

  // wall-jump ledges reachable off the runs (mid-air stepping stones)
  box(-14.5, 4, 9, -11.5, 4.4, 12),
  box(11.5, 4, -12, 14.5, 4.4, -9),
  box(-3, 6.2, 12, 3, 6.6, 15),
  box(-3, 6.2, -15, 3, 6.6, -12),
];

// ramps up onto the central platform (heightfield tops h0->h1 along `axis`)
export const ARENA_RAMPS = [
  { min: { x: 6, y: 0, z: -3 }, max: { x: 11, y: 3, z: 3 }, axis: 'x', h0: 3, h1: 0 }, // +X ramp down to floor
  { min: { x: -11, y: 0, z: -3 }, max: { x: -6, y: 3, z: 3 }, axis: 'x', h0: 0, h1: 3 }, // -X ramp up
];

// spawn points — spread around the ring, facing roughly toward center, never
// face-to-face. yaw in degrees (0 faces -Z, matching the camera convention).
export const ARENA_SPAWNS = [
  { pos: { x: -17, y: 0, z: -17 }, yaw: 135 },
  { pos: { x: 17, y: 0, z: 17 }, yaw: -45 },
  { pos: { x: 17, y: 0, z: -17 }, yaw: -135 },
  { pos: { x: -17, y: 0, z: 17 }, yaw: 45 },
  { pos: { x: 0, y: 5, z: -18 }, yaw: 180 },
  { pos: { x: 0, y: 5, z: 18 }, yaw: 0 },
];

// The world object the movement-core + server collision consume.
export const ARENA_WORLD = { aabbs: ARENA_COLLIDERS, ramps: ARENA_RAMPS };
