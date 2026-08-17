# CrewQual 单机 Docker Compose 部署

## 适用范围

Docker Compose 适合单台 Linux 服务器上的试点、内网或中小规模部署。它把 Web、Worker、PostgreSQL、数据库迁移、首次初始化和 Caddy TLS 入口统一编排；PostgreSQL、Worker 和备份目录不暴露公网。

以下能力仍应使用外部服务，不建议塞进同一台业务主机：

- HTTPS S3 兼容对象存储（证照图片）；
- 真实 SMS webhook（Pilot 登录链接）；
- 可选 Qwen/VLM HTTP API；
- 异机或异区域备份目标。

如果要求多机高可用、滚动发布、数据库主从或动态扩缩容，应改用托管数据库/对象存储加 Kubernetes，而不是继续放大单机 Compose。

## 1. 服务器与域名

准备一台 x86_64 或 arm64 Linux 服务器，建议至少 4 vCPU、8 GiB 内存、50 GiB 系统盘，并安装 Docker Engine 24+ 与 Docker Compose v2.24+。将业务域名的 A/AAAA 记录指向服务器，防火墙只开放 22、80、443；不要开放 3000、5432、9000、9001。

发布包应是固定 Git tag 的源码包，或由 CI 产生的固定版本镜像，不要直接部署开发工作区。

## 2. 生成生产配置

在项目目录执行交互式初始化：

```sh
chmod +x scripts/init-docker-env.sh
./scripts/init-docker-env.sh
```

脚本不会覆盖已有 `.env`，会生成 URL-safe 的数据库口令、会话密钥、设置加密密钥、初始管理员密码和 TOTP secret，并以 `0600` 权限保存配置。它默认关闭 VLM；确认 Qwen 服务可达后再设置 `VLM_ADAPTER=qwen`。

如需手工配置，复制 `.env.example` 为 `.env`。必须满足：

- `APP_ORIGIN=https://域名`，`APP_DOMAIN` 只填域名；
- `POSTGRES_PASSWORD` 与两个 PostgreSQL URL 中的密码相同，建议只用十六进制，避免 URL 转义错误；
- `SESSION_SECRET` 至少 48 字符，`SETTINGS_ENCRYPTION_KEY` 至少 32 字符且二者不同；
- S3 endpoint 使用 HTTPS，桶为私有桶；
- `SMS_ADAPTER=webhook` 且 webhook 为真实可达的 HTTPS 地址；
- 初始管理员密码至少 12 字符，TOTP secret 为至少 16 位 Base32。

不要把 `.env` 发送到聊天工具或提交到 Git。

## 3. 首次启动与验收

```sh
docker compose config --quiet
docker compose build --pull
docker compose up -d
docker compose ps -a
docker compose logs --tail=100 migrate bootstrap web worker caddy
curl --fail --silent --show-error https://你的域名/api/health
```

启动顺序为 `postgres → migrate → bootstrap → web/worker → caddy`。`migrate` 和 `bootstrap` 正常状态是 `Exited (0)`；Web 和 Worker 应为 `healthy`。健康接口应返回 `status=ok`，同时报告 database、storage、queue、worker 为 `ok`。

`bootstrap` 会同步固定角色和权限；仅当数据库中没有启用的超级管理员时，才使用 `.env` 创建初始账号。它不会写入演示飞行员或演示资质数据，也不会在以后重置现有管理员密码。

使用密码和 TOTP 登录一次后：

1. 把初始账号资料存入密码管理器；
2. 从 `.env` 删除 `INITIAL_ADMIN_PASSWORD` 和 `INITIAL_ADMIN_TOTP_SECRET` 的值；
3. 执行 `docker compose rm -f bootstrap`，清除保留初始 secret 的已退出容器；
4. 在管理后台创建实名管理员，并验证 SMS、对象存储和备份目标。

## 4. 日常运维

查看状态和日志：

```sh
docker compose ps -a
docker compose logs -f --tail=200 web worker caddy
curl --fail https://你的域名/api/health
```

重启应用不会删除数据：

```sh
docker compose restart web worker caddy
```

停止但保留卷：

```sh
docker compose down
```

不要执行 `docker compose down -v`，该命令会删除 PostgreSQL、Caddy、MinIO 和本地备份卷。

Worker 的 `/backups` 映射到 `backup-data` 卷。应用内本地备份目标可填写 endpoint `/backups`；生产仍建议再配置异机 S3/WebDAV/SMB 目标，并实际做恢复演练。

## 5. 升级与回滚

升级前先完成数据库与对象存储备份，然后在维护窗口执行：

```sh
docker compose build --pull
docker compose up -d
docker compose ps -a
curl --fail https://你的域名/api/health
```

新镜像会重新运行幂等迁移和初始化任务。应用镜像应按发布号保存，回滚时切回上一发布包/镜像并重新启动；数据库迁移不自动向下回滚。若新迁移不向后兼容，必须按该版本的发布说明从升级前备份恢复到隔离实例，验证后再切换，不能直接在生产库试错。

## 6. 本地开发依赖

本地开发可只启动 PostgreSQL 和可选 MinIO，不要把开发 MinIO 当作生产对象存储：

```sh
docker compose --profile dev up -d postgres minio minio-init
pnpm db:migrate
pnpm db:seed
pnpm dev
pnpm dev:worker
```

开发 seed 包含演示数据，因此不属于生产部署流程。
