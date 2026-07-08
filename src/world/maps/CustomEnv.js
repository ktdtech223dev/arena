// ARENA map — CUSTOM (user-authored)
// ============================ MAP DESIGN CONTRACT ============================
// Renders a USER-BUILT custom map from its data payload (this.data.blocks /
// .lights / .skybox) produced by shared/custommap.js customToMapData(). It is the
// visual twin of the shared collider set: every solid/ramp block is rendered so
// the geometry MATCHES the colliders the server + prediction use. Phase 1D
// philosophy — READABLE: a real sky + fog + a directional KEY (the one shadow
// caster) + hemisphere/ambient FILL from the chosen SKYBOX_PRESET, neon as accent.
//
// PERF (2F "merge on play"): static axis-aligned solid blocks are MERGED by
// material into the MapEnv batch (this.solid) — a whole map of same-coloured
// blocks becomes a few draw calls, matching built-in maps. Shaped blocks
// (pillar/arch/ramp/runwall/jumppad) are built via the shared buildBlockMesh and
// their geometry is BAKED into the batch (applyMatrix4) where the material is a
// plain lit solid; additive/unlit accents (neon, glow strips) are placed as small
// standalone meshes. Placed point/spot lights (already capped ≤10, shadowless)
// come from this.data.lights. Never throws on malformed block/light data.
// ============================================================================
import * as THREE from 'three';
import { MapEnv } from '../MapEnv.js';
import { buildBlockMesh } from '../blockmesh.js';
import { BLOCK_TYPES, SKYBOX_PRESETS } from '../../../shared/custommap.js';

const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _e = new THREE.Euler();
const RUN_CYAN = 0x18b6d8;

export class CustomEnv extends MapEnv {
  buildEnvironment() {
    const preset = SKYBOX_PRESETS[this.data?.skybox] || SKYBOX_PRESETS.night;
    this._preset = preset;
    this._applyPreset(preset);
    this._buildBlocks();
    this._placeLights();
    this._placePickupMarkers(); // static pad markers; PickupView owns live pickups
  }

  // ---- sky + fog + lighting rig from the chosen preset -----------------------
  _applyPreset(p) {
    // fog: [color, near, far]
    const fog = Array.isArray(p.fog) ? p.fog : [0x0a1220, 40, 200];
    this.fog(fog[0], fog[1], fog[2]);
    // gradient sky + optional stars (accent-coloured specks)
    this.sky(p.skyTop, p.skyBot, (env) => {
      if (p.stars) env.skySpecks(Math.min(p.stars, 400), p.accent, 380, 1.1);
    });
    // KEY directional — the ONE shadow caster.
    const kd = (p.key && Array.isArray(p.key.dir)) ? p.key.dir : [0.4, -1, 0.3];
    this.light('dir', {
      color: p.key?.color ?? 0xffffff, intensity: p.key?.intensity ?? 1.5,
      dir: { x: kd[0], y: kd[1], z: kd[2] }, shadow: true, shadowSize: 44,
    });
    // hemisphere FILL (sky/ground)
    this.light('hemi', {
      sky: p.hemi?.sky ?? 0x3a5c94, ground: p.hemi?.ground ?? 0x141a26,
      intensity: p.hemi?.intensity ?? 1.2,
    });
    // flat ambient floor so no corner crushes to black (mid tone from the mood)
    this.light('ambient', { color: midTone(p), intensity: p.amb ?? 0.5 });
  }

  // ---- blocks -> merged solids + baked shapes + accents ----------------------
  _buildBlocks() {
    const blocks = Array.isArray(this.data?.blocks) ? this.data.blocks : [];
    this._matCache = new Map(); // color|emissive -> THREE material (for standalone builds)
    for (const b of blocks) {
      try { this._buildOneBlock(b); } catch (e) { /* never let one bad block break the map */ }
    }
  }

  _buildOneBlock(b) {
    if (!b || typeof b !== 'object') return;
    const def = BLOCK_TYPES[b.type];
    if (!def) return; // unknown type → skip (guarded)
    // dynamic/networked types (doors, breakables, barrels, hazards) are drawn +
    // animated by MapEnv._buildDynamicObjects from data.doors/destructibles/etc.,
    // so DON'T also draw them here as static blocks (double-draw + wouldn't move).
    if (def.door || def.destructible || def.barrel || def.hazard) return;
    const s = [num(b.sx, def.size[0]), num(b.sy, def.size[1]), num(b.sz, def.size[2])];
    const x = num(b.x, 0), y = num(b.y, 0), z = num(b.z, 0), ry = num(b.ry, 0);
    const color = (typeof b.color === 'number') ? b.color : def.color;
    const emissive = (typeof b.emissive === 'number') ? b.emissive : (def.emissive || 0);
    const wallrun = (b.wallrun != null) ? !!b.wallrun : !!def.wallrun;

    // classify: a plain axis-aligned lit BOX can merge straight into the batch.
    // `shaped` props (crate/container/beacon/fence/rock) have a custom mesh, so
    // they take the buildBlockMesh path instead of merging into a plain box.
    const isBox = def.cat !== 'ramp' && !def.round && !def.arch && !def.pad
      && !def.emissiveOnly && !def.shaped && !wallrun && b.type !== 'runwall';
    const axisAligned = Math.abs(((ry % (Math.PI / 2)) + Math.PI) % (Math.PI / 2)) < 1e-3
      || Math.abs(ry) < 1e-3;

    if (isBox && axisAligned) {
      // cheapest path: queue an AABB into the shared batch by material key.
      const matKey = this._solidMat(color, emissive);
      // account for 90°/270° yaw swapping x/z extents (keeps the visual box tight)
      let ex = s[0] / 2, ez = s[2] / 2;
      const quarter = Math.round(ry / (Math.PI / 2));
      if (((quarter % 2) + 2) % 2 === 1) { const t = ex; ex = ez; ez = t; }
      this.solid(x - ex, y - s[1] / 2, z - ez, x + ex, y + s[1] / 2, z + ez, matKey);
      return;
    }

    // shaped / rotated / accent block: build via the shared per-block builder.
    const obj = buildBlockMesh(THREE, b, this._matCache);
    if (!obj) return;

    // Try to BAKE lit-solid geometry into the batch (low draw calls). We only bake
    // simple single-mesh lit shapes (pillar, plain rotated box) — grouped/emissive
    // builds (arch legs, ramps with strips, runwall stripes, neon, jumppad arrows)
    // are placed standalone so their additive/unlit accents render correctly.
    const bakeable = obj.isMesh && obj.material && obj.material.isMeshStandardMaterial;
    if (bakeable) {
      const matKey = this._solidMat(color, obj.material.emissive ? obj.material.emissive.getHex() : emissive, obj.material.emissiveIntensity);
      obj.updateMatrix();
      const geo = obj.geometry.clone();
      geo.applyMatrix4(obj.matrix);
      this.addGeo(geo, matKey);
      // dispose the throwaway builder mesh's geometry (we cloned into the batch)
      obj.geometry.dispose?.();
      return;
    }

    // standalone placement (groups / basic-additive accents). These are code-built
    // and few; frustum-culled by default. runwall keeps its cyan accent (built in).
    obj.traverse?.((o) => { if (o.isMesh) { o.castShadow = o.castShadow ?? true; o.receiveShadow = true; } });
    this.group.add(obj);
    // track for dispose (geometry + materials in the group are freed by traverse
    // in our dispose override below)
    (this._standalone || (this._standalone = [])).push(obj);
  }

  // Register (once) a lit solid material for color|emissive and return its batch
  // key. Uses MapEnv.material() so the batch flush picks it up + dispose frees it.
  _solidMat(color, emissive, emissiveI) {
    const key = `cm:${color >>> 0}|${(emissive || 0) >>> 0}|${emissiveI || 0}`;
    if (!this._mats.has(key)) {
      this.material(key, {
        color: color != null ? color : 0x8794a4,
        rough: 0.82, metal: emissive ? 0.3 : 0.12,
        emissive: emissive || undefined, emissiveI: emissive ? (emissiveI || 0.4) : undefined,
      });
    }
    return key;
  }

  // ---- placed lights (capped ≤10 upstream; all shadowless for budget) --------
  _placeLights() {
    const lights = Array.isArray(this.data?.lights) ? this.data.lights : [];
    for (const l of lights) {
      if (!l) continue;
      const pos = { x: num(l.x, 0), y: num(l.y, 0), z: num(l.z, 0) };
      const color = (typeof l.color === 'number') ? l.color : 0xffffff;
      const intensity = num(l.intensity, 2);
      const dist = num(l.dist, 16);
      if (l.kind === 'spot') {
        // MapEnv.light() has no 'spot' branch — build a real cone here so authored
        // spots read as spots (shadowless; the preset owns the one shadow caster).
        const sp = new THREE.SpotLight(color, intensity, dist, Math.PI / 5, 0.4, 2);
        sp.position.set(pos.x, pos.y, pos.z);
        sp.target.position.set(pos.x, pos.y - 4, pos.z);
        this.group.add(sp); this.group.add(sp.target);
        this._lights.push(sp);
      } else {
        this.light('point', { color, intensity, dist, pos });
      }
    }
  }

  // ---- static jump-pad markers (live weapon/health pickups = PickupView) ------
  // The data.pads array (from customToMapData) marks jump pads already rendered as
  // blocks; nothing extra needed. Pickup MARKERS are owned by PickupView so they
  // can show taken/respawn state — CustomEnv only builds the world here.
  _placePickupMarkers() { /* PickupView owns live pickup markers */ }

  // ---- dispose: free standalone group geometry/materials too -----------------
  dispose() {
    if (this._standalone) {
      for (const obj of this._standalone) {
        obj.traverse?.((o) => {
          if (o.isMesh) {
            o.geometry?.dispose?.();
            const m = o.material;
            if (Array.isArray(m)) m.forEach((x) => x.dispose?.());
            else m?.dispose?.();
          }
        });
      }
      this._standalone.length = 0;
    }
    if (this._matCache) { for (const m of this._matCache.values()) m.dispose?.(); this._matCache.clear(); }
    super.dispose();
  }
}

// a mid tone between sky/ground of the preset for the ambient fill.
function midTone(p) {
  try {
    const sky = new THREE.Color(p.hemi?.sky ?? 0x3a5c94);
    const gnd = new THREE.Color(p.hemi?.ground ?? 0x141a26);
    return sky.lerp(gnd, 0.5).getHex();
  } catch { return 0x2a3a56; }
}

function num(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : d; }

export { RUN_CYAN };
