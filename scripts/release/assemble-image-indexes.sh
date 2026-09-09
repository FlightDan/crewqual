#!/usr/bin/env bash
# Assemble native application manifests and retain signed evidence for every platform.
set -euo pipefail

digest_dir=${1:?usage: assemble-image-indexes.sh DIGEST_DIRECTORY}
: "${RELEASE_TAG:?}" "${GITHUB_REPOSITORY:?}" "${GITHUB_WORKFLOW_REF:?}" "${GITHUB_OUTPUT:?}" \
  "${RELEASE_REPLACE_EXISTING_ASSETS:?}"
[[ "$RELEASE_REPLACE_EXISTING_ASSETS" == true || "$RELEASE_REPLACE_EXISTING_ASSETS" == false ]]
commit=$(git rev-parse HEAD)
workdir=$(mktemp -d)
trap 'rm -rf "$workdir"' EXIT
identity="https://github.com/$GITHUB_WORKFLOW_REF"
issuer=https://token.actions.githubusercontent.com

sign_and_verify() {
  local image=$1 provenance=$2
  shift 2
  env -u COSIGN_OIDC_ISSUER cosign sign --yes "$image"
  env -u COSIGN_OIDC_ISSUER cosign attest --yes --type slsaprovenance --predicate "$provenance" "$image"
  for sbom in "$@"; do
    env -u COSIGN_OIDC_ISSUER cosign attest --yes --type cyclonedx --predicate "$sbom" "$image"
  done
  cosign verify --certificate-identity "$identity" --certificate-oidc-issuer "$issuer" "$image" >/dev/null
  cosign verify-attestation --type slsaprovenance --certificate-identity "$identity" \
    --certificate-oidc-issuer "$issuer" "$image" > "$workdir/verified-provenance.json"
  cosign verify-attestation --type cyclonedx --certificate-identity "$identity" \
    --certificate-oidc-issuer "$issuer" "$image" > "$workdir/verified-sboms.json"
  # Verify the payload bytes as well as their signatures: another attestation
  # from the same identity must not stand in for this build's expected evidence.
  jq -s '[.[] | (if type == "array" then .[] else . end) | .payload | @base64d | fromjson | .predicate]' \
    "$workdir/verified-provenance.json" > "$workdir/provenance-predicates.json"
  jq -e --slurpfile expected "$provenance" 'any(.[]; . == $expected[0])' \
    "$workdir/provenance-predicates.json" >/dev/null
  jq -s '[.[] | (if type == "array" then .[] else . end) | .payload | @base64d | fromjson | .predicate]' \
    "$workdir/verified-sboms.json" > "$workdir/sbom-predicates.json"
  for sbom in "$@"; do
    jq -e --slurpfile expected "$sbom" 'any(.[]; . == $expected[0])' \
      "$workdir/sbom-predicates.json" >/dev/null
  done
}

provenance() {
  local platform=$1 materials=$2 output=$3
  jq -n --arg repo "https://github.com/$GITHUB_REPOSITORY" --arg commit "$commit" \
    --arg tag "$RELEASE_TAG" --arg workflow "$GITHUB_WORKFLOW_REF" --arg platform "$platform" \
    --slurpfile children "$materials" \
    '{builder:{id:("https://github.com/" + $workflow)},buildType:"https://github.com/FlightDan/crewqual/release-build", invocation:{configSource:{uri:$repo,digest:{sha1:$commit},entryPoint:$workflow},parameters:{tag:$tag,platform:$platform}}, metadata:{buildInvocationId:(env.GITHUB_RUN_ID + "/" + env.GITHUB_RUN_ATTEMPT)}, materials:([{uri:$repo,digest:{sha1:$commit}}] + $children[0])}' > "$output"
}

for component in web runtime; do
  image="ghcr.io/${GITHUB_REPOSITORY,,}-$component"
  children=()
  sboms=()
  printf '[]\n' > "$workdir/materials.json"
  for arch in amd64 arm64; do
    record="$digest_dir/$component-$arch.json"
    child=$(jq -er --arg arch "$arch" --arg commit "$commit" \
      'select(.arch == $arch and .commit == $commit) | .image' "$record")
    [[ "$child" == "$image@sha256:"* ]]
    digest=${child#*@}
    [[ "$digest" =~ ^sha256:[a-f0-9]{64}$ ]]
    docker buildx imagetools inspect "$child" --raw > "$workdir/child.json"
    jq -e '.mediaType == "application/vnd.oci.image.manifest.v1+json"' "$workdir/child.json" >/dev/null
    docker pull --platform "linux/$arch" "$child"
    [[ "$(docker image inspect "$child" --format '{{.Os}}/{{.Architecture}}')" == "linux/$arch" ]]
    sbom="$workdir/$component-$arch-sbom.json"
    syft "registry:$child" --platform "linux/$arch" -o "cyclonedx-json=$sbom"
    printf '[]\n' > "$workdir/empty-materials.json"
    provenance "linux/$arch" "$workdir/empty-materials.json" "$workdir/child-provenance.json"
    sign_and_verify "$child" "$workdir/child-provenance.json" "$sbom"
    jq --arg uri "$child" --arg digest "${digest#sha256:}" \
      '. + [{uri:$uri,digest:{sha256:$digest}}]' "$workdir/materials.json" > "$workdir/materials-next.json"
    mv "$workdir/materials-next.json" "$workdir/materials.json"
    children+=("$child")
    sboms+=("$sbom")
  done
  version_ref="$image:$RELEASE_TAG"
  if docker buildx imagetools inspect "$version_ref" --raw \
    > "$workdir/existing-index.json" 2> "$workdir/existing-index.err"; then
    [[ "$RELEASE_REPLACE_EXISTING_ASSETS" == true ]] || {
      echo "refusing to replace existing OCI image tag: $version_ref" >&2
      exit 1
    }
  elif grep -Eqi 'manifest unknown|no such manifest' "$workdir/existing-index.err" ||
    grep -Fqi -- "$version_ref: not found" "$workdir/existing-index.err"; then
    : # The registry explicitly confirmed that the version tag is absent.
  else
    cat "$workdir/existing-index.err" >&2
    echo "unable to prove OCI image tag is absent: $version_ref" >&2
    exit 1
  fi
  docker buildx imagetools create --tag "$version_ref" "${children[@]}"
  docker buildx imagetools inspect "$version_ref" --raw > "$workdir/index.json"
  # Ask the registry-backed inspector for the canonical digest. Hashing CLI
  # output is unsafe because presentation newlines are not registry bytes.
  digest="$(docker buildx imagetools inspect --format '{{json .Manifest}}' "$version_ref" | jq -er '.digest')"
  [[ "$digest" =~ ^sha256:[a-f0-9]{64}$ ]]
  jq -e --arg amd64 "${children[0]#*@}" --arg arm64 "${children[1]#*@}" \
    '.mediaType == "application/vnd.oci.image.index.v1+json" and (.manifests | length == 2) and
     any(.manifests[]; .digest == $amd64 and .platform.os == "linux" and .platform.architecture == "amd64") and
     any(.manifests[]; .digest == $arm64 and .platform.os == "linux" and .platform.architecture == "arm64")' \
    "$workdir/index.json" >/dev/null
  docker buildx imagetools inspect "$image@$digest" --raw > "$workdir/immutable-index.json"
  cmp "$workdir/index.json" "$workdir/immutable-index.json"
  provenance 'linux/amd64,linux/arm64' "$workdir/materials.json" "$workdir/index-provenance.json"
  # Both platform SBOMs are also attached to the index; the child manifests
  # retain their own signature, SBOM and provenance at immutable digests.
  sign_and_verify "$image@$digest" "$workdir/index-provenance.json" "${sboms[@]}"
  printf '%s_image=%s@%s\n' "$component" "$image" "$digest" >> "$GITHUB_OUTPUT"
done
