// ARENA map DATA — FOUNDRY (the TOWER DEFENSE arena; THREE-free, shared with the
// server). A dusk-canyon plateau: the horde streams the lane from the PORTAL
// (west) to the CORE tower (east); buildable ground flanks the lane; the ARMORY
// pad (E = weapon shop) sits near the crew spawns. Flagged `td: true` so it is
// EXCLUDED from the arena map picker + ammo scatter — you reach it by switching
// the lobby mode to TOWER DEFENSE. Visuals: src/world/maps/Foundry.js.
import { box, spawn, normalizeMap } from '../mapkit.js';
import { TD_CORE, TD_ARMORY } from '../tddata.js';

const S = 62; // plateau half-extent

export const data = normalizeMap({
  id: 'foundry', name: 'Foundry', td: true,
  theme: { name: 'Tower Defense', accent: 0x9fe86a, mood: 0x1a1410 },
  solids: [
    // ground plateau
    box(-S, -1, -S, S, 0, S),
    // rim walls (bounds; wall-runnable for fun repositioning during waves)
    box(-S, 0, -S - 2, S, 9, -S, { wallrun: true }),
    box(-S, 0, S, S, 9, S + 2, { wallrun: true }),
    box(-S - 2, 0, -S, -S, 9, S, { wallrun: true }),
    box(S, 0, -S, S + 2, 9, S, { wallrun: true }),
    // portal frame block (west)
    box(-49.4, 0, -37.2, -48.4, 7, -30.8),
    // core tower base + shaft
    box(TD_CORE.x - 3, 0, TD_CORE.z - 3, TD_CORE.x + 3, 1.2, TD_CORE.z + 3),
    box(TD_CORE.x - 1.6, 1.2, TD_CORE.z - 1.6, TD_CORE.x + 1.6, 8, TD_CORE.z + 1.6),
    // armory pad (slightly raised so it reads)
    box(TD_ARMORY.x - 2.2, 0, TD_ARMORY.z - 2.2, TD_ARMORY.x + 2.2, 0.35, TD_ARMORY.z + 2.2),
    // scattered rocks/cover off-lane (jump/wallplay while holding the line)
    box(-42.4, 0, 7.6, -37.6, 2.2, 12.4), box(-24, 0, -25.8, -20, 1.8, -22.2),
    box(1.8, 0, 11.9, 6.2, 2.1, 16.1), box(23.3, 0, -16.6, 28.7, 2.5, -11.4),
    box(32.2, 0, 8.3, 35.8, 1.6, 11.7), box(-4.1, 0, 31.9, 0.1, 2, 36.1),
    box(-36.4, 0, 29.8, -31.6, 2.2, 34.2), box(41.9, 0, -32, 46.1, 1.9, -28),
  ],
  ramps: [],
  spawns: [
    // crew spawns cluster near the armory/core end, facing the lane
    spawn(30, 0, 24, 250), spawn(34, 0, 28, 250), spawn(26, 0, 20, 270),
    spawn(38, 0, 24, 240), spawn(30, 0, 30, 250), spawn(24, 0, 26, 260),
  ],
  barrels: [], hazards: [], doors: [], destructibles: [], foliage: [], props: [],
});
