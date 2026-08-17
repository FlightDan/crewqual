# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

CrewQual (飞行员资质管理): a crew/aviation qualification management app. Single Next.js 15 (App Router) application — pnpm, TypeScript strict, Tailwind CSS. Two user surfaces share the same app:

- **Pilot** (`src/app/pilot/**`) — mobile-first: magic-link sign-in, qualification status list, evidence upload, update submission.
- **Admin** (`src/app/admin/**`) — desktop-first: dashboard, pilot directory, review queue/workbench, calendar, upgrade plans (晋升计划), qualification config, notification log.

UI text is Simplified Chinese; most product docs (`UI_BATCH_*.md`, `docs/backend-operations.md`) are also Chinese. `UI_IMPLEMENTATION_MASTER.md` is the implementation master plan (technical decisions, directory conventions, responsive rules, batch status); `UI_BATCH_*.md` are per-batch design/acceptance specs; `docs/backend-operations.md` is the deployment/ops runbook.

## Commands

```bash
corepack pnpm install --frozen-lockfile   # install deps
pnpm dev                                   # Next.js dev server (port 3000)
pnpm dev:worker                            # pg-boss worker process (needed for remote-mode async jobs)
pnpm lint && pnpm typecheck && pnpm format # quality gates (format is prettier --check)
pnpm test                                  # Vitest unit/component tests (jsdom)
pnpm test -- src/lib/calendar-utils.test.ts # single test file; use npx vitest for watch mode
pnpm test:e2e                              # Playwright e2e, local (mock mode), chromium only
pnpm test:e2e:remote                       # Playwright e2e against remote-mode server (webkit + chromium)
pnpm build                                 # prisma generate && next build
pnpm verify                                # format + lint + typecheck + test + build
pnpm db:generate | db:migrate | db:migrate:dev | db:seed | db:studio
pnpm admin:create <email> <password> <base32-totp-secret>  # also admin:reset
```

Local backend: `docker compose --profile dev up -d postgres minio`, then `pnpm db:migrate && pnpm db:seed`. A `.env` must be created from `.env.example` (none is committed). There is also a background launcher: `./run_webui.sh run|stop|restart|status` (and `run_webui.bat`) — runs `next dev` detached, logs to `.dispatcher/webui/runtime/webui.log`.

## Architecture

### Two service modes: mock vs remote

`NEXT_PUBLIC_SERVICE_MODE` (`mock` | `remote`) switches the whole app between two adapter stacks; production forces `remote` and rejects `mock`.

- **Mock** — no backend/DB required. UI is developed against the `/dev/*` preview pages (`src/app/dev/**`, 404 in production) and `src/services/mock-*` adapters with `src/mocks/*` fixtures.
- **Remote** — real API routes, Postgres, S3, and the worker.

### Service boundary (the key rule)

- `src/types/services.ts` — neutral service interfaces + all shared domain types. Every service method returns `ServiceResult<T> = { data, source: "mock" | "remote" | "local-cache" }`.
- `src/services/application-services.ts` — **the sole adapter-composition boundary**. It picks `remote-*` vs `mock-*` implementations based on the mode flag.
- Business components consume only the neutral collection (`getApplicationServices()` / `ApplicationServices`) and **must never import a concrete Mock or vendor adapter directly**.
- `src/services/remote-services.ts` — remote adapters that call the app's own API routes over HTTP.

### Backend (route handlers + server modules)

- API routes under `src/app/api/**` grouped by surface (`pilot/`, `admin/`, `evidence-images/`, `recognitions/`, `health`). All routes share the envelope helpers in `src/server/api.ts`: `jsonData`/`jsonError` → `{ data, requestId }` / `{ error: { code, message, fieldErrors?, requestId } }`, plus `parseJson` (zod), `assertSameOrigin`, `assertExpectedVersion`. Errors are normalized to stable codes (e.g. `VALIDATION_ERROR`, `VERSION_CONFLICT`, `DUPLICATE_SUBMISSION`, `EVIDENCE_UNAVAILABLE`, `INVALID_IMAGE`).
- `src/server/config.ts` — all env config validated via a zod schema (`getServerConfig()`, cached); production asserts required S3/DB/SESSION_SECRET and rejects mock mode.
- `src/server/prisma.ts` — Prisma v7 with the `@prisma/adapter-pg` driver adapter; **the client is generated into `src/generated/prisma`** (checked in). After editing `prisma/schema.prisma`, run `pnpm db:generate` to regenerate.
- `src/server/auth.ts` — opaque session tokens (hash-only in DB) + CSRF tokens for both admin and pilot sessions; admin login is password + TOTP; pilot login is a one-time magic access link (`PilotAccessToken`). `src/middleware.ts` gates `/admin/*` (except login) and pilot qualification/submission routes by cookie; all mutating API calls require same-origin + `x-csrf-token`.
- `src/server/storage.ts` — private S3 bucket; strict JPEG validation (max 10 MiB, longest edge ≤ 2560px, complete-file check) and signed URLs; image metadata lives in Postgres `EvidenceImage`, the object key stays private.
- Other server modules: `jobs.ts` (pg-boss queues), `vlm.ts` (Qwen vision recognition), `providers.ts` (SMS/Feishu webhook adapters), `rate-limit.ts`, `crypto.ts`, `admin-repository.ts`, `serializers.ts`.

### Worker + async pipeline

`src/worker/index.ts` is a **separate process** (`pnpm dev:worker`) running pg-boss queues (`QUEUES` in `src/server/jobs.ts`): `recognition`, `notifications`, `reminders`, `cleanup`. Jobs are enqueued **inside DB transactions** via `enqueueInTransaction(tx, queue, payload)`.

The core async flow: pilot uploads a processed JPEG → validated + stored in S3 with an `EvidenceImage` row (status `orphaned`) → submission creates a `QualificationUpdateRequest`, links the evidence, and enqueues a recognition job → worker runs the VLM over the image and writes a `VerificationResult` → admin reviews (approve / return / correct) → on approval a `QualificationRecord` is created/updated. Orphaned evidence images are deleted nightly by the `cleanup` queue; notifications are delivered by the worker through the configured SMS/Feishu/in-app adapters.

## Conventions

- Single app, no monorepo; desktop and mobile share the same routes and business components — never create two parallel page sets.
- UI primitives live in `src/components/ui/*` (Radix-based: dialog, tabs, drawer, toast, etc.) on top of Tailwind + design tokens in `src/design-system/tokens.ts`. Icons: lucide-react. Forms: react-hook-form + zod. Dates: date-fns.
- Responsive breakpoints: mobile `<768`, tablet `768–1023`, desktop `≥1024`. Admin shows sidebar+topbar on desktop and topbar+bottom-nav+drawer on mobile; Pilot is mobile-first with centered content capped at 430px.
- Tests are colocated as `*.test.{ts,tsx}` beside source; fixtures in `src/mocks`, Vitest setup in `src/tests/setup.ts` (jsdom). E2E: `e2e/*.spec.ts` (local mock) and `e2e/remote/*` (remote mode, via `scripts/remote-e2e-server.mjs`).
- The six core qualifications are seeded by `prisma/seed.ts`: `medical-certificate`, `dangerous-goods-training`, `icao-english-endorsement`, `chinese-language-assessment`, `simulator-recurrent-training`, `annual-recurrent-training`.

## Environment notes

- The local checkout has an empty `.git` directory — `git` commands report "not a git repository" here. Don't rely on git for history or branch operations until the repo is re-initialized.
- Production deploy is docker-compose (Postgres, web, worker, Caddy on 80/443, optional MinIO in the `dev` profile); see `docs/backend-operations.md` for the release, backup, and image-retention runbook.
