// ARENA server — Lobby.js: THE one always-up room. Players join immediately on
// connect (no codes/invites/host). Assigns crew identity + spawn. Holds room
// settings incl. currentMap (map rotation STUBBED — not implemented). This is
// the always-on N Games lobby foundation; match/scoring/pickups bolt on here.
import { CREW, MAX_PLAYERS } from '../shared/constants.js';
import { getMap, DEFAULT_MAP } from '../shared/maps.js';
import { Player } from './Player.js';

export class Lobby {
  constructor() {
    this.players = new Map();          // socketId -> Player
    this.settings = { currentMap: DEFAULT_MAP };
    this._spawnCursor = 0;
    this._usedCrews = new Set();
  }

  get spawnPoints() { return getMap(this.settings.currentMap).spawns; }

  get count() { return this.players.size; }
  isFull() { return this.players.size >= MAX_PLAYERS; }

  _pickCrew(preferred) {
    if (preferred) {
      const c = CREW.find((x) => x.key === preferred);
      if (c && !this._usedCrews.has(c.key)) return c;
    }
    for (const c of CREW) if (!this._usedCrews.has(c.key)) return c;
    return CREW[this.players.size % CREW.length]; // overflow: reuse (shouldn't happen ≤6)
  }

  _pickSpawn() {
    const sp = this.spawnPoints;
    const s = sp[this._spawnCursor % sp.length];
    this._spawnCursor++;
    return { pos: { ...s.pos }, yaw: s.yaw };
  }

  // Furthest spawn from all live players (used for respawns so you don't drop
  // in someone's face).
  farSpawn() {
    const sp = this.spawnPoints;
    let best = sp[0], bestScore = -Infinity;
    for (const s of sp) {
      let score = Infinity;
      for (const p of this.players.values()) {
        if (!p.alive) continue;
        const dx = p.move.px - s.pos.x, dz = p.move.pz - s.pos.z;
        score = Math.min(score, dx * dx + dz * dz);
      }
      if (score > bestScore) { bestScore = score; best = s; }
    }
    return { pos: { ...best.pos }, yaw: best.yaw };
  }

  addPlayer(socketId, opts = {}) {
    const crew = this._pickCrew(opts.preferredCrew);
    this._usedCrews.add(crew.key);
    const spawn = this._pickSpawn();
    const p = new Player(socketId, crew, spawn);
    p.name = opts.name || crew.name;
    this.players.set(socketId, p);
    return p;
  }

  removePlayer(socketId) {
    const p = this.players.get(socketId);
    if (p) this._usedCrews.delete(p.crew.key);
    this.players.delete(socketId);
    return p;
  }

  publicList() {
    return [...this.players.values()].map((p) => p.publicInfo());
  }
}
