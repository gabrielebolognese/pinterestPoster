import fs from 'node:fs';
import { at } from './util.mjs';

const FILE = () => at('.env');

export function readEnv() {
  const out = {};
  if (!fs.existsSync(FILE())) return out;
  for (const line of fs.readFileSync(FILE(), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

// Change or add keys, keeping comments and the other lines as they are
export function updateEnv(values) {
  const lines = fs.existsSync(FILE()) ? fs.readFileSync(FILE(), 'utf8').split(/\r?\n/) : [];
  const left = { ...values };
  const next = lines.map((line) => {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=/);
    if (m && m[1] in left) {
      const v = left[m[1]];
      delete left[m[1]];
      return `${m[1]}=${v}`;
    }
    return line;
  });
  while (next.length && next[next.length - 1] === '') next.pop();
  for (const [k, v] of Object.entries(left)) next.push(`${k}=${v}`);
  fs.writeFileSync(FILE(), next.join('\n') + '\n');
}
