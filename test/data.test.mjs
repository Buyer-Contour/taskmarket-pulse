import {test} from 'node:test';
import assert from 'node:assert/strict';
import {collectSnapshot, posterWeeks} from '../src/data.mjs';

const now = Date.parse('2026-11-25T05:00:00Z');
const id = n => '0x' + n.toString(16).padStart(64, '0');
const wallet = '0x' + 'ab'.repeat(20);
const other = '0x' + 'ef'.repeat(20);

test('weekly counts deduplicate paginated task IDs and case-fold requesters at UTC week boundaries', () => {
  const weeks = posterWeeks([
    [id(1), '2026-11-22T23:59:59Z', wallet],
    [id(2), '2026-11-23T00:00:00Z', wallet],
    [id(3), '2026-11-23T12:00:00Z', '0x' + wallet.slice(2).toUpperCase()],
    [id(3), '2026-11-23T12:00:00Z', other],
    [id(4), '2026-11-24T15:00:00Z', other],
    [id(5), '2026-11-25T05:00:01Z', other],
  ], now);
  assert.equal(weeks.length, 13);
  assert.deepEqual(weeks.slice(-2), [
    {week: '2026-11-16', tasks: 1, posters: 1, repeat: 0, repeatTasks: 0, partial: false},
    {week: '2026-11-23', tasks: 3, posters: 2, repeat: 1, repeatTasks: 2, partial: true},
  ]);
});

function fixture({badCursor = false} = {}) {
  const calls = [];
  const fetcher = async url => {
    const chain = Number(url.searchParams.get('chainId'));
    calls.push([url.pathname, chain, url.searchParams.get('cursor')]);
    const cursor = url.searchParams.get('cursor');
    let body;
    switch (url.pathname) {
      case '/api/tasks':
        assert.equal(url.searchParams.get('limit'), '100');
        body = {tasks: [{id: id(cursor ? 2 : 1), requester: cursor ? other : wallet, createdAt: '2026-11-24T00:00:00Z', chainId: chain}], hasMore: !cursor || badCursor, nextCursor: 'next'};
        break;
      case '/api/stats/activity-feed':
        assert.equal(url.searchParams.get('limit'), '50');
        body = {items: [{chainId: cursor ? 8453 : 4217, taskId: id(1), timestamp: '2026-11-24T00:00:00Z', type: 'task_created', actor: wallet}], nextCursor: cursor ? null : 'feed-next'};
        break;
      case '/api/market/stats':
        body = {registeredWorkers: 5, activeWorkers7d: 4, activeAgents7d: 3, openTasks: 2, paidWorkers: chain === 8453 ? 10 : 1, activeWallets: 8};
        break;
      case '/api/stats/platform-time-series':
        body = [{bucket: '2026-11-24', activeAgents: 4, tasksCreated: 2, rewardVolume: '75300000', paidVolume: '6000510'}];
        break;
      case '/api/stats/breakdowns':
        body = {status: [{status: 'open', count: chain === 8453 ? 2 : 1}], mode: [{mode: 'bounty', count: 1}]};
        break;
      case '/api/stats/activity-heatmap':
        body = {cells: [{row: '5', col: '19', count: 29}]};
        break;
      default: throw new Error('Unexpected upstream request');
    }
    return Response.json(body);
  };
  return {fetcher, calls};
}

test('snapshot keeps both networks, exact reward units, and no requester or actor identifiers', async () => {
  const {fetcher, calls} = fixture();
  const s = await collectSnapshot({fetcher, now});
  assert.equal(s.asOf, new Date(now).toISOString());
  assert.equal(s.headline.tempo.paidWorkers, 1);
  assert.equal(s.headline.base.paidWorkers, 10);
  assert.deepEqual(s.series.shared[0], {day: '2026-11-24', agents: 4, tasks: 2, offered: '75300000', paid: '6000510'});
  assert.equal(s.breakdown.byNetwork.base.status[0].count, 2);
  assert.equal(s.heat.shared[5][19], 29);
  for (const [network, chain] of [['tempo', 4217], ['base', 8453]]) {
    assert.equal(s.networks[network].posters.at(-1).posters, 2);
    assert.deepEqual(s.networks[network].feed.map(e => e.chainId), [chain]);
    assert.deepEqual(calls.filter(([path, id]) => path === '/api/tasks' && id === chain).map(call => call[2]), [null, 'next']);
  }
  assert.ok(!JSON.stringify(s).includes(wallet));
  assert.ok(!JSON.stringify(s).includes(other));
});

test('task pagination rejects incomplete counts if the cursor stalls', async () => {
  await assert.rejects(collectSnapshot({...fixture({badCursor: true}), now}), /cursor did not advance/);
});
