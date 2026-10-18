/**
 * GameSocket — WebSocket transport for the VWorld wire protocol.
 *
 * JSON over WebSocket. The URL is auto-derived from the page host
 * (`ws(s)://<hostname>:8081`); `?server=` overrides it (bare host[:port]
 * or a full ws(s):// URL).
 *
 * Inbound remote-player snapshots are re-emitted through the engine's
 * sanctioned Net seam: app.net.emit('entity:update', { id, p, q }).
 * Everything else is exposed as plain callbacks.
 */
export class GameSocket {
  constructor(app) {
    this.app = app;
    this.ws = null;

    // Callbacks (all optional):
    this.onWelcome = null;      // (msg) => {}
    this.onPlayerJoin = null;   // ({ id, username, pack }) => {}
    this.onPlayerLeave = null;  // ({ id }) => {}
    this.onChat = null;         // ({ id, username, text, at }) => {}
    this.onProp = null;         // ({ type:'add'|'move'|'del', ... }) => {}
    this.onError = null;        // (msg) => {}
    this.onClose = null;        // () => {}
  }

  static resolveUrl() {
    const q = new URLSearchParams(location.search);
    const override = q.get('server');
    if (override) {
      return /^wss?:\/\//i.test(override) ? override : `ws://${override}`;
    }
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.hostname}:8081`;
  }

  /** Open the socket. Resolves when connected, rejects on failure/timeout. */
  connect() {
    return new Promise((resolve, reject) => {
      let ws;
      try {
        ws = new WebSocket(GameSocket.resolveUrl());
      } catch (err) {
        reject(err);
        return;
      }
      const timer = setTimeout(() => {
        try { ws.close(); } catch { /* noop */ }
        reject(new Error('Connection timed out — is the game server running?'));
      }, 8000);
      ws.onopen = () => {
        clearTimeout(timer);
        this.ws = ws;
        this._attach();
        resolve(this);
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error('Could not reach the game server at ' + GameSocket.resolveUrl()));
      };
    });
  }

  get open() {
    return !!this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  send(obj) {
    if (this.open) this.ws.send(JSON.stringify(obj));
    return this;
  }

  close() {
    try { this.ws?.close(); } catch { /* noop */ }
    return this;
  }

  _attach() {
    this.ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      this._dispatch(msg);
    };
    this.ws.onclose = () => this.onClose?.();
  }

  _dispatch(msg) {
    if (!msg || typeof msg.t !== 'string') return;
    switch (msg.t) {
      case 'welcome':
        this.onWelcome?.(msg);
        break;
      case 'playerJoin':
        this.onPlayerJoin?.(msg);
        break;
      case 'playerLeave':
        this.onPlayerLeave?.(msg);
        break;
      case 'players':
        // Sanctioned Net seam: remote snapshots flow through the engine.
        for (const p of msg.list ?? []) {
          this.app.net.emit('entity:update', { id: p.id, p: p.p, q: p.q });
        }
        break;
      case 'chat':
        this.onChat?.(msg);
        break;
      case 'propAdd':
        this.onProp?.({ type: 'add', prop: msg.prop });
        break;
      case 'propMove':
        this.onProp?.({ type: 'move', id: msg.id, p: msg.p, ry: msg.ry });
        break;
      case 'propDel':
        this.onProp?.({ type: 'del', id: msg.id });
        break;
      case 'error':
        this.onError?.(msg.msg);
        break;
      default:
        break;
    }
  }
}
