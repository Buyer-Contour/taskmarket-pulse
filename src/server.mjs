import {createServer} from 'node:http';
import {readFile, readdir, rename, writeFile} from 'node:fs/promises';
import {initWasm} from '@resvg/resvg-wasm';
import {collectSnapshot} from './data.mjs';
import {shareView} from '../public/participation.js';
import {snapshotHealth} from './health.mjs';
import {preview, renderCard, signalStory} from './share.mjs';

const assets = new URL('../public/', import.meta.url);
const mime = {html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8', png: 'image/png', ttf: 'font/ttf', woff2: 'font/woff2', txt: 'text/plain; charset=utf-8'};
const files = new Map(await Promise.all((await readdir(assets)).map(async file => [
  '/' + file, {contents: await readFile(new URL(file, assets)), type: mime[file.split('.').at(-1)]},
])));
const releaseOrigin = process.env.LOCUS_SERVICE_URL ? new URL(process.env.LOCUS_SERVICE_URL).origin : null;
const checkpoint = process.env.PULSE_CHECKPOINT;
const fonts = ['InstrumentSerif-Regular.ttf', 'InterTight-Variable.ttf'].map(name => files.get('/' + name).contents);
const wasm = initWasm(readFile(new URL(import.meta.resolve('@resvg/resvg-wasm/index_bg.wasm'))));
const cards = new Map();
let snapshot, body, refreshing = false, failed = false;

function publish(next, bytes = Buffer.from(JSON.stringify(next))) {
  if (!Number.isFinite(Date.parse(next.asOf)) || !next.networks?.tempo?.handoffs || !next.networks?.base?.handoffs) throw new Error('Invalid snapshot');
  snapshot = next;
  body = bytes;
  cards.clear();
}

if (checkpoint) {
  try {
    const bytes = await readFile(checkpoint);
    publish(JSON.parse(bytes), bytes);
    failed = true;
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('Snapshot checkpoint unavailable:', error.message);
  }
}

async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    const next = await collectSnapshot();
    publish(next);
    failed = false;
    console.info(`Published Taskmarket snapshot as of ${snapshot.asOf}`);
    if (checkpoint) {
      try {
        await writeFile(checkpoint + '.next', body, {mode: 0o600});
        await rename(checkpoint + '.next', checkpoint);
      } catch (error) {
        console.error('Could not save snapshot checkpoint:', error.message);
      }
    }
  } catch (error) {
    failed = true;
    console.error('Snapshot refresh failed:', error.message);
  } finally {
    refreshing = false;
  }
}

const server = createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, {Allow: 'GET, HEAD'}).end();
    return;
  }
  const path = req.url.split('?')[0];
  const health = snapshotHealth(snapshot?.asOf, failed);
  if (path === '/healthz') {
    res.writeHead(snapshot ? 200 : 503, {'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8'})
      .end(JSON.stringify(health));
    return;
  }
  if (path === '/api/pulse') {
    if (!snapshot) {
      res.writeHead(503, {'Retry-After': '60', 'Cache-Control': 'no-store', 'Content-Type': 'application/json'}).end('{"error":"The first snapshot is not available yet."}');
      return;
    }
    res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=60', 'X-Pulse-Status': health.status}).end(body);
    return;
  }
  const origin = releaseOrigin ?? new URL(`http://localhost:${server.address().port}`).origin;
  if (path === '/share-signal.png') {
    const current = snapshot;
    const story = signalStory(current, new URL(req.url, origin).searchParams);
    if (!story) {
      res.writeHead(current ? 404 : 503, {'Cache-Control': 'no-store'}).end();
      return;
    }
    try {
      await wasm;
      const cached = current === snapshot && cards.get(story.key);
      const png = cached || renderCard(story, current.asOf, fonts);
      if (current === snapshot && !cached) cards.set(story.key, png);
      res.writeHead(200, {'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=60'}).end(req.method === 'HEAD' ? undefined : png);
    } catch (error) {
      console.error('Could not render snapshot card:', error.message);
      res.writeHead(503, {'Cache-Control': 'no-store'}).end();
    }
    return;
  }
  const file = files.get(path === '/' ? '/index.html' : path);
  if (!file) {
    res.writeHead(404).end();
    return;
  }
  if (path === '/' || path === '/index.html') {
    const url = new URL(req.url, origin);
    const view = shareView(url.searchParams.get('view'));
    const {image, description} = preview(snapshot, url, view);
    let html = file.contents.toString().replaceAll('content="/share.png"', `content="${image.replaceAll('&', '&amp;')}"`);
    if (view) html = html.replaceAll('content="Taskmarket Pulse · BuyerContour"', `content="${view[0]} · Taskmarket Pulse"`)
      .replaceAll('content="Track agent activity, reward flows and task posting on Tempo and Base."', `content="${description}"`);
    res.writeHead(200, {'Content-Type': file.type, 'Cache-Control': 'public, max-age=60'})
      .end(html);
    return;
  }
  res.writeHead(200, {'Content-Type': file.type, 'Cache-Control': 'public, max-age=3600'}).end(file.contents);
});

server.listen(Number(process.env.PORT ?? 8788), '0.0.0.0');
void refresh();
setInterval(refresh, 5 * 60_000);
