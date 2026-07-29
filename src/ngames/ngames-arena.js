/**
 * ngames-arena.js — ARENA ↔ N Games Network integration
 *
 * Drop-in module for ARENA (Vite/ESM). This is the ONLY file ARENA's code
 * imports; it owns the SDK lifecycle, crew identity, and all network calls.
 *
 *   import * as NG from './ngames/ngames-arena.js';
 *   await NG.init();                       // once, at boot
 *   NG.setPresence({ mode:'FFA', map:'Foundry' });
 *   NG.reportMatchEnd({ mode:'FFA', outcome:'win', kills:18, deaths:7, bestStreak:6, playtimeSec:412 });
 *   NG.unlock(NG.ACH.FIRST_BLOOD);
 *   NG.syncProgress(NG.ACH.KILLS_100, careerKills);   // pass the CAREER TOTAL — deltas handled for you
 *
 * Design rules:
 *  - EVERY call is safe to make at any time. If there's no crew identity, or the
 *    network is down, calls become no-ops. Nothing here can throw into a frame.
 *  - Nothing here blocks. All network work is fire-and-forget.
 *  - ARENA's own Profile (src/core/Profile.js) is untouched — its local `p_xxx`
 *    id still keys ARENA's own stats/camo. This module tracks the *crew* identity
 *    separately, so existing progress is never orphaned.
 */

// The core SDK is loaded as a plain <script> from /public (see the setup guide)
// so Vite never bundles it — it contains Node-only branches that only matter when
// the same file runs on a server. It defines globalThis.NGames. Resolved lazily so
// script order can't bite us.
function getSDK() {
  const S = globalThis.NGames;
  if (!S) console.warn('[ngames] ngames-sdk.js not loaded — add <script src="/ngames-sdk.js"></script> to index.html before the module script.');
  return S || null;
}

// ── Constants ───────────────────────────────────────────────────────────────

export const GAME_ID = 'arena';                 // registered in the N Games server

/** The only valid N Games profile ids. */
export const CREW = ['keshawn', 'sean', 'dart', 'amari', 'arisa', 'tyheim'];

/** Achievement ids — all 20 are ALREADY REGISTERED server-side and live. */
export const ACH = {
  FIRST_BLOOD:  'arena_first_blood',   // one-shot
  KILLS_100:    'arena_kills_100',     // incremental (goal 100)
  KILLS_500:    'arena_kills_500',     // incremental (goal 500)
  KILLS_1000:   'arena_kills_1000',    // incremental (goal 1000)
  FIRST_WIN:    'arena_first_win',     // one-shot
  WINS_10:      'arena_wins_10',       // incremental (goal 10)
  STREAK_5:     'arena_streak_5',      // one-shot
  STREAK_10:    'arena_streak_10',     // one-shot
  STREAK_15:    'arena_streak_15',     // one-shot (secret)
  FLAG_CAPTURE: 'arena_flag_capture',  // one-shot
  HILL_WIN:     'arena_hill_win',      // one-shot
  SKULL_WIN:    'arena_skull_win',     // one-shot
  TD_WAVE_10:   'arena_td_wave_10',    // one-shot
  HIVE_QUEEN:   'arena_hive_queen',    // one-shot
  DUAL_WIELD:   'arena_dual_wield',    // one-shot
  FULL_ARSENAL: 'arena_full_arsenal',  // incremental (goal 5 — one per distinct weapon)
  CAMO_GOLD:    'arena_camo_gold',     // one-shot
  CAMO_PRISM:   'arena_camo_prism',    // one-shot
  BEAT_MASTER:  'arena_beat_master',   // one-shot
  MAPMAKER:     'arena_mapmaker',      // one-shot
};

const LS_CREW = 'ngames.crew.id';
const LS_SENT = 'ngames.progress.sent.v1';   // { "<crew>:<achId>": lastCumulativeSent }

// ── State ───────────────────────────────────────────────────────────────────

let sdk       = null;
let crewId    = null;
let started   = false;
let presence  = {};

const noop = () => {};
const safe = (p) => (p && typeof p.catch === 'function' ? p.catch(noop) : p);

// ── Identity ────────────────────────────────────────────────────────────────

/**
 * Resolve the crew member playing, in trust order:
 *   1. ?ngames_profile=<id>  — injected by the N Games Launcher (authoritative)
 *   2. localStorage          — remembered from a previous launcher session
 *   3. null                  — anonymous; every network call becomes a no-op
 */
export function resolveCrewId() {
  try {
    const q = new URLSearchParams(location.search).get('ngames_profile');
    if (q && CREW.includes(q)) {
      try { localStorage.setItem(LS_CREW, q); } catch {}
      return q;
    }
  } catch {}
  try {
    const saved = localStorage.getItem(LS_CREW);
    if (saved && CREW.includes(saved)) return saved;
  } catch {}
  return null;
}

/** Manually set the crew member (for an in-game picker when run standalone). */
export function setCrewId(id) {
  if (!CREW.includes(id)) return false;
  crewId = id;
  try { localStorage.setItem(LS_CREW, id); } catch {}
  if (sdk) sdk.setPlayer(id, presence);
  else safe(init());
  return true;
}

/** Who the network thinks is playing (null = anonymous). */
export function getCrewId() { return crewId; }

/** True when a crew identity exists and the SDK is live. */
export function isLinked() { return !!(sdk && crewId); }

// ── Lifecycle ───────────────────────────────────────────────────────────────

/**
 * Boot the N Games layer. Safe to call once at startup, even when anonymous
 * (it simply stays dormant until setCrewId() is called).
 * @param {object}   [opts]
 * @param {function} [opts.onAchievement] — (e) => {}  live unlock, for a toast
 * @param {function} [opts.onWallPost]    — (e) => {}  crew wall activity
 * @param {function} [opts.onPresence]    — (e) => {}  crew online/in-game changes
 */
export async function init(opts = {}) {
  if (started) return sdk;
  started = true;

  crewId = resolveCrewId();
  if (!crewId) return null;            // anonymous — stay dormant, no calls

  const NGames = getSDK();
  if (!NGames) return null;

  try {
    sdk = new NGames({ gameId: GAME_ID, profileId: crewId, autoConnect: false });
    if (opts.onAchievement) sdk.on('achievement_unlock', (e) => { if (e.profile_id === crewId) opts.onAchievement(e); });
    if (opts.onWallPost)    sdk.on('wall_post', opts.onWallPost);
    if (opts.onPresence)    sdk.on('presence',  opts.onPresence);
    await sdk.connect();                // opens WS + starts the 60s presence heartbeat
  } catch {
    sdk = null;                         // network down — degrade silently
  }
  return sdk;
}

/** Mark the player offline and tear down. Call on quit if you can. */
export function shutdown() {
  try { sdk && sdk.disconnect(); } catch {}
  sdk = null;
  started = false;
}

// ── Presence ────────────────────────────────────────────────────────────────

/**
 * Update what the crew sees ("Keshawn is playing ARENA"). Merges into current
 * state; the SDK also re-sends it automatically every 60s.
 * @param {object} state — e.g. { mode:'CTF', map:'Foundry', status:'in a match' }
 */
export function setPresence(state = {}) {
  Object.assign(presence, state);
  if (sdk) safe(sdk.ping(presence));
}

// ── Sessions (feeds NP, leaderboard, records, per-game stats) ────────────────

/**
 * Report a finished match / TD run. This is what drives the launcher's
 * leaderboard, the records board, and per-game stats.
 *
 * `outcome:'win'` counts a win (and settles crew bets in the player's favour);
 * `'loss'` maps to the server's 'bust'. Anything else is neutral.
 *
 * The records board reads data.kills ("Most Kills") and data.streak
 * ("Longest Streak") — both are populated here, so ARENA lights up both.
 *
 * @param {object} m
 * @param {string} [m.mode]         — 'FFA' | 'TDM' | 'CTF' | 'HILL' | 'SKULL' | 'TD'
 * @param {string} [m.outcome]      — 'win' | 'loss' | undefined
 * @param {number} [m.score]        — match score; defaults to a kill-based score
 * @param {number} [m.kills]
 * @param {number} [m.deaths]
 * @param {number} [m.assists]
 * @param {number} [m.bestStreak]
 * @param {number} [m.playtimeSec]
 * @param {string} [m.map]
 * @param {number} [m.wave]         — Tower Defense: wave reached
 * @param {object} [m.extra]        — anything else worth storing
 */
export function reportMatchEnd(m = {}) {
  if (!sdk) return;
  const kills  = m.kills  | 0;
  const deaths = m.deaths | 0;
  const score  = m.score != null ? Math.round(m.score) : kills * 100 + (m.assists | 0) * 25;

  safe(sdk.submitSession({
    score,
    outcome:  m.outcome === 'win' ? 'win' : (m.outcome === 'loss' ? 'bust' : null),
    gameMode: m.mode ? String(m.mode).toLowerCase() : null,
    data: {
      kills,                                   // → "Most Kills" record
      deaths,
      assists:  m.assists | 0,
      streak:   m.bestStreak | 0,              // → "Longest Streak" record
      kd:       deaths ? +(kills / deaths).toFixed(2) : kills,
      playtime: m.playtimeSec | 0,             // → challenge progress
      map:      m.map || null,
      wave:     m.wave != null ? (m.wave | 0) : undefined,
      ...(m.extra || {}),
    },
  }));
}

// ── Achievements ────────────────────────────────────────────────────────────

/** Unlock a one-shot achievement. Idempotent — safe to call repeatedly. */
export function unlock(achievementId) {
  if (!sdk) return;
  safe(sdk.unlockAchievement(achievementId));
}

/**
 * Add RAW progress to an incremental achievement.
 * ⚠️ This sends a DELTA — the server ADDS it to the running total. If you have a
 * career/cumulative number, use syncProgress() instead, which is bug-proof.
 */
export function addProgress(achievementId, delta = 1) {
  if (!sdk || !(delta > 0)) return;
  safe(sdk.addAchievementProgress(achievementId, delta));
}

/**
 * Report a CUMULATIVE career total for an incremental achievement, sending only
 * what's new since the last call. Use this with ARENA's career counters —
 * it makes double-counting impossible.
 *
 *   NG.syncProgress(NG.ACH.KILLS_100, stats.kills);   // pass the career total
 *
 * @param {string} achievementId
 * @param {number} cumulativeTotal — the all-time total for this player
 */
export function syncProgress(achievementId, cumulativeTotal) {
  if (!sdk || !crewId) return;
  const total = Math.max(0, cumulativeTotal | 0);
  const key   = `${crewId}:${achievementId}`;
  let sent = {};
  try { sent = JSON.parse(localStorage.getItem(LS_SENT)) || {}; } catch {}
  const prev  = sent[key] | 0;
  const delta = total - prev;
  if (delta <= 0) return;                       // nothing new (or a reset) — skip
  sent[key] = total;
  try { localStorage.setItem(LS_SENT, JSON.stringify(sent)); } catch {}
  safe(sdk.addAchievementProgress(achievementId, delta));
}

/**
 * Convenience: push every career-total achievement at once. Call after a match
 * (or on the menu) with ARENA's own stats object from getStats().
 * @param {object} stats — { kills, wins, weaponKills }
 */
export function syncCareer(stats = {}) {
  if (!sdk) return;
  const kills = stats.kills | 0;
  if (kills > 0) {
    syncProgress(ACH.KILLS_100,  kills);
    syncProgress(ACH.KILLS_500,  kills);
    syncProgress(ACH.KILLS_1000, kills);
  }
  if ((stats.wins | 0) > 0) syncProgress(ACH.WINS_10, stats.wins | 0);
  // Full Arsenal: one point per distinct dual-mode weapon that has a kill.
  // (Keys match ARENA's real weaponKills ids from weapons-data.js — alt-fire
  // kills already credit the base gun server-side.)
  const wk = stats.weaponKills || {};
  const DUAL = ['arclance', 'breacher', 'hornet', 'carom', 'kinetic'];
  const distinct = DUAL.filter((w) => (wk[w] | 0) > 0).length;
  if (distinct > 0) syncProgress(ACH.FULL_ARSENAL, distinct);
}

// ── Wall ────────────────────────────────────────────────────────────────────

/** Post a highlight to the crew wall (500 char cap, server-side). */
export function postToWall(text) {
  if (!sdk || !text) return;
  safe(sdk.postToWall(String(text)));
}

// ── Escape hatch ────────────────────────────────────────────────────────────

/** The raw SDK instance (null when anonymous/offline). See SDK/README.md. */
export function raw() { return sdk; }
