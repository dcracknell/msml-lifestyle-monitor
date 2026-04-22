#!/usr/bin/env bash
set -euo pipefail

command_available() {
  local target="$1"
  case "$target" in
    */*|*\\*)
      [ -x "$target" ]
      ;;
    *)
      command -v "$target" >/dev/null 2>&1
      ;;
  esac
}

PY="${NUT_MODEL_PYTHON_BIN:-}"

if [[ -n "$PY" ]] && ! command_available "$PY"; then
  PY=""
fi

if [[ -z "$PY" ]]; then
  if [[ -x NUT_model/.venv/bin/python ]]; then
    PY="NUT_model/.venv/bin/python"
  elif command -v python3 >/dev/null 2>&1; then
    PY="python3"
  else
    PY="python"
  fi
fi

"$PY" NUT_model/nut_estimator.py --self-check --model NUT_model/checkpoint/canet_NUT.pth
