// Runs post.mjs against a temporary folder and a fake Pinterest API on localhost.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';

const POST = path.join(import.meta.dirname, '..', 'post.mjs');
const pad = (n) => String(n).padStart(2, '0');
// folder name for "now + hours", in the local clock (the same clock post.mjs reads)
function slot(hours) {
  const d = new Date(Date.now() + hours * 3600000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function makeRoot(pins) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pins-test-'));
  fs.mkdirSync(path.join(root, 'scheduled'));
  fs.writeFileSync(path.join(root, 'scheduled', 'photo.png'), 'original');
  for (const [name, title] of Object.entries(pins)) {
    fs.mkdirSync(path.join(root, 'queue', name), { recursive: true });
    fs.writeFileSync(path.join(root, 'queue', name, 'photo.jpg'), 'fake-jpeg');
    fs.writeFileSync(path.join(root, 'queue', name, 'pin.json'), JSON.stringify({ title, description: 'd', alt_text: 'a', source: 'photo.png', sha256: 'x' }));
  }
  return root;
}

function fakeApi({ failPins = false } = {}) {
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      calls.push({ method: req.method, url: req.url, auth: req.headers.authorization, body: body ? JSON.parse(body) : null });
      res.setHeader('Content-Type', 'application/json');
      if (req.url.startsWith('/v5/boards')) {
        // two pages, the board is on the second one
        if (!req.url.includes('bookmark')) res.end(JSON.stringify({ items: [{ id: '1', name: 'Other' }], bookmark: 'next' }));
        else res.end(JSON.stringify({ items: [{ id: '42', name: 'Personal Pins' }], bookmark: null }));
      } else if (req.url === '/v5/pins' && failPins) {
        res.statusCode = 500;
        res.end(JSON.stringify({ code: 1, message: 'server down' }));
      } else if (req.url === '/v5/pins') {
        res.statusCode = 201;
        res.end(JSON.stringify({ id: '999' }));
      } else {
        res.statusCode = 404;
        res.end('{}');
      }
    });
  });
  return new Promise((resolve) => server.listen(0, () => resolve({ server, calls, base: `http://localhost:${server.address().port}` })));
}

function run(root, env) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [POST], { env: { ...process.env, PINS_ROOT: root, PINTEREST_ACCESS_TOKEN: '', PINS_RETRY_MINUTES: '0', ...env } });
    let out = '';
    p.stdout.on('data', (c) => (out += c));
    p.stderr.on('data', (c) => (out += c));
    p.on('close', (code) => resolve({ code, out }));
  });
}

const ls = (root, dir) => (fs.existsSync(path.join(root, dir)) ? fs.readdirSync(path.join(root, dir)).sort() : []);
const pin = (root, dir, name) => JSON.parse(fs.readFileSync(path.join(root, dir, name, 'pin.json'), 'utf8'));

test('posts the due pin to the named board and leaves the future one', async () => {
  const dueName = slot(-1);
  const futureName = slot(30);
  const root = makeRoot({ [dueName]: 'Due', [futureName]: 'Future' });
  const { server, calls, base } = await fakeApi();
  const r = await run(root, { PINTEREST_ACCESS_TOKEN: 'tok', PINTEREST_API_BASE: base });
  server.close();
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(ls(root, 'queue'), [futureName]);
  assert.deepEqual(ls(root, 'posted'), [dueName]);
  const create = calls.find((c) => c.url === '/v5/pins');
  assert.equal(create.auth, 'Bearer tok');
  assert.equal(create.body.board_id, '42');
  assert.equal(create.body.title, 'Due');
  assert.equal(create.body.media_source.source_type, 'image_base64');
  assert.equal(Buffer.from(create.body.media_source.data, 'base64').toString(), 'fake-jpeg');
  assert.equal(pin(root, 'posted', dueName).pin_id, '999');
});

test('without a Pinterest login nothing is touched', async () => {
  const dueName = slot(-30);
  const root = makeRoot({ [dueName]: 'Due' });
  const r = await run(root, {});
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(ls(root, 'queue'), [dueName]);
  assert.deepEqual(ls(root, 'failed'), []);
});

test('a failed post stays in the queue with its error and is retried', async () => {
  const dueName = slot(-2);
  const root = makeRoot({ [dueName]: 'Due' });
  const down = await fakeApi({ failPins: true });
  const r1 = await run(root, { PINTEREST_ACCESS_TOKEN: 'tok', PINTEREST_API_BASE: down.base });
  down.server.close();
  assert.equal(r1.code, 1);
  assert.deepEqual(ls(root, 'queue'), [dueName]);
  assert.match(pin(root, 'queue', dueName).last_error, /server down/);

  const up = await fakeApi();
  const r2 = await run(root, { PINTEREST_ACCESS_TOKEN: 'tok', PINTEREST_API_BASE: up.base });
  up.server.close();
  assert.equal(r2.code, 0, r2.out);
  assert.deepEqual(ls(root, 'posted'), [dueName]);
  assert.equal(pin(root, 'posted', dueName).last_error, undefined);
  assert.equal(pin(root, 'posted', dueName).last_try, undefined);
});

test('a failed post is not tried again before the retry wait is over', async () => {
  const dueName = slot(-2);
  const root = makeRoot({ [dueName]: 'Due' });
  const down = await fakeApi({ failPins: true });
  await run(root, { PINTEREST_ACCESS_TOKEN: 'tok', PINTEREST_API_BASE: down.base, PINS_RETRY_MINUTES: '15' });
  const before = down.calls.length;
  await run(root, { PINTEREST_ACCESS_TOKEN: 'tok', PINTEREST_API_BASE: down.base, PINS_RETRY_MINUTES: '15' });
  down.server.close();
  assert.equal(down.calls.length, before);
  assert.deepEqual(ls(root, 'queue'), [dueName]);
});

test('a pin more than 24 hours late leaves the calendar: its original goes to failed/ with a note', async () => {
  const lateName = slot(-25);
  const root = makeRoot({ [lateName]: 'Late' });
  const { server, calls, base } = await fakeApi();
  const r = await run(root, { PINTEREST_ACCESS_TOKEN: 'tok', PINTEREST_API_BASE: base });
  server.close();
  assert.equal(r.code, 1);
  assert.deepEqual(ls(root, 'failed'), ['photo.png', 'photo.txt']);
  assert.deepEqual(ls(root, 'queue'), []);
  assert.deepEqual(ls(root, 'scheduled'), []);
  assert.equal(calls.filter((c) => c.url === '/v5/pins').length, 0);
  assert.match(fs.readFileSync(path.join(root, 'failed', 'photo.txt'), 'utf8'), /24 hours/);
});
