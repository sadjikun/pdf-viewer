# VISION — pdf-viewer

> **Boussole du projet.** À lire en 2 minutes au début de chaque session
> pour ne pas dériver du cap. PRD.md contient le détail des fonctionnalités.

---

## En une phrase

Une **plateforme d'étude personnelle, locale et privée** qui centralise tous tes
documents techniques et scientifiques, **enrichit la lecture** (annotations, audio,
recherche, thèmes) et **augmente la compréhension et l'apprentissage grâce à une IA
locale** (recherche transversale, questions-réponses sourcées) — tout en conservant
une fidélité visuelle satisfaisante au document original.

> **Évolution du cap (2026-05-29).** Le projet élargit son ambition : d'un *lecteur PDF
> enrichi* vers une *plateforme d'étude augmentée par l'IA locale*. Le socle ne change pas
> (offline-first, mono-utilisateur, sans cloud, sans auth) ; il s'étend à la centralisation
> documentaire et à l'IA d'aide à la recherche et à l'apprentissage.
> Plan détaillé : `ROADMAP.md` · Décision : `decisions.md` ADR-006.

---

## Problème résolu

Lire un PDF technique (norme, rapport d'ingénierie, article scientifique) est
pénible :
- Le PDF natif est figé : impossible d'annoter facilement, de chercher une formule,
  de réécouter une section, de basculer en mode nuit.
- Les outils cloud (Google Drive, Adobe) envoient le document sur internet.
- Les exports Word/HTML des PDF sont souvent difformes et illisibles.

**Ce projet résout ça en local**, sans compte, sans cloud.

---

## Philosophie fondamentale

| Principe | Traduction concrète |
|----------|---------------------|
| **Offline-first** | Aucune donnée ne quitte la machine |
| **Fidélité avant transformation** | Le Reader doit ressembler au PDF original, pas le reformater arbitrairement |
| **Lecture > extraction brute** | Lisibilité, TTS, annotations valent plus que la perfection d'extraction |
| **Simplicité mono-utilisateur** | Pas d'auth, pas de sync, pas de multi-tenancy |
| **Robustesse progressive** | Un PDF extrait à 80% fid. est utile ; un PDF qui plante est inutile |
| **IA locale, jamais cloud** | Recherche sémantique et Q&A tournent sur la machine (Ollama/llama.cpp) ; aucune donnée envoyée |
| **La connaissance s'accumule** | Notes durables et réutilisables : la plateforme garde la mémoire de tes lectures |

---

## Ce que c'est

- Viewer PDF local self-hosted (backend Python + FastAPI, frontend React + Vite)
- Trois modes de lecture : **PDF** (rendu natif via PDF.js), **Reader** (HTML
  sémantique enrichi), **Compare** (les deux côte à côte, synchronisés)
- Sidebar : Sommaire cliquable, Galerie images, Tableaux
- Reader HTML : surlignage multi-couleurs, notes adhésives, TTS français,
  mode focus section par section, thèmes visuels (CSTB, Glass, Tech, Sépia…)
- **Bibliothèque centralisée** : tous les documents d'étude en un lieu, organisés
  par matières / dossiers / tags
- **Recherche & IA locales** : recherche plein-texte transversale + « interroge tes
  documents » (réponses sourcées avec n° de page, hors-ligne)
- **Apprentissage** : annotations durables et exportables (fiches de révision),
  accumulation des connaissances au fil des lectures

---

## Ce que ce n'est PAS

- Un outil cloud ou collaboratif
- Un remplaçant de Adobe Acrobat (pas d'édition PDF)
- Une GED d'entreprise (workflows, versioning, conformité) — la centralisation ici
  sert l'étude personnelle, pas la gestion documentaire métier
- Un outil de traduction *cloud* — *(une traduction **locale** est à réévaluer, voir PRD §9)*
- Un plugin navigateur

---

## Utilisateurs cibles (personas)

1. **L'ingénieur structure** : lit des normes Eurocode de 200+ pages, doit
   retrouver vite une formule, annoter une clause, comparer la version PDF
   avec sa propre analyse.
2. **Le chercheur/doctorant** : parcourt des articles scientifiques PDF,
   veut réécouter des passages complexes, surligner, exporter des sections.
3. **Le consultant technique** : reçoit des rapports PDF propriétaires
   (Advance Design, RFEM, ETABS), veut lire confortablement sans les
   logiciels propriétaires.

---

## Métriques de succès

- Un PDF natif est lisible dans le Reader en < 3 secondes
- Un PDF scanné est OCRisé et lisible en < 90 secondes (80 pages)
- Le sommaire cliquable navigue correctement dans 95% des PDFs testés
- Aucune donnée quitte la machine
