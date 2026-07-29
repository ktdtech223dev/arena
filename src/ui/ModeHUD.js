// ARENA client — ui/ModeHUD.js: the game-mode scoreboard strip + round banner.
// Renders from the authoritative snap.mode every snapshot: mode name, scores
// (team pair or YOU vs LEADER), round clock, plus mode hints (hold the hill /
// carrying the skull / flag states). round_end shows a winner banner until the
// server restarts the round.
function injectCss(id, t) { if (document.getElementById(id)) return; const s = document.createElement('style'); s.id = id; s.textContent = t; document.head.appendChild(s); }
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

const CSS = `
.mh-bar{position:absolute;top:10px;left:50%;transform:translateX(-50%);z-index:30;display:flex;align-items:center;gap:14px;
  background:rgba(8,12,18,0.72);border:1px solid rgba(125,249,255,0.22);border-radius:8px;padding:7px 16px;
  font-family:'Segoe UI',system-ui,sans-serif;pointer-events:none;}
.mh-mode{font-size:11px;font-weight:800;letter-spacing:.2em;color:#7df9ff;}
.mh-score{font-size:15px;font-weight:900;letter-spacing:.06em;color:#eaf6ff;}
.mh-score .t0{color:#ff6b6b;} .mh-score .t1{color:#7db2ff;} .mh-score .me{color:#7df9ff;}
.mh-clock{font-size:13px;font-weight:700;color:#aebccb;font-variant-numeric:tabular-nums;}
.mh-hint{position:absolute;top:52px;left:50%;transform:translateX(-50%);z-index:30;font-size:11.5px;font-weight:800;
  letter-spacing:.18em;color:#9fe86a;text-shadow:0 1px 6px #000;font-family:'Segoe UI',system-ui,sans-serif;pointer-events:none;}
.mh-banner{position:absolute;top:30%;left:50%;transform:translate(-50%,-50%);z-index:65;text-align:center;
  font-family:'Segoe UI',system-ui,sans-serif;pointer-events:none;display:none;}
.mh-banner .w{font-size:44px;font-weight:900;letter-spacing:.3em;color:#ffd166;text-shadow:0 0 30px rgba(255,209,102,0.5);}
.mh-banner .s{font-size:13px;letter-spacing:.3em;color:#aebccb;margin-top:6px;}
`;

export class ModeHUD {
  constructor(ctx, getMyId, getName) {
    this.ctx = ctx;
    this.getMyId = getMyId;
    this.getName = getName || ((id) => id);
    injectCss('mode-hud-css', CSS);
    const parent = document.getElementById('ui') || document.body;
    this.bar = document.createElement('div');
    this.bar.className = 'mh-bar';
    this.bar.innerHTML = `<span class="mh-mode"></span><span class="mh-score"></span><span class="mh-clock"></span>`;
    this.hint = document.createElement('div');
    this.hint.className = 'mh-hint';
    this.banner = document.createElement('div');
    this.banner.className = 'mh-banner';
    this.banner.innerHTML = `<div class="w"></div><div class="s"></div>`;
    parent.appendChild(this.bar); parent.appendChild(this.hint); parent.appendChild(this.banner);
    this._modeEl = this.bar.querySelector('.mh-mode');
    this._scoreEl = this.bar.querySelector('.mh-score');
    this._clockEl = this.bar.querySelector('.mh-clock');
  }

  update(m) {
    if (!m) { this.bar.style.display = 'none'; this.hint.textContent = ''; return; }
    this.bar.style.display = 'flex';
    this._modeEl.textContent = m.name || m.id;
    const t = Math.max(0, m.timeLeft | 0);
    this._clockEl.textContent = `${(t / 60) | 0}:${String(t % 60).padStart(2, '0')}`;
    const me = this.getMyId();
    if (m.teams) {
      this._scoreEl.innerHTML = `<span class="t0">${m.teamScores?.[0] | 0}</span> : <span class="t1">${m.teamScores?.[1] | 0}</span> <span style="opacity:.5;font-size:11px">/ ${m.limit}</span>`;
    } else {
      const mine = (m.scores && m.scores[me]) | 0;
      let leadId = null, lead = -1;
      for (const [pid, s] of Object.entries(m.scores || {})) if (s > lead) { lead = s; leadId = pid; }
      const leadTxt = leadId && leadId !== me ? ` · ${esc(this.getName(leadId))} ${lead}` : '';
      this._scoreEl.innerHTML = `<span class="me">${mine}</span><span style="opacity:.5;font-size:11px"> / ${m.limit}${leadTxt}</span>`;
    }
    // mode hints
    let hint = '';
    if (m.zone) hint = m.zone.occ === me ? '◆ HOLDING THE HILL' : (m.zone.occ ? `◆ ${esc(this.getName(m.zone.occ))} HOLDS THE HILL` : '◆ HILL OPEN');
    if (m.orb) hint = m.orb.carrier === me ? '☠ YOU HAVE THE SKULL' : (m.orb.carrier ? `☠ ${esc(this.getName(m.orb.carrier))} HAS THE SKULL` : '☠ SKULL LOOSE');
    if (m.flags) {
      const mine = m.flags.find((f) => f.carrier === me);
      hint = mine ? '⚑ RUN THE FLAG HOME' : '';
    }
    this.hint.innerHTML = hint;
  }

  roundEnd(e) {
    const w = this.banner.querySelector('.w'), s = this.banner.querySelector('.s');
    if (e.teamName) { w.textContent = `${e.teamName} WINS`; w.style.color = e.winnerTeam === 0 ? '#ff6b6b' : '#7db2ff'; }
    else if (e.winnerName) { w.textContent = `${e.winnerName} WINS`; w.style.color = '#ffd166'; }
    else { w.textContent = 'DRAW'; w.style.color = '#aebccb'; }
    s.textContent = `NEXT ROUND IN ${Math.round((e.restartInMs || 8000) / 1000)}s`;
    this.banner.style.display = 'block';
    clearTimeout(this._bt);
    this._bt = setTimeout(() => { this.banner.style.display = 'none'; }, (e.restartInMs || 8000));
  }

  resize() { /* fixed-position DOM — nothing to do */ }
}
