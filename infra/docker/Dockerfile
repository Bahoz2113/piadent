# VİADENT üretim imajları (Görev 8). Hedefler: api, worker, web, ops (migration/roller/yedek/anahtar döndürme).
#   docker build -f infra/docker/Dockerfile --target api    -t viadent/api:<sürüm> .
#   docker build -f infra/docker/Dockerfile --target worker -t viadent/worker:<sürüm> .
#   docker build -f infra/docker/Dockerfile --target web    -t viadent/web:<sürüm> --build-arg API_INTERNAL_URL=http://api:4000 .
#   docker build -f infra/docker/Dockerfile --target ops    -t viadent/ops:<sürüm> .
# İmajlarda sır yoktur (.dockerignore); tüm sırlar çalışma anında ortamdan/secret manager'dan gelir.
ARG NODE_IMAGE=node:22.22.0-bookworm-slim

# ---------------------------------------------------------------- derleme
FROM ${NODE_IMAGE} AS build
ENV CI=1 PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /src
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
COPY packages/db/package.json packages/db/
RUN pnpm install --frozen-lockfile
COPY . .
ARG API_INTERNAL_URL=http://api:4000
ENV API_INTERNAL_URL=${API_INTERNAL_URL}
RUN pnpm build:server \
 && NEXT_OUTPUT=standalone pnpm --filter @viadent/web exec next build
# Her hedef için yalnız kendi üretim bağımlılıkları (paketler dolaylı bağımlılıkları gömülü taşır; scripts/build-server.mjs)
RUN pnpm --filter @viadent/api deploy --legacy --prod /out/api && cp -r apps/api/dist /out/api/dist \
 && pnpm --filter @viadent/worker deploy --legacy --prod /out/worker && cp -r apps/worker/dist /out/worker/dist \
 && pnpm --filter @viadent/db deploy --legacy --prod /out/db && cp -r packages/db/dist /out/db/dist && cp -r packages/db/migrations /out/db/migrations && cp packages/db/backup-loop.sh /out/db/backup-loop.sh \
 && mkdir -p /out/web && cp -r apps/web/.next/standalone/. /out/web/ \
 && cp -r apps/web/.next/static /out/web/apps/web/.next/static

# ---------------------------------------------------------------- çalışma zamanı tabanı
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends tini ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENTRYPOINT ["/usr/bin/tini", "--"]

FROM runtime AS api
COPY --from=build --chown=node:node /out/api ./
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=3s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||4000)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--enable-source-maps", "dist/main.js"]

FROM runtime AS worker
COPY --from=build --chown=node:node /out/worker ./
USER node
CMD ["node", "--enable-source-maps", "dist/main.js"]

FROM runtime AS web
COPY --from=build --chown=node:node /out/web ./
USER node
ENV PORT=3000 HOSTNAME=0.0.0.0
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/giris').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]

# ops: pg_dump/pg_restore sürümü sunucuyla aynı olmalı (16) → PostgreSQL resmî apt deposu
FROM runtime AS ops
RUN apt-get update && apt-get install -y --no-install-recommends curl gnupg tar \
 && install -d /usr/share/postgresql-common/pgdg \
 && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
 && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
 && apt-get update && apt-get install -y --no-install-recommends postgresql-client-16 \
 && apt-get purge -y curl gnupg && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
COPY --from=build --chown=node:node /out/db ./
USER node
# Varsayılan: migration. Diğerleri: node dist/roles.js | dist/backup-cli.js backup | dist/backup-cli.js restore-verify | dist/rotate-keys.js [--apply]
CMD ["node", "dist/migrate.js"]
