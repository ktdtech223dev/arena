// ARENA map DATA — WARREN (collider/spawn/mechanic truth; THREE-free, shared with
// the server). Visuals live in src/world/maps/Warren.js (full design contract there).
// A cramped underground bunker/catacomb: a tight labyrinth of concrete corridors and
// small rooms wrapped around a central CISTERN chamber, with a LOWER flooded sump
// (~y-2, toxic) reached by stairs and narrow VENT catwalks (~y4) crawling over the
// rooms. Fully ENCLOSED — the boundary is the bunker's outer shell (walls + ceiling).
// Footprint x±20, z±20; height y-2 (sump) → 0 (main) → 4.1 (vents). No long lanes.
//
// LAYOUT (main level, top-down; C=cistern, corner rooms NW/NE/SW/SE, and a RING
// corridor between the rooms and the cistern that everything opens onto):
//
//        z-20 ┌───────────────────────────┐
//             │  NW room   ‖  N corr ‖  NE │   ring corridor runs the full
//             │        ┌── ring ──┐        │   inner perimeter (x±6 & z±6..±14),
//             │  W corr│  CISTERN  │E corr │   the cistern sits in the middle,
//             │        └── ring ──┘        │   each room + the cistern have
//             │  SW room   ‖  S corr ‖  SE │   >=2 doorways onto the ring.
//        z 20 └───────────────────────────┘
import { V, box, spawn, normalizeMap } from '../mapkit.js';

// ---- module helpers (THREE-free) -----------------------------------------
const FY0 = 0;        // main floor top
const WT = 0.4;       // interior wall thickness
const WALLTOP = 4.6;  // interior partition wall height

// a thin interior partition wall from (x0,z0) to (x1,z1), floor→WALLTOP.
// Either x0==x1 (a Z-running wall) or z0==z1 (an X-running wall). `run` = wall-runnable.
const wall = (x0, z0, x1, z1, run = false) => {
  const ax0 = Math.min(x0, x1), ax1 = Math.max(x0, x1);
  const az0 = Math.min(z0, z1), az1 = Math.max(z0, z1);
  const ex = ax1 - ax0 < 0.01 ? WT / 2 : 0;
  const ez = az1 - az0 < 0.01 ? WT / 2 : 0;
  return box(ax0 - ex, FY0, az0 - ez, ax1 + ex, WALLTOP, az1 + ez, run ? { wallrun: true } : {});
};
const slab = (x0, z0, x1, z1, y, th = 0.4) => box(x0, y, z0, x1, y + th, z1);

// The RING corridor is the ~2.5m-wide open lane at x in [-8.5,-6] & [6,8.5] and
// z in [-8.5,-6] & [6,8.5], i.e. between the corner rooms (|coord|>8.5) and the
// cistern (|coord|<6). Rooms open OUTWARD-in, the cistern opens OUT, onto this ring.

export const data = normalizeMap({
  id: 'warren', name: 'Warren',
  theme: { name: 'Buried Bunker', accent: 0x18b6d8, mood: 0x180608 },

  solids: [
    // catch floor far below the whole bunker: a defensive backstop so that if a player
    // is ever ejected past the shell edge (the floor stops at ±20, walls at ±20.4) they
    // land + get killed by the void hazard and respawn, instead of falling forever.
    box(-40, -32, -40, 40, -31, 40),
    // ===================== OUTER SHELL (the enclosing bunker) =====================
    // Main level floor (top y0) — built as FOUR slabs leaving a rectangular HOLE over
    // the flooded sump pit (x-17.6..-9, z14.5..18.5) so the sump is an open sunken space
    // you descend the stairs into (full headroom to the shell ceiling above it). The SW
    // room floor (z<=14) stays fully solid; the pit sits south of it.
    slab(-20, -20, 20, 14.5, -0.4, 0.4),               // floor: everything north of the pit
    slab(-20, 18.5, 20, 20, -0.4, 0.4),                // floor: strip south of the pit
    slab(-20, 14.5, -17.6, 18.5, -0.4, 0.4),           // floor: strip west of the pit
    slab(-9, 14.5, 20, 18.5, -0.4, 0.4),               // floor: everything east of the pit
    box(-20.4, -2.4, -20.4, -20, 5.4, 20.4),           // west shell wall
    box(20, -2.4, -20.4, 20.4, 5.4, 20.4),             // east shell wall
    box(-20.4, -2.4, -20.4, 20.4, 5.4, -20),           // north shell wall
    box(-20.4, -2.4, 20, 20.4, 5.4, 20.4),             // south shell wall
    slab(-20, -20, 20, 20, 6.0, 0.5),                  // shell ceiling underside = y6.0 (raised from 5.0 for catwalk headroom)

    // ===================== CENTRAL CISTERN CHAMBER (x±6, z±6) =====================
    // A larger chamber the corridors feed into. Four doorways (mid of each wall)
    // open onto the ring corridor. Wall-run faces flagged {run} (cyan accent).
    // north wall: doorway gap x-1.6..1.6 (blocked by a destructible barricade below)
    wall(-6, -6, -1.6, -6, true), wall(1.6, -6, 6, -6),
    // south wall: doorway gap x-1.6..1.6
    wall(-6, 6, -1.6, 6), wall(1.6, 6, 6, 6, true),
    // west wall: doorway gap z-1.6..1.6
    wall(-6, -6, -6, -1.6), wall(-6, 1.6, -6, 6, true),
    // east wall: doorway gap z-1.6..1.6 (a proximity BLAST DOOR fills this gap)
    wall(6, -6, 6, -1.6, true), wall(6, 1.6, 6, 6),

    // ===================== RING CORRIDOR OUTER WALLS =====================
    // These separate the ring corridor (|coord| 6..8.5) from the corner rooms
    // (|coord| 8.5..14). Doorway gaps let each corner room onto the ring, AND the
    // N/S/E/W corridor spurs stay open so the ring is one continuous loop.
    // -- north side of ring: wall at z=-8.5 between ring and north rooms, gaps let
    //    the N corridor spur (x-1.6..1.6) reach the north rooms boundary, plus room doors.
    wall(-8.5, -8.5, -3, -8.5), wall(3, -8.5, 8.5, -8.5),   // gap x-3..3 = N spur mouth
    // -- south side of ring
    wall(-8.5, 8.5, -3, 8.5), wall(3, 8.5, 8.5, 8.5),        // gap x-3..3 = S spur mouth
    // -- west side of ring
    wall(-8.5, -8.5, -8.5, -3), wall(-8.5, 3, -8.5, 8.5),    // gap z-3..3 = W spur mouth
    // -- east side of ring
    wall(8.5, -8.5, 8.5, -3), wall(8.5, 3, 8.5, 8.5),        // gap z-3..3 = E spur mouth

    // -- EDGE-STRIP DIVIDERS: split each outer strip so no clean lane runs corner-to-
    //    corner. Each divider runs from the ring wall (|8.5|) out to the perimeter,
    //    turning the strip into two cornered pockets joined only through the ring. --
    wall(0, -14, 0, -8.5),                     // north strip divider (splits NW|NE lane)
    wall(0, 8.5, 0, 14),                       // south strip divider (splits SW|SE lane)
    wall(-14, 0, -8.5, 0),                     // west strip divider (splits NW|SW lane)
    wall(8.5, 0, 14, 0),                       // east strip divider (splits NE|SE lane)

    // ===================== CORNER ROOMS =====================
    // Each corner room is walled on its two OUTER (perimeter-facing) sides and opens
    // to the ring via the spur-mouth gaps on its two INNER sides → every room >=2 exits
    // (its own spur gap + around the edge-strip pocket to the neighbouring spur).

    // -- NW room (x-14..-8.5, z-14..-8.5) --
    wall(-14, -14, 0, -14),                    // NW north wall (perimeter side, to divider)
    wall(-14, -14, -14, 0),                    // NW west wall (perimeter side, to divider)
    wall(-11, -11.5, -11, -9.5, true),         // NW ambush baffle (not a dead end)

    // -- NE room (x8.5..14, z-14..-8.5) --
    wall(0, -14, 14, -14),                     // NE north wall
    wall(14, -14, 14, 0),                      // NE east wall
    wall(11, -11.5, 11, -9.5),                 // NE baffle

    // -- SW room (x-14..-8.5, z8.5..14) = the SUMP-access room --
    wall(-14, 14, 0, 14),                      // SW south wall
    wall(-14, 0, -14, 14),                     // SW west wall

    // -- SE room (x8.5..14, z8.5..14) --
    wall(0, 14, 14, 14),                       // SE south wall
    wall(14, 0, 14, 14),                       // SE east wall
    wall(11, 9.5, 11, 11.5),                   // SE baffle

    // ===================== SUMP SUBLEVEL (lower tier, y-2) =====================
    // A flooded pit cut into the floor under the SW room. Reached by the stair ramp.
    // The main floor slab is REMOVED here by overlaying a lower floor + surrounding lip
    // walls; players descend the stairs into it. Toxic sludge on its floor (area denial).
    slab(-17.6, 14.5, -9, 18.5, -2.4, 0.4),    // sump floor top = y-2
    // pit RETAINING lips: rise from the sump floor to y0, forming the pit walls so you
    // can't stroll off the SW-room floor edge into the pit — you take the stairs. The
    // north lip has a GAP at x-13..-10 where the descending stair meets the pit.
    box(-17.6, -2.4, 14.5, -17.2, 0, 18.5),    // sump west lip
    box(-9.4, -2.4, 14.5, -9, 0, 18.5),        // sump east lip (toward room center)
    box(-17.6, -2.4, 18.1, -9, 0, 18.5),       // sump south lip
    box(-17.6, -2.4, 14.5, -13, 0, 14.9),      // sump north lip (west of stair gap)
    box(-10, -2.4, 14.5, -9, 0, 14.9),         // sump north lip (east of stair gap)

    // ===================== VENT / CATWALK TIER (upper, y~4) =====================
    // Narrow duct catwalks crossing OVER the rooms near the ceiling — a bypass route.
    slab(-14, -13, 14, -11.4, 3.7, 0.3),       // north catwalk deck (top y4.0), over N rooms
    slab(-14, 11.4, 14, 13, 3.7, 0.3),         // south catwalk deck, over S rooms
    slab(11.4, -13, 13, 13, 3.7, 0.3),         // east catwalk deck linking N<->S over E rooms
    slab(-13, -13, -11.4, 13, 3.7, 0.3),       // west catwalk deck linking N<->S over W rooms
    slab(-1.2, -12.2, 1.2, -6, 3.7, 0.3),      // north vent spur → peek down into cistern
  ],

  ramps: [
    // -- STAIRS DOWN to the flooded sump (SW room floor y0 → sump y-2), along +z --
    { min: V(-13, -2, 14.5), max: V(-10, 0, 18.0), axis: 'z', h0: 0, h1: -2 },
    // -- STAIRS UP to the VENT catwalk tier (y0 → y~4) --
    { min: V(-13, 0, -13), max: V(-11, 4, -8), axis: 'z', h0: 4, h1: 0 },   // NW room → N/W catwalk
    { min: V(11, 0, -13), max: V(13, 4, -8), axis: 'z', h0: 4, h1: 0 },     // NE room → N/E catwalk
    { min: V(11, 0, 8), max: V(13, 4, 13), axis: 'z', h0: 0, h1: 4 },       // SE room → S/E catwalk
  ],

  spawns: [
    // Six spawns, one per corner room + two on the E/W ring spurs. It is a maze —
    // interior walls + edge-strip dividers break every pair's direct sightline. FEET
    // at floor top y0. Corner spawns sit in the INNER-room clear zone (±10,±10) — kept
    // OUT of the catwalk-stair RAMP footprints (x/z 11..13) so the ramp heightfields
    // don't snap a floor-level spawn UP onto the stair, and clear of the vent decks.
    spawn(-10, 0, -10, 45),    // NW room, facing inward (SE)
    spawn(10, 0, -10, 315),    // NE room, facing inward (SW)
    spawn(-10, 0, 10, 135),    // SW (sump) room, facing inward (NE)
    spawn(10, 0, 10, 225),     // SE room, facing inward (NW)
    spawn(-7.2, 0, 0, 90),     // W ring spur, facing east toward cistern
    spawn(7.2, 0, 0, 270),     // E ring spur, facing west toward cistern
  ],

  barrels: [
    { id: 'wr_b1', pos: V(-4.6, 0, -4.6), hp: 30 },   // cistern NW corner
    { id: 'wr_b2', pos: V(4.6, 0, 4.6), hp: 30 },     // cistern SE corner
    { id: 'wr_b3', pos: V(-9.5, 0, -9.5), hp: 30 },   // NW room, by the ring doorway
    { id: 'wr_b4', pos: V(9.5, 0, 9.5), hp: 30 },     // SE room, by the ring doorway
  ],

  // slow lift/duct platform inside the cistern: rises from floor to the vent stub —
  // a vertical shortcut up to the catwalk tier (extra flow between tiers).
  platforms: [
    { id: 'wr_lift', from: V(0, 0.2, -8), to: V(0, 3.7, -8), size: V(1.1, 0.2, 1.1), period: 7, phase: 0 },
  ],

  // shallow toxic sludge at the bottom of the flooded sump — AREA DENIAL, low dps.
  // + a VOID kill-plane well below the sump (y<-5): only a player who has fallen out
  // of the sealed bunker reaches it → they die + respawn (the sump floor at y-2 and
  // its occupants stay safe above it). No infinite falls.
  hazards: [
    { id: 'wr_sump', type: 'toxic', min: V(-17.2, -2, 14.9), max: V(-9.4, -1.6, 18.1), dps: 14 },
    { id: 'wr_void', type: 'void', min: V(-40, -30, -40), max: V(40, -5, 40), dps: 200 },
  ],

  // proximity BLAST DOORS — dynamic pinch points. Solid until ~85% open; they RISE.
  doors: [
    // east cistern doorway (fills the z-1.6..1.6 gap in the east cistern wall)
    { id: 'wr_d_east', min: V(5.6, 0, -1.6), max: V(6.4, 4.6, 1.6), trigger: 'proximity', openOffset: V(0, 4.6, 0) },
    // west ring spur mouth (fills the z-3..3 gap in the west ring wall)
    { id: 'wr_d_west', min: V(-8.7, 0, -3), max: V(-8.3, 4.6, 3), trigger: 'proximity', openOffset: V(0, 4.6, 0) },
  ],

  // a breakable barricade choking the north cistern doorway — clear it with fire for a
  // faster central route (otherwise flank around the ring).
  destructibles: [
    { id: 'wr_w1', min: V(-1.6, 0, -6.2), max: V(1.6, 2.4, -5.8), hp: 60 },
  ],

  foliage: [],
  props: [],
});
