#!/usr/bin/env bash
set -Eeuo pipefail

# CrewQual public-image installer.
# Safe to run from a checkout or through:
# curl -fsSL https://raw.githubusercontent.com/FlightDan/crewqual/main/install.sh | sudo bash

readonly GITHUB_REPOSITORY="FlightDan/crewqual"
readonly DEFAULT_INSTALL_DIR="/opt/crewqual"
readonly WAIT_TIMEOUT_SECONDS="${CREWQUAL_INSTALL_TIMEOUT_SECONDS:-300}"
readonly DOCKER_COMMAND_TIMEOUT_SECONDS="${CREWQUAL_INSTALL_DOCKER_TIMEOUT_SECONDS:-30}"
readonly NETWORK_TIMEOUT_SECONDS="${CREWQUAL_INSTALL_NETWORK_TIMEOUT_SECONDS:-60}"
readonly NETWORK_RETRY_TIMEOUT_SECONDS="${CREWQUAL_INSTALL_NETWORK_RETRY_TIMEOUT_SECONDS:-180}"
readonly CADDY_START_RETRY_ATTEMPTS="${CREWQUAL_INSTALL_CADDY_RETRY_ATTEMPTS:-5}"
readonly CADDY_START_RETRY_INTERVAL_SECONDS="${CREWQUAL_INSTALL_CADDY_RETRY_INTERVAL_SECONDS:-3}"
readonly CADDY_RECOVERY_TIMEOUT_SECONDS="${CREWQUAL_INSTALL_CADDY_RECOVERY_TIMEOUT_SECONDS:-300}"
readonly NETWORK_PROGRESS_INTERVAL_SECONDS=15
readonly PACKAGE_TIMEOUT_SECONDS="${CREWQUAL_INSTALL_PACKAGE_TIMEOUT_SECONDS:-900}"
readonly UPDATER_BINARY_DIR="/usr/local/libexec"
readonly UPDATER_CONFIG_DIR="/etc/crewqual-updater"
readonly UPDATER_DATA_DIR="/var/lib/crewqual-updater"
readonly CADDY_RECOVERY_UNIT="crewqual-caddy-recovery.service"
readonly CADDY_RECOVERY_UNIT_FILE="/etc/systemd/system/$CADDY_RECOVERY_UNIT"
readonly DEPLOYMENT_LOCK_PATH="/run/crewqual-updater/deployment.lock"
# Generated from security/update-manifest-keyring.json; release CI checks drift.
readonly BUILTIN_UPDATE_KEYRING_JSON='{"schemaVersion":1,"keys":[{"id":"manifest-a1ba0c3f6cf25851","publicKey":"Db7Vh2kVfil0HhhBWfhRxmKKbTBt0IYCDvG+E0KOGP0=","status":"active"}]}'

INSTALL_DIR="${CREWQUAL_INSTALL_DIR:-$DEFAULT_INSTALL_DIR}"
RELEASE_VERSION=""
CHANNEL_INPUT="stable"
LANGUAGE_INPUT="${CREWQUAL_INSTALL_LANGUAGE:-}"
APP_DOMAIN_INPUT=""
TLS_EMAIL_INPUT=""
NETWORK_MODE_INPUT=""
APP_PORT_INPUT=""
PORT_SELECTION=""
LAN_ADDRESS_INPUT=""
PUBLIC_ADDRESS_INPUT=""
APP_ORIGIN_VALUE=""
CADDY_SITE_ADDRESS_VALUE=""
CADDY_TLS_CONFIG_VALUE=""
CADDY_EMAIL_CONFIG_VALUE=""
APP_BIND_VALUE="0.0.0.0"
ACME_BIND_VALUE="127.0.0.1"
ACME_PORT_VALUE="18080"
TLS_CERT_INPUT=""
TLS_KEY_INPUT=""
AUTO_TLS_INPUT=0
SETUP_AUTH_CODE_DISPLAY=""
NON_INTERACTIVE=0
PLAIN_OUTPUT=0
AUTO_INSTALL_DOCKER=0
PULL_IMAGES=1
REPAIR_UPDATER=0
REPAIR_PENDING=0
REPAIR_TARGET=""
REPAIR_CONFIG=""
REPAIR_ACTIVE_UNITS=()
TEMP_DIR=""
ENV_FILE=""
COMPOSE_FILE=""
COMPOSE=()
EXISTING_INSTALL=0
ROLLBACK_DIR=""
UPGRADE_DB_BACKUP=""
PREVIOUS_CONFIGURE_DOMAIN=0
PREVIOUS_TLS_CERT=0
PREVIOUS_TLS_KEY=0
TRUSTED_PUBLIC_KEY_VALUE=""
TRUSTED_KEY_ID_VALUE=""
MANIFEST_WEB_IMAGE=""
MANIFEST_RUNTIME_IMAGE=""
IS_WSL=0
UPDATER_MODE="managed"
UPDATER_HOST_DIR="/run/crewqual-updater"
UPDATER_VERIFIER=""
UI_ACTIVE=0
UI_FD=9
UI_LOG_FILE=""
UI_RENDER_PID=""
UI_STTY_STATE=""
UI_TASK_INDEX=0
UI_TASK_TOTAL=14
UI_TASK_RUNNING=0
UI_TASK_STARTED=0
UI_CURRENT_TASK=""
UI_LAST_TASK=""
DEPLOYMENT_LOCK_FD=""
DEPLOYMENT_LOCK_HELD=0
ROLLBACK_STATE_TOKEN=""
ROLLBACK_STATE_GUARD_REQUIRED=0
UI_COLOR_BLUE=""
UI_COLOR_GREEN=""
UI_COLOR_YELLOW=""
UI_COLOR_RED=""
UI_COLOR_DIM=""
UI_COLOR_RESET=""

usage() {
  cat <<'EOF'
Usage: install.sh [options]

Install or upgrade CrewQual with public GHCR images.

Options:
  --repair-updater    Repair only an existing host updater from a signed release.
  --version VERSION   Install an exact GitHub Release (for example v1.0.1).
  --channel CHANNEL   Release channel: stable (default) or rc.
  --domain HOSTNAME   Public hostname used by CrewQual and Caddy.
  --tls-email EMAIL   Email used for ACME/TLS notifications.
  --tls-cert FILE     Use an existing PEM certificate/full chain instead of ACME.
  --tls-key FILE      Use the matching unencrypted PEM private key.
  --auto-tls          Use Caddy ACME automatic certificate management.
  --network-mode MODE Initial network mode: lan, http, or tls.
  --lan-address HOST  Advertised localhost or private IPv4 address in LAN mode.
  --public-address HOST
                      Public IPv4 address or hostname in HTTP mode.
  --port PORT         Application access port (default: 8080 for new installs).
  --random-port       Select a free high port for the application.
  --language LANG     Installer language: zh or en (default: zh).
  --install-docker    Install missing Docker Engine/Compose v2 using Docker's official method.
  --non-interactive   Fail instead of prompting for missing first-install values.
  --plain             Disable the full-screen installer UI and use plain text output.
  --no-pull           Reuse locally cached images when available.
  -h, --help          Show this help.

Environment:
  CREWQUAL_INSTALL_DIR              Install directory (default: /opt/crewqual).
  CREWQUAL_INSTALL_TIMEOUT_SECONDS  Container health timeout (default: 300).
  CREWQUAL_INSTALL_DOCKER_TIMEOUT_SECONDS
                                    Docker/systemd command timeout (default: 30).
  CREWQUAL_INSTALL_NETWORK_TIMEOUT_SECONDS
                                    Per-request network timeout (default: 60).
  CREWQUAL_INSTALL_NETWORK_RETRY_TIMEOUT_SECONDS
                                    Total retry window for network requests (default: 180).
  CREWQUAL_INSTALL_PACKAGE_TIMEOUT_SECONDS
                                    Package/Docker installation timeout (default: 900).
  CREWQUAL_INSTALL_CADDY_RETRY_ATTEMPTS
                                    Maximum Caddy start/recovery attempts (default: 5).
  CREWQUAL_INSTALL_CADDY_RETRY_INTERVAL_SECONDS
                                    Delay between Caddy start/recovery attempts (default: 3).
  CREWQUAL_INSTALL_CADDY_RECOVERY_TIMEOUT_SECONDS
                                    Host recovery timeout (default: 300).
  NO_COLOR                          Disable CUI colors while keeping the full-screen layout.
  CREWQUAL_UPDATER_TRUSTED_PUBLIC_KEY
                                    Legacy compatibility input. It is accepted only when
                                    the value already exists in the built-in keyring.

The installer never removes Docker volumes and never overwrites secrets in an
existing .env. Re-running it upgrades the managed Compose/Caddy files and image
version while preserving deployment configuration and data.
EOF
}

die() {
  if ((UI_ACTIVE)); then
    printf 'install.sh: %s\n' "$*" >>"$UI_LOG_FILE"
    ui_shutdown
    printf 'install.sh: %s\n' "$*" >/dev/tty 2>/dev/null || true
    [[ -n "$UI_LOG_FILE" ]] && printf '%s\n' "$(msg view_install_log "$UI_LOG_FILE")" >/dev/tty 2>/dev/null || true
  else
    echo "install.sh: $*" >&2
  fi
  exit 1
}

log() {
  if ((UI_ACTIVE)); then
    printf '\n==> %s\n' "$*" >>"$UI_LOG_FILE"
  else
    echo
    echo "==> $*"
  fi
}

ui_terminal_size() {
  local size=""
  size="$(stty size </dev/tty 2>/dev/null || true)"
  UI_ROWS="${size%% *}"
  UI_COLS="${size##* }"
  [[ "$UI_ROWS" =~ ^[0-9]+$ ]] || UI_ROWS=24
  [[ "$UI_COLS" =~ ^[0-9]+$ ]] || UI_COLS=80
}

ui_repeat() {
  local character="$1" count="$2" result=""
  while ((count > 0)); do
    result+="$character"
    ((count--)) || true
  done
  printf '%s' "$result"
}

ui_plain_line() {
  local value="$1" width="$2" output="" character="" character_width=1 used=0 index
  value="${value//$'\t'/  }"
  for ((index = 0; index < ${#value}; index++)); do
    character="${value:index:1}"
    if [[ "$character" == [[:ascii:]] ]]; then character_width=1; else character_width=2; fi
    ((used + character_width <= width)) || break
    output+="$character"
    used=$((used + character_width))
  done
  printf '%s%*s' "$output" "$((width - used))" ""
}

ui_sanitized_tail() {
  local lines="$1" width="$2"
  [[ -s "$UI_LOG_FILE" ]] || return 0
  tail -c 131072 "$UI_LOG_FILE" |
    tr '\r' '\n' |
    sed -E $'s/\x1B\[[0-9;?]*[ -\/]*[@-~]//g; s/[^[:print:]\t]//g' |
    tail -n "$lines"
}

ui_platform_label() {
  if ((IS_WSL)); then
    printf 'WSL2'
  else
    printf 'Linux'
  fi
}

ui_draw_dashboard() {
  local elapsed="$1" rows cols inner log_rows completed_width remaining_width
  local progress_done progress_left line="" phase_preflight phase_release phase_deploy phase_finish
  local -a log_lines=()
  ui_terminal_size
  rows="$UI_ROWS"
  cols="$UI_COLS"
  if ((rows < 20 || cols < 64)); then
    printf '\033[H\033[2J' >&$UI_FD
    printf 'CrewQual\n\n%s\n' "$(msg terminal_too_small)" >&$UI_FD
    printf '%s · %02d:%02d\n' "$UI_CURRENT_TASK" "$((elapsed / 60))" "$((elapsed % 60))" >&$UI_FD
    return
  fi

  inner=$((cols - 4))
  completed_width=$((UI_TASK_INDEX * 28 / UI_TASK_TOTAL))
  ((completed_width > 28)) && completed_width=28
  remaining_width=$((28 - completed_width))
  progress_done="$(ui_repeat '━' "$completed_width")"
  progress_left="$(ui_repeat '─' "$remaining_width")"
  ((UI_TASK_INDEX >= 3)) && phase_preflight="✓" || phase_preflight="○"
  ((UI_TASK_INDEX >= 6)) && phase_release="✓" || phase_release="○"
  if ((UI_TASK_INDEX >= UI_TASK_TOTAL && UI_TASK_RUNNING == 0)); then
    phase_deploy="✓"
    phase_finish="✓"
  else
    phase_deploy="●"
    phase_finish="○"
  fi
  log_rows=$((rows - 12))
  ((log_rows < 6)) && log_rows=6

  printf '\033[H\033[2J' >&$UI_FD
  printf ' %bCrewQual%b %-*s %s · %s\n' "$UI_COLOR_BLUE" "$UI_COLOR_RESET" "$((cols - 28))" "$(msg installer_title)" "$(ui_platform_label)" "${RELEASE_VERSION:-latest}" >&$UI_FD
  printf ' %b%s%b%s  %2d / %d\n\n' "$UI_COLOR_BLUE" "$progress_done" "$UI_COLOR_RESET" "$progress_left" "$UI_TASK_INDEX" "$UI_TASK_TOTAL" >&$UI_FD
  printf ' %b%s%b %s    %b%s%b %s    %b%s%b %s    %b%s%b %s\n\n' \
    "$UI_COLOR_GREEN" "$phase_preflight" "$UI_COLOR_RESET" "$(msg phase_preflight)" \
    "$UI_COLOR_GREEN" "$phase_release" "$UI_COLOR_RESET" "$(msg phase_release)" \
    "$UI_COLOR_YELLOW" "$phase_deploy" "$UI_COLOR_RESET" "$(msg phase_deploy)" \
    "$UI_COLOR_DIM" "$phase_finish" "$UI_COLOR_RESET" "$(msg phase_finish)" >&$UI_FD
  printf ' ┌─ %s %s┐\n' "$(msg live_log)" "$(ui_repeat '─' "$((inner - ${#line} - 9))")" >&$UI_FD
  mapfile -t log_lines < <(ui_sanitized_tail "$log_rows" "$inner")
  for line in "${log_lines[@]}"; do
    printf ' │ '
    ui_plain_line "$line" "$inner"
    printf ' │\n'
  done >&$UI_FD
  local rendered_lines
  rendered_lines="${#log_lines[@]}"
  while ((rendered_lines < log_rows)); do
    printf ' │ '
    ui_plain_line "" "$inner"
    printf ' │\n'
    ((rendered_lines++)) || true
  done >&$UI_FD
  printf ' └%s┘\n' "$(ui_repeat '─' "$((cols - 2))")" >&$UI_FD
  printf ' %b◐%b %s · %02d:%02d%*s%s\n' "$UI_COLOR_BLUE" "$UI_COLOR_RESET" "$UI_CURRENT_TASK" \
    "$((elapsed / 60))" "$((elapsed % 60))" 2 "" "$(msg cancel_hint)" >&$UI_FD
}

ui_render_loop() {
  local started="$UI_TASK_STARTED"
  while :; do
    ui_draw_dashboard "$((SECONDS - started))"
    sleep 0.2
  done
}

ui_stop_renderer() {
  if [[ -n "$UI_RENDER_PID" ]]; then
    kill "$UI_RENDER_PID" 2>/dev/null || true
    wait "$UI_RENDER_PID" 2>/dev/null || true
    UI_RENDER_PID=""
  fi
}

ui_task_run() {
  local index="$1" label="$2" status=0
  shift 2
  if ((!UI_ACTIVE)); then
    "$@"
    return
  fi
  UI_TASK_INDEX="$index"
  UI_TASK_RUNNING=1
  UI_CURRENT_TASK="$label"
  UI_TASK_STARTED="$SECONDS"
  printf '\n[%02d/%02d] %s\n' "$index" "$UI_TASK_TOTAL" "$label" >>"$UI_LOG_FILE"
  ui_render_loop &
  UI_RENDER_PID=$!
  if "$@" >>"$UI_LOG_FILE" 2>&1; then
    status=0
  else
    status=$?
  fi
  ui_stop_renderer
  UI_TASK_RUNNING=0
  UI_LAST_TASK="$label"
  ui_draw_dashboard "$((SECONDS - UI_TASK_STARTED))"
  return "$status"
}

ui_shutdown() {
  ((UI_ACTIVE)) || return 0
  ui_stop_renderer
  [[ -n "$UI_STTY_STATE" ]] && stty "$UI_STTY_STATE" </dev/tty 2>/dev/null || true
  printf '\033[?25h\033[?1049l' >&$UI_FD 2>/dev/null || true
  exec 9>&- 2>/dev/null || true
  UI_ACTIVE=0
}

ui_init() {
  local size rows cols locale_name
  ((NON_INTERACTIVE == 0 && PLAIN_OUTPUT == 0)) || return 0
  [[ -t 1 && -r /dev/tty && -w /dev/tty && "${TERM:-dumb}" != "dumb" ]] || return 0
  locale_name="${LC_ALL:-${LC_CTYPE:-${LANG:-}}}"
  [[ "$locale_name" =~ [Uu][Tt][Ff]-?8 ]] || return 0
  size="$(stty size </dev/tty 2>/dev/null || true)"
  rows="${size%% *}"
  cols="${size##* }"
  [[ "$rows" =~ ^[0-9]+$ && "$cols" =~ ^[0-9]+$ && "$rows" -ge 20 && "$cols" -ge 64 ]] || return 0
  UI_LOG_FILE="$(mktemp /tmp/crewqual-install.XXXXXX.log)"
  chmod 0600 "$UI_LOG_FILE"
  exec 9<>/dev/tty
  UI_STTY_STATE="$(stty -g </dev/tty 2>/dev/null || true)"
  if [[ -z "${NO_COLOR:-}" ]]; then
    UI_COLOR_BLUE=$'\033[34m'
    UI_COLOR_GREEN=$'\033[32m'
    UI_COLOR_YELLOW=$'\033[33m'
    UI_COLOR_RED=$'\033[31m'
    UI_COLOR_DIM=$'\033[2m'
    UI_COLOR_RESET=$'\033[0m'
  fi
  UI_ACTIVE=1
  printf '\033[?1049h\033[?25l\033[2J\033[H' >&$UI_FD
}

ui_read_key() {
  local key="" rest=""
  IFS= read -rsn1 key </dev/tty || return 1
  if [[ "$key" == $'\033' ]]; then
    IFS= read -rsn2 -t 0.08 rest </dev/tty || true
    key+="$rest"
  fi
  printf '%s' "$key"
}

ui_select() {
  local title="$1" description="$2" selected="$3"
  shift 3
  local -a options=("$@")
  local key="" index cols width option
  while :; do
    ui_terminal_size
    cols="$UI_COLS"
    width=$((cols - 8))
    printf '\033[H\033[2J' >&$UI_FD
    printf ' %bCrewQual%b  %s\n' "$UI_COLOR_BLUE" "$UI_COLOR_RESET" "$(msg installer_title)" >&$UI_FD
    printf ' %s\n\n' "$(ui_repeat '─' "$((cols - 2))")" >&$UI_FD
    printf ' %b%s%b\n' "$UI_COLOR_BLUE" "$title" "$UI_COLOR_RESET" >&$UI_FD
    [[ -n "$description" ]] && printf ' %b%s%b\n\n' "$UI_COLOR_DIM" "$description" "$UI_COLOR_RESET" >&$UI_FD || printf '\n' >&$UI_FD
    for ((index = 0; index < ${#options[@]}; index++)); do
      option="${options[$index]}"
      if ((index == selected)); then
        printf ' %b  › %d. %-*.*s%b\n' "$UI_COLOR_BLUE" "$((index + 1))" "$width" "$width" "$option" "$UI_COLOR_RESET" >&$UI_FD
      else
        printf '    %d. %-*.*s\n' "$((index + 1))" "$width" "$width" "$option" >&$UI_FD
      fi
    done
    printf '\n %b%s%b\n' "$UI_COLOR_DIM" "$(msg menu_hint)" "$UI_COLOR_RESET" >&$UI_FD
    key="$(ui_read_key)" || return 1
    case "$key" in
      $'\033[A')
        if ((selected > 0)); then selected=$((selected - 1)); else selected=$((${#options[@]} - 1)); fi
        ;;
      $'\033[B')
        if ((selected + 1 < ${#options[@]})); then selected=$((selected + 1)); else selected=0; fi
        ;;
      ''|$'\n'|$'\r') printf '%s' "$selected"; return 0 ;;
      [1-9])
        index=$((10#$key - 1))
        if ((index < ${#options[@]})); then printf '%s' "$index"; return 0; fi
        ;;
    esac
  done
}

ui_input() {
  local prompt="$1" default_value="${2:-}" result=""
  ui_terminal_size
  printf '\033[H\033[2J' >&$UI_FD
  printf ' %bCrewQual%b  %s\n' "$UI_COLOR_BLUE" "$UI_COLOR_RESET" "$(msg installer_title)" >&$UI_FD
  printf ' %s\n\n' "$(ui_repeat '─' "$((UI_COLS - 2))")" >&$UI_FD
  printf ' %s\n' "$prompt" >&$UI_FD
  [[ -n "$default_value" ]] && printf ' %b%s: %s%b\n' "$UI_COLOR_DIM" "$(msg default_value)" "$default_value" "$UI_COLOR_RESET" >&$UI_FD
  printf '\n › ' >&$UI_FD
  printf '\033[?25h' >&$UI_FD
  IFS= read -r result </dev/tty
  printf '\033[?25l' >&$UI_FD
  [[ -n "$result" ]] || result="$default_value"
  printf '%s' "$result"
}

ui_review_configuration() {
  local mode_label address_label choice
  case "$NETWORK_MODE_INPUT" in
    lan) mode_label="$(msg network_lan)"; address_label="$LAN_ADDRESS_INPUT" ;;
    http) mode_label="$(msg network_http)"; address_label="$PUBLIC_ADDRESS_INPUT" ;;
    tls) mode_label="TLS"; address_label="$APP_DOMAIN_INPUT" ;;
  esac
  choice="$(ui_select "$(msg review_title)" \
    "$(msg review_summary "$mode_label" "$address_label" "$APP_PORT_INPUT")" 0 \
    "$(msg review_start)" "$(msg review_change)" "$(msg review_cancel)")"
  case "$choice" in
    0) return 0 ;;
    1) return 1 ;;
    *)
      ui_shutdown
      printf '%s\n' "$(msg install_cancelled)"
      exit 0
      ;;
  esac
}

ui_review_upgrade() {
  local mode_label address_label choice
  case "$NETWORK_MODE_INPUT" in
    lan) mode_label="$(msg network_lan)"; address_label="${LAN_ADDRESS_INPUT:-$APP_ORIGIN_VALUE}" ;;
    http) mode_label="$(msg network_http)"; address_label="${PUBLIC_ADDRESS_INPUT:-$APP_DOMAIN_INPUT}" ;;
    tls) mode_label="TLS"; address_label="$APP_DOMAIN_INPUT" ;;
  esac
  choice="$(ui_select "$(msg review_upgrade_title)" \
    "$(msg review_summary "$mode_label" "$address_label" "$APP_PORT_INPUT")" 0 \
    "$(msg review_upgrade_start)" "$(msg review_cancel)")"
  if [[ "$choice" != "0" ]]; then
    ui_shutdown
    printf '%s\n' "$(msg install_cancelled)"
    exit 0
  fi
}

ui_reset_network_answers() {
  NETWORK_MODE_INPUT=""
  APP_PORT_INPUT=""
  PORT_SELECTION=""
  LAN_ADDRESS_INPUT=""
  PUBLIC_ADDRESS_INPUT=""
  APP_DOMAIN_INPUT=""
  TLS_EMAIL_INPUT=""
}

ui_promote_log() {
  local log_dir target
  ((UI_ACTIVE)) || return 0
  log_dir="$INSTALL_DIR/logs"
  install -d -m 0700 "$log_dir"
  target="$log_dir/install-$(date '+%Y%m%d-%H%M%S').log"
  mv -- "$UI_LOG_FILE" "$target"
  chmod 0600 "$target"
  UI_LOG_FILE="$target"
}

msg() {
  local key="$1"
  local locale="${LANGUAGE_INPUT:-zh}"
  shift
  [[ "$locale" == "en" ]] || locale="zh"
  case "$locale:$key" in
    zh:language_prompt) printf '选择语言 [1=中文, 2=English]: ' ;;
    en:language_prompt) printf 'Select language [1=Chinese, 2=English]: ' ;;
    zh:installer_title) printf '安装程序' ;;
    en:installer_title) printf 'Installer' ;;
    zh:terminal_too_small) printf '终端窗口过小，请调整到至少 64×20；安装仍在继续。' ;;
    en:terminal_too_small) printf 'The terminal is too small. Resize it to at least 64x20; installation is continuing.' ;;
    zh:phase_preflight) printf '环境检查' ;;
    en:phase_preflight) printf 'Preflight' ;;
    zh:phase_release) printf '发布验证' ;;
    en:phase_release) printf 'Release' ;;
    zh:phase_deploy) printf '部署服务' ;;
    en:phase_deploy) printf 'Deploy' ;;
    zh:phase_finish) printf '完成' ;;
    en:phase_finish) printf 'Finish' ;;
    zh:live_log) printf '实时日志' ;;
    en:live_log) printf 'Live log' ;;
    zh:cancel_hint) printf 'Ctrl+C 取消' ;;
    en:cancel_hint) printf 'Ctrl+C to cancel' ;;
    zh:menu_hint) printf '↑/↓ 选择 · Enter 确认 · 也可按数字快捷选择' ;;
    en:menu_hint) printf 'Up/Down to select · Enter to confirm · Number keys also work' ;;
    zh:default_value) printf '默认值' ;;
    en:default_value) printf 'Default' ;;
    zh:language_title) printf '选择安装器语言' ;;
    en:language_title) printf 'Choose installer language' ;;
    zh:language_description) printf '安装完成后仍可在系统设置中更改界面语言。' ;;
    en:language_description) printf 'The application language can still be changed after installation.' ;;
    zh:network_title) printf '选择网络模式' ;;
    en:network_title) printf 'Choose a network mode' ;;
    zh:network_description) printf '局域网适合测试；TLS 适合正式公网部署。' ;;
    en:network_description) printf 'LAN is suitable for testing; TLS is intended for production access.' ;;
    zh:network_lan) printf '局域网测试' ;;
    en:network_lan) printf 'LAN testing' ;;
    zh:network_http) printf '公网 HTTP（不安全）' ;;
    en:network_http) printf 'Public HTTP (insecure)' ;;
    zh:network_tls) printf '立即配置 TLS' ;;
    en:network_tls) printf 'Configure TLS now' ;;
    zh:lan_scope_title) printf '选择访问范围' ;;
    en:lan_scope_title) printf 'Choose access scope' ;;
    zh:lan_scope_description) printf '建议只允许本机或局域网访问。' ;;
    en:lan_scope_description) printf 'Local or LAN-only access is recommended.' ;;
    zh:lan_scope_only) printf '仅本机或局域网' ;;
    en:lan_scope_only) printf 'Local or LAN only' ;;
    zh:lan_scope_public) printf '临时公网 HTTP' ;;
    en:lan_scope_public) printf 'Temporary public HTTP' ;;
    zh:port_title) printf '选择访问端口' ;;
    en:port_title) printf 'Choose an access port' ;;
    zh:port_default_option) printf '默认端口 8080' ;;
    en:port_default_option) printf 'Default port 8080' ;;
    zh:port_random_option) printf '随机可用端口' ;;
    en:port_random_option) printf 'Random available port' ;;
    zh:port_custom_option) printf '自定义端口' ;;
    en:port_custom_option) printf 'Custom port' ;;
    zh:review_title) printf '确认部署配置' ;;
    en:review_title) printf 'Review deployment configuration' ;;
    zh:review_upgrade_title) printf '确认升级配置' ;;
    en:review_upgrade_title) printf 'Review upgrade configuration' ;;
    zh:review_summary) printf '网络：%s  ·  地址：%s  ·  端口：%s' "$1" "$2" "$3" ;;
    en:review_summary) printf 'Network: %s  ·  Address: %s  ·  Port: %s' "$1" "$2" "$3" ;;
    zh:review_start) printf '开始部署' ;;
    en:review_start) printf 'Start deployment' ;;
    zh:review_upgrade_start) printf '开始升级' ;;
    en:review_upgrade_start) printf 'Start upgrade' ;;
    zh:review_change) printf '返回修改' ;;
    en:review_change) printf 'Change settings' ;;
    zh:review_cancel) printf '取消安装' ;;
    en:review_cancel) printf 'Cancel installation' ;;
    zh:install_cancelled) printf 'CrewQual 安装已取消，未开始部署。' ;;
    en:install_cancelled) printf 'CrewQual installation was cancelled before deployment.' ;;
    zh:yes_option) printf '是' ;;
    en:yes_option) printf 'Yes' ;;
    zh:no_option) printf '否' ;;
    en:no_option) printf 'No' ;;
    zh:view_install_log) printf '完整安装日志: %s' "$1" ;;
    en:view_install_log) printf 'Full installation log: %s' "$1" ;;
    zh:failed_step) printf '失败步骤' ;;
    en:failed_step) printf 'Failed step' ;;
    zh:recent_log) printf '最近日志:' ;;
    en:recent_log) printf 'Recent log:' ;;
    zh:task_preflight) printf '检查安装环境' ;;
    en:task_preflight) printf 'Check installation environment' ;;
    zh:task_docker) printf '检查 Docker Engine' ;;
    en:task_docker) printf 'Check Docker Engine' ;;
    zh:task_compose) printf '检查 Docker Compose v2' ;;
    en:task_compose) printf 'Check Docker Compose v2' ;;
    zh:task_release) printf '解析 CrewQual Release' ;;
    en:task_release) printf 'Resolve CrewQual Release' ;;
    zh:task_download) printf '下载部署清单' ;;
    en:task_download) printf 'Download deployment manifest' ;;
    zh:task_verify) printf '验证发布签名与校验和' ;;
    en:task_verify) printf 'Verify release signatures and checksums' ;;
    zh:task_config) printf '确认部署配置' ;;
    en:task_config) printf 'Confirm deployment configuration' ;;
    zh:task_prepare) printf '准备受管理部署文件' ;;
    en:task_prepare) printf 'Prepare managed deployment files' ;;
    zh:task_commit) printf '安装并配置更新器' ;;
    en:task_commit) printf 'Install files and configure updater' ;;
    zh:task_pull) printf '拉取 CrewQual 镜像' ;;
    en:task_pull) printf 'Pull CrewQual images' ;;
    zh:task_minio) printf '启动内置对象存储' ;;
    en:task_minio) printf 'Start built-in object storage' ;;
    zh:task_postgres) printf '启动 PostgreSQL' ;;
    en:task_postgres) printf 'Start PostgreSQL' ;;
    zh:task_database) printf '迁移并初始化数据库' ;;
    en:task_database) printf 'Migrate and initialize the database' ;;
    zh:task_services) printf '启动 Web、Worker 与访问入口' ;;
    en:task_services) printf 'Start Web, Worker, and web entrypoint' ;;
    zh:invalid_language) printf '语言必须是 zh 或 en: %s' "$1" ;;
    en:invalid_language) printf 'Language must be zh or en: %s' "$1" ;;
    zh:command_unavailable) printf '命令不可用: %s' "$1" ;;
    en:command_unavailable) printf 'Command unavailable: %s' "$1" ;;
    zh:version_invalid) printf '版本格式无效: %s（应类似 v1.0.1 或 v1.0.1-rc.1）' "$1" ;;
    en:version_invalid) printf 'Invalid version format: %s (expected v1.0.1 or v1.0.1-rc.1)' "$1" ;;
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
    zh:network_required) printf '首次非交互安装必须传入 --network-mode lan|http|tls' ;;
    en:network_required) printf 'First non-interactive install requires --network-mode lan|http|tls' ;;
    zh:network_invalid) printf '网络模式必须是 lan、http 或 tls' ;;
    en:network_invalid) printf 'Network mode must be lan, http, or tls' ;;
    zh:lan_required) printf '局域网模式非交互安装必须传入 --lan-address' ;;
    en:lan_required) printf 'Non-interactive LAN installation requires --lan-address' ;;
    zh:lan_address_prompt) printf '局域网访问地址 [%s]: ' "$1" ;;
    en:lan_address_prompt) printf 'LAN access address [%s]: ' "$1" ;;
    zh:lan_only_prompt) printf '是否仅允许局域网访问？[Y/n]: ' ;;
    en:lan_only_prompt) printf 'Allow LAN access only? [Y/n]: ' ;;
    zh:public_address_prompt) printf '公网访问地址（IPv4 或主机名）[%s]: ' "$1" ;;
    en:public_address_prompt) printf 'Public address (IPv4 or hostname) [%s]: ' "$1" ;;
    zh:public_address_required) printf '公网 HTTP 模式必须传入 --public-address' ;;
    en:public_address_required) printf 'Public HTTP mode requires --public-address' ;;
    zh:public_address_invalid) printf '公网访问地址格式无效（不要包含协议、端口或路径）: %s' "$1" ;;
    en:public_address_invalid) printf 'Invalid public address (do not include a scheme, port, or path): %s' "$1" ;;
    zh:public_http_warning) printf '警告：公网 HTTP 不加密，首次授权码、登录密码、TOTP 和业务数据可能被窃听或篡改。请限制防火墙来源并尽快启用 HTTPS；启用后应更换管理员密码与 TOTP、撤销所有活跃会话，并轮换 HTTP 阶段录入过的 API/Webhook 密钥。' ;;
    en:public_http_warning) printf 'Warning: public HTTP is unencrypted. The setup code, passwords, TOTP codes, and business data may be intercepted or modified. Restrict firewall sources and enable HTTPS as soon as possible; afterward, change administrator passwords and TOTP, revoke all active sessions, and rotate API or webhook keys entered during the HTTP phase.' ;;
    zh:public_http_confirm) printf '仍然继续公网 HTTP 部署？[y/N]: ' ;;
    en:public_http_confirm) printf 'Continue with public HTTP deployment? [y/N]: ' ;;
    zh:public_http_declined) printf '已取消公网 HTTP 部署' ;;
    en:public_http_declined) printf 'Public HTTP deployment was cancelled' ;;
    zh:tls_domain_prompt) printf 'CrewQual 公网域名: ' ;;
    en:tls_domain_prompt) printf 'CrewQual public domain: ' ;;
    zh:tls_email_prompt) printf 'TLS 通知邮箱: ' ;;
    en:tls_email_prompt) printf 'TLS notification email: ' ;;
    zh:tls_domain_required) printf 'TLS 模式必须传入 --domain' ;;
    en:tls_domain_required) printf 'TLS mode requires --domain' ;;
    zh:tls_email_required) printf 'TLS 模式必须传入 --tls-email' ;;
    en:tls_email_required) printf 'TLS mode requires --tls-email' ;;
    zh:tls_cert_pair) printf '自有证书模式必须同时传入 --tls-cert 和 --tls-key' ;;
    en:tls_cert_pair) printf 'Custom certificate mode requires both --tls-cert and --tls-key' ;;
    zh:tls_cert_file) printf '证书文件不可读或不存在: %s' "$1" ;;
    en:tls_cert_file) printf 'Certificate file is missing or unreadable: %s' "$1" ;;
    zh:tls_key_file) printf '私钥文件不可读或不存在: %s' "$1" ;;
    en:tls_key_file) printf 'Private key file is missing or unreadable: %s' "$1" ;;
    zh:tls_cert_invalid) printf '证书不是有效的 PEM X.509 证书: %s' "$1" ;;
    en:tls_cert_invalid) printf 'The certificate is not a valid PEM X.509 certificate: %s' "$1" ;;
    zh:tls_key_invalid) printf '私钥不是可用的未加密 PEM 私钥: %s' "$1" ;;
    en:tls_key_invalid) printf 'The private key is not a usable unencrypted PEM key: %s' "$1" ;;
    zh:tls_cert_expired) printf '证书已过期: %s' "$1" ;;
    en:tls_cert_expired) printf 'The certificate is expired: %s' "$1" ;;
    zh:tls_cert_domain) printf '证书不包含域名 %s' "$1" ;;
    en:tls_cert_domain) printf 'The certificate does not cover domain %s' "$1" ;;
    zh:tls_cert_key_mismatch) printf '证书与私钥不匹配' ;;
    en:tls_cert_key_mismatch) printf 'The certificate and private key do not match' ;;
    zh:tls_custom_non_tls) printf '只有 TLS 网络模式可以使用自有证书' ;;
    en:tls_custom_non_tls) printf 'Custom certificates can only be used with TLS network mode' ;;
    zh:tls_custom_missing_installed) printf '已配置自有证书，但安装目录缺少证书文件，请重新传入 --tls-cert 和 --tls-key' ;;
    en:tls_custom_missing_installed) printf 'Custom TLS is configured but the installed certificate files are missing; pass --tls-cert and --tls-key again' ;;
    zh:no_tty) printf '当前没有交互式终端；请传入网络模式、端口和必要的地址或域名参数' ;;
    en:no_tty) printf 'No interactive terminal is available; pass the network mode, port, and required address or domain parameters' ;;
    zh:resolve_latest) printf '解析最新 CrewQual Release' ;;
    en:resolve_latest) printf 'Resolve the latest CrewQual Release' ;;
    zh:release_unavailable) printf '无法从 GitHub 获取最新 CrewQual Release' ;;
    en:release_unavailable) printf 'Could not resolve the latest CrewQual GitHub Release' ;;
    zh:latest_version) printf '最新版本: %s' "$1" ;;
    en:latest_version) printf 'Latest version: %s' "$1" ;;
    zh:download_manifest) printf '下载 %s 部署清单' "$1" ;;
    en:download_manifest) printf 'Download the %s deployment manifest' "$1" ;;
    zh:deployment_empty) printf '下载的部署文件为空' ;;
    en:deployment_empty) printf 'Downloaded deployment files are empty' ;;
    zh:trusted_key_required) printf '发布清单的签名 key ID 不在内置 keyring 中' ;;
    en:trusted_key_required) printf 'The manifest signing key ID is not in the built-in keyring' ;;
    zh:trusted_key_missing) printf '发布清单签名 key ID 不受信任；拒绝安装' ;;
    en:trusted_key_missing) printf 'The release signing key ID is not trusted; refusing to install' ;;
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
    zh:install_interrupted) printf '安装已中断（按 Ctrl-C 触发）' ;;
    en:install_interrupted) printf 'Installation interrupted (Ctrl-C)' ;;
    zh:preflight) printf '检查安装环境' ;;
    en:preflight) printf 'Check installation prerequisites' ;;
    zh:docker_check) printf '检查 Docker Engine 和 daemon（最多等待 %ss）' "$1" ;;
    en:docker_check) printf 'Check Docker Engine and daemon (wait up to %ss)' "$1" ;;
    zh:docker_start) printf '启动 Docker daemon（最多等待 %ss）' "$1" ;;
    en:docker_start) printf 'Start Docker daemon (wait up to %ss)' "$1" ;;
    zh:docker_ready) printf 'Docker Engine 已就绪' ;;
    en:docker_ready) printf 'Docker Engine is ready' ;;
    zh:docker_wait) printf 'Docker daemon 检查仍在进行（最多 %ss）' "$1" ;;
    en:docker_wait) printf 'Docker daemon check is still running (up to %ss)' "$1" ;;
    zh:compose_check) printf '检查 Docker Compose v2（最多等待 %ss）' "$1" ;;
    en:compose_check) printf 'Check Docker Compose v2 (wait up to %ss)' "$1" ;;
    zh:compose_ready) printf 'Docker Compose v2 已就绪' ;;
    en:compose_ready) printf 'Docker Compose v2 is ready' ;;
    zh:compose_wait) printf 'Docker Compose v2 检查仍在进行（最多 %ss）' "$1" ;;
    en:compose_wait) printf 'Docker Compose v2 check is still running (up to %ss)' "$1" ;;
    zh:wsl_detected) printf '检测到 WSL2；使用 Windows Docker Desktop，并启用当前 Ubuntu 的 WSL Integration' ;;
    en:wsl_detected) printf 'WSL2 detected; use Docker Desktop for Windows with WSL Integration enabled for this Ubuntu distribution' ;;
    zh:wsl_docker_missing) printf 'WSL2 中未找到 Docker CLI。请在 Windows 安装并启动 Docker Desktop，在 Settings > Resources > WSL Integration 中启用当前 Ubuntu，然后重新打开 Ubuntu 终端' ;;
    en:wsl_docker_missing) printf 'Docker CLI was not found in WSL2. Install and start Docker Desktop on Windows, enable this Ubuntu distribution under Settings > Resources > WSL Integration, then reopen the Ubuntu terminal' ;;
    zh:wsl_docker_unavailable) printf 'WSL2 无法连接 Docker Desktop。请启动 Docker Desktop，确认当前 Ubuntu 已启用 WSL Integration，然后在 Ubuntu 中运行 docker info 验证' ;;
    en:wsl_docker_unavailable) printf 'WSL2 cannot connect to Docker Desktop. Start Docker Desktop, confirm WSL Integration is enabled for this Ubuntu distribution, then run docker info in Ubuntu' ;;
    zh:wsl_compose_unavailable) printf 'WSL2 中 Docker Compose v2 不可用。请更新 Docker Desktop 并重新启用当前 Ubuntu 的 WSL Integration' ;;
    en:wsl_compose_unavailable) printf 'Docker Compose v2 is unavailable in WSL2. Update Docker Desktop and re-enable WSL Integration for this Ubuntu distribution' ;;
    zh:wsl_install_docker_ignored) printf 'WSL2 由 Windows Docker Desktop 提供 Docker；已忽略 --install-docker' ;;
    en:wsl_install_docker_ignored) printf 'Docker is provided by Docker Desktop on Windows in WSL2; --install-docker was ignored' ;;
    zh:download_asset) printf '下载 %s' "$1" ;;
    en:download_asset) printf 'Download %s' "$1" ;;
    zh:download_failed) printf '下载失败: %s' "$1" ;;
    en:download_failed) printf 'Download failed: %s' "$1" ;;
    zh:docker_installer_download) printf '下载 Docker 官方安装脚本' ;;
    en:docker_installer_download) printf 'Download Docker official installer' ;;
    zh:package_update) printf '更新系统软件包索引' ;;
    en:package_update) printf 'Update system package indexes' ;;
    zh:package_install) printf '安装 Docker Compose v2 软件包' ;;
    en:package_install) printf 'Install Docker Compose v2 package' ;;
    zh:command_timeout) printf '命令超过 %ss 仍未完成，已自动终止' "$1" ;;
    en:command_timeout) printf 'Command did not finish within %ss and was terminated' "$1" ;;
    zh:network_timeout) printf '网络请求超过 %ss，已自动终止；请检查网络或代理' "$1" ;;
    en:network_timeout) printf 'Network request exceeded %ss and was terminated; check the network or proxy' "$1" ;;
    zh:network_wait) printf '网络请求仍在进行（单次最多 %ss，重试窗口最多 %ss）' "$1" "$2" ;;
    en:network_wait) printf 'Network request is still running (up to %ss per request, %ss across retries)' "$1" "$2" ;;
    zh:network_failed) printf '网络请求失败；请检查网络、DNS 或代理' ;;
    en:network_failed) printf 'Network request failed; check the network, DNS, or proxy' ;;
    zh:wait_status) printf '等待 %s: %s' "$1" "$2" ;;
    en:wait_status) printf 'Wait for %s: %s' "$1" "$2" ;;
    zh:caddy_retry) printf 'Caddy 启动未就绪，将在 %ss 后重试（第 %s/%s 次）' "$1" "$2" "$3" ;;
    en:caddy_retry) printf 'Caddy is not ready; retrying in %ss (attempt %s/%s)' "$1" "$2" "$3" ;;
    zh:caddy_recovery_start) printf '校验并启用 Caddy 主机地址自动恢复' ;;
    en:caddy_recovery_start) printf 'Validate and enable Caddy host-address recovery' ;;
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
    zh:manual_updater_mode) printf 'WSL2 使用手动升级模式；不会安装宿主机自动更新服务' ;;
    en:manual_updater_mode) printf 'WSL2 uses manual update mode; the host automatic updater service will not be installed' ;;
    zh:manual_upgrade_command) printf '升级方式: 在 WSL2 Ubuntu 中重新运行 CrewQual 安装命令' ;;
    en:manual_upgrade_command) printf 'To upgrade, rerun the CrewQual installation command in WSL2 Ubuntu' ;;
    zh:updater_disable_failed) printf '警告: 无法停止已有 CrewQual 更新器；请手工执行 systemctl disable --now crewqual-updater.service crewqual-updater.socket crewqual-caddy-recovery.service' ;;
    en:updater_disable_failed) printf 'Warning: could not stop the existing CrewQual updater; run systemctl disable --now crewqual-updater.service crewqual-updater.socket crewqual-caddy-recovery.service manually' ;;
    zh:deployment_lock_failed) printf '错误: 无法在限定时间内取得 CrewQual 部署锁；请等待其他升级或恢复任务完成后重试。' ;;
    en:deployment_lock_failed) printf 'Error: could not acquire the CrewQual deployment lock before the timeout; wait for the other update or recovery task and retry.' ;;
    zh:wsl_lan_firewall) printf 'WSL2 将使用 Windows 局域网地址 %s；请确认 Windows 防火墙允许 TCP %s 入站' "$1" "$2" ;;
    en:wsl_lan_firewall) printf 'WSL2 will use Windows LAN address %s; ensure Windows Firewall allows inbound TCP %s' "$1" "$2" ;;
    zh:setup_auth_code) printf '首次配置授权码（仅显示一次）: %s' "$1" ;;
    en:setup_auth_code) printf 'First-setup authorization code (shown once): %s' "$1" ;;
    zh:setup_auth_warning) printf '请立即保存该授权码；首次配置前需要在 /setup 输入它。' ;;
    en:setup_auth_warning) printf 'Save this code now; it is required at /setup before initial configuration.' ;;
    zh:public_http_postinstall) printf '安全提醒：当前通过公网 HTTP 明文访问。请尽快配置 HTTPS；完成后更换管理员密码与 TOTP、撤销所有活跃会话，并轮换 HTTP 阶段录入过的 API/Webhook 密钥。' ;;
    en:public_http_postinstall) printf 'Security reminder: this deployment is publicly accessible over unencrypted HTTP. Enable HTTPS as soon as possible; afterward, change administrator passwords and TOTP, revoke all active sessions, and rotate API or webhook keys entered during the HTTP phase.' ;;
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
    zh:start_https) printf '启动 Web 访问入口' ;;
    en:start_https) printf 'Start web entrypoint' ;;
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
    zh:deployment_unsigned) printf '缺少签名公钥；拒绝安装未验签的正式发布' ;;
    en:deployment_unsigned) printf 'Signing public key is missing; refusing to install an unsigned release' ;;
    zh:compose_unavailable) printf '无法连接 Docker daemon' ;;
    en:compose_unavailable) printf 'Cannot connect to the Docker daemon' ;;
    zh:compose_plugin_missing) printf 'Docker Compose v2 plugin 不可用' ;;
    en:compose_plugin_missing) printf 'Docker Compose v2 plugin is unavailable' ;;
    zh:docker_engine_missing) printf '未检测到可用的 Docker Engine' ;;
    en:docker_engine_missing) printf 'A usable Docker Engine was not detected' ;;
    zh:docker_daemon_missing) printf 'Docker Engine 已安装，但无法连接 Docker daemon' ;;
    en:docker_daemon_missing) printf 'Docker Engine is installed, but the Docker daemon is unavailable' ;;
    zh:docker_engine_prompt) printf '是否按 Docker 官方方式安装 Docker Engine？[y/N]: ' ;;
    en:docker_engine_prompt) printf "Install Docker Engine using Docker's official method? [y/N]: " ;;
    zh:docker_daemon_prompt) printf '是否尝试启动现有的 Docker daemon？[y/N]: ' ;;
    en:docker_daemon_prompt) printf 'Try to start the existing Docker daemon? [y/N]: ' ;;
    zh:compose_plugin_prompt) printf '未检测到 Docker Compose v2 插件，是否按 Docker 官方方式安装？[y/N]: ' ;;
    en:compose_plugin_prompt) printf "Docker Compose v2 is missing. Install it using Docker's official method? [y/N]: " ;;
    zh:docker_install_noninteractive) printf '%s；非交互模式不会自动安装，请先安装依赖后重试，或显式传入 --install-docker' "$1" ;;
    en:docker_install_noninteractive) printf '%s; non-interactive mode will not install it automatically. Install it first or pass --install-docker explicitly' "$1" ;;
    zh:docker_install_declined) printf '未获得安装 Docker 依赖的确认，安装已终止' ;;
    en:docker_install_declined) printf 'Docker dependency installation was not approved; installation stopped' ;;
    zh:docker_install_engine) printf '使用 Docker 官方安装脚本安装 Docker Engine' ;;
    en:docker_install_engine) printf "Install Docker Engine with Docker's official installer" ;;
    zh:docker_install_compose) printf '使用 Docker 官方软件源安装 Docker Compose v2 插件' ;;
    en:docker_install_compose) printf "Install Docker Compose v2 from Docker's official package repository" ;;
    zh:docker_install_engine_failed) printf 'Docker Engine 安装后仍不可用，请检查 daemon 状态并重试' ;;
    en:docker_install_engine_failed) printf 'Docker Engine is still unavailable after installation; check the daemon and retry' ;;
    zh:docker_install_compose_failed) printf 'Docker Compose v2 插件安装后仍不可用，请检查安装结果并重试' ;;
    en:docker_install_compose_failed) printf 'Docker Compose v2 is still unavailable after installation; check the result and retry' ;;
    zh:updater_start) printf '启动 CrewQual 自动更新器' ;;
    en:updater_start) printf 'Start CrewQual updater' ;;
    zh:updater_download) printf '下载并验证 CrewQual 更新器' ;;
    en:updater_download) printf 'Download and verify the CrewQual updater' ;;
    zh:release_verify) printf '验证发布清单签名和文件校验和' ;;
    en:release_verify) printf 'Verify release manifest signatures and file checksums' ;;
    zh:database_backup) printf '创建升级前数据库备份' ;;
    en:database_backup) printf 'Create a pre-upgrade database backup' ;;
    zh:docker_compose_os_unsupported) printf '无法识别支持 Docker Compose v2 软件包的包管理器（需要 apt-get、dnf 或 yum）' ;;
    en:docker_compose_os_unsupported) printf 'Could not find a package manager supported for Docker Compose v2 (apt-get, dnf, or yum required)' ;;
    zh:linux_only) printf '当前安装器仅支持 Linux' ;;
    en:linux_only) printf 'This installer only supports Linux' ;;
    zh:run_as_root) printf '请使用 sudo 运行安装器（默认写入 %s）' "$1" ;;
    en:run_as_root) printf 'Run the installer with sudo (default install directory: %s)' "$1" ;;
    zh:timeout_invalid) printf 'CREWQUAL_INSTALL_TIMEOUT_SECONDS 必须是正整数' ;;
    en:timeout_invalid) printf 'CREWQUAL_INSTALL_TIMEOUT_SECONDS must be a positive integer' ;;
    zh:install_dir_invalid) printf '安装目录必须是非根目录的绝对路径' ;;
    en:install_dir_invalid) printf 'Install directory must be an absolute path other than /' ;;
    zh:install_dir_unsafe) printf '安装目录不安全（必须是当前用户所有、非符号链接且不允许组/其他用户写入）: %s' "$1" ;;
    en:install_dir_unsafe) printf 'Unsafe install directory (must be owned by the current user, not a symlink, and not group/world-writable): %s' "$1" ;;
    zh:install_dir_component_unsafe) printf '安装目录路径组件不安全（必须由可信用户所有、非符号链接且不允许组/其他用户写入）: %s（安装目录: %s）' "$1" "$2" ;;
    en:install_dir_component_unsafe) printf 'Unsafe install-directory path component (must have a trusted owner, not be a symlink, and not be group/world-writable): %s (install directory: %s)' "$1" "$2" ;;
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

detect_wsl() {
  case "${CREWQUAL_INSTALL_TEST_PLATFORM:-}" in
    wsl) return 0 ;;
    linux) return 1 ;;
  esac
  [[ -n "${WSL_INTEROP:-}" || -n "${WSL_DISTRO_NAME:-}" ]] && return 0
  grep -qi microsoft /proc/sys/kernel/osrelease 2>/dev/null && return 0
  grep -qi microsoft /proc/version 2>/dev/null
}

configure_host_platform() {
  if detect_wsl; then
    IS_WSL=1
    UPDATER_MODE="manual"
    UPDATER_HOST_DIR="$INSTALL_DIR/.updater-runtime"
    log "$(msg wsl_detected)"
  fi
}

docker_command_available() {
  [[ "${CREWQUAL_INSTALL_TEST_DOCKER_MISSING:-0}" != "1" ]] && command -v docker >/dev/null 2>&1
}

on_interrupt() {
  trap - INT TERM
  if ((UI_ACTIVE)); then
    printf '\n%s\n' "$(msg install_interrupted)" >>"$UI_LOG_FILE"
    ui_shutdown
    printf '\n%s\n' "$(msg install_interrupted)" >/dev/tty 2>/dev/null || true
    [[ -n "$UI_LOG_FILE" ]] && printf '%s\n' "$(msg view_install_log "$UI_LOG_FILE")" >/dev/tty 2>/dev/null || true
  else
    printf '\n%s\n' "$(msg install_interrupted)" >&2
  fi
  exit 130
}

run_with_timeout() {
  local seconds="$1"
  shift
  timeout --foreground --kill-after=10s "${seconds}s" "$@"
}

curl_fetch() {
  local heartbeat_pid="" status=0
  if ((!UI_ACTIVE)); then
    (
      while :; do
        sleep "$NETWORK_PROGRESS_INTERVAL_SECONDS"
        printf '%s\n' "$(msg network_wait "$NETWORK_TIMEOUT_SECONDS" "$NETWORK_RETRY_TIMEOUT_SECONDS")" >&2
      done
    ) &
    heartbeat_pid=$!
  fi

  curl --fail --show-error --location --progress-bar \
    --retry 3 --retry-all-errors --retry-max-time "$NETWORK_RETRY_TIMEOUT_SECONDS" \
    --connect-timeout 15 --max-time "$NETWORK_TIMEOUT_SECONDS" "$@" || status=$?

  if [[ -n "$heartbeat_pid" ]]; then
    kill "$heartbeat_pid" 2>/dev/null || true
    wait "$heartbeat_pid" 2>/dev/null || true
  fi
  return "$status"
}

check_docker_daemon() {
  local output="" status=0 heartbeat_pid=""
  if ((!UI_ACTIVE)); then
    (
      while :; do
        sleep 10
        printf '%s\n' "$(msg docker_wait "$DOCKER_COMMAND_TIMEOUT_SECONDS")" >&2
      done
    ) &
    heartbeat_pid=$!
  fi
  if output="$(run_with_timeout "$DOCKER_COMMAND_TIMEOUT_SECONDS" docker info 2>&1)"; then
    status=0
  else
    status=$?
  fi
  if [[ -n "$heartbeat_pid" ]]; then
    kill "$heartbeat_pid" 2>/dev/null || true
    wait "$heartbeat_pid" 2>/dev/null || true
  fi
  [[ "$status" == "0" ]] && return 0
  [[ -n "$output" ]] && printf '%s\n' "$output" >&2
  if [[ "$status" == "124" || "$status" == "137" ]]; then
    echo "$(msg command_timeout "$DOCKER_COMMAND_TIMEOUT_SECONDS")" >&2
  fi
  return "$status"
}

check_compose_plugin() {
  local output="" status=0 heartbeat_pid=""
  if ((!UI_ACTIVE)); then
    (
      while :; do
        sleep 10
        printf '%s\n' "$(msg compose_wait "$DOCKER_COMMAND_TIMEOUT_SECONDS")" >&2
      done
    ) &
    heartbeat_pid=$!
  fi
  if output="$(run_with_timeout "$DOCKER_COMMAND_TIMEOUT_SECONDS" docker compose version 2>&1)"; then
    status=0
  else
    status=$?
  fi
  if [[ -n "$heartbeat_pid" ]]; then
    kill "$heartbeat_pid" 2>/dev/null || true
    wait "$heartbeat_pid" 2>/dev/null || true
  fi
  [[ "$status" == "0" ]] && return 0
  [[ -n "$output" ]] && printf '%s\n' "$output" >&2
  if [[ "$status" == "124" || "$status" == "137" ]]; then
    echo "$(msg command_timeout "$DOCKER_COMMAND_TIMEOUT_SECONDS")" >&2
  fi
  return "$status"
}

report_command_timeout() {
  local status="$1"
  local seconds="$2"
  [[ "$status" == "124" || "$status" == "137" ]] &&
    echo "$(msg command_timeout "$seconds")" >&2
}

report_network_failure() {
  local status="$1"
  if [[ "$status" == "28" ]]; then
    echo "$(msg network_timeout "$NETWORK_TIMEOUT_SECONDS")" >&2
  else
    echo "$(msg network_failed)" >&2
  fi
}

download_asset() {
  local label="$1"
  local url="$2"
  local destination="$3"
  local status=0
  log "$(msg download_asset "$label")"
  if curl_fetch "$url" -o "$destination"; then
    return 0
  else
    status=$?
  fi
  report_network_failure "$status"
  die "$(msg download_failed "$label")"
}

trap on_interrupt INT TERM

prompt_yes_no() {
  local prompt="$1"
  local result=""
  ((NON_INTERACTIVE)) && return 1
  if ((UI_ACTIVE)); then
    result="$(ui_select "$prompt" "" 1 "$(msg yes_option)" "$(msg no_option)")"
    [[ "$result" == "0" ]]
    return
  fi
  [[ -r /dev/tty ]] || die "$(msg no_tty)"
  read -r -p "$prompt" result </dev/tty
  case "$result" in
    y|Y|yes|YES|Yes) return 0 ;;
    *) return 1 ;;
  esac
}

install_docker_engine() {
  local script_path
  script_path="$(mktemp)"
  log "$(msg docker_install_engine)"
  log "$(msg docker_installer_download)"
  if ! curl_fetch https://get.docker.com -o "$script_path"; then
    rm -f -- "$script_path"
    die "$(msg docker_install_engine_failed)"
  fi
  if DEBIAN_FRONTEND=noninteractive run_with_timeout "$PACKAGE_TIMEOUT_SECONDS" sh "$script_path"; then
    :
  else
    local status=$?
    rm -f -- "$script_path"
    report_command_timeout "$status" "$PACKAGE_TIMEOUT_SECONDS"
    die "$(msg docker_install_engine_failed)"
  fi
  rm -f -- "$script_path"
  if command -v systemctl >/dev/null 2>&1 && ! check_docker_daemon; then
    log "$(msg docker_start "$DOCKER_COMMAND_TIMEOUT_SECONDS")"
    run_with_timeout "$DOCKER_COMMAND_TIMEOUT_SECONDS" systemctl enable --now docker || true
  fi
  check_docker_daemon || die "$(msg docker_install_engine_failed)"
}

install_compose_plugin() {
  log "$(msg docker_install_compose)"
  if command -v apt-get >/dev/null 2>&1; then
    log "$(msg package_update)"
    if DEBIAN_FRONTEND=noninteractive run_with_timeout "$PACKAGE_TIMEOUT_SECONDS" apt-get update; then
      :
    else
      local status=$?
      report_command_timeout "$status" "$PACKAGE_TIMEOUT_SECONDS"
      die "$(msg docker_install_compose_failed)"
    fi
    log "$(msg package_install)"
    if DEBIAN_FRONTEND=noninteractive run_with_timeout "$PACKAGE_TIMEOUT_SECONDS" apt-get install -y docker-compose-plugin; then
      :
    else
      local status=$?
      report_command_timeout "$status" "$PACKAGE_TIMEOUT_SECONDS"
      die "$(msg docker_install_compose_failed)"
    fi
  elif command -v dnf >/dev/null 2>&1; then
    log "$(msg package_install)"
    DEBIAN_FRONTEND=noninteractive run_with_timeout "$PACKAGE_TIMEOUT_SECONDS" dnf install -y docker-compose-plugin || die "$(msg docker_install_compose_failed)"
  elif command -v yum >/dev/null 2>&1; then
    log "$(msg package_install)"
    DEBIAN_FRONTEND=noninteractive run_with_timeout "$PACKAGE_TIMEOUT_SECONDS" yum install -y docker-compose-plugin || die "$(msg docker_install_compose_failed)"
  else
    die "$(msg docker_compose_os_unsupported)"
  fi
  check_compose_plugin || die "$(msg docker_install_compose_failed)"
}

ensure_docker_engine() {
  log "$(msg docker_check "$DOCKER_COMMAND_TIMEOUT_SECONDS")"
  if ((IS_WSL)); then
    docker_command_available || die "$(msg wsl_docker_missing)"
    ((AUTO_INSTALL_DOCKER)) && echo "$(msg wsl_install_docker_ignored)" >&2
    check_docker_daemon || die "$(msg wsl_docker_unavailable)"
    log "$(msg docker_ready)"
    return 0
  fi

  if ! docker_command_available; then
    if ((AUTO_INSTALL_DOCKER)) || prompt_yes_no "$(msg docker_engine_prompt)"; then
      install_docker_engine
    elif ((NON_INTERACTIVE)); then
      die "$(msg docker_install_noninteractive "$(msg docker_engine_missing)")"
    else
      die "$(msg docker_install_declined)"
    fi
  fi

  if ! check_docker_daemon; then
    if command -v systemctl >/dev/null 2>&1 && \
      { ((AUTO_INSTALL_DOCKER)) || prompt_yes_no "$(msg docker_daemon_prompt)"; }; then
      log "$(msg docker_start "$DOCKER_COMMAND_TIMEOUT_SECONDS")"
      run_with_timeout "$DOCKER_COMMAND_TIMEOUT_SECONDS" systemctl enable --now docker || die "$(msg docker_install_engine_failed)"
    elif ((NON_INTERACTIVE)); then
      die "$(msg docker_install_noninteractive "$(msg docker_daemon_missing)")"
    else
      die "$(msg compose_unavailable)"
    fi
  fi

  check_docker_daemon || die "$(msg compose_unavailable)"
  log "$(msg docker_ready)"
}

ensure_compose_plugin() {
  log "$(msg compose_check "$DOCKER_COMMAND_TIMEOUT_SECONDS")"
  check_compose_plugin && {
    log "$(msg compose_ready)"
    return 0
  }
  ((IS_WSL)) && die "$(msg wsl_compose_unavailable)"
  if ((AUTO_INSTALL_DOCKER)) || prompt_yes_no "$(msg compose_plugin_prompt)"; then
    install_compose_plugin
  elif ((NON_INTERACTIVE)); then
    die "$(msg docker_install_noninteractive "$(msg compose_plugin_missing)")"
  else
    die "$(msg docker_install_declined)"
  fi
  check_compose_plugin || die "$(msg docker_install_compose_failed)"
  log "$(msg compose_ready)"
}

atomic_install() {
  local source="$1"
  local target="$2"
  local mode="$3"
  local staged="${target}.new"
  install -m "$mode" "$source" "$staged" || return $?
  mv -f -- "$staged" "$target"
}

acquire_deployment_lock() {
  local lock_path="$DEPLOYMENT_LOCK_PATH"
  if [[ "${CREWQUAL_INSTALL_TEST_MODE:-0}" == "1" ]]; then
    lock_path="$INSTALL_DIR/.deployment.lock"
  else
    install -d -m 0755 "$(dirname -- "$lock_path")"
  fi
  touch -- "$lock_path"
  chmod 0600 "$lock_path"
  exec {DEPLOYMENT_LOCK_FD}>"$lock_path"
  if ! flock -w "$DOCKER_COMMAND_TIMEOUT_SECONDS" "$DEPLOYMENT_LOCK_FD"; then
    echo "$(msg deployment_lock_failed)" >&2
    eval "exec ${DEPLOYMENT_LOCK_FD}>&-" 2>/dev/null || true
    DEPLOYMENT_LOCK_FD=""
    DEPLOYMENT_LOCK_HELD=0
    return 1
  fi
  DEPLOYMENT_LOCK_HELD=1
}

release_deployment_lock() {
  if [[ -n "$DEPLOYMENT_LOCK_FD" ]]; then
    flock -u "$DEPLOYMENT_LOCK_FD" >/dev/null 2>&1 || true
    eval "exec ${DEPLOYMENT_LOCK_FD}>&-" 2>/dev/null || true
    DEPLOYMENT_LOCK_FD=""
  fi
  DEPLOYMENT_LOCK_HELD=0
}

prepare_install_directory() {
  local mode mode_value owner path test_mode trusted_owner
  normalize_install_directory_path
  ENV_FILE="$INSTALL_DIR/.env"
  COMPOSE_FILE="$INSTALL_DIR/compose.yaml"

  test_mode="${CREWQUAL_INSTALL_TEST_MODE:-0}"
  trusted_owner=0
  [[ "$test_mode" == "1" ]] && trusted_owner="$(id -u)"
  path="$INSTALL_DIR"
  while :; do
    if [[ -e "$path" || -L "$path" ]]; then
      [[ -d "$path" && ! -L "$path" ]] || die "$(msg install_dir_component_unsafe "$path" "$INSTALL_DIR")"
      owner="$(stat -c '%u' -- "$path")"
      mode="$(stat -c '%a' -- "$path")"
      [[ "$owner" == "0" || "$owner" == "$trusted_owner" ]] || die "$(msg install_dir_component_unsafe "$path" "$INSTALL_DIR")"
      [[ "$mode" =~ ^[0-7]{3,4}$ ]] || die "$(msg install_dir_component_unsafe "$path" "$INSTALL_DIR")"
      mode_value=$((8#$mode))
      if (((mode_value & 0022) != 0)); then
        # Production roots need an unbroken chain of non-writable ancestors.
        # Tests may live below the root-owned sticky /tmp harness directory.
        [[ "$test_mode" == "1" && "$path" != "$INSTALL_DIR" && "$owner" == "0" ]] ||
          die "$(msg install_dir_component_unsafe "$path" "$INSTALL_DIR")"
        (((mode_value & 01000) != 0)) || die "$(msg install_dir_component_unsafe "$path" "$INSTALL_DIR")"
      fi
    fi
    [[ "$path" == "/" ]] && break
    path="$(dirname -- "$path")"
  done

  if [[ -e "$INSTALL_DIR" || -L "$INSTALL_DIR" ]]; then
    return 0
  fi
  # Do not inherit a caller's permissive umask. The host updater deliberately
  # rejects a managed root that another local user could modify.
  install -d -m 0755 -- "$INSTALL_DIR"
  normalize_install_directory_path
  [[ -d "$INSTALL_DIR" && ! -L "$INSTALL_DIR" ]] || die "$(msg install_dir_unsafe "$INSTALL_DIR")"
  owner="$(stat -c '%u' -- "$INSTALL_DIR")"
  mode="$(stat -c '%a' -- "$INSTALL_DIR")"
  [[ "$owner" == "$trusted_owner" && "$mode" =~ ^[0-7]{3,4}$ ]] || die "$(msg install_dir_unsafe "$INSTALL_DIR")"
  mode_value=$((8#$mode))
  (((mode_value & 0022) == 0)) || die "$(msg install_dir_unsafe "$INSTALL_DIR")"
}

normalize_install_directory_path() {
  local normalized physical
  require_command realpath
  [[ "$INSTALL_DIR" == /* && "$INSTALL_DIR" != "/" ]] || die "$(msg install_dir_invalid)"
  normalized="$(realpath -ms -- "$INSTALL_DIR")" || die "$(msg install_dir_unsafe "$INSTALL_DIR")"
  [[ "$normalized" == /* && "$normalized" != "/" ]] || die "$(msg install_dir_invalid)"
  physical="$(realpath -m -- "$normalized")" || die "$(msg install_dir_unsafe "$INSTALL_DIR")"
  [[ "$physical" == "$normalized" ]] || die "$(msg install_dir_unsafe "$INSTALL_DIR")"
  INSTALL_DIR="$normalized"
}

report_caddy_recovery_failure() {
  echo "--- $CADDY_RECOVERY_UNIT failure details ---" >&2
  systemctl show "$CADDY_RECOVERY_UNIT" \
    --property=Result,ExecMainCode,ExecMainStatus,ActiveState,SubState --no-pager >&2 || true
  systemctl status "$CADDY_RECOVERY_UNIT" --no-pager --full >&2 || true
  journalctl --unit "$CADDY_RECOVERY_UNIT" --lines 80 --no-pager >&2 || true
  stat -Lc '%U:%G %a %F %n' -- \
    "$INSTALL_DIR" "$INSTALL_DIR/.crewqual-official-install" \
    "$ENV_FILE" "$COMPOSE_FILE" "$INSTALL_DIR/Caddyfile" >&2 || true
}

deployment_state_token() {
  local path
  {
    for path in \
      "$INSTALL_DIR/.crewqual-official-install" \
      "$ENV_FILE" \
      "$COMPOSE_FILE" \
      "$INSTALL_DIR/Caddyfile" \
      "$INSTALL_DIR/configure-domain.sh" \
      "$INSTALL_DIR/tls/fullchain.pem" \
      "$INSTALL_DIR/tls/privkey.pem"; do
      printf '%s\0' "$path"
      if [[ -L "$path" ]]; then
        printf 'symlink\n'
      elif [[ -f "$path" ]]; then
        sha256sum "$path" | awk '{print $1}'
      else
        printf 'absent\n'
      fi
    done
  } | sha256sum | awk '{print $1}'
}

compose() {
  "${COMPOSE[@]}" "$@"
}

cleanup() {
  ui_shutdown || true
  if ((REPAIR_PENDING)); then restore_updater_repair || true; fi
  release_deployment_lock
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
  if ((UI_ACTIVE)); then
    printf '\n%s\n' "$(msg deployment_failed "$exit_code")" >>"$UI_LOG_FILE"
    restore_existing_install >>"$UI_LOG_FILE" 2>&1 || true
    show_diagnostics >>"$UI_LOG_FILE" 2>&1 || true
    ui_shutdown
    {
      printf '\n%s\n' "$(msg deployment_failed "$exit_code")"
      [[ -n "$UI_LAST_TASK" ]] && printf '%s: %s\n' "$(msg failed_step)" "$UI_LAST_TASK"
      printf '%s\n' "$(msg view_install_log "$UI_LOG_FILE")"
      printf '%s\n' "$(msg recent_log)"
      ui_sanitized_tail 20 120
    } >/dev/tty 2>/dev/null || true
  else
    restore_existing_install || true
    printf '\n%s\n' "$(msg deployment_failed "$exit_code")" >&2
    show_diagnostics
  fi
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
  if [[ -f "$INSTALL_DIR/tls/fullchain.pem" ]]; then
    PREVIOUS_TLS_CERT=1
    mkdir -p -- "$ROLLBACK_DIR/tls"
    cp -p -- "$INSTALL_DIR/tls/fullchain.pem" "$ROLLBACK_DIR/tls/fullchain.pem"
  fi
  if [[ -f "$INSTALL_DIR/tls/privkey.pem" ]]; then
    PREVIOUS_TLS_KEY=1
    mkdir -p -- "$ROLLBACK_DIR/tls"
    cp -p -- "$INSTALL_DIR/tls/privkey.pem" "$ROLLBACK_DIR/tls/privkey.pem"
  fi
}

create_upgrade_database_backup() {
  [[ "$EXISTING_INSTALL" == "1" ]] || return 0
  log "$(msg database_backup)"
  UPGRADE_DB_BACKUP="$ROLLBACK_DIR/database.dump"
  compose exec -T postgres pg_dump -U crewqual -d crewqual --format=custom >"$UPGRADE_DB_BACKUP"
  [[ -s "$UPGRADE_DB_BACKUP" ]] || die "无法创建升级前数据库备份，已停止升级"
  chmod 600 "$UPGRADE_DB_BACKUP"
}

restore_existing_install() {
  [[ "$EXISTING_INSTALL" == "1" && -n "$ROLLBACK_DIR" && -d "$ROLLBACK_DIR" ]] || return 0
  if ((DEPLOYMENT_LOCK_HELD == 0)); then
    echo "警告: 未持有部署锁，已跳过自动回滚以避免与更新器并发写入。" >&2
    return 1
  fi
  if ((ROLLBACK_STATE_GUARD_REQUIRED)) &&
    [[ -z "$ROLLBACK_STATE_TOKEN" || "$(deployment_state_token)" != "$ROLLBACK_STATE_TOKEN" ]]; then
    echo "警告: 部署锁交接期间受管理文件已被其他任务修改，已跳过旧快照回滚。" >&2
    return 1
  fi
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
  if ((PREVIOUS_TLS_CERT)); then
    atomic_install "$ROLLBACK_DIR/tls/fullchain.pem" "$INSTALL_DIR/tls/fullchain.pem" 0644 || failed=1
  elif [[ -f "$INSTALL_DIR/tls/fullchain.pem" ]]; then
    rm -f -- "$INSTALL_DIR/tls/fullchain.pem" || failed=1
  fi
  if ((PREVIOUS_TLS_KEY)); then
    atomic_install "$ROLLBACK_DIR/tls/privkey.pem" "$INSTALL_DIR/tls/privkey.pem" 0600 || failed=1
  elif [[ -f "$INSTALL_DIR/tls/privkey.pem" ]]; then
    rm -f -- "$INSTALL_DIR/tls/privkey.pem" || failed=1
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
  [[ "$1" =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-rc\.(0|[1-9][0-9]*))?$ ]] ||
    die "$(msg version_invalid "$1")"
}

validate_channel() {
  [[ "$1" == "stable" || "$1" == "rc" ]] || die "channel must be stable or rc: $1"
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

custom_tls_requested() {
  [[ -n "$TLS_CERT_INPUT" || -n "$TLS_KEY_INPUT" ]]
}

validate_custom_tls() {
  local domain="$1" cert="$TLS_CERT_INPUT" key="$TLS_KEY_INPUT"
  if [[ -z "$cert" || -z "$key" ]]; then
    die "$(msg tls_cert_pair)"
  fi
  [[ -f "$cert" && -r "$cert" ]] || die "$(msg tls_cert_file "$cert")"
  [[ -f "$key" && -r "$key" ]] || die "$(msg tls_key_file "$key")"
  openssl x509 -in "$cert" -noout >/dev/null 2>&1 || die "$(msg tls_cert_invalid "$cert")"
  openssl pkey -in "$key" -passin pass: -noout >/dev/null 2>&1 || die "$(msg tls_key_invalid "$key")"
  openssl x509 -in "$cert" -checkend 0 -noout >/dev/null 2>&1 || die "$(msg tls_cert_expired "$cert")"
  openssl x509 -in "$cert" -checkhost "$domain" -noout >/dev/null 2>&1 || die "$(msg tls_cert_domain "$domain")"

  local cert_public key_public
  cert_public="$(openssl x509 -in "$cert" -pubkey -noout | openssl pkey -pubin -outform DER 2>/dev/null | sha256sum | awk '{print $1}')" ||
    die "$(msg tls_cert_invalid "$cert")"
  key_public="$(openssl pkey -in "$key" -passin pass: -pubout -outform DER 2>/dev/null | sha256sum | awk '{print $1}')" ||
    die "$(msg tls_key_invalid "$key")"
  [[ -n "$cert_public" && "$cert_public" == "$key_public" ]] || die "$(msg tls_cert_key_mismatch)"
}

set_tls_config_values() {
  if [[ -n "$CADDY_TLS_CONFIG_VALUE" ]]; then
    CADDY_EMAIL_CONFIG_VALUE=""
  else
    CADDY_EMAIL_CONFIG_VALUE="email $TLS_EMAIL_INPUT"
  fi
}

prepare_custom_tls_files() {
  local tls_dir="$INSTALL_DIR/tls"
  local cert_target="$tls_dir/fullchain.pem"
  local key_target="$tls_dir/privkey.pem"
  install -d -m 0700 "$tls_dir"

  if [[ -n "$CADDY_TLS_CONFIG_VALUE" ]]; then
    if custom_tls_requested; then
      if [[ ! -f "$cert_target" ]] || ! cmp -s "$TLS_CERT_INPUT" "$cert_target"; then
        install -m 0644 "$TLS_CERT_INPUT" "$cert_target"
      else
        chmod 0644 "$cert_target"
      fi
      if [[ ! -f "$key_target" ]] || ! cmp -s "$TLS_KEY_INPUT" "$key_target"; then
        install -m 0600 "$TLS_KEY_INPUT" "$key_target"
      else
        chmod 0600 "$key_target"
      fi
    else
      [[ -s "$cert_target" && -s "$key_target" ]] || die "$(msg tls_custom_missing_installed)"
      chmod 0644 "$cert_target"
      chmod 0600 "$key_target"
    fi
  else
    [[ -e "$cert_target" ]] || install -m 0644 /dev/null "$cert_target"
    [[ -e "$key_target" ]] || install -m 0600 /dev/null "$key_target"
  fi
}

validate_port() {
  [[ "$1" =~ ^[0-9]+$ && "$1" -ge 1 && "$1" -le 65535 ]] ||
    die "$(msg port_invalid "$1")"
}

validate_lan_address() {
  local value="$1"
  if [[ "$value" == "localhost" || "$value" == "127.0.0.1" ]]; then
    return 0
  fi
  [[ "$value" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || die "$(msg lan_ipv4 "$value")"
  local part
  IFS=. read -r -a parts <<<"$value"
  for part in "${parts[@]}"; do
    ((part <= 255)) || die "$(msg lan_invalid "$value")"
  done
  [[ "$value" == 10.* || "$value" == 192.168.* || "$value" =~ ^172\.(1[6-9]|2[0-9]|3[0-1])\. ]] ||
    die "$(msg lan_private "$value")"
}

validate_public_address() {
  local value="$1" part
  local -a parts=()
  [[ -n "$value" && "$value" != *://* && "$value" != */* && "$value" != *:* && "$value" != *[[:space:]]* ]] ||
    die "$(msg public_address_invalid "$value")"
  if [[ "$value" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
    IFS=. read -r -a parts <<<"$value"
    for part in "${parts[@]}"; do
      ((part <= 255)) || die "$(msg public_address_invalid "$value")"
    done
    [[ "$value" != "0.0.0.0" && "$value" != 127.* ]] ||
      die "$(msg public_address_invalid "$value")"
    return 0
  fi
  [[ "$value" =~ ^([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$ ]] ||
    die "$(msg public_address_invalid "$value")"
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
      elif ((UI_ACTIVE)); then
        choice="$(ui_select "$(msg port_title)" "" 0 \
          "$(msg port_default_option)" "$(msg port_random_option)" "$(msg port_custom_option)")"
        case "$choice" in
          1) APP_PORT_INPUT="$(random_free_port)" ;;
          2) APP_PORT_INPUT="$(prompt_value "$(msg custom_port_prompt)")" ;;
          *) APP_PORT_INPUT=8080 ;;
        esac
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
  if ((IS_WSL)); then
    printf '%s' 'localhost'
    return 0
  fi
  for value in $(hostname -I 2>/dev/null || true); do
    if [[ "$value" =~ ^10\. || "$value" =~ ^192\.168\. || "$value" =~ ^172\.(1[6-9]|2[0-9]|3[0-1])\. ]]; then
      printf '%s' "$value"
      return 0
    fi
  done
  return 1
}

detect_public_address() {
  local value
  for value in $(hostname -I 2>/dev/null || true); do
    if [[ "$value" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] &&
      [[ ! "$value" =~ ^10\. ]] &&
      [[ ! "$value" =~ ^192\.168\. ]] &&
      [[ ! "$value" =~ ^172\.(1[6-9]|2[0-9]|3[0-1])\. ]] &&
      [[ ! "$value" =~ ^127\. ]]; then
      printf '%s' "$value"
      return 0
    fi
  done
  return 1
}

prepare_network_config() {
  local lan_only_answer="" detected_public_address="" public_prompt_default=""
  if [[ -z "$NETWORK_MODE_INPUT" ]]; then
    if [[ -n "$APP_DOMAIN_INPUT" || -n "$TLS_EMAIL_INPUT" ]]; then
      NETWORK_MODE_INPUT="tls"
    elif ((NON_INTERACTIVE)); then
      if ((IS_WSL)); then
        NETWORK_MODE_INPUT="lan"
      else
        die "$(msg network_required)"
      fi
    else
      if ((UI_ACTIVE)); then
        case "$(ui_select "$(msg network_title)" "$(msg network_description)" 0 \
          "$(msg network_lan)" "$(msg network_tls)")" in
          1) NETWORK_MODE_INPUT="tls" ;;
          *) NETWORK_MODE_INPUT="lan" ;;
        esac
      else
        case "$(prompt_value "$(msg network_prompt)")" in
          2) NETWORK_MODE_INPUT="tls" ;;
          *) NETWORK_MODE_INPUT="lan" ;;
        esac
      fi
    fi
  fi
  [[ "$NETWORK_MODE_INPUT" == "lan" || "$NETWORK_MODE_INPUT" == "http" || "$NETWORK_MODE_INPUT" == "tls" ]] ||
    die "$(msg network_invalid)"
  if [[ "$NETWORK_MODE_INPUT" != "tls" ]] && custom_tls_requested; then
    die "$(msg tls_custom_non_tls)"
  fi

  if [[ "$NETWORK_MODE_INPUT" == "lan" && "$NON_INTERACTIVE" == "0" ]]; then
    if ((UI_ACTIVE)); then
      case "$(ui_select "$(msg lan_scope_title)" "$(msg lan_scope_description)" 0 \
        "$(msg lan_scope_only)" "$(msg lan_scope_public)")" in
        1) lan_only_answer="n" ;;
        *) lan_only_answer="y" ;;
      esac
    else
      lan_only_answer="$(prompt_value "$(msg lan_only_prompt)")"
    fi
    case "$lan_only_answer" in
      n|N|no|NO|No|否)
        NETWORK_MODE_INPUT="http"
        if ((UI_ACTIVE)); then
          case "$(ui_select "$(msg public_http_confirm)" "$(msg public_http_warning)" 1 \
            "$(msg yes_option)" "$(msg no_option)")" in
            0) ;;
            *) die "$(msg public_http_declined)" ;;
          esac
        else
          echo "$(msg public_http_warning)" >&2
          prompt_yes_no "$(msg public_http_confirm)" || die "$(msg public_http_declined)"
        fi
        ;;
    esac
  elif [[ "$NETWORK_MODE_INPUT" == "http" ]]; then
    echo "$(msg public_http_warning)" >&2
  fi

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
    CADDY_TLS_CONFIG_VALUE=""
    set_tls_config_values
    APP_ORIGIN_VALUE="http://${LAN_ADDRESS_INPUT}:${APP_PORT_INPUT}"
    CADDY_SITE_ADDRESS_VALUE="http://:${APP_PORT_INPUT}"
    if [[ "$LAN_ADDRESS_INPUT" == "localhost" || "$LAN_ADDRESS_INPUT" == "127.0.0.1" ]]; then
      APP_BIND_VALUE="127.0.0.1"
    else
      APP_BIND_VALUE="0.0.0.0"
      ((IS_WSL)) && echo "$(msg wsl_lan_firewall "$LAN_ADDRESS_INPUT" "$APP_PORT_INPUT")" >&2
    fi
    ACME_BIND_VALUE="127.0.0.1"
    ACME_PORT_VALUE="18080"
    if ! port_is_available "$ACME_PORT_VALUE"; then
      ACME_PORT_VALUE="$(random_free_port)"
    fi
  elif [[ "$NETWORK_MODE_INPUT" == "http" ]]; then
    if [[ -z "$PUBLIC_ADDRESS_INPUT" ]]; then
      PUBLIC_ADDRESS_INPUT="$APP_DOMAIN_INPUT"
    fi
    if [[ -z "$PUBLIC_ADDRESS_INPUT" ]]; then
      if ((NON_INTERACTIVE)); then
        die "$(msg public_address_required)"
      fi
      detected_public_address="$(detect_public_address || true)"
      public_prompt_default="${detected_public_address:-$(if [[ "$LANGUAGE_INPUT" == en ]]; then printf 'enter the VPS public IP'; else printf '请输入 VPS 公网 IP'; fi)}"
      PUBLIC_ADDRESS_INPUT="$(prompt_value "$(msg public_address_prompt "$public_prompt_default")")"
      [[ -n "$PUBLIC_ADDRESS_INPUT" ]] || PUBLIC_ADDRESS_INPUT="$detected_public_address"
    fi
    validate_public_address "$PUBLIC_ADDRESS_INPUT"
    APP_DOMAIN_INPUT="$PUBLIC_ADDRESS_INPUT"
    TLS_EMAIL_INPUT="crewqual-local@lan.invalid"
    CADDY_TLS_CONFIG_VALUE=""
    set_tls_config_values
    APP_ORIGIN_VALUE="http://${PUBLIC_ADDRESS_INPUT}:${APP_PORT_INPUT}"
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
    validate_domain "$APP_DOMAIN_INPUT"
    if custom_tls_requested; then
      validate_custom_tls "$APP_DOMAIN_INPUT"
      TLS_EMAIL_INPUT="${TLS_EMAIL_INPUT:-crewqual-local@lan.invalid}"
      CADDY_TLS_CONFIG_VALUE='tls /etc/caddy/tls/fullchain.pem /etc/caddy/tls/privkey.pem'
    else
      [[ -n "$TLS_EMAIL_INPUT" ]] || {
        ((NON_INTERACTIVE)) && die "$(msg tls_email_required)"
        TLS_EMAIL_INPUT="$(prompt_value "$(msg tls_email_prompt)")"
      }
      validate_email "$TLS_EMAIL_INPUT"
      CADDY_TLS_CONFIG_VALUE=""
    fi
    set_tls_config_values
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
  if ((UI_ACTIVE)); then
    ui_input "$prompt"
    return
  fi
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
    elif ((UI_ACTIVE)); then
      choice="$(ui_select "选择语言 / Choose language" "" 0 "中文" "English")"
      case "$choice" in
        1) LANGUAGE_INPUT="en" ;;
        *) LANGUAGE_INPUT="zh" ;;
      esac
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
  local release_json="" status=0
  if [[ -n "$RELEASE_VERSION" ]]; then
    validate_version "$RELEASE_VERSION"
    if [[ "$RELEASE_VERSION" == *-rc.* ]]; then CHANNEL_INPUT="rc"; fi
    validate_channel "$CHANNEL_INPUT"
    return
  fi
  log "$(msg resolve_latest)"
  local endpoint="https://api.github.com/repos/${GITHUB_REPOSITORY}/releases/latest"
  [[ "$CHANNEL_INPUT" == "rc" ]] && endpoint="https://api.github.com/repos/${GITHUB_REPOSITORY}/releases?per_page=100"
  if release_json="$(curl_fetch \
    -H 'Accept: application/vnd.github+json' \
    -H 'X-GitHub-Api-Version: 2022-11-28' \
    "$endpoint")"; then
    :
  else
    status=$?
    report_network_failure "$status"
    die "$(msg release_unavailable)"
  fi
  RELEASE_VERSION="$(printf '%s' "$release_json" | sed -nE 's/.*"tag_name":[[:space:]]*"([^"]+)".*/\1/p' | head -n 1)"
  [[ -n "$RELEASE_VERSION" ]] || die "$(msg release_unavailable)"
  [[ "$CHANNEL_INPUT" == "rc" || "$RELEASE_VERSION" != *-rc.* ]] || die "stable channel returned a release candidate"
  validate_version "$RELEASE_VERSION"
  echo "$(msg latest_version "$RELEASE_VERSION")"
}

manifest_value() {
  local key="$1"
  sed -nE "s/.*\"${key}\"[[:space:]]*:[[:space:]]*\"([^\"]+)\".*/\1/p" "$TEMP_DIR/update-manifest-v1.json" | head -n 1
}

resolve_trusted_public_key() {
  TRUSTED_KEY_ID_VALUE="$(manifest_value signingKeyId)"
  [[ -n "$TRUSTED_KEY_ID_VALUE" ]] || die "$(msg trusted_key_missing)"
  TRUSTED_PUBLIC_KEY_VALUE=""
  if [[ "${CREWQUAL_INSTALL_TEST_MODE:-0}" == "1" && -n "${CREWQUAL_TEST_TRUSTED_PUBLIC_KEY:-}" ]]; then
    TRUSTED_PUBLIC_KEY_VALUE="$CREWQUAL_TEST_TRUSTED_PUBLIC_KEY"
    [[ "${CREWQUAL_TEST_KEY_ID:-$TRUSTED_KEY_ID_VALUE}" == "$TRUSTED_KEY_ID_VALUE" ]] || die "$(msg trusted_key_missing)"
  else
    local legacy="${CREWQUAL_UPDATER_TRUSTED_PUBLIC_KEY:-}"
    if [[ -n "$legacy" ]]; then
      printf '%s' "$BUILTIN_UPDATE_KEYRING_JSON" | grep -Fq "\"id\":\"$TRUSTED_KEY_ID_VALUE\"" || die "$(msg trusted_key_missing)"
      printf '%s' "$BUILTIN_UPDATE_KEYRING_JSON" | grep -Fq "\"publicKey\":\"$legacy\"" || die "$(msg trusted_key_missing)"
      TRUSTED_PUBLIC_KEY_VALUE="$legacy"
    else
      TRUSTED_PUBLIC_KEY_VALUE="$(printf '%s' "$BUILTIN_UPDATE_KEYRING_JSON" | sed -nE "s/.*\"id\":\"$TRUSTED_KEY_ID_VALUE\"[^}]*\"publicKey\":\"([^\"]+)\".*/\1/p")"
      [[ -n "$TRUSTED_PUBLIC_KEY_VALUE" ]] || die "$(msg trusted_key_missing)"
    fi
  fi
}

verify_release_manifest() {
  local trusted key_raw key_der key_pem signature_raw
  trusted="$TRUSTED_PUBLIC_KEY_VALUE"
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
  local sums_signature_raw="$TEMP_DIR/SHA256SUMS.sig.raw"
  printf '%s' "$(tr -d '[:space:]' <"$TEMP_DIR/SHA256SUMS.sig")" | base64 --decode >"$sums_signature_raw" 2>/dev/null || die "$(msg signature_base64)"
  openssl pkeyutl -verify -pubin -inkey "$key_pem" -rawin \
    -in "$TEMP_DIR/SHA256SUMS" -sigfile "$sums_signature_raw" >/dev/null 2>&1 ||
    die "$(msg signature_invalid)"
  local manifest_channel
  manifest_channel="$(manifest_value channel)"
  [[ "$manifest_channel" == "$CHANNEL_INPUT" || ( "$CHANNEL_INPUT" == "rc" && "$manifest_channel" == "stable" ) ]] || die "manifest channel does not match requested channel"
  [[ "$(manifest_value version)" == "$RELEASE_VERSION" ]] || die "manifest version does not match requested release tag"
  [[ "$(manifest_value signingKeyId)" == "$TRUSTED_KEY_ID_VALUE" ]] || die "manifest signing key id is not trusted"
  MANIFEST_WEB_IMAGE="$(manifest_value webImage)"
  MANIFEST_RUNTIME_IMAGE="$(manifest_value runtimeImage)"
  [[ "$MANIFEST_WEB_IMAGE" =~ ^ghcr\.io/flightdan/crewqual-web@sha256:[a-f0-9]{64}$ ]] || die "manifest webImage is not an official digest"
  [[ "$MANIFEST_RUNTIME_IMAGE" =~ ^ghcr\.io/flightdan/crewqual-runtime@sha256:[a-f0-9]{64}$ ]] || die "manifest runtimeImage is not an official digest"
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
  [[ "$(manifest_value composeUrl)" == "https://github.com/${GITHUB_REPOSITORY}/releases/download/${RELEASE_VERSION}/docker-compose.install.yml" ]] || die "manifest compose URL is not the expected release asset"
  [[ "$(manifest_value caddyUrl)" == "https://github.com/${GITHUB_REPOSITORY}/releases/download/${RELEASE_VERSION}/Caddyfile" ]] || die "manifest Caddy URL is not the expected release asset"
  [[ "$(manifest_value configureDomainUrl)" == "https://github.com/${GITHUB_REPOSITORY}/releases/download/${RELEASE_VERSION}/configure-domain.sh" ]] || die "manifest configure-domain URL is not the expected release asset"
}

download_release_files() {
  local release_base="https://github.com/${GITHUB_REPOSITORY}/releases/download/${RELEASE_VERSION}"
  TEMP_DIR="$(mktemp -d)"
  log "$(msg download_manifest "$RELEASE_VERSION")"
  download_asset "update-manifest-v1.json" \
    "$release_base/update-manifest-v1.json" "$TEMP_DIR/update-manifest-v1.json"
  download_asset "update-manifest-v1.json.sig" \
    "$release_base/update-manifest-v1.json.sig" "$TEMP_DIR/update-manifest-v1.sig"
  download_asset "SHA256SUMS" \
    "$release_base/SHA256SUMS" "$TEMP_DIR/SHA256SUMS"
  download_asset "SHA256SUMS.sig" \
    "$release_base/SHA256SUMS.sig" "$TEMP_DIR/SHA256SUMS.sig"
  download_asset "docker-compose.install.yml" \
    "$release_base/docker-compose.install.yml" "$TEMP_DIR/compose.yaml"
  download_asset "Caddyfile" \
    "$release_base/Caddyfile" "$TEMP_DIR/Caddyfile"
  if [[ -n "$(manifest_value configureDomainSha256)" ]]; then
    download_asset "configure-domain.sh" \
      "$release_base/configure-domain.sh" "$TEMP_DIR/configure-domain.sh"
  fi
  [[ -s "$TEMP_DIR/compose.yaml" && -s "$TEMP_DIR/Caddyfile" ]] || die "$(msg deployment_empty)"
}

write_initial_env() {
  local postgres_password postgres_app_password session_secret readiness_probe_secret settings_key minio_user minio_password updater_secret backup_key network_secret setup_auth_code setup_auth_hash setup_auth_random
  postgres_password="$(openssl rand -hex 32)"
  postgres_app_password="$(openssl rand -hex 32)"
  session_secret="$(openssl rand -hex 48)"
  readiness_probe_secret="$(openssl rand -hex 32)"
  settings_key="$(openssl rand -hex 32)"
  minio_user="crewqual-$(openssl rand -hex 8)"
  minio_password="$(openssl rand -hex 32)"
  updater_secret="$(openssl rand -hex 32)"
  [[ "$UPDATER_MODE" == "managed" ]] || updater_secret=""
  backup_key="$(openssl rand -hex 32)"
  network_secret="$(openssl rand -hex 32)"
  setup_auth_random="$(openssl rand -hex 4)"
  setup_auth_code="$(printf '%08d' "$((16#$setup_auth_random % 100000000))")"
  setup_auth_hash="$(printf '%s' "$setup_auth_code" | sha256sum | awk '{print $1}')"
  SETUP_AUTH_CODE_DISPLAY="$setup_auth_code"
  [[ -n "$TRUSTED_PUBLIC_KEY_VALUE" ]] || die "$(msg trusted_key_required)"

  umask 077
  {
    printf "CREWQUAL_VERSION='%s'\n" "$RELEASE_VERSION"
    printf "CREWQUAL_WEB_IMAGE='%s'\nCREWQUAL_RUNTIME_IMAGE='%s'\n" "$MANIFEST_WEB_IMAGE" "$MANIFEST_RUNTIME_IMAGE"
    printf "CREWQUAL_UPDATER_MODE='%s'\nCREWQUAL_UPDATER_HOST_DIR='%s'\n" "$UPDATER_MODE" "$UPDATER_HOST_DIR"
    printf "CREWQUAL_UPDATER_SOCKET='/run/crewqual-updater/api.sock'\nCREWQUAL_UPDATER_SHARED_SECRET='%s'\nCREWQUAL_UPDATER_BACKUP_KEY='%s'\n" "$updater_secret" "$backup_key"
    printf "INSTALL_LANGUAGE='%s'\n" "$LANGUAGE_INPUT"
    printf '%s\n' "NODE_ENV=production" "SERVICE_MODE=remote" "NEXT_PUBLIC_SERVICE_MODE=remote"
    printf "APP_ORIGIN='%s'\nAPP_DOMAIN='%s'\nTLS_EMAIL='%s'\n" \
      "$APP_ORIGIN_VALUE" "$APP_DOMAIN_INPUT" "$TLS_EMAIL_INPUT"
    printf "DEPLOYMENT_NETWORK_MODE='%s'\nAPP_PORT='%s'\nCADDY_SITE_ADDRESS='%s'\nCADDY_TLS_CONFIG='%s'\nCADDY_EMAIL_CONFIG='%s'\nAPP_BIND='%s'\nACME_BIND='%s'\nACME_PORT='%s'\nNETWORK_ACCESS_SECRET='%s'\n" \
      "$NETWORK_MODE_INPUT" "$APP_PORT_INPUT" "$CADDY_SITE_ADDRESS_VALUE" "$CADDY_TLS_CONFIG_VALUE" "$CADDY_EMAIL_CONFIG_VALUE" "$APP_BIND_VALUE" "$ACME_BIND_VALUE" "$ACME_PORT_VALUE" "$network_secret"
    printf "POSTGRES_PASSWORD='%s'\n" "$postgres_password"
    printf "POSTGRES_APP_PASSWORD='%s'\n" "$postgres_app_password"
    printf "DATABASE_URL='postgresql://crewqual_app:%s@postgres:5432/crewqual'\n" "$postgres_app_password"
    printf "DIRECT_URL='postgresql://crewqual:%s@postgres:5432/crewqual'\n" "$postgres_password"
    printf "SESSION_SECRET='%s'\nREADINESS_PROBE_SECRET='%s'\nSETTINGS_ENCRYPTION_KEY='%s'\n" \
      "$session_secret" "$readiness_probe_secret" "$settings_key"
    printf '%s\n' "PILOT_SESSION_TTL_MINUTES=60" "ADMIN_SESSION_TTL_HOURS=8" "TRUSTED_PROXY_HOPS=1"
    printf '%s\n' "OUTBOUND_ALLOWED_HOSTS=minio:9000,host.docker.internal:8000" "OUTBOUND_ALLOWED_CIDRS="
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

set_env_key() {
  local key="$1" value="$2" replacement="$TEMP_DIR/env.updated" staged="$TEMP_DIR/env.updated.next"
  awk -v key="$key" -v value="$value" '
    BEGIN {
      replacement = key "=\047" value "\047"
      replaced = 0
    }
    index($0, key "=") == 1 {
      if (!replaced) print replacement
      replaced = 1
      next
    }
    { print }
    END { if (!replaced) print replacement }
  ' "$replacement" >"$staged"
  mv -f -- "$staged" "$replacement"
  chmod 600 "$replacement"
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
  # Include stopped one-shot services so completion checks can observe their
  # exit status after Docker Compose removes them from the running list.
  compose ps -aq "$1" 2>/dev/null | head -n 1
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

prepare_updater_verifier() {
  local arch asset_url tmp expected actual sums_expected
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
  log "$(msg updater_download)"
  if curl_fetch "$asset_url" -o "$tmp"; then
    :
  else
    local status=$?
    report_network_failure "$status"
    echo "$(msg updater_download_failed)" >&2
    return 1
  fi
  [[ -s "$tmp" ]] || { echo "$(msg updater_empty)" >&2; return 1; }
  expected="$(manifest_value "$arch")"
  [[ "$expected" =~ ^[a-fA-F0-9]{64}$ ]] || { echo "$(msg updater_hash_missing "$arch")" >&2; return 1; }
  actual="$(sha256sum "$tmp" | awk '{print $1}')"
  [[ "$expected" =~ ^[a-fA-F0-9]{64}$ && "$expected" == "$actual" ]] || { echo "$(msg updater_checksum)" >&2; return 1; }
  sums_expected="$(grep -E "^[a-fA-F0-9]{64}[[:space:]]+crewqual-updater-linux-${arch}$" "$TEMP_DIR/SHA256SUMS" | awk '{print $1}' | head -n 1)"
  [[ "$sums_expected" == "$actual" ]] || { echo "$(msg updater_checksum)" >&2; return 1; }
  chmod 0755 "$tmp"
  log "$(msg release_verify)"
  "$tmp" verify-manifest --manifest "$TEMP_DIR/update-manifest-v1.json" \
    --signature "$TEMP_DIR/update-manifest-v1.sig" --tag "$RELEASE_VERSION" >/dev/null 2>&1 || {
    echo "$(msg signature_invalid)" >&2
    return 1
  }
  UPDATER_VERIFIER="$tmp"
}

updater_capability_version() {
  local version="${RELEASE_VERSION#v}"
  printf '%s' "${version%%-rc.*}"
}

validate_repair_file() {
  local path="$1" owner mode parent
  [[ -f "$path" && ! -L "$path" ]] || die "updater repair requires a regular managed file: $path"
  [[ "$(realpath -m -- "$path")" == "$path" ]] || die "unsafe updater repair path: $path"
  owner="$(stat -c '%u' -- "$path")"
  mode="$(stat -c '%a' -- "$path")"
  [[ "$owner" == "$(id -u)" && "$mode" =~ ^[0-7]{3,4}$ ]] || die "unsafe updater repair file: $path"
  (((8#$mode & 0022) == 0)) || die "writable updater repair file: $path"
  parent="$(dirname -- "$path")"
  while :; do
    owner="$(stat -c '%u' -- "$parent")"
    mode="$(stat -c '%a' -- "$parent")"
    [[ "$owner" == "0" || "$owner" == "$(id -u)" ]] || die "unsafe updater repair parent: $parent"
    if (((8#$mode & 0022) != 0)); then
      [[ "${CREWQUAL_INSTALL_TEST_MODE:-0}" == "1" && "$owner" == "0" ]] &&
        (((8#$mode & 01000) != 0)) || die "writable updater repair parent: $parent"
    fi
    [[ "$parent" == / ]] && break
    parent="$(dirname -- "$parent")"
  done
}

wait_for_repaired_updater() {
  local unit attempt code service_was_active=0
  for unit in "${REPAIR_ACTIVE_UNITS[@]}"; do
    [[ "$unit" != crewqual-updater.service ]] || service_was_active=1
  done
  ((service_was_active)) || return 0
  # A simple systemd service can fail just after start returns. Probe its Unix
  # API without sending credentials; the expected 401 proves it is serving.
  for ((attempt = 1; attempt <= 10; attempt++)); do
    if systemctl is-active --quiet crewqual-updater.service; then
      code="$(curl --silent --max-time 2 --unix-socket /run/crewqual-updater/api.sock \
        --output /dev/null --write-out '%{http_code}' http://localhost/v1/status)" || code=""
      [[ "$code" != 401 ]] || return 0
    fi
    sleep 1
  done
  echo "Repaired updater did not become ready." >&2
  return 1
}

restore_updater_repair() {
  local failed=0
  # A failed start may leave a live process using the candidate executable.
  # Stop it before restoring files, otherwise another start can be a no-op.
  if [[ "${CREWQUAL_INSTALL_TEST_MODE:-0}" != "1" ]]; then
    run_with_timeout "$DOCKER_COMMAND_TIMEOUT_SECONDS" systemctl stop crewqual-updater.service crewqual-updater.socket || failed=1
  fi
  if ((failed == 0)); then
    atomic_install "$TEMP_DIR/repair-binary.before" "$REPAIR_TARGET" 0755 || failed=1
    atomic_install "$TEMP_DIR/repair-config.before" "$REPAIR_CONFIG" 0600 || failed=1
  fi
  if ((failed == 0)) && [[ "${CREWQUAL_INSTALL_TEST_MODE:-0}" != "1" && ${#REPAIR_ACTIVE_UNITS[@]} -gt 0 ]]; then
    run_with_timeout "$DOCKER_COMMAND_TIMEOUT_SECONDS" systemctl start "${REPAIR_ACTIVE_UNITS[@]}" || failed=1
    if ((failed == 0)); then wait_for_repaired_updater || failed=1; fi
  fi
  REPAIR_PENDING=0
  if ((failed)); then
    echo "Updater repair rollback failed; protected recovery files retained at: $TEMP_DIR" >&2
    # cleanup must not delete the only remaining copies needed for recovery.
    TEMP_DIR=""
    return 1
  fi
}

repair_existing_updater() {
  [[ "$UPDATER_MODE" == "managed" ]] || die "updater repair requires a managed Linux installation"
  local path unit config_version_count key expected configured
  for path in "$INSTALL_DIR/.crewqual-official-install" "$ENV_FILE" "$COMPOSE_FILE" "$INSTALL_DIR/Caddyfile"; do
    validate_repair_file "$path"
  done
  [[ "$(env_value CREWQUAL_UPDATER_MODE)" == "managed" ]] || die "updater repair requires managed updater mode"
  REPAIR_TARGET="$UPDATER_BINARY_DIR/crewqual-updater"
  REPAIR_CONFIG="$UPDATER_CONFIG_DIR/config.json"
  if [[ "${CREWQUAL_INSTALL_TEST_MODE:-0}" == "1" ]]; then
    REPAIR_TARGET="${CREWQUAL_INSTALL_TEST_UNIT_DIR:-$INSTALL_DIR/.updater-units}/crewqual-updater"
    REPAIR_CONFIG="${CREWQUAL_INSTALL_TEST_UNIT_DIR:-$INSTALL_DIR/.updater-units}/config.json"
  else
    require_command systemctl
    validate_repair_file /etc/systemd/system/crewqual-updater.service
    validate_repair_file /etc/systemd/system/crewqual-updater.socket
  fi
  validate_repair_file "$REPAIR_TARGET"
  validate_repair_file "$REPAIR_CONFIG"
  for key in installDir envFile composeFile caddyFile; do
    case "$key" in
      installDir) expected="$INSTALL_DIR" ;;
      envFile) expected="$ENV_FILE" ;;
      composeFile) expected="$COMPOSE_FILE" ;;
      caddyFile) expected="$INSTALL_DIR/Caddyfile" ;;
    esac
    configured="$(sed -nE 's/.*"'"$key"'"[[:space:]]*:[[:space:]]*"([^"\]*)".*/\1/p' "$REPAIR_CONFIG")"
    [[ "$configured" == "$expected" ]] || die "updater config does not match this installation: $key"
  done
  config_version_count="$(grep -o '"updaterVersion"[[:space:]]*:[[:space:]]*"[^"\]*"' "$REPAIR_CONFIG" | wc -l)"
  [[ "$config_version_count" == "1" ]] || die "updater repair requires one updaterVersion field"
  # Preserve the original config, including channel, trust, paths and secrets.
  # The signed target is selected independently from that existing channel.
  sed -E 's/("updaterVersion"[[:space:]]*:[[:space:]]*)"[^"\]*"/\1"'"$(updater_capability_version)"'"/' \
    "$REPAIR_CONFIG" >"$TEMP_DIR/repair-config.updated"
  chmod 0600 "$TEMP_DIR/repair-config.updated"
  prepare_updater_verifier
  cp -p -- "$REPAIR_TARGET" "$TEMP_DIR/repair-binary.before"
  cp -p -- "$REPAIR_CONFIG" "$TEMP_DIR/repair-config.before"
  if [[ "${CREWQUAL_INSTALL_TEST_MODE:-0}" != "1" ]]; then
    for unit in crewqual-updater.socket crewqual-updater.service; do
      if systemctl is-active --quiet "$unit"; then REPAIR_ACTIVE_UNITS+=("$unit"); fi
    done
  fi
  REPAIR_PENDING=1
  if [[ "${CREWQUAL_INSTALL_TEST_MODE:-0}" != "1" ]]; then
    run_with_timeout "$DOCKER_COMMAND_TIMEOUT_SECONDS" systemctl stop crewqual-updater.service crewqual-updater.socket
  fi
  atomic_install "$UPDATER_VERIFIER" "$REPAIR_TARGET" 0755
  atomic_install "$TEMP_DIR/repair-config.updated" "$REPAIR_CONFIG" 0600
  if [[ "${CREWQUAL_INSTALL_TEST_MODE:-0}" != "1" && ${#REPAIR_ACTIVE_UNITS[@]} -gt 0 ]]; then
    run_with_timeout "$DOCKER_COMMAND_TIMEOUT_SECONDS" systemctl start "${REPAIR_ACTIVE_UNITS[@]}"
    wait_for_repaired_updater
  fi
  REPAIR_PENDING=0
  log "Host updater repaired to $(updater_capability_version); application version is unchanged."
}

disable_existing_wsl_updater() {
  local unit_found=0 unit_path
  for unit_path in \
    /etc/systemd/system/crewqual-updater.service \
    /etc/systemd/system/crewqual-updater.socket \
    /etc/systemd/system/crewqual-caddy-recovery.service \
    /usr/lib/systemd/system/crewqual-updater.service \
    /usr/lib/systemd/system/crewqual-updater.socket \
    /usr/lib/systemd/system/crewqual-caddy-recovery.service; do
    [[ -e "$unit_path" ]] && unit_found=1
  done
  ((unit_found)) || return 0
  if ! command -v systemctl >/dev/null 2>&1 || \
    ! run_with_timeout "$DOCKER_COMMAND_TIMEOUT_SECONDS" systemctl disable --now \
      crewqual-updater.service crewqual-updater.socket "$CADDY_RECOVERY_UNIT"; then
    echo "$(msg updater_disable_failed)" >&2
  fi
}

install_updater_service() {
  local test_mode="${CREWQUAL_INSTALL_TEST_MODE:-0}"
  local unit_dir target config_path shared backup trusted
  if [[ "$test_mode" == "1" ]]; then
    unit_dir="${CREWQUAL_INSTALL_TEST_UNIT_DIR:-$INSTALL_DIR/.updater-units}"
    target="$unit_dir/crewqual-updater"
    config_path="$unit_dir/config.json"
  else
    if ! command -v systemctl >/dev/null 2>&1; then
      echo "$(msg systemd_missing)" >&2
      return 1
    fi
    unit_dir="$UPDATER_CONFIG_DIR"
    target="$UPDATER_BINARY_DIR/crewqual-updater"
    config_path="$UPDATER_CONFIG_DIR/config.json"
  fi
  [[ -n "$UPDATER_VERIFIER" && -x "$UPDATER_VERIFIER" ]] || return 1
  install -d -m 0755 "$unit_dir"
  if [[ "$test_mode" == "1" ]]; then
    install -m 0755 "$UPDATER_VERIFIER" "$target"
  else
    install -d -m 0755 "$UPDATER_BINARY_DIR" "$UPDATER_CONFIG_DIR" "$UPDATER_DATA_DIR" "$UPDATER_HOST_DIR"
    install -m 0755 "$UPDATER_VERIFIER" "$target"
  fi
  shared="$(env_value CREWQUAL_UPDATER_SHARED_SECRET)"
  backup="$(env_value CREWQUAL_UPDATER_BACKUP_KEY)"
  trusted="$TRUSTED_PUBLIC_KEY_VALUE"
  [[ -n "$trusted" ]] || { echo "$(msg updater_trust_missing)" >&2; return 1; }
  umask 077
  printf '{"installDir":"%s","dataDir":"%s","composeFile":"%s","envFile":"%s","caddyFile":"%s","socket":"/run/crewqual-updater/api.sock","sharedSecret":"%s","backupKey":"%s","channel":"%s","releaseAPIURL":"https://api.github.com/repos/%s/releases","trustedPublicKeys":[{"id":"%s","publicKey":"%s","status":"active"}],"updaterVersion":"%s"}\n' \
    "$INSTALL_DIR" "$UPDATER_DATA_DIR" "$COMPOSE_FILE" "$ENV_FILE" "$INSTALL_DIR/Caddyfile" "$shared" "$backup" "$CHANNEL_INPUT" "$GITHUB_REPOSITORY" "$TRUSTED_KEY_ID_VALUE" "$trusted" "$(updater_capability_version)" >"$config_path"
  chmod 600 "$config_path"
  cat >"$unit_dir/crewqual-updater.service" <<EOF
[Unit]
Description=CrewQual host update controller
After=docker.service
Requires=docker.service

[Service]
Type=simple
ExecStart=$target serve
Environment=CREWQUAL_UPDATER_CONFIG=$config_path
Restart=on-failure
RestartSec=3
User=root
UMask=0077
NoNewPrivileges=true
ProtectSystem=strict
# /run is cleared on every boot. Create the lock/socket parent before the
# read-write namespace is assembled, and keep it while either unit may use it.
RuntimeDirectory=crewqual-updater
RuntimeDirectoryMode=0755
RuntimeDirectoryPreserve=yes
ReadWritePaths=$INSTALL_DIR $UPDATER_DATA_DIR -$UPDATER_HOST_DIR
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
  cat >"$unit_dir/$CADDY_RECOVERY_UNIT" <<EOF
[Unit]
Description=CrewQual Caddy host-address recovery
Wants=network-online.target
After=network-online.target docker.service
Requires=docker.service
# A configured address can return long after boot (for example after a VM NIC
# or VPN is restored). Keep retrying bounded attempts instead of permanently
# giving up after a small start-limit burst.
StartLimitIntervalSec=0

[Service]
Type=oneshot
ExecStart=$target reconcile-caddy --timeout ${CADDY_RECOVERY_TIMEOUT_SECONDS}s
Environment=CREWQUAL_UPDATER_CONFIG=$config_path
User=root
UMask=0077
NoNewPrivileges=true
ProtectSystem=strict
# /run is cleared on every boot. Create the lock/socket parent before the
# read-write namespace is assembled, and keep it after this oneshot exits.
RuntimeDirectory=crewqual-updater
RuntimeDirectoryMode=0755
RuntimeDirectoryPreserve=yes
ReadWritePaths=$INSTALL_DIR $UPDATER_DATA_DIR -$UPDATER_HOST_DIR
PrivateTmp=true
TimeoutStartSec=$((CADDY_RECOVERY_TIMEOUT_SECONDS + DOCKER_COMMAND_TIMEOUT_SECONDS))s
Restart=on-failure
RestartSec=10s

[Install]
WantedBy=multi-user.target
EOF
  cat >"$unit_dir/crewqual-updater.socket" <<EOF
[Unit]
Description=CrewQual updater API socket

[Socket]
ListenStream=/run/crewqual-updater/api.sock
SocketMode=0666
DirectoryMode=0755
RemoveOnStop=true

[Install]
WantedBy=sockets.target
EOF
  if [[ "$test_mode" == "1" ]]; then
    chmod 0644 "$unit_dir/crewqual-updater.service" "$unit_dir/$CADDY_RECOVERY_UNIT" "$unit_dir/crewqual-updater.socket"
    return 0
  fi
  install -m 0644 "$unit_dir/crewqual-updater.service" /etc/systemd/system/crewqual-updater.service
  install -m 0644 "$unit_dir/$CADDY_RECOVERY_UNIT" "$CADDY_RECOVERY_UNIT_FILE"
  install -m 0644 "$unit_dir/crewqual-updater.socket" /etc/systemd/system/crewqual-updater.socket
  log "$(msg updater_start)"
  run_with_timeout "$DOCKER_COMMAND_TIMEOUT_SECONDS" systemctl daemon-reload || {
    echo "$(msg updater_start_failed)" >&2
    return 1
  }
  run_with_timeout "$DOCKER_COMMAND_TIMEOUT_SECONDS" systemctl enable --now crewqual-updater.socket crewqual-updater.service || {
    echo "$(msg updater_start_failed)" >&2
    return 1
  }
  run_with_timeout "$DOCKER_COMMAND_TIMEOUT_SECONDS" systemctl enable "$CADDY_RECOVERY_UNIT" || {
    echo "$(msg updater_start_failed)" >&2
    return 1
  }
}

configure_updater() {
  if [[ "$UPDATER_MODE" == "manual" ]]; then
    install -d -m 0755 "$UPDATER_HOST_DIR"
    disable_existing_wsl_updater
    log "$(msg manual_updater_mode)"
    return 0
  fi
  install_updater_service
}

run_preflight_checks() {
  log "$(msg preflight)"
  [[ "$(uname -s)" == "Linux" ]] || die "$(msg linux_only)"
  if [[ "$EUID" -ne 0 && "${CREWQUAL_INSTALL_TEST_MODE:-0}" != "1" ]]; then
    die "$(msg run_as_root "$INSTALL_DIR")"
  fi
  [[ "$WAIT_TIMEOUT_SECONDS" =~ ^[1-9][0-9]*$ ]] || die "$(msg timeout_invalid)"
  [[ "$DOCKER_COMMAND_TIMEOUT_SECONDS" =~ ^[1-9][0-9]*$ ]] || die "$(msg timeout_invalid)"
  [[ "$NETWORK_TIMEOUT_SECONDS" =~ ^[1-9][0-9]*$ ]] || die "$(msg timeout_invalid)"
  [[ "$NETWORK_RETRY_TIMEOUT_SECONDS" =~ ^[1-9][0-9]*$ ]] || die "$(msg timeout_invalid)"
  [[ "$CADDY_START_RETRY_ATTEMPTS" =~ ^[1-9][0-9]*$ ]] || die "$(msg timeout_invalid)"
  [[ "$CADDY_START_RETRY_INTERVAL_SECONDS" =~ ^[1-9][0-9]*$ ]] || die "$(msg timeout_invalid)"
  [[ "$CADDY_RECOVERY_TIMEOUT_SECONDS" =~ ^[1-9][0-9]*$ ]] || die "$(msg timeout_invalid)"
  [[ "$PACKAGE_TIMEOUT_SECONDS" =~ ^[1-9][0-9]*$ ]] || die "$(msg timeout_invalid)"
  [[ "$INSTALL_DIR" == /* && "$INSTALL_DIR" != "/" ]] || die "$(msg install_dir_invalid)"

  require_command curl
  require_command openssl
  require_command awk
  require_command sed
  require_command mktemp
  require_command install
  require_command sha256sum
  require_command base64
  require_command xxd
  require_command hostname
  require_command grep
  require_command timeout
  require_command flock
  require_command realpath
  require_command stat
  require_command dirname
  require_command id
  configure_host_platform
}

verify_downloaded_release() {
  resolve_trusted_public_key
  log "$(msg release_verify)"
  verify_release_manifest
}

prepare_managed_deployment() {
  if [[ "$EXISTING_INSTALL" == "1" ]]; then
    snapshot_existing_install
  fi
  prepare_custom_tls_files
  log "$(msg validate_manifest "$RELEASE_VERSION")"
  docker compose --project-directory "$TEMP_DIR" --env-file "$TEMP_DIR/env.updated" \
    -f "$TEMP_DIR/compose.yaml" config --quiet
}

commit_managed_deployment() {
  if [[ "$EXISTING_INSTALL" == "1" ]]; then
    create_upgrade_database_backup
  fi
  # Verify the matching host updater before replacing managed files, then
  # install the new deployment files before enabling any unit that can act on
  # them. This keeps a freshly started recovery service from observing a
  # half-written deployment and lets an invalid updater fail before commit.
  prepare_updater_verifier
  atomic_install "$TEMP_DIR/env.updated" "$ENV_FILE" 0600
  atomic_install "$TEMP_DIR/compose.yaml" "$COMPOSE_FILE" 0644
  atomic_install "$TEMP_DIR/Caddyfile" "$INSTALL_DIR/Caddyfile" 0644
  if [[ -s "$TEMP_DIR/configure-domain.sh" ]]; then
    atomic_install "$TEMP_DIR/configure-domain.sh" "$INSTALL_DIR/configure-domain.sh" 0755
  fi
  configure_updater
}

pull_release_images() {
  ((PULL_IMAGES)) || return 0
  log "$(msg pull_images "$RELEASE_VERSION")"
  compose pull
}

start_object_storage() {
  log "$(msg start_minio)"
  compose up -d minio minio-init
  wait_for_completion minio-init
}

start_database() {
  log "$(msg start_postgres)"
  compose up -d postgres
  wait_for_status postgres healthy
}

migrate_and_bootstrap_database() {
  log "$(msg run_migrations)"
  compose run --rm --no-deps migrate
  log "$(msg run_bootstrap)"
  compose run --rm --no-deps bootstrap
}

start_application_services() {
  log "$(msg start_web_worker)"
  compose up -d --no-deps web worker
  wait_for_status web healthy
  wait_for_status worker healthy
  log "$(msg start_https)"
  # Recreate Caddy on the first attempt as well. A container left behind after
  # a transient host-address bind failure can report `running` while retaining
  # no published host port; an ordinary `up` then incorrectly treats it as
  # healthy. Recreating the container keeps named volumes and clears that
  # stale port-publish state.
  local attempt force_recreate=1 caddy_started=0
  for ((attempt = 1; attempt <= CADDY_START_RETRY_ATTEMPTS; attempt++)); do
    if ((force_recreate)); then
      if compose up -d --force-recreate --no-deps caddy && wait_for_status caddy running; then
        caddy_started=1
        break
      fi
    elif compose up -d --no-deps caddy && wait_for_status caddy running; then
      caddy_started=1
      break
    fi
    force_recreate=1
    if ((attempt < CADDY_START_RETRY_ATTEMPTS)); then
      log "$(msg caddy_retry "$CADDY_START_RETRY_INTERVAL_SECONDS" "$((attempt + 1))" "$CADDY_START_RETRY_ATTEMPTS")"
      sleep "$CADDY_START_RETRY_INTERVAL_SECONDS"
    fi
  done
  ((caddy_started)) || return 1
  if [[ "$UPDATER_MODE" == "managed" && "${CREWQUAL_INSTALL_TEST_MODE:-0}" != "1" ]]; then
    log "$(msg caddy_recovery_start)"
    # The recovery command takes the same deployment lock as the installer.
    # Record the committed state, hand the lock to systemd for the entrance
    # check, then reacquire it and reject any intervening deployment state.
    ROLLBACK_STATE_TOKEN="$(deployment_state_token)"
    ROLLBACK_STATE_GUARD_REQUIRED=1
    release_deployment_lock
    # The unit owns the full host-address recovery window; the shorter Docker
    # command timeout would abort an otherwise healthy delayed-address install.
    local recovery_start_timeout=$((CADDY_RECOVERY_TIMEOUT_SECONDS + DOCKER_COMMAND_TIMEOUT_SECONDS))
    local recovery_failed=0
    if ! run_with_timeout "$recovery_start_timeout" systemctl start "$CADDY_RECOVERY_UNIT"; then
      report_caddy_recovery_failure
      run_with_timeout "$DOCKER_COMMAND_TIMEOUT_SECONDS" systemctl stop "$CADDY_RECOVERY_UNIT" >/dev/null 2>&1 || true
      recovery_failed=1
    fi
    acquire_deployment_lock || {
      echo "$(msg deployment_lock_failed)" >&2
      return 1
    }
    if [[ "$(deployment_state_token)" != "$ROLLBACK_STATE_TOKEN" ]]; then
      echo "警告: Caddy 恢复期间检测到另一个部署任务，当前安装结果不再可归因。" >&2
      return 1
    fi
    ROLLBACK_STATE_GUARD_REQUIRED=0
    ((recovery_failed == 0)) || return 1
  fi
}

while (($# > 0)); do
  case "$1" in
    --repair-updater)
      REPAIR_UPDATER=1
      shift
      ;;
    --version)
      (($# >= 2)) || die "$(msg missing_option_value --version)"
      RELEASE_VERSION="$2"
      shift 2
      ;;
    --channel)
      (($# >= 2)) || die "$(msg missing_option_value --channel)"
      CHANNEL_INPUT="$2"
      validate_channel "$CHANNEL_INPUT"
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
    --tls-cert)
      (($# >= 2)) || die "$(msg missing_option_value --tls-cert)"
      TLS_CERT_INPUT="$2"
      shift 2
      ;;
    --tls-key)
      (($# >= 2)) || die "$(msg missing_option_value --tls-key)"
      TLS_KEY_INPUT="$2"
      shift 2
      ;;
    --auto-tls)
      AUTO_TLS_INPUT=1
      shift
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
    --public-address)
      (($# >= 2)) || die "$(msg missing_option_value --public-address)"
      PUBLIC_ADDRESS_INPUT="$2"
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
    --install-docker)
      AUTO_INSTALL_DOCKER=1
      shift
      ;;
    --non-interactive)
      NON_INTERACTIVE=1
      shift
      ;;
    --plain)
      PLAIN_OUTPUT=1
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

if ((AUTO_TLS_INPUT)) && custom_tls_requested; then
  die "--auto-tls 不能与 --tls-cert/--tls-key 同时使用"
fi

normalize_install_directory_path
ENV_FILE="$INSTALL_DIR/.env"
COMPOSE_FILE="$INSTALL_DIR/compose.yaml"
ui_init
trap cleanup EXIT
trap on_error ERR
select_language

ui_task_run 1 "$(msg task_preflight)" run_preflight_checks
if ((!REPAIR_UPDATER)); then
  ui_task_run 2 "$(msg task_docker)" ensure_docker_engine
  ui_task_run 3 "$(msg task_compose)" ensure_compose_plugin
fi
ui_task_run 4 "$(msg task_release)" resolve_release_version
ui_task_run 5 "$(msg task_download)" download_release_files
ui_task_run 6 "$(msg task_verify)" verify_downloaded_release

# Hold the deployment lock before reading any existing managed state. The
# staged environment and rollback snapshot must describe the same deployment
# that will eventually be committed.
prepare_install_directory
acquire_deployment_lock || die "$(msg deployment_lock_failed)"

if ((REPAIR_UPDATER)); then
  repair_existing_updater
  exit 0
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
  CADDY_TLS_CONFIG_VALUE="$(env_value CADDY_TLS_CONFIG)"
  if [[ "$existing_mode" != "tls" ]] && custom_tls_requested; then
    die "$(msg tls_custom_non_tls)"
  fi
  if [[ "$existing_mode" == "tls" ]] && custom_tls_requested; then
    validate_domain "$APP_DOMAIN_INPUT"
    validate_custom_tls "$APP_DOMAIN_INPUT"
    CADDY_TLS_CONFIG_VALUE='tls /etc/caddy/tls/fullchain.pem /etc/caddy/tls/privkey.pem'
  elif ((AUTO_TLS_INPUT)); then
    CADDY_TLS_CONFIG_VALUE=""
  fi
  set_tls_config_values
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
  elif [[ "$existing_mode" == "lan" ]]; then
    validate_lan_address "$(printf '%s' "$APP_ORIGIN_VALUE" | sed -E 's#^http://([^:]+):.*#\1#')"
  elif [[ "$existing_mode" == "http" ]]; then
    validate_public_address "$APP_DOMAIN_INPUT"
    [[ "$APP_ORIGIN_VALUE" == "http://${APP_DOMAIN_INPUT}:"* ]] ||
      die "$(msg public_address_invalid "$APP_DOMAIN_INPUT")"
  else
    die "$(msg network_invalid)"
  fi
  if ((UI_ACTIVE)); then
    UI_TASK_INDEX=6
    UI_CURRENT_TASK="$(msg task_config)"
    ui_review_upgrade
  fi
  update_managed_version
else
  while :; do
    prepare_network_config
    ((!UI_ACTIVE)) && break
    if ui_review_configuration; then
      break
    fi
    ui_reset_network_answers
  done
  write_initial_env
fi

UI_TASK_INDEX=7
UI_LAST_TASK="$(msg task_config)"
if [[ ! -e "$INSTALL_DIR/.crewqual-official-install" ]]; then
  install -m 0644 /dev/null "$INSTALL_DIR/.crewqual-official-install"
fi
ui_promote_log

# Older official installs may contain mutable official tags. Replace those with
# the signed digest, but refuse to silently take ownership of custom images.
if [[ -f "$TEMP_DIR/env.updated" ]]; then
  existing_web_image="$(env_value CREWQUAL_WEB_IMAGE)"
  existing_runtime_image="$(env_value CREWQUAL_RUNTIME_IMAGE)"
  if [[ -n "$existing_web_image" && ! "$existing_web_image" =~ ^ghcr\.io/flightdan/crewqual-web(@sha256:[a-f0-9]{64}|:[A-Za-z0-9._-]+)$ ]]; then
    die "existing CREWQUAL_WEB_IMAGE is custom; handle it explicitly before installing a signed release"
  fi
  if [[ -n "$existing_runtime_image" && ! "$existing_runtime_image" =~ ^ghcr\.io/flightdan/crewqual-runtime(@sha256:[a-f0-9]{64}|:[A-Za-z0-9._-]+)$ ]]; then
    die "existing CREWQUAL_RUNTIME_IMAGE is custom; handle it explicitly before installing a signed release"
  fi
  set_env_key CREWQUAL_WEB_IMAGE "$MANIFEST_WEB_IMAGE"
  set_env_key CREWQUAL_RUNTIME_IMAGE "$MANIFEST_RUNTIME_IMAGE"
  if [[ -z "$(env_value READINESS_PROBE_SECRET)" ]]; then
    set_env_key READINESS_PROBE_SECRET "$(openssl rand -hex 32)"
  fi
  # Existing official installs used the owner login for both application and
  # migration traffic. Generate the new runtime secret once, then normalize
  # both URLs while preserving the owner secret and database volume.
  if [[ -z "$(env_value POSTGRES_APP_PASSWORD)" ]]; then
    set_env_key POSTGRES_APP_PASSWORD "$(openssl rand -hex 32)"
  fi
  [[ -n "$(env_value POSTGRES_PASSWORD)" ]] || die "POSTGRES_PASSWORD is required for the database owner role"
  set_env_key DATABASE_URL "postgresql://crewqual_app:$(env_value POSTGRES_APP_PASSWORD)@postgres:5432/crewqual"
  set_env_key DIRECT_URL "postgresql://crewqual:$(env_value POSTGRES_PASSWORD)@postgres:5432/crewqual"
  set_env_key CREWQUAL_UPDATER_MODE "$UPDATER_MODE"
  set_env_key CREWQUAL_UPDATER_HOST_DIR "$UPDATER_HOST_DIR"
  ensure_env_key CREWQUAL_UPDATER_SOCKET "/run/crewqual-updater/api.sock"
  if [[ "$UPDATER_MODE" == "manual" ]]; then
    set_env_key CREWQUAL_UPDATER_SHARED_SECRET ""
  elif [[ -z "$(env_value CREWQUAL_UPDATER_SHARED_SECRET)" ]]; then
    set_env_key CREWQUAL_UPDATER_SHARED_SECRET "$(openssl rand -hex 32)"
  fi
  [[ -n "$(env_value CREWQUAL_UPDATER_BACKUP_KEY)" ]] || ensure_env_key CREWQUAL_UPDATER_BACKUP_KEY "$(openssl rand -hex 32)"
  ensure_env_key INSTALL_LANGUAGE "$LANGUAGE_INPUT"
  ensure_env_key DEPLOYMENT_NETWORK_MODE "$NETWORK_MODE_INPUT"
  ensure_env_key APP_PORT "$APP_PORT_INPUT"
  ensure_env_key APP_ORIGIN "$APP_ORIGIN_VALUE"
  ensure_env_key APP_DOMAIN "$APP_DOMAIN_INPUT"
  ensure_env_key TLS_EMAIL "$TLS_EMAIL_INPUT"
  ensure_env_key CADDY_SITE_ADDRESS "$CADDY_SITE_ADDRESS_VALUE"
  if custom_tls_requested || ((AUTO_TLS_INPUT)); then
    set_env_key CADDY_TLS_CONFIG "$CADDY_TLS_CONFIG_VALUE"
    set_env_key CADDY_EMAIL_CONFIG "$CADDY_EMAIL_CONFIG_VALUE"
  else
    ensure_env_key CADDY_TLS_CONFIG "$CADDY_TLS_CONFIG_VALUE"
    ensure_env_key CADDY_EMAIL_CONFIG "$CADDY_EMAIL_CONFIG_VALUE"
  fi
  ensure_env_key APP_BIND "$APP_BIND_VALUE"
  ensure_env_key ACME_BIND "$ACME_BIND_VALUE"
  ensure_env_key ACME_PORT "$ACME_PORT_VALUE"
  [[ -n "$(env_value NETWORK_ACCESS_SECRET)" ]] || ensure_env_key NETWORK_ACCESS_SECRET "$(openssl rand -hex 32)"
  [[ -n "$(env_value SETUP_AUTH_CODE_HASH)" ]] || generate_setup_auth_code
fi

ui_task_run 8 "$(msg task_prepare)" prepare_managed_deployment
COMPOSE=(docker compose --project-directory "$INSTALL_DIR" --env-file "$ENV_FILE" -f "$COMPOSE_FILE")
ui_task_run 9 "$(msg task_commit)" commit_managed_deployment
ui_task_run 10 "$(msg task_pull)" pull_release_images
ui_task_run 11 "$(msg task_minio)" start_object_storage
ui_task_run 12 "$(msg task_postgres)" start_database
ui_task_run 13 "$(msg task_database)" migrate_and_bootstrap_database
ui_task_run 14 "$(msg task_services)" start_application_services

log "$(msg deployment_complete "$RELEASE_VERSION")"
if ((UI_ACTIVE)); then
  compose ps -a >>"$UI_LOG_FILE" 2>&1 || true
  ui_shutdown
  echo "$(msg deployment_complete "$RELEASE_VERSION")"
else
  compose ps -a
fi
echo
if [[ -n "$SETUP_AUTH_CODE_DISPLAY" ]]; then
  echo "$(msg setup_auth_code "$SETUP_AUTH_CODE_DISPLAY")"
  echo "$(msg setup_auth_warning)"
fi
if [[ "$NETWORK_MODE_INPUT" == "http" ]]; then
  echo "$(msg public_http_postinstall)" >&2
fi
echo "$(msg welcome "${APP_ORIGIN_VALUE}")"
echo "$(msg install_dir "$INSTALL_DIR")"
[[ -n "$UI_LOG_FILE" ]] && echo "$(msg view_install_log "$UI_LOG_FILE")"
echo "$(msg view_logs "$INSTALL_DIR")"
[[ "$UPDATER_MODE" == "manual" ]] && echo "$(msg manual_upgrade_command)"
echo "$(msg volume_warning)"
