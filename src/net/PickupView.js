// ARENA client — net/PickupView.js
// Renders the floating, slowly-rotating, glowing MARKERS for a map's gameplay
// pickups (weapon / health / armor / powerup spawns) and reflects their live
// alive/taken state from the snapshot. Pickup logic is SERVER-authoritative: the
// server grants on touch and echoes the set of ALIVE pickup ids each snapshot;
// this view only shows/hides markers to match, popping a small burst + a respawn
// shimmer when one reappears.
//
// Code-built, no assets. Each kind gets a distinct, readable marker:
//   weapon  = a golden spinning diamond (octahedron) — "a gun is here"
//   health  = a green cross
//   armor   = a cyan shield (rounded plate)
//   powerup = a pulsing purple orb + halo
// Markers bob + rotate slowly so they read as pickups; the emissive/additive
// glow uses MeshBasicMaterial (auto node-material on WebGPU). Public API mirrors
// ProjectileView: setMap(map) · pushSnapshot(alivePickupIds) · update(dt) · dispose().
import * as THREE from 'three';

const KIND_COLOR = {
  weapon: 0xffd166, health: 0x51e898, armor: 0x7df9ff, powerup: 0xb15bff,
};

// ---------------------------------------------------------------------------
// one pickup marker: a small group at the pickup's world pos, bobbing + spinning.
// ---------------------------------------------------------------------------
class PickupMarker {
  constructor(scene, pickup) {
    this.scene = scene;
    this.id = pickup.id;
    this.kind = pickup.kind || 'weapon';
    this.basePos = new THREE.Vector3(pickup.pos?.x || 0, pickup.pos?.y || 0, pickup.pos?.z || 0);
    this.color = KIND_COLOR[this.kind] || 0xffffff;

    this.alive = true;         // server-reported alive state
    this._shown = true;        // current mesh visibility target
    this.appear = 1;           // 0..1 respawn shimmer envelope
    this.phase = Math.random() * Math.PI * 2; // desync bob/spin between markers

    this.group = new THREE.Group();
    this.group.position.copy(this.basePos);
    this._mats = [];           // additive/emissive mats to pulse
    this._solids = [];         // solid mats to scale opacity on shimmer
    this._build();
    scene.add(this.group);
  }

  _addMat(m, additive) { (additive ? this._mats : this._solids).push(m); return m; }

  _build() {
    const c = this.color;
    if (this.kind === 'health') this._buildCross(0x51e898);
    else if (this.kind === 'armor') this._buildShield(0x7df9ff);
    else if (this.kind === 'powerup') this._buildOrb(0xb15bff);
    else this._buildDiamond(c); // weapon (+ any unknown kind)

    // a soft ground glow disc under every marker so it pops off the floor
    const discMat = this._addMat(new THREE.MeshBasicMaterial({
      color: c, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending,
      depthWrite: false, toneMapped: false,
    }), true);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.5, 20), discMat);
    disc.rotation.x = -Math.PI / 2; disc.position.y = -0.55;
    this.group.add(disc); this._geoTrack(disc);
  }

  _buildDiamond(c) {
    const solid = this._addMat(new THREE.MeshStandardMaterial({ color: c, emissive: new THREE.Color(c), emissiveIntensity: 0.8, metalness: 0.6, roughness: 0.3 }), false);
    const d = new THREE.Mesh(new THREE.OctahedronGeometry(0.34), solid);
    this.spinNode = d; this.group.add(d); this._geoTrack(d);
    const halo = this._addMat(new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), true);
    const h = new THREE.Mesh(new THREE.OctahedronGeometry(0.5), halo);
    d.add(h); this._geoTrack(h);
  }

  _buildCross(c) {
    const g = new THREE.Group();
    const solid = this._addMat(new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: new THREE.Color(c), emissiveIntensity: 0.9, roughness: 0.4 }), false);
    const barV = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.5, 0.16), solid);
    const barH = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.16), solid);
    g.add(barV); g.add(barH); this._geoTrack(barV); this._geoTrack(barH);
    const halo = this._addMat(new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), true);
    const hv = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.6, 0.24), halo);
    const hh = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.24, 0.24), halo);
    g.add(hv); g.add(hh); this._geoTrack(hv); this._geoTrack(hh);
    this.spinNode = g; this.group.add(g);
  }

  _buildShield(c) {
    const solid = this._addMat(new THREE.MeshStandardMaterial({ color: 0x2a4a55, emissive: new THREE.Color(c), emissiveIntensity: 0.7, metalness: 0.7, roughness: 0.35 }), false);
    // a rounded plate: a slightly squashed sphere reads as a shield boss
    const plate = new THREE.Mesh(new THREE.SphereGeometry(0.34, 16, 12), solid);
    plate.scale.set(1, 1.15, 0.4);
    this.spinNode = plate; this.group.add(plate); this._geoTrack(plate);
    const halo = this._addMat(new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), true);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.04, 8, 24), halo);
    plate.add(ring); this._geoTrack(ring);
  }

  _buildOrb(c) {
    const core = this._addMat(new THREE.MeshBasicMaterial({ color: c, toneMapped: false }), true);
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.26, 16, 12), core);
    this.spinNode = orb; this.group.add(orb); this._geoTrack(orb);
    const halo = this._addMat(new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), true);
    const h = new THREE.Mesh(new THREE.SphereGeometry(0.44, 16, 12), halo);
    orb.add(h); this._geoTrack(h);
    this._pulse = halo;
  }

  _geoTrack(mesh) { (this._geos || (this._geos = [])).push(mesh.geometry); }

  // advance bob + spin + the respawn shimmer envelope.
  update(dt, t) {
    if (this.appear < 1) this.appear = Math.min(1, this.appear + dt / 0.4);
    const vis = this._shown;
    this.group.visible = vis;
    if (!vis) return;
    const bob = Math.sin(t * 1.6 + this.phase) * 0.12;
    this.group.position.set(this.basePos.x, this.basePos.y + bob, this.basePos.z);
    if (this.spinNode) this.spinNode.rotation.y = t * 1.1 + this.phase;
    // shimmer: scale + glow up as it reappears
    const s = 0.6 + 0.4 * this.appear;
    this.group.scale.setScalar(s);
    // powerup gently pulses its halo
    if (this._pulse) this._pulse.opacity = 0.35 + 0.2 * (0.5 + 0.5 * Math.sin(t * 3 + this.phase));
  }

  setAlive(alive) {
    if (alive === this.alive) return;
    this.alive = alive;
    this._shown = alive;
    if (alive) this.appear = 0; // trigger the respawn shimmer
  }

  dispose() {
    this.scene.remove(this.group);
    if (this._geos) for (const g of this._geos) g?.dispose?.();
    for (const m of this._mats) m?.dispose?.();
    for (const m of this._solids) m?.dispose?.();
    this._geos = null; this._mats.length = 0; this._solids.length = 0;
  }
}

// ---------------------------------------------------------------------------
export class PickupView {
  /**
   * @param {object} ctx  game context (ctx.scene, ctx.fx.particles).
   */
  constructor(ctx) {
    this.ctx = ctx;
    this.markers = new Map(); // id -> PickupMarker
    this._t = 0;
    this._firstSnap = true;   // don't burst on the very first alive-set apply
  }

  // (Re)build markers for a map's pickups. Called on map apply/change.
  setMap(map) {
    this._clear();
    this._firstSnap = true;
    const pickups = (map && Array.isArray(map.pickups)) ? map.pickups : [];
    for (const p of pickups) {
      if (!p || !p.id || !p.pos) continue;
      try {
        this.markers.set(p.id, new PickupMarker(this.ctx.scene, p));
      } catch (e) { /* never let one bad pickup break the view */ }
    }
  }

  // Reflect the server's alive set: hide taken pickups, show (+burst) respawned.
  // `alive` may be an array of ids OR an array of { id, alive } — tolerate both.
  pushSnapshot(alive) {
    if (!this.markers.size) return;
    const aliveSet = new Set();
    if (Array.isArray(alive)) {
      for (const a of alive) {
        if (a == null) continue;
        if (typeof a === 'object') { if (a.alive !== false && a.id != null) aliveSet.add(a.id); }
        else aliveSet.add(a);
      }
    } else if (alive == null) {
      // no pickup field this snap → assume all alive (don't spuriously hide)
      for (const id of this.markers.keys()) aliveSet.add(id);
    }

    for (const [id, mk] of this.markers) {
      const nowAlive = aliveSet.has(id);
      const wasAlive = mk.alive;
      mk.setAlive(nowAlive);
      // pop a small pickup burst when one goes from alive → taken (a player grabbed
      // it) and a respawn shimmer is handled inside the marker on taken → alive.
      if (!this._firstSnap && wasAlive && !nowAlive) this._burst(mk, false);
      if (!this._firstSnap && !wasAlive && nowAlive) this._burst(mk, true);
    }
    this._firstSnap = false;
  }

  _burst(mk, respawn) {
    const parts = this.ctx.fx?.particles;
    if (!parts?.burst) return;
    parts.burst({
      position: mk.basePos.clone(),
      count: respawn ? 14 : 18, color: mk.color,
      speed: respawn ? 3 : 5, spread: 1,
      life: respawn ? 0.5 : 0.4, size: 0.12, gravity: respawn ? -2 : 3, drag: 1.4,
    });
  }

  update(dt) {
    this._t += dt;
    for (const mk of this.markers.values()) mk.update(dt, this._t);
  }

  _clear() {
    for (const mk of this.markers.values()) mk.dispose();
    this.markers.clear();
  }

  dispose() { this._clear(); }
}
