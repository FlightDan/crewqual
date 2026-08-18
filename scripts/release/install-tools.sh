#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR=${INSTALL_DIR:-/usr/local/bin}
ARCH=${ARCH:-$(uname -m)}
if [[ "$ARCH" != "x86_64" && "$ARCH" != "amd64" ]]; then
  echo "仅支持 linux/amd64；当前架构为 $ARCH" >&2
  exit 1
fi

SYFT_VERSION=1.50.0
TRIVY_VERSION=0.72.0
GITLEAKS_VERSION=8.27.2
COSIGN_VERSION=3.1.3
COSIGN_SHA256=4629c757b7618056f8ddd7e2625ae9fdd94c0372a65049520bc7d9df9efc7f71

workdir=$(mktemp -d)
trap 'rm -rf "$workdir"' EXIT

download() {
  curl --fail --location --silent --show-error "$1" --output "$2"
}

install_checksum_archive() {
  local name="$1"
  local archive="$2"
  local checksum_url="$3"
  local archive_url="$4"
  local extract_name="$5"
  local checksum_file="$workdir/${name}.checksums"
  local archive_file="$workdir/$archive"

  download "$checksum_url" "$checksum_file"
  download "$archive_url" "$archive_file"
  grep -E "[[:space:]]${archive//./\\.}$" "$checksum_file" |
    (cd "$workdir" && sha256sum -c -)
  tar -xzf "$archive_file" -C "$workdir" "$extract_name"
  install -m 0755 "$workdir/$extract_name" "$INSTALL_DIR/$name"
}

install_checksum_archive \
  syft \
  "syft_${SYFT_VERSION}_linux_amd64.tar.gz" \
  "https://github.com/anchore/syft/releases/download/v${SYFT_VERSION}/syft_${SYFT_VERSION}_checksums.txt" \
  "https://github.com/anchore/syft/releases/download/v${SYFT_VERSION}/syft_${SYFT_VERSION}_linux_amd64.tar.gz" \
  syft

install_checksum_archive \
  trivy \
  "trivy_${TRIVY_VERSION}_Linux-64bit.tar.gz" \
  "https://github.com/aquasecurity/trivy/releases/download/v${TRIVY_VERSION}/trivy_${TRIVY_VERSION}_checksums.txt" \
  "https://github.com/aquasecurity/trivy/releases/download/v${TRIVY_VERSION}/trivy_${TRIVY_VERSION}_Linux-64bit.tar.gz" \
  trivy

install_checksum_archive \
  gitleaks \
  "gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz" \
  "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_checksums.txt" \
  "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz" \
  gitleaks

cosign_archive="${workdir}/cosign-linux-amd64"
download \
  "https://github.com/sigstore/cosign/releases/download/v${COSIGN_VERSION}/cosign-linux-amd64" \
  "$cosign_archive"
printf '%s  %s\n' "$COSIGN_SHA256" "$cosign_archive" | sha256sum -c -
install -m 0755 "$cosign_archive" "$INSTALL_DIR/cosign"

syft --version
trivy version
gitleaks version
cosign version
