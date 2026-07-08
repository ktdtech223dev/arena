// Shared SETTINGS panel — audio + controls, bound to a Settings instance
// (core/Settings.js). Usable from the main menu AND in-game. Pure DOM/CSS,
// mounts into #ui, class 'interactive' so its controls take input.
const CSS = `
.set-scrim{position:absolute;inset:0;z-index:120;display:none;
  align-items:center;justify-content:center;background:rgba(4,6,10,0.72);
  backdrop-filter:blur(5px);font-family:'Segoe UI',system-ui,sans-serif;}
.set-scrim.on{display:flex;}
.set-panel{width:min(560px,92vw);max-height:86vh;overflow-y:auto;
  background:rgba(12,16,22,0.96);border:1px solid rgba(125,249,255,0.25);
  border-radius:10px;box-shadow:0 20px 70px rgba(0,0,0,0.6);padding:26px 30px;color:#dfe7f0;}
.set-panel h2{font-size:20px;font-weight:800;letter-spacing:.22em;color:#7df9ff;margin-bottom:4px;}
.set-panel .set-sub{font-size:11px;letter-spacing:.14em;opacity:.5;margin-bottom:20px;text-transform:uppercase;}
.set-grp{font-size:12px;letter-spacing:.18em;color:#8fd7e0;text-transform:uppercase;
  margin:18px 0 8px;border-bottom:1px solid rgba(255,255,255,0.08);padding-bottom:5px;}
.set-row{display:flex;align-items:center;justify-content:space-between;gap:14px;margin:11px 0;font-size:14px;}
.set-row label{opacity:.9;}
.set-row input[type=range]{flex:1;accent-color:#7df9ff;max-width:270px;}
.set-val{width:48px;text-align:right;font-family:Consolas,monospace;color:#7df9ff;font-size:13px;}
.set-row input[type=checkbox]{width:18px;height:18px;accent-color:#7df9ff;}
.set-close{margin-top:24px;width:100%;padding:12px;font-size:14px;font-weight:700;letter-spacing:.18em;
  background:#7df9ff;color:#06121a;border:none;border-radius:6px;cursor:pointer;}
.set-close:hover{background:#a8fbff;}
`;

function injectCss(id, t) { if (typeof document === 'undefined' || document.getElementById(id)) return; const s = document.createElement('style'); s.id = id; s.textContent = t; document.head.appendChild(s); }

export class SettingsPanel {
  constructor(settings, opts = {}) {
    this.settings = settings;
    this.onClose = opts.onClose || (() => {});
    this.audio = opts.audio || null; // optional AudioEngine for a click cue
    this.showMainMenu = !!opts.mainMenu; // add a "Main Menu" button (in-game)
    if (typeof document === 'undefined') return;
    injectCss('settings-panel-css', CSS);
    const parent = document.getElementById('ui') || document.body;
    this.scrim = document.createElement('div');
    this.scrim.className = 'set-scrim interactive';
    this.scrim.innerHTML = '<div class="set-panel interactive"></div>';
    parent.appendChild(this.scrim);
    this.panel = this.scrim.querySelector('.set-panel');
    this._build();
    this.scrim.addEventListener('mousedown', (e) => { if (e.target === this.scrim) this.close(); });
  }

  _slider(parent, label, path, min, max, step, fmt = (v) => v.toFixed(2)) {
    const row = document.createElement('div'); row.className = 'set-row';
    const val = this.settings.get(path, min);
    row.innerHTML = `<label>${label}</label>`;
    const input = document.createElement('input'); input.type = 'range';
    input.min = min; input.max = max; input.step = step; input.value = val;
    const out = document.createElement('span'); out.className = 'set-val'; out.textContent = fmt(+val);
    input.addEventListener('input', () => { const v = +input.value; this.settings.set(path, v); out.textContent = fmt(v); });
    row.appendChild(input); row.appendChild(out); parent.appendChild(row);
  }
  _check(parent, label, path) {
    const row = document.createElement('div'); row.className = 'set-row';
    row.innerHTML = `<label>${label}</label>`;
    const input = document.createElement('input'); input.type = 'checkbox';
    input.checked = !!this.settings.get(path, true);
    input.addEventListener('change', () => this.settings.set(path, input.checked));
    row.appendChild(input); parent.appendChild(row);
  }
  _grp(parent, title) { const g = document.createElement('div'); g.className = 'set-grp'; g.textContent = title; parent.appendChild(g); }

  _build() {
    const p = this.panel;
    p.innerHTML = '<h2>SETTINGS</h2><div class="set-sub">audio · controls · display</div>';
    this._grp(p, 'Audio');
    this._slider(p, 'Master Volume', 'volMaster', 0, 1, 0.01, (v) => Math.round(v * 100) + '%');
    this._slider(p, 'SFX Volume', 'volSfx', 0, 1, 0.01, (v) => Math.round(v * 100) + '%');
    this._grp(p, 'Controls');
    this._slider(p, 'Mouse Sensitivity', 'sens', 0.3, 8, 0.05);
    this._slider(p, 'ADS Sens Multiplier', 'adsSensMult', 0.2, 1.5, 0.01);
    this._grp(p, 'Display');
    this._slider(p, 'Field of View', 'fov', 70, 120, 1, (v) => Math.round(v) + '°');
    this._check(p, 'View Bob', 'viewBob');
    this._check(p, 'Damage Numbers', 'damageNumbers');
    if (this.showMainMenu) {
      const mm = document.createElement('button'); mm.className = 'set-close';
      mm.style.background = 'transparent'; mm.style.color = '#ffd166'; mm.style.border = '1px solid rgba(255,209,102,0.5)'; mm.style.marginTop = '18px';
      mm.textContent = '‹ MAIN MENU';
      mm.addEventListener('click', () => { location.href = location.origin + location.pathname; });
      p.appendChild(mm);
    }
    const close = document.createElement('button'); close.className = 'set-close'; close.textContent = 'RESUME';
    close.addEventListener('click', () => this.close());
    p.appendChild(close);
  }

  open() { if (this.scrim) { this.scrim.classList.add('on'); this._open = true; this.audio?.play?.('ui_open'); } }
  close() { if (this.scrim) { this.scrim.classList.remove('on'); this._open = false; this.onClose(); this.audio?.play?.('ui_close'); } }
  toggle() { this._open ? this.close() : this.open(); }
  get isOpen() { return !!this._open; }
  dispose() { if (this.scrim?.parentNode) this.scrim.parentNode.removeChild(this.scrim); this.scrim = null; }
}
