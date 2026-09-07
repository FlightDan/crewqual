# Development

[简体中文](../zh-CN/development.md) · [Docs index](README.md)

## Preview the interface locally

The repository's Dockerfile and CI use Node.js 22.12. The package manager is pinned to pnpm 10.15.0. Install matching tools, then run these commands from the repository root:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm db:generate
SERVICE_MODE=mock NEXT_PUBLIC_SERVICE_MODE=mock corepack pnpm exec next dev --hostname 127.0.0.1 --port 3000
```

These commands use Bash, including Linux and WSL2. Open `http://127.0.0.1:3000` for the admin interface. `/dev/pilot-flow` links to member workflows and recognition scenarios; `/dev/ui-kit` previews components. Production does not expose `/dev` pages.

Mock mode uses simulated services. It cannot verify real database writes, SMS delivery, or object storage. You do not need to copy the production `.env.example` for this preview. If `.env` or `.env.local` already exists, check its settings to avoid mixing in production connections.

`pnpm dev` listens on `0.0.0.0:3000` by default. The command above binds to the local machine for individual development. Change the binding when you need to preview on another device.

## Develop with real services

Remote mode needs a separate development database and object storage. Follow [Configuration](configuration.md) and set both `SERVICE_MODE` and `NEXT_PUBLIC_SERVICE_MODE` to `remote`. Every remote environment must supply `SESSION_SECRET`.

Separate database connections by purpose: the application and Worker use `DATABASE_URL`; migrations use `DIRECT_URL`. If Node.js runs on the host, use addresses reachable from the host. The Compose hostname `postgres` does not apply to host processes.

The [container entrypoint](../../scripts/container-entrypoint.mjs) defines the production initialization order:

1. Provision the runtime database account, apply Prisma migrations, migrate the pg-boss schema, then grant and verify runtime permissions.
2. Run the member architecture migration and bootstrap script.
3. Start Web and Worker, then complete first setup.

`pnpm db:migrate` only applies Prisma migrations; it does not replace that sequence. `pnpm db:seed` writes seed data and belongs only in disposable development or test databases. Follow [Installation](installation.md) for a deployed system.

Once the development configuration and database initialization are complete, save the development settings in `.env.local` at the repository root, then start Web and Worker separately:

```sh
corepack pnpm dev
```

```sh
corepack pnpm exec tsx --env-file=.env.local src/worker/index.ts
```

Run the second command in another terminal; it explicitly loads `.env.local`. `pnpm dev:worker` does not load environment files itself, so use it only when the required variables are already exported in that terminal. Worker processes recognition, notifications, reminders, file cleanup, image optimization, and backups. It exits in mock mode.

`DEV_ENDPOINTS` is off by default. Enable development helper endpoints only in an isolated environment. Remote mode also requires a `DEV_ENDPOINTS_SECRET` of at least 32 characters. Ordinary interface development does not need these endpoints.

## Checks and tests

Choose checks for the change you are making. Run the project's full verification before submitting code.

| Command                           | Purpose                                                              |
| --------------------------------- | -------------------------------------------------------------------- |
| `corepack pnpm format`            | Check formatting                                                     |
| `corepack pnpm lint`              | Run ESLint                                                           |
| `corepack pnpm typecheck`         | Check application types                                              |
| `corepack pnpm typecheck:scripts` | Check script types                                                   |
| `corepack pnpm test`              | Run Vitest tests                                                     |
| `corepack pnpm build`             | Generate the Prisma client, build Next.js, and copy RE2 WASM assets  |
| `corepack pnpm verify`            | Run formatting, lint, both type checks, tests, and build in sequence |

Install a browser before the first browser test run:

```sh
corepack pnpm exec playwright install --with-deps chromium
corepack pnpm test:e2e --project=chromium
```

The default Playwright configuration starts a mock server itself. Real backend tests use a separate configuration and preparation scripts. Read the [remote test launcher](../../scripts/run-remote-e2e.mjs) before running `pnpm test:e2e:remote`; its data preparation must not target production databases.

## Code and documentation changes

Check both language resources and language switching when adding interface text. For business rule changes, cover relevant success, rejection, and repeated-operation cases. Put database changes in `prisma/migrations`; do not edit the generated Prisma client by hand.

Read [Architecture](architecture.md) for the technical layout. Contribution procedures and CLA requirements are in [CONTRIBUTING.md](../../CONTRIBUTING.md) and [CLA.md](../../CLA.md).
