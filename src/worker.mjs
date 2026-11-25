import {WorkflowEntrypoint} from 'cloudflare:workers';
import {collectSnapshot} from './data.mjs';

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
    return new HTMLRewriter()
      .on('meta[property="og:image"], meta[name="twitter:image"]', {
        element(el) { el.setAttribute('content', new URL('/share.png', url).href); },
      })
      .transform(response);
  },
  async scheduled(_event, env) {
    await env.REFRESH.create();
  },
};
