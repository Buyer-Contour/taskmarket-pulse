import {WorkflowEntrypoint} from 'cloudflare:workers';
import {initWasm} from '@resvg/resvg-wasm';
import wasm from '@resvg/resvg-wasm/index_bg.wasm';
import {collectSnapshot} from './data.mjs';
import {shareView} from '../public/participation.js';
import {snapshotHealth} from './health.mjs';
import {preview, renderCard, signalStory} from './share.mjs';

const key = 'pulse-v1';
const rendererReady = initWasm(wasm);
let cardFonts;

export class RefreshPulse extends WorkflowEntrypoint {
  async run(event, step) {
    const snapshot = await collectSnapshot({step: (name, run) => step.do(name, run), now: event.timestamp.getTime()});
    await step.do('publish snapshot', () => this.env.PULSE.put(key, JSON.stringify(snapshot)));
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/healthz' || url.pathname === '/share-signal.png' || url.pathname === '/api/pulse') {
      const body = await env.PULSE.get(key, {cacheTtl: 60});
      if (url.pathname === '/healthz') {
        return Response.json(snapshotHealth(body && JSON.parse(body).asOf), {status: body ? 200 : 503, headers: {'Cache-Control': 'no-store'}});
      }
      if (body === null) {
        return Response.json({error: 'The first snapshot is not available yet.'}, {status: 503, headers: {'Retry-After': '60', 'Cache-Control': 'no-store'}});
      }
      if (url.pathname === '/share-signal.png') {
        const snapshot = JSON.parse(body);
        const story = signalStory(snapshot, url.searchParams);
        if (!story) return new Response(null, {status: 404});
        await rendererReady;
        cardFonts ??= await Promise.all(['InstrumentSerif-Regular.ttf', 'InterTight-Variable.ttf'].map(async name => {
          const font = await env.ASSETS.fetch(new Request(new URL('/' + name, url)));
          return new Uint8Array(await font.arrayBuffer());
        }));
        return new Response(renderCard(story, snapshot.asOf, cardFonts), {headers: {'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=60'}});
      }
      return new Response(body, {headers: {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=60', 'X-Content-Type-Options': 'nosniff'}});
    }
    const response = await env.ASSETS.fetch(request);
    if (url.pathname !== '/') return response;
    const view = shareView(url.searchParams.get('view'));
    const snapshot = view?.[2] === '/share-signal.png' ? await env.PULSE.get(key, {type: 'json', cacheTtl: 60}) : null;
    const {image, description} = preview(snapshot, url, view);
    const rewriter = new HTMLRewriter()
      .on('meta[property="og:image"], meta[name="twitter:image"]', {
        element(el) { el.setAttribute('content', image); },
      });
    if (view) {
      rewriter.on('meta[property="og:title"], meta[name="twitter:title"]', {
        element(el) { el.setAttribute('content', `${view[0]} · Taskmarket Pulse`); },
      }).on('meta[property="og:description"], meta[name="twitter:description"]', {
        element(el) { el.setAttribute('content', description); },
      });
    }
    return rewriter.transform(response);
  },
  async scheduled(_event, env) {
    await env.REFRESH.create();
  },
};
