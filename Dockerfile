FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM oven/bun:1
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --production --frozen-lockfile --ignore-scripts
COPY --from=build /app/build ./build
COPY --from=build /app/drizzle ./drizzle
# Floor plan uploads can be a few MB; the adapter's default request limit is 512K.
ENV DATABASE_URL=/data/breaker-box.db PORT=3000 BODY_SIZE_LIMIT=20M
VOLUME /data
EXPOSE 3000
CMD ["bun", "./build/index.js"]
