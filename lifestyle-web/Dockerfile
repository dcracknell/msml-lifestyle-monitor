FROM node:20-bullseye-slim AS node-deps

WORKDIR /app/lifestyle-web/server

# Better-SQLite3 compiles native bindings, so install build prereqs only for this stage.
RUN apt-get update \
  && apt-get install -y --no-install-recommends build-essential python3 pkg-config \
  && rm -rf /var/lib/apt/lists/*

COPY server/package*.json ./
COPY server/scripts ./scripts
RUN npm ci --omit=dev

FROM node:20-bullseye-slim AS nut-deps

ENV VIRTUAL_ENV=/opt/nut-venv \
    PATH=/opt/nut-venv/bin:$PATH \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    build-essential \
    ca-certificates \
    libglib2.0-0 \
    libgomp1 \
    python3 \
    python3-venv \
  && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv "$VIRTUAL_ENV"

COPY server/NUT_model/requirements.txt /tmp/nut-requirements.txt
RUN pip install --upgrade pip setuptools wheel \
  && pip install \
    --index-url https://download.pytorch.org/whl/cpu \
    --extra-index-url https://pypi.org/simple \
    -r /tmp/nut-requirements.txt

FROM node:20-bullseye-slim AS runner

ENV NODE_ENV=production \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    VIRTUAL_ENV=/opt/nut-venv \
    PATH=/opt/nut-venv/bin:$PATH

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    libglib2.0-0 \
    libgomp1 \
    python3 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app/lifestyle-web/server

COPY . /app/lifestyle-web
COPY --from=node-deps /app/lifestyle-web/server/node_modules ./node_modules
COPY --from=nut-deps /opt/nut-venv /opt/nut-venv

RUN mkdir -p ../database/storage \
  && chmod +x /app/lifestyle-web/server/docker-entrypoint.sh \
  && chown -R node:node /app/lifestyle-web

USER node
EXPOSE 4000

ENV PORT=4000 \
    HOST=0.0.0.0 \
    NUT_MODEL_PYTHON_BIN=/opt/nut-venv/bin/python \
    NUT_MODEL_SCRIPT=/app/lifestyle-web/server/NUT_model/nut_estimator.py \
    NUT_MODEL_WEIGHTS=/app/lifestyle-web/server/NUT_model/checkpoint/canet_NUT.pth \
    NUT_MODEL_LABELS=/app/lifestyle-web/server/data/FoodSeg103/category_id.txt

ENTRYPOINT ["./docker-entrypoint.sh"]

CMD ["node", "src/server.js"]
