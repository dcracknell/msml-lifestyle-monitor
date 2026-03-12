#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
VENV="$ROOT/NUT_model/.venv"
PY="$VENV/bin/python"
REQ="$ROOT/NUT_model/requirements.txt"
WHEELHOUSE="$ROOT/NUT_model/.wheelhouse"

mkdir -p "$WHEELHOUSE"
cd "$ROOT"

download_resume() {
  local url="$1"
  local out="$2"

  if command -v wget >/dev/null 2>&1; then
    wget -c --tries=30 --waitretry=5 --timeout=120 -O "$out" "$url"
    return
  fi

  if command -v curl >/dev/null 2>&1; then
    curl -L --retry 30 --retry-delay 5 --connect-timeout 30 --max-time 0 -C - -o "$out" "$url"
    return
  fi

  echo "Neither wget nor curl is installed; cannot resume interrupted downloads."
  exit 1
}

python3 -m venv "$VENV"
"$PY" -m pip install --upgrade pip setuptools wheel

# Pre-fetch large wheels with resume support for Linux ARM64 + Python 3.13.
# This avoids repeated restarts when the network drops mid-download.
ARCH="$(uname -m || true)"
PY_VER="$("$PY" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"
if [[ "$ARCH" == "aarch64" && "$PY_VER" == "3.13" ]]; then
  download_resume \
    "https://files.pythonhosted.org/packages/c9/6f/f2e91e34e3fcba2e3fc8d8f74e7d6c22e74e480bbd1db7bc8900fdf3e95c/torch-2.10.0-cp313-cp313-manylinux_2_28_aarch64.whl" \
    "$WHEELHOUSE/torch-2.10.0-cp313-cp313-manylinux_2_28_aarch64.whl"
  download_resume \
    "https://files.pythonhosted.org/packages/36/b1/3d6c42f62c272ce34fcce609bb8939bdf873dab5f1b798fd4e880255f129/torchvision-0.25.0-cp313-cp313-manylinux_2_28_aarch64.whl" \
    "$WHEELHOUSE/torchvision-0.25.0-cp313-cp313-manylinux_2_28_aarch64.whl"
  download_resume \
    "https://files.pythonhosted.org/packages/9e/1b/f1a4ea9a895b5732152789326202a82464d5254759fbacae4deea3069334/pillow-12.1.1-cp313-cp313-manylinux2014_aarch64.manylinux_2_17_aarch64.whl" \
    "$WHEELHOUSE/pillow-12.1.1-cp313-cp313-manylinux2014_aarch64.manylinux_2_17_aarch64.whl"
  download_resume \
    "https://files.pythonhosted.org/packages/bf/ec/7971c4e98d86c564750393fab8d7d83d0a9432a9d78bb8a163a6dc59967a/numpy-2.4.3-cp313-cp313-manylinux_2_27_aarch64.manylinux_2_28_aarch64.whl" \
    "$WHEELHOUSE/numpy-2.4.3-cp313-cp313-manylinux_2_27_aarch64.manylinux_2_28_aarch64.whl"

  "$PY" -m pip install \
    --retries 20 \
    --timeout 120 \
    "$WHEELHOUSE/torch-2.10.0-cp313-cp313-manylinux_2_28_aarch64.whl" \
    "$WHEELHOUSE/torchvision-0.25.0-cp313-cp313-manylinux_2_28_aarch64.whl" \
    "$WHEELHOUSE/pillow-12.1.1-cp313-cp313-manylinux2014_aarch64.manylinux_2_17_aarch64.whl" \
    "$WHEELHOUSE/numpy-2.4.3-cp313-cp313-manylinux_2_27_aarch64.manylinux_2_28_aarch64.whl"
fi

for i in {1..10}; do
  if "$PY" -m pip install --retries 20 --timeout 120 -r "$REQ"; then
    break
  fi
  if [[ "$i" -eq 10 ]]; then
    echo "Failed to install NUT model deps after $i attempts."
    exit 1
  fi
  echo "Install attempt $i failed. Retrying in 10s..."
  sleep 10
done

grep -q '^NUT_MODEL_PYTHON_BIN=' .env || echo "NUT_MODEL_PYTHON_BIN=$PY" >> .env
grep -q '^NUT_MODEL_TIMEOUT_MS=' .env || echo "NUT_MODEL_TIMEOUT_MS=45000" >> .env
grep -q '^NUT_MODEL_IMAGE_SIZE=' .env || echo "NUT_MODEL_IMAGE_SIZE=320" >> .env
grep -q '^NUT_MODEL_SETUP_CACHE_TTL_MS=' .env || echo "NUT_MODEL_SETUP_CACHE_TTL_MS=3600000" >> .env

npm rebuild better-sqlite3
npm run check:nut-model
npm test -- --runInBand src/tests/nutrition-photo-log.test.js
