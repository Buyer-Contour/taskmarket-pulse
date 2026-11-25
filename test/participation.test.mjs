import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {postingCsv, postingMix, shareView} from '../public/participation.js';

test('weekly mix separates one-time, repeat, and unclassified tasks', () => {
  const row = {week: '2026-11-16', partial: false, tasks: 12, posters: 5, repeat: 2, repeatTasks: 7};
  assert.deepEqual(postingMix(row), {once: 3, repeat: 7, unclassified: 2});
  assert.match(postingCsv([row]), /\n2026-11-16,false,12,5,2,7,3,2\n$/);
  assert.deepEqual(postingMix({tasks: 0, posters: 0, repeat: 0, repeatTasks: 0}), {once: 0, repeat: 0, unclassified: 0});
});

test('only declared views can select a share card', async () => {
  for (const key of ['trends', 'participation', 'activity']) {
    const card = shareView(key)[2];
    const png = await readFile(new URL('../public' + card, import.meta.url));
    assert.equal(png.readUInt32BE(16), 1200);
    assert.equal(png.readUInt32BE(20), 630);
  }
  for (const key of [null, 'constructor', '../share.png', 'other']) assert.equal(shareView(key), null);
});
