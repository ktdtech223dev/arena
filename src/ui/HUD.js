// RANGE — ui/HUD.js
// Full-screen NON-interactive HUD layer: live crosshair, ammo/reload, gun
// name, speedometer + movement state, lap timer, TTK/DPS readouts, drill
// scoreboard, damage popups, console interact prompt, sniper scope overlay.
// Pure DOM/CSS/canvas appended into #ui. No 'interactive' class — the HUD
// never captures the pointer.
import * as THREE from 'three';
import { Crosshair } from './Crosshair.js';

const DEG2RAD = Math.PI / 180;

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

function fmtTime(sec) {
  if (sec == null || !isFinite(sec)) return '--:--.---';
  const t = Math.max(0, sec);
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const ms = Math.floor((t * 1000) % 1000);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

function lerpColor(a, b, t) {
  const k = Math.max(0, Math.min(1, t));
  const r = Math.round(a[0] + (b[0] - a[0]) * k);
  const g = Math.round(a[1] + (b[1] - a[1]) * k);
  const bl = Math.round(a[2] + (b[2] - a[2]) * k);
  return `rgb(${r},${g},${bl})`;
}

const CSS = `
.hud-root{position:absolute;inset:0;color:#dfe7f0;font-family:'Segoe UI',system-ui,-apple-system,sans-serif;}
.hud-panel{background:rgba(10,14,20,0.62);border:1px solid rgba(125,249,255,0.22);backdrop-filter:blur(4px);box-shadow:0 0 18px rgba(0,0,0,0.35);}
.hud-xhair{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);}
.hud-ammo{position:absolute;right:26px;bottom:24px;padding:10px 14px 12px;min-width:160px;text-align:right;}
.hud-gun{font-size:11px;letter-spacing:.22em;color:#7df9ff;opacity:.92;margin-bottom:3px;text-transform:uppercase;}
.hud-ammo-nums{display:flex;justify-content:flex-end;align-items:baseline;gap:7px;}
.hud-mag{font-size:34px;font-weight:700;line-height:1;color:#eaf6ff;font-variant-numeric:tabular-nums;text-shadow:0 0 12px rgba(125,249,255,.22);}
.hud-mag.low{color:#ff9a4d;text-shadow:0 0 12px rgba(255,120,40,.4);}
.hud-rsv{font-size:15px;color:#8fa3b8;font-variant-numeric:tabular-nums;}
.hud-reload{margin-top:8px;height:3px;background:rgba(125,249,255,.12);display:none;}
.hud-reload-fill{height:100%;width:0%;background:#7df9ff;box-shadow:0 0 8px rgba(125,249,255,.8);}
.hud-speed{position:absolute;left:26px;bottom:24px;padding:10px 14px 12px;min-width:196px;}
.hud-speed-row{display:flex;align-items:baseline;gap:7px;}
.hud-spd{font-size:34px;font-weight:700;line-height:1;color:#eaf6ff;font-variant-numeric:tabular-nums;}
.hud-spd-unit{font-size:11px;letter-spacing:.18em;color:#8fa3b8;}
.hud-bar{margin-top:7px;height:5px;background:rgba(125,249,255,.1);overflow:hidden;}
.hud-bar-fill{height:100%;width:0%;background:#7df9ff;box-shadow:0 0 10px rgba(125,249,255,.7);}
.hud-state{font-size:10.5px;letter-spacing:.26em;margin-top:6px;color:#9fb2c5;}
.hud-top{position:absolute;top:16px;left:50%;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:6px;text-align:center;}
.hud-timer{padding:6px 20px 8px;display:none;}
.hud-timer-big{font-size:24px;font-weight:700;font-variant-numeric:tabular-nums;color:#eaf6ff;letter-spacing:.06em;}
.hud-timer-best{font-size:10px;letter-spacing:.2em;color:#8fa3b8;margin-top:1px;min-height:12px;}
.hud-flash{font-size:21px;font-weight:700;letter-spacing:.14em;color:#7df9ff;text-shadow:0 0 16px rgba(125,249,255,.6);display:none;}
.hud-flash.gold{color:#ffd66e;text-shadow:0 0 18px rgba(255,200,80,.75);}
.hud-gate{font-size:11px;letter-spacing:.3em;color:#7df9ff;display:none;text-shadow:0 0 10px rgba(125,249,255,.5);}
.hud-drill{padding:7px 18px 9px;display:none;}
.hud-drill-type{font-size:11px;letter-spacing:.22em;color:#7df9ff;}
.hud-drill-line{font-size:15px;margin-top:3px;font-variant-numeric:tabular-nums;color:#eaf6ff;}
.hud-drill-line .cy{color:#7df9ff;font-weight:700;}
.hud-drill-end{padding:11px 26px 13px;display:none;}
.hud-de-title{font-size:11px;letter-spacing:.24em;color:#7df9ff;}
.hud-de-score{font-size:32px;font-weight:700;color:#ffd66e;font-variant-numeric:tabular-nums;text-shadow:0 0 16px rgba(255,200,80,.5);margin:2px 0;}
.hud-de-sub{font-size:11.5px;letter-spacing:.08em;color:#bfc9d6;font-variant-numeric:tabular-nums;}
.hud-stats{position:absolute;right:26px;top:37%;text-align:right;display:flex;flex-direction:column;gap:5px;}
.hud-ttk,.hud-dps{font-size:13px;letter-spacing:.1em;color:#bfe9ee;text-shadow:0 1px 3px rgba(0,0,0,.9),0 0 8px rgba(0,0,0,.6);display:none;font-variant-numeric:tabular-nums;}
.hud-dps{color:#ffd66e;}
.hud-prompt{position:absolute;left:50%;bottom:21%;transform:translateX(-50%);padding:7px 15px;font-size:12px;letter-spacing:.2em;color:#dfe7f0;opacity:0;transition:opacity .16s;}
.hud-prompt .key{display:inline-block;border:1px solid #7df9ff;color:#7df9ff;padding:0 6px;margin-right:9px;font-weight:700;letter-spacing:0;}
.hud-pops{position:absolute;inset:0;overflow:hidden;}
.hud-pop{position:absolute;left:0;top:0;font-size:16px;font-weight:700;color:#eaf6ff;text-shadow:0 0 6px rgba(0,0,0,.95),0 1px 2px rgba(0,0,0,.9);will-change:transform,opacity;white-space:nowrap;display:none;font-variant-numeric:tabular-nums;}
.hud-pop.gold{color:#ffd66e;font-size:17px;}
.hud-pop.kill{color:#ffd66e;font-size:21px;letter-spacing:.04em;}
.hud-scope{position:absolute;inset:0;display:none;}
`;

const STATE_COLORS = {
  GROUNDED: '#9fb2c5',
  AIRBORNE: '#7df9ff',
  SLIDING: '#ffb14d',
  WALLRUN: '#7dff9a',
};

const CYAN = [125, 249, 255];
const ORANGE = [255, 148, 64];
const MAX_POPUPS = 40;

export class HUD {
  constructor(ctx) {
    this.ctx = ctx;
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);

    // feel-relevant numbers — all tunable (§8)
    this.tune = {
      popupRise: 74,      // px/s float speed of damage numbers
      popupLife: 1.05,    // s
      speedMax: 18,       // m/s at which the speed bar is full
      speedHot: 13,       // m/s at which the bar is fully orange
      promptDist: 3,      // m — console interact prompt range
      promptDot: 0.9,     // facing dot threshold
      ttkHold: 4,         // s before TTK readout fades
      dpsHold: 1.2,       // s of silence before DPS readout fades
      drillEndHold: 5,    // s the drill results panel stays up
      scopeRadius: 0.4,   // scope cutout radius, fraction of min(view w,h)
    };
    this._regTunables();

    injectCss('hud-css', CSS);
    this._build();

    this.crosshair = new Crosshair(this._xhairCanvas);
    this._sizeXhair();

    // state
    this._gunId = null;
    this._ammoStr = '';
    this._magLow = false;
    this._spdStr = '';
    this._stateStr = '';
    this._reload = { active: false, t: 0, total: 0, perPhase: false, dur: 0 };
    this._scoped = false;
    this._scopeDef = null;
    this._flashT = 0;
    this._gateT = 0;
    this._ttkT = Infinity;
    this._dpsT = Infinity;
    this._drillEndT = -1;
    this._promptT = 0;
    this._promptShown = false;

    this._pops = [];
    this._popPool = [];
    this._popCount = 0;

    this._v1 = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._v3 = new THREE.Vector3();

    this._bindEvents();

    // re-apply crosshair config when the editor writes settings
    ctx.settings.onChange('crosshair', () => {
      if (this._gunId) this._applyCrosshair(this._gunId);
    });
  }

  // ---- construction --------------------------------------------------------

  _regTunables() {
    const T = this.tune;
    const push = (key, min, max, step, label) =>
      this.ctx.tunables.push({ cat: 'ui', key, obj: T, prop: key, min, max, step, label });
    push('popupRise', 0, 300, 2, 'popup rise px/s');
    push('popupLife', 0.2, 3, 0.05, 'popup life s');
    push('speedMax', 5, 40, 0.5, 'speed bar max m/s');
    push('speedHot', 3, 40, 0.5, 'speed full-orange m/s');
    push('promptDist', 1, 8, 0.1, 'console prompt dist');
    push('promptDot', 0.5, 0.99, 0.01, 'console prompt dot');
    push('ttkHold', 0.5, 10, 0.1, 'ttk hold s');
    push('dpsHold', 0.2, 5, 0.1, 'dps hold s');
    push('drillEndHold', 1, 15, 0.5, 'drill results hold s');
    push('scopeRadius', 0.2, 0.49, 0.01, 'scope radius frac');
  }

  _build() {
    const root = el('div', 'hud-root', document.getElementById('ui'));
    this.root = root;

    // crosshair
    this._xhairCanvas = el('canvas', 'hud-xhair', root);

    // popups layer (under panels)
    this._popsEl = el('div', 'hud-pops', root);

    // ammo (bottom-right)
    const ammo = el('div', 'hud-ammo hud-panel', root);
    this._nameEl = el('div', 'hud-gun', ammo, '&nbsp;');
    const nums = el('div', 'hud-ammo-nums', ammo);
    this._magEl = el('span', 'hud-mag', nums, '--');
    this._rsvEl = el('span', 'hud-rsv', nums, '/ --');
    this._reloadBar = el('div', 'hud-reload', ammo);
    this._reloadFill = el('div', 'hud-reload-fill', this._reloadBar);

    // speedometer (bottom-left)
    const spd = el('div', 'hud-speed hud-panel', root);
    const row = el('div', 'hud-speed-row', spd);
    this._spdEl = el('span', 'hud-spd', row, '0.0');
    el('span', 'hud-spd-unit', row, 'M/S');
    const bar = el('div', 'hud-bar', spd);
    this._spdFill = el('div', 'hud-bar-fill', bar);
    this._stateEl = el('div', 'hud-state', spd, 'GROUNDED');

    // top-center column: lap timer, flashes, drill boards
    const top = el('div', 'hud-top', root);
    this._timerWrap = el('div', 'hud-timer hud-panel', top);
    this._timerBig = el('div', 'hud-timer-big', this._timerWrap, '00:00.000');
    this._timerBest = el('div', 'hud-timer-best', this._timerWrap, '');
    this._flashEl = el('div', 'hud-flash', top);
    this._gateEl = el('div', 'hud-gate', top);
    this._drillEl = el('div', 'hud-drill hud-panel', top);
    this._drillEndEl = el('div', 'hud-drill-end hud-panel', top);

    // right-side stats
    const stats = el('div', 'hud-stats', root);
    this._dpsEl = el('div', 'hud-dps', stats);
    this._ttkEl = el('div', 'hud-ttk', stats);

    // interact prompt
    this._promptEl = el('div', 'hud-prompt hud-panel', root,
      '<span class="key">E</span>RANGE CONSOLE');

    // scope overlay (topmost within HUD)
    this._scopeCanvas = el('canvas', 'hud-scope', root);
  }

  _sizeXhair() {
    const S = 320; // CSS px square — plenty of room for bloom
    this._xhairCanvas.width = Math.round(S * this.dpr);
    this._xhairCanvas.height = Math.round(S * this.dpr);
    this._xhairCanvas.style.width = S + 'px';
    this._xhairCanvas.style.height = S + 'px';
    this.crosshair.pixelScale = this.dpr;
  }

  // ---- events ---------------------------------------------------------------

  _bindEvents() {
    const ev = this.ctx.events;

    ev.on('weapon:reload_start', (d) => {
      const def = d?.def;
      const phases = (d?.empty && def?.reload?.emptyPhases) ? def.reload.emptyPhases : def?.reload?.phases;
      let total = 0;
      if (Array.isArray(phases)) for (const p of phases) total += p?.t || 0;
      this._reload.active = true;
      this._reload.t = 0;
      this._reload.total = total;
      this._reload.perPhase = !!def?.reload?.perShell;
      this._reload.dur = 0;
      this._reloadBar.style.display = 'block';
      this._reloadFill.style.width = '0%';
    });

    ev.on('weapon:reload_phase', (d) => {
      if (!this._reload.active || !this._reload.perPhase) return;
      this._reload.t = 0;
      this._reload.dur = d?.duration || 0;
    });

    ev.on('weapon:reload_end', () => {
      this._reload.active = false;
      this._reloadBar.style.display = 'none';
    });

    ev.on('weapon:ads', (d) => {
      if (!d?.def?.scope) return;
      this._scopeDef = d.def;
      this._setScope(!!d.on);
    });
    ev.on('weapon:holster', () => this._setScope(false));
    ev.on('weapon:equip', (d) => {
      this._setScope(false);
      // polling in render() handles the rest, but apply eagerly for zero-lag
      const id = d?.def?.id;
      if (id && id !== this._gunId) this._onGunChange(d.def);
    });

    ev.on('target:hit', (d) => {
      if (!d || !d.point) return;
      if (!this.ctx.settings.get('damageNumbers', true)) return;
      const gold = d.zone === 'head' || d.zone === 'bull';
      this._popup(d.point, String(Math.round(d.damage ?? 0)), gold ? 'gold' : '');
      if (d.kill && d.points != null) this._popup(d.point, '+' + Math.round(d.points), 'kill');
    });

    ev.on('course:finish', (d) => {
      const best = !!d?.best;
      this._flashEl.textContent = (best ? 'NEW BEST  ' : 'FINISH  ') + fmtTime(d?.time);
      this._flashEl.className = 'hud-flash' + (best ? ' gold' : '');
      this._flashEl.style.display = 'block';
      this._flashEl.style.opacity = '1';
      this._flashT = 3.5;
    });

    ev.on('course:gate', (d) => {
      let n = (d?.index ?? 0) + 1;
      const total = d?.total ?? 0;
      if (total && n > total) n = d.index; // tolerate 1-based indices
      this._gateEl.textContent = total ? `GATE ${n}/${total}` : 'GATE';
      this._gateEl.style.display = 'block';
      this._gateEl.style.opacity = '1';
      this._gateT = 1.4;
    });

    ev.on('course:reset', () => {
      this._flashT = 0;
      this._flashEl.style.display = 'none';
      this._gateT = 0;
      this._gateEl.style.display = 'none';
    });

    ev.on('stats:ttk', (d) => {
      if (!d) return;
      const defs = this.ctx.weapons?.defs;
      const name = defs?.find?.((x) => x.id === d.gunId)?.name || d.gunId || '?';
      this._ttkEl.textContent = `TTK ${String(name).toUpperCase()}: ${Math.round(d.ms ?? 0)}ms`;
      this._ttkEl.style.display = 'block';
      this._ttkEl.style.opacity = '1';
      this._ttkT = 0;
    });

    ev.on('stats:dps', (d) => {
      if (!d) return;
      this._dpsEl.textContent = `DPS ${Math.round(d.dps ?? 0)}`;
      this._dpsEl.style.display = 'block';
      this._dpsEl.style.opacity = '1';
      this._dpsT = 0;
    });

    ev.on('drill:start', () => {
      this._drillEndT = -1;
      this._drillEndEl.style.display = 'none';
      this._drillEl.style.display = 'none';
    });

    ev.on('drill:tick', (d) => {
      if (!d) return;
      this._drillEndT = -1;
      this._drillEndEl.style.display = 'none';
      this._drillEl.style.display = 'block';
      const tl = Math.max(0, d.timeLeft ?? 0);
      this._drillEl.innerHTML =
        `<div class="hud-drill-type">${String(d.type || '').toUpperCase()} DRILL — ${tl.toFixed(1)}s</div>` +
        `<div class="hud-drill-line"><span class="cy">${d.score ?? 0}</span> PTS · ` +
        `${d.hits ?? 0} HIT · ${d.misses ?? 0} MISS</div>`;
    });

    ev.on('drill:end', (d) => {
      if (!d) return;
      this._drillEl.style.display = 'none';
      let acc = d.accuracy ?? 0;
      if (acc <= 1.0001) acc *= 100; // accept 0..1 or 0..100
      const rx = isFinite(d.avgReactionMs) ? `${Math.round(d.avgReactionMs)}ms AVG REACTION · ` : '';
      this._drillEndEl.innerHTML =
        `<div class="hud-de-title">${String(d.type || '').toUpperCase()} DRILL COMPLETE</div>` +
        `<div class="hud-de-score">${d.score ?? 0}</div>` +
        `<div class="hud-de-sub">${Math.round(acc)}% ACC · ${rx}${d.hits ?? 0} HIT / ${d.misses ?? 0} MISS</div>`;
      this._drillEndEl.style.display = 'block';
      this._drillEndEl.style.opacity = '1';
      this._drillEndT = this.tune.drillEndHold;
    });
  }

  // ---- crosshair / gun ------------------------------------------------------

  _onGunChange(def) {
    this._gunId = def.id;
    this._nameEl.textContent = (def.name || def.id || '').toUpperCase();
    this._applyCrosshair(def.id);
    this._reload.active = false;
    this._reloadBar.style.display = 'none';
  }

  _applyCrosshair(gunId) {
    const cfg = this.ctx.settings.get(`crosshair.${gunId}`, null);
    this.crosshair.setConfig(cfg || {});
  }

  // ---- scope ----------------------------------------------------------------

  _setScope(on) {
    if (on === this._scoped) return;
    this._scoped = on;
    this._scopeCanvas.style.display = on ? 'block' : 'none';
    this._xhairCanvas.style.display = on ? 'none' : 'block';
    if (on) this._drawScope();
    const vm = this.ctx.viewmodel;
    if (vm?.scene) vm.scene.visible = !on;
  }

  _drawScope() {
    const cv = this._scopeCanvas;
    cv.width = Math.round(this.w * this.dpr);
    cv.height = Math.round(this.h * this.dpr);
    cv.style.width = this.w + 'px';
    cv.style.height = this.h + 'px';
    const g = cv.getContext('2d');
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const w = this.w, h = this.h;
    const cx = w / 2, cy = h / 2;
    const R = Math.min(w, h) * this.tune.scopeRadius;

    g.clearRect(0, 0, w, h);
    g.fillStyle = 'rgba(3,5,8,0.99)';
    g.fillRect(0, 0, w, h);

    // circular cutout
    g.globalCompositeOperation = 'destination-out';
    g.beginPath();
    g.arc(cx, cy, R, 0, Math.PI * 2);
    g.fill();
    g.globalCompositeOperation = 'source-over';

    // rim vignette inside the glass
    const grad = g.createRadialGradient(cx, cy, R * 0.6, cx, cy, R);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(0.82, 'rgba(0,0,0,0.26)');
    grad.addColorStop(1, 'rgba(0,0,0,0.75)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(cx, cy, R + 1, 0, Math.PI * 2);
    g.fill();

    // rim rings
    g.lineWidth = 5;
    g.strokeStyle = 'rgba(2,3,5,1)';
    g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 1;
    g.strokeStyle = 'rgba(125,249,255,0.35)';
    g.beginPath(); g.arc(cx, cy, R - 3.5, 0, Math.PI * 2); g.stroke();

    // main crosslines
    g.strokeStyle = 'rgba(8,12,14,0.94)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(cx - R, cy); g.lineTo(cx + R, cy);
    g.moveTo(cx, cy - R); g.lineTo(cx, cy + R);
    g.stroke();

    // mil ticks — alternating short/long every R/8 along both axes
    g.lineWidth = 1.5;
    g.beginPath();
    const step = R / 8;
    for (let i = 1; i <= 7; i++) {
      const d = i * step;
      const L = i % 2 === 0 ? 9 : 5;
      g.moveTo(cx + d, cy - L); g.lineTo(cx + d, cy + L);
      g.moveTo(cx - d, cy - L); g.lineTo(cx - d, cy + L);
      g.moveTo(cx - L, cy + d); g.lineTo(cx + L, cy + d);
      g.moveTo(cx - L, cy - d); g.lineTo(cx + L, cy - d);
    }
    g.stroke();

    // fine center dot
    g.fillStyle = 'rgba(125,249,255,0.9)';
    g.beginPath();
    g.arc(cx, cy, 1.4, 0, Math.PI * 2);
    g.fill();

    // magnification label
    const fovScale = this._scopeDef?.adsFovScale;
    if (fovScale && fovScale > 0 && fovScale < 1) {
      g.fillStyle = 'rgba(125,249,255,0.55)';
      g.font = '600 12px Consolas, monospace';
      g.textAlign = 'center';
      g.fillText(`${(1 / fovScale).toFixed(1)}×`, cx, cy + R - 26);
    }
  }

  // ---- popups ----------------------------------------------------------------

  _makePop() {
    const e = el('div', 'hud-pop', this._popsEl);
    return { el: e, world: new THREE.Vector3(), age: 0, life: 1, ox: 0, oy: 0 };
  }

  _popup(worldPos, text, cls) {
    let p;
    if (this._popPool.length) p = this._popPool.pop();
    else if (this._popCount < MAX_POPUPS) { p = this._makePop(); this._popCount++; }
    else p = this._pops.shift(); // recycle the oldest live one
    if (!p) return;
    p.el.className = 'hud-pop' + (cls ? ' ' + cls : '');
    p.el.textContent = text;
    p.el.style.display = 'block';
    p.el.style.opacity = '1';
    p.world.copy(worldPos);
    p.age = 0;
    p.offAge = 0;
    p.life = this.tune.popupLife * (cls === 'kill' ? 1.35 : 1);
    p.ox = (Math.random() - 0.5) * 30;
    p.oy = -Math.random() * 14 - (cls === 'kill' ? 22 : 0);
    this._pops.push(p);
  }

  _updatePopups(dt) {
    const cam = this.ctx.camera;
    const v = this._v1;
    for (let i = this._pops.length - 1; i >= 0; i--) {
      const p = this._pops[i];
      v.copy(p.world).project(cam);
      const onScreen = !(v.z > 1 || v.z < -1);
      // advance visible age only while on-screen so a popup you glance away from
      // resumes cleanly; a separate off-screen timer prevents culled ones leaking.
      if (onScreen) p.age += dt;
      else p.offAge += dt;
      if (p.age >= p.life || p.offAge >= p.life) {
        p.el.style.display = 'none';
        this._pops.splice(i, 1);
        this._popPool.push(p);
        continue;
      }
      if (!onScreen) { p.el.style.display = 'none'; continue; }
      p.el.style.display = 'block';
      const sx = (v.x * 0.5 + 0.5) * this.w + p.ox;
      const sy = (-v.y * 0.5 + 0.5) * this.h + p.oy - p.age * this.tune.popupRise;
      const k = p.age / p.life;
      const popIn = Math.min(1, p.age / 0.08);
      const scale = 0.55 + 0.45 * popIn;
      p.el.style.opacity = k > 0.55 ? String(Math.max(0, 1 - (k - 0.55) / 0.45)) : '1';
      p.el.style.transform = `translate(${sx.toFixed(1)}px,${sy.toFixed(1)}px) translate(-50%,-100%) scale(${scale.toFixed(3)})`;
    }
  }

  // ---- per-frame -------------------------------------------------------------

  render(dt) {
    const ctx = this.ctx;

    // gun change poll (robust even if the initial equip fired before we existed)
    const def = ctx.weapons?.current?.def;
    if (def && def.id !== this._gunId) this._onGunChange(def);

    // crosshair
    if (!this._scoped) {
      const spreadDeg = ctx.weapons?.getSpreadDeg?.() ?? 0;
      const fov = ctx.camera?.fov ?? 100;
      const px = Math.tan(spreadDeg * DEG2RAD) / Math.tan(fov * 0.5 * DEG2RAD) * (this.h * 0.5);
      this.crosshair.draw(px);
    }

    // ammo
    const wep = ctx.weapons?.current;
    const mag = wep?.magAmmo;
    const rsv = ctx.cheats?.infiniteAmmo ? '∞' : wep?.reserveAmmo;
    const ammoStr = `${mag}/${rsv}`;
    if (ammoStr !== this._ammoStr) {
      this._ammoStr = ammoStr;
      this._magEl.textContent = mag == null ? '--' : String(mag);
      this._rsvEl.textContent = '/ ' + (rsv == null ? '--' : String(rsv));
      const magSize = wep?.def?.mag || 0;
      const low = magSize > 0 && typeof mag === 'number' && mag <= Math.max(1, Math.round(magSize * 0.25));
      if (low !== this._magLow) {
        this._magLow = low;
        this._magEl.classList.toggle('low', low);
      }
    }

    // reload bar
    if (this._reload.active) {
      this._reload.t += dt;
      let frac = 0;
      if (this._reload.perPhase) {
        frac = this._reload.dur > 0 ? Math.min(1, this._reload.t / this._reload.dur) : 0;
      } else {
        frac = this._reload.total > 0 ? Math.min(1, this._reload.t / this._reload.total) : 0;
      }
      this._reloadFill.style.width = (frac * 100).toFixed(1) + '%';
    }

    // speedometer
    const spd = ctx.player?.controller?.horizontalSpeed?.() ?? 0;
    const spdStr = spd.toFixed(1);
    if (spdStr !== this._spdStr) {
      this._spdStr = spdStr;
      this._spdEl.textContent = spdStr;
    }
    const fill = Math.min(1, spd / Math.max(0.001, this.tune.speedMax));
    this._spdFill.style.width = (fill * 100).toFixed(1) + '%';
    const heat = Math.min(1, spd / Math.max(0.001, this.tune.speedHot));
    const col = lerpColor(CYAN, ORANGE, heat);
    this._spdFill.style.background = col;
    this._spdFill.style.boxShadow = `0 0 10px ${col}`;
    const mstate = ctx.player?.movement?.state || '—';
    if (mstate !== this._stateStr) {
      this._stateStr = mstate;
      this._stateEl.textContent = mstate;
      this._stateEl.style.color = STATE_COLORS[mstate] || '#9fb2c5';
    }

    // lap timer
    const course = ctx.world?.course;
    if (course?.running) {
      if (this._timerWrap.style.display !== 'block') this._timerWrap.style.display = 'block';
      this._timerBig.textContent = fmtTime(course.currentTime ?? 0);
      const bt = course.bestTime;
      this._timerBest.textContent = bt != null && isFinite(bt) ? 'BEST ' + fmtTime(bt) : '';
    } else if (this._timerWrap.style.display !== 'none') {
      this._timerWrap.style.display = 'none';
    }

    // transient flashes
    if (this._flashT > 0) {
      this._flashT -= dt;
      if (this._flashT <= 0) this._flashEl.style.display = 'none';
      else if (this._flashT < 0.6) this._flashEl.style.opacity = String(this._flashT / 0.6);
    }
    if (this._gateT > 0) {
      this._gateT -= dt;
      if (this._gateT <= 0) this._gateEl.style.display = 'none';
      else if (this._gateT < 0.4) this._gateEl.style.opacity = String(this._gateT / 0.4);
    }
    if (this._drillEndT > 0) {
      this._drillEndT -= dt;
      if (this._drillEndT <= 0) this._drillEndEl.style.display = 'none';
      else if (this._drillEndT < 0.6) this._drillEndEl.style.opacity = String(this._drillEndT / 0.6);
    }

    // TTK / DPS fades
    if (this._ttkT < Infinity) {
      this._ttkT += dt;
      const hold = this.tune.ttkHold;
      if (this._ttkT > hold + 0.6) {
        this._ttkEl.style.display = 'none';
        this._ttkT = Infinity;
      } else if (this._ttkT > hold) {
        this._ttkEl.style.opacity = String(Math.max(0, 1 - (this._ttkT - hold) / 0.6));
      }
    }
    if (this._dpsT < Infinity) {
      this._dpsT += dt;
      const hold = this.tune.dpsHold;
      if (this._dpsT > hold + 0.4) {
        this._dpsEl.style.display = 'none';
        this._dpsT = Infinity;
      } else if (this._dpsT > hold) {
        this._dpsEl.style.opacity = String(Math.max(0, 1 - (this._dpsT - hold) / 0.4));
      }
    }

    // popups
    if (this._pops.length) this._updatePopups(dt);

    // console prompt (throttled)
    this._promptT -= dt;
    if (this._promptT <= 0) {
      this._promptT = 0.12;
      let show = false;
      const mesh = ctx.world?.range?.consoleMesh;
      if (mesh && !ctx.input.uiOpen && !this._scoped) {
        mesh.getWorldPosition(this._v2);
        this._v2.sub(ctx.camera.position);
        const dist = this._v2.length();
        if (dist < this.tune.promptDist && dist > 1e-4) {
          this._v2.normalize();
          ctx.camera.getWorldDirection(this._v3);
          if (this._v2.dot(this._v3) > this.tune.promptDot) show = true;
        }
      }
      if (show !== this._promptShown) {
        this._promptShown = show;
        this._promptEl.style.opacity = show ? '1' : '0';
      }
    }
  }

  resize(w, h) {
    this.w = w;
    this.h = h;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (dpr !== this.dpr) {
      this.dpr = dpr;
      this._sizeXhair();
    }
    if (this._scoped) this._drawScope();
  }
}
