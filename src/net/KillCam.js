// ARENA client — net/KillCam.js
// Death spectator cam (ARENA-ARCHITECTURE §13.4). On the LOCAL player's death,
// take over the camera for the respawn delay and spectate the killer: ease a
// third-person view a few meters behind + above the killer's avatar and look at
// them, with a centered "KILLED BY ‹name›" banner + subtle dark letterbox.
//
// If the killer is unknown (suicide / world / left the game) we hold a slow
// orbit around the local death position instead.
//
// Camera control model: this runs AFTER CameraFX in the frame, so it OVERWRITES
// ctx.camera.position + ctx.camera.quaternion while active. It does not fight
// CameraFX — it simply overwrites the composed transform for the death window.
// The wiring in ArenaMode calls start() on `death` (id === me) and stop() on
// `respawn` (id === me).
//
// DOM banner mounts into #ui (NON-interactive — no 'interactive' class, never
// captures the pointer). Built-in DOM/CSS only; no assets, no raw GLSL.

import * as THREE from 'three';

const DEG2RAD = Math.PI / 180;

// Frame-rate-independent exponential smoothing: move `cur` toward `target`,
// reaching (1 - e^-rate*dt) of the remaining gap each frame (rate = snappiness).
function expApproach(cur, target, rate, dt) {
  return cur + (target - cur) * (1 - Math.exp(-rate * dt));
}

function injectCss(id, text) {
  if (typeof document === 'undefined' || document.getElementById(id)) return;
  const s = document.createElement('style');
  s.id = id;
  s.textContent = text;
  document.head.appendChild(s);
}

// spectate framing (metres, relative to the killer's avatar)
const SPEC_BACK = 4.2;    // distance behind the killer along their facing
const SPEC_SIDE = 1.1;    // slight shoulder offset so we're not dead-center
const SPEC_UP = 2.3;      // camera height above the killer's feet
const LOOK_UP = 1.35;     // look-at target height above the killer's feet
const EASE_RATE = 4.5;    // camera follow easing (higher = snappier)

// orbit framing when there's no killer to spectate
const ORBIT_RADIUS = 5.5;
const ORBIT_HEIGHT = 2.6;
const ORBIT_SPEED = 24;   // degrees / second

const CSS = `
.killcam-root{position:absolute;inset:0;pointer-events:none;opacity:0;transition:opacity .28s ease;font-family:'Segoe UI',system-ui,-apple-system,sans-serif;}
.killcam-root.show{opacity:1;}
.killcam-bar{position:absolute;left:0;right:0;height:11vh;background:linear-gradient(rgba(4,6,10,0.92),rgba(4,6,10,0));}
.killcam-bar.top{top:0;}
.killcam-bar.bot{bottom:0;transform:scaleY(-1);}
.killcam-center{position:absolute;left:50%;top:33%;transform:translate(-50%,-50%);text-align:center;text-shadow:0 2px 14px rgba(0,0,0,.85),0 0 30px rgba(0,0,0,.6);}
.killcam-tag{font-size:12px;letter-spacing:.42em;color:#ff5b5b;text-transform:uppercase;opacity:.9;margin-bottom:6px;}
.killcam-name{font-size:40px;font-weight:800;letter-spacing:.02em;line-height:1;color:#f2f6fb;}
.killcam-count{margin-top:14px;font-size:13px;letter-spacing:.24em;color:#9fb0c2;text-transform:uppercase;font-variant-numeric:tabular-nums;}
.killcam-count b{color:#eaf2fb;font-weight:700;}
`;

export class KillCam {
  // ctx : shared world ctx ({ camera, player.controller.position, ... })
  constructor(ctx) {
    this.ctx = ctx;
    this._active = false;

    this._killer = null;       // killer's RemotePlayer (or null for world/self)
    this._killerName = '';
    this._durationMs = 0;
    this._remainMs = 0;

    // orbit fallback anchor + angle
    this._orbitCenter = new THREE.Vector3();
    this._orbitAngle = 0;

    // eased camera state (so the takeover glides in rather than snapping)
    this._camPos = new THREE.Vector3();
    this._lookAt = new THREE.Vector3();
    this._lookCur = new THREE.Vector3();
    this._primed = false;      // false until the first update seeds the eased pos

    // scratch
    this._tmp = new THREE.Vector3();
    this._tmp2 = new THREE.Vector3();
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._up = new THREE.Vector3(0, 1, 0);

    this._buildDom();
    this._lastShownCount = -1;
  }

  get active() { return this._active; }

  // ---- lifecycle -----------------------------------------------------------

  // start(killerObject, killerName, durationMs)
  //   killerObject : the killer's RemotePlayer (has .avatar.group) or null
  //                  (suicide / world damage / killer already left).
  //   killerName   : display name for the banner.
  //   durationMs   : how long the kill cam holds (respawn delay).
  start(killerObject, killerName, durationMs) {
    this._killer = killerObject || null;
    this._killerName = killerName || 'THE VOID';
    this._durationMs = Math.max(0, durationMs || 0);
    this._remainMs = this._durationMs;
    this._active = true;
    this._primed = false; // re-seed the eased camera on the first update

    // snapshot the local death position as the orbit anchor (used if there's no
    // killer avatar to follow).
    const feet = this.ctx?.player?.controller?.position;
    if (feet) this._orbitCenter.copy(feet);
    else this._orbitCenter.set(0, 0, 0);
    this._orbitAngle = (this.ctx?.player?.camera?.yaw || 0) * DEG2RAD;

    // banner
    if (this._nameEl) this._nameEl.textContent = String(this._killerName).toUpperCase();
    if (this._tagEl) this._tagEl.textContent = this._killer ? 'Killed by' : 'You died';
    this._lastShownCount = -1;
    this._updateCountdownLabel();
    if (this._root) this._root.classList.add('show');
  }

  // update(dt): drive ctx.camera to spectate. Called every render frame AFTER
  // CameraFX, so we overwrite the composed camera transform while active.
  update(dt) {
    if (!this._active) return;

    // countdown (banner only; the actual respawn is server-driven via ArenaMode).
    this._remainMs = Math.max(0, this._remainMs - dt * 1000);
    this._updateCountdownLabel();

    const cam = this.ctx?.camera;
    if (!cam) return;

    // resolve the desired camera pose + look target for this frame
    if (this._killer && this._killer.avatar && this._killer.avatar.group) {
      this._framedFromKiller(dt);
    } else {
      this._framedFromOrbit(dt);
    }

    // seed the eased state on the first frame so we don't glide in from a stale
    // origin (e.g. the previous frame's first-person eye).
    if (!this._primed) {
      this._camPos.copy(this._tmp);      // _tmp = desired pos (set by framing)
      this._lookCur.copy(this._lookAt);
      this._primed = true;
    } else {
      const k = EASE_RATE;
      this._camPos.x = expApproach(this._camPos.x, this._tmp.x, k, dt);
      this._camPos.y = expApproach(this._camPos.y, this._tmp.y, k, dt);
      this._camPos.z = expApproach(this._camPos.z, this._tmp.z, k, dt);
      this._lookCur.x = expApproach(this._lookCur.x, this._lookAt.x, k, dt);
      this._lookCur.y = expApproach(this._lookCur.y, this._lookAt.y, k, dt);
      this._lookCur.z = expApproach(this._lookCur.z, this._lookAt.z, k, dt);
    }

    // write the transform (OVERRIDES CameraFX for this frame)
    cam.position.copy(this._camPos);
    this._m.lookAt(this._camPos, this._lookCur, this._up);
    this._q.setFromRotationMatrix(this._m);
    cam.quaternion.copy(this._q);
  }

  // desired pose behind + above the killer, looking at their upper body.
  _framedFromKiller(dt) {
    const g = this._killer.avatar.group;
    const feet = g.position;

    // killer facing on the XZ plane from their avatar yaw. Avatars rotate their
    // group.rotation.y to the networked yaw; derive forward from that so we sit
    // behind whichever way they're facing. yaw 0 faces -Z (project convention).
    const yaw = g.rotation?.y || 0;
    const fwdX = -Math.sin(yaw), fwdZ = -Math.cos(yaw);
    const rightX = Math.cos(yaw), rightZ = -Math.sin(yaw);

    // desired camera position: behind (−forward), a shoulder to the side, up.
    this._tmp.set(
      feet.x - fwdX * SPEC_BACK + rightX * SPEC_SIDE,
      feet.y + SPEC_UP,
      feet.z - fwdZ * SPEC_BACK + rightZ * SPEC_SIDE,
    );
    // look at the killer's upper body/head height.
    this._lookAt.set(feet.x, feet.y + LOOK_UP, feet.z);
  }

  // no killer to follow: slow orbit around the local death position.
  _framedFromOrbit(dt) {
    this._orbitAngle += ORBIT_SPEED * DEG2RAD * dt;
    const c = this._orbitCenter;
    this._tmp.set(
      c.x + Math.sin(this._orbitAngle) * ORBIT_RADIUS,
      c.y + ORBIT_HEIGHT,
      c.z + Math.cos(this._orbitAngle) * ORBIT_RADIUS,
    );
    // look at roughly eye-height over the death spot.
    this._lookAt.set(c.x, c.y + LOOK_UP, c.z);
  }

  // stop(): end the kill cam, hide the banner. First-person resumes next frame
  // because CameraFX writes the camera before we (no longer) overwrite it.
  stop() {
    this._active = false;
    this._killer = null;
    this._primed = false;
    if (this._root) this._root.classList.remove('show');
  }

  // ---- banner --------------------------------------------------------------

  _buildDom() {
    if (typeof document === 'undefined') return;
    injectCss('killcam-css', CSS);

    const parent = document.getElementById('ui') || document.body;
    const root = document.createElement('div');
    root.className = 'killcam-root'; // NON-interactive: no 'interactive' class
    parent.appendChild(root);
    this._root = root;

    const top = document.createElement('div'); top.className = 'killcam-bar top'; root.appendChild(top);
    const bot = document.createElement('div'); bot.className = 'killcam-bar bot'; root.appendChild(bot);

    const center = document.createElement('div'); center.className = 'killcam-center'; root.appendChild(center);
    this._tagEl = document.createElement('div'); this._tagEl.className = 'killcam-tag'; this._tagEl.textContent = 'Killed by'; center.appendChild(this._tagEl);
    this._nameEl = document.createElement('div'); this._nameEl.className = 'killcam-name'; center.appendChild(this._nameEl);
    this._countEl = document.createElement('div'); this._countEl.className = 'killcam-count'; center.appendChild(this._countEl);
  }

  _updateCountdownLabel() {
    if (!this._countEl) return;
    const secs = Math.ceil(this._remainMs / 1000);
    if (secs === this._lastShownCount) return; // only touch the DOM on a change
    this._lastShownCount = secs;
    if (secs > 0) this._countEl.innerHTML = `Respawn in <b>${secs}</b>`;
    else this._countEl.textContent = 'Respawning…';
  }

  // ---- misc ----------------------------------------------------------------

  resize(/* w, h */) { /* CSS is viewport-relative; nothing to recompute */ }

  dispose() {
    this._active = false;
    this._killer = null;
    if (this._root && this._root.parentNode) this._root.parentNode.removeChild(this._root);
    this._root = null;
    this._tagEl = this._nameEl = this._countEl = null;
  }
}
