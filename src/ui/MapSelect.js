// ARENA — ui/MapSelect.js
// The multiplayer map picker. A modal grid of map CARDS the crew uses to switch
// the shared lobby map. Any crew member can pick — the orchestrator forwards the
// choice to the server (conn.sendSetMap(id)) which switches everyone, then calls
// setCurrent(id) on the resulting map_change so the highlight follows the room.
//
// Self-contained: it does NOT touch the network. Clicking a card calls
// opts.onPick(id). Pure DOM/CSS, mounts into #ui with class 'interactive'.
//
// Theme swatches are code-drawn from each theme's palette. mapList() only carries
// the theme NAME, so we key a small palette table off that name (mirrors the
// THEMES presets in shared/maps.js). Unknown themes fall back to a neutral chip.

// palette per theme name — floor/wall backdrop + accent/trim/hazard chips.
// Mirrors THEMES in shared/maps.js so the swatch reads like the real map.
const THEME_SWATCH = {
  Tech:    { floor: '#11161f', wall: '#1a2230', accent: '#7df9ff', trim: '#7df9ff', hazard: '#ff5b3a', grid: '#7df9ff' },
  Foundry: { floor: '#1c130a', wall: '#2a1c10', accent: '#ff7a2a', trim: '#ffb060', hazard: '#ff3a10', grid: '#ff8a3a' },
  Grove:   { floor: '#14200f', wall: '#1a2c16', accent: '#8fe86a', trim: '#bfffa0', hazard: '#66ff88', grid: '#8fe86a' },
  Frost:   { floor: '#162230', wall: '#1e2e40', accent: '#9fe6ff', trim: '#d6f4ff', hazard: '#66d0ff', grid: '#9fe6ff' },
  Neon:    { floor: '#140a20', wall: '#1e0e30', accent: '#ff5bd0', trim: '#ba7bff', hazard: '#ff2e88', grid: '#ba7bff' },
};
const NEUTRAL = { floor: '#10151d', wall: '#1a222e', accent: '#7df9ff', trim: '#9fb2c5', hazard: '#ff5b3a', grid: '#7df9ff' };

// derive a full swatch palette from a map's own accent + mood colors (each
// bespoke map carries theme.accent/theme.mood), so every card reads distinctly
// without a hardcoded table. Falls back to the name table, then neutral.
function paletteFrom(m) {
  const acc = m && m.accent, mood = m && m.mood;
  if (!acc && !mood) return THEME_SWATCH[m && m.theme] || NEUTRAL;
  const floor = mood || '#12161f';
  return {
    floor,
    wall: mix(floor, '#ffffff', 0.10),
    accent: acc || '#7df9ff',
    trim: mix(acc || '#7df9ff', '#ffffff', 0.35),
    hazard: acc || '#ff5b3a',
    grid: acc || '#7df9ff',
  };
}
// blend two #rrggbb by t (0..1)
function mix(a, b, t) {
  const pa = hx(a), pb = hx(b);
  const c = pa.map((v, i) => Math.round(v + (pb[i] - v) * t));
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
}
function hx(s) { const n = parseInt(String(s).replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
const swatchFor = (m) => paletteFrom(m);

const CSS = `
.ms-scrim{position:absolute;inset:0;z-index:130;display:none;
  align-items:center;justify-content:center;background:rgba(4,6,10,0.74);
  backdrop-filter:blur(6px);font-family:'Segoe UI',system-ui,-apple-system,sans-serif;}
.ms-scrim.on{display:flex;}
.ms-panel{width:min(720px,94vw);max-height:88vh;display:flex;flex-direction:column;
  background:rgba(10,14,20,0.96);border:1px solid rgba(125,249,255,0.28);
  border-radius:10px;box-shadow:0 20px 70px rgba(0,0,0,0.62),0 0 34px rgba(125,249,255,0.08);
  color:#dfe7f0;overflow:hidden;}
.ms-head{display:flex;align-items:center;justify-content:space-between;
  padding:20px 26px 14px;border-bottom:1px solid rgba(255,255,255,0.07);}
.ms-titles{display:flex;flex-direction:column;gap:4px;}
.ms-title{font-size:20px;font-weight:800;letter-spacing:.24em;color:#7df9ff;
  text-shadow:0 0 22px rgba(125,249,255,0.35);}
.ms-sub{font-size:10px;letter-spacing:.32em;opacity:.5;text-transform:uppercase;}
.ms-x{cursor:pointer;color:#8fa3b8;font-size:13px;font-weight:700;letter-spacing:.14em;
  padding:7px 12px;border:1px solid rgba(125,249,255,0.28);border-radius:5px;
  background:rgba(125,249,255,0.05);transition:all .13s ease;user-select:none;}
.ms-x:hover{color:#eaffff;border-color:#7df9ff;background:rgba(125,249,255,0.16);}
.ms-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));
  gap:16px;padding:22px 26px 26px;overflow-y:auto;}
.ms-grid::-webkit-scrollbar{width:8px;}
.ms-grid::-webkit-scrollbar-thumb{background:rgba(125,249,255,0.22);border-radius:4px;}
.ms-card{position:relative;display:flex;flex-direction:column;cursor:pointer;
  border-radius:9px;overflow:hidden;background:rgba(14,20,28,0.9);
  border:1px solid rgba(255,255,255,0.1);
  transition:transform .14s ease,border-color .14s ease,box-shadow .14s ease;}
.ms-card:hover{transform:translateY(-4px);border-color:rgba(125,249,255,0.55);
  box-shadow:0 14px 40px rgba(0,0,0,0.55),0 0 26px rgba(125,249,255,0.1);}
.ms-card:focus-visible{outline:2px solid #7df9ff;outline-offset:2px;}
.ms-card.active{border-color:#7df9ff;
  box-shadow:0 0 0 1px #7df9ff inset,0 10px 34px rgba(0,0,0,0.5),0 0 30px rgba(125,249,255,0.18);}
.ms-swatch{position:relative;width:100%;aspect-ratio:16/9;display:block;}
.ms-body{padding:12px 14px 14px;display:flex;flex-direction:column;gap:6px;}
.ms-name{font-size:15px;font-weight:800;letter-spacing:.1em;color:#eaf6ff;}
.ms-theme{display:inline-flex;align-items:center;gap:6px;font-size:9.5px;
  letter-spacing:.2em;text-transform:uppercase;opacity:.8;}
.ms-dot{width:8px;height:8px;border-radius:2px;box-shadow:0 0 8px currentColor;}
.ms-badge{position:absolute;top:9px;right:9px;font-size:8.5px;font-weight:800;
  letter-spacing:.18em;color:#06121a;background:#7df9ff;padding:3px 7px;border-radius:4px;
  box-shadow:0 0 14px rgba(125,249,255,0.6);display:none;}
.ms-card.active .ms-badge{display:block;}
.ms-empty{grid-column:1/-1;text-align:center;padding:40px 0;opacity:.5;
  font-size:12px;letter-spacing:.16em;text-transform:uppercase;}
`;

function injectCss(id, text) {
  if (typeof document === 'undefined' || document.getElementById(id)) return;
  const s = document.createElement('style');
  s.id = id; s.textContent = text; document.head.appendChild(s);
}

// build the small code-drawn themed swatch as an SVG data-URI-free inline SVG:
// a floor/wall gradient with a faint grid + a few accent/hazard blocks so each
// theme reads distinctly at a glance (no asset files).
function swatchSVG(p) {
  return `
  <svg class="ms-swatch" viewBox="0 0 160 90" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${p.wall}"/>
        <stop offset="1" stop-color="${p.floor}"/>
      </linearGradient>
      <pattern id="grid" width="16" height="16" patternUnits="userSpaceOnUse">
        <path d="M16 0H0V16" fill="none" stroke="${p.grid}" stroke-opacity="0.14" stroke-width="1"/>
      </pattern>
    </defs>
    <rect width="160" height="90" fill="url(#g)"/>
    <rect width="160" height="90" fill="url(#grid)"/>
    <rect x="64" y="34" width="32" height="22" rx="2" fill="${p.wall}" stroke="${p.accent}" stroke-opacity="0.7"/>
    <rect x="70" y="26" width="20" height="10" rx="1.5" fill="${p.accent}" fill-opacity="0.85"/>
    <rect x="22" y="52" width="18" height="10" rx="1.5" fill="${p.trim}" fill-opacity="0.55"/>
    <rect x="120" y="52" width="18" height="10" rx="1.5" fill="${p.trim}" fill-opacity="0.55"/>
    <rect x="12" y="72" width="22" height="8" rx="1" fill="${p.hazard}" fill-opacity="0.8"/>
    <rect x="126" y="72" width="22" height="8" rx="1" fill="${p.hazard}" fill-opacity="0.8"/>
    <line x1="0" y1="45" x2="160" y2="45" stroke="${p.accent}" stroke-opacity="0.12" stroke-width="1"/>
  </svg>`;
}

export class MapSelect {
  // ctx — the game ctx (used only for an optional audio click cue).
  // opts.onPick(id)  — called when a card is chosen.
  // opts.mapList     — [{ id, name, theme }] from shared/maps.js mapList().
  // opts.currentId   — id to highlight as active.
  // opts.closeOnPick — default true; if false the panel stays open + re-highlights.
  constructor(ctx, opts = {}) {
    this.ctx = ctx || null;
    this.onPick = opts.onPick || (() => {});
    this.list = Array.isArray(opts.mapList) ? opts.mapList.slice() : [];
    this.currentId = opts.currentId || null;
    this.closeOnPick = opts.closeOnPick !== false;
    this._open = false;
    if (typeof document === 'undefined') return;

    injectCss('map-select-css', CSS);
    const parent = document.getElementById('ui') || document.body;
    this.scrim = document.createElement('div');
    this.scrim.className = 'ms-scrim interactive';
    this.scrim.innerHTML = `
      <div class="ms-panel interactive" role="dialog" aria-label="Select map">
        <div class="ms-head">
          <div class="ms-titles">
            <div class="ms-title">SELECT MAP</div>
            <div class="ms-sub">shared lobby · any crew member can switch</div>
          </div>
          <div class="ms-x" role="button" tabindex="0" aria-label="Close">‹ BACK</div>
        </div>
        <div class="ms-grid"></div>
      </div>`;
    parent.appendChild(this.scrim);
    this.panel = this.scrim.querySelector('.ms-panel');
    this.grid = this.scrim.querySelector('.ms-grid');
    const x = this.scrim.querySelector('.ms-x');
    x.addEventListener('click', () => this.close());
    x.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.close(); } });

    // click-outside + Esc to close
    this.scrim.addEventListener('mousedown', (e) => { if (e.target === this.scrim) this.close(); });
    this._onKey = (e) => { if (this._open && e.key === 'Escape') { e.preventDefault(); this.close(); } };
    document.addEventListener('keydown', this._onKey);

    this._render();
  }

  _sfx(name) { try { this.ctx?.audio?.play?.(name); } catch { /* audio optional */ } }

  _render() {
    if (!this.grid) return;
    this.grid.textContent = '';
    if (!this.list.length) {
      const e = document.createElement('div');
      e.className = 'ms-empty'; e.textContent = 'No maps available';
      this.grid.appendChild(e);
      return;
    }
    for (const m of this.list) {
      const p = swatchFor(m);
      const card = document.createElement('div');
      card.className = 'ms-card' + (m.id === this.currentId ? ' active' : '');
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');
      card.dataset.id = m.id;
      card.setAttribute('aria-label', `${m.name} — ${m.theme || 'map'}`);
      card.setAttribute('aria-pressed', m.id === this.currentId ? 'true' : 'false');
      card.innerHTML = `
        ${swatchSVG(p)}
        <div class="ms-badge">ACTIVE</div>
        <div class="ms-body">
          <div class="ms-name">${escapeHtml(m.name || m.id)}</div>
          <div class="ms-theme"><span class="ms-dot" style="color:${p.accent}"></span>${escapeHtml(m.theme || '—')}</div>
        </div>`;
      const pick = () => this._pick(m.id);
      card.addEventListener('click', pick);
      card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
      this.grid.appendChild(card);
    }
  }

  _pick(id) {
    this._sfx('ui_select');
    try { this.onPick(id); } catch (err) { console.warn('[MapSelect] onPick threw', err); }
    if (this.closeOnPick) this.close();
    else this.setCurrent(id); // optimistic re-highlight; server map_change confirms via setCurrent
  }

  // ---- public API ----
  open() {
    if (!this.scrim || this._open) return;
    this.scrim.classList.add('on'); this._open = true; this._sfx('ui_open');
  }
  close() {
    if (!this.scrim || !this._open) return;
    this.scrim.classList.remove('on'); this._open = false; this._sfx('ui_close');
  }
  toggle() { this._open ? this.close() : this.open(); }
  get isOpen() { return !!this._open; }

  // re-highlight the active card (call on the server's map_change). No re-render.
  setCurrent(id) {
    this.currentId = id;
    if (!this.grid) return;
    for (const card of this.grid.querySelectorAll('.ms-card')) {
      const on = card.dataset.id === id;
      card.classList.toggle('active', on);
      card.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }

  // replace the map list (rebuilds the grid, preserves current highlight).
  setList(list) {
    this.list = Array.isArray(list) ? list.slice() : [];
    this._render();
  }

  resize() { /* fluid CSS grid — no measurement needed; provided for API parity */ }

  dispose() {
    if (this._onKey) { document.removeEventListener('keydown', this._onKey); this._onKey = null; }
    if (this.scrim?.parentNode) this.scrim.parentNode.removeChild(this.scrim);
    this.scrim = null; this.panel = null; this.grid = null; this._open = false;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
