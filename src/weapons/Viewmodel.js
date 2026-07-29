// RANGE — Viewmodel.js (agent E)
// The first-person viewmodel: its OWN THREE.Scene + PerspectiveCamera (rendered
// after the world by main.js with a cleared depth buffer), code-built stylized
// ARMS (trigger hand on the grip, support hand that ACTUALLY reaches to the
// mag / pump / bolt / charging handle during actions), and the animated gun
// model. Owns one GunAnim and drives it every frame.
//
// Coordinate note: the viewmodel camera sits at the ORIGIN of the viewmodel
// scene looking down −Z (identity transform). So a point's position in the vm
// scene IS its position in the world camera's local (camera) space, and we can
// map it to WORLD space by transforming through ctx.camera.matrixWorld. This is
// exactly what getMuzzleWorld() / getPartWorld() do — muzzle flashes, shell
// ejects and tracer origins all line up with what the player sees.
import * as THREE from 'three';
import { buildWeaponModel } from './WeaponModels.js';
import { GunAnim } from './GunAnim.js';

const DEG = Math.PI / 180;

// ---------------------------------------------------------------------------
// Arm/hand material palette (dark grey glove + cyan cuff).
// Built-in materials — the renderer node-converts them; both backends fine.
// ---------------------------------------------------------------------------
function mat(color, opts = {}) {
  const { rough = 0.7, metal = 0.1, emissive = 0x000000, glow = 1.5 } = opts;
  return new THREE.MeshStandardMaterial({
    color, roughness: rough, metalness: metal,
    emissive, emissiveIntensity: emissive ? glow : 1,
  });
}

// Rounded-ish box via a bevelled BoxGeometry substitute: a plain box is fine for
// the stylized look; we keep segments low. (No asset files, no extra deps.)
function boxMesh(matl, w, h, d) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), matl);
  m.castShadow = false; m.receiveShadow = false;
  return m;
}

// Build one arm: upper + forearm segments + a boxy gloved hand group with a few
// finger nubs. Returns { group, hand } where `hand` is the sub-group we pose to
// grip/support. The arm segments passively follow via simple look-at fixups done
// in render (kept cheap: we just translate the whole arm group so the hand sits
// where GunAnim wants it, and let the elbow trail).
function buildArm(side /* -1 left, +1 right */) {
  const glove = mat(0x2a2e35, { rough: 0.85, metal: 0.05 });
  const dark = mat(0x1b1e24, { rough: 0.8, metal: 0.05 });
  const cuff = mat(0x0c3a44, { rough: 0.4, metal: 0.2, emissive: 0x35e0ff, glow: 1.6 });
  const sleeve = mat(0x33383f, { rough: 0.75, metal: 0.08 });

  const group = new THREE.Group();

  // forearm sleeve (points from the hand back toward the shoulder, +Z is back)
  const forearm = boxMesh(sleeve, 0.05, 0.05, 0.2);
  forearm.position.set(0, 0, 0.13);
  group.add(forearm);

  // glowing cyan cuff ring near the wrist
  const cuffRing = boxMesh(cuff, 0.056, 0.056, 0.022);
  cuffRing.position.set(0, 0, 0.03);
  group.add(cuffRing);

  // upper-arm stub trailing further back (gives the elbow some mass)
  const upper = boxMesh(sleeve, 0.045, 0.045, 0.16);
  upper.position.set(side * 0.03, 0.02, 0.26);
  upper.rotation.x = 0.25;
  group.add(upper);

  // ---- hand group (posed to the grip/part) ----
  const hand = new THREE.Group();
  group.add(hand);

  const palm = boxMesh(glove, 0.05, 0.062, 0.05);
  hand.add(palm);

  // knuckle ridge
  const knuck = boxMesh(dark, 0.052, 0.02, 0.05);
  knuck.position.set(0, 0.03, -0.005);
  hand.add(knuck);

  // four curled fingers wrapping forward/down (−Z, −Y)
  const fingers = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const f = boxMesh(glove, 0.011, 0.038, 0.026);
    f.position.set(-0.018 + i * 0.012, -0.026, -0.02);
    f.rotation.x = -0.9;
    fingers.add(f);
  }
  hand.add(fingers);
  hand.userData.fingers = fingers;

  // thumb across the top
  const thumb = boxMesh(glove, 0.014, 0.014, 0.036);
  thumb.position.set(side * 0.026, 0.006, -0.006);
  thumb.rotation.set(0, side * 0.5, 0);
  hand.add(thumb);
  hand.userData.thumb = thumb;

  // trigger finger (right hand only) — one finger that reaches into the guard
  if (side > 0) {
    const trig = boxMesh(glove, 0.011, 0.014, 0.04);
    trig.position.set(-0.006, -0.02, -0.03);
    trig.rotation.x = -0.5;
    hand.add(trig);
    hand.userData.triggerFinger = trig;
  }

  group.userData.hand = hand;
  return { group, hand };
}

export class Viewmodel {
  constructor(ctx) {
    this.ctx = ctx;

    // ---- scene + camera ----
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(58, 1, 0.01, 5);
    this.camera.position.set(0, 0, 0);
    this.camera.rotation.set(0, 0, 0);
    this.scene.add(this.camera);

    // ---- lights (soft key + ambient in the vm scene only) ----
    const key = new THREE.DirectionalLight(0xfff0e0, 2.2);
    key.position.set(-0.4, 0.8, 0.6);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x9fd4ff, 0.9);
    rim.position.set(0.6, 0.2, -0.5);
    this.scene.add(rim);
    const amb = new THREE.HemisphereLight(0x8899bb, 0x111318, 0.9);
    this.scene.add(amb);
    // A small point light lives near the muzzle for Feel to control (Feel reads
    // this.scene; it can add its own). We keep just the ambient set here.

    // ---- mount: the whole weapon+arms rig hangs off this node ----
    // GunAnim drives `mount` transform (position ~ hip pose). Arms parent to the
    // mount so they move with the gun; the support hand is re-posed each frame.
    this.mount = new THREE.Group();
    this.scene.add(this.mount);

    // per-gun mount offset (fine alignment on top of meta.hip). Kept internal.
    this._mountOffsets = {
      pistol: { pos: [0, 0, 0], rot: [0, 0, 0] },
      smg: { pos: [0, 0.005, 0], rot: [0, 0, 0] },
      shotgun: { pos: [0, 0.01, 0.02], rot: [0, 0, 0] },
      ar: { pos: [0, 0.005, 0], rot: [0, 0, 0] },
      sniper: { pos: [0, 0.012, 0.02], rot: [0, 0, 0] },
      // heavier/bigger guns: pull back + down a touch so the fat silhouettes
      // frame nicely and don't clip the near plane / eat the whole screen.
      exotic: { pos: [0, 0.006, 0.04], rot: [0, 0, 0] },
      sawblade: { pos: [0, 0.006, 0.02], rot: [0, 0, 0] },
    };

    // ---- arms (each arm's built-in hand sub-group is the poser) ----
    const rightArm = buildArm(+1);
    const leftArm = buildArm(-1);
    this.rightArm = rightArm.group;
    this.leftArm = leftArm.group;
    this.mount.add(this.rightArm);
    this.mount.add(this.leftArm);

    // arms trail back from the base of the screen toward the shoulders
    this.rightArm.position.set(0.02, -0.02, 0.16);
    this.leftArm.position.set(-0.02, -0.03, 0.05);

    // ---- model cache (built lazily per gun id) ----
    this._models = new Map(); // id -> { group, parts, meta }
    this.current = null;      // active model
    this.currentId = null;

    // ---- animation driver ----
    this.anim = new GunAnim(ctx);

    // spring the support hand so it glides rather than snaps between poses
    this._leftTarget = new THREE.Vector3();
    this._leftCur = new THREE.Vector3(-0.02, -0.06, -0.16);
    this._leftVis = 1; // support-hand blend (kept visible; could hide during throws)

    // reusable scratch
    this._m4 = new THREE.Matrix4();
    this._v = new THREE.Vector3();
    this._q = new THREE.Quaternion();

    // ---- OFFHAND (dual-wield left gun): its own mount, mirrored to the left of
    // the screen; a simple kick spring on fire (the full GunAnim only drives the
    // right gun). Models cached separately so the same gun id can exist in both hands.
    this.offMount = new THREE.Group();
    this.offMount.visible = false;
    this.scene.add(this.offMount);
    this._offModels = new Map(); // id -> { group, parts, meta }
    this._offCur = null;
    this._offBase = { pos: [0, 0, 0], rot: [0, 0, 0] };
    this._offKick = 0;

    // ---- camo progression: per-weapon kill counts → material tint tier ----
    this._weaponKills = {};
    import('../core/Profile.js').then(({ getStats }) => getStats()).then((s) => {
      this._weaponKills = (s && s.weaponKills) || {};
      if (this.current && this.currentId) this._applyCamo(this.current, this.currentId);
    }).catch(() => { /* offline/dev — stock camo */ });

    // ---- events ----
    this._unsub = [];
    this._unsub.push(ctx.events.on('weapon:equip', (e) => this._onEquip(e)));
    this._unsub.push(ctx.events.on('dual:exit', () => this._clearOffhand()));
    this._unsub.push(ctx.events.on('weapon:fired', (e) => { if (e?.side === 'L') this._offKick = 1; }));

    // tunable: overall viewmodel FOV + a global scale hook
    this._vmFov = 58;
    ctx.tunables.push({
      cat: 'viewmodel', key: 'vmFov', min: 40, max: 80, step: 1, label: 'Viewmodel FOV',
      get: () => this._vmFov,
      set: (v) => { this._vmFov = v; this.camera.fov = v; this.camera.updateProjectionMatrix(); },
    });
  }

  // ---- read-only getters for Feel / logic ----------------------------------
  getParts() { return this.current?.parts ?? null; }
  get currentParts() { return this.current?.parts ?? null; }
  getModelGroup() { return this.current?.group ?? null; }

  // =========================================================================
  // equip: build/cache the model, show it, hide the others.
  // =========================================================================
  _onEquip(e) {
    const def = e?.def;
    if (!def) return;
    if (e.offhand) { this._onOffEquip(def); return; } // dual-wield LEFT gun → offMount
    const id = def.id;
    let model = this._models.get(id);
    if (!model) {
      model = buildWeaponModel(def);
      model.group.visible = false;
      this.mount.add(model.group);
      this._models.set(id, model);
    }
    // hide every other model
    for (const [mid, m] of this._models) m.group.visible = mid === id;

    this.current = model;
    this.currentId = id;

    // apply the per-gun mount offset (small alignment on top of the meta.hip
    // pose that GunAnim applies to the model group itself)
    const off = this._mountOffsets[id] || { pos: [0, 0, 0], rot: [0, 0, 0] };
    this.mount.position.set(off.pos[0], off.pos[1], off.pos[2]);
    this.mount.rotation.set(off.rot[0], off.rot[1], off.rot[2]);

    // hand the model to the animator
    this.anim.setModel(model);

    // right hand grips per gun (meta.gripR). Support hand handled per frame.
    this._poseRightHand(model);

    // camo tier tint (per-weapon kills; see core/Profile.js CAMO_TIERS)
    this._applyCamo(model, id);
  }

  // Tint the model's lit materials toward the unlocked camo tier color. Cached
  // models re-tint only when the tier changes; glow/basic materials untouched.
  _applyCamo(model, id) {
    import('../core/Profile.js').then(({ camoForKills }) => {
      const tier = camoForKills(this._weaponKills[id] | 0);
      if (!tier || model._camoName === tier.name) return;
      model._camoName = tier.name;
      if (!tier.tint) return; // STOCK — leave the authored look
      model.group.traverse((o) => {
        if (!o.isMesh || !o.material || !o.material.isMeshStandardMaterial) return;
        if (!o.material.userData.baseColor) o.material.userData.baseColor = o.material.color.getHex();
        o.material.color.setHex(o.material.userData.baseColor);
        o.material.color.lerp(new THREE.Color(tier.tint), 0.4);
      });
    }).catch(() => { /* stock */ });
  }

  // ---- OFFHAND (dual-wield left gun) ---------------------------------------
  // Build/show the left gun on its own mount, mirrored from the gun's hip pose.
  // The left support ARM is hidden while dual (it can't grip two things at once).
  _onOffEquip(def) {
    let model = this._offModels.get(def.id);
    if (!model) {
      model = buildWeaponModel(def);
      this.offMount.add(model.group);
      this._offModels.set(def.id, model);
    }
    for (const [mid, m] of this._offModels) m.group.visible = mid === def.id;
    this._offCur = model;
    const hip = model.meta?.hip || { pos: [0.22, -0.22, -0.42], rot: [0, 0.05, 0.03] };
    // mirror: left of screen, yaw/roll flipped
    this._offBase.pos = [-hip.pos[0], hip.pos[1], hip.pos[2]];
    this._offBase.rot = [hip.rot[0], -hip.rot[1], -hip.rot[2]];
    this.offMount.position.set(...this._offBase.pos);
    this.offMount.rotation.set(...this._offBase.rot);
    this.offMount.visible = true;
    this._offKick = 0;
    this.leftArm.visible = false;
  }

  _clearOffhand() {
    this.offMount.visible = false;
    for (const m of this._offModels.values()) m.group.visible = false;
    this._offCur = null;
    this.leftArm.visible = true;
  }

  _poseRightHand(model) {
    const gr = model?.meta?.gripR || { pos: [0, -0.05, 0.03], rot: [0.12, 0, 0] };
    // Parent the whole right arm under the gun group so the trigger hand rides
    // recoil / reload / bob with the gun for free. The arm's own hand sub-group
    // sits at the arm origin, so we place the arm origin AT the grip point.
    if (this.rightArm.parent !== model.group) model.group.add(this.rightArm);
    this.rightArm.position.set(gr.pos[0], gr.pos[1], gr.pos[2]);
    this.rightArm.rotation.set(gr.rot[0], gr.rot[1], gr.rot[2]);
  }

  // =========================================================================
  // lifecycle
  // =========================================================================
  fixedUpdate(dt) {
    this.anim.fixedUpdate?.(dt);
  }

  render(dt, alpha) {
    // drive the gun pose
    this.anim.render?.(dt, alpha);

    // pose the support (left) hand toward the animator's target pose.
    this._updateSupportHand(dt);

    // OFFHAND kick spring: recoil the left gun back + pitch up, exponential decay.
    if (this._offCur && this.offMount.visible) {
      this._offKick = Math.max(0, this._offKick - dt * 7);
      const k = this._offKick * this._offKick; // ease-out
      const b = this._offBase;
      this.offMount.position.set(b.pos[0], b.pos[1] + k * 0.012, b.pos[2] + k * 0.07);
      this.offMount.rotation.set(b.rot[0] - k * 0.16, b.rot[1], b.rot[2]);
    }
  }

  _updateSupportHand(dt) {
    const model = this.current;
    if (!model) return;
    const st = this.anim.getSupportTarget?.(this._v);
    if (!st) return;

    // st.pos is LOCAL to the gun root (model.group). We want the left hand+arm
    // to sit there in that same frame, so parent the left arm under the model
    // group and lerp its local position toward the target.
    if (this.leftArm.parent !== model.group) model.group.add(this.leftArm);
    this._leftTarget.copy(st.pos);

    // exponential glide so hand travel between poses looks organic, not snapped
    const rate = st.pose === 'grip' ? 12 : 16;
    const t = 1 - Math.exp(-rate * Math.min(dt, 0.05));
    this._leftCur.lerp(this._leftTarget, t);
    this.leftArm.position.copy(this._leftCur);

    // orient the hand toward the gun centerline; add a little pose-specific tilt
    const rot = st.rot || [0.15, 0, 0];
    let addRX = 0, addRY = 0;
    if (st.pose === 'mag') { addRX = 0.2; }
    else if (st.pose === 'pump' || st.pose === 'boltHandle') { addRX = 0.1; }
    else if (st.pose === 'port') { addRX = 0.35; addRY = 0.2; }
    this.leftArm.rotation.set(rot[0] + addRX, rot[1] + addRY, rot[2]);

    // make sure the left arm's built-in hand sub-group is the visible poser
    if (this.leftArm.userData.hand) this.leftArm.userData.hand.visible = true;
  }

  // =========================================================================
  // World-space transforms (the whole reason the vm-camera sits at origin).
  // A point in the vm scene == a point in world-camera space; transform it
  // through ctx.camera.matrixWorld to get true world coordinates.
  // =========================================================================

  // Muzzle tip in WORLD space.
  getMuzzleWorld(out) {
    const o = out || new THREE.Vector3();
    const parts = this.current?.parts;
    if (!parts?.muzzle) {
      // fallback: a bit in front of the camera
      const cam = this.ctx.camera;
      if (cam) {
        cam.getWorldDirection(o);
        return o.multiplyScalar(0.6).add(cam.getWorldPosition(this._v));
      }
      return o.set(0, 0, 0);
    }
    return this.getPartWorld(parts.muzzle, o);
  }

  // Any viewmodel Object3D -> WORLD space (used for muzzle + shell eject).
  getPartWorld(obj, out) {
    const o = out || new THREE.Vector3();
    if (!obj) return o.set(0, 0, 0);
    // ensure the vm scene graph matrices are current (main renders vm AFTER we
    // return, so world matrices from the previous frame's render are stale by a
    // frame; update just this subtree's chain to be exact).
    obj.updateWorldMatrix(true, false);
    o.setFromMatrixPosition(obj.matrixWorld); // position in vm scene == cam-space
    const cam = this.ctx.camera;
    if (cam) {
      cam.updateWorldMatrix(true, false);
      o.applyMatrix4(cam.matrixWorld); // cam-space -> world
    }
    return o;
  }

  // =========================================================================
  resize(w, h) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    for (const u of this._unsub) u();
    this._unsub.length = 0;
    this.anim.dispose?.();
  }
}
