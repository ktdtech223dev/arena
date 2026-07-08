// player/Camera.js — CameraFX (contract §5.B).
//
// Owns the look angles (yaw/pitch in degrees, yaw 0 = facing −Z) and everything
// that shapes the world-camera each frame: mouse-look, ADS-scaled sensitivity,
// FOV (base + speed kick + fov punches + ADS zoom), view bob, landing dip,
// wall-run roll, recoil kick, and decaying shake.
//
// Angle model: yaw around +Y, pitch around local X, roll (wallrun) around local Z.
// Rotation order is YXZ so pitch stays head-relative and roll leans the view.
//
// EVERYTHING that governs feel is registered in ctx.tunables (cat 'camera').
import * as THREE from 'three';

const DEG2RAD = Math.PI / 180;

// Frame-rate-independent exponential smoothing: move `cur` toward `target`,
// reaching (1 - e^-rate*dt) of the remaining gap. rate ~ "responsiveness".
function expApproach(cur, target, rate, dt) {
  return cur + (target - cur) * (1 - Math.exp(-rate * dt));
}

export class CameraFX {
  constructor(ctx) {
    this.ctx = ctx;
    this.controller = ctx.player?.controller || null; // resolved lazily too

    // ---- look angles (degrees) ---------------------------------------------
    this.yaw = 0;    // around +Y; 0 faces −Z
    this.pitch = 0;  // around local X; + looks up... clamped ±89

    // spawn orientation is read lazily on first render (range exists, but keep
    // this defensive to match the controller's lazy spawn read)
    this._spawned = false;

    // ---- tuning (all in ctx.tunables) --------------------------------------
    this.t = {
      pitchClamp: 89,        // max |pitch| degrees
      sensBase: 0.022,       // CS-style deg per mouse count (× settings.sens)
      crouchEyeRate: 12,     // exp rate for smooth eye-height transitions
      // FOV
      speedFovMax: 10,       // extra FOV added at top reference speed
      speedFovRefSpeed: 14,  // horizontal speed (m/s) that reaches speedFovMax
      speedFovRate: 6,       // how fast speed-FOV eases in/out
      fovKickDecay: 9,       // decay rate for addFovKick punches
      fovKickScale: 22,      // degrees of FOV per unit of fovKick frac
      adsFovRate: 16,        // how fast ADS zoom eases in/out
      // view bob
      bobAmpPos: 0.055,      // vertical bob amplitude at reference speed (m)
      bobAmpLat: 0.045,      // lateral bob amplitude at reference speed (m)
      bobFreq: 1.05,         // bob cycles scale (× step cadence)
      bobRefSpeed: 9,        // speed at which bob reaches full amplitude
      bobRollDeg: 0.55,      // subtle roll from lateral bob (deg)
      // landing dip
      landDipMax: 0.16,      // max downward eye dip on landing (m)
      landDipStiff: 170,     // spring stiffness
      landDipDamp: 22,       // spring damping
      // wallrun roll
      rollRate: 10,          // exp rate toward setRoll target
      // shake
      shakeDecay: 6,         // shake envelope decay rate
      shakePosAmp: 0.05,     // world-space positional shake amplitude (m)
      shakeRotAmp: 1.6,      // rotational shake amplitude (deg)
      shakeFreq: 34,         // shake noise frequency (Hz)
    };

    // ---- runtime state ------------------------------------------------------
    this._eyeCur = 1.62;     // smoothed eye height above feet (standHeight-0.18)
    this._fovCur = this.ctx.settings.get('fov', 100);
    this._speedFov = 0;      // eased speed-FOV contribution
    this._fovKick = 0;       // decaying additive FOV punch (frac)

    this._rollTarget = 0;    // wallrun roll target (deg)
    this._rollCur = 0;       // smoothed roll (deg)

    this._dip = 0;           // landing dip offset (m, negative = down)
    this._dipVel = 0;

    this._shake = 0;         // shake envelope 0..1
    this._shakeSeed = Math.random() * 1000;

    this._bobPhase = 0;      // accumulated bob phase
    this._bobY = 0;
    this._bobX = 0;
    this._bobRoll = 0;

    // ADS
    this._ads = false;
    this._adsFovScale = 1;   // target fov scale while ADS (<1 zooms)
    this._adsBlend = 0;      // 0..1 eased ADS amount

    // scratch
    this._fwd = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._euler = new THREE.Euler(0, 0, 0, 'YXZ');
    this._pos = new THREE.Vector3();

    this._registerTunables();
  }

  _ctrl() {
    if (!this.controller) this.controller = this.ctx.player?.controller || null;
    return this.controller;
  }

  // ---- public API (contract §5.B) ------------------------------------------

  /** Normalized forward direction on the XZ plane (yaw only). */
  forwardXZ(out) {
    out = out || new THREE.Vector3();
    const r = this.yaw * DEG2RAD;
    // yaw 0 faces −Z; +yaw rotates toward... use standard: fwd = (-sin, 0, -cos)
    out.set(-Math.sin(r), 0, -Math.cos(r));
    return out.normalize();
  }

  /** Normalized right direction on the XZ plane (yaw only). */
  rightXZ(out) {
    out = out || new THREE.Vector3();
    const r = this.yaw * DEG2RAD;
    out.set(Math.cos(r), 0, -Math.sin(r));
    return out.normalize();
  }

  /** Recoil / knock: moves the REAL aim. +dPitch looks up. */
  kick(dPitchDeg, dYawDeg) {
    this.pitch += dPitchDeg || 0;
    this.yaw += dYawDeg || 0;
    this._clampPitch();
  }

  /** Momentary decaying camera shake (strength 0..1). Takes the stronger of
   *  current/incoming so rapid overlapping hits don't cancel each other. */
  addShake(strength01) {
    const s = Math.max(0, Math.min(1, strength01 || 0));
    this._shake = Math.max(this._shake, s);
  }

  /** Additive shake bump — stacks ON TOP of any active shake (clamped). Use for
   *  punctuation that must register even mid-recoil-shake, e.g. a kill. */
  addShakeImpulse(strength01) {
    const s = Math.max(0, Math.min(1, strength01 || 0));
    this._shake = Math.min(1, this._shake + s);
  }

  /** Momentary FOV punch (frac, e.g. 0.08 = +~1.8°). Decays out. */
  addFovKick(frac) {
    this._fovKick += frac || 0;
  }

  /** Wall-run lean target (degrees). Spring-followed. setRoll(0) to exit. */
  setRoll(targetDeg) {
    this._rollTarget = targetDeg || 0;
  }

  /** Landing dip impulse (strength 0..1). */
  landDip(strength01) {
    const s = Math.max(0, Math.min(1, strength01 || 0));
    // inject velocity into the dip spring (downward)
    this._dipVel -= s * this.t.landDipMax * this.t.landDipStiff * 0.12;
  }

  /** Smooth ADS zoom. fovScale < 1 zooms in. */
  setAds(on, fovScale = 1) {
    this._ads = !!on;
    if (on) this._adsFovScale = fovScale || 1;
  }

  isAds() {
    return this._ads;
  }

  // ---- per-frame ------------------------------------------------------------

  render(dt, alpha) {
    const ctrl = this._ctrl();
    const cam = this.ctx.camera;
    if (!ctrl || !cam) return;

    if (!this._spawned) {
      const range = this.ctx.world?.range;
      if (range) {
        this.yaw = range.spawnYaw || 0;
        this.pitch = 0;
        this._spawned = true;
      }
    }

    // ---- mouse look --------------------------------------------------------
    const look = this.ctx.input.consumeLook();
    const sensSetting = this.ctx.settings.get('sens', 2.5);
    let degPerCount = this.t.sensBase * sensSetting;
    if (this._adsBlend > 0.001) {
      const adsMult = this.ctx.settings.get('adsSensMult', 0.8);
      degPerCount *= (1 - this._adsBlend) + this._adsBlend * adsMult;
    }
    this.yaw -= look.dx * degPerCount;      // right drag → look right (yaw down)
    this.pitch -= look.dy * degPerCount;    // down drag → look down
    this._clampPitch();
    // keep yaw in a sane range to avoid float drift over long sessions
    if (this.yaw > 360 || this.yaw < -360) this.yaw %= 360;

    // ---- ADS blend ---------------------------------------------------------
    const adsTarget = this._ads ? 1 : 0;
    this._adsBlend = expApproach(this._adsBlend, adsTarget, this.t.adsFovRate, dt);

    // ---- smoothed eye height (crouch) --------------------------------------
    const targetEye = ctrl.height - 0.18;
    this._eyeCur = expApproach(this._eyeCur, targetEye, this.t.crouchEyeRate, dt);

    // ---- FOV ---------------------------------------------------------------
    const speed = ctrl.horizontalSpeed();
    const speedFrac = Math.min(1, speed / this.t.speedFovRefSpeed);
    const speedFovTarget = speedFrac * this.t.speedFovMax;
    this._speedFov = expApproach(this._speedFov, speedFovTarget, this.t.speedFovRate, dt);
    this._fovKick = expApproach(this._fovKick, 0, this.t.fovKickDecay, dt);

    const baseFov = this.ctx.settings.get('fov', 100);
    let fov = baseFov + this._speedFov + this._fovKick * this.t.fovKickScale;
    if (this._adsBlend > 0.001) {
      const zoomed = baseFov * this._adsFovScale;
      fov = fov * (1 - this._adsBlend) + zoomed * this._adsBlend;
    }
    this._fovCur = fov;
    if (Math.abs(cam.fov - fov) > 1e-3) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }

    // ---- landing dip spring ------------------------------------------------
    // critically-ish damped spring toward 0
    const dipAcc = -this.t.landDipStiff * this._dip - this.t.landDipDamp * this._dipVel;
    this._dipVel += dipAcc * dt;
    this._dip += this._dipVel * dt;

    // ---- wallrun roll ------------------------------------------------------
    this._rollCur = expApproach(this._rollCur, this._rollTarget, this.t.rollRate, dt);

    // ---- view bob ----------------------------------------------------------
    this._updateBob(ctrl, speed, dt);

    // ---- shake -------------------------------------------------------------
    let shakePX = 0, shakePY = 0, shakePZ = 0, shakeRoll = 0, shakePitch = 0, shakeYaw = 0;
    if (this._shake > 0.0005) {
      const env = this._shake * this._shake; // ease-out feel
      const tt = this.ctx.loop.time * this.t.shakeFreq;
      const s = this._shakeSeed;
      shakePX = this._noise(tt + s) * this.t.shakePosAmp * env;
      shakePY = this._noise(tt + s + 11.3) * this.t.shakePosAmp * env;
      shakePZ = this._noise(tt + s + 27.9) * this.t.shakePosAmp * 0.5 * env;
      shakeRoll = this._noise(tt + s + 41.1) * this.t.shakeRotAmp * env;
      shakePitch = this._noise(tt + s + 53.7) * this.t.shakeRotAmp * 0.6 * env;
      shakeYaw = this._noise(tt + s + 67.2) * this.t.shakeRotAmp * 0.6 * env;
      this._shake = expApproach(this._shake, 0, this.t.shakeDecay, dt);
    } else {
      this._shake = 0;
    }

    // ---- compose camera transform -----------------------------------------
    // interpolated feet position
    const p = this._pos.copy(ctrl.prevPosition).lerp(ctrl.position, alpha);
    p.y += this._eyeCur + this._dip + this._bobY + shakePY;

    // apply lateral bob & shake along the current right vector
    this.rightXZ(this._right);
    p.x += this._right.x * (this._bobX + shakePX);
    p.z += this._right.z * (this._bobX + shakePX);
    this.forwardXZ(this._fwd);
    p.x += this._fwd.x * shakePZ;
    p.z += this._fwd.z * shakePZ;

    cam.position.copy(p);

    const roll = this._rollCur + this._bobRoll + shakeRoll;
    this._euler.set(
      (this.pitch + shakePitch) * DEG2RAD,
      (this.yaw + shakeYaw) * DEG2RAD,
      roll * DEG2RAD,
      'YXZ',
    );
    cam.quaternion.setFromEuler(this._euler);
  }

  // ---- internals ------------------------------------------------------------

  _updateBob(ctrl, speed, dt) {
    const enabled = this.ctx.settings.get('viewBob', true);
    const grounded = ctrl.grounded;
    const moving = speed > 0.6;
    let targetY = 0, targetX = 0, targetRoll = 0;

    if (enabled && grounded && moving) {
      const amp = Math.min(1, speed / this.t.bobRefSpeed);
      // step cadence: faster at higher speed. phase advances by speed-scaled freq.
      const cadence = this.t.bobFreq * (2.2 + speed * 0.35);
      this._bobPhase += cadence * dt;
      // vertical bobs at 2× the step frequency (down on each foot plant)
      targetY = -Math.abs(Math.sin(this._bobPhase)) * this.t.bobAmpPos * amp;
      targetX = Math.sin(this._bobPhase) * this.t.bobAmpLat * amp;
      targetRoll = Math.sin(this._bobPhase) * this.t.bobRollDeg * amp;
    }

    // smooth toward targets so bob fades in/out rather than snapping
    const rate = 10;
    this._bobY = expApproach(this._bobY, targetY, rate, dt);
    this._bobX = expApproach(this._bobX, targetX, rate, dt);
    this._bobRoll = expApproach(this._bobRoll, targetRoll, rate, dt);
  }

  // signed pseudo-noise in [-1,1] from a smooth sum of sines (perlin-ish)
  _noise(x) {
    return (
      Math.sin(x * 1.0) * 0.5 +
      Math.sin(x * 2.17 + 1.3) * 0.3 +
      Math.sin(x * 4.03 + 2.9) * 0.2
    );
  }

  _clampPitch() {
    const c = this.t.pitchClamp;
    if (this.pitch > c) this.pitch = c;
    else if (this.pitch < -c) this.pitch = -c;
  }

  _registerTunables() {
    const t = this.t;
    const T = this.ctx.tunables;
    const add = (key, prop, min, max, step, label) =>
      T.push({ cat: 'camera', key, obj: t, prop, min, max, step, label });

    add('pitchClamp', 'pitchClamp', 60, 89.5, 0.5, 'Pitch clamp (°)');
    add('sensBase', 'sensBase', 0.005, 0.05, 0.001, 'Sens base (°/count)');
    add('crouchEyeRate', 'crouchEyeRate', 2, 30, 0.5, 'Crouch eye rate');
    add('speedFovMax', 'speedFovMax', 0, 25, 0.5, 'Speed FOV max (°)');
    add('speedFovRefSpeed', 'speedFovRefSpeed', 6, 24, 0.5, 'Speed FOV ref (m/s)');
    add('speedFovRate', 'speedFovRate', 1, 20, 0.5, 'Speed FOV ease');
    add('fovKickDecay', 'fovKickDecay', 2, 25, 0.5, 'FOV kick decay');
    add('fovKickScale', 'fovKickScale', 5, 60, 1, 'FOV kick scale');
    add('adsFovRate', 'adsFovRate', 4, 40, 1, 'ADS zoom ease');
    add('bobAmpPos', 'bobAmpPos', 0, 0.2, 0.005, 'Bob amp vert (m)');
    add('bobAmpLat', 'bobAmpLat', 0, 0.2, 0.005, 'Bob amp lat (m)');
    add('bobFreq', 'bobFreq', 0.3, 3, 0.05, 'Bob frequency');
    add('bobRefSpeed', 'bobRefSpeed', 4, 16, 0.5, 'Bob ref speed (m/s)');
    add('bobRollDeg', 'bobRollDeg', 0, 3, 0.05, 'Bob roll (°)');
    add('landDipMax', 'landDipMax', 0, 0.4, 0.01, 'Land dip max (m)');
    add('landDipStiff', 'landDipStiff', 50, 400, 5, 'Land dip stiffness');
    add('landDipDamp', 'landDipDamp', 5, 60, 1, 'Land dip damping');
    add('rollRate', 'rollRate', 2, 30, 0.5, 'Wallrun roll ease');
    add('shakeDecay', 'shakeDecay', 2, 20, 0.5, 'Shake decay');
    add('shakePosAmp', 'shakePosAmp', 0, 0.2, 0.005, 'Shake pos amp (m)');
    add('shakeRotAmp', 'shakeRotAmp', 0, 6, 0.1, 'Shake rot amp (°)');
    add('shakeFreq', 'shakeFreq', 10, 60, 1, 'Shake frequency (Hz)');
  }
}
