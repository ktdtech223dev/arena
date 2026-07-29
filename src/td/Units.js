// TOWER DEFENSE — Units.js: the 15 placeable defense units.
// Code-built models on a shared chassis language (base plinth + role body) that
// VISUALLY GROW with upgrades: each purchased tier bolts on parts (bigger
// barrels, extra coils, banners, crowns) and tier-3 recolors the glow — so a
// maxed unit reads across the map (BTD-style). Behavior sim is local (TD is a
// single-player mode): targeting, bullets/beams/AoE/chains, auras
// (slow/pull/buff/economy), and the branching upgrade application with lockout.
import * as THREE from 'three';
import { UNIT_DEFS, canUpgrade } from './data.js';

const T3_GLOW = 0xffd166; // maxed-path glow
function mat(color, opts = {}) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: opts.rough ?? 0.6, metalness: opts.metal ?? 0.35 });
  if (opts.emissive) { m.emissive = new THREE.Color(opts.emissive); m.emissiveIntensity = opts.emissiveI ?? 0.8; }
  return m;
}
function box(parent, m, w, h, d, x, y, z, ry = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z); mesh.rotation.y = ry; mesh.castShadow = true;
  parent.add(mesh); return mesh;
}
function cyl(parent, m, r0, r1, h, x, y, z, seg = 10) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, h, seg), m);
  mesh.position.set(x, y, z); mesh.castShadow = true;
  parent.add(mesh); return mesh;
}

// role accent colors
const ACCENT = { damage: 0xff8a4a, buff: 0x9fe86a, debuff: 0x7db2ff, economy: 0xffd166 };

// build/refresh a unit's model for its current tiers. Returns { group, parts }.
function buildUnitModel(def, tiers) {
  const g = new THREE.Group();
  const acc = ACCENT[def.role] || 0xffffff;
  const t3 = tiers[0] >= 3 || tiers[1] >= 3;
  const glowC = t3 ? T3_GLOW : acc;
  const body = mat(0x2a3340, { metal: 0.5, rough: 0.45 });
  const glow = mat(0x101820, { emissive: glowC, emissiveI: 1.1 });
  const parts = { yawNode: null, muzzle: null };
  // plinth + pedestal (every unit)
  cyl(g, body, 0.85, 1.05, 0.5, 0, 0.25, 0, 12);
  cyl(g, glow, 0.9, 0.9, 0.08, 0, 0.55, 0, 12);
  const yaw = new THREE.Group(); yaw.position.y = 0.6; g.add(yaw);
  parts.yawNode = yaw;
  const total = tiers[0] + tiers[1];

  switch (def.id) {
    case 'gatling': {
      const head = box(yaw, body, 0.7, 0.5, 0.9, 0, 0.5, 0);
      const barrels = tiers[0] >= 2 ? 3 : 1;
      for (let i = 0; i < barrels; i++) cyl(yaw, mat(0x1a2028, { metal: 0.7 }), 0.07, 0.07, 0.9, (i - (barrels - 1) / 2) * 0.18, 0.5, 0.55).rotation.x = Math.PI / 2;
      if (tiers[1] >= 1) box(yaw, glow, 0.16, 0.1, 0.5, 0, 0.82, 0.2); // AP feed
      if (tiers[0] >= 3 || tiers[1] >= 3) box(yaw, glow, 0.8, 0.12, 0.12, 0, 0.2, 0.4);
      parts.muzzle = new THREE.Vector3(0, 1.1, 1); head.userData.spin = tiers[0] >= 2;
      break; }
    case 'railcannon': {
      box(yaw, body, 0.5, 0.5, 0.6, 0, 0.4, -0.2);
      const rail = box(yaw, mat(0x1a2028, { metal: 0.8 }), 0.22, 0.22, 1.7 + total * 0.15, 0, 0.55, 0.5);
      box(rail, glow, 0.26, 0.06, 1.2, 0, 0.15, 0);
      if (tiers[1] >= 1) cyl(yaw, glow, 0.2, 0.2, 0.1, 0, 0.55, 1.3, 8);
      break; }
    case 'mortar': {
      const tube = cyl(yaw, body, 0.3, 0.4, 1.2 + tiers[1] * 0.1, 0, 0.9, 0);
      tube.rotation.x = -0.7;
      if (tiers[0] >= 1) cyl(yaw, mat(0x3a1a0a, { emissive: 0xff6a1a, emissiveI: 0.9 }), 0.32, 0.32, 0.1, 0, 1.2, -0.35, 10);
      if (tiers[1] >= 2) for (const s of [-1, 1]) cyl(yaw, body, 0.14, 0.18, 0.7, s * 0.4, 0.7, 0).rotation.x = -0.7;
      break; }
    case 'tesla': {
      cyl(yaw, body, 0.16, 0.3, 1.4, 0, 0.7, 0);
      const orbs = 1 + Math.max(tiers[0], tiers[1] >= 2 ? 2 : 0);
      for (let i = 0; i < orbs; i++) {
        const o = new THREE.Mesh(new THREE.SphereGeometry(0.16 + (i === 0 ? 0.1 : 0), 10, 8), glow);
        o.position.set(Math.sin(i * 2.1) * 0.3 * Math.min(i, 1), 1.5 + i * 0.22, Math.cos(i * 2.1) * 0.3 * Math.min(i, 1));
        yaw.add(o);
      }
      break; }
    case 'cryo': {
      const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42 + total * 0.05, 0), mat(0x0a2a3a, { emissive: 0x7df9ff, emissiveI: 1.2 }));
      core.position.y = 1.1; yaw.add(core); parts.spinner = core;
      for (let i = 0; i < 2 + tiers[1]; i++) box(yaw, mat(0x18313f, { metal: 0.4 }), 0.1, 0.7, 0.1, Math.sin(i * 2.4) * 0.5, 0.75, Math.cos(i * 2.4) * 0.5);
      break; }
    case 'acid': {
      cyl(yaw, mat(0x2a3a1a), 0.4, 0.5, 0.8, 0, 0.5, 0);
      const tank = new THREE.Mesh(new THREE.SphereGeometry(0.34 + tiers[0] * 0.05, 10, 8), mat(0x1a3a12, { emissive: 0x88ff2a, emissiveI: 0.9 }));
      tank.position.y = 1.15; yaw.add(tank); parts.spinner = tank;
      cyl(yaw, body, 0.06, 0.06, 0.7, 0, 0.75, 0.45).rotation.x = Math.PI / 2;
      break; }
    case 'hive': {
      box(yaw, body, 0.9, 0.7, 0.9, 0, 0.55, 0);
      for (let i = 0; i < 2 + tiers[0]; i++) box(yaw, glow, 0.16, 0.16, 0.16, Math.sin(i * 2.4) * 0.35, 1.05, Math.cos(i * 2.4) * 0.35);
      if (tiers[1] >= 1) box(yaw, mat(0x3a1a0a, { emissive: 0xff6a1a, emissiveI: 0.8 }), 0.5, 0.1, 0.5, 0, 0.95, 0);
      break; }
    case 'sniper': {
      box(yaw, body, 0.5, 0.4, 0.5, 0, 0.5, 0);
      cyl(yaw, mat(0x1a2028, { metal: 0.8 }), 0.06, 0.06, 1.9 + tiers[0] * 0.2, 0, 0.75, 0.8).rotation.x = Math.PI / 2;
      if (tiers[1] >= 1) box(yaw, glow, 0.14, 0.14, 0.3, 0.2, 0.9, 0.4); // spotter optic
      break; }
    case 'banner': {
      cyl(yaw, mat(0x4a3a2a), 0.05, 0.07, 2.2 + tiers[1] * 0.2, 0, 1.1, 0, 8);
      const flag = box(yaw, mat(0x5a1a1a, { emissive: 0xff6b6b, emissiveI: 0.5 + tiers[0] * 0.2 }), 0.9 + tiers[0] * 0.15, 0.55, 0.04, 0.5, 1.9, 0);
      parts.flag = flag;
      break; }
    case 'overclocker': {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.5 + tiers[1] * 0.08, 0.08, 8, 20), glow);
      ring.position.y = 1.2; yaw.add(ring); parts.spinner = ring;
      cyl(yaw, body, 0.2, 0.3, 1.1, 0, 0.55, 0);
      break; }
    case 'depot': {
      box(yaw, body, 1.0, 0.6, 0.8, 0, 0.4, 0);
      for (let i = 0; i <= Math.min(2, total); i++) box(yaw, mat(0x4a3a1a, { emissive: 0xffcf6a, emissiveI: 0.5 }), 0.32, 0.2, 0.5, -0.28 + i * 0.28, 0.82, 0);
      break; }
    case 'shieldgen': {
      cyl(yaw, body, 0.35, 0.45, 0.9, 0, 0.55, 0);
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.42 + tiers[0] * 0.06, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x10202e, { emissive: 0x4da6ff, emissiveI: 1 }));
      dome.position.y = 1.05; yaw.add(dome);
      break; }
    case 'gravwell': {
      const orb = new THREE.Mesh(new THREE.SphereGeometry(0.4 + tiers[0] * 0.05, 12, 10), mat(0x14102a, { emissive: 0xb15bff, emissiveI: 1.3 }));
      orb.position.y = 1.25; yaw.add(orb); parts.spinner = orb;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.62 + tiers[1] * 0.1, 0.05, 8, 22), glow);
      ring.position.y = 1.25; ring.rotation.x = Math.PI / 2.4; yaw.add(ring);
      break; }
    case 'bounty': {
      cyl(yaw, mat(0x4a3a1a, { metal: 0.7 }), 0.3, 0.42, 1.0, 0, 0.6, 0, 8);
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.26 + total * 0.04), mat(0x3a2a0a, { emissive: 0xffd166, emissiveI: 1.4 }));
      gem.position.y = 1.45; yaw.add(gem); parts.spinner = gem;
      break; }
    case 'plasma': {
      box(yaw, body, 0.5, 0.5, 0.7, 0, 0.5, 0);
      const beams = 1 + (tiers[1] >= 1 ? tiers[1] : 0);
      for (let i = 0; i < Math.min(beams, 4); i++) cyl(yaw, glow, 0.08, 0.12, 0.8, (i - (Math.min(beams, 4) - 1) / 2) * 0.24, 0.72, 0.4, 8).rotation.x = Math.PI / 2;
      break; }
  }
  return { group: g, parts };
}

// ---------------------------------------------------------------------------
export class Unit {
  constructor(def, pos, td) {
    this.def = def;
    this.td = td;
    this.tiers = [0, 0];
    this.invested = def.cost;
    this.stats = { ...def };      // live stats (mods merge in)
    this.pos = pos.clone();
    this.cool = 0;
    this._surgeT = 0; this._pulseT = 0; this._freezeT = 0;
    this.kills = 0;
    this._beamTargets = [];
    this._rebuild();
  }

  _rebuild() {
    const scene = this.td.ctx.scene;
    if (this.model) { scene.remove(this.model.group); this.model.group.traverse((o) => { if (o.isMesh) { o.geometry?.dispose?.(); o.material?.dispose?.(); } }); }
    this.model = buildUnitModel(this.def, this.tiers);
    this.model.group.position.copy(this.pos);
    scene.add(this.model.group);
  }

  upgrade(pathIdx) {
    if (!canUpgrade(this, pathIdx)) return { ok: false, why: 'locked' };
    const up = this.def.paths[pathIdx][this.tiers[pathIdx]];
    if (!up) return { ok: false, why: 'maxed' };
    if (this.td.gold < up.cost) return { ok: false, why: 'gold' };
    this.td.gold -= up.cost;
    this.invested += up.cost;
    this.tiers[pathIdx]++;
    this._applyModsFrom(up.mod);
    this._rebuild();
    return { ok: true };
  }

  // Numeric-mod convention: keys in DELTA_KEYS accumulate (+N per tier); every
  // other numeric key is an ABSOLUTE tier value (each tier replaces the last —
  // e.g. stunS 0.6 → 1.2 → 2). Non-numeric values always set.
  static DELTA_KEYS = new Set(['dmg', 'rate', 'range', 'chain', 'splash', 'drones', 'beamDps', 'burnDps', 'acidDps', 'goldMult', 'buffDmg', 'buffRate', 'coreShield', 'coreRegen', 'pull', 'rampMult', 'rampS', 'pulseEvery']);
  _applyModsFrom(mod) {
    for (const [k, v] of Object.entries(mod)) {
      if (typeof v !== 'number') { this.stats[k] = v; continue; }
      if (Unit.DELTA_KEYS.has(k)) this.stats[k] = (this.stats[k] ?? 0) + v;
      else this.stats[k] = v;
    }
  }

  // aura math is read by TDMode (buffs) and Enemies (slow/pull); attack sim here.
  fixedUpdate(dt, now) {
    const s = this.stats;
    const buff = this.td.buffAt(this.pos, this); // {dmg, rate} from banners/overclockers
    // spinner flourish
    if (this.model.parts.spinner) this.model.parts.spinner.rotation.y += dt * 2;

    // AURA units act continuously
    if (s.aura) { this._auraTick(dt, now); return; }

    this.cool -= dt * (s.rate > 0 ? 1 : 0);
    // BEAM units (plasma): continuous damage with ramp
    if (s.beamDps) { this._beamTick(dt, now, buff); return; }
    if (this.cool > 0 || !s.rate) return;

    const target = this._pickTarget();
    if (!target) return;
    this.cool = 1 / (s.rate * (buff.rate || 1));
    this._face(target);
    this._fire(target, buff, now);
  }

  _pickTarget() {
    const s = this.stats;
    let best = null, bestKey = -Infinity;
    for (const e of this.td.enemies) {
      if (!e.alive || e.phased) continue;
      if (e.pos.distanceTo(this.pos) > s.range) continue;
      const key = s.targeting === 'strong' ? e.hp : e.dist; // furthest-along default
      if (key > bestKey) { bestKey = key; best = e; }
    }
    return best;
  }

  _face(e) {
    const y = this.model.parts.yawNode;
    if (y) y.rotation.y = Math.atan2(e.pos.x - this.pos.x, e.pos.z - this.pos.z);
  }

  _fire(target, buff, now) {
    const s = this.stats;
    const td = this.td;
    let dmg = (s.dmg || 0) * (buff.dmg || 1);
    if (s.critChance && Math.random() < s.critChance) dmg *= (s.critMult || 2);
    const from = this.pos.clone().add(new THREE.Vector3(0, 1.4, 0));
    const to = target.pos.clone().add(new THREE.Vector3(0, target.def.size, 0));
    td.fxShot(from, to, ACCENT[this.def.role]);

    if (s.pierceLine) {
      // railcannon line: hit everything within 1.2m of the firing line
      const dir = to.clone().sub(from).normalize();
      let hits = 0;
      for (const e of td.enemies) {
        if (!e.alive || hits > s.pierceLine) continue;
        const rel = e.pos.clone().add(new THREE.Vector3(0, 1, 0)).sub(from);
        const along = rel.dot(dir);
        if (along < 0 || along > s.range + 6) continue;
        if (rel.sub(dir.clone().multiplyScalar(along)).length() < 1.3) { this._hit(e, dmg, now); hits++; }
      }
    } else if (s.chain) {
      let cur = target, remaining = 1 + s.chain, prevPos = from, hitSet = new Set();
      while (cur && remaining-- > 0) {
        td.fxShot(prevPos, cur.pos.clone().add(new THREE.Vector3(0, 1, 0)), 0x7df9ff);
        this._hit(cur, dmg, now);
        hitSet.add(cur);
        prevPos = cur.pos.clone().add(new THREE.Vector3(0, 1, 0));
        let next = null, nd = 6;
        for (const e of td.enemies) { if (!e.alive || hitSet.has(e)) continue; const d = e.pos.distanceTo(cur.pos); if (d < nd) { nd = d; next = e; } }
        cur = next;
        dmg *= 0.8;
      }
    } else if (s.splash) {
      td.fxBoom(to, s.splash, ACCENT[this.def.role]);
      for (const e of td.targetsNear(to, s.splash)) this._hit(e, dmg * (e === target ? 1 : 0.7), now);
      if (s.cluster) {
        for (let i = 0; i < s.cluster; i++) {
          const off = new THREE.Vector3((Math.random() - 0.5) * s.splash * 2.2, 0, (Math.random() - 0.5) * s.splash * 2.2);
          const cpos = to.clone().add(off);
          td.fxBoom(cpos, 1.6, 0xffb060);
          for (const e of td.targetsNear(cpos, 1.8)) this._hit(e, dmg * 0.45, now);
        }
      }
    } else if (s.drones) {
      // hive: N instant drone strikes on the closest N enemies
      const near = td.targetsNear(this.pos, s.range).slice(0, s.drones);
      for (const e of near) {
        td.fxShot(from, e.pos.clone().add(new THREE.Vector3(0, 1.2, 0)), 0xffe08a);
        this._hit(e, dmg, now);
        if (s.boomDmg && Math.random() < 0.35) { td.fxBoom(e.pos.clone(), s.splash || 2, 0xff6a1a); for (const e2 of td.targetsNear(e.pos, s.splash || 2)) this._hit(e2, s.boomDmg * 0.5, now); }
      }
    } else {
      this._hit(target, dmg, now);
    }
  }

  _hit(e, dmg, now) {
    const s = this.stats;
    const res = e.applyDamage(dmg, { armorPierce: s.armorPierce || 0 }, this.td);
    // debuff riders
    if (s.stunS) e.effects.stunUntil = Math.max(e.effects.stunUntil, now + s.stunS);
    if (s.burnDps) { e.effects.burnDps = Math.max(e.effects.burnDps, s.burnDps); e.effects.burnUntil = now + (s.burnS || 3); }
    if (s.acidDps) { e.effects.acidDps = Math.max(e.effects.acidDps, s.acidDps); e.effects.acidUntil = now + (s.acidS || 3); }
    if (s.markMult) { e.effects.markMult = Math.max(e.effects.markMult, s.markMult); e.effects.markUntil = now + (s.markS || 3); }
    if (s.slow) { const cur = e.effects.slowUntil > now ? e.effects.slowMult : 1; e.effects.slowMult = Math.min(cur, 1 - s.slow); e.effects.slowUntil = now + 1.2; }
    if (res.killed) { this.kills++; this.td.creditKill(e, this); }
  }

  _beamTick(dt, now, buff) {
    const s = this.stats;
    const n = Math.max(1, s.beams || 1);
    const targets = this.td.targetsNear(this.pos, s.range).slice(0, n);
    this._beamHeat = targets.length && targets[0] === this._lastBeamT ? Math.min((this._beamHeat || 0) + dt, s.rampS || 3) : 0;
    this._lastBeamT = targets[0] || null;
    const ramp = 1 + (this._beamHeat / (s.rampS || 3)) * ((s.rampMult || 2.5) - 1);
    for (const e of targets) {
      this._face(e);
      this.td.fxBeam(this.pos.clone().add(new THREE.Vector3(0, 1.3, 0)), e.pos.clone().add(new THREE.Vector3(0, e.def.size, 0)), 0xfff0a8);
      const res = e.applyDamage(s.beamDps * ramp * (buff.dmg || 1) * dt, { armorPierce: s.armorPierce || 0 }, this.td);
      if (res.killed) { this.kills++; this.td.creditKill(e, this); }
    }
  }

  _auraTick(dt, now) {
    const s = this.stats;
    const td = this.td;
    // debuff auras (cryo/gravity): applied to enemies in range
    if (s.slow || s.pull || s.auraDps || s.vulnMult) {
      for (const e of td.targetsNear(this.pos, s.range)) {
        if (s.slow) { e.effects.slowMult = 1 - s.slow; e.effects.slowUntil = now + 0.3; }
        if (s.vulnMult) e.effects.vulnMult = Math.max(e.effects.vulnMult, s.vulnMult);
        if (s.auraDps) { const r = e.applyDamage(s.auraDps * dt, { ignoreArmor: true }, td); if (r.killed) { this.kills++; td.creditKill(e, this); } }
        if (s.pull) e.dist = Math.max(0, e.dist - s.pull * dt * 0.4);
      }
      if (s.freezeS) {
        this._freezeT += dt;
        if (this._freezeT >= (s.freezeEvery || 6)) { this._freezeT = 0; for (const e of td.targetsNear(this.pos, s.range)) e.effects.freezeUntil = now + s.freezeS; td.fxBoom(this.pos.clone().add(new THREE.Vector3(0, 1, 0)), s.range, 0x7df9ff); }
      }
    }
    // shield generator: core regen + repulse pulses
    if (s.coreShield != null) {
      if (s.coreRegen) td.healCore(s.coreRegen * dt);
      if (s.pulsePush) {
        this._pulseT += dt;
        const every = Math.max(2, s.pulseEvery ?? 5);
        if (this._pulseT >= every) {
          this._pulseT = 0;
          td.fxBoom(this.pos.clone(), s.range * 0.8, 0x4da6ff);
          for (const e of td.targetsNear(this.pos, s.range * 0.8)) { e.dist = Math.max(0, e.dist - s.pulsePush * 0.4); if (s.pulseSlow) { e.effects.slowMult = 1 - s.pulseSlow; e.effects.slowUntil = now + 2; } }
        }
      }
    }
    // depot: player resupply when near
    if (s.playerResupply) {
      const pp = td.playerPos();
      if (pp && pp.distanceTo(this.pos) < s.range) td.resupplyPlayer(dt);
    }
  }
}

export { UNIT_DEFS, buildUnitModel };
