// RANGE — weapon logic (agent D): WeaponManager + Weapon.
// Owns the full gun FSM (idle/firing/cycling/reloading/equipping/holstering/
// inspecting), fire gating (semi/auto/pump/bolt), the spread+bloom model,
// damage falloff, pellet loops, reload variants (tactical/empty/per-shell
// interruptible), ADS, switching, and ALL weapon audio — every sound plays at
// the exact instant its event is emitted, so animation and audio stay synced
// by construction. Visuals belong to the E agent; render() here only drives
// recoil recovery and projectile bolts.
import * as THREE from 'three';
import { WEAPONS, registerWeaponTunables } from './weapons-data.js';
import { sampleConeDir, pelletDirs, fireHitscanRay, MAX_RANGE } from './Hitscan.js';
import { Recoil } from './Recoil.js';
import { ProjectileManager } from './Projectile.js';
import { MELEE } from '../../shared/constants.js';

const _camPos = new THREE.Vector3();
const _camDir = new THREE.Vector3();

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// ===========================================================================
// Weapon — one instance per def. Only the CURRENT weapon is ticked.
// ===========================================================================
export class Weapon {
  constructor(ctx, def, manager) {
    this.ctx = ctx;
    this.def = def;
    this.manager = manager;

    this.magAmmo = def.mag;
    this.reserveAmmo = def.reserve;
    this.state = 'idle';
    this.ads = 0; // 0..1, eased over def.adsT

    this._adsOn = false; // ADS target (RMB held & allowed)
    this._cooldown = 0; // s until rpm allows the next shot
    this._dryCooldown = 0;
    this._dryLatch = false; // one dry click per trigger hold
    this._bloom = 0; // degrees of accumulated bloom
    this._timer = 0; // state timer: equip/holster/cycle/inspect
    this._pendingCycle = false; // pump/bolt queued after the shot settles
    this._cycleDelay = 0;
    this._reload = null; // live reload FSM data
    this._reloadQueued = false;
    this._holsterDone = false; // polled by the manager to complete a swap
    this._burstLeft = 0; // rounds remaining in an in-progress burst (burst rifle)
    this._altCooldown = 0; // s until the ALT fire (dual-mode weapons) is ready again

    // DUAL-WIELD: which trigger fires this gun ('fire' = LMB default; the LEFT gun
    // of a dual pair fires on 'ads' = RMB) and which side it's held on (null | 'R' | 'L').
    this._fireAction = 'fire';
    this._dualSide = null;
  }

  // event tag so anim/feel can ignore the OFFHAND gun's equip/fire/reload events
  // (the Viewmodel renders + kicks the offhand itself). {} when not dual-wielding.
  _offTag() {
    if (this._dualSide === 'L') return { offhand: true, side: 'L' };
    if (this._dualSide === 'R') return { side: 'R' };
    return {};
  }

  isAds() {
    return this._adsOn;
  }

  // ---- lifecycle (driven by WeaponManager) --------------------------------

  beginEquip() {
    this.state = 'equipping';
    this._timer = this.def.equipT;
    this._holsterDone = false;
    this._reloadQueued = false;
    this._pendingCycle = false;
    this._reload = null;
    this._bloom = 0;
    this.ads = 0;
    this._adsOn = false;
    this._burstLeft = 0; // never carry an unfinished burst across a weapon switch
    this.ctx.events.emit('weapon:equip', { ...this._offTag(), def: this.def });
    this.ctx.audio.play('equip', { volume: 0.8 });
  }

  beginHolster() {
    this.cancelReload(); // emits reload_end {cancelled:true} if mid-reload
    this._pendingCycle = false;
    this._reloadQueued = false;
    this.state = 'holstering';
    this._timer = this.def.holsterT;
    this._holsterDone = false;
    this.ctx.events.emit('weapon:holster', { ...this._offTag(), def: this.def });
    this.ctx.audio.play('holster', { volume: 0.8 });
  }

  cancelReload() {
    if (this.state !== 'reloading') return;
    this._reload = null;
    this.state = 'idle';
    this.ctx.events.emit('weapon:reload_end', { ...this._offTag(), def: this.def, cancelled: true });
  }

  // ---- fixed-step update ---------------------------------------------------

  fixedUpdate(dt) {
    const input = this.ctx.input;
    const P = this.manager.params;

    this._cooldown = Math.max(0, this._cooldown - dt);
    this._altCooldown = Math.max(0, this._altCooldown - dt);
    this._dryCooldown = Math.max(0, this._dryCooldown - dt);
    this._bloom = Math.max(0, this._bloom - this.def.spread.recover * dt);
    if (!input.down(this._fireAction)) this._dryLatch = false;

    // ---- state machine ----
    switch (this.state) {
      case 'equipping':
        this._timer -= dt;
        if (this._timer <= 0) this.state = 'idle';
        break;

      case 'holstering':
        this._timer -= dt;
        if (this._timer <= 0) this._holsterDone = true;
        break;

      case 'reloading':
        this._updateReload(dt);
        break;

      case 'cycling':
        this._timer -= dt;
        if (this._timer <= 0) this.state = 'idle';
        break;

      case 'inspecting':
        this._timer -= dt;
        if (this._timer <= 0 || input.down('ads')) this.state = 'idle';
        break;

      case 'firing':
        if (this._pendingCycle) {
          this._cycleDelay -= dt;
          if (this._cycleDelay <= 0) this._startCycle();
        } else if (this._cooldown <= 0) {
          this.state = 'idle';
        }
        break;
    }

    // ---- MELEE weapons (knife/bat, §1C): dedicated fight weapon, NOT hitscan.
    // No fire-gating cone, no ADS, no ammo/reload. LMB = light swing, RMB = heavy.
    // Both gate on cooldown + an idle/firing state (so mid-swing spam is dropped).
    if (this.def.type === 'melee') {
      this.ads = 0;
      this._adsOn = false;
      const canSwing =
        this._cooldown <= 0 && (this.state === 'idle' || this.state === 'firing');
      if (canSwing) {
        if (input.consumePressed('ads')) this._meleeSwing(true);        // RMB = heavy
        else if (input.consumePressed('fire')) this._meleeSwing(false); // LMB = light
      } else {
        // consume the edges so a queued click doesn't leak into the next weapon
        input.consumePressed('fire');
        input.consumePressed('ads');
      }
      // inspect (T) still allowed from idle
      if (input.consumePressed('inspect') && this.state === 'idle') {
        this.state = 'inspecting';
        this._timer = P.inspectT;
      }
      return;
    }

    // ---- reload request (R) — queued through cycling, blocked while equipping
    if (input.consumePressed('reload')) this._reloadQueued = true;
    if (this._reloadQueued) {
      const stateOk =
        this.state === 'idle' ||
        this.state === 'inspecting' ||
        (this.state === 'firing' && !this._pendingCycle);
      if (stateOk) {
        this._reloadQueued = false;
        if (this._canReload()) {
          if (this.state === 'inspecting') this.state = 'idle';
          this._startReload();
        }
      } else if (this.state === 'holstering') {
        this._reloadQueued = false; // switching away — drop the request
      }
    }

    // ---- fire gating ----
    const canAct =
      (this.state === 'idle' || this.state === 'firing' || this.state === 'inspecting') &&
      !this._pendingCycle;
    if (canAct && this._cooldown <= 0) {
      if (this.def.burst) {
        // BURST: a fresh trigger pull commits to `def.burst` rounds fired at
        // `burstRpm` cadence; `rpm` is the slower between-bursts refire delay.
        if (this._burstLeft <= 0 && input.consumePressed(this._fireAction)) {
          if (this.magAmmo > 0) this._burstLeft = this.def.burst;
          else this._dryFire();
        }
        if (this._burstLeft > 0) {
          if (this.state === 'inspecting') this.state = 'idle';
          if (this.magAmmo > 0) {
            this._fire();                 // sets _cooldown = 60/rpm (post-burst delay)
            this._burstLeft--;
            if (this._burstLeft > 0) this._cooldown = 60 / (this.def.burstRpm || 900); // fast intra-burst
          } else {
            this._burstLeft = 0;          // ran dry mid-burst
          }
        }
      } else {
        // semi-auto needs a fresh click (consume the edge); auto just holds.
        // consumePressed is only called when actually ready → un-consumed clicks
        // survive until endFrame, giving natural sub-frame shot buffering.
        // (dual-wield: the LEFT gun's trigger is 'ads' = RMB via _fireAction)
        const trig = this.def.auto ? input.down(this._fireAction) : input.consumePressed(this._fireAction);
        if (trig) {
          if (this.state === 'inspecting') this.state = 'idle';
          if (this.magAmmo > 0) this._fire();
          else this._dryFire();
        }
      }
    }

    // ---- DUAL-MODE alt fire (RMB): replaces ADS on these weapons ----
    // (suppressed while dual-WIELDING — RMB belongs to the left gun then)
    if (this.def.dualMode && this.def.alt && !this._dualSide && this._altCooldown <= 0 &&
        (this.state === 'idle' || this.state === 'firing') && !this._pendingCycle) {
      const trig = this.def.alt.auto ? input.down('ads') : input.consumePressed('ads');
      if (trig) {
        const cost = this.def.alt.ammoCost || 1;
        if (this.magAmmo >= cost) this._fireAlt();
        else this._dryFire();
      }
    }

    // ---- inspect (T) ---- (the offhand gun never consumes the inspect edge)
    if (!this._dualSide && input.consumePressed('inspect') && this.state === 'idle' && !this._adsOn && this.ads < 0.1) {
      this.state = 'inspecting';
      this._timer = P.inspectT;
    }

    this._updateAds(dt);
  }

  // ---- spread model ---------------------------------------------------------
  // effective = lerp-by-ads(hip, ads-cone)
  //   hip = base + move·mf(hs/8) + air(!grounded) + bloom
  //   ads = spread.ads + move·mf(max(0,hs−deadzone)/8)·adsMove + air·scale + bloom·scale
  // The sniper's adsMove=1 + ads=0 gives the "laser when scoped+still,
  // punished when moving" rule from the design.
  getSpreadDeg() {
    const s = this.def.spread;
    const P = this.manager.params;
    const c = this.ctx.player?.controller;
    const hs = c?.horizontalSpeed?.() ?? 0;
    const grounded = c ? !!c.grounded : true;

    const mfHip = clamp01(hs / P.moveRefSpeed);
    const hip = s.base + s.move * mfHip + (grounded ? 0 : s.air) + this._bloom;

    const mfAds =
      clamp01(Math.max(0, hs - P.adsMoveDeadzone) / P.moveRefSpeed) * (s.adsMove ?? 0.35);
    const adsCone =
      s.ads + s.move * mfAds + (grounded ? 0 : s.air * P.adsAirScale) + this._bloom * P.adsBloomScale;

    const a = this.ads;
    const k = a * a * (3 - 2 * a); // smoothstep blend
    let eff = hip + (adsCone - hip) * k;
    eff += this.manager.recoil.getCrosshairDeg();
    return Math.max(0, eff);
  }

  // ---- internals -------------------------------------------------------------

  _fire() {
    const ctx = this.ctx;
    const def = this.def;

    this.magAmmo--;
    this._cooldown = 60 / def.rpm;
    this.state = 'firing';

    const origin = ctx.camera.getWorldPosition(_camPos).clone();
    const baseDir = ctx.camera.getWorldDirection(_camDir).clone();
    const spreadDeg = this.getSpreadDeg();
    const from = this._muzzleWorld(origin);

    if (def.type === 'rocket') {
      this._fireRocket(origin, baseDir, spreadDeg, from);
    } else if (def.type === 'sawblade') {
      this._fireSawblade(origin, baseDir, spreadDeg, from);
    } else if (def.type === 'pellets') {
      const dirs = pelletDirs(baseDir, spreadDeg, def.pellets ?? 8);
      for (const d of dirs) fireHitscanRay(ctx, def, origin, d, from);
    } else if (def.scope && ctx.cheats.sniperProjectile) {
      // railgun-bolt cheat: same aim, travel-time bolt instead of a ray
      const d = sampleConeDir(baseDir, spreadDeg);
      this.manager.projectiles.spawn({
        origin,
        dir: d,
        speed: def.projectile?.speed ?? 220,
        gravity: def.projectile?.gravity ?? 0,
        def,
      });
    } else {
      const d = sampleConeDir(baseDir, spreadDeg);
      fireHitscanRay(ctx, def, origin, d, from);
    }

    this._bloom = Math.min(def.spread.bloomMax, this._bloom + def.spread.bloomPerShot);
    this.manager.recoil.onFire(def, this.ads);
    // real sample when loaded (AudioBank), synth fallback otherwise. The bank is the
    // single fire-sound source now (the arena net layer no longer double-plays it).
    (ctx.audioBank || ctx.audio).play(def.sounds.fire, { volume: 1, rate: 0.96 + Math.random() * 0.08 });
    ctx.events.emit('weapon:fired', { ...this._offTag(), def, origin, dir: baseDir, ads: this.ads });

    if (def.cycle) {
      this._pendingCycle = true;
      this._cycleDelay = this.manager.params.cycleDelay;
    }
  }

  // ---- dual-mode ALT fire (RMB) --------------------------------------------
  // hitscan/pellet alts resolve LOCALLY for feel (server-authoritative via the
  // virtual `alt.combatId` weapon id in the fire packet); PROJECTILE alts are
  // spawned server-side and rendered by ProjectileView, so there's no local sim.
  _fireAlt() {
    const ctx = this.ctx, def = this.def, alt = def.alt;
    this.magAmmo -= (alt.ammoCost || 1);
    this._altCooldown = 60 / (alt.rpm || 120);
    this.state = 'firing';
    const origin = ctx.camera.getWorldPosition(_camPos).clone();
    const baseDir = ctx.camera.getWorldDirection(_camDir).clone();
    const from = this._muzzleWorld(origin);
    const spreadDeg = alt.spread ?? 0.3;
    if (alt.type === 'pellets' || alt.type === 'hitscan') {
      const cdef = { ...def, damage: alt.damage ?? def.damage, falloff: alt.falloff ?? def.falloff, tracer: alt.tracer ?? def.tracer };
      if (alt.type === 'pellets') for (const d of pelletDirs(baseDir, spreadDeg, alt.pellets || 8)) fireHitscanRay(ctx, cdef, origin, d, from);
      else fireHitscanRay(ctx, cdef, origin, sampleConeDir(baseDir, spreadDeg), from);
    }
    (ctx.audioBank || ctx.audio).play(alt.sound || def.sounds.fire, { volume: 1, rate: 0.95 + Math.random() * 0.08 });
    this.manager.recoil.onFire(def, false);
    ctx.events.emit('weapon:fired', { ...this._offTag(), def, origin, dir: baseDir, ads: 0, alt: true });
  }

  // ---- melee (knife/bat, §1C) ----------------------------------------------
  // A swing. Sets cooldown from MELEE, plays the swing sound, emits weapon:melee
  // (drives the anim swing + the arena net layer) and weapon:fired (with melee:
  // true so the arena net layer knows NOT to send a hitscan 'fire'). Then a LOCAL
  // sweep for immediate feedback: in single-player range it APPLIES damage like
  // fireHitscanRay; in arena it's fx-only (damage is server-authoritative).
  _meleeSwing(heavy) {
    const ctx = this.ctx;
    const def = this.def;
    const combat = MELEE[def.melee] || MELEE.knife;

    this._cooldown = (heavy ? combat.heavyCooldownMs : combat.lightCooldownMs) / 1000;
    this.state = 'firing';

    const origin = ctx.camera.getWorldPosition(_camPos).clone();
    const dir = ctx.camera.getWorldDirection(_camDir).clone();
    const range = heavy ? combat.heavyRange : combat.lightRange;

    // swing whoosh — heavy pitched down a touch so it reads heavier
    ctx.audio.play(`${def.melee}_swing`, { volume: 1, rate: heavy ? 0.82 : 0.98 + Math.random() * 0.06 });

    // let the anim + arena net layer hear the swing
    ctx.events.emit('weapon:melee', { def, heavy, origin, dir });
    // weapon:fired carries melee:true — the anim's generic recoil ignores it (it
    // branches on id), and the arena fire listener bails on e.melee.
    ctx.events.emit('weapon:fired', { ...this._offTag(), def, origin, dir, ads: 0, melee: true, heavy });

    // LOCAL sweep — one center ray for immediate feedback within melee range.
    const hit = ctx.world?.raycastShot?.(origin, dir, range);
    const struck = hit && hit.distance <= range;
    if (struck) {
      // SP range: apply damage directly (arena ignores this — server resolves it).
      if (hit.target) {
        const dmg = heavy ? combat.heavyDamage : combat.lightDamage;
        try { ctx.world.targets.damage(hit, dmg, def); } catch (e) { /* defensive */ }
      }
      ctx.events.emit('shot:impact', { hit, def });
      ctx.audio.play(`${def.melee}_hit`, { volume: 1, rate: heavy ? 0.9 : 1.0, position: hit.point });
    } else {
      ctx.audio.play('melee_whiff', { volume: 0.9, rate: heavy ? 0.85 : 1.0 });
    }
  }

  // ---- rocket (exotic) ------------------------------------------------------
  // Launch a travel-time rocket from the muzzle along the aim; on impact it
  // explodes (AoE damage + seekers). All cross-module calls are defensive —
  // the targets agent implements damageArea / nearestTarget / aimPoint.
  _fireRocket(origin, baseDir, spreadDeg, from) {
    const ctx = this.ctx;
    const def = this.def;
    const dir = sampleConeDir(baseDir, spreadDeg).clone();
    const proj = def.projectile ?? {};
    // rocket launches from the muzzle world position when we have one
    const start = (from && from.isVector3) ? from.clone() : origin.clone();
    this.manager.projectiles.spawn({
      origin: start,
      dir,
      speed: proj.speed ?? 55,
      gravity: proj.gravity ?? 0,
      def,
      color: proj.color ?? def.tracer?.color ?? 0xff7a2a,
      kind: 'rocket',
      trail: true,
      maxLife: this.manager.params.rocketLife,
      maxDist: this.manager.params.rocketDist,
      onImpact: (hit) => this._explode(hit),
    });
  }

  _explode(hit) {
    const ctx = this.ctx;
    const def = this.def;
    const ex = def.explosion ?? {};
    const point = (hit.point && hit.point.isVector3) ? hit.point.clone() : hit.point;
    const radius = ex.radius ?? 5;

    ctx.events.emit('weapon:explosion', { point, radius, def });
    ctx.audio.play('explosion', { volume: 1, position: point });

    // AoE damage through the normal targets path (defensive).
    const targets = ctx.world?.targets;
    try {
      targets?.damageArea?.(point, radius, ex.damage ?? 120, def, { falloff: true });
    } catch (e) { /* targets agent may not be present yet */ }

    this._spawnSeekers(point);
  }

  _spawnSeekers(point) {
    const ctx = this.ctx;
    const def = this.def;
    const ex = def.explosion ?? {};
    const count = ex.seekers ?? 5;
    if (count <= 0) return;

    const targets = ctx.world?.targets;
    const seekRadius = ex.seekRadius ?? 8;
    const exclude = new Set();
    let launchedAny = false;

    for (let i = 0; i < count; i++) {
      // spread the seekers across the nearest few live targets (excluding ones
      // already assigned) so 5 seekers don't all pile onto a single target.
      let target = null;
      try {
        target = targets?.nearestTarget?.(point, seekRadius, exclude) ?? null;
      } catch (e) { target = null; }
      if (target) exclude.add(target);
      // if we run out of distinct targets, re-home the remaining seekers onto
      // whatever's nearest (allow reuse) so they still seek rather than fly dead.
      if (!target && targets?.nearestTarget) {
        try { target = targets.nearestTarget(point, seekRadius) ?? null; } catch (e) { target = null; }
      }

      // launch outward/upward in a fan so seekers arc off the blast, then home
      const ang = (i / count) * Math.PI * 2;
      const dir = new THREE.Vector3(
        Math.cos(ang) * 0.7,
        0.6 + Math.random() * 0.3,
        Math.sin(ang) * 0.7,
      ).normalize();
      const start = point.clone().addScaledVector(dir, 0.4);

      // captured target ref; getTarget returns null once the target dies so the
      // seeker flies straight and expires (§12.3).
      const homingTarget = target;
      this.manager.projectiles.spawn({
        origin: start,
        dir,
        speed: ex.seekerSpeed ?? 28,
        gravity: 0,
        def,
        color: 0xffb060,
        kind: 'seeker',
        maxLife: ex.seekerLife ?? 2.5,
        maxDist: seekRadius * 4 + 20,
        radius: ex.seekerRadius ?? 1.2,
        homing: homingTarget ? {
          getTarget: () => this._liveTarget(homingTarget),
          turn: ex.seekerTurn ?? 6,
        } : null,
        onTargetHit: (h, tgt) => this._seekerHit(h, tgt, ex),
      });
      launchedAny = true;
    }

    if (launchedAny) ctx.audio.play('seeker_launch', { volume: 0.9, position: point });
  }

  // Returns the target if it's still alive/valid, else null (seeker goes dumb).
  _liveTarget(t) {
    if (!t) return null;
    if (t.dead === true || t.alive === false || t.hp <= 0) return null;
    return t;
  }

  _seekerHit(hit, target, ex) {
    const ctx = this.ctx;
    const dmg = ex.seekerDamage ?? 45;
    try {
      ctx.world?.targets?.damage?.(hit, dmg, this.def);
    } catch (e) { /* defensive */ }
    // seeker is consumed on contact (return falsy)
    return false;
  }

  // ---- sawblade -------------------------------------------------------------
  // Fire a ricochet blade: reflects off walls up to ricochet.maxBounces, carves
  // through targets (keeps flying), despawns on the bounce after the last one.
  _fireSawblade(origin, baseDir, spreadDeg, from) {
    const ctx = this.ctx;
    const def = this.def;
    const rc = def.ricochet ?? {};
    const dir = sampleConeDir(baseDir, spreadDeg).clone();
    const start = (from && from.isVector3) ? from.clone() : origin.clone();

    this.manager.projectiles.spawn({
      origin: start,
      dir,
      speed: rc.speed ?? def.projectile?.speed ?? 40,
      gravity: 0,
      def,
      color: def.projectile?.color ?? def.tracer?.color ?? 0x8affc8,
      kind: 'sawblade',
      maxLife: rc.life ?? 4,
      maxDist: (rc.speed ?? 40) * (rc.life ?? 4) + 10,
      radius: rc.radius ?? 0.18,
      ricochet: {
        bouncesLeft: rc.maxBounces ?? 2,
        onBounce: (hit) => {
          const point = (hit.point && hit.point.isVector3) ? hit.point.clone() : hit.point;
          ctx.events.emit('weapon:bounce', { point, def });
          ctx.audio.play('sawblade_bounce', { volume: 0.85, position: point });
          // spark fx reuse the standard impact path
          ctx.events.emit('shot:impact', { hit, def });
        },
      },
      onTargetHit: (hit, target) => {
        try {
          ctx.world?.targets?.damage?.(hit, rc.damage ?? def.damage ?? 55, def);
        } catch (e) { /* defensive */ }
        return true; // carve through — keep flying
      },
    });
  }

  _dryFire() {
    if (this._dryLatch || this._dryCooldown > 0) return;
    this._dryLatch = true;
    this._dryCooldown = this.manager.params.dryCooldown;
    this.ctx.events.emit('weapon:dryfire', { ...this._offTag(), def: this.def });
    this.ctx.audio.play('dryfire', { volume: 0.9 });
  }

  _muzzleWorld(fallback) {
    const m = this.ctx.viewmodel?.getMuzzleWorld?.();
    return m && m.isVector3 ? m.clone() : fallback.clone();
  }

  _startCycle() {
    const def = this.def;
    this._pendingCycle = false;
    this.state = 'cycling';
    this._timer = def.cycle.t;
    this.ctx.events.emit('weapon:cycle', { ...this._offTag(), def, phase: def.cycle.phase, duration: def.cycle.t });
    this.ctx.audio.play(`${def.id}_${def.cycle.phase}`, { volume: 0.9 });
  }

  _updateAds(dt) {
    const def = this.def;
    // dual-mode weapons use RMB for the ALT fire, not ADS — keep them hip-fire only.
    // dual-WIELDED guns also never ADS (RMB fires the left gun).
    if (def.dualMode || this._dualSide) {
      if (this._adsOn) { this._adsOn = false; this.ctx.player?.camera?.setAds?.(false, 1); }
      this.ads = 0;
      return;
    }
    const allow = this.state === 'idle' || this.state === 'firing' || this.state === 'cycling';
    const want = allow && this.ctx.input.down('ads');
    if (want !== this._adsOn) {
      this._adsOn = want;
      this.ctx.player?.camera?.setAds?.(want, def.adsFovScale);
      this.ctx.events.emit('weapon:ads', { def, on: want });
    }
    const target = this._adsOn ? 1 : 0;
    const step = dt / Math.max(0.01, def.adsT);
    const delta = target - this.ads;
    this.ads += Math.sign(delta) * Math.min(step, Math.abs(delta));
  }

  // ---- reload FSM -------------------------------------------------------------

  _canReload() {
    if (this.def.type === 'melee') return false; // melee never reloads
    return this.magAmmo < this.def.mag && (this.reserveAmmo > 0 || this.ctx.cheats.infiniteAmmo);
  }

  _startReload() {
    const def = this.def;
    const empty = this.magAmmo === 0;
    const perShell = !!def.reload.perShell;
    this._burstLeft = 0; // reloading cancels any unfinished burst
    this.state = 'reloading';
    this._reload = {
      empty,
      perShell,
      phases: perShell ? null : (empty && def.reload.emptyPhases) || def.reload.phases,
      idx: -1,
      phaseName: null,
      t: 0,
      shellIndex: 0,
      needsPump: perShell && empty, // chamber was empty → pump to finish
      cancelRequested: false,
      fireBuffered: false, // cancel came from fire input → shoot on finish
    };
    this.ctx.events.emit('weapon:reload_start', { ...this._offTag(), def, empty });
    this._advanceReload();
  }

  _updateReload(dt) {
    const r = this._reload;
    if (!r) return;
    // shotgun shells are interruptible: fire/ADS input cancels the REMAINING
    // shells — the shell in progress always finishes loading.
    if (r.perShell && !r.cancelRequested && r.phaseName === 'shell') {
      const input = this.ctx.input;
      if (input.pressed('fire') || input.down('fire')) {
        r.cancelRequested = true;
        r.fireBuffered = true; // shoot as soon as the current shell seats
      } else if (input.down('ads')) {
        r.cancelRequested = true;
      }
    }
    r.t -= dt;
    if (r.t <= 0) this._advanceReload();
  }

  /** Apply the finished phase's side effect, then start the next phase (or end). */
  _advanceReload() {
    const r = this._reload;
    const def = this.def;
    const events = this.ctx.events;

    if (r.perShell) {
      // --- side effects of the phase that just ended
      if (r.phaseName === 'shell') {
        this.magAmmo = Math.min(def.mag, this.magAmmo + 1);
        if (!this.ctx.cheats.infiniteAmmo) this.reserveAmmo--;
      } else if (r.phaseName === 'pump') {
        r.needsPump = false;
        this._finishReload(false);
        return;
      }

      // --- choose the next phase
      const wantMore =
        this.magAmmo < def.mag && (this.reserveAmmo > 0 || this.ctx.cheats.infiniteAmmo);
      if (r.cancelRequested) {
        const needsPump = r.needsPump;
        const fireNow = r.fireBuffered && !needsPump && this.magAmmo > 0;
        this._finishReload(true);
        // an empty chamber still has to be pumped before the gun can fire —
        // it plays as a regular cycle so the E agent animates it for free.
        if (needsPump) this._startCycle();
        // fire-cancel buffers the shot: the moment the shell seats, shoot.
        else if (fireNow && this._cooldown <= 0) this._fire();
        return;
      }
      if (wantMore) {
        const t = this._phaseT('shell');
        r.phaseName = 'shell';
        r.t = t;
        events.emit('weapon:reload_phase', { ...this._offTag(), def, phase: 'shell', duration: t, index: r.shellIndex++ });
        this.ctx.audio.play(`${def.id}_shell`, { volume: 0.85 });
        return;
      }
      if (r.needsPump) {
        const t = this._phaseT('pump');
        r.phaseName = 'pump';
        r.t = t;
        events.emit('weapon:reload_phase', { ...this._offTag(), def, phase: 'pump', duration: t });
        this.ctx.audio.play(`${def.id}_pump`, { volume: 0.9 });
        return;
      }
      this._finishReload(false);
      return;
    }

    // --- magazine guns: linear phase list. Ammo seats as the loading phase
    // ENDS — 'magin' for mag guns, 'load' for single-load guns (exotic/sawblade).
    if (r.phaseName === 'magin' || r.phaseName === 'load') this._transferMagAmmo();
    r.idx++;
    if (r.idx >= r.phases.length) {
      this._finishReload(false);
      return;
    }
    const ph = r.phases[r.idx];
    r.phaseName = ph.name;
    r.t = ph.t;
    events.emit('weapon:reload_phase', { ...this._offTag(), def, phase: ph.name, duration: ph.t });
    this.ctx.audio.play(`${def.id}_${ph.name}`, { volume: 0.85 });
  }

  _phaseT(name) {
    const ph = this.def.reload.phases.find((p) => p.name === name);
    return ph ? ph.t : 0.55;
  }

  _transferMagAmmo() {
    const need = this.def.mag - this.magAmmo;
    if (need <= 0) return;
    const infinite = this.ctx.cheats.infiniteAmmo;
    const take = infinite ? need : Math.min(need, this.reserveAmmo);
    this.magAmmo += take;
    if (!infinite) this.reserveAmmo -= take;
  }

  _finishReload(cancelled) {
    this._reload = null;
    this.state = 'idle';
    this.ctx.events.emit('weapon:reload_end', { ...this._offTag(), def: this.def, cancelled });
  }
}

// ===========================================================================
// WeaponManager — selection, switching, shared recoil + projectiles.
// ===========================================================================
export class WeaponManager {
  constructor(ctx) {
    this.ctx = ctx;
    this.defs = WEAPONS;
    registerWeaponTunables(ctx);

    // shared/global weapon-feel numbers
    this.params = {
      moveRefSpeed: 8, // m/s of horizontal speed = full movement spread penalty
      adsMoveDeadzone: 2, // m/s under which ADS movement penalty is zero
      adsAirScale: 0.5, // fraction of air spread applied while ADS
      adsBloomScale: 0.4, // fraction of bloom applied while ADS
      cycleDelay: 0.12, // s between shot and pump/bolt start
      inspectT: 2.5,
      dryCooldown: 0.3,
      rocketLife: 4.0, // s fuse before a rocket auto-detonates (max travel)
      rocketDist: 220, // m max rocket travel before detonation
    };
    const t = (key, prop, min, max, step) =>
      ctx.tunables.push({ cat: 'weapons', key, obj: this.params, prop, min, max, step });
    t('moveRefSpeed', 'moveRefSpeed', 3, 16, 0.5);
    t('adsMoveDeadzone', 'adsMoveDeadzone', 0, 6, 0.1);
    t('adsAirScale', 'adsAirScale', 0, 1, 0.05);
    t('adsBloomScale', 'adsBloomScale', 0, 1, 0.05);
    t('cycleDelay', 'cycleDelay', 0, 0.5, 0.01);
    t('inspectT', 'inspectT', 0.5, 5, 0.1);
    t('dryCooldown', 'dryCooldown', 0.05, 1, 0.05);
    t('rocketLife', 'rocketLife', 1, 8, 0.25);
    t('rocketDist', 'rocketDist', 50, 500, 10);

    this.recoil = new Recoil(ctx);
    this.projectiles = new ProjectileManager(ctx);

    this.weapons = new Map();
    for (const def of this.defs) this.weapons.set(def.id, new Weapon(ctx, def, this));

    // current is valid immediately (HUD may read it before the first tick);
    // the weapon:equip event fires on the first fixedUpdate so every listener
    // constructed after us still hears it.
    this.current = this.weapons.get('pistol');
    this.lastId = null;
    this.lastMeleeId = 'knife'; // V toggles to the last melee weapon used (default knife)
    this._pendingId = null;
    this._booted = false;

    // acquired = the weapon ids the player currently OWNS. Defaults to the FULL
    // roster so RANGE + built-in arena maps are unchanged. On CUSTOM maps the net
    // layer strips this to a starter loadout so guns must be found as pickups.
    this.acquired = new Set(this.defs.map((d) => d.id));

    // DUAL-WIELD: holding a one-handed gun + picking up a DIFFERENT one-handed gun
    // wields both — current stays the RIGHT gun (LMB), the pickup becomes the LEFT
    // gun (RMB). ADS is disabled for both. Any weapon switch exits dual-wield.
    this.offhand = null;      // the LEFT-hand Weapon instance (or null)
    this.dualActive = false;
  }

  /** One-handed guns that can be dual-wielded. */
  static ONE_HANDED = new Set(['pistol', 'revolver', 'smg']);

  canDualWith(id) {
    const cur = this.current?.def?.id;
    return !!(cur && id && id !== cur &&
      WeaponManager.ONE_HANDED.has(cur) && WeaponManager.ONE_HANDED.has(id) &&
      this.weapons.has(id));
  }

  /** Enter dual-wield: current = right gun, `leftId` = left gun (fires on RMB). */
  enterDual(leftId) {
    if (!this.canDualWith(leftId)) return false;
    if (this.dualActive) this.exitDual();
    this.grant(leftId);
    this.offhand = this.weapons.get(leftId);
    this.offhand._dualSide = 'L';
    this.offhand._fireAction = 'ads';   // RMB fires the left gun
    this.current._dualSide = 'R';
    this.dualActive = true;
    this.offhand.beginEquip();          // emits weapon:equip {offhand:true} → Viewmodel offMount
    this.ctx.events.emit('dual:enter', { right: this.current.def, left: this.offhand.def });
    return true;
  }

  exitDual() {
    if (!this.dualActive) return;
    const off = this.offhand;
    this.dualActive = false;
    this.offhand = null;
    if (off) { off._dualSide = null; off._fireAction = 'fire'; off.state = 'idle'; off.ads = 0; off._adsOn = false; }
    if (this.current) this.current._dualSide = null;
    this.ctx.events.emit('dual:exit', {});
  }

  _owned(id) { return !this.acquired || this.acquired.has(id); }

  /** Grant a weapon id into the owned set (from a pickup). */
  grant(id) { if (this.weapons.has(id)) this.acquired.add(id); }

  /** Ammo pickup — top every weapon's reserve back up to its def maximum. */
  resupply() { for (const w of this.weapons.values()) { if (w.def.reserve) w.reserveAmmo = w.def.reserve; } }

  /** Replace the owned set (a loadout change). Keeps `current` valid. */
  setAcquired(ids) {
    this.acquired = new Set((Array.isArray(ids) ? ids : []).filter((id) => this.weapons.has(id)));
    if (this.acquired.size === 0) this.acquired.add('knife');
    // a loadout strip that removes the LEFT gun ends dual-wield
    if (this.dualActive && this.offhand && !this.acquired.has(this.offhand.def.id)) this.exitDual();
    // if the held (or pending) gun is no longer owned, swap to an owned one
    // (prefer a firearm, else whatever's left) so the HUD never holds nothing.
    if (!this._owned(this._pendingId ?? this.current?.def?.id)) {
      const gun = this.defs.find((d) => d.type !== 'melee' && this.acquired.has(d.id));
      const fallback = gun ? gun.id : [...this.acquired][0];
      if (fallback) this.select(fallback);
    }
  }

  /** Switch to a weapon by id — holsters the current gun first. */
  select(id) {
    if (!this.weapons.has(id)) return;
    if (this.acquired && !this.acquired.has(id)) return; // not owned yet (custom map)
    if (this.dualActive) this.exitDual(); // any explicit switch drops the left gun
    if (this._pendingId) {
      this._pendingId = id; // retarget mid-holster
      return;
    }
    if (id === this.current.def.id) return;
    this._pendingId = id;
    this.current.beginHolster();
  }

  quickswap() {
    if (this.lastId) this.select(this.lastId);
  }

  /** Current effective spread in degrees (crosshair bloom reads this). */
  getSpreadDeg() {
    return this.current ? this.current.getSpreadDeg() : 0;
  }

  fixedUpdate(dt) {
    if (!this._booted) {
      this._booted = true;
      this.current.beginEquip();
    }

    this._handleSwitchInput();

    // dual-wield: R reloads BOTH guns (peek the edge before either consumes it)
    if (this.dualActive && this.offhand && this.ctx.input.pressed('reload')) {
      this.current._reloadQueued = true;
      this.offhand._reloadQueued = true;
    }

    this.current.fixedUpdate(dt);
    if (this.dualActive && this.offhand) this.offhand.fixedUpdate(dt);

    if (this._pendingId && this.current._holsterDone) {
      const next = this.weapons.get(this._pendingId);
      this._pendingId = null;
      if (next !== this.current) this.lastId = this.current.def.id;
      this.current = next;
      this.recoil.resetPattern();
      next.beginEquip();
    }

    this.projectiles.fixedUpdate(dt);
  }

  render(dt, alpha) {
    // no weapon visuals here (E agent's job) — recoil recovery runs post-
    // CameraFX so counter-pull sees fresh camera angles, and projectile bolts
    // get their interpolated transforms + light flicker.
    this.recoil.update(dt);
    this.projectiles.render(dt, alpha);
  }

  _handleSwitchInput() {
    const input = this.ctx.input;

    // remember the last melee weapon we held so V toggles back to IT.
    if (this.current?.def?.type === 'melee') this.lastMeleeId = this.current.def.id;

    // index-driven (§12.1): slotN → the def whose slot === N. Melee weapons use
    // slots 10/11 (off the number row) so 1–9 never select them — they're V-only.
    for (let i = 1; i <= 9; i++) {
      if (input.consumePressed('slot' + i)) {
        const def = this.defs.find((d) => d.slot === i) ?? this.defs[i - 1];
        if (def && this._owned(def.id)) this.select(def.id);
      }
    }

    // V — dedicated MELEE slot: switch to the last (owned) melee weapon (default knife).
    if (input.consumePressed('melee')) {
      let target = (this.weapons.has(this.lastMeleeId) && this._owned(this.lastMeleeId)) ? this.lastMeleeId : 'knife';
      if (!this._owned(target)) { const m = this.defs.find((d) => d.type === 'melee' && this._owned(d.id)); if (m) target = m.id; }
      this.select(target);
    }

    if (input.consumePressed('quickswap')) this.quickswap();

    const w = input.consumeWheel();
    if (w) {
      // cycle only through OWNED weapons (custom maps start with a stripped set).
      const list = this.defs.filter((d) => this._owned(d.id));
      if (list.length) {
        const baseId = this._pendingId ?? this.current.def.id;
        let idx = list.findIndex((d) => d.id === baseId);
        if (idx < 0) idx = 0;
        const n = list.length;
        this.select(list[(((idx + w) % n) + n) % n].id);
      }
    }
  }
}
