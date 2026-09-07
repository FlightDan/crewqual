# Architecture

[简体中文](../zh-CN/architecture.md) · [Docs index](README.md)

CrewQual uses Next.js App Router and React for its interface and HTTP API, with Prisma accessing PostgreSQL. Credential files live in S3-compatible object storage. A separate Node.js Worker runs background jobs.

## Deployment processes

| Service             | Responsibility                                                                                                              |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Caddy               | Accept browser requests, handle HTTP or TLS for the deployment mode, and proxy to Web                                       |
| Web                 | Pages, authentication, permission checks, and business APIs                                                                 |
| PostgreSQL          | Business records, sessions, audit records, job queues, and Worker heartbeats                                                |
| Worker              | Consume pg-boss queues for recognition, notifications, reminders, cleanup, image optimization, and backups                  |
| Object storage      | Store private credential files; the installation method and configuration determine whether storage is built in or external |
| migrate / bootstrap | Run database migrations and initialization as one-time startup tasks                                                        |
| ops                 | Provide a runtime container for operations commands when needed                                                             |

The [Dockerfile](../../Dockerfile) builds separate Web and data runtimes. Web uses the Next.js standalone output. Worker, migrations, and operations use the data runtime, which includes PostgreSQL clients and backup tools.

## How a qualification submission moves through the system

A member uploads evidence, checks recognition results, and submits the fields. The server validates identity, resource ownership, and qualification rules, then stores the update request and its rule snapshot. Worker sends recognition jobs to the configured provider. Server logic compares extracted values with the submitted fields and rule snapshot.

AI verification is one input to review. After an authorized administrator decides, the system updates the request status and effective records according to that decision and records audit information. Background jobs handle notifications. Recognition, manual review, and notification delivery have separate states; a failed notification does not mean the review failed.

Trace the implementation through the [member submission API](../../src/app/api/pilot/submissions/route.ts), [verification logic](../../src/server/qualification-verification.ts), and [Worker handlers](../../src/server/worker-handlers.ts).

## Data and permission boundaries

The application and Worker use the runtime database account through `DATABASE_URL`. Migrations use a privileged migration account through `DIRECT_URL`. The migration process creates the pg-boss schema; persistent processes do not migrate queue structures themselves. See [Development](development.md) for the initialization order.

The server enforces permissions. Hiding a button is only display logic. Outbound connections are subject to host and network restrictions configured by the deployment owner; application administrators cannot expand that boundary through settings. See [Configuration](configuration.md) for additional object storage and remote backup requirements.

Recovery must account for the database, credential objects, and keys used to encrypt settings. Read [Operations](operations.md) for the process and its limits.

## Code layout

| Path             | Contents                                                                       |
| ---------------- | ------------------------------------------------------------------------------ |
| `src/app`        | Pages and API routes                                                           |
| `src/components` | Admin, member, setup, and shared components                                    |
| `src/services`   | Frontend service contracts, mock and remote implementations, client state      |
| `src/server`     | Permissions, database access, rule enforcement, storage, and external services |
| `src/lib`        | Shared validation, date handling, and language resources                       |
| `src/types`      | Service and business types                                                     |
| `src/worker`     | Background job entrypoint and lifecycle                                        |
| `src/mocks`      | Development and test data                                                      |
| `prisma`         | Data models, migrations, and seed scripts                                      |
| `scripts`        | Initialization, recovery, administrator maintenance, and release tools         |
| `e2e`            | Browser and real backend end-to-end tests                                      |

Some paths and types retain the name `pilot`. Search those paths as well as member terminology when locating member features.

## Chinese and English support

The application uses `zh-CN` and `en-US` locale identifiers, with Chinese as the default. Locale resolution checks the `crewqual_locale` cookie first, then the browser's `Accept-Language` header. Interface resources and business-field translation helpers live in `src/lib`.

Documentation uses `zh-CN` and `en` directories. Here, `en` is a documentation path, not an application locale identifier. Keep commands, environment variables, API paths, and status codes unchanged when translating pages so that readers can still use them.

## Mock and remote services

Development defaults to mock mode; real services require explicit configuration. Production interface mode is fixed to remote, and production configuration validates related constraints. Check both mock and remote contracts when changing a feature so that a working preview corresponds to a supported real API. Start with [service mode](../../src/lib/service-mode.ts), [application services](../../src/services/application-services.ts), and [server configuration](../../src/server/config.ts).
