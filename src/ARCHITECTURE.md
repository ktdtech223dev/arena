# RANGE — Architecture Contract (BINDING)

RANGE is a Titanfall-style FPS test facility: Three.js rendering, Vite, vanilla JS.
Multiple agents build sibling modules **concurrently**. This document, `src/main.js`,
and `src/core/*.js` are ground truth. Code strictly against this contract — sibling
files may not exist yet when you write yours.

## 0. Hard rules

- Plain JS ES modules. `import * as THREE from 'three'`. No other dependencies.
- ZERO external assets. Geometry = Three.js primitives / BufferGeometry. Textures =
  code-generated `<canvas>`. Audio = synthesized Web Audio. UI = DOM/CSS built in code.
- Never import a sibling module you don't own. You receive live instances via `ctx`.
  (Your OWN files may import each other, e.g. Viewmodel imports WeaponModels.)
- Cross-module communication ONLY via `ctx` references and `ctx.events` using the
  event names in §6. Call foreign optional hooks defensively: `ctx.viewmodel?.getMuzzleWorld?.()`.
- Gameplay math runs in `fixedUpdate(dt)` (dt = 1/120 s, may run 0..N times per frame).
  Visual-only motion may run in `render(dt, alpha)`. Never `Date.now()` for gameplay —
  use `ctx.loop.time`.
- Register every tunable in `ctx.tunables` (§8). This is the whole point of the project.
- Unknown sound names must `console.warn` once and return silently — never throw.
- Units: meters, seconds, degrees for angles exposed across modules. +Y up.
  The firing line is at z≈0; DOWNRANGE IS −Z. Spawn faces −Z (yaw 0 looks −Z).

## 1. Boot, wiring, lifecycle

`src/main.js` (already written — read it) creates `ctx`, constructs every module in
this exact order, each with the single argument `(ctx)`:

Settings → Input → AudioEngine → Colliders → RangeWorld → Targets → MoveCourse →
PlayerController → CameraFX → Movement → ParticlePool → Tracers → Impacts → Shells →
HitMarker → Viewmodel → WeaponManager → Feel → HUD → CrosshairEditor → WeaponWheel →
RangeMenu → DebugPanel.

Lifecycle (main.js calls these with `?.` — implement the ones your module needs):
- `fixedUpdate(dt)` — 120 Hz, called on: movement, weapons, targets, course, viewmodel, feel.
- `render(dt, alpha)` — once per frame, called on: cameraFX, viewmodel, weapons, feel,
  particles, tracers, impacts, shells, hitmarker, hud, editor, wheel, rangeMenu, debug, audio.
- `resize(w, h)` — on window resize, called on every module that defines it.

Render pipeline (main.js owns): `renderer.autoClear = false`; per frame main clears,
renders `ctx.scene` with `ctx.camera`, clears depth, then renders
`ctx.viewmodel.scene` with `ctx.viewmodel.camera`. UI is DOM on top.

`window.RANGE = ctx` is exposed for debugging/self-tests.

## 2. ctx reference

| field | type | owner (file) |
|---|---|---|
| `ctx.THREE` | the three module | main |
| `ctx.canvas`, `ctx.renderer`, `ctx.scene`, `ctx.camera` | three basics (camera = world PerspectiveCamera) | main |
| `ctx.loop` | Loop (`.time`, `.setTimescale(s, ms)`, `.fixedDt`) | core/Loop.js |
| `ctx.events` | Emitter (`on(name,fn)->unsub`, `emit(name,data)`) | core/Events.js |
| `ctx.settings` | Settings (`get(path,def)`, `set(path,v)`, `onChange(path,fn)`) | core/Settings.js |
| `ctx.input` | Input (see core/Input.js header) | core/Input.js |
| `ctx.audio` | AudioEngine (§5.A) | core/Audio.js |
| `ctx.tunables` | array — push tunable descriptors (§8) | main (owner: everyone pushes) |
| `ctx.cheats` | `{ infiniteAmmo, noHardLanding, gravityScale, sniperProjectile }` (mutable flags) | main |
| `ctx.world` | `{ colliders, range, targets, course, raycastShot(origin,dir,maxDist) }` | main (parts below) |
| `ctx.player` | `{ controller, camera, movement }` | main (parts below) |
| `ctx.fx` | `{ particles, tracers, impacts, shells, hitmarker }` | main (parts below) |
| `ctx.viewmodel` | Viewmodel (§5.E) | weapons/Viewmodel.js |
| `ctx.weapons` | WeaponManager (§5.D) | weapons/Weapon.js |
| `ctx.feel` | Feel (§5.E) | weapons/Feel.js |
| `ctx.ui` | `{ hud, editor, wheel, rangeMenu, debug }` | main (parts below) |

## 3. Player dimensions & conventions (BINDING for world + player agents)

- Capsule radius **0.35**, standing height **1.8**, crouch/slide height **1.0**.
  Eye height = height − 0.18. Doorways ≥ 2.2 high; slide-under gaps ≈ 1.3 high.
- `controller.position` is the **feet** position (bottom of capsule).
- Wall-runnable walls: vertical, ≥ 3 m tall, flagged `wallrun: true` on their collider.
- Gravity base 25 m/s² (player agent owns exact value, tunable) × `ctx.cheats.gravityScale`.

## 4. World layout (BINDING anchor schema)

RangeWorld (world/Range.js) builds ALL static geometry, lighting, sky, fog, canvas
textures, and fills `ctx.world.colliders`. It must expose:

- `range.spawnPoint: THREE.Vector3`, `range.spawnYaw: number`
- `range.solidMeshes: THREE.Object3D[]` — everything shot-raycastable (walls, floors,
  props). Every mesh in it has `userData.surface = 'concrete' | 'metal'`.
- `range.consoleMesh: THREE.Object3D` — the physical test-control console (E to open menu).
- `range.anchors` — EXACTLY this shape (Targets + MoveCourse consume it verbatim):

```js
anchors = {
  spawn:    { pos: V3, yaw: number },
  console:  { pos: V3 },
  gallery:  [ { pos: V3, dist: number } ],            // ~10 static silhouette spots at 5/10/25/50/100 m, varied heights
  precision:[ { pos: V3, size: number } ],            // ~6 bullseye boards 40–100 m, size = board radius (0.3–0.6)
  movingH:  [ { from: V3, to: V3, period: number } ], // ~3 horizontal ping-pong rails
  movingV:  [ { from: V3, to: V3, period: number } ], // ~2 vertical risers
  movingC:  [ { center: V3, radius: number, period: number } ], // ~2 circular strafers
  peekers:  [ { pos: V3, hidePos: V3, upTime: number, downTime: number } ], // ~2 pop-out spots
  cqc:      [ { pos: V3 } ],                          // ~8 close-cluster spots in the CQC room
  dummy:    { pos: V3 },                              // DPS dummy position
  drillVolume: { min: V3, max: V3 },                  // air volume in front of firing line for drill spawns
  course:   { start: { pos: V3, size: V3 }, finish: { pos: V3, size: V3 },
              gates: [ { pos: V3, radius: number } ] } // 3–5 shootable gates along the course
}
```

Colliders (world/Colliders.js):
- `colliders.aabbs: [{ min: V3, max: V3, wallrun?: bool, surface?: string }]`
- `colliders.ramps: [{ min: V3, max: V3, axis: 'x'|'z', h0: number, h1: number }]`
  — a ramp is a floor whose top surface height lerps from `h0` (at min[axis]) to `h1`
  (at max[axis]) across the AABB footprint. Used for slide ramps. Player collision
  treats ramps as heightfield floors and derives the slope normal.
- Helper methods `addBox(min, max, opts)` / `addRamp(...)` for RangeWorld to call.

## 5. Module contracts

### A. core/Audio.js — `export class AudioEngine`
- `play(name, { volume=1, rate=1, position=null (V3), delay=0 } = {})`
- `startLoop(name, { volume=1, position=null } = {})` → `{ stop(fadeSec=0.1), setVolume(v), setRate(r) }`
- `render(dt)` — syncs listener to `ctx.camera` world transform; housekeeping.
- Resumes the AudioContext on first user gesture (pointerdown/keydown) itself.
- Master/SFX volume from `settings.get('volMaster')` / `('volSfx')`, live via `settings.onChange`.
- Implements EVERY sound name in §7 as punchy synthesized SFX (noise bursts + tonal
  layers + envelopes; pre-render short AudioBuffers at init where useful).
  Positional (PannerNode) when `position` is passed.

### B. player/ — `PlayerController` (Controller.js), `CameraFX` (Camera.js), `Movement` (Movement.js), Collision.js (internal helpers)
PlayerController public fields: `position` (feet V3), `prevPosition` (V3, copy at the
START of each fixedUpdate — render interpolation uses it), `velocity` (V3, m/s),
`radius`, `height` (current), `standHeight`, `crouchHeight`, `crouched` (bool),
`grounded` (bool), `groundNormal` (V3). Method: `horizontalSpeed()`.
Movement public: `state` — `'GROUNDED' | 'AIRBORNE' | 'SLIDING' | 'WALLRUN'`,
`wallNormal` (V3|null), `wallSide` (−1 left / +1 right / 0). Implements the full kit:
coyote+buffered+variable jump, source-style air-strafe, slide (boost, slope accel via
ramp normals, slide-hop), wall-run (reduced gravity, duration, camera roll via
`cameraFX.setRoll`), wall-jump, footstep events. Consumes `ctx.input` actions:
forward/back/left/right/jump/crouch/sprint. Collision: swept capsule-vs-AABB +
ramp heightfields from `ctx.world.colliders`. Spawns at `range.spawnPoint`/`spawnYaw`.
CameraFX public (others call these):
- fields `yaw`, `pitch` (degrees; yaw 0 = facing −Z)
- `forwardXZ(out?)`, `rightXZ(out?)` → normalized V3 on the XZ plane
- `kick(dPitchDeg, dYawDeg)` — recoil moves REAL aim (Recoil.js drives + recovers)
- `addShake(strength01)` — decaying perlin-ish shake; `addFovKick(frac)` — momentary FOV punch
- `setRoll(targetDeg)` — wall-run lean target, spring-followed; `landDip(strength01)`
- `setAds(on, fovScale)` — smooth FOV zoom for ADS/scope
- `render(dt, alpha)` — consumes `input.consumeLook()`, applies sensitivity
  (`0.022 * settings.get('sens')` deg/count, × `adsSensMult` when ADS), positions
  `ctx.camera` at lerp(prevPosition, position, alpha) + eye height, applies bob/sway/
  tilt/shake/FOV (base FOV from settings, kick scaled by speed).

### C1. world/Range.js + world/Colliders.js — `RangeWorld`, `Colliders`
See §4. One connected, polished facility: main shooting gallery (lane markers, floor
distance markers 5/10/25/50/100 m), precision lane, moving-target bay, CQC room with
tight corridors, movement course (parallel wallrun walls, wall-jump ascent, slide
ramps, slide-under gaps, air-strafe pillar weave, start/finish plates, gate hoops),
control-console podium behind the firing line. Tech-facility look: flat colors,
emissive accent strips, code-generated grid/hazard canvas textures, directional key
light with soft shadows (tight shadow frustum), ambient/hemisphere fill, subtle fog,
gradient sky. Wall-runnable walls visibly edge-glow; slide ramps tinted. Colliders
must match visuals. Keep draw calls sane (merge/instance repeats where easy).

### C2. world/Targets.js + world/MoveCourse.js — `Targets`, `MoveCourse`
Targets:
- Builds all target types at `range.anchors`: static silhouettes (body + head zones),
  bullseye boards (bull/inner/outer rings by hit radius), movingH/V/C riders, peekers,
  CQC cluster, the DPS dummy (regenerating, emits `stats:dps` while damaged recently).
- Target: HP, hit flash, knockback wobble, pop on kill (particle burst via
  `ctx.fx.particles` + events), respawn timer. Meshes carry `userData.target`.
- `fixedUpdate(dt)` moves riders/peekers, runs respawns and the drill.
- `raycastShot(origin, dir, maxDist)` → `null` or
  `{ point: V3, normal: V3, distance, surface: 'concrete'|'metal'|'target', target: Target|null, zone: null|'body'|'head'|'bull'|'inner'|'outer' }`
  Raycasts `range.solidMeshes` + live target meshes (THREE.Raycaster). Zone from hit
  point vs target geometry.
- `damage(hit, dmg, def)` → `{ points, kill, zone }` — applies damage/score, emits
  `target:hit` / `target:killed` / later `target:respawn`, tracks per-gun TTK
  (first-damage→kill, emits `stats:ttk`).
- Listens: `range:spawn {section}`, `range:clear`, `range:resetAll`, `drill:start {type}`
  (flick = rapid spawn/despawn scoring reaction+accuracy; tracking = one strafing
  target scoring time-on-target). Emits `drill:tick`/`drill:end`.
MoveCourse: start/finish plate detection from `controller.position`, lap timer,
best-time persist (`settings 'bestLap'`), gate hit tracking (listens `target:hit` on
gate targets it registers), `reset()`, exposes `{ running, currentTime, bestTime }`.
Emits `course:start` / `course:finish {time, best, bestTime}` / `course:reset`.

### D. weapons/ logic — Weapon.js (`WeaponManager`, `Weapon`), weapons-data.js (`WEAPONS`), Hitscan.js, Projectile.js, Recoil.js
WeaponManager public: `defs` (array of 5 defs, §9), `current` (Weapon), `lastId`,
`select(id)`, `quickswap()`, `getSpreadDeg()` (current effective spread for crosshair
bloom), `fixedUpdate(dt)`, `render(dt)`.
Weapon public: `def`, `magAmmo`, `reserveAmmo` (∞ display if `cheats.infiniteAmmo`),
`state` (`'idle'|'firing'|'cycling'|'reloading'|'equipping'|'holstering'|'inspecting'`),
`ads` (0..1), `isAds()`.
Owns: fire gating (semi-auto click-cap for pistol/sniper, auto for SMG/AR, pump/bolt
cycle gate), spread model (base/move/air/ads + bloom + recovery), damage falloff,
pellet loop for shotgun (8 pellets, independent spread cone), reload FSM incl. empty
vs tactical variants and shotgun per-shell interruptible reload, ADS state (RMB,
scope for sniper), weapon switching (slot1–5 / wheel / `quickswap`), equip/holster
timing, ALL weapon audio (fire/dry/reload-phase/cycle/equip/holster — played at the
same moments the events fire so animation+sound stay synced by construction).
Fire raycast: origin = `ctx.camera` world position, dir = camera forward + spread cone;
call `ctx.world.raycastShot`, then `targets.damage(hit, dmg, def)` when `hit.target`;
emit `shot:tracer` (from `ctx.viewmodel?.getMuzzleWorld?.() ?? camera pos`) and
`shot:impact` per pellet.
Recoil.js: per-gun patterns — AR = learnable climb+drift list, SMG = bloom-y climb,
shotgun = one huge kick, sniper = heavy punch, pistol = light pop. Applies via
`cameraFX.kick()`, tracks uncompensated recoil and recovers it smoothly (subtracting
player counter-pull). Exposes crosshair-relevant state through `getSpreadDeg()`.
Projectile.js: `ProjectileManager` — travel-time bolts (sniper railgun toggle via
`cheats.sniperProjectile`), optional gravity, per-fixed-tick segment `raycastShot`,
glowing tracer mesh in `ctx.scene`, same damage path as hitscan.

### E. weapons/ visual — WeaponModels.js, Viewmodel.js, GunAnim.js, Feel.js
WeaponModels: `buildWeaponModel(def)` → `{ group: THREE.Group, parts: { … } }`.
Five UNIQUE recognizable silhouettes from primitives with emissive accents. Required
named parts per gun (animate these): pistol `slide, hammer, mag, trigger`; smg
`bolt, mag, stock, trigger`; shotgun `pump, mag(tube), trigger, shellPort`; ar
`bolt, mag, chargingHandle, trigger, dust?`; sniper `bolt, boltHandle, mag, scope, trigger`.
Every model includes `parts.muzzle` (empty Object3D at the muzzle tip) and
`parts.shellEject` (empty at the ejection port).
Viewmodel public: `scene` (THREE.Scene), `camera` (PerspectiveCamera, aspect synced in
`resize`), `getMuzzleWorld(out?)` → V3 in WORLD space (transform muzzle offset from
viewmodel-camera space through `ctx.camera.matrixWorld`), plus code-built stylized
arms/hands (trigger hand + support hand that actually reaches to mag/pump/bolt during
reloads). Listens to §6 weapon events and drives GunAnim.
GunAnim: spring/keyframe part animator — idle sway (mouse + breathing), movement bob
(speed-scaled, wall-run tilt with camera roll, land settle), fire kick (kickback +
muzzle rise + rotational punch + part actions: slide/bolt/pump/cylinder), reload phase
choreography driven by `def.reload.phases` timings (mag out drop → mag in → chamber;
shotgun per-shell; empty vs tactical), ADS pose raise (sights to center, reduced sway),
equip/holster lower/raise, inspect (T). All cancellable/blendable: fire cancels
inspect, swap cancels reload, spring recovery everywhere. Shell ejection: call
`ctx.fx.shells.eject(worldPos, worldVel, kind)` at the animation moment (world pos via
the same viewmodel→world transform).
Feel.js (`Feel`): listens `weapon:fired`/`target:hit`/`target:killed` — hitstop via
`ctx.loop.setTimescale` (bigger for shotgun/sniper, from def.feel), camera shake via
`cameraFX.addShake`, muzzle flash (light + additive sprite at muzzle in viewmodel
scene, plus brief world point light), scaled per def.feel.

### F. fx/ — ParticlePool (Particles.js), Tracers.js, Impacts.js, Shells.js, HitMarker.js
ParticlePool public: `burst({ position, count, color, speed, spread, life, size, gravity })`
— pooled points/sprites in `ctx.scene`. Tracers: listens `shot:tracer` — fast
stretched additive streaks from→to, per-def color/width. Impacts: listens
`shot:impact` — surface-typed sparks + decals (pooled quads, concrete/metal only —
never on moving targets) + positional impact/ricochet audio. Shells: `eject(pos, vel,
kind)` (`'pistol'|'rifle'|'shell'`) — small pooled casings with gravity arc, ground
bounce (y≈floor guess or raycast once), fade. HitMarker: listens `target:hit` — draws
the hitmarker on its own small centered canvas (white hit / red kill / gold
head-bull), expanding-fading, and PLAYS `hitmarker` / `kill_confirm` / `headshot` sounds.

### G. ui/ — HUD.js, Crosshair.js, CrosshairEditor.js, WeaponWheel.js, RangeMenu.js, DebugPanel.js
All DOM/canvas into `#ui`. Interactive panels: add class `interactive`, call
`input.pushUI(id)` / `popUI(id)` on open/close, play ui sounds.
HUD: ammo (mag/reserve, ∞), reload progress, gun name, SPEEDOMETER (m/s, bar+digits),
movement-state readout, lap timer (reads `world.course`), hit/score popups + damage
numbers (from `target:hit`, projected via camera; toggle `settings 'damageNumbers'`),
TTK/DPS readouts (from `stats:*`), drill scoreboard (`drill:*`), interact prompt when
near console, sniper scope overlay on `weapon:ads` when `def.scope` (vignette +
reticle, hide viewmodel via `ctx.viewmodel.scene.visible=false` while scoped).
Crosshair (Crosshair.js, used by HUD): canvas-rendered; config = `{ style:
'cross'|'t'|'dot'|'circle'|'crossdot'|'brackets', size, thickness, gap, dot, dotSize,
color, opacity, outline, outlineThickness, dynamic, tStyle }`; when `dynamic`, gap
expands with `weapons.getSpreadDeg()` projected to px.
CrosshairEditor (K): full live editor of every option, per-gun memory
(`settings 'crosshair.<gunId>'`, loads on `weapon:equip`), copy-to-all,
import/export code string, live preview.
WeaponWheel: hold TAB — radial 5-slot wheel, mouse-direction select, release to equip.
RangeMenu: E at console (`world.range.consoleMesh` within 3 m and looked at) or M
anywhere — spawn/clear/reset targets per section, drill start buttons, toggles
(infiniteAmmo, noHardLanding, sniperProjectile), gravityScale slider, course reset,
settings (sens, ADS sens, FOV, volumes, view-bob, damage numbers).
DebugPanel (F): auto-builds grouped sliders from `ctx.tunables`; collapsible groups,
live values, search filter.

## 6. Events (complete list — emit/consume ONLY these)

| event | payload | emitter → consumers |
|---|---|---|
| `weapon:equip` | `{ def }` | D → E, G |
| `weapon:holster` | `{ def }` | D → E |
| `weapon:fired` | `{ def, origin: V3, dir: V3, ads: 0..1 }` | D → E (anim+flash), Feel |
| `weapon:dryfire` | `{ def }` | D → E |
| `weapon:cycle` | `{ def, phase: 'pump'\|'bolt', duration }` | D → E |
| `weapon:reload_start` | `{ def, empty: bool }` | D → E, G |
| `weapon:reload_phase` | `{ def, phase: string, duration, index? }` | D → E |
| `weapon:reload_end` | `{ def, cancelled: bool }` | D → E, G |
| `weapon:ads` | `{ def, on: bool }` | D → E, G, B(cameraFX via D calling setAds) |
| `shot:tracer` | `{ from: V3, to: V3, def }` | D → F |
| `shot:impact` | `{ hit, def }` | D → F |
| `weapon:explosion` | `{ point: V3, radius, def }` | D → E(Feel), F, A(via Feel/F) |
| `weapon:bounce` | `{ point: V3, def }` | D → F, A |
| `target:hit` | `{ target, def, damage, zone, points, kill, point: V3, distance }` | C2 → F, G, Feel |
| `target:killed` | `{ target, points, point: V3, def }` | C2 → F, G, Feel |
| `target:respawn` | `{ target }` | C2 |
| `player:jump` / `player:walljump` | `{}` | B → A-users (movement plays own audio) |
| `player:land` | `{ fallSpeed, hard: bool }` | B |
| `player:slide_start` / `player:slide_end` | `{}` | B |
| `player:wallrun_start` | `{ side: -1\|1 }` / `player:wallrun_end` `{}` | B |
| `player:footstep` | `{ speed }` | B |
| `course:start` | `{}` | C2 → G |
| `course:finish` | `{ time, best: bool, bestTime }` | C2 → G |
| `course:reset` | `{}` | C2/G |
| `course:gate` | `{ index, total }` | C2 → G |
| `drill:start` | `{ type: 'flick'\|'tracking' }` | G → C2 |
| `drill:tick` | `{ type, score, hits, misses, timeLeft }` | C2 → G |
| `drill:end` | `{ type, score, hits, misses, accuracy, avgReactionMs }` | C2 → G |
| `stats:ttk` | `{ gunId, ms }` | C2 → G |
| `stats:dps` | `{ dps }` | C2 → G |
| `range:spawn` | `{ section: 'gallery'\|'precision'\|'moving'\|'cqc'\|'all' }` | G → C2 |
| `range:clear` / `range:resetAll` | `{}` | G → C2 |
| `ui:open` / `ui:close` | `{ id }` | G |

Movement/player sounds are played by B directly (`ctx.audio.play`), weapon sounds by D,
hit-feedback sounds by F (HitMarker), impact sounds by F (Impacts), UI sounds by G.

## 7. Sound bank (AudioEngine must implement EXACTLY these names)

`ui_click, ui_tick, ui_open, ui_close,`
`footstep, jump, land_soft, land_hard, slide_start, slide_loop*, wallrun_loop*, walljump,`
`pistol_fire, smg_fire, shotgun_fire, ar_fire, sniper_fire, dryfire,`
`exotic_fire, explosion, seeker_launch, exotic_load,`
`sawblade_fire, sawblade_bounce, sawblade_load,`
`pistol_magout, pistol_magin, pistol_rack,`
`smg_magout, smg_magin, smg_rack,`
`ar_magout, ar_magin, ar_rack, ar_bolt,`
`shotgun_shell, shotgun_pump,`
`sniper_magout, sniper_magin, sniper_bolt,`
`equip, holster,`
`impact_concrete, impact_metal, impact_target, ricochet,`
`hitmarker, kill_confirm, headshot,`
`beep, beep_go, lap_best`

(`*` = designed to be used via `startLoop`.) Five fire sounds must be DISTINCT
characters: pistol sharp crack, SMG snappy chatter, shotgun deep boom, AR punchy
report, sniper cannon boom with a long tail.

## 8. Settings keys & tunables

Settings (core/Settings.js, already written): `sens` (2.5), `adsSensMult` (0.8),
`fov` (100), `volMaster` (0.8), `volSfx` (1.0), `viewBob` (true), `damageNumbers`
(true), `bestLap` (null), `crosshair.<gunId>` (object).

Tunables — push descriptors into `ctx.tunables` at construction:
`{ cat: 'movement'|'camera'|'audio'|'feel'|'gun:pistol'|…, key: 'groundAccel', obj, prop, min, max, step, label?, onChange? }`
or function-based: `{ cat, key, get(), set(v), min, max, step }`.
DebugPanel renders all of them grouped by `cat`. EVERY movement, camera, feel, and
per-gun number must be here.

## 9. Gun defs (weapons-data.js — field names BINDING, values are D's to tune)

ids: `pistol, smg, shotgun, ar, sniper` (slots 1–5 in that order).

```js
{
  id, name, slot,
  type: 'hitscan' | 'pellets',        // sniper: hitscan but honors cheats.sniperProjectile
  damage, pellets?,                    // damage is per-pellet for 'pellets'
  auto: bool, rpm,                     // semi-auto still rate-capped by rpm
  mag, reserve,
  falloff: { start, end, minMult },    // meters, damage multiplier floor
  spread: { base, move, air, ads, bloomPerShot, bloomMax, recover },  // degrees
  recoil: { kickPitch, kickYaw, pattern?, recover, adsMult },
  reload: { phases: [{ name, t }], emptyPhases?: [{ name, t }], perShell?: bool },
  cycle?: { phase: 'pump'|'bolt', t },  // gate between shots (shotgun/sniper)
  equipT, holsterT, adsT, adsFovScale,  // seconds, fovScale <1 zooms
  scope?: bool,                         // sniper: scope overlay + heavy unscoped penalty
  sounds: { fire, ... },               // names from §7
  tracer: { color, width },
  shell: { kind: 'pistol'|'rifle'|'shell' },
  feel: { hitstopMs, hitstopKillMs, shake, flash },   // read by Feel/E
}
```

Reload phase names (BINDING — drive anim + audio):
pistol/smg/ar tactical: `magout → magin → rack`(ar: rack only on empty via emptyPhases
`magout → magin → rack → bolt`); shotgun: repeated `shell` phases (interruptible) then
`pump` if chamber empty; sniper: `magout → magin → bolt`.

## 10. File ownership map

| agent | files |
|---|---|
| A audio | `src/core/Audio.js` |
| B player | `src/player/Controller.js, Movement.js, Camera.js, Collision.js` |
| C1 range | `src/world/Range.js, Colliders.js` |
| C2 targets | `src/world/Targets.js, MoveCourse.js` |
| D weapon logic | `src/weapons/Weapon.js, weapons-data.js, Hitscan.js, Projectile.js, Recoil.js` |
| E weapon visual | `src/weapons/WeaponModels.js, Viewmodel.js, GunAnim.js, Feel.js` |
| F fx | `src/fx/Particles.js, Tracers.js, Impacts.js, Shells.js, HitMarker.js` |
| G ui | `src/ui/HUD.js, Crosshair.js, CrosshairEditor.js, WeaponWheel.js, RangeMenu.js, DebugPanel.js` |

Already written (do not modify): `index.html, vite.config.js, package.json,
src/main.js, src/core/Loop.js, Input.js, Settings.js, Events.js`.

## 11. Renderer / TSL (BINDING)

- The renderer is **`THREE.WebGPURenderer`** from `'three/webgpu'` (three r180),
  WebGPU with automatic WebGL2 fallback. `ctx.backend` = `'WebGPU' | 'WebGL2'`
  (logged on boot; `?webgl` URL param forces the WebGL2 backend for testing).
  main.js owns the renderer — no other module touches it.
- **NEVER raw GLSL.** No `ShaderMaterial`, no `RawShaderMaterial`, no
  `onBeforeCompile` string patching. Custom shading = **node materials + TSL**:
  `MeshStandardNodeMaterial`, `MeshBasicNodeMaterial`, `SpriteNodeMaterial`,
  `PointsNodeMaterial`, `LineBasicNodeMaterial` … from `'three/webgpu'`, with TSL
  functions (`uniform, attribute, uv, vec3, mix, sin, time, …`) from `'three/tsl'`.
  Every material must run on BOTH backends.
- Built-in materials (`MeshStandardMaterial`, `MeshBasicMaterial`, `SpriteMaterial`,
  canvas textures, fog, shadows, ACES tone mapping) are fine — the renderer converts
  them to node materials internally.
- **WebGPU landmines (must look identical on WebGL2):**
  - `THREE.Points` render as **1 px** on the WebGPU backend regardless of
    `PointsMaterial.size`. Never rely on point size — particles, sparks, muzzle
    sprites etc. use instanced quads (`InstancedMesh`) or `Sprite`s instead.
  - `LineBasicMaterial.linewidth > 1` doesn't work anywhere; use stretched quads/boxes.
  - Nothing may hard-depend on a WebGPU-only feature without a WebGL2 path.
- Prefer per-instance attributes + TSL over per-frame material clones; reuse
  materials, pool meshes.

## 12. Weapon expansion, weight & persistence (BINDING)

### 12.1 Seven weapons — new slots 6 & 7
`WEAPONS` gains ids **`exotic`** (slot 6) and **`sawblade`** (slot 7). Input already
maps Digit6→slot6, Digit7→slot7. `WeaponManager` must select slot6/slot7 (index-driven:
slotN → defs[N-1]). Everything that enumerates guns — WeaponWheel, CrosshairEditor gun
tabs + per-gun crosshair memory, DebugPanel gun categories, HUD — MUST be data-driven
off `ctx.weapons.defs` (now length 7), never hardcoded to 5.

### 12.2 Weapon weight → movement speed
Every gun def gains **`weight`** (number ~1..5). Movement scales the player's GROUND &
SPRINT max speed (only those; air/slide/accel feel otherwise unchanged) by:
`speedMult = clamp(1 - (weight-1) * weightSpeedPenalty, weightSpeedMin, 1)`.
Movement reads `ctx.weapons?.current?.def?.weight ?? 1` each tick; `weightSpeedPenalty`
(~0.06) and `weightSpeedMin` (~0.7) are tunables (cat 'movement'). Suggested weights:
pistol 1.0, smg 1.4, ar 2.0, shotgun 2.6, sawblade 2.8, sniper 3.0, **exotic 5.0**
(heaviest → slowest). Heavier guns are visibly slower (HUD speedometer reads it live).

### 12.3 THE EXOTIC (slot 6) — rocket launcher w/ seekers
`type: 'rocket'`, a travel-time projectile (ProjectileManager, NOT hitscan).
Rocket flies straight (~55 m/s), leaves a smoke/fire trail (periodic `ctx.fx.particles`
burst + a moving point light). On impact with any solid/target (per-tick segment
`ctx.world.raycastShot`) or at max life → **explode** at the point:
- emit `weapon:explosion { point:V3, radius, def }`;
- `ctx.world.targets.damageArea(point, explosion.radius, explosion.damage, def, {falloff:true})`;
- spawn `explosion.seekers` (5) homing sub-projectiles. Each locks the NEAREST live
  target within `explosion.seekRadius` (8 m) of the blast
  (`ctx.world.targets.nearestTarget(point, radius, excludeSet)` — spread the 5 across
  the nearest few), steers toward its target's live `aimPoint` at ~`seekerTurn` rad/s,
  speed `seekerSpeed`, life `seekerLife`; on contact deals `explosion.seekerDamage`
  (via `targets.damage`/`damageArea`). No target found / target dies → fly straight, expire.
def.explosion = `{ radius:5, damage:120, seekers:5, seekRadius:8, seekerDamage:45,
seekerSpeed:28, seekerTurn:6, seekerLife:2.5, seekerRadius:1.2 }`. Slow (rpm ~40),
mag 1 / reserve ~8, single-load reload, huge recoil, heaviest gun. Seekers seek TARGETS
(the range's stand-in for players); a future N-Games player list swaps `nearestTarget`.

### 12.4 SAWBLADE LAUNCHER (slot 7) — ricochet blades
`type: 'sawblade'`, travel-time projectile (~40 m/s, no gravity, spinning disc mesh).
- WALL hit (raycastShot hit with `target == null`, surface concrete/metal): REFLECT
  velocity about the hit normal (`v' = v - 2(v·n)n`), nudge off the surface, decrement
  bounces, emit `weapon:bounce { point:V3, def }` (Audio → `sawblade_bounce`, fx sparks).
  After `ricochet.maxBounces` (2) wall bounces the NEXT wall hit despawns it (also despawn
  at `ricochet.life` / maxDist).
- TARGET hit: deal `ricochet.damage` (`targets.damage`) and KEEP FLYING (carves through
  multiple targets); a target hit does NOT consume a wall bounce.
def.ricochet = `{ maxBounces:2, speed:40, damage:55, life:4, radius:0.18 }`. rpm ~120,
mag ~8 / reserve ~40, medium weight.

### 12.5 ProjectileManager (Projectile.js) generic behaviors
`spawn(opts)` — pooled, stepped in fixedUpdate via per-tick segment `raycastShot`,
glowing emissive/TSL meshes + lights in `ctx.scene`, NO raw GLSL. Support: straight
travel + gravity (existing sniper railgun path MUST keep working under
`cheats.sniperProjectile`); `onImpact(hit)` (rocket→explode); `homing:{ getTarget, turn }`
(seekers); `ricochet:{ bouncesLeft, onBounce(hit) }` (sawblade); `onTargetHit(hit,target)`
(damage + continue vs despawn). Feed damage through the normal targets path.

### 12.6 Targets spatial queries (Targets.js) — NEW methods
- `nearestTarget(point:V3, maxRadius, exclude?:Set)` → nearest LIVE target with aim point
  within maxRadius, else null.
- `targetsInRadius(point:V3, radius)` → array of live targets within radius.
- `damageArea(point:V3, radius, dmg, def, opts?)` → damage every live target within radius
  (`opts.falloff` → linear to 0 at edge) through the normal damage/score/flash/event path
  (emits target:hit / target:killed per target). Returns results array.
- `target.aimPoint(out:V3)` → live world-space body-center point to home/aim at.

### 12.7 Persistence (server.mjs + Settings.js) — implemented
Static server also serves `GET/POST /api/progress?player=<id>` backed by a Railway
persistent volume at `/data` (`DATA_DIR` env, `./data` fallback). `Settings` mirrors the
whole blob there (server wins on boot-merge), keyed by `playerId` (`?player=<id>` from
N Games, else a generated local id). Anything that should persist lives in Settings.
