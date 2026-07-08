// RANGE — fx/Shells.js
// Ejected casings. `eject(pos, vel, kind)` with kind 'pistol'|'rifle'|'shell'
// (called by the viewmodel at the animation moment, world space).
// Pool of 48 tiny vertex-colored meshes sharing ONE material — zero allocation
// per eject. Simple ballistic sim in render(dt): gravity, tumble, one ground
// bounce (floor y found via a single downward raycastShot on spawn), rest,
// then scale-fade + reclaim after ~3 s.
import * as THREE from 'three';

const POOL = 48;

const _down = new THREE.Vector3(0, -1, 0);
const _euler = new THREE.Euler();

/** Cylinder casing with baked vertex colors (body vs base band). */
function makeCasingGeometry(len, radius, bodyColor, baseColor, baseFrac) {
  const geo = new THREE.CylinderGeometry(radius * 0.92, radius, len, 7, 1, false);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const body = new THREE.Color(bodyColor);
  const base = new THREE.Color(baseColor);
  const cut = -len / 2 + len * baseFrac;
  for (let i = 0; i < pos.count; i++) {
    const c = pos.getY(i) < cut ? base : body;
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

const KIND_RADIUS = { pistol: 0.005, rifle: 0.0045, shell: 0.0098 };

export class Shells {
  constructor(ctx) {
    this.ctx = ctx;

    this.params = {
      life: 3,        // s until reclaim
      bounce: 0.35,   // restitution of the single ground bounce
      gravity: 9.8,   // m/s^2
      spinMult: 1.0,  // tumble speed multiplier
    };

    const T = (key, prop, min, max, step, label) =>
      ctx.tunables.push({ cat: 'fx', key, obj: this.params, prop, min, max, step, label });
    T('shellLife', 'life', 0.5, 10, 0.1, 'Shell life (s)');
    T('shellBounce', 'bounce', 0, 0.95, 0.01, 'Shell bounce');
    T('shellGravity', 'gravity', 0, 30, 0.1, 'Shell gravity');
    T('shellSpinMult', 'spinMult', 0, 3, 0.05, 'Shell spin ×');

    // Brass pistol/rifle casings, red+brass shotgun shell (bigger).
    this.geos = {
      pistol: makeCasingGeometry(0.022, KIND_RADIUS.pistol, 0xd9aa4f, 0xd9aa4f, 0),
      rifle: makeCasingGeometry(0.034, KIND_RADIUS.rifle, 0xdfb35a, 0xb9853a, 0.22),
      shell: makeCasingGeometry(0.062, KIND_RADIUS.shell, 0xc23b2e, 0xd9aa4f, 0.3),
    };
    this.mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      metalness: 0.65,
      roughness: 0.35,
    });

    this.pool = [];
    this._next = 0;
    for (let i = 0; i < POOL; i++) {
      const mesh = new THREE.Mesh(this.geos.pistol, this.mat);
      mesh.visible = false;
      mesh.castShadow = false;
      mesh.frustumCulled = false; // tiny + fast; skip bounds churn
      ctx.scene.add(mesh);
      this.pool.push({
        mesh,
        active: false,
        vel: new THREE.Vector3(),
        angVel: new THREE.Vector3(),
        life: 0,
        floorY: 0,
        radius: 0.005,
        bounces: 0,
        resting: false,
      });
    }
  }

  /**
   * Eject a casing. pos/vel are world-space V3s (copied, safe to reuse).
   * kind: 'pistol' | 'rifle' | 'shell'.
   */
  eject(pos, vel, kind = 'pistol') {
    if (!pos) return;

    // Free slot, else steal round-robin.
    let s = null;
    for (const c of this.pool) {
      if (!c.active) { s = c; break; }
    }
    if (!s) {
      s = this.pool[this._next];
      this._next = (this._next + 1) % POOL;
    }

    s.active = true;
    s.life = this.params.life;
    s.resting = false;
    s.bounces = 0;
    s.radius = KIND_RADIUS[kind] ?? KIND_RADIUS.pistol;

    const m = s.mesh;
    m.geometry = this.geos[kind] || this.geos.pistol;
    m.position.copy(pos);
    m.rotation.set(Math.random() * Math.PI * 2, Math.random() * Math.PI * 2, Math.random() * Math.PI * 2);
    m.scale.setScalar(1);
    m.visible = true;

    if (vel) s.vel.copy(vel);
    else s.vel.set(0, 1, 0);
    s.vel.x += (Math.random() - 0.5) * 0.7;
    s.vel.y += Math.random() * 0.4;
    s.vel.z += (Math.random() - 0.5) * 0.7;

    const spin = 22 * this.params.spinMult;
    s.angVel.set(
      (Math.random() - 0.5) * spin,
      (Math.random() - 0.5) * spin,
      (Math.random() - 0.5) * spin,
    );

    // ONE downward raycast to guess the floor under the spawn point.
    let floorY = 0; // facility main floor is a reasonable default guess
    try {
      const hit = this.ctx.world?.raycastShot?.(m.position, _down, 40);
      if (hit && hit.point) floorY = hit.point.y;
      else if (m.position.y < 0) floorY = m.position.y - 2; // off-world: just fall
    } catch {
      /* world may not be ready — keep the guess */
    }
    s.floorY = floorY;
  }

  render(dt) {
    const g = this.params.gravity;
    const FADE_T = 0.3;

    for (const s of this.pool) {
      if (!s.active) continue;

      s.life -= dt;
      if (s.life <= 0) {
        s.active = false;
        s.mesh.visible = false;
        continue;
      }
      // Scale-fade out in the last moments.
      if (s.life < FADE_T) s.mesh.scale.setScalar(Math.max(0.001, s.life / FADE_T));

      if (s.resting) continue;

      const m = s.mesh;
      s.vel.y -= g * dt;
      m.position.addScaledVector(s.vel, dt);
      m.rotation.x += s.angVel.x * dt;
      m.rotation.y += s.angVel.y * dt;
      m.rotation.z += s.angVel.z * dt;

      const groundY = s.floorY + s.radius;
      if (m.position.y <= groundY && s.vel.y < 0) {
        m.position.y = groundY;
        s.bounces++;
        if (s.bounces >= 2 || -s.vel.y < 0.8) {
          // Settle: lie on its side with a random yaw.
          s.resting = true;
          s.vel.set(0, 0, 0);
          s.angVel.set(0, 0, 0);
          _euler.set(
            Math.PI / 2 + (Math.random() - 0.5) * 0.12,
            Math.random() * Math.PI * 2,
            0,
            'YXZ',
          );
          m.quaternion.setFromEuler(_euler);
        } else {
          // The one lively bounce (dampened) — tiny click, no sound needed.
          s.vel.y = -s.vel.y * this.params.bounce;
          s.vel.x *= 0.65;
          s.vel.z *= 0.65;
          s.angVel.multiplyScalar(0.5);
        }
      }
    }
  }
}
