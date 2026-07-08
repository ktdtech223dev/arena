// ARENA server — Hits.js: authoritative, lag-compensated hit resolution.
// On a client's `fire`, rewind every OTHER player to the shooter's fireTime
// (interpolating their history), build a vertical capsule hitbox for each, and
// ray-test. Nearest hit wins. Damage from shared WEAPON_COMBAT (+ falloff +
// headshot mult). Pure math — deterministic, headless.
import { WEAPON_COMBAT, CAPSULE, HEAD, MELEE } from '../shared/constants.js';

// nearest positive ray/sphere intersection, or null
function raySphere(o, d, c, r) {
  const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - cc;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return t > 0 ? t : null;
}

// closest distance^2 between segment p1->q1 (ray) and segment p2->q2 (capsule axis)
// returns { s, t, d2 } where s∈[0,1] along the ray, t∈[0,1] along the capsule.
function closestSegSeg(p1, q1, p2, q2) {
  const d1x = q1.x - p1.x, d1y = q1.y - p1.y, d1z = q1.z - p1.z;
  const d2x = q2.x - p2.x, d2y = q2.y - p2.y, d2z = q2.z - p2.z;
  const rx = p1.x - p2.x, ry = p1.y - p2.y, rz = p1.z - p2.z;
  const a = d1x * d1x + d1y * d1y + d1z * d1z;
  const e = d2x * d2x + d2y * d2y + d2z * d2z;
  const f = d2x * rx + d2y * ry + d2z * rz;
  let s, t;
  const EPS = 1e-9;
  if (a <= EPS && e <= EPS) { s = 0; t = 0; }
  else if (a <= EPS) { s = 0; t = clamp01(f / e); }
  else {
    const c = d1x * rx + d1y * ry + d1z * rz;
    if (e <= EPS) { t = 0; s = clamp01(-c / a); }
    else {
      const b = d1x * d2x + d1y * d2y + d1z * d2z;
      const denom = a * e - b * b;
      s = denom > EPS ? clamp01((b * f - c * e) / denom) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = clamp01(-c / a); }
      else if (t > 1) { t = 1; s = clamp01((b - c) / a); }
    }
  }
  const c1x = p1.x + d1x * s, c1y = p1.y + d1y * s, c1z = p1.z + d1z * s;
  const c2x = p2.x + d2x * t, c2y = p2.y + d2y * t, c2z = p2.z + d2z * t;
  const dx = c1x - c2x, dy = c1y - c2y, dz = c1z - c2z;
  return { s, t, d2: dx * dx + dy * dy + dz * dz };
}
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Resolve one shot authoritatively.
 * @param shooter Player who fired
 * @param fire FireCmd { fireTime, weaponId, origin, dir, ads }
 * @param players Map<id,Player>
 * @param nowServer current server time (ms)
 * @param offsetForShooter clientTime->serverTime offset for the shooter
 * @returns { victimId, part, dmg, killed } | null
 */
const MAX_DIST = 400;

// Cast one lag-comp ray. Returns the nearest { victim, dist, head } or null.
function castRay(shooter, O, D, players, rewindTo) {
  const r = CAPSULE.radius;
  const rayEnd = { x: O.x + D.x * MAX_DIST, y: O.y + D.y * MAX_DIST, z: O.z + D.z * MAX_DIST };
  let best = null;
  for (const p of players.values()) {
    if (p.id === shooter.id || !p.alive) continue;
    const past = p.rewind(rewindTo);
    const H = past.height || CAPSULE.standHeight;
    const headC = { x: past.px, y: past.py + H * HEAD.centerFrac, z: past.pz };
    const th = raySphere(O, D, headC, HEAD.radius);
    if (th !== null && th > 0.1 && th < MAX_DIST && (!best || th < best.dist)) best = { victim: p, dist: th, head: true };
    const A = { x: past.px, y: past.py + r, z: past.pz };
    const B = { x: past.px, y: past.py + Math.max(H - r, r), z: past.pz };
    const cc = closestSegSeg(O, rayEnd, A, B);
    if (cc.d2 <= r * r) {
      const dist = cc.s * MAX_DIST;
      if (dist > 0.1 && (!best || dist < best.dist)) best = { victim: p, dist, head: false };
    }
  }
  return best;
}

export function resolveShot(shooter, fire, players, nowServer, offsetForShooter) {
  const combat = WEAPON_COMBAT[fire.weaponId] || WEAPON_COMBAT.ar;
  const rewindTo = Math.min(nowServer, (fire.fireTime || 0) + (offsetForShooter || 0));
  const best = castRay(shooter, fire.origin, normalize(fire.dir), players, rewindTo);
  if (!best) return null;
  let dmg = combat.damage * falloff(best.dist, combat.falloff);
  if (best.head) dmg *= HEAD.mult;
  dmg = Math.round(dmg);
  return { victimId: best.victim.id, part: best.head ? 'head' : 'body', dmg, dist: best.dist };
}

// Shotgun: resolve N independent pellets in a spread cone. Each pellet does the
// per-pellet damage; hits on the SAME victim SUM (so more pellets = more damage
// = the fix). Returns Map<victimId, { dmg, part }> (part='head' if any pellet
// was a headshot). Server-side spread randomness is fine (not shared/predicted).
export function resolvePellets(shooter, fire, players, nowServer, offsetForShooter) {
  const combat = WEAPON_COMBAT[fire.weaponId] || WEAPON_COMBAT.ar;
  const rewindTo = Math.min(nowServer, (fire.fireTime || 0) + (offsetForShooter || 0));
  const n = combat.pellets || 1;
  const spread = (combat.spreadDeg || 3) * Math.PI / 180;
  const base = normalize(fire.dir);
  // build an orthonormal basis around the aim direction
  const up = Math.abs(base.y) > 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
  const right = normalize(cross(base, up));
  const realUp = cross(right, base);

  const out = new Map(); // victimId -> { dmg, head }
  for (let i = 0; i < n; i++) {
    // random point in the spread disc (sqrt for uniform area)
    const ang = Math.random() * Math.PI * 2;
    const rad = Math.sqrt(Math.random()) * spread;
    const ox = Math.cos(ang) * Math.sin(rad), oy = Math.sin(ang) * Math.sin(rad);
    const D = normalize({
      x: base.x * Math.cos(rad) + right.x * ox + realUp.x * oy,
      y: base.y * Math.cos(rad) + right.y * ox + realUp.y * oy,
      z: base.z * Math.cos(rad) + right.z * ox + realUp.z * oy,
    });
    const hit = castRay(shooter, fire.origin, D, players, rewindTo);
    if (!hit) continue;
    let dmg = combat.damage * falloff(hit.dist, combat.falloff);
    if (hit.head) dmg *= HEAD.mult;
    const vid = hit.victim.id;
    const cur = out.get(vid) || { dmg: 0, head: false };
    cur.dmg += dmg;
    cur.head = cur.head || hit.head;
    out.set(vid, cur);
  }
  for (const v of out.values()) v.dmg = Math.round(v.dmg);
  return out;
}

/**
 * Resolve one MELEE swing authoritatively (§1C). Same lag-comp rewind path as
 * guns: rewind every other player to the attacker's fireTime, then cast a small
 * FAN of rays inside combat.arcDeg (a swing has an arc, not a needle) and take
 * the nearest victim within the swing's range. No headshot multiplier for melee.
 * bat gets a MOMENTUM bonus (more damage the faster the attacker is moving).
 * @param attack MeleeCmd { fireTime, weaponId, melee:'knife'|'bat', heavy, origin, dir }
 * @returns { victimId, part:'body', dmg, dist, knockback, dir } | null
 */
export function resolveMelee(attacker, attack, players, nowServer, offsetForAttacker) {
  const combat = MELEE[attack.melee] || MELEE.knife;
  const rewindTo = Math.min(nowServer, (attack.fireTime || 0) + (offsetForAttacker || 0));
  const range = attack.heavy ? combat.heavyRange : combat.lightRange;
  const base = normalize(attack.dir);

  // orthonormal basis around the aim (same math as resolvePellets)
  const up = Math.abs(base.y) > 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
  const right = normalize(cross(base, up));
  const realUp = cross(right, base);

  // fan of rays across the arc: center + a spread of offsets inside arcDeg. This
  // is a HORIZONTAL-biased sweep (a swing arcs side-to-side) with a little vertical.
  const arc = (combat.arcDeg || 24) * Math.PI / 180;
  const offsets = [
    { h: 0, v: 0 },
    { h: -arc, v: 0 }, { h: arc, v: 0 },
    { h: -arc * 0.5, v: arc * 0.3 }, { h: arc * 0.5, v: -arc * 0.3 },
  ];

  let best = null;
  for (const off of offsets) {
    const D = normalize({
      x: base.x + right.x * Math.tan(off.h) + realUp.x * Math.tan(off.v),
      y: base.y + right.y * Math.tan(off.h) + realUp.y * Math.tan(off.v),
      z: base.z + right.z * Math.tan(off.h) + realUp.z * Math.tan(off.v),
    });
    const hit = castRay(attacker, attack.origin, D, players, rewindTo);
    if (hit && hit.dist <= range && (!best || hit.dist < best.dist)) best = hit;
  }
  if (!best) return null;

  let dmg = attack.heavy ? combat.heavyDamage : combat.lightDamage;
  // bat momentum bonus: extra damage scaled by how fast the attacker is moving.
  if (attack.melee === 'bat' && combat.momentum > 0) {
    const speed = Math.hypot(attacker.move?.vx || 0, attacker.move?.vz || 0);
    const bonus = combat.momentum * Math.max(0, Math.min(8, speed - 4));
    dmg += bonus;
  }

  return {
    victimId: best.victim.id,
    part: 'body',                 // no headshots for melee (keep it simple)
    dmg: Math.round(dmg),
    dist: best.dist,
    knockback: combat.knockback,
    dir: base,
  };
}

function cross(a, b) { return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }; }

// nearest ray/AABB hit distance (slab), or null
function rayAabb(o, d, min, max) {
  let tmin = 0, tmax = MAX_DIST;
  for (const ax of ['x', 'y', 'z']) {
    const inv = 1 / (d[ax] || 1e-12);
    let t1 = (min[ax] - o[ax]) * inv, t2 = (max[ax] - o[ax]) * inv;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  return tmin > 0.05 ? tmin : null;
}

// Nearest shootable map entity (barrel/destructible) along the ray. entities from
// MapState.hitEntities(). Returns { kind, id, dist } or null.
export function raycastEntities(fire, entities) {
  const O = fire.origin, D = normalize(fire.dir);
  let best = null;
  for (const e of entities) {
    const t = rayAabb(O, D, e.min, e.max);
    if (t !== null && (!best || t < best.dist)) best = { kind: e.kind, id: e.id, dist: t };
  }
  return best;
}

function falloff(dist, fo) {
  if (!fo) return 1;
  if (dist <= fo.start) return 1;
  if (dist >= fo.end) return fo.minMult;
  const t = (dist - fo.start) / (fo.end - fo.start);
  return 1 + (fo.minMult - 1) * t;
}
function normalize(v) {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}
