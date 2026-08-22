#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_DIR="$(mktemp -d)"
FAKE_BIN="$TEST_DIR/bin"
INSTALL_DIR="$TEST_DIR/install"
SECOND_INSTALL_DIR="$TEST_DIR/install-second"
LAN_INSTALL_DIR="$TEST_DIR/install-lan"
ENGLISH_INSTALL_DIR="$TEST_DIR/install-english"
DOWNLOAD_FAILURE_DIR="$TEST_DIR/install-download-failure"
DEPLOY_FAILURE_DIR="$TEST_DIR/install-deploy-failure"
FIXTURE_DIR="$TEST_DIR/fixtures"
TEST_KEY_DIR="$TEST_DIR/signing"

cleanup() {
  rm -rf -- "$TEST_DIR"
}
trap cleanup EXIT

mkdir -p "$FAKE_BIN" "$FIXTURE_DIR" "$TEST_KEY_DIR"
cp "$PROJECT_DIR/docker-compose.install.yml" "$FIXTURE_DIR/docker-compose.install.yml"
cp "$PROJECT_DIR/Caddyfile" "$FIXTURE_DIR/Caddyfile"
cp "$PROJECT_DIR/scripts/configure-domain.sh" "$FIXTURE_DIR/configure-domain.sh"
compose_sha256="$(sha256sum "$FIXTURE_DIR/docker-compose.install.yml" | awk '{print $1}')"
caddy_sha256="$(sha256sum "$FIXTURE_DIR/Caddyfile" | awk '{print $1}')"
configure_domain_sha256="$(sha256sum "$FIXTURE_DIR/configure-domain.sh" | awk '{print $1}')"
openssl genpkey -algorithm ED25519 -out "$TEST_KEY_DIR/private.pem" >/dev/null 2>&1
openssl pkey -in "$TEST_KEY_DIR/private.pem" -pubout -outform DER -out "$TEST_KEY_DIR/public.der" >/dev/null 2>&1
tail -c 32 "$TEST_KEY_DIR/public.der" | base64 -w0 >"$TEST_KEY_DIR/public.b64"
cat >"$FIXTURE_DIR/update-manifest-v1.json" <<EOF
{"schemaVersion":1,"version":"v9.8.7","channel":"stable","composeSha256":"$compose_sha256","caddySha256":"$caddy_sha256","configureDomainSha256":"$configure_domain_sha256","updater":{"amd64":"$(printf a%.0s {1..64})","arm64":"$(printf b%.0s {1..64})"},"webImage":"ghcr.io/flightdan/crewqual-web@sha256:$(printf a%.0s {1..64})","runtimeImage":"ghcr.io/flightdan/crewqual-runtime@sha256:$(printf b%.0s {1..64})","composeUrl":"https://example.invalid/compose","caddyUrl":"https://example.invalid/Caddyfile","configureDomainUrl":"https://example.invalid/configure-domain.sh","migrationPolicy":"backward-compatible"}
EOF
openssl pkeyutl -sign -rawin -inkey "$TEST_KEY_DIR/private.pem" -in "$FIXTURE_DIR/update-manifest-v1.json" -out "$TEST_KEY_DIR/manifest.sig"
base64 -w0 "$TEST_KEY_DIR/manifest.sig" >"$FIXTURE_DIR/update-manifest-v1.json.sig"

cat >"$FAKE_BIN/curl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
output=""
effective=0
url=""
while (($#)); do
  case "$1" in
    -o)
      output="$2"
      shift 2
      ;;
    -w)
      effective=1
      shift 2
      ;;
    -* )
      shift
      ;;
    *)
      url="$1"
      shift
      ;;
  esac
done
if ((effective)); then
  printf '%s' 'https://github.com/FlightDan/crewqual/releases/tag/v9.8.7'
elif [[ "$url" == */update-manifest-v1.json ]]; then
  cp "$CREWQUAL_TEST_FIXTURES/update-manifest-v1.json" "$output"
elif [[ "$url" == */update-manifest-v1.json.sig ]]; then
  cp "$CREWQUAL_TEST_FIXTURES/update-manifest-v1.json.sig" "$output"
elif [[ "$url" == */docker-compose.install.yml ]]; then
  [[ "${CREWQUAL_TEST_CURL_FAIL:-0}" != "1" ]] || exit 22
  cp "$CREWQUAL_TEST_FIXTURES/docker-compose.install.yml" "$output"
elif [[ "$url" == */Caddyfile ]]; then
  cp "$CREWQUAL_TEST_FIXTURES/Caddyfile" "$output"
elif [[ "$url" == */scripts/configure-domain.sh ]]; then
  cp "$CREWQUAL_TEST_FIXTURES/configure-domain.sh" "$output"
else
  exit 22
fi
EOF

cat >"$FAKE_BIN/docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-}" == "info" ]]; then exit 0; fi
if [[ "${1:-}" == "inspect" ]]; then
  format="${3:-}"
  id="${4:-}"
  if [[ "$format" == '{{.State.ExitCode}}' ]]; then printf '0\n'; exit 0; fi
  if [[ "$format" == '{{.State.Status}}' ]]; then
    [[ "$id" == "minio-init-id" ]] && printf 'exited\n' || printf 'running\n'
    exit 0
  fi
  case "$id" in
    postgres-id|web-id|worker-id) printf 'healthy\n' ;;
    caddy-id) printf 'running\n' ;;
    *) printf 'running\n' ;;
  esac
  exit 0
fi
if [[ "${1:-}" == "compose" ]]; then
  for argument in "$@"; do
    if [[ "$argument" == "pg_dump" ]]; then
      printf 'fake-upgrade-database-dump\n'
      exit 0
    fi
  done
  for ((index = 1; index <= $#; index++)); do
    argument="${!index}"
    if [[ -n "${CREWQUAL_TEST_DOCKER_FAIL_ACTION:-}" && "$argument" == "$CREWQUAL_TEST_DOCKER_FAIL_ACTION" ]]; then
      exit 17
    fi
    if [[ "$argument" == "version" || "$argument" == "config" || "$argument" == "pull" || "$argument" == "up" || "$argument" == "run" || "$argument" == "logs" ]]; then
      exit 0
    fi
    if [[ "$argument" == "ps" ]]; then
      service="${!#}"
      printf '%s-id\n' "$service"
      exit 0
    fi
  done
  exit 0
fi
exit 2
EOF

chmod 755 "$FAKE_BIN/curl" "$FAKE_BIN/docker"

run_installer() {
  local target_dir="${CREWQUAL_TEST_INSTALL_DIR:-$INSTALL_DIR}"
  PATH="$FAKE_BIN:$PATH" \
    CREWQUAL_INSTALL_TEST_MODE=1 \
    CREWQUAL_INSTALL_DIR="$target_dir" \
    CREWQUAL_UPDATER_TRUSTED_PUBLIC_KEY="$(cat "$TEST_KEY_DIR/public.b64")" \
    CREWQUAL_TEST_FIXTURES="$FIXTURE_DIR" \
    CREWQUAL_TEST_CURL_FAIL="${CREWQUAL_TEST_CURL_FAIL:-0}" \
    CREWQUAL_TEST_DOCKER_FAIL_ACTION="${CREWQUAL_TEST_DOCKER_FAIL_ACTION:-}" \
    bash "$PROJECT_DIR/install.sh" "$@"
}

run_installer --domain crewqual.example.com --tls-email ops@example.com --non-interactive

[[ -f "$INSTALL_DIR/compose.yaml" && -f "$INSTALL_DIR/Caddyfile" && -f "$INSTALL_DIR/.env" ]]
[[ "$(stat -c '%a' "$INSTALL_DIR/.env")" == "600" ]]
grep -q "CREWQUAL_VERSION='v9.8.7'" "$INSTALL_DIR/.env"
grep -q 'CREWQUAL_RUNTIME_IMAGE: ${CREWQUAL_RUNTIME_IMAGE' "$INSTALL_DIR/compose.yaml"

before_secrets="$(sed -n '/^POSTGRES_PASSWORD=/p;/^SESSION_SECRET=/p;/^SETTINGS_ENCRYPTION_KEY=/p' "$INSTALL_DIR/.env")"
run_installer --version v9.8.8 --non-interactive
after_secrets="$(sed -n '/^POSTGRES_PASSWORD=/p;/^SESSION_SECRET=/p;/^SETTINGS_ENCRYPTION_KEY=/p' "$INSTALL_DIR/.env")"

[[ "$before_secrets" == "$after_secrets" ]]
grep -q "CREWQUAL_VERSION='v9.8.8'" "$INSTALL_DIR/.env"
grep -q "INSTALL_LANGUAGE='zh'" "$INSTALL_DIR/.env"

english_log="$TEST_DIR/english.log"
CREWQUAL_TEST_INSTALL_DIR="$ENGLISH_INSTALL_DIR" \
  run_installer --version v9.8.7 --language en --domain english.example.com \
  --tls-email english@example.com --non-interactive >"$english_log" 2>&1
grep -q "INSTALL_LANGUAGE='en'" "$ENGLISH_INSTALL_DIR/.env"
grep -q "deployment complete" "$english_log"

english_upgrade_log="$TEST_DIR/english-upgrade.log"
CREWQUAL_TEST_INSTALL_DIR="$ENGLISH_INSTALL_DIR" \
  run_installer --version v9.8.8 --non-interactive >"$english_upgrade_log" 2>&1
grep -q "deployment complete" "$english_upgrade_log"

CREWQUAL_TEST_INSTALL_DIR="$SECOND_INSTALL_DIR" \
  run_installer --version v9.8.7 --domain second.example.com \
  --tls-email second@example.com --non-interactive >/dev/null
second_secrets="$(sed -n '/^POSTGRES_PASSWORD=/p;/^SESSION_SECRET=/p;/^SETTINGS_ENCRYPTION_KEY=/p' "$SECOND_INSTALL_DIR/.env")"
[[ "$before_secrets" != "$second_secrets" ]]

CREWQUAL_TEST_INSTALL_DIR="$LAN_INSTALL_DIR" \
  run_installer --version v9.8.7 --network-mode lan --lan-address 192.168.1.20 \
  --port 8081 --non-interactive >/dev/null
grep -q "DEPLOYMENT_NETWORK_MODE='lan'" "$LAN_INSTALL_DIR/.env"
grep -q "APP_ORIGIN='http://192.168.1.20:8081'" "$LAN_INSTALL_DIR/.env"
grep -q "APP_PORT='8081'" "$LAN_INSTALL_DIR/.env"
grep -q "ACME_PORT='18080'" "$LAN_INSTALL_DIR/.env"
[[ -x "$LAN_INSTALL_DIR/configure-domain.sh" ]]

download_failure_log="$TEST_DIR/download-failure.log"
if CREWQUAL_TEST_INSTALL_DIR="$DOWNLOAD_FAILURE_DIR" CREWQUAL_TEST_CURL_FAIL=1 \
  run_installer --version v9.8.7 --domain failure.example.com \
  --tls-email failure@example.com --non-interactive >"$download_failure_log" 2>&1; then
  echo "expected release download to fail" >&2
  exit 1
fi
[[ ! -e "$DOWNLOAD_FAILURE_DIR/.env" ]]

deploy_failure_log="$TEST_DIR/deploy-failure.log"
if CREWQUAL_TEST_INSTALL_DIR="$DEPLOY_FAILURE_DIR" CREWQUAL_TEST_DOCKER_FAIL_ACTION=pull \
  run_installer --version v9.8.7 --domain deploy-failure.example.com \
  --tls-email deploy-failure@example.com --non-interactive >"$deploy_failure_log" 2>&1; then
  echo "expected deployment to fail" >&2
  exit 1
fi
grep -q "部署失败" "$deploy_failure_log"
grep -q -- "--- docker compose ps -a ---" "$deploy_failure_log"
grep -q -- "--- recent deployment logs ---" "$deploy_failure_log"
[[ -f "$DEPLOY_FAILURE_DIR/.env" ]]

upgrade_failure_log="$TEST_DIR/upgrade-failure.log"
old_upgrade_compose="$(sha256sum "$INSTALL_DIR/compose.yaml" | awk '{print $1}')"
if CREWQUAL_TEST_INSTALL_DIR="$INSTALL_DIR" CREWQUAL_TEST_DOCKER_FAIL_ACTION=pull \
  run_installer --version v9.8.9 --non-interactive >"$upgrade_failure_log" 2>&1; then
  echo "expected repeated upgrade to fail" >&2
  exit 1
fi
grep -q "CREWQUAL_VERSION='v9.8.8'" "$INSTALL_DIR/.env"
[[ "$(sha256sum "$INSTALL_DIR/compose.yaml" | awk '{print $1}')" == "$old_upgrade_compose" ]]
grep -q "已恢复升级前的受管理文件和数据库" "$upgrade_failure_log"

echo "install.sh mocked fresh-install, upgrade, random-secret, and failure-diagnostic checks passed"
