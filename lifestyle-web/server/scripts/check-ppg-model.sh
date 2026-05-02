#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PPG_ROOT="$ROOT/ppg_glucose"
LOCAL_VENV_PYTHON="$PPG_ROOT/.venv/bin/python"
REQ_DESC="$PPG_ROOT/requirements_server.txt"

if [[ -n "${PPG_MODEL_PYTHON_BIN:-}" ]]; then
  PY="$PPG_MODEL_PYTHON_BIN"
elif [[ -x "$LOCAL_VENV_PYTHON" ]]; then
  PY="$LOCAL_VENV_PYTHON"
else
  PY="python3"
fi

echo "Using Python runtime: $PY"

"$PY" -c "
import importlib.util
required = ['numpy', 'pandas', 'scipy', 'sklearn', 'PyEMD', 'catboost', 'dotmap', 'yaml', 'pyPPG']
missing = [name for name in required if importlib.util.find_spec(name) is None]
if missing:
    raise SystemExit('Missing modules: ' + ', '.join(missing) + '. Install ' + '$REQ_DESC')
print('BGL inference runtime dependencies OK')
"
