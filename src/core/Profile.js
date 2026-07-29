// N GAMES profile + stats (client side).
// A PROFILE is a lightweight local identity (id + display name) persisted in
// localStorage and sent with every arena join — the server keys persistent STATS
// (kills/deaths/wins/streaks/accolades/per-weapon kills) by this id, and the map
// editor stamps `author` from it. No accounts, no auth — crew-scale trust.
//
// CAMO progression: per-weapon kill counts unlock camo TIERS (a material tint the
// viewmodel applies on equip). Thresholds tuned for crew-night pace.

const KEY = 'ngames.profile.v1';

const ADJ = ['NEON', 'TURBO', 'PRIME', 'SOLAR', 'VIVID', 'HYPER', 'DELTA', 'NOVA'];
const NOUN = ['VIPER', 'FALCON', 'SPECTRE', 'RONIN', 'RAPTOR', 'PHANTOM', 'COMET', 'WOLF'];

let _profile = null;

export function getProfile() {
  if (_profile) return _profile;
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(KEY)); } catch { /* fresh */ }
  if (!raw || !raw.id) {
    raw = {
      id: 'p_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4),
      name: ADJ[(Math.random() * ADJ.length) | 0] + ' ' + NOUN[(Math.random() * NOUN.length) | 0],
    };
    try { localStorage.setItem(KEY, JSON.stringify(raw)); } catch { /* private mode */ }
  }
  _profile = {
    id: raw.id,
    name: raw.name,
    save() { try { localStorage.setItem(KEY, JSON.stringify({ id: this.id, name: this.name })); } catch { /* ignore */ } },
  };
  return _profile;
}

const EMPTY_STATS = () => ({ kills: 0, deaths: 0, wins: 0, bestStreak: 0, playMs: 0, accolades: {}, weaponKills: {} });

// Server-first stats (the server owns the truth; localStorage caches the last
// fetch so the menu still renders offline / in dev where /api isn't served).
export async function getStats() {
  const prof = getProfile();
  const cacheKey = 'ngames.stats.cache.' + prof.id;
  try {
    const r = await fetch('/api/stats?player=' + encodeURIComponent(prof.id), { cache: 'no-store' });
    if (r.ok) {
      const s = { ...EMPTY_STATS(), ...(await r.json()) };
      try { localStorage.setItem(cacheKey, JSON.stringify(s)); } catch { /* ignore */ }
      return s;
    }
  } catch { /* offline/dev */ }
  try { return { ...EMPTY_STATS(), ...(JSON.parse(localStorage.getItem(cacheKey)) || {}) }; } catch { return EMPTY_STATS(); }
}

// ---- camo tiers (per-weapon kill thresholds) --------------------------------
export const CAMO_TIERS = [
  { name: 'STOCK',    kills: 0,   css: '#8fa6bb', tint: null },
  { name: 'IRON',     kills: 25,  css: '#b9c2cc', tint: 0x8a939e },
  { name: 'JADE',     kills: 75,  css: '#51e898', tint: 0x2e8a5c },
  { name: 'AMETHYST', kills: 150, css: '#c9a2ff', tint: 0x7a4fd0 },
  { name: 'GOLD',     kills: 300, css: '#ffd166', tint: 0xc9962a },
  { name: 'PRISM',    kills: 500, css: '#7df9ff', tint: 0x18b6d8 },
];

export function camoForKills(kills) {
  let best = CAMO_TIERS[0];
  for (const t of CAMO_TIERS) if ((kills | 0) >= t.kills) best = t;
  return best;
}
