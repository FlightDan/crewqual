# Release acceptance

The release verifier is intentionally fail-closed. It only operates on an
isolated Compose project, a disposable database, and the acceptance S3
prefixes supplied by the operator.

```bash
corepack pnpm release:manifest .artifacts/migration-checksums.json
corepack pnpm release:verify -- --tag v0.3.3-rc.1 --profile rc
```

Build each immutable runtime image with the same source revision before
running the verifier, for example by passing
`--build-arg VCS_REF=$(git rev-parse HEAD)` and
`--build-arg VERSION=$(git describe --tags --exact-match)` to the Web, Worker
and Ops targets. The verifier checks those OCI labels against the signed tag.
It also selects the `linux/amd64` OCI manifest and fails closed when the
compressed layers exceed 110 MiB (Web), 270 MiB (Worker), 280 MiB (Ops), or
641 MiB in total; the report records the local uncompressed sizes as well.

The workflow installs the pinned Linux/amd64 supply-chain tools from their
official release assets. On an acceptance machine, install the same versions
before running the local supply-chain gate:

```bash
sudo ./scripts/release/install-tools.sh
```

The installer verifies Syft 1.50.0, Trivy 0.72.0, Gitleaks 8.27.2 and Cosign
3.1.3 checksums before placing the binaries in `/usr/local/bin`.

For a final release, provide signed tag fingerprints, immutable Web/Worker/Ops
image references, AWS acceptance credentials, two successful backup run IDs,
their exact artifact keys (`BACKUP_TAMPER_ARTIFACT_KEYS` and
`BACKUP_TAMPER_BLOB_SHA256`), an isolated restore database and bucket, Cosign
identity/issuer, and a time-bounded license approval file. The final workflow signs `evidence.json`
with Cosign and then runs the artifact gate.

SMS, Feishu and VLM are deliberately not contacted by this verifier. The
acceptance environment must set `SMS_ADAPTER=disabled`,
`FEISHU_ADAPTER=disabled`, and `VLM_ADAPTER=disabled`; the core health/login
smoke verifies that the application remains usable with those integrations off.

The bootstrap gate creates a fresh database with one super administrator, one
organization/root unit, and only the `PILOT` position from the
`aviation-china-airline-pilot` template. It fails if any person, pilot,
qualification record, upgrade plan, notification, upload, or backup row exists.
The acceptance Compose ports bind to `127.0.0.1` only.

Reports and temporary acceptance metadata are written below
`.artifacts/release/<runId>/`, which is ignored by Git. Never point
`RESTORE_DATABASE_URL` or `RESTORE_S3_BUCKET` at an online production target.
