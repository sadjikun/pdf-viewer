@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"
set "ROOT=%~dp0"
title pdf-viewer - Lanceur

echo.
echo  +--------------------------------------+
echo  ^|         pdf-viewer  -- start         ^|
echo  +--------------------------------------+
echo.

REM ── Verifications ──────────────────────────────────────────────────────────
if not exist "backend\.venv\Scripts\activate.bat" (
    echo  [!!] Le venv Python n'existe pas.
    echo       Lance install.bat d'abord, puis relance start.bat.
    echo.
    pause & exit /b 1
)
if not exist "frontend\node_modules" (
    echo  [!!] Les packages npm ne sont pas installes.
    echo       Lance install.bat d'abord, puis relance start.bat.
    echo.
    pause & exit /b 1
)

REM ── Trouver un port libre pour le backend ──────────────────────────────────
set BACKEND_PORT=0
for %%P in (8000 8001 8002 8003 8080 8888) do (
    if !BACKEND_PORT!==0 (
        netstat -ano 2>nul | findstr ":%%P " >nul 2>&1
        if errorlevel 1 set BACKEND_PORT=%%P
    )
)
if !BACKEND_PORT!==0 (
    echo  [!!] Aucun port libre pour le backend.
    pause & exit /b 1
)
echo  [OK] Port backend  : !BACKEND_PORT!

REM ── Trouver un port libre pour le frontend ──────────────────────────────────
set FRONTEND_PORT=0
for %%P in (5173 5174 5175 5176 5177 5200) do (
    if !FRONTEND_PORT!==0 (
        netstat -ano 2>nul | findstr ":%%P " >nul 2>&1
        if errorlevel 1 set FRONTEND_PORT=%%P
    )
)
if !FRONTEND_PORT!==0 (
    echo  [!!] Aucun port libre pour le frontend.
    pause & exit /b 1
)
echo  [OK] Port frontend : !FRONTEND_PORT!

REM ── Mettre a jour le .env.local du frontend ────────────────────────────────
echo VITE_API_BASE=http://127.0.0.1:!BACKEND_PORT!> "frontend\.env.local"
echo  [OK] frontend\.env.local -> http://127.0.0.1:!BACKEND_PORT!

REM ── Scripts temporaires dans %TEMP% ────────────────────────────────────────
(
    echo @echo off
    echo title  Backend :!BACKEND_PORT!
    echo cd /d "!ROOT!backend"
    echo call .venv\Scripts\activate
    echo echo.
    echo echo  =^> Backend : http://127.0.0.1:!BACKEND_PORT!
    echo echo.
    echo uvicorn main:app --reload --reload-exclude .venv --port !BACKEND_PORT!
    echo pause
) > "%TEMP%\pv_backend.cmd"

(
    echo @echo off
    echo title  Frontend :5173
    echo cd /d "!ROOT!frontend"
    echo echo.
    echo echo  =^> Frontend : http://localhost:5173
    echo echo.
    echo npm run dev
    echo pause
) > "%TEMP%\pv_frontend.cmd"

REM ── Lancer Windows Terminal : 1 fenetre, 2 volets cote a cote ─────────────
echo  [1/2] Ouverture de Windows Terminal...
wt new-tab --title "Backend" cmd /k "%TEMP%\pv_backend.cmd" ; split-pane -V --title "Frontend" cmd /k "%TEMP%\pv_frontend.cmd"

REM ── Ouvrir le navigateur apres que les serveurs demarrent ──────────────────
timeout /t 7 /nobreak > nul
echo  [2/2] Ouverture du navigateur...
start http://localhost:5173

echo.
echo  [OK] pdf-viewer lance !
echo       Backend  --^> http://127.0.0.1:!BACKEND_PORT!
echo       Frontend --^> http://localhost:5173
echo.
echo  Cette fenetre peut etre fermee.
timeout /t 3 /nobreak > nul

endlocal
