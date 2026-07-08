// ARENA server — Snapshots.js: build per-client snapshots. Position history for
// lag comp lives on each Player (Player.recordHistory/rewind). This module just
// assembles the wire snapshot (full-state; 2–4 players is tiny) stamped with the
// recipient's ack (their last processed input seq).
import { serializeState } from '../shared/movement-core.js';
import { Pickups } from './Pickups.js';

export function buildSnapshot(players, tick, serverTime, recipient) {
  const list = [];
  for (const p of players.values()) {
    const s = p.snap();
    // the recipient sees their OWN active powerup (+remaining) for the HUD.
    if (recipient && p.id === recipient.id) {
      const ap = Pickups.activePowerup(p, serverTime);
      if (ap) s.activePowerup = ap;
    }
    list.push(s);
  }
  return {
    tick,
    serverTime,
    ack: recipient ? recipient.lastSeq : 0,
    players: list,
  };
}

// Record every player's current transform into their history ring (for rewind).
export function recordHistory(players, now) {
  for (const p of players.values()) p.recordHistory(now);
}

export { serializeState };
