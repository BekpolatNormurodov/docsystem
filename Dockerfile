# syntax=docker/dockerfile:1
#
# WEB image — the Next.js request server. Deliberately LEAN: a Debian-slim Node base with NO chromium.
# The external integrations (xat.hippo / cabinet.sud / billing.sud) are all plain REST (fetch), and all
# HTML->PDF rendering (talabnoma / oferta / to'liq paket) is delegated to the `worker` container, which
# is the only place chromium lives (see Dockerfile.worker). Keeping the browser out of web drops ~1.3GB
# and shrinks the attack surface of the internet-facing process.
FROM node:22-bookworm-slim

WORKDIR /app

# Prisma's query engine needs OpenSSL + CA certs at runtime on Debian slim.
# poppler-utils (pdftoppm) + tesseract-ocr power the «Arizalarni skanerlash» OCR (src/lib/palata-ocr.ts),
# which runs inline in this web process. uzb traineddata is best-effort (|| true) — eng always present.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates poppler-utils tesseract-ocr tesseract-ocr-eng wget \
  && (apt-get install -y --no-install-recommends tesseract-ocr-uzb || true) \
  && rm -rf /var/lib/apt/lists/*

# Faster OCR: swap the standard uzb/eng models for tessdata_fast (integer LSTM) — ~2-3x
# faster on printed text with negligible accuracy loss for the printed firma/PINFL/name
# we extract. Best-effort & SAFE: download to a temp file and only overwrite the apt
# model when the download actually succeeded and is a plausible size (a failed/partial
# fetch leaves the working apt model in place — OCR never breaks).
RUN TESSDIR="$(dirname "$(find /usr/share -name eng.traineddata 2>/dev/null | head -1)")" \
  && for L in uzb eng; do \
       wget -qO "/tmp/$L.tf" "https://github.com/tesseract-ocr/tessdata_fast/raw/main/$L.traineddata" \
       && [ "$(stat -c%s "/tmp/$L.tf" 2>/dev/null || echo 0)" -gt 100000 ] \
       && mv "/tmp/$L.tf" "$TESSDIR/$L.traineddata" || true; \
     done \
  && apt-get purge -y wget && apt-get autoremove -y && rm -rf /var/lib/apt/lists/* /tmp/*.tf

# Prisma reads DATABASE_URL even for generate/build; it never connects during build, so a placeholder
# is enough. The real DSN is injected at runtime by compose. Telemetry off for reproducible builds.
ENV DATABASE_URL="mysql://build:build@localhost:3306/build"
ENV NEXT_TELEMETRY_DISABLED=1
# CRITICAL for "lean": stop the `playwright` devDependency's postinstall from downloading chromium
# (~130MB, and unusable on slim anyway). web never launches a browser — the worker image does.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# Dependencies first (cached until package*.json changes). devDependencies are needed to BUILD
# (next, prisma CLI, typescript). The `playwright` npm package is a devDependency too, but with the
# skip flag above it installs WITHOUT any browser binary — web never launches chromium, exactly right.
COPY package.json package-lock.json ./
RUN npm ci --include=dev

COPY prisma ./prisma
RUN npx prisma generate

COPY . .
RUN npm run build

# web only enqueues heavy jobs; the worker executes them. Both app services set this.
ENV JOB_MODE=worker
ENV NODE_ENV=production

EXPOSE 5200
CMD ["npm", "run", "start"]
