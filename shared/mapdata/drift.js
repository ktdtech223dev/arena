// ARENA map DATA — DRIFT (collider/spawn/mechanic truth; THREE-free, shared with
// the server). Visuals live in src/world/maps/Drift.js (full contract there).
// A constellation of separate floating sky-islands over a BOTTOMLESS VOID, joined
// only by gap-jumps, thin arcing bridges, wall-run pillars and a moving stepping-
// stone. No continuous ground. Discrete island heights y0/y3/y6/y9 — traversal IS
// the verticality. Footprint ~x±26, z±30. Boundary = the void (fall = death).
import { V, box, spawn, normalizeMap } from '../mapkit.js';

// a floating island: a walkable top slab + a tapering rock body beneath it. The
// body is a SEPARATE (slightly inset) collider so the island reads as a landmass
// with thickness, not a paper-thin plate. (Visuals sculpt real undersides on top.)
const island = (x0, z0, x1, z1, top, thick = 3) => [
  box(x0, top - 0.6, z0, x1, top, z1),                       // grassy top slab (the floor you stand on)
  box(x0 + 1.2, top - thick, z0 + 1.2, x1 - 1.2, top - 0.6, z1 - 1.2), // inset rock body (thickness)
];

// a tall thin WALL-RUN PILLAR spanning a gap — run along it to cross to the far island
const pillar = (x, z, y0, y1) => box(x - 0.6, y0, z - 0.6, x + 0.6, y1, z + 0.6, { wallrun: true });

export const data = normalizeMap({
  id: 'drift', name: 'Drift',
  theme: { name: 'Sky Isles', accent: 0x18b6d8, mood: 0x2a4a66 },
  solids: [
    // ===== CATCH FLOOR far below (so nobody falls forever) — invisible, under the clouds
    box(-80, -62, -80, 80, -61, 80),

    // ===== THE ISLANDS (top slab + rock body each) ==========================
    ...island(-6, -6, 6, 6, 3, 4),          // HUB — big central hub island (y3), signature set-piece
    ...island(15, -5, 23, 5, 3, 3),         // E-mid island (y3)
    ...island(-23, -5, -15, 5, 3, 3),       // W-mid island (y3)
    ...island(-5, -30, 5, -22, 9, 3),       // N high perch (y9)
    ...island(-5, 22, 5, 30, 9, 3),         // S high perch (y9)
    ...island(-26, -26, -16, -16, 6, 3),    // NW corner island (y6)
    ...island(16, -26, 26, -16, 6, 3),      // NE corner island (y6)
    ...island(-26, 16, -16, 26, 6, 3),      // SW corner island (y6)
    ...island(16, 16, 26, 26, 6, 3),        // SE corner island (y6)

    // ===== COVER BOULDERS (waist/head-high rocks on the small islands; also break
    // the direct cross-island spawn peeks so no two spawns share a clean sightline)
    box(-22, 6, -22, -19, 9.2, -19),        // NW cover rock (blocks NW<->Sperch line)
    box(19, 6, 19, 22, 9.2, 22),            // SE cover rock (blocks SE<->Nperch line)
    box(19, 6, -22, 22, 9.2, -19),          // NE cover rock
    box(-22, 6, 19, -19, 9.2, 22),          // SW cover rock
    box(-2, 9, -27, 2, 11.6, -25),          // N perch back wall (blocks the down-span line)
    box(-2, 9, 25, 2, 11.6, 27),            // S perch back wall
    box(20.5, 3, -2, 22.5, 5.4, 2),         // E-mid cover slab
    box(-22.5, 3, -2, -20.5, 5.4, 2),       // W-mid cover slab
    box(-3, 3, -1.2, 3, 5.6, 1.2),          // HUB central spine (breaks E-mid<->W-mid line)

    // ===== FLOATING STEPPING-STONE boxes (break the hub<->mid gaps into hops) =
    box(7.5, 2.4, -2, 11.5, 3, 2),          // ss East (HUB->E-mid stepping stone)
    box(-11.5, 2.4, -2, -7.5, 3, 2),        // ss West (HUB->W-mid stepping stone)

    // (the mid<->corner "arcing bridges" are the RAMPS below; the VISUALS arc a
    //  deck over each ramp. No flat deck collider — the ramp heightfield IS the walk.)

    // ===== WALL-RUN PILLARS (cross perch<->corner gaps by wall-running) =======
    pillar(-11, -20, 3, 12),                // Nperch <-> NW pillar
    pillar(11, -20, 3, 12),                 // Nperch <-> NE pillar
    pillar(-11, 20, 3, 12),                 // Sperch <-> SW pillar
    pillar(11, 20, 3, 12),                  // Sperch <-> SE pillar
    // two hub-side wall-run pillars framing the central span (extra vertical play)
    pillar(0, -13, 3, 14),                  // N central pillar (HUB->Nperch assist)
    pillar(0, 13, 3, 14),                   // S central pillar (HUB->Sperch assist)
  ],
  ramps: [
    // HUB (y3) <-> N/S high perches (y9): long gentle arcing bridge-ramps
    { min: V(-2.2, 0, -22), max: V(2.2, 9, -6), axis: 'z', h0: 9, h1: 3 },  // to N perch (t=0 @ z-22 =y9)
    { min: V(-2.2, 0, 6), max: V(2.2, 9, 22), axis: 'z', h0: 3, h1: 9 },    // to S perch
    // E/W-mid (y3) -> corner islands (y6): the arcing-bridge slopes (walk up the deck)
    { min: V(18, 0, -16), max: V(22, 6, -5), axis: 'z', h0: 6, h1: 3 },     // E-mid -> NE
    { min: V(18, 0, 5), max: V(22, 6, 16), axis: 'z', h0: 3, h1: 6 },       // E-mid -> SE
    { min: V(-22, 0, -16), max: V(-18, 6, -5), axis: 'z', h0: 6, h1: 3 },   // W-mid -> NW
    { min: V(-22, 0, 5), max: V(-18, 6, 16), axis: 'z', h0: 3, h1: 6 },     // W-mid -> SW
  ],
  spawns: [
    // 6 spawns on solid island tops, none sharing a direct sightline (islands are
    // small cover, height + gaps + the hub break every clean cross-spawn peek).
    spawn(19, 3, 0, 270),      // E-mid (y3), facing -X toward center
    spawn(-19, 3, 0, 90),      // W-mid (y3), facing +X toward center
    spawn(0, 9, -26, 180),     // N high perch (y9), facing +Z (down the span)
    spawn(0, 9, 26, 0),        // S high perch (y9), facing -Z
    spawn(-21, 6, -21, 135),   // NW corner (y6), facing toward center (+X+Z)
    spawn(21, 6, 21, 315),     // SE corner (y6), facing toward center (-X-Z)
  ],
  barrels: [
    { id: 'df_b1', pos: V(0, 3, 4), hp: 35 },        // hub barrel (south of the spine, clear)
    { id: 'df_b2', pos: V(19, 3, 0), hp: 35 },       // E-mid
    { id: 'df_b3', pos: V(-19, 3, 0), hp: 35 },      // W-mid
  ],
  // MOVING stepping-stone platforms — the signature drifting stones bridging the
  // corner islands across the deep flank gaps (a flow decision each crossing).
  platforms: [
    { id: 'df_pE', from: V(21, 6, -10), to: V(21, 6, 10), size: V(1.8, 0.25, 1.8), period: 7, phase: 0 }, // NE<->SE mover (east flank)
    { id: 'df_pW', from: V(-21, 6, 10), to: V(-21, 6, -10), size: V(1.8, 0.25, 1.8), period: 7, phase: 3.5 }, // SW<->NW mover (west flank)
    { id: 'df_pC', from: V(0, 6.5, -3), to: V(0, 6.5, 3), size: V(2, 0.25, 1.6), period: 5, phase: 0 }, // central drifting stone over the hub void seam
  ],
  hazards: [
    // THE VOID — the bottomless kill zone below every island (fall = death)
    { id: 'df_void', type: 'void', min: V(-80, -60, -80), max: V(80, -6, 80), dps: 200 },
  ],
  doors: [],
  // a shootable chunk of cover on the exposed hub (clear it with fire)
  destructibles: [{ id: 'df_w1', min: V(-1.2, 3, -5), max: V(1.2, 5, -4.4), hp: 70 }],
  foliage: [],
  props: [],
});
