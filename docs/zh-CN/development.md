# 开发指南

[English](../en/development.md) · [文档目录](README.md)

## 本地界面预览

仓库的 Dockerfile 和 CI 使用 Node.js 22.12，包管理器固定为 pnpm 10.15.0。先安装匹配的工具版本，在仓库根目录运行：

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm db:generate
SERVICE_MODE=mock NEXT_PUBLIC_SERVICE_MODE=mock corepack pnpm exec next dev --hostname 127.0.0.1 --port 3000
```

以上命令适用于 Bash，包括 Linux 和 WSL2。打开 `http://127.0.0.1:3000` 查看管理端；`/dev/pilot-flow` 提供成员流程和识别状态的预览入口，`/dev/ui-kit` 提供组件预览。生产环境不开放 `/dev` 页面。

`mock` 模式使用模拟服务，不能用于验证真实数据库写入、短信投递或对象存储。预览不需要复制生产用的 `.env.example`。如果本地已有 `.env` 或 `.env.local`，请检查其中的设置，避免混入生产连接信息。

`pnpm dev` 默认监听 `0.0.0.0:3000`。上面的命令只监听本机，适合个人开发；需要跨设备预览时再调整监听地址。

## 使用真实服务开发

`remote` 模式需要独立的开发数据库和对象存储。参照[配置参考](configuration.md)准备环境，并将 `SERVICE_MODE` 与 `NEXT_PUBLIC_SERVICE_MODE` 均设为 `remote`。`SESSION_SECRET` 在所有真实服务环境中都必填。

数据库连接应区分用途：应用和 Worker 使用 `DATABASE_URL`，迁移使用 `DIRECT_URL`。如果在宿主机运行 Node.js，连接地址必须能从宿主机访问；Compose 内的 `postgres` 主机名不适用于宿主机进程。

生产式初始化顺序可在 [容器入口脚本](../../scripts/container-entrypoint.mjs)中核对：

1. 创建运行时数据库账号，应用 Prisma 迁移，迁移 pg-boss 队列结构，再授予并校验运行时权限。
2. 执行成员架构迁移和初始化脚本。
3. 启动 Web 与 Worker，完成首次设置。

`pnpm db:migrate` 仅执行 Prisma 迁移；它不代替上述完整顺序。`pnpm db:seed` 写入种子数据，只应对可丢弃的开发或测试数据库运行。正式部署按[安装指南](installation.md)操作。

在已完成配置和数据库初始化的开发环境中，将开发配置保存到仓库根目录的 `.env.local`，再分别启动 Web 和 Worker：

```sh
corepack pnpm dev
```

```sh
corepack pnpm exec tsx --env-file=.env.local src/worker/index.ts
```

第二条命令在另一个终端执行，并显式加载 `.env.local`。`pnpm dev:worker` 本身不读取环境文件，仅在所需变量已导出到当前终端时使用。Worker 负责识别、通知、提醒、文件清理、图像优化和备份任务。模拟模式下 Worker 会退出。

`DEV_ENDPOINTS` 默认关闭。开发辅助接口只应在隔离环境中开启，真实服务模式还要求配置至少 32 个字符的 `DEV_ENDPOINTS_SECRET`。普通界面开发不需要这些接口。

## 检查与测试

根据改动选择检查；提交代码前运行项目要求的完整验证。

| 命令                              | 用途                                                 |
| --------------------------------- | ---------------------------------------------------- |
| `corepack pnpm format`            | 检查格式                                             |
| `corepack pnpm lint`              | ESLint 检查                                          |
| `corepack pnpm typecheck`         | 应用类型检查                                         |
| `corepack pnpm typecheck:scripts` | 脚本类型检查                                         |
| `corepack pnpm test`              | Vitest 测试                                          |
| `corepack pnpm build`             | 生成 Prisma 客户端、构建 Next.js、复制 RE2 WASM 资源 |
| `corepack pnpm verify`            | 依次执行格式、Lint、两类类型检查、测试和构建         |

首次运行浏览器测试时安装浏览器，再执行：

```sh
corepack pnpm exec playwright install --with-deps chromium
corepack pnpm test:e2e --project=chromium
```

默认 Playwright 配置自行启动模拟服务。真实后端测试使用独立配置和准备脚本；阅读 [remote 测试启动脚本](../../scripts/run-remote-e2e.mjs)后再运行 `pnpm test:e2e:remote`，其中的数据准备不应用于生产数据库。

## 代码与文档变更

新增界面文字时检查中英文资源和语言切换。业务规则变更应覆盖成功、拒绝和重复操作等相关场景。数据库结构变更放入 `prisma/migrations`，不要手改生成的 Prisma 客户端。

技术说明见[架构文档](architecture.md)。贡献流程与 CLA 要求见 [CONTRIBUTING.md](../../CONTRIBUTING.md) 和 [CLA.md](../../CLA.md)。
