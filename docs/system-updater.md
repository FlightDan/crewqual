# 系统更新器

官方 Linux `/opt/crewqual` Docker Compose 安装会尝试部署
`/usr/local/libexec/crewqual-updater` 和 `crewqual-updater.service`。Web 容器只读挂载
`/run/crewqual-updater`，仅访问 API socket 和维护标记，不会获得 Docker Socket、sudo 或宿主机部署目录写权限。

设置页中的“系统更新”仅超级管理员可见，且只允许安装签名清单中的最新稳定版本。更新流程固定经过预检、镜像拉取、数据库加密保护备份、迁移、重启和健康检查；备份会重新解密并通过 `pg_restore --list` 验证。更新器失败时恢复受管理的 Compose、Caddyfile、环境字段和旧服务，不执行 `down -v`，也不自动恢复数据库。

更新器在备份/迁移/重启阶段写入 `/run/crewqual-updater/maintenance`；API 写请求在该标记存在时返回 503，健康检查和只读页面仍可用。目标窗口为升级不超过 15 分钟、RPO 不超过 24 小时、故障恢复 RTO 不超过 60 分钟；每次正式发布必须记录一次隔离恢复演练证据。

源码 Compose、NAS、Kubernetes、非 systemd 主机或更新器无法安装时，页面自动显示人工模式。应用备份中的 LOCAL 目标是合法的本机保护能力，固定使用 Worker 的 `/backups` 卷；异机目标仍是灾难恢复推荐。

发布流程使用 `pnpm release:update-manifest` 生成 `update-manifest-v1.json`，再使用受保护 CI secret `UPDATE_MANIFEST_PRIVATE_KEY_B64` 执行 `pnpm release:sign-update-manifest`。正式清单必须包含 Web/Runtime 完整镜像 digest、部署文件哈希、amd64/arm64 更新器 SHA-256 和向后兼容迁移策略，并在发布前完成 Ed25519 签名。安装器必须通过 `CREWQUAL_UPDATER_TRUSTED_PUBLIC_KEY` 提供对应的 32 字节 Base64 公钥，否则拒绝安装未验签发布。
