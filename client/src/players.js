import * as THREE from 'three';

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();

/**
 * RemotePlayers — visual-only representations of the other players.
 *
 * Avatars come from app.assets.characters.spawn(pack): a pack the local
 * client hasn't downloaded falls back to the default humanoid automatically.
 * Snapshots arrive via the engine's Net seam ('entity:update'); we store the
 * latest target and lerp toward it every frame. No physics bodies — remotes
 * are purely visual.
 */
export class RemotePlayers {
  constructor(app, localId) {
    this.app = app;
    this.localId = localId;
    this.remotes = new Map(); // id -> { group, target, snapped, username }

    app.net.on('entity:update', (snap) => {
      if (!snap || snap.id === this.localId) return;
      const r = this.remotes.get(snap.id);
      if (r) r.target = snap;
    });
  }

  async add(id, username, pack) {
    if (id === this.localId || this.remotes.has(id)) return;
    const avatar = await this.app.assets.characters.spawn(pack);
    const group = new THREE.Group();
    group.add(avatar);
    group.add(makeNameSprite(username));
    group.position.set(0, -100, 0); // parked underground until first snapshot
    this.app.scene.add(group);
    this.remotes.set(id, { group, target: null, snapped: false, username });
  }

  remove(id) {
    const r = this.remotes.get(id);
    if (!r) return;
    r.group.traverse((o) => {
      if (o.isMesh || o.isSprite) {
        o.geometry?.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => {
          m.map?.dispose();
          m?.dispose();
        });
      }
    });
    r.group.removeFromParent();
    this.remotes.delete(id);
  }

  /** Lerp every remote toward its latest snapshot target. Call per frame. */
  update(dt) {
    const k = 1 - Math.exp(-12 * dt);
    for (const r of this.remotes.values()) {
      if (!r.target?.p) continue;
      const o = r.group;
      if (!r.snapped) {
        o.position.set(r.target.p[0], r.target.p[1], r.target.p[2]);
        if (r.target.q) o.quaternion.set(r.target.q[0], r.target.q[1], r.target.q[2], r.target.q[3]);
        r.snapped = true;
        continue;
      }
      o.position.lerp(_v.set(r.target.p[0], r.target.p[1], r.target.p[2]), k);
      if (r.target.q) o.quaternion.slerp(_q.set(r.target.q[0], r.target.q[1], r.target.q[2], r.target.q[3]), k);
    }
  }

  clear() {
    for (const id of [...this.remotes.keys()]) this.remove(id);
  }
}

/** Floating username label (canvas texture sprite) at y≈2.2. */
function makeNameSprite(username) {
  const font = '600 44px system-ui, -apple-system, sans-serif';
  const meas = document.createElement('canvas').getContext('2d');
  meas.font = font;
  const w = Math.ceil(meas.measureText(username).width) + 40;
  const h = 64;

  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.font = font;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(8, 12, 18, 0.6)';
  pill(ctx, 2, 8, w - 4, h - 16, 14);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.fillText(username, 20, h / 2 + 2);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false })
  );
  const worldH = 0.42;
  sprite.scale.set((worldH * w) / h, worldH, 1);
  sprite.position.y = 2.2;
  return sprite;
}

function pill(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
