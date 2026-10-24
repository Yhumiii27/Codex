# Serveur PostgreSQL commun

Codex garde sa base dans PGlite (PostgreSQL embarqué, dossier `CODEX_DATA_DIR/pglite`) : c'est le défaut, pour le
développement, la démonstration et l'app Mac. Avec `DATABASE_URL`, il travaille sur un serveur PostgreSQL à la place
(point 51 de [reste-a-faire.md](reste-a-faire.md), 18 octobre 2026). **Décision M-01 du 15 octobre 2026** : « Oui, je
valide le format postgreSQL commun avec un schema par outil » ([decisions.md](decisions.md)) : en ligne, ce serveur
est le serveur commun EPC2I (base `epc2i`, un schéma par outil), dont le socle est dans le dépôt Matrix
(`infra/postgres/README.md`, plan `docs/architecture-postgres.md`). L'hébergement lui-même (M22) et le contrat de
liaison avec Keystone (reste de O-03) ne sont pas décidés. Les choix appliqués sont listés dans
[decisions.md](decisions.md), « Choix de l'assistant non validés explicitement ».

Code : `src/db/sql-client.ts` (connexion brute commune aux deux moteurs, pool de connexions), `src/db/index.ts`
(`openDb`, fonctions et déclencheurs, remplissage), `src/db/migrations.ts` (disposition de la base, migrateur, reprise
d'une base ancienne). Mesures : [performances.md](performances.md).

## Le schéma `codex` (lot 11, 22 octobre 2026)

- Toutes les tables, fonctions, déclencheurs, la collation `codex_fr` et le journal des migrations
  (`codex.__drizzle_migrations`) sont dans le schéma `codex`, **sur le serveur comme dans PGlite**. Drizzle qualifie
  ses requêtes (`"codex"."documents"`) ; les requêtes écrites à la main trouvent les tables par le `search_path` :
  `codex` sur le serveur (pool `-c search_path=codex`, et le rôle `codex_app` du socle), `codex, public` en PGlite
  (`src/lib/pglite-options.mjs`, qui remplace le `search_path=public` de démarrage de PGlite).
- Codex **ne crée jamais de schéma sur un serveur** et aucune migration ne contient `CREATE SCHEMA`, `CREATE
  EXTENSION` ni `public` (`tests/unit/migrations.test.ts`) : le rôle `codex_app` n'a pas le droit `CREATE` sur la
  base. Le migrateur (`applyMigrations`) remplace `migrate()` de Drizzle, qui commence par `CREATE SCHEMA IF NOT
  EXISTS` ; il garde son journal (`id`, `hash`, `created_at`), le contrôle des empreintes de la branche et une seule
  transaction pour toutes les migrations en attente.
- **Base de migrations** : `0000_init` (tout le schéma de Codex) et `0001_partage` (prérequis du partage et 7 vues
  `pub_`, voir « Partage » plus bas), figées. Une base faite par une autre chaîne est refusée avant toute écriture.
- **Ancienne base PGlite** (tables dans `public`) :
  - celle de cette branche au 21 octobre (chaîne `0000_init` à `0005_index_acces_validations`, empreintes dans
    `LEGACY_PUBLIC_CHAIN` de `src/lib/backup-core.mjs`, fichiers dans `tests/fixtures/drizzle-public/`) est **reprise
    au démarrage** (et par `npm run db:migrate`), après la sauvegarde automatique : dans une transaction, `public`
    devient `codex` (tables, données, séquences, fonctions, collation et `pg_trgm` suivent), un `public` vide est
    recréé, le journal `drizzle.__drizzle_migrations` passe dans `codex` et ne garde que la nouvelle `0000_init`, puis
    `0001_partage` s'applique. `tests/integration/migrations.test.ts` compare la structure obtenue à celle d'une base
    neuve. Une archive de ces bases se restaure aussi : la reprise se fait au démarrage suivant ;
  - une base d'une chaîne plus ancienne de la branche : démarrer une fois la version du 21 octobre, puis celle-ci ;
  - toute autre (démo de `main` d'avant le 17 octobre, celle du volume Coolify `/data/pglite`) est refusée, intacte,
    avec le remède : `npm run db:reset` pour `.data`, suppression du dossier `pglite` quand `CODEX_DATA_DIR` est posé
    (app Mac, image Docker : [exploitation.md](exploitation.md) §10).
  - Sur un serveur, Codex ne reprend jamais une base dont les tables sont dans `public` : il la refuse.

## Activer

```bash
DATABASE_URL=postgres://codex_app:motdepasse@hote:5432/epc2i npm run start
```

- **Serveur** : PostgreSQL **16** au moins (refusé sinon, avec un message), compilé avec ICU (collations `codex_fr`
  et `und-x-icu`). Le serveur commun EPC2I est en PostgreSQL 16 (décision P-01 de Matrix, 22 octobre 2026) ; 17 et 18
  conviennent aussi. Voir « Repli de la recherche » pour ce qui change selon la version.
- **Schéma et rôle** : sur le serveur commun, le socle Matrix crée le schéma `codex`, propriété de `codex_app`, avec
  `search_path=codex` et `idle_in_transaction_session_timeout=5min` pour ce rôle (`init/02-schemas.sql`). Sur un
  serveur à soi : `CREATE SCHEMA codex AUTHORIZATION <rôle de Codex>;` une fois. Sans schéma `codex`, ou sans droit
  d'y créer, Codex refuse de démarrer en le disant.
- **`pg_trgm`** (paquet contrib, index de recherche `document_terms_term`) : le rôle du socle ne peut pas créer
  d'extension. Son superutilisateur l'installe une fois, **hors du schéma `codex`** (ses fonctions y seraient ouvertes
  à tous les outils lecteurs des vues `pub_`, ce que `droits.verifier()` refuse) :
  ```sql
  CREATE SCHEMA IF NOT EXISTS extensions;
  REVOKE ALL ON SCHEMA extensions FROM PUBLIC;
  GRANT USAGE ON SCHEMA extensions TO codex_app;
  CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA extensions;
  ```
  Codex ajoute ce schéma au `search_path` de la seule transaction de migration. Sur une base à soi dont le rôle est
  propriétaire, Codex crée l'extension lui-même dans `codex`. Sans elle, il refuse de migrer et donne ces commandes.
- **Base vide** : au premier démarrage, Codex applique les migrations, pose ses fonctions et déclencheurs, puis ne
  remplit la base **que si on le lui demande** : `CODEX_SEED=minimal` (référentiel et administrateur initial, mise en
  service), `CODEX_SEED=demo` ou `CODEX_SEED_DEMO=1` (démonstration, bêta). Sans l'une ni l'autre, la base reste vide :
  le journal technique le dit, chaque page mène à `/base-vide` (variables à poser, en français et en anglais) et
  `/api/health` répond 200 avec `"empty": true`. `CODEX_SEED_DEMO=1` avec un autre `CODEX_SEED` : démarrage refusé.
- **Migrations au déploiement** : `npm run db:migrate` applique les migrations en attente avant de démarrer la nouvelle
  version (`-- --check` dit lesquelles, sans rien changer ; sur une base qui a des données, `-- --no-backup` une fois
  le `pg_dump` fait). Sans elle, le premier démarrage les applique ([exploitation.md](exploitation.md) §7).
- **Connexions** : un pool de 10 connexions par processus (`CODEX_DB_POOL`, de 2 à 200 ; `CODEX_DB_POOL_MAX`, ancien
  nom, est encore lu), nommées `codex` (`application_name`).
- **Déclaration à Matrix** : juste après les migrations, Codex envoie la description de ses tables à Matrix
  (`MATRIX_URL`, `MATRIX_TOKEN` ; `src/lib/matrix.ts`), sans attendre la réponse ni échouer ; jamais pendant
  `next build`, qui n'ouvre jamais le serveur.
- **Fichiers** : ils restent dans `CODEX_DATA_DIR/files` (ou SharePoint, O-01). Le dossier de données garde son verrou
  `codex.lock` : un second serveur Codex sur le même dossier est refusé.
- `.env.example` décrit les variables ; le contrôle de configuration refuse une `DATABASE_URL` qui n'est pas une
  adresse `postgres://` ([exploitation.md](exploitation.md)).

## Partage des données (vues `pub_`)

`0001_partage` crée les prérequis du partage (colonnes `documents.distribution`, `review_months`, `process_code` ;
`users.matricule` ; index `audit_log_at_idx` ; `departments.active` existait déjà) et les 7 vues `pub_` lues par
Keystone, Vigie et Matrix : `pub_documents`, `pub_revisions_document`, `pub_validations`, `pub_types_document`,
`pub_circuits_type`, `pub_titulaires_fonction`, `pub_journal`. Elles reprennent `infra/postgres/partage/40-codex.sql`
du dépôt Matrix ; `tests/integration/partage.test.ts` en fige les colonnes et leur ordre. Les droits des lecteurs sont
posés par le socle (`partage/90-droits.sql`). Codex ne lit ni n'écrit encore les colonnes reprises de Vigie
(`distribution`, `review_months` du document, `process_code`) ni `matricule`.

`0002_pub_programmes_recherche` (24 octobre 2026, demande CX-2 de Crucible, accord de l'utilisateur) ajoute une 8e vue,
`pub_programmes_recherche` : `code`, `libelle`, `responsable_matricule` (matricule du responsable, nul s'il n'en a pas),
`actif` (un programme clos y reste, `actif = false`). Lecteurs prévus : `crucible_app`, `matrix_app`. Elle n'est pas
encore dans le socle Matrix : il faut l'ajouter à `partage/40-codex.sql` et accorder sa lecture dans
`partage/90-droits.sql` (demande à déposer dans le `REQUESTS.md` de Matrix). Sur le serveur commun, cette migration
est la première depuis la mise en service : Codex refuse de migrer un serveur sans sauvegarde, donc faire d'abord un
`pg_dump` du schéma `codex` (procédure de sauvegarde du socle), puis démarrer une fois avec
`CODEX_MIGRATION_BACKUP=off`, et retirer la variable ensuite.

**Écarts avec le dépôt Matrix au 22 octobre 2026** (correctifs à y porter ; le dépôt Matrix n'est pas modifié ici) :

1. **`pub_journal.quand`** : `audit_log.at` est dans cette branche un instant UTC (`timestamptz`, journal en ajout
   seul), plus l'heure de Paris sans fuseau. `0001_partage` publie donc `a.at AS quand`, sans `AT TIME ZONE
   'Europe/Paris'` (qui donnerait un `timestamp` sans fuseau, contraire au contrat des quatre `pub_journal`). Rejoué
   tel quel, `40-codex.sql` échoue (« cannot change data type of view column "quand" from timestamp with time zone to
   timestamp without time zone »). Correctif : ligne 214, `a.at AS quand`, et le commentaire de la ligne 210 (« instant
   UTC, publié tel quel »). Vérifié : le fichier ainsi corrigé, rejoué en `codex_app`, laisse les 7 vues identiques
   (définition, options, commentaire).
2. **`pg_trgm`** : le socle ne l'installe pas, et `codex_app` ne peut pas le faire. Correctif : les quatre commandes
   ci-dessus (« Activer »), par exemple à la fin de `init/02-schemas.sql`, et une ligne dans la procédure « Restaurer le
   schéma d'un outil » (l'extension est hors du schéma `codex`, donc hors de `codex.dump`). Installée dans `codex`
   plutôt, `90-droits.sql` échoue : `droits.verifier()` signale un « droit EXECUTE croisé » pour chaque fonction de
   `pg_trgm` (propriété du superutilisateur, exécutables par tous).
3. **Version** : résolu le 22 octobre 2026. Le socle reste en `postgres:16-bookworm` (décision P-01 de Matrix) et
   Codex admet PostgreSQL 16 (« Repli de la recherche » ci-dessous) ; rien à corriger dans Matrix.
4. **`pub_journal.objet`** : nul pour une entrée sans document (droits, organisation, registre, sauvegardes : colonnes
   `target_kind`, `target_id`), et jamais réécrit lors d'un reclassement (le document garde son ancien identifiant en
   alias) ; les codes d'action sont plus de 16. Le commentaire de `40-codex.sql` (« réécrit lors d'un reclassement,
   actions.ts:302 ») est à corriger ; aucune colonne ne change.
5. **Plan `docs/architecture-postgres.md`** : § 4.5 (verrou d'écriture `codex.ecritures` à chaque transaction) et § 6
   (`src/db/migrate.ts`, `src/db/types.ts`) décrivent la première bascule de `main`. Codex garde ses verrous de ligne
   en `READ COMMITTED` (« Transactions » plus bas, vérifiés entre connexions par `npm run test:pg`) et son migrateur
   de `src/db/migrations.ts` ; Codex publie aussi des tables `unlogged` éphémères `codex_export_*` pendant un export
   complet (le socle ne lui donne pas `TEMPORARY`).

## Ce qui est pareil

- Mêmes migrations, même schéma, même code de requêtes (Drizzle avec le pilote node-postgres au lieu de PGlite).
- Mêmes compléments posés à chaque démarrage : journal en ajout seul, version des documents, termes de recherche,
  `codex_fold`, `codex_unbom`, collation `codex_fr`.
- Plusieurs processus Codex qui démarrent en même temps sur la même base : le premier prend un verrou consultatif
  (`pg_advisory_lock`), vérifie et migre la base, pose les fonctions ; les autres attendent, puis n'ont plus rien à
  faire. L'amorçage d'une base neuve se fait de même une seule fois (essayé : deux serveurs lancés ensemble sur une base
  vide, une migration, un amorçage).
- Valeurs lues identiques : node-postgres est réglé pour rendre les `int8` comme des nombres, les dates à minuit UTC et
  les textes sans marque d'ordre d'octets en tête, comme PGlite.
- Compteurs d'identifiants, verrous de ligne (`FOR UPDATE`), verrou consultatif de l'import : ils avaient été écrits
  pour un serveur (points 20 et 40) et sont maintenant vérifiés entre connexions (voir « Tests »).

## Repli de la recherche selon la version (22 octobre 2026)

Le serveur commun reste en PostgreSQL 16 (décision P-01 de Matrix) ; Codex exigeait 18 et refusait de démarrer dessus.
`codex_fold` (décomposition NFD, accents U+0300–U+036F retirés, minuscules) est reposé à chaque démarrage par
`openDb()` (jamais par une migration) avec la collation que la base possède (`foldCollation`, `src/db/index.ts`) :

| Moteur | Collation de `lower()` | Tables Unicode de la casse |
| --- | --- | --- |
| PGlite 0.5, PostgreSQL 18 | `pg_unicode_fast` (fournisseur intégré) | celles de PostgreSQL (16.0) |
| PostgreSQL 16 et 17 | `"und-x-icu"` (racine ICU) | celles de l'ICU du serveur (ICU 72, Unicode 15.0, sur `postgres:16-bookworm`) |

Les deux appliquent la correspondance de casse complète d'Unicode avec le sigma final, comme `toLowerCase` de
JavaScript (`fold`, `src/lib/search.ts`). `pg_c_utf8` (PostgreSQL 17) et les collations libc (`C.UTF-8` de la base
`epc2i`) font une correspondance un pour un sans sigma final : jamais utilisées.

Vérifié sur l'image du socle Matrix (PostgreSQL 16.15, ICU 72), par `tests/integration/search-sql.test.ts` et une
comparaison de tous les points de code attribués par Node 22 (Unicode 16.0) : accents français, œ/Œ, æ/Æ, ß et ẞ (→ ß),
İ (→ i), ǅ (→ ǆ), sigma final (ΑΣ → ας, mais 1Σ → 1σ), ligature ﬁ (inchangée), comme JavaScript. **Écarts restants** :

- 47 points de code ajoutés par Unicode 16.0, inconnus d'ICU 72 et des tables de normalisation de PostgreSQL 16
  (U+1C89, U+A7CB, U+A7CC, U+A7DA, U+A7DC, écritures Garay U+10D50–U+10D65, Todhri U+105C9 et U+105E4,
  Tulu-Tigalari U+11383…U+113C8, Gurung Khema U+16121–U+16128, Kirat Rai U+16D68–U+16D6A) : la base les laisse tels
  quels, `fold` les replie. La recherche reste cohérente (la requête et les valeurs sont repliées par la même
  fonction de la base), seule la référence en mémoire diffère sur ces caractères. Le test compare donc, sur
  PostgreSQL 16 qui n'a pas `unicode_assigned()`, les points de code que l'ICU du serveur attribue (classes
  `graph`, `space`, `cntrl` : 286 548 sur 292 530 ; les caractères de format, Cf, sont couverts par les textes du test
  suivant).
- Tri par titre et ID (`codex_fr`, ICU 72) : l'apostrophe droite ' et l'apostrophe typographique ’ sont distinguées
  (' avant ’), alors que l'ICU de PGlite et de Node les tient pour égales. Le test de tri est sauté sur
  PostgreSQL 16 (pas de `icu_unicode_version()`), comme il l'était sur un ICU antérieur à Unicode 16.0.
- Passage ultérieur du serveur en PostgreSQL 18 : `codex_fold` passera à `pg_unicode_fast` au démarrage suivant ; les
  termes déjà enregistrés (`document_terms`) ne diffèrent que sur les points de code ci-dessus. Une mise à jour de
  l'ICU du système (nouvelle image Debian) peut de même changer ces caractères, comme l'ordre de `codex_fr`.

## Ce qui change

| Fonction | Avec PGlite | Avec un serveur PostgreSQL |
| --- | --- | --- |
| Sauvegarder maintenant (Administration) | archive Codex | refusé, avec un message : le serveur se sauvegarde avec ses outils (`pg_dump`, instantanés de l'hébergeur), les fichiers à part |
| `npm run backup`, `npm run restore` | archive Codex | refusés, avec un message (une archive Codex contient une base PGlite) |
| `npm run backup:list`, `backup:check`, `export:check` | — | inchangés (ils ne lisent que des archives) |
| Migration en attente sur une base qui a des données | sauvegarde automatique avant (au démarrage comme par `npm run db:migrate`) | refusée tant que `CODEX_MIGRATION_BACKUP=off` (ou `npm run db:migrate -- --no-backup`) n'est pas posé, une fois la sauvegarde du serveur faite |
| Export complet (Administration) | copie sous le verrou de l'unique connexion | copie en `REPEATABLE READ` sur une connexion gardée pour l'export, dans des tables temporaires, ou `unlogged` du schéma `codex` (`codex_export_*`, supprimées à la fin) quand le rôle n'a pas `TEMPORARY` (serveur commun) ; les écritures continuent ([export.md](export.md)) |
| `npm run export`, `npm run integrity` | serveur arrêté | refusés, avec un message : passer par l'Administration (export complet, intégrité des fichiers) |
| `npm run registry:apply` | sauvegarde avant `--apply` | travaille sur le serveur ; `--apply` y demande `--no-backup`, à donner une fois la sauvegarde du serveur faite ; serveur Codex arrêté recommandé, non vérifié |
| Requêtes simultanées | une à la fois (une connexion) | en parallèle sur le pool |
| Niveau d'isolation | sans objet (une connexion) | `READ COMMITTED` (défaut de PostgreSQL) ; les transactions qui relisent avant d'écrire verrouillent d'abord le document (« Transactions » plus bas) |

## Transactions en `READ COMMITTED`

Revue du 18 octobre 2026 (point 51 de [reste-a-faire.md](reste-a-faire.md)), transaction par transaction. En
`READ COMMITTED`, chaque instruction voit ce qui était validé quand elle commence : deux transactions qui lisent l'état
d'un document puis écrivent selon ce qu'elles ont lu peuvent décider toutes deux sur le même état (double approbation
d'une étape, double mise en vigueur, double demande). PGlite n'a pas ce problème (une transaction à la fois).

**Règle retenue.** Une transaction qui lit l'état d'un document (sa ligne, ses révisions, ses versions de travail, ses
circuits, ses demandes de modification) pour décider ce qu'elle écrit verrouille d'abord la ligne du document
(`lockDoc`, `lockDocs` de `src/lib/lifecycle.ts` : `SELECT … FOR UPDATE`, dans l'ordre des identifiants quand il y en a
plusieurs, ce qui évite qu'elles s'attendent l'une l'autre). Une seconde transaction sur le même document attend que
la première soit validée, puis lit ce qu'elle a écrit. Pour un circuit, c'est la ligne de son document (`lockWorkflow`) ;
pour une demande de modification aussi, la demande étant relue une fois le document verrouillé.

| Transactions | Avant | Après |
| --- | --- | --- |
| `decideStep`, `recallValidation`, `delegateStep`, `reassignStep` | circuit lu sans verrou : deux approbations simultanées de la même étape passaient toutes deux (deux entrées « approuvé » ; à la dernière étape, deux mises en vigueur) | document du circuit verrouillé, circuit relu : la seconde répond « étape déjà décidée » |
| `promoteDue` (planificateur et pages) | révision « approuvée » relue sans verrou : deux passages simultanés la mettaient deux fois en vigueur | document verrouillé, révision relue |
| `applyChangeDecision` (webhook Vigie, simulation) | demande lue avant le verrou du document : deux décisions sur la même demande s'appliquaient toutes deux | document verrouillé, demande relue ; la seconde répond `not_found` |
| `graftChange` | même chose pour la greffe d'une demande acceptée | document verrouillé, demande relue |
| `requestValidation`, `requestChange`, `recordReview` | « pas de circuit en cours », « pas de demande en attente » vérifiés sans verrou ; le doublon finissait sur une contrainte d'unicité (erreur 500) | document verrouillé : réponse « déjà en cours » ou « demande en attente » |
| `addWorkingVersion`, `restoreWorkingVersion` | statut de la révision lu sans verrou : une version pouvait s'ajouter à une révision passée en vérification entre-temps | document verrouillé, révision relue |
| `archiveDocuments`, `holdDocuments`, `releaseHold`, `restoreArchived` | état lu avant la transaction ou sans verrou (gel posé et journalisé deux fois) | documents verrouillés dans l'ordre, relus |
| `addDocLink`, `removeDocLink` | état des deux extrémités lu sans verrou | les deux documents verrouillés dans l'ordre de leurs identifiants |
| `createDocument` | pièce attendue par Keystone lue puis remplie : deux documents pouvaient la prendre | mise à jour conditionnelle (`doc_id is null`) |
| `togglePermission` | deux bascules simultanées allaient dans le même sens (journal faux) ; une ligne absente créée deux fois (clé primaire) | ligne créée si absente, verrouillée, relue |
| Registre et organisation : `update…`, `delete…` (types, familles, fonctions, programmes), `setDepartmentFeatured` | ligne lue sans verrou : modification perdue, « avant » du journal faux | ligne verrouillée (`FOR UPDATE`) |
| `confirmTransfer` (reprise d'une personne qui part) | verrou consultatif entre transferts, mais documents lus sans verrou face aux autres actions | documents concernés verrouillés avant le plan, comparé ensuite à l'empreinte |
| `updateType` avec application de la règle de conservation (`applyTypeRetention`), `renameVocabTerm` et `mergeVocabTerms` (`applyTerm`) | documents du type ou du terme lus sans verrou puis réécrits : un gel ou une dérogation posés entre-temps étaient écrasés, un mot-clé ajouté entre-temps perdu (revue du lot 9, [historique.md](historique.md) §18.10) | documents verrouillés dans l'ordre de leurs identifiants, puis relus |
| `updateMeta`, `setReaders`, `setTemplateTypes`, `setRetentionEvent`, `setRetentionClass`, organisation (`…OrgValue`), ajout d'un terme, `applyDuePendingDecisions` | déjà un verrou de ligne | inchangées |
| Compteurs d'identifiants, import (`pg_advisory_xact_lock`), bail du planificateur (mise à jour conditionnelle), signatures (`on conflict do nothing`), aperçus Office (`on conflict … where`) | déjà sûrs (points 20, 23, 38, 40) | inchangés |
| `addComment`, `addFunctionHolder`, `removeFunctionHolder`, `journalConsultation`, recherches enregistrées, création d'un type, d'une famille, d'une fonction, d'un programme | insertion ou suppression seule (clé primaire, `returning`) | inchangées |

Ce qui reste : la suppression d'un type « non utilisé » face à la création simultanée d'un document de ce type échoue
sur la clé étrangère (une erreur, pas une incohérence) ; un commentaire peut être ajouté à un circuit qui vient de se
terminer. `tests/integration/read-committed.test.ts` rejoue les cas corrigés : sur PostgreSQL 18.3, ses 6 tests
échouaient tous avec l'ancien code (doubles approbations, double mise en vigueur, demandes en double sur une contrainte
d'unicité, décision Vigie appliquée deux fois, bascule perdue) et passent avec le nouveau ; sur PGlite, 5 passent (le
sixième, qui tient une transaction ouverte, demande deux connexions). La revue du lot 9 y a ajouté deux cas, sautés sur
PGlite pour la même raison : une règle de conservation appliquée au type pendant qu'un gel est posé, un terme renommé
pendant qu'un mot-clé est ajouté au document ; tous deux échouaient sur PostgreSQL 18.3 avant correction.

## Tests

```bash
CODEX_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5432/postgres npm run test:pg
```

- Toute la suite tourne sur le serveur : chaque fichier de test y crée sa base (`codex_test_<processus>_<hasard>`),
  supprimée à la fin, **disposée comme le socle** : un rôle propre (`codex_app_<…>`), propriétaire du seul schéma
  `codex`, sans `CREATE` ni `TEMPORARY` sur la base, `public` fermé, `pg_trgm` dans un schéma `extensions`. Il faut
  pour cela un superutilisateur dans `CODEX_TEST_DATABASE_URL` ; sinon le test se connecte avec cet utilisateur, à un
  schéma `codex` qu'il possède. La remise à zéro entre deux tests coupe le déclencheur du journal le temps d'un
  `TRUNCATE`, ce que le propriétaire de la table peut faire (plus `session_replication_role`, réservé au
  superutilisateur). Les tests de sauvegarde et de restauration restent sur PGlite
  (`setupDb({ engine: 'pglite' })`) : ils testent l'archive de PGlite.
- `tests/integration/postgres-server.test.ts` (sauté sur PGlite) tient des transactions ouvertes en même temps sur
  des connexions distinctes : un second tirage du même compteur attend le premier et prend le numéro suivant ; une
  transaction annulée rend son numéro ; d'autres compteurs n'attendent pas ; 60 créations simultanées sur 10
  connexions donnent 60 identifiants distincts et consécutifs ; l'ancien calcul max + 1 donne bien deux fois le même
  identifiant (la seconde création échoue sur la clé primaire) ; huit imports simultanés de la même référence créent un
  seul document ; « Sauvegarder maintenant » est refusé. `tests/integration/read-committed.test.ts` : actions
  envoyées plusieurs fois en même temps (approbation, mise en vigueur, demande, décision Vigie, droit) et une
  décision qui attend le verrou d'une autre transaction (« Transactions » plus haut).
- Mesure : 1 000 créations de documents (tirage du compteur et écriture, chacune dans sa transaction) : 2,7 s une à
  une sur PGlite comme sur le serveur ; envoyées toutes à la fois, 3,0 s sur PGlite (une connexion) et 1,15 s sur le
  serveur (pool de 10), sans doublon.
- L'intégration continue lance `npm run test:pg` sur un service `postgres:16-bookworm` et sur un service
  `postgres:18-bookworm` (`.github/workflows/ci.yml`).
- Essai du 22 octobre 2026, passage en PostgreSQL 16 : image du socle Matrix (`docker build infra/postgres`,
  PostgreSQL 16.15, ICU 72) : 109 fichiers, 1 464 tests réussis, 3 sautés (dont le tri `codex_fr`) ; quatre tests
  PGlite de sauvegarde et d'intégrité ont dépassé leur délai de 15 s sur la machine chargée d'un premier passage et
  passent seuls. `postgres:18-bookworm` (18, ICU 72) : 109 fichiers, 1 464 réussis, 3 sautés. Puis
  `npm run db:migrate` en `codex_app` sur la base `epc2i` du socle : `0000_init` et `0001_partage` appliquées,
  `codex_fold` posé avec `"und-x-icu"`, `partage/90-droits.sql` rejoué : `droits.verifier()` sans erreur.
- Essai du 22 octobre 2026, lot 11 (PostgreSQL 18.3, rôles du socle) : 109 fichiers, 1 464 tests réussis, 3 sautés.
  Le socle Matrix lui-même (`init/01` à `03`, rejoués par un petit lecteur des commandes de psql, faute de psql),
  puis Codex en `codex_app` : voir [historique.md](historique.md) § 20.
- Essai du 18 octobre 2026, fin du lot 9 : 101 fichiers, 1 364 tests réussis sur PostgreSQL 18.3, 3 sautés (premier
  essai de l'étape 3 : 79 fichiers, 1 172 tests, 2 sautés). L'un est le test de tri
  `codex_fr`, sauté quand l'ICU du serveur est plus ancien que celui de PGlite (Unicode antérieur à 16.0) : le serveur
  de l'essai (binaires `@embedded-postgres`, ICU 60) classe l'apostrophe droite avant l'apostrophe typographique, que
  l'ICU récent tient pour égales. Un serveur avec un ICU récent (Debian, Ubuntu actuels) est vérifié par ce test.

## Ce qui n'est pas fait

- **Sauvegarde du serveur** : `pg_dump` par schéma (`infra/postgres/sauvegarde/` du dépôt Matrix) ou les instantanés
  de l'hébergeur ; leur lieu et leur restauration relèvent de l'hébergement (M22, P-08 de Matrix). Codex ne les lance
  pas.
- **Plusieurs processus** (limite, non développée ; [exploitation.md](exploitation.md) §7) : la base les supporte
  (migrations et amorçage sous verrou consultatif, verrous de ligne, bail du planificateur), mais les limites de débit
  sont en mémoire par processus (chacun compte à part : la limite réelle est multipliée par le nombre de processus),
  les fichiers locaux sont dans le dossier de données d'un serveur, que le verrou `codex.lock` refuse à un second
  (il faudrait un stockage commun : SharePoint, O-01, ou un volume partagé et un verrou par processus), et les verrous
  « déjà en cours » de l'Administration (sauvegarde, nettoyage, intégrité) sont par processus. Rien n'a été essayé
  derrière un répartiteur.
- **Serveur distant** : les mesures ont été faites sur la même machine ; un serveur distant ajoute un aller-retour
  réseau à chacune des 40 à 55 requêtes d'un écran ([performances.md](performances.md)).
- **Pilote** : node-postgres 8. Les requêtes envoyées en même temps sur une connexion (un `Promise.all` dans une
  transaction, permis par PGlite) sont mises en file par Codex lui-même, que node-postgres 9 n'acceptera plus.
