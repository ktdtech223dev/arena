// RANGE — ui/CrosshairEditor.js
// Toggled with K. Right-side interactive panel: live controls for every
// crosshair config field, per-gun tabs (writes settings `crosshair.<gunId>`
// immediately — HUD picks changes up live), copy-to-all, reset, and a
// base64-JSON import/export code string. Giant live preview swatch on a
// dark/light split background.
import {
  Crosshair,
  CROSSHAIR_DEFAULTS,
  CROSSHAIR_STYLES,
  sanitizeCrosshairConfig,
} from './Crosshair.js';

function injectCss(id, text) {
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

function sfx(ctx, name, opts) {
  try { ctx.audio?.play?.(name, opts); } catch { /* audio is optional */ }
}

const FALLBACK_GUNS = [
  { id: 'pistol', name: 'PISTOL' },
  { id: 'smg', name: 'SMG' },
  { id: 'shotgun', name: 'SHOTGUN' },
  { id: 'ar', name: 'AR' },
  { id: 'sniper', name: 'SNIPER' },
  { id: 'exotic', name: 'EXOTIC' },
  { id: 'sawblade', name: 'SAWBLADE' },
];

const PRESET_COLORS = ['#7df9ff', '#ffffff', '#7dff9a', '#ff5f7a', '#ffd66e', '#d78bff'];

const CSS = `
.xe-panel{position:absolute;right:16px;top:50%;transform:translateY(-50%);width:308px;max-height:calc(100% - 32px);
  overflow-y:auto;overflow-x:hidden;background:rgba(10,14,20,0.88);border:1px solid rgba(125,249,255,0.28);
  backdrop-filter:blur(7px);box-shadow:0 0 26px rgba(0,0,0,0.6);color:#dfe7f0;
  font-family:'Segoe UI',system-ui,sans-serif;padding:12px 14px 14px;display:none;}
.xe-panel::-webkit-scrollbar{width:8px;}
.xe-panel::-webkit-scrollbar-thumb{background:rgba(125,249,255,0.22);}
.xe-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;}
.xe-title{font-size:12px;letter-spacing:.24em;color:#7df9ff;font-weight:600;}
.xe-title .kbd{border:1px solid rgba(125,249,255,.4);padding:0 5px;margin-left:8px;font-size:10px;color:#8fa3b8;letter-spacing:0;}
.xe-x{cursor:pointer;color:#8fa3b8;font-size:15px;line-height:1;padding:2px 6px;border:1px solid transparent;}
.xe-x:hover{color:#7df9ff;border-color:rgba(125,249,255,.4);}
.xe-tabs{display:flex;gap:3px;margin-bottom:10px;flex-wrap:wrap;}
.xe-tab{flex:1 1 0;min-width:34px;text-align:center;padding:5px 1px 4px;font-size:9px;letter-spacing:.02em;cursor:pointer;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  background:rgba(125,249,255,0.05);border:1px solid rgba(125,249,255,0.18);color:#9fb2c5;position:relative;text-transform:uppercase;}
.xe-tab:hover{background:rgba(125,249,255,0.14);color:#eaffff;}
.xe-tab.active{background:rgba(125,249,255,0.22);border-color:#7df9ff;color:#ffffff;}
.xe-tab.equipped::after{content:'';position:absolute;top:2px;right:2px;width:4px;height:4px;background:#7dff9a;border-radius:50%;}
.xe-preview{position:relative;height:132px;margin-bottom:10px;border:1px solid rgba(125,249,255,0.2);
  background:linear-gradient(90deg,#11151c 0 50%,#cdd5dd 50% 100%);}
.xe-preview canvas{position:absolute;inset:0;width:100%;height:100%;}
.xe-sec{font-size:9.5px;letter-spacing:.22em;color:#7df9ff;opacity:.85;margin:11px 0 5px;}
.xe-styles{display:grid;grid-template-columns:repeat(3,1fr);gap:4px;}
.xe-style-btn{padding:5px 0;font-size:9.5px;letter-spacing:.06em;text-align:center;cursor:pointer;text-transform:uppercase;
  background:rgba(125,249,255,0.05);border:1px solid rgba(125,249,255,0.18);color:#9fb2c5;}
.xe-style-btn:hover{background:rgba(125,249,255,0.14);color:#eaffff;}
.xe-style-btn.active{background:rgba(125,249,255,0.22);border-color:#7df9ff;color:#fff;}
.xe-row{display:grid;grid-template-columns:86px 1fr 38px;gap:7px;align-items:center;margin:5px 0;}
.xe-row label{font-size:10.5px;color:#9fb2c5;letter-spacing:.04em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.xe-row input[type=range]{width:100%;accent-color:#7df9ff;height:14px;cursor:pointer;}
.xe-val{font-family:Consolas,monospace;font-size:11px;color:#7df9ff;text-align:right;}
.xe-checks{display:grid;grid-template-columns:1fr 1fr;gap:3px 10px;margin:6px 0;}
.xe-check{display:flex;align-items:center;gap:7px;font-size:10.5px;color:#9fb2c5;cursor:pointer;padding:2px 0;}
.xe-check input{accent-color:#7df9ff;cursor:pointer;}
.xe-color-row{display:flex;gap:6px;align-items:center;margin:5px 0;}
.xe-color-row input[type=color]{width:42px;height:24px;border:1px solid rgba(125,249,255,.3);background:transparent;padding:1px;cursor:pointer;}
.xe-swatch{width:16px;height:16px;border:1px solid rgba(255,255,255,.25);cursor:pointer;}
.xe-swatch:hover{border-color:#fff;}
.xe-btns{display:flex;gap:6px;margin-top:10px;}
.xe-btn{flex:1;padding:6px 0;font-size:10px;letter-spacing:.1em;text-align:center;cursor:pointer;text-transform:uppercase;
  background:rgba(125,249,255,0.07);border:1px solid rgba(125,249,255,0.3);color:#bfe9ee;}
.xe-btn:hover{background:rgba(125,249,255,0.18);color:#eaffff;}
.xe-code-row{display:flex;gap:5px;margin-top:6px;}
.xe-code{flex:1;min-width:0;background:rgba(0,0,0,0.4);border:1px solid rgba(125,249,255,0.22);color:#9fd8dd;
  font-family:Consolas,monospace;font-size:10px;padding:5px 6px;outline:none;}
.xe-code:focus{border-color:#7df9ff;}
.xe-code.bad{border-color:#ff5f7a;}
.xe-code-btn{padding:5px 9px;font-size:9.5px;letter-spacing:.08em;cursor:pointer;
  background:rgba(125,249,255,0.07);border:1px solid rgba(125,249,255,0.3);color:#bfe9ee;}
.xe-code-btn:hover{background:rgba(125,249,255,0.18);color:#eaffff;}
`;

export class CrosshairEditor {
  constructor(ctx) {
    this.ctx = ctx;
    this.visible = false;
    this._gun = 'pistol';
    this._cfg = { ...CROSSHAIR_DEFAULTS };
    this._refreshers = [];
    this._t = 0;
    this._lastTick = 0;
    this._dpr = Math.min(window.devicePixelRatio || 1, 2);

    injectCss('xe-css', CSS);
    this._build();

    this._preview = new Crosshair(this._pvCanvas);
    this._preview.pixelScale = this._dpr;

    ctx.input.onKeyDown('KeyK', () => this.toggle());
    ctx.input.onKeyDown('Escape', () => { if (this.visible) this.close(); });
  }

  // ---- panel plumbing -------------------------------------------------------

  _closeOthers() {
    const ui = this.ctx.ui || {};
    ui.wheel?.cancel?.(); // wheel's close(bool) means "select" — cancel instead
    for (const p of [ui.rangeMenu, ui.debug]) {
      if (p && p !== this) p.close?.(true);
    }
  }

  toggle() {
    if (this.visible) this.close();
    else this.open();
  }

  open() {
    if (this.visible) return;
    // pushUI BEFORE closing others: keeps input's UI set non-empty during the
    // swap so the other panel's popUI doesn't re-request pointer lock.
    this.visible = true;
    this.ctx.input.pushUI('crosshairEditor');
    this._closeOthers();
    this._buildTabs();
    const curId = this.ctx.weapons?.current?.def?.id;
    this._setGun(curId || this._gun, true);
    this.root.style.display = 'block';
    this.ctx.events.emit('ui:open', { id: 'crosshairEditor' });
    sfx(this.ctx, 'ui_open');
  }

  close(silent = false) {
    if (!this.visible) return;
    this.visible = false;
    this.root.style.display = 'none';
    this.ctx.input.popUI('crosshairEditor');
    this.ctx.events.emit('ui:close', { id: 'crosshairEditor' });
    if (!silent) sfx(this.ctx, 'ui_close');
  }

  _tick() {
    const n = performance.now();
    if (n - this._lastTick > 45) {
      this._lastTick = n;
      sfx(this.ctx, 'ui_tick', { volume: 0.5 });
    }
  }

  // ---- DOM ------------------------------------------------------------------

  _build() {
    const root = el('div', 'xe-panel interactive', document.getElementById('ui'));
    this.root = root;

    const head = el('div', 'xe-head', root);
    el('div', 'xe-title', head, 'CROSSHAIR EDITOR<span class="kbd">K</span>');
    const x = el('div', 'xe-x', head, '✕');
    x.addEventListener('click', () => this.close());

    this._tabsEl = el('div', 'xe-tabs', root);

    const pv = el('div', 'xe-preview', root);
    this._pvCanvas = el('canvas', '', pv);
    this._sizePreview();

    // style buttons
    el('div', 'xe-sec', root, 'STYLE');
    const styles = el('div', 'xe-styles', root);
    this._styleBtns = {};
    for (const st of CROSSHAIR_STYLES) {
      const b = el('div', 'xe-style-btn', styles, st);
      b.addEventListener('click', () => {
        this._cfg.style = st;
        this._commit();
        this._refreshAll();
        sfx(this.ctx, 'ui_click');
      });
      this._styleBtns[st] = b;
    }
    this._refreshers.push(() => {
      for (const st of CROSSHAIR_STYLES) {
        this._styleBtns[st].classList.toggle('active', this._cfg.style === st);
      }
    });

    // sliders
    el('div', 'xe-sec', root, 'SHAPE');
    this._slider(root, 'SIZE', 'size', 0, 40, 1);
    this._slider(root, 'THICKNESS', 'thickness', 1, 10, 1);
    this._slider(root, 'GAP', 'gap', 0, 40, 1);
    this._slider(root, 'DOT SIZE', 'dotSize', 1, 10, 1);
    this._slider(root, 'OUTLINE PX', 'outlineThickness', 1, 4, 1);

    // checkboxes
    el('div', 'xe-sec', root, 'FLAGS');
    const checks = el('div', 'xe-checks', root);
    this._check(checks, 'CENTER DOT', 'dot');
    this._check(checks, 'OUTLINE', 'outline');
    this._check(checks, 'DYNAMIC', 'dynamic');
    this._check(checks, 'T-STYLE', 'tStyle');

    // color
    el('div', 'xe-sec', root, 'COLOR');
    const colorRow = el('div', 'xe-color-row', root);
    const colorIn = el('input', '', colorRow);
    colorIn.type = 'color';
    colorIn.addEventListener('input', () => {
      this._cfg.color = colorIn.value;
      this._commit();
      this._tick();
    });
    for (const c of PRESET_COLORS) {
      const sw = el('div', 'xe-swatch', colorRow);
      sw.style.background = c;
      sw.title = c;
      sw.addEventListener('click', () => {
        this._cfg.color = c;
        this._commit();
        this._refreshAll();
        sfx(this.ctx, 'ui_click');
      });
    }
    this._refreshers.push(() => {
      // <input type=color> requires #rrggbb — coerce best-effort
      const c = /^#[0-9a-fA-F]{6}$/.test(this._cfg.color) ? this._cfg.color : '#7df9ff';
      colorIn.value = c;
    });
    this._slider(root, 'OPACITY', 'opacity', 0.1, 1, 0.05);

    // action buttons
    const btns = el('div', 'xe-btns', root);
    const copyAll = el('div', 'xe-btn', btns, 'COPY TO ALL GUNS');
    copyAll.addEventListener('click', () => {
      for (const g of this._guns()) {
        this.ctx.settings.set(`crosshair.${g.id}`, { ...this._cfg });
      }
      sfx(this.ctx, 'ui_click');
    });
    const reset = el('div', 'xe-btn', btns, 'RESET DEFAULT');
    reset.addEventListener('click', () => {
      this._cfg = { ...CROSSHAIR_DEFAULTS };
      this._commit();
      this._refreshAll();
      sfx(this.ctx, 'ui_click');
    });

    // import/export
    el('div', 'xe-sec', root, 'SHARE CODE');
    const codeRow = el('div', 'xe-code-row', root);
    this._codeField = el('input', 'xe-code', codeRow);
    this._codeField.type = 'text';
    this._codeField.spellcheck = false;
    this._codeField.addEventListener('input', () => this._codeField.classList.remove('bad'));
    const copyBtn = el('div', 'xe-code-btn', codeRow, 'COPY');
    copyBtn.addEventListener('click', () => {
      this._codeField.value = this._encode();
      try {
        this._codeField.select();
        if (navigator.clipboard?.writeText) navigator.clipboard.writeText(this._codeField.value);
        else document.execCommand('copy');
      } catch { /* clipboard denied — text stays selected */ }
      sfx(this.ctx, 'ui_click');
    });
    const applyBtn = el('div', 'xe-code-btn', codeRow, 'APPLY');
    applyBtn.addEventListener('click', () => {
      const ok = this._importCode(this._codeField.value);
      this._codeField.classList.toggle('bad', !ok);
      if (ok) sfx(this.ctx, 'ui_click');
    });
  }

  _sizePreview() {
    // fixed CSS box (306-2 border inner width x 130) at DPR resolution
    const w = 278, h = 130;
    this._pvCanvas.width = Math.round(w * this._dpr);
    this._pvCanvas.height = Math.round(h * this._dpr);
  }

  _slider(parent, label, key, min, max, step) {
    const row = el('div', 'xe-row', parent);
    el('label', '', row, label);
    const input = el('input', '', row);
    input.type = 'range';
    input.min = min;
    input.max = max;
    input.step = step;
    const val = el('div', 'xe-val', row);
    const dec = step < 1 ? 2 : 0;
    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      if (this._cfg[key] !== v) {
        this._cfg[key] = v;
        val.textContent = v.toFixed(dec);
        this._commit();
        this._tick();
      }
    });
    this._refreshers.push(() => {
      const v = Number(this._cfg[key] ?? min);
      input.value = String(v);
      val.textContent = v.toFixed(dec);
    });
  }

  _check(parent, label, key) {
    const lab = el('label', 'xe-check', parent);
    const input = el('input', '', lab);
    input.type = 'checkbox';
    el('span', '', lab, label);
    input.addEventListener('change', () => {
      this._cfg[key] = input.checked;
      this._commit();
      sfx(this.ctx, 'ui_click', { volume: 0.7 });
    });
    this._refreshers.push(() => { input.checked = !!this._cfg[key]; });
  }

  // ---- gun tabs ---------------------------------------------------------------

  _guns() {
    const defs = this.ctx.weapons?.defs;
    return Array.isArray(defs) && defs.length ? defs : FALLBACK_GUNS;
  }

  _buildTabs() {
    this._tabsEl.innerHTML = '';
    this._tabBtns = {};
    const curId = this.ctx.weapons?.current?.def?.id;
    for (const g of this._guns()) {
      const b = el('div', 'xe-tab', this._tabsEl, (g.name || g.id).slice(0, 7));
      b.title = g.name || g.id;
      if (g.id === curId) b.classList.add('equipped');
      b.addEventListener('click', () => {
        if (this._gun !== g.id) {
          this._setGun(g.id);
          sfx(this.ctx, 'ui_click');
        }
      });
      this._tabBtns[g.id] = b;
    }
  }

  _setGun(gunId, silent = false) {
    this._gun = gunId;
    const stored = this.ctx.settings.get(`crosshair.${gunId}`, null);
    this._cfg = sanitizeCrosshairConfig(stored);
    for (const [id, b] of Object.entries(this._tabBtns || {})) {
      b.classList.toggle('active', id === gunId);
    }
    this._codeField.value = this._encode();
    this._codeField.classList.remove('bad');
    this._refreshAll();
    if (!silent) this._commit(); // no-op write keeps stored cfg normalized
  }

  _refreshAll() {
    for (const fn of this._refreshers) fn();
  }

  _commit() {
    this.ctx.settings.set(`crosshair.${this._gun}`, { ...this._cfg });
    this._codeField.value = this._encode();
  }

  // ---- import/export -----------------------------------------------------------

  _encode() {
    try {
      return btoa(JSON.stringify(this._cfg));
    } catch {
      return '';
    }
  }

  _importCode(str) {
    if (!str) return false;
    const s = str.trim();
    let parsed = null;
    try {
      parsed = JSON.parse(s.startsWith('{') ? s : atob(s));
    } catch {
      return false;
    }
    if (!parsed || typeof parsed !== 'object') return false;
    this._cfg = sanitizeCrosshairConfig(parsed);
    this._commit();
    this._refreshAll();
    return true;
  }

  // ---- per-frame -----------------------------------------------------------------

  render(dt) {
    if (!this.visible) return;
    this._t += dt;
    // preview crosshair with animated bloom when dynamic
    const spread = this._cfg.dynamic ? (0.5 + 0.5 * Math.sin(this._t * 2.4)) * 10 : 0;
    this._preview.setConfig(this._cfg);
    this._preview.draw(spread);
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (dpr !== this._dpr) {
      this._dpr = dpr;
      this._preview.pixelScale = dpr;
      this._sizePreview();
    }
  }
}
