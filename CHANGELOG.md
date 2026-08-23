# Changelog

## [1.0.1] - 2026-08-24

### Added

- Signed release manifests and release assets with an Ed25519 keyring, immutable image references, and updater binaries for amd64 and arm64.
- Release acceptance coverage for annotated signed tags, artifact integrity, upgrade, rollback, retry, and post-publish host validation.
- Installer support for stable/RC channels, LAN, temporary public HTTP, and TLS deployment modes, with optional Docker installation.
- Bilingual product documentation and updated README screenshots.

### Changed

- Updater installation and upgrades now validate the release manifest and preserve deployment state while making rollback observable.
- Runtime settings and network-access configuration now distinguish LAN, public HTTP, and TLS deployments.
- Release workflow now assembles, signs, uploads, and validates the complete release bundle before promotion.

### Security

- Release tags, manifests, checksums, and deployment assets are verified before installation or promotion.
- Public HTTP installation displays explicit warnings about credentials, TOTP, setup codes, and business data, and recommends enabling HTTPS immediately.
