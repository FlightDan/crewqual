#!/usr/bin/env bash
set -Eeuo pipefail

INSTALL_DIR="${CREWQUAL_INSTALL_DIR:-/opt/crewqual}"
ENV_FILE="$INSTALL_DIR/.env"
COMPOSE_FILE="$INSTALL_DIR/compose.yaml"
DOMAIN=""
TLS_EMAIL=""
PORT=""
TLS_CERT=""
TLS_KEY=""
AUTO_TLS=0
RANDOM_PORT=0
NON_INTERACTIVE=0
TEMP_DIR=""
COMPOSE=()

die() { echo "configure-domain.sh: $*" >&2; exit 1; }
log() { echo; echo "==> $*"; }

usage() {
  cat <<'EOF'
Usage: configure-domain.sh [options]
  --domain HOSTNAME   Public domain name.
  --tls-email EMAIL   ACME/TLS contact email.
  --tls-cert FILE     Use an existing PEM certificate/full chain instead of ACME.
  --tls-key FILE      Use the matching unencrypted PEM private key.
  --auto-tls          Use Caddy ACME automatic certificate management.
  --port PORT         HTTPS application port (default: 8080).
  --random-port       Select a free high port.
  --non-interactive   Fail instead of prompting.
EOF
}

env_value() {
  local key="$1"
  sed -n "s/^${key}=//p" "$ENV_FILE" | tail -n 1 | sed "s/^'//; s/'$//"
}

set_env_value() {
  local source="$1" target="$2" key="$3" value="$4"
  awk -v key="$key" -v value="$value" '
    BEGIN { found = 0; quote = sprintf("%c", 39) }
    $0 ~ ("^" key "=") {
      print key "=" quote value quote
      found = 1
      next
    }
    { print }
    END { if (!found) print key "=" quote value quote }
  ' "$source" >"$target"
}

validate_domain() {
  [[ "$1" =~ ^([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$ ]] ||
    die "域名格式无效: $1"
}
validate_email() {
  [[ "$1" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]] || die "TLS 邮箱格式无效: $1"
}
validate_port() {
  [[ "$1" =~ ^[0-9]+$ && "$1" -ge 1 && "$1" -le 65535 && "$1" != 80 ]] ||
    die "TLS 应用端口必须是 1-65535 且不能是 80: $1"
}

validate_custom_tls() {
  [[ -n "$TLS_CERT" && -n "$TLS_KEY" ]] || die "自有证书模式必须同时传入 --tls-cert 和 --tls-key"
  [[ -f "$TLS_CERT" && -r "$TLS_CERT" ]] || die "证书文件不可读或不存在: $TLS_CERT"
  [[ -f "$TLS_KEY" && -r "$TLS_KEY" ]] || die "私钥文件不可读或不存在: $TLS_KEY"
  openssl x509 -in "$TLS_CERT" -noout >/dev/null 2>&1 || die "证书不是有效的 PEM X.509 证书: $TLS_CERT"
  openssl pkey -in "$TLS_KEY" -passin pass: -noout >/dev/null 2>&1 || die "私钥必须是可用的未加密 PEM 私钥: $TLS_KEY"
  openssl x509 -in "$TLS_CERT" -checkend 0 -noout >/dev/null 2>&1 || die "证书已过期: $TLS_CERT"
  openssl x509 -in "$TLS_CERT" -checkhost "$DOMAIN" -noout >/dev/null 2>&1 || die "证书不包含域名 $DOMAIN"

  cert_public="$(openssl x509 -in "$TLS_CERT" -pubkey -noout | openssl pkey -pubin -outform DER 2>/dev/null | sha256sum | awk '{print $1}')" ||
    die "证书公钥无法读取"
  key_public="$(openssl pkey -in "$TLS_KEY" -passin pass: -pubout -outform DER 2>/dev/null | sha256sum | awk '{print $1}')" ||
    die "私钥公钥无法读取"
  [[ -n "$cert_public" && "$cert_public" == "$key_public" ]] || die "证书与私钥不匹配"
}
port_is_available() {
  local port="$1" current="$(env_value APP_PORT || true)"
  [[ "$port" == "$current" ]] && return 0
  ! ss -H -ltn 2>/dev/null | awk -v suffix=":$port" '$4 ~ suffix "$" { found = 1 } END { exit found ? 0 : 1 }'
}
random_free_port() {
  local candidate
  for _ in $(seq 1 100); do
    candidate=$((10000 + RANDOM % 50000))
    port_is_available "$candidate" && { printf '%s' "$candidate"; return; }
  done
  die "找不到空闲 TLS 端口"
}
prompt_missing() {
  [[ -n "$DOMAIN" ]] || { ((NON_INTERACTIVE)) && die "必须传入 --domain"; read -r -p "公网域名: " DOMAIN </dev/tty; }
  if [[ -z "$TLS_CERT" && -z "$TLS_KEY" ]]; then
    [[ -n "$TLS_EMAIL" ]] || { ((NON_INTERACTIVE)) && die "必须传入 --tls-email"; read -r -p "TLS 通知邮箱: " TLS_EMAIL </dev/tty; }
  else
    [[ -z "$TLS_EMAIL" ]] && TLS_EMAIL="crewqual-local@lan.invalid"
  fi
  if [[ -z "$PORT" ]]; then
    if ((RANDOM_PORT)); then PORT="$(random_free_port)"
    elif ((NON_INTERACTIVE)); then PORT=8080
    else
      local choice
      read -r -p "TLS 访问端口 [1=默认8080, 2=随机可用, 3=自定义]: " choice </dev/tty
      case "$choice" in
        2) PORT="$(random_free_port)" ;;
        3) read -r -p "TLS 访问端口: " PORT </dev/tty ;;
        *) PORT=8080 ;;
      esac
    fi
  fi
}
cleanup() { [[ -n "$TEMP_DIR" && -d "$TEMP_DIR" ]] && rm -rf -- "$TEMP_DIR"; }
trap cleanup EXIT

while (($#)); do
  case "$1" in
    --domain) (($# >= 2)) || die "--domain 缺少参数"; DOMAIN="$2"; shift 2 ;;
    --tls-email) (($# >= 2)) || die "--tls-email 缺少参数"; TLS_EMAIL="$2"; shift 2 ;;
    --tls-cert) (($# >= 2)) || die "--tls-cert 缺少参数"; TLS_CERT="$2"; shift 2 ;;
    --tls-key) (($# >= 2)) || die "--tls-key 缺少参数"; TLS_KEY="$2"; shift 2 ;;
    --auto-tls) AUTO_TLS=1; shift ;;
    --port) (($# >= 2)) || die "--port 缺少参数"; PORT="$2"; shift 2 ;;
    --random-port) RANDOM_PORT=1; shift ;;
    --non-interactive) NON_INTERACTIVE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; die "未知参数: $1" ;;
  esac
done

[[ "$EUID" -eq 0 ]] || die "请使用 sudo 运行"
command -v docker >/dev/null 2>&1 || die "命令不可用: docker"
command -v ss >/dev/null 2>&1 || die "命令不可用: ss"
command -v curl >/dev/null 2>&1 || die "命令不可用: curl"
command -v openssl >/dev/null 2>&1 || die "命令不可用: openssl"
[[ -f "$ENV_FILE" && -f "$COMPOSE_FILE" ]] || die "不是有效的 CrewQual 安装目录: $INSTALL_DIR"
if ((AUTO_TLS)) && [[ -n "$TLS_CERT" || -n "$TLS_KEY" ]]; then
  die "--auto-tls 不能与 --tls-cert/--tls-key 同时使用"
fi
prompt_missing
validate_domain "$DOMAIN"
validate_email "$TLS_EMAIL"
validate_port "$PORT"
port_is_available "$PORT" || die "TLS 访问端口已被占用: $PORT"

current_tls_config="$(env_value CADDY_TLS_CONFIG || true)"
if [[ -n "$TLS_CERT" || -n "$TLS_KEY" ]]; then
  validate_custom_tls
  tls_config='tls /etc/caddy/tls/fullchain.pem /etc/caddy/tls/privkey.pem'
elif ((AUTO_TLS)); then
  tls_config=""
else
  tls_config="$current_tls_config"
fi
if [[ -n "$tls_config" && -z "$TLS_CERT" && ! -s "$INSTALL_DIR/tls/fullchain.pem" ]]; then
  die "已配置自有证书，但安装目录缺少证书文件，请重新传入 --tls-cert 和 --tls-key"
fi
if [[ -n "$tls_config" && -z "$TLS_CERT" && ! -s "$INSTALL_DIR/tls/privkey.pem" ]]; then
  die "已配置自有证书，但安装目录缺少私钥文件，请重新传入 --tls-cert 和 --tls-key"
fi

TEMP_DIR="$(mktemp -d)"
STAGED_ENV="$TEMP_DIR/.env"
cp -- "$ENV_FILE" "$TEMP_DIR/previous.env"
cp -- "$ENV_FILE" "$STAGED_ENV"
origin="https://$DOMAIN"
site="$DOMAIN"
if [[ "$PORT" != 443 ]]; then origin="https://$DOMAIN:$PORT"; site="$DOMAIN:$PORT"; fi

for entry in \
  "DEPLOYMENT_NETWORK_MODE|tls" "APP_ORIGIN|$origin" "APP_DOMAIN|$DOMAIN" \
  "TLS_EMAIL|$TLS_EMAIL" "APP_PORT|$PORT" "CADDY_SITE_ADDRESS|$site" \
  "CADDY_TLS_CONFIG|$tls_config" "CADDY_EMAIL_CONFIG|$(if [[ -n "$tls_config" ]]; then printf ''; else printf 'email %s' "$TLS_EMAIL"; fi)" \
  "APP_BIND|0.0.0.0" "ACME_BIND|0.0.0.0" "ACME_PORT|80"; do
  key="${entry%%|*}"; value="${entry#*|}"
  set_env_value "$STAGED_ENV" "$STAGED_ENV.next" "$key" "$value"
  mv -- "$STAGED_ENV.next" "$STAGED_ENV"
done

install -d -m 0700 "$INSTALL_DIR/tls"
if [[ -n "$TLS_CERT" ]]; then
  if [[ ! -f "$INSTALL_DIR/tls/fullchain.pem" ]] || ! cmp -s "$TLS_CERT" "$INSTALL_DIR/tls/fullchain.pem"; then
    install -m 0644 "$TLS_CERT" "$INSTALL_DIR/tls/fullchain.pem"
  else
    chmod 0644 "$INSTALL_DIR/tls/fullchain.pem"
  fi
  if [[ ! -f "$INSTALL_DIR/tls/privkey.pem" ]] || ! cmp -s "$TLS_KEY" "$INSTALL_DIR/tls/privkey.pem"; then
    install -m 0600 "$TLS_KEY" "$INSTALL_DIR/tls/privkey.pem"
  else
    chmod 0600 "$INSTALL_DIR/tls/privkey.pem"
  fi
else
  [[ -e "$INSTALL_DIR/tls/fullchain.pem" ]] || install -m 0644 /dev/null "$INSTALL_DIR/tls/fullchain.pem"
  [[ -e "$INSTALL_DIR/tls/privkey.pem" ]] || install -m 0600 /dev/null "$INSTALL_DIR/tls/privkey.pem"
fi

COMPOSE=(docker compose --project-directory "$INSTALL_DIR" --env-file "$ENV_FILE" -f "$COMPOSE_FILE")
compose_staged=(docker compose --project-directory "$INSTALL_DIR" --env-file "$STAGED_ENV" -f "$COMPOSE_FILE")
rollback() {
  echo "上线失败，正在恢复原部署配置……" >&2
  cp -- "$TEMP_DIR/previous.env" "$ENV_FILE"
  "${COMPOSE[@]}" up -d --no-deps web worker caddy >/dev/null 2>&1 || true
}
trap rollback ERR

log "校验 TLS 部署配置"
"${compose_staged[@]}" config --quiet
cp -- "$STAGED_ENV" "$ENV_FILE.new"; chmod 600 "$ENV_FILE.new"; mv -- "$ENV_FILE.new" "$ENV_FILE"
log "启动域名/TLS 入口"
"${COMPOSE[@]}" up -d --no-deps web worker caddy

for _ in $(seq 1 100); do
  web_id="$("${COMPOSE[@]}" ps -q web 2>/dev/null || true)"
  worker_id="$("${COMPOSE[@]}" ps -q worker 2>/dev/null || true)"
  web_state="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$web_id" 2>/dev/null || true)"
  worker_state="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$worker_id" 2>/dev/null || true)"
  [[ "$web_state" == healthy && "$worker_state" == healthy ]] && break
  sleep 3
done
[[ "$web_state" == healthy && "$worker_state" == healthy ]] || die "Web/Worker 未达到 healthy"

log "等待 HTTPS 证书和健康检查"
healthy=0
for _ in $(seq 1 120); do
  if curl -kfsS --resolve "${DOMAIN}:${PORT}:127.0.0.1" "${origin}/api/health" >/dev/null 2>&1; then healthy=1; break; fi
  sleep 3
done
((healthy)) || die "TLS 入口未在超时时间内可用；请检查 DNS、80 端口和 Caddy 日志"

log "开启公网访问"
db_row="$("${COMPOSE[@]}" exec -T postgres psql -U crewqual -d crewqual -At -c 'SELECT "allowPublicAccess" FROM "SecurityPolicy" WHERE id = '\''global'\'';' 2>/dev/null || true)"
if [[ -n "$db_row" ]]; then
  "${COMPOSE[@]}" exec -T postgres psql -U crewqual -d crewqual -v ON_ERROR_STOP=1 -c 'UPDATE "SecurityPolicy" SET "allowPublicAccess" = true, "version" = "version" + 1, "updatedAt" = CURRENT_TIMESTAMP WHERE id = '\''global'\'';' >/dev/null
fi
trap - ERR
echo "TLS 配置完成: ${origin}/setup"
echo "公网访问已开启；如需紧急隔离，可在安全设置中关闭."
