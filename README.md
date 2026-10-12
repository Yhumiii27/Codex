# Codex — GED Groupe

Gestion électronique des documents du groupe, construite d'après la maquette Claude Design
(`design/GED Groupe.dc.html`, design system Nocturne dans `design/_ds/`).

Même socle que Keystone : **Next.js 16 (App Router) · React 19 · PGlite (Postgres embarqué) + Drizzle**.

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
- Après une modification de `src/db/schema.ts` : tant qu'il n'y a pas de base de production, régénérer la migration
  unique (`rm -rf drizzle && npx drizzle-kit generate --name init`) puis `npm run db:reset`.
- Contrôles : `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`.
- Intégration continue GitHub Actions (`.github/workflows/ci.yml`) : `npm ci` puis ces contrôles, sous Node 22, à chaque push et PR.
- Tests : `npm test` lance Vitest une fois (`npm run test:watch` en continu), en une vingtaine de secondes, sans
  serveur ni réseau et sans toucher à `.data/`.
  - `tests/unit/` : règles pures (identifiants, révisions, visibilité, conservation, recherche, filtres mis en avant
    des départements, dates, expiration et revue périodique, types de fichiers).
  - `tests/integration/` : règles métier sur une base PGlite en mémoire, migrée depuis `drizzle/` avec le déclencheur
    du journal (`openDb` dans `src/db/index.ts`) et remplie de données minimales (`tests/support/fixtures.ts`), pas de
    la base de démo. Identifiants et compteurs, révisions et dates d'effet, cohérence des dates, expiration et revue
    périodique, circuits, décisions Vigie et webhook, journal en ajout seul, cercle de rédaction, import, recherche,
    recherches enregistrées et pages par département. Seul `tests/integration/dates.test.ts` charge aussi les données de démo (`src/db/seed.ts`), en
    mémoire, pour en vérifier toutes les dates.
    Les Server Actions y tournent avec `next/headers` et `next/cache` simulés (`tests/support/session.ts`) ;
    l'horloge est figée au 10 octobre 2026.
  - Limite : PGlite n'a qu'une connexion et exécute les transactions l'une après l'autre. Les tests d'attributions
    « simultanées » (`Promise.all`) vérifient l'absence de doublon sous cet entrelacement, pas l'atomicité des
    compteurs entre connexions d'un vrai serveur Postgres (étape 5, O-03) : il faudra un Postgres serveur pour la
    vérifier.

Variables : voir `.env.example` (Keystone, Vigie, dossier de données, jetons de l'API d'intégration).

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
| `/` | Tableau de bord : « À traiter » (étapes à décider, révisions à rédiger ou à reprendre, greffes possibles, revues et expirations des documents dont on est propriétaire ou propriétaire de processus), documents récents, échéances (conservation, expiration, revue), activité. La pastille d'Accueil et la cloche reprennent la même liste |
| `/explorateur` | Classement par famille, département, projet / programme, type ou origine ; filtres de statut et d'échéance dépassée (« Expirés », « Revues en retard ») ; aperçu rapide |
| `/documents/[id]` | Fiche document : aperçu, onglets Projet · Fiche · Révisions · Validation · Demandes · Historique ; indicateurs « Expiré » (raccourcis vers les demandes de modification et de retrait) et « Revue en retard », « Revue effectuée » ; documents liés (« Remplace », « Remplacé par », « Voir aussi »), remplacement proposé avec une demande de retrait et rappelé dans le bandeau d'un document obsolète |
| `/recherche` | Recherche plein texte classée par pertinence + facettes (projet, famille, type, sous-type, origine, rattachement, département, site, propriétaire, auteur, statut, échéance dépassée, confidentialité, langue, mots-clés, organisme source, phase, lot, discipline, thème), période sur une date (modification, émission, effet, révision, expiration), tri au choix, export CSV dans le même ordre ; recherches enregistrées (critères, période et tri) personnelles, ou partagées avec un département ou le groupe par un gestionnaire documentaire |
| `/departements/[code]` | Page d'un département (`/departements` ouvre celui de l'utilisateur, un sélecteur passe aux autres) : documents en vigueur, échéances, circuits en cours qu'il suit, recherches partagées avec le département et le groupe, filtres mis en avant (valeurs les plus fréquentes, chacune un lien vers la recherche filtrée), le tout limité à ce que l'utilisateur peut lire. Départements provisoires (organigramme attendu) ; filtres par défaut (type, statut, projet), réglables par département dans Administration › Organisation, en attendant le recueil des besoins de chaque métier |
| `/validations` | Circuits de validation : à valider, mes demandes, en cours, terminées ; approuver / rejeter (motif obligatoire) / déléguer, rappeler sa demande avant la dernière approbation, commentaires. Vue « Mes demandes Vigie » : demandes de modification et de retrait envoyées par l'utilisateur, avec leur statut |
| `/archivage` | Échéances (archivage, gel juridique, revue effectuée ; filtres « Expirés » et « Revues en retard »), règles de conservation du registre, archives |
| `/administration` | Registre des types (dont la périodicité de revue), fonctions & circuits, rôles & droits, organisation (départements et leurs filtres mis en avant, sites), modèles (QMS), journal d'audit (CSV) |

API : `/api/registry` (lu par Keystone), `/api/import` (outil de migration), `/api/integrations/vigie` (décisions
Vigie), `/api/documents/[id]/file` (fichier d'une version de travail), `/api/export/*` (CSV).

Tout l'état d'écran est dans l'URL (onglets, filtres, sélection) : les liens sont partageables.

## Ce qui est réel / simulé

- **Persisté** : création codifiée (`TYPE-CONTEXTE-SEQ`, depuis un modèle, un fichier ou sans fichier), versions de
  travail (A.1, A.2…), métadonnées (dates contrôlées : format, et émission ≤ effet < expiration) et reclassement
  (nouvel identifiant tant qu'aucune révision n'a été approuvée),
  lecteurs désignés, demandes de validation et décisions (mise en vigueur à l'approbation ou à la date d'effet),
  délégation, commentaires, demandes de modification et de retrait, revue périodique (« Revue effectuée », qui fixe la
  prochaine date de revue sans créer de révision), archivage, gel juridique, matrice des droits, registre des types
  (circuit, confidentialité, conservation, périodicité de revue), titulaires des fonctions, départements (et filtres mis
  en avant sur leur page) et sites. L'expiration et la revue en retard sont des indicateurs, sans nouveau statut : le
  retrait reste une demande à Vigie.
  Chacune de ces actions alimente le journal d'audit, de même que les téléchargements et les deux exports CSV. Le
  journal est en ajout seul : la base refuse toute modification ou suppression (déclencheur posé au démarrage,
  `src/db/index.ts`), et un reclassement ne réécrit pas les entrées, qui gardent l'identifiant de leur époque.
  L'horodatage est stocké en UTC et affiché à l'heure de Paris. Ne sont pas journalisés : les consultations (aperçu
  sans téléchargement) et le changement d'utilisateur ou de langue simulé.
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
  téléchargent sous forme d'un PDF généré.

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
  db/                  schéma Drizzle, connexion PGlite, données de démonstration
  lib/
    actions.ts         Server Actions (toutes les mutations + contrôles de droits)
    queries.ts         lectures et modèles de vue
    context.ts         langue, utilisateur et rôle simulés, registre, libellés, droits
    access.ts          visibilité (confidentialité, cercle de rédaction)
    lifecycle.ts       révisions : mise en vigueur, remplacement, décisions Vigie
    links.ts           liens entre documents : remplace / remplacé par, voir aussi
    codes.ts           identifiants TYPE-CONTEXTE-SEQ et lettres de révision
    retention.ts       fin de conservation
    review.ts          expiration et revue périodique : indicateurs, prochaine date de revue
    search.ts          recherche : facettes, période, tri, pertinence
    departments.ts     pages par département : filtres mis en avant
    storage.ts         stockage des fichiers (disque local ou SharePoint)
    filetypes.ts       types de fichier servis en ligne et affichés en aperçu
    keystone.ts, vigie.ts  frontières d'intégration
    importer.ts        API d'import (outil de migration)
    i18n.ts            textes FR / EN
tests/
  unit/                tests unitaires des règles pures de src/lib (Vitest, vitest.config.ts)
  integration/         tests d'intégration sur PGlite en mémoire (règles métier de src/lib, Server Actions, webhook)
  support/             base de test et données minimales, session simulée, remplacement de server-only
```

## Décisions et points ouverts

Les décisions prises avec l'utilisateur et les questions encore ouvertes sont dans `docs/decisions.md` ; le deck
d'origine et son audit dans `docs/sources/` et `docs/audit-deck-epc2i.md`. Voir aussi `docs/registre-points-ouverts.md`
(registre des types) et les points *provisoires* de `docs/modele-cible.md` (organisation, stockage SharePoint).
