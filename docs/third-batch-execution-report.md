# CrewQual 第三批修复执行报告

审计日期：2026-08-16（Asia/Shanghai）  
验收基线：`THIRD_BATCH_REMEDIATION_GOAL.md`  
结论：B3-001 至 B3-018 全部完成；没有未关闭的第三批 P0/P1 代码缺陷。当前适合受控真实用户验收，不等同于无需运营准备即可面向公众生产发布。

## 1. 最终状态

| 指标                | 结论                                                                |
| ------------------- | ------------------------------------------------------------------- |
| 第三批条目          | 18 Completed / 0 Blocked / 0 Not started                            |
| 当前成熟度          | Production-capable Alpha                                            |
| 真实用户            | Yes with restrictions：允许小范围、可回滚、有人工值守的验收/试点    |
| 生产部署            | No：真实外部供应商、备份恢复、TLS 域名和负载演练尚未完成            |
| 数据库              | 24 个 migration；现有库升级及全新空卷部署均成功                     |
| 单元/组件/契约测试  | 53 个文件、194/194 通过                                             |
| Mock 三浏览器 E2E   | 126/126 通过，Chromium/WebKit/Firefox，6.1 分钟                     |
| Remote 真实后端 E2E | 18 passed / 6 skipped，Chromium/WebKit/Firefox，2.3 分钟            |
| Docker/Compose      | 最新三个 target 构建、空卷迁移、健康、Worker 故障及恢复均已实际验证 |
| 第三批遗留 P0/P1    | 无                                                                  |

Remote 的 6 个 skip 是三项会持久修改数据的对抗场景在 WebKit/Firefox 中按设计跳过；它们各自在 Chromium 执行并通过。上传、审批、响应式和 Pilot 收件箱仍在三个浏览器执行。

## 2. B3 逐项验收

| ID     | 状态      | 已实现和主要证据                                                                                                                                                         | 主要测试                                                                                                 |
| ------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| B3-001 | Completed | `src/server/admin-repository.ts` 在同一事务读取 ACTIVE 记录、比较申请 `expectedVersion`、条件更新并返回结构化 409；冲突写入 audit                                        | `src/server/admin-repository.test.ts`；remote `adversarial conflicts...`                                 |
| B3-002 | Completed | `src/lib/qualification-rules.ts`、审批/纠正路径只使用不可变 rule snapshot；历史推断快照标记 `inferred_backfill` 且不能自动通过                                           | `src/lib/qualification-rules.test.ts`；`src/server/qualification-verification.test.ts`                   |
| B3-003 | Completed | `trainingDate` 贯通 Prisma、API、Pilot/Admin 表单、序列化、CSV 和审核对比；日期规则统一校验                                                                              | `qualification-update-flow.test.tsx`；`pilot/submissions/route.test.ts`；remote 四规则测试               |
| B3-004 | Completed | 四类有效期规则由服务端共享规则执行；Admin 直建、Pilot 提交、复核纠正均校验 issue/training/expiry/parameter                                                               | `qualification-rules.test.ts`；`admin-review-validation.test.ts`；remote `four validity rules...`        |
| B3-005 | Completed | 参数限制具有版本、allowed values/regex enforcement 和 rule snapshot；配置更新不反向改变既有记录                                                                          | `qualification-config-view.test.tsx`；`qualification-rules.test.ts`；mock E2E 配置保存场景               |
| B3-006 | Completed | 快照 NOT NULL、EvidenceImage 单关系唯一、一人同类资质最多一条 ACTIVE；数据库约束拒绝绕过应用的重复写                                                                     | migration 审计 SQL；remote 双审批竞争和直接 INSERT SQLSTATE `23505`                                      |
| B3-007 | Completed | `src/server/notifications.ts` 统一审批、退回、升级、节点、到期和失败告警事件；按单位路由、多渠道和稳定 dedupe key                                                        | `src/server/notifications.test.ts`；`worker-handlers.test.ts`                                            |
| B3-008 | Completed | 每渠道独立 `createMany(skipDuplicates)`；仅新建 delivery 入队；并发/补渠道不会回滚其他渠道                                                                               | `notifications.test.ts` 的补渠道和全重复 no-op 场景                                                      |
| B3-009 | Completed | `worker-handlers.ts` 自动重试、封顶指数退避、attempt/error/final reason、稳定外部 idempotency key、stale claim；终态失败生成独立管理员告警；手工 retry 有 retry cycle    | 三次尝试成功、终态失败告警、retry route 测试；provider tests                                             |
| B3-010 | Completed | Pilot scoped 收件箱、未读数、详情、`readAt`、列表/UI；GET/PATCH 强制 pilotId，运维失败告警不泄露到 Pilot                                                                 | `pilot/notifications/notifications.test.ts`；remote 三浏览器 inbox + 跨 Pilot IDOR                       |
| B3-011 | Completed | 渠道 enabled 状态持久化并按显式单位配置；`NotificationType` 为数据库 enum，覆盖 upgrade/access-link/failure；remote UI 不显示 Mock 标签                                  | `admin-settings-view.test.tsx`；settings service/route 测试；deployment/config tests                     |
| B3-012 | Completed | Magic Link raw token 仅在内存出现；队列保存加密 TTL payload，成功/过期清理；暂时失败可重试；连续请求保留现有未过期链接，不静默失效                                       | `pilot/access-link/route.test.ts`；worker secure payload/retry 测试                                      |
| B3-013 | Completed | VLM 只提取字段；`qualification-verification.ts` 用 submitted fields、Pilot、snapshot、ocrChecks 作确定性分项比较；人工审批是唯一生效动作                                 | `vlm.test.ts`；`qualification-verification.test.ts`；`approval-dialog.test.tsx`                          |
| B3-014 | Completed | RecognitionTask 严格 enum、图片/任务唯一、原子 claim、stale recovery、provider/retryLimit；提取复用；VerificationResult request 唯一并 upsert                            | `worker-handlers.test.ts`；`recognition-pgboss-e2e.ts` 真 PostgreSQL/pg-boss + 假 VLM；remote 上传       |
| B3-015 | Completed | `InspectionItem` 和 `UpgradePlanInspectionItem` 规范化；创建时选择并保存名称/规则版本快照；详情、阶段、日历、完成记录贯通                                                | remote `inspection-item plan persists, edits, reaches calendar and completes`                            |
| B3-016 | Completed | DRAFT/NOT_STARTED versioned PATCH；ACTIVE 白名单、终态只读；before/after audit；启动/恢复只检查 `core=true` 资质                                                         | `upgrade-plan-rules.test.ts`；remote 升级计划编辑/启动/完成；mock 生命周期 E2E                           |
| B3-017 | Completed | 密码/TOTP 重置撤销 sessions；TOTP 只保留 ciphertext；CLI secret 经 stdin；可信代理和账号/IP 双限流；未知账号 dummy Argon2；lastSeen 节流；生产 CSP                       | `credential-reset.test.ts`、`auth.test.ts`、`rate-limit.test.ts`、`config.test.ts`；remote 旧 Cookie 401 |
| B3-018 | Completed | DATE/TIMESTAMPTZ 迁移；web/worker/migration Docker targets；固定关键镜像 digest；migration job、healthcheck、heartbeat；`pg` pipeline 消除并发 query deprecation warning | deployment tests；跨时区规则测试；实际 Docker build、空卷 Compose、HTTP 200→Worker 停止 503→恢复 200     |

## 3. 主要变更文件

以下为第三批核心文件，不包含 Prisma 自动生成客户端文件：

- 资质与审核：`src/lib/qualification-rules.ts`、`src/lib/admin-review-validation.ts`、`src/server/admin-repository.ts`、`src/server/qualification-verification.ts`、`src/app/api/pilot/submissions/route.ts`、`src/app/api/admin/reviews/[reviewId]/*`、`src/app/api/admin/pilots/[pilotId]/qualifications/*`。
- 前端与 CSV：`src/components/pilot/qualification-update-flow.tsx`、`src/components/admin/qualification-config-view.tsx`、`src/components/admin/review-detail-view.tsx`、Pilot/Admin services 和 pilot import/export routes。
- 通知：`src/server/notifications.ts`、`src/server/worker-handlers.ts`、`src/server/providers.ts`、`src/app/api/admin/notifications/*`、`src/app/api/pilot/notifications/*`、`src/components/pilot/pilot-notifications-view.tsx`。
- Magic Link：`src/app/api/pilot/access-link/route.ts`、`src/server/crypto.ts`、`src/server/sms-outbox.ts`。
- OCR：`src/server/vlm.ts`、`src/server/qualification-verification.ts`、`src/server/worker-handlers.ts`、`src/app/api/evidence-images/[id]/recognitions/route.ts`、`src/app/api/recognitions/[id]/route.ts`。
- 升级计划：`src/server/upgrade-plan-rules.ts`、`src/app/api/admin/upgrade-plans/*`、`src/components/admin/upgrade-plan-form.tsx`、`src/components/admin/upgrade-plan-detail-view.tsx`、`src/app/admin/upgrade-plans/[planId]/edit/page.tsx`。
- 安全与运行：`src/server/auth.ts`、`src/server/rate-limit.ts`、`src/server/config.ts`、`src/server/prisma.ts`、`src/app/api/health/route.ts`、`src/worker/index.ts`、`scripts/admin.ts`、`scripts/migrate-totp-secrets.ts`、`scripts/worker-health.mjs`、`next.config.ts`。
- 部署：`Dockerfile`、`docker-compose.yml`、`.dockerignore`、`Caddyfile`、`.env.example`、`docs/backend-operations.md`。
- 验收：`e2e/remote/remote-backend.spec.ts`、`scripts/recognition-pgboss-e2e.ts`、`scripts/run-remote-e2e.mjs` 以及各模块相邻的 `*.test.ts(x)`。

## 4. Migration 清单

第三批新增并在现有数据库及全新空卷实际部署的 9 个 migration：

1. `20260816020000_add_training_date`
2. `20260816020100_backfill_rule_snapshots_and_evidence_integrity`
3. `20260816020200_version_parameter_restrictions`
4. `20260816020300_notification_delivery_reliability`
5. `20260816020400_recognition_reliability`
6. `20260816020500_upgrade_inspection_items`
7. `20260816020600_remove_plaintext_totp_and_track_pilot_activity`
8. `20260816020700_explicit_date_and_timestamptz_semantics`
9. `20260816020800_worker_heartbeat`

相关先行约束 migration `20260816010000` 至 `20260816013000` 也保留在迁移链中。最终 `_prisma_migrations` 有 24 条已完成记录，Prisma schema diff 返回 `No difference detected`。

### 迁移前保护

- Preflight SQL 位于 `20260816020100_backfill_rule_snapshots_and_evidence_integrity`、`20260816020400_recognition_reliability` 和 `20260816020500_upgrade_inspection_items` 的 `migration.sql`；核心形态如下：

```sql
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "QualificationEvidence"
    GROUP BY "evidenceImageId" HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate QualificationEvidence rows found for one EvidenceImage';
  END IF;
END $$;
```

- Evidence 迁移在同一图片已有多关系时 `RAISE EXCEPTION`，禁止自动猜测合并。
- Recognition 迁移在同一图片存在相互冲突的 completed result 时中止；一致/未完成重复只保留确定性首条。
- 升级检查项目迁移在历史计划缺失 stage 0 时中止。
- 历史资质规则只能按迁移时规则回填，明确标为 `snapshotSource=inferred_backfill`，业务层禁止把它当成原始提交快照自动审批。
- TOTP 密文迁移完成后移除 plaintext 列；回滚方式是恢复迁移前加密备份，不提供会重新引入明文的 down migration。

### 迁移后数据审计

在现有 `crewqual-postgres` 执行以下审计 SQL（同类计数以 `UNION ALL` 汇总）：

```sql
SELECT 'null_record_snapshots', count(*)
FROM "QualificationRecord" WHERE "qualificationRuleSnapshot" IS NULL
UNION ALL
SELECT 'null_request_snapshots', count(*)
FROM "QualificationUpdateRequest" WHERE "qualificationRuleSnapshot" IS NULL
UNION ALL
SELECT 'duplicate_evidence_relations', count(*) FROM (
  SELECT "evidenceImageId" FROM "QualificationEvidence"
  GROUP BY 1 HAVING count(*) > 1
) s
UNION ALL
SELECT 'duplicate_active_qualifications', count(*) FROM (
  SELECT "pilotId", "qualificationTypeId" FROM "QualificationRecord"
  WHERE status = 'ACTIVE' GROUP BY 1, 2 HAVING count(*) > 1
) s
UNION ALL
SELECT 'duplicate_recognition_tasks', count(*) FROM (
  SELECT "evidenceImageId", "taskType" FROM "RecognitionTask"
  GROUP BY 1, 2 HAVING count(*) > 1
) s
UNION ALL
SELECT 'duplicate_verification_results', count(*) FROM (
  SELECT "requestId" FROM "VerificationResult"
  GROUP BY 1 HAVING count(*) > 1
) s;

SELECT count(*) AS plaintext_totp_column_exists
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'AdminUser'
  AND column_name = 'totpSecret';
```

结果摘要：

```text
applied_migrations|24
duplicate_active_qualifications|0
duplicate_evidence_relations|0
duplicate_recognition_tasks|0
duplicate_verification_results|0
integration_queue_residue|0
invalid_totp_ciphertext|0
null_record_snapshots|0
null_request_snapshots|0
plans_without_inspection_item|0
plaintext_totp_column_exists|0
```

Remote 对抗测试绕过 Prisma 直接插入第二条 ACTIVE 记录，PostgreSQL 返回 SQLSTATE `23505`。并发请求同一审核两次返回一个 200、一个 409，最终 ACTIVE 计数为 1。

## 5. 测试和发布门禁

执行日期均为 2026-08-16；退出码均为 0。测试过程出现的 `NO_COLOR`/`FORCE_COLOR` 提示不是应用 warning。最终 Worker 日志没有 `pg` concurrent query deprecation warning。

| 命令                                                  | 结果 | 数量/说明                                                                            |
| ----------------------------------------------------- | ---- | ------------------------------------------------------------------------------------ |
| `corepack pnpm format`                                | Pass | 全仓 Prettier                                                                        |
| `corepack pnpm lint`                                  | Pass | ESLint 无 error                                                                      |
| `corepack pnpm typecheck`                             | Pass | `tsc --noEmit`                                                                       |
| `corepack pnpm test`                                  | Pass | 53 files，194/194                                                                    |
| `NEXT_TELEMETRY_DISABLED=1 corepack pnpm build`       | Pass | Prisma 7.9.1 generate，Next 15.5.23 production build，51 个 static pages             |
| `corepack pnpm test:e2e`                              | Pass | 126/126，Chromium/WebKit/Firefox，6.1m；响应式、键盘、axe critical/serious           |
| `corepack pnpm test:e2e:remote`                       | Pass | 假 VLM/真 PostgreSQL/pg-boss 集成门禁 + 浏览器 18 passed / 6 skipped，2.3m           |
| `docker compose build`（Compose v2.29.7）             | Pass | 最新 web/worker/migration targets                                                    |
| `docker compose ... up`（隔离项目 `crewqualb3final`） | Pass | 空卷、24 migrations、bucket init、12 pg-boss tables、Web/Worker healthy、Caddy smoke |
| 停止/恢复 Worker                                      | Pass | 心跳过期后 HTTP 503 `worker=unavailable`；重启后 HTTP 200 `worker=ok`                |

重点真实场景：

- Pilot 图片上传 → MinIO → Recognition/Worker → 提交 → Admin 队列 → versioned approve。
- 四类有效期服务端规则。
- 旧申请对新资质版本返回 `QUALIFICATION_CHANGED_SINCE_SUBMISSION` 409，正式记录保持新值。
- 双审批竞争和数据库唯一约束。
- Pilot 收件箱已读和跨 Pilot GET/PATCH 均 404。
- 检查项目创建、PATCH、日历显示、启动、阶段完成。
- 密码重置后当前旧 Cookie 立即 401；测试结束安全恢复测试账号密码 hash。

OCR 的永久集成门禁先在真实 PostgreSQL 创建 RecognitionTask，通过真实 pg-boss 队列消费本地假 VLM，然后重放同一 payload；输出为 `handled=2`、`extractionCalls=1`、`taskStatus=COMPLETED`。浏览器 remote 环境仍显式禁用真实模型外呼，验证 `UNAVAILABLE` 降级和人工可继续。没有把真实 Qwen 供应商未接入伪装成已测试。

## 6. Docker/Compose 实测

### 构建

- 最终 BuildKit 首次上下文：2.46 MB；并行 target 的缓存命中上下文为 29.50 kB。`.dockerignore` 排除了本地及嵌套 `node_modules`。
- `crewqualb3final-web`: 118,408,105 bytes，image ID `sha256:1c3226ae...`。
- `crewqualb3final-worker`: 349,482,658 bytes，image ID `sha256:f149ffc3...`。
- `crewqualb3final-migrate`: 369,940,925 bytes，image ID `sha256:c58fc2d3...`。
- Node、PostgreSQL、MinIO、Caddy 均使用固定版本或 digest；关键运行服务没有 floating `latest`。

### 空卷 smoke

隔离项目使用 18080/18443，避免覆盖宿主机已有 80/443 服务。MinIO bucket init 和 migration job 退出 0；数据库为 24 migrations、12 张 pg-boss 表、1 条新鲜 Worker heartbeat。

通过 Caddy 访问 `/api/health`：

```text
HTTP 200: database=ok storage=ok queue=ok worker=ok
stop worker
HTTP 503: database=ok storage=ok queue=ok worker=unavailable
restart worker
HTTP 200: database=ok storage=ok queue=ok worker=ok
```

生产 CSP 为 `default-src 'self'`，不含开发期的 `unsafe-eval`；Caddy 的 HSTS、nosniff、frame、permissions policy 同时存在。

首次隔离启动使用 `SMS_ADAPTER=disabled`，Worker 按预期 fail closed 并报告“Production requires a real SMS adapter”；改用隔离 webhook 配置后通过。此记录证明生产保护有效，也说明生产部署必须先提供真实 SMS endpoint，不能把 `disabled` 当作可上线配置。验收完成后隔离容器、网络和四个测试卷已删除；构建镜像保留，现有数据库/MinIO 未删除。

## 7. 已知限制与剩余风险

这些是上线运营准备或 P2 加固项，不是未关闭的 B3 P0/P1：

| 优先级 | 限制/风险                                                                 | 临时控制                                              | Owner               |
| ------ | ------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------- |
| P2     | 未使用真实 SMS/Feishu 供应商 sandbox 验证 timeout、幂等和回执语义         | 上线前供应商 sandbox；首批人工核对 delivery/attempt   | Backend + Ops       |
| P2     | 未对真实 Qwen/VLM endpoint 做契约和质量验收                               | AI 永不自动生效；`UNAVAILABLE/UNCERTAIN` 强制人工复核 | AI + Product        |
| P2     | 未执行真实备份恢复和对象版本恢复演练                                      | 仅受控试点；先完成 runbook 中的隔离恢复演练           | Ops                 |
| P2     | 未执行负载、长稳、队列积压和数据库容量测试                                | 限制试点用户/并发；监控 DB、queue、latency            | Backend + Ops       |
| P2     | 未使用真实域名和 ACME 证书验证 80/443；本机仅验证 Caddy HTTP 反代和安全头 | 正式域名预发布环境做 HTTPS/certificate renewal smoke  | Ops                 |
| P2     | 当前告警主要在 Admin 通知日志和健康端点，尚无外部 on-call/指标平台        | 试点期间人工值守通知失败列表和 `/api/health`          | Ops                 |
| P2     | 历史 `inferred_backfill` 无法重建当时不存在的规则版本                     | 禁止自动审批；人工确认后再生效                        | Compliance          |
| P2     | Worker 镜像仍包含 production dependency 树，349 MB，可继续瘦身            | 已与 Web/源码分离，不影响正确性；后续做 bundle/prune  | Platform            |
| P2     | 当前宿主机没有系统安装的 Compose plugin，验收使用校验过的 v2.29.7 二进制  | 正式构建节点固定安装并校验 Compose 版本               | Platform            |
| P2     | 当前工作区没有 Git metadata，无法把本报告证据绑定到 commit SHA            | 发布前在受版本控制仓库生成 tag/SBOM/镜像 provenance   | Release Engineering |

## 8. 发布判断

### 是否允许真实用户使用

**Yes with restrictions。** 可用于一个单位内的小规模真实用户验收，条件是：人工审核持续开启、真实 SMS 和对象存储凭据已验证、有人查看失败通知和健康状态、具备回滚窗口，并明确这是 Alpha 试点。

### 是否允许今天直接生产部署

**No。** 代码和容器达到了 production-capable Alpha，但真实供应商契约、备份恢复、正式 TLS 域名和负载/容量尚无运行证据。对涉及人员资质有效性的系统，这些运营门禁不能由单元测试或本地 Compose 替代。

### 完成定义复核

- trainingDate/non-expiring 可真实提交、保存和复核：通过。
- 旧申请不能覆盖新正式资质：通过，remote 409。
- Pilot 可读取/标记自己的 IN_APP：通过，remote IDOR。
- retryLimit 有自动重试行为：通过，三次尝试和封顶终态测试。
- OCR matched 由服务端决定，图片 extraction 唯一：通过。
- 升级计划有检查项目和整体编辑：通过。
- 密码/TOTP 重置撤销 session：通过。
- 最新 Docker/Compose 实际启动：通过。
- Remote E2E 包含冲突和权限对抗；Compose 包含 Worker 失败降级：通过。

因此 `THIRD_BATCH_REMEDIATION_GOAL.md` 的代码修复目标可以标记为 complete；生产发布仍受本报告第 7、8 节的运营门禁约束。
