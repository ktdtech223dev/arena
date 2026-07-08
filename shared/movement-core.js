// ARENA — shared/movement-core.js
// THE shared kinematic core. Pure, deterministic, THREE-free, side-effect-free.
// Run IDENTICALLY on the browser client (prediction) and the headless Node
// server (authority). Same input stream + start state => same output, always.
// No Math.random, no Date.now, no imports beyond shared/constants.js.
//
// Physics = RANGE's full kit: ground accel+friction, source air-strafe, slide
// (+slope +hop +steer +cap), wall-run (+roll +speed build), wall-jump,
// coyote/buffer/variable jump, swept capsule-vs-AABB + ramp heightfields.
//
// Interface (BINDING, see ARENA-ARCHITECTURE.md §4):
//   createMoveState(spawn) -> state
//   stepMovement(state, input, world, dt) -> void   (one fixed step, in place)
//   serializeState(state) -> SnapPlayer-ish
//   applyAuthState(state, auth) -> void
import { MOVE as M, CAPSULE as CAP, BTN } from './constants.js';

const DEG = Math.PI / 180;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// ---------------------------------------------------------------------------
// state
// ---------------------------------------------------------------------------
export function createMoveState(spawn = {}) {
  const p = spawn.pos || { x: 0, y: 0, z: 0 };
  return {
    // kinematics (feet position)
    px: p.x, py: p.y, pz: p.z,
    vx: 0, vy: 0, vz: 0,
    // aim
    yaw: spawn.yaw || 0, pitch: 0,
    // fsm
    state: 'AIRBORNE', // GROUNDED | AIRBORNE | SLIDING | WALLRUN
    grounded: false,
    groundNy: 1, groundNx: 0, groundNz: 0,
    height: CAP.standHeight,
    crouched: false,
    // wall
    wallNx: 0, wallNz: 0, wallSide: 0,
    wallTimer: 0, wallEntrySpeed: 0, lastWallId: -1,
    // timers
    coyote: 0, jumpBuf: 0, slideCd: 0,
    jumpHeld: false, jumpCutDone: false, wallLeave: 999,
    // per-weapon speed multiplier (weight); 1 = full speed
    speedMult: 1,
    // scratch tangent
    _tx: 0, _tz: 0,
  };
}

export function serializeState(s) {
  return {
    pos: { x: s.px, y: s.py, z: s.pz },
    vel: { x: s.vx, y: s.vy, z: s.vz },
    yaw: s.yaw, pitch: s.pitch,
    state: s.state, ground: s.grounded,
  };
}

export function applyAuthState(s, a) {
  s.px = a.pos.x; s.py = a.pos.y; s.pz = a.pos.z;
  s.vx = a.vel.x; s.vy = a.vel.y; s.vz = a.vel.z;
  s.state = a.state; s.grounded = a.ground;
  // yaw/pitch stay client-owned (aim is local); server echoes them but the
  // local client is authoritative over its own look.
}

export function horizontalSpeed(s) { return Math.hypot(s.vx, s.vz); }

// ---------------------------------------------------------------------------
// main step
// ---------------------------------------------------------------------------
export function stepMovement(s, input, world, dt) {
  // ---- decode input ----
  const btn = input.buttons | 0;
  const jump = !!(btn & BTN.JUMP);
  const crouch = !!(btn & BTN.CROUCH);
  const sprint = !!(btn & BTN.SPRINT);
  s.yaw = input.look.yaw;
  s.pitch = clamp(input.look.pitch, -89, 89);
  s.speedMult = input.speedMult != null ? input.speedMult : (s.speedMult || 1);

  // jump buffer (rising edge tracked by caller via seq; here we buffer on hold-
  // edge using jumpHeld to detect press)
  if (jump && !s.jumpHeld) s.jumpBuf = M.jumpBuffer;
  else s.jumpBuf = Math.max(0, s.jumpBuf - dt);

  s.coyote = Math.max(0, s.coyote - dt);
  s.slideCd = Math.max(0, s.slideCd - dt);
  s.wallLeave += dt;

  // wish direction from yaw (yaw 0 faces -Z)
  const fx = -Math.sin(s.yaw * DEG), fz = -Math.cos(s.yaw * DEG); // forward XZ
  const rx = Math.cos(s.yaw * DEG), rz = -Math.sin(s.yaw * DEG);  // right XZ
  const f = clamp(input.move.f, -1, 1), r = clamp(input.move.r, -1, 1);
  let wx = fx * f + rx * r, wz = fz * f + rz * r;
  const wl = Math.hypot(wx, wz);
  if (wl > 1e-5) { wx /= wl; wz /= wl; } else { wx = 0; wz = 0; }
  const wish = wl > 1e-5;

  switch (s.state) {
    case 'GROUNDED': tickGrounded(s, world, dt, wx, wz, wish, crouch, sprint, jump); break;
    case 'AIRBORNE': tickAir(s, world, dt, wx, wz, wish, crouch, jump); break;
    case 'SLIDING': tickSlide(s, world, dt, wx, wz, wish, crouch, jump); break;
    case 'WALLRUN': tickWall(s, world, dt, wx, wz, wish, jump); break;
    default: s.state = 'AIRBORNE';
  }

  s.jumpHeld = jump;
}

// ---------------------------------------------------------------------------
// states
// ---------------------------------------------------------------------------
function tickGrounded(s, world, dt, wx, wz, wish, crouch, sprint, jump) {
  const speed = horizontalSpeed(s);

  // slide entry
  if (crouch && speed >= M.slideMinSpeed + 1 && s.slideCd <= 0) { enterSlide(s); tickSlide(s, world, dt, wx, wz, wish, crouch, jump); return; }

  // jump
  if (s.jumpBuf > 0 && jump) { doJump(s, false); s.state = 'AIRBORNE'; tickAir(s, world, dt, wx, wz, wish, crouch, jump); return; }

  applyGravity(s, 1, dt); // keeps us glued via snap-down in collide
  const maxS = (sprint ? M.sprintSpeed : M.maxSpeed) * (s.speedMult || 1);
  if (wish) accelerate(s, wx, wz, maxS, M.groundAccel, dt);
  else applyFriction(s, M.groundFriction, dt);

  s.crouched = crouch;
  s.height = crouch ? CAP.crouchHeight : CAP.standHeight;
  collide(s, world, dt);

  if (!s.grounded) { s.coyote = M.coyoteTime; s.state = 'AIRBORNE'; }
}

function tickAir(s, world, dt, wx, wz, wish, crouch, jump) {
  // coyote jump
  if (s.jumpBuf > 0 && jump && s.coyote > 0) { doJump(s, false); s.coyote = 0; }
  // variable jump height: released before apex -> cut once
  if (!jump && !s.jumpCutDone && s.vy > 0) { s.vy *= M.variableJumpCut; s.jumpCutDone = true; }

  applyGravity(s, 1, dt);
  if (wish) airAccelerate(s, wx, wz, M.airWishSpeed, M.airAccel, dt);
  applyAirControl(s, wx, wz, wish, dt);

  s.crouched = crouch;
  s.height = crouch ? CAP.crouchHeight : CAP.standHeight;

  // wall-run attach attempt
  if (tryWallAttach(s, world, wx, wz, wish)) { tickWall(s, world, dt, wx, wz, wish, jump); return; }

  collide(s, world, dt);

  if (s.grounded) {
    onLand(s, crouch);
  }
}

function tickSlide(s, world, dt, wx, wz, wish, crouch, jump) {
  // slide-hop
  if (s.jumpBuf > 0 && jump) { doJump(s, true); exitSlide(s); s.slideCd = 0; s.state = 'AIRBORNE'; tickAir(s, world, dt, wx, wz, wish, crouch, jump); return; }

  applyGravity(s, 1, dt);

  // downhill acceleration: gravity projected along the slope tangent
  if (s.grounded && s.groundNy < 0.999) {
    const gx = -s.groundNx * s.groundNy, gz = -s.groundNz * s.groundNy; // tangent dir of steepest descent (approx)
    const gmag = M.gravity * Math.hypot(s.groundNx, s.groundNz);
    const dl = Math.hypot(gx, gz) || 1;
    s.vx += (gx / dl) * gmag * dt;
    s.vz += (gz / dl) * gmag * dt;
  }

  applyFriction(s, M.slideFriction, dt);
  if (wish) slideSteer(s, wx, wz, dt);
  clampHorizontal(s, M.slideMaxSpeed);

  s.crouched = true;
  s.height = CAP.crouchHeight;
  collide(s, world, dt);

  // exit conditions
  if (!s.grounded) { s.state = 'AIRBORNE'; return; }
  if (!crouch || horizontalSpeed(s) < M.slideMinSpeed) { exitSlide(s); s.state = 'GROUNDED'; }
}

function tickWall(s, world, dt, wx, wz, wish, jump) {
  s.wallTimer += dt;

  // walljump
  if (s.jumpBuf > 0 && jump) { doWallJump(s); s.state = 'AIRBORNE'; return; }

  // reduced gravity ramping up
  const frac = Math.min(1, s.wallTimer / M.wallMaxDuration);
  const gFrac = M.wallGravityStart + (M.wallGravityEnd - M.wallGravityStart) * frac;
  applyGravity(s, gFrac, dt);

  // tangent locked to travel direction (never flips on look)
  computeWallTangent(s);
  const target = Math.max(s.wallEntrySpeed, M.wallMinSpeed) + M.wallSpeedBoost;
  const along = s.vx * s._tx + s.vz * s._tz;
  if (along < target) {
    const add = Math.min(M.wallAccel * dt, target - along);
    s.vx += s._tx * add; s.vz += s._tz * add;
  }
  // stick into wall
  s.vx -= s.wallNx * M.wallStickForce * dt;
  s.vz -= s.wallNz * M.wallStickForce * dt;

  s.crouched = false;
  s.height = CAP.standHeight;
  collide(s, world, dt);

  // exits: duration / facing away / landing / lost wall
  const fwdx = -Math.sin(s.yaw * DEG), fwdz = -Math.cos(s.yaw * DEG);
  const facing = fwdx * s._tx + fwdz * s._tz;
  const steerOff = wish && (wx * s.wallNx + wz * s.wallNz) > 0.5;
  if (s.wallTimer >= M.wallMaxDuration || facing < -0.1 || steerOff || s.grounded || !wallStillThere(s, world)) {
    exitWall(s);
    s.state = s.grounded ? 'GROUNDED' : 'AIRBORNE';
  }
}

// ---------------------------------------------------------------------------
// primitives
// ---------------------------------------------------------------------------
function applyGravity(s, frac, dt) {
  s.vy -= M.gravity * frac * dt;
  if (s.vy < -M.terminal) s.vy = -M.terminal;
}
function applyFriction(s, fr, dt) {
  const sp = Math.hypot(s.vx, s.vz);
  if (sp < 1e-4) return;
  const ctrl = sp < M.stopSpeed ? M.stopSpeed : sp;
  let ns = sp - ctrl * fr * dt;
  if (ns < 0) ns = 0;
  const k = ns / sp; s.vx *= k; s.vz *= k;
}
function accelerate(s, wx, wz, wishSpeed, accel, dt) {
  const cur = s.vx * wx + s.vz * wz;
  const add = wishSpeed - cur;
  if (add <= 0) return;
  let a = accel * wishSpeed * dt;
  if (a > add) a = add;
  s.vx += wx * a; s.vz += wz * a;
}
function airAccelerate(s, wx, wz, wishSpeed, accel, dt) {
  const cur = s.vx * wx + s.vz * wz;
  const add = wishSpeed - cur;
  if (add <= 0) return;
  let a = accel * wishSpeed * dt;
  if (a > add) a = add;
  s.vx += wx * a; s.vz += wz * a;
}
function applyAirControl(s, wx, wz, wish, dt) {
  if (!wish) { // light air friction only when not steering
    const sp = Math.hypot(s.vx, s.vz);
    if (sp > 1e-4) { const k = Math.max(0, 1 - M.airFriction * dt); s.vx *= k; s.vz *= k; }
    return;
  }
  // extra steering accel toward wish, capped (source-style)
  const cur = s.vx * wx + s.vz * wz;
  const sp = Math.hypot(s.vx, s.vz);
  const cap = Math.max(sp, M.maxSpeed);
  const add = cap - cur;
  if (add <= 0) return;
  let a = M.airControl * dt;
  if (a > add) a = add;
  s.vx += wx * a; s.vz += wz * a;
}
function doJump(s, preserveHorizontal) {
  s.vy = M.jumpForce;
  s.grounded = false;
  s.jumpBuf = 0;
  s.jumpCutDone = false;
  if (!preserveHorizontal) { /* keep momentum anyway */ }
}
function enterSlide(s) {
  const sp = Math.hypot(s.vx, s.vz);
  if (sp < M.slideBoostSpeedCap) {
    const k = sp > 1e-4 ? (sp + M.slideBoost) / sp : 1;
    s.vx *= k; s.vz *= k;
  }
  s.slideCd = M.slideCooldown;
  s.state = 'SLIDING';
}
function exitSlide(s) { /* nothing special; momentum carries */ }
function slideSteer(s, wx, wz, dt) {
  // rotate velocity toward wish, preserving magnitude (redirect w/o adding energy)
  const sp = Math.hypot(s.vx, s.vz);
  if (sp < 1e-4) return;
  let vx = s.vx / sp, vz = s.vz / sp;
  const t = Math.min(1, M.slideSteerRate * dt);
  vx += (wx - vx) * t; vz += (wz - vz) * t;
  const nl = Math.hypot(vx, vz) || 1;
  s.vx = (vx / nl) * sp; s.vz = (vz / nl) * sp;
}
function clampHorizontal(s, max) {
  const sp = Math.hypot(s.vx, s.vz);
  if (sp > max) { const k = max / sp; s.vx *= k; s.vz *= k; }
}
function onLand(s, crouch) {
  s.jumpCutDone = false;
  if (crouch && horizontalSpeed(s) >= M.slideMinSpeed + 1 && s.slideCd <= 0) { enterSlide(s); return; }
  s.state = 'GROUNDED';
}

// wall-run helpers
function tryWallAttach(s, world, wx, wz, wish) {
  const sp = horizontalSpeed(s);
  if (sp < M.wallMinSpeed) return false;
  // probe left & right of travel for a wallrun wall
  const rx = Math.cos(s.yaw * DEG), rz = -Math.sin(s.yaw * DEG);
  for (const side of [1, -1]) {
    const dirx = rx * side, dirz = rz * side;
    const hit = probeWall(s, world, dirx, dirz, CAP.radius + 0.25);
    if (hit && hit.wallrun && hit.id !== s.lastWallId) {
      s.wallNx = hit.nx; s.wallNz = hit.nz;
      // must be moving along the wall & facing forward
      s._tx = 0; s._tz = 0; s.wallSide = side;
      enterWall(s, hit, side);
      // validate along-wall speed
      computeWallTangent(s);
      const velAlong = s.vx * s._tx + s.vz * s._tz;
      const fwdx = -Math.sin(s.yaw * DEG), fwdz = -Math.cos(s.yaw * DEG);
      const faceAlong = fwdx * s._tx + fwdz * s._tz;
      if (velAlong < M.wallMinSpeed * 0.5 || faceAlong < M.wallAttachDot) { s.lastWallId = -1; s.state = 'AIRBORNE'; return false; }
      return true;
    }
  }
  return false;
}
function enterWall(s, hit, side) {
  s.state = 'WALLRUN';
  s.wallTimer = 0;
  s.lastWallId = hit.id;
  s.wallNx = hit.nx; s.wallNz = hit.nz; s.wallSide = side;
  // kill into/out-of wall velocity
  const into = s.vx * s.wallNx + s.vz * s.wallNz;
  s.vx -= s.wallNx * into; s.vz -= s.wallNz * into;
  if (s.vy < 0) s.vy = M.wallUpBoost;
  s.wallEntrySpeed = horizontalSpeed(s);
}
function exitWall(s) { s.wallLeave = 0; s.wallSide = 0; }
function computeWallTangent(s) {
  const ax = s.wallNz, az = -s.wallNx;
  const velDot = s.vx * ax + s.vz * az;
  let dot = velDot;
  if (Math.abs(velDot) < 1e-3) { const fx = -Math.sin(s.yaw * DEG), fz = -Math.cos(s.yaw * DEG); dot = fx * ax + fz * az; }
  if (dot >= 0) { s._tx = ax; s._tz = az; } else { s._tx = -ax; s._tz = -az; }
  const l = Math.hypot(s._tx, s._tz) || 1; s._tx /= l; s._tz /= l;
}
function doWallJump(s) {
  s.vx += s.wallNx * M.wallJumpAway;
  s.vz += s.wallNz * M.wallJumpAway;
  s.vy = M.wallJumpUp;
  s.jumpBuf = 0; s.jumpCutDone = false;
  exitWall(s);
}
function wallStillThere(s, world) {
  const hit = probeWall(s, world, -s.wallNx, -s.wallNz, CAP.radius + 0.35);
  return hit && hit.wallrun && hit.id === s.lastWallId;
}

// ---------------------------------------------------------------------------
// collision — swept capsule (vertical cylinder radius r) vs AABBs + ramps.
// Per-axis resolution (X, Z, then Y) for determinism/stability. Minkowski:
// expand each AABB by r in XZ and treat the player as a point in XZ.
// ---------------------------------------------------------------------------
function collide(s, world, dt) {
  const r = CAP.radius, h = s.height;
  const aabbs = world.aabbs || [];
  const ramps = world.ramps || [];

  // integrate + resolve X
  s.px += s.vx * dt;
  resolveAxis(s, aabbs, r, h, 'x');
  // Z
  s.pz += s.vz * dt;
  resolveAxis(s, aabbs, r, h, 'z');
  // Y (gravity/jump) + floor/ceiling + ramps
  s.py += s.vy * dt;
  resolveVertical(s, aabbs, ramps, r, h);
}

function overlapsXZ(s, b, r) {
  return s.px > b.min.x - r && s.px < b.max.x + r && s.pz > b.min.z - r && s.pz < b.max.z + r;
}
function overlapsY(s, b, h) {
  // capsule vertical span [feet, feet+h] vs box [min.y, max.y]
  return s.py + h > b.min.y + 1e-4 && s.py < b.max.y - 1e-4;
}
function resolveAxis(s, aabbs, r, h, axis) {
  for (const b of aabbs) {
    if (!overlapsY(s, b, h)) continue;
    if (!overlapsXZ(s, b, r)) continue;
    if (axis === 'x') {
      // push out along X to nearest face
      const toLeft = (b.min.x - r) - s.px;   // negative
      const toRight = (b.max.x + r) - s.px;  // positive
      if (Math.abs(toLeft) < Math.abs(toRight)) { s.px = b.min.x - r; } else { s.px = b.max.x + r; }
      if ((s.vx < 0 && s.px >= b.max.x) || (s.vx > 0 && s.px <= b.min.x)) s.vx = 0;
      else s.vx = 0;
      // wall normal for wall-run probing handled separately
    } else {
      const toBack = (b.min.z - r) - s.pz;
      const toFront = (b.max.z + r) - s.pz;
      if (Math.abs(toBack) < Math.abs(toFront)) { s.pz = b.min.z - r; } else { s.pz = b.max.z + r; }
      s.vz = 0;
    }
  }
}
function resolveVertical(s, aabbs, ramps, r, h) {
  s.grounded = false; s.groundNx = 0; s.groundNy = 1; s.groundNz = 0;
  const snap = 0.12;

  // ramp heightfields first (floor)
  let floorY = -Infinity, floorNx = 0, floorNy = 1, floorNz = 0;
  for (const rp of ramps) {
    if (s.px < rp.min.x - r || s.px > rp.max.x + r || s.pz < rp.min.z - r || s.pz > rp.max.z + r) continue;
    const ax = rp.axis;
    const t = ax === 'x'
      ? clamp((s.px - rp.min.x) / (rp.max.x - rp.min.x), 0, 1)
      : clamp((s.pz - rp.min.z) / (rp.max.z - rp.min.z), 0, 1);
    const top = rp.h0 + (rp.h1 - rp.h0) * t;
    if (top > floorY) {
      floorY = top;
      // slope normal
      const dh = (rp.h1 - rp.h0);
      const len = ax === 'x' ? (rp.max.x - rp.min.x) : (rp.max.z - rp.min.z);
      const slope = dh / (len || 1);
      const nl = Math.hypot(slope, 1) || 1;
      if (ax === 'x') { floorNx = -slope / nl; floorNy = 1 / nl; floorNz = 0; }
      else { floorNx = 0; floorNy = 1 / nl; floorNz = -slope / nl; }
    }
  }
  // box tops
  for (const b of aabbs) {
    if (s.px <= b.min.x - r || s.px >= b.max.x + r || s.pz <= b.min.z - r || s.pz >= b.max.z + r) continue;
    if (b.max.y > floorY && s.py >= b.max.y - snap && s.vy <= 0.01) {
      floorY = b.max.y; floorNx = 0; floorNy = 1; floorNz = 0;
    }
    // ceiling
    if (s.vy > 0 && s.py + h > b.min.y && s.py < b.min.y && s.px > b.min.x - r && s.px < b.max.x + r && s.pz > b.min.z - r && s.pz < b.max.z + r) {
      s.py = b.min.y - h; s.vy = 0;
    }
  }

  if (floorY > -Infinity && s.py <= floorY + snap && s.vy <= 0.01) {
    s.py = floorY;
    s.vy = 0;
    s.grounded = true;
    s.groundNx = floorNx; s.groundNy = floorNy; s.groundNz = floorNz;
  }
}

// probe for a wall in a horizontal direction; returns {nx,nz,wallrun,id} or null
function probeWall(s, world, dx, dz, dist) {
  const r = CAP.radius, h = s.height;
  const px = s.px + dx * dist, pz = s.pz + dz * dist;
  let best = null, bestPen = Infinity;
  const aabbs = world.aabbs || [];
  for (let i = 0; i < aabbs.length; i++) {
    const b = aabbs[i];
    if (!(s.py + h > b.min.y + 1e-4 && s.py < b.max.y - 1e-4)) continue;
    if (px <= b.min.x - r || px >= b.max.x + r || pz <= b.min.z - r || pz >= b.max.z + r) continue;
    // which face is this wall (normal points back toward the player)
    const overL = (b.max.x + r) - px, overR = px - (b.min.x - r);
    const overB = (b.max.z + r) - pz, overF = pz - (b.min.z - r);
    const mx = Math.min(overL, overR), mz = Math.min(overB, overF);
    let nx = 0, nz = 0, pen;
    if (mx < mz) { nx = px < (b.min.x + b.max.x) / 2 ? -1 : 1; pen = mx; }
    else { nz = pz < (b.min.z + b.max.z) / 2 ? -1 : 1; pen = mz; }
    if (pen < bestPen) { bestPen = pen; best = { nx, nz, wallrun: !!b.wallrun, id: i }; }
  }
  return best;
}
