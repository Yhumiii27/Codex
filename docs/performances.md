# Performances sur gros volume

Mesures du 18 octobre 2026 (point 56 de [reste-a-faire.md](reste-a-faire.md)), sur PGlite et sur un serveur
PostgreSQL ([postgres.md](postgres.md)). Les volumes cibles ne sont pas connus (M18, O-11) : 10 000 documents servent
de premier palier, à refaire avec les volumes réels.

## Outils

- **`npm run seed:large -- --docs 10000`** (`scripts/codex-seed-large.mts`) : écrit une base de test à part.
  - Cible : `.data-large/` par défaut (PGlite), ou `--data-dir <dossier>`, ou `--database-url postgres://…` (une base
    d'un serveur, nommée explicitement). Ni `DATABASE_URL` ni `CODEX_DATA_DIR` ne sont lus : la base de démonstration
    n'est jamais visée par défaut. Une base qui a déjà des documents est refusée sans `--append` ; `--replace` efface
    d'abord le dossier PGlite visé.
  - Contenu : la démonstration (référentiel, personnes, projets, fonctions) puis `--people` personnes fictives (200
    par défaut : 70 % contributeurs, 25 % validateurs, 3 % auditeurs, 2 % gestionnaires, réparties entre départements
    et sites) et `--docs` documents tirés parmi ce que le registre admet (type, origine, rattachement, projet ou
    programme, département, confidentialité), avec révisions (remplacées, en vigueur, en rédaction, en vérification),
    versions de travail, circuits terminés et en cours, commentaires, lecteurs nommés des documents confidentiels et
    entrées de journal (dépôts, mises en vigueur, demandes, approbations, consultations). Pas de fichier stocké.
  - Déterministe : le même `--seed` (1 par défaut) donne la même base. 10 000 documents s'écrivent en 27 s sur PGlite,
    22 s sur le serveur.
- **`npm run perf`** (`scripts/codex-perf.mjs`) : mesure un serveur lancé, de préférence en production
  (`npm run build`, puis `npm run start` avec `CODEX_DATA_DIR=.data-large` ou `DATABASE_URL=…`, et
  `CODEX_RATE_LIMIT=off` pour que les exports ne soient pas limités).
  - Chaque route est demandée une fois pour chauffer, puis `--runs` fois (5 par défaut), une requête à la fois, pour
    chaque personne et rôle simulé de `--as` (par défaut `cbardet:gestionnaire,synth00001:collaborateur`). Le temps
    va jusqu'au dernier octet de la réponse.
  - Puis `--parallel` requêtes simultanées (10 par défaut) sur trois routes : le temps jusqu'à la dernière réponse.
  - Sortie : un tableau Markdown ; `--json <fichier>` garde toutes les mesures.
  - Les routes journalisent ce qu'elles journalisent d'habitude (consultations, exports) : à lancer sur une base de
    test.

## Conditions

- Conteneur Linux, 4 processeurs virtuels, 15 Go de mémoire ; Node 22.22 ; build de production (`next start`).
- PGlite 0.5.8 (PostgreSQL 18.3 en WebAssembly, dans le processus du serveur).
- PostgreSQL 18.3 sur la même machine (binaires `@embedded-postgres/linux-x64` 18.3.0-beta.17, ICU 60), connexion
  TCP locale, pool de 10 connexions, réglages par défaut. Aucune latence réseau : un serveur distant ajouterait un
  aller-retour par requête (voir « Requêtes par écran »).
- Base : 10 063 documents (10 000 synthétiques et les 63 de la démonstration), 18 417 révisions, 36 843 versions de
  travail, 8 418 circuits (20 979 étapes, 8 366 commentaires), 4 993 lecteurs nommés, environ 110 000 entrées de
  journal, 225 personnes (25 de la démonstration, 200 fictives). Référence : la base de démonstration seule (63
  documents), sur PGlite.

## Résultats : une requête à la fois

Médiane de 5 requêtes, Claire Bardet (gestionnaire documentaire, voit tout) :

| Route | Démo, PGlite | 10 000 docs, PGlite | 10 000 docs, PostgreSQL | Taille (10 000 docs) |
| --- | ---: | ---: | ---: | ---: |
| Accueil (`/`) | 90 ms | 576 ms | 218 ms | 261 Ko |
| Recherche sans critère (`/recherche`) | 108 ms | 605 ms | 209 ms | 684 Ko |
| Recherche « soudure » | 92 ms | 403 ms | 173 ms | 659 Ko |
| Recherche, filtre Confidentiel | 77 ms | 531 ms | 174 ms | 678 Ko |
| Recherche, page 20 | 76 ms | 516 ms | 205 ms | 683 Ko |
| Explorateur | 83 ms | 414 ms | 177 ms | 380 Ko |
| Fiche document | 85 ms | 533 ms | 256 ms | 1,7 Mo |
| Validations | 76 ms | 1,61 s | 631 ms | 228 Ko |
| Archivage | 69 ms | 589 ms | 286 ms | 1,9 Mo |
| Département QUA | 85 ms | 453 ms | 186 ms | 379 Ko |
| Administration › Journal | 82 ms | 310 ms | 135 ms | 303 Ko |
| Export CSV « soudure » | 21 ms | 159 ms | 66 ms | 294 Ko |
| Export CSV de toute la recherche | 35 ms | 1,13 s | 440 ms | 2,8 Mo |
| Santé (`/api/health`) | 4 ms | 4 ms | 3 ms | — |

Une personne fictive en rôle collaborateur (voit moins) : mêmes ordres de grandeur, par exemple Accueil 722 ms sur
PGlite et 215 ms sur PostgreSQL, Validations 1,73 s et 625 ms, export CSV complet 476 ms et 240 ms.

Les tailles sont les mêmes sur les deux bases : elles affichent les mêmes données.

## Requêtes simultanées

10 requêtes envoyées en même temps, Claire Bardet ; « rapport » = temps jusqu'à la dernière réponse divisé par le
temps d'une requête seule :

| Route | Démo, PGlite | 10 000 docs, PGlite | 10 000 docs, PostgreSQL |
| --- | ---: | ---: | ---: |
| Recherche « soudure » | 0,70 s (× 9,8) | 4,02 s (× 9,9) | 1,35 s (× 8,2) |
| Fiche document | 0,74 s (× 9,0) | 5,22 s (× 10,1) | 2,10 s (× 9,5) |
| Validations | 0,76 s (× 11,3) | 15,67 s (× 10,0) | 5,91 s (× 9,7) |

Les requêtes passent l'une après l'autre dans les deux cas : un seul processus Node rend les pages, et son temps de
calcul (rendu, lecture des résultats) est le goulot, même quand la base est un serveur à part. PGlite y ajoute la base
elle-même, qui tourne dans ce même processus.

## Requêtes par écran (PostgreSQL)

Relevé par `pg_stat_statements` pour une requête de chaque écran (Claire Bardet, 10 000 documents) :

| Écran | Requêtes SQL | Temps cumulé en base | Lignes lues |
| --- | ---: | ---: | ---: |
| Accueil | 51 | 241 ms | 28 422 |
| Recherche « soudure » | 44 | 172 ms | 21 656 |
| Explorateur | 43 | 158 ms | 21 716 |
| Fiche document | 55 | 130 ms | 31 500 |
| Validations | 51 | 223 ms | 87 809 |
| Archivage | 43 | 138 ms | 28 272 |
| Administration › Journal | 42 | 82 ms | 21 921 |
| Export CSV « soudure » | 15 | 34 ms | 5 626 |

Plusieurs requêtes partent en parallèle : le temps cumulé dépasse parfois le temps de la page. Chaque écran lit
plus de 20 000 lignes, dont l'essentiel pour l'en-tête commun et le contexte (tous les documents visibles pour
l'activité récente, les modèles et « À traiter », tous les circuits), déjà relevé au point 50.

## Ce qu'on en tire

- **Tout reste utilisable à 10 000 documents**, mais rien n'est instantané : 0,4 à 0,6 s par écran sur PGlite, 0,2 à
  0,3 s sur PostgreSQL. La base de démonstration répond en 70 à 110 ms : le temps croît avec le volume.
- **PostgreSQL est 2 à 3 fois plus rapide** que PGlite sur les mêmes données, une requête à la fois.
- **Les écrans les plus lents** étaient Validations (1,6 s sur PGlite, 0,6 s sur PostgreSQL : il lisait tous les
  circuits, sans pagination ; 0,26 s depuis le lot 9, étape 9, plus bas) et l'export CSV de toute la recherche (1,1 s et 0,44 s pour 2,8 Mo). Puis l'Archivage et la fiche,
  dont les pages pèsent près de 2 Mo.
- **La charge simultanée ne se répartit pas** : un processus Node traite les pages l'une après l'autre. Plusieurs
  processus derrière un répartiteur ne sont possibles qu'avec un serveur PostgreSQL, et demanderaient en plus des
  limites de débit partagées et un stockage de fichiers commun (le verrou du dossier de données refuse un second
  serveur sur le même dossier).
- **Prochaines étapes** (point 50 et hébergement) : lire l'en-tête commun, l'accueil, l'archivage et la fiche par la
  base au lieu de charger tous les documents visibles (fait le 17 octobre, point 47) ; paginer Validations (fait le 18
  octobre, plus bas) ; refaire ces mesures avec les volumes
  réels (M18, O-11), un serveur distant et, si plusieurs processus sont retenus, sous charge.

## Lot 9, étape 9 : index d'accès ciblé et Validations paginé (18 octobre)

Points 47 et 50 de [reste-a-faire.md](reste-a-faire.md). Même base de 10 063 documents (régénérée par
`npm run seed:large -- --docs 10000`, même graine), PGlite, build de production, médiane de 5 requêtes, sur la même
machine, avant (commit `d0ed61e`) et après :

- **Index d'accès** (`getAccessIndex`, `src/lib/access.ts`) : chaque requête lisait tous les lecteurs nommés (4 994
  lignes), toutes les révisions ouvertes (4 501), tous les circuits en cours et leurs étapes (1 479 et 3 691) et tous
  les titulaires de fonctions, soit 70 ms de requêtes sur PGlite ; il ne lit plus que les lignes de la personne (ses
  lectures nommées, ses révisions, ses étapes, ses fonctions), 13 à 30 lignes, 3 ms environ (index partiel
  `revisions_open_modifier`, migration `0005_index_acces_validations`).
- **Validations** (`validationsPage`, `src/lib/queries.ts`) : comptes des quatre filtres par un agrégat SQL, liste du
  filtre par pages de 50 (`?p=`), seuls les circuits de la page lus entiers ; visibilité en SQL (`readableSql`, cercle
  de rédaction, révision visible) ; index `workflows_requester`.

| Personne | Route | Avant | Après | Écart |
| --- | --- | ---: | ---: | ---: |
| Claire Bardet (gestionnaire) | Validations | 1,60 s | 263 ms | −84 % |
| Claire Bardet | Accueil | 631 ms | 501 ms | −21 % |
| Claire Bardet | Recherche « soudure » | 427 ms | 316 ms | −26 % |
| Claire Bardet | Explorateur | 418 ms | 359 ms | −14 % |
| Claire Bardet | Fiche document | 567 ms | 443 ms | −22 % |
| Claire Bardet | Archivage | 584 ms | 451 ms | −23 % |
| Claire Bardet | Administration › Journal | 319 ms | 234 ms | −27 % |
| Claire Bardet | Export CSV de toute la recherche | 1,04 s | 1,11 s | +7 % (inchangé : déjà en SQL) |
| Personne fictive (collaborateur) | Validations | 1,71 s | 366 ms | −79 % |
| Personne fictive | Accueil | 663 ms | 589 ms | −11 % |
| Personne fictive | Fiche document | 802 ms | 610 ms | −24 % |
| Personne fictive | Explorateur | 488 ms | 341 ms | −30 % |

Dix requêtes simultanées de Validations : 15,95 s avant, 2,72 s après (le rapport reste d'environ 10 : un seul
processus Node). Les autres écrans gagnent 10 à 30 % par l'index d'accès seul. Ce qui reste du temps d'un écran est
surtout le rendu et l'en-tête commun (« À traiter », activité récente), rendus à chaque chargement complet.

## Rejouer les mesures

```bash
npm run seed:large -- --docs 10000                     # .data-large/ (PGlite)
npm run build
CODEX_DATA_DIR=.data-large CODEX_RATE_LIMIT=off npm run start
npm run perf -- --label "PGlite, 10 000 documents" --json /tmp/perf-pglite.json   # dans un autre terminal

createdb codex_large                                   # sur le serveur PostgreSQL 18
npm run seed:large -- --docs 10000 --database-url postgres://…/codex_large
DATABASE_URL=postgres://…/codex_large CODEX_DATA_DIR=/tmp/codex-pg-files CODEX_RATE_LIMIT=off npm run start
npm run perf -- --label "PostgreSQL, 10 000 documents"
```
