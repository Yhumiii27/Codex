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
| `docs/postgres.md` | PostgreSQL serveur en option (`DATABASE_URL`), limites, `npm run test:pg`. |
| `docs/performances.md` | Mesures sur gros volume (`npm run seed:large`, `npm run perf`). |
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
npm test             # Vitest : tests/unit et tests/integration (PGlite en mémoire), ~20 s, sans serveur ni .data/
npm run typecheck && npm run lint && npm run build
```

- **Intégration continue** : `.github/workflows/ci.yml` rejoue `npm ci`, `npm run db:check`, typecheck, lint, tests et
  build à chaque push et pull request.

- **Base de démo.** Au premier lancement, elle est créée dans `.data/` (non versionné) puis remplie par
  `src/db/seed*.ts`. Pour repartir de zéro : arrêter le serveur, `npm run db:reset`, relancer.
  - `CODEX_SEED=demo` (défaut) charge le référentiel et la démonstration ; `CODEX_SEED=minimal` ne charge que le
    référentiel (registre, fonctions, matrice des droits, organisation provisoire, acteurs système) et un
    administrateur initial (`admin`). Lu seulement sur une base vide.
- **Changement de `src/db/schema.ts` : migrations incrémentales** (depuis le 17 octobre 2026). `drizzle/0000_init.sql`
  est la base, figée : ne plus jamais supprimer `drizzle/` ni régénérer ou modifier une migration déjà commitée.
  1. Modifier `src/db/schema.ts`, puis `npm run db:generate -- --name <sujet>` : une nouvelle migration
     `drizzle/NNNN_<sujet>.sql`, qu'on relit (renommage de colonne : drizzle-kit pose la question ; données à
     reprendre : compléter le SQL à la main avant de commiter).
  2. `npm run db:check` et `npm test` (`tests/integration/migrations.test.ts` vérifie que le schéma a sa migration et
     que la chaîne de migrations donne la structure du schéma).
  3. Au démarrage, Codex applique les migrations manquantes en une transaction, après une sauvegarde automatique
     de la base (`CODEX_MIGRATION_BACKUP=off` pour s'en passer) ; il refuse une base faite par un autre schéma
     (`src/db/migrations.ts`). Pas de `db:reset` à faire. Retour arrière : `npm run restore` de cette sauvegarde
     avec la version précédente de Codex.
  - Fonctions et déclencheurs (journal, version, termes de recherche) ne sont pas dans les migrations : ils sont
    reposés à chaque démarrage par `openDb()` (`src/db/index.ts`), à garder cohérents avec le schéma.
- **Évolution de `src/db/registry.ts`** (ou des fonctions de `src/db/seed-org.ts`) : `npm run registry:apply`
  (serveur arrêté) montre l'écart avec la base, `-- --apply` l'applique après une sauvegarde, journalisé. Ce qui a été
  réglé dans l'Administration est conservé ; un code n'est jamais renommé ni supprimé (un type retiré est désactivé).
- **Utilisateur et rôle simulés** par cookie. Par défaut : Claire Bardet, gestionnaire documentaire. Pour changer,
  cliquer sur le profil en bas de la barre latérale.
- **Pas de secrets dans le dépôt.** Les variables sont décrites dans `.env.example`, et `.gitignore` exclut `.env*`,
  les clés et les dossiers de build.
- **Tests.** Vitest (`vitest.config.ts`), fichiers `tests/**/*.test.ts` ; `tests/unit/` teste les règles pures de
  `src/lib`. Un test encode `docs/decisions.md` et `docs/modele-cible.md`, pas le comportement du code : si le code
  les contredit, on le signale au lieu d'adapter le test. `server-only` y est remplacé par un module vide. Vitest
  demande Node 20.19+ ou 22.12+ (Vite 7).
  - `tests/integration/` teste les règles métier sur une base PGlite en mémoire ouverte par `openDb()`
    (`src/db/index.ts` : migrations de `drizzle/` et déclencheur du journal, sans données).
  - `tests/support/db.ts` fournit `setupDb()` (une base par fichier, vidée et remplie des données minimales de
    `fixtures.ts` avant chaque test), `currentDb()`, `fixClock()` et `setClock()`, et des aides (`addDoc`,
    `addWorkflow`…).
  - Un fichier qui appelle du code passant par `getDb()` doit simuler `@/db` pour lui rendre `currentDb()` ; sinon
    `getDb()` ouvrirait `.data/pglite`. S'il appelle des Server Actions, il simule aussi `next/headers` et
    `next/cache`, et choisit l'utilisateur avec `actAs()` (`tests/support/session.ts`). Les `vi.mock` à copier
    sont en tête de `tests/integration/locks.test.ts`.
  - PGlite sérialise les transactions : les tests « simultanés » ne prouvent pas l'atomicité entre connexions ;
    `npm run test:pg` rejoue la suite sur un PostgreSQL serveur (voir `docs/postgres.md`).

## Limites en session cloud (conteneur Linux)

- Node 20.19+ ou 22.12+ est requis (`engines` de package.json : Next 16.4 et Vite 7 pour Vitest ; la session locale
  utilise Node 26). La police Inter est dans le dépôt (`src/fonts/`, `next/font/local`, licence OFL) : le build ne
  demande plus d'accès réseau.
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
