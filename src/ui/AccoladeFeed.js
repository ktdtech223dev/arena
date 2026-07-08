// ARENA — ui/AccoladeFeed.js (task 1E)
// On-screen kill-accolade / medal popups. The server (server/Accolades.js) owns
// kills and thus medals; it emits an 'accolade' { awards:[{id,name,movement}],
// streak, multi } to the earner. ArenaMode forwards each payload to push(). We
// render a punchy code-built medal popup per award (icon + name), stack/queue
// them, and play an audio sting (movement medals + escalating multikills get a
// bigger sting). Also tracks this-match counts + renders a simple end-of-round
// summary list. Pure DOM/CSS + inline SVG icons — zero external assets.

const CSS = `
.acc-wrap{position:absolute;top:16%;left:50%;transform:translateX(-50%);z-index:60;
  display:flex;flex-direction:column;align-items:center;gap:8px;pointer-events:none;
  font-family:'Segoe UI',system-ui,-apple-system,sans-serif;}
.acc{display:flex;align-items:center;gap:11px;padding:9px 18px 9px 12px;border-radius:10px;
  background:linear-gradient(180deg,rgba(14,20,28,0.94),rgba(8,12,18,0.9));
  border:1px solid rgba(255,255,255,0.14);box-shadow:0 8px 30px rgba(0,0,0,0.55);
  opacity:0;transform:translateY(-14px) scale(0.82);
  transition:opacity .18s ease,transform .22s cubic-bezier(.2,1.3,.4,1);}
.acc.in{opacity:1;transform:translateY(0) scale(1);}
.acc.out{opacity:0;transform:translateY(-10px) scale(0.9);transition:opacity .3s ease,transform .3s ease;}
.acc .acc-ic{width:30px;height:30px;flex:0 0 30px;filter:drop-shadow(0 0 6px currentColor);}
.acc .acc-tx{display:flex;flex-direction:column;line-height:1.1;}
.acc .acc-name{font-size:15px;font-weight:900;letter-spacing:.13em;color:#f2f7ff;
  text-shadow:0 1px 3px #000;}
.acc .acc-sub{font-size:9px;font-weight:700;letter-spacing:.24em;opacity:.6;text-transform:uppercase;}
.acc.mv{border-color:rgba(125,249,255,0.6);box-shadow:0 8px 30px rgba(0,0,0,0.55),0 0 22px rgba(125,249,255,0.22);}
.acc.mv .acc-name{color:#c8faff;}
.acc.big{border-color:rgba(255,150,60,0.7);box-shadow:0 8px 34px rgba(0,0,0,0.6),0 0 26px rgba(255,140,50,0.3);}
.acc.big .acc-name{color:#ffd9a8;font-size:17px;}

.acc-summary{position:absolute;inset:0;z-index:140;display:none;align-items:center;justify-content:center;
  background:rgba(4,6,10,0.72);backdrop-filter:blur(5px);font-family:'Segoe UI',system-ui,sans-serif;}
.acc-summary.on{display:flex;}
.acc-sum-panel{width:min(560px,92vw);max-height:86vh;overflow:auto;background:rgba(10,14,20,0.97);
  border:1px solid rgba(125,249,255,0.28);border-radius:12px;padding:22px 26px;color:#dfe7f0;
  box-shadow:0 20px 70px rgba(0,0,0,0.6);}
.acc-sum-h{font-size:19px;font-weight:800;letter-spacing:.22em;color:#7df9ff;margin-bottom:14px;}
.acc-sum-row{display:flex;align-items:center;gap:10px;padding:9px 0;border-top:1px solid rgba(255,255,255,0.07);}
.acc-sum-dot{width:10px;height:10px;border-radius:3px;box-shadow:0 0 8px currentColor;}
.acc-sum-name{font-weight:800;letter-spacing:.06em;min-width:110px;}
.acc-sum-medals{display:flex;flex-wrap:wrap;gap:5px;flex:1;}
.acc-sum-chip{font-size:9.5px;font-weight:700;letter-spacing:.08em;padding:2px 7px;border-radius:5px;
  background:rgba(125,249,255,0.1);border:1px solid rgba(125,249,255,0.22);color:#bfe9ef;}
.acc-sum-total{font-size:20px;font-weight:900;color:#ffd166;min-width:36px;text-align:right;}
`;

// code-built inline-SVG glyphs per accolade family (24x24 viewBox, stroke=currentColor)
function glyph(id) {
  const g = {
    firstblood: '<path d="M12 3c3 4 5 6.5 5 9.5A5 5 0 0 1 7 12.5C7 9.5 9 7 12 3z"/>',
    double: '<path d="M4 12h16M13 6l6 6-6 6"/>',
    triple: '<path d="M3 12h18M11 6l6 6-6 6M4 6l3 6-3 6"/>',
    quad: '<path d="M3 8h18M3 16h18M11 4l5 8-5 8"/>',
    penta: '<path d="M12 3l2.6 5.6L21 9.3l-4.4 4.2L17.7 20 12 16.8 6.3 20l1.1-6.5L3 9.3l6.4-.7z"/>',
    streak3: '<path d="M6 20V9M12 20V5M18 20v-8"/>',
    streak5: '<path d="M6 20V9M12 20V5M18 20v-8"/>',
    streak7: '<path d="M6 20V9M12 20V5M18 20v-8"/>',
    streak10: '<path d="M12 2l2 6h6l-5 4 2 7-5-4-5 4 2-7-5-4h6z"/>',
    revenge: '<path d="M4 12a8 8 0 1 1 3 6M4 12v5M4 12h5"/>',
    headshot: '<circle cx="12" cy="10" r="5"/><path d="M12 8v4M9.5 10.5l5-1"/>',
    longshot: '<circle cx="12" cy="12" r="8"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
    knife: '<path d="M4 20l7-7M13 11l6-6 1 1-6 6zM11 13l2 2"/>',
    bat: '<path d="M5 19L16 8M16 8l3-3 1 1-3 3zM5 19l-1 1"/>',
    midair: '<path d="M4 14c3-4 6-4 8-1 2-3 5-3 8 1M12 5v6"/>',
    trickshot: '<path d="M4 14c3-4 6-4 8-1 2-3 5-3 8 1M12 5v6"/><circle cx="12" cy="19" r="2"/>',
    wallrun: '<path d="M6 4v16M6 8l8 3M6 13l8 3M18 6l-2 2 2 2"/>',
    slide: '<path d="M3 17c4 2 9 2 14-1l4-2M6 14l2 3"/>',
    inmotion: '<path d="M3 12h9M5 8h7M5 16h7M15 6l5 6-5 6"/>',
  };
  const inner = g[id] || '<circle cx="12" cy="12" r="7"/>';
  return `<svg class="acc-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}
// color per family
function tint(a) {
  if (a.movement) return '#7df9ff';
  if (/^streak/.test(a.id)) return '#c58bff';
  if (['double', 'triple', 'quad', 'penta'].includes(a.id)) return '#ff9a4a';
  if (a.id === 'headshot' || a.id === 'longshot') return '#ffd166';
  if (a.id === 'knife' || a.id === 'bat') return '#ff6b6b';
  if (a.id === 'firstblood') return '#ff5b5b';
  if (a.id === 'revenge') return '#ff8fcf';
  return '#eaf6ff';
}
const BIG = new Set(['quad', 'penta', 'streak7', 'streak10', 'trickshot']);

function injectCss(id, t) { if (typeof document === 'undefined' || document.getElementById(id)) return; const s = document.createElement('style'); s.id = id; s.textContent = t; document.head.appendChild(s); }

export class AccoladeFeed {
  constructor(ctx) {
    this.ctx = ctx;
    this._q = [];          // pending awards to show
    this._live = [];       // { el, life }
    this._cool = 0;        // stagger between popups
    this.counts = {};      // this-match count per accolade id (local view)
    if (typeof document === 'undefined') return;
    injectCss('acc-feed-css', CSS);
    const parent = document.getElementById('ui') || document.body;
    this.wrap = document.createElement('div'); this.wrap.className = 'acc-wrap';
    parent.appendChild(this.wrap);
    this.summaryEl = document.createElement('div'); this.summaryEl.className = 'acc-summary';
    this.summaryEl.innerHTML = `<div class="acc-sum-panel"><div class="acc-sum-h">MATCH ACCOLADES</div><div class="acc-sum-body"></div></div>`;
    parent.appendChild(this.summaryEl);
    this._sumBody = this.summaryEl.querySelector('.acc-sum-body');
  }

  // Called from ArenaMode on an 'accolade' event.
  push(payload) {
    if (!payload || !Array.isArray(payload.awards)) return;
    for (const a of payload.awards) {
      this._q.push(a);
      this.counts[a.id] = (this.counts[a.id] || 0) + 1;
    }
  }

  _spawn(a) {
    const color = tint(a);
    const big = BIG.has(a.id) || !!a.big;
    const sub = a.movement ? 'movement' : ' ';
    const el = document.createElement('div');
    el.className = 'acc' + (a.movement ? ' mv' : '') + (big ? ' big' : '');
    el.innerHTML = `<span style="color:${color}">${glyph(a.id)}</span>` +
      `<span class="acc-tx"><span class="acc-name">${escapeHtml(a.name || a.id)}</span><span class="acc-sub">${escapeHtml(sub)}</span></span>`;
    if (this.wrap) this.wrap.appendChild(el);
    requestAnimationFrame(() => el.classList.add('in'));
    this._live.push({ el, life: 2.6 });
    // audio sting: movement + big medals hit harder; fall back through what exists.
    this._sting(a, big);
  }

  _sting(a, big) {
    const bank = this.ctx.arena?.audioBank;
    const play = (name, opts) => { try { (bank && bank.play) ? bank.play(name, opts) : this.ctx.audio?.play?.(name, opts); } catch { /* audio optional */ } };
    // dedicated stings if present (added to Audio.js), else graceful existing cues.
    if (big) play('accolade_big', { volume: 0.9 });
    else if (a.movement) play('accolade_move', { volume: 0.85 });
    else play('accolade', { volume: 0.8 });
  }

  update(dt) {
    // stagger new popups so a quad doesn't stack instantly
    this._cool -= dt;
    if (this._q.length && this._cool <= 0) { this._spawn(this._q.shift()); this._cool = 0.28; }
    for (let i = this._live.length - 1; i >= 0; i--) {
      const p = this._live[i];
      p.life -= dt;
      if (p.life <= 0) {
        p.el.classList.remove('in'); p.el.classList.add('out');
        setTimeout(() => p.el.remove(), 320);
        this._live.splice(i, 1);
      }
    }
  }

  // End-of-round summary. list = [{ id, name, color, counts:{}, total }].
  showSummary(list) {
    if (!this._sumBody) return;
    const rows = (list || []).map((p) => {
      const dot = '#' + ((p.color ?? 0x8899aa).toString(16).padStart(6, '0'));
      const chips = Object.entries(p.counts || {}).map(([id, n]) => `<span class="acc-sum-chip">${escapeHtml(prettyName(id))}${n > 1 ? ' ×' + n : ''}</span>`).join('');
      return `<div class="acc-sum-row"><span class="acc-sum-dot" style="color:${dot}"></span>` +
        `<span class="acc-sum-name">${escapeHtml(p.name || '???')}</span>` +
        `<span class="acc-sum-medals">${chips || '<span class="acc-sum-chip" style="opacity:.5">— none —</span>'}</span>` +
        `<span class="acc-sum-total">${p.total || 0}</span></div>`;
    }).join('');
    this._sumBody.innerHTML = rows || '<div style="opacity:.5;padding:16px 0">No accolades this round.</div>';
    this.summaryEl.classList.add('on');
  }
  hideSummary() { this.summaryEl?.classList.remove('on'); }

  resize() { /* fluid */ }
  dispose() {
    this.wrap?.remove(); this.summaryEl?.remove();
    this.wrap = null; this.summaryEl = null; this._live.length = 0; this._q.length = 0;
  }
}

function prettyName(id) {
  return ({
    firstblood: 'First Blood', double: 'Double', triple: 'Triple', quad: 'Quad', penta: 'Penta',
    streak3: 'Spree', streak5: 'Rampage', streak7: 'Dominating', streak10: 'Unstoppable',
    revenge: 'Revenge', headshot: 'Headshot', longshot: 'Longshot', knife: 'Knife', bat: 'Hammer',
    midair: 'Midair', trickshot: 'Trickshot', wallrun: 'Wall-run', slide: 'Slide', inmotion: 'In Motion',
  })[id] || id;
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
