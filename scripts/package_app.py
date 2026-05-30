import os
import zipfile
from pathlib import Path

ROOT = Path(__file__).parent.parent.resolve()
OUTPUT_ZIP = ROOT / "pdf-viewer-setup.zip"

def package():
    print("==========================================")
    print("      PDF Viewer - Packaging Tool        ")
    print("==========================================")
    
    # 1. Vérification que le build existe
    dist_dir = ROOT / "frontend" / "dist"
    if not dist_dir.exists():
        print("\n[ERREUR] Le dossier 'frontend/dist' n'existe pas.")
        print("Veuillez d'abord executer 'npm run build' dans le dossier frontend.")
        return

    # 2. Suppression de l'ancien ZIP s'il existe
    if OUTPUT_ZIP.exists():
        try:
            OUTPUT_ZIP.unlink()
        except Exception as e:
            print(f"[ERREUR] Impossible de supprimer l'ancien fichier ZIP : {e}")
            return

    print("\nCréation de l'archive ZIP...")
    count = 0
    with zipfile.ZipFile(OUTPUT_ZIP, "w", zipfile.ZIP_DEFLATED) as z:
        for file_path in ROOT.rglob("*"):
            if file_path.is_dir():
                continue
            
            # Calcul du chemin relatif par rapport à la racine du projet
            rel_path = file_path.relative_to(ROOT)
            parts = rel_path.parts
            
            # Exclusions de dossiers globaux (developpement / caches / tests / scripts)
            if any(p in (".git", ".github", ".claude", ".pytest_cache", "__pycache__", "samples", "tests", "scratch", "memory", "scripts") for p in parts):
                continue
                
            # Exclusions spécifiques au Backend
            if parts[0] == "backend":
                if any(p in (".venv", "cache", "__pycache__", ".pytest_cache", "tests") for p in parts):
                    continue
            
            # Exclusions spécifiques au Frontend
            # On ne garde QUE le dossier "dist" (les fichiers statiques compilés). 
            # node_modules, src, public et fichiers de configuration de dev sont exclus.
            if parts[0] == "frontend":
                if len(parts) < 2 or parts[1] != "dist":
                    continue
            
            # Exclusions des fichiers de build ou de packaging à la racine
            if len(parts) == 1:
                if parts[0] in ("package_app.py", "pdf-viewer-portable.zip", "pdf-viewer-setup.zip", ".gitignore", "build.bat", "make_icon.py"):
                    continue
                    
            print(f" [+] {rel_path}")
            # On ajoute le fichier dans le ZIP sous un dossier racine "pdf-viewer"
            z.write(file_path, Path("pdf-viewer") / rel_path)
            count += 1
            
    print("\n==========================================")
    print(f"[SUCCÈS] Archive créée : {OUTPUT_ZIP.name}")
    print(f"Nombre total de fichiers emballés : {count}")
    print("==========================================")
    print("\nVous pouvez maintenant partager ce fichier ZIP avec vos collègues !")
    print("Pour l'installer sur une nouvelle machine :")
    print(" 1. Extraire le fichier ZIP.")
    print(" 2. Lancer 'setup.bat' (il configure le backend automatiquement,")
    print("    et installera Python 3.13 via winget si manquant).")
    print(" 3. Lancer 'launcher.exe' (ou 'launcher.bat') pour démarrer l'application.")
    print(" Note : Node.js n'est plus requis pour exécuter cette version !")

if __name__ == "__main__":
    package()
