#!/usr/bin/env bash
set -Eeuo pipefail

target="${TARGET_TAG:-}"
baseline="${UPGRADE_FROM_TAG:-}"
repo="${GITHUB_REPOSITORY:-FlightDan/crewqual}"
expected_commit="${EXPECTED_COMMIT:-}"
expected_baseline_commit="${EXPECTED_BASELINE_COMMIT:-}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
acceptance_root="/var/lib/crewqual-release-acceptance"
fresh_dir="$acceptance_root/fresh"
upgrade_dir="$acceptance_root/upgrade"
target_updater=""
wrapper_dir=""
server_pid=""

die() { echo "post-publish acceptance: $*" >&2; exit 1; }
channel_for() { [[ "$1" == *-rc.* ]] && printf rc || printf stable; }

pin_acceptance_manifest() {
  local config="${1:-/etc/crewqual-updater/config.json}" pin channel temporary
  pin="https://github.com/$repo/releases/download/$target/update-manifest-v1.json"
  channel="$(sudo jq -er '.channel' "$config")"
  temporary="$(mktemp)"
  chmod 600 "$temporary"
  sudo jq --arg pin "$pin" '.manifestURL = $pin' "$config" > "$temporary"
  sudo install -m 0600 "$temporary" "$config"
  rm -f "$temporary"
  sudo jq -e --arg pin "$pin" --arg channel "$channel" '.manifestURL == $pin and .channel == $channel' "$config" >/dev/null || die "acceptance manifest pin was not retained"
  echo "acceptance manifest pin: $pin (channel=$channel)"
}

install_from_tag() {
  local tag="$1" dir="$2" commit="$3" channel
  [[ "$commit" =~ ^[0-9a-f]{40}$ ]] || die "installer requires validated commit"
  channel="$(channel_for "$tag")"
  local script="$(mktemp)"
  curl -fsSL --retry 3 "https://raw.githubusercontent.com/${repo}/${commit}/install.sh" -o "$script"
  chmod 700 "$script"
  sudo -E CREWQUAL_INSTALL_DIR="$dir" bash "$script" --version "$tag" --channel "$channel" \
    --network-mode lan --lan-address 172.20.0.1 --non-interactive
  rm -f "$script"
}

repair_updater_from_tag() {
  local script before after
  before="$(sudo sha256sum "$upgrade_dir/.env" "$upgrade_dir/compose.yaml" "$upgrade_dir/Caddyfile")"
  script="$(mktemp)"
  curl -fsSL --retry 3 "https://raw.githubusercontent.com/${repo}/${expected_commit}/install.sh" -o "$script"
  chmod 700 "$script"
  sudo -E CREWQUAL_INSTALL_DIR="$upgrade_dir" bash "$script" --version "$target" \
    --channel "$(channel_for "$target")" --repair-updater --non-interactive
  rm -f "$script"
  after="$(sudo sha256sum "$upgrade_dir/.env" "$upgrade_dir/compose.yaml" "$upgrade_dir/Caddyfile")"
  [[ "$before" == "$after" ]] || die "updater repair changed the baseline application configuration"
  local expected_updater_version="${target#v}"
  expected_updater_version="${expected_updater_version%%-rc.*}"
  sudo jq -e --arg version "$expected_updater_version" '.updaterVersion == $version' /etc/crewqual-updater/config.json >/dev/null || die "updater recovery did not install the target capability version"
  echo "upgrade acceptance path: signed updater recovery from $baseline to $target, then application upgrade"
}

image_id_checks() {
  local dir="$1" expected_revision="$2" ref id service native_arch revision
  [[ "$expected_revision" =~ ^[0-9a-f]{40}$ ]] || die "expected image revision must be a validated commit"
  case "$(uname -m)" in x86_64) native_arch=amd64 ;; aarch64|arm64) native_arch=arm64 ;; *) die "unsupported native architecture" ;; esac
  sudo test -s "$dir/.env" || die "missing env file: $dir/.env"
  sudo grep -Eq "^CREWQUAL_WEB_IMAGE='ghcr\.io/flightdan/crewqual-web@sha256:[a-f0-9]{64}'$" "$dir/.env" || die "web image is not a signed digest"
  sudo grep -Eq "^CREWQUAL_RUNTIME_IMAGE='ghcr\.io/flightdan/crewqual-runtime@sha256:[a-f0-9]{64}'$" "$dir/.env" || die "runtime image is not a signed digest"
  for service in web worker; do
    ref="$(sudo sed -n "s/^CREWQUAL_$( [[ "$service" == web ]] && echo WEB || echo RUNTIME )_IMAGE='\([^']*\)'.*/\1/p" "$dir/.env")"
    id="$(sudo docker compose --project-directory "$dir" --env-file "$dir/.env" -f "$dir/compose.yaml" ps -q "$service")"
    [[ -n "$id" ]] || die "missing running container for $service"
    [[ "$(sudo docker image inspect --format '{{.Os}}/{{.Architecture}}' "$ref")" == "linux/$native_arch" ]] || die "image does not match native architecture"
    revision="$(sudo docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$ref")"
    [[ "$revision" == "$expected_revision" ]] || die "image revision does not match the validated release commit"
    [[ "$(sudo docker inspect --format '{{.Image}}' "$id")" == "$(sudo docker image inspect --format '{{.Id}}' "$ref")" ]] || die "container image ID does not match digest reference for $service"
  done
}

# Each request uses a new nonce, including readiness probes and polling.
api_request() {
  local method="$1" path="$2" body="${3:-}" timestamp nonce signature
  timestamp="$(date +%s%3N)"
  nonce="$(openssl rand -hex 16)"
  signature="$(printf '%s' "$timestamp.$nonce.$body" | openssl dgst -sha256 -hmac "$shared" -hex | awk '{print $2}')"
  local response status
  if response="$(curl --fail-with-body --silent --show-error --max-time 15 --unix-socket /run/crewqual-updater/api.sock \
    -X "$method" -H "X-Crewqual-Timestamp: $timestamp" -H "X-Crewqual-Nonce: $nonce" \
    -H "X-Crewqual-Signature: $signature" -H 'Content-Type: application/json' \
    --data-binary "$body" "http://localhost$path")"; then
    printf '%s\n' "$response"
  else
    status=$?
    # Only report the error field, never successful payloads or signed URLs.
    jq -c '.error | select(type == "string") | gsub("https?://[^ ]+"; "[redacted URL]") | .[0:400]' <<<"$response" >&2 || true
    return "$status"
  fi
}

wait_api() {
  local attempt
  for ((attempt=0; attempt<30; attempt++)); do
    if api_request GET /v1/status 2>/dev/null | jq -e '.data.mode == "managed"' >/dev/null; then return; fi
    sleep 1
  done
  die "updater API did not become ready"
}

request_install() {
  local response
  response="$(api_request POST /v1/install "$(jq -nc --arg version "$target" '{version:$version,actorId:"release-acceptance",actorName:"release-acceptance"}')")" || die "install request failed"
  jq -er --arg target "$target" '.data.job | select(.requestedVersion == $target) | .id | select(type == "string" and length > 0)' <<<"$response" || die "install response lacks the requested job"
}

wait_job() {
  local job_id="$1" expected="$2" current="$3" status phase attempt
  for ((attempt=0; attempt<${ACCEPTANCE_POLL_ATTEMPTS:-180}; attempt++)); do
    status="$(api_request GET /v1/status)" || die "job status request failed"
    jq -e --arg id "$job_id" --arg target "$target" '.data.job.id == $id and .data.job.requestedVersion == $target' <<<"$status" >/dev/null || die "job ID or requested version mismatch"
    phase="$(jq -er '.data.job.phase' <<<"$status")" || die "missing job phase"
    case "$phase" in
      SUCCEEDED|FAILED|ROLLED_BACK|NEEDS_MANUAL_RECOVERY)
        [[ "$phase" == "$expected" ]] || die "job $job_id ended as $phase; expected $expected"
        jq -e --arg current "$current" '.data.currentVersion == $current and (.data.job.completedAt | type == "string" and length > 0)' <<<"$status" >/dev/null || die "terminal job has wrong current version or no completion timestamp"
        if [[ "$expected" == FAILED ]]; then
          jq -e '.data.job.errorCode == "RESTART_FAILED"' <<<"$status" >/dev/null || die "injected job failed for an unexpected reason"
        fi
        return 0 ;;
    esac
    sleep "${ACCEPTANCE_POLL_INTERVAL:-2}"
  done
  die "job $job_id timed out before $expected"
}

compose_upgrade() {
  sudo docker compose --project-directory "$upgrade_dir" --env-file "$upgrade_dir/.env" -f "$upgrade_dir/compose.yaml" "$@"
}

bootstrap_acceptance_admin() {
  local email password totp_secret
  email='release-acceptance@example.invalid'
  password="$(openssl rand -base64 32 | tr -d '\n')"
  totp_secret="$(openssl rand 20 | base32 | tr -d '=\n')"
  printf '%s\n' "$email" "$password" "$totp_secret" | \
    compose_upgrade run --rm --no-deps -T --entrypoint /bin/sh bootstrap -c \
      'IFS= read -r INITIAL_ADMIN_EMAIL &&
       IFS= read -r INITIAL_ADMIN_PASSWORD &&
       IFS= read -r INITIAL_ADMIN_TOTP_SECRET &&
       export INITIAL_ADMIN_EMAIL INITIAL_ADMIN_PASSWORD INITIAL_ADMIN_TOTP_SECRET &&
       exec node scripts/container-entrypoint.mjs bootstrap' >/dev/null
}

admin_fingerprint() {
  compose_upgrade exec -T postgres psql -U crewqual -d crewqual -At -v ON_ERROR_STOP=1 -c \
    'SELECT md5(id::text || chr(58) || "passwordHash") FROM "AdminUser" ORDER BY "createdAt" LIMIT 1'
}

stop_test_server() {
  if [[ -n "${server_pid:-}" ]]; then
    local privileged_pid=""
    if [[ -s "$wrapper_dir/server.pid" ]]; then
      privileged_pid="$(cat "$wrapper_dir/server.pid")"
      sudo kill -TERM "$privileged_pid" 2>/dev/null || true
    fi
    for _ in {1..30}; do
      [[ -n "$privileged_pid" ]] || break
      sudo kill -0 "$privileged_pid" 2>/dev/null || break
      sleep 1
    done
    if [[ -n "$privileged_pid" ]] && sudo kill -0 "$privileged_pid" 2>/dev/null; then
      sudo kill -KILL "$privileged_pid" 2>/dev/null || true
    fi
    wait "$server_pid" 2>/dev/null || true
    server_pid=''
  fi
}

cleanup_acceptance() {
  local exit_code="$?"
  stop_test_server
  if ((exit_code != 0)) && [[ -n "$wrapper_dir" && -f "$wrapper_dir/server.log" ]]; then
    echo "==> updater test server log (last 120 lines)" >&2
    tail -n 120 "$wrapper_dir/server.log" >&2 || true
  fi
  [[ -z "$wrapper_dir" ]] || sudo rm -rf -- "$wrapper_dir"
  [[ -z "$target_updater" ]] || sudo rm -f -- "$target_updater"
  return "$exit_code"
}

# Sourceable helpers support fixture tests without touching Docker or the host.
if [[ "${BASH_SOURCE[0]}" != "$0" ]]; then return; fi
command -v jq >/dev/null || die "jq is required"
[[ "${UPGRADE_FROM_TAG+x}" == x ]] || die "UPGRADE_FROM_TAG must be explicit (empty for the first release)"
[[ -n "$target" ]] || die "TARGET_TAG is required"
[[ "$expected_commit" =~ ^[0-9a-f]{40}$ ]] || die "EXPECTED_COMMIT must be the validated release commit"
if [[ -n "$baseline" ]]; then
  [[ "$expected_baseline_commit" =~ ^[0-9a-f]{40}$ ]] ||
    die "EXPECTED_BASELINE_COMMIT must be the validated baseline commit"
else
  [[ -z "$expected_baseline_commit" ]] || die "EXPECTED_BASELINE_COMMIT must be empty for a fresh install"
fi
profile=final
[[ "$target" == *-rc.* ]] && profile=rc
acceptance_scope="${RELEASE_ACCEPTANCE_SCOPE:-}"
[[ -n "$acceptance_scope" ]] || die "RELEASE_ACCEPTANCE_SCOPE must be explicit"
case "${BASELINE_KIND:-stable-upgrade}" in
  rc-promotion)
    [[ "$expected_baseline_commit" == "$expected_commit" && "$expected_commit" =~ ^[0-9a-f]{40}$ ]] || die "arm64 promotion must use the final target commit"
    [[ "${EXPECTED_ARCH:-}" == arm64 && "$baseline" == "${RELEASE_ARM64_BOOTSTRAP_FROM_TAG:-}" && -n "$baseline" ]] || die "invalid arm64 promotion baseline"
    bash "$script_dir/validate-release-inputs.sh" "$target" "$profile" "$acceptance_scope" "${RELEASE_UPGRADE_FROM_TAG:-}" "$baseline" >/dev/null || die "invalid arm64 promotion inputs"
    ;;
  stable-upgrade)
    bash "$script_dir/validate-release-inputs.sh" "$target" "$profile" "$acceptance_scope" "$baseline" >/dev/null || die "invalid target/baseline release inputs"
    ;;
  *) die "invalid baseline kind" ;;
esac
echo "baseline acceptance: kind=${BASELINE_KIND:-stable-upgrade} tag=$baseline target=$target"
trap cleanup_acceptance EXIT

sudo systemctl stop crewqual-caddy-recovery.service crewqual-updater.service crewqual-updater.socket >/dev/null 2>&1 || true
for stale_dir in "$fresh_dir" "$upgrade_dir"; do
  sudo docker compose --project-directory "$stale_dir" --env-file "$stale_dir/.env" \
    -f "$stale_dir/compose.yaml" down -v --remove-orphans >/dev/null 2>&1 || true
done
sudo rm -rf -- "$fresh_dir" "$upgrade_dir" /var/lib/crewqual-updater
sudo rm -f /run/crewqual-updater/api.sock
install_from_tag "$target" "$fresh_dir" "$expected_commit"
image_id_checks "$fresh_dir" "$expected_commit"
target_updater="$(mktemp "${RUNNER_TEMP:-/tmp}/crewqual-target-updater.XXXXXX")"
# The target installer has already verified this native binary against the
# signed manifest and SHA256SUMS. Preserve it for entrance reconciliation even
# when the upgrade baseline predates the reconcile-caddy subcommand.
sudo install -m 0700 /usr/local/libexec/crewqual-updater "$target_updater"
sudo grep -q '^S3_ENDPOINT=http://minio:9000$' "$fresh_dir/.env" || die "builtin storage endpoint is not internal-only"
sudo grep -q "APP_ORIGIN='http://172.20.0.1:" "$fresh_dir/.env" || die "LAN mode exposed a non-private origin"
bad_env="$(mktemp)"
sudo sed "s/^SESSION_SECRET=.*/SESSION_SECRET=''/" "$fresh_dir/.env" >"$bad_env"
if sudo docker compose --project-directory "$fresh_dir" --env-file "$bad_env" -f "$fresh_dir/compose.yaml" config --quiet >/dev/null 2>&1; then
  rm -f "$bad_env"
  die "Compose accepted an empty production secret"
fi
rm -f "$bad_env"
# A managed install owns one host updater and socket. Stop the fresh-install
# instance before removing its files so the baseline install starts a new
# process with its own config and shared secret.
sudo systemctl stop crewqual-caddy-recovery.service crewqual-updater.service crewqual-updater.socket
sudo docker compose --project-directory "$fresh_dir" --env-file "$fresh_dir/.env" \
  -f "$fresh_dir/compose.yaml" down -v --remove-orphans >/dev/null 2>&1 || true
sudo rm -rf -- "$fresh_dir" /var/lib/crewqual-updater
sudo rm -f /run/crewqual-updater/api.sock

if [[ -z "$baseline" ]]; then
  echo "first-release fresh-install acceptance passed"
  exit 0
fi

install_from_tag "$baseline" "$upgrade_dir" "$expected_baseline_commit"
image_id_checks "$upgrade_dir" "$expected_baseline_commit"
# The production installer intentionally leaves a new deployment in web-setup
# mode. Seed the disposable acceptance database through the real production
# bootstrap so the database verifier can prove the complete initialized state
# survives backup, rollback, and retry. Keep these credentials out of .env.
bootstrap_acceptance_admin
compose_upgrade --profile ops run --rm --no-deps ops >/dev/null
baseline_admin_fingerprint="$(admin_fingerprint)"
[[ "$baseline_admin_fingerprint" =~ ^[0-9a-f]{32}$ ]] || die "acceptance bootstrap did not create one verifiable admin"
repair_updater_from_tag
pin_acceptance_manifest
image_id_checks "$upgrade_dir" "$expected_baseline_commit"
shared="$(sudo sed -n "s/^CREWQUAL_UPDATER_SHARED_SECRET='\([^']*\)'/\1/p" "$upgrade_dir/.env")"
[[ -n "$shared" ]] || die "missing updater shared secret"

wrapper_dir="$(mktemp -d)"
# Preserve baseline files without printing their contents (the env contains secrets).
for file in .env compose.yaml Caddyfile; do sudo cp "$upgrade_dir/$file" "$wrapper_dir/baseline-$file"; done
# A disposable SQL sentinel proves rollback restored data, not just managed files.
compose_upgrade exec -T postgres psql -U crewqual -d crewqual -v ON_ERROR_STOP=1 -c \
  "CREATE TABLE public.release_acceptance_sentinel (value text PRIMARY KEY); INSERT INTO public.release_acceptance_sentinel VALUES ('baseline');" >/dev/null

cat >"$wrapper_dir/docker" <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
marker_dir="$(dirname "$0")"
touch "$marker_dir/invoked"
args=" $* "
if [[ "${1:-}" == compose && "$args" == *" up "* && "$args" == *" web "* && "$args" == *" worker "* && ! -e "$marker_dir/restart-seen" ]]; then
  touch "$marker_dir/restart-seen"
  # Mutate after the updater backup: successful recovery must undo this change.
  "$ACCEPTANCE_REAL_DOCKER" compose --project-directory "$ACCEPTANCE_UPGRADE_DIR" --env-file "$ACCEPTANCE_UPGRADE_DIR/.env" -f "$ACCEPTANCE_UPGRADE_DIR/compose.yaml" exec -T postgres psql -U crewqual -d crewqual -v ON_ERROR_STOP=1 -c "UPDATE public.release_acceptance_sentinel SET value = 'mutated';" >/dev/null
  touch "$marker_dir/data-mutated"
  echo 'intentional one-shot restart failure' >&2
  exit 17
fi
exec "$ACCEPTANCE_REAL_DOCKER" "$@"
EOF
chmod 700 "$wrapper_dir/docker"
# Stop socket activation too, so readiness cannot accidentally reach another process.
sudo systemctl stop crewqual-updater.service crewqual-updater.socket
sudo rm -f /run/crewqual-updater/api.sock
sudo env PATH="$wrapper_dir:$PATH" ACCEPTANCE_REAL_DOCKER="$(command -v docker)" ACCEPTANCE_UPGRADE_DIR="$upgrade_dir" \
  bash -c 'echo $$ > "$1/server.pid"; exec /usr/local/libexec/crewqual-updater serve' bash "$wrapper_dir" \
  >"$wrapper_dir/server.log" 2>&1 &
server_pid=$!
wait_api
api_request POST /v1/check >/dev/null
failed_job="$(request_install)"
wait_job "$failed_job" FAILED "$baseline"
[[ -f "$wrapper_dir/invoked" && -f "$wrapper_dir/restart-seen" && -f "$wrapper_dir/data-mutated" ]] || die "failure injection did not run completely"
for file in .env compose.yaml Caddyfile; do sudo cmp -s "$wrapper_dir/baseline-$file" "$upgrade_dir/$file" || die "rollback changed $file"; done
[[ "$(compose_upgrade exec -T postgres psql -U crewqual -d crewqual -Atc 'SELECT value FROM public.release_acceptance_sentinel')" == baseline ]] || die "rollback did not restore database sentinel"
[[ "$(admin_fingerprint)" == "$baseline_admin_fingerprint" ]] || die "rollback did not restore the baseline admin"
image_id_checks "$upgrade_dir" "$expected_baseline_commit"
sudo "$target_updater" reconcile-caddy --timeout 60s
stop_test_server
sudo systemctl start crewqual-updater.socket crewqual-updater.service
wait_api
api_request POST /v1/check >/dev/null
retry_job="$(request_install)"
[[ "$retry_job" != "$failed_job" ]] || die "retry reused failed job ID"
wait_job "$retry_job" SUCCEEDED "$target"
sudo grep -qx "CREWQUAL_VERSION='$target'" "$upgrade_dir/.env" || die "retry did not reach target"
[[ "$(admin_fingerprint)" == "$baseline_admin_fingerprint" ]] || die "retry changed the baseline admin"
image_id_checks "$upgrade_dir" "$expected_commit"
sudo "$target_updater" reconcile-caddy --timeout 60s
compose_upgrade run --rm --no-deps migrate
compose_upgrade run --rm --no-deps bootstrap
[[ "$(admin_fingerprint)" == "$baseline_admin_fingerprint" ]] || die "idempotence check changed the baseline admin"
compose_upgrade --profile ops run --rm --no-deps ops
compose_upgrade exec -T postgres psql -U crewqual -d crewqual -v ON_ERROR_STOP=1 -c 'DROP TABLE public.release_acceptance_sentinel' >/dev/null
echo "post-publish install, digest, upgrade, rollback, retry, db-check and idempotence acceptance passed"
