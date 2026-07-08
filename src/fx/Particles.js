// RANGE — fx/Particles.js
// ParticlePool: ONE pooled InstancedMesh of camera-facing quads for every
// spark, dust puff, and target pop in the game. CPU-simulated (cap 2048),
// additive soft round particles whose shape is a TSL radial falloff (no GLSL,
// no texture) so it runs identically on the WebGPU and WebGL2 backends.
//
// Why instanced quads and not THREE.Points: on the WebGPU backend Points
// always render at 1 px regardless of size. Quads scaled in world space give
// correct perspective size attenuation on both backends (see ARCHITECTURE.md §11).
//
// Billboarding is done on the CPU by writing a camera-facing instance matrix
// per particle each frame — we already walk every particle for the sim, so it
// is essentially free and avoids depending on any node-graph billboard detail.
//
// Public API (contract §5.F):
//   burst({ position, count, color, speed, spread, life, size, gravity })
// Optional extras (additive, ignored if omitted):
//   direction (V3) — bias the burst cone along this vector; `spread` (0..1+)
//   then controls how tight the cone is. drag — velocity damping per second.
import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { attribute, uv, vec2, smoothstep, pow } from 'three/tsl';

const MAX = 2048;

const _color = new THREE.Color();
const _mat = new THREE.Matrix4();

export class ParticlePool {
  constructor(ctx) {
    this.ctx = ctx;

    // Tunables (registered below, cat 'fx').
    this.params = {
      countMult: 1.0, // global burst-count multiplier
      sizeMult: 1.0,
      speedMult: 1.0,
      lifeMult: 1.0,
    };

    // ---- CPU-only per-particle state --------------------------------------
    this.pos = new Float32Array(MAX * 3);
    this.vel = new Float32Array(MAX * 3);
    this.baseColor = new Float32Array(MAX * 3); // pre-tinted rgb, before fade
    this.size = new Float32Array(MAX);          // world radius
    this.life = new Float32Array(MAX);
    this.maxLife = new Float32Array(MAX);
    this.grav = new Float32Array(MAX);
    this.drag = new Float32Array(MAX);
    this.alive = 0;

    // ---- instanced draw ----------------------------------------------------
    // Unit quad in XY; instance matrix carries camera-facing basis + size.
    const geo = new THREE.PlaneGeometry(1, 1);
    // Per-instance color (already multiplied by the fade factor each frame).
    this.aColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
    this.aColor.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aParticleColor', this.aColor);
    this.geo = geo;

    // Soft round additive particle, shaped entirely in TSL.
    const dist = uv().sub(vec2(0.5, 0.5)).length();     // 0 center → ~0.707 corner
    const shape = pow(smoothstep(0.5, 0.0, dist), 1.35); // soft disc, softer core
    this.material = new MeshBasicNodeMaterial();
    this.material.colorNode = attribute('aParticleColor', 'vec3').mul(shape);
    this.material.transparent = true;
    this.material.depthWrite = false;
    this.material.depthTest = true;
    this.material.blending = THREE.AdditiveBlending;
    this.material.toneMapped = false;

    this.mesh = new THREE.InstancedMesh(geo, this.material, MAX);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false; // particles scatter everywhere
    this.mesh.renderOrder = 10;
    ctx.scene.add(this.mesh);

    // ---- tunables ----------------------------------------------------------
    const T = (key, prop, min, max, step, label) =>
      ctx.tunables.push({ cat: 'fx', key, obj: this.params, prop, min, max, step, label });
    T('particleCountMult', 'countMult', 0, 3, 0.05, 'Particle count ×');
    T('particleSizeMult', 'sizeMult', 0.2, 3, 0.05, 'Particle size ×');
    T('particleSpeedMult', 'speedMult', 0.2, 3, 0.05, 'Particle speed ×');
    T('particleLifeMult', 'lifeMult', 0.2, 3, 0.05, 'Particle life ×');
  }

  /**
   * Spawn a burst of particles. All fields optional except position.
   * color: hex number | css string | THREE.Color.
   */
  burst({
    position,
    count = 10,
    color = 0xffffff,
    speed = 4,
    spread = 1,
    life = 0.5,
    size = 0.05,
    gravity = 0,
    direction = null,
    drag = 1.2,
  } = {}) {
    if (!position) return;
    let n = Math.round(count * this.params.countMult);
    const free = MAX - this.alive;
    if (n > free) n = free;
    if (n <= 0) return;

    if (color && color.isColor) _color.copy(color);
    else _color.set(color);

    const px = position.x, py = position.y, pz = position.z;
    const pos = this.pos;
    const vel = this.vel;
    const base = this.baseColor;
    const dirX = direction ? direction.x : 0;
    const dirY = direction ? direction.y : 0;
    const dirZ = direction ? direction.z : 0;

    for (let k = 0; k < n; k++) {
      const i = this.alive++;
      const i3 = i * 3;
      pos[i3] = px; pos[i3 + 1] = py; pos[i3 + 2] = pz;

      // Random direction on the unit sphere, optionally cone-biased.
      let dx = Math.random() * 2 - 1;
      let dy = Math.random() * 2 - 1;
      let dz = Math.random() * 2 - 1;
      let m = Math.hypot(dx, dy, dz) || 1;
      dx /= m; dy /= m; dz /= m;
      if (direction) {
        dx = dirX + dx * spread;
        dy = dirY + dy * spread;
        dz = dirZ + dz * spread;
        m = Math.hypot(dx, dy, dz) || 1;
        dx /= m; dy /= m; dz /= m;
      }

      const spd = speed * this.params.speedMult * (0.4 + Math.random() * 0.9);
      vel[i3] = dx * spd;
      vel[i3 + 1] = dy * spd;
      vel[i3 + 2] = dz * spd;

      const lf = Math.max(0.05, life * this.params.lifeMult * (0.65 + Math.random() * 0.7));
      this.life[i] = lf;
      this.maxLife[i] = lf;
      this.grav[i] = gravity;
      this.drag[i] = drag;

      const tint = 0.75 + Math.random() * 0.35;
      base[i3] = _color.r * tint;
      base[i3 + 1] = _color.g * tint;
      base[i3 + 2] = _color.b * tint;
      this.size[i] = size * this.params.sizeMult * (0.6 + Math.random() * 0.8);
    }
  }

  render(dt) {
    let alive = this.alive;
    if (alive === 0) {
      if (this.mesh.count !== 0) this.mesh.count = 0;
      return;
    }

    const pos = this.pos;
    const vel = this.vel;

    // Camera basis for billboarding (world-space right/up, forward unused since
    // the quad is flat — its z scale is irrelevant).
    const e = this.ctx.camera.matrixWorld.elements;
    const rX = e[0], rY = e[1], rZ = e[2];
    const uX = e[4], uY = e[5], uZ = e[6];
    const fX = e[8], fY = e[9], fZ = e[10];

    const colArr = this.aColor.array;

    let i = 0;
    while (i < alive) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        alive--;
        if (i !== alive) this._swap(i, alive);
        continue;
      }
      const i3 = i * 3;
      const d = Math.max(0, 1 - this.drag[i] * dt);
      vel[i3] *= d;
      vel[i3 + 1] = vel[i3 + 1] * d - this.grav[i] * dt;
      vel[i3 + 2] *= d;
      pos[i3] += vel[i3] * dt;
      pos[i3 + 1] += vel[i3 + 1] * dt;
      pos[i3 + 2] += vel[i3 + 2] * dt;

      // Fade folded into RGB (additive: source contribution scales with color).
      const r = this.life[i] / this.maxLife[i]; // 1 → 0
      const fade = r * r;
      colArr[i3] = this.baseColor[i3] * fade;
      colArr[i3 + 1] = this.baseColor[i3 + 1] * fade;
      colArr[i3 + 2] = this.baseColor[i3 + 2] * fade;

      // Camera-facing instance matrix scaled to the particle's diameter.
      const s = this.size[i] * 2;
      _mat.set(
        rX * s, uX * s, fX, pos[i3],
        rY * s, uY * s, fY, pos[i3 + 1],
        rZ * s, uZ * s, fZ, pos[i3 + 2],
        0, 0, 0, 1,
      );
      this.mesh.setMatrixAt(i, _mat);
      i++;
    }
    this.alive = alive;

    this.mesh.count = alive;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.aColor.needsUpdate = true;
  }

  /** Swap-remove: copy particle j's data into slot i (j is the last alive). */
  _swap(i, j) {
    const i3 = i * 3, j3 = j * 3;
    const pos = this.pos, vel = this.vel, base = this.baseColor;
    pos[i3] = pos[j3]; pos[i3 + 1] = pos[j3 + 1]; pos[i3 + 2] = pos[j3 + 2];
    vel[i3] = vel[j3]; vel[i3 + 1] = vel[j3 + 1]; vel[i3 + 2] = vel[j3 + 2];
    base[i3] = base[j3]; base[i3 + 1] = base[j3 + 1]; base[i3 + 2] = base[j3 + 2];
    this.size[i] = this.size[j];
    this.life[i] = this.life[j];
    this.maxLife[i] = this.maxLife[j];
    this.grav[i] = this.grav[j];
    this.drag[i] = this.drag[j];
  }
}
