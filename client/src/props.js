import * as THREE from 'three';

/**
 * Prop catalog — dimensions in meters, matching the server's validation.
 * Each prop is an engine Entity (box mesh; lamp gets an emissive material)
 * plus a STATIC physics body so players collide with placed props.
 */
export const PROPS = {
  brick: { w: 1,   h: 0.5, d: 0.5,  color: 0xb5533c, name: 'Brick' },
  wall:  { w: 4,   h: 3,   d: 0.3,  color: 0xc9b896, name: 'Wall' },
  floor: { w: 4,   h: 0.3, d: 4,    color: 0x8a6f4d, name: 'Floor' },
  roof:  { w: 4.5, h: 0.3, d: 4.5,  color: 0x7a3b2e, name: 'Roof' },
  door:  { w: 1.2, h: 2.4, d: 0.15, color: 0x6b4a2f, name: 'Door' },
  table: { w: 1.6, h: 0.8, d: 0.9,  color: 0x9a7448, name: 'Table' },
  chair: { w: 0.5, h: 0.9, d: 0.5,  color: 0x7c5a36, name: 'Chair' },
  lamp:  { w: 0.3, h: 1.6, d: 0.3,  color: 0xffe08a, name: 'Lamp', emissive: true },
};

export const PROP_ORDER = ['brick', 'wall', 'floor', 'roof', 'door', 'table', 'chair', 'lamp'];

/** Build the visual Entity for a prop. p = [x,y,z] center, ry = yaw radians. */
export function createPropEntity(app, { kind, p, ry = 0, color }) {
  const spec = PROPS[kind];
  if (!spec) throw new Error(`[VWorld] Unknown prop kind "${kind}"`);
  const c = color ?? spec.color;
  const entity = app.entity().box(spec.w, spec.h, spec.d, c);
  if (spec.emissive) {
    entity.object.traverse((o) => {
      if (o.isMesh) {
        o.material.emissive = new THREE.Color(c);
        o.material.emissiveIntensity = 1.0;
      }
    });
  }
  entity.at(p[0], p[1], p[2]).rotateY(ry);
  return entity;
}

/**
 * Static collider for a prop. The BodyBuilder has no rotation setter, so yaw
 * is applied once via the raw body's setRotation right after build — a
 * single sanctioned call, not a physics reinvention.
 */
function makeStaticBody(app, spec, p, ry) {
  const body = app.physics
    .body()
    .static()
    .cuboid(spec.w, spec.h, spec.d)
    .at(p[0], p[1], p[2])
    .friction(0.9)
    .build();
  if (ry) {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0));
    body.raw.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
  }
  return body;
}

/**
 * PropManager — owns every replicated prop: id -> { entity, body, kind }.
 * Props render only from server echoes (propAdd/propMove/propDel) — the
 * client never renders optimistically.
 */
export class PropManager {
  constructor(app) {
    this.app = app;
    this.props = new Map();
  }

  /** Add a prop from a server propAdd payload { id, kind, p, ry, color }. */
  add(prop) {
    if (this.props.has(prop.id)) return this.props.get(prop.id);
    const spec = PROPS[prop.kind];
    if (!spec) return null;
    const entity = createPropEntity(this.app, prop);
    entity.object.traverse((o) => { o.userData.propId = prop.id; });
    const body = makeStaticBody(this.app, spec, prop.p, prop.ry || 0);
    const entry = { id: prop.id, kind: prop.kind, entity, body };
    this.props.set(prop.id, entry);
    return entry;
  }

  /** Apply a server propMove: destroy + recreate the static body (new yaw),
   *  keep the visual entity and retarget it. */
  move(id, p, ry = 0) {
    const entry = this.props.get(id);
    if (!entry) return;
    entry.body.destroy();
    entry.body = makeStaticBody(this.app, PROPS[entry.kind], p, ry);
    entry.entity.at(p[0], p[1], p[2]).rotation(0, ry, 0);
  }

  del(id) {
    const entry = this.props.get(id);
    if (!entry) return;
    entry.body.destroy();
    entry.entity.dispose(); // v1.0: destroy() -> dispose() (shim still works, but use the canonical name)
    this.props.delete(id);
  }

  get(id) {
    return this.props.get(id);
  }

  /** Flat mesh list for raycast picking (build tools). */
  meshes() {
    const out = [];
    for (const { entity } of this.props.values()) {
      entity.object.traverse((o) => { if (o.isMesh) out.push(o); });
    }
    return out;
  }

  clear() {
    for (const id of [...this.props.keys()]) this.del(id);
  }
}
