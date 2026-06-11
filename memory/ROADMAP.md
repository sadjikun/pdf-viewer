# ROADMAP — pdf-viewer → plateforme d'étude

> **Plan produit en 3 phases.** Lu par tous les agents (Claude Code, Antigravity, opencode, Gemini).
> Boussole : `VISION.md`. Détail features : `PRD.md`. Décision fondatrice : `decisions.md` ADR-006.
> Dernière MAJ : 2026-05-29

---

## Le cap (en une ligne)

D'un **lecteur PDF enrichi** vers une **plateforme d'étude personnelle, locale et privée**
qui centralise tous les documents d'étude et **augmente la compréhension, la recherche
et l'apprentissage grâce à une IA locale**.

Le socle ne change pas : **offline-first, mono-utilisateur, sans cloud, sans auth.**

---

## Principe de séquençage (north star)

> On bâtit la **confiance** avant l'**intelligence**, et on **diffuse** en dernier.
> Inutile de verser des années de notes dans une plateforme qui peut les perdre ou
> casser à chaque modification. Inutile d'empaqueter une cible mouvante.

`Phase 1 Confiance` → `Phase 2 Intelligence` → `Phase 3 Diffusion`

Les phases sont séquentielles mais leurs livrables internes peuvent se paralléliser.

---

## Phase 1 — Confiance (socle de la plateforme)

**Objectif :** rendre la plateforme digne de confiance — la donnée ne se perd pas,
le code ne casse pas en silence, la bibliothèque reste navigable quand elle grossit.

| ID | Livrable | Détail | Prio |
|----|----------|--------|------|
| R11 ✅ | **Notes & surlignages durables** | Migration `localStorage` → stockage serveur (`cache/{doc}/annotations.json`). Survivent au vidage du cache navigateur, sauvegardables, portables. *Fait évoluer ADR-003.* | M |
| R12 ✅ | **Export des annotations** | Génère une fiche de révision (HTML/Markdown) regroupant surlignages + notes d'un document. | S |
| L1 | **Organisation bibliothèque** | Dossiers / matières + tags. Filtrage par matière. Indispensable dès que la bibliothèque dépasse quelques dizaines de docs. | M |
| L2 | **Métadonnées d'étude** | Par document : matière, statut (à lire / en cours / lu), priorité. | S |
| Q1 | **Filet de sécurité tests** | Smoke tests (l'app charge, un doc s'affiche, endpoints clés répondent) + tests sur les zones touchées par R11/L1. *Pas* une couverture exhaustive des 71 FIX. | M |
| Q2 | **Tests de non-régression ciblés** | Un test par FIX critique, ajouté progressivement quand on retouche la zone. | C |

**Pourquoi en premier :** l'incident « écran noir » (déclarations React supprimées
silencieusement) a montré que le code casse quand on le touche. Avant d'investir des
années de matériel d'étude, la donnée doit être durable et le code protégé.

**Définition de terminé :**
- Les annotations persistent après un vidage complet du cache navigateur.
- L'export produit une fiche lisible (surlignages + notes).
- La bibliothèque se filtre par matière / tag.
- Les smoke tests passent au vert et tournent à chaque build.

**Décisions / risques :** introduit un stockage serveur d'annotations (ADR dédié à venir) ;
garder un format JSON simple par document, **pas encore de base de données.**

---

## Phase 2 — Intelligence (le cœur de la vision)

**Objectif :** l'objectif déclaré — comprendre, rechercher et apprendre **mieux**
grâce à une IA **locale**.

| ID | Livrable | Détail | Prio |
|----|----------|--------|------|
| AI1 ✅ | **Recherche transversale** | Recherche plein-texte sur **toute** la bibliothèque (le texte est déjà extrait). Quick win, peu coûteux. | M |
| AI2 | **« Interroge tes documents » (Q&A IA locale)** | Embeddings locaux + LLM local (Ollama / llama.cpp). Question en français → réponse **sourcée avec le n° de page**. 100 % hors-ligne. | M |
| AI3 | **Aide à l'apprentissage** *(stretch)* | Génération de résumés et de fiches de révision (flashcards) à partir des surlignages. | C |

**Pourquoi cet ordre :** AI1 est presque gratuit (texte déjà en cache) et utile tout de
suite ; AI2 est le centre de gravité du projet ; les deux bénéficient du filet de sécurité
de la Phase 1 pour itérer sans peur.

**Définition de terminé :**
- Une recherche trouve une phrase/notion à travers tous les documents.
- Une question en langage naturel renvoie une réponse **avec citation de page**.
- Tout fonctionne sans connexion réseau.

**Décisions / risques :**
- Nécessite un **index local** (SQLite FTS5 et/ou vector store local type sqlite-vec / FAISS).
  *Fait évoluer ADR-002* (toujours local, toujours sans cloud). → ADR dédié à l'implémentation.
- Choix du **modèle LLM local** : arbitrage taille / qualité / RAM (cible < 2 GB crête, cf. PRD §5).
- Découpage (chunking) du texte ; latence des réponses ; téléchargement initial du modèle.

---

## Phase 3 — Diffusion (en faire une vraie app)

**Objectif :** une application installable, utilisable sur n'importe laquelle de tes
machines (ou par un collègue), sans toucher à Python ni Node.

| ID | Livrable | Détail | Prio |
|----|----------|--------|------|
| D1 | **Installateur one-click** ✅ | Launcher **fenêtre pywebview** + splash + ModeChooser + icône livre. Frontend statique servi par FastAPI (2026-06-11, D1/ADR-007). | S |
| D2 | **Stratégie modèles ML** ✅ | Décision prise : Lazy loading et téléchargement automatique en tâche de fond lors du premier traitement (2026-06-11, D2/ADR-008). | S |

**Pourquoi en dernier :** on empaquette quand l'ensemble est stable. Packager une cible
mouvante est du travail perdu. (Le launcher pywebview actuel suffit comme solution
intermédiaire pour tes propres machines.)

**Définition de terminé :**
- Un installeur lance l'app sans prérequis Python/Node.
- Premier lancement documenté et raisonnable.

**Décisions / risques :** poids des modèles ML ; SmartScreen / signature Windows.

---

## Hors de cette roadmap (rappel VISION.md)

Cloud, comptes, collaboration multi-utilisateurs, app mobile, plugin navigateur,
édition du PDF natif. La centralisation sert **l'étude personnelle**, ce n'est **pas**
une GED d'entreprise.

> **À réévaluer :** traduction **locale** (FR↔EN des Eurocodes) — désormais faisable
> hors-ligne grâce au LLM local. Voir PRD §9 (question ouverte).

---

## Suivi

| Phase | Statut |
|-------|--------|
| Phase 1 — Confiance | ✅ Terminée (2026-06-11) — L1/L2/R11/R12/Q1/Q2 |
| Phase 2 — Intelligence | ✅ Terminée (2026-06-11) — AI1/AI2/AI3 |
| Phase 3 — Diffusion | ✅ Terminée (2026-06-11) — D1/D2 |

> Mettre à jour ce tableau et `phases.md` à chaque livrable terminé. Légende priorité (M/S/C/W) : voir `PRD.md` §3.
