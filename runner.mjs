// The background runner. It stays alive on this PC and does two things:
//   - once a night, from 02:00 on, it scans the folder for new images and schedules them
//     (if the PC was off at 02:00, the scan runs as soon as the runner starts);
//   - every minute it posts the pins whose time has come.
// Start it in the foreground with "npm start", or in the background with install.ps1. Stop it with stop.ps1.
import fs from 'node:fs';
import { cfg, at, log } from './lib/util.mjs';
import { localParts } from './lib/slots.mjs';
import { loggedIn } from './lib/token.mjs';
import { scan } from './scan.mjs';
import { postDue } from './post.mjs';

const SCAN_FROM_MIN = 2 * 60; // 02:00
const TICK_MS = 60000;
const LOCK = at('logs', 'runner.lock');
const STATE = at('logs', 'state.json');

// Only one runner at a time: the lock holds the process id of the one that is alive
fs.mkdirSync(at('logs'), { recursive: true });
if (fs.existsSync(LOCK)) {
  const pid = Number(fs.readFileSync(LOCK, 'utf8'));
  let alive = false;
  try {
    process.kill(pid, 0);
    alive = true;
  } catch {}
  if (alive) {
    console.log(`The runner is already running (process ${pid}).`);
    process.exit(0);
  }
}
fs.writeFileSync(LOCK, String(process.pid));
const release = () => {
  try {
    if (Number(fs.readFileSync(LOCK, 'utf8')) === process.pid) fs.unlinkSync(LOCK);
  } catch {}
};
process.on('exit', release);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => process.exit(0));

const readState = () => {
  try {
    return JSON.parse(fs.readFileSync(STATE, 'utf8'));
  } catch {
    return {};
  }
};

let saidWaiting = false;

async function tick() {
  // Until the Pinterest login exists the runner only waits: scheduling now would give dates that pass unposted
  if (!loggedIn()) {
    if (!saidWaiting) log('WAIT   no Pinterest login yet (run "npm run login"); nothing is scheduled or posted until then');
    saidWaiting = true;
    return;
  }
  saidWaiting = false;

  const { date, minutes } = localParts(Date.now(), cfg.timezone);
  const state = readState();
  if (minutes >= SCAN_FROM_MIN && state.lastScan !== date) {
    log('SCAN   looking for new images');
    await scan();
    fs.writeFileSync(STATE, JSON.stringify({ ...state, lastScan: date }));
  }
  await postDue();
}

log(`START  runner started (process ${process.pid})`);
for (;;) {
  try {
    await tick();
  } catch (err) {
    log(`ERROR  ${err.stack || err.message}`);
  }
  await new Promise((r) => setTimeout(r, TICK_MS));
}
