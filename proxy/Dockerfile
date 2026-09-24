# Build the vendored, reviewed Halcyon source as an isolated service.
FROM node:22-bookworm-slim
ENV HOST=0.0.0.0
WORKDIR /opt/halcyon

COPY proxy/upstream/package.json proxy/upstream/package-lock.json ./
COPY proxy/upstream/patches/ ./patches/
RUN npm ci --omit=dev --no-audit --no-fund
COPY proxy/upstream/ ./

ENV PORT=10000
EXPOSE 10000
CMD ["npm", "start"]
