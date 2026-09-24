# Halcyon upstream and SonsiSearch changes

- Upstream: https://github.com/Novaro1/halcyon
- Upstream commit: `8fcee72cc764f90dc6658442185a59cf141ea1bf` (2026-09-23)
- Upstream project license: AGPL-3.0-only; see the retained `LICENSE` file.
- Scramjet 2.x, controller, Wisp, and libcurl dependencies remain upstream's pinned package/lockfile dependencies.

SonsiSearch changes in this fork:

1. `public/index.html` initializes an embed-origin allowlist placeholder. `server.js` substitutes only normalized HTTPS origins from `HALCYON_EMBED_ORIGINS`.
2. `server.js` applies a CSP `frame-ancestors` allowlist and removes `X-Frame-Options` only when at least one valid configured origin exists. With no configured origin, the upstream `SAMEORIGIN` protection stays enabled.
3. `public/app.js` adds a postMessage bridge restricted to the configured parent origin and actual parent window. It handles URL navigation, browser location updates, and the back, forward, and reload controls; navigation accepts only HTTP/HTTPS.
4. The `@mercuryworkshop/wisp-js` dependency receives a maintained patch (in `patches/`) for a 256 KiB WebSocket message cap, TCP connect and idle timeouts, 64 MiB per-direction stream byte caps, and a fix to iterate its stream dictionary correctly when a per-host limit is enabled. Halcyon configures 32 total Wisp streams and 8 per destination host.

The corresponding source for the running service is this complete upstream tree plus these modifications. Publish this tree and its license with every deployed revision to satisfy the applicable AGPL source obligations.
