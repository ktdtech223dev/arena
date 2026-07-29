// TOWER DEFENSE — TdUi.js: the co-op TD interface.
// HUD strip (shared gold · wave · core · hostiles), wave banners, the BUILD
// panel (B: towers + self-upgrades + START WAVE), click-to-place on the ground,
// and the E-INTERACT layer: walk up to a TOWER → E opens its upgrade tree
// (BTD lockout, sell); walk up to the ARMORY pad → E opens the weapon shop
// (buy guns — max 2 — and each gun's own upgrade tree). All commands go to the
// server; td_ack answers surface as toasts.
import * as THREE from 'three';
import {
  UNIT_DEFS, UNIT_BY_ID, canUpgrade, TD_SHOP, TD_MAX_GUNS, WEAPON_TREES,
  PLAYER_UPGRADES, TD_ARMORY, TD_SELL_FRAC, tdDistToPath, ABILITIES, DELTA_KEYS,
} from '../../shared/tddata.js';
import { drawGlyph } from '../ui/WeaponWheel.js';

function injectCss(id, t) { if (document.getElementById(id)) return; const s = document.createElement('style'); s.id = id; s.textContent = t; document.head.appendChild(s); }
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---- tooltip text: turn an upgrade's mod object into readable stat lines ----
const STAT_LABEL = {
  dmg: 'DAMAGE', rate: 'FIRE RATE', range: 'RANGE', splash: 'BLAST RADIUS', chain: 'CHAIN HOPS', drones: 'DRONES',
  beams: 'BEAMS', beamDps: 'BEAM DPS', burnDps: 'BURN DPS', burnS: 'BURN TIME', acidDps: 'ACID DPS', acidS: 'ACID TIME',
  slow: 'SLOW', freezeS: 'FREEZE TIME', freezeEvery: 'FREEZE EVERY', pull: 'PULL', armorPierce: 'ARMOR PIERCE',
  critChance: 'CRIT CHANCE', critMult: 'CRIT DAMAGE', stunS: 'STUN', markMult: 'MARK DAMAGE', markS: 'MARK TIME',
  goldMult: 'BOUNTY', streakGold: 'STREAK GOLD', interest: 'INTEREST', waveBonus: 'WAVE BONUS',
  buffDmg: 'AURA DAMAGE', buffRate: 'AURA RATE', surgeMult: 'SURGE', surgeEvery: 'SURGE EVERY', surgeS: 'SURGE TIME',
  auraCrit: 'GRANTS CRITS', coreShield: 'CORE SHIELD', coreRegen: 'CORE REGEN', auraDps: 'AURA DPS', vulnMult: 'VULNERABILITY',
  pulsePush: 'PUSHBACK', pulseSlow: 'PULSE SLOW', pulseEvery: 'PULSE EVERY', pierceLine: 'PIERCE',
  cluster: 'CLUSTER BOMBS', boomDmg: 'DRONE BOMBS', rampMult: 'RAMP DAMAGE', rampS: 'RAMP TIME',
  targeting: 'TARGETS', resupply: 'RESUPPLY', ammoRegen: 'AMMO REGEN', abilityCd: 'ULT COOLDOWN',
  dmgMult: 'DAMAGE', rpmMult: 'FIRE RATE', magMult: 'MAG SIZE', spreadMult: 'SPREAD', reloadMult: 'RELOAD TIME',
};
const PCT_MULT = new Set(['dmgMult', 'rpmMult', 'magMult', 'spreadMult', 'reloadMult']);
const FRAC = new Set(['slow', 'armorPierce', 'critChance', 'interest', 'pulseSlow']);
const TIMES = new Set(['critMult', 'goldMult', 'markMult', 'vulnMult', 'rampMult', 'surgeMult', 'buffDmg', 'buffRate']);
function fmtMod(k, v) {
  if (k === 'ability') return `⭐ ULTIMATE: ${ABILITIES[v]?.name || String(v).toUpperCase()} — [X] TO FIRE`;
  const label = STAT_LABEL[k] || k.replace(/([A-Z])/g, ' $1').toUpperCase();
  if (typeof v === 'boolean') return label;
  if (typeof v === 'string') return `${label}: ${v.toUpperCase()}`;
  if (PCT_MULT.has(k)) { const p = Math.round((v - 1) * 100); return `${label} ${p >= 0 ? '+' : ''}${p}%`; }
  if (FRAC.has(k)) return `${label} ${Math.round(v * 100)}%`;
  if (TIMES.has(k)) return `${label} ×${v}`;
  if (DELTA_KEYS.has(k)) return `${label} ${v >= 0 ? '+' : ''}${v}`;
  return `${label} → ${v}${/S$|Every$/.test(k) ? 's' : ''}`;
}
const tipFor = (up) => `${up.name} — ${up.cost}g\n` + Object.entries(up.mod || {}).map(([k, v]) => '· ' + fmtMod(k, v)).join('\n');

const CSS = `
.tdc-top{position:absolute;top:52px;left:50%;transform:translateX(-50%);z-index:30;display:flex;gap:16px;align-items:center;
  background:rgba(8,14,8,0.8);border:1px solid rgba(159,232,106,0.35);border-radius:8px;padding:7px 16px;
  font-family:'Segoe UI',system-ui,sans-serif;pointer-events:none;color:#eaf6ff;}
.tdc-top b{font-size:14px;} .tdc-top .lb{font-size:9px;letter-spacing:.18em;color:#8fa6bb;display:block;}
.tdc-top .gold b{color:#ffd166;} .tdc-top .core b{color:#7df9ff;} .tdc-top .wave b{color:#9fe86a;}
.tdc-banner{position:absolute;top:24%;left:50%;transform:translate(-50%,-50%);z-index:64;text-align:center;display:none;
  font-family:'Segoe UI',system-ui,sans-serif;pointer-events:none;}
.tdc-banner .w{font-size:38px;font-weight:900;letter-spacing:.26em;color:#9fe86a;text-shadow:0 0 30px rgba(159,232,106,0.5);}
.tdc-banner .s{font-size:12px;letter-spacing:.26em;color:#aebccb;margin-top:6px;}
.tdc-hint{position:absolute;bottom:13vh;left:50%;transform:translateX(-50%);z-index:30;font-size:12px;font-weight:800;
  letter-spacing:.2em;color:#9fe86a;text-shadow:0 1px 6px #000;font-family:'Segoe UI',system-ui,sans-serif;pointer-events:none;text-align:center;}
.tdc-panel{position:absolute;left:16px;top:96px;bottom:16px;width:352px;z-index:46;display:none;flex-direction:column;
  background:rgba(8,14,8,0.95);border:1px solid rgba(159,232,106,0.4);border-radius:10px;padding:14px;overflow:auto;
  font-family:'Segoe UI',system-ui,sans-serif;color:#eaf6ff;}
.tdc-panel.on{display:flex;}
.tdc-panel::-webkit-scrollbar{width:7px}.tdc-panel::-webkit-scrollbar-thumb{background:rgba(159,232,106,.3);border-radius:4px}
.tdc-panel h3{font-size:12px;font-weight:900;letter-spacing:.22em;color:#9fe86a;margin:4px 0 10px;}
.tdc-item{display:flex;gap:10px;align-items:center;background:rgba(14,22,14,0.92);border:1px solid rgba(255,255,255,0.08);
  border-radius:8px;padding:8px 12px;margin-bottom:6px;cursor:pointer;font-size:12px;}
.tdc-item:hover{border-color:rgba(159,232,106,0.6);}
.tdc-item.sel{border-color:#9fe86a;background:rgba(22,36,20,0.95);}
.tdc-item .c{margin-left:auto;font-weight:800;color:#ffd166;white-space:nowrap;}
.tdc-item .r{font-size:8.5px;letter-spacing:.1em;padding:2px 5px;border-radius:4px;}
.tdc-item .r.damage{background:rgba(255,138,74,.15);color:#ff8a4a;}.tdc-item .r.buff{background:rgba(159,232,106,.15);color:#9fe86a;}
.tdc-item .r.debuff{background:rgba(125,178,255,.15);color:#7db2ff;}.tdc-item .r.economy{background:rgba(255,209,102,.15);color:#ffd166;}
.tdc-up{background:rgba(14,22,14,0.92);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:10px;margin-bottom:8px;}
.tdc-up .nm{font-size:11.5px;font-weight:700;}
.tdc-up .tier{font-size:9.5px;color:#8fa6bb;letter-spacing:.12em;margin:1px 0 6px;}
.tdc-btn{display:inline-block;font-size:11px;font-weight:800;letter-spacing:.1em;padding:6px 12px;border-radius:6px;cursor:pointer;
  background:rgba(159,232,106,0.14);color:#9fe86a;border:1px solid rgba(159,232,106,0.45);margin-top:6px;}
.tdc-btn:hover{background:rgba(159,232,106,0.3);}
.tdc-btn.no{opacity:.35;pointer-events:none;}
.tdc-btn.gold{color:#ffd166;border-color:rgba(255,209,102,0.5);background:rgba(255,209,102,0.12);}
.tdc-btn.red{color:#ff8a8a;border-color:rgba(255,107,107,0.4);background:rgba(255,107,107,0.1);}
.tdc-start{position:absolute;bottom:16px;left:50%;transform:translateX(-50%);z-index:46;font-family:'Segoe UI',system-ui,sans-serif;
  font-size:13px;font-weight:900;letter-spacing:.3em;color:#04120a;background:#9fe86a;border-radius:8px;padding:11px 30px;cursor:pointer;
  box-shadow:0 0 30px rgba(159,232,106,0.4);display:none;}
.tdc-start:hover{transform:translateX(-50%) scale(1.04);}
.tdc-tip{position:fixed;z-index:80;display:none;max-width:250px;background:rgba(4,10,6,0.97);border:1px solid rgba(159,232,106,0.55);
  border-radius:8px;padding:9px 12px;font-family:'Segoe UI',system-ui,sans-serif;font-size:11px;line-height:1.5;color:#dff2ff;
  white-space:pre-line;pointer-events:none;box-shadow:0 6px 24px rgba(0,0,0,0.6);}
.tdc-paths{display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-bottom:8px;}
.tdc-path{background:rgba(14,22,14,0.92);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:7px 7px 8px;}
.tdc-path.lk{opacity:.42;}
.tdc-path .ph{font-size:9px;font-weight:900;letter-spacing:.14em;color:#9fe86a;margin-bottom:5px;}
.tdc-path .pn{font-size:9.5px;line-height:1.3;margin:3px 0;opacity:.5;cursor:help;}
.tdc-path .pn.own{opacity:1;color:#dff2ff;}
.tdc-path .pn.ult{color:#ffd166;}
.tdc-path .tdc-btn{font-size:10px;padding:5px 8px;margin-top:5px;width:100%;box-sizing:border-box;text-align:center;}
.tdc-gun{display:flex;align-items:center;gap:8px;}
.tdc-gun canvas{background:rgba(0,0,0,0.3);border-radius:6px;flex:0 0 auto;}
.tdc-ults{position:absolute;right:16px;bottom:15vh;z-index:30;display:flex;flex-direction:column;gap:5px;align-items:flex-end;
  font-family:'Segoe UI',system-ui,sans-serif;pointer-events:none;}
.tdc-ults .ur{background:rgba(8,14,8,0.85);border:1px solid rgba(255,209,102,0.5);border-radius:7px;padding:5px 11px;
  font-size:10.5px;font-weight:800;letter-spacing:.12em;color:#ffd166;}
.tdc-ults .ur.cd{border-color:rgba(255,255,255,0.15);color:#8fa6bb;}
.tdc-ubtn{width:100%;text-align:center;font-size:12px;padding:9px 12px;margin:2px 0 8px;box-sizing:border-box;}
`;

export class TdUi {
  constructor(ctx, conn, view) {
    this.ctx = ctx; this.conn = conn; this.view = view;
    injectCss('tdc-css', CSS);
    const parent = document.getElementById('ui') || document.body;
    const el = (cls, html) => { const d = document.createElement('div'); d.className = cls; d.innerHTML = html || ''; parent.appendChild(d); return d; };
    this.top = el('tdc-top', `
      <span class="wave"><span class="lb">WAVE</span><b>1</b></span>
      <span class="core"><span class="lb">CORE</span><b>100</b></span>
      <span class="gold"><span class="lb">CREW GOLD</span><b>0</b></span>
      <span class="left"><span class="lb">HOSTILES</span><b>—</b></span>`);
    this.banner = el('tdc-banner', `<div class="w"></div><div class="s"></div>`);
    this.hint = el('tdc-hint');
    this.panel = el('tdc-panel interactive');
    this.startBtn = el('tdc-start interactive', 'START WAVE ▶ (G)');
    this.startBtn.addEventListener('click', () => this.conn.tdSend('td_start', {}));
    this.ults = el('tdc-ults');   // bottom-right ultimate readiness chips
    this.tip = el('tdc-tip');     // hover tooltip (upgrade stat breakdowns)
    this.panel.addEventListener('mouseover', (e) => {
      const t = e.target.closest?.('[data-tip]');
      if (!t) { this.tip.style.display = 'none'; return; }
      this.tip.textContent = t.dataset.tip;
      this.tip.style.display = 'block';
      const r = t.getBoundingClientRect();
      this.tip.style.left = Math.min(window.innerWidth - 265, r.right + 10) + 'px';
      this.tip.style.top = Math.min(window.innerHeight - 150, r.top) + 'px';
    });
    this.panel.addEventListener('mouseleave', () => { this.tip.style.display = 'none'; });

    this.state = { phase: 'build', wave: 0, gold: 0, core: 100, coreMax: 100, left: 0 };
    this.kit = { guns: ['pistol'], tiers: { pistol: [0, 0, 0] }, up: { pdmg: 0, pspeed: 0, phealth: 0 } };
    this.placing = null;
    this._panelMode = null; // 'build' | 'tower' | 'armory'
    this._towerUid = null;
    this._resumeOffer = false;

    this._unsub = [];
    this._keys = [];
    this._keys.push(ctx.input.onKeyDown('KeyB', () => { if (this._open()) this._close(); else this._show('build'); }));
    this._keys.push(ctx.input.onKeyDown('KeyG', () => { if (this.state.phase === 'build') this.conn.tdSend('td_start', {}); }));
    this._keys.push(ctx.input.onKeyDown('KeyX', () => this._fireNearestUlt()));
    this._keys.push(ctx.input.onKeyDown('KeyY', () => { if (this._resumeOffer) { this._resumeOffer = false; this.conn.tdSend('td_resume', {}); } }));
    this._keys.push(ctx.input.onKeyDown('KeyN', () => { if (this._resumeOffer) { this._resumeOffer = false; this.banner.style.display = 'none'; this.conn.tdSend('td_new', {}); } }));
    this._onClick = (e) => { if (e.button === 0 && e.target === ctx.canvas && this.placing) this._tryPlace(); };
    window.addEventListener('mousedown', this._onClick);
    this._eTimer = 0; this._ultT = 0;
    // a crew death bled gold — surface the toll to everyone
    this._onPenalty = (ev) => this.flash(`💀 DEATH TOLL — CREW LOST ${ev.g}g (${ev.pct}%)`, 3200);
    ctx.events.on('td:penalty', this._onPenalty);
  }

  // --------------------------------------------------------------- state ----
  setLight(td) {
    this.state = td;
    this.top.querySelector('.wave b').textContent = Math.max(1, td.wave + (td.phase === 'build' ? 1 : 0));
    this.top.querySelector('.core b').textContent = `${td.core}/${td.coreMax}`;
    this.top.querySelector('.gold b').textContent = td.gold;
    this.top.querySelector('.left b').textContent = td.phase === 'wave' ? td.left : '—';
    this.startBtn.style.display = td.phase === 'build' ? 'block' : 'none';
    if (this._panelMode && this._goldShown !== td.gold) { this._goldShown = td.gold; this._render(); }
  }
  setKit(kit) { if (kit) { this.kit = kit; if (this._panelMode === 'armory') this._render(); } }
  ack(m) {
    if (m.op === 'td_querysave') { if (m.ok) this._offerResume(m); return; }
    if (m.op === 'td_resume') {
      if (m.ok) this.bannerShow('RUN RESTORED', `WAVE ${m.wave} CHECKPOINT — BUILD & UPGRADE, THEN G`);
      else if (m.why === 'none') this.flash('NO SAVE FOUND');
      return;
    }
    if (m.ok) { this._render(); return; }
    const why = {
      gold: 'NOT ENOUGH GOLD', spot: 'INVALID SPOT — BUILD BESIDE THE LANE', locked: 'PATH LOCKED',
      full: 'HANDS FULL — PICK A GUN TO DROP', cooldown: 'ULTIMATE STILL CHARGING',
    }[m.why] || 'NOPE';
    this.flash(why);
  }

  _offerResume(m) {
    this._resumeOffer = true;
    this.bannerShow('SAVED RUN FOUND', `WAVE ${m.wave} · ${m.gold}g — [Y] RESUME · [N] NEW RUN`, 20000);
  }

  // [X] fires the closest READY tower ultimate (path-C tier 3 capstones)
  _fireNearestUlt() {
    const me = this.ctx.camera?.getWorldPosition?.(new THREE.Vector3());
    if (!me) return;
    let best = null, bd = Infinity, charging = null;
    for (const u of this.view.units.values()) {
      if (!u.stats?.ability) continue;
      const d = Math.hypot(u.x - me.x, u.z - me.z);
      if ((u.abilityCd || 0) > 0) { charging = charging ?? u; continue; }
      if (d < bd) { bd = d; best = u; }
    }
    if (best) this.conn.tdSend('td_ability', { uid: best.uid });
    else if (charging) this.flash(`ULTIMATE CHARGING — ${Math.ceil(charging.abilityCd)}s`);
  }
  wave(e) { this.bannerShow(`WAVE ${e.wave}`, e.queen ? '⚠ THE QUEEN COMES' : `${e.count} HOSTILES INBOUND`); }
  waveDone(e) { this.bannerShow(`WAVE ${e.wave} CLEARED`, `CREW BONUS +${e.bonus}g — BUILD & UPGRADE, THEN G`); }
  over(e) { this.bannerShow('CORE DESTROYED', `THE LINE BROKE ON WAVE ${e.wave} — RESTARTING…`, 8000); }
  resetRun() { this.bannerShow('NEW RUN', 'THE FOUNDRY RESETS. HOLD THE LINE.'); }
  flash(t, ms = 1400) { this.hint.textContent = t; clearTimeout(this._ht); this._ht = setTimeout(() => { this.hint.textContent = this._promptText || ''; }, ms); }
  bannerShow(w, s, ms = 3400) {
    this.banner.querySelector('.w').textContent = w;
    this.banner.querySelector('.s').textContent = s;
    this.banner.style.display = 'block';
    clearTimeout(this._bt);
    this._bt = setTimeout(() => { this.banner.style.display = 'none'; }, ms);
  }

  // ---------------------------------------------------------- E-interact ----
  update(dt) {
    this._eTimer -= dt;
    const me = this.ctx.camera?.getWorldPosition?.(new THREE.Vector3());
    if (!me) return;
    let prompt = '';
    const nearArmory = Math.hypot(me.x - TD_ARMORY.x, me.z - TD_ARMORY.z) < 3.4;
    const unit = !nearArmory && this.view.nearestUnit(me, 2.6);
    if (nearArmory) prompt = '[E] ARMORY — GUNS & UPGRADES';
    else if (unit) prompt = `[E] ${unit.def.name} — UPGRADE`;
    else if (this.placing) prompt = 'CLICK GROUND BESIDE THE LANE TO PLACE · B TO CANCEL';
    this._promptText = prompt;
    if (!this._ht || this.hint.textContent === '' || !this.hint.textContent.startsWith('NOT') ) this.hint.textContent = prompt;
    if (this.ctx.input.consumePressed('interact') && this._eTimer <= 0) {
      this._eTimer = 0.3;
      if (nearArmory) this._show('armory');
      else if (unit) { this._towerUid = unit.uid; this._show('tower'); }
    }
    // ultimate readiness chips (bottom-right)
    this._ultT -= dt;
    if (this._ultT <= 0) {
      this._ultT = 0.3;
      let html = '';
      for (const u of this.view.units.values()) {
        if (!u.stats?.ability) continue;
        const cd = u.abilityCd || 0;
        const name = ABILITIES[u.stats.ability]?.name || u.stats.ability.toUpperCase();
        html += cd > 0 ? `<div class="ur cd">${u.def.icon} ${name} · ${Math.ceil(cd)}s</div>`
                       : `<div class="ur">${u.def.icon} ${name} · [X] READY</div>`;
      }
      if (html !== this._ultHtml) { this._ultHtml = html; this.ults.innerHTML = html; }
    }
  }

  // ------------------------------------------------------------ placement ---
  _aimPoint() {
    const cam = this.ctx.camera;
    const o = cam.getWorldPosition(new THREE.Vector3());
    const d = cam.getWorldDirection(new THREE.Vector3());
    if (d.y > -0.05) return null;
    const t = -o.y / d.y;
    if (t < 0 || t > 60) return null;
    return o.add(d.multiplyScalar(t));
  }
  _tryPlace() {
    const p = this._aimPoint();
    if (!p) { this.flash('AIM AT THE GROUND'); return; }
    this.conn.tdSend('td_place', { defId: this.placing, x: +p.x.toFixed(2), z: +p.z.toFixed(2) });
  }

  // -------------------------------------------------------------- panels ----
  _open() { return this.panel.classList.contains('on'); }
  _show(mode) {
    this._panelMode = mode;
    if (!this._open()) { this.panel.classList.add('on'); this.ctx.input.pushUI('td'); }
    this._render();
  }
  _close() {
    this.panel.classList.remove('on');
    this.ctx.input.popUI('td');
    this._panelMode = null; this.placing = null;
  }

  _render() {
    if (!this._panelMode) return;
    if (this._panelMode === 'build') this._renderBuild();
    else if (this._panelMode === 'tower') this._renderTower();
    else if (this._panelMode === 'armory') this._renderArmory();
  }

  _renderBuild() {
    const p = this.panel;
    p.innerHTML = `<h3>BUILD — ${this.state.gold}g (CREW)</h3>` + UNIT_DEFS.map((d) => `
      <div class="tdc-item ${this.placing === d.id ? 'sel' : ''}" data-u="${d.id}">
        <span>${d.icon}</span><span>${esc(d.name)}<br><span class="r ${d.role}">${d.role.toUpperCase()}</span></span>
        <span class="c">${d.cost}g</span>
      </div>`).join('')
      + `<h3 style="margin-top:12px">YOURSELF</h3>` + PLAYER_UPGRADES.map((u) => {
        const t = this.kit.up[u.id] | 0;
        const maxed = t >= u.tiers;
        return `<div class="tdc-item" data-p="${u.id}"><span>${u.icon}</span><span>${esc(u.name)} ${'▰'.repeat(t)}${'▱'.repeat(u.tiers - t)}<br><span style="font-size:9.5px;opacity:.6">${u.per}</span></span><span class="c">${maxed ? 'MAX' : u.cost(t) + 'g'}</span></div>`;
      }).join('')
      + `<div class="tdc-btn" data-x style="align-self:center">CLOSE (B)</div>`;
    p.querySelectorAll('[data-u]').forEach((el) => el.addEventListener('click', () => {
      this.placing = this.placing === el.dataset.u ? null : el.dataset.u;
      this._close(); // close the panel to aim + click-place
      if (this.placing) { this.ctx.input.lock?.(); }
    }));
    p.querySelectorAll('[data-p]').forEach((el) => el.addEventListener('click', () => this.conn.tdSend('td_selfup', { id: el.dataset.p })));
    p.querySelector('[data-x]').addEventListener('click', () => this._close());
  }

  // three BTD-style path columns: hover any node for its stat tooltip
  _pathCols(paths, tiers, gold, dataAttr) {
    return `<div class="tdc-paths">` + paths.map((path, pi) => {
      const tier = tiers[pi] | 0;
      const next = path[tier];
      const locked = !canUpgrade(tiers, pi) && tier < 3;
      return `<div class="tdc-path ${locked ? 'lk' : ''}">
        <div class="ph">${['◈ A', '◆ B', '✦ C'][pi]} · ${tier}/3${locked ? ' 🔒' : ''}</div>
        ${path.map((up, i) => `<div class="pn ${i < tier ? 'own' : ''} ${up.mod?.ability ? 'ult' : ''}" data-tip="${esc(tipFor(up))}">${i < tier ? '✔' : up.mod?.ability ? '⭐' : '○'} ${esc(up.name)}</div>`).join('')}
        ${next && !locked ? `<div class="tdc-btn ${gold < next.cost ? 'no' : ''}" ${dataAttr}="${pi}" data-tip="${esc(tipFor(next))}">▲ ${next.cost}g</div>` : ''}
      </div>`;
    }).join('') + `</div>`;
  }

  _renderTower() {
    const u = this.view.units.get(this._towerUid);
    const p = this.panel;
    if (!u) { this._close(); return; }
    const cd = u.abilityCd || 0;
    p.innerHTML = `<h3>${u.def.icon} ${esc(u.def.name)} — ${this.state.gold}g</h3>
      <div style="font-size:10px;letter-spacing:.1em;color:#8fa6bb;margin-bottom:8px">INVESTED ${u.invested}g</div>`
      + this._pathCols(u.def.paths, u.tiers, this.state.gold, 'data-up')
      + (u.stats?.ability ? `<div class="tdc-btn gold tdc-ubtn ${cd > 0 ? 'no' : ''}" data-ult>⭐ ${esc(ABILITIES[u.stats.ability]?.name || 'ULTIMATE')} ${cd > 0 ? `— ${Math.ceil(cd)}s` : '— FIRE (X)'}</div>` : '')
      + `<div style="display:flex;gap:8px;margin-top:4px">
           <div class="tdc-btn gold" data-sell>SELL +${Math.round(u.invested * TD_SELL_FRAC)}g</div>
           <div class="tdc-btn" data-x>CLOSE</div>
         </div>`;
    p.querySelectorAll('[data-up]').forEach((el) => el.addEventListener('click', () => this.conn.tdSend('td_upgrade', { uid: u.uid, path: +el.dataset.up })));
    p.querySelector('[data-ult]')?.addEventListener('click', () => this.conn.tdSend('td_ability', { uid: u.uid }));
    p.querySelector('[data-sell]').addEventListener('click', () => { this.conn.tdSend('td_sell', { uid: u.uid }); this._close(); });
    p.querySelector('[data-x]').addEventListener('click', () => this._close());
  }

  _renderArmory() {
    const p = this.panel;
    const k = this.kit;
    const glyph = (id, w = 66, h = 30) => `<canvas data-glyph="${id}" width="${w}" height="${h}"></canvas>`;
    const gunRow = (id) => {
      const tree = WEAPON_TREES[id];
      const tiers = k.tiers[id] || [0, 0, 0];
      return `<div class="tdc-up">
        <div class="tdc-gun" style="margin-bottom:6px">${glyph(id)}<div class="nm" style="font-size:12.5px">${id.toUpperCase()}</div></div>`
        + (tree ? this._pathCols(tree.paths, tiers, this.state.gold, `data-path data-w="${id}" data-pi`) : '')
        + `</div>`;
    };
    p.innerHTML = `<h3>🏪 ARMORY — ${this.state.gold}g (CREW)</h3>
      <div style="font-size:10px;letter-spacing:.1em;color:#8fa6bb;margin-bottom:8px">HOLDING ${k.guns.length}/${TD_MAX_GUNS}: ${k.guns.map((g) => g.toUpperCase()).join(' + ')}</div>`
      + k.guns.map(gunRow).join('')
      + `<h3 style="margin-top:10px">BUY GUNS</h3>`
      + TD_SHOP.filter((s) => !k.guns.includes(s.id)).map((s) => `
        <div class="tdc-item" data-buy="${s.id}"><span class="tdc-gun">${glyph(s.id, 56, 26)}</span><span>${s.id.toUpperCase()}</span><span class="c">${s.cost}g</span></div>`).join('')
      + `<div class="tdc-btn" data-x style="align-self:center">CLOSE</div>`;
    // paint the 2D silhouettes (same glyphs as the weapon wheel)
    p.querySelectorAll('canvas[data-glyph]').forEach((c) => {
      const g = c.getContext('2d');
      drawGlyph(g, c.dataset.glyph, c.width / 2, c.height / 2, '#7df9ff');
    });
    p.querySelectorAll('[data-buy]').forEach((el) => el.addEventListener('click', () => {
      const id = el.dataset.buy;
      if (k.guns.length >= TD_MAX_GUNS) {
        // must drop one — quick chooser
        const drop = k.guns[k.guns.length - 1] === id ? k.guns[0] : k.guns.find((g) => g !== 'pistol') || k.guns[0];
        const pick = prompt(`Hands full (${k.guns.join(' + ')}). Type the gun to DROP:`, drop);
        if (!pick || !k.guns.includes(pick)) return;
        this.conn.tdSend('td_buyweapon', { id, drop: pick });
      } else this.conn.tdSend('td_buyweapon', { id });
    }));
    p.querySelectorAll('[data-w]').forEach((el) => el.addEventListener('click', () => this.conn.tdSend('td_wupgrade', { id: el.dataset.w, path: +el.dataset.pi })));
    p.querySelector('[data-x]').addEventListener('click', () => this._close());
  }

  dispose() {
    window.removeEventListener('mousedown', this._onClick);
    this.ctx.events.off?.('td:penalty', this._onPenalty);
    for (const u of this._keys) { try { u(); } catch { /* fine */ } }
    for (const el of [this.top, this.banner, this.hint, this.panel, this.startBtn, this.ults, this.tip]) el?.remove();
    if (this._open()) this.ctx.input.popUI('td');
  }
}
