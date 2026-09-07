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
