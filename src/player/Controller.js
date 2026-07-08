// player/Controller.js — PlayerController (contract §5.B).
//
// The kinematic capsule. Holds position/velocity state and drives collision
// resolution through CollisionWorld each fixedUpdate. Movement.js owns the
// *decisions* (gravity, accel, jump, states); this class owns the *body* and
// the interface to the world.
//
//   position      = FEET (bottom of the capsule), authoritative
//   prevPosition  = position at the START of the previous fixedUpdate (render lerps)
//   velocity      = m/s
//   radius 0.35, standHeight 1.8, crouchHeight 1.0, eye = height - 0.18
//
// Movement calls:
//   ctrl.beginTick()                       – snapshot prevPosition (once per tick)
//   ctrl.move(dt, { snap })                – integrate velocity, resolve collisions
//   ctrl.setHeight(h) / ctrl.canStandUp()  – crouch/stand with a ceiling test
//   ctrl.probeWall(dirX,dirZ,dist)         – find a wall (for wall-run)
//   ctrl.wallCollider / ctrl.groundCollider – the collider refs Movement inspects
import * as THREE from 'three';
import { CollisionWorld } from './Collision.js';

export class PlayerController {
  constructor(ctx) {
    this.ctx = ctx;

    // dimensions (contract §3)
    this.radius = 0.35;
    this.standHeight = 1.8;
    this.crouchHeight = 1.0;
    this.height = this.standHeight; // current capsule height

    // kinematic state (position = feet)
    this.position = new THREE.Vector3(0, 0, 9);
    this.prevPosition = new THREE.Vector3(0, 0, 9);
    this.velocity = new THREE.Vector3();

    // contact state
    this.crouched = false;
    this.grounded = false;
    this.groundNormal = new THREE.Vector3(0, 1, 0);

    // collider refs Movement reads (§5.B "expose the current collider")
    this.groundCollider = null; // collider we're standing on (null in air)
    this.wallCollider = null;   // most-recent wall from probeWall (touch info)
    this.wallInfo = { collider: null, nx: 0, nz: 0, wallrun: false };

    // collision engine (we own Collision.js)
    this.collision = new CollisionWorld(ctx);

    this._spawned = false;
    this._tmpV = new THREE.Vector3();
  }

  // ---- public API (contract §5.B) ------------------------------------------

  horizontalSpeed() {
    const v = this.velocity;
    return Math.hypot(v.x, v.z);
  }

  // ---- lifecycle helpers Movement drives -----------------------------------

  /** Read the spawn transform once, the first time we run. */
  _ensureSpawn() {
    if (this._spawned) return;
    const range = this.ctx.world?.range;
    if (range && range.spawnPoint) {
      this.position.copy(range.spawnPoint);
      this.prevPosition.copy(range.spawnPoint);
      this.velocity.set(0, 0, 0);
    }
    this._spawned = true;
  }

  /** Copy position INTO prevPosition. Movement calls this at the START of its
   *  fixedUpdate so render interpolation is exact. */
  beginTick() {
    this._ensureSpawn();
    this.prevPosition.copy(this.position);
  }

  /** Integrate the current velocity and resolve against the world for dt.
   *  Updates grounded / groundNormal / groundCollider. `opts.snap` glues the
   *  player to the floor going downhill (disable while airborne/jumping). */
  move(dt, opts = {}) {
    const res = this.collision.moveCapsule(
      this.position, this.velocity, dt, this.radius, this.height,
      { snap: opts.snap !== false },
    );
    this.grounded = res.grounded;
    this.groundNormal.copy(res.groundNormal);
    this.groundCollider = res.groundCollider;
    return res;
  }

  /** The contacts from the last move() (for wall detection while sliding along). */
  get contacts() {
    return this.collision.contacts;
  }

  /** Set the capsule height, keeping the FEET planted (capsule grows/shrinks
   *  from the top). Used for crouch/slide/stand and air-crouch. */
  setHeight(h) {
    this.height = h;
    this.crouched = h < this.standHeight - 1e-3;
  }

  /** Would a stand-height capsule fit here (no ceiling)? Uses an overlap probe. */
  canStandUp() {
    // probe at feet with the full standing capsule
    return !this.collision.overlaps(this.position, this.radius, this.standHeight);
  }

  /** Probe sideways for a wall. Returns wallInfo ({collider,nx,nz,wallrun}) or
   *  null, and caches it on this.wallCollider / this.wallInfo. */
  probeWall(dirX, dirZ, dist = 0.08) {
    const out = this.collision.probeWall(
      this.position, dirX, dirZ, dist, this.radius, this.height, this.wallInfo,
    );
    if (out) {
      this.wallCollider = out.collider;
      return out;
    }
    return null;
  }

  /** Does the capsule currently overlap anything (skin-tolerance)? */
  overlapsNow() {
    return this.collision.overlaps(this.position, this.radius, this.height);
  }
}
