// ARENA — src/world/MapRenderer.js
// The map VISUAL factory. Each map is a bespoke MapEnv subclass (its own complete
// code-built environment). MapRenderer looks up the class for the map's id and
// instantiates it; a GenericEnv fallback renders the raw colliders for any map
// that doesn't yet have a bespoke class. Public API is unchanged so ArenaMode is
// untouched: constructor(ctx,map) · setMap(map) · syncDynamic(state,t) ·
// update(dt,t) · dispose() · resize(w,h) · .group / .map.
import * as THREE from 'three';
import { MapEnv } from './MapEnv.js';
import { Spire } from './maps/Spire.js';
import { Causeway } from './maps/Causeway.js';
import { Caldera } from './maps/Caldera.js';
import { Helix } from './maps/Helix.js';
import { Bastion } from './maps/Bastion.js';
import { Warren } from './maps/Warren.js';
import { Drift } from './maps/Drift.js';
import { Halo } from './maps/Halo.js';
import { Foundry } from './maps/Foundry.js';
import { CustomEnv } from './maps/CustomEnv.js';

// registry — add each bespoke map class here as it is built
const MAP_CLASSES = {
  spire: Spire,
  causeway: Causeway,
  caldera: Caldera,
  helix: Helix,
  bastion: Bastion,
  warren: Warren,
  drift: Drift,
  halo: Halo,
  foundry: Foundry,
};

// Fallback: renders the collider set as plain role-colored boxes + a default sky/
// light so a map with no bespoke class is still playable (used during buildout).
class GenericEnv extends MapEnv {
  buildEnvironment() {
    const mood = this.data.theme?.mood ?? 0x0c1018;
    this.fog(mood, 24, 150);
    this.sky(0x121a28, 0x06090f, (env) => env.skySpecks(120, 0xaac4e0, 360, 1));
    this.light('dir', { color: 0xe6eeff, intensity: 1.3, dir: { x: -0.4, y: -1, z: 0.3 }, shadow: true, shadowSize: 34 });
    this.light('hemi', { sky: 0x2a3c56, ground: 0x0a0e14, intensity: 0.55 });
    this.material('floor', { color: 0x1a222e, rough: 0.9 });
    this.material('wall', { color: 0x222c3a, rough: 0.8 });
    this.material('run', { color: 0x1e3050, emissive: 0x2a5cff, emissiveI: 0.4, metal: 0.4, rough: 0.5 });
    this.material('rampm', { color: 0x2a3444, emissive: 0x143a4a, emissiveI: 0.3 });
    for (const s of this.data.solids) {
      const h = s.max.y - s.min.y;
      const mat = s.wallrun ? 'run' : (s.min.y <= 0 && h <= 2.1 ? 'floor' : 'wall');
      this.solid(s.min.x, s.min.y, s.min.z, s.max.x, s.max.y, s.max.z, mat);
    }
    for (const rp of this.data.ramps) {
      const g = new THREE.BoxGeometry(rp.max.x - rp.min.x, Math.max(0.3, Math.abs(rp.h1 - rp.h0) + 0.3), rp.max.z - rp.min.z);
      const m = this.mesh(g, 'rampm', { shadow: true });
      m.position.set((rp.min.x + rp.max.x) / 2, (rp.h0 + rp.h1) / 2 - 0.15, (rp.min.z + rp.max.z) / 2);
    }
  }
}

export class MapRenderer {
  constructor(ctx, map) {
    this.ctx = ctx;
    this._env = null;
    this.setMap(map);
  }

  setMap(map) {
    if (this._env) this._env.dispose();
    this.map = map;
    // custom (user-authored) maps render through CustomEnv from their block/light/
    // skybox payload; built-ins use their bespoke class; anything else → GenericEnv.
    let Cls;
    if (map.custom) Cls = CustomEnv;
    else Cls = MAP_CLASSES[map.id] || GenericEnv;
    this._env = new Cls(this.ctx, map);
  }

  get group() { return this._env?.group; }

  syncDynamic(state, t) { this._env?.syncDynamic(state, t); }
  update(dt, t) { this._env?.update(dt, t); }
  resize(w, h) { this._env?.resize(w, h); }
  dispose() { this._env?.dispose(); this._env = null; }
}

export { MAP_CLASSES, GenericEnv };
