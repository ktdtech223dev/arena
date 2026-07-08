// RANGE — ui/Crosshair.js
// Reusable canvas crosshair renderer (contract §5.G). Used by HUD (live
// crosshair) and CrosshairEditor (preview swatch). Pure 2D-canvas drawing,
// crisp pixel-aligned rects, outline stroked BEHIND the fill.
//
// Config schema (all fields optional — merged over CROSSHAIR_DEFAULTS):
//   style: 'cross'|'t'|'dot'|'circle'|'crossdot'|'brackets'
//   size, thickness, gap        — px (CSS px; pixelScale handles DPR)
//   dot: bool, dotSize: px      — center dot on top of any style
//   color: css color, opacity: 0..1
//   outline: bool, outlineThickness: px
//   dynamic: bool               — gap expands by the spreadPx passed to draw()
//   tStyle: bool                — drop the top arm (classic T) on cross styles

export const CROSSHAIR_DEFAULTS = Object.freeze({
  style: 'cross',
  size: 7,
  thickness: 2,
  gap: 4,
  dot: false,
  dotSize: 2,
  color: '#7df9ff',
  opacity: 1,
  outline: true,
  outlineThickness: 1,
  dynamic: true,
  tStyle: false,
});

export const CROSSHAIR_STYLES = ['cross', 't', 'dot', 'circle', 'crossdot', 'brackets'];

/** Merge + type-coerce an arbitrary config object over the defaults. */
export function sanitizeCrosshairConfig(cfg) {
  const out = { ...CROSSHAIR_DEFAULTS };
  if (!cfg || typeof cfg !== 'object') return out;
  for (const key of Object.keys(CROSSHAIR_DEFAULTS)) {
    const def = CROSSHAIR_DEFAULTS[key];
    const v = cfg[key];
    if (v === undefined || v === null) continue;
    if (typeof def === 'number') {
      const n = Number(v);
      if (Number.isFinite(n)) out[key] = n;
    } else if (typeof def === 'boolean') {
      out[key] = !!v;
    } else if (key === 'style') {
      if (CROSSHAIR_STYLES.includes(v)) out[key] = v;
    } else if (typeof v === 'string') {
      out[key] = v;
    }
  }
  return out;
}

export class Crosshair {
  constructor(canvas) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    /** Multiply all config px values by this (set to devicePixelRatio for HiDPI). */
    this.pixelScale = 1;
    this.cfg = { ...CROSSHAIR_DEFAULTS };
  }

  setConfig(cfg) {
    this.cfg = sanitizeCrosshairConfig(cfg);
  }

  /**
   * Redraw. spreadPx = extra gap in CSS px (weapon bloom projected to screen);
   * only applied when cfg.dynamic.
   */
  draw(spreadPx = 0) {
    const c = this.canvas;
    const g = this.g;
    const cfg = this.cfg;
    const s = this.pixelScale || 1;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, c.width, c.height);

    const cx = Math.round(c.width / 2);
    const cy = Math.round(c.height / 2);
    const th = Math.max(1, Math.round(cfg.thickness * s));
    const len = Math.max(0, Math.round(cfg.size * s));
    const dyn = cfg.dynamic && spreadPx > 0 ? spreadPx : 0;
    const maxOff = Math.floor(c.width / 2) - 2;
    const gap = Math.max(0, Math.min(maxOff - len, Math.round((cfg.gap + dyn) * s)));
    const dotR = Math.max(1, Math.round(cfg.dotSize * s));
    const ol = cfg.outline ? Math.max(1, Math.round((cfg.outlineThickness ?? 1) * s)) : 0;
    const half = Math.floor(th / 2);

    const rects = [];   // [x, y, w, h]
    const rings = [];   // { r, w } stroked circles centered on cx,cy
    const dots = [];    // { r } filled circles centered on cx,cy

    const style = cfg.style;
    const wantDot = cfg.dot || style === 'dot' || style === 'crossdot';

    if (style === 'cross' || style === 'crossdot' || style === 't') {
      if (len > 0 && th > 0) {
        rects.push([cx + gap, cy - half, len, th]);        // right
        rects.push([cx - gap - len, cy - half, len, th]);  // left
        rects.push([cx - half, cy + gap, th, len]);        // bottom
        const noTop = style === 't' || cfg.tStyle;
        if (!noTop) rects.push([cx - half, cy - gap - len, th, len]); // top
      }
    } else if (style === 'circle') {
      rings.push({ r: Math.max(2, gap + len), w: th });
    } else if (style === 'brackets') {
      const d = Math.max(th + 1, gap + Math.round(2 * s));
      const L = Math.max(2, len);
      // corners open toward center:  ⌜ ⌝ ⌞ ⌟
      rects.push([cx - d, cy - d, L, th]);           // TL horizontal
      rects.push([cx - d, cy - d, th, L]);           // TL vertical
      rects.push([cx + d - L, cy - d, L, th]);       // TR horizontal
      rects.push([cx + d - th, cy - d, th, L]);      // TR vertical
      rects.push([cx - d, cy + d - th, L, th]);      // BL horizontal
      rects.push([cx - d, cy + d - L, th, L]);       // BL vertical
      rects.push([cx + d - L, cy + d - th, L, th]);  // BR horizontal
      rects.push([cx + d - th, cy + d - L, th, L]);  // BR vertical
    }
    // style 'dot' draws nothing but the dot (handled by wantDot)
    if (wantDot) dots.push({ r: dotR });

    const alpha = Math.max(0, Math.min(1, cfg.opacity ?? 1));
    if (alpha <= 0) return;

    // ---- outline pass (behind fill) ----
    if (ol > 0) {
      g.globalAlpha = alpha;
      g.fillStyle = 'rgba(0,0,0,0.85)';
      g.strokeStyle = 'rgba(0,0,0,0.85)';
      for (const [x, y, w, h] of rects) g.fillRect(x - ol, y - ol, w + ol * 2, h + ol * 2);
      for (const ring of rings) {
        g.lineWidth = ring.w + ol * 2;
        g.beginPath();
        g.arc(cx, cy, ring.r, 0, Math.PI * 2);
        g.stroke();
      }
      for (const d of dots) {
        g.beginPath();
        g.arc(cx, cy, d.r + ol, 0, Math.PI * 2);
        g.fill();
      }
    }

    // ---- fill pass ----
    g.globalAlpha = alpha;
    g.fillStyle = cfg.color;
    g.strokeStyle = cfg.color;
    for (const [x, y, w, h] of rects) g.fillRect(x, y, w, h);
    for (const ring of rings) {
      g.lineWidth = ring.w;
      g.beginPath();
      g.arc(cx, cy, ring.r, 0, Math.PI * 2);
      g.stroke();
    }
    for (const d of dots) {
      g.beginPath();
      g.arc(cx, cy, d.r, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
  }
}
