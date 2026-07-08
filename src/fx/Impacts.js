// RANGE — fx/Impacts.js
// Surface-typed impact FX. Listens `shot:impact { hit, def }` where hit =
// { point, normal, distance, surface: 'concrete'|'metal'|'target', target, zone }.
//   concrete → grey-tan dust puff + chips + dark scorch decal + impact_concrete
//   metal    → orange-white fast sparks (gravity) + darker decal + impact_metal
//              (+ 15% chance positional 'ricochet')
//   target   → small flash burst + impact_target. NO decal (targets move/flash).
// Decals: pooled quads (128, round-robin), oriented to hit.normal, offset 3 mm,
// random spin/scale, fade out over ~25 s.
import * as THREE from 'three';

const DECALS = 128;

const _q = new THREE.Quaternion();
const _z = new THREE.Vector3(0, 0, 1);
const _n = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _down = new THREE.Vector3(0, -1, 0);

function makeScorchTexture() {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');

  // Soft white blob (alpha shape) — tinted dark by material color.
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 60);
  grad.addColorStop(0.0, 'rgba(255,255,255,0.95)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.55)');
  grad.addColorStop(0.8, 'rgba(255,255,255,0.16)');
  grad.addColorStop(1.0, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);

  // Speckles around the blob.
  for (let i = 0; i < 90; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 8 + Math.random() * 50;
    g.fillStyle = `rgba(255,255,255,${0.1 + Math.random() * 0.3})`;
    g.beginPath();
    g.arc(64 + Math.cos(a) * r, 64 + Math.sin(a) * r, 0.6 + Math.random() * 2.2, 0, Math.PI * 2);
    g.fill();
  }
  // Erode holes so it reads gritty, not airbrushed.
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 36; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * 46;
    g.fillStyle = `rgba(0,0,0,${0.25 + Math.random() * 0.5})`;
    g.beginPath();
    g.arc(64 + Math.cos(a) * r, 64 + Math.sin(a) * r, 1 + Math.random() * 4, 0, Math.PI * 2);
    g.fill();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

export class Impacts {
  constructor(ctx) {
    this.ctx = ctx;

    this.params = {
      decalLife: 25,       // s
      decalSize: 0.13,     // m base quad size
      dustCount: 12,       // concrete puff particles
      sparkCount: 14,      // metal spark particles
      ricochetChance: 0.15,
      volume: 0.7,         // impact sound volume

      // ---- explosion (weapon:explosion) — counts/sizes/lifetimes are per unit
      //      of blast radius; scaled by def.explosion.radius at spawn time.
      exploCoreCount: 14,     // bright fireball core particles (per radius)
      exploCoreLife: 0.28,    // s
      exploCoreSize: 0.35,    // m (× radius)
      exploEmberCount: 34,    // outward sparks/embers (per radius)
      exploEmberLife: 0.55,   // s
      exploEmberSize: 0.05,   // m (× radius)
      exploEmberSpeed: 9,     // m/s (× radius)
      exploSmokeCount: 10,    // lingering grey smoke puff (per radius)
      exploSmokeLife: 1.1,    // s
      exploSmokeSize: 0.55,   // m (× radius)
      exploScorchSize: 0.9,   // ground scorch decal size (× radius)

      // ---- ricochet spark burst (weapon:bounce) — sawblade wall bounce.
      bounceSparkCount: 12,   // metallic sparks
      bounceSparkLife: 0.22,  // s
      bounceSparkSize: 0.022, // m
      bounceSparkSpeed: 11,   // m/s
    };

    const T = (key, prop, min, max, step, label) =>
      ctx.tunables.push({ cat: 'fx', key, obj: this.params, prop, min, max, step, label });
    T('decalLife', 'decalLife', 2, 60, 1, 'Decal life (s)');
    T('decalSize', 'decalSize', 0.02, 0.5, 0.01, 'Decal size (m)');
    T('impactDustCount', 'dustCount', 0, 40, 1, 'Concrete dust count');
    T('impactSparkCount', 'sparkCount', 0, 40, 1, 'Metal spark count');
    T('ricochetChance', 'ricochetChance', 0, 1, 0.01, 'Ricochet chance');
    T('impactVolume', 'volume', 0, 1, 0.05, 'Impact volume');
    T('exploCoreCount', 'exploCoreCount', 0, 60, 1, 'Explosion core count');
    T('exploCoreLife', 'exploCoreLife', 0.05, 1, 0.01, 'Explosion core life (s)');
    T('exploCoreSize', 'exploCoreSize', 0.05, 1.5, 0.01, 'Explosion core size ×r');
    T('exploEmberCount', 'exploEmberCount', 0, 120, 1, 'Explosion ember count');
    T('exploEmberLife', 'exploEmberLife', 0.1, 2, 0.01, 'Explosion ember life (s)');
    T('exploEmberSize', 'exploEmberSize', 0.01, 0.3, 0.005, 'Explosion ember size ×r');
    T('exploEmberSpeed', 'exploEmberSpeed', 1, 30, 0.5, 'Explosion ember speed ×r');
    T('exploSmokeCount', 'exploSmokeCount', 0, 60, 1, 'Explosion smoke count');
    T('exploSmokeLife', 'exploSmokeLife', 0.2, 3, 0.05, 'Explosion smoke life (s)');
    T('exploSmokeSize', 'exploSmokeSize', 0.1, 2, 0.05, 'Explosion smoke size ×r');
    T('exploScorchSize', 'exploScorchSize', 0.1, 3, 0.05, 'Explosion scorch size ×r');
    T('bounceSparkCount', 'bounceSparkCount', 0, 40, 1, 'Bounce spark count');
    T('bounceSparkLife', 'bounceSparkLife', 0.05, 1, 0.01, 'Bounce spark life (s)');
    T('bounceSparkSize', 'bounceSparkSize', 0.005, 0.1, 0.001, 'Bounce spark size (m)');
    T('bounceSparkSpeed', 'bounceSparkSpeed', 1, 30, 0.5, 'Bounce spark speed (m/s)');

    // ---- decal pool ---------------------------------------------------------
    const tex = makeScorchTexture();
    this.decalGeo = new THREE.PlaneGeometry(1, 1);
    this.decals = [];
    this._next = 0;
    for (let i = 0; i < DECALS; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        color: 0x191512,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
      const mesh = new THREE.Mesh(this.decalGeo, mat);
      mesh.visible = false;
      mesh.renderOrder = 2;
      ctx.scene.add(mesh);
      this.decals.push({ mesh, active: false, age: 0, life: 25, baseOpacity: 0.75 });
    }

    ctx.events.on('shot:impact', (d) => this._onImpact(d));
    ctx.events.on('weapon:explosion', (d) => this._onExplosion(d));
    ctx.events.on('weapon:bounce', (d) => this._onBounce(d));
  }

  // ---- weapon:explosion { point, radius, def } ----------------------------
  // Punchy multi-layer blast: a bright fast fireball core, an outward ember/
  // spark spray with gravity+drag, a lingering grey smoke puff, and a ground
  // scorch decal if a surface is close below. Counts/size/speed scale by the
  // blast radius. Visuals only — audio (weapon-logic) and shake (Feel) elsewhere.
  _onExplosion({ point, radius, def } = {}) {
    if (!point) return;
    const particles = this.ctx.fx?.particles;
    if (!particles) return;

    // Prefer the def-declared radius; fall back to the payload; then a default.
    const r = radius || def?.explosion?.radius || 5;
    const rn = r / 5; // normalized against the reference 5 m blast
    const P = this.params;

    // 1) Fireball core — few large, bright orange/white, very short life.
    particles.burst({
      position: point,
      count: Math.max(3, Math.round(P.exploCoreCount * rn)),
      color: 0xffe8b0,
      speed: 5 * rn,
      spread: 1,
      life: P.exploCoreLife,
      size: P.exploCoreSize * rn,
      gravity: 0,
      drag: 5,
    });
    particles.burst({
      position: point,
      count: Math.max(2, Math.round(P.exploCoreCount * 0.5 * rn)),
      color: 0xff7a2a,
      speed: 7 * rn,
      spread: 1,
      life: P.exploCoreLife * 1.3,
      size: P.exploCoreSize * 0.7 * rn,
      gravity: 0,
      drag: 4,
    });

    // 2) Ember/spark spray — many small, fast, gravity + drag.
    particles.burst({
      position: point,
      count: Math.round(P.exploEmberCount * rn),
      color: 0xffb04a,
      speed: P.exploEmberSpeed * rn,
      spread: 1,
      life: P.exploEmberLife,
      size: P.exploEmberSize * rn,
      gravity: 16,
      drag: 1.1,
    });
    particles.burst({
      position: point,
      count: Math.round(P.exploEmberCount * 0.4 * rn),
      color: 0xfff2c0,
      speed: P.exploEmberSpeed * 1.35 * rn,
      spread: 1,
      life: P.exploEmberLife * 0.6,
      size: P.exploEmberSize * 0.7 * rn,
      gravity: 12,
      drag: 0.9,
    });

    // 3) Lingering smoke puff — grey, slow, larger, drifts up slightly.
    particles.burst({
      position: point,
      count: Math.round(P.exploSmokeCount * rn),
      color: 0x4a4640,
      speed: 2.2 * rn,
      spread: 1,
      life: P.exploSmokeLife,
      size: P.exploSmokeSize * rn,
      gravity: -1.5, // negative → drifts upward
      drag: 2.4,
    });

    // 4) Ground scorch decal if a surface is close below the blast.
    try {
      const hit = this.ctx.world?.raycastShot?.(point, _down, r * 1.2);
      if (hit && hit.point && (hit.surface === 'concrete' || hit.surface === 'metal' || !hit.target)) {
        const n = hit.normal || _up;
        this._spawnDecal(hit.point, n, 0x0a0806, (P.exploScorchSize * rn) / this.params.decalSize);
      }
    } catch {
      /* world may not be ready — skip the decal */
    }
  }

  // ---- weapon:bounce { point, def } ---------------------------------------
  // Cheap bright metallic spark burst — the sawblade ricochet visual.
  _onBounce({ point } = {}) {
    if (!point) return;
    const particles = this.ctx.fx?.particles;
    if (!particles) return;
    const P = this.params;
    particles.burst({
      position: point,
      count: P.bounceSparkCount,
      color: 0xffd98a,
      speed: P.bounceSparkSpeed,
      spread: 1,
      life: P.bounceSparkLife,
      size: P.bounceSparkSize,
      gravity: 20,
      drag: 0.7,
    });
    particles.burst({
      position: point,
      count: Math.round(P.bounceSparkCount * 0.4),
      color: 0xfff6dc,
      speed: P.bounceSparkSpeed * 1.3,
      spread: 1,
      life: P.bounceSparkLife * 0.6,
      size: P.bounceSparkSize * 0.7,
      gravity: 16,
      drag: 0.5,
    });
  }

  _onImpact({ hit, def } = {}) {
    if (!hit || !hit.point) return;
    const p = hit.point;
    const n = hit.normal || _up;
    // Shotguns fire one impact per pellet — lighten each so 8 don't stack to a bonfire.
    const scale = def?.pellets ? 0.45 : 1;
    const particles = this.ctx.fx?.particles;
    const audio = this.ctx.audio;
    const vol = this.params.volume;
    const rate = 0.9 + Math.random() * 0.2;

    if (hit.surface === 'target' || hit.target) {
      // Light flash, thud, no decal — targets flash/move themselves.
      particles?.burst({
        position: p, count: Math.max(1, Math.round(7 * scale)), color: 0xcfe8ff,
        speed: 3.5, spread: 0.9, life: 0.2, size: 0.045, gravity: 0,
        direction: n, drag: 4,
      });
      audio?.play?.('impact_target', { position: p, volume: vol * 0.9, rate });
      return;
    }

    if (hit.surface === 'metal') {
      // Fast orange sparks + white-hot core, both pulled down by gravity.
      particles?.burst({
        position: p, count: Math.max(1, Math.round(this.params.sparkCount * scale)), color: 0xffb347,
        speed: 9, spread: 0.55, life: 0.32, size: 0.02, gravity: 22,
        direction: n, drag: 0.8,
      });
      particles?.burst({
        position: p, count: Math.max(1, Math.round(6 * scale)), color: 0xfff3d0,
        speed: 12, spread: 0.35, life: 0.18, size: 0.016, gravity: 18,
        direction: n, drag: 0.5,
      });
      this._spawnDecal(p, n, 0x0b0d10, 0.8);
      audio?.play?.('impact_metal', { position: p, volume: vol, rate });
      if (Math.random() < this.params.ricochetChance) {
        audio?.play?.('ricochet', { position: p, volume: vol * 0.9, rate: 0.95 + Math.random() * 0.1 });
      }
      return;
    }

    // concrete (and any unknown surface — default to dust).
    particles?.burst({
      position: p, count: Math.max(1, Math.round(this.params.dustCount * scale)), color: 0xa89a82,
      speed: 2.8, spread: 0.85, life: 0.5, size: 0.055, gravity: 3,
      direction: n, drag: 3,
    });
    particles?.burst({
      position: p, count: Math.max(1, Math.round(5 * scale)), color: 0x6b6157,
      speed: 6, spread: 0.6, life: 0.35, size: 0.02, gravity: 14,
      direction: n, drag: 0.5,
    });
    this._spawnDecal(p, n, 0x191512, 1);
    audio?.play?.('impact_concrete', { position: p, volume: vol, rate });
  }

  _spawnDecal(point, normal, tint, sizeMult) {
    const d = this.decals[this._next];
    this._next = (this._next + 1) % DECALS;

    d.active = true;
    d.age = 0;
    d.life = this.params.decalLife;
    d.baseOpacity = 0.7 + Math.random() * 0.15;

    const m = d.mesh;
    _n.copy(normal).normalize();
    m.position.copy(point).addScaledVector(_n, 0.003); // 3 mm off the surface
    _q.setFromUnitVectors(_z, _n);
    m.quaternion.copy(_q);
    m.rotateZ(Math.random() * Math.PI * 2);
    const s = this.params.decalSize * sizeMult * (0.8 + Math.random() * 0.6);
    m.scale.set(s, s, 1);
    m.material.color.set(tint);
    m.material.opacity = d.baseOpacity;
    m.visible = true;
  }

  render(dt) {
    for (const d of this.decals) {
      if (!d.active) continue;
      d.age += dt;
      const t = d.age / d.life;
      if (t >= 1) {
        d.active = false;
        d.mesh.visible = false;
        continue;
      }
      // Hold, then fade over the last 40% of life.
      d.mesh.material.opacity = d.baseOpacity * (t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4);
    }
  }
}
