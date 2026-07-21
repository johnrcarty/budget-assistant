FROM node:22-alpine AS base

FROM base AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS builder
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# next build statically evaluates route modules (including the (app) layout's
# db/client.ts import chain) to collect page data, even for fully dynamic
# routes that never query at build time - it just needs DATABASE_URL to be a
# parseable, non-empty value. The real one is supplied at container runtime.
ENV DATABASE_URL="postgres://build:build@localhost:5432/build_placeholder"
RUN pnpm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

# The migrate/scheduler scripts run outside Next's own request path, so
# Next's standalone output tracer doesn't bundle everything they need (e.g.
# drizzle-orm/postgres-js/migrator). Use the full node_modules from the deps
# stage instead of the pruned standalone one - simpler and more robust than
# hand-tracing a second dependency graph, at the cost of a larger image.
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone/server.js ./server.js
COPY --from=builder /app/.next/standalone/.next ./.next
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/src ./src
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/tsconfig.json ./tsconfig.json
RUN chown -R nextjs:nodejs /app

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["node", "server.js"]
