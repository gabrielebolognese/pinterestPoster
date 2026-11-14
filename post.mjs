// Posts every pin in queue/ whose time has come, through the official Pinterest API.
// The runner calls it every minute. By hand: node post.mjs
// Folder names are wall clock on this PC.
import fs from 'node:fs';
import path from 'node:path';
import { cfg, SLOT, at, pinDirs, readPin, writePin, moveInto, log } from './lib/util.mjs';
import { readEnv } from './lib/env.mjs';
import { loggedIn, refreshNow } from './lib/token.mjs';

const API = () => process.env.PINTEREST_API_BASE || cfg.apiBase;
const RETRY_MIN = Number(process.env.PINS_RETRY_MINUTES ?? cfg.retryMinutes ?? 15);

let token = null;
let refreshed = false; // one token refresh per run at most

async function api(method, route, body) {
  const call = () =>
    fetch(API() + route, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  let res = await call();
  // An expired or invalid token answers 401: get a new one and try once more
  if (res.status === 401 && !refreshed && loggedIn()) {
    refreshed = true;
    token = await refreshNow();
    log('TOKEN  access token was rejected, refreshed');
    res = await call();
  }
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text.slice(0, 300) };
  }
  if (!res.ok) throw new Error(`${method} ${route.split('?')[0]} -> ${res.status} ${data.message ?? JSON.stringify(data)}`);
  return data;
}

let boardId = cfg.boardId || null;
async function board() {
  if (boardId) return boardId;
  const names = [];
  let bookmark = '';
  for (let page = 0; page < 20; page++) {
    const data = await api('GET', `/v5/boards?page_size=250${bookmark ? `&bookmark=${encodeURIComponent(bookmark)}` : ''}`);
    for (const b of data.items ?? []) {
      names.push(b.name);
      if (b.name.trim().toLowerCase() === cfg.board.trim().toLowerCase()) return (boardId = b.id);
    }
    if (!data.bookmark) break;
    bookmark = data.bookmark;
  }
  throw new Error(`board "${cfg.board}" not found (boards seen: ${names.join(', ') || 'none'})`);
}

async function publish(name, pin) {
  const image = fs.readdirSync(at('queue', name)).find((f) => /\.jpe?g$/i.test(f));
  if (!image) throw new Error('no .jpg in the pin folder');
  const data = await api('POST', '/v5/pins', {
    board_id: await board(),
    title: pin.title,
    description: pin.description,
    alt_text: pin.alt_text,
    media_source: {
      source_type: 'image_base64',
      content_type: 'image/jpeg',
      data: fs.readFileSync(at('queue', name, image)).toString('base64'),
    },
  });
  return data.id;
}

const dueTime = (name) => {
  const m = name.match(SLOT);
  return new Date(`${m[1]}T${m[2]}:${m[3]}:00`);
};

// Gives up on a pin: its original goes from scheduled/ to failed/ with a note saying why,
// and it leaves the calendar. Dragging the original back to the root schedules it again.
function giveUp(name, pin, reason) {
  fs.mkdirSync(at('failed'), { recursive: true });
  const source = pin.source && fs.existsSync(at('scheduled', pin.source)) ? at('scheduled', pin.source) : null;
  // if the original is gone, keep at least the small copy that was going to be posted
  const jpg = fs.readdirSync(at('queue', name)).find((f) => /\.jpe?g$/i.test(f));
  const kept = source ? moveInto(source, at('failed')) : jpg ? moveInto(at('queue', name, jpg), at('failed')) : null;
  if (kept) {
    const note = path.join(at('failed'), path.parse(kept).name + '.txt');
    fs.writeFileSync(note, `Scheduled for ${name}, not posted.\nReason: ${reason}\nTo try again, move the image back to the main folder.\n`);
  }
  fs.rmSync(at('queue', name), { recursive: true, force: true });
  log(`FAILED ${name} ${pin.source ?? ''}: ${reason}, moved to failed/`);
}

// Returns { due, posted, failed, retrying, waiting } ; waiting = no Pinterest login yet, nothing touched
export async function postDue() {
  const now = new Date();
  const due = pinDirs('queue').filter((name) => dueTime(name) <= now);
  const out = { due: due.length, posted: 0, failed: 0, retrying: 0, waiting: false };
  if (!due.length) return out;

  token = process.env.PINTEREST_ACCESS_TOKEN || readEnv().PINTEREST_ACCESS_TOKEN || null;
  refreshed = false;
  if (!token) {
    // Before the Pinterest login exists nothing is touched, so no pin fails while waiting
    out.waiting = true;
    return out;
  }

  for (const name of due) {
    const pin = readPin('queue', name) ?? {};
    const lateHours = (now - dueTime(name)) / 3600000;
    if (lateHours > cfg.maxLateHours) {
      giveUp(name, pin, pin.last_error ?? `not posted within ${cfg.maxLateHours} hours of its time`);
      out.failed++;
      continue;
    }
    if (pin.last_try && now - new Date(pin.last_try) < RETRY_MIN * 60000) {
      out.retrying++;
      continue;
    }
    try {
      const id = await publish(name, pin);
      const { last_error, last_try, ...clean } = pin;
      writePin('queue', name, { ...clean, pin_id: id, posted_at: now.toISOString() });
      fs.mkdirSync(at('posted'), { recursive: true });
      fs.renameSync(at('queue', name), at('posted', name));
      log(`POSTED ${name} ${pin.source ?? ''} -> https://www.pinterest.com/pin/${id}/`);
      out.posted++;
    } catch (err) {
      writePin('queue', name, { ...pin, last_error: err.message, last_try: now.toISOString() });
      log(`RETRY  ${name} ${pin.source ?? ''}: ${err.message} (next try in ${RETRY_MIN} min)`);
      out.retrying++;
    }
  }
  return out;
}

if (import.meta.filename === path.resolve(process.argv[1] ?? '')) {
  const r = await postDue();
  if (!r.due) console.log('nothing due');
  else if (r.waiting) console.log(`${r.due} pin(s) due, but there is no Pinterest login yet: nothing posted`);
  if (r.failed || r.retrying) process.exitCode = 1;
}
