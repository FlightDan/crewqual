# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

CrewQual is a self-hosted crew qualification & compliance platform (Next.js 15 App Router + React 19 + Tailwind, Prisma 7 + PostgreSQL, pg-boss queues, S3-compatible object storage). UI is bilingual zh-CN (default) / en-US, Chinese-first. Self-hosted via Docker Compose; releases are installed by a signed-manifest installer (`install.sh`).

Package manager is **pnpm** (`corepack`-managed). `.npmrc` sets `node-linker=hoisted` because the repo is routinely checked out on SMB/NAS filesystems — don't remove it.

## Commands

```sh
pnpm install --frozen-lockfile
pnpm dev              # Next dev on 0.0.0.0:3000 (mock service mode by default)
pnpm dev:worker       # pg-boss worker process (needs remote mode + DATABASE_URL)
pnpm verify           # full gate: format + lint + typecheck + typecheck:scripts + test + build
pnpm typecheck        # tsc --noEmit  (tsconfig.scripts.json covers scripts/ separately)
pnpm test             # vitest run — unit tests, no DB needed
pnpm test src/lib/i18n.test.ts        # single test file
pnpm build            # prisma generate && next build
pnpm format           # prettier --check .
```

- **Run `typecheck` and `build` serially, never in parallel** — concurrent runs contend on `.next/types` and fail spuriously.
- Unit tests are colocated (`*.test.ts(x)` next to the code), jsdom + Testing Library, in-memory Prisma doubles — no database required.
- E2E (Playwright): `pnpm test:e2e` self-hosts Next in **mock mode** — no DB/Docker needed. `PLAYWRIGHT_PRODUCTION=1` uses `next start` instead of `next dev`. Remote-mode E2E (`pnpm test:e2e:remote`) needs a real stack: local Postgres 16 on `127.0.0.1:55432` + MinIO via `docker-compose.release.yml`, seeded with `pnpm db:e2e:prepare`; it runs **single-worker serial** because specs share DB state.
- Integration tests need `DATABASE_URL` (Postgres 16): `pnpm test:integration:recognition` (pg-boss round trip), `pnpm test:integration:rate-limit`. `CREWQUAL_TEST_NO_EXTERNAL=1` (set by CI/e2e configs) forces all SMS/Feishu/VLM adapters to disabled stubs.
- DB: `pnpm db:migrate` (deploy), `pnpm db:migrate:dev`, `pnpm db:generate`, `pnpm db:seed`, `pnpm db:migrate:members` + `db:reconcile:members` (backfills the new Person architecture), `pnpm db:studio`.
- Installer self-test (standalone, not in package.json): `scripts/install.test.sh`.

## Architecture

### Service-mode boundary (the central pattern)

`SERVICE_MODE` is `mock` or `remote` (`src/lib/service-mode.ts`). **Mock is the default outside production; production is always remote.** Mock mode runs the entire UI against in-memory services with no DB/S3/queues — middleware 404s all `/api/*` except `/api/health`, and server infra (`prisma.ts`, `storage.ts`, `jobs.ts`) throws if touched.

`src/services/application-services.ts` is the **sole adapter-composition boundary**: it binds the 12 typed services from `src/types/services.ts` to either `remote-services.ts` (fetch → `/api/*`, unwraps the `{ data, requestId }` envelope) or `mock-*.ts` implementations. React consumes them via `useApplicationServices()` (`application-services-provider.tsx`, which also owns the TanStack QueryClient). An architectural test (`src/services/service-boundary.test.ts`) **fails if anything in `src/app` or feature components imports a mock adapter directly** — keep that boundary.

### Layers

- `src/lib` — pure shared logic (no I/O): validation, qualification rules, date handling, i18n dictionaries. Never imports `@/server`.
- `src/server` — the entire backend: Prisma access, auth, storage, queues, business services. `src/server/api.ts` defines the route envelope (`jsonData`/`jsonError` normalizing Zod/Prisma/version-conflict errors) and CSRF (`assertSameOrigin`); `src/server/config.ts` is zod-validated env with hard production assertions.
- `src/services` — client-side service adapters (see above).
- `src/worker` — separate queue-consumer process (`worker` compose service, same image/DB as web). Web only *enqueues*; the worker runs handlers from `src/server/worker-handlers.ts` and heartbeats into `WorkerHeartbeat`.

### Request flow and conventions

UI → `src/services` → `/api/**/route.ts` → `src/server` → Prisma/S3/pg-boss.

API routes follow one template: `getRequestId` → `assertSameOrigin` (mutations) → auth (`getAdmin(request, permission)` from `admin-guard.ts` = session + RBAC + unit scoping + audit; or pilot/member auth) → `parseJson(zodSchema)` → business logic in `db.$transaction` → `jsonData`/`jsonError`. State changes write their `AuditEvent` rows **inside the same transaction** (no central audit logger).

Notifications use a **transactional outbox**: `emitPilotNotification(tx, …)` inserts `NotificationDelivery` rows (dedupeKey) and enqueues the pg-boss job in the same transaction (`enqueueInTransaction`). Six queues, all `crewqual.*`: `recognition` (VLM/OCR of evidence images against an OpenAI-compatible endpoint), `notifications`, `reminders` (daily 08:00), `cleanup` (daily 03:00), `media-optimization` (*/5 min), `backups` (every minute). Job claim uses guarded CAS `updateMany`; retries capped at queue level.

### Data model (prisma/schema.prisma)

- Org: `Organization` → `OrganizationUnit` (tree) → `Person`. **Dual architecture in flight**: new `Person`/`PilotProfile`/`PersonPositionAssignment` coexists with legacy `Pilot`, linked both ways; backfill via `db:migrate:members`.
- Qualification rules are **versioned and snapshotted**: definitions carry JSON rules (`validityRule`, `reminders`, `ocrChecks`, `fieldSchema`); every submission/record stores a `qualificationRuleSnapshot` — decisions are judged against submit-time rules.
- `QualificationRecord` is **append-only** with `lineageId` + `revisionNumber`, `supersedes`/`restores` self-relations, and a partial unique index enforcing one active record per pilot+type.
- **No soft deletes**: mutable models use `active` boolean + `version` int for optimistic concurrency (API takes `expectedVersion`; conflict → `VERSION_CONFLICT` 409).
- Member submissions: `QualificationUpdateRequest` (PENDING/APPROVED/RETURNED) with immutable `submittedFields` JSON + corrections as `QualificationCorrection` rows. AI never approves — `VerificationResult` (MATCHED/MISMATCH/UNCERTAIN/UNAVAILABLE) is advisory only; humans decide.
- Singleton config rows (`SecurityPolicy`, `ObjectStorageSetting`, `SystemIntegrationSetting` with encrypted secrets) mean some settings live in the DB, not env.

The Prisma client is generated to **`src/generated/prisma` (checked into git)** — import from `@/generated/prisma/client`, not `@prisma/client`. Dates on qualifications are date-only (`src/lib/date-only.ts`).

### Auth surfaces and portals

Three cookie realms: admin (`argon2id` + optional TOTP), member, pilot. Members/pilots log in via **single-use magic links** (`PilotAccessToken`, consumed transactionally).

**`/member` is canonical; `/pilot` is deprecated but still supported** — middleware stamps `deprecation`/`successor-version` headers on `/pilot/*`, `src/app/api/member/*` routes are one-line re-exports of `/api/pilot/*`, and both portals render the same shared components from `src/components/pilot/` via a `portal` prop. Admin still has both `members/` and `pilots/` sections. Don't "clean up" the duplication without understanding it's a deliberate migration.

`src/middleware.ts` also enforces admin auth redirects, maintenance mode, mock-mode API blocking, and no-store/noindex headers on one-time access links. Dev-only pages under `src/app/dev/*` and `/api/dev/*` call `notFound()` in production.

### i18n

Hand-rolled (no library): flat dictionaries in `src/lib/messages.ts` (`zhCN`/`enUS`, dotted keys, `{placeholder}` interpolation) via `useI18n()` from `I18nProvider`; server locale resolution prefers org `defaultLocale` (DB) → `crewqual_locale` cookie → `Accept-Language`. DB entities store `{ "zh-CN": …, "en-US": … }` translation JSON resolved with `translatedValue`. Server-side error/audit strings are hardcoded Chinese by design. There is intentionally **no per-browser language switch button** on public pages (language is org-level, set by admins) — see `e2e/i18n.spec.ts`.

### Frontend notes

Admin/member pages are thin server components wrapping client view components. `src/components/ui/` is the primitive library (Radix + lucide, mostly `cn()` = clsx + tailwind-merge; only button uses cva). Design tokens live as CSS custom properties in `src/app/globals.css`, mapped into Tailwind via `tailwind.config.ts`; `src/design-system/tokens.ts` is a mirror used by dev/preview tooling. `next.config.ts` sets `output: "standalone"`, a separate dev `distDir` (`.next-dev`) to keep dev/prod manifests from clobbering each other, and strict CSP/security headers on every route.

## Deployment & release (only touch when asked)

- `docker-compose.yml` (dev, images built from `Dockerfile`) vs `docker-compose.install.yml` (production, digest-pinned images from the signed release manifest) vs `docker-compose.release.yml` (CI acceptance, Postgres published on 55432). `Dockerfile` builds two images from one source: `web-runner` (Next standalone) and `runtime-runner` (worker + ops tooling). `runtime/` is a pnpm workspace package holding only the runtime image's production deps.
- `install.sh` installs/upgrades to `/opt/crewqual` from Ed25519-signed update manifests; its self-test is `scripts/install.test.sh`. `updater/` is a Go daemon (stdlib only) exposing a Unix-socket API — web containers never get Docker access.
- The update-manifest keyring exists in three places that must stay identical: `security/update-manifest-keyring.json`, `updater/keyring.json`, and the copy embedded in `install.sh` — check with `pnpm release:check-keyring`.
- `scripts/release/verify.ts` runs the acceptance gates (preflight/bootstrap/s3-dr/e2e/supply-chain/artifact) for GPG-signed `v*` tags; releases go through `.github/workflows/release-acceptance.yml` (workflow_dispatch only). CI actions must stay SHA-pinned (preflight enforces it).

## Conventions

- Branch layout: `main` plus `release/x.y.z` branches; releases are GPG-signed annotated `v*` tags. PRs target `main`.
- Commit messages use `fix:` / `feat:` / `docs:` prefixes (suggested, not enforced); avoid vague messages.
- Schema changes go through Prisma migrations only — no manual production DB changes.
- TypeScript is strict, path alias `@/* → ./src/*`. Prettier + ESLint (`next/core-web-vitals`).
- `.docs/` holds internal goal documents (test coverage program, i18n migration, remediation batches) — useful context for why certain constraints exist.
- Security issues go through `SECURITY.md`, never public issues. Contributions require CLA acceptance.
