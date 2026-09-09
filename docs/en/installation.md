# Installation and initial setup

[Documentation index](README.md) · [简体中文](../zh-CN/installation.md)

## Install a release

The installer targets Linux amd64/arm64 and WSL2 Ubuntu on Windows x86_64 with Docker Desktop Linux containers. Regular Linux deployments need systemd for the host updater service. macOS support is not yet complete.

Run this on the target host:

```bash
curl -fsSL https://raw.githubusercontent.com/FlightDan/crewqual/main/install.sh | sudo bash
```

The script selects the latest stable GitHub Release, verifies the release manifest signature and file checksums, and deploys GHCR images pinned by digest. The default installation directory is `/opt/crewqual`. On regular Linux, add `--install-docker` if Docker is missing; this installs Docker Engine and Compose v2.

Choose a language, network mode, and port during installation. Supported terminals display a full-screen interface; `--plain` selects text output. Raw logs from the full-screen interface are stored at `/opt/crewqual/logs/install-*.log` with root-only access.

For an unattended LAN installation, replace this private IPv4 address with the host's address:

```bash
curl -fsSL https://raw.githubusercontent.com/FlightDan/crewqual/main/install.sh \
  | sudo bash -s -- --install-docker --non-interactive \
      --network-mode lan --lan-address 192.168.1.20 --port 8080
```

Use `--version v1.0.1` to select an exact release, replacing the version with the required published tag. Use `--channel rc` for the RC channel.

## Windows and WSL2

1. Install and start Docker Desktop on Windows, using Linux containers.
2. Enable the current Ubuntu distribution under `Settings > Resources > WSL Integration`.
3. Run these checks in Ubuntu, then run the installation command above. Omit `--install-docker`.

```bash
docker info
docker compose version
```

WSL2 defaults to manual updates and `http://localhost:8080`, accessible from a Windows browser. For access from other LAN devices, pass the **Windows network adapter's private IPv4 address** with `--network-mode lan --lan-address`, and allow inbound traffic on the selected TCP port in Windows Firewall. Do not use WSL2's internal NAT address.

## Network and TLS

| Mode   | Purpose                                | Required arguments for first non-interactive installation |
| ------ | -------------------------------------- | --------------------------------------------------------- |
| `lan`  | HTTP on localhost or a private network | `--lan-address`                                           |
| `http` | Temporary public HTTP                  | `--public-address`                                        |
| `tls`  | HTTPS                                  | `--domain`, plus a TLS email or your certificate          |

Public HTTP transmits setup codes, passwords, TOTP codes, and business data without encryption. Restrict firewall sources while using it. After switching to HTTPS, change administrator passwords and TOTP, revoke active sessions, and rotate API/Webhook keys entered over HTTP.

For automatic certificates, point the domain's DNS to the host and allow inbound TCP 80 for certificate validation and TCP 443 for the application:

```bash
curl -fsSL https://raw.githubusercontent.com/FlightDan/crewqual/main/install.sh \
  | sudo bash -s -- --network-mode tls \
      --domain crewqual.example.com --tls-email ops@example.com --port 443
```

The TLS email receives certificate notifications; it is not an administrator login. To use an existing PEM certificate, replace `--tls-email` with `--tls-cert /path/fullchain.pem --tls-key /path/privkey.pem`. The key must be unencrypted. The script checks certificate expiry, domain coverage, and key matching. It copies the files into `tls/` under the installation directory; supply renewed files again after renewal.

For an existing installation, switch to HTTPS with:

```bash
sudo /opt/crewqual/configure-domain.sh \
  --domain crewqual.example.com --tls-email ops@example.com --port 443
```

Use the certificate arguments instead of the email for a custom certificate. A normal upgrade does not change the existing network mode or port.

## Initial setup

Save the **one-time eight-digit authorization code** printed when installation finishes. It is not written to the installation log. Enter it at the `/setup` URL shown by the installer, then complete the environment check, object storage, super administrator, job template, backup, notification, and confirmation steps.

The installer provides built-in MinIO; you can also connect external S3-compatible storage. The super administrator must configure TOTP. Keep the secret information shown during enrollment. SMS can remain disabled initially, but member access links are not issued until a real SMS webhook is configured.

Check the services after setup:

```bash
sudo docker compose --project-directory /opt/crewqual \
  --env-file /opt/crewqual/.env -f /opt/crewqual/compose.yaml ps
```

`migrate`, `bootstrap`, and `minio-init` are one-time jobs; a successful exit is expected. Long-running services such as `web` and `worker` should remain running. See [operations, backup, and recovery](operations.md) for troubleshooting.

## Deploying from source

The repository's `docker-compose.yml` builds local source and requires external S3. The installer uses the released `docker-compose.install.yml`, saves it as `compose.yaml` in the installation directory, and includes built-in MinIO. Their environment configurations are not interchangeable.

`scripts/init-docker-env.sh` generates only part of the source deployment configuration. It currently omits network settings required by source Compose, including `NETWORK_ACCESS_SECRET`; running that script followed by Compose is not a complete deployment procedure. For a source deployment, check [configuration](configuration.md), the actual Compose file, and `.env.example`, and configure the domain, first-setup authorization, and external services.

Sources: [installer](../../install.sh), [release Compose](../../docker-compose.install.yml), [domain configuration script](../../scripts/configure-domain.sh), [setup wizard text](../../src/lib/setup-i18n.ts).
