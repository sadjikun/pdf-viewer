@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
title Installation de PDF Viewer

set SILENT_MODE=0
if "%1"=="/msi" set SILENT_MODE=1
if "%1"=="/silent" set SILENT_MODE=1

if "!SILENT_MODE!"=="1" (
    set "TARGET_DIR=%~dp0"
    if "!TARGET_DIR:~-1!"=="\" set "TARGET_DIR=!TARGET_DIR:~0,-1!"
    goto :start_setup
)

echo.
echo  ======================================================
echo     Assistant d'installation de PDF Viewer
echo  ======================================================
echo.
echo  Ce script va installer PDF Viewer sur votre ordinateur :
echo  - Copie des fichiers dans : %%LocalAppData%%\Programs\PDF-Viewer
echo  - Creation d'un raccourci sur le Bureau et le Menu Demarrer
echo  - Configuration automatique de l'environnement Python
echo.
echo  Aucun droit administrateur n'est requis.
echo.
set /p CONFIRM="Voulez-vous continuer ? (O/N) : "
if /i not "!CONFIRM!"=="O" (
    echo Installation annulee.
    pause
    exit /b 0
)

:start_setup

REM ── 1. Detecter / Installer Python 3.13 ────────────────────────────────────
echo.
echo  --- Etape 1 : Verification de Python 3.13 ----------------------------
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

:install_python_prompt
if "!SILENT_MODE!"=="1" (
    echo  [!!] Python 3.13 non trouve. Tentative d'installation automatique via winget...
    winget install Python.Python.3.13 --exact --silent --accept-package-agreements --accept-source-agreements
    if errorlevel 1 (
        echo  [!!] L'installation automatique a echoue.
        exit /b 1
    )
    echo  [OK] Python installe avec succes ! Relancez l'installation.
    exit /b 0
)
echo  [!!] Python 3.13 non trouve sur votre systeme.
echo  Voulez-vous installer automatiquement Python 3.13 via winget (recommande) ? (O/N)
set /p INSTALL_PY="Votre choix : "
if /i "!INSTALL_PY!"=="O" (
    echo Installation de Python 3.13 en cours, veuillez patienter...
    winget install Python.Python.3.13 --exact --silent --accept-package-agreements --accept-source-agreements
    if errorlevel 1 (
        echo  [!!] L'installation automatique a echoue.
        echo       Veuillez installer Python 3.13 manuellement depuis : https://www.python.org/downloads/
        pause
        exit /b 1
    )
    echo  [OK] Python installe avec succes !
    echo  Nous devons relancer l'assistant pour prendre en compte le nouveau chemin de Python.
    pause
    start "" "%~f0"
    exit /b 0
) else (
    echo       Veuillez installer Python 3.13 manuellement depuis : https://www.python.org/downloads/
    pause
    exit /b 1
)

:check_version
for /f "tokens=1,2 delims=." %%a in ("!PYVER!") do (
    set PY_MAJOR=%%a
    set PY_MINOR=%%b
)
if !PY_MAJOR! LSS 3 goto :py_too_old
if !PY_MAJOR! EQU 3 if !PY_MINOR! LSS 13 goto :py_too_old
echo  [OK] Python !PYVER! detecte (!PYCMD!).
goto :copy_files

:py_too_old
echo  [!!] Votre version de Python (!PYVER!) est trop ancienne (3.13 minimum requis).
goto :install_python_prompt

REM ── 2. Definir le dossier d'installation et copier les fichiers ────────────
:copy_files
echo.
echo  --- Etape 2 : Copie des fichiers de l'application --------------------
if "!SILENT_MODE!"=="1" (
    echo  [OK] Mode MSI actif : fichiers deja installes par Windows Installer.
    goto :setup_venv
)
set "TARGET_DIR=%LocalAppData%\Programs\PDF-Viewer"
echo  Destination : !TARGET_DIR!

if not exist "!TARGET_DIR!" (
    mkdir "!TARGET_DIR!"
)

echo  Copie en cours (via Robocopy)...
robocopy "%~dp0." "!TARGET_DIR!" /E /XD .git .github .claude .pytest_cache .venv cache __pycache__ tests scratch memory node_modules src public /XF package_app.py pdf-viewer-portable.zip .gitignore build.bat make_icon.py /NDL /NFL /NJH /NJS
if errorlevel 8 (
    echo  [!!] Echec de la copie des fichiers.
    pause
    exit /b 1
)
echo  [OK] Fichiers copies avec succes.

REM ── 3. Creer le VENV et installer les dependances ─────────────────────────
:setup_venv
echo.
echo  --- Etape 3 : Configuration de l'environnement Python ---------------
cd /d "!TARGET_DIR!\backend"

if not exist ".venv" (
    echo  Creation de l'environnement virtuel Python...
    !PYCMD! -m venv .venv
    if errorlevel 1 (
        echo  [!!] Echec de la creation de l'environnement virtuel.
        pause
        exit /b 1
    )
    echo  [OK] Environnement virtuel cree.
)

echo  Installation des dependances Python (~2 Go, patience...)
call .venv\Scripts\activate
pip install --upgrade pip >nul
pip install -r requirements.txt
if errorlevel 1 (
    echo  [!!] Echec de l'installation des dependances Python.
    pause
    exit /b 1
)
echo  [OK] Dependances Python installees avec succes.
deactivate

REM ── 4. Creer les raccourcis ────────────────────────────────────────────────
echo.
echo  --- Etape 4 : Creation des raccourcis -------------------------------
set "LAUNCHER_PATH=!TARGET_DIR!\launcher.exe"
set "LAUNCHER_BAT=!TARGET_DIR!\launcher.bat"
set "ICON_PATH=!TARGET_DIR!\assets\app.ico"

REM Si launcher.exe n'a pas ete compile ou pose probleme, on pointe vers launcher.bat
set "SHORTCUT_TARGET=!LAUNCHER_PATH!"
if not exist "!LAUNCHER_PATH!" (
    set "SHORTCUT_TARGET=!LAUNCHER_BAT!"
)

echo  Creation du raccourci sur le Bureau...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$WshShell = New-Object -ComObject WScript.Shell; $Shortcut = $WshShell.CreateShortcut([System.IO.Path]::Combine([System.Environment]::GetFolderPath('Desktop'), 'PDF Viewer.lnk')); $Shortcut.TargetPath = '!SHORTCUT_TARGET!'; $Shortcut.WorkingDirectory = '!TARGET_DIR!'; $Shortcut.IconLocation = '!ICON_PATH!'; $Shortcut.Save()"

echo  Creation du raccourci dans le Menu Demarrer...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$WshShell = New-Object -ComObject WScript.Shell; $StartMenu = [System.IO.Path]::Combine([System.Environment]::GetFolderPath('Programs'), 'PDF Viewer.lnk'); $Shortcut = $WshShell.CreateShortcut($StartMenu); $Shortcut.TargetPath = '!SHORTCUT_TARGET!'; $Shortcut.WorkingDirectory = '!TARGET_DIR!'; $Shortcut.IconLocation = '!ICON_PATH!'; $Shortcut.Save()"

echo  [OK] Raccourcis crees.

if "!SILENT_MODE!"=="1" (
    echo.
    echo  ======================================================
    echo     Installation par MSI terminee avec succes !
    echo  ======================================================
    endlocal
    exit /b 0
)

REM ── 5. Fin ─────────────────────────────────────────────────────────────────
echo.
echo  ======================================================
echo     Installation terminee avec succes !
echo  ======================================================
echo.
echo  Vous pouvez maintenant lancer l'application :
echo  - Depuis votre Bureau (icone PDF Viewer)
echo  - Depuis votre Menu Demarrer
echo.
echo  Vous pouvez supprimer le dossier d'installation temporaire / archive ZIP.
echo.
set /p LAUNCH_NOW="Voulez-vous lancer PDF Viewer maintenant ? (O/N) : "
if /i "!LAUNCH_NOW!"=="O" (
    start "" "!SHORTCUT_TARGET!"
)

endlocal
exit /b 0
