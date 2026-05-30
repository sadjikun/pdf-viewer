@echo off
cd /d "%~dp0"
if not exist "backend\.venv\Scripts\pythonw.exe" (
    echo  [!!] Le venv Python n'est pas installe.
    echo       Lance setup.bat ou setup_dev.bat d'abord.
    pause
    exit /b 1
)
start "" "backend\.venv\Scripts\pythonw.exe" "%~dp0launcher.py"
