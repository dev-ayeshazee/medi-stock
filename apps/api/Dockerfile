# syntax=docker/dockerfile:1

# ── Base ───────────────────────────────────────────────────────────────────
FROM node:20-slim AS base
WORKDIR /app
# Prisma needs OpenSSL at runtime.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

# ── Dependencies (all, incl. dev) ─────────────────────────────────────────
FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts

# ── Build (prisma generate + tsc) ────────────────────────────────────────
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate \
    && npm run build

# ── Runtime ──────────────────────────────────────────────────────────────
FROM base AS runtime
ENV NODE_ENV=production
# node_modules from the build stage carry the generated Prisma client.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY package.json ./
EXPOSE 3000
CMD ["node", "dist/server.js"]
