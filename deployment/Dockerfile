FROM node:24-bookworm-slim AS build
RUN npm install -g pnpm@12.8.1
WORKDIR /src
COPY . .
RUN pnpm install --frozen-lockfile
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_PUBLIC_API_BASE_URL=http://api:3001/api/v1
ARG RELEASE=local
ENV LOG_RELEASE=$RELEASE NEXT_PUBLIC_MONITORING_RELEASE=$RELEASE
# Secret mount is available only to the release build, never to exported runtime layers.
RUN --mount=type=secret,id=havefolio_monitoring \
    monitoring_release="$LOG_RELEASE"; \
    if [ -f /run/secrets/havefolio_monitoring ]; then set -a; . /run/secrets/havefolio_monitoring; set +a; fi; \
    export LOG_RELEASE="$monitoring_release" NEXT_PUBLIC_MONITORING_RELEASE="$monitoring_release"; \
    pnpm build
RUN pnpm --filter @havefolio/api deploy --prod --legacy /out/api && pnpm --filter @havefolio/worker deploy --prod --legacy /out/worker && pnpm --filter @havefolio/db deploy --prod --legacy /out/migration
RUN cp -r packages/db/scripts /out/migration/scripts

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
USER node
WORKDIR /app

FROM runtime AS api
COPY --from=build --chown=node:node /out/api ./
COPY --chown=node:node deployment/check-dependencies.mjs ./check-dependencies.mjs
EXPOSE 3001
CMD ["sh", "-c", "node check-dependencies.mjs && exec node dist/main.js"]

FROM runtime AS worker
COPY --from=build --chown=node:node /out/worker ./
CMD ["node", "dist/main.js"]

FROM runtime AS migration
COPY --from=build --chown=node:node /out/migration ./
CMD ["node", "scripts/migrate.mjs"]

FROM runtime AS web
ENV HOSTNAME=0.0.0.0 PORT=3000 NEXT_TELEMETRY_DISABLED=1
COPY --from=build --chown=node:node /src/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /src/apps/web/.next/static ./apps/web/.next/static
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
