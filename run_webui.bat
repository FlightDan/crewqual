@echo off
setlocal EnableExtensions EnableDelayedExpansion

title CrewQual WebUI
cd /d "%~dp0"

set "WEBUI_ACTION=run"
set "WEBUI_HOST=%WEBUI_HOST%"
set "WEBUI_PORT=%WEBUI_PORT%"
if not defined WEBUI_HOST set "WEBUI_HOST=0.0.0.0"
if not defined WEBUI_PORT set "WEBUI_PORT=3000"
set "WEBUI_OPEN=0"
set "WEBUI_INSTALL=1"
set "WEBUI_PAUSE=1"
set "WEBUI_INTERACTIVE=0"
set "WEBUI_ROOT=%CD%"
set "WEBUI_RUNTIME=%CD%\.dispatcher\webui\runtime"
set "WEBUI_LOG=%WEBUI_RUNTIME%\webui.log"
set "WEBUI_LOG_POINTER=%WEBUI_RUNTIME%\webui.log.path"
set "WEBUI_PID_FILE=%WEBUI_RUNTIME%\webui.pid"
if exist "%WEBUI_LOG_POINTER%" set /p WEBUI_LOG=<"%WEBUI_LOG_POINTER%"

if "%~1"=="" (
    set "WEBUI_INTERACTIVE=1"
    goto menu
)

:parse_args
if "%~1"=="" goto execute
if /i "%~1"=="run" (
    set "WEBUI_ACTION=run"
    shift
    goto parse_args
)
if /i "%~1"=="stop" (
    set "WEBUI_ACTION=stop"
    shift
    goto parse_args
)
if /i "%~1"=="restart" (
    set "WEBUI_ACTION=restart"
    shift
    goto parse_args
)
if /i "%~1"=="status" (
    set "WEBUI_ACTION=status"
    shift
    goto parse_args
)
if /i "%~1"=="--host" (
    if "%~2"=="" goto bad_args
    set "WEBUI_HOST=%~2"
    shift
    shift
    goto parse_args
)
if /i "%~1"=="--port" (
    if "%~2"=="" goto bad_args
    set "WEBUI_PORT=%~2"
    shift
    shift
    goto parse_args
)
if /i "%~1"=="--open" (
    set "WEBUI_OPEN=1"
    shift
    goto parse_args
)
if /i "%~1"=="--no-install" (
    set "WEBUI_INSTALL=0"
    shift
    goto parse_args
)
if /i "%~1"=="--no-pause" (
    set "WEBUI_PAUSE=0"
    shift
    goto parse_args
)
if /i "%~1"=="-h" goto help
if /i "%~1"=="--help" goto help
echo [ERROR] Unknown argument: %~1
goto bad_args

:menu
cls
call :show_status
echo.
echo Choose an action:
echo   [1] Start WebUI
echo   [2] Restart WebUI
echo   [3] Show status
echo   [4] Stop WebUI
echo   [5] Exit
echo.
choice /C 12345 /N /M "Enter 1, 2, 3, 4, or 5: "
if errorlevel 5 exit /b 0
if errorlevel 4 set "WEBUI_ACTION=stop" & goto execute
if errorlevel 3 set "WEBUI_ACTION=status" & goto execute
if errorlevel 2 set "WEBUI_ACTION=restart" & goto execute
set "WEBUI_ACTION=run"
goto execute

:execute
echo ============================================================
echo  CrewQual WebUI
echo  Project: %CD%
echo  Action: %WEBUI_ACTION%
echo  Address: http://%WEBUI_HOST%:%WEBUI_PORT%
echo ============================================================
echo.

if /i "%WEBUI_ACTION%"=="status" (
    call :show_status
    goto action_complete
)
if /i "%WEBUI_ACTION%"=="stop" (
    call :stop_running_service
    if errorlevel 1 goto failed
    goto action_complete
)

call :ensure_supported_bind
if errorlevel 1 goto failed

if not exist "package.json" (
    echo [ERROR] package.json was not found in %CD%
    goto failed
)
call :dependencies_are_usable
if errorlevel 1 (
    if "%WEBUI_INSTALL%"=="0" (
        echo [ERROR] Dependencies are missing or belong to another operating system.
        echo        Remove --no-install so the launcher can repair them.
        goto failed
    )
    echo Installing dependencies for Windows...
    call :install_dependencies --force
    if errorlevel 1 goto failed
    call :dependencies_are_usable
    if errorlevel 1 (
        echo [ERROR] Dependency installation completed, but the Windows native modules are still missing.
        goto failed
    )
)

if /i "%WEBUI_ACTION%"=="restart" (
    call :stop_running_service
    if errorlevel 1 goto failed
)

call :port_is_busy
if not errorlevel 1 (
    echo [WARN] Port %WEBUI_PORT% is already in use. The launcher will release its current owner.
    call :show_port_owner
    echo.
    echo Force-stopping the process that owns port %WEBUI_PORT%...
    call :force_stop_port_owner
    if errorlevel 1 goto failed
    call :wait_for_port_free
    if errorlevel 1 goto failed
)

if not exist "%WEBUI_RUNTIME%" mkdir "%WEBUI_RUNTIME%" >nul 2>nul
echo Starting CrewQual WebUI in the background...
call :start_background
if errorlevel 1 goto failed
call :wait_for_webui_ready
if errorlevel 1 (
    echo [ERROR] WebUI did not reach the running state within 45 seconds. See: %WEBUI_LOG%
    if exist "%WEBUI_LOG%" (
        echo.
        echo --- Last lines of %WEBUI_LOG% ---
        powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Content -LiteralPath '%WEBUI_LOG%' -Encoding utf8 -Tail 30"
    )
    goto failed
)
if "%WEBUI_OPEN%"=="1" start "" "http://%WEBUI_HOST%:%WEBUI_PORT%"
echo WebUI start request sent. Log: %WEBUI_LOG%
call :show_status
if errorlevel 1 (
    echo [ERROR] WebUI did not reach the running state. See: %WEBUI_LOG%
    if exist "%WEBUI_LOG%" (
        echo.
        echo --- Last lines of %WEBUI_LOG% ---
        powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Content -LiteralPath '%WEBUI_LOG%' -Encoding utf8 -Tail 15"
    )
    goto failed
)
goto action_complete

:start_background
set "WEBUI_ROOT=%CD%"
set "WEBUI_RUNTIME=%CD%\.dispatcher\webui\runtime"
set "WEBUI_LOG=%WEBUI_RUNTIME%\webui.log"
set "WEBUI_LOG_POINTER=%WEBUI_RUNTIME%\webui.log.path"
set "WEBUI_PID_FILE=%WEBUI_RUNTIME%\webui.pid"
if not exist "%WEBUI_RUNTIME%" mkdir "%WEBUI_RUNTIME%" >nul 2>nul
if exist "%WEBUI_RUNTIME%\webui.previous.log" del /q "%WEBUI_RUNTIME%\webui.previous.log" >nul 2>nul
if exist "%WEBUI_LOG%" move /y "%WEBUI_LOG%" "%WEBUI_RUNTIME%\webui.previous.log" >nul 2>nul
if exist "%WEBUI_LOG%" (
    set "WEBUI_LOG=%WEBUI_RUNTIME%\webui.!RANDOM!.log"
    echo [WARN] The canonical log is locked; using !WEBUI_LOG!
)
> "%WEBUI_LOG_POINTER%" echo %WEBUI_LOG%

rem Run the JavaScript entry point directly. pnpm creates different .bin
rem shims on Windows and Linux, so those shims are deliberately not shared.
set "WEBUI_NEXT_ENTRY=%CD%\node_modules\next\dist\bin\next"
if not exist "%WEBUI_NEXT_ENTRY%" (
    echo [ERROR] The Next.js executable was not found under node_modules.
    echo        Rerun without --no-install so dependencies can be repaired.
    exit /b 1
)

rem --- Launch a hidden cmd.exe that runs the dev server and logs ------
rem The command is passed to cmd /c as one raw string (no Start-Process
rem re-quoting), so embedded quotes survive intact.
rem
rem Use Webpack polling for the Windows/SMB workspace. Turbopack emits chunk
rem names containing colons (for example node:buffer) that Win32 cannot create
rem on this mapped drive. A dedicated dev directory also avoids stale locks in
rem the default .next-dev artifacts left by earlier failed launches.
set "WATCHPACK_POLLING=true"
set "CREWQUAL_DIST_DIR=.next-dev-windows"
set "WEBUI_CMD=node "%WEBUI_NEXT_ENTRY%" dev --hostname %WEBUI_HOST% --port %WEBUI_PORT% > "%WEBUI_LOG%" 2>&1"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$psi = New-Object System.Diagnostics.ProcessStartInfo; $psi.FileName = $env:ComSpec; $psi.Arguments = '/d /c ' + $env:WEBUI_CMD; $psi.UseShellExecute = $false; $psi.CreateNoWindow = $true; $psi.WorkingDirectory = $env:WEBUI_ROOT; $p = [System.Diagnostics.Process]::Start($psi); Set-Content -LiteralPath $env:WEBUI_PID_FILE -Value $p.Id -Encoding ascii"
if errorlevel 1 (
    echo [ERROR] Failed to launch the background WebUI process.
    exit /b 1
)
exit /b 0

:ensure_supported_bind
if /i "%WEBUI_HOST%"=="0.0.0.0" exit /b 0
if /i "%WEBUI_HOST%"=="127.0.0.1" exit /b 0
if /i "%WEBUI_HOST%"=="localhost" exit /b 0
if /i "%WEBUI_HOST%"=="::1" exit /b 0
echo [ERROR] Unsupported bind address: %WEBUI_HOST%
echo        Use 0.0.0.0 for all interfaces or a loopback address for local-only access.
exit /b 1

:wait_for_webui_ready
rem Poll the listener through the .NET networking API. Get-NetTCPConnection
rem can block or return false negatives on this Windows/SMB host, even after
rem Next.js has printed "Ready". Keep the original launcher PID in the pid
rem file so taskkill /T can stop the complete cmd.exe -> node.exe tree.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$d=(Get-Date).AddSeconds(45); while((Get-Date) -lt $d){ $ports=[System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners().Port; if($ports -contains %WEBUI_PORT%){ exit 0 }; Start-Sleep -Milliseconds 500 }; exit 1"
exit /b %ERRORLEVEL%

:install_dependencies
set "WEBUI_INSTALL_ARGS=--frozen-lockfile"
if /i "%~1"=="--force" set "WEBUI_INSTALL_ARGS=--force --frozen-lockfile"
where corepack >nul 2>nul
if not errorlevel 1 (
    corepack pnpm install %WEBUI_INSTALL_ARGS%
    exit /b !ERRORLEVEL!
)
where pnpm >nul 2>nul
if not errorlevel 1 (
    pnpm install %WEBUI_INSTALL_ARGS%
    exit /b !ERRORLEVEL!
)
where npm >nul 2>nul
if not errorlevel 1 (
    echo [WARN] Falling back to npm install (corepack/pnpm not found).
    if /i "%~1"=="--force" (
        npm install --force --include=optional
    ) else (
        npm install --include=optional
    )
    exit /b !ERRORLEVEL!
)
echo [ERROR] Node.js tooling was not found. Install Node.js (bundles corepack)
echo        or pnpm, then rerun this command.
exit /b 1

:dependencies_are_usable
where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js was not found in PATH.
    exit /b 1
)
if not exist "%CD%\scripts\check-webui-dependencies.cjs" (
    echo [ERROR] The dependency checker is missing.
    exit /b 1
)
node "%CD%\scripts\check-webui-dependencies.cjs"
exit /b !ERRORLEVEL!

:stop_running_service
set "WEBUI_STOP_PID="
if exist "%WEBUI_PID_FILE%" set /p WEBUI_STOP_PID=<"%WEBUI_PID_FILE%"
if defined WEBUI_STOP_PID taskkill /PID %WEBUI_STOP_PID% /T /F >nul 2>nul
call :get_port_pid
if defined WEBUI_PORT_PID taskkill /PID %WEBUI_PORT_PID% /T /F >nul 2>nul
call :wait_for_port_free
if exist "%WEBUI_PID_FILE%" del /q "%WEBUI_PID_FILE%" >nul 2>nul
exit /b 0

:show_status
echo ============================================================
echo  Current WebUI status
echo ============================================================
call :port_is_busy
if not errorlevel 1 (
    echo Status: RUNNING
    echo URL:    http://%WEBUI_HOST%:%WEBUI_PORT%
    call :show_port_owner
    exit /b 0
)
if exist "%WEBUI_PID_FILE%" (
    set "WEBUI_STATUS_PID="
    set /p WEBUI_STATUS_PID=<"%WEBUI_PID_FILE%"
    if defined WEBUI_STATUS_PID (
        powershell -NoProfile -ExecutionPolicy Bypass -Command "if (Get-Process -Id !WEBUI_STATUS_PID! -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }" >nul 2>nul
        if not errorlevel 1 (
            echo Status: STARTING
            echo Log:    %WEBUI_LOG%
            exit /b 0
        )
    )
)
echo Status: STOPPED
echo Log:    %WEBUI_LOG%
exit /b 1

:get_port_pid
set "WEBUI_PORT_PID="
rem Native netstat is substantially more reliable here than the
rem Get-NetTCPConnection CIM cmdlet. Parse only an exact listening port.
for /f "usebackq delims=" %%P in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "$pattern='^\s*TCP\s+\S+:' + [regex]::Escape($env:WEBUI_PORT) + '\s+\S+\s+LISTENING\s+(\d+)\s*$'; $line=netstat.exe -ano -p TCP | Where-Object { $_ -match $pattern } | Select-Object -First 1; if($line -match '(\d+)\s*$'){ $matches[1] }"`) do set "WEBUI_PORT_PID=%%P"
exit /b 0

:port_is_busy
if not defined WEBUI_PORT exit /b 1
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ports=[System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners().Port; if($ports -contains %WEBUI_PORT%){ exit 0 } else { exit 1 }" >nul 2>nul
exit /b %ERRORLEVEL%

:show_port_owner
call :get_port_pid
if not defined WEBUI_PORT_PID (
    echo Could not determine the process occupying port %WEBUI_PORT%.
    exit /b 1
)
echo Port %WEBUI_PORT% is owned by PID %WEBUI_PORT_PID%:
tasklist /FI "PID eq %WEBUI_PORT_PID%" /FO TABLE /NH
exit /b 0

:force_stop_port_owner
call :get_port_pid
if not defined WEBUI_PORT_PID (
    echo [ERROR] No port-owner PID is available to stop.
    exit /b 1
)
echo Stopping port owner PID %WEBUI_PORT_PID%...
taskkill /PID %WEBUI_PORT_PID% /T /F
if errorlevel 1 exit /b 1
exit /b 0

:wait_for_port_free
set /a WEBUI_WAIT_COUNT=0
:wait_for_port_free_loop
call :port_is_busy
if errorlevel 1 exit /b 0
set /a WEBUI_WAIT_COUNT+=1
if !WEBUI_WAIT_COUNT! GEQ 5 exit /b 1
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Sleep -Milliseconds 1000" >nul 2>nul
goto wait_for_port_free_loop

:action_complete
if "%WEBUI_INTERACTIVE%"=="1" goto menu
echo.
echo CrewQual WebUI command completed.
if "%WEBUI_PAUSE%"=="1" pause
exit /b 0

:help
echo Usage: run_webui.bat [run^|stop^|restart^|status] [options]
echo.
echo Options:
echo   --host HOST    Bind address (default: 0.0.0.0)
echo   --port PORT    Listen port (default: 3000)
echo   --open         Open the WebUI in the default browser
echo   --no-install   Do not install missing dependencies
echo   --no-pause     Do not pause after the command exits
echo.
echo Running without arguments opens the interactive menu.
echo Service logs are written to .dispatcher\webui\runtime\webui.log.
echo.
echo Examples:
echo   run_webui.bat
echo   run_webui.bat run --open
echo   run_webui.bat restart --port 9000
echo   run_webui.bat status
echo   run_webui.bat stop
exit /b 0

:bad_args
echo.
echo Usage: run_webui.bat [run^|stop^|restart^|status] [--host HOST] [--port PORT]
exit /b 2

:failed
echo.
echo [ERROR] CrewQual WebUI command failed.
if "%WEBUI_INTERACTIVE%"=="1" (
    pause
    goto menu
)
if "%WEBUI_PAUSE%"=="1" pause
exit /b 1
