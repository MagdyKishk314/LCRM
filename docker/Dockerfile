# syntax=docker/dockerfile:1
FROM node:22-alpine AS base
WORKDIR /app

# ── Dependencies ────────────────────────────────────────────────────────────
# Manifests are copied before source so a code-only change reuses the install layer.
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# ── Build ───────────────────────────────────────────────────────────────────
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# NEXT_PUBLIC_* values are inlined at build time, so they must be present here
# rather than only in the runtime environment.
ARG NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# ── Runtime ─────────────────────────────────────────────────────────────────
# `output: 'standalone'` in next.config.ts emits a self-contained server with only
# the traced dependencies, so no install is needed here. The API is served by this
# same server, at /api/v1.
FROM base AS runtime
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public

# Run unprivileged — a container that is root inside is one escape from root outside.
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/v1/core/auth/providers').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
