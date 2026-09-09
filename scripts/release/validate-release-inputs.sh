#!/usr/bin/env bash
# Source-safe, dependency-free input validation. Success stdout is fresh or upgrade.
# The fourth argument is required; an explicitly empty baseline means fresh install.
release_input_error() {
  printf 'release inputs: %s\n' "$*" >&2
  return 1
}

release_version_parts() {
  local pattern='^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-rc\.(0|[1-9][0-9]*))?$'
  [[ "$1" =~ $pattern ]] || return 1
  printf '%s %s %s %s\n' "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}" "${BASH_REMATCH[3]}" "${BASH_REMATCH[5]:-0}"
}

release_version_is_lower() {
  local LC_ALL=C i
  local -a left right
  read -r -a left <<<"$(release_version_parts "$1")"
  read -r -a right <<<"$(release_version_parts "$2")"
  # Compare decimal lengths then lexically, avoiding shell integer overflow.
  for i in 0 1 2 3; do
    ((${#left[i]} < ${#right[i]})) && return 0
    ((${#left[i]} > ${#right[i]})) && return 1
    [[ "${left[i]}" < "${right[i]}" ]] && return 0
    [[ "${left[i]}" > "${right[i]}" ]] && return 1
  done
  return 1
}

validate_release_inputs() {
  [[ $# == 4 ]] || { release_input_error 'expected TAG PROFILE SCOPE BASELINE (explicit empty baseline for fresh install)'; return 1; }
  local tag="$1" profile="$2" scope="$3" baseline="$4"
  release_version_parts "$tag" >/dev/null || { release_input_error "invalid release tag: $tag"; return 1; }
  [[ "$scope" == local || "$scope" == full ]] || { release_input_error 'scope must be local or full'; return 1; }
  [[ "$profile" == rc || "$profile" == final ]] || { release_input_error 'profile must be rc or final'; return 1; }
  [[ "$profile" != final || "$scope" == full ]] || { release_input_error 'final releases require full acceptance'; return 1; }
  if [[ "$tag" == *-rc.* ]]; then
    [[ "$profile" == rc ]] || { release_input_error 'RC tag requires rc profile'; return 1; }
  else
    [[ "$profile" == final ]] || { release_input_error 'stable tag requires final profile'; return 1; }
  fi
  if [[ -z "$baseline" ]]; then
    printf 'fresh\n'
    return 0
  fi
  release_version_parts "$baseline" >/dev/null || { release_input_error "invalid baseline tag: $baseline"; return 1; }
  if [[ "$tag" == *-rc.* ]]; then
    [[ "$baseline" == *-rc.* ]] || { release_input_error 'RC requires RC baseline'; return 1; }
  else
    [[ "$baseline" != *-rc.* ]] || { release_input_error 'stable requires stable baseline'; return 1; }
  fi
  release_version_is_lower "$baseline" "$tag" || { release_input_error 'baseline must be lower than target'; return 1; }
  printf 'upgrade\n'
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  validate_release_inputs "$@"
fi
