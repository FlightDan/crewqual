# 测试缺陷与风险台账

更新时间：2026-08-15（Asia/Shanghai）

| ID    | 严重度 | 问题/风险                                                                                              | 处置                                                                                   | 证据/状态                                                            |
| ----- | ------ | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| D-001 | P1     | 同源校验在 `APP_ORIGIN` 缺失时曾退化为允许所有 Origin                                                  | 改为使用 validated server config；补同源边界测试                                       | 已修复；mock 两次完整回归通过                                        |
| D-002 | P1     | 审核纠正可能覆盖原始提交字段，且详情 correction 曾为空                                                 | 增加 `submittedFields` 快照、完整纠正 schema、审计详情和版本控制                       | 已修复；mock 审核纠正/审批回归通过，remote 待迁移                    |
| D-003 | P1     | 通知 retry 可重复创建 attempt，且状态约束不足                                                          | 仅 FAILED 可 retry；事务先写 QUEUED attempt；worker 缺 attempt 时补齐                  | 已修复；mock retry/attempt 回归通过，remote 待迁移                   |
| D-004 | P1     | 升级计划生命周期、节点日期和并发 active plan 约束不完整                                                | 增加集中规则、事务重检、partial unique index、节点完成校验                             | mock 规则/状态机回归通过；remote migration 阻塞                      |
| D-005 | P1     | 设置连接测试可能访问任意外部 URL                                                                       | 测试模式只允许 localhost/loopback fake endpoint；remote adapters disabled              | 已修复；五次 mock、三次 remote 均无外呼错误                          |
| D-006 | P1     | build page-data 暴露 refined Zod schema 不可组合问题                                                   | 拆分 base schema 与 refined schema                                                     | 已修复；本轮 build 通过                                              |
| D-007 | P1     | remote PostgreSQL 曾可连接但落后 5 个 Prisma migrations；自动部署会改变该数据库 schema                 | 已按授权部署 5 个 migrations，并完成首轮 remote 验证                                   | 已关闭；迁移后首轮 remote 12/12 通过                                 |
| D-008 | P2     | responsive/a11y 仍需按 desktop/tablet/mobile 和键盘/语义矩阵采证                                       | 新增逐页隔离的多视口、键盘焦点、语义名称、横向溢出和 axe 检查                          | 三浏览器五次 126/126 自动化检查通过；屏幕阅读器/视觉遮挡仍未人工复核 |
| D-009 | P2     | remote 侧两次连续全量回归和无 flaky retry 尚未完成                                                     | 标准命令自动准备独立 pilot 并完成连续 remote 全量回归                                  | 已关闭；修复后连续三轮各 12/12，无 retry                             |
| D-010 | P2     | 浏览器矩阵曾缺 Firefox，导致关键浏览器证据不完整                                                       | 安装 Firefox 并纳入完整三浏览器回归                                                    | 已关闭；mock 五次、remote 三次完整回归均通过                         |
| D-011 | P2     | 缺失 multipart body 曾被通用异常处理为 500，而非输入错误                                               | 捕获 `request.formData()` 解析异常并返回 `INVALID_IMAGE`/422；补路由测试               | 已修复；缺失 body 与非 JPEG 均结构化 422                             |
| D-012 | P1     | 提交详情曾把数据库中的 `PENDING/APPROVED/RETURNED` 都返回为 `received`，提交创建错误也依赖通用异常映射 | 增加持久化状态映射、decision note/return reason、创建错误显式契约，并补路由和组件测试  | 已修复；mock 主链和 161 个单测通过；remote 提交/审批主链通过         |
| D-013 | P2     | health endpoint 曾把“配置了 storage”误报成 storage 可用                                                | 增加 S3 `HeadBucket` 探针和 `ok/unconfigured/unavailable` 结果                         | 已修复；health helper/route 测试及 remote readiness probe 通过       |
| D-014 | P2     | 全量 axe 检查发现颜色对比度和 calendar grid ARIA 语义问题                                              | 收紧全局颜色 token，修正 calendar grid 的 row/header 结构                              | 已修复；三浏览器五次 126/126，critical/serious axe 全绿              |
| D-015 | P2     | WebKit 平板测试复用 page 跨路由导致偶发导航竞态                                                        | 每条平板路由使用独立 page，并提高该测试超时上限                                        | 已修复；后续五次全量无 retry、126/126                                |
| D-016 | P2     | Docker/Caddy 的服务拓扑和安全头此前只有配置文件，没有自动化静态护栏                                    | 增加 Compose/Caddy 配置静态测试；真实 compose 启动仍需可用 Docker 环境                 | 静态检查已修复；真实启动未运行，环境受 Docker socket/Compose 限制    |
| D-017 | P2     | API 路由鉴权与结构化错误出口此前主要依赖页面间接覆盖，新增路由可能漏加护栏                             | 增加动态 route inventory 测试，盘点生产路由、鉴权、来源校验和公开入口                  | 已修复；route inventory 通过，remote 三轮回归通过                    |
| D-018 | P2     | remote E2E 跨轮次复用固定 rate-limit 地址和业务 fixture，无法直接形成独立连续回归证据                  | 请求地址改为每轮随机命名空间；`test:e2e:remote` 自动使用独立 pilot，不删除历史业务记录 | 已关闭；remote 连续三轮各 12/12，无 retry                            |

当前没有已确认的 P0/P1 业务逻辑缺陷；D-008 仍保留屏幕阅读器和视觉遮挡的人工复核缺口，Caddy compose 真实启动也未在本机运行，但不影响已完成的应用测试门禁证据。
