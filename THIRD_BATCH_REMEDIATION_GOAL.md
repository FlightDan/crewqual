# CrewQual 第三批修复：可验收、可审计执行目标

版本：1.0  
制定日期：2026-08-16（Asia/Shanghai）  
适用仓库：`/root/crewqual`  
当前基线：Alpha；TypeScript、ESLint、167 条 Vitest、Next.js production build 已通过；上一轮 remote E2E 为 12/12；最新 Docker 镜像尚未验证。

## 1. Goal

在不降低现有认证、授权、审计、数据完整性和测试门槛的前提下，完成本文 B3-001 至 B3-018 的全部修复，使 CrewQual 从当前 Alpha 推进到“可受限真实用户验收的 Production-capable Alpha”。

Goal 只有在以下条件同时成立时才可标记 complete：

1. B3-001 至 B3-018 全部满足各自验收标准，没有用隐藏功能、删除配置选项、改成 Mock、只改 UI 文案或跳过测试的方式规避问题。
2. 所有数据库变更均有可重复执行的 Prisma migration、迁移前数据审计和迁移后约束验证。
3. 核心业务门禁、remote PostgreSQL/S3/pg-boss E2E、三浏览器 E2E、生产构建和最新 Docker/Compose 启动全部通过。
4. 生成 `docs/third-batch-execution-report.md`，逐项记录实现文件、migration、测试、实际命令、结果和已知限制。
5. 没有 P0/P1 未解决缺陷；允许保留的 P2 必须在执行报告中说明风险、临时控制和后续 owner。

## 2. 审计原则

证据优先级：

`实际运行行为 > remote E2E > integration test > implementation > unit test > 文档/注释`

执行期间必须遵守：

- Server side 是业务规则和权限的最终权威；客户端计算只能用于预览。
- AI 永远不能直接批准资质，人工审批是唯一生效入口。
- 不能以“内网使用”为理由跳过 IDOR、RBAC、CSRF、并发和数据约束。
- 禁止把生产流程切回 Mock 来使测试通过。
- 禁止覆盖或删除无关的用户改动。
- 每个问题先增加能复现缺陷的失败测试，再实现修复。
- 迁移前必须检查冲突数据；发现不安全数据时停止自动迁移并给出修复报告。

## 3. 范围与任务清单

### A. 资质数据正确性与规则闭环

#### B3-001 审批防止旧申请覆盖新正式资质（P0）

仓库事实：`QualificationUpdateRequest.expectedVersion` 在提交时保存，但审批只校验申请自身 `version`，没有验证当前 ACTIVE `QualificationRecord.version`。

必须实现：

- 审批时，在同一事务中读取并锁定/条件更新当前 ACTIVE 记录。
- 更新申请要求当前 ACTIVE 记录版本等于 `request.expectedVersion`。
- 新增申请要求审批时仍不存在同类 ACTIVE 记录。
- 冲突返回结构化 `409 QUALIFICATION_CHANGED_SINCE_SUBMISSION`，不得替换新记录。
- 审计日志记录冲突，但不得写入敏感凭证原文。

验收：

- “提交申请 → 管理员直接修改正式资质 → 审批旧申请”返回 409，正式资质保持管理员修改后的值。
- “提交新增申请 → 管理员先直接新增同类资质 → 审批”返回 409。
- 并发双审批最多一个成功，始终只有一条 ACTIVE 记录。

#### B3-002 审批和人工纠正使用规则快照（P0）

必须实现：

- 审批和纠正使用 `qualificationRuleSnapshot.validityRule`，不得使用后来修改的当前配置。
- 对 snapshot 做严格 schema validation；无效 snapshot 返回可诊断错误。
- 为存量 null snapshot 提供迁移前审计和安全回填策略；无法可靠回填的 PENDING 申请不得自动审批。
- 人工纠正保存前执行与审批相同的规则、参数和日期校验。

验收：

- 提交后修改 QualificationType 规则，旧申请仍按提交时规则审查。
- 纠正为违反 snapshot 的值时返回 422 和字段级错误。

#### B3-003 完整实现 trainingDate（P0）

必须实现：

- `QualificationRecord`、`QualificationUpdateRequest`、submitted fields、规则快照消费、API、serializer、audit、CSV、Pilot/Admin 表单和审核 comparison 全部支持 nullable `trainingDate`。
- fixed-month + trainingDate 由服务端计算最终 expiryDate。
- migration 使用适合业务日期的数据库类型并验证存量数据。

验收：

- trainingDate 固定月数规则可由 Pilot 提交、Reviewer 纠正、Admin 审批并生成正式记录。
- 到期日月末处理有测试，例如 1 月 31 日加 1 个月。

#### B3-004 有效期感知表单与服务端归一化（P0）

必须实现：

- Pilot qualification detail 和 Admin management meta 返回 validity rule/version。
- `non_expiring` 隐藏或禁用 expiryDate，提交 null。
- `manual_expiry` 要求人工输入有效到期日。
- `fixed_months` 显示只读预览；服务端重新计算并覆盖/拒绝不一致值。
- 所有写入口，包括 Pilot 提交、Admin 新增/修改、CSV、Reviewer 纠正和审批，调用同一 domain service。

验收：

- issueDate fixed、trainingDate fixed、manual、non-expiring 四种规则均有 API/integration 和 remote browser E2E。
- 不可能通过直接调用 API 绕过规则。

#### B3-005 参数限制成为可执行规则（P1）

必须实现：

- 将自由文本说明与可执行限制分离。
- 可执行结构至少支持：关闭、allowed values、正则/格式规则之一；schema 必须版本化。
- Pilot、Admin、CSV、纠正和审批均在服务端强制执行。
- 旧的 description 仅作帮助文本，不得被声称为已强制执行。

验收：

- 非法等级/参数从每个写入口均返回相同字段级 422。
- 修改配置后，历史申请继续按 snapshot 中的限制处理。

#### B3-006 资质快照和 Evidence 数据完整性（P1）

必须实现：

- 审计并回填所有应存在但为 null 的 qualification rule snapshot。
- 在迁移前检测重复 Evidence 关系。
- 数据库保证一张 EvidenceImage 不能被重复用于多个独立 evidence 关系，同时允许审批后同一关系关联 request 和最终 record。
- 保留“一人同类资质最多一条 ACTIVE”的数据库约束并增加真实并发测试。

验收：

- 数据完整性 SQL 检查返回零冲突。
- 绕过应用直接制造重复 evidence/ACTIVE 记录时数据库拒绝。

### B. 通知真正可达、可重试、可审计

#### B3-007 建立统一通知事件与路由服务（P0）

必须实现：

- 审批通过、审核退回、升级计划创建/恢复、节点改期/完成、资质到期和投递失败全部通过统一 domain/outbox 服务创建通知。
- 按 Pilot 所属单位选择明确的 notification route。
- 每个 event/recipient/channel 使用稳定 dedupe key。
- 不允许各 route handler 硬编码单一 `IN_APP`。

验收：

- 每种事件均能按单位配置生成正确渠道和目标。
- 重复业务请求或 Worker 重放不产生重复 delivery。

#### B3-008 修复多渠道幂等事务（P0）

必须实现：

- 每个渠道独立幂等创建，某个渠道已存在不得回滚其他新渠道。
- 只有成功创建的 delivery 才入队。
- created/queued 指标必须与实际提交结果一致。

验收：

- 先发送 IN_APP，随后路由新增 SMS/FEISHU；下一次扫描只补建新渠道。
- 两个 reminder Worker 并发扫描时每渠道最多一条 delivery。

#### B3-009 自动重试、指数退避和外部幂等（P0）

必须实现：

- 真正消费 integration `retryLimit` 和 timeout。
- 记录 attempt number、next attempt、错误类别、最终失败原因。
- 使用有上限的指数退避；达到上限进入明确终态并触发管理员可见告警。
- Webhook 请求携带稳定 idempotency key。
- 处理“外部已接受、数据库提交前崩溃”的重复发送风险。
- 手工 retry 只能对最终 FAILED 执行，并重置可审计的 retry cycle。

验收：

- 假服务前两次失败、第三次成功时，系统自动完成三次尝试并最终 SENT。
- 超过上限后停止重试，不形成无限任务。

#### B3-010 Pilot 站内通知收件箱（P0）

必须实现：

- 新增 Pilot scoped 通知列表、未读数、详情和标记已读 API/UI。
- 数据模型记录 `readAt` 或等价状态。
- Server side 强制 pilotId scope，不能读取其他 Pilot 通知。
- 在实际可读取前，IN_APP 不得被标记为“已送达用户”。

验收：

- Pilot 能看到自己的审批/退回/到期/升级通知并标记已读。
- IDOR 测试证明不能读取或修改他人的通知。

#### B3-011 通知设置与类型一致性（P1）

必须实现：

- 渠道 enabled 状态持久化；关闭后刷新仍保持关闭。
- 超级管理员必须显式选择被配置单位，不得隐式修改第一个 active unit。
- `NotificationType` 使用数据库 enum 或等价严格类型；包含所有实际事件，包括 `upgrade_created` 和 `pilot_access_link`。
- remote UI 不显示“Mock/演示”标签，Mock 环境仍清楚标识。

验收：

- 配置保存/刷新、跨单位隔离、未知 notification type 均有测试。

#### B3-012 Magic Link 安全投递（P1）

必须实现：

- Magic Link 投递失败可重试，但 raw token 不得写入普通通知日志、审计日志或长期明文队列 payload。
- 如需临时持久化，必须加密、有独立 TTL，并在成功/过期后清理。
- 连续请求时明确旧 token 失效行为，避免已发送短信中的链接无提示失效。

验收：

- 假 SMS 暂时失败后可自动重试并使用仍有效 token。
- 数据库和结构化日志搜索不到 raw token。

### C. OCR / AI 人工复核闭环

#### B3-013 将“字段提取”和“业务核验”分离（P1）

必须实现：

- VLM 只返回结构化提取字段、置信度和证据说明，不能直接决定 matched/approved。
- 服务端根据 submitted fields、Pilot 身份、rule snapshot 和 `ocrChecks` 确定 MATCHED/MISMATCH/UNCERTAIN/UNAVAILABLE。
- credential number、holder、expiry、issuing authority/seal 分项保存结论。
- 人工审批仍是唯一生效动作。

验收：

- 模型返回错误的 matched 状态不能绕过服务端 comparison。
- Reviewer 能看到每个检查项的来源、值、置信度和失败原因。

#### B3-014 OCR 任务幂等、复用和可靠性（P1）

必须实现：

- 上传后的预识别与提交后的核验复用同一有效 extraction，不重复调用模型。
- RecognitionTask 使用严格状态 enum、原子 claim、stale recovery、配置化 retryLimit 和 provider 名称。
- 同一 EvidenceImage 同一任务类型最多一个 active task。
- 失败/重放不会产生重复 VerificationResult。

验收：

- 同一图片上传并提交只发生一次 extraction 调用。
- 两个 Worker 并发消费同一任务时只有一个调用 provider。
- 本地假 VLM + PostgreSQL + pg-boss integration E2E 通过。

### D. 升级计划产品闭环

#### B3-015 检查项目模型与选择流程（P1）

必须实现：

- 新增规范化 `InspectionItem` 和 plan-item 关联模型；六个阶段与检查项目保持独立概念。
- 创建计划时可选择检查项目，并保存名称/规则版本快照。
- 检查项目可进入阶段、计划详情、完成记录和日历。

验收：

- 创建 → 选择检查项目 → 保存 → 日历/详情显示 → 完成，有真实 remote E2E。

#### B3-016 计划整体编辑与核心资质判断（P1）

必须实现：

- 为 DRAFT/NOT_STARTED 增加 versioned PATCH，可修改计划信息、日期区间、责任人、检查项目和阶段。
- ACTIVE 后只允许明确白名单字段，COMPLETED/CANCELLED 只读。
- before/after 写入 audit。
- 启动/恢复只检查 `qualificationType.core=true` 的资质；明确并实现核心资质缺失策略。

验收：

- 草稿修改后列表、详情和日历一致。
- 补充资质过期不会错误阻止计划；核心资质过期或缺失按规则阻止。

### E. 安全、数据库时间语义、部署和测试门禁

#### B3-017 安全与会话收口（P1）

必须实现：

- 管理员密码/TOTP 重置时撤销目标账号所有现有 session。
- 一次性迁移现有明文 TOTP 到 ciphertext，验证完成后移除 plaintext fallback；提供安全回滚说明。
- 管理脚本不得通过命令行参数暴露 TOTP secret。
- 明确 trusted proxy；不能直接信任任意客户端 `X-Forwarded-For`。
- 登录限流同时考虑可信客户端地址和账号标识；未知账号执行恒定成本密码检查，降低用户枚举。
- 活跃请求节流更新 session `lastSeenAt`。
- 增加 CSP，并保留 Caddy 现有 HSTS、nosniff、frame 和 permissions policy。

验收：

- 重置凭据后旧 cookie 立即返回 401。
- 伪造 X-Forwarded-For 不能绕过限流。
- 数据库不存在非空 plaintext TOTP。

#### B3-018 日期/时间、Docker、运行监控与最终门禁（P1）

必须实现：

- 业务日期使用 PostgreSQL DATE 或证明等价无时区语义；真实时间使用 TIMESTAMPTZ/明确 UTC 语义。
- 提供安全迁移和跨时区回归测试。
- 分离 web/worker Docker target；生产 Worker 不依赖完整开发源码和不必要 dev dependencies。
- Compose 增加 migration job、web/worker healthcheck；固定生产镜像版本，禁止关键服务使用 floating `latest`。
- 增加 Worker heartbeat，健康检查能区分 DB/queue 存在与 Worker 实际存活。
- 最新代码必须完成 Docker build、Compose 启动、migration、health、smoke E2E。
- 修复或明确消除 pg-boss/pg 并发 query deprecation warning。

验收：

- `docker compose build` 成功且构建上下文、镜像尺寸有记录。
- 全新空卷可以 migration 后启动；旧数据库可以无数据损失升级。
- 停止 Worker 后健康检查在阈值内报告 degraded/unavailable。

## 4. 测试与发布门禁

以下命令或等价 CI job 必须全部成功：

```sh
corepack pnpm format
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
NEXT_TELEMETRY_DISABLED=1 corepack pnpm build
corepack pnpm test:e2e
corepack pnpm test:e2e:remote
docker compose build
docker compose up -d postgres web worker caddy
```

必须新增的真实场景：

1. 四种有效期规则的 Pilot/Admin/CSV/Review 流程。
2. 旧申请与当前资质版本冲突。
3. Admin 直接新增资质及 duplicate race。
4. 多渠道 reminder 补发、并发扫描和自动 retry。
5. Pilot 站内通知 IDOR/已读。
6. 单次 OCR extraction、并发 claim、确定性 comparison。
7. 升级计划检查项目、整体修改和核心资质门禁。
8. 密码/TOTP 重置后的旧 session 失效。
9. 全新数据库 migration 与旧数据升级。
10. 最新 Docker/Compose 端到端 smoke。

## 5. 执行顺序

必须按依赖顺序推进：

1. 先增加缺陷复现测试和迁移前数据审计。
2. 完成 A：资质正确性；A 未通过不得进入 AI 自动核验优化。
3. 完成 B：通知闭环。
4. 完成 C：OCR/AI。
5. 完成 D：升级计划。
6. 完成 E：安全、时间语义、部署和全量门禁。

预计传统开发工作量：约 18–28 engineer-days。任何缩短工期都不能通过减少验收范围实现。

## 6. 最终审计报告格式

`docs/third-batch-execution-report.md` 至少包含：

- 每个 B3 编号的状态：Completed / Blocked / Not started。
- 变更文件和 migration 列表。
- 迁移前后数据审计 SQL 与结果摘要。
- 对应 unit/integration/E2E 测试名称。
- 所有门禁命令、日期、退出码和测试数量。
- Docker image/build context 尺寸和 Compose smoke 结果。
- 已知限制、剩余风险、临时控制和 owner。
- 最终判断：是否允许真实用户使用、是否允许生产部署，以及依据。

## 7. 明确的完成定义

以下任一情况存在时，Goal 不得标记 complete：

- trainingDate 或 non-expiring 仍只能配置、不能真实提交。
- 旧申请仍可能覆盖更新后的正式资质。
- IN_APP 仍只是管理员通知日志而 Pilot 不可读取。
- retryLimit 仍只是设置字段而没有自动重试行为。
- OCR 仍由模型自行决定 matched，或同一图片会重复 extraction。
- 升级计划仍没有检查项目或整体编辑。
- 密码/TOTP 重置后旧 session 仍有效。
- 最新 Docker/Compose 没有实际启动证据。
- remote E2E 只覆盖 happy path，未覆盖上述冲突、权限和失败场景。
