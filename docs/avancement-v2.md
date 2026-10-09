# Intégration du modèle cible — état d'avancement (8 octobre 2026)

Le code suit le modèle de `docs/modele-cible.md`. Typecheck, lint et build passent sans erreur.

**Avant de relancer le serveur de développement** : arrêter le serveur, `npm run db:reset`, relancer. La migration
`drizzle/0000_init.sql` a été régénérée (8 octobre, après revue) : statut de révision `cancelled`, index uniques
(une lettre par document, une révision en vigueur, un circuit en cours par révision, une demande Vigie en attente par
document, un numéro de version de travail par révision) ; les données de démonstration ont aussi changé (rôles des
titulaires de fonctions, droit Administrer du gestionnaire, chronologie). Une base `.data/` existante ne peut pas la
recevoir.

## Fait
- `docs/modele-cible.md` : décisions validées avec l'utilisateur.
- `src/db/schema.ts` v2 : registre des types, familles, fonctions et titulaires, départements, sites, projets,
  programmes, révisions en lettres et versions de travail, demandes Vigie, lecteurs désignés, `workflows.outcome`.
- `src/db/registry.ts` : registre fusionné (69 types, 23 familles) ; points à arbitrer dans
  `docs/registre-points-ouverts.md`.
- `src/db/seed*.ts` : organisation provisoire, personnes et projets alignés sur Keystone, fonctions, titulaires,
  documents de démonstration (HLT-026, modèles FRM-QMS, départements, externes, recherche, circuits, demandes Vigie).
- `src/lib/` v2 : codification, cycle de vie, visibilité, conservation, stockage (local / SharePoint, non testé),
  Vigie, Keystone, contexte, requêtes, actions, textes FR / EN.
- Écrans : tableau de bord, explorateur (axes famille, département, projet, type, origine), recherche (facettes v2),
  fiche document (révisions et versions de travail, demandes de modification et de retrait, simulation Vigie),
  validations (« Mes demandes », circuits rejetés / approuvés), archivage (échéances de conservation, d'expiration et
  de revue ; règles du registre), administration (registre, fonctions et circuits, organisation, modèles QMS).
- Dialogues : création codifiée (depuis un modèle, un fichier ou sans fichier ; champs selon origine et rattachement),
  métadonnées et reclassement, version de travail, validation, demandes Vigie, lecteurs désignés, type du registre,
  titulaires, organisation.
- API : `/api/registry`, `/api/import`, `/api/integrations/vigie` (voir `docs/api.md`), fichier par version de travail
  (`/api/documents/[id]/file?v=…`), exports CSV.
- Vérification dans un navigateur sur une base neuve : tous les écrans et onglets pour chaque rôle simulé (FR / EN),
  création depuis un modèle, reclassement, circuit complet jusqu'à la mise en vigueur, demande de modification puis
  acceptation simulée de Vigie (ouverture de la révision suivante).

- Corrections après revue (8 octobre) : verrous et cycle de vie (mise en vigueur différée, retrait, gel levable,
  restauration), circuits (auteur exclu, titulaires habilités, droit Publier, reclassement figé), contrôles d'accès des
  actions (visibilité avant tout état), matrice des droits appliquée, versions de travail réservées au cercle, import
  (rejeu, conflit d'identifiant, type MIME), stockage hors transaction, accessibilité des dialogues et des listes.

## Reste à faire
- Dépôt de fichiers réels non vérifié dans le navigateur (création depuis un fichier, nouvelle version de travail).
- Stockage SharePoint : à tester contre un vrai tenant.
- Intégrations réelles Keystone (API projets) et Vigie (`VIGIE_API_URL`), authentification Entra ID.
- Arbitrages du registre (`docs/registre-points-ouverts.md`) et organigramme définitif.

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
