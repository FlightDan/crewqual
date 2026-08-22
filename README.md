# CrewQual

CrewQual is a modern, self-hosted personnel qualification and compliance management platform.
It is designed for aviation organizations and other teams that need to continuously manage licenses, training, expiration dates, and progression plans.
CrewQual brings personnel qualifications, expiration alerts, document submissions, assisted verification, manual review, and progression plans together in one traceable and auditable workflow.

## Features

- **Member portal**: Members can use a mobile device to view their qualifications, expiration dates, and alerts, then upload evidence or submit qualification update requests.
- **Member and position management**: Maintain personnel, organizational, and position relationships, and assign qualification requirements by position.
- **Qualification rules**: Configure qualification types, validity periods, reminder rules, and applicable positions.
- **Review workspace**: Process qualification updates submitted by members, combining document recognition, rule validation, and manual review before records take effect.
- **Calendar and alerts**: View upcoming qualification expirations, planned checks, and other key milestones in one place.
- **Progression plans**: Configure advancement goals, assessment items, time windows, and stage-based tasks.
- **Notification center**: Send configurable notifications for qualification expirations, review results, and plan milestones.
- **Security and permissions**: Role-based permissions, access control, and audit logging for critical business operations.
- **Operations**: Docker Compose deployment, health checks, asynchronous jobs, object storage, and backup and restore support.

## Why CrewQual

- **Designed around the complete lifecycle**: Expiration reminders, member submissions, document recognition, final manual review, and record activation are handled in one system.
- **Human decisions remain in control**: AI/OCR reduces data-entry and verification effort, while final approval always remains with an authorized administrator.
- **Adaptable to different positions**: Positions, qualification requirements, reminder rules, and progression paths are configurable.
- **Built for mobile and desktop**: The member portal is optimized for mobile use, while the administration console supports both desktop and mobile workflows.
- **Self-hosted and data-controlled**: Business data is stored in PostgreSQL, while qualification images can be stored in private S3-compatible storage and deployed in an organization-controlled environment.
- **Auditable and recoverable**: Critical actions are logged, with support for asynchronous jobs, health checks, backup, and recovery.

## CrewQual vs. Multidimensional Table Tools

CrewQual is a better fit when qualification compliance is a long-term, business-critical process that needs systematic management.

- **A ready-to-use business model**: Personnel, positions, qualifications, expiration dates, review records, and progression plans are built in, so you do not need to design a complex table structure from scratch.
- **A complete qualification lifecycle**: Cover document submission, AI-assisted verification, manual review, record activation, expiration alerts, and notifications.
- **Stronger business constraints**: Qualification statuses, rule versions, evidence ownership, and review permissions are enforced consistently by the system, reducing accidental changes, missing configuration, and inconsistent rules.
- **Dedicated experiences for different roles**: Members use a mobile portal for queries and submissions, while administrators use a workspace for reviews and risk management instead of sharing one complex table.
- **Business-level auditability**: Record not only who changed which field, but also review decisions, the rules used, evidence, and complete state transitions.
- **Independent deployment and data control**: Self-host CrewQual and control the database, qualification files, backup policies, and external-service integrations.
- **Deep customization**: Customize the system in code to match an organization’s position structure, qualification rules, progression paths, and approval policies.

For organizations with few personnel, simple rules, and no need for complex review or audit capabilities, a multidimensional table tool may be sufficient.
CrewQual is intended for organizations where qualification management is becoming a long-term, standardized business process.

## Quick Start

On a Linux host with Docker Engine and Docker Compose v2 installed, run the installer. On first installation, you will choose a language and then choose between **LAN testing** and **Configure TLS now**. LAN mode does not require a domain or TLS email address, uses port `8080` by default, and only allows private-network sources. You can also set the installer language with `--language zh|en` or `CREWQUAL_INSTALL_LANGUAGE`.

```sh
export CREWQUAL_UPDATER_TRUSTED_PUBLIC_KEY='<Base64 Ed25519 public key provided by the publisher>'
curl -fsSL https://raw.githubusercontent.com/FlightDan/crewqual/main/install.sh | sudo -E bash
```

The installer resolves the latest official GitHub Release, pulls the public `crewqual-web` and `crewqual-runtime` GHCR images, and installs deployment files in `/opt/crewqual`. After installation, an 8-digit first-time setup authorization code is shown once in the terminal. Enter this code when visiting `/setup`; in LAN mode, visit the displayed `http://LAN_ADDRESS:PORT/setup`, or in TLS mode, visit `https://DOMAIN[:PORT]/setup`. During installation, you can choose the default port, a random available port, or a custom port.

The TLS email address is only the contact address for ACME/Let's Encrypt certificate expiration, renewal, or error notifications. It is not a CrewQual login address, and no email password is required.

After a LAN deployment, you can bind a production domain and enable TLS with `/opt/crewqual/configure-domain.sh`:

```sh
sudo /opt/crewqual/configure-domain.sh \
  --domain crewqual.example.com --tls-email ops@example.com --port 443
```

The script enables public access only after certificate issuance and health checks succeed; if either fails, it restores the previous LAN configuration. When using a custom TLS port, public TCP port 80 must still reach Caddy for ACME HTTP validation.

Install a fixed version:

```sh
export CREWQUAL_UPDATER_TRUSTED_PUBLIC_KEY='<Base64 Ed25519 public key provided by the publisher>'
curl -fsSL https://raw.githubusercontent.com/FlightDan/crewqual/main/install.sh \
  | sudo -E bash -s -- --version v1.0.0
```

Unattended installation:

```sh
export CREWQUAL_UPDATER_TRUSTED_PUBLIC_KEY='<Base64 Ed25519 public key provided by the publisher>'
curl -fsSL https://raw.githubusercontent.com/FlightDan/crewqual/main/install.sh \
  | sudo -E bash -s -- --domain crewqual.example.com \
    --tls-email ops@example.com --non-interactive
```

Running the installation command again upgrades the deployment while preserving `/opt/crewqual/.env` and Docker volumes. For complete installation, backup, fixed-version, and source-deployment instructions, see [`docs/docker-deployment.md`](docs/docker-deployment.md).

## SaaS and Enterprise Services

CrewQual can be self-hosted and also offers managed services for enterprises and small teams, including:

- Fully managed deployments
- Data migration and initial setup
- System configuration and user training
- Operations and data backups
- Message notification channel integrations
- Enterprise internal OA integrations
- Custom features and business-process adaptation

Contact CrewQual@devdan.cc.

## Roadmap

- [x] Member qualification lookup, evidence upload, and update requests
- [x] Administrative review, qualification alerts, calendars, and progression plans
- [x] Role-based permissions, audit records, notification queues, and private object storage
- [x] Docker Compose deployment, health checks, and backup support
- [x] i18n and multilingual support
- [ ] One-click migration from multidimensional table tools
- [ ] Node 22 → 24

## Privacy and Security

CrewQual is designed to be self-hosted. Unless the deployment owner explicitly configures external services or third-party integrations, personnel information, qualification records, certificate files, and other business data remain on infrastructure controlled by the deploying organization.

CrewQual may process information such as names, employee IDs, contact details, qualification expiration dates, training records, and certificate images. Deployment owners should configure and manage the system according to their own data-security, access-control, backup, and compliance requirements.

AI-assisted verification is optional and is not required by CrewQual’s core functionality. When enabling AI or other external services, deployment owners should select providers appropriate to their data-processing policies, confidentiality requirements, and applicable laws, and confirm that data transmission and processing meet their organization’s requirements.

CrewQual does not proactively send business data to third-party services unless the deployment owner configures it to do so.

If you discover a vulnerability that may affect CrewQual’s security, please do not disclose exploitation details through a public issue.

Contact CrewQual@devdan.cc.

See [SECURITY.md](./SECURITY.md) for the vulnerability reporting process.

## Contributing

Contributions to CrewQual’s development, testing, and improvement are welcome.

If you find a bug, have a feature suggestion, or want to improve the documentation, interface, deployment process, or existing functionality, you can participate through GitHub Issues or Pull Requests.

Feedback from real-world use cases in aviation qualification management, training management, and compliance workflows is also highly welcome. Even if you do not contribute code, sharing business requirements, process differences, and user experiences can help improve CrewQual.

CrewQual 1.0.0 is intended for production deployment. Interfaces and data structures follow a versioned upgrade strategy. Before each upgrade, you should still complete acceptance testing, an off-host backup, and an isolated recovery drill.

Code contributions must comply with the project’s Contributor License Agreement (CLA). Contributors retain copyright in their contributions and grant the CrewQual project the licenses necessary for use and relicensing under the CLA. See `CLA.md` for the specific terms.

Thank you to everyone who contributes issues, code, documentation, suggestions, or real-world feedback to CrewQual.

## License

CrewQual is released under the GNU Affero General Public License v3.0 **only** (SPDX: `AGPL-3.0-only`). See [LICENSE](./LICENSE) for the complete license terms.

You may use, deploy, study, modify, and redistribute CrewQual in accordance with the AGPL-3.0 terms.

If you modify CrewQual and make that modified version available to users over a network, make the corresponding source code available to those users as required by AGPL-3.0.

In the future, CrewQual may also offer alternative licensing options, such as commercial licenses for organizations that need commercial deployments, managed services, custom development, or an arrangement without the open-source obligations of AGPL-3.0.

The applicable terms are those in the repository’s LICENSE file and any subsequently published commercial licensing terms.

The explanations in this README are provided for guidance only. The full AGPL-3.0 license text in LICENSE governs the specific rights and obligations.
