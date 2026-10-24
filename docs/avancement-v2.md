# Intégration du modèle cible — état d'avancement (18 octobre 2026, fin du lot 9)

Le code suit le modèle de `docs/modele-cible.md`. `npm run typecheck`, `npm run lint`, `npm run db:check`, `npm test`
(Vitest), `npm run build` et `npm run a11y` (accessibilité) passent ; la CI les rejoue à chaque push
(`.github/workflows/ci.yml`), avec la suite de tests sur un serveur PostgreSQL 16 (version du serveur commun) et 18. Le détail de chaque étape est dans
`docs/historique.md` (§11 à §18), l'état de chacun des 129 points de l'inventaire du 9 octobre dans
`docs/reste-a-faire.md`.

**Schéma et base existante** (mis à jour le 17 octobre 2026) : `drizzle/0000_init.sql` a été régénérée jusqu'au lot 8
(dernière fois au commit `c80d6ae`) ; une base créée avant cette version doit être réinitialisée une dernière fois
(`npm run db:reset`), ce que le démarrage signale. Depuis, le schéma évolue par migrations incrémentales (`0001` à
`0004` au 18 octobre), appliquées au démarrage après une sauvegarde automatique, sans réinitialisation (README,
« Démarrer » ; point 41 de `docs/reste-a-faire.md`). Les évolutions du registre s'appliquent par
`npm run registry:apply` (point 60).

## Fait

**Modèle v2 (7 et 8 octobre).**
- `docs/modele-cible.md` : décisions de l'utilisateur et propositions à confirmer (voir `docs/decisions.md`).
- `src/db/schema.ts` v2 : registre des types, familles, fonctions et titulaires, départements, sites, projets,
  programmes, révisions en lettres et versions de travail, demandes Vigie, lecteurs désignés, `workflows.outcome`.
- `src/db/registry.ts` : registre fusionné (69 types, 23 familles) ; points à arbitrer dans
  `docs/registre-points-ouverts.md`.
- `src/db/seed*.ts` : organisation provisoire, personnes et projets alignés sur Keystone, fonctions, titulaires,
  documents de démonstration (HLT-026, modèles FRM-QMS, départements, externes, recherche, circuits, demandes Vigie).
- Écrans : tableau de bord, explorateur, recherche, fiche document (révisions et versions de travail, demandes de
  modification et de retrait, simulation Vigie), validations, archivage, administration ; dialogues de création
  codifiée, métadonnées et reclassement, version de travail, validation, demandes Vigie, lecteurs désignés, registre.
- API : `/api/registry`, `/api/import`, `/api/integrations/vigie` (`docs/api.md`), fichier par version de travail,
  exports CSV.
- Corrections après la revue du 8 octobre, et les trois corrections restées partielles (T-03), faites le 9 octobre :
  renommage des fichiers après un reclassement, type verrouillé au dépôt d'une pièce attendue, demandes filtrées selon
  la visibilité.

**Lots 1 à 9 (10 au 18 octobre)** : les 69 points de `docs/reste-a-faire.md` développables sans décision, dont 55
entièrement et 14 en partie.
- **Cercle de rédaction et journal** (points 26 à 30, 33, 22, 28) : brouillons invisibles hors du cercle de rédaction
  (D-14), journal en ajout seul refusé à la modification par la base, administration, commentaires et exports
  journalisés, valeurs avant et après des métadonnées, consultations journalisées, historique de la fiche en trois vues.
- **Vigie** (points 1, 34, 35, D-26) : « Mes demandes Vigie », modificateur désigné contrôlé, décision acceptée gardée
  pendant un verrou, greffe ou attente d'une modification quand une révision est ouverte.
- **Fonctions du deck** (points 2 à 13, 16, 18, 21, 63 à 68) : recherches enregistrées et partagées, facettes, période
  et tri, pages par département, dates contrôlées, expiration et revue périodique, rejet motivé et rappel, « À
  traiter » complet, liens « remplace » et « voir aussi », fiche de visa, auteur désigné, modèles rattachés aux types et
  leurs utilisations, conservation par document et dates d'événement, phases Keystone, « Restaurer », bilinguisme.
- **Contenu des fichiers** (points 14, 15, 31, 32, 46, 64) : formats admis, macros refusées, antivirus, taille unique,
  fichiers servis en flux avec plages d'octets, empreintes SHA-256 et contrôle d'intégrité, comparaison du texte de
  deux versions, aperçu PDF des fichiers Office par un service de conversion.
- **Exploitation** (points 17, 19, 23 à 25, 36 à 41, 44, 45, 47 à 51, 56, 58 à 62) : en-têtes de sécurité et
  limites de débit, signature HMAC des échanges entre serveurs, sauvegarde et restauration, export complet, journal
  technique et santé, contrôle de la configuration, planificateur, pages d'erreur traçables, index, lectures ciblées
  par écran, recherche et listes en SQL, PostgreSQL serveur en option, mesures sur gros volume, migrations
  incrémentales, amorçage minimal, administration du registre, des programmes et de l'organisation, vocabulaires
  contrôlés, reprise des documents d'une personne qui part.
- **Qualité** (points 20, 42, 43, 52, 53 à 55, 57, 69) : détection des modifications simultanées, police dans le dépôt,
  version de Node déclarée, Vitest (unitaires et intégration sur PGlite en mémoire, ou sur PostgreSQL avec
  `npm run test:pg`), CI GitHub Actions, contrôle d'accessibilité axe-core (`docs/accessibilite.md`), page d'aide
  bilingue (`/aide`), documentation alignée sur le code.
- Vérification dans un navigateur à chaque étape (Chromium, copie de la base de démonstration), décrite dans
  `docs/historique.md`.

- Bascule PostgreSQL (17 octobre, décision M-01, plan `docs/architecture-postgres.md` § 6 du dépôt Matrix) : tables
  dans le schéma `codex` (`pgSchema`), migrateur propre (`src/db/migrate.ts`), deux modes (`DATABASE_URL` : serveur
  commun en `codex_app` ; sinon PGlite), verrou d'écriture, garde-fou contre une base PGlite antérieure, migration
  `partage` (colonnes D01, D10, D15, index D18, 7 vues `pub_`). Essayé dans les deux modes : écrans, registre, deux
  instances simultanées, 20 imports simultanés (20 identifiants distincts), déclaration à Matrix (22 tables).
  **Une base `.data/` antérieure est refusée** : `npm run db:reset`.
- Lot 11 (22 octobre) : réunion de la branche v2 et de cette bascule, par un commit de fusion. Le mécanisme de la
  branche est gardé (migrations incrémentales, refus d'une base d'un autre schéma, sauvegarde avant migration,
  `npm run db:migrate`, verrous en `READ COMMITTED`), adapté au schéma `codex` : `src/db/migrate.ts` et le verrou
  d'écriture global de la bascule sont remplacés par `src/db/migrations.ts`. Base de migrations refaite
  (`0000_init` complète, `0001_partage`) ; une base PGlite de la branche d'avant le lot 11 est reprise
  automatiquement, une autre est refusée avec son remède. Détail : `docs/historique.md` § 20, `docs/postgres.md`.

## Reste à faire

Classé selon ce qui le bloque : le détail est en tête de `docs/reste-a-faire.md`.
- **Développable sans décision** : les restes de sept points faits en partie (36, 43, 46, 47 et 50, 51, 52, 57) :
  noms provisoires à reprendre, `.nvmrc`, aperçu paginé, Validations paginé, revue des transactions sur PostgreSQL,
  `npm audit`, tests de bout en bout.
- **Décisions de l'utilisateur** (O-01 à O-11 de `docs/decisions.md`, questions de l'audit) : 49 points, dont
  l'activation de SharePoint et son test sur un vrai tenant (O-01), l'authentification réelle (O-02 ; Entra ID est
  proposé, non confirmé), la liaison avec Keystone (O-03) et Vigie (`VIGIE_API_URL`, O-10), l'organigramme (O-04),
  les arbitrages du registre (O-05), les circuits et leurs titulaires (O-06), les durées de conservation (O-07), la
  conservation par révision remplacée (O-09, seul reste de T-03), l'hébergement (M22) et la formation (M14).
- **Données de l'utilisateur** : les vrais modèles EPC2I, la date de clôture de l'exercice.
- **App Mac** : les corrections ci-dessous, et le test du dépôt et du téléchargement dans sa fenêtre (T-02), sur
  macOS.

## App Mac (`npm run app`) — corrections restantes (relecture du 8 octobre)
Corrigé : `npm run app` refuse avant toute compilation si Codex est ouvert ; l'alias du bureau et les bundles ne sont
supprimés que s'ils sont bien Codex. Reste à corriger dans `desktop/CodexApp.swift` / `build-app.sh` :
- le message « Compilation de Codex… » n'apparaît pas (status() avant le chargement de la page de statut) ;
- quitter pendant la compilation laisse `next build` tourner (le suivre et l'arrêter avec le serveur) ;
- needsBuild() ignore `.env*` et `tsconfig.json` ;
- un téléchargement (erreur WebKit 102) peut être pris pour une panne quand le serveur 3110 était déjà lancé ;
- ⇧⌘H ou « Réessayer » pendant le démarrage relancent start() en parallèle (garde « démarrage en cours ») ;
- pas d'élément « Fermer » ⌘W dans les menus ;
- copie de l'app laissée dans `desktop/dist` (indexée par Spotlight) : construire dans un dossier temporaire ;
- signature ad hoc : macOS redemande l'accès au dossier Téléchargements après chaque reconstruction de l'app.
