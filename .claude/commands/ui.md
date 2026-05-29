# /ui — Générer des variantes UI/UX pour un composant React

Génère des **variantes visuelles HTML** d'un composant avant implémentation React, inspiré du `ui-ux-pro-max-skill`.

---

## Argument

Le composant ou écran à explorer, passé directement après la commande :
```
/ui floating table of contents pour le Reader, 3 variantes
/ui bouton d'export PDF avec états hover/loading/success
/ui carte de figure avec caption et actions, style InteractiveBook
/ui sidebar de navigation avec mode focus et breadcrumb
```

---

## Étape 1 — Analyser le contexte existant

Lire les fichiers pertinents pour respecter le design system en place :
- `frontend/src/components/Reader/MarkdownReader.css` → variables CSS, couleurs, polices
- Le composant React le plus proche du sujet demandé
- `BACKLOG.md` pour comprendre si c'est lié à une epic existante

---

## Étape 2 — Générer un fichier HTML avec N variantes côte-à-côte

Crée `docs/artifacts/ui-<slug>.html` avec :

### Grille de variantes
- **2 ou 3 variantes** selon la demande (défaut : 3)
- Chaque variante affichée dans une carte avec :
  - Label de la variante (ex: "Variante A — Sticky sidebar")
  - Le composant rendu en HTML/CSS pur
  - Une ligne de trade-off (ex: "✅ Simple • ⚠️ Prend de la place en mobile")
- Layout en grid responsive

### Contraintes design (cohérence avec notre app)
```css
--or: #e07800;       /* orange accent */
--or-bg: #fff8ef;
--bl: #0055a4;       /* bleu liens/formules */
--bg: #f4f4f2;
--bg2: #ffffff;
--tx: #1a1a1a;
--bd: #e0ddd8;
--fu: system-ui, sans-serif;
--fb: Georgia, serif;  /* body text */
--fm: Consolas, monospace;
```

### États interactifs
Simuler hover, focus, active via CSS pur (`:hover`, `:focus-within`).
Si animations nécessaires → CSS uniquement, pas de JS lourd.

### Boutons d'action en bas de page
- **"✅ Choisir variante A/B/C"** → met en évidence la variante choisie
- **"📋 Exporter le prompt d'implémentation"** → copie un prompt React prêt à coller :
  ```
  Implémente la variante [N] du composant [nom] en React + TypeScript.
  Le design est dans docs/artifacts/ui-<slug>.html, variante [N].
  Respecte le design system de MarkdownReader.css.
  ```

---

## Étape 3 — Confirmation

```
✅ Variantes UI créées : docs/artifacts/ui-<slug>.html
   3 variantes disponibles — ouvre dans le navigateur, choisis, puis utilise
   le bouton "Exporter le prompt" pour lancer l'implémentation.
```

---

## Règles

- **HTML/CSS pur** — pas de React dans l'artifact (on prototype, on n'implémente pas encore)
- **Fidèle au design system** — utiliser les mêmes variables CSS que MarkdownReader.css
- **Labels honnêtes** — chaque variante a ses trade-offs clairement notés
- **Mobile-friendly** — chaque variante doit être testée en < 768px
