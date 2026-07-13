// ARENA client — net/ArenaMode.js
// The multiplayer orchestrator. Builds the arena + net stack and drives the
// local predicted player + interpolated remotes, reusing RANGE's camera,
// viewmodel, weapons, HUD, feel and fx unchanged. Constructed by main.js when
// ?mode=arena. Owns: Arena geometry, AudioBank, Connection, Prediction,
// Interpolation, NetDebug, and the local↔server shot/hit/death wiring.
import * as THREE from 'three';
import { MapRenderer } from '../world/MapRenderer.js';
import { MapSelect } from '../ui/MapSelect.js';
import { AudioBank } from '../audio/AudioBank.js';
import { NetDebug } from './NetDebug.js';
import { Connection } from './Connection.js';
import { Prediction } from './Prediction.js';
import { Interpolation } from './Interpolation.js';
import { ProjectileView } from './ProjectileView.js';
import { PickupView } from './PickupView.js';
import { KillCam } from './KillCam.js';
import { DamageIndicator } from '../ui/DamageIndicator.js';
import { KillFeed } from '../ui/KillFeed.js';
import { HealthBar } from '../ui/HealthBar.js';
import { AccoladeFeed } from '../ui/AccoladeFeed.js';
import { INTERP_DELAY_MS, CREW, GRENADE, ACCOLADES } from '../../shared/constants.js';
import { getMap, mapList, DEFAULT_MAP, registerCustomMap } from '../../shared/maps.js';
import { buildLiveWorld } from '../../shared/mapsim.js';
import { POWERUPS, CUSTOM_START_WEAPONS } from '../../shared/custommap.js';

const FOOTSTEPS = ['footstep_01', 'footstep_02', 'footstep_03', 'footstep_04'];

export class ArenaMode {
  constructor(ctx) {
    this.ctx = ctx;

    // --- map-driven world: the client renders the chosen map + derives the LIVE
    // collision world (open doors/broken walls removed, platforms placed) that
    // prediction runs against, IDENTICAL to the server. Map from welcome; default
    // until then. ---
    this.map = getMap(DEFAULT_MAP);
    this.mapDyn = { doors: {}, destroyed: new Set() }; // dynamic state from snapshots
    this.mapRenderer = new MapRenderer(ctx, this.map);
    ctx.world.colliders = buildLiveWorld(this.map, this.mapDyn, 0);
    ctx.world.range = { consoleMesh: null, spawnPoint: new THREE.Vector3(0, 0, 0), spawnYaw: 0, anchors: {} }; // stub for reused modules
    this._raycaster = new THREE.Raycaster();
    ctx.world.raycastShot = (o, d, m) => this._raycastShot(o, d, m);

    // --- audio (real samples + synth fallback) ---
    this.audioBank = new AudioBank(ctx);
    this._footIdx = 0;

    // --- net stack ---
    this.debug = new NetDebug(ctx);
    this.conn = new Connection(ctx, { netsim: this.debug });
    const spawn = this.map.spawns[0] || { pos: { x: 0, y: 0, z: 0 }, yaw: 0 };
    this.pred = new Prediction(ctx, this.conn, { spawn: { pos: { ...spawn.pos }, yaw: spawn.yaw }, world: ctx.world.colliders, onEvent: (n, d) => this._moveAudio(n, d) });
    this.interp = new Interpolation(ctx, this.conn);
    ctx.player.camera.yaw = spawn.yaw;

    // --- combat feedback ---
    this.projView = new ProjectileView(ctx, { audio: this.audioBank });
    this.pickupView = new PickupView(ctx);              // 2: gameplay-object markers
    this.pickupView.setMap(this.map);
    this._buildPickupFlash();                            // "PICKED UP X" HUD flash
    this.dmgIndicator = new DamageIndicator(ctx);
    this.killFeed = new KillFeed(ctx);
    this.killCam = new KillCam(ctx);
    this.healthBar = new HealthBar(ctx);
    this.accoladeFeed = new AccoladeFeed(ctx);      // 1E: server-validated kill medals
    this.playerInfo = new Map(); // id -> { name, color }
    // expose accolade thresholds in the debug panel (shipping defaults; server reads its own copy)
    for (const [key, min, max, step] of [['multiWindowMs', 1000, 8000, 100], ['longshotDist', 15, 120, 1], ['fastSpeed', 4, 16, 0.5], ['trickshotDist', 10, 80, 1]]) {
      ctx.tunables.push({ cat: 'accolades', key, obj: ACCOLADES, prop: key, min, max, step });
    }
    this._dead = false;
    this.myHp = 100; this.myAlive = true;

    // Projectiles are SERVER-authoritative in arena mode — suppress the local
    // ProjectileManager so exotic/sawblade don't double-simulate (the fire still
    // plays anim/recoil/sound and sends the shot to the server, which spawns the
    // networked projectile everyone renders from snapshots).
    if (ctx.weapons?.projectiles) ctx.weapons.projectiles.spawn = () => null;

    this._wireNet();
    this._wireLocalFire();

    // G = throw grenade
    this._v = new THREE.Vector3();
    ctx.input.onKeyDown('KeyG', () => this._throwGrenade());

    // B = browse maps (any crew member can switch the shared lobby map)
    this.mapSelect = new MapSelect(ctx, {
      mapList: mapList(), currentId: this.map.id,
      onPick: (id) => this.conn.sendSetMap(id),
    });
    ctx.input.onKeyDown('KeyB', () => {
      if (this.mapSelect.isOpen) { this.mapSelect.close(); ctx.input.popUI('mapselect'); }
      else { ctx.input.pushUI('mapselect'); this.mapSelect.open(); }
    });

    // N = toggle the match accolade summary (requests the server's full list)
    this._summaryOpen = false;
    ctx.input.onKeyDown('KeyN', () => {
      this._summaryOpen = !this._summaryOpen;
      if (this._summaryOpen) { this.conn.sendSummaryReq(); }
      else { this.accoladeFeed.hideSummary(); }
    });

    this.conn.join({ preferredCrew: null });
    this._statTimer = 0;
  }

  // Apply a map by id (welcome / map_change): rebuild the renderer + collision.
  // `custom` (optional) is the raw authored JSON for a CUSTOM map — the client
  // registers it locally FIRST so getMap()/buildLiveWorld() resolve it exactly like
  // a built-in (identical collision → netcode/prediction unchanged).
  _applyMap(mapId, mapState, custom) {
    if (custom) registerCustomMap(custom);
    const nm = getMap(mapId);
    if (nm.id !== this.map.id || nm.custom) { this.map = nm; this.mapRenderer.setMap(nm); this.pickupView?.setMap(nm); }
    this.mapDyn = { doors: (mapState && mapState.doors) || {}, destroyed: new Set((mapState && mapState.destroyed) || []) };
    this.ctx.world.colliders = buildLiveWorld(this.map, this.mapDyn, this.conn.serverNow() / 1000);
    this._applyLoadout();
  }

  // CUSTOM maps force ARENA pickups: the player is stripped to a starter loadout
  // (knife + pistol) and must FIND guns as map pickups. Every other map keeps the
  // full arsenal (weapon wheel). Re-applied on spawn/respawn (map + death).
  _applyLoadout() {
    const wm = this.ctx.weapons;
    if (!wm?.setAcquired) return;
    if (this.map?.custom) wm.setAcquired(CUSTOM_START_WEAPONS);
    else wm.setAcquired(wm.defs.map((d) => d.id));
  }

  // resolve a player's { name, color } for feed/killcam
  _info(id) {
    if (id === this.conn.id && this.myCrew) return { name: this.myCrew.name, color: this.myCrew.color };
    if (this.playerInfo.has(id)) return this.playerInfo.get(id);
    const rp = this.interp.remotes.get(id);
    if (rp) return { name: rp.name, color: rp.color };
    return { name: '???', color: 0x8899aa };
  }

  // ---- net event wiring ----
  _wireNet() {
    const conn = this.conn;
    conn.on('welcome', (w) => {
      // the server's full map list (incl. custom maps) drives the picker
      if (Array.isArray(w.maps) && this.mapSelect) this.mapSelect.setList(w.maps);
      if (w.mapId) this._applyMap(w.mapId, w.map, w.mapCustom);
      if (w.mapId && this.mapSelect) this.mapSelect.setCurrent(w.mapId);
      this.interp.onWelcome(w);
      if (w.spawn) { this.pred.setSpawn(w.spawn); this.ctx.player.camera.yaw = w.spawn.yaw; }
      this.myCrew = w.crew;
      for (const p of w.players || []) this.playerInfo.set(p.id, { name: p.name, color: p.color });
    });
    conn.on('map_change', (m) => {
      if (!m) return;
      this._applyMap(m.mapId, m.map, m.custom);
      this.mapSelect.setCurrent(m.mapId);
    });
    conn.on('player_join', (info) => { this.interp.spawnRemote(info); this.playerInfo.set(info.id, { name: info.name, color: info.color }); });
    conn.on('player_leave', (m) => this.interp.despawnRemote(m.id));
    conn.on('snapshot', (snap) => {
      this.pred.onSnapshot(snap);
      this.interp.onSnapshot(snap);
      this.projView.pushSnapshot(snap.serverTime, snap.projectiles || []);
      // pickups: server sends the set of ALIVE pickup ids (or {id,alive}). Absent
      // field → PickupView leaves all shown (guarded there).
      if (snap.pickups !== undefined) this.pickupView.pushSnapshot(snap.pickups);
      if (snap.map) {
        this.mapDyn = { doors: snap.map.doors || {}, destroyed: new Set(snap.map.destroyed || []) };
        this.mapRenderer.syncDynamic(snap.map, snap.serverTime / 1000);
      }
      const me = snap.players.find((p) => p.id === conn.id);
      if (me) {
        this.myHp = me.hp; this.myAlive = me.alive;
        // 2: local player's armor/shield + active power-up for the HUD.
        this.myArmor = (me.armor ?? me.shield ?? 0);
        this.myPowerup = me.activePowerup || me.powerup || null;
        this.myPowerupMs = me.remainingMs ?? me.powerupMs ?? 0;
        this.myPowerupTotal = me.powerupDurMs ?? me.powerupTotalMs ?? 0;
      }
    });
    // world fx (explosions / bounces) — everyone sees them
    conn.on('boom', (e) => { if (e) this.projView.boom(e.kind, e.pos, e.radius); });

    // 1E: server-validated kill medals for the LOCAL player (popups + stings)
    conn.on('accolade', (p) => this.accoladeFeed.push(p));
    conn.on('accolade_summary', (list) => { if (this._summaryOpen) this.accoladeFeed.showSummary(list); });

    conn.on('hit', (h) => {
      if (h.attacker === conn.id && h.victim !== conn.id) {
        // server-confirmed feedback: hitmarker + floating damage at the victim
        const victim = this.interp.remotes.get(h.victim);
        const point = victim?.avatar?.group
          ? victim.avatar.group.position.clone().setY(victim.avatar.group.position.y + 1.1)
          : this.ctx.camera.getWorldPosition(new THREE.Vector3()).add(this.ctx.camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(6));
        this.ctx.events.emit('target:hit', {
          target: null, def: this.ctx.weapons?.current?.def, damage: h.dmg,
          zone: h.part, points: 0, kill: h.killed, point, distance: 0,
        });
        this.audioBank.play(h.killed ? 'kill' : (h.part === 'head' ? 'hitmarker' : 'hitmarker'));
        if (h.part === 'head') this.audioBank.play('kill', { volume: 0.5, rate: 1.4 }); // headshot ding
      }
      if (h.victim === conn.id) {
        // got shot: directional damage indicator toward the attacker + red flash
        const atk = this.interp.remotes.get(h.attacker);
        const from = atk?.avatar?.group ? atk.avatar.group.position : null;
        this.dmgIndicator.hit(from, h.dmg);
        this.ctx.player.camera?.addShake?.(Math.min(0.4, 0.12 + h.dmg / 200));
        this.audioBank.play('hit');
      }
    });

    conn.on('death', (m) => {
      const killer = this._info(m.by), victim = this._info(m.id);
      const suicide = m.by === m.id || m.by === 'world';
      this.killFeed.add({
        killerName: killer.name, killerColor: killer.color,
        victimName: victim.name, victimColor: victim.color,
        weapon: m.weapon, headshot: !!m.headshot, suicide,
      });
      if (m.id === conn.id) {
        this._dead = true;
        this.ctx.input.setSuppressed(true); // no shooting/moving while dead + in the killcam
        const killerRP = (!suicide) ? this.interp.remotes.get(m.by) : null;
        this.killCam.start(killerRP, killer.name, m.respawnInMs || 2500);
      }
    });

    conn.on('respawn', (m) => {
      if (m.id === conn.id) {
        this._dead = false;
        this.ctx.input.setSuppressed(false); // alive again — restore controls
        this.killCam.stop();
        this.pred.setSpawn({ pos: m.pos, yaw: m.yaw });
        this.ctx.player.camera.yaw = m.yaw;
        this._applyLoadout(); // custom maps: re-strip to the starter loadout on respawn
      }
    });

    // 2: the local player picked something up — sound + a brief "PICKED UP X" flash.
    conn.on('pickup', (p) => {
      if (!p) return;
      this.audioBank.play('equip', { volume: 0.9 });
      this._flashPickup(pickupLabel(p));
      // grant the weapon into the wheel + auto-equip it. (Previously a weapon pickup
      // updated the server's weaponId but never switched the local gun.)
      if (p.kind === 'weapon' && p.weapon) { this.ctx.weapons?.grant?.(p.weapon); this.ctx.weapons?.select?.(p.weapon); }
    });

    // 2: the server's custom-map list changed (a map was published/removed) — refresh
    // the browse-maps grid so B shows the new maps. The payload carries the maps
    // (either a bare array or {maps:[…]}); merge the built-ins in if it's customs-only.
    conn.on('maps_updated', (m) => {
      const incoming = (m && Array.isArray(m.maps)) ? m.maps : (Array.isArray(m) ? m : null);
      if (!incoming || !this.mapSelect?.setList) return;
      const builtins = mapList();
      const hasBuiltin = incoming.some((x) => builtins.find((b) => b.id === x.id));
      const list = hasBuiltin ? incoming : builtins.concat(incoming);
      this.mapSelect.setList(list);
    });

    conn.on('lobby_full', () => console.warn('[arena] lobby full'));
  }

  // Local shots: WeaponManager fires locally for feel; we forward a lag-comp
  // shot to the server for authoritative resolution.
  _wireLocalFire() {
    this.ctx.events.on('weapon:fired', (e) => {
      if (!e || !e.origin || !e.dir) return;
      // MELEE swings are sent via sendMelee (weapon:melee below), NOT as a hitscan
      // 'fire' — bail here so a swing doesn't also resolve as a gun shot. §1C.
      if (e.melee) return;
      this.conn.sendFire({
        seq: this.pred.seq,
        // lag comp: we render remotes INTERP_DELAY_MS in the past, so the shot
        // must be resolved against their position at the time we actually saw
        // them — the server rewinds targets to exactly this timestamp.
        fireTime: this.conn.serverNow() - INTERP_DELAY_MS,
        weaponId: this.ctx.weapons?.current?.def?.id || 'ar',
        origin: { x: e.origin.x, y: e.origin.y, z: e.origin.z },
        dir: { x: e.dir.x, y: e.dir.y, z: e.dir.z },
        ads: e.ads || 0,
      });
      // route the fire sound through the real-sample bank (positional not needed for self)
      const cue = { pistol: 'pistol_fire', smg: 'smg_fire', shotgun: 'shotgun_fire', ar: 'rifle_fire', sniper: 'sniper_fire' }[this.ctx.weapons?.current?.def?.id];
      if (cue) this.audioBank.play(cue, { volume: 0.9 });
    });

    // MELEE swings (§1C): forward a lag-comp swing to the server for authoritative
    // resolution (damage + knockback). The local sweep in Weapon._meleeSwing is
    // fx/feedback only in arena. INTERP_DELAY_MS aligns targets to when we saw them.
    this.ctx.events.on('weapon:melee', (e) => {
      if (!e || !e.origin || !e.dir) return;
      const def = this.ctx.weapons?.current?.def;
      this.conn.sendMelee({
        seq: this.pred.seq,
        fireTime: this.conn.serverNow() - INTERP_DELAY_MS,
        weaponId: def?.melee ? def.id : 'knife',
        melee: def?.melee || 'knife',
        heavy: !!e.heavy,
        origin: { x: e.origin.x, y: e.origin.y, z: e.origin.z },
        dir: { x: e.dir.x, y: e.dir.y, z: e.dir.z },
      });
    });
  }

  // G — throw a grenade (server-authoritative; it appears from snapshots).
  _throwGrenade() {
    if (this.ctx.input.uiOpen || this._dead) return;
    const cam = this.ctx.camera;
    const origin = cam.getWorldPosition(new THREE.Vector3());
    const dir = cam.getWorldDirection(this._v).clone();
    this.conn.sendThrow({
      seq: this.pred.seq, fireTime: this.conn.serverNow(),
      origin: { x: origin.x, y: origin.y, z: origin.z }, dir: { x: dir.x, y: dir.y, z: dir.z },
    });
    this.audioBank.play('jump', { volume: 0.4, rate: 0.7 }); // throw grunt-ish
  }

  // --- pickup pickup flash ("PICKED UP X") — a small self-contained HUD line ---
  _buildPickupFlash() {
    if (typeof document === 'undefined') return;
    if (!document.getElementById('arena-pickup-css')) {
      const s = document.createElement('style'); s.id = 'arena-pickup-css';
      s.textContent = `.arena-pickup-flash{position:absolute;left:50%;bottom:26%;transform:translateX(-50%);
        z-index:31;pointer-events:none;font-family:'Segoe UI',system-ui,-apple-system,sans-serif;
        font-size:15px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;
        color:#eaf6ff;text-shadow:0 0 12px rgba(125,249,255,.7),0 1px 3px rgba(0,0,0,.95);
        opacity:0;transition:opacity .18s;}`;
      document.head.appendChild(s);
    }
    const parent = document.getElementById('ui') || document.body;
    this._pickupFlashEl = document.createElement('div');
    this._pickupFlashEl.className = 'arena-pickup-flash';
    parent.appendChild(this._pickupFlashEl);
    this._pickupFlashT = 0;
  }

  _flashPickup(text) {
    if (!this._pickupFlashEl) return;
    this._pickupFlashEl.textContent = 'PICKED UP ' + text;
    this._pickupFlashEl.style.opacity = '1';
    this._pickupFlashT = 1.6;
  }

  _moveAudio(name, data) {
    switch (name) {
      case 'footstep': this._footIdx = (this._footIdx + 1) % 4; this.audioBank.play(FOOTSTEPS[this._footIdx], { volume: 0.5 }); break;
      case 'jump': this.audioBank.play('jump', { volume: 0.7 }); break;
      case 'walljump': this.audioBank.play('jump', { volume: 0.8 }); break;
      case 'land': this.audioBank.play(data?.hard ? 'land_hard' : 'land_soft', { volume: 0.7 }); break;
      case 'slide_start': this.audioBank.play('slide', { volume: 0.6 }); break;
      case 'wallrun_start': this.audioBank.play('wallrun', { volume: 0.6 }); break;
      default: break;
    }
  }

  // local raycast for tracer endpoints + wall/player impact fx ONLY (NOT damage
  // — damage is server-authoritative). Walls are tested analytically against the
  // shared AABB data (avoids raycasting the sky/lights); players via their avatar
  // groups. Returns the nearest of the two.
  _raycastShot(origin, dir, maxDist = 400) {
    let best = null;
    // --- walls (analytic ray-vs-AABB against the current LIVE collider set) ---
    const aabbs = (this.ctx.world.colliders && this.ctx.world.colliders.aabbs) || [];
    for (const b of aabbs) {
      const t = rayAabb(origin, dir, b.min, b.max);
      if (t !== null && t > 0.05 && t < maxDist && (!best || t < best.distance)) {
        const p = origin.clone().addScaledVector(dir, t);
        best = { point: p, normal: aabbNormal(p, b), distance: t, surface: b.wallrun ? 'metal' : 'concrete', target: null, zone: null };
      }
    }
    // --- players (avatar meshes) ---
    const avatars = [];
    for (const rp of this.interp.remotes.values()) if (rp.avatar?.group) avatars.push(rp.avatar.group);
    if (avatars.length) {
      try {
        this._raycaster.set(origin, dir);
        this._raycaster.far = best ? best.distance : maxDist;
        const hits = this._raycaster.intersectObjects(avatars, true);
        if (hits.length && hits[0].distance < (best ? best.distance : maxDist)) {
          const h = hits[0];
          best = { point: h.point, normal: h.face ? h.face.normal.clone() : new THREE.Vector3(0, 1, 0), distance: h.distance, surface: 'target', target: null, zone: null };
        }
      } catch { /* avatar mid-dispose — ignore, walls already covered */ }
    }
    return best;
  }

  // ---- lifecycle (called by main.js) ----
  fixedUpdate(dt) {
    // rebuild the live collision world (doors/destructibles/platforms) so
    // prediction matches the server's map state. Identical inputs → identical move.
    this.pred.world = buildLiveWorld(this.map, this.mapDyn, this.conn.serverNow() / 1000);
    this.pred.fixedStep(dt);
  }

  render(dt, alpha) {
    this.conn.update(dt);
    const tSec = this.conn.serverNow() / 1000;
    const renderTime = this.conn.serverNow() - INTERP_DELAY_MS;
    this.mapRenderer.update(dt, tSec);
    this.interp.update(dt);
    this.projView.update(dt, renderTime);
    this.pickupView.update(dt);
    this.dmgIndicator.update(dt);
    this.killFeed.update(dt);
    this.accoladeFeed.update(dt);
    this.healthBar.set(this.myHp, this.myAlive);
    this.healthBar.setArmor?.(this.myArmor || 0);
    this.healthBar.setPowerup?.(powerupName(this.myPowerup), this.myPowerupMs || 0, this.myPowerupTotal || 0);
    this.healthBar.update(dt);

    // pickup flash fade
    if (this._pickupFlashT > 0) {
      this._pickupFlashT -= dt;
      if (this._pickupFlashT <= 0) { if (this._pickupFlashEl) this._pickupFlashEl.style.opacity = '0'; }
      else if (this._pickupFlashT < 0.5 && this._pickupFlashEl) this._pickupFlashEl.style.opacity = String(this._pickupFlashT / 0.5);
    }

    // kill cam runs AFTER the normal camera update (main.js calls camera.render
    // before this) so it OVERRIDES ctx.camera while active. Only touch viewmodel
    // visibility for the kill cam — the HUD owns scope-hiding, so don't clobber it.
    this.killCam.update(dt);
    const vm = this.ctx.viewmodel?.scene;
    if (vm) {
      if (this.killCam.active) { vm.visible = false; this._killcamHidVM = true; }
      else if (this._killcamHidVM) { this._killcamHidVM = false; vm.visible = !this.ctx.ui?.hud?._scoped; }
    }

    this._statTimer -= dt;
    if (this._statTimer <= 0) {
      this._statTimer = 0.12;
      this.debug.update({
        rtt: Math.round(this.conn.rtt), tick: this.conn.welcome?.tickRate || 60,
        interpMs: this.interp.interpMs, predErr: this.pred.lastPredErr,
        snapsPerSec: Math.round(this.conn.snapsPerSec), inputsPerSec: Math.round(this.conn.inputsPerSec),
        players: this.interp.remotes.size + 1, ping: Math.round(this.conn.rtt / 2),
        backend: this.ctx.backend,
      });
    }
    this.debug.render?.(dt);
  }

  resize(w, h) {
    this.debug?.resize?.(w, h); this.mapRenderer?.resize?.(w, h);
    this.dmgIndicator?.resize?.(w, h); this.killFeed?.resize?.(w, h); this.killCam?.resize?.(w, h);
    this.healthBar?.resize?.(w, h); this.mapSelect?.resize?.(w, h); this.accoladeFeed?.resize?.(w, h);
  }
}

function isDescendant(obj, root) { let p = obj; while (p) { if (p === root) return true; p = p.parent; } return false; }

// short readable label for a 'pickup' grant event (weapon name / powerup / kind).
function pickupLabel(p) {
  if (!p) return 'ITEM';
  if (p.weapon) return String(p.weapon).toUpperCase();
  if (p.powerup) return powerupName(p.powerup);
  const kind = p.kind || p.type;
  if (kind === 'health') return 'HEALTH' + (p.amount ? ' +' + p.amount : '');
  if (kind === 'armor') return 'ARMOR' + (p.amount ? ' +' + p.amount : '');
  if (kind === 'powerup') return powerupName(p.powerup);
  return kind ? String(kind).toUpperCase() : 'ITEM';
}

// resolve a power-up id to its display label (from the shared POWERUPS table).
function powerupName(id) {
  if (!id) return null;
  const def = POWERUPS[id];
  return (def?.label || String(id)).toUpperCase();
}

// nearest positive ray/AABB intersection distance (slab method), or null.
function rayAabb(o, d, min, max) {
  let tmin = 0, tmax = Infinity;
  for (const ax of ['x', 'y', 'z']) {
    const inv = 1 / (d[ax] || 1e-12);
    let t1 = (min[ax] - o[ax]) * inv, t2 = (max[ax] - o[ax]) * inv;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  return tmin > 0 ? tmin : (tmax > 0 ? tmax : null);
}
// outward AABB face normal nearest to point p.
function aabbNormal(p, b) {
  const cx = (b.min.x + b.max.x) / 2, cy = (b.min.y + b.max.y) / 2, cz = (b.min.z + b.max.z) / 2;
  const dx = (p.x - cx) / (b.max.x - b.min.x || 1), dy = (p.y - cy) / (b.max.y - b.min.y || 1), dz = (p.z - cz) / (b.max.z - b.min.z || 1);
  const ax = Math.abs(dx), ay = Math.abs(dy), az = Math.abs(dz);
  if (ax >= ay && ax >= az) return new THREE.Vector3(Math.sign(dx), 0, 0);
  if (ay >= az) return new THREE.Vector3(0, Math.sign(dy), 0);
  return new THREE.Vector3(0, 0, Math.sign(dz));
}
