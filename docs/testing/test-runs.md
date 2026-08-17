# 测试运行记录

更新时间：2026-08-16（Asia/Shanghai）

> 第三批最终证据和逐项映射见 `docs/third-batch-execution-report.md`。下文保留 2026-08-15 的历史连续回归记录；最新工作树门禁为 Vitest 194/194、mock E2E 126/126、真 PostgreSQL/pg-boss + 假 VLM 重放门禁通过、remote E2E 18 passed/6 intentional skips，并已实际完成空卷 Docker/Compose/Caddy/Worker 心跳故障注入。

## 当前工作树门禁

| 顺序 | 命令                            | 结果 | 备注                                                                                                                    |
| ---- | ------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------- |
| 1    | `corepack pnpm format`          | 通过 | Prettier 全仓检查                                                                                                       |
| 2    | `corepack pnpm lint`            | 通过 | ESLint 忽略生成目录；无 lint error                                                                                      |
| 3    | `corepack pnpm typecheck`       | 通过 | `tsc --noEmit`                                                                                                          |
| 4    | `corepack pnpm test`            | 通过 | 53 个文件、194 个测试                                                                                                   |
| 5    | `corepack pnpm build`           | 通过 | Prisma generate、Next compile、page data、static pages、traces 全部完成                                                 |
| 6    | `corepack pnpm test:e2e`        | 通过 | 最新工作树 Chromium + WebKit + Firefox 126/126，无 retry；本次 6.1m，含 critical/serious axe                            |
| 7    | `corepack pnpm test:e2e:remote` | 通过 | 24 个 migration；最新工作树 18 passed/6 intentional skips，三个浏览器执行上传/审批/收件箱，持久对抗场景在 Chromium 执行 |

门禁顺序遵循 `FULL_TEST_GOAL.md`：format → lint → typecheck → test → build → mock E2E → remote E2E；typecheck 与 build 不并行。早期 mock 运行曾因搜索结果请求期间旧列表导致严格定位失败；修复加载态和等待唯一结果后，最终五次独立三浏览器全量均 126/126。中间另有一次 125/126 的 WebKit 平板导航竞态，已通过每条路由隔离 page 修复；该次不计入连续完整回归，修复后的五次运行均无 retry。

## 已知前置修复

- 修复生成目录导致的 lint 噪声；生成的 `src/generated` 和 `.next-dev` 不作为业务源代码检查。
- 修复 qualification config schema 在构建期对带 refinement 的 Zod object 调用 `.omit/.extend` 的异常。
- 资质提交保存 `submittedFields` 不可变快照，审核纠正只更新正式当前值，不覆盖原始提交。
- 升级计划增加生命周期、日期、节点完成规则和 active plan 数据库唯一约束。
- 通知 retry 只允许 FAILED，并在入队前写入 QUEUED attempt。
- API transport/error contract、健康检查（含真实 storage probe 边界）、worker handler/lifecycle、提交状态映射、资源不存在 404、JPEG 校验、外发 endpoint 安全边界和 100+ 条目分页均补齐了可重复单测；曾发现缺失 multipart body 返回 500，已修复为结构化 `INVALID_IMAGE`/422。
- 配置/provider/VLM 的 production secret、禁用外发和禁用模型请求边界均有单测；生产页面 axe critical/serious 检查已通过。
- 提交创建路由的资质/凭证不存在、证据不可用、版本冲突、重复提交和证据抢占竞态均返回结构化错误；Docker Compose/Caddy 服务拓扑、安全头和默认外发护栏已有静态检查。
- 动态 API 路由盘点测试确认生产路由都有结构化错误出口；管理员/飞行员鉴权、变更请求来源校验和公开运维入口均有显式护栏，开发入口按排除项单独保护。
- 测试和 remote E2E 显式禁用真实 SMS、Feishu、Webhook、VLM 外呼。

## 失败和环境记录

首次 build 曾在 `/api/admin/qualification-configs` page-data 阶段失败；错误为 `.omit() cannot be used on object schemas containing refinements`。修复 base schema 后复跑通过。

远程门禁最初因 `The column Pilot.active does not exist in the current database` 失败。已按授权部署以下 5 个迁移：`20260814005000_fix_admin_role_permissions`、`20260815000000_admin_settings_center`、`20260815000000_pilot_management`、`20260815001000_submission_original_fields`、`20260815002000_active_upgrade_plan_unique`；首轮迁移后 remote 12/12 通过。

重复 remote 回归随后发现两项测试隔离问题：管理员登录使用固定请求地址导致跨轮次 rate-limit bucket 污染，已改为每轮随机隔离地址；失败回归留下的 `CQ-1049` 申请会触发真实的 `DUPLICATE_SUBMISSION` 业务保护。未删除业务记录，新增 `db:e2e:prepare` 和 `test:e2e:remote` 包装器为每轮自动创建独立 pilot，并按本轮 pilot/证件编号精确定位审核申请；修复后连续三轮 remote 均 12/12。

2026-08-15 的历史轮次仅使用 remote harness。2026-08-16 已补做最新镜像的真实 Compose 空卷启动：24 个 migration、MinIO bucket、12 张 pg-boss 表、Web/Worker healthy 和 Caddy `/api/health` 均通过；停止 Worker 后返回 503，恢复后返回 200。

## 重复回归

mock 侧已满足“两次连续完整回归且无 flaky retry”：稳定性修复后连续五次独立启动 mock Next 服务，均运行 126 tests，Chromium/WebKit/Firefox 全绿，axe critical/serious 检查全绿。一次单独的中间运行曾报 WebKit 路由导航竞态（125/126），修复后重新完成五次连续全绿运行。remote 侧先记录了迁移前的失败、rate-limit 污染和固定 pilot 残留问题；完成 5 个迁移、seed、随机 rate-limit 地址和自动 run-scoped pilot 后，连续三轮各 12/12，无 retry。

## 本轮环境与安全证据

- mock E2E webServer 强制 `NODE_ENV=development SERVICE_MODE=mock NEXT_PUBLIC_SERVICE_MODE=mock CREWQUAL_TEST_NO_EXTERNAL=1`；五次运行均未出现外呼错误，真实 SMS、Feishu/Webhook、VLM 不在测试路径。
- remote harness 使用独立测试 endpoint：PostgreSQL `127.0.0.1:55432`、MinIO `127.0.0.1:59000`，并显式设置 `CREWQUAL_TEST_NO_EXTERNAL=1`；5 个迁移和 `db:seed` 已按授权完成；标准 `test:e2e:remote` 每轮自动创建隔离 pilot，不删除历史业务记录。
- Firefox 已安装并纳入 mock 五次及 remote 三次完整三浏览器回归：mock 每次 126/126、remote 每次 12/12 全绿，覆盖审核、飞行员、升级计划、通知、配置、响应式和键盘路径。
- 系统未预装 Docker Compose plugin；2026-08-16 使用校验过的 Compose v2.29.7 二进制和 Docker socket 完成隔离启动。构建上下文约 2.48 MB，Web/Worker/Migration 镜像和故障恢复数据见第三批报告。
