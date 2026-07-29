// ARENA server — Player: authoritative per-player state + input queue + history.
import { createMoveState, stepMovement, serializeState } from '../shared/movement-core.js';
import { HISTORY_MS, CAPSULE } from '../shared/constants.js';

const MAX_QUEUE = 240;          // ~4 s of 60 Hz inputs — drop oldest past this
const MAX_INPUTS_PER_TICK = 8;  // anti-runaway: cap catch-up per tick

export class Player {
  constructor(id, crew, spawn) {
    this.id = id;
    this.crew = crew;              // { key, name, color }
    this.spawn = spawn;
    this.move = createMoveState(spawn);
    this.inputQueue = [];          // InputCmd[]
    this.lastSeq = 0;              // ack: last processed input seq
    this.hp = 100;
    this.armor = 0;                // pickup armor pool (0..100)
    this.shield = 0;              // overshield pool (absorbs dmg before hp)
    this.dmgMult = 1;            // active damage/quad powerup multiplier
    this.speedMult = 1;         // active speed powerup multiplier (× weapon weight)
    this.buffs = null;         // { dmgExpiry, dmgKind, speedExpiry } while powerups active
    this.alive = true;
    this.weaponId = 'ar';
    this.firing = false;
    this.pendingShots = [];        // FireCmd[] queued this tick
    this.pendingMelee = [];        // MeleeCmd[] queued this tick (§1C)
    this.respawnAt = 0;
    this.history = [];             // { time, px, py, pz, yaw, height } for lag comp
    this.joinedAt = 0;
  }

  queueInput(cmd) {
    const arr = Array.isArray(cmd) ? cmd : [cmd];
    for (const c of arr) {
      if (!c || typeof c.seq !== 'number') continue;
      if (c.seq <= this.lastSeq) continue; // stale/duplicate
      this.inputQueue.push(c);
    }
    this.inputQueue.sort((a, b) => a.seq - b.seq);
    if (this.inputQueue.length > MAX_QUEUE) this.inputQueue.splice(0, this.inputQueue.length - MAX_QUEUE);
  }

  // Advance the sim by draining queued inputs in seq order (bounded per tick).
  // `world` is the map's LIVE collision world (open doors + broken walls removed,
  // platforms placed) supplied by Game each tick.
  processInputs(world) {
    if (!this.alive) { this.inputQueue.length = 0; return; }
    let n = 0;
    const boost = this.speedMult || 1; // active speed powerup (server-authoritative)
    while (this.inputQueue.length && n < MAX_INPUTS_PER_TICK) {
      const c = this.inputQueue.shift();
      const dt = Math.min(0.05, Math.max(0, (c.dtMs || 16.67) / 1000));
      // Combine the client's weapon-weight speedMult with the powerup boost so the
      // shared max-speed calc (movement-core) applies BOTH. Client doesn't predict
      // the powerup → minor reconcile pop while a speed powerup is active.
      if (boost !== 1) c.speedMult = (c.speedMult != null ? c.speedMult : 1) * boost;
      stepMovement(this.move, c, world, dt);
      this.lastSeq = c.seq;
      n++;
    }
    this.firing = this.pendingShots.length > 0;
  }

  recordHistory(now) {
    const m = this.move;
    this.history.push({ time: now, px: m.px, py: m.py, pz: m.pz, yaw: m.yaw, height: m.height });
    const cutoff = now - HISTORY_MS;
    while (this.history.length > 2 && this.history[0].time < cutoff) this.history.shift();
  }

  // Interpolated feet position at a past time (lag-comp rewind). Falls back to
  // current if history is empty or the time is outside the window.
  rewind(t) {
    const h = this.history;
    const m = this.move;
    if (h.length === 0) return { px: m.px, py: m.py, pz: m.pz, height: m.height };
    if (t >= h[h.length - 1].time) { const s = h[h.length - 1]; return { px: s.px, py: s.py, pz: s.pz, height: s.height }; }
    if (t <= h[0].time) { const s = h[0]; return { px: s.px, py: s.py, pz: s.pz, height: s.height }; }
    for (let i = h.length - 1; i > 0; i--) {
      if (h[i - 1].time <= t && t <= h[i].time) {
        const a = h[i - 1], b = h[i];
        const f = (t - a.time) / Math.max(1, b.time - a.time);
        return {
          px: a.px + (b.px - a.px) * f,
          py: a.py + (b.py - a.py) * f,
          pz: a.pz + (b.pz - a.pz) * f,
          height: a.height + (b.height - a.height) * f,
        };
      }
    }
    return { px: m.px, py: m.py, pz: m.pz, height: m.height };
  }

  respawn(spawn, now) {
    this.spawn = spawn;
    this.move = createMoveState(spawn);
    this.hp = 100;
    this.armor = 0;
    this.shield = 0;
    this.dmgMult = 1;
    this.speedMult = 1;
    this.buffs = null;
    this.alive = true;
    this.respawnAt = 0;
    this.inputQueue.length = 0;
    this.history.length = 0;
    this.recordHistory(now);
  }

  publicInfo() {
    // name prefers the explicit display name (profiles; bots get "BOT X [DIFF]")
    return { id: this.id, crew: this.crew.key, name: this.name || this.crew.name, color: this.crew.color, weaponId: this.weaponId, bot: this.isBot || undefined };
  }

  snap() {
    const st = serializeState(this.move);
    return {
      id: this.id, pos: st.pos, vel: st.vel, yaw: st.yaw, pitch: st.pitch,
      state: st.state, ground: st.ground,
      hp: this.hp, alive: this.alive, weaponId: this.weaponId, firing: this.firing,
      armor: this.armor || 0, shield: this.shield || 0,
      speedMult: this.speedMult || 1,
    };
  }
}
