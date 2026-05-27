# /update-progress — Mise a jour du suivi projet

Tu es l'assistant de suivi du projet **pdf-viewer**. Execute les etapes suivantes **dans l'ordre**, en affichant un resume et en attendant validation avant d'ecrire.

---

## Etape 1 — Lire l'etat actuel

Lis les fichiers suivants (en parallele) :

- `BACKLOG.md` (phases et epics, statuts)
- `PROGRESS.md` (vue globale)
- `TESTS.md` (registre des tests — statuts, couverture par phase)
- `TECHNICAL_DEBT.md` (dettes ouvertes, resolues)
- Tous les `PHASE*_IMPLEMENT.md` des phases en cours ou recemment terminees (verifier dans BACKLOG)

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

1. `PHASE<N>_IMPLEMENT.md` des phases concernees
2. `TESTS.md` (nouveaux tests, statuts mis a jour)
3. `PROGRESS.md`
4. `TECHNICAL_DEBT.md` (nouvelles dettes + resolues)
5. `BACKLOG.md` (deplacements d'epics + date MAJ)

**Toutes les dates doivent etre absolues** (ex: 2026-05-04, jamais "aujourd'hui").

Apres ecriture, affiche : **"Suivi mis a jour. N fichiers modifies."**

---

## Etape 9 — Regenerer le dashboard HTML (optionnel)

Après avoir écrit les fichiers Markdown, proposer :
**"Voulez-vous aussi régénérer le dashboard HTML (`docs/artifacts/backlog-dashboard.html`) ?"**

Si oui : lire le BACKLOG.md mis à jour et re-générer le fichier HTML avec les nouveaux statuts (badges, barres de progression, prochaines actions). Le fichier doit rester auto-contenu (zéro dépendance externe, CSS inline).

---

## Regles

- **Ne jamais ecrire sans validation** de l'utilisateur
- **Dates absolues** uniquement
- **Pas de sur-documentation** : ne documenter que ce qui a reellement change
- Le skill lit beaucoup mais n'ecrit qu'apres accord
- **Pas de Co-Authored-By** dans les commits crees a partir d'ici
