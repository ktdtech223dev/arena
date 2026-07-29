// Landing MAIN MENU — MW2-style "channel band" layout: a cinematic animated
// backdrop, the big ARENA mark, and three wide mode channels across the middle
// (FPS TOWER DEFENSE · TEST RANGE · MULTIPLAYER), each with a live code-built
// preview. MULTIPLAYER opens a HUB submenu (join / create map / browse maps /
// accolades / stats / weapons+camos). Pure DOM/CSS/canvas — no image assets; no
// renderer/game is built until a mode is chosen.
import { Settings } from '../core/Settings.js';
import { SettingsPanel } from './SettingsPanel.js';
import { mapList } from '../../shared/maps.js';
import { WEAPONS } from '../weapons/weapons-data.js';
import { getProfile, getStats, CAMO_TIERS, camoForKills } from '../core/Profile.js';
import { STATIONS, RadioPlayer } from './Radio.js';

const CSS = `
.mm-root{position:absolute;inset:0;z-index:60;font-family:'Segoe UI',system-ui,-apple-system,sans-serif;
  background:#04060a;overflow:hidden;color:#eaf6ff;}
/* ---- layered animated backdrop ---- */
.mm-bg{position:absolute;inset:0;overflow:hidden;}
.mm-bg .sky{position:absolute;inset:0;background:
  radial-gradient(120% 90% at 70% 10%,#12202f 0%,#0a121d 45%,#04060a 100%);}
.mm-bg .grid{position:absolute;inset:-25%;background-image:
  linear-gradient(rgba(125,249,255,0.05) 1px,transparent 1px),
  linear-gradient(90deg,rgba(125,249,255,0.05) 1px,transparent 1px);
  background-size:44px 44px;transform:perspective(600px) rotateX(64deg) translateY(24%);
  animation:mm-scroll 9s linear infinite;opacity:.55;}
@keyframes mm-scroll{to{background-position:0 44px;}}
.mm-bg .fog{position:absolute;width:70vw;height:44vh;border-radius:50%;filter:blur(70px);opacity:.16;}
.mm-bg .f1{background:#1e5e70;left:-16vw;top:6vh;animation:mm-drift1 26s ease-in-out infinite alternate;}
.mm-bg .f2{background:#3a2a6e;right:-20vw;top:26vh;animation:mm-drift2 33s ease-in-out infinite alternate;}
.mm-bg .f3{background:#0e3a4a;left:22vw;bottom:-18vh;animation:mm-drift1 41s ease-in-out infinite alternate-reverse;}
@keyframes mm-drift1{to{transform:translate(9vw,4vh) scale(1.15);}}
@keyframes mm-drift2{to{transform:translate(-7vw,-5vh) scale(0.92);}}
.mm-bg .scan{position:absolute;inset:0;background:repeating-linear-gradient(0deg,rgba(0,0,0,0.16) 0 1px,transparent 1px 3px);
  pointer-events:none;opacity:.5;}
.mm-bg .vig{position:absolute;inset:0;background:radial-gradient(90% 80% at 50% 45%,transparent 55%,rgba(0,0,0,0.66) 100%);}
/* ---- title ---- */
.mm-head{position:absolute;top:6vh;left:0;right:0;text-align:center;pointer-events:none;}
.mm-title{font-size:min(9vw,88px);font-weight:900;letter-spacing:.34em;margin-right:-.34em;color:#eaf6ff;
  text-shadow:0 0 18px rgba(125,249,255,0.75),0 0 70px rgba(125,249,255,0.35);}
.mm-sub{font-size:12px;letter-spacing:.55em;color:#7df9ff;opacity:.8;margin-top:2px;margin-right:-.55em;}
/* ---- the channel band ---- */
.mm-band{position:absolute;left:0;right:0;top:50%;transform:translateY(-52%);
  border-top:1px solid rgba(125,249,255,0.14);border-bottom:1px solid rgba(125,249,255,0.14);
  background:linear-gradient(180deg,rgba(4,8,12,0.35),rgba(4,8,12,0.72));
  display:flex;justify-content:center;gap:2.2vw;padding:2.6vh 4vw;}
.mm-ch{width:min(23vw,330px);cursor:pointer;transition:transform .16s ease;}
.mm-ch:hover{transform:translateY(-6px) scale(1.02);}
.mm-ch .bar{font-size:14px;font-weight:800;letter-spacing:.22em;text-align:center;
  background:rgba(10,16,24,0.9);border:1px solid rgba(125,249,255,0.22);border-bottom:none;
  padding:9px 6px;color:#cfe3f2;}
.mm-ch .scr{position:relative;height:min(30vh,240px);background:#070d14;overflow:hidden;
  border:1px solid rgba(125,249,255,0.22);}
.mm-ch .scr canvas{position:absolute;inset:0;width:100%;height:100%;}
.mm-ch .scr .noise{position:absolute;inset:0;background:repeating-linear-gradient(0deg,rgba(255,255,255,0.022) 0 1px,transparent 1px 3px);}
.mm-ch .cap{font-size:11px;letter-spacing:.14em;text-align:center;padding:8px 6px;
  background:rgba(10,16,24,0.9);border:1px solid rgba(125,249,255,0.22);border-top:none;color:#8fa6bb;}
.mm-ch:hover .bar{color:#7df9ff;border-color:rgba(125,249,255,0.65);}
.mm-ch:hover .scr{border-color:rgba(125,249,255,0.65);box-shadow:0 0 34px rgba(125,249,255,0.14);}
.mm-ch:hover .cap{border-color:rgba(125,249,255,0.65);}
.mm-ch.td .bar{color:#9fe86a;} .mm-ch.mp .bar{color:#ffd166;}
/* ---- caption ticker + bottom bar ---- */
.mm-tick{position:absolute;left:0;right:0;bottom:16vh;text-align:center;font-size:13.5px;
  letter-spacing:.06em;color:#bfd6e4;opacity:.9;text-shadow:0 1px 6px #000;}
.mm-bot{position:absolute;left:0;right:0;bottom:6.5vh;display:flex;justify-content:center;gap:34px;}
.mm-bot .bi{font-size:12.5px;font-weight:700;letter-spacing:.26em;color:#8fa6bb;cursor:pointer;padding:6px 10px;}
.mm-bot .bi:hover{color:#7df9ff;text-shadow:0 0 14px rgba(125,249,255,0.6);}
/* ================= MULTIPLAYER HUB ================= */
.mp-hub{position:absolute;inset:0;display:none;flex-direction:column;padding:6vh 8vw;
  background:linear-gradient(180deg,rgba(4,8,12,0.55),rgba(4,8,12,0.9));backdrop-filter:blur(3px);}
.mp-hub.on{display:flex;}
.mp-title{font-size:30px;font-weight:900;letter-spacing:.3em;color:#ffd166;margin-bottom:6px;}
.mp-user{font-size:12px;letter-spacing:.2em;color:#8fa6bb;margin-bottom:3.4vh;}
.mp-user b{color:#7df9ff;cursor:pointer;border-bottom:1px dotted #7df9ff;}
.mp-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;max-width:1080px;}
.mp-it{background:rgba(12,18,26,0.88);border:1px solid rgba(255,255,255,0.1);border-radius:10px;
  padding:20px 20px;cursor:pointer;transition:transform .14s ease,border-color .14s ease;}
.mp-it:hover{transform:translateY(-4px);border-color:rgba(255,209,102,0.7);box-shadow:0 10px 34px rgba(0,0,0,0.5);}
.mp-it .ic{font-size:26px;margin-bottom:8px;}
.mp-it .nm{font-size:15px;font-weight:800;letter-spacing:.12em;margin-bottom:6px;color:#eaf6ff;}
.mp-it .ds{font-size:11.5px;line-height:1.55;opacity:.6;}
.mp-back{margin-top:auto;align-self:center;font-size:12.5px;font-weight:700;letter-spacing:.26em;
  color:#8fa6bb;cursor:pointer;padding:8px 14px;}
.mp-back:hover{color:#7df9ff;}
/* hub PANELS (stats / accolades / maps / weapons) */
.mp-panel{position:absolute;inset:0;display:none;flex-direction:column;padding:6vh 8vw;
  background:rgba(4,8,12,0.94);}
.mp-panel.on{display:flex;}
.mp-panel h2{font-size:22px;font-weight:900;letter-spacing:.26em;color:#7df9ff;margin-bottom:2.6vh;}
.mp-body{flex:1;overflow:auto;max-width:1080px;}
.mp-body::-webkit-scrollbar{width:8px;}.mp-body::-webkit-scrollbar-thumb{background:rgba(125,249,255,0.25);border-radius:4px;}
.st-row{display:flex;gap:14px;flex-wrap:wrap;margin-bottom:22px;}
.st-tile{background:rgba(12,18,26,0.9);border:1px solid rgba(125,249,255,0.18);border-radius:10px;
  padding:16px 22px;min-width:130px;}
.st-tile .v{font-size:26px;font-weight:900;color:#eaf6ff;}
.st-tile .k{font-size:10.5px;letter-spacing:.18em;color:#8fa6bb;margin-top:3px;}
.acc-line,.map-line{display:flex;align-items:center;gap:12px;background:rgba(12,18,26,0.85);
  border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:10px 16px;margin-bottom:8px;font-size:13px;}
.acc-line .n{margin-left:auto;font-weight:800;color:#ffd166;}
.map-line .by{opacity:.55;font-size:11.5px;}
.map-line .tag{margin-left:auto;font-size:10px;letter-spacing:.14em;padding:3px 8px;border-radius:4px;
  background:rgba(177,91,255,0.16);color:#c9a2ff;border:1px solid rgba(177,91,255,0.35);}
.wp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px;}
.wp-card{background:rgba(12,18,26,0.9);border:1px solid rgba(255,255,255,0.09);border-radius:10px;padding:14px 16px;}
.wp-card .nm{font-weight:800;font-size:13.5px;letter-spacing:.1em;margin-bottom:2px;}
.wp-card .cam{font-size:11px;letter-spacing:.12em;margin:4px 0 8px;}
.wp-bar{height:6px;border-radius:3px;background:rgba(255,255,255,0.08);overflow:hidden;}
.wp-bar i{display:block;height:100%;border-radius:3px;background:linear-gradient(90deg,#18b6d8,#7df9ff);}
.wp-card .kc{font-size:10.5px;opacity:.55;margin-top:6px;}
`;

function injectCss(id, t) { if (document.getElementById(id)) return; const s = document.createElement('style'); s.id = id; s.textContent = t; document.head.appendChild(s); }
function go(mode) { const u = new URL(location.href); u.searchParams.set('mode', mode); location.href = u.toString(); }
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Flipped to true when the TD mode registers in main.js (its milestone lands
// later in the pipeline) — until then the channel announces instead of bouncing.
const TD_READY = false;

// captions shown in the ticker per hovered channel (MW2-style description strip)
const CAPTIONS = {
  td: 'Hold the line — place and upgrade units between waves, then fight the horde yourself in first person.',
  range: 'Single-player facility — tune movement + every gun, targets, drills, crosshair editor.',
  mp: 'The always-on crew arena — 2–6 players, server-authoritative netcode. Maps, stats, accolades, camos.',
  idle: 'SELECT A CHANNEL',
};

export class MainMenu {
  constructor() {
    injectCss('main-menu-css', CSS);
    this.settings = new Settings();
    this.settingsPanel = new SettingsPanel(this.settings);

    const parent = document.getElementById('ui') || document.body;
    const root = document.createElement('div');
    root.className = 'mm-root interactive';
    root.innerHTML = `
      <div class="mm-bg">
        <div class="sky"></div><div class="grid"></div>
        <div class="fog f1"></div><div class="fog f2"></div><div class="fog f3"></div>
        <div class="scan"></div><div class="vig"></div>
      </div>
      <div class="mm-head"><div class="mm-title">ARENA</div><div class="mm-sub">N&nbsp;GAMES</div></div>
      <div class="mm-band">
        <div class="mm-ch td" data-ch="td">
          <div class="bar">TOWER DEFENSE</div>
          <div class="scr"><canvas></canvas><div class="noise"></div></div>
          <div class="cap">FPS × TD · CO-BUILD THE LINE</div>
        </div>
        <div class="mm-ch sp" data-ch="range">
          <div class="bar">TEST RANGE</div>
          <div class="scr"><canvas></canvas><div class="noise"></div></div>
          <div class="cap">WARM UP · TUNE · DRILL</div>
        </div>
        <div class="mm-ch mp" data-ch="mp">
          <div class="bar">MULTIPLAYER</div>
          <div class="scr"><canvas></canvas><div class="noise"></div></div>
          <div class="cap">CREW SERVER · LIVE</div>
        </div>
      </div>
      <div class="mm-tick">${CAPTIONS.idle}</div>
      <div class="mm-bot">
        <div class="bi" data-bot="editor">MAP EDITOR</div>
        <div class="bi" data-bot="settings">SETTINGS</div>
        <div class="bi" data-bot="radio">📻 RADIO: OFF</div>
      </div>

      <div class="mp-hub">
        <div class="mp-title">MULTIPLAYER</div>
        <div class="mp-user">SIGNED IN AS <b data-prof></b></div>
        <div class="mp-grid">
          <div class="mp-it" data-mp="join"><div class="ic">🛰️</div><div class="nm">JOIN CREW SERVER</div><div class="ds">Drop into the always-on arena — live now.</div></div>
          <div class="mp-it" data-mp="editor"><div class="ic">🛠️</div><div class="nm">CREATE A MAP</div><div class="ds">First-person WYSIWYG builder. Publish to the crew.</div></div>
          <div class="mp-it" data-mp="maps"><div class="ic">🗺️</div><div class="nm">VIEW MAPS</div><div class="ds">Built-in arenas + every crew-made map, with authors.</div></div>
          <div class="mp-it" data-mp="accolades"><div class="ic">🏅</div><div class="nm">ACCOLADES</div><div class="ds">Every medal you've earned across matches.</div></div>
          <div class="mp-it" data-mp="stats"><div class="ic">📈</div><div class="nm">STATS</div><div class="ds">Kills, deaths, K/D, wins, playtime — tracked per profile.</div></div>
          <div class="mp-it" data-mp="weapons"><div class="ic">🎨</div><div class="nm">WEAPONS &amp; CAMOS</div><div class="ds">Per-weapon kill progression unlocks camo tiers.</div></div>
        </div>
        <div class="mp-back" data-mp="back">◄ BACK</div>
      </div>

      <div class="mp-panel" data-panel="maps"><h2>MAPS</h2><div class="mp-body"></div><div class="mp-back" data-mp="hub">◄ BACK</div></div>
      <div class="mp-panel" data-panel="accolades"><h2>ACCOLADES</h2><div class="mp-body"></div><div class="mp-back" data-mp="hub">◄ BACK</div></div>
      <div class="mp-panel" data-panel="stats"><h2>STATS</h2><div class="mp-body"></div><div class="mp-back" data-mp="hub">◄ BACK</div></div>
      <div class="mp-panel" data-panel="weapons"><h2>WEAPONS &amp; CAMOS</h2><div class="mp-body"></div><div class="mp-back" data-mp="hub">◄ BACK</div></div>`;
    parent.appendChild(root);
    this.root = root;

    // ---- wiring ----
    const tick = root.querySelector('.mm-tick');
    root.querySelectorAll('.mm-ch').forEach((c) => {
      const ch = c.getAttribute('data-ch');
      c.addEventListener('mouseenter', () => { tick.textContent = CAPTIONS[ch === 'sp' ? 'range' : ch] || CAPTIONS[ch] || CAPTIONS.idle; });
      c.addEventListener('mouseleave', () => { tick.textContent = CAPTIONS.idle; });
      c.addEventListener('click', () => {
        if (ch === 'range') go('range');
        else if (ch === 'td') {
          if (TD_READY) go('td');
          else { tick.textContent = '⚠ TOWER DEFENSE — FINAL ASSEMBLY IN PROGRESS. DEPLOYING SOON.'; tick.style.color = '#9fe86a'; setTimeout(() => { tick.style.color = ''; }, 1600); }
        } else this._show('hub');
      });
    });
    root.querySelector('[data-bot="editor"]').addEventListener('click', () => go('editor'));
    root.querySelector('[data-bot="settings"]').addEventListener('click', () => this.settingsPanel.open());
    // menu radio: local playback, click to cycle stations (in-game it's the shared voted station)
    const radioBtn = root.querySelector('[data-bot="radio"]');
    let radioIdx = STATIONS.length - 1; // start at OFF
    radioBtn.addEventListener('click', () => {
      radioIdx = (radioIdx + 1) % STATIONS.length;
      const st = STATIONS[radioIdx];
      this._radio = this._radio || new RadioPlayer(0.35);
      this._radio.setStation(st);
      radioBtn.textContent = `📻 RADIO: ${st.url ? st.name : 'OFF'}`;
    });
    root.querySelectorAll('[data-mp]').forEach((el) => el.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const k = el.getAttribute('data-mp');
      if (k === 'join') go('arena');
      else if (k === 'editor') go('editor');
      else if (k === 'back') this._show(null);
      else if (k === 'hub') this._show('hub');
      else this._show(k);
    }));
    // profile name (click to rename)
    const profEl = root.querySelector('[data-prof]');
    const prof = getProfile();
    profEl.textContent = prof.name;
    profEl.addEventListener('click', () => {
      const n = prompt('Profile name (stats + map authorship track this):', prof.name);
      if (n && n.trim()) { prof.name = n.trim().slice(0, 20); prof.save(); profEl.textContent = prof.name; }
    });

    // parallax on the backdrop
    const bg = root.querySelector('.mm-bg');
    root.addEventListener('mousemove', (e) => {
      const dx = (e.clientX / innerWidth - 0.5), dy = (e.clientY / innerHeight - 0.5);
      bg.style.transform = `translate(${dx * -14}px, ${dy * -8}px) scale(1.04)`;
    });

    // live channel previews (code-drawn, ~20fps)
    this._previews = [];
    this._startPreviews();
  }

  _show(view) {
    this.root.querySelector('.mp-hub').classList.toggle('on', view === 'hub');
    this.root.querySelectorAll('.mp-panel').forEach((p) => p.classList.toggle('on', p.getAttribute('data-panel') === view));
    if (view === 'maps') this._renderMaps();
    if (view === 'stats') this._renderStats();
    if (view === 'accolades') this._renderAccolades();
    if (view === 'weapons') this._renderWeapons();
  }

  // ---- hub panels (profile-backed; server-merged when reachable) ------------
  async _renderMaps() {
    const body = this.root.querySelector('[data-panel="maps"] .mp-body');
    const builtins = mapList().filter((m) => !m.custom);
    let customs = [];
    try { const r = await fetch('/api/maps'); if (r.ok) customs = await r.json(); } catch { /* offline/dev */ }
    body.innerHTML = builtins.map((m) => `<div class="map-line"><b>${esc(m.name)}</b><span class="by">N GAMES</span></div>`).join('')
      + (customs.length ? customs.map((c) => `<div class="map-line"><b>${esc(c.name || c.id)}</b><span class="by">by ${esc(c.author || 'anon')}</span><span class="tag">CUSTOM</span></div>`).join('')
        : '<div class="map-line"><span class="by">No crew maps yet — CREATE A MAP to publish the first one.</span></div>');
  }

  async _renderStats() {
    const body = this.root.querySelector('[data-panel="stats"] .mp-body');
    const s = await getStats();
    const kd = s.deaths ? (s.kills / s.deaths).toFixed(2) : String(s.kills);
    const mins = Math.round((s.playMs || 0) / 60000);
    body.innerHTML = `<div class="st-row">
      <div class="st-tile"><div class="v">${s.kills | 0}</div><div class="k">KILLS</div></div>
      <div class="st-tile"><div class="v">${s.deaths | 0}</div><div class="k">DEATHS</div></div>
      <div class="st-tile"><div class="v">${kd}</div><div class="k">K / D</div></div>
      <div class="st-tile"><div class="v">${s.wins | 0}</div><div class="k">ROUND WINS</div></div>
      <div class="st-tile"><div class="v">${s.bestStreak | 0}</div><div class="k">BEST STREAK</div></div>
      <div class="st-tile"><div class="v">${mins}m</div><div class="k">TIME IN ARENA</div></div>
    </div><div style="font-size:11px;letter-spacing:.12em;opacity:.45">TRACKED PER PROFILE · SYNCED WITH THE CREW SERVER WHEN ONLINE</div>`;
  }

  async _renderAccolades() {
    const body = this.root.querySelector('[data-panel="accolades"] .mp-body');
    const s = await getStats();
    const acc = s.accolades || {};
    const keys = Object.keys(acc).sort((a, b) => acc[b] - acc[a]);
    body.innerHTML = keys.length
      ? keys.map((k) => `<div class="acc-line">🏅 <b>${esc(k.replace(/_/g, ' ').toUpperCase())}</b><span class="n">×${acc[k]}</span></div>`).join('')
      : '<div class="acc-line"><span style="opacity:.55">No medals yet — earn accolades in the arena (multikills, wallrun kills, savior plays…) and they collect here.</span></div>';
  }

  async _renderWeapons() {
    const body = this.root.querySelector('[data-panel="weapons"] .mp-body');
    const s = await getStats();
    const wk = s.weaponKills || {};
    body.innerHTML = `<div class="wp-grid">` + WEAPONS.map((w) => {
      const kills = wk[w.id] | 0;
      const camo = camoForKills(kills);
      const next = CAMO_TIERS.find((t) => kills < t.kills);
      const pct = next ? Math.min(100, Math.round((kills / next.kills) * 100)) : 100;
      return `<div class="wp-card"><div class="nm">${esc(w.name)}</div>
        <div class="cam" style="color:${camo.css}">◈ ${camo.name}${next ? '' : ' · MAXED'}</div>
        <div class="wp-bar"><i style="width:${pct}%"></i></div>
        <div class="kc">${kills} kills${next ? ` · ${next.kills - kills} to ${next.name}` : ''}</div></div>`;
    }).join('') + `</div>`;
  }

  // ---- animated channel previews (tiny code-drawn scenes) -------------------
  _startPreviews() {
    const scrs = this.root.querySelectorAll('.mm-ch');
    const draw = { td: this._drawTd, range: this._drawRange, mp: this._drawMp };
    for (const ch of scrs) {
      const kind = ch.getAttribute('data-ch') === 'sp' ? 'range' : ch.getAttribute('data-ch');
      const cv = ch.querySelector('canvas');
      cv.width = 340; cv.height = 250;
      this._previews.push({ g: cv.getContext('2d'), fn: (draw[kind] || this._drawRange).bind(this), t: Math.random() * 9 });
    }
    const step = () => {
      if (!document.body.contains(this.root)) return;
      for (const p of this._previews) { p.t += 0.05; try { p.fn(p.g, p.t); } catch { /* never break the menu */ } }
      setTimeout(() => requestAnimationFrame(step), 50);
    };
    requestAnimationFrame(step);
  }

  _drawRange(g, t) { // pulsing target rings + a tracer ping
    const W = 340, H = 250; g.fillStyle = '#08131c'; g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(125,249,255,0.12)'; for (let y = 30; y < H; y += 36) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    const cx = W / 2 + Math.sin(t * 0.6) * 46, cy = H / 2 + Math.cos(t * 0.4) * 22;
    for (let i = 3; i >= 1; i--) {
      const r = i * 22 + Math.sin(t * 2) * 3;
      g.beginPath(); g.arc(cx, cy, r, 0, 7); g.strokeStyle = `rgba(125,249,255,${0.16 * i})`; g.lineWidth = 2.4; g.stroke();
    }
    g.fillStyle = '#7df9ff'; g.beginPath(); g.arc(cx, cy, 5.2, 0, 7); g.fill();
    const p = (t * 0.9) % 1; g.strokeStyle = `rgba(255,240,168,${1 - p})`; g.lineWidth = 2;
    g.beginPath(); g.moveTo(0, H - 20); g.lineTo(p * cx, H - 20 - p * (H - 20 - cy)); g.stroke();
  }

  _drawMp(g, t) { // radar sweep with crew blips
    const W = 340, H = 250; g.fillStyle = '#0a1018'; g.fillRect(0, 0, W, H);
    const cx = W / 2, cy = H / 2 + 8, R = 92;
    for (let i = 1; i <= 3; i++) { g.beginPath(); g.arc(cx, cy, (R / 3) * i, 0, 7); g.strokeStyle = 'rgba(255,209,102,0.16)'; g.lineWidth = 1.4; g.stroke(); }
    const a = t * 1.4; const grad = g.createConicGradient ? g.createConicGradient(a, cx, cy) : null;
    if (grad) { grad.addColorStop(0, 'rgba(255,209,102,0.5)'); grad.addColorStop(0.12, 'rgba(255,209,102,0)'); grad.addColorStop(1, 'rgba(255,209,102,0)');
      g.fillStyle = grad; g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, R, 0, 7); g.fill(); }
    const blips = [[0.5, 1.1], [2.2, 0.55], [3.9, 0.85], [5.2, 0.35]];
    for (const [ba, br] of blips) {
      const vis = Math.max(0, 1 - (((a - ba) % 6.283) + 6.283) % 6.283 / 2.4);
      g.fillStyle = `rgba(255,209,102,${vis})`; g.beginPath();
      g.arc(cx + Math.cos(ba) * R * br, cy + Math.sin(ba) * R * br, 4, 0, 7); g.fill();
    }
  }

  _drawTd(g, t) { // horde dots marching a lane toward the tower core
    const W = 340, H = 250; g.fillStyle = '#0a1410'; g.fillRect(0, 0, W, H);
    const path = (u) => ({ x: 18 + u * (W - 90), y: H / 2 + Math.sin(u * 6.28) * 44 });
    g.strokeStyle = 'rgba(159,232,106,0.22)'; g.lineWidth = 13; g.beginPath();
    for (let u = 0; u <= 1.001; u += 0.02) { const p = path(u); u === 0 ? g.moveTo(p.x, p.y) : g.lineTo(p.x, p.y); } g.stroke();
    // tower core
    const pulse = 0.5 + 0.5 * Math.sin(t * 2);
    g.fillStyle = `rgba(125,249,255,${0.5 + pulse * 0.4})`; g.fillRect(W - 58, H / 2 - 20, 26, 40);
    g.strokeStyle = 'rgba(125,249,255,0.6)'; g.strokeRect(W - 64, H / 2 - 26, 38, 52);
    // horde
    for (let i = 0; i < 7; i++) {
      const u = ((t * 0.09 + i * 0.13) % 1); const p = path(u);
      g.fillStyle = i % 2 ? '#9fe86a' : '#c96af0'; g.beginPath(); g.arc(p.x, p.y, 5, 0, 7); g.fill();
    }
    // turrets popping shots at the lane
    for (const [tx, ty] of [[90, 34], [180, H - 34], [252, 52]]) {
      g.fillStyle = '#ffd166'; g.fillRect(tx - 4, ty - 4, 8, 8);
      const u = ((t * 0.09 + 0.4) % 1); const p = path(u);
      g.strokeStyle = `rgba(255,209,102,${0.25 + 0.3 * Math.sin(t * 7 + tx)})`; g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(tx, ty); g.lineTo(p.x, p.y); g.stroke();
    }
  }
}
