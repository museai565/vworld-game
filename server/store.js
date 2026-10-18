// store.js — file persistence for room prop layouts.
//
// Each room's props are saved to server/data/<CODE>.json as
// { props: [...], savedAt }. Writes are debounced: the file is rewritten 2s
// after the *last* mutation in that room, so rapid building doesn't thrash
// the disk. The data directory is created on first write.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'data',
);
const SAVE_DELAY_MS = 2000;

// code -> pending debounce timeout
const timers = new Map();

// Keeps file paths safe: room codes are strictly [A-Z0-9]{6}, so a code can
// never escape the data directory via path traversal.
function fileFor(code) {
  if (!/^[A-Z0-9]{6}$/.test(code)) throw new Error('invalid room code');
  return path.join(DATA_DIR, `${code}.json`);
}

// Returns { props, savedAt } or null when no save exists / is unreadable.
export async function loadRoomData(code) {
  try {
    const raw = await fs.readFile(fileFor(code), 'utf8');
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.props)) return null;
    return data;
  } catch {
    return null;
  }
}

async function writeNow(code, payload) {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(
      fileFor(code),
      JSON.stringify(payload, null, 2),
      'utf8',
    );
  } catch (err) {
    console.error(`[store] write failed for room ${code}:`, err.message);
  }
}

// Debounced save: rewrites the file 2s after the room's last mutation.
export function saveRoomDebounced(code, getPayload) {
  const prev = timers.get(code);
  if (prev) clearTimeout(prev);
  timers.set(
    code,
    setTimeout(() => {
      timers.delete(code);
      writeNow(code, getPayload());
    }, SAVE_DELAY_MS),
  );
}

// Immediate save that cancels any pending debounce (e.g. on room destroy).
export function flushRoom(code, getPayload) {
  const prev = timers.get(code);
  if (prev) {
    clearTimeout(prev);
    timers.delete(code);
  }
  return writeNow(code, getPayload());
}
