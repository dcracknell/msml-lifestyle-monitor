FROM node:20-bullseye-slim AS base

# Buildx/QEMU multi-arch builds occasionally see transient Debian mirror resets.
RUN printf '%s\n' \
  'Acquire::Retries "5";' \
  'Acquire::http::Timeout "30";' \
  'Acquire::https::Timeout "30";' \
  > /etc/apt/apt.conf.d/80-retry-downloads

FROM base AS node-deps

WORKDIR /app/lifestyle-web/server

COPY server/package*.json ./
COPY server/scripts ./scripts
RUN npm ci --omit=dev

FROM base AS python-runtime

RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends --fix-missing \
    ca-certificates \
    libglib2.0-0 \
    libgomp1 \
    python3 \
  && rm -rf /var/lib/apt/lists/*

FROM python-runtime AS ppg-deps

ENV VIRTUAL_ENV=/opt/ppg-venv \
    PATH=/opt/ppg-venv/bin:$PATH \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    MICROMAMBA_HOME=/opt/micromamba \
    MICROMAMBA_BIN=/opt/micromamba/bin/micromamba \
    MICROMAMBA_ROOT_PREFIX=/opt/mamba-root

RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends --fix-missing \
    bzip2 \
    curl \
  && rm -rf /var/lib/apt/lists/*

RUN arch="$(uname -m)" \
  && case "$arch" in \
    x86_64|amd64) platform='linux-64' ;; \
    aarch64|arm64) platform='linux-aarch64' ;; \
    *) echo "Unsupported architecture for managed PPG runtime: $arch" >&2; exit 1 ;; \
  esac \
  && tmp_dir="$(mktemp -d)" \
  && mkdir -p "$(dirname "$MICROMAMBA_BIN")" \
  && curl -Ls "https://micro.mamba.pm/api/micromamba/${platform}/latest" \
    | tar -xvj -C "$tmp_dir" bin/micromamba \
  && mv "$tmp_dir/bin/micromamba" "$MICROMAMBA_BIN" \
  && chmod +x "$MICROMAMBA_BIN" \
  && rm -rf "$tmp_dir"

RUN "$MICROMAMBA_BIN" create -y -r "$MICROMAMBA_ROOT_PREFIX" -p "$VIRTUAL_ENV" -c conda-forge \
    python=3.12 \
    pip \
    setuptools \
    wheel \
    'numpy<2.0' \
    'pandas<2.2' \
    scipy \
    scikit-learn \
    catboost \
    pyyaml \
    'sqlalchemy>=2.0' \
    psycopg2 \
    pymysql \
    cryptography \
    'pytest>=7.0'

RUN pip install --upgrade pip setuptools wheel \
  && pip install --retries 10 --timeout 120 EMD-signal \
  && pip install --no-deps pyPPG==1.0.73 dotmap==1.3.30 \
  && python - <<'PY'
from importlib.util import find_spec
from pathlib import Path

spec = find_spec("pyPPG.fiducials")
if spec is None or spec.origin is None:
    raise SystemExit("pyPPG.fiducials could not be located for patching.")

path = Path(spec.origin)
text = path.read_text(encoding="utf-8")
text = text.replace(
    "            ppg_fp[keys[n]][0:len(temp_val)]=temp_val\n",
    "            if len(temp_val):\n                ppg_fp.loc[0:len(temp_val) - 1, keys[n]] = temp_val\n",
)
text = text.replace(
    "                fiducials[key][0:len(temp_val)]=temp_val\n",
    "                if len(temp_val):\n                    fiducials.loc[0:len(temp_val) - 1, key] = temp_val\n",
)
path.write_text(text, encoding="utf-8")
PY

FROM python-runtime AS nut-deps

ENV VIRTUAL_ENV=/opt/nut-venv \
    PATH=/opt/nut-venv/bin:$PATH \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends --fix-missing \
    build-essential \
    python3-venv \
  && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv "$VIRTUAL_ENV"

COPY server/NUT_model/requirements.txt /tmp/nut-requirements.txt
RUN pip install --upgrade pip setuptools wheel \
  && pip install \
    --index-url https://download.pytorch.org/whl/cpu \
    --extra-index-url https://pypi.org/simple \
    -r /tmp/nut-requirements.txt

FROM python-runtime AS runner

ENV NODE_ENV=production \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    VIRTUAL_ENV=/opt/nut-venv \
    PATH=/opt/nut-venv/bin:$PATH

WORKDIR /app/lifestyle-web/server

COPY --chown=node:node . /app/lifestyle-web
COPY --from=node-deps --chown=node:node /app/lifestyle-web/server/node_modules ./node_modules
COPY --from=nut-deps /opt/nut-venv /opt/nut-venv
COPY --from=ppg-deps /opt/ppg-venv /opt/ppg-venv

RUN install -d -o node -g node ../database/storage \
  && ln -s /opt/ppg-venv ./ppg_glucose/.venv \
  && chmod +x /app/lifestyle-web/server/docker-entrypoint.sh

USER node
EXPOSE 4000

ENV PORT=4000 \
    HOST=0.0.0.0 \
    NUT_MODEL_PYTHON_BIN=/opt/nut-venv/bin/python \
    NUT_MODEL_SCRIPT=/app/lifestyle-web/server/NUT_model/nut_estimator.py \
    NUT_MODEL_WEIGHTS=/app/lifestyle-web/server/NUT_model/checkpoint/canet_NUT.pth \
    NUT_MODEL_LABELS=/app/lifestyle-web/server/data/FoodSeg103/category_id.txt \
    PPG_MODEL_PYTHON_BIN=/app/lifestyle-web/server/ppg_glucose/.venv/bin/python

ENTRYPOINT ["./docker-entrypoint.sh"]

CMD ["node", "src/server.js"]
