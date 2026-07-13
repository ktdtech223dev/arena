// ARENA map DATA — BASTION (collider/spawn/mechanic truth; THREE-free, shared
// with the server). Visuals live in src/world/maps/Bastion.js (full contract there).
// An asymmetric fortress under siege: the −Z half is a HIGH fortified KEEP with
// battlement walkways commanding the field; the +Z half is a LOW siege field of
// trenches/craters cut BELOW grade. A great curtain WALL with a shattered BREACH +
// a portcullis GATE divides them; a moat/ravine (water hazard) rings the low side.
// Footprint x±22, z −34(keep)→34(field), height y-2(trench)→y10(battlements). Split axis = Z.
import { V, box, spawn, normalizeMap } from '../mapkit.js';

// a merlon-style battlement cap bar (visual crenellation is added in the class; the
// collider is a single low parapet the length of a walkway edge)
const parapet = (x0, z0, x1, z1) => box(x0, 10, z0, x1, 11, z1);

export const data = normalizeMap({
  id: 'bastion', name: 'Bastion',
  theme: { name: 'Siege', accent: 0x18b6d8, mood: 0x141a1c },
  solids: [
    // ─── CATCH FLOOR (far below the moat/ravine) ───────────────────────────
    box(-60, -20, -60, 60, -19, 60),                         // world catch floor under the water hazard

    // ══════════════ HIGH KEEP HALF (−Z) — raised, commanding ══════════════
    // keep courtyard floor (mid-high tier, y3) — max.z extended -3 → -2 to close the
    // KEEP↔BREACH ground seam (nothing floored z(-3,-2); now the courtyard meets the
    // curtain-wall/breach-rubble line flush at z=-2 so the breach is a continuous exit)
    box(-16, 2.4, -30, 16, 3, -2),
    // keep back rampart / rear wall (boundary at the −Z end, wall-runnable inner face)
    box(-18, 2.4, -34, 18, 12, -30, { wallrun: true }),
    // keep side walls (boundary), enclosing the courtyard E/W, wall-runnable inner faces
    box(-18, 2.4, -34, -16, 12, -3, { wallrun: true }),      // west keep wall
    box(16, 2.4, -34, 18, 12, -3, { wallrun: true }),        // east keep wall
    // BATTLEMENT WALKWAYS (high tier, y10) — the commanding walk atop the side walls
    box(-18, 9.6, -30, -14, 10, -3),                         // west battlement walk
    box(14, 9.6, -30, 18, 10, -3),                           // east battlement walk
    box(-18, 9.6, -34, 18, 10, -30),                         // rear battlement walk (joins E/W)
    // parapet lips on the battlements (low cover on the courtyard-facing edge)
    parapet(-14.4, -30, -13.6, -3),                          // west inner parapet
    parapet(13.6, -30, 14.4, -3),                            // east inner parapet
    parapet(-18, -30.8, 18, -30),                            // rear parapet
    // KEEP TOWER — a tall square keep tower at the NW inner corner, wall-run faces,
    // top perch is the highest commanding point over both halves
    box(-13, 3, -27, -7, 13, -21, { wallrun: true }),        // tower shaft (solid, wall-runnable)
    box(-13.4, 12.8, -27.4, -6.6, 13.4, -20.6),              // tower roof perch cap (y13)

    // ══════════════ CURTAIN WALL — divides the halves (z ≈ −2..2) ══════════
    // wall spans x −18..18 with a shattered BREACH gap kept open at x −5..3.
    // west wall segment (from west keep wall to the breach) — top is walkable at y10
    box(-18, -0.4, -2, -5, 10, 2, { wallrun: true }),
    // east wall segment (from the breach/gate to east keep wall)
    box(7, -0.4, -2, 18, 10, 2, { wallrun: true }),
    // gatehouse jamb between breach and gate opening (x 3..7 pillar, holds the portcullis)
    box(3, -0.4, -2, 7, 10, 2, { wallrun: true }),
    // rubble mound FLOOR filling the BREACH gap at courtyard grade (y3) — the passable
    // rubble the wall collapsed into, bridging keep(z-3) ↔ landing(z2) through the wall line
    box(-5, -0.4, -2, 3, 3, 2),                              // breach rubble floor (y3, spans the wall thickness)
    box(1, 3, -2, 3, 3.6, 2),                                // east breach stub (taller broken chunk on top)
    // wall-top walkway caps (the walkable top of the curtain wall, y10, ties into battlements)
    box(-18, 9.6, -2.4, -5, 10, 2.4),                        // west wall-top walk
    box(7, 9.6, -2.4, 18, 10, 2.4),                          // east wall-top walk

    // ══════════════ MID COURTYARD — the contested pinch at the breach ══════
    // a landing bridging the breach at courtyard grade (y3), connecting keep ↔ ramp
    box(-6, 2.4, 2, 8, 3, 6),

    // ══════════════ LOW SIEGE FIELD HALF (+Z) — below grade ════════════════
    // siege field grade floor (low tier, y0) — the open muddy field, SPLIT into pieces
    // that leave the three below-grade TRENCH rects OPEN (were buried under a single
    // continuous slab, burying the trench floors + spawn[5] and masking the access ramps).
    // Trench rects left open: west x[-14,-2]z[12,16] · east x[2,14]z[20,24] · rear x[-8,8]z[24,28].
    // (Ramp columns stay grade-covered — a below-grade player isn't masked by the slab, so
    // the access ramps still lift climbers out; see movement-core resolveVertical.)
    box(-16, -0.4, 6, 16, 0, 12),                           // z[6,12] full
    box(-16, -0.4, 12, -14, 0, 16),                         // z[12,16] west of the west trench
    box(-2, -0.4, 12, 16, 0, 16),                           // z[12,16] east of the west trench
    box(-16, -0.4, 16, 16, 0, 20),                          // z[16,20] full
    box(-16, -0.4, 20, 2, 0, 24),                           // z[20,24] west of the east trench
    box(14, -0.4, 20, 16, 0, 24),                           // z[20,24] east of the east trench
    box(-16, -0.4, 24, -8, 0, 28),                          // z[24,28] west of the rear trench
    box(8, -0.4, 24, 16, 0, 28),                            // z[24,28] east of the rear trench
    box(-16, -0.4, 28, 16, 0, 30),                          // z[28,30] full
    // FIELD-FRONT APRONS (y0) flanking the y3 breach landing across z[2,6] — close the two
    // unwalled RAVINE PITS between the curtain wall (z=2) and the field front edge (z=6)
    // that dropped flank players ~19m onto the dry catch floor (no water hazard covers this band).
    box(-18, -0.4, 2, -6, 0, 6),                            // west field-front apron
    box(8, -0.4, 2, 18, 0, 6),                              // east field-front apron
    // outer field walls (boundary, E/W), lower + wall-runnable inner faces
    box(-18, -0.4, 6, -16, 6, 34, { wallrun: true }),        // west field wall
    box(16, -0.4, 6, 18, 6, 34, { wallrun: true }),          // east field wall
    box(-18, -0.4, 30, 18, 6, 34, { wallrun: true }),        // far siege wall (+Z boundary)
    // TRENCHES cut BELOW grade (y-2) — tight cornered cover lanes across the field
    box(-14, -2.4, 12, -2, -2, 16),                          // west trench floor
    box(2, -2.4, 20, 14, -2, 24),                            // east trench floor (staggered)
    box(-8, -2.4, 24, 8, -2, 28),                            // rear cross-trench floor
    // trench parapet lips (low cover edges rising from grade, y0..y1)
    box(-14, 0, 11.6, -2, 1, 12),                            // west trench near lip
    box(-14, 0, 16, -2, 1, 16.4),                            // west trench far lip
    box(2, 0, 19.6, 14, 1, 20),                              // east trench near lip
    box(2, 0, 24, 14, 1, 24.4),                              // east trench far lip
    // CRATER + siege cover blocks scattered on the field (waist/chest-high cover)
    box(-6, 0, 8, -2, 1.6, 11),                              // sandbag block (approach cover)
    box(4, 0, 9, 8, 2.2, 12),                                // ruined cart / timber pile (taller)
    box(-12, 0, 26, -8, 1.8, 29),                            // rubble heap NW field
    box(9, 0, 26, 13, 1.4, 28),                              // low crater rim SE field
    // siege ramp/earthwork toward the wall-top on the east (a covered climb up to y6)
    box(15.6, 5.6, 8, 18, 6, 14),                            // east wall ledge landing (top of field wall, y6)
  ],
  ramps: [
    // ── ROUTE 1: the BREACH ramp — low field (y0) → mid courtyard landing (y3)
    // rides the rubble mound up through the shattered wall. Primary low→high push.
    { min: V(-2, 0, 2), max: V(2, 3, 8), axis: 'z', h0: 3, h1: 0 },
    // ── ROUTE (interior): mid courtyard landing (y3) → keep courtyard floor (y3 is flat;
    // the keep floor is y3, landing is y3 — they meet; this ramp bridges the y0 field lip)
    // field grade dip → field floor is y0; a short ramp from field(y0) up onto the breach stub area
    { min: V(-6, 0, 6), max: V(-2, 3, 10), axis: 'z', h0: 3, h1: 0 },  // west assist ramp field→landing
    // ── KEEP INTERNAL: courtyard floor (y3) → battlement walk (y10) via a stair on the west
    { min: V(-16, 3, -12), max: V(-14, 10, -4), axis: 'z', h0: 10, h1: 3 }, // west keep stair up to battlement
    { min: V(14, 3, -28), max: V(16, 10, -20), axis: 'z', h0: 3, h1: 10 },  // east keep stair up to battlement
    // ── ROUTE 2 support: east field earthwork ramp — field (y0) → east wall ledge (y6)
    { min: V(15.6, 0, 14), max: V(18, 6, 22), axis: 'z', h0: 0, h1: 6 },
    // and from that y6 ledge, a short ramp up onto the east wall-top walk (y6→y10)
    { min: V(15.6, 6, 4), max: V(18, 10, 8), axis: 'z', h0: 6, h1: 10 },
    // ── TRENCH access ramps (grade y0 → trench floor y-2)
    { min: V(-2, -2, 12), max: V(0, 0, 16), axis: 'z', h0: 0, h1: -2 },    // out of west trench (east end)
    { min: V(0, -2, 20), max: V(2, 0, 24), axis: 'z', h0: -2, h1: 0 },     // out of east trench (west end)
  ],
  spawns: [
    // KEEP side (high) — staggered courtyard + battlement, facing the field/down. No two
    // keep spawns share a z or x line; the tower + parapets break the diagonals.
    spawn(-14.5, 3, -26, 180),                               // NW keep courtyard (deep), facing field — moved clear of the solid keep-tower shaft (was inside x[-13,-7])
    spawn(11, 3, -8, 200),                                   // E keep courtyard (near-wall), facing field-ward
    spawn(-15, 10, -20, 120),                                // W battlement walk (deep), overlooking the field — nudged inward off the x=-16 keep-wall seam
    // SIEGE side (low) — staggered field + trench, tight facings toward the wall/breach
    spawn(14, 0, 27, 340),                                   // SE field (deep), facing the wall — nudged off the SE crater-rim block (x[9,13])
    spawn(-11, 0, 10.5, 20),                                 // W field (near-wall), facing the breach — moved south of the west-trench lip/hole onto clear grade
    spawn(0, -2, 26, 0),                                     // rear cross-trench (below grade), fully cornered
  ],
  barrels: [
    { id: 'bs_b1', pos: V(5, 0, 10), hp: 35 },              // by the timber pile cover (low field)
    { id: 'bs_b2', pos: V(-4, 3, 4), hp: 35 },              // on the breach landing (the pinch)
    { id: 'bs_b3', pos: V(-10, 3, -6), hp: 35 },            // keep courtyard, near the tower base
  ],
  // ── PORTCULLIS GATE: a proximity door in the gatehouse jamb opening (x 3..7) that
  // RAISES (slides up y+10) — the third low→high route once triggered. Solid until ~85% up.
  doors: [
    { id: 'bs_gate', min: V(3, -0.4, -1), max: V(7, 9.6, 1), trigger: 'proximity', openOffset: V(0, 10, 0) },
  ],
  // rising siege elevator on the west field — an alt vertical route field(y0) ↔ wall-top(y10)
  platforms: [{ id: 'bs_lift', from: V(-17, 0, 4), to: V(-17, 9.6, 4), size: V(1.4, 0.2, 1.4), period: 9, phase: 0 }],
  hazards: [
    // MOAT / RAVINE ringing the low side — a flooded ditch. Falling in the moat kills.
    { id: 'bs_moatE', type: 'water', min: V(18, -18, 6), max: V(30, -1, 34), dps: 200 },   // east moat
    { id: 'bs_moatW', type: 'water', min: V(-30, -18, 6), max: V(-18, -1, 34), dps: 200 }, // west moat
    { id: 'bs_moatS', type: 'water', min: V(-30, -18, 34), max: V(30, -1, 46), dps: 200 }, // far moat (behind siege wall)
  ],
  // shootable breach barricade — a timber palisade plugging part of the breach you can clear with fire
  destructibles: [
    { id: 'bs_pal1', min: V(-3, 3, -0.4), max: V(1, 5, 0.4), hp: 70 },   // palisade across the breach mouth
    { id: 'bs_pal2', min: V(6, 0, 22), max: V(9, 1.8, 22.4), hp: 55 },   // field cover plank wall
  ],
  foliage: [],
  props: [],
});
