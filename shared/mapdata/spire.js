// ARENA map DATA — SPIRE (collider/spawn/mechanic truth; THREE-free, shared with
// the server). Visuals live in src/world/maps/Spire.js. See that file's contract.
// Vertical tower: 4 stacked ring-tiers around an open central shaft, connected by
// alternating ramps + wall-run shaft columns. Footprint ±13, height y0→18.
import { V, box, spawn, normalizeMap } from '../mapkit.js';

// a square RING plate (4 bars) at height h leaving a central shaft hole [-in,in]
const ring = (h, out, inn) => [
  box(-out, h - 0.4, inn, out, h, out),   // +Z bar
  box(-out, h - 0.4, -out, out, h, -inn),  // -Z bar
  box(inn, h - 0.4, -inn, out, h, inn),    // +X bar
  box(-out, h - 0.4, -inn, -inn, h, inn),  // -X bar
];

export const data = normalizeMap({
  id: 'spire', name: 'Spire',
  theme: { name: 'Neon Night', accent: 0x7df9ff, mood: 0x0a1020 },
  solids: [
    box(-14, -2, -14, 14, 0, 14),                      // ground floor
    // building shell (4 walls, tall) — outer two flagged wall-runnable
    box(-14, 0, 13, 14, 20, 14, { wallrun: true }),    // +Z wall
    box(-14, 0, -14, 14, 20, -13, { wallrun: true }),  // -Z wall
    box(13, 0, -14, 14, 20, 14),                       // +X wall
    box(-14, 0, -14, -13, 20, 14),                     // -X wall
    // stacked ring tiers around the shaft (shaft hole x,z in [-3,3])
    ...ring(5, 12, 3), ...ring(10, 12, 3), ...ring(15, 12, 3),
    // shaft wall-run columns (4), tall
    box(-3.4, 0, -3.4, -3, 18, 3.4, { wallrun: true }),
    box(3, 0, -3.4, 3.4, 18, 3.4, { wallrun: true }),
    box(-3.4, 0, 3, 3.4, 18, 3.4, { wallrun: true }),
    box(-3.4, 0, -3.4, 3.4, 18, -3, { wallrun: true }),
    // a couple of overhang ledges off the shaft columns (wall-jump targets)
    box(-6, 7.5, -1.4, -3, 7.9, 1.4), box(3, 12.5, -1.4, 6, 12.9, 1.4),
  ],
  ramps: [
    // alternating ramps climb the ring: +X side 0→5, -Z 5→10, +Z 10→15
    { min: V(8, 0, -3), max: V(12, 5, 3), axis: 'x', h0: 5, h1: 0 },
    { min: V(-3, 5, -12), max: V(3, 10, -8), axis: 'z', h0: 0, h1: 5 },
    { min: V(-3, 10, 8), max: V(3, 15, 12), axis: 'z', h0: 5, h1: 0 },
  ],
  spawns: [
    spawn(-11, 0, -11, 45), spawn(11, 0, 11, -135),      // ground opposite corners
    spawn(11, 0, -11, 135), spawn(-11, 0, 11, -45),
    spawn(-11, 10, 0, 90), spawn(11, 15, 0, -90),        // upper tiers
  ],
  // pull players up: shaft-center risk pickup + tier corners (spots for later)
  barrels: [{ id: 'spire_b1', pos: V(-11, 5, 0), hp: 35 }, { id: 'spire_b2', pos: V(11, 10, 0), hp: 35 }],
  platforms: [{ id: 'spire_lift', from: V(0, 1, 0), to: V(0, 16, 0), size: V(2.4, 0.25, 2.4), period: 9, phase: 0 }],
  hazards: [],
  doors: [],
  destructibles: [{ id: 'spire_w1', min: V(-1.5, 5, 11.6), max: V(1.5, 8, 12), hp: 70 }],
  foliage: [],
  props: [],
});
