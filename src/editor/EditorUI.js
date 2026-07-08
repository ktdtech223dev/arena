// RANGE — src/editor/EditorUI.js
// The editor's DOM overlay UI: a top TOOLBAR (name/skybox/new/save/load/undo/redo/
// snap/grid + light-count indicator), a left PALETTE (tabs by category listing
// BLOCK_TYPES + LIGHT_KINDS + OBJECT_KINDS with code-drawn swatches), a right
// PROPERTIES panel for the selected object, a LOAD dialog (fetch /api/maps), a
// SAVE flow (validate + POST), toasts, a confirm modal, a crosshair, and a
// controls/help overlay. Matches the game's dark-cyber CSS. Pure DOM/CSS.
import {
  BLOCK_TYPES, LIGHT_KINDS, OBJECT_KINDS, MAX_CUSTOM_LIGHTS,
  SKYBOX_PRESETS, POWERUPS, SPAWN_WEAPONS, CUSTOM_LIMITS,
} from '../../shared/custommap.js';

const CATS = [
  { id: 'structural', label: 'Structural', kind: 'block' },
  { id: 'ramp', label: 'Ramps', kind: 'block' },
  { id: 'movement', label: 'Movement', kind: 'block' },
  { id: 'props', label: 'Props', kind: 'block' },
  { id: 'hazard', label: 'Hazards', kind: 'block' },
  { id: 'interactive', label: 'Interactive', kind: 'block' },
  { id: 'cosmetic', label: 'Cosmetic', kind: 'block' },
  { id: 'lights', label: 'Lights', kind: 'light' },
  { id: 'gameplay', label: 'Gameplay', kind: 'object' },
];

const hexStr = (n) => '#' + (n >>> 0 & 0xffffff).toString(16).padStart(6, '0');
const toHexNum = (s) => parseInt(String(s).replace('#', ''), 16) | 0;

const CSS = `
/* the root overlay must NOT eat clicks in the empty play area (they need to reach
   the canvas so click-to-look / place works); only the interactive panels below
   re-enable pointer-events. */
.ed-root{position:absolute;inset:0;z-index:40;font-family:'Segoe UI',system-ui,-apple-system,sans-serif;color:#dfe7f0;pointer-events:none;}
.ed-root, .ed-root *{box-sizing:border-box;}
.ed-cross{position:absolute;left:50%;top:50%;width:16px;height:16px;transform:translate(-50%,-50%);pointer-events:none;z-index:41;}
.ed-cross:before,.ed-cross:after{content:'';position:absolute;background:#7df9ff;box-shadow:0 0 6px rgba(125,249,255,0.7);}
.ed-cross:before{left:50%;top:0;width:2px;height:16px;transform:translateX(-50%);}
.ed-cross:after{top:50%;left:0;height:2px;width:16px;transform:translateY(-50%);}

/* TOP TOOLBAR */
.ed-top{position:absolute;top:0;left:0;right:0;height:46px;display:flex;align-items:center;gap:10px;
  padding:0 12px;background:linear-gradient(180deg,rgba(10,14,20,0.96),rgba(10,14,20,0.82));
  border-bottom:1px solid rgba(125,249,255,0.22);pointer-events:auto;overflow-x:auto;}
.ed-top .ed-brand{font-weight:900;letter-spacing:.28em;color:#b15bff;font-size:14px;text-shadow:0 0 16px rgba(177,91,255,0.5);white-space:nowrap;}
.ed-top input.ed-name{background:rgba(255,255,255,0.06);border:1px solid rgba(125,249,255,0.25);border-radius:5px;
  color:#eaf6ff;padding:6px 9px;font-size:13px;width:150px;letter-spacing:.06em;}
.ed-top select,.ed-top .ed-btn{background:rgba(255,255,255,0.06);border:1px solid rgba(125,249,255,0.22);border-radius:5px;
  color:#dfe7f0;padding:6px 10px;font-size:12px;cursor:pointer;letter-spacing:.08em;white-space:nowrap;}
.ed-top .ed-btn:hover,.ed-top select:hover{border-color:#7df9ff;background:rgba(125,249,255,0.14);}
.ed-top .ed-btn.pri{background:#7df9ff;color:#06121a;font-weight:700;border-color:#7df9ff;}
.ed-top .ed-btn.pri:hover{background:#a8fbff;}
.ed-top .ed-btn.warn{color:#ffd166;border-color:rgba(255,209,102,0.4);}
.ed-top .ed-sep{width:1px;height:24px;background:rgba(255,255,255,0.12);}
.ed-top .ed-lbl{font-size:10px;letter-spacing:.16em;text-transform:uppercase;opacity:.55;white-space:nowrap;}
.ed-lights{font-size:12px;font-weight:700;letter-spacing:.08em;padding:5px 9px;border-radius:5px;
  border:1px solid rgba(125,249,255,0.3);background:rgba(125,249,255,0.08);color:#7df9ff;white-space:nowrap;}
.ed-lights.cap{color:#ff6b6b;border-color:rgba(255,107,107,0.5);background:rgba(255,107,107,0.1);}
.ed-grid-in{width:52px;background:rgba(255,255,255,0.06);border:1px solid rgba(125,249,255,0.22);border-radius:5px;color:#eaf6ff;padding:5px 6px;font-size:12px;}
.ed-mode-pill{font-size:11px;font-weight:800;letter-spacing:.18em;padding:5px 11px;border-radius:5px;white-space:nowrap;}
.ed-mode-pill.place{background:rgba(125,249,255,0.14);color:#7df9ff;border:1px solid rgba(125,249,255,0.4);}
.ed-mode-pill.edit{background:rgba(255,209,102,0.14);color:#ffd166;border:1px solid rgba(255,209,102,0.4);}
.ed-snap{cursor:pointer;}
.ed-snap.on{color:#7df9ff;border-color:#7df9ff;}

/* PALETTE (left) */
.ed-pal{position:absolute;left:0;top:46px;bottom:0;width:212px;background:rgba(9,13,19,0.9);
  border-right:1px solid rgba(125,249,255,0.16);display:flex;flex-direction:column;pointer-events:auto;}
.ed-tabs{display:flex;flex-wrap:wrap;padding:8px 8px 4px;gap:4px;border-bottom:1px solid rgba(255,255,255,0.07);}
.ed-tab{font-size:9.5px;letter-spacing:.1em;text-transform:uppercase;padding:5px 7px;border-radius:4px;cursor:pointer;
  color:#8fa3b8;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.03);}
.ed-tab:hover{color:#eaffff;border-color:rgba(125,249,255,0.4);}
.ed-tab.on{color:#06121a;background:#7df9ff;border-color:#7df9ff;font-weight:700;}
.ed-items{flex:1;overflow-y:auto;padding:8px;display:grid;grid-template-columns:1fr 1fr;gap:7px;align-content:start;}
.ed-items::-webkit-scrollbar{width:7px;}.ed-items::-webkit-scrollbar-thumb{background:rgba(125,249,255,0.22);border-radius:4px;}
.ed-item{display:flex;flex-direction:column;align-items:center;gap:5px;padding:8px 5px;border-radius:6px;cursor:pointer;
  background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);transition:all .12s;}
.ed-item:hover{border-color:rgba(125,249,255,0.5);background:rgba(125,249,255,0.07);}
.ed-item.on{border-color:#7df9ff;box-shadow:0 0 0 1px #7df9ff inset,0 0 16px rgba(125,249,255,0.2);}
.ed-item .sw{width:38px;height:38px;border-radius:5px;display:flex;align-items:center;justify-content:center;}
.ed-item .nm{font-size:9.5px;letter-spacing:.04em;text-align:center;line-height:1.2;color:#cdd8e4;}

/* PROPERTIES (right) */
.ed-props{position:absolute;right:0;top:46px;bottom:0;width:250px;background:rgba(9,13,19,0.9);
  border-left:1px solid rgba(125,249,255,0.16);overflow-y:auto;pointer-events:auto;padding:14px;}
.ed-props::-webkit-scrollbar{width:7px;}.ed-props::-webkit-scrollbar-thumb{background:rgba(125,249,255,0.22);border-radius:4px;}
.ed-props h3{font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:#7df9ff;margin-bottom:3px;}
.ed-props .ed-psub{font-size:10px;letter-spacing:.14em;opacity:.5;text-transform:uppercase;margin-bottom:14px;}
.ed-prow{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:9px 0;font-size:12px;}
.ed-prow label{opacity:.85;letter-spacing:.04em;min-width:34px;}
.ed-prow input[type=number]{width:66px;background:rgba(255,255,255,0.06);border:1px solid rgba(125,249,255,0.2);border-radius:4px;color:#eaf6ff;padding:4px 6px;font-size:12px;}
.ed-prow input[type=color]{width:34px;height:26px;background:none;border:1px solid rgba(125,249,255,0.2);border-radius:4px;cursor:pointer;padding:0;}
.ed-prow input[type=checkbox]{width:16px;height:16px;accent-color:#7df9ff;}
.ed-prow select{flex:1;background:rgba(255,255,255,0.06);border:1px solid rgba(125,249,255,0.2);border-radius:4px;color:#eaf6ff;padding:4px 6px;font-size:12px;}
.ed-triplet{display:flex;gap:5px;}
.ed-triplet input{width:100%;}
.ed-pgrp{font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:#8fd7e0;margin:16px 0 6px;border-bottom:1px solid rgba(255,255,255,0.08);padding-bottom:4px;}
.ed-pempty{opacity:.4;font-size:12px;line-height:1.7;margin-top:30px;text-align:center;letter-spacing:.04em;}
.ed-pactions{display:flex;gap:6px;margin-top:16px;}
.ed-pactions button{flex:1;font-size:11px;letter-spacing:.1em;padding:8px;border-radius:5px;cursor:pointer;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.05);color:#dfe7f0;}
.ed-pactions button:hover{border-color:#7df9ff;}
.ed-pactions button.del{color:#ff6b6b;border-color:rgba(255,107,107,0.4);}
.ed-pactions button.del:hover{background:rgba(255,107,107,0.12);}

/* HELP hint */
.ed-help{position:absolute;left:220px;bottom:12px;max-width:520px;background:rgba(9,13,19,0.82);
  border:1px solid rgba(125,249,255,0.18);border-radius:7px;padding:9px 13px;font-size:11px;line-height:1.7;
  color:#aebccb;letter-spacing:.03em;pointer-events:auto;}
.ed-help b{color:#7df9ff;font-weight:700;}
.ed-help .ed-hclose{float:right;cursor:pointer;color:#8fa3b8;margin-left:10px;}
/* MINECRAFT-CREATIVE model: in first-person (pointer locked) the build panels hide
   so it's a clean fly+build view; press B (or Esc) to open the "build menu" (unlock)
   and the panels come back. The crosshair + hotbar + fp-hint stay visible always. */
.ed-locked .ed-top, .ed-locked .ed-pal, .ed-locked .ed-props, .ed-locked .ed-help{display:none !important;}
.ed-fphint{position:absolute;left:50%;bottom:70px;transform:translateX(-50%);font-size:10.5px;letter-spacing:.1em;
  color:#8fa6bb;background:rgba(6,10,14,0.5);padding:5px 12px;border-radius:6px;pointer-events:none;white-space:nowrap;
  z-index:41;display:none;}
.ed-locked .ed-fphint{display:block;}
.ed-fphint b{color:#cfe7f2;}
.ed-hotbar{position:absolute;left:50%;bottom:16px;transform:translateX(-50%);display:flex;gap:5px;z-index:42;pointer-events:auto;}
.ed-hslot{width:46px;height:46px;border-radius:8px;background:rgba(9,13,19,0.82);border:1px solid rgba(125,249,255,0.16);
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;cursor:pointer;position:relative;
  transition:border-color .1s,transform .1s;}
.ed-hslot:hover{border-color:rgba(125,249,255,0.5);}
.ed-hslot.on{border-color:#7df9ff;box-shadow:0 0 0 1px #7df9ff inset,0 0 14px rgba(125,249,255,0.25);transform:translateY(-3px);}
.ed-hslot .hg{font-size:19px;line-height:1;}
.ed-hslot .hn{font-size:7px;letter-spacing:.04em;opacity:.65;max-width:44px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.ed-hslot .hk{position:absolute;top:2px;left:4px;font-size:8px;font-weight:800;color:#7df9ff;opacity:.7;}
.ed-hint{position:absolute;left:50%;bottom:14px;transform:translateX(-50%);font-size:11px;letter-spacing:.16em;
  text-transform:uppercase;color:#7df9ff;opacity:.7;background:rgba(9,13,19,0.7);padding:7px 16px;border-radius:20px;
  border:1px solid rgba(125,249,255,0.25);pointer-events:none;}

/* MODAL (load / confirm) */
.ed-scrim{position:absolute;inset:0;z-index:70;display:none;align-items:center;justify-content:center;
  background:rgba(4,6,10,0.72);backdrop-filter:blur(5px);pointer-events:auto;}
.ed-scrim.on{display:flex;}
.ed-modal{width:min(640px,92vw);max-height:86vh;display:flex;flex-direction:column;background:rgba(12,16,22,0.97);
  border:1px solid rgba(125,249,255,0.28);border-radius:10px;box-shadow:0 20px 70px rgba(0,0,0,0.6);color:#dfe7f0;overflow:hidden;}
.ed-mhead{display:flex;align-items:center;justify-content:space-between;padding:18px 22px 12px;border-bottom:1px solid rgba(255,255,255,0.08);}
.ed-mtitle{font-size:18px;font-weight:800;letter-spacing:.2em;color:#7df9ff;}
.ed-mx{cursor:pointer;color:#8fa3b8;font-size:12px;font-weight:700;letter-spacing:.14em;padding:6px 11px;border:1px solid rgba(125,249,255,0.28);border-radius:5px;}
.ed-mx:hover{color:#eaffff;border-color:#7df9ff;}
.ed-mbody{padding:18px 22px 22px;overflow-y:auto;}
.ed-maplist{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
.ed-mapcard{border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:13px;cursor:pointer;background:rgba(14,20,28,0.85);position:relative;transition:all .13s;}
.ed-mapcard:hover{border-color:rgba(125,249,255,0.55);transform:translateY(-2px);}
.ed-mapcard .mn{font-size:14px;font-weight:800;letter-spacing:.06em;color:#eaf6ff;margin-bottom:4px;}
.ed-mapcard .ma{font-size:10.5px;opacity:.55;letter-spacing:.06em;}
.ed-mapcard .mdel{position:absolute;top:8px;right:8px;font-size:10px;color:#ff6b6b;opacity:.6;padding:3px 6px;border-radius:4px;}
.ed-mapcard .mdel:hover{opacity:1;background:rgba(255,107,107,0.14);}
.ed-mapcard .mtag{display:inline-block;font-size:8px;letter-spacing:.14em;color:#ffd166;border:1px solid rgba(255,209,102,0.4);border-radius:3px;padding:1px 4px;margin-top:6px;}
.ed-mempty{grid-column:1/-1;text-align:center;opacity:.5;padding:34px 0;font-size:12px;letter-spacing:.14em;text-transform:uppercase;}
.ed-mmsg{font-size:13px;line-height:1.7;opacity:.85;margin-bottom:20px;}
.ed-mbtns{display:flex;gap:10px;justify-content:flex-end;}
.ed-mbtns button{padding:10px 18px;font-size:12px;font-weight:700;letter-spacing:.12em;border-radius:6px;cursor:pointer;border:1px solid rgba(255,255,255,0.14);background:rgba(255,255,255,0.05);color:#dfe7f0;}
.ed-mbtns button.pri{background:#7df9ff;color:#06121a;border-color:#7df9ff;}
.ed-mbtns button.danger{background:#ff6b6b;color:#1a0606;border-color:#ff6b6b;}

/* TOASTS */
.ed-toasts{position:absolute;top:56px;left:50%;transform:translateX(-50%);z-index:80;display:flex;flex-direction:column;gap:8px;align-items:center;pointer-events:none;}
.ed-toast{padding:10px 18px;border-radius:7px;font-size:12.5px;letter-spacing:.06em;background:rgba(12,16,22,0.96);
  border:1px solid rgba(125,249,255,0.35);color:#eaf6ff;box-shadow:0 8px 30px rgba(0,0,0,0.5);animation:ed-tin .2s ease;max-width:70vw;}
.ed-toast.ok{border-color:rgba(81,232,152,0.5);color:#9fffcf;}
.ed-toast.err{border-color:rgba(255,107,107,0.55);color:#ffb3b3;}
.ed-toast.warn{border-color:rgba(255,209,102,0.55);color:#ffe0a0;}
@keyframes ed-tin{from{opacity:0;transform:translateY(-8px);}to{opacity:1;transform:none;}}
`;

function injectCss(id, t) { if (typeof document === 'undefined' || document.getElementById(id)) return; const s = document.createElement('style'); s.id = id; s.textContent = t; document.head.appendChild(s); }
function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

export class EditorUI {
  constructor(editor) {
    this.ed = editor;
    this.activeTab = 'structural';
    injectCss('editor-ui-css', CSS);
    const parent = document.getElementById('ui') || document.body;
    this.root = document.createElement('div');
    // The ROOT is deliberately NOT 'interactive': the global #ui rule makes
    // '.interactive' (and its subtree) pointer-events:auto, so marking the root would
    // swallow play-area clicks (click-to-look would never reach the canvas). Instead
    // each interactive PANEL carries 'interactive' (see _build), so the panels are
    // clickable while the empty root stays passthrough. NB: the panels' own
    // '.ed-pal{pointer-events:auto}' CSS is NOT enough — '#ui *{pointer-events:none}'
    // is an ID selector and outranks a bare class, so the 'interactive' class (also
    // #ui-scoped) is what actually re-enables them.
    this.root.className = 'ed-root';
    parent.appendChild(this.root);
    this._build();
  }

  anyModalOpen() { return this.scrim && this.scrim.classList.contains('on'); }

  _build() {
    this.root.innerHTML = `
      <div class="ed-cross"></div>
      <div class="ed-top interactive">
        <span class="ed-brand">EDITOR</span>
        <input class="ed-name" type="text" maxlength="40" placeholder="Map name" />
        <span class="ed-sep"></span>
        <span class="ed-lbl">Sky</span>
        <select class="ed-sky"></select>
        <span class="ed-sep"></span>
        <button class="ed-btn ed-new warn">NEW</button>
        <button class="ed-btn ed-load">LOAD</button>
        <button class="ed-btn pri ed-save">SAVE</button>
        <span class="ed-sep"></span>
        <button class="ed-btn ed-undo">UNDO</button>
        <button class="ed-btn ed-redo">REDO</button>
        <span class="ed-sep"></span>
        <button class="ed-btn ed-snap on">SNAP</button>
        <span class="ed-lbl">Grid</span>
        <input class="ed-grid-in" type="number" min="0.1" max="8" step="0.1" />
        <span class="ed-sep"></span>
        <span class="ed-mode-pill place">PLACE</span>
        <span class="ed-lights">0 / ${MAX_CUSTOM_LIGHTS}</span>
      </div>
      <div class="ed-pal interactive">
        <div class="ed-tabs"></div>
        <div class="ed-items"></div>
      </div>
      <div class="ed-props interactive"></div>
      <div class="ed-help interactive">
        <span class="ed-hclose">✕</span>
        <b>B</b> / <b>Esc</b> close build menu · <b>WASD</b> fly · <b>Space</b> up · <b>Ctrl/Q</b> down · <b>Shift</b> boost ·
        <b>1–9</b> hotbar · <b>L-Click</b> place · <b>Del</b> delete · <b>TAB</b> place/edit · <b>G</b> snap · <b>[ ]</b> grid ·
        <b>R</b> rotate · <b>Ctrl+D</b> dup · <b>Ctrl+Z/Y</b> undo/redo · <b>Ctrl+S</b> save
      </div>
      <div class="ed-toasts"></div>
      <div class="ed-fphint"><b>Click</b> to look around · <b>WASD</b> fly · <b>B</b> build menu · <b>L-Click</b> place · <b>Del</b> delete · <b>Esc</b> menu</div>
      <div class="ed-hotbar interactive"></div>
      <div class="ed-scrim interactive"><div class="ed-modal"></div></div>`;

    this.topName = this.root.querySelector('.ed-name');
    this.skySel = this.root.querySelector('.ed-sky');
    this.tabsEl = this.root.querySelector('.ed-tabs');
    this.itemsEl = this.root.querySelector('.ed-items');
    this.propsEl = this.root.querySelector('.ed-props');
    this.lightsEl = this.root.querySelector('.ed-lights');
    this.modePill = this.root.querySelector('.ed-mode-pill');
    this.snapBtn = this.root.querySelector('.ed-snap');
    this.gridIn = this.root.querySelector('.ed-grid-in');
    this.undoBtn = this.root.querySelector('.ed-undo');
    this.redoBtn = this.root.querySelector('.ed-redo');
    this.toastsEl = this.root.querySelector('.ed-toasts');
    this.scrim = this.root.querySelector('.ed-scrim');
    this.modal = this.root.querySelector('.ed-modal');
    this.helpEl = this.root.querySelector('.ed-help');
    this.hotbarEl = this.root.querySelector('.ed-hotbar');
    this.hintEl = null;
    this.hotbarEl.addEventListener('click', (e) => {
      const slot = e.target.closest('.ed-hslot'); if (slot) this.ed.selectHotbar(+slot.dataset.i);
    });

    // skybox options
    for (const k of Object.keys(SKYBOX_PRESETS)) {
      const o = document.createElement('option'); o.value = k; o.textContent = SKYBOX_PRESETS[k].name; this.skySel.appendChild(o);
    }

    // bind toolbar
    this.topName.addEventListener('change', () => this.ed.setName(this.topName.value.trim()));
    this.skySel.addEventListener('change', () => this.ed.setSkybox(this.skySel.value));
    this.root.querySelector('.ed-new').addEventListener('click', () => this._confirmNew());
    this.root.querySelector('.ed-load').addEventListener('click', () => this.openLoad());
    this.root.querySelector('.ed-save').addEventListener('click', () => this.doSave());
    this.undoBtn.addEventListener('click', () => this.ed.undo());
    this.redoBtn.addEventListener('click', () => this.ed.redo());
    this.snapBtn.addEventListener('click', () => this.ed.setSnap(!this.ed.snap));
    this.gridIn.addEventListener('change', () => this.ed.setGrid(+this.gridIn.value || 1));
    this.helpEl.querySelector('.ed-hclose').addEventListener('click', () => { this.helpEl.style.display = 'none'; });

    this.scrim.addEventListener('mousedown', (e) => { if (e.target === this.scrim) this.closeModal(); });

    this._buildTabs();
    this._renderItems();
    this.refreshProperties();
  }

  // ---- palette --------------------------------------------------------------
  _buildTabs() {
    this.tabsEl.innerHTML = '';
    for (const c of CATS) {
      const t = document.createElement('div');
      t.className = 'ed-tab' + (c.id === this.activeTab ? ' on' : '');
      t.textContent = c.label;
      t.addEventListener('click', () => { this.activeTab = c.id; this._buildTabs(); this._renderItems(); });
      this.tabsEl.appendChild(t);
    }
  }

  _renderItems() {
    this.itemsEl.innerHTML = '';
    const cat = CATS.find((c) => c.id === this.activeTab);
    let entries = [];
    if (cat.kind === 'block') {
      entries = Object.entries(BLOCK_TYPES).filter(([, d]) => d.cat === this.activeTab).map(([id, d]) => ({ id, label: d.label, color: d.color, emissive: d.emissive, kind: 'block' }));
    } else if (cat.kind === 'light') {
      entries = Object.entries(LIGHT_KINDS).map(([id, d]) => ({ id, label: d.label + ' Light', color: 0xfff2c4, glyph: id === 'spot' ? '▽' : '☀', kind: 'light' }));
    } else {
      entries = Object.entries(OBJECT_KINDS).map(([id, d]) => ({ id, label: d.label, color: d.color, glyph: this._objGlyph(id), kind: 'object' }));
    }
    for (const e of entries) {
      const item = document.createElement('div');
      const on = this.ed.active.kind === e.kind && this.ed.active.id === e.id;
      item.className = 'ed-item' + (on ? ' on' : '');
      const swBg = e.emissive != null ? `background:${hexStr(e.color)};box-shadow:0 0 12px ${hexStr(e.emissive)} inset,0 0 8px ${hexStr(e.emissive)};` : `background:${hexStr(e.color)};`;
      item.innerHTML = `<div class="sw" style="${swBg}">${e.glyph ? `<span style="font-size:20px;color:#0a0e14;text-shadow:0 0 4px rgba(255,255,255,0.6)">${e.glyph}</span>` : ''}</div><div class="nm">${esc(e.label)}</div>`;
      item.addEventListener('click', () => { this.ed.setActive(e.kind, e.id); });
      this.itemsEl.appendChild(item);
    }
  }

  _objGlyph(id) { return { weapon: '✦', health: '✚', armor: '⛨', powerup: '★', spawn: '➤' }[id] || '●'; }

  refreshPalette() { this._renderItems(); }

  // ---- properties -----------------------------------------------------------
  refreshProperties() {
    const ed = this.ed;
    const p = this.propsEl;
    if (!ed.selected) {
      p.innerHTML = `<h3>Properties</h3><div class="ed-psub">nothing selected</div>
        <div class="ed-pempty">TAB into EDIT mode,<br/>then click an object<br/>to edit it here.</div>`;
      return;
    }
    const rec = ed._recOf(ed.selected);
    if (!rec) { p.innerHTML = ''; return; }
    const type = ed.selected.type;
    const title = type === 'block' ? (BLOCK_TYPES[rec.type]?.label || rec.type) : type === 'light' ? (LIGHT_KINDS[rec.kind]?.label + ' Light') : (OBJECT_KINDS[rec.kind]?.label || rec.kind);
    p.innerHTML = `<h3>${esc(title)}</h3><div class="ed-psub">${type}</div>`;

    // Transform group
    this._pgrp(p, 'Transform');
    this._triplet(p, 'Pos', ['x', 'y', 'z'], rec, 0.1);
    if (type === 'block') {
      this._num(p, 'Yaw°', () => +(((rec.ry || 0) * 180 / Math.PI).toFixed(1)), (v) => ed.applyProp('ry', v * Math.PI / 180), 15);
    } else if (type === 'object' && rec.kind === 'spawn') {
      this._num(p, 'Yaw°', () => rec.yaw || 0, (v) => ed.applyProp('yaw', ((v % 360) + 360) % 360), 15);
      this._num(p, 'Team', () => rec.team ?? '', (v) => ed.applyProp('team', v === '' ? undefined : v), 1);
    }

    if (type === 'block') {
      this._pgrp(p, 'Size');
      this._triplet(p, 'Size', ['sx', 'sy', 'sz'], rec, 0.1, 0.1);
      this._pgrp(p, 'Material');
      this._color(p, 'Color', () => rec.color ?? BLOCK_TYPES[rec.type]?.color ?? 0x888888, (v) => ed.applyProp('color', v));
      const def = BLOCK_TYPES[rec.type] || {};
      this._check(p, 'Emissive', () => (rec.emissive != null), (on) => ed.applyProp('emissive', on ? (rec.color ?? def.color ?? 0x18b6d8) : undefined));
      if (def.wallrun || rec.type === 'runwall') this._check(p, 'Wall-run', () => (rec.wallrun ?? def.wallrun ?? false), (on) => ed.applyProp('wallrun', on));
      // dynamic-type tunables: breakables/barrels get Health, hazards get Damage/s
      if (def.destructible || def.barrel) {
        this._pgrp(p, 'Behavior');
        this._num(p, 'Health', () => rec.hp ?? def.hp ?? 100, (v) => ed.applyProp('hp', Math.max(1, v)), 5);
      }
      if (def.hazard) {
        this._pgrp(p, 'Behavior');
        this._num(p, 'Damage/s', () => rec.dps ?? def.dps ?? 30, (v) => ed.applyProp('dps', Math.max(1, v)), 5);
      }
    } else if (type === 'light') {
      this._pgrp(p, 'Light');
      this._select(p, 'Kind', ['point', 'spot'], () => rec.kind, (v) => ed.applyProp('kind', v));
      this._color(p, 'Color', () => rec.color ?? 0xffffff, (v) => ed.applyProp('color', v));
      this._num(p, 'Intensity', () => rec.intensity ?? 2, (v) => ed.applyProp('intensity', Math.max(0, Math.min(6, v))), 0.1);
      this._num(p, 'Distance', () => rec.dist ?? 16, (v) => ed.applyProp('dist', Math.max(3, Math.min(40, v))), 1);
    } else {
      // gameplay object
      this._pgrp(p, rec.kind === 'spawn' ? 'Spawn' : 'Pickup');
      if (rec.kind === 'weapon') {
        // 'random' = a randomized spawner (server rolls a gun from the pool each respawn)
        this._select(p, 'Weapon', ['random', ...SPAWN_WEAPONS], () => rec.weapon || SPAWN_WEAPONS[0], (v) => ed.applyProp('weapon', v));
        this._num(p, 'Respawn ms', () => rec.respawnMs ?? 8000, (v) => ed.applyProp('respawnMs', Math.max(0, v)), 500);
      } else if (rec.kind === 'health' || rec.kind === 'armor') {
        this._num(p, 'Amount', () => rec.amount ?? 50, (v) => ed.applyProp('amount', Math.max(1, v)), 5);
        this._num(p, 'Respawn ms', () => rec.respawnMs ?? 12000, (v) => ed.applyProp('respawnMs', Math.max(0, v)), 500);
      } else if (rec.kind === 'powerup') {
        this._select(p, 'Power-up', Object.keys(POWERUPS), () => rec.powerup || 'speed', (v) => ed.applyProp('powerup', v));
        this._num(p, 'Respawn ms', () => rec.respawnMs ?? 30000, (v) => ed.applyProp('respawnMs', Math.max(0, v)), 500);
      }
    }

    // actions
    const act = document.createElement('div');
    act.className = 'ed-pactions';
    act.innerHTML = `<button class="dup">DUPLICATE</button><button class="del">DELETE</button>`;
    act.querySelector('.dup').addEventListener('click', () => ed.duplicateSelected());
    act.querySelector('.del').addEventListener('click', () => ed.deleteSelected());
    p.appendChild(act);
  }

  _pgrp(parent, title) { const g = document.createElement('div'); g.className = 'ed-pgrp'; g.textContent = title; parent.appendChild(g); }
  _row(parent, label) { const r = document.createElement('div'); r.className = 'ed-prow'; r.innerHTML = `<label>${esc(label)}</label>`; parent.appendChild(r); return r; }
  _num(parent, label, get, set, step = 0.1) {
    const r = this._row(parent, label);
    const i = document.createElement('input'); i.type = 'number'; i.step = step; i.value = get();
    i.addEventListener('change', () => { const v = i.value === '' ? '' : +i.value; set(v); });
    r.appendChild(i); return i;
  }
  _triplet(parent, label, keys, rec, step) {
    const r = this._row(parent, label);
    const wrap = document.createElement('div'); wrap.className = 'ed-triplet';
    for (const k of keys) {
      const i = document.createElement('input'); i.type = 'number'; i.step = step; i.value = +(+(rec[k] ?? 0)).toFixed(3);
      i.title = k;
      i.addEventListener('change', () => this.ed.applyProp(k, +i.value || 0));
      wrap.appendChild(i);
    }
    r.appendChild(wrap);
  }
  _color(parent, label, get, set) {
    const r = this._row(parent, label);
    const i = document.createElement('input'); i.type = 'color'; i.value = hexStr(get());
    i.addEventListener('input', () => set(toHexNum(i.value)));
    r.appendChild(i);
  }
  _check(parent, label, get, set) {
    const r = this._row(parent, label);
    const i = document.createElement('input'); i.type = 'checkbox'; i.checked = !!get();
    i.addEventListener('change', () => set(i.checked));
    r.appendChild(i);
  }
  _select(parent, label, opts, get, set) {
    const r = this._row(parent, label);
    const s = document.createElement('select');
    for (const o of opts) { const op = document.createElement('option'); op.value = o; op.textContent = o; s.appendChild(op); }
    s.value = get();
    s.addEventListener('change', () => set(s.value));
    r.appendChild(s);
  }

  // ---- toolbar state --------------------------------------------------------
  refreshCounts() {
    const n = this.ed.lightCount();
    this.lightsEl.textContent = `${n} / ${MAX_CUSTOM_LIGHTS}`;
    this.lightsEl.classList.toggle('cap', n >= MAX_CUSTOM_LIGHTS);
    // heavy-map warn on block count
    const b = this.ed.blockCount();
    if (b === CUSTOM_LIMITS.warnBlocks + 1) this.toast(`Heavy map: ${b} blocks — may run below target on low-end machines`, 'warn');
  }
  refreshUndo() {
    this.undoBtn.style.opacity = this.ed.canUndo() ? '1' : '0.4';
    this.redoBtn.style.opacity = this.ed.canRedo() ? '1' : '0.4';
  }
  refreshToolbar() {
    this.snapBtn.classList.toggle('on', this.ed.snap);
    this.snapBtn.textContent = this.ed.snap ? 'SNAP' : 'FREE';
    this.gridIn.value = this.ed.gridSize;
    this.skySel.value = this.ed.map.skybox;
    this.topName.value = this.ed.map.name;
  }
  setMode(mode) {
    this.modePill.textContent = mode;
    this.modePill.classList.toggle('place', mode === 'PLACE');
    this.modePill.classList.toggle('edit', mode === 'EDIT');
  }
  // Locked (pointer captured) = first-person BUILD view: hide the panels, show the
  // compact hint + hotbar. Unlocked = the BUILD MENU is open: panels (palette /
  // properties / toolbar) come back so you can pick blocks + edit with a free cursor.
  setLocked(locked) {
    if (this.root) this.root.classList.toggle('ed-locked', !!locked);
  }

  // Render the quick-select hotbar (Minecraft-style) from the editor's slots.
  renderHotbar(slots, activeKey) {
    if (!this.hotbarEl) return;
    this.hotbarEl.innerHTML = (slots || []).map((s, i) => {
      const on = s && activeKey && (s.kind + ':' + s.id) === activeKey;
      const g = s ? (s.kind === 'block' ? '▩' : s.kind === 'light' ? '◉' : this._objGlyph(s.id)) : '';
      const n = s ? esc(s.label || s.id) : '';
      return `<div class="ed-hslot${on ? ' on' : ''}" data-i="${i}"><span class="hk">${i + 1}</span><span class="hg">${g}</span><span class="hn">${n}</span></div>`;
    }).join('');
  }

  refreshAll() {
    this.refreshToolbar();
    this.refreshCounts();
    this.refreshUndo();
    this.refreshProperties();
    this.refreshPalette();
    this.setMode(this.ed.editMode ? 'EDIT' : 'PLACE');
  }

  // ---- SAVE -----------------------------------------------------------------
  async doSave() {
    const name = (this.topName.value || '').trim();
    if (name) this.ed.setName(name);
    const res = await this.ed.save();
    if (!res.ok) {
      this.toast('Save failed: ' + (res.errors || []).join('; '), 'err');
      return;
    }
    let msg = res.offline ? 'Saved locally (offline)' : `Saved · id ${res.id || '?'}`;
    this.toast(msg, 'ok');
    if (res.warnings && res.warnings.length) setTimeout(() => this.toast('⚠ ' + res.warnings.join(' · '), 'warn'), 400);
  }

  // ---- LOAD dialog ----------------------------------------------------------
  async openLoad() {
    this.ed.exitLock();
    this.modal.innerHTML = `
      <div class="ed-mhead"><div class="ed-mtitle">LOAD MAP</div><div class="ed-mx">✕ CLOSE</div></div>
      <div class="ed-mbody"><div class="ed-maplist"><div class="ed-mempty">Loading…</div></div></div>`;
    this.modal.querySelector('.ed-mx').addEventListener('click', () => this.closeModal());
    this.openModal();
    const list = await this.ed.listMaps();
    const grid = this.modal.querySelector('.ed-maplist');
    grid.innerHTML = '';
    if (!list.length) { grid.innerHTML = '<div class="ed-mempty">No saved maps</div>'; return; }
    for (const m of list) {
      const card = document.createElement('div');
      card.className = 'ed-mapcard';
      const date = m.created ? new Date(m.created).toLocaleDateString() : '';
      card.innerHTML = `<div class="mn">${esc(m.name || m.id)}</div><div class="ma">${esc(m.author || 'anon')} · ${date}</div>${m.__local ? '<div class="mtag">LOCAL</div>' : ''}<div class="mdel">DELETE</div>`;
      card.addEventListener('click', async (e) => {
        if (e.target.classList.contains('mdel')) {
          this.confirm('Delete map?', `Permanently delete "${m.name || m.id}"?`, async () => {
            await this.ed.deleteMap(m.id, m.__local);
            this.openLoad(); // refresh
          }, true);
          return;
        }
        const ok = await this.ed.loadMap(m.id, m.__local);
        if (ok) { this.toast('Loaded "' + (m.name || m.id) + '"', 'ok'); this.closeModal(); }
        else this.toast('Load failed', 'err');
      });
      grid.appendChild(card);
    }
  }

  _confirmNew() {
    this.confirm('New map?', 'This clears the current map. Unsaved work will be lost (a draft is auto-saved). Continue?', () => {
      this.ed.newMap();
      this.toast('New map', 'ok');
    });
  }

  // ---- confirm modal --------------------------------------------------------
  confirm(title, message, onYes, danger) {
    this.ed.exitLock();
    this.modal.innerHTML = `
      <div class="ed-mhead"><div class="ed-mtitle">${esc(title)}</div></div>
      <div class="ed-mbody"><div class="ed-mmsg">${esc(message)}</div>
        <div class="ed-mbtns"><button class="cancel">CANCEL</button><button class="${danger ? 'danger' : 'pri'} yes">${danger ? 'DELETE' : 'CONFIRM'}</button></div></div>`;
    this.modal.querySelector('.cancel').addEventListener('click', () => this.closeModal());
    this.modal.querySelector('.yes').addEventListener('click', () => { this.closeModal(); onYes?.(); });
    this.openModal();
  }

  openModal() { this.scrim.classList.add('on'); if (this.hintEl) { this.hintEl.remove(); this.hintEl = null; } }
  closeModal() { this.scrim.classList.remove('on'); this.modal.innerHTML = ''; }

  // ---- toasts ---------------------------------------------------------------
  toast(msg, kind) {
    const t = document.createElement('div');
    t.className = 'ed-toast' + (kind ? ' ' + kind : '');
    t.textContent = msg;
    this.toastsEl.appendChild(t);
    setTimeout(() => { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 320); }, kind === 'err' ? 4200 : 2600);
  }

  resize() { /* fluid CSS — nothing to measure */ }

  dispose() {
    if (this.root?.parentNode) this.root.parentNode.removeChild(this.root);
    this.root = null;
  }
}
