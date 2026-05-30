# Rapport d'installation Windows — sadjikun/pdf-viewer

**Environnement :** Windows 11 · Python 3.14 · Node.js 22 · Mai 2026  
**Repository :** https://github.com/sadjikun/pdf-viewer

---

## 1. Contexte

Ce document retrace l'ensemble des obstacles rencontrés lors de l'installation du projet `pdf-viewer` sur Windows 11, ainsi que les correctifs appliqués. Il est destiné au propriétaire du projet pour faciliter la compatibilité officielle Windows.

---

## 2. Environnement de test

| Composant | Détail |
|-----------|--------|
| OS | Windows 11 (x64) |
| Python | 3.14 — Python 3.10 présent par défaut sur la machine |
| Node.js | 22.x LTS |
| Réseau | IPv6 activé — Hugging Face accessible uniquement en IPv4 |
| RAM | Saturée à partir de la page 46 sur un PDF de 135 pages (modèle layout IA Docling) |

---

## 3. Erreurs rencontrées et solutions

### 3.1 Python 3.10 — `networkx==3.6.1` incompatible

**Symptôme :**
```
ERROR: Could not find a version that satisfies the requirement networkx==3.6.1
Ignored versions that require a different python version: 3.6.1 Requires-Python >=3.11
```

**Cause :** La machine utilisait Python 3.10 par défaut. `networkx 3.6.1` et plusieurs dépendances (`torch`, `transformers`, etc.) exigent Python >= 3.11. Le README mentionne Python 3.13 mais ne précise pas la commande de création du venv sous Windows.

**Solution appliquée :**
- Installer Python 3.14 depuis python.org (cocher _Add python.exe to PATH_)
- Supprimer l'ancien venv : `Remove-Item -Recurse -Force .venv`
- Recréer avec la bonne version : `py -3.14 -m venv .venv`

**Recommandation pour le README :**  
Préciser la commande `py -3.13` pour Windows :
```powershell
# Windows — remplacer la commande du README par :
py -3.13 -m venv .venv && .venv\Scripts\activate
```

---

### 3.2 `uvloop==0.22.1` — incompatible Windows

**Symptôme :**
```
RuntimeError: uvloop does not support Windows at the moment
ERROR: Failed to build 'uvloop' when getting requirements to build wheel
```

**Cause :** `uvloop` est une bibliothèque d'optimisation réseau Linux/macOS uniquement. Elle est listée dans `requirements.txt` sans condition de plateforme, bloquant toute installation sur Windows.

**Solution appliquée :** Supprimer la ligne `uvloop==0.22.1` du `requirements.txt`.

**Recommandation :** Conditionner `uvloop` dans `requirements.txt` :
```
uvloop==0.22.1; sys_platform != 'win32'
```

---

### 3.3 Téléchargement Hugging Face — WinError 10054 (problème IPv6)

**Symptôme :**
```
[WinError 10054] Une connexion existante a dû être fermée par l'hôte distant
LocalEntryNotFoundError: Got: ConnectError: [WinError 10054]
An error happened while trying to locate the files on the Hub
```

**Cause :** Windows résout `huggingface.co` en IPv6 par défaut. La librairie `httpx` (utilisée par `huggingface_hub`) ne gère pas correctement les coupures de connexion TLS sur IPv6 sous Windows.

Diagnostic réalisé :
```powershell
Test-NetConnection -ComputerName huggingface.co -Port 443
# RemoteAddress : 2600:9000:... (IPv6) → confirme la cause
```

**Solution appliquée :** Monkey-patching de `socket.getaddrinfo` en tête de `pipeline.py` :
```python
import socket
_orig = socket.getaddrinfo
def _ipv4_only(host, port, family=0, type=0, proto=0, flags=0):
    return _orig(host, port, socket.AF_INET, type, proto, flags)
socket.getaddrinfo = _ipv4_only
```

Commande de pré-téléchargement des modèles (à lancer une seule fois) :
```powershell
python -m docling.cli.models download
```

**Recommandation :** Documenter cette étape dans le README pour Windows (~400 Mo, une seule fois).

---

### 3.4 Encodage JSON — cp1252 vs UTF-8

**Symptôme :**
```
UnicodeEncodeError: 'charmap' codec can't encode character
File "cp1252.py", line 19, in encode
```

**Cause :** L'encodage système Windows par défaut est `cp1252`. Les `open(file, 'w')` sans `encoding='utf-8'` dans `main.py` utilisent cet encodage, qui ne supporte pas tous les caractères Unicode des PDF.

**Solution appliquée :** Ajout de `encoding='utf-8'` sur tous les `open()` dans `main.py` :
```python
with open(ddir / "result.json", "w", encoding="utf-8") as f:
    json.dump(result, f, ensure_ascii=False, indent=2)
```

**Recommandation :** Auditer tous les `open()` dans `main.py` et `pipeline.py` pour ajouter `encoding='utf-8'`.

---

### 3.5 `std::bad_alloc` — saturation RAM (modèle layout IA Docling)

**Symptôme :**
```
Stage preprocess failed for run 1, pages [46]: std::bad_alloc
Stage preprocess failed for run 1, pages [47]: std::bad_alloc
[... répété pour toutes les pages 46 à 135]
```

Le fichier `result.md` généré était tronqué à la section `2.3.3.4` — les Chapters 3 à 6 complètement absents, remplacés par des octets nuls `\x00`.

**Cause :** Le modèle de layout IA `docling-parse` charge plusieurs pages simultanément en mémoire. Sur 135 pages avec `images_scale=2.0`, la RAM est saturée à partir de la page 46.

**Solution appliquée :**
- **Batch processing** : découper le PDF en tranches de 20 pages via `pypdfium2`
- Traiter chaque tranche indépendamment avec Docling puis fusionner les résultats
- Corriger les offsets de numéros de pages lors de la fusion
- Réduire `images_scale` de `2.0` à `1.0`
- Désactiver `do_ocr=False` (PDF natif) et `do_table_structure=False` (libère de la RAM)

**Résultat :** 135 pages traitées, 115 figures extraites, 6 chapitres détectés.

**Recommandation :** Intégrer le batch processing comme comportement par défaut pour les PDFs > 50 pages. Exposer `BATCH_SIZE` comme variable d'environnement configurable.

---

### 3.6 Sommaire — faux positifs et chapitres manquants

**Symptôme :** Des fragments de texte apparaissaient comme entrées du sommaire : `In these expressions :`, `T-stub response`, `PRELIMINARY CALCULATIONS`, `(a) Distribution of shear loads`, `Part I:`, `Data:`, `Strength`, `Stiffness`, `Modelling`, etc. Les Chapters 3 à 6 étaient absents (conséquence directe du bug 3.5).

**Cause :** Docling classe certains fragments courts comme `section_header`, notamment sur des pages denses en équations. Les titres `Chapter X` sans numérotation décimale n'étaient pas reconnus comme niveau 1.

**Solution appliquée :**
- Filtre regex des faux positifs connus (patterns grammaticaux, mots isolés, `Part I:`, `(a)`, bullet points, etc.)
- Détection explicite des `Chapter X` via regex `_CHAPTER_PREFIX` → assignés niveau 1
- Filtre de longueur : titres > 120 caractères ignorés
- Déduplication par titre normalisé (évite les doublons entre tranches)

---

## 4. Fichiers modifiés

| Fichier | Modification | Impact |
|---------|-------------|--------|
| `requirements.txt` | Suppression de `uvloop==0.22.1` | Installation possible sur Windows |
| `backend/main.py` | `encoding='utf-8'` sur tous les `open()` JSON | Corrige le crash Unicode Windows |
| `backend/pipeline.py` | Patch IPv4 + batch processing (`BATCH_SIZE=20`) + filtres outline + `images_scale=1.0` + `do_ocr=False` | Résout 4 bugs sur 6 |

---

## 5. Instructions d'installation Windows (corrigées)

### Prérequis
- Python 3.13+ depuis [python.org](https://www.python.org/downloads/) — cocher **Add python.exe to PATH**
- Node.js >= 20 depuis [nodejs.org](https://nodejs.org/)
- Git depuis [git-scm.com](https://git-scm.com/)

### Backend
```powershell
git clone https://github.com/sadjikun/pdf-viewer.git
cd pdf-viewer\backend

py -3.13 -m venv .venv          # important : spécifier la version
.venv\Scripts\activate

pip install -r requirements.txt

# Pré-télécharger les modèles Docling (une seule fois, ~400 Mo)
python -m docling.cli.models download

uvicorn main:app --reload
```

### Frontend (second terminal)
```powershell
cd pdf-viewer\frontend
npm install
npm run dev
```

### Ouvrir l'application
Navigateur : **http://localhost:5173**

> **Note :** Le premier traitement d'un PDF peut prendre 30 à 90 secondes selon le nombre de pages. Les traitements suivants sont instantanés grâce au cache disque.

---

## 6. Résultat final

Après application de toutes les corrections, le projet fonctionne intégralement sur Windows 11 :

- ✅ 135 pages traitées sans erreur de mémoire
- ✅ 115 figures extraites et affichées dans la galerie
- ✅ 6 chapitres correctement détectés dans le sommaire
- ✅ Export Markdown fonctionnel
- ✅ Recherche plein-texte opérationnelle
- ✅ Synchronisation scroll viewer ↔ outline fonctionnelle

---

## 7. Proposition de Pull Request

Une PR avec les modifications suivantes rendrait le projet officiellement compatible Windows sans impacter Linux/macOS :

| Fichier | Changement proposé |
|---------|-------------------|
| `requirements.txt` | Conditionner uvloop : `uvloop==0.22.1; sys_platform != 'win32'` |
| `backend/main.py` | Ajouter `encoding='utf-8'` sur tous les `open()` JSON/MD |
| `backend/pipeline.py` | Intégrer patch IPv4 + batch processing + filtres outline |
| `README.md` | Ajouter section Windows avec `py -3.13`, pré-téléchargement modèles, note uvloop |

---

*Rapport rédigé — Mai 2026*
