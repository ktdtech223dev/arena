// ARENA client — net/Connection.js
// socket.io-client wrapper: connect, join the always-on lobby, maintain a
// clock/latency handshake (so we can align to server time for interpolation +
// lag comp), and route messages. Optionally routes send/receive through the
// NetDebug latency injector so we can stress-test locally.
import { io } from 'socket.io-client';

export class Connection {
  constructor(ctx, opts = {}) {
    this.ctx = ctx;
    this.netsim = opts.netsim || null; // NetDebug instance for latency injection
    this.id = null;
    this.welcome = null;
    this.connected = false;

    this.clockOffset = 0; // serverTime ≈ Date.now() + clockOffset
    this.rtt = 0;
    this._offsetSamples = [];
    this._pingTimer = 0;
    this._inbound = 0; this._inboundAt = performance.now(); this.snapsPerSec = 0;
    this._outbound = 0; this._outboundAt = performance.now(); this.inputsPerSec = 0;

    this._handlers = new Map(); // event -> Set<fn>

    const url = opts.url || import.meta.env?.VITE_ARENA_URL || undefined; // undefined = same origin
    this.sock = io(url, { transports: ['websocket'], reconnection: true });

    this.sock.on('connect', () => { this.connected = true; this._emitLocal('connect'); });
    this.sock.on('disconnect', () => { this.connected = false; this._emitLocal('disconnect'); });
    this.sock.on('connect_error', (e) => this._emitLocal('error', e));

    // server messages -> apply inbound latency, then dispatch
    const forward = (name) => this.sock.on(name, (data) => this._recv(name, data));
    for (const n of ['welcome', 'player_join', 'player_leave', 'snapshot', 'hit', 'death', 'respawn', 'boom', 'shotfx', 'map_change', 'lobby_full', 'accolade', 'accolade_summary', 'pickup', 'maps_updated', 'mode_change', 'mode_event', 'round_end']) forward(n);

    this.sock.on('pong', (m) => this._onPong(m));
  }

  serverNow() { return Date.now() + this.clockOffset; }

  join(opts = {}) { this.sock.emit('join', opts); }

  // ---- outbound (latency-injected) ----
  sendInput(cmd) { this._send('input', cmd); this._outbound++; }
  sendFire(fire) { this._send('fire', fire); }
  sendMelee(m) { this._send('melee', m); }
  sendThrow(t) { this._send('throw', t); }
  sendSetMap(id) { this._send('setMap', { id }); }
  sendSetMode(id) { this._send('setMode', { id }); }
  sendSwap(weaponId) { this._send('swap', { weaponId }); }
  sendReload(weaponId) { this._send('reload', { weaponId }); }
  sendSummaryReq() { this._send('accolade_summary_req', {}); }

  _send(name, data) {
    const d = this.netsim ? this.netsim.delay() : 0;
    if (d > 0) setTimeout(() => this.sock.connected && this.sock.emit(name, data), d);
    else this.sock.emit(name, data);
  }

  _recv(name, data) {
    // set our own id/welcome SYNCHRONOUSLY on receipt (before any latency delay
    // or local dispatch) so downstream handlers never mistake us for a remote.
    if (name === 'welcome') { this.welcome = data; this.id = data.id; }
    if (name === 'snapshot') this._inbound++;
    const d = this.netsim ? this.netsim.delay() : 0;
    if (d > 0) setTimeout(() => this._emitLocal(name, data), d);
    else this._emitLocal(name, data);
  }

  // ---- clock handshake ----
  update(dt) {
    this._pingTimer -= dt;
    if (this._pingTimer <= 0 && this.connected) { this._pingTimer = 1.0; this.sock.emit('ping', { t0: Date.now() }); }

    // rolling rates (1 s window)
    const now = performance.now();
    if (now - this._inboundAt >= 1000) { this.snapsPerSec = this._inbound * 1000 / (now - this._inboundAt); this._inbound = 0; this._inboundAt = now; }
    if (now - this._outboundAt >= 1000) { this.inputsPerSec = this._outbound * 1000 / (now - this._outboundAt); this._outbound = 0; this._outboundAt = now; }
  }

  _onPong(m) {
    const now = Date.now();
    const rtt = now - (m.t0 || now);
    this.rtt = this.rtt ? this.rtt * 0.8 + rtt * 0.2 : rtt;
    // best estimate: server time at our receive ≈ tServer + rtt/2
    const offset = (m.tServer + rtt / 2) - now;
    this._offsetSamples.push(offset);
    if (this._offsetSamples.length > 12) this._offsetSamples.shift();
    // median-ish: average of the middle samples (robust to jitter spikes)
    const sorted = [...this._offsetSamples].sort((a, b) => a - b);
    const mid = sorted.slice(Math.max(0, sorted.length / 2 - 2) | 0, (sorted.length / 2 + 2) | 0);
    const est = mid.reduce((s, v) => s + v, 0) / (mid.length || 1);
    // smooth toward the estimate so interp time doesn't jump
    this.clockOffset = this.clockOffset ? this.clockOffset * 0.9 + est * 0.1 : est;
  }

  // ---- local event surface ----
  on(name, fn) {
    let set = this._handlers.get(name);
    if (!set) this._handlers.set(name, (set = new Set()));
    set.add(fn);
    return () => set.delete(fn);
  }
  _emitLocal(name, data) {
    const set = this._handlers.get(name);
    if (set) for (const fn of [...set]) { try { fn(data); } catch (e) { console.error('[net] handler', name, e); } }
  }

  dispose() { try { this.sock.close(); } catch {} }
}
