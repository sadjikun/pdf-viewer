import os
import sys
import uuid
import subprocess
import shutil
import time
from pathlib import Path

ROOT = Path(__file__).parent.resolve()
WXS_FILE = ROOT / "setup.wxs"
MSI_FILE = ROOT / "pdf-viewer-setup.msi"

# Namespace GUID for generating stable GUIDs for WiX components
NAMESPACE_GUID = uuid.UUID("3d2c88f7-66a9-4b6e-8742-b05de1574a62")

def get_relative_files():
    """Retourne la liste des fichiers à inclure, identique à package_app.py."""
    files = []
    for file_path in ROOT.rglob("*"):
        if file_path.is_dir():
            continue
        rel_path = file_path.relative_to(ROOT)
        parts = rel_path.parts
        
        # Exclusions globales
        if any(p in (".git", ".github", ".claude", ".pytest_cache", "__pycache__", "samples", "tests", "scratch", "memory") for p in parts):
            continue
            
        # Exclusions Backend
        if parts[0] == "backend":
            if any(p in (".venv", "cache", "__pycache__", ".pytest_cache", "tests") for p in parts):
                continue
        
        # Exclusions Frontend (on ne garde que le dist/)
        if parts[0] == "frontend":
            if len(parts) < 2 or parts[1] != "dist":
                continue
        
        # Exclusions fichiers de build/packaging racine
        if len(parts) == 1:
            if parts[0] in ("package_app.py", "pdf-viewer-portable.zip", "pdf-viewer-setup.zip", "setup.wxs", "setup.wixobj", "pdf-viewer-setup.msi", "build_msi.py", ".gitignore", "build.bat", "make_icon.py"):
                continue
                
        files.append(rel_path)
    return sorted(files)

def build_directory_tree(files):
    """Construit un dictionnaire représentant l'arborescence des dossiers."""
    tree = {}
    for f in files:
        current = tree
        for part in f.parent.parts:
            if part not in current:
                current[part] = {}
            current = current[part]
        # Ajouter le fichier comme valeur None
        current[f.name] = None
    return tree

def generate_wxs_xml(files):
    """Génère le contenu du fichier XML setup.wxs pour WiX v3."""
    print("Génération du fichier setup.wxs...")
    
    # 1. Construire l'arbre des dossiers et fichiers
    tree = build_directory_tree(files)
    
    # Listes globales pour accumuler les éléments XML
    dir_xml = []
    comp_xml = []
    comp_refs = []
    
    # Dictionnaire pour associer un ID unique et valide à chaque sous-dossier
    dir_ids = {}
    
    def walk_tree(node_name, node_content, indent_level=4, current_path=""):
        indent = " " * indent_level
        sub_dirs = []
        files_in_dir = []
        
        for name, value in node_content.items():
            if value is None:
                files_in_dir.append(name)
            else:
                sub_dirs.append(name)
                
        dir_lines = []
        
        # Traitement des fichiers de ce dossier
        if files_in_dir:
            # Créer un composant WiX pour ce dossier
            folder_rel = current_path
            comp_id = "Comp_" + hashlib_name(folder_rel or "root")
            comp_guid = str(uuid.uuid5(NAMESPACE_GUID, folder_rel))
            
            comp_lines = []
            comp_lines.append(f'{indent}  <Component Id="{comp_id}" Guid="{comp_guid}">')
            
            # Si c'est le composant racine, on définit une valeur de registre clé pour l'installation per-user
            comp_lines.append(f'{indent}    <RegistryValue Root="HKCU" Key="Software\\MHDINGBI\\PDFViewer" Name="install_dir_{hashlib_name(folder_rel or "root")}" Type="string" Value="[INSTALLFOLDER]" KeyPath="yes" />')
            
            for f in files_in_dir:
                file_rel_path = os.path.join(folder_rel, f) if folder_rel else f
                file_id = "File_" + hashlib_name(file_rel_path)
                # Éviter les caractères interdits ou problématiques dans le XML
                src_path = os.path.join("..", file_rel_path) if folder_rel else f
                comp_lines.append(f'{indent}    <File Id="{file_id}" Source="{file_rel_path}" />')
                
            comp_lines.append(f'{indent}  </Component>')
            comp_xml.extend(comp_lines)
            comp_refs.append(comp_id)
            
        # Traitement des sous-dossiers
        for sub in sub_dirs:
            sub_rel = os.path.join(current_path, sub) if current_path else sub
            sub_id = "Dir_" + hashlib_name(sub_rel)
            dir_ids[sub_rel] = sub_id
            
            dir_lines.append(f'{indent}<Directory Id="{sub_id}" Name="{sub}">')
            # Récursion
            sub_xml = walk_tree(sub, node_content[sub], indent_level + 2, sub_rel)
            dir_lines.extend(sub_xml)
            dir_lines.append(f'{indent}</Directory>')
            
        return dir_lines

    def hashlib_name(name):
        import hashlib
        return hashlib.md5(name.encode('utf-8')).hexdigest()[:16]

    # Générer le dictionnaire de structure
    dir_structure = walk_tree("", tree, 12, "")
    dir_structure_str = "\n".join(dir_structure)
    
    # Réf du composant pour les raccourcis
    shortcut_guid = str(uuid.uuid5(NAMESPACE_GUID, "shortcuts"))
    
    # Assembler le fichier complet
    xml_content = f"""<?xml version="1.0" encoding="UTF-8"?>
<Wix xmlns="http://schemas.microsoft.com/wix/2006/wi">
  <Product Id="*" Name="PDF Viewer" Language="1036" Version="0.2.0" Manufacturer="MHDINGBI" UpgradeCode="78f16b60-f421-4ea7-be92-23ef7fa8eb34">
    <Package InstallerVersion="200" Compressed="yes" InstallScope="perUser" />
    <MajorUpgrade DowngradeErrorMessage="Une version plus recente de [ProductName] est deja installee." />
    <MediaTemplate EmbedCab="yes" />

    <!-- Icône pour le panneau de configuration -->
    <Icon Id="AppIcon" SourceFile="assets\\app.ico" />
    <Property Id="ARPPRODUCTICON" Value="AppIcon" />

    <Directory Id="TARGETDIR" Name="SourceDir">
      <Directory Id="LocalAppDataFolder">
        <Directory Id="ProgramsFolder" Name="Programs">
          <Directory Id="INSTALLFOLDER" Name="PDF-Viewer">
            <!-- Structure de répertoires générée dynamiquement -->
{dir_structure_str}
          </Directory>
        </Directory>
      </Directory>
      
      <Directory Id="DesktopFolder" Name="Desktop" />
      
      <Directory Id="ProgramMenuFolder">
        <Directory Id="ApplicationProgramsFolder" Name="PDF Viewer" />
      </Directory>
    </Directory>

    <!-- Raccourcis -->
    <DirectoryRef Id="ApplicationProgramsFolder">
      <Component Id="ApplicationShortcut" Guid="{shortcut_guid}">
        <!-- Raccourci Menu Démarrer -->
        <Shortcut Id="ApplicationStartMenuShortcut" 
                  Name="PDF Viewer" 
                  Description="Visualiseur de PDF local avec navigation structuree"
                  Target="[INSTALLFOLDER]launcher.exe"
                  WorkingDirectory="INSTALLFOLDER"
                  Icon="AppIcon" />
                  
        <!-- Raccourci Bureau -->
        <Shortcut Id="ApplicationDesktopShortcut"
                  Directory="DesktopFolder"
                  Name="PDF Viewer"
                  Description="Visualiseur de PDF local avec navigation structuree"
                  Target="[INSTALLFOLDER]launcher.exe"
                  WorkingDirectory="INSTALLFOLDER"
                  Icon="AppIcon" />
                  
        <RemoveFolder Id="CleanUpShortcuts" On="uninstall" />
        <RegistryValue Root="HKCU" Key="Software\\MHDINGBI\\PDFViewer" Name="shortcut_installed" Type="integer" Value="1" KeyPath="yes" />
      </Component>
    </DirectoryRef>

    <!-- Déclarer tous les fichiers compilés -->
    <ComponentGroup Id="ProductComponents" Directory="INSTALLFOLDER">
      <!-- Les fichiers de chaque sous-dossier seront injectés ici -->
    </ComponentGroup>

    <!-- Action personnalisée : exécuter setup.bat pour configurer le backend et le venv -->
    <!-- On exécute via cmd.exe pour ouvrir une console visible montrant l'avancement de pip install -->
    <CustomAction Id="RunSetupBat" 
                  Directory="INSTALLFOLDER" 
                  ExeCommand="cmd.exe /c &quot;&quot;[INSTALLFOLDER]setup.bat&quot; /msi&quot;" 
                  Execute="immediate" 
                  Return="check" />

    <InstallExecuteSequence>
      <Custom Action="RunSetupBat" After="InstallFinalize">NOT Installed</Custom>
    </InstallExecuteSequence>

    <Feature Id="ProductFeature" Title="PDF Viewer" Level="1">
      <ComponentGroupRef Id="ProductComponents" />
      <ComponentRef Id="ApplicationShortcut" />
      <!-- Injecter tous les composants générés -->
      {" ".join([f'<ComponentRef Id="{cid}" />' for cid in comp_refs])}
    </Feature>
  </Product>
</Wix>
"""
    # Écrire le fichier setup.wxs
    WXS_FILE.write_text(xml_content, encoding="utf-8")
    print(f"Fichier setup.wxs créé avec succès ({len(files)} fichiers mappés).")

def find_wix_tools():
    """Trouve candle.exe et light.exe dans le PATH ou les répertoires d'installation habituels."""
    # 1. Vérifier si WiX est dans le PATH
    candle = shutil.which("candle")
    light = shutil.which("light")
    if candle and light:
        return candle, light
        
    # 2. Chercher dans les répertoires standards sous Windows
    wix_dirs = [
        Path(os.environ.get("ProgramFiles(x86)", "C:\\Program Files (x86)")) / "WiX Toolset v3.14" / "bin",
        Path(os.environ.get("ProgramFiles(x86)", "C:\\Program Files (x86)")) / "WiX Toolset v3.11" / "bin",
        Path(os.environ.get("ProgramFiles", "C:\\Program Files")) / "WiX Toolset v3.14" / "bin",
        Path(os.environ.get("ProgramFiles", "C:\\Program Files")) / "WiX Toolset v3.11" / "bin",
    ]
    
    for wd in wix_dirs:
        c = wd / "candle.exe"
        l = wd / "light.exe"
        if c.exists() and l.exists():
            return str(c), str(l)
            
    return None, None

def install_wix():
    """Installe WiX Toolset via winget."""
    print("\nWiX Toolset non trouvé. Tentative d'installation automatique via winget...")
    print("Cela peut nécessiter une validation de sécurité Windows (UAC).")
    try:
        res = subprocess.run([
            "winget", "install", "WiXToolset.WiXToolset", 
            "--silent", "--accept-package-agreements", "--accept-source-agreements"
        ], check=False)
        if res.returncode == 0:
            print("[OK] WiX Toolset installé avec succès ! Veuillez patienter...")
            return True
        else:
            print("[!!] L'installation automatique via winget a échoué.")
            return False
    except Exception as e:
        print(f"[!!] Erreur lors de l'appel à winget : {e}")
        return False

def compile_msi(candle_path, light_path):
    """Compile setup.wxs en setup.msi."""
    print("\n--- Compilation du fichier MSI ---")
    
    # Étape 1 : Compilation (candle.exe)
    print("1/2 - Compilation des fichiers source (candle.exe)...")
    cmd_candle = [candle_path, "-out", "setup.wixobj", "setup.wxs"]
    res = subprocess.run(cmd_candle, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if res.returncode != 0:
        print(f"[ERREUR] Echec de candle.exe (code {res.returncode}) :")
        print(res.stderr)
        return False
        
    # Étape 2 : Liaison (light.exe)
    print("2/2 - Liaison et création de l'installateur (light.exe)...")
    cmd_light = [
        light_path, 
        "-ext", "WixUIExtension", 
        "-out", str(MSI_FILE), 
        "setup.wixobj"
    ]
    # Note: On ignore l'alerte ICE91 qui prévient de l'installation per-user sans clé de registre globale,
    # car nous avons explicitement fourni des RegistryValue locales pour chaque composant.
    res = subprocess.run(cmd_light, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if res.returncode != 0:
        print(f"[ERREUR] Echec de light.exe (code {res.returncode}) :")
        print(res.stderr)
        return False
        
    # Nettoyage des fichiers intermédiaires
    for temp in (ROOT / "setup.wixobj", ROOT / "setup.wxs"):
        if temp.exists():
            temp.unlink()
            
    print(f"\n[SUCCÈS] Installateur MSI créé : {MSI_FILE.name}")
    return True

def main():
    print("==========================================")
    print("       Constructeur d'installateur MSI    ")
    print("==========================================")
    
    # 1. Récupérer et valider la liste des fichiers
    files = get_relative_files()
    if not files:
        print("[ERREUR] Aucun fichier trouvé pour l'installation.")
        sys.exit(1)
        
    # 2. Générer le fichier setup.wxs
    generate_wxs_xml(files)
    
    # 3. Localiser ou installer WiX Toolset
    candle, light = find_wix_tools()
    if not candle or not light:
        if install_wix():
            # Chercher à nouveau après l'installation
            candle, light = find_wix_tools()
            if not candle or not light:
                # Si toujours pas dans le path, chercher dans le répertoire par défaut
                # Parfois winget nécessite un redémarrage du shell, on va forcer une détection sur les chemins typiques
                time.sleep(2)
                candle, light = find_wix_tools()
        
    if not candle or not light:
        print("\n[ERREUR] Impossible de compiler l'installateur : WiX Toolset v3 n'est pas détecté.")
        print("Veuillez installer WiX Toolset v3 manuellement depuis : https://wixtoolset.org/releases/")
        print("Puis relancer ce script.")
        # Nettoyage
        if WXS_FILE.exists():
            WXS_FILE.unlink()
        sys.exit(1)
        
    print(f"\n[OK] Outils WiX détectés :")
    print(f" - Candle : {candle}")
    print(f" - Light  : {light}")
    
    # 4. Compiler setup.msi
    if compile_msi(candle, light):
        print("\nVotre installateur MSI est prêt à être partagé !")
    else:
        sys.exit(1)

if __name__ == "__main__":
    main()
