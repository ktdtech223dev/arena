// ARENA client — ui/KillFeed.js
// Top-right stack of kill notifications, mounted into #ui. On every `death`
// event the orchestrator calls add({...}) and a row appears:
//
//     ‹killer›   ‹weapon-glyph›   ‹victim›
//
// with the killer/victim names in their crew colors (crew colors are hex
// NUMBERS in shared/constants.js CREW[].color — converted to css here). A
// headshot is flagged with a small marker; a suicide / world death shows just
// the victim behind a skull glyph. Rows fade + slide out after ~5s and the
// stack is capped at ~5 visible.
//
// Pure DOM/CSS built in code — no assets, weapon icons are tiny CSS glyphs.
// The layer is pointer-events:none (never "interactive") so it never eats input.
// update(dt) advances the timers so it is framerate-independent.

const ROW_LIFE = 5.0;       // s a row stays before it starts leaving
const ROW_FADE = 0.45;      // s the slide-out fade takes
const MAX_ROWS = 5;         // visible cap

// Short weapon labels keyed by weapon id. A tiny CSS glyph precedes the label
// (built via the `data-wep` attribute → ::before content below).
const WEAPON_LABEL = {
  pistol:   'PISTOL',
  smg:      'SMG',
  shotgun:  'SHOTGUN',
  ar:       'AR',
  sniper:   'SNIPER',
  exotic:   'ROCKET',
  sawblade: 'SAWBLADE',
  grenade:  'GRENADE',
};

// A compact symbol per weapon (unicode, drawn as text — no assets).
const WEAPON_GLYPH = {
  pistol:   '‣',   // ‣ small triangle
  smg:      '»',   // »
  shotgun:  '▰',   // ▰
  ar:       '⫷',   // ⫷-ish chevrons
  sniper:   '✚',   // ✚ crosshair-ish
  exotic:   '➶',   // ➶ rocket streak
  sawblade: '⚙',   // ⚙ gear/blade
  grenade:  '●',   // ● round
  world:    '☠',   // ☠ skull
};

const SKULL = '☠'; // ☠

const CSS = `
.kf-root{position:absolute;top:40px;right:18px;display:flex;flex-direction:column;
  align-items:flex-end;gap:9px;pointer-events:none;z-index:38;
  font-family:'Segoe UI',system-ui,-apple-system,sans-serif;}
.kf-row{display:flex;align-items:center;gap:12px;padding:9px 17px;
  background:rgba(10,14,20,0.72);border:1px solid rgba(255,255,255,0.12);
  border-radius:4px;backdrop-filter:blur(4px);
  box-shadow:0 3px 16px rgba(0,0,0,0.55);white-space:nowrap;
  font-size:21px;line-height:1;letter-spacing:.01em;
  text-shadow:0 1px 3px rgba(0,0,0,0.9);
  opacity:0;transform:translateX(32px);
  transition:opacity .18s ease-out, transform .18s ease-out;}
.kf-row.kf-in{opacity:1;transform:translateX(0);}
.kf-row.kf-out{opacity:0;transform:translateX(32px);}
.kf-name{font-weight:700;}
.kf-wep{display:inline-flex;align-items:center;gap:7px;color:#c9d4e0;
  font-size:15px;letter-spacing:.14em;padding:0 2px;}
.kf-glyph{font-size:23px;line-height:1;color:#e6eef7;
  text-shadow:0 0 8px rgba(125,249,255,0.4),0 1px 3px rgba(0,0,0,0.9);}
.kf-hs{display:inline-flex;align-items:center;justify-content:center;
  margin-left:8px;font-size:15px;font-weight:800;letter-spacing:.06em;
  color:#0a0e14;background:#ffd166;border-radius:3px;padding:2px 7px;
  box-shadow:0 0 10px rgba(255,209,102,0.65);}
.kf-skull{color:#ff5b5b;font-size:23px;text-shadow:0 0 9px rgba(255,60,60,0.55);}
`;

function injectCss(id, text) {
  if (typeof document === 'undefined') return;
  if (document.getElementById(id)) return;
  const s = document.createElement('style');
  s.id = id;
  s.textContent = text;
  document.head.appendChild(s);
}

function el(tag, cls, parent, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}

// hex NUMBER (e.g. 0x7df9ff) or css string → css color string.
function toCss(color, fallback = '#e6eef7') {
  if (color == null) return fallback;
  if (typeof color === 'number') {
    return '#' + (color & 0xffffff).toString(16).padStart(6, '0');
  }
  return String(color);
}

export class KillFeed {
  /** @param {object} ctx  RANGE/ARENA ctx (uses document/#ui only). */
  constructor(ctx) {
    this.ctx = ctx;
    this._rows = []; // { node, life, t, leaving }
    this._buildDom();
  }

  _buildDom() {
    if (typeof document === 'undefined') return;
    injectCss('kill-feed-css', CSS);
    const parent = document.getElementById('ui') || document.body;
    this._root = el('div', 'kf-root', parent);
  }

  /**
   * Push a kill notification.
   * @param {object} info
   * @param {string} [info.killerName]
   * @param {number|string} [info.killerColor]  crew hex number or css string
   * @param {string} info.victimName
   * @param {number|string} [info.victimColor]
   * @param {string} [info.weapon]     weapon id (pistol/smg/.../grenade)
   * @param {boolean} [info.headshot]
   * @param {boolean} [info.suicide]   true for self-kill / world death
   */
  add(info = {}) {
    if (!this._root) return;
    const {
      killerName, killerColor, victimName, victimColor,
      weapon, headshot, suicide,
    } = info;

    const row = el('div', 'kf-row', null);

    // suicide / world death (no distinct killer): skull + victim only.
    if (suicide || !killerName) {
      el('span', 'kf-skull', row, SKULL);
      const v = el('span', 'kf-name', row, victimName || '???');
      v.style.color = toCss(victimColor);
    } else {
      const k = el('span', 'kf-name', row, killerName);
      k.style.color = toCss(killerColor);

      // weapon block: glyph + short label
      const wid = weapon && (WEAPON_GLYPH[weapon] ? weapon : null);
      const wep = el('span', 'kf-wep', row);
      el('span', 'kf-glyph', wep, WEAPON_GLYPH[wid] || WEAPON_GLYPH.world || '•');
      if (wid && WEAPON_LABEL[wid]) el('span', null, wep, WEAPON_LABEL[wid]);

      const v = el('span', 'kf-name', row, victimName || '???');
      v.style.color = toCss(victimColor);

      if (headshot) el('span', 'kf-hs', row, 'HS');
    }

    // newest at the TOP of the stack
    this._root.insertBefore(row, this._root.firstChild);
    const entry = { node: row, life: ROW_LIFE, t: ROW_LIFE, leaving: false };
    this._rows.push(entry);

    // trigger slide-in on the next frame so the transition plays
    requestAnimationFrame(() => { row.classList.add('kf-in'); });

    // cap visible rows: start retiring the oldest surviving ones
    const alive = this._rows.filter((r) => !r.leaving);
    if (alive.length > MAX_ROWS) {
      const overflow = alive.length - MAX_ROWS;
      for (let i = 0; i < overflow; i++) this._retire(alive[i]);
    }
  }

  _retire(entry) {
    if (!entry || entry.leaving) return;
    entry.leaving = true;
    entry.node.classList.remove('kf-in');
    entry.node.classList.add('kf-out');
    entry._removeAt = ROW_FADE;
  }

  /** Advance timers + finish removals. dt in seconds. */
  update(dt) {
    const d = dt > 0 ? dt : 0;
    for (let i = this._rows.length - 1; i >= 0; i--) {
      const r = this._rows[i];
      if (r.leaving) {
        r._removeAt -= d;
        if (r._removeAt <= 0) {
          if (r.node.parentNode) r.node.parentNode.removeChild(r.node);
          this._rows.splice(i, 1);
        }
        continue;
      }
      r.t -= d;
      if (r.t <= 0) this._retire(r);
    }
  }

  resize() { /* right-anchored, nothing to recompute */ }

  /** Tear down DOM + clear state. */
  dispose() {
    for (const r of this._rows) if (r.node?.parentNode) r.node.parentNode.removeChild(r.node);
    this._rows.length = 0;
    if (this._root && this._root.parentNode) this._root.parentNode.removeChild(this._root);
    this._root = null;
  }
}
