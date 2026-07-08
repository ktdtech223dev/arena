// player/Movement.js — Movement (contract §5.B). THE SOUL OF RANGE.
//
// Finite state machine: GROUNDED | AIRBORNE | SLIDING | WALLRUN.
// Wall-jump is an IMPULSE, not a state. MOMENTUM IS KING — horizontal speed
// carries across every transition; it is only ever hard-reset on a straight-
// down landing.
//
// Owns gravity / acceleration / friction and drives PlayerController.move().
// Reads ctx.input actions: forward/back/left/right/jump/crouch/sprint.
// Reads look direction from ctx.player.camera (forwardXZ / rightXZ).
// Emits every player:* event (§6) and plays movement audio directly (§7).
//
// Feel model:
//   - Ground: Quake/Source-style accel toward wishdir with a speed cap + friction.
//   - Air:    accelerate(wishdir, small wishspeed, big accel) so mouse+strafe
//             GAINS speed (air-strafing / bunny-momentum).
//   - Slide:  boost on entry, near-frictionless, gravity projected down ramps,
//             slide-hop preserves velocity, low ceiling forces staying low.
//   - Wallrun: attach alongside a wallrun collider, kill into-wall velocity,
//             reduced gravity, build forward speed, camera roll, max duration.
//   - Walljump: impulse away from wall + up, preserving tangential momentum.
//
// Every feel number is registered in ctx.tunables (cat 'movement').
import * as THREE from 'three';

const STATE = {
  GROUNDED: 'GROUNDED',
  AIRBORNE: 'AIRBORNE',
  SLIDING: 'SLIDING',
  WALLRUN: 'WALLRUN',
};

export class Movement {
  constructor(ctx) {
    this.ctx = ctx;
    this.controller = ctx.player?.controller || null;
    this.cameraFX = ctx.player?.camera || null;

    // ---- public state (contract §5.B) --------------------------------------
    this.state = STATE.AIRBORNE; // resolves to GROUNDED on first grounded tick
    this.wallNormal = null;      // THREE.Vector3 | null (points away from wall)
    this.wallSide = 0;           // -1 wall on left, +1 wall on right, 0 none

    // ---- tunables ----------------------------------------------------------
    this.t = {
      // gravity
      gravity: 25,
      terminal: 55,
      // ground
      groundAccel: 60,
      maxSpeed: 8,
      sprintSpeed: 10,
      groundFriction: 8,
      // weapon weight → ground/sprint top-speed penalty (§12.2)
      weightSpeedPenalty: 0.06, // per unit of weight above 1
      weightSpeedMin: 0.7,      // floor on the speed multiplier
      stopSpeed: 2.5,        // friction floor speed for crisp stops
      // air
      airAccel: 40,
      airWishSpeed: 1.2,     // Source air cap: strafing gains speed above this
      airControl: 12,        // extra steering accel in air (toward wishdir)
      airFriction: 0.05,
      // jump
      jumpForce: 8.5,
      coyoteTime: 0.12,
      jumpBuffer: 0.15,
      variableJumpCut: 0.55, // scale up-vel by this on early release
      // slide
      slideBoost: 3.5,
      slideBoostSpeedCap: 11,  // no boost above this (already fast)
      slideCooldown: 0.8,
      slideFriction: 1.2,
      slideMinSpeed: 3.0,      // exit slide below this if on flat ground
      slideSteerRate: 6,       // how fast steering rotates the slide velocity
      slideMaxSpeed: 16,       // HARD cap on slide horizontal speed (anti-exploit)
      // wallrun
      wallMinSpeed: 4,
      wallAttachDot: 0.35,     // how forward-facing you must be to attach
      wallGravityStart: 0.05,  // gravity fraction at attach (near float)
      wallGravityEnd: 0.6,     // gravity fraction ramps to this over duration
      wallMaxDuration: 2.5,
      wallUpBoost: 2,          // upward pop if falling on attach
      wallSpeedBoost: 1.5,     // forward speed to build toward over baseline
      wallAccel: 9,            // accel building toward the target forward speed
      wallStickForce: 6,       // gentle pull into the wall to stay attached
      wallRollDeg: 12,         // camera roll while wallrunning
      // walljump
      wallJumpAway: 6,
      wallJumpUp: 7,
      wallJumpGrace: 0.1,      // can walljump this long after leaving a wall
      // landing
      landHardSpeed: 12,       // |fall speed| above this = hard landing
      landHardTrim: 0.15,      // horizontal speed trimmed on hard landing
      landDipScale: 0.06,      // land dip = min(1, fallSpeed * this)
      // footsteps
      footstepBase: 2.5,       // cadence factor: interval = base / speed
      footstepMinSpeed: 1.2,
    };

    // ---- timers / edge state ----------------------------------------------
    this._coyote = 0;          // time since last grounded (for coyote jump)
    this._jumpBuf = 0;         // time since jump pressed (buffer)
    this._slideCd = 0;         // slide cooldown timer
    this._wallEntrySpeed = 0;  // along-wall speed captured at wall-run attach
    this._wallTimer = 0;       // elapsed wallrun time
    this._wallLeave = 999;     // time since we left a wall (for walljump grace)
    this._lastWallCollider = null; // no re-attach to same wall until reset
    this._sinceWallReset = 0;

    this._jumpHeld = false;    // was jump held last tick (for variable-height)
    this._jumpCutDone = false; // variable-height cut applied once per jump
    this._footAccum = 0;       // distance-ish accumulator for footstep cadence
    this._wasGrounded = false;
    this._prevVelY = 0;        // for landing detection

    // ---- audio loop handles ------------------------------------------------
    this._slideLoop = null;
    this._wallLoop = null;

    // ---- scratch -----------------------------------------------------------
    this._wish = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this._wallTangent = new THREE.Vector3();

    this._registerTunables();
  }

  _ctrl() {
    if (!this.controller) this.controller = this.ctx.player?.controller || null;
    return this.controller;
  }
  _cam() {
    if (!this.cameraFX) this.cameraFX = this.ctx.player?.camera || null;
    return this.cameraFX;
  }

  // ==========================================================================
  // MAIN TICK
  // ==========================================================================
  fixedUpdate(dt) {
    const ctrl = this._ctrl();
    const cam = this._cam();
    if (!ctrl || !cam) return;

    ctrl.beginTick(); // snapshot prevPosition + lazy spawn

    const input = this.ctx.input;
    this._prevVelY = ctrl.velocity.y;

    // ---- read intent -------------------------------------------------------
    const fMove = (input.down('forward') ? 1 : 0) - (input.down('back') ? 1 : 0);
    const rMove = (input.down('right') ? 1 : 0) - (input.down('left') ? 1 : 0);
    const crouchHeld = input.down('crouch');
    const sprintHeld = input.down('sprint');

    // jump buffer / coyote timers
    if (input.consumePressed('jump')) this._jumpBuf = this.t.jumpBuffer;
    else this._jumpBuf = Math.max(0, this._jumpBuf - dt);
    const jumpHeld = input.down('jump');

    this._coyote = Math.max(0, this._coyote - dt);
    this._slideCd = Math.max(0, this._slideCd - dt);
    this._wallLeave += dt;
    this._sinceWallReset += dt;

    // wish direction from camera (yaw only, XZ)
    cam.forwardXZ(this._fwd);
    cam.rightXZ(this._right);
    const wish = this._wish.set(0, 0, 0);
    wish.addScaledVector(this._fwd, fMove);
    wish.addScaledVector(this._right, rMove);
    const wishLen = wish.length();
    if (wishLen > 1e-4) wish.multiplyScalar(1 / wishLen); // normalize dir

    // ---- state machine -----------------------------------------------------
    switch (this.state) {
      case STATE.GROUNDED:
        this._tickGrounded(dt, ctrl, cam, wish, wishLen, crouchHeld, sprintHeld, jumpHeld);
        break;
      case STATE.SLIDING:
        this._tickSliding(dt, ctrl, cam, wish, wishLen, crouchHeld, jumpHeld);
        break;
      case STATE.WALLRUN:
        this._tickWallrun(dt, ctrl, cam, wish, wishLen, jumpHeld);
        break;
      case STATE.AIRBORNE:
      default:
        this._tickAirborne(dt, ctrl, cam, wish, wishLen, crouchHeld, jumpHeld);
        break;
    }

    this._jumpHeld = jumpHeld;
    this._wasGrounded = ctrl.grounded;
  }

  // ==========================================================================
  // GROUNDED
  // ==========================================================================
  _tickGrounded(dt, ctrl, cam, wish, wishLen, crouchHeld, sprintHeld, jumpHeld) {
    // eye/capsule: stand up if possible, else stay crouched under a ceiling
    this._resolveStandCrouch(ctrl, crouchHeld);

    // --- try to enter slide (crouch while moving fast) ---
    const speed = ctrl.horizontalSpeed();
    if (crouchHeld && speed >= this.t.slideMinSpeed + 1 && this._slideCd <= 0) {
      this._enterSlide(ctrl, cam);
      // continue this tick as sliding
      this._tickSliding(dt, ctrl, cam, wish, wishLen, crouchHeld, jumpHeld);
      return;
    }

    // --- jump (buffered) ---
    if (this._jumpBuf > 0) {
      this._doJump(ctrl, cam);
      this.state = STATE.AIRBORNE;
      this._tickAirborne(dt, ctrl, cam, wish, wishLen, crouchHeld, jumpHeld);
      return;
    }

    // --- ground movement: friction then accel ---
    // Heavier equipped weapons lower ONLY the ground/sprint top-speed target
    // (§12.2). Accel, air-strafe, slide, and wall-run are untouched; momentum
    // already carried is never clamped here — only the accel target drops.
    const speedMult = this._weightSpeedMult();
    const maxSpeed = (sprintHeld ? this.t.sprintSpeed : this.t.maxSpeed) * speedMult;
    if (wishLen < 1e-4) {
      this._applyFriction(ctrl, this.t.groundFriction, dt);
    } else {
      // small friction even while moving keeps strafing crisp without killing momentum
      this._applyFriction(ctrl, this.t.groundFriction * 0.35, dt);
      this._accelerate(ctrl, wish, maxSpeed, this.t.groundAccel, dt);
    }

    // pull toward the ground so we don't skip on tiny crests
    ctrl.velocity.y = Math.min(ctrl.velocity.y, 0);

    ctrl.move(dt, { snap: true });

    // footsteps
    this._footsteps(ctrl, dt);

    // --- leaving the ground? ---
    if (!ctrl.grounded) {
      this._coyote = this.t.coyoteTime;
      this.state = STATE.AIRBORNE;
    }
  }

  // ==========================================================================
  // AIRBORNE
  // ==========================================================================
  _tickAirborne(dt, ctrl, cam, wish, wishLen, crouchHeld, jumpHeld) {
    // air-crouch: shrink capsule (pull feet up toward the head)
    this._airCrouch(ctrl, crouchHeld);

    // variable jump height: released before apex → cut upward velocity once
    if (!jumpHeld && !this._jumpCutDone && ctrl.velocity.y > 0) {
      ctrl.velocity.y *= this.t.variableJumpCut;
      this._jumpCutDone = true;
    }

    // coyote jump (buffered jump right after walking off a ledge)
    if (this._jumpBuf > 0 && this._coyote > 0) {
      this._doJump(ctrl, cam);
      // stay airborne
    }

    // wall-jump grace: buffered jump shortly after leaving a wall
    if (this._jumpBuf > 0 && this._wallLeave <= this.t.wallJumpGrace && this.wallNormal) {
      this._doWallJump(ctrl, cam);
    }

    // gravity
    this._applyGravity(ctrl, 1, dt);

    // air friction (very low) + source-style air acceleration
    if (this.t.airFriction > 0) this._applyFriction(ctrl, this.t.airFriction, dt);
    if (wishLen > 1e-4) {
      this._airAccelerate(ctrl, wish, this.t.airWishSpeed, this.t.airAccel, dt);
      this._airSteer(ctrl, wish, dt);
    }

    ctrl.move(dt, { snap: false });

    // --- wall-run attach check ---
    if (this._tryWallAttach(ctrl, cam, wish, wishLen)) return;

    // --- landing ---
    if (ctrl.grounded) {
      this._onLand(ctrl, cam, crouchHeld);
    }
  }

  // ==========================================================================
  // SLIDING
  // ==========================================================================
  _tickSliding(dt, ctrl, cam, wish, wishLen, crouchHeld, jumpHeld) {
    // slide-hop: jump while sliding preserves full velocity (chainable)
    if (this._jumpBuf > 0) {
      this._doJump(ctrl, cam, /*preserveHorizontal=*/true);
      this._exitSlide(ctrl, /*keepCrouch=*/false);
      // clear the re-slide cooldown so a hop can chain straight back into a
      // slide on landing (the cooldown still guards passive re-slide/boost spam)
      this._slideCd = 0;
      this.state = STATE.AIRBORNE;
      this._tickAirborne(dt, ctrl, cam, wish, wishLen, crouchHeld, jumpHeld);
      return;
    }

    // gravity (so we fall onto/along ramps)
    this._applyGravity(ctrl, 1, dt);

    // downhill acceleration: gravity projected along the slope tangent.
    // groundNormal from the collision system encodes the ramp slope.
    if (ctrl.grounded) {
      const n = ctrl.groundNormal;
      // component of gravity along the surface = g - (g·n)n ; g = (0,-grav,0)
      const g = this.t.gravity * this.ctx.cheats.gravityScale;
      const gDotN = -g * n.y; // (0,-g,0)·n
      // tangential gravity vector
      const tx = -gDotN * n.x;
      const ty = -g - gDotN * n.y;
      const tz = -gDotN * n.z;
      ctrl.velocity.x += tx * dt;
      ctrl.velocity.y += ty * dt;
      ctrl.velocity.z += tz * dt;
    }

    // very low friction so slides are long and fast
    this._applyFriction(ctrl, this.t.slideFriction, dt);

    // gentle steering — you can AIM the slide but not accelerate by turning.
    // Rotate the horizontal velocity toward wishdir at a capped rate WITHOUT
    // changing its magnitude (redirect, never add energy). Turning the camera
    // therefore only bends momentum; it can never pump kinetic energy in.
    if (wishLen > 1e-4) this._slideSteer(ctrl, wish, dt);

    // HARD slide speed cap: downhill gravity accel is legitimate, but nothing
    // may push horizontal speed past this. Backstop against any energy leak.
    this._clampHorizontalSpeed(ctrl, this.t.slideMaxSpeed);

    ctrl.move(dt, { snap: true });

    // keep the slide loop positioned/alive
    if (this._slideLoop) {
      const rate = 0.7 + Math.min(1, ctrl.horizontalSpeed() / 14) * 0.8;
      this._slideLoop.setRate?.(rate);
    }

    // --- exits ---
    if (!ctrl.grounded) {
      // slid off a ledge → airborne, stay low if still crouching
      this._exitSlide(ctrl, /*keepCrouch=*/crouchHeld);
      this.state = STATE.AIRBORNE;
      return;
    }

    const speed = ctrl.horizontalSpeed();
    const lowCeiling = !ctrl.canStandUp();
    // stop sliding when slow (unless a low ceiling forces us to stay down)
    if (!crouchHeld && !lowCeiling) {
      this._exitSlide(ctrl, /*keepCrouch=*/false);
      this.state = STATE.GROUNDED;
      return;
    }
    if (speed < this.t.slideMinSpeed && !lowCeiling) {
      // too slow → drop to a crouch-walk or stand
      this._exitSlide(ctrl, /*keepCrouch=*/crouchHeld);
      this.state = STATE.GROUNDED;
    }
  }

  // ==========================================================================
  // WALLRUN
  // ==========================================================================
  _tickWallrun(dt, ctrl, cam, wish, wishLen, jumpHeld) {
    this._wallTimer += dt;

    // wall-jump off the wall (chainable)
    if (this._jumpBuf > 0) {
      this._doWallJump(ctrl, cam);
      this._exitWallrun(ctrl, cam);
      this.state = STATE.AIRBORNE;
      this._tickAirborne(dt, ctrl, cam, wish, wishLen, false, jumpHeld);
      return;
    }

    // re-probe the wall so the tangent tracks corners; drop if it's gone.
    // probe distance is a small skin past the radius so we keep contact while
    // the stick force holds us beside the wall (too far = we tunnel past it).
    const side = this.wallSide;
    const info = ctrl.probeWall(-this.wallNormal.x, -this.wallNormal.z, this.radius() + 0.15);
    if (!info || info.collider !== this._lastWallCollider || !info.wallrun) {
      this._exitWallrun(ctrl, cam);
      this.state = STATE.AIRBORNE;
      return;
    }
    // refresh wall normal from the live probe
    this.wallNormal.set(info.nx, 0, info.nz);

    // reduced gravity ramping up over the run
    const frac = Math.min(1, this._wallTimer / this.t.wallMaxDuration);
    const gFrac = this.t.wallGravityStart + (this.t.wallGravityEnd - this.t.wallGravityStart) * frac;
    this._applyGravity(ctrl, gFrac, dt);

    // build forward speed along the wall tangent, converging to a fixed target
    // captured at attach (so the run holds a stable pace, not accelerate forever)
    this._computeWallTangent(ctrl, this.wallNormal, this._wallTangent);
    const targetSpeed = Math.max(this._wallEntrySpeed, this.t.wallMinSpeed) + this.t.wallSpeedBoost;
    const alongV = ctrl.velocity.x * this._wallTangent.x + ctrl.velocity.z * this._wallTangent.z;
    if (alongV < targetSpeed) {
      const add = Math.min(this.t.wallAccel * dt, targetSpeed - alongV);
      ctrl.velocity.x += this._wallTangent.x * add;
      ctrl.velocity.z += this._wallTangent.z * add;
    }

    // gentle stick into the wall so we don't peel off
    ctrl.velocity.x -= this.wallNormal.x * this.t.wallStickForce * dt;
    ctrl.velocity.z -= this.wallNormal.z * this.t.wallStickForce * dt;

    ctrl.move(dt, { snap: false });

    // exits: duration, or looking/steering away from the wall, or landing
    const facing = this._fwd.x * this._wallTangent.x + this._fwd.z * this._wallTangent.z;
    if (
      this._wallTimer >= this.t.wallMaxDuration ||
      facing < -0.1 ||                     // turned to face away/back
      (wishLen > 1e-4 && (wish.x * this.wallNormal.x + wish.z * this.wallNormal.z) > 0.5) // steering off
    ) {
      this._exitWallrun(ctrl, cam);
      this.state = STATE.AIRBORNE;
      return;
    }
    if (ctrl.grounded) {
      this._exitWallrun(ctrl, cam);
      this._onLand(ctrl, cam, false);
    }
  }

  // ==========================================================================
  // TRANSITIONS
  // ==========================================================================

  _doJump(ctrl, cam, preserveHorizontal = false) {
    ctrl.velocity.y = this.t.jumpForce;
    this._jumpBuf = 0;
    this._coyote = 0;
    this._jumpCutDone = false;
    this.ctx.events.emit('player:jump', {});
    this.ctx.audio.play('jump', { volume: 0.8 });
  }

  _doWallJump(ctrl, cam) {
    const n = this.wallNormal;
    if (!n) return;
    // preserve tangential momentum, add away-from-wall + up impulse.
    // remove any into-wall component first, then push out.
    const into = ctrl.velocity.x * n.x + ctrl.velocity.z * n.z;
    if (into < 0) {
      ctrl.velocity.x -= n.x * into;
      ctrl.velocity.z -= n.z * into;
    }
    ctrl.velocity.x += n.x * this.t.wallJumpAway;
    ctrl.velocity.z += n.z * this.t.wallJumpAway;
    ctrl.velocity.y = Math.max(ctrl.velocity.y, 0) + this.t.wallJumpUp;

    this._jumpBuf = 0;
    this._jumpCutDone = false;
    this._wallLeave = 999; // consumed
    cam.setRoll(0);
    this.ctx.events.emit('player:walljump', {});
    this.ctx.audio.play('walljump', { volume: 0.9 });
  }

  _enterSlide(ctrl, cam) {
    this.setHeightCrouch(ctrl);
    const speed = ctrl.horizontalSpeed();
    // entry boost along current velocity (only when not already very fast)
    if (speed > 0.1 && speed < this.t.slideBoostSpeedCap) {
      const inv = 1 / speed;
      ctrl.velocity.x += ctrl.velocity.x * inv * this.t.slideBoost;
      ctrl.velocity.z += ctrl.velocity.z * inv * this.t.slideBoost;
    }
    this._slideCd = this.t.slideCooldown;
    this.state = STATE.SLIDING;
    this.ctx.events.emit('player:slide_start', {});
    this.ctx.audio.play('slide_start', { volume: 0.8 });
    this._slideLoop = this.ctx.audio.startLoop('slide_loop', { volume: 0.5 });
  }

  _exitSlide(ctrl, keepCrouch) {
    if (this._slideLoop) {
      this._slideLoop.stop?.(0.15);
      this._slideLoop = null;
    }
    if (!keepCrouch) {
      // will stand up next grounded tick if there's room
      ctrl.setHeight(ctrl.standHeight);
    }
    this.ctx.events.emit('player:slide_end', {});
  }

  _enterWallrun(ctrl, cam, info, side) {
    this.state = STATE.WALLRUN;
    this._wallTimer = 0;
    this._lastWallCollider = info.collider;
    this.wallNormal = this.wallNormal || new THREE.Vector3();
    this.wallNormal.set(info.nx, 0, info.nz).normalize();
    this.wallSide = side;

    // kill velocity perpendicular to the wall (into/out of it)
    const into = ctrl.velocity.x * this.wallNormal.x + ctrl.velocity.z * this.wallNormal.z;
    ctrl.velocity.x -= this.wallNormal.x * into;
    ctrl.velocity.z -= this.wallNormal.z * into;

    // baseline along-wall speed at attach — the run's target speed is derived
    // from this once, so it can't ratchet upward every tick.
    this._wallEntrySpeed = ctrl.horizontalSpeed();

    // slight up boost if we were falling
    if (ctrl.velocity.y < 0) ctrl.velocity.y = this.t.wallUpBoost;

    cam.setRoll(side * this.t.wallRollDeg);
    this.ctx.events.emit('player:wallrun_start', { side });
    this._wallLoop = this.ctx.audio.startLoop('wallrun_loop', { volume: 0.55 });
  }

  _exitWallrun(ctrl, cam) {
    if (this._wallLoop) {
      this._wallLoop.stop?.(0.12);
      this._wallLoop = null;
    }
    cam.setRoll(0);
    this._wallLeave = 0; // start walljump grace window
    this.wallSide = 0;
    // keep wallNormal for the grace-window walljump; cleared on next attach/land
    this.ctx.events.emit('player:wallrun_end', {});
  }

  _onLand(ctrl, cam, crouchHeld) {
    const fallSpeed = Math.abs(Math.min(0, this._prevVelY));
    const hard = fallSpeed > this.t.landHardSpeed;

    if (hard && !this.ctx.cheats.noHardLanding) {
      // trim horizontal on a hard landing (feel: heavy impact)
      ctrl.velocity.x *= (1 - this.t.landHardTrim);
      ctrl.velocity.z *= (1 - this.t.landHardTrim);
    }
    // clamp residual downward velocity from the fall
    if (ctrl.velocity.y < 0) ctrl.velocity.y = 0;

    // camera dip + audio scaled by impact
    const dip = Math.min(1, fallSpeed * this.t.landDipScale);
    cam.landDip(dip);

    this.ctx.events.emit('player:land', { fallSpeed, hard });
    this.ctx.audio.play(hard ? 'land_hard' : 'land_soft', {
      volume: hard ? 0.9 : 0.5,
    });

    // clear wall memory on land (can re-attach to same wall now)
    this._lastWallCollider = null;
    this.wallNormal = null;
    this._wallLeave = 999;

    this._coyote = this.t.coyoteTime;

    // land directly into a slide if crouch is held and we're fast
    if (crouchHeld && ctrl.horizontalSpeed() >= this.t.slideMinSpeed + 1 && this._slideCd <= 0) {
      this._enterSlide(ctrl, cam);
    } else {
      this.state = STATE.GROUNDED;
    }
  }

  // ==========================================================================
  // WALL ATTACH LOGIC
  // ==========================================================================
  _tryWallAttach(ctrl, cam, wish, wishLen) {
    // need enough horizontal speed
    const hspeed = ctrl.horizontalSpeed();
    if (hspeed < this.t.wallMinSpeed) return false;
    // don't attach while shooting straight up
    // probe both sides
    const r = this.radius();
    const probeDist = r + 0.12;
    // right side, then left side
    const rightInfo = ctrl.probeWall(this._right.x, this._right.z, probeDist);
    let info = null, side = 0;
    if (rightInfo && rightInfo.wallrun && rightInfo.collider !== this._lastWallCollider) {
      info = { nx: rightInfo.nx, nz: rightInfo.nz, collider: rightInfo.collider };
      side = 1;
    } else {
      const leftInfo = ctrl.probeWall(-this._right.x, -this._right.z, probeDist);
      if (leftInfo && leftInfo.wallrun && leftInfo.collider !== this._lastWallCollider) {
        info = { nx: leftInfo.nx, nz: leftInfo.nz, collider: leftInfo.collider };
        side = -1;
      }
    }
    if (!info) return false;

    // must be moving roughly ALONG the wall (velocity·tangent) and facing forward
    this._computeWallTangent(ctrl, this._tmp.set(info.nx, 0, info.nz).normalize(), this._wallTangent);
    const velAlong = ctrl.velocity.x * this._wallTangent.x + ctrl.velocity.z * this._wallTangent.z;
    const faceAlong = this._fwd.x * this._wallTangent.x + this._fwd.z * this._wallTangent.z;
    if (velAlong < this.t.wallMinSpeed * 0.5) return false;
    if (faceAlong < this.t.wallAttachDot) return false;

    this._enterWallrun(ctrl, cam, info, side);
    return true;
  }

  // wall tangent = direction of travel along the wall.
  // Locked to the direction of TRAVEL (velocity), not the look vector, so panning
  // the camera during a run can't flip the tangent 180° and reverse thrust. Falls
  // back to facing only when nearly stopped (e.g. the exact instant of attach).
  _computeWallTangent(ctrl, wallNormal, out) {
    // tangent is perpendicular to the wall normal on the XZ plane.
    // two candidates: (nz, -nx) and (-nz, nx). Pick the one aligned with motion.
    const ax = wallNormal.z, az = -wallNormal.x;
    const velDot = ctrl.velocity.x * ax + ctrl.velocity.z * az;
    let dot = velDot;
    if (Math.abs(velDot) < 1e-3) dot = this._fwd.x * ax + this._fwd.z * az;
    if (dot >= 0) out.set(ax, 0, az);
    else out.set(-ax, 0, -az);
    return out.normalize();
  }

  // ==========================================================================
  // PHYSICS PRIMITIVES
  // ==========================================================================

  _applyGravity(ctrl, frac, dt) {
    const g = this.t.gravity * this.ctx.cheats.gravityScale * frac;
    ctrl.velocity.y -= g * dt;
    if (ctrl.velocity.y < -this.t.terminal) ctrl.velocity.y = -this.t.terminal;
  }

  // Source-style friction: scales horizontal velocity down, with a floor so
  // low speeds decay fast for crisp stops.
  _applyFriction(ctrl, friction, dt) {
    const v = ctrl.velocity;
    const speed = Math.hypot(v.x, v.z);
    if (speed < 1e-4) return;
    const control = speed < this.t.stopSpeed ? this.t.stopSpeed : speed;
    let drop = control * friction * dt;
    let newSpeed = speed - drop;
    if (newSpeed < 0) newSpeed = 0;
    const scale = newSpeed / speed;
    v.x *= scale;
    v.z *= scale;
  }

  // Quake ground acceleration: add toward wishdir up to wishSpeed, clamped by
  // how much we're already going that way (allows air-strafe when reused).
  _accelerate(ctrl, wishDir, wishSpeed, accel, dt) {
    const v = ctrl.velocity;
    const currentSpeed = v.x * wishDir.x + v.z * wishDir.z; // projection
    const addSpeed = wishSpeed - currentSpeed;
    if (addSpeed <= 0) return;
    let accelSpeed = accel * wishSpeed * dt;
    if (accelSpeed > addSpeed) accelSpeed = addSpeed;
    v.x += wishDir.x * accelSpeed;
    v.z += wishDir.z * accelSpeed;
  }

  // Air acceleration: identical math but wishSpeed is tiny, so you can keep
  // adding speed sideways by turning into the strafe (the classic trick).
  _airAccelerate(ctrl, wishDir, wishSpeed, accel, dt) {
    const v = ctrl.velocity;
    const currentSpeed = v.x * wishDir.x + v.z * wishDir.z;
    const addSpeed = wishSpeed - currentSpeed;
    if (addSpeed <= 0) return;
    let accelSpeed = accel * wishSpeed * dt;
    if (accelSpeed > addSpeed) accelSpeed = addSpeed;
    v.x += wishDir.x * accelSpeed;
    v.z += wishDir.z * accelSpeed;
  }

  // Extra air steering: rotate a fraction of horizontal speed toward wishdir
  // WITHOUT changing its magnitude — makes air control feel responsive while
  // preserving momentum (Titanfall-y).
  _airSteer(ctrl, wishDir, dt) {
    const v = ctrl.velocity;
    const speed = Math.hypot(v.x, v.z);
    if (speed < 0.1) return;
    const dirx = v.x / speed, dirz = v.z / speed;
    // steer toward wish, clamp the turn rate
    const t = Math.min(1, this.t.airControl * dt / 12);
    let nx = dirx + (wishDir.x - dirx) * t;
    let nz = dirz + (wishDir.z - dirz) * t;
    const nl = Math.hypot(nx, nz) || 1;
    nx /= nl; nz /= nl;
    v.x = nx * speed;
    v.z = nz * speed;
  }

  // Slide steering: rotate horizontal velocity toward wishDir at a capped rate,
  // PRESERVING magnitude. Same redirect-without-adding trick as _airSteer — this
  // is what keeps turning the camera mid-slide from ever gaining speed. On flat
  // ground, spinning 360° only bends the momentum vector; it can't grow it.
  _slideSteer(ctrl, wishDir, dt) {
    const v = ctrl.velocity;
    const speed = Math.hypot(v.x, v.z);
    if (speed < 0.1) return;
    const dirx = v.x / speed, dirz = v.z / speed;
    const t = Math.min(1, this.t.slideSteerRate * dt / 12);
    let nx = dirx + (wishDir.x - dirx) * t;
    let nz = dirz + (wishDir.z - dirz) * t;
    const nl = Math.hypot(nx, nz) || 1;
    nx /= nl; nz /= nl;
    v.x = nx * speed; // magnitude unchanged — pure redirect
    v.z = nz * speed;
  }

  // Hard clamp on horizontal speed. Scales x/z down uniformly if over the cap;
  // leaves y (fall/jump) untouched.
  _clampHorizontalSpeed(ctrl, maxSpeed) {
    const v = ctrl.velocity;
    const speed = Math.hypot(v.x, v.z);
    if (speed > maxSpeed && speed > 1e-6) {
      const scale = maxSpeed / speed;
      v.x *= scale;
      v.z *= scale;
    }
  }

  // ==========================================================================
  // CROUCH / STAND
  // ==========================================================================

  _resolveStandCrouch(ctrl, crouchHeld) {
    if (crouchHeld) {
      this.setHeightCrouch(ctrl);
    } else if (ctrl.crouched && ctrl.canStandUp()) {
      ctrl.setHeight(ctrl.standHeight);
    }
  }

  setHeightCrouch(ctrl) {
    ctrl.setHeight(ctrl.crouchHeight);
  }

  // Air-crouch: shrink capsule by pulling FEET up toward the head, so you tuck
  // your legs (keeps the head roughly where it was) rather than dropping.
  _airCrouch(ctrl, crouchHeld) {
    const wantH = crouchHeld ? ctrl.crouchHeight : ctrl.standHeight;
    if (Math.abs(ctrl.height - wantH) < 1e-3) return;
    if (crouchHeld && !ctrl.crouched) {
      // shrink: raise the feet so the capsule top stays put
      const delta = ctrl.standHeight - ctrl.crouchHeight;
      ctrl.position.y += delta;
      ctrl.prevPosition.y += delta; // keep interpolation smooth this tick
      ctrl.setHeight(ctrl.crouchHeight);
    } else if (!crouchHeld && ctrl.crouched) {
      // grow back: only if there's room below to drop the feet
      const delta = ctrl.standHeight - ctrl.crouchHeight;
      ctrl.position.y -= delta;
      ctrl.prevPosition.y -= delta;
      ctrl.setHeight(ctrl.standHeight);
      // if that overlaps, snap back to crouch (stay tucked)
      if (ctrl.overlapsNow()) {
        ctrl.position.y += delta;
        ctrl.prevPosition.y += delta;
        ctrl.setHeight(ctrl.crouchHeight);
      }
    }
  }

  // ==========================================================================
  // FOOTSTEPS
  // ==========================================================================
  _footsteps(ctrl, dt) {
    const speed = ctrl.horizontalSpeed();
    if (speed < this.t.footstepMinSpeed) {
      this._footAccum = 0;
      return;
    }
    // cadence: a step every (footstepBase / speed) seconds
    const interval = this.t.footstepBase / speed;
    this._footAccum += dt;
    if (this._footAccum >= interval) {
      this._footAccum = 0;
      this.ctx.events.emit('player:footstep', { speed });
      this.ctx.audio.play('footstep', {
        volume: 0.35 + Math.min(0.35, speed * 0.03),
        rate: 0.92 + Math.random() * 0.16,
      });
    }
  }

  radius() {
    return this._ctrl()?.radius ?? 0.35;
  }

  // Weapon weight → ground/sprint speed multiplier (§12.2). Read live each tick
  // from the equipped weapon def (defaults to weight 1 = full speed when weapons
  // aren't wired yet). clamp(1 - (weight-1)*penalty, min, 1).
  _weightSpeedMult() {
    const weight = this.ctx.weapons?.current?.def?.weight ?? 1;
    const mult = 1 - (weight - 1) * this.t.weightSpeedPenalty;
    return Math.max(this.t.weightSpeedMin, Math.min(1, mult));
  }

  // ==========================================================================
  // TUNABLES
  // ==========================================================================
  _registerTunables() {
    const t = this.t;
    const T = this.ctx.tunables;
    const add = (key, min, max, step, label) =>
      T.push({ cat: 'movement', key, obj: t, prop: key, min, max, step, label });

    add('gravity', 5, 60, 0.5, 'Gravity (m/s²)');
    add('terminal', 20, 100, 1, 'Terminal velocity');
    add('groundAccel', 10, 120, 1, 'Ground accel');
    add('maxSpeed', 3, 16, 0.25, 'Max walk speed');
    add('sprintSpeed', 4, 18, 0.25, 'Sprint speed');
    add('groundFriction', 1, 16, 0.25, 'Ground friction');
    add('weightSpeedPenalty', 0, 0.2, 0.005, 'Weapon weight speed penalty');
    add('weightSpeedMin', 0.3, 1, 0.05, 'Weapon weight speed floor');
    add('stopSpeed', 0.5, 6, 0.25, 'Stop speed');
    add('airAccel', 5, 100, 1, 'Air accel');
    add('airWishSpeed', 0.2, 4, 0.05, 'Air wish speed');
    add('airControl', 0, 40, 0.5, 'Air steer control');
    add('airFriction', 0, 1, 0.01, 'Air friction');
    add('jumpForce', 4, 14, 0.1, 'Jump force');
    add('coyoteTime', 0, 0.3, 0.01, 'Coyote time (s)');
    add('jumpBuffer', 0, 0.3, 0.01, 'Jump buffer (s)');
    add('variableJumpCut', 0.2, 1, 0.05, 'Variable jump cut');
    add('slideBoost', 0, 8, 0.25, 'Slide boost');
    add('slideBoostSpeedCap', 6, 18, 0.5, 'Slide boost cap');
    add('slideCooldown', 0, 2, 0.05, 'Slide cooldown (s)');
    add('slideFriction', 0, 5, 0.1, 'Slide friction');
    add('slideMinSpeed', 1, 8, 0.25, 'Slide min speed');
    add('slideSteerRate', 0, 20, 0.5, 'Slide steer rate');
    add('slideMaxSpeed', 8, 30, 0.5, 'Slide max speed (cap)');
    add('wallMinSpeed', 1, 10, 0.25, 'Wallrun min speed');
    add('wallAttachDot', 0, 1, 0.05, 'Wallrun facing dot');
    add('wallGravityStart', 0, 1, 0.01, 'Wallrun gravity start');
    add('wallGravityEnd', 0, 1, 0.01, 'Wallrun gravity end');
    add('wallMaxDuration', 0.5, 5, 0.1, 'Wallrun max duration (s)');
    add('wallUpBoost', 0, 6, 0.25, 'Wallrun up boost');
    add('wallSpeedBoost', 0, 5, 0.25, 'Wallrun speed boost');
    add('wallAccel', 0, 20, 0.5, 'Wallrun accel');
    add('wallStickForce', 0, 15, 0.5, 'Wallrun stick force');
    add('wallRollDeg', 0, 25, 0.5, 'Wallrun camera roll (°)');
    add('wallJumpAway', 2, 12, 0.25, 'Walljump away impulse');
    add('wallJumpUp', 2, 12, 0.25, 'Walljump up impulse');
    add('wallJumpGrace', 0, 0.3, 0.01, 'Walljump grace (s)');
    add('landHardSpeed', 6, 30, 0.5, 'Hard landing speed');
    add('landHardTrim', 0, 0.5, 0.01, 'Hard landing trim');
    add('landDipScale', 0, 0.15, 0.005, 'Land dip scale');
    add('footstepBase', 1, 5, 0.1, 'Footstep cadence base');
    add('footstepMinSpeed', 0.5, 4, 0.25, 'Footstep min speed');
  }
}
