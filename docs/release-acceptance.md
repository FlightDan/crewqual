# Release acceptance

The release verifier is intentionally fail-closed. It only operates on an
isolated Compose project, a disposable database, and the acceptance S3
prefixes supplied by the operator.

```bash
corepack pnpm release:manifest .artifacts/migration-checksums.json
corepack pnpm release:verify -- --tag v0.1.0-rc.1 --profile rc
```

Build each immutable runtime image with the same source revision before
running the verifier, for example by passing
`--build-arg VCS_REF=$(git rev-parse HEAD)` and
`--build-arg VERSION=$(git describe --tags --exact-match)` to the Web, Worker
and Ops targets. The verifier checks those OCI labels against the signed tag.

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

Reports and temporary acceptance metadata are written below
`.artifacts/release/<runId>/`, which is ignored by Git. Never point
`RESTORE_DATABASE_URL` or `RESTORE_S3_BUCKET` at an online production target.
