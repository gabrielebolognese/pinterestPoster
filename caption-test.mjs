// Preview the Pin text for one image without scheduling anything: node caption-test.mjs wall-handstand.png
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { cfg } from './lib/util.mjs';
import { writeCaption } from './lib/caption.mjs';

const file = process.argv[2];
if (!file || !fs.existsSync(file)) {
  console.error('Usage: node caption-test.mjs <image file>');
  process.exit(1);
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pinterest-autopost-'));
const jpg = path.join(tmp, path.parse(file).name + '.jpg');
await sharp(file).rotate().resize({ width: cfg.jpegWidth, withoutEnlargement: true })
  .jpeg({ quality: cfg.jpegQuality, mozjpeg: true }).toFile(jpg);
console.log(`JPEG: ${(fs.statSync(jpg).size / 1024).toFixed(0)} KB`);
console.log(JSON.stringify(writeCaption(jpg, path.parse(file).name, process.argv.slice(3)), null, 2));
