// ARENA client — net/Prediction.js
// Client-side prediction + server reconciliation for the LOCAL player, using the
// SAME shared movement-core the server runs (so prediction matches authority).
//
// Each fixed step: build an InputCmd (seq++), apply it locally via movement-core
// (instant, zero-latency feel), buffer it unacked, and send it. On a snapshot:
// snap our state to the authoritative state as of snap.ack, replay all still-
// unacked inputs on top, and fold the resulting positional error into a decaying
// visual offset so any correction is SMOOTH — never a teleport (except respawn).
//
// Writes the predicted transform into ctx.player.controller so the existing
// CameraFX / Viewmodel / HUD all work unchanged.
import * as THREE from 'three';
import { createMoveState, stepMovement, applyAuthState, horizontalSpeed } from '../../shared/movement-core.js';
import { ARENA_WORLD, MOVE, CAPSULE, BTN } from '../../shared/constants.js';

const UNACKED_MAX = 240;

export class Prediction {
  constructor(ctx, connection, opts = {}) {
    this.ctx = ctx;
    this.conn = connection;
    this.onEvent = opts.onEvent || (() => {});
    this.world = opts.world || ARENA_WORLD;

    this.pred = createMoveState(opts.spawn || { pos: { x: 0, y: 0, z: 0 }, yaw: 0 });
    this.seq = 0;
    this.unacked = [];
    this.errorOffset = new THREE.Vector3();
    this.lastPredErr = 0;

    // movement-audio cadence
    this._footAccum = 0;
    this._prevState = 'AIRBORNE';
    this._prevGrounded = false;
    this._prevVy = 0;

    this._applyToController(0);
  }

  setSpawn(spawn) {
    this.pred = createMoveState(spawn);
    this.unacked.length = 0;
    this.errorOffset.set(0, 0, 0);
    this._applyToController(0);
  }

  // ---- fixed-step: sample input, predict, send --------------------------
  fixedStep(dt) {
    const ctx = this.ctx;
    const input = ctx.input;
    const cam = ctx.player.camera;

    // buttons + move from the existing action layer
    let buttons = 0;
    if (input.down('jump')) buttons |= BTN.JUMP;
    if (input.down('crouch')) buttons |= BTN.CROUCH;
    if (input.down('sprint')) buttons |= BTN.SPRINT;
    const f = (input.down('forward') ? 1 : 0) - (input.down('back') ? 1 : 0);
    const r = (input.down('right') ? 1 : 0) - (input.down('left') ? 1 : 0);

    const def = ctx.weapons?.current?.def;
    const weight = def?.weight ?? 1;
    const speedMult = Math.max(MOVE.weightSpeedMin, Math.min(1, 1 - (weight - 1) * MOVE.weightSpeedPenalty));

    const cmd = {
      seq: ++this.seq,
      dtMs: dt * 1000,
      move: { f, r },
      look: { yaw: cam.yaw, pitch: cam.pitch },
      buttons,
      speedMult,
    };

    // predict locally
    const before = this.pred.state;
    stepMovement(this.pred, cmd, this.world, dt);
    this._movementAudio(dt, before);

    this.unacked.push(cmd);
    if (this.unacked.length > UNACKED_MAX) this.unacked.shift();
    this.conn.sendInput(cmd);

    // decay the visual error offset
    const k = Math.exp(-16 * dt); // ~ converge in ~0.2 s
    this.errorOffset.multiplyScalar(k);
    if (this.errorOffset.lengthSq() < 1e-8) this.errorOffset.set(0, 0, 0);

    this._applyToController(dt);
  }

  // ---- reconcile on authoritative snapshot ------------------------------
  onSnapshot(snap) {
    const me = snap.players.find((p) => p.id === this.conn.id);
    if (!me) return;

    // remember the currently-predicted position to measure the correction
    const px = this.pred.px, py = this.pred.py, pz = this.pred.pz;

    // snap to authority as of the acked input, keep our own aim
    applyAuthState(this.pred, me);

    // drop acked inputs, replay the rest
    this.unacked = this.unacked.filter((c) => c.seq > snap.ack);
    for (const c of this.unacked) stepMovement(this.pred, c, this.world, (c.dtMs || 16.67) / 1000);

    // fold the correction into the smoothing offset (keeps the render continuous)
    const ex = (px + this.errorOffset.x) - this.pred.px;
    const ey = (py + this.errorOffset.y) - this.pred.py;
    const ez = (pz + this.errorOffset.z) - this.pred.pz;
    this.errorOffset.set(ex, ey, ez);
    this.lastPredErr = Math.hypot(this.pred.px - px, this.pred.py - py, this.pred.pz - pz);

    // huge error (respawn / teleport) → snap instead of smearing
    if (this.errorOffset.lengthSq() > 9) this.errorOffset.set(0, 0, 0);
  }

  // ---- write predicted transform into the shared controller -------------
  _applyToController(dt) {
    const c = this.ctx.player.controller;
    const m = this.ctx.player.movement;
    // prevPosition for render interpolation
    c.prevPosition.copy(c.position);
    c.position.set(this.pred.px + this.errorOffset.x, this.pred.py + this.errorOffset.y, this.pred.pz + this.errorOffset.z);
    c.velocity.set(this.pred.vx, this.pred.vy, this.pred.vz);
    c.grounded = this.pred.grounded;
    c.groundNormal.set(this.pred.groundNx, this.pred.groundNy, this.pred.groundNz);
    c.height = this.pred.height;
    c.crouched = this.pred.crouched;
    c.standHeight = CAPSULE.standHeight;
    c.crouchHeight = CAPSULE.crouchHeight;
    c.radius = CAPSULE.radius;
    if (m) {
      m.state = this.pred.state;
      m.wallSide = this.pred.wallSide;
      if (this.pred.state === 'WALLRUN') {
        if (!m.wallNormal) m.wallNormal = new THREE.Vector3();
        m.wallNormal.set(this.pred.wallNx, 0, this.pred.wallNz);
      } else {
        m.wallNormal = null;
      }
    }
    // wall-run camera lean for the local player
    const cam = this.ctx.player.camera;
    if (cam?.setRoll) cam.setRoll(this.pred.state === 'WALLRUN' ? this.pred.wallSide * MOVE.wallRollDeg : 0);
  }

  // ---- local movement audio (footsteps / jump / land / slide / wallrun) --
  _movementAudio(dt, prevState) {
    const s = this.pred;
    const spd = horizontalSpeed(s);

    // jump edge: vy jumped positive from grounded
    if (s.vy > 4 && this._prevVy <= 4 && (prevState === 'GROUNDED' || prevState === 'SLIDING' || prevState === 'WALLRUN')) {
      this.onEvent(prevState === 'WALLRUN' ? 'walljump' : 'jump');
    }
    // land edge
    if (s.grounded && !this._prevGrounded) {
      const hard = Math.abs(this._prevVy) > MOVE.landHardSpeed;
      this.onEvent('land', { hard });
      this._footAccum = 0;
    }
    // footsteps while grounded and moving
    if (s.state === 'GROUNDED' && spd > 1.2) {
      this._footAccum += spd * dt;
      if (this._footAccum >= 2.4) { this._footAccum = 0; this.onEvent('footstep', { speed: spd }); }
    }
    // slide / wallrun loops on transitions
    if (s.state !== prevState) {
      if (prevState === 'SLIDING') this.onEvent('slide_end');
      if (prevState === 'WALLRUN') this.onEvent('wallrun_end');
      if (s.state === 'SLIDING') this.onEvent('slide_start');
      if (s.state === 'WALLRUN') this.onEvent('wallrun_start', { side: s.wallSide });
    }

    this._prevState = s.state;
    this._prevGrounded = s.grounded;
    this._prevVy = s.vy;
  }
}
