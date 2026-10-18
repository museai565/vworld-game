// smoke-test.js — self-contained end-to-end protocol test.
//
// Spawns `node index.js` as a child process on PORT=8099, then drives two
// WebSocket clients through the core protocol: join, playerJoin, chat,
// place/propAdd, move/players-tick, delProp/propDel. Prints PASS/FAIL per
// step, kills the child, and exits 0 on all-pass, 1 otherwise.
//
// Usage: npm run smoke  (or: node smoke-test.js)
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8099;
const STEP_TIMEOUT = 5000;

const results = [];
function step(name, ok, detail = '') {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

// Wait for the child to print its listen line (with a connect fallback).
function waitForListen(child) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('server did not start listening in time')),
      15000,
    );
    let buf = '';
    child.stdout.on('data', (d) => {
      buf += d.toString();
      if (/listening on/i.test(buf)) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`server exited early with code ${code}`));
    });
  });
}

function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    const timer = setTimeout(
      () => reject(new Error('connect timed out')),
      STEP_TIMEOUT,
    );
    ws.on('open', () => {
      clearTimeout(timer);
      resolve(ws);
    });
    ws.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

// Per-connection inbox: incoming messages queue up and waiters can claim
// the first message matching a predicate.
function track(ws) {
  const queue = [];
  const waiters = [];
  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i].pred(msg)) {
        const w = waiters.splice(i, 1)[0];
        clearTimeout(w.timer);
        w.resolve(msg);
        return;
      }
    }
    queue.push(msg);
  });
  return {
    next(pred, label) {
      const idx = queue.findIndex(pred);
      if (idx >= 0) return Promise.resolve(queue.splice(idx, 1)[0]);
      return new Promise((resolve, reject) => {
        const waiter = { pred, resolve, timer: null };
        waiter.timer = setTimeout(() => {
          const i = waiters.indexOf(waiter);
          if (i >= 0) waiters.splice(i, 1);
          reject(new Error(`timeout waiting for ${label}`));
        }, STEP_TIMEOUT);
        waiters.push(waiter);
      });
    },
  };
}

const send = (ws, msg) => ws.send(JSON.stringify(msg));

async function run() {
  const child = spawn('node', ['index.js'], {
    cwd: DIR,
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));
  const kill = () =>
    new Promise((resolve) => {
      child.on('exit', () => resolve());
      child.kill('SIGTERM');
      setTimeout(() => {
        child.kill('SIGKILL');
        resolve();
      }, 2000).unref();
    });

  try {
    await waitForListen(child);

    // 1. A creates a room.
    const a = await connect();
    const ta = track(a);
    send(a, { t: 'join', room: null, username: 'Alice', pack: 'default' });
    const welcomeA = await ta.next((m) => m.t === 'welcome', 'welcome (A)');
    const code = welcomeA.room;
    step(
      'A joins (room:null) → welcome with 6-char room code',
      /^[A-Z0-9]{6}$/.test(code) &&
        typeof welcomeA.clientId === 'string' &&
        Array.isArray(welcomeA.spawn) &&
        welcomeA.spawn.length === 3 &&
        Array.isArray(welcomeA.players) &&
        Array.isArray(welcomeA.props),
      `room=${code}`,
    );

    // 2. B joins the same room.
    const b = await connect();
    const tb = track(b);
    send(b, { t: 'join', room: code, username: 'Bob', pack: 'default' });
    const welcomeB = await tb.next((m) => m.t === 'welcome', 'welcome (B)');
    step('B joins same room code', welcomeB.room === code);
    const pjA = await ta.next((m) => m.t === 'playerJoin' && m.username === 'Bob', 'playerJoin for B on A');
    step('A receives playerJoin for B', pjA.username === 'Bob' && pjA.id === welcomeB.clientId);
    const pjB = await tb.next((m) => m.t === 'playerJoin', 'playerJoin on B');
    step('B receives playerJoin', pjB.username === 'Bob');

    // 3. Chat A → B.
    send(a, { t: 'chat', text: 'hello world' });
    const chat = await tb.next((m) => m.t === 'chat', 'chat on B');
    step(
      'B receives chat from A',
      chat.text === 'hello world' && chat.username === 'Alice' && typeof chat.at === 'number',
    );

    // 4. A places a brick → both get propAdd with a server-assigned id.
    send(a, {
      t: 'place',
      prop: { kind: 'brick', p: [1, 0, 2], ry: 0, color: 0xff0000 },
    });
    const addA = await ta.next((m) => m.t === 'propAdd', 'propAdd on A');
    const addB = await tb.next((m) => m.t === 'propAdd', 'propAdd on B');
    const propId = addA.prop && addA.prop.id;
    step(
      'propAdd broadcast to both with server-assigned id',
      typeof propId === 'string' &&
        addB.prop.id === propId &&
        addA.prop.kind === 'brick',
      `id=${propId}`,
    );

    // 5. B moves → A receives a players tick containing B.
    send(b, { t: 'move', p: [5, 3, 5], q: [0, 0, 0, 1] });
    const upd = await ta.next(
      (m) =>
        m.t === 'players' &&
        Array.isArray(m.list) &&
        m.list.some((x) => x.id === welcomeB.clientId),
      'players update with B',
    );
    const moved = upd.list.find((x) => x.id === welcomeB.clientId);
    step(
      'A receives 20Hz players update containing B',
      moved.p[0] === 5 && moved.p[1] === 3 && moved.p[2] === 5,
    );

    // 6. A deletes the prop → both get propDel.
    send(a, { t: 'delProp', id: propId });
    const delA = await ta.next((m) => m.t === 'propDel', 'propDel on A');
    const delB = await tb.next((m) => m.t === 'propDel', 'propDel on B');
    step(
      'propDel broadcast to both',
      delA.id === propId && delB.id === propId,
    );

    a.close();
    b.close();
  } finally {
    await kill();
  }

  const failed = results.filter((r) => !r).length;
  console.log(
    `\n${results.length - failed}/${results.length} steps passed`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((e) => {
  console.error('SMOKE TEST ERROR:', e.message);
  process.exit(1);
});
