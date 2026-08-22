@echo off
setlocal

set "TOOL_DIR=%~dp0"
set "VENV_DIR=%LOCALAPPDATA%\CrewQual\pilot-mock-venv"

where py >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Python launcher ^(py.exe^) was not found. Install Python 3.11 or newer first.
  exit /b 1
)

py -3 -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)"
if errorlevel 1 (
  echo [ERROR] Python 3.11 or newer is required.
  exit /b 1
)

if not exist "%VENV_DIR%\Scripts\python.exe" (
  echo [SETUP] Creating an isolated environment at "%VENV_DIR%"...
  py -3 -m venv "%VENV_DIR%"
  if errorlevel 1 exit /b 1
)

echo [SETUP] Installing the XLSX dependency...
"%VENV_DIR%\Scripts\python.exe" -m pip install --disable-pip-version-check -r "%TOOL_DIR%requirements.txt"
if errorlevel 1 exit /b 1

echo [DONE] Windows conversion environment is ready.
exit /b 0
