// RANGE — ui/RangeMenu.js
// The test-facility control console. Opened with M anywhere, or E while
// standing within reach of the physical console (world.range.consoleMesh)
// and looking at it. Centered interactive panel:
//   TARGETS  — spawn per section / clear / reset all   (range:* events)
//   DRILLS   — flick / tracking                        (drill:start, auto-close)
//   TOGGLES  — infiniteAmmo / noHardLanding / sniperProjectile (ctx.cheats)
//   GRAVITY  — ctx.cheats.gravityScale slider 0.2–2
//   COURSE   — reset                                   (course:reset)
//   SETTINGS — sens/adsSensMult/fov/volumes sliders + viewBob/damageNumbers
import * as THREE from 'three';

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

const CSS = `
.rm-panel{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:640px;max-width:94vw;
  max-height:88vh;overflow-y:auto;overflow-x:hidden;background:rgba(10,14,20,0.88);
  border:1px solid rgba(125,249,255,0.28);backdrop-filter:blur(7px);box-shadow:0 0 34px rgba(0,0,0,0.65);
  color:#dfe7f0;font-family:'Segoe UI',system-ui,sans-serif;padding:14px 18px 14px;display:none;}
.rm-panel::-webkit-scrollbar{width:8px;}
.rm-panel::-webkit-scrollbar-thumb{background:rgba(125,249,255,0.22);}
.rm-head{display:flex;justify-content:space-between;align-items:center;}
.rm-title{font-size:13px;letter-spacing:.26em;color:#7df9ff;font-weight:600;}
.rm-title .kbd{border:1px solid rgba(125,249,255,.4);padding:0 5px;margin-left:8px;font-size:10px;color:#8fa3b8;letter-spacing:0;}
.rm-x{cursor:pointer;color:#8fa3b8;font-size:15px;line-height:1;padding:2px 6px;border:1px solid transparent;}
.rm-x:hover{color:#7df9ff;border-color:rgba(125,249,255,.4);}
.rm-sub{font-size:9px;letter-spacing:.34em;color:#66788c;margin:2px 0 6px;}
.rm-cols{display:grid;grid-template-columns:1fr 1fr;gap:0 24px;}
.rm-sec{font-size:10px;letter-spacing:.24em;color:#7df9ff;opacity:.85;margin:13px 0 6px;
  border-bottom:1px solid rgba(125,249,255,0.14);padding-bottom:3px;}
.rm-grid{display:grid;gap:5px;}
.rm-btn{padding:7px 4px;font-size:10px;letter-spacing:.1em;text-align:center;cursor:pointer;text-transform:uppercase;
  background:rgba(125,249,255,0.06);border:1px solid rgba(125,249,255,0.26);color:#bfe9ee;}
.rm-btn:hover{background:rgba(125,249,255,0.18);color:#eaffff;border-color:#7df9ff;}
.rm-btn:active{background:rgba(125,249,255,0.3);}
.rm-btn.warn{border-color:rgba(255,138,90,0.4);color:#ffc9a8;background:rgba(255,120,60,0.05);}
.rm-btn.warn:hover{background:rgba(255,120,60,0.16);color:#ffe2cd;border-color:#ff9a4d;}
.rm-row{display:grid;grid-template-columns:104px 1fr 44px;gap:8px;align-items:center;margin:6px 0;}
.rm-row label{font-size:10.5px;color:#9fb2c5;letter-spacing:.04em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.rm-row input[type=range]{width:100%;accent-color:#7df9ff;height:14px;cursor:pointer;}
.rm-val{font-family:Consolas,monospace;font-size:11px;color:#7df9ff;text-align:right;}
.rm-check{display:flex;align-items:center;gap:8px;font-size:11px;color:#bfc9d6;cursor:pointer;padding:4px 0;letter-spacing:.05em;}
.rm-check input{accent-color:#7df9ff;cursor:pointer;}
.rm-foot{margin-top:14px;text-align:center;font-size:9px;letter-spacing:.24em;color:#66788c;}
`;

export class RangeMenu {
  constructor(ctx) {
    this.ctx = ctx;
    this.visible = false;

    // feel-relevant numbers — tunable (§8)
    this.tune = {
      consoleDist: 3,   // m — E-to-open reach around the console
      consoleDot: 0.9,  // facing dot threshold
    };
    ctx.tunables.push(
      { cat: 'ui', key: 'consoleUseDist', obj: this.tune, prop: 'consoleDist', min: 1, max: 8, step: 0.1, label: 'console use dist m' },
      { cat: 'ui', key: 'consoleUseDot', obj: this.tune, prop: 'consoleDot', min: 0.5, max: 0.99, step: 0.01, label: 'console use facing dot' },
    );

    this._refreshers = [];
    this._refreshT = 0;
    this._lastTick = 0;
    this._vA = new THREE.Vector3();
    this._vB = new THREE.Vector3();

    injectCss('rm-css', CSS);
    this._build();

    ctx.input.onKeyDown('KeyM', () => this.toggle());
    ctx.input.onKeyDown('KeyE', () => {
      if (this.visible) this.close();
      else if (this._nearConsole()) this.open();
    });
    ctx.input.onKeyDown('Escape', () => { if (this.visible) this.close(); });
  }

  // ---- panel plumbing -------------------------------------------------------

  _closeOthers() {
    const ui = this.ctx.ui || {};
    ui.wheel?.cancel?.();
    for (const p of [ui.editor, ui.debug]) {
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
    this.ctx.input.pushUI('rangeMenu');
    this._closeOthers();
    this._refreshAll();
    this.root.style.display = 'block';
    this.ctx.events.emit('ui:open', { id: 'rangeMenu' });
    sfx(this.ctx, 'ui_open');
  }

  close(silent = false) {
    if (!this.visible) return;
    this.visible = false;
    this.root.style.display = 'none';
    this.ctx.input.popUI('rangeMenu');
    this.ctx.events.emit('ui:close', { id: 'rangeMenu' });
    if (!silent) sfx(this.ctx, 'ui_close');
  }

  _tick() {
    const n = performance.now();
    if (n - this._lastTick > 45) {
      this._lastTick = n;
      sfx(this.ctx, 'ui_tick', { volume: 0.5 });
    }
  }

  // ---- console proximity (E key) ---------------------------------------------

  _nearConsole() {
    const mesh = this.ctx.world?.range?.consoleMesh;
    const cam = this.ctx.camera;
    if (!mesh || !cam) return false;
    mesh.getWorldPosition(this._vA);
    this._vA.sub(cam.position);
    const dist = this._vA.length();
    if (dist > this.tune.consoleDist || dist < 1e-4) return false;
    this._vA.normalize();
    cam.getWorldDirection(this._vB);
    return this._vA.dot(this._vB) > this.tune.consoleDot;
  }

  // ---- DOM ---------------------------------------------------------------------

  _build() {
    const root = el('div', 'rm-panel interactive', document.getElementById('ui'));
    this.root = root;

    const head = el('div', 'rm-head', root);
    el('div', 'rm-title', head, 'RANGE CONSOLE<span class="kbd">M</span>');
    const x = el('div', 'rm-x', head, '✕');
    x.addEventListener('click', () => this.close());
    el('div', 'rm-sub', root, 'TEST FACILITY CONTROL');

    const cols = el('div', 'rm-cols', root);
    const L = el('div', '', cols);
    const R = el('div', '', cols);

    // ---- TARGETS ----
    el('div', 'rm-sec', L, 'TARGETS');
    const tg = el('div', 'rm-grid', L);
    tg.style.gridTemplateColumns = '1fr 1fr';
    for (const s of ['gallery', 'precision', 'moving', 'cqc']) {
      this._btn(tg, 'SPAWN ' + s.toUpperCase(), () =>
        this.ctx.events.emit('range:spawn', { section: s }));
    }
    const tgAll = el('div', 'rm-grid', L);
    tgAll.style.gridTemplateColumns = '1fr';
    tgAll.style.marginTop = '5px';
    this._btn(tgAll, 'SPAWN ALL', () =>
      this.ctx.events.emit('range:spawn', { section: 'all' }));
    const tgOps = el('div', 'rm-grid', L);
    tgOps.style.gridTemplateColumns = '1fr 1fr';
    tgOps.style.marginTop = '5px';
    this._btn(tgOps, 'CLEAR', () => this.ctx.events.emit('range:clear', {}), 'warn');
    this._btn(tgOps, 'RESET ALL', () => this.ctx.events.emit('range:resetAll', {}), 'warn');

    // ---- DRILLS ----
    el('div', 'rm-sec', L, 'DRILLS');
    const dr = el('div', 'rm-grid', L);
    dr.style.gridTemplateColumns = '1fr 1fr';
    this._btn(dr, 'FLICK', () => {
      this.ctx.events.emit('drill:start', { type: 'flick' });
      this.close(true); // back to gameplay immediately — ui_click already played
    });
    this._btn(dr, 'TRACKING', () => {
      this.ctx.events.emit('drill:start', { type: 'tracking' });
      this.close(true);
    });

    // ---- COURSE ----
    el('div', 'rm-sec', L, 'MOVEMENT COURSE');
    const co = el('div', 'rm-grid', L);
    co.style.gridTemplateColumns = '1fr';
    this._btn(co, 'RESET COURSE', () => this.ctx.events.emit('course:reset', {}));

    // ---- TOGGLES ----
    el('div', 'rm-sec', R, 'TOGGLES');
    const c = this.ctx.cheats;
    this._check(R, 'INFINITE AMMO', () => !!c.infiniteAmmo, (v) => { c.infiniteAmmo = v; });
    this._check(R, 'NO HARD LANDING', () => !!c.noHardLanding, (v) => { c.noHardLanding = v; });
    this._check(R, 'SNIPER PROJECTILE MODE', () => !!c.sniperProjectile, (v) => { c.sniperProjectile = v; });

    // ---- GRAVITY ----
    el('div', 'rm-sec', R, 'GRAVITY');
    this._slider(R, 'SCALE', 0.2, 2, 0.05,
      () => c.gravityScale ?? 1, (v) => { c.gravityScale = v; }, 2);

    // ---- SETTINGS ----
    el('div', 'rm-sec', R, 'SETTINGS');
    const st = this.ctx.settings;
    this._slider(R, 'SENSITIVITY', 0.1, 10, 0.05,
      () => st.get('sens', 2.5), (v) => st.set('sens', v), 2);
    this._slider(R, 'ADS SENS ×', 0.1, 2, 0.05,
      () => st.get('adsSensMult', 0.8), (v) => st.set('adsSensMult', v), 2);
    this._slider(R, 'FOV', 60, 130, 1,
      () => st.get('fov', 100), (v) => st.set('fov', v), 0);
    this._slider(R, 'MASTER VOL', 0, 1, 0.05,
      () => st.get('volMaster', 0.8), (v) => st.set('volMaster', v), 2);
    this._slider(R, 'SFX VOL', 0, 1, 0.05,
      () => st.get('volSfx', 1), (v) => st.set('volSfx', v), 2);
    this._check(R, 'VIEW BOB', () => !!st.get('viewBob', true), (v) => st.set('viewBob', v));
    this._check(R, 'DAMAGE NUMBERS', () => !!st.get('damageNumbers', true), (v) => st.set('damageNumbers', v));

    el('div', 'rm-foot', root, 'M · E · ESC — CLOSE');
  }

  _btn(parent, label, fn, cls) {
    const b = el('div', 'rm-btn' + (cls ? ' ' + cls : ''), parent, label);
    b.addEventListener('click', () => {
      sfx(this.ctx, 'ui_click');
      fn();
    });
    return b;
  }

  _slider(parent, label, min, max, step, get, set, dec) {
    const row = el('div', 'rm-row', parent);
    el('label', '', row, label);
    const input = el('input', '', row);
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    const val = el('div', 'rm-val', row);
    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      set(v);
      val.textContent = v.toFixed(dec);
      this._tick();
    });
    this._refreshers.push(() => {
      if (document.activeElement === input) return;
      const v = Number(get() ?? min);
      input.value = String(v);
      val.textContent = v.toFixed(dec);
    });
  }

  _check(parent, label, get, set) {
    const lab = el('label', 'rm-check', parent);
    const input = el('input', '', lab);
    input.type = 'checkbox';
    el('span', '', lab, label);
    input.addEventListener('change', () => {
      set(input.checked);
      sfx(this.ctx, 'ui_click', { volume: 0.7 });
    });
    this._refreshers.push(() => {
      if (document.activeElement === input) return;
      input.checked = !!get();
    });
  }

  _refreshAll() {
    for (const fn of this._refreshers) fn();
  }

  // ---- per-frame -----------------------------------------------------------------

  render(dt) {
    if (!this.visible) return;
    // periodic re-sync — cheats/settings may be changed elsewhere (debug panel)
    this._refreshT -= dt;
    if (this._refreshT > 0) return;
    this._refreshT = 0.25;
    this._refreshAll();
  }
}
