// Landing MAIN MENU — the unified entry that combines single-player RANGE and
// the multiplayer ARENA into one game. Shown when the URL has no ?mode. Picking
// a mode navigates to it (?mode=range / ?mode=arena). Includes the shared
// Settings panel. Pure DOM/CSS; no renderer/game is built until a mode is chosen.
import { Settings } from '../core/Settings.js';
import { SettingsPanel } from './SettingsPanel.js';

const CSS = `
.mm-root{position:absolute;inset:0;z-index:60;display:flex;flex-direction:column;
  align-items:center;justify-content:center;gap:34px;
  background:radial-gradient(circle at 50% 40%,#0e1622 0%,#070a10 70%,#04060a 100%);
  font-family:'Segoe UI',system-ui,-apple-system,sans-serif;overflow:hidden;}
.mm-grid{position:absolute;inset:-20%;background-image:
  linear-gradient(rgba(125,249,255,0.05) 1px,transparent 1px),
  linear-gradient(90deg,rgba(125,249,255,0.05) 1px,transparent 1px);
  background-size:44px 44px;transform:perspective(500px) rotateX(62deg) translateY(20%);
  animation:mm-scroll 8s linear infinite;opacity:.5;}
@keyframes mm-scroll{to{background-position:0 44px;}}
.mm-title{position:relative;font-size:74px;font-weight:900;letter-spacing:.36em;
  color:#eaf6ff;text-shadow:0 0 40px rgba(125,249,255,0.55);margin-right:-.36em;}
.mm-sub{position:relative;font-size:13px;letter-spacing:.5em;color:#7df9ff;opacity:.75;margin-top:-22px;margin-right:-.5em;}
.mm-cards{position:relative;display:flex;gap:22px;flex-wrap:wrap;justify-content:center;padding:0 20px;}
.mm-card{width:250px;padding:26px 24px;border-radius:12px;cursor:pointer;
  background:rgba(14,20,28,0.85);border:1px solid rgba(255,255,255,0.1);
  transition:transform .15s ease,border-color .15s ease,box-shadow .15s ease;}
.mm-card:hover{transform:translateY(-5px);border-color:rgba(125,249,255,0.6);
  box-shadow:0 14px 44px rgba(0,0,0,0.55),0 0 30px rgba(125,249,255,0.12);}
.mm-card .ic{font-size:34px;margin-bottom:12px;}
.mm-card .nm{font-size:20px;font-weight:800;letter-spacing:.14em;color:#eaf6ff;margin-bottom:8px;}
.mm-card .ds{font-size:12.5px;line-height:1.6;opacity:.62;}
.mm-card.sp .nm{color:#7df9ff;} .mm-card.mp .nm{color:#ffd166;} .mm-card.st .nm{color:#c9d4e0;} .mm-card.ed .nm{color:#b15bff;}
.mm-foot{position:relative;font-size:11px;letter-spacing:.14em;opacity:.4;}
`;

function injectCss(id, t) { if (document.getElementById(id)) return; const s = document.createElement('style'); s.id = id; s.textContent = t; document.head.appendChild(s); }
function go(mode) { const u = new URL(location.href); u.searchParams.set('mode', mode); location.href = u.toString(); }

export class MainMenu {
  constructor() {
    injectCss('main-menu-css', CSS);
    this.settings = new Settings();
    this.settingsPanel = new SettingsPanel(this.settings);

    const parent = document.getElementById('ui') || document.body;
    const root = document.createElement('div');
    root.className = 'mm-root interactive';
    root.innerHTML = `
      <div class="mm-grid"></div>
      <div>
        <div class="mm-title">ARENA</div>
        <div class="mm-sub">N&nbsp;GAMES · MOVEMENT FPS</div>
      </div>
      <div class="mm-cards">
        <div class="mm-card sp" data-go="range">
          <div class="ic">🎯</div><div class="nm">TEST RANGE</div>
          <div class="ds">Single-player facility — tune movement + all 7 guns, targets, drills, crosshair editor.</div>
        </div>
        <div class="mm-card mp" data-go="arena">
          <div class="ic">🔫</div><div class="nm">MULTIPLAYER</div>
          <div class="ds">Join the always-on crew arena — 2–6 players, server-authoritative netcode, live now.</div>
        </div>
        <div class="mm-card ed" data-go="editor">
          <div class="ic">🛠️</div><div class="nm">MAP EDITOR</div>
          <div class="ds">Fly-around WYSIWYG builder — place blocks, ramps, lights + spawns, save custom arenas.</div>
        </div>
        <div class="mm-card st" data-set>
          <div class="ic">⚙️</div><div class="nm">SETTINGS</div>
          <div class="ds">Audio, mouse sensitivity, FOV, view-bob, damage numbers. Saved locally.</div>
        </div>
      </div>
      <div class="mm-foot">CLICK A MODE TO PLAY</div>`;
    parent.appendChild(root);
    this.root = root;

    root.querySelectorAll('[data-go]').forEach((c) => c.addEventListener('click', () => go(c.getAttribute('data-go'))));
    root.querySelector('[data-set]').addEventListener('click', () => this.settingsPanel.open());
  }
}
