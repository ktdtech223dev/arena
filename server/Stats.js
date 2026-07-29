// ARENA server — Stats.js: persistent per-profile stats (kills / deaths / wins /
// best streak / playtime / accolade counts / per-weapon kills). Keyed by the
// client profile id (see src/core/Profile.js) and persisted as one JSON file per
// profile under DATA_DIR/stats (same volume as progress + custom maps).
// Writes are debounced: dirty profiles flush every FLUSH_MS and on demand.
import path from 'node:path';
import { promises as fs, mkdirSync } from 'node:fs';

const FLUSH_MS = 20000;

const EMPTY = () => ({ kills: 0, deaths: 0, wins: 0, bestStreak: 0, playMs: 0, accolades: {}, weaponKills: {} });

export class StatsStore {
  constructor(dir) {
    this.dir = dir;
    mkdirSync(dir, { recursive: true });
    this.cache = new Map();   // id -> stats object (live, mutated in place)
    this._dirty = new Set();
    this._timer = setInterval(() => this.flush(), FLUSH_MS);
    if (this._timer.unref) this._timer.unref();
  }

  _file(id) { return path.join(this.dir, `${id}.json`); }

  async get(id) {
    if (!id) return EMPTY();
    let s = this.cache.get(id);
    if (s) return s;
    try { s = { ...EMPTY(), ...JSON.parse(await fs.readFile(this._file(id), 'utf8')) }; }
    catch { s = EMPTY(); }
    this.cache.set(id, s);
    return s;
  }

  /** Mutate a profile's stats via fn(stats) and mark it dirty. Fire-and-forget. */
  bump(id, fn) {
    if (!id) return;
    this.get(id).then((s) => { try { fn(s); this._dirty.add(id); } catch { /* never throw into the sim */ } });
  }

  async flush() {
    const ids = [...this._dirty];
    this._dirty.clear();
    for (const id of ids) {
      const s = this.cache.get(id);
      if (!s) continue;
      const file = this._file(id);
      try {
        await fs.writeFile(`${file}.tmp`, JSON.stringify(s));
        await fs.rename(`${file}.tmp`, file);
      } catch { this._dirty.add(id); /* retry next flush */ }
    }
  }
}
