// world/Colliders.js — static collision registry (contract §4).
// Dead simple on purpose: the player agent consumes these arrays directly.
//
//   colliders.aabbs : [{ min: V3, max: V3, wallrun: bool, surface: string }]
//   colliders.ramps : [{ min: V3, max: V3, axis: 'x'|'z', h0, h1, surface }]
//
// A ramp is a floor whose top surface height lerps from h0 (at min[axis])
// to h1 (at max[axis]) across the AABB footprint.
import * as THREE from 'three';

function toV3(v) {
  return v && v.isVector3 ? v : new THREE.Vector3(v.x, v.y, v.z);
}

export class Colliders {
  constructor(ctx) {
    this.ctx = ctx;
    this.aabbs = [];
    this.ramps = [];
  }

  /** Register a world-space axis-aligned solid box. Returns the record. */
  addBox(min, max, opts = {}) {
    const a = toV3(min);
    const b = toV3(max);
    const box = {
      min: new THREE.Vector3(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.min(a.z, b.z)),
      max: new THREE.Vector3(Math.max(a.x, b.x), Math.max(a.y, b.y), Math.max(a.z, b.z)),
      wallrun: !!opts.wallrun,
      surface: opts.surface || 'concrete',
    };
    this.aabbs.push(box);
    return box;
  }

  /**
   * Register a ramp (heightfield floor). Top height lerps from h0 at
   * min[axis] to h1 at max[axis] across the footprint.
   */
  addRamp(min, max, axis, h0, h1, opts = {}) {
    const a = toV3(min);
    const b = toV3(max);
    const ramp = {
      min: new THREE.Vector3(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.min(a.z, b.z)),
      max: new THREE.Vector3(Math.max(a.x, b.x), Math.max(a.y, b.y), Math.max(a.z, b.z)),
      axis: axis === 'x' ? 'x' : 'z',
      h0,
      h1,
      surface: opts.surface || 'concrete',
    };
    this.ramps.push(ramp);
    return ramp;
  }

  clear() {
    this.aabbs.length = 0;
    this.ramps.length = 0;
  }
}
