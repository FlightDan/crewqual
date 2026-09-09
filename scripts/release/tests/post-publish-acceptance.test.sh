#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname "$0")/../post-publish-acceptance.sh"
post_source="$(cat "$(dirname "$0")/../post-publish-acceptance.sh")"
[[ "$acceptance_root" == /var/lib/crewqual-release-acceptance ]]
[[ "$fresh_dir" == "$acceptance_root/fresh" ]]
[[ "$upgrade_dir" == "$acceptance_root/upgrade" ]]
grep -q 'validate-release-inputs.sh.*"\$acceptance_scope"' <<<"$post_source"
! grep -q 'validate-release-inputs.sh.* local ' <<<"$post_source"
grep -q 'signed manifest and SHA256SUMS' <<<"$post_source"
grep -q '"\$target_updater" reconcile-caddy' <<<"$post_source"
! grep -q '/usr/local/libexec/crewqual-updater reconcile-caddy' <<<"$post_source"
grep -q 'tail -n 120 "\$wrapper_dir/server.log"' <<<"$post_source"
# Exercise the real scope/input gate before any privileged host mutation.
scope_gate="$(awk '/^profile=final$/ {copy=1} copy && /^trap cleanup_acceptance EXIT$/ {exit} copy {print}' <<<"$post_source")"
for scope in local isolated full missing invalid; do
  result=0
  (
    target=v1.0.6
    baseline=v1.0.5
    if [[ "$scope" == missing ]]; then unset RELEASE_ACCEPTANCE_SCOPE; else export RELEASE_ACCEPTANCE_SCOPE="$scope"; fi
    eval "$scope_gate"
  ) >/dev/null 2>&1 || result=$?
  if [[ "$scope" == isolated || "$scope" == full ]]; then
    [[ "$result" == 0 ]]
  else
    [[ "$result" != 0 ]]
  fi
done
# RC promotion is only valid on arm64 with the separately validated stable baseline.
for arch in amd64 arm64; do
  result=0
  (
    target=v1.0.6 baseline=v1.0.6-rc.14
    expected_commit="$(printf 'a%.0s' {1..40})" expected_baseline_commit="$(printf 'a%.0s' {1..40})"
    export BASELINE_KIND=rc-promotion EXPECTED_ARCH="$arch" RELEASE_ACCEPTANCE_SCOPE=isolated
    export RELEASE_UPGRADE_FROM_TAG=v1.0.4 RELEASE_ARM64_BOOTSTRAP_FROM_TAG=v1.0.6-rc.14
    eval "$scope_gate"
  ) >/dev/null 2>&1 || result=$?
  if [[ "$arch" == arm64 ]]; then [[ "$result" == 0 ]]; else [[ "$result" != 0 ]]; fi
done
# A same-version RC from a different commit cannot claim final promotion coverage.
if (
  target=v1.0.6 baseline=v1.0.6-rc.14
  expected_commit="$(printf 'a%.0s' {1..40})" expected_baseline_commit="$(printf 'b%.0s' {1..40})"
  export BASELINE_KIND=rc-promotion EXPECTED_ARCH=arm64 RELEASE_ACCEPTANCE_SCOPE=isolated
  export RELEASE_UPGRADE_FROM_TAG=v1.0.4 RELEASE_ARM64_BOOTSTRAP_FROM_TAG=v1.0.6-rc.14
  eval "$scope_gate"
) >/dev/null 2>&1; then echo 'mismatched promotion commit accepted' >&2; exit 1; fi
# Fetch installer source by validated immutable commit, retaining version/channel args.
installer_calls="$(mktemp)"
curl() { printf '%s\n' "$@" > "$installer_calls"; }
sudo() { printf '%s\n' "$@" >> "$installer_calls"; }
installer_commit="$(printf 'a%.0s' {1..40})"
install_from_tag v1.0.6 /fixture "$installer_commit"
grep -qx "https://raw.githubusercontent.com/FlightDan/crewqual/$installer_commit/install.sh" "$installer_calls"
grep -qx 'v1.0.6' "$installer_calls"
grep -qx 'stable' "$installer_calls"
if (install_from_tag v1.0.6 /fixture v1.0.6) >/dev/null 2>&1; then echo 'mutable installer source accepted' >&2; exit 1; fi
rm -f "$installer_calls"
unset -f curl sudo
# Pin exact final manifest without changing either stable or RC baseline channel.
sudo() { "$@"; }
pin_config="$(mktemp)"
for pin_channel in stable rc; do
  printf '{"channel":"%s","sharedSecret":"fixture"}\n' "$pin_channel" > "$pin_config"
  target=v1.0.6
  pin_final_acceptance_manifest "$pin_config"
  jq -e --arg channel "$pin_channel" '.channel == $channel and .sharedSecret == "fixture" and .manifestURL == "https://github.com/FlightDan/crewqual/releases/download/v1.0.6/update-manifest-v1.json"' "$pin_config" >/dev/null
  [[ "$(stat -c %a "$pin_config")" == 600 ]]
done
printf '{"channel":"rc"}' > "$pin_config"
target=v1.0.6-rc.15
pin_final_acceptance_manifest "$pin_config"
[[ "$(cat "$pin_config")" == '{"channel":"rc"}' ]]
rm -f "$pin_config"
unset -f sudo
bootstrap_call_file="$(mktemp)"
bootstrap_stdin_file="$(mktemp)"
openssl() {
  if [[ "$*" == 'rand -base64 32' ]]; then
    printf 'fixture-password-with-more-than-12-characters\n'
  elif [[ "$*" == 'rand 20' ]]; then
    printf 'fixture-random-bytes'
  else
    return 2
  fi
}
base32() { cat >/dev/null; printf 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP\n'; }
compose_upgrade() {
  cat >"$bootstrap_stdin_file"
  printf '%q\n' "$@" >"$bootstrap_call_file"
}
bootstrap_acceptance_admin
mapfile -t bootstrap_args <"$bootstrap_call_file"
[[ "${#bootstrap_args[@]}" == 9 ]]
[[ "${bootstrap_args[*]:0:8}" == 'run --rm --no-deps -T --entrypoint /bin/sh bootstrap -c' ]]
[[ "${bootstrap_args[8]}" == *'read -r INITIAL_ADMIN_EMAIL'* ]]
[[ "${bootstrap_args[8]}" == *'exec node scripts/container-entrypoint.mjs bootstrap'* ]]
[[ "$(cat "$bootstrap_stdin_file")" == $'release-acceptance@example.invalid\nfixture-password-with-more-than-12-characters\nJBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP' ]]
! grep -q 'fixture-password' "$bootstrap_call_file"
compose_upgrade() { cat >/dev/null; return 17; }
if bootstrap_acceptance_admin; then echo 'bootstrap failure was ignored' >&2; exit 1; fi
bootstrap_call_line="$(grep -n '^bootstrap_acceptance_admin$' <<<"$post_source" | cut -d: -f1)"
sentinel_line="$(grep -n 'CREATE TABLE public.release_acceptance_sentinel' <<<"$post_source" | cut -d: -f1)"
[[ "$bootstrap_call_line" -lt "$sentinel_line" ]]
final_bootstrap_line="$(grep -n '^compose_upgrade run --rm --no-deps bootstrap$' <<<"$post_source" | cut -d: -f1)"
final_ops_line="$(grep -n '^compose_upgrade --profile ops run --rm --no-deps ops$' <<<"$post_source" | tail -1 | cut -d: -f1)"
[[ "$final_bootstrap_line" -lt "$final_ops_line" ]]
rm -f "$bootstrap_call_file" "$bootstrap_stdin_file"
unset -f openssl base32 compose_upgrade
target=v1.2.0-rc.2
ACCEPTANCE_POLL_ATTEMPTS=2
ACCEPTANCE_POLL_INTERVAL=0
fixture=''
api_request() { printf '%s\n' "$fixture"; }
expect_failure() {
  if ( "$@" ) >/dev/null 2>&1; then echo "unexpected pass: $*" >&2; exit 1; fi
}

# Baseline and target images can legitimately name different commits. Exercise
# the parameterized revision check without Docker or privileged host access.
fixture_revision="$(printf 'a%.0s' {1..40})"
uname() { printf 'x86_64\n'; }
sudo() {
  if [[ "$1" == test || "$1" == grep ]]; then return 0; fi
  if [[ "$1" == sed ]]; then
    printf 'ghcr.io/flightdan/crewqual-web@sha256:%s\n' "$(printf 'b%.0s' {1..64})"
    return 0
  fi
  if [[ "$1 $2 $3" == 'docker compose --project-directory' ]]; then
    printf 'fixture-container\n'
    return 0
  fi
  if [[ "$1 $2 $3" == 'docker image inspect' ]]; then
    case "$5" in
      '{{.Os}}/{{.Architecture}}') printf 'linux/amd64\n' ;;
      '{{index .Config.Labels "org.opencontainers.image.revision"}}') printf '%s\n' "$fixture_revision" ;;
      '{{.Id}}') printf 'sha256:fixture-image\n' ;;
      *) return 2 ;;
    esac
    return 0
  fi
  if [[ "$1 $2" == 'docker inspect' ]]; then
    printf 'sha256:fixture-image\n'
    return 0
  fi
  return 2
}
image_id_checks /fixture "$fixture_revision"
expect_failure image_id_checks /fixture "$(printf 'c%.0s' {1..40})"
unset -f sudo uname

status_fixture() {
  fixture="$(jq -nc --arg id "$1" --arg phase "$2" --arg current "$3" --arg requested "${4:-$target}" --arg code "${5:-}" '{data:{currentVersion:$current,job:{id:$id,phase:$phase,requestedVersion:$requested,errorCode:$code,completedAt:"2026-09-09T00:00:00Z"}}}')"
}
status_fixture retry SUCCEEDED "$target"
wait_job retry SUCCEEDED "$target"
expect_failure wait_job wrong SUCCEEDED "$target"
status_fixture retry SUCCEEDED v1.1.0
expect_failure wait_job retry SUCCEEDED "$target"
status_fixture retry SUCCEEDED "$target" v1.2.0-rc.1
expect_failure wait_job retry SUCCEEDED "$target"
for phase in FAILED ROLLED_BACK NEEDS_MANUAL_RECOVERY; do
  status_fixture retry "$phase" "$target"
  expect_failure wait_job retry SUCCEEDED "$target"
done
status_fixture retry RESTARTING "$target"
expect_failure wait_job retry SUCCEEDED "$target"
status_fixture injected FAILED v1.2.0-rc.1 "$target" RESTART_FAILED
wait_job injected FAILED v1.2.0-rc.1
status_fixture injected FAILED v1.2.0-rc.1 "$target" MIGRATION_FAILED
expect_failure wait_job injected FAILED v1.2.0-rc.1
fixture='{"data":{"job":{"id":"accepted","requestedVersion":"v1.2.0-rc.2"}}}'
[[ "$(request_install)" == accepted ]]
fixture='{"data":{"job":{"id":"accepted","requestedVersion":"v1.2.0-rc.1"}}}'
expect_failure request_install
fixture='{}'
expect_failure request_install
expect_failure wait_job retry SUCCEEDED "$target"
echo 'post-publish acceptance fixtures passed'
# Execute the production wrapper against a fake Docker executable: the first
# restart mutates the sentinel and fails, while rollback's restart can run.
fixture_dir="$(mktemp -d)"
trap 'rm -rf "$fixture_dir"' EXIT
awk '/^cat >"\$wrapper_dir\/docker" <<\x27EOF\x27$/ {copy=1; next} copy && /^EOF$/ {exit} copy {print}' "$(dirname "$0")/../post-publish-acceptance.sh" >"$fixture_dir/docker"
cat >"$fixture_dir/real-docker" <<'DOCKER'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$ACCEPTANCE_UPGRADE_DIR/calls"
DOCKER
chmod +x "$fixture_dir/docker" "$fixture_dir/real-docker"
export ACCEPTANCE_REAL_DOCKER="$fixture_dir/real-docker" ACCEPTANCE_UPGRADE_DIR="$fixture_dir"
exit_code=0
"$fixture_dir/docker" compose up -d --no-deps web worker 2>/dev/null || exit_code=$?
[[ "$exit_code" == 17 ]]
[[ -f "$fixture_dir/invoked" && -f "$fixture_dir/restart-seen" && -f "$fixture_dir/data-mutated" ]]
grep -q 'UPDATE public.release_acceptance_sentinel' "$fixture_dir/calls"
"$fixture_dir/docker" compose up -d --no-deps web worker caddy
[[ "$(wc -l <"$fixture_dir/calls")" == 2 ]]
echo 'one-shot failure injection fixture passed'
