const NETWORKS = {tempo: {id: 4217}, base: {id: 8453}};
const API = 'https://api.taskmarket.dev/api/';
const DAY = 86_400_000;
const WEEK = 7 * DAY;
const MAX_PAGES = 40;
const address = /^0x[0-9a-f]{40}$/i;
const taskId = /^0x[0-9a-f]{64}$/i;
const taskStatuses = ['open', 'claimed', 'worker_selected', 'pending_approval', 'review', 'in_review', 'completed', 'cancelled', 'expired', 'disputed', 'rejected', 'refunded'];
const taskModes = ['bounty', 'claim', 'pitch', 'benchmark', 'auction'];
const eventTypes = ['task_created', 'task_claimed', 'task_submitted', 'task_completed', 'task_cancelled', 'task_paid', 'task_rated', 'task_settled', 'worker_registered'];
const date = epoch => new Date(epoch).toISOString();
const day = epoch => date(epoch).slice(0, 10);

export function monday(epoch) {
  const d = new Date(epoch);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - (d.getUTCDay() + 6) % 7);
}

function count(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid activity count');
  return value;
}

function units(value) {
  if (!/^\d+$/.test(String(value ?? ''))) throw new Error('Invalid reward amount');
  return String(value);
}

async function api(fetcher, path, chainId, parameters = {}) {
  const url = new URL(path, API);
  url.search = new URLSearchParams({chainId, ...parameters});
  const res = await fetcher(url, {signal: AbortSignal.timeout(15_000), headers: {Accept: 'application/json'}});
  if (!res.ok) throw new Error(`${path} returned HTTP ${res.status}`);
  return res.json();
}

function readHeadline(payload) {
  return Object.fromEntries(['registeredWorkers', 'activeWorkers7d', 'activeAgents7d', 'openTasks', 'paidWorkers', 'activeWallets'].map(key => [key, count(payload[key])]));
}

function readSeries(payload) {
  return payload.map(row => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.bucket)) throw new Error('Invalid date bucket');
    return {day: row.bucket, agents: count(row.activeAgents), tasks: count(row.tasksCreated), offered: units(row.rewardVolume), paid: units(row.paidVolume)};
  }).sort((a, b) => a.day.localeCompare(b.day));
}

function readBreakdowns(payload) {
  const read = (key, allowed) => payload[key].map(row => ({key: allowed.includes(row[key]) ? row[key] : 'other', count: count(row.count)}))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  return {mode: read('mode', taskModes), status: read('status', taskStatuses)};
}

function readHeat(payload) {
  const grid = Array.from({length: 7}, () => Array(24).fill(0));
  for (const cell of payload.cells) {
    const y = Number(cell.row), x = Number(cell.col);
    if (!Number.isInteger(y) || y < 0 || y > 6 || !Number.isInteger(x) || x < 0 || x > 23) throw new Error('Invalid heatmap cell');
    grid[y][x] = count(cell.count);
  }
  return grid;
}

function postingWeeks(rows, now) {
  const start = monday(now) - 12 * WEEK;
  const buckets = Array.from({length: 13}, (_, i) => ({week: day(start + i * WEEK), repeats: new Map(), tasks: 0}));
  const seen = new Set();
  for (const [id, created, wallet] of rows) {
    const epoch = Date.parse(created);
    if (!taskId.test(id) || !Number.isFinite(epoch) || epoch < start || epoch > now || seen.has(id)) continue;
    seen.add(id);
    const bucket = buckets[Math.floor((epoch - start) / WEEK)];
    bucket.tasks++;
    if (address.test(wallet)) {
      const key = wallet.toLowerCase();
      bucket.repeats.set(key, (bucket.repeats.get(key) ?? 0) + 1);
    }
  }
  const posters = buckets.map(({week, repeats, tasks}, index) => {
    const repeat = [...repeats.values()].filter(n => n > 1);
    return {week, tasks, posters: repeats.size, repeat: repeat.length, repeatTasks: repeat.reduce((sum, n) => sum + n, 0), partial: index === 12};
  });
  const handoffs = buckets.slice(1).map(({week, repeats, tasks}, index) => {
    const prior = buckets[index];
    const returning = [...repeats].filter(([requester]) => prior.repeats.has(requester));
    const returningTasks = returning.reduce((sum, [, n]) => sum + n, 0);
    return {
      week, priorWeek: prior.week, partial: posters[index + 1].partial, tasks,
      priorPosters: prior.repeats.size, returningPosters: returning.length,
      returningTasks,
      absentLastWeekTasks: [...repeats.values()].reduce((sum, n) => sum + n, 0) - returningTasks,
    };
  });
  return {posters, handoffs};
}

export function posterWeeks(rows, now) {
  return postingWeeks(rows, now).posters;
}

async function readPosterWeeks({fetcher, step, network, now}) {
  const start = monday(now) - 12 * WEEK;
  let cursor;
  const rows = [];
  for (let i = 0; i < MAX_PAGES; i++) {
    const page = await step(`${network.id} task page ${i + 1}`, async () => {
      const body = await api(fetcher, 'tasks', network.id, {sort: 'newest', limit: 100, ...(cursor ? {cursor} : {})});
      const items = body.tasks.map(t => {
        if (t.chainId !== network.id || !Number.isFinite(Date.parse(t.createdAt))) throw new Error('Task page mixed networks or dates');
        return [t.id, t.createdAt, t.requester ?? ''];
      });
      const oldest = items.at(-1)?.[1];
      return {rows: items.filter(t => Date.parse(t[1]) >= start), done: body.hasMore === false || (oldest && Date.parse(oldest) < start), next: body.nextCursor};
    });
    rows.push(...page.rows);
    if (page.done) return step(`${network.id} weekly counts`, () => postingWeeks(rows, now));
    if (!page.next || page.next === cursor) throw new Error('Task list cursor did not advance');
    cursor = page.next;
  }
  throw new Error('Task list exceeded the safe pagination limit; no partial count published');
}

async function readFeed({fetcher, step}) {
  const byChain = {[NETWORKS.tempo.id]: [], [NETWORKS.base.id]: []};
  const seen = new Set();
  let cursor;
  for (let i = 0; i < 6; i++) {
    const page = await step(`market feed page ${i + 1}`, async () => {
      const body = await api(fetcher, 'stats/activity-feed', NETWORKS.tempo.id, {limit: 50, ...(cursor ? {cursor} : {})});
      return {
        items: body.items.filter(x => x.chainId in byChain && taskId.test(x.taskId) && Number.isFinite(Date.parse(x.timestamp)))
          .map(x => ({chainId: x.chainId, id: x.taskId, at: date(Date.parse(x.timestamp)), type: eventTypes.includes(x.type) ? x.type : 'activity'})),
        next: body.nextCursor,
      };
    });
    for (const event of page.items) {
      const key = `${event.chainId}/${event.id}/${event.at}/${event.type}`;
      if (!seen.has(key)) byChain[event.chainId].push(event);
      seen.add(key);
    }
    if (Object.values(byChain).every(items => items.length >= 12) || !page.next || page.next === cursor) break;
    cursor = page.next;
  }
  return Object.fromEntries(Object.entries(byChain).map(([chain, items]) => [chain, items.slice(0, 12)]));
}

function compare(values) {
  return JSON.stringify(values.tempo) === JSON.stringify(values.base) ? {shared: values.tempo} : {byNetwork: values};
}

export async function collectSnapshot({fetcher = fetch, step = (_name, run) => run(), now = Date.now()} = {}) {
  const readNetwork = async ([key, network]) => {
    const get = (label, path, read, parameters) => step(`${key} ${label}`, async () => read(await api(fetcher, path, network.id, parameters)));
    // Run API calls in small batches across both networks.
    const [headline, series, breakdown] = await Promise.all([
      get('headline', 'market/stats', readHeadline),
      get('daily series', 'stats/platform-time-series', readSeries, {range: 'all', bucket: 'day'}),
      get('breakdown', 'stats/breakdowns', readBreakdowns),
    ]);
    const [heat, posting] = await Promise.all([
      get('heatmap', 'stats/activity-heatmap', readHeat, {range: '30d', dimension: 'hourOfWeek'}),
      readPosterWeeks({fetcher, step, network, now}),
    ]);
    return [key, {headline, series, breakdown, heat, ...posting}];
  };
  const networks = Object.fromEntries(await Promise.all(Object.entries(NETWORKS).map(readNetwork)));
  const feed = await readFeed({fetcher, step});
  const field = key => Object.fromEntries(Object.entries(networks).map(([net, data]) => [net, data[key]]));
  return {
    asOf: date(now),
    headline: field('headline'),
    series: compare(field('series')),
    breakdown: compare(field('breakdown')),
    heat: compare(field('heat')),
    networks: Object.fromEntries(Object.entries(networks).map(([net, {posters, handoffs}]) => [net, {posters, handoffs, feed: feed[NETWORKS[net].id]}])),
  };
}
