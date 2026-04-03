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

# Generate loader stubs: each .js re-exports the .jsc via bytenode
RUN find src -name '*.jsc' -exec sh -c ' \
      stub="${1%.jsc}.js"; \
      echo "\"use strict\"; require(\"bytenode\"); module.exports = require(\"$1\");" > "$stub" \
    ' _ {} \; \
 && find scripts -name '*.jsc' -exec sh -c ' \
      stub="${1%.jsc}.js"; \
      echo "\"use strict\"; require(\"bytenode\"); module.exports = require(\"$1\");" > "$stub" \
    ' _ {} \;

# ---- Stage 3: Final production image ----
FROM node:20-slim AS production
LABEL maintainer="search-boss-enterprise"
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
COPY --from=compiler /app/src ./src
COPY --from=compiler /app/scripts ./scripts
COPY --from=compiler /app/public ./public
COPY package.json ./

# Install bytenode in production for .jsc loading
RUN npm install bytenode --no-save

RUN mkdir -p resumes tmp

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://127.0.0.1:3000/health || exit 1

USER node

CMD ["node", "src/server.js"]
