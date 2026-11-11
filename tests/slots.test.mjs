import test from 'node:test';
import assert from 'node:assert/strict';
import { planSlots, addDays } from '../lib/slots.mjs';

const cfg = { timezone: 'Europe/Rome', windowStart: '10:00', windowEnd: '13:00', everyDays: 2 };
const rome = (s) => new Date(`${s}+01:00`).getTime(); // winter time
const days = (slots) => slots.map((s) => s.slice(0, 10));
const inWindow = (s) => s.slice(11) >= '1000' && s.slice(11) <= '1300';

test('10 images at the 02:00 scan fill every other day starting the same day', () => {
  const slots = planSlots({ count: 10, now: rome('2026-11-12T02:00'), cfg });
  assert.deepEqual(days(slots), Array.from({ length: 10 }, (_, i) => addDays('2026-11-12', i * 2)));
  assert.equal(slots.at(-1).slice(0, 10), '2026-11-30');
  assert.ok(slots.every(inWindow));
});

test('images added later go after the last pin in the calendar', () => {
  const two = planSlots({ count: 2, now: rome('2026-11-13T02:00'), lastDay: '2026-11-30', cfg });
  assert.deepEqual(days(two), ['2026-12-02', '2026-12-04']);
  const five = planSlots({ count: 5, now: rome('2026-11-20T02:00'), lastDay: '2026-12-04', cfg });
  assert.deepEqual(days(five), ['2026-12-06', '2026-12-08', '2026-12-10', '2026-12-12', '2026-12-14']);
});

test('empty queue, last pin yesterday: waits the two days', () => {
  assert.deepEqual(days(planSlots({ count: 1, now: rome('2026-12-16T02:00'), lastDay: '2026-12-14', cfg })), ['2026-12-16']);
  assert.deepEqual(days(planSlots({ count: 1, now: rome('2026-12-15T02:00'), lastDay: '2026-12-14', cfg })), ['2026-12-16']);
});

test('empty queue, last pin long ago: first day after the scan', () => {
  assert.deepEqual(days(planSlots({ count: 1, now: rome('2027-01-11T02:00'), lastDay: '2026-12-14', cfg })), ['2027-01-11']);
});

test('late scan inside the window only uses the time that is left, at least 30 minutes ahead', () => {
  for (let i = 0; i < 200; i++) {
    const [slot] = planSlots({ count: 1, now: rome('2026-11-12T11:40'), cfg });
    assert.equal(slot.slice(0, 10), '2026-11-12');
    assert.ok(slot.slice(11) >= '1210' && slot.slice(11) <= '1300', slot);
  }
});

test('scan after the window goes to the next day', () => {
  assert.deepEqual(days(planSlots({ count: 2, now: rome('2026-11-11T21:30'), cfg })), ['2026-11-12', '2026-11-14']);
  assert.deepEqual(days(planSlots({ count: 1, now: rome('2026-11-12T12:45'), cfg })), ['2026-11-13']);
});

test('random times cover the whole window, ends included', () => {
  const lo = planSlots({ count: 1, now: rome('2026-11-12T02:00'), cfg, rand: () => 0 })[0];
  const hi = planSlots({ count: 1, now: rome('2026-11-12T02:00'), cfg, rand: () => 0.999999 })[0];
  assert.equal(lo, '2026-11-12_1000');
  assert.equal(hi, '2026-11-12_1300');
});

test('summer time uses the Italian wall clock too', () => {
  const now = new Date('2027-07-01T02:00+02:00').getTime();
  assert.deepEqual(days(planSlots({ count: 1, now, cfg })), ['2027-07-01']);
});
