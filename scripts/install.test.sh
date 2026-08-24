#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_DIR="$(mktemp -d)"
FAKE_BIN="$TEST_DIR/bin"
INSTALL_DIR="$TEST_DIR/install"
SECOND_INSTALL_DIR="$TEST_DIR/install-second"
CUSTOM_INSTALL_DIR="$TEST_DIR/install-custom"
LAN_INSTALL_DIR="$TEST_DIR/install-lan"
HTTP_INSTALL_DIR="$TEST_DIR/install-http"
RC_INSTALL_DIR="$TEST_DIR/install-rc"
ENGLISH_INSTALL_DIR="$TEST_DIR/install-english"
DOWNLOAD_FAILURE_DIR="$TEST_DIR/install-download-failure"
DEPLOY_FAILURE_DIR="$TEST_DIR/install-deploy-failure"
WSL_INSTALL_DIR="$TEST_DIR/install-wsl"
WSL_LAN_INSTALL_DIR="$TEST_DIR/install-wsl-lan"
WSL_FAILURE_DIR="$TEST_DIR/install-wsl-failure"
FIXTURE_DIR="$TEST_DIR/fixtures"
TEST_KEY_DIR="$TEST_DIR/signing"
UPDATER_VERIFY_LOG="$TEST_DIR/updater-verified.log"

cleanup() {
  rm -rf -- "$TEST_DIR"
}
trap cleanup EXIT

mkdir -p "$FAKE_BIN" "$FIXTURE_DIR" "$TEST_KEY_DIR"
mkdir -p "$TEST_DIR/custom-cert"
openssl req -x509 -newkey rsa:2048 -nodes -keyout "$TEST_DIR/custom-cert/privkey.pem" \
  -out "$TEST_DIR/custom-cert/fullchain.pem" -days 30 \
  -subj "/CN=custom.example.com" -addext "subjectAltName=DNS:custom.example.com" >/dev/null 2>&1
cp "$PROJECT_DIR/docker-compose.install.yml" "$FIXTURE_DIR/docker-compose.install.yml"
cp "$PROJECT_DIR/Caddyfile" "$FIXTURE_DIR/Caddyfile"
cp "$PROJECT_DIR/scripts/configure-domain.sh" "$FIXTURE_DIR/configure-domain.sh"
cat >"$FIXTURE_DIR/crewqual-updater-linux-amd64" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
[[ "${1:-}" == "verify-manifest" ]] || exit 2
printf '%s\n' verified >>"$CREWQUAL_TEST_UPDATER_VERIFIED_FILE"
EOF
chmod 755 "$FIXTURE_DIR/crewqual-updater-linux-amd64"
cp "$FIXTURE_DIR/crewqual-updater-linux-amd64" "$FIXTURE_DIR/crewqual-updater-linux-arm64"
updater_amd64_sha="$(sha256sum "$FIXTURE_DIR/crewqual-updater-linux-amd64" | awk '{print $1}')"
updater_arm64_sha="$(sha256sum "$FIXTURE_DIR/crewqual-updater-linux-arm64" | awk '{print $1}')"
compose_sha256="$(sha256sum "$FIXTURE_DIR/docker-compose.install.yml" | awk '{print $1}')"
caddy_sha256="$(sha256sum "$FIXTURE_DIR/Caddyfile" | awk '{print $1}')"
configure_domain_sha256="$(sha256sum "$FIXTURE_DIR/configure-domain.sh" | awk '{print $1}')"
openssl genpkey -algorithm ED25519 -out "$TEST_KEY_DIR/private.pem" >/dev/null 2>&1
openssl pkey -in "$TEST_KEY_DIR/private.pem" -pubout -outform DER -out "$TEST_KEY_DIR/public.der" >/dev/null 2>&1
tail -c 32 "$TEST_KEY_DIR/public.der" | base64 -w0 >"$TEST_KEY_DIR/public.b64"
cat >"$FIXTURE_DIR/update-manifest-v1.json" <<EOF
{"schemaVersion":1,"version":"v9.8.7","channel":"stable","signingKeyId":"test-ed25519","publishedAt":"2026-08-24T00:00:00Z","releaseNotesUrl":"https://github.com/FlightDan/crewqual/releases/tag/v9.8.7","composeSha256":"$compose_sha256","caddySha256":"$caddy_sha256","configureDomainSha256":"$configure_domain_sha256","updater":{"amd64":"$updater_amd64_sha","arm64":"$updater_arm64_sha","amd64Url":"https://github.com/FlightDan/crewqual/releases/download/v9.8.7/crewqual-updater-linux-amd64","arm64Url":"https://github.com/FlightDan/crewqual/releases/download/v9.8.7/crewqual-updater-linux-arm64"},"webImage":"ghcr.io/flightdan/crewqual-web@sha256:$(printf a%.0s {1..64})","runtimeImage":"ghcr.io/flightdan/crewqual-runtime@sha256:$(printf b%.0s {1..64})","composeUrl":"https://github.com/FlightDan/crewqual/releases/download/v9.8.7/docker-compose.install.yml","caddyUrl":"https://github.com/FlightDan/crewqual/releases/download/v9.8.7/Caddyfile","configureDomainUrl":"https://github.com/FlightDan/crewqual/releases/download/v9.8.7/configure-domain.sh","minimumVersion":"","minimumUpdaterVersion":"0.1.0","migrationPolicy":"backward-compatible"}
EOF
openssl pkeyutl -sign -rawin -inkey "$TEST_KEY_DIR/private.pem" -in "$FIXTURE_DIR/update-manifest-v1.json" -out "$TEST_KEY_DIR/manifest.sig"
base64 -w0 "$TEST_KEY_DIR/manifest.sig" >"$FIXTURE_DIR/update-manifest-v1.json.sig"
cp "$FIXTURE_DIR/update-manifest-v1.json" "$FIXTURE_DIR/update-manifest-v9.8.7.json"
cp "$FIXTURE_DIR/update-manifest-v1.json.sig" "$FIXTURE_DIR/update-manifest-v9.8.7.json.sig"
printf '%s\n' "$updater_amd64_sha  crewqual-updater-linux-amd64" "$updater_arm64_sha  crewqual-updater-linux-arm64" >"$FIXTURE_DIR/SHA256SUMS"
openssl pkeyutl -sign -rawin -inkey "$TEST_KEY_DIR/private.pem" -in "$FIXTURE_DIR/SHA256SUMS" -out "$TEST_KEY_DIR/sums.sig"
base64 -w0 "$TEST_KEY_DIR/sums.sig" >"$FIXTURE_DIR/SHA256SUMS.sig"
for release_tag in v9.8.8 v9.8.9 v9.8.7-rc.2; do
  sed "s/v9\.8\.7/$release_tag/g" "$FIXTURE_DIR/update-manifest-v1.json" >"$FIXTURE_DIR/update-manifest-$release_tag.json"
  if [[ "$release_tag" == *-rc.* ]]; then
    sed -i 's/"channel":"stable"/"channel":"rc"/' "$FIXTURE_DIR/update-manifest-$release_tag.json"
  fi
  openssl pkeyutl -sign -rawin -inkey "$TEST_KEY_DIR/private.pem" -in "$FIXTURE_DIR/update-manifest-$release_tag.json" -out "$TEST_KEY_DIR/manifest-$release_tag.sig"
  base64 -w0 "$TEST_KEY_DIR/manifest-$release_tag.sig" >"$FIXTURE_DIR/update-manifest-$release_tag.json.sig"
done

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
elif [[ "$url" == *"api.github.com"* && "$url" == *"/releases"* ]]; then
  printf '%s\n' '[' '  {"tag_name":"v9.8.7"}' ']'
elif [[ "$url" == */update-manifest-v1.json ]]; then
  release_tag="$(printf '%s' "$url" | sed -nE 's#^.*/(v[^/]+)/update-manifest-v1\.json$#\1#p')"
  cp "$CREWQUAL_TEST_FIXTURES/update-manifest-$release_tag.json" "$output"
elif [[ "$url" == */update-manifest-v1.json.sig ]]; then
  release_tag="$(printf '%s' "$url" | sed -nE 's#^.*/(v[^/]+)/update-manifest-v1\.json\.sig$#\1#p')"
  cp "$CREWQUAL_TEST_FIXTURES/update-manifest-$release_tag.json.sig" "$output"
elif [[ "$url" == */SHA256SUMS ]]; then
  cp "$CREWQUAL_TEST_FIXTURES/SHA256SUMS" "$output"
elif [[ "$url" == */SHA256SUMS.sig ]]; then
  cp "$CREWQUAL_TEST_FIXTURES/SHA256SUMS.sig" "$output"
elif [[ "$url" == */docker-compose.install.yml ]]; then
  [[ "${CREWQUAL_TEST_CURL_FAIL:-0}" != "1" ]] || exit 22
  cp "$CREWQUAL_TEST_FIXTURES/docker-compose.install.yml" "$output"
elif [[ "$url" == */Caddyfile ]]; then
  cp "$CREWQUAL_TEST_FIXTURES/Caddyfile" "$output"
elif [[ "$url" == */configure-domain.sh ]]; then
  cp "$CREWQUAL_TEST_FIXTURES/configure-domain.sh" "$output"
elif [[ "$url" == */crewqual-updater-linux-amd64 ]]; then
  cp "$CREWQUAL_TEST_FIXTURES/crewqual-updater-linux-amd64" "$output"
elif [[ "$url" == */crewqual-updater-linux-arm64 ]]; then
  cp "$CREWQUAL_TEST_FIXTURES/crewqual-updater-linux-arm64" "$output"
else
  exit 22
fi
EOF

cat >"$FAKE_BIN/docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-}" == "info" ]]; then
  [[ "${CREWQUAL_TEST_DOCKER_INFO_FAIL:-0}" != "1" ]]
  exit
fi
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
  if [[ "${2:-}" == "version" && "${CREWQUAL_TEST_COMPOSE_FAIL:-0}" == "1" ]]; then exit 2; fi
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
    CREWQUAL_TEST_FIXTURES="$FIXTURE_DIR" \
    CREWQUAL_TEST_TRUSTED_PUBLIC_KEY="$(cat "$TEST_KEY_DIR/public.b64")" \
    CREWQUAL_TEST_KEY_ID="test-ed25519" \
    CREWQUAL_INSTALL_TEST_PLATFORM="${CREWQUAL_TEST_PLATFORM:-linux}" \
    CREWQUAL_INSTALL_TEST_DOCKER_MISSING="${CREWQUAL_TEST_DOCKER_MISSING:-0}" \
    CREWQUAL_TEST_DOCKER_INFO_FAIL="${CREWQUAL_TEST_DOCKER_INFO_FAIL:-0}" \
    CREWQUAL_TEST_COMPOSE_FAIL="${CREWQUAL_TEST_COMPOSE_FAIL:-0}" \
    CREWQUAL_TEST_UPDATER_VERIFIED_FILE="$UPDATER_VERIFY_LOG" \
    CREWQUAL_TEST_CURL_FAIL="${CREWQUAL_TEST_CURL_FAIL:-0}" \
    CREWQUAL_TEST_DOCKER_FAIL_ACTION="${CREWQUAL_TEST_DOCKER_FAIL_ACTION:-}" \
    bash "$PROJECT_DIR/install.sh" "$@"
}

run_installer --domain crewqual.example.com --tls-email ops@example.com --non-interactive

[[ -f "$INSTALL_DIR/compose.yaml" && -f "$INSTALL_DIR/Caddyfile" && -f "$INSTALL_DIR/.env" ]]
[[ "$(stat -c '%a' "$INSTALL_DIR/.env")" == "600" ]]
grep -q "CREWQUAL_VERSION='v9.8.7'" "$INSTALL_DIR/.env"
grep -q "CREWQUAL_UPDATER_MODE='managed'" "$INSTALL_DIR/.env"
grep -q "CREWQUAL_UPDATER_HOST_DIR='/run/crewqual-updater'" "$INSTALL_DIR/.env"
grep -Eq "CREWQUAL_UPDATER_SHARED_SECRET='[a-f0-9]{64}'" "$INSTALL_DIR/.env"
! grep -q '^CREWQUAL_UPDATER_TRUSTED_PUBLIC_KEY=' "$INSTALL_DIR/.env"
grep -q 'CREWQUAL_RUNTIME_IMAGE: ${CREWQUAL_RUNTIME_IMAGE' "$INSTALL_DIR/compose.yaml"

before_secrets="$(sed -n '/^POSTGRES_PASSWORD=/p;/^SESSION_SECRET=/p;/^SETTINGS_ENCRYPTION_KEY=/p' "$INSTALL_DIR/.env")"
run_installer --version v9.8.8 --non-interactive
after_secrets="$(sed -n '/^POSTGRES_PASSWORD=/p;/^SESSION_SECRET=/p;/^SETTINGS_ENCRYPTION_KEY=/p' "$INSTALL_DIR/.env")"

[[ "$before_secrets" == "$after_secrets" ]]
grep -q "CREWQUAL_VERSION='v9.8.8'" "$INSTALL_DIR/.env"
grep -q "INSTALL_LANGUAGE='zh'" "$INSTALL_DIR/.env"

CREWQUAL_TEST_INSTALL_DIR="$RC_INSTALL_DIR" \
  run_installer --version v9.8.7-rc.2 --domain rc.example.com \
  --tls-email rc@example.com --non-interactive >/dev/null
grep -q "CREWQUAL_VERSION='v9.8.7-rc.2'" "$RC_INSTALL_DIR/.env"

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

CREWQUAL_TEST_INSTALL_DIR="$CUSTOM_INSTALL_DIR" \
  run_installer --version v9.8.7 --network-mode tls --domain custom.example.com \
  --tls-cert "$TEST_DIR/custom-cert/fullchain.pem" \
  --tls-key "$TEST_DIR/custom-cert/privkey.pem" --port 8443 --non-interactive >/dev/null
grep -q "CADDY_TLS_CONFIG='tls /etc/caddy/tls/fullchain.pem /etc/caddy/tls/privkey.pem'" "$CUSTOM_INSTALL_DIR/.env"
grep -q "CADDY_EMAIL_CONFIG=''" "$CUSTOM_INSTALL_DIR/.env"
cmp -s "$TEST_DIR/custom-cert/fullchain.pem" "$CUSTOM_INSTALL_DIR/tls/fullchain.pem"
cmp -s "$TEST_DIR/custom-cert/privkey.pem" "$CUSTOM_INSTALL_DIR/tls/privkey.pem"
custom_cert_before="$(sha256sum "$CUSTOM_INSTALL_DIR/tls/fullchain.pem" "$CUSTOM_INSTALL_DIR/tls/privkey.pem")"
CREWQUAL_TEST_INSTALL_DIR="$CUSTOM_INSTALL_DIR" \
  run_installer --version v9.8.8 --non-interactive >/dev/null
[[ "$custom_cert_before" == "$(sha256sum "$CUSTOM_INSTALL_DIR/tls/fullchain.pem" "$CUSTOM_INSTALL_DIR/tls/privkey.pem")" ]]

CREWQUAL_TEST_INSTALL_DIR="$LAN_INSTALL_DIR" \
  run_installer --version v9.8.7 --network-mode lan --lan-address 192.168.1.20 \
  --port 8081 --non-interactive >/dev/null
grep -q "DEPLOYMENT_NETWORK_MODE='lan'" "$LAN_INSTALL_DIR/.env"
grep -q "APP_ORIGIN='http://192.168.1.20:8081'" "$LAN_INSTALL_DIR/.env"
grep -q "APP_PORT='8081'" "$LAN_INSTALL_DIR/.env"
grep -q "ACME_PORT='18080'" "$LAN_INSTALL_DIR/.env"
[[ -x "$LAN_INSTALL_DIR/configure-domain.sh" ]]

WSL_INSTALL_LOG="$TEST_DIR/wsl-install.log"
CREWQUAL_TEST_PLATFORM=wsl CREWQUAL_TEST_INSTALL_DIR="$WSL_INSTALL_DIR" \
  run_installer --version v9.8.7 --install-docker --non-interactive >"$WSL_INSTALL_LOG" 2>&1
grep -q "CREWQUAL_UPDATER_MODE='manual'" "$WSL_INSTALL_DIR/.env"
grep -q "CREWQUAL_UPDATER_HOST_DIR='$WSL_INSTALL_DIR/.updater-runtime'" "$WSL_INSTALL_DIR/.env"
grep -q "CREWQUAL_UPDATER_SHARED_SECRET=''" "$WSL_INSTALL_DIR/.env"
grep -q "APP_ORIGIN='http://localhost:8080'" "$WSL_INSTALL_DIR/.env"
grep -q "APP_BIND='127.0.0.1'" "$WSL_INSTALL_DIR/.env"
grep -q '已忽略 --install-docker' "$WSL_INSTALL_LOG"
grep -q '手动升级模式' "$WSL_INSTALL_LOG"
grep -q '重新运行 CrewQual 安装命令' "$WSL_INSTALL_LOG"
[[ -d "$WSL_INSTALL_DIR/.updater-runtime" ]]

wsl_before_secrets="$(sed -n '/^POSTGRES_PASSWORD=/p;/^SESSION_SECRET=/p;/^SETTINGS_ENCRYPTION_KEY=/p' "$WSL_INSTALL_DIR/.env")"
CREWQUAL_TEST_PLATFORM=wsl CREWQUAL_TEST_INSTALL_DIR="$WSL_INSTALL_DIR" \
  run_installer --version v9.8.8 --non-interactive >/dev/null
wsl_after_secrets="$(sed -n '/^POSTGRES_PASSWORD=/p;/^SESSION_SECRET=/p;/^SETTINGS_ENCRYPTION_KEY=/p' "$WSL_INSTALL_DIR/.env")"
[[ "$wsl_before_secrets" == "$wsl_after_secrets" ]]
grep -q "CREWQUAL_VERSION='v9.8.8'" "$WSL_INSTALL_DIR/.env"
grep -q "CREWQUAL_UPDATER_MODE='manual'" "$WSL_INSTALL_DIR/.env"
grep -q "CREWQUAL_UPDATER_SHARED_SECRET=''" "$WSL_INSTALL_DIR/.env"

WSL_LAN_LOG="$TEST_DIR/wsl-lan.log"
CREWQUAL_TEST_PLATFORM=wsl CREWQUAL_TEST_INSTALL_DIR="$WSL_LAN_INSTALL_DIR" \
  run_installer --version v9.8.7 --network-mode lan --lan-address 192.168.1.30 \
  --port 8083 --non-interactive >"$WSL_LAN_LOG" 2>&1
grep -q "APP_ORIGIN='http://192.168.1.30:8083'" "$WSL_LAN_INSTALL_DIR/.env"
grep -q "APP_BIND='0.0.0.0'" "$WSL_LAN_INSTALL_DIR/.env"
grep -q 'Windows 防火墙允许 TCP 8083' "$WSL_LAN_LOG"

WSL_MISSING_LOG="$TEST_DIR/wsl-docker-missing.log"
if CREWQUAL_TEST_PLATFORM=wsl CREWQUAL_TEST_DOCKER_MISSING=1 \
  CREWQUAL_TEST_INSTALL_DIR="$WSL_FAILURE_DIR" \
  run_installer --install-docker --non-interactive >"$WSL_MISSING_LOG" 2>&1; then
  echo "expected WSL install without Docker CLI to fail" >&2
  exit 1
fi
grep -q 'WSL Integration' "$WSL_MISSING_LOG"
! grep -q '下载 Docker 官方安装脚本' "$WSL_MISSING_LOG"

WSL_DAEMON_LOG="$TEST_DIR/wsl-docker-daemon.log"
if CREWQUAL_TEST_PLATFORM=wsl CREWQUAL_TEST_DOCKER_INFO_FAIL=1 \
  CREWQUAL_TEST_INSTALL_DIR="$WSL_FAILURE_DIR" \
  run_installer --install-docker --non-interactive >"$WSL_DAEMON_LOG" 2>&1; then
  echo "expected WSL install without Docker Desktop daemon to fail" >&2
  exit 1
fi
grep -q '无法连接 Docker Desktop' "$WSL_DAEMON_LOG"
! grep -q '启动 Docker daemon' "$WSL_DAEMON_LOG"

WSL_COMPOSE_LOG="$TEST_DIR/wsl-compose-missing.log"
if CREWQUAL_TEST_PLATFORM=wsl CREWQUAL_TEST_COMPOSE_FAIL=1 \
  CREWQUAL_TEST_INSTALL_DIR="$WSL_FAILURE_DIR" \
  run_installer --install-docker --non-interactive >"$WSL_COMPOSE_LOG" 2>&1; then
  echo "expected WSL install without Compose v2 to fail" >&2
  exit 1
fi
grep -q 'Docker Compose v2 不可用' "$WSL_COMPOSE_LOG"
! grep -q '安装 Docker Compose v2 软件包' "$WSL_COMPOSE_LOG"

CREWQUAL_TEST_INSTALL_DIR="$HTTP_INSTALL_DIR" \
  run_installer --version v9.8.7 --network-mode http --public-address 203.0.113.20 \
  --port 8082 --non-interactive >/dev/null
grep -q "DEPLOYMENT_NETWORK_MODE='http'" "$HTTP_INSTALL_DIR/.env"
grep -q "APP_ORIGIN='http://203.0.113.20:8082'" "$HTTP_INSTALL_DIR/.env"
grep -q "APP_DOMAIN='203.0.113.20'" "$HTTP_INSTALL_DIR/.env"
grep -q "CADDY_SITE_ADDRESS='http://:8082'" "$HTTP_INSTALL_DIR/.env"

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

[[ "$(wc -l <"$UPDATER_VERIFY_LOG")" -ge 1 ]]

echo "install.sh mocked Linux/WSL fresh-install, upgrade, updater-verification, and failure-diagnostic checks passed"
