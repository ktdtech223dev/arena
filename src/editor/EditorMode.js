// RANGE — src/editor/EditorMode.js
// The FIRST-PERSON, fly-around, WYSIWYG custom-map EDITOR (Phase 2A/2B/2C/2D/2F).
//
// Self-contained: it reuses ctx.renderer/scene/camera from main.js but owns its
// own INPUT (keyboard + mouse + pointer-lock), its own DOM UI (EditorUI), its own
// SKY/LIGHTING rig (EditorSky), and its own render. It builds NO game module.
//
// The DATA MODEL (this.map — a custom-map object of blocks/lights/objects) is the
// single source of truth. Every visual is a SEPARATE selectable Object3D kept in
// parallel maps keyed by a per-record uid, rebuilt/patched on change (not merged —
// this is the editor). buildBlockMesh keeps blocks WYSIWYG with play.
//
// MODES: PLACE (default) — a ghost of the active palette item follows the raycast
// and left-click drops it; TAB toggles EDIT — click to select, then move/rotate/
// scale/duplicate/delete a placed thing. Ctrl+Z / Ctrl+Y walk a snapshot history.
import * as THREE from 'three/webgpu';
import {
  BLOCK_TYPES, LIGHT_KINDS, OBJECT_KINDS, MAX_CUSTOM_LIGHTS,
  SKYBOX_PRESETS, POWERUPS, SPAWN_WEAPONS,
  newCustomMap, validateCustomMap, CUSTOM_LIMITS,
} from '../../shared/custommap.js';
import { EditorSky } from './EditorSky.js';
import { EditorUI } from './EditorUI.js';
import {
  makeBlockMesh, makeAabbHelper, makeObjectMesh, objectSelectBox,
  makeLightRig, lightSelectBox,
} from './EditorMeshes.js';

const DRAFT_KEY = 'range.editor.draft.v1';
const AUTHOR_KEY = 'range.editor.author';
const HISTORY_MAX = 40;
const RAD = Math.PI / 180;

let __uid = 1;
const uid = () => 'e' + (__uid++);

export class EditorMode {
  constructor(ctx) {
    this.ctx = ctx;
    this.THREE = THREE;
    this.scene = ctx.scene;
    this.camera = ctx.camera;
    this.renderer = ctx.renderer;
    this.canvas = ctx.canvas;

    // ---- data model (source of truth) --------------------------------------
    // author = the N GAMES profile name (falls back to the legacy editor key) so
    // "who made which map" tracks the profile shown in the multiplayer hub.
    let profName = null;
    try { profName = JSON.parse(localStorage.getItem('ngames.profile.v1'))?.name; } catch { /* fresh */ }
    this.author = profName || localStorage.getItem(AUTHOR_KEY) || 'anon';
    this.map = newCustomMap('Untitled', this.author, Date.now());
    this._ensureUids();

    // parallel mesh registries: uid -> { rec, mesh, outline? }
    this.blockMeshes = new Map();
    this.objectMeshes = new Map();
    this.lightMeshes = new Map();
    this.materialCache = new Map(); // shared cache passed to buildBlockMesh

    // ---- fly camera state --------------------------------------------------
    this.yaw = 0; this.pitch = -0.15;
    this.camPos = new THREE.Vector3(0, 6, 14);
    this.moveSpeed = 12; this.boostMult = 3;
    this.keys = new Set();
    this.pointerLocked = false;

    // ---- editing state -----------------------------------------------------
    this.editMode = false;        // false = PLACE, true = EDIT
    this.snap = true;
    this.gridSize = 1.0;
    this.ghostYaw = 0;            // ghost rotation (degrees, place mode)
    this.active = { group: 'structural', kind: 'block', id: 'cube' }; // palette selection
    this.hovered = null;          // { type, uid }
    this.selected = null;         // { type, uid }
    this.ghost = null;            // ghost preview mesh
    this.hoverOutline = null;
    this.selectOutline = null;

    // ---- undo/redo ---------------------------------------------------------
    this._history = [];
    this._future = [];
    this._suppressAutosave = false;

    // ---- raycast scratch ---------------------------------------------------
    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = 400;
    this._ndc = new THREE.Vector2(0, 0); // center of screen (crosshair)
    this._fwd = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
    this._tmp = new THREE.Vector3();
    this._groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    // ---- sky + grid --------------------------------------------------------
    this.sky = new EditorSky(THREE, this.scene);
    this.sky.setPreset(this.map.skybox);
    this._buildGrid();

    // ---- build the initial scene from the model ----------------------------
    this._rebuildAll();

    // ---- UI ----------------------------------------------------------------
    this.ui = new EditorUI(this);

    // ---- input -------------------------------------------------------------
    this._bindInput();

    // ---- autosave / restore ------------------------------------------------
    this._offerRestore();
    this._autosaveTimer = setInterval(() => this._autosave(), 4000);

    // camera starts looking at the origin-ish
    this._applyCamera();
    this.ui.refreshAll();
    // seed the quick-select hotbar with the default block
    this.hotbar = [];
    this._toHotbar(this.active.kind, this.active.id);
    this.ui.setLocked(false); // start with the build menu visible (panels shown)
  }

  // =========================================================================
  //  DATA-MODEL HELPERS
  // =========================================================================
  _ensureUids() {
    for (const b of this.map.blocks) if (!b.__uid) b.__uid = uid();
    for (const o of this.map.objects) if (!o.__uid) o.__uid = uid();
    for (const l of this.map.lights) if (!l.__uid) l.__uid = uid();
  }

  lightCount() { return this.map.lights.length; }
  blockCount() { return this.map.blocks.length; }
  atLightCap() { return this.lightCount() >= MAX_CUSTOM_LIGHTS; }

  // find the record + its array for a {type,uid}
  _recOf(ref) {
    if (!ref) return null;
    const arr = ref.type === 'block' ? this.map.blocks : ref.type === 'object' ? this.map.objects : this.map.lights;
    return arr.find((r) => r.__uid === ref.uid) || null;
  }

  // =========================================================================
  //  SCENE (re)BUILD
  // =========================================================================
  _rebuildAll() {
    // dispose existing
    for (const m of this.blockMeshes.values()) this._removeObj(m.mesh);
    for (const m of this.objectMeshes.values()) this._removeObj(m.mesh);
    for (const m of this.lightMeshes.values()) this._removeObj(m.mesh);
    this.blockMeshes.clear(); this.objectMeshes.clear(); this.lightMeshes.clear();
    for (const b of this.map.blocks) this._addBlockMesh(b);
    for (const o of this.map.objects) this._addObjectMesh(o);
    for (const l of this.map.lights) this._addLightMesh(l);
  }

  _addBlockMesh(rec) {
    const mesh = makeBlockMesh(THREE, rec, this.materialCache);
    mesh.userData.__ref = { type: 'block', uid: rec.__uid };
    mesh.traverse?.((c) => { c.userData.__ref = { type: 'block', uid: rec.__uid }; });
    this.scene.add(mesh);
    this.blockMeshes.set(rec.__uid, { rec, mesh });
    return mesh;
  }
  _addObjectMesh(rec) {
    const mesh = makeObjectMesh(THREE, rec);
    mesh.userData.__ref = { type: 'object', uid: rec.__uid };
    mesh.traverse?.((c) => { c.userData.__ref = { type: 'object', uid: rec.__uid }; });
    this.scene.add(mesh);
    this.objectMeshes.set(rec.__uid, { rec, mesh });
    return mesh;
  }
  _addLightMesh(rec) {
    const mesh = makeLightRig(THREE, rec);
    mesh.userData.__ref = { type: 'light', uid: rec.__uid };
    mesh.traverse?.((c) => { if (!c.isLight) c.userData.__ref = { type: 'light', uid: rec.__uid }; });
    this.scene.add(mesh);
    this.lightMeshes.set(rec.__uid, { rec, mesh });
    return mesh;
  }

  // patch an existing mesh after its record changed (rebuild it in place)
  _patchMesh(ref) {
    const reg = this._regFor(ref.type);
    const entry = reg.get(ref.uid);
    if (!entry) return;
    this._removeObj(entry.mesh);
    reg.delete(ref.uid);
    if (ref.type === 'block') this._addBlockMesh(entry.rec);
    else if (ref.type === 'object') this._addObjectMesh(entry.rec);
    else this._addLightMesh(entry.rec);
    // refresh outlines that pointed at it
    if (this.selected && this.selected.uid === ref.uid) this._updateSelectOutline();
  }

  _regFor(type) { return type === 'block' ? this.blockMeshes : type === 'object' ? this.objectMeshes : this.lightMeshes; }

  _removeObj(obj) {
    if (!obj) return;
    this.scene.remove(obj);
    obj.traverse?.((c) => {
      if (c.geometry) c.geometry.dispose?.();
      if (c.material) { const mm = Array.isArray(c.material) ? c.material : [c.material]; for (const m of mm) m.dispose?.(); }
    });
  }

  // =========================================================================
  //  GRID
  // =========================================================================
  _buildGrid() {
    this.grid = new THREE.GridHelper(80, 80, 0x2a3a44, 0x16222a);
    this.grid.position.y = 0;
    this.grid.material.transparent = true;
    this.grid.material.opacity = 0.5;
    this.scene.add(this.grid);
  }

  // =========================================================================
  //  INPUT
  // =========================================================================
  _bindInput() {
    this._onKeyDown = (e) => this._handleKeyDown(e);
    this._onKeyUp = (e) => this.keys.delete(e.code);
    this._onMouseMove = (e) => this._handleMouseMove(e);
    this._onMouseDown = (e) => this._handleMouseDown(e);
    this._onContext = (e) => e.preventDefault();
    this._onWheel = (e) => this._handleWheel(e);
    this._onPointerLockChange = () => {
      this.pointerLocked = (document.pointerLockElement === this.canvas);
      this.ui.setLocked(this.pointerLocked);
    };
    // Browsers reject requestPointerLock for ~1s after an Esc unlock ("too soon"),
    // and require a fresh gesture. Surface a hint so the user just clicks again.
    this._onPointerLockError = () => { try { this.ui.toast?.('Click to look around'); } catch { /* optional */ } };

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('mousedown', this._onMouseDown);
    document.addEventListener('pointerlockchange', this._onPointerLockChange);
    document.addEventListener('pointerlockerror', this._onPointerLockError);
    this.canvas.addEventListener('contextmenu', this._onContext);
    this.canvas.addEventListener('wheel', this._onWheel, { passive: true });
  }

  _requestLock() {
    try { this.canvas.requestPointerLock?.(); } catch { /* ignore */ }
    // go full-screen for a proper first-person build view (best-effort; the click
    // that locks is a valid gesture). No-op if already fullscreen.
    try { if (!document.fullscreenElement) document.documentElement.requestFullscreen?.(); } catch { /* ignore */ }
  }
  exitLock() { try { document.exitPointerLock?.(); } catch { /* ignore */ } }

  _typingInField(e) {
    const t = e.target;
    return t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  }

  _handleKeyDown(e) {
    if (this._typingInField(e)) return; // let UI fields work
    const ctrl = e.ctrlKey || e.metaKey;

    // undo / redo
    if (ctrl && e.code === 'KeyZ' && !e.shiftKey) { e.preventDefault(); this.undo(); return; }
    if (ctrl && (e.code === 'KeyY' || (e.code === 'KeyZ' && e.shiftKey))) { e.preventDefault(); this.redo(); return; }
    if (ctrl && e.code === 'KeyD') { e.preventDefault(); this.duplicateSelected(); return; }
    if (ctrl && e.code === 'KeyS') { e.preventDefault(); this.ui.doSave(); return; }

    this.keys.add(e.code);

    switch (e.code) {
      case 'KeyB': this.toggleBuildMenu(); break;   // open/close the build menu (Minecraft-style)
      case 'Digit1': case 'Digit2': case 'Digit3': case 'Digit4': case 'Digit5':
      case 'Digit6': case 'Digit7': case 'Digit8': case 'Digit9':
        this.selectHotbar(+e.code.slice(5) - 1); break;   // hotbar quick-select
      case 'Tab': e.preventDefault(); this.toggleEditMode(); break;
      case 'KeyG': this.setSnap(!this.snap); break;
      case 'BracketLeft': this.setGrid(Math.max(0.1, +(this.gridSize / 2).toFixed(3))); break;
      case 'BracketRight': this.setGrid(Math.min(8, +(this.gridSize * 2).toFixed(3))); break;
      case 'KeyR':
        if (this.editMode && this.selected) this._rotateSelected(e.shiftKey ? -1 : 1);
        else this.ghostYaw = (this.ghostYaw + (e.shiftKey ? -15 : 15) + 360) % 360;
        break;
      case 'Delete':
      case 'Backspace':
        if (this.editMode && this.selected) this.deleteSelected();
        else if (this.hovered) this.deleteRef(this.hovered);
        break;
      case 'Escape':
        if (this.selected) this.select(null);
        else this.exitLock();
        break;
      case 'Equal': case 'NumpadAdd': if (this.selected) this._scaleSelected(1.15); break;
      case 'Minus': case 'NumpadSubtract': if (this.selected) this._scaleSelected(1 / 1.15); break;
      default: break;
    }

    // arrow-ish nudge for the selected object (edit mode)
    if (this.editMode && this.selected) this._nudgeKey(e.code);
  }

  _nudgeKey(code) {
    const step = this.snap ? this.gridSize : 0.5;
    const map = {
      ArrowLeft: [-step, 0, 0], ArrowRight: [step, 0, 0],
      ArrowUp: [0, 0, -step], ArrowDown: [0, 0, step],
      PageUp: [0, step, 0], PageDown: [0, -step, 0],
    };
    const d = map[code];
    if (!d) return;
    const rec = this._recOf(this.selected);
    if (!rec) return;
    this._pushHistory();
    rec.x = +( (rec.x || 0) + d[0]).toFixed(4);
    rec.y = +( (rec.y || 0) + d[1]).toFixed(4);
    rec.z = +( (rec.z || 0) + d[2]).toFixed(4);
    this._patchMesh(this.selected);
    this.ui.refreshProperties();
    this._autosave();
  }

  _handleWheel(e) {
    // wheel changes ghost distance is unnecessary; use it to cycle palette lightly
    // (kept simple: no-op to avoid surprising zoom); left for future.
  }

  _handleMouseMove(e) {
    if (!this.pointerLocked) return;
    const sens = 0.0022;
    // yaw: mouse-right must turn the view RIGHT. With _fwd = (sin(yaw)·cp, sp,
    // -cos(yaw)·cp), looking right means yaw INCREASES → add movementX (was negated,
    // which inverted horizontal look). Pitch stays standard (mouse-down looks down).
    this.yaw += e.movementX * sens;
    this.pitch -= e.movementY * sens;
    const lim = Math.PI / 2 - 0.02;
    this.pitch = Math.max(-lim, Math.min(lim, this.pitch));
  }

  _handleMouseDown(e) {
    if (this.ui.anyModalOpen()) return;
    // NOT locked yet → a click anywhere in the play area (i.e. NOT on an interactive
    // editor panel) GRABS the mouse so you can look around. This is robust: it fires
    // on the window mousedown and doesn't depend on the click reaching the canvas
    // element (the full-screen UI overlay used to swallow those clicks).
    if (!this.pointerLocked) {
      // Only a click that lands on the CANVAS (the play area) grabs the mouse. The
      // full-screen overlay is pointer-events:none so play-area clicks pass through
      // to the canvas, while EVERY interactive UI element (palette, hotbar, toolbar,
      // properties…) is its own target → never re-locks while you're picking a block.
      if (e.button === 0 && e.target === this.canvas) this._requestLock();
      return;
    }
    if (e.button === 0) {
      // left click: place (place mode) or select (edit mode)
      if (this.editMode) this._selectUnderCrosshair();
      else this.placeActive();
    } else if (e.button === 2) {
      // right click: delete hovered
      if (this.hovered) this.deleteRef(this.hovered);
    }
  }

  // Is the click target inside an interactive editor UI panel (vs the play area)?
  _overUiPanel(t) {
    return !!(t && t.closest && t.closest('.ed-top, .ed-pal, .ed-props, .ed-scrim, .ed-help, .ed-toasts'));
  }

  // =========================================================================
  //  CAMERA
  // =========================================================================
  _applyCamera() {
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    this._fwd.set(sy * cp, sp, -cy * cp).normalize();
    this._right.set(cy, 0, sy).normalize();
    this.camera.position.copy(this.camPos);
    this._tmp.copy(this.camPos).add(this._fwd);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this._tmp);
  }

  _flyStep(dt) {
    let speed = this.moveSpeed * (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? this.boostMult : 1);
    const move = this._tmp.set(0, 0, 0);
    // planar forward (WASD moves on the look plane)
    const f = this._fwd; const r = this._right;
    if (this.keys.has('KeyW')) move.addScaledVector(f, 1);
    if (this.keys.has('KeyS')) move.addScaledVector(f, -1);
    if (this.keys.has('KeyD')) move.addScaledVector(r, 1);
    if (this.keys.has('KeyA')) move.addScaledVector(r, -1);
    if (this.keys.has('Space') || this.keys.has('KeyE')) move.y += 1;
    if (this.keys.has('ControlLeft') || this.keys.has('ControlRight') || this.keys.has('KeyQ')) move.y -= 1;
    if (move.lengthSq() > 0) { move.normalize().multiplyScalar(speed * dt); this.camPos.add(move); }
  }

  // =========================================================================
  //  RAYCAST — hit a placed object's face → adjacent, or the ground grid.
  // =========================================================================
  _raycastScene() {
    this.raycaster.setFromCamera(this._ndc, this.camera);
    // gather block meshes (real geometry) for face-adjacent placement + selection
    const targets = [];
    for (const { mesh } of this.blockMeshes.values()) targets.push(mesh);
    for (const { mesh } of this.objectMeshes.values()) targets.push(mesh);
    for (const { mesh } of this.lightMeshes.values()) targets.push(mesh);
    const hits = this.raycaster.intersectObjects(targets, true);
    for (const h of hits) {
      let o = h.object;
      while (o && !o.userData.__ref) o = o.parent;
      if (o && o.userData.__ref) return { ref: o.userData.__ref, point: h.point, normal: h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : null };
    }
    // fallback: ground plane
    const p = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(this._groundPlane, p)) return { ref: null, point: p, normal: new THREE.Vector3(0, 1, 0) };
    return null;
  }

  _snapVal(v) { return this.snap ? Math.round(v / this.gridSize) * this.gridSize : v; }

  // ghost/placement position from the current raycast
  _placementPos() {
    const hit = this._raycastScene();
    if (!hit) {
      // place a fixed distance ahead if nothing hit
      const p = this._tmp.copy(this.camPos).addScaledVector(this._fwd, 8);
      return { x: this._snapVal(p.x), y: this._snapVal(p.y), z: this._snapVal(p.z), hit: null };
    }
    const p = hit.point.clone();
    // if we hit a block face, offset outward by half the ghost size along the normal
    if (hit.ref && hit.ref.type === 'block' && hit.normal) {
      const half = this._activeHalfExtents();
      const n = hit.normal;
      p.x += n.x * half[0]; p.y += n.y * half[1]; p.z += n.z * half[2];
    } else if (!hit.ref) {
      // ground: lift by half height so the block sits on the floor
      const half = this._activeHalfExtents();
      p.y += half[1];
    }
    return { x: this._snapVal(p.x), y: this._snapVal(p.y), z: this._snapVal(p.z), hit };
  }

  _activeHalfExtents() {
    if (this.active.kind === 'block') {
      const def = BLOCK_TYPES[this.active.id];
      return [def.size[0] / 2, def.size[1] / 2, def.size[2] / 2];
    }
    return [0.7, 0.8, 0.7];
  }

  // =========================================================================
  //  GHOST (place preview)
  // =========================================================================
  _updateGhost() {
    if (this.editMode) { this._hideGhost(); return; }
    const pos = this._placementPos();
    // (re)build the ghost when the active item changes
    if (!this.ghost || this.ghost.userData.__key !== this._ghostKey()) {
      this._hideGhost();
      this.ghost = this._buildGhost();
      if (this.ghost) { this.ghost.userData.__key = this._ghostKey(); this.scene.add(this.ghost); }
    }
    if (this.ghost) {
      this.ghost.position.set(pos.x, pos.y, pos.z);
      this.ghost.rotation.y = this.active.kind === 'block' ? this.ghostYaw * RAD : 0;
      const blocked = this.active.kind === 'light' && this.atLightCap();
      this.ghost.traverse((c) => { if (c.material) { c.material.color?.set?.(blocked ? 0xff5b5b : 0x7df9ff); } });
    }
    this._pendingPlacePos = pos;
  }

  _ghostKey() { return this.active.kind + ':' + this.active.id; }

  _buildGhost() {
    let src;
    if (this.active.kind === 'block') src = this._recFromPalette();
    else if (this.active.kind === 'object') src = { kind: this.active.id, x: 0, y: 0, z: 0 };
    else src = { kind: this.active.id, x: 0, y: 0, z: 0 };
    let g;
    if (this.active.kind === 'block') {
      const def = BLOCK_TYPES[this.active.id];
      const s = def.size;
      const geo = new THREE.BoxGeometry(s[0], s[1], s[2]);
      const edges = new THREE.EdgesGeometry(geo);
      g = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x7df9ff, transparent: true, opacity: 0.9, depthTest: false }));
      g.renderOrder = 998;
      geo.dispose();
    } else {
      const geo = new THREE.BoxGeometry(1.2, 1.4, 1.2);
      const edges = new THREE.EdgesGeometry(geo);
      g = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x7df9ff, transparent: true, opacity: 0.9, depthTest: false }));
      g.renderOrder = 998;
      g.position.y = 0.7;
      geo.dispose();
    }
    return g;
  }

  _hideGhost() { if (this.ghost) { this._removeObj(this.ghost); this.ghost = null; } }

  // =========================================================================
  //  PALETTE SELECTION
  // =========================================================================
  setActive(kind, id) {
    // kind: 'block' | 'object' | 'light'
    this.active = { kind, id, group: kind };
    this.ghostYaw = 0;
    this._hideGhost();
    this.ui.refreshPalette();
    this._toHotbar(kind, id);
  }

  // ---- Minecraft-style quick-select hotbar (1-9) ----
  _hotbarLabel(kind, id) {
    if (kind === 'block') return (BLOCK_TYPES[id] && BLOCK_TYPES[id].label) || id;
    if (kind === 'object') return (OBJECT_KINDS[id] && OBJECT_KINDS[id].label) || id;
    if (kind === 'light') return (LIGHT_KINDS[id] && LIGHT_KINDS[id].label) || id;
    return id;
  }
  _toHotbar(kind, id) {
    if (!this.hotbar) this.hotbar = [];
    const key = kind + ':' + id;
    const existing = this.hotbar.findIndex((s) => s && (s.kind + ':' + s.id) === key);
    if (existing >= 0) this.hotbar.splice(existing, 1);        // move to front
    this.hotbar.unshift({ kind, id, label: this._hotbarLabel(kind, id) });
    if (this.hotbar.length > 9) this.hotbar.length = 9;
    this.ui.renderHotbar(this.hotbar, this.active.kind + ':' + this.active.id);
  }
  selectHotbar(i) {
    const s = this.hotbar && this.hotbar[i];
    if (s) this.setActive(s.kind, s.id);
  }
  // B / Esc toggle the BUILD MENU: locked (first-person build) ↔ unlocked (menu open).
  toggleBuildMenu() {
    if (this.ui.anyModalOpen()) return;
    if (this.pointerLocked) this.exitLock();   // open the menu (cursor freed → panels show)
    else this._requestLock();                  // close the menu (back to first-person build)
  }

  _recFromPalette() {
    const def = BLOCK_TYPES[this.active.id];
    return {
      type: this.active.id, x: 0, y: 0, z: 0,
      sx: def.size[0], sy: def.size[1], sz: def.size[2], ry: 0,
      color: def.color,
      ...(def.wallrun ? { wallrun: true } : {}),
      ...(def.emissive != null ? { emissive: def.emissive } : {}),
    };
  }

  // =========================================================================
  //  PLACE
  // =========================================================================
  placeActive() {
    const pos = this._pendingPlacePos || this._placementPos();
    if (this.active.kind === 'block') this._placeBlock(pos);
    else if (this.active.kind === 'object') this._placeObject(pos);
    else this._placeLight(pos);
  }

  _placeBlock(pos) {
    if (this.blockCount() >= CUSTOM_LIMITS.maxBlocks) { this.ui.toast(`Block limit reached (${CUSTOM_LIMITS.maxBlocks})`, 'err'); return; }
    this._pushHistory();
    const def = BLOCK_TYPES[this.active.id];
    const rec = {
      __uid: uid(), type: this.active.id,
      x: pos.x, y: pos.y, z: pos.z,
      sx: def.size[0], sy: def.size[1], sz: def.size[2],
      ry: this.ghostYaw * RAD,
      color: def.color,
      ...(def.wallrun ? { wallrun: true } : {}),
      ...(def.emissive != null ? { emissive: def.emissive } : {}),
    };
    this.map.blocks.push(rec);
    this._addBlockMesh(rec);
    this.ui.refreshCounts();
    this._autosave();
  }

  _placeObject(pos) {
    if (this.map.objects.length >= CUSTOM_LIMITS.maxObjects) { this.ui.toast('Object limit reached', 'err'); return; }
    this._pushHistory();
    const kind = this.active.id;
    const def = OBJECT_KINDS[kind];
    const rec = { __uid: uid(), kind, x: pos.x, y: pos.y, z: pos.z };
    if (kind === 'spawn') { rec.yaw = 0; }
    else if (kind === 'weapon') { rec.weapon = SPAWN_WEAPONS[0]; rec.respawnMs = def.respawnMs; }
    else if (kind === 'ammo') { rec.respawnMs = def.respawnMs; }
    else if (kind === 'health' || kind === 'armor') { rec.amount = def.amount; rec.respawnMs = def.respawnMs; }
    else if (kind === 'powerup') { rec.powerup = 'speed'; rec.respawnMs = def.respawnMs; }
    this.map.objects.push(rec);
    this._addObjectMesh(rec);
    this.ui.refreshCounts();
    this._autosave();
  }

  _placeLight(pos) {
    if (this.atLightCap()) { this.ui.toast(`Light cap reached (${MAX_CUSTOM_LIGHTS} max)`, 'err'); return; }
    this._pushHistory();
    // the palette id may be a PRESET (torch/ember/cool/neon/flood) that resolves to
    // a base point|spot with a default color/intensity/dist.
    const pdef = LIGHT_KINDS[this.active.id] || LIGHT_KINDS.point;
    const kind = pdef.base || (this.active.id === 'spot' ? 'spot' : 'point');
    const rec = { __uid: uid(), kind, x: pos.x, y: pos.y, z: pos.z, color: pdef.color ?? 0xffffff, intensity: pdef.intensity, dist: pdef.dist };
    this.map.lights.push(rec);
    this._addLightMesh(rec);
    this.ui.refreshCounts();
    this._autosave();
  }

  // =========================================================================
  //  DELETE
  // =========================================================================
  deleteRef(ref) {
    if (!ref) return;
    const arr = ref.type === 'block' ? this.map.blocks : ref.type === 'object' ? this.map.objects : this.map.lights;
    const idx = arr.findIndex((r) => r.__uid === ref.uid);
    if (idx < 0) return;
    this._pushHistory();
    arr.splice(idx, 1);
    const reg = this._regFor(ref.type);
    const entry = reg.get(ref.uid);
    if (entry) { this._removeObj(entry.mesh); reg.delete(ref.uid); }
    if (this.selected && this.selected.uid === ref.uid) this.select(null);
    if (this.hovered && this.hovered.uid === ref.uid) this.hovered = null;
    this.ui.refreshCounts();
    this._autosave();
  }
  deleteSelected() { if (this.selected) this.deleteRef(this.selected); }

  // =========================================================================
  //  SELECT / EDIT
  // =========================================================================
  toggleEditMode() {
    this.editMode = !this.editMode;
    if (!this.editMode) this.select(null);
    this._hideGhost();
    this.ui.setMode(this.editMode ? 'EDIT' : 'PLACE');
  }

  _selectUnderCrosshair() {
    const hit = this._raycastScene();
    if (hit && hit.ref) this.select(hit.ref);
    else this.select(null);
  }

  select(ref) {
    this.selected = ref;
    this._updateSelectOutline();
    this.ui.refreshProperties();
  }

  _updateSelectOutline() {
    if (this.selectOutline) { this._removeObj(this.selectOutline); this.selectOutline = null; }
    if (!this.selected) return;
    const rec = this._recOf(this.selected);
    if (!rec) return;
    let ol;
    if (this.selected.type === 'block') ol = makeAabbHelper(THREE, rec);
    else if (this.selected.type === 'object') ol = objectSelectBox(THREE, rec);
    else ol = lightSelectBox(THREE, rec);
    if (ol) { ol.traverse?.((c) => { if (c.material) c.material.color?.set?.(0xffd166); }); this.scene.add(ol); this.selectOutline = ol; }
  }

  _rotateSelected(dir) {
    const rec = this._recOf(this.selected);
    if (!rec) return;
    this._pushHistory();
    const stepDeg = 15 * dir;
    if (this.selected.type === 'block') rec.ry = ((((rec.ry || 0) / RAD) + stepDeg) % 360) * RAD;
    else if (this.selected.type === 'object' && rec.kind === 'spawn') rec.yaw = (((rec.yaw || 0) + stepDeg) % 360 + 360) % 360;
    this._patchMesh(this.selected);
    this.ui.refreshProperties();
    this._autosave();
  }

  _scaleSelected(mult) {
    const rec = this._recOf(this.selected);
    if (!rec || this.selected.type !== 'block') return;
    this._pushHistory();
    rec.sx = +Math.max(0.1, (rec.sx || 1) * mult).toFixed(3);
    rec.sy = +Math.max(0.1, (rec.sy || 1) * mult).toFixed(3);
    rec.sz = +Math.max(0.1, (rec.sz || 1) * mult).toFixed(3);
    this._patchMesh(this.selected);
    this.ui.refreshProperties();
    this._autosave();
  }

  duplicateSelected() {
    const rec = this._recOf(this.selected);
    if (!rec) return;
    if (this.selected.type === 'light' && this.atLightCap()) { this.ui.toast(`Light cap reached (${MAX_CUSTOM_LIGHTS} max)`, 'err'); return; }
    if (this.selected.type === 'block' && this.blockCount() >= CUSTOM_LIMITS.maxBlocks) { this.ui.toast('Block limit reached', 'err'); return; }
    this._pushHistory();
    const copy = JSON.parse(JSON.stringify(rec));
    copy.__uid = uid();
    const off = this.snap ? this.gridSize : 1;
    copy.x = (copy.x || 0) + off; copy.z = (copy.z || 0) + off;
    const arr = this.selected.type === 'block' ? this.map.blocks : this.selected.type === 'object' ? this.map.objects : this.map.lights;
    arr.push(copy);
    if (this.selected.type === 'block') this._addBlockMesh(copy);
    else if (this.selected.type === 'object') this._addObjectMesh(copy);
    else this._addLightMesh(copy);
    this.select({ type: this.selected.type, uid: copy.__uid });
    this.ui.refreshCounts();
    this._autosave();
  }

  // Apply a property edit from the UI to the selected record + patch its mesh.
  applyProp(key, value) {
    const rec = this._recOf(this.selected);
    if (!rec) return;
    this._pushHistory();
    rec[key] = value;
    this._patchMesh(this.selected);
    this.ui.refreshCounts();
    this._autosave();
  }

  // =========================================================================
  //  UNDO / REDO  (snapshot the data model)
  // =========================================================================
  _snapshot() {
    return JSON.stringify({ blocks: this.map.blocks, objects: this.map.objects, lights: this.map.lights, skybox: this.map.skybox, name: this.map.name });
  }
  _pushHistory() {
    this._history.push(this._snapshot());
    if (this._history.length > HISTORY_MAX) this._history.shift();
    this._future.length = 0;
    this.ui.refreshUndo();
  }
  _restoreSnapshot(json) {
    const s = JSON.parse(json);
    this.map.blocks = s.blocks; this.map.objects = s.objects; this.map.lights = s.lights;
    this.map.skybox = s.skybox; this.map.name = s.name;
    this._ensureUids();
    if (this.sky.presetName() !== this.map.skybox) this.sky.setPreset(this.map.skybox);
    this._rebuildAll();
    this.select(null);
    this.ui.refreshAll();
  }
  undo() {
    if (!this._history.length) return;
    this._future.push(this._snapshot());
    this._restoreSnapshot(this._history.pop());
    this.ui.refreshUndo();
    this._autosave();
  }
  redo() {
    if (!this._future.length) return;
    this._history.push(this._snapshot());
    this._restoreSnapshot(this._future.pop());
    this.ui.refreshUndo();
    this._autosave();
  }
  canUndo() { return this._history.length > 0; }
  canRedo() { return this._future.length > 0; }

  // =========================================================================
  //  SETTINGS (snap / grid / skybox / name)
  // =========================================================================
  setSnap(on) { this.snap = !!on; this.ui.refreshToolbar(); }
  setGrid(v) { this.gridSize = Math.max(0.1, Math.min(8, v)); this.ui.refreshToolbar(); }
  setSkybox(name) {
    if (!SKYBOX_PRESETS[name]) return;
    this.map.skybox = name;
    this.sky.setPreset(name);
    this.ui.refreshToolbar();
    this._autosave();
  }
  setName(name) { this.map.name = name || 'Untitled'; this._autosave(); }

  // =========================================================================
  //  NEW / SAVE / LOAD  +  AUTOSAVE
  // =========================================================================
  newMap() {
    this.map = newCustomMap('Untitled', this.author, Date.now());
    this._ensureUids();
    this._history.length = 0; this._future.length = 0;
    this.sky.setPreset(this.map.skybox);
    this._rebuildAll();
    this.select(null);
    this.ui.refreshAll();
    this._autosave();
  }

  // Build the clean custom-map object (strip editor uids) for save/validate.
  buildCustom() {
    const strip = (r) => { const c = { ...r }; delete c.__uid; return c; };
    return {
      id: this.map.id, name: this.map.name, author: this.author,
      created: this.map.created || Date.now(), version: 1, custom: true,
      skybox: this.map.skybox,
      blocks: this.map.blocks.map(strip),
      lights: this.map.lights.map(strip),
      objects: this.map.objects.map(strip),
    };
  }

  validate() { return validateCustomMap(this.buildCustom()); }

  async save() {
    const custom = this.buildCustom();
    const result = validateCustomMap(custom);
    if (!result.ok) return { ok: false, errors: result.errors, warnings: result.warnings };
    try {
      const res = await fetch('/api/maps', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(custom),
      });
      // The persistence API returns JSON: 200 {ok,id,warnings} or 400 {errors}.
      // A 400 with an errors[] body is a REAL validation rejection → surface it.
      // Any other non-OK (404 route missing / 5xx / HTML) means the API isn't
      // really there → degrade to a local save rather than lose the user's work.
      const ct = res.headers.get('content-type') || '';
      const data = ct.includes('application/json') ? await res.json().catch(() => null) : null;
      if (res.status === 400 && data && Array.isArray(data.errors)) {
        return { ok: false, errors: data.errors, warnings: result.warnings };
      }
      if (!res.ok || !data) {
        this._saveLocalNamed(custom);
        return { ok: true, id: custom.id, offline: true, warnings: [...(result.warnings || []), 'server unavailable — saved locally only'] };
      }
      if (data.id) { this.map.id = data.id; }
      return { ok: true, id: data.id, warnings: [...(result.warnings || []), ...(data.warnings || [])] };
    } catch (err) {
      // offline / network failure — degrade to a local save
      this._saveLocalNamed(custom);
      return { ok: true, id: custom.id, offline: true, warnings: [...(result.warnings || []), 'server unreachable — saved locally only'] };
    }
  }

  _saveLocalNamed(custom) {
    try {
      const key = 'range.editor.saved.' + custom.id;
      localStorage.setItem(key, JSON.stringify(custom));
    } catch { /* quota */ }
  }

  async listMaps() {
    // server list, then merge any local-only saves
    let list = [];
    try {
      const res = await fetch('/api/maps');
      if (res.ok) list = await res.json();
    } catch { /* offline */ }
    // local saves
    const local = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('range.editor.saved.')) {
        try { const c = JSON.parse(localStorage.getItem(k)); local.push({ id: c.id, name: c.name, author: c.author, created: c.created, __local: true }); } catch { /* skip */ }
      }
    }
    // de-dupe by id (prefer server)
    const seen = new Set(list.map((m) => m.id));
    for (const l of local) if (!seen.has(l.id)) list.push(l);
    return list;
  }

  async loadMap(id, isLocal) {
    let custom = null;
    if (!isLocal) {
      try { const res = await fetch('/api/maps/' + encodeURIComponent(id)); if (res.ok) custom = await res.json(); } catch { /* offline */ }
    }
    if (!custom) {
      try { const raw = localStorage.getItem('range.editor.saved.' + id); if (raw) custom = JSON.parse(raw); } catch { /* skip */ }
    }
    if (!custom) return false;
    this._loadCustom(custom);
    return true;
  }

  async deleteMap(id, isLocal) {
    if (!isLocal) { try { await fetch('/api/maps/' + encodeURIComponent(id), { method: 'DELETE' }); } catch { /* offline */ } }
    try { localStorage.removeItem('range.editor.saved.' + id); } catch { /* skip */ }
  }

  _loadCustom(custom) {
    this.map = {
      id: custom.id, name: custom.name || 'Untitled', author: custom.author || this.author,
      created: custom.created || Date.now(), version: 1, custom: true,
      skybox: SKYBOX_PRESETS[custom.skybox] ? custom.skybox : 'night',
      blocks: Array.isArray(custom.blocks) ? custom.blocks.map((b) => ({ ...b })) : [],
      lights: Array.isArray(custom.lights) ? custom.lights.map((l) => ({ ...l })) : [],
      objects: Array.isArray(custom.objects) ? custom.objects.map((o) => ({ ...o })) : [],
    };
    this._ensureUids();
    this._history.length = 0; this._future.length = 0;
    this.sky.setPreset(this.map.skybox);
    this._rebuildAll();
    this.select(null);
    this.ui.refreshAll();
    this._autosave();
  }

  // ---- autosave draft to localStorage ----
  _autosave() {
    if (this._suppressAutosave) return;
    try {
      const draft = this.buildCustom();
      draft.__savedAt = Date.now();
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch { /* quota — ignore */ }
  }

  _offerRestore() {
    let draft = null;
    try { const raw = localStorage.getItem(DRAFT_KEY); if (raw) draft = JSON.parse(raw); } catch { /* skip */ }
    // only offer if the draft has real content beyond the default
    if (!draft || (!(draft.blocks || []).length && !(draft.objects || []).length)) return;
    const hasContent = (draft.blocks || []).length > 1 || (draft.objects || []).length > 2 || (draft.lights || []).length > 0;
    if (!hasContent) return;
    // defer so UI exists
    setTimeout(() => {
      this.ui.confirm('Restore your unsaved draft?', `A draft "${draft.name || 'Untitled'}" was auto-saved. Restore it?`, () => {
        this._loadCustom(draft);
        this.ui.toast('Draft restored', 'ok');
      });
    }, 300);
  }

  // =========================================================================
  //  LOOP
  // =========================================================================
  update(dt) {
    // WASD flies whenever the editor has focus (no modal open) — you do NOT need to
    // lock the mouse first. Mouse-LOOK still requires click-to-lock (handled in
    // _handleMouseMove). This is the expected fly-cam behavior.
    if (!this.ui.anyModalOpen()) this._flyStep(dt);
    this._applyCamera();
    this._updateGhost();
    // hover raycast (both modes) for outline + delete target
    const hit = this._raycastScene();
    const newHover = hit && hit.ref ? hit.ref : null;
    if (!this._sameRef(newHover, this.hovered)) {
      this.hovered = newHover;
      this._updateHoverOutline();
    }
  }

  _sameRef(a, b) { return (!a && !b) || (a && b && a.type === b.type && a.uid === b.uid); }

  _updateHoverOutline() {
    if (this.hoverOutline) { this._removeObj(this.hoverOutline); this.hoverOutline = null; }
    if (!this.hovered) return;
    if (this.selected && this._sameRef(this.hovered, this.selected)) return; // selected outline already shows
    const rec = this._recOf(this.hovered);
    if (!rec) return;
    let ol;
    if (this.hovered.type === 'block') ol = makeAabbHelper(THREE, rec);
    else if (this.hovered.type === 'object') ol = objectSelectBox(THREE, rec);
    else ol = lightSelectBox(THREE, rec);
    if (ol) { this.scene.add(ol); this.hoverOutline = ol; }
  }

  render(dt, alpha) {
    // pickup icons + spawn arrows spin gently for readability
    const t = performance.now() * 0.001;
    for (const { mesh, rec } of this.objectMeshes.values()) {
      if (rec.kind !== 'spawn') mesh.rotation.y = t * 0.8;
    }
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
  }

  resize(w, h) { this.ui?.resize?.(w, h); }

  dispose() {
    clearInterval(this._autosaveTimer);
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('mousemove', this._onMouseMove);
    window.removeEventListener('mousedown', this._onMouseDown);
    document.removeEventListener('pointerlockchange', this._onPointerLockChange);
    document.removeEventListener('pointerlockerror', this._onPointerLockError);
    this.canvas.removeEventListener('contextmenu', this._onContext);
    this.canvas.removeEventListener('wheel', this._onWheel);
    this.ui?.dispose?.();
    this.sky?.dispose?.();
    this._rebuildAll(); // clears meshes
    if (this.grid) this._removeObj(this.grid);
  }
}
