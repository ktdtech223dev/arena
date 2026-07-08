// RANGE — src/editor/EditorMeshes.js
// Visual builders for the editor. BLOCKS come from the shared block-mesh builder
// (src/world/blockmesh.js) so the editor preview matches how blocks render in
// play (WYSIWYG). That file is authored by another agent; until it is present we
// fall back to a plain colored box so the editor still works standalone and
// never throws. GAMEPLAY OBJECTS + LIGHTS are editor-only markers built here
// (they render as icons/gizmos in the world, not as the block builder).
import { buildBlockMesh, blockAabbHelper } from '../world/blockmesh.js';
import { BLOCK_TYPES, LIGHT_KINDS, OBJECT_KINDS } from '../../shared/custommap.js';

// ---- BLOCKS ----------------------------------------------------------------
// Returns an Object3D for one block record. Wraps the shared builder + guards
// against it being missing/throwing (parallel-agent safety) with a fallback box.
export function makeBlockMesh(THREE, block, materialCache) {
  if (typeof buildBlockMesh === 'function') {
    try {
      const m = buildBlockMesh(THREE, block, materialCache);
      if (m) return m;
    } catch (err) {
      console.warn('[editor] buildBlockMesh failed, using fallback', err);
    }
  }
  return fallbackBlockMesh(THREE, block);
}

// Wire-AABB helper for hover/selection outline. Wraps the shared helper + guards.
export function makeAabbHelper(THREE, block) {
  if (typeof blockAabbHelper === 'function') {
    try {
      const h = blockAabbHelper(THREE, block);
      if (h) return h;
    } catch (err) { /* fall through */ }
  }
  return fallbackAabbHelper(THREE, block);
}

function blockSize(block) {
  const def = BLOCK_TYPES[block.type] || { size: [1, 1, 1], color: 0x8794a4 };
  return [block.sx || def.size[0], block.sy || def.size[1], block.sz || def.size[2]];
}

function fallbackBlockMesh(THREE, block) {
  const def = BLOCK_TYPES[block.type] || { size: [1, 1, 1], color: 0x8794a4 };
  const s = blockSize(block);
  const g = new THREE.BoxGeometry(s[0], s[1], s[2]);
  const color = (typeof block.color === 'number') ? block.color : def.color;
  const emis = (block.emissive ?? def.emissive);
  const mat = new THREE.MeshStandardMaterial({
    color, roughness: 0.8, metalness: 0.1,
    emissive: emis != null ? new THREE.Color(emis) : new THREE.Color(0x000000),
    emissiveIntensity: emis != null ? 0.6 : 0,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.position.set(block.x || 0, block.y || 0, block.z || 0);
  mesh.rotation.y = (block.ry || 0);
  return mesh;
}

function fallbackAabbHelper(THREE, block) {
  const s = blockSize(block);
  const g = new THREE.BoxGeometry(s[0], s[1], s[2]);
  const edges = new THREE.EdgesGeometry(g);
  const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x7df9ff, depthTest: false, transparent: true, opacity: 0.95 }));
  line.renderOrder = 999;
  line.position.set(block.x || 0, block.y || 0, block.z || 0);
  line.rotation.y = (block.ry || 0);
  g.dispose();
  return line;
}

// ---- GAMEPLAY OBJECTS (editor markers) -------------------------------------
// A code-built icon so the author can see/place spawns/pickups. Not merged; the
// server derives real spawns/pickups from the data, these are visual only.
export function makeObjectMesh(THREE, obj) {
  const kind = obj.kind;
  const def = OBJECT_KINDS[kind] || { color: 0xffffff };
  const color = new THREE.Color(def.color);
  const group = new THREE.Group();

  if (kind === 'spawn') {
    // a pad + a facing arrow
    const pad = new THREE.Mesh(
      new THREE.CylinderGeometry(0.8, 0.9, 0.12, 20),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.55, roughness: 0.5, transparent: true, opacity: 0.85 }),
    );
    pad.position.y = 0.06;
    group.add(pad);
    const arrow = new THREE.Mesh(
      new THREE.ConeGeometry(0.28, 0.7, 4),
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: color, emissiveIntensity: 0.8 }),
    );
    arrow.rotation.x = Math.PI / 2;
    arrow.position.set(0, 0.5, 0.7);
    group.add(arrow);
    group.rotation.y = (obj.yaw || 0) * Math.PI / 180;
  } else {
    // pickups: a floating diamond over a ring
    const diamond = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.42, 0),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.7, roughness: 0.35, metalness: 0.2 }),
    );
    diamond.position.y = 0.9;
    group.add(diamond);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.55, 0.05, 8, 24),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.6 }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.14;
    group.add(ring);
  }
  group.position.set(obj.x || 0, obj.y || 0, obj.z || 0);
  return group;
}

// object marker AABB-ish bounds for raycast/selection (a box around the icon)
export function objectSelectBox(THREE, obj) {
  const g = new THREE.BoxGeometry(1.4, 1.6, 1.4);
  const edges = new THREE.EdgesGeometry(g);
  const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x7df9ff, depthTest: false, transparent: true, opacity: 0.95 }));
  line.renderOrder = 999;
  line.position.set(obj.x || 0, (obj.y || 0) + 0.7, obj.z || 0);
  g.dispose();
  return line;
}

// ---- LIGHTS (editor gizmo + real light) ------------------------------------
// Each placed light = a real THREE light (so the editor is lit like play) + a
// small billboard-ish gizmo so it can be selected/moved.
export function makeLightRig(THREE, light) {
  const group = new THREE.Group();
  const color = (typeof light.color === 'number') ? light.color : 0xffffff;
  const kind = light.kind === 'spot' ? 'spot' : 'point';
  const intensity = light.intensity ?? LIGHT_KINDS[kind].intensity;
  const dist = light.dist ?? LIGHT_KINDS[kind].dist;

  let real;
  if (kind === 'spot') {
    real = new THREE.SpotLight(color, intensity, dist, Math.PI / 5, 0.4, 2);
    real.target.position.set(0, -1, 0);
    group.add(real.target);
  } else {
    real = new THREE.PointLight(color, intensity, dist, 2);
  }
  group.add(real);

  // gizmo (a small glowing bulb so you can click it)
  const bulb = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 12, 8),
    new THREE.MeshBasicMaterial({ color }),
  );
  bulb.userData.__gizmo = true;
  group.add(bulb);

  group.position.set(light.x || 0, light.y || 0, light.z || 0);
  group.userData.__realLight = real;
  return group;
}

export function lightSelectBox(THREE, light) {
  const g = new THREE.BoxGeometry(0.7, 0.7, 0.7);
  const edges = new THREE.EdgesGeometry(g);
  const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x7df9ff, depthTest: false, transparent: true, opacity: 0.95 }));
  line.renderOrder = 999;
  line.position.set(light.x || 0, light.y || 0, light.z || 0);
  g.dispose();
  return line;
}
