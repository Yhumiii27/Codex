# Codex — GED Groupe

Gestion électronique des documents du groupe, construite d'après la maquette Claude Design
(`design/GED Groupe.dc.html`, design system Nocturne dans `design/_ds/`).

Même socle que Keystone : **Next.js 16 (App Router) · React 19 · PGlite (Postgres embarqué) + Drizzle**. En
ligne, Codex utilise le serveur PostgreSQL commun EPC2I (décision M-01 : base `epc2i`, schéma `codex`, rôle
`codex_app`) ; PGlite reste la base locale et de repli (`DATABASE_URL`, `docs/postgres.md`).

## Démarrer

```bash
npm install
npm run dev        # http://localhost:3100
```

Au premier lancement, la base locale est créée dans `.data/` (migrations `drizzle/`) et remplie selon
`CODEX_SEED` (lu seulement sur une base vide) :
- `demo` (défaut, en développement comme dans l'app Mac) : le référentiel et les données de démonstration
  (personnes fictives, titulaires des fonctions, projets Keystone, programmes, recherches enregistrées, documents,
  circuits, demandes Vigie, journal) ;
- `minimal` : le référentiel seul (registre des types et des familles, fonctions de validation, matrice des droits,
  organisation provisoire, acteurs système Codex, Keystone, Vigie) et un administrateur initial, « Administrateur
  Codex » (gestionnaire documentaire, droit Administrer), pour se connecter. C'est le mode d'une vraie installation :
  personnes, titulaires et projets viendront de l'administration, de l'organigramme (O-04) et de l'authentification
  (O-02). Exemple : `npm run db:reset && CODEX_SEED=minimal npm run dev`.

Les fichiers déposés sont stockés dans `.data/files/` (ou dans SharePoint, voir `src/lib/storage.ts`).

- Repartir de zéro : arrêter le serveur, `npm run db:reset`, relancer. `db:reset` n'efface pas les sauvegardes
  (`.data-backups/`, voir « Sauvegarde et restauration ») ni les exports complets (`.data-exports/`).
- **Schéma `codex`** (lot 11, décision M-01) : toutes les tables, fonctions et déclencheurs de Codex et le journal de
  ses migrations (`codex.__drizzle_migrations`) sont dans le schéma `codex`, sur le serveur commun comme dans PGlite.
  Les tables se déclarent avec `codex.table(…)` (`pgSchema` de `src/db/schema.ts`, jamais exporté : drizzle-kit
  écrirait un `CREATE SCHEMA` que `codex_app` ne peut pas exécuter).
  - Une base PGlite de cette branche d'avant le 22 octobre (tables dans `public`, migrations `0000_init` à
    `0005_index_acces_validations`) est **reprise au démarrage**, après la sauvegarde automatique : `public` devient
    `codex` avec ses données, puis `0001_partage` s'applique. Toute autre base dont les tables sont dans `public` (démo
    de `main` d'avant le 17 octobre, chaîne plus ancienne) est refusée avant toute écriture, avec le remède :
    `npm run db:reset` pour `.data`, ou suppression du dossier `pglite` quand `CODEX_DATA_DIR` est posé (app Mac :
    quitter l'app, supprimer `~/Library/Application Support/Codex/data/pglite` ; image : `rm -rf /data/pglite`). Les
    fichiers déposés restent.
- **Schéma : migrations incrémentales** (base figée le 22 octobre 2026). `drizzle/0000_init.sql` (tout le schéma) et
  `drizzle/0001_partage.sql` (prérequis du partage générés par drizzle-kit, puis 7 vues `pub_` lues par Keystone,
  Vigie et Matrix, écrites à la main d'après `infra/postgres/partage/40-codex.sql` du dépôt Matrix) sont figées ;
  chaque changement de `src/db/schema.ts` ajoute une migration, jamais n'en réécrit une. Une vue `pub_` ne perd ni ne
  renomme de colonne (sinon nouvelle vue `_v2`) :
  1. `npm run db:generate -- --name <sujet>` écrit `drizzle/NNNN_<sujet>.sql` ; la relire (un renommage de colonne
     est demandé par drizzle-kit ; une reprise de données se complète à la main dans le SQL avant le commit) ;
  2. `npm run db:check` (dossier `drizzle/` cohérent) et `npm test` (`tests/integration/migrations.test.ts` : le schéma
     a sa migration, et la chaîne de migrations donne exactement la structure du schéma) ;
  3. au démarrage suivant, Codex sauvegarde la base et ses fichiers (archive de « Sauvegarde et restauration », entrée
     « Sauvegarde créée » au journal), puis applique les migrations manquantes en une seule transaction : un échec
     laisse la base intacte. Une base faite par un autre schéma (migration inconnue, modifiée ou sautée) est refusée
     avant toute écriture (`src/db/migrations.ts`). Pas de `db:reset`. `CODEX_MIGRATION_BACKUP=off` migre sans
     sauvegarde (déconseillé).
  - Au déploiement, `npm run db:migrate` les applique avant de démarrer (`-- --check` dit lesquelles sont en
    attente ; même sauvegarde, journalisée ; serveur arrêté ; `docs/exploitation.md` §7) ; sans elle, le démarrage
    le fait.
  - Retour arrière : arrêter le serveur, revenir à la version précédente de Codex (git), `npm run restore --
    <archive> --replace` avec l'archive écrite avant la migration.
  - Les fonctions et déclencheurs de la base (journal en ajout seul, version des documents, termes de recherche)
    ne passent pas par les migrations : `openDb()` (`src/db/index.ts`) les repose à chaque démarrage.
- **Registre : appliquer une évolution de `src/db/registry.ts` à une base existante** (serveur arrêté) :
  ```bash
  npm run registry:apply                # simulation : écarts entre le registre du code et la base, rien n'est écrit
  npm run registry:apply -- --apply     # sauvegarde, puis applique et journalise chaque changement (acteur Codex)
  ```
  Familles et types de `src/db/registry.ts`, fonctions de validation de `src/db/seed-org.ts`. Ce que
  l'Administration a réglé, d'après le journal, l'emporte : un champ modifié y garde sa valeur ; une entrée créée,
  renommée ou supprimée y reste telle quelle. Mêmes règles que l'administration du registre : aucun code n'est
  renommé ni réutilisé, un type absent du registre est désactivé (jamais supprimé), un nouveau code qui serait déjà un
  département, un projet, un programme ou `QMS` est refusé, les documents suivent la famille de leur type, un réglage
  qui exclurait des documents existants (origine, rattachement, confidentialité) est laissé à confirmer dans
  l'administration, une fonction qui a des titulaires garde sa portée, les documents gardent leur durée de
  conservation. Refusée tant que la base n'a pas les migrations du code (démarrer Codex une fois). Avec
  `DATABASE_URL`, elle travaille sur le serveur PostgreSQL ; Codex ne sachant pas le sauvegarder, `--apply` y demande
  `--no-backup`, à donner une fois la sauvegarde du serveur faite (`pg_dump`). App Mac :
  `CODEX_DATA_DIR="$HOME/Library/Application Support/Codex/data" npm run registry:apply`, app quittée.
- **Cahiers de validation du registre et de l'organigramme** (O-04 à O-08 ; mode d'emploi :
  `docs/registre-points-ouverts.md`, « Valider le registre avec le cahier ») : sans base ni serveur, rien n'est écrit
  ailleurs que dans le dossier donné à `--out`.
  ```bash
  npm run registry:review -- --out <dossier>          # types.csv (69 types) et fonctions.csv, réponses vides
  npm run registry:review -- --check <cahier.csv>     # contrôle un cahier rempli, écart avec le code (--org <csv> en plus)
  npm run org:check -- <organigramme.csv>             # modèle docs/modeles/organigramme.csv : règles, doublons, collisions
  ```
- **Serveur PostgreSQL commun** (`docs/postgres.md`) : `DATABASE_URL=postgres://codex_app:…@hôte:5432/epc2i` fait
  travailler Codex sur ce serveur (PostgreSQL 16 au moins, ICU, `pg_trgm` installé par son superutilisateur) au lieu
  de PGlite, avec les mêmes migrations, fonctions et déclencheurs, dans le schéma `codex`. Sans cette variable, rien ne
  change (développement, démonstration, app Mac).

  | `DATABASE_URL` | Base | Remplissage d'une base vide |
  | --- | --- | --- |
  | absente ou vide | PGlite dans `$CODEX_DATA_DIR/pglite` (développement, app Mac) | `CODEX_SEED`, `demo` par défaut |
  | `postgres://codex_app:…@hôte:5432/epc2i` | serveur commun EPC2I, schéma `codex` | seulement sur demande : `CODEX_SEED=minimal`, `CODEX_SEED=demo` ou `CODEX_SEED_DEMO=1` ; sinon la base reste vide et chaque page mène à `/base-vide`, qui dit quoi poser |

  Sur le serveur, le schéma, le rôle `codex_app` (aucun droit `CREATE` sur la base, aucun accès hors de `codex`) et les
  droits des lecteurs des vues `pub_` (`partage/90-droits.sql`) sont posés par le socle (dépôt Matrix,
  `infra/postgres/`) ; Codex ne crée jamais de schéma. Le pool fixe `search_path=codex` et `application_name=codex`
  (`CODEX_DB_POOL` connexions, 10 par défaut). `next build` n'ouvre jamais le serveur. Les écritures concurrentes
  passent par des verrous de ligne en READ COMMITTED (compteurs d'identifiants, `docs/postgres.md`), sans le verrou
  d'écriture global `codex.ecritures` de la première bascule. La sauvegarde et la restauration de Codex, et les
  commandes `npm run export` et `integrity`, ne travaillent que sur PGlite et refusent avec un message ; l'export
  complet et le contrôle d'intégrité restent possibles depuis l'Administration ; le serveur se sauvegarde avec ses
  outils (`pg_dump`, `infra/postgres/sauvegarde/` de Matrix). `npm run test:pg` rejoue toute la suite sur un serveur
  (`CODEX_TEST_DATABASE_URL`), chaque fichier de test dans une base disposée comme le socle.
- **Volume et mesures** (`docs/performances.md`) : `npm run seed:large -- --docs 10000` remplit une base de test à
  part (`.data-large/` par défaut, ou `--data-dir`, ou `--database-url` ; jamais la base de démo, et une base qui a
  déjà des documents est refusée sans `--append`) ; `npm run perf` mesure les écrans et routes principaux d'un serveur
  lancé (`npm run start` avec `CODEX_DATA_DIR=.data-large` ou `DATABASE_URL`, et `CODEX_RATE_LIMIT=off`).
- Contrôles : `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` (sans accès réseau : la police Inter
  est dans `src/fonts/`, servie par `next/font/local`, licence OFL dans `src/fonts/inter/OFL.txt`), puis
  `npm run a11y` (accessibilité : axe-core dans Chromium sur les écrans et dialogues principaux du build, base de démo
  jetable ; `-- --narrow` les rend aussi à 320 px et à 1 280 px zoomé à 200 % et relève débordements, contenus
  inatteignables, tronqués ou superposés, sans faire échouer ; `docs/accessibilite.md`) et `npm run e2e` (parcours de bout en bout dans Chromium, même build, base de démo
  jetable, jeton d'import tiré pour ce serveur seul ; cinq parcours indépendants : **approbation** (document créé avec
  son PDF, aperçu paginé téléchargé une fois, chaque étape approuvée par son titulaire, document en vigueur),
  **rejet** (étape rejetée avec son motif, nouvelle version de travail, nouvelle demande), **rappel** (demande rappelée
  par son demandeur), **vigie** (demande de modification acceptée par la simulation Vigie : révision suivante ouverte ;
  une deuxième, acceptée pendant sa rédaction, greffée ; une troisième, pendant sa validation, en attente, D-26) et
  **import** (`POST /api/import?dryRun=1` puis import réel, même identifiant, document vu dans l'app, brouillon importé
  vu de son seul propriétaire) ; chacun vérifie qu'une personne hors du cercle de rédaction ne voit pas le brouillon
  (D-14) ; 75 s environ ; `-- --only rejet,rappel` pour certains parcours, `CODEX_E2E_SHOTS=<dossier>` garde une
  capture de l'aperçu et de l'écran d'un parcours en échec).
- Intégration continue GitHub Actions (`.github/workflows/ci.yml`) : `npm ci`, `npm run deps:audit`, `npm run db:check`
  puis ces contrôles, `npm run a11y` et `npm run e2e` compris (après `npx playwright-core install --with-deps
  chromium`), sous la version de référence de Node (`.nvmrc` : 22), à chaque push et PR ; `npm run test:pg` sur un
  service PostgreSQL 16 et sur un service PostgreSQL 18 ; et `npm test` sous Node 20.19, la plus basse que `engines` admet (`@types/node` suit la
  version de référence).
- Version de Node : `engines` de package.json (`^20.19.0 || >=22.12.0`), version de référence dans `.nvmrc` (22),
  `@types/node` en `^22.12.0` ; `node scripts/codex-node-check.mjs` dit si le Node lancé convient (l'app Mac le vérifie).
- Vulnérabilités connues : `npm run deps:audit` (`scripts/codex-audit.mjs`, deux passages de `npm audit`) échoue sur un
  avis de gravité élevée ou critique dans les dépendances de l'application, et dans les outils de développement sauf
  avis accepté dans le script, avec sa raison (aujourd'hui `braces`, outil de lint sans version corrigée publiée) ; les
  avis modérés sont listés sans échec.
- Tests : `npm test` lance Vitest une fois (`npm run test:watch` en continu), en une à deux minutes selon la machine,
  sans serveur ni réseau et sans toucher à `.data/`.
  - `tests/unit/` : règles pures (identifiants, révisions, visibilité, conservation, recherche, filtres mis en avant
    des départements, dates, expiration et revue périodique, modifications simultanées, types de fichiers, formats,
    contenu (ZIP, fichiers composés OLE2, macros) et taille admis, analyse antivirus contre un faux clamd local,
    limites de débit, en-têtes de sécurité et `src/proxy.ts`, plages d'octets et requêtes conditionnelles, tri des
    fichiers orphelins, noms et rotation des sauvegardes, lecture d'une archive altérée, verrou du dossier de données,
    journal technique sans secret, contrôle de la configuration au démarrage, archive ZIP de l'export complet écrite
    en flux et relue, Zip64 compris, noms des colonnes et des fichiers, métadonnées d'import d'un document).
  - `tests/integration/` : règles métier sur une base PGlite en mémoire, migrée depuis `drizzle/` avec les
    déclencheurs du journal, de la version et des termes de recherche des documents (`openDb` dans `src/db/index.ts`)
    et remplie de données minimales (`tests/support/fixtures.ts`), pas de la base de démo. Identifiants et compteurs,
    révisions et dates d'effet, cohérence des dates, expiration et revue périodique, circuits, décisions Vigie et
    webhook, journal en ajout seul et ses pages, cercle de rédaction, import, recherche, recherches enregistrées, pages
    par département, modifications simultanées et limites de débit des routes et des actions (429), fichiers servis
    en flux (206, 416, 304, HEAD), nettoyage des fichiers orphelins, sauvegarde et restauration (archive écrite,
    relue, altérée, restaurée sur disque puis rouverte, retour arrière, commandes npm lancées comme par l'exploitant),
    export complet (archive relue, empreintes et comptes comparés à la base, instantané, droits, interruption, réimport
    d'un document par l'import, commande npm), route de santé et journal technique des routes et des actions, rendu
    de la page d'aide et de la coquille des écrans (lien d'évitement, titre de niveau 1, navigation) en français et en
    anglais. La visibilité en SQL, la recherche et l'explorateur lus par la base
    sont comparés à leur version en mémoire, qui reste la référence (`access-sql`, `search-sql`, `tests/support/`).
    `tests/integration/dates.test.ts` et `seed-sql.test.ts` chargent aussi les données de démo (`src/db/seed.ts`), en
    mémoire, pour en vérifier toutes les dates et y refaire ces comparaisons.
    Les Server Actions y tournent avec `next/headers` et `next/cache` simulés (`tests/support/session.ts`) ;
    l'horloge est figée au 10 octobre 2026. Les compteurs de débit sont vidés avant chaque test
    (`tests/support/setup.ts`).
  - Limite : PGlite n'a qu'une connexion et exécute les transactions l'une après l'autre. Les tests d'attributions
    « simultanées » (`Promise.all`) y vérifient l'absence de doublon sous cet entrelacement. `npm run test:pg`
    (`CODEX_TEST_DATABASE_URL`, une base neuve par fichier de test sur un serveur PostgreSQL 16 ou plus récent) rejoue toute la suite
    sur un serveur, où ces tests deviennent de vraies courses entre connexions, et `postgres-server.test.ts` y tient
    des transactions ouvertes en même temps : compteur attendu, numéro rendu par une transaction annulée, max + 1
    pris en défaut, imports un par un. Sur PGlite, ce fichier est sauté.
  - Version de Node : la recherche en base replie les textes (accents, casse) et trie les titres avec les tables
    Unicode et ICU de PGlite (Unicode 16.0, ICU 76), la version en mémoire qui lui sert de référence avec celles de
    Node (Node 22 : Unicode 16.0, ICU 77 ; Node 26 : Unicode 17.0, ICU 78). La base replie la requête comme les
    valeurs qu'elle garde : elle reste cohérente avec elle-même sous toute version de Node. `search-sql.test.ts`
    compare les deux replis sur les points de code que les deux versions d'Unicode attribuent, et les deux tris : il
    passe sous Node 22 et sous Node 26 (vérifié avec Node 26.11.1). Un caractère ajouté par Unicode 17.0 peut être
    replié autrement par la référence en mémoire que par la base.

Variables : voir `.env.example` (Keystone, Vigie, dossier de données et de sauvegardes, base, Matrix, jetons de l'API
d'intégration, HTTPS, proxy de confiance, limites de débit, journal technique, contrôle de la configuration). Aucune
n'est nécessaire en local : sans elles, les limites de débit gardent des valeurs généreuses, HSTS reste coupé,
`X-Forwarded-For` n'est pas tenu pour fiable et le contrôle de la configuration ne trouve aucune erreur. Elles sont
vérifiées à chaque démarrage (voir « Exploitation »).

Le modèle fonctionnel fait foi dans `docs/modele-cible.md` ; l'API d'intégration est décrite dans `docs/api.md`.

## Application Mac

```bash
npm run app
```

Construit `Codex.app` (fenêtre native macOS, sans Electron), l'installe dans `~/Applications` et dépose un alias
« Codex » sur le bureau. L'app :
- lance le serveur de production de ce projet sur `http://127.0.0.1:3110` (recompilé automatiquement si le code a
  changé depuis la dernière build) et l'arrête quand on quitte l'app — y compris si l'app plante ;
- garde ses données à part du serveur de développement : `~/Library/Application Support/Codex` (base et fichiers),
  journal dans `~/Library/Logs/Codex/server.log` (menu Présentation › Afficher le journal du serveur), une entrée JSON
  par ligne comme tout serveur de production (`CODEX_LOG_FORMAT=pretty` dans `.env.local` du projet pour des lignes lisibles) ; un refus de la
  configuration au démarrage (« Le serveur s'est arrêté au démarrage. ») y est expliqué (voir « Exploitation ») ;
- ouvre les liens Keystone / Vigie dans le navigateur, enregistre les téléchargements dans `~/Téléchargements`.
- n'embarque pas d'outil de conversion : pour l'aperçu des fichiers Office, installer LibreOffice sur le Mac et écrire
  `CODEX_PREVIEW_SOFFICE=/Applications/LibreOffice.app/Contents/MacOS/soffice` dans `.env.local` (`docs/exploitation.md`
  §6).

L'app pointe vers ce dossier de projet et vers le Node.js présents au moment de la construction : relancer
`npm run app` après un déplacement du projet ou un changement de Node. Pour repartir d'une base de démo neuve :
quitter l'app et supprimer `~/Library/Application Support/Codex/data`. Une mise à jour du code qui apporte une
migration n'en demande pas : l'app sauvegarde sa base puis la migre au démarrage suivant (voir « Démarrer »).

## Écrans

| Route | Écran |
| --- | --- |
| `/` | Tableau de bord : « À traiter » (étapes à décider, révisions à rédiger ou à reprendre, greffes possibles, revues et expirations des documents dont on est propriétaire ou propriétaire de processus), documents récents, échéances (conservation, expiration, revue), activité. La pastille d'Accueil et la cloche reprennent la même liste |
| `/explorateur` | Classement par famille, département, projet / programme, type ou origine ; filtres de statut et d'échéance dépassée (« Expirés », « Revues en retard ») ; 50 documents par page ; aperçu rapide ; « Déposer un fichier » et « Nouveau » préremplis avec le département, la famille ou le type choisis dans l'arbre |
| `/documents/[id]` | Fiche document : aperçu, onglets Projet · Fiche · Révisions · Validation · Demandes · Historique (onglet Projet : phases Keystone en frise compacte, la phase courante nommée ; sans projet, « Rattacher à un projet » pour le propriétaire ou un gestionnaire) ; « Restaurer » une version de travail antérieure du brouillon (onglet Révisions) ; indicateurs « Expiré » (raccourcis vers les demandes de modification et de retrait) et « Revue en retard », « Revue effectuée » ; documents liés (« Remplace », « Remplacé par », « Voir aussi »), remplacement proposé avec une demande de retrait et rappelé dans le bandeau d'un document obsolète ; fiche de visa (PDF) de chaque révision approuvée, dans l'onglet Révisions |
| `/recherche` | Recherche dans les métadonnées (identifiant et anciens identifiants, titre, mots-clés, référence externe, ID d'étude, type, sous-type, organisme source, propriétaire, auteur ; pas dans le contenu des fichiers), sans accents ni casse, classée par pertinence + facettes (projet, famille, type, sous-type, origine, rattachement, département, site, propriétaire, auteur, statut, échéance dépassée, confidentialité, langue, mots-clés, organisme source, phase, lot, discipline, thème), période sur une date (modification, émission, effet, révision, expiration), tri au choix, 50 résultats par page, export CSV de tous les résultats dans le même ordre ; recherches enregistrées (critères, période et tri) personnelles, ou partagées avec un département ou le groupe par un gestionnaire documentaire |
| `/departements/[code]` | Page d'un département (`/departements` ouvre celui de l'utilisateur, un sélecteur passe aux autres) : documents en vigueur, échéances, circuits en cours qu'il suit, recherches partagées avec le département et le groupe, filtres mis en avant (valeurs les plus fréquentes, chacune un lien vers la recherche filtrée), le tout limité à ce que l'utilisateur peut lire. Départements provisoires (organigramme attendu) ; filtres par défaut (type, statut, projet), réglables par département dans Administration › Organisation, en attendant le recueil des besoins de chaque métier |
| `/validations` | Circuits de validation : à valider, mes demandes, en cours, terminées (comptés et listés par la base, par pages de 50) ; approuver / rejeter (motif obligatoire) / déléguer, rappeler sa demande avant la dernière approbation, commentaires ; un gestionnaire documentaire réassigne l'étape en cours détenue par une autre personne (mêmes règles qu'une délégation). Vue « Mes demandes Vigie » : demandes de modification et de retrait envoyées par l'utilisateur, avec leur statut |
| `/archivage` | Échéances (archivage, gel juridique, revue effectuée ; filtres « Expirés » et « Revues en retard »), règles de conservation du registre, archives |
| `/administration` | Registre des types (création et modification complète des types et des familles, dont la périodicité de revue), fonctions & circuits (fonctions, titulaires, programmes de recherche), rôles & droits, organisation (départements et sites : ajout, renommage FR/EN, désactivation ou suppression d'une valeur inutilisée ; filtres mis en avant des départements), vocabulaires (organismes sources et mots-clés : ajout, renommage, fusion de doublons, valeurs sans terme ; sous-types hors de la liste de leur type, à ajouter au registre), reprise des responsabilités d'une personne qui part (simulation puis transfert journalisé à un remplaçant choisi : propriété de documents et de processus, auteur désigné, étapes en attente, titulariats, lecteurs désignés ; gestionnaires documentaires), modèles (QMS), leurs types cibles et leurs utilisations (documents créés depuis chacun, parmi ceux que le lecteur peut lire), journal d'audit (filtres par document ou cible, personne, action et période ; 100 entrées par page ; export CSV complet), sauvegardes, planificateur (tâches, dernière et prochaine exécution), export complet de toutes les données et de tous les fichiers (archive ZIP, gestionnaires documentaires) |
| `/aide` | Aide, en français et en anglais, ouverte à tous les rôles (lien « Aide » au-dessus de « Notes de conception » dans la barre latérale) : les parcours courants pas à pas (créer un document, déposer et restaurer une version de travail, demander une validation, valider, rejeter ou déléguer, demander une modification ou un retrait à Vigie, comparer, confidentialité, recherche), avec ce qui est simulé ; un lien vers l'écran où chaque parcours commence, si le rôle y a accès |

API : `/api/registry` (lu par Keystone), `/api/import` (outil de migration ; `?dryRun=1` simule sans rien
enregistrer), `/api/integrations/vigie` (décisions Vigie), `/api/documents/[id]/file` (fichier d'une version de
travail), `/api/documents/[id]/approval?rev=B` (fiche de visa d'une révision approuvée, PDF tiré du journal),
`/api/export/search` et `/api/export/audit` (CSV), `/api/export/full` (export complet, archive ZIP :
`docs/export.md`). Entre serveurs : jeton et/ou signature HMAC
(horodatage, anti-rejeu, rotation par `…_NEXT`) pour l'import et le webhook Vigie, registre ouvert sauf
`CODEX_REGISTRY_TOKEN` (`docs/api.md`, « Authentification »).

Tout l'état d'écran est dans l'URL (onglets, filtres, sélection) : les liens sont partageables. Chaque écran a son
titre d'onglet dans la langue choisie (« Recherche — Codex », « {ID} · {titre} — Codex » pour une fiche lisible, « Fiche
document — Codex » sinon).

## Ce qui est réel / simulé

- **Persisté** : création codifiée (`TYPE-CONTEXTE-SEQ`, depuis un modèle, un fichier ou sans fichier), versions de
  travail (A.1, A.2…), métadonnées (auteur : une personne ou un texte libre ; dates contrôlées : format, et
  émission ≤ effet < expiration) et reclassement (nouvel identifiant tant qu'aucune révision n'a été approuvée),
  lecteurs désignés, demandes de validation et décisions (mise en vigueur à l'approbation ou à la date d'effet),
  délégation, commentaires, demandes de modification et de retrait, revue périodique (« Revue effectuée », qui fixe la
  prochaine date de revue sans créer de révision), archivage, gel juridique, matrice des droits, registre des types
  (création, modification et suppression des types, familles et fonctions : code, libellés FR/EN, famille, origines et
  rattachements admis, sous-types, circuit, confidentialité, conservation et son fondement, périodicité de revue, clause
  ISO, livrable client, actif), programmes de recherche (code, libellé, responsable, actif), titulaires des fonctions,
  départements (et filtres mis en avant sur leur page) et sites (libellés FR/EN, actif). Une entrée du registre utilisée
  garde son code et ne se supprime pas : un type ou un programme utilisé se désactive (`docs/api.md`, `GET
  /api/registry`) ; de même un département ou un site utilisé, qui n'est plus proposé à un nouveau document mais reste
  sur ceux qui l'ont. Le code d'un département ne change jamais. L'expiration et la revue en retard sont des indicateurs, sans nouveau statut : le
  retrait reste une demande à Vigie. Métadonnées, lecteurs désignés, versions de travail et demandes de validation
  refusent une action faite depuis une fiche périmée (« modifié entre-temps par … ; rechargez la fiche »), sans
  réserver le brouillon.
  Chacune de ces actions alimente le journal d'audit, de même que les téléchargements et les deux exports CSV. Le
  journal est en ajout seul : la base refuse toute modification ou suppression (déclencheur posé au démarrage,
  `src/db/index.ts`), et un reclassement ne réécrit pas les entrées, qui gardent l'identifiant de leur époque.
  L'horodatage est stocké en UTC et affiché à l'heure de Paris. Les consultations le sont aussi : ouverture de la fiche
  (« Consultation de la fiche ») et fichier affiché dans l'aperçu (« Consultation du fichier »), une entrée par
  personne, document et version toutes les 30 minutes au plus ; une plage d'octets au-delà du début du fichier et une
  requête HEAD n'en écrivent pas. Elles suivent la révision qu'elles concernent (D-14), restent hors des flux
  d'activité et se lisent à part : onglet Historique de la fiche (« Activité », « Métadonnées » avec l'avant et
  l'après, « Consultations ») et filtre par action de l'onglet Journal. Ne sont pas journalisés : le changement
  d'utilisateur ou de langue simulé, la création et la suppression d'une recherche enregistrée (des critères, jamais
  des documents).
- **Utilisateur et rôle simulés** (pas d'authentification pour l'instant) : cliquer sur le profil en bas de la
  barre latérale. La navigation suit les règles de la maquette (validations masquées pour l'auditeur, archivage
  masqué pour le collaborateur, administration réservée au gestionnaire), les actions vérifient la matrice des
  droits côté serveur et la visibilité suit `src/lib/access.ts` (confidentialité, cercle de rédaction).
- **Keystone simulé** : les projets (phase, client, pièces attendues, événements) viennent de tables locales, lues
  par `src/lib/keystone.ts`, seul fichier à remplacer par des appels API quand Keystone exposera les siennes.
- **Vigie simulé** : les demandes de modification (ECR) et de retrait sont enregistrées par `src/lib/vigie.ts` ; tant
  que `VIGIE_API_URL` n'est pas défini, un gestionnaire documentaire simule la décision depuis l'onglet Demandes.
  Le webhook `/api/integrations/vigie` applique les décisions réelles.
- **Aperçu** : un PDF, une image PNG, JPEG, GIF ou WebP, ou un fichier texte déposés s'affichent dans la fiche ; les
  autres formats se téléchargent. Les documents de démonstration (sans fichier) gardent la page maquette et se
  téléchargent sous forme d'un PDF généré. Les fichiers Word, Excel, PowerPoint et OpenDocument s'affichent en PDF
  quand un service de conversion est configuré (voir « Aperçu des fichiers Office et comparaison des versions ») ;
  sans lui, « Aperçu indisponible » et le téléchargement, comme avant.
- **Restaurer** (onglet Révisions) : une version de travail antérieure de la révision en brouillon (A.1) devient la
  suivante (A.4, commentée « Restaurée depuis A.1 »), son fichier recopié et contrôlé comme un dépôt ; mêmes droits et
  refus que « Nouvelle version de travail ». Revenir à une révision en vigueur reste une demande de modification à
  Vigie (D-16).
- **Bilingue** : libellés FR/EN des départements, des sites, des types et du fondement de conservation (anglais saisi
  dans Administration › Registre des types ; vide, le français s'affiche suivi de « (FR) ») ; phases Keystone en
  anglais (libellés provisoires, à aligner sur Keystone) ; détail du journal enregistré en code et paramètres et
  rendu dans la langue du lecteur, à l'écran et dans l'export CSV, pour les entrées écrites depuis le 18 octobre 2026
  (les plus anciennes gardent leur texte : le journal n'est jamais réécrit).
- **Comparer** (onglet Révisions) : attributs des deux versions, puis leur texte comparé ligne à ligne (PDF, Word,
  Excel, PowerPoint, OpenDocument, texte), sans service externe.

## Sécurité HTTP et limites de débit

**En-têtes** (points 25 et 24 de `docs/reste-a-faire.md`) :
- Sur toutes les réponses (`next.config.ts`, valeurs dans `src/lib/security-headers.ts`) : `X-Content-Type-Options:
  nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` (les autres origines ne reçoivent jamais le chemin, qui
  nomme les documents), `X-Frame-Options: SAMEORIGIN`, `Permissions-Policy` (caméra, micro, géolocalisation, paiement,
  USB, Topics coupés). Plus d'en-tête `X-Powered-By`.
- Sur les pages, `Content-Security-Policy` posée par `src/proxy.ts`, avec un nonce tiré à chaque requête : Next.js le
  lit dans la politique et l'ajoute à ses propres scripts, qui sont les seuls admis (`'strict-dynamic'`, sans
  `'unsafe-inline'` pour les scripts). Styles du code et de React admis en ligne, police Inter auto-hébergée par
  `next/font`, images `data:` et `blob:`, cadre de même origine pour l'aperçu des fichiers, `frame-ancestors 'self'`
  (l'app Mac affiche Codex en page principale de sa vue web : aucune règle de cadre ne la concerne), `eval` admis en
  développement seulement (React). Les réponses de l'API (JSON, fichiers stockés) n'ont pas de politique : rien n'y
  s'exécute, et une politique sur un PDF peut empêcher la visionneuse du navigateur de l'afficher dans l'aperçu. La
  route fichier garde ses propres en-têtes (`Content-Disposition`, `nosniff`).
- `src/proxy.ts` ne voit pas non plus les appels de Server Actions (en-tête `Next-Action`) : leur réponse est un flux
  React, pas une page, et Next.js recopie en mémoire le corps de chaque requête que voit un proxy, coupé sans erreur
  au-delà de `experimental.proxyClientMaxBodySize` (10 Mo par défaut). Les dépôts de fichiers de 10 à 50 Mo échouaient
  sinon. Un formulaire envoyé avant l'hydratation de la page passe, lui, par le proxy : `next.config.ts` règle cette
  copie sur la limite des Server Actions (taille maximale d'un fichier plus 1 Mo, voir « Fichiers déposés »).
- `Strict-Transport-Security` (un an, cet hôte seulement) et `upgrade-insecure-requests` seulement avec
  `CODEX_HTTPS=1`, à poser quand Codex est servi en HTTPS derrière un proxy TLS. Coupés par défaut : en local et dans
  l'app Mac, Codex est en HTTP, et HSTS sur `localhost` imposerait HTTPS à toutes les applications locales (Keystone,
  Vigie).

**Limites de débit** (`src/lib/ratelimit.ts`) : un seau à jetons par famille et par clé. Une clé peut envoyer d'un coup
le nombre de requêtes de sa limite, puis en regagne une à intervalle régulier ; au-delà, **429** avec `Retry-After` (en
secondes), sans rien exécuter (ni import, ni lecture de fichier, ni export journalisé, ni écriture).

| Famille | Variable | Par défaut | Clé |
|---|---|---|---|
| `POST /api/import` (jeton vérifié) | `CODEX_RATE_IMPORT` | 600 par minute | adresse du client |
| `POST /api/integrations/vigie` (jeton vérifié) | `CODEX_RATE_VIGIE` | 600 par minute | adresse du client |
| Jetons refusés sur ces deux routes | `CODEX_RATE_TOKEN_FAILURES` | 20 par 15 minutes | adresse du client |
| `GET /api/registry` | `CODEX_RATE_REGISTRY` | 300 par minute | adresse du client, derrière un proxy de confiance seulement |
| Fichiers et fiches de visa (`/api/documents/[id]/file`, `/approval`) | `CODEX_RATE_FILES` | 600 par minute | utilisateur résolu ; et adresse derrière un proxy de confiance |
| Exports CSV et export complet (`/api/export/*`, GET et HEAD) | `CODEX_RATE_EXPORTS` | 30 par minute | utilisateur résolu ; et adresse derrière un proxy de confiance |
| Comparaison du contenu de deux versions (`/api/documents/[id]/compare`) | `CODEX_RATE_COMPARE` | 30 par minute | utilisateur résolu ; et adresse derrière un proxy de confiance |
| Server Actions qui écrivent (`src/lib/actions.ts`) | `CODEX_RATE_WRITES` | 120 par minute | utilisateur résolu |

- Valeur `N` (par minute) ou `N/<durée>` (`30s`, `1m`, `15m`, `1h`) ; `0` ou `off` lève une limite,
  `CODEX_RATE_LIMIT=off` les lève toutes. Une valeur illisible garde la valeur par défaut, avec un avertissement.
- Une action refusée affiche « Trop de demandes en peu de temps : réessayez dans N s. » ; les routes du navigateur
  répondent la même phrase en texte, les routes d'intégration en JSON (`docs/api.md`).
- **Une clé choisie par le client ne bloque jamais un tiers.** L'adresse du client est la dernière valeur de
  `X-Forwarded-For`. Sans proxy devant Codex, Next.js la pose d'après la connexion, sauf si le client l'envoie
  lui-même : il la choisit alors, y compris l'adresse d'un autre. Elle n'est donc tenue pour fiable qu'avec
  `CODEX_TRUST_PROXY=1`, à poser seulement si un proxy inverse écrit cet en-tête (le remplace, ou y ajoute l'adresse
  qu'il voit) et si Codex n'est joignable que par lui (`next start -H 127.0.0.1`, par exemple). Coupé par défaut :
  - les budgets d'import et de Vigie ne sont comptés qu'une fois le jeton vérifié : un tiers sans jeton ne peut pas
    épuiser celui de l'outil de migration ou de Vigie en se faisant passer pour leur adresse ;
  - les jetons refusés sont comptés par adresse, et au-delà du quota les jetons faux reçoivent 429 au lieu de 401 ; le
    bon jeton passe toujours. Un jeton de 32 octets aléatoires (`openssl rand -base64 32`) reste hors de portée. Avec
    `CODEX_TRUST_PROXY=1`, une adresse qui a épuisé son quota attend même avec le bon jeton, qui n'est plus comparé :
    le deviner ne va pas plus vite que la limite ;
  - le registre, sans jeton, n'est limité que derrière un proxy de confiance : ailleurs, n'importe qui pourrait
    épuiser le budget de Keystone ;
  - fichiers, fiches de visa et exports comptent par utilisateur **résolu** (`src/lib/context.ts`), jamais par la
    valeur brute du cookie : un cookie inconnu est l'utilisateur par défaut, et des cookies inventés partagent son
    budget. Derrière un proxy de confiance, un second seau par adresse plafonne aussi un client qui alternerait entre
    plusieurs comptes. Tant qu'il n'y a pas d'authentification (O-02), un client peut toujours se faire passer pour un
    autre utilisateur, et donc dépenser son budget.
- **Une seule instance** : les compteurs sont en mémoire, dans le processus du serveur ; PGlite impose déjà un seul
  processus (avec un serveur PostgreSQL, plusieurs processus pourraient partager la base, mais chacun aurait ses
  compteurs ; le verrou `codex.lock` du dossier de données en refuse un second sur le même dossier). Un redémarrage les remet à zéro. Avec plusieurs instances, chacune compterait de son côté (jusqu'à n fois
  la limite) : il faudrait alors un magasin partagé (Redis, ou une table de la base Postgres serveur, point 51) ou
  limiter au proxy inverse (`limit_req` de nginx, par exemple). Chaque famille garde au plus 10 000 clés, dans sa propre
  table : seuls les seaux redevenus pleins sont oubliés, et tant qu'aucun ne l'est, une clé nouvelle attend (429) plutôt
  qu'un seau entamé ne soit effacé.

## Fichiers déposés : formats, taille, antivirus

Point 32 de `docs/reste-a-faire.md` (et point 64 pour la taille). Tout fichier qui entre dans Codex passe par
`stageFile` (`src/lib/storage.ts`), quelle que soit sa voie : nouveau document, version de travail, copie d'un modèle,
import (`POST /api/import`). Il y est contrôlé puis analysé **avant** d'être écrit dans le stockage : un fichier refusé
ne laisse ni document, ni version, ni fichier.

- **Formats admis** (`src/lib/filetypes.ts`) : une liste blanche d'extensions, la même pour tous les types de document
  (la liste par type attend la question M12 de l'audit). Par défaut : PDF, Word, Excel, PowerPoint (et leurs modèles
  `.dotx`, `.xltx`, `.potx`), OpenDocument, RTF, texte, CSV, Visio, Project, courriels (`.msg`, `.eml`), images (PNG,
  JPEG, GIF, WebP, TIFF, HEIC), MP4, plans et maquettes (DWG, DXF, STEP, IGES, IFC, STL), JSON et XML. Les archives
  (`.zip`…) n'y sont pas. `CODEX_FILE_EXTENSIONS` remplace la liste entière ; les exécutables, scripts, pages web, SVG,
  images disque et extensions Office à macros (`.exe`, `.bat`, `.js`, `.ps1`, `.html`, `.hta`, `.svg`, `.iso`, `.docm`,
  `.xlsm`…) restent refusés même s'ils y figurent.
- **Nom** : le fichier est contrôlé, enregistré et servi sous un seul nom, le dernier segment de celui reçu, sans
  caractères de contrôle ni séparateurs, points ou espaces finaux (`procedure.hta/` devient `procedure.hta`, refusé ;
  `C:\fakepath\plan.pdf` devient `plan.pdf`). L'extension contrôlée est donc celle du fichier stocké et du
  téléchargement. Un fichier sans extension prend celle de son contenu (PDF), jamais celle du type annoncé à l'envoi.
- **Contenu** : un format courant doit avoir le contenu qu'annonce son extension : PDF, PNG, JPEG, GIF, WebP, TIFF, RTF,
  DWG, MP4 et HEIC par leur en-tête ; Office 97-2003, Project et Outlook par le répertoire de leur fichier composé
  (OLE2), qui doit se lire ; Word, Excel, PowerPoint et Visio (`.docx`…) par l'entrée `[Content_Types].xml` de leur
  ZIP, ou, chiffrés par un mot de passe ou une étiquette de confidentialité, par le flux `EncryptedPackage` de leur
  fichier composé ; OpenDocument par l'entrée `mimetype` ou `META-INF/manifest.xml` de leur ZIP. Un `.doc` peut aussi
  être du RTF, comme l'exportent d'anciens systèmes. Une archive ZIP quelconque renommée `.docx` ou `.odt` est donc
  refusée. Les formats texte et d'échange (TXT, CSV, DXF, STEP…) sont pris sur leur nom. Un programme (Windows, Linux,
  macOS) est refusé quel que soit son nom. Un fichier sans extension n'est admis que si son contenu désigne un format
  admis (un PDF, une image, un DWG).
- **Macros** : les extensions à macros (`.docm`, `.xlsm`…) sont toujours refusées, et les macros VBA le sont quelle
  que soit l'extension : partie `vbaProject.bin` d'un ZIP, flux `_VBA_PROJECT` d'un fichier composé (Word, Excel et
  Project 97-2003, message Outlook qui en embarque un). Ne sont pas détectées sans antivirus : les macros de PowerPoint
  97-2003 (compressées dans la présentation), les macros Excel 4.0, les macros Basic d'OpenDocument et ce que contient
  un fichier chiffré.
- **Taille maximale** : `CODEX_MAX_FILE_MB`, 50 Mo par défaut, la même pour toutes les voies (250 Mo au plus avec
  SharePoint). Elle règle aussi, au démarrage du serveur, la taille d'une requête de Server Action (`next.config.ts` :
  la limite plus 1 Mo pour les autres champs), si bien qu'un fichier trop gros reçoit un refus explicite et non
  l'erreur générique du framework. Elle remplace `CODEX_IMPORT_MAX_MB`, qui n'est plus lue.
- **Dans les dialogues** : le sélecteur de fichier propose les extensions admises (`accept`), affiche la taille
  maximale et dit tout de suite pourquoi un fichier sera refusé (extension, taille) ; le formulaire ne part pas avec
  lui. Le serveur refait tous les contrôles. Refus traduits en français et en anglais (`src/lib/i18n.ts`).
- **Antivirus** (`src/lib/antivirus.ts`) : avec `CODEX_CLAMD` (`hôte:port`, port 3310 par défaut, ou chemin du socket
  Unix), chaque fichier est envoyé à clamd par la commande `INSTREAM` avant d'être stocké. Un fichier infecté est
  refusé (« Fichier refusé : l'analyse antivirus a détecté … ») et journalisé (action « Fichier refusé (antivirus) »,
  visible dans l'onglet Journal d'audit de l'administration). Hors gestionnaires documentaires, l'entrée d'un dépôt à
  l'écran ne donne ni le nom du fichier, qui peut porter l'identifiant et la version d'un brouillon
  (`PRO-ING-0007_A.2.docx`), ni le document visé, mais la voie, l'extension, la taille et la menace (D-14) ; celle d'un
  import garde le nom et la référence ancienne. Si clamd ne répond pas (injoignable, délai `CODEX_CLAMD_TIMEOUT_MS` de
  30 s dépassé, erreur), le dépôt est refusé (« réessayez plus tard »), sauf avec `CODEX_CLAMD_ON_ERROR=accept`, qui
  l'accepte sans analyse en le notant dans le journal du serveur.
- **Limites de clamd** : elles doivent couvrir `CODEX_MAX_FILE_MB`. `StreamMaxLength` (au-delà, clamd coupe l'envoi) et
  `MaxFileSize` (au-delà, clamd répond « OK » **sans analyser**) valent 100 Mo par défaut depuis ClamAV 0.105, 25 Mo
  avant ; `MaxScanSize` (contenu décompressé) 400 Mo, 100 Mo avant. Réglez-les au moins à `CODEX_MAX_FILE_MB` et
  activez `AlertExceedsMax yes` : clamd signale alors un fichier qui dépasse `MaxFileSize`, `MaxScanSize` ou
  `MaxRecursion` (« Heuristics.Limits.Exceeded… ») au lieu de le dire sain. Codex refuse ce fichier, comme celui que
  clamd coupe, avec un message qui en donne la cause (limites de l'analyse antivirus à relever) et sans inviter à
  réessayer ; à l'import, 413 `scan_too_large`. `CODEX_CLAMD_ON_ERROR=accept` l'accepte sans analyse.
- **Fichiers déjà stockés** : ils ne sont ni recontrôlés ni réanalysés. Seule la copie d'un modèle refait les contrôles,
  puisque son fichier entre dans un nouveau document : un modèle déposé avant ce contrôle dans un format désormais
  refusé (`.dotm`, PDF nommé `.docx`…) n'est plus copiable, et le refus nomme le modèle et demande à son propriétaire
  d'en déposer une nouvelle version.
- **Sans `CODEX_CLAMD`** (usage local, app Mac), rien n'est analysé : le journal du serveur le dit au premier dépôt
  (`[antivirus] scanning off`) et l'onglet Journal d'audit de l'administration l'affiche au-dessus des filtres, avec la
  taille maximale et le nombre de formats admis. Pour essayer en local : `docker run -p 3310:3310 clamav/clamav`, puis
  `CODEX_CLAMD=127.0.0.1:3310 npm run dev`. Les tests utilisent un faux clamd et le fichier de test EICAR
  (`tests/support/clamd.ts`).

## Fichiers servis et nettoyage du stockage

Points 46 et 36 de `docs/reste-a-faire.md`.

- **En flux** : `/api/documents/[id]/file` lit le fichier stocké par morceaux (`createReadStream` en local ; corps de
  la réponse de Graph pour SharePoint), sans le charger en mémoire. Les contrôles d'accès, le cercle de rédaction
  (D-14), les suffixes `_OBSOLETE` et `_ARCHIVE`, la limite de débit et la journalisation des téléchargements passent
  avant, comme auparavant. La fiche de visa (`/approval`), construite en mémoire (quelques Ko) et journalisée à chaque
  demande, reste envoyée entière ; les exports CSV étaient déjà écrits en flux.
- **Plages (`Range`)** : `Accept-Ranges: bytes` ; une plage (`bytes=0-99`, `bytes=100-`, `bytes=-500`) reçoit 206 avec
  `Content-Range` ; une plage qui commence au-delà du fichier ou mal formée reçoit 416 avec `Content-Range: bytes */taille`.
  Une autre unité ou plusieurs plages reçoivent le fichier entier (200). `If-Range` (ETag ou date) fait renvoyer le
  fichier entier quand il a changé. `HEAD` donne les en-têtes de GET (taille entière, ETag, 304), sans corps ni plage.
  Règles dans `src/lib/ranges.ts`.
- **ETag, Last-Modified, 304** : l'ETag est calculé (empreinte) sur la version de travail, sa taille et sa date, et sur
  le nom servi (identifiant, révision, état), Last-Modified vient du fichier local. Le navigateur ne garde une copie
  (`Cache-Control: private, no-cache`, revalidée à chaque usage, donc droits contrôlés à chaque fois) que du fichier
  final de la révision en vigueur, sous le niveau Confidentiel : changer de page dans l'aperçu ne retélécharge plus
  le PDF (304). Brouillons, fichiers confidentiels et très confidentiels et téléchargements explicites
  (`?download=1`) restent en `no-store`, envoyés en entier à chaque fois. L'aperçu paginé télécharge le fichier une
  fois, en garde une copie en mémoire (adresse `blob:`, ni cache ni historique, libérée quand la fiche se ferme) et
  change de page sur elle (`useLocalCopy`, `src/app/documents/[id]/DocClient.tsx`) : un brouillon de P pages n'est
  plus téléchargé P fois (point 46 ; `frame-src 'self' blob:`). `no-transform` empêche la compression, qui
  fausserait les plages.
- **Téléchargements journalisés** : un téléchargement (`?download=1`) est inscrit au journal quand la réponse part du
  premier octet (200, ou 206 à partir de 0) ; une reprise (plage plus loin), un 416 ou un HEAD ne le sont pas.
- **Fichiers orphelins** (`src/lib/orphans.ts`) : fichiers du stockage qu'aucune version de travail ne référence
  (arrêt du serveur entre le dépôt et l'enregistrement, renommage inachevé). Dans **Administration › Journal
  d'audit**, un gestionnaire documentaire (seul à voir les noms stockés, qui portent l'identifiant et la version des
  brouillons) clique sur « Rechercher » (`?tab=audit&orphans=1`) : c'est une **simulation**, qui liste sans rien
  supprimer. « Supprimer ces fichiers » retire ensuite, du stockage local, les fichiers que cette liste montre et
  eux seuls (200 au plus par passage, les plus anciens d'abord) : un orphelin apparu depuis attend la recherche
  suivante. Chacun est revérifié juste avant (toujours sans référence, toujours ancien) ; un fichier qui ne l'est plus
  est laissé en place et compté dans le message. La suppression est
  inscrite au journal (« Fichiers orphelins supprimés », cible « Stockage des fichiers · local », avec nom, taille et
  date de chaque fichier) et dans le journal du serveur (`[orphans] removed …`).
  - Délai de grâce `CODEX_ORPHAN_GRACE_HOURS` (24 h par défaut, 1 h au moins) : un fichier écrit, lié ou déplacé
    depuis moins longtemps n'est jamais compté (dépôt en cours). La date retenue est la plus récente de `mtime` et
    `ctime` : le renommage par lien dur change la seconde.
  - Seuls les noms que Codex donne (`<uuid>-…`) sont examinés ; un autre fichier (`.DS_Store`…) est laissé en place.
  - SharePoint (dossier `_staging`) : listé seulement quand il est actif ou que des versions y pointent, jamais
    supprimé tant que le pilote n'a pas été essayé sur un vrai tenant (O-01).
  - Pas de commande npm : PGlite n'ouvre la base que dans un seul processus, celui du serveur. Le planificateur
    lance la même suppression quand `CODEX_SCHEDULE_ORPHANS` en donne la fréquence (désactivée par défaut ;
    `docs/exploitation.md` §4).
- **Fichiers restés sous un nom provisoire** (même écran, gestionnaire documentaire avec l'accès Administration) : un
  fichier est stocké sous un nom provisoire avant la transaction qui l'enregistre, puis renommé `{ID}_{version}.{ext}`
  (`nameStoredFile`) ; un arrêt entre les deux, ou un stockage injoignable, laisse un enregistrement qui pointe vers le
  nom provisoire (le fichier reste servi). « Fichiers sous un nom provisoire › Rechercher » les liste sans rien changer
  (`src/lib/provisional.ts` : clés `<uuid>-upload.<ext>` en local, éléments de `_staging` sur SharePoint, touchés
  depuis plus de `CODEX_ORPHAN_GRACE_HOURS`), puis « Renommer ces fichiers » donne leur nom aux seuls fichiers listés,
  chacun revérifié juste avant, 200 au plus, journalisé (« Fichiers renommés », noms montrés aux seuls gestionnaires).
  Le planificateur le fait quand `CODEX_SCHEDULE_RENAMES` en donne la fréquence (désactivé par défaut). Sur
  SharePoint, le renommage passe par la même interface que le dépôt, jamais essayée sur un vrai tenant (O-01).

## Sauvegarde et restauration

Point 48 de `docs/reste-a-faire.md` ; procédure complète dans **`docs/sauvegarde.md`** (sauvegarder, restaurer, tester
une restauration, dépannage).

```bash
npm run backup                          # serveur arrêté : archive de la base et des fichiers, rotation
npm run backup:list                     # archives, de la plus récente à la plus ancienne
npm run backup:check -- latest          # relit une archive : manifeste, SHA-256 de chaque entrée, schéma
npm run restore -- <archive>            # serveur arrêté, dossier de données vide
npm run restore -- <archive> --replace  # remplace la base et les fichiers, mis de côté dans replaced-<instant>/
```

- **Archive** (`src/lib/backup-core.mjs`) : `codex-backup-<instant UTC>.tar`, avec la base vidée par PGlite
  (`dumpDataDir`) pendant que sa connexion est tenue, après un `CHECKPOINT`, les fichiers locaux que cette base
  référence (pas les orphelins, pas les fichiers SharePoint, comptés) et un `manifest.json` : date, origine, version,
  migration du schéma, nombres de documents, révisions, versions de travail, entrées de journal et fichiers, taille et
  SHA-256 de chaque entrée. L'archive est relue avant la rotation, qui garde les `CODEX_BACKUP_KEEP` plus récentes (7)
  et la plus récente de chacun des `CODEX_BACKUP_KEEP` derniers jours.
- **Où** : `CODEX_BACKUP_DIR`, par défaut à côté du dossier de données (`.data-backups/`, ignoré par git), dossier en
  `0700` et archives en `0600`, non chiffrées. Lieu de conservation, copie hors de la machine, chiffrement et fréquence
  ne sont pas décidés (hébergement) : rien n'est programmé.
- **Serveur en marche** : Administration › Journal d'audit › Sauvegardes, « Sauvegarder maintenant », réservé aux
  gestionnaires documentaires ayant l'accès Administration (l'archive contient les brouillons, D-14) ; les écritures
  attendent pendant le vidage de la base (quelques secondes) ; une sauvegarde par quart d'heure au plus, pour qu'une
  suite de clics n'écarte pas les archives d'avant ; entrée « Sauvegarde créée » au journal (archive, taille, début du
  SHA-256, nombres montrés aux seuls gestionnaires, aucun document nommé). Pas de restauration ni de téléchargement
  depuis l'application.
- **Verrou** : le serveur écrit `codex.lock` dans le dossier de données en ouvrant la base. `npm run backup` et
  `npm run restore` refusent de tourner tant que ce processus vit (PGlite n'ouvre la base que dans un processus), et le
  serveur refuse d'ouvrir la base pendant qu'une de ces commandes travaille. Un verrou laissé par un processus disparu
  est ignoré ; celui d'une commande l'est aussi 10 minutes après son dernier rafraîchissement (toutes les 30 s), au cas
  où son numéro de processus aurait été repris. En cas de doute, l'erreur du serveur nomme le fichier à supprimer
  (dépannage dans `docs/sauvegarde.md`).
- **Restauration** : refusée sur une base ou des fichiers en place sans `--replace` ; refusée pour une archive
  altérée ou d'un schéma que le code ne connaît pas ; la base est chargée à côté, ses nombres et ses fichiers comparés
  au manifeste, avant de remplacer quoi que ce soit ; mise en place entrée par entrée (un `files/` monté à part ou lien
  symbolique reste en place), défaite si un déplacement échoue ; entrée « Base restaurée » au journal, au nom de Codex.
- Les commandes lisent les variables comme Next : l'environnement, puis les fichiers de `next start`
  (`.env.production.local`, `.env.local`, `.env.production`, `.env`), ou ceux de `next dev` avec `--dev` ; elles
  affichent d'abord le dossier de données et celui des sauvegardes. App Mac :
  `CODEX_DATA_DIR="$HOME/Library/Application Support/Codex/data" npm run backup`, app quittée.

## Export complet (réversibilité)

Point 17 de `docs/reste-a-faire.md` ; format et réimport dans **`docs/export.md`**.

```bash
npm run export                          # serveur arrêté : archive ZIP dans .data-exports/ (ou --out <fichier|dossier>)
npm run export:check -- <archive>       # relit une archive : CRC-32 et SHA-256 de chaque élément, manifeste
```

- **Archive** (`src/lib/export-core.mjs`) : chaque table de la base en JSON (champs nommés comme dans
  `src/db/schema.ts`), dont le journal d'audit ; les métadonnées des documents en CSV ; le fichier de chaque version de
  travail sous `files/{ID}/{ID}_{lettre}.{n}.{ext}` ; chaque document au format de `POST /api/import` avec le fichier
  à envoyer ; `SHA256SUMS` et un `manifest.json` (date, migration du schéma, nombre de lignes de chaque table, taille et
  SHA-256 de chaque élément). ZIP sans compression, écrit en flux (rien n'est chargé en entier), Zip64 au-delà de 4 Go.
- **Instantané** : les tables sont copiées en une transaction (quelques secondes, les écritures attendent), puis lues
  par lots ; ce qui change pendant le téléchargement n'y entre pas.
- **Serveur en marche** : Administration › Journal d'audit › Export complet, réservé aux gestionnaires documentaires
  ayant l'accès Administration. L'archive contient tout, brouillons et confidentiels compris (pas de filtre D-14), et
  n'est pas chiffrée. Journal : « Export complet » au début (dans l'archive), « Export complet envoyé » à la fin de
  l'envoi (envoyé ne veut pas dire reçu : vérifier le fichier par `npm run export:check`), avec la taille et le SHA-256
  de l'archive, ou « interrompu » ; nombres montrés aux seuls gestionnaires, aucun document
  nommé. Compté dans `CODEX_RATE_EXPORTS`.
- **Commande** : même archive, écrite sous un nom provisoire, relue entièrement, puis nommée ; même verrou que
  `npm run backup` (refusée tant que le serveur tourne) ; journalisée sous l'acteur Codex. Elle ne lit pas les fichiers
  SharePoint, qu'elle signale (l'export depuis l'application les inclut quand SharePoint est configuré).
- Ce n'est pas une sauvegarde : pour revenir à un état de Codex, on restaure une sauvegarde. Le réimport passe par
  `POST /api/import`, une révision par document.

## Empreintes des fichiers : intégrité et doublons

Point 31 de `docs/reste-a-faire.md`.

```bash
npm run integrity                       # serveur arrêté : relit chaque fichier et le compare à son empreinte (code 1 si écart)
```

- **Empreinte** : chaque fichier qui entre dans Codex (nouveau document, copie d'un modèle, version de travail,
  import) reçoit son SHA-256, calculé dans `stageFile` (`src/lib/storage.ts`) et gardé sur la version de travail
  (`working_versions.sha256`). Il est affiché dans l'onglet Révisions (et la comparaison des versions), repris dans la
  fiche de visa (fichier approuvé), dans le journal des dépôts (cercle de rédaction seulement, D-14) et dans l'export
  complet, dont le manifeste signale les fichiers qui ne correspondent plus (`files.altered`).
- **Vérification** (`src/lib/integrity-core.mjs`) : Administration › Journal d'audit › Intégrité des fichiers
  (gestionnaires documentaires ayant l'accès Administration) ou `npm run integrity` relisent tous les fichiers stockés,
  signalent les altérés et les absents, enregistrent l'empreinte des fichiers déposés avant son calcul, et inscrivent
  le résultat au journal (« Vérification d'intégrité »). Rien n'est réparé ni supprimé. Un téléchargement complet est
  vérifié au passage : un fichier altéré est interrompu avant ses derniers octets et journalisé (« Fichier altéré
  détecté ») ; une plage d'octets (aperçu) ne l'est pas. Une copie de modèle altéré est refusée.
- **Doublons** : un dépôt dont le fichier est identique à un fichier déjà classé reste accepté, avec un avertissement
  qui nomme le document, seulement si l'utilisateur peut avoir ce fichier-là (hors du cercle de rédaction : le fichier
  en vigueur, jamais un brouillon ni une version de travail, D-14). L'import le signale dans `warnings`
  (`duplicate_file`) pour un fichier en vigueur de niveau Public, Restreint ou Interne seulement.

## Exploitation : journal technique, santé, configuration

Points 37, 38 et 49 de `docs/reste-a-faire.md` ; procédure complète dans **`docs/exploitation.md`** (champs du journal,
supervision, codes du contrôle de configuration et leur correction).

- **Journal technique** (`src/lib/log.ts`), distinct du journal d'audit : une entrée par ligne sur la sortie du
  serveur, en JSON en production (`next start`, app Mac : `~/Library/Logs/Codex/server.log`), lisible en
  développement ; `CODEX_LOG_FORMAT`, `CODEX_LOG_LEVEL` (`info` par défaut). Une ligne par requête d'API (route,
  statut, durée) et par Server Action d'écriture (nom, issue, durée), chaque jeton refusé (route, adresse, raison),
  toute erreur serveur rattrapée par Next.js (`src/instrumentation.ts`, `onRequestError`), avec sa pile. Chaque entrée
  porte l'identifiant de sa requête, renvoyé dans l'en-tête `X-Request-Id` des réponses d'API (repris d'un reverse
  proxy s'il en pose un). Jamais de jeton, de cookie, de corps de requête, de contenu de document, de chaîne de
  requête ni de valeur d'une requête de base en échec.
- **Santé** : `GET /api/health` (ou `HEAD`) répond 200 quand la base répond et que le stockage actif est utilisable,
  503 sinon, avec la version et le résultat de chaque contrôle, sans dire pourquoi (la raison est au journal, sous le
  même identifiant). Sans session ni jeton.

  ```bash
  curl -fsS http://localhost:3100/api/health
  # {"status":"ok","version":"0.1.0","checks":{"database":{"ok":true,"ms":1},"storage":{"ok":true,"ms":2}},…}
  ```
- **Contrôle de la configuration au démarrage** (`src/lib/config-check.ts`, appelé par `register` de
  `src/instrumentation.ts`) : chaque variable de `.env.example` lue comme le code la lit ; ce qui serait ignoré ou mal
  lu est écrit au journal avec la variable à corriger. Une erreur (stockage inconnu ou SharePoint incomplet, jeton
  d'intégration de moins de 32 caractères, adresse Vigie ou Keystone qui n'est pas une URL http(s), `CODEX_CLAMD`
  illisible, dossier de données non inscriptible) **arrête le serveur en production** (code de sortie 1) ; en
  développement, elle est seulement écrite. `CODEX_CONFIG_CHECK=warn` ou `strict` change ce comportement. Sans
  aucune variable, il n'y a aucune erreur : `npm run dev`, `npm run start` et l'app Mac démarrent comme avant.
- **Image générique** (`Dockerfile`, `.dockerignore` ; `docs/exploitation.md` §10) : `docker build -t codex .` puis
  `docker run -p 3100:3100 -v codex:/var/lib/codex codex`. Serveur autonome de Next.js (`output: 'standalone'`
  seulement quand `CODEX_STANDALONE=1` : `npm run build` et l'app Mac sont inchangés), utilisateur non root, volume des
  données, `HEALTHCHECK` sur `/api/health`, variables au lancement seulement, aucun secret ni donnée dans l'image ; ni
  hébergeur, ni proxy, ni TLS choisis (M22). Commandes de sauvegarde, d'export et d'intégrité dans l'image, conteneur du
  serveur arrêté ; lancées à côté d'un serveur en marche, elles refusent (le verrou du dossier de données reconnaît un
  autre conteneur).
- **Planificateur** (`src/lib/scheduler.ts`, démarré par `register`) : toutes les 5 minutes par défaut, met en vigueur
  les révisions approuvées dont la date d'effet est venue (les pages ne le font plus elles-mêmes) et applique une
  acceptation de Vigie que plus rien ne retient. Nettoyage des orphelins, vérification d'intégrité, sauvegarde et
  export complet sont désactivés tant que leur variable `CODEX_SCHEDULE_*` n'en donne pas la fréquence. Une seule
  exécution à la fois par tâche, même à plusieurs processus sur une base (bail en base). État dans Administration ›
  Journal d'audit › Planificateur ; détail dans `docs/exploitation.md` §4.

## Aperçu des fichiers Office et comparaison des versions

Points 14 et 15 de `docs/reste-a-faire.md` (G05, M12). Installation de l'outil de conversion : `docs/exploitation.md`
§6.

- **Comparer** (`src/lib/compare.ts`, `GET /api/documents/[id]/compare?a=&b=`) : le texte des deux fichiers est extrait
  sur le serveur (`src/lib/text-extract.ts`) : PDF par pdf.js (bibliothèque `unpdf`, couche texte seulement : un scan
  sans texte ne donne rien), Word, Excel, PowerPoint et OpenDocument lus dans leur ZIP, formats texte ; les fichiers
  Office 97-2003, images et plans ne sont pas lus, et le dialogue le dit. Les écarts sont calculés ligne à ligne
  (`src/lib/line-diff.ts`, algorithme de Myers), blancs et lignes vides ignorés, et affichés sous les attributs, avec
  deux lignes de contexte. Bornes : fichier de `CODEX_COMPARE_MAX_MB` (20 Mo par défaut), 15 s d'extraction, 20 000
  lignes et 2 millions de caractères par texte, 3 000 lignes ajoutées ou supprimées au plus (au-delà : « Les textes
  diffèrent trop »), 2 000 lignes affichées. Mêmes droits que la route fichier (D-14) : hors du cercle de rédaction,
  seule la révision en vigueur se lit, donc rien d'autre ne se compare ; une version refusée répond 404. Chaque
  version comparée est journalisée comme une consultation (« B.2 · Comparaison »). Un fichier dont l'empreinte ne
  correspond plus à celle du dépôt n'est pas comparé.
- **Aperçu des fichiers Office** (`src/lib/office-preview.ts`, `src/lib/preview-config.ts`) : désactivé tant que ni
  `CODEX_PREVIEW_SOFFICE` (chemin de LibreOffice, lancé sans interface) ni `CODEX_PREVIEW_GOTENBERG_URL` (service
  Gotenberg) n'est défini. Sinon, le fichier est converti en PDF la première fois que quelqu'un qui a le droit de le
  voir ouvre la fiche (`/api/documents/[id]/file?v=…&preview=pdf`, mêmes droits que le fichier), hors transaction ;
  le rendu est gardé dans le stockage local (table `version_previews` : clé, nombre de pages, empreinte) et resservi
  sans nouvelle conversion. La fiche l'affiche avec sa pagination et la mention « Aperçu PDF généré par le service de
  conversion » de la maquette. Un échec (délai `CODEX_PREVIEW_TIMEOUT_S`, 60 s par défaut ; fichier au-delà de
  `CODEX_PREVIEW_MAX_MB`, 20 Mo ; résultat qui n'est pas un PDF) donne « Aperçu indisponible » et le téléchargement,
  et n'est retenté qu'une heure plus tard. Deux conversions au plus en même temps par processus. LibreOffice reçoit un
  environnement à lui (aucune variable de Codex) et un profil temporaire.
- **Cohérence** : les rendus sont des données dérivées. Le nettoyage des orphelins compte leurs clés comme référencées
  (un rendu dont la ligne a disparu devient un orphelin ordinaire), la sauvegarde les archive avec les fichiers,
  l'export complet les laisse de côté (table et fichiers, refaits à partir des fichiers d'origine), et le contrôle
  d'intégrité ne porte que sur les fichiers d'origine ; un rendu est vérifié contre son empreinte à chaque envoi
  entier, et un rendu altéré ou manquant est oublié puis refait.
- **Tests** : `tests/integration/office-preview.test.ts` remplace LibreOffice par un faux `soffice` (script shell) et
  Gotenberg par un faux serveur HTTP ; avec `CODEX_TEST_SOFFICE=/usr/bin/soffice`, un dernier test convertit un vrai
  fichier Word.

## Organisation du code

```
Dockerfile             image générique (docs/exploitation.md §10) ; .dockerignore : contexte limité au build
src/
  proxy.ts             politique de sécurité du contenu des pages (nonce par requête), HSTS si CODEX_HTTPS
  instrumentation.ts   au démarrage, contrôle de la configuration ; erreurs serveur au journal technique
  app/                 routes (pages serveur) + styles par écran (*.module.css)
    nocturne.css       design system Nocturne (copie de design/_ds/…/styles.css)
    globals.css        règles d'application communes
    api/               fichiers, fiches de visa, exports CSV et complet, registre, import, webhook Vigie, santé (health)
    aide/              page d'aide (/aide), textes dans lib/i18n.ts
  components/
    shell/             barre latérale, en-tête, contexte client (dialogues, toasts)
    dialogs/           toutes les boîtes de dialogue
    ui/                icônes de la maquette, contrôle segmenté, steppers, boutons d'action, pages d'une liste
  db/                  schéma Drizzle (schéma PostgreSQL codex), connexion PGlite ou serveur commun (sql-client.ts),
                       déclencheurs, termes de recherche repliés, migrations versionnées et reprise d'une base
                       ancienne (migrations.ts), registre, amorçage (référentiel, démonstration)
  fonts/               police Inter (woff2, sous-ensembles de Google Fonts, licence OFL), next/font/local
  lib/
    actions.ts         Server Actions (toutes les mutations + contrôles de droits)
    queries.ts         lectures et modèles de vue ; recherche, explorateur et journal filtrés, comptés et paginés par la base
    context.ts         langue, utilisateur et rôle simulés, registre, libellés, droits
    access.ts          visibilité (confidentialité, cercle de rédaction), en TypeScript et en condition SQL
    lifecycle.ts       révisions : mise en vigueur, remplacement, décisions Vigie
    links.ts           liens entre documents : remplace / remplacé par, voir aussi
    approval.ts        fiche de visa d'une révision : étapes, délégations, mise en page
    pdf.ts             écriture de PDF sans dépendance (retour à la ligne, accents, plusieurs pages)
    codes.ts           identifiants TYPE-CONTEXTE-SEQ et lettres de révision
    registry-rules.ts  administration du registre : formats des codes, collisions entre segments d'un identifiant,
                       lecture des formulaires de type, famille, fonction et programme
    registry-apply.ts  application du registre du code à une base existante (npm run registry:apply)
    registry-review.ts cahiers de validation du registre (types, fonctions) : écriture, contrôle d'un cahier rempli,
                       écart avec le code (npm run registry:review)
    journal-values.ts  valeurs des changements journalisés (avant → après) du registre et des métadonnées
    seed-mode.ts       CODEX_SEED : démonstration ou référentiel minimal
    codification.ts    attribution des identifiants, numéros de circuit et références ECR (compteurs en base)
    dates.ts           cohérence des dates d'un document (émission ≤ effet < expiration)
    format.ts, csv.ts  dates, tailles et textes bilingues affichés ; lignes CSV des exports, relecture d'un CSV
    errors.ts          référence d'une erreur montrée à l'utilisateur, jamais son message (i18n-errors.ts : ses textes)
    titles.ts          titre de chaque page dans la langue choisie
    integrity-core.mjs contrôle d'intégrité des fichiers stockés (SHA-256), lancé par Administration (integrity.ts) et
                       par scripts/codex-integrity.mjs
    org-rules.ts       administration de l'organisation : libellés, valeurs proposées (actives), un département actif
    org-review.ts      contrôle d'un organigramme en CSV : règles, doublons, références, collisions (npm run org:check)
    transfer.ts        reprise des responsabilités d'une personne qui part : simulation (transaction annulée), empreinte,
                       transfert journalisé objet par objet
    vocab-rules.ts     vocabulaires contrôlés (règles pures) : graphies d'un terme, termes proches, sous-types, langue
    vocab.ts           vocabulaires contrôlés en base : lecture des valeurs d'un formulaire ou d'un import, ajout
                       journalisé, valeurs des documents
    retention.ts       fin de conservation
    review.ts          expiration et revue périodique : indicateurs, prochaine date de revue
    concurrency.ts     modifications simultanées : version vue par un dialogue, version de travail de base
    search.ts          recherche : facettes, période, tri, pertinence
    departments.ts     pages par département : filtres mis en avant
    storage.ts         stockage des fichiers (disque local ou SharePoint) ; contrôle et analyse avant stockage ;
                       lecture en flux
    ranges.ts          plages d'octets (206, 416) et requêtes conditionnelles (ETag, 304) de la route fichier
    orphans.ts         fichiers orphelins du stockage : simulation, suppression journalisée, délai de grâce
    backup-core.mjs    sauvegarde et restauration : archive tar, manifeste, empreintes, rotation, verrou du dossier de
                       données (JavaScript, lancé aussi par scripts/codex-backup.mjs sans compilation)
    backup.ts          sauvegarde depuis Administration (serveur en marche), journalisée
    export-core.mjs    export complet : archive ZIP en flux (écriture, relecture), instantané des tables, manifeste,
                       vue d'import (JavaScript, lancé aussi par scripts/codex-export.mjs sans compilation)
    full-export.ts     export complet depuis Administration (serveur en marche), journalisé ; écrit en fichier par le
                       planificateur
    filetypes.ts       formats, contenu (signatures, ZIP, OLE2, macros) et taille admis au dépôt ; types servis en
                       ligne et affichés en aperçu
    antivirus.ts       analyse antivirus des fichiers déposés (clamd, commande INSTREAM)
    compare.ts         comparaison du contenu de deux versions (droits, extraction, écarts, journal)
    text-extract.ts    texte d'un fichier : PDF (unpdf), Word, Excel, PowerPoint, OpenDocument, texte ; bornes
    zip-read.ts        lecture bornée des entrées d'un ZIP (Office Open XML, OpenDocument)
    line-diff.ts       écarts ligne à ligne (Myers), regroupés avec leur contexte
    office-preview.ts  aperçu PDF des fichiers Office : conversion (LibreOffice ou Gotenberg), rendu gardé
    preview-config.ts  réglages de la conversion (variables, formats convertis)
    keystone.ts, vigie.ts  frontières d'intégration
    importer.ts        API d'import (outil de migration)
    server-auth.ts     authentification entre serveurs : jetons, signature HMAC, anti-rejeu, rotation
                       (variables : integration-credentials.ts)
    ratelimit.ts       limites de débit des routes sensibles et des Server Actions (en mémoire)
    security-headers.ts  en-têtes de sécurité HTTP et politique de sécurité du contenu
    log.ts             journal technique : entrées JSON ou lisibles, identifiant de requête, routes et actions
    config-check.ts    contrôle de la configuration au démarrage
    scheduler.ts       planificateur : mise en vigueur différée, tâches d'exploitation, bail en base
                       (réglages et état du processus : scheduler-state.ts)
    version.ts         version de Codex (package.json), pour la santé et les sauvegardes
    i18n.ts            textes FR / EN, dont ceux de l'aide (HELP)
scripts/
  codex-backup.mjs     commandes npm run backup, backup:list, backup:check, restore (docs/sauvegarde.md)
  codex-export.mjs     commandes npm run export, export:check (docs/export.md)
  codex-integrity.mjs  commande npm run integrity (empreintes SHA-256 des fichiers)
  codex-registry.mts   commande npm run registry:apply (TypeScript, lancé par tsx)
  codex-registry-review.mts  commande npm run registry:review (cahiers de validation, tsx)
  codex-org-check.mts  commande npm run org:check (organigramme en CSV, tsx)
  codex-seed-large.mts commande npm run seed:large : volume synthétique pour les mesures (docs/performances.md)
  codex-perf.mjs       commande npm run perf : temps des écrans et routes principaux d'un serveur lancé
  codex-a11y.mts       commande npm run a11y : contrôle d'accessibilité (axe-core, Chromium), docs/accessibilite.md
  codex-e2e.mts        commande npm run e2e : parcours de bout en bout (approbation, rejet, rappel, Vigie, import)
  codex-narrow.mts     relevés de npm run a11y -- --narrow : 320 px, zoom 200 %, débordements (WCAG 1.4.10, 1.4.4)
  codex-browser.mts    serveur jetable et Chromium, communs à a11y et e2e
  codex-migrate.mts    commande npm run db:migrate : migrations au déploiement (docs/exploitation.md §7)
  codex-audit.mjs      commande npm run deps:audit : vulnérabilités connues des dépendances (CI)
  codex-node-check.mjs la version de Node satisfait-elle engines (app Mac)
tests/
  unit/                tests unitaires des règles pures de src/lib (Vitest, vitest.config.ts)
  integration/         tests d'intégration sur PGlite en mémoire, ou sur un serveur PostgreSQL (npm run test:pg)
  support/             base de test et données minimales, session simulée, remplacement de server-only, lecture des PDF,
                       faux clamd, ZIP et fichiers composés (OLE2) minimaux, fichiers Office minimaux (office.ts)
```

## Décisions et points ouverts

Les décisions prises avec l'utilisateur et les questions encore ouvertes sont dans `docs/decisions.md` ; le deck
d'origine et son audit dans `docs/sources/` et `docs/audit-deck-epc2i.md`. Voir aussi `docs/registre-points-ouverts.md`
(registre des types) et les points *provisoires* de `docs/modele-cible.md` (organisation, stockage SharePoint).

## Mise en ligne (Docker, Coolify)

Le `Dockerfile` à la racine compile l'application (sortie autonome de Next.js) et lance son serveur sous
l'utilisateur `node`, jamais root (`docs/exploitation.md` §10). Le contrat avec l'hébergeur (Coolify depuis le
10 octobre) est inchangé :

| Réglage | Valeur |
| --- | --- |
| Port interne | `3000` |
| Volume persistant | `/data` (fichiers dans `/data/files`, base PGlite de repli dans `/data/pglite`, sauvegardes dans `/data/backups`) ; un volume créé par l'ancienne image (root) est rendu à `node` au démarrage |
| Variables d'exécution | `DATABASE_URL` (serveur commun, rôle `codex_app`), `CODEX_DB_POOL`, `CODEX_SEED` ou `CODEX_SEED_DEMO`, `MATRIX_URL`, `MATRIX_TOKEN`, `NEXT_PUBLIC_KEYSTONE_URL`, `NEXT_PUBLIC_VIGIE_URL` (voir `.env.example`) |
| Santé | `HEALTHCHECK` de l'image sur `GET /api/health` |

- `NEXT_PUBLIC_KEYSTONE_URL` et `NEXT_PUBLIC_VIGIE_URL` sont lues par le serveur au lancement, plus au build : la
  case « disponible au build » de Coolify n'est plus nécessaire, et un changement d'adresse demande un redémarrage,
  pas un nouveau build.
- `DATABASE_URL` ne doit jamais être disponible au build ni écrite dans l'image. Dans Coolify, Codex et le serveur
  PostgreSQL doivent partager un réseau (dépôt Matrix, `infra/postgres/README.md`).
- Sur le serveur commun, une base vide n'est remplie que sur demande (`CODEX_SEED=minimal` pour une mise en service,
  `CODEX_SEED_DEMO=1` pour la démonstration) ; sinon chaque page dit quoi poser (`/base-vide`).
- Une base PGlite d'avant le schéma `codex` dans `/data/pglite` (démo de `main` d'avant le 17 octobre) est refusée au
  démarrage : arrêter l'application, `rm -rf /data/pglite` dans le volume, redémarrer (`docs/exploitation.md` §10).
- Le build ne demande plus d'accès réseau pour la police (Inter est dans `src/fonts/`) ; `npm ci` en a besoin.
- Tant que l'authentification n'est pas branchée, protéger l'accès au niveau de l'hébergeur (authentification HTTP de
  Coolify, par exemple).

### Déclaration du schéma à Matrix

Au démarrage, juste après les migrations, Codex lit le schéma réel de sa base (tables, colonnes, clés primaires,
étrangères et uniques) et l'envoie à Matrix, le catalogue des bases de Keystone, Codex, Cursus et Vigie
(`POST /api/declarations`, contrat `matrix.schema/1`, code dans `src/lib/matrix.ts`). L'envoi ne retarde jamais le
démarrage : en cas d'échec, un avertissement `[matrix]` est écrit dans le journal et Codex continue.

| Variable (Coolify) | Rôle |
| --- | --- |
| `MATRIX_URL` | Adresse de Matrix, par exemple `https://matrix.votre-domaine` ; derrière l'authentification HTTP de Coolify : `https://identifiant:mot-de-passe@matrix.votre-domaine`. Sans elle, rien n'est envoyé. |
| `MATRIX_TOKEN` | Jeton partagé avec Matrix (même valeur que `MATRIX_TOKEN` du serveur Matrix), envoyé dans l'en-tête `X-Matrix-Token`. |

`MATRIX_DECLARATIONS_DIR` (facultatif) écrit aussi la déclaration dans ce dossier.
