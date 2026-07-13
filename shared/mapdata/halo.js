// ARENA map DATA — HALO (collider/spawn/mechanic truth; THREE-free, shared with the
// server). Visuals live in src/world/maps/Halo.js (full design contract there).
// An orbital STATION RING wrapped around a deep central reactor VOID: play circulates
// AROUND a donut of walkways at two radii — an OUTER ring (R17..21) and an INNER ring
// (R8..12), both at the base tier (y0.6) — with an UPPER GANTRY ring (R13..16, y7)
// floating above and spoke BRIDGES crossing the void at two heights. The middle is
// negative space: the void kill-plane + a glowing reactor core + a rising core lift.
// Colliders are AABBs, so each circular ring is approximated by a contiguous 4-bar
// SQUARE ring (corners overlap → no gaps, walkable both ways, like Helix); the visual
// layer overlays smooth TorusGeometry so it READS as a round station ring. Boundary =
// the station OUTER HULL (windows to space) + the central void. Footprint x±24, z±24,
// height y0.6(rings)→7(gantry); the void drops to a catch floor at y-45. Shape = RING.
import { V, box, spawn, normalizeMap } from '../mapkit.js';

// a contiguous square ring-deck (4 bars, corners overlap): inner half-extent `inn`,
// outer `out`, floor y0..y1. Approximates a circular annulus walkway with AABBs.
const ring = (cx, cz, y0, y1, inn, out, extra = {}) => [
  box(cx - out, y0, cz + inn, cx + out, y1, cz + out, extra),   // N bar (+Z)
  box(cx - out, y0, cz - out, cx + out, y1, cz - inn, extra),   // S bar (−Z)
  box(cx + inn, y0, cz - inn, cx + out, y1, cz + inn, extra),   // E bar (+X)
  box(cx - out, y0, cz - inn, cx - inn, y1, cz + inn, extra),   // W bar (−X)
];

export const data = normalizeMap({
  id: 'halo', name: 'Halo',
  theme: { name: 'Orbital Ring', accent: 0x18b6d8, mood: 0x05080f },
  solids: [
    // ── CATCH FLOOR far below the reactor void (nobody falls forever) ─────────
    box(-90, -46, -90, 90, -45, 90),

    // ══ OUTER RING walkway (base tier, y0.6, deck 4 m wide, R17..21) ══════════
    ...ring(0, 0, 0, 0.6, 17, 21),
    // ══ INNER RING walkway (base tier, y0.6, deck 4 m wide, R8..12) ═══════════
    ...ring(0, 0, 0, 0.6, 8, 12),
    // ══ UPPER GANTRY RING (high tier, y7, deck 3 m wide, R13..16) ═════════════
    ...ring(0, 0, 6.4, 7, 13, 16),

    // ── BASE SPOKE BRIDGES over the void: inner ring (R12) ↔ outer ring (R17)
    //    at the 4 cardinals (deck 3 m). Short across-void peeks; the core blocks
    //    the straight-through line. These tie the two base rings together. ──────
    box(12, 0, -1.5, 17, 0.6, 1.5),      // +X base spoke
    box(-17, 0, -1.5, -12, 0.6, 1.5),    // −X base spoke
    box(-1.5, 0, 12, 1.5, 0.6, 17),      // +Z base spoke
    box(-1.5, 0, -17, 1.5, 0.6, -12),    // −Z base spoke

    // ── GANTRY CROSS-BRIDGES over the void at the HIGH tier (y7): two catwalks
    //    spanning the void E-W and N-S, at a DIFFERENT height than the base spokes.
    //    The reactor core (in the middle) blocks the clean straight-across shot. ─
    box(-13, 6.4, -1.6, 13, 7, 1.6),     // gantry E-W bridge across the void (y7)
    box(-1.6, 6.4, -13, 1.6, 7, 13),     // gantry N-S bridge across the void (y7)

    // ── OUTER HULL WALL — the station boundary (windows to space added in visuals).
    //    A tall square shell around the whole ring; inner faces are wall-runnable. ─
    box(-24, -0.4, 21, 24, 12, 24, { wallrun: true }),    // +Z hull
    box(-24, -0.4, -24, 24, 12, -21, { wallrun: true }),  // −Z hull
    box(21, -0.4, -24, 24, 12, 24, { wallrun: true }),    // +X hull
    box(-24, -0.4, -24, -21, 12, 24, { wallrun: true }),  // −X hull

    // ── WALL-RUN KICKER PYLONS at the 4 diagonal corners — tall thin columns from
    //    the outer ring (y0.6) up toward the gantry (y7); wall-run the shared-cyan
    //    accent face to reach the high tier off-ramp. ──────────────────────────
    box(13.4, 0.6, 13.4, 14.6, 7, 14.6, { wallrun: true }),
    box(13.4, 0.6, -14.6, 14.6, 7, -13.4, { wallrun: true }),
    box(-14.6, 0.6, 13.4, -13.4, 7, 14.6, { wallrun: true }),
    box(-14.6, 0.6, -14.6, -13.4, 7, -13.4, { wallrun: true }),
  ],
  ramps: [
    // GANTRY ACCESS ramps — start on the INNER ring deck (x/z=8, y0.6), climb OUTWARD
    // across the void to the GANTRY ring (x/z=16, y7). length 8, rise 6.4, slope 0.8.
    // Placed on the 4 cardinal inner-deck straights, offset in the tangent so they
    // don't block the base spokes. These are the main low→high routes (with wall-run).
    { min: V(8, 0, 3), max: V(16, 7, 7), axis: 'x', h0: 0.6, h1: 7 },      // +X access ramp
    { min: V(-16, 0, -7), max: V(-8, 7, -3), axis: 'x', h0: 7, h1: 0.6 },  // −X access ramp
    { min: V(3, 0, 8), max: V(7, 7, 16), axis: 'z', h0: 0.6, h1: 7 },      // +Z access ramp
    { min: V(-7, 0, -16), max: V(-3, 7, -8), axis: 'z', h0: 7, h1: 0.6 },  // −Z access ramp
  ],
  spawns: [
    // 4 on the OUTER ring at the cardinals (facing tangentially along the ring — the
    // core/void blocks any straight cross-ring peek to the opposite side), 2 on the
    // INNER ring on the opposite diagonal (facing along the inner lane). No shared
    // direct sightline: rivals are always around the curve or across the blocking core.
    spawn(0, 0.6, 19, 270),     // outer +Z, facing −X around the ring
    spawn(19, 0.6, 0, 0),       // outer +X, facing +Z around the ring
    spawn(0, 0.6, -19, 90),     // outer −Z, facing +X around the ring
    spawn(-19, 0.6, 0, 180),    // outer −X, facing −Z around the ring
    spawn(10, 0.6, -5, 180),    // inner (+X/−Z), on inner E bar clear of +X access-ramp z-band [3,7]
    spawn(-10, 0.6, 5, 0),      // inner (−X/+Z), on inner W bar clear of −X access-ramp z-band [−7,−3]
  ],
  barrels: [
    { id: 'hl_b1', pos: V(19, 0.6, 8), hp: 35 },    // outer +X lane
    { id: 'hl_b2', pos: V(-19, 0.6, -8), hp: 35 },  // outer −X lane
    { id: 'hl_b3', pos: V(0, 0.6, 14.5), hp: 35 },  // +Z base spoke mouth (contested)
    { id: 'hl_b4', pos: V(0, 7, 0), hp: 35 },       // gantry bridge crossing (high, exposed)
  ],
  // RISING CORE LIFT — a platform in the central void you can ride UP out of the drop:
  // rises from deep in the void (y-6) up to the gantry E-W bridge (y7, at x6/z0 so you
  // step straight off onto the gantry catwalk) and back. It rides ALONGSIDE the reactor
  // core column (which stays dead-centre) — both an escape-from-the-void lift and a
  // vertical shortcut to the high tier / gantry bridge.
  platforms: [
    { id: 'hl_core', from: V(6, -6, 0), to: V(6, 7, 0), size: V(1.9, 0.25, 1.9), period: 10, phase: 0 },
  ],
  hazards: [
    // the central reactor VOID — fall off the ring into the core drop = death.
    { id: 'hl_void', type: 'void', min: V(-88, -44, -88), max: V(88, -3, 88), dps: 200 },
  ],
  doors: [],
  // a frangible reactor-shield panel plugging part of the +X base spoke (shoot to open
  // a peek/route between inner and outer on that spoke).
  destructibles: [
    { id: 'hl_panel', min: V(13.6, 0.6, -0.6), max: V(14.4, 2.4, 0.6), hp: 70 },
  ],
  foliage: [],
  props: [],
});
