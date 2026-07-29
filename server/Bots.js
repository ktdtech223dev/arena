// ARENA server — Bots.js: server-side bots that play like PLAYERS.
// A bot is a real lobby Player driven by a controller that synthesizes InputCmds
// through the SAME shared movement core the clients use — so bots wallrun-era
// physics, acceleration, jumps and collisions are player-identical by
// construction (no teleporting, no scripted paths).
//
// NAVIGATION: a coarse walkability grid is probed from the map's live collision
// world (2 m cells, step/jump-connect ≤1.1 m rise). Bots A* between random
// points of interest (pickups, spawns, random nodes) with per-bot jitter — so
// movement reads organic, not railed.
//
// COMBAT: line-of-sight (segment vs world AABBs) + a difficulty profile:
// reaction delay, gaussian-ish aim error that settles while tracking, burst
// cadence, strafe/jump usage, and movement pace. MASTER mimics a player who has
// mastered the movement (fast, strafing, jumpy) with GOOD-but-not-perfect aim.
import { BTN, WEAPON_COMBAT } from '../shared/constants.js';

const DIFFICULTIES = {
  easy:   { label: 'EASY',   reactionMs: 650, aimErr: 7.0, aimSettle: 0.75, burst: [2, 4],  gapMs: [650, 1150], strafe: 0.30, jump: 0.05, pace: 0.65, engageR: 38 },
  normal: { label: 'NORMAL', reactionMs: 420, aimErr: 4.0, aimSettle: 0.65, burst: [3, 6],  gapMs: [420, 820],  strafe: 0.60, jump: 0.15, pace: 0.85, engageR: 48 },
  hard:   { label: 'HARD',   reactionMs: 260, aimErr: 2.2, aimSettle: 0.55, burst: [4, 8],  gapMs: [260, 560],  strafe: 0.85, jump: 0.30, pace: 1.0,  engageR: 58 },
  master: { label: 'MASTER', reactionMs: 150, aimErr: 1.1, aimSettle: 0.45, burst: [5, 10], gapMs: [190, 420],  strafe: 1.0,  jump: 0.45, pace: 1.0,  engageR: 70 },
};
const BOT_NAMES = ['ROOK', 'JINX', 'HAVOC', 'PIXEL', 'STATIC', 'MOSS', 'VOLT', 'ONYX'];
const BOT_GUNS = ['ar', 'smg', 'shotgun', 'dmr', 'pistol', 'burst'];
const CELL = 2;

// segment (a→b) vs AABB slab test — LOS blocker check.
function segHitsBox(ax, ay, az, bx, by, bz, box) {
  let tmin = 0, tmax = 1;
  const d = [bx - ax, by - ay, bz - az];
  const mn = [box.min.x, box.min.y, box.min.z], mx = [box.max.x, box.max.y, box.max.z];
  const o = [ax, ay, az];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) { if (o[i] < mn[i] || o[i] > mx[i]) return false; continue; }
    let t1 = (mn[i] - o[i]) / d[i], t2 = (mx[i] - o[i]) / d[i];
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
class NavGrid {
  constructor(map, world) {
    this.nodes = new Map(); // "ix,iz" -> {x,y,z,ix,iz}
    this.list = [];
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const s of world.aabbs) {
      if (s.max.y < -10 || (s.max.x - s.min.x) > 120) continue;
      minX = Math.min(minX, s.min.x); maxX = Math.max(maxX, s.max.x);
      minZ = Math.min(minZ, s.min.z); maxZ = Math.max(maxZ, s.max.z);
    }
    if (!isFinite(minX)) return;
    const floorAt = (x, z) => {
      let best = null;
      for (const s of world.aabbs) { if (s.max.y < -10) continue; if (x >= s.min.x && x <= s.max.x && z >= s.min.z && z <= s.max.z && (best === null || s.max.y > best)) best = s.max.y; }
      for (const r of world.ramps) { if (x >= r.min.x && x <= r.max.x && z >= r.min.z && z <= r.max.z) { const t = r.axis === 'x' ? (x - r.min.x) / (r.max.x - r.min.x) : (z - r.min.z) / (r.max.z - r.min.z); const top = r.h0 + (r.h1 - r.h0) * t; if (best === null || top > best) best = top; } }
      return best;
    };
    for (let x = minX + 1, ix = 0; x < maxX; x += CELL, ix++) {
      for (let z = minZ + 1, iz = 0; z < maxZ; z += CELL, iz++) {
        const f = floorAt(x, z);
        if (f === null || f < -10) continue;
        // headroom: skip cells buried under a solid (crude: a solid whose bottom is between floor+0.3 and floor+1.7)
        let buried = false;
        for (const s of world.aabbs) {
          if (s.max.y < -10) continue;
          if (x >= s.min.x && x <= s.max.x && z >= s.min.z && z <= s.max.z && s.min.y > f + 0.3 && s.min.y < f + 1.7) { buried = true; break; }
        }
        if (buried) continue;
        const n = { x, y: f, z, ix, iz, key: ix + ',' + iz };
        this.nodes.set(n.key, n);
        this.list.push(n);
      }
    }
  }

  neighbors(n) {
    const out = [];
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      if (!dx && !dz) continue;
      const m = this.nodes.get((n.ix + dx) + ',' + (n.iz + dz));
      if (m && Math.abs(m.y - n.y) <= 1.1) out.push(m);
    }
    return out;
  }

  nearest(x, z) {
    let best = null, bd = Infinity;
    for (const n of this.list) { const d = (n.x - x) ** 2 + (n.z - z) ** 2; if (d < bd) { bd = d; best = n; } }
    return best;
  }

  random() { return this.list.length ? this.list[(Math.random() * this.list.length) | 0] : null; }

  path(from, to) {
    if (!from || !to) return null;
    const open = [{ n: from, g: 0, f: 0, p: null }];
    const seen = new Map([[from.key, open[0]]]);
    let iter = 0;
    while (open.length && iter++ < 4000) {
      open.sort((a, b) => a.f - b.f);
      const cur = open.shift();
      if (cur.n === to) {
        const path = [];
        for (let c = cur; c; c = c.p) path.unshift(c.n);
        return path;
      }
      for (const nb of this.neighbors(cur.n)) {
        const g = cur.g + Math.hypot(nb.x - cur.n.x, nb.z - cur.n.z) + Math.max(0, nb.y - cur.n.y) * 2;
        const ex = seen.get(nb.key);
        if (ex && ex.g <= g) continue;
        const rec = { n: nb, g, f: g + Math.hypot(to.x - nb.x, to.z - nb.z), p: cur };
        seen.set(nb.key, rec);
        open.push(rec);
      }
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
class BotController {
  constructor(player, diff, grid, game) {
    this.p = player;
    this.diff = DIFFICULTIES[diff] || DIFFICULTIES.normal;
    this.diffId = DIFFICULTIES[diff] ? diff : 'normal';
    this.grid = grid;
    this.game = game;
    this.path = null; this.pathIdx = 0;
    this.repathAt = 0;
    this.target = null; this.sawTargetAt = 0; this.reactAt = 0;
    this.trackTime = 0;
    this.burstLeft = 0; this.nextShotAt = 0; this.nextBurstAt = 0;
    this.strafeDir = 1; this.strafeFlipAt = 0;
    this.seq = 1;
    this.p.weaponId = BOT_GUNS[(Math.random() * BOT_GUNS.length) | 0];
  }

  step(now, world, players) {
    const p = this.p;
    if (!p.alive) { this.path = null; this.target = null; return; }
    const m = p.move;
    const d = this.diff;

    // ---- acquire / validate a combat target -------------------------------
    let best = null, bd = Infinity;
    for (const q of players.values()) {
      if (q === p || !q.alive) continue;
      if (p.team != null && q.team === p.team) continue; // teammate
      const dx = q.move.px - m.px, dz = q.move.pz - m.pz;
      const dist2 = dx * dx + dz * dz;
      if (dist2 > d.engageR * d.engageR || dist2 >= bd) continue;
      if (this._los(m, q.move, world)) { best = q; bd = dist2; }
    }
    if (best && best !== this.target) { this.target = best; this.reactAt = now + d.reactionMs * (0.7 + Math.random() * 0.6); this.trackTime = 0; }
    if (!best && this.target && now - this.sawTargetAt > 2000) this.target = null;
    if (best) this.sawTargetAt = now;

    // ---- movement ----------------------------------------------------------
    let yaw = m.yaw, f = 0, r = 0, buttons = 0;
    const dt = 1 / 16; // controller thinks at ~16 Hz equivalents for randomness pacing

    if (this.target && now >= this.reactAt) {
      // ENGAGE: face target, strafe, sometimes jump, fire bursts
      this.trackTime += dt;
      const t = this.target.move;
      const dx = t.px - m.px, dz = t.pz - m.pz;
      yaw = Math.atan2(-dx, -dz) * 180 / Math.PI;
      // strafe dance (randomized flips)
      if (Math.random() < d.strafe) {
        if (now >= this.strafeFlipAt) { this.strafeDir = Math.random() < 0.5 ? -1 : 1; this.strafeFlipAt = now + 400 + Math.random() * 900; }
        r = this.strafeDir;
        f = Math.random() < 0.35 ? (Math.random() < 0.5 ? 0.4 : -0.4) : 0.15;
      }
      if (Math.random() < d.jump * 0.08) buttons |= BTN.JUMP;
      this._combat(now, world);
    } else {
      // ROAM: follow the path with jitter; repath on arrival/timeout
      if (!this.path || this.pathIdx >= this.path.length || now >= this.repathAt) this._repath(now, players);
      const wp = this.path && this.path[this.pathIdx];
      if (wp) {
        const dx = wp.x - m.px, dz = wp.z - m.pz;
        const dist = Math.hypot(dx, dz);
        if (dist < 1.2) this.pathIdx++;
        else {
          yaw = Math.atan2(-dx, -dz) * 180 / Math.PI + (Math.random() - 0.5) * 6; // organic wobble
          f = d.pace;
          if (wp.y > m.py + 0.5 && dist < 3.2) buttons |= BTN.JUMP;    // hop up ledges
          if (Math.random() < 0.01) buttons |= BTN.JUMP;               // playful bounce
          if (Math.random() < 0.02) r = Math.random() < 0.5 ? -0.5 : 0.5;
        }
      }
    }

    p.queueInput({ seq: this.seq++, dtMs: 1000 / 128, move: { f, r }, look: { yaw, pitch: 0 }, buttons });
  }

  _repath(now, players) {
    this.repathAt = now + 9000 + Math.random() * 7000;
    const from = this.grid.nearest(this.p.move.px, this.p.move.pz);
    // POI: a pickup (60%), else a random node — with jitter so routes vary
    let goal = null;
    const picks = this.game.pickups?.list || [];
    if (picks.length && Math.random() < 0.6) {
      const pk = picks[(Math.random() * picks.length) | 0];
      goal = this.grid.nearest(pk.pos.x, pk.pos.z);
    }
    if (!goal) goal = this.grid.random();
    this.path = this.grid.path(from, goal);
    this.pathIdx = 0;
  }

  _combat(now, world) {
    const d = this.diff;
    if (this.burstLeft <= 0 && now >= this.nextBurstAt) {
      this.burstLeft = d.burst[0] + ((Math.random() * (d.burst[1] - d.burst[0])) | 0);
      this.nextBurstAt = now + d.gapMs[0] + Math.random() * (d.gapMs[1] - d.gapMs[0]);
    }
    if (this.burstLeft > 0 && now >= this.nextShotAt && this.target) {
      this.burstLeft--;
      this.nextShotAt = now + 90 + Math.random() * 60; // ~8-10 rps inside a burst
      const m = this.p.move, t = this.target.move;
      // aim at chest with LEAD + settling gaussian-ish error
      const settle = Math.max(d.aimSettle, 1 - this.trackTime * 0.5);
      const err = d.aimErr * settle;
      const lead = 0.09 * (1 + (Math.random() - 0.5) * 0.6);
      const ax = t.px + (t.vx || 0) * lead - m.px;
      const ay = (t.py + 1.1) + (t.vy || 0) * lead * 0.5 - (m.py + 1.6);
      const az = t.pz + (t.vz || 0) * lead - m.pz;
      const L = Math.hypot(ax, ay, az) || 1;
      let dir = { x: ax / L, y: ay / L, z: az / L };
      // jitter the direction inside an err-degree cone (two gaussian-ish rolls)
      const j = (err * Math.PI / 180);
      const g = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5; // ~gaussian [-1,1]
      dir = this._deflect(dir, g() * j, g() * j);
      if (this.p.pendingShots.length < 4) {
        this.p.pendingShots.push({
          seq: this.seq, fireTime: now,
          weaponId: this.p.weaponId,
          origin: { x: m.px, y: m.py + 1.6, z: m.pz },
          dir,
        });
      }
    }
  }

  _deflect(d, a1, a2) {
    // rotate dir by a1 around the world-up cross, a2 around the horizontal cross
    let rx = -d.z, rz = d.x; // right (approx)
    const rl = Math.hypot(rx, rz) || 1; rx /= rl; rz /= rl;
    let x = d.x + rx * a1, y = d.y + a2, z = d.z + rz * a1;
    const L = Math.hypot(x, y, z) || 1;
    return { x: x / L, y: y / L, z: z / L };
  }

  _los(a, b, world) {
    const ax = a.px, ay = a.py + 1.6, az = a.pz;
    const bx = b.px, by = b.py + 1.1, bz = b.pz;
    for (const box of world.aabbs) {
      if (box.max.y < -10) continue;
      if (segHitsBox(ax, ay, az, bx, by, bz, box)) return false;
    }
    return true;
  }
}

// ---------------------------------------------------------------------------
export class BotManager {
  constructor(game) {
    this.game = game;
    this.bots = new Map(); // playerId -> BotController
    this._grid = null; this._gridMapId = null;
    this._n = 0;
  }

  _ensureGrid() {
    const id = this.game.map.mapId;
    if (this._grid && this._gridMapId === id) return this._grid;
    this._grid = new NavGrid(this.game.map.map, this.game.map.liveWorld(0));
    this._gridMapId = id;
    return this._grid;
  }

  add(difficulty = 'normal') {
    const g = this.game;
    if (g.lobby.isFull()) return null;
    const diff = DIFFICULTIES[difficulty] ? difficulty : 'normal';
    const id = 'bot_' + (++this._n) + '_' + Math.random().toString(36).slice(2, 6);
    const p = g.lobby.addPlayer(id, { name: `BOT ${BOT_NAMES[(this._n - 1) % BOT_NAMES.length]} [${DIFFICULTIES[diff].label}]` });
    p.isBot = true;
    p.profileId = null; // bots never touch persistent stats
    g.mode.onJoin(p);
    this.bots.set(id, new BotController(p, diff, this._ensureGrid(), g));
    g.io.emit('player_join', p.publicInfo());
    return p;
  }

  remove() {
    const last = [...this.bots.keys()].pop();
    if (!last) return false;
    this.bots.delete(last);
    this.game.lobby.removePlayer(last);
    this.game.io.emit('player_leave', { id: last });
    return true;
  }

  removeAll() { while (this.remove()) { /* drain */ } }
  get count() { return this.bots.size; }

  /** Per-tick think (cheap: bots think every other tick). */
  step(now, world) {
    if (!this.bots.size) return;
    this._ensureGrid();
    const players = this.game.lobby.players;
    for (const [id, c] of this.bots) {
      if (!players.has(id)) { this.bots.delete(id); continue; } // externally removed
      c.grid = this._grid;
      c.step(now, world, players);
    }
  }
}
