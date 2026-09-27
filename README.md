# SonsiSearch V2

SonsiSearch V2 serves its Next.js search and browser interface together with the Halcyon/Scramjet proxy in one Render Docker Web Service. The Next.js app is the service homepage; Halcyon is mounted at `/proxy` as the browser engine. Yahoo Search is the default search engine; DuckDuckGo, Startpage, Brave Search, and Yahoo can be selected in Settings. History, bookmarks, theme, and search engine preference stay in the browser's local storage.

The integrated Render service is available at [sonsisearch-v2.onrender.com](https://sonsisearch-v2.onrender.com).

Search results open through the integrated same-domain reader at `/proxy/https://…`. It resolves and pins public DNS addresses, rejects private/reserved destinations and unsafe redirects, strips user credentials, rewrites common HTML/CSS URLs, and uses a bounded in-memory cache. Halcyon's existing `/proxy` shell remains available.

## Local setup

1. Install Node.js 22 or later.
2. Run `npm install` and `npm run dev` to work on the Next.js interface.
3. For the integrated app and proxy, install the dependencies in `proxy/upstream` and run `npm start` from that directory with `HOST=127.0.0.1` and `PORT=8090`.
4. Open `http://localhost:8090` for the integrated service, or `http://localhost:3000` for UI-only development. Set `NEXT_PUBLIC_PROXY_URL` in `.env.local` when the UI and proxy use different origins.

## Render deployment

Create a Docker Web Service from `render.yaml` or connect `proxy/Dockerfile` with the repository root as its build context. The image builds Next.js and Halcyon together and starts the integrated Node server. Set `HALCYON_PASSWORD` before exposing the service publicly. The service binds to Render's `PORT`; the main SonsiSearch UI is at `/` and the embedded proxy shell is at `/proxy`.

Wisp needs WebSocket upgrades enabled through any fronting CDN. Users on networks that block Wisp can choose Bare in the proxy's settings; Bare requires `HALCYON_PASSWORD` and makes target TLS visible to the proxy service. The Halcyon diagnostic panel reports connection stages.

## Convex

Convex is not required for the MVP. The current UI stores browser history, bookmarks, theme, and search engine preference locally. Add authentication and ownership checks before syncing browsing data to a backend.

## Security and license

- Halcyon applies a password gate, destination-port allowlist, private/loopback/metadata protections, request limits, and response caps. Keep `HALCYON_PASSWORD` configured for public deployment.
- The same-domain reader accepts GET/HEAD only, omits upstream cookies and authorization, rejects private/reserved DNS results (including mixed public/private answers), checks redirect destinations, and caps response size, rate, and concurrent requests. Its in-memory cache stores only small public HTML/CSS/script/image/font responses without `Set-Cookie` or private/no-store directives; entries expire after 1 minute for HTML, 10 minutes for CSS, and 1 hour for static assets. It is instance-local and clears on restart.
- Halcyon's ad/tracker blocklist and allowlist remain scoped to Scramjet/Wisp traffic. The same-domain reader applies its own SSRF and abuse checks but does not yet follow the user's Halcyon ad-block preference.
- Proxied documents receive a restrictive CSP sandbox with an opaque origin; scripts may render the page but cannot connect through fetch/XHR/WebSocket, submit forms, open popups, or navigate the top-level page. Common links, media, stylesheet, and inline CSS URLs are rewritten. JavaScript-generated URLs, service workers, many CSP-dependent apps, WebSockets, login/forms, downloads, streaming media, and pages requiring unsupported encodings may not work. Responses larger than 8 MiB are stopped by default (`SONSI_PROXY_MAX_RESPONSE_BYTES` can be lowered or raised deliberately).
- Wisp keeps target-site TLS in the browser. Bare terminates target TLS on the proxy service.
- Halcyon and the selected Scramjet 2.x dependencies use AGPL-3.0 family licenses. The optional Bare Server package is GPL-3.0 and Bare transport is LGPL-3.0. A modified network service must provide users the corresponding source under the applicable license terms. Keep upstream copyright notices and license files and publish the deployed source.

## Commands

```sh
npm run dev
npm run typecheck
npm run lint
npm run build
```
