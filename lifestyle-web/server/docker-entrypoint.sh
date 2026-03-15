#!/bin/sh
set -eu

DEFAULT_NUT_PYTHON_BIN="/opt/nut-venv/bin/python"
DEFAULT_NUT_SCRIPT="/app/lifestyle-web/server/NUT_model/nut_estimator.py"
DEFAULT_NUT_WEIGHTS="/app/lifestyle-web/server/NUT_model/checkpoint/canet_NUT.pth"
DEFAULT_NUT_LABELS="/app/lifestyle-web/server/data/FoodSeg103/category_id.txt"

get_env_value() {
  eval "printf '%s' \"\${$1:-}\""
}

set_env_value() {
  eval "export $1=\"\$2\""
}

command_available() {
  target="$1"
  case "$target" in
    */*)
      [ -x "$target" ]
      ;;
    *)
      command -v "$target" >/dev/null 2>&1
      ;;
  esac
}

ensure_command() {
  var_name="$1"
  fallback="$2"
  current_value="$(get_env_value "$var_name")"
  if [ -z "$current_value" ] || ! command_available "$current_value"; then
    set_env_value "$var_name" "$fallback"
  fi
}

ensure_file() {
  var_name="$1"
  fallback="$2"
  current_value="$(get_env_value "$var_name")"
  if [ -z "$current_value" ] || [ ! -f "$current_value" ]; then
    set_env_value "$var_name" "$fallback"
  fi
}

ensure_command NUT_MODEL_PYTHON_BIN "$DEFAULT_NUT_PYTHON_BIN"
ensure_file NUT_MODEL_SCRIPT "$DEFAULT_NUT_SCRIPT"
ensure_file NUT_MODEL_WEIGHTS "$DEFAULT_NUT_WEIGHTS"

if [ -n "${NUT_MODEL_LABELS:-}" ] || [ -f "$DEFAULT_NUT_LABELS" ]; then
  ensure_file NUT_MODEL_LABELS "$DEFAULT_NUT_LABELS"
fi

exec "$@"
