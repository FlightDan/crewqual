# 安装与首次设置

[文档目录](README.md) · [English](../en/installation.md)

## 安装发布版

安装器面向 Linux amd64/arm64，以及 Windows x86_64 上使用 Docker Desktop Linux containers 的 WSL2 Ubuntu。普通 Linux 部署需要 systemd，以安装宿主机更新服务。macOS 支持尚未完成。

在目标主机运行：

```bash
curl -fsSL https://raw.githubusercontent.com/FlightDan/crewqual/main/install.sh | sudo bash
```

脚本默认选取最新 stable GitHub Release，验证发布清单签名和文件校验和，然后使用按摘要固定的 GHCR 镜像。默认安装目录为 `/opt/crewqual`。普通 Linux 缺少 Docker 时可传入 `--install-docker`；该选项会安装 Docker Engine 和 Compose v2。

安装过程中选择语言、网络模式和端口。终端支持时会显示全屏界面；`--plain` 可切换为纯文本。全屏界面的原始安装日志位于 `/opt/crewqual/logs/install-*.log`，仅 root 可读。

以下示例使用局域网地址；请换成主机实际私网 IPv4：

```bash
curl -fsSL https://raw.githubusercontent.com/FlightDan/crewqual/main/install.sh \
  | sudo bash -s -- --install-docker --non-interactive \
      --network-mode lan --lan-address 192.168.1.20 --port 8080
```

安装指定 Release 时传入 `--version v1.0.1`，版本号应替换为所需的已发布标签。`--channel rc` 选择 RC 渠道。

## Windows 与 WSL2

1. 在 Windows 安装并启动 Docker Desktop，使用 Linux containers。
2. 在 Docker Desktop 的 `Settings > Resources > WSL Integration` 中启用当前 Ubuntu。
3. 在 Ubuntu 终端执行以下检查，然后运行上面的安装命令。不要传入 `--install-docker`。

```bash
docker info
docker compose version
```

WSL2 默认使用手动升级模式和 `http://localhost:8080`，可从 Windows 浏览器访问。局域网设备需要访问时，使用 `--network-mode lan --lan-address` 指定 **Windows 网卡的私网 IPv4**，并在 Windows 防火墙中允许所选 TCP 端口入站。不要使用 WSL2 内部的 NAT 地址。

## 网络与 TLS

| 模式   | 用途                  | 首次非交互安装必需参数              |
| ------ | --------------------- | ----------------------------------- |
| `lan`  | localhost 或私网 HTTP | `--lan-address`                     |
| `http` | 临时公网 HTTP         | `--public-address`                  |
| `tls`  | HTTPS                 | `--domain`，以及 TLS 邮箱或自有证书 |

公网 HTTP 会明文传输授权码、密码、TOTP 和业务数据。临时使用时限制防火墙来源；切换 HTTPS 后更换管理员密码和 TOTP、撤销活跃会话，并轮换 HTTP 阶段录入的 API/Webhook 密钥。

自动证书示例：先把域名 DNS 指向主机，并允许证书验证使用的 TCP 80 和应用 TCP 443 入站。

```bash
curl -fsSL https://raw.githubusercontent.com/FlightDan/crewqual/main/install.sh \
  | sudo bash -s -- --network-mode tls \
      --domain crewqual.example.com --tls-email ops@example.com --port 443
```

TLS 邮箱用于证书通知，不是管理员登录账号。已有 PEM 证书时，将 `--tls-email` 换为 `--tls-cert /path/fullchain.pem --tls-key /path/privkey.pem`。私钥必须未加密；脚本会检查有效期、域名和密钥匹配关系。证书复制到安装目录的 `tls/`，续期后需要重新传入新文件。

已安装部署可通过专用脚本切换到 HTTPS：

```bash
sudo /opt/crewqual/configure-domain.sh \
  --domain crewqual.example.com --tls-email ops@example.com --port 443
```

使用自有证书时，同样替换邮箱参数。普通升级不会切换现有网络模式或端口。

## 首次设置

保存安装完成时显示的 **8 位一次性授权码**。授权码不会写入安装日志。在安装器给出的 `/setup` 地址输入授权码，然后依次完成环境检查、对象存储、超级管理员、职位模板、备份、通知和最终确认。

安装器提供内置 MinIO，也可连接外部 S3 兼容存储。超级管理员需要配置 TOTP；妥善保存仅展示一次的密钥信息。短信可以暂时禁用，但配置真实短信 webhook 前不会签发成员访问链接。

完成后检查服务：

```bash
sudo docker compose --project-directory /opt/crewqual \
  --env-file /opt/crewqual/.env -f /opt/crewqual/compose.yaml ps
```

`migrate`、`bootstrap` 和 `minio-init` 是一次性任务，成功退出属于正常情况；`web`、`worker` 等常驻服务应保持运行。故障处理见[运维、备份与恢复](operations.md)。

## 从源码部署的区别

仓库的 `docker-compose.yml` 从本地源码构建，要求外部 S3；安装器使用 `docker-compose.install.yml` 的发布资产，并将其保存为安装目录内的 `compose.yaml`，包含内置 MinIO。两套环境配置不能直接互换。

`scripts/init-docker-env.sh` 仅生成部分源码环境配置。目前它没有生成源码 Compose 所需的 `NETWORK_ACCESS_SECRET` 等网络配置，不应将“运行脚本后直接启动 Compose”视为完整部署流程。需要自行部署源码时，逐项核对[配置说明](configuration.md)、实际 Compose 文件和 `.env.example`，并完成域名、首次授权及外部服务配置。

依据：[安装器](../../install.sh)、[发布 Compose](../../docker-compose.install.yml)、[域名配置脚本](../../scripts/configure-domain.sh)、[设置向导文案](../../src/lib/setup-i18n.ts)。
