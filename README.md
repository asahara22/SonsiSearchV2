# SonsiSearch V2

Search and open results in the SonsiSearch browser shell. The frontend is Next.js + TypeScript + Tailwind. Convex is configured for future account-backed features; local browser history and bookmarks currently stay in the device's browser profile. Proxy traffic never passes through Convex.

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

## Proxy service and Render

The proxy is a separate Docker Web Service. Import `render.yaml` as a Render Blueprint, set a strong `HALCYON_PASSWORD`, and after deployment set `NEXT_PUBLIC_PROXY_URL` to its HTTPS origin. Configure the frontend and proxy as separate hosts. Keep WSS enabled through Cloudflare if it is placed in front of Render.

`proxy/Dockerfile` builds the vendored Halcyon source. `proxy/upstream/UPSTREAM.md` records the exact upstream commit and local integration patch. Set `HALCYON_EMBED_ORIGINS` to the exact HTTPS origin(s) of the SonsiSearch frontend, comma separated. This allowlist controls both CSP `frame-ancestors` and the postMessage navigation bridge.

The Browser shell embeds the Halcyon app and sends a narrowly scoped postMessage command to navigate its active Scramjet frame. The parent origin is explicitly allowlisted by the proxy, and the target is validated as HTTP/HTTPS on both sides.

## Browser app and PWA

SonsiSearch owns the visible browser toolbar and navigation. The embedded Halcyon surface hides its own home, tab strip, and toolbar while retaining the Scramjet/Wisp page runtime. Back/forward/reload and the single URL/search field stay in SonsiSearch. History and bookmarks are stored locally in this browser profile.

The app includes a standalone PWA manifest, maskable icons, an offline page, and a small shell service worker. The service worker does not cache search API responses or proxied page content. Install it from the browser's native install or home-screen action; supported browsers may also show an install button in Settings.

## Security and license

- Halcyon has a password gate, destination port allowlist, private/loopback/metadata protections, and per-IP limits. The fork also caps Wisp concurrency and WebSocket message size, sets TCP connect/idle timeouts, and caps each stream at 64 MiB per direction. Large downloads and long-lived idle streams will be cut off by design. The Render blueprint enables the password gate and sets conservative connection/rate limits.
- Browsing history and bookmarks are stored locally in browser storage. Do not record proxied page contents, cookies, or authorization headers; no browsing data is sent to Convex.
- The search route applies a per-process limit of 20 requests per IP per minute and caps provider responses at 1 MB. This in-memory limit is a basic abuse barrier, not a globally consistent quota across serverless instances; set provider-side quotas and edge rate limiting before public launch.
- Only open HTTP/HTTPS result URLs. The proxy service must stay on its own origin so its service worker and site cookies are isolated from the search app.
- Halcyon and the selected Scramjet 2.x dependencies use AGPL-3.0 family licenses. A modified network service must provide users the corresponding source under the applicable license terms. Keep upstream copyright notices and LICENSE files and publish the exact deployed source. Obtain legal review if these obligations are not accepted.

## Commands

```sh
npm run dev
npm run typecheck
npm run lint
npm run build
```
