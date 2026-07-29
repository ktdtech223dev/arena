// TOWER DEFENSE — TDMode.js: the mode orchestrator (single-player v1).
// BUILD phase (between waves): walk the arena, open the BUILD menu (B), click a
// buildable spot to place units, click a unit to inspect/upgrade its two paths
// (BTD lockout), buy self-upgrades, then START WAVE (G or the button).
// WAVE phase: the horde streams the path — units fight, and YOU fight in first
// person with the full arsenal. Gold from kills + wave clears. The CORE dies →
// game over (restart). Difficulty scales forever; every 10th wave is a QUEEN.
import * as THREE from 'three';
import { UNIT_DEFS, PLAYER_UPGRADES, canUpgrade, composeWave } from './data.js';
import { Unit } from './Units.js';
import { Enemy, EnemyTargets } from './Enemies.js';
import { TDWorld, distToPath, CORE_POS, PATH_W } from './TDWorld.js';

function injectCss(id, t) { if (document.getElementById(id)) return; const s = document.createElement('style'); s.id = id; s.textContent = t; document.head.appendChild(s); }
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

const CSS = `
.td-top{position:absolute;top:10px;left:50%;transform:translateX(-50%);z-index:30;display:flex;gap:16px;align-items:center;
  background:rgba(8,12,18,0.78);border:1px solid rgba(159,232,106,0.3);border-radius:8px;padding:8px 18px;
  font-family:'Segoe UI',system-ui,sans-serif;pointer-events:none;color:#eaf6ff;}
.td-top b{font-size:15px;} .td-top .lb{font-size:9.5px;letter-spacing:.18em;color:#8fa6bb;display:block;}
.td-top .gold b{color:#ffd166;} .td-top .core b{color:#7df9ff;} .td-top .wave b{color:#9fe86a;}
.td-banner{position:absolute;top:26%;left:50%;transform:translate(-50%,-50%);z-index:64;text-align:center;display:none;
  font-family:'Segoe UI',system-ui,sans-serif;pointer-events:none;}
.td-banner .w{font-size:40px;font-weight:900;letter-spacing:.26em;color:#9fe86a;text-shadow:0 0 30px rgba(159,232,106,0.5);}
.td-banner .s{font-size:12px;letter-spacing:.28em;color:#aebccb;margin-top:6px;}
.td-hint{position:absolute;bottom:12vh;left:50%;transform:translateX(-50%);z-index:30;font-size:12px;font-weight:700;
  letter-spacing:.2em;color:#9fe86a;text-shadow:0 1px 6px #000;font-family:'Segoe UI',system-ui,sans-serif;pointer-events:none;}
.td-panel{position:absolute;left:16px;top:70px;bottom:16px;width:300px;z-index:46;display:none;flex-direction:column;
  background:rgba(8,12,18,0.94);border:1px solid rgba(159,232,106,0.35);border-radius:10px;padding:14px;overflow:auto;
  font-family:'Segoe UI',system-ui,sans-serif;color:#eaf6ff;}
.td-panel.on{display:flex;}
.td-panel h3{font-size:12px;font-weight:900;letter-spacing:.22em;color:#9fe86a;margin:4px 0 10px;}
.td-item{display:flex;gap:10px;align-items:center;background:rgba(14,20,28,0.9);border:1px solid rgba(255,255,255,0.08);
  border-radius:8px;padding:9px 12px;margin-bottom:7px;cursor:pointer;font-size:12px;}
.td-item:hover{border-color:rgba(159,232,106,0.6);}
.td-item.sel{border-color:#9fe86a;background:rgba(20,32,20,0.95);}
.td-item .c{margin-left:auto;font-weight:800;color:#ffd166;}
.td-item .r{font-size:9px;letter-spacing:.12em;padding:2px 6px;border-radius:4px;}
.td-item .r.damage{background:rgba(255,138,74,.15);color:#ff8a4a;} .td-item .r.buff{background:rgba(159,232,106,.15);color:#9fe86a;}
.td-item .r.debuff{background:rgba(125,178,255,.15);color:#7db2ff;} .td-item .r.economy{background:rgba(255,209,102,.15);color:#ffd166;}
.td-up{background:rgba(14,20,28,0.92);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:10px;margin-bottom:8px;}
.td-up .nm{font-size:12px;font-weight:800;}
.td-up .tier{font-size:10px;color:#8fa6bb;letter-spacing:.12em;margin:2px 0 6px;}
.td-btn{display:inline-block;font-size:11px;font-weight:800;letter-spacing:.12em;padding:6px 12px;border-radius:6px;cursor:pointer;
  background:rgba(159,232,106,0.14);color:#9fe86a;border:1px solid rgba(159,232,106,0.45);}
.td-btn:hover{background:rgba(159,232,106,0.3);}
.td-btn.no{opacity:.35;pointer-events:none;}
.td-btn.gold{color:#ffd166;border-color:rgba(255,209,102,0.5);background:rgba(255,209,102,0.12);}
.td-start{position:absolute;bottom:16px;left:50%;transform:translateX(-50%);z-index:46;font-family:'Segoe UI',system-ui,sans-serif;
  font-size:14px;font-weight:900;letter-spacing:.3em;color:#04120a;background:#9fe86a;border-radius:8px;padding:12px 34px;cursor:pointer;
  box-shadow:0 0 30px rgba(159,232,106,0.4);}
.td-start:hover{transform:translateX(-50%) scale(1.04);}
.td-over{position:absolute;inset:0;z-index:70;display:none;flex-direction:column;align-items:center;justify-content:center;
  background:rgba(4,6,4,0.88);font-family:'Segoe UI',system-ui,sans-serif;}
.td-over .t{font-size:44px;font-weight:900;letter-spacing:.3em;color:#ff6b6b;}
.td-over .s{font-size:14px;letter-spacing:.2em;color:#aebccb;margin:14px 0 26px;}
`;

const BUILD_MIN_FROM_PATH = PATH_W / 2 + 1.1;  // can't build ON the lane
const BUILD_MAX_FROM_PATH = 14;                // must build NEAR the lane
const UNIT_SPACING = 2.6;

export class TDMode {
  constructor(ctx) {
    this.ctx = ctx;
    this.world = new TDWorld(ctx);
    this.targets = new EnemyTargets(ctx, this);
    this.enemies = [];
    this.units = [];
    this.hasteSources = [];
    this.gold = 420;
    this.wave = 0;
    this.coreHp = 100; this.coreMax = 100;
    this.phase = 'build';        // 'build' | 'wave' | 'over'
    this._spawnQueue = [];
    this._spawnT = 0; this._nextId = 1;
    this.playerDmgMult = 1; this.playerUp = { pdmg: 0, pspeed: 0, phealth: 0 };
    this.selected = null;        // selected placed unit (inspect/upgrade)
    this.placing = null;         // def id being placed
    this._ghost = null;
    this._t = 0;
    this._fx = [];               // pooled beams/tracer lines
    this._buildUi();
    injectCss('td-css', CSS);
    // interactions
    ctx.input.onKeyDown('KeyB', () => this._togglePanel());
    ctx.input.onKeyDown('KeyG', () => { if (this.phase === 'build') this.startWave(); });
    window.addEventListener('mousedown', (e) => this._onClick(e));
    this._banner(`WAVE 1 INBOUND`, 'B = BUILD MENU · PLACE UNITS BY THE LANE · G = START WAVE');
  }

  // ---------------------------------------------------------------- UI -----
  _buildUi() {
    const parent = document.getElementById('ui') || document.body;
    const el = (cls, html) => { const d = document.createElement('div'); d.className = cls; d.innerHTML = html || ''; parent.appendChild(d); return d; };
    this.top = el('td-top', `
      <span class="wave"><span class="lb">WAVE</span><b>1</b></span>
      <span class="core"><span class="lb">CORE</span><b>100</b></span>
      <span class="gold"><span class="lb">GOLD</span><b>0</b></span>
      <span class="left"><span class="lb">HOSTILES</span><b>—</b></span>`);
    this.bannerEl = el('td-banner', `<div class="w"></div><div class="s"></div>`);
    this.hintEl = el('td-hint');
    this.panel = el('td-panel interactive');
    this.startBtn = el('td-start interactive', 'START WAVE  ▶');
    this.startBtn.addEventListener('click', () => this.startWave());
    this.overEl = el('td-over interactive', `<div class="t">CORE DESTROYED</div><div class="s"></div><div class="td-btn" style="font-size:14px;padding:12px 30px">REBUILD & RETRY</div>`);
    this.overEl.querySelector('.td-btn').addEventListener('click', () => location.reload());
    this._renderPanel();
  }

  _togglePanel() {
    const on = !this.panel.classList.contains('on');
    this.panel.classList.toggle('on', on);
    if (on) { this.ctx.input.pushUI('td'); this._renderPanel(); }
    else { this.ctx.input.popUI('td'); this.placing = null; this._clearGhost(); }
  }

  _renderPanel() {
    const p = this.panel;
    if (this.selected) { this._renderUpgradePanel(); return; }
    p.innerHTML = `<h3>BUILD — ${this.gold}g</h3>` + UNIT_DEFS.map((d) => `
      <div class="td-item ${this.placing === d.id ? 'sel' : ''}" data-u="${d.id}">
        <span>${d.icon}</span><span>${esc(d.name)}<br><span class="r ${d.role}">${d.role.toUpperCase()}</span></span>
        <span class="c">${d.cost}g</span>
      </div>`).join('')
      + `<h3 style="margin-top:14px">YOURSELF</h3>` + PLAYER_UPGRADES.map((u) => {
        const t = this.playerUp[u.id];
        const cost = u.cost(t);
        const maxed = t >= u.tiers;
        return `<div class="td-item" data-p="${u.id}"><span>${u.icon}</span><span>${esc(u.name)} ${'▰'.repeat(t)}${'▱'.repeat(u.tiers - t)}<br><span style="font-size:10px;opacity:.6">${u.per}</span></span><span class="c">${maxed ? 'MAX' : cost + 'g'}</span></div>`;
      }).join('');
    p.querySelectorAll('[data-u]').forEach((elm) => elm.addEventListener('click', () => {
      this.placing = this.placing === elm.dataset.u ? null : elm.dataset.u;
      this._renderPanel();
      this.hintEl.textContent = this.placing ? 'CLICK GROUND NEAR THE LANE TO PLACE · ESC/B TO CANCEL' : '';
    }));
    p.querySelectorAll('[data-p]').forEach((elm) => elm.addEventListener('click', () => this._buyPlayerUpgrade(elm.dataset.p)));
  }

  _renderUpgradePanel() {
    const u = this.selected;
    const p = this.panel;
    p.innerHTML = `<h3>${u.def.icon} ${esc(u.def.name)} — ${this.gold}g</h3>
      <div style="font-size:10.5px;letter-spacing:.1em;color:#8fa6bb;margin-bottom:10px">KILLS ${u.kills} · INVESTED ${u.invested}g</div>`
      + u.def.paths.map((path, pi) => {
        const tier = u.tiers[pi];
        const next = path[tier];
        const locked = !canUpgrade(u, pi) && tier < 3;
        return `<div class="td-up">
          <div class="tier">PATH ${pi + 1} · TIER ${tier}/3 ${locked ? '· <span style="color:#ff8a8a">LOCKED</span>' : ''}</div>
          ${path.map((up, i) => `<div class="nm" style="opacity:${i < tier ? 1 : 0.45}">${i < tier ? '✔' : '○'} ${esc(up.name)}</div>`).join('')}
          ${next && !locked ? `<div class="td-btn ${this.gold < next.cost ? 'no' : ''}" data-up="${pi}" style="margin-top:8px">BUY ${esc(next.name)} — ${next.cost}g</div>` : ''}
        </div>`;
      }).join('')
      + `<div style="display:flex;gap:8px;margin-top:6px">
           <div class="td-btn gold" data-sell>SELL +${Math.round(u.invested * 0.7)}g</div>
           <div class="td-btn" data-back>◄ BACK</div>
         </div>`;
    p.querySelectorAll('[data-up]').forEach((elm) => elm.addEventListener('click', () => {
      const r = this.selected.upgrade(+elm.dataset.up);
      if (r.ok) { this.ctx.audio.play('ui_click'); } this._renderUpgradePanel(); this._hud();
    }));
    p.querySelector('[data-sell]').addEventListener('click', () => {
      this.gold += Math.round(u.invested * 0.7);
      this.ctx.scene.remove(u.model.group);
      this.units = this.units.filter((x) => x !== u);
      this.selected = null; this._renderPanel(); this._hud();
    });
    p.querySelector('[data-back]').addEventListener('click', () => { this.selected = null; this._renderPanel(); });
  }

  _buyPlayerUpgrade(id) {
    const def = PLAYER_UPGRADES.find((u) => u.id === id);
    const t = this.playerUp[id];
    if (t >= def.tiers) return;
    const cost = def.cost(t);
    if (this.gold < cost) return;
    this.gold -= cost; this.playerUp[id]++;
    if (id === 'pdmg') this.playerDmgMult = 1 + this.playerUp.pdmg * def.mult;
    if (id === 'pspeed') { const c = this.ctx.player?.controller; if (c?.params) c.params.speedScale = (c.params.speedScale || 1) + def.mult; }
    if (id === 'phealth') { /* HUD hp is cosmetic in TD v1 — future: wire controller hp */ }
    this.ctx.audio.play('ui_click');
    this._renderPanel(); this._hud();
  }

  // ------------------------------------------------------------ placement --
  _onClick(e) {
    if (e.button !== 0 || this.phase === 'over') return;
    // clicking through UI panels? ignore
    if (e.target !== this.ctx.canvas) return;
    if (this.placing) { this._tryPlace(); return; }
    // clicking a unit selects it (build phase, panel open)
    if (this.panel.classList.contains('on')) {
      const hitUnit = this._unitUnderCrosshair();
      if (hitUnit) { this.selected = hitUnit; this._renderUpgradePanel(); }
    }
  }

  _aimPoint() {
    const cam = this.ctx.camera;
    const origin = cam.getWorldPosition(new THREE.Vector3());
    const dir = cam.getWorldDirection(new THREE.Vector3());
    if (dir.y > -0.05) return null;
    const t = -origin.y / dir.y; // intersect y=0 ground plane
    if (t < 0 || t > 60) return null;
    return origin.add(dir.multiplyScalar(t));
  }

  _placementValid(p) {
    if (!p) return false;
    const d = distToPath(p.x, p.z);
    if (d < BUILD_MIN_FROM_PATH || d > BUILD_MAX_FROM_PATH) return false;
    if (Math.hypot(p.x - CORE_POS.x, p.z - CORE_POS.z) < 6) return false;
    for (const u of this.units) if (u.pos.distanceTo(p) < UNIT_SPACING) return false;
    return true;
  }

  _tryPlace() {
    const def = UNIT_DEFS.find((d) => d.id === this.placing);
    if (!def || this.gold < def.cost) { this.hintEl.textContent = 'NOT ENOUGH GOLD'; return; }
    const p = this._aimPoint();
    if (!this._placementValid(p)) { this.hintEl.textContent = 'INVALID SPOT — BUILD BESIDE THE LANE'; return; }
    this.gold -= def.cost;
    this.units.push(new Unit(def, p, this));
    this.ctx.audio.play('ui_click');
    this._hud(); this._renderPanel();
  }

  _unitUnderCrosshair() {
    const p = this._aimPoint();
    if (!p) return null;
    let best = null, bd = 2.2;
    for (const u of this.units) { const d = u.pos.distanceTo(p); if (d < bd) { bd = d; best = u; } }
    return best;
  }

  // ------------------------------------------------------------ waves ------
  startWave() {
    if (this.phase !== 'build') return;
    this.wave++;
    this.phase = 'wave';
    this.startBtn.style.display = 'none';
    const comp = composeWave(this.wave);
    this._waveComp = comp;
    this._spawnQueue = [];
    for (const m of comp.mix) for (let i = 0; i < m.count; i++) this._spawnQueue.push({ id: m.id, at: this._spawnQueue.length ? undefined : 0, gapS: m.gapS });
    this._spawnT = 0.5;
    this._banner(`WAVE ${this.wave}`, this.wave % 10 === 0 ? '⚠ THE QUEEN COMES' : `${this._spawnQueue.length} HOSTILES`);
    this.ctx.audio.play('ui_open');
  }

  spawnEnemy(defId, atDist = 0) {
    const e = new Enemy(this._nextId++, defId, this._waveComp?.hpMult || 1, this.ctx.scene);
    e.dist = atDist;
    this.enemies.push(e);
    if (e.def.hasteAura) this.hasteSources.push(e);
    return e;
  }

  leak(e) {
    if (!e.alive) return;
    e.alive = false;
    this.coreHp -= e.def.coreDmg;
    this.fxBoom(new THREE.Vector3(CORE_POS.x, 3, CORE_POS.z), 3, 0xff6b6b);
    this.ctx.audio.play('land_hard', { volume: 0.9, rate: 0.6 });
    if (this.coreHp <= 0) this._gameOver();
  }

  onEnemyKilled(e, opts) {
    // bounty (beacons multiply near the kill)
    let mult = 1;
    for (const u of this.units) if (u.stats.goldMult && u.pos.distanceTo(e.pos) < u.stats.range) mult = Math.max(mult, u.stats.goldMult);
    const gold = Math.round(e.def.bounty * mult);
    this.gold += gold;
    if (e.def.boomOnDeath) { this.fxBoom(e.pos.clone(), e.def.boomOnDeath, 0x9fe86a); for (const o of this.targetsNear(e.pos, e.def.boomOnDeath)) if (o !== e) o.applyDamage(30, {}, this); }
    this._hud();
  }
  creditKill() { /* unit kill bookkeeping happens on the unit; gold via onEnemyKilled */ }

  _gameOver() {
    this.phase = 'over';
    this.overEl.style.display = 'flex';
    this.overEl.querySelector('.s').textContent = `THE LINE BROKE ON WAVE ${this.wave}`;
    try { document.exitPointerLock?.(); } catch { /* fine */ }
  }

  _endWave() {
    this.phase = 'build';
    const bonus = this._waveComp.bonus;
    // bounty beacon interest
    let interest = 0;
    for (const u of this.units) if (u.stats.interest) interest = Math.max(interest, u.stats.interest);
    const intGold = Math.round(this.gold * interest);
    this.gold += bonus + intGold;
    for (const u of this.units) if (u.stats.waveBonus) this.gold += u.stats.waveBonus;
    this.startBtn.style.display = 'block';
    this._banner(`WAVE ${this.wave} CLEARED`, `+${bonus}g${intGold ? ` · INTEREST +${intGold}g` : ''} · BUILD, UPGRADE, THEN START WAVE ${this.wave + 1}`);
    this.ctx.audio.play('kill');
    this._hud();
  }

  // --------------------------------------------------------- aura queries --
  buffAt(pos, self) {
    let dmg = 1, rate = 1;
    for (const u of this.units) {
      if (u === self) continue;
      const s = u.stats;
      if (!s.aura || u.pos.distanceTo(pos) > s.range) continue;
      if (s.buffDmg) dmg = Math.max(dmg, s.buffDmg);
      if (s.buffRate) rate = Math.max(rate, s.buffRate);
      if (s.surgeMult) { u._surgeT = (u._surgeT || 0); if ((this._t % (s.surgeEvery || 10)) < (s.surgeS || 3)) rate = Math.max(rate, s.surgeMult); }
      if (s.auraCrit && s.critChance && self && !self.stats.critChance) { self.stats.critChance = s.critChance; self.stats.critMult = s.critMult || 1.8; }
    }
    return { dmg, rate };
  }

  targetsNear(pos, r) {
    const out = [];
    for (const e of this.enemies) if (e.alive && e.pos.distanceTo(pos) <= r) out.push(e);
    return out;
  }

  playerPos() {
    const c = this.ctx.player?.controller;
    return c?.position || (this.ctx.camera ? this.ctx.camera.getWorldPosition(new THREE.Vector3()) : null);
  }
  resupplyPlayer(dt) {
    this._resupplyT = (this._resupplyT || 0) + dt;
    if (this._resupplyT > 3) { this._resupplyT = 0; this.ctx.weapons?.resupply?.(); }
  }
  healCore(n) { this.coreHp = Math.min(this.coreMax + this._coreShieldBonus(), this.coreHp + n); }
  _coreShieldBonus() { let b = 0; for (const u of this.units) if (u.stats.coreShield) b = Math.max(b, u.stats.coreShield); return b; }

  // player damage boost aura (ammo depot path B)
  _playerAuraTick() {
    let mult = 1 + (this.playerUp.pdmg * 0.15);
    const pp = this.playerPos();
    if (pp) for (const u of this.units) if (u.stats.playerDmgMult && u.pos.distanceTo(pp) < u.stats.range) mult *= u.stats.playerDmgMult;
    this.playerDmgMult = mult;
  }

  // ------------------------------------------------------------- fx --------
  fxShot(from, to, color) { this.ctx.events.emit('shot:tracer', { from, to, def: { tracer: { color, width: 0.03 } } }); }
  fxBeam(from, to, color) { this.ctx.events.emit('shot:tracer', { from, to, def: { tracer: { color, width: 0.05 } } }); }
  fxBoom(pos, r, color) { this.ctx.fx?.particles?.burst?.({ position: pos, count: Math.round(10 + r * 4), color, speed: 4 + r, spread: 1, life: 0.5, size: 0.2, gravity: 3 }); }

  // ------------------------------------------------------------ sim tick ---
  fixedUpdate(dt) {
    if (this.phase === 'over') return;
    this._t += dt;
    const now = this._t;
    this.world.update(dt, now);

    // spawn queue
    if (this.phase === 'wave' && this._spawnQueue.length) {
      this._spawnT -= dt;
      if (this._spawnT <= 0) {
        const s = this._spawnQueue.shift();
        this.spawnEnemy(s.id);
        this._spawnT = s.gapS * (0.7 + Math.random() * 0.6);
      }
    }

    // enemies
    for (const e of this.enemies) e.step(dt, now, this);
    // clean dead
    for (const e of this.enemies) {
      if (!e.alive && !e._cleaned) {
        e._cleaned = true;
        this.fxBoom(e.pos.clone().add(new THREE.Vector3(0, 1, 0)), 1.4, e.def.family === 'zombie' ? 0x9fe86a : 0xc96af0);
        e.dispose(this.ctx.scene);
      }
    }
    const before = this.enemies.length;
    this.enemies = this.enemies.filter((e) => e.alive);
    this.hasteSources = this.hasteSources.filter((e) => e.alive);

    // units
    this._playerAuraTick();
    for (const u of this.units) u.fixedUpdate(dt, now);

    // wave end?
    if (this.phase === 'wave' && !this._spawnQueue.length && this.enemies.length === 0) this._endWave();
    if (before !== this.enemies.length || (this._hudT = (this._hudT || 0) + dt) > 0.5) { this._hudT = 0; this._hud(); }
  }

  _hud() {
    if (!this.top) return;
    this.top.querySelector('.wave b').textContent = Math.max(1, this.wave + (this.phase === 'build' ? 1 : 0));
    this.top.querySelector('.core b').textContent = Math.max(0, Math.round(this.coreHp));
    this.top.querySelector('.gold b').textContent = Math.round(this.gold);
    this.top.querySelector('.left b').textContent = this.phase === 'wave' ? (this.enemies.length + this._spawnQueue.length) : '—';
  }

  _banner(w, s) {
    this.bannerEl.querySelector('.w').textContent = w;
    this.bannerEl.querySelector('.s').textContent = s;
    this.bannerEl.style.display = 'block';
    clearTimeout(this._bt);
    this._bt = setTimeout(() => { this.bannerEl.style.display = 'none'; }, 3400);
  }

  _clearGhost() { /* ghost visuals v2 — placement uses the aim point + validity hint */ }
}
