# 配置说明

[文档目录](README.md) · [English](../en/configuration.md)

安装器将部署配置写入 `/opt/crewqual/.env`；界面中的系统设置保存在数据库中，敏感设置使用 `SETTINGS_ENCRYPTION_KEY` 加密。先区分宿主机部署参数与管理员可修改的业务设置。修改容器环境后需要重新创建相关服务，单纯重启不会读取更新后的 Compose 环境。

## 网络与密钥

| 配置项                                          | 含义与约束                                                                                         |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `SERVICE_MODE`                                  | 生产环境使用 `remote`，禁止 `mock`。                                                               |
| `APP_ORIGIN`                                    | 浏览器使用的完整 origin，包含协议及非默认端口，不含路径或末尾斜杠。必须与网络模式一致。            |
| `DEPLOYMENT_NETWORK_MODE`                       | `lan`、`http` 或 `tls`。LAN 模式的 HTTP origin 必须使用 localhost、127.0.0.1 或受支持的私网 IPv4。 |
| `APP_PORT`、`APP_BIND`                          | 应用访问端口与宿主机绑定地址。通过安装器或域名脚本配置。                                           |
| `APP_DOMAIN`、`TLS_EMAIL`、`CADDY_SITE_ADDRESS` | Caddy 域名及证书设置。自有证书还使用生成的 Caddy TLS 配置和 `tls/` 文件。                          |
| `NETWORK_ACCESS_SECRET`                         | 代理与应用间使用的网络访问密钥，由安装器生成。                                                     |
| `SETUP_AUTH_CODE_HASH`                          | 一次性首次设置授权码的 SHA-256 哈希，不是明文授权码。                                              |
| `SESSION_SECRET`                                | `remote` 模式必须显式设置；生产环境至少 48 个字符。                                                |
| `SETTINGS_ENCRYPTION_KEY`                       | 生产环境至少 32 个字符，必须与 `SESSION_SECRET` 不同。保留原值以解密已有敏感设置。                 |
| `READINESS_PROBE_SECRET`                        | 生产环境至少 32 个字符，供容器内部就绪探针使用。                                                   |
| `TRUSTED_PROXY_HOPS`                            | 生产环境必须显式配置；随附 Compose 在 Caddy 后默认使用 `1`。改变代理层数时重新核对。               |
| `PILOT_SESSION_TTL_MINUTES`                     | 成员会话时长，默认 60 分钟。                                                                       |
| `ADMIN_SESSION_TTL_HOURS`                       | 管理员会话时长，默认 8 小时。                                                                      |

安装器负责生成密钥。手工准备环境时，可分别运行 `openssl rand -hex 48` 和 `openssl rand -hex 32` 生成独立值。不要把 `.env`、授权码或 TOTP 密钥提交到仓库。

## 数据库与存储

`POSTGRES_PASSWORD` 属于数据库所有者/迁移角色，`POSTGRES_APP_PASSWORD` 属于运行时角色 `crewqual_app`。`DATABASE_URL` 使用运行时角色，`DIRECT_URL` 使用迁移角色。随附 Compose 仅向迁移服务提供所有者连接信息；不要把运行时连接改成所有者账号。

| 配置项                                     | 说明                                                                                   |
| ------------------------------------------ | -------------------------------------------------------------------------------------- |
| `STORAGE_MODE`                             | 发布安装默认 `builtin`；源码 Compose 默认 `external`。                                 |
| `S3_ENDPOINT`                              | 生产环境要求 HTTPS；唯一内置 HTTP 例外为 `builtin` 模式的 `http://minio:9000`。        |
| `S3_BUCKET`、`S3_REGION`                   | 私有对象桶与区域，默认桶名 `crewqual-private`、区域 `us-east-1`。                      |
| `S3_ACCESS_KEY_ID`、`S3_SECRET_ACCESS_KEY` | 存储凭据；生产 secret 至少 16 个字符，不能使用内置示例值。                             |
| `S3_FORCE_PATH_STYLE`                      | `true` 或 `false`，按存储服务要求设置；发布内置 MinIO 默认 `true`。                    |
| `S3_SSE_KMS_KEY_ID`                        | 可选 KMS 密钥标识。                                                                    |
| `OUTBOUND_ALLOWED_HOSTS`                   | 逗号分隔的主机或 `host:port`；外部 S3 与远程备份主机必须明确列入，即使解析为公网地址。 |
| `OUTBOUND_ALLOWED_CIDRS`                   | 额外允许访问的私网 CIDR。                                                              |

出站允许列表由部署方控制，应用管理员不能在设置界面扩大范围。修改外部存储或备份目标前，先核对目标主机及解析后的网络地址是否符合部署边界。

## 通知与识别

| 功能     | 配置                                                                                                                                   |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 短信     | `SMS_ADAPTER=disabled` 或 `webhook`；启用 webhook 时提供 `SMS_WEBHOOK_URL`，按网关要求填写 `SMS_WEBHOOK_AUTH_TOKEN`。`fake` 用于测试。 |
| 短信回执 | 使用独立的 `SMS_RECEIPT_WEBHOOK_SECRET`。                                                                                              |
| 飞书     | `FEISHU_ADAPTER=disabled` 或 `webhook`，配合 `FEISHU_WEBHOOK_URL` 和可选认证 token。                                                   |
| 图像识别 | `VLM_ADAPTER=disabled` 或 `qwen`，配合 `QWEN_BASE_URL`、`QWEN_MODEL`。                                                                 |

默认 Qwen 模型名为 `Qwen3.7-35B`。填写模型地址不等于已启动模型服务；需要另行部署可用服务，并满足出站访问限制。

生产环境保持 `DEV_ENDPOINTS=false`。`CREWQUAL_ACCEPTANCE_EXTERNALS_DISABLED` 和 `ACCEPTANCE_ENVIRONMENT_ID` 属于隔离验收环境，不应用于线上部署。

## 初始化与更新器

`INITIAL_ADMIN_EMAIL`、`INITIAL_ADMIN_PASSWORD`、`INITIAL_ADMIN_TOTP_SECRET` 全部留空时，在 `/setup` 创建首个超级管理员。无人值守引导必须同时提供三项。组织、单位和职位模板的初始值以 `.env.example` 和 bootstrap 配置为准。

普通 Linux 的 `CREWQUAL_UPDATER_MODE=managed` 使用宿主机更新器；WSL2 使用 `manual`。镜像摘要、更新器共享密钥及备份密钥由安装器管理。不要将 `.env.example` 中的示例镜像摘要当作可运行版本。

配置变更前保存 `.env` 和相关证书副本。升级与恢复所需的持久化内容见[运维说明](operations.md)。

依据：[环境示例](../../.env.example)、[服务端配置校验](../../src/server/config.ts)、[发布 Compose](../../docker-compose.install.yml)、[源码 Compose](../../docker-compose.yml)。
