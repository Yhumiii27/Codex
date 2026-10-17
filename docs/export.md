# Export complet de Codex (réversibilité)

Point 17 de `docs/reste-a-faire.md` (M22 de l'audit, pour la partie « export ») : une archive qui contient toutes les
données de Codex et tous ses fichiers, pour quitter Codex ou alimenter un autre système. Le reste de M22 (délai de
reprise, perte de données tolérée, hébergement) relève de l'exploitation et reste une question ouverte.

Code : `src/lib/export-core.mjs` (archive), `src/lib/full-export.ts` et `src/app/api/export/full/route.ts`
(téléchargement), `scripts/codex-export.mjs` (commande). Tests : `tests/unit/export-core.test.ts`,
`tests/integration/full-export.test.ts`, `tests/integration/export-command.test.ts`.

L'export n'est pas une sauvegarde : pour remettre Codex dans l'état d'une date, on restaure une sauvegarde
(`docs/sauvegarde.md`), qui contient la base elle-même. L'export donne les mêmes données dans des formats ouverts
(JSON, CSV, fichiers sous un nom lisible), lisibles sans Codex.

## Obtenir un export

**Depuis l'application** : Administration › Journal d'audit › Export complet › « Télécharger l'archive (ZIP) ».

- Réservé aux gestionnaires documentaires qui ont l'accès Administration (`mayExportAll`, `src/lib/access.ts`), comme
  la sauvegarde. Tout autre utilisateur reçoit 403, et la ligne ne lui est pas montrée.
- L'archive contient tout, brouillons et documents confidentiels compris, sans le filtre de D-14 : c'est un export
  d'administration. Elle n'est pas chiffrée : à conserver en lieu sûr.
- Elle est écrite au fil du téléchargement (`GET /api/export/full`) : rien n'est chargé en entier en mémoire, et le
  téléchargement commence aussitôt. `HEAD` répond avec les mêmes contrôles, sans rien exporter ni journaliser.
- Compté dans le budget des exports (`CODEX_RATE_EXPORTS`, 30 par minute et par utilisateur par défaut ; README,
  « Sécurité HTTP et limites de débit ») : au-delà, 429 sans rien exporter ni journaliser.
- Journalisé deux fois (voir « Journal ») : au début, et à la fin avec la taille et le SHA-256 de l'archive.

**En ligne de commande**, serveur arrêté (PGlite n'ouvre la base que dans un processus) :

```bash
npm run export                                  # dans <dossier de données>-exports/ (.data-exports/ par défaut)
npm run export -- --out /mnt/transfert/         # dans ce dossier
npm run export -- --out /mnt/transfert/codex.zip
npm run export:check -- /mnt/transfert/codex.zip   # relit l'archive entière
```

- Même archive que depuis l'application. La commande l'écrit sous un nom provisoire (`.partial`), la relit entièrement
  (CRC-32 et SHA-256 de chaque élément, manifeste, `SHA256SUMS`), puis lui donne son nom. Dossier créé en `0700`,
  archive en `0600`. Jamais dans le dossier de données (`npm run db:reset` l'effacerait). `.data-exports/` est ignoré
  par git.
- Elle prend le verrou du dossier de données (`codex.lock`, comme `npm run backup`) : refusée tant que le serveur
  tourne, elle le dit et renvoie vers l'export depuis l'application.
- Variables lues comme Next (`@next/env`) : l'environnement, puis les fichiers `.env` de `next start`, ou ceux de
  `next dev` avec `--dev`. App Mac : `CODEX_DATA_DIR="$HOME/Library/Application Support/Codex/data" npm run export`,
  app quittée.
- L'export est journalisé dans la base sous l'acteur système Codex. Les fichiers conservés par SharePoint ne sont pas
  lus par la commande : ils sont listés dans le manifeste (`files.skipped`) et la commande le signale. Pour les
  inclure, exporter depuis l'application.

## Contenu de l'archive

```
codex-export-2026-10-15T16-53-07-587Z.zip
  LISEZMOI.txt                         ce que contient l'archive, comment la vérifier
  data/<table>.json                    chaque table de la base, ligne par ligne (24 tables)
  data/audit_log.json                  dont le journal d'audit, du plus ancien au plus récent
  data/documents.csv                   les métadonnées des documents, pour un tableur
  files/{ID}/{ID}_{lettre}.{n}.{ext}   le fichier de chaque version de travail
  import/documents.json                chaque document au format de POST /api/import, avec le fichier à envoyer
  SHA256SUMS                           empreinte de chaque élément ci-dessus (sha256sum -c)
  manifest.json                        écrit en dernier : date, schéma, comptes, taille et SHA-256 de chaque élément
```

### Cohérence

Toutes les tables, sauf le journal, sont copiées dans des tables temporaires en une seule transaction (quelques
secondes ; les écritures attendent pendant ce temps, comme pour une sauvegarde), puis relues par lots. Le journal,
en ajout seul et écrit une transaction après l'autre, est exporté jusqu'à la dernière entrée de cette transaction.
Ce qui est modifié pendant le téléchargement n'entre donc pas dans l'archive. Les fichiers sont lus au fil de
l'export ; un fichier stocké n'est jamais réécrit, et un fichier renommé entre-temps par un reclassement est retrouvé
sous la clé que sa version de travail porte désormais.

L'entrée de journal « Export complet » est écrite dans cette même transaction : l'archive la contient. L'entrée de
fin, écrite après, n'y est pas.

### Format ZIP

- Éléments **stockés sans compression** (les fichiers déposés sont en général déjà compressés), sans chiffrement,
  noms en UTF-8. Taille et CRC-32 de chaque élément sont écrits après ses octets (descripteur de données, bit 3), ce
  qui permet d'écrire l'archive en flux. Les enregistrements Zip64 sont ajoutés quand l'archive dépasse 4 Go ou
  65 534 éléments ; un élément de 4 Go ou plus est refusé (un fichier de Codex est limité à `CODEX_MAX_FILE_MB`).
- Vérifiée avec `unzip -t`, `zipfile` de Python et `sha256sum -c` après extraction, Zip64 compris. Les autres outils
  qui lisent le répertoire central (7-Zip, Explorateur Windows, utilitaire d'archive de macOS,
  `java.util.zip.ZipFile`) suivent le même format (APPNOTE 6.3), sans avoir été essayés ici. Les lecteurs « en flux »
  qui ne lisent pas le répertoire central (`java.util.zip.ZipInputStream`) ne savent pas lire un élément stocké suivi
  d'un descripteur.
- Fichiers extraits en `0600` (lecture et écriture par leur propriétaire seul) par les outils Unix qui appliquent les
  droits enregistrés.

## `manifest.json`

| Champ | Contenu |
|---|---|
| `format`, `version` | `"codex-export"`, `1` |
| `createdAt` | Instant (UTC) de la copie des tables |
| `mode`, `by` | `online` et l'identifiant de l'utilisateur (application), ou `offline` et `cli` (commande) |
| `app` | Version de Codex (`package.json`) |
| `schema` | `migration` (dernière migration appliquée à la base, ex. `0000_init`), `hash` (son SHA-256), `postgres` (version) |
| `counts` | Nombre de lignes de chaque table exportée (clé : nom de la table), et `files` : fichiers dans l'archive |
| `tables` | Élément de chaque table (`"documents": "data/documents.json"`) |
| `files` | `count` et `bytes` des fichiers archivés ; `missing` : versions de travail dont le stockage n'avait pas le fichier (`workingVersion`, `path` prévu) ; `skipped` : fichiers d'un stockage que ce processus ne peut pas lire (SharePoint depuis la commande, ou SharePoint non configuré), avec `storage` ; `altered` : fichiers archivés dont le SHA-256 diffère de celui enregistré à leur dépôt (`workingVersion`, `path`, `recorded` : l'empreinte enregistrée), archivés tels qu'ils sont stockés |
| `entries` | Chaque élément sauf le manifeste : `name`, `size`, `sha256`, et `workingVersion` (identifiant de la version de travail) pour un fichier |

## `data/<table>.json`

Un tableau JSON par table, un objet par ligne, une ligne par ligne de texte. Les champs portent les noms de
`src/db/schema.ts` (`label_fr` en base devient `labelFr`), qui sont aussi ceux de l'API d'import ; les lignes sont
dans l'ordre de la clé primaire (le journal par identifiant croissant).

| Table | Contenu |
|---|---|
| `documents` | Fiche de chaque document : identifiant et anciens identifiants (`aliases`), référence d'origine d'un document importé (`legacyRef`), axes de classement, type, département, site, propriétaire, auteur, confidentialité, mots-clés, état (`active`, `obsolete`, `archived`), statut affiché, lettres de la révision en vigueur et de celle en cours, dates, classe de conservation, champs des documents externes, de projet et de recherche, propriétaire de processus, gel juridique, `version` (détection des modifications simultanées) |
| `revisions` | Révisions A, B… : statut (`draft`, `in_review`, `approved`, `in_force`, `superseded`, `cancelled`), dates d'approbation, d'effet, de mise en vigueur et de remplacement, modificateur désigné, ordre de modification qui l'a ouverte |
| `working_versions` | Versions de travail A.1, A.2… : révision (`revisionId`), numéro, commentaire, auteur, date, fichier (`storage`, `fileKey`, `fileName` d'origine, `mime`, `size`, `pages`, `sha256` : empreinte calculée à son entrée dans Codex, nulle pour un fichier stocké avant qu'elle soit calculée). Le fichier est dans `files/`, retrouvé par `entries[].workingVersion` du manifeste |
| `document_readers` | Lecteurs désignés des documents confidentiels et très confidentiels |
| `template_types` | Types cibles des modèles (FRM) : « Nouveau depuis un modèle » les propose d'abord pour ces types |
| `document_links` | Liens entre documents : `sourceId` remplace `targetId` (`replaces`), ou renvoi mutuel (`see_also`) |
| `workflows`, `workflow_steps`, `workflow_comments` | Circuits de validation (révision, demandeur, échéance, étape courante, issue, motif), leurs étapes (fonction, titulaire, date de décision, signature), leurs commentaires |
| `change_requests` | Demandes de modification et de retrait suivies par Vigie : statut, ECO, modificateur désigné, révision qui les porte, remplaçant proposé, dates |
| `families`, `doc_types` | Registre : familles, types (origines, rattachements, sous-types, circuit, conservation, confidentialité, revue périodique) |
| `functions`, `function_holders` | Fonctions des circuits et leurs titulaires (par groupe, département, projet ou programme) |
| `departments`, `sites`, `users` | Organisation : départements, sites, personnes (et acteurs système Codex, Keystone, Vigie) |
| `projects`, `project_expected`, `project_events` | Projets Keystone (simulés), pièces attendues, événements |
| `research_programs` | Programmes de recherche |
| `role_permissions` | Matrice des droits par rôle |
| `saved_searches` | Recherches enregistrées, personnelles et partagées |
| `id_counters` | Dernier numéro attribué par séquence (identifiants, circuits, demandes) : pour reprendre la numérotation |
| `audit_log` | Journal d'audit : instant, utilisateur, action, document (sous son identifiant de l'époque) ou cible, détail, données structurées (avant → après, export, lien…), révision |

N'est pas exportée : `document_terms`, l'index de la recherche, que la base recalcule à partir des documents.

Valeurs : texte et nombres tels quels ; dates `AAAA-MM-JJ` ; `audit_log.at` en UTC avec son décalage
(`2026-10-15T16:53:07.587+00:00`) ; les horodatages sans fuseau (`change_requests.createdAt` et `decidedAt`,
`projects.syncedAt`, `project_events.at`) en heure de Paris (`2026-10-02T09:00:00`) ; les colonnes JSON telles
quelles. Un texte saisi une fois est une chaîne ; un libellé système ou de démonstration est `{"fr": …, "en": …}`.

## `data/documents.csv`

Les colonnes de `data/documents.json`, sous les mêmes noms, une ligne par document : UTF-8 avec BOM, point-virgule,
fins de ligne CRLF, comme les autres exports CSV de Codex (Excel en français l'ouvre tel quel). Les listes (anciens
identifiants, mots-clés) sont jointes par une virgule ; une cellule qui commence par `=`, `+`, `-`, `@` est précédée
d'une apostrophe pour qu'un tableur ne l'exécute pas. Le JSON reste la référence exacte.

## `files/`

Le fichier de chaque version de travail qui en a un : `files/{ID}/{ID}_{lettre}.{n}.{ext}`, par exemple
`files/PRO-QUA-0001/PRO-QUA-0001_B.2.pdf`. L'identifiant est celui du document au moment de l'export ; l'extension
est celle du nom d'origine (`fileName`), sinon celle de la clé de stockage. Tous les fichiers sont exportés, pas
seulement le final de la révision en vigueur.

## `import/documents.json` et réimport par `POST /api/import`

Un élément par document : `id`, `state`, `legalHold`, `meta` (le champ `meta` de `POST /api/import`, `docs/api.md`),
`file` (chemin du fichier à envoyer dans l'archive, ou `null`), `fileName` et `mime` (nom d'origine et type, pour la
partie `file`).

| Champ de `meta` | Source |
|---|---|
| `legacyRef` | `documents.id`. Le Codex qui importe garde cet identifiant s'il est au format de son type et de son contexte et libre ; sinon il en attribue un et garde celui-ci comme ancienne référence |
| `title`, `typeCode`, `subtype`, `origin`, `attachment`, `department`, `site`, `ownerId`, `conf`, `keywords`, `lang`, `issuedAt`, `reviewDueAt`, `expiresAt`, `createdAt`, `modifiedAt` | Colonnes de même nom de `documents` |
| `projectCode`, `programCode` | Selon le rattachement (projet, recherche) |
| `author` | `authorId`, sinon `authorText` |
| `readers` | `document_readers`, pour un document confidentiel ou très confidentiel seulement |
| `revision`, `status`, `inForceAt` | La révision en vigueur (`in_force`, à sa date de mise en vigueur) ; sinon une révision approuvée avec sa date d'effet (`in_force` à cette date : l'import la laisse approuvée jusque-là si elle est à venir) ; sinon la dernière révision, en brouillon (`draft`) |
| `sourceOrg`, `externalRef`, `receivedAt` | Document externe |
| `projectPhase`, `workPackage`, `discipline` | Document de projet |
| `researchTheme`, `studyId`, `ipStatus` | Document de recherche |
| `processOwnerId` | Document interne |
| `file` (partie du formulaire) | Le fichier de la dernière version de travail de cette révision, s'il est dans l'archive |

Les valeurs vides sont omises ; `comment` n'est pas fourni (l'import écrit « Reprise de {legacyRef} »).

`POST /api/import` ne reprend qu'**une** révision par document. Restent dans `data/`, sans équivalent dans l'import :
les révisions antérieures et leurs versions de travail, les circuits et leurs commentaires, les demandes Vigie, les
liens entre documents (O-11), l'état obsolète ou archivé et le gel juridique (un document importé est actif ;
`state` et `legalHold` permettent de l'écarter ou de le traiter à part), la classe de conservation propre au document
(l'import prend celle du type), les anciens identifiants, et le journal.

Le Codex qui importe doit connaître les mêmes codes : types actifs du registre, départements, sites, utilisateurs,
projets et programmes (`docs/api.md`, « Règles appliquées »). Exemple, depuis l'archive extraite, documents actifs
seulement :

```bash
export CODEX=https://codex.exemple CODEX_IMPORT_TOKEN=…
jq -c '.[] | select(.state == "active")' import/documents.json | while read -r doc; do
  meta=$(jq -c .meta <<<"$doc")
  file=$(jq -r '.file // empty' <<<"$doc")
  if [ -n "$file" ]; then
    curl -s -X POST "$CODEX/api/import" -H "Authorization: Bearer $CODEX_IMPORT_TOKEN" \
      --form-string "meta=$meta" -F "file=@$file;type=$(jq -r .mime <<<"$doc")"
  else
    curl -s -X POST "$CODEX/api/import" -H "Authorization: Bearer $CODEX_IMPORT_TOKEN" \
      -H 'Content-Type: application/json' -d "$meta"
  fi
  echo
done
```

Le 409 `duplicate` rend la boucle rejouable. `tests/integration/full-export.test.ts` réimporte ainsi un document
dans une base vide : même identifiant, même révision en vigueur, même fichier.

## Vérifier une archive

```bash
npm run export:check -- codex-export-….zip     # avec Codex : CRC-32, SHA-256, manifeste, SHA256SUMS
unzip -q codex-export-….zip -d export && cd export && sha256sum -c SHA256SUMS   # sans Codex
```

Le SHA-256 de l'archive entière est inscrit au journal quand le serveur a fini de l'envoyer (entrée « Export complet
envoyé ») : il permet de reconnaître plus tard une archive comme celle que le serveur a envoyée. Le serveur ne sait pas
si le navigateur l'a reçue en entier (voir « Journal ») : un fichier téléchargé n'est complet que si `npm run
export:check` le trouve intact, ou si son SHA-256 (`sha256sum codex-export-….zip`) est celui du journal.

## Journal

| Action | Quand | Détail (nombres et tailles montrés aux seuls gestionnaires documentaires) |
|---|---|---|
| « Export complet » (`export_full`) | Au début, dans la transaction de la copie (l'archive la contient) | Documents, fichiers à exporter et leur taille enregistrée |
| « Export complet envoyé » (`export_full_end`) | À la fin de l'envoi | Archive entièrement envoyée par le serveur : fichiers écrits, absents du stockage, non inclus (SharePoint), taille et début du SHA-256 de l'archive. Ou « interrompu » (téléchargement arrêté pendant l'envoi) ou « échec », après combien d'octets |

Cible : « Export · toutes les données et tous les fichiers ». Aucun document n'y est nommé. Un serveur arrêté pendant
le téléchargement ne laisse que l'entrée de début.

« Envoyé » ne veut pas dire « reçu » : l'entrée est écrite quand le serveur a remis les derniers octets à la connexion,
et il ne peut pas savoir si le client les a tous reçus. Une archive qui tient dans les tampons du serveur et du réseau
(quelques centaines de Ko, comme celle de la base de démonstration) est donc inscrite comme envoyée même si le
téléchargement est coupé ensuite ; seule une coupure pendant l'envoi est inscrite « interrompu ». Pour savoir si un
fichier téléchargé est complet, le vérifier (`npm run export:check`) ou comparer son SHA-256 à celui du journal.

Le journal technique (`docs/exploitation.md`) porte aussi une entrée de `scope` `export` à la fin de l'envoi, à
l'interruption ou à l'échec, et quand la fin de l'export n'a pas pu être inscrite au journal d'audit ou que ses tables
temporaires n'ont pas pu être supprimées (niveau `warn`).
