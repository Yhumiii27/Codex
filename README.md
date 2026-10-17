# Codex — GED Groupe

Gestion électronique des documents du groupe, construite d'après la maquette Claude Design
(`design/GED Groupe.dc.html`, design system Nocturne dans `design/_ds/`).

Même socle que Keystone : **Next.js 16 (App Router) · React 19 · PGlite (Postgres embarqué) + Drizzle**. En
ligne, Codex utilise le serveur PostgreSQL commun EPC2I (schéma `codex`) ; PGlite reste la base de repli.

## Démarrer

```bash
npm install
npm run dev        # http://localhost:3100
```

Au premier lancement, la base locale est créée dans `.data/` (migrations `drizzle/`) et remplie avec les
données de démonstration (registre des types, organisation provisoire, projets Keystone, documents). Les fichiers
déposés sont stockés dans `.data/files/` (ou dans SharePoint, voir `src/lib/storage.ts`).

- Repartir de zéro : arrêter le serveur, `npm run db:reset`, relancer. **Obligatoire après le passage au modèle v2** :
  une base créée avec l'ancien modèle ne peut pas recevoir la nouvelle migration.
- **Obligatoire aussi après le passage au schéma `codex`** : une base PGlite dont les tables sont dans `public` est
  refusée au démarrage (« Base PGlite antérieure au schéma codex »).
- Migrations (`drizzle/`) : `0000_init` (migration de base) puis `0001_partage` (prérequis du partage générés par
  drizzle-kit, puis vues `pub_` lues par Keystone, Vigie et Matrix, écrites à la main d'après
  `infra/postgres/partage/40-codex.sql` du dépôt Matrix).
- Après une modification de `src/db/schema.ts` : nouvelle migration incrémentale (`npx drizzle-kit generate --name
  <objet>`). Tant qu'il n'y a pas de données à garder sur le serveur commun, on peut encore régénérer la migration de
  base (`rm -rf drizzle && npx drizzle-kit generate --name init`), à condition de recopier ensuite les vues `pub_` dans
  la migration suivante ; puis `npm run db:reset`.
- Contrôles : `npm run typecheck`, `npm run lint`, `npm run build`.

Variables : voir `.env.example` (Keystone, Vigie, dossier de données, base, jetons de l'API d'intégration).

### Deux modes de base

| `DATABASE_URL` | Base | Remplissage de démonstration |
| --- | --- | --- |
| absente ou vide | PGlite dans `$CODEX_DATA_DIR/pglite` (développement, application Mac) | toujours, si la base est vide |
| `postgres://codex_app:…@hôte:5432/epc2i` | serveur PostgreSQL commun EPC2I, schéma `codex` | seulement avec `CODEX_SEED_DEMO=1` |

Le code est le même dans les deux cas : les tables sont déclarées dans le schéma `codex` (`pgSchema` de
`src/db/schema.ts`), aussi dans PGlite. Au démarrage, `src/db/migrate.ts` applique les migrations de `drizzle/`, avec
le journal dans `codex.__drizzle_migrations`. Sur le serveur, le schéma et le rôle `codex_app` sont créés par le socle
(dépôt Matrix, `infra/postgres/`) ; `codex_app` n'a aucun droit hors du schéma `codex`. `next build` n'ouvre jamais le
serveur commun.

Sur le serveur commun, chaque transaction prend d'abord le verrou d'écriture de Codex
(`pg_advisory_xact_lock(hashtext('codex.ecritures'))`) : les écritures passent l'une après l'autre, comme dans PGlite,
et les identifiants `TYPE-CONTEXTE-SEQ` calculés dans la transaction restent distincts entre plusieurs instances. Les
droits de lecture des vues `pub_` par les autres outils sont posés par le socle (`partage/90-droits.sql`), hors de
Codex.

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
  journal dans `~/Library/Logs/Codex/server.log` (menu Présentation › Afficher le journal du serveur) ;
- ouvre les liens Keystone / Vigie dans le navigateur, enregistre les téléchargements dans `~/Téléchargements`.

L'app pointe vers ce dossier de projet et vers le Node.js présents au moment de la construction : relancer
`npm run app` après un déplacement du projet ou un changement de Node. Pour repartir d'une base de démo neuve :
quitter l'app et supprimer `~/Library/Application Support/Codex/data`.

## Écrans

| Route | Écran |
| --- | --- |
| `/` | Tableau de bord : à valider, documents récents, échéances (conservation, expiration, revue), activité |
| `/explorateur` | Classement par famille, département, projet / programme, type ou origine ; filtres de statut ; aperçu rapide |
| `/documents/[id]` | Fiche document : aperçu, onglets Projet · Fiche · Révisions · Validation · Demandes · Historique |
| `/recherche` | Recherche plein texte + facettes (projet, famille, type, origine, rattachement, département, statut, confidentialité), export CSV |
| `/validations` | Circuits de validation : à valider, mes demandes, en cours, terminées ; approuver / rejeter / déléguer, commentaires |
| `/archivage` | Échéances (archivage, gel juridique), règles de conservation du registre, archives |
| `/administration` | Registre des types, fonctions & circuits, rôles & droits, organisation, modèles (QMS), journal d'audit (CSV) |

API : `/api/registry` (lu par Keystone), `/api/import` (outil de migration), `/api/integrations/vigie` (décisions
Vigie), `/api/documents/[id]/file` (fichier d'une version de travail), `/api/export/*` (CSV).

Tout l'état d'écran est dans l'URL (onglets, filtres, sélection) : les liens sont partageables.

## Ce qui est réel / simulé

- **Persisté** : création codifiée (`TYPE-CONTEXTE-SEQ`, depuis un modèle, un fichier ou sans fichier), versions de
  travail (A.1, A.2…), métadonnées et reclassement (nouvel identifiant tant qu'aucune révision n'a été approuvée),
  lecteurs désignés, demandes de validation et décisions (mise en vigueur à l'approbation ou à la date d'effet),
  délégation, commentaires, demandes de modification et de retrait, archivage, gel juridique, matrice des droits,
  registre des types (circuit, confidentialité, conservation), titulaires des fonctions, départements et sites.
  Chaque action alimente le journal d'audit.
- **Utilisateur et rôle simulés** (pas d'authentification pour l'instant) : cliquer sur le profil en bas de la
  barre latérale. La navigation suit les règles de la maquette (validations masquées pour l'auditeur, archivage
  masqué pour le collaborateur, administration réservée au gestionnaire), les actions vérifient la matrice des
  droits côté serveur et la visibilité suit `src/lib/access.ts` (confidentialité, cercle de rédaction).
- **Keystone simulé** : les projets (phase, client, pièces attendues, événements) viennent de tables locales, lues
  par `src/lib/keystone.ts`, seul fichier à remplacer par des appels API quand Keystone exposera les siennes.
- **Vigie simulé** : les demandes de modification (ECR) et de retrait sont enregistrées par `src/lib/vigie.ts` ; tant
  que `VIGIE_API_URL` n'est pas défini, un gestionnaire documentaire simule la décision depuis l'onglet Demandes.
  Le webhook `/api/integrations/vigie` applique les décisions réelles.
- **Aperçu** : un PDF ou une image déposés s'affichent dans la fiche ; les documents de démonstration (sans
  fichier) gardent la page maquette et se téléchargent sous forme d'un PDF généré.

## Organisation du code

```
src/
  app/                 routes (pages serveur) + styles par écran (*.module.css)
    nocturne.css       design system Nocturne (copie de design/_ds/…/styles.css)
    globals.css        règles d'application communes
    api/               fichiers, exports CSV, registre, import, webhook Vigie
  components/
    shell/             barre latérale, en-tête, contexte client (dialogues, toasts)
    dialogs/           toutes les boîtes de dialogue
    ui/                icônes de la maquette, contrôle segmenté, steppers, boutons d'action
  db/                  schéma Drizzle, connexion (PGlite ou serveur commun), migrations, données de démonstration
  lib/
    actions.ts         Server Actions (toutes les mutations + contrôles de droits)
    queries.ts         lectures et modèles de vue
    context.ts         langue, utilisateur et rôle simulés, registre, libellés, droits
    access.ts          visibilité (confidentialité, cercle de rédaction)
    lifecycle.ts       révisions : mise en vigueur, remplacement, décisions Vigie
    codes.ts           identifiants TYPE-CONTEXTE-SEQ et lettres de révision
    retention.ts       fin de conservation
    storage.ts         stockage des fichiers (disque local ou SharePoint)
    keystone.ts, vigie.ts  frontières d'intégration
    importer.ts        API d'import (outil de migration)
    i18n.ts            textes FR / EN
```

## Décisions et points ouverts

Les décisions prises avec l'utilisateur et les questions encore ouvertes sont dans `docs/decisions.md` ; le deck
d'origine et son audit dans `docs/sources/` et `docs/audit-deck-epc2i.md`. Voir aussi `docs/registre-points-ouverts.md`
(registre des types) et les points *provisoires* de `docs/modele-cible.md` (organisation, stockage SharePoint).

## Mise en ligne (Docker, Coolify)

Le `Dockerfile` à la racine compile l'application et lance `next start`. Réglages à donner à l'hébergeur :

| Réglage | Valeur |
| --- | --- |
| Port interne | `3000` |
| Volume persistant | `/data` (fichiers dans `/data/files` ; base PGlite de repli dans `/data/pglite`) |
| Variables disponibles au build | `NEXT_PUBLIC_KEYSTONE_URL`, `NEXT_PUBLIC_VIGIE_URL` : adresses publiques de Keystone et de Vigie |
| Variables d'exécution seulement | `DATABASE_URL` (serveur commun, rôle `codex_app`), `CODEX_DB_POOL`, `CODEX_SEED_DEMO` (voir `.env.example`) |

- Les deux adresses sont figées dans l'application au moment du build : après les avoir modifiées, il faut redéployer.
- `DATABASE_URL` ne doit jamais être disponible au build ni écrite dans l'image. Dans Coolify, Codex et le serveur
  PostgreSQL doivent partager un réseau (dépôt Matrix, `infra/postgres/README.md`).
- Le build télécharge la police Inter depuis Google Fonts : le serveur de build doit avoir accès à Internet.
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
