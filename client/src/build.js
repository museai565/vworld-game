import * as THREE from 'three';
import { PROPS, PROP_ORDER } from './props.js';

/**
 * BuildMode — prop building tools.
 *
 * Tools: place / move / rotate / delete (keys Q/W/E/R, toolbar buttons, Esc
 * exits). Prop kinds: keys 1-8. Ghost previews come from app.build.ghost();
 * placement uses app.build.pick() against prop meshes + ground, snapped to
 * the grid. The client NEVER renders a prop optimistically — every place /
 * move / delete goes to the server and appears via the propAdd/propMove/
 * propDel echo.
 *
 * Key note: R selects the delete tool, but while a ghost is held (place mode
 * or move mode carrying a prop) R rotates the ghost 45° instead — one key,
 * context-sensitive.
 */
export class BuildMode {
  constructor(app, socket, props, ui, groundMesh) {
    this.app = app;
    this.socket = socket;
    this.props = props;
    this.ui = ui;
    this.groundMesh = groundMesh;

    this.tool = null;
    this.kind = 'brick';
    this.color = null; // null = the kind's default color
    this.ghost = null;
    this.ghostYaw = 0;
    this.carrying = null; // { id, kind } while move-tool is holding a prop
    this._lastHit = null;

    this._onKey = (e) => this._key(e);
    this._onMouseMove = (e) => this._mouseMove(e);
    this._onMouseDown = (e) => this._mouseDown(e);
    this._onMouseLeave = () => { if (this.ghost) this.ghost.visible = false; };

    window.addEventListener('keydown', this._onKey);
    const canvas = app.options.canvas;
    canvas.addEventListener('mousemove', this._onMouseMove);
    canvas.addEventListener('mousedown', this._onMouseDown);
    canvas.addEventListener('mouseleave', this._onMouseLeave);
  }

  // --- selection -----------------------------------------------------------
  setTool(tool) {
    if (this.tool === tool) tool = null; // tapping the active tool toggles off
    this.tool = tool;
    this.carrying = null;
    this.ghostYaw = 0;
    this._refreshGhost();
    this.ui.setActiveTool(tool);
    // Build tools need a free cursor — drop out of mouse-look.
    if (tool && this.app.input.pointerLocked) this.app.input.unlockPointer();
  }

  setKind(kind) {
    if (!PROPS[kind]) return;
    this.kind = kind;
    this.ghostYaw = 0;
    if (this.tool === 'place') this._refreshGhost();
    this.ui.setActiveKind(kind);
  }

  setColor(color) {
    this.color = color;
    this.ui.setActiveColor(color);
  }

  // --- ghost ---------------------------------------------------------------
  _ghostKind() {
    if (this.tool === 'place') return this.kind;
    if (this.tool === 'move' && this.carrying) return this.carrying.kind;
    return null;
  }

  _refreshGhost() {
    if (this.ghost) {
      this.app.build.clearGhost(this.ghost);
      this.ghost = null;
    }
    const kind = this._ghostKind();
    if (!kind) return;
    const spec = PROPS[kind];
    const tint = this.tool === 'move' ? 0x35c8e0 : 0x35e08a;
    this.ghost = this.app.build.ghost(new THREE.BoxGeometry(spec.w, spec.h, spec.d), tint);
    this.ghost.rotation.y = this.ghostYaw;
    this.ghost.visible = false;
  }

  _pickTargets() {
    const t = this.props.meshes();
    if (this.groundMesh) t.push(this.groundMesh);
    return t;
  }

  _pick(e) {
    return this.app.build.pick(e.clientX, e.clientY, this._pickTargets());
  }

  _mouseMove(e) {
    if (!this.tool || !this.ghost || this.app.input.pointerLocked) return;
    const hit = this._pick(e);
    this._lastHit = hit;
    if (!hit) {
      this.ghost.visible = false;
      return;
    }
    const spec = PROPS[this._ghostKind()];
    const s = this.app.build.snapVec3(hit.point);
    // Snap x/z to the grid; rest y on the hit surface (+ half height).
    this.ghost.position.set(s.x, hit.point.y + spec.h / 2, s.z);
    this.ghost.visible = true;
  }

  _mouseDown(e) {
    if (e.button !== 0 || !this.tool || this.app.input.pointerLocked) return;
    if (e.target !== this.app.options.canvas) return;
    const hit = this._pick(e) ?? this._lastHit;
    if (!hit) return;
    const propId = hit.object?.userData?.propId;

    if (this.tool === 'place') {
      if (!this.ghost?.visible) return;
      const spec = PROPS[this.kind];
      const g = this.ghost.position;
      this.socket.send({
        t: 'place',
        prop: {
          kind: this.kind,
          p: [+g.x.toFixed(2), +g.y.toFixed(2), +g.z.toFixed(2)],
          ry: +this.ghostYaw.toFixed(3),
          color: this.color ?? spec.color,
        },
      });
    } else if (this.tool === 'move') {
      if (!this.carrying) {
        if (!propId) return;
        const entry = this.props.get(propId);
        if (!entry) return;
        this.carrying = { id: propId, kind: entry.kind };
        this._refreshGhost();
      } else {
        if (!this.ghost?.visible) return;
        const g = this.ghost.position;
        this.socket.send({
          t: 'moveProp',
          id: this.carrying.id,
          p: [+g.x.toFixed(2), +g.y.toFixed(2), +g.z.toFixed(2)],
          ry: +this.ghostYaw.toFixed(3),
        });
        this.carrying = null;
        this._refreshGhost();
      }
    } else if (this.tool === 'rotate') {
      if (!propId) return;
      const entry = this.props.get(propId);
      if (!entry) return;
      const o = entry.entity.object;
      const p = o.position;
      this.socket.send({
        t: 'moveProp',
        id: propId,
        p: [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)],
        ry: +((o.rotation.y + Math.PI / 4) % (Math.PI * 2)).toFixed(3),
      });
    } else if (this.tool === 'delete') {
      if (!propId) return;
      this.socket.send({ t: 'delProp', id: propId });
    }
  }

  _rotateGhost() {
    this.ghostYaw = (this.ghostYaw + Math.PI / 4) % (Math.PI * 2);
    if (this.ghost) this.ghost.rotation.y = this.ghostYaw;
  }

  // --- keyboard --------------------------------------------------------------
  _key(e) {
    if (!this.app.input.enabled || e.repeat) return; // chat typing guard

    if (e.code === 'Escape') {
      if (this.tool) this.setTool(null);
      return;
    }
    if (/^Digit[1-8]$/.test(e.code)) {
      this.setKind(PROP_ORDER[Number(e.code.slice(5)) - 1]);
      return;
    }
    switch (e.code) {
      case 'KeyQ': this.setTool('place'); break;
      case 'KeyW': this.setTool('move'); break;
      case 'KeyE': this.setTool('rotate'); break;
      case 'KeyR':
        // Context-sensitive: rotate the held ghost, else pick delete tool.
        if (this.tool === 'place' || (this.tool === 'move' && this.carrying)) {
          this._rotateGhost();
        } else {
          this.setTool('delete');
        }
        break;
      default: break;
    }
  }

  destroy() {
    window.removeEventListener('keydown', this._onKey);
    const canvas = this.app.options.canvas;
    canvas.removeEventListener('mousemove', this._onMouseMove);
    canvas.removeEventListener('mousedown', this._onMouseDown);
    canvas.removeEventListener('mouseleave', this._onMouseLeave);
    if (this.ghost) this.app.build.clearGhost(this.ghost);
  }
}
