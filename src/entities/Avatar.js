// entities/Avatar.js — code-built stylized low-poly humanoid remote-player avatar.
//
// ARENA-ARCHITECTURE §2/§7. A grey-box humanoid assembled from THREE primitives
// (head / torso / hips / 2 upper+lower arms / 2 upper+lower legs / held-gun stub)
// in the crew color with an emissive rim/visor accent. ~1.8 m standing, feet at
// group origin y=0 so `this.group.position` matches the server foot position.
//
// pose() PROCEDURALLY poses the limbs each frame from the networked MoveState:
//   idle (subtle breathe), run (leg + opposite-arm cycle scaled by speed),
//   AIRBORNE (tucked legs), SLIDING (crouched low + forward lean),
//   WALLRUN (body angled + outside arm out), shoot (firing → arm recoil pose).
// All pose transitions are smoothed via frame-rate-independent exp-approach so
// nothing snaps. Legs cycle by an internal phase advanced by speed*dt.
//
// Yaw convention (matches the camera): yaw is DEGREES, yaw 0 faces -Z. We map
// that to the group's Y rotation as atan2(sin,cos) around -Z.
//
// NO raw GLSL / ShaderMaterial. Built-in MeshStandardMaterial (auto-converts to
// node materials under WebGPURenderer). NO external assets.

import * as THREE from 'three';

const DEG = Math.PI / 180;

// Frame-rate-independent exponential approach. `rate` ~ how fast (per second).
// Returns the new value moved from `cur` toward `target`.
function approach(cur, target, rate, dt) {
  const a = 1 - Math.exp(-rate * dt);
  return cur + (target - cur) * a;
}

// Shortest-arc angular approach (radians), so limb angles never wind the long way.
function approachAngle(cur, target, rate, dt) {
  let d = target - cur;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  const a = 1 - Math.exp(-rate * dt);
  return cur + d * a;
}

// ---- weapon silhouette builders -------------------------------------------
// Each builder(a) returns a THREE.Group of primitives, parented into the held
// gun slot (a.gun). Forward is -Z (muzzle direction). Bodies use a._gunMat
// (dark metal); accents use a._accentMat (crew color) so you can read the
// carrier's team on their gun. Kept small & distinct so the shape reads at a
// glance across the arena rather than the exact model.
const WEAPON_BUILDERS = {
  // pistol: small stubby body + short grip, tiny muzzle.
  pistol(a) {
    const g = new THREE.Group();
    const body = a._mkBox(0.07, 0.11, 0.24, a._gunMat);
    body.position.set(0, 0.02, -0.10);
    g.add(body);
    const grip = a._mkBox(0.06, 0.14, 0.08, a._gunMat);
    grip.position.set(0, -0.08, 0.0);
    grip.rotation.x = 0.2;
    g.add(grip);
    const dot = a._mkBox(0.03, 0.03, 0.03, a._accentMat); // rear sight accent
    dot.position.set(0, 0.09, -0.02);
    g.add(dot);
    return g;
  },

  // smg: compact boxy body, short forward mag under, stubby barrel.
  smg(a) {
    const g = new THREE.Group();
    const body = a._mkBox(0.08, 0.12, 0.34, a._gunMat);
    body.position.set(0, 0.02, -0.14);
    g.add(body);
    const grip = a._mkBox(0.06, 0.13, 0.08, a._gunMat);
    grip.position.set(0, -0.08, 0.02);
    grip.rotation.x = 0.18;
    g.add(grip);
    const mag = a._mkBox(0.05, 0.16, 0.06, a._gunMat); // short curved-ish mag
    mag.position.set(0, -0.1, -0.14);
    mag.rotation.x = -0.15;
    g.add(mag);
    const rail = a._mkBox(0.05, 0.03, 0.16, a._accentMat); // top rail accent
    rail.position.set(0, 0.1, -0.16);
    g.add(rail);
    return g;
  },

  // shotgun: long body with a distinctive underslung pump tube.
  shotgun(a) {
    const g = new THREE.Group();
    const body = a._mkBox(0.09, 0.11, 0.5, a._gunMat);
    body.position.set(0, 0.02, -0.24);
    g.add(body);
    const grip = a._mkBox(0.06, 0.13, 0.08, a._gunMat);
    grip.position.set(0, -0.08, 0.04);
    grip.rotation.x = 0.2;
    g.add(grip);
    // underslung pump tube (the signature shotgun read) — a cylinder along -Z
    const pump = a._mkCyl(0.035, 0.035, 0.34, a._accentMat, 10);
    pump.rotation.x = Math.PI / 2;
    pump.position.set(0, -0.06, -0.28);
    g.add(pump);
    return g;
  },

  // ar: rifle — body + angled mag + top sight. The neutral default.
  ar(a) {
    const g = new THREE.Group();
    const body = a._mkBox(0.08, 0.12, 0.46, a._gunMat);
    body.position.set(0, 0.02, -0.22);
    g.add(body);
    const grip = a._mkBox(0.06, 0.13, 0.08, a._gunMat);
    grip.position.set(0, -0.08, 0.02);
    grip.rotation.x = 0.2;
    g.add(grip);
    const mag = a._mkBox(0.05, 0.2, 0.07, a._gunMat); // longer angled mag
    mag.position.set(0, -0.13, -0.16);
    mag.rotation.x = -0.25;
    g.add(mag);
    const barrel = a._mkBox(0.04, 0.04, 0.16, a._gunMat);
    barrel.position.set(0, 0.02, -0.5);
    g.add(barrel);
    const sight = a._mkBox(0.04, 0.06, 0.07, a._accentMat); // carry-handle sight
    sight.position.set(0, 0.1, -0.14);
    g.add(sight);
    return g;
  },

  // sniper: very long barrel + big scope tube up top (the read is the scope).
  sniper(a) {
    const g = new THREE.Group();
    const body = a._mkBox(0.08, 0.11, 0.58, a._gunMat);
    body.position.set(0, 0.02, -0.28);
    g.add(body);
    const grip = a._mkBox(0.06, 0.13, 0.08, a._gunMat);
    grip.position.set(0, -0.08, 0.06);
    grip.rotation.x = 0.2;
    g.add(grip);
    const barrel = a._mkBox(0.035, 0.035, 0.34, a._gunMat); // long thin barrel
    barrel.position.set(0, 0.02, -0.64);
    g.add(barrel);
    // big scope tube (crew-tinted lens ring) sitting above the body along -Z
    const scope = a._mkCyl(0.045, 0.045, 0.26, a._gunMat, 12);
    scope.rotation.x = Math.PI / 2;
    scope.position.set(0, 0.12, -0.22);
    g.add(scope);
    const lens = a._mkCyl(0.05, 0.05, 0.03, a._accentMat, 12); // front lens accent
    lens.rotation.x = Math.PI / 2;
    lens.position.set(0, 0.12, -0.35);
    g.add(lens);
    return g;
  },

  // exotic: chunky launcher — a fat tube (rocket) with a crew-tinted muzzle ring.
  exotic(a) {
    const g = new THREE.Group();
    const tube = a._mkCyl(0.11, 0.11, 0.5, a._gunMat, 14); // fat launcher tube
    tube.rotation.x = Math.PI / 2;
    tube.position.set(0, 0.03, -0.24);
    g.add(tube);
    const grip = a._mkBox(0.06, 0.14, 0.08, a._gunMat);
    grip.position.set(0, -0.1, 0.02);
    grip.rotation.x = 0.2;
    g.add(grip);
    const muzzle = a._mkCyl(0.13, 0.11, 0.06, a._accentMat, 14); // flared muzzle ring
    muzzle.rotation.x = Math.PI / 2;
    muzzle.position.set(0, 0.03, -0.5);
    g.add(muzzle);
    const sight = a._mkBox(0.05, 0.05, 0.05, a._accentMat);
    sight.position.set(0, 0.16, -0.16);
    g.add(sight);
    return g;
  },

  // sawblade: flat launcher body + a big crew-tinted disc silhouette out front
  // (the spinning blade read). Disc is a thin cylinder facing along the aim.
  sawblade(a) {
    const g = new THREE.Group();
    const body = a._mkBox(0.1, 0.1, 0.3, a._gunMat);
    body.position.set(0, 0.0, -0.12);
    g.add(body);
    const grip = a._mkBox(0.06, 0.13, 0.08, a._gunMat);
    grip.position.set(0, -0.09, 0.02);
    grip.rotation.x = 0.2;
    g.add(grip);
    // the disc: thin large-radius cylinder, axis along Z so the flat face reads
    const disc = a._mkCyl(0.2, 0.2, 0.04, a._accentMat, 16);
    disc.rotation.x = Math.PI / 2; // flat face toward the muzzle direction
    disc.position.set(0, 0.02, -0.34);
    g.add(disc);
    const hub = a._mkCyl(0.05, 0.05, 0.06, a._gunMat, 10); // dark hub center
    hub.rotation.x = Math.PI / 2;
    hub.position.set(0, 0.02, -0.34);
    g.add(hub);
    return g;
  },
};

export class Avatar {
  constructor(opts = {}) {
    this.color = opts.color ?? 0x7df9ff;

    this.group = new THREE.Group();
    this.group.name = 'Avatar';

    // ---- materials ---------------------------------------------------------
    // Body: matte crew-tinted grey-box. Accent: emissive rim (visor / trim).
    this._bodyMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(this.color).multiplyScalar(0.55).getHex(),
      roughness: 0.7,
      metalness: 0.15,
    });
    this._limbMat = new THREE.MeshStandardMaterial({
      color: 0x2a2e35,
      roughness: 0.85,
      metalness: 0.1,
    });
    this._accentMat = new THREE.MeshStandardMaterial({
      color: this.color,
      emissive: new THREE.Color(this.color),
      emissiveIntensity: 1.4,
      roughness: 0.4,
      metalness: 0.2,
    });
    this._gunMat = new THREE.MeshStandardMaterial({
      color: 0x15181d,
      roughness: 0.55,
      metalness: 0.55,
    });
    this._materials = [this._bodyMat, this._limbMat, this._accentMat, this._gunMat];
    this._geoms = [];

    this._build();

    // ---- pose state (smoothed each frame) ---------------------------------
    // Every posable DOF has a current value that eases toward a per-frame target.
    this._phase = 0;          // leg cycle phase (advanced by speed*dt)
    this._breathe = 0;        // idle breathe phase
    this._recoil = 0;         // firing recoil amount 0..1 (smoothed)
    this._crouch = 0;         // 0 standing .. 1 fully crouched (slide) — smoothed
    this._lean = 0;           // forward lean radians (smoothed)
    this._wallTilt = 0;       // wall-run body roll radians (smoothed)
    this._pitch = 0;          // aim pitch radians (smoothed, for head+gun)

    // current limb angles (radians) — smoothed toward targets in pose()
    this._a = {
      lUpperLeg: 0, lLowerLeg: 0, rUpperLeg: 0, rLowerLeg: 0,
      lUpperArm: 0, lLowerArm: 0, rUpperArm: 0, rLowerArm: 0,
      lArmZ: 0, rArmZ: 0, // arm splay (Z) for wall-run outside-arm-out etc.
    };
  }

  _mkBox(w, h, d, mat) {
    const g = new THREE.BoxGeometry(w, h, d);
    this._geoms.push(g);
    const m = new THREE.Mesh(g, mat);
    m.castShadow = true;
    m.receiveShadow = false;
    return m;
  }

  // Cylinder primitive (tubes, scopes, discs). rotate/position by the caller.
  _mkCyl(rTop, rBot, h, mat, seg = 12) {
    const g = new THREE.CylinderGeometry(rTop, rBot, h, seg);
    this._geoms.push(g);
    const m = new THREE.Mesh(g, mat);
    m.castShadow = true;
    m.receiveShadow = false;
    return m;
  }

  // Build the hierarchy. Everything hangs off this.group. Feet reach y=0.
  // Rough proportions (metres): legs 0.9, torso 0.62, head 0.26 → ~1.8 tall.
  _build() {
    // Root pivot we tilt/lean/crouch as a whole (keeps feet-at-0 semantics by
    // being offset back down; but we lean it about the hip so feet stay planted).
    this.root = new THREE.Group();
    this.group.add(this.root);

    // Hip anchor — the whole upper body pivots here for lean / wall tilt.
    // Hips sit at y ≈ 0.9 (top of the legs).
    this.hip = new THREE.Group();
    this.hip.position.y = 0.9;
    this.root.add(this.hip);

    // ---- pelvis / torso ----------------------------------------------------
    const pelvis = this._mkBox(0.44, 0.22, 0.26, this._bodyMat);
    pelvis.position.y = 0.11;
    this.hip.add(pelvis);

    // torso pivots at the waist (top of pelvis) so lean bends the chest forward
    this.torso = new THREE.Group();
    this.torso.position.y = 0.22;
    this.hip.add(this.torso);

    const chest = this._mkBox(0.5, 0.5, 0.28, this._bodyMat);
    chest.position.y = 0.27;
    this.torso.add(chest);

    // emissive chest trim (a thin accent slab across the chest)
    const trim = this._mkBox(0.52, 0.08, 0.3, this._accentMat);
    trim.position.y = 0.34;
    this.torso.add(trim);

    // ---- neck + head -------------------------------------------------------
    this.head = new THREE.Group();
    this.head.position.y = 0.56; // atop the chest
    this.torso.add(this.head);

    const skull = this._mkBox(0.28, 0.28, 0.28, this._bodyMat);
    skull.position.y = 0.14;
    this.head.add(skull);

    // emissive visor band — a strong direction/aim read at distance. Sits on the
    // -Z face (the avatar's forward), so you can tell where they look.
    const visor = this._mkBox(0.24, 0.09, 0.06, this._accentMat);
    visor.position.set(0, 0.15, -0.13);
    this.head.add(visor);

    // ---- shoulders / arms --------------------------------------------------
    // Arms pivot at shoulder (in torso space). Upper arm hangs down; lower arm
    // (forearm) pivots at the elbow. Held gun rides the RIGHT hand.
    const shoulderY = 0.48; // near top of chest in torso space
    const shoulderX = 0.34;

    this.lArm = this._mkArm(true);
    this.lArm.group.position.set(-shoulderX, shoulderY, 0);
    this.torso.add(this.lArm.group);

    this.rArm = this._mkArm(false);
    this.rArm.group.position.set(shoulderX, shoulderY, 0);
    this.torso.add(this.rArm.group);

    // ---- held gun slot (on the right hand) --------------------------------
    // The `gun` group rides the right forearm's hand end so it follows the aim
    // pose. Actual weapon silhouettes are built LAZILY into `_weaponModels` and
    // swapped by visibility in setWeapon(). Default to a neutral rifle.
    this.gun = new THREE.Group();
    this.rArm.lower.add(this.gun);
    this.gun.position.set(0, -0.34, -0.02); // near the hand

    this._weaponModels = {};   // id -> THREE.Group (built lazily)
    this._weaponId = null;     // currently shown id
    this.setWeapon('ar');      // neutral rifle default

    // ---- hips → legs -------------------------------------------------------
    // Legs pivot at the hip joints (root space so lean doesn't drag feet).
    const hipX = 0.13;
    this.lLeg = this._mkLeg();
    this.lLeg.group.position.set(-hipX, 0.9, 0);
    this.root.add(this.lLeg.group);

    this.rLeg = this._mkLeg();
    this.rLeg.group.position.set(hipX, 0.9, 0);
    this.root.add(this.rLeg.group);
  }

  // An arm = shoulder group (upper arm mesh, pivots at shoulder) → elbow group
  // (forearm mesh, pivots at elbow). Returns pivots we rotate in pose().
  _mkArm(isLeft) {
    const group = new THREE.Group();      // shoulder pivot
    const upper = this._mkBox(0.14, 0.34, 0.14, this._limbMat);
    upper.position.y = -0.17;             // hangs below shoulder
    group.add(upper);

    const lower = new THREE.Group();      // elbow pivot
    lower.position.y = -0.34;
    group.add(lower);
    const fore = this._mkBox(0.12, 0.32, 0.12, this._limbMat);
    fore.position.y = -0.16;
    lower.add(fore);
    // little emissive cuff so limbs read against the body
    const cuff = this._mkBox(0.13, 0.05, 0.13, this._accentMat);
    cuff.position.y = -0.3;
    lower.add(cuff);

    return { group, upper, lower, isLeft };
  }

  // A leg = hip group (thigh mesh, pivots at hip) → knee group (shin mesh + foot,
  // pivots at knee). Thigh 0.46, shin 0.44 → hip at y=0.9 puts foot near y=0.
  _mkLeg() {
    const group = new THREE.Group();      // hip pivot
    const thigh = this._mkBox(0.17, 0.46, 0.18, this._limbMat);
    thigh.position.y = -0.23;
    group.add(thigh);

    const knee = new THREE.Group();       // knee pivot
    knee.position.y = -0.46;
    group.add(knee);
    const shin = this._mkBox(0.15, 0.44, 0.16, this._limbMat);
    shin.position.y = -0.22;
    knee.add(shin);
    const foot = this._mkBox(0.17, 0.1, 0.28, this._limbMat);
    foot.position.set(0, -0.44, -0.06);
    knee.add(foot);

    return { group, thigh, knee };
  }

  // ---- posing -------------------------------------------------------------
  // pose({ state, speed, yaw, pitch, firing, grounded, dt })
  //   state   : 'GROUNDED' | 'AIRBORNE' | 'SLIDING' | 'WALLRUN'
  //   speed   : horizontal m/s (drives leg cadence + stride amplitude)
  //   yaw     : DEGREES, yaw 0 faces -Z (camera convention)
  //   pitch   : DEGREES look pitch (up positive) — tilts head + gun
  //   firing  : bool — recoil arm pose
  //   grounded: bool
  //   dt      : seconds since last pose (fixed or variable, both fine)
  pose(o = {}) {
    const dt = Math.min(o.dt ?? 0.016, 0.1); // clamp so a hitch can't explode blends
    const state = o.state || 'GROUNDED';
    const speed = Math.max(0, o.speed ?? 0);
    const firing = !!o.firing;

    // ---- whole-body facing (yaw). yaw 0 faces -Z. Three's default box front is
    // +Z; we want the visor (-Z local) to point along the yaw dir, so rotate Y by
    // yaw radians directly (yaw grows CCW about +Y, matching the camera).
    const yawRad = (o.yaw ?? 0) * DEG;
    this.group.rotation.y = approachAngle(this.group.rotation.y, yawRad, 14, dt);

    // ---- smoothed aim pitch (head + gun tilt). Clamp to a readable range.
    const pitchTarget = THREE.MathUtils.clamp((o.pitch ?? 0) * DEG, -0.9, 0.9);
    this._pitch = approach(this._pitch, pitchTarget, 16, dt);

    // ---- recoil (firing) smoothing
    this._recoil = approach(this._recoil, firing ? 1 : 0, firing ? 40 : 10, dt);

    // ---- per-state pose targets -------------------------------------------
    // Defaults (idle-ish neutral), overwritten per state below.
    let crouchT = 0;      // 0..1 lower the whole body (slide)
    let leanT = 0;        // forward lean radians
    let wallTiltT = 0;    // body roll radians for wall-run
    let stride = 0;       // leg swing amplitude (radians)
    let cadence = 0;      // phase advance multiplier
    let armSwing = 0;     // arm counter-swing amplitude
    let bodyBobT = 0;     // vertical bob amount

    // idle breathe always advances
    this._breathe += dt * 1.6;
    const breathe = Math.sin(this._breathe) * 0.02;

    if (state === 'SLIDING') {
      // crouched low, forward lean, legs mostly extended forward, trailing leg tucked
      crouchT = 1;
      leanT = 0.7;
      stride = 0.0;
      cadence = 0;
      armSwing = 0;
    } else if (state === 'AIRBORNE' || o.grounded === false) {
      // tucked legs, slight forward lean, arms up for balance
      crouchT = 0.35;
      leanT = 0.18;
      stride = 0;
      cadence = 0;
      armSwing = 0;
    } else if (state === 'WALLRUN') {
      // body angled (rolled) toward the wall, outside arm reaching out, running legs
      wallTiltT = 0.32;
      leanT = 0.12;
      stride = 0.7;
      cadence = 9;
      armSwing = 0.5;
    } else {
      // GROUNDED: idle vs run by speed
      const runK = THREE.MathUtils.clamp(speed / 8, 0, 1.2); // 0 at rest .. >1 sprint
      stride = 0.55 * runK;
      armSwing = 0.6 * runK;
      cadence = 10 * Math.min(runK, 1) + speed * 0.15;
      leanT = 0.12 * Math.min(runK, 1);
      bodyBobT = 0.04 * Math.min(runK, 1);
    }

    // advance leg phase by cadence*dt (frame-rate independent gait)
    this._phase += cadence * dt;
    const p = this._phase;

    // smooth the body-level params
    this._crouch = approach(this._crouch, crouchT, 12, dt);
    this._lean = approach(this._lean, leanT, 12, dt);
    this._wallTilt = approachAngle(this._wallTilt, wallTiltT, 12, dt);

    // ---- apply body posture ------------------------------------------------
    // Crouch lowers the whole root and shortens the legs' effective reach; we
    // lower the root and add knee bend so the feet stay near the floor.
    const crouchDrop = this._crouch * 0.55;            // metres the hips drop
    this.root.position.y = -crouchDrop + breathe + Math.sin(p) * bodyBobT * 0.5;

    // torso lean (bend forward at the waist) + wall roll (about Z, forward axis)
    this.torso.rotation.x = approachAngle(this.torso.rotation.x, this._lean, 14, dt);
    this.root.rotation.z = this._wallTilt; // roll whole body toward wall

    // head pitch: counter part of body lean + aim pitch so the visor reads aim
    this.head.rotation.x = approachAngle(
      this.head.rotation.x,
      -this._pitch - this._lean * 0.4,
      16, dt,
    );

    // ---- legs --------------------------------------------------------------
    // Run: opposite legs swing out of phase; knees bend on the return.
    const legSwingL = Math.sin(p) * stride;
    const legSwingR = Math.sin(p + Math.PI) * stride;
    // knee bends most when the leg is behind/lifting (use a rectified cosine)
    const kneeBendBase = state === 'SLIDING' ? 0.2 : 0.0;
    const kneeL = kneeBendBase + Math.max(0, -Math.cos(p)) * stride * 1.3;
    const kneeR = kneeBendBase + Math.max(0, -Math.cos(p + Math.PI)) * stride * 1.3;

    // airborne / slide static leg tuck targets
    let lUpT = legSwingL, rUpT = legSwingR, lLoT = -kneeL, rLoT = -kneeR;
    if (state === 'AIRBORNE' || (o.grounded === false && state !== 'WALLRUN')) {
      // tuck: thighs up, shins folded
      lUpT = 0.7; rUpT = 0.5;
      lLoT = -1.1; rLoT = -0.9;
    } else if (state === 'SLIDING') {
      // lead leg extended forward, trailing leg folded under
      lUpT = 0.55; lLoT = -0.15;
      rUpT = -0.15; rLoT = -1.4;
    } else if (this._crouch > 0.05) {
      // partial crouch adds knee bend so feet stay planted while hips drop
      const kb = this._crouch * 1.1;
      lUpT += kb * 0.5; rUpT += kb * 0.5;
      lLoT -= kb; rLoT -= kb;
    }

    this._a.lUpperLeg = approachAngle(this._a.lUpperLeg, lUpT, 16, dt);
    this._a.rUpperLeg = approachAngle(this._a.rUpperLeg, rUpT, 16, dt);
    this._a.lLowerLeg = approachAngle(this._a.lLowerLeg, lLoT, 16, dt);
    this._a.rLowerLeg = approachAngle(this._a.rLowerLeg, rLoT, 16, dt);

    this.lLeg.group.rotation.x = this._a.lUpperLeg;
    this.rLeg.group.rotation.x = this._a.rUpperLeg;
    this.lLeg.knee.rotation.x = this._a.lLowerLeg;
    this.rLeg.knee.rotation.x = this._a.rLowerLeg;

    // ---- arms --------------------------------------------------------------
    // Base running counter-swing (arms opposite to same-side leg). The RIGHT arm
    // holds the gun; when firing it snaps to an aim/recoil pose that overrides.
    const armL = Math.sin(p + Math.PI) * armSwing;
    const armR = Math.sin(p) * armSwing;

    // gun-ready pose: both arms brought forward, elbows bent, to "hold" the gun.
    // Blend from swing → ready by how much the gun matters (always somewhat, more
    // when firing). We keep a persistent light ready so the gun stays up.
    const ready = 0.35 + this._recoil * 0.65;

    // targets: raise arms forward (negative X = forward-up in this rig), bend elbow
    let lUpArmT = THREE.MathUtils.lerp(armL, -1.1, ready);
    let rUpArmT = THREE.MathUtils.lerp(armR, -1.15, ready);
    let lLoArmT = THREE.MathUtils.lerp(0, -0.7, ready);
    let rLoArmT = THREE.MathUtils.lerp(0, -0.65, ready);
    let lArmZT = 0, rArmZT = 0;

    // recoil kick: right arm jolts up/back briefly
    rUpArmT -= this._recoil * 0.25;

    // wall-run: OUTSIDE (left, arbitrary) arm splays out to the side
    if (state === 'WALLRUN') {
      lArmZT = 0.9;         // splay left arm outward (Z rotation)
      lUpArmT = -0.5;
    }
    // airborne: arms out a touch for balance read
    if (state === 'AIRBORNE') {
      lArmZT = 0.5; rArmZT = 0.2;
    }

    this._a.lUpperArm = approachAngle(this._a.lUpperArm, lUpArmT, 16, dt);
    this._a.rUpperArm = approachAngle(this._a.rUpperArm, rUpArmT, 18, dt);
    this._a.lLowerArm = approachAngle(this._a.lLowerArm, lLoArmT, 16, dt);
    this._a.rLowerArm = approachAngle(this._a.rLowerArm, rLoArmT, 16, dt);
    this._a.lArmZ = approachAngle(this._a.lArmZ, lArmZT, 12, dt);
    this._a.rArmZ = approachAngle(this._a.rArmZ, rArmZT, 12, dt);

    this.lArm.group.rotation.x = this._a.lUpperArm;
    this.lArm.group.rotation.z = this._a.lArmZ;
    this.rArm.group.rotation.x = this._a.rUpperArm;
    this.rArm.group.rotation.z = this._a.rArmZ;
    this.lArm.lower.rotation.x = this._a.lLowerArm;
    this.rArm.lower.rotation.x = this._a.rLowerArm;

    // gun pitch: tilt the held gun with aim pitch so muzzle tracks where they aim
    this.gun.rotation.x = approachAngle(this.gun.rotation.x, this._pitch, 16, dt);
  }

  // ---- held weapon display ------------------------------------------------
  // setWeapon(id): show a DISTINCT code-built gun silhouette for `id` in the
  // right-hand slot. Models are built lazily on first request and cached; the
  // switch is just a visibility swap (cheap). Forward is -Z (muzzle points where
  // the avatar aims). Unknown ids fall back to a neutral rifle ('ar').
  //   pistol   : small, stubby
  //   smg      : compact body + short mag
  //   shotgun  : long body + underslung pump
  //   ar       : rifle w/ mag + sight (the neutral default)
  //   sniper   : very long barrel + big scope tube
  //   exotic   : chunky launcher tube (rocket)
  //   sawblade : flat launcher w/ a crew-tinted spinning-disc silhouette
  setWeapon(weaponId) {
    let id = weaponId;
    if (!id || !WEAPON_BUILDERS[id]) id = 'ar'; // neutral rifle fallback
    if (id === this._weaponId) return;

    // hide the previous model
    if (this._weaponId && this._weaponModels[this._weaponId]) {
      this._weaponModels[this._weaponId].visible = false;
    }

    // build lazily on first use
    let model = this._weaponModels[id];
    if (!model) {
      model = WEAPON_BUILDERS[id](this);
      this._weaponModels[id] = model;
      this.gun.add(model);
    }
    model.visible = true;
    this._weaponId = id;
  }

  // Currently displayed weapon id (post-fallback), or null before first set.
  getWeapon() { return this._weaponId; }

  // ---- api ---------------------------------------------------------------
  setColor(hex) {
    this.color = hex;
    const c = new THREE.Color(hex);
    this._bodyMat.color.copy(c).multiplyScalar(0.55);
    this._accentMat.color.copy(c);
    this._accentMat.emissive.copy(c);
    this._bodyMat.needsUpdate = true;
    this._accentMat.needsUpdate = true;
  }

  dispose() {
    for (const g of this._geoms) g.dispose();
    for (const m of this._materials) m.dispose();
    this._geoms.length = 0;
    if (this.group.parent) this.group.parent.remove(this.group);
  }
}
