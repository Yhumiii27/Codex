# Sauvegarde et restauration de Codex

Procédure d'exploitation pour sauvegarder la base et les fichiers de Codex, restaurer une sauvegarde et tester une
restauration. Code : `src/lib/backup-core.mjs` (archive, contrôles, verrou), `scripts/codex-backup.mjs` (commandes),
`src/lib/backup.ts` (action d'Administration). Point 48 de [reste-a-faire.md](reste-a-faire.md).

Une sauvegarde sert à remettre Codex dans l'état d'une date. Pour quitter Codex ou alimenter un autre système, il y a
l'export complet ([export.md](export.md)) : mêmes données, en JSON, CSV et fichiers sous un nom lisible, sans Codex
pour les lire.

**Base intégrée seulement.** Tout ce qui suit vaut pour PGlite, la base par défaut. Avec un serveur PostgreSQL
(`DATABASE_URL`, [postgres.md](postgres.md)), `npm run backup` et `npm run restore` refusent avec un message, comme
« Sauvegarder maintenant » dans l'Administration : le serveur se sauvegarde avec ses propres outils (`pg_dump`,
instantanés de l'hébergeur), et le dossier des fichiers à part.

**Non décidé** (à fixer par l'utilisateur, voir [decisions.md](decisions.md), « Choix de l'assistant non validés ») :
la fréquence des sauvegardes, le lieu où les archives sont conservées (hébergement), leur chiffrement, la perte de
données et le délai de reprise tolérés (M22 de l'audit). Rien n'est programmé : une sauvegarde se lance à la main.

## Ce que contient une sauvegarde

Une archive par sauvegarde, `codex-backup-<instant UTC>.tar` (tar POSIX non compressé, lisible par `tar -tvf`) :

| Entrée | Contenu |
|---|---|
| `database/pglite.tar.gz` | Le dossier de la base tel que PGlite le vide (`dumpDataDir`), compressé. |
| `files/<clé>` | Chaque fichier local que référence une version de travail de cette base, sous la clé enregistrée. |
| `manifest.json` | Dernière entrée : format, date, origine (application ou ligne de commande), version de Codex, migration du schéma, nombre de documents, révisions, versions de travail, entrées de journal et personnes, fichiers (nombre, taille, fichiers référencés absents du stockage, fichiers sur SharePoint), taille et SHA-256 de chaque autre entrée. |

Ne sont **pas** dans l'archive : les fichiers qu'aucune version de travail ne référence (orphelins, dépôts en cours),
les fichiers stockés sur SharePoint (comptés dans le manifeste ; leur conservation relève de SharePoint, O-01), la
configuration (`.env.local`), le code.

**Cohérence.** La base est vidée pendant que Codex tient sa connexion unique (transaction PGlite : aucune autre requête
en cours), après un `CHECKPOINT` ; les écritures attendent pendant ce temps (quelques secondes pour la base de
démonstration). Les fichiers sont lus ensuite : un fichier stocké n'est jamais réécrit, et un fichier référencé n'est
retiré qu'une fois la référence changée. Un fichier renommé entre-temps est lu sous son nouveau nom (même UUID, mêmes
octets) et rangé sous la clé que la base enregistre.

**Où.** `CODEX_BACKUP_DIR`, sinon à côté du dossier de données : `.data-backups/` pour `.data/`,
`~/Library/Application Support/Codex/data-backups/` pour l'app Mac. Hors de `.data/` : `npm run db:reset` ne les
efface pas. Dossier en `0700`, archives en `0600` (lisibles par le seul compte qui fait tourner Codex), **non
chiffrées**. Sur le même disque que la base par défaut : cela protège d'une erreur ou d'une base abîmée, pas de la
perte du disque. Copier les archives ailleurs (autre disque, autre machine) relève de l'hébergement.

**Chiffrement.** Une archive contient toute la base et tous les fichiers, brouillons et documents confidentiels
compris, et Codex ne la chiffre pas. Placer `CODEX_BACKUP_DIR`, comme le dossier de données, sur un **volume chiffré**
(chiffrement de disque de l'hôte ou de l'hébergeur), et chiffrer chaque archive avant de la copier hors de la machine
(par exemple `age` ou `gpg` vers une clé publique). Les **clés restent hors du serveur** (coffre de clés, module
matériel ou phrase saisie au démarrage ; jamais dans le dépôt, dans `.env*` ni sur le volume chiffré) et sont
elles-mêmes sauvegardées : une restauration d'essai (« Tester une restauration ») se fait aussi avec la clé de secours.
Détail et contexte : `docs/exploitation.md` §9 ; l'outil et le lieu dépendent de l'hébergement (M22, non décidé).

**Rotation.** Après chaque sauvegarde réussie et relue, sont gardées les `CODEX_BACKUP_KEEP` archives les plus
récentes (7 par défaut) **et** la plus récente de chacun des `CODEX_BACKUP_KEEP` derniers jours (jour UTC) où une
sauvegarde a été faite, soit au plus le double. Plusieurs sauvegardes faites à la suite le même jour n'écartent donc
jamais celles des jours précédents. Seuls les fichiers nommés `codex-backup-…tar` sont concernés ; un dossier par
instance de Codex, puisque la rotation compte toutes les archives du dossier.

## Sauvegarder

### Serveur en marche : depuis Administration

Administration › Journal d'audit › Sauvegardes › « Afficher », puis « Sauvegarder maintenant » (confirmation). Réservé
aux gestionnaires documentaires qui ont l'accès Administration (l'archive contient tous les brouillons, D-14). Le
message donne le nom et la taille de l'archive ; l'entrée « Sauvegarde créée » du journal garde l'archive, sa taille,
le début de son SHA-256 et les nombres de documents et de fichiers, sans nommer de document. Ces nombres et ces
tailles ne sont montrés qu'aux gestionnaires documentaires : un autre lecteur du journal (à qui le droit Administrer
aurait été donné) ne voit que l'action et l'archive, puisque le nombre total de documents lui dirait combien lui sont
cachés. Le panneau liste les archives du dossier avec leur origine et leur contenu.

Depuis l'application, une sauvegarde n'est possible que 15 minutes après la dernière archive du dossier, quelle que
soit son origine : le message donne l'heure de la dernière et celle à partir de laquelle une nouvelle est possible.
Sans ce délai, une suite de clics écarterait par la rotation toutes les archives faites avant, alors qu'elles servent
justement à revenir sur une erreur faite dans l'application. La commande n'a pas ce délai.

### Serveur arrêté : en ligne de commande

```bash
npm run backup                 # écrit l'archive, la relit, applique la rotation, journalise « Sauvegarde créée »
npm run backup:list            # archives du dossier, de la plus récente à la plus ancienne
```

La commande refuse de tourner tant que le serveur qui tient la base vit (fichier `codex.lock` du dossier de données,
écrit par le serveur à l'ouverture de la base) : arrêter `npm run dev`, `npm run start` ou l'app Mac, ou passer par
Administration. Si le serveur s'est arrêté brutalement, son verrou est ignoré dès que son processus n'existe plus ; en
cas de doute (numéro de processus réutilisé), vérifier qu'aucun serveur ne tourne puis supprimer `codex.lock`.

Le verrou enregistre le numéro du processus, un identifiant tiré au hasard par processus et l'espace de processus
(machine ou conteneur) où il tourne. Le serveur le rafraîchit toutes les 30 secondes, comme les commandes. Un verrou
posé dans un autre conteneur ou sur une autre machine qui partage le dossier n'est jamais jugé par son numéro : il
tient tant qu'il est rafraîchi, et cesse 10 minutes après. Une commande lancée dans un conteneur à côté du serveur
refuse donc (« processus 1, dans un autre conteneur ou sur une autre machine »), même si elle a le même numéro que
lui ([exploitation.md](exploitation.md) §10). Arrêter le serveur d'abord reste la règle : le verrou protège la base
si on l'oublie. Un verrou de l'ancien format (sans identifiant) est jugé par son numéro, mais jamais pris pour celui
du processus qui le lit.

**Variables.** Les commandes lisent `CODEX_DATA_DIR`, `CODEX_BACKUP_DIR` et `CODEX_BACKUP_KEEP` comme Next les lit
(`@next/env`) : l'environnement d'abord, puis les fichiers de `next start` (et de l'app Mac), dans cet ordre :
`.env.production.local`, `.env.local`, `.env.production`, `.env`. Avec `--dev` (ou `NODE_ENV=development`), ceux de
`next dev` : `.env.development.local`, `.env.local`, `.env.development`, `.env`. Chaque commande commence par afficher
le dossier de données, le dossier des sauvegardes et les fichiers lus : vérifier que ce sont ceux du serveur visé
avant de continuer. L'app Mac fixe son dossier de données elle-même, sans fichier `.env` :

```bash
CODEX_DATA_DIR="$HOME/Library/Application Support/Codex/data" npm run backup
npm run backup -- --dev        # serveur lancé par npm run dev, avec un .env.development
```

### Automatiquement : avant une migration, avant `npm run registry:apply -- --apply`

Depuis le 17 octobre 2026, le schéma évolue par migrations incrémentales (`drizzle/`, README « Démarrer »). Quand le
serveur démarre sur une base qui a des données et à laquelle il manque des migrations du code, il écrit d'abord une
archive (même format, même dossier, même rotation ; origine « application », par Codex), puis applique les migrations
en une seule transaction ; l'entrée « Sauvegarde créée » du journal porte « migration » et les migrations appliquées.
Si l'archive ne peut pas être écrite (dossier des sauvegardes inaccessible, disque plein), le serveur ne démarre pas
et la base reste telle quelle ; `CODEX_MIGRATION_BACKUP=off` migre sans sauvegarde. `npm run registry:apply -- --apply`
sauvegarde de même avant d'écrire (`--no-backup` pour s'en passer).

**Retour arrière d'une migration** qui est passée mais se révèle fausse : arrêter le serveur, revenir à la version
précédente de Codex (git), puis `npm run restore -- <archive> --replace` avec l'archive écrite avant la migration.
Restaurée avec la nouvelle version, la même archive recevrait de nouveau la migration au démarrage suivant. Une
migration qui échoue n'a pas besoin de retour arrière : sa transaction est annulée.

## Vérifier une archive

```bash
npm run backup:check -- latest                       # ou un nom du dossier des sauvegardes, ou un chemin
shasum -a 256 .data-backups/codex-backup-….tar       # à comparer avec l'entrée « Sauvegarde créée » du journal
```

`backup:check` relit toute l'archive : tar bien formé, manifeste Codex d'une version connue, entrées attendues et
seulement elles, taille et SHA-256 de chacune, puis dit si ce code peut la restaurer (même schéma, ou migrations
suivantes appliquées au démarrage). Il n'écrit rien et peut tourner serveur en marche.

## Restaurer

1. Arrêter le serveur (ou quitter l'app Mac). Ne pas le relancer avant la fin.
2. Vérifier l'archive : `npm run backup:check -- <archive>`.
3. Restaurer :

   ```bash
   npm run restore -- <archive>              # dossier de données vide ou absent
   npm run restore -- <archive> --replace    # remplace la base et les fichiers en place
   ```

   Sans `--replace`, la commande refuse si le dossier de données contient déjà une base (`pglite/`) ou des fichiers
   (`files/`). Avec `--replace`, ils sont **déplacés** dans `<dossier de données>/replaced-<instant>/`, jamais
   supprimés : les effacer à la main une fois la restauration vérifiée.
4. Relancer le serveur et vérifier (voir « Tester une restauration »). Le journal porte une entrée « Base restaurée »
   au nom de Codex, avec la date de la sauvegarde.

Ce que la commande contrôle avant de toucher au dossier de données :

- l'archive entière, comme `backup:check` ; une archive altérée, tronquée ou complétée est refusée ;
- la migration du schéma : une archive faite avec une migration que ce code n'a pas (schéma régénéré, autre version de
  Codex) est refusée. La restaurer avec la version de Codex qui l'a produite (git), qui appliquera ensuite les
  migrations suivantes ;
- la base restaurée, chargée par PGlite à côté de l'existant (`.restore-…`) : mêmes nombres que le manifeste, même
  migration, et chaque fichier qu'elle référence présent. Sinon rien n'est remplacé.

**Mise en place.** Une fois tout contrôlé, la commande déplace le contenu de `pglite/` et de `files/` (avec
`--replace`, l'existant vers `replaced-<instant>/`, puis la restauration à sa place), entrée par entrée : les dossiers
eux-mêmes restent où ils sont, ce qui convient à un point de montage ou à un lien symbolique (un volume ou un partage
dédié aux fichiers) ; d'un système de fichiers à l'autre, chaque entrée est copiée puis retirée. Aucune entrée n'en
remplace une autre. Si un déplacement échoue, ceux déjà faits sont défaits, du dernier au premier, et la commande le
dit : « La mise en place de la restauration a échoué (…). La base et les fichiers d'origine ont été remis en place :
rien n'a été remplacé. » Si le retour arrière échoue lui aussi, elle s'arrête là, sans rien déplacer ni supprimer de
plus, et dit ce qui est où : le contenu extrait de l'archive (gardé dans `.restore-…`), l'existant mis de côté, et
chaque entrée à remettre à sa place.

Pendant la restauration, le serveur refuse d'ouvrir la base : il répond par une erreur, et son journal dit « a restore
command (pid N) holds …/codex.lock; if no backup, restore or export command is running, delete that file ». Relancé
trop tôt, il suffit de recharger la page une fois la commande terminée. Une commande rafraîchit son verrou toutes les 30
secondes ; tuée sans avoir pu le retirer (arrêt brutal, coupure), son verrou est ignoré dès que son processus n'existe
plus, ou 10 minutes après son dernier rafraîchissement si son numéro de processus a été repris par un autre, ou si
elle tournait dans un autre conteneur ou sur une autre machine.

## Tester une restauration

À faire après la mise en place et à intervalles réguliers, sans toucher à la base en service :

```bash
npm run backup:check -- latest
CODEX_DATA_DIR=/tmp/codex-essai npm run restore -- "$PWD/.data-backups/<archive>"
CODEX_DATA_DIR=/tmp/codex-essai npx next start --port 3101   # build en place (npm run build)
```

Sans build, `CODEX_DATA_DIR=/tmp/codex-essai npx next dev --port 3101`, si aucun autre serveur de développement ne
tourne dans le dossier du projet.

Puis, sur http://localhost:3101 : même nombre de documents dans l'Explorateur et la Recherche (export CSV identique à
celui de la base en service, si rien n'a changé depuis la sauvegarde), quelques fichiers ouverts et téléchargés, entrée
« Base restaurée » dans Administration › Journal d'audit. Arrêter ce serveur (`fuser -k 3101/tcp` sous Linux) et
supprimer `/tmp/codex-essai`.

Essai fait le 15 octobre 2026 sur une copie de la base de démonstration (69 documents, 18 fichiers, 210 Mo) :
sauvegarde depuis Administration en développement et en production, sauvegarde en ligne de commande, restauration dans
un dossier vide puis avec `--replace`, y compris avec un `files/` lien symbolique vers un autre système de fichiers ;
après redémarrage, export CSV de la recherche identique et SHA-256 des 18 fichiers servis identiques à ceux d'avant
la sauvegarde. Un échec forcé du déplacement des fichiers (`chattr +i`) a laissé la base d'origine intacte
([historique.md](historique.md) §16.4).

## Dépannage

| Message | Cause, action |
|---|---|
| « Le serveur Codex tourne (processus N)… » | Le serveur tient la base : l'arrêter, ou sauvegarder depuis Administration. |
| « Le serveur Codex tourne (processus N, dans un autre conteneur ou sur une autre machine)… » | Un serveur d'un autre conteneur ou d'une autre machine tient le dossier : l'arrêter (`docker stop`), ou sauvegarder depuis Administration. S'il a été tué (`docker kill`, coupure), le verrou cesse 10 minutes après son dernier rafraîchissement ; ou, après avoir vérifié qu'aucun conteneur ne tourne sur le volume, supprimer `codex.lock`. |
| « Une autre commande (backup ou restore) travaille sur … » | Attendre la fin de l'autre commande. Si aucune ne tourne plus, le verrou est ignoré 10 minutes après son dernier rafraîchissement, ou se supprime (`codex.lock` du dossier de données). |
| Serveur en erreur, journal « busy: a backup/restore command (pid N) holds …/codex.lock… » | Une commande travaille sur le dossier de données : attendre sa fin et recharger la page. Si aucune commande ne tourne (`ps -p N`), supprimer le fichier `codex.lock` nommé, puis recharger. |
| « La dernière sauvegarde date du …, il y a moins de 15 minutes » | Depuis l'application, une sauvegarde par quart d'heure au plus : la dernière archive sert de point de restauration ; attendre l'heure indiquée, ou sauvegarder en ligne de commande, serveur arrêté. |
| « La mise en place de la restauration a échoué (…) … rien n'a été remplacé » | Un déplacement a échoué (dossier occupé, droits, place) : la base et les fichiers d'origine sont en place. Corriger la cause, puis relancer la même commande. |
| « … et le retour arrière n'a pas abouti » | Ne pas relancer le serveur. Remettre à leur place les entrées listées (où elles sont → où elles étaient), ou relancer la restauration avec `--replace` une fois la cause corrigée ; supprimer ensuite le dossier `.restore-…` indiqué. |
| « … contient déjà une base ou des fichiers » | Restauration sans `--replace` sur un dossier occupé. |
| « Archive altérée / tronquée / incomplète » | L'archive ne correspond plus à son manifeste : en prendre une autre. |
| « … une migration du schéma … que ce code ne connaît pas » | Restaurer avec la version de Codex qui a fait l'archive. |
| « La base restaurée ne correspond pas au manifeste » | Archive incohérente : rien n'a été remplacé ; en prendre une autre. |
| Attention : fichiers référencés absents du stockage | Déjà absents à la sauvegarde (listés dans le manifeste) : la sauvegarde est faite sans eux. |
| `codex-backup-….tar.partial` dans le dossier des sauvegardes | Sauvegarde interrompue par un arrêt brutal : à supprimer. |
| `.restore-…` dans le dossier de données | Restauration interrompue par un arrêt brutal, ou retour arrière qui n'a pas abouti (message ci-dessus) : vérifier que `pglite/` et `files/` sont en place (sinon relancer la restauration, avec `--replace` si l'un des deux l'est), puis le supprimer. |

## Limites

- Une seule instance : PGlite n'ouvre la base que dans un processus. Le jour où la base passera sur un Postgres serveur
  (point 51), la sauvegarde passera à `pg_dump` ou aux outils de l'hébergeur ; ce format d'archive est propre à PGlite.
- La base est vidée en mémoire (taille du dossier `pglite/`, quelques dizaines de Mo pour la démonstration) ; les
  fichiers sont copiés par morceaux.
- La mise en place d'une restauration n'est pas atomique : elle déplace des entrées une à une, et un arrêt brutal à ce
  moment (coupure, `kill -9`) laisse un état intermédiaire, sans retour arrière (voir « Dépannage », `.restore-…`).
- Pas de sauvegarde programmée par défaut (fréquence non décidée) : le planificateur la lance quand
  `CODEX_SCHEDULE_BACKUP` en donne la fréquence (`docs/exploitation.md` §4) ; toujours pas de chiffrement par Codex
  (volume à chiffrer, voir « Chiffrement ») ni de copie hors site (hébergement non décidé), pas de téléchargement de
  l'archive depuis l'application, pas de restauration depuis l'application (elle demande le serveur arrêté).
