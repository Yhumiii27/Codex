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
| Migration en attente sur une base qui a des données | sauvegarde automatique avant | refusée tant que `CODEX_MIGRATION_BACKUP=off` n'est pas posé, une fois la sauvegarde du serveur faite |
| Export complet (Administration) | copie sous le verrou de l'unique connexion | copie en `REPEATABLE READ` sur une connexion gardée pour l'export ; les écritures continuent ([export.md](export.md)) |
| `npm run export`, `npm run integrity` | serveur arrêté | refusés, avec un message : passer par l'Administration (export complet, intégrité des fichiers) |
| `npm run registry:apply` | sauvegarde avant `--apply` | travaille sur le serveur ; `--apply` y demande `--no-backup`, à donner une fois la sauvegarde du serveur faite ; serveur Codex arrêté recommandé, non vérifié |
| Requêtes simultanées | une à la fois (une connexion) | en parallèle sur le pool |
| Niveau d'isolation | sans objet (une connexion) | `READ COMMITTED` (défaut de PostgreSQL) |

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
  seul document ; « Sauvegarder maintenant » est refusé.
- Mesure : 1 000 créations de documents (tirage du compteur et écriture, chacune dans sa transaction) : 2,7 s une à
  une sur PGlite comme sur le serveur ; envoyées toutes à la fois, 3,0 s sur PGlite (une connexion) et 1,15 s sur le
  serveur (pool de 10), sans doublon.
- L'intégration continue lance `npm run test:pg` sur un service `postgres:18` (`.github/workflows/ci.yml`).
- Essai du 18 octobre 2026 : 79 fichiers, 1 172 tests réussis sur PostgreSQL 18.3, 2 sautés. L'un est le test de tri
  `codex_fr`, sauté quand l'ICU du serveur est plus ancien que celui de PGlite (Unicode antérieur à 16.0) : le serveur
  de l'essai (binaires `@embedded-postgres`, ICU 60) classe l'apostrophe droite avant l'apostrophe typographique, que
  l'ICU récent tient pour égales. Un serveur avec un ICU récent (Debian, Ubuntu actuels) est vérifié par ce test.

## Ce qui n'est pas fait

- **Sauvegarde du serveur** : `pg_dump` (ou les instantanés de l'hébergeur), leur fréquence, leur lieu et leur
  restauration relèvent de l'hébergement (M22). Codex ne les lance pas.
- **Migrations au déploiement** : elles s'appliquent encore au premier accès à la base, sous verrou. Une commande à
  lancer au déploiement reste à écrire si l'hébergement le demande.
- **Isolation** : les transactions qui relisent avant d'écrire n'ont pas été revues une à une pour `READ COMMITTED` ;
  celles qui étaient connues (compteurs, verrous de ligne, import) sont couvertes et testées.
- **Plusieurs processus** : possibles sur un serveur, mais les limites de débit sont en mémoire par processus, les
  fichiers locaux sont dans un dossier par serveur, et le verrou `codex.lock` refuse un second serveur sur le même
  dossier. Rien n'a été essayé derrière un répartiteur.
- **Serveur distant** : les mesures ont été faites sur la même machine ; un serveur distant ajoute un aller-retour
  réseau à chacune des 40 à 55 requêtes d'un écran ([performances.md](performances.md)).
- **Pilote** : node-postgres 8. Les requêtes envoyées en même temps sur une connexion (un `Promise.all` dans une
  transaction, permis par PGlite) sont mises en file par Codex lui-même, que node-postgres 9 n'acceptera plus.
