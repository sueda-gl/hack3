# ---- Build stage ----
FROM node:22-slim AS builder

WORKDIR /app/server

# Copy dependency files first (better layer caching)
COPY server/package.json server/package-lock.json ./
RUN npm ci

# Copy server source
COPY server/tsconfig.json ./
COPY server/src/ ./src/
COPY server/public/ ./public/

# Build TypeScript
RUN npm run build

# ---- Production stage ----
FROM node:22-slim

# Install only production system dependencies for better-sqlite3
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy frontend static files
COPY index.html dashboard.html ./
COPY js/ ./js/

# Copy server production files
COPY server/package.json server/package-lock.json ./server/
WORKDIR /app/server
RUN npm ci --omit=dev

# Copy built JS and public assets from builder
COPY --from=builder /app/server/dist/ ./dist/
COPY --from=builder /app/server/public/ ./public/

# Create data directory for SQLite (should be a persistent volume in production)
RUN mkdir -p /data

ENV NODE_ENV=production
ENV DATA_DIR=/data
ENV PORT=3000

EXPOSE 3000

CMD ["node", "dist/index.js"]
