// RANGE — weapon definitions (agent D).
// Field names are BINDING per ARCHITECTURE.md §9; values are tuning.
import { MELEE } from '../../shared/constants.js';
// Every feel-relevant number is registered as a tunable (cat 'gun:<id>')
// via registerWeaponTunables(ctx), called by WeaponManager.
//
// Conventions used by Weapon.js / Recoil.js / Hitscan.js:
// - spread values are cone HALF-ANGLES in degrees.
// - spread.adsMove (addition, optional): multiplier on the movement spread
//   penalty while ADS (default 0.35). Sniper uses 1.0 — moving while scoped
//   is heavily punished; standing scoped (<2 m/s) is a laser.
// - recoil.pattern (AR): explicit [pitchDeg, yawDeg] per-shot deltas.
//   kickPitch/kickYaw act as overall multipliers on the pattern (1.0 = as
//   authored) so the whole pattern stays tunable from the debug panel.
// - recoil.patternLoop (addition, optional): index the pattern wraps back to
//   after the last entry, so long sprays cycle the drift section smoothly.
// - recoil.recover: exponential recovery rate (1/s) for uncompensated recoil.
// - projectile (addition, sniper only): params for the railgun-bolt cheat
//   (ctx.cheats.sniperProjectile) consumed by ProjectileManager.
// - Reload phase sound = `${id}_${phaseName}` (§7). Cycle sound likewise.

export const WEAPONS = [
  {
    id: 'pistol',
    name: 'P-9 VIPER',
    slot: 1,
    type: 'hitscan',
    damage: 34,
    auto: false,
    rpm: 400,
    mag: 12,
    reserve: 84,
    // 1A rebalance: steeper falloff → reliable close-mid sidearm, weak past ~40 m.
    falloff: { start: 16, end: 42, minMult: 0.3 },
    // Crisp when STILL + TAPPED (low base + near-laser ADS reward precision), but
    // hipfire spread widens hard on the MOVE and while SPRAYING (bloom) → punished
    // as a long-range spray pick.
    spread: { base: 0.4, move: 1.7, air: 1.6, ads: 0.05, bloomPerShot: 0.42, bloomMax: 2.8, recover: 8, adsMove: 0.35 },
    recoil: { kickPitch: 1.1, kickYaw: 0.3, recover: 14, adsMult: 0.85 },
    reload: {
      // Tactical: quicker slide-release rack. Empty: full slide rack.
      phases: [
        { name: 'magout', t: 0.35 },
        { name: 'magin', t: 0.5 },
        { name: 'rack', t: 0.25 },
      ],
      emptyPhases: [
        { name: 'magout', t: 0.35 },
        { name: 'magin', t: 0.5 },
        { name: 'rack', t: 0.35 },
      ],
    },
    equipT: 0.28,
    holsterT: 0.22,
    adsT: 0.16,
    adsFovScale: 0.9,
    sounds: { fire: 'pistol_fire' },
    tracer: { color: 0xffd27a, width: 0.03 },
    shell: { kind: 'pistol' },
    feel: { hitstopMs: 30, hitstopKillMs: 70, shake: 0.18, flash: 0.6 },
    weight: 1.0,
  },

  {
    id: 'smg',
    name: 'SW-11 WASP',
    slot: 2,
    type: 'hitscan',
    damage: 16,
    auto: true,
    rpm: 950,
    mag: 30,
    reserve: 120,
    // 1A rebalance: steep falloff → shreds up close, near-useless past mid range.
    falloff: { start: 13, end: 34, minMult: 0.25 },
    // A close-mid MOVER's gun, NOT a laser: wide hipfire cone (base 1.4) that only
    // tames with bursts (bloom recovers) or ADS; sprayed hipfire at range is wild.
    spread: { base: 1.4, move: 1.7, air: 1.4, ads: 0.42, bloomPerShot: 0.34, bloomMax: 4.6, recover: 5, adsMove: 0.32 },
    // Small, fast, jittery climb.
    recoil: { kickPitch: 0.55, kickYaw: 0.32, recover: 12, adsMult: 0.85 },
    reload: {
      phases: [
        { name: 'magout', t: 0.4 },
        { name: 'magin', t: 0.55 },
        { name: 'rack', t: 0.4 },
      ],
    },
    equipT: 0.24,
    holsterT: 0.2,
    adsT: 0.14,
    adsFovScale: 0.92,
    sounds: { fire: 'smg_fire' },
    tracer: { color: 0x7df9ff, width: 0.028 },
    shell: { kind: 'pistol' },
    feel: { hitstopMs: 18, hitstopKillMs: 50, shake: 0.12, flash: 0.5 },
    weight: 1.4,
  },

  {
    id: 'shotgun',
    name: 'M8 BULWARK',
    slot: 3,
    type: 'pellets',
    damage: 12, // per pellet
    pellets: 8,
    auto: false,
    rpm: 70,
    mag: 6,
    reserve: 30,
    falloff: { start: 7, end: 22, minMult: 0.2 },
    // base IS the pellet cone (3.2°); pellets pattern inside getSpreadDeg()
    // as slight-ring + random. ADS chokes the cone a little.
    spread: { base: 3.2, move: 0.6, air: 0.8, ads: 2.4, bloomPerShot: 0.15, bloomMax: 1.0, recover: 4, adsMove: 0.4 },
    // One huge kick.
    recoil: { kickPitch: 6, kickYaw: 0.8, recover: 9, adsMult: 0.9 },
    cycle: { phase: 'pump', t: 0.55 },
    reload: {
      perShell: true,
      // perShell reloads are generated at runtime: repeated 'shell' phases,
      // then 'pump' only if the chamber was empty. These entries carry the timings.
      phases: [
        { name: 'shell', t: 0.55 },
        { name: 'pump', t: 0.55 },
      ],
    },
    equipT: 0.4,
    holsterT: 0.3,
    adsT: 0.2,
    adsFovScale: 0.95,
    sounds: { fire: 'shotgun_fire' },
    tracer: { color: 0xffa04d, width: 0.024 },
    shell: { kind: 'shell' },
    feel: { hitstopMs: 90, hitstopKillMs: 140, shake: 0.8, flash: 1.0 },
    weight: 2.6,
  },

  {
    id: 'ar',
    name: 'AR-4 CENTURION',
    slot: 4,
    type: 'hitscan',
    damage: 24,
    auto: true,
    rpm: 720,
    mag: 30,
    reserve: 150,
    falloff: { start: 30, end: 80, minMult: 0.6 },
    spread: { base: 0.35, move: 0.8, air: 1.5, ads: 0.12, bloomPerShot: 0.12, bloomMax: 2.0, recover: 7, adsMove: 0.4 },
    // LEARNABLE pattern: 4 mostly-vertical, drift right, then swing left.
    // kickPitch/kickYaw multiply the pattern (keep at 1.0 for authored feel).
    recoil: {
      kickPitch: 1.0,
      kickYaw: 1.0,
      pattern: [
        [1.3, 0.05], [1.35, -0.08], [1.3, 0.1], [1.2, -0.05],
        [1.0, 0.3], [0.9, 0.5], [0.85, 0.55], [0.8, 0.45],
        [0.85, 0.05], [0.88, -0.4], [0.9, -0.55], [0.85, -0.45],
      ],
      patternLoop: 4,
      recover: 13, // recovers well — pattern-pull matters
      adsMult: 0.85,
    },
    reload: {
      // tactical: mag swap only (a round stays chambered — no charging stroke).
      // empty adds rack + bolt to chamber the first round (slower, distinct).
      phases: [
        { name: 'magout', t: 0.5 },
        { name: 'magin', t: 0.6 },
      ],
      emptyPhases: [
        { name: 'magout', t: 0.5 },
        { name: 'magin', t: 0.6 },
        { name: 'rack', t: 0.45 },
        { name: 'bolt', t: 0.35 },
      ],
    },
    equipT: 0.34,
    holsterT: 0.26,
    adsT: 0.18,
    adsFovScale: 0.88,
    sounds: { fire: 'ar_fire' },
    tracer: { color: 0xfff0a8, width: 0.035 },
    shell: { kind: 'rifle' },
    feel: { hitstopMs: 25, hitstopKillMs: 70, shake: 0.25, flash: 0.7 },
    weight: 2.0,
  },

  {
    id: 'sniper',
    name: 'LR-50 RAILSPIKE',
    slot: 5,
    type: 'hitscan', // honors ctx.cheats.sniperProjectile → ProjectileManager
    damage: 140,
    auto: false,
    rpm: 45,
    mag: 5,
    reserve: 25,
    falloff: { start: 120, end: 300, minMult: 0.8 },
    // Scoped + standing (<2 m/s): exact 0.0. Unscoped or moving: awful.
    spread: { base: 3.5, move: 6, air: 8, ads: 0.0, bloomPerShot: 1.0, bloomMax: 3.0, recover: 3, adsMove: 1.0 },
    recoil: { kickPitch: 7, kickYaw: 0.5, recover: 6, adsMult: 0.95 }, // heavy, slow recover
    cycle: { phase: 'bolt', t: 1.0 },
    reload: {
      phases: [
        { name: 'magout', t: 0.6 },
        { name: 'magin', t: 0.7 },
        { name: 'bolt', t: 0.6 },
      ],
    },
    equipT: 0.55,
    holsterT: 0.4,
    adsT: 0.32,
    adsFovScale: 0.28,
    scope: true,
    sounds: { fire: 'sniper_fire' },
    tracer: { color: 0x9fd0ff, width: 0.09 },
    shell: { kind: 'rifle' },
    feel: { hitstopMs: 110, hitstopKillMs: 180, shake: 1.0, flash: 1.0 },
    projectile: { speed: 220, gravity: 0, color: 0x9fd0ff }, // railgun-bolt cheat
    weight: 3.0,
  },

  // -------------------------------------------------------------------------
  // THE EXOTIC (slot 6) — travel-time rocket launcher w/ seeking sub-munitions
  // §12.3. type 'rocket' → ProjectileManager (NOT hitscan). On impact: AoE +
  // spawns `explosion.seekers` homing darts. Heaviest gun (weight 5 → slowest).
  // -------------------------------------------------------------------------
  {
    id: 'exotic',
    name: 'MX-9 REVENANT',
    slot: 6,
    type: 'rocket',
    damage: 120, // direct/rocket body damage; explosion carries the AoE
    auto: false,
    rpm: 40,
    mag: 1,
    reserve: 8,
    falloff: { start: 0, end: 0, minMult: 1 }, // n/a — rocket damage is AoE, no falloff
    // Rockets don't spray — a small fixed cone so it always launches near-center.
    spread: { base: 0.1, move: 0.6, air: 0.9, ads: 0.05, bloomPerShot: 0, bloomMax: 0, recover: 8, adsMove: 0.4 },
    // One colossal kick.
    recoil: { kickPitch: 9, kickYaw: 1.0, recover: 5, adsMult: 0.95 },
    reload: {
      // single-load: one 'load' phase (sound exotic_load, §7).
      phases: [
        { name: 'load', t: 1.6 },
      ],
    },
    equipT: 0.6,
    holsterT: 0.45,
    adsT: 0.3,
    adsFovScale: 0.92,   // mild zoom only — a launcher doesn't sight-align
    looseAds: true,      // don't swing the bulky model into the whole screen
    sounds: { fire: 'exotic_fire' },
    tracer: { color: 0xff7a2a, width: 0.06 },
    shell: { kind: 'rifle' },
    feel: { hitstopMs: 120, hitstopKillMs: 200, shake: 1.0, flash: 1.0 },
    weight: 5.0,
    // Rocket travel + explosion behavior (consumed by Weapon.js / Projectile.js).
    projectile: { speed: 55, gravity: 0, color: 0xff7a2a },
    explosion: {
      radius: 5,
      damage: 120,
      seekers: 5,
      seekRadius: 8,
      seekerDamage: 45,
      seekerSpeed: 28,
      seekerTurn: 6, // rad/s max steering rate
      seekerLife: 2.5,
      seekerRadius: 1.2, // contact radius for a seeker damaging its target
    },
  },

  // -------------------------------------------------------------------------
  // SAWBLADE LAUNCHER (slot 7) — ricochet blades (§12.4). type 'sawblade' →
  // ProjectileManager. Reflects off WALLS up to ricochet.maxBounces, carves
  // THROUGH targets (keeps flying). Medium weight.
  // -------------------------------------------------------------------------
  {
    id: 'sawblade',
    name: 'RIPTIDE DISCUS',
    slot: 7,
    type: 'sawblade',
    damage: 55, // mirrors ricochet.damage; kept for schema/HUD/tunable parity
    auto: true,
    rpm: 120,
    mag: 8,
    reserve: 40,
    falloff: { start: 0, end: 0, minMult: 1 }, // n/a — blade damage is flat
    spread: { base: 0.5, move: 1.0, air: 1.2, ads: 0.15, bloomPerShot: 0.1, bloomMax: 1.2, recover: 6, adsMove: 0.35 },
    // Light, rapid kick.
    recoil: { kickPitch: 0.8, kickYaw: 0.4, recover: 12, adsMult: 0.85 },
    reload: {
      // single-load magazine swap (sound sawblade_load, §7).
      phases: [
        { name: 'load', t: 1.1 },
      ],
    },
    equipT: 0.32,
    holsterT: 0.26,
    adsT: 0.18,
    adsFovScale: 0.94,   // mild zoom only
    looseAds: true,      // disc launcher doesn't sight-align into the screen
    sounds: { fire: 'sawblade_fire' },
    tracer: { color: 0x8affc8, width: 0.03 },
    shell: { kind: 'rifle' },
    feel: { hitstopMs: 40, hitstopKillMs: 90, shake: 0.3, flash: 0.6 },
    weight: 2.8,
    projectile: { speed: 40, gravity: 0, color: 0x8affc8 },
    ricochet: {
      maxBounces: 2,
      speed: 40,
      damage: 55,
      life: 4,
      radius: 0.18,
    },
  },

  // -------------------------------------------------------------------------
  // DMR (slot 8) — hitscan, SEMI-auto marksman rifle. The mid-long precision
  // answer that fills the gap between the AR and the sniper: high per-shot
  // damage, low spread, MILD falloff (still strong at range), a modest ADS zoom,
  // and a per-shot action cycle. Reset your aim between clicks and it out-ranges
  // the AR while being far more forgiving than the sniper. §1B.
  // -------------------------------------------------------------------------
  {
    id: 'dmr',
    name: 'DM-7 LONGVIEW',
    slot: 8,
    type: 'hitscan',
    damage: 62,
    auto: false,
    rpm: 200,          // ~333 ms/shot: fast if you pace clicks
    mag: 18,
    reserve: 90,
    // MILD falloff — stays lethal at distance, but not a free long-range laser:
    // trimmed the far floor (0.65→0.55) + pulled `end` in so extreme range bites.
    falloff: { start: 40, end: 120, minMult: 0.55 },
    // Precise when still/ADS (base + ads low); moving + airborne + spray punished.
    spread: { base: 0.28, move: 0.9, air: 2.2, ads: 0.05, bloomPerShot: 0.22, bloomMax: 2.8, recover: 6, adsMove: 0.55 },
    // Moderate vertical kick that RESETS between shots (high recover) so a paced
    // marksman can hold a line; spraying clicks climbs.
    recoil: { kickPitch: 2.4, kickYaw: 0.5, recover: 12, adsMult: 0.82 },
    reload: {
      phases: [
        { name: 'magout', t: 0.45 },
        { name: 'magin', t: 0.6 },
      ],
      emptyPhases: [
        { name: 'magout', t: 0.45 },
        { name: 'magin', t: 0.6 },
        { name: 'rack', t: 0.45 },
      ],
    },
    equipT: 0.4,
    holsterT: 0.3,
    adsT: 0.24,
    adsFovScale: 0.6,   // modest zoom — more than the AR (0.88), less than the sniper (0.28)
    sounds: { fire: 'dmr_fire' },
    tracer: { color: 0xffe08a, width: 0.045 },
    shell: { kind: 'rifle' },
    feel: { hitstopMs: 38, hitstopKillMs: 90, shake: 0.4, flash: 0.8 },
    weight: 2.6,
  },

  // -------------------------------------------------------------------------
  // REVOLVER (slot 9) — hitscan, high-risk/high-reward sidearm. SLOWER than the
  // pistol but hits MUCH harder (near a 2-tap up close, near a 1-tap on the head).
  // Big per-shot damage, small 6-round cylinder, heavy recoil punch + slow
  // recovery, and a deliberate SWING-OUT CYLINDER reload. §1B.
  // -------------------------------------------------------------------------
  {
    id: 'revolver',
    name: 'RK-6 JUDGE',
    slot: 9,
    type: 'hitscan',
    damage: 78,        // ~2-tap body; headshot (×2.0 server) is a near 1-tap
    auto: false,
    rpm: 150,          // slow, deliberate — you feel every shot
    mag: 6,
    reserve: 30,
    falloff: { start: 20, end: 55, minMult: 0.4 },   // a sidearm: strong close-mid, fades past mid
    // Precise on a still tap (low base + low ads), but heavy recoil + spray punish
    // fast/mobile fire.
    spread: { base: 0.32, move: 1.4, air: 1.9, ads: 0.06, bloomPerShot: 0.6, bloomMax: 3.0, recover: 5, adsMove: 0.5 },
    // Big punch, SLOW recovery — the hand-cannon kick you have to ride.
    recoil: { kickPitch: 5.5, kickYaw: 0.9, recover: 6.5, adsMult: 0.92 },
    reload: {
      // deliberate swing-out cylinder: swing out → eject spent → load → swing shut.
      // ammo seats as the 'load' phase ends (single speedloader dump, §7 sounds).
      phases: [
        { name: 'swing', t: 0.4 },
        { name: 'eject', t: 0.35 },
        { name: 'load', t: 1.0 },
        { name: 'close', t: 0.4 },
      ],
    },
    equipT: 0.42,
    holsterT: 0.32,
    adsT: 0.2,
    adsFovScale: 0.82,
    sounds: { fire: 'revolver_fire' },
    tracer: { color: 0xffce6a, width: 0.05 },
    shell: { kind: 'pistol' },
    feel: { hitstopMs: 75, hitstopKillMs: 150, shake: 0.62, flash: 0.95 },
    weight: 1.9,
  },

  // -------------------------------------------------------------------------
  // KNIFE (slot 10) — dedicated MELEE weapon (V / weapon-wheel). §1C. NOT a
  // quick-melee: you switch to it and fight with it. LMB = fast light swing
  // (short reach), RMB = heavy LUNGE (longer reach, big damage). No ADS / ammo /
  // reload. The real combat numbers live in MELEE.knife (shared/constants.js,
  // server-authoritative); this def still carries the full schema shape so the
  // gun FSM / audio / feel systems treat it like any weapon. type 'melee' routes
  // Weapon.fixedUpdate to the sweep path instead of hitscan.
  // -------------------------------------------------------------------------
  {
    id: 'knife',
    name: 'CQC-1 FANG',
    slot: 10,
    type: 'melee',
    melee: 'knife',
    damage: 45,          // mirrors MELEE.knife.lightDamage for HUD/schema parity
    auto: false,
    rpm: 300,            // unused for melee (cooldown from MELEE); kept for schema
    mag: 1,
    reserve: 0,
    falloff: { start: 0, end: 0, minMult: 1 },
    spread: { base: 0, move: 0, air: 0, ads: 0, bloomPerShot: 0, bloomMax: 0, recover: 1, adsMove: 0 },
    recoil: { kickPitch: 0, kickYaw: 0, recover: 10, adsMult: 1 },
    reload: { phases: [{ name: 'magin', t: 0.3 }] }, // unused (melee never reloads)
    equipT: 0.22,
    holsterT: 0.18,
    adsT: 0.12,
    adsFovScale: 1.0,
    sounds: { fire: 'knife_swing' },
    tracer: { color: 0xbfd4e0, width: 0 },
    shell: { kind: 'pistol' },
    feel: { hitstopMs: 55, hitstopKillMs: 110, shake: 0.22, flash: 0 },
    weight: 1.0,
  },

  // -------------------------------------------------------------------------
  // BAT (slot 11) — dedicated MELEE weapon (V / weapon-wheel). §1C. Slow, heavy,
  // long windup: big knockback + high damage, and a MOMENTUM swing that hits
  // harder the faster you move (MELEE.bat.momentum). LMB = light, RMB = heavy.
  // No ADS / ammo / reload. Combat numbers live in MELEE.bat.
  // -------------------------------------------------------------------------
  {
    id: 'bat',
    name: 'HAYMAKER',
    slot: 11,
    type: 'melee',
    melee: 'bat',
    damage: 58,          // mirrors MELEE.bat.lightDamage for HUD/schema parity
    auto: false,
    rpm: 120,            // unused for melee (cooldown from MELEE); kept for schema
    mag: 1,
    reserve: 0,
    falloff: { start: 0, end: 0, minMult: 1 },
    spread: { base: 0, move: 0, air: 0, ads: 0, bloomPerShot: 0, bloomMax: 0, recover: 1, adsMove: 0 },
    recoil: { kickPitch: 0, kickYaw: 0, recover: 10, adsMult: 1 },
    reload: { phases: [{ name: 'magin', t: 0.3 }] }, // unused (melee never reloads)
    equipT: 0.34,
    holsterT: 0.28,
    adsT: 0.16,
    adsFovScale: 1.0,
    sounds: { fire: 'bat_swing' },
    tracer: { color: 0x9a8055, width: 0 },
    shell: { kind: 'pistol' },
    feel: { hitstopMs: 95, hitstopKillMs: 170, shake: 0.7, flash: 0 },
    weight: 2.4,
  },
];

// ---------------------------------------------------------------------------
// Tunables — one descriptor per feel-relevant number, grouped per gun.
// Called once by WeaponManager's constructor.
// ---------------------------------------------------------------------------
export function registerWeaponTunables(ctx) {
  const push = (cat, key, obj, prop, min, max, step) => {
    if (!obj || obj[prop] === undefined) return;
    ctx.tunables.push({ cat, key, obj, prop, min, max, step });
  };

  for (const def of WEAPONS) {
    const cat = `gun:${def.id}`;

    push(cat, 'damage', def, 'damage', 1, 200, 1);
    if (def.pellets !== undefined) push(cat, 'pellets', def, 'pellets', 1, 16, 1);
    push(cat, 'rpm', def, 'rpm', 30, 1200, 5);
    push(cat, 'mag', def, 'mag', 1, 60, 1);
    push(cat, 'reserve', def, 'reserve', 0, 500, 1);

    push(cat, 'falloff.start', def.falloff, 'start', 1, 300, 1);
    push(cat, 'falloff.end', def.falloff, 'end', 2, 400, 1);
    push(cat, 'falloff.minMult', def.falloff, 'minMult', 0, 1, 0.01);

    push(cat, 'spread.base', def.spread, 'base', 0, 10, 0.01);
    push(cat, 'spread.move', def.spread, 'move', 0, 10, 0.01);
    push(cat, 'spread.air', def.spread, 'air', 0, 10, 0.01);
    push(cat, 'spread.ads', def.spread, 'ads', 0, 10, 0.01);
    push(cat, 'spread.bloomPerShot', def.spread, 'bloomPerShot', 0, 2, 0.01);
    push(cat, 'spread.bloomMax', def.spread, 'bloomMax', 0, 8, 0.05);
    push(cat, 'spread.recover', def.spread, 'recover', 0, 30, 0.1);
    push(cat, 'spread.adsMove', def.spread, 'adsMove', 0, 1, 0.01);

    push(cat, 'recoil.kickPitch', def.recoil, 'kickPitch', 0, 12, 0.05);
    push(cat, 'recoil.kickYaw', def.recoil, 'kickYaw', 0, 4, 0.02);
    push(cat, 'recoil.recover', def.recoil, 'recover', 0.5, 30, 0.5);
    push(cat, 'recoil.adsMult', def.recoil, 'adsMult', 0, 1.5, 0.01);

    if (def.cycle) push(cat, 'cycle.t', def.cycle, 't', 0.05, 2, 0.01);

    for (const ph of def.reload.phases) push(cat, `reload.${ph.name}`, ph, 't', 0.05, 2, 0.01);
    if (def.reload.emptyPhases) {
      for (const ph of def.reload.emptyPhases) push(cat, `reloadEmpty.${ph.name}`, ph, 't', 0.05, 2, 0.01);
    }

    push(cat, 'equipT', def, 'equipT', 0.05, 1.5, 0.01);
    push(cat, 'holsterT', def, 'holsterT', 0.05, 1.5, 0.01);
    push(cat, 'adsT', def, 'adsT', 0.05, 1, 0.01);
    push(cat, 'adsFovScale', def, 'adsFovScale', 0.15, 1, 0.01);

    push(cat, 'feel.hitstopMs', def.feel, 'hitstopMs', 0, 250, 1);
    push(cat, 'feel.hitstopKillMs', def.feel, 'hitstopKillMs', 0, 300, 1);
    push(cat, 'feel.shake', def.feel, 'shake', 0, 1, 0.01);
    push(cat, 'feel.flash', def.feel, 'flash', 0, 1, 0.01);

    push(cat, 'weight', def, 'weight', 1, 5, 0.1);

    if (def.projectile) {
      push(cat, 'projectile.speed', def.projectile, 'speed', 20, 600, 5);
      push(cat, 'projectile.gravity', def.projectile, 'gravity', 0, 30, 0.5);
    }

    // Rocket explosion + seeker tuning (exotic).
    if (def.explosion) {
      const e = def.explosion;
      push(cat, 'explosion.radius', e, 'radius', 1, 15, 0.25);
      push(cat, 'explosion.damage', e, 'damage', 0, 300, 5);
      push(cat, 'explosion.seekers', e, 'seekers', 0, 12, 1);
      push(cat, 'explosion.seekRadius', e, 'seekRadius', 1, 20, 0.5);
      push(cat, 'explosion.seekerDamage', e, 'seekerDamage', 0, 150, 1);
      push(cat, 'explosion.seekerSpeed', e, 'seekerSpeed', 5, 80, 1);
      push(cat, 'explosion.seekerTurn', e, 'seekerTurn', 0.5, 20, 0.25);
      push(cat, 'explosion.seekerLife', e, 'seekerLife', 0.5, 6, 0.1);
      push(cat, 'explosion.seekerRadius', e, 'seekerRadius', 0.3, 4, 0.1);
    }

    // Sawblade ricochet tuning.
    if (def.ricochet) {
      const rc = def.ricochet;
      push(cat, 'ricochet.maxBounces', rc, 'maxBounces', 0, 6, 1);
      push(cat, 'ricochet.speed', rc, 'speed', 10, 100, 1);
      push(cat, 'ricochet.damage', rc, 'damage', 0, 200, 1);
      push(cat, 'ricochet.life', rc, 'life', 0.5, 10, 0.25);
      push(cat, 'ricochet.radius', rc, 'radius', 0.05, 1, 0.01);
    }
  }

  // 1C melee tuning — one category per melee weapon, bound to the SHARED MELEE
  // data (so tweaks in the debug panel move the same numbers the server reads).
  for (const meleeId of ['knife', 'bat']) {
    const m = MELEE[meleeId];
    if (!m) continue;
    const cat = `melee:${meleeId}`;
    push(cat, 'lightDamage', m, 'lightDamage', 1, 200, 1);
    push(cat, 'lightRange', m, 'lightRange', 1, 8, 0.1);
    push(cat, 'lightCooldownMs', m, 'lightCooldownMs', 100, 2000, 10);
    push(cat, 'heavyDamage', m, 'heavyDamage', 1, 300, 1);
    push(cat, 'heavyRange', m, 'heavyRange', 1, 8, 0.1);
    push(cat, 'heavyCooldownMs', m, 'heavyCooldownMs', 200, 3000, 10);
    push(cat, 'knockback', m, 'knockback', 0, 30, 0.5);
    push(cat, 'momentum', m, 'momentum', 0, 10, 0.5);
    push(cat, 'arcDeg', m, 'arcDeg', 4, 90, 1);
  }
}
