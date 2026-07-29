// RANGE — GunAnim.js (agent E)
// Procedural, spring-driven, LAYERED viewmodel animation. Each render frame the
// GunAnim composes a stack of pose layers onto the gun root Group + its animated
// parts (slide/bolt/pump/mag/hammer/…). NOTHING snaps: every layer is a
// critically-damped spring or an exp-decay curve, framerate-independent.
//
// Layers (composed in this order, all additive except the base hip/ADS pose):
//   1. base pose        — hip position/rotation, blended toward the ADS sight pose
//   2. idle sway        — mouse-look lag spring + breathing sine
//   3. movement bob     — speed-scaled figure-8, grounded only; wallrun roll tilt;
//                         land-settle impulse on player:land
//   4. fire recoil      — kickback (−Z) + muzzle rise + random roll, spring recovery
//   5. reload choreo    — mag out/in, rack/bolt/pump, per-shell shotgun loading
//   6. equip/holster    — drop/raise + tilt over def.equipT/holsterT
//   7. inspect          — slow turn/tilt showoff loop (cancelled by anything)
//   plus PART ACTIONS: slide blowback, bolt reciprocation, pump rack, bolt-handle
//   choreography, hammer drop, charging-handle jitter, mag drop/seat.
//
// The Viewmodel owns one GunAnim and calls setModel() on weapon:equip, then
// fixedUpdate(dt) (input-sampling / discrete timers) and render(dt) (springs).
//
// ALL magnitudes / frequencies / spring constants live in ctx.tunables under
// cat 'viewmodel' (registered once, shared across guns).
import * as THREE from 'three';

const DEG = Math.PI / 180;

// ---------------------------------------------------------------------------
// Spring helpers (critically-damped, framerate-independent).
// ---------------------------------------------------------------------------

// Exponential smoothing toward a target; `rate` ~ how fast (1/s-ish). Stable for
// any dt because it uses 1 - exp(-rate*dt).
function expApproach(cur, target, rate, dt) {
  const t = 1 - Math.exp(-rate * dt);
  return cur + (target - cur) * t;
}

// A scalar critically-damped spring. omega = angular frequency (higher = snappier).
class Spring1 {
  constructor(omega = 20) {
    this.value = 0;
    this.vel = 0;
    this.target = 0;
    this.omega = omega;
  }
  set(v) { this.value = v; this.vel = 0; }
  step(dt) {
    // critically-damped analytic-ish integration (semi-implicit, stable)
    const o = this.omega;
    const k = o * o;
    const c = 2 * o;
    const a = (this.target - this.value) * k - this.vel * c;
    this.vel += a * dt;
    this.value += this.vel * dt;
    return this.value;
  }
}

// A Vector3 critically-damped spring (three independent axes, shared omega).
class SpringV3 {
  constructor(omega = 20) {
    this.value = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.target = new THREE.Vector3();
    this.omega = omega;
    this._a = new THREE.Vector3();
  }
  step(dt) {
    const o = this.omega;
    const k = o * o;
    const c = 2 * o;
    // a = (target - value)*k - vel*c
    this._a.copy(this.target).sub(this.value).multiplyScalar(k).addScaledVector(this.vel, -c);
    this.vel.addScaledVector(this._a, dt);
    this.value.addScaledVector(this.vel, dt);
    return this.value;
  }
}

function lerp(a, b, t) { return a + (b - a) * t; }
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
function smoothstep(t) { t = clamp01(t); return t * t * (3 - 2 * t); }

// ---------------------------------------------------------------------------
// GunAnim
// ---------------------------------------------------------------------------
export class GunAnim {
  constructor(ctx) {
    this.ctx = ctx;

    // Active model (set by Viewmodel.setModel). null until first equip.
    this.model = null;   // { group, parts, meta, id }
    this.root = null;    // group whose transform we drive (the mount child)
    this.parts = null;
    this.meta = null;

    // ---- tunables (shared, one 'viewmodel' category) ----
    this.t = {
      // idle sway
      swaySpring: 9,       // how snappy the look-lag pose follows the mouse
      swayPos: 0.012,      // meters of positional lag per unit look delta
      swayRot: 0.9,        // degrees of rotational lag per unit look delta
      swayMax: 0.05,       // clamp on positional sway (m)
      breathAmp: 0.0032,   // breathing bob amplitude (m)
      breathRot: 0.35,     // breathing rot amplitude (deg)
      breathFreq: 0.9,     // breaths/sec-ish

      // movement bob
      bobAmp: 0.02,        // base positional bob amplitude (m) at full speed
      bobRot: 1.6,         // rotational bob amplitude (deg) at full speed
      bobFreq: 1.05,       // cycles per footstep-ish, scaled by speed
      bobRefSpeed: 7.5,    // m/s that maps to full bob
      sprintMult: 1.45,    // extra bob while sprinting fast
      bobSpring: 14,       // how fast bob amplitude eases in/out

      // wallrun tilt
      wallrunRoll: 7,      // deg of extra gun roll following camera lean
      wallrunSpring: 8,

      // land settle
      landDip: 0.05,       // m of downward dip at a hard land
      landRot: 5,          // deg of pitch punch on land
      landSpring: 22,      // recovery snappiness of the land impulse

      // fire recoil
      fireKickZ: 0.05,     // base kickback along +Z (toward the shooter), scaled per gun
      fireRise: 3.2,       // base muzzle rise (deg pitch up)
      fireRoll: 1.6,       // base random roll (deg)
      fireYaw: 0.7,        // base random yaw (deg)
      fireSpring: 26,      // recoil recovery snappiness
      fireImpulseGain: 1.0,

      // ADS
      adsSpring: 16,       // how fast the gun springs to/from the sight pose
      adsSwayMult: 0.2,    // sway/bob multiplier while fully ADS
      scopeHideAds: 0.55,  // ads value above which a scoped gun's model may hide (HUD owns this; unused here)

      // equip / holster
      equipDrop: 0.16,     // m the gun drops at the start of an equip
      equipTilt: 22,       // deg of tilt during equip/holster
      equipSlideZ: 0.14,   // m the gun pulls back during equip

      // inspect
      inspectYaw: 42,      // deg turn during inspect
      inspectPitch: 18,    // deg tilt during inspect
      inspectRoll: 12,
      inspectRaise: 0.03,  // m raise toward the face

      // part actions (fractions of natural travel; absolute meters/deg)
      slideTravel: 0.026,  // m the pistol slide/bolt blows back
      boltTravel: 0.03,    // m the smg/ar bolt reciprocates
      pumpTravel: 0.07,    // m the shotgun pump racks
      hammerDrop: 0.42,    // rad the hammer falls
      chJitter: 0.02,      // m charging-handle jitter on AR fire
      partSpring: 40,      // snappy part-return spring

      // exotic (rocket launcher) — heavy, thick, slow recover
      exoticKickZ: 0.11,   // m of kickback along +Z on rocket launch
      exoticRise: 6.5,     // deg muzzle rise on launch
      exoticRecover: 12,   // recoil-recover spring omega used while exotic firing (lower = slower/heavier)
      exoticLoadZ: 0.05,   // m the pump/loader strokes forward during 'load' reload

      // sawblade launcher — fast idle disc spin + a punchy launch jolt
      bladeSpin: 26,       // rad/s idle spin of the loaded disc while equipped
      bladeFireSpin: 55,   // rad/s peak extra spin burst on fire
      sawKickZ: 0.03,      // m of quick kickback on blade launch
      sawRise: 2.0,        // deg muzzle rise on blade launch
      feederStroke: 0.03,  // m the feeder arm pushes during 'load'
    };
    this._registerTunables();

    // ---- per-layer state ----
    this._sway = new SpringV3(this.t.swaySpring);      // x,y = pos lag; z unused
    this._swayRot = new SpringV3(this.t.swaySpring);    // pitch,yaw,roll lag
    this._breathPhase = Math.random() * Math.PI * 2;

    this._bobAmt = new Spring1(this.t.bobSpring);       // 0..~1 eased bob strength
    this._bobPhase = 0;
    this._wallRoll = new Spring1(this.t.wallrunSpring);
    this._land = new Spring1(this.t.landSpring);        // impulse value, decays to 0
    this._landVelKick = 0;

    // fire recoil accumulators (pos + rot), spring back to 0
    this._recoilPos = new SpringV3(this.t.fireSpring);
    this._recoilRot = new SpringV3(this.t.fireSpring);

    // ADS blend 0..1 (springs toward weapon.ads target)
    this._ads = new Spring1(this.t.adsSpring);

    // equip/holster: 0 = fully stowed/dropped, 1 = fully presented
    this._present = 1;         // current presentation (springs / lerps)
    this._presentTarget = 1;
    this._presentRate = 6;     // set per action from equipT/holsterT
    this._presentMode = 'idle'; // 'equip' | 'holster' | 'idle'

    // inspect 0..1
    this._inspect = new Spring1(8);
    this._inspectPhase = 0;
    this._inspecting = false;

    // ---- part-action animators ----
    // Each is a small state machine advanced in render(dt). We store target
    // offsets that springs chase, plus discrete "cycle" timelines for pump/bolt.
    this._partSprings = {};    // name -> SpringV3 (translation offset)
    this._partRotSprings = {}; // name -> Spring1 (single-axis rotation offset)
    this._cycle = null;        // active pump/bolt cycle timeline
    this._boltHandleRest = 0;  // sniper bolt handle rest rotation (from model)

    // reload choreography state
    this._reload = null;       // { phase, t, dur, def, empty, ... }
    this._supportTarget = new THREE.Vector3(); // where the left hand should be (local)
    this._supportPose = 'grip'; // 'grip' | 'mag' | 'bolt' | 'pump' | 'ch' | 'port'
    this._magHidden = false;

    // shell-eject scheduling: some ejects fire mid-cycle (shotgun pump-back,
    // sniper bolt-back) rather than on weapon:fired.
    this._pendingEject = null; // { at: cycleTime, done: bool }

    // melee swing timeline (§1C): { t, dur, heavy, melee } or null when idle.
    // Drives an additive root pose (windup → fast arc → recover) in render().
    this._meleeSwing = null;

    // event unsubscribers
    this._unsub = [];
    this._wire();

    // scratch
    this._v = new THREE.Vector3();
    this._e = new THREE.Euler();
  }

  // ---- tunable registration ------------------------------------------------
  _registerTunables() {
    const T = this.t;
    const push = (key, prop, min, max, step, label) =>
      this.ctx.tunables.push({ cat: 'viewmodel', key, obj: T, prop, min, max, step, label });
    push('swaySpring', 'swaySpring', 2, 30, 0.5, 'Sway spring');
    push('swayPos', 'swayPos', 0, 0.05, 0.001, 'Sway pos');
    push('swayRot', 'swayRot', 0, 4, 0.05, 'Sway rot (deg)');
    push('swayMax', 'swayMax', 0.005, 0.15, 0.005, 'Sway max (m)');
    push('breathAmp', 'breathAmp', 0, 0.01, 0.0002, 'Breath amp');
    push('breathRot', 'breathRot', 0, 2, 0.02, 'Breath rot (deg)');
    push('breathFreq', 'breathFreq', 0.2, 2, 0.05, 'Breath freq');
    push('bobAmp', 'bobAmp', 0, 0.06, 0.001, 'Bob amp (m)');
    push('bobRot', 'bobRot', 0, 5, 0.05, 'Bob rot (deg)');
    push('bobFreq', 'bobFreq', 0.3, 3, 0.05, 'Bob freq');
    push('bobRefSpeed', 'bobRefSpeed', 3, 14, 0.5, 'Bob ref speed');
    push('sprintMult', 'sprintMult', 1, 2.5, 0.05, 'Sprint bob ×');
    push('bobSpring', 'bobSpring', 4, 30, 0.5, 'Bob ease');
    push('wallrunRoll', 'wallrunRoll', 0, 20, 0.5, 'Wallrun roll (deg)');
    push('landDip', 'landDip', 0, 0.15, 0.005, 'Land dip (m)');
    push('landRot', 'landRot', 0, 12, 0.5, 'Land pitch (deg)');
    push('fireKickZ', 'fireKickZ', 0, 0.15, 0.002, 'Fire kickback (m)');
    push('fireRise', 'fireRise', 0, 10, 0.1, 'Fire rise (deg)');
    push('fireRoll', 'fireRoll', 0, 6, 0.05, 'Fire roll (deg)');
    push('fireYaw', 'fireYaw', 0, 4, 0.05, 'Fire yaw (deg)');
    push('fireSpring', 'fireSpring', 8, 50, 1, 'Fire recover');
    push('fireImpulseGain', 'fireImpulseGain', 0.2, 2, 0.05, 'Fire gain ×');
    push('adsSpring', 'adsSpring', 6, 40, 1, 'ADS spring');
    push('adsSwayMult', 'adsSwayMult', 0, 1, 0.02, 'ADS sway ×');
    push('equipDrop', 'equipDrop', 0, 0.3, 0.005, 'Equip drop (m)');
    push('equipTilt', 'equipTilt', 0, 45, 1, 'Equip tilt (deg)');
    push('equipSlideZ', 'equipSlideZ', 0, 0.3, 0.005, 'Equip slide (m)');
    push('inspectYaw', 'inspectYaw', 0, 90, 1, 'Inspect yaw (deg)');
    push('inspectPitch', 'inspectPitch', 0, 45, 1, 'Inspect pitch (deg)');
    push('inspectRoll', 'inspectRoll', 0, 45, 1, 'Inspect roll (deg)');
    push('inspectRaise', 'inspectRaise', 0, 0.1, 0.002, 'Inspect raise (m)');
    push('slideTravel', 'slideTravel', 0, 0.05, 0.001, 'Slide travel (m)');
    push('boltTravel', 'boltTravel', 0, 0.06, 0.001, 'Bolt travel (m)');
    push('pumpTravel', 'pumpTravel', 0, 0.12, 0.002, 'Pump travel (m)');
    push('hammerDrop', 'hammerDrop', 0, 1, 0.02, 'Hammer drop (rad)');
    push('chJitter', 'chJitter', 0, 0.05, 0.001, 'Charge jitter (m)');
    push('partSpring', 'partSpring', 15, 70, 1, 'Part spring');
    push('exoticKickZ', 'exoticKickZ', 0, 0.25, 0.005, 'Exotic kickback (m)');
    push('exoticRise', 'exoticRise', 0, 14, 0.1, 'Exotic rise (deg)');
    push('exoticRecover', 'exoticRecover', 6, 40, 1, 'Exotic recover');
    push('exoticLoadZ', 'exoticLoadZ', 0, 0.12, 0.002, 'Exotic load stroke (m)');
    push('bladeSpin', 'bladeSpin', 0, 60, 1, 'Blade idle spin (rad/s)');
    push('bladeFireSpin', 'bladeFireSpin', 0, 120, 1, 'Blade fire spin (rad/s)');
    push('sawKickZ', 'sawKickZ', 0, 0.1, 0.002, 'Sawblade kickback (m)');
    push('sawRise', 'sawRise', 0, 8, 0.1, 'Sawblade rise (deg)');
    push('feederStroke', 'feederStroke', 0, 0.08, 0.002, 'Feeder stroke (m)');
  }

  // ---- model binding (called by Viewmodel on equip) ------------------------
  setModel(model) {
    this.model = model;
    this.root = model?.group ?? null;
    this.parts = model?.parts ?? null;
    this.meta = model?.meta ?? null;

    // reset transient layers so a swap looks clean (equip layer drives the raise)
    this._recoilPos.value.set(0, 0, 0); this._recoilPos.vel.set(0, 0, 0); this._recoilPos.target.set(0, 0, 0);
    this._recoilRot.value.set(0, 0, 0); this._recoilRot.vel.set(0, 0, 0); this._recoilRot.target.set(0, 0, 0);
    this._land.set(0); this._land.target = 0;
    this._bobAmt.set(0);
    this._cycle = null;
    this._pendingEject = null;
    this._reload = null;
    this._inspecting = false;
    this._inspect.set(0); this._inspect.target = 0;
    this._magHidden = false;
    this._supportPose = 'grip';
    this._meleeSwing = null;       // clear any in-flight swing on swap

    // new-gun transient state
    this._warheadHidden = false;   // exotic: warhead gone after fire until reload
    this._bladeAngle = 0;          // sawblade: accumulated disc spin
    this._bladeSpinBoost = 0;      // sawblade: extra spin (decays) on fire

    // build/refresh per-part springs for the parts we animate
    this._partSprings = {};
    this._partRotSprings = {};
    if (this.parts) {
      const names = ['slide', 'bolt', 'pump', 'mag', 'chargingHandle', 'boltHandle', 'hammer', 'loader', 'feeder', 'ejector'];
      for (const n of names) {
        if (this.parts[n]) {
          const s = new SpringV3(this.t.partSpring);
          // remember rest so we always animate as an OFFSET from the model's authored pose
          s.rest = this.parts[n].position.clone();
          s.restRot = this.parts[n].rotation.clone();
          this._partSprings[n] = s;
        }
      }
      // sniper bolt handle rest rotation (rotates around Z)
      if (this.parts.boltHandle) this._boltHandleRest = this.parts.boltHandle.rotation.z;
      if (this.parts.hammer) this._hammerRest = this.parts.hammer.rotation.x;
      // revolver cylinder swing-out (rotation.y around the crane): 0 closed → 1 swung out
      this._cylinderRest = this.parts.cylinder ? this.parts.cylinder.rotation.y : 0;
      this._cylinderSwing = new Spring1(this.t.partSpring * 0.5);
      this._cylinderSwing.set(0); this._cylinderSwing.target = 0;
      this._cylEjected = false;
      // exotic warhead starts loaded/visible on equip; blade starts at its authored angle
      if (this.parts.warhead) this.parts.warhead.visible = true;
      if (this.parts.blade) this._bladeAngle = this.parts.blade.rotation.z;
    }
  }

  // ---- event wiring --------------------------------------------------------
  _wire() {
    // OFFHAND (dual-wield left gun) events are rendered/kicked by the Viewmodel's
    // own offhand mount — the main-gun animator must ignore them entirely.
    const on = (name, fn) => this._unsub.push(this.ctx.events.on(name, (e) => { if (e && e.offhand) return; fn(e); }));

    on('weapon:equip', (e) => this._onEquip(e));
    on('weapon:holster', (e) => this._onHolster(e));
    on('weapon:fired', (e) => this._onFired(e));
    on('weapon:melee', (e) => this._onMelee(e));
    on('weapon:dryfire', (e) => this._onDryfire(e));
    on('weapon:cycle', (e) => this._onCycle(e));
    on('weapon:reload_start', (e) => this._onReloadStart(e));
    on('weapon:reload_phase', (e) => this._onReloadPhase(e));
    on('weapon:reload_end', (e) => this._onReloadEnd(e));
    on('weapon:ads', (e) => this._onAds(e));
    on('player:land', (e) => this._onLand(e));
  }

  dispose() {
    for (const u of this._unsub) u();
    this._unsub.length = 0;
  }

  // =========================================================================
  // Event handlers — set targets / kick springs. No matrix math here.
  // =========================================================================

  _onEquip() {
    // start presented from below, raise up
    this._present = 0;
    this._presentTarget = 1;
    this._presentMode = 'equip';
    const T = this._curDef()?.equipT ?? 0.3;
    this._presentRate = 1 / Math.max(0.05, T);
    // equip cancels reload pose / inspect instantly
    this._reload = null;
    this._magHidden = false;
    this._warheadHidden = false; // freshly drawn weapon is loaded
    this._supportPose = 'grip';
    this._inspecting = false;
    this._inspect.target = 0;
  }

  _onHolster() {
    this._presentTarget = 0;
    this._presentMode = 'holster';
    const T = this._curDef()?.holsterT ?? 0.25;
    this._presentRate = 1 / Math.max(0.05, T);
    this._reload = null;
    this._inspecting = false;
    this._inspect.target = 0;
  }

  _onFired(e) {
    const def = e?.def ?? this._curDef();
    // fire cancels inspect
    this._inspecting = false;
    this._inspect.target = 0;

    const feelFlash = def?.feel?.flash ?? 0.6;
    const gain = this.t.fireImpulseGain * (0.65 + feelFlash);
    const id = def?.id;

    // ---- MELEE: the swing pose is driven by _onMelee (weapon:melee). weapon:fired
    // still fires (melee:true) so the arena net layer hears it — but there's no
    // gunshot recoil to apply, so bail before the generic kick/part-action code. ---
    if (def?.type === 'melee') return;

    // ---- EXOTIC: heavy rocket launch — override the generic recoil with a big,
    // slow, thick kick; the warhead leaves the tube (part hides until reload). ---
    if (id === 'exotic') {
      const og = this.omegaScale(this._recoilPos.omega);
      const or = this.omegaScale(this._recoilRot.omega);
      this._recoilPos.vel.z += this.t.exoticKickZ * gain * og;
      this._recoilPos.vel.y += this.t.exoticKickZ * 0.4 * gain * og;   // shove up into the shoulder
      this._recoilRot.vel.x += -this.t.exoticRise * DEG * gain * or;
      this._recoilRot.vel.z += (Math.random() - 0.5) * 2 * this.t.fireRoll * 1.5 * DEG * gain * or;
      this._warheadHidden = true;                                      // fired: tube now empty
      if (this.parts?.warhead) this.parts.warhead.visible = false;
      return;
    }

    // ---- SAWBLADE: quick punchy launch jolt + a spin burst on the disc. ----
    if (id === 'sawblade') {
      const og = this.omegaScale(this._recoilPos.omega);
      const or = this.omegaScale(this._recoilRot.omega);
      this._recoilPos.vel.z += this.t.sawKickZ * gain * og;
      this._recoilRot.vel.x += -this.t.sawRise * DEG * gain * or;
      this._recoilRot.vel.z += (Math.random() - 0.5) * 2 * this.t.fireRoll * DEG * gain * or;
      this._bladeSpinBoost = this.t.bladeFireSpin;                     // disc whines up briefly
      // feeder kicks a fresh blade forward into the rail
      const f = this._partSprings.feeder;
      if (f) f.vel.z += -this.t.feederStroke * this.t.partSpring;      // push toward muzzle (−Z)
      return;
    }

    // kickback (+Z toward shooter), muzzle rise (−pitch = up), random roll/yaw
    this._recoilPos.vel.z += this.t.fireKickZ * gain * this.omegaScale(this._recoilPos.omega);
    this._recoilPos.vel.y += this.t.fireKickZ * 0.25 * gain * this.omegaScale(this._recoilPos.omega);
    this._recoilRot.vel.x += -this.t.fireRise * DEG * gain * this.omegaScale(this._recoilRot.omega);
    this._recoilRot.vel.z += (Math.random() - 0.5) * 2 * this.t.fireRoll * DEG * gain * this.omegaScale(this._recoilRot.omega);
    this._recoilRot.vel.y += (Math.random() - 0.5) * 2 * this.t.fireYaw * DEG * gain * this.omegaScale(this._recoilRot.omega);

    // part action per gun + shell eject (for guns that eject on fire)
    if (id === 'pistol') { this._kickSlide(); this._dropHammer(); this._ejectNow(def); }
    else if (id === 'smg') { this._kickBolt('bolt'); this._ejectNow(def); }
    else if (id === 'ar') { this._kickBolt('bolt'); this._jitterCharging(); this._ejectNow(def); }
    else if (id === 'dmr') { this._kickBolt('bolt'); this._ejectNow(def); }   // semi-auto action cycles each shot
    else if (id === 'revolver') { this._dropHammer(); }                       // hammer falls; spent case stays in the cylinder until reload
    // shotgun ejects during pump-back (weapon:cycle); sniper ejects during bolt-back.
  }

  _onDryfire() {
    // light hammer/trigger click for the pistol; a tiny nudge otherwise
    const id = this._curDef()?.id;
    if (id === 'pistol') this._dropHammer();
    this._recoilRot.vel.x += -0.4 * DEG * 10;
  }

  // ---- MELEE swing (§1C) — start a swing timeline the render pass turns into an
  // additive root-pose arc (windup → fast down-and-across swing → spring recover).
  // knife = quick/tight; bat = slower/bigger (scaled by heavy + melee id).
  _onMelee(e) {
    this._inspecting = false;
    this._inspect.target = 0;
    const heavy = !!e?.heavy;
    const melee = e?.def?.melee ?? this._curDef()?.melee ?? 'knife';
    const dur = (melee === 'bat' ? 0.5 : 0.32) * (heavy ? 1.35 : 1);
    this._meleeSwing = { t: 0, dur, heavy, melee };
  }

  _onCycle(e) {
    // shotgun pump or sniper bolt: choreograph over `duration`.
    const def = e?.def ?? this._curDef();
    const dur = e?.duration ?? def?.cycle?.t ?? 0.6;
    const phase = e?.phase ?? def?.cycle?.phase;
    if (phase === 'pump') {
      this._cycle = { kind: 'pump', t: 0, dur, def, ejected: false };
    } else if (phase === 'bolt') {
      this._cycle = { kind: 'boltAction', t: 0, dur, def, ejected: false };
    }
    // support hand goes to the pump / bolt handle during the cycle
    this._supportPose = phase === 'pump' ? 'pump' : 'boltHandle';
  }

  _onReloadStart(e) {
    const def = e?.def ?? this._curDef();
    this._inspecting = false;
    this._inspect.target = 0;
    this._reload = {
      def,
      empty: !!e?.empty,
      perShell: !!def?.reload?.perShell,
      phase: null,
      t: 0,
      dur: 0,
      // a mild "reload readiness" dip so the whole gun tips toward the support hand
      settle: 1,
    };
  }

  _onReloadPhase(e) {
    if (!this._reload) return;
    const phase = e?.phase;
    const dur = e?.duration ?? 0.4;
    const index = e?.index;
    this._reload.phase = phase;
    this._reload.t = 0;
    this._reload.dur = dur;
    this._reload.index = index;
    this._reload.phaseStarted = true;
    this._reload.magStage = 0; // sub-progress markers per phase

    // Drive the part + support-hand for this phase.
    switch (phase) {
      case 'magout':
        this._magHidden = false;
        this._supportPose = 'mag';
        break;
      case 'magin':
        // a fresh mag comes up; make sure it's visible and start below the well
        this._magHidden = false;
        this._supportPose = 'mag';
        break;
      case 'rack':
        this._supportPose = this._curDef()?.id === 'pistol' ? 'slide' : 'bolt';
        break;
      case 'bolt':
        this._supportPose = 'bolt';
        break;
      case 'pump':
        this._supportPose = 'pump';
        break;
      case 'shell':
        this._supportPose = 'port';
        break;
      case 'load': {
        // generic single-phase reload. exotic: support hand loads a warhead into
        // the tube via the side breech/pump; sawblade: feeds a fresh blade stack.
        const lid = this._curDef()?.id;
        this._supportPose = lid === 'exotic' ? 'pump' : 'mag';
        break;
      }
      default:
        this._supportPose = 'grip';
    }
  }

  _onReloadEnd(e) {
    // Whether cancelled or complete, spring everything gracefully back.
    this._reload = null;
    this._magHidden = false;
    this._supportPose = 'grip';
    if (this._cylinderSwing) this._cylinderSwing.target = 0; // revolver cylinder snaps shut
    // Re-seat mag part to rest (spring handles the motion).
  }

  // Throw the 6 spent casings out of the revolver cylinder face (during 'eject').
  _ejectRevolver() {
    const vm = this.ctx.viewmodel;
    const shells = this.ctx.fx?.shells;
    if (!vm || !shells?.eject || !this.parts?.shellEject) return;
    const base = vm.getPartWorld?.(this.parts.shellEject, this._v);
    if (!base) return;
    const pos = base.clone();
    for (let i = 0; i < 6; i++) {
      const vel = this._ejectVelocity();
      vel.y += 0.7; vel.multiplyScalar(0.65);   // tumble up-and-out of the cylinder, then drop
      shells.eject(pos.clone(), vel, 'pistol');
    }
  }

  _onAds(e) {
    // The actual ads value is read from weapon.ads each frame; this just makes
    // sure the inspect state clears when we start aiming.
    if (e?.on) { this._inspecting = false; this._inspect.target = 0; }
  }

  _onLand(e) {
    const hard = !!e?.hard;
    const fall = Math.abs(e?.fallSpeed ?? 0);
    const strength = clamp01(fall / 16) * (hard ? 1 : 0.5) + (hard ? 0.15 : 0.04);
    // an immediate downward velocity impulse into the land spring
    this._land.vel += -strength * this.t.landSpring * 0.9;
  }

  // ---- helpers to convert a target-based spring into an impulse -------------
  // For velocity kicks we scale by omega so that "kick strength" reads similarly
  // regardless of the tuned spring frequency.
  omegaScale(omega) { return omega; }

  _curDef() {
    return this.ctx.weapons?.current?.def ?? null;
  }
  _curState() {
    return this.ctx.weapons?.current?.state ?? 'idle';
  }
  _adsTarget() {
    return this.ctx.weapons?.current?.ads ?? 0;
  }

  // Per-frame camera aim delta as a mouse-count-like {dx, dy}. We can't consume
  // input.consumeLook() (CameraFX already did), so we differentiate the camera's
  // yaw/pitch (degrees) and convert back to an approximate count via the known
  // sensitivity mapping deg = 0.022 * sens * count. Falls back gracefully if the
  // camera isn't wired yet. Scaled to per-tick so fast frames don't over-swing.
  _cameraLookDelta(cam, dt) {
    if (!cam || cam.yaw === undefined || cam.pitch === undefined) return { dx: 0, dy: 0 };
    if (this._lastYaw === undefined) { this._lastYaw = cam.yaw; this._lastPitch = cam.pitch; return { dx: 0, dy: 0 }; }
    let dYaw = cam.yaw - this._lastYaw;
    let dPitch = cam.pitch - this._lastPitch;
    this._lastYaw = cam.yaw;
    this._lastPitch = cam.pitch;
    // wrap yaw across ±180 so a seam crossing doesn't spike the sway
    if (dYaw > 180) dYaw -= 360; else if (dYaw < -180) dYaw += 360;
    const sens = Math.max(0.01, this.ctx.settings?.get?.('sens', 2.5) ?? 2.5);
    const perCount = 0.022 * sens; // deg per raw mouse count
    // dx mirrors horizontal mouse movement (yaw), dy vertical (pitch, screen-down +)
    return { dx: dYaw / perCount, dy: -dPitch / perCount };
  }

  // =========================================================================
  // Part actions
  // =========================================================================
  _kickSlide() {
    const s = this._partSprings.slide;
    if (!s) return;
    s.vel.z += this.t.slideTravel * this.t.partSpring; // blow back +Z
  }
  _kickBolt(name) {
    const s = this._partSprings[name];
    if (!s) return;
    s.vel.z += this.t.boltTravel * this.t.partSpring;
  }
  _dropHammer() {
    // hammer falls forward (−x) then springs back; use a rot spring
    let s = this._partRotSprings.hammer;
    if (!s) { s = this._partRotSprings.hammer = new Spring1(this.t.partSpring); }
    s.vel += -this.t.hammerDrop * this.t.partSpring;
  }
  _jitterCharging() {
    const s = this._partSprings.chargingHandle;
    if (!s) return;
    s.vel.z += this.t.chJitter * this.t.partSpring * (0.6 + Math.random() * 0.4);
  }

  // Shell eject NOW (guns that eject on fire). Viewmodel provides the world
  // transform; we compute a camera-relative velocity.
  _ejectNow(def) {
    const vm = this.ctx.viewmodel;
    const shells = this.ctx.fx?.shells;
    if (!vm || !shells?.eject || !this.parts?.shellEject) return;
    const pos = vm.getPartWorld?.(this.parts.shellEject, this._v);
    if (!pos) return;
    // snapshot the port position BEFORE _ejectVelocity() reuses this._v as scratch
    const posOut = pos.clone();
    const vel = this._ejectVelocity();
    shells.eject(posOut, vel, def?.shell?.kind ?? 'pistol');
  }

  // camera-relative shell velocity: mostly right + up + a little back, randomized
  _ejectVelocity() {
    const cam = this.ctx.camera;
    const out = new THREE.Vector3();
    if (!cam) { out.set(1.4, 1.2, 0); return out; }
    const right = this._v.setFromMatrixColumn(cam.matrixWorld, 0).normalize();
    const up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1).normalize();
    const back = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 2).normalize(); // +Z = back
    out.copy(right).multiplyScalar(1.3 + Math.random() * 0.9)
      .addScaledVector(up, 0.9 + Math.random() * 0.7)
      .addScaledVector(back, 0.3 + Math.random() * 0.4);
    // inherit a little player velocity so casings don't hang in the air while moving
    const pv = this.ctx.player?.controller?.velocity;
    if (pv) out.addScaledVector(pv, 0.35);
    return out;
  }

  // =========================================================================
  // fixedUpdate — discrete timers / input-derived state. (120 Hz)
  // =========================================================================
  fixedUpdate(dt) {
    // inspect trigger: the weapon FSM owns the 'inspecting' state; mirror it.
    const st = this._curState();
    const wantInspect = st === 'inspecting';
    if (wantInspect && !this._inspecting) {
      this._inspecting = true;
      this._inspect.target = 1;
      this._inspectPhase = 0;
    } else if (!wantInspect && this._inspecting) {
      this._inspecting = false;
      this._inspect.target = 0;
    }
    if (this._inspecting) this._inspectPhase += dt;
  }

  // =========================================================================
  // render — spring integration + compose the pose. (per frame)
  // =========================================================================
  render(dt, alpha) {
    if (!this.root) return;
    if (dt <= 0) dt = 1 / 120;
    if (dt > 0.05) dt = 0.05; // guard against hitstop/tab spikes

    // keep spring omegas in sync with live tunables
    this._syncOmegas();

    // ---- gather inputs ----
    // NOTE: we do NOT consume input.consumeLook() — CameraFX already consumes it
    // before viewmodel.render() runs. Instead we derive look-lag from the camera's
    // per-frame angular delta (yaw/pitch in degrees), which is exactly the aim
    // motion the gun should trail.
    const cam = this.ctx.player?.camera;
    const look = this._cameraLookDelta(cam, dt);
    const ctrl = this.ctx.player?.controller;
    const move = this.ctx.player?.movement;
    const hs = ctrl?.horizontalSpeed?.() ?? 0;
    const grounded = ctrl ? !!ctrl.grounded : true;
    const mstate = move?.state ?? 'GROUNDED';
    const ads = this._adsTarget();

    // ---- ADS blend ----
    this._ads.target = ads;
    this._ads.step(dt);
    const adsK = clamp01(this._ads.value);
    const swayScale = lerp(1, this.t.adsSwayMult, adsK);

    // ---- 1. base pose (hip -> ADS sight pose) ----
    const meta = this.meta || {};
    const hip = meta.hip || { pos: [0.22, -0.22, -0.42], rot: [0, 0.05, 0.03] };
    // sight pose: bring the sight line to the screen center. We approximate by
    // moving the gun to x≈0 (centered) and pushing it forward to meta.adsZ, and
    // lowering it so the sightY sits on the optical axis.
    const adsZ = meta.adsZ ?? -0.3;
    const sightY = meta.sightY ?? 0.07;
    // "loose ADS" guns (big AoE launchers) barely raise — a full sight-align swings
    // their bulky model into the whole screen. They still get the mild FOV zoom.
    const looseAds = !!this.ctx.weapons?.current?.def?.looseAds;
    const posK = looseAds ? adsK * 0.18 : adsK;
    const px = lerp(hip.pos[0], 0, posK);
    const py = lerp(hip.pos[1], -sightY, posK);
    const pz = lerp(hip.pos[2], adsZ, posK);
    let rx = lerp(hip.rot[0], 0, posK);
    let ry = lerp(hip.rot[1], 0, posK);
    let rz = lerp(hip.rot[2], 0, posK);

    // ---- 6. equip / holster presentation ----
    // Move _present toward target at _presentRate; use smoothstep for a soft arc.
    this._present = clamp01(expApproach(this._present, this._presentTarget, this._presentRate * 2.2, dt));
    const present = smoothstep(this._present);
    const hidden = 1 - present; // 0 presented .. 1 stowed
    const equipDropY = -this.t.equipDrop * hidden;
    const equipSlideZv = this.t.equipSlideZ * hidden;   // pulls toward shooter when stowed
    const equipTiltX = this.t.equipTilt * DEG * hidden;

    // ---- 2. idle sway (look-lag + breathing) ----
    // positional lag opposes the look direction (gun trails the camera)
    this._sway.target.set(
      clamp(-look.dx * this.t.swayPos, -this.t.swayMax, this.t.swayMax),
      clamp(look.dy * this.t.swayPos, -this.t.swayMax, this.t.swayMax),
      0,
    );
    this._swayRot.target.set(
      clamp(look.dy * this.t.swayRot * DEG, -0.08, 0.08),
      clamp(-look.dx * this.t.swayRot * DEG, -0.12, 0.12),
      clamp(look.dx * this.t.swayRot * 0.5 * DEG, -0.08, 0.08),
    );
    this._sway.step(dt);
    this._swayRot.step(dt);
    // breathing
    this._breathPhase += dt * this.t.breathFreq * Math.PI * 2;
    const breathY = Math.sin(this._breathPhase) * this.t.breathAmp;
    const breathR = Math.sin(this._breathPhase * 0.5) * this.t.breathRot * DEG;

    const swayX = this._sway.value.x * swayScale;
    const swayY = (this._sway.value.y + breathY) * swayScale;
    const swayRX = (this._swayRot.value.x + breathR) * swayScale;
    const swayRY = this._swayRot.value.y * swayScale;
    const swayRZ = this._swayRot.value.z * swayScale;

    // ---- 3. movement bob (grounded, speed-scaled figure-8) ----
    const speedN = clamp01(hs / this.t.bobRefSpeed);
    const sprinting = hs > this.t.bobRefSpeed * 0.85;
    let bobTarget = grounded && (mstate === 'GROUNDED' || mstate === 'SLIDING')
      ? speedN * (sprinting ? this.t.sprintMult : 1)
      : 0;
    bobTarget *= swayScale; // ADS steadies the bob
    this._bobAmt.target = bobTarget;
    this._bobAmt.step(dt);
    // advance phase by speed (faster = quicker cadence)
    this._bobPhase += dt * this.t.bobFreq * Math.PI * 2 * (0.6 + speedN * 1.4);
    const bobAmt = this._bobAmt.value;
    // figure-8: x = sin(p), y = sin(2p)
    const bobX = Math.sin(this._bobPhase) * this.t.bobAmp * bobAmt;
    const bobY = Math.abs(Math.sin(this._bobPhase)) * -this.t.bobAmp * 0.8 * bobAmt
      + Math.sin(this._bobPhase * 2) * this.t.bobAmp * 0.3 * bobAmt;
    const bobRZ = Math.sin(this._bobPhase) * this.t.bobRot * DEG * bobAmt;
    const bobRX = Math.sin(this._bobPhase * 2) * this.t.bobRot * 0.4 * DEG * bobAmt;

    // ---- wallrun roll tilt (follow camera lean) ----
    let wallTarget = 0;
    if (mstate === 'WALLRUN') {
      const side = move?.wallSide ?? 0;
      wallTarget = -side * this.t.wallrunRoll * DEG;
    }
    this._wallRoll.target = wallTarget;
    this._wallRoll.step(dt);

    // ---- land settle ----
    this._land.target = 0;
    this._land.step(dt);
    const landV = clamp(this._land.value, -1.5, 1.5);
    const landY = landV * this.t.landDip;
    const landRX = -landV * this.t.landRot * DEG;

    // ---- 4. fire recoil springs ----
    this._recoilPos.target.set(0, 0, 0);
    this._recoilRot.target.set(0, 0, 0);
    this._recoilPos.step(dt);
    this._recoilRot.step(dt);

    // ---- 7. inspect ----
    this._inspect.target = this._inspecting ? 1 : 0;
    this._inspect.step(dt);
    const insp = smoothstep(this._inspect.value);
    let inspRX = 0, inspRY = 0, inspRZ = 0, inspZ = 0, inspY = 0;
    if (insp > 0.001) {
      const p = this._inspectPhase;
      inspRY = Math.sin(p * 1.1) * this.t.inspectYaw * DEG * insp;
      inspRX = (-0.4 + Math.sin(p * 0.8) * 0.6) * this.t.inspectPitch * DEG * insp;
      inspRZ = Math.sin(p * 0.7 + 1) * this.t.inspectRoll * DEG * insp;
      inspZ = -0.02 * insp;         // pull toward the face a touch
      inspY = this.t.inspectRaise * insp;
    }

    // ---- reload pose settle (whole-gun tip toward the support hand) ----
    let reloadY = 0, reloadRX = 0, reloadRZ = 0, reloadZ = 0;
    if (this._reload) {
      const r = this._reload;
      r.t += dt;
      const settle = clamp01(r.settle);
      // dip + tilt gun down/in during reload (less when ADS-ish, but reload forces ads off in logic)
      reloadY = -0.03 * settle;
      reloadRX = 8 * DEG * settle;   // muzzle dips
      reloadRZ = -6 * DEG * settle;  // roll toward support hand
      reloadZ = 0.01 * settle;
    }

    // ---- MELEE swing pose (§1C) — additive root offsets, framerate-independent.
    // Timeline phases: windup (pull back+up), swing (fast arc down-and-across),
    // recover (ease home). Applied to the whole viewmodel root like the recoil
    // layer. bat = bigger/slower arc; heavy = deeper. ---
    let swingX = 0, swingY = 0, swingZ = 0, swingRX = 0, swingRY = 0, swingRZ = 0;
    if (this._meleeSwing) {
      const m = this._meleeSwing;
      m.t += dt;
      const u = clamp01(m.dur > 0 ? m.t / m.dur : 1);
      const bat = m.melee === 'bat';
      const scale = (bat ? 1.5 : 1) * (m.heavy ? 1.35 : 1);
      const arc = (bat ? 62 : 46) * DEG * scale;   // peak swing rotation
      // envelope: 0 → windup peak (~18%) → through the swing (~55%) → home
      let wind = 0, swing = 0;
      if (u < 0.18) {
        wind = smoothstep(u / 0.18);
      } else if (u < 0.55) {
        wind = 1 - smoothstep((u - 0.18) / 0.37);
        swing = smoothstep((u - 0.18) / 0.37);
      } else {
        swing = 1 - smoothstep((u - 0.55) / 0.45);   // recover
      }
      // windup: gun rocks back (+Z), up (+Y), cocks up (−pitch), rolls out
      swingZ += 0.05 * scale * wind;
      swingY += 0.05 * scale * wind;
      swingRX += -0.5 * arc * wind;
      swingRZ += (bat ? 0.6 : 0.45) * arc * wind;
      // swing: whole gun arcs DOWN-and-ACROSS — big pitch-down + roll-across + a
      // forward lunge (−Z) that reads as reaching into the target.
      swingRX += 1.0 * arc * swing;                  // pitch down through the target
      swingRZ += -(bat ? 1.0 : 0.85) * arc * swing;  // roll across (opposite the windup)
      swingRY += (bat ? -0.35 : -0.5) * arc * swing; // yaw across the body
      swingZ += -(m.heavy ? 0.1 : 0.06) * scale * swing; // lunge forward
      swingY += -0.03 * scale * swing;
      if (u >= 1) this._meleeSwing = null;
    }

    // ---- part animations (springs + cycles) ----
    this._updateParts(dt);

    // ---- compose final transform ----
    const P = this.root.position;
    const R = this.root.rotation;
    P.set(
      px + swayX + bobX + this._recoilPos.value.x + swingX,
      py + swayY + bobY + landY + this._recoilPos.value.y + equipDropY + inspY + reloadY + swingY,
      pz + this._recoilPos.value.z + equipSlideZv + inspZ + reloadZ + swingZ,
    );
    R.set(
      rx + swayRX + bobRX + landRX + this._recoilRot.value.x + equipTiltX + inspRX + reloadRX + swingRX,
      ry + swayRY + this._recoilRot.value.y + inspRY + swingRY,
      rz + swayRZ + bobRZ + this._wallRoll.value + this._recoilRot.value.z + inspRZ + reloadRZ + swingRZ,
      'XYZ',
    );
  }

  // Keep the live tunables reflected in spring omegas (cheap, per frame).
  _syncOmegas() {
    this._sway.omega = this.t.swaySpring;
    this._swayRot.omega = this.t.swaySpring;
    this._bobAmt.omega = this.t.bobSpring;
    this._wallRoll.omega = this.t.wallrunSpring;
    this._land.omega = this.t.landSpring;
    this._recoilPos.omega = this.t.fireSpring;
    this._recoilRot.omega = this.t.fireSpring;
    this._ads.omega = this.t.adsSpring;
    for (const k in this._partSprings) this._partSprings[k].omega = this.t.partSpring;
    for (const k in this._partRotSprings) this._partRotSprings[k].omega = this.t.partSpring;
  }

  // =========================================================================
  // Part animation update (translation/rotation springs + cycle timelines)
  // =========================================================================
  _updateParts(dt) {
    if (!this.parts) return;

    // --- pump / bolt-action cycle timeline (choreographed over duration) ---
    if (this._cycle) {
      const c = this._cycle;
      c.t += dt;
      const u = clamp01(c.t / c.dur);
      if (c.kind === 'pump') {
        // pump: back over first 45%, forward over the rest. Triangle-ish.
        const back = u < 0.45 ? (u / 0.45) : (1 - (u - 0.45) / 0.55);
        const s = this._partSprings.pump;
        if (s) s.target.z = this.t.pumpTravel * back; // +Z toward shooter = racked back
        // shotgun ejects the spent shell as the pump reaches its rearmost point
        if (!c.ejected && u >= 0.42) { c.ejected = true; this._ejectNow(c.def); }
        // support hand rides the pump
        this._supportPose = 'pump';
      } else if (c.kind === 'boltAction') {
        // sniper: handle up (0-15%), pull back (15-45%), push fwd (45-80%),
        // handle down (80-100%). Bolt translates ±Z; handle rotates around Z.
        const s = this._partSprings.bolt;
        const bh = this.parts.boltHandle;
        let liftT = 0, backT = 0;
        if (u < 0.15) { liftT = u / 0.15; backT = 0; }
        else if (u < 0.45) { liftT = 1; backT = (u - 0.15) / 0.30; }
        else if (u < 0.80) { liftT = 1; backT = 1 - (u - 0.45) / 0.35; }
        else { liftT = 1 - (u - 0.80) / 0.20; backT = 0; }
        if (s) s.target.z = this.t.boltTravel * 1.4 * backT;
        if (bh) bh.rotation.z = this._boltHandleRest + liftT * 1.15; // rotate handle up
        // sniper ejects the spent case as the bolt reaches full rearward
        if (!c.ejected && backT >= 0.95) { c.ejected = true; this._ejectNow(c.def); }
        this._supportPose = 'boltHandle';
      }
      if (c.t >= c.dur) {
        // settle targets back to rest
        if (this._partSprings.pump) this._partSprings.pump.target.z = 0;
        if (this._partSprings.bolt) this._partSprings.bolt.target.z = 0;
        if (this.parts.boltHandle) this.parts.boltHandle.rotation.z = this._boltHandleRest;
        this._cycle = null;
        this._supportPose = 'grip';
      }
    }

    // --- reload part choreography (mag drop/seat, rack/bolt part strokes) ---
    if (this._reload) this._updateReloadParts(dt);

    // --- sawblade: the loaded disc spins continuously while equipped, with a
    // brief speed-up burst on fire that decays back to the idle spin. ---
    if (this.parts.blade) {
      // decay the fire spin boost (framerate-independent exp decay)
      this._bladeSpinBoost = expApproach(this._bladeSpinBoost, 0, 6, dt);
      const spin = this.t.bladeSpin + this._bladeSpinBoost;
      this._bladeAngle += spin * dt;
      this.parts.blade.rotation.z = this._bladeAngle;
    }

    // --- boltHandle safety settle: if neither a cycle nor a sniper reload-bolt
    // phase is driving it this frame, ease its rotation home (graceful cancel). ---
    if (this.parts?.boltHandle) {
      const drivingBolt =
        (this._cycle && this._cycle.kind === 'boltAction') ||
        (this._reload && this._reload.phase === 'bolt' && this._curDef()?.id === 'sniper');
      if (!drivingBolt) {
        const bh = this.parts.boltHandle;
        bh.rotation.z = expApproach(bh.rotation.z, this._boltHandleRest, 20, dt);
      }
    }

    // --- revolver cylinder swing-out (rotation.y around the crane pivot) ---
    if (this.parts?.cylinder && this._cylinderSwing) {
      if (!this._reload) this._cylinderSwing.target = 0; // ensure it's shut when not reloading
      this._cylinderSwing.omega = this.t.partSpring * 0.5;
      this._cylinderSwing.step(dt);
      this.parts.cylinder.rotation.y = this._cylinderRest + this._cylinderSwing.value * -1.15;
    }

    // --- integrate translation springs and apply as OFFSET from rest ---
    for (const name in this._partSprings) {
      const s = this._partSprings[name];
      s.step(dt);
      const part = this.parts[name];
      if (!part || !s.rest) continue;
      part.position.set(
        s.rest.x + s.value.x,
        s.rest.y + s.value.y,
        s.rest.z + s.value.z,
      );
    }
    // --- rotation springs (single-axis; hammer around X) ---
    for (const name in this._partRotSprings) {
      const s = this._partRotSprings[name];
      s.step(dt);
      const part = this.parts[name];
      if (!part) continue;
      if (name === 'hammer') {
        const rest = this._hammerRest ?? part.rotation.x;
        part.rotation.x = rest + s.value;
      }
    }

    // --- mag visibility (hidden after mag fully out during magout end) ---
    if (this.parts.mag) this.parts.mag.visible = !this._magHidden;
  }

  // Reload strokes: translate the mag out/in, stroke the rack/bolt/pump part.
  _updateReloadParts(dt) {
    const r = this._reload;
    const phase = r.phase;
    const u = clamp01(r.dur > 0 ? r.t / r.dur : 1);
    const magS = this._partSprings.mag;
    const id = this._curDef()?.id;

    if (phase === 'magout') {
      // mag drops down & slightly out; hidden once it's clear
      if (magS) magS.target.set(0.005, -0.09 * smoothstep(u), 0.02 * smoothstep(u));
      this._magHidden = false;
      if (u > 0.9) this._magHidden = true; // gone by the end of magout
    } else if (phase === 'magin') {
      // new mag rises up into the well: starts low, seats at rest
      this._magHidden = false;
      const rise = 1 - smoothstep(u);
      if (magS) magS.target.set(0, -0.1 * rise, 0.01 * rise);
    } else if (phase === 'rack') {
      // pistol slide / rifle bolt stroke: back then forward
      const stroke = u < 0.5 ? (u / 0.5) : (1 - (u - 0.5) / 0.5);
      if (id === 'pistol' && this._partSprings.slide) {
        this._partSprings.slide.target.z = this.t.slideTravel * stroke;
        if (u > 0.55 && !r._racked) { r._racked = true; this._dropHammer(); }
      } else if (this._partSprings.bolt) {
        this._partSprings.bolt.target.z = this.t.boltTravel * stroke;
      }
      if (magS) magS.target.set(0, 0, 0);
    } else if (phase === 'bolt') {
      // AR empty bolt-release / sniper reload bolt: a firm forward stroke
      const stroke = u < 0.4 ? (u / 0.4) : (1 - (u - 0.4) / 0.6);
      const bs = this._partSprings.bolt;
      if (bs) bs.target.z = this.t.boltTravel * 1.2 * stroke;
      const bh = this.parts.boltHandle;
      if (bh && id === 'sniper') {
        // reload bolt for the sniper: same up/back/forward/down as a cycle
        let liftT = 0, backT = 0;
        if (u < 0.2) { liftT = u / 0.2; }
        else if (u < 0.5) { liftT = 1; backT = (u - 0.2) / 0.3; }
        else if (u < 0.8) { liftT = 1; backT = 1 - (u - 0.5) / 0.3; }
        else { liftT = 1 - (u - 0.8) / 0.2; }
        bh.rotation.z = this._boltHandleRest + liftT * 1.15;
        if (bs) bs.target.z = this.t.boltTravel * 1.4 * backT;
      }
      if (magS) magS.target.set(0, 0, 0);
    } else if (phase === 'pump') {
      // shotgun finishing pump (chamber was empty)
      const back = u < 0.5 ? (u / 0.5) : (1 - (u - 0.5) / 0.5);
      if (this._partSprings.pump) this._partSprings.pump.target.z = this.t.pumpTravel * back;
    } else if (phase === 'shell') {
      // per-shell load: support hand brings a shell to the port; a small pump
      // rock as the shell seats. Mag stays at rest (tube gun).
      if (magS) magS.target.set(0, 0, 0);
    } else if (phase === 'swing') {
      // REVOLVER: the cylinder swings OUT to the left over this phase.
      if (this._cylinderSwing) this._cylinderSwing.target = 1;
      this._cylEjected = false;
      if (magS) magS.target.set(0, 0, 0);
    } else if (phase === 'eject') {
      // cylinder held out; the ejector rod strokes back and the 6 spent cases fly.
      if (this._cylinderSwing) this._cylinderSwing.target = 1;
      const es = this._partSprings.ejector;
      const push = u < 0.5 ? (u / 0.5) : (1 - (u - 0.5) / 0.5);
      if (es) es.target.z = 0.032 * push;
      if (!this._cylEjected && u >= 0.45) { this._cylEjected = true; this._ejectRevolver(); }
      if (magS) magS.target.set(0, 0, 0);
    } else if (phase === 'close') {
      // swing the cylinder back shut (deliberate snap home).
      if (this._cylinderSwing) this._cylinderSwing.target = 1 - smoothstep(u);
      if (magS) magS.target.set(0, 0, 0);
    } else if (phase === 'load') {
      // generic single-phase reload for exotic / sawblade / revolver.
      if (id === 'revolver') {
        // cylinder stays swung out while rounds drop in (support hand w/ speedloader)
        if (this._cylinderSwing) this._cylinderSwing.target = 1;
      } else if (id === 'exotic') {
        // support hand strokes the pump/loader back then forward to seat a
        // fresh warhead; the warhead reappears (loaded) at the seat moment.
        const stroke = u < 0.5 ? (u / 0.5) : (1 - (u - 0.5) / 0.5);
        const ps = this._partSprings.pump;
        if (ps) ps.target.z = this.t.exoticLoadZ * stroke;         // +Z = racked toward shooter
        const ls = this._partSprings.loader;
        if (ls) ls.target.x = this.t.exoticLoadZ * 0.6 * stroke;   // breech hatch swings out then back
        // seat the new warhead roughly when the loader is fully back (mid-stroke)
        if (u >= 0.45 && this._warheadHidden) {
          this._warheadHidden = false;
          if (this.parts?.warhead) this.parts.warhead.visible = true;
        }
      } else {
        // sawblade: feeder pushes a fresh blade forward into the rail; a small
        // mag settle. Blade keeps spinning throughout (handled in _updateParts).
        const stroke = u < 0.5 ? (u / 0.5) : (1 - (u - 0.5) / 0.5);
        const fs = this._partSprings.feeder;
        if (fs) fs.target.z = -this.t.feederStroke * stroke;       // −Z toward the rail/muzzle
      }
      if (magS) magS.target.set(0, 0, 0);
    } else {
      if (magS) magS.target.set(0, 0, 0);
    }

    // When NOT in a mag phase, the mag should spring home.
    if (magS && phase !== 'magout' && phase !== 'magin') magS.target.set(0, 0, 0);
    // When NOT in a load phase, the loader/feeder/pump strokes spring home.
    if (phase !== 'load') {
      if (this._partSprings.loader) this._partSprings.loader.target.x = 0;
      if (this._partSprings.feeder) this._partSprings.feeder.target.z = 0;
      if (id !== 'shotgun' && this._partSprings.pump && !this._cycle) this._partSprings.pump.target.z = 0;
    }
  }

  // =========================================================================
  // Support-hand target (LOCAL space, in the gun root's frame) — the Viewmodel
  // reads this each frame to place the left hand.
  // Returns { pos: V3(local), grip: 0..1 } where the pose enum maps to a part.
  // =========================================================================
  getSupportTarget(out) {
    const o = out || this._supportTarget;
    const parts = this.parts;
    const meta = this.meta || {};
    const def = this._curDef();
    // default: foregrip pose from meta.gripL
    const gl = meta.gripL || { pos: [0, -0.06, -0.2], rot: [0.15, 0, 0] };
    o.set(gl.pos[0], gl.pos[1], gl.pos[2]);

    const pose = this._supportPose;
    if (pose === 'grip' || !parts) return { pos: o, pose, rot: gl.rot };

    // Read the current world-local position of the relevant part (as offset from
    // gun root). We approximate by using the part's LOCAL position within root
    // (parts are direct children of root, so their .position is root-local).
    const partFor = {
      mag: 'mag', slide: 'slide', bolt: 'bolt', pump: 'pump',
      boltHandle: 'boltHandle', ch: 'chargingHandle', port: 'shellPort',
    }[pose];
    const p = partFor && parts[partFor];
    if (p) {
      // Position of the part's origin expressed in the gun root's local frame
      // (handles nesting like boltHandle -> bolt -> root). Uses live matrices.
      this._localPartPos(p, o);
      // hand offset so it grips slightly below/beside the part
      if (pose === 'mag') o.y -= 0.02;
      if (pose === 'port') { o.y -= 0.005; }
    }
    return { pos: o, pose, rot: gl.rot };
  }

  // Position of `part`'s origin in the gun ROOT's local frame. Both the part and
  // the root live under the same viewmodel graph, so: root^-1 * partWorld maps a
  // part-space origin into root-local space regardless of nesting depth.
  _localPartPos(part, out) {
    part.updateWorldMatrix(true, false);
    this.root.updateWorldMatrix(true, false);
    out.setFromMatrixPosition(part.matrixWorld);
    this._invRoot = this._invRoot || new THREE.Matrix4();
    this._invRoot.copy(this.root.matrixWorld).invert();
    out.applyMatrix4(this._invRoot);
    return out;
  }
}
