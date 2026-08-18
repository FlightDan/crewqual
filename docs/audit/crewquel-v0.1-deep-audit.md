# CrewQuel / CrewQual v0.1 上线前深度审计报告

> 审计日期：2026-08-18（Asia/Shanghai）  
> 审计对象：`/root/crewqual` 当前工作树，而非一个干净、不可变的发布提交  
> 审计方式：只读静态审计、隔离数据库验证、容器构建/运行验证、浏览器 E2E、故障注入；未连接生产系统，未调用真实短信、飞书、对象存储或 AI 服务  
> 唯一仓库变更：本报告

# 1. 上线结论

**NO-GO：当前不应投入生产。**

直接依据如下：

1. 已复现一个 P0：31 个迁移虽然能在空 PostgreSQL 16 数据库全部执行，但紧随其后的生产 bootstrap 必然因为缺少 `settings.positions.write` 权限而退出；Compose 中 Web 和 Worker 都依赖 bootstrap 成功，因此全新生产部署无法启动。
2. 已复现默认数据库备份不可用：应用镜像安装 PostgreSQL 15 客户端，而 Compose 固定的数据库镜像运行 PostgreSQL 16.15；`pg_dump` 明确以主版本不匹配终止。
3. 已复现限流在并发首窗中失效，且 Compose 默认代理跳数会把常见单层 Caddy 请求解析为同一个 `unresolved-client`，同时形成绕过和全局拒绝服务风险。
4. 已静态确认普通中队管理员可在升级计划 PATCH 中把未启动计划关联到其他中队的 Pilot；数据库又不约束 Pilot、Person、职位和组织的一致归属。
5. 当前资质数据同时维护 legacy Pilot 模型和新增 Person/QualificationDefinition 投影；正常提交审批会生成缺少新投影外键的 ACTIVE 记录，导致人员详情与职位资质总览给出相互矛盾的结果。
6. 基线要求的 `ROLLBACK` 不存在；升级检查项提前 7 天提醒也没有生产者。
7. 当前工作树包含大量未提交修改和一条未跟踪迁移，无法把本次验证结果绑定到不可变发布制品。

在 AUD-001 至 AUD-011 完成修复，并通过第 16 节门槛之前，不应把真实人员身份、资质证据或长期业务数据放入系统。

# 2. 执行摘要

## 2.1 发现数量

| 严重度 | 数量 | 结论                                 |
| ------ | ---: | ------------------------------------ |
| P0     |    1 | 已复现上线阻断                       |
| P1     |   10 | 原则上全部在上线前修复               |
| P2     |    9 | 中风险、可造成边界错误或削弱纵深防御 |
| P3     |    1 | 工程与可观测性改进                   |
| 合计   |   21 | 不含第 8 节的未验证风险              |

## 2.2 最危险的五个问题

1. AUD-001：空库迁移后生产 bootstrap 失败，Web/Worker 无法启动。
2. AUD-004：升级计划 PATCH 可跨中队重绑 Pilot，并留下内部关系不一致。
3. AUD-006：资质写入绕开新模型的人审/证据策略，且 ACTIVE 记录未同步新投影。
4. AUD-002/AUD-010：默认数据库备份无法执行；即使修正版本，恢复仍缺少完整性校验、维护窗口和实际保留策略。
5. AUD-003：认证和一次性链接限流在并发及反向代理下失效。

## 2.3 最可靠的三个模块

1. **一次性令牌消费**：32 字节随机令牌、数据库仅存 SHA-256、明确过期、条件更新原子消费、失效/重放审计；代码位于 `src/server/auth.ts:227-335`。
2. **AI 降级边界**：模型输出经 Zod 严格解析；HTTP/空响应/格式错误变成 UNAVAILABLE，结果只作为人工审核建议，不直接改变 ACTIVE 状态；`src/server/vlm.ts:7-15,40-124`、`src/server/qualification-verification.ts:42-132`。
3. **通知领取与业务去重主路径**：通知使用唯一 `dedupeKey`，Worker 用条件更新领取、记录尝试并指数退避，业务写入与 pg-boss 入队在同一数据库事务；`src/server/notifications.ts:130-193`、`src/server/worker-handlers.ts:99-234`、`src/server/jobs.ts:29-38`。

## 2.4 最缺乏验证的三个模块

1. 真实 S3/MinIO 的桶策略、签名 URL、断流、配额和恢复后对象一致性。
2. 真实短信/飞书供应商的幂等语义、回执格式、超时后的未知结果和实际送达回调。
3. 真实生产规模下的 PostgreSQL 性能、磁盘满、长时间停机补发以及数据库/图库联合灾备演练。

## 2.5 成熟度判断

代码已经具有明显的安全工程基础：服务端权限、CSRF/Origin、Argon2id、令牌哈希、私有对象签名、图片服务端重编码、资格规则快照、乐观并发、通知 outbox/重试均不是占位实现。单元测试和 Chromium/Firefox E2E 也有较好覆盖。

但当前版本处于**架构迁移尚未收口、生产运维能力未形成闭环**的阶段。最大的风险不是代码风格，而是同一业务在 legacy 与 Person 架构中存在两套写入/读取语义，迁移/脚本又没有进入常规类型检查和干净部署门禁。这不是可接受的首发尾项。

# 3. 审计覆盖范围

## 3.1 已检查

- 构建与依赖：`package.json`、`pnpm-lock.yaml`、`tsconfig.json`、Next/ESLint/Prettier/Playwright/Vitest 配置。
- 所有 `src/app` 页面、64 个 Route Handler、middleware；未发现 Server Action。
- `src/server` 中认证、授权、规则、仓储、图片、对象存储、AI、通知、队列、备份、运行时配置。
- `src/worker` 独立 Worker、健康心跳和优雅关闭。
- `prisma/schema.prisma`、31 条当前迁移、seed、bootstrap、成员架构迁移和管理脚本。
- `Dockerfile`、`docker-compose.yml`、`docker-compose.dev.yml`、`Caddyfile`、`.dockerignore`。
- 63 个 Vitest 文件、6 个 E2E 文件，以及针对并发限流、代理地址、跨组织外键和备份客户端版本的临时验证。
- Git 当前工作树、唯一历史提交、diff、未跟踪迁移与高置信度密钥模式。

## 3.2 已执行的关键流程

- 空 PostgreSQL 16.15 数据库执行全部迁移和生产 bootstrap。
- 从前 29 条迁移升级至当前 31 条迁移；保留代表性的单位、人员、ACTIVE 资质、RETURNED 申请和 DRAFT 升级计划；成员架构 dry-run、实际迁移和重复执行。
- production Next build、Web/Worker/Bootstrap Docker stage 构建。
- PostgreSQL 16 服务端与 Worker 镜像内 `pg_dump` 的真实连接测试。
- 20 个并发首次限流请求；不同 X-Forwarded-For 链长度解析。
- 数据库跨组织 Person/Unit 组合插入后回滚。
- webhook 返回 HTTP 200 但非 JSON 的适配器故障注入。
- Playwright Chromium、Firefox、WebKit 全套 E2E。

## 3.3 未检查或未完成

- 未连接任何生产环境或现有真实数据库；原因：审计授权明确禁止。
- 未调用真实外部服务；原因：避免数据外传、收费和副作用。
- 未完成在线 CVE 数据库查询；沙箱 DNS 失败后，提升网络权限因会向 npm registry 发送依赖元数据而未获授权。
- 未完成真实数据库+图库恢复演练；默认备份首先被客户端主版本不匹配阻断，且没有经授权的真实 S3/远程备份目标。
- 未进行高并发容量和磁盘满压测；此类操作超出只读、非破坏审计范围。
- Docker Compose CLI 插件/legacy binary 均未安装，无法执行 `docker compose config`；通过逐文件和单 stage 容器构建替代。

# 4. 系统与信任边界地图

```text
[管理员浏览器]
  密码+TOTP -> /api/admin/login -> AdminSession(hash token, CSRF) -> [Next Web]
  Cookie+CSRF -> admin Route Handler -> permission + unit/org scope -> [PostgreSQL]
                                                    |          |
                                                    |          +-> AuditEvent
                                                    +-> pg-boss transactional enqueue

[人员浏览器]
  employeeNumber+mobile -> /api/{pilot,member}/access-link -> PilotAccessToken(hash only)
      -> encrypted token payload -> NotificationDelivery -> [Worker] -> [SMS webhook]
  URL token -> atomic consume -> PilotSession -> own-only API -> [PostgreSQL]
                                      |
  cropped JPEG -> multipart -> server decode/re-encode -> [private S3/object store]
                                      |                         |
                                      +-> RecognitionTask ------+-> [VLM/Qwen]
                                                                  (advisory only)

[Worker]
  PostgreSQL/pg-boss -> recognition / notification / expiry reminder /
  cleanup / image optimization / backup jobs
      -> SMS、飞书 webhook
      -> S3 read/write/delete
      -> pg_dump/pg_restore、tar、rclone -> backup target

[Caddy / Internet boundary] -> TLS、12 MB body cap -> [Web container]
[PostgreSQL volume] 与 [backup-data volume] 是独立持久化边界；S3 在 Compose 外部。
```

边界说明：

- Web 和 Worker 都持有数据库、对象存储和集成密钥；Worker 还能解密一次性链接并执行 `pg_restore --clean`，属于最高权限组件。
- 管理员身份边界由每个 Route Handler 调用 `getAdmin`/`requirePermission` 再结合 unit/org Prisma 条件实现；middleware 仅做体验性重定向，不是最终授权。
- 人员后续 API 每次从会话解析 Pilot，并将 `pilotId` 固定为服务端身份；没有从客户端接受 ownerId。
- 可以直接把资质变为 ACTIVE 的组件包括：审核批准仓储、管理员资质 POST、CSV import；AI 和 Worker 本身不能批准。
- 接触明文访问令牌的组件包括签发 Route 的事务闭包、加密 secure payload、Worker 解密后的发送调用和最终接收渠道。数据库 AccessToken 表仅有 hash。
- 接触手机号/员工号的组件包括 Web、数据库、Worker 通知和外部渠道；VLM 路径只发送证照图片，不直接拼接数据库手机号/员工号。

# 5. 需求—实现追踪矩阵

| 产品要求                                    | 实现位置                                  | 完整性            | 自动测试       | 审计结论/规格漂移                                                 |
| ------------------------------------------- | ----------------------------------------- | ----------------- | -------------- | ----------------------------------------------------------------- |
| Next App Router + Prisma + Zod + PostgreSQL | `src/app`、`prisma/schema.prisma`         | 完整              | 是             | 符合基线                                                          |
| Web/Worker 分离                             | `Dockerfile:37-58`、`src/worker/index.ts` | 完整              | 部分           | 符合；共享最高权限配置                                            |
| 管理员密码+TOTP                             | `admin/login`、`auth.ts`、`crypto.ts`     | 基本完整          | 是             | Argon2id、动态角色/active 校验良好；TOTP 无防重放计数器见 AUD-013 |
| 一次性人员访问链接                          | `pilot/access-link`、`auth.ts:227-335`    | 核心完整          | 是             | 单次消费可靠；签发并发和限流有缺陷                                |
| 中队/组织授权                               | `admin-guard.ts`、`admin-permissions.ts`  | 不完整            | 部分           | 主路由普遍有 scope；升级计划 PATCH 有旁路，DB 无组合约束          |
| 人员提交资质材料                            | `pilot/submissions`、`evidence-images`    | legacy 路径完整   | 是             | 未同步 Person/Definition 投影                                     |
| AI 辅助且可降级                             | `vlm.ts`、`qualification-verification.ts` | 完整              | 是             | fail-closed，仍需人工审批                                         |
| 人工确认/纠正/补充                          | `admin-repository.ts`                     | 部分              | 是             | APPROVE/RETURN/纠正存在；纠正审计事务有缺口                       |
| ROLLBACK                                    | 无                                        | 未实现            | 否             | 明确规格漂移，AUD-007                                             |
| 唯一 ACTIVE 资质                            | 两个 partial unique index                 | legacy 维度有保证 | 是             | `pilotId+type` 有约束；Person/Definition 维度无等价约束           |
| 默认未来 90 天                              | 多个 dashboard/member 查询                | 部分              | 是             | 新旧路径时区语义不一致，AUD-014                                   |
| 升级计划、检查项、7 日提醒                  | upgrade plan routes、枚举                 | 部分              | 路由有         | 创建/改期/完成通知有；7 日扫描生产者不存在                        |
| 提醒本人和相关管理员                        | `notifications.ts`                        | 不完整            | 部分           | 实际只解析 Pilot 目标，管理员收件人未建模                         |
| 长期证据保存                                | S3 私有对象、7 年 expiresAt、backup       | 不完整            | 图片单测有     | 原始证据/裁剪链不可追溯，备份不可用/不可证明恢复                  |
| 可恢复备份                                  | `backup-*`                                | 不完整            | 极少           | 默认数据库备份已复现失败；完整性/保留/一致恢复均未闭环            |
| 生产空库部署                                | migrate + bootstrap Compose 链            | 失败              | 无真实空库门禁 | AUD-001                                                           |
| dev/test 不暴露到生产                       | middleware、dev route                     | 基本完整          | 是             | `/api/dev` 在 remote mode 返回 404；mock mode不暴露后端 API       |

# 6. 核心业务状态机

## 6.1 资质提交与审核

当前实际状态机：

```text
EvidenceImage(orphaned)
  -> 人员提交并原子 claim
  -> QualificationUpdateRequest(PENDING) + Evidence(linked) + RecognitionTask
  -> AI: MATCHED | MISMATCH | UNCERTAIN | UNAVAILABLE（均不改变申请状态）
  -> 管理员：
       approve -> 旧 ACTIVE => REPLACED；新 QualificationRecord => ACTIVE；申请 => APPROVED
       return  -> 申请 => RETURNED
       correction -> 仍为 PENDING，原 submittedFields 不变，当前字段被修改
```

非法/缺失转换：

- 管理员资质 POST 和 CSV import 不经过 PENDING/证据/审核，直接写 ACTIVE；新 QualificationDefinition 的 `requiresEvidence`、`requiresHumanReview`、`allowAutoApproval` 不参与这些路径。
- 没有 RETURNED -> PENDING 的重新提交状态转换；客户端实际上创建新请求，旧 RETURNED 历史保留。
- 没有 ROLLBACK 状态、路由或版本恢复操作。
- 管理员 PATCH 直接原位修改 ACTIVE 记录，不生成新版本实体；只能靠 AuditEvent 中 before/after 还原。
- 审批用事务、请求 version、ACTIVE record version 和 partial unique index保护同一 legacy `pilotId+qualificationTypeId`；这一部分能抵抗双重审批。

核心不变量检查：

| 不变量                                   | 保证层                          | 结论   |
| ---------------------------------------- | ------------------------------- | ------ |
| PENDING 申请不得同时等于已生效记录       | 独立模型+状态                   | 满足   |
| 同一 Pilot/legacy 类型最多一个 ACTIVE    | DB partial unique + transaction | 满足   |
| AI 未知不得自动通过                      | 服务端确定性审批                | 满足   |
| 新记录生效后旧记录保留为 REPLACED        | 审批事务                        | 满足   |
| 人员/Definition 新投影与 legacy 记录一致 | 无 DB/统一写服务                | 不满足 |
| 回滚保留被回滚版本证据                   | 无实现                          | 不满足 |
| 纠正必须含 before/after/理由且与写入原子 | 仅 changedFields；分离写入      | 不满足 |

## 6.2 日期与过期

- legacy UI 规则把字符串日期视为 Asia/Shanghai 日历日，当日仍显示“今日到期”。
- Worker 按单位 timezone 计算 reminder window。
- 新 member repository 和职位聚合却把 PostgreSQL DATE 读成 UTC 午夜再与 `Date.now()` 比较，Asia/Shanghai 当地到期日 08:00 后即显示过期。
- 因此“日期”与“时间点”尚未形成全局不变量；90 天窗口也有毫秒加法与日历日计算两套语义。

## 6.3 通知与提醒

```text
业务事务 -> NotificationDelivery(unique dedupeKey) + pg-boss job
 -> Worker 条件领取 QUEUED=>SENDING
 -> adapter(idempotency-key)
 -> NotificationAttempt + SENT / 延迟重试 / FAILED
 -> 最终失败生成管理员日志型 IN_APP alert
```

- 资质到期提醒每日 08:00 扫描；dedupe key 以 record+window 为单位，所以同窗口不会每日重复。
- 发送成功但状态落库前崩溃会在 10 分钟后重试；外部提供方是否尊重 idempotency-key 决定是否重复，系统不能证明 exactly-once。
- 升级创建/恢复/改期/完成会即时发通知，但没有扫描 `UpgradeStage.plannedStart - 7 days` 的任务。

## 6.4 升级计划

实际生命周期为 `DRAFT/NOT_STARTED -> ACTIVE <-> PAUSED -> COMPLETED|CANCELLED`。阶段按顺序完成，使用 plan version 做乐观并发。问题是：

- 创建并立即 start 使用职位专属 `upgradePrerequisite`；随后从草稿 start/resume 却只检查 legacy `core` 类型。
- 非 ACTIVE PATCH 允许修改 pilotId，但未重新验证目标中队、personId、positionAssignment 和快照。
- `UpgradePlanInspectionItem` 分别外键到 plan 和 stage，却没有约束 stage 必须属于同一 plan。

# 7. 正式发现列表

## P0

### AUD-001：全新生产数据库无法通过 bootstrap，Web 与 Worker 不会启动

- 严重度：P0
- 置信度：已复现
- 类别：部署
- 位置：
  - `src/server/admin-permissions.ts:7-26`，`ADMIN_PERMISSION_CODES`
  - `scripts/bootstrap-production.ts:42-69`，权限目录校验与角色授权
  - `prisma/migrations/20260814005000_fix_admin_role_permissions/migration.sql:2-17`
  - `prisma/migrations/20260817004000_backup_permissions/migration.sql:1-12`
  - `docker-compose.yml:18-55,58-89,106-137`
- 对应业务不变量：任何受支持的空库版本都必须能按发布编排完成 migrate -> bootstrap -> web/worker。
- 现状：代码目录要求 `settings.positions.write`，seed 能创建它，但 31 条迁移中没有任何一条创建该权限；生产启动不运行 seed。
- 证据：空 PostgreSQL 16.15 中 31 条迁移全部成功，随后 host 和实际 bootstrap Docker stage 均退出并打印 `Database migrations did not create permissions: settings.positions.write`。
- 完整调用链或数据流：Compose `migrate` -> `db:migrate` 成功 -> `bootstrap` -> member migration -> permission findMany -> missing check 抛错 -> bootstrap 非零退出 -> `web`/`worker` 的 `service_completed_successfully` 条件永不满足。
- 复现步骤：创建空 DB；设置隔离 `DATABASE_URL/DIRECT_URL` 与必需配置；执行 `pnpm db:migrate` 后执行 `pnpm db:bootstrap`，或运行构建出的 bootstrap stage。
- 实际结果：迁移退出 0，bootstrap 退出 1；服务启动链被阻断。
- 正确结果：迁移应建立完整、可重复的权限目录和角色授权，bootstrap 成功且无需 seed。
- 影响：全新生产部署、灾后空环境重建和新租户环境均不可用。
- 可被谁触发：部署系统或运维人员；无需攻击者。
- 触发前提：从当前迁移集初始化空数据库。
- 根本原因：运行时权限常量先于迁移目录更新；seed 被错误地当成事实补丁，但生产编排不运行 seed。
- 是否存在补偿控制：有，开发人员手工运行 `db:seed` 可补齐权限。
- 为什么补偿控制充分或不充分：不充分；seed 会写演示数据并重置管理员凭据，不在 Compose 生产链中，也不应成为迁移前置条件。
- 最小修复方案：新增向前迁移，幂等插入 `settings.positions.write`，并授予 SUPER_ADMIN/ADMIN 与代码常量一致的角色集合。
- 更稳健的长期修复方案：从单一权限清单生成迁移断言；CI 在完全空的 PostgreSQL 上运行 migrate + bootstrap + 启动健康检查。
- 必须新增的回归测试：空库 31+新迁移 -> bootstrap 两次均成功；权限集合与 `ADMIN_PERMISSION_CODES` 完全相等；Web/Worker healthcheck 通过。
- 修复可能影响的其他模块：设置中心职位管理、角色授权、seed、生产初始化文档、灾备恢复流程。

## P1

### AUD-002：默认 Worker 的 `pg_dump` 主版本落后于 PostgreSQL，数据库备份必然失败

- 严重度：P1
- 置信度：已复现
- 类别：部署
- 位置：
  - `Dockerfile:1-5,37-49`，bookworm 默认 `postgresql-client`
  - `docker-compose.yml:2-3,106-146`，固定 PostgreSQL 镜像与 Worker
  - `src/server/backup-runner.ts:136-146`，数据库备份调用
- 对应业务不变量：默认部署的 Worker 必须能对默认部署的数据库执行可恢复备份。
- 现状：Worker 包含 `pg_dump 15.19`，Compose 数据库镜像为 PostgreSQL 16.15。
- 证据：在构建出的 Worker 环境连接审计 PostgreSQL 16.15，`pg_dump` 输出 `server version: 16.15; pg_dump version: 15.19 ... aborting because of server version mismatch`。
- 完整调用链或数据流：backup schedule -> `processQueuedBackupRuns` -> `executeBackupRun` -> `execFileAsync("pg_dump")` -> 版本检查失败 -> BackupRun FAILED。
- 复现步骤：构建 worker-runner；连接 Compose 同 digest 的 PostgreSQL；执行镜像内 `pg_dump --format=custom`。
- 实际结果：非零退出，未生成数据库 dump。
- 正确结果：客户端主版本应等于或高于服务端受支持主版本，备份成功并通过恢复校验。
- 影响：数据库没有可用备份；误删除、卷损坏或升级失败时可能永久丢失资质历史、审计、令牌与配置。
- 可被谁触发：任何计划/手工数据库备份。
- 触发前提：使用仓库默认镜像组合。
- 根本原因：数据库镜像固定到 PostgreSQL 16，而客户端通过发行版泛化包隐式选择 PostgreSQL 15。
- 是否存在补偿控制：可以外接独立备份系统，但仓库默认没有配置或验证。
- 为什么补偿控制充分或不充分：不充分；产品 UI 与 Worker 宣称并调度内建备份。
- 最小修复方案：在 Worker 安装并固定 PostgreSQL 16 client，或从同一 PostgreSQL 镜像复制工具。
- 更稳健的长期修复方案：建立 PostgreSQL N/N-1 支持矩阵，镜像构建时断言版本，并对每个发布执行真实 dump/restore。
- 必须新增的回归测试：默认 Compose 启动后创建样本数据、生成 dump、恢复到新 DB、逐表和关键对象校验。
- 修复可能影响的其他模块：Dockerfile、镜像 SBOM、备份 Worker、部署文档。

### AUD-003：持久化限流在并发首次请求时失效，默认代理配置又把真实客户端合并为同一身份

- 严重度：P1
- 置信度：已复现
- 类别：认证
- 位置：
  - `src/server/rate-limit.ts:4-20,23-31`
  - `src/app/api/admin/login/route.ts:38-45`
  - `src/app/api/pilot/access-link/route.ts:21-28`
  - `docker-compose.yml:87,135`、`Caddyfile:5-10`
- 对应业务不变量：每个限流键在一个窗口最多成功 N 次；不同真实客户端不应无故共享同一全局桶。
- 现状：空桶路径先 `findUnique`，再由每个竞争请求执行 `upsert update {count:1}` 并全部返回 true；代理算法用 `chain.length - trustedHops - 1`。
- 证据：对同一新 key 并发 20 次、limit=5，20 次全部允许且最终 count=1。`TRUSTED_PROXY_HOPS=1` 时单项 `X-Forwarded-For: 203.0.113.7` 解析为 `unresolved-client`，两项链才返回真实客户端。
- 完整调用链或数据流：登录/链接请求 -> `requestAddress` -> `consumeRateLimit` -> 非原子读/复位 -> 认证或令牌签发。
- 复现步骤：清空一个 RateLimitBucket；并发 `Promise.all` 20 次调用；另以一项/两项 XFF 构造 Request。
- 实际结果：首窗可突破任意 limit；常见单层反代的所有用户共享 `unresolved-client`。
- 正确结果：数据库原子地增量/滚窗，仅前 N 次成功；代理链按已信任边界提取客户端地址。
- 影响：密码/TOTP 猜测与访问链接骚扰可突发绕过；也可让一个客户端耗尽全体用户共享桶造成拒绝服务。
- 可被谁触发：未认证互联网客户端。
- 触发前提：并发请求新窗口，或默认 Caddy 单代理链。
- 根本原因：读后写竞态；XFF 索引把 header 中未包含的直连 peer 也计为一跳。
- 是否存在补偿控制：管理员账户锁定、令牌高熵、统一响应和 Caddy 12 MB 限制。
- 为什么补偿控制充分或不充分：账户锁定不能保护链接骚扰、全局桶 DoS 或分布式用户名攻击；高熵不等于请求频率控制。
- 最小修复方案：用单条 SQL/数据库函数原子 UPSERT+increment+条件返回；明确 Caddy 的 trusted proxy 与 XFF 语义并加部署测试。
- 更稳健的长期修复方案：组合 IP、账号/人员、手机号、设备/网段维度；加入抖动、监控和异常告警。
- 必须新增的回归测试：100 并发只允许 N 次；窗口翻转；单/多层代理；伪造 XFF；一个客户端不能耗尽其他客户端桶。
- 修复可能影响的其他模块：管理员登录、一次性链接、反向代理配置、审计告警。

### AUD-004：中队管理员可把未启动升级计划跨中队重绑到任意 Pilot

- 严重度：P1
- 置信度：高
- 类别：授权
- 位置：
  - `src/app/api/admin/upgrade-plans/[id]/route.ts:41-53,64-87,90-149`
  - `prisma/schema.prisma:752-779`
- 对应业务不变量：受中队范围限制的管理员只能让计划、Pilot、Person、职位分配与本人范围内同一人员保持一致。
- 现状：PATCH 只验证旧 plan 在管理员范围内；非 ACTIVE 时直接写客户端 `input.pilotId`，没有验证新 Pilot 归属，也不更新 personId、positionAssignmentId 和职位快照。
- 证据：完整静态数据流显示 `existing` 的 scope 在写前只作用于旧记录；`updateMany where` 只有 id/version/status，`data.pilotId` 未经 scoped lookup。Pilot 外键只验证存在。
- 完整调用链或数据流：ADMIN/operations.write -> scoped load own-unit plan -> body 中替换 pilotId 为 other-unit UUID -> update plan -> 审计记录以新 pilotId 写入，但 person/position 仍指向旧人。
- 复现步骤：准备 A/B 中队 Pilot；A 管理员创建 DRAFT 计划；PATCH 该计划，将 pilotId 改为 B 的 UUID 并提交正确 expectedVersion。
- 实际结果：数据库更新可成功，计划关系跨中队且内部身份字段分裂。
- 正确结果：返回 404/403；所有关联必须由服务端从同一个 scoped Pilot/Person 重新派生并原子更新。
- 影响：越权修改其他中队人员的升级计划、错误通知、错误前置资质判断和不可可信审计。
- 可被谁触发：任一拥有 `operations.write` 的非 SUPER_ADMIN 管理员。
- 触发前提：知道/猜到有效的其他中队 Pilot UUID，并拥有自己范围内可修改的非 ACTIVE 计划。
- 根本原因：授权只验证现有资源，没有验证 body 中新的关联目标；数据库缺少跨列一致性约束。
- 是否存在补偿控制：ACTIVE 计划禁止结构变更；UUID 不易猜；GET/list 按范围过滤。
- 为什么补偿控制充分或不充分：DRAFT/NOT_STARTED 是正常阶段；UUID 可从日志、链接或协作渠道获得，且不可猜测不是授权。
- 最小修复方案：事务内 scoped 查询 target Pilot，拒绝越界；重新派生并同时写 person/position snapshots。
- 更稳健的长期修复方案：升级计划只接受 `personId` 或受控 assignmentId；数据库引入组织维度和组合外键/触发器不变量。
- 必须新增的回归测试：A 管理员对 B pilotId 的 PATCH 返回 404/403且零写入；SUPER_ADMIN 合法转移时所有快照同步。
- 修复可能影响的其他模块：升级计划列表、通知收件人、前置资质、成员迁移、审计查询。

### AUD-005：升级计划创建与后续 start/resume 使用不同前置资质规则

- 严重度：P1
- 置信度：高
- 类别：业务规则
- 位置：
  - `src/app/api/admin/upgrade-plans/route.ts:160-220`
  - `src/app/api/admin/upgrade-plans/[id]/[action]/route.ts:47-87`
- 对应业务不变量：同一计划每次进入 ACTIVE 都必须根据当前 Person 的职位和 `upgradePrerequisite` 要求重新确定性校验。
- 现状：创建并 start 时查询职位专属 QualificationRequirement 和新 QualificationRecord；草稿随后 start 或暂停后 resume 时只检查全局 legacy `QualificationType.core` 与 Pilot legacy records。
- 证据：两个生产入口调用同一 `assertCoreQualificationsEligible`，但输入集合和记录来源完全不同；action 路由未加载 person/positionAssignment/requirements。
- 完整调用链或数据流：POST create(action=start) -> position requirements；或 POST create(action=draft) -> later `/[id]/start` -> legacy core types -> ACTIVE。
- 复现步骤：配置某职位的非-core `upgradePrerequisite=true`；人员缺少该资质；先保存 DRAFT，再调用 start。
- 实际结果：后续 start 路径不会检查该职位前置项，可进入 ACTIVE。
- 正确结果：所有 start/resume 入口使用同一规则服务和同一快照/当前策略，并在状态更新事务内重验。
- 影响：不满足升级前置资质的人员可开始或恢复计划，航空资质业务决策失真。
- 可被谁触发：拥有 `operations.write` 的管理员。
- 触发前提：计划先以 DRAFT/NOT_STARTED 保存，且职位要求不等于 legacy core 集合。
- 根本原因：新成员架构只接入创建路径，旧 action 路由未迁移。
- 是否存在补偿控制：管理员人工可看到资料；计划只有管理员能启动。
- 为什么补偿控制充分或不充分：产品把规则校验作为确定性约束，不能依赖操作者记忆；管理员也可能使用正常 UI 流程触发。
- 最小修复方案：抽取统一 eligibility 服务，在事务内基于 plan 的 person/positionAssignment 校验 start/resume。
- 更稳健的长期修复方案：计划创建时保存要求快照并明确“使用当前规则还是快照”；状态机只暴露一个服务入口。
- 必须新增的回归测试：职位非-core 前置缺失时 create-start、draft-start、pause-resume 均拒绝；资质过期/被替换的并发场景。
- 修复可能影响的其他模块：职位资质配置、成员投影、升级计划状态机、通知。

### AUD-006：资质 ACTIVE 写入绕开新定义策略，并造成 legacy 与 Person 视图分裂

- 严重度：P1
- 置信度：高
- 类别：业务规则
- 位置：
  - `src/app/api/admin/pilots/[pilotId]/qualifications/[qualificationId]/route.ts:49-131,137-233`
  - `src/server/pilot-management.ts:453-621`
  - `src/app/api/pilot/submissions/route.ts:64-124`
  - `src/server/admin-repository.ts:599-617`
  - `src/app/api/admin/members/positions/route.ts:40-70`
  - `src/server/member-repository.ts:66-84`
  - `prisma/schema.prisma:422-455,536-565`
- 对应业务不变量：每个新 ACTIVE 资质必须满足其 Definition 的证据/人审策略，并在 legacy 与 Person/Definition 读取模型中指向同一人、同一定义。
- 现状：管理员 POST 和 CSV import 直接创建 ACTIVE；正常人员提交和审批创建的 request/record 不写 personId、qualificationDefinitionId；详情有 legacy fallback，职位聚合没有。
- 证据：Definition 默认 `requiresEvidence=true`、`requiresHumanReview=true`、`allowAutoApproval=false`，但 direct create/import 只读取 QualificationType；审批 create data 仅含 pilotId/typeId。职位聚合只查询新外键，因此把同一详情页可见的 ACTIVE 资质统计为 missing。
- 完整调用链或数据流：member 提交(alias 到 pilot route) -> legacy request -> approve -> legacy ACTIVE -> member detail fallback 显示 -> positions aggregate 查询 Person/Definition 无记录 -> missing；另有 admin POST/CSV -> 直接 ACTIVE。
- 复现步骤：对已迁移 Person 用 member 流程提交并批准一项资质；读取成员详情和 `/api/admin/members/positions`；或对要求证据/人审的 Definition 走管理员 direct create。
- 实际结果：两个新架构视图可给出互相矛盾的合规状态；策略字段不控制所有生效入口。
- 正确结果：所有写入口经过统一资格服务，原子写齐 legacy/new projection 或完成单模型切换；所有读取使用同一事实源。
- 影响：管理人员可能把实际有效人员判断为缺失，或把未满足新策略的手工/批量记录视为有效；提醒和升级前置条件也可能选错数据源。
- 可被谁触发：人员正常提交、审核员批准、operations.write 管理员直接录入或 CSV 导入。
- 触发前提：已运行成员架构迁移并使用新职位/Definition 页面。
- 根本原因：additive migration 保留两套模型，但没有统一 dual-write service 或数据库投影约束。
- 是否存在补偿控制：legacy 唯一 ACTIVE 索引、字段规则校验、管理员权限和审计；成员详情有 fallback。
- 为什么补偿控制充分或不充分：它们不能保证新职位总览、前置规则和 Definition 策略一致；fallback 只覆盖一个读入口。
- 最小修复方案：提交/审批/direct/import 全部解析 Person 与 Definition 并写齐外键；策略决定是否允许直录；修复历史 NULL 并对不一致数据做发布前检查。
- 更稳健的长期修复方案：确定唯一 canonical 模型，删除双写；在过渡期建立数据库触发器/约束和 reconciliation job。
- 必须新增的回归测试：四种写入口后详情、职位汇总、提醒、升级 eligibility 一致；requiresHumanReview/evidence/autoApproval 组合全覆盖。
- 修复可能影响的其他模块：资质审核、CSV、人员目录、职位配置、提醒、升级计划、迁移脚本。

### AUD-007：基线要求的 ROLLBACK 缺失，人工纠正又可能留下无审计修改

- 严重度：P1
- 置信度：高
- 类别：业务规则
- 位置：
  - `prisma/schema.prisma:18-27`，仅 ACTIVE/REPLACED 与 PENDING/APPROVED/RETURNED
  - `src/server/admin-repository.ts:744-817`，`correctReview`
  - `src/app/api/admin/pilots/[pilotId]/qualifications/[qualificationId]/route.ts:137-233`，ACTIVE 原位修改
- 对应业务不变量：回滚必须恢复正确版本且保留所有历史证据；人工纠正必须原子记录原值、新值和理由。
- 现状：仓库没有 ROLLBACK 状态、动作或路由；`correctReview` 先 updateMany，事务外再 create AuditEvent，审计仅含 changedFields 且 schema 不要求理由；ACTIVE PATCH 原位改写同一 record。
- 证据：在 `src`、`prisma` 中搜索 ROLLBACK 无业务实现；纠正函数的两次 DB 写入不在 `$transaction` 内。
- 完整调用链或数据流：correction route -> `correctReview` -> request update 成功 -> 若进程/DB 在 audit create 前失败，则用户字段已变但无审计 -> 后续 approve；错误批准后没有 rollback 入口。
- 复现步骤：提交 PENDING；调用 correction 并在 update 返回后、audit create 前注入异常；另对 APPROVED/ACTIVE 记录查找可用 rollback action。
- 实际结果：可能存在无法解释的纠正；已批准错误记录只能再手工 PATCH/新建，不能恢复版本语义。
- 正确结果：纠正+审计原子化并要求理由；ROLLBACK 原子替换当前 ACTIVE、恢复目标历史版本、保留证据和审计。
- 影响：无法可靠回答资质为何生效/为何恢复；错误资质处理容易继续破坏历史。
- 可被谁触发：审核员/管理员；故障窗口也可触发无审计写入。
- 触发前提：人工纠正、错误批准或 ACTIVE 手改。
- 根本原因：业务状态机只实现确认与退回；把 AuditEvent 当附加写入而非关键事务组成。
- 是否存在补偿控制：submittedFields 保留人员原始输入；ACTIVE PATCH 审计含 before/after。
- 为什么补偿控制充分或不充分：submittedFields 不能证明每次纠正和理由；PATCH 不是 rollback，也不生成可恢复版本。
- 最小修复方案：把 correction update+audit 放入同一事务并要求 reason；上线前实现显式 rollback 服务和权限。
- 更稳健的长期修复方案：采用 append-only 资质版本与单独 current pointer，状态转换表驱动并由 DB 保证唯一 current。
- 必须新增的回归测试：纠正审计失败时事务回滚；rollback 恢复 N-1、旧证据仍可读、并发 rollback/approve 只有一个胜者。
- 修复可能影响的其他模块：审核 UI、资质历史、通知、提醒、审计导出。

### AUD-008：短信/飞书 webhook 对畸形 HTTP 200 响应 fail-open 并记录 SENT

- 严重度：P1
- 置信度：已复现
- 类别：Worker
- 位置：
  - `src/server/providers.ts:48-83`
  - `src/server/worker-handlers.ts:140-220`
  - `prisma/schema.prisma:835-879`
- 对应业务不变量：无法解析或没有明确 accepted=true 的外部响应不得记为已接受，更不得等同于送达。
- 现状：`response.json().catch(() => ({}))` 吞掉解析错误，随后 `body.accepted !== false` 把空对象当成功；Worker 写 SENT 并清除安全载荷。
- 证据：故障注入让 webhook 返回 HTTP 200、正文 `not-json`；适配器返回 `{accepted:true}`，Worker 会选择 SENT 路径。
- 完整调用链或数据流：NotificationDelivery QUEUED -> adapter fetch -> malformed 2xx -> `{}` -> accepted=true -> NotificationAttempt SENT + Delivery SENT。
- 复现步骤：使用本地无外发 mock fetch 返回 `new Response("not-json", {status:200})`，调用 webhook adapter/notification handler。
- 实际结果：不可解析响应被接受；无 providerId，状态仍为 SENT。
- 正确结果：严格 schema 要求 `accepted:true` 和预期标识；否则标为 provider_protocol_error 并按策略重试/人工核查。
- 影响：一次性链接和临期通知可能实际未被供应商接收，但系统永久显示发送成功并停止重试。
- 可被谁触发：外部供应商故障、代理错误页或错误 webhook 实现。
- 触发前提：HTTP 状态为 2xx，但响应为空、非 JSON 或缺字段。
- 根本原因：成功判定采用“不是显式 false”而不是“严格显式 true”。
- 是否存在补偿控制：HTTP 非 2xx、超时和抛错会重试；终态失败有管理员告警。
- 为什么补偿控制充分或不充分：畸形 2xx 正好绕过这些分支；系统也没有 delivery receipt 回调。
- 最小修复方案：对供应商响应使用 Zod schema，只有 `accepted === true` 才记为 provider-accepted；协议错误重试。
- 更稳健的长期修复方案：区分 QUEUED/PROVIDER_ACCEPTED/DELIVERED/FAILED/UNKNOWN，落库 providerMessageId 并接入签名回执。
- 必须新增的回归测试：空体、HTML、畸形 JSON、缺 accepted、accepted=false、超时且供应商实际接受、重复 idempotency key。
- 修复可能影响的其他模块：通知列表、失败告警、一次性链接 secure payload 清理、渠道 SLA。

### AUD-009：升级检查项 7 日提醒和管理员收件人没有实现

- 严重度：P1
- 置信度：高
- 类别：Worker
- 位置：
  - `src/server/worker-handlers.ts:237-293`
  - `src/worker/index.ts:67-78`
  - `src/server/notifications.ts:81-193`
  - `src/app/api/admin/settings/route.ts:126-169`
  - `prisma/schema.prisma:122-133,782-832`
- 对应业务不变量：每个到达提醒窗口的升级节点/检查项都应为本人及配置的相关管理员生成一次可去重通知。
- 现状：枚举和 mapping 有 `UPGRADE_STAGE_REMINDER`，但唯一每日扫描只查询 QualificationRecord；`emitPilotNotification` 只解析 Pilot 的手机/员工号/站内 ID，没有管理员收件人模型。
- 证据：全仓搜索 `upgrade_stage_reminder` 只有 schema/mapping，没有业务生产者；设置描述明确写“提醒飞行员与管理员”，实现只加载 pilot/unit routing。
- 完整调用链或数据流：pg-boss 每日 reminder -> `processReminderJob` -> 仅 ACTIVE qualification -> emit to pilot；UpgradeStage.plannedStart 从未参与。
- 复现步骤：创建 plannedStart=今天+7 天的 ACTIVE 计划，运行 reminder job；检查 NotificationDelivery。
- 实际结果：不会创建 UPGRADE_STAGE_REMINDER；相关管理员也不会收到 qualification expiry 通知。
- 正确结果：按单位 timezone 和可配置窗口扫描 stage/item，使用稳定事件键向本人和明确管理员路由分别创建投递。
- 影响：关键升级准备节点漏提醒；运营人员对系统“已配置提醒”的信任与实际行为不一致。
- 可被谁触发：正常时间推进；无需攻击者。
- 触发前提：依赖 7 日升级提醒或管理员提醒。
- 根本原因：通知类型先于调度/收件人领域模型实现；UI 文案超出后端能力。
- 是否存在补偿控制：创建、恢复、改期、完成会即时通知 Pilot；管理员可手工查看计划和通知日志。
- 为什么补偿控制充分或不充分：即时变更通知不能替代临近日期提醒；人工巡检不是可靠调度。
- 最小修复方案：新增升级 stage/item 扫描器、管理员 routing 解析和按 recipient 去重键。
- 更稳健的长期修复方案：统一 ReminderEvent 模型，记录计划时间、取消/重算、接收人快照和补发水位。
- 必须新增的回归测试：+7 日、当天、停机跨过窗口、改期取消旧提醒、多 Worker 并发、人员调队和管理员收件人变更。
- 修复可能影响的其他模块：通知设置、升级计划、管理员站内告警、时区处理。

### AUD-010：备份恢复缺少完整性、保留、一致性和安全执行闭环

- 严重度：P1
- 置信度：高
- 类别：部署
- 位置：
  - `src/server/backup-runner.ts:115-232,234-293,295-379`
  - `src/server/backup-service.ts:32-48,118-150`
  - `src/app/api/admin/backups/route.ts:52-80`
  - `src/components/admin/settings/backup-settings-section.tsx:20-27`
  - `docker-compose.yml:145-146`
  - `prisma/schema.prisma:617-669`
- 对应业务不变量：每个声称成功的备份必须可校验；恢复不得在在线请求中破坏活动数据库；数据库和图库应有明确一致点；保留策略必须实际执行。
- 现状：保存 manifestSha256 但恢复不比较；图库 manifest 中对象 sha256 不在读取后校验；retentionCount/Days 只存不执行；UI 默认 `/var/backups/crewqual`，Worker 只持久化 `/backups`；数据库与图库分别计划；restore 在 API 请求内同步 `pg_restore --clean`，无维护模式/锁，安全 dump 恢复失败被吞掉并在 finally 删除。
- 证据：对应字段仅出现在 schema/service/UI；runner 没有删除过期 artifact/run。restore 下载后直接解密/解包/写入，未引用 `manifestSha256`。Compose volume 与默认路径不一致。
- 完整调用链或数据流：SUPER_ADMIN POST restore -> Web 进程直接 fetch artifact -> live DB safety dump -> `pg_restore --clean` -> 失败则尝试 safety restore 且忽略二次失败 -> 临时目录删除。
- 复现步骤：创建默认 LOCAL target/plan；观察 artifact 写入非挂载目录；篡改 artifact 或图库对象；在活动连接下调用 restore；重复产生超过 retention 的 runs。
- 实际结果：默认本地文件随容器重建丢失；篡改不被显式 hash 拒绝；保留无限增长；恢复失败可能同时破坏当前库且销毁本地 safety dump。
- 正确结果：持久卷路径被服务端限制；恢复前校验 artifact 与每个对象 hash；进入维护窗口、断开写流量、保留可外取安全备份；联合恢复有一致性和演练证据。
- 影响：系统可能显示备份成功但无法可信恢复；恢复操作本身可扩大事故并产生 DB/附件错配或提醒重复。
- 可被谁触发：SUPER_ADMIN、介质损坏、容器重建或真实灾难。
- 触发前提：使用内建备份/恢复。
- 根本原因：备份功能实现了传输和 UI，但没有把校验、生命周期、在线协调与恢复验收作为状态机。
- 是否存在补偿控制：加密默认开启；恢复要求专用权限和中文确认；失败前做临时 safety dump。
- 为什么补偿控制充分或不充分：加密不证明完整恢复；确认词不处理在线写入；safety dump 不持久且二次恢复错误被吞掉。
- 最小修复方案：限制 LOCAL 到 `/backups`；实施 retention；恢复前校验 run hash/对象 hash；restore 改为受控 Worker job 并进入维护模式；保留 safety artifact。
- 更稳健的长期修复方案：定义 RPO/RTO、联合备份 manifest/LSN、水位和恢复 runbook；每个发布自动恢复到隔离环境并做引用/通知/令牌检查。
- 必须新增的回归测试：篡改拒绝、保留删除、容器重建、图库缺对象、恢复中写请求拒绝、恢复失败后二次恢复失败、DB/图库一致性。
- 修复可能影响的其他模块：Worker、Web readiness、S3、通知补发、一次性令牌、运维文档。

### AUD-011：认证人员可无限上传并触发整文件缓冲、Sharp 解码和对象写入

- 严重度：P1
- 置信度：高
- 类别：文件
- 位置：
  - `src/app/api/evidence-images/route.ts:7-50`
  - `src/server/storage.ts:13-14,87-150`
  - `Caddyfile:7-9`
  - `src/server/worker-handlers.ts:295-315`
- 对应业务不变量：单一人员会话不能无限消耗 Web 内存/CPU、对象存储和数据库容量。
- 现状：Caddy 限单请求 12 MB、应用限图 10 MiB/2560px，但 Route 先解析 FormData 和完整 arrayBuffer，再做校验；没有用户/IP 上传频率、总量、并发或 orphan 数量限制。cleanup 每日只处理最多 100 条已过期对象。
- 证据：服务端路径每次都可进行 buffer、Sharp metadata、重新 JPEG 编码、S3 put 和 DB insert；全仓没有 evidence upload quota/rate bucket。
- 完整调用链或数据流：有效 PilotSession -> 重复 multipart POST -> memory buffer -> Sharp -> S3 unique object -> orphaned row -> 24 小时后每日最多清 100。
- 复现步骤：使用一个合法会话连续并发上传接近 10 MiB、合法尺寸但高解码成本的 JPEG；观察 CPU、RSS、S3 和 orphan backlog。
- 实际结果：静态确认没有上限；未在共享环境执行资源压测以避免破坏。
- 正确结果：认证主体/IP 有原子限流、并发上限、日配额和未关联对象上限；流式/早期大小检查；cleanup 能追上最坏写入速率。
- 影响：被盗或恶意合法会话可稳定耗尽 Web、对象存储费用或数据库，影响全体人员提交。
- 可被谁触发：任何拥有有效一次性会话的人员。
- 触发前提：能持续访问上传 API。
- 根本原因：只有单文件格式约束，没有租户/主体资源治理。
- 是否存在补偿控制：Caddy 12 MB、应用 10 MiB、尺寸/magic/decode/EOI 检查、服务端重编码、24 小时 orphan expiry。
- 为什么补偿控制充分或不充分：它们限制单个文件，不限制请求数量与累积成本；cleanup 吞吐远低于潜在写入吞吐。
- 最小修复方案：上传 API 使用修复后的原子限流；限制每个 Pilot 并发、每日字节和 orphan 数量；超限在读取/Sharp 前拒绝。
- 更稳健的长期修复方案：直传隔离 quarantine bucket、预签名大小约束、异步扫描/处理、租户配额和存储成本告警。
- 必须新增的回归测试：并发超限、日字节配额、100+ orphan backlog、客户端断流、S3 成功/DB 失败补偿、Sharp 超时/内存边界。
- 修复可能影响的其他模块：人员提交流程、S3 生命周期、cleanup Worker、监控。

## P2

### AUD-012：数据库未约束跨组织/跨实体一致性，应用 bug 可写入合法外键但非法业务组合

- 严重度：P2
- 置信度：已复现
- 类别：数据一致性
- 位置：
  - `prisma/schema.prisma:198-225,268-312,329-347,457-499,536-565,684-719,752-832`
- 对应业务不变量：Person.organization 与 unit、职位、Definition、记录、计划及管理员组织必须一致；plan inspection stage 必须属于同一 plan。
- 现状：关系都以单列 UUID 外键独立存在，没有 composite tenant key、CHECK 或触发器。
- 证据：隔离数据库把 organization B 的 Person 关联到 organization A 的 Unit，插入成功后审计事务回滚；同样结构允许跨组织 position/definition 组合。
- 完整调用链或数据流：任一遗漏 scope/双写错误 -> Prisma insert/update -> PostgreSQL 只验证目标 ID 存在 -> 非法组合持久化。
- 复现步骤：建立 A/B organizations 与 A unit，插入 `(organizationId=B, unitId=A-unit)` Person。
- 实际结果：数据库接受。
- 正确结果：数据库拒绝跨组织组合，或 canonical tenantId 由触发器强制派生。
- 影响：任何未来/现有应用授权遗漏都会变成持久化越权、错误聚合与通知。
- 可被谁触发：应用 bug、脚本、迁移或有 DB 写权限的运维。
- 触发前提：提交各自存在但归属不一致的 UUID。
- 根本原因：数据库只建实体外键，没有把租户一致性作为关系键。
- 是否存在补偿控制：大多数当前 Route 使用 unit/org filter。
- 为什么补偿控制充分或不充分：AUD-004 已证明入口会遗漏新关联目标；脚本和未来功能不一定复用 scope helper。
- 最小修复方案：写统一一致性检查并修复 AUD-004/006；上线前跑全库 invariant query。
- 更稳健的长期修复方案：关键表携带 organizationId，建立 composite unique/FK 或约束触发器；inspection item 用 `(planId,stageId)` 组合外键。
- 必须新增的回归测试：所有跨组织组合在 DB 层失败；合法同组织写入和迁移通过。
- 修复可能影响的其他模块：成员迁移、模板安装、职位、升级计划、审计查询。

### AUD-013：链接签发可并发产生多个有效令牌，人员会话撤销语义不完整

- 严重度：P2
- 置信度：高
- 类别：认证
- 位置：
  - `src/app/api/pilot/access-link/route.ts:30-84`
  - `prisma/schema.prisma:380-403`
  - `src/server/auth.ts:181-212`
  - `src/server/pilot-management.ts:320-340`
- 对应业务不变量：按产品策略每人同时只应有一个待消费链接；手机号/员工号变更或主动登出应撤销相关会话/令牌。
- 现状：existing token 查询在事务外，数据库没有“每 Pilot 一个未消费未过期 token”的约束；并发请求可各建 token/通知。只有 `active=false` 删除 session/token；手机号/员工号/中队变更不撤销，人员端没有 logout route。
- 证据：代码执行顺序和 schema 索引静态确认；消费本身仍是原子的，不属于此发现。
- 完整调用链或数据流：两请求同时 findFirst=null -> 各自事务 create token+delivery -> 两条链接均有效；人员信息变更 -> update Pilot -> session 保留。
- 复现步骤：对匹配身份并发两次 access-link；统计 unconsumed token；随后改手机号但保持 active，旧 session 继续 GET。
- 实际结果：可有多条有效链接；旧会话继续到 TTL。
- 正确结果：签发策略由事务/数据库原子保证；敏感身份变更撤销 token/session；提供人员 logout。
- 影响：增加链接泄露窗口和重复通知；号码交接场景下旧设备仍有访问权。
- 可被谁触发：匹配身份请求者、管理员资料变更、并发重试。
- 触发前提：并发签发或身份字段变化但人员仍 active。
- 根本原因：签发“先查后建”无唯一约束；会话生命周期只绑定 active/expiry。
- 是否存在补偿控制：高熵、短 TTL、原子消费、统一响应；停用会彻底删除。
- 为什么补偿控制充分或不充分：降低利用概率但不落实单链接和身份变更撤销策略。
- 最小修复方案：事务内使用 per-pilot advisory lock/签发表；身份字段变化删除 token/session；添加 logout。
- 更稳健的长期修复方案：引入 session securityVersion 并在身份安全事件时递增；明确新链接是否替换旧链接。
- 必须新增的回归测试：并发签发最多一个、旧链接策略、改手机号/员工号/调队/停用/登出后的访问。
- 修复可能影响的其他模块：通知 outbox、身份管理、移动端 UX、审计。

### AUD-014：DATE 在 legacy、member 聚合和 Worker 中使用三套时区语义

- 严重度：P2
- 置信度：高
- 类别：业务规则
- 位置：
  - `src/lib/qualification-date-status.ts:14-95`
  - `src/server/member-repository.ts:20-26`
  - `src/app/api/admin/members/positions/route.ts:54-70`
  - `src/server/worker-handlers.ts:249-274`
- 对应业务不变量：业务 DATE 在所属单位的整个日历日结束前都不应过期；90/30/7 天边界在所有视图和 Worker 一致。
- 现状：legacy 硬编码 Asia/Shanghai 日历日；member 用 UTC 午夜 Date 与当前毫秒比较；Worker 使用单位 timezone。
- 证据：PostgreSQL `DATE` 由 Prisma 表示为 UTC 00:00；Asia/Shanghai 到期日 08:00 后 `expiry < Date.now()` 成立，而 legacy 仍返回 today。
- 完整调用链或数据流：相同 expiryDate -> legacy serializer 与 member statusFor/positions route -> 不同状态；Worker 又按 unit timezone 计算。
- 复现步骤：在 Asia/Shanghai 当地到期日 12:00 查询三个入口。
- 实际结果：member 可显示 expired，legacy 显示今日到期，Worker 依单位时区决定。
- 正确结果：统一 DateOnly 类型和 unit timezone 的日历比较。
- 影响：当天资质被提前标过期；90 日名单、统计和提醒边界不一致。
- 可被谁触发：正常日期推进，尤其当地 08:00 后。
- 触发前提：有 expiryDate 且使用新 member 路径。
- 根本原因：把 DATE 当 JavaScript 时间点；新旧架构未复用同一日期服务。
- 是否存在补偿控制：legacy 日期单元测试覆盖月末/闰年；Worker 使用 timezone。
- 为什么补偿控制充分或不充分：只保护各自路径，不能保证跨页面一致。
- 最小修复方案：所有 DateOnly 比较转为指定单位 timezone 的日序数，禁止直接 `Date.now()` 比较 DATE。
- 更稳健的长期修复方案：引入 branded DateOnly、统一序列化/SQL 查询边界并做多时区契约测试。
- 必须新增的回归测试：当地 00:00/07:59/08:00/23:59、UTC 跨日、闰日、+7/+30/+90 包含边界。
- 修复可能影响的其他模块：dashboard、calendar、提醒、升级前置检查。

### AUD-015：系统只保留处理后证据对象，无法重建原图、裁边和格式转换证据链

- 严重度：P2
- 置信度：高
- 类别：文件
- 位置：
  - `src/lib/image-processing.ts:57-99`
  - `src/app/api/evidence-images/route.ts:26-45`
  - `src/server/storage.ts:87-150`
  - `src/server/worker-handlers.ts:368-399`
  - `prisma/schema.prisma:567-589`
- 对应业务不变量：长期资质证据应能说明原始上传、裁剪区域、处理版本、每个派生对象 hash 和审核时看到的字节。
- 现状：浏览器只上传裁剪后的 JPEG；服务端再次重编码并只存 sanitized hash；不存原文件 hash/尺寸、crop 参数、处理器版本。可选 AVIF 优化更新同一 objectKey/hash 后删除 JPEG。
- 证据：EvidenceImage 只有一个当前 objectKey/sha256；ImageOptimizationTask 虽保存 source/target key，但源对象删除且无原始上传记录。
- 完整调用链或数据流：原文件 -> 浏览器 canvas crop/JPEG -> 服务端 Sharp JPEG -> S3 object -> 可选 lossless AVIF 替换 -> 删除前一对象。
- 复现步骤：上传含可见边缘信息/EXIF 的原图并裁剪；从 DB/S3 尝试重建原始输入与裁剪参数。
- 实际结果：只能得到当前派生对象，无法证明裁掉了什么或审核时是哪一版本。
- 正确结果：不可变保存原始对象或至少可信原始 hash/元数据、crop transform、派生链和审核引用版本。
- 影响：争议调查、监管追溯和误裁恢复能力不足；7 年 expiresAt 也不是对象锁/法律保留保证。
- 可被谁触发：正常上传、裁剪和媒体优化。
- 触发前提：需要还原原始证据或发生转换争议。
- 根本原因：数据模型把 EvidenceImage 当可变当前媒体，而不是不可变证据与派生物图。
- 是否存在补偿控制：服务端去 EXIF、随机 key、私有 S3、像素级 lossless AVIF 校验、QualificationEvidence 关联。
- 为什么补偿控制充分或不充分：保护隐私与当前像素，但不能恢复原始业务证据链。
- 最小修复方案：存 crop/处理版本和每一代 hash；审批后固定引用的对象版本；禁止无记录替换。
- 更稳健的长期修复方案：原始 quarantine + immutable derivative DAG + 对象锁/WORM + 定期 checksum scrub。
- 必须新增的回归测试：原始/派生 hash、裁剪元数据、优化后旧审核引用、备份恢复后全链校验。
- 修复可能影响的其他模块：上传 UX、S3 成本、AI 输入、审核详情、备份。

### AUD-016：常规 typecheck 排除生产脚本和 seed，且 seed 可覆盖既有超级管理员凭据

- 严重度：P2
- 置信度：已复现
- 类别：部署
- 位置：
  - `tsconfig.json:26-37`
  - `package.json:10,20-29`
  - `prisma/seed.ts:55-79,99-135`
  - `scripts/migrate-member-architecture.ts:248,272-275`
  - `scripts/remote-e2e-prepare.ts:33,117`
- 对应业务不变量：发布门禁必须类型检查实际部署/迁移脚本；生产 seed 不得静默重置现有高权限账号。
- 现状：tsconfig 只 include src/e2e；独立将 scripts+prisma seed 加入 tsc 后出现 8 个错误。seed 的 permissionDescriptions 缺两个 backup 权限，并 upsert 更新现有管理员密码/TOTP、激活账号、解除锁定、授予 SUPER_ADMIN。
- 证据：标准 `pnpm typecheck` 退出 0；临时扩展 include 的 tsc 退出 2，定位上述 8 错。seed 代码明确执行 credential overwrite。
- 完整调用链或数据流：CI typecheck 忽略脚本 -> Docker bootstrap 用 tsx 运行未检查脚本；误执行 `db:seed` -> 已有邮箱账号凭据被环境变量替换并升级。
- 复现步骤：用临时 tsconfig include `scripts/**/*.ts`、`prisma/**/*.ts`；对已有同邮箱管理员在隔离库运行 seed。
- 实际结果：8 个静态错误；seed 会覆盖安全状态。
- 正确结果：所有发布可执行 TS 进入门禁；production seed 默认拒绝已有数据/账号，初始化与 demo seed 分离。
- 影响：部署脚本缺陷逃过 CI；误运行 seed 可造成高权限接管或演示数据污染。
- 可被谁触发：CI/发布人员或有数据库环境变量的运维。
- 触发前提：执行 bootstrap/migration/seed 脚本。
- 根本原因：Next 项目 tsconfig 被当成整个仓库 typecheck；seed 同时承担 demo 和权限初始化。
- 是否存在补偿控制：production seed 要求 password/TOTP 环境变量；Compose 不自动执行 seed；bootstrap 拒绝覆盖现有非 super 账号。
- 为什么补偿控制充分或不充分：有凭据环境变量并不意味着授权覆盖已有账号；脚本类型错误已实际存在。
- 最小修复方案：新增 scripts tsconfig 并纳入 verify；修复错误；production 禁止 seed overwrite，拆分 demo seed。
- 更稳健的长期修复方案：迁移/bootstrap/seed 每个都在空库和升级库容器测试，使用显式一次性初始化命令与审计。
- 必须新增的回归测试：script tsc；existing admin seed 拒绝；demo seed 仅 test/dev；bootstrap image 真实执行。
- 修复可能影响的其他模块：CI、Docker build、权限清单、远程 E2E。

### AUD-017：AuditEvent 不是受保护的追加日志，多个高风险运维动作也未记录

- 严重度：P2
- 置信度：高
- 类别：其他
- 位置：
  - `prisma/schema.prisma:882-900`
  - `src/app/api/admin/backups/route.ts:52-103`
  - `src/server/backup-service.ts:82-150`
  - `src/server/backup-runner.ts:295-379`
- 对应业务不变量：关键人工/系统动作必须有不可变的操作者、对象、before/after、理由和 request/event ID。
- 现状：AuditEvent 是普通表，无 DB append-only 权限/触发器/外部汇聚和保留策略；备份 target/plan/run/test/restore 路径不写 AuditEvent；部分记录只写 changedFields 或 input。
- 证据：backup route/service/runner 无 audit create；schema 对 AuditEvent 没有不可更新/删除控制，应用 DB 身份拥有全表权限。
- 完整调用链或数据流：SUPER_ADMIN 调整目标/发起破坏性 restore -> 只变 Backup 表或数据库本体 -> 审计时间线无事件。
- 复现步骤：创建目标、run now、restore；查询 AuditEvent。
- 实际结果：无对应记录。
- 正确结果：所有运维动作及拒绝/失败均以事务或可靠 outbox 写入不可变审计，并外部保留。
- 影响：无法证明谁更换备份密钥/路径、谁恢复了哪个 artifact；DB 高权限事件可被无痕改写。
- 可被谁触发：SUPER_ADMIN、Worker 或数据库运维。
- 触发前提：执行备份运维或具备 DB 写权限。
- 根本原因：审计采用约定式散落 create，而非统一强制边界。
- 是否存在补偿控制：大量业务路由已有 AuditEvent；容器 stdout 有结构化错误日志。
- 为什么补偿控制充分或不充分：缺失的正是最高影响恢复操作；stdout 未配置不可变集中保留。
- 最小修复方案：备份全部动作写审计；纠正等关键写与 audit 同事务；限制应用对 AuditEvent 的 update/delete。
- 更稳健的长期修复方案：append-only DB role/trigger、哈希链或外部审计汇聚、保留和访问策略。
- 必须新增的回归测试：每个关键动作/失败产生一条完整审计；update/delete 被 DB 拒绝；删除业务实体不删审计。
- 修复可能影响的其他模块：管理设置、日志平台、合规导出、灾备。

### AUD-018：生产容器以 root 运行，CSP 仍允许 inline script

- 严重度：P2
- 置信度：已复现
- 类别：部署
- 位置：
  - `Dockerfile:1-58`
  - `next.config.ts:20-42`
- 对应业务不变量：Web/Worker 被利用后应受到最小 OS 权限和浏览器脚本策略限制。
- 现状：Dockerfile 未创建/切换 USER；镜像 `Config.User` 为空，即 root。production CSP 的 `script-src` 包含 `'unsafe-inline'`。
- 证据：构建 web-runner 后 `docker image inspect` 返回空 User；配置字符串静态确认。
- 完整调用链或数据流：Web/Sharp/rclone/外部解析面漏洞 -> root 容器进程；潜在 HTML 注入 -> inline script 仍被 CSP 允许。
- 复现步骤：构建 web/worker image 并 inspect User；检查生产响应 CSP。
- 实际结果：root；CSP script-src 包含 unsafe-inline。
- 正确结果：非 root、只读根文件系统/最小 capabilities；nonce/hash CSP 不允许任意 inline script。
- 影响：不会独立造成漏洞，但显著扩大依赖/模板注入后的影响面。
- 可被谁触发：需先有 Web/依赖漏洞或部署配置错误。
- 触发前提：攻击者突破应用层边界。
- 根本原因：基础镜像 hardening 和 Next nonce 策略尚未实施。
- 是否存在补偿控制：容器网络隔离、数据库不暴露端口、frame/object/base 限制、安全头和私有 S3。
- 为什么补偿控制充分或不充分：能降低入口，不限制容器内权限和 inline script 执行。
- 最小修复方案：创建固定 UID/GID 并 `USER`；验证写目录；移除 script unsafe-inline 或改 nonce。
- 更稳健的长期修复方案：只读 rootfs、cap_drop、seccomp、SBOM/签名和独立低权限备份进程。
- 必须新增的回归测试：容器 `id -u != 0`、只读运行、CSP E2E 注入测试、健康检查。
- 修复可能影响的其他模块：backup 临时目录、Next standalone、Sharp、rclone。

### AUD-019：人员 CSV 导出未中和电子表格公式

- 严重度：P2
- 置信度：高
- 类别：输入验证
- 位置：
  - `src/server/pilot-management.ts:176-205`
- 对应业务不变量：任何可控文本导出到 CSV 后不得被 Excel/LibreOffice 当成公式执行。
- 现状：导出仅对逗号、引号、换行做 RFC 风格 quoting；以 `= + - @` 开头的 displayName、employeeNumber、级别等不会加安全前缀。
- 证据：`csvExportCell` 没有公式中和逻辑；多个导出字段来自管理员导入或人员资料。
- 完整调用链或数据流：CSV import/admin edit -> DB text -> export -> 管理员打开表格 -> formula evaluation。
- 复现步骤：保存 displayName `=HYPERLINK("https://example.invalid","x")`，导出并在电子表格打开。
- 实际结果：CSV 单元格保留公式前缀。
- 正确结果：不可信单元格以 `'` 等安全方式中和，并记录/测试兼容性。
- 影响：管理员工作站可能发起外连、诱导点击或在支持危险函数的客户端执行更高影响动作。
- 可被谁触发：可影响导出字段的管理员/导入文件提供者。
- 触发前提：管理员导出并用会计算公式的软件打开。
- 根本原因：CSV 转义只处理语法，没有处理电子表格执行语义。
- 是否存在补偿控制：写入口有长度/格式校验，部分关键字段模式较严格。
- 为什么补偿控制充分或不充分：displayName 等自由文本仍允许公式前缀。
- 最小修复方案：对 `^[=+\-@\t\r]` 的文本加安全前缀，保留原值仅在应用内显示。
- 更稳健的长期修复方案：集中 spreadsheet export encoder，并给管理员下载页安全提示。
- 必须新增的回归测试：所有危险前缀、前导空白、引号/换行、UTF-8 变体在 Excel/LibreOffice 中为文本。
- 修复可能影响的其他模块：导入回环、报表、审计导出。

### AUD-020：WebKit/Safari E2E 发布门禁连续两次失败

- 严重度：P2
- 置信度：已复现
- 类别：其他
- 位置：
  - `e2e/admin-flow.spec.ts:229` 附近
  - Playwright WebKit 项目与本地 mock server
- 对应业务不变量：宣称支持的浏览器关键管理员流程应稳定通过，测试不得因控制台安全错误或路由竞态随机失败。
- 现状：全套 129 个 E2E 中 128 通过、WebKit 1 个失败；目标重跑又以不同导航竞态失败。
- 证据：首次捕获 WebKit `.../api/health due to access control checks` console error；重跑时 `/admin/pilots` 导航被 `/admin/dashboard` 导航打断。
- 完整调用链或数据流：WebKit admin flow -> client service/mode/navigation -> health/request or state redirect -> test fail。
- 复现步骤：`pnpm exec playwright test`；再只跑 `e2e/admin-flow.spec.ts --project=webkit`。
- 实际结果：6.7 分钟全套后 WebKit 失败；目标重跑仍失败但症状变化。
- 正确结果：同一发布制品在 Chromium/Firefox/WebKit 均稳定通过，或明确取消 Safari 支持并移除门禁。
- 影响：Safari 管理员路径存在未定位兼容/竞态风险；也说明 mock E2E 本身不能作为稳定发布信号。
- 可被谁触发：Safari/WebKit 用户或 CI 时序。
- 触发前提：使用 WebKit 项目。
- 根本原因：尚未定位；可能是 mock 服务状态/导航竞态，不能据此断言生产功能缺陷。
- 是否存在补偿控制：Chromium、Firefox 和其余 128 测试通过；production build 通过。
- 为什么补偿控制充分或不充分：不能覆盖 Safari；失败两次表明不是单次已清除噪声。
- 最小修复方案：保存 trace/network/console，消除 health CORS 与导航来源竞态，使目标测试重复 10 次通过。
- 更稳健的长期修复方案：增加 remote-mode WebKit smoke，按支持矩阵设置稳定门禁和 flaky quarantine 规则。
- 必须新增的回归测试：WebKit admin navigation、health request origin、刷新/回退、多标签、10 次 repeat-each。
- 修复可能影响的其他模块：service mode、admin state provider、middleware、E2E harness。

## P3

### AUD-021：迁移重复创建同一 ACTIVE 唯一索引，成员迁移重复执行摘要也会误报新增量

- 严重度：P3
- 置信度：已复现
- 类别：其他
- 位置：
  - `prisma/migrations/20260814003000_active_qualification_unique/migration.sql:1-5`
  - `prisma/migrations/20260816010000_one_active_qualification/migration.sql:1-6`
  - `scripts/migrate-member-architecture.ts:230-310` 及 summary 计数
- 对应业务不变量：等价约束不应重复增加写放大；幂等迁移的摘要应区分 scanned/existing/created。
- 现状：两个不同名称的 partial unique index覆盖相同列和 predicate；成员迁移重复运行时对象不重复，但 summary 仍把处理过的 organization/person 等计作新增。
- 证据：迁移 SQL 等价；隔离升级库重复执行成员迁移成功，但摘要仍报告非零 organizations/people/pilotProfiles/records/requests/plans。
- 完整调用链或数据流：每次 QualificationRecord 写入维护两个等价索引；每次 bootstrap 日志将 processed 当 created。
- 复现步骤：应用全部迁移后查询 `pg_indexes`；成员迁移运行两次并比较数据数与摘要。
- 实际结果：两索引并存；第二次无重复数据但“新增量”式数字仍非零。
- 正确结果：保留一个稳定命名索引；摘要明确 scanned/created/updated/noop。
- 影响：小幅写入/存储开销；运维人员可能误判重复迁移在持续造数据。
- 可被谁触发：正常写入或每次 bootstrap。
- 触发前提：当前迁移集。
- 根本原因：修复迁移没有删除/重用旧索引；summary 在 upsert 外无条件递增。
- 是否存在补偿控制：两个索引都加强同一正确不变量；实际数据迁移是幂等的。
- 为什么补偿控制充分或不充分：正确性未破坏，但增加运维噪声和成本。
- 最小修复方案：向前迁移删除冗余索引；修正 summary 标签/计数。
- 更稳健的长期修复方案：schema invariant 测试比较索引语义，迁移输出结构化 created/updated/noop。
- 必须新增的回归测试：仅一个等价索引；二次成员迁移 created=0 且行数不变。
- 修复可能影响的其他模块：迁移监控、写性能、运维日志。

# 8. 待验证风险

这些项目没有进入正式发现计数：

1. **真实对象存储边界—未验证。** 代码要求私有读写并使用 5 分钟签名 URL，但未获得实际桶策略、public access block、版本控制、对象锁、生命周期、跨区复制和配额。需要一套与生产等价的 S3/MinIO 环境及只含合成数据的安全测试账号。上线影响：证书隐私与长期保存仍有未知项。
2. **真实通知渠道—未验证。** 需要供应商协议、签名认证、幂等保证、超时后查询接口、回执/退订/号码脱敏和数据处理协议。上线影响：不能宣称“已送达”或 exactly-once。
3. **真实 Qwen/VLM—未验证。** 本地代码 fail-closed，但未验证提供方数据驻留、日志保留、模型/提示版本和大图超时。需要合规批准的 sandbox 与合成证照。
4. **在线依赖漏洞—未验证。** `pnpm audit --prod` 在沙箱 DNS 失败；进一步网络调用因会向 npm registry 外发依赖元数据而未获授权。需要在组织批准的 CI/SCA 中对 lockfile 与容器 OS 包扫描。
5. **许可证最终法律结论—未验证。** 本地清单主要为 MIT/Apache/ISC/BSD，另有 sharp 运行时的 LGPL-3.0-or-later、caniuse-lite 的 CC-BY-4.0、elkjs 的 EPL-2.0。需要发布方式、NOTICE/源码提供义务和项目许可证背景才能由法务下结论；目前未发现可直接断言的不兼容。
6. **真实灾备 RPO/RTO—未验证。** 默认备份已先失败，且无联合恢复环境；需要修复 AUD-002/010 后进行定时演练、记录耗时与数据差异。
7. **生产规模性能—未验证。** 查询有关键索引和分页，但未获得预计人员/资质/附件量；需生成脱敏规模数据验证 90 天列表、member include、提醒扫描和备份窗口。

# 9. 测试和命令结果

所有临时数据库、脚本和构建目录均在 `/tmp` 或临时 Docker 资源中；审计结束已停止/删除临时 PostgreSQL 容器和 `crewqual-audit-web-20260818` 镜像。仓库产品文件未修改。

| 命令/验证                                                           |    退出码 | 结果摘要                                                                           | 结论                                         |
| ------------------------------------------------------------------- | --------: | ---------------------------------------------------------------------------------- | -------------------------------------------- |
| `pnpm lint`                                                         |         0 | ESLint 全通过                                                                      | 成功                                         |
| `pnpm typecheck`                                                    |         0 | `src`/`e2e` 无 TS 错误                                                             | 成功，但不含 scripts/seed                    |
| 临时扩展 tsconfig 后 `pnpm exec tsc -p <audit-tsconfig> --noEmit`   |         2 | scripts/seed 共 8 个错误                                                           | AUD-016                                      |
| `pnpm format`                                                       |         0 | Prettier check 通过                                                                | 成功                                         |
| `pnpm exec prisma validate`                                         |         0 | schema valid                                                                       | 成功                                         |
| `pnpm test`                                                         |         0 | 63 files、235 tests 全通过                                                         | 成功                                         |
| `CREWQUAL_TEST_NO_EXTERNAL=1 pnpm test`                             |         1 | 2 个 provider mock 测试仍期待发送调用                                              | 测试契约与强制禁外发变量冲突，不认定产品失败 |
| 临时副本中 `pnpm build`                                             |         0 | production build，68 个页面/路由输出                                               | 成功                                         |
| `pnpm exec playwright test`                                         |         1 | 129 中 128 通过，WebKit 1 失败，约 6.7 分钟                                        | AUD-020                                      |
| `pnpm exec playwright test e2e/admin-flow.spec.ts --project=webkit` |         1 | 目标重跑发生 dashboard/pilots 导航竞态                                             | AUD-020                                      |
| `docker build --target web-runner -t crewqual-audit-web-20260818 .` |         0 | 镜像 154,551,454 bytes                                                             | 构建成功；root 见 AUD-018                    |
| bootstrap/worker stage 构建                                         |         0 | 两 stage 可构建                                                                    | 运行时 bootstrap/pg_dump 失败                |
| `pnpm db:migrate`（空 PostgreSQL 16.15）                            |         0 | 31 条迁移全部应用                                                                  | migration SQL 成功                           |
| `pnpm db:bootstrap`（同一空库）                                     |         1 | 缺 `settings.positions.write`                                                      | AUD-001                                      |
| 构建出的 bootstrap stage 执行                                       |         1 | 与 host 完全相同缺权限错误                                                         | 排除 host 环境差异                           |
| 前 29 条迁移 -> 当前两条 -> member dry-run/实际/重跑                |         0 | ID、单位、资质、RETURNED 请求、DRAFT 计划保留；6 assignments/1 position assignment | 升级主路径成功，摘要问题见 AUD-021           |
| Worker 镜像内 `pg_dump` -> PostgreSQL 16.15                         |         1 | client 15.19/server 16.15 mismatch                                                 | AUD-002                                      |
| 20 并发 `consumeRateLimit(key,5,...)`                               | 0（脚本） | 20/20 allowed，最终 count=1                                                        | AUD-003                                      |
| `requestAddress` 单项/两项 XFF                                      | 0（脚本） | 单项 unresolved；两项取首地址                                                      | AUD-003                                      |
| webhook 200 + `not-json` 故障注入                                   | 0（脚本） | `{accepted:true}`                                                                  | AUD-008                                      |
| 跨组织 Person/Unit 插入（事务后回滚）                               | 0（脚本） | 插入被 DB 接受                                                                     | AUD-012                                      |
| `git diff --check`                                                  |         0 | 无 whitespace error                                                                | 成功                                         |
| 高置信度 secret pattern scan                                        |         0 | 0 个命中文件                                                                       | 未发现已提交凭据                             |
| `docker compose version` / `docker-compose version`                 |      非 0 | CLI 不存在                                                                         | 环境限制，未做 config CLI 校验               |
| `pnpm audit --prod`                                                 |      非 0 | 沙箱 DNS/网络不可用；提升权限未获数据外发授权                                      | 未验证风险                                   |

关键未执行的破坏性测试：真实数据库 restore、磁盘填满、真实供应商调用、恶意大规模上传。它们不是“通过”，而是第 8 节未知项。

# 10. 数据库与迁移结论

- **空库能否部署：不能。** 所有 migration SQL 能执行，但正式部署链的 bootstrap 失败；因此“空库可迁移”不等于“空库可部署”。
- **旧版本能否升级：代表性样本可以。** 从前 29 条迁移升级到当前 31 条，成员架构 dry-run/实际/重跑都保留了样本 ID 和业务关系。没有覆盖所有生产数据形态，尤其脏跨组织数据与超大表锁时间。
- **是否存在危险迁移：未发现当前两条迁移直接丢数据。** `position_safe_delete` 是未跟踪文件，尚未绑定到提交；发布前必须在干净 tag 上复验。
- **是否具备回滚或恢复路径：不具备已验证路径。** Prisma migration 没有下行迁移；默认 pg_dump 失败；restore 未经过完整性和联合对象验证。
- **关键不变量是否由 DB 保证：部分。** token hash、session hash、notification dedupe、recognition task、request->record、一人 legacy 同类型一个 ACTIVE 等有 unique/partial index。组织一致性、Person/Definition current 资质、计划-stage 同属、单一未消费链接、审计追加性不由 DB 保证。
- **级联风险：** legacy Pilot 删除会 cascade 资质/请求/session/token/计划，而 AuditEvent 对 Pilot 是 SetNull。当前管理 UI 以停用为主是好的补偿控制，但 DB 高权限删除仍会消灭核心业务历史，缺少禁止删除或归档不变量。

# 11. 权限矩阵

| 主体                | 人员资料      | 资质/提交/审核       | 附件                                              | 升级计划     | 提醒                                 | 审计                | 系统配置                                           |
| ------------------- | ------------- | -------------------- | ------------------------------------------------- | ------------ | ------------------------------------ | ------------------- | -------------------------------------------------- |
| SUPER_ADMIN         | 全局读写      | 全局读写/决定        | 可经关联读取                                      | 全局读写     | 全局读/重试                          | 可读                | 全部；备份 restore 另有权限且 service 再要求 super |
| ADMIN（有 unit）    | 本中队读写    | 本中队读写/决定      | 随所属 Pilot                                      | 本中队读写   | 本中队读/重试                        | 默认无 `audit.read` | 单位/职位/通知；无管理员/安全/备份                 |
| REVIEWER（有 unit） | 本中队只读    | 本中队读/决定        | 随审核关联                                        | 只读         | 只读                                 | 无                  | settings 只读                                      |
| VIEWER（有 unit）   | 本中队只读    | 本中队只读           | 随只读关联                                        | 只读         | 只读                                 | 无                  | settings 只读                                      |
| 一次性访问人员      | 仅本人        | 本人读取/提交        | 仅 `EvidenceImage.pilotId=自身` 的 5 分钟签名 URL | 本人展示路径 | 本人 inbox                           | 无管理审计          | 无                                                 |
| Worker              | DB 级广泛读写 | 只写 AI 结果，不批准 | 全部对象读写/删除                                 | 不改业务状态 | 创建/领取/发送/重试                  | 间接业务记录        | 可解密集成/备份密钥并执行 restore                  |
| 外部 SMS/飞书       | 无 DB         | 无                   | 无                                                | 无           | 收到目标和消息；SMS 可含一次性 token | 无                  | 无                                                 |
| 外部 VLM            | 无 DB         | 只返回提取建议       | 接收单张证照像素                                  | 无           | 无                                   | provider/model 结果 | 无                                                 |

矩阵中的关键例外：AUD-004 允许 ADMIN 通过升级 PATCH 把 own-unit 计划重绑到 other-unit Pilot；AUD-012 表明 DB 不能作为该边界最后一道防线。

# 12. 上线前必须修复项

按依赖顺序：

1. 冻结一个干净 release commit/tag，纳入未跟踪迁移；让所有验证可绑定同一镜像 digest。
2. 修复 AUD-001，建立“空库 migrate + bootstrap 两次 + web/worker healthy”的强制 CI 门禁。
3. 完成新旧成员/资质架构收口（AUD-004/005/006/012），先跑全库一致性检查，再开放真实数据写入。
4. 实现可审计的 ROLLBACK，并使 correction/ACTIVE 变更版本化且事务化（AUD-007）。
5. 原子修复限流和可信代理解析（AUD-003），再进行认证/链接并发测试。
6. 修复通知协议 fail-open，并实现升级 7 日及管理员提醒（AUD-008/009）。
7. 修复数据库客户端版本并完成备份/恢复闭环（AUD-002/010）；在隔离环境拿到书面 RPO/RTO 和一次成功恢复证据。
8. 给上传建立主体配额、并发和 backlog 控制（AUD-011）。
9. 所有 P0/P1 回归矩阵通过，WebKit 门禁稳定或正式收窄浏览器支持范围。

# 13. 上线后两周内应修复项

本报告不建议在 P1 未清零时上线。若完成第 12 节后发布，两周内应完成：

1. AUD-013：签发唯一性、人员 logout 和身份变更会话撤销。
2. AUD-014：统一 DateOnly/时区语义。
3. AUD-015：建立原始证据/派生链最小追溯数据。
4. AUD-016：脚本 typecheck 和 production seed 安全分离。
5. AUD-017：备份/恢复审计与 append-only 防护。
6. AUD-018/019：容器非 root、CSP nonce、CSV 公式中和。
7. AUD-020：稳定 WebKit/Safari 支持信号。

# 14. 后续工程改进

- 为所有 tenant-owned 表引入显式 organizationId 与组合 FK/约束触发器。
- 把散落的 qualification、upgrade、notification 状态转换改成单一领域服务，Route 只负责 auth/parse。
- 建立 schema invariant tests：等价索引、跨组织关系、current record、plan/stage 同属。
- 为备份、Worker heartbeat、队列深度、失败终态、orphan backlog、S3 容量建立指标和告警。
- 拆分 Web 与 backup restore 的数据库权限；Worker 中也进一步分离通知、AI、清理、灾备角色。
- 生成 SBOM，固定 CI action/镜像，接组织批准的 SCA 与许可证审查。
- 删除冗余 ACTIVE 索引并修正成员迁移摘要（AUD-021）。

# 15. 建议新增测试矩阵

| 前置状态                            | 操作                                                | 预期结果/不变量                               | 层级                        |
| ----------------------------------- | --------------------------------------------------- | --------------------------------------------- | --------------------------- |
| 空 PostgreSQL                       | migrate -> bootstrap 两次 -> 启动 Web/Worker        | 完整权限目录；幂等；health green              | integration/container       |
| 上一版本代表性+脏数据               | apply current migration/member migration            | ID/历史/关系保留；非法归属显式阻断            | integration                 |
| 新限流桶，100 并发                  | 登录/链接请求                                       | 每 key 仅 N 个成功；窗口原子翻转              | integration/fault injection |
| 单层/多层 Caddy                     | 带真实与伪造 XFF 请求                               | 取正确 client；外部不能伪造信任链             | E2E                         |
| A/B 两中队                          | A admin 改 body 中 pilot/person/definition/stage ID | 403/404，零写入                               | integration/E2E             |
| 缺职位前置资质                      | create-start、draft-start、resume                   | 三入口全部拒绝                                | integration                 |
| requiresEvidence/review 定义        | member、admin direct、CSV 三入口                    | 统一策略；写齐 Person/Definition              | integration                 |
| 同一 PENDING 两审核员               | 并发 approve/return/correct                         | 仅一胜者；一个 ACTIVE；审计完整               | integration                 |
| 已批准 N 版本                       | rollback 到 N-1                                     | current 切换、所有版本/证据保留、通知正确     | integration/E2E             |
| correction audit 写失败             | 注入 DB 故障                                        | 字段修改也回滚                                | fault injection             |
| webhook 各种 2xx/错误体             | 发送通知                                            | 仅严格 accepted=true 成功；UNKNOWN 不清 token | unit/integration            |
| provider 超时但实际接受             | Worker 重试                                         | 相同 idempotency key；状态表达 UNKNOWN        | fault injection             |
| 两 Worker 同 job                    | 同时领取通知/AI/backup                              | 单 claim；无重复业务状态                      | integration                 |
| stage 距今 7 日                     | reminder 扫描两次/停机跨窗                          | 每 recipient 一条；可补发不重复               | integration                 |
| 当地到期日各时刻                    | 查 legacy/member/dashboard/worker                   | 所有路径状态一致                              | unit/integration            |
| 同一身份并发签发                    | 发送 20 个 access requests                          | 按策略最多一个 live token/一组通知            | integration                 |
| 同一 token 并发消费                 | 20 次 POST                                          | 恰一成功，其余 USED；一 session               | integration                 |
| 改手机号/员工号/停用/登出           | 使用旧 token/session                                | 按安全策略全部失效                            | integration/E2E             |
| 10 MiB 合法图并发/断流              | 上传                                                | 早期限流/配额；无 S3/DB 垃圾                  | fault injection             |
| 伪 MIME/坏 JPEG/超尺寸/尾部 payload | 上传                                                | 422；不写 S3/DB                               | unit/integration            |
| S3 成功 DB 失败                     | 上传                                                | 对象补偿删除或可靠清理                        | fault injection             |
| 图片优化中并发审核                  | AVIF 替换                                           | 审核引用对象版本稳定，hash 可验证             | integration                 |
| 默认 Compose 数据库                 | dump -> 新库 restore                                | 版本兼容、逐表/引用 hash 一致                 | container/DR                |
| artifact/object 篡改                | restore                                             | 在任何破坏写前拒绝                            | integration/DR              |
| restore 进行中                      | 发 Web 写请求/Worker job                            | 维护模式拒绝/暂停；恢复后不重复提醒/token     | fault injection             |
| CSV 危险前缀                        | 导出并用表格解析                                    | 所有单元格为文本                              | unit                        |
| production build                    | Chromium/Firefox/WebKit 私有页、刷新/后退           | 无跨用户缓存；关键流程稳定                    | E2E                         |

# 16. 最终上线门槛

## 已满足

- [x] pnpm lockfile 存在，依赖安装与 production build 可复现到本次环境。
- [x] lint、常规 typecheck、format、Prisma validate、235 个 Vitest 全通过。
- [x] 31 条 migration SQL 可从空 PostgreSQL 16.15 全部执行。
- [x] 代表性上一版本数据可升级并保留；成员迁移可重复执行而不重复造实体。
- [x] 管理员 session 每请求重读 active、角色、权限和 unit；停用/角色变更即时影响旧 session。
- [x] 一次性令牌高熵、hash-only、短 TTL、绑定 Pilot、原子单次消费、no-store/no-referrer/noindex。
- [x] AI 不可用/畸形/低确定性不会自动批准。
- [x] 图片做 magic/decode/尺寸/大小检查，服务端重编码去 EXIF；对象 key 随机、签名 URL 5 分钟且按 Pilot 授权。
- [x] legacy 同 Pilot/类型仅一个 ACTIVE 有数据库 partial unique 保护；审批事务有 version/conditional update。

## 尚未满足（阻断 GO）

- [ ] 空库 production bootstrap 成功，Web/Worker healthy（AUD-001）。
- [ ] 默认 PostgreSQL 备份可执行并完成一次可验证恢复（AUD-002/010）。
- [ ] 限流并发与可信代理测试通过（AUD-003）。
- [ ] 升级计划所有关联目标服务端 scope 与 DB 归属不变量通过（AUD-004/012）。
- [ ] start/resume 共用职位前置规则（AUD-005）。
- [ ] 资质 canonical 模型收口，所有入口遵守 Definition 策略且所有视图一致（AUD-006）。
- [ ] 实现并验证 ROLLBACK；纠正/修改历史可恢复且审计原子（AUD-007）。
- [ ] 通知严格解析供应商协议；实现升级 7 日和管理员提醒（AUD-008/009）。
- [ ] 上传资源配额和并发保护通过故障测试（AUD-011）。
- [ ] 所有生产脚本进入 typecheck；发布来源是干净、不可变的 commit/tag（AUD-016）。
- [ ] 支持浏览器关键 E2E 稳定通过（AUD-020）。

## 未经验证

- [ ] 真实 S3 私有策略、版本/对象锁、恢复一致性。
- [ ] 真实短信/飞书幂等、UNKNOWN/回执、数据处理合规。
- [ ] 真实 VLM 数据驻留、保留和模型版本追溯。
- [ ] 在线依赖/OS 镜像 CVE 与最终许可证审查。
- [ ] 生产规模性能、磁盘满、长停机补发、RPO/RTO。

## 从 NO-GO 转为 GO 的条件

1. AUD-001 至 AUD-011 全部有代码修复、数据库迁移、指定回归测试和独立复核；不得只改文档或 UI。
2. 在一个干净 release tag 上，从空库构建并启动默认 Compose 等价环境；Web/Worker/数据库/对象存储健康，bootstrap 可重复。
3. 使用合成但关系完整的数据，成功完成数据库+图库联合备份、篡改拒绝、全新环境恢复和引用校验；记录 RPO/RTO。
4. 认证、跨中队 IDOR、令牌并发、双重审批、提醒重试、日期边界、上传故障矩阵全部通过。
5. P2 中 AUD-012、AUD-014、AUD-016、AUD-017 至少在首发前一并解决；其余 P2 若延期，必须有明确 owner、期限、监控和书面风险接受。
6. 完成经授权的 SCA/容器漏洞扫描和真实外部集成 sandbox 验证，所有未知项有负责人和上线限制。

在这些条件满足前，CrewQuel v0.1 的正确描述是：**具备较好的应用安全基础和可运行的演示/测试主路径，但尚不具备真实部署、长期保存数据和可信灾备所需的生产闭环。**
