# Build the SonsiSearch Next.js UI and Halcyon proxy in one image. The Node
# service routes Next pages and the Halcyon proxy runtime from the same origin.
FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build
RUN npm prune --omit=dev --no-audit --no-fund

WORKDIR /app/proxy/upstream
COPY proxy/upstream/package.json proxy/upstream/package-lock.json ./
COPY proxy/upstream/patches/ ./patches/
RUN npm ci --omit=dev --no-audit --no-fund
COPY proxy/upstream/ ./

FROM node:22-bookworm-slim
WORKDIR /app
ENV HOST=0.0.0.0 NODE_ENV=production PORT=10000 NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/next.config.ts ./next.config.ts
COPY --from=build /app/proxy/upstream ./proxy/upstream
EXPOSE 10000
CMD ["node", "proxy/upstream/server.js"]
