// index.js — VWorld authoritative game server.
//
// WebSocket JSON protocol server (Node.js + `ws`). One process hosts many
// rooms; a single 20Hz tick loop broadcasts movement deltas per room.
//
// NOTE: no authentication. Anyone who knows (or guesses) a room code can
// join it. The server still validates every message — client state is never
// trusted — but there is no login, no session token, and no rate limiting
// beyond chat throttling. Add auth before exposing this to the open web.
import { WebSocketServer } from 'ws';
import { randomBytes } from 'node:crypto';
import { Room, MAX_PLAYERS, MOVE_EPSILON } from './rooms.js';
import { loadRoomData } from './store.js';

const PORT = Number(process.env.PORT) || 8081;
const TICK_MS = 50; // 20Hz
const CHAT_MIN_INTERVAL_MS = 800;
const CHAT_MAX_LEN = 200;

// Room codes: 6 chars, A-Z0-9 (I/1/O/0 excluded to avoid confusion).
const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// code -> Room (only rooms with >= 1 player live in memory)
const rooms = new Map();
// ws -> { id, room }
const clients = new Map();

const isNum = (n) => typeof n === 'number' && Number.isFinite(n);
const isVec = (v, n) =>
  Array.isArray(v) && v.length === n && v.every(isNum);

function makeRoomCode() {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += ROOM_CODE_CHARS[randomBytes(1)[0] % ROOM_CODE_CHARS.length];
  }
  return code;
}

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

const err = (msg) => ({ t: 'error', msg });

function broadcast(room, msg, exceptId = null) {
  const raw = JSON.stringify(msg);
  for (const [id, pl] of room.players) {
    if (id !== exceptId && pl.ws.readyState === 1) pl.ws.send(raw);
  }
}

function cleanUsername(name) {
  const s = String(name ?? '').trim().slice(0, 16);
  return s || `Player${1000 + Math.floor(Math.random() * 9000)}`;
}

async function getOrCreateRoom(code) {
  let room = rooms.get(code);
  if (room) return room;
  // Recreate from disk when a saved layout exists for this code.
  const saved = await loadRoomData(code);
  room = new Room(code, { props: saved ? saved.props : [] });
  rooms.set(code, room);
  console.log(
    `[room] ${saved ? 'restored' : 'created'} room ${code} (${room.props.size} saved props)`,
  );
  return room;
}

// Remove a connection from its room; destroy the room when empty
// (the data file on disk is left in place for future joins).
function leaveRoom(ws) {
  const c = clients.get(ws);
  if (!c) return;
  clients.delete(ws);
  const { id, room } = c;
  const username = room.getPlayer(id)?.username ?? id;
  room.removePlayer(id);
  broadcast(room, { t: 'playerLeave', id });
  console.log(`[leave] ${username} (${id}) <- room ${room.code}`);
  if (room.players.size === 0) {
    room.destroy();
    rooms.delete(room.code);
    console.log(`[room] destroyed room ${room.code} (empty)`);
  }
}

async function handleJoin(ws, msg) {
  leaveRoom(ws); // a connection belongs to at most one room at a time

  let code =
    typeof msg.room === 'string' ? msg.room.trim().toUpperCase() : '';
  if (!code) {
    do {
      code = makeRoomCode();
    } while (rooms.has(code));
  } else if (!/^[A-Z0-9]{6}$/.test(code)) {
    send(ws, err('invalid room code'));
    return;
  }

  const room = await getOrCreateRoom(code);
  if (room.players.size >= MAX_PLAYERS) {
    send(ws, err('room full'));
    return;
  }

  const id = `c_${randomBytes(6).toString('hex')}`;
  const username = cleanUsername(msg.username);
  const pack =
    typeof msg.pack === 'string' && msg.pack.trim()
      ? msg.pack.trim()
      : 'default';
  const spawn = room.addPlayer(id, ws, username, pack);
  clients.set(ws, { id, room });
  console.log(
    `[join] ${username} (${id}) -> room ${code} (${room.players.size}/${MAX_PLAYERS})`,
  );

  send(ws, {
    t: 'welcome',
    room: code,
    clientId: id,
    spawn,
    players: room.playerList(),
    props: [...room.props.values()],
  });
  // Notified to everyone in the room, including the joiner.
  broadcast(room, { t: 'playerJoin', id, username, pack });
}

function handleMove(ws, msg) {
  const c = clients.get(ws);
  if (!c || !isVec(msg.p, 3) || !isVec(msg.q, 4)) return;
  const pl = c.room.getPlayer(c.id);
  if (!pl) return;
  const dx = msg.p[0] - pl.p[0];
  const dy = msg.p[1] - pl.p[1];
  const dz = msg.p[2] - pl.p[2];
  if (dx * dx + dy * dy + dz * dz > MOVE_EPSILON * MOVE_EPSILON) {
    pl.p = [...msg.p];
    pl.moved = true; // picked up by the tick loop
  }
  pl.q = [...msg.q];
}

function handleChat(ws, msg) {
  const c = clients.get(ws);
  if (!c) return;
  const pl = c.room.getPlayer(c.id);
  if (!pl) return;

  const now = Date.now();
  if (now - pl.lastChatAt < CHAT_MIN_INTERVAL_MS) {
    send(ws, err('chat rate limited: slow down'));
    return;
  }
  const text = String(msg.text ?? '').trim().slice(0, CHAT_MAX_LEN);
  if (!text) return; // drop empty messages silently
  pl.lastChatAt = now;
  broadcast(c.room, { t: 'chat', id: c.id, username: pl.username, text, at: now });
}

function handlePlace(ws, msg) {
  const c = clients.get(ws);
  if (!c) return;
  const res = c.room.placeProp(msg.prop ?? {});
  if (res.error) {
    send(ws, err(res.error)); // invalid placements fail for the sender only
    return;
  }
  broadcast(c.room, { t: 'propAdd', prop: res.prop });
}

function handleMoveProp(ws, msg) {
  const c = clients.get(ws);
  if (!c) return;
  const res = c.room.moveProp(msg.id, msg.p, msg.ry);
  if (res.error) {
    send(ws, err(res.error)); // sender only
    return;
  }
  broadcast(c.room, { t: 'propMove', id: res.prop.id, p: res.prop.p, ry: res.prop.ry });
}

function handleDelProp(ws, msg) {
  const c = clients.get(ws);
  if (!c) return;
  const res = c.room.deleteProp(msg.id);
  if (res.error) {
    send(ws, err(res.error)); // sender only
    return;
  }
  broadcast(c.room, { t: 'propDel', id: res.id });
}

function handleMessage(ws, raw) {
  let msg;
  try {
    msg = JSON.parse(raw.toString());
  } catch {
    send(ws, err('malformed JSON'));
    return;
  }
  if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') {
    send(ws, err('invalid message'));
    return;
  }
  switch (msg.t) {
    case 'join':
      // async — keep the connection alive if it rejects
      handleJoin(ws, msg).catch((e) => {
        console.error('[join] failed:', e.message);
        send(ws, err('join failed'));
      });
      break;
    case 'move':
      handleMove(ws, msg);
      break;
    case 'chat':
      handleChat(ws, msg);
      break;
    case 'place':
      handlePlace(ws, msg);
      break;
    case 'moveProp':
      handleMoveProp(ws, msg);
      break;
    case 'delProp':
      handleDelProp(ws, msg);
      break;
    default:
      send(ws, err(`unknown message type: ${msg.t}`));
  }
}

const wss = new WebSocketServer({ port: PORT });

wss.on('connection', (ws) => {
  ws.on('message', (data) => handleMessage(ws, data));
  ws.on('close', () => leaveRoom(ws));
  ws.on('error', () => {
    // connection-level errors are non-fatal; 'close' cleans up
  });
});

// Single global tick: per room, broadcast only players whose position
// changed beyond epsilon since the last tick; never send empty lists.
setInterval(() => {
  for (const room of rooms.values()) {
    const list = [];
    for (const [id, pl] of room.players) {
      if (pl.moved) {
        list.push({ id, p: [...pl.p], q: [...pl.q] });
        pl.moved = false;
      }
    }
    if (list.length > 0) broadcast(room, { t: 'players', list });
  }
}, TICK_MS);

console.log(`[vworld-server] listening on :${PORT} (no auth — see file header)`);
