# Cournot Pilot

Jeu pédagogique de duopole de Cournot avec:
- login étudiant via `data/roster.xlsx` (numéro étudiant),
- 2 niveaux de jeu (10 rounds chacun),
- interface étudiant et dashboard professeur,
- export des données en CSV/JSON.

## Lancer le projet

```bash
npm install
npm start
```

Puis ouvrir:
- Étudiant: `http://localhost:3000`
- Prof: `http://localhost:3000/prof`

## Hypothèses sur `roster.xlsx`

Le serveur lit la première feuille et détecte automatiquement:
- numéro étudiant via colonnes type `numeroEtudiant`, `id`, `studentId` (ou première colonne numérique),
- prénom via `prenom`/`firstName`,
- nom via `nom`/`lastName`.

## Variables économiques

- Demande inverse: `p = max(0, 60 - Q/2)`
- Coût marginal: `Cm = 20`
- Profit individuel: `pi_i = (p - Cm) * q_i`
- Meilleure réponse: `BR(q_j) = clamp(40 - q_j/2, 0, 100)`
