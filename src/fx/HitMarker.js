// RANGE — fx/HitMarker.js
// Classic 4-diagonal-tick hitmarker on its own small centered canvas over the
// crosshair (NOT interactive — clicks pass through). Listens `target:hit`:
//   white  = normal hit
//   gold   = zone 'head' or 'bull'
//   red    = kill (slightly bigger, priority over gold)
// Ticks expand + fade over ~180 ms; rapid hits stack (small ring of marks).
// Also owns the feedback sounds: 'hitmarker' every hit, 'kill_confirm' on
// kill, 'headshot' on head/bull — layered over the tick.

const CSS_SIZE = 160; // canvas CSS px, centered on the crosshair
const MAX_MARKS = 6;

export class HitMarker {
  constructor(ctx) {
    this.ctx = ctx;

    this.params = {
      life: 0.18,   // s tick lifetime
      size: 1.0,    // overall scale
      volume: 0.9,  // feedback sound volume
    };

    const T = (key, prop, min, max, step, label) =>
      ctx.tunables.push({ cat: 'fx', key, obj: this.params, prop, min, max, step, label });
    T('hitmarkerLife', 'life', 0.05, 0.5, 0.01, 'Hitmarker life (s)');
    T('hitmarkerSize', 'size', 0.4, 2.5, 0.05, 'Hitmarker size ×');
    T('hitmarkerVolume', 'volume', 0, 1, 0.05, 'Hit feedback volume');

    const c = document.createElement('canvas');
    c.id = 'hitmarker';
    // Deliberately NOT class 'interactive' — pointer-events stay disabled.
    c.style.cssText = [
      'position:absolute',
      'left:50%',
      'top:50%',
      'transform:translate(-50%,-50%)',
      `width:${CSS_SIZE}px`,
      `height:${CSS_SIZE}px`,
      'z-index:20',
      'pointer-events:none',
    ].join(';');
    (document.getElementById('ui') || document.body).appendChild(c);
    this.canvas = c;
    this.g = c.getContext('2d');
    this._applyDpr();

    // Preallocated ring of marks — zero allocation per hit.
    this.marks = [];
    for (let i = 0; i < MAX_MARKS; i++) {
      this.marks.push({ active: false, age: 0, life: 0.18, color: '#ffffff', mult: 1 });
    }
    this._nextMark = 0;
    this._needsClear = false;

    ctx.events.on('target:hit', (d) => this._onHit(d));
  }

  _onHit({ zone, kill } = {}) {
    const gold = zone === 'head' || zone === 'bull';
    const m = this.marks[this._nextMark];
    this._nextMark = (this._nextMark + 1) % MAX_MARKS;

    m.active = true;
    m.age = 0;
    m.life = this.params.life * (kill ? 1.3 : 1);
    m.color = kill ? '#ff5a4a' : gold ? '#ffcf5a' : '#ffffff';
    m.mult = kill ? 1.4 : 1;

    // Feedback sounds — layered, non-positional (they're UI feedback).
    const a = this.ctx.audio;
    const vol = this.params.volume;
    a?.play?.('hitmarker', { volume: vol, rate: 1 + (Math.random() * 0.08 - 0.04) });
    if (kill) a?.play?.('kill_confirm', { volume: vol });
    if (gold) a?.play?.('headshot', { volume: vol });
  }

  render(dt) {
    let any = false;
    for (const m of this.marks) {
      if (!m.active) continue;
      m.age += dt;
      if (m.age >= m.life) m.active = false;
      else any = true;
    }

    const g = this.g;
    if (!any) {
      if (this._needsClear) {
        g.clearRect(0, 0, CSS_SIZE, CSS_SIZE);
        this._needsClear = false;
      }
      return;
    }

    g.clearRect(0, 0, CSS_SIZE, CSS_SIZE);
    this._needsClear = true;
    const cx = CSS_SIZE / 2;
    const cy = CSS_SIZE / 2;
    g.lineCap = 'round';

    for (const m of this.marks) {
      if (!m.active) continue;
      const t = m.age / m.life;             // 0 -> 1
      const ease = 1 - (1 - t) * (1 - t);   // easeOut expansion
      const alpha = Math.pow(1 - t, 1.3);   // fade
      const s = this.params.size * m.mult;
      const gap = (7 + 9 * ease) * s;
      const len = 11 * s;

      // Dark outline pass for visibility on bright scenes.
      g.globalAlpha = alpha * 0.6;
      g.strokeStyle = '#000000';
      g.lineWidth = 5;
      this._ticks(g, cx, cy, gap, len);

      g.globalAlpha = alpha;
      g.strokeStyle = m.color;
      g.lineWidth = 2.6;
      this._ticks(g, cx, cy, gap, len);
    }
    g.globalAlpha = 1;
  }

  _ticks(g, cx, cy, gap, len) {
    g.beginPath();
    for (let sx = -1; sx <= 1; sx += 2) {
      for (let sy = -1; sy <= 1; sy += 2) {
        g.moveTo(cx + sx * gap, cy + sy * gap);
        g.lineTo(cx + sx * (gap + len), cy + sy * (gap + len));
      }
    }
    g.stroke();
  }

  resize() {
    // CSS keeps it centered; just re-crisp the backing store for the new DPR.
    this._applyDpr();
    this._needsClear = false;
  }

  _applyDpr() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = CSS_SIZE * dpr;
    this.canvas.height = CSS_SIZE * dpr;
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
}
