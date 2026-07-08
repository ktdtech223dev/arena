// RANGE — player collision helpers (internal to the player agent).
//
// Kinematic capsule vs the static world:
//   - capsule is vertical; `pos` = FEET (bottom of the capsule)
//   - AABBs from ctx.world.colliders.aabbs  ({ min, max, wallrun?, surface? })
//   - ramps from ctx.world.colliders.ramps  ({ min, max, axis, h0, h1 }) —
//     heightfield floors whose top surface lerps h0 -> h1 along `axis`;
//     the slope normal is derived analytically.
//
// Strategy: substepped move (substep length < half a radius, so no tunneling
// at 120 Hz even at high speed) + iterative deepest-first penetration
// resolution with velocity clipping (slide along surfaces). Ground contact is
// any normal with n.y >= groundNy; a small snap-down keeps the player glued
// going downhill.
import * as THREE from 'three';

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

export class CollisionWorld {
  constructor(ctx) {
    this.ctx = ctx;
    this.p = {
      snapDist: 0.12,   // ground snap-down tolerance (m)
      climbLimit: 0.85, // max ramp surface step treated as walkable floor (m)
      groundNy: 0.55,   // min contact normal.y that counts as ground
    };
    this.contacts = [];        // last moveCapsule contacts: { nx, ny, nz, collider }
    this._tmp = { pux: 0, puy: 0, puz: 0, nx: 0, ny: 0, nz: 0, depth: 0 };
    this._best = { pux: 0, puy: 0, puz: 0, nx: 0, ny: 0, nz: 0, depth: 0 };
    this._snapPos = new THREE.Vector3();
    this._snapContacts = [];
    this._probePos = new THREE.Vector3();
    this._standPos = new THREE.Vector3();
    this._res = {
      grounded: false,
      groundNormal: new THREE.Vector3(0, 1, 0),
      groundCollider: null,
      contacts: this.contacts,
    };
  }

  _aabbs() { return this.ctx.world?.colliders?.aabbs || []; }
  _ramps() { return this.ctx.world?.colliders?.ramps || []; }

  // ---- primitive tests ------------------------------------------------------
  // All tests fill `out` = { pux,puy,puz (unit push dir), nx,ny,nz (surface
  // normal), depth } and return true when penetrating.

  _testAabb(pos, r, h, box, out) {
    const min = box.min, max = box.max;
    const x = pos.x, z = pos.z;
    const y0 = pos.y + r;                       // bottom sphere center
    const y1 = pos.y + Math.max(h - r, r);      // top sphere center
    const qx = clamp(x, min.x, max.x);
    const qz = clamp(z, min.z, max.z);
    const dx = x - qx, dz = z - qz;

    if (y1 >= min.y && y0 <= max.y) {
      // capsule axis overlaps the box vertically
      if (dx === 0 && dz === 0) {
        // axis passes through the box — deep; pick the cheapest face pushout
        let depth = max.y - pos.y, px = 0, py = 1, pz = 0;   // up (feet to top)
        const dDown = (pos.y + h) - min.y;
        if (dDown < depth) { depth = dDown; px = 0; py = -1; pz = 0; }
        const dXp = (max.x - x) + r;
        if (dXp < depth) { depth = dXp; px = 1; py = 0; pz = 0; }
        const dXn = (x - min.x) + r;
        if (dXn < depth) { depth = dXn; px = -1; py = 0; pz = 0; }
        const dZp = (max.z - z) + r;
        if (dZp < depth) { depth = dZp; px = 0; py = 0; pz = 1; }
        const dZn = (z - min.z) + r;
        if (dZn < depth) { depth = dZn; px = 0; py = 0; pz = -1; }
        if (depth <= 0) return false;
        out.depth = depth;
        out.pux = px; out.puy = py; out.puz = pz;
        out.nx = px; out.ny = py; out.nz = pz;
        return true;
      }
      // side / edge: purely horizontal separation
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) return false;
      const d = Math.sqrt(d2) || 1e-9;
      out.depth = r - d;
      out.pux = dx / d; out.puy = 0; out.puz = dz / d;
      out.nx = out.pux; out.ny = 0; out.nz = out.puz;
      return true;
    }

    // end caps vs box top/bottom (also handles rounded edges)
    const below = y1 < min.y;                    // capsule fully under the box
    const sy = below ? y1 : y0;
    const qy = below ? min.y : max.y;
    const dy = sy - qy;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 >= r * r) return false;
    const d = Math.sqrt(d2);
    if (d < 1e-9) {
      out.depth = r;
      out.pux = 0; out.puy = below ? -1 : 1; out.puz = 0;
    } else {
      out.depth = r - d;
      out.pux = dx / d; out.puy = dy / d; out.puz = dz / d;
    }
    out.nx = out.pux; out.ny = out.puy; out.nz = out.puz;
    return true;
  }

  _testRamp(pos, r, h, ramp, out) {
    const min = ramp.min, max = ramp.max;
    const x = pos.x, z = pos.z;
    const qx = clamp(x, min.x, max.x);
    const qz = clamp(z, min.z, max.z);
    const dx = x - qx, dz = z - qz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= r * r) return false;
    if (pos.y + h <= min.y) return false;       // entirely below the wedge

    const axisX = ramp.axis === 'x';
    const a0 = axisX ? min.x : min.z;
    const a1 = axisX ? max.x : max.z;
    const span = Math.max(a1 - a0, 1e-6);
    const t = clamp(((axisX ? qx : qz) - a0) / span, 0, 1);
    const topY = ramp.h0 + (ramp.h1 - ramp.h0) * t;
    const pen = topY - pos.y;
    if (pen <= 0) return false;

    const floorLike = pen <= this.p.climbLimit && (d2 === 0 || pen <= r);
    if (floorLike) {
      // heightfield floor: push straight up, physics normal = slope normal
      const slope = (ramp.h1 - ramp.h0) / span;
      const inv = 1 / Math.hypot(slope, 1);
      out.depth = pen;
      out.pux = 0; out.puy = 1; out.puz = 0;
      out.nx = axisX ? -slope * inv : 0;
      out.ny = inv;
      out.nz = axisX ? 0 : -slope * inv;
      return true;
    }

    // hit the tall side — treat as a wall
    if (d2 > 0) {
      const d = Math.sqrt(d2);
      out.depth = r - d;
      out.pux = dx / d; out.puy = 0; out.puz = dz / d;
      out.nx = out.pux; out.ny = 0; out.nz = out.puz;
      return out.depth > 0;
    }
    let depth = (max.x - x) + r, px = 1, pz = 0;
    const dXn = (x - min.x) + r;
    if (dXn < depth) { depth = dXn; px = -1; pz = 0; }
    const dZp = (max.z - z) + r;
    if (dZp < depth) { depth = dZp; px = 0; pz = 1; }
    const dZn = (z - min.z) + r;
    if (dZn < depth) { depth = dZn; px = 0; pz = -1; }
    if (depth <= 0) return false;
    out.depth = depth;
    out.pux = px; out.puy = 0; out.puz = pz;
    out.nx = px; out.ny = 0; out.nz = pz;
    return true;
  }

  // ---- resolution -----------------------------------------------------------

  /** Iteratively push the capsule out of every overlap (deepest first).
   *  Clips `vel` (if given) along each contact so we slide, never bounce.
   *  Appends { nx, ny, nz, collider } records to contactsOut. */
  resolve(pos, vel, r, h, contactsOut) {
    const t = this._tmp, b = this._best;
    for (let iter = 0; iter < 4; iter++) {
      let collider = null;
      let bestDepth = 1e-5;
      const aabbs = this._aabbs();
      for (let i = 0; i < aabbs.length; i++) {
        if (this._testAabb(pos, r, h, aabbs[i], t) && t.depth > bestDepth) {
          bestDepth = t.depth; collider = aabbs[i];
          b.pux = t.pux; b.puy = t.puy; b.puz = t.puz;
          b.nx = t.nx; b.ny = t.ny; b.nz = t.nz;
        }
      }
      const ramps = this._ramps();
      for (let i = 0; i < ramps.length; i++) {
        if (this._testRamp(pos, r, h, ramps[i], t) && t.depth > bestDepth) {
          bestDepth = t.depth; collider = ramps[i];
          b.pux = t.pux; b.puy = t.puy; b.puz = t.puz;
          b.nx = t.nx; b.ny = t.ny; b.nz = t.nz;
        }
      }
      if (!collider) break;

      pos.x += b.pux * bestDepth;
      pos.y += b.puy * bestDepth;
      pos.z += b.puz * bestDepth;
      if (vel) {
        const vn = vel.x * b.nx + vel.y * b.ny + vel.z * b.nz;
        if (vn < 0) {
          vel.x -= b.nx * vn;
          vel.y -= b.ny * vn;
          vel.z -= b.nz * vn;
        }
      }
      if (contactsOut) contactsOut.push({ nx: b.nx, ny: b.ny, nz: b.nz, collider });
    }
  }

  /** Substepped swept move. Mutates pos and vel. Returns a reused result
   *  object { grounded, groundNormal, groundCollider, contacts }. */
  moveCapsule(pos, vel, dt, r, h, opts = {}) {
    const contacts = this.contacts;
    contacts.length = 0;

    const dist = vel.length() * dt;
    let steps = Math.ceil(dist / Math.max(r * 0.5, 0.05));
    if (steps < 1) steps = 1;
    if (steps > 8) steps = 8;
    const sdt = dt / steps;
    for (let s = 0; s < steps; s++) {
      pos.x += vel.x * sdt;
      pos.y += vel.y * sdt;
      pos.z += vel.z * sdt;
      this.resolve(pos, vel, r, h, contacts);
    }

    const res = this._res;
    res.grounded = false;
    res.groundCollider = null;
    res.groundNormal.set(0, 1, 0);
    let bestNy = this.p.groundNy;
    for (let i = 0; i < contacts.length; i++) {
      const ct = contacts[i];
      if (ct.ny >= bestNy) {
        bestNy = ct.ny;
        res.grounded = true;
        res.groundNormal.set(ct.nx, ct.ny, ct.nz);
        res.groundCollider = ct.collider;
      }
    }

    // snap-down: keeps the player glued going downhill / over small crests
    if (!res.grounded && opts.snap && vel.y <= 0.5) {
      const sp = this._snapPos.copy(pos);
      sp.y -= this.p.snapDist;
      const list = this._snapContacts;
      list.length = 0;
      this.resolve(sp, null, r, h, list);
      let best = null;
      for (let i = 0; i < list.length; i++) {
        if (list[i].ny >= this.p.groundNy && (!best || list[i].ny > best.ny)) best = list[i];
      }
      if (best && sp.y <= pos.y + 1e-3) {
        pos.copy(sp);
        const vn = vel.x * best.nx + vel.y * best.ny + vel.z * best.nz;
        if (vn < 0) {
          vel.x -= best.nx * vn;
          vel.y -= best.ny * vn;
          vel.z -= best.nz * vn;
        }
        res.grounded = true;
        res.groundNormal.set(best.nx, best.ny, best.nz);
        res.groundCollider = best.collider;
      }
    }
    return res;
  }

  /** Does a capsule at pos overlap anything (beyond a small skin)? */
  overlaps(pos, r, h) {
    const t = this._tmp;
    const aabbs = this._aabbs();
    for (let i = 0; i < aabbs.length; i++) {
      if (this._testAabb(pos, r, h, aabbs[i], t) && t.depth > 0.02) return true;
    }
    const ramps = this._ramps();
    for (let i = 0; i < ramps.length; i++) {
      if (this._testRamp(pos, r, h, ramps[i], t) && t.depth > 0.02) return true;
    }
    return false;
  }

  /** Probe sideways for a wall: tests the capsule displaced by dir*dist and
   *  returns the deepest facing, near-vertical contact (AABBs only).
   *  out: { collider, nx, nz, wallrun } or null. */
  probeWall(pos, dirX, dirZ, dist, r, h, out) {
    const pp = this._probePos.set(pos.x + dirX * dist, pos.y, pos.z + dirZ * dist);
    const t = this._tmp;
    let collider = null, bestDepth = 0, nx = 0, nz = 0;
    const aabbs = this._aabbs();
    for (let i = 0; i < aabbs.length; i++) {
      if (!this._testAabb(pp, r, h, aabbs[i], t)) continue;
      if (Math.abs(t.ny) > 0.35) continue;                  // not a wall face
      if (t.nx * dirX + t.nz * dirZ > -0.4) continue;       // must oppose probe dir
      if (t.depth > bestDepth) {
        bestDepth = t.depth; collider = aabbs[i]; nx = t.nx; nz = t.nz;
      }
    }
    if (!collider) return null;
    const m = Math.hypot(nx, nz) || 1;
    out = out || {};
    out.collider = collider;
    out.nx = nx / m;
    out.nz = nz / m;
    out.wallrun = !!collider.wallrun;
    return out;
  }
}
