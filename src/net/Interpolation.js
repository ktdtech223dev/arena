// ARENA client — net/Interpolation.js
// Entity interpolation for REMOTE players. Buffers authoritative snapshots and
// renders every remote at (serverNow - INTERP_DELAY_MS), interpolating between
// the two bracketing snapshots so remote motion is smooth despite jittery net
// timing. Brief capped extrapolation if a snapshot is late. Spawns/despawns
// RemotePlayer avatars on join/leave.
import { INTERP_DELAY_MS, EXTRAP_MAX_MS } from '../../shared/constants.js';
import { RemotePlayer } from '../entities/RemotePlayer.js';

function angLerp(a, b, t) {
  let d = ((b - a + 540) % 360) - 180; // shortest signed delta in degrees
  return a + d * t;
}

export class Interpolation {
  constructor(ctx, connection) {
    this.ctx = ctx;
    this.conn = connection;
    this.remotes = new Map();     // id -> RemotePlayer
    this.buffer = [];             // [{ serverTime, byId: Map<id,SnapPlayer> }]
    this.interpMs = INTERP_DELAY_MS;
  }

  spawnRemote(info) {
    if (info.id === this.conn.id || this.remotes.has(info.id)) return;
    this.remotes.set(info.id, new RemotePlayer(this.ctx, info));
  }
  despawnRemote(id) {
    const rp = this.remotes.get(id);
    if (rp) { rp.dispose(); this.remotes.delete(id); }
  }

  onWelcome(w) {
    this.despawnRemote(this.conn.id); // clean up any self-remote spawned pre-id
    for (const p of w.players || []) this.spawnRemote(p);
  }

  onSnapshot(snap) {
    const byId = new Map();
    for (const p of snap.players) byId.set(p.id, p);
    this.buffer.push({ serverTime: snap.serverTime, byId });
    if (this.buffer.length > 128) this.buffer.shift();
    // prune anything older than 2 s
    const cutoff = snap.serverTime - 2000;
    while (this.buffer.length > 2 && this.buffer[0].serverTime < cutoff) this.buffer.shift();

    // spawn/despawn fallback (in case a join/leave event was missed). Don't run
    // until we know our own id, or we'd spawn a remote for ourselves.
    if (!this.conn.id) return;
    for (const id of byId.keys()) if (id !== this.conn.id && !this.remotes.has(id)) {
      const sp = byId.get(id);
      this.spawnRemote({ id, crew: 'unknown', name: sp.name || id.slice(0, 4), color: 0x8899aa, weaponId: sp.weaponId });
    }
  }

  update(dt) {
    const buf = this.buffer;
    if (buf.length === 0) { for (const rp of this.remotes.values()) rp.update(dt); return; }

    const renderTime = this.conn.serverNow() - this.interpMs;

    // find bracketing snapshots [a, b] with a.time <= renderTime <= b.time
    let a = null, b = null;
    for (let i = buf.length - 1; i > 0; i--) {
      if (buf[i - 1].serverTime <= renderTime && renderTime <= buf[i].serverTime) { a = buf[i - 1]; b = buf[i]; break; }
    }

    for (const [id, rp] of this.remotes) {
      let s;
      if (a && b) {
        const sa = a.byId.get(id), sb = b.byId.get(id);
        if (sa && sb) {
          const t = (renderTime - a.serverTime) / Math.max(1, b.serverTime - a.serverTime);
          s = lerpSnap(sa, sb, t);
        } else { s = sb || sa; }
      } else {
        // renderTime past the newest snap → extrapolate from the latest, capped
        const latest = buf[buf.length - 1];
        const sp = latest.byId.get(id);
        if (sp) {
          const ahead = Math.min(EXTRAP_MAX_MS, Math.max(0, renderTime - latest.serverTime)) / 1000;
          s = {
            pos: { x: sp.pos.x + sp.vel.x * ahead, y: sp.pos.y + sp.vel.y * ahead, z: sp.pos.z + sp.vel.z * ahead },
            vel: sp.vel, yaw: sp.yaw, pitch: sp.pitch, state: sp.state, ground: sp.ground, hp: sp.hp, firing: sp.firing, weaponId: sp.weaponId,
          };
        }
      }
      if (s) rp.applyInterpolated(s);
      rp.update(dt);
    }
  }

  disposeAll() { for (const rp of this.remotes.values()) rp.dispose(); this.remotes.clear(); this.buffer.length = 0; }
}

function lerpSnap(a, b, t) {
  return {
    pos: { x: a.pos.x + (b.pos.x - a.pos.x) * t, y: a.pos.y + (b.pos.y - a.pos.y) * t, z: a.pos.z + (b.pos.z - a.pos.z) * t },
    vel: b.vel,
    yaw: angLerp(a.yaw, b.yaw, t),
    pitch: a.pitch + (b.pitch - a.pitch) * t,
    state: b.state, ground: b.ground, hp: b.hp, firing: b.firing, weaponId: b.weaponId,
  };
}
