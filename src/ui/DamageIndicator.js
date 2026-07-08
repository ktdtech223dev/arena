// ARENA client — ui/DamageIndicator.js
// Full-screen NON-interactive "got shot" feedback overlay, mounted into #ui.
// Two effects, both pure DOM/CSS built in code (no assets, no THREE materials):
//
//   (1) DIRECTIONAL ARCS — when the local player takes damage from a known
//       attacker, a red wedge/arc appears at the screen edge pointing toward
//       where the shot came from (computed from the attacker's world pos vs the
//       player's pos + camera yaw). Multiple hits STACK (each is its own fading
//       div). If the attacker is unknown (null), a full-ring flash is shown.
//
//   (2) RED VIGNETTE — a radial-gradient div flashes red, its peak opacity
//       scaled by the damage taken (bigger hit = stronger), then decays.
//
// Everything advances in update(dt) so it is framerate-independent. The overlay
// is pointer-events:none (never the "interactive" class) so it never eats input.
//
// Angle convention (matches the rest of ARENA): ctx.player.camera.yaw is in
// DEGREES with 0 facing -Z. Forward at yaw=0 is (0,0,-1); +yaw turns right
// (toward +X). We compute the horizontal bearing from the player to the
// attacker, subtract the camera yaw to get a screen-relative angle, and rotate
// the arc so 0 = straight ahead (top of screen), +90 = right, 180 = behind.

// Pure DOM/CSS + scalar math — no THREE geometry/material needed here; the arc
// bearing comes from the ctx's plain position/yaw numbers.

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

// tunables
const ARC_LIFE = 1.2;          // s — how long a directional arc lives
const RING_LIFE = 0.9;         // s — generic (unknown-source) ring flash life
const VIGNETTE_LIFE = 0.85;    // s — red screen vignette decay
const VIGNETTE_MIN = 0.16;     // peak opacity for a tiny hit
const VIGNETTE_MAX = 0.66;     // peak opacity for a big hit
const VIGNETTE_FULL_DMG = 60;  // dmg at which the vignette hits VIGNETTE_MAX
const MAX_ARCS = 8;            // hard cap on stacked arcs (perf/cleanliness)

const CSS = `
.dmg-root{position:absolute;inset:0;overflow:hidden;pointer-events:none;
  contain:strict;}
/* red edge vignette that flashes on hit */
.dmg-vignette{position:absolute;inset:0;opacity:0;will-change:opacity;
  background:radial-gradient(ellipse 130% 120% at 50% 50%,
    rgba(255,20,20,0) 42%, rgba(255,16,16,0.35) 74%, rgba(200,0,0,0.85) 100%);
  mix-blend-mode:normal;}
/* directional arcs live in a centered layer we rotate each arc within */
.dmg-arcs{position:absolute;left:50%;top:50%;width:0;height:0;}
/* one arc = a rotated container whose child is a red gradient wedge pushed out
   to the screen edge; rotating the container aims it, the wedge shows the hit
   direction as a soft arc segment. */
.dmg-arc{position:absolute;left:0;top:0;width:0;height:0;will-change:opacity,transform;
  transform-origin:0 0;}
.dmg-arc-wedge{position:absolute;left:-160px;top:-300px;width:320px;height:180px;
  border-radius:0 0 200px 200px / 0 0 160px 160px;
  background:radial-gradient(120% 150% at 50% 0%,
    rgba(255,40,40,0.92) 0%, rgba(255,30,30,0.55) 34%, rgba(255,20,20,0) 72%);
  filter:blur(1px);}
/* generic full-ring flash for unknown attacker */
.dmg-ring{position:absolute;inset:0;will-change:opacity;
  box-shadow:inset 0 0 120px 30px rgba(255,20,20,0.75),
             inset 0 0 40px 8px rgba(255,60,60,0.55);}
`;

function injectCss(id, text) {
  if (typeof document === 'undefined') return;
  if (document.getElementById(id)) return;
  const s = document.createElement('style');
  s.id = id;
  s.textContent = text;
  document.head.appendChild(s);
}

function el(tag, cls, parent) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (parent) parent.appendChild(e);
  return e;
}

export class DamageIndicator {
  /**
   * @param {object} ctx  RANGE/ARENA ctx. Reads ctx.player.controller.position
   *   (THREE.Vector3, feet) and ctx.player.camera.yaw (degrees, 0 = -Z).
   */
  constructor(ctx) {
    this.ctx = ctx;
    this.w = (typeof window !== 'undefined' && window.innerWidth) || 1280;
    this.h = (typeof window !== 'undefined' && window.innerHeight) || 720;
    this.radius = Math.hypot(this.w, this.h) * 0.5; // push arcs out past the edge

    this._arcs = [];      // { node, angleRad (screen-relative), life, t }
    this._rings = [];     // { node, life, t }
    this._vig = 0;        // current vignette intensity (opacity)
    this._vigLife = 0;    // remaining vignette decay time
    this._vigPeak = 0;    // this flash's peak opacity

    this._buildDom();
  }

  _buildDom() {
    if (typeof document === 'undefined') return;
    injectCss('dmg-indicator-css', CSS);
    const parent = document.getElementById('ui') || document.body;
    this._root = el('div', 'dmg-root', parent);
    this._vignetteEl = el('div', 'dmg-vignette', this._root);
    this._arcsLayer = el('div', 'dmg-arcs', this._root);
  }

  /**
   * The local player took damage.
   * @param {THREE.Vector3|{x,y,z}|null} fromWorldPos  attacker world pos, or
   *   null/undefined for an unknown source (shows a generic ring flash).
   * @param {number} dmg  damage taken (scales the vignette intensity).
   */
  hit(fromWorldPos, dmg = 0) {
    // --- red vignette: peak scales with dmg, take the stronger of any active ---
    const frac = Math.min(1, Math.max(0, (dmg || 0) / VIGNETTE_FULL_DMG));
    const peak = VIGNETTE_MIN + (VIGNETTE_MAX - VIGNETTE_MIN) * frac;
    if (peak >= this._vig) {
      this._vigPeak = peak;
      this._vig = peak;
      this._vigLife = VIGNETTE_LIFE;
    } else {
      // a small hit on top of a big fading one: refresh the tail a little
      this._vigLife = Math.max(this._vigLife, VIGNETTE_LIFE * 0.5);
    }

    // --- directional arc (or ring if attacker unknown) ---
    const angle = this._screenAngle(fromWorldPos);
    if (angle === null) {
      this._spawnRing();
    } else {
      this._spawnArc(angle);
    }
  }

  // Horizontal screen-relative angle (radians), measured CLOCKWISE from straight
  // ahead (top of screen): 0 = attacker dead ahead, +PI/2 = to our right,
  // ±PI = behind, -PI/2 = to our left. Returns null if the source is unknown or
  // coincident with the player.
  //
  // We project the (world-space) direction to the attacker onto the camera's
  // own forward/right basis, so this is correct regardless of the exact yaw sign
  // convention. Camera basis (Camera.js): forward = (-sin y, 0, -cos y),
  // right = (cos y, 0, -sin y), with yaw in degrees.
  _screenAngle(fromWorldPos) {
    if (!fromWorldPos) return null;
    const p = this.ctx?.player?.controller?.position;
    if (!p) return null;
    const dx = fromWorldPos.x - p.x;
    const dz = fromWorldPos.z - p.z;
    if (dx * dx + dz * dz < 1e-6) return null;

    const yaw = (this.ctx?.player?.camera?.yaw || 0) * DEG2RAD;
    const sy = Math.sin(yaw), cy = Math.cos(yaw);
    // component along camera forward (how "in front" the attacker is)
    const f = dx * (-sy) + dz * (-cy);
    // component along camera right (how far to our right)
    const r = dx * cy + dz * (-sy);
    // atan2(right, forward): +right rotates the arc clockwise (matches CSS).
    return Math.atan2(r, f);
  }

  _spawnArc(angleRad) {
    if (!this._arcsLayer) return;
    const node = el('div', 'dmg-arc', this._arcsLayer);
    el('div', 'dmg-arc-wedge', node);
    // rotate: CSS rotate(0) points the wedge "up" (top of screen). A screen
    // angle of 0 means the hit came from straight ahead → keep it at top.
    // Positive angle (attacker to our right) rotates clockwise.
    node.style.transform =
      `rotate(${angleRad * RAD2DEG}deg) translateY(${-this.radius}px)`;
    const arc = { node, life: ARC_LIFE, t: ARC_LIFE };
    this._arcs.push(arc);
    // cap: retire the oldest immediately if we overflow
    while (this._arcs.length > MAX_ARCS) {
      const old = this._arcs.shift();
      if (old?.node?.parentNode) old.node.parentNode.removeChild(old.node);
    }
  }

  _spawnRing() {
    if (!this._root) return;
    const node = el('div', 'dmg-ring', this._root);
    this._rings.push({ node, life: RING_LIFE, t: RING_LIFE });
  }

  /** Advance all fades. dt in seconds (framerate-independent). */
  update(dt) {
    const d = dt > 0 ? dt : 0;

    // vignette decay (ease-out-ish: opacity tracks remaining life fraction)
    if (this._vigLife > 0) {
      this._vigLife -= d;
      if (this._vigLife <= 0) {
        this._vigLife = 0;
        this._vig = 0;
      } else {
        const f = this._vigLife / VIGNETTE_LIFE;
        this._vig = this._vigPeak * f * f; // quadratic falloff
      }
      if (this._vignetteEl) this._vignetteEl.style.opacity = this._vig.toFixed(3);
    }

    // directional arcs
    for (let i = this._arcs.length - 1; i >= 0; i--) {
      const a = this._arcs[i];
      a.t -= d;
      if (a.t <= 0) {
        if (a.node.parentNode) a.node.parentNode.removeChild(a.node);
        this._arcs.splice(i, 1);
        continue;
      }
      const f = a.t / a.life;
      // fade in fast, fade out over the tail
      a.node.style.opacity = (f > 0.85 ? (1 - f) / 0.15 : f).toFixed(3);
    }

    // generic rings
    for (let i = this._rings.length - 1; i >= 0; i--) {
      const r = this._rings[i];
      r.t -= d;
      if (r.t <= 0) {
        if (r.node.parentNode) r.node.parentNode.removeChild(r.node);
        this._rings.splice(i, 1);
        continue;
      }
      const f = r.t / r.life;
      r.node.style.opacity = (f > 0.8 ? (1 - f) / 0.2 : f).toFixed(3);
    }
  }

  /** Viewport changed — recompute the edge radius for new arcs. */
  resize(w, h) {
    this.w = w || this.w;
    this.h = h || this.h;
    this.radius = Math.hypot(this.w, this.h) * 0.5;
  }

  /** Tear down DOM + clear state. */
  dispose() {
    for (const a of this._arcs) if (a.node?.parentNode) a.node.parentNode.removeChild(a.node);
    for (const r of this._rings) if (r.node?.parentNode) r.node.parentNode.removeChild(r.node);
    this._arcs.length = 0;
    this._rings.length = 0;
    if (this._root && this._root.parentNode) this._root.parentNode.removeChild(this._root);
    this._root = null;
    this._vignetteEl = null;
    this._arcsLayer = null;
  }
}
