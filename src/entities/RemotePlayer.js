// entities/RemotePlayer.js — an interpolated remote player in the shared arena.
//
// ARENA-ARCHITECTURE §7. Wraps an Avatar (crew color) + a floating NAMEPLATE
// (canvas-texture Sprite, always camera-facing because it's a Sprite) + a small
// HP BAR above the head (also a canvas-texture Sprite, redrawn when hp changes).
//
// The net-core (Interpolation.js) creates one RemotePlayer per remote on join and,
// every frame, calls:
//     applyInterpolated({ pos, yaw, pitch, state, ground, vel, hp, firing })
//     update(dt)
// applyInterpolated sets the transform + stashes movement state; update(dt) runs
// the pose blends (calling avatar.pose) and scales the nameplate with distance
// (reads ctx.camera position).
//
// Nameplate + HP bar use code-generated CanvasTexture — NO asset files. Built-in
// materials only (auto-convert under WebGPURenderer). No raw GLSL.

import * as THREE from 'three';
import { Avatar } from './Avatar.js';

const HEAD_TOP_Y = 1.9;   // approx top-of-head in avatar local space (feet at 0)

export class RemotePlayer {
  // ctx  : shared world ctx ({ scene, camera, ... })
  // info : { id, crew, name, color, weaponId }
  constructor(ctx, info = {}) {
    this.ctx = ctx;
    this.id = info.id;
    this.crew = info.crew;
    this.name = info.name || info.crew || 'PLAYER';
    this.color = info.color ?? 0x7df9ff;
    this.weaponId = info.weaponId || 'pistol';

    // ---- avatar ------------------------------------------------------------
    this.avatar = new Avatar({ color: this.color });
    this.avatar.setWeapon(this.weaponId); // show the joined-with weapon at spawn
    ctx.scene.add(this.avatar.group);

    // ---- last-applied networked state (posed every update) -----------------
    this._state = {
      state: 'GROUNDED', speed: 0, yaw: 0, pitch: 0,
      firing: false, grounded: true,
    };
    this.hp = 100;
    this.alive = true;

    // ---- nameplate + hp bar (canvas-texture sprites) -----------------------
    this._buildNameplate();
    this._buildHpBar();

    // dispose bookkeeping
    this._disposables = [];
  }

  // ---- overhead UI --------------------------------------------------------
  _buildNameplate() {
    const cv = document.createElement('canvas');
    cv.width = 256; cv.height = 64;
    this._nameCanvas = cv;
    this._nameTex = new THREE.CanvasTexture(cv);
    this._nameTex.colorSpace = THREE.SRGBColorSpace;
    this._nameTex.anisotropy = 4;

    const mat = new THREE.SpriteMaterial({
      map: this._nameTex,
      transparent: true,
      depthTest: true,
      depthWrite: false,
    });
    this._nameMat = mat;
    this._nameSprite = new THREE.Sprite(mat);
    // world size of the sprite (metres) — base; update() scales with distance
    this._nameBaseScale = { x: 1.2, y: 0.3 };
    this._nameSprite.scale.set(this._nameBaseScale.x, this._nameBaseScale.y, 1);
    this._nameSprite.position.set(0, HEAD_TOP_Y + 0.42, 0);
    this.avatar.group.add(this._nameSprite);

    this._drawNameplate();
  }

  _drawNameplate() {
    const cv = this._nameCanvas;
    const g = cv.getContext('2d');
    g.clearRect(0, 0, cv.width, cv.height);

    const hex = '#' + new THREE.Color(this.color).getHexString();
    g.font = 'bold 34px Consolas, "Courier New", monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';

    const text = this.name.toUpperCase();
    // dark pill backing for legibility against the arena
    const tw = Math.min(g.measureText(text).width + 28, cv.width - 6);
    g.fillStyle = 'rgba(6,8,12,0.62)';
    this._roundRect(g, (cv.width - tw) / 2, 12, tw, 40, 10);
    g.fill();

    // crew-colored text with a subtle dark outline
    g.lineWidth = 5;
    g.strokeStyle = 'rgba(0,0,0,0.85)';
    g.strokeText(text, cv.width / 2, 33);
    g.fillStyle = hex;
    g.fillText(text, cv.width / 2, 33);

    this._nameTex.needsUpdate = true;
  }

  _buildHpBar() {
    const cv = document.createElement('canvas');
    cv.width = 128; cv.height = 24;
    this._hpCanvas = cv;
    this._hpTex = new THREE.CanvasTexture(cv);
    this._hpTex.colorSpace = THREE.SRGBColorSpace;

    const mat = new THREE.SpriteMaterial({
      map: this._hpTex,
      transparent: true,
      depthTest: true,
      depthWrite: false,
    });
    this._hpMat = mat;
    this._hpSprite = new THREE.Sprite(mat);
    this._hpBaseScale = { x: 1.0, y: 0.16 };
    this._hpSprite.scale.set(this._hpBaseScale.x, this._hpBaseScale.y, 1);
    this._hpSprite.position.set(0, HEAD_TOP_Y + 0.2, 0);
    this.avatar.group.add(this._hpSprite);

    this._drawHpBar(1);
  }

  _drawHpBar(frac) {
    const cv = this._hpCanvas;
    const g = cv.getContext('2d');
    const w = cv.width, h = cv.height;
    g.clearRect(0, 0, w, h);

    const pad = 3;
    // frame / backing
    g.fillStyle = 'rgba(6,8,12,0.7)';
    this._roundRect(g, 0, 0, w, h, 6);
    g.fill();

    const iw = w - pad * 2, ih = h - pad * 2;
    // empty track
    g.fillStyle = 'rgba(40,44,52,0.9)';
    this._roundRect(g, pad, pad, iw, ih, 4);
    g.fill();

    // fill — green→amber→red by health
    const f = THREE.MathUtils.clamp(frac, 0, 1);
    let col;
    if (f > 0.5) col = '#51e898';
    else if (f > 0.25) col = '#ffd166';
    else col = '#ff5252';
    if (f > 0.001) {
      g.fillStyle = col;
      this._roundRect(g, pad, pad, Math.max(iw * f, 4), ih, 4);
      g.fill();
    }

    this._hpTex.needsUpdate = true;
  }

  _roundRect(g, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    g.beginPath();
    g.moveTo(x + rr, y);
    g.arcTo(x + w, y, x + w, y + h, rr);
    g.arcTo(x + w, y + h, x, y + h, rr);
    g.arcTo(x, y + h, x, y, rr);
    g.arcTo(x, y, x + w, y, rr);
    g.closePath();
  }

  // ---- net-core surface ---------------------------------------------------
  // applyInterpolated(s): consume the interpolated transform+state from
  // Interpolation.js. Sets the avatar group to the FEET position `pos`, stashes
  // movement state (speed derived from horizontal velocity), updates the HP bar,
  // and hides/dims on death. Does NOT itself blend — that happens in update(dt).
  applyInterpolated(s = {}) {
    const pos = s.pos || { x: 0, y: 0, z: 0 };
    this.avatar.group.position.set(pos.x, pos.y, pos.z);

    const vx = s.vel?.x ?? 0, vz = s.vel?.z ?? 0;
    this._state.speed = Math.hypot(vx, vz);
    this._state.yaw = s.yaw ?? this._state.yaw;
    this._state.pitch = s.pitch ?? this._state.pitch;
    this._state.state = s.state || this._state.state;
    this._state.grounded = s.ground ?? this._state.grounded;
    this._state.firing = !!s.firing;

    // held weapon display — swap the avatar's gun silhouette when it changes.
    // Cache last id so we don't rebuild/re-swap every frame (setWeapon is also
    // a no-op on unchanged id, but this avoids the call entirely).
    const weaponId = s.weaponId;
    if (weaponId != null && weaponId !== this.weaponId) {
      this.weaponId = weaponId;
      this.avatar.setWeapon(weaponId);
    }

    // health / death handling
    if (typeof s.hp === 'number') {
      const clamped = THREE.MathUtils.clamp(s.hp, 0, 100);
      if (clamped !== this.hp) {
        this.hp = clamped;
        this._drawHpBar(this.hp / 100);
      }
    }
    const alive = this.hp > 0;
    if (alive !== this.alive) {
      this.alive = alive;
      this._setDead(!alive);
    }
  }

  // Dim + hide overhead UI on death; the avatar dims to a "downed" grey. When
  // revived (respawn sends hp>0) restore full visibility + crew color.
  _setDead(dead) {
    this._nameSprite.visible = !dead;
    this._hpSprite.visible = !dead;
    const dim = dead ? 0.18 : 1;
    this.avatar._bodyMat.opacity = dim;
    this.avatar._limbMat.opacity = dim;
    this.avatar._accentMat.emissiveIntensity = dead ? 0.0 : 1.4;
    const trans = dead;
    for (const m of this.avatar._materials) {
      m.transparent = trans;
      m.opacity = trans ? dim : 1;
      m.needsUpdate = true;
    }
  }

  // update(dt): advance the avatar pose blends from the last applied state, and
  // scale the nameplate/hp bar with camera distance so they stay legible.
  update(dt) {
    const st = this._state;
    this.avatar.pose({
      state: st.state,
      speed: st.speed,
      yaw: st.yaw,
      pitch: st.pitch,
      firing: st.firing,
      grounded: st.grounded,
      dt,
    });

    if (!this.alive) return; // nameplate hidden while dead

    // distance-scale overhead UI: grow modestly with distance so far players stay
    // readable, but cap it so nearby players aren't huge. (camera-facing is free —
    // Sprites always face the camera.)
    const cam = this.ctx?.camera;
    if (cam) {
      const gp = this.avatar.group.position;
      const dx = cam.position.x - gp.x;
      const dy = cam.position.y - gp.y;
      const dz = cam.position.z - gp.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      // scale factor: 1 at ~8 m, growing ~linearly, clamped to keep sanity
      const k = THREE.MathUtils.clamp(0.55 + dist * 0.055, 0.7, 2.4);
      this._nameSprite.scale.set(this._nameBaseScale.x * k, this._nameBaseScale.y * k, 1);
      this._hpSprite.scale.set(this._hpBaseScale.x * k, this._hpBaseScale.y * k, 1);
    }
  }

  // ---- misc api -----------------------------------------------------------
  setName(name) {
    this.name = name || this.name;
    this._drawNameplate();
  }

  setColor(hex) {
    this.color = hex;
    this.avatar.setColor(hex);
    this._drawNameplate(); // crew-colored text follows
  }

  dispose() {
    // remove overhead sprites + free their textures/materials
    if (this._nameSprite?.parent) this._nameSprite.parent.remove(this._nameSprite);
    if (this._hpSprite?.parent) this._hpSprite.parent.remove(this._hpSprite);
    this._nameTex?.dispose();
    this._hpTex?.dispose();
    this._nameMat?.dispose();
    this._hpMat?.dispose();

    // avatar.dispose() removes its group from the scene + frees geo/mats
    this.avatar.dispose();
  }
}
