// ARENA client — ui/Radio.js: internet radio, in menus AND in-game.
// Live streams (SomaFM — listener-supported; credit them) are inherently in sync:
// everyone tuned to the same station hears the same broadcast. In the ARENA the
// station is SHARED LOBBY STATE — changing it casts a VOTE (server enforces >50%
// of active players). In the MAIN MENU the radio is just local.
//
//   RadioPlayer — one <audio> element wrapper (play/stop/volume).
//   RadioPanel  — the in-game station list (J), clicks cast votes.

export const STATIONS = [
  { id: 'groove',  name: 'GROOVE SALAD',  url: 'https://ice1.somafm.com/groovesalad-128-mp3' },
  { id: 'defcon',  name: 'DEF CON RADIO', url: 'https://ice1.somafm.com/defcon-128-mp3' },
  { id: 'beat',    name: 'BEAT BLENDER',  url: 'https://ice1.somafm.com/beatblender-128-mp3' },
  { id: 'space',   name: 'SPACE STATION', url: 'https://ice1.somafm.com/spacestation-128-mp3' },
  { id: 'metal',   name: 'METAL DETECTOR', url: 'https://ice1.somafm.com/metal-128-mp3' },
  { id: 'off',     name: 'RADIO OFF',     url: null },
];

export class RadioPlayer {
  constructor(volume = 0.35) {
    this.el = typeof Audio !== 'undefined' ? new Audio() : null;
    if (this.el) { this.el.volume = volume; this.el.preload = 'none'; }
    this.currentId = 'off';
  }
  setStation(st) {
    if (!this.el) return;
    this.currentId = st?.id || 'off';
    if (!st || !st.url) { this.el.pause(); this.el.removeAttribute('src'); return; }
    this.el.src = st.url;
    const p = this.el.play();
    if (p && p.catch) p.catch(() => { /* needs a user gesture first — next click resumes */ });
  }
  setVolume(v) { if (this.el) this.el.volume = Math.max(0, Math.min(1, v)); }
  stop() { this.setStation(null); }
}

function injectCss(id, t) { if (document.getElementById(id)) return; const s = document.createElement('style'); s.id = id; s.textContent = t; document.head.appendChild(s); }
const CSS = `
.rd-panel{position:absolute;right:16px;top:64px;z-index:45;width:230px;display:none;flex-direction:column;gap:6px;
  background:rgba(8,12,18,0.92);border:1px solid rgba(125,249,255,0.25);border-radius:10px;padding:14px;
  font-family:'Segoe UI',system-ui,sans-serif;}
.rd-panel.on{display:flex;}
.rd-title{font-size:11px;font-weight:800;letter-spacing:.24em;color:#7df9ff;margin-bottom:4px;}
.rd-sub{font-size:9.5px;letter-spacing:.1em;color:#5a6b7a;margin-bottom:6px;}
.rd-st{font-size:12px;font-weight:700;letter-spacing:.1em;color:#aebccb;padding:8px 10px;border-radius:6px;cursor:pointer;
  background:rgba(16,22,30,0.9);border:1px solid rgba(255,255,255,0.07);}
.rd-st:hover{color:#eaf6ff;border-color:rgba(125,249,255,0.5);}
.rd-st.on{color:#04121a;background:#7df9ff;border-color:#7df9ff;}
.rd-st .v{float:right;opacity:.7;font-size:10.5px;}
`;

export class RadioPanel {
  /** @param {object} ctx @param {(id:string)=>void} onVote */
  constructor(ctx, onVote) {
    this.ctx = ctx;
    this.onVote = onVote;
    injectCss('radio-css', CSS);
    const parent = document.getElementById('ui') || document.body;
    this.root = document.createElement('div');
    this.root.className = 'rd-panel interactive';
    parent.appendChild(this.root);
    this.stations = STATIONS;
    this.currentId = 'off';
    this._votes = {}; // stationId -> {votes, needed}
    this._render();
    this._open = false;
    ctx.input.onKeyDown('KeyJ', () => this.toggle());
  }

  setStations(list, currentId) {
    if (Array.isArray(list) && list.length) this.stations = list;
    if (currentId) this.currentId = currentId;
    this._render();
  }
  setCurrent(id) { this.currentId = id; this._votes = {}; this._render(); }
  voteUpdate(id, v, needed) { this._votes[id] = { v, needed }; this._render(); }

  _render() {
    this.root.innerHTML = `<div class="rd-title">📻 CREW RADIO</div>
      <div class="rd-sub">SHARED — &gt;50% VOTE TO CHANGE · STREAMS BY SOMAFM</div>`
      + this.stations.map((s) => {
        const vt = this._votes[s.id];
        return `<div class="rd-st${s.id === this.currentId ? ' on' : ''}" data-id="${s.id}">${s.name}${vt ? `<span class="v">${vt.v}/${vt.needed}</span>` : ''}</div>`;
      }).join('');
    this.root.querySelectorAll('.rd-st').forEach((el) => el.addEventListener('click', () => this.onVote?.(el.dataset.id)));
  }

  toggle() {
    this._open = !this._open;
    this.root.classList.toggle('on', this._open);
    if (this._open) { this.ctx.input.pushUI('radio'); } else { this.ctx.input.popUI('radio'); }
  }
  close() { if (this._open) this.toggle(); }
}
