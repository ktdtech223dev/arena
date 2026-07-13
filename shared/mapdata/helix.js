// ARENA map DATA — HELIX (collider/spawn/mechanic truth; THREE-free, shared with
// the server). Visuals live in src/world/maps/Helix.js (full design contract there).
// A figure-8 SKY TEST-TRACK floating in bright daylight: two interlocking square
// loop-decks — a LOW loop (west, top y1) and a HIGH loop (east, top y7) — that
// thread over-and-under each other along a shared center strip, joined at two
// crossover junctions (N/S) by long climbing ramps so the whole thing is ONE
// continuous figure-8. Colliders are AABBs so each round loop is approximated by a
// continuous 4-bar square ring (corners overlap → no gaps); the visual layer
// overlays smooth TorusGeometry + cyan edge strips so it READS as smooth loops.
// Fall off the elevated track = a long void drop (catch-floor far below). Footprint
// x±27, z±15, height y0(low loop)→7(high loop). Boundary = open sky over a cloudscape.
import { V, box, spawn, normalizeMap } from '../mapkit.js';

// a continuous square loop-deck ring (4 bars, corners overlap): inner half-extent
// `inn`, outer `out`, top surface y1. The E/W bars are the center-facing edges that
// interlock with the other loop; some are flagged wall-runnable (glass barrier legs).
const ring = (cx, cz, y0, y1, inn, out, extra = {}) => [
  box(cx - out, y0, cz + inn, cx + out, y1, cz + out, extra),   // N bar (+Z)
  box(cx - out, y0, cz - out, cx + out, y1, cz - inn, extra),   // S bar (−Z)
  box(cx + inn, y0, cz - inn, cx + out, y1, cz + inn, extra),   // E bar (+X)
  box(cx - out, y0, cz - inn, cx - inn, y1, cz + inn, extra),   // W bar (−X)
];

const INN = 10, OUT = 13.4;          // deck width 3.4 m
const LOY = [0.4, 1], HIY = [6.4, 7]; // low-loop top y1, high-loop top y7

export const data = normalizeMap({
  id: 'helix', name: 'Helix',
  theme: { name: 'Sky Test-Track', accent: 0x18b6d8, mood: 0xdff2ff },
  solids: [
    // ---- catch floor FAR below the track (nobody falls forever; under the void) ----
    box(-80, -46, -80, 80, -45, 80),
    // ---- LOWER loop (west, center −13, top y1) : the low deck tier ----
    ...ring(-13, 0, LOY[0], LOY[1], INN, OUT),
    // ---- UPPER loop (east, center +13, top y7) : the high deck tier ----
    ...ring(13, 0, HIY[0], HIY[1], INN, OUT),
    // ---- CROSSOVER BRIDGES at the two junctions (short flat landings that tie the
    //      climbing ramps into each loop deck so the figure-8 is continuous) ----
    box(-2, 0.4, 10, 8, 1, 13.4),        // N: low-side landing (foot of N climb)
    // N/S high-side landings deleted: they were solid slabs at y6.4→7 that buried the
    // crossover ramps below them. The ramps now top out exactly at the high-loop deck
    // edge (x=-0.4), where the high N/S bars already provide the y7 landing floor.
    box(-8, 0.4, -13.4, 3, 1, -10),      // S: low-side landing (foot of S climb)
    // ---- suspended TIMING GANTRY posts over the center over/under (wall-runnable
    //      pillars — the shared cyan wall-run language) ----
    box(-0.6, 1, 6.6, 0.6, 7, 7.4, { wallrun: true }),
    box(-0.6, 1, -7.4, 0.6, 7, -6.6, { wallrun: true }),
    // ---- central STRUCTURAL HUB drums filling each loop's hole (block cross-ring
    //      sightlines between same-loop spawns + read as the track's support spine) ----
    box(-19, 0.4, -6.5, -7, 5.5, 6.5),    // low-loop hub drum (west, under its deck plane)
    box(7, 6.4, -6.5, 19, 12, 6.5),       // high-loop hub drum (east, on its deck plane)
    // ---- outer glass-barrier buttress legs on the far ends (wall-run kickers) ----
    box(-27.4, 1, -1.7, -26.4, 6, 1.7, { wallrun: true }),  // far-west high kicker
    box(26.4, 1, -1.7, 27.4, 6, 1.7, { wallrun: true }),    // far-east high kicker
  ],
  ramps: [
    // N crossover: LOW loop N deck (y1) climbs UP to HIGH loop N deck (y7). Runs WEST of the
    // high deck edge (tops out at x=-0.4) so it never passes under the high N bar. rise 6 / run 7.6, slope 0.79.
    { min: V(-8, 0, 10.6), max: V(-0.4, 7, 12.8), axis: 'x', h0: 1, h1: 7 },
    // S crossover: LOW loop S deck (y1) climbs UP to HIGH loop S deck (y7) — closes the figure-8 loop.
    // Mirror of N: tops out at the high deck edge (x=-0.4), clear of the high S bar overhead.
    { min: V(-8, 0, -12.8), max: V(-0.4, 7, -10.6), axis: 'x', h0: 1, h1: 7 },
    // secondary low→high on-ramp along the shared center strip (2nd vertical route, west inner edge)
    { min: V(-3.4, 0, 3.5), max: V(0.4, 7, 9.5), axis: 'z', h0: 1, h1: 7 },
    // secondary high→low return, west inner edge (shifted W to clear the high W-bar overhang, like ramps[2];
    // min.x kept at -2.5 so its r-expanded footprint stays clear of low-loop spawn[2] at x=-3).
    { min: V(-2.5, 0, -9.5), max: V(0.4, 7, -3.5), axis: 'z', h0: 1, h1: 7 },
  ],
  spawns: [
    // LOW loop — 3 spawns 120° apart around the ring, each facing inward across the
    //   loop; the central hub drum screens every pair (no shared sightline).
    spawn(-13, 1, 11.6, 180), spawn(-23, 1, -5.8, 60), spawn(-3, 1, -5.8, 300),
    // HIGH loop — 3 spawns 120° apart, screened by the high hub drum + the over/under.
    spawn(23, 7, 5.8, 240), spawn(3, 7, 5.8, 120), spawn(13, 7, -11.6, 0),
  ],
  barrels: [
    { id: 'hx_b1', pos: V(-24.5, 1, 0), hp: 35 },   // low loop W apex
    { id: 'hx_b2', pos: V(24.5, 7, 0), hp: 35 },     // high loop E apex
    { id: 'hx_b3', pos: V(0, 7, 12), hp: 35 },       // high loop N crossover
  ],
  // a shuttle test-sled riding the shared center strip UNDER the high loop (moving cover / lift-across)
  platforms: [{ id: 'hx_sled', from: V(0, 1, -8), to: V(0, 1, 8), size: V(1.6, 0.18, 1.4), period: 7, phase: 0 }],
  hazards: [
    // the void: fall off the elevated track anywhere = long drop to the catch floor
    { id: 'hx_void', type: 'void', min: V(-80, -44, -80), max: V(80, -3, 80), dps: 200 },
  ],
  doors: [],
  // a frangible timing-gate panel spanning the high-loop N straight (shootable to open a peek)
  destructibles: [{ id: 'hx_gate', min: V(11, 7, 12.6), max: V(15, 9, 13), hp: 70 }],
  foliage: [],
  props: [],
});
