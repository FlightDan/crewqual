#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
out_dir="${1:-dist}"
[[ "$out_dir" == /* ]] || out_dir="$(pwd)/$out_dir"
mkdir -p "$out_dir"
for arch in amd64 arm64; do
  (cd "$script_dir" && GOOS=linux GOARCH="$arch" CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o "$out_dir/crewqual-updater-linux-$arch" .)
  sha256sum "$out_dir/crewqual-updater-linux-$arch" >"$out_dir/crewqual-updater-linux-$arch.sha256"
done
