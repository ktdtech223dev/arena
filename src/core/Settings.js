// Persisted settings (localStorage). Dot-path get/set with change listeners.
// Canonical keys are listed in src/ARCHITECTURE.md §8.
const STORAGE_KEY = 'range.settings.v1';

const DEFAULTS = {
  sens: 2.5,          // mouse sensitivity, CS-style (deg/count = 0.022 * sens)
  adsSensMult: 0.8,   // extra multiplier while ADS
  fov: 100,           // base world-camera FOV (deg, vertical is derived by camera)
  volMaster: 0.8,
  volSfx: 1.0,
  viewBob: true,
  damageNumbers: true,
  bestLap: null,      // seconds, movement course best time
  crosshair: {},      // per-gun crosshair configs, keyed by gun id
};

function deepMerge(base, over) {
  if (over === null || typeof over !== 'object' || Array.isArray(over)) return over;
  const out = { ...base };
  for (const k of Object.keys(over)) {
    out[k] = (base && typeof base[k] === 'object' && !Array.isArray(base[k]) && base[k] !== null)
      ? deepMerge(base[k], over[k])
      : over[k];
  }
  return out;
}

export class Settings {
  constructor() {
    this.data = structuredClone(DEFAULTS);
    this._listeners = new Map(); // path -> Set<fn>
    this._saveTimer = 0;
    this._cloudTimer = 0;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) this.data = deepMerge(this.data, JSON.parse(raw));
    } catch (err) {
      console.warn('[settings] failed to load, using defaults:', err);
    }

    // Cloud sync (server-side persistent volume) — makes progress survive
    // across devices/redeploys when RANGE is embedded in N Games. Player id
    // comes from ?player=<id> (N Games passes it) or a generated local id.
    this.playerId = this._resolvePlayerId();
    this.cloudSynced = false;
    this._initCloud();
  }

  _resolvePlayerId() {
    try {
      const q = new URLSearchParams(location.search).get('player');
      if (q) return q.slice(0, 64);
      let id = localStorage.getItem('range.playerId');
      if (!id) {
        id = (crypto?.randomUUID?.() ||
          'p' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2));
        localStorage.setItem('range.playerId', id);
      }
      return id;
    } catch {
      return 'local';
    }
  }

  // Pull server progress on boot and merge it over local (server wins), then
  // notify listeners so anything already built picks up the loaded values.
  async _initCloud() {
    try {
      const res = await fetch(`/api/progress?player=${encodeURIComponent(this.playerId)}`, { cache: 'no-store' });
      if (!res.ok) return;
      const server = await res.json();
      if (server && typeof server === 'object' && Object.keys(server).length) {
        this.data = deepMerge(this.data, server);
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data)); } catch {}
        this._fire('*', undefined, 'cloud:loaded');
      }
      this.cloudSynced = true;
    } catch {
      // no server API (e.g. vite dev) or offline — stay local, never throw
    }
  }

  _pushCloud() {
    clearTimeout(this._cloudTimer);
    this._cloudTimer = setTimeout(() => {
      try {
        fetch(`/api/progress?player=${encodeURIComponent(this.playerId)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this.data),
          keepalive: true,
        }).catch(() => {});
      } catch { /* ignore */ }
    }, 800);
  }

  get(path, fallback) {
    let node = this.data;
    for (const part of path.split('.')) {
      if (node === null || node === undefined) return fallback;
      node = node[part];
    }
    return node === undefined ? fallback : node;
  }

  set(path, value) {
    const parts = path.split('.');
    let node = this.data;
    for (let i = 0; i < parts.length - 1; i++) {
      if (typeof node[parts[i]] !== 'object' || node[parts[i]] === null) node[parts[i]] = {};
      node = node[parts[i]];
    }
    node[parts[parts.length - 1]] = value;
    this._save();
    // fire listeners for the exact path, every prefix, and '*'
    for (let i = parts.length; i >= 1; i--) {
      this._fire(parts.slice(0, i).join('.'), value, path);
    }
    this._fire('*', value, path);
  }

  onChange(path, fn) {
    let set = this._listeners.get(path);
    if (!set) this._listeners.set(path, (set = new Set()));
    set.add(fn);
    return () => set.delete(fn);
  }

  _fire(key, value, fullPath) {
    const set = this._listeners.get(key);
    if (!set) return;
    for (const fn of [...set]) {
      try { fn(value, fullPath); } catch (err) { console.error('[settings] listener error:', err); }
    }
  }

  _save() {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
      } catch (err) {
        console.warn('[settings] save failed:', err);
      }
    }, 250);
    this._pushCloud(); // mirror to the server-side persistent volume
  }
}
