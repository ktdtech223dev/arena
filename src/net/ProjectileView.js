// ARENA client — net/ProjectileView.js
// Renders the SERVER-AUTHORITATIVE networked projectiles (sawblade / rocket /
// seeker / grenade) echoed in every snapshot, interpolated in the PAST exactly
// like remote players (renderTime = serverNow - INTERP_DELAY_MS), plus the
// explosion / bounce fx from `boom` events. See ARENA-ARCHITECTURE.md §13.6.
//
// The local client must NOT locally-simulate these — they are server-owned and
// arrive as SnapProjectile[] in each snapshot. We buffer a short ring of
// snapshots, bracket renderTime between the two straddling snaps, lerp each
// projectile's position (falling back to the latest pos for a brand-new id with
// no history yet), and drive a pooled visual mesh per kind in ctx.scene.
//
// Visual kinds mirror the single-player RANGE look (src/weapons/Projectile.js):
//   rocket   = glowing warhead + halo + smoke trail (ctx.fx.particles.burst)
//   seeker   = small glowing dart + halo
//   sawblade = thin SPINNING disc + additive teeth ring
//   grenade  = small dark sphere with an emissive equator band
// Built-in materials (MeshBasicMaterial auto-converts to a node material on the
// WebGPU backend) — NO raw GLSL, NO ShaderMaterial.
import * as THREE from 'three';
import { INTERP_DELAY_MS, EXTRAP_MAX_MS } from '../../shared/constants.js';

const RING_MS = 2000;        // keep ~2 s of snapshots
const SPAWN_FADE = 0.12;     // seconds to fade a new projectile visual in
const DESPAWN_FADE = 0.18;   // seconds to fade a gone projectile out
const SHAKE_RADIUS = 14;     // boom within this many metres shakes the camera

// Dynamic fx-lighting budget. The pool is FIXED-SIZE, added to the scene ONCE at
// construction, and never grown/removed — so the scene light COUNT is constant and
// firing a rocket/sawblade/grenade (or an explosion) never changes it, hence never
// recompiles a WebGPU pipeline. (Adding/removing a scene light recompiles every lit
// material — that was the per-shot jolt.) Each frame the pool is assigned to the
// brightest active emitters; the rest dim to intensity 0.
const FX_LIGHTS = 8;         // shared dynamic light pool size (fixed → no recompile)
const BOOM_EMITTERS = 12;    // max simultaneous explosion light EMITTERS (data only)
const VISUAL_POOL = 8;       // projectile visuals prewarmed at boot (all kinds built)
const _fxCands = [];         // per-frame scratch for light assignment (no realloc)

const _v = new THREE.Vector3();
const _look = new THREE.Vector3();
const _tmp = new THREE.Vector3();

// ---------------------------------------------------------------------------
// ProjectileVisual — one pooled mesh set. Only the mesh for `kind` is shown at
// a time; meshes are built lazily on first use and reused across projectiles.
// ---------------------------------------------------------------------------
class ProjectileVisual {
  constructor(scene) {
    this.scene = scene;
    this.active = false;

    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.kind = 'rocket';
    this.spin = 0;            // sawblade disc angle
    this.fade = 0;            // 0..1 visual opacity envelope
    this.fadingOut = false;
    this.trailAccum = 0;

    this.group = new THREE.Group();
    this.group.visible = false;
    this.scene.add(this.group);

    this._meshes = {};        // kind -> { root, tint:[mat], glow:[mat], spin?:Group, baseOpacity:Map }
    this.spinMesh = null;
    // No per-visual light: projectile glow comes from ProjectileView's SHARED fixed
    // fx-light pool (assigned to the brightest emitters each frame). A per-visual
    // light was added to the scene on spawn, changing the light count and recompiling
    // every WebGPU pipeline — the per-shot jolt. This visual owns no scene light.
  }

  // Reveal the mesh set for `kind`, building it once. Hide the others.
  useKind(kind) {
    for (const k in this._meshes) {
      const m = this._meshes[k];
      if (m && m.root) m.root.visible = k === kind;
    }
    let m = this._meshes[kind];
    if (!m) {
      m = this._build(kind);
      this._meshes[kind] = m;
      this.group.add(m.root);
    }
    m.root.visible = true;
    this.kind = kind;
    this.spinMesh = m.spin || null;
  }

  _build(kind) {
    if (kind === 'rocket') return buildRocket();
    if (kind === 'seeker') return buildSeeker();
    if (kind === 'sawblade') return buildSawblade();
    if (kind === 'grenade') return buildGrenade();
    return buildRocket();
  }

  // Apply the current fade envelope to every material (additive glow scales its
  // opacity; solid bodies scale opacity too but stay opaque near full fade).
  applyFade() {
    const m = this._meshes[this.kind];
    if (!m) return;
    const f = this.fade;
    for (const mat of m.glow) mat.opacity = (m.baseOpacity.get(mat) ?? 1) * f;
    for (const mat of m.solid) {
      const base = m.baseOpacity.get(mat) ?? 1;
      mat.opacity = base * (0.15 + 0.85 * f);
    }
  }

  dispose() {
    this.scene.remove(this.group);
    for (const k in this._meshes) {
      const m = this._meshes[k];
      m.root.traverse((o) => {
        if (o.isMesh) {
          o.geometry?.dispose?.();
          const mat = o.material;
          if (Array.isArray(mat)) mat.forEach((x) => x.dispose?.());
          else mat?.dispose?.();
        }
      });
    }
    this._meshes = {};
  }
}

const LIGHT_COLOR = { rocket: 0xff9a4a, seeker: 0xffd0a0, sawblade: 0x9affd0, grenade: 0xffb347 };
const LIGHT_MAX = { rocket: 4, seeker: 2.2, sawblade: 1.6, grenade: 1.4 };

// Track base opacities so the fade envelope multiplies rather than overwrites.
function tagOpacity(map, mat) { map.set(mat, mat.opacity ?? 1); return mat; }

// Rocket warhead — bright nose + body + additive halo, aligned along +Z.
function buildRocket() {
  const root = new THREE.Group();
  const base = new Map();
  const solid = [], glow = [];

  const headMat = new THREE.MeshBasicMaterial({ color: 0xff7a2a, toneMapped: false });
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), headMat);
  head.position.set(0, 0, 0.18);
  root.add(head); solid.push(tagOpacity(base, headMat));

  const bodyMat = new THREE.MeshBasicMaterial({ color: 0x552211, toneMapped: false });
  const bodyGeo = new THREE.CylinderGeometry(0.09, 0.11, 0.5, 10);
  bodyGeo.rotateX(Math.PI / 2);
  root.add(new THREE.Mesh(bodyGeo, bodyMat)); solid.push(tagOpacity(base, bodyMat));

  const haloMat = new THREE.MeshBasicMaterial({
    color: 0xff9a4a, transparent: true, opacity: 0.5,
    blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
  });
  const halo = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 10), haloMat);
  halo.position.set(0, 0, 0.18);
  root.add(halo); glow.push(tagOpacity(base, haloMat));

  return { root, solid, glow, baseOpacity: base, flicker: haloMat };
}

// Seeker dart — tiny glowing cone + halo, points along +Z.
function buildSeeker() {
  const root = new THREE.Group();
  const base = new Map();
  const solid = [], glow = [];

  const mat = new THREE.MeshBasicMaterial({ color: 0xffb060, toneMapped: false });
  const geo = new THREE.ConeGeometry(0.06, 0.34, 7);
  geo.rotateX(Math.PI / 2);
  root.add(new THREE.Mesh(geo, mat)); solid.push(tagOpacity(base, mat));

  const haloMat = new THREE.MeshBasicMaterial({
    color: 0xffd0a0, transparent: true, opacity: 0.6,
    blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
  });
  root.add(new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), haloMat));
  glow.push(tagOpacity(base, haloMat));

  return { root, solid, glow, baseOpacity: base, flicker: haloMat };
}

// Sawblade — thin spinning disc + additive teeth ring (disc spun each frame).
function buildSawblade() {
  const root = new THREE.Group();
  const base = new Map();
  const solid = [], glow = [];
  const disc = new THREE.Group(); // spun about local +Z (face normal)

  const bladeMat = new THREE.MeshBasicMaterial({ color: 0x8affc8, toneMapped: false });
  const bladeGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.04, 16);
  bladeGeo.rotateX(Math.PI / 2);
  disc.add(new THREE.Mesh(bladeGeo, bladeMat)); solid.push(tagOpacity(base, bladeMat));

  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xd8ffe8, transparent: true, opacity: 0.7,
    blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
  });
  disc.add(new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.035, 6, 20), ringMat));
  glow.push(tagOpacity(base, ringMat));

  root.add(disc);
  return { root, solid, glow, baseOpacity: base, spin: disc, flicker: ringMat };
}

// Grenade — small dark sphere with a glowing emissive equator band.
function buildGrenade() {
  const root = new THREE.Group();
  const base = new Map();
  const solid = [], glow = [];

  const shellMat = new THREE.MeshBasicMaterial({ color: 0x2a2f33, toneMapped: false });
  root.add(new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 10), shellMat));
  solid.push(tagOpacity(base, shellMat));

  // emissive equator band (thin torus around the sphere)
  const bandMat = new THREE.MeshBasicMaterial({
    color: 0xffb347, transparent: true, opacity: 0.95,
    blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
  });
  root.add(new THREE.Mesh(new THREE.TorusGeometry(0.145, 0.028, 6, 16), bandMat));
  glow.push(tagOpacity(base, bandMat));

  return { root, solid, glow, baseOpacity: base, flicker: bandMat };
}

// ---------------------------------------------------------------------------
export class ProjectileView {
  /**
   * @param {object} ctx  game context (ctx.scene, ctx.camera, ctx.fx.particles,
   *                       ctx.player.camera for shake, ctx.audio fallback).
   * @param {object} [opts]
   * @param {import('../audio/AudioBank.js').AudioBank|null} [opts.audio]
   */
  constructor(ctx, opts = {}) {
    this.ctx = ctx;
    this.audio = opts.audio || ctx.audio || null;

    // snapshot ring: [{ serverTime, byId: Map<id, SnapProjectile> }]
    this.buffer = [];
    // live visuals keyed by projectile id
    this.visuals = new Map();
    // free pool of ProjectileVisual (reused across ids)
    this.pool = [];

    // logical explosion light EMITTERS (data only: {x,y,z,color,dist,peak,life,maxLife}).
    // They own NO scene light — they compete for the shared fx-light pool below.
    this._booms = [];
    this._flk = 0; // rolling flicker phase (deterministic — no per-frame Math.random)

    // SHARED fixed-size dynamic fx-light pool — created ONCE, added to the scene up
    // front, NEVER grown/removed at runtime. Keeps the scene light COUNT constant so
    // no rocket/sawblade/grenade/explosion ever recompiles a WebGPU pipeline (the
    // per-shot jolt). Assigned each frame to the brightest active emitters.
    this._fxLights = [];
    for (let i = 0; i < FX_LIGHTS; i++) {
      const L = new THREE.PointLight(0xffffff, 0, 20, 2);
      this.ctx.scene.add(L);
      this._fxLights.push(L);
    }

    // Prewarm the projectile visual pool: build every kind's meshes + materials up
    // front and park them (hidden) in the scene, so the boot compileAsync warms
    // their pipelines with the final light count — no first-use compile hitch, and
    // steady-state spawns are pure pool reuse (no runtime scene mutation).
    for (let i = 0; i < VISUAL_POOL; i++) {
      const vis = new ProjectileVisual(this.ctx.scene);
      for (const k of ['rocket', 'seeker', 'sawblade', 'grenade']) vis.useKind(k);
      vis.group.visible = false;
      this.pool.push(vis);
    }
  }

  /**
   * Buffer one snapshot's projectiles. Called from ArenaMode on every snapshot.
   * @param {number} serverTime
   * @param {import('../../shared/types.js').SnapProjectile[]} projectiles
   */
  pushSnapshot(serverTime, projectiles) {
    const byId = new Map();
    if (projectiles) for (const p of projectiles) byId.set(p.id, p);
    this.buffer.push({ serverTime, byId });
    if (this.buffer.length > 128) this.buffer.shift();
    const cutoff = serverTime - RING_MS;
    while (this.buffer.length > 2 && this.buffer[0].serverTime < cutoff) this.buffer.shift();
  }

  /**
   * Render every live projectile at renderTime (= conn.serverNow() -
   * INTERP_DELAY_MS), interpolated between the two bracketing snapshots exactly
   * like remote players. Spawn a visual for a new id, fade out ids absent from
   * the latest snapshot.
   * @param {number} dt         frame delta (s)
   * @param {number} renderTime server ms in the past to render at
   */
  update(dt, renderTime) {
    const buf = this.buffer;
    if (buf.length) {
      // bracket [a,b] with a.time <= renderTime <= b.time
      let a = null, b = null;
      for (let i = buf.length - 1; i > 0; i--) {
        if (buf[i - 1].serverTime <= renderTime && renderTime <= buf[i].serverTime) {
          a = buf[i - 1]; b = buf[i]; break;
        }
      }
      const latest = buf[buf.length - 1];

      // gather the set of ids that should be live this frame (present in the
      // bracket or, if past the newest snap, in the latest snap)
      const seen = new Set();

      // helper to resolve a projectile's interpolated transform for id
      const resolve = (id) => {
        if (a && b) {
          const sa = a.byId.get(id), sb = b.byId.get(id);
          if (sa && sb) {
            const t = (renderTime - a.serverTime) / Math.max(1, b.serverTime - a.serverTime);
            return lerpProj(sa, sb, t);
          }
          return sb || sa || null;
        }
        // renderTime past newest snap → brief capped extrapolation from latest
        const sp = latest.byId.get(id);
        if (!sp) return null;
        const ahead = Math.min(EXTRAP_MAX_MS, Math.max(0, renderTime - latest.serverTime)) / 1000;
        return {
          kind: sp.kind,
          pos: { x: sp.pos.x + sp.vel.x * ahead, y: sp.pos.y + sp.vel.y * ahead, z: sp.pos.z + sp.vel.z * ahead },
          vel: sp.vel,
        };
      };

      // The authoritative "alive" set is the newest snapshot: an id that has
      // dropped out of `latest` has despawned server-side (hit/expired). We
      // still render it interpolated in the bracket until it fades.
      for (const id of latest.byId.keys()) {
        seen.add(id);
        const s = resolve(id);
        if (!s) continue;
        let vis = this.visuals.get(id);
        if (!vis) { vis = this._spawn(id, s.kind); }
        this._applyTransform(vis, s);
        vis.fadingOut = false;
      }

      // any live visual NOT in the latest snapshot → begin fade-out
      for (const [id, vis] of this.visuals) {
        if (!seen.has(id)) vis.fadingOut = true;
      }
    } else {
      // no snapshots yet → everything fades out
      for (const vis of this.visuals.values()) vis.fadingOut = true;
    }

    this._stepVisuals(dt);
    this._stepBooms(dt);
    this._assignFxLights();
  }

  // Advance fades, spins, flickers, rocket trails; recycle fully-faded visuals.
  _stepVisuals(dt) {
    for (const [id, vis] of this.visuals) {
      if (vis.fadingOut) {
        vis.fade -= dt / DESPAWN_FADE;
        if (vis.fade <= 0) { this._recycle(id, vis); continue; }
      } else if (vis.fade < 1) {
        vis.fade = Math.min(1, vis.fade + dt / SPAWN_FADE);
      }

      // spinning sawblade disc
      if (vis.spinMesh) { vis.spin += 34 * dt; vis.spinMesh.rotation.z = vis.spin; }

      // rocket smoke/fire trail via the shared particle pool
      if (vis.kind === 'rocket' && !vis.fadingOut) {
        vis.trailAccum += dt;
        const interval = 0.045;
        while (vis.trailAccum >= interval) {
          vis.trailAccum -= interval;
          this._emitRocketTrail(vis);
        }
      }

      vis.applyFade(); // halo/opacity envelope; glow lighting is handled by the fx pool
    }
  }

  _emitRocketTrail(vis) {
    const parts = this.ctx.fx?.particles;
    if (!parts?.burst) return;
    // small back-biased smoke puff behind the rocket
    _tmp.copy(vis.vel);
    const spd = _tmp.length();
    if (spd > 1e-4) _tmp.multiplyScalar(-1 / spd); else _tmp.set(0, 0, 0);
    parts.burst({
      position: vis.pos.clone(),
      count: 4, color: 0xff7a2a, speed: 1.2, spread: 1,
      life: 0.5, size: 0.35, gravity: -1.5,
      direction: (_tmp.x || _tmp.y || _tmp.z) ? _tmp.clone() : null,
    });
  }

  _applyTransform(vis, s) {
    vis.pos.set(s.pos.x, s.pos.y, s.pos.z);
    vis.vel.set(s.vel?.x || 0, s.vel?.y || 0, s.vel?.z || 0);
    vis.group.position.copy(vis.pos);
    // orient along velocity (grenades tumble but pointing along travel is fine)
    if (vis.vel.lengthSq() > 1e-6) {
      _look.copy(vis.pos).add(_v.copy(vis.vel).normalize());
      vis.group.lookAt(_look);
    }
  }

  _spawn(id, kind) {
    const vis = this.pool.pop() || new ProjectileVisual(this.ctx.scene);
    vis.active = true;
    vis.fade = 0;
    vis.fadingOut = false;
    vis.spin = 0;
    vis.trailAccum = 0;
    vis.useKind(kind || 'rocket');
    vis.group.visible = true;
    vis.applyFade();
    this.visuals.set(id, vis);
    return vis;
  }

  _recycle(id, vis) {
    vis.active = false;
    vis.group.visible = false; // mesh .visible is safe (no recompile); it just stops rendering
    this.visuals.delete(id);
    this.pool.push(vis);
  }

  /**
   * Explosion / bounce fx at a world position, from a server `boom` event.
   * @param {'explosion'|'grenade'|'bounce'|'seeker'} kind
   * @param {{x:number,y:number,z:number}} pos
   * @param {number} radius
   */
  boom(kind, pos, radius = 3) {
    if (!pos) return;
    _v.set(pos.x, pos.y, pos.z);
    const parts = this.ctx.fx?.particles;
    const big = (kind === 'explosion' || kind === 'grenade');
    const scale = Math.max(0.4, radius / (big ? 5 : 2));

    if (big) {
      // fireball core
      parts?.burst?.({
        position: _v.clone(), count: Math.round(34 * scale), color: 0xffb24a,
        speed: 9 * scale, spread: 1, life: 0.55, size: 0.5 * scale, gravity: -2, drag: 1.4,
      });
      // hot white flash
      parts?.burst?.({
        position: _v.clone(), count: Math.round(14 * scale), color: 0xffe6b0,
        speed: 12 * scale, spread: 1, life: 0.28, size: 0.4 * scale, gravity: 0, drag: 2.2,
      });
      // ember spray (gravity-pulled, longer-lived)
      parts?.burst?.({
        position: _v.clone(), count: Math.round(22 * scale), color: 0xff6a1a,
        speed: 7 * scale, spread: 1, life: 0.9, size: 0.14 * scale, gravity: 9, drag: 0.7,
      });
      // dark smoke, rising slowly
      parts?.burst?.({
        position: _v.clone(), count: Math.round(16 * scale), color: 0x3a3330,
        speed: 2.5 * scale, spread: 1, life: 1.2, size: 0.7 * scale, gravity: -1.2, drag: 1.6,
      });
      this._addBoom(_v, 0xff8a3a, 9 * scale, 0.45);
      this._playAt('explosion', _v, { volume: Math.min(1.4, 0.8 + scale * 0.2) });
    } else {
      // 'bounce' / 'seeker' → small bright spark burst + tick
      parts?.burst?.({
        position: _v.clone(), count: Math.round(10 * scale), color: kind === 'seeker' ? 0xffd0a0 : 0x9affd0,
        speed: 6 * scale, spread: 1, life: 0.3, size: 0.12 * scale, gravity: 4, drag: 1.5,
      });
      this._addBoom(_v, kind === 'seeker' ? 0xffd0a0 : 0x9affd0, 3 * scale, 0.18);
      // sawblade ricochet ding vs a small seeker pop (both synth-only cues)
      this._playAt(kind === 'seeker' ? 'seeker_launch' : 'sawblade_bounce', _v, { volume: 0.7 });
    }

    // camera shake if the blast is near the local player
    const cam = this.ctx.camera;
    if (cam) {
      cam.getWorldPosition(_look);
      const dist = _look.distanceTo(_v);
      if (dist < SHAKE_RADIUS * scale) {
        const falloff = 1 - dist / (SHAKE_RADIUS * scale);
        const amt = (big ? 0.7 : 0.2) * falloff * falloff;
        this.ctx.player?.camera?.addShake?.(amt);
      }
    }
  }

  // route a cue through the AudioBank (falls back to synth for cues without a
  // sampled file, e.g. explosion / sawblade_bounce / seeker_launch).
  _playAt(cue, pos, opts = {}) {
    const bank = this.audio;
    const o = { position: { x: pos.x, y: pos.y, z: pos.z }, ...opts };
    if (bank?.play) bank.play(cue, o);
    else this.ctx.audio?.play?.(cue, o);
  }

  // Register an explosion light EMITTER (data only — no scene light is added, so the
  // scene light count never changes and no WebGPU pipeline recompiles). Emitters
  // compete for the shared fx-light pool in _assignFxLights. The list is capped; over
  // the cap, the least-alive emitter is reused.
  _addBoom(pos, color, peak, life) {
    let e = this._booms.find((x) => x.life <= 0);
    if (!e) {
      if (this._booms.length < BOOM_EMITTERS) { e = {}; this._booms.push(e); }
      else { e = this._booms.reduce((a, b) => (b.life < a.life ? b : a)); } // steal least-alive
    }
    e.x = pos.x; e.y = pos.y + 0.2; e.z = pos.z;
    e.color = color; e.peak = peak; e.dist = Math.max(12, peak * 3);
    e.life = life; e.maxLife = life;
  }

  _stepBooms(dt) {
    for (const e of this._booms) { if (e.life > 0) e.life -= dt; }
  }

  // Assign the FIXED shared fx-light pool to the current brightest emitters: active
  // explosions first (bright, brief), then the nearest/brightest active projectiles
  // (steady glow). Unused pool lights dim to intensity 0. Pool size is constant → pure
  // uniform updates (color/intensity/position/distance), never a pipeline recompile.
  _assignFxLights() {
    const cands = _fxCands;
    cands.length = 0;
    for (const e of this._booms) {
      if (e.life <= 0) continue;
      const f = e.life / e.maxLife;
      cands.push({ x: e.x, y: e.y, z: e.z, color: e.color, dist: e.dist, intensity: e.peak * f * f, pri: 2 });
    }
    for (const vis of this.visuals.values()) {
      if (!vis.active || vis.fade <= 0.05) continue;
      this._flk = (this._flk + 0.37) % 1;
      const flick = 0.78 + this._flk * 0.44;
      cands.push({ x: vis.pos.x, y: vis.pos.y, z: vis.pos.z, color: LIGHT_COLOR[vis.kind] || 0xffffff, dist: 14, intensity: (LIGHT_MAX[vis.kind] || 2.5) * vis.fade * flick, pri: 1 });
    }
    cands.sort((a, b) => (b.pri - a.pri) || (b.intensity - a.intensity));
    for (let i = 0; i < this._fxLights.length; i++) {
      const L = this._fxLights[i], c = cands[i];
      if (c) { L.color.set(c.color); L.distance = c.dist; L.intensity = c.intensity; L.position.set(c.x, c.y, c.z); }
      else { L.intensity = 0; }
    }
  }

  dispose() {
    for (const vis of this.visuals.values()) vis.dispose();
    for (const vis of this.pool) vis.dispose();
    this.visuals.clear();
    this.pool.length = 0;
    for (const L of this._fxLights) { this.ctx.scene.remove(L); L.dispose?.(); }
    this._fxLights.length = 0;
    this._booms.length = 0;
    this.buffer.length = 0;
  }
}

// linear-interpolate a projectile between two snaps (pos lerp; vel from b for a
// current heading; kind is stable across a projectile's life).
function lerpProj(a, b, t) {
  return {
    kind: b.kind || a.kind,
    pos: {
      x: a.pos.x + (b.pos.x - a.pos.x) * t,
      y: a.pos.y + (b.pos.y - a.pos.y) * t,
      z: a.pos.z + (b.pos.z - a.pos.z) * t,
    },
    vel: b.vel || a.vel,
  };
}
