FROM node:20-bullseye-slim AS deps

WORKDIR /app/lifestyle-web/server

# Better-SQLite3 compiles native bindings, so install build prereqs only for this stage.
RUN apt-get update \
  && apt-get install -y --no-install-recommends build-essential python3 pkg-config \
  && rm -rf /var/lib/apt/lists/*

COPY server/package*.json ./
RUN npm ci --omit=dev

FROM node:20-bullseye-slim AS runner

ENV NODE_ENV=production
WORKDIR /app/lifestyle-web/server

COPY . /app/lifestyle-web
COPY --from=deps /app/lifestyle-web/server/node_modules ./node_modules

RUN mkdir -p ../database/storage \
  && chown -R node:node /app/lifestyle-web

USER node
EXPOSE 4000

ENV PORT=4000 \
    HOST=0.0.0.0

CMD ["node", "src/server.js"]
