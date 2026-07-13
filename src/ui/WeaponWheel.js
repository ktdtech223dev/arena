// RANGE — ui/WeaponWheel.js
// Hold TAB: radial 5-segment weapon wheel on a canvas. Pointer lock is
// released while held (pushUI) so the mouse is free; hover by mouse angle
// from screen center; releasing TAB equips the hovered gun. Snappy
// scale-in, ui_tick on hover change.
function injectCss(id, text) {
  if (document.getElementById(id)) return;
  const s = document.createElement('style');
  s.id = id;
  s.textContent = text;
  document.head.appendChild(s);
}

function sfx(ctx, name, opts) {
  try { ctx.audio?.play?.(name, opts); } catch { /* audio optional */ }
}

const FALLBACK_GUNS = [
  { id: 'pistol', name: 'PISTOL', slot: 1 },
  { id: 'smg', name: 'SMG', slot: 2 },
  { id: 'shotgun', name: 'SHOTGUN', slot: 3 },
  { id: 'ar', name: 'AR', slot: 4 },
  { id: 'sniper', name: 'SNIPER', slot: 5 },
  { id: 'exotic', name: 'EXOTIC', slot: 6 },
  { id: 'sawblade', name: 'SAWBLADE', slot: 7 },
];

const SIZE = 440;       // CSS px canvas square
const R_OUT = 196;      // outer sector radius
const R_IN = 68;        // inner sector radius
const R_TEXT = 136;     // label radius
const DEG = Math.PI / 180;

const CSS = `
.wheel-wrap{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);display:none;
  filter:drop-shadow(0 0 30px rgba(0,0,0,0.7));will-change:transform,opacity;}
.wheel-wrap canvas{display:block;cursor:pointer;}
`;

// tiny primitive gun silhouettes, drawn centered at (x, y) in a ~48x22 box
function drawGlyph(g, id, x, y, color) {
  g.save();
  g.translate(x, y);
  g.fillStyle = color;
  switch (id) {
    case 'pistol':
      g.fillRect(-9, -7, 20, 7);      // slide
      g.fillRect(11, -5, 3, 3);       // muzzle
      g.save();
      g.translate(-4, 0);
      g.rotate(0.22);
      g.fillRect(0, 0, 6, 11);        // grip
      g.restore();
      break;
    case 'smg':
      g.fillRect(-20, -3, 6, 4);      // stock
      g.fillRect(-14, -6, 26, 9);     // body
      g.fillRect(12, -4, 8, 3);       // barrel
      g.fillRect(-2, 3, 6, 10);       // mag
      g.fillRect(-11, 3, 4, 6);       // grip
      break;
    case 'shotgun':
      g.fillRect(-24, -4, 10, 7);     // stock
      g.fillRect(-14, -5, 32, 6);     // receiver + barrel
      g.fillRect(18, -4, 6, 4);       // muzzle
      g.fillRect(-4, 1, 12, 5);       // pump
      break;
    case 'ar':
    case 'burst':
      g.fillRect(-23, -3, 7, 5);      // stock
      g.fillRect(-16, -6, 28, 8);     // body
      g.fillRect(12, -4, 11, 3);      // barrel
      g.fillRect(-8, -9, 10, 3);      // carry rail
      g.save();
      g.translate(0, 2);
      g.rotate(0.18);
      g.fillRect(0, 0, 6, 11);        // mag
      g.restore();
      break;
    case 'sniper':
      g.fillRect(-24, -3, 9, 6);      // stock
      g.fillRect(-15, -4, 26, 5);     // body
      g.fillRect(11, -3, 13, 3);      // long barrel
      g.fillRect(-7, -9, 13, 4);      // scope
      g.fillRect(-9, -8, 2, 3);       // scope cap
      g.fillRect(6, -8, 2, 3);        // scope cap
      g.fillRect(-2, 1, 5, 8);        // mag
      break;
    case 'exotic':
      g.fillRect(-20, -6, 34, 10);    // launcher tube
      g.fillRect(14, -7, 6, 12);      // muzzle mouth
      g.fillRect(-24, -5, 5, 8);      // rear vent
      g.fillRect(-8, 4, 6, 8);        // grip
      g.fillRect(-14, -11, 12, 4);    // top sight rail
      break;
    case 'sawblade': {
      g.fillRect(-22, -3, 22, 6);     // launcher body
      g.fillRect(-12, 3, 6, 8);       // grip
      // spinning blade disc at the muzzle
      const bx = 12, by = 0, br = 8;
      g.beginPath();
      g.arc(bx, by, br, 0, Math.PI * 2);
      g.fill();
      // teeth
      for (let t = 0; t < 6; t++) {
        const a = (t / 6) * Math.PI * 2 + 0.4;
        g.save();
        g.translate(bx + Math.cos(a) * br, by + Math.sin(a) * br);
        g.rotate(a);
        g.fillRect(-1.4, -1.4, 4, 2.8);
        g.restore();
      }
      break;
    }
    default:
      g.font = '700 16px Segoe UI, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText((id || '?')[0].toUpperCase(), 0, 0);
  }
  g.restore();
}

export class WeaponWheel {
  constructor(ctx) {
    this.ctx = ctx;
    this.visible = false;
    this.tune = { openSpeed: 11 }; // 1/s — snap-in rate
    ctx.tunables.push({
      cat: 'ui', key: 'wheelOpenSpeed', obj: this.tune, prop: 'openSpeed',
      min: 2, max: 30, step: 0.5, label: 'wheel open speed',
    });

    this._defs = FALLBACK_GUNS;
    this._hover = -1;
    this._anim = 0;
    this._moved = false;
    this._mx = window.innerWidth / 2;
    this._my = window.innerHeight / 2;
    this._dpr = Math.min(window.devicePixelRatio || 1, 2);

    injectCss('wheel-css', CSS);
    const wrap = document.createElement('div');
    wrap.className = 'wheel-wrap interactive';
    this._wrap = wrap;
    this._canvas = document.createElement('canvas');
    this._canvas.width = Math.round(SIZE * this._dpr);
    this._canvas.height = Math.round(SIZE * this._dpr);
    this._canvas.style.width = SIZE + 'px';
    this._canvas.style.height = SIZE + 'px';
    wrap.appendChild(this._canvas);
    document.getElementById('ui').appendChild(wrap);
    this._g = this._canvas.getContext('2d');

    window.addEventListener('mousemove', (e) => {
      this._mx = e.clientX;
      this._my = e.clientY;
      if (this.visible) this._moved = true;
    });
    this._canvas.addEventListener('click', () => {
      if (this.visible && this._hover >= 0) this.close(true);
    });

    ctx.input.onKeyDown('Tab', () => this.open());
    ctx.input.onKeyDown('Escape', () => { if (this.visible) this.close(false); });
  }

  _closeOthers() {
    const ui = this.ctx.ui || {};
    for (const p of [ui.editor, ui.rangeMenu, ui.debug]) {
      if (p && p !== this) p.close?.(true);
    }
  }

  /** Close without selecting and without sounds — another panel is taking over. */
  cancel() {
    if (!this.visible) return;
    this.visible = false;
    this._wrap.style.display = 'none';
    this.ctx.input.popUI('wheel');
    this.ctx.events.emit('ui:close', { id: 'wheel' });
  }

  open() {
    if (this.visible) return;
    // only from live gameplay — not over another panel or the lock hint
    if (this.ctx.input.uiOpen || !this.ctx.input.locked) return;
    const wm = this.ctx.weapons;
    const defs = wm?.defs;
    const all = Array.isArray(defs) && defs.length ? defs : FALLBACK_GUNS;
    // only show OWNED weapons (custom maps start with a stripped loadout)
    this._defs = wm?.acquired ? all.filter((d) => wm.acquired.has(d.id)) : all;
    if (!this._defs.length) this._defs = all;
    this._closeOthers();
    this.visible = true;
    this._hover = -1;
    this._moved = false;
    this._anim = 0;
    this._wrap.style.display = 'block';
    this._wrap.style.opacity = '0';
    this.ctx.input.pushUI('wheel');
    this.ctx.events.emit('ui:open', { id: 'wheel' });
    sfx(this.ctx, 'ui_open');
    this._draw();
  }

  close(select = false) {
    if (!this.visible) return;
    this.visible = false;
    this._wrap.style.display = 'none';
    const picked = select && this._hover >= 0 ? this._defs[this._hover] : null;
    const curId = this.ctx.weapons?.current?.def?.id;
    if (picked && picked.id !== curId) {
      this.ctx.weapons?.select?.(picked.id);
      sfx(this.ctx, 'ui_click');
    } else {
      sfx(this.ctx, 'ui_close', { volume: 0.7 });
    }
    this.ctx.input.popUI('wheel');
    this.ctx.events.emit('ui:close', { id: 'wheel' });
  }

  render(dt) {
    if (!this.visible) return;

    // release TAB -> equip hovered (keyup is recorded even while UI is open)
    if (this.ctx.input.released('wheel')) {
      this.close(true);
      return;
    }

    // snap-in
    this._anim = Math.min(1, this._anim + dt * this.tune.openSpeed);
    const e = 1 - Math.pow(1 - this._anim, 3);
    this._wrap.style.transform = `translate(-50%,-50%) scale(${(0.82 + 0.18 * e).toFixed(4)})`;
    this._wrap.style.opacity = String(Math.min(1, this._anim * 2.5));

    // hover from mouse angle around screen center
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    const dx = this._mx - cx;
    const dy = this._my - cy;
    const r = Math.hypot(dx, dy);
    let h = this._hover;
    if (this._moved) {
      const n = Math.max(1, this._defs.length);
      const seg = 360 / n;      // sector arc in degrees
      if (r > 26) {
        const ang = Math.atan2(dy, dx) / DEG; // 0 = right, 90 = down
        // rotate so segment 0 is centered at the top (−90°), then bucket by seg
        h = Math.floor(((((ang + 90 + seg / 2) % 360) + 360) % 360) / seg) % n;
        if (h >= this._defs.length) h = this._defs.length - 1;
      } else {
        h = -1;
      }
    }
    if (h !== this._hover) {
      this._hover = h;
      if (h >= 0) sfx(this.ctx, 'ui_tick', { volume: 0.6 });
    }

    this._draw();
  }

  _draw() {
    const g = this._g;
    g.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
    g.clearRect(0, 0, SIZE, SIZE);
    const cx = SIZE / 2;
    const cy = SIZE / 2;
    const curId = this.ctx.weapons?.current?.def?.id;

    const n = Math.max(1, this._defs.length);
    const seg = 360 / n;                        // sector arc, degrees
    const half = Math.max(2, seg / 2 - 3);      // half-width minus a small gap
    for (let i = 0; i < this._defs.length; i++) {
      const def = this._defs[i];
      const aC = (-90 + i * seg) * DEG;
      const a0 = aC - half * DEG;
      const a1 = aC + half * DEG;
      const hovered = i === this._hover;
      const isCur = def.id === curId;

      // sector body
      g.beginPath();
      g.arc(cx, cy, R_OUT, a0, a1);
      g.arc(cx, cy, R_IN, a1, a0, true);
      g.closePath();
      g.fillStyle = hovered ? 'rgba(125,249,255,0.18)' : 'rgba(10,14,20,0.86)';
      g.fill();
      g.lineWidth = 1;
      g.strokeStyle = hovered ? 'rgba(125,249,255,0.9)' : 'rgba(125,249,255,0.26)';
      g.stroke();

      // current-weapon inner arc marker
      if (isCur) {
        g.beginPath();
        g.arc(cx, cy, R_IN + 5, a0 + 4 * DEG, a1 - 4 * DEG);
        g.lineWidth = 2.5;
        g.strokeStyle = '#7dff9a';
        g.stroke();
      }

      const tx = cx + Math.cos(aC) * R_TEXT;
      const ty = cy + Math.sin(aC) * R_TEXT;
      const main = hovered ? '#ffffff' : '#bfe9ee';

      drawGlyph(g, def.id, tx, ty - 13, hovered ? '#7df9ff' : 'rgba(125,249,255,0.75)');

      g.font = `${hovered ? 700 : 600} 12px Segoe UI, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = main;
      g.fillText(String(def.name || def.id).toUpperCase(), tx, ty + 13);

      // slot number near outer rim
      const sx = cx + Math.cos(aC) * (R_OUT - 15);
      const sy = cy + Math.sin(aC) * (R_OUT - 15);
      g.font = '600 10px Consolas, monospace';
      g.fillStyle = hovered ? '#7df9ff' : 'rgba(143,163,184,0.8)';
      g.fillText(String(def.slot ?? i + 1), sx, sy);
    }

    // center hub
    g.beginPath();
    g.arc(cx, cy, R_IN - 12, 0, Math.PI * 2);
    g.fillStyle = 'rgba(10,14,20,0.9)';
    g.fill();
    g.lineWidth = 1;
    g.strokeStyle = 'rgba(125,249,255,0.3)';
    g.stroke();

    g.textAlign = 'center';
    g.textBaseline = 'middle';
    if (this._hover >= 0) {
      const def = this._defs[this._hover];
      g.font = '700 14px Segoe UI, sans-serif';
      g.fillStyle = '#7df9ff';
      g.fillText(String(def.name || def.id).toUpperCase(), cx, cy - 7);
      g.font = '600 8.5px Segoe UI, sans-serif';
      g.fillStyle = 'rgba(143,163,184,0.9)';
      g.fillText('RELEASE TO EQUIP', cx, cy + 11);
    } else {
      g.font = '600 10px Segoe UI, sans-serif';
      g.fillStyle = 'rgba(191,233,238,0.85)';
      g.fillText('WEAPONS', cx, cy - 6);
      g.font = '600 8px Segoe UI, sans-serif';
      g.fillStyle = 'rgba(143,163,184,0.7)';
      g.fillText('AIM · RELEASE TAB', cx, cy + 10);
    }
  }
}
