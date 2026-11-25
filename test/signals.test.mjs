import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {initWasm} from '@resvg/resvg-wasm';
import {handoff, cadence} from '../public/signals.js';
import {shareView} from '../public/participation.js';
import {snapshotHealth} from '../src/health.mjs';
import {preview, renderCard, signalStory} from '../src/share.mjs';

const asOf = '2026-11-25T00:11:00.000Z';
const tempo = {handoffs: [
  {week: '2026-11-16', priorWeek: '2026-11-09', tasks: 11, returningTasks: 7, absentLastWeekTasks: 3, partial: false},
  {week: '2026-11-23', priorWeek: '2026-11-16', tasks: 4, returningTasks: 1, absentLastWeekTasks: 3, partial: true},
]};
const snapshot = {asOf, networks: {tempo, base: {handoffs: []}}, series: {shared: [
  {day: '2026-11-21', offered: '6000000', paid: '0'},
  {day: '2026-11-22', offered: '0', paid: '0'},
  {day: '2026-11-23', offered: '0', paid: '1'},
  {day: '2026-11-24', offered: '1', paid: '12'},
  {day: '2026-11-25', offered: '1', paid: '12'},
]}};

test('handoff defaults to a complete week but can expose an explicitly selected partial week', () => {
  assert.equal(handoff(snapshot, 'tempo', 'invalid').week, '2026-11-16');
  assert.equal(handoff(snapshot, 'tempo').unknown, 1);
  assert.equal(handoff(snapshot, 'tempo', '2026-11-23').partial, true);
  assert.equal(handoff(snapshot, 'base'), undefined);
});

test('cadence distinguishes explicit zero from absent dates and excludes the current day', () => {
  const result = cadence(snapshot, 'base');
  assert.deepEqual(result.counts, {both: 1, offered: 1, paid: 1, quiet: 1, missing: 10});
  assert.deepEqual(result.days.slice(-4).map(row => row.state), ['offered', 'quiet', 'paid', 'both']);
  assert.equal(result.paidDays, 2);
  assert.equal(result.shared, true);
});

test('each card encodes its own snapshot signal, scope, and supported filter', async () => {
  await initWasm(readFile(new URL(import.meta.resolve('@resvg/resvg-wasm/index_bg.wasm'))));
  const fonts = await Promise.all(['InstrumentSerif-Regular.ttf', 'InterTight-Variable.ttf'].map(name => readFile(new URL('../public/' + name, import.meta.url))));
  const cards = [];
  for (const [view, headline] of [['handoff', '1 / 4 tasks'], ['cadence', '1 / 2 payment days']]) {
    const url = new URL(`https://example.test/?view=${view}&week=2026-11-23`);
    const story = signalStory(snapshot, url.searchParams);
    assert.equal(story.headline, headline);
    const cardUrl = new URL(preview(snapshot, url, shareView(view)).image);
    assert.equal(cardUrl.searchParams.get('rev'), asOf);
    assert.equal(cardUrl.searchParams.get('week'), view === 'handoff' ? '2026-11-23' : null);
    const png = Buffer.from(renderCard(story, snapshot.asOf, fonts));
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [1200, 630]);
    cards.push(png);
  }
  assert.notDeepEqual(...cards);
  assert.equal(signalStory(snapshot, new URLSearchParams('view=constructor')), null);
});

test('health keeps warming, recent fallback, and stale snapshots distinct', () => {
  const now = Date.parse(asOf);
  assert.deepEqual(snapshotHealth(undefined, false, now), {status: 'warming', asOf: null, ageSeconds: null});
  assert.deepEqual(snapshotHealth(asOf, true, now + 60_000), {status: 'last-good', asOf, ageSeconds: 60});
  assert.equal(snapshotHealth(asOf, false, now + 3_599_999).status, 'fresh');
  assert.equal(snapshotHealth(asOf, true, now + 3_600_000).status, 'stale');
});
