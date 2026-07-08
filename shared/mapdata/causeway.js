// ARENA map DATA — CAUSEWAY (collider/spawn/mechanic truth; THREE-free, shared
// with the server). Visuals live in src/world/maps/Causeway.js (full contract there).
// Long sea-bridge: a central roadway deck running the Z axis with LOW flank
// catwalks either side and arch-pylons breaking the lane; the sea is the boundary
// (fall off the sides = water kill-plane), towers cap the ends. Footprint x±11,
// z±33, height y0(flanks)→9(pylon tops/perches). Long axis = Z.
import { V, box, spawn, normalizeMap } from '../mapkit.js';

// an arch pylon straddling the deck at z: two wall-runnable legs + a top beam
const pylon = (z) => [
  box(-6.2, 3, z - 0.5, -5, 9, z + 0.5, { wallrun: true }),
  box(5, 3, z - 0.5, 6.2, 9, z + 0.5, { wallrun: true }),
  box(-6.2, 8.4, z - 0.5, 6.2, 9, z + 0.5),
];

export const data = normalizeMap({
  id: 'causeway', name: 'Causeway',
  theme: { name: 'Storm Bridge', accent: 0xffb14a, mood: 0x0e1c22 },
  solids: [
    box(-40, -14, -40, 40, -13, 40),                       // sea bed catch floor (below the water)
    // main roadway deck (mid tier, y3) — split by a central GAP crossed by the ferry platform
    box(-5, 2.4, -30, 5, 3, -2),
    box(-5, 2.4, 2, 5, 3, 30),
    // low flank catwalks (low tier, y0) — the flanking routes, 1 m gap in from the deck edge
    box(-10.5, -0.4, -30, -6, 0, 30),
    box(6, -0.4, -30, 10.5, 0, 30),
    // arch pylons (cover + wall-run legs + top-beam perch at y9), offset so no spawn lane is clean
    ...pylon(-20), ...pylon(-8), ...pylon(4), ...pylon(16),
    // end towers = the Z-axis boundary + backdrop; inner faces wall-runnable
    box(-11, -0.4, -34, 11, 15, -30, { wallrun: true }),   // north tower wall
    box(-11, -0.4, 30, 11, 15, 34, { wallrun: true }),     // south tower wall
    box(-7, 8.6, -33, 7, 9, -30),                          // north top perch (y9, over deck end)
    box(-7, 8.6, 30, 7, 9, 33),                            // south top perch
  ],
  ramps: [
    // flank(y0) → deck(y3) connectors (1.5 m wide, climb along Z)
    { min: V(-6.5, 0, -26), max: V(-5, 3, -20), axis: 'z', h0: 0, h1: 3 },
    { min: V(5, 0, 20), max: V(6.5, 3, 26), axis: 'z', h0: 0, h1: 3 },
    { min: V(-6.5, 0, 8), max: V(-5, 3, 14), axis: 'z', h0: 3, h1: 0 },
    { min: V(5, 0, -14), max: V(6.5, 3, -8), axis: 'z', h0: 0, h1: 3 },
  ],
  spawns: [
    spawn(-3, 3, -27, 0), spawn(3, 3, 27, 180),            // deck ends, facing down the span
    spawn(3, 3, -27, 0), spawn(-3, 3, 27, 180),
    spawn(-8, 0, -6, 90), spawn(8, 0, 6, -90),             // flank catwalks, facing across
  ],
  barrels: [
    { id: 'cw_b1', pos: V(-8, 0, -14), hp: 35 }, { id: 'cw_b2', pos: V(8, 0, 14), hp: 35 },
    { id: 'cw_b3', pos: V(3.6, 3, 0), hp: 35 },
  ],
  // ferry platform bridging the central deck gap (z −2..2): flow decision each crossing
  platforms: [{ id: 'cw_ferry', from: V(0, 3, -1.4), to: V(0, 3, 1.4), size: V(2.2, 0.2, 1.3), period: 6, phase: 0 }],
  hazards: [{ id: 'cw_sea', type: 'water', min: V(-40, -15, -40), max: V(40, -1, 40), dps: 200 }],
  doors: [],
  // shootable barricade on the deck (cover you can clear with fire)
  destructibles: [{ id: 'cw_w1', min: V(-2, 3, -9), max: V(2, 5, -8.6), hp: 70 }],
  foliage: [],
  props: [],
});
