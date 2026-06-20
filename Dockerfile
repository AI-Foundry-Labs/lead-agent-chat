FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS dev
ENV NODE_ENV=development
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

COPY --from=deps /app/node_modules ./node_modules

RUN mkdir -p /migrate
COPY --from=deps /app/node_modules /migrate/node_modules
COPY package.json drizzle.config.ts tsconfig.json /migrate/
COPY lib /migrate/lib
COPY scripts /migrate/scripts
COPY drizzle /migrate/drizzle

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node_modules/.bin/next", "dev"]

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

RUN mkdir -p /migrate
COPY --from=deps /app/node_modules /migrate/node_modules
COPY --from=builder /app/package.json /migrate/package.json
COPY --from=builder /app/drizzle.config.ts /migrate/drizzle.config.ts
COPY --from=builder /app/tsconfig.json /migrate/tsconfig.json
COPY --from=builder /app/lib /migrate/lib
COPY --from=builder /app/scripts /migrate/scripts
COPY --from=builder /app/drizzle /migrate/drizzle

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
    && chown -R nextjs:nodejs /app /migrate

USER nextjs
EXPOSE 3000

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "server.js"]
