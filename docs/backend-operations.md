# CrewQual 后端运行手册

生产单机安装、首次初始化、升级和回滚的完整步骤见 [`docker-deployment.md`](./docker-deployment.md)。

## 本地启动

1. 复制 `.env.example` 为 `.env`，在本地把 `NEXT_PUBLIC_SERVICE_MODE` 设为 `mock` 可继续使用 `/dev/*` 预览；真实链路设为 `remote`。
2. 启动 `docker compose --profile dev up -d postgres minio`。
3. 执行 `pnpm db:migrate`、`pnpm db:seed`，再运行 `pnpm dev` 和 `pnpm dev:worker`。

生产只使用 Caddy 暴露的 80/443。PostgreSQL、Worker、MinIO 管理端口不发布到宿主机。生产环境必须使用外部 S3 兼容存储，配置真实 SMS adapter 后才能开放 Pilot 访问入口。

管理员登录策略在“系统设置 → 安全与审计”中统一管理，支持“密码 + TOTP”（默认）、“仅动态验证码”和“仅密码”三种模式。切换模式会立即撤销全部管理员会话；“仅动态验证码”属于单因素登录，启用前应确认恢复密钥和运维通道可用。

`run_webui.sh` 默认监听 `0.0.0.0:3000`，即所有网卡；需要仅本机访问时可使用 `./run_webui.sh run --host 127.0.0.1`。Mock 模式虽然不会暴露真实业务 API，但管理界面仍会对网络可达，因此不要把开发实例直接暴露到不受信任的公网；公网入口必须使用生产 Compose 栈和 HTTPS 反向代理。发布前确认 `APP_ORIGIN` 是无路径的 HTTPS origin、数据库和对象存储没有示例口令，并分别生成 `SESSION_SECRET` 与 `SETTINGS_ENCRYPTION_KEY`。

## 发布

```sh
docker compose config --quiet
docker compose build --pull
docker compose up -d
docker compose ps -a
```

Compose 会按 `postgres → migrate → bootstrap → web/worker → caddy` 自动执行；不要对精简的 Web 运行镜像手工调用 Prisma。`bootstrap` 创建系统角色和权限；无人值守安装时同时提供全部三个 `INITIAL_ADMIN_*` 变量，会创建首个管理员、组织/根单位和仅含飞行员职位的标准模板，业务人员保持为零。交互式部署将三个变量留空后，首次访问 `/setup` 可完成同一流程。

轮换现有超级管理员密码（保留 TOTP、撤销全部旧会话并写入审计记录）：

```sh
pnpm admin:rotate-password admin@example.com
```

如果超级管理员丢失验证器或需要重新配置动态验证码，可在服务器的 `ops` 一次性容器中执行：

```sh
docker compose --profile ops run --rm ops pnpm admin:rotate-totp admin@example.com
```

命令只允许启用中的超级管理员，自动生成新的 Base32 密钥和 `otpauth` URI，清除账号锁定并撤销该账号全部旧会话；完整密钥只在命令输出中显示一次。它是 TypeScript 运维命令，不需要进入 Web 容器，也不是独立的 `.sh` 恢复脚本。

命令使用系统 CSPRNG 生成 256-bit 随机密码，并只在成功后显示一次；立即存入密码管理器，不要写回 `.env` 或提交到仓库。

启动失败时先检查 `/api/health`、结构化日志中的 `requestId`/`jobId` 和数据库连接；`SERVICE_MODE=mock` 在生产会被启动配置拒绝。

## 备份与恢复演练

每日执行 PostgreSQL `pg_dump --format=custom`，把加密文件上传到与主站不同区域的备份桶；S3 桶开启版本控制和服务端加密。保留至少 30 个日备份与 12 个月月备份。

每月在隔离环境下载一份数据库备份和对象存储版本，执行：

```sh
pg_restore --clean --if-exists --dbname="$DIRECT_URL" backup.dump
pnpm db:migrate
```

随后访问健康检查并走一遍 Magic Link、上传、异步核验、人工审批和通知重试流程，记录恢复耗时、丢失数据范围和对象版本。恢复演练不能直接覆盖生产数据库。

## 图片留存

浏览器只上传裁切、校正方向、最长边不超过 2560px、质量 0.9 的 JPEG。服务端拒绝非 JPEG、超过 10 MiB、超过尺寸上限或不完整的文件。数据库只保存 `EvidenceImage` 元数据和私有对象 key；未关联对象 24 小时后由 Worker 清理，已关联对象按业务留存策略保留。

## 应用内备份与 AVIF 优化

超级管理员可在“系统设置 → 图库优化”开启空闲时 AVIF 转换。上传协议仍为 JPEG，服务端会在识别任务完成、队列空闲后进行像素校验，通过后再切换对象 key；失败不会删除原图。

“系统设置 → 备份与恢复”支持分别为图库和数据库建立多个计划。数据库使用 PostgreSQL custom-format 全量备份；图库支持全量和基于 `EvidenceImage.updatedAt` 的增量归档。目标类型包括本地目录、SMB、FTP/FTPS、WebDAV 和 S3，非本地目标由 Worker 内的 rclone 执行。

生产环境应为 Worker 挂载 `pg_dump`、`pg_restore`、`tar` 和 rclone 所需的网络权限。备份加密默认开启，目标密钥只保存为加密密文。数据库恢复会先创建恢复前快照，并要求超级管理员输入“恢复”确认；恢复演练必须在隔离环境进行。

远端目标的密钥字段使用 JSON：SMB/FTP/WebDAV 使用 `{"username":"...","password":"..."}`，S3 使用 `{"accessKeyId":"...","secretAccessKey":"..."}`；FTP 如确需明文连接可额外设置 `"tls":"false"`，生产建议保持 FTPS。
