# Serveur PostgreSQL en option

Codex garde sa base dans PGlite (PostgreSQL embarqué, dossier `CODEX_DATA_DIR/pglite`) : c'est le défaut, pour le
développement, la démonstration et l'app Mac. Depuis le 18 octobre 2026 (point 51 de
[reste-a-faire.md](reste-a-faire.md)), il peut travailler sur un serveur PostgreSQL à la place. **L'hébergement n'est
pas décidé** (M22 ; la liaison avec Keystone, O-03, non plus) : c'est une option prête, pas un choix. Les choix
appliqués sont listés dans [decisions.md](decisions.md), « Choix de l'assistant non validés explicitement ».

Code : `src/db/sql-client.ts` (connexion brute commune aux deux moteurs, pool de connexions), `src/db/index.ts`
(`openDb`, migrations, fonctions et déclencheurs, amorçage). Mesures : [performances.md](performances.md).

## Activer

```bash
DATABASE_URL=postgres://codex:motdepasse@db.exemple:5432/codex npm run start
```

- **Serveur** : PostgreSQL **18** au moins (refusé sinon, avec un message), compilé avec ICU (collation `codex_fr`),
  et l'extension `pg_trgm` (paquet contrib). Codex crée l'extension au démarrage si elle manque : l'utilisateur doit
  en avoir le droit (`pg_trgm` est une extension de confiance, le propriétaire de la base peut la créer), sinon un
  administrateur la crée avant (`create extension pg_trgm`).
- **Base** : une base vide, dont l'utilisateur de Codex est propriétaire (il y crée tables, fonctions, déclencheurs et
  collation). Au premier démarrage, Codex applique les migrations de `drizzle/` et pose ses fonctions et déclencheurs,
  comme sur PGlite, puis l'amorce : **référentiel minimal par défaut** sur un serveur (`CODEX_SEED=demo` pour la
  démonstration).
- **Migrations au déploiement** : `npm run db:migrate` applique les migrations en attente avant de démarrer la nouvelle
  version (`-- --check` dit lesquelles, sans rien changer ; sur une base qui a des données, `-- --no-backup` une fois
  le `pg_dump` fait). Sans elle, le premier démarrage les applique, comme avant ([exploitation.md](exploitation.md) §7).
- **Connexions** : un pool de 10 connexions par processus (`CODEX_DB_POOL_MAX`, de 2 à 200).
- **Fichiers** : ils restent dans `CODEX_DATA_DIR/files` (ou SharePoint, O-01). Le dossier de données garde son verrou
  `codex.lock` : un second serveur Codex sur le même dossier est refusé.
- `.env.example` décrit les variables ; le contrôle de configuration refuse une `DATABASE_URL` qui n'est pas une
  adresse `postgres://` ([exploitation.md](exploitation.md)).

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

## Ce qui change

| Fonction | Avec PGlite | Avec un serveur PostgreSQL |
| --- | --- | --- |
| Sauvegarder maintenant (Administration) | archive Codex | refusé, avec un message : le serveur se sauvegarde avec ses outils (`pg_dump`, instantanés de l'hébergeur), les fichiers à part |
| `npm run backup`, `npm run restore` | archive Codex | refusés, avec un message (une archive Codex contient une base PGlite) |
| `npm run backup:list`, `backup:check`, `export:check` | — | inchangés (ils ne lisent que des archives) |
| Migration en attente sur une base qui a des données | sauvegarde automatique avant (au démarrage comme par `npm run db:migrate`) | refusée tant que `CODEX_MIGRATION_BACKUP=off` (ou `npm run db:migrate -- --no-backup`) n'est pas posé, une fois la sauvegarde du serveur faite |
| Export complet (Administration) | copie sous le verrou de l'unique connexion | copie en `REPEATABLE READ` sur une connexion gardée pour l'export ; les écritures continuent ([export.md](export.md)) |
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
  supprimée à la fin. L'utilisateur doit pouvoir créer des bases. Les tests de sauvegarde et de restauration restent
  sur PGlite (`setupDb({ engine: 'pglite' })`) : ils testent l'archive de PGlite.
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
- L'intégration continue lance `npm run test:pg` sur un service `postgres:18` (`.github/workflows/ci.yml`).
- Essai du 18 octobre 2026, fin du lot 9 : 101 fichiers, 1 364 tests réussis sur PostgreSQL 18.3, 3 sautés (premier
  essai de l'étape 3 : 79 fichiers, 1 172 tests, 2 sautés). L'un est le test de tri
  `codex_fr`, sauté quand l'ICU du serveur est plus ancien que celui de PGlite (Unicode antérieur à 16.0) : le serveur
  de l'essai (binaires `@embedded-postgres`, ICU 60) classe l'apostrophe droite avant l'apostrophe typographique, que
  l'ICU récent tient pour égales. Un serveur avec un ICU récent (Debian, Ubuntu actuels) est vérifié par ce test.

## Ce qui n'est pas fait

- **Sauvegarde du serveur** : `pg_dump` (ou les instantanés de l'hébergeur), leur fréquence, leur lieu et leur
  restauration relèvent de l'hébergement (M22). Codex ne les lance pas.
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
