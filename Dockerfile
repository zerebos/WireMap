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
ENV DATABASE_URL=/data/breaker-box.db PORT=3000
VOLUME /data
EXPOSE 3000
CMD ["bun", "./build/index.js"]
