@echo off
setlocal

set "TOOL_DIR=%~dp0"
set "VENV_DIR=%LOCALAPPDATA%\CrewQual\pilot-mock-venv"

if not exist "%VENV_DIR%\Scripts\python.exe" (
  echo [ERROR] The isolated Python environment is missing. Run setup_windows.bat first.
  exit /b 1
)

if not defined CREWQUAL_MOCK_HMAC_KEY_HEX (
  echo [ERROR] CREWQUAL_MOCK_HMAC_KEY_HEX is not set in this terminal.
  echo [ERROR] Do not paste the key into an AI chat or add it to the command line.
  exit /b 2
)

"%VENV_DIR%\Scripts\python.exe" "%TOOL_DIR%convert_pilot_mock.py" %*
exit /b %ERRORLEVEL%
