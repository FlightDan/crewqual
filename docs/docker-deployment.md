# CrewQual 单机 Docker Compose 部署

## 适用范围

一键安装适合单台 x86_64 或 arm64 Linux 服务器上的试点、内网或中小规模部署。生产清单包含 Web、共享 Runtime（Worker、迁移、Bootstrap 和运维命令）、PostgreSQL、私有 MinIO 与 Caddy TLS 入口。

多机高可用、数据库主从、动态扩缩容或滚动发布应使用托管数据库/对象存储和 Kubernetes，不应继续放大单机 Compose。

## 前置条件

- Docker Engine 24+ 与 Docker Compose v2.24+；
- 至少 4 vCPU、8 GiB 内存和 50 GiB 磁盘；
- TLS 模式：业务域名的 A 记录已指向服务器，防火墙开放 80 和应用访问端口；
- 局域网模式：选择的私网地址可被测试设备访问，公网端口不需要开放；
- 两种模式都不应开放 3000、5432、9000、9001；
- GitHub 仓库、正式 Release 以及 `ghcr.io/flightdan/crewqual-web`、`ghcr.io/flightdan/crewqual-runtime` 对应版本镜像为公开状态。

安装器不会安装 Docker、修改 DNS/防火墙、挂载 Docker Socket 或删除数据卷。

## 一键安装

```sh
export CREWQUAL_UPDATER_TRUSTED_PUBLIC_KEY='<发布方提供的 Base64 Ed25519 公钥>'
curl -fsSL https://raw.githubusercontent.com/FlightDan/crewqual/main/install.sh | sudo -E bash
```

首次安装会从 `/dev/tty` 选择局域网或 TLS 模式，并选择应用端口。TLS 模式才询问公网域名和 TLS 通知邮箱。在 `/opt/crewqual` 生成权限为 `0600` 的 `.env`，自动创建数据库、MinIO、会话和设置加密密钥，然后启动固定版本的 Web 与 Runtime 镜像。安装完成时会在终端只显示一次 8 位首次配置授权码；访问 `/setup` 必须先输入该码，避免公网 TLS 部署在管理员完成初始化前被抢先接管。要启用受签名保护的系统更新，必须额外提供发布方的 Base64 Ed25519 公钥；安装器会先验签清单、部署文件和后续域名配置脚本，验签失败即停止。

TLS 邮箱仅用于 ACME/Let's Encrypt 证书续期、到期或异常通知，不是应用登录邮箱，也不需要邮箱密码。

部署完成后访问：

```text
https://你的域名/setup
```

局域网模式访问安装器输出的 `http://私网地址:端口/setup`。后续切换到正式域名/TLS：

```sh
sudo /opt/crewqual/configure-domain.sh \
  --domain crewqual.example.com --tls-email ops@example.com --port 443
```

该脚本会执行配置校验、Caddy 证书和健康检查；任何失败都会回滚到原局域网配置。自定义 TLS 端口时，公网 TCP 80 仍必须转发给 Caddy，因为 ACME HTTP-01 验证使用标准 80 端口。

欢迎页负责创建超级管理员、安装职位模板、选择证照对象存储、配置备份与通知。证照存储可以继续使用安装器提供的内置私有 MinIO，也可以切换到外部 HTTPS S3；切换前会执行临时对象的写入、读取和删除测试。短信可在欢迎页稍后配置，不会阻塞首次启动。

### 固定版本

```sh
export CREWQUAL_UPDATER_TRUSTED_PUBLIC_KEY='<发布方提供的 Base64 Ed25519 公钥>'
curl -fsSL https://raw.githubusercontent.com/FlightDan/crewqual/main/install.sh \
  | sudo -E bash -s -- --version v1.0.0
```

### 无人值守首次安装

```sh
export CREWQUAL_UPDATER_TRUSTED_PUBLIC_KEY='<发布方提供的 Base64 Ed25519 公钥>'
curl -fsSL https://raw.githubusercontent.com/FlightDan/crewqual/main/install.sh \
  | sudo -E bash -s -- --domain crewqual.example.com \
    --tls-email ops@example.com --non-interactive
```

### 离线复用本机镜像

```sh
export CREWQUAL_UPDATER_TRUSTED_PUBLIC_KEY='<发布方提供的 Base64 Ed25519 公钥>'
curl -fsSL https://raw.githubusercontent.com/FlightDan/crewqual/main/install.sh \
  | sudo -E bash -s -- --version v1.0.0 --no-pull
```

`--no-pull` 仍需从对应 Git tag 下载 Compose 与 Caddy 配置，因此不代表完全离线安装。

## 安装目录与数据

安装器管理以下文件：

- `/opt/crewqual/compose.yaml`：当前版本生产编排；
- `/opt/crewqual/Caddyfile`：HTTPS 入口；
- `/opt/crewqual/.env`：部署版本、域名和密钥，权限为 `0600`。

持久数据位于 Docker 命名卷：PostgreSQL、MinIO、Caddy、Worker 本地备份各自独立。重复运行安装器只更新版本字段和受管理的 Compose/Caddy 文件，不覆盖已有域名或密钥。

不要执行：

```sh
docker compose down -v
```

该命令会删除 PostgreSQL、MinIO、Caddy 和本地备份卷，数据通常无法从主机恢复。

## 日常运维

```sh
cd /opt/crewqual
sudo docker compose ps -a
sudo docker compose logs -f --tail=200 web worker caddy
curl --fail --silent --show-error https://你的域名/api/health
```

`migrate`、`bootstrap` 和 `minio-init` 的正常状态是 `Exited (0)`；Web 与 Worker 应为 `healthy`，Caddy、PostgreSQL 和 MinIO 应保持运行。

安全重启应用：

```sh
cd /opt/crewqual
sudo docker compose restart web worker caddy
```

停止服务但保留数据卷：

```sh
cd /opt/crewqual
sudo docker compose down
```

内置 MinIO 的 `minio-data` 卷与 Worker 的 `backup-data` 卷都在同一台主机，不能替代异机备份。应在欢迎页或系统设置中配置 S3/WebDAV/SMB 等异机目标，并定期执行恢复演练。

## 升级与版本切换

升级前先备份 PostgreSQL 和当前证照对象存储，再重复执行安装命令：

```sh
export CREWQUAL_UPDATER_TRUSTED_PUBLIC_KEY='<发布方提供的 Base64 Ed25519 公钥>'
curl -fsSL https://raw.githubusercontent.com/FlightDan/crewqual/main/install.sh | sudo -E bash
```

安装器解析最新正式 Release，下载该 Git tag 中的部署清单，拉取对应的 Web/Runtime 镜像，运行幂等迁移与 Bootstrap，然后等待服务健康。

也可以指定版本：

```sh
export CREWQUAL_UPDATER_TRUSTED_PUBLIC_KEY='<发布方提供的 Base64 Ed25519 公钥>'
curl -fsSL https://raw.githubusercontent.com/FlightDan/crewqual/main/install.sh \
  | sudo -E bash -s -- --version v1.0.0
```

指定旧版本只切换镜像和部署清单，不会向下回滚数据库迁移。若新版本迁移不向后兼容，必须使用升级前备份恢复 PostgreSQL 和对象存储到隔离实例验证，不能直接在生产数据库上降级。

## 源码构建与开发

一键安装使用公开 GHCR 镜像，不需要 Git checkout。本地开发或需要自行构建时才使用源码 Compose：

```sh
cp .env.example .env
docker compose --profile dev up -d postgres minio minio-init
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm db:seed
pnpm dev
pnpm dev:worker
```

源码 Compose、开发 seed 和开发 MinIO 不属于生产一键安装流程。
