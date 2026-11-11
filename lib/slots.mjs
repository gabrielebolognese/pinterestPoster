// Pure date logic for the calendar. Days and times are wall clock in the configured timezone.

const toMin = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const pad = (n) => String(n).padStart(2, '0');

export function localParts(ms, timeZone) {
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const p = Object.fromEntries(f.formatToParts(ms).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

export function addDays(date, n) {
  const d = new Date(`${date}T00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Folder names for `count` new pins.
// lastDay: date of the last pin in the calendar (waiting or posted), or null.
// A new pin goes `everyDays` after lastDay, or on the first day that still has room in the window
// (at least 30 minutes from now) when lastDay is older than that. Each one after it is `everyDays` later.
export function planSlots({ count, now = Date.now(), lastDay = null, cfg, rand = Math.random }) {
  const start = toMin(cfg.windowStart);
  const end = toMin(cfg.windowEnd);
  const soon = localParts(now + 30 * 60000, cfg.timezone);
  let day = soon.date;
  let from = Math.max(start, soon.minutes);
  if (from > end) {
    day = addDays(day, 1);
    from = start;
  }
  if (lastDay) {
    const next = addDays(lastDay, cfg.everyDays);
    if (next > day) {
      day = next;
      from = start;
    }
  }
  const out = [];
  for (let i = 0; i < count; i++) {
    const m = from + Math.floor(rand() * (end - from + 1));
    out.push(`${day}_${pad(Math.floor(m / 60))}${pad(m % 60)}`);
    day = addDays(day, cfg.everyDays);
    from = start;
  }
  return out;
}
