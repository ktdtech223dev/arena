// ARENA server — index.js: Express + Socket.io authoritative host (Railway).
// Serves the built client (dist/), the /api/progress persistent-volume API, a
// /health route, and runs the always-on lobby + 60 Hz authoritative sim.
import http from 'node:http';
import path from 'node:path';
import { promises as fs, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import express from 'express';
import { Server as SocketServer } from 'socket.io';
import { TICK_RATE, SNAP_RATE, DEFAULT_ARENA, WEAPON_COMBAT, GRENADE } from '../shared/constants.js';
import { MAPS, mapList, registerCustomMap, unregisterCustomMap, CUSTOM_RAW } from '../shared/maps.js';
import { validateCustomMap } from '../shared/custommap.js';
import { Lobby } from './Lobby.js';
import { Game } from './Game.js';
import { StatsStore } from './Stats.js';
import { MODES } from './Modes.js';

const PORT = Number(process.env.PORT) || 3000;
const ROOT = process.cwd();
const DIST = path.join(ROOT, 'dist');

// ---- persistent-volume progress API (ported from server.mjs) ---------------
function resolveDataDir() {
  const preferred = process.env.DATA_DIR || '/data';
  try { mkdirSync(path.join(preferred, 'progress'), { recursive: true }); return preferred; }
  catch { const local = path.join(ROOT, 'data'); mkdirSync(path.join(local, 'progress'), { recursive: true }); return local; }
}
const DATA_DIR = resolveDataDir();
const PROGRESS_DIR = path.join(DATA_DIR, 'progress');
const MAPS_DIR = path.join(DATA_DIR, 'maps');
mkdirSync(MAPS_DIR, { recursive: true }); // custom-map persistence (Railway volume)
const stats = new StatsStore(path.join(DATA_DIR, 'stats')); // per-profile stats
const safeId = (raw) => (String(raw || 'local').slice(0, 64).replace(/[^a-zA-Z0-9_-]/g, '') || 'local');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '256kb' }));

app.get('/health', (_req, res) => res.json({ ok: true, tickRate: TICK_RATE, arena: DEFAULT_ARENA, players: lobby.count }));

app.get('/api/progress', async (req, res) => {
  const file = path.join(PROGRESS_DIR, `${safeId(req.query.player)}.json`);
  try { res.type('json').send(await fs.readFile(file, 'utf8')); }
  catch { res.json({}); }
});
app.post('/api/progress', async (req, res) => {
  const file = path.join(PROGRESS_DIR, `${safeId(req.query.player)}.json`);
  try {
    const tmp = `${file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(req.body ?? {}));
    await fs.rename(tmp, file);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ ok: false, error: 'write failed' }); }
});

// ---- custom-map persistence API (mirrors /api/progress) --------------------
// GET  /api/maps      → [{id,name,author,created}]  (saved custom maps)
// GET  /api/maps/:id  → the full authored custom-map JSON (for edit/host)
// POST /api/maps      → validate + persist + register live + broadcast refresh
// DEL  /api/maps/:id  → remove file + unregister (built-ins are never touched)
// per-profile stats (kills/deaths/wins/streak/accolades/weapon kills) — read-only
// API for the menu hub; the GAME writes stats server-side as matches happen.
app.get('/api/stats', async (req, res) => {
  try { res.json(await stats.get(safeId(req.query.player))); }
  catch { res.json({}); }
});

app.get('/api/maps', async (_req, res) => {
  const out = [];
  try {
    const files = await fs.readdir(MAPS_DIR);
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      try {
        const c = JSON.parse(await fs.readFile(path.join(MAPS_DIR, f), 'utf8'));
        out.push({ id: c.id, name: c.name, author: c.author, created: c.created });
      } catch { /* skip a corrupt file */ }
    }
  } catch { /* dir missing → empty */ }
  res.json(out);
});

app.get('/api/maps/:id', async (req, res) => {
  const id = safeId(req.params.id);
  // prefer the in-memory raw (already loaded); fall back to disk.
  const cached = CUSTOM_RAW.get(req.params.id) || CUSTOM_RAW.get(id);
  if (cached) return res.json(cached);
  try { res.type('json').send(await fs.readFile(path.join(MAPS_DIR, `${id}.json`), 'utf8')); }
  catch { res.status(404).json({ error: 'not found' }); }
});

app.post('/api/maps', async (req, res) => {
  const custom = req.body || {};
  const v = validateCustomMap(custom);
  if (!v.ok) return res.status(400).json({ errors: v.errors });
  const id = String(custom.id || '').trim() || `custom_${Date.now()}`;
  custom.id = id;
  const file = path.join(MAPS_DIR, `${safeId(id)}.json`);
  try {
    const tmp = `${file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(custom));
    await fs.rename(tmp, file);
  } catch { return res.status(500).json({ ok: false, error: 'write failed' }); }
  registerCustomMap(custom);            // live registry: getMap/mapList/setMap see it now
  io.emit('maps_updated', mapList());   // lobbies refresh their map picker
  res.json({ ok: true, id, warnings: v.warnings });
});

app.delete('/api/maps/:id', async (req, res) => {
  const id = safeId(req.params.id);
  try { await fs.unlink(path.join(MAPS_DIR, `${id}.json`)); } catch { /* already gone */ }
  const rawId = CUSTOM_RAW.has(req.params.id) ? req.params.id : id;
  const removed = unregisterCustomMap(rawId);
  io.emit('maps_updated', mapList());
  res.json({ ok: true, removed });
});

// ---- static client (dist/) with SPA fallback -------------------------------
if (existsSync(DIST)) {
  app.use(express.static(DIST, {
    setHeaders(res, p) {
      // hashed /assets/* are immutable (safe to cache forever); index.html must NOT
      // be cached — it points at the current bundle hash, so a stale cached index
      // would keep loading OLD code after a deploy (the "my fix isn't showing up"
      // bug). no-cache forces a revalidate so every deploy is picked up immediately.
      if (p.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      else if (p.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    },
  }));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/socket.io')) return next();
    res.setHeader('Cache-Control', 'no-cache, must-revalidate'); // SPA fallback index.html — always fresh
    res.sendFile(path.join(DIST, 'index.html'));
  });
} else {
  app.get('/', (_req, res) => res.send('ARENA server up (dist/ not built yet)'));
}

// ---- boot: load persisted custom maps into the live registry ---------------
// So getMap(id)/mapList()/Game.setMap(customId) all include saved customs before
// the sim starts. Never throws on a bad file — it's just skipped.
function loadCustomMaps() {
  let n = 0;
  try {
    for (const f of readdirSync(MAPS_DIR)) {
      if (!f.endsWith('.json') || f.endsWith('.tmp')) continue;
      try {
        const custom = JSON.parse(readFileSync(path.join(MAPS_DIR, f), 'utf8'));
        if (validateCustomMap(custom).ok && registerCustomMap(custom)) n++;
      } catch { /* skip corrupt/invalid file */ }
    }
  } catch { /* dir missing → nothing to load */ }
  return n;
}
const loadedCustom = loadCustomMaps();

// ---- http + socket.io ------------------------------------------------------
const server = http.createServer(app);
const io = new SocketServer(server, { cors: { origin: '*' }, pingInterval: 10000, pingTimeout: 20000 });

const lobby = new Lobby();
const game = new Game(io, lobby);
game.stats = stats; // kill/death/accolade/win bumps happen inside the sim

// ---- SYNCED RADIO + CREW VOTING --------------------------------------------
// The radio is shared lobby state: everyone tunes the same live internet stream
// (live streams are inherently in sync). Changing the station — or the MAP when
// more than one player is online — requires a VOTE: strictly more than 50% of
// active players (floor(n/2)+1). Solo player → instant.
// Streams: SomaFM (listener-supported, free for non-commercial use — credit them).
const RADIO_STATIONS = [
  { id: 'groove',  name: 'GROOVE SALAD',  url: 'https://ice1.somafm.com/groovesalad-128-mp3' },
  { id: 'defcon',  name: 'DEF CON RADIO', url: 'https://ice1.somafm.com/defcon-128-mp3' },
  { id: 'beat',    name: 'BEAT BLENDER',  url: 'https://ice1.somafm.com/beatblender-128-mp3' },
  { id: 'space',   name: 'SPACE STATION', url: 'https://ice1.somafm.com/spacestation-128-mp3' },
  { id: 'metal',   name: 'METAL DETECTOR', url: 'https://ice1.somafm.com/metal-128-mp3' },
  { id: 'off',     name: 'RADIO OFF',     url: null },
];
let radioStation = 'off';
const votes = new Map(); // 'kind:id' -> Set(playerSocketIds)

function castVote(kind, id, player) {
  const key = `${kind}:${id}`;
  let set = votes.get(key);
  if (!set) votes.set(key, (set = new Set()));
  if (set.has(player.id)) return; // one vote per player per option
  set.add(player.id);
  const needed = Math.floor(lobby.count / 2) + 1; // strictly >50%
  io.emit('vote_update', { kind, id, votes: set.size, needed, by: player.name || player.crew?.name });
  if (set.size >= needed) {
    for (const k of [...votes.keys()]) if (k.startsWith(`${kind}:`)) votes.delete(k); // vote resolved
    if (kind === 'radio') { radioStation = id; io.emit('radio_set', { id }); }
    else if (kind === 'map') game.setMap(id);
    else if (kind === 'mode') game.setMode(id);
  }
}

io.on('connection', (socket) => {
  let player = null;

  socket.on('join', (opts = {}) => {
    if (player) return;
    if (lobby.isFull()) { socket.emit('lobby_full'); return; }
    player = lobby.addPlayer(socket.id, opts);
    player.joinedAt = Date.now();
    player.profileId = safeId(opts.profileId || opts.name || socket.id); // stats identity
    game.mode.onJoin(player); // balance onto the smaller team in team modes
    player.recordHistory(Date.now());
    socket.emit('welcome', {
      id: player.id,
      crew: player.publicInfo(),
      tickRate: TICK_RATE,
      snapRate: SNAP_RATE,
      arenaId: lobby.settings.currentMap,
      mapId: lobby.settings.currentMap,
      map: game.map.serialize(),
      // custom maps live only in the SERVER registry — ship the full server map list
      // (for the picker) + the current custom map's raw JSON so the client can
      // registerCustomMap it and render/predict it identically. Null for built-ins.
      maps: mapList(),
      mapCustom: CUSTOM_RAW.get(lobby.settings.currentMap) || null,
      mode: game.mode.serialize(Date.now()),
      modes: Object.entries(MODES).map(([id, m]) => ({ id, name: m.name, teams: m.teams })),
      radio: { stations: RADIO_STATIONS, current: radioStation },
      spawn: { pos: player.spawn.pos, yaw: player.spawn.yaw },
      players: lobby.publicList(),
    });
    socket.broadcast.emit('player_join', player.publicInfo());
    console.log(`[arena] +${player.crew.name} (${socket.id}) — ${lobby.count} online`);
  });

  socket.on('input', (cmd) => { if (player) player.queueInput(cmd); });

  socket.on('fire', (fire) => {
    if (!player || !player.alive || !fire) return;
    // viewId (if present) is the base gun for the remote viewmodel; weaponId is the
    // combat-resolution id (a dual-mode ALT sends its virtual '<id>_alt' as weaponId).
    if (fire.weaponId) player.weaponId = fire.viewId || fire.weaponId;
    const projKind = WEAPON_COMBAT[fire.weaponId]?.projectile;
    if (projKind) {
      // server-authoritative networked projectile (sawblade / rocket / mini / bolt / disc / seeker volley)
      if (fire.origin && fire.dir) game.spawnProjectile(player, projKind, fire.origin, fire.dir, WEAPON_COMBAT[fire.weaponId]);
    } else if (player.pendingShots.length < 16) {
      player.pendingShots.push(fire); // hitscan, lag-comp resolved on the tick
    }
  });

  socket.on('melee', (m) => {
    if (!player || !player.alive || !m) return;
    if (m.weaponId) player.weaponId = m.weaponId;
    if (player.pendingMelee.length < 8) player.pendingMelee.push(m); // §1C swing, lag-comp resolved on the tick
  });

  socket.on('throw', (t) => {
    if (!player || !player.alive || !t || !t.origin || !t.dir) return;
    const now = Date.now();
    if (player.grenadeCd && now < player.grenadeCd) return;
    player.grenadeCd = now + GRENADE.cooldownMs;
    game.throwGrenade(player, t.origin, t.dir);
  });

  // map/mode switches VOTE when 2+ players are online (>50% to pass); solo = instant.
  socket.on('setMap', (m) => {
    if (!player || !m || !m.id || !MAPS[m.id]) return;
    if (lobby.count <= 1) game.setMap(m.id);
    else castVote('map', m.id, player);
  });
  socket.on('setMode', (m) => {
    if (!player || !m || !m.id || !MODES[m.id]) return;
    if (lobby.count <= 1) game.setMode(m.id);
    else castVote('mode', m.id, player);
  });
  // radio: ALWAYS a vote (even solo — floor(1/2)+1 = 1 → instant for one player).
  socket.on('vote', (v) => {
    if (!player || !v || typeof v.id !== 'string') return;
    if (v.kind === 'radio' && RADIO_STATIONS.some((s) => s.id === v.id)) castVote('radio', v.id, player);
    else if (v.kind === 'map' && MAPS[v.id]) castVote('map', v.id, player);
    else if (v.kind === 'mode' && MODES[v.id]) castVote('mode', v.id, player);
  });

  socket.on('swap', (m) => { if (player && m && m.weaponId) player.weaponId = m.weaponId; });
  socket.on('reload', () => { /* ammo is client-tracked for now; server trusts fire cadence */ });

  socket.on('ping', (m) => { socket.emit('pong', { t0: m && m.t0, tServer: Date.now() }); });

  // 1E: client requests the match accolade summary (end-of-round list).
  socket.on('accolade_summary_req', () => { if (game.accolades) socket.emit('accolade_summary', game.accolades.summary()); });

  socket.on('disconnect', () => {
    if (!player) return;
    // bank this session's playtime, then flush the profile's stats to disk
    const ms = Date.now() - (player.joinedAt || Date.now());
    stats.bump(player.profileId, (s) => { s.playMs = (s.playMs || 0) + ms; });
    setTimeout(() => stats.flush(), 250);
    for (const set of votes.values()) set.delete(socket.id); // withdraw their votes
    lobby.removePlayer(socket.id);
    game.accolades?.removePlayer(socket.id);
    io.emit('player_leave', { id: socket.id });
    console.log(`[arena] -${player.crew.name} (${socket.id}) — ${lobby.count} online`);
    player = null;
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[arena] listening on :${PORT}  (dist ${existsSync(DIST) ? 'served' : 'MISSING'}, data ${DATA_DIR}, ${loadedCustom} custom map(s))`);
  game.start();
  console.log(`[arena] authoritative sim @ ${TICK_RATE}Hz started`);
});
