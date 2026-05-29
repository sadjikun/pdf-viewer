@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"
title pdf-viewer - Build launcher.exe

echo.
echo  +--------------------------------------+
echo  ^|     pdf-viewer  --  build .exe      ^|
echo  +--------------------------------------+
echo.

if not exist "backend\.venv\Scripts\activate.bat" (
    echo  [!!] Venv Python absent. Lance install.bat d'abord.
    pause & exit /b 1
)

call backend\.venv\Scripts\activate

echo  [1/3] Installation de PyInstaller...
pip install pyinstaller --quiet
if errorlevel 1 (
    echo  [!!] Echec pip install pyinstaller.
    pause & exit /b 1
)
echo  [OK] PyInstaller pret.

echo.
echo  [2/3] Compilation de launcher.py...

pyinstaller ^
  --onefile ^
  --windowed ^
  --name launcher ^
  --icon assets\app.ico ^
  --distpath . ^
  --workpath build\_pyinstaller ^
  --specpath build ^
  --collect-all webview ^
  --hidden-import=psutil ^
  --hidden-import=PIL._imaging ^
  --add-data "assets\app.ico;assets" ^
  --add-data "assets\MicrosoftEdgeWebview2Setup.exe;assets" ^
  --add-data "launcher_core.py;." ^
  launcher.py

if errorlevel 1 (
    echo.
    echo  [!!] Compilation echouee. Voir les messages ci-dessus.
    pause & exit /b 1
)

echo.
echo  [3/3] Nettoyage des fichiers temporaires...
if exist "build\_pyinstaller" rmdir /s /q "build\_pyinstaller" 2>nul
if exist "build\launcher.spec" del /q "build\launcher.spec" 2>nul

echo.
echo  +----------------------------------------------+
echo  ^|  [OK] launcher.exe cree dans ce dossier !   ^|
echo  ^|                                              ^|
echo  ^|  Double-clic : fenetre de l'application.     ^|
echo  ^|  Choix Standard / Mode IA dans la fenetre.   ^|
echo  +----------------------------------------------+
echo.
pause
endlocal
