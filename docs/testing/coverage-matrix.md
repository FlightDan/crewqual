# CrewQual 全量测试覆盖矩阵

更新时间：2026-08-15（Asia/Shanghai）

状态含义：`已验证` 表示已有可重复的自动化证据；`部分覆盖` 表示有主链或页面冒烟证据，但仍缺少角色/错误/remote 等 DoD 要求；`待运行` 表示本轮没有该项证据；`环境阻塞` 表示需要测试 PostgreSQL/MinIO/pg-boss 的 remote 证据；`人工复核` 表示自动化无法替代的视觉或辅助技术复核。

## 页面覆盖

| 页面                                                                                | 角色/入口                  | mock 单测               | mock E2E                                                     | 响应式/a11y                                        | 状态     |
| ----------------------------------------------------------------------------------- | -------------------------- | ----------------------- | ------------------------------------------------------------ | -------------------------------------------------- | -------- |
| `/`, `/admin`                                                                       | 未登录/管理员              | 共享布局                | `responsive-accessibility`, `admin-flow`                     | 根入口已验证；`/admin` 单独重定向未断言            | 部分覆盖 |
| `/admin/login`                                                                      | 未登录管理员               | 登录表单/认证单测       | `responsive-accessibility`                                   | 键盘字段可达；负向认证/remote 未运行               | 部分覆盖 |
| `/admin/forbidden`                                                                  | 无权限管理员               | 共享布局                | `admin-flow`                                                 | 权限页面未单独断言                                 | 部分覆盖 |
| `/admin/dashboard`                                                                  | `dashboard.read`           | dashboard 组件/服务     | `admin-flow`, `responsive-accessibility`                     | mock 主链和视口冒烟通过                            | 部分覆盖 |
| `/admin/calendar`                                                                   | `calendar.read`            | 日历工具/组件           | `admin-operations`, `responsive-accessibility`               | mock 主链、断言和视口冒烟通过                      | 部分覆盖 |
| `/admin/pilots`, `/admin/pilots/[pilotId]`                                          | `pilots.read/write`        | 飞行员组件/校验         | `admin-flow`, `admin-operations`, `responsive-accessibility` | mock 搜索/管理/详情和视口冒烟通过                  | 部分覆盖 |
| `/admin/qualification-config`                                                       | `operations.read/write`    | 资质配置组件/校验       | `admin-operations`, `responsive-accessibility`               | mock 保存/版本/视口冒烟通过                        | 部分覆盖 |
| `/admin/reviews`, `/admin/reviews/[reviewId]`                                       | `reviews.read/write`       | 审核列表、审批、纠正    | `admin-flow`, `responsive-accessibility`                     | mock 审批/纠正/退回/详情和视口冒烟通过             | 部分覆盖 |
| `/admin/notifications`                                                              | `notifications.read`       | 通知组件/状态           | `admin-operations`, `responsive-accessibility`               | mock retry/筛选/详情和视口冒烟通过                 | 部分覆盖 |
| `/admin/settings`                                                                   | `settings.read/write`      | 设置表单/外发保护       | `admin-operations`, `responsive-accessibility`               | mock 设置/外发保护和视口冒烟通过                   | 部分覆盖 |
| `/admin/upgrade-plans`, `/admin/upgrade-plans/new`, `/admin/upgrade-plans/[planId]` | `upgrade_plans.read/write` | 计划规则、服务状态机    | `admin-operations`, `responsive-accessibility`               | mock 状态机/三步流程/详情和视口冒烟通过            | 部分覆盖 |
| `/pilot/access/[token]`                                                             | 飞行员访问链接             | pilot flow 组件         | `pilot-flow`                                                 | mock 使用 identity 开发入口，真实 token 交换未覆盖 | 部分覆盖 |
| `/pilot/identity`                                                                   | 飞行员会话                 | 身份校验                | `pilot-flow`, `responsive-accessibility`                     | mock 身份到提交主链通过                            | 部分覆盖 |
| `/pilot/qualifications`, `/pilot/qualifications/[qualificationId]/update`           | 飞行员                     | 资质/更新组件、日期规则 | `pilot-flow`, `responsive-accessibility`                     | mock 手填/禁用 AI/提交和视口冒烟通过               | 部分覆盖 |
| `/pilot/submissions/[submissionId]`                                                 | 飞行员                     | 提交状态组件            | `pilot-flow`                                                 | mock 成功回执通过；不存在/跨 Pilot/remote 未覆盖   | 部分覆盖 |

`/dev/*` 页面仅为开发组件预览，不属于生产 Definition of Done；它们仍由构建路由清单覆盖。

## API 覆盖

所有 API 都必须覆盖：未登录、角色/权限、输入 schema、资源不存在、冲突/版本、成功副作用和失败响应（包括 `requestId`）；下表记录当前自动化证据边界。

| API                                                                    | 主要场景                                         | mock 单测/服务                            | mock E2E                            | remote E2E                     | 状态     |
| ---------------------------------------------------------------------- | ------------------------------------------------ | ----------------------------------------- | ----------------------------------- | ------------------------------ | -------- |
| `/api/admin/login`, `/logout`, `/session`                              | 管理员会话、权限                                 | `auth`, service boundary, route inventory | 页面间接覆盖                        | 待运行                         | 部分覆盖 |
| `/api/admin/dashboard`                                                 | KPI、资质预警、周升级节点                        | mock admin service                        | `admin-flow`                        | 待运行                         | 部分覆盖 |
| `/api/admin/calendar`, `/calendar/[id]`, `/calendar/qualifications`    | 日历查询、详情、资质选项                         | calendar utils/service                    | `admin-operations`                  | 待运行                         | 部分覆盖 |
| `/api/admin/pilots`, `/pilots/[pilotId]`, `/pilots/meta`               | 列表、详情、创建、编辑、删除                     | pilot validation/service                  | `admin-flow`, `admin-operations`    | 待运行                         | 部分覆盖 |
| `/api/admin/pilots/[pilotId]/qualifications/[qualificationId]`         | 资质人工维护、版本冲突                           | validation/service                        | `admin-operations`                  | 待运行                         | 部分覆盖 |
| `/api/admin/pilots/import-preview`, `/import`, `/import-template`      | CSV 预览、导入、模板                             | import validation/service                 | `admin-operations`                  | 待运行                         | 部分覆盖 |
| `/api/admin/qualification-configs`, `/qualification-configs/[id]`      | 核心/补充资质配置、启停、版本                    | validation/service                        | `admin-operations`                  | 待运行                         | 部分覆盖 |
| `/api/admin/reviews`, `/reviews/[reviewId]`                            | 审核列表与详情                                   | admin repository/service                  | `admin-flow`                        | 待运行                         | 部分覆盖 |
| `/api/admin/reviews/[reviewId]/approve`                                | 审批、生成正式资质                               | mock service                              | `admin-flow`                        | 待运行                         | 部分覆盖 |
| `/api/admin/reviews/[reviewId]/correction`, `/return`                  | 纠正、退回、版本冲突                             | review schema/repository                  | `admin-flow`                        | 待运行                         | 部分覆盖 |
| `/api/admin/notifications`, `/notifications/[id]`, `/summary`          | 通知列表、详情、汇总                             | notification service                      | `admin-operations`                  | 待运行                         | 部分覆盖 |
| `/api/admin/notifications/[id]/retry`                                  | 失败通知重试、attempt 入队                       | worker/provider tests                     | `admin-operations`                  | 待运行                         | 部分覆盖 |
| `/api/admin/settings`                                                  | 设置读取、保存、连接测试                         | settings tests；非本地外发保护            | `admin-operations`                  | 待运行                         | 部分覆盖 |
| `/api/admin/upgrade-plans`, `/upgrade-plans/[id]`                      | 计划查询、创建、详情                             | upgrade rules/service                     | `admin-operations`                  | 待运行                         | 部分覆盖 |
| `/api/admin/upgrade-plans/[id]/[action]`                               | start/pause/resume/cancel、并发冲突              | upgrade rules tests                       | `admin-operations`                  | 待运行                         | 部分覆盖 |
| `/api/admin/upgrade-plans/[id]/stages/[stageId]/[action]`              | 节点 reschedule/complete、自动推进               | upgrade rules tests                       | `admin-operations`                  | 待运行                         | 部分覆盖 |
| `/api/dev/pilot-access`                                                | mock 开发入口                                    | mock service                              | `pilot-flow`                        | 排除                           | 已隔离   |
| `/api/pilot/access-link`, `/pilot/session`                             | 飞行员链接/会话                                  | pilot service/auth tests                  | `pilot-flow`                        | 待运行                         | 部分覆盖 |
| `/api/pilot/qualifications`, `/pilot/qualifications/[qualificationId]` | 资质列表、详情                                   | pilot service                             | `pilot-flow`                        | 待运行                         | 部分覆盖 |
| `/api/pilot/submissions`, `/pilot/submissions/[id]`                    | 提交创建、详情、原始字段快照、状态映射、错误契约 | validation/status/route tests             | `pilot-flow`                        | 待运行                         | 部分覆盖 |
| `/api/evidence-images`, `/evidence-images/[id]/url`, `/recognitions`   | 上传、私有 URL、OCR 识别结果                     | image/VLM/provider tests                  | AI 识别排除；上传/URL remote 待运行 | 待运行                         | 部分覆盖 |
| `/api/recognitions/[id]`                                               | 识别结果审核/更新                                | VLM/service tests                         | AI 识别链路按范围排除               | 排除                           | 已排除   |
| `/api/health`                                                          | mock/remote DB、queue、storage 诊断              | health/route tests                        | mock route tests                    | remote harness readiness probe | 部分覆盖 |

## 后台任务和外部边界

| 组件                                          | 证据要求                                                      | 当前状态                                                                                      |
| --------------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `src/worker/index.ts` / `notifications` queue | queued→processing→sent/failed、重试、幂等、租约、attempt 记录 | handler、生命周期单测；remote 审批链路触发真实 worker 与通知队列                              |
| pg-boss                                       | mock 不触网；remote 使用真实 PostgreSQL 并验证 job/worker     | 真 PostgreSQL/pg-boss + 假 VLM 重放门禁通过；remote 18/6；Compose 12 张表和 Worker 心跳通过   |
| PostgreSQL/Prisma                             | migration、seed、事务、版本冲突、并发唯一约束                 | 24 migrations；remote 409/并发双审批/直接唯一约束通过；新旧数据库部署通过                     |
| S3/MinIO                                      | 私有对象、预签名 URL、失败/过期                               | provider 单测；remote 验证真实私有对象上传/读取；Compose 空桶初始化通过                       |
| SMS/Feishu/Webhook                            | 测试期间不得真实外发                                          | config/provider guard tests、`CREWQUAL_TEST_NO_EXTERNAL=1`；五次 mock、三次 remote 无外呼错误 |
| Qwen/VLM                                      | 测试期间不得请求模型                                          | VLM guard/provider tests；五次 mock、三次 remote 无外呼错误；AI 识别 API 按范围排除           |

## 浏览器矩阵

mock 与 remote E2E 当前均配置 Chromium + WebKit + Firefox；2026-08-16 最新 mock 全量为 126/126，remote 为 18 passed/6 intentional skips。mock 覆盖 390×844、390×600、768×1024、1023×900、1024×900、1280×900、1440×1024，且有键盘/语义名称/横向溢出断言；每个生产页面的 critical/serious axe 违规检查也已在三浏览器通过。焦点可见性、屏幕阅读器和视觉遮挡仍需人工复核；最新 Caddy Compose 已完成空卷启动、健康故障注入和恢复。
