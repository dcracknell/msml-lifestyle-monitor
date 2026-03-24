#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="/home/cracknelldrb/Desktop/Dissertation/msml-lifestyle-monitor"
WEB_DIR="$REPO_ROOT/lifestyle-web"
K8S_DIR="$WEB_DIR/k8s"
SERVER_ENV="$WEB_DIR/server/.env"
SECRET_ENV="$K8S_DIR/secrets.env"
DONE_FILE="/var/lib/msml-local-k3s-setup.done"

export KUBECONFIG="/etc/rancher/k3s/k3s.yaml"

log() {
  printf '[msml-local-k3s] %s\n' "$*"
}

wait_for_service() {
  local service_name="$1"
  local attempts="${2:-90}"
  local delay="${3:-2}"

  for _ in $(seq 1 "$attempts"); do
    if systemctl is-active --quiet "$service_name"; then
      return 0
    fi
    sleep "$delay"
  done

  systemctl status "$service_name" --no-pager -l || true
  return 1
}

prepare_secret_env() {
  if [ -s "$SECRET_ENV" ]; then
    return 0
  fi

  install -d -m 0755 "$K8S_DIR"

  if [ -f "$SERVER_ENV" ]; then
    umask 077
    awk '
      /^(SESSION_SECRET|PASSWORD_ENCRYPTION_KEY|HEAD_COACH_SEED_PASSWORD|COACH_SEED_PASSWORD|ATHLETE_SEED_PASSWORD|STRAVA_CLIENT_ID|STRAVA_CLIENT_SECRET|STRAVA_REDIRECT_URI|STRAVA_SCOPE)=/ {
        print
      }
    ' "$SERVER_ENV" > "$SECRET_ENV"
    if [ -s "$SECRET_ENV" ]; then
      return 0
    fi
  fi

  install -m 0600 "$K8S_DIR/secrets.env.example" "$SECRET_ENV"
}

main() {
  if [ -f "$DONE_FILE" ]; then
    log "Setup already completed."
    return 0
  fi

  log "Waiting for Docker and k3s..."
  systemctl start docker
  systemctl start k3s
  wait_for_service docker
  wait_for_service k3s

  log "Preparing Kubernetes secret env file..."
  prepare_secret_env

  log "Building local image..."
  docker build -t lifestyle-web:local -f "$WEB_DIR/Dockerfile" "$WEB_DIR"

  log "Importing image into k3s containerd..."
  docker save lifestyle-web:local | k3s ctr images import -

  log "Applying namespace and secret..."
  kubectl apply -f "$K8S_DIR/namespace.yaml"
  kubectl -n lifestyle-web create secret generic lifestyle-web-secrets \
    --from-env-file="$SECRET_ENV" \
    --dry-run=client -o yaml | kubectl apply -f -

  log "Applying local overlay..."
  kubectl apply -k "$K8S_DIR/overlays/local"

  log "Waiting for deployment rollout..."
  kubectl -n lifestyle-web rollout status deployment/lifestyle-web --timeout=30m

  install -d -m 0755 "$(dirname "$DONE_FILE")"
  touch "$DONE_FILE"

  log "Deployment complete."
  kubectl -n lifestyle-web get pods,svc
}

main "$@"
