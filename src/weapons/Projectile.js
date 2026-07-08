// RANGE — pooled travel-time projectiles (agent D).
// Originally the sniper railgun-bolt cheat; now the generic projectile system
// behind the EXOTIC rocket + seekers and the SAWBLADE ricochet blades (§12.5).
// Owned and driven by WeaponManager (fixedUpdate/render) — main.js never sees
// this class; it calls ctx.weapons.fixedUpdate/render which forward to us.
//
// Each fixed tick a projectile raycasts the segment it travels
// (world.raycastShot), then dispatches by callback:
//   - onTargetHit(hit, target): return true to CONTINUE (carve through) or
//     falsy to consume/despawn. Absent → default (damage via def, despawn).
//   - onImpact(hit): solid/wall (or target when no onTargetHit) → e.g. explode.
//   - ricochet { bouncesLeft, onBounce(hit) }: wall reflect v' = v - 2(v·n)n.
//   - homing { getTarget(), turn }: steer velocity toward a live aim point.
// Visuals: pooled emissive meshes + point lights in ctx.scene, per `kind`
// ('bolt' | 'rocket' | 'seeker' | 'sawblade'). NO raw GLSL — built-in
// MeshBasicMaterial (renderer converts to node material internally).
import * as THREE from 'three';
import { falloffMult } from './Hitscan.js';

const POOL_MAX = 48; // rockets are few but seekers (5/rocket) + blades add up

const _dir = new THREE.Vector3();
const _look = new THREE.Vector3();
const _tmpV = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _desired = new THREE.Vector3();
const _axis = new THREE.Vector3();

// -------------------------------------------------------------------------
// Projectile — one pooled instance. Holds every visual kind; only the mesh
// matching `kind` is shown at a time. Meshes are built lazily on first use.
// -------------------------------------------------------------------------
class Projectile {
  constructor(scene) {
    this.scene = scene;
    this.active = false;

    this.pos = new THREE.Vector3();
    this.prevPos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.traveled = 0;
    this.life = 0;
    this.gravity = 0;
    this.def = null;
    this.maxLife = 2;
    this.maxDist = 500;
    this.radius = 0; // extra contact radius for targets (seekers/blades)

    this.kind = 'bolt';
    this.onImpact = null;
    this.onTargetHit = null;
    this.homing = null; // { getTarget, turn }
    this.ricochet = null; // { bouncesLeft, onBounce }
    this.trail = null; // { interval, accum } for rocket smoke

    this.hitSet = null; // targets already struck (carve-through de-dup)

    // one group per kind so we never rebuild materials mid-flight
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);

    this._meshes = {}; // kind -> { root, ...refs }
    this.light = new THREE.PointLight(0x9fd0ff, 0, 16, 2); // stays .visible; dimmed via intensity
    this.group.add(this.light);
  }

  // Build (once) and reveal the mesh for `kind`; hide the others.
  _useKind(kind, color) {
    for (const k in this._meshes) {
      const m = this._meshes[k];
      if (m && m.root) m.root.visible = k === kind;
    }
    let m = this._meshes[kind];
    if (!m) {
      m = this._buildKind(kind);
      this._meshes[kind] = m;
      this.group.add(m.root);
    }
    m.root.visible = true;
    // apply color to the tintable material(s)
    if (m.tint) for (const mat of m.tint) mat.color.set(color);
    this.spinMesh = m.spin || null; // sawblade disc to rotate each frame
  }

  _buildKind(kind) {
    if (kind === 'rocket') return this._buildRocket();
    if (kind === 'seeker') return this._buildSeeker();
    if (kind === 'sawblade') return this._buildSawblade();
    return this._buildBolt();
  }

  // Sniper railgun bolt — elongated additive cylinder along +Z (lookAt orients).
  _buildBolt() {
    const root = new THREE.Group();
    const glowGeo = new THREE.CylinderGeometry(0.05, 0.05, 1.7, 8, 1, true);
    glowGeo.rotateX(Math.PI / 2);
    const glowMat = new THREE.MeshBasicMaterial({
      color: 0x9fd0ff, transparent: true, opacity: 0.75,
      blending: THREE.AdditiveBlending, depthWrite: false,
      toneMapped: false, side: THREE.DoubleSide,
    });
    root.add(new THREE.Mesh(glowGeo, glowMat));

    const coreGeo = new THREE.CylinderGeometry(0.018, 0.018, 1.9, 6);
    coreGeo.rotateX(Math.PI / 2);
    root.add(new THREE.Mesh(coreGeo, new THREE.MeshBasicMaterial({
      color: 0xffffff, blending: THREE.AdditiveBlending,
      transparent: true, depthWrite: false, toneMapped: false,
    })));
    return { root, tint: [glowMat], flickerMat: glowMat };
  }

  // Rocket warhead — bright nose + short body, aligned along +Z.
  _buildRocket() {
    const root = new THREE.Group();
    // glowing warhead
    const headGeo = new THREE.SphereGeometry(0.16, 12, 10);
    const headMat = new THREE.MeshBasicMaterial({ color: 0xff7a2a, toneMapped: false });
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.set(0, 0, 0.18);
    root.add(head);
    // body
    const bodyGeo = new THREE.CylinderGeometry(0.09, 0.11, 0.5, 10);
    bodyGeo.rotateX(Math.PI / 2);
    const bodyMat = new THREE.MeshBasicMaterial({ color: 0x552211, toneMapped: false });
    root.add(new THREE.Mesh(bodyGeo, bodyMat));
    // additive glow halo
    const haloGeo = new THREE.SphereGeometry(0.28, 12, 10);
    const haloMat = new THREE.MeshBasicMaterial({
      color: 0xff9a4a, transparent: true, opacity: 0.5,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    });
    const halo = new THREE.Mesh(haloGeo, haloMat);
    halo.position.set(0, 0, 0.18);
    root.add(halo);
    return { root, tint: [headMat, haloMat], flickerMat: haloMat };
  }

  // Seeker dart — tiny glowing sliver.
  _buildSeeker() {
    const root = new THREE.Group();
    const geo = new THREE.ConeGeometry(0.06, 0.34, 7);
    geo.rotateX(Math.PI / 2); // point along +Z
    const mat = new THREE.MeshBasicMaterial({ color: 0xffb060, toneMapped: false });
    root.add(new THREE.Mesh(geo, mat));
    const haloGeo = new THREE.SphereGeometry(0.14, 8, 6);
    const haloMat = new THREE.MeshBasicMaterial({
      color: 0xffd0a0, transparent: true, opacity: 0.6,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    });
    root.add(new THREE.Mesh(haloGeo, haloMat));
    return { root, tint: [mat, haloMat], flickerMat: haloMat };
  }

  // Sawblade — thin spinning disc (rotated each frame in render()).
  _buildSawblade() {
    const root = new THREE.Group();
    const disc = new THREE.Group(); // spun about its local +Z (face normal)
    const bladeGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.04, 16);
    bladeGeo.rotateX(Math.PI / 2); // face along +Z
    const bladeMat = new THREE.MeshBasicMaterial({ color: 0x8affc8, toneMapped: false });
    disc.add(new THREE.Mesh(bladeGeo, bladeMat));
    // teeth ring (additive glow)
    const ringGeo = new THREE.TorusGeometry(0.22, 0.035, 6, 20);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xd8ffe8, transparent: true, opacity: 0.7,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    });
    disc.add(new THREE.Mesh(ringGeo, ringMat));
    root.add(disc);
    return { root, tint: [bladeMat, ringMat], flickerMat: ringMat, spin: disc };
  }
}

export class ProjectileManager {
  constructor(ctx) {
    this.ctx = ctx;
    this.pool = []; // lazily grown up to POOL_MAX
    this.params = { maxLife: 2, maxDist: 500 };
    ctx.tunables.push(
      { cat: 'weapons', key: 'projectile.maxLife', obj: this.params, prop: 'maxLife', min: 0.25, max: 6, step: 0.05 },
      { cat: 'weapons', key: 'projectile.maxDist', obj: this.params, prop: 'maxDist', min: 50, max: 1000, step: 10 },
    );
  }

  /**
   * Spawn a projectile.
   *   origin, dir (normalized), speed, gravity, def, color
   *   kind: 'bolt'|'rocket'|'seeker'|'sawblade' (default 'bolt')
   *   maxLife, maxDist, radius (target contact radius)
   *   onImpact(hit), onTargetHit(hit, target) -> truthy to continue
   *   homing { getTarget(): Target|null, turn: rad/s }
   *   ricochet { bouncesLeft, onBounce(hit) }
   *   trail (bool) — periodic smoke/fire burst (rocket)
   */
  spawn(opts) {
    const {
      origin, dir, speed = 220, gravity = 0, def = null, color = null,
      kind = 'bolt', onImpact = null, onTargetHit = null,
      homing = null, ricochet = null, trail = false,
    } = opts;

    const p = this._acquire();
    if (!p) return null;

    p.active = true;
    p.pos.copy(origin);
    p.prevPos.copy(origin);
    p.vel.copy(dir).multiplyScalar(speed);
    p.gravity = gravity;
    p.def = def;
    p.traveled = 0;
    p.life = 0;
    p.maxLife = opts.maxLife ?? this.params.maxLife;
    p.maxDist = opts.maxDist ?? this.params.maxDist;
    p.radius = opts.radius ?? 0;
    p.kind = kind;
    p.onImpact = onImpact;
    p.onTargetHit = onTargetHit;
    p.homing = homing;
    p.ricochet = ricochet;
    p.trail = trail ? { interval: 0.045, accum: 0 } : null;
    p.hitSet = onTargetHit ? new Set() : null;

    const c = color ?? def?.projectile?.color ?? def?.tracer?.color ?? 0x9fd0ff;
    p._useKind(kind, c);
    p.light.color.set(c);
    p.light.intensity = 3; // dim=off; never toggle .visible (pipeline recompile)

    p.group.visible = true;
    p.group.position.copy(origin);
    _look.copy(origin).add(dir);
    p.group.lookAt(_look);
    return p;
  }

  fixedUpdate(dt) {
    const ctx = this.ctx;
    for (const p of this.pool) {
      if (!p.active) continue;
      this._stepOne(p, dt);
    }
  }

  _stepOne(p, dt) {
    const ctx = this.ctx;
    p.prevPos.copy(p.pos);

    // --- homing steer toward the live target aim point ---
    if (p.homing) {
      const target = p.homing.getTarget ? p.homing.getTarget() : null;
      if (target) {
        this._aimPoint(target, _aim);
        _desired.copy(_aim).sub(p.pos);
        const dLen = _desired.length();
        if (dLen > 1e-4) {
          _desired.multiplyScalar(1 / dLen);
          const speed = p.vel.length() || 1;
          _dir.copy(p.vel).multiplyScalar(1 / speed);
          // rotate _dir toward _desired by at most turn*dt radians
          let dot = _dir.dot(_desired);
          dot = dot < -1 ? -1 : dot > 1 ? 1 : dot;
          const ang = Math.acos(dot);
          const maxStep = p.homing.turn * dt;
          if (ang > 1e-4) {
            const t = ang <= maxStep ? 1 : maxStep / ang;
            _dir.lerp(_desired, t).normalize();
            p.vel.copy(_dir).multiplyScalar(speed);
          }
        }
      }
    }

    p.vel.y -= p.gravity * dt;
    const speed = p.vel.length();
    const step = speed * dt;
    if (step <= 0) { this._despawn(p); return; }
    _dir.copy(p.vel).multiplyScalar(1 / speed);

    // per-tick trail burst (rocket)
    if (p.trail) {
      p.trail.accum += dt;
      while (p.trail.accum >= p.trail.interval) {
        p.trail.accum -= p.trail.interval;
        this._emitTrail(p);
      }
    }

    // Cast the travel segment plus the contact radius (seekers/blades have a
    // fat contact so they don't tunnel past a thin target between ticks).
    const cast = step + p.radius + 0.01;
    const hit = ctx.world.raycastShot(p.pos, _dir, cast);
    if (hit && hit.distance <= cast) {
      const status = this._onHit(p, hit, _dir);
      if (status === 'consumed') return; // despawned inside _onHit
      if (status === 'passthrough') {
        // carve/de-dup: keep this tick's full momentum along the ORIGINAL dir so
        // the blade clears the target (and its contact radius) in one tick and
        // can't stall ticking 2 cm at a time inside a thick target.
        p.pos.addScaledVector(_dir, step);
        p.traveled += step;
      }
      // 'bounced' already repositioned pos + advanced traveled in _onHit.
      p.life += dt;
      if (p.life >= p.maxLife || p.traveled >= p.maxDist) this._expire(p);
      return;
    }

    p.pos.addScaledVector(_dir, step);
    p.traveled += step;
    p.life += dt;
    if (p.life >= p.maxLife || p.traveled >= p.maxDist) this._expire(p);
  }

  // Returns 'consumed' (despawned), 'passthrough' (continue original dir past
  // the hit), or 'bounced' (velocity/position already updated for a wall reflect).
  _onHit(p, hit, dir) {
    const ctx = this.ctx;

    // --- TARGET hit ---
    if (hit.target) {
      if (p.onTargetHit) {
        // de-dup: never damage the same target twice on one pass
        if (p.hitSet && p.hitSet.has(hit.target)) {
          return 'passthrough'; // already hit this one — keep going
        }
        if (p.hitSet) p.hitSet.add(hit.target);
        const keepFlying = p.onTargetHit(hit, hit.target);
        if (keepFlying) return 'passthrough'; // carve through
        this._despawn(p);
        return 'consumed';
      }
      // default target behavior: damage via def falloff, despawn (bolt path)
      if (p.def) {
        const dmg = p.def.damage * falloffMult(p.traveled + hit.distance, p.def.falloff);
        ctx.world.targets.damage(hit, dmg, p.def);
      }
      if (p.def) ctx.events.emit('shot:impact', { hit, def: p.def });
      this._despawn(p);
      return 'consumed';
    }

    // --- WALL / solid hit ---
    if (p.ricochet && p.ricochet.bouncesLeft > 0) {
      // reflect v' = v - 2(v·n)n, then nudge off the surface
      const n = hit.normal;
      const vn = p.vel.dot(n);
      p.vel.addScaledVector(n, -2 * vn);
      p.pos.copy(hit.point).addScaledVector(n, 0.05);
      p.ricochet.bouncesLeft--;
      p.traveled += hit.distance;
      // after a wall bounce the blade may sweep back across targets it already
      // carved — clear the de-dup set so it can damage them again on the new leg.
      if (p.hitSet) p.hitSet.clear();
      if (p.ricochet.onBounce) p.ricochet.onBounce(hit);
      // orient toward new velocity so the mesh doesn't lag a frame
      if (p.vel.lengthSq() > 1e-6) {
        _dir.copy(p.vel).normalize();
        _look.copy(p.pos).add(_dir);
        p.group.lookAt(_look);
      }
      return 'bounced'; // reflected — pos/vel/traveled already updated
    }

    // no bounces left (or not a ricochet type) → impact
    if (p.onImpact) {
      p.onImpact(hit);
      this._despawn(p);
      return 'consumed';
    }

    // default solid behavior: impact fx + despawn
    if (p.def) ctx.events.emit('shot:impact', { hit, def: p.def });
    this._despawn(p);
    return 'consumed';
  }

  // Life/dist expiry — rockets explode at the end of their fuse via onImpact.
  _expire(p) {
    if (p.active && p.onImpact) {
      // synthesize an "impact" at the current position (no surface normal)
      p.onImpact({ point: p.pos.clone(), normal: new THREE.Vector3(0, 1, 0), target: null });
    }
    this._despawn(p);
  }

  _emitTrail(p) {
    const parts = this.ctx.fx?.particles;
    if (!parts || !parts.burst) return;
    parts.burst({
      position: p.pos.clone(),
      count: 4,
      color: 0xff7a2a,
      speed: 1.2,
      spread: 1,
      life: 0.5,
      size: 0.35,
      gravity: -1.5,
    });
  }

  _aimPoint(target, out) {
    if (target.aimPoint) {
      try {
        const r = target.aimPoint(out);
        if (r && r.isVector3) return r;
        if (out && out.isVector3) return out;
      } catch (e) { /* fall through */ }
    }
    if (target.root && target.root.position) return out.copy(target.root.position);
    if (target.position) return out.copy(target.position);
    return out.set(0, 0, 0);
  }

  render(dt, alpha = 1) {
    const a = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
    for (const p of this.pool) {
      if (!p.active) continue;
      p.group.position.lerpVectors(p.prevPos, p.pos, a);
      if (p.vel.lengthSq() > 1e-6) {
        _look.copy(p.group.position).add(_tmpV.copy(p.vel).normalize());
        p.group.lookAt(_look);
      }
      // spinning sawblade disc
      if (p.spinMesh) p.spinMesh.rotation.z += 32 * dt;
      // light flicker + additive shimmer
      p.light.intensity = 2.2 + Math.random() * 1.8;
    }
  }

  // ---- internals ----------------------------------------------------------

  _acquire() {
    for (const p of this.pool) if (!p.active) return p;
    if (this.pool.length < POOL_MAX) {
      const p = new Projectile(this.ctx.scene);
      this.pool.push(p);
      return p;
    }
    // steal the oldest active slot rather than fail
    const victim = this.pool[0];
    this._despawn(victim);
    return victim;
  }

  _despawn(p) {
    p.active = false;
    p.group.visible = false;
    p.light.intensity = 0; // never toggle .visible (pipeline recompile)
    p.def = null;
    p.onImpact = null;
    p.onTargetHit = null;
    p.homing = null;
    p.ricochet = null;
    p.trail = null;
    p.hitSet = null;
    p.spinMesh = null;
  }
}
