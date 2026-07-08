// src/net/NetDebug.js — ARENA net stats overlay + dev latency/jitter injector.
// (ARENA-ARCHITECTURE.md §6.)
//
// TWO jobs, one small module:
//
//  (1) OVERLAY — a fixed top-left, dark-translucent, monospace, cyan-accented
//      readout of the live netcode health: ping/rtt, server tick, interp delay,
//      prediction error (m), snapshot rate (in/s), input rate (out/s), player
//      count, renderer backend, and the currently-injected latency preset. The
//      net-core calls update(stats) every frame; DOM writes are throttled to
//      ~8 Hz so the overlay never becomes the bottleneck. It is pointer-events:
//      none (non-interactive) and lives inside #ui like the rest of the HUD.
//
//  (2) LATENCY INJECTOR — a dev toggle (default key 'N') that CYCLES a set of
//      artificial-lag presets: off -> 50 -> 100 -> 200 ms, each with ±jitter
//      (~latency*0.3). The net-core wraps BOTH its send and receive paths with
//      setTimeout(netDebug.delay(), …) so a single knob stresses the whole link
//      symmetrically. delay() returns a fresh randomized ms value each call (or 0
//      when disabled). This is how we PROVE the netcode holds at 200 ms.
//
// Dependency-light: DOM + CSS built in code, no imports. ctx is the RANGE ctx
// (ctx.input.onKeyDown, ctx.backend, document). All optional bits are guarded so
// the overlay works even if wired before the net-core exists.

const CSS = `
.net-debug{position:absolute;left:12px;top:12px;z-index:40;pointer-events:none;
  font-family:Consolas,'SFMono-Regular',monospace;font-size:11px;line-height:1.5;
  color:#cfe9ee;background:rgba(8,12,18,0.82);border:1px solid rgba(125,249,255,0.30);
  border-radius:3px;padding:8px 11px 9px;min-width:186px;letter-spacing:0.02em;
  box-shadow:0 2px 18px rgba(0,0,0,0.55);backdrop-filter:blur(6px);
  text-shadow:0 1px 2px rgba(0,0,0,0.6);user-select:none;}
.net-debug.hidden{display:none;}
.net-debug .nd-title{display:flex;justify-content:space-between;align-items:baseline;
  gap:10px;margin-bottom:6px;padding-bottom:5px;border-bottom:1px solid rgba(125,249,255,0.16);}
.net-debug .nd-name{color:#7df9ff;font-size:10px;letter-spacing:0.22em;font-weight:600;}
.net-debug .nd-back{color:#5f7385;font-size:9px;letter-spacing:0.14em;}
.net-debug .nd-row{display:flex;justify-content:space-between;gap:14px;white-space:nowrap;}
.net-debug .nd-k{color:#7f95a6;}
.net-debug .nd-v{color:#e6f6f9;font-variant-numeric:tabular-nums;}
.net-debug .nd-v.warn{color:#ffd166;}
.net-debug .nd-v.bad{color:#ff6b6b;}
.net-debug .nd-v.good{color:#51e898;}
.net-debug .nd-sim{margin-top:6px;padding-top:5px;border-top:1px solid rgba(125,249,255,0.16);
  display:flex;justify-content:space-between;gap:10px;align-items:baseline;}
.net-debug .nd-sim-k{color:#7f95a6;}
.net-debug .nd-sim-v{color:#5f7385;font-variant-numeric:tabular-nums;}
.net-debug .nd-sim-v.on{color:#ff8fcf;font-weight:600;}
.net-debug .nd-hint{margin-top:5px;color:#4c5e6e;font-size:9px;letter-spacing:0.08em;}
.net-debug .nd-hint b{color:#7df9ff;font-weight:600;}
`;

// Latency presets. index 0 = off; each carries a jitter (± spread) in ms.
// jitter ≈ latency * 0.3, per the contract.
const PRESETS = [
  { latencyMs: 0, jitterMs: 0 },
  { latencyMs: 50, jitterMs: 15 },
  { latencyMs: 100, jitterMs: 30 },
  { latencyMs: 200, jitterMs: 60 },
];

function injectCss(id, text) {
  if (typeof document === 'undefined') return;
  if (document.getElementById(id)) return;
  const s = document.createElement('style');
  s.id = id;
  s.textContent = text;
  document.head.appendChild(s);
}

function el(tag, cls, parent, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  if (parent) parent.appendChild(e);
  return e;
}

// Small helper: build a "key : value" stat row, keep a handle to the value span.
function statRow(parent, label) {
  const row = el('div', 'nd-row', parent);
  el('span', 'nd-k', row, label);
  const v = el('span', 'nd-v', row, '—');
  return v;
}

function fmt(n, digits = 0) {
  if (n == null || !isFinite(n)) return '—';
  return n.toFixed(digits);
}

export class NetDebug {
  /**
   * @param {object} ctx  RANGE ctx (input, backend, document/#ui).
   * @param {object} [opts]
   *   opts.toggleKey     key code to cycle latency presets (default 'KeyN')
   *   opts.visKey        key code to toggle overlay visibility (default 'KeyO')
   *   opts.visible       start visible (default true — ON in arena)
   *   opts.parent        DOM node to mount into (default #ui, else body)
   */
  constructor(ctx, opts = {}) {
    this.ctx = ctx;
    this.opts = opts;
    this._unbind = [];

    // ---- latency injector state (read by the net-core via delay()) ----------
    this._presetIndex = 0;
    this.sim = { latencyMs: 0, jitterMs: 0, enabled: false };

    // ---- overlay throttle ----------------------------------------------------
    this._lastStats = null;      // freshest numbers from update()
    this._writeInterval = 1 / 8; // ~8 Hz DOM writes
    this._writeAccum = this._writeInterval; // force a write on the first frame
    this._dirty = false;         // preset/visibility changed → force a write

    this._visible = opts.visible !== false;

    this._buildDom();
    this._bindKeys();
    this._applyPreset(); // sync sim + render initial state
  }

  /* ---- public API ---------------------------------------------------------- */

  /**
   * Feed fresh net numbers. Called by the net-core each frame; the overlay
   * itself only repaints at ~8 Hz (throttled in render()).
   * @param {object} stats { rtt, tick, interpMs, predErr, snapsPerSec,
   *                          inputsPerSec, players, ping }
   */
  update(stats) {
    if (stats) this._lastStats = stats;
  }

  /**
   * Randomized one-way delay in ms for the net-core to setTimeout() BOTH send
   * and receive with. Returns 0 when the injector is off. Never negative.
   */
  delay() {
    if (!this.sim.enabled) return 0;
    const j = this.sim.jitterMs;
    const jitter = j > 0 ? (Math.random() * 2 - 1) * j : 0;
    return Math.max(0, this.sim.latencyMs + jitter);
  }

  /** Advance to the next latency preset (off → 50 → 100 → 200 → off). */
  cyclePreset() {
    this.setPreset((this._presetIndex + 1) % PRESETS.length);
  }

  /** Jump to a specific preset by index (clamped/wrapped into range). */
  setPreset(i) {
    const n = PRESETS.length;
    this._presetIndex = ((i % n) + n) % n;
    this._applyPreset();
  }

  /** Current preset index (0 = off). */
  get presetIndex() {
    return this._presetIndex;
  }

  /** Show/hide/toggle the overlay. */
  setVisible(v) {
    this._visible = !!v;
    if (this._root) this._root.classList.toggle('hidden', !this._visible);
  }
  toggle() {
    this.setVisible(!this._visible);
  }
  get visible() {
    return this._visible;
  }

  /** Per-frame paint — throttled to ~8 Hz. Call from the render pass. */
  render(dt) {
    this._writeAccum += dt || 0;
    if (!this._dirty && this._writeAccum < this._writeInterval) return;
    this._writeAccum = 0;
    this._dirty = false;
    this._paint();
  }

  /** Overlay is fixed-position; nothing to do on resize. */
  resize() {}

  /** Detach keys + DOM (for teardown / leaving arena). */
  dispose() {
    for (const off of this._unbind) { try { off?.(); } catch { /* ignore */ } }
    this._unbind.length = 0;
    if (this._root && this._root.parentNode) this._root.parentNode.removeChild(this._root);
    this._root = null;
  }

  /* ---- internals ----------------------------------------------------------- */

  _applyPreset() {
    const p = PRESETS[this._presetIndex];
    this.sim.latencyMs = p.latencyMs;
    this.sim.jitterMs = p.jitterMs;
    this.sim.enabled = p.latencyMs > 0;
    this._dirty = true; // repaint the sim line promptly on a toggle
  }

  _bindKeys() {
    if (!this.ctx?.input?.onKeyDown) return;
    const toggleKey = this.opts.toggleKey || 'KeyN';
    const visKey = this.opts.visKey || 'KeyO';
    this._unbind.push(this.ctx.input.onKeyDown(toggleKey, () => this.cyclePreset()));
    this._unbind.push(this.ctx.input.onKeyDown(visKey, () => this.toggle()));
  }

  _buildDom() {
    if (typeof document === 'undefined') return;
    injectCss('net-debug-css', CSS);

    const parent =
      this.opts.parent ||
      document.getElementById('ui') ||
      document.body;

    const root = el('div', 'net-debug', parent);
    if (!this._visible) root.classList.add('hidden');
    this._root = root;

    // title bar: name + backend badge
    const title = el('div', 'nd-title', root);
    el('span', 'nd-name', title, 'NET');
    this._backEl = el('span', 'nd-back', title, this.ctx?.backend || '—');

    // live stat rows
    this._el = {
      ping: statRow(root, 'ping'),
      rtt: statRow(root, 'rtt'),
      tick: statRow(root, 'tick'),
      interp: statRow(root, 'interp'),
      predErr: statRow(root, 'pred err'),
      snaps: statRow(root, 'snaps/s in'),
      inputs: statRow(root, 'inputs/s out'),
      players: statRow(root, 'players'),
    };

    // latency injector line
    const sim = el('div', 'nd-sim', root);
    el('span', 'nd-sim-k', sim, 'sim lag');
    this._simEl = el('span', 'nd-sim-v', sim, 'off');

    // key hints
    const toggleKey = (this.opts.toggleKey || 'KeyN').replace(/^Key/, '');
    const visKey = (this.opts.visKey || 'KeyO').replace(/^Key/, '');
    el('div', 'nd-hint', root,
      `<b>${toggleKey}</b> lag &nbsp;·&nbsp; <b>${visKey}</b> hide`);
  }

  _paint() {
    if (!this._root || !this._el) return;

    if (this._backEl && this.ctx?.backend) {
      this._backEl.textContent = this.ctx.backend;
    }

    const s = this._lastStats;
    const E = this._el;

    if (!s) {
      // no data yet (net-core not wired) — leave placeholders.
      this._paintSim();
      return;
    }

    // ping / rtt — colorize against typical thresholds.
    setVal(E.ping, s.ping != null ? `${fmt(s.ping)} ms` : '—', gradeMs(s.ping, 60, 140));
    setVal(E.rtt, s.rtt != null ? `${fmt(s.rtt)} ms` : '—', gradeMs(s.rtt, 90, 180));

    setVal(E.tick, s.tick != null ? `#${fmt(s.tick)}` : '—');

    setVal(E.interp, s.interpMs != null ? `${fmt(s.interpMs)} ms` : '—');

    // prediction error in metres — near-zero on a clean link is the whole point.
    setVal(
      E.predErr,
      s.predErr != null ? `${fmt(s.predErr, 3)} m` : '—',
      gradeMs(s.predErr, 0.05, 0.25),
    );

    setVal(E.snaps, s.snapsPerSec != null ? `${fmt(s.snapsPerSec)}/s` : '—');
    setVal(E.inputs, s.inputsPerSec != null ? `${fmt(s.inputsPerSec)}/s` : '—');
    setVal(E.players, s.players != null ? fmt(s.players) : '—');

    this._paintSim();
  }

  _paintSim() {
    if (!this._simEl) return;
    if (this.sim.enabled) {
      this._simEl.textContent = `${fmt(this.sim.latencyMs)} ±${fmt(this.sim.jitterMs)} ms`;
      this._simEl.classList.add('on');
    } else {
      this._simEl.textContent = 'off';
      this._simEl.classList.remove('on');
    }
  }
}

// Set a value span's text + severity class (good/warn/bad, or neutral).
function setVal(node, text, grade) {
  if (!node) return;
  node.textContent = text;
  node.classList.remove('good', 'warn', 'bad');
  if (grade) node.classList.add(grade);
}

// Grade a metric: <= warnAt is good, <= badAt is warn, else bad. Undefined for
// missing values so the neutral color shows.
function gradeMs(v, warnAt, badAt) {
  if (v == null || !isFinite(v)) return undefined;
  if (v <= warnAt) return 'good';
  if (v <= badAt) return 'warn';
  return 'bad';
}
