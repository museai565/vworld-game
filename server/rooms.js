// rooms.js — authoritative per-room state for the VWorld game server.
//
// A Room holds every player and prop in the shared world. All game rules
// (player cap, prop cap, placement bounds, validation) are enforced here so
// every client sees a single consistent world. The server never trusts
// client-supplied state without validating it first.
import { saveRoomDebounced, flushRoom } from './store.js';

export const MAX_PLAYERS = 30; // protocol requirement: 10–30 players per room
export const MAX_PROPS = 500; // per-room prop cap
export const MOVE_EPSILON = 0.005; // position delta below which a 'move' is ignored

// Props the server will accept for placement / moves.
export const PROP_KINDS = new Set([
  'brick',
  'wall',
  'floor',
  'roof',
  'door',
  'table',
  'chair',
  'lamp',
]);

const isNum = (n) => typeof n === 'number' && Number.isFinite(n);

// Build area: |x| <= 100, |z| <= 100, 0 <= y <= 50.
function validPropTransform(p) {
  if (!Array.isArray(p) || p.length !== 3) return false;
  const [x, y, z] = p;
  return (
    isNum(x) &&
    isNum(y) &&
    isNum(z) &&
    Math.abs(x) <= 100 &&
    Math.abs(z) <= 100 &&
    y >= 0 &&
    y <= 50
  );
}

// Spawn ring: players fan out around the origin so they don't stack.
export function spawnPoint(index) {
  const angle = index * 2.4;
  const r = 4 + (index % 3) * 2;
  return [Math.cos(angle) * r, 3, Math.sin(angle) * r];
}

export class Room {
  constructor(code, { props = [] } = {}) {
    this.code = code;
    // id -> { ws, username, pack, p, q, moved, lastChatAt }
    this.players = new Map();
    // id -> { id, kind, p, ry, color }
    this.props = new Map();
    this.nextPropId = 1;

    // Restore props persisted from a previous session, keeping their ids
    // stable so the counter never collides with a reloaded prop.
    for (const prop of props) {
      if (!prop || typeof prop.id !== 'string') continue;
      this.props.set(prop.id, { ...prop, p: [...prop.p] });
      const n = /^p_(\d+)$/.exec(prop.id);
      if (n) this.nextPropId = Math.max(this.nextPropId, Number(n[1]) + 1);
    }
  }

  // ---- players ---------------------------------------------------------

  // Adds a player and returns their spawn transform.
  addPlayer(id, ws, username, pack) {
    const index = this.players.size;
    const p = spawnPoint(index);
    this.players.set(id, {
      ws,
      username,
      pack,
      p,
      q: [0, 0, 0, 1],
      moved: false, // tick loop reads + resets this
      lastChatAt: 0,
    });
    return p;
  }

  removePlayer(id) {
    return this.players.delete(id);
  }

  getPlayer(id) {
    return this.players.get(id);
  }

  playerList() {
    const list = [];
    for (const [id, pl] of this.players) {
      list.push({ id, username: pl.username, pack: pl.pack, p: [...pl.p] });
    }
    return list;
  }

  // ---- props -----------------------------------------------------------

  // Returns { prop } on success or { error } on validation failure.
  placeProp(raw) {
    const kind = raw && raw.kind;
    if (!PROP_KINDS.has(kind)) return { error: 'invalid prop kind' };
    if (!validPropTransform(raw.p)) return { error: 'invalid prop position' };
    if (!isNum(raw.ry)) return { error: 'invalid prop rotation' };
    if (!isNum(raw.color)) return { error: 'invalid prop color' };
    if (this.props.size >= MAX_PROPS) return { error: 'prop limit reached' };

    const id = `p_${this.nextPropId++}`;
    const prop = { id, kind, p: [...raw.p], ry: raw.ry, color: raw.color };
    this.props.set(id, prop);
    this.#scheduleSave();
    return { prop };
  }

  // Returns { prop } on success or { error } on validation failure.
  moveProp(id, p, ry) {
    const prop = this.props.get(id);
    if (!prop) return { error: 'unknown prop' };
    if (!validPropTransform(p)) return { error: 'invalid prop position' };
    if (!isNum(ry)) return { error: 'invalid prop rotation' };
    prop.p = [...p];
    prop.ry = ry;
    this.#scheduleSave();
    return { prop };
  }

  // Returns { id } on success or { error } if the prop doesn't exist.
  deleteProp(id) {
    if (!this.props.has(id)) return { error: 'unknown prop' };
    this.props.delete(id);
    this.#scheduleSave();
    return { id };
  }

  // ---- lifecycle -------------------------------------------------------

  // Persists the room's props. Called when the room is destroyed (e.g. last
  // player left) so nothing is lost even if the debounce timer was pending.
  destroy() {
    flushRoom(this.code, () => this.#payload());
  }

  #scheduleSave() {
    saveRoomDebounced(this.code, () => this.#payload());
  }

  #payload() {
    return { props: [...this.props.values()], savedAt: Date.now() };
  }
}
