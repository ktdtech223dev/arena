// RANGE — hitscan helpers (agent D).
// Pure-ish math for spread cones, pellet patterns, damage falloff, plus the
// single-ray fire routine shared by every hitscan gun (and per pellet).
import * as THREE from 'three';

export const MAX_RANGE = 400; // meters — shot rays and tracer misses

const DEG2RAD = Math.PI / 180;

// scratch (module-private — never leaked, results are cloned or written to `out`)
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _worldUp = new THREE.Vector3(0, 1, 0);
const _worldX = new THREE.Vector3(1, 0, 0);

/** Build an orthonormal basis (right, up) perpendicular to dir. */
function coneBasis(dir) {
  const ref = Math.abs(dir.y) > 0.98 ? _worldX : _worldUp;
  _right.crossVectors(dir, ref).normalize();
  _up.crossVectors(_right, dir).normalize();
}

/**
 * Deflect `baseDir` by `angleDeg` at roll `phi` (radians). Writes to `out`
 * (new Vector3 if omitted). baseDir must be normalized.
 */
export function deflectDir(baseDir, angleDeg, phi, out = new THREE.Vector3()) {
  coneBasis(baseDir);
  const r = Math.tan(Math.max(0, angleDeg) * DEG2RAD);
  out.copy(baseDir)
    .addScaledVector(_right, Math.cos(phi) * r)
    .addScaledVector(_up, Math.sin(phi) * r)
    .normalize();
  return out;
}

/**
 * Random direction inside a cone of half-angle `coneDeg` around baseDir.
 * sqrt-distributed radius → uniform-ish density over the cone disc.
 */
export function sampleConeDir(baseDir, coneDeg, out = new THREE.Vector3()) {
  const angle = coneDeg * Math.sqrt(Math.random());
  const phi = Math.random() * Math.PI * 2;
  return deflectDir(baseDir, angle, phi, out);
}

/**
 * Shotgun pattern: `count` directions inside a cone of half-angle `coneDeg`.
 * Slight ring + random: pellet 0 sits near center, the rest ride an evenly
 * spaced ring with per-pellet radius/angle jitter. Returns new Vector3[].
 */
export function pelletDirs(baseDir, coneDeg, count) {
  const dirs = [];
  const ringN = Math.max(1, count - 1);
  const phi0 = Math.random() * Math.PI * 2; // random pattern roll each shot
  for (let i = 0; i < count; i++) {
    let angle, phi;
    if (i === 0) {
      angle = coneDeg * 0.18 * Math.random();
      phi = Math.random() * Math.PI * 2;
    } else {
      const k = i - 1;
      angle = coneDeg * (0.55 + 0.45 * Math.random()); // ring band, jittered radius
      phi = phi0 + (k / ringN) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
    }
    dirs.push(deflectDir(baseDir, angle, phi));
  }
  return dirs;
}

/** Damage multiplier at `dist` meters for falloff {start, end, minMult}. */
export function falloffMult(dist, falloff) {
  if (!falloff) return 1;
  const { start, end, minMult } = falloff;
  if (dist <= start) return 1;
  if (dist >= end) return minMult;
  const t = (dist - start) / Math.max(1e-6, end - start);
  return 1 + (minMult - 1) * t;
}

/**
 * Fire ONE hitscan ray (a bullet, or one pellet of a shot).
 * Raycasts the world, applies damage on target hits, emits shot:impact
 * (only when something was struck) and exactly one shot:tracer.
 * `from` is the tracer's visual origin (muzzle world pos). Returns the hit.
 */
export function fireHitscanRay(ctx, def, origin, dir, from) {
  const hit = ctx.world.raycastShot(origin, dir, MAX_RANGE);

  if (hit && hit.target) {
    const dmg = def.damage * falloffMult(hit.distance, def.falloff);
    ctx.world.targets.damage(hit, dmg, def);
  }
  if (hit) ctx.events.emit('shot:impact', { hit, def });

  const to = hit
    ? _tmp.copy(hit.point).clone()
    : _tmp.copy(origin).addScaledVector(dir, MAX_RANGE).clone();
  ctx.events.emit('shot:tracer', { from: from.clone(), to, def });

  return hit;
}
