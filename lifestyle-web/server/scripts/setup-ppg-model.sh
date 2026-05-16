#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PPG_ROOT="$ROOT/ppg_glucose"
VENV="$PPG_ROOT/.venv"
PY="$VENV/bin/python"
REQ="$PPG_ROOT/requirements_server.txt"

resolve_setup_python() {
  local candidates=()
  local candidate=""

  if [[ -n "${PPG_MODEL_SETUP_PYTHON_BIN:-}" ]]; then
    candidates+=("$PPG_MODEL_SETUP_PYTHON_BIN")
  fi
  if [[ -n "${PPG_MODEL_PYTHON_BIN:-}" ]]; then
    candidates+=("$PPG_MODEL_PYTHON_BIN")
  fi
  candidates+=("python3.13" "python3.12" "python3.11" "python3")

  for candidate in "${candidates[@]}"; do
    if [[ "$candidate" == */* ]]; then
      if [[ -x "$candidate" ]]; then
        printf '%s\n' "$candidate"
        return 0
      fi
      continue
    fi

    if command -v "$candidate" >/dev/null 2>&1; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  return 1
}

update_env_runtime() {
  local env_file="$1"
  local runtime_line="$2"
  local tmp_file=""

  if [[ -f "$env_file" ]] && grep -q '^PPG_MODEL_PYTHON_BIN=' "$env_file"; then
    tmp_file="$(mktemp)"
    awk -v replacement="$runtime_line" '
      BEGIN { replaced = 0 }
      /^PPG_MODEL_PYTHON_BIN=/ && !replaced {
        print replacement
        replaced = 1
        next
      }
      { print }
      END {
        if (!replaced) {
          print replacement
        }
      }
    ' "$env_file" > "$tmp_file"
    mv "$tmp_file" "$env_file"
    return
  fi

  echo "$runtime_line" >> "$env_file"
}

cd "$ROOT"

SETUP_PYTHON="$(resolve_setup_python || true)"
if [[ -z "$SETUP_PYTHON" ]]; then
  echo "Unable to find a usable Python runtime for PPG setup." >&2
  echo "Install Python 3.12 or set PPG_MODEL_SETUP_PYTHON_BIN=/path/to/python3.12." >&2
  exit 1
fi

PYTHON_MINOR="$("$SETUP_PYTHON" - <<'PY'
import sys
print(f"{sys.version_info.major}.{sys.version_info.minor}")
PY
)"

case "$PYTHON_MINOR" in
  3.11|3.12|3.13)
    ;;
  *)
    echo "PPG setup requires Python 3.11, 3.12, or 3.13. Found $PYTHON_MINOR at $SETUP_PYTHON." >&2
    echo "Install Python 3.12 or set PPG_MODEL_SETUP_PYTHON_BIN=/path/to/python3.12." >&2
    exit 1
    ;;
esac

rm -rf "$VENV"
"$SETUP_PYTHON" -m venv "$VENV"
"$PY" -m pip install --upgrade pip setuptools wheel

if [[ "$PYTHON_MINOR" == "3.12" || "$PYTHON_MINOR" == "3.13" ]]; then
  "$PY" -m pip install --retries 10 --timeout 120 \
    'numpy<2.0' 'pandas<2.2' scipy scikit-learn EMD-signal catboost xgboost lightgbm \
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

update_env_runtime ".env" "PPG_MODEL_PYTHON_BIN=$PY"

"$PY" -c "
import numpy, pandas, scipy, sklearn, PyEMD, catboost, dotmap, yaml, pyPPG
print('BGL inference dependencies OK')
"
