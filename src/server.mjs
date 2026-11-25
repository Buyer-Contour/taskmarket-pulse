import {createServer} from 'node:http';
import {readFile, readdir} from 'node:fs/promises';
import {collectSnapshot} from './data.mjs';

const assets = new URL('../public/', import.meta.url);
const mime = {html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8', png: 'image/png', ttf: 'font/ttf', woff2: 'font/woff2', txt: 'text/plain; charset=utf-8'};
const files = new Map(await Promise.all((await readdir(assets)).map(async file => [
  '/' + file, {contents: await readFile(new URL(file, assets)), type: mime[file.split('.').at(-1)]},
])));
const releaseOrigin = process.env.LOCUS_SERVICE_URL ? new URL(process.env.LOCUS_SERVICE_URL).origin : null;
let snapshot, asOf, refreshing = false;

async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    const next = await collectSnapshot();
    snapshot = Buffer.from(JSON.stringify(next));
    asOf = next.asOf;
    console.info(`Published Taskmarket snapshot as of ${asOf}`);
  } catch (error) {
    console.error('Snapshot refresh failed:', error.message);
  } finally {
    refreshing = false;
  }
}

const server = createServer((req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, {Allow: 'GET, HEAD'}).end();
    return;
  }
  const path = req.url.split('?')[0];
  if (path === '/api/pulse' || path === '/healthz') {
    if (!snapshot) {
      res.writeHead(503, {'Retry-After': '60', 'Cache-Control': 'no-store', 'Content-Type': 'application/json'}).end('{"error":"The first snapshot is not available yet."}');
      return;
    }
    res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': path === '/healthz' ? 'no-store' : 'public, max-age=60'})
      .end(path === '/healthz' ? JSON.stringify({asOf}) : snapshot);
    return;
  }
  const file = files.get(path === '/' ? '/index.html' : path);
  if (!file) {
    res.writeHead(404).end();
    return;
  }
  if (path === '/' || path === '/index.html') {
    const origin = releaseOrigin ?? new URL(`http://localhost:${server.address().port}`).origin;
    res.writeHead(200, {'Content-Type': file.type, 'Cache-Control': 'public, max-age=60'})
      .end(file.contents.toString().replaceAll('content="/share.png"', `content="${origin}/share.png"`));
    return;
  }
  res.writeHead(200, {'Content-Type': file.type, 'Cache-Control': 'public, max-age=3600'}).end(file.contents);
});

server.listen(Number(process.env.PORT ?? 8788), '0.0.0.0');
void refresh();
setInterval(refresh, 5 * 60_000);
