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
    // tier-1 (h5): +X bar SHORTENED to x[3,8] so the +X climb ramp (tops at x=8,y5)
    // isn't buried under the y4.6 plate underside (audit HIGH fix).
    box(-12, 4.6, 3, 12, 5, 12),    // +Z bar
    box(-12, 4.6, -12, 12, 5, -3),  // -Z bar
    box(3, 4.6, -3, 8, 5, 3),       // +X bar (12→8, clears ramp)
    box(-12, 4.6, -3, -3, 5, 3),    // -X bar
    ...ring(10, 12, 3), ...ring(15, 12, 3),
    // shaft wall-run corner POSTS (4, thin 0.4×0.4) — keep wall-run surfaces but
    // leave the 4 faces open so players can vault into the shaft/lift (audit HIGH:
    // full-face panels sealed the shaft, killing the lift + drop-down flow).
    box(-3.4, 0, -3.4, -3, 18, -3, { wallrun: true }),  // -X/-Z corner
    box(3, 0, -3.4, 3.4, 18, -3, { wallrun: true }),    // +X/-Z corner
    box(-3.4, 0, 3, -3, 18, 3.4, { wallrun: true }),    // -X/+Z corner
    box(3, 0, 3, 3.4, 18, 3.4, { wallrun: true }),      // +X/+Z corner
    // a couple of overhang ledges off the shaft columns (wall-jump targets)
    box(-6, 7.5, -1.4, -3, 7.9, 1.4), box(3, 12.5, -1.4, 6, 12.9, 1.4),
  ],
  ramps: [
    // alternating ramps climb the ring: +X side 0→5, -Z 5→10, +Z 10→15
    { min: V(8, 0, -3), max: V(12, 5, 3), axis: 'x', h0: 5, h1: 0 },
    // h0/h1 corrected to match the box y-range so the walk surface actually
    // spans tier1→tier2 (was h0:0,h1:5 → surface sat at y0..5 over the ground).
    { min: V(-3, 5, -12), max: V(3, 10, -8), axis: 'z', h0: 5, h1: 10 },
    // tier2→tier3: was h0:5,h1:0 → surface sat at y0..5; now matches box y10..15.
    { min: V(-3, 10, 8), max: V(3, 15, 12), axis: 'z', h0: 10, h1: 15 },
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
