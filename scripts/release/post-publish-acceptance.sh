#!/usr/bin/env bash
set -Eeuo pipefail

target="${TARGET_TAG:-}"
baseline="${UPGRADE_FROM_TAG:-}"
repo="${GITHUB_REPOSITORY:-FlightDan/crewqual}"
fresh_dir="/opt/crewqual-acceptance-fresh"
upgrade_dir="/opt/crewqual-acceptance-upgrade"

die() { echo "post-publish acceptance: $*" >&2; exit 1; }
version_parts() {
  [[ "$1" =~ ^v([0-9]+)\.([0-9]+)\.([0-9]+)(-rc\.([0-9]+))?$ ]] || return 1
  printf '%d %d %d %d %d\n' "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}" "${BASH_REMATCH[3]}" "${BASH_REMATCH[5]:-999999999}"
}
compare_version() {
  local left right i
  read -r -a left <<<"$(version_parts "$1")"
  read -r -a right <<<"$(version_parts "$2")"
  for i in 0 1 2 3; do
    ((left[i] < right[i])) && { echo -1; return; }
    ((left[i] > right[i])) && { echo 1; return; }
  done
  echo 0
}
channel_for() { [[ "$1" == *-rc.* ]] && printf rc || printf stable; }

[[ -n "$target" && -n "$baseline" ]] || die "TARGET_TAG and explicit UPGRADE_FROM_TAG are required"
version_parts "$target" >/dev/null || die "invalid target tag: $target"
version_parts "$baseline" >/dev/null || die "invalid upgrade baseline tag: $baseline"
[[ "$(compare_version "$baseline" "$target")" == -1 ]] || die "upgrade baseline must be lower than target"
if [[ "$target" == *-rc.* ]]; then
  [[ "$baseline" == *-rc.* ]] || die "RC acceptance requires an RC baseline"
fi

install_from_tag() {
  local tag="$1" dir="$2" channel
  channel="$(channel_for "$tag")"
  local script="$(mktemp)"
  curl -fsSL --retry 3 "https://raw.githubusercontent.com/${repo}/${tag}/install.sh" -o "$script"
  chmod 700 "$script"
  sudo -E CREWQUAL_INSTALL_DIR="$dir" bash "$script" --version "$tag" --channel "$channel" \
    --network-mode lan --lan-address 172.20.0.1 --non-interactive
  rm -f "$script"
}

image_id_checks() {
  local dir="$1" ref id service
  [[ -s "$dir/.env" ]] || die "missing env file: $dir/.env"
  grep -Eq "^CREWQUAL_WEB_IMAGE='ghcr\.io/flightdan/crewqual-web@sha256:[a-f0-9]{64}'$" "$dir/.env" || die "web image is not a signed digest"
  grep -Eq "^CREWQUAL_RUNTIME_IMAGE='ghcr\.io/flightdan/crewqual-runtime@sha256:[a-f0-9]{64}'$" "$dir/.env" || die "runtime image is not a signed digest"
  for service in web worker; do
    ref="$(sed -n "s/^CREWQUAL_$( [[ "$service" == web ]] && echo WEB || echo RUNTIME )_IMAGE='\([^']*\)'.*/\1/p" "$dir/.env")"
    id="$(sudo docker compose --project-directory "$dir" --env-file "$dir/.env" -f "$dir/compose.yaml" ps -q "$service")"
    [[ -n "$id" ]] || die "missing running container for $service"
    [[ "$(sudo docker inspect --format '{{.Image}}' "$id")" == "$(sudo docker image inspect --format '{{.Id}}' "$ref")" ]] || die "container image ID does not match digest reference for $service"
  done
}

sudo docker compose --project-directory "$fresh_dir" --env-file "$fresh_dir/.env" -f "$fresh_dir/compose.yaml" down >/dev/null 2>&1 || true
sudo rm -rf -- "$fresh_dir" "$upgrade_dir"
install_from_tag "$target" "$fresh_dir"
image_id_checks "$fresh_dir"
grep -q '^S3_ENDPOINT=http://minio:9000$' "$fresh_dir/.env" || die "builtin storage endpoint is not internal-only"
grep -q "APP_ORIGIN='http://172.20.0.1:" "$fresh_dir/.env" || die "LAN mode exposed a non-private origin"
bad_env="$(mktemp)"
sed "s/^SESSION_SECRET=.*/SESSION_SECRET=''/" "$fresh_dir/.env" >"$bad_env"
if sudo docker compose --project-directory "$fresh_dir" --env-file "$bad_env" -f "$fresh_dir/compose.yaml" config --quiet >/dev/null 2>&1; then
  rm -f "$bad_env"
  die "Compose accepted an empty production secret"
fi
rm -f "$bad_env"
sudo docker compose --project-directory "$fresh_dir" --env-file "$fresh_dir/.env" -f "$fresh_dir/compose.yaml" down >/dev/null 2>&1 || true
sudo rm -rf -- "$fresh_dir"

# The first repaired RC is a bootstrap release by design. It still requires
# an explicit lower tag in workflow input, but that historical RC is not a
# usable upgrade baseline because it has no complete signed asset set.
if [[ "$target" == *-rc.2 ]]; then
  echo "bootstrap RC fresh-install acceptance passed"
  exit 0
fi

install_from_tag "$baseline" "$upgrade_dir"
image_id_checks "$upgrade_dir"
sudo /usr/local/libexec/crewqual-updater check

body='{"version":"'"$target"'","actorId":"release-acceptance","actorName":"release-acceptance"}'
timestamp="$(date +%s%3N)"
nonce="$(openssl rand -hex 16)"
shared="$(sed -n "s/^CREWQUAL_UPDATER_SHARED_SECRET='\([^']*\)'/\1/p" "$upgrade_dir/.env")"
signature="$(printf '%s' "$timestamp.$nonce.$body" | openssl dgst -sha256 -hmac "$shared" -hex | awk '{print $2}')"
request_install() {
  curl --fail --silent --show-error --unix-socket /run/crewqual-updater/api.sock \
    -H "X-Crewqual-Timestamp: $timestamp" -H "X-Crewqual-Nonce: $nonce" \
    -H "X-Crewqual-Signature: $signature" -H 'Content-Type: application/json' \
    -d "$body" http://localhost/v1/install
}

# Run the managed updater through a one-shot Docker wrapper. The wrapper fails
# only the first web/worker restart, so a successful rollback is observable.
wrapper_dir="$(mktemp -d)"
cat >"$wrapper_dir/docker" <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
if [[ "${1:-}" == "compose" && "$*" == *" up "* && "$*" == *" web "* && "$*" == *" worker"* && ! -e /tmp/crewqual-acceptance-restart-seen ]]; then
  touch /tmp/crewqual-acceptance-restart-seen
  echo 'intentional one-shot restart failure' >&2
  exit 17
fi
exec /usr/bin/docker "$@"
EOF
chmod 700 "$wrapper_dir/docker"
sudo systemctl stop crewqual-updater.service
sudo rm -f /tmp/crewqual-acceptance-restart-seen
PATH="$wrapper_dir:$PATH" sudo -E /usr/local/libexec/crewqual-updater serve >/tmp/crewqual-updater-acceptance.log 2>&1 &
server_pid=$!
trap 'kill "$server_pid" 2>/dev/null || true; rm -rf "$wrapper_dir"' EXIT
for _ in $(seq 1 30); do [[ -S /run/crewqual-updater/api.sock ]] && break; sleep 1; done
request_install >/dev/null
for _ in $(seq 1 180); do
  status="$(sudo /usr/local/libexec/crewqual-updater status 2>/dev/null || true)"
  grep -q 'ROLLED_BACK' <<<"$status" && break
  sleep 2
done
grep -q "CREWQUAL_VERSION='$baseline'" "$upgrade_dir/.env" || die "failed update did not roll back env"
grep -q 'ROLLED_BACK' <<<"$status" || die "rollback was not observed"
kill "$server_pid" 2>/dev/null || true
sudo systemctl start crewqual-updater.service
rm -f /tmp/crewqual-acceptance-restart-seen
sudo /usr/local/libexec/crewqual-updater check
timestamp="$(date +%s%3N)"; nonce="$(openssl rand -hex 16)"
signature="$(printf '%s' "$timestamp.$nonce.$body" | openssl dgst -sha256 -hmac "$shared" -hex | awk '{print $2}')"
request_install >/dev/null
for _ in $(seq 1 180); do
  status="$(sudo /usr/local/libexec/crewqual-updater status 2>/dev/null || true)"
  grep -q 'SUCCEEDED' <<<"$status" && break
  sleep 2
done
grep -q "CREWQUAL_VERSION='$target'" "$upgrade_dir/.env" || die "retry did not reach target"
image_id_checks "$upgrade_dir"
sudo docker compose --project-directory "$upgrade_dir" --env-file "$upgrade_dir/.env" -f "$upgrade_dir/compose.yaml" --profile ops run --rm --no-deps ops
sudo docker compose --project-directory "$upgrade_dir" --env-file "$upgrade_dir/.env" -f "$upgrade_dir/compose.yaml" run --rm --no-deps migrate
sudo docker compose --project-directory "$upgrade_dir" --env-file "$upgrade_dir/.env" -f "$upgrade_dir/compose.yaml" run --rm --no-deps bootstrap
echo "post-publish install, digest, upgrade, rollback, retry, db-check and idempotence acceptance passed"
