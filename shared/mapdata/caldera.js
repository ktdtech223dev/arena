// ARENA map DATA — CALDERA (collider/spawn/mechanic truth; THREE-free, shared
// with the server). Visuals live in src/world/maps/Caldera.js (full contract there).
// Open volcanic bowl: a wide flat crater floor rimmed by stepped basalt terraces
// rising to the caldera wall, with a RAISED central basalt plug (king-of-the-hill)
// ringed by a lava moat. Radial footprint ~r20, height y0(floor)→7(plug top).
import { V, box, spawn, normalizeMap } from '../mapkit.js';

// a square terrace ring (4 solid bars from y0..y1, hole in [-inn,inn])
const sqRing = (y0, y1, inn, out) => [
  box(-out, y0, inn, out, y1, out),      // +Z bar
  box(-out, y0, -out, out, y1, -inn),    // -Z bar
  box(inn, y0, -inn, out, y1, inn),      // +X bar
  box(-out, y0, -inn, -inn, y1, inn),    // -X bar
];

export const data = normalizeMap({
  id: 'caldera', name: 'Caldera',
  theme: { name: 'Ashfall', accent: 0xff5a1e, mood: 0x1a0c08 },
  solids: [
    box(-13, -1, -13, 13, 0, 13),                          // crater floor (the open bowl bottom)
    // stepped basalt terraces climbing outward to the caldera wall = the "bowl"
    ...sqRing(0, 2.5, 13, 15.5),                            // terrace 1 (y2.5)
    ...sqRing(0, 5, 15.5, 18),                              // rim walk (y5)
    ...sqRing(0, 16, 18, 20),                               // caldera outer wall (boundary, y16)
    // RAISED CENTER: basalt plug (king-of-the-hill), faces wall-runnable
    box(-3.5, 0, -3.5, 3.5, 7, 3.5, { wallrun: true }),
  ],
  ramps: [
    // spiral bowl access: floor→terrace1 (N & S), terrace1→rim (E & W)
    { min: V(-2, 0, -15.5), max: V(2, 2.5, -13), axis: 'z', h0: 2.5, h1: 0 },
    { min: V(-2, 0, 13), max: V(2, 2.5, 15.5), axis: 'z', h0: 0, h1: 2.5 },
    { min: V(15.5, 2.5, -2), max: V(18, 5, 2), axis: 'x', h0: 2.5, h1: 5 },
    { min: V(-18, 2.5, -2), max: V(-15.5, 5, 2), axis: 'x', h0: 5, h1: 2.5 },
    // the RAMP up the plug (east face): floor→plug top, slope 1. Other faces = wall-run.
    { min: V(3.5, 0, -1.5), max: V(10.5, 7, 1.5), axis: 'x', h0: 7, h1: 0 },
  ],
  spawns: [
    spawn(11, 0, -9, -45), spawn(-11, 0, 9, 135),          // floor NE / SW, facing center (nudged off lava-fissure lips cal_c1/cal_c2)
    spawn(-14, 2.5, 0, 90), spawn(14, 2.5, 0, -90),        // terrace-1 W / E
    spawn(0, 5, -16.5, 0), spawn(0, 5, 16.5, 180),         // rim N / S (plug blocks the cross)
  ],
  barrels: [
    { id: 'cal_b1', pos: V(11, 0, 0), hp: 35 }, { id: 'cal_b2', pos: V(-14, 2.5, 4), hp: 35 },
    { id: 'cal_b3', pos: V(2.6, 7, 2.6), hp: 35 },         // barrel on the king-hill plug top
  ],
  // rising basalt platform (lava elevator) — the west vertical route floor↔rim
  platforms: [{ id: 'cal_lift', from: V(-11, 0, 0), to: V(-11, 5, 0), size: V(1.6, 0.2, 1.6), period: 8, phase: 0 }],
  hazards: [
    // lava moat around the plug (N/S/W; east left clear for the ramp) — crossing hurts
    { id: 'cal_mN', type: 'lava', min: V(-5.5, -1, -5.5), max: V(5.5, 0.2, -3.5), dps: 45 },
    { id: 'cal_mS', type: 'lava', min: V(-5.5, -1, 3.5), max: V(5.5, 0.2, 5.5), dps: 45 },
    { id: 'cal_mW', type: 'lava', min: V(-5.5, -1, -3.5), max: V(-3.5, 0.2, 3.5), dps: 45 },
    // lava cracks fissuring the open floor (area denial)
    { id: 'cal_c1', type: 'lava', min: V(6, -1, -11), max: V(9, 0.1, -6), dps: 30 },
    { id: 'cal_c2', type: 'lava', min: V(-9, -1, 6), max: V(-6, 0.1, 11), dps: 30 },
  ],
  doors: [],
  destructibles: [{ id: 'cal_w1', min: V(-1.5, 5, -18), max: V(1.5, 7, -17.6), hp: 70 }], // rim cover chunk
  foliage: [],
  props: [],
});
