import {WorkflowEntrypoint} from 'cloudflare:workers';
import {collectSnapshot} from './data.mjs';
import {shareView} from '../public/participation.js';

const key = 'pulse-v1';

export class RefreshPulse extends WorkflowEntrypoint {
  async run(event, step) {
    const snapshot = await collectSnapshot({step: (name, run) => step.do(name, run), now: event.timestamp.getTime()});
    await step.do('publish snapshot', () => this.env.PULSE.put(key, JSON.stringify(snapshot)));
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/pulse') {
      const body = await env.PULSE.get(key, {cacheTtl: 60});
      if (body === null) {
        return Response.json({error: 'The first snapshot is not available yet.'}, {status: 503, headers: {'Retry-After': '60', 'Cache-Control': 'no-store'}});
      }
      return new Response(body, {headers: {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=60', 'X-Content-Type-Options': 'nosniff'}});
    }
    const response = await env.ASSETS.fetch(request);
    if (url.pathname !== '/') return response;
    const view = shareView(url.searchParams.get('view'));
    const rewriter = new HTMLRewriter()
      .on('meta[property="og:image"], meta[name="twitter:image"]', {
        element(el) { el.setAttribute('content', new URL(view?.[2] ?? '/share.png', url).href); },
      });
    if (view) {
      rewriter.on('meta[property="og:title"], meta[name="twitter:title"]', {
        element(el) { el.setAttribute('content', `${view[0]} · Taskmarket Pulse`); },
      }).on('meta[property="og:description"], meta[name="twitter:description"]', {
        element(el) { el.setAttribute('content', view[1]); },
      });
    }
    return rewriter.transform(response);
  },
  async scheduled(_event, env) {
    await env.REFRESH.create();
  },
};
