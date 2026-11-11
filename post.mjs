// Runs on GitHub: posts every pin in queue/ whose time has come. No dependencies.
// Folder names are wall clock in the timezone the workflow sets (TZ).
import fs from 'node:fs';
import { cfg, SLOT, at, pinDirs, readPin, writePin } from './lib/util.mjs';

const API = process.env.PINTEREST_API_BASE || cfg.apiBase;
const TOKEN = process.env.PINTEREST_ACCESS_TOKEN;

async function api(method, route, body) {
  const res = await fetch(API + route, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
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

function move(name, target) {
  fs.mkdirSync(at(target), { recursive: true });
  fs.renameSync(at('queue', name), at(target, name));
}

const dueTime = (name) => {
  const m = name.match(SLOT);
  return new Date(`${m[1]}T${m[2]}:${m[3]}:00`);
};

const now = new Date();
const due = pinDirs('queue').filter((name) => dueTime(name) <= now);

if (!due.length) {
  console.log('nothing due');
} else if (!TOKEN) {
  // Before the Pinterest login exists nothing is touched, so no pin is marked as failed while waiting
  console.log(`${due.length} pin(s) due, but the PINTEREST_ACCESS_TOKEN secret is not set: nothing posted`);
} else {
  let failed = false;
  for (const name of due) {
    const lateHours = (now - dueTime(name)) / 3600000;
    const pin = readPin('queue', name) ?? {};
    if (lateHours > cfg.maxLateHours) {
      writePin('queue', name, { ...pin, last_error: pin.last_error ?? `not posted within ${cfg.maxLateHours} hours of its time` });
      move(name, 'failed');
      console.log(`failed ${name}: ${Math.round(lateHours)} hours late, moved to failed/`);
      failed = true;
      continue;
    }
    try {
      const id = await publish(name, pin);
      const { last_error, ...clean } = pin;
      writePin('queue', name, { ...clean, pin_id: id, posted_at: now.toISOString() });
      move(name, 'posted');
      console.log(`posted ${name} -> https://www.pinterest.com/pin/${id}/`);
    } catch (err) {
      failed = true;
      writePin('queue', name, { ...pin, last_error: err.message });
      console.error(`failed ${name} (will retry): ${err.message}`);
    }
  }
  if (failed) process.exitCode = 1;
}
