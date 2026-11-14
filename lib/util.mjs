import fs from 'node:fs';
import path from 'node:path';

// PINS_ROOT lets the tests run against a temporary folder
export const ROOT = process.env.PINS_ROOT || path.dirname(import.meta.dirname);
export const cfg = JSON.parse(fs.readFileSync(path.join(path.dirname(import.meta.dirname), 'config.json'), 'utf8'));
export const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp']);
export const SLOT = /^(\d{4}-\d{2}-\d{2})_(\d{2})(\d{2})$/;

export const at = (...p) => path.join(ROOT, ...p);

// Pin folders (2026-11-12_1127) inside queue/, posted/ or failed/, sorted by time
export function pinDirs(folder) {
  const dir = at(folder);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && SLOT.test(d.name))
    .map((d) => d.name)
    .sort();
}

export function readPin(folder, name) {
  try {
    return JSON.parse(fs.readFileSync(at(folder, name, 'pin.json'), 'utf8'));
  } catch {
    return null;
  }
}

export function writePin(folder, name, pin) {
  fs.writeFileSync(at(folder, name, 'pin.json'), JSON.stringify(pin, null, 2) + '\n');
}

// Move a file or folder into a folder without ever overwriting: a taken name gets -1, -2...
export function moveInto(src, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  const { name, ext } = path.parse(src);
  let dest = path.join(destDir, name + ext);
  for (let i = 1; fs.existsSync(dest); i++) dest = path.join(destDir, `${name}-${i}${ext}`);
  fs.renameSync(src, dest);
  return dest;
}

// One line per action, on screen and in logs/runner.log
export function log(msg, { file = true } = {}) {
  const line = `[${new Date().toLocaleString('sv-SE')}] ${msg}`;
  console.log(line);
  if (file) {
    fs.mkdirSync(at('logs'), { recursive: true });
    fs.appendFileSync(at('logs', 'runner.log'), line + '\n');
  }
}
