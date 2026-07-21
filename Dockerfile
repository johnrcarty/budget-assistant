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
# Ownership is set on the COPY itself: a separate `RUN chown -R` would
# re-copy every file (node_modules especially) into a new uncacheable layer,
# which cost ~3.5 minutes per rebuild and ballooned the image.
COPY --chown=nextjs:nodejs --from=deps /app/node_modules ./node_modules
COPY --chown=nextjs:nodejs --from=builder /app/public ./public
COPY --chown=nextjs:nodejs --from=builder /app/.next/standalone/server.js ./server.js
COPY --chown=nextjs:nodejs --from=builder /app/.next/standalone/.next ./.next
COPY --chown=nextjs:nodejs --from=builder /app/.next/static ./.next/static
COPY --chown=nextjs:nodejs --from=builder /app/drizzle ./drizzle
COPY --chown=nextjs:nodejs --from=builder /app/src ./src
COPY --chown=nextjs:nodejs --from=builder /app/scripts ./scripts
COPY --chown=nextjs:nodejs --from=builder /app/tsconfig.json ./tsconfig.json

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["node", "server.js"]
