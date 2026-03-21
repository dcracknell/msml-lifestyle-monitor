#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# MSML Lifestyle Monitor — interactive setup wizard
# Generates lifestyle-web/server/.env from .env.example, then starts Docker.
# Usage:  cd msml-lifestyle-monitor/lifestyle-web && bash setup.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_EXAMPLE="$SCRIPT_DIR/server/.env.example"
ENV_OUT="$SCRIPT_DIR/server/.env"

# ── helpers ──────────────────────────────────────────────────────────────────

bold()    { printf '\033[1m%s\033[0m' "$*"; }
green()   { printf '\033[32m%s\033[0m' "$*"; }
yellow()  { printf '\033[33m%s\033[0m' "$*"; }
red()     { printf '\033[31m%s\033[0m' "$*"; }
dim()     { printf '\033[2m%s\033[0m' "$*"; }

ask() {
  # ask <var_name> <prompt> [default]
  local var="$1" prompt="$2" default="${3:-}"
  if [[ -n "$default" ]]; then
    printf '%s %s: ' "$(bold "$prompt")" "$(dim "(default: $default)")"
  else
    printf '%s: ' "$(bold "$prompt")"
  fi
  read -r input
  if [[ -z "$input" && -n "$default" ]]; then
    printf -v "$var" '%s' "$default"
  else
    printf -v "$var" '%s' "$input"
  fi
}

ask_secret() {
  # ask_secret <var_name> <prompt>
  local var="$1" prompt="$2"
  printf '%s %s: ' "$(bold "$prompt")" "$(dim "(input hidden)")"
  read -rs input
  echo
  printf -v "$var" '%s' "$input"
}

gen_secret() {
  # Generate a 32-byte hex secret using node or openssl
  if command -v node &>/dev/null; then
    node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))"
  elif command -v openssl &>/dev/null; then
    openssl rand -hex 32
  else
    # Fallback: urandom
    cat /dev/urandom | tr -dc 'a-f0-9' | head -c 64
  fi
}

set_env() {
  # Replace or append KEY=VALUE in the output .env
  local key="$1" value="$2"
  if grep -q "^${key}=" "$ENV_OUT" 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$ENV_OUT"
  else
    echo "${key}=${value}" >> "$ENV_OUT"
  fi
}

# ── banner ────────────────────────────────────────────────────────────────────

echo
echo "$(bold '╔══════════════════════════════════════════════════════════╗')"
echo "$(bold '║      MSML Lifestyle Monitor — Deployment Wizard          ║')"
echo "$(bold '╚══════════════════════════════════════════════════════════╝')"
echo

# ── prerequisites check ───────────────────────────────────────────────────────

echo "$(bold 'Checking prerequisites...')"
MISSING=()
for cmd in docker; do
  if ! command -v "$cmd" &>/dev/null; then
    MISSING+=("$cmd")
  fi
done
if ! docker compose version &>/dev/null 2>&1 && ! docker-compose version &>/dev/null 2>&1; then
  MISSING+=("docker compose")
fi
if [[ ${#MISSING[@]} -gt 0 ]]; then
  echo "$(red 'ERROR: The following required tools are missing:')"
  for m in "${MISSING[@]}"; do echo "  - $m"; done
  echo "Install Docker Desktop (https://docs.docker.com/get-docker/) and re-run this script."
  exit 1
fi
echo "$(green '  Docker found.')"
echo

# ── existing .env check ───────────────────────────────────────────────────────

if [[ -f "$ENV_OUT" ]]; then
  echo "$(yellow 'WARNING: server/.env already exists.')"
  ask OVERWRITE "Overwrite it? (y/N)" "N"
  if [[ ! "$OVERWRITE" =~ ^[Yy]$ ]]; then
    echo "Keeping existing .env. Skipping to Docker launch."
    SKIP_CONFIG=true
  fi
fi

if [[ "${SKIP_CONFIG:-false}" != "true" ]]; then

  # Copy template
  cp "$ENV_EXAMPLE" "$ENV_OUT"
  echo "$(green 'Created server/.env from template.')"
  echo

  # ── 1. Network ───────────────────────────────────────────────────────────────
  echo "$(bold '── Step 1 of 4: Network')"
  ask PORT "Dashboard port" "4000"
  ask ORIGIN "Origin URL(s) you will access the dashboard from" "http://localhost:${PORT}"
  set_env PORT "$PORT"
  set_env APP_ORIGIN "$ORIGIN"
  echo

  # ── 2. Secrets ───────────────────────────────────────────────────────────────
  echo "$(bold '── Step 2 of 4: Security secrets')"
  echo "  Press Enter to auto-generate strong random secrets (recommended)."
  echo
  ask SESSION_SECRET_INPUT "Session secret (blank = auto-generate)" ""
  if [[ -z "$SESSION_SECRET_INPUT" ]]; then
    SESSION_SECRET_INPUT="$(gen_secret)"
    echo "  $(green 'Auto-generated session secret.')"
  fi
  set_env SESSION_SECRET "$SESSION_SECRET_INPUT"

  ask PASSWORD_KEY_INPUT "Password encryption key (blank = auto-generate)" ""
  if [[ -z "$PASSWORD_KEY_INPUT" ]]; then
    PASSWORD_KEY_INPUT="$(gen_secret)"
    echo "  $(green 'Auto-generated password encryption key.')"
  fi
  set_env PASSWORD_ENCRYPTION_KEY "$PASSWORD_KEY_INPUT"
  echo

  # ── 3. Seed passwords ────────────────────────────────────────────────────────
  echo "$(bold '── Step 3 of 4: Default account passwords')"
  echo "  These are the passwords for the three demo accounts seeded into the database."
  echo
  ask_secret HC_PASS  "Head Coach password"
  ask_secret CO_PASS  "Coach password"
  ask_secret AT_PASS  "Athlete password"
  set_env HEAD_COACH_SEED_PASSWORD "$HC_PASS"
  set_env COACH_SEED_PASSWORD      "$CO_PASS"
  set_env ATHLETE_SEED_PASSWORD    "$AT_PASS"
  echo

  # ── 4. NUT model ─────────────────────────────────────────────────────────────
  echo "$(bold '── Step 4 of 4: Nutrition model speed')"
  echo "  Express mode keeps the model in memory (~3–8 s per request)."
  echo "  Standard mode is more accurate but slower (~30–45 s per request)."
  echo
  ask NUT_MODE "Enable express mode? (Y/n)" "Y"
  if [[ "$NUT_MODE" =~ ^[Nn]$ ]]; then
    set_env NUT_EXPRESS_MODE "false"
    echo "  Standard (high-accuracy) mode selected."
  else
    set_env NUT_EXPRESS_MODE "true"
    echo "  $(green 'Express mode enabled.')"
  fi
  echo

  echo "$(green '✔ server/.env written successfully.')"
fi

echo

# ── Docker launch ─────────────────────────────────────────────────────────────
echo "$(bold '── Launching with Docker Compose...')"
echo
ask LAUNCH "Build and start containers now? (Y/n)" "Y"
if [[ "$LAUNCH" =~ ^[Nn]$ ]]; then
  echo
  echo "To start manually:"
  echo "  cd $(pwd) && docker compose up -d --build"
  exit 0
fi

echo
if docker compose version &>/dev/null 2>&1; then
  DC="docker compose"
else
  DC="docker-compose"
fi

$DC up -d --build

echo
echo "$(bold '──────────────────────────────────────────────────────────')"
echo "$(green "  Dashboard:  http://localhost:${PORT:-4000}")"
echo "$(green "  Portainer:  http://localhost:9000")"
echo "$(bold '──────────────────────────────────────────────────────────')"
echo
echo "  $(dim 'To stop:   docker compose down')"
echo "  $(dim 'To view logs:  docker compose logs -f lifestyle-web')"
echo
