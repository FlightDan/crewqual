#!/usr/bin/env bash
set -Eeuo pipefail

# CrewQual public-image installer.
# Safe to run from a checkout or through:
# curl -fsSL https://raw.githubusercontent.com/FlightDan/crewqual/main/install.sh | sudo bash

readonly GITHUB_REPOSITORY="FlightDan/crewqual"
readonly DEFAULT_INSTALL_DIR="/opt/crewqual"
readonly WAIT_TIMEOUT_SECONDS="${CREWQUAL_INSTALL_TIMEOUT_SECONDS:-300}"
readonly UPDATER_BINARY_DIR="/usr/local/libexec"
readonly UPDATER_CONFIG_DIR="/etc/crewqual-updater"
readonly UPDATER_DATA_DIR="/var/lib/crewqual-updater"

INSTALL_DIR="${CREWQUAL_INSTALL_DIR:-$DEFAULT_INSTALL_DIR}"
RELEASE_VERSION=""
LANGUAGE_INPUT="${CREWQUAL_INSTALL_LANGUAGE:-}"
APP_DOMAIN_INPUT=""
TLS_EMAIL_INPUT=""
NETWORK_MODE_INPUT=""
APP_PORT_INPUT=""
PORT_SELECTION=""
LAN_ADDRESS_INPUT=""
APP_ORIGIN_VALUE=""
CADDY_SITE_ADDRESS_VALUE=""
APP_BIND_VALUE="0.0.0.0"
ACME_BIND_VALUE="127.0.0.1"
ACME_PORT_VALUE="18080"
SETUP_AUTH_CODE_DISPLAY=""
NON_INTERACTIVE=0
PULL_IMAGES=1
TEMP_DIR=""
ENV_FILE=""
COMPOSE_FILE=""
COMPOSE=()
EXISTING_INSTALL=0
ROLLBACK_DIR=""
UPGRADE_DB_BACKUP=""
PREVIOUS_CONFIGURE_DOMAIN=0

usage() {
  cat <<'EOF'
Usage: install.sh [options]

Install or upgrade CrewQual with public GHCR images.

Options:
  --version VERSION   Install an exact GitHub Release (for example v1.0.0).
  --domain HOSTNAME   Public hostname used by CrewQual and Caddy.
  --tls-email EMAIL   Email used for ACME/TLS notifications.
  --network-mode MODE Initial network mode: lan or tls.
  --lan-address IP    Advertised private IPv4 address in LAN mode.
  --port PORT         Application access port (default: 8080 for new installs).
  --random-port       Select a free high port for the application.
  --language LANG     Installer language: zh or en (default: zh).
  --non-interactive   Fail instead of prompting for missing first-install values.
  --no-pull           Reuse locally cached images when available.
  -h, --help          Show this help.

Environment:
  CREWQUAL_INSTALL_DIR              Install directory (default: /opt/crewqual).
  CREWQUAL_INSTALL_TIMEOUT_SECONDS  Container health timeout (default: 300).
  CREWQUAL_UPDATER_TRUSTED_PUBLIC_KEY
                                    Base64 Ed25519 public key used to verify the
                                    signed release manifest (required for managed updates).

The installer never removes Docker volumes and never overwrites secrets in an
existing .env. Re-running it upgrades the managed Compose/Caddy files and image
version while preserving deployment configuration and data.
EOF
}

die() {
  echo "install.sh: $*" >&2
  exit 1
}

log() {
  echo
  echo "==> $*"
}

msg() {
  local key="$1"
  local locale="${LANGUAGE_INPUT:-zh}"
  shift
  [[ "$locale" == "en" ]] || locale="zh"
  case "$locale:$key" in
    zh:language_prompt) printf '选择语言 [1=中文, 2=English]: ' ;;
    en:language_prompt) printf 'Select language [1=Chinese, 2=English]: ' ;;
    zh:invalid_language) printf '语言必须是 zh 或 en: %s' "$1" ;;
    en:invalid_language) printf 'Language must be zh or en: %s' "$1" ;;
    zh:command_unavailable) printf '命令不可用: %s' "$1" ;;
    en:command_unavailable) printf 'Command unavailable: %s' "$1" ;;
    zh:version_invalid) printf '版本格式无效: %s（应类似 v1.0.0）' "$1" ;;
    en:version_invalid) printf 'Invalid version format: %s (expected v1.0.0)' "$1" ;;
    zh:domain_invalid_shape) printf '域名必须是不含协议、端口和路径的主机名' ;;
    en:domain_invalid_shape) printf 'The domain must be a hostname without a protocol, port, or path' ;;
    zh:domain_invalid) printf '域名格式无效: %s' "$1" ;;
    en:domain_invalid) printf 'Invalid domain format: %s' "$1" ;;
    zh:email_invalid) printf 'TLS 邮箱格式无效: %s' "$1" ;;
    en:email_invalid) printf 'Invalid TLS email format: %s' "$1" ;;
    zh:port_invalid) printf '端口必须是 1-65535 之间的整数: %s' "$1" ;;
    en:port_invalid) printf 'Port must be an integer from 1 to 65535: %s' "$1" ;;
    zh:lan_ipv4) printf '局域网地址必须是 IPv4 地址: %s' "$1" ;;
    en:lan_ipv4) printf 'LAN address must be an IPv4 address: %s' "$1" ;;
    zh:lan_invalid) printf '局域网地址无效: %s' "$1" ;;
    en:lan_invalid) printf 'Invalid LAN address: %s' "$1" ;;
    zh:lan_private) printf '局域网地址必须属于 RFC1918 私网: %s' "$1" ;;
    en:lan_private) printf 'LAN address must be an RFC1918 private address: %s' "$1" ;;
    zh:random_port_failed) printf '无法在 10000-59999 范围内找到空闲端口' ;;
    en:random_port_failed) printf 'Could not find a free port in the range 10000-59999' ;;
    zh:port_occupied) printf '端口已被占用: %s' "$1" ;;
    en:port_occupied) printf 'Port is already in use: %s' "$1" ;;
    zh:port_prompt) printf '端口 [1=默认8080, 2=随机可用, 3=自定义]: ' ;;
    en:port_prompt) printf 'Port [1=default 8080, 2=random free, 3=custom]: ' ;;
    zh:custom_port_prompt) printf '应用访问端口: ' ;;
    en:custom_port_prompt) printf 'Application access port: ' ;;
    zh:default_port_occupied) printf '默认端口 8080 已被占用，请传入 --port 或 --random-port' ;;
    en:default_port_occupied) printf 'Default port 8080 is already in use; pass --port or --random-port' ;;
    zh:port_retry) printf '端口 %s 已被占用，请重新选择。' "$1" ;;
    en:port_retry) printf 'Port %s is already in use; please choose another one.' "$1" ;;
    zh:port_reserved) printf '应用访问端口不能使用 80；该端口保留给 ACME HTTP 验证' ;;
    en:port_reserved) printf 'Application port 80 cannot be used; it is reserved for ACME HTTP validation' ;;
    zh:network_prompt) printf '网络模式 [1=局域网测试, 2=立即配置 TLS]: ' ;;
    en:network_prompt) printf 'Network mode [1=LAN test, 2=Configure TLS now]: ' ;;
    zh:network_required) printf '首次非交互安装必须传入 --network-mode lan|tls' ;;
    en:network_required) printf 'First non-interactive install requires --network-mode lan|tls' ;;
    zh:network_invalid) printf '网络模式必须是 lan 或 tls' ;;
    en:network_invalid) printf 'Network mode must be lan or tls' ;;
    zh:lan_required) printf '局域网模式非交互安装必须传入 --lan-address' ;;
    en:lan_required) printf 'Non-interactive LAN installation requires --lan-address' ;;
    zh:lan_address_prompt) printf '局域网访问地址 [%s]: ' "$1" ;;
    en:lan_address_prompt) printf 'LAN access address [%s]: ' "$1" ;;
    zh:tls_domain_prompt) printf 'CrewQual 公网域名: ' ;;
    en:tls_domain_prompt) printf 'CrewQual public domain: ' ;;
    zh:tls_email_prompt) printf 'TLS 通知邮箱: ' ;;
    en:tls_email_prompt) printf 'TLS notification email: ' ;;
    zh:tls_domain_required) printf 'TLS 模式必须传入 --domain' ;;
    en:tls_domain_required) printf 'TLS mode requires --domain' ;;
    zh:tls_email_required) printf 'TLS 模式必须传入 --tls-email' ;;
    en:tls_email_required) printf 'TLS mode requires --tls-email' ;;
    zh:no_tty) printf '当前没有交互式终端；请传入网络模式、端口和必要的域名参数' ;;
    en:no_tty) printf 'No interactive terminal is available; pass the network mode, port, and required domain parameters' ;;
    zh:resolve_latest) printf '解析最新 CrewQual 正式版本' ;;
    en:resolve_latest) printf 'Resolve the latest CrewQual release' ;;
    zh:latest_version) printf '最新版本: %s' "$1" ;;
    en:latest_version) printf 'Latest version: %s' "$1" ;;
    zh:download_manifest) printf '下载 %s 部署清单' "$1" ;;
    en:download_manifest) printf 'Download the %s deployment manifest' "$1" ;;
    zh:deployment_empty) printf '下载的部署文件为空' ;;
    en:deployment_empty) printf 'Downloaded deployment files are empty' ;;
    zh:trusted_key_required) printf '首次安装必须设置 CREWQUAL_UPDATER_TRUSTED_PUBLIC_KEY' ;;
    en:trusted_key_required) printf 'First installation requires CREWQUAL_UPDATER_TRUSTED_PUBLIC_KEY' ;;
    zh:trusted_key_missing) printf '缺少 CREWQUAL_UPDATER_TRUSTED_PUBLIC_KEY；拒绝安装未验签的正式发布' ;;
    en:trusted_key_missing) printf 'CREWQUAL_UPDATER_TRUSTED_PUBLIC_KEY is missing; refusing to install an unsigned release' ;;
    zh:key_base64) printf '更新器公钥不是合法 Base64' ;;
    en:key_base64) printf 'Updater public key is not valid Base64' ;;
    zh:key_length) printf '更新器公钥必须是 32 字节 Ed25519 公钥' ;;
    en:key_length) printf 'Updater public key must be a 32-byte Ed25519 public key' ;;
    zh:key_parse) printf '无法解析更新器 Ed25519 公钥' ;;
    en:key_parse) printf 'Could not parse the updater Ed25519 public key' ;;
    zh:signature_base64) printf '发布清单签名不是合法 Base64' ;;
    en:signature_base64) printf 'Release manifest signature is not valid Base64' ;;
    zh:signature_invalid) printf '发布清单 Ed25519 签名校验失败，拒绝安装' ;;
    en:signature_invalid) printf 'Release manifest Ed25519 signature verification failed; refusing to install' ;;
    zh:manifest_sha_missing) printf '发布清单缺少部署文件 SHA-256' ;;
    en:manifest_sha_missing) printf 'Release manifest is missing deployment file SHA-256 values' ;;
    zh:compose_sha_invalid) printf 'docker-compose.install.yml SHA-256 校验失败，拒绝安装' ;;
    en:compose_sha_invalid) printf 'docker-compose.install.yml SHA-256 verification failed; refusing to install' ;;
    zh:caddy_sha_invalid) printf 'Caddyfile SHA-256 校验失败，拒绝安装' ;;
    en:caddy_sha_invalid) printf 'Caddyfile SHA-256 verification failed; refusing to install' ;;
    zh:configure_sha_invalid) printf 'configure-domain.sh SHA-256 无效' ;;
    en:configure_sha_invalid) printf 'Invalid configure-domain.sh SHA-256' ;;
    zh:configure_missing) printf '发布清单包含 configure-domain.sh，但文件下载失败' ;;
    en:configure_missing) printf 'Release manifest includes configure-domain.sh, but the file could not be downloaded' ;;
    zh:configure_sha_failed) printf 'configure-domain.sh SHA-256 校验失败，拒绝安装' ;;
    en:configure_sha_failed) printf 'configure-domain.sh SHA-256 verification failed; refusing to install' ;;
    zh:wait_status) printf '等待 %s: %s' "$1" "$2" ;;
    en:wait_status) printf 'Wait for %s: %s' "$1" "$2" ;;
    zh:service_status_bad) printf '%s 状态异常: %s' "$1" "$2" ;;
    en:service_status_bad) printf '%s has an unhealthy status: %s' "$1" "$2" ;;
    zh:service_status_timeout) printf '%s 未在 %ss 内达到 %s' "$1" "$2" "$3" ;;
    en:service_status_timeout) printf '%s did not reach %s within %ss' "$1" "$3" "$2" ;;
    zh:wait_complete) printf '等待 %s 完成' "$1" ;;
    en:wait_complete) printf 'Wait for %s to complete' "$1" ;;
    zh:service_failed) printf '%s 执行失败（退出码: %s）' "$1" "${2:-unknown}" ;;
    en:service_failed) printf '%s failed (exit code: %s)' "$1" "${2:-unknown}" ;;
    zh:service_dead) printf '%s 状态异常: dead' "$1" ;;
    en:service_dead) printf '%s has an unhealthy status: dead' "$1" ;;
    zh:service_timeout) printf '%s 未在 %ss 内完成' "$1" "$2" ;;
    en:service_timeout) printf '%s did not complete within %ss' "$1" "$2" ;;
    zh:systemd_missing) printf '错误: systemd 不可用，无法完成更新器交付。' ;;
    en:systemd_missing) printf 'Error: systemd is unavailable; the updater cannot be delivered.' ;;
    zh:arch_unsupported) printf '错误: 当前架构不支持宿主机更新器，无法完成更新器交付。' ;;
    en:arch_unsupported) printf 'Error: the host updater is unsupported on this architecture; delivery cannot complete.' ;;
    zh:updater_download_failed) printf '错误: 无法下载更新器；请修复网络或设置 CREWQUAL_UPDATER_BINARY_URL 后重试。' ;;
    en:updater_download_failed) printf 'Error: could not download the updater; fix the network or set CREWQUAL_UPDATER_BINARY_URL and retry.' ;;
    zh:updater_empty) printf '错误: 更新器下载为空，无法完成更新器交付。' ;;
    en:updater_empty) printf 'Error: the updater download was empty; delivery cannot complete.' ;;
    zh:updater_hash_missing) printf '提示: 发布清单缺少 %s 更新器哈希，拒绝安装。' "$1" ;;
    en:updater_hash_missing) printf 'Notice: the release manifest has no updater hash for %s; refusing to install.' "$1" ;;
    zh:updater_checksum) printf '提示: 更新器校验和不匹配，拒绝安装。' ;;
    en:updater_checksum) printf 'Notice: updater checksum mismatch; refusing to install.' ;;
    zh:updater_trust_missing) printf '提示: 更新器信任公钥未配置，拒绝安装更新器。' ;;
    en:updater_trust_missing) printf 'Notice: updater trusted public key is not configured; refusing to install the updater.' ;;
    zh:updater_start_failed) printf '错误: 更新器服务启动失败，无法完成更新器交付。' ;;
    en:updater_start_failed) printf 'Error: the updater service failed to start; delivery cannot complete.' ;;
    zh:setup_auth_code) printf '首次配置授权码（仅显示一次）: %s' "$1" ;;
    en:setup_auth_code) printf 'First-setup authorization code (shown once): %s' "$1" ;;
    zh:setup_auth_warning) printf '请立即保存该授权码；首次配置前需要在 /setup 输入它。' ;;
    en:setup_auth_warning) printf 'Save this code now; it is required at /setup before initial configuration.' ;;
    zh:validate_manifest) printf '校验 %s 生产部署清单' "$1" ;;
    en:validate_manifest) printf 'Validate the %s production deployment manifest' "$1" ;;
    zh:pull_images) printf '拉取 CrewQual %s 镜像' "$1" ;;
    en:pull_images) printf 'Pull CrewQual %s images' "$1" ;;
    zh:start_minio) printf '启动内置对象存储' ;;
    en:start_minio) printf 'Start built-in object storage' ;;
    zh:start_postgres) printf '启动 PostgreSQL' ;;
    en:start_postgres) printf 'Start PostgreSQL' ;;
    zh:run_migrations) printf '执行数据库迁移' ;;
    en:run_migrations) printf 'Run database migrations' ;;
    zh:run_bootstrap) printf '执行生产基线初始化' ;;
    en:run_bootstrap) printf 'Initialize the production baseline' ;;
    zh:start_web_worker) printf '启动 Web 与 Worker' ;;
    en:start_web_worker) printf 'Start Web and Worker' ;;
    zh:start_https) printf '启动 HTTPS 入口' ;;
    en:start_https) printf 'Start HTTPS entrypoint' ;;
    zh:deployment_complete) printf 'CrewQual %s 部署完成' "$1" ;;
    en:deployment_complete) printf 'CrewQual %s deployment complete' "$1" ;;
    zh:welcome) printf '欢迎配置: %s/setup' "$1" ;;
    en:welcome) printf 'Setup URL: %s/setup' "$1" ;;
    zh:install_dir) printf '安装目录: %s' "$1" ;;
    en:install_dir) printf 'Install directory: %s' "$1" ;;
    zh:view_logs) printf '查看日志: cd %s && docker compose logs -f --tail=200 web worker caddy' "$1" ;;
    en:view_logs) printf 'View logs: cd %s && docker compose logs -f --tail=200 web worker caddy' "$1" ;;
    zh:volume_warning) printf '重要: 不要执行 docker compose down -v；该命令会删除持久数据卷。' ;;
    en:volume_warning) printf 'Important: do not run docker compose down -v; it deletes persistent data volumes.' ;;
    zh:deployment_failed) printf '部署失败（退出码: %s）。' "$1" ;;
    en:deployment_failed) printf 'Deployment failed (exit code: %s).' "$1" ;;
    zh:existing_mode) printf '已有部署的网络模式为 %s；安装器不会在升级时切换模式，请使用专用网络配置脚本' "$1" ;;
    en:existing_mode) printf 'The existing deployment uses network mode %s; the installer will not change modes during an upgrade. Use the dedicated network configuration script' "$1" ;;
    zh:existing_port) printf '已有部署的端口为 %s；安装器不会在升级时修改端口，请使用设置中心或专用脚本' "$1" ;;
    en:existing_port) printf 'The existing deployment uses port %s; the installer will not change ports during an upgrade. Use Settings or the dedicated script' "$1" ;;
    zh:existing_domain) printf '已有部署的域名为 %s；安装器不会覆盖它，请先备份并手工修改 .env' "$1" ;;
    en:existing_domain) printf 'The existing deployment uses domain %s; the installer will not overwrite it. Back up and edit .env manually first' "$1" ;;
    zh:existing_email) printf '已有部署的 TLS 邮箱为 %s；安装器不会覆盖它，请手工修改 .env' "$1" ;;
    en:existing_email) printf 'The existing deployment uses TLS email %s; the installer will not overwrite it. Edit .env manually' "$1" ;;
    zh:deployment_unsigned) printf '缺少 CREWQUAL_UPDATER_TRUSTED_PUBLIC_KEY；拒绝安装未验签的正式发布' ;;
    en:deployment_unsigned) printf 'CREWQUAL_UPDATER_TRUSTED_PUBLIC_KEY is missing; refusing to install an unsigned release' ;;
    zh:compose_unavailable) printf '无法连接 Docker daemon' ;;
    en:compose_unavailable) printf 'Cannot connect to the Docker daemon' ;;
    zh:compose_plugin_missing) printf 'Docker Compose v2 plugin 不可用' ;;
    en:compose_plugin_missing) printf 'Docker Compose v2 plugin is unavailable' ;;
    zh:linux_only) printf '当前安装器仅支持 Linux' ;;
    en:linux_only) printf 'This installer only supports Linux' ;;
    zh:run_as_root) printf '请使用 sudo 运行安装器（默认写入 %s）' "$1" ;;
    en:run_as_root) printf 'Run the installer with sudo (default install directory: %s)' "$1" ;;
    zh:timeout_invalid) printf 'CREWQUAL_INSTALL_TIMEOUT_SECONDS 必须是正整数' ;;
    en:timeout_invalid) printf 'CREWQUAL_INSTALL_TIMEOUT_SECONDS must be a positive integer' ;;
    zh:install_dir_invalid) printf '安装目录必须是非根目录的绝对路径' ;;
    en:install_dir_invalid) printf 'Install directory must be an absolute path other than /' ;;
    zh:env_symlink) printf '.env 不能是符号链接' ;;
    en:env_symlink) printf '.env must not be a symbolic link' ;;
    zh:missing_option_value) printf '%s 缺少参数' "$1" ;;
    en:missing_option_value) printf '%s requires a value' "$1" ;;
    zh:unknown_option) printf '未知参数: %s' "$1" ;;
    en:unknown_option) printf 'Unknown option: %s' "$1" ;;
    zh:*) printf '%s' "$key" ;;
    en:*) printf '%s' "$key" ;;
  esac
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "$(msg command_unavailable "$1")"
}

atomic_install() {
  local source="$1"
  local target="$2"
  local mode="$3"
  local staged="${target}.new"
  install -m "$mode" "$source" "$staged"
  mv -f -- "$staged" "$target"
}

compose() {
  "${COMPOSE[@]}" "$@"
}

cleanup() {
  if [[ -n "$TEMP_DIR" && -d "$TEMP_DIR" ]]; then
    rm -rf -- "$TEMP_DIR"
  fi
}

show_diagnostics() {
  if ((${#COMPOSE[@]} == 0)); then
    return
  fi
  echo "--- docker compose ps -a ---" >&2
  compose ps -a >&2 || true
  echo "--- recent deployment logs ---" >&2
  compose logs --tail=100 minio minio-init postgres migrate bootstrap web worker caddy >&2 || true
}

on_error() {
  local exit_code=$?
  trap - ERR
  restore_existing_install || true
  printf '\n%s\n' "$(msg deployment_failed "$exit_code")" >&2
  show_diagnostics
  exit "$exit_code"
}

snapshot_existing_install() {
  ROLLBACK_DIR="$TEMP_DIR/rollback"
  mkdir -p -- "$ROLLBACK_DIR"
  for pair in \
    "$ENV_FILE:env" \
    "$COMPOSE_FILE:compose" \
    "$INSTALL_DIR/Caddyfile:caddy"; do
    local source="${pair%%:*}" target="${pair##*:}"
    [[ -f "$source" ]] || die "无法创建升级回滚快照: $source 不存在"
    cp -p -- "$source" "$ROLLBACK_DIR/$target"
  done
  if [[ -f "$INSTALL_DIR/configure-domain.sh" ]]; then
    PREVIOUS_CONFIGURE_DOMAIN=1
    cp -p -- "$INSTALL_DIR/configure-domain.sh" "$ROLLBACK_DIR/configure-domain.sh"
  fi
}

create_upgrade_database_backup() {
  [[ "$EXISTING_INSTALL" == "1" ]] || return 0
  UPGRADE_DB_BACKUP="$ROLLBACK_DIR/database.dump"
  compose exec -T postgres pg_dump -U crewqual -d crewqual --format=custom >"$UPGRADE_DB_BACKUP"
  [[ -s "$UPGRADE_DB_BACKUP" ]] || die "无法创建升级前数据库备份，已停止升级"
  chmod 600 "$UPGRADE_DB_BACKUP"
}

restore_existing_install() {
  [[ "$EXISTING_INSTALL" == "1" && -n "$ROLLBACK_DIR" && -d "$ROLLBACK_DIR" ]] || return 0
  local failed=0
  for pair in \
    "env:$ENV_FILE:0600" \
    "compose:$COMPOSE_FILE:0644" \
    "caddy:$INSTALL_DIR/Caddyfile:0644"; do
    local source rest target mode
    source="${pair%%:*}"
    rest="${pair#*:}"
    target="${rest%%:*}"
    mode="${rest##*:}"
    if [[ -f "$ROLLBACK_DIR/$source" ]]; then
      atomic_install "$ROLLBACK_DIR/$source" "$target" "$mode" || failed=1
    fi
  done
  if [[ -f "$ROLLBACK_DIR/configure-domain.sh" ]]; then
    atomic_install "$ROLLBACK_DIR/configure-domain.sh" "$INSTALL_DIR/configure-domain.sh" 0755 || failed=1
  elif [[ "$PREVIOUS_CONFIGURE_DOMAIN" == "0" && -f "$INSTALL_DIR/configure-domain.sh" ]]; then
    rm -f -- "$INSTALL_DIR/configure-domain.sh" || failed=1
  fi
  if [[ -s "$UPGRADE_DB_BACKUP" && ${#COMPOSE[@]} -gt 0 ]]; then
    compose up -d postgres >/dev/null 2>&1 || failed=1
    compose exec -T postgres pg_restore --clean --if-exists --no-owner --exit-on-error --dbname=crewqual <"$UPGRADE_DB_BACKUP" >/dev/null 2>&1 || failed=1
  fi
  if [[ ${#COMPOSE[@]} -gt 0 ]]; then
    compose up -d --no-deps web worker caddy >/dev/null 2>&1 || failed=1
  fi
  if ((failed)); then
    echo "警告: 升级失败，自动回滚未完全成功，请使用升级前备份执行人工恢复。" >&2
  else
    echo "已恢复升级前的受管理文件和数据库。" >&2
  fi
}

validate_version() {
  [[ "$1" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] ||
    die "$(msg version_invalid "$1")"
}

validate_domain() {
  local value="$1"
  [[ -n "$value" && "$value" != *://* && "$value" != */* && "$value" != *:* ]] ||
    die "$(msg domain_invalid_shape)"
  [[ "$value" =~ ^([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$ ]] ||
    die "$(msg domain_invalid "$value")"
}

validate_email() {
  [[ "$1" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]] ||
    die "$(msg email_invalid "$1")"
}

validate_port() {
  [[ "$1" =~ ^[0-9]+$ && "$1" -ge 1 && "$1" -le 65535 ]] ||
    die "$(msg port_invalid "$1")"
}

validate_lan_address() {
  local value="$1"
  [[ "$value" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || die "$(msg lan_ipv4 "$value")"
  local part
  IFS=. read -r -a parts <<<"$value"
  for part in "${parts[@]}"; do
    ((part <= 255)) || die "$(msg lan_invalid "$value")"
  done
  [[ "$value" == 10.* || "$value" == 192.168.* || "$value" =~ ^172\.(1[6-9]|2[0-9]|3[0-1])\. ]] ||
    die "$(msg lan_private "$value")"
}

port_is_available() {
  local port="$1"
  if ! command -v ss >/dev/null 2>&1; then
    return 0
  fi
  ! ss -H -ltn 2>/dev/null | awk -v suffix=":$port" '$4 ~ suffix "$" { found = 1 } END { exit found ? 0 : 1 }'
}

random_free_port() {
  local candidate
  for _ in $(seq 1 100); do
    candidate=$((10000 + RANDOM % 50000))
    if port_is_available "$candidate"; then
      printf '%s' "$candidate"
      return 0
    fi
  done
  die "$(msg random_port_failed)"
}

choose_port() {
  local choice="" candidate=""
  if [[ -n "$APP_PORT_INPUT" ]]; then
    validate_port "$APP_PORT_INPUT"
    port_is_available "$APP_PORT_INPUT" || die "$(msg port_occupied "$APP_PORT_INPUT")"
  elif [[ "$PORT_SELECTION" == "random" ]]; then
    APP_PORT_INPUT="$(random_free_port)"
  else
    while :; do
      if ((NON_INTERACTIVE)); then
        APP_PORT_INPUT=8080
      else
        choice="$(prompt_value "$(msg port_prompt)")"
        case "$choice" in
          2) APP_PORT_INPUT="$(random_free_port)" ;;
          3) APP_PORT_INPUT="$(prompt_value "$(msg custom_port_prompt)")" ;;
          *) APP_PORT_INPUT=8080 ;;
        esac
      fi
      validate_port "$APP_PORT_INPUT"
      if port_is_available "$APP_PORT_INPUT"; then
        break
      fi
      ((NON_INTERACTIVE)) && die "$(msg default_port_occupied)"
      echo "$(msg port_retry "$APP_PORT_INPUT")" >&2
      APP_PORT_INPUT=""
    done
  fi
  validate_port "$APP_PORT_INPUT"
  [[ "$APP_PORT_INPUT" != 80 ]] || die "$(msg port_reserved)"
}

detect_lan_address() {
  local value
  for value in $(hostname -I 2>/dev/null || true); do
    if [[ "$value" =~ ^10\. || "$value" =~ ^192\.168\. || "$value" =~ ^172\.(1[6-9]|2[0-9]|3[0-1])\. ]]; then
      printf '%s' "$value"
      return 0
    fi
  done
  return 1
}

prepare_network_config() {
  if [[ -z "$NETWORK_MODE_INPUT" ]]; then
    if [[ -n "$APP_DOMAIN_INPUT" || -n "$TLS_EMAIL_INPUT" ]]; then
      NETWORK_MODE_INPUT="tls"
    elif ((NON_INTERACTIVE)); then
        die "$(msg network_required)"
      else
      case "$(prompt_value "$(msg network_prompt)")" in
        2) NETWORK_MODE_INPUT="tls" ;;
        *) NETWORK_MODE_INPUT="lan" ;;
      esac
    fi
  fi
  [[ "$NETWORK_MODE_INPUT" == "lan" || "$NETWORK_MODE_INPUT" == "tls" ]] ||
    die "$(msg network_invalid)"

  choose_port
  if [[ "$NETWORK_MODE_INPUT" == "lan" ]]; then
    if [[ -z "$LAN_ADDRESS_INPUT" ]]; then
      if ((NON_INTERACTIVE)); then
        LAN_ADDRESS_INPUT="$(detect_lan_address || true)"
        [[ -n "$LAN_ADDRESS_INPUT" ]] || die "$(msg lan_required)"
      else
        detected_lan_address="$(detect_lan_address || true)"
        lan_prompt_default="${detected_lan_address:-$(if [[ "$LANGUAGE_INPUT" == en ]]; then printf 'enter a private IP'; else printf '请输入私网IP'; fi)}"
        LAN_ADDRESS_INPUT="$(prompt_value "$(msg lan_address_prompt "$lan_prompt_default")")"
        [[ -n "$LAN_ADDRESS_INPUT" ]] || LAN_ADDRESS_INPUT="$detected_lan_address"
      fi
    fi
    validate_lan_address "$LAN_ADDRESS_INPUT"
    APP_DOMAIN_INPUT="lan.local"
    TLS_EMAIL_INPUT="crewqual-local@lan.invalid"
    APP_ORIGIN_VALUE="http://${LAN_ADDRESS_INPUT}:${APP_PORT_INPUT}"
    CADDY_SITE_ADDRESS_VALUE="http://:${APP_PORT_INPUT}"
    APP_BIND_VALUE="0.0.0.0"
    ACME_BIND_VALUE="127.0.0.1"
    ACME_PORT_VALUE="18080"
    if ! port_is_available "$ACME_PORT_VALUE"; then
      ACME_PORT_VALUE="$(random_free_port)"
    fi
  else
    [[ -n "$APP_DOMAIN_INPUT" ]] || {
      ((NON_INTERACTIVE)) && die "$(msg tls_domain_required)"
      APP_DOMAIN_INPUT="$(prompt_value "$(msg tls_domain_prompt)")"
    }
    [[ -n "$TLS_EMAIL_INPUT" ]] || {
      ((NON_INTERACTIVE)) && die "$(msg tls_email_required)"
      TLS_EMAIL_INPUT="$(prompt_value "$(msg tls_email_prompt)")"
    }
    validate_domain "$APP_DOMAIN_INPUT"
    validate_email "$TLS_EMAIL_INPUT"
    APP_ORIGIN_VALUE="https://${APP_DOMAIN_INPUT}"
    CADDY_SITE_ADDRESS_VALUE="$APP_DOMAIN_INPUT"
    if [[ "$APP_PORT_INPUT" != 443 ]]; then
      APP_ORIGIN_VALUE="https://${APP_DOMAIN_INPUT}:${APP_PORT_INPUT}"
      CADDY_SITE_ADDRESS_VALUE="${APP_DOMAIN_INPUT}:${APP_PORT_INPUT}"
    fi
    APP_BIND_VALUE="0.0.0.0"
    ACME_BIND_VALUE="0.0.0.0"
    ACME_PORT_VALUE="80"
  fi
}

prompt_value() {
  local prompt="$1"
  local result=""
  [[ -r /dev/tty ]] || die "$(msg no_tty)"
  read -r -p "$prompt" result </dev/tty
  printf '%s' "$result"
}

env_value() {
  local key="$1" source="$ENV_FILE"
  local line=""
  if [[ -f "$TEMP_DIR/env.updated" ]]; then
    source="$TEMP_DIR/env.updated"
  fi
  [[ -f "$source" ]] || { printf ''; return 0; }
  line="$(sed -n "s/^${key}=//p" "$source" | tail -n 1)"
  line="${line#\'}"
  line="${line%\'}"
  printf '%s' "$line"
}

select_language() {
  local saved_language="" choice=""
  if [[ -z "$LANGUAGE_INPUT" && -f "$ENV_FILE" ]]; then
    saved_language="$(env_value INSTALL_LANGUAGE)"
    [[ "$saved_language" == "zh" || "$saved_language" == "en" ]] && LANGUAGE_INPUT="$saved_language"
  fi
  if [[ -z "$LANGUAGE_INPUT" ]]; then
    if ((NON_INTERACTIVE)); then
      LANGUAGE_INPUT="zh"
    else
      choice="$(prompt_value "$(msg language_prompt)")"
      case "$choice" in
        2|en|EN|En|e|E) LANGUAGE_INPUT="en" ;;
        *) LANGUAGE_INPUT="zh" ;;
      esac
    fi
  fi
  [[ "$LANGUAGE_INPUT" == "zh" || "$LANGUAGE_INPUT" == "en" ]] ||
    die "$(msg invalid_language "$LANGUAGE_INPUT")"
}

resolve_release_version() {
  local effective_url=""
  if [[ -n "$RELEASE_VERSION" ]]; then
    validate_version "$RELEASE_VERSION"
    return
  fi
  log "$(msg resolve_latest)"
  effective_url="$(curl -fsSL -o /dev/null -w '%{url_effective}' \
    "https://github.com/${GITHUB_REPOSITORY}/releases/latest")"
  RELEASE_VERSION="${effective_url%/}"
  RELEASE_VERSION="${RELEASE_VERSION##*/}"
  validate_version "$RELEASE_VERSION"
  echo "$(msg latest_version "$RELEASE_VERSION")"
}

manifest_value() {
  local key="$1"
  sed -nE "s/.*\"${key}\"[[:space:]]*:[[:space:]]*\"([^\"]+)\".*/\1/p" "$TEMP_DIR/update-manifest-v1.json" | head -n 1
}

verify_release_manifest() {
  local trusted key_raw key_der key_pem signature_raw
  trusted="$(env_value CREWQUAL_UPDATER_TRUSTED_PUBLIC_KEY)"
  [[ -n "$trusted" ]] || die "$(msg trusted_key_missing)"
  key_raw="$TEMP_DIR/updater-public-key.raw"
  key_der="$TEMP_DIR/updater-public-key.der"
  key_pem="$TEMP_DIR/updater-public-key.pem"
  signature_raw="$TEMP_DIR/update-manifest-v1.sig.raw"
  printf '%s' "$trusted" | base64 --decode >"$key_raw" 2>/dev/null || die "$(msg key_base64)"
  [[ "$(wc -c <"$key_raw")" -eq 32 ]] || die "$(msg key_length)"
  {
    printf '%s' '302a300506032b6570032100' | xxd -r -p
    cat "$key_raw"
  } >"$key_der"
  openssl pkey -pubin -inform DER -in "$key_der" -out "$key_pem" >/dev/null 2>&1 ||
    die "$(msg key_parse)"
  printf '%s' "$(tr -d '[:space:]' <"$TEMP_DIR/update-manifest-v1.sig")" | base64 --decode >"$signature_raw" 2>/dev/null ||
    die "$(msg signature_base64)"
  openssl pkeyutl -verify -pubin -inkey "$key_pem" -rawin \
    -in "$TEMP_DIR/update-manifest-v1.json" -sigfile "$signature_raw" >/dev/null 2>&1 ||
    die "$(msg signature_invalid)"
  local compose_expected caddy_expected
  compose_expected="$(manifest_value composeSha256)"
  caddy_expected="$(manifest_value caddySha256)"
  [[ "$compose_expected" =~ ^[a-fA-F0-9]{64}$ && "$caddy_expected" =~ ^[a-fA-F0-9]{64}$ ]] ||
    die "$(msg manifest_sha_missing)"
  [[ "$(sha256sum "$TEMP_DIR/compose.yaml" | awk '{print $1}')" == "$compose_expected" ]] ||
    die "$(msg compose_sha_invalid)"
  [[ "$(sha256sum "$TEMP_DIR/Caddyfile" | awk '{print $1}')" == "$caddy_expected" ]] ||
    die "$(msg caddy_sha_invalid)"
  local network_expected
  network_expected="$(manifest_value configureDomainSha256)"
  if [[ -n "$network_expected" ]]; then
    [[ "$network_expected" =~ ^[a-fA-F0-9]{64}$ ]] || die "$(msg configure_sha_invalid)"
    [[ -s "$TEMP_DIR/configure-domain.sh" ]] || die "$(msg configure_missing)"
    [[ "$(sha256sum "$TEMP_DIR/configure-domain.sh" | awk '{print $1}')" == "$network_expected" ]] ||
      die "$(msg configure_sha_failed)"
  fi
}

download_release_files() {
  local raw_base="https://raw.githubusercontent.com/${GITHUB_REPOSITORY}/${RELEASE_VERSION}"
  local release_base="https://github.com/${GITHUB_REPOSITORY}/releases/download/${RELEASE_VERSION}"
  TEMP_DIR="$(mktemp -d)"
  log "$(msg download_manifest "$RELEASE_VERSION")"
  curl -fsSL --retry 3 --retry-all-errors \
    "$release_base/update-manifest-v1.json" -o "$TEMP_DIR/update-manifest-v1.json"
  curl -fsSL --retry 3 --retry-all-errors \
    "$release_base/update-manifest-v1.json.sig" -o "$TEMP_DIR/update-manifest-v1.sig"
  curl -fsSL --retry 3 --retry-all-errors \
    "$raw_base/docker-compose.install.yml" -o "$TEMP_DIR/compose.yaml"
  curl -fsSL --retry 3 --retry-all-errors \
    "$raw_base/Caddyfile" -o "$TEMP_DIR/Caddyfile"
  if [[ -n "$(manifest_value configureDomainSha256)" ]]; then
    curl -fsSL --retry 3 --retry-all-errors \
      "$raw_base/scripts/configure-domain.sh" -o "$TEMP_DIR/configure-domain.sh"
  fi
  [[ -s "$TEMP_DIR/compose.yaml" && -s "$TEMP_DIR/Caddyfile" ]] || die "$(msg deployment_empty)"
}

write_initial_env() {
  local postgres_password session_secret settings_key minio_user minio_password updater_secret backup_key network_secret trusted_public_key setup_auth_code setup_auth_hash setup_auth_random
  postgres_password="$(openssl rand -hex 32)"
  session_secret="$(openssl rand -hex 48)"
  settings_key="$(openssl rand -hex 32)"
  minio_user="crewqual-$(openssl rand -hex 8)"
  minio_password="$(openssl rand -hex 32)"
  updater_secret="$(openssl rand -hex 32)"
  backup_key="$(openssl rand -hex 32)"
  network_secret="$(openssl rand -hex 32)"
  setup_auth_random="$(openssl rand -hex 4)"
  setup_auth_code="$(printf '%08d' "$((16#$setup_auth_random % 100000000))")"
  setup_auth_hash="$(printf '%s' "$setup_auth_code" | sha256sum | awk '{print $1}')"
  SETUP_AUTH_CODE_DISPLAY="$setup_auth_code"
  trusted_public_key="${CREWQUAL_UPDATER_TRUSTED_PUBLIC_KEY:-}"
  [[ -n "$trusted_public_key" ]] || die "$(msg trusted_key_required)"

  umask 077
  {
    printf "CREWQUAL_VERSION='%s'\n" "$RELEASE_VERSION"
    printf "CREWQUAL_WEB_IMAGE='ghcr.io/flightdan/crewqual-web:%s'\nCREWQUAL_RUNTIME_IMAGE='ghcr.io/flightdan/crewqual-runtime:%s'\n" "$RELEASE_VERSION" "$RELEASE_VERSION"
    printf "CREWQUAL_UPDATER_SOCKET='/run/crewqual-updater/api.sock'\nCREWQUAL_UPDATER_SHARED_SECRET='%s'\nCREWQUAL_UPDATER_BACKUP_KEY='%s'\nCREWQUAL_UPDATER_TRUSTED_PUBLIC_KEY='%s'\n" "$updater_secret" "$backup_key" "$trusted_public_key"
    printf "INSTALL_LANGUAGE='%s'\n" "$LANGUAGE_INPUT"
    printf '%s\n' "NODE_ENV=production" "SERVICE_MODE=remote" "NEXT_PUBLIC_SERVICE_MODE=remote"
    printf "APP_ORIGIN='%s'\nAPP_DOMAIN='%s'\nTLS_EMAIL='%s'\n" \
      "$APP_ORIGIN_VALUE" "$APP_DOMAIN_INPUT" "$TLS_EMAIL_INPUT"
    printf "DEPLOYMENT_NETWORK_MODE='%s'\nAPP_PORT='%s'\nCADDY_SITE_ADDRESS='%s'\nAPP_BIND='%s'\nACME_BIND='%s'\nACME_PORT='%s'\nNETWORK_ACCESS_SECRET='%s'\n" \
      "$NETWORK_MODE_INPUT" "$APP_PORT_INPUT" "$CADDY_SITE_ADDRESS_VALUE" "$APP_BIND_VALUE" "$ACME_BIND_VALUE" "$ACME_PORT_VALUE" "$network_secret"
    printf "POSTGRES_PASSWORD='%s'\n" "$postgres_password"
    printf "DATABASE_URL='postgresql://crewqual:%s@postgres:5432/crewqual'\n" "$postgres_password"
    printf "DIRECT_URL='postgresql://crewqual:%s@postgres:5432/crewqual'\n" "$postgres_password"
    printf "SESSION_SECRET='%s'\nSETTINGS_ENCRYPTION_KEY='%s'\n" "$session_secret" "$settings_key"
    printf '%s\n' "PILOT_SESSION_TTL_MINUTES=60" "ADMIN_SESSION_TTL_HOURS=8" "TRUSTED_PROXY_HOPS=1"
    printf '%s\n' "STORAGE_MODE=builtin" "S3_ENDPOINT=http://minio:9000" "S3_REGION=us-east-1"
    printf '%s\n' "S3_BUCKET=crewqual-private" "S3_FORCE_PATH_STYLE=true" "S3_SSE_KMS_KEY_ID="
    printf "S3_ACCESS_KEY_ID='%s'\nS3_SECRET_ACCESS_KEY='%s'\n" "$minio_user" "$minio_password"
    printf "MINIO_ROOT_USER='%s'\nMINIO_ROOT_PASSWORD='%s'\n" "$minio_user" "$minio_password"
    printf '%s\n' "SMS_ADAPTER=disabled" "SMS_WEBHOOK_URL=" "SMS_WEBHOOK_AUTH_TOKEN=" \
      "SMS_RECEIPT_WEBHOOK_SECRET=" "FEISHU_ADAPTER=disabled" "FEISHU_WEBHOOK_URL=" \
      "FEISHU_WEBHOOK_AUTH_TOKEN=" "VLM_ADAPTER=disabled"
    printf '%s\n' "QWEN_BASE_URL=http://host.docker.internal:8000/v1" "QWEN_MODEL=Qwen3.7-35B"
    printf '%s\n' "INITIAL_ADMIN_EMAIL=" "INITIAL_ADMIN_PASSWORD=" "INITIAL_ADMIN_TOTP_SECRET="
    printf "SETUP_AUTH_CODE_HASH='%s'\n" "$setup_auth_hash"
  } >"$TEMP_DIR/env.updated"
  chmod 600 "$TEMP_DIR/env.updated"
}

update_managed_version() {
  local replacement="$TEMP_DIR/env.updated"
  awk -v version="$RELEASE_VERSION" '
    BEGIN { replaced = 0 }
    /^CREWQUAL_VERSION=/ {
      if (!replaced) print "CREWQUAL_VERSION=\047" version "\047"
      replaced = 1
      next
    }
    { print }
    END { if (!replaced) print "CREWQUAL_VERSION=\047" version "\047" }
  ' "$ENV_FILE" >"$replacement"
  chmod 600 "$replacement"
}

ensure_env_key() {
  local key="$1" value="$2" replacement="$TEMP_DIR/env.updated"
  if ! grep -q "^${key}=" "$replacement"; then
    printf "%s='%s'\n" "$key" "$value" >>"$replacement"
  fi
}

generate_setup_auth_code() {
  local random_value code hash
  random_value="$(openssl rand -hex 4)"
  code="$(printf '%08d' "$((16#$random_value % 100000000))")"
  hash="$(printf '%s' "$code" | sha256sum | awk '{print $1}')"
  SETUP_AUTH_CODE_DISPLAY="$code"
  ensure_env_key SETUP_AUTH_CODE_HASH "$hash"
}

container_id() {
  compose ps -q "$1" 2>/dev/null | head -n 1
}

container_status() {
  docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$1" 2>/dev/null
}

wait_for_status() {
  local service="$1"
  local expected="$2"
  local deadline=$((SECONDS + WAIT_TIMEOUT_SECONDS))
  local id="" status=""
  log "$(msg wait_status "$service" "$expected")"
  while ((SECONDS < deadline)); do
    id="$(container_id "$service")"
    if [[ -n "$id" ]]; then
      status="$(container_status "$id" || true)"
      if [[ "$status" == "$expected" ]]; then
        echo "$service: $status"
        return 0
      fi
      if [[ "$status" == "exited" || "$status" == "dead" || "$status" == "unhealthy" ]]; then
        echo "$(msg service_status_bad "$service" "$status")" >&2
        return 1
      fi
    fi
    sleep 3
  done
  echo "$(msg service_status_timeout "$service" "$WAIT_TIMEOUT_SECONDS" "$expected")" >&2
  return 1
}

wait_for_completion() {
  local service="$1"
  local deadline=$((SECONDS + WAIT_TIMEOUT_SECONDS))
  local id="" status="" exit_code=""
  log "$(msg wait_complete "$service")"
  while ((SECONDS < deadline)); do
    id="$(container_id "$service")"
    if [[ -n "$id" ]]; then
      status="$(docker inspect --format '{{.State.Status}}' "$id" 2>/dev/null || true)"
      if [[ "$status" == "exited" ]]; then
        exit_code="$(docker inspect --format '{{.State.ExitCode}}' "$id" 2>/dev/null || true)"
        if [[ "$exit_code" != "0" ]]; then
          echo "$(msg service_failed "$service" "${exit_code:-unknown}")" >&2
          return 1
        fi
        echo "$service: completed"
        return 0
      fi
      if [[ "$status" == "dead" ]]; then
        echo "$(msg service_dead "$service")" >&2
        return 1
      fi
    fi
    sleep 2
  done
  echo "$(msg service_timeout "$service" "$WAIT_TIMEOUT_SECONDS")" >&2
  return 1
}

install_updater() {
  [[ "${CREWQUAL_INSTALL_TEST_MODE:-0}" == "1" ]] && return 0
  if ! command -v systemctl >/dev/null 2>&1; then
    echo "$(msg systemd_missing)" >&2
    return 1
  fi
  local arch asset_url tmp expected actual target shared backup trusted
  case "$(uname -m)" in
    x86_64|amd64) arch="amd64" ;;
    aarch64|arm64) arch="arm64" ;;
    *) echo "$(msg arch_unsupported)" >&2; return 1 ;;
  esac
  if [[ -n "${CREWQUAL_UPDATER_BINARY_URL:-}" ]]; then
    asset_url="$CREWQUAL_UPDATER_BINARY_URL"
  else
    asset_url="https://github.com/${GITHUB_REPOSITORY}/releases/download/${RELEASE_VERSION}/crewqual-updater-linux-${arch}"
  fi
  tmp="$TEMP_DIR/crewqual-updater"
  if ! curl -fsSL --retry 3 --retry-all-errors "$asset_url" -o "$tmp"; then
    echo "$(msg updater_download_failed)" >&2
    return 1
  fi
  [[ -s "$tmp" ]] || { echo "$(msg updater_empty)" >&2; return 1; }
  expected="$(manifest_value "$arch")"
  [[ "$expected" =~ ^[a-fA-F0-9]{64}$ ]] || { echo "$(msg updater_hash_missing "$arch")" >&2; return 1; }
  actual="$(sha256sum "$tmp" | awk '{print $1}')"
  [[ "$expected" =~ ^[a-fA-F0-9]{64}$ && "$expected" == "$actual" ]] || { echo "$(msg updater_checksum)" >&2; return 1; }
  target="$UPDATER_BINARY_DIR/crewqual-updater"
  install -d -m 0755 "$UPDATER_BINARY_DIR" "$UPDATER_CONFIG_DIR" "$UPDATER_DATA_DIR" /run/crewqual-updater
  install -m 0755 "$tmp" "$target"
  shared="$(env_value CREWQUAL_UPDATER_SHARED_SECRET)"
  backup="$(env_value CREWQUAL_UPDATER_BACKUP_KEY)"
  trusted="$(env_value CREWQUAL_UPDATER_TRUSTED_PUBLIC_KEY)"
  [[ -n "$trusted" ]] || { echo "$(msg updater_trust_missing)" >&2; return 1; }
  umask 077
  printf '{"installDir":"%s","dataDir":"%s","composeFile":"%s","envFile":"%s","caddyFile":"%s","socket":"/run/crewqual-updater/api.sock","sharedSecret":"%s","backupKey":"%s","trustedPublicKey":"%s","manifestURL":"https://github.com/%s/releases/latest/download/update-manifest-v1.json","updaterVersion":"%s"}\n' \
    "$INSTALL_DIR" "$UPDATER_DATA_DIR" "$COMPOSE_FILE" "$ENV_FILE" "$INSTALL_DIR/Caddyfile" "$shared" "$backup" "$trusted" "$GITHUB_REPOSITORY" "${RELEASE_VERSION#v}" >"$UPDATER_CONFIG_DIR/config.json"
  chmod 600 "$UPDATER_CONFIG_DIR/config.json"
  cat >"$UPDATER_CONFIG_DIR/crewqual-updater.service" <<EOF
[Unit]
Description=CrewQual host update controller
After=docker.service
Requires=docker.service

[Service]
Type=simple
ExecStart=$target serve
Restart=on-failure
RestartSec=3
User=root
UMask=0077
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=$INSTALL_DIR $UPDATER_DATA_DIR /run/crewqual-updater
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
  install -m 0644 "$UPDATER_CONFIG_DIR/crewqual-updater.service" /etc/systemd/system/crewqual-updater.service
  cat >"$UPDATER_CONFIG_DIR/crewqual-updater.socket" <<EOF
[Unit]
Description=CrewQual updater API socket

[Socket]
ListenStream=/run/crewqual-updater/api.sock
SocketMode=0666
DirectoryMode=0750
RemoveOnStop=true

[Install]
WantedBy=sockets.target
EOF
  install -m 0644 "$UPDATER_CONFIG_DIR/crewqual-updater.socket" /etc/systemd/system/crewqual-updater.socket
  systemctl daemon-reload
  systemctl enable --now crewqual-updater.socket crewqual-updater.service || {
    echo "$(msg updater_start_failed)" >&2
    return 1
  }
}

while (($# > 0)); do
  case "$1" in
    --version)
      (($# >= 2)) || die "$(msg missing_option_value --version)"
      RELEASE_VERSION="$2"
      shift 2
      ;;
    --domain)
      (($# >= 2)) || die "$(msg missing_option_value --domain)"
      APP_DOMAIN_INPUT="$2"
      shift 2
      ;;
    --tls-email)
      (($# >= 2)) || die "$(msg missing_option_value --tls-email)"
      TLS_EMAIL_INPUT="$2"
      shift 2
      ;;
    --network-mode)
      (($# >= 2)) || die "$(msg missing_option_value --network-mode)"
      NETWORK_MODE_INPUT="$2"
      shift 2
      ;;
    --lan-address)
      (($# >= 2)) || die "$(msg missing_option_value --lan-address)"
      LAN_ADDRESS_INPUT="$2"
      shift 2
      ;;
    --port)
      (($# >= 2)) || die "$(msg missing_option_value --port)"
      APP_PORT_INPUT="$2"
      PORT_SELECTION="custom"
      shift 2
      ;;
    --random-port)
      PORT_SELECTION="random"
      shift
      ;;
    --language)
      (($# >= 2)) || die "$(msg missing_option_value --language)"
      LANGUAGE_INPUT="$2"
      shift 2
      ;;
    --non-interactive)
      NON_INTERACTIVE=1
      shift
      ;;
    --no-pull)
      PULL_IMAGES=0
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage >&2
      die "$(msg unknown_option "$1")"
      ;;
  esac
done

ENV_FILE="$INSTALL_DIR/.env"
COMPOSE_FILE="$INSTALL_DIR/compose.yaml"
select_language

[[ "$(uname -s)" == "Linux" ]] || die "$(msg linux_only)"
if [[ "$EUID" -ne 0 && "${CREWQUAL_INSTALL_TEST_MODE:-0}" != "1" ]]; then
  die "$(msg run_as_root "$INSTALL_DIR")"
fi
[[ "$WAIT_TIMEOUT_SECONDS" =~ ^[1-9][0-9]*$ ]] || die "$(msg timeout_invalid)"
[[ "$INSTALL_DIR" == /* && "$INSTALL_DIR" != "/" ]] || die "$(msg install_dir_invalid)"

require_command curl
require_command docker
require_command openssl
require_command awk
require_command sed
require_command mktemp
require_command install
require_command sha256sum
require_command base64
require_command xxd
require_command hostname

docker info >/dev/null 2>&1 || die "$(msg compose_unavailable)"
docker compose version >/dev/null 2>&1 || die "$(msg compose_plugin_missing)"

trap cleanup EXIT
trap on_error ERR

resolve_release_version
download_release_files

mkdir -p -- "$INSTALL_DIR"
if [[ ! -e "$INSTALL_DIR/.crewqual-official-install" ]]; then
  install -m 0644 /dev/null "$INSTALL_DIR/.crewqual-official-install"
fi
if [[ -f "$ENV_FILE" ]]; then
  EXISTING_INSTALL=1
  [[ ! -L "$ENV_FILE" ]] || die "$(msg env_symlink)"
  existing_domain="$(env_value APP_DOMAIN)"
  existing_tls_email="$(env_value TLS_EMAIL)"
  existing_mode="$(env_value DEPLOYMENT_NETWORK_MODE)"
  existing_port="$(env_value APP_PORT)"
  if [[ -z "$existing_mode" ]]; then
    [[ "$(env_value APP_ORIGIN)" == http:* ]] && existing_mode="lan" || existing_mode="tls"
  fi
  if [[ -n "$NETWORK_MODE_INPUT" && "$NETWORK_MODE_INPUT" != "$existing_mode" ]]; then
    die "$(msg existing_mode "$existing_mode")"
  fi
  if [[ -n "$APP_PORT_INPUT" && -n "$existing_port" && "$APP_PORT_INPUT" != "$existing_port" ]]; then
    die "$(msg existing_port "$existing_port")"
  fi
  if [[ -n "$APP_DOMAIN_INPUT" && "$APP_DOMAIN_INPUT" != "$existing_domain" ]]; then
    die "$(msg existing_domain "$existing_domain")"
  fi
  if [[ -n "$TLS_EMAIL_INPUT" && "$TLS_EMAIL_INPUT" != "$existing_tls_email" ]]; then
    die "$(msg existing_email "$existing_tls_email")"
  fi
  APP_DOMAIN_INPUT="$existing_domain"
  TLS_EMAIL_INPUT="$existing_tls_email"
  NETWORK_MODE_INPUT="$existing_mode"
  APP_PORT_INPUT="${existing_port:-443}"
  APP_ORIGIN_VALUE="$(env_value APP_ORIGIN)"
  CADDY_SITE_ADDRESS_VALUE="$(env_value CADDY_SITE_ADDRESS)"
  [[ -n "$CADDY_SITE_ADDRESS_VALUE" ]] || CADDY_SITE_ADDRESS_VALUE="$APP_DOMAIN_INPUT"
  APP_BIND_VALUE="$(env_value APP_BIND)"
  [[ -n "$APP_BIND_VALUE" ]] || APP_BIND_VALUE="0.0.0.0"
  ACME_BIND_VALUE="$(env_value ACME_BIND)"
  [[ -n "$ACME_BIND_VALUE" ]] || ACME_BIND_VALUE="$([[ "$existing_mode" == "tls" ]] && printf '0.0.0.0' || printf '127.0.0.1')"
  ACME_PORT_VALUE="$(env_value ACME_PORT)"
  [[ -n "$ACME_PORT_VALUE" ]] || ACME_PORT_VALUE="$([[ "$existing_mode" == "tls" ]] && printf '80' || printf '18080')"
  validate_port "$APP_PORT_INPUT"
  if [[ "$existing_mode" == "tls" ]]; then
    validate_domain "$APP_DOMAIN_INPUT"
    validate_email "$TLS_EMAIL_INPUT"
  else
    validate_lan_address "$(printf '%s' "$APP_ORIGIN_VALUE" | sed -E 's#^http://([^:]+):.*#\1#')"
  fi
  update_managed_version
else
  prepare_network_config
  write_initial_env
fi

# Older official installs predate the updater/image variables. Add only missing
# keys and never replace existing secrets or user-managed image references.
if [[ -f "$TEMP_DIR/env.updated" ]]; then
  ensure_env_key CREWQUAL_WEB_IMAGE "ghcr.io/flightdan/crewqual-web:${RELEASE_VERSION}"
  ensure_env_key CREWQUAL_RUNTIME_IMAGE "ghcr.io/flightdan/crewqual-runtime:${RELEASE_VERSION}"
  ensure_env_key CREWQUAL_UPDATER_SOCKET "/run/crewqual-updater/api.sock"
  [[ -n "$(env_value CREWQUAL_UPDATER_SHARED_SECRET)" ]] || ensure_env_key CREWQUAL_UPDATER_SHARED_SECRET "$(openssl rand -hex 32)"
  [[ -n "$(env_value CREWQUAL_UPDATER_BACKUP_KEY)" ]] || ensure_env_key CREWQUAL_UPDATER_BACKUP_KEY "$(openssl rand -hex 32)"
  [[ -n "$(env_value CREWQUAL_UPDATER_TRUSTED_PUBLIC_KEY)" ]] || {
    [[ -n "${CREWQUAL_UPDATER_TRUSTED_PUBLIC_KEY:-}" ]] || die "$(msg deployment_unsigned)"
  ensure_env_key CREWQUAL_UPDATER_TRUSTED_PUBLIC_KEY "$CREWQUAL_UPDATER_TRUSTED_PUBLIC_KEY"
  }
  ensure_env_key INSTALL_LANGUAGE "$LANGUAGE_INPUT"
  ensure_env_key DEPLOYMENT_NETWORK_MODE "$NETWORK_MODE_INPUT"
  ensure_env_key APP_PORT "$APP_PORT_INPUT"
  ensure_env_key APP_ORIGIN "$APP_ORIGIN_VALUE"
  ensure_env_key APP_DOMAIN "$APP_DOMAIN_INPUT"
  ensure_env_key TLS_EMAIL "$TLS_EMAIL_INPUT"
  ensure_env_key CADDY_SITE_ADDRESS "$CADDY_SITE_ADDRESS_VALUE"
  ensure_env_key APP_BIND "$APP_BIND_VALUE"
  ensure_env_key ACME_BIND "$ACME_BIND_VALUE"
  ensure_env_key ACME_PORT "$ACME_PORT_VALUE"
  [[ -n "$(env_value NETWORK_ACCESS_SECRET)" ]] || ensure_env_key NETWORK_ACCESS_SECRET "$(openssl rand -hex 32)"
  [[ -n "$(env_value SETUP_AUTH_CODE_HASH)" ]] || generate_setup_auth_code
fi

verify_release_manifest

log "$(msg validate_manifest "$RELEASE_VERSION")"
docker compose --project-directory "$TEMP_DIR" --env-file "$TEMP_DIR/env.updated" \
  -f "$TEMP_DIR/compose.yaml" config --quiet

COMPOSE=(docker compose --project-directory "$INSTALL_DIR" --env-file "$ENV_FILE" -f "$COMPOSE_FILE")
if [[ "$EXISTING_INSTALL" == "1" ]]; then
  snapshot_existing_install
  create_upgrade_database_backup
fi

atomic_install "$TEMP_DIR/env.updated" "$ENV_FILE" 0600
atomic_install "$TEMP_DIR/compose.yaml" "$COMPOSE_FILE" 0644
atomic_install "$TEMP_DIR/Caddyfile" "$INSTALL_DIR/Caddyfile" 0644
if [[ -s "$TEMP_DIR/configure-domain.sh" ]]; then
  atomic_install "$TEMP_DIR/configure-domain.sh" "$INSTALL_DIR/configure-domain.sh" 0755
fi

install_updater

if ((PULL_IMAGES)); then
  log "$(msg pull_images "$RELEASE_VERSION")"
  compose pull
fi

log "$(msg start_minio)"
compose up -d minio minio-init
wait_for_completion minio-init

log "$(msg start_postgres)"
compose up -d postgres
wait_for_status postgres healthy

log "$(msg run_migrations)"
compose run --rm --no-deps migrate

log "$(msg run_bootstrap)"
compose run --rm --no-deps bootstrap

log "$(msg start_web_worker)"
compose up -d --no-deps web worker
wait_for_status web healthy
wait_for_status worker healthy

log "$(msg start_https)"
compose up -d --no-deps caddy
wait_for_status caddy running

log "$(msg deployment_complete "$RELEASE_VERSION")"
compose ps -a
echo
if [[ -n "$SETUP_AUTH_CODE_DISPLAY" ]]; then
  echo "$(msg setup_auth_code "$SETUP_AUTH_CODE_DISPLAY")"
  echo "$(msg setup_auth_warning)"
fi
echo "$(msg welcome "${APP_ORIGIN_VALUE}")"
echo "$(msg install_dir "$INSTALL_DIR")"
echo "$(msg view_logs "$INSTALL_DIR")"
echo "$(msg volume_warning)"
