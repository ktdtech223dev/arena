// ARENA server — TdSim.js: the authoritative CO-OP Tower Defense simulation.
// Runs inside Game when the lobby mode is 'td' (FOUNDRY map). The whole crew
// shares ONE run: one gold pool, one core, one horde. Enemies are dist-along-
// path entities (client re-derives exact positions from shared tddata math, so
// the wire state is tiny); units attack server-side; player SHOTS resolve here
// against enemy capsules (walls occlude). Personal loadouts: everyone starts
// with the PISTOL, buys guns (max 2) + gun upgrade tiers at the armory — the
// server applies each player's damage multiplier, the client applies handling.
import {
  ENEMY_DEFS, ENEMY_IDS, UNIT_DEFS, UNIT_BY_ID, composeWave, canUpgrade, applyMods,
  tdPointAt, tdPathLength, tdEnemyPos, tdDistToPath, TD_PATH_W, TD_CORE, TD_ARMORY,
  TD_START_GOLD, TD_CORE_HP, TD_SELL_FRAC, TD_SHOP, TD_MAX_GUNS, WEAPON_TREES, PLAYER_UPGRADES,
} from '../shared/tddata.js';

const BUILD_MIN = TD_PATH_W / 2 + 1.1;
const BUILD_MAX = 14;
const SPACING = 2.6;
const RESTART_MS = 9000;

let NEXT_EID = 1, NEXT_UID = 1;

// segment vs AABB — nearest-hit t in [0,1] (wall occlusion for player shots)
function segBoxT(ax, ay, az, bx, by, bz, box) {
  let tmin = 0, tmax = 1;
  const d = [bx - ax, by - ay, bz - az], o = [ax, ay, az];
  const mn = [box.min.x, box.min.y, box.min.z], mx = [box.max.x, box.max.y, box.max.z];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) { if (o[i] < mn[i] || o[i] > mx[i]) return null; continue; }
    let t1 = (mn[i] - o[i]) / d[i], t2 = (mx[i] - o[i]) / d[i];
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  return tmin;
}

export class TdSim {
  constructor(game) {
    this.game = game;
    this.reset();
  }

  reset() {
    this.phase = 'build'; this.wave = 0;
    this.gold = TD_START_GOLD;
    this.coreHp = TD_CORE_HP; this.coreMax = TD_CORE_HP;
    this.enemies = [];          // {id, defId, def, dist, hp, maxHp, shield, fx:{...effects}, spawnT, lastHit}
    this.units = [];            // {uid, defId, x, z, tiers:[a,b], stats, invested, owner, cool, heat...}
    this.kits = new Map();      // playerId -> { guns:['pistol'], tiers:{gun:[a,b]}, up:{pdmg,pspeed,phealth} }
    this._queue = []; this._spawnT = 0; this._comp = null;
    this._t = 0; this._restartAt = 0;
    this.fx = [];               // batched client fx events (drained onto the 16Hz snap)
    this._enemySnapT = 0;
  }

  kit(pid) {
    let k = this.kits.get(pid);
    if (!k) { k = { guns: ['pistol'], tiers: { pistol: [0, 0] }, up: { pdmg: 0, pspeed: 0, phealth: 0 } }; this.kits.set(pid, k); }
    return k;
  }

  /** Per-player, per-weapon damage multiplier (gun tree dmgMult × self pdmg). */
  dmgMult(pid, weaponId) {
    const k = this.kit(pid);
    const base = String(weaponId || '').replace(/_alt$/, '');
    let m = 1 + k.up.pdmg * (PLAYER_UPGRADES[0].mult);
    const tree = WEAPON_TREES[base];
    const tiers = k.tiers[base];
    if (tree && tiers) {
      for (let p = 0; p < 2; p++) for (let t = 0; t < tiers[p]; t++) {
        const mod = tree.paths[p][t]?.mod;
        if (mod?.dmgMult) m *= mod.dmgMult;
      }
    }
    return m;
  }

  // ------------------------------------------------------------ commands ----
  place(player, defId, x, z) {
    if (this.phase === 'over') return { ok: false, why: 'over' };
    const def = UNIT_BY_ID[defId];
    if (!def) return { ok: false, why: 'bad unit' };
    if (this.gold < def.cost) return { ok: false, why: 'gold' };
    const d = tdDistToPath(x, z);
    if (!(d >= BUILD_MIN && d <= BUILD_MAX)) return { ok: false, why: 'spot' };
    if (Math.hypot(x - TD_CORE.x, z - TD_CORE.z) < 6 || Math.hypot(x - TD_ARMORY.x, z - TD_ARMORY.z) < 3.5) return { ok: false, why: 'spot' };
    for (const u of this.units) if (Math.hypot(u.x - x, u.z - z) < SPACING) return { ok: false, why: 'spot' };
    this.gold -= def.cost;
    const u = { uid: NEXT_UID++, defId, def, x, z, tiers: [0, 0], stats: { ...def }, invested: def.cost, owner: player.id, cool: 0, heat: 0, kills: 0, _freezeT: 0, _pulseT: 0 };
    this.units.push(u);
    this.fx.push({ k: 'place', x, z });
    return { ok: true, uid: u.uid };
  }

  upgradeUnit(player, uid, pathIdx) {
    const u = this.units.find((x) => x.uid === uid);
    if (!u || (pathIdx !== 0 && pathIdx !== 1)) return { ok: false };
    if (!canUpgrade(u.tiers, pathIdx)) return { ok: false, why: 'locked' };
    const up = u.def.paths[pathIdx][u.tiers[pathIdx]];
    if (!up || this.gold < up.cost) return { ok: false, why: 'gold' };
    this.gold -= up.cost; u.invested += up.cost;
    u.tiers[pathIdx]++;
    applyMods(u.stats, up.mod);
    this.fx.push({ k: 'upgrade', x: u.x, z: u.z });
    return { ok: true };
  }

  sell(player, uid) {
    const i = this.units.findIndex((x) => x.uid === uid);
    if (i < 0) return { ok: false };
    this.gold += Math.round(this.units[i].invested * TD_SELL_FRAC);
    this.fx.push({ k: 'sell', x: this.units[i].x, z: this.units[i].z });
    this.units.splice(i, 1);
    return { ok: true };
  }

  buyWeapon(player, weaponId, dropId) {
    const item = TD_SHOP.find((s) => s.id === weaponId);
    const k = this.kit(player.id);
    if (!item || k.guns.includes(weaponId)) return { ok: false };
    if (this.gold < item.cost) return { ok: false, why: 'gold' };
    if (k.guns.length >= TD_MAX_GUNS) {
      const di = k.guns.indexOf(dropId);
      if (di < 0) return { ok: false, why: 'full' }; // must name a gun to drop
      k.guns.splice(di, 1);
    }
    this.gold -= item.cost;
    k.guns.push(weaponId);
    if (!k.tiers[weaponId]) k.tiers[weaponId] = [0, 0];
    return { ok: true, guns: k.guns };
  }

  upgradeWeapon(player, weaponId, pathIdx) {
    const k = this.kit(player.id);
    const tree = WEAPON_TREES[weaponId];
    if (!tree || !k.guns.includes(weaponId) || (pathIdx !== 0 && pathIdx !== 1)) return { ok: false };
    const tiers = k.tiers[weaponId] || (k.tiers[weaponId] = [0, 0]);
    if (!canUpgrade(tiers, pathIdx)) return { ok: false, why: 'locked' };
    const up = tree.paths[pathIdx][tiers[pathIdx]];
    if (!up || this.gold < up.cost) return { ok: false, why: 'gold' };
    this.gold -= up.cost;
    tiers[pathIdx]++;
    return { ok: true, tiers };
  }

  selfUpgrade(player, upId) {
    const def = PLAYER_UPGRADES.find((u) => u.id === upId);
    const k = this.kit(player.id);
    if (!def || k.up[upId] >= def.tiers) return { ok: false };
    const cost = def.cost(k.up[upId]);
    if (this.gold < cost) return { ok: false, why: 'gold' };
    this.gold -= cost;
    k.up[upId]++;
    return { ok: true, up: k.up };
  }

  startWave(player) {
    if (this.phase !== 'build') return { ok: false };
    this.wave++;
    this.phase = 'wave';
    this._comp = composeWave(this.wave);
    this._queue = [];
    for (const m of this._comp.mix) for (let i = 0; i < m.count; i++) this._queue.push({ id: m.id, gapS: m.gapS });
    this._spawnT = 0.6;
    this.game.io.emit('td_wave', { wave: this.wave, count: this._queue.length, queen: this.wave % 10 === 0 });
    return { ok: true };
  }

  // ---------------------------------------------------------- player shots --
  /** Resolve one player hitscan/pellet shot against the horde (walls occlude). */
  playerShot(shooter, fire, world, combat) {
    const o = fire.origin, dir = fire.dir;
    if (!o || !dir) return null;
    const L = Math.hypot(dir.x, dir.y, dir.z) || 1;
    const d = { x: dir.x / L, y: dir.y / L, z: dir.z / L };
    const RANGE = 240;
    const bx = o.x + d.x * RANGE, by = o.y + d.y * RANGE, bz = o.z + d.z * RANGE;
    // nearest wall t
    let wallT = 1;
    for (const box of world.aabbs) {
      if (box.max.y < -10) continue;
      const t = segBoxT(o.x, o.y, o.z, bx, by, bz, box);
      if (t != null && t < wallT) wallT = t;
    }
    // nearest enemy capsule hit before the wall
    let best = null, bestT = wallT;
    for (const e of this.enemies) {
      if (e.hp <= 0 || e.phased) continue;
      const p = tdEnemyPos(e.id, e.def, e.dist, this._t);
      const h = e.def.size * 1.9;
      const r = e.def.size * 0.55;
      const t = segBoxT(o.x, o.y, o.z, bx, by, bz, { min: { x: p.x - r, y: p.y, z: p.z - r }, max: { x: p.x + r, y: p.y + h, z: p.z + r } });
      if (t != null && t < bestT) { bestT = t; best = { e, p, h }; }
    }
    if (!best) return null;
    const hitY = o.y + d.y * RANGE * bestT;
    const head = hitY > best.p.y + best.h * 0.72;
    const mult = (head ? 1.8 : 1) * this.dmgMult(shooter.id, fire.weaponId);
    const dmg = (combat?.damage || 20) * mult;
    const res = this.damageEnemy(best.e, dmg, { armorPierce: 0, byPlayer: shooter.id });
    return { dist: RANGE * bestT, killed: res.killed, head };
  }

  /** Splash from player explosives (rockets/grenades/concussion). */
  playerSplash(center, radius, maxDmg, attackerId) {
    for (const e of this.enemies) {
      if (e.hp <= 0) continue;
      const p = tdEnemyPos(e.id, e.def, e.dist, this._t);
      const dd = Math.hypot(p.x - center.x, (p.y + 1) - center.y, p.z - center.z);
      if (dd > radius) continue;
      this.damageEnemy(e, maxDmg * (1 - 0.6 * (dd / radius)) * this.dmgMult(attackerId, 'ar'), { byPlayer: attackerId });
    }
  }

  damageEnemy(e, dmg, opts = {}) {
    if (e.hp <= 0 || (e.phased && !opts.dot)) return { killed: false };
    let d = dmg * (e.fx.vuln || 1) * (this._t < (e.fx.markUntil || 0) ? (e.fx.mark || 1) : 1);
    if (!opts.ignoreArmor) d = Math.max(1, d - Math.max(0, e.def.armor * (1 - (opts.armorPierce || 0))));
    e.lastHit = this._t;
    if (e.shield > 0) { const a = Math.min(e.shield, d); e.shield -= a; d -= a; }
    e.hp -= d;
    if (e.hp <= 0) { this._killEnemy(e, opts); return { killed: true }; }
    return { killed: false };
  }

  _killEnemy(e, opts) {
    // gold (bounty beacons near the corpse multiply; killstreak ledgers add)
    const p = tdEnemyPos(e.id, e.def, e.dist, this._t);
    let mult = 1, streakGold = 0;
    for (const u of this.units) {
      if (!u.stats.goldMult && !u.stats.streakGold) continue;
      if (Math.hypot(u.x - p.x, u.z - p.z) > u.stats.range) continue;
      if (u.stats.goldMult) mult = Math.max(mult, u.stats.goldMult);
      if (u.stats.streakGold) streakGold = Math.max(streakGold, u.stats.streakGold);
    }
    this.gold += Math.round(e.def.bounty * mult) + streakGold;
    this.fx.push({ k: 'die', x: p.x, y: p.y + 1, z: p.z, f: e.def.family === 'zombie' ? 0 : 1, q: e.defId === 'queen' ? 1 : undefined, by: opts.byPlayer });
    if (e.def.boomOnDeath) {
      for (const o of this.enemies) {
        if (o === e || o.hp <= 0) continue;
        const op = tdEnemyPos(o.id, o.def, o.dist, this._t);
        if (Math.hypot(op.x - p.x, op.z - p.z) <= e.def.boomOnDeath) this.damageEnemy(o, 30, {});
      }
      this.fx.push({ k: 'boom', x: p.x, y: p.y + 0.8, z: p.z, r: e.def.boomOnDeath });
    }
  }

  // ------------------------------------------------------------- sim tick ---
  step(dt, now, players) {
    if (this.phase === 'over') {
      if (this._restartAt && now >= this._restartAt) { this.reset(); this.game.io.emit('td_reset', {}); }
      return;
    }
    this._t += dt;

    // spawn queue
    if (this.phase === 'wave' && this._queue.length) {
      this._spawnT -= dt;
      if (this._spawnT <= 0) {
        const s = this._queue.shift();
        this.spawnEnemy(s.id);
        this._spawnT = s.gapS * (0.7 + Math.random() * 0.6);
      }
    }

    // haste sources
    const hasters = this.enemies.filter((e) => e.hp > 0 && e.def.hasteAura);

    // enemies advance
    for (const e of this.enemies) {
      if (e.hp <= 0) continue;
      const def = e.def;
      // phasing
      if (def.phaseS) {
        e._phaseT += dt;
        if (!e.phased && e._phaseT >= def.phaseEvery) { e.phased = true; e._phaseT = 0; }
        else if (e.phased && e._phaseT >= def.phaseS) { e.phased = false; e._phaseT = 0; }
      }
      // shield regen
      if (def.shieldRegen && this._t - (e.lastHit || 0) > 2.5 && e.shield < e.maxShield) e.shield = Math.min(e.maxShield, e.shield + def.shieldRegen * dt);
      // DoTs
      if (this._t < (e.fx.burnUntil || 0)) this.damageEnemy(e, (e.fx.burnDps || 0) * dt, { dot: true, ignoreArmor: true });
      if (e.hp <= 0) continue;
      if (this._t < (e.fx.acidUntil || 0)) this.damageEnemy(e, (e.fx.acidDps || 0) * dt, { dot: true, ignoreArmor: true });
      if (e.hp <= 0) continue;
      // queen spawns
      if (def.spawns) { e._spawnT += dt; if (e._spawnT >= def.spawnEvery) { e._spawnT = 0; this.spawnEnemy(def.spawns, e.dist); } }
      // speed
      let sp = def.speed;
      if (this._t < (e.fx.stunUntil || 0) || this._t < (e.fx.freezeUntil || 0)) sp = 0;
      else if (this._t < (e.fx.slowUntil || 0)) sp *= (e.fx.slow || 1);
      for (const h of hasters) { if (h !== e && Math.abs(h.dist - e.dist) < h.def.hasteR) { sp *= h.def.hasteAura; break; } }
      e.v = sp;
      e.dist += sp * dt;
      // leak
      if (e.dist >= tdPathLength() - 0.5) {
        e.hp = 0;
        this.coreHp -= def.coreDmg;
        this.fx.push({ k: 'leak', d: def.coreDmg });
        if (this.coreHp <= 0) this._gameOver();
      }
    }
    this.enemies = this.enemies.filter((e) => e.hp > 0);

    // units attack
    for (const u of this.units) this._unitTick(u, dt);

    // core shield cap + regen (shield generators)
    let coreCap = this.coreMax, regen = 0;
    for (const u of this.units) { if (u.stats.coreShield) coreCap = Math.max(coreCap, this.coreMax + u.stats.coreShield); if (u.stats.coreRegen) regen += u.stats.coreRegen; }
    if (regen) this.coreHp = Math.min(coreCap, this.coreHp + regen * dt);

    // wave end
    if (this.phase === 'wave' && !this._queue.length && !this.enemies.length) {
      this.phase = 'build';
      let interest = 0, waveBonus = 0;
      for (const u of this.units) { if (u.stats.interest) interest = Math.max(interest, Math.min(0.07, u.stats.interest)); if (u.stats.waveBonus) waveBonus += u.stats.waveBonus; }
      const bonus = this._comp.bonus + Math.round(this.gold * interest) + waveBonus;
      this.gold += bonus;
      this.game.io.emit('td_wavedone', { wave: this.wave, bonus });
    }
  }

  spawnEnemy(defId, atDist = 0) {
    const def = ENEMY_DEFS[defId];
    if (!def) return;
    const hpMult = this._comp?.hpMult || 1;
    this.enemies.push({
      id: NEXT_EID++, defId, def, dist: atDist,
      hp: Math.round(def.hp * hpMult), maxHp: Math.round(def.hp * hpMult),
      shield: def.shield ? def.shield * hpMult : 0, maxShield: def.shield ? def.shield * hpMult : 0,
      fx: {}, v: def.speed, phased: false, _phaseT: Math.random() * (def.phaseEvery || 1), _spawnT: 0, lastHit: 0,
    });
  }

  _gameOver() {
    this.phase = 'over';
    this._restartAt = Date.now() + RESTART_MS;
    this.game.io.emit('td_over', { wave: this.wave, restartInMs: RESTART_MS });
  }

  // ---- unit behaviors (positions are plain {x,z}; enemy pos via shared math) --
  _enemiesNear(x, z, r) {
    const out = [];
    for (const e of this.enemies) {
      if (e.hp <= 0) continue;
      const p = tdEnemyPos(e.id, e.def, e.dist, this._t);
      if (Math.hypot(p.x - x, p.z - z) <= r) out.push({ e, p });
    }
    return out;
  }

  _buffAt(u) {
    let dmg = 1, rate = 1, crit = 0, critM = 1.8;
    for (const o of this.units) {
      if (o === u || !o.stats.aura) continue;
      if (Math.hypot(o.x - u.x, o.z - u.z) > o.stats.range) continue;
      const s = o.stats;
      if (s.buffDmg) dmg = Math.max(dmg, s.buffDmg);
      if (s.buffRate) rate = Math.max(rate, s.buffRate);
      if (s.surgeMult && (this._t % (s.surgeEvery || 10)) < (s.surgeS || 3)) rate = Math.max(rate, s.surgeMult);
      if (s.auraCrit && s.critChance > crit) { crit = s.critChance; critM = s.critMult || 1.8; }
    }
    return { dmg, rate, crit, critM };
  }

  _applyRiders(e, s) {
    if (s.stunS) e.fx.stunUntil = Math.max(e.fx.stunUntil || 0, this._t + s.stunS);
    if (s.burnDps) { e.fx.burnDps = Math.max(e.fx.burnDps || 0, s.burnDps); e.fx.burnUntil = this._t + (s.burnS || 3); }
    if (s.acidDps) { e.fx.acidDps = Math.max(e.fx.acidDps || 0, s.acidDps); e.fx.acidUntil = this._t + (s.acidS || 3); }
    if (s.markMult) { e.fx.mark = Math.max(e.fx.mark || 1, s.markMult); e.fx.markUntil = this._t + (s.markS || 3); }
    if (s.slow) { e.fx.slow = Math.min(e.fx.slowUntil > this._t ? (e.fx.slow || 1) : 1, 1 - s.slow); e.fx.slowUntil = this._t + 1.2; }
  }

  _unitHit(u, e, dmg) {
    const res = this.damageEnemy(e, dmg, { armorPierce: u.stats.armorPierce || 0 });
    this._applyRiders(e, u.stats);
    if (res.killed) u.kills++;
    return res;
  }

  _unitTick(u, dt) {
    const s = u.stats;
    const buff = this._buffAt(u);

    // ---- aura units act continuously ----
    if (s.aura) {
      if (s.slow || s.pull || s.auraDps || s.vulnMult) {
        for (const { e } of this._enemiesNear(u.x, u.z, s.range)) {
          if (s.slow) { e.fx.slow = 1 - s.slow; e.fx.slowUntil = this._t + 0.3; }
          if (s.vulnMult) e.fx.vuln = Math.max(e.fx.vuln || 1, s.vulnMult);
          if (s.auraDps) { const r = this.damageEnemy(e, s.auraDps * dt, { ignoreArmor: true, dot: true }); if (r.killed) u.kills++; }
          if (s.pull) e.dist = Math.max(0, e.dist - s.pull * dt * 0.4);
        }
        if (s.freezeS) {
          u._freezeT += dt;
          if (u._freezeT >= (s.freezeEvery || 6)) {
            u._freezeT = 0;
            for (const { e } of this._enemiesNear(u.x, u.z, s.range)) e.fx.freezeUntil = this._t + s.freezeS;
            this.fx.push({ k: 'freeze', x: u.x, z: u.z, r: s.range });
          }
        }
      }
      if (s.pulsePush) {
        u._pulseT += dt;
        if (u._pulseT >= Math.max(2, s.pulseEvery ?? 5)) {
          u._pulseT = 0;
          for (const { e } of this._enemiesNear(u.x, u.z, s.range * 0.8)) { e.dist = Math.max(0, e.dist - s.pulsePush * 0.4); if (s.pulseSlow) { e.fx.slow = 1 - s.pulseSlow; e.fx.slowUntil = this._t + 2; } }
          this.fx.push({ k: 'pulse', x: u.x, z: u.z, r: s.range * 0.8 });
        }
      }
      return;
    }

    // ---- beam units (plasma) ----
    if (s.beamDps) {
      const near = this._enemiesNear(u.x, u.z, s.range);
      near.sort((a, b) => b.e.dist - a.e.dist);
      const targets = near.slice(0, Math.max(1, s.beams || 1));
      const first = targets[0]?.e || null;
      u.heat = first && first === u._beamT ? Math.min(u.heat + dt, s.rampS || 3) : 0;
      u._beamT = first;
      const ramp = 1 + (u.heat / (s.rampS || 3)) * ((s.rampMult || 2.5) - 1);
      u._beamAcc = (u._beamAcc || 0) + dt;
      for (const { e, p } of targets) {
        const r = this.damageEnemy(e, s.beamDps * ramp * buff.dmg * dt, { armorPierce: s.armorPierce || 0, dot: true });
        this._applyRiders(e, s);
        if (r.killed) u.kills++;
        if (u._beamAcc > 0.24) this.fx.push({ k: 'beam', u: u.uid, x: p.x, y: p.y + e.def.size, z: p.z });
      }
      if (u._beamAcc > 0.24) u._beamAcc = 0;
      return;
    }

    // ---- shooters ----
    u.cool -= dt;
    if (u.cool > 0 || !s.rate) return;
    const inRange = this._enemiesNear(u.x, u.z, s.range);
    if (!inRange.length) return;
    let pick = inRange[0];
    for (const c of inRange) {
      if (s.targeting === 'strong' ? c.e.hp > pick.e.hp : c.e.dist > pick.e.dist) pick = c;
    }
    u.cool = 1 / (s.rate * buff.rate);
    let dmg = (s.dmg || 0) * buff.dmg;
    const critC = s.critChance || buff.crit;
    if (critC && Math.random() < critC) dmg *= (s.critMult || buff.critM);
    const { e, p } = pick;

    if (s.pierceLine) {
      const dx = p.x - u.x, dz = p.z - u.z, ln = Math.hypot(dx, dz) || 1;
      const nx = dx / ln, nz = dz / ln;
      let hits = 0;
      for (const c of this.enemies) {
        if (c.hp <= 0 || hits > s.pierceLine) continue;
        const cp = tdEnemyPos(c.id, c.def, c.dist, this._t);
        const along = (cp.x - u.x) * nx + (cp.z - u.z) * nz;
        if (along < 0 || along > s.range + 6) continue;
        const lat = Math.abs((cp.x - u.x) * nz - (cp.z - u.z) * nx);
        if (lat < 1.3) { this._unitHit(u, c, dmg); hits++; }
      }
      this.fx.push({ k: 'rail', u: u.uid, x: u.x + nx * (s.range + 4), y: 1.2, z: u.z + nz * (s.range + 4) });
    } else if (s.chain) {
      let cur = pick, remaining = 1 + s.chain, hitSet = new Set(), prev = { x: u.x, y: 1.4, z: u.z };
      const pts = [];
      while (cur && remaining-- > 0) {
        this._unitHit(u, cur.e, dmg);
        hitSet.add(cur.e);
        pts.push([+cur.p.x.toFixed(1), +(cur.p.y + 1).toFixed(1), +cur.p.z.toFixed(1)]);
        prev = cur.p;
        let next = null, nd = 6;
        for (const c of this.enemies) {
          if (c.hp <= 0 || hitSet.has(c)) continue;
          const cp = tdEnemyPos(c.id, c.def, c.dist, this._t);
          const dd = Math.hypot(cp.x - prev.x, cp.z - prev.z);
          if (dd < nd) { nd = dd; next = { e: c, p: cp }; }
        }
        cur = next; dmg *= 0.8;
      }
      this.fx.push({ k: 'chain', u: u.uid, pts });
    } else if (s.splash) {
      for (const c of this._enemiesNear(p.x, p.z, s.splash)) this._unitHit(u, c.e, dmg * (c.e === e ? 1 : 0.7));
      this.fx.push({ k: 'mortar', u: u.uid, x: p.x, y: p.y, z: p.z, r: s.splash });
      if (s.cluster) {
        for (let i = 0; i < s.cluster; i++) {
          const cx = p.x + (Math.random() - 0.5) * s.splash * 2.2, cz = p.z + (Math.random() - 0.5) * s.splash * 2.2;
          for (const c of this._enemiesNear(cx, cz, 1.8)) this._unitHit(u, c.e, dmg * 0.45);
          this.fx.push({ k: 'boom', x: cx, y: 0.4, z: cz, r: 1.6 });
        }
      }
    } else if (s.drones) {
      const targets = inRange.slice(0, s.drones);
      for (const c of targets) {
        this._unitHit(u, c.e, dmg);
        this.fx.push({ k: 'drone', u: u.uid, x: c.p.x, y: c.p.y + 1.2, z: c.p.z });
        if (s.boomDmg && Math.random() < 0.35) {
          for (const c2 of this._enemiesNear(c.p.x, c.p.z, s.splash || 2)) this._unitHit(u, c2.e, s.boomDmg * 0.5);
          this.fx.push({ k: 'boom', x: c.p.x, y: c.p.y + 1, z: c.p.z, r: s.splash || 2 });
        }
      }
    } else {
      this._unitHit(u, e, dmg);
      this.fx.push({ k: 'shot', u: u.uid, x: p.x, y: p.y + e.def.size, z: p.z });
    }
  }

  // ------------------------------------------------------------- snapshots --
  /** Light state — rides EVERY snapshot (tiny). */
  serialize() {
    return {
      phase: this.phase, wave: this.wave, gold: Math.round(this.gold),
      core: Math.round(this.coreHp), coreMax: this.coreMax,
      left: this.enemies.length + this._queue.length,
    };
  }

  /** Heavy state — enemies + units + fx, sent at ~16 Hz (client interpolates). */
  serializeHeavy() {
    const enemies = this.enemies.map((e) => [
      e.id, ENEMY_IDS.indexOf(e.defId), +e.dist.toFixed(2), +(e.v || 0).toFixed(2),
      Math.round((e.hp / e.maxHp) * 100), e.maxShield ? Math.round((e.shield / e.maxShield) * 100) : 0,
      e.phased ? 1 : 0,
    ]);
    const units = this.units.map((u) => [u.uid, u.defId, +u.x.toFixed(1), +u.z.toFixed(1), u.tiers[0], u.tiers[1], u.owner, u.invested]);
    const fx = this.fx;
    this.fx = [];
    return { enemies, units, fx };
  }

  /** Per-player kit snapshot (guns/tiers/self-ups) for the armory UI. */
  serializeKit(pid) { return this.kit(pid); }
}
