# ---- Stage 1: Install dependencies ----
FROM node:20-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---- Stage 2: Compile to V8 bytecode ----
FROM node:20-slim AS compiler
WORKDIR /app
COPY package.json package-lock.json ./
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

# ---- Stage 3: Final production image (with Chrome) ----
FROM node:20-slim AS production
LABEL maintainer="search-boss-enterprise"
WORKDIR /app

# Install Chrome + dependencies + Xvfb for headless display
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      curl wget gnupg ca-certificates xvfb \
      fonts-liberation fonts-noto-cjk \
      libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
      libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 libgbm1 \
      libpango-1.0-0 libcairo2 libasound2 libxshmfence1 \
 && wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg \
 && echo "deb [arch=amd64,arm64 signed-by=/usr/share/keyrings/google-chrome.gpg] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends google-chrome-stable \
 || (echo "Chrome apt install failed, trying direct deb..." \
     && wget -q https://dl.google.com/linux/direct/google-chrome-stable_current_$(dpkg --print-architecture).deb -O /tmp/chrome.deb \
     && dpkg -i /tmp/chrome.deb || apt-get install -yf \
     && rm -f /tmp/chrome.deb) \
 && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
COPY --from=compiler /app/src ./src
COPY --from=compiler /app/scripts ./scripts
COPY --from=compiler /app/public ./public
COPY package.json ./

# Install bytenode in production for .jsc loading
RUN npm install bytenode --no-save

RUN mkdir -p resumes tmp /app/.chrome-profile /app/.chrome-downloads \
 && chown -R node:node /app

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
