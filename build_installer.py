import os
import sys
import subprocess
import shutil
from pathlib import Path

ROOT = Path(__file__).parent.resolve()
ISS_FILE = ROOT / "setup.iss"
OUT_EXE = ROOT / "pdf-viewer-setup.exe"

def generate_iss():
    """Génère le script d'installation Inno Setup."""
    print("Génération du script setup.iss...")
    
    iss_content = """; Script Inno Setup pour PDF Viewer
[Setup]
AppName=PDF Viewer
AppVersion=0.2.0
AppPublisher=MHDINGBI
DefaultDirName={localappdata}\\Programs\\PDF-Viewer
DefaultGroupName=PDF Viewer
UninstallDisplayIcon={app}\\assets\\app.ico
Compression=lzma2
SolidCompression=yes
OutputDir=.
OutputBaseFilename=pdf-viewer-setup
PrivilegesRequired=lowest
DisableWelcomePage=no
DisableDirPage=no
DisableProgramGroupPage=yes

[Languages]
Name: "french"; MessagesFile: "compiler:Languages\\French.isl"

[Tasks]
Name: "desktopicon"; Description: "Créer un raccourci sur le Bureau"; GroupDescription: "Raccourcis supplémentaires :"

[Files]
; Fichiers principaux de l'application
Source: "launcher.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "launcher.bat"; DestDir: "{app}"; Flags: ignoreversion
Source: "launcher.py"; DestDir: "{app}"; Flags: ignoreversion
Source: "launcher_core.py"; DestDir: "{app}"; Flags: ignoreversion
Source: "setup.bat"; DestDir: "{app}"; Flags: ignoreversion
Source: "README.md"; DestDir: "{app}"; Flags: ignoreversion

; Répertoires de l'application
Source: "assets\\*"; DestDir: "{app}\\assets"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "backend\\*"; DestDir: "{app}\\backend"; Excludes: ".venv,cache,__pycache__,.pytest_cache,tests"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "frontend\\dist\\*"; DestDir: "{app}\\frontend\\dist"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\\PDF Viewer"; Filename: "{app}\\launcher.exe"; IconFilename: "{app}\\assets\\app.ico"
Name: "{userdesktop}\\PDF Viewer"; Filename: "{app}\\launcher.exe"; IconFilename: "{app}\\assets\\app.ico"; Tasks: desktopicon

[Run]
; Exécuter setup.bat en mode silencieux à la fin pour créer le venv et lancer pip install
Filename: "cmd.exe"; Parameters: "/c ""{app}\\setup.bat"" /msi"; StatusMsg: "Configuration de l'environnement Python et des dépendances (cette étape prend 1 à 2 minutes)..."; Flags: runhidden

; Proposer de lancer l'application à la fin
Filename: "{app}\\launcher.exe"; Description: "Lancer PDF Viewer maintenant"; Flags: nowait postinstall skipifsilent
"""
    ISS_FILE.write_text(iss_content, encoding="utf-8")
    print("Fichier setup.iss créé.")

def find_iscc():
    """Trouve l'exécutable du compilateur Inno Setup ISCC.exe."""
    # 1. Vérifier si ISCC est dans le PATH
    iscc = shutil.which("ISCC")
    if iscc:
        return iscc
        
    # 2. Chercher dans les dossiers standards d'installation
    search_paths = [
        Path(os.environ.get("ProgramFiles(x86)", "C:\\Program Files (x86)")) / "Inno Setup 6",
        Path(os.environ.get("ProgramFiles", "C:\\Program Files")) / "Inno Setup 6",
        Path(os.environ.get("LocalAppData", "")) / "Programs" / "Inno Setup 6",
    ]
    
    for path in search_paths:
        iscc_path = path / "ISCC.exe"
        if iscc_path.exists():
            return str(iscc_path)
            
    return None

def compile_installer(iscc_path):
    """Exécute ISCC.exe pour compiler l'installateur."""
    print(f"Utilisation du compilateur Inno Setup : {iscc_path}")
    print("Compilation de l'installateur en cours (génération de pdf-viewer-setup.exe)...")
    
    try:
        res = subprocess.run([iscc_path, "setup.iss"], capture_output=True, text=True, encoding="utf-8", errors="replace")
        if res.returncode == 0:
            print("\n==========================================")
            print("[SUCCÈS] Installateur exe créé : pdf-viewer-setup.exe")
            print("==========================================")
            
            # Nettoyage
            if ISS_FILE.exists():
                ISS_FILE.unlink()
            return True
        else:
            print("[ERREUR] La compilation a échoué :")
            print(res.stdout)
            print(res.stderr)
            return False
    except Exception as e:
        print(f"[ERREUR] Impossible de lancer le compilateur : {e}")
        return False

def main():
    print("==========================================")
    print("     Constructeur d'installateur EXE      ")
    print("==========================================")
    
    # 1. Générer le fichier setup.iss
    generate_iss()
    
    # 2. Trouver le compilateur
    iscc = find_iscc()
    if not iscc:
        print("[ERREUR] Compilateur Inno Setup (ISCC.exe) introuvable.")
        print("Veuillez installer Inno Setup 6 manuellement ou via winget.")
        if ISS_FILE.exists():
            ISS_FILE.unlink()
        sys.exit(1)
        
    # 3. Lancer la compilation
    if compile_installer(iscc):
        print("\nVotre installateur exe est prêt à être partagé !")
    else:
        sys.exit(1)

if __name__ == "__main__":
    main()
