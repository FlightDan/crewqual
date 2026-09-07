# 资质状态与审批修复验收记录

日期：2026-09-07。基线为 v1.0.4 / c922fc15；原工作树已有修改，本次保留这些修改，未提交或发布。以下执行结果针对本地修复工作树，不代表生产系统或正式候选镜像已经通过验收。

## 已实现的业务口径

- 数据库 DATE 保持 YYYY-MM-DD，按持有人所属单位时区计算自然日。到期日当天有效并显示“今日到期”，次日当地零点起过期。
- 明确区分缺失、数据不完整、长期有效、即将到期及过期。空日期不再证明长期有效；无法确证及 inferred_backfill 快照进入人工核查。
- 从有效资质分配查起，合并同一定义的必需性（OR）并保留来源。必需项影响整体健康，可选项保留单项异常，无分配显示未配置。
- 成员列表/详情、职位统计、旧管理员列表/详情、成员证照接口、看板、日历、升级门禁、提醒与 mock 投影使用共享判定。名单、看板及日历在业务跨日和恢复焦点/网络时刷新。
- 新管理员名单查询在数据库完成筛选、排序和分页，并检查 SQL 与领域健康判定一致；两核心仓库使用 Prisma 关联类型，取消文件级 any 豁免。
- 提交捕获正式记录 ID、版本与捕获时间；审批事务检查 ID、版本、ACTIVE 状态和申请 CAS。回滚及修订递增版本，材料可以跨修订复用。
- 成员迁移保留已经关联且 ID 不同的 canonical Person；身份冲突拒绝处理。迁移锁定 Pilot 并核对 ID、单位、工号、版本，避免并发编辑后用旧快照覆盖资料。
- 旧记录如果明确指向其他成员，不会作为当前成员的可选资质被追加展示。

## 新迁移与上线顺序

1. `20260907000000_qualification_submission_baseline` 增加可空基准字段；不回填未知历史基准。移除旧材料单图片唯一约束/独立索引，补图片—记录、图片—申请的成对唯一索引。若存量已违反成对唯一约束，需先核查，不能删除证据来强行通过。
2. `20260907010000_qualification_reminder_today` 定向修正历史到期当天错误 expired 去重键。QUEUED 改用今日模板，SENT 保留原发送内容；保留审计、尝试记录和投递身份。SENDING 或已有 today 键冲突会拒绝迁移。
3. 应用切换期间必须停止所有旧提醒和投递 worker，排空发送中任务，应用迁移后仅启动新代码。审批写入口整体切换，避免旧实例绕过新基准保护。
4. 无基准的旧待审申请返回明确错误；经人工核对后退回并重新提交，保留原内容及审计。不能把当前记录 ID 伪装成历史提交基准。应用回退也必须保留新审批保护。

## 已有执行证据

| 检查                  | 结果与范围                                                                                                                                                                                |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 单元/组件测试         | 最终全量 486 项通过，包含跨时区看板及迁移身份回归。19 项数据库测试由独立真实 PG 运行，普通测试按配置跳过。初次并行安装向导超时，单独及较低并发全量重跑通过。                              |
| PostgreSQL 迁移与权限 | 从空库完整执行 43 个迁移；完整入口完成角色 provision、pg-boss schema v37 / 6 队列、grant、verify。                                                                                        |
| 数据库业务回归        | 19 项通过：目录/领域合同 5、审批回滚 5、只读核查 1、提醒迁移 3、成员迁移幂等与并发 5。审批业务使用非超级用户 crewqual_app；夹具使用 owner。认证、通知、存储边界在审批函数集成中为测试桩。 |
| 材料与并发            | 真实回滚入口带历史材料验证版本递增、跨修订材料复用；旧基准、不同 ID 相同版本 ABA、旧未知基准被拒绝；并发首批审批仅一个成功，无失败事务部分副作用。                                        |
| 提醒升级回归          | 原迁移 SQL 在真实 PG 临时表执行；QUEUED/SENT/真正过期、重复执行、SENDING 与键冲突原子拒绝均通过。                                                                                         |
| 列表性能基线          | 合同夹具 10,000 人、5,000 匹配，分页只传输 20 个 ID；一次 EXPLAIN ANALYZE 执行约 143 ms、规划约 3.3 ms。该数字不是生产性能承诺。                                                          |
| 限流与识别队列        | PG 16.15 限流通过（并发允许数 3）；pg-boss 识别幂等通过（处理 2 次、模型提取 1 次）。                                                                                                     |
| 对象存储              | 隔离 MinIO bucket 初始化及 create/head/put/head/delete 通过。                                                                                                                             |
| 应用构建              | 本地 Next 生产构建通过；最终静态检查/浏览器结果见本文件末尾更新。                                                                                                                         |

环境：仅使用本次创建的 PostgreSQL / MinIO 容器、回环地址与 tmpfs，无宿主持久卷。原始本地 Docker 镜像因缺 parent snapshot 无法启动，测试使用由相同本地层构建的任务专用 flattened 镜像；这不等同于正式发布镜像。宿主 Node 24.10.0，CI 配置 Node 22.12.0。

## 存量与兼容退出

- `scripts/audit-qualification-state.ts --dry-run` 只读导出必需缺失、日期/快照不完整、时区冲突、旧待审基准、重复 ACTIVE、新旧关联及重复材料关系的标识和原因；不输出材料内容或签名 URL，不修改记录。
- 已接入 PostgreSQL CI 与 full 候选 E2E 报告。候选夹具报告明确标注 `isolated_candidate_fixtures`。
- `scripts/reconcile-member-architecture.ts` 是严格零问题退出门禁；`RELEASE_REMOVE_MEMBER_COMPATIBILITY=1` 时 full 验收执行该门禁。旧 Cookie、旧 API 和实际 legacy fallback 有固定标签观测事件，核查程序不计入真实使用量。
- 兼容删除须另行满足生产对账、观察期、写入切换及回退证据，参见 [迁移退出门禁](qualification-migration-gates.md)。本次保留 Person/Pilot 兼容关系。
- **生产存量数量未知，未访问生产数据库。** 不完整数据应按正常有审计的修订/提交流程处理，不能自动补造日期或长期有效依据。

## 发布边界

本次未生成签名标签或不可变候选镜像，未执行正式候选的 full 发布验收（含 S3 灾备、供应链及签名产物门禁），未发布生产环境。现有 final 必须 full、full 才可 publish 的限制保留。

## 最终回归补充

- 真实业务 HTTP：Chromium 8 项、WebKit 5 项、Firefox 5 项通过；三个只在 Chromium 执行的服务端场景在其余浏览器按原配置跳过。另有两单位材料隔离真实 HTTP 测试 1 项通过，测试会话使用数据库随机夹具，未复测登录。
- Mock 界面：三浏览器首轮 351 项通过、3 项旧状态文案断言失败、3 项生产包专用测试跳过；断言改为“缺少资质”后，三浏览器目标复测全部通过。最终覆盖 354 项界面用例，无未解决失败项。
- 追加迁移问题经过独立审查后修正；17 项身份/锁单测、5 项真实 PG 回归通过，随后 Firefox 的完整数据准备成功。
- 最终应用 typecheck、脚本 typecheck、lint 及运行依赖一致性检查通过。
- 最终 Next 生产构建及全仓 Prettier 检查通过；生产 standalone 包在 Chromium、WebKit、Firefox 的健康检查与 RE2 资源冒烟测试共 3 项通过。证据分别为 `/tmp/crewqual-repair-build-complete.log`、`/tmp/crewqual-repair-format-complete.log`、`/tmp/crewqual-repair-standalone-smoke.log`。
- 隔离夹具只读核查成功，导出 39 个问题条目（34 必需缺失、5 时区归属问题）；这不是生产影响数量，也不是受影响人员数。未自动修改这些数据以清零。
- 临时 PostgreSQL 与 MinIO 容器已核对名称、镜像及 tmpfs 后移除，未触及持久卷。

本地证据：`/tmp/crewqual-repair-unit-complete.log`、`/tmp/crewqual-repair-pg-complete.log`、`/tmp/crewqual-repair-remote-final-2.log`（Chromium 原有业务 8 项通过）、`/tmp/crewqual-repair-remote-webkit.log`、`/tmp/crewqual-repair-remote-firefox-final.log`、`/tmp/crewqual-scope-run.log`、`/tmp/crewqual-repair-browser-mock.log`、`/tmp/crewqual-repair-browser-mock-retest.log`、`/tmp/crewqual-repair-qualification-data-audit.json`、`/tmp/crewqual-repair-environment-evidence.json`。失败后修正的首轮日志保留，不将其伪装成单次全绿。
