# Contivo render worker: Node 22 + Chromium + FFmpeg + Python (music synth).
FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium ffmpeg python3 python3-numpy python3-scipy \
      fonts-noto-core ca-certificates unzip \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    HYPERFRAMES_BROWSER_PATH=/usr/bin/chromium \
    HYPERFRAMES_NO_TELEMETRY=1 \
    HYPERFRAMES_NO_UPDATE_CHECK=1 \
    HYPERFRAMES_SKIP_SKILLS=1

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY src ./src
COPY specs ./specs
COPY music ./music

RUN chown -R node:node /app
USER node
CMD ["node", "src/index.js"]
