// ARENA server — Projectiles.js: authoritative networked projectiles.
// The sawblade (wall-ricochet, pierce), rocket (splash + seekers), seeker
// (homing), and grenade (arc + fuse + splash) are simulated HERE on the server
// tick, collided vs ARENA_WORLD + player capsules, and echoed in snapshots so
// every client renders identical flight. NOT hitscan. See ARENA-ARCHITECTURE §13.
import { ARENA_WORLD, PROJECTILES, GRENADE, CAPSULE } from '../shared/constants.js';

let NEXT_ID = 1;

// point inside AABB expanded by r? returns the outward face normal if so, else null
function wallNormalAt(x, y, z, b, r) {
  if (x <= b.min.x - r || x >= b.max.x + r || y <= b.min.y - r || y >= b.max.y + r || z <= b.min.z - r || z >= b.max.z + r) return null;
  const px = Math.min((b.max.x + r) - x, x - (b.min.x - r));
  const py = Math.min((b.max.y + r) - y, y - (b.min.y - r));
  const pz = Math.min((b.max.z + r) - z, z - (b.min.z - r));
  const cx = (b.min.x + b.max.x) / 2, cy = (b.min.y + b.max.y) / 2, cz = (b.min.z + b.max.z) / 2;
  if (px <= py && px <= pz) return { nx: x < cx ? -1 : 1, ny: 0, nz: 0, pen: px };
  if (py <= pz) return { nx: 0, ny: y < cy ? -1 : 1, nz: 0, pen: py };
  return { nx: 0, ny: 0, nz: z < cz ? -1 : 1, pen: pz };
}

// nearest wall hit for a point (across all colliders)
function hitWall(x, y, z, r) {
  let best = null;
  for (const b of ARENA_WORLD.aabbs) {
    const n = wallNormalAt(x, y, z, b, r);
    if (n && (!best || n.pen < best.pen)) best = n;
  }
  return best;
}

// closest point on a player's vertical capsule axis, and distance to (x,y,z)
function distToPlayer(x, y, z, p) {
  const m = p.move, r = CAPSULE.radius;
  const ay = m.py + r, by = m.py + Math.max((m.height || CAPSULE.standHeight) - r, r);
  const cy = Math.max(ay, Math.min(by, y));
  const dx = x - m.px, dy = y - cy, dz = z - m.pz;
  return { d: Math.hypot(dx, dy, dz), capR: r };
}

export class ProjectileSim {
  constructor() { this.list = []; }

  spawnFromWeapon(weaponId, owner, origin, dir) {
    const combat = PROJECTILES[weaponId] ? weaponId : null;
    // weaponId here is the PROJECTILES key (rocket/sawblade) resolved by caller
    const cfg = PROJECTILES[weaponId];
    if (!cfg) return null;
    return this._spawn(weaponId, owner, origin, dir, cfg, owner.weaponId || weaponId);
  }

  spawnGrenade(owner, origin, dir) {
    const cfg = PROJECTILES.grenade;
    const p = this._spawn('grenade', owner, origin, dir, cfg, 'grenade');
    p.vel.y += cfg.throwUp;    // arc it
    p.fuse = cfg.fuse;
    return p;
  }

  _spawn(kind, owner, origin, dir, cfg, weapon) {
    const L = Math.hypot(dir.x, dir.y, dir.z) || 1;
    const p = {
      id: NEXT_ID++, kind, ownerId: owner.id, weapon,
      pos: { x: origin.x, y: origin.y, z: origin.z },
      vel: { x: (dir.x / L) * cfg.speed, y: (dir.y / L) * cfg.speed, z: (dir.z / L) * cfg.speed },
      cfg, t: 0, bounces: cfg.maxBounces || 0, fuse: 0,
      hitSet: new Set(), target: null, dead: false,
    };
    this.list.push(p);
    return p;
  }

  // main step. api: { damage(attackerId, victimId, dmg, part, weapon), boom(kind,pos,radius) }
  step(dt, players, api) {
    const alive = [];
    for (const p of this.list) {
      if (p.dead) continue;
      this._stepOne(p, dt, players, api);
      if (!p.dead) alive.push(p);
    }
    this.list = alive;
  }

  _stepOne(p, dt, players, api) {
    const cfg = p.cfg;
    p.t += dt;
    if (cfg.life && p.t >= cfg.life) { this._expire(p, players, api); return; }

    // grenade fuse
    if (p.kind === 'grenade') { p.fuse -= dt; if (p.fuse <= 0) { this._explode(p, players, api); return; } }

    // homing (seeker)
    if (p.kind === 'seeker') this._home(p, players, dt);

    // gravity
    if (cfg.gravity) p.vel.y -= cfg.gravity * dt;

    // sub-step so fast projectiles don't tunnel thin players/walls
    const speed = Math.hypot(p.vel.x, p.vel.y, p.vel.z);
    const dist = speed * dt;
    const steps = Math.max(1, Math.ceil(dist / 0.3));
    const sdt = dt / steps;
    for (let s = 0; s < steps && !p.dead; s++) {
      p.pos.x += p.vel.x * sdt; p.pos.y += p.vel.y * sdt; p.pos.z += p.vel.z * sdt;

      // --- player collision (not the owner for direct hits) ---
      if (p.kind !== 'grenade') {
        for (const pl of players.values()) {
          if (!pl.alive) continue;
          if (pl.id === p.ownerId && p.kind !== 'seeker') continue; // seekers can hit owner? no:
          if (pl.id === p.ownerId) continue;
          if (p.hitSet.has(pl.id)) continue;
          const { d, capR } = distToPlayer(p.pos.x, p.pos.y, p.pos.z, pl);
          if (d <= cfg.radius + capR) { this._playerHit(p, pl, players, api); if (p.dead) return; }
        }
      }

      // --- wall collision (seekers get a brief spawn grace so they can escape
      //     the blast surface they were born on instead of self-detonating) ---
      if (!(p.kind === 'seeker' && p.t < 0.18)) {
        const w = hitWall(p.pos.x, p.pos.y, p.pos.z, cfg.radius);
        if (w) { this._wallHit(p, w, players, api); if (p.dead) return; }
      }
    }
  }

  // BEHAVIOR kind: cfg.kind aliases variants onto a base behavior (mini→rocket,
  // bolt/disc→sawblade) while p.kind stays the wire kind the client renders.
  _behavior(p) { return p.cfg.kind || p.kind; }

  _playerHit(p, pl, players, api) {
    const bk = this._behavior(p);
    if (bk === 'sawblade') {
      api.damage(p.ownerId, pl.id, p.cfg.damage, 'body', p.weapon);
      if (p.cfg.pierce === false) { p.dead = true; return; } // bolt: dies on the hit
      p.hitSet.add(pl.id); // pierce: keep flying, don't re-hit this leg
    } else if (bk === 'rocket') {
      this._explode(p, players, api);
    } else if (bk === 'seeker') {
      this._explode(p, players, api);
    }
  }

  _wallHit(p, w, players, api) {
    const bk = this._behavior(p);
    if (bk === 'sawblade') {
      if (p.bounces > 0) {
        this._reflect(p, w, 1.0);
        p.bounces--;
        p.hitSet.clear();               // may re-cross players on the new leg
        api.boom('bounce', { ...p.pos }, 0.5);
      } else { p.dead = true; }
    } else if (bk === 'rocket' || bk === 'seeker') {
      this._explode(p, players, api);
    } else if (bk === 'grenade') {
      this._reflect(p, w, p.cfg.bounce, p.cfg.friction);
      api.boom('bounce', { ...p.pos }, 0.3);
    }
  }

  _reflect(p, w, restitution, friction = 1) {
    const n = { x: w.nx, y: w.ny, z: w.nz };
    const vn = p.vel.x * n.x + p.vel.y * n.y + p.vel.z * n.z;
    // reflect: v' = v - (1+e)(v·n)n  ; tangential *friction
    p.vel.x -= (1 + restitution) * vn * n.x;
    p.vel.y -= (1 + restitution) * vn * n.y;
    p.vel.z -= (1 + restitution) * vn * n.z;
    if (friction !== 1) {
      // remove some tangential speed
      const vnAfter = p.vel.x * n.x + p.vel.y * n.y + p.vel.z * n.z;
      const tx = p.vel.x - vnAfter * n.x, ty = p.vel.y - vnAfter * n.y, tz = p.vel.z - vnAfter * n.z;
      p.vel.x = vnAfter * n.x + tx * friction;
      p.vel.y = vnAfter * n.y + ty * friction;
      p.vel.z = vnAfter * n.z + tz * friction;
    }
    // push out of the surface
    p.pos.x += n.x * (w.pen + 0.02); p.pos.y += n.y * (w.pen + 0.02); p.pos.z += n.z * (w.pen + 0.02);
  }

  _home(p, players, dt) {
    // (re)acquire nearest enemy within seek radius
    const seekR = (p.cfg.turn && p.seekR) || 20;
    let best = null, bestD = Infinity;
    for (const pl of players.values()) {
      if (!pl.alive || pl.id === p.ownerId) continue;
      const dx = pl.move.px - p.pos.x, dy = (pl.move.py + 0.9) - p.pos.y, dz = pl.move.pz - p.pos.z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bestD) { bestD = d; best = pl; }
    }
    if (!best) return;
    const tx = best.move.px - p.pos.x, ty = (best.move.py + 0.9) - p.pos.y, tz = best.move.pz - p.pos.z;
    const tl = Math.hypot(tx, ty, tz) || 1;
    const dx = tx / tl, dy = ty / tl, dz = tz / tl;
    const speed = Math.hypot(p.vel.x, p.vel.y, p.vel.z) || p.cfg.speed;
    let vx = p.vel.x / speed, vy = p.vel.y / speed, vz = p.vel.z / speed;
    const dot = Math.max(-1, Math.min(1, vx * dx + vy * dy + vz * dz));
    const ang = Math.acos(dot);
    const step = Math.min(1, (p.cfg.turn * dt) / (ang || 1e-6));
    vx += (dx - vx) * step; vy += (dy - vy) * step; vz += (dz - vz) * step;
    const nl = Math.hypot(vx, vy, vz) || 1;
    p.vel.x = (vx / nl) * speed; p.vel.y = (vy / nl) * speed; p.vel.z = (vz / nl) * speed;
  }

  _explode(p, players, api) {
    const cfg = p.cfg;
    const radius = cfg.splashRadius || 3;
    api.boom(p.kind === 'seeker' ? 'seeker' : (p.kind === 'grenade' ? 'grenade' : 'explosion'), { ...p.pos }, radius);
    // centralized splash — hits players AND map entities (barrels/destructibles)
    if (api.splash) api.splash({ ...p.pos }, radius, cfg.splashDamage || cfg.damage || 50, cfg.splashMinFrac ?? 0.25, p.ownerId, p.weapon);
    else this._splash(p.pos, radius, cfg.splashDamage || cfg.damage || 50, cfg.splashMinFrac ?? 0.25, p.ownerId, p.weapon, players, api);
    if (this._behavior(p) === 'rocket' && cfg.seekers) this._spawnSeekers(p, players);
    p.dead = true;
  }

  _explodeGrenade(p, players, api) { this._explode(p, players, api); }

  _expire(p, players, api) {
    const bk = this._behavior(p);
    if (bk === 'rocket' || bk === 'seeker' || bk === 'grenade') this._explode(p, players, api);
    else p.dead = true; // sawblade just vanishes
  }

  _splash(center, radius, maxDmg, minFrac, attackerId, weapon, players, api) {
    for (const pl of players.values()) {
      if (!pl.alive) continue;
      const { d } = distToPlayer(center.x, center.y, center.z, pl);
      if (d > radius) continue;
      const frac = 1 - (1 - minFrac) * (d / radius); // 1 at center → minFrac at edge
      const dmg = Math.round(maxDmg * Math.max(minFrac, frac));
      api.damage(attackerId, pl.id, dmg, 'body', weapon);
    }
  }

  _spawnSeekers(rocket, players) {
    const cfg = PROJECTILES.rocket, scfg = PROJECTILES.seeker;
    const n = cfg.seekers;
    // pick up to n nearest enemies within seekRadius (spread seekers across them)
    const enemies = [...players.values()].filter((pl) => pl.alive && pl.id !== rocket.ownerId)
      .map((pl) => ({ pl, d: Math.hypot(pl.move.px - rocket.pos.x, pl.move.pz - rocket.pos.z) }))
      .filter((e) => e.d <= cfg.seekRadius).sort((a, b) => a.d - b.d);
    for (let i = 0; i < n; i++) {
      // fan the seekers upward/outward; homing takes over immediately
      const ang = (i / n) * Math.PI * 2;
      const dir = { x: Math.cos(ang) * 0.5, y: 0.8, z: Math.sin(ang) * 0.5 };
      const owner = { id: rocket.ownerId, weaponId: 'exotic' };
      const origin = { x: rocket.pos.x, y: rocket.pos.y + 0.3, z: rocket.pos.z };
      const s = this._spawn('seeker', owner, origin, dir, scfg, 'exotic');
      s.seekR = cfg.seekRadius;
    }
  }

  serialize() {
    const out = [];
    for (const p of this.list) {
      if (p.dead) continue;
      out.push({ id: p.id, kind: p.kind, pos: { x: +p.pos.x.toFixed(3), y: +p.pos.y.toFixed(3), z: +p.pos.z.toFixed(3) }, vel: { x: +p.vel.x.toFixed(2), y: +p.vel.y.toFixed(2), z: +p.vel.z.toFixed(2) }, owner: p.ownerId, t: +p.t.toFixed(2) });
    }
    return out;
  }
}
