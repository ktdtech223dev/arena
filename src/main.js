// RANGE — entry point. Builds ctx, constructs every module (order matters —
// see src/ARCHITECTURE.md §1), and runs the fixed-timestep loop.
//
// Renderer: THREE.WebGPURenderer (WebGPU with automatic WebGL2 fallback).
// Add ?webgl to the URL to force the WebGL2 backend for fallback testing.
// All custom shading in this project is TSL node materials — never raw GLSL —
// so every material runs on both backends (see ARCHITECTURE.md §11).
import * as THREE from 'three/webgpu';
import { Loop } from './core/Loop.js';
import { Emitter } from './core/Events.js';
import { Settings } from './core/Settings.js';
import { Input } from './core/Input.js';
import { AudioEngine } from './core/Audio.js';
import { AudioBank } from './audio/AudioBank.js';
import { Colliders } from './world/Colliders.js';
import { RangeWorld } from './world/Range.js';
import { Targets } from './world/Targets.js';
import { MoveCourse } from './world/MoveCourse.js';
import { PlayerController } from './player/Controller.js';
import { CameraFX } from './player/Camera.js';
import { Movement } from './player/Movement.js';
import { ParticlePool } from './fx/Particles.js';
import { Tracers } from './fx/Tracers.js';
import { Impacts } from './fx/Impacts.js';
import { Shells } from './fx/Shells.js';
import { HitMarker } from './fx/HitMarker.js';
import { Viewmodel } from './weapons/Viewmodel.js';
import { WeaponManager } from './weapons/Weapon.js';
import { Feel } from './weapons/Feel.js';
import { HUD } from './ui/HUD.js';
import { CrosshairEditor } from './ui/CrosshairEditor.js';
import { WeaponWheel } from './ui/WeaponWheel.js';
import { RangeMenu } from './ui/RangeMenu.js';
import { DebugPanel } from './ui/DebugPanel.js';
import { ArenaMode } from './net/ArenaMode.js';
import { SettingsPanel } from './ui/SettingsPanel.js';
import { PerfHUD } from './ui/PerfHUD.js';

async function boot() {
  const ctx = {};
  window.RANGE = ctx; // debugging / self-test handle

  // Unified entry: no ?mode → the MAIN MENU (pick Test Range or Multiplayer);
  // ?mode=range → single-player facility; ?mode=arena → multiplayer arena.
  const params = new URLSearchParams(location.search);
  const mode = params.get('mode');

  // ---- N GAMES NETWORK (presence / achievements / leaderboards) -------------
  // Boots on EVERY path (menu, range, arena, editor, td). Anonymous or offline →
  // every call is a silent no-op; nothing can throw into the frame.
  try {
    const NG = await import('./ngames/ngames-arena.js');
    NG.init({
      onAchievement: (e) => {
        const d = document.createElement('div');
        d.style.cssText = 'position:absolute;top:64px;right:14px;z-index:120;background:rgba(10,16,24,.94);' +
          'border:1px solid rgba(255,209,102,.5);border-radius:8px;padding:10px 16px;' +
          'font-family:Segoe UI,system-ui,sans-serif;font-size:13px;color:#eaf6ff;box-shadow:0 8px 30px rgba(0,0,0,.5);transition:opacity .4s;';
        const icon = document.createElement('span'); icon.textContent = (e.icon || '🏆') + ' ';
        const name = document.createElement('b'); name.textContent = e.name || 'Achievement';
        const np = document.createElement('span'); np.style.color = '#ffd166'; np.textContent = '  +' + (e.np_reward || 0) + ' NP';
        d.append(icon, name, np);
        (document.getElementById('ui') || document.body).appendChild(d);
        setTimeout(() => { d.style.opacity = '0'; setTimeout(() => d.remove(), 450); }, 3800);
      },
    }).then(() => {
      NG.setPresence({
        status: mode === 'arena' ? 'in a match' : mode === 'editor' ? 'building a map'
          : mode === 'td' ? 'holding the line' : mode === 'range' ? 'in the test range' : 'in the menu',
      });
    });
    window.addEventListener('beforeunload', () => NG.shutdown());
  } catch { /* network layer optional — never block boot */ }

  // TOWER DEFENSE is a server co-op mode now — legacy ?mode=td redirects into the
  // arena with the td flag (ArenaMode votes the lobby over on welcome).
  if (mode === 'td') {
    const u = new URL(location.href);
    u.searchParams.set('mode', 'arena');
    u.searchParams.set('td', '1');
    location.replace(u.toString());
    return;
  }
  if (mode !== 'range' && mode !== 'arena' && mode !== 'editor') {
    const { MainMenu } = await import('./ui/MainMenu.js');
    new MainMenu();
    return; // no renderer/game built until a mode is chosen
  }
  const editorMode = mode === 'editor';
  const arenaMode = mode === 'arena';
  ctx.mode = editorMode ? 'editor' : arenaMode ? 'arena' : 'range';

  // ---- renderer / scene / camera ------------------------------------------
  ctx.THREE = THREE;
  ctx.canvas = document.getElementById('game');

  // Backend pick. Electron's WebGPU (behind enable-unsafe-webgpu) fails pipeline
  // compilation on some machines (GPUPipelineError: invalid fragment ShaderModule)
  // → connected-but-BLACK screen in the desktop exe. The desktop app therefore
  // defaults to the rock-solid WebGL2 backend (?webgpu opts back in for testing);
  // browsers keep WebGPU. A safety net below also catches the error at runtime
  // and reloads onto WebGL, so even masked user agents self-heal.
  const bootParams = new URLSearchParams(location.search);
  const isElectron = /Electron/i.test(navigator.userAgent);
  const forceWebGL = bootParams.has('webgl') || (isElectron && !bootParams.has('webgpu'));
  if (!forceWebGL) {
    window.addEventListener('unhandledrejection', (e) => {
      const msg = String((e && (e.reason?.message || e.reason)) || '');
      if (/GPUPipelineError|ShaderModule|GPUDevice/i.test(msg) && !bootParams.has('webgl')) {
        const u = new URL(location.href);
        u.searchParams.set('webgl', '1');
        location.replace(u.toString()); // one-way: reload onto WebGL2, no loop
      }
    });
  }
  ctx.renderer = new THREE.WebGPURenderer({
    canvas: ctx.canvas,
    antialias: true,
    powerPreference: 'high-performance',
    forceWebGL,
  });
  ctx.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  ctx.renderer.setSize(window.innerWidth, window.innerHeight);
  ctx.renderer.shadowMap.enabled = true;
  ctx.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  ctx.renderer.toneMapping = THREE.ACESFilmicToneMapping;
  ctx.renderer.toneMappingExposure = 1.05;
  ctx.renderer.autoClear = false;

  await ctx.renderer.init();
  ctx.backend = ctx.renderer.backend?.isWebGPUBackend ? 'WebGPU' : 'WebGL2';
  console.log(`[RANGE] renderer backend: ${ctx.backend}${forceWebGL ? ' (forced via ?webgl)' : ''}`);

  const badge = document.createElement('div');
  badge.id = 'backend-badge';
  badge.textContent = ctx.backend;
  badge.style.cssText =
    'position:absolute;top:8px;right:12px;font-size:10px;letter-spacing:0.18em;' +
    'color:#7df9ff;opacity:0.55;font-family:Consolas,monospace;z-index:5;';
  document.getElementById('ui').appendChild(badge);

  ctx.scene = new THREE.Scene();
  ctx.camera = new THREE.PerspectiveCamera(100, window.innerWidth / window.innerHeight, 0.05, 600);

  // ---- EDITOR MODE ----------------------------------------------------------
  // The WYSIWYG first-person map editor. It reuses ctx.renderer/scene/camera but
  // is fully self-contained (own input/UI/pointer-lock/sky) and does NOT build
  // any game module (world/player/weapons/arena). It drives its own render loop.
  if (editorMode) {
    ctx.events = new Emitter();
    const { EditorMode } = await import('./editor/EditorMode.js');
    ctx.editor = new EditorMode(ctx);

    function editorResize() {
      const w = Math.max(1, window.innerWidth), h = Math.max(1, window.innerHeight);
      ctx.renderer.setSize(w, h);
      ctx.camera.aspect = w / h;
      ctx.camera.updateProjectionMatrix();
      ctx.editor.resize?.(w, h);
    }
    window.addEventListener('resize', editorResize);
    editorResize();

    ctx.loop = new Loop({
      fixedHz: 120,
      update: (dt) => ctx.editor.update?.(dt),
      render: (dt, alpha) => ctx.editor.render?.(dt, alpha),
    });
    ctx.loop.start();
    console.log('[RANGE] editor booted');
    return;
  }

  // ---- shared state ---------------------------------------------------------
  ctx.events = new Emitter();
  ctx.tunables = [];
  ctx.cheats = {
    infiniteAmmo: false,
    noHardLanding: false,
    gravityScale: 1,
    sniperProjectile: false,
  };

  // ---- core -----------------------------------------------------------------
  ctx.settings = new Settings();
  ctx.input = new Input(ctx);
  ctx.audio = new AudioEngine(ctx);
  // real-sample bank layered over the synth (real files win, synth is the fallback).
  // Global so BOTH the Test Range and Arena hear the transcoded gun samples.
  ctx.audioBank = new AudioBank(ctx);

  // ---- world ----------------------------------------------------------------
  ctx.world = {};
  if (arenaMode) {
    // Minimal stubs so the reused modules (player/HUD/weapons) don't crash on
    // range-only fields; ArenaMode (constructed after UI) builds the real arena
    // geometry and overwrites colliders + raycastShot.
    ctx.world.colliders = { aabbs: [], ramps: [] };
    ctx.world.range = { spawnPoint: new THREE.Vector3(0, 0, 0), spawnYaw: 0, consoleMesh: null, anchors: {}, solidMeshes: [] };
    ctx.world.course = { running: false, currentTime: 0, bestTime: null, reset() {}, fixedUpdate() {} };
    ctx.world.targets = {
      damage: () => ({ points: 0, kill: false, zone: 'body' }),
      damageArea: () => [], nearestTarget: () => null, targetsInRadius: () => [],
      raycastShot: () => null, fixedUpdate() {},
    };
    ctx.world.raycastShot = (o, d, m) => ctx.world.targets.raycastShot(o, d, m);
  } else {
    ctx.world.colliders = new Colliders(ctx);
    ctx.world.range = new RangeWorld(ctx);
    ctx.world.targets = new Targets(ctx);
    ctx.world.course = new MoveCourse(ctx);
    ctx.world.raycastShot = (origin, dir, maxDist) =>
      ctx.world.targets.raycastShot(origin, dir, maxDist);
  }

  // ---- player ----------------------------------------------------------------
  ctx.player = {};
  ctx.player.controller = new PlayerController(ctx);
  ctx.player.camera = new CameraFX(ctx);
  ctx.player.movement = new Movement(ctx);

  // ---- fx ---------------------------------------------------------------------
  ctx.fx = {};
  ctx.fx.particles = new ParticlePool(ctx);
  ctx.fx.tracers = new Tracers(ctx);
  ctx.fx.impacts = new Impacts(ctx);
  ctx.fx.shells = new Shells(ctx);
  ctx.fx.hitmarker = new HitMarker(ctx);

  // ---- weapons ----------------------------------------------------------------
  ctx.viewmodel = new Viewmodel(ctx);
  ctx.weapons = new WeaponManager(ctx);
  ctx.feel = new Feel(ctx);

  // ---- ui -----------------------------------------------------------------------
  ctx.ui = {};
  ctx.ui.hud = new HUD(ctx);
  ctx.ui.editor = new CrosshairEditor(ctx);
  ctx.ui.wheel = new WeaponWheel(ctx);
  ctx.ui.rangeMenu = new RangeMenu(ctx);
  ctx.ui.debug = new DebugPanel(ctx);
  ctx.ui.perf = new PerfHUD(ctx, { visible: false }); // toggle with J (map profiling)

  // ---- arena (multiplayer) — built last; sets ctx.world.colliders + raycastShot
  if (arenaMode) ctx.arena = new ArenaMode(ctx);

  // ---- in-game settings panel (P) + return to main menu ----
  ctx.ui.settings = new SettingsPanel(ctx.settings, {
    audio: ctx.audio, mainMenu: true,
    onClose: () => ctx.input.popUI('settings'),
  });
  ctx.input.onKeyDown('KeyP', () => {
    if (ctx.ui.settings.isOpen) ctx.ui.settings.close();
    else { ctx.input.pushUI('settings'); ctx.ui.settings.open(); }
  });

  // ---- loop ----------------------------------------------------------------------
  function fixedUpdate(dt) {
    if (arenaMode) {
      ctx.arena.fixedUpdate?.(dt); // local prediction drives the controller
    } else {
      ctx.player.movement.fixedUpdate?.(dt);
    }
    ctx.weapons.fixedUpdate?.(dt);
    if (!arenaMode) {
      ctx.world.targets.fixedUpdate?.(dt);
      ctx.world.course.fixedUpdate?.(dt);
    }
    ctx.viewmodel.fixedUpdate?.(dt);
    ctx.feel.fixedUpdate?.(dt);
  }

  function render(dt, alpha) {
    ctx.player.camera.render?.(dt, alpha);
    ctx.viewmodel.render?.(dt, alpha);
    ctx.weapons.render?.(dt, alpha);
    ctx.feel.render?.(dt, alpha);
    ctx.fx.particles.render?.(dt, alpha);
    ctx.fx.tracers.render?.(dt, alpha);
    ctx.fx.impacts.render?.(dt, alpha);
    ctx.fx.shells.render?.(dt, alpha);
    ctx.fx.hitmarker.render?.(dt, alpha);
    ctx.ui.hud.render?.(dt, alpha);
    ctx.ui.editor.render?.(dt, alpha);
    ctx.ui.wheel.render?.(dt, alpha);
    if (!arenaMode) ctx.ui.rangeMenu.render?.(dt, alpha);
    ctx.ui.debug.render?.(dt, alpha);
    if (arenaMode) ctx.arena.render?.(dt, alpha);
    ctx.audio.render?.(dt, alpha);

    ctx.renderer.clear();
    ctx.renderer.render(ctx.scene, ctx.camera);
    if (ctx.viewmodel.scene && ctx.viewmodel.camera) {
      ctx.renderer.clearDepth();
      ctx.renderer.render(ctx.viewmodel.scene, ctx.viewmodel.camera);
    }

    ctx.ui.perf.update?.(dt); // reads renderer.info populated by the render above
    ctx.input.endFrame();
  }

  ctx.loop = new Loop({ fixedHz: 120, update: fixedUpdate, render });

  // ---- resize ----------------------------------------------------------------------
  function onResize() {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    ctx.renderer.setSize(w, h);
    ctx.camera.aspect = w / h;
    ctx.camera.updateProjectionMatrix();
    for (const mod of [
      ctx.viewmodel, ctx.ui.hud, ctx.ui.editor, ctx.ui.wheel, ctx.ui.rangeMenu,
      ctx.ui.debug, ctx.fx.hitmarker, ctx.arena,
    ]) {
      mod?.resize?.(w, h);
    }
  }
  window.addEventListener('resize', onResize);
  onResize();

  // Prewarm render pipelines so the first shots/frames don't hitch.
  try {
    await ctx.renderer.compileAsync?.(ctx.scene, ctx.camera);
    if (ctx.viewmodel.scene && ctx.viewmodel.camera) {
      await ctx.renderer.compileAsync?.(ctx.viewmodel.scene, ctx.viewmodel.camera);
    }
  } catch (err) {
    console.warn('[RANGE] pipeline prewarm skipped:', err);
  }

  ctx.loop.start();
  console.log('[RANGE] booted');
}

boot().catch((err) => {
  console.error('[RANGE] boot failed:', err);
  const el = document.createElement('div');
  el.style.cssText =
    'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;' +
    'color:#ff6b6b;font-family:Consolas,monospace;font-size:14px;white-space:pre-wrap;padding:40px;z-index:200;';
  el.textContent = 'RANGE failed to boot:\n\n' + (err?.stack || err);
  document.getElementById('ui').appendChild(el);
});
