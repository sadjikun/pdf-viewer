@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
title pdf-viewer - Installation

echo.
echo  +--------------------------------------+
echo  ^|       pdf-viewer  --  install        ^|
echo  +--------------------------------------+
echo.

REM ── Detecter Python : launcher "py" en priorite, sinon "python" ────────────
set PYCMD=
set PYVER=

py --version >nul 2>&1
if not errorlevel 1 (
    for /f "tokens=2" %%v in ('py --version 2^>^&1') do set PYVER=%%v
    set PYCMD=py
    goto :check_version
)

python --version >nul 2>&1
if not errorlevel 1 (
    for /f "tokens=2" %%v in ('python --version 2^>^&1') do set PYVER=%%v
    set PYCMD=python
    goto :check_version
)

echo  [!!] Python non trouve.
echo       Installe-le depuis https://www.python.org/downloads/
echo       ou via : winget install Python.Python.3
echo.
pause
exit /b 1

:check_version
for /f "tokens=1,2 delims=." %%a in ("!PYVER!") do (
    set PY_MAJOR=%%a
    set PY_MINOR=%%b
)
if !PY_MAJOR! LSS 3 goto :py_too_old
if !PY_MAJOR! EQU 3 if !PY_MINOR! LSS 13 goto :py_too_old
echo  [OK] Python !PYVER! detecte (!PYCMD!).
goto :check_node

:py_too_old
echo  [!!] Python !PYVER! trop ancien (3.13 minimum requis).
echo       Telecharge la derniere version sur https://www.python.org/downloads/
pause
exit /b 1

:check_node
node --version >nul 2>&1
if errorlevel 1 (
    echo  [!!] Node.js non trouve dans le PATH.
    echo       Telecharge-le sur https://nodejs.org (version LTS)
    echo       ou via : winget install OpenJS.NodeJS.LTS
    echo.
    pause
    exit /b 1
)
for /f %%v in ('node --version') do echo  [OK] Node.js %%v detecte.

REM ══════════════════════════════════════════════════════════════════════════
REM  BACKEND
REM ══════════════════════════════════════════════════════════════════════════
echo.
echo  --- Backend Python ---------------------------------------------------
cd backend

if not exist ".venv" (
    echo  Creation du venv avec Python !PYVER!...
    !PYCMD! -m venv .venv
    if errorlevel 1 (
        echo  [!!] Echec creation du venv.
        pause
        exit /b 1
    )
    echo  [OK] Venv cree.
) else (
    echo  [OK] Venv existant trouve, skip.
)

echo  Installation des dependances Python (~2 Go, patiente...)
call .venv\Scripts\activate
pip install --upgrade pip >nul
pip install -r requirements.txt
if errorlevel 1 (
    echo  [!!] Echec pip install. Consulte les messages ci-dessus.
    pause
    exit /b 1
)
echo  [OK] Dependances Python installees.
deactivate

cd ..

REM ══════════════════════════════════════════════════════════════════════════
REM  FRONTEND
REM ══════════════════════════════════════════════════════════════════════════
echo.
echo  --- Frontend Node.js -------------------------------------------------
cd frontend

echo  Installation des packages npm...
call npm install
if errorlevel 1 (
    echo  [!!] Echec npm install. Consulte les messages ci-dessus.
    pause
    exit /b 1
)
echo  [OK] Packages npm installes.

cd ..

REM ══════════════════════════════════════════════════════════════════════════
echo.
echo  +--------------------------------------+
echo  ^|  Installation terminee avec succes  ^|
echo  ^|  Lance start.bat pour demarrer !    ^|
echo  +--------------------------------------+
echo.
pause
endlocal
