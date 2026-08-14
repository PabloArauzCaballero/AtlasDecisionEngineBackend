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
# `scripts/` entra en la etapa de compilación porque `yarn build` ya no es sólo `nest build`:
# encadena `copy-pdf-templates.mjs`, que deja las plantillas del generador documental junto al
# código compilado. Sin esta línea el guion no existe dentro de la imagen y la construcción
# falla con «Cannot find module» — que es el fallo BUENO. El malo era el anterior: confiar en la
# copia de recursos del CLI de Nest, que es asíncrona, gana la carrera en local y la pierde
# dentro del contenedor, y produce una imagen que arranca, responde `ok` en la sonda de salud y
# devuelve 500 en la primera petición.
COPY scripts ./scripts
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

# Ejecutor de la batería de pruebas. Es la ÚNICA etapa que conserva las dependencias de
# desarrollo (jest, ts-jest, supertest, fast-check, faker) junto con `test/` y `prisma/`, y
# no la hereda ninguna imagen de runtime: lo que se despliega nunca contiene el arnés de
# pruebas. Existe para que `compose.test.yml` corra integración y e2e contra Postgres y Redis
# REALES dentro de la red de Compose, en vez de depender de que la máquina de quien lanza las
# pruebas tenga la versión correcta de Node y una base a mano.
FROM build AS tester
WORKDIR /app
ENV NODE_ENV=test
# `python3` lo invoca el comprobador de sintaxis de «Importar código», que varias pruebas
# ejercitan; sin él fallarían con `spawnSync python ENOENT` y no por lo que comprueban.
# Las fuentes las necesita `sharp` para dibujar los escenarios del worker de
# identidad; sin ellas la tarjeta sale en blanco (ver la nota de `runtime-base`).
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 fonts-dejavu-core \
  && rm -rf /var/lib/apt/lists/*
COPY jest.config.js ./
COPY test ./test
COPY scripts ./scripts
# Recursos que la batería lee del disco por ruta, no como módulos. Se descubrieron ejecutando
# la suite dentro de la imagen: sin ellos fallan seis suites por `ENOENT`, y el error no dice
# «falta un fichero en la imagen» sino que parece un fallo del motor.
#
#   runner/            el sidecar real; las pruebas de concurrencia y de escape lo ARRANCAN
#   smoke/             `demo-applicant.json`, el contrato del solicitante sembrado
#   docs/script-prueba.{js,py}  los guiones de ejemplo que ejercitan el runner de scripts
COPY runner ./runner
COPY smoke ./smoke
COPY docs/script-prueba.js docs/script-prueba.py ./docs/
# `/app` pertenece a root porque las etapas anteriores corren como root, y las pruebas se
# ejecutan como `node`. En vez de un `chown -R /app` —que copiaría el árbol entero, cerca de
# un giga, a una capa nueva— se apunta a `/tmp` todo lo que necesita escribir: la caché de
# Yarn y el directorio de cobertura. Jest ya usa `os.tmpdir()` para su propia caché.
ENV YARN_CACHE_FOLDER=/tmp/.yarn-cache \
    JEST_JUNIT_OUTPUT_DIR=/tmp
RUN mkdir -p /app/coverage && chown node:node /app/coverage
USER node
CMD ["yarn", "test"]

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
#
# `fonts-dejavu-core` (~1 MB) no es decoración: `sharp` compone el SVG de los
# escenarios del worker de identidad a través de fontconfig, y en una imagen SIN
# ninguna fuente el texto se dibuja vacío. La tarjeta sale en blanco, el lector
# no encuentra una letra y el escenario falla con «no se pudo leer el
# documento» — un fallo que parece del OCR y en realidad es una fuente que falta.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates dumb-init python3 fonts-dejavu-core \
  && rm -rf /var/lib/apt/lists/*
COPY package.json yarn.lock ./
# The cache is a BuildKit mount and is not committed to the image layer. `yarn cache clean`
# would try to remove that active mount point and fails with EBUSY on Docker Desktop.
#
# La poda va en el MISMO `RUN` que la instalación, no en una capa posterior: un `rm` en otra
# instrucción deja los ficheros vivos en la capa anterior y la imagen no adelgaza ni un byte.
#
# Qué se poda y por qué ninguno se carga en tiempo de ejecución:
#
#   prisma (51 MiB)      El CLI. Migrar es trabajo de la etapa `migrator`, que es otra imagen.
#   typescript (23 MiB)  El código ya está compilado a `dist/`.
#                        Los dos llegan aquí como peers opcionales que `@prisma/client`
#                        declara y que el árbol hoisteado de Yarn 1 arrastra.
#   @prisma/engines      36 MiB de BINARIOS: `libquery_engine` (17 MiB) no se usa porque el
#     (+ fetch-engine)   esquema declara `engineType = "client"` y las consultas salen por
#                        `@prisma/adapter-pg` sobre `pg`; `schema-engine` (19 MiB) solo sirve
#                        para migrar. `fetch-engine` es quien los descarga en el postinstall.
#
# Lo de los motores está COMPROBADO, no deducido: con los dos paquetes borrados de esta misma
# imagen, el cliente ejecutó una consulta real contra PostgreSQL. Se conservan
# `@prisma/client`, `adapter-pg`, `driver-adapter-utils`, `debug`, `get-platform`, `config` y
# `engines-version`, que sí están en el camino de ejecución.
#
# Todo va en una sola orden y sin comentarios intercalados entre las continuaciones de línea,
# que es una forma sutil de romper el análisis del Dockerfile.
RUN --mount=type=cache,id=atlas-yarn-production,target=/usr/local/share/.cache/yarn \
    yarn install --frozen-lockfile --production \
    && rm -rf node_modules/prisma node_modules/typescript \
              node_modules/.bin/prisma node_modules/.bin/tsc node_modules/.bin/tsserver \
              node_modules/@prisma/engines node_modules/@prisma/fetch-engine
# Solo el cliente GENERADO. Antes se copiaba `@prisma` ENTERO desde la etapa de build, que es
# por donde entraban los binarios del motor podados arriba. `@prisma/client` no declara
# ninguna dependencia, así que la instalación de producción ya deja su copia correcta y aquí
# basta con el resultado de `prisma generate`.
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/dist ./dist
COPY docker/healthcheck.mjs ./docker/healthcheck.mjs
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
# La sonda resuelve el puerto por `WORKER_HEALTH_PORT`, la MISMA variable que abre `worker.ts`:
# si un despliegue la mueve, la sonda la sigue. El plazo de 5s da ~6x sobre la mediana medida
# (844ms) y ~3.5x sobre el peor caso (1461ms) — ver docker/healthcheck.mjs.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD ["node", "docker/healthcheck.mjs"]
CMD ["node", "dist/worker.js"]

# Proceso de API. Mismo binario que el worker; solo cambian el arranque y el rol.
FROM runtime-base AS runtime
ENV PORT=3000
EXPOSE 3000
# `start-period` de 40s: el arranque abre el pool de Postgres, conecta Redis y monta el
# AppModule completo. Con 20s, un primer sondeo en una máquina cargada contaba fallos contra
# `--retries` durante un arranque perfectamente normal.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD ["node", "docker/healthcheck.mjs"]
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

# ─────────────────────────────────────────────────────────────────────────────
# Generador documental (src/pdf-worker). Imagen SEPARADA de `runtime`.
#
# Chromium y sus dependencias del sistema pesan ~450 MiB y rasterizar consume
# memoria en ráfagas. Meterlos en la imagen de la API significaría engordarla un
# 60 % para todas las réplicas —incluidas las que nunca imprimen un PDF— y hacer
# que un informe de doscientas páginas compita por memoria con el camino que
# atiende decisiones en línea. Con dos imágenes, el generador se escala, se
# limita y se cae por su cuenta.
#
# Comparte `build`, así que el binario es EL MISMO que el de la API: no puede
# desplegarse con código más viejo que el resto del motor.
# ─────────────────────────────────────────────────────────────────────────────
# Base OFICIAL de Playwright, no `node:slim` + descarga del navegador.
#
# Se intentó lo otro primero y se abandonó por un motivo medido, no estético: instalar el
# navegador desde `cdn.playwright.dev` durante la construcción ata la imagen a un servicio
# externo justo en el paso más largo. En esta máquina falló seis veces seguidas —cinco
# reintentos con retroceso incluidos— mientras `apt` y el registro de npm iban perfectos.
#
# Lo que se gana además del determinismo: la etiqueta CLAVA la pareja navegador/biblioteca.
# `v1.61.1-noble` trae exactamente `chromium-1228`, que es el que pide el `playwright@1.61.1`
# del `package.json`. Con la descarga suelta, subir la dependencia sin reconstruir la imagen
# —o al revés— produce un desajuste que sólo se ve al renderizar.
#
# Coste MEDIDO, no estimado: la base son 3,45 GB y la imagen final 4,39 GB, frente a los
# ~700 MB de la ruta `node:slim` + descarga. Incluye Firefox y WebKit, que este worker no
# abre nunca; **borrarlos no adelgaza la imagen** —están en la capa de la base y un `rm` en
# una capa posterior sólo escribe una anulación—, así que no se borran: sería una capa más
# a cambio de cero bytes. Quien necesite una imagen pequeña tiene que reconstruir la base,
# no podarla.
#
# **Al subir `playwright` en `package.json` hay que subir esta etiqueta a la vez**: la
# comprobación del final falla si se desincronizan.
FROM mcr.microsoft.com/playwright:v1.61.1-noble AS pdf-worker
WORKDIR /app
ENV NODE_ENV=production
ENV NODE_OPTIONS=--max-old-space-size=768
# La base ya la define y deja los navegadores legibles para todos, así que el proceso sin
# privilegios los encuentra. Se repite aquí porque es una garantía del runtime y no un
# detalle de la base: si se cambia de imagen y se pierde, el fallo es «Executable doesn't
# exist» en la primera petición, no al construir.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
COPY package.json yarn.lock ./
# `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD`: el postinstall de `playwright` volvería a bajarse el
# navegador que la base ya trae — 177 MiB y varios minutos para nada.
RUN --mount=type=cache,id=atlas-yarn-pdf,target=/usr/local/share/.cache/yarn \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 yarn install --frozen-lockfile --production \
    && rm -rf node_modules/prisma node_modules/typescript \
              node_modules/.bin/prisma node_modules/.bin/tsc node_modules/.bin/tsserver \
              node_modules/@prisma/engines node_modules/@prisma/fetch-engine
# `dumb-init` es lo único que le falta a la base. Sin un init que reparta las señales,
# `SIGTERM` no llega a Node, el apagado ordenado no corre y cada reinicio deja un Chromium
# huérfano. Las fuentes SÍ vienen (12 familias Liberation y DejaVu), que es la pila de
# respaldo con la que el documento sale igual en desarrollo, CI y producción mientras no se
# embeba una propia (src/pdf-worker/templates/shared/fonts/README.md).
#
# La comprobación final resuelve la ruta del ejecutable con el MISMO `playwright` que usará
# el worker: si alguien sube la dependencia y olvida la etiqueta de la base, esto falla al
# construir en vez de en la primera petición.
RUN apt-get update \
  && apt-get install -y --no-install-recommends dumb-init \
  && rm -rf /var/lib/apt/lists/* \
  && node -e "const {chromium}=require('playwright');const p=chromium.executablePath();require('node:fs').accessSync(p);console.log('Chromium verificado: '+p)"
COPY --from=build /app/dist ./dist
COPY docker/healthcheck.mjs ./docker/healthcheck.mjs
# `/dev/shm` son 64 MiB por omisión en Docker y Chromium los agota rasterizando
# una página grande. El adaptador ya pasa `--disable-dev-shm-usage`, así que usa
# `/tmp`; este directorio debe existir y ser escribible por el usuario del proceso.
#
# `pwuser` lo trae la base de Playwright; el usuario `node` de las imágenes oficiales de
# Node no existe aquí.
RUN mkdir -p /app/var/pdf-worker /tmp/pdf && chown -R pwuser:pwuser /app/var /tmp/pdf
USER pwuser
ENV PORT=3100 \
    PDF_WORKER_PORT=3100 \
    PDF_SWAGGER_ENABLED=false
EXPOSE 3100
# `start-period` amplio: el primer arranque monta el módulo y NO lanza Chromium
# —el pool es perezoso—, pero la primera sonda de `/pdf/health` sí lo lanza.
HEALTHCHECK --interval=30s --timeout=10s --start-period=45s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PDF_WORKER_PORT||3100)+'/pdf/health').then(r=>r.json()).then(b=>process.exit(b.status==='ok'?0:1)).catch(()=>process.exit(1))"]
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/pdf-worker.js"]
