// RANGE — recoil driver (agent D).
// Per-shot camera kicks via ctx.player.camera.kick() — pattern-based for the
// AR, randomized-inside-an-envelope for the rest. Tracks the accumulated
// UNCOMPENSATED recoil and smoothly recovers it after firing stops
// (~0.3 s, per-gun rate), subtracting whatever the player counter-pulled.
//
// Counter-pull detection (simple + robust): each update we compare the
// camera's actual pitch/yaw delta against the sum of kicks WE issued since
// the last sample — the difference is player input. Player motion that
// opposes the accumulated recoil reduces it (so we never "recover" aim the
// player already pulled back down themselves). update() runs from
// WeaponManager.render(), right after CameraFX has applied the frame's look.

/** Normalize an angle delta to [-180, 180] so yaw wrap-around at ±180° never
 *  reads as a giant fake counter-pull. */
function wrap180(d) {
  return ((d + 180) % 360 + 360) % 360 - 180;
}

export class Recoil {
  constructor(ctx) {
    this.ctx = ctx;

    // uncompensated recoil still owed back to the player (degrees)
    this.accumPitch = 0;
    this.accumYaw = 0;

    this.patternIndex = 0;
    this._lastShotTime = -1e9;
    this._recoverRate = 12; // per-gun, latched on fire (1/s exponential)

    // camera sampling for counter-pull detection
    this._prevPitch = null;
    this._prevYaw = null;
    this._appliedPitch = 0; // kicks we issued since last sample (incl. recovery)
    this._appliedYaw = 0;

    this.params = {
      recoverDelay: 0.09,     // s after last shot before recovery starts
      counterPull: 1.0,       // 0..1 — how fully player pull cancels recovery
      linearFloor: 2.0,       // deg/s minimum recovery speed (kills the exp tail)
      patternResetTime: 0.35, // s of not firing before the AR pattern resets
      crosshairScale: 0.08,   // accumulated recoil → crosshair bloom degrees
    };

    const t = (key, prop, min, max, step) =>
      ctx.tunables.push({ cat: 'weapons', key, obj: this.params, prop, min, max, step });
    t('recoil.recoverDelay', 'recoverDelay', 0, 0.5, 0.01);
    t('recoil.counterPull', 'counterPull', 0, 1, 0.05);
    t('recoil.linearFloor', 'linearFloor', 0, 10, 0.25);
    t('recoil.patternResetTime', 'patternResetTime', 0.05, 1, 0.01);
    t('recoil.crosshairScale', 'crosshairScale', 0, 0.5, 0.01);
  }

  /** Called by Weapon on every shot. ads = 0..1. */
  onFire(def, ads = 0) {
    const r = def.recoil || {};
    let pitch, yaw;

    if (Array.isArray(r.pattern) && r.pattern.length > 0) {
      // learnable pattern — wrap into the drift section for long sprays
      const pat = r.pattern;
      const loop = Math.min(r.patternLoop ?? 0, pat.length - 1);
      let i = this.patternIndex;
      if (i >= pat.length) i = loop + ((i - loop) % (pat.length - loop));
      const [pp, py] = pat[i];
      pitch = pp * (r.kickPitch ?? 1) * (0.94 + Math.random() * 0.12);
      yaw = py * (r.kickYaw ?? 1) + (Math.random() - 0.5) * 0.08;
      this.patternIndex++;
    } else {
      // Envelope path (pistol/smg/shotgun/sniper + the two new guns):
      //   exotic  → one colossal upward kick (kickPitch 9, kickYaw ~1).
      //   sawblade → light, rapid, slightly jittery kick (kickPitch 0.8).
      // Both are fully data-driven from def.recoil — no per-gun branch needed.
      pitch = (r.kickPitch ?? 1) * (0.88 + Math.random() * 0.24);
      yaw = (r.kickYaw ?? 0) * (Math.random() * 2 - 1);
    }

    const m = 1 + ((r.adsMult ?? 1) - 1) * Math.min(1, Math.max(0, ads));
    pitch *= m;
    yaw *= m;

    this._kick(pitch, yaw);
    this.accumPitch += pitch;
    this.accumYaw += yaw;
    this._recoverRate = r.recover ?? 12;
    this._lastShotTime = this.ctx.loop.time;
  }

  /** Called from WeaponManager.render(dt) — after CameraFX applied the frame. */
  update(dt) {
    if (dt <= 0) return;
    const now = this.ctx.loop.time;

    // pattern resets once the player stops spraying
    if (this.patternIndex > 0 && now - this._lastShotTime > this.params.patternResetTime) {
      this.patternIndex = 0;
    }

    this._counterPull();

    // smooth recovery of what the player did NOT compensate
    if (now - this._lastShotTime >= this.params.recoverDelay &&
        (this.accumPitch !== 0 || this.accumYaw !== 0)) {
      const k = 1 - Math.exp(-this._recoverRate * dt);
      const floor = this.params.linearFloor * dt;
      const stepP = this._stepToward(this.accumPitch, k, floor);
      const stepY = this._stepToward(this.accumYaw, k, floor);
      if (stepP !== 0 || stepY !== 0) {
        this._kick(-stepP, -stepY);
        this.accumPitch -= stepP;
        this.accumYaw -= stepY;
        if (Math.abs(this.accumPitch) < 1e-4) this.accumPitch = 0;
        if (Math.abs(this.accumYaw) < 1e-4) this.accumYaw = 0;
      }
    }

    // resample camera for next frame's counter-pull delta
    const cam = this.ctx.player?.camera;
    if (cam && typeof cam.pitch === 'number' && typeof cam.yaw === 'number') {
      this._prevPitch = cam.pitch;
      this._prevYaw = cam.yaw;
    } else {
      this._prevPitch = null;
      this._prevYaw = null;
    }
    this._appliedPitch = 0;
    this._appliedYaw = 0;
  }

  /** Small extra crosshair bloom (degrees) while recoil is uncompensated. */
  getCrosshairDeg() {
    const v = (Math.abs(this.accumPitch) + Math.abs(this.accumYaw)) * this.params.crosshairScale;
    return Math.min(1.5, v);
  }

  /** Drop tracked state (weapon switch) — recovery of what's owed continues. */
  resetPattern() {
    this.patternIndex = 0;
  }

  // ---- internals ----------------------------------------------------------

  _kick(p, y) {
    this.ctx.player?.camera?.kick?.(p, y);
    this._appliedPitch += p;
    this._appliedYaw += y;
  }

  _stepToward(accum, k, floor) {
    if (accum === 0) return 0;
    let step = accum * k;
    const sign = Math.sign(accum);
    if (Math.abs(step) < floor) step = sign * floor;
    if (Math.abs(step) > Math.abs(accum)) step = accum;
    return step;
  }

  _counterPull() {
    const cp = this.params.counterPull;
    if (cp <= 0) return;
    const cam = this.ctx.player?.camera;
    if (!cam || typeof cam.pitch !== 'number' || this._prevPitch === null) return;

    // player input = actual camera delta minus what we ourselves applied
    const playerP = (cam.pitch - this._prevPitch) - this._appliedPitch;
    const playerY = wrap180(cam.yaw - this._prevYaw) - this._appliedYaw;

    // motion opposing the accumulated recoil counts as compensation —
    // shrink the accumulator toward 0, never grow or flip it.
    if (this.accumPitch > 0 && playerP < 0) {
      this.accumPitch = Math.max(0, this.accumPitch + playerP * cp);
    } else if (this.accumPitch < 0 && playerP > 0) {
      this.accumPitch = Math.min(0, this.accumPitch + playerP * cp);
    }
    if (this.accumYaw > 0 && playerY < 0) {
      this.accumYaw = Math.max(0, this.accumYaw + playerY * cp);
    } else if (this.accumYaw < 0 && playerY > 0) {
      this.accumYaw = Math.min(0, this.accumYaw + playerY * cp);
    }
  }
}
