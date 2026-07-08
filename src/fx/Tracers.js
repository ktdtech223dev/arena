// RANGE — fx/Tracers.js
// Fast light-streaks for every shot. Listens `shot:tracer { from, to, def }`.
// A tracer is a thin stretched additive box oriented from->to that travels
// its length at ~600 m/s (visual speed, tunable), with a fade as the tail
// exits the impact point. Pool of 32, oldest stolen when full.
import * as THREE from 'three';

const POOL = 32;
const _Z = new THREE.Vector3(0, 0, 1);

export class Tracers {
  constructor(ctx) {
    this.ctx = ctx;

    this.params = {
      speed: 600,      // m/s visual travel speed
      length: 5,       // m streak length
      widthMult: 1.0,  // multiplies def.tracer.width
      opacity: 0.85,
      minDist: 2,      // skip tracers shorter than this
    };

    const T = (key, prop, min, max, step, label) =>
      ctx.tunables.push({ cat: 'fx', key, obj: this.params, prop, min, max, step, label });
    T('tracerSpeed', 'speed', 100, 2000, 10, 'Tracer speed (m/s)');
    T('tracerLength', 'length', 0.5, 15, 0.1, 'Tracer length (m)');
    T('tracerWidthMult', 'widthMult', 0.2, 4, 0.05, 'Tracer width ×');
    T('tracerOpacity', 'opacity', 0, 1, 0.01, 'Tracer opacity');
    T('tracerMinDist', 'minDist', 0, 10, 0.25, 'Tracer min distance (m)');

    // Shared unit box, per-slot material (color/opacity vary per tracer).
    this.geo = new THREE.BoxGeometry(1, 1, 1);
    this.pool = [];
    for (let i = 0; i < POOL; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffd9a0,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
        fog: false,
      });
      const mesh = new THREE.Mesh(this.geo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false; // fast movers; skip per-frame bounds work
      mesh.renderOrder = 9;
      ctx.scene.add(mesh);
      this.pool.push({
        mesh,
        active: false,
        from: new THREE.Vector3(),
        dir: new THREE.Vector3(),
        dist: 0,
        head: 0, // meters the leading edge has travelled
        width: 0.02,
      });
    }

    ctx.events.on('shot:tracer', (d) => this._spawn(d));
  }

  _spawn({ from, to, def } = {}) {
    if (!from || !to) return;
    const dist = from.distanceTo(to);
    if (dist < this.params.minDist || dist < 1e-4) return;

    // Free slot, else steal the most-finished one.
    let slot = null;
    let bestProgress = -1;
    for (const s of this.pool) {
      if (!s.active) { slot = s; break; }
      const p = s.head / Math.max(0.001, s.dist);
      if (p > bestProgress) { bestProgress = p; slot = s; }
    }

    slot.active = true;
    slot.from.copy(from);
    slot.dir.copy(to).sub(from).divideScalar(dist);
    slot.dist = dist;
    slot.head = 0;
    slot.width = (def?.tracer?.width ?? 0.02) * this.params.widthMult;
    slot.mesh.material.color.set(def?.tracer?.color ?? 0xffd9a0);
    slot.mesh.material.opacity = 0;
    slot.mesh.quaternion.setFromUnitVectors(_Z, slot.dir);
    slot.mesh.visible = false; // becomes visible once it has any length
  }

  render(dt) {
    const spd = this.params.speed;
    const len = this.params.length;
    const baseOp = this.params.opacity;

    for (const s of this.pool) {
      if (!s.active) continue;
      s.head += spd * dt;
      const tail = s.head - len;
      if (tail >= s.dist) {
        s.active = false;
        s.mesh.visible = false;
        continue;
      }
      const a = Math.max(0, tail);
      const b = Math.min(s.dist, s.head);
      const seg = b - a;
      if (seg <= 0.001) {
        s.mesh.visible = false;
        continue;
      }
      const m = s.mesh;
      m.visible = true;
      m.position.copy(s.from).addScaledVector(s.dir, (a + b) * 0.5);
      m.scale.set(s.width, s.width, seg);

      // Full brightness while flying; fade tail out after the head arrives.
      let op = baseOp;
      if (s.head > s.dist) op *= Math.max(0, 1 - (s.head - s.dist) / len);
      m.material.opacity = op;
    }
  }
}
