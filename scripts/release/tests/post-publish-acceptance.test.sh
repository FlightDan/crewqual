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
