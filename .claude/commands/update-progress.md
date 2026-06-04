# /update-progress — Mise a jour du suivi projet

Tu es l'assistant de suivi du projet **pdf-viewer**. Execute les etapes suivantes **dans l'ordre**, en affichant un resume et en attendant validation avant d'ecrire.

---

## Etape 1 — Lire l'etat actuel

Lis les fichiers suivants (en parallele).

**Docs internes** (locaux, gitignored — tracent l'historique des phases) :

- `BACKLOG.md` (phases et epics, statuts)
- `PROGRESS.md` (vue globale)
- `TESTS.md` (registre des tests — statuts, couverture par phase)
- `TECHNICAL_DEBT.md` (dettes ouvertes, resolues)
- Tous les `PHASE*_IMPLEMENT.md` des phases en cours ou recemment terminees (verifier dans BACKLOG)

**Wiki `memory/`** (commite, partage avec les agents de MHDINGBI — doit rester
factuellement aligne sur le code de la branche courante, typiquement `develop`) :

- `memory/cache-schema.md` (layout cache + spec result.json)
- `memory/architecture.md` (flux, endpoints, constantes, contrats inter-couches)
- `memory/LOG.md` (journal append-only, entrees les plus recentes en haut)
- `memory/HANDOFF.md` (section 0 « Etat <branche> » = brief de reprise)
- `memory/INDEX.md` (catalogue + note de fraicheur)
- `memory/{VISION,PRD,ROADMAP,decisions}.md` (directionnels — a VERIFIER, ne modifier
  que sur un vrai changement de cap/decision, pas a chaque session)
- NE PAS toucher `memory/{fixes-registry,formulas}.md` (historiques branche v2)

---

## Etape 2 — Analyser les changements recents

Si le repo est initialise, execute :

```bash
git log --oneline -10 && git diff --stat HEAD~5..HEAD 2>/dev/null
```

Compare les commits recents avec ce qui est deja documente dans PROGRESS. Identifie ce qui manque.

Utilise aussi le **contexte de la conversation** en cours.

---

## Etape 3 — Verifier la coherence

Compare les documents entre eux et signale les incoherences :

- PROGRESS dit "fait" mais BACKLOG dit encore "a faire" ou "en cours"
- PHASE_IMPLEMENT ne mentionne pas des changements visibles dans git log
- Une dette technique resolue dans le code mais encore "OUVERT" dans TECHNICAL_DEBT
- TESTS.md non a jour avec les tests reellement presents
- Dates manquantes ou relatives (convertir en absolues)
- DRAFT.md vs SPEC.md : ecarts (le SPEC doit etre la source de verite)

**Coherence du wiki `memory/` avec le code reel** (verifier contre la branche courante) :

- `cache-schema.md` : les `extraction_mode`, champs de `result.json` et le layout du
  cache decrits correspondent-ils au code (`pipeline.py`, `main.py`) ? (verifier via
  `grep extraction_mode`, la liste des fichiers ecrits, etc.)
- `architecture.md` : la liste des endpoints, les constantes (`BATCH_SIZE`, etc.) et les
  contrats TS correspondent-ils ? (comparer aux `@app.<verb>` de `main.py`)
- `LOG.md` : la session courante y figure-t-elle ? (sinon → ajouter une entree en haut)
- `HANDOFF.md` section 0 : reflete-t-elle l'etat present-vs-absent de la branche ?
- `INDEX.md` : la note de fraicheur classe-t-elle bien chaque fichier (a jour / directionnel / historique) ?
- Signaler si un fichier `memory/` affirme comme « a jour » du contenu en realite divergent.

---

## Etape 4 — Revue dette technique

Analyse les changements de la session :

- Nouvelles dettes identifiees ? (TODOs, workarounds, limitations, bugs connus, placeholders)
- Dettes existantes resolues par les changements ?
- Elements de SPEC non encore couverts ?

---

## Etape 5 — Proposer les next steps

Base sur :
- Le BACKLOG "a faire" (priorites de la phase courante)
- Ce qui vient d'etre fait (continuite logique)
- Les dettes techniques critiques

Propose 2-3 next steps concrets et pertinents. Si les changements creent un ecart avec le BACKLOG, propose de le modifier.

---

## Etape 6 — Afficher le resume

```
## Resume update-progress

### Fichiers a modifier
- [ ] BACKLOG.md — <description>
- [ ] PROGRESS.md — <description>
- [ ] PHASE<N>_IMPLEMENT.md — <description>
- [ ] TECHNICAL_DEBT.md — <description>
- [ ] TESTS.md — <description>
- [ ] memory/cache-schema.md — <description ou "RAS">
- [ ] memory/architecture.md — <description ou "RAS">
- [ ] memory/LOG.md — <nouvelle entree ou "RAS">
- [ ] memory/HANDOFF.md — <maj section 0 ou "RAS">
- [ ] memory/INDEX.md — <maj fraicheur ou "RAS">
- [ ] memory/{VISION,PRD,ROADMAP,decisions}.md — <seulement si vrai changement, sinon "RAS">

### Incoherences memory/ ↔ code
- <liste des ecarts wiki vs code reel, ou "aucune">

### Etat memory/ wiki
- <fichiers a jour develop / directionnels OK / historiques v2 — synthese 1 ligne>

### Incoherences detectees
- <liste ou "aucune">

### Nouvelles dettes
- <liste ou "aucune">

### Dettes resolues
- <liste ou "aucune">

### Next steps proposes
1. <step>
2. <step>
3. <step>

### Modifications BACKLOG proposees
- <deplacer epic X de "en cours" a "termine">
- <ajouter epic Y>
- ou "aucune"
```

---

## Etape 7 — Attendre validation

Demande : **"On est d'accord sur ces modifications ? Je peux ecrire ?"**

Ne rien ecrire tant que l'utilisateur n'a pas valide. S'il demande des ajustements, modifier le resume et re-proposer.

---

## Etape 8 — Ecrire les changements

Une fois valide, mettre a jour les fichiers dans cet ordre :

**Docs internes** (locaux) :
1. `PHASE<N>_IMPLEMENT.md` des phases concernees
2. `TESTS.md` (nouveaux tests, statuts mis a jour)
3. `PROGRESS.md`
4. `TECHNICAL_DEBT.md` (nouvelles dettes + resolues)
5. `BACKLOG.md` (deplacements d'epics + date MAJ)

**Wiki `memory/`** (commite — seulement les fichiers reellement impactes) :
6. `memory/cache-schema.md` / `memory/architecture.md` (si le code a change le schema /
   les endpoints / les contrats)
7. `memory/LOG.md` (ajouter UNE entree en haut, format `### YYYY-MM-DD — Titre` avec
   Contexte / Resume / Tests / Divergences ; ne jamais reecrire les entrees existantes)
8. `memory/HANDOFF.md` (mettre a jour la section 0 « Etat <branche> »)
9. `memory/INDEX.md` (date + note de fraicheur si la classification a bouge)
10. `memory/{VISION,PRD,ROADMAP,decisions}.md` UNIQUEMENT si un vrai changement de cap a eu lieu

> Les fichiers `memory/` sont **commites** (contrairement aux docs internes gitignored) :
> ils seront inclus dans un commit/PR. NE PAS toucher `fixes-registry.md` / `formulas.md`.

**Toutes les dates doivent etre absolues** (ex: 2026-05-04, jamais "aujourd'hui").

Apres ecriture, affiche : **"Suivi mis a jour. N fichiers modifies."**

---

## Regles

- **Ne jamais ecrire sans validation** de l'utilisateur
- **Dates absolues** uniquement
- **Pas de sur-documentation** : ne documenter que ce qui a reellement change
- Le skill lit beaucoup mais n'ecrit qu'apres accord
- **Pas de Co-Authored-By** dans les commits crees a partir d'ici
