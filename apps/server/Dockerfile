# Build from the repository root:  docker build -f apps/server/Dockerfile -t lagos-living-server .
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN npm ci --workspace @lagos-living/server --no-audit --no-fund
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/server apps/server
RUN npm run build -w @lagos-living/server

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=2567 \
    WORLD_TILE_DIR=/app/world-tiles
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
# Optional peers are recorded in the lockfile (vite, vitest, typescript); omitting them keeps test tooling out of the image.
RUN npm ci --omit=dev --omit=optional --omit=peer --workspace @lagos-living/server --no-audit --no-fund \
    && npm cache clean --force
COPY --from=build /app/apps/server/dist apps/server/dist
COPY apps/server/migrations apps/server/migrations
COPY apps/web/public/assets/world/tiles world-tiles
WORKDIR /app/apps/server
USER node
EXPOSE 2567
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "--enable-source-maps", "dist/index.js"]
