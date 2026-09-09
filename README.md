<div align="center">
  <h1>CrewQual</h1>
  <p><strong>自托管的人员资质与合规管理平台</strong></p>
  <p>把资质台账、到期预警、材料提交、AI 辅助核验、人工审核与升级计划放进同一个可追溯闭环。</p>
  <p>
    <img alt="License: AGPL-3.0-only" src="https://img.shields.io/badge/license-AGPL--3.0--only-2563eb.svg">
    <img alt="Self-hosted" src="https://img.shields.io/badge/deployment-self--hosted-0f766e.svg">
    <img alt="Docker Compose" src="https://img.shields.io/badge/Docker-Compose-2496ed.svg">
    <img alt="Chinese and English" src="https://img.shields.io/badge/i18n-中文%20%7C%20English-7c3aed.svg">
  </p>
  <p><kbd><strong>简体中文</strong></kbd> · <a href="./README.en.md"><kbd>English</kbd></a></p>
  <p><a href="#快速开始">Quick Start</a> · <a href="./wiki/README.md">Wiki</a> · <a href="./docs/zh-CN/README.md">技术文档</a> · <a href="#saas-与企业服务">SaaS 与企业服务</a></p>
</div>

<p align="center">
  <img src="./docs/images/readme/admin-dashboard.png" alt="CrewQual 管理员总览" width="50%">
</p>

> 截图不包含任何真实人员信息。

## 一套完整的资质管理闭环

CrewQual 是一款现代化可私有部署的人员资质与合规管理平台。

面向航空及其他需要持续管理证照、培训、有效期与晋级计划的组织。

它将人员资质、到期预警、材料提交、辅助校验、人工审核和升级计划整合到统一、可追踪、可审计的工作流中。

| 管理侧 | 成员侧 | 平台能力 |
| --- | --- | --- |
| 资质与岗位规则配置 | 移动端资质查询 | Docker Compose 自托管 |
| 到期预警与统一日历 | 凭证拍摄或上传 | PostgreSQL 与私有对象存储 |
| AI 辅助核验与人工审核 | 到期日识别与手动修正 | 权限控制、操作审计|
| 档案维护与升级计划 | 进度与临期提醒 | 健康检查、备份与恢复 |

## 文档与 Wiki

[Wiki](./wiki/README.md)介绍产品概念、成员操作、管理员操作和常见问题。[技术文档](./docs/zh-CN/README.md)说明安装、配置、升级、备份恢复、本地开发和架构。每个主题都有对应的中英文页面，可在页首切换语言。

## 产品界面

<p><strong>人工审核工作台</strong></p>

<p align="center">
  <img src="./docs/images/readme/qualification-review.png" alt="CrewQual 人工资质审核工作台" width="50%">
</p>

<p><sub>并排核对凭证、成员提交字段、AI 辅助结果与当前生效记录；最终决定始终由授权管理员作出。</sub></p>

<table>
  <tr>
    <td width="50%" valign="top">
      <strong>用户侧上传证照</strong><br><br>
      <p align="center"><img src="./docs/images/readme/member-credential-upload-mobile.png" alt="CrewQual 用户侧上传并复核证照" width="50%"></p>
      <br><sub>证照上传后自动识别日期，用户可复核、修正并提交更新；AI 不可用时也能继续手动填写。</sub>
    </td>
    <td width="50%" valign="top">
      <strong>管理员手机端维护资质</strong><br><br>
      <p align="center"><img src="./docs/images/readme/admin-qualification-maintenance-mobile.png" alt="CrewQual 管理员手机端维护成员资质" width="50%"></p>
      <br><sub>管理员可在手机端核对并修正当前生效记录，保存后立即更新资质并写入审计日志。</sub>
    </td>
  </tr>
</table>

## 为什么选择 CrewQual

- **围绕业务闭环设计**：覆盖到期提醒、成员提交、文档识别、人工复核、记录生效和结果通知。
- **人工决策优先**：AI/OCR 用于减少录入与核对成本，不会自动批准资质更新。
- **适配不同岗位与路径**：岗位、资质要求、有效期、提醒规则和升级节点都可以配置。
- **同时适合移动端和桌面端**：成员流程针对手机优化，管理端适合集中审核与风险处置。
- **数据由部署方控制**：业务数据存储在 PostgreSQL，凭证图像可放在私有 S3 兼容对象存储中。
- **可审计、可恢复**：关键操作保留审计记录，并提供异步任务、健康检查、备份与恢复能力。

## 与多维表格工具的区别

CrewQual 更适合将资质合规作为长期、关键业务进行系统化管理。

- 开箱即用的业务模型：内置人员、职位、资质、有效期、审核记录与晋级计划，无需从零设计复杂表格。
- 完整的资质闭环：覆盖材料提交、AI 辅助核验、人工审核、记录生效、到期预警和通知。
- 更严格的业务约束：资质状态、规则版本、证据归属与审核权限由系统统一执行，减少误改、漏配和规则不一致。
- 面向不同角色的专属体验：成员通过移动端完成查询与提交，管理员通过工作台进行审核和风险管理，而不是共同操作一张复杂表格。
- 业务级审计能力：不仅记录“谁修改了哪个字段”，还记录审核决定、规则依据、证据材料和完整状态变化。
- 独立部署与数据控制：支持私有化部署，可自主控制数据库、证照文件、备份策略和外部服务集成。
- 支持深度定制：可以根据组织的职位体系、资质规则、晋级路径和审批制度进行代码级定制。

## 快速开始

支持 Linux amd64/arm64 主机，以及 Windows x86_64 上使用 Docker Desktop Linux containers 的 WSL2 Ubuntu 环境。macOS 支持尚未完成。

```sh
curl -fsSL https://raw.githubusercontent.com/FlightDan/crewqual/main/install.sh | sudo bash
```
安装结束后，终端会一次性显示 8 位首次设置授权码；访问提示的 `/setup` 地址即可完成初始化。

在支持 UTF-8 和 ANSI 的交互终端中，安装器会自动进入全屏 CUI：使用 `↑`/`↓` 或数字选择，按 `Enter` 确认；安装期间顶部显示总进度，中间实时滚动 Docker、下载和数据库日志，按 `Ctrl+C` 可安全取消。安装完成或失败后，CUI 会恢复原终端并留下可复制的结果摘要。

无人值守、非 TTY、`TERM=dumb` 或小于 `64×20` 的终端会自动使用纯文本输出。也可以显式传入 `--plain` 关闭 CUI；设置 `NO_COLOR=1` 只关闭颜色、不关闭全屏界面。CUI 的完整原始日志以仅 root 可读的权限保存在 `/opt/crewqual/logs/install-*.log`，失败时会自动显示日志路径和最近输出。首次设置授权码不会写入该日志。

### Windows + WSL2

Docker Desktop 安装并运行在 Windows，CrewQual 安装脚本始终在 WSL2 Ubuntu 终端中运行：

1. 在 Docker Desktop 的 `Settings > Resources > WSL Integration` 中启用当前 Ubuntu。
2. 在 Ubuntu 中确认 `docker info` 和 `docker compose version` 均可正常执行。
3. 在 Ubuntu 中运行上面的 CrewQual 安装命令，不要传入 `--install-docker`。

WSL2 默认进入手动升级模式并仅绑定 `http://localhost:8080`，Windows 浏览器可直接访问。升级时在 Ubuntu 中重新运行同一条安装命令。需要手机等局域网设备访问时，传入 Windows 网卡的私网 IPv4，例如：

```sh
curl -fsSL https://raw.githubusercontent.com/FlightDan/crewqual/main/install.sh \
  | sudo bash -s -- --network-mode lan --lan-address 192.168.1.20
```

此时还需要在 Windows 防火墙中允许所选 TCP 端口入站。不要填写 WSL2 内部易变化的 `172.x` NAT 地址。如果 `docker info` 失败，请先启动 Docker Desktop 并重新检查当前 Ubuntu 的 WSL Integration。

安装器默认解析最新的 stable 官方 GitHub Release，不包含 RC 版本。如需安装最新 RC，请显式传入 `--channel rc`。

首次安装时可以选择中文或英文，并在以下两种模式中选择：

- **局域网测试**：默认使用 `8080` 端口，不需要域名或 TLS 邮箱。选择后安装器会继续询问“是否仅允许局域网访问”；选择“否”可临时通过公网 IP + HTTP 访问 VPS。
- **立即配置 TLS**：绑定生产域名并通过 ACME / Let's Encrypt 获取证书。

如果你已经从云厂商或 CA 申请好了证书，可以在首次安装时使用自有证书模式：

```sh
curl -fsSL https://raw.githubusercontent.com/FlightDan/crewqual/main/install.sh \
  | sudo bash -s -- --network-mode tls \
      --domain crewqual.example.com \
      --tls-cert /etc/ssl/crewqual/fullchain.pem \
      --tls-key /etc/ssl/crewqual/privkey.pem \
      --port 443
```

`--tls-cert` 应为 PEM 格式的服务器证书或完整证书链，`--tls-key` 应为匹配的未加密 PEM 私钥。安装器会校验证书有效期、域名覆盖范围和证书/私钥匹配关系，然后复制到 `/opt/crewqual/tls/` 并由 Caddy 使用。自有证书模式不需要 `--tls-email`；如果之后证书续期，需要重新运行安装器或 `configure-domain.sh` 传入新文件。

如果已经先按局域网模式安装，也可以这样切换到自有证书：

```sh
sudo /opt/crewqual/configure-domain.sh \
  --domain crewqual.example.com \
  --tls-cert /etc/ssl/crewqual/fullchain.pem \
  --tls-key /etc/ssl/crewqual/privkey.pem \
  --port 443
```

不传 `--tls-cert` 和 `--tls-key` 时，仍使用 Caddy 的 ACME 自动证书模式。申请新的证书不会自动吊销你已有的旧证书；旧证书会继续有效到期或被 CA 单独吊销。

公网 HTTP 模式不会加密首次授权码、登录凭据、TOTP 或业务数据。安装器会要求再次确认并显示安全警告；仅建议临时使用，同时应通过防火墙限制来源。配置 HTTPS 后，请更换管理员密码与 TOTP、撤销所有活跃会话，并轮换 HTTP 阶段录入过的 API/Webhook 密钥。无人值守安装可显式使用 `--network-mode http --public-address <VPS公网IP>`。

局域网或临时公网 HTTP 部署完成后，可以再绑定生产域名并启用 TLS：

```sh
sudo /opt/crewqual/configure-domain.sh \
  --domain crewqual.example.com --tls-email ops@example.com --port 443
```

脚本只会在证书签发和健康检查成功后开放公网访问；任一步骤失败都会恢复原有局域网配置。使用自定义 TLS 端口时，公网 TCP 80 端口仍需能够到达 Caddy，以完成 ACME HTTP 验证。

安装指定版本：

```sh
curl -fsSL https://raw.githubusercontent.com/FlightDan/crewqual/main/install.sh \
  | sudo bash -s -- --version v1.0.1
```

普通 Linux 主机无人值守安装：

```sh
curl -fsSL https://raw.githubusercontent.com/FlightDan/crewqual/main/install.sh \
  | sudo bash -s -- --install-docker --non-interactive \
      --network-mode lan --lan-address 192.168.1.20
```

再次运行安装命令会升级现有部署，并保留 `/opt/crewqual/.env` 与 Docker volumes。TLS 邮箱仅用于证书到期、续期或错误通知，不是 CrewQual 登录账号，也不需要提供邮箱密码。

## SaaS 与企业服务

CrewQual 可自行部署，也提供面向企业和小型团队的托管服务，包括：

- 完全托管
- 数据迁移
- 系统配置
- 运维与数据备份
- 消息通知渠道集成
- 企业内部OA集成
- 功能定制与业务流程适配

联系邮箱：`CrewQual@devdan.cc`

## 路线图

- [ ] 从多维表格一键迁移
- [ ] Node.js 22 → 24
- [ ] macOS 完整支持
- [ ] arm64 正式版到正式版升级验收（目前没有更早的 arm64 正式版基线）
- [ ] 真实 AWS IAM、SSE-KMS 与存储桶策略验收（未验证）
- [ ] 跨区域与生产环境灾备恢复演练（未验证）

## 隐私与安全

CrewQual 以自托管为默认设计。除非部署方主动配置外部服务或第三方集成，人员信息、资质记录与凭证文件都保留在部署方控制的基础设施中。

AI 辅助核验是可选能力，不影响核心流程；启用外部 AI 服务前，部署方应根据适用法律、保密要求与数据处理政策选择供应商。

CrewQual 本身不会在未经配置的情况下主动将业务数据发送至第三方服务。

### 安全控制与标准参考

项目以 OWASP ASVS 5.0.0 L2 和 GB/T 22239—2019《信息安全技术 网络安全等级保护基本要求》三级相关要求作为产品安全设计和工程改进的参考。

> <sub>这不表示 CrewQual 已完成全部 ASVS 条款验证、渗透测试、正式等保测评或第三方安全认证。最终符合性还取决于具体版本、认证策略、部署环境、外部服务和组织自身的运维控制。当前实现及边界见[“安全与认证” Wiki](./wiki/zh-CN/security.md)，历史审查和改进记录见[安全文档](./docs/security/)。</sub>

CrewQual 提供可配置的密码、TOTP 和 WebAuthn/FIDO2 身份鉴别，并在服务端执行角色、权限及组织/单位范围校验。产品还实现了会话空闲与绝对有效期、登录限流和锁定、面向高敏操作的再次认证机制、同源与 CSRF 校验、逐响应 nonce CSP、操作审计和只读风险统计。密码使用 Argon2id；敏感集成设置使用 AES-256-GCM 加密。数据库、对象存储、备份和主机磁盘的静态加密由部署方配置。

实际认证强度取决于所选策略。便捷模式下，成员使用工号、登记手机号和短信一次性链接登录，属于单因素认证，不满足 OWASP ASVS L2 或等保三级的组合身份鉴别要求。组合模式要求密码和 TOTP；增强模式再要求通过 WebAuthn/FIDO2 完成用户验证。

官方发布流程会检查 GPG 签名标签、签名清单、SHA-256 校验和、容器镜像签名、SBOM 和来源证明。候选版本 `v1.0.6-rc.14` 的[发布验收工作流](https://github.com/FlightDan/crewqual/actions/runs/34344021582)已在 amd64 与 arm64 主机上通过，覆盖发布制品构建、发布后安装、升级、故障回滚与重试检查；该证据仅适用于此候选版本，不构成 `v1.0.6` 正式版或任何安全标准的验收结论。

发现可能影响 CrewQual 的安全问题时，请勿在公开 Issue 中披露利用细节。请阅读 [SECURITY.md](./SECURITY.md) 或联系 `CrewQual@devdan.cc`。

## 参与贡献

欢迎通过 Issues 与 Pull Requests 改进代码、测试、文档、界面和部署流程。

代码贡献须遵守 [CLA.md](./CLA.md)，参与方式见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## 许可证

CrewQual 仅以 GNU Affero General Public License v3.0 发布（SPDX：`AGPL-3.0-only`），完整条款见 [LICENSE](./LICENSE)。

你可以在遵守 AGPL-3.0 条款的前提下自由使用、部署、研究、修改和再分发 CrewQual。

如果你修改 CrewQual，并通过网络向用户提供对该修改版本的访问，请确保按照 AGPL-3.0 的要求向相关用户提供对应源代码。

未来 CrewQual 可能同时提供其他授权方式，例如面向商业部署、托管服务、定制开发或不希望受到 AGPL-3.0 开源义务约束的组织提供商业许可证。

具体授权条件请以仓库中的 LICENSE 文件及后续公布的商业授权条款为准。

README 中的说明仅用于帮助理解，具体权利和义务以 LICENSE 中的 AGPL-3.0 正文为准。
