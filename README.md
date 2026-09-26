# SonsiSearch V2

SonsiSearch combines web search and a Scramjet-powered browser in one Render Docker Web Service. The service serves the search UI, search API, and Halcyon proxy runtime from the same origin. The Next.js frontend remains in the repository for development and future use, but is not required for this single-service deployment. Convex is configured for future account-backed features; local browser history and bookmarks currently stay in the device's browser profile.

## Local setup

1. Install Node.js 20.9 or later and npm.
2. Copy `.env.example` to `.env.local` and configure the search provider and proxy origin.
3. Run `npm install`, then `npm run dev`.
4. Open `http://localhost:3000`.

### Search provider interface

Set `SEARCH_API_URL` to an HTTPS endpoint that accepts a `q` query parameter and returns JSON in this shape:

```json
{
  "results": [
    { "title": "Example", "url": "https://example.com/", "description": "Description" }
  ]
}
```

`SEARCH_API_KEY` is sent server-side as a Bearer token and is never exposed to the browser. The adapter also accepts `items` or a top-level array, `link` in place of `url`, and `snippet` in place of `description`.

## Convex

Create a Convex deployment and set `NEXT_PUBLIC_CONVEX_URL`. The provider activates only when that environment variable is set. The schema lays out future history, bookmarks, and settings tables, but no user activity is persisted by the current MVP. Configure authentication and ownership before adding writes.

## One-service Render deployment

Deploy `proxy/Dockerfile` as a Docker Web Service (or import `render.yaml` as a Blueprint). Set `HALCYON_PASSWORD`, `SEARCH_API_URL`, and `SEARCH_API_KEY` in that Render service. `SEARCH_API_URL` must be an HTTPS search provider endpoint accepting `q`; the key stays server-side. With the search settings missing, the browser still works and the search UI reports that search is not configured. No second Render service, Vercel frontend, `NEXT_PUBLIC_PROXY_URL`, or `HALCYON_EMBED_ORIGINS` is required for this deployment. Keep WSS enabled through Cloudflare if it is placed in front of Render.

`proxy/Dockerfile` builds the vendored Halcyon source. `proxy/upstream/UPSTREAM.md` records the exact upstream commit and local integration patch. The Halcyon shell now serves the SonsiSearch home, search results, browser, and same-origin search API together.

If a proxied page stays on the loading screen, select **Connection diagnostics** in the left dock or tap **接続を診断** on the loading indicator. The report checks HTTPS reachability, Wisp WebSocket access, and runtime startup stages. It omits the target page URL and passphrase. If a school or managed-device filter blocks WebSockets or Service Workers, the report identifies the stage that did not complete; allowlist the SonsiSearch origin and permit `wss://<service-host>/wisp/` when policy allows.

## Browser app and PWA

The unified Halcyon app provides the SonsiSearch home, search, and browser UI. Search results open in the same Scramjet browser service; the original-site action opens a normal external tab. History and bookmarks are stored locally in this browser profile.

The app includes a standalone PWA manifest, maskable icons, an offline page, and a small shell service worker. The service worker does not cache search API responses or proxied page content. Install it from the browser's native install or home-screen action; supported browsers may also show an install button in Settings.

## Security and license

- Halcyon has a password gate, destination port allowlist, private/loopback/metadata protections, and per-IP limits. The fork also caps Wisp concurrency and WebSocket message size, sets TCP connect/idle timeouts, and caps each stream at 64 MiB per direction. Large downloads and long-lived idle streams will be cut off by design. The Render blueprint enables the password gate and sets conservative connection/rate limits.
- Browsing history and bookmarks are stored locally in browser storage. Do not record proxied page contents, cookies, or authorization headers; no browsing data is sent to Convex.
- The search route applies a per-process limit of 20 requests per IP per minute and caps provider responses at 1 MB. This in-memory limit is a basic abuse barrier, not a globally consistent quota across serverless instances; set provider-side quotas and edge rate limiting before public launch.
- Only open HTTP/HTTPS result URLs. Proxy cookies and its service worker stay on this service's origin and are protected by the passphrase gate.
- Halcyon and the selected Scramjet 2.x dependencies use AGPL-3.0 family licenses. A modified network service must provide users the corresponding source under the applicable license terms. Keep upstream copyright notices and LICENSE files and publish the exact deployed source. Obtain legal review if these obligations are not accepted.

## Commands

```sh
npm run dev
npm run typecheck
npm run lint
npm run build
```
