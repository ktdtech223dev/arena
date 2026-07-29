// RANGE — Feel.js (agent E)
// The "juice" layer that makes shots and hits feel physical:
//   • weapon:fired  -> MUZZLE FLASH (additive quad + PointLight at the muzzle in
//                      the VIEWMODEL scene), a brief WORLD PointLight at the
//                      world-space muzzle (splashes light on nearby walls), and
//                      camera shake scaled by def.feel.shake.
//   • target:hit    -> HITSTOP (ctx.loop.setTimescale(0.05, def.feel.hitstopMs)).
//   • target:killed -> longer HITSTOP (def.feel.hitstopKillMs) + tiny extra shake.
//
// Everything is pooled / reused; every magnitude is a tunable (cat 'feel').
// No raw GLSL — the flash is a Sprite with an additive canvas texture (built-in
// SpriteMaterial, node-converted by the renderer; identical on WebGPU/WebGL2).
import * as THREE from 'three';

function clampRange(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

// ---------------------------------------------------------------------------
// Radial-falloff flash texture (code-generated canvas — zero assets).
// White-hot core → warm mid → transparent edge, drawn additively.
// ---------------------------------------------------------------------------
function makeFlashTexture() {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grd.addColorStop(0.0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.18, 'rgba(255,246,214,0.95)');
  grd.addColorStop(0.42, 'rgba(255,196,92,0.55)');
  grd.addColorStop(0.75, 'rgba(255,120,40,0.14)');
  grd.addColorStop(1.0, 'rgba(255,80,20,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// A 4-point "star" flash texture for a bit of spike variety on bigger guns.
function makeSpikeTexture() {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  g.translate(s / 2, s / 2);
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.2;
    const len = i % 2 === 0 ? s * 0.48 : s * 0.3;
    const grd = g.createLinearGradient(0, 0, Math.cos(a) * len, Math.sin(a) * len);
    grd.addColorStop(0, 'rgba(255,240,200,0.9)');
    grd.addColorStop(1, 'rgba(255,150,60,0)');
    g.strokeStyle = grd;
    g.lineWidth = 6;
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(Math.cos(a) * len, Math.sin(a) * len);
    g.stroke();
  }
  return new THREE.CanvasTexture(c);
}

export class Feel {
  constructor(ctx) {
    this.ctx = ctx;

    // ---- tunables (cat 'feel') ----
    this.p = {
      flashScale: 0.16,     // base flash quad size (m) at feel.flash = 1
      flashMinFrames: 1,
      flashMaxFrames: 2,
      flashLightVm: 6.0,    // vm-scene point light peak intensity at flash = 1
      flashLightWorld: 9.0, // world-scene point light peak intensity at flash = 1
      flashLightRange: 5.5, // world light range (m)
      flashColor: 0xffd29a, // warm muzzle color
      shakeMult: 1.0,       // global shake multiplier on def.feel.shake
      killShake: 0.12,      // extra shake on kill
      hitstopMult: 1.0,     // global hitstop multiplier
      hitstopScale: 0.05,   // timescale during hitstop
      hitstopMinInterval: 120, // ms — min real-time start-to-start gap between
                               // regular-hit hitstops (stops full-auto fire from
                               // strobing the loop timescale). Kills bypass it.
      fovKick: 0.02,        // FOV punch fraction per shot at flash = 1

      // ---- weapon:explosion (rocket blast) ----
      explShake: 1.6,       // base camera shake for a blast (× def.feel.shake × radius/5)
      explHitstopMs: 140,   // real-time ms of the forced explosion hitstop
      explFov: 0.06,        // FOV punch fraction on a blast
      explLightWorld: 26,   // world point-light peak intensity at the blast point
      explLightRange: 14,   // world blast-light range (m) at radius 5
      explLightMs: 260,     // ms the blast light takes to fade out
      explColor: 0xffb14a,  // warm fireball light color
    };

    // Hitstop throttle state (the full-auto stutter fix). Firing full-auto INTO
    // a target lands ~12-15 hits/sec; the old code called setTimescale(0.05, ms)
    // on EVERY hit, yanking the loop's fixed-step accumulator 1↔0.05 every few
    // frames (starve-then-burst) which reads as a periodic frame hitch. Now a hit
    // won't re-set the timescale while a stop is already running (it only extends
    // it), and fresh regular stops are rate-limited by hitstopMinInterval. Single
    // shots (pistol/shotgun/sniper/AR-tap) are naturally spaced far past that
    // interval, so their full meaty hitstop is preserved; kills bypass it. These
    // clocks use performance.now() to match the Loop's own real-time restore
    // clock — this is juice feedback, not gameplay math, so it is not bound by
    // the loop.time rule.
    this._hitstopEndsAt = 0;       // performance.now() ms when the active stop restores
    this._hitstopStartedAt = -1e9; // performance.now() ms the last stop STARTED
    const T = (key, prop, min, max, step, label) =>
      ctx.tunables.push({ cat: 'feel', key, obj: this.p, prop, min, max, step, label });
    T('flashScale', 'flashScale', 0.02, 0.5, 0.005, 'Flash size (m)');
    T('flashLightVm', 'flashLightVm', 0, 20, 0.5, 'Flash light (vm)');
    T('flashLightWorld', 'flashLightWorld', 0, 30, 0.5, 'Flash light (world)');
    T('flashLightRange', 'flashLightRange', 1, 15, 0.5, 'World light range');
    T('shakeMult', 'shakeMult', 0, 3, 0.05, 'Shake ×');
    T('killShake', 'killShake', 0, 0.5, 0.01, 'Kill shake');
    T('hitstopMult', 'hitstopMult', 0, 2, 0.05, 'Hitstop ×');
    T('hitstopScale', 'hitstopScale', 0.01, 0.5, 0.01, 'Hitstop timescale');
    T('hitstopMinInterval', 'hitstopMinInterval', 0, 300, 5, 'Hitstop min gap (ms)');
    T('fovKick', 'fovKick', 0, 0.1, 0.002, 'FOV kick');
    T('explShake', 'explShake', 0, 4, 0.05, 'Explosion shake');
    T('explHitstopMs', 'explHitstopMs', 0, 400, 5, 'Explosion hitstop (ms)');
    T('explFov', 'explFov', 0, 0.2, 0.005, 'Explosion FOV');
    T('explLightWorld', 'explLightWorld', 0, 60, 1, 'Blast light');
    T('explLightRange', 'explLightRange', 2, 30, 0.5, 'Blast light range');
    T('explLightMs', 'explLightMs', 40, 600, 10, 'Blast light fade (ms)');

    // ---- flash textures + material ----
    this._flashTex = makeFlashTexture();
    this._spikeTex = makeSpikeTexture();

    // A muzzle flash lives in the VIEWMODEL scene (so it's clipped/lit like the
    // gun). We create it lazily once the vm scene exists.
    this._flash = null;      // Sprite (core glow)
    this._spike = null;      // Sprite (star spikes)
    this._vmLight = null;    // PointLight in vm scene
    this._worldLight = null; // PointLight in world scene
    this._flashLife = 0;     // seconds remaining
    this._flashDur = 0;      // total duration for fade
    this._flashPeak = 0;     // peak intensity for this shot

    this._worldMuzzle = new THREE.Vector3();
    this._v = new THREE.Vector3();

    // ---- world-space blast light (pooled/reused, distinct from muzzle flash) ----
    this._blastLight = null;   // PointLight in the WORLD scene
    this._blastLife = 0;       // seconds remaining
    this._blastDur = 0;        // total fade duration
    this._blastPeak = 0;       // peak intensity for this blast

    // ---- wire events ----
    this._unsub = [];
    const on = (n, fn) => this._unsub.push(ctx.events.on(n, (e) => { if (e && e.offhand) return; fn(e); })); // offhand gun: Viewmodel owns its feel
    on('weapon:fired', (e) => this._onFired(e));
    on('target:hit', (e) => this._onHit(e));
    on('target:killed', (e) => this._onKilled(e));
    on('weapon:explosion', (e) => this._onExplosion(e));
  }

  // Lazily build the flash objects the first time we fire (vm scene is ready by
  // then; the world scene always exists).
  _ensureFlash() {
    if (this._flash) return;
    const vm = this.ctx.viewmodel;
    const vmScene = vm?.scene;
    if (!vmScene) return;

    const spriteMat = () => new THREE.SpriteMaterial({
      map: this._flashTex,
      color: this.p.flashColor,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity: 0,
      toneMapped: false,
    });

    this._flash = new THREE.Sprite(spriteMat());
    this._flash.visible = false;
    this._flash.renderOrder = 999;
    vmScene.add(this._flash);

    this._spike = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this._spikeTex,
      color: this.p.flashColor,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity: 0,
      toneMapped: false,
    }));
    this._spike.visible = false;
    this._spike.renderOrder = 998;
    vmScene.add(this._spike);

    // NOTE: these lights stay .visible=true forever and are turned "off" by
    // setting intensity=0. Toggling a light's .visible changes the scene's light
    // count and forces the WebGPU renderer to REBUILD the pipeline — doing that
    // on every shot is the per-shot FPS jolt. Intensity-only = zero recompiles.
    this._vmLight = new THREE.PointLight(this.p.flashColor, 0, 3, 2);
    vmScene.add(this._vmLight);

    this._worldLight = new THREE.PointLight(this.p.flashColor, 0, this.p.flashLightRange, 2);
    this.ctx.scene.add(this._worldLight);
  }

  // =========================================================================
  // events
  // =========================================================================
  _onFired(e) {
    const def = e?.def ?? this.ctx.weapons?.current?.def;
    const flash = def?.feel?.flash ?? 0.6;
    const shake = def?.feel?.shake ?? 0.2;

    this._ensureFlash();

    // ---- muzzle flash placement (viewmodel scene) ----
    const parts = this.ctx.viewmodel?.getParts?.();
    const muzzle = parts?.muzzle;
    if (this._flash && muzzle) {
      // muzzle position in the vm scene == its world-camera-space position;
      // the flash sprites live in the vm scene so we place them there directly.
      muzzle.updateWorldMatrix(true, false);
      this._flash.position.setFromMatrixPosition(muzzle.matrixWorld);
      this._spike.position.copy(this._flash.position);

      const size = this.p.flashScale * (0.6 + flash);
      // per-shot jitter so repeated shots don't look like a static decal
      const jitter = 0.85 + Math.random() * 0.4;
      this._flash.scale.setScalar(size * jitter);
      this._spike.scale.setScalar(size * 2.1 * jitter);
      this._flash.material.rotation = Math.random() * Math.PI * 2;
      this._spike.material.rotation = Math.random() * Math.PI * 2;

      this._flash.visible = true;
      this._spike.visible = flash >= 0.7; // spikes only on the bigger guns (ar/shotgun/sniper)
      this._flashPeak = flash;
      this._flashDur = (this.p.flashMinFrames + (this.p.flashMaxFrames - this.p.flashMinFrames) * Math.random()) / 60;
      this._flashLife = this._flashDur;

      // vm-scene point light co-located with the flash
      if (this._vmLight) {
        this._vmLight.position.copy(this._flash.position);
        this._vmLight.color.set(this.p.flashColor);
        this._vmLight.intensity = this.p.flashLightVm * (0.5 + flash);
      }
    }

    // ---- brief WORLD point light at the world-space muzzle ----
    if (this._worldLight) {
      const wp = this.ctx.viewmodel?.getMuzzleWorld?.(this._worldMuzzle) || this._worldMuzzle;
      this._worldLight.position.copy(wp);
      this._worldLight.color.set(this.p.flashColor);
      this._worldLight.intensity = this.p.flashLightWorld * (0.5 + flash);
      this._worldLight.distance = this.p.flashLightRange;
    }

    // ---- camera shake + FOV punch ----
    const cam = this.ctx.player?.camera;
    cam?.addShake?.(shake * this.p.shakeMult);
    cam?.addFovKick?.(this.p.fovKick * (0.5 + flash));
  }

  _onHit(e) {
    const def = e?.def ?? this.ctx.weapons?.current?.def;
    if (e?.kill) return; // killed handler owns the bigger stop
    const ms = (def?.feel?.hitstopMs ?? 0) * this.p.hitstopMult;
    // Regular hits are throttled: full-auto fire lands many hits/sec and must
    // NOT re-strobe the timescale (see _triggerHitstop / _hitstopEndsAt).
    this._triggerHitstop(ms, false);
  }

  _onKilled(e) {
    // hitstop length from the gun that FIRED the kill (carried on the event) so a
    // quickswap or in-flight projectile kill still uses the right weapon's feel.
    const def = e?.def ?? this.ctx.weapons?.current?.def;
    const ms = (def?.feel?.hitstopKillMs ?? def?.feel?.hitstopMs ?? 0) * this.p.hitstopMult;
    // Kills are the important punctuation and are rare relative to hits, so they
    // punch through the throttle — but still won't SHORTEN an active longer stop.
    this._triggerHitstop(ms, true);
    // additive so the kill punctuation still registers on top of the fire shake
    this.ctx.player?.camera?.addShakeImpulse?.(this.p.killShake);
  }

  // weapon:explosion { point, radius, def } — a BIG feel punch. NO audio (weapon
  // logic plays the explosion sound) and NO particles (fx agent spawns them);
  // this owns the world-space blast LIGHT, a strong camera shake, and a long
  // forced hitstop distinct from the per-shot flash light above.
  _onExplosion(e) {
    const point = e?.point;
    const radius = e?.radius ?? 5;
    const def = e?.def ?? this.ctx.weapons?.current?.def;
    const feelShake = def?.feel?.shake ?? 0.5;

    // radius scales the intensity: a 5 m blast is the reference.
    const rScale = radius / 5;

    // strong camera shake (scaled by radius / def.feel.shake) + a FOV punch
    const cam = this.ctx.player?.camera;
    const shakeAmt = this.p.explShake * feelShake * clampRange(rScale, 0.4, 2.2);
    cam?.addShake?.(shakeAmt);
    cam?.addShakeImpulse?.(shakeAmt * 0.6);
    cam?.addFovKick?.(this.p.explFov * rScale);

    // longer FORCED hitstop — the blast always lands its stop (force=true).
    this._triggerHitstop(this.p.explHitstopMs, true);

    // bright, brief WORLD point light at the blast point (pooled/reused, fades).
    if (point) {
      this._ensureBlastLight();
      if (this._blastLight) {
        this._blastLight.position.copy(point);
        this._blastLight.color.set(this.p.explColor);
        this._blastLight.distance = this.p.explLightRange * clampRange(rScale, 0.5, 2.5);
        this._blastPeak = this.p.explLightWorld * clampRange(rScale, 0.5, 2.2);
        this._blastLight.intensity = this._blastPeak;
        this._blastDur = Math.max(0.02, this.p.explLightMs / 1000);
        this._blastLife = this._blastDur;
      }
    }
  }

  _ensureBlastLight() {
    if (this._blastLight) return;
    if (!this.ctx.scene) return;
    this._blastLight = new THREE.PointLight(this.p.explColor, 0, this.p.explLightRange, 2);
    this.ctx.scene.add(this._blastLight);
  }

  // Trigger a hitstop of `ms` real-time milliseconds, guarded so sustained
  // automatic fire can't yank the loop timescale on every bullet.
  //   • If a hitstop is already running, we DON'T re-set the timescale (which
  //     would restart the 1→0.05 strobe on the accumulator); we only EXTEND the
  //     restore point when the new stop wants to run longer. The loop is already
  //     holding timescale at 0.05, so this just pushes out its restore time —
  //     no second 1→0.05 transition, no burst/starve.
  //   • Once a stop ends, a fresh regular-hit stop (force=false) can only START
  //     again after hitstopMinInterval ms have passed since the last one STARTED.
  //     A 950-rpm SMG lands a hit every ~63 ms; the interval collapses that from
  //     ~15 timescale flips/sec down to a handful, so sustained fire reads smooth
  //     instead of strobing. Single shots (pistol/shotgun/sniper/AR-tap) are
  //     spaced far past the interval, so their full meaty hitstop is untouched.
  //   • Kills (force=true) bypass the interval — they're rare and are the stop
  //     that matters — but still won't restart an already-running stop.
  _triggerHitstop(ms, force) {
    if (!(ms > 0)) return;
    const loop = this.ctx.loop;
    if (!loop?.setTimescale) return;

    const now = performance.now();

    // A stop is currently running: extend-only, never re-strobe.
    if (now < this._hitstopEndsAt) {
      const newEnd = now + ms;
      if (newEnd > this._hitstopEndsAt) {
        this._hitstopEndsAt = newEnd;
        loop.setTimescale(this.p.hitstopScale, ms);
      }
      return;
    }

    // No stop running: rate-limit fresh regular stops by start-to-start gap.
    if (!force && now - this._hitstopStartedAt < this.p.hitstopMinInterval) return;

    this._hitstopStartedAt = now;
    this._hitstopEndsAt = now + ms;
    loop.setTimescale(this.p.hitstopScale, ms);
  }

  // =========================================================================
  // lifecycle
  // =========================================================================
  fixedUpdate(dt) {
    // nothing gameplay-affecting here; hitstop is driven by the Loop timescale.
  }

  render(dt, alpha) {
    if (dt <= 0) dt = 1 / 120;
    if (this._flashLife > 0) {
      this._flashLife -= dt;
      const k = Math.max(0, this._flashLife / Math.max(0.0001, this._flashDur)); // 1 -> 0
      // sharp on, quick fall (square keeps it punchy)
      const a = k * k;
      if (this._flash) this._flash.material.opacity = a * (0.7 + this._flashPeak * 0.5);
      if (this._spike && this._spike.visible) this._spike.material.opacity = a * 0.7;
      if (this._vmLight) this._vmLight.intensity = this.p.flashLightVm * (0.5 + this._flashPeak) * a;
      if (this._worldLight) this._worldLight.intensity = this.p.flashLightWorld * (0.5 + this._flashPeak) * a;

      if (this._flashLife <= 0) {
        if (this._flash) { this._flash.visible = false; this._flash.material.opacity = 0; }
        if (this._spike) { this._spike.visible = false; this._spike.material.opacity = 0; }
        // lights: intensity 0 ONLY — never toggle .visible (pipeline recompile)
        if (this._vmLight) this._vmLight.intensity = 0;
        if (this._worldLight) this._worldLight.intensity = 0;
      }
    }

    // ---- world-space blast light fade (explosion) ----
    if (this._blastLife > 0 && this._blastLight) {
      this._blastLife -= dt;
      const k = Math.max(0, this._blastLife / Math.max(0.0001, this._blastDur)); // 1 -> 0
      // bright pop then a smoother fireball falloff (k^1.5 keeps some afterglow)
      const a = k * Math.sqrt(k);
      this._blastLight.intensity = this._blastPeak * a;
      if (this._blastLife <= 0) this._blastLight.intensity = 0; // never toggle .visible
    }
  }

  dispose() {
    for (const u of this._unsub) u();
    this._unsub.length = 0;
  }
}
