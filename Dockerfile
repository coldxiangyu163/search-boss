# ---- Stage 1: Install dependencies ----
FROM ubuntu:22.04 AS deps
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
      curl ca-certificates \
 && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---- Stage 2: Compile to V8 bytecode ----
FROM deps AS compiler
RUN npm ci
RUN npm install -g bytenode
COPY src/ src/
COPY scripts/ scripts/
COPY public/ public/

# Compile all .js files under src/ and scripts/ to .jsc bytecode
RUN find src -name '*.js' -exec sh -c 'bytenode -c "$1" && rm "$1"' _ {} \; \
 && find scripts -name '*.js' -exec sh -c 'bytenode -c "$1" && rm "$1"' _ {} \;

# Generate loader stubs: each .js re-exports the sibling .jsc via bytenode
RUN find src -name '*.jsc' -exec sh -c ' \
      stub="${1%.jsc}.js"; \
      base="$(basename "$1")"; \
      echo "\"use strict\"; require(\"bytenode\"); module.exports = require(\"./$base\");" > "$stub" \
    ' _ {} \; \
 && find scripts -name '*.jsc' -exec sh -c ' \
      stub="${1%.jsc}.js"; \
      base="$(basename "$1")"; \
      echo "\"use strict\"; require(\"bytenode\"); module.exports = require(\"./$base\");" > "$stub" \
    ' _ {} \;

# ---- Stage 3: Final production image (Ubuntu + Chrome) ----
FROM ubuntu:22.04 AS production
LABEL maintainer="search-boss-enterprise"
ENV DEBIAN_FRONTEND=noninteractive
WORKDIR /app

# Install Node.js + Chrome/Chromium + Xvfb + fonts
# Google Chrome only available on amd64; ARM64 uses Debian Chromium via deb.debian.org
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      curl ca-certificates gnupg wget xvfb \
      fonts-liberation \
      libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
      libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 libgbm1 \
      libpango-1.0-0 libcairo2 libasound2 libxshmfence1 \
 && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && ARCH=$(dpkg --print-architecture) \
 && if [ "$ARCH" = "amd64" ]; then \
      wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg \
      && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list \
      && apt-get update \
      && apt-get install -y --no-install-recommends google-chrome-stable; \
    else \
      echo "deb http://deb.debian.org/debian bookworm main" > /etc/apt/sources.list.d/debian-chromium.list \
      && wget -q -O - https://ftp-master.debian.org/keys/archive-key-12.asc | gpg --dearmor -o /usr/share/keyrings/debian-archive.gpg \
      && echo "deb [signed-by=/usr/share/keyrings/debian-archive.gpg] http://deb.debian.org/debian bookworm main" > /etc/apt/sources.list.d/debian-chromium.list \
      && apt-get update \
      && apt-get install -y --no-install-recommends chromium; \
    fi \
 && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
COPY --from=compiler /app/src ./src
COPY --from=compiler /app/scripts ./scripts
COPY --from=compiler /app/public ./public
COPY package.json ./

# Install bytenode in production for .jsc loading
RUN npm install bytenode --no-save

RUN mkdir -p resumes tmp /app/.chrome-profile /app/.chrome-downloads

ENV NODE_ENV=production
ENV PORT=3000
ENV CHROME_AUTO_START=true
ENV BOSS_CDP_ENDPOINT=http://127.0.0.1:9222
ENV CHROME_USER_DATA_DIR=/app/.chrome-profile
ENV CHROME_DOWNLOAD_DIR=/app/.chrome-downloads

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://127.0.0.1:3000/health || exit 1

CMD ["node", "src/server.js"]
