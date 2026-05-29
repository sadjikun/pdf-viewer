# /html — Générer un artefact HTML auto-contenu

Génère un fichier HTML **unique, auto-contenu** (zéro dépendances externes) sur le sujet passé en argument.

---

## Argument

Le sujet est passé directement après la commande. Exemples :
```
/html dashboard backlog interactif avec progression par phase
/html spec MathJax rendering pour le Reader
/html code review des changements sectionizeHtml
/html comparaison 3 designs pour le floating TOC
/html rapport de session — ce qui a été fait aujourd'hui
```

Si aucun argument n'est fourni, demande : **"Sur quel sujet générer l'artifact HTML ?"**

---

## Étape 1 — Collecter le contexte pertinent

Selon le sujet, lis les fichiers nécessaires :

- **backlog / progression** → lire `BACKLOG.md`, `IMPLEMENTATION.md`
- **spec feature** → lire `BACKLOG.md` (section concernée) + fichiers source impactés
- **code review** → lire les fichiers modifiés récemment (`git diff HEAD~1`)
- **rapport session** → utiliser le contexte de la conversation en cours
- **design / mockup** → lire les composants React existants dans `frontend/src/components/`

---

## Étape 2 — Générer le fichier HTML

Crée le fichier dans `docs/artifacts/<slug-du-sujet>.html`.

### Contraintes impératives

- **Auto-contenu** : CSS inline dans `<style>`, JS dans `<script>`, pas de CDN, pas de `<link rel="stylesheet">`
- **Design system cohérent** avec le projet :
  - Accent orange : `#e07800`
  - Fond clair : `#f4f4f2` / fond carte : `#ffffff`
  - Texte : `#1a1a1a`
  - Police UI : system-ui, sans-serif (pas de Google Fonts en CDN)
  - Police code : Consolas, monospace
  - Dark mode via `prefers-color-scheme: dark`
- **Responsive** : readable sur desktop et mobile
- **Pas de dépendances** : pas de React, Vue, Tailwind, Bootstrap

### Structure selon le type de sujet

| Type | Éléments à inclure |
|---|---|
| **Dashboard / Backlog** | Tabs par phase, barres de progression, badges statut colorés, section "Next steps" |
| **Spec feature** | Résumé du problème, mockup visuel (HTML/CSS), diagramme de flux (SVG), extraits de code annotés, section trade-offs |
| **Code review** | Diff coloré, annotations en marge, flowchart du flux modifié (SVG), section "points d'attention" |
| **Rapport session** | Timeline des changements, fichiers modifiés, résumé des décisions, next steps |
| **Comparaison designs** | Grille côte-à-côte, labels avec trade-offs, boutons de sélection |
| **Explainer technique** | Diagramme d'architecture (SVG), code snippets annotés, section "gotchas" |

### Si l'artifact est interactif (éditeur, config, drag-drop)
Toujours ajouter un bouton **"📋 Copier comme prompt"** qui copie dans le presse-papiers un prompt décrivant l'état courant, prêt à coller dans Claude Code.

---

## Étape 3 — Afficher la confirmation

```
✅ Artifact créé : docs/artifacts/<nom>.html
   Ouvre-le dans un navigateur pour le visualiser.
```

---

## Règles

- **Jamais de Markdown** dans le fichier généré — HTML uniquement
- **Qualité > Vitesse** : un bon HTML prend 2-4× plus de temps qu'un Markdown, c'est normal
- **Commentaires HTML** pour expliquer les sections complexes
- Si le sujet est ambigu, demander précision avant de générer
