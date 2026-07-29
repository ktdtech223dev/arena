// Keyboard/mouse input + Pointer Lock management.
// Gameplay code reads ABSTRACT ACTIONS (see KEY_ACTIONS/MOUSE_ACTIONS below),
// never raw key codes. UI toggles (K/F/M/etc.) use input.onKeyDown(code, fn),
// which fires even while a UI panel is open.
//
// While any UI panel is open (input.pushUI(id) / input.popUI(id)) pointer lock
// is released and all gameplay actions read false.

const KEY_ACTIONS = {
  KeyW: 'forward', ArrowUp: 'forward',
  KeyS: 'back', ArrowDown: 'back',
  KeyA: 'left',
  KeyD: 'right',
  Space: 'jump',
  ControlLeft: 'crouch', ControlRight: 'crouch', KeyC: 'crouch',
  ShiftLeft: 'sprint', ShiftRight: 'sprint',
  KeyR: 'reload',
  KeyQ: 'quickswap',
  KeyE: 'interact',
  KeyT: 'inspect',
  Digit1: 'slot1', Digit2: 'slot2', Digit3: 'slot3', Digit4: 'slot4', Digit5: 'slot5',
  Digit6: 'slot6', Digit7: 'slot7', Digit8: 'slot8', Digit9: 'slot9',
  KeyV: 'melee',
  Tab: 'wheel',
};

const MOUSE_ACTIONS = { 0: 'fire', 2: 'ads' };

const PREVENT_DEFAULT = new Set(['Tab', 'Space', 'ControlLeft', 'ControlRight']);

function isTyping(e) {
  const t = e.target;
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}

export class Input {
  constructor(ctx) {
    this.ctx = ctx;
    this.canvas = ctx.canvas;
    this.locked = false;

    this._down = new Set();      // actions currently held
    this._pressed = new Set();   // actions pressed this frame (cleared in endFrame)
    this._released = new Set();  // actions released this frame
    this._suppressed = false;    // when true, gameplay actions read false (e.g. dead / killcam) — pointer lock is untouched
    this._look = { dx: 0, dy: 0 };
    this._wheelDelta = 0;
    this._ui = new Set();        // open UI panel ids
    this._rawKey = new Map();    // code -> Set<fn>

    this._buildHint();
    this._bind();
  }

  // ---- public API --------------------------------------------------------

  /** Is this action held right now? Always false while a UI panel is open or suppressed. */
  down(action) {
    return this._ui.size === 0 && !this._suppressed && this._down.has(action);
  }

  /** Was this action pressed this frame? (peek — does not consume) */
  pressed(action) {
    return this._ui.size === 0 && !this._suppressed && this._pressed.has(action);
  }

  /** Was this action pressed this frame? Consumes the edge. */
  consumePressed(action) {
    if (this._ui.size > 0 || this._suppressed) return false;
    const had = this._pressed.has(action);
    this._pressed.delete(action);
    return had;
  }

  /** Freeze/unfreeze gameplay actions (fire/melee/move/etc.) WITHOUT releasing
   *  pointer lock — used while the local player is dead / in the killcam so a held
   *  or spammed trigger can't keep the gun shooting. Clears buffered edges. */
  setSuppressed(v) {
    this._suppressed = !!v;
    if (v) this._pressed.clear();
  }

  released(action) {
    return this._released.has(action);
  }

  /** Accumulated raw mouse counts since last call. Camera applies sensitivity. */
  consumeLook() {
    const out = { dx: this._look.dx, dy: this._look.dy };
    this._look.dx = 0;
    this._look.dy = 0;
    return out;
  }

  /** Accumulated wheel notches (+down/-up) since last call. */
  consumeWheel() {
    const w = this._wheelDelta;
    this._wheelDelta = 0;
    return w;
  }

  /** Raw key hook for UI toggles. Fires on keydown even while UI is open. */
  onKeyDown(code, fn) {
    let set = this._rawKey.get(code);
    if (!set) this._rawKey.set(code, (set = new Set()));
    set.add(fn);
    return () => set.delete(fn);
  }

  get uiOpen() {
    return this._ui.size > 0;
  }

  uiIsOpen(id) {
    return this._ui.has(id);
  }

  pushUI(id) {
    this._ui.add(id);
    this._down.clear();
    this._pressed.clear();
    if (this.locked) document.exitPointerLock();
    this._updateHint();
  }

  popUI(id) {
    this._ui.delete(id);
    if (this._ui.size === 0) this.lock(); // close click counts as a user gesture
    this._updateHint();
  }

  lock() {
    if (this.locked || this._ui.size > 0) return;
    try {
      const p = this.canvas.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch(() => this.canvas.requestPointerLock());
    } catch {
      this.canvas.requestPointerLock();
    }
  }

  /** Called by main.js once per rendered frame, after all updates. */
  endFrame() {
    this._pressed.clear();
    this._released.clear();
  }

  // ---- internals ---------------------------------------------------------

  _bind() {
    window.addEventListener('keydown', (e) => {
      if (isTyping(e)) return;
      if (PREVENT_DEFAULT.has(e.code) || e.code.startsWith('Digit')) e.preventDefault();

      const raw = this._rawKey.get(e.code);
      if (raw && !e.repeat) for (const fn of [...raw]) fn(e);

      const action = KEY_ACTIONS[e.code];
      if (!action) return;
      if (!e.repeat) {
        if (!this._down.has(action)) this._pressed.add(action);
        this._down.add(action);
      }
    });

    window.addEventListener('keyup', (e) => {
      const action = KEY_ACTIONS[e.code];
      if (!action) return;
      this._down.delete(action);
      this._released.add(action);
    });

    window.addEventListener('blur', () => {
      this._down.clear();
      this._look.dx = 0;
      this._look.dy = 0;
    });

    this.canvas.addEventListener('mousedown', (e) => {
      if (!this.locked) {
        if (this._ui.size === 0) this.lock();
        return;
      }
      const action = MOUSE_ACTIONS[e.button];
      if (!action) return;
      if (!this._down.has(action)) this._pressed.add(action);
      this._down.add(action);
    });

    window.addEventListener('mouseup', (e) => {
      const action = MOUSE_ACTIONS[e.button];
      if (!action) return;
      this._down.delete(action);
      this._released.add(action);
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this._look.dx += e.movementX;
      this._look.dy += e.movementY;
    });

    window.addEventListener('wheel', (e) => {
      if (!this.locked) return;
      this._wheelDelta += Math.sign(e.deltaY);
    }, { passive: true });

    window.addEventListener('contextmenu', (e) => e.preventDefault());

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) {
        this._down.clear();
        this._look.dx = 0;
        this._look.dy = 0;
      }
      this._updateHint();
    });

    document.addEventListener('pointerlockerror', () => {
      this.locked = false;
      this._updateHint();
    });
  }

  // MW2019-style pause: option bars stacked on the LEFT, the live scene blurred
  // and gently parallaxing behind. Esc unlocks → this appears; click resumes.
  _buildHint() {
    if (!document.getElementById('pause-css')) {
      const s = document.createElement('style');
      s.id = 'pause-css';
      s.textContent = `
        #lock-hint .ph-item{font-size:15px;font-weight:800;letter-spacing:.26em;color:#c9d6e2;padding:15px 22px;margin:5px 0;
          background:rgba(255,255,255,0.05);border-left:3px solid transparent;cursor:pointer;transition:all .13s ease;user-select:none;}
        #lock-hint .ph-item:hover{background:rgba(125,249,255,0.13);border-left-color:#7df9ff;color:#fff;transform:translateX(9px);}
        #lock-hint .ph-item.red:hover{background:rgba(255,107,107,0.12);border-left-color:#ff6b6b;}
        @media (max-width:1100px){ #ph-controls{display:none} }`;
      document.head.appendChild(s);
    }
    const el = document.createElement('div');
    el.id = 'lock-hint';
    el.style.cssText = `
      position:absolute; inset:0; display:flex; z-index:100; cursor:pointer;
      background:linear-gradient(90deg, rgba(3,6,10,0.94) 0%, rgba(3,6,10,0.84) 30%, rgba(3,6,10,0.38) 62%, rgba(3,6,10,0.14) 100%);
      font-family:'Segoe UI',system-ui,sans-serif; color:#dfe7f0;
    `;
    const { title, keys } = this._hintText();
    el.innerHTML = `
      <div style="width:min(430px,46vw); display:flex; flex-direction:column; justify-content:center; padding-left:54px;">
        <div style="font-size:12px; letter-spacing:.5em; color:#7df9ff; opacity:.9; margin-bottom:7px;">PAUSED</div>
        <div id="ph-title" style="font-size:40px; font-weight:900; letter-spacing:.16em; color:#eef7ff; text-shadow:0 0 30px rgba(125,249,255,0.35); margin-bottom:8px;">${title}</div>
        <div style="height:2px; width:86px; background:#7df9ff; box-shadow:0 0 12px rgba(125,249,255,0.8); margin-bottom:32px;"></div>
        <div class="ph-item" data-act="resume">RESUME</div>
        <div class="ph-item" data-act="controls">CONTROLS</div>
        <div class="ph-item red" data-act="menu">MAIN MENU</div>
        <div style="margin-top:36px; font-size:10.5px; letter-spacing:.24em; color:#6b7a89;">CLICK ANYWHERE TO RESUME</div>
      </div>
      <div id="ph-controls" style="margin:auto 64px auto auto; max-width:440px; background:rgba(4,8,14,0.6);
        border:1px solid rgba(125,249,255,0.18); border-radius:10px; padding:20px 28px;
        font-size:11.5px; line-height:2.1; letter-spacing:.06em; color:#aebccb;">
        <div style="font-size:10px; font-weight:800; letter-spacing:.32em; color:#7df9ff; margin-bottom:8px;">CONTROLS</div>
        <span id="ph-keys">${keys}</span>
      </div>
    `;
    el.classList.add('interactive');
    el.addEventListener('click', () => this.lock());
    el.querySelectorAll('.ph-item').forEach((it) => it.addEventListener('click', (e) => {
      e.stopPropagation();
      const act = it.dataset.act;
      if (act === 'resume') this.lock();
      else if (act === 'controls') { const c = el.querySelector('#ph-controls'); c.style.display = c.style.display === 'none' ? 'block' : 'none'; }
      else if (act === 'menu') location.href = location.pathname; // strip ?mode → the main menu
    }));
    // parallax: the paused scene drifts opposite the cursor behind the menu
    el.addEventListener('mousemove', (e) => {
      if (!this.canvas) return;
      const nx = e.clientX / window.innerWidth - 0.5, ny = e.clientY / window.innerHeight - 0.5;
      this.canvas.style.transform = `scale(1.06) translate(${(-nx * 16).toFixed(1)}px, ${(-ny * 10).toFixed(1)}px)`;
    });
    document.getElementById('ui').appendChild(el);
    this._hint = el;
  }

  // title + control lines follow the LIVE state (TD is a lobby mode that starts
  // after boot, so the pause screen re-reads this every time it shows)
  _hintText() {
    const td = !!this.ctx?.tdActive;
    const mode = this.ctx?.mode;
    const title = td ? 'TOWER DEFENSE' : mode === 'arena' ? 'ARENA' : 'RANGE';
    const keys = [
      'WASD move · SPACE jump · CTRL/C slide · LMB fire · RMB aim · R reload',
      '1–7 weapons · Q quickswap · TAB weapon wheel · E interact · T inspect',
      td ? 'B build · E armory / tower tree · G start wave · X fire ultimate'
         : 'K crosshair editor · F debug panel · M range menu',
      'ESC release mouse',
    ].join('<br>');
    return { title, keys };
  }

  _updateHint() {
    const show = !this.locked && this._ui.size === 0;
    this._hint.style.display = show ? 'flex' : 'none';
    if (show) {
      const { title, keys } = this._hintText();
      const t = this._hint.querySelector('#ph-title'), k = this._hint.querySelector('#ph-keys');
      if (t && t.textContent !== title) t.textContent = title;
      if (k) k.innerHTML = keys;
    }
    // blur + drift the live scene behind the pause menu; restore crisp on resume
    if (this.canvas) {
      if (!this._canvasFxWired) { this._canvasFxWired = true; this.canvas.style.transition = 'transform .3s ease-out, filter .25s ease'; }
      this.canvas.style.filter = show ? 'blur(5px) brightness(0.72) saturate(1.1)' : '';
      if (!show) this.canvas.style.transform = '';
      else if (!this.canvas.style.transform) this.canvas.style.transform = 'scale(1.06)';
    }
  }
}
