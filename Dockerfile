# syntax=docker/dockerfile:1

# The web app (NEXA_PWA) is static files, the same on every platform, so it is built once, natively on
# the build machine, instead of under emulation for each platform of the image.
FROM --platform=$BUILDPLATFORM node:24-alpine AS pwa
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY pwa ./pwa
RUN npm run build:pwa

FROM node:24-alpine

ENV NODE_ENV=production \
    NEXA_HOST=0.0.0.0 \
    NEXA_PORT=8080 \
    NEXA_DATA_DIR=/data

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
# Node runs the TypeScript sources directly (type stripping), so there is no build step.
COPY src ./src
COPY --from=pwa /build/dist/app ./dist/app

# A wrapper on PATH, so `docker compose exec server nexa-server …` reaches the admin CLI. Written here
# rather than copied, so a Windows checkout cannot smuggle CRLF line endings into it.
RUN printf '#!/bin/sh\nexec node /app/src/main.ts "$@"\n' > /usr/local/bin/nexa-server \
 && chmod 755 /usr/local/bin/nexa-server \
 && mkdir -p /data \
 && chown node:node /data

USER node
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- "http://127.0.0.1:${NEXA_PORT}/health" > /dev/null || exit 1
CMD ["nexa-server", "serve"]
