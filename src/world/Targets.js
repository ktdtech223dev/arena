// RANGE — world/Targets.js
// Every target type in the facility, built in code at ctx.world.range.anchors:
// static silhouettes (body/head zones), bullseye boards (bull/inner/outer by hit
// radius), moving riders (H/V/circular), peekers, CQC cluster, the regenerating
// DPS dummy, floating course gates, plus the flick/tracking drills and THE shot
// query: raycastShot(origin, dir, maxDist).
//
// Emits: target:hit, target:killed, target:respawn, stats:ttk, stats:dps,
//        drill:tick, drill:end.
// Listens: range:spawn {section}, range:clear, range:resetAll, drill:start {type}.
import * as THREE from 'three';

// -- scoring (contract §C2) ---------------------------------------------------
const POINTS = { head: 25, body: 10, bull: 10, inner: 5, outer: 2 };

// -- small math helpers -------------------------------------------------------
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (t) => t * t * (3 - 2 * t);
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeOutBack = (t) => {
  const c = 1.70158;
  const u = t - 1;
  return 1 + (c + 1) * u * u * u + c * u * u;
};
// triangle wave 0→1→0 over u∈[0,1), eased so movers settle at the rail ends
const pingpongEase = (u) => {
  const f = u - Math.floor(u);
  return smooth(1 - Math.abs(1 - 2 * f));
};
const randRange = (a, b) => a + Math.random() * (b - a);

function roundedPlateGeom(w, h, r, depth) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 10 });
  g.translate(0, 0, -depth / 2);
  return g;
}

function bullseyeTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const cx = 128, R = 124;
  const ring = (r, fill) => {
    g.beginPath(); g.arc(cx, cx, r, 0, Math.PI * 2); g.fillStyle = fill; g.fill();
  };
  ring(R, '#20242c');           // rim
  ring(R * 0.97, '#e9e4d6');    // outer (2 pts)
  ring(R * 0.55, '#d0392c');    // inner (5 pts)
  ring(R * 0.22, '#f5efe0');    // bull backing
  ring(R * 0.13, '#a31f14');    // bull (10 pts)
  g.strokeStyle = 'rgba(20,22,28,0.55)';
  g.lineWidth = 2;
  for (const f of [0.97, 0.55, 0.22]) {
    g.beginPath(); g.arc(cx, cx, R * f, 0, Math.PI * 2); g.stroke();
  }
  g.strokeStyle = 'rgba(240,236,224,0.9)';
  g.beginPath(); g.moveTo(cx - 6, cx); g.lineTo(cx + 6, cx);
  g.moveTo(cx, cx - 6); g.lineTo(cx, cx + 6); g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// -- Target ---------------------------------------------------------------------
let NEXT_ID = 1;

class Target {
  constructor(kind, section) {
    this.id = NEXT_ID++;
    this.kind = kind;       // silhouette|bullseye|mover|peeker|dummy|gate|flick|track
    this.section = section; // gallery|precision|moving|cqc|dummy|course|drill
    this.root = new THREE.Group();
    this.tilt = new THREE.Group(); // wobble / flip pivot
    this.root.add(this.tilt);
    this.meshes = [];       // raycastable meshes (userData.target = this)
    this.mat = null;        // per-target material (flash pulses emissiveIntensity)
    this.baseEmissive = 0;
    this.dimmed = false;
    this.hp = 100;
    this.maxHp = 100;
    this.alive = true;
    this.hidden = false;    // peeker down / not shootable
    this.dying = false;
    this.dieT = 0;
    this.flip = false;      // kill anim: flip-down (silhouettes) vs scale-pop
    this.respawns = true;
    this.respawnAt = null;
    this.spawnT = 1;        // 0..1 spawn scale-in
    this.baseScale = 1;
    this.bodyOffsetY = 0.9; // local-space up offset (× scale) to the body center; set by builders
    this.velocity = new THREE.Vector3(); // world m/s — leading matters
    this.prevPos = new THREE.Vector3();
    this.flash = 0;
    this.wob = { x: 0, z: 0, vx: 0, vz: 0 };
    this.gateIndex = null;  // set for course gates; MoveCourse keys off this
    this._ttkStart = null;
    this._ttkGun = null;
    this.data = {};         // per-kind state (paths, peek FSM, dps log, ...)
  }

  /** Course gates: MoveCourse dims collected gates during a run. */
  setDimmed(on) {
    this.dimmed = on;
  }
}

// -- Targets ---------------------------------------------------------------------
export class Targets {
  constructor(ctx) {
    this.ctx = ctx;

    this.params = {
      silhouetteHP: 100,
      respawnSec: 2.5,
      killBonus: 25,
      headDamageMult: 1.75,
      dummyHP: 1000,
      dummyRegenDelay: 3,
      dpsEmitInterval: 0.25,
      flashGain: 2.4,
      flashDecay: 9,
      wobbleK: 130,
      wobbleDamp: 10,
      wobbleKick: 0.9,
      peekMoveTime: 0.22,
      drillCountdown: 3,
      flickCount: 20,
      flickLifetime: 1.5,
      flickRadius: 0.2,
      trackingDuration: 30,
      trackingSpeed: 5.5,
      trackingAccel: 14,
      trackAimRadius: 0.55,
    };

    this.targets = [];
    this.gates = [];   // gate Targets, index-aligned with anchors.course.gates
    this.drill = null;

    this.group = new THREE.Group();
    this.group.name = 'targets';
    ctx.scene.add(this.group);

    this._raycaster = new THREE.Raycaster();
    this._liveMeshes = [];
    this._rayDirty = true;

    this._v1 = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._v3 = new THREE.Vector3();
    // scratch for spatial queries / area damage (kept separate from _v1.._v3
    // which raycastShot/damage reuse, so an aimPoint call can't clobber them)
    this._q1 = new THREE.Vector3();
    this._q2 = new THREE.Vector3();

    // shared geometry
    this._geo = {
      body: roundedPlateGeom(0.55, 0.85, 0.18, 0.05),
      head: new THREE.CylinderGeometry(0.14, 0.14, 0.05, 24).rotateX(Math.PI / 2),
      post: new THREE.BoxGeometry(0.07, 0.9, 0.07),
      base: new THREE.CylinderGeometry(0.26, 0.32, 0.07, 20),
      orb: new THREE.SphereGeometry(1, 18, 14), // unit sphere, scaled per use
      boardBack: null, // built per board size
    };
    this._bullTex = bullseyeTexture();

    this._buildAll();

    ctx.events.on('range:spawn', (d) => this._spawnSection(d?.section ?? 'all'));
    ctx.events.on('range:clear', () => this._clearAll());
    ctx.events.on('range:resetAll', () => this._resetAll());
    ctx.events.on('drill:start', (d) => this._startDrill(d?.type ?? 'flick'));

    this._registerTunables();
  }

  // ---- construction --------------------------------------------------------

  _buildAll() {
    const a = this.ctx.world?.range?.anchors ?? {};

    for (const g of a.gallery ?? []) {
      this._addSilhouette('silhouette', 'gallery', g.pos, { stand: true });
    }
    for (const p of a.precision ?? []) {
      this._addBullseye(p.pos, p.size ?? 0.4);
    }
    for (const m of a.movingH ?? []) {
      const t = this._addSilhouette('mover', 'moving', m.from, { stand: false });
      t.data.path = { type: 'H', from: m.from.clone(), to: m.to.clone(), period: m.period || 4, phase: Math.random() };
    }
    for (const m of a.movingV ?? []) {
      const t = this._addSilhouette('mover', 'moving', m.from, { stand: false });
      t.data.path = { type: 'V', from: m.from.clone(), to: m.to.clone(), period: m.period || 3, phase: Math.random() };
    }
    for (const m of a.movingC ?? []) {
      const start = m.center.clone(); start.x += m.radius;
      const t = this._addSilhouette('mover', 'moving', start, { stand: false });
      t.data.path = { type: 'C', center: m.center.clone(), radius: m.radius || 2, period: m.period || 5, phase: Math.random() };
    }
    for (const p of a.peekers ?? []) {
      const t = this._addSilhouette('peeker', 'moving', p.hidePos, { stand: false });
      t.data.peek = {
        pos: p.pos.clone(), hidePos: p.hidePos.clone(),
        upTime: p.upTime || 1.2, downTime: p.downTime || 1.0,
        state: 'down', timer: this._jitter(p.downTime || 1.0), f: 0,
      };
      t.hidden = true;
    }
    for (const c of a.cqc ?? []) {
      this._addSilhouette('silhouette', 'cqc', c.pos, { stand: true, color: 0x4a3b32, accent: 0xffa02a });
    }
    if (a.dummy?.pos) this._addDummy(a.dummy.pos);

    const gates = a.course?.gates ?? [];
    gates.forEach((g, i) => this._addGate(g, i, gates));

    this._drillVolume = a.drillVolume ?? {
      min: new THREE.Vector3(-6, 1, -20),
      max: new THREE.Vector3(6, 4, -8),
    };
  }

  _jitter(t) { return t * randRange(0.65, 1.35); }

  _finishTarget(t, pos) {
    t.root.position.copy(pos);
    t.prevPos.copy(pos);
    for (const m of t.meshes) {
      m.userData.target = t;
      m.castShadow = true;
    }
    // live world-space body-center aim point (seekers/AoE home to this).
    // root world position + a small up offset so we aim at the body, not the feet.
    t.aimPoint = (out) => this.aimPoint(t, out);
    this.group.add(t.root);
    this.targets.push(t);
    this._rayDirty = true;
    return t;
  }

  _addSilhouette(kind, section, pos, { stand = true, color = 0x39424e, accent = 0xff6a3c, scale = 1 } = {}) {
    const t = new Target(kind, section);
    t.maxHp = t.hp = this.params.silhouetteHP;
    t.flip = true;
    t.baseScale = scale;
    t.root.scale.setScalar(scale);
    t.mat = new THREE.MeshStandardMaterial({
      color, roughness: 0.55, metalness: 0.3,
      emissive: new THREE.Color(accent), emissiveIntensity: 0,
    });
    t.baseEmissive = 0.06;

    // riders pivot at their center; standing targets pivot at the floor
    const yBody = stand ? 1.18 : 0;
    const yHead = yBody + 0.58;

    const body = new THREE.Mesh(this._geo.body, t.mat);
    body.position.y = yBody;
    body.userData.zone = 'body';
    t.tilt.add(body);

    const head = new THREE.Mesh(this._geo.head, t.mat);
    head.position.y = yHead;
    head.userData.zone = 'head';
    t.tilt.add(head);

    // neck sliver (counts as head — generous)
    const neck = new THREE.Mesh(this._geo.post, t.mat);
    neck.scale.set(0.6, 0.14, 0.6);
    neck.position.y = yBody + 0.49;
    neck.userData.zone = 'head';
    t.tilt.add(neck);

    t.meshes.push(body, head, neck);
    // aim at the body-center; riders pivot at their center (body y=0),
    // standing silhouettes hang the body up the post (set below).
    t.bodyOffsetY = yBody;

    if (stand) {
      const standMat = new THREE.MeshStandardMaterial({ color: 0x20242c, roughness: 0.8, metalness: 0.4 });
      const post = new THREE.Mesh(this._geo.post, standMat);
      post.position.y = 0.45;
      post.castShadow = true;
      t.root.add(post); // NOT raycastable — shots pass by the stand
      const base = new THREE.Mesh(this._geo.base, standMat);
      base.position.y = 0.035;
      t.root.add(base);
      // silhouette hangs off the post
      body.position.y = 1.18; head.position.y = 1.76; neck.position.y = 1.67;
      post.scale.y = 1.5; post.position.y = 0.67;
      t.bodyOffsetY = 1.18;
    }

    return this._finishTarget(t, pos);
  }

  _addBullseye(pos, size) {
    const t = new Target('bullseye', 'precision');
    t.maxHp = t.hp = 1e9; // boards never die — pure ring scoring
    t.respawns = false;
    t.mat = new THREE.MeshStandardMaterial({
      map: this._bullTex, roughness: 0.75, metalness: 0.05,
      emissive: new THREE.Color(0xffffff), emissiveIntensity: 0,
    });
    t.baseEmissive = 0;

    t.bodyOffsetY = 0; // board face is centered on the root
    const face = new THREE.Mesh(new THREE.CircleGeometry(size, 48), t.mat);
    face.userData.zone = null; // computed from radius on hit
    face.userData.rings = { bull: size * 0.22, inner: size * 0.55 };
    t.tilt.add(face);
    t.meshes.push(face);

    const backMat = new THREE.MeshStandardMaterial({ color: 0x252a33, roughness: 0.7, metalness: 0.35 });
    const back = new THREE.Mesh(new THREE.CylinderGeometry(size * 1.06, size * 1.06, 0.06, 32).rotateX(Math.PI / 2), backMat);
    back.position.z = -0.045;
    back.castShadow = true;
    t.tilt.add(back);
    const arm = new THREE.Mesh(this._geo.post, backMat);
    arm.scale.y = 1.4;
    arm.position.set(0, -0.63 - size * 0.5, -0.06);
    t.root.add(arm);

    return this._finishTarget(t, pos);
  }

  _addDummy(pos) {
    const t = this._addSilhouette('dummy', 'dummy', pos, {
      stand: true, color: 0x4c3a24, accent: 0xffb020, scale: 1.35,
    });
    t.kind = 'dummy';
    t.section = 'dummy';
    t.maxHp = t.hp = this.params.dummyHP;
    t.respawns = false;
    t.baseEmissive = 0.28;
    t.data.dps = { log: [], lastDamage: -1e9, nextEmit: 0, windowStart: 0 };
    return t;
  }

  _addGate(def, index, all) {
    const t = new Target('gate', 'course');
    t.maxHp = t.hp = 1e9; // shootable, never dies
    t.respawns = false;
    const r = def.radius || 1.2;
    t.mat = new THREE.MeshStandardMaterial({
      color: 0x0b2b33, roughness: 0.35, metalness: 0.6,
      emissive: new THREE.Color(0x18e0ff), emissiveIntensity: 1.7,
    });
    t.baseEmissive = 1.7;
    t.bodyOffsetY = 0; // hoop is centered on the root
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(r, Math.max(0.06, r * 0.08), 12, 48), t.mat,
    );
    ring.userData.zone = null;
    t.tilt.add(ring);
    t.meshes.push(ring);
    t.gateIndex = index;
    t.data.bobPhase = Math.random() * Math.PI * 2;
    t.data.baseY = def.pos.y;

    this._finishTarget(t, def.pos);

    // orient the hoop toward the next gate (or from the previous one)
    const other = all[index + 1] ?? all[index - 1];
    if (other) {
      this._v1.copy(other.pos); this._v1.y = def.pos.y;
      t.root.lookAt(this._v1);
    }
    this.gates.push(t);
    return t;
  }

  _addOrb(kind, pos, radius, colorHex) {
    const t = new Target(kind, 'drill');
    t.maxHp = t.hp = kind === 'flick' ? 1 : 1e9;
    t.respawns = false;
    t.flip = false;
    t.mat = new THREE.MeshStandardMaterial({
      color: 0x1a1006, roughness: 0.4, metalness: 0.2,
      emissive: new THREE.Color(colorHex), emissiveIntensity: 1.6,
    });
    t.baseEmissive = 1.6;
    t.bodyOffsetY = 0; // orb is centered on the root
    const orb = new THREE.Mesh(this._geo.orb, t.mat);
    orb.scale.setScalar(radius);
    orb.userData.zone = 'body';
    t.tilt.add(orb);
    t.meshes.push(orb);
    t.data.radius = radius;
    t.spawnT = 0;
    t.root.scale.setScalar(0.001);
    return this._finishTarget(t, pos);
  }

  _removeTarget(t) {
    const i = this.targets.indexOf(t);
    if (i >= 0) this.targets.splice(i, 1);
    this.group.remove(t.root);
    t.mat?.dispose?.();
    this._rayDirty = true;
  }

  // ---- THE shot query (contract §5.C2) --------------------------------------

  raycastShot(origin, dir, maxDist = 400) {
    const ray = this._raycaster;
    ray.set(origin, this._v1.copy(dir).normalize());
    ray.near = 0;
    ray.far = maxDist;

    // movers shift in fixedUpdate — make sure world matrices are fresh
    this.group.updateMatrixWorld(true);

    if (this._rayDirty) this._rebuildLiveMeshes();
    const solids = this.ctx.world?.range?.solidMeshes ?? [];
    const hits = ray.intersectObjects(solids.concat(this._liveMeshes), true);
    const h = hits[0];
    if (!h) return null;

    // find the owning target (if any) walking up the parent chain
    let target = null;
    let surface = null;
    for (let o = h.object; o; o = o.parent) {
      if (!target && o.userData?.target) target = o.userData.target;
      if (!surface && o.userData?.surface) surface = o.userData.surface;
      if (target) break;
    }

    let normal;
    if (h.face) {
      normal = h.face.normal.clone().transformDirection(h.object.matrixWorld).normalize();
      if (normal.dot(dir) > 0) normal.negate();
    } else {
      normal = this._v1.copy(dir).negate().clone();
    }

    let zone = null;
    if (target) {
      surface = 'target';
      zone = h.object.userData.zone ?? null;
      const rings = h.object.userData.rings;
      if (rings) {
        const local = h.object.worldToLocal(h.point.clone());
        const r = Math.hypot(local.x, local.y);
        zone = r <= rings.bull ? 'bull' : r <= rings.inner ? 'inner' : 'outer';
      }
    } else {
      surface = surface === 'metal' ? 'metal' : 'concrete';
    }

    return { point: h.point.clone(), normal, distance: h.distance, surface, target, zone };
  }

  _rebuildLiveMeshes() {
    this._liveMeshes.length = 0;
    for (const t of this.targets) {
      if (t.alive && !t.hidden && !t.dying) this._liveMeshes.push(...t.meshes);
    }
    this._rayDirty = false;
  }

  // ---- damage / scoring -------------------------------------------------------

  damage(hit, dmg, def) {
    const t = hit?.target;
    if (!t || !t.alive || t.hidden || t.dying) {
      return { points: 0, kill: false, zone: hit?.zone ?? null };
    }
    const now = this.ctx.loop.time;
    const zone = hit.zone ?? null;
    const applied = dmg * (zone === 'head' ? this.params.headDamageMult : 1);

    // per-gun TTK clock: first damage on a full-HP target
    if (t.hp >= t.maxHp && t.section !== 'drill' && t.kind !== 'gate' && t.kind !== 'bullseye') {
      t._ttkStart = now;
      t._ttkGun = def?.id ?? null;
    }
    t.hp -= applied;

    // feedback: flash + knockback wobble
    t.flash = 1;
    this._wobbleImpulse(t, hit, applied);

    // points
    let points = 0;
    if (t.kind === 'gate') points = 0;
    else if (t.kind === 'flick') {
      const reaction = now - (t.data.spawnTime ?? now);
      points = Math.round(clamp(1 - reaction / this.params.flickLifetime, 0, 1) * 100);
    } else if (zone && POINTS[zone] != null) points = POINTS[zone];
    else points = POINTS.body;

    let kill = false;
    if (t.kind === 'dummy') {
      t.hp = Math.max(t.hp, 0);
      this._dummyDamaged(t, applied, now);
    } else if (t.kind === 'gate' || t.kind === 'bullseye' || t.kind === 'track') {
      t.hp = t.maxHp; // scoring surfaces never die
    } else if (t.hp <= 0) {
      kill = true;
      if (t.section !== 'drill') points += this.params.killBonus;
    }

    this.ctx.events.emit('target:hit', {
      target: t, def, damage: applied, zone, points, kill,
      point: hit.point, distance: hit.distance,
    });

    if (kill) this._kill(t, hit, points, now, def);
    if (t.kind === 'flick' && kill) this._flickHit(t, now);

    return { points, kill, zone };
  }

  // ---- spatial queries + area damage (contract §12.6) -----------------------

  /** A target is a valid seek/AoE hit only while alive, shown, and not dying. */
  _isLive(t) {
    return t.alive && !t.hidden && !t.dying;
  }

  /**
   * Live world-space body-center point to home/aim at.
   * root world position + a small (scale-aware) up offset onto the body mesh.
   * Reuses no shared scratch — writes into the caller's `out` and returns it.
   */
  aimPoint(t, out) {
    t.root.getWorldPosition(out);
    out.y += t.bodyOffsetY * (t.root.scale.y || 1);
    return out;
  }

  /**
   * Nearest LIVE target whose aim point is within `maxRadius` of `point`, else null.
   * `exclude` (optional Set) skips targets so multiple seekers spread out.
   */
  nearestTarget(point, maxRadius, exclude = null) {
    const maxSq = maxRadius * maxRadius;
    let best = null;
    let bestSq = maxSq;
    const ap = this._q1;
    for (const t of this.targets) {
      if (!this._isLive(t)) continue;
      if (exclude && exclude.has(t)) continue;
      this.aimPoint(t, ap);
      const dSq = ap.distanceToSquared(point);
      if (dSq <= bestSq) { bestSq = dSq; best = t; }
    }
    return best;
  }

  /** Array of live targets whose aim point is within `radius` of `point`. */
  targetsInRadius(point, radius) {
    const rSq = radius * radius;
    const out = [];
    const ap = this._q1;
    for (const t of this.targets) {
      if (!this._isLive(t)) continue;
      this.aimPoint(t, ap);
      if (ap.distanceToSquared(point) <= rSq) out.push(t);
    }
    return out;
  }

  /**
   * Damage every live target within `radius` of `point` through the SAME path as
   * damage() (score, flash, wobble, TTK, target:hit/target:killed, kill burst).
   * opts.falloff → linear scale to 0 at the edge (center takes full dmg).
   * Builds a synthetic hit per target so Feel/HUD/fx treat each like a real hit.
   * Returns the array of damage() results.
   */
  damageArea(point, radius, dmg, def, opts = null) {
    const falloff = !!(opts && opts.falloff);
    // snapshot the victims first: damage() can flip liveness (kills flag dying),
    // and a kill removing meshes must not perturb the in-progress scan.
    const victims = this.targetsInRadius(point, radius);
    const results = [];
    const ap = this._q1;      // aim point (safe: targetsInRadius is done using it)
    const nrm = this._q2;     // hit normal, pointing from the target toward `point`
    const invR = radius > 0 ? 1 / radius : 0;
    for (const t of victims) {
      // re-check: an earlier chained kill/AoE could have downed this one
      if (!this._isLive(t)) continue;
      this.aimPoint(t, ap);
      let scaled = dmg;
      if (falloff) {
        const d = ap.distanceTo(point);
        const s = clamp(1 - d * invR, 0, 1); // 1 at center → 0 at edge
        scaled = dmg * s;
      }
      // normal toward the blast origin (fall back to +Y at dead-center)
      nrm.subVectors(point, ap);
      if (nrm.lengthSq() < 1e-8) nrm.set(0, 1, 0); else nrm.normalize();
      const hit = {
        point: ap.clone(),
        normal: nrm.clone(),
        distance: ap.distanceTo(point),
        surface: 'target',
        target: t,
        zone: 'body',
      };
      results.push(this.damage(hit, scaled, def));
    }
    return results;
  }

  _wobbleImpulse(t, hit, dmg) {
    const kick = this.params.wobbleKick * clamp(0.4 + dmg / 60, 0.4, 2);
    const local = t.root.worldToLocal(this._v2.copy(hit.point));
    t.wob.vx -= kick;                                      // tip away from shooter
    t.wob.vz -= kick * clamp(local.x * 2.2, -1, 1) * 0.8;  // twist toward off-center hits
  }

  _kill(t, hit, points, now, def) {
    t.alive = false;
    t.dying = true;
    t.dieT = 0;
    this._rayDirty = true;

    if (t._ttkStart != null) {
      this.ctx.events.emit('stats:ttk', {
        gunId: t._ttkGun, ms: Math.max(0, Math.round((now - t._ttkStart) * 1000)),
      });
      t._ttkStart = null;
    }

    this.ctx.events.emit('target:killed', { target: t, points, point: hit.point, def });
    this.ctx.fx?.particles?.burst?.({
      position: hit.point.clone(), count: 26, color: 0xffb066,
      speed: 6, spread: 1, life: 0.5, size: 0.05, gravity: 9,
    });

    if (t.respawns) t.respawnAt = now + this.params.respawnSec;
  }

  _respawn(t, emit = true) {
    t.hp = t.maxHp;
    t.alive = true;
    t.dying = false;
    t.dieT = 0;
    t.respawnAt = null;
    t.flash = 0;
    t.wob.x = t.wob.z = t.wob.vx = t.wob.vz = 0;
    t.tilt.rotation.set(0, 0, 0);
    t.root.visible = true;
    t.root.scale.setScalar(0.001);
    t.spawnT = 0;
    t._ttkStart = null;
    if (t.kind === 'peeker' && t.data.peek) {
      const pk = t.data.peek;
      pk.state = 'down'; pk.timer = this._jitter(pk.downTime); pk.f = 0;
      t.hidden = true;
      t.root.position.copy(pk.hidePos);
    } else {
      t.hidden = false;
    }
    this._rayDirty = true;
    if (emit) this.ctx.events.emit('target:respawn', { target: t });
  }

  _despawn(t) {
    t.alive = false;
    t.dying = false;
    t.respawnAt = null;
    t.root.visible = false;
    this._rayDirty = true;
  }

  // ---- section control (range menu) --------------------------------------------

  _spawnSection(section) {
    for (const t of this.targets) {
      if (t.section === 'drill') continue;
      if (section !== 'all' && t.section !== section) continue;
      this._respawn(t, true);
    }
  }

  _clearAll() {
    this._abortDrill();
    for (const t of this.targets) {
      if (t.section === 'drill') continue;
      this._despawn(t);
    }
  }

  _resetAll() {
    this._abortDrill();
    this._spawnSection('all');
  }

  // ---- fixed-step simulation ------------------------------------------------------

  fixedUpdate(dt) {
    const now = this.ctx.loop.time;
    const P = this.params;

    // snapshot — finished drill targets remove themselves mid-loop
    for (const t of this.targets.slice()) {
      // respawn timer
      if (!t.alive && !t.dying && t.respawnAt != null && now >= t.respawnAt) {
        this._respawn(t, true);
      }

      if (!t.root.visible && !t.dying) continue;

      // death animation: flip-down (silhouettes) or scale-pop (orbs/riders)
      if (t.dying) {
        t.dieT += dt;
        const d = Math.min(1, t.dieT / 0.28);
        if (t.flip) {
          t.tilt.rotation.x = -easeOutCubic(d) * (Math.PI / 2) * 1.05;
        } else {
          const s = Math.max(0.001, (1 - d) * (1 + 0.45 * Math.sin(d * Math.PI)));
          t.root.scale.setScalar(t.baseScale * s);
        }
        if (d >= 1) {
          t.dying = false;
          t.root.visible = false;
          if (t.section === 'drill') this._removeTarget(t);
        }
        continue;
      }

      // spawn scale-in with a little overshoot
      if (t.spawnT < 1) {
        t.spawnT = Math.min(1, t.spawnT + dt / 0.3);
        t.root.scale.setScalar(t.baseScale * Math.max(0.001, easeOutBack(t.spawnT)));
      }

      // hit flash — emissive pulse on the per-target material
      if (t.flash > 0.001 || t.mat) {
        t.flash *= Math.exp(-dt * P.flashDecay);
        if (t.mat) {
          t.mat.emissiveIntensity =
            (t.dimmed ? 0.12 : t.baseEmissive) + t.flash * P.flashGain;
        }
      }

      // knockback wobble spring
      const w = t.wob;
      if (t.alive && (Math.abs(w.x) > 1e-4 || Math.abs(w.z) > 1e-4 || Math.abs(w.vx) > 1e-4 || Math.abs(w.vz) > 1e-4)) {
        w.vx += (-P.wobbleK * w.x - P.wobbleDamp * w.vx) * dt;
        w.vz += (-P.wobbleK * w.z - P.wobbleDamp * w.vz) * dt;
        w.x += w.vx * dt;
        w.z += w.vz * dt;
        t.tilt.rotation.x = w.x;
        t.tilt.rotation.z = w.z;
      }

      // movement (velocity tracked so leading matters)
      if (t.kind === 'mover' && t.data.path) this._updateMover(t, now, dt);
      else if (t.kind === 'peeker' && t.data.peek) this._updatePeeker(t, dt);
      else if (t.kind === 'gate') {
        t.tilt.rotation.y += dt * 0.4;
        t.root.position.y = t.data.baseY + Math.sin(now * 1.3 + t.data.bobPhase) * 0.08;
      } else if (t.kind === 'dummy') this._updateDummy(t, now);
      else if (t.kind === 'track') this._updateTrackOrb(t, dt);
    }

    this._updateDrill(dt, now);
  }

  _updateMover(t, now, dt) {
    const p = t.data.path;
    const pos = this._v1;
    if (p.type === 'C') {
      const ang = (now / p.period + p.phase) * Math.PI * 2;
      pos.set(
        p.center.x + Math.cos(ang) * p.radius,
        p.center.y,
        p.center.z + Math.sin(ang) * p.radius,
      );
    } else {
      const f = pingpongEase(now / p.period + p.phase);
      pos.lerpVectors(p.from, p.to, f);
    }
    // First tick: prevPos was seeded at the target's build position, which for
    // random-phase circular movers is an arbitrary angle away — computing
    // velocity from it would emit one frame of garbage lead. Zero it instead.
    if (t.moverInit) {
      t.velocity.subVectors(pos, t.prevPos).divideScalar(dt);
    } else {
      t.velocity.set(0, 0, 0);
      t.moverInit = true;
    }
    t.prevPos.copy(pos);
    t.root.position.copy(pos);
  }

  _updatePeeker(t, dt) {
    const pk = t.data.peek;
    const rise = this.params.peekMoveTime;
    pk.timer -= dt;
    switch (pk.state) {
      case 'down':
        if (pk.timer <= 0) { pk.state = 'rising'; pk.timer = rise; }
        break;
      case 'rising':
        pk.f = clamp(pk.f + dt / rise, 0, 1);
        if (pk.f >= 1) { pk.state = 'up'; pk.timer = this._jitter(pk.upTime); }
        break;
      case 'up':
        if (pk.timer <= 0) { pk.state = 'falling'; pk.timer = rise; }
        break;
      case 'falling':
        pk.f = clamp(pk.f - dt / rise, 0, 1);
        if (pk.f <= 0) { pk.state = 'down'; pk.timer = this._jitter(pk.downTime); }
        break;
    }
    const pos = this._v1.lerpVectors(pk.hidePos, pk.pos, smooth(pk.f));
    t.velocity.subVectors(pos, t.prevPos).divideScalar(dt);
    t.prevPos.copy(pos);
    t.root.position.copy(pos);

    const hidden = pk.f < 0.2;
    if (hidden !== t.hidden) { t.hidden = hidden; this._rayDirty = true; }
  }

  _dummyDamaged(t, dmg, now) {
    const d = t.data.dps;
    if (now - d.lastDamage > this.params.dummyRegenDelay) {
      d.log.length = 0;
      d.windowStart = now;
      // wait one interval before the first emit so the readout reflects a real
      // elapsed span, not the clamped 0.25 s floor (which 4× inflates the spike)
      d.nextEmit = now + this.params.dpsEmitInterval;
    }
    d.lastDamage = now;
    d.log.push({ t: now, dmg });
  }

  _updateDummy(t, now) {
    const d = t.data.dps;
    const P = this.params;
    // prune rolling window
    while (d.log.length && d.log[0].t < now - P.dummyRegenDelay) d.log.shift();

    if (now - d.lastDamage <= P.dummyRegenDelay && d.log.length) {
      if (now >= d.nextEmit) {
        d.nextEmit = now + P.dpsEmitInterval;
        const total = d.log.reduce((s, e) => s + e.dmg, 0);
        const windowSec = clamp(now - Math.max(d.windowStart, d.log[0].t), P.dpsEmitInterval, P.dummyRegenDelay);
        this.ctx.events.emit('stats:dps', { dps: Math.round(total / windowSec) });
      }
    } else if (t.hp < t.maxHp && now - d.lastDamage > P.dummyRegenDelay) {
      t.hp = t.maxHp; // regenerate to full after 3 s without damage
      t.flash = 0.6;  // brief pulse sells the regen
      d.log.length = 0;
    }
  }

  // ---- drills ----------------------------------------------------------------------

  _startDrill(type) {
    this._abortDrill();
    const cd = Math.max(0.5, this.params.drillCountdown);
    this.drill = {
      type, phase: 'count', t: 0,
      score: 0, hits: 0, misses: 0, reactions: [],
      spawned: 0, active: null,
      elapsed: 0, onTime: 0, tickTimer: 0,
    };
    // beep ×3 then beep_go, drill begins on the go
    const a = this.ctx.audio;
    for (let i = 3; i >= 1; i--) a?.play?.('beep', { delay: Math.max(0, cd - i), volume: 0.8 });
    a?.play?.('beep_go', { delay: cd, volume: 1 });
  }

  _abortDrill() {
    const d = this.drill;
    if (!d) return;
    this.drill = null;
    if (d.active) { this._despawn(d.active); this._removeTarget(d.active); }
    if (d.phase === 'run') {
      this.ctx.events.emit('drill:end', this._drillSummary(d));
    }
  }

  _drillSummary(d) {
    if (d.type === 'tracking') {
      const acc = d.elapsed > 0 ? d.onTime / d.elapsed : 0;
      return {
        type: 'tracking', score: Math.round(acc * 100),
        hits: d.hits, misses: d.misses, accuracy: acc, avgReactionMs: 0,
      };
    }
    const total = d.hits + d.misses;
    const avg = d.reactions.length
      ? Math.round(d.reactions.reduce((s, r) => s + r, 0) / d.reactions.length) : 0;
    return {
      type: 'flick', score: d.score, hits: d.hits, misses: d.misses,
      accuracy: total > 0 ? d.hits / total : 0, avgReactionMs: avg,
    };
  }

  _drillTick(d, timeLeft) {
    this.ctx.events.emit('drill:tick', {
      type: d.type, score: d.score, hits: d.hits, misses: d.misses,
      timeLeft: Math.max(0, timeLeft),
    });
  }

  _randDrillPoint(out) {
    const v = this._drillVolume;
    out.set(
      randRange(v.min.x, v.max.x),
      randRange(v.min.y, v.max.y),
      randRange(v.min.z, v.max.z),
    );
    return out;
  }

  _updateDrill(dt, now) {
    const d = this.drill;
    if (!d) return;

    if (d.phase === 'count') {
      d.t += dt;
      if (d.t < this.params.drillCountdown) return;
      d.phase = 'run';
      if (d.type === 'tracking') {
        const pos = this._randDrillPoint(this._v1);
        d.active = this._addOrb('track', pos, 0.3, 0xff2fd6);
        d.active.data.vel = new THREE.Vector3();
        d.active.data.wp = this._randDrillPoint(new THREE.Vector3());
        d.active.data.retarget = 0;
      } else {
        this._spawnFlick(d, now);
      }
      this._drillTick(d, d.type === 'tracking' ? this.params.trackingDuration : this.params.flickCount);
      return;
    }

    if (d.type === 'flick') this._runFlick(d, dt, now);
    else this._runTracking(d, dt, now);
  }

  // -- flick: 20 rapid reaction targets ------------------------------------------

  _spawnFlick(d, now) {
    const pos = this._randDrillPoint(this._v1);
    // keep consecutive spawns apart so the flick is real
    if (d.lastPos) {
      for (let i = 0; i < 8 && pos.distanceTo(d.lastPos) < 2.5; i++) this._randDrillPoint(pos);
    }
    d.lastPos = (d.lastPos ?? new THREE.Vector3()).copy(pos);
    d.active = this._addOrb('flick', pos, this.params.flickRadius, 0xffc21a);
    d.active.data.spawnTime = now;
    d.spawned++;
  }

  _flickHit(t, now) {
    const d = this.drill;
    if (!d || d.active !== t) return;
    d.active = null;
    d.hits++;
    const reaction = Math.max(0, (now - (t.data.spawnTime ?? now)) * 1000);
    d.reactions.push(reaction);
    d.score += Math.round(clamp(1 - reaction / (this.params.flickLifetime * 1000), 0, 1) * 100);
    this._drillTick(d, this.params.flickCount - d.spawned);
    this._flickNext(d, now);
  }

  _runFlick(d, dt, now) {
    const t = d.active;
    if (t && now - t.data.spawnTime >= this.params.flickLifetime) {
      // timed out — miss
      d.active = null;
      d.misses++;
      t.alive = false; t.dying = true; t.dieT = 0; // quiet shrink-out
      this._rayDirty = true;
      this._drillTick(d, this.params.flickCount - d.spawned);
      this._flickNext(d, now);
    }
  }

  _flickNext(d, now) {
    if (d.spawned >= this.params.flickCount) {
      this.ctx.events.emit('drill:end', this._drillSummary(d));
      this.drill = null;
    } else {
      this._spawnFlick(d, now);
    }
  }

  // -- tracking: one strafing orb, score = time-on-target -------------------------

  _runTracking(d, dt, now) {
    const t = d.active;
    if (!t) { this.drill = null; return; }
    d.elapsed += dt;

    // cheap ray-sphere "is the player pointing at it" test
    const cam = this.ctx.camera;
    const org = cam.getWorldPosition(this._v1);
    const dir = cam.getWorldDirection(this._v2);
    const L = this._v3.copy(t.root.position).sub(org);
    const tca = L.dot(dir);
    const on = tca > 0 && (L.lengthSq() - tca * tca) <= this.params.trackAimRadius ** 2;
    if (on) { d.onTime += dt; d.hits++; } else d.misses++;
    d.score = d.elapsed > 0 ? Math.round((d.onTime / d.elapsed) * 100) : 0;

    d.tickTimer += dt;
    if (d.tickTimer >= 0.25) {
      d.tickTimer -= 0.25;
      this._drillTick(d, this.params.trackingDuration - d.elapsed);
    }

    if (d.elapsed >= this.params.trackingDuration) {
      this.ctx.events.emit('drill:end', this._drillSummary(d));
      this._despawn(t);
      this._removeTarget(t);
      this.drill = null;
    }
  }

  _updateTrackOrb(t, dt) {
    const d = t.data;
    if (!d.vel) return;
    d.retarget -= dt;
    if (d.retarget <= 0) {
      d.retarget = randRange(0.6, 1.8);
      this._randDrillPoint(d.wp);
    }
    // steer toward waypoint with capped speed + a nervous vertical shimmy
    const P = this.params;
    const acc = this._v1.subVectors(d.wp, t.root.position).normalize().multiplyScalar(P.trackingAccel);
    acc.y += Math.sin(this.ctx.loop.time * 5.1 + t.id) * 3.5;
    d.vel.addScaledVector(acc, dt);
    const sp = d.vel.length();
    if (sp > P.trackingSpeed) d.vel.multiplyScalar(P.trackingSpeed / sp);

    const pos = t.root.position.addScaledVector(d.vel, dt);
    // stay inside the drill volume — reflect on the walls
    const v = this._drillVolume;
    for (const ax of ['x', 'y', 'z']) {
      if (pos[ax] < v.min[ax]) { pos[ax] = v.min[ax]; d.vel[ax] = Math.abs(d.vel[ax]); }
      else if (pos[ax] > v.max[ax]) { pos[ax] = v.max[ax]; d.vel[ax] = -Math.abs(d.vel[ax]); }
    }
    t.velocity.copy(d.vel);
    t.prevPos.copy(pos);
  }

  // ---- tunables (§8, cat 'targets') ------------------------------------------------

  _registerTunables() {
    const P = this.params;
    const push = (key, min, max, step, label) =>
      this.ctx.tunables.push({ cat: 'targets', key, obj: P, prop: key, min, max, step, label });

    push('silhouetteHP', 10, 500, 5, 'Silhouette HP');
    push('respawnSec', 0.5, 10, 0.1, 'Respawn delay (s)');
    push('killBonus', 0, 100, 5, 'Kill bonus points');
    push('headDamageMult', 1, 4, 0.05, 'Headshot damage ×');
    push('dummyHP', 100, 5000, 50, 'DPS dummy HP');
    push('dummyRegenDelay', 1, 10, 0.25, 'Dummy regen delay (s)');
    push('flashGain', 0, 6, 0.1, 'Hit flash strength');
    push('flashDecay', 1, 30, 0.5, 'Hit flash decay');
    push('wobbleK', 20, 400, 5, 'Wobble spring K');
    push('wobbleDamp', 1, 30, 0.5, 'Wobble damping');
    push('wobbleKick', 0, 3, 0.05, 'Wobble kick');
    push('peekMoveTime', 0.05, 1, 0.01, 'Peeker rise time (s)');
    push('drillCountdown', 0.5, 5, 0.5, 'Drill countdown (s)');
    push('flickCount', 5, 50, 1, 'Flick target count');
    push('flickLifetime', 0.4, 4, 0.1, 'Flick lifetime (s)');
    push('flickRadius', 0.08, 0.5, 0.01, 'Flick target radius');
    push('trackingDuration', 10, 60, 5, 'Tracking duration (s)');
    push('trackingSpeed', 1, 15, 0.25, 'Tracking orb speed');
    push('trackingAccel', 2, 40, 1, 'Tracking orb accel');
    push('trackAimRadius', 0.2, 1.5, 0.05, 'Tracking aim radius');
  }
}
