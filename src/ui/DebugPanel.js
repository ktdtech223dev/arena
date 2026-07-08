// RANGE — ui/DebugPanel.js
// Toggled with F. Left-side scrollable tuning panel auto-built from
// ctx.tunables — THE tuning workflow for the whole project. Rebuilt lazily
// on each open (so late registrations appear), grouped by `cat` with
// collapsible headers (gun:* cats start collapsed), one dense row per entry:
// label + slider (min/max/step) + editable monospace value that live-updates.
// Search filter at the top. Supports both descriptor shapes from §8:
//   { cat, key, obj, prop, min, max, step, label?, onChange? }
//   { cat, key, get(), set(v), min, max, step }
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

function readT(t) {
  try {
    if (typeof t.get === 'function') return t.get();
    return t.obj ? t.obj[t.prop] : undefined;
  } catch {
    return undefined;
  }
}

function writeT(t, v) {
  try {
    if (typeof t.set === 'function') t.set(v);
    else if (t.obj) t.obj[t.prop] = v;
    t.onChange?.(v);
  } catch (err) {
    console.warn('[debug] tunable write failed:', t?.cat, t?.key, err);
  }
}

function decimalsOf(step) {
  const s = String(step);
  const e = s.indexOf('e-');
  if (e >= 0) return Math.min(6, parseInt(s.slice(e + 2), 10) || 0);
  const i = s.indexOf('.');
  return i < 0 ? 0 : Math.min(6, s.length - i - 1);
}

const isNum = (v) => typeof v === 'number' && isFinite(v);

const CSS = `
.dbg-panel{position:absolute;left:16px;top:16px;bottom:16px;width:372px;max-width:92vw;display:none;
  flex-direction:column;background:rgba(10,14,20,0.9);border:1px solid rgba(125,249,255,0.28);
  backdrop-filter:blur(7px);box-shadow:0 0 26px rgba(0,0,0,0.6);color:#dfe7f0;
  font-family:'Segoe UI',system-ui,sans-serif;padding:10px 0 0;}
.dbg-head{display:flex;justify-content:space-between;align-items:center;padding:0 12px;margin-bottom:8px;}
.dbg-title{font-size:12px;letter-spacing:.24em;color:#7df9ff;font-weight:600;}
.dbg-title .kbd{border:1px solid rgba(125,249,255,.4);padding:0 5px;margin-left:8px;font-size:10px;color:#8fa3b8;letter-spacing:0;}
.dbg-x{cursor:pointer;color:#8fa3b8;font-size:15px;line-height:1;padding:2px 6px;border:1px solid transparent;}
.dbg-x:hover{color:#7df9ff;border-color:rgba(125,249,255,.4);}
.dbg-search{margin:0 12px 8px;}
.dbg-search input{width:100%;background:rgba(0,0,0,0.4);border:1px solid rgba(125,249,255,0.22);color:#dfe7f0;
  font-family:Consolas,monospace;font-size:11px;padding:5px 8px;outline:none;}
.dbg-search input:focus{border-color:#7df9ff;}
.dbg-list{flex:1;overflow-y:auto;overflow-x:hidden;padding:0 12px 12px;}
.dbg-list::-webkit-scrollbar{width:8px;}
.dbg-list::-webkit-scrollbar-thumb{background:rgba(125,249,255,0.22);}
.dbg-cat-head{display:flex;align-items:center;gap:7px;cursor:pointer;padding:5px 6px;margin-top:5px;
  background:rgba(125,249,255,0.06);border:1px solid rgba(125,249,255,0.16);}
.dbg-cat-head:hover{background:rgba(125,249,255,0.13);}
.dbg-caret{color:#7df9ff;font-size:9px;width:10px;text-align:center;}
.dbg-cat-name{font-size:10px;letter-spacing:.18em;color:#7df9ff;text-transform:uppercase;flex:1;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.dbg-cat-n{font-family:Consolas,monospace;font-size:9.5px;color:#66788c;}
.dbg-rows{padding:3px 0 4px;}
.dbg-row{display:grid;grid-template-columns:118px 1fr 56px;gap:7px;align-items:center;padding:1.5px 2px;}
.dbg-row:hover{background:rgba(125,249,255,0.05);}
.dbg-row label{font-size:10px;color:#9fb2c5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:default;}
.dbg-row input[type=range]{width:100%;accent-color:#7df9ff;height:12px;cursor:pointer;}
.dbg-row input[type=checkbox]{accent-color:#7df9ff;justify-self:start;cursor:pointer;}
.dbg-num{width:100%;background:rgba(0,0,0,0.35);border:1px solid rgba(125,249,255,0.18);color:#7df9ff;
  font-family:Consolas,monospace;font-size:10.5px;padding:2px 4px;text-align:right;outline:none;}
.dbg-num:focus{border-color:#7df9ff;color:#eaffff;}
.dbg-empty{font-size:10.5px;color:#66788c;letter-spacing:.1em;padding:10px 4px;font-family:Consolas,monospace;}
`;

export class DebugPanel {
  constructor(ctx) {
    this.ctx = ctx;
    this.visible = false;

    this._groupList = [];        // [{ cat, el, head, caret, body, rows, open }]
    this._collapsed = new Map(); // cat -> bool, persists across rebuilds
    this._builtLen = -1;         // ctx.tunables.length at last rebuild
    this._filter = '';
    this._refreshT = 0;
    this._lastTick = 0;

    injectCss('dbg-css', CSS);
    this._build();

    ctx.input.onKeyDown('KeyF', () => this.toggle());
    ctx.input.onKeyDown('Escape', () => { if (this.visible) this.close(); });
  }

  // ---- panel plumbing -------------------------------------------------------

  _closeOthers() {
    const ui = this.ctx.ui || {};
    ui.wheel?.cancel?.();
    for (const p of [ui.editor, ui.rangeMenu]) {
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
    this.ctx.input.pushUI('debug');
    this._closeOthers();
    this._rebuild();
    for (const gr of this._groupList) for (const row of gr.rows) row.refresh();
    this.root.style.display = 'flex';
    this.ctx.events.emit('ui:open', { id: 'debug' });
    sfx(this.ctx, 'ui_open');
  }

  close(silent = false) {
    if (!this.visible) return;
    this.visible = false;
    this.root.style.display = 'none';
    this.ctx.input.popUI('debug');
    this.ctx.events.emit('ui:close', { id: 'debug' });
    if (!silent) sfx(this.ctx, 'ui_close');
  }

  _tick() {
    const n = performance.now();
    if (n - this._lastTick > 45) {
      this._lastTick = n;
      sfx(this.ctx, 'ui_tick', { volume: 0.4 });
    }
  }

  // ---- DOM ---------------------------------------------------------------------

  _build() {
    const root = el('div', 'dbg-panel interactive', document.getElementById('ui'));
    this.root = root;

    const head = el('div', 'dbg-head', root);
    el('div', 'dbg-title', head, 'TUNABLES<span class="kbd">F</span>');
    const x = el('div', 'dbg-x', head, '✕');
    x.addEventListener('click', () => this.close());

    const searchWrap = el('div', 'dbg-search', root);
    this._searchIn = el('input', '', searchWrap);
    this._searchIn.type = 'text';
    this._searchIn.placeholder = 'filter…';
    this._searchIn.spellcheck = false;
    this._searchIn.addEventListener('input', () => {
      this._filter = this._searchIn.value.trim().toLowerCase();
      this._applyFilter();
    });
    this._searchIn.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        // first ESC clears the filter, second (via raw hook) closes the panel
        if (this._searchIn.value) {
          this._searchIn.value = '';
          this._filter = '';
          this._applyFilter();
        }
        this._searchIn.blur();
      }
    });

    this._listEl = el('div', 'dbg-list', root);
  }

  /** Rebuild the whole tree when the tunables list grew since last time. */
  _rebuild() {
    const tunables = this.ctx.tunables || [];
    if (tunables.length === this._builtLen) return;
    this._builtLen = tunables.length;
    this._listEl.innerHTML = '';
    this._groupList = [];

    const byCat = new Map(); // first-encounter order ≈ module construction order
    for (const t of tunables) {
      if (!t || typeof t !== 'object') continue;
      const cat = String(t.cat || 'misc');
      let arr = byCat.get(cat);
      if (!arr) byCat.set(cat, (arr = []));
      arr.push(t);
    }
    if (!byCat.size) {
      el('div', 'dbg-empty', this._listEl, 'NO TUNABLES REGISTERED');
      return;
    }

    for (const [cat, list] of byCat) {
      if (!this._collapsed.has(cat)) this._collapsed.set(cat, cat.startsWith('gun'));
      const gr = { cat, rows: [], open: true };
      gr.el = el('div', 'dbg-cat', this._listEl);
      const head = el('div', 'dbg-cat-head', gr.el);
      gr.caret = el('div', 'dbg-caret', head, '▾');
      el('div', 'dbg-cat-name', head, cat.replace(':', ': '));
      el('div', 'dbg-cat-n', head, String(list.length));
      gr.body = el('div', 'dbg-rows', gr.el);
      head.addEventListener('click', () => {
        this._collapsed.set(cat, !this._collapsed.get(cat));
        sfx(this.ctx, 'ui_click', { volume: 0.7 });
        this._applyFilter();
      });
      for (const t of list) gr.rows.push(this._buildRow(gr.body, t, cat));
      this._groupList.push(gr);
    }
    this._applyFilter();
  }

  _buildRow(parent, t, cat) {
    const row = { t, visible: true, refresh: () => {} };
    row.el = el('div', 'dbg-row', parent);
    const labelText = String(t.label || t.key || t.prop || '?');
    const lab = el('label', '', row.el, labelText);
    lab.title = `${cat} / ${t.key ?? t.prop ?? ''}`;
    row.search = `${cat} ${t.key || ''} ${labelText}`.toLowerCase();

    const cur = readT(t);

    // boolean tunable → checkbox (contract only mandates sliders; be graceful)
    if (typeof cur === 'boolean') {
      const chk = el('input', '', row.el);
      chk.type = 'checkbox';
      chk.checked = cur;
      chk.addEventListener('change', () => {
        writeT(t, chk.checked);
        sfx(this.ctx, 'ui_click', { volume: 0.7 });
      });
      el('div', '', row.el); // grid filler (value column)
      row.refresh = () => {
        if (document.activeElement !== chk) chk.checked = !!readT(t);
      };
      return row;
    }

    const min = isNum(t.min) ? t.min : 0;
    let max = isNum(t.max) ? t.max : Math.max(1, Math.abs(Number(cur) || 0) * 2);
    if (max <= min) max = min + 1;
    const step = isNum(t.step) && t.step > 0 ? t.step : (max - min) / 100;
    const dec = decimalsOf(step);
    const fmt = (v) => Number(v).toFixed(dec);

    const slider = el('input', '', row.el);
    slider.type = 'range';
    slider.min = String(min);
    slider.max = String(max);
    slider.step = String(step);

    const num = el('input', 'dbg-num', row.el);
    num.type = 'text';
    num.spellcheck = false;

    const v0 = Number(cur);
    slider.value = String(isFinite(v0) ? v0 : min);
    num.value = fmt(isFinite(v0) ? v0 : min);

    slider.addEventListener('input', () => {
      const v = parseFloat(slider.value);
      writeT(t, v);
      num.value = fmt(v);
      this._tick();
    });

    const commitText = () => {
      const v = parseFloat(num.value);
      if (isFinite(v)) {
        // text entry is allowed to exceed slider bounds — it's a debug panel
        writeT(t, v);
        slider.value = String(v);
        num.value = fmt(v);
        sfx(this.ctx, 'ui_click', { volume: 0.6 });
      } else {
        const back = Number(readT(t));
        num.value = fmt(isFinite(back) ? back : min);
      }
    };
    num.addEventListener('change', commitText);
    num.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') num.blur();
      else if (e.key === 'Escape') {
        const back = Number(readT(t));
        num.value = fmt(isFinite(back) ? back : min);
        num.blur();
      }
    });

    row.refresh = () => {
      const v = Number(readT(t));
      if (!isFinite(v)) return;
      const a = document.activeElement;
      if (a !== slider) slider.value = String(v);
      if (a !== num) num.value = fmt(v);
    };
    return row;
  }

  _applyFilter() {
    const f = this._filter;
    for (const gr of this._groupList) {
      let shown = 0;
      for (const row of gr.rows) {
        const show = !f || row.search.includes(f);
        row.visible = show;
        row.el.style.display = show ? '' : 'none';
        if (show) shown++;
      }
      gr.el.style.display = shown ? '' : 'none';
      // an active filter force-expands matching groups
      gr.open = f ? shown > 0 : !this._collapsed.get(gr.cat);
      gr.body.style.display = gr.open ? '' : 'none';
      gr.caret.textContent = gr.open ? '▾' : '▸';
    }
  }

  // ---- per-frame -----------------------------------------------------------------

  render(dt) {
    if (!this.visible) return;
    // live value readouts — values move under us (recoil recovery, feel
    // hitstop scalars, other panels). Throttled; skips collapsed/filtered rows
    // and controls the user is holding.
    this._refreshT -= dt;
    if (this._refreshT > 0) return;
    this._refreshT = 0.12;
    for (const gr of this._groupList) {
      if (!gr.open || gr.el.style.display === 'none') continue;
      for (const row of gr.rows) {
        if (row.visible) row.refresh();
      }
    }
  }
}
