#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PPG_ROOT="$ROOT/ppg_glucose"
VENV="$PPG_ROOT/.venv"
PY="$VENV/bin/python"
REQ="$PPG_ROOT/requirements_server.txt"

cd "$ROOT"

python3 -m venv "$VENV"
"$PY" -m pip install --upgrade pip setuptools wheel

PYTHON_MINOR="$("$PY" - <<'PY'
import sys
print(f"{sys.version_info.major}.{sys.version_info.minor}")
PY
)"

if [[ "$PYTHON_MINOR" == "3.13" ]]; then
  "$PY" -m pip install --retries 10 --timeout 120 \
    numpy pandas scipy scikit-learn EMD-signal catboost xgboost lightgbm \
    matplotlib seaborn pyyaml pyarrow 'sqlalchemy>=2.0' psycopg2-binary \
    pymysql cryptography 'pytest>=7.0'
  "$PY" -m pip install --no-deps pyPPG==1.0.73 vitaldb==1.6.0 dotmap==1.3.30
  "$PY" - <<'PY'
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
else
  "$PY" -m pip install --retries 10 --timeout 120 -r "$REQ"
fi

grep -q '^PPG_MODEL_PYTHON_BIN=' .env || echo "PPG_MODEL_PYTHON_BIN=$PY" >> .env

"$PY" -c "
import numpy, pandas, scipy, sklearn, PyEMD, catboost, dotmap, yaml, pyPPG
print('BGL inference dependencies OK')
"
