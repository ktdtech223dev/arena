// ARENA server — Modes.js: the game-mode engine.
// One ModeState instance lives on Game. It owns teams, scores, the round timer,
// mode entities (CTF flags / KOTH hill / ODDBALL skull), win detection and the
// between-round reset. Serialized into every snapshot as snap.mode so clients
// render scoreboard + mode objects from authoritative state.
//
//   ffa      — free-for-all, kills score, first to the limit.
//   tdm      — two teams, team kills score.
//   ctf      — two teams, steal the enemy flag and run it home.
//   koth     — "HILL": hold the glowing zone ALONE to bank points (2–6p brawl).
//   oddball  — "SKULL": carry the skull to bank points; dying drops it.

export const MODES = {
  ffa:     { name: 'FREE-FOR-ALL', teams: false, scoreLimit: 20,  timeLimit: 480 },
  tdm:     { name: 'TEAM DEATHMATCH', teams: true, scoreLimit: 30, timeLimit: 480 },
  ctf:     { name: 'CAPTURE THE FLAG', teams: true, scoreLimit: 3, timeLimit: 600 },
  koth:    { name: 'HILL', teams: false, scoreLimit: 90,  timeLimit: 480 },
  oddball: { name: 'SKULL', teams: false, scoreLimit: 60, timeLimit: 480 },
};
export const DEFAULT_MODE = 'ffa';
export const TEAM_NAMES = ['RED', 'BLUE'];

const RESET_MS = 8000;      // round-end banner time before the next round starts
const TOUCH_R = 1.6;        // flag/skull pickup radius (m, horizontal)
const CAP_R = 2.2;          // CTF capture radius at your own base
const DROP_RETURN_MS = 20000;

export class ModeState {
  /** @param {object} game the Game (io, lobby, map, stats) */
  constructor(game, id = DEFAULT_MODE) {
    this.game = game;
    this.set(id);
  }

  get def() { return MODES[this.id] || MODES.ffa; }

  /** Switch mode (also used for round restarts). Resets everything. */
  set(id) {
    this.id = MODES[id] ? id : DEFAULT_MODE;
    this.reset();
  }

  reset() {
    const players = this.game.lobby.players;
    this.scores = {};          // playerId -> points (ffa/koth/oddball)
    this.teamScores = [0, 0];  // tdm/ctf
    this.endsAt = Date.now() + this.def.timeLimit * 1000;
    this.ended = null;         // { winner, winnerTeam, at } once decided
    this._restartAt = 0;
    this._accum = new Map();   // playerId -> fractional zone/carry seconds
    if (this.def.teams) { let i = 0; for (const p of players.values()) { p.team = i++ % 2; } }
    else for (const p of players.values()) p.team = null;
    this._buildEntities();
  }

  /** Balance a newly joined player onto the smaller team (team modes only). */
  onJoin(p) {
    if (!this.def.teams) { p.team = null; return; }
    let c0 = 0, c1 = 0;
    for (const q of this.game.lobby.players.values()) { if (q === p) continue; if (q.team === 0) c0++; else if (q.team === 1) c1++; }
    p.team = c0 <= c1 ? 0 : 1;
  }

  _buildEntities() {
    const map = this.game.map.map;
    const spawns = map.spawns || [];
    const centroid = { x: 0, y: 1, z: 0 };
    if (spawns.length) {
      let sx = 0, sy = 0, sz = 0;
      for (const s of spawns) { sx += s.pos.x; sy += s.pos.y; sz += s.pos.z; }
      centroid.x = sx / spawns.length; centroid.y = sy / spawns.length; centroid.z = sz / spawns.length;
    }
    this.zone = null; this.flags = null; this.orb = null;
    if (this.id === 'koth') {
      this.zone = {
        min: { x: centroid.x - 4, y: centroid.y - 2.5, z: centroid.z - 4 },
        max: { x: centroid.x + 4, y: centroid.y + 3.5, z: centroid.z + 4 },
        occ: null, // sole occupant id (for HUD tint)
      };
    } else if (this.id === 'oddball') {
      this.orbHome = { x: centroid.x, y: centroid.y + 0.8, z: centroid.z };
      this.orb = { x: this.orbHome.x, y: this.orbHome.y, z: this.orbHome.z, carrier: null, droppedAt: 0 };
    } else if (this.id === 'ctf') {
      // bases = the two spawns farthest apart
      let bi = 0, bj = spawns.length > 1 ? 1 : 0, best = -1;
      for (let i = 0; i < spawns.length; i++) for (let j = i + 1; j < spawns.length; j++) {
        const a = spawns[i].pos, b = spawns[j].pos;
        const d = (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
        if (d > best) { best = d; bi = i; bj = j; }
      }
      const mk = (sp, team) => ({ team, base: { x: sp.pos.x, y: sp.pos.y + 0.2, z: sp.pos.z }, x: sp.pos.x, y: sp.pos.y + 0.2, z: sp.pos.z, state: 'base', carrier: null, returnAt: 0 });
      this.flags = spawns.length ? [mk(spawns[bi], 0), mk(spawns[bj], 1)] : null;
    }
  }

  /** True → the sim must ignore this damage (same-team fire in team modes). */
  blocksDamage(attackerId, victimId) {
    if (!this.def.teams || attackerId === victimId) return false;
    const a = this.game.lobby.players.get(attackerId), v = this.game.lobby.players.get(victimId);
    return !!(a && v && a.team != null && a.team === v.team);
  }

  onKill(killerId, victimId) {
    if (this.ended) return;
    if (this.id === 'ffa') this._score(killerId, 1);
    else if (this.id === 'tdm') {
      const k = this.game.lobby.players.get(killerId);
      if (k && k.team != null) { this.teamScores[k.team] += 1; this._checkTeamWin(); }
    }
    // koth/oddball/ctf: kills don't score directly.
    // oddball/ctf carrier death handling happens in step() (alive checks).
  }

  _score(pid, n) {
    this.scores[pid] = (this.scores[pid] || 0) + n;
    if (this.scores[pid] >= this.def.scoreLimit) this._end({ winner: pid });
  }

  _checkTeamWin() {
    for (const t of [0, 1]) if (this.teamScores[t] >= this.def.scoreLimit) this._end({ winnerTeam: t });
  }

  step(dt, now, players) {
    if (this.ended) {
      if (this._restartAt && now >= this._restartAt) this._restartRound();
      return;
    }
    // ---- round timer ----
    if (now >= this.endsAt) { this._endByScore(); return; }

    // ---- KOTH: sole occupant banks time ----
    if (this.zone) {
      const z = this.zone;
      const inside = [];
      for (const p of players.values()) {
        if (!p.alive) continue;
        const m = p.move;
        if (m.px > z.min.x && m.px < z.max.x && m.pz > z.min.z && m.pz < z.max.z && m.py > z.min.y && m.py < z.max.y) inside.push(p);
      }
      z.occ = inside.length === 1 ? inside[0].id : null;
      if (z.occ) {
        const acc = (this._accum.get(z.occ) || 0) + dt;
        if (acc >= 1) { this._score(z.occ, Math.floor(acc)); this._accum.set(z.occ, acc % 1); }
        else this._accum.set(z.occ, acc);
      }
    }

    // ---- ODDBALL: carry to bank, drop on death ----
    if (this.orb) {
      const o = this.orb;
      if (o.carrier) {
        const c = players.get(o.carrier);
        if (!c || !c.alive) { // dropped
          if (c) { o.x = c.move.px; o.y = c.move.py + 0.6; o.z = c.move.pz; }
          o.carrier = null; o.droppedAt = now;
        } else {
          o.x = c.move.px; o.y = c.move.py + 1.2; o.z = c.move.pz;
          const acc = (this._accum.get(o.carrier) || 0) + dt;
          if (acc >= 1) { this._score(o.carrier, Math.floor(acc)); this._accum.set(o.carrier, acc % 1); }
          else this._accum.set(o.carrier, acc);
        }
      } else {
        // uncarried: pickup on touch; auto-home if it sat dropped too long
        if (o.droppedAt && now - o.droppedAt > DROP_RETURN_MS) { Object.assign(o, { ...this.orbHome, carrier: null, droppedAt: 0 }); }
        for (const p of players.values()) {
          if (!p.alive) continue;
          const dx = p.move.px - o.x, dz = p.move.pz - o.z;
          if (dx * dx + dz * dz <= TOUCH_R * TOUCH_R && Math.abs(p.move.py - o.y) < 2.5) { o.carrier = p.id; break; }
        }
      }
    }

    // ---- CTF ----
    if (this.flags) {
      for (const f of this.flags) {
        if (f.state === 'carried') {
          const c = players.get(f.carrier);
          if (!c || !c.alive) { // carrier died/left → drop here
            if (c) { f.x = c.move.px; f.y = c.move.py + 0.4; f.z = c.move.pz; }
            f.state = 'dropped'; f.carrier = null; f.returnAt = now + DROP_RETURN_MS;
            continue;
          }
          f.x = c.move.px; f.y = c.move.py + 1.6; f.z = c.move.pz;
          // capture: carrier reaches OWN base while own flag is home
          const own = this.flags[c.team];
          const dx = c.move.px - own.base.x, dz = c.move.pz - own.base.z;
          if (own.state === 'base' && dx * dx + dz * dz <= CAP_R * CAP_R) {
            this.teamScores[c.team] += 1;
            Object.assign(f, { x: f.base.x, y: f.base.y, z: f.base.z, state: 'base', carrier: null });
            this.game.io.emit('mode_event', { kind: 'capture', team: c.team, by: c.id });
            this._checkTeamWin();
          }
        } else {
          if (f.state === 'dropped' && now >= f.returnAt) Object.assign(f, { x: f.base.x, y: f.base.y, z: f.base.z, state: 'base', carrier: null });
          for (const p of players.values()) {
            if (!p.alive || p.team == null) continue;
            const dx = p.move.px - f.x, dz = p.move.pz - f.z;
            if (dx * dx + dz * dz > TOUCH_R * TOUCH_R || Math.abs(p.move.py - f.y) > 2.5) continue;
            if (p.team !== f.team) { f.state = 'carried'; f.carrier = p.id; break; } // steal
            if (p.team === f.team && f.state === 'dropped') { Object.assign(f, { x: f.base.x, y: f.base.y, z: f.base.z, state: 'base', carrier: null }); break; } // return
          }
        }
      }
    }
  }

  _endByScore() {
    if (this.def.teams) {
      const t = this.teamScores[0] === this.teamScores[1] ? null : (this.teamScores[0] > this.teamScores[1] ? 0 : 1);
      this._end({ winnerTeam: t });
    } else {
      let best = null, bestS = -1;
      for (const [pid, s] of Object.entries(this.scores)) if (s > bestS) { bestS = s; best = pid; }
      this._end({ winner: best });
    }
  }

  _end({ winner = null, winnerTeam = null }) {
    if (this.ended) return;
    const now = Date.now();
    this.ended = { winner, winnerTeam, at: now };
    this._restartAt = now + RESET_MS;
    const g = this.game;
    const winnerName = winner ? (g.lobby.players.get(winner)?.name || g.lobby.players.get(winner)?.crew?.name || 'PLAYER') : null;
    g.io.emit('round_end', {
      mode: this.id, winner, winnerName,
      winnerTeam, teamName: winnerTeam != null ? TEAM_NAMES[winnerTeam] : null,
      scores: this.scores, teamScores: this.teamScores, restartInMs: RESET_MS,
    });
    // persistent WINS for the winner(s)
    if (g.stats) {
      const ids = [];
      if (winner) ids.push(winner);
      else if (winnerTeam != null) for (const p of g.lobby.players.values()) if (p.team === winnerTeam) ids.push(p.id);
      for (const id of ids) { const p = g.lobby.players.get(id); if (p) g.stats.bump(p.profileId, (s) => { s.wins = (s.wins || 0) + 1; }); }
    }
  }

  _restartRound() {
    const g = this.game;
    this.reset();
    // fresh field: respawn everyone at far spawns, full hp, reset streaks
    const now = Date.now();
    for (const p of g.lobby.players.values()) {
      const spawn = g.lobby.farSpawn();
      p.respawn(spawn, now);
      p.killStreak = 0;
      g.io.emit('respawn', { id: p.id, pos: spawn.pos, yaw: spawn.yaw });
    }
    g.pickups.load(g.map.map);
    g.io.emit('mode_change', this.serialize(now));
  }

  serialize(now) {
    const s = {
      id: this.id, name: this.def.name, teams: this.def.teams,
      limit: this.def.scoreLimit,
      timeLeft: Math.max(0, Math.round(((this.ended ? this.ended.at : this.endsAt) - now) / 1000)),
      scores: this.scores, teamScores: this.teamScores,
      teamOf: {}, ended: !!this.ended,
    };
    for (const p of this.game.lobby.players.values()) if (p.team != null) s.teamOf[p.id] = p.team;
    if (this.zone) s.zone = { min: this.zone.min, max: this.zone.max, occ: this.zone.occ };
    if (this.orb) s.orb = { x: +this.orb.x.toFixed(2), y: +this.orb.y.toFixed(2), z: +this.orb.z.toFixed(2), carrier: this.orb.carrier };
    if (this.flags) s.flags = this.flags.map((f) => ({ team: f.team, x: +f.x.toFixed(2), y: +f.y.toFixed(2), z: +f.z.toFixed(2), state: f.state, carrier: f.carrier, base: f.base }));
    return s;
  }
}
