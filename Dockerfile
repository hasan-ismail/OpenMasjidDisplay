# syntax=docker/dockerfile:1
#
# OpenMasjid Display — multi-stage, multi-arch (amd64 + arm64).
# The JS build stages run on the native BUILD platform (fast, arch-independent
# output); only the runtime stage runs as the TARGET arch, where `npm ci` pulls
# the correct @resvg/resvg-js native binary for that architecture.

# ---- Build the web control panel (Vite → static files) --------------------
FROM --platform=$BUILDPLATFORM node:22-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# ---- Compile the server (TypeScript → dist) -------------------------------
FROM --platform=$BUILDPLATFORM node:22-slim AS server
WORKDIR /server
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server/ ./
RUN npm run build

# ---- Runtime (target architecture) ----------------------------------------
FROM node:22-slim AS runtime
ENV NODE_ENV=production

LABEL org.opencontainers.image.title="OpenMasjid Display" \
      org.opencontainers.image.description="Prayer timetables, cameras and HDMI to every screen in your masjid, over RTSP." \
      org.opencontainers.image.source="https://github.com/hasan-ismail/OpenMasjidDisplay" \
      org.opencontainers.image.licenses="AGPL-3.0"

# ffmpeg encodes the timetable video; fonts let resvg draw Latin + Arabic text
# (baked into the image so rendering is identical on every host); tini reaps the
# ffmpeg child processes and forwards signals cleanly.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ffmpeg \
      fonts-dejavu-core \
      fonts-noto-core \
      ca-certificates \
      tini \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
# Production deps only — this resolves the per-arch @resvg/resvg-js prebuilt binary.
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

COPY --from=server /server/dist ./dist
COPY --from=web /web/dist ./public

ENV PORT=8080 \
    DATA_DIR=/data \
    PUBLIC_DIR=/app/public
EXPOSE 8080
VOLUME ["/data"]

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/index.js"]
