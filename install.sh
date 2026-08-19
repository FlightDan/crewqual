#!/usr/bin/env bash
set -Eeuo pipefail

# CrewQual Docker Compose installer.
#
# This script prepares the application deployment only. It intentionally does
# not install Docker or modify firewall rules; those are host-level changes
# that should be handled by the organization's Linux provisioning process.

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"
WAIT_TIMEOUT_SECONDS="${CREWQUAL_INSTALL_TIMEOUT_SECONDS:-300}"
BUILD_PULL=1

COMPOSE=()

usage() {
  cat <<'EOF'
Usage: ./install.sh [options]

Deploy or upgrade CrewQual with Docker Compose.

Options:
  --no-pull     Do not pull updated base images during the application build.
  --non-interactive
                Fail when .env does not exist instead of starting the
                interactive environment initializer.
  -h, --help    Show this help.

Environment:
  CREWQUAL_INSTALL_TIMEOUT_SECONDS  Health-check timeout (default: 300).

The script never removes Docker volumes and never overwrites an existing .env.
For a first deployment, .env is created by scripts/init-docker-env.sh.
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

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "命令不可用: $1。请先安装 Docker Engine、Docker Compose plugin 和 openssl。"
}

compose() {
  "${COMPOSE[@]}" "$@"
}

compose_output() {
  "${COMPOSE[@]}" "$@"
}

container_id() {
  local service="$1"
  compose_output ps -q "$service" 2>/dev/null | head -n 1
}

container_status() {
  local id="$1"
  docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id" 2>/dev/null
}

wait_for_healthy() {
  local service="$1"
  local deadline=$((SECONDS + WAIT_TIMEOUT_SECONDS))
  local id=""
  local status=""

  log "等待 $service 健康"
  while (( SECONDS < deadline )); do
    id="$(container_id "$service")"
    if [[ -n "$id" ]]; then
      status="$(container_status "$id" || true)"
      if [[ "$status" == "healthy" ]]; then
        echo "$service: healthy"
        return 0
      fi
      if [[ "$status" == "exited" || "$status" == "dead" ]]; then
        echo "$service: $status" >&2
        return 1
      fi
    fi
    sleep 3
  done

  echo "$service 未在 ${WAIT_TIMEOUT_SECONDS}s 内变为 healthy" >&2
  return 1
}

wait_for_running() {
  local service="$1"
  local deadline=$((SECONDS + WAIT_TIMEOUT_SECONDS))
  local id=""
  local status=""

  log "等待 $service 启动"
  while (( SECONDS < deadline )); do
    id="$(container_id "$service")"
    if [[ -n "$id" ]]; then
      status="$(container_status "$id" || true)"
      if [[ "$status" == "running" ]]; then
        echo "$service: running"
        return 0
      fi
      if [[ "$status" == "exited" || "$status" == "dead" ]]; then
        echo "$service: $status" >&2
        return 1
      fi
    fi
    sleep 3
  done

  echo "$service 未在 ${WAIT_TIMEOUT_SECONDS}s 内启动" >&2
  return 1
}

show_diagnostics() {
  echo
  echo "--- docker compose ps -a ---" >&2
  compose ps -a >&2 || true
  echo "--- recent deployment logs ---" >&2
  compose logs --tail=100 postgres migrate bootstrap web worker caddy >&2 || true
}

on_error() {
  local exit_code=$?
  printf '\n部署失败（退出码: %s）。\n' "$exit_code" >&2
  show_diagnostics
  exit "$exit_code"
}

NON_INTERACTIVE=0
while (($# > 0)); do
  case "$1" in
    --no-pull)
      BUILD_PULL=0
      shift
      ;;
    --non-interactive)
      NON_INTERACTIVE=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage >&2
      die "未知参数: $1"
      ;;
  esac
done

[[ "$WAIT_TIMEOUT_SECONDS" =~ ^[1-9][0-9]*$ ]] || die "CREWQUAL_INSTALL_TIMEOUT_SECONDS 必须是正整数"

trap on_error ERR

cd "$SCRIPT_DIR"
[[ -f docker-compose.yml ]] || die "未找到 docker-compose.yml: $SCRIPT_DIR"
[[ -x scripts/init-docker-env.sh ]] || die "scripts/init-docker-env.sh 不存在或不可执行"

require_command docker
require_command openssl

docker info >/dev/null 2>&1 || die "无法连接 Docker daemon，或当前用户没有 Docker 权限"
docker compose version >/dev/null 2>&1 || die "Docker Compose plugin 不可用，请安装 Docker Compose v2"

if [[ ! -e "$ENV_FILE" ]]; then
  if (( NON_INTERACTIVE )); then
    die "未找到 .env；非交互模式请先准备 $ENV_FILE"
  fi
  [[ -t 0 ]] || die "当前没有交互式终端，无法生成 .env；请先准备 $ENV_FILE 或使用交互式终端"
  log "未找到 .env，开始生成生产配置"
  bash scripts/init-docker-env.sh
fi

[[ -f "$ENV_FILE" ]] || die "环境配置文件未生成: $ENV_FILE"
[[ ! -L "$ENV_FILE" ]] || die ".env 不能是符号链接，请使用实际文件"
chmod 600 "$ENV_FILE"

COMPOSE=(docker compose --project-directory "$SCRIPT_DIR" --env-file "$ENV_FILE")

log "校验 Docker Compose 配置"
compose config --quiet

log "构建 CrewQual 镜像"
if (( BUILD_PULL )); then
  compose build --pull
else
  compose build
fi

log "启动 PostgreSQL"
compose up -d postgres
wait_for_healthy postgres

log "执行数据库迁移"
compose run --rm --no-deps migrate

log "执行生产初始化"
compose run --rm --no-deps bootstrap

log "启动 CrewQual 服务"
compose up -d --no-deps web worker
wait_for_healthy web
wait_for_healthy worker
compose up -d --no-deps caddy
wait_for_running caddy

log "部署完成"
compose ps -a
echo
echo "请确认域名 DNS 已指向本机，并访问 .env 中的 APP_ORIGIN。"
echo "查看日志: docker compose logs -f --tail=200 web worker caddy"
echo "重要: 不要执行 docker compose down -v，否则会删除 PostgreSQL 数据卷。"
