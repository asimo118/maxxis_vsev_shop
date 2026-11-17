# syntax=docker/dockerfile:1.7
#
# Multi-platform (linux/amd64 + linux/arm64): the deps/build stages always run on the BUILDER's native
# platform — the output is platform-independent JavaScript, and better-sqlite3 ships prebuilt binaries for
# every platform inside its package — so only the thin runtime stages are produced per target platform.
#
# Two runtime images from one build:
#   --target api   Node API (SQLite file on the /data volume)
#   --target web   nginx serving the storefront (:80) and admin console (:8081), proxying /api to the API
#
# Base images are build args so a private registry mirror can be used (docker build --build-arg NODE_IMAGE=…).
ARG NODE_IMAGE=node:22-bookworm-slim
ARG NGINX_IMAGE=nginx:1.27-alpine

# ───────────── dependencies (cached until a manifest or the lockfile changes) ─────────────
FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS deps
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    npm_config_package_import_method=copy
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/storefront/package.json apps/storefront/
COPY apps/admin/package.json apps/admin/
COPY packages/shared/package.json packages/shared/
COPY packages/ui/package.json packages/ui/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile

# ───────────── build everything, then cut a production-only API folder ─────────────
FROM deps AS build
COPY . .
# Baked into the storefront bundle at build time.
ARG VITE_CAMPAIGN_SLUG=vs-ev-plus-bmw-ix2-2026q4
ENV VITE_CAMPAIGN_SLUG=${VITE_CAMPAIGN_SLUG}
RUN pnpm build
# Third-party runtime deps only (the @vsev/* workspace code is already bundled into dist/).
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm --filter @vsev/api deploy --prod --legacy /out/api \
 && cp -r apps/api/dist /out/api/dist

# ───────────── API runtime ─────────────
FROM ${NODE_IMAGE} AS api
ARG GIT_SHA=unknown
LABEL org.opencontainers.image.source="https://github.com/asimo118/maxxis_vsev_shop" \
      org.opencontainers.image.title="maxxis-vsev-api" \
      org.opencontainers.image.revision="${GIT_SHA}"
ENV NODE_ENV=production \
    PORT=4000 \
    DATA_DRIVER=sqlite \
    SQLITE_PATH=/data/vsev.db \
    APP_VERSION=${GIT_SHA}
WORKDIR /app
COPY --from=build --chown=node:node /out/api/package.json ./package.json
COPY --from=build --chown=node:node /out/api/node_modules ./node_modules
COPY --from=build --chown=node:node /out/api/dist ./dist
# A fresh named volume copies this directory's ownership, so the non-root user can write to it.
RUN mkdir -p /data/backups && chown -R node:node /data
USER node
VOLUME ["/data"]
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "dist/server.mjs"]

# ───────────── web runtime (static SPAs + reverse proxy) ─────────────
FROM ${NGINX_IMAGE} AS web
ARG GIT_SHA=unknown
LABEL org.opencontainers.image.source="https://github.com/asimo118/maxxis_vsev_shop" \
      org.opencontainers.image.title="maxxis-vsev-web" \
      org.opencontainers.image.revision="${GIT_SHA}"
# nginx renders /etc/nginx/templates/*.template with the container's env vars at startup.
ENV API_UPSTREAM=api:4000 \
    NGINX_ENVSUBST_FILTER=^API_UPSTREAM$
COPY docker/nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /repo/apps/storefront/dist /usr/share/nginx/storefront
COPY --from=build /repo/apps/admin/dist /usr/share/nginx/admin
EXPOSE 80 8081
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=5 \
  CMD wget -qO- http://127.0.0.1/healthz >/dev/null && wget -qO- http://127.0.0.1:8081/healthz >/dev/null || exit 1
