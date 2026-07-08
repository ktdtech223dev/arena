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
    this._look = { dx: 0, dy: 0 };
    this._wheelDelta = 0;
    this._ui = new Set();        // open UI panel ids
    this._rawKey = new Map();    // code -> Set<fn>

    this._buildHint();
    this._bind();
  }

  // ---- public API --------------------------------------------------------

  /** Is this action held right now? Always false while a UI panel is open. */
  down(action) {
    return this._ui.size === 0 && this._down.has(action);
  }

  /** Was this action pressed this frame? (peek — does not consume) */
  pressed(action) {
    return this._ui.size === 0 && this._pressed.has(action);
  }

  /** Was this action pressed this frame? Consumes the edge. */
  consumePressed(action) {
    if (this._ui.size > 0) return false;
    const had = this._pressed.has(action);
    this._pressed.delete(action);
    return had;
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

  _buildHint() {
    const el = document.createElement('div');
    el.id = 'lock-hint';
    el.style.cssText = `
      position:absolute; inset:0; display:flex; flex-direction:column;
      align-items:center; justify-content:center; gap:14px;
      background:rgba(6,8,12,0.72); backdrop-filter: blur(3px);
      color:#dfe7f0; text-align:center; z-index:100; cursor:pointer;
    `;
    el.innerHTML = `
      <div style="font-size:44px; font-weight:800; letter-spacing:0.35em; color:#7df9ff; text-shadow:0 0 24px rgba(125,249,255,0.5);">RANGE</div>
      <div style="font-size:15px; letter-spacing:0.2em; opacity:0.9;">CLICK TO ENTER THE RANGE</div>
      <div style="font-size:12px; opacity:0.6; line-height:1.9; letter-spacing:0.05em;">
        WASD move &nbsp;·&nbsp; SPACE jump &nbsp;·&nbsp; CTRL/C slide &nbsp;·&nbsp; LMB fire &nbsp;·&nbsp; RMB aim &nbsp;·&nbsp; R reload<br>
        1–7 weapons &nbsp;·&nbsp; Q quickswap &nbsp;·&nbsp; TAB weapon wheel &nbsp;·&nbsp; E interact &nbsp;·&nbsp; T inspect<br>
        K crosshair editor &nbsp;·&nbsp; F debug panel &nbsp;·&nbsp; M range menu &nbsp;·&nbsp; ESC release mouse
      </div>
    `;
    el.classList.add('interactive');
    el.addEventListener('click', () => this.lock());
    document.getElementById('ui').appendChild(el);
    this._hint = el;
  }

  _updateHint() {
    this._hint.style.display = (!this.locked && this._ui.size === 0) ? 'flex' : 'none';
  }
}
