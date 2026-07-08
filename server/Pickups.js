// ARENA server — Pickups.js: authoritative gameplay-object pickups for a map.
// Owns the runtime state of a map's `pickups` (weapon/health/armor/powerup) and
// jump `pads`. Managed by Game: reset on setMap, stepped each tick against live
// players. Grants are server-authoritative; the snapshot carries which pickups
// are currently alive so the client can render/hide them. Never throws on a
// missing/empty pickup list (built-in maps have none → no-op).
import { POWERUPS } from '../shared/custommap.js';

const PICK_RADIUS = 1.3;   // horizontal grab distance (m)
const PICK_VSPAN = 2.5;    // vertical grab distance (m)

export class Pickups {
  constructor() { this.load(null); }

  // (re)load for a map: fresh, all-alive pickup state + the pad AABBs.
  load(map) {
    this.list = Array.isArray(map?.pickups) ? map.pickups : [];
    this.pads = Array.isArray(map?.pads) ? map.pads : [];
    this.state = {}; // id -> { alive, respawnAt }
    for (const pk of this.list) {
      this.state[pk.id] = { alive: true, respawnAt: 0 };
      if (Array.isArray(pk.pool) && pk.pool.length) pk.current = rollFrom(pk.pool); // random spawner: initial roll
    }
  }

  // Per-tick: respawn timers, grab detection + grant, jump-pad launches, buff
  // expiry. `grant` is a callback (player, pickup) so Game owns the effects and
  // the client 'pickup' emit. `now` is ms.
  step(now, players, grant) {
    // 1) respawns + grabs
    for (const pk of this.list) {
      const st = this.state[pk.id];
      if (!st) continue;
      if (!st.alive) {
        // re-roll a random spawner when it respawns (server = the only roller)
        if (now >= st.respawnAt) { st.alive = true; if (Array.isArray(pk.pool) && pk.pool.length) pk.current = rollFrom(pk.pool); }
        continue;
      }
      // find the first alive player within reach (horizontal + vertical)
      for (const p of players.values()) {
        if (!p.alive) continue;
        const dx = p.move.px - pk.pos.x, dz = p.move.pz - pk.pos.z;
        if (dx * dx + dz * dz > PICK_RADIUS * PICK_RADIUS) continue;
        if (Math.abs(p.move.py - pk.pos.y) > PICK_VSPAN) continue;
        st.alive = false;
        st.respawnAt = now + (pk.respawnMs || 10000);
        grant(p, pk);
        break;
      }
    }

    // 2) jump pads: launch players standing/falling onto a pad AABB.
    for (const pad of this.pads) {
      const boost = pad.boost || 14;
      for (const p of players.values()) {
        if (!p.alive) continue;
        const m = p.move;
        if (m.px < pad.min.x || m.px > pad.max.x || m.pz < pad.min.z || m.pz > pad.max.z) continue;
        if (m.py < pad.min.y - 0.3 || m.py > pad.max.y + 1.2) continue;
        if (m.vy <= 0.01) { m.vy = boost; m.grounded = false; m.state = 'AIRBORNE'; }
      }
    }
  }

  // Expire timed buffs on a player (called each tick by Game for every player).
  static expireBuffs(p, now) {
    const b = p.buffs;
    if (!b) return;
    if (b.dmgExpiry && now >= b.dmgExpiry) { b.dmgExpiry = 0; p.dmgMult = 1; }
    if (b.speedExpiry && now >= b.speedExpiry) { b.speedExpiry = 0; p.speedMult = 1; }
  }

  // Apply a powerup buff to a player (weapon/health/armor handled by Game).
  static applyPowerup(p, key, now) {
    const def = POWERUPS[key];
    if (!def) return;
    p.buffs = p.buffs || {};
    if (typeof def.dmgMult === 'number') { p.dmgMult = def.dmgMult; p.buffs.dmgExpiry = now + (def.durMs || 0); p.buffs.dmgKind = key; }
    if (typeof def.speedMult === 'number') { p.speedMult = def.speedMult; p.buffs.speedExpiry = now + (def.durMs || 0); }
    if (typeof def.shield === 'number') { p.shield = def.shield; }
  }

  // Snapshot the alive pickups (client renders/hides accordingly). Pooled random
  // spawners carry their currently-rolled weapon so the marker can reflect it;
  // everything else is a bare id (the client tolerates both shapes).
  serialize() {
    const alive = [];
    for (const pk of this.list) {
      const st = this.state[pk.id];
      if (!st || !st.alive) continue;
      if (pk.pool && pk.current) alive.push({ id: pk.id, weapon: pk.current });
      else alive.push(pk.id);
    }
    return alive;
  }

  // The active powerup + remaining ms on a player (for the HUD). Prefers the
  // damage/quad buff, then speed; overshield reported via player.shield directly.
  static activePowerup(p, now) {
    const b = p.buffs;
    if (!b) return null;
    if (b.dmgExpiry && now < b.dmgExpiry) return { kind: b.dmgKind || 'damage', remainingMs: b.dmgExpiry - now };
    if (b.speedExpiry && now < b.speedExpiry) return { kind: 'speed', remainingMs: b.speedExpiry - now };
    return null;
  }
}

// server-authoritative random pick from a pool (the ONLY place a random spawner is
// rolled, so all clients agree via the snapshot).
function rollFrom(pool) { return pool[(Math.random() * pool.length) | 0]; }
