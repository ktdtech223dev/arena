// TOWER DEFENSE — TdView.js: renders the SERVER's co-op TD state.
// Enemies arrive as tiny wire rows [id, defIdx, dist, v, hpPct, shieldPct,
// phased] at ~16 Hz; exact world positions come from the SHARED path math
// (tdEnemyPos), and the view advances `dist` locally at the wire speed between
// snaps — so movement is smooth at any tick rate. Health bars are billboarded
// quads above every enemy. Units render from [uid, defId, x, z, tierA, tierB]
// (models rebuilt when tiers change). FX events (shot/beam/chain/mortar/boom/
// freeze/pulse/die/place...) drive tracers, bursts and PER-TOWER SFX.
import * as THREE from 'three';
import { ENEMY_DEFS, ENEMY_IDS, UNIT_BY_ID, tdEnemyPos, applyMods } from '../../shared/tddata.js';
import { buildEnemyModel, animateEnemy } from './Enemies.js';
import { buildUnitModel, ACCENT } from './Units.js';
import * as NG from '../ngames/ngames-arena.js';

// tower sfx → dedicated per-tower synth cues (TD TOWER section in core/Audio.js).
const TD_SFX = {
  td_gatling: ['td_gatling', 1], td_rail: ['td_rail', 1], td_mortar: ['td_mortar', 1],
  td_tesla: ['td_tesla', 1], td_sniper: ['td_sniper', 1], td_hive: ['td_hive', 1],
  td_plasma: ['td_plasma', 1], td_cryo: ['td_cryo', 1], td_acid: ['td_acid', 1],
  td_grav: ['td_grav', 1], td_shield: ['td_shield', 1], td_banner: ['td_banner', 1],
  td_overclock: ['td_overclock', 1], td_depot: ['td_depot', 1], td_bounty: ['td_bounty', 1],
};

export class TdView {
  constructor(ctx, arena) {
    this.ctx = ctx;
    this.arena = arena;                 // ArenaMode (for conn id / map)
    this.group = new THREE.Group();
    ctx.scene.add(this.group);
    this.enemies = new Map();           // id -> { defId, def, dist, v, hpPct, shieldPct, phased, model, bar, t }
    this.units = new Map();             // uid -> { defId, tiers, model, x, z, stats, owner }
    this._t = 0;
    this._resupplyT = 0;
    this._barGeo = new THREE.PlaneGeometry(1, 1);
    this._camQ = new THREE.Quaternion();
    // ---- VFX pools ----
    this._shells = [];  // animated mortar lobs {from,to,t,dur,mesh,r,def}
    this._rings = [];   // expanding shock rings {mesh,t,dur,r}
    this._shellGeo = new THREE.SphereGeometry(0.16, 8, 6);
    this._ringGeo = new THREE.TorusGeometry(1, 0.07, 6, 28);
  }

  // ---------------------------------------------------------- wire intake ---
  applyHeavy(h) {
    if (!h) return;
    // ---- enemies (reconcile the pool) ----
    const seen = new Set();
    for (const row of h.enemies || []) {
      const [id, defIdx, dist, v, hpPct, shieldPct, phased] = row;
      seen.add(id);
      let e = this.enemies.get(id);
      if (!e) {
        const defId = ENEMY_IDS[defIdx];
        const def = ENEMY_DEFS[defId];
        if (!def) continue;
        const model = buildEnemyModel(def);
        model.group.traverse((o) => { if (o.isMesh) o.userData.tdEnemy = id; });
        this.group.add(model.group);
        e = { id, defId, def, dist, v, hpPct, shieldPct, phased: !!phased, model, t: Math.random() * 9, bar: this._makeBar(def) };
        this.enemies.set(id, e);
      }
      e.dist = dist; e.v = v; e.hpPct = hpPct; e.shieldPct = shieldPct; e.phased = !!phased;
    }
    for (const [id, e] of this.enemies) if (!seen.has(id)) this._removeEnemy(id, e);

    // ---- units ----
    const seenU = new Set();
    for (const row of h.units || []) {
      const [uid, defId, x, z, ta, tb, owner, invested] = row;
      seenU.add(uid);
      let u = this.units.get(uid);
      const def = UNIT_BY_ID[defId];
      if (!def) continue;
      if (!u) {
        u = { uid, defId, def, x, z, tiers: [-1, -1], model: null, owner, invested };
        this.units.set(uid, u);
      }
      u.owner = owner; u.invested = invested; u.x = x; u.z = z;
      if (u.tiers[0] !== ta || u.tiers[1] !== tb) {
        if (u.model) this._disposeModel(u.model.group);
        u.tiers = [ta, tb];
        u.model = buildUnitModel(def, u.tiers);
        u.model.group.position.set(x, 0, z);
        this.group.add(u.model.group);
        // live stats mirror (for depot resupply radius etc.)
        u.stats = { ...def };
        for (let p = 0; p < 2; p++) for (let t = 0; t < u.tiers[p]; t++) applyMods(u.stats, def.paths[p][t].mod);
      }
    }
    for (const [uid, u] of this.units) if (!seenU.has(uid)) { if (u.model) this._disposeModel(u.model.group); this.units.delete(uid); }

    // ---- fx ----
    for (const fx of h.fx || []) this._fx(fx);
  }

  _removeEnemy(id, e) {
    this._disposeModel(e.model.group);
    if (e.bar) this._disposeModel(e.bar.group);
    this.enemies.delete(id);
  }

  _disposeModel(g) {
    this.group.remove(g);
    g.traverse((o) => { if (o.isMesh) { o.geometry?.dispose?.(); if (o.geometry !== this._barGeo) o.material?.dispose?.(); } });
  }

  // ------------------------------------------------------------ health bars -
  _makeBar(def) {
    const g = new THREE.Group();
    const bg = new THREE.Mesh(this._barGeo, new THREE.MeshBasicMaterial({ color: 0x140c0c, transparent: true, opacity: 0.75, depthWrite: false, toneMapped: false }));
    bg.scale.set(1.15, 0.15, 1);
    const fg = new THREE.Mesh(this._barGeo, new THREE.MeshBasicMaterial({ color: 0x51e898, transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false }));
    fg.scale.set(1.1, 0.1, 1); fg.position.z = 0.001;
    g.add(bg); g.add(fg);
    let sh = null;
    if (def.shield) {
      sh = new THREE.Mesh(this._barGeo, new THREE.MeshBasicMaterial({ color: 0x4da6ff, transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false }));
      sh.scale.set(1.1, 0.06, 1); sh.position.set(0, 0.11, 0.001);
      g.add(sh);
    }
    g.renderOrder = 90;
    this.group.add(g);
    return { group: g, fg, sh };
  }

  // ------------------------------------------------------------------ fx ----
  _unitOf(uid) { return this.units.get(uid) || null; }

  _sfx(def, pos, extraRate = 1) {
    const s = TD_SFX[def?.sfx];
    if (!s) return;
    (this.ctx.audioBank || this.ctx.audio).play(s[0], { position: pos, volume: 0.65, rate: s[1] * extraRate * (0.95 + Math.random() * 0.1) });
  }

  _tracer(from, to, color, width = 0.035) {
    this.ctx.events.emit('shot:tracer', { from, to, def: { tracer: { color, width } } });
  }

  // jagged lightning hop: subdivide + jitter midpoints so tesla arcs read as BOLTS
  _bolt(from, to, color) {
    const segs = 3;
    let prev = from;
    for (let i = 1; i <= segs; i++) {
      const f = i / segs;
      const p = new THREE.Vector3().lerpVectors(from, to, f);
      if (i < segs) {
        p.x += (Math.random() - 0.5) * 0.9;
        p.y += (Math.random() - 0.5) * 0.7 + 0.2;
        p.z += (Math.random() - 0.5) * 0.9;
      }
      this._tracer(prev, p, color, 0.05);
      prev = p;
    }
  }

  // animated mortar lob: a glowing shell arcs from the tube; the BOOM lands when
  // it does (the server already applied damage — this is presentation timing).
  _lobShell(from, to, r, def) {
    const mesh = new THREE.Mesh(this._shellGeo, new THREE.MeshBasicMaterial({ color: 0xffb24a, toneMapped: false }));
    mesh.position.copy(from);
    this.group.add(mesh);
    this._shells.push({ from, to, t: 0, dur: 0.55, mesh, r, def });
  }

  _ring(pos, color, r, dur = 0.45) {
    const mesh = new THREE.Mesh(this._ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(pos.x, 0.15, pos.z);
    mesh.scale.setScalar(0.2);
    this.group.add(mesh);
    this._rings.push({ mesh, t: 0, dur, r });
  }

  _burst(pos, color, count = 14, speed = 5, size = 0.2) {
    this.ctx.fx?.particles?.burst?.({ position: pos, count, color, speed, spread: 1, life: 0.5, size, gravity: 3, drag: 1.2 });
  }

  _fx(fx) {
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const u = fx.u != null ? this._unitOf(fx.u) : null;
    const muzzle = u ? V(u.x, 1.5, u.z) : null;
    const col = u ? (ACCENT[u.def.role] || 0xffffff) : 0xffffff;
    switch (fx.k) {
      case 'shot':
        if (muzzle) { this._tracer(muzzle, V(fx.x, fx.y, fx.z), col); this._sfx(u.def, muzzle); }
        break;
      case 'rail':
        if (muzzle) { this._tracer(muzzle, V(fx.x, fx.y, fx.z), 0xdff2ff, 0.06); this._sfx(u.def, muzzle); }
        break;
      case 'beam':
        if (muzzle) { this._tracer(muzzle, V(fx.x, fx.y, fx.z), 0xfff0a8, 0.05); if (Math.random() < 0.4) this._sfx(u.def, muzzle); }
        break;
      case 'chain': {
        if (!fx.pts?.length) break;
        let prev = muzzle || V(fx.pts[0][0], fx.pts[0][1], fx.pts[0][2]);
        for (const p of fx.pts) { const cur = V(p[0], p[1], p[2]); this._bolt(prev, cur, 0x7df9ff); prev = cur; }
        if (u) this._sfx(u.def, muzzle);
        break; }
      case 'drone':
        if (muzzle) { this._tracer(muzzle, V(fx.x, fx.y, fx.z), 0xffe08a, 0.03); this._sfx(u.def, muzzle); }
        break;
      case 'mortar':
        // fire thump now; the shell arcs and BOOMS on arrival (see update loop)
        if (u) this._sfx(u.def, muzzle);
        this._lobShell(muzzle || V(fx.x, fx.y + 8, fx.z), V(fx.x, fx.y, fx.z), fx.r | 0, u?.def);
        break;
      case 'boom':
        this._burst(V(fx.x, fx.y, fx.z), 0xff8a3a, 16, 6, 0.24);
        break;
      case 'freeze':
        this._burst(V(fx.x, 1, fx.z), 0x7df9ff, 26, (fx.r | 0), 0.18);
        this._ring(V(fx.x, 0, fx.z), 0x7df9ff, fx.r | 0);
        if (u) this._sfx(u.def, V(fx.x, 1, fx.z));
        break;
      case 'pulse':
        this._burst(V(fx.x, 1, fx.z), 0x4da6ff, 22, (fx.r | 0), 0.2);
        this._ring(V(fx.x, 0, fx.z), 0x4da6ff, fx.r | 0, 0.35);
        break;
      case 'die': {
        this._burst(V(fx.x, fx.y, fx.z), fx.f ? 0xc96af0 : 0x9fe86a, 20, 5, 0.2);
        (this.ctx.audioBank || this.ctx.audio).play(fx.f ? 'seeker_launch' : 'melee_whiff', { position: V(fx.x, fx.y, fx.z), volume: 0.5, rate: 0.7 + Math.random() * 0.3 });
        if (fx.q) NG.unlock(NG.ACH.HIVE_QUEEN); // Regicide — the crew slew a queen
        break; }
      case 'leak':
        (this.ctx.audioBank || this.ctx.audio).play('land_hard', { volume: 0.9, rate: 0.55 });
        break;
      case 'place': this._burst(V(fx.x, 0.6, fx.z), 0x9fe86a, 18, 4, 0.16); (this.ctx.audioBank || this.ctx.audio).play('equip', { volume: 0.8 }); break;
      case 'upgrade': this._burst(V(fx.x, 1, fx.z), 0xffd166, 22, 5, 0.18); (this.ctx.audioBank || this.ctx.audio).play('kill', { volume: 0.5, rate: 1.3 }); break;
      case 'sell': this._burst(V(fx.x, 0.8, fx.z), 0xffcf6a, 14, 4, 0.16); break;
    }
  }

  // -------------------------------------------------------------- frame -----
  update(dt) {
    this._t += dt;
    const cam = this.ctx.camera;
    if (cam) cam.getWorldQuaternion(this._camQ);

    // mortar shells: parabolic lob → boom on arrival
    for (let i = this._shells.length - 1; i >= 0; i--) {
      const s = this._shells[i];
      s.t += dt;
      const f = Math.min(1, s.t / s.dur);
      s.mesh.position.lerpVectors(s.from, s.to, f);
      s.mesh.position.y += Math.sin(f * Math.PI) * 6; // arc height
      if (f >= 1) {
        this.group.remove(s.mesh); s.mesh.material.dispose();
        this._burst(s.to.clone().add(new THREE.Vector3(0, 0.5, 0)), 0xffb24a, 20 + s.r * 4, 6 + s.r, 0.3);
        this._ring(s.to, 0xff8a4a, Math.max(2, s.r), 0.4);
        (this.ctx.audioBank || this.ctx.audio).play('explosion', { position: s.to, volume: 0.55 });
        this._shells.splice(i, 1);
      }
    }
    // expanding shock rings
    for (let i = this._rings.length - 1; i >= 0; i--) {
      const r = this._rings[i];
      r.t += dt;
      const f = Math.min(1, r.t / r.dur);
      r.mesh.scale.setScalar(0.2 + f * r.r);
      r.mesh.material.opacity = 0.8 * (1 - f);
      if (f >= 1) { this.group.remove(r.mesh); r.mesh.material.dispose(); this._rings.splice(i, 1); }
    }

    for (const e of this.enemies.values()) {
      e.t += dt;
      e.dist += (e.v || 0) * dt; // local advance; server corrects at 16 Hz
      const p = tdEnemyPos(e.id, e.def, e.dist, this._t);
      e.model.group.position.set(p.x, p.y, p.z);
      e.model.group.rotation.y = p.yaw;
      animateEnemy(e.def, e.model.parts, e.model.group, e.t, (e.v || 0) > 0.05, { shieldPct: e.shieldPct });
      // phase shimmer
      if (e.def.phaseS) {
        e.model.group.traverse((o) => { if (o.isMesh && o.material) { o.material.transparent = true; o.material.opacity = e.phased ? 0.25 : 1; } });
      }
      // health bar (billboard)
      const bar = e.bar;
      bar.group.position.set(p.x, p.y + e.def.size * 2.1 + 0.35, p.z);
      bar.group.quaternion.copy(this._camQ);
      const hp = Math.max(0, Math.min(100, e.hpPct)) / 100;
      bar.fg.scale.x = 1.1 * hp;
      bar.fg.position.x = -(1.1 * (1 - hp)) / 2;
      bar.fg.material.color.setHex(hp > 0.55 ? 0x51e898 : hp > 0.25 ? 0xffd166 : 0xff6b6b);
      if (bar.sh) { const sp = Math.max(0, e.shieldPct) / 100; bar.sh.scale.x = 1.1 * sp; bar.sh.position.x = -(1.1 * (1 - sp)) / 2; bar.sh.visible = sp > 0.02; }
    }

    // unit spinners + face nearest enemy (cosmetic)
    for (const u of this.units.values()) {
      const parts = u.model?.parts;
      if (!parts) continue;
      if (parts.spinner) parts.spinner.rotation.y += dt * 2;
      if (parts.yawNode && this.enemies.size && !u.def.aura) {
        let best = null, bd = (u.stats?.range || u.def.range) ** 2;
        for (const e of this.enemies.values()) {
          const p = e.model.group.position;
          const d = (p.x - u.x) ** 2 + (p.z - u.z) ** 2;
          if (d < bd) { bd = d; best = p; }
        }
        if (best) parts.yawNode.rotation.y = Math.atan2(best.x - u.x, best.z - u.z);
      }
    }

    // ammo-depot resupply: standing near your crew's depot tops off reserves
    this._resupplyT += dt;
    if (this._resupplyT > 3) {
      this._resupplyT = 0;
      const me = this.ctx.camera?.getWorldPosition?.(new THREE.Vector3());
      if (me) {
        for (const u of this.units.values()) {
          if (!u.stats?.playerResupply) continue;
          if (Math.hypot(u.x - me.x, u.z - me.z) < (u.stats.range || 11)) { this.ctx.weapons?.resupply?.(); break; }
        }
      }
    }
  }

  /** nearest unit to a world position (for the E-interact prompt). */
  nearestUnit(pos, maxD = 2.6) {
    let best = null, bd = maxD;
    for (const u of this.units.values()) {
      const d = Math.hypot(u.x - pos.x, u.z - pos.z);
      if (d < bd) { bd = d; best = u; }
    }
    return best;
  }

  dispose() {
    for (const [id, e] of this.enemies) this._removeEnemy(id, e);
    for (const u of this.units.values()) if (u.model) this._disposeModel(u.model.group);
    this.units.clear();
    for (const s of this._shells) { this.group.remove(s.mesh); s.mesh.material.dispose(); }
    for (const r of this._rings) { this.group.remove(r.mesh); r.mesh.material.dispose(); }
    this._shells.length = 0; this._rings.length = 0;
    this._shellGeo.dispose(); this._ringGeo.dispose();
    this.ctx.scene.remove(this.group);
  }
}
