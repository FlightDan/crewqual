#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$SCRIPT_DIR"

WEBUI_ACTION=run
WEBUI_HOST=${WEBUI_HOST:-0.0.0.0}
WEBUI_PORT=${WEBUI_PORT:-3000}
WEBUI_OPEN=0
WEBUI_INSTALL=1
WEBUI_PAUSE=1
WEBUI_INTERACTIVE=0
WEBUI_RUNTIME=$SCRIPT_DIR/.dispatcher/webui/runtime
WEBUI_LOG=$WEBUI_RUNTIME/webui.log
WEBUI_PID_FILE=$WEBUI_RUNTIME/webui.pid
ORIGINAL_ARG_COUNT=$#

usage() {
  cat <<'EOF'
Usage: ./run_webui.sh [run|stop|restart|status] [options]

Options:
  --host HOST    Bind address (default: 0.0.0.0)
  --port PORT    Listen port (default: 3000)
  --open         Open the WebUI in the default browser
  --no-install   Do not install missing dependencies
  --no-pause     Do not pause after the command exits
  -h, --help     Show this help

Running without arguments opens the interactive menu.
Service logs are written to .dispatcher/webui/runtime/webui.log.
EOF
}

pause_if_needed() {
  if [ "$WEBUI_PAUSE" = 1 ] && [ -t 0 ]; then
    read -r -p "Press Enter to continue..." || true
  fi
}

port_owner_pid() {
  if command -v lsof >/dev/null 2>&1; then
    local lsof_pid
    lsof_pid=$(lsof -nP -tiTCP:"$WEBUI_PORT" -sTCP:LISTEN 2>/dev/null | head -n 1 || true)
    if [ -n "$lsof_pid" ]; then
      printf '%s\n' "$lsof_pid"
      return 0
    fi
  fi
  if command -v ss >/dev/null 2>&1; then
    ss -ltnp 2>/dev/null | awk -v port="$WEBUI_PORT" '
      $4 ~ (":" port "$") && match($0, /pid=[0-9]+/) {
        print substr($0, RSTART + 4, RLENGTH - 4)
        exit
      }
    ' || true
    return 0
  fi
  if command -v netstat >/dev/null 2>&1; then
    netstat -ltnp 2>/dev/null | awk -v port="$WEBUI_PORT" '
      $4 ~ (":" port "$") && match($0, /[0-9]+\//) {
        print substr($0, RSTART, RLENGTH - 1)
        exit
      }
    ' || true
    return 0
  fi
  return 1
}

port_is_busy() {
  local owner
  owner=$(port_owner_pid || true)
  [ -n "$owner" ]
}

show_port_owner() {
  local owner
  owner=$(port_owner_pid || true)
  if [ -z "$owner" ]; then
    echo "Could not determine the process occupying port $WEBUI_PORT." >&2
    return 1
  fi
  echo "Port $WEBUI_PORT is owned by PID $owner:"
  ps -p "$owner" -o pid=,comm=,args= 2>/dev/null || true
}

force_stop_port_owner() {
  local owner
  owner=$(port_owner_pid || true)
  if [ -z "$owner" ]; then
    echo "[ERROR] No port-owner PID is available to stop." >&2
    return 1
  fi
  echo "Stopping port owner PID $owner..."
  kill -TERM "$owner" 2>/dev/null || true
  sleep 1
  kill -KILL "$owner" 2>/dev/null || true
}

wait_for_port_free() {
  local wait_count=0
  while port_is_busy; do
    wait_count=$((wait_count + 1))
    if [ "$wait_count" -ge 5 ]; then
      return 1
    fi
    sleep 1
  done
}

stop_running_service() {
  local tracked_pid=
  if [ -f "$WEBUI_PID_FILE" ]; then
    tracked_pid=$(cat "$WEBUI_PID_FILE")
    if [ -n "$tracked_pid" ]; then
      kill -TERM "$tracked_pid" 2>/dev/null || true
      sleep 1
      kill -KILL "$tracked_pid" 2>/dev/null || true
    fi
  fi
  if port_is_busy; then
    force_stop_port_owner
    wait_for_port_free || return 1
  fi
  rm -f "$WEBUI_PID_FILE"
}

show_status() {
  echo "============================================================"
  echo " Current WebUI status"
  echo "============================================================"
  local owner
  owner=$(port_owner_pid || true)
  if [ -n "$owner" ]; then
    echo "Status: RUNNING"
    echo "URL:    http://$WEBUI_HOST:$WEBUI_PORT"
    show_port_owner || true
    return 0
  fi
  if [ -f "$WEBUI_PID_FILE" ]; then
    local tracked_pid
    tracked_pid=$(cat "$WEBUI_PID_FILE")
    if [ -n "$tracked_pid" ] && kill -0 "$tracked_pid" 2>/dev/null; then
      echo "Status: STARTING"
      echo "Log:    $WEBUI_LOG"
      return 0
    fi
  fi
  echo "Status: STOPPED"
  echo "Log:    $WEBUI_LOG"
  return 1
}

ensure_dependencies() {
  if [ ! -f package.json ]; then
    echo "[ERROR] package.json was not found in $SCRIPT_DIR" >&2
    return 1
  fi
  if ! node scripts/check-webui-dependencies.cjs; then
    if [ "$WEBUI_INSTALL" = 0 ]; then
      echo "[ERROR] Dependencies are missing or belong to another operating system." >&2
      echo "        Remove --no-install so the launcher can repair them." >&2
      return 1
    fi
    echo "Installing dependencies for $(uname -s)/$(uname -m)..."
    corepack pnpm install --force --frozen-lockfile
    node scripts/check-webui-dependencies.cjs
  fi
}

ensure_supported_bind() {
  case "$WEBUI_HOST" in
    0.0.0.0|127.0.0.1|localhost|::1) return 0 ;;
    *)
      echo "[ERROR] Unsupported bind address: $WEBUI_HOST" >&2
      echo "        Use 0.0.0.0 for all interfaces or a loopback address for local-only access." >&2
      return 1
      ;;
  esac
}

start_background() {
  mkdir -p "$WEBUI_RUNTIME"
  echo "Starting CrewQual WebUI in the background..."
  nohup node node_modules/next/dist/bin/next dev \
    --hostname "$WEBUI_HOST" \
    --port "$WEBUI_PORT" \
    >"$WEBUI_LOG" 2>&1 &
  echo "$!" >"$WEBUI_PID_FILE"
}

open_webui() {
  local url=http://$WEBUI_HOST:$WEBUI_PORT
  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$url" >/dev/null 2>&1 &
  elif command -v open >/dev/null 2>&1; then
    open "$url" >/dev/null 2>&1 &
  elif command -v wslview >/dev/null 2>&1; then
    wslview "$url" >/dev/null 2>&1 &
  else
    echo "[WARN] Could not find a browser opener. Open $url manually." >&2
  fi
}

execute_action() {
  echo "============================================================"
  echo " CrewQual WebUI"
  echo " Project: $SCRIPT_DIR"
  echo " Action: $WEBUI_ACTION"
  echo " Address: http://$WEBUI_HOST:$WEBUI_PORT"
  echo "============================================================"
  echo

  case "$WEBUI_ACTION" in
    status)
      show_status || true
      ;;
    stop)
      stop_running_service
      ;;
    run|restart)
      ensure_supported_bind
      ensure_dependencies
      if [ "$WEBUI_ACTION" = restart ]; then
        stop_running_service
      fi
      if port_is_busy; then
        echo "[WARN] Port $WEBUI_PORT is already in use. The launcher will release its current owner."
        show_port_owner || true
        echo
        echo "Force-stopping the process that owns port $WEBUI_PORT..."
        force_stop_port_owner
        wait_for_port_free
      fi
      start_background
      for _ in 1 2 3 4 5 6 7 8 9 10; do
        if port_is_busy; then
          break
        fi
        sleep 1
      done
      if [ "$WEBUI_OPEN" = 1 ]; then
        open_webui
      fi
      echo "WebUI start request sent. Log: $WEBUI_LOG"
      show_status
      ;;
    *)
      echo "[ERROR] Unknown action: $WEBUI_ACTION" >&2
      return 2
      ;;
  esac

  echo
  echo "CrewQual WebUI command completed."
  pause_if_needed
}

menu() {
  while true; do
    clear 2>/dev/null || true
    show_status || true
    echo
    echo "Choose an action:"
    echo "  [1] Start WebUI"
    echo "  [2] Restart WebUI"
    echo "  [3] Show status"
    echo "  [4] Stop WebUI"
    echo "  [5] Exit"
    echo
    read -r -p "Enter 1, 2, 3, 4, or 5: " choice || return 0
    case "$choice" in
      1) WEBUI_ACTION=run ;;
      2) WEBUI_ACTION=restart ;;
      3) WEBUI_ACTION=status ;;
      4) WEBUI_ACTION=stop ;;
      5) return 0 ;;
      *) continue ;;
    esac
    execute_action || true
  done
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    run|RUN) WEBUI_ACTION=run; shift ;;
    stop|STOP) WEBUI_ACTION=stop; shift ;;
    restart|RESTART) WEBUI_ACTION=restart; shift ;;
    status|STATUS) WEBUI_ACTION=status; shift ;;
    --host)
      [ "$#" -ge 2 ] || { usage; exit 2; }
      WEBUI_HOST=$2
      shift 2
      ;;
    --port)
      [ "$#" -ge 2 ] || { usage; exit 2; }
      WEBUI_PORT=$2
      shift 2
      ;;
    --open) WEBUI_OPEN=1; shift ;;
    --no-install) WEBUI_INSTALL=0; shift ;;
    --no-pause) WEBUI_PAUSE=0; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "[ERROR] Unknown argument: $1" >&2; usage; exit 2 ;;
  esac
done

if [ "$ORIGINAL_ARG_COUNT" -eq 0 ]; then
  WEBUI_INTERACTIVE=1
  menu
else
  execute_action
fi
