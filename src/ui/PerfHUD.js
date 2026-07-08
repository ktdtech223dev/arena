// ARENA — src/ui/PerfHUD.js
// Performance overlay for map profiling: FPS, frame ms, draw calls, triangles,
// programs (shader count), and the active map. Reads ctx.renderer.info after a
// render. Toggle with the given key (default: J). Non-interactive DOM.
const CSS = `
.perf-hud{position:absolute;top:8px;left:8px;z-index:44;pointer-events:none;
  font:11px/1.5 Consolas,monospace;color:#bfe9ef;background:rgba(6,10,14,0.8);
  border:1px solid rgba(125,249,255,0.22);border-radius:4px;padding:7px 10px;min-width:150px;
  text-shadow:0 1px 2px #000;letter-spacing:.02em;}
.perf-hud .ph-h{color:#7df9ff;font-weight:700;letter-spacing:.16em;margin-bottom:3px;}
.perf-hud .ph-row{display:flex;justify-content:space-between;gap:14px;}
.perf-hud .ph-v{font-weight:700;}
.perf-hud .ph-good{color:#51e898;} .perf-hud .ph-warn{color:#ffd166;} .perf-hud .ph-bad{color:#ff5b5b;}
`;
function injectCss(id, t) { if (typeof document === 'undefined' || document.getElementById(id)) return; const s = document.createElement('style'); s.id = id; s.textContent = t; document.head.appendChild(s); }

export class PerfHUD {
  constructor(ctx, opts = {}) {
    this.ctx = ctx;
    this.visible = opts.visible ?? false;
    this._acc = 0; this._frames = 0; this._fps = 0; this._ms = 0; this._last = performance.now();
    this._mapName = () => ctx.arena?.map?.name || ctx.mode;
    if (typeof document === 'undefined') return;
    injectCss('perf-hud-css', CSS);
    const parent = document.getElementById('ui') || document.body;
    this.el = document.createElement('div'); this.el.className = 'perf-hud';
    this.el.style.display = this.visible ? 'block' : 'none';
    parent.appendChild(this.el);
    ctx.input?.onKeyDown?.(opts.key || 'KeyJ', () => this.toggle());
    this._paint = 0;
  }

  toggle() { this.visible = !this.visible; if (this.el) this.el.style.display = this.visible ? 'block' : 'none'; }

  // called each render frame (after ctx.renderer.render)
  update(dt) {
    const now = performance.now();
    const frameMs = now - this._last; this._last = now;
    this._acc += frameMs; this._frames++;
    if (this._acc >= 250) { this._fps = Math.round(this._frames * 1000 / this._acc); this._ms = +(this._acc / this._frames).toFixed(2); this._acc = 0; this._frames = 0; }
    if (!this.visible || !this.el) return;
    this._paint -= dt; if (this._paint > 0) return; this._paint = 0.15;
    const info = this.ctx.renderer?.info || {};
    const r = info.render || {}; const mem = info.memory || {};
    const fpsCls = this._fps >= 110 ? 'ph-good' : this._fps >= 60 ? 'ph-warn' : 'ph-bad';
    this.el.innerHTML =
      `<div class="ph-h">PERF · ${this._mapName()}</div>` +
      row('fps', `<span class="${fpsCls}">${this._fps}</span>`) +
      row('frame', `${this._ms} ms`) +
      row('draws', `${r.calls ?? 0}`) +
      row('tris', fmt(r.triangles ?? 0)) +
      row('geoms', `${mem.geometries ?? 0}`) +
      row('progs', `${(info.programs || []).length}`) +
      row('backend', this.ctx.backend || '');
  }

  // Snapshot the current renderer.info (for profiling reports).
  snapshot() {
    const info = this.ctx.renderer?.info || {}; const r = info.render || {}; const mem = info.memory || {};
    return { fps: this._fps, ms: this._ms, calls: r.calls ?? 0, triangles: r.triangles ?? 0, geometries: mem.geometries ?? 0, programs: (info.programs || []).length };
  }

  resize() {}
  dispose() { if (this.el?.parentNode) this.el.parentNode.removeChild(this.el); this.el = null; }
}
function row(k, v) { return `<div class="ph-row"><span>${k}</span><span class="ph-v">${v}</span></div>`; }
function fmt(n) { return n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n); }
