// Night scan: finds new images in the root folder, writes their Pin text and gives each a date.
// The runner calls it once a night. By hand:
// node scan.mjs            the real run
// node scan.mjs --dry-run  only prints which image would get which date; changes nothing
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { ROOT, cfg, IMAGE_EXT, at, pinDirs, readPin, writePin, moveInto, log as writeLog } from './lib/util.mjs';
import { planSlots } from './lib/slots.mjs';

const SETTLE_MS = 5 * 60000; // a file changed in the last 5 minutes may still be copying or syncing

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

export async function scan({ dry = false } = {}) {
  const log = (msg) => writeLog(msg, { file: !dry });

  if (!dry) {
    const { refreshIfNeeded } = await import('./lib/token.mjs');
    try {
      log(`TOKEN  ${await refreshIfNeeded()}`);
    } catch (err) {
      log(`WARN   token refresh failed: ${err.message}`);
    }
  }

  // What is already in the calendar: waiting or posted. Failed pins are not in it, so they can be scheduled again.
  const known = new Map(); // sha256 -> where
  const usedTitles = [];
  let lastDay = null;
  for (const folder of ['queue', 'posted']) {
    for (const name of pinDirs(folder)) {
      const pin = readPin(folder, name);
      if (pin?.sha256) known.set(pin.sha256, `${folder}/${name}`);
      if (pin?.title) usedTitles.push(pin.title);
      if (!lastDay || name.slice(0, 10) > lastDay) lastDay = name.slice(0, 10);
    }
  }

  const images = fs
    .readdirSync(ROOT, { withFileTypes: true })
    .filter((d) => d.isFile() && IMAGE_EXT.has(path.extname(d.name).toLowerCase()))
    .map((d) => ({ name: d.name, file: at(d.name), stat: fs.statSync(at(d.name)) }))
    .filter((f) => {
      if (Date.now() - f.stat.mtimeMs >= SETTLE_MS) return true;
      log(`WAIT   ${f.name}: changed in the last 5 minutes, left for the next scan`);
      return false;
    })
    .sort((a, b) => a.stat.birthtimeMs - b.stat.birthtimeMs || a.name.localeCompare(b.name));

  const ready = []; // { name, file, hash, jpg, caption }
  let captionFails = 0;
  for (const img of images) {
    const hash = sha256(img.file);
    const dup = known.get(hash);
    if (dup) {
      log(`DUP    ${img.name}: same image as ${dup}${dry ? '' : ', moved to duplicates/'}`);
      if (!dry) moveInto(img.file, at('duplicates'));
      continue;
    }
    known.set(hash, `this scan (${img.name})`);
    if (dry) {
      ready.push({ ...img, hash });
      continue;
    }
    // Convert to a light JPEG in a temporary folder outside the project
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pinterest-autopost-'));
    const jpg = path.join(tmp, path.parse(img.name).name + '.jpg');
    try {
      const sharp = (await import('sharp')).default;
      await sharp(img.file).rotate().resize({ width: cfg.jpegWidth, withoutEnlargement: true })
        .jpeg({ quality: cfg.jpegQuality, mozjpeg: true }).toFile(jpg);
    } catch (err) {
      moveInto(img.file, at('failed'));
      log(`FAILED ${img.name}: could not be read as an image (${err.message}), moved to failed/`);
      continue;
    }
    // A caption failure is usually temporary (usage limit, no network): the image stays in the root for the next night
    if (captionFails >= 2) {
      log(`WAIT   ${img.name}: text writing is failing tonight, left for the next scan`);
      continue;
    }
    try {
      const { writeCaption } = await import('./lib/caption.mjs');
      const caption = writeCaption(jpg, path.parse(img.name).name, usedTitles);
      usedTitles.push(caption.title);
      ready.push({ ...img, hash, jpg, caption });
      captionFails = 0;
    } catch (err) {
      captionFails++;
      log(`WAIT   ${img.name}: text could not be written (${err.message}), left for the next scan`);
    }
  }

  if (!ready.length) {
    log('IDLE   no new images to schedule');
    return 0;
  }
  const slots = planSlots({ count: ready.length, lastDay, cfg });
  ready.forEach((img, i) => {
    const slot = slots[i];
    if (dry) {
      log(`PLAN   ${slot}  ${img.name}`);
      return;
    }
    fs.mkdirSync(at('queue', slot), { recursive: true });
    fs.copyFileSync(img.jpg, at('queue', slot, path.basename(img.jpg)));
    // the original keeps its name unless scheduled/ already has one called the same
    const moved = moveInto(img.file, at('scheduled'));
    writePin('queue', slot, { ...img.caption, source: path.basename(moved), sha256: img.hash });
    log(`QUEUED ${slot}  ${img.name}  "${img.caption.title}"`);
  });
  return ready.length;
}

if (import.meta.filename === path.resolve(process.argv[1] ?? '')) {
  scan({ dry: process.argv.includes('--dry-run') }).catch((err) => {
    writeLog(`ERROR  ${err.stack || err.message}`);
    process.exitCode = 1;
  });
}
