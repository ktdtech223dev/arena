// TOWER DEFENSE — tdWeaponMods.js: apply a player's TD gun-tree HANDLING mods
// to the live weapon defs (rpm / mag / reload speed / spread). Damage mults are
// SERVER-side (TdSim.dmgMult) — this module only shapes feel. Every touched
// field is backed up on first touch and restored by revertAll() when the crew
// leaves TD, so the arena/range keep their authored stats.
import { WEAPONS } from '../weapons/weapons-data.js';
import { WEAPON_TREES } from '../../shared/tddata.js';

const _backup = new Map(); // defId -> { rpm, mag, spreadBase, reloadTs:[...] }

function backup(def) {
  if (_backup.has(def.id)) return;
  _backup.set(def.id, {
    rpm: def.rpm, mag: def.mag,
    spreadBase: def.spread?.base,
    reloadTs: (def.reload?.phases || []).map((p) => p.t),
    emptyTs: (def.reload?.emptyPhases || []).map((p) => p.t),
  });
}

function restore(def) {
  const b = _backup.get(def.id);
  if (!b) return;
  def.rpm = b.rpm; def.mag = b.mag;
  if (def.spread && b.spreadBase != null) def.spread.base = b.spreadBase;
  (def.reload?.phases || []).forEach((p, i) => { if (b.reloadTs[i] != null) p.t = b.reloadTs[i]; });
  (def.reload?.emptyPhases || []).forEach((p, i) => { if (b.emptyTs[i] != null) p.t = b.emptyTs[i]; });
}

/** Apply the kit's purchased tiers to the live defs (idempotent per kit). */
export function applyKit(kit) {
  revertAll();
  if (!kit?.tiers) return;
  for (const [gunId, tiers] of Object.entries(kit.tiers)) {
    const def = WEAPONS.find((d) => d.id === gunId);
    const tree = WEAPON_TREES[gunId];
    if (!def || !tree) continue;
    let rpm = 1, mag = 1, spread = 1, reload = 1;
    for (let p = 0; p < tree.paths.length; p++) for (let t = 0; t < (tiers[p] | 0); t++) {
      const mod = tree.paths[p][t]?.mod || {};
      if (mod.rpmMult) rpm *= mod.rpmMult;
      if (mod.magMult) mag *= mod.magMult;
      if (mod.spreadMult) spread *= mod.spreadMult;
      if (mod.reloadMult) reload *= mod.reloadMult;
    }
    if (rpm === 1 && mag === 1 && spread === 1 && reload === 1) continue;
    backup(def);
    const b = _backup.get(def.id);
    def.rpm = Math.round(b.rpm * rpm);
    def.mag = Math.round(b.mag * mag);
    if (def.spread && b.spreadBase != null) def.spread.base = b.spreadBase * spread;
    (def.reload?.phases || []).forEach((p, i) => { p.t = (b.reloadTs[i] ?? p.t) * reload; });
    (def.reload?.emptyPhases || []).forEach((p, i) => { p.t = (b.emptyTs[i] ?? p.t) * reload; });
  }
}

/** Restore every touched def to its authored values (leaving TD). */
export function revertAll() {
  for (const def of WEAPONS) restore(def);
}
