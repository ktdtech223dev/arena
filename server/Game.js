// ARENA server — Game.js: the authoritative fixed-tick simulation (map-driven).
// Per tick (128 Hz): build the map's LIVE collision world (open doors + broken
// walls removed, platforms placed); advance each player via shared movement-core
// against it; step map mechanics (doors/hazards); step networked projectiles;
// resolve hitscan shots (players + shootable barrels/destructibles) with lag-comp;
// route ALL damage/splash through one shared path; emit snapshots (players +
// projectiles + map dynamic state).
import { TICK_RATE, RESPAWN_MS, SERVER_DT, WEAPON_COMBAT, ACCOLADES } from '../shared/constants.js';
import { resolveShot, resolvePellets, raycastEntities, resolveMelee } from './Hits.js';
import { buildSnapshot, recordHistory } from './Snapshots.js';
import { ProjectileSim } from './Projectiles.js';
import { MapState } from './MapState.js';
import { Accolades } from './Accolades.js';
import { Pickups } from './Pickups.js';
import { CUSTOM_RAW } from '../shared/maps.js';

const TICK_MS = 1000 / TICK_RATE;

export class Game {
  constructor(io, lobby) {
    this.io = io;
    this.lobby = lobby;
    this.projectiles = new ProjectileSim();
    this.map = new MapState(lobby.settings.currentMap);
    this.pickups = new Pickups();
    this.pickups.load(this.map.map); // gameplay-object pickups + jump pads for this map
    this.accolades = new Accolades(io, lobby, ACCOLADES); // server-authoritative kill medals
    this.tickCount = 0;
    this._timer = null; this._acc = 0; this._last = 0;
  }

  start() {
    this._last = Date.now(); this._acc = 0;
    const loop = () => {
      const now = Date.now();
      this._acc += now - this._last; this._last = now;
      let steps = 0;
      while (this._acc >= TICK_MS && steps < 60) { this.tick(now); this._acc -= TICK_MS; steps++; }
      if (this._acc > 250) this._acc = 250;
      if (this._acc >= TICK_MS) setImmediate(loop);
      else this._timer = setTimeout(loop, 1);
    };
    loop();
  }
  stop() { if (this._timer) clearTimeout(this._timer); this._timer = null; }

  setMap(id) {
    this.map.load(id);
    this.pickups.load(this.map.map); // fresh map = fresh, all-alive pickups
    this.lobby.settings.currentMap = this.map.mapId;
    const now = Date.now();
    for (const p of this.lobby.players.values()) { const s = this.lobby.farSpawn(); p.respawn(s, now); }
    this.accolades.resetMatch(); // a map swap starts a fresh match for medals
    // custom maps: include the raw authored JSON so clients can register + render it.
    this.io.emit('map_change', { mapId: this.map.mapId, map: this.map.serialize(), custom: CUSTOM_RAW.get(this.map.mapId) || null });
  }

  // GRANT a pickup's effect to a player (server-authoritative). Emits a 'pickup'
  // event to that player so the client can switch weapon / show a HUD cue.
  grantPickup(p, pk, now) {
    if (pk.kind === 'health') p.hp = Math.min(100, p.hp + (pk.amount || 50));
    else if (pk.kind === 'armor') p.armor = Math.min(100, (p.armor || 0) + (pk.amount || 50));
    else if (pk.kind === 'weapon') { if (pk.weapon) p.weaponId = pk.weapon; }
    else if (pk.kind === 'powerup') Pickups.applyPowerup(p, pk.powerup, now);
    this.io.to(p.id).emit('pickup', { id: pk.id, kind: pk.kind, weapon: pk.weapon, powerup: pk.powerup });
  }

  spawnProjectile(player, projKind, origin, dir) { if (player.alive) this.projectiles.spawnFromWeapon(projKind, player, origin, dir); }
  throwGrenade(player, origin, dir) { if (player.alive) this.projectiles.spawnGrenade(player, origin, dir); }

  // ONE shared player-damage path (hitscan + projectiles + splash + hazards).
  applyDamage(attackerId, victimId, dmg, part, weapon, now) {
    const victim = this.lobby.players.get(victimId);
    if (!victim || !victim.alive || dmg <= 0) return;
    // ATTACKER's active damage/quad powerup multiplies outgoing damage.
    const attacker0 = this.lobby.players.get(attackerId);
    if (attacker0 && attacker0.dmgMult && attacker0.dmgMult !== 1) dmg = Math.round(dmg * attacker0.dmgMult);
    // VICTIM's overshield absorbs first, then hp takes the overflow.
    if (victim.shield > 0) {
      const absorbed = Math.min(victim.shield, dmg);
      victim.shield -= absorbed;
      dmg -= absorbed;
    }
    if (dmg <= 0) {
      this.io.emit('hit', { attacker: attackerId, victim: victimId, dmg: 0, part, victimHp: victim.hp, killed: false, weapon });
      return;
    }
    victim.hp -= dmg;
    const killed = victim.hp <= 0;
    this.io.emit('hit', { attacker: attackerId, victim: victimId, dmg, part, victimHp: Math.max(0, victim.hp), killed, weapon });
    if (killed) {
      victim.alive = false; victim.respawnAt = now + RESPAWN_MS;
      this.io.emit('death', { id: victimId, by: attackerId, weapon, headshot: part === 'head', respawnInMs: RESPAWN_MS });
      // ACCOLADES (server owns kills → server owns medals). Distance = attacker↔victim
      // at kill time (drives longshot/trickshot); attacker.move gives the movement fsm.
      const attacker = this.lobby.players.get(attackerId);
      if (attacker && attackerId !== victimId) {
        const dist = Math.hypot(attacker.move.px - victim.move.px, attacker.move.py - victim.move.py, attacker.move.pz - victim.move.pz);
        this.accolades.onKill(attacker, victim, { weapon, part, dist, now });
      }
      this.accolades.onDeath(victimId, attackerId);
    }
  }

  // Area splash → players (falloff) AND map entities (barrels chain, walls break).
  splashAll(center, radius, maxDmg, minFrac, attackerId, weapon, now) {
    for (const pl of this.lobby.players.values()) {
      if (!pl.alive) continue;
      const cy = Math.max(pl.move.py, Math.min(pl.move.py + (pl.move.height || 1.8), center.y));
      const d = Math.hypot(center.x - pl.move.px, center.y - cy, center.z - pl.move.pz);
      if (d > radius) continue;
      const frac = 1 - (1 - minFrac) * (d / radius);
      this.applyDamage(attackerId, pl.id, Math.round(maxDmg * Math.max(minFrac, frac)), 'body', weapon, now);
    }
    for (const e of this.map.hitEntities()) {
      const cx = (e.min.x + e.max.x) / 2, cyy = (e.min.y + e.max.y) / 2, cz = (e.min.z + e.max.z) / 2;
      if (Math.hypot(cx - center.x, cyy - center.y, cz - center.z) <= radius) {
        this.map.damageEntity(e.kind, e.id, Math.round(maxDmg * 0.7), attackerId, this._api);
      }
    }
  }

  tick(now) {
    const players = this.lobby.players;
    const t = now / 1000;
    this.tickCount++;

    // shared mechanic/damage api (barrels/projectiles/hazards all use it)
    const api = this._api = {
      damage: (aid, vid, dmg, part, weapon) => this.applyDamage(aid, vid, dmg, part, weapon, now),
      boom: (kind, pos, radius) => this.io.emit('boom', { kind, pos, radius }),
      splash: (center, radius, maxDmg, minFrac, aid, weapon) => this.splashAll(center, radius, maxDmg, minFrac, aid, weapon, now),
    };

    // 1) live world (doors/destructibles/platforms) → 2) movement
    const world = this.map.liveWorld(t);
    for (const p of players.values()) p.processInputs(world);

    // 3) history for lag-comp rewind
    recordHistory(players, now);

    // 4) map mechanics (doors open/close, hazard damage)
    this.map.step(SERVER_DT, t, players, api);

    // 5) networked projectiles
    this.projectiles.step(SERVER_DT, players, api);

    // 6) hitscan shots (players + shootable entities), lag-comp
    const entities = this.map.hitEntities();
    for (const shooter of players.values()) {
      if (!shooter.pendingShots.length) continue;
      const shots = shooter.pendingShots; shooter.pendingShots = [];
      for (const fire of shots) {
        if (!shooter.alive) break;
        if (WEAPON_COMBAT[fire.weaponId]?.pellets) {
          const map = resolvePellets(shooter, fire, players, now, shooter.clockOffset || 0);
          for (const [vid, r] of map) if (r.dmg > 0) this.applyDamage(shooter.id, vid, r.dmg, r.part, fire.weaponId, now);
        } else {
          const res = resolveShot(shooter, fire, players, now, shooter.clockOffset || 0);
          const ent = raycastEntities(fire, entities);
          if (ent && (!res || ent.dist < res.dist)) {
            this.map.damageEntity(ent.kind, ent.id, WEAPON_COMBAT[fire.weaponId]?.damage || 24, shooter.id, api);
          } else if (res) {
            this.applyDamage(shooter.id, res.victimId, res.dmg, res.part, fire.weaponId, now);
          }
        }
      }
    }

    // 6b) MELEE swings (§1C): same lag-comp path as hitscan. On a hit, apply
    // damage through the shared path (weapon id flows to the death event for the
    // accolade system) AND shove the victim's velocity along the swing dir.
    for (const shooter of players.values()) {
      if (!shooter.pendingMelee.length) continue;
      const swings = shooter.pendingMelee; shooter.pendingMelee = [];
      for (const attack of swings) {
        if (!shooter.alive) break;
        const res = resolveMelee(shooter, attack, players, now, shooter.clockOffset || 0);
        if (!res) continue;
        this.applyDamage(shooter.id, res.victimId, res.dmg, res.part, attack.weaponId || attack.melee, now);
        // knockback: shove the victim (if still alive) along the swing direction.
        const victim = players.get(res.victimId);
        if (victim && victim.alive) {
          victim.move.vx += res.dir.x * res.knockback;
          victim.move.vy += Math.max(res.dir.y, 0.25) * res.knockback * 0.5 + 1;
          victim.move.vz += res.dir.z * res.knockback;
        }
      }
    }

    // 7) respawns
    for (const p of players.values()) {
      if (!p.alive && p.respawnAt && now >= p.respawnAt) {
        const spawn = this.lobby.farSpawn();
        p.respawn(spawn, now);
        this.io.emit('respawn', { id: p.id, pos: spawn.pos, yaw: spawn.yaw });
      }
    }

    // 7b) powerup buffs expire (dmg/quad, speed) → reset multipliers.
    for (const p of players.values()) Pickups.expireBuffs(p, now);

    // 7c) gameplay-object pickups (grab + grant + respawn) + jump pads.
    this.pickups.step(now, players, (pl, pk) => this.grantPickup(pl, pk, now));

    // 8) snapshots (players + projectiles + map dynamic state + pickups)
    const projSnap = this.projectiles.serialize();
    const mapSnap = this.map.serialize();
    const pickSnap = this.pickups.serialize();
    for (const p of players.values()) {
      const snap = buildSnapshot(players, this.tickCount, now, p);
      snap.projectiles = projSnap;
      snap.map = mapSnap;
      snap.pickups = pickSnap;
      this.io.to(p.id).emit('snapshot', snap);
    }
  }
}
