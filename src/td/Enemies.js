// TOWER DEFENSE — Enemies.js: the horde.
// BRAND-NEW code-built enemy models (never player rigs): the ZOMBIE family —
// rotted green shamblers with hanging arms, swaying gait — and the ALIEN family
// — chitinous violet skitterers/flyers with glow eyes. Procedurally animated
// (limb sin-swing, hover bob, phase shimmer). Enemies follow the PATH polyline
// to the core; they are shootable by EVERY player gun via the Targets-compatible
// interface (EnemyTargets.raycastShot/damage) and by units (direct damage calls).
import * as THREE from 'three';
import { ENEMY_DEFS } from './data.js';
import { PATH, pointAt, pathLength } from './TDWorld.js';

const ZOMBIE_SKIN = 0x5a7a3a, ZOMBIE_DARK = 0x3a4a26, GORE = 0x8a2a1e;
const ALIEN_SHELL = 0x4a2a6e, ALIEN_GLOW = 0xc96af0, ALIEN_EYE = 0x66ff88;

function mat(color, opts = {}) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: opts.rough ?? 0.8, metalness: opts.metal ?? 0.08 });
  if (opts.emissive) { m.emissive = new THREE.Color(opts.emissive); m.emissiveIntensity = opts.emissiveI ?? 0.8; }
  if (opts.transparent) { m.transparent = true; m.opacity = opts.opacity ?? 1; }
  return m;
}
function box(parent, m, w, h, d, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z); mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

// ---------------------------------------------------------------------------
// MODEL BUILDERS — return { group, parts:{...} } sized ~1.8m tall at size 1.
// ---------------------------------------------------------------------------
function buildZombie(def) {
  const g = new THREE.Group();
  const s = def.size;
  const skin = mat(ZOMBIE_SKIN), dark = mat(ZOMBIE_DARK), gore = mat(GORE, { emissive: 0x5a0a06, emissiveI: 0.4 });
  const parts = {};
  const torso = box(g, dark, 0.62 * s, 0.7 * s, 0.36 * s, 0, 1.05 * s, 0);
  box(torso, gore, 0.3 * s, 0.34 * s, 0.06 * s, 0.1 * s, -0.05 * s, 0.19 * s); // exposed wound
  const head = box(g, skin, 0.34 * s, 0.34 * s, 0.34 * s, 0, 1.6 * s, 0.04 * s);
  head.rotation.x = 0.25; // slumped
  box(head, mat(0x111111, { emissive: 0xffe08a, emissiveI: 0.5 }), 0.07, 0.05, 0.02, -0.08 * s, 0.02, 0.18 * s); // eye
  parts.head = head;
  parts.armL = box(g, skin, 0.16 * s, 0.7 * s, 0.16 * s, -0.42 * s, 1.1 * s, 0.1 * s);
  parts.armR = box(g, skin, 0.16 * s, 0.7 * s, 0.16 * s, 0.42 * s, 1.1 * s, 0.1 * s);
  parts.armL.geometry.translate(0, -0.3 * s, 0); parts.armR.geometry.translate(0, -0.3 * s, 0);
  parts.legL = box(g, dark, 0.2 * s, 0.72 * s, 0.2 * s, -0.16 * s, 0.72 * s, 0);
  parts.legR = box(g, dark, 0.2 * s, 0.72 * s, 0.2 * s, 0.16 * s, 0.72 * s, 0);
  parts.legL.geometry.translate(0, -0.36 * s, 0); parts.legR.geometry.translate(0, -0.36 * s, 0);
  // family variants
  if (def === ENEMY_DEFS.brute) { box(g, dark, 0.9 * s, 0.3 * s, 0.5 * s, 0, 1.5 * s, 0); } // shoulder slab
  if (def === ENEMY_DEFS.bloater) { const b = box(g, mat(0x7a8a2a, { emissive: 0x9fe86a, emissiveI: 0.5 }), 0.7 * s, 0.5 * s, 0.5 * s, 0, 0.85 * s, 0.1 * s); parts.belly = b; }
  if (def === ENEMY_DEFS.screamer) { const m = box(g, gore, 0.16 * s, 0.2 * s, 0.1 * s, 0, 1.55 * s, 0.2 * s); parts.maw = m; }
  return { group: g, parts };
}

function buildAlien(def) {
  const g = new THREE.Group();
  const s = def.size;
  const shell = mat(ALIEN_SHELL, { metal: 0.35, rough: 0.45 });
  const glow = mat(0x2a1440, { emissive: ALIEN_GLOW, emissiveI: 1.1 });
  const parts = {};
  if (def.fly) {
    // flyer: lens body + glow ring + dangling feelers
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.5 * s, 14, 10), shell);
    body.scale.set(1, 0.55, 1); body.position.y = 1.6 * s; body.castShadow = true;
    g.add(body); parts.body = body;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55 * s, 0.07 * s, 8, 20), glow);
    ring.rotation.x = Math.PI / 2; ring.position.y = 1.6 * s;
    g.add(ring); parts.ring = ring;
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.14 * s, 10, 8), mat(0x0a1a0e, { emissive: ALIEN_EYE, emissiveI: 1.6 }));
    eye.position.set(0, 1.5 * s, 0.4 * s); g.add(eye);
    for (const dx of [-0.25, 0, 0.25]) { const f = box(g, shell, 0.05 * s, 0.5 * s, 0.05 * s, dx * s, 1.15 * s, 0); f.geometry.translate(0, -0.2 * s, 0); (parts.feelers = parts.feelers || []).push(f); }
  } else {
    // skitterer/warden/stalker: low chitin body + 4 blade legs + glow spine
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.44 * s, 12, 9), shell);
    body.scale.set(1.3, 0.7, 1); body.position.y = 0.72 * s; body.castShadow = true;
    g.add(body); parts.body = body;
    box(g, glow, 0.1 * s, 0.06 * s, 0.7 * s, 0, 0.95 * s, 0); // spine strip
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.11 * s, 8, 8), mat(0x0a1a0e, { emissive: ALIEN_EYE, emissiveI: 1.8 }));
    eye.position.set(0, 0.8 * s, 0.5 * s); g.add(eye);
    parts.legs = [];
    for (const [dx, dz] of [[-0.5, 0.3], [0.5, 0.3], [-0.5, -0.3], [0.5, -0.3]]) {
      const leg = box(g, shell, 0.08 * s, 0.8 * s, 0.08 * s, dx * s, 0.5 * s, dz * s);
      leg.geometry.translate(0, -0.34 * s, 0);
      leg.rotation.z = dx > 0 ? -0.5 : 0.5;
      parts.legs.push(leg);
    }
    if (def.shield) { const sh = new THREE.Mesh(new THREE.SphereGeometry(0.95 * s, 14, 10), mat(0x184a6e, { emissive: 0x4da6ff, emissiveI: 0.5, transparent: true, opacity: 0.28 })); sh.position.y = 0.75 * s; g.add(sh); parts.shieldMesh = sh; }
  }
  return { group: g, parts };
}

// ---------------------------------------------------------------------------
export class Enemy {
  constructor(id, defId, hpMult, scene) {
    const def = ENEMY_DEFS[defId];
    this.id = id; this.defId = defId; this.def = def;
    this.maxHp = Math.round(def.hp * hpMult);
    this.hp = this.maxHp;
    this.shield = def.shield ? def.shield * hpMult : 0;
    this.maxShield = this.shield;
    this.dist = 0;                 // distance along the path
    this.alive = true; this.dying = false; this.hidden = false;
    this.flash = 0;
    this.kind = 'td_enemy'; this.section = 'td'; // Targets-API compat fields
    this.effects = { slowUntil: 0, slowMult: 1, stunUntil: 0, freezeUntil: 0, burnUntil: 0, burnDps: 0, acidUntil: 0, acidDps: 0, markUntil: 0, markMult: 1, vulnMult: 1 };
    this._phaseT = Math.random() * (def.phaseEvery || 1);
    this.phased = false;
    this._spawnT = 0;
    this._anim = Math.random() * 9;
    const built = def.family === 'zombie' ? buildZombie(def) : buildAlien(def);
    this.group = built.group; this.parts = built.parts;
    this.group.traverse((o) => { o.userData.target = this; });
    this.meshes = [];
    this.group.traverse((o) => { if (o.isMesh) this.meshes.push(o); });
    const p0 = pointAt(0);
    this.group.position.set(p0.x, 0, p0.z);
    scene.add(this.group);
    this.lane = (Math.random() - 0.5) * 2.4; // side offset within the ribbon
  }

  get pos() { return this.group.position; }

  /** Effective speed after slows/stun/freeze/haste. */
  speed(now, hasteMult) {
    const e = this.effects;
    if (now < e.stunUntil || now < e.freezeUntil) return 0;
    let s = this.def.speed * (now < e.slowUntil ? e.slowMult : 1);
    return s * (hasteMult || 1);
  }

  step(dt, now, td) {
    if (!this.alive) return;
    const def = this.def;
    this._anim += dt;
    // phase stalker: periodic invulnerable shimmer
    if (def.phaseS) {
      this._phaseT += dt;
      if (!this.phased && this._phaseT >= def.phaseEvery) { this.phased = true; this._phaseT = 0; }
      else if (this.phased && this._phaseT >= def.phaseS) { this.phased = false; this._phaseT = 0; }
      this.group.traverse((o) => { if (o.isMesh && o.material) { o.material.transparent = true; o.material.opacity = this.phased ? 0.25 : 1; } });
    }
    // shield regen (warden) when not recently hit
    if (def.shieldRegen && now - (this._lastHitAt || 0) > 2.5 && this.shield < this.maxShield) {
      this.shield = Math.min(this.maxShield, this.shield + def.shieldRegen * dt);
    }
    // DoTs
    const e = this.effects;
    if (now < e.burnUntil) this.applyDamage(e.burnDps * dt, { silent: true, ignoreArmor: true }, td);
    if (now < e.acidUntil) this.applyDamage(e.acidDps * dt, { silent: true, ignoreArmor: true }, td);
    if (!this.alive) return;
    // queen spawns skitterers
    if (def.spawns) {
      this._spawnT += dt;
      if (this._spawnT >= def.spawnEvery) { this._spawnT = 0; td.spawnEnemy(def.spawns, this.dist); }
    }
    // haste from screamers
    let haste = 1;
    if (td.hasteSources.length) {
      for (const sc of td.hasteSources) {
        if (sc === this) continue;
        const d = sc.pos.distanceTo(this.pos);
        if (d < sc.def.hasteR) { haste = Math.max(haste, sc.def.hasteAura); }
      }
    }
    // advance along the path
    this.dist += this.speed(now, haste) * dt;
    const p = pointAt(this.dist);
    const nx = -p.dirZ, nz = p.dirX; // lateral
    const fly = def.fly ? def.fly + Math.sin(this._anim * 2.2) * 0.25 : 0;
    const jit = def.jitter ? Math.sin(this._anim * 7.3) * def.jitter * 0.5 : 0;
    this.group.position.set(p.x + nx * (this.lane + jit), fly, p.z + nz * (this.lane + jit));
    this.group.rotation.y = Math.atan2(p.dirX, p.dirZ);
    this._animate(now);
    // reached the core?
    if (this.dist >= pathLength() - 0.5) { td.leak(this); }
  }

  _animate(now) {
    const t = this._anim, p = this.parts, def = this.def;
    const frozen = now < this.effects.freezeUntil;
    const w = frozen ? 0 : Math.min(1, this.def.speed / 2);
    if (def.family === 'zombie') {
      const sw = Math.sin(t * (4 + def.speed)) * 0.5 * w;
      if (p.legL) { p.legL.rotation.x = sw; p.legR.rotation.x = -sw; }
      if (p.armL) { p.armL.rotation.x = -0.9 + Math.sin(t * 3.1) * 0.18 * w; p.armR.rotation.x = -0.75 + Math.cos(t * 2.7) * 0.22 * w; }
      this.group.rotation.z = Math.sin(t * 2.2) * 0.05 * w; // shamble sway
      if (p.belly) p.belly.scale.setScalar(1 + Math.sin(t * 5) * 0.06);
      if (p.maw) p.maw.scale.y = 1 + Math.max(0, Math.sin(t * 6)) * 1.6;
    } else {
      if (p.legs) for (let i = 0; i < p.legs.length; i++) p.legs[i].rotation.x = Math.sin(t * 10 + i * 1.7) * 0.5 * w;
      if (p.ring) p.ring.rotation.z = t * 3;
      if (p.feelers) for (let i = 0; i < p.feelers.length; i++) p.feelers[i].rotation.x = Math.sin(t * 3 + i) * 0.3;
      if (p.shieldMesh) { p.shieldMesh.visible = this.shield > 1; p.shieldMesh.material.opacity = 0.18 + 0.12 * Math.sin(t * 4) + 0.1 * (this.shield / (this.maxShield || 1)); }
    }
    // hit flash
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - 0.08);
      const f = this.flash;
      this.group.traverse((o) => { if (o.isMesh && o.material?.emissive && !o.userData.__baseEmi) { /* cheap: skip per-mesh restore bookkeeping */ } });
      this.group.scale.setScalar((this.def.size >= 1 ? 1 : 1) + f * 0.06);
    }
  }

  /** All damage funnels here. opts: { ignoreArmor, silent, armorPierce } */
  applyDamage(dmg, opts = {}, td) {
    if (!this.alive || (this.phased && !opts.silent)) return { killed: false, dealt: 0 };
    const e = this.effects;
    let d = dmg * (e.vulnMult || 1) * (Date.now() / 1000 < e.markUntil ? e.markMult : 1);
    if (!opts.ignoreArmor) {
      const armor = Math.max(0, this.def.armor * (1 - (opts.armorPierce || 0)));
      d = Math.max(1, d - armor);
    }
    this._lastHitAt = Date.now() / 1000;
    if (this.shield > 0) {
      const absorbed = Math.min(this.shield, d);
      this.shield -= absorbed; d -= absorbed;
    }
    this.hp -= d;
    this.flash = 1;
    if (this.hp <= 0) { this.alive = false; td?.onEnemyKilled?.(this, opts); return { killed: true, dealt: d }; }
    return { killed: false, dealt: d };
  }

  dispose(scene) {
    scene.remove(this.group);
    this.group.traverse((o) => { if (o.isMesh) { o.geometry?.dispose?.(); o.material?.dispose?.(); } });
  }
}

// ---------------------------------------------------------------------------
// EnemyTargets — the Targets-compatible interface (player guns Just Work).
// ---------------------------------------------------------------------------
export class EnemyTargets {
  constructor(ctx, td) {
    this.ctx = ctx;
    this.td = td;
    this._ray = new THREE.Raycaster();
    this._v = new THREE.Vector3();
  }

  raycastShot(origin, dir, maxDist = 400) {
    this._ray.set(origin, this._v.copy(dir).normalize());
    this._ray.near = 0; this._ray.far = maxDist;
    const live = [];
    for (const e of this.td.enemies) if (e.alive && !e.phased) live.push(...e.meshes);
    const solids = this.ctx.world?.range?.solidMeshes ?? [];
    const hits = this._ray.intersectObjects(solids.concat(live), true);
    const h = hits[0];
    if (!h) return null;
    let target = null;
    for (let o = h.object; o; o = o.parent) { if (o.userData?.target) { target = o.userData.target; break; } }
    let normal = h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld).normalize() : this._v.copy(dir).negate().clone();
    if (normal.dot(dir) > 0) normal.negate();
    // headshot zone: hit above 80% of the enemy's height
    let zone = null;
    if (target) zone = (h.point.y - target.pos.y) > 1.35 * target.def.size ? 'head' : 'body';
    return { point: h.point.clone(), normal, distance: h.distance, surface: target ? 'target' : 'concrete', target, zone };
  }

  damage(hit, dmg, def) {
    const t = hit?.target;
    if (!t || !t.alive) return { points: 0, kill: false, zone: hit?.zone ?? null };
    const mult = (hit.zone === 'head' ? 1.8 : 1) * (this.td.playerDmgMult || 1);
    const res = t.applyDamage(dmg * mult, { byPlayer: true }, this.td);
    this.ctx.events.emit('target:hit', { target: t, def, damage: dmg * mult, zone: hit.zone, points: res.killed ? 10 : 1, kill: res.killed, point: hit.point, distance: hit.distance });
    if (res.killed) this.ctx.events.emit('target:killed', { target: t, def, point: hit.point });
    return { points: res.killed ? 10 : 1, kill: res.killed, zone: hit.zone };
  }

  damageArea(center, radius, dmg, def) {
    const results = [];
    for (const e of this.td.enemies) {
      if (!e.alive) continue;
      const d = e.pos.distanceTo(center);
      if (d > radius) continue;
      const res = e.applyDamage(dmg * (1 - 0.6 * (d / radius)) * (this.td.playerDmgMult || 1), { byPlayer: true }, this.td);
      if (res.killed) this.ctx.events.emit('target:killed', { target: e, def, point: e.pos.clone() });
      results.push(res);
    }
    return results;
  }

  nearestTarget(pos) {
    let best = null, bd = Infinity;
    for (const e of this.td.enemies) { if (!e.alive) continue; const d = e.pos.distanceToSquared(pos); if (d < bd) { bd = d; best = e; } }
    return best ? { target: best, position: best.pos.clone().add(new THREE.Vector3(0, 1, 0)), distance: Math.sqrt(bd) } : null;
  }

  targetsInRadius(pos, r) {
    const out = [];
    for (const e of this.td.enemies) if (e.alive && e.pos.distanceTo(pos) <= r) out.push(e);
    return out;
  }

  fixedUpdate(dt) { this.td.fixedUpdate(dt); }
}
