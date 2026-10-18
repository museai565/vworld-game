import { PROP_ORDER, PROPS } from './props.js';

const SWATCHES = [0xb5533c, 0xc9b896, 0x4d7c43, 0x3fa7ff, 0x9a5fd0, 0xf2f2f2, 0x2b2b2b];

const TOOLS = [
  { id: 'place', label: 'Place', icon: '🧱', key: 'Q' },
  { id: 'move', label: 'Move', icon: '✥', key: 'W' },
  { id: 'rotate', label: 'Rotate', icon: '⟳', key: 'E' },
  { id: 'delete', label: 'Delete', icon: '🗑', key: 'R' },
];

/**
 * buildUI — all DOM: start screen, chat, toolbar, character menu.
 * Dumb view: user actions flow out through callbacks, state flows back in
 * through the returned api. Chat focus/blur is reported so the game can
 * disable input while typing (app.input.enabled).
 */
export function buildUI(opts) {
  const {
    packs, onJoin, onChatSend, onChatFocus,
    onTool, onKind, onColor, onDownloadPack,
  } = opts;

  const root = document.getElementById('ui');
  const randName = 'Player' + Math.floor(1000 + Math.random() * 9000);

  root.innerHTML = `
    <div id="start-screen">
      <div class="card">
        <h1>VWORLD</h1>
        <p class="sub">multiplayer sandbox</p>
        <label>Username
          <input id="username" maxlength="16" value="${randName}" autocomplete="off" spellcheck="false">
        </label>
        <label>Room code
          <input id="room" maxlength="12" placeholder="e.g. meadow" autocomplete="off" spellcheck="false">
        </label>
        <label>Character
          <select id="pack">${packs.map((p) => `<option value="${p.id}">${p.name}</option>`).join('')}</select>
        </label>
        <div class="row">
          <button id="btn-create" class="primary">Create room</button>
          <button id="btn-join">Join</button>
        </div>
        <div id="join-error"></div>
      </div>
    </div>
    <div id="hud" class="hidden">
      <div id="hint">Click the world to look around &nbsp;·&nbsp; Q/W/E/R build tools &nbsp;·&nbsp; 1–8 props &nbsp;·&nbsp; Esc exits tool</div>
      <div id="chat">
        <div id="chat-log"><div class="empty">Welcome! Say hi in chat.</div></div>
        <input id="chat-input" maxlength="200" placeholder="Chat… (Enter to send)" autocomplete="off">
      </div>
      <div id="toolbar">
        <div id="prop-btns"></div>
        <div class="sep"></div>
        <div id="tool-btns"></div>
        <div class="sep"></div>
        <div id="color-btns"></div>
      </div>
      <div id="char-wrap">
        <button id="char-toggle" title="Character packs">🧍</button>
        <div id="char-menu" class="hidden">
          <h3>Character packs</h3>
          <div id="pack-list"></div>
        </div>
      </div>
    </div>`;

  const $ = (s) => root.querySelector(s);
  const startScreen = $('#start-screen');
  const hud = $('#hud');
  const errorLine = $('#join-error');
  const chatLog = $('#chat-log');
  const chatInput = $('#chat-input');

  const randomRoom = () => Math.random().toString(36).slice(2, 8);

  function doJoin(generateRoom) {
    const username = $('#username').value.trim() || randName;
    const room = generateRoom ? randomRoom() : $('#room').value.trim();
    const pack = $('#pack').value;
    if (!room) {
      errorLine.textContent = 'Enter a room code — or Create a room.';
      return;
    }
    if (generateRoom) $('#room').value = room;
    setConnecting(true);
    onJoin({ username, room, pack });
  }

  $('#btn-create').addEventListener('click', () => doJoin(true));
  $('#btn-join').addEventListener('click', () => doJoin(false));
  $('#room').addEventListener('keydown', (e) => { if (e.key === 'Enter') doJoin(false); });
  $('#username').addEventListener('keydown', (e) => { if (e.key === 'Enter') doJoin(false); });

  function setConnecting(b) {
    $('#btn-create').disabled = b;
    $('#btn-join').disabled = b;
    $('#btn-create').textContent = b ? 'Connecting…' : 'Create room';
  }

  // --- chat ---------------------------------------------------------------
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const text = chatInput.value.trim();
      if (text) onChatSend(text);
      chatInput.value = '';
    } else if (e.key === 'Escape') {
      chatInput.blur();
    }
    e.stopPropagation(); // keep game keys (Q/W/E/R…) out of this
  });
  chatInput.addEventListener('focus', () => onChatFocus(true));
  chatInput.addEventListener('blur', () => onChatFocus(false));

  function addChat({ username, text, at, self, sys }) {
    chatLog.querySelector('.empty')?.remove();
    const div = document.createElement('div');
    div.className = 'msg' + (sys ? ' sys' : '') + (self ? ' self' : '');
    if (sys) {
      div.textContent = text;
    } else {
      const time = at ? new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
      div.innerHTML = `<span class="who"></span> <span class="text"></span> <span class="t" style="color:#5b6577;font-size:11px"></span>`;
      div.querySelector('.who').textContent = username;
      div.querySelector('.text').textContent = text;
      div.querySelector('.t').textContent = time;
    }
    chatLog.appendChild(div);
    while (chatLog.children.length > 120) chatLog.firstChild.remove();
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  // --- toolbar --------------------------------------------------------------
  const propBtns = $('#prop-btns');
  const propBtnMap = new Map();
  PROP_ORDER.forEach((kind, i) => {
    const b = document.createElement('button');
    b.innerHTML = `${PROPS[kind].name}<span class="key">${i + 1}</span>`;
    b.title = `Place ${PROPS[kind].name} (${i + 1})`;
    b.addEventListener('click', () => onKind(kind));
    propBtns.appendChild(b);
    propBtnMap.set(kind, b);
  });

  const toolBtns = $('#tool-btns');
  const toolBtnMap = new Map();
  for (const t of TOOLS) {
    const b = document.createElement('button');
    b.innerHTML = `${t.icon} ${t.label}<span class="key">${t.key}</span>`;
    b.title = `${t.label} tool (${t.key})`;
    b.addEventListener('click', () => onTool(t.id));
    toolBtns.appendChild(b);
    toolBtnMap.set(t.id, b);
  }

  const colorBtns = $('#color-btns');
  const autoBtn = document.createElement('button');
  autoBtn.textContent = 'Auto';
  autoBtn.title = 'Kind default color';
  autoBtn.classList.add('active');
  autoBtn.addEventListener('click', () => onColor(null));
  colorBtns.appendChild(autoBtn);
  const swatchMap = new Map([[null, autoBtn]]);
  for (const c of SWATCHES) {
    const b = document.createElement('button');
    b.className = 'swatch';
    b.style.background = '#' + c.toString(16).padStart(6, '0');
    b.title = 'Paint color #' + c.toString(16).padStart(6, '0');
    b.addEventListener('click', () => onColor(c));
    colorBtns.appendChild(b);
    swatchMap.set(c, b);
  }

  // --- character menu ---------------------------------------------------------
  const charMenu = $('#char-menu');
  const packList = $('#pack-list');
  $('#char-toggle').addEventListener('click', () => charMenu.classList.toggle('hidden'));

  function refreshPacks(hasPack, downloading) {
    packList.innerHTML = '';
    for (const p of packs) {
      const row = document.createElement('div');
      row.className = 'pack';
      const name = document.createElement('span');
      name.textContent = p.name;
      row.appendChild(name);
      if (p.id === 'default') {
        const s = document.createElement('span');
        s.className = 'dl';
        s.textContent = 'Built-in ✓';
        row.appendChild(s);
      } else if (hasPack(p.id)) {
        const s = document.createElement('span');
        s.className = 'dl';
        s.textContent = 'Downloaded ✓';
        row.appendChild(s);
      } else {
        const b = document.createElement('button');
        b.textContent = downloading === p.id ? '…' : 'Download';
        b.disabled = downloading === p.id;
        b.addEventListener('click', () => onDownloadPack(p.id));
        row.appendChild(b);
      }
      packList.appendChild(row);
    }
  }

  // --- hint fade ---------------------------------------------------------------
  setTimeout(() => { $('#hint').style.opacity = '0'; }, 14000);

  // --- public api ---------------------------------------------------------------
  return {
    setConnecting,
    showError(msg) {
      errorLine.textContent = msg || '';
      if (!hud.classList.contains('hidden') && msg) {
        addChat({ text: msg, sys: true });
      }
    },
    hideStart() {
      startScreen.classList.add('hidden');
      hud.classList.remove('hidden');
      setConnecting(false);
      errorLine.textContent = '';
    },
    addChat,
    setActiveKind(kind) {
      for (const [k, b] of propBtnMap) b.classList.toggle('active', k === kind);
    },
    setActiveTool(tool) {
      for (const [t, b] of toolBtnMap) b.classList.toggle('active', t === tool);
    },
    setActiveColor(color) {
      for (const [c, b] of swatchMap) b.classList.toggle('active', c === color);
    },
    refreshPacks,
    focusChat() { chatInput.focus(); },
  };
}
