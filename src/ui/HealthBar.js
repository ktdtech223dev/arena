// ARENA client — ui/HealthBar.js
// The local player's health, driven by the authoritative snapshot HP. A big
// bottom-center bar + number so you can read exactly how much health you have.
// Colour shifts green → amber → red; pulses when low; empties on death.
// Pure DOM/CSS, non-interactive, framerate-independent (smoothed in update).

const CSS = `
.hb-root{position:absolute;left:50%;bottom:34px;transform:translateX(-50%);
  width:380px;pointer-events:none;z-index:30;
  font-family:'Segoe UI',system-ui,-apple-system,sans-serif;
  filter:drop-shadow(0 3px 10px rgba(0,0,0,0.6));}
.hb-track{position:relative;height:22px;border-radius:4px;overflow:hidden;
  background:rgba(8,11,16,0.78);border:1px solid rgba(255,255,255,0.14);}
.hb-fill{position:absolute;left:0;top:0;bottom:0;width:100%;
  transition:background-color .2s linear;border-radius:3px 0 0 3px;}
.hb-fill.hb-low{animation:hb-pulse .6s ease-in-out infinite;}
@keyframes hb-pulse{0%,100%{opacity:1;}50%{opacity:0.55;}}
.hb-txt{position:absolute;left:0;right:0;top:0;bottom:0;display:flex;
  align-items:center;justify-content:center;gap:6px;
  font-size:14px;font-weight:800;letter-spacing:.08em;color:#eaf2fb;
  text-shadow:0 1px 3px rgba(0,0,0,0.95);}
.hb-heart{color:#ff5f6d;font-size:13px;}
.hb-dead .hb-txt{color:#ff6b6b;}
/* ARMOR — a thinner cyan bar sitting just above the health bar. Hidden at 0. */
.hb-armor{position:relative;height:9px;margin-bottom:4px;border-radius:3px;overflow:hidden;
  background:rgba(8,11,16,0.7);border:1px solid rgba(125,249,255,0.22);display:none;}
.hb-armor.hb-on{display:block;}
.hb-armor-fill{position:absolute;left:0;top:0;bottom:0;width:0%;
  background:linear-gradient(90deg,#5ad8ff,#7df9ff);box-shadow:0 0 8px rgba(125,249,255,.5);
  transition:width .12s linear;}
.hb-armor-txt{position:absolute;right:6px;top:50%;transform:translateY(-50%);
  font-size:9px;font-weight:800;letter-spacing:.12em;color:#cdeffb;
  text-shadow:0 1px 2px rgba(0,0,0,.9);}
/* POWER-UP — a badge + shrinking timer bar above the whole stack. */
.hb-pow{position:relative;margin-bottom:6px;padding:5px 10px 6px;border-radius:4px;
  background:rgba(12,8,20,0.82);border:1px solid rgba(177,91,255,0.4);display:none;
  box-shadow:0 0 14px rgba(177,91,255,.28);}
.hb-pow.hb-on{display:block;}
.hb-pow-name{font-size:11px;font-weight:800;letter-spacing:.2em;text-transform:uppercase;
  color:#e6c6ff;text-align:center;text-shadow:0 0 8px rgba(177,91,255,.6);}
.hb-pow-track{margin-top:4px;height:3px;border-radius:2px;background:rgba(177,91,255,.18);overflow:hidden;}
.hb-pow-fill{height:100%;width:100%;background:#c98bff;box-shadow:0 0 8px rgba(201,139,255,.8);}
`;

function injectCss(id, text) {
  if (typeof document === 'undefined' || document.getElementById(id)) return;
  const s = document.createElement('style'); s.id = id; s.textContent = text; document.head.appendChild(s);
}

export class HealthBar {
  constructor(ctx) {
    this.ctx = ctx;
    this.hp = 100; this.max = 100; this._shown = 100; this.alive = true;
    this.armor = 0; this.armorMax = 100; this._shownArmor = 0;
    this.powName = null; this.powMs = 0; this.powTotal = 0;
    if (typeof document === 'undefined') return;
    injectCss('health-bar-css', CSS);
    const parent = document.getElementById('ui') || document.body;
    this.root = document.createElement('div'); this.root.className = 'hb-root';
    this.root.innerHTML =
      `<div class="hb-pow"><div class="hb-pow-name"></div><div class="hb-pow-track"><div class="hb-pow-fill"></div></div></div>` +
      `<div class="hb-armor"><div class="hb-armor-fill"></div><div class="hb-armor-txt"></div></div>` +
      `<div class="hb-track"><div class="hb-fill"></div><div class="hb-txt"><span class="hb-heart">♥</span><span class="hb-num">100</span></div></div>`;
    parent.appendChild(this.root);
    this.fill = this.root.querySelector('.hb-fill');
    this.num = this.root.querySelector('.hb-num');
    this.armorEl = this.root.querySelector('.hb-armor');
    this.armorFill = this.root.querySelector('.hb-armor-fill');
    this.armorTxt = this.root.querySelector('.hb-armor-txt');
    this.powEl = this.root.querySelector('.hb-pow');
    this.powNameEl = this.root.querySelector('.hb-pow-name');
    this.powFill = this.root.querySelector('.hb-pow-fill');
  }

  set(hp, alive = true, max = 100) {
    this.hp = Math.max(0, Math.min(max, hp ?? 0)); this.max = max; this.alive = alive;
  }

  // Armor / shield value (0 hides the bar). `max` sizes the bar (default 100).
  setArmor(armor, max = 100) {
    this.armor = Math.max(0, armor ?? 0);
    this.armorMax = max > 0 ? max : 100;
  }

  // Active power-up: name (string|null clears) + remaining ms (+ its full duration
  // so the timer bar can shrink from full). Missing total → treat remaining as full.
  setPowerup(name, remainingMs, totalMs) {
    this.powName = name || null;
    this.powMs = Math.max(0, remainingMs ?? 0);
    // keep the largest total we've seen for this powerup so the bar shrinks smoothly
    if (!name) { this.powTotal = 0; }
    else if (totalMs && totalMs > 0) this.powTotal = totalMs;
    else this.powTotal = Math.max(this.powTotal, this.powMs);
  }

  update(dt) {
    if (!this.root) return;
    // smooth the displayed value toward the true HP
    const k = 1 - Math.exp(-14 * (dt > 0 ? dt : 0));
    this._shown += (this.hp - this._shown) * k;
    const frac = this.max > 0 ? this._shown / this.max : 0;
    this.fill.style.width = (frac * 100).toFixed(1) + '%';
    // colour by health fraction
    const trueFrac = this.hp / this.max;
    let col;
    if (trueFrac > 0.6) col = '#51e898';
    else if (trueFrac > 0.3) col = '#ffd166';
    else col = '#ff5b5b';
    this.fill.style.backgroundColor = col;
    this.fill.classList.toggle('hb-low', this.alive && trueFrac <= 0.3 && trueFrac > 0);
    this.num.textContent = this.alive ? String(Math.ceil(this.hp)) : 'DOWN';
    this.root.classList.toggle('hb-dead', !this.alive);

    // ARMOR bar — shown only when the player has armor/shield, smoothed like HP.
    if (this.armorEl) {
      const on = this.armor > 0.5 && this.alive;
      this.armorEl.classList.toggle('hb-on', on);
      if (on) {
        this._shownArmor += (this.armor - this._shownArmor) * k;
        const af = Math.max(0, Math.min(1, this._shownArmor / this.armorMax));
        this.armorFill.style.width = (af * 100).toFixed(1) + '%';
        this.armorTxt.textContent = Math.ceil(this.armor);
      } else {
        this._shownArmor = 0;
      }
    }

    // POWER-UP indicator — name + a shrinking timer bar. Durationless buffs
    // (e.g. overshield) show the name with a full bar (powTotal 0 → treat full).
    if (this.powEl) {
      const on = !!this.powName && this.alive;
      this.powEl.classList.toggle('hb-on', on);
      if (on) {
        this.powNameEl.textContent = this.powName;
        const frac = this.powTotal > 0 ? Math.max(0, Math.min(1, this.powMs / this.powTotal)) : 1;
        this.powFill.style.width = (frac * 100).toFixed(1) + '%';
      }
    }
  }

  resize() {}
  dispose() { if (this.root?.parentNode) this.root.parentNode.removeChild(this.root); this.root = null; }
}
