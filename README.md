# Taskmarket Pulse

A read-only Taskmarket dashboard by BuyerContour. Explore Tempo (4217) and Base (8453), see how rewards and agent activity change, and find out how much posting comes from repeat requesters. Filter links are shareable, e.g. `/?net=base&range=90`. No wallet, login, tracking, or third-party scripts.

[Live dashboard](https://svc-mwvp1gd19orapjou.buildwithlocus.com/) · [Public source repository](https://github.com/Buyer-Contour/taskmarket-pulse)

The [weekly demand mix](https://svc-mwvp1gd19orapjou.buildwithlocus.com/?view=participation#participation) compares a selected UTC week with the preceding week and offers a per-chain CSV of the underlying counts. The share links preserve the chain, date range, and selected week where relevant. Trends, participation and activity have their own social preview images; regenerate those PNGs with `python3 scripts/share-cards.py` if the section names change (requires Pillow).

## Run locally

Node.js 22+ and npm are required. No upstream key or Cloudflare account is needed for local development.

```sh
npm ci
npm test
npm run dev
```

With the dev server running, trigger the local refresh and open <http://localhost:8787/>:

```sh
curl --fail 'http://localhost:8787/__scheduled?cron=*/15+*+*+*+*'
```

The refresh runs asynchronously; the page will retry if opened before the first snapshot is ready. The scheduled-event URL is provided by Wrangler dev, not a production route.

## Deploy

Use **Cloudflare Workers Free** with Static Assets, Workflows and Workers KV. This small site uses one cron invocation and one KV write every 15 minutes (96 of 1,000 free KV writes per day), plus KV reads for the snapshot. Check the [Workers](https://developers.cloudflare.com/workers/platform/limits/), [Workflows](https://developers.cloudflare.com/workflows/reference/limits/) and [KV](https://developers.cloudflare.com/kv/platform/limits/) account limits if sharing a free account with other apps.

Once signed in via `npx wrangler login` and with a Workers subdomain enabled, deploy from a fresh clone with one command:

```sh
npm ci && npm run deploy
```

Wrangler provisions the KV namespace automatically and may write its account-specific ID to `wrangler.toml`; leave that generated ID out of the portable public repo. The site gets its own public HTTPS Workers URL. Wait for the first scheduled snapshot and verify both network views, refresh and cache headers, the social card, and the under-three-second phone load on the **hosted URL** before submission. Keep the worker, cron, and KV namespace running for at least 30 days after payout.

The live dashboard runs on Build with Locus. Configure a [Locus project and service for Git deployment](https://buildwithlocus.com/git-deploy.md) with a Dockerfile build, port 8080, the `/healthz` health check, and one always-running instance. With the authenticated deployment remote saved as `locus` (without embedding a credential in its URL), deploy with `git push locus HEAD:main`. The Node server refreshes on startup and every five minutes, keeps the last complete snapshot in memory, and needs no external storage or paid addons.

To run the container locally, use `docker build -t taskmarket-pulse . && docker run --rm -p 8080:8080 taskmarket-pulse`.

## Data and refresh

Every 15 minutes the Worker starts a Workflow. It fetches public Taskmarket API data server-side and publishes one complete JSON snapshot to KV. Each API operation and task-list page is a separate workflow step. The last complete snapshot survives errors; the page flags snapshots older than an hour. The browser only reads same-origin `/api/pulse`, cached for 60 seconds in KV and via HTTP. The methods panel names the inputs:

| Endpoint (under `https://api.taskmarket.dev`) | Use |
| --- | --- |
| `/api/market/stats` | Headline counts |
| `/api/stats/platform-time-series` | Full daily history, UTC; browser slices by selected day range |
| `/api/stats/breakdowns` | Task mode and status totals |
| `/api/stats/activity-heatmap` | 30-day hour-of-week activity |
| `/api/stats/activity-feed` | Recent events, split by the chain ID on each event |
| `/api/tasks` | Paginated task records for twelve full Monday-starting UTC weeks plus the current week |

Weekly poster counts deduplicate by task ID and lowercase requester address within each week. The repeat-requester insight divides tasks from requesters who posted at least twice in the last full week by all task records in that week. The cached JSON contains aggregate counts, not requester addresses. Some statistical endpoints return identical values for both chains; the dashboard identifies these as shared responses rather than implying separate attribution or summing them.

## License

Source code: [MIT](LICENSE). Bundled typefaces are available under their separate SIL Open Font Licenses in `public/`. The bundled Taskmarket mark and its use in the social card are from the [Taskmarket brand kit](https://gist.github.com/ponderingdemocritus/05b7371bb286ab09c9f3f26bc2af9636/af55554d77b0627ff96b52a82a2f3b94b9cab387), for use in Taskmarket bounty entries, and are not relicensed here.

Made for a paid Taskmarket bounty. Not an official Taskmarket product.
