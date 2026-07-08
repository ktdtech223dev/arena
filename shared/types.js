// ARENA — shared message + state shapes (JSDoc typedefs; this is plain JS).
// Documents the wire protocol and movement state so client & server agree.
// See ARENA-ARCHITECTURE.md §2/§3/§4. Vectors are {x,y,z}; angles in degrees;
// times in ms.

/** @typedef {{x:number,y:number,z:number}} Vec3 */

/** @typedef {'GROUNDED'|'AIRBORNE'|'SLIDING'|'WALLRUN'} MoveStateName */

/**
 * One client input frame. Stamped with a monotonic seq, applied locally
 * (prediction) and sent to the server (authority). Fed to stepMovement().
 * @typedef {Object} InputCmd
 * @property {number} seq        monotonic per-client input sequence
 * @property {number} dtMs       fixed input frame length (ms)
 * @property {{f:number,r:number}} move  forward/right in [-1,1]
 * @property {{yaw:number,pitch:number}} look  absolute aim (degrees)
 * @property {number} buttons    BTN bitmask (JUMP|CROUCH|SPRINT)
 */

/**
 * A shot the client fires; server lag-comp resolves it authoritatively.
 * @typedef {Object} FireCmd
 * @property {number} seq        input seq at fire time
 * @property {number} fireTime   client clock ms when fired (server rewinds to this)
 * @property {string} weaponId
 * @property {Vec3} origin        muzzle/eye world origin
 * @property {Vec3} dir           normalized aim direction
 * @property {number} ads         0..1
 */

/**
 * Authoritative per-player state inside a snapshot.
 * @typedef {Object} SnapPlayer
 * @property {string} id
 * @property {Vec3} pos           feet position
 * @property {Vec3} vel           velocity (dead-reckoning only)
 * @property {number} yaw
 * @property {number} pitch
 * @property {MoveStateName} state
 * @property {boolean} ground
 * @property {number} hp
 * @property {boolean} alive
 * @property {string} weaponId
 * @property {boolean} firing
 */

/**
 * A live server-authoritative projectile, echoed in every snapshot so all clients
 * render identical flight/bounces.
 * @typedef {Object} SnapProjectile
 * @property {number} id
 * @property {'sawblade'|'rocket'|'seeker'|'grenade'} kind
 * @property {Vec3} pos
 * @property {Vec3} vel
 * @property {string} owner   shooter id
 * @property {number} t       elapsed life (s)
 */

/**
 * Full-state snapshot sent every server tick, per client (carries that client's ack).
 * @typedef {Object} Snapshot
 * @property {number} tick
 * @property {number} serverTime
 * @property {number} ack         last input seq the server processed for THIS client
 * @property {SnapPlayer[]} players
 * @property {SnapProjectile[]} projectiles
 */

/**
 * A world FX event broadcast when a projectile bounces or explodes (particles +
 * sound + local shake on all clients).
 * @typedef {Object} BoomEvent
 * @property {'explosion'|'grenade'|'bounce'|'seeker'} kind
 * @property {Vec3} pos
 * @property {number} radius
 */

/**
 * Death broadcast (drives kill feed + kill cam).
 * @typedef {Object} DeathEvent
 * @property {string} id          victim
 * @property {string} by          killer id (may equal id for self/world)
 * @property {string} weapon      weapon/means id
 * @property {boolean} headshot
 * @property {number} respawnInMs
 */

/**
 * Public identity broadcast on join (no per-tick state).
 * @typedef {Object} PublicPlayer
 * @property {string} id
 * @property {string} crew        crew key
 * @property {string} name
 * @property {number} color
 * @property {string} weaponId
 */

// Re-export nothing at runtime; this file is documentation the tooling reads.
export {};
