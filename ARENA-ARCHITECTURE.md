# ARENA — Multiplayer Netcode Contract (BINDING)

ARENA extends the single-player RANGE testbed into a 2–4 player shared arena where
players SEE each other (avatars), MOVE, and SHOOT each other with **no desync**. This
build proves the netcode foundation only — NO scoring / rounds / pickups / lobby-UI /
map-rotation yet (the server is built so those bolt on later, but they are NOT built).

Reuse RANGE's client systems (WebGPU renderer, kinematic controller, 5 guns, procedural
gun anim, HUD, crosshair editor). Do NOT rebuild them.

When the whole thing works end-to-end, print: **ARENA READY 🔫**

## 0. Hard rules

- **Shared movement is the ONE source of truth for physics.** Client prediction and
  server authority MUST run *byte-identical* movement math from identical inputs, or it
  desyncs. That code lives in `shared/movement-core.js` and is imported by BOTH.
- `shared/*` is **dependency-free and THREE-free** — plain numbers only (`{x,y,z}` vecs
  or flat arrays). The server is headless Node (no THREE, no DOM, no Web Audio). The
  client adapts THREE ⟷ plain vecs at the boundary.
- **Fixed timestep everywhere, no `Math.random()` in movement, no frame-rate-dependent
  physics.** Given the same input stream and start state, movement is deterministic.
- Server is **authoritative**: it owns positions, velocities, health, hits, deaths.
  Clients predict + reconcile; they never decide damage.
- Transport is Socket.io (WebSocket). Desync is killed by the MODEL below, not the wire.
- Keep single-player RANGE fully working — ARENA is a *mode* the client enters, not a
  replacement. `?mode=arena` (or the N Games launcher) enters multiplayer; default stays
  single-player range.

## 1. The netcode model (the whole point)

**Server-authoritative sim + client-side prediction + reconciliation + entity
interpolation for remotes + lag-comp rewind for hits.**

- **Server** runs a fixed 60 Hz auth tick. Per tick: drain each player's input queue in
  seq order, `stepMovement` each via `movement-core`, resolve shots (with lag-comp
  rewind), apply damage/death, then emit per-client snapshots (every tick).
- **Client prediction (local player):** stamp every input with an incrementing `seq`,
  apply it locally *immediately* via `movement-core`, buffer it (ring buffer of
  unacked inputs), and send it. Local player feels zero latency.
- **Reconciliation:** each snapshot carries `ack` = the last input seq the server
  processed for you. On snapshot: SNAP local player to the authoritative state as of
  `ack`, then REPLAY all buffered inputs with `seq > ack` on top via `movement-core`.
  Correct prediction → nothing visibly moves. Small error → **smooth** the positional
  delta over a few frames (error accumulator decays to 0), never hard-teleport.
- **Entity interpolation (remotes):** render remote players `INTERP_DELAY_MS` (~100 ms,
  2–3 snapshots) in the PAST, interpolating position/rotation/anim-state between the two
  bracketing snapshots. If a snapshot is late, extrapolate only briefly (cap
  `EXTRAP_MAX_MS`), never wildly.
- **Lag-comp hits:** shots resolved on the SERVER. Client sends a shot with its
  `fireTime` (client clock, aligned via ping handshake) + the input `seq`. Server
  rewinds other players to `fireTime` using ~1 s of stored position history and tests
  the hit there. Damage/death server-decided + broadcast. Client shows an optimistic
  local hitmarker; the server confirms.

## 2. Message protocol (Socket.io events + payload shapes)

All shapes are declared in `shared/types.js` (JSDoc typedefs — this is JS). Vectors are
`{x,y,z}`. Times are ms (client & server exchange via the clock handshake).

Client → Server:
| event | payload | notes |
|---|---|---|
| `join` | `{ name?, preferredCrew? }` | on connect; server assigns crew identity + spawn |
| `input` | `InputCmd` **or** `InputCmd[]` (batched) | fixed send-rate 60/s; may batch 1–3 |
| `fire` | `{ seq, fireTime, weaponId, origin, dir, ads }` | one per shot; server lag-comp resolves |
| `reload` / `swap` | `{ seq, weaponId }` | non-movement actions, server tracks ammo |
| `ping` | `{ t0 }` | clock/latency handshake; server replies `pong` |

Server → Client:
| event | payload | notes |
|---|---|---|
| `welcome` | `{ id, crew, tickRate, snapRate, arenaId, players:[PublicPlayer], constants }` | once, on join accept |
| `player_join` | `PublicPlayer` | someone joined |
| `player_leave` | `{ id }` | someone left |
| `snapshot` | `Snapshot` (see §3) | every server tick, per-client (carries your `ack`) |
| `hit` | `{ attacker, victim, dmg, part, victimHp, killed }` | broadcast; drives feedback |
| `death` | `{ id, by, respawnInMs }` | player died |
| `respawn` | `{ id, pos, yaw }` | player respawned |
| `pong` | `{ t0, tServer }` | clock handshake reply |

`InputCmd` (client→server, also fed to `movement-core`):
```
{ seq:int, dtMs:int,                     // dtMs = fixed input frame (e.g. 1000/60)
  move:{f:-1..1, r:-1..1}, look:{yaw,pitch}, // yaw/pitch degrees (absolute aim)
  buttons:int-bitmask }                  // JUMP|CROUCH|SPRINT (see shared/constants BTN)
```

## 3. Snapshots (`shared/types.js` + `server/Snapshots.js`)

```
Snapshot = {
  tick:int, serverTime:ms, ack:int,        // ack = your last processed input seq
  players: [ SnapPlayer ] }
SnapPlayer = {
  id, pos:{x,y,z}, vel:{x,y,z},            // vel for dead-reckoning only
  yaw, pitch, state:MoveState, ground:bool,
  hp:int, alive:bool, weaponId, firing:bool }
MoveState = 'GROUNDED'|'AIRBORNE'|'SLIDING'|'WALLRUN' (same strings the FSM uses)
```
Snapshots are full-state (2–4 players is tiny). `Snapshots.js` also keeps, per player, a
ring buffer of `~1 s` of `{ time, pos, yaw, hitboxes }` for lag-comp rewind (§5).

## 4. `shared/movement-core.js` — THE shared kinematic core (BINDING interface)

Pure, deterministic, THREE-free. Exactly this interface (client Movement.js and server
Game.js both call it):

```
createMoveState(spawn) -> MoveState           // full mutable movement state (pos/vel/…)
stepMovement(state, input, world, dt) -> void  // advance ONE fixed step in place
  // input: InputCmd (move/look/buttons). world: { aabbs, ramps } from constants/arena.
  // dt: seconds (fixed). NO side effects, NO randomness, NO THREE, NO Date.now.
serializeState(state) -> SnapPlayer-ish        // pos/vel/yaw/pitch/state/ground
applyAuthState(state, auth) -> void            // snap local state to an auth SnapPlayer
```
Its physics is EXACTLY RANGE's kit (ground accel + friction, source air-strafe, slide
+slope+hop, wall-run +roll, wall-jump, coyote/buffer/variable jump, swept capsule-vs-AABB
+ ramps). It is produced by EXTRACTING the math from `src/player/Movement.js` +
`Controller.js` + `Collision.js` into this pure module; the client keeps its feel by
having Movement.js call `stepMovement` and layering side-effects (audio/events/camera)
around it. Capsule/ground constants come from `shared/constants.js` (single source).

## 5. Server (`/server/`, Express + Socket.io, Railway) — authoritative

- `index.js`: Express (serves the built `dist/` client + the existing `/api/progress`
  volume API) + Socket.io + `PORT` from env + `/health`. Boots the `Lobby` + `Game`.
- `Lobby.js`: ONE always-up room. Players join immediately — no codes/invites/host. Holds
  `settings = { currentMap: DEFAULT_ARENA }` (map rotation STUBBED — do not implement).
  Built to expand (match/scoring/pickups bolt on here later). Assigns crew identity.
- `Game.js`: fixed 60 Hz loop (accumulator, not setInterval drift). Per tick: for each
  player drain input queue in seq order → `stepMovement`; process queued shots via
  `Hits`; apply damage/death/respawn; record position history; build+emit snapshots.
- `Player.js`: server player = { id, crew, moveState (movement-core), inputQueue, lastSeq,
  hp, alive, weaponId, ammo, pendingShots, respawnAt }.
- `Snapshots.js`: build per-client Snapshot (with that client's `ack`); maintain the
  ~1 s position/hitbox history ring for rewind.
- `Hits.js`: server hitscan/projectile. On a `fire`, rewind every OTHER player to the
  shooter's `fireTime` (interpolate history), build capsule hitboxes, ray/segment test,
  nearest hit wins, compute damage (reuse RANGE gun stats: damage + falloff + headshot
  mult), return the victim + part. Death when hp ≤ 0.
- Crew identities (fixed colors): `CREW` in `shared/constants.js` —
  Keshawn / Sean / Amari / Dart / Tyheim / Arisa (6). Arena targets 2–4 concurrent.
- Respawn: on death, after `RESPAWN_MS`, respawn at a spawn point (spread, never
  face-to-face). No scoring.

## 6. Client net (`src/net/`)

- `Connection.js`: connect to the server (URL: same-origin in prod, `VITE_ARENA_URL`
  override for dev), `join`, and a ping/clock handshake that maintains
  `clockOffset` (serverTime ≈ clientTime + offset) + smoothed `rtt`. Exposes send helpers
  + an event surface the other net modules subscribe to.
- `Prediction.js`: wraps the LOCAL controller. Each fixed client step: build an
  `InputCmd` (seq++), apply via `movement-core` (predicted), push to the unacked ring,
  send (batched at 60/s). On `snapshot`: `applyAuthState` to your `ack` state, replay
  unacked inputs (seq > ack), compute the positional error vs the pre-reconcile predicted
  pos and feed it to a decaying **error-smoothing** offset the camera/render adds (so the
  correction is visually smooth, never a teleport).
- `Interpolation.js`: buffer remote snapshots per player; render remotes at
  `serverTime - INTERP_DELAY_MS`, interpolating pos (lerp) + yaw/pitch (angle-lerp) +
  anim state between the two bracketing snaps; brief capped extrapolation if starved.
  Spawn/despawn `RemotePlayer` on `player_join`/`player_leave` (+ initial `welcome` list).
- `NetDebug.js`: overlay (ping, tick, interp delay, prediction error px/m, snapshot rate,
  in/out pps) + a **dev latency injector** toggle (0/50/100/200 ms + jitter) applied to
  BOTH send and receive so you can stress the netcode locally. Toggle key (e.g. `N`).

## 7. Client entities (`src/entities/`)

- `Avatar.js`: code-built stylized humanoid (THREE primitives — head/torso/2 arms/2 legs/
  held-gun stub), crew color + emissive accent. Procedural POSED animation driven by the
  networked `MoveState` + speed + look yaw/pitch: idle, run (leg cycle), air (tuck), slide
  (low+lean), wall-run (angle+arm out), shoot (recoil pose). Readable at distance.
- `RemotePlayer.js`: an interpolated remote = Avatar + floating nameplate (crew name) +
  HP bar; consumes the interpolated transform+state from `Interpolation.js`; plays
  positional remote audio (footsteps/fire) via `AudioBank`.

## 8. Client arena + audio

- `src/world/Arena.js`: ONE symmetric code-built arena (central multi-level structure,
  ramps/platforms, wall-run walls + wall-jump routes, cover, sightlines), good WebGPU
  node-material look + lighting + fog + sky. Exports its AABB collider list to
  `shared/constants.js` (`ARENA_COLLIDERS`) so the SERVER uses identical collision.
  Spawn points spread around (`ARENA_SPAWNS`). Clean spots reserved for future pickups.
- `src/audio/AudioBank.js` + `src/audio/manifest.js` + `public/audio/`: load real sample
  files (see manifest cue→filename), pooled buffers for rapid overlap, positional
  (PannerNode) for remote shots/footsteps. **Procedural fallback**: any missing sample
  falls back to RANGE's existing synth (core/Audio.js) for that cue — real files win,
  never breaks. Manifest filenames: guns pistol_fire/smg_fire/shotgun_fire/rifle_fire/
  sniper_fire; reload reload_magout/reload_magin/reload_rack/shell_insert/dryfire; move
  footstep_01..04/jump/land_soft/land_hard/slide/wallrun; feedback hit/hitmarker/kill/
  equip; ui ui_click. (`.wav`.)

## 9. Constants (`shared/constants.js`) — single source, imported by both

`TICK_RATE=60`, `SNAP_RATE=60`, `INPUT_RATE=60`, `INTERP_DELAY_MS=100`,
`EXTRAP_MAX_MS=120`, `HISTORY_MS=1000`, `RESPAWN_MS=2500`, `MAX_PLAYERS=6`,
`BTN={JUMP:1,CROUCH:2,SPRINT:4}`, capsule/ground constants (radius 0.35, standH 1.8,
crouchH 1.0, gravity, speeds — the RANGE values), `CREW=[{name,color}…]` (6),
`ARENA_COLLIDERS=[{min,max,wallrun?}]`, `ARENA_SPAWNS=[{pos,yaw}]`, `DEFAULT_ARENA`.

## 10. Deploy (Railway)

The Express server (`server/index.js`) is the Railway start command — it serves the
built client (`dist/`) AND runs the socket.io auth sim AND keeps the `/api/progress`
volume API. `railway.json` start → `node server/index.js`; Nixpacks builds `npm run
build`. Same service/volume as RANGE (the arena replaces the sirv-only `server.mjs` as
the start command; `server.mjs` can be kept for pure-static fallback). Client connects
same-origin. N Games launcher entry (Electron shell / link) points at the deployment.

## 11. Verify (this build lives or dies here)
- 2+ headless/real clients: local player never rubber-bands; remotes move SMOOTHLY
  (run/slide/wall-run readable) at ~100 ms interp; shooting a moving player registers
  (lag comp); holds under injected 200 ms + jitter; deaths + respawns work; identical
  shared movement on client & server (prediction error ≈ 0 on a clean link).

## 13. Combat expansion (BINDING) — networked projectiles, grenades, feedback

### 13.1 Server-authoritative NETWORKED projectiles
The sawblade, rocket (+seekers), and grenade are **server-simulated** travel-time
projectiles — NOT hitscan. `server/Projectiles.js` (`ProjectileSim`) owns them; `Game`
steps it each tick. Each tick a projectile advances, collides vs `ARENA_WORLD` (walls)
and player capsules, and applies authoritative damage. All live projectiles are echoed
in every snapshot (`Snapshot.projectiles: SnapProjectile[]`, §types) so ALL clients
render identical flight/bounces. On a bounce/explosion the server broadcasts a `boom`
event (`BoomEvent`) → clients play particles + positional sound + local shake.
Configs live in `shared/constants.js` `PROJECTILES` / `GRENADE`. Behaviors:
- **sawblade**: ricochets off WALLS up to `maxBounces`, PIERCES players (damage each once
  per leg; clear the hit-set on each bounce). Despawn after bounces/life. NO hitscan.
- **rocket**: flies straight; on wall/player impact or life-expiry → SPLASH (radius,
  falloff to `splashMinFrac` at the edge) to all players in range + spawns `seekers`.
- **seeker**: homes the nearest ENEMY player (not owner) within `seekRadius`; small splash
  on contact/expiry.
- **grenade**: thrown via `throw`; arcs under gravity; bounces off walls/floor (restitution
  `bounce`, tangential `friction`); explodes on `fuse` → big splash. No direct-contact detonation.
Damage never friendly-fires the owner for direct hits; splash DOES include everyone
(incl. self) so rockets/grenades have self-knockback risk (feels right).

### 13.2 Fire routing (`server/index.js` + `Hits.js`)
On `fire {weaponId,...}`: if `WEAPON_COMBAT[weaponId].projectile` is set → spawn that
server projectile (owner=shooter, origin/dir from the cmd). Else → existing hitscan
lag-comp path. Grenades come via a separate `throw {seq, fireTime, origin, dir, charge}`
message (client `G` key), rate-limited by `GRENADE.cooldownMs`, spawned as a `grenade`
projectile with `throwUp` added.

### 13.3 Headshots (`server/Hits.js`)
Add a dedicated HEAD sphere (center = feet + height*`HEAD.centerFrac`, radius `HEAD.radius`)
tested BEFORE the body capsule; a ray hitting it → `part:'head'`, `dmg *= HEAD.mult`
(≈2×). Body hits unchanged. `hit`/`death` events carry `part`/`headshot` so the client
gives a distinct headshot hitmarker + ding.

### 13.4 Client feedback (reuses RANGE HUD/fx; new src/ui + wiring in ArenaMode)
- **Got-shot feedback** (`src/ui/DamageIndicator.js`): on a `hit` where `victim==me`, show a
  red directional arc pointing toward the attacker (from attacker's last-known snapshot
  pos vs my pos + camera yaw) that fades, plus a brief red screen vignette scaled by dmg.
- **Kill feed** (`src/ui/KillFeed.js`): on every `death`, push a top-right row
  “‹killer› ‹weapon-icon› ‹victim›” in crew colors (headshot marker if `headshot`); rows
  fade after a few s. Names/colors from the known player list.
- **Kill cam** (`src/net/KillCam.js`): on my `death`, spectate my killer for the respawn
  delay — camera eases to look at/follow the killer's avatar with a “KILLED BY ‹name›”
  banner; restore first-person on `respawn`. If killer is me/world, just show the banner.
- **Headshot feedback**: a gold/special hitmarker + `headshot` ding when my `hit.part==='head'`.

### 13.5 Enemy weapon display (`src/entities/Avatar.js` + `RemotePlayer.js`)
`SnapPlayer.weaponId` is networked. RemotePlayer passes it to the Avatar, which shows a
distinct simple gun silhouette per weapon id (pistol/smg/shotgun/ar/sniper/exotic/sawblade)
in the held-gun slot so you can read what someone is carrying at a glance.

### 13.6 Client networked-projectile rendering (`src/net/ProjectileView.js`)
Reads `snapshot.projectiles`, spawns/updates/despawns a pooled visual per id (rocket/
seeker/sawblade spinning disc/grenade), interpolated like remote players (render at
`serverTime - INTERP_DELAY_MS`). Reuses the RANGE projectile look. Handles `boom` events
→ `ctx.fx.particles` burst + `AudioBank` positional sound + shake if near the local player.
The local client must NOT also locally-simulate exotic/sawblade projectiles in arena mode
(ArenaMode disables `ctx.weapons.projectiles.spawn`) — projectiles are server-owned.

### 13.7 More wall-run
`ARENA_COLLIDERS` gains an extended wall-run network (thin tall `wallrun:true` walls +
wall-jump ledges). `Arena.js` already builds a mesh per collider and tints wallrun walls,
so these render automatically; verify the tint/edge-glow reads and routes are chainable.
