/*!
 * ngames-sdk.js — N Games Network SDK  v1.1.0
 *
 * Drop this single file into any N Games project.
 * Works in Node.js (game servers), browser, and Electron. Zero dependencies
 * (in Node it lazy-requires the built-in `https` and the `ws` package).
 *
 * This SDK is the N Games NETWORK layer — profiles, sessions, achievements,
 * wall, leaderboards, presence, challenges, seasons, bets, and DMs. It is NOT
 * a realtime game-netcode layer: it does not relay player positions, block
 * updates, or room state. Run your own server for that (e.g. on Railway) and
 * use this SDK alongside it for everything network-social.
 *
 * Every route and field below was verified against the live server
 * (ngames-server v1.4.7). Methods map 1:1 to real endpoints.
 *
 * ─── Quick Start ────────────────────────────────────────────────────────────
 *
 * // Browser / Electron (client-side, with realtime events)
 * const sdk = new NGames({ gameId: 'n-craft', profileId: 'sean' });
 * await sdk.connect();
 * sdk.on('achievement_unlock', e => showBadge(e.name, e.np_reward));
 * await sdk.submitSession({ score: 4200, outcome: 'win', data: { blocks_placed: 318 } });
 * await sdk.unlockAchievement('ncraft_first_night');
 *
 * // Node.js (game server — no WebSocket needed, pass profileId per call)
 * const NGames = require('./ngames-sdk');
 * const sdk = new NGames({ gameId: 'n-craft' });
 * await sdk.submitSession({ profileId: 'sean', score: 4200, outcome: 'win' });
 * await sdk.unlockAchievement({ achievementId: 'ncraft_diamond', profileId: 'sean' });
 * await sdk.postToWall({ profileId: 'sean', content: '⛏️ Sean found diamonds!' });
 *
 * ─── Realtime events (require connect()) ────────────────────────────────────
 *
 *  sdk.on('connected',          ()  => {})  // SDK-local: WS opened
 *  sdk.on('disconnected',       ()  => {})  // SDK-local: WS dropped (auto-retrying)
 *  sdk.on('identified',         e   => {})  // { profile_id }
 *  sdk.on('presence',           e   => {})  // { profile_id, online, game_id, game_state }
 *  sdk.on('session',            e   => {})  // { profile_id, game_id, score, session_id }
 *  sdk.on('achievement_unlock', e   => {})  // { profile_id, achievement_id, name, icon, np_reward }
 *  sdk.on('challenge_complete', e   => {})  // { profile_id, challenge_id, challenge_type, title, np_reward }
 *  sdk.on('title_unlocked',     e   => {})  // { profile_id, title_id, title_text, color }
 *  sdk.on('title_equipped',     e   => {})  // { profile_id, title_id, title_text, color }
 *  sdk.on('wall_post',          e   => {})  // { post }
 *  sdk.on('reaction',           e   => {})  // { post_id, reactions }
 *  sdk.on('comment',            e   => {})  // { post_id, comment_id, profile_id, name, color, initial, content, created_at }
 *  sdk.on('message',            e   => {})  // { message }  (only delivered to the recipient)
 *  sdk.on('bet_placed',         e   => {})  // { bet_id, bettor_id, target_id, game_id, np_wager, bettor_name, target_name }
 *  sdk.on('bet_resolved',       e   => {})  // { bet_id, bettor_id, target_id, won, np_change }
 *  sdk.on('bet_expired',        e   => {})  // { bet_id, bettor_id, refund }
 *  sdk.on('season_end',         e   => {})  // { season_id, winner_id, winner_name }
 *  sdk.on('*',          (type, e)   => {})  // catch-all
 *
 * ────────────────────────────────────────────────────────────────────────────
 */

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.NGames = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ─── Constants ──────────────────────────────────────────────────────────────

  const DEFAULT_SERVER = 'https://ngames-server-production.up.railway.app';
  const PING_INTERVAL  = 60_000; // ms between presence pings
  const RETRY_BASE     = 2_000;  // initial WS reconnect delay
  const RETRY_MAX      = 30_000; // max WS reconnect delay
  const HTTP_TIMEOUT   = 10_000; // ms before an HTTP request times out
  const WS_OPEN        = 1;      // readyState OPEN — same value for browser WebSocket and the `ws` package
  const VALID_SUITS    = ['♦', '♥', '♠', '♣'];
  const IS_NODE        = typeof process !== 'undefined' && process.versions && !!process.versions.node;

  // ─── Event Emitter ──────────────────────────────────────────────────────────

  class EventEmitter {
    constructor() { this._listeners = {}; }

    /** Subscribe to an event. Use '*' to catch all events: fn(type, payload). */
    on(event, fn) {
      (this._listeners[event] || (this._listeners[event] = [])).push(fn);
      return this;
    }

    /** Remove a listener. Omit fn to remove all listeners for the event. */
    off(event, fn) {
      if (!fn) { delete this._listeners[event]; return this; }
      const arr = this._listeners[event];
      if (arr) this._listeners[event] = arr.filter(f => f !== fn);
      return this;
    }

    /** Subscribe once, then auto-remove. */
    once(event, fn) {
      const wrap = (payload) => { this.off(event, wrap); fn(payload); };
      return this.on(event, wrap);
    }

    _emit(event, data) {
      (this._listeners[event] || []).forEach(fn => {
        try { fn(data); } catch (e) { console.error(`[ngames] handler error (${event}):`, e); }
      });
      (this._listeners['*'] || []).forEach(fn => {
        try { fn(event, data); } catch {}
      });
    }
  }

  // ─── HTTP transport (auto-detects Node vs. browser) ─────────────────────────

  function httpRequest(method, baseUrl, path, body) {
    const url = baseUrl.replace(/\/$/, '') + path;

    if (!IS_NODE) {
      // Browser / Electron renderer
      const opts = { method, headers: { 'Content-Type': 'application/json' } };
      if (body) opts.body = JSON.stringify(body);
      return fetch(url, opts).then(r =>
        r.ok ? r.json()
             : r.json().then(e => Promise.reject(new Error(e.error || r.statusText)),
                             () => Promise.reject(new Error(`HTTP ${r.status}`)))
      );
    }

    // Node.js — built-in https, no dependency
    return new Promise((resolve, reject) => {
      const https  = require('https');
      const u      = new URL(url);
      const data   = body ? JSON.stringify(body) : null;
      const opts   = {
        hostname: u.hostname,
        port:     u.port || 443,
        path:     u.pathname + u.search,
        method,
        headers:  { 'Accept': 'application/json' },
        timeout:  HTTP_TIMEOUT,
      };
      if (data) {
        opts.headers['Content-Type']   = 'application/json';
        opts.headers['Content-Length'] = Buffer.byteLength(data);
      }
      const req = https.request(opts, (res) => {
        let raw = '';
        res.on('data', c => { raw += c; });
        res.on('end', () => {
          let parsed;
          try { parsed = raw ? JSON.parse(raw) : {}; } catch { return resolve(raw); }
          if (res.statusCode >= 400) reject(new Error(parsed.error || `HTTP ${res.statusCode}`));
          else resolve(parsed);
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('[ngames] request timed out')); });
      if (data) req.write(data);
      req.end();
    });
  }

  // ─── NGames SDK ─────────────────────────────────────────────────────────────

  class NGames extends EventEmitter {

    /**
     * @param {object}  opts
     * @param {string}  opts.gameId        — Your game's ID (e.g. 'n-craft'). Must match
     *                                       the id you register server-side (see README).
     * @param {string}  [opts.profileId]   — Active player's profile ID. Set it here for
     *                                       client-side games; pass per-call on a server.
     * @param {string}  [opts.server]      — Override the server base URL.
     * @param {boolean} [opts.autoConnect] — Open the WebSocket on construction.
     *                                       Default: true in a browser when profileId is set.
     */
    constructor(opts = {}) {
      super();
      if (!opts.gameId) throw new Error('[ngames] gameId is required');

      this._gameId    = opts.gameId;
      this._profileId = opts.profileId || null;
      this._base      = (opts.server || DEFAULT_SERVER).replace(/\/$/, '');
      this._wsUrl     = this._base.replace(/^http/, 'ws');

      this._ws        = null;
      this._wsRetry   = RETRY_BASE;
      this._wsTimer   = null;
      this._pingTimer = null;
      this._gameState = {};
      this._destroyed = false;

      const autoConnect = opts.autoConnect ?? (!IS_NODE && !!this._profileId);
      if (autoConnect) this.connect().catch(e => console.warn('[ngames] auto-connect failed:', e.message));
    }

    // ── Getters ──────────────────────────────────────────────────────────────

    get gameId()    { return this._gameId; }
    get profileId() { return this._profileId; }
    get server()    { return this._base; }
    get connected() { return !!(this._ws && this._ws.readyState === WS_OPEN); }

    // ── Internal helpers ───────────────────────────────────────────────────────

    _post(path, body) { return httpRequest('POST', this._base, path, body); }
    _get(path)        { return httpRequest('GET',  this._base, path, null); }

    /** Resolve a profileId from a string, an object's profileId, or the SDK default. */
    _pid(override) {
      const id = typeof override === 'string'
        ? override
        : (override && override.profileId) || this._profileId;
      if (!id) throw new Error('[ngames] profileId required — set it on the constructor or pass it per call');
      return id;
    }

    _wsSend(msg) {
      if (this.connected) this._ws.send(JSON.stringify(msg));
    }

    // ── Connection ─────────────────────────────────────────────────────────────

    /**
     * Open the WebSocket and start the presence heartbeat.
     * Required only for realtime events; pure REST calls work without it.
     * @returns {Promise<this>}
     */
    connect() {
      if (this._destroyed) return Promise.resolve(this);
      return new Promise((resolve) => {
        const WS = IS_NODE ? require('ws') : WebSocket;
        this._ws = new WS(this._wsUrl);
        let settled = false;
        const done = () => { if (!settled) { settled = true; resolve(this); } };

        const onOpen = () => {
          this._wsRetry = RETRY_BASE;
          clearTimeout(this._wsTimer);
          if (this._profileId) this._wsSend({ type: 'identify', profile_id: this._profileId });
          this._startPingLoop();
          this._emit('connected', {});
          done();
        };
        const onMessage = (ev) => {
          try {
            const raw = IS_NODE ? ev.toString() : ev.data;
            const msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString());
            if (msg.type === 'pong') return;
            this._emit(msg.type, msg);
          } catch {}
        };
        const onClose = () => {
          clearInterval(this._pingTimer);
          this._pingTimer = null;
          this._emit('disconnected', {});
          if (!this._destroyed) {
            this._wsTimer = setTimeout(() => {
              this._wsRetry = Math.min(this._wsRetry * 2, RETRY_MAX);
              this.connect();
            }, this._wsRetry);
          }
          done();
        };

        if (IS_NODE) {
          this._ws.on('open', onOpen);
          this._ws.on('message', onMessage);
          this._ws.on('close', onClose);
          this._ws.on('error', () => {}); // 'close' fires after 'error'
        } else {
          this._ws.addEventListener('open', onOpen);
          this._ws.addEventListener('message', onMessage);
          this._ws.addEventListener('close', onClose);
          this._ws.addEventListener('error', () => {});
        }
      });
    }

    /**
     * Disconnect, mark this profile offline, and stop all timers.
     * Create a fresh instance to reconnect afterwards.
     */
    disconnect() {
      this._destroyed = true;
      clearTimeout(this._wsTimer);
      clearInterval(this._pingTimer);
      if (this._profileId) {
        this._post('/presence/offline', { profile_id: this._profileId }).catch(() => {});
      }
      if (this._ws) this._ws.close();
    }

    /**
     * Set / change the active player after construction (e.g. after login).
     * @param {string} profileId
     * @param {object} [gameState] — initial presence state
     */
    setPlayer(profileId, gameState = {}) {
      this._profileId = profileId;
      this._gameState = gameState;
      if (this.connected) {
        this._wsSend({ type: 'identify', profile_id: profileId });
        this._doPing();
      }
    }

    _startPingLoop() {
      clearInterval(this._pingTimer);
      this._doPing();
      this._pingTimer = setInterval(() => this._doPing(), PING_INTERVAL);
    }

    _doPing() {
      if (!this._profileId) return;
      this._post('/presence/ping', {
        profile_id: this._profileId,
        game_id:    this._gameId,
        game_state: this._gameState,
      }).catch(() => {});
    }

    // ── Sessions ───────────────────────────────────────────────────────────────

    /**
     * Submit a completed game session. The server awards NP (10 + score/100),
     * recomputes the player's level, advances daily/weekly challenges, checks
     * level/achievement titles, resolves any open bets targeting this player,
     * and broadcasts a 'session' event.
     *
     * IMPORTANT shapes (verified against the server):
     *  - Only `score`, `outcome`, and `game_mode` are first-class. ALL other
     *    game-specific stats must go in `data` (a free-form object). Any extra
     *    top-level keys you pass are folded into `data` for you.
     *  - Pass `outcome: 'win'` to count a win (also resolves bets in your favor);
     *    `outcome: 'bust'` resolves bets against you. Anything else is neutral.
     *  - The server reads these `data` keys: `data.kills`, `data.cases_opened`,
     *    `data.playtime` (challenge progress) and `data.kills`, `data.time`
     *    (lower = better), `data.streak` (records leaderboard). Put your own
     *    stats here too — they're stored and returned with the session.
     *
     * @param {object}  opts
     * @param {number}  opts.score          — Final score (required)
     * @param {string}  [opts.profileId]    — Override active player (server-side use)
     * @param {string}  [opts.outcome]      — 'win' | 'bust' | anything else (neutral)
     * @param {string}  [opts.gameMode]     — e.g. 'survival', 'creative', 'pvp'
     * @param {object}  [opts.data]         — Free-form game stats (kills, time, streak, …)
     * @param {*}       [opts.<other>]      — Any extra keys are merged into `data`
     * @returns {Promise<{ ok: boolean, session_id: number, np_gained: number }>}
     */
    submitSession({ profileId, score, outcome, gameMode, game_mode, data = {}, ...rest } = {}) {
      if (score == null) throw new Error('[ngames] submitSession: score is required');
      return this._post('/sessions', {
        profile_id: this._pid(profileId),
        game_id:    this._gameId,
        score,
        outcome:    outcome || null,
        game_mode:  gameMode || game_mode || null,
        data:       { ...data, ...rest },
      });
    }

    /**
     * Get a player's recent session history (most recent 100).
     * @param {string} [profileId] — Defaults to the active player
     * @returns {Promise<Session[]>}
     */
    getSessionHistory(profileId) {
      return this._get(`/sessions/${this._pid(profileId)}`);
    }

    // ── Achievements ───────────────────────────────────────────────────────────

    /**
     * Fully unlock an achievement for a player (idempotent — re-calling a
     * already-unlocked achievement is a no-op and awards nothing again).
     *
     * NOTE: the achievement must be registered server-side (see README) or this
     * silently does nothing — `unlocked` comes back false for both
     * "already had it" and "no such achievement".
     *
     * @param {string|object} achievement
     *   string  → the achievement ID
     *   object  → { achievementId: string, profileId?: string }
     * @returns {Promise<{ ok: boolean, unlocked: boolean, achievement: object|null }>}
     */
    unlockAchievement(achievement) {
      const id        = typeof achievement === 'string' ? achievement : achievement.achievementId;
      const profileId = typeof achievement === 'object' ? achievement.profileId : undefined;
      if (!id) throw new Error('[ngames] unlockAchievement: achievementId is required');
      return this._post('/achievements/unlock', {
        profile_id:     this._pid(profileId),
        achievement_id: id,
      });
    }

    /**
     * Add incremental progress toward an achievement. When cumulative progress
     * reaches the achievement's `goal`, it auto-unlocks (and awards NP once).
     *
     * @param {string|object} achievement
     *   string  → achievement ID (pass the delta as the 2nd arg)
     *   object  → { achievementId: string, value: number, profileId?: string }
     * @param {number} [value=1] — Progress delta to add (when 1st arg is a string)
     * @returns {Promise<{ ok: boolean }>}
     *
     * @example
     * await sdk.addAchievementProgress('ncraft_mine_1000', 25); // +25 blocks mined
     */
    addAchievementProgress(achievement, value = 1) {
      const id        = typeof achievement === 'string' ? achievement : achievement.achievementId;
      const profileId = typeof achievement === 'object' ? achievement.profileId : undefined;
      const delta     = typeof achievement === 'object' ? (achievement.value ?? 1) : value;
      if (!id) throw new Error('[ngames] addAchievementProgress: achievementId is required');
      return this._post('/achievements/progress', {
        profile_id:     this._pid(profileId),
        achievement_id: id,
        value:          delta,
      });
    }

    /**
     * Get every achievement and this player's progress/unlock status.
     * Each row: { id, game_id, game_mode, name, description, icon, np_reward,
     *             goal, secret, progress, unlocked, unlocked_at }.
     * @param {string} [profileId] — Defaults to the active player
     * @returns {Promise<Achievement[]>}
     */
    getAchievements(profileId) {
      return this._get(`/achievements/${this._pid(profileId)}`);
    }

    // ── Wall ─────────────────────────────────────────────────────────────────

    /**
     * Post to the crew wall (broadcasts a 'wall_post' event). Content is
     * truncated server-side to 500 chars.
     * @param {string|object} content  string, or { content, profileId? }
     * @returns {Promise<{ ok: boolean, post_id: number }>}
     */
    postToWall(content) {
      const text      = typeof content === 'string' ? content : content.content;
      const profileId = typeof content === 'object' ? content.profileId : undefined;
      if (!text) throw new Error('[ngames] postToWall: content is required');
      return this._post('/wall/post', {
        profile_id: this._pid(profileId),
        game_id:    this._gameId,
        content:    text,
      });
    }

    /**
     * Get the latest wall posts (server returns up to 50, newest first).
     * @returns {Promise<WallPost[]>}
     */
    getWall() {
      return this._get('/wall');
    }

    /**
     * Toggle a card-suit reaction on a post (adds if absent, removes if present).
     * @param {number} postId
     * @param {'♦'|'♥'|'♠'|'♣'} suit
     * @returns {Promise<{ ok: boolean, reactions: object }>}
     */
    reactToPost(postId, suit) {
      if (!VALID_SUITS.includes(suit)) {
        throw new Error(`[ngames] reactToPost: suit must be one of ${VALID_SUITS.join(' ')}`);
      }
      return this._post(`/wall/${postId}/react`, { profile_id: this._pid(), suit });
    }

    /**
     * Comment on a post (truncated server-side to 200 chars).
     * @param {number} postId
     * @param {string} comment
     * @returns {Promise<{ ok: boolean, comment_id: number }>}
     */
    commentOnPost(postId, comment) {
      return this._post(`/wall/${postId}/comment`, { profile_id: this._pid(), content: comment });
    }

    /**
     * Get the comments on a post (oldest first).
     * @param {number} postId
     * @returns {Promise<Comment[]>}
     */
    getComments(postId) {
      return this._get(`/wall/${postId}/comments`);
    }

    // ── Profiles & stats ───────────────────────────────────────────────────────

    /**
     * Get a player's full profile — name, color, suit, np, level, casino_balance,
     * game_stats.
     * @param {string} [profileId] — Defaults to the active player
     * @returns {Promise<Profile>}
     */
    getProfile(profileId) {
      return this._get(`/profiles/${this._pid(profileId)}`);
    }

    /** Get every crew profile. @returns {Promise<Profile[]>} */
    getProfiles() {
      return this._get('/profiles');
    }

    /**
     * Get aggregated stats for a player:
     * { profile_id, total_sessions, total_wins, total_np, level, title,
     *   by_game: { [gameId]: { sessions, wins, best_score, win_rate, favorite_mode } } }.
     * @param {string} [profileId] — Defaults to the active player
     * @returns {Promise<Stats>}
     */
    getStats(profileId) {
      return this._get(`/stats/${this._pid(profileId)}`);
    }

    // ── Leaderboard & records ────────────────────────────────────────────────

    /**
     * Get the score leaderboard (server returns the top 50 by score; the cap is
     * fixed server-side and not adjustable).
     * @param {object} [opts]
     * @param {string} [opts.gameId] — Filter to a game (defaults to this SDK's gameId).
     *                                 Pass null to get every game's sessions.
     * @returns {Promise<LeaderboardEntry[]>}
     */
    getLeaderboard({ gameId } = {}) {
      const game = gameId === null ? null : (gameId || this._gameId);
      const qs   = game ? `?game=${encodeURIComponent(game)}` : '';
      return this._get(`/sessions/leaderboard${qs}`);
    }

    /**
     * Get all-time records. The server returns a map keyed by game_id, each with
     * { best_score, most_kills, fastest_run, longest_streak } (any may be absent).
     * @param {string} [gameId] — If given, returns just that game's record block
     *                            (indexed client-side); otherwise the full map.
     * @returns {Promise<object>}
     */
    getRecords(gameId) {
      return this._get('/leaderboard/records').then(all =>
        gameId ? (all && all[gameId]) || {} : all
      );
    }

    // ── Challenges ─────────────────────────────────────────────────────────────

    /**
     * Get the active daily and weekly challenges. Each side is a single challenge
     * object (with an added `expires_in` in seconds) or null.
     * @returns {Promise<{ daily: Challenge|null, weekly: Challenge|null }>}
     */
    getChallenges() {
      return this._get('/challenges/active');
    }

    /**
     * Get a player's progress on the active challenges. Returns an object keyed
     * by type: { daily: { challenge, my_progress, my_completed, crew_progress },
     *            weekly: {...} }.
     * @param {string} [profileId] — Defaults to the active player
     * @returns {Promise<object>}
     */
    getChallengeProgress(profileId) {
      return this._get(`/challenges/progress/${this._pid(profileId)}`);
    }

    // ── Seasons ────────────────────────────────────────────────────────────────

    /**
     * Get the current season with standings:
     * { id, name, started_at, ends_at, days_remaining, leaderboard: [...] }
     * or null if there is no active season.
     * @returns {Promise<Season|null>}
     */
    getCurrentSeason() {
      return this._get('/seasons/current');
    }

    /**
     * Get finished seasons (each with its winning profile).
     * @returns {Promise<Season[]>}
     */
    getSeasonHistory() {
      return this._get('/seasons/history');
    }

    // ── Presence ───────────────────────────────────────────────────────────────

    /**
     * Get who's online and what they're playing.
     * @returns {Promise<PresenceEntry[]>}
     */
    getCrewStatus() {
      return this._get('/presence');
    }

    /**
     * Push a presence/state update immediately (presence is also pushed
     * automatically every 60s while connected). Merges into the current state.
     * @param {object} [state] — Game state to broadcast (level, position, mode, …)
     * @returns {Promise<{ ok: boolean }>}
     */
    ping(state = {}) {
      Object.assign(this._gameState, state);
      return this._post('/presence/ping', {
        profile_id: this._pid(),
        game_id:    this._gameId,
        game_state: this._gameState,
      });
    }

    // ── Bets ───────────────────────────────────────────────────────────────────

    /**
     * Place an NP wager that a crew member will win their next session in a game.
     * The wager is deducted immediately; a win pays 2×. Wager must be 1–500 NP
     * and you cannot bet on yourself. Resolves automatically when the target's
     * next session lands with outcome 'win' (you win) or 'bust' (you lose).
     *
     * @param {object} opts
     * @param {string} opts.targetId   — Profile ID you're betting on
     * @param {number} opts.wager      — NP to wager (1–500)
     * @param {string} [opts.gameMode] — Optional mode context
     * @param {string} [opts.gameId]   — Game context (defaults to this SDK's gameId)
     * @returns {Promise<{ ok: boolean, bet_id: number }>}
     */
    placeBet({ targetId, wager, gameMode, gameId } = {}) {
      if (!targetId)            throw new Error('[ngames] placeBet: targetId is required');
      if (wager == null)        throw new Error('[ngames] placeBet: wager is required');
      if (wager < 1 || wager > 500) throw new Error('[ngames] placeBet: wager must be between 1 and 500 NP');
      return this._post('/bets', {
        bettor_id: this._pid(),
        target_id: targetId,
        np_wager:  wager,
        game_mode: gameMode || null,
        game_id:   gameId || this._gameId,
      });
    }

    /**
     * Get bets. With a profileId → all bets involving that player; without →
     * all currently open bets.
     * @param {string} [profileId]
     * @returns {Promise<Bet[]>}
     */
    getBets(profileId) {
      return profileId ? this._get(`/bets/${profileId}`) : this._get('/bets/open');
    }

    /** Get all currently open bets. @returns {Promise<Bet[]>} */
    getOpenBets() {
      return this._get('/bets/open');
    }

    // ── Messages ─────────────────────────────────────────────────────────────

    /**
     * DM another crew member (delivered live via a 'message' event to the
     * recipient; truncated to 1000 chars).
     * @param {string} toProfileId
     * @param {string} content
     * @returns {Promise<{ ok: boolean, message_id: number }>}
     */
    sendMessage(toProfileId, content) {
      return this._post('/messages', { from_id: this._pid(), to_id: toProfileId, content });
    }

    /**
     * Get the DM thread with another crew member (most recent 200, oldest first).
     * @param {string} otherProfileId
     * @returns {Promise<Message[]>}
     */
    getMessages(otherProfileId) {
      return this._get(`/messages/${this._pid()}/${otherProfileId}`);
    }

    /**
     * Mark all messages from a given sender as read.
     * @param {string} fromProfileId
     * @returns {Promise<{ ok: boolean }>}
     */
    markRead(fromProfileId) {
      return this._post('/messages/read', { reader_id: this._pid(), from_id: fromProfileId });
    }

    /**
     * Get unread message counts grouped by sender: [{ from_id, count }].
     * @param {string} [profileId] — Defaults to the active player
     * @returns {Promise<Array<{ from_id: string, count: number }>>}
     */
    getUnread(profileId) {
      return this._get(`/messages/unread/${this._pid(profileId)}`);
    }

    // ── Crew, games & titles ───────────────────────────────────────────────────

    /**
     * Get the crew definition: [{ id, name, color, suit, initial }].
     * @returns {Promise<CrewMember[]>}
     */
    getCrew() {
      return this._get('/crew');
    }

    /**
     * Get all visible games (hidden games are filtered out server-side).
     * @returns {Promise<Game[]>}
     */
    getGames() {
      return this._get('/games');
    }

    /**
     * Get a single game by id (returns hidden games too).
     * @param {string} [gameId] — Defaults to this SDK's gameId
     * @returns {Promise<Game>}
     */
    getGame(gameId) {
      return this._get(`/games/${gameId || this._gameId}`);
    }

    /**
     * Get the titles a player has UNLOCKED (each with `equipped` 0/1).
     * @param {string} [profileId] — Defaults to the active player
     * @returns {Promise<Title[]>}
     */
    getTitles(profileId) {
      return this._get(`/titles/${this._pid(profileId)}`);
    }

    /**
     * Equip one of the player's unlocked titles (unequips the rest).
     * @param {string} titleId
     * @returns {Promise<{ ok: boolean }>}
     */
    equipTitle(titleId) {
      return this._post('/titles/equip', { profile_id: this._pid(), title_id: titleId });
    }
  }

  return NGames;
}));
