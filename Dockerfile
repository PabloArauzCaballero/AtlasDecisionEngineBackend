# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
ENV CI=true
COPY package.json yarn.lock ./
RUN --mount=type=cache,target=/usr/local/share/.cache/yarn yarn install --frozen-lockfile

FROM dependencies AS build
COPY tsconfig.json tsconfig.build.json nest-cli.json prisma.config.ts ./
COPY prisma ./prisma
RUN yarn prisma generate
COPY src ./src
RUN yarn build

# One-shot image used by migration/seed Jobs. It intentionally contains the
# Prisma CLI and TypeScript seed dependencies; the API runtime does not.
FROM dependencies AS migrator
WORKDIR /app
ENV NODE_ENV=production
COPY prisma.config.ts ./
COPY prisma ./prisma
COPY scripts ./scripts
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
ENTRYPOINT ["npx", "prisma"]
CMD ["migrate", "deploy"]

# Isolated sidecar that executes untrusted RESULT-node scripts (JS/Python) out of process
# from the API. Deliberately has zero npm dependencies (Node core modules only) and only the
# minimal python3 interpreter, to keep this container's attack surface small. It is meant to
# run network-less, capability-dropped and under the gVisor (runsc) runtime — see
# docker-compose.yml and docs/CONFIGURABLE_OUTPUTS.md.
FROM node:22-bookworm-slim AS script-runner
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 \
  && rm -rf /var/lib/apt/lists/* \
  # A fresh named volume is seeded from whatever already exists at its mount point in the
  # image, ownership included — Docker itself would otherwise create the mount point as
  # root, and the non-root `node` user below could never create the socket in it.
  && mkdir -p /var/run/atlas-runner \
  && chown node:node /var/run/atlas-runner
COPY runner/server.mjs ./server.mjs
USER node
ENTRYPOINT ["node", "server.mjs"]

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates dumb-init \
  && rm -rf /var/lib/apt/lists/*
COPY package.json yarn.lock ./
RUN --mount=type=cache,target=/usr/local/share/.cache/yarn yarn install --frozen-lockfile --production \
  && yarn cache clean
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health/live').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/main.js"]
