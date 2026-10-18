import { Engine, PlayerController } from '@vworld/engine';
import './style.css';
import { GameSocket } from './net.js';
import { RemotePlayers } from './players.js';
import { PropManager } from './props.js';
import { BuildMode } from './build.js';
import { buildUI } from './ui.js';
import { registerPacks, PACKS } from './packs.js';

// --- boot -------------------------------------------------------------------
const canvas = document.getElementById('game');
const app = Engine.create({ canvas });
await app.ready;

const groundEntity = app.world.ground({ size: 200, color: 0x4d7c43 });
app.world.dayNight().speed(120).time(0.3);
app.build.gridSize(1);
registerPacks(app);
app.start();

// --- session state ------------------------------------------------------------
let socket = null;
let player = null;
let remotes = null;
let props = null;
let build = null;
let joined = false;
let joining = false;
let myId = null;
let myPack = 'default';
let downloadingPack = null;

const groundMesh = (() => {
  let m = null;
  groundEntity.object.traverse((o) => { if (!m && o.isMesh) m = o; });
  return m;
})();

// --- ui -----------------------------------------------------------------------
const ui = buildUI({
  packs: PACKS,
  onJoin: join,
  onChatSend: (text) => socket?.send({ t: 'chat', text }),
  onChatFocus: (focused) => { app.input.enabled = !focused; },
  onTool: (tool) => build?.setTool(tool),
  onKind: (kind) => build?.setKind(kind),
  onColor: (color) => build?.setColor(color),
  onDownloadPack: async (id) => {
    downloadingPack = id;
    ui.refreshPacks((pid) => app.assets.characters.hasPack(pid), downloadingPack);
    try {
      await app.assets.characters.downloadPack(id);
      ui.addChat({ text: `Character pack "${id}" downloaded.`, sys: true });
    } catch (err) {
      ui.addChat({ text: `Download failed: ${err.message}`, sys: true });
    }
    downloadingPack = null;
    ui.refreshPacks((pid) => app.assets.characters.hasPack(pid), downloadingPack);
  },
});
ui.refreshPacks((pid) => app.assets.characters.hasPack(pid), null);
ui.setActiveKind('brick');

// --- join flow ------------------------------------------------------------------
async function join({ username, room, pack }) {
  if (joined || joining) return;
  joining = true;
  ui.showError('');
  myPack = pack;
  socket = new GameSocket(app);

  socket.onWelcome = onWelcome;
  socket.onPlayerJoin = ({ id, username: name, pack: p }) => {
    remotes?.add(id, name, p);
    ui.addChat({ text: `${name} joined the room.`, sys: true });
  };
  socket.onPlayerLeave = ({ id }) => {
    const r = remotes?.remotes.get(id);
    if (r) ui.addChat({ text: `${r.username} left the room.`, sys: true });
    remotes?.remove(id);
  };
  socket.onChat = (msg) => {
    ui.addChat({ ...msg, self: msg.id === myId });
  };
  socket.onProp = (ev) => {
    if (!props) return;
    if (ev.type === 'add') props.add(ev.prop);
    else if (ev.type === 'move') props.move(ev.id, ev.p, ev.ry);
    else if (ev.type === 'del') props.del(ev.id);
  };
  socket.onError = (msg) => ui.showError(msg);
  socket.onClose = () => {
    joining = false;
    if (joined) ui.addChat({ text: 'Disconnected from server.', sys: true });
    else ui.showError('Disconnected from server.');
    ui.setConnecting(false);
  };

  try {
    await socket.connect();
    socket.send({ t: 'join', room, username, pack });
  } catch (err) {
    joining = false;
    ui.showError(err.message);
    ui.setConnecting(false);
  }
}

function onWelcome(msg) {
  joining = false;
  myId = msg.clientId;
  ui.hideStart();
  ui.addChat({ text: `Joined room "${msg.room}" as ${myId}.`, sys: true });

  // Local player.
  player = new PlayerController(app, { speed: 6 });
  const s = msg.spawn;
  const sp = Array.isArray(s) ? s : [s?.x ?? 0, s?.y ?? 3, s?.z ?? 8];
  player.spawn(sp[0], sp[1], sp[2]);

  // Cosmetic avatar for the chosen pack (falls back to default automatically).
  app.assets.characters.spawn(myPack).then((avatar) => {
    player.entity.object.children.forEach((m) => { m.visible = false; });
    player.entity.object.add(avatar);
  });

  // Multiplayer + building systems come online now.
  remotes = new RemotePlayers(app, myId);
  props = new PropManager(app);
  build = new BuildMode(app, socket, props, ui, groundMesh);

  for (const p of msg.players ?? []) {
    remotes.add(p.id, p.username, p.pack);
  }
  for (const pr of msg.props ?? []) {
    props.add(pr);
  }

  joined = true;

  // Replicate our transform at 15 Hz: { t:'move', p, q }.
  setInterval(() => {
    if (!socket?.open || !player) return;
    const p = player.body.translation();
    const q = player.entity.object.quaternion;
    socket.send({
      t: 'move',
      p: [+p.x.toFixed(3), +p.y.toFixed(3), +p.z.toFixed(3)],
      q: [+q.x.toFixed(4), +q.y.toFixed(4), +q.z.toFixed(4), +q.w.toFixed(4)],
    });
  }, 1000 / 15);

  app.onUpdate((dt) => remotes.update(dt));
}

// --- pointer lock (mouse-look) ----------------------------------------------------
// Clicking the canvas locks the pointer for mouse-look — unless a build tool
// is active, in which case the click belongs to the build tool.
canvas.addEventListener('click', () => {
  if (!joined) return;
  if (build?.tool) return;
  if (!app.input.pointerLocked) app.input.lockPointer();
});

// Slash focuses chat from anywhere (when not already typing).
window.addEventListener('keydown', (e) => {
  if (!joined || !app.input.enabled || e.repeat) return;
  if (e.code === 'Slash') {
    e.preventDefault();
    ui.focusChat();
  }
});
