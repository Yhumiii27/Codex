@AGENTS.md

# Codex — GED du groupe EPC2I

Codex est la gestion électronique des documents (GED) du groupe EPC2I. C'est une app Next.js 16 avec PGlite (Postgres
embarqué) et Drizzle. Elle a été construite d'après la maquette Claude Design (`design/`, design system Nocturne) puis
adaptée au modèle documentaire du deck « Création de la GED EPC2I ».

Elle fait partie d'un système de trois apps :
- **Keystone** : gestion de projets. Port 3000, dépôt `github.com/Yhumiii27/Keystone`.
- **Vigie** : gère les demandes et ordres de modification (ECR/ECO) et l'obsolescence. Port 3200, dépôt
  `github.com/Yhumiii27/Vigie`.
- **Codex** : ce dépôt.

Dans Codex, Keystone et Vigie sont **simulés**, via `src/lib/keystone.ts` et `src/lib/vigie.ts`.

L'utilisateur écrit en français : réponds en français. L'interface et les docs sont en français ; les textes FR/EN
sont dans `src/lib/i18n.ts`.

## À lire avant de travailler

Ces documents sont dans le dépôt : ne redemande pas à l'utilisateur ce qui y figure. Le deck, son audit et les
décisions ont été produits dans une session locale le 7 octobre 2026 ; **ne relance pas l'audit**. Les questions
encore ouvertes sont numérotées O-01 à O-11 dans `docs/decisions.md` : on peut les reposer une fois, en citant leur
numéro, sans les trancher à la place de l'utilisateur.

| Fichier | Contenu |
| --- | --- |
| `docs/decisions.md` | **Journal des décisions de l'utilisateur** (citations exactes) et questions encore ouvertes. Les questions qui y sont tranchées ne se reposent pas. |
| `docs/modele-cible.md` | Modèle fonctionnel qui fait foi : identifiants, révisions, confidentialité, circuits, conservation. Les propositions non confirmées qu'il contient sont signalées en tête ; en cas de doute, `docs/decisions.md` prévaut. |
| `docs/audit-deck-epc2i.md` | Audit du deck (7 octobre 2026) : exigences, modèle de métadonnées, écarts avec Codex et leur statut actuel, architecture. |
| `docs/sources/deck-ged-epc2i.md` | Texte intégral du deck. L'original est `docs/sources/creation-ged-epc2i.pptx`. |
| `docs/historique.md` | Chronologie du travail : construction, audit, modèle v2, revues, app Mac, GitHub. |
| `docs/avancement-v2.md` | État d'avancement et reste à faire. |
| `docs/reste-a-faire.md` | Inventaire vérifié du 9 octobre 2026 : 129 points ouverts, classés selon ce qui les bloque (rien, décision, données, macOS). |
| `docs/registre-points-ouverts.md` | Points à arbitrer sur le registre des types (69 types, 23 familles). |
| `docs/api.md` | API d'intégration : registre, import de migration, webhook Vigie. |
| `README.md` | Démarrage, écrans, ce qui est réel ou simulé, organisation du code. |

## Décisions structurantes (détail et citations dans `docs/decisions.md`)

- **Codex prend tout en charge, workflows compris.** On ne passe ni par Power Automate ni par Power Apps. Seule option
  ouverte : stocker les fichiers dans une bibliothèque SharePoint gérée par Codex. SharePoint ne reçoit que le fichier,
  son nom et sa version ; toutes les métadonnées restent dans Codex (`src/lib/storage.ts`, non testé sur un vrai
  tenant).
- **Deux axes de classement : origine et rattachement.**
- **Identifiants `TYPE-CONTEXTE-SEQ`.**
  - Documents de projet : `TYPE-PROJET-SEQ`.
  - Modèles : contexte `QMS`.
  - Autres documents : code du département (interprétation de la réponse « QMS est le code pour les templates »,
    à confirmer : O-09).
  - Un document ne change jamais d'identifiant d'une révision à l'autre.
- **Révisions en lettres (A, B…) validées par un circuit.** Les versions de travail A.1, A.2… sont conservées.
- **Confidentialité : Public < Restreint < Interne < Confidentiel < Très confidentiel.**
  - Le niveau Public est réservé à certaines familles (communication, par exemple).
  - Le minimum ailleurs est Restreint.
  - Les brouillons sont visibles par le propriétaire, le modificateur désigné par un ECO, les valideurs du circuit en
    cours et les gestionnaires documentaires.
- **Circuits construits à partir des fonctions et du type de document.** Il n'y a pas d'« autorité d'approbation »
  unique.
- **Demandes de modification (ECR/ECO) et obsolescence centralisées dans Vigie.** Les demandes partent de Codex pour
  les documents, de Keystone pour les sujets de projet.
- **Conservation par type de document, selon les règles d'usage.** La migration de l'existant se fera par un code
  dédié, **hors de Codex**.
- **Non tranché** : activation de SharePoint (O-01), fournisseur d'authentification (O-02 ; Entra ID est proposé, pas
  confirmé), liaison avec Keystone par API ou base partagée (O-03), organigramme (O-04), arbitrages du registre (O-05).

## Lancer et vérifier

```bash
npm install
npm run dev          # http://localhost:3100
npm test             # Vitest : tests unitaires de tests/unit/, quelques secondes, sans serveur ni base
npm run typecheck && npm run lint && npm run build
```

- **Base de démo.** Au premier lancement, elle est créée dans `.data/` (non versionné) puis remplie par
  `src/db/seed*.ts`. Pour repartir de zéro : arrêter le serveur, `npm run db:reset`, relancer.
- **Changement de `src/db/schema.ts`.** Tant qu'il n'y a pas de base de production, on régénère une migration
  unique : `rm -rf drizzle && npx drizzle-kit generate --name init`, puis `npm run db:reset`.
- **Utilisateur et rôle simulés** par cookie. Par défaut : Claire Bardet, gestionnaire documentaire. Pour changer,
  cliquer sur le profil en bas de la barre latérale.
- **Pas de secrets dans le dépôt.** Les variables sont décrites dans `.env.example`, et `.gitignore` exclut `.env*`,
  les clés et les dossiers de build.
- **Tests.** Vitest (`vitest.config.ts`), fichiers `tests/**/*.test.ts` ; `tests/unit/` teste les règles pures de
  `src/lib`. Un test encode `docs/decisions.md` et `docs/modele-cible.md`, pas le comportement du code : si le code
  les contredit, on le signale au lieu d'adapter le test. `server-only` y est remplacé par un module vide. Vitest
  demande Node 20.19+ ou 22.12+ (Vite 7).

## Limites en session cloud (conteneur Linux)

- Node ≥ 20.9 est requis (Next 16.4 ; la session locale utilise Node 26). La police Inter est chargée par
  `next/font/google` : sans accès réseau à Google Fonts, `npm run build` peut échouer, `npm run dev` se rabat sur une
  police de secours.
- Une branche cloud créée avant le 9 octobre au soir ne contient pas ces documents : `git fetch origin && git merge
  origin/main`.

- `desktop/` et `npm run app` construisent l'app Mac native (Swift, WebKit, codesign). Ils ne fonctionnent que sous
  macOS, à faire depuis la session locale. Les corrections restantes de l'app Mac sont listées dans
  `docs/avancement-v2.md`.
- Les dépôts Keystone et Vigie ne sont pas accessibles sauf s'ils sont ajoutés à l'environnement. Le registre des
  types reprend déjà la spécification documentaire de Keystone (`docs/spec/10-site-docs-mywork-settings.md` dans
  Keystone).

## Conventions

- **Fidélité à la maquette** : `design/GED Groupe.dc.html`, Nocturne copié dans `src/app/nocturne.css`, un CSS module
  par écran.
- **État d'écran dans l'URL** : onglets, filtres et sélection.
- **Mutations** : toutes dans `src/lib/actions.ts` (Server Actions), avec contrôle des droits côté serveur.
- **Lectures et visibilité** : lectures dans `src/lib/queries.ts`, visibilité dans `src/lib/access.ts`.
- **Git** : dépôt privé `github.com/Yhumiii27/Codex`, branche par défaut `main`. On travaille sur une branche et on
  écrit les messages de commit en français. Ne jamais mettre d'adresse e-mail personnelle dans le dépôt.
