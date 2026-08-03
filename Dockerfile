# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
ENV CI=true
# Prisma CLI/client generation probes OpenSSL even when runtime queries use the JS adapter.
# Installing it here keeps build and migrator engines aligned with Debian bookworm (OpenSSL 3).
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
COPY package.json yarn.lock ./
# BuildKit may execute the development and production dependency stages concurrently. Separate
# cache ids prevent Yarn 1 from reading a tarball while the other stage is replacing it.
RUN --mount=type=cache,id=atlas-yarn-development,target=/usr/local/share/.cache/yarn yarn install --frozen-lockfile

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
# `prisma db seed` shells out to `ts-node --transpile-only prisma/seed.ts` (see
# prisma.config.ts). Without a tsconfig.json in the image, ts-node falls back to its own
# module-resolution defaults instead of this project's `module: commonjs`, and fails closed
# with "moduleResolution must be set to NodeNext" before a single row is seeded.
COPY tsconfig.json ./
COPY prisma.config.ts ./
COPY prisma ./prisma
COPY scripts ./scripts
# prisma/seed.ts imports src/modules/seeding/seed-runner, which pulls in the catalog data
# plus a handful of common/ helpers (advisory locks, Prisma service, contracts). That
# dependency tree grows with the product, so the whole tree is copied rather than a curated
# subset that silently breaks the next time a seed file gains one more import.
COPY src ./src
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

# Base común de ejecución. El proceso de API y el de trabajos de fondo comparten binario y
# dependencias a propósito: son el MISMO AppModule con distinto arranque, y construir dos
# imágenes distintas permitiría que una se desplegara con código más viejo que la otra.
FROM node:22-bookworm-slim AS runtime-base
WORKDIR /app
ENV NODE_ENV=production
# V8 dimensiona su heap por defecto a partir de la memoria de la MÁQUINA, no del límite del
# contenedor: sin una cota explícita, un contenedor con 768 MiB planifica recolecciones como
# si tuviera la RAM del nodo y lo mata el OOM killer antes de que el GC decida actuar.
# Se declara aquí, no en el orquestador, para que la cota exista incluso en un `docker run`
# sin argumentos; cualquier despliegue puede subirla sobrescribiendo NODE_OPTIONS.
ENV NODE_OPTIONS=--max-old-space-size=512
# `python3` lo necesita el comprobador de sintaxis de «Importar código»: analiza el
# script del analista ANTES de aceptarlo, dentro del proceso de la API. Sin él, subir
# un algoritmo Python fallaba con `spawnSync python ENOENT` — un error de sistema
# donde se esperaba el análisis. Comprobar sintaxis no es ejecutar: el código sigue
# ejecutándose únicamente en el sidecar aislado.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates dumb-init python3 \
  && rm -rf /var/lib/apt/lists/*
COPY package.json yarn.lock ./
# The cache is a BuildKit mount and is not committed to the image layer. `yarn cache clean`
# would try to remove that active mount point and fails with EBUSY on Docker Desktop.
RUN --mount=type=cache,id=atlas-yarn-production,target=/usr/local/share/.cache/yarn yarn install --frozen-lockfile --production
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=build /app/dist ./dist
USER node
ENTRYPOINT ["dumb-init", "--"]

# Proceso de trabajos de fondo: relay del outbox, worker de corridas y purga de retención,
# todos bajo el orquestador central de src/common/jobs. No sirve tráfico de negocio (no hay
# adaptador HTTP), solo el puerto de sondas y de /metrics, de modo que se escala aparte de la
# API y deja de competir por su pool de conexiones.
FROM runtime-base AS worker
ENV WORKER_ROLE=WORKER \
    WORKER_HEALTH_PORT=3001
# El worker no atiende ráfagas de peticiones: su concurrencia la fija el número de trabajos,
# no el tráfico. Un pool más pequeño que el de la API deja conexiones de Postgres libres para
# el plano que sí es sensible a la latencia.
ENV DATABASE_POOL_MAX=5
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.WORKER_HEALTH_PORT||3001)+'/health/live').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist/worker.js"]

# Proceso de API. Mismo binario que el worker; solo cambian el arranque y el rol.
FROM runtime-base AS runtime
ENV PORT=3000
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health/live').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]

# Smoke de runtime en contenedor. Sin dependencias de npm (scripts/smoke.mjs usa solo
# módulos del núcleo y `fetch`), así que no arrastra node_modules: existe para que la
# verificación contra una instancia viva se ejecute DENTRO de la red de Compose, sin
# depender de que la máquina de quien la lanza tenga la versión correcta de Node.
FROM node:22-bookworm-slim AS smoke
WORKDIR /app
ENV NODE_ENV=production
COPY scripts/smoke.mjs ./scripts/smoke.mjs
# La evidencia se escribe en smoke/last-run.json; el volumen de Compose lo monta encima.
RUN mkdir -p /app/smoke && chown -R node:node /app/smoke
USER node
ENTRYPOINT ["node", "scripts/smoke.mjs"]
