// ARENA server — MapState.js: authoritative per-map mechanic simulation.
// Owns the runtime state of a map's DYNAMIC objects — doors (proximity open/
// close), explosive barrels (shoot → explode → splash + chain), destructible
// walls (shoot → break), and world hazards (damage players standing in them).
// Moving platforms are time-based (shared/mapsim) so they need no state here.
// Provides the LIVE collision world (open doors + broken walls removed, platforms
// placed) that movement runs against, and serializes dynamic state for snapshots.
import { getMap } from '../shared/maps.js';
import { buildLiveWorld } from '../shared/mapsim.js';
import { CAPSULE } from '../shared/constants.js';

const BARREL = { radius: 0.45, splashRadius: 4.5, splashDamage: 90, splashMinFrac: 0.25 };

export class MapState {
  constructor(mapId) { this.load(mapId); }

  load(mapId) {
    this.map = getMap(mapId);
    this.mapId = this.map.id;
    this.doors = {};        // id -> openFrac 0..1
    this.barrels = {};      // id -> { hp, alive, pos }
    this.destr = {};        // id -> { hp, alive }
    this.destroyed = new Set();
    this._hazAccum = new Map(); // playerId -> fractional hazard damage
    for (const d of this.map.doors) this.doors[d.id] = 0;
    for (const b of this.map.barrels) this.barrels[b.id] = { hp: b.hp, alive: true, pos: b.pos };
    for (const w of this.map.destructibles) this.destr[w.id] = { hp: w.hp, alive: true };
  }

  spawns() { return this.map.spawns; }
  liveWorld(t) { return buildLiveWorld(this.map, { doors: this.doors, destroyed: this.destroyed }, t); }

  // world entities a shot/ray can hit (barrels + intact destructibles) as AABBs.
  hitEntities() {
    const out = [];
    for (const b of this.map.barrels) { const s = this.barrels[b.id]; if (s.alive) out.push({ kind: 'barrel', id: b.id, min: { x: b.pos.x - BARREL.radius, y: b.pos.y, z: b.pos.z - BARREL.radius }, max: { x: b.pos.x + BARREL.radius, y: b.pos.y + 1.1, z: b.pos.z + BARREL.radius } }); }
    for (const w of this.map.destructibles) { const s = this.destr[w.id]; if (s.alive) out.push({ kind: 'destructible', id: w.id, min: w.min, max: w.max }); }
    return out;
  }

  // ---- damage entry points (called from Game on shot/splash) ----
  damageEntity(kind, id, dmg, attackerId, api) {
    if (kind === 'barrel') this.damageBarrel(id, dmg, attackerId, api);
    else if (kind === 'destructible') this.damageDestructible(id, dmg, api);
  }
  damageBarrel(id, dmg, attackerId, api) {
    const s = this.barrels[id]; if (!s || !s.alive) return;
    s.hp -= dmg;
    if (s.hp <= 0) this.explodeBarrel(id, attackerId, api);
  }
  explodeBarrel(id, attackerId, api, depth = 0) {
    const s = this.barrels[id]; if (!s || !s.alive) return;
    s.alive = false;
    const c = { x: s.pos.x, y: s.pos.y + 0.6, z: s.pos.z };
    api.boom('explosion', c, BARREL.splashRadius);
    api.splash(c, BARREL.splashRadius, BARREL.splashDamage, BARREL.splashMinFrac, attackerId, 'barrel');
    // chain: nearby live barrels detonate a beat later (depth-capped)
    if (depth < 4) {
      for (const b of this.map.barrels) {
        const os = this.barrels[b.id];
        if (!os.alive) continue;
        const d = Math.hypot(b.pos.x - s.pos.x, b.pos.y - s.pos.y, b.pos.z - s.pos.z);
        if (d <= BARREL.splashRadius) this.explodeBarrel(b.id, attackerId, api, depth + 1);
      }
    }
  }
  damageDestructible(id, dmg, api) {
    const s = this.destr[id]; if (!s || !s.alive) return;
    s.hp -= dmg;
    if (s.hp <= 0) { s.alive = false; this.destroyed.add(id); api.boom('bounce', midpoint(this.map.destructibles.find((w) => w.id === id)), 1.2); }
  }

  // ---- per-tick step ----
  step(dt, t, players, api) {
    // doors: open while a player is near, else close
    for (const dr of this.map.doors) {
      if (dr.trigger !== 'proximity') continue;
      const c = { x: (dr.min.x + dr.max.x) / 2, y: (dr.min.y + dr.max.y) / 2, z: (dr.min.z + dr.max.z) / 2 };
      let near = false;
      for (const p of players.values()) {
        if (!p.alive) continue;
        const dx = p.move.px - c.x, dz = p.move.pz - c.z;
        if (dx * dx + dz * dz < 16) { near = true; break; } // within 4 m
      }
      const target = near ? 1 : 0;
      const rate = 3 * dt; // ~0.33 s to open/close
      this.doors[dr.id] += Math.sign(target - this.doors[dr.id]) * Math.min(rate, Math.abs(target - this.doors[dr.id]));
    }
    // hazards: damage players standing inside (accumulate fractional dps)
    for (const hz of this.map.hazards) {
      for (const p of players.values()) {
        if (!p.alive) continue;
        const inX = p.move.px > hz.min.x && p.move.px < hz.max.x;
        const inZ = p.move.pz > hz.min.z && p.move.pz < hz.max.z;
        const inY = p.move.py < hz.max.y + 0.2;
        if (inX && inZ && inY) {
          const key = p.id;
          const acc = (this._hazAccum.get(key) || 0) + hz.dps * dt;
          if (acc >= 1) { const whole = Math.floor(acc); api.damage(hz.id, p.id, whole, 'body', hz.type); this._hazAccum.set(key, acc - whole); }
          else this._hazAccum.set(key, acc);
        }
      }
    }
  }

  serialize() {
    const doors = {}; for (const id in this.doors) doors[id] = +this.doors[id].toFixed(3);
    return {
      mapId: this.mapId,
      doors,
      barrels: this.map.barrels.filter((b) => this.barrels[b.id].alive).map((b) => b.id),
      destroyed: [...this.destroyed],
    };
  }
}

function midpoint(w) { return w ? { x: (w.min.x + w.max.x) / 2, y: (w.min.y + w.max.y) / 2, z: (w.min.z + w.max.z) / 2 } : { x: 0, y: 0, z: 0 }; }
