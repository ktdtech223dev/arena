// ARENA server — Accolades.js: server-authoritative kill-accolade engine.
// The server owns kills, so it owns medals. On each confirmed kill it evaluates
// which accolades fire from the ATTACKER'S authoritative state (movement fsm +
// velocity), the shot distance, the weapon, kill timing (multikills), and live
// streaks, then emits an 'accolade' event to the attacker and tracks per-match
// counts for the end-of-round summary. Movement-flavored medals (midair / wall-
// run / slide / in-motion / trickshot) are the priority — they reward the game's
// Titanfall-style movement. Pure logic; deterministic; headless.

// escalating multikill tiers (kills within cfg.multiWindowMs)
const TIERS_MULTI = [
  { n: 2, id: 'double', name: 'DOUBLE KILL' },
  { n: 3, id: 'triple', name: 'TRIPLE KILL' },
  { n: 4, id: 'quad', name: 'QUAD KILL' },
  { n: 5, id: 'penta', name: 'PENTA KILL' },
];
// escalating killstreak tiers (kills while alive)
const TIERS_STREAK = [
  { n: 3, id: 'streak3', name: 'KILLING SPREE' },
  { n: 5, id: 'streak5', name: 'RAMPAGE' },
  { n: 7, id: 'streak7', name: 'DOMINATING' },
  { n: 10, id: 'streak10', name: 'UNSTOPPABLE' },
];

const DEFAULTS = {
  multiWindowMs: 4000,   // window in which sequential kills chain a multikill
  longshotDist: 45,      // kill at/beyond this range (m) = LONGSHOT
  fastSpeed: 9,          // horizontal speed (m/s) at/above which a kill is IN MOTION
  trickshotDist: 28,     // midair kill at/beyond this range = TRICKSHOT (else MIDAIR)
};

export class Accolades {
  constructor(io, lobby, config = {}) {
    this.io = io;
    this.lobby = lobby;
    this.cfg = { ...DEFAULTS, ...config };
    this.state = new Map();   // playerId -> { streak, recent:[times], lastKillerId, counts:{} }
    this._firstBlood = false;
  }

  _st(id) {
    let s = this.state.get(id);
    if (!s) { s = { streak: 0, recent: [], lastKillerId: null, counts: {} }; this.state.set(id, s); }
    return s;
  }

  resetMatch() { this.state.clear(); this._firstBlood = false; }
  removePlayer(id) { this.state.delete(id); }

  // Record a death so the victim's streak resets and we can award REVENGE later.
  onDeath(victimId, killerId) {
    const v = this._st(victimId);
    v.streak = 0;
    v.recent = [];
    v.lastKillerId = (killerId && killerId !== victimId && killerId !== 'world') ? killerId : v.lastKillerId;
  }

  // Called on every confirmed KILL. `attacker`/`victim` are Player objects; meta =
  // { weapon, part, dist, now }. Returns the awarded list (also emitted to the
  // attacker). Suicides/world kills award nothing.
  onKill(attacker, victim, meta) {
    if (!attacker || !victim || attacker.id === victim.id) return [];
    const a = this._st(attacker.id);
    const now = meta.now || 0;
    const awards = [];
    const add = (id, name, opts = {}) => {
      awards.push({ id, name, movement: !!opts.movement });
      a.counts[id] = (a.counts[id] || 0) + 1;
    };

    // FIRST BLOOD — first kill of the match
    if (!this._firstBlood) { this._firstBlood = true; add('firstblood', 'FIRST BLOOD'); }

    // MULTIKILL — kills chained inside the window
    a.recent = a.recent.filter((t) => now - t <= this.cfg.multiWindowMs);
    a.recent.push(now);
    const mk = a.recent.length;
    if (mk >= 2) {
      const tier = TIERS_MULTI.find((t) => t.n === mk);
      if (tier) add(tier.id, tier.name);
      else if (mk > 5) add('penta', `${mk}× MULTIKILL`);
    }

    // KILLSTREAK — escalating tiers while alive
    a.streak++;
    const st = TIERS_STREAK.find((t) => t.n === a.streak);
    if (st) add(st.id, st.name);

    // REVENGE — killed the player who last killed you
    if (a.lastKillerId && a.lastKillerId === victim.id) { add('revenge', 'REVENGE'); a.lastKillerId = null; }

    // HEADSHOT / LONGSHOT
    if (meta.part === 'head') add('headshot', 'HEADSHOT');
    if ((meta.dist || 0) >= this.cfg.longshotDist) add('longshot', 'LONGSHOT');

    // MELEE — knife / bat kills
    if (meta.weapon === 'knife') add('knife', 'KNIFE KILL');
    else if (meta.weapon === 'bat') add('bat', 'HAMMER BLOW');

    // MOVEMENT-flavored (priority) — read the attacker's authoritative move state
    const m = attacker.move || {};
    const speed = Math.hypot(m.vx || 0, m.vz || 0);
    const wallrun = m.state === 'WALLRUN';
    const sliding = m.state === 'SLIDING';
    const airborne = m.state === 'AIRBORNE' || (!m.grounded && !wallrun && !sliding);
    if (wallrun) add('wallrun', 'WALL-RUN KILL', { movement: true });
    else if (sliding) add('slide', 'SLIDE KILL', { movement: true });
    else if (airborne) {
      if ((meta.dist || 0) >= this.cfg.trickshotDist) add('trickshot', 'TRICKSHOT', { movement: true });
      else add('midair', 'MIDAIR KILL', { movement: true });
    }
    if (speed >= this.cfg.fastSpeed && !wallrun && !sliding && !airborne) add('inmotion', 'IN MOTION', { movement: true });

    if (awards.length) {
      this.io.to(attacker.id).emit('accolade', { awards, streak: a.streak, multi: mk });
    }
    return awards;
  }

  // End-of-round summary: per-player accolade counts + total (for a summary list).
  summary() {
    const out = [];
    for (const [id, s] of this.state) {
      const total = Object.values(s.counts).reduce((x, y) => x + y, 0);
      const pl = this.lobby.players.get(id);
      out.push({ id, name: pl?.crew?.name || '???', color: pl?.crew?.color || 0x8899aa, counts: { ...s.counts }, streak: s.streak, total });
    }
    out.sort((a, b) => b.total - a.total);
    return out;
  }
}
