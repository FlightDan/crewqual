# 运维、备份与恢复

[文档目录](README.md) · [English](../en/operations.md)

以下命令针对安装器生成的默认部署 `/opt/crewqual`。自定义安装目录需要替换路径；源码部署使用仓库的 Compose 文件。

## 检查服务

```bash
sudo docker compose --project-directory /opt/crewqual \
  --env-file /opt/crewqual/.env -f /opt/crewqual/compose.yaml ps -a
sudo docker compose --project-directory /opt/crewqual \
  --env-file /opt/crewqual/.env -f /opt/crewqual/compose.yaml \
  logs --tail=100 web worker caddy
```

初始化失败时，检查 `migrate`、`bootstrap`、`minio-init` 的日志。一次性任务退出码为 0 属于正常结果。Web 就绪检查使用独立探针密钥；不要把该密钥放进公开监控 URL。

普通 Linux 的宿主机更新器可通过以下命令检查；WSL2 手动模式不使用这些 systemd 单元：

```bash
sudo systemctl status crewqual-updater.service crewqual-updater.socket
sudo journalctl -u crewqual-updater.service -n 100 --no-pager
sudo systemctl status crewqual-caddy-recovery.service
sudo journalctl -u crewqual-caddy-recovery.service -n 100 --no-pager
```

`crewqual-caddy-recovery.service` 会等待配置的主机地址出现，核对 Caddy
实际发布的 IP 和端口，并使用部署探针密钥检查就绪接口。发布缺失时只重建
Caddy，不会把 `APP_BIND` 放宽为 `0.0.0.0`。单元失败会保留部署配置，并在
journal 中记录原因。排查主机网络问题时，可以先暂停自动恢复，确认地址可用
后再启用并启动：

安装器和更新器也共用 `/run/crewqual-updater/deployment.lock`；有升级或恢复
任务运行时，安装器会等待而不会并行替换受管理文件。

```bash
sudo systemctl disable --now crewqual-caddy-recovery.service
# 排查主机地址和 Caddy 日志
sudo systemctl enable --now crewqual-caddy-recovery.service
```

排查时先核对配置错误、数据库连接、对象存储和出站允许列表。对外分享日志前移除凭据和人员信息。

## 升级

先确认近期数据库与图库备份成功，并保存 `.env`、证书和更新器配置。普通 Linux 的设置中心可检查并安装更新，具体操作取决于账号权限和宿主机更新器状态。WSL2 使用手动升级。

重新运行安装命令可升级现有部署：

```bash
curl -fsSL https://raw.githubusercontent.com/FlightDan/crewqual/main/install.sh | sudo bash
```

需要指定版本或渠道时，使用[安装参数](installation.md)。安装器保留现有 `.env` 中的密钥及 Docker volumes，更新受管理的 Compose/Caddy 文件和镜像版本。它不会在升级时切换网络模式或端口。不要用 `docker compose down -v` 作为升级步骤，该命令会删除卷。

宿主机更新器在升级前生成加密数据库备份，并在迁移或健康检查失败时尝试恢复或回退；自动恢复也可能失败，须查看任务错误。更新器数据库备份不包含图库文件，不能代替业务备份。

## 正式发布验收配置

正式版必须使用 `acceptance_scope=full`。full 验收运行静态检查、容器 bootstrap、供应链验证、真实 S3 灾备和隔离恢复，以及发布后的全新安装、升级和回滚测试，通过后才能发布并提升为 latest。RC 可以使用 `acceptance_scope=local`；local 模式使用临时 MinIO 运行静态、bootstrap、供应链及发布后安装/升级/回滚检查，不要求 S3、AWS 或外部灾备配置。

`acceptance_scope=full` 也可供需要完整基础设施检查的 RC 使用。如果使用 full，S3、AWS 和灾备配置只存放在 GitHub Environment `release-sandbox`，不要依赖仓库级同名 secrets。正式发布应通过 `crewqual-release-publish` 发起，不要在 Actions 页面直接 dispatch；GitHub 的 workflow secret context 会合并环境和仓库作用域，只有发布器的环境清单检查能够阻止误用仓库级同名 secret。发布器会在签署或推送 tag 之前检查这些 secret 名称；Actions workflow 随后在构建、推送镜像之前聚合校验值、OpenPGP 公钥与签名者对应关系和隔离约束，且不会输出 secret 值。

只有选择 full 时，`release-sandbox` 才需要以下基础设施 secrets：

| 类别       | Secret 名称                                                                                 |
| ---------- | ------------------------------------------------------------------------------------------- |
| S3 连接    | `AWS_REGION`、`AWS_ACCESS_KEY_ID`、`AWS_SECRET_ACCESS_KEY`、`S3_ENDPOINT`、`S3_KMS_KEY_ARN` |
| 隔离桶     | `EVIDENCE_S3_BUCKET`、`BACKUP_S3_BUCKET`、`RESTORE_S3_BUCKET`、`S3_FORBIDDEN_PREFIX`        |
| 恢复证据   | `BACKUP_RECOVERY_SET_ID`、`BACKUP_DATABASE_RUN_ID`、`BACKUP_GALLERY_RUN_ID`                 |
| 篡改验证   | `BACKUP_TAMPER_ARTIFACT_KEYS`、`BACKUP_TAMPER_BLOB_SHA256`                                  |
| 隔离数据库 | `DATABASE_URL`、`RESTORE_DATABASE_URL`                                                      |

其中 `S3_ENDPOINT` 必须是 HTTPS；三个桶必须彼此不同；在线与恢复数据库 URL 必须不同；`BACKUP_TAMPER_ARTIFACT_KEYS` 必须包含非空的 `database`、`gallery`、`blob` 字段；blob checksum 必须是 64 位十六进制 SHA-256。

使用 `gh secret set NAME --repo FlightDan/crewqual --env release-sandbox` 交互写入单项 secret。写入后可只核对名称和更新时间，不显示值：

```bash
gh secret list --repo FlightDan/crewqual --env release-sandbox
```

`crewqual-release-publish sync-secrets` 只同步 tag 与 manifest 签名材料及签名者白名单，不创建或更新上述可选 full 基础设施配置。
final 还要求仓库级 `LICENSE_APPROVALS_JSON` 为包含 `licenses` 字符串数组的有效 JSON；它同样不会由 `sync-secrets` 创建。

## 备份计划

在首次向导或系统设置的“备份与恢复”中配置备份目标和计划。数据库使用全量备份；图库支持全量及增量备份。分别检查两类任务的成功记录、保留数量和保留天数，并实际演练恢复。

本地备份使用容器内 `/backups`，发布部署将它挂载到 `backup-data` 卷。它与原始数据在同一主机上；需要将备份复制到异机或使用远程目标，才能应对主机丢失。启用加密时保存恢复所需的凭据及密钥。

应纳入恢复准备的内容：

| 内容             | 默认位置或用途                                                                      |
| ---------------- | ----------------------------------------------------------------------------------- |
| 数据库           | `postgres-data` 卷；包含业务数据、设置及备份运行记录。                              |
| 证照文件         | 内置存储的 `minio-data` 卷，或外部 S3 私有桶。                                      |
| 业务备份         | `backup-data` 卷或配置的远程目标。                                                  |
| 部署配置与证书   | `/opt/crewqual/.env`、`compose.yaml`、`Caddyfile`、`tls/`。                         |
| 更新器配置与备份 | 普通 Linux 的 `/etc/crewqual-updater/config.json` 与 `/var/lib/crewqual-updater/`。 |

这些位置可能包含密钥。限制备份访问权限，保留 `SETTINGS_ENCRYPTION_KEY`；丢失它会影响已有敏感设置及备份凭据的解密。

## 离线恢复

当前恢复脚本按成功的备份运行 ID（`runId`）工作，需要仍可读取的源数据库及其备份记录、设置密钥和备份文件。它不是只给一个归档文件就能在空主机完成恢复的独立工具。源数据库完全丢失时，需要先在隔离环境恢复可读取的控制数据，再使用此流程。

恢复目标必须是**全新隔离数据库与新的空 S3 桶**。目标数据库不能实际指向源数据库；目标桶不能等于源图库桶或 S3 备份桶。脚本使用源存储的 endpoint 和凭据访问目标桶，因此需要提前创建桶并授权这些凭据。数据库恢复与图库恢复都要求提供两个目标参数。

在隔离维护环境执行，保持源部署的配置可读。以下模板通过一次性 worker 容器取得运行时依赖与 `/backups` 挂载；替换备份 ID、连接信息和目标桶名。连接地址必须可从该容器访问：

```bash
read -r -s -p 'Restore database URL: ' RESTORE_DATABASE_URL
printf '\n'
export RESTORE_DATABASE_URL
export RESTORE_S3_BUCKET='crewqual-recovery'
sudo --preserve-env=RESTORE_DATABASE_URL,RESTORE_S3_BUCKET \
  docker compose --project-directory /opt/crewqual \
  --env-file /opt/crewqual/.env -f /opt/crewqual/compose.yaml \
  run --rm --no-deps -e RESTORE_DATABASE_URL -e RESTORE_S3_BUCKET \
  worker node --import tsx scripts/restore-backup.ts 'BACKUP_RUN_ID' '恢复'
unset RESTORE_DATABASE_URL RESTORE_S3_BUCKET
```

`恢复` 是脚本要求的精确确认参数，英文环境也使用该值。目标数据库账号需要足够的恢复权限，源服务仍需可供脚本读取元数据。恢复命令保留归档中的所有者和授权信息；在另一 PostgreSQL 实例恢复前，先准备归档引用的数据库角色，并确认恢复账号能还原相应所有权和权限。对数据库和图库分别使用对应的成功运行 ID；图库增量恢复依赖其全量基线和所需增量链，不能只保留最后一个增量文件。

脚本检查归档校验和及恢复目标隔离性。数据库通过 `pg_restore` 恢复；图库恢复会验证归档与对象集合。恢复完成后，在隔离部署中核对成员、资质记录、证照图片和登录，再决定切换业务流量。脚本不会替你修改线上 `.env` 或切换域名。

依据：[恢复入口](../../scripts/restore-backup.ts)、[备份与恢复实现](../../src/server/backup-runner.ts)、[备份设置服务](../../src/server/backup-service.ts)、[宿主机更新器](../../updater/main.go)、[发布 Compose](../../docker-compose.install.yml)。
