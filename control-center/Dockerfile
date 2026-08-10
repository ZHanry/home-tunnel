ARG NODE_IMAGE=node:22.17.1-alpine
FROM ${NODE_IMAGE} AS build
WORKDIR /app
ARG NPM_REGISTRY=https://registry.npmjs.org
RUN npm config set registry "$NPM_REGISTRY" && npm install --global pnpm@11.16.0
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json ./
COPY src ./src
COPY migrations ./migrations
COPY public ./public
RUN pnpm build && pnpm prune --prod

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -g 10001 -S home-tunnel \
    && adduser -u 10001 -S -D -H -G home-tunnel home-tunnel \
    && mkdir -p /data \
    && chown 10001:10001 /data
COPY --from=build --chown=10001:10001 /app/package.json ./package.json
COPY --from=build --chown=10001:10001 /app/node_modules ./node_modules
COPY --from=build --chown=10001:10001 /app/dist ./dist
COPY --from=build --chown=10001:10001 /app/migrations ./migrations
COPY --from=build --chown=10001:10001 /app/public ./public
USER 10001:10001
EXPOSE 8080
ENTRYPOINT ["node", "dist/server.js"]
