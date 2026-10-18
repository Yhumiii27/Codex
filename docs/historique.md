# Historique du travail sur Codex (7 → 9 octobre 2026)

Ce fichier explique comment le code en est arrivé là. Il résume une session Claude Code locale, sur Mac, dont la
conversation et les résultats de workflows ne sont pas dans le dépôt. Il permet de reprendre le travail, en particulier
depuis une session cloud, sans reposer des questions déjà tranchées.

- Décisions de l'utilisateur, citées mot pour mot, et questions encore ouvertes : [decisions.md](decisions.md).
- Modèle fonctionnel qui fait foi : [modele-cible.md](modele-cible.md).
- Audit du deck : [audit-deck-epc2i.md](audit-deck-epc2i.md). Deck d'origine : `docs/sources/creation-ged-epc2i.pptx`,
  transcrit en texte dans `docs/sources/deck-ged-epc2i.md`.
- État d'avancement et reste à faire : [avancement-v2.md](avancement-v2.md).

Conventions :
- Les heures sont en UTC (heure de Paris = UTC+2).
- Les paroles de l'utilisateur sont citées mot pour mot, fautes comprises, et toujours attribuées. Les « » servent
  aussi pour les libellés d'interface, les titres de section et les citations de l'assistant ou des agents.
- « Proposé, non confirmé » désigne une proposition de l'assistant que l'utilisateur n'a pas validée.

## Repères

| Quand (UTC) | Étape | § |
|---|---|---|
| 7 oct., 10:58 → 11:39 | Construction de Codex v1 depuis la maquette, puis deux relectures | 1 |
| 7 oct., 12:19 → 17:52 | Audit du deck, puis arbitrages de l'utilisateur | 2 |
| 7 oct., 17:56 → 18:07 | Modèle v2 : schéma et logique métier. Coupure sur la limite d'usage alors que Codex ne compile pas | 3 |
| 7 oct., 17:56 → 22:55 | Fusion du registre des types : 69 types, 23 familles | 4 |
| 7 oct., 22:43 → 23:18 | Reprise, réécriture des écrans sur la v2, test de bout en bout | 5 |
| 8 oct., 05:33 → 06:19 | Relecture indépendante de la v2 (57 constats) et corrections | 6 |
| 8 oct., 06:21 → 07:36 | App Mac, relecture (12 constats), corrections partielles | 7 |
| 8 oct., 07:44 → 9 oct., 14:22 | Premier commit, `.gitignore`, dépôt GitHub privé | 8 |
| 9 oct., 15:00 | Passage en session cloud : ce qui n'existait qu'en local est versé dans le dépôt | 9 |
| 9 oct. | Reprise en session cloud : corrections T-03, inventaire du reste à faire | 10 |
| 10 oct. | Développement par étapes, un commit par étape validée. Étape 1 : brouillons invisibles hors du cercle (D-14). Étape 2 : avertissement sur les documents obsolètes ou archivés. Étape 3 : décision Vigie acceptée sur un document verrouillé. Étape 4 : droit de rédiger du modificateur désigné par Vigie. Étape 5 : identifiants sûrs en concurrence. Étape 6 : journal d'audit en ajout seul et complet | 11 |
| 10 oct. | Tests (Vitest, PGlite en mémoire) et intégration continue | 12 |
| 11 oct. | Décision D-26 : greffe ou attente d'une modification acceptée pendant une révision ouverte. Étape 1 : couche métier. Étape 2 : fiche document | 13 |
| 11 oct. | Fonctions du deck (lot 5), une étape par fonction : « Mes demandes Vigie », « À traiter » complet, rejet motivé et rappel, recherches enregistrées partagées, facettes et tri de la recherche, pages par département | 14 |
| 12 oct. | Lot 6 : points développables de reste-a-faire.md, une étape par point. Étape 1 : dates, format contrôlé et cohérence émission ≤ effet ≤ expiration. Étape 2 : expiration et revue périodique. Étape 3 : lien « remplacé par ». Étape 4 : fiche de visa. Étape 5 : modifications simultanées détectées. Étape 6 : recherche, explorateur et journal filtrés et paginés en base | 15 |
| 15 oct. | Lot 7 : suite des points développables de reste-a-faire.md. Étape 1 : en-têtes de sécurité HTTP et limitation de débit des API | 16 |
| 18 oct. | Lot 10 : préparer les réponses aux questions ouvertes sans rien trancher. Étape 1 : fiches de décision O-01 à O-11. Étape 2 : cahiers de validation du registre et de l'organigramme. Étape 3 : SharePoint essayé contre un faux Microsoft Graph, quatre défauts corrigés, `npm run storage:check` | 19 |

La session a été coupée plusieurs fois par une limite d'usage ou de dépense :
- le 7 octobre à 13:38, reprise à 17:31 sur « Try again » ;
- le 7 octobre à 18:07, reprise à 22:43 sur « Try again » ;
- le 8 octobre à 07:35, pendant les corrections de l'app Mac ;
- le 8 octobre à 07:44, sur la limite de dépense. La demande de commit, renvoyée aussitôt, a abouti.
- le 12 octobre vers 13:10, en session cloud, pendant l'étape 6 du lot 6. Le brouillon, mis de côté dans un stash git,
  a été relu puis repris sur « Try again » (§15.6).

## 1. Construction depuis la maquette Claude Design (7 oct., 10:58 → 11:39)

- **Demande** : « Regarde dansle dossier Codex et lance la création du software d'après l'extraction de l'IU faite
  depuis claude design. dit moi si tu as des questions. »
- **Source** : le handoff Claude Design dans `design/`. L'écran est `design/GED Groupe.dc.html` et le design system
  Nocturne est dans `design/_ds/`. `design/HANDOFF-README.md` demande une reproduction au pixel près.
- **Cadrage** : l'utilisateur a choisi « App locale persistée (Recommandé) », « Rôle simulé (Recommandé) » et
  « Affaires simulées (Recommandé) ».
- **Réalisation** :
  - même stack que Keystone : Next.js 16, React 19, PGlite et Drizzle ;
  - feuille Nocturne copiée telle quelle dans `src/app/nocturne.css` ;
  - 7 écrans en FR et EN : Accueil, Explorateur, Fiche document, Recherche, Validations, Archivage, Administration.
- **Bug trouvé en test** : les versions de démo étaient seedées à l'envers, donc la plus ancienne passait pour la
  courante. Corrigé.
- **Relecture de fidélité au design** par un sous-agent (20 écarts). Corrigés :
  - l'ordre des modèles, des affaires et des validations ;
  - l'onglet Versions, qui ne présélectionne plus de ligne ;
  - l'en-tête, qui arrivait après le corps de la page (`<Suspense>` retiré) ;
  - la recherche en direct depuis l'en-tête ;
  - les sélections, conservées quand on change de filtre.
- **Relecture des bugs** par un sous-agent (13 constats). Corrigés :
  - un document archivé ou sous gel juridique est verrouillé ;
  - pas de nouvelle version pendant un circuit ;
  - le demandeur ne valide pas son propre document ;
  - un rejet laisse publié un document qui l'était déjà ;
  - une garde d'étape bloque les clics venus d'une page périmée ;
  - les erreurs s'affichent en message (`src/app/error.tsx`) au lieu de faire planter l'écran ;
  - le 29 février ne bloque plus les dépôts ;
  - la route fichier répond 404 au lieu de 500.
- **Écarts gardés volontairement** (proposés, non confirmés) :
  - le rôle Gestionnaire a le droit « Valider », pour que Claire Bardet traite ses étapes ;
  - les échéances sont triées par date ;
  - le point de notification n'apparaît que s'il y a des validations en attente ;
  - les documents de démo sans fichier affichent « aperçu de démonstration ».
- **Questions posées en fin d'étape** : durées de rétention et libellés des circuits, fournisseur d'authentification,
  Keystone par API ou base partagée, premier commit. La suite de chacune est dans [decisions.md](decisions.md), section
  « Questions posées restées sans réponse directe ».
- Ce code v1 a ensuite été en grande partie réécrit sur le modèle v2 (§3 à §5).

## 2. Audit du deck et décisions (7 oct., 12:19 → 17:52)

- **Demande** : « Audit le fichier ci-joint qui décrit comment je voulais créer la GED. Fait moi un retour de ce que tu
  as compris avant d'intégrer cela au projet. » Le fichier joint est le deck « Création de la GED EPC2I » (18 slides),
  versionné depuis dans `docs/sources/creation-ged-epc2i.pptx`.
- **Méthode** : un workflow multi-agents, dont le rapport complet est dans [audit-deck-epc2i.md](audit-deck-epc2i.md).
  - Exigences : 64 relevées.
  - Modèle de métadonnées : 4 niveaux.
  - Écarts avec le code, vérifiés un par un : sur 48 éléments, 6 couverts, 21 partiels, 12 absents et 9 en conflit.
  - Architecture.
  - Critique du deck : 24 ambiguïtés, 16 contradictions, 23 manques.
  - Contrôle de complétude : 12 points manqués, 14 conflits, 12 questions prioritaires.
- **Constat principal** : le deck prévoit SharePoint, Power Automate et Power Apps, alors que Codex est une application
  autonome.
- **Découverte** : la spec Keystone (`docs/spec/10-site-docs-mywork-settings.md`, dans le dépôt Keystone) décrit déjà
  Codex, avec un registre de 28 types codés. Il y avait donc trois modèles à réconcilier : la maquette, la spec Keystone
  et le deck.
- **12:40** : retour à l'utilisateur. Rien n'est intégré, et 10 questions lui sont posées.
- **13:38** : réponses de l'utilisateur. Sur le socle technique, que la session cloud a reposé : « Codex prends toute la
  charge et les workflow, la seule option ouverte si c'est plus simple est que le stockage des documents soit sous une
  bibliothèque sharepoint gérée par Codex (les metadonnées et autres informations sont dans codex et uniquement le
  document et son nom et sa version sont mises dans sharepoin).. »

  Ses autres réponses de 13:38 :

  | Sujet | Réponse de l'utilisateur |
  |---|---|
  | Modèle de référence | « Exprime moi cette question autrement je ne comprends pas. » (question reformulée à 17:33) |
  | Domaine | « Origine et rattachement me parait être la bonen solution » |
  | Identifiant | « TYPE-Proj-SEQ est une bonne codification pour les documents issus des projets fait moi une proposition pour les autres documents. » |
  | Révisions | « Un document ne change pas de nom ni d'ID au passage de version. Il doit passer par un workflow de validation pour être approuvé. Nous n'utilisons que des indices en lettre et pas d'indices majeurs/mineurs. » |
  | Confidentialité | « Il peut y avoir un niveau publique, pour les documents de communication par exemple, le type publique doit être restraint a certaines famille le reste doit être a minima restraint a la diffusion a une extreprise externe ou un client. » |
  | Brouillons | « La personne propriétaire ou qui modifiera un document via une ECO verra les brouillons des documents qui lui sont liés/attribués. » |
  | Circuits | « Nous devons construire cela en fonction des roles et des documents mais des workflow differents sont a prévoir, il n'y a pas a proprement parler d'autorité d'approbation cela depend des documents. » |
  | ECR/ECO | « Je pense que les ECR/ECO doivent être centralisées dans "Vigie", quelles soient projet ou documentaires. » |
  | Organisation | « Je te donnerais un organigramme des services et des sites plus tard » |
  | Conservation | « La conservation des documents sera selon les règles d'usage par type de document. » |
  | Migration | « La migration sera faite via un code dédié fait qpecifiquement pour cette tache et ne sera pas intégré dans codex directement » |

- **17:33** : l'assistant reformule ce qu'il a retenu et fait des propositions : fusion des registres, codification
  `TYPE-CONTEXTE-SEQ`, cycle de vie, échelle de confidentialité à 5 niveaux. Il demande 6 confirmations.
- **17:52** : réponse de l'utilisateur, citée en entier :

  ```text
  1- oui fusionne pour le moment on adaptera plus tard
  2- QMS est le code pour les templates
  3- oui
  4- c'est un workflow vigie
  5- oui
  pour la question 2: oui fusionne les deux bases
  pour le cycle de vie conserve les sous versions de travail
  pour vigie, il va gérer les ECO/ECR mais les demandes doivent pouvoir etre faites depuis codex pour les documents ou depuis keystone pour les sujets liés au projets ou au projet lui meme.
  ```

  Les numéros 1 à 5 renvoient aux confirmations demandées à 17:33 :
  1. fusionner le deck et la liste Keystone en une seule liste de référence ;
  2. code du département ou `QMS` pour les documents sans rattachement ;
  3. échelle de confidentialité à 5 niveaux ;
  4. passage à « obsolète » par un ECR dans Vigie ou par un workflow interne à Codex ;
  5. valideurs et gestionnaires documentaires voient-ils aussi les brouillons.

  La sixième (SharePoint) est restée sans réponse. « pour la question 2 » renvoie à la question 2 de 12:40 (modèle de
  référence), reformulée à 17:33.
- **Encore sans réponse** :
  - SharePoint : un fichier par version, et aucun accès direct des utilisateurs à la bibliothèque ? Posée 4 fois ;
    marqué *provisoire* dans le modèle cible.
  - L'organigramme réel.
- Le détail de chaque décision et la liste des questions ouvertes sont dans [decisions.md](decisions.md).

## 3. Modèle v2 (7 oct., 17:56 → 18:07)

Le modèle est consigné dans [modele-cible.md](modele-cible.md), qui fait foi. Ce qui change par rapport à la v1 :

- **Classement** : deux axes, l'origine (interne ou externe) et le rattachement (aucun, projet ou recherche). Viennent
  ensuite la famille, le type et le sous-type. Ils remplacent les 4 axes de la maquette.
- **Identifiants `TYPE-CONTEXTE-SEQ`** (`src/lib/codes.ts`, `src/lib/codification.ts`).
  - Le contexte est le code projet, le code programme, `QMS` pour les modèles, ou à défaut le code du département.
  - Avant la première approbation, un reclassement donne un nouvel ID et garde l'ancien comme alias.
- **Révisions en lettres** avec versions de travail A.1, A.2… (tables `revisions` et `working_versions` de
  `src/db/schema.ts`).
  - Statuts d'une révision : Brouillon → En révision → Approuvé → En vigueur → Remplacé.
  - Le document lui-même peut être Obsolète ou Archivé.
- **Confidentialité** : 5 niveaux, de Public à Très confidentiel. La visibilité et le cercle de rédaction sont dans
  `src/lib/access.ts`.
- **Circuits par fonction** (tables `functions` et `function_holders`), résolus au lancement. Il n'y a plus
  d'« autorité d'approbation ».
- **Demandes Vigie** : ECR de modification ou de retrait (table `change_requests`). La décision est simulée par
  `simulateVigieDecision` (`src/lib/actions.ts`) tant que `VIGIE_API_URL` n'est pas défini (`vigieSimulated`,
  `src/lib/vigie.ts`), puis appliquée par `applyChangeDecision` (`src/lib/lifecycle.ts`).
- **Conservation** : une règle par type, portée par le registre et calculée dans `src/lib/retention.ts`.
- **Données de démo** : les mêmes personnes que Keystone et ses projets HLT-026, NDC-031 et RCF-019
  (`src/db/seed-org.ts`, `src/db/seed-docs.ts`). Les départements et les sites restent provisoires.
- **Coupure à 18:07** : la limite d'usage est atteinte alors que les écrans sont encore sur l'ancien modèle et que Codex
  ne compile pas. [avancement-v2.md](avancement-v2.md) est créé pour reprendre.

## 4. Fusion du registre des types (7 oct., 17:56 → 22:55)

- **Déroulé** : un workflow fusionne la taxonomie du deck (23 catégories, 45 types, 157 sous-types) et le registre
  Keystone (28 codes).
  - Le premier passage (18:12) s'arrête avant l'étape de contrôle, coupée par la limite d'usage.
  - Le contrôle est relancé à 22:44 en réutilisant le cache.
  - Le registre contrôlé est écrit dans `src/db/registry.ts` à 22:55.
- **Résultat** : **69 types dans les 23 familles du deck.**
  - 41 types viennent du deck seul, 6 sont fusionnés (PRO, CTR, LET, AUD, NCR, REC) et 22 viennent de Keystone seul.
  - Aucune famille Keystone n'est ajoutée : ses 7 familles trouvent place dans les catégories du deck.
- **Choix de fusion** :
  - le type « Audit & Inspection » est éclaté en AUD, NCR et REC ;
  - MIN (compte rendu de réunion) est transversal ;
  - les codes d'ingénierie Keystone (PID, PFD, SCH, GA, LST, BOM, FDS, HMI, VAR) deviennent des types ;
  - FDS désigne la spécification fonctionnelle, et les fiches de données de sécurité deviennent un sous-type de DTF ;
  - les codes ECR et ECO sont évités, car réservés à Vigie ;
  - FRM est le type des modèles, avec le contexte `QMS`.
- **Contrôle** : une vérification complète par script, puis 12 corrections.
  - La vérification confirme que :
    - les 45 types et les 157 sous-types du deck sont présents ;
    - les 28 codes Keystone sont présents et les codes sont uniques ;
    - les circuits n'utilisent que les 16 fonctions prévues ;
    - « Public » n'est admis que pour POL, REG, DTF, PUB et COL.
  - Les 12 corrections :
    - des libellés et des sous-types (FDS, DEF, REG, PID, RPT, MAN, LST, VIS) ;
    - la base de conservation de DTF et la note de PRO ;
    - la source « both » pour AUD, NCR et REC ;
    - le champ « livrable client » renseigné pour les 41 types venus du seul deck (vrai pour EXG, MES et REM) ; les
      valeurs Keystone sont inchangées, soit 14 types livrables au total ;
    - l'ordre des listes.
- **Points ouverts** : le contrôle en relève 15, ramenés à 9 questions dans
  [registre-points-ouverts.md](registre-points-ouverts.md). Par exemple :
  - des ID comme `FIN-FIN-0001` ;
  - une étape « chef de projet » sur des types sans projet ;
  - le déclencheur « fin de projet » hors projet ;
  - les durées de RSQ et de RHF.

## 5. Réécriture des écrans sur la v2 (7 oct., 22:43 → 23:18)

- **Reprise** : sur « Try again », à 22:43. La session principale écrit le seed v2 et le registre ; la couche données
  compile à 22:49.
- **Cinq agents en parallèle**, chacun sur ses propres fichiers :
  - les 14 dialogues et la coque ;
  - la fiche document et la route fichier ;
  - l'accueil, l'explorateur, la recherche et l'export CSV ;
  - les validations, l'archivage et l'administration ;
  - les API d'intégration : `src/lib/importer.ts`, `/api/registry`, `/api/import`, `/api/integrations/vigie`,
    [api.md](api.md) et les nouvelles variables de `.env.example`.
- **Agent d'intégration** : typecheck, lint et build passent sans erreur.
  - Il a testé un build de production sur une base neuve : 4 rôles, FR et EN, 62 documents, création depuis un modèle
    puis reclassement avec alias, circuit jusqu'à la mise en vigueur, demande Vigie acceptée.
  - Il a aussi :
    - rassemblé les textes dans `src/lib/i18n.ts` ;
    - compté un circuit rejeté comme terminé ;
    - affiché les révisions en cours sous la forme « B.2 » ;
    - gardé modifiables les documents d'un type désactivé ;
    - rétabli les trois boutons de l'accueil ;
    - réécrit `README.md` et [avancement-v2.md](avancement-v2.md).
- **Choix laissé à l'utilisateur** (proposé, non confirmé) : dans le dialogue de création, le type et le rattachement se
  filtrent l'un l'autre. L'alternative plus stricte serait d'imposer de choisir le type d'abord.
- **Test de bout en bout par la session principale**, sur une base neuve :
  - création depuis un vrai fichier, avec l'ID `PRO-HSE-0003` et le fichier `PRO-HSE-0003_A.1.pdf` ;
  - version de travail A.2 ;
  - circuit Responsable qualité puis Direction, approuvé par Gabriel Comte puis Hélène Costa, jusqu'à la mise en
    vigueur ;
  - règles de visibilité ;
  - API : le registre renvoie 69 types, l'import et le webhook restent fermés sans jeton ;
  - export CSV.

## 6. Relecture indépendante et corrections de la v2 (8 oct., 05:33 → 06:19)

- **Demande** : « reprends ».
- **Méthode** : un workflow de cinq relecteurs (métier, accès, écrans, API, données). Un vérificateur distinct conteste
  chaque constat, puis un agent corrige ceux qui sont confirmés.
- **Bilan** : 57 constats, dont 55 confirmés et 2 écartés.
  - L'agent de correction annonce « 52 » défauts confirmés corrigés, dont 6 en partie, regroupés en 27 lots après
    fusion des doublons. L'écart avec 55 n'est pas expliqué.
  - Ci-dessous, le rattachement de ses corrections aux constats est déduit de son rapport. C'est l'état qu'il a rapporté
    le 8 octobre ; seul le parcours décrit plus bas a été revérifié.
- **Schéma** :
  - nouveau statut de révision `cancelled` ;
  - 5 index uniques : une lettre par document, une révision en vigueur par document, un circuit en cours par révision,
    une demande Vigie en attente par document, un numéro de version de travail par révision ;
  - `drizzle/0000_init.sql` régénéré, donc `npm run db:reset` est obligatoire sur une base existante.
- **Vérification par la session principale**, sur une base neuve :
  - création de `PRO-QUA-0003`, puis version de travail A.2 ;
  - circuit qui écarte l'auteur : Gabriel Comte rédige, Hélène Sauvage valide comme Responsable qualité, puis Hélène
    Costa pour la Direction ;
  - ECR-2026-004 demandée par Julien Wagner, acceptée en simulation Vigie, puis ouverture de la révision B ;
  - l'utilisateur par défaut est de nouveau Claire Bardet (`DEFAULT_USER = 'cbardet'` dans `src/lib/context.ts`).

Constats confirmés, dans la numérotation du workflow :

**Métier (14 confirmés)**
1. `promoteDue` mettait en vigueur des révisions de documents obsolètes, archivés ou gelés. Corrigé.
2. La simulation Vigie sautait les verrous du webhook. Corrigé : contrôles communs dans `applyChangeDecision`.
3. Restaurer une archive remettait en vigueur un document retiré. Corrigé : il revient à « obsolète ».
4. L'auteur ou le modificateur désigné pouvait valider sa propre révision. Corrigé : les auteurs sont exclus du circuit.
5. Un retrait accepté ou un gel bloquait le circuit et la révision ouverte. Corrigé : circuit clos, révisions annulées,
   nouvelle action `releaseHold`.
6. Des contrôles se faisaient hors transaction (circuits en double, versions ajoutées en révision). Corrigé : contrôles
   dans la transaction et index uniques.
7. Un reclassement pendant un circuit gardait les valideurs de l'ancien type. Corrigé : refusé (`circuit_running`).
8. La création depuis un modèle ne contrôlait ni la lecture ni l'état du modèle. Corrigé.
9. `requestChange` ne contrôlait ni la lecture ni le droit, et permettait de retirer un brouillon. Corrigé.
10. La conservation depuis « remplacé » ignorait l'archivage et les révisions remplacées. **Partiel** : le décompte
    reste par document, et c'est documenté.
11. La date d'effet n'était pas validée (date passée ou invalide). Corrigé (`invalid_date`).
12. `delegateStep` n'avait pas de garde d'étape. Corrigé.
13. Import : une référence ancienne égale à un ID Codex désignait un autre document. Corrigé (409 `ref_is_codex_id`).
14. Changer de projet avant approbation laissait la pièce Keystone attendue sur l'ancien projet. Corrigé.

**Accès (8 confirmés)**
15. `requestChange` ne contrôlait pas la visibilité, ce qui permettait de viser un document caché. Corrigé.
16. Un modèle (FRM) confidentiel ou archivé pouvait être copié sans `canRead`. Corrigé.
17. Les versions de travail intermédiaires étaient servies à tous les lecteurs. Corrigé : réservées au cercle de
    rédaction.
18. L'onglet Projet affichait l'ID et le statut de documents cachés. Corrigé.
19. `setReaders` ne contrôlait ni le droit d'édition ni les verrous. Corrigé.
20. Matrice : Lire, Publier et Détruire, ainsi que le droit admin du gestionnaire, étaient sans effet. Corrigé : Lire et
    Publier sont appliqués ; Détruire est affiché en lecture seule et refusé par le serveur.
21. Archiver, geler et restaurer ne vérifiaient pas la visibilité. Corrigé.
22. `simulateVigieDecision` ignorait les verrous. Corrigé (doublon du n° 2).

**Écrans (14 confirmés)**
23. La « Simulation Vigie » était proposée sur un document archivé ou gelé. Corrigé : seul le refus reste possible.
24. Approuver et Rejeter restaient actifs sur un document gelé ou obsolète. Corrigé : boutons désactivés, avec le motif.
25. Des cellules et deux lignes de la matrice des droits étaient sans effet. Corrigé : elles sont en lecture seule.
26. Les lecteurs désignés n'étaient ni affichés ni modifiables sur la fiche. Corrigé.
27. L'accueil et les notifications menaient à des écrans interdits au rôle. Corrigé.
28. Le bouton de validation menait à un circuit invisible. Corrigé : « Suivre le circuit », et un écran « pas d'accès ».
29. Les lignes de tableau cliquables étaient inutilisables au clavier. Corrigé : vrai lien et focus visible.
30. Les libellés des dialogues n'étaient pas associés aux champs. Corrigé : dialogues nommés, focus gardé à l'intérieur.
31. Un dialogue se fermait quand on relâchait la souris sur le fond. Corrigé.
32. Un fichier non prévisualisable affichait une page factice. Corrigé : un panneau de téléchargement la remplace.
33. La pagination restait sur « Page 1 sur 1 » quand le nombre de pages était inconnu. **Corrigé (sans objet sur
    base neuve)** : les PDF déjà stockés ne sont pas recomptés, ce qui est sans objet après une remise à zéro de la
    base.
34. Le dialogue « Déléguer » proposait le demandeur. Corrigé.
35. Des textes n'étaient pas traduits. Corrigé.
36. Le rôle en lecture seule pouvait faire des demandes de modification ou de retrait. Corrigé côté serveur.
    **Partiel** : la liste des demandes n'est pas filtrée selon la visibilité. *Complété le 9 octobre (§10).*

**API (10 confirmés, 1 écarté)**
37. Import : le type MIME était repris tel quel. Corrigé : il est normalisé.
38. Le fichier était stocké pendant la transaction, ce qui verrouillait PGlite pendant l'envoi SharePoint. Corrigé :
    dépôt avant la transaction, renommage après.
39. Les versions de travail étaient servies à tous les lecteurs. Corrigé (doublon du n° 17).
40. Webhook Vigie : un retrait pendant une révision bloquait le circuit. Corrigé (doublon du n° 5).
41. Le droit « Lire » n'était pas vérifié par les routes fichier et export. Corrigé : il est contrôlé dans `canRead`.
42. Import : le doublon (409) n'était détecté qu'après la validation. Corrigé : un rejeu reçoit 409 d'emblée.
43. *Écarté par le vérificateur* : la comparaison de `legacyRef` aux ID Codex.
44. Pilote SharePoint : écrasement silencieux et pas d'envoi par morceaux. **Partiel** :
    - corrigé : plus d'écrasement silencieux, délais et reprises en place ;
    - non fait : l'import est plafonné à 250 Mo au lieu d'un envoi par morceaux ;
    - non fait : le fichier n'est pas renommé lors d'un reclassement. *Fait le 9 octobre (§10).*
45. Un fichier sans extension se téléchargeait avec un nom en « .1 ». Corrigé.
46. L'export du journal d'audit s'arrêtait à 100 000 lignes. Corrigé : export par lots, sans limite.
47. Une requête HEAD lisait le fichier et journalisait un téléchargement. Corrigé.

**Données (9 confirmés, 1 écarté)**
48. Des titulaires de fonctions n'avaient pas, avec leur rôle, le droit d'approuver. Corrigé : 9 titulaires passent
    validateur.
49. Seed : une révision de travail était créée avant la mise en vigueur de la précédente. Corrigé.
50. Seed : la date d'émission déclarée était ignorée. Corrigé.
51. Un retrait pendant un circuit laissait un workflow ouvert. Corrigé (doublon du n° 5).
52. La simulation Vigie agissait sur des documents archivés ou gelés. Corrigé (doublon du n° 2).
53. La matrice des droits n'était que partiellement appliquée. Corrigé (doublon du n° 20).
54. Pièces attendues par Keystone : le type n'était pas vérifié au dépôt. **Partiel** : le serveur refuse un mauvais
    type, mais le formulaire ne verrouille pas le type. *Complété le 9 octobre (§10).*
55. *Écarté par le vérificateur* : le choix de l'approbateur dépendait de l'ordre des lignes `function_holders`.
56. Un compte système était accepté comme utilisateur simulé. Corrigé : il est ignoré.
57. Le numéro de version de travail et le circuit étaient calculés hors transaction. Corrigé : index uniques.

## 7. App Mac (8 oct., 06:21 → 07:36)

- **Demande** : « fait une app que je puisse lancer depuis le bureau de mon mac ».
- **Réalisation** dans `desktop/` : une app native en Swift (AppKit et WKWebView, sans Electron).
  - Fichiers : `CodexApp.swift`, `build-app.sh` (lancé par `npm run app`), `make-icon.swift` et `make-alias.swift`.
  - L'app démarre le serveur de production sur le port 3110 et l'arrête quand on la quitte, même après un plantage.
    Les deux cas ont été vérifiés.
  - Elle est installée dans le dossier Applications de l'utilisateur, avec un alias sur le bureau. Le bureau,
    synchronisé par iCloud, empêchait de signer l'app à cet endroit.
  - Ses données sont séparées de celles du serveur de développement (section « Application Mac » de `README.md`).
- **Non vérifié** :
  - le rendu dans la fenêtre, car macOS a refusé la capture d'écran ;
  - le choix d'un fichier à déposer et les téléchargements dans la fenêtre, que l'utilisateur doit tester lui-même.
- **Relecture** : 12 constats, tous confirmés. L'agent de correction a échoué sur la limite de dépense. La session
  principale a donc corrigé à la main les points suivants, vérifiés dans le code :
  - « Avec Codex ouvert, relancer npm run app détruit la build » (majeur) et « npm run app recompile .next sous le
    serveur de l'app ouverte ». Désormais, `desktop/build-app.sh` refuse avant toute compilation si l'app tourne ou si
    le port 3110 répond.
  - `make-alias` supprimait sans vérification ce qui se trouvait à l'emplacement de l'alias, y compris un dossier
    (majeur). Il ne remplace plus qu'un alias existant (`desktop/make-alias.swift`).
  - Les bundles étaient supprimés sans vérifier qu'il s'agissait de Codex. Seul un bundle d'identifiant
    `com.epc2i.codex` est désormais supprimé (fonction `ours()` de `desktop/build-app.sh`).
- **Encore à corriger** (8 constats, aussi listés dans [avancement-v2.md](avancement-v2.md)) :
  - le message « Compilation de Codex… » ne s'affiche pas ;
  - si l'on quitte pendant la compilation, `next build` continue de tourner ;
  - `needsBuild()` ignore `.env*` et `tsconfig.json` ;
  - un téléchargement (erreur WebKit 102) peut être pris pour une panne du serveur ;
  - ⇧⌘H ou « Réessayer » relancent un démarrage en parallèle ;
  - le menu n'a pas d'élément « Fermer », donc ⌘W ne fait rien ;
  - une copie de l'app reste dans `desktop/dist` ;
  - la signature ad hoc fait redemander l'accès au dossier Téléchargements à chaque reconstruction.
- **État de l'app installée** : les scripts corrigés compilent, mais `npm run app` n'a pas été relancé. L'app installée
  est donc celle d'avant ces corrections.

## 8. Git et GitHub (7 → 9 oct.)

- **7 oct., 11:39** : le dépôt git est initialisé, sans commit. L'assistant demande « Veux-tu que je fasse le premier
  commit ? », sans réponse directe.
- **8 oct., 07:44** : « Commit the working tree changes with a sensible message. »
  - Premier commit, `db26518`, avec 99 fichiers et le message « Codex GED: application Next.js, modèle documentaire v2
    et app Mac ».
  - Il est fait sur une nouvelle branche, `codex-ged-v2`, par choix de l'assistant : `main` n'avait encore aucun commit.
  - Rien n'est poussé.
- **9 oct., 14:17** : « Add a .gitignore that excludes secrets (.env, keys, passwords) and build folders, initialize git
  if needed, commit everything, create a private GitHub repository called Codex and push to it. »
  - **`.gitignore`** : il exclut les fichiers `.env*` (sauf `.env.example`), les clés, les certificats, les fichiers
    d'identifiants et de mots de passe. Il exclut aussi les sorties de build (`.next`, `out`, `build`, `dist`,
    `desktop/dist`, `*.app`), `node_modules`, `.data` et les zips de la maquette. Commit `ef1df85` « Gitignore :
    exclure les secrets et les sorties de build ».
  - **Premier commit réécrit** en `d05d498`, avec l'identité Git du compte GitHub `Yhumiii27`. Il portait une adresse
    e-mail personnelle et n'avait été poussé nulle part ; aucune adresse personnelle n'est publiée.
  - **Connexion** : `gh` est installé, et l'utilisateur se connecte lui-même à GitHub (« c'est fait », 14:21).
  - **Publication** : le dépôt privé `Yhumiii27/Codex` est créé à 14:22. Les branches `main` (par défaut) et
    `codex-ged-v2` y sont poussées ; avant le passage en session cloud, les deux pointaient sur `ef1df85`.

## 9. Passage en session cloud (9 oct., 15:00)

- **Constat de la session cloud**, sur la branche `codex-ged-v2-vkmf4l` partie de `ef1df85` :
  - elle n'a trouvé ni le deck ni l'audit, restés hors du dépôt ;
  - elle a reposé des questions déjà tranchées : pile Microsoft 365 ou Codex (D-06) ; durées de conservation et
    libellés des circuits, présentés comme en attente d'une revue juridique (D-20, D-15) ; premier commit (D-23, D-24) ;
  - elle a aussi posé deux questions qui restent ouvertes, faute de réponse de l'utilisateur : le fournisseur
    d'authentification (O-02) et la liaison avec Keystone, par API ou base partagée (O-03).
  - Les réponses et l'état de chaque question sont dans [decisions.md](decisions.md), section « Réponses aux questions
    que la session cloud a reposées ».
- **Demande** : « voici ce que me dit la session cloud après le tranfer, fait en sorte de corriger pour que je puisse
  continuer intégralement dans la session cloud »
- **Ajouté au dépôt** :
  - `CLAUDE.md` : le point d'entrée, avec le contexte, les décisions structurantes, les documents à lire et les limites
    en session cloud ;
  - `docs/sources/` : le deck `creation-ged-epc2i.pptx` et sa transcription `deck-ged-epc2i.md` ;
  - [audit-deck-epc2i.md](audit-deck-epc2i.md) : l'audit du 7 octobre ;
  - [decisions.md](decisions.md) : le journal des décisions, avec citations, et les questions ouvertes ;
  - ce fichier ;
  - un renvoi vers ces documents dans `README.md`, section « Décisions et points ouverts ».
- **Ce que la session cloud ne peut pas faire** :
  - **Construire ou lancer l'app Mac.** `desktop/build-app.sh` exige macOS (swiftc, AppKit et WebKit, codesign,
    iconutil, sips). Sous Linux, utiliser `npm run dev`.
  - **Lire Keystone et Vigie**, tant que leurs dépôts ne sont pas ajoutés à l'environnement :
    `github.com/Yhumiii27/Keystone` et `github.com/Yhumiii27/Vigie`. Sans eux, la spec Keystone n'est pas lisible, et
    les deux applications restent simulées (`src/lib/keystone.ts`, `src/lib/vigie.ts`).
  - **Retrouver les données locales.** La base `.data`, les fichiers déposés et les `.env` sont exclus du dépôt. Au
    premier lancement de `npm run dev`, une base de démo neuve est créée et remplie.

## 10. Reprise en session cloud (9 oct.)

- `git merge origin/main` sur `codex-ged-v2-vkmf4l` (avance rapide jusqu'à `9986f2d`), puis relecture de `CLAUDE.md`
  et de [decisions.md](decisions.md).
- **Corrections T-03** (détail dans [decisions.md](decisions.md)) :
  - les fichiers stockés suivent le nouvel identifiant après un reclassement (`renameDocFiles`, `src/lib/storage.ts`) ;
  - le dépôt d'une pièce attendue par Keystone verrouille la famille et le type dans le formulaire ;
  - `listChangeRequests` ne renvoie que les demandes sur des documents visibles.
  - La conservation par révision remplacée n'est pas faite : elle contredit `docs/modele-cible.md` §8 et attend O-09.
- **Vérifié** : `npm run typecheck` et `npm run lint` passent (`typecheck` lance désormais `next typegen`, qui génère
  les types `PageProps` absents d'un clone neuf). Dans le navigateur, sur une base neuve : création de
  `PRO-QUA-0003` avec un PDF, reclassement en `PRO-HSE-0003`, fichier servi sous `PRO-HSE-0003_A.1.pdf` et plus rien
  sous l'ancien nom ; pièce attendue « Attestation d'assurance chantier » (HLT-026) : type JUR verrouillé.
- **Inventaire du reste à faire** : cinq recensements indépendants (docs, écarts de l'audit, exigences du deck, code et
  exploitation, maquette et intégrations), fusion, vérification contradictoire dans le code, critique de complétude.
  Résultat : [reste-a-faire.md](reste-a-faire.md), 129 points ouverts (69 sans blocage, 49 en attente de décision,
  2 en attente de données, 9 sur macOS). Deux points relevés ont été corrigés aussitôt : l'extension perdue au
  renommage SharePoint après un reclassement (régression de `44bd1b8`, `renameDocFiles`), et le script `typecheck`.

## 11. Développement par étapes en session cloud (10 oct.)

- **Demande** : « vas y, a chaque etape qui est validée fait un commit du code ».
- **Étape 1 : brouillons invisibles hors du cercle de rédaction (D-14)**, points 26 et 29 de
  [reste-a-faire.md](reste-a-faire.md) :
  - le journal rattache chaque entrée à sa révision (`audit_log.revision_id`) ; hors du cercle, une entrée suit le
    statut de sa révision (`readerMaySeeEntry`), pour l'historique, l'accueil, les notifications, l'onglet Journal et
    son export CSV ;
  - la fiche ne montre plus que les révisions en vigueur et remplacées, sans « en cours », ECO ni modificateur de la
    révision ouverte ; la date « Modifié » est celle du dernier changement visible ;
  - l'explorateur, la recherche et leur export n'ont plus de libellé de travail hors du cercle ;
  - un circuit dont le participant ne voit plus la révision disparaît de Validations (retour à la liste après un rejet,
    au lieu d'une page de refus) ; `addComment` refuse un document illisible ;
  - l'événement Keystone de démonstration qui citait ECO-2026-002 et la révision C a été remplacé ;
  - les indices résiduels, laissés en attendant une décision, sont listés au point 26.
- **Étape 2 : avertissement sur les documents obsolètes ou archivés**, point 8 de [reste-a-faire.md](reste-a-faire.md) :
  - un bandeau « Obsolète depuis le {date} ({ECO}) — ne plus appliquer » ou « Archivé le {date} » au-dessus de
    l'aperçu de la fiche, et sa forme courte dans l'aperçu rapide de l'explorateur ;
  - le fichier servi ou téléchargé est proposé sous `{ID}_{lettre}_OBSOLETE.ext` ou `_ARCHIVE.ext`, contenu inchangé ;
  - l'accès, les filtres par défaut et l'absence de filigrane ne changent pas (A13, P07, M12 non tranchés) ;
  - la règle est décrite dans `docs/modele-cible.md` §4 et listée parmi les choix de l'assistant non validés
    (`docs/decisions.md`).
- **Étape 3 : décision Vigie acceptée sur un document verrouillé**, point 35 de [reste-a-faire.md](reste-a-faire.md) :
  - une acceptation reçue pendant un gel juridique ou un archivage est enregistrée (demande « Acceptée », avec ECO,
    modificateur et note) au lieu d'être perdue ; elle s'applique à la levée du gel ou à la restauration de l'archive
    (`applyPendingDecision`, `src/lib/lifecycle.ts`) ; un refus s'applique toujours aussitôt ;
  - le webhook Vigie répond 202 (`pending: true`) au lieu de 409 `document_locked`, et de même à un renvoi de la même
    acceptation ; la simulation depuis la fiche suit les mêmes règles et le dit dans un message ;
  - la fiche signale la décision en attente (bandeau, onglet Demandes) ; `docs/api.md` décrit ce comportement.
- **Étape 4 : droit de rédiger du modificateur désigné par Vigie**, point 34 de [reste-a-faire.md](reste-a-faire.md) :
  - le modificateur que nomme Vigie passe le même contrôle que le défaut (droit de dépôt de son rôle dans la matrice,
    document lisible), à un seul endroit pour le webhook et la simulation (`mayDraft`, `src/lib/lifecycle.ts`) ;
  - en cas d'échec, le webhook répond 400 `modifier_not_allowed` et la simulation affiche une erreur traduite ; rien
    n'est enregistré et le défaut ne prend pas sa place ;
  - le dialogue de simulation ne propose que les personnes qui peuvent rédiger le document ;
  - une acceptation en attente dont le modificateur a perdu ce droit s'applique pour le modificateur par défaut, avec
    une ligne de journal et un message à qui lève le gel ou restaure l'archive, y compris quand le défaut ne peut pas
    rédiger non plus ou retombe sur la personne écartée (message distinct) ; `docs/api.md` décrit ce comportement ;
  - `docs/api.md` précise aussi qu'un `modifierId` inconnu fait échouer un refus ou un retrait (400 `unknown_user`) et
    que la ligne de journal du remplacement devient visible de tous les lecteurs une fois la révision en vigueur.
- **Étape 5 : attribution des identifiants sûre en concurrence**, point 40 de [reste-a-faire.md](reste-a-faire.md) :
  - une table `id_counters` remplace les max+1 relus dans les tables : ID de document par couple (type, contexte),
    numéros de circuit `W-n`, références `ECR-AAAA-NNN` par année ; une seule instruction
    `INSERT … ON CONFLICT … RETURNING` dans la transaction appelante (`src/lib/codification.ts`) ;
  - à sa première utilisation, un compteur part du plus grand numéro existant, anciennes références comprises : la base
    de démo, le seed et les imports restent cohérents, et un numéro gardé en alias n'est jamais réattribué ;
  - l'import fait monter le compteur jusqu'à sa `legacyRef` quand elle a la forme `TYPE-CONTEXTE-SEQ`, avant de vérifier
    qu'elle est libre ;
  - après revue, les imports passent un par un (`pg_advisory_xact_lock` en tête de transaction) : deux imports
    simultanés de la même `legacyRef` ne créent plus deux documents, et deux imports aux portées croisées ne
    s'interbloquent plus ; vérifié sur un Postgres 16 en READ COMMITTED, où la version d'avant revue reproduisait les
    trois défauts (doublon, interblocage, collision de clé) ;
  - formats, largeurs et attribution dès le brouillon inchangés ; la migration unique `0000_init` a été régénérée.
- **Étape 6 : journal d'audit en ajout seul et complet**, points 27, 30 et 33 de [reste-a-faire.md](reste-a-faire.md) :
  - un reclassement ne réécrit plus le journal : les entrées gardent l'ID de leur époque, la fiche lit l'ID courant et
    ses alias, l'accueil et les notifications ramènent chaque ligne à l'ID courant, l'onglet Journal et son export
    gardent l'ID de l'époque ;
  - `audit_log` accepte une cible sans document (`target_kind`, `target_id` : droit, département, site, fonction, type,
    export) ; sont désormais journalisés les droits, l'organisation, les titulaires de fonction, le registre des types
    (avant → après), les commentaires de circuit, les deux exports CSV (requête et facettes, ou journal complet, et
    nombre de lignes) et, dans l'entrée « Modification », les champs modifiés ;
  - l'avant et l'après sont stockés en codes (`audit_log.data`, JSON) et rendus dans la langue du lecteur, à l'écran
    comme dans l'export ;
  - lecture : un administrateur qui n'est pas gestionnaire ne reçoit pas le détail des entrées d'un document qu'il ne
    peut pas lire, ni son ID courant ; hors du cercle, les valeurs d'une modification datant d'un brouillon ou d'un
    niveau plus strict sont retenues (`docs/modele-cible.md` §5) ; les flux d'activité écartent en SQL les entrées
    sans document, qui ne vident plus la fenêtre de l'accueil et des notifications ; HEAD sur un export ne journalise
    rien ;
  - l'horodatage est un `timestamptz` (UTC stocké, heure de Paris à l'affichage et dans l'export) ;
  - la base refuse UPDATE, DELETE et TRUNCATE sur `audit_log` : déclencheurs posés à chaque démarrage, après les
    migrations (`src/db/index.ts`), pour survivre à la régénération de la migration unique ;
  - la migration unique `0000_init` a été régénérée ; une base existante doit repartir de zéro (`npm run db:reset`).

## 12. Tests et intégration continue (10 oct.)

- **Méthode** : comme au §11, chaque étape a été implémentée, relue par deux agents (solidité des tests par mutations,
  couverture et conformité aux décisions), finalisée puis commitée.
- **Commits** : `4706989` Vitest et tests unitaires des règles pures ; `1644339` tests d'intégration des règles métier
  sur PGlite en mémoire (242 tests, environ 20 s) ; `d5c3680` workflow GitHub Actions (npm ci, typecheck, lint,
  tests, build) ; `679e167` version de Node alignée sur `engines` dans CLAUDE.md. Premier passage de la CI vert sur
  `679e167`.
- **Écarts révélés par les tests, marqués `it.fails`, non corrigés au 10 octobre** :
  - `idMatches` confondait un code client de projet et un code de département identiques (D-10) : **corrigé le
    11 octobre**. Un ID ne correspond plus à un type et à un contexte que si `TYPE-CONTEXTE-` est suivi du seul
    numéro (des chiffres, largeur non contrôlée) ; un document de projet reclassé avant sa première approbation vers
    un département de même code est recodifié. Deux contextes de code strictement identique resteraient
    indiscernables dans l'ID (D-09, O-04) ;
  - `normalizeMime` gardait `text/plain` pour une extension inconnue : un fichier binaire importé sans type pouvait
    être servi comme du texte. **Corrigé le 11 octobre** : un `text/plain` reçu pour un fichier dont l'extension n'est
    pas un texte connu (.txt, .csv, .log), ou qui n'en a pas, est générique. Un type générique est remplacé par celui
    de l'extension, sinon par `application/pdf` si le fichier commence par `%PDF-`, sinon par
    `application/octet-stream` : le fichier est alors servi en téléchargement et la fiche propose de le télécharger.
    L'extension et le nom enregistrés ne changent pas ; un fichier sans extension n'en reçoit plus (il prenait
    `.txt`). L'aperçu n'affiche plus que les images servies en ligne (PNG, JPEG, GIF, WebP, liste partagée avec la
    route fichier dans `src/lib/filetypes.ts`) : un plan déposé en `image/vnd.dwg` montrait une image cassée ;
  - l'import traitait une référence d'origine égale à l'ancien ID d'un document reclassé comme un rejeu (409
    `duplicate`) : **corrigé le 11 octobre**. La référence d'origine est mémorisée à part (`documents.legacy_ref`,
    unique) ; seule elle fait un rejeu, y compris après un reclassement du document repris. Une référence égale à un
    ID Codex, actuel ou ancien, d'un autre document reçoit 409 `ref_is_codex_id`. La migration unique `0000_init` a été
    régénérée : une base existante doit repartir de zéro (`npm run db:reset`).
- **Point à arbitrer** : une modification acceptée pendant un gel, alors qu'une révision est déjà ouverte, reste
  « acceptée » après la levée du gel, et rien ne l'applique ensuite. **Tranché le 11 octobre** (D-26, §13).

## 13. Décision D-26 (11 oct.)

- **Question** (posée à la fin du lot 2, le 10 octobre) : « Que doit-il se passer quand Vigie accepte une modification
  pendant un gel, alors qu'une révision est déjà ouverte ? […] Faut-il l'appliquer quand la révision ouverte entre en
  vigueur, ou la signaler pour qu'elle soit traitée à la main ? »
- **Réponse de l'utilisateur** (11 octobre) :
  > si une ouverture de revision d'un document est en cours alors soit la modification vient se greffer sur la modification en cours soit il faudra attendre que la rvision soit validée avant d'en ouvrir une nouvelle
- **Règle** ([decisions.md](decisions.md), D-26, commit `6ea55e9`) : une modification acceptée par Vigie alors qu'une
  révision du document est déjà ouverte n'en ouvre pas une seconde. Soit elle est **greffée** sur la révision ouverte,
  qui porte alors aussi sa référence ECO ; soit elle **attend**, puis ouvre la révision suivante une fois la révision
  en cours validée.
- **Interprétations appliquées** (*proposé, non confirmé*) :
  - le choix se fait sur la fiche du document, par un gestionnaire documentaire ou par le modificateur de la révision
    ouverte (à défaut son propriétaire) ; tant que personne n'a choisi, c'est l'attente qui vaut ;
  - la greffe n'est possible que pendant la rédaction de la révision ouverte ; en validation, ou approuvée en attente
    de sa date d'effet, seule l'attente l'est (greffer obligerait à relancer le circuit) ;
  - « validée » s'entend « mise en vigueur » ; une révision ouverte annulée libère aussi la modification en attente ;
  - la règle vaut pour toute révision ouverte, pas seulement après un gel : une demande de modification peut être faite
    depuis Codex pendant qu'une révision est ouverte (l'ancien refus `locked_working` disparaît).
- **Étape 1 : couche métier** (commit `3bb2e96`) :
  - une acceptation reçue pendant qu'une révision est ouverte (brouillon, en validation, approuvée) est enregistrée
    « Acceptée » ; elle ouvre la révision suivante, une seule fois, à la mise en vigueur de la révision ouverte
    (`putInForce` : dernière approbation, date d'effet atteinte, rattrapage) ou à son annulation
    (`cancelOpenRevisions`) ; un verrou (gel, archive) s'ajoute à l'attente ;
  - Server Action `graftChange` (`src/lib/actions.ts`) : greffe sur la révision en rédaction, document lisible et non
    verrouillé ; colonne `change_requests.revision_id`, qui permet à une révision de porter plusieurs ECO ; entrée de
    journal « Greffe d'une modification » rattachée à la révision ; migration unique `0000_init` régénérée ;
  - `requestChange` accepte une demande de modification pendant une révision ouverte ; le webhook Vigie répond 202
    `reason: "revision_open"` avec l'indice de la révision (`docs/api.md`) ;
  - hors du cercle de rédaction (D-14), ni ECO, ni modificateur, ni révision liée, et une modification greffée reste
    affichée « Acceptée » jusqu'à la mise en vigueur de la révision qui la porte (`changeAsSeen`, `src/lib/access.ts`).
- **Étape 2 : fiche document** (`src/app/documents/[id]/page.tsx`, `src/components/dialogs/Dialogs.tsx`) :
  - pour le cercle de rédaction, un bandeau « ECO-… acceptée : elle ouvrira la révision suivante à la mise en vigueur
    de la révision C », complété par le verrou s'il y en a un (« …, pas avant la levée du gel juridique ») ; la même
    formule sert dans l'onglet Demandes, le dialogue de simulation Vigie et son message (`decisionWaitL`,
    `src/lib/queries.ts`) ;
  - révision en rédaction : bouton « Greffer sur la révision C » dans le bandeau et sur la demande, avec un dialogue de
    confirmation (motif, modificateur de la révision, modificateur désigné par Vigie s'il est différent) ; grisé, avec
    sa raison, sous un verrou, sans le droit Modifier, ou pour une personne du cercle qui n'est ni gestionnaire ni
    modificateur de la révision ; révision en validation ou approuvée : le bandeau explique que seule l'attente est
    possible ;
  - après la greffe, l'onglet Demandes indique « Greffée sur la révision C » (« A ouvert la révision C » pour l'ECO
    qui l'a ouverte) et l'onglet Révisions liste les ECO que porte la révision ;
  - le dialogue « Demander une modification » dit au cercle de rédaction, en une seule consigne, qu'une révision est
    déjà ouverte, son état, et qu'un ECO accepté ouvrira la révision suivante à la mise en vigueur de la révision C
    (ou pourra y être greffé tant qu'elle est en rédaction) ; hors du cercle, la consigne habituelle ;
  - ce que la fiche montre de la révision ouverte et de la greffe est calculé par une fonction pure,
    `openRevisionView` (`src/lib/access.ts`), qui ne renvoie rien hors du cercle (tests unitaires) ;
  - hors du cercle, ni bandeau D-26, ni bouton, ni révision ; une demande acceptée ou greffée s'affiche « Acceptée »,
    sans plus de détail. Sous un verrou, la mention d'attente d'une modification dit seulement qu'elle « ne s'appliquera
    pas avant » la levée du verrou (`acceptedWaitL`) : une révision que ce lecteur ne voit pas peut la retenir encore.
- **Corrections après relecture de l'étape 2** :
  - une modification greffée sur une révision ensuite annulée par un retrait accepté s'affichait « Acceptée » pour
    toujours hors du cercle, avec une attente qui n'aboutirait jamais ; elle s'affiche désormais « Appliquée », comme
    celle qui avait ouvert la révision (`changeAsSeen`) ;
  - le modificateur désigné par Vigie pour une modification en attente entre dans le cercle de rédaction (D-14 : « qui
    modifiera un document via une ECO ») : il voit la révision ouverte, l'ECO et le bandeau, mais n'y dépose pas, ne la
    soumet pas et ne greffe pas (`mayWorkOnDraft`, `src/lib/access.ts`) ; cette désignation ne compte pas quand on
    vérifie qu'il peut encore rédiger le document (`mayDraft`, `buildAccessIndex(tx, { pending: false })`). Choix
    consigné dans [decisions.md](decisions.md) (choix de l'assistant non validés) ;
  - les textes du dialogue de demande et le refus `graft_not_draft` nomment la révision dont on attend la mise en
    vigueur, sans « sa » ambigu.
- **Vérifié** (étape 2) : `npm test` (329 tests), `npm run typecheck`, `npm run lint`. Dans le navigateur, sur une
  base neuve, avec Claire Bardet (gestionnaire) :
  - `HSE-HLT-026-001` (B en vigueur, C en brouillon) : dialogue de demande, acceptation simulée, bandeau d'attente,
    greffe ; C porte ECO-2026-002 et ECO-2026-004. Julien Wagner, hors du cercle, ne voit que « Acceptée » ; sous gel
    juridique, « elle ne s'appliquera pas avant la levée du gel juridique » ; après un retrait accepté qui annule C,
    « Appliquée », sans attente ;
  - `PRO-HSE-0001` (B en vigueur, C en brouillon) : acceptation avec Julien Wagner comme modificateur, attente laissée ;
    Julien voit C, l'ECO et le bandeau, avec « Nouvelle version de travail », « Demander la validation » et « Greffer »
    grisés ; circuit de C (Gabriel Comte puis Hélène Costa) ; C entre en vigueur et D s'ouvre en brouillon pour Julien
    Wagner, avec l'ECO ; Léa Marchand, hors du cercle, ne voit que « Acceptée » puis « Appliquée » ;
  - `BOM-HLT-026-001` (D en validation) : dialogue de demande en français et en anglais (« Rév. D, en validation ») ;
    hors du cercle, la consigne habituelle.
- **Reste ouvert** : Vigie n'est prévenu ni de la greffe ni de l'application différée (O-10) ; hors du cercle, une
  modification greffée reste « Acceptée » et grise le bouton « Demander une modification » tant que la révision qui la
  porte est ouverte (point 26 de [reste-a-faire.md](reste-a-faire.md)) ; la fiche ne parle que de la mise en vigueur,
  puisqu'aujourd'hui seul un retrait accepté annule une révision ouverte et qu'il ne peut pas être demandé pendant
  qu'une modification attend (une seule demande en cours par document) ; le modificateur désigné écarté par une greffe
  n'en est averti que par le journal, qu'il ne lit plus une fois sorti du cercle.

## 14. Fonctions du deck (11 oct.)

Lot 5 : six fonctions que le deck demande et que Codex n'avait pas (FON-04, FON-06, FON-08, FON-10, FON-11), prises
dans les points « développables maintenant » de [reste-a-faire.md](reste-a-faire.md). Chaque étape a été relue, puis
commitée à part. Aucune question ouverte n'a été tranchée : quand un choix en dépendait, l'option la plus prudente a été
prise et consignée dans [decisions.md](decisions.md) (« Choix de l'assistant non validés explicitement »). Partout, rien
du travail en cours ne sort du cercle de rédaction (D-14) : chaque liste passe par les règles de `src/lib/access.ts`.

| Étape | Commit | Points | Ce qui change | Choix prudents |
|---|---|---|---|---|
| 1. « Mes demandes Vigie » (§14.1) | `e7c2a89` | 1 (G18, FON-10) | Vue de Validations qui suit les demandes de modification et de retrait envoyées à Vigie : statut, attente, révision ouverte ou greffée | Hors du cercle, ni ECO, ni modificateur, ni date de décision d'une modification dont la révision est masquée ; rien sur l'Accueil, que la maquette réserve à ce qui attend une décision |
| 2. « À traiter » complet (§14.2) | `39976c0` | 10 (G19, FON-11) | Une seule liste pour l'encart de l'Accueil, la pastille et la cloche : étapes, révisions à rédiger ou à reprendre, greffes, revues et expirations | Un élément n'apparaît que si le serveur laisserait agir ; la fin de conservation reste aux gestionnaires ; pastille sur Accueil (écart avec la maquette, noté) |
| 3. Rejet motivé et rappel (§14.3) | `a4a1c71` | 9 et 5 (G17, FON-08) | Motif obligatoire pour rejeter ; rappel d'un circuit en cours par son demandeur ou un gestionnaire, la révision revenant en rédaction | Motif de 2 000 caractères au plus ; le propriétaire qui n'a pas fait la demande ne la rappelle pas ; droit Modifier exigé |
| 4. Recherches enregistrées (§14.4) | `ac089f4` | 2 (G12, G15, FON-06) | Création, suppression, partage avec un département ou avec le groupe | Partage réservé aux gestionnaires et au droit Administrer ; seuls les critères sont gardés, jamais de documents |
| 5. Facettes et tri de la recherche (§14.5) | `f24bc43` | 12 (G15, G32, FON-04) | Onze facettes, une période sur une date, un tri au choix ; export et recherches enregistrées suivent | Une seule période ; auteur et échéance pris comme sur la fiche ; refus explicite au-delà des bornes plutôt qu'une recherche tronquée |
| 6. Pages par département (§14.6) | `2c3ad53` | 11 (G12, FON-06) | `/departements/[code]` : documents en vigueur, échéances, circuits, recherches partagées, filtres mis en avant réglables dans Administration | Mêmes filtres par défaut pour tous les départements, aucun choix par métier (recueil des besoins à faire, O-04) ; la page ne montre que ce que les autres écrans montrent déjà |

- **Schéma** : migration unique régénérée aux étapes 3 (`workflows.closed_by`, `closed_at`, `reason`), 4
  (`saved_searches.owner_id`, `scope`, `department`), 5 (`saved_searches.period`, `order_by`) et 6
  (`departments.featured`).
- **Tests** : de 339 à la fin de l'étape 1 à 479 à la fin du lot, chacun écrit pour échouer si la règle était cassée
  (voir chaque étape).
- **Reste ouvert après le lot** : recueil des besoins par département et organigramme (O-04, A19) pour les pages
  métiers ; filtrage de la recherche en mémoire (point 50) ; notifications hors de l'application (point 104) ; Vigie
  n'est prévenu ni d'une greffe ni d'une application différée (O-10).

### 14.1 Mes demandes Vigie

Point 1 de [reste-a-faire.md](reste-a-faire.md) (G18, FON-10) : chacun suit les demandes de modification et de retrait
qu'il a envoyées à Vigie, jusque-là visibles seulement document par document.

- **Écran Validations** (`src/app/validations/page.tsx`, `MyChangeRequests.tsx`) : au-dessus des quatre filtres, deux
  vues, « Circuits » et « Mes demandes Vigie » (`?f=vigie`, la demande affichée dans `c`), chacune avec son compteur.
  La seconde reprend la disposition des circuits : à gauche la liste (ID et type, titre du document, référence et
  statut, jour d'envoi), celles qui attendent encore la décision ou leur application d'abord ; à droite la demande
  (statut, type, liens vers l'onglet Demandes de la fiche et, si `NEXT_PUBLIC_VIGIE_URL` est défini, vers Vigie
  (`vigieLinkConfigured`, `src/lib/vigie.ts`), dates d'envoi et de décision, ECO, modificateur désigné, note de Vigie,
  motif et description). Les dates gardent leur année (`fmtDateTime`, `src/lib/format.ts`) : la liste cumule les
  demandes de toutes les années. Un encadré dit où elle en est : « En attente de la décision de Vigie », ce qu'attend
  une demande acceptée (`acceptedWaitL`), ou la révision qu'elle a ouverte ou sur laquelle elle a été greffée. Sans
  circuit mais avec des demandes, l'écran s'ouvre sur cette vue.
- **Lecture** (`listChangeRequests(ctx, { mine: true })`, `src/lib/queries.ts`) : seulement les demandes de
  l'utilisateur, sur les documents qu'il lit encore ; hors du cercle de rédaction, ni ECO, ni modificateur, ni
  révision tant que la révision qui porte la modification n'est pas en vigueur, et une greffe reste « Acceptée »
  (`changeAsSeen`, D-14, D-26). Une modification « Appliquée » dans ces conditions perd aussi sa date de décision :
  appliquée aussitôt, c'est l'heure d'ouverture de la révision masquée, dont l'entrée de journal est cachée hors du
  cercle (`readerMaySeeEntry`) ; la date d'acceptation d'une demande « Acceptée », greffe comprise, reste, comme son
  entrée de journal. La requête renvoie désormais aussi le titre et le lien du document, les dates, la mention
  d'attente et la révision porteuse, que la fiche reprend au lieu de les recalculer. Une demande d'un autre, appelée
  par l'URL, ramène à la liste sans rien en dire.
- **Accueil inchangé** : la maquette n'y prévoit que trois indicateurs et la liste « À traiter », réservée à ce qui
  attend une décision de l'utilisateur ; un rappel des demandes envoyées n'y a pas sa place.
- **Vérifié** : `npm test` (339 tests, dont les 8 de `tests/integration/my-change-requests.test.ts`), `npm run typecheck`,
  `npm run lint`. Dans le navigateur, sur une base de démo remise à zéro : Julien Wagner envoie une demande de
  modification sur `HSE-HLT-026-001` et la voit « Transmise à Vigie », datée avec l'année ; après l'acceptation
  simulée par Claire Bardet, qui le désigne modificateur, « Acceptée » avec l'ECO, la date de décision et « elle ouvrira
  la révision suivante à la mise en vigueur de la révision C » ; sa demande sur `PRO-QUA-0001`, acceptée avec Gabriel
  Comte comme modificateur, passe « Appliquée » sans ECO, ni modificateur, ni date de décision (il est hors du cercle) ;
  aucune des deux n'apparaît dans les demandes de Claire Bardet ; Léa Marchand n'en voit aucune, et l'URL de l'une
  d'elles la ramène à sa liste vide ; le lien « Ouvrir dans Vigie » n'apparaît qu'avec `NEXT_PUBLIC_VIGIE_URL` ; la
  vue en anglais.

### 14.2 « À traiter » complet

Point 10 de [reste-a-faire.md](reste-a-faire.md) (G19, FON-11) : l'encart « À traiter », la pastille et la cloche ne
montraient que les étapes de circuit à décider ; une révision ouverte au nom de l'utilisateur par un ECO, un rejet ou
un brouillon jamais soumis n'étaient listés nulle part, et les échéances n'étaient pas rattachées au propriétaire.

- **Une seule source** (`myActions`, `src/lib/queries.ts`) : la mise en page (pastille, cloche) et l'Accueil (encart,
  indicateur « À valider ») lisent la même liste, calculée une fois par requête (`myTodo`, avec son heure de calcul).
  Next ne recalcule pas la mise en page lors d'une navigation côté client, seulement la page : l'Accueil remet donc sa
  liste à la coque (`TodoSync`, `src/components/shell/AppProvider.tsx`), et la pastille et la cloche affichent la plus
  récente des deux (`latestTodo`, `src/components/shell/todo.ts`). Un élément né de l'action d'un autre (rejet, étape,
  ECO accepté) apparaît ainsi en même temps dans l'encart, la pastille et la cloche dès que l'utilisateur revient sur
  l'Accueil ; sur les autres écrans, la pastille suit la dernière liste reçue (Accueil, rechargement ou action).
  Chaque élément donne le document, ce qu'il y a à faire et un lien vers l'endroit où agir :
  - étapes de circuit à décider, comme avant (`/validations?r=W-…`) ;
  - révisions en rédaction (`draftTodo`, `src/lib/access.ts`), vers l'onglet Révisions de la fiche : confiées par un
    ECO à leur modificateur désigné, avec la référence ; renvoyées en rédaction par un rejet, pour l'auteur de l'étape
    Rédaction, le modificateur et le propriétaire, avec le nom de qui a rejeté ; jamais soumises, pour le propriétaire,
    qui peut aussi la soumettre, avec « confiée à … » et l'ECO quand un ECO a désigné quelqu'un d'autre ;
  - modifications acceptées en attente qui peuvent être greffées sur la révision en rédaction (D-26,
    `openRevisionView`), vers l'onglet Demandes ;
  - revues et expirations dépassées ou à moins de 90 jours (mêmes règles qu'Archivage, `deadlines`) des documents dont
    l'utilisateur est propriétaire, ou propriétaire de processus s'il peut demander une modification (`deadlineActor`),
    vers l'onglet Fiche. La fin de conservation et la vue de toutes les échéances restent aux gestionnaires, dans
    Archivage.
- **Coût** : la liste des documents visibles (`listDocs` sans option) est chargée une fois par requête et partagée
  entre la mise en page, ses modèles, « À traiter » et la page ; « À traiter » ne lit les versions de travail que des
  révisions en brouillon.
- **Droits** : un élément n'apparaît que sur un document que l'utilisateur voit (`listDocs`, D-14) et quand le serveur
  le laisserait agir : droit Valider et écran Validations pour une étape ; cercle de rédaction (`mayWorkOnDraft`) et
  droit Déposer, ou Modifier s'il y a déjà une version de travail, pour une révision ; droit Modifier pour une greffe ou
  une échéance ; jamais sur un document verrouillé. Un valideur sorti du cercle avec la fin d'un circuit, ou une
  personne qui simule un autre rôle, ne voit donc plus la révision qu'il a rejetée ou rédigée.
- **Écran** : l'encart « À traiter » liste tous les éléments (icône selon la nature, titre, détail, « Ouvrir ») et,
  s'il n'y a rien, « Rien à traiter pour le moment. » ; il n'a plus de lien « Tout voir » vers Validations, qui ne
  montre que les circuits. La pastille passe de Validations à Accueil, qui porte la liste (écart avec la maquette,
  noté dans `docs/decisions.md`). La cloche reprend la liste sous « À traiter », avec un défilement au-delà de sa
  hauteur. L'indicateur « À valider » compte toujours les seules étapes à décider. Textes FR et EN dans `i18n.ts`.
- **Vérifié** : `npm test` (366 tests, dont les 19 de `tests/integration/my-actions.test.ts`, ceux de `draftTodo` et
  `deadlineActor` et `tests/unit/todo.test.ts`), `npm run typecheck`, `npm run lint`. Les tests échouent si l'on retire
  le verrou des greffes ou le contrôle de l'écran Validations sur les étapes (auditeur à qui l'on accorde « Valider »).
  Dans le navigateur, sur une base de démo neuve : pour Claire Bardet, Lucas Fabre, Gabriel Comte et Antoine Girard,
  l'encart, la pastille et la cloche donnent les mêmes éléments et les mêmes liens ; Lucas Fabre voit la révision C de
  `HSE-HLT-026-001` « à rédiger » avec ECO-2026-002, son brouillon `PER-HLT-026-002`, la revue du 15 décembre et
  l'expiration du permis de levage. Deux sessions : Lucas Fabre est sur l'Explorateur (pastille 4) ; Claire Bardet
  rejette W-305 ; Lucas Fabre clique sur « Accueil » (navigation côté client, sans rechargement) : l'encart, la
  pastille et la cloche donnent 5, avec « renvoyée en rédaction par Claire Bardet », et la pastille reste à 5 de retour
  sur l'Explorateur. Une modification de `PRO-QUA-0002` acceptée par la simulation Vigie pour Antoine Girard : il la
  voit « à rédiger » avec ECO-2026-004, et Gabriel Comte, propriétaire, « en brouillon, jamais soumise à validation ·
  confiée à Antoine Girard », avec un lien vers l'onglet Révisions où « Nouvelle version de travail » est actif. Julien
  Wagner, Léa Marchand et James Holt (auditeur) voient « Rien à traiter pour le moment. », sans pastille ni point
  rouge ; Antoine Girard, simulé en collaborateur, n'a plus d'étape à décider. Vue en anglais vérifiée.


### 14.3 Rejet motivé et rappel d'une demande de validation

Points 9 et 5 de [reste-a-faire.md](reste-a-faire.md) (G17, FON-08) : un valideur rejetait une étape d'un clic, sans
dire pourquoi, et le demandeur restait bloqué jusqu'à la décision des valideurs, sans pouvoir rappeler sa demande.

- **Rejet** : `decideStep` (`src/lib/actions.ts`) prend un motif et refuse un rejet sans motif (vide ou blancs) ou de
  plus de 2 000 caractères, sans rien écrire. Le motif est gardé sur le circuit (`workflows.reason`, avec qui l'a clos
  et quand, `closed_by` et `closed_at`), dans le commentaire du circuit (« Rejeté — révision renvoyée en rédaction.
  Motif : … ») et dans le détail de l'entrée `reject` du journal, rattachée à la révision : hors du cercle de rédaction,
  elle reste masquée tant que la révision n'est pas en vigueur (D-14). Sur l'écran Validations, « Rejeter » ouvre un
  dialogue qui demande le motif (champ obligatoire, refus du serveur pour des blancs).
- **Rappel** : `recallValidation` permet au demandeur, ou à un gestionnaire documentaire, de rappeler un circuit en
  cours tant que la dernière approbation n'est pas faite (`mayRecall`, `src/lib/access.ts` : droit Modifier, cercle de
  rédaction ; refusé sur un document verrouillé), avec un motif facultatif. Le circuit est clos avec l'issue `recalled`
  (« Rappelé »), distincte du rejet ; la révision revient en brouillon ; un commentaire et une entrée `recall` du journal
  sont écrits. Comme pour une décision, l'étape que l'utilisateur a vue est transmise : un clic sur un circuit qui a
  avancé ou qui est déjà clos ne fait rien (« Le circuit a avancé entre-temps »). Bouton « Rappeler la demande » dans
  Validations › Mes demandes (avec une phrase qui dit jusqu'à quand) et dans l'onglet Validation de la fiche.
- **Ce que voient les autres** : les valideurs sortent du cercle avec la fin du circuit ; celui dont l'étape attendait
  ne le voit plus dans sa liste ni dans « À traiter ». La fiche (onglet Validation) donne, pour un circuit rejeté ou
  rappelé, qui l'a clos, quand et le motif ; l'écran Validations les donne dans le bandeau de fin et les commentaires.
  « À traiter » de l'auteur, du modificateur et du propriétaire donne « renvoyée en rédaction par … » ou « demande de
  validation rappelée par … », avec le motif sur une ligne à part (champ `note`, abrégé à 140 caractères par `clip`,
  `src/lib/format.ts`), sur l'Accueil comme dans la cloche ; une révision rappelée n'y est plus présentée comme
  « jamais soumise ». Dans l'onglet Historique de la fiche, un long motif (une URL) passe à la ligne au lieu de
  déborder.
- **Schéma** : colonnes `closed_by`, `closed_at` et `reason` de `workflows`, renseignées à chaque fin de circuit
  (dernière approbation, rejet, rappel, retrait accepté) ; migration unique régénérée.
- **Choix à confirmer** (`docs/decisions.md`, « Choix de l'assistant non validés explicitement ») : longueur du motif,
  qui peut rappeler (pas le propriétaire qui n'a pas fait la demande), droit Modifier exigé.
- **Après relecture** : le message qui verrouille type et contexte pendant un circuit (`circuit_running`) ne suppose
  plus que le lecteur peut rappeler la demande (« attendez sa décision, ou que son demandeur (ou un gestionnaire
  documentaire) rappelle la demande ») ; guillemets anglais dans `reject_hint` en anglais. Vérifié dans le navigateur
  sur une base neuve : le motif occupe sa propre ligne sur la carte de l'Accueil et dans la cloche (Gabriel Comte ;
  Camille Morvan, dont le motif contient une longue URL abrégée ; Lucas Fabre en anglais) ; dans l'Historique de
  `FDS-HLT-026-001`, la même URL passe à la ligne sans défilement horizontal ; le dialogue « Modifier les
  métadonnées » de Claire Bardet sur `RSQ-HSE-0001` affiche le nouveau message ; « Reject » en anglais dit “To do”.
- **Vérifié** : `npm test` (390 tests, dont les 16 de `tests/integration/reject-recall.test.ts`, `mayRecall`, `draftTodo`
  et `clip`), `npm run typecheck`, `npm run lint`. Les tests échouent si le motif n'est plus exigé, si le rappel laisse
  la révision en revue, l'ouvre à un valideur ou au propriétaire qui n'a pas fait la demande, s'il agit deux fois, si
  le bouton « Rappeler la demande » n'est plus proposé au demandeur et au gestionnaire (`recallable`), ou si la fiche
  d'un document sans révision en vigueur reste « En revue » après un rejet ou un rappel.
  Dans le navigateur, sur une base de démo neuve : Hélène Sauvage (valideur) ouvre « Rejeter » sur W-304 ; sans motif,
  le formulaire ne part pas ; avec des blancs, le serveur répond « Le motif du rejet est obligatoire. » et rien ne
  change ; avec un motif, le circuit quitte sa liste. Gabriel Comte, demandeur, voit « Rejeté · Hélène Sauvage ·
  11/10/2026 » et le motif dans Validations, sur la fiche de `RPT-HLT-026-001` et dans « À traiter ». Lucas Fabre
  rappelle W-305 depuis Mes demandes, avec un motif : « Rappelé », révision A en brouillon, et W-305 disparaît de
  « À valider » de Claire Bardet (pastille de 3 à 2). Julien Wagner rappelle W-307 depuis la fiche de `PRT-R2601-001`,
  sans motif : la liste de Yasmine Aït-Saïd, qui devait décider, devient vide. Clic périmé : Julien Wagner affiche W-301,
  Antoine Girard donne la dernière approbation, puis Julien Wagner rappelle : message « Le circuit a avancé
  entre-temps », la révision D reste en vigueur. James Holt (auditeur) n'a pas accès au brouillon rappelé. Vue en
  anglais vérifiée (« Recalled », « Reason », journal « Approval request recalled »).


### 14.4 Recherches enregistrées personnelles et partagées

Point 2 de [reste-a-faire.md](reste-a-faire.md) (G12, G15, FON-06) : les trois recherches enregistrées de l'écran
Recherche venaient du jeu de démonstration, sans propriétaire ni portée, et personne ne pouvait en créer, en supprimer
ou en partager.

- **Schéma** : `saved_searches` gagne `owner_id`, `scope` (`personal`, `department`, `group`) et `department`, avec
  deux contraintes (portée connue ; un département pour une recherche de département et pour elle seule) ; migration
  unique régénérée. Le seed reprend les trois recherches comme recherches de groupe de Claire Bardet.
- **Droits** (`src/lib/access.ts`) : `maySaveSearch` (recherche personnelle avec le droit « Lire » ; partagée selon
  `mayShareSearches` : gestionnaire documentaire ou droit « Administrer »), `seesSavedSearch` (les siennes, celles de
  son département, celles du groupe ; ceux qui partagent voient aussi celles des autres départements),
  `mayDeleteSearch` (le propriétaire pour une recherche personnelle, ceux qui partagent pour une recherche partagée).
- **Actions** (`src/lib/actions.ts`) : `saveSearch` refuse une portée inconnue, un partage sans le droit, un libellé
  vide ou de plus de 80 caractères, une recherche sans critère et un département inconnu ; il ne garde que les
  critères nettoyés par `cleanCriteria` (`src/lib/search.ts` : facettes connues, valeurs textuelles distinctes et
  bornées). `deleteSavedSearch` répond « introuvable » pour une recherche que l'utilisateur ne voit pas (la recherche
  personnelle d'un autre, celle d'un autre département) et refuse la suppression d'une recherche partagée à qui ne
  partage pas.
- **Écran Recherche** : bouton « Enregistrer la recherche » dès qu'un critère est choisi, qui ouvre un dialogue
  (libellé, critères lus, portée « Vous seul / Un département / Tout le groupe » et département pour qui peut
  partager ; sinon une phrase dit que la recherche sera personnelle et qui peut partager). Dans la liste : recherches
  du groupe, du département, puis personnelles ; marque « Perso » ou code du département, info-bulle « Partagée avec
  … · par … » ; suppression (×) au survol ou au clavier, par-dessus la fin de la ligne pour ne pas couper les libellés,
  avec confirmation. L'URL de l'écran n'a pas encore de tri : `sort` reste l'ordre d'affichage. Le tri devra aussi
  être enregistré par les recherches enregistrées quand le point 12 l'ajoutera (`saveSearch`, `cleanCriteria`,
  `searchHref` ; nouvelle colonne de `saved_searches` distincte de `sort`, par exemple `order_by`) ; la fiche du
  point 12 le mentionne.
- **Requête** : `listSavedSearches` filtre en SQL (`savedSearchesSeenBy`, `src/lib/access.ts`, même règle que
  `seesSavedSearch`) : les recherches personnelles des autres ne sont jamais chargées par le serveur.
- **Visibilité** (D-14) : une recherche enregistrée n'est qu'un lien vers l'écran Recherche avec ses critères ; les
  résultats passent par les mêmes filtres de lecture, et la liste des recherches ne contient aucun document.
- **Choix à confirmer** (`docs/decisions.md`, `docs/modele-cible.md` §5) : qui partage et qui supprime, ce que voient
  les gestionnaires.
- **Vérifié** : `npm test` (417 tests, dont les 16 de `tests/integration/saved-searches.test.ts`, les règles de
  `src/lib/access.ts` et `cleanCriteria`), `npm run typecheck`, `npm run lint`. Les tests échouent si la requête SQL
  et `seesSavedSearch` divergent pour une personne (avec ou sans département, avec ou sans le droit « Administrer »),
  si une recherche personnelle devient visible d'un autre (gestionnaire compris), si un collaborateur, un valideur ou
  un auditeur peut partager, si un détenteur du droit « Administrer » ne le peut plus, si une recherche de département
  sort de son département, si la suppression d'une recherche partagée est ouverte à son lecteur, ou si une recherche
  ouverte par un auditeur fait apparaître un brouillon ou un document confidentiel d'un autre département.
  Dans le navigateur, sur une base de démo neuve : Claire Bardet voit les trois recherches de groupe, sans bouton
  « Enregistrer » tant qu'aucun critère n'est choisi ; elle enregistre « Qualité en vigueur » (Qualité, En vigueur)
  pour tout le groupe, « Externes de Claire » (« pompe », externe) pour elle seule et « Procédures ING » pour le
  département Ingénierie. Julien Wagner (collaborateur, ING) voit les recherches de groupe et « Procédures ING », pas
  celle de Claire, ni bouton de suppression sur les recherches partagées ; son dialogue n'offre aucune portée ; il
  enregistre « Mes notes béton », l'ouvre (`?q=béton&department=ING`) puis la supprime après confirmation. Léa
  Marchand (PRJ) ne voit que les quatre recherches de groupe. Vue en anglais vérifiée (« Save search », « Name »,
  « Criteria »).


### 14.5 Recherche : facettes manquantes, période et tri

Point 12 de [reste-a-faire.md](reste-a-faire.md) (G15, G32, FON-04) : la recherche n'avait que huit facettes, une
valeur par document et par facette (pas de mots-clés), aucune date et un ordre fixe (date de modification).

- **Facettes** (`src/lib/search.ts`) : sous-type, site, propriétaire, auteur, langue, mots-clés, organisme source,
  phase projet, lot, discipline et thème de recherche s'ajoutent. `facetValues` renvoie une liste ; `passes` garde un
  document qui a l'une des valeurs choisies ; `runSearch` rend `tally(k)`, le nombre de documents par valeur sous tous
  les autres critères, calculé une fois par facette. L'auteur est celui que la fiche affiche (texte libre, sinon
  l'utilisateur auteur, sinon le propriétaire).
- **Période** : une date au choix (modification, émission, effet, révision, expiration), bornes comprises, l'une
  pouvant manquer (`date`, `from`, `to` dans l'URL ; jours invalides ignorés, bornes remises dans l'ordre par
  `cleanPeriod`). La date d'effet est celle de la révision en vigueur, comme sur la fiche (`effectiveDates`,
  `src/lib/queries.ts`). Seules la recherche et son export la lisent (`listSearchDocs`, copies de la liste partagée) :
  les autres écrans ne paient pas cette lecture.
- **Tri** (`sort` dans l'URL) : pertinence, date de modification, date d'émission, prochaine échéance (révision ou
  expiration), ID, titre ; sans choix, pertinence s'il y a un texte, date de modification sinon (`sortOf`). La
  pertinence (`score`) pondère le champ où le texte est trouvé (ID et anciens ID, titre, mots-clés, référence
  externe et ID d'étude, le reste) et la façon dont il y est (champ entier, début de mot, morceau de mot). Le plein
  texte couvre aussi le propriétaire, l'auteur et l'ID d'étude.
- **URL** : chaque valeur choisie a son propre paramètre (`?discipline=Électricité&discipline=Mécanique`), si bien
  qu'une valeur en texte libre peut contenir une virgule (« Préfecture du Rhône, DDPP ») ; les facettes à codes
  acceptent encore la forme `?type=PRO,NCR` des anciens liens. L'export lit les paramètres répétés de la même façon.
- **Écran** : nouvelles facettes présentées comme dans la maquette (case, libellé, nombre ; une valeur longue est
  coupée et se lit au survol) ; au-delà de 8 options, les
  autres se replient sous « N de plus », les valeurs choisies restant visibles ; bloc « Période » (date, du, au,
  appliqué pendant la saisie) en bas de la colonne, avec un bouton pour l'effacer ; sélecteur « Trier par » au-dessus
  des résultats ; la date en fin de ligne suit le tri (émission, échéance, sinon modification). « Effacer » garde le
  tri. Libellés des valeurs partagés avec le journal des exports (`facetValueL`, `searchCriteriaL`).
- **Export CSV** : mêmes critères, même ordre que l'écran ; colonnes site, mots-clés, dates d'émission, d'effet, de
  révision et d'expiration en plus ; le journal garde la période et le tri (« Mots-clés : ATEX · Date d'émission :
  depuis le 01/01/2026 · Tri : Date d'émission · 2 lignes »).
- **Recherches enregistrées** : `saved_searches` gagne `period` et `order_by` (contrainte sur les valeurs ; `sort`
  reste l'ordre d'affichage) ; migration unique régénérée. `saveSearch` reçoit la recherche entière, nettoyée par
  `cleanCriteria` (période valide, tri connu) ; une période seule est un critère, un tri seul ne l'est pas. Une valeur
  de facette y tient jusqu'à 300 caractères, le plus long texte libre que l'import accepte (l'organisme source) ;
  au-delà, ou au-delà de 50 valeurs par facette ou d'un texte de 200 caractères, `saveSearch` refuse avec un message
  (`beyondBounds`) au lieu d'enregistrer une recherche plus large que celle affichée.
- **Visibilité** (D-14) : facettes, comptes, période et tri ne portent que sur `listDocs`, donc sur les documents que
  l'utilisateur peut lire ; hors du cercle de rédaction, la date de modification est celle du dernier changement
  visible, et la date d'effet ne vient jamais d'une révision approuvée en attente.
- **Choix à confirmer** (`docs/decisions.md`) : définition de l'auteur et de l'échéance, ordre par défaut, poids de
  la pertinence, une seule période, repli des longues facettes.
- **Reste** : le filtrage et les comptes se font toujours en mémoire sur tous les documents visibles (point 50).
- **Relecture** : quatre corrections. Les valeurs de plus de 64 caractères (borne héritée des facettes à codes) et
  celles qui contiennent une virgule se perdaient à l'enregistrement ou ne pouvaient pas être choisies : paramètres
  répétés et borne de 300 caractères, avec refus explicite au-delà. La date d'effet n'est plus lue à chaque page.
  Un test vérifie enfin que l'export d'un auditeur écarte le brouillon par la visibilité, et non par la période
  (remplacer la liste visible par `listDocs(ctx, { includeHidden: true })` le fait échouer).
- **Vérifié** : `npm test` (456 tests, dont `tests/unit/search.test.ts` et `tests/integration/search.test.ts`),
  `npm run typecheck`, `npm run lint`. Les tests échouent si l'aller-retour URL perd la période, le tri ou une valeur
  avec virgule, si un mot-clé d'un brouillon jamais en vigueur est compté, trouvé ou exporté pour un auditeur, si la
  période ou le tri par date de modification utilisent la date du travail en cours hors du cercle, si la date d'effet
  vient d'une révision approuvée en attente, si l'export ne suit pas les critères ou l'ordre de l'écran, ou si une
  recherche enregistrée perd sa période, son tri ou une valeur longue. Dans le navigateur, sur une base de démo neuve, Claire Bardet coche Discipline
  « Électricité » et « Mécanique », puis Propriétaire « Samir Haddad » (4 résultats, dont la liste des câbles en
  brouillon), trie par titre, puis limite la date d'émission à partir du 01/06/2026 (3 résultats) :
  `?owner=shaddad&discipline=Électricité&discipline=Mécanique&sort=title&date=issued&from=2026-06-01`. L'export CSV donne les
  trois mêmes documents dans le même ordre ; le dialogue d'enregistrement liste « Propriétaire : Samir Haddad »,
  « Discipline : Électricité, Mécanique », « Date d'émission : depuis le 01/06/2026 », « Tri : Titre » ; la recherche
  enregistrée rouvre la même URL, avec le tri et la période dans leurs champs ; « Effacer » ne garde que `?sort=title`.
  Sur HLT-026, la facette Discipline compte Automatisme 3 et Électricité 4 pour Claire Bardet, mais pas Automatisme et
  Électricité 3 pour Julien Wagner (brouillons de Camille Morvan et de Samir Haddad hors de son cercle) ; son export
  de HLT-026 a les 23 lignes de son écran, contre 33 pour Claire Bardet. Après avoir donné à MNT-CHA-0001 l'organisme
  source « Direction régionale de l'environnement de l'aménagement et du logement » (70 caractères) et à AUT-JUR-0001
  « Préfecture du Rhône, DDPP », chacun se coche dans la facette, s'exporte, s'enregistre et se rouvre avec le même
  résultat ; une valeur de 301 caractères est refusée avec son message. Vue en anglais vérifiée (« Sort by », « Issue
  date », dates en fin de ligne).


### 14.6 Pages par département

Point 11 de [reste-a-faire.md](reste-a-faire.md) (G12, FON-06) : le deck annonce « des pages dédiées métiers […] pour
mettre en avant les filtres principaux » ; Codex n'avait que l'axe Département de l'explorateur et les recherches
enregistrées.

- **Écran** (`src/app/departements`) : entrée « Départements » de la barre latérale (icône ajoutée dans le trait de la
  maquette, qui n'en prévoit pas) ; `/departements` ouvre le département de l'utilisateur, ou le premier pour qui n'en
  a pas (`defaultDepartment`, `src/lib/departments.ts`) ; un sélecteur passe à un autre département
  (`/departements/QUA`) ; un code inconnu donne « Ce département n'existe pas ». Mise en page de l'Accueil, sans
  nouvelle identité : titre et code, phrase sur le caractère provisoire des départements et des filtres, trois
  indicateurs (documents en vigueur, échéances sous 90 jours, circuits en cours), puis deux colonnes : documents en
  vigueur (8 premiers, « Tout voir » vers `/recherche?department=QUA&status=in_force`) et circuits en cours ; filtres
  mis en avant, recherches enregistrées et échéances. Un CSS module (`departments.module.css`), textes FR et EN.
- **Lecture** (`departmentPage`, `src/lib/queries.ts`) : les listes des autres écrans, filtrées sur le département,
  donc sous leurs règles (D-14) : documents que l'utilisateur peut lire (`listDocs`) ; échéances de l'Accueil
  (`deadlines`) ; circuits en cours qu'il suit (`listWorkflows`, `visible` : tous pour un gestionnaire, sinon ceux
  auxquels il prend part, jamais hors du cercle de rédaction) ; recherches partagées avec le département puis avec le
  groupe (`listSavedSearches`), jamais les personnelles.
- **Filtres mis en avant** (`featuredFilters`, `src/lib/departments.ts`) : des facettes de la recherche (toutes sauf le
  département), dont la page donne les 6 valeurs les plus fréquentes dans les documents lisibles du département, avec
  leur nombre ; chaque valeur mène à `/recherche?department=…&<facette>=<valeur>`, dont les résultats sont les
  documents comptés ; une facette sans valeur est omise, comme dans la recherche. Par défaut : type de document,
  statut, projet ou programme.
- **Réglage** : Administration › Organisation gagne une colonne « Filtres mis en avant » (« Filtres par défaut », la
  liste au survol, ou la liste du département, suivie du bouton de réglage) et un dialogue : suivre les filtres par défaut, ou une liste propre de
  6 facettes au plus, ordonnée comme les étapes d'un circuit. `setDepartmentFeatured` (`src/lib/actions.ts`) est
  réservé au droit Administrer, comme le reste de l'écran, refuse une liste invalide (`cleanFeatured`) et journalise
  l'avant et l'après (« Filtres mis en avant : Filtres par défaut → Discipline, Type de document, Statut,
  Mots-clés ») ; un enregistrement sans changement ne laisse pas d'entrée. Colonne `departments.featured` (null :
  filtres par défaut) ; migration unique régénérée ; le seed laisse tous les départements sur les filtres par défaut.
  La page dit si ses filtres suivent le réglage par défaut ou ont été réglés pour le département, et distingue une
  liste réglée vide (« Aucun filtre mis en avant pour ce département ») de filtres sans valeur lisible.
- **Relecture** : le tableau des départements, élargi par la nouvelle colonne, débordait sur celui des sites entre
  1100 et 1366 px ; il défile désormais dans sa colonne, et les deux tableaux s'empilent sous 1360 px (vérifié à 900,
  1100, 1200, 1280, 1366 et 1500 px). `listWorkflows` est chargé une fois par requête et partagé entre « À traiter » et
  la page (`cache`, comme `listDocs`). Sous-titre « Département » au lieu de « Département / Fonction ». Le point 116
  de reste-a-faire.md note que la page existe.
- **Choix prudents** (`docs/decisions.md`, `docs/modele-cible.md` §5) : aucun choix par métier n'est fait à la place
  des départements, faute de recueil des besoins (slide 9) et d'organigramme (O-04) ; la page ne montre rien que les
  autres écrans ne montrent déjà à l'utilisateur ; chacun peut ouvrir la page de n'importe quel département, qui ne
  lui montre que ce qu'il peut lire.
- **Vérifié** : `npm test` (479 tests, dont les 10 de `tests/unit/departments.test.ts` et les 13 de
  `tests/integration/departments.test.ts`), `npm run typecheck`, `npm run lint`. Les tests échouent si la page lit
  les documents sans filtre de lecture ou montre les circuits sans la règle de Validations (vérifié en cassant
  `departmentPage`), si un brouillon ou un document confidentiel d'un autre département est montré ou compté, si une
  recherche d'un autre département ou personnelle apparaît, si un lien mène à d'autres résultats que ceux comptés, si
  le réglage est ouvert à un collaborateur, un valideur ou un auditeur, ou s'il n'est pas journalisé. Dans le
  navigateur, sur une base de démo neuve : Claire Bardet ouvre `/departements` et arrive sur HSE (3 documents en
  vigueur, le circuit de `RSQ-HSE-0001`), puis choisit QUA (11 documents en vigueur, dont l'audit confidentiel
  `AUD-QUA-0001`, 2 échéances) ; « Formulaire / modèle 3 » mène à `/recherche?type=FRM&department=QUA`, 3 résultats.
  Julien Wagner (ING) arrive sur ING (7 documents, son circuit sur `BOM-HLT-026-001`) ; sur QUA, il en voit 10, sans
  `AUD-QUA-0001` ni sa valeur « Rapport d'audit interne » ; sur RHU et DSI, ni la matrice de compétences ni le PRA,
  confidentiels. James Holt (auditeur, QUA) arrive sur QUA, sans circuit. Claire Bardet règle ING dans Administration
  (Discipline, Type de document, Statut, Mots-clés) : la page de Julien Wagner les montre dans cet ordre
  (« Électricité 3 » mène à 3 résultats), QUA garde les filtres par défaut ; retour aux filtres par défaut, les deux
  changements sont au journal ; Julien Wagner n'a pas accès à Administration. Après relecture : une liste propre
  change le bandeau de la page (« ont été réglés pour ce département »), une liste vide donne « Aucun filtre mis en
  avant pour ce département » (sur RHU, sans document lisible, Julien Wagner garde « Aucune valeur à mettre en
  avant »), le retour aux filtres par défaut rétablit le bandeau ; trois entrées au journal. Vue en anglais vérifiée (« Department
  page », « Departments », « Featured filters »).

## 15. Lot 6 (12 oct.)

Points « développables maintenant » de [reste-a-faire.md](reste-a-faire.md), une étape par point, chacune relue avant
son commit. Aucune question ouverte n'est tranchée : un choix qui en dépend prend l'option la plus prudente et est
consigné dans [decisions.md](decisions.md) (« Choix de l'assistant non validés explicitement »).

| Étape | Commit | Point | Ce qui change | Choix prudents |
|---|---|---|---|---|
| 1. Dates (§15.1) | `71b1da3` | 3 | Dates contrôlées (jour réel, année 0000 refusée) et tenues dans l'ordre émission ≤ effet < expiration, dans les Server Actions, l'import et les dialogues (erreur sous le champ fautif) | « Postérieure » au sens strict ; émission prise comme première mise en vigueur ; bornes du jour limitées aux dates saisies ; demande sans date d'effet d'un document expiré acceptée |
| 2. Expiration et revue (§15.2) | `b940bd7` | 13 | Indicateurs « Expiré » et « Revue en retard » partout où le document se lit, « Revue effectuée », périodicité de revue par type | Aucun statut nouveau ni automatisme (D-17) ; périodicités vides (O-05) ; effet de l'expiration laissé ouvert (A17) |
| 3. Liens (§15.3) | `813d7fe` | 16 | « Remplace », « Remplacé par », « Voir aussi » ; remplaçant proposé avec un retrait et lié à son application | Trois natures seulement (M11) ; droits sur les deux documents ; lien et journal invisibles vers un document illisible (D-14) |
| 4. Fiche de visa (§15.4) | `555761c` | 21 | PDF tiré du journal pour une révision approuvée, depuis l'onglet Révisions | Pas de signature électronique (M04) ; commentaires réservés à qui suit le circuit |
| 5. Modifications simultanées (§15.5) | `eef9ada` | 20 | Version de la fiche et dernière version de travail vues par les dialogues ; refus d'une action partie d'une vue périmée | Détection optimiste seulement ; réservation d'un brouillon proposée, non appliquée |
| 6. Listes en base (§15.6) | commit « Lot 6, étape 6 », qui suit `eef9ada` | 50 | Recherche, export, explorateur et journal filtrés, comptés et paginés par la base, avec les mêmes résultats que la version en mémoire, gardée comme référence des tests | Tailles de page provisoires (O-11) ; anciens ID suivis par le filtre du journal pour un document lisible seulement (D-14) ; l'en-tête commun charge encore tous les documents |

### 15.1 Dates : format contrôlé et cohérence émission ≤ effet ≤ expiration

Point 3 de [reste-a-faire.md](reste-a-faire.md) (MET-03, règle 12 de l'audit) : une Server Action acceptait n'importe
quelle chaîne pour une date (erreur SQL à l'enregistrement), et aucune règle ne liait les dates entre elles.

- **Règles** (`src/lib/dates.ts`) : expiration postérieure à l'émission et à la date d'effet de la révision (la plus
  tardive de la révision en vigueur et d'une révision approuvée ou en revue), révision postérieure à l'émission,
  réception ni future ni postérieure à l'émission, mise en vigueur au plus tôt à l'émission (import). Un document pas
  encore émis le sera au plus tôt aujourd'hui, ou à la date d'effet de la révision qui l'émettra (`issueFrom`) ; une
  révision en revue sans date d'effet prendra effet à son approbation, au plus tôt aujourd'hui (`latestEffect` avec
  la date du jour). Un message FR et EN par règle donne la date à respecter et dit quoi corriger.
- **Server Actions** (`src/lib/actions.ts`) : `validateFields` refuse une date qui n'est pas un jour `AAAA-MM-JJ`
  (`parseIsoDay`, qui refuse aussi l'année 0000 ; « Date d'expiration : date invalide… ») et une réception future.
  `createDocument` refuse une expiration ou une révision au plus tard le jour même. `updateMeta` vérifie, dans sa
  transaction, toutes les dates contre l'émission et les dates d'effet enregistrées, puis les seules dates saisies ou
  modifiées contre ce qui dépend du jour (document pas encore émis, révision en revue sans date d'effet) : le temps
  seul ne bloque pas une date laissée telle quelle. `requestValidation` refuse une date d'effet égale ou postérieure à
  l'expiration et, pour un document pas encore émis, une expiration ou une révision au plus tard le jour où la
  révision l'émettra (sa date d'effet, ou aujourd'hui). L'erreur porte le champ (`ActionResult.field`).
- **Import** (`src/lib/importer.ts`) : mêmes règles sur les dates telles qu'elles seront enregistrées (`recordedDates`,
  partagé avec `importDocument`), y compris pour un brouillon ou une mise en vigueur à venir, un code par règle,
  renvoyé avec les autres problèmes (`docs/api.md`).
- **Dialogues** : à la création et dans les métadonnées, l'erreur s'affiche sous le champ fautif, qui reçoit le focus,
  `aria-invalid` et une bordure d'accent ; ailleurs, en bas du dialogue comme avant.
- **Données de démo** : le devis Nordvolt (`RFQ-HLT-026-001`) était reçu le 28 juin, après sa date d'émission du
  12 juin : il l'est désormais le 10 juin. Base de démo remise à zéro ; toutes ses dates respectent les règles, y
  compris celles qui dépendent du jour.
- **Choix prudents** (`docs/decisions.md`, `docs/modele-cible.md` §7) : « postérieure » au sens strict ; date
  d'émission prise comme première mise en vigueur, donc comme borne de la réception ; bornes du jour limitées aux
  dates saisies. Sans date d'effet, la demande de validation d'un document déjà émis est acceptée même s'il a expiré
  (renouvellement) : la nouvelle expiration se saisit une fois la révision en vigueur, et l'effet de l'expiration
  reste ouvert (audit, A17).
- **Relecture** : neuf constats, dont deux en double, tous retenus. Une expiration saisie pendant une revue sans date d'effet était
  acceptée même passée ; la date de révision d'un document pas encore émis n'était comparée à rien (création,
  métadonnées, demande de validation, import d'une mise en vigueur à venir) ; l'année 0000 passait le contrôle de
  format et finissait en erreur SQL ; aucun test ne vérifiait le format de la réception. La demande sans date d'effet
  d'un document expiré n'est plus refusée : elle bloquait le renouvellement, ou obligeait à publier la nouvelle
  expiration avant l'approbation (D-14). Les messages de la demande de validation ne supposent plus le droit de
  modifier les métadonnées. La limite restante est mieux décrite (ci-dessous).
- **Reste** : une approbation qui arrive après l'expiration (sans date d'effet, ou quand la date d'effet est passée)
  met encore la révision en vigueur ; le dialogue de métadonnées demande alors de reporter l'expiration. L'expiration
  ne déclenche toujours rien (point 13).
- **Vérifié** : `npm test` (535 tests, dont les 19 de `tests/unit/dates.test.ts` et les 37 de
  `tests/integration/dates.test.ts`, qui passent aussi toutes les dates de la base de démo aux règles), `npm run
  typecheck`, `npm run lint`. Les tests échouent si l'on retire l'une des vérifications (essayé pour le format de la
  réception, l'année 0000, les bornes du jour de `updateMeta` et de `createDocument`, la révision en revue sans date,
  la demande de validation d'un document pas encore émis et l'import d'une mise en vigueur à venir). Dans le
  navigateur, sur une base de démo neuve : Claire Bardet saisit une expiration au 31/12/2021 sur `PRO-QUA-0001` (émis
  le 03/02/2022) : « La date d'expiration doit être postérieure à la date d'émission du document (03/02/2022) :
  choisissez une date plus tardive. » sous le champ, qui a le focus ; la fiche est inchangée. Julien Wagner ne peut
  plus fixer au 01/01/2020 l'expiration de `PRT-R2601-001`, en revue et jamais émis (« La révision A, en cours de
  validation, prendra effet à son approbation… »), et une création avec une date de révision passée est refusée sous
  ce champ.

### 15.2 Expiration et revue périodique : effet sur le cycle de vie

Point 13 de [reste-a-faire.md](reste-a-faire.md) (G36, G37, WFL-07) : les dates d'expiration et de révision n'étaient
que des échéances, sans indicateur, sans moyen d'enregistrer une revue et sans périodicité par type. Rien n'est
devenu un statut : le retrait reste une demande à Vigie (D-17).

- **Règles** (`src/lib/review.ts`) : un document actif est « Expiré » le lendemain de sa date d'expiration ; sa revue
  est « en retard » le lendemain de sa date de révision, s'il a une révision en vigueur. `docView` porte les deux
  indicateurs (`expired`, `reviewOverdue`) : ils ne valent que pour les documents que l'utilisateur lit déjà (D-14).
- **Écrans** : étiquettes sur la fiche, dans l'explorateur, son aperçu rapide et la recherche ; bandeau sur la fiche,
  avec « Demander une modification » et « Demander le retrait » pour un document expiré et « Revue effectuée » pour
  une revue en retard ; filtre « Échéance dépassée » de l'explorateur, sous le plan de classement et combiné au statut
  (« Expirés », « Revues en retard », `?due=`), filtres d'Archivage (`?f=`) ; facette « Échéance dépassée » de la
  recherche (`?overdue=`), enregistrable et exportable. « À traiter », l'Accueil et les pages de département disent
  « Expiré, valable jusqu'au … » et « Revue en retard, prévue le … » (`deadlines().dueL`).
- **Revue effectuée** (`recordReview`, src/lib/actions.ts) : depuis la fiche (bandeau, onglet Fiche) ou Archivage,
  par le propriétaire, le propriétaire de processus ou un gestionnaire documentaire avec le droit « Modifier »
  (`mayRecordReview`, src/lib/access.ts), sur un document lisible, non verrouillé, avec une révision en vigueur.
  Commentaire facultatif ; prochaine date saisie, postérieure à aujourd'hui, ou périodicité du type ; aucune révision
  créée ; entrée « Revue effectuée » au journal du document. Le propriétaire de processus reçoit désormais ses revues
  dans « À traiter ».
- **Périodicité** : colonne `doc_types.review_months` (mois, 1 à 240, vide par défaut, migration unique régénérée),
  colonne « Revue » et champ du dialogue de type dans Administration › Registre des types (journalisé), champ
  `reviewMonths` de `/api/registry`. `putInForce` fixe la date de révision d'un document qui n'en a pas (entrée
  « Prochaine revue fixée ») ; une date déjà saisie est gardée. Le dialogue de création l'annonce sous la date de
  révision ; celui des métadonnées d'un document en vigueur prévient qu'une date vidée ne laisse aucune revue
  planifiée avant la prochaine révision (`reviewDueHint`, src/lib/review.ts). Aucune valeur n'est mise dans le registre : ni le deck, ni la spec Keystone, ni
  [registre-points-ouverts.md](registre-points-ouverts.md) n'en donnent (O-05).
- **Données de démo** : vérification générale périodique d'un pont roulant (`MNT-CHA-0002`) expirée le 30 septembre ;
  revue de `PRO-QUA-0002` (Traitement des non-conformités) prévue le 30 septembre.
- **Choix prudents** ([decisions.md](decisions.md)) : jour de l'expiration encore valide ; indicateurs sur les seuls
  documents actifs ; une date de révision déjà saisie n'est pas recalculée à la mise en vigueur ; l'import reprend les
  dates telles quelles ; vider la date dans les métadonnées ne la recalcule pas ; ce qui doit se passer à
  l'expiration (A17) reste ouvert.
- **Relecture** : les deux filtres, d'abord ajoutés à la barre de statut de l'explorateur, renvoyaient « Nouveau » à la
  ligne à 1440 px ; ils forment désormais un filtre à part sous le plan de classement, et l'en-tête retrouve les
  positions d'avant (mesurées à 1280, 1440, 1600 et 1920 px, avec et sans aperçu rapide). L'aide « elle sera fixée à
  la mise en vigueur » ne s'affiche plus pour un document déjà en vigueur, à qui elle promettait un calcul qui n'a pas
  lieu. « Expiré depuis le 30/09 » contredisait la règle (le 30/09, le document est encore valide) : les écrans disent
  « valable jusqu'au ».
- **Vérifié** : `npm test` (577 tests, dont `tests/unit/review.test.ts` et `tests/integration/review.test.ts`),
  `npm run typecheck`, `npm run lint`. Les tests échouent si l'on retire le contrôle des droits de `recordReview`, le
  calcul de `putInForce` ou la règle du propriétaire de processus dans « À traiter » (essayé). Dans le navigateur,
  sur une base de démo neuve : Claire Bardet voit `MNT-CHA-0002` sous « Expirés » dans l'explorateur (seul, et rien
  avec « Brouillons »), avec l'étiquette, dans la recherche (« Échéance dépassée : Expiré 1 ») et dans Archivage ; sa
  fiche porte le bandeau « Document expiré, valable jusqu'au 30/09/2026 : à renouveler par une demande de
  modification, ou à retirer. » et ses deux raccourcis. Julien Wagner, collaborateur, voit la revue en retard de `PRO-QUA-0002` mais « Revue effectuée » lui est
  refusé (« Revue réservée au propriétaire du document… »). Gabriel Comte, propriétaire, la trouve dans « À traiter »
  (« Revue en retard, prévue le 30/09/2026 · 12 j de retard »), l'enregistre au 30/09/2027 avec un commentaire :
  bandeau retiré, fiche datée du jour, entrée au journal, lue aussi par Julien Wagner. Claire Bardet règle la
  périodicité de PRO à 36 mois (300 refusé sous le champ), la voit annoncée à la création, puis enregistre depuis
  Archivage la revue de `PRO-QUA-0001` sans date : prochaine revue le 12/10/2029. Sur `PRO-QUA-0001`, en vigueur, le
  dialogue des métadonnées de Gabriel Comte dit « Laissée vide, aucune revue n'est planifiée… ». Vue en anglais
  vérifiée (« Document expired, valid until 30 Sep 2026 »).

### 15.3 Lien « remplacé par » entre documents

Point 16 de [reste-a-faire.md](reste-a-faire.md) (M11 de l'audit) : un document retiré par Vigie (D-17) ne disait pas
quel autre document, d'un autre ID, le remplaçait, et aucune table ne reliait deux documents. Les révisions d'un même
document gardent leur statut « Remplacé » (D-11) ; le lien ne concerne que des documents distincts.

- **Modèle** : table `document_links` (source, cible, nature `replaces` ou `see_also`, auteur, jour), un enregistrement
  orienté par paire : « remplacé par » est le lien `replaces` lu depuis sa cible (`src/lib/links.ts` : `storedLink`,
  `relOf`, `linkIssue`). La base refuse un lien vers soi-même, une seconde paire dans un sens ou dans l'autre et une
  nature inconnue ; les deux clés étrangères suivent `documents.id` en cascade, comme les autres tables : un
  reclassement emporte les liens. Colonne `change_requests.replacement_id` (retrait seulement, jamais le document
  lui-même). Migration unique régénérée.
- **Demande de retrait** : champ « Document de remplacement (facultatif) » du dialogue, parmi les documents actifs
  que le demandeur peut lire ; `requestChange` le contrôle de nouveau (introuvable ou illisible : même réponse ; obsolète
  ou archivé ; le document lui-même) et le garde sur la demande. Rien n'est lié avant la décision : quand le retrait
  accepté s'applique, aussitôt ou à la levée d'un verrou, `implementChange` revérifie le remplaçant
  (`replacementOutcome`) puis crée le lien au nom de Vigie, avec l'ECO, et remplace un « voir aussi » entre les deux.
  Un remplaçant devenu obsolète ou archivé, un gel juridique sur l'un des deux documents ou un « remplace » en sens
  inverse ne lient rien et ne touchent à aucun lien : le journal du document retiré dit « Remplacement non appliqué »,
  avec la raison. Un refus ne lie rien.
- **Fiche** : section « Documents liés » de l'onglet Fiche (nature, ID et titre, statut tel que le lecteur le voit,
  « Retirer »), bouton « Lier un document » (dialogue : « Voir aussi », « Remplace », « Remplacé par »). Ajout et
  retrait demandent les droits sur les deux documents : leur propriétaire, ou un gestionnaire documentaire, avec le
  droit « Modifier » (`mayEditLinks`, `addDocLink`, `removeDocLink`). Seul un document déjà retiré peut être
  « remplacé », et par un document actif ; un gel juridique fige les liens des deux documents, à l'ajout comme au
  retrait. Le bandeau « Obsolète » de la fiche et celui de l'aperçu rapide de l'explorateur ajoutent « Remplacé par
  {ID} » (lien vers la fiche) ; l'onglet Demandes et « Mes demandes Vigie » montrent le remplacement proposé.
- **Journal** : « Lien ajouté » et « Lien retiré », sur les deux documents, avec la nature et l'autre document
  (`audit_log.data.link`, rendu dans la langue du lecteur).
- **D-14** : un document lié que le lecteur ne peut pas lire (`canRead`) n'apparaît ni dans la section, ni dans le
  bandeau, ni dans le remplacement proposé ; `auditForReader` retire l'entrée de journal qui le nomme, sur la fiche,
  dans l'onglet Journal et dans l'export. Un brouillon jamais en vigueur n'est donc vu que de son cercle de rédaction,
  jusqu'à sa mise en vigueur.
- **API** ([api.md](api.md)) : le webhook Vigie ne transmet pas le remplacement et n'a pas changé (O-10) ; l'import
  ne crée pas de liens (O-11).
- **Données de démo** : « voir aussi » entre `PRO-HSE-0001` (Levage et manutention sur chantier) et `REG-HSE-0001`
  (arrêté du 1er mars 2004).
- **Choix prudents** ([decisions.md](decisions.md)) : trois natures seulement (le reste est M11) ; un lien par paire ;
  lien créé à l'application du retrait et non à la demande, après une nouvelle vérification du remplaçant ;
  « remplacé » réservé à un document déjà retiré, par un document actif ; droits sur les deux documents ; gel
  juridique bloquant, y compris pour Vigie ; état obsolète ou archivé non bloquant pour le document remplacé ;
  entrées de journal masquées avec le document lié.
- **Relecture** : un propriétaire pouvait écrire « Remplacé par » dans le bandeau du document retiré d'un autre (droits
  contrôlés sur un seul bout) et le propriétaire d'un remplaçant retirer le lien posé par Vigie : les droits portent
  désormais sur les deux documents, et le dialogue ne propose que les documents sur lesquels on les a. L'acceptation
  Vigie supprimait un « voir aussi » d'un document gelé et liait un remplaçant devenu obsolète entre la demande et la
  décision, sans trace quand un « remplace » existait en sens inverse : corrigé, avec l'entrée « Remplacement non
  appliqué ». La fiche acceptait « Remplacé par » vers un document obsolète ou archivé, que refusait la demande de
  retrait : une seule règle, le remplaçant est actif. Tests complétés : gel sur le document de la fiche, retrait de
  lien sous gel aux deux bouts, acceptation avec remplaçant gelé, demandes croisées, remplaçant archivé avant la
  décision.
- **Vérifié** : `npm test` (610 tests, dont `tests/unit/links.test.ts` et `tests/integration/links.test.ts`),
  `npm run typecheck`, `npm run lint`. Les tests échouent si l'on retire le contrôle `canRead` de `listDocLinks` ou
  de `auditForReader`, le lien créé à l'application du retrait, la règle « seul un document retiré est remplacé »,
  le contrôle des droits sur l'autre document (ajout ou retrait), l'un des deux bouts du contrôle de gel, la
  revérification du remplaçant ou le gel à l'application du retrait (essayé). Dans le navigateur, sur une base de démo neuve : Claire Bardet demande le retrait de `PRO-QUA-0002` en
  proposant `RSQ-HSE-0001` (en révision, jamais en vigueur ; ni le document lui-même ni un document obsolète ne sont
  proposés), l'onglet Demandes affiche « Remplacement proposé : RSQ-HSE-0001 · Analyse de risques — atelier de
  Lyon », puis elle simule l'acceptation : bandeau « Obsolète depuis le 12/10/2026 (ECO-2026-004) — ne plus appliquer
  · Remplacé par RSQ-HSE-0001 », section « Remplacé par » et, sur `RSQ-HSE-0001`, « Remplace PRO-QUA-0002 » ; même
  bandeau dans l'aperçu rapide de l'explorateur ; « Lien ajouté · ECO-2026-004 · Remplacé par RSQ-HSE-0001 » au
  journal. James Holt (auditeur) et Julien Wagner (collaborateur), hors du cercle de `RSQ-HSE-0001`, voient le
  bandeau sans « Remplacé par », « Aucun document lié », la demande sans remplacement et aucun lien au journal ; la
  page ne contient pas l'ID. Sur `PRO-HSE-0002` (obsolète), Claire Bardet ajoute puis retire « Remplacé par
  PRO-HSE-0001 » (« Remplace » ne propose que les documents retirés ; un document déjà lié n'est plus proposé) ; sur
  un document en vigueur, « Remplacé par » est grisé avec son explication ; Julien Wagner, non propriétaire, voit
  « Lier un document » grisé (« Un lien s’ajoute ou se retire par le propriétaire des deux documents… ») et aucun
  « Retirer ». Vue en anglais vérifiée (« Replaced by », « Related documents »). Après relecture, sur une base neuve : même parcours ; Julien Wagner, dans « Lier un
  document » de sa « Liste des moteurs », ne se voit proposer que ses propres documents, et rien pour « Remplace » ;
  Olivier Blanc, propriétaire de `RSQ-HSE-0001`, voit « Remplace PRO-QUA-0002 » sans « Retirer » ; sur
  `PRO-HSE-0002` (obsolète), « Remplace » est grisé (« Ce document est obsolète ou archivé : il ne remplace rien. »)
  et « Remplacé par » ne propose aucun document obsolète. Retraits croisés de `NRM-QUA-0001` (remplaçant proposé
  `MNT-CHA-0001`) et de `MNT-CHA-0001`, acceptés dans l'ordre inverse : `NRM-QUA-0001` n'a aucun lien, et son journal
  dit « Remplacement non appliqué · ECO-2026-005 · Remplacé par MNT-CHA-0001 : document obsolète, archivé ou
  introuvable ».

### 15.4 Preuve d'approbation d'une révision (fiche de visa)

Point 21 de [reste-a-faire.md](reste-a-faire.md) (P08 et M05 de l'audit) : aucune route ni action n'exportait le
circuit d'une révision, et `simplePdf` ne savait écrire qu'une page, sans retour à la ligne.

- **Route** : `GET /api/documents/[id]/approval?rev=B` sert en téléchargement `{ID}_{lettre}_VISA.pdf`. Elle passe par
  `approvalRecord` (`src/lib/queries.ts`) : `getDoc` comme la route fichier (ancien ID résolu ; document illisible :
  404), puis la révision par sa lettre, à condition qu'elle ait été approuvée et que l'utilisateur la voie
  (`mayGetApprovalRecord`, `src/lib/access.ts` : hors du cercle de rédaction, révision en vigueur ou remplacée, D-14).
  Lettre absente ou mal formée, révision en rédaction ou en revue : 404. HEAD fait les mêmes contrôles sans construire
  ni journaliser la fiche. Chaque édition est journalisée (« Fiche de visa éditée », action `visa`), sur la révision.
- **Contenu** (`src/lib/approval.ts`) : ID, titre, révision et statut, type, rattachement, propriétaire,
  confidentialité, état du document s'il est obsolète ou archivé, modificateur désigné, références ECO (D-26 : celle
  qui a ouvert la révision et celles greffées), dates de création, d'approbation, d'effet, de mise en vigueur et de
  remplacement. Puis chaque circuit de la révision, rejetés et rappelés compris : demandeur et moment de la demande,
  issue (par qui, quand), motif, chaque étape (fonction, titulaire, décision, moment pris dans le journal, sinon le jour
  de l'étape), délégations lues dans le journal (`delegate`, « Déléguée par … à … le … ») et commentaires. Révision
  importée déjà approuvée : « son approbation a eu lieu dans l'ancien système » ; révision importée en brouillon puis
  approuvée par un circuit de Codex : sa vraie date d'approbation, son circuit et une ligne « Reprise … en brouillon, de
  l'ancien système » ; révision sans circuit : « Aucun circuit de validation n'est enregistré dans Codex ». Pas de
  signature électronique (M04) : la fiche se dit extrait du journal de Codex, édité tel jour par telle personne. Langue
  du lecteur ; pied de page numéroté ; titre du PDF.
- **Ce que voit chaque lecteur** : la fiche ne montre à chacun que ce que Codex lui montre déjà. Le texte des
  commentaires d'un circuit et le titulaire d'une étape jamais décidée ne vont qu'à qui suit ce circuit
  (`followsCircuit`, `src/lib/access.ts` : gestionnaire documentaire, demandeur ou titulaire d'une étape, la règle de
  `/validations`, désormais partagée avec `listWorkflows` et `addComment`). Les autres lecteurs, propriétaire et
  auditeurs compris, lisent « 1 commentaire, lisible dans le circuit par ses participants et les gestionnaires
  documentaires ». Les issues, motifs, décisions, titulaires et délégations restent pour tous : l'onglet Validation et
  l'Historique les montraient déjà.
- **PDF** (`src/lib/pdf.ts`) : retour à la ligne mesuré sur les largeurs des polices Helvetica et Helvetica-Bold (un
  mot trop long est coupé, une espace insécable tient « 1 200 € » ensemble), accents et glyphes WinAnsi (œ, €,
  guillemets), substituts pour quelques caractères hors WinAnsi, colonne de libellés, gras, plusieurs pages avec pied de
  page, titre lu par les lecteurs PDF ; un intitulé n'est jamais laissé seul en bas de page. Le fichier de remplacement
  des documents de démonstration reste une page.
- **Fiche** : bouton « Fiche de visa » sur chaque révision approuvée de l'onglet Révisions (`DocClient.tsx`), absent
  pour une révision en rédaction ou en revue.
- **Choix prudents** ([decisions.md](decisions.md)) : fiche réservée aux révisions approuvées ; donnée à tout lecteur
  de la révision, mais commentaires et titulaires des étapes jamais décidées réservés à qui suit le circuit (élargir
  leur diffusion est une question à poser) ; action de journal propre, rattachée à la révision ; aucune date
  d'approbation pour une révision importée déjà approuvée (champ `legacyApproval`, point 99, O-11) ; pas de suffixe
  d'état dans le nom ; pas de signature ni d'empreinte (M04).
- **Relecture** : deux défauts corrigés avant le commit. Un brouillon importé puis approuvé dans Codex était dit
  « approuvé dans l'ancien système », sans sa vraie date d'approbation. Le texte des commentaires de circuit allait à
  tout lecteur de la révision, alors que l'application le réserve au circuit. Un test couvre aussi une révision qui
  porte deux ECO, l'un greffé (D-26).
- **Vérifié** : `npm test` (654 tests, dont `tests/unit/pdf.test.ts`, `tests/unit/approval.test.ts` et
  `tests/integration/approval.test.ts` ; le PDF y est relu par `tests/support/pdf.ts`, qui suit la table xref,
  l'arbre des pages et les flux), `npm run typecheck`, `npm run lint`. Les tests échouent si l'on retire le contrôle de
  visibilité de la révision, celui de l'approbation, celui de lecture du document, la ligne de journal ou son
  rattachement à la révision, ou la mention de l'import, si l'on donne les commentaires à tout lecteur, si l'on dit
  approuvé dans l'ancien système un brouillon importé puis approuvé dans Codex, ou si l'on ne garde que l'ECO qui a
  ouvert la révision (essayé). Dans le navigateur, sur une base de démo neuve :
  James Holt (auditeur, hors du cercle) voit cinq boutons « Fiche de visa » sur `PRO-QUA-0001` (E en vigueur, A à D
  remplacées) et télécharge `PRO-QUA-0001_E_VISA.pdf` ; `pdftotext` y lit le circuit W-308 (demande de Gabriel Comte
  le 28/01/2026 09:12, approbations d'Hélène Sauvage et d'Hélène Costa avec leur heure), la mention d'extrait du journal
  et l'absence de signature ; `pdfinfo` donne le titre ; l'Historique montre « Fiche de visa éditée · E ». La révision D
  dit « Aucun circuit de validation n'est enregistré ». Sur `BOM-HLT-026-002`, Claire Bardet voit le brouillon B sans
  bouton et reçoit 404 pour sa fiche ; Julien Wagner (hors du cercle) ne voit pas B, reçoit 404 pour sa fiche et 200
  pour celle de A. La révision D en revue de `BOM-HLT-026-001` donne 404 à James Holt. Vue en anglais vérifiée
  (« Approval record », « Approved on »). Un PDF de deux pages (motif de près de 2 000 caractères) est lu par
  `pdftotext` sans perte, accents et pieds de page compris. Après relecture, sur `BOM-HLT-026-001` : Antoine Girard
  approuve la dernière étape du circuit W-301 depuis Validations, la révision D entre en vigueur ; Julien Wagner
  (demandeur) et Claire Bardet (gestionnaire) lisent dans `BOM-HLT-026-001_D_VISA.pdf` le commentaire « Révision prête
  pour vérification… », James Holt (auditeur, hors du circuit) y lit « 1 commentaire, lisible dans le circuit par ses
  participants et les gestionnaires documentaires », et chacun l'approbation d'Antoine Girard avec son heure.

### 15.5 Modifications simultanées détectées

Point 20 de [reste-a-faire.md](reste-a-faire.md) (D-12) : `updateMeta` réécrivait tous les champs du formulaire sans
vérifier que la fiche n'avait pas changé depuis son ouverture, et `addWorkingVersion` empilait une version de travail
sans savoir de quelle version le déposant était parti. Le constat était toujours vrai au commit `555761c`.

- **Version de la fiche** : colonne `documents.version` (entier, 1 à la création ; migration unique régénérée). Un
  déclencheur `documents_version`, posé à chaque démarrage comme ceux du journal (`src/db/index.ts`), la relève d'un
  cran à chaque `UPDATE` qui change réellement la ligne, quel que soit le chemin (métadonnées, revue, cycle de vie,
  Vigie, gel, archivage). Une écriture qui ne change rien (un `refreshHeadline` sans effet, le second dépôt du jour)
  est ignorée par la base, comme le fait `suppress_redundant_updates_trigger` de Postgres : la ligne garde sa version
  et la transaction de sa dernière modification (`xmin`). `setReaders` la relève à la main : les lecteurs désignés
  sont rangés à part.
- **Métadonnées et lecteurs désignés** : le dialogue de métadonnées renvoie la version en champ caché, celui des
  lecteurs en argument de `setReaders`. Les deux actions la comparent après les contrôles d'accès et de verrou, puis
  de nouveau dans leur transaction (`select … for update`), et refusent sans rien écrire : « Ce document a été modifié
  entre-temps par … ; rechargez la fiche » (`stale`, ou `stale_anon` sans nom). Un formulaire sans version est refusé
  de même ; un formulaire sur l'ancien ID d'un document reclassé entre-temps aussi, plutôt que « Document
  introuvable », pour qui pouvait encore agir (sinon `not_found`, comme avant).
- **Versions de travail** : le dialogue de dépôt renvoie la révision et le numéro de la dernière version qu'il a
  montrée (`baseRevision`, `baseVersion`). `addWorkingVersion` refuse, avant d'envoyer le fichier au stockage puis
  dans sa transaction (le fichier déjà stocké est alors retiré), un dépôt qui ne part pas de la dernière version :
  « La version de travail A.3 a été déposée entre-temps par … ; rechargez la fiche pour partir de cette version »
  (`working_stale`). Les deux versions restent conservées une fois la seconde déposée en connaissance de cause (D-12).
- **Demande de validation** : le dialogue renvoie aussi la dernière version de travail montrée ; `requestValidation`
  la contrôle dans sa transaction et refuse : « … rechargez la fiche pour la voir avant de demander la validation »
  (`validate_stale`). Un circuit ne part plus, et un type sans circuit n'entre plus en vigueur, sur une version que le
  demandeur n'a pas vue.
- **Qui est nommé** : l'auteur de la dernière modification de la fiche (`lastChangedBy`, `src/lib/actions.ts`) :
  les entrées du journal écrites dans la transaction qui a modifié la ligne en dernier (même `xmin`), de préférence
  sur ce document et d'une personne plutôt que de Codex ou Vigie (`changeAuthor`, `src/lib/concurrency.ts`).
  Personne n'est nommé quand cette transaction n'a rien journalisé. Ces refus ne vont qu'au cercle de rédaction, qui
  lit tout le journal (D-14).
- **Hors du cercle de rédaction** : `docView` donne la version 0, et la fiche ne la met dans le dialogue de
  métadonnées que pour qui peut le valider (propriétaire, gestionnaire) : elle bouge aussi avec le travail sur le
  brouillon (dépôt, révision ouverte), que les autres lecteurs ne voient pas (D-14).
- **Dialogue** : l'erreur reste affichée avec la saisie et un bouton « Recharger la fiche », qui ferme le dialogue et
  recharge la page (`useSubmit`, `reload`, `src/components/dialogs/Modal.tsx`).
- **Non fait** : la réservation d'un brouillon (Réserver / Libérer), qui change la façon de travailler ; elle est
  proposée à l'utilisateur dans [decisions.md](decisions.md) (« Modifications simultanées »). Le point 20 reste « fait
  en partie ».
- **Choix prudents** ([decisions.md](decisions.md)) : détection optimiste seulement, refus sans fusion ni reprise
  automatique ; toute modification de la fiche périme un dialogue de métadonnées ouvert avant, même sur d'autres
  champs ; refus d'un dépôt ou d'une demande de validation même quand la version plus récente vient de la même
  personne ; formulaire sans version refusé ; aucun nom quand la modification n'est pas journalisée.
- **Relecture** : quatre constats appliqués. La version partait vers tout lecteur de la fiche dans le dialogue de
  métadonnées et bougeait avec le travail sur le brouillon (D-14) : elle vaut désormais 0 hors du cercle. Le refus
  nommait l'auteur de la dernière entrée du journal non exclue, même sans effet sur la fiche (demande de modification,
  second dépôt du jour, étape intermédiaire) : il nomme désormais l'auteur de la transaction qui a modifié la ligne.
  `requestValidation` lançait le circuit sur une version déposée depuis l'ouverture du dialogue : il la contrôle. La
  garde D-14 de l'ancien ID n'était testée que pour `updateMeta` : `addWorkingVersion` et `setReaders` le sont aussi.
- **Vérifié** : `npm test` (691 tests, dont `tests/unit/concurrency.test.ts` et
  `tests/integration/concurrent-edits.test.ts`, deux sessions simulées par `actAs` qui partent de la même vue),
  `npm run typecheck`, `npm run lint`. Les tests qui appellent `updateMeta`, `addWorkingVersion` ou
  `requestValidation` envoient désormais la vue courante (`viewOf`, `baseOf`, `tests/support/db.ts`).
  Les tests échouent si l'on retire le déclencheur ou le saut des mises à jour sans effet, la comparaison de
  `updateMeta` ou de `setReaders` (avant ou dans la transaction, la seconde atteinte en glissant une modification à
  l'ouverture de la transaction), la relève de version de `setReaders`, le contrôle de la version de base d'un dépôt
  (avant ou dans la transaction) ou d'une demande de validation, le retrait du fichier refusé, la recherche de
  l'auteur par transaction, la préférence pour une personne plutôt que Codex, le masquage de la version hors du
  cercle, ou la garde de l'ancien ID de `addWorkingVersion` et `setReaders` (essayé).
  Dans le navigateur, sur une base de démo neuve, deux contextes sur la même fiche : sur `PRO-QUA-0002`, Gabriel
  Comte enregistre un nouveau titre, Joachim Wagner demande ensuite une modification, puis Claire Bardet, dont le
  dialogue était ouvert, reçoit « Ce document a été modifié entre-temps par Gabriel Comte ; rechargez la fiche. » avec
  « Recharger la fiche » ; son enregistrement passe ensuite. Sur `HSE-HLT-026-001` (révision C en brouillon), Lucas
  Fabre dépose C.2, puis Claire Bardet reçoit « La version de travail C.2 a été déposée entre-temps par Lucas Fabre ;
  rechargez la fiche pour partir de cette version. » ; son dialogue « Demander la validation » ouvert sur C.2 reçoit,
  après le dépôt de C.3, « … rechargez la fiche pour la voir avant de demander la validation. », et rechargé, lance
  W-311 sur C.3. Joachim Wagner, hors du cercle, reçoit la version 0 avant comme après, et la même fiche ; Claire
  Bardet, la version réelle. Avant la relecture, sur `CTR-JUR-0001`, deux onglets « Lecteurs désignés » : le second
  reçoit le refus.

### 15.6 Recherche, explorateur et journal filtrés et paginés en base

Point 50 de [reste-a-faire.md](reste-a-faire.md) (G15, M18, FON-04, ARC-01) : la recherche, son export CSV et
l'explorateur chargeaient tous les documents, appliquaient `canRead` puis leurs filtres en JavaScript (`listDocs`,
`runSearch`), et l'onglet Journal s'arrêtait à 500 lignes, sans filtre. Le constat était toujours vrai au commit
`eef9ada`. Un premier essai, coupé par la limite d'usage, avait laissé un brouillon dans un stash git : sa condition
SQL de visibilité et son test ont été repris tels quels, ses colonnes de recherche sur `documents` remplacées par une
table, et le stash supprimé.

- **Visibilité en SQL** (`src/lib/access.ts`) : `draftingCircleSql` (cercle de rédaction) et `readableSql`
  (`canRead` : droit de lecture du rôle, révision en vigueur, niveau de confidentialité, département, équipe projet,
  lecteurs désignés), en sous-requêtes non corrélées. `canRead` et `inDraftingCircle` restent la référence :
  `tests/integration/access-sql.test.ts` (documents tirés au hasard, trois tirages) et `seed-sql.test.ts` (base de
  démo complète) vérifient, pour chaque personne sous chacun des quatre rôles, que les deux choisissent les mêmes
  documents.
- **Termes de recherche** (`src/db/schema.ts`, `src/db/index.ts`) : table `document_terms` (document, groupe de
  pertinence, valeur repliée), écrite par le déclencheur `documents_terms` à la création d'un document et à chaque
  changement d'un champ cherché (ID et anciens ID, titre, mots-clés, référence externe, ID d'étude, sous-type,
  organisme source, auteur en texte libre), avec un index trigrammes (`pg_trgm`, fourni avec PGlite) pour « contient ».
  Le repli `codex_fold` (décomposition, accents retirés, minuscules selon les tables Unicode de la base,
  `pg_unicode_fast`) est identique à celui de JavaScript sur chaque point de code que les versions d'Unicode de Node et
  de PGlite attribuent toutes deux, et sur le sigma final ; le repli par défaut de la base en différait sur 97. La base
  replie aussi la requête : sous Node 26 (Unicode 17.0, PGlite restant en 16.0), une requête repliée par Node ne
  retrouvait pas un titre contenant une majuscule ajoutée par Unicode 17.0 (U+A7D2, par exemple). Le début de mot (niveau 2 de la pertinence) s'appuie sur
  une classe de caractères tirée de JavaScript : `[[:alnum:]]` de la base diffère de `[\p{L}\p{N}]` sur plus de
  83 000 points de code. Le tri par titre et par ID passe par une collation ICU (`codex_fr` : numérique, accents et
  casse ignorés, non déterministe pour que les égalités gardent l'ordre suivant), identique à `Intl.Collator` sur
  27 000 chaînes ; l'ICU de PGlite ignore ces options sous leur forme BCP 47 (`fr-u-kn-ks-level1`). Index du journal
  par date et par document. Migration unique régénérée.
- **Recherche** (`searchDocs`, `src/lib/queries.ts`) : une seule requête calcule les documents visibles, le texte
  (pertinence par groupe ; libellé du type dans la langue du lecteur et noms des personnes notés à part, comme le
  faisait `score`), la période, les comptes de toutes les facettes (`GROUPING SETS`, puis mots-clés et échéances), le
  total, le tri et la page ; seules les 50 lignes affichées sont lues entières. Les valeurs d'une facette viennent dans
  l'ordre où la recherche en mémoire les rencontrait. `/recherche?page=2` et boutons de page sous les résultats
  (`src/components/ui/Pager.tsx`) ; changer de critère, de tri ou de texte revient à la première page ; une page
  au-delà de la dernière montre la dernière. L'export CSV passe par la même requête, toutes pages, sans comptes.
- **Explorateur** (`explorerDocs`) : une requête donne le nombre de documents, les nœuds de l'axe, les types du nœud
  ouvert, les documents expirés ou en retard de revue, les documents filtrés (50 par page, `?page=`) et le document
  sélectionné, même s'il est sur une autre page ; la sélection et la fermeture de l'aperçu gardent la page.
- **Journal** (onglet Journal d'Administration, `auditPage`) : filtres par morceau d'ID de document ou de cible (casse
  ignorée), personne, action et période (jours, heure de Paris), en formulaire GET (`next/form`) ; 100 entrées par
  page, avec un curseur sur l'heure et l'ID (« Plus récentes », « Plus anciennes », « Les plus récentes »). Le journal
  est lu par lots jusqu'à remplir la page de ce que `auditForReader` laisse lire : une entrée masquée ne prend pas de
  place. L'export CSV reste complet, en flux.
- **Choix prudents** ([decisions.md](decisions.md)) : mêmes résultats que la version en mémoire jusque dans les cas
  limites (marque d'ordre d'octet en tête d'un texte libre, que le pilote PGlite retire à la lecture : `codex_unbom` ;
  caractère NUL dans un critère : aucun résultat plutôt qu'une erreur) ; tailles de page provisoires, le volume réel
  étant inconnu (O-11) ; un ID actuel ne retrouve dans le journal les entrées écrites sous les anciens ID que pour un
  document que le lecteur peut lire (D-14) ; export du journal complet et sans filtre.
- **Mesure** (script hors dépôt : base de démo plus 3 000 ou 6 000 documents générés, quatre entrées de journal
  chacun ; médianes de 5 appels, conteneur cloud à 4 cœurs ; « avant » sur le commit `eef9ada`). Lectures seules :

  | Lecture | 3 000 avant | 3 000 après | 6 000 avant | 6 000 après |
  |---|---|---|---|---|
  | `/recherche`, gestionnaire | 187 ms | 59 ms | 376 ms | 112 ms |
  | `/recherche?q=levage` | 206 ms | 39 ms | 386 ms | 97 ms |
  | `/recherche?q=a&sort=title` | 201 ms | 156 ms | 423 ms | 206 ms |
  | `/recherche?type=PRO&keywords=ATEX&sort=id` | 194 ms | 43 ms | 373 ms | 70 ms |
  | `/recherche?date=modified&from=2026-01-01&sort=due` | 189 ms | 44 ms | 381 ms | 76 ms |
  | `/recherche`, collaborateur | 228 ms | 49 ms | 377 ms | 93 ms |
  | `/explorateur`, gestionnaire | 172 ms | 28 ms | 353 ms | 44 ms |
  | `/explorateur`, collaborateur | 180 ms | 25 ms | 391 ms | 42 ms |
  | Onglet Journal (500 lignes avant, 100 après) | 11 ms | 8 ms | 13 ms | 9 ms |
  | Export CSV de la recherche `q=levage` | 206 ms | 117 ms | 386 ms | 173 ms |
  | Export CSV de toute la base, gestionnaire | 187 ms | 222 ms | 376 ms | 479 ms |

  L'export de toute la base est un peu plus lent : il lit ces milliers de documents entiers après la requête.
  Chargement complet d'une page dans le serveur de développement, à 3 000 documents : `/recherche` passe de 11,8 s à
  0,95 s (gestionnaire) et de 8,3 s à 1,0 s (collaborateur), `/recherche?q=a&sort=title` de 12,8 s à 1,1 s,
  `/explorateur` de 17,5 s à 1,0 s, l'onglet Journal de 1,9 s à 0,85 s : l'essentiel venait du rendu de milliers de
  lignes. Il reste environ 0,7 s commun à toutes les pages : l'en-tête (ci-dessous).
- **Relecture** (neuf retours, tous vérifiés puis appliqués) :
  - la base replie la requête (`codex_fold`) comme les valeurs qu'elle garde. Le test du repli ne compare plus que
    les points de code que les deux versions d'Unicode attribuent : il échouait sous Node 26 (session locale), qui
    embarque Unicode 17.0. La suite passe sous Node 22 et sous Node 26.11.1 ;
  - le champ de recherche de l'en-tête ramène lui aussi à la page 1 (il gardait `page`) : les deux champs et le tri
    construisent l'URL par la même fonction (`searchUrlWith`, `src/lib/search.ts`) ;
  - l'explorateur et l'onglet Journal ne gardent qu'une valeur par paramètre (`oneEach`) : un paramètre répété
    provoquait une erreur 500. Un curseur du journal hors de la plage d'un `serial` est ignoré ; la base convertit les
    jours de la période en heure de Paris (les années 0001 et 9999 provoquaient une erreur) ;
  - nouveaux tests : export CSV de plus d'une page appelé par sa route, `pageOf`, `searchHref` et `searchUrlWith`,
    lecture du journal par lots au-delà de 1 000 entrées masquées, bornes des jours et curseurs ; chacun échoue si
    l'on retire la règle qu'il vérifie ;
  - `docs/audit-deck-epc2i.md` : statut de G15 et de la ligne « Slide 7 · 2 » mis à jour.
- **Reste** (point 50 « fait en partie ») : l'en-tête commun (`src/app/layout.tsx`) charge encore, à chaque chargement
  complet d'une page, tous les documents visibles (`listDocs`, pour l'activité récente, les modèles et « À traiter »)
  et tous les circuits avec leurs documents (`listWorkflows`) : 0,19 s à 3 000 documents, 0,4 s à 6 000. Une navigation
  dans la page (facette, tri, page suivante) ne le recalcule pas. L'Accueil, Archivage, les pages de département et la
  fiche (documents du projet) lisent aussi `listDocs` ; Validations n'est pas paginé ; le contenu des fichiers n'est
  pas indexé (G15) ; le passage à Postgres serveur est le point 51.
- **Vérifié** : `npm test` (714 tests, sous Node 22 et sous Node 26.11.1, dont `tests/integration/access-sql.test.ts`, `search-sql.test.ts`,
  `seed-sql.test.ts` et `audit-page.test.ts` ; les tests existants de la recherche, des pages de département, des
  recherches enregistrées et de la revue passent désormais par `searchDocs`, comparé à chaque appel à la version en
  mémoire), `npm run typecheck`, `npm run lint`. Les tests échouent si l'on retire de la condition SQL l'équipe projet,
  les modificateurs, la fin d'un circuit, le statut « acceptée » d'une modification ou la révision en vigueur ; de la
  recherche le score des valeurs extérieures, `codex_unbom` (facettes ou termes), l'ordre des égalités ou de la
  pertinence, les comptes des facettes, le filtre des autres facettes dans ces comptes, l'ordre de leurs valeurs, le
  fuseau de Paris, les actions qui datent une fiche, la borne de l'expiration, la collation, la classe des débuts de
  mot, le choix de l'auteur, l'ordre des mots-clés répétés, l'axe projet par le rattachement, la révision en vigueur
  des retards de revue, l'ID d'étude des termes ou le repli Unicode de la base ; du journal le départage des entrées
  de même heure ou la lisibilité exigée pour suivre les anciens ID (essayé sur le code final ; seule survit une
  mutation sans effet, `>` pour `>=` entre deux dates égales).
  Dans le navigateur, sur une base de démo neuve : les 148 états capturés avant la modification (Claire Bardet,
  gestionnaire ; Julien Wagner, collaborateur ; Lucas Fabre, validateur ; James Holt, auditeur, en anglais ; 31
  recherches et 6 vues de l'explorateur chacun, pages suivies et mises bout à bout) sont identiques après : résultats
  et leur ordre, nombre de résultats, facettes, comptes et cases cochées, arbre de l'explorateur, compteurs
  d'échéance. Les 12 exports CSV comparés sont identiques à l'octet près, les 100 premières lignes du journal aussi.
  Pages 1 et 2 de `/recherche` et de `/explorateur` pour Claire Bardet (63 documents) ; retour en page 1 quand le
  tri, une facette, le texte (champ de l'écran ou de l'en-tête) ou le statut change ; `?page=99` montre la page 2 ; sélection et fermeture de l'aperçu
  sur la page 2 ; journal : pages précédente et suivante, filtre « PRO-QUA-0001 » et Julien Wagner (une entrée),
  « Effacer », période du 6 au 7 octobre ; Julien Wagner n'a ni pagination (40 résultats) ni journal. Après la
  relecture, sur une base de démo neuve : les 148 états, les 12 exports (appelés avec `page=2` dans l'URL) et les
  entrées du journal sont toujours identiques à la capture d'avant ; depuis `/recherche?page=2`, une lettre tapée dans
  l'en-tête, ou Entrée, ramène à la page 1 ; l'explorateur avec `node` ou `sel` répétés, et le journal avec les
  jours 0001-01-01 et 9999-12-31, un curseur 9999999999 ou `doc` répété répondent 200. Le motif de recherche que la
  base replie reste servi par l'index trigrammes, et les temps à 3 000 documents ne changent pas.

## 16. Lot 7 (15 oct.)

Suite des points « développables maintenant » de [reste-a-faire.md](reste-a-faire.md), une étape par point ou groupe de
points, chacune relue avant son commit. Mêmes règles que le lot 6 : aucune question ouverte n'est tranchée, un choix qui
en dépend prend l'option la plus prudente et est consigné dans [decisions.md](decisions.md).

| Étape | Commit | Points | Ce qui change | Choix prudents |
|---|---|---|---|---|
| 1. En-têtes et débit (§16.1) | commit « Lot 7, étape 1 », qui suit `c7e7ce1` | 24, 25 | En-têtes de sécurité sur toutes les réponses, politique de sécurité du contenu des pages avec nonce, limites de débit des routes sensibles et des actions qui écrivent (429 avec `Retry-After`) | HSTS coupé sauf `CODEX_HTTPS=1` ; `X-Forwarded-For` tenu pour fiable seulement avec `CODEX_TRUST_PROXY=1` ; seuils généreux ; compteurs en mémoire pour une seule instance |
| 2. Fichiers déposés (§16.2) | commit « Lot 7, étape 2 », qui suit `3c2dbe7` | 32, 64 | Formats admis (liste blanche, signatures et conteneurs, macros et programmes refusés), nom unique du contrôle au téléchargement, taille maximale unique, analyse antivirus par clamd avant stockage, refus journalisé | Liste commune à tous les types, archives exclues, Office chiffré admis ; 50 Mo pour l'écran et l'import ; analyse désactivée sans `CODEX_CLAMD`, dépôt refusé si clamd ne répond pas ou si le fichier dépasse ses limites ; nom du fichier refusé réservé aux gestionnaires (D-14) |
| 3. Fichiers en flux et orphelins (§16.3) | commit « Lot 7, étape 3 », qui suit `ab6711e` | 46, 36 | Route fichier en flux, plages d'octets (206, 416), ETag, Last-Modified et 304, HEAD cohérent ; simulation puis suppression journalisée des seuls fichiers orphelins listés, stockage local | Copie gardée par le navigateur seulement pour le fichier en vigueur sous Confidentiel, revalidée à chaque usage ; téléchargement journalisé à partir du premier octet ; nettoyage réservé aux gestionnaires, délai de grâce de 24 h, SharePoint listé sans suppression (O-01) ; aperçu paginé des brouillons et confidentiels encore retéléchargé à chaque page |
| 4. Sauvegarde et restauration (§16.4) | commit « Lot 7, étape 4 », qui suit `42e2d34` | 48 | Archive de la base et des fichiers référencés avec manifeste et empreintes, commandes `npm run backup`, `backup:list`, `backup:check`, `restore`, rotation, verrou du dossier de données, sauvegarde journalisée depuis Administration, procédure `docs/sauvegarde.md` | Rien de programmé ; archives à côté du dossier de données, non chiffrées, 7 plus récentes et une par jour sur 7 jours gardées ; une sauvegarde par quart d'heure au plus depuis l'application ; restauration en ligne de commande seulement, serveur arrêté, l'existant mis de côté et non supprimé ; action et nombres du journal réservés aux gestionnaires (D-14) ; fichiers SharePoint non copiés (O-01) |
| 5. Journal technique, santé, configuration (§16.5) | commit « Lot 7, étape 5 », qui suit `55c0df4` | 49, 37 | Journal technique structuré (JSON en production) avec identifiant de requête, une ligne par requête d'API et par action d'écriture, jetons refusés et erreurs serveur journalisés sans secret ; `GET`/`HEAD /api/health` ; contrôle de la configuration au démarrage (`src/instrumentation.ts`), procédure `docs/exploitation.md` | Refus de démarrer en production pour une configuration dangereuse seulement (défaut sans erreur, `CODEX_CONFIG_CHECK=warn` pour passer outre) ; jeton de 32 caractères au moins ; santé sans authentification, sans raison d'échec ; aucune métrique ni rotation (hébergement non décidé) ; authentification simulée rappelée en production (O-02) |
| 6. Administration du registre et des programmes (§16.6) | commit « Lot 7, étape 6 », qui suit `6823294` | 61, 58 | Création, modification et suppression des types (tous leurs réglages), familles, fonctions et programmes de recherche dans Administration, journalisées avant → après ; codes contrôlés ; `GET /api/registry` suit | Droit « Administrer » (A05 non tranché) ; aucun nouveau code ne reprend celui d'un autre segment d'identifiant ni `QMS` (point 1 du registre, FIN/HSE/COM gardés) ; entrée utilisée : code figé, pas de suppression, désactivation ; restriction des admissions d'un type confirmée, identifiants des documents aux seuls gestionnaires (D-14) ; contenu du registre inchangé (O-05) ; programme sans date de fin (point 3 du registre) |
| 7. Administration de l'organisation (§16.7) | commit « Lot 7, étape 7 », qui suit `8171aa2` | 62 | Renommage (libellés FR/EN), désactivation, réactivation et suppression des départements et des sites dans Administration › Organisation, journalisés avant → après ; une valeur inactive n'est plus proposée et reste là où elle figure ; pages par département marquées | Droit « Administrer » (A05) ; code d'un département jamais modifié, même inutilisé ; « utilisé » compte aussi les recherches partagées et les identifiants déjà attribués sous le code ; un département actif au moins ; département inactif de l'utilisateur refusé plutôt que remplacé ; un département inactif prend encore des titulaires ; import accepté (D-21) ; pas de fusion (O-09) ; valeurs provisoires (O-04) |
| 8. Export complet (§16.8) | commit « Lot 7, étape 8 », qui suit `6063aed` | 17 | Archive ZIP écrite en flux de toutes les tables (JSON, journal compris), des documents en CSV, de tous les fichiers sous `files/{ID}/{ID}_{lettre}.{n}.{ext}` et de chaque document au format de `POST /api/import`, avec manifeste et SHA-256 ; téléchargement depuis Administration, commandes `npm run export` et `export:check` ; format dans `docs/export.md` | Réservé aux gestionnaires documentaires ayant l'accès Administration ; pas de filtre D-14 mais journalisé au début et à la fin (taille et SHA-256), nombres montrés aux seuls gestionnaires ; ni chiffrement ni export programmé (hébergement, M22) ; fichiers SharePoint non configuré listés comme non inclus (O-01) ; une révision par document à la réimportation (O-11) |

### 16.1 En-têtes de sécurité HTTP et limitation de débit

Points 25 et 24 de [reste-a-faire.md](reste-a-faire.md), vérifiés au commit `c7e7ce1` : `next.config.ts` ne posait aucun
en-tête de sécurité (seule la route fichier posait `nosniff`), il n'y avait ni `src/proxy.ts` ni limite de débit, et
`checkBearer` ne freinait pas les essais de jetons.

- **En-têtes** (`src/lib/security-headers.ts`) : `next.config.ts` pose sur toutes les réponses `nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: SAMEORIGIN` et une `Permissions-Policy`
  restrictive, et retire `X-Powered-By`. `src/proxy.ts` (convention de Next 16, qui remplace `middleware.ts`) pose sur
  les pages la politique de sécurité du contenu, avec un nonce tiré à chaque requête et recopié dans la requête : Next.js
  l'y lit et l'ajoute à ses scripts. Seuls ces scripts et ce qu'ils chargent s'exécutent (`'strict-dynamic'`, aucun
  script en ligne admis) ; styles en ligne admis (le code et React en posent) ; police Inter auto-hébergée ; images
  `data:` et `blob:` ; aperçu en cadre de même origine ; `frame-ancestors 'self'`. Toutes les routes sont rendues à la
  demande (la build les marque toutes ƒ), donc chaque page reçoit son nonce. L'API n'a pas de politique (rien n'y
  s'exécute ; une politique sur un PDF peut bloquer la visionneuse du navigateur). HSTS et `upgrade-insecure-requests`
  seulement avec `CODEX_HTTPS=1`. L'app Mac charge Codex en page principale de sa vue web : aucune règle de cadre ne la
  concerne, et ses pages d'attente (`loadHTMLString`) ne passent pas par le serveur.
- **Limites de débit** (`src/lib/ratelimit.ts`) : seau à jetons par famille et par clé, gardé sur `globalThis` (routes,
  actions et rechargements à chaud partagent les compteurs), une table par famille d'au plus 10 000 clés. Par adresse :
  import et webhook Vigie (comptés une fois le jeton vérifié), jetons refusés (`checkBearer`), registre (derrière un
  proxy de confiance seulement). Par utilisateur résolu (`getCtx`), et par adresse derrière un proxy de confiance :
  fichiers, fiches de visa, exports CSV (GET et HEAD). Par utilisateur résolu : les 27 Server Actions qui écrivent
  (`throttled`, src/lib/actions.ts ; pas le changement de langue ni d'utilisateur simulé). Réponse 429 avec
  `Retry-After` : JSON pour l'API d'intégration, phrase dans la langue du lecteur pour les routes du navigateur, toast
  d'erreur pour une action. Seuils par `CODEX_RATE_*`, tout levé par `CODEX_RATE_LIMIT=off`.
- **Au passage** (même fiche) : le corps de `POST /api/import` est coupé en cours de lecture au-delà de la taille
  admise plus 1 Mo, avec 413, y compris sans `Content-Length` (envoi par morceaux), en JSON comme en multipart.
- **Relecture** (sept constats, tous retenus) :
  - `src/proxy.ts` voyait aussi les appels de Server Actions. Or Next.js recopie en mémoire le corps de chaque requête
    que voit un proxy, et le coupe sans erreur à 10 Mo (`experimental.proxyClientMaxBodySize`) : un dépôt de 15 Mo
    échouait (« Unexpected end of form », POST 500). Le proxy ignore désormais les requêtes qui portent `Next-Action`,
    et `next.config.ts` règle la copie sur la limite des Server Actions (50 Mo, une constante) pour un formulaire envoyé
    avant l'hydratation ;
  - un tiers sans jeton pouvait bloquer Vigie ou l'outil de migration en envoyant des jetons faux, ou en épuisant leur
    budget, sous leur adresse forgée dans `X-Forwarded-For`. Nouvelle variable `CODEX_TRUST_PROXY`, coupée par défaut :
    sans elle, le bon jeton passe toujours (seuls les jetons faux reçoivent 429), et les budgets d'import et de Vigie
    ne sont comptés qu'après le jeton ; avec elle, le blocage d'une adresse avant comparaison du jeton reste en place ;
  - toutes les familles partageaient une table de 10 000 clés vidée par ancienneté, et les clés des fichiers et exports
    contenaient la valeur brute du cookie : en inventant des cookies, un client faisait oublier ses jetons refusés et
    ouvrait un budget neuf à chaque valeur. Désormais une table par famille ; seul un seau redevenu plein est oublié,
    et tant qu'aucun ne l'est une clé nouvelle attend ; fichiers et exports comptent par utilisateur résolu (un cookie
    inconnu est l'utilisateur par défaut), plus un seau par adresse derrière un proxy de confiance ;
  - le registre, sans jeton, n'est plus limité qu'avec `CODEX_TRUST_PROXY=1`, pour la même raison ;
  - tests ajoutés : les 27 actions refusent au-delà du budget, et la liste échoue si une action exportée y manque ;
    corps multipart envoyé par morceaux (413, lecture arrêtée tôt, rien d'importé) ; `HEAD /api/export/search` ;
    adresse forgée qui ne bloque pas le bon jeton ; cookies inventés qui partagent un budget ; proxy et Server Actions ;
    tables par famille et oubli des seaux pleins seulement. Retirer `throttled` d'une action, remettre
    `req.formData()`, retirer la limite de `HEAD /api/export/search` ou l'exclusion de `Next-Action`, ou compter avant
    le jeton font échouer au moins un test.
- **Vérifié** : `npm test` (44 fichiers, 763 tests), `npm run typecheck`, `npm run lint`, `npm run build`. Dans
  Chromium, sur le serveur de développement puis sur la build de production (`next start`) :
  - 193 pages, onglets et dialogues pour Claire Bardet, Gabriel Comte, Julien Wagner et James Holt, navigation par la
    barre latérale, dépôts de versions de travail, aperçu d'un PDF, d'une image et d'un texte importés : aucune
    violation de la politique ni erreur de console (hors `favicon.ico`, absent avant) ;
  - dépôts de 15 et 45 Mo par « Nouvelle version de travail » sur CTR-JUR-0001 et d'un document de 45 Mo par « Déposer
    un fichier » : acceptés, sans politique sur la réponse des Server Actions ; un formulaire de 15 Mo posté sans
    `Next-Action` n'est plus tronqué par le proxy ;
  - 25 jetons faux sous `X-Forwarded-For: 127.0.0.1` (20 × 401 puis 429), puis le bon jeton depuis la même machine :
    décision lue (404 `not_found` pour une demande inconnue) ;
  - 40 exports avec des cookies `z0` à `z39` depuis une même adresse : 30 servis, puis 429 ; 2 000 `HEAD` d'export avec
    des cookies tournants ne font pas oublier les jetons refusés ;
  - avec `CODEX_TRUST_PROXY=1` : 20 jetons faux puis 429 même avec le bon jeton depuis cette adresse (`Retry-After: 45`),
    une autre adresse servie ; registre limité par adresse.
- **Reste** : vérifier l'app Mac (WebKit) en session macOS ; journalisation des refus (point 23) ; plusieurs instances
  demanderaient un magasin partagé ou une limite au proxy.

### 16.2 Fichiers déposés : formats admis et analyse antivirus

Points 32 et 64 de [reste-a-faire.md](reste-a-faire.md), vérifiés au commit `3c2dbe7` : `stageFile`
(src/lib/storage.ts) stockait tout fichier, exécutables et archives compris, sans analyse ; le sélecteur de fichier
n'avait pas d'`accept` ; l'écran plafonnait à 50 Mo (limite des Server Actions, erreur générique au-delà) et l'import à
100 Mo (`CODEX_IMPORT_MAX_MB`).

- **Un seul point de passage** : nouveau document, copie d'un modèle, version de travail et import passent par
  `stageFile`, qui contrôle le fichier, l'analyse, puis seulement l'écrit dans le stockage. Un refus lève
  `FileRejectedError` : les actions le rendent dans la langue de l'utilisateur, l'import en 413, 415, 422 ou 503.
- **Formats** (`src/lib/filetypes.ts`, sans `server-only` : le sélecteur s'en sert) : liste blanche d'extensions
  (`CODEX_FILE_EXTENSIONS`, 39 par défaut, archives exclues) ; refus permanent des exécutables, scripts, pages web, SVG,
  images disque et extensions Office à macros ; signature vérifiée quand elle est fiable (PDF dans le premier kilo-octet,
  PNG, JPEG, GIF, WebP, TIFF, ZIP, OLE2, RTF, DWG, MP4 et HEIC) ; programme Windows, Linux ou macOS refusé quel que soit
  son nom (« MZ » seul ne suffit pas, il faut l'en-tête PE) ; fichier sans extension admis seulement si son contenu
  désigne un format admis sans ambiguïté.
- **Taille** : `CODEX_MAX_FILE_MB` (50 Mo par défaut, 250 avec SharePoint) pour toutes les voies ; `next.config.ts` en
  tire au démarrage la limite des Server Actions et de la copie du proxy (plus 1 Mo), pour qu'un fichier trop gros
  reçoive le refus explicite de `stageUpload`.
- **Sélecteur** (`FilePicker`, src/components/dialogs/Modal.tsx) : `accept` avec les extensions admises, « 50 Mo au
  plus » tant qu'aucun fichier n'est choisi, refus immédiat (extension, taille) sous le champ, et
  `setCustomValidity` pour que le formulaire ne parte pas. Les règles viennent du serveur par les données du layout.
- **Antivirus** (`src/lib/antivirus.ts`) : interface `Scanner`, connecteur clamd par `INSTREAM` (TCP ou socket Unix,
  morceaux de 64 Ko, délai `CODEX_CLAMD_TIMEOUT_MS`), réponse lue même si clamd répond avant la fin de l'envoi (limite
  `StreamMaxLength`). Infecté : refus, rien d'écrit, entrée `file_rejected` sans document (cible « Fichier déposé » et
  voie d'entrée ; nom, taille, menace ; document visé montré aux seuls gestionnaires documentaires, D-14 ; référence
  ancienne pour l'import), lisible dans l'onglet Journal d'audit. Échec de l'analyse : refus, sauf
  `CODEX_CLAMD_ON_ERROR=accept`. Sans `CODEX_CLAMD` : pas d'analyse, dit une fois dans le journal du serveur et en tête
  de l'onglet Journal d'audit, avec la taille maximale et le nombre de formats admis.
- **Tests** : `tests/unit/filetypes.test.ts` (liste, refus permanents, signatures, programmes, fichiers sans extension,
  taille, textes FR/EN, limite des Server Actions lue de l'environnement), `tests/unit/antivirus.test.ts` (faux clamd de
  `tests/support/clamd.ts` en TCP et en socket Unix, envoi en plusieurs morceaux, EICAR, réponse d'erreur, limite de
  taille, silence, clamd absent), `tests/integration/file-checks.test.ts` (chaque voie d'entrée, rien de créé ni de
  stocké après un refus, journal et D-14, import 413, 415, 422 et 503, `CODEX_CLAMD_ON_ERROR=accept`, pas d'analyse
  sans `CODEX_CLAMD`). La chaîne EICAR est assemblée à l'exécution : aucun fichier du dépôt ne la contient entière.
  Retirer l'analyse ou le contrôle de format de `stageFile` fait échouer cinq tests chacun. Un test existant changeait de
  sens : un PDF nommé `.docx` était stocké sous le type de son extension, il est désormais refusé (415 `signature`).
- **Vérifié** : `npm test` (47 fichiers, 803 tests), `npm run typecheck`, `npm run lint`, `npm run build`. Dans Chromium,
  sur le serveur de développement : sélecteur (« 50 Mo au plus », `accept`), `.exe` et fichier de 51 Mo refusés sans
  envoi, faux PDF refusé par le serveur, vrai PDF accepté ; fichier de 50,5 Mo envoyé en contournant le sélecteur :
  refus explicite du serveur ; avec un faux clamd (`CODEX_CLAMD=127.0.0.1:3310`) : EICAR refusé, entrée au journal
  d'audit (FR et EN), PDF propre accepté ; clamd arrêté : dépôt refusé. Sur la build de production lancée avec
  `CODEX_MAX_FILE_MB=2` : « 2 Mo au plus », 2,5 Mo refusé explicitement, 3,5 Mo coupé par la limite des Server Actions à
  3 Mo (lue au démarrage).
- **Corrections après relecture** :
  - *Extension contrôlée et extension servie* : `fileIssue` lisait l'extension du dernier segment du nom, alors que le
    stockage, le renommage et le téléchargement prenaient `path.extname` : `procedure.hta/` (gardé tel quel par l'import
    et par une Server Action postée en formulaire) passait comme un PDF et se téléchargeait en `.hta`. `stageFile`
    réduit désormais le nom à son dernier segment, sans caractères de contrôle ou bidirectionnels ni séparateurs, points
    ou espaces finaux (`cleanFileName`), et une seule fonction (`storedExt`, sur `extensionOf`) donne l'extension du
    fichier stocké, renommé et téléchargé ; un fichier sans extension prend celle de son contenu, jamais celle du type
    annoncé (un PDF annoncé `image/svg+xml` ne devient pas `.svg`).
  - *D-14* : le nom d'un fichier refusé à l'écran (`PRO-ING-0007_A.2.docx`) donnait l'identifiant, la version et le
    rédacteur d'un brouillon à tout titulaire du droit Administrer ; hors gestionnaires, le journal et son export ne
    montrent plus que l'extension (le nom reste pour l'import).
  - *Conteneurs* : un ZIP quelconque passait pour un `.docx`, un `.xls` pouvait porter des macros VBA. Les fichiers
    Office et OpenDocument sont lus par le répertoire central de leur ZIP (`[Content_Types].xml`, `mimetype` ou
    manifeste), les fichiers Office 97-2003 par le répertoire de leur fichier composé, lu par la table d'allocation
    (MS-CFB) ; les macros VBA (`vbaProject.bin`, `_VBA_PROJECT`) sont refusées quelle que soit l'extension. Limites
    documentées : macros PowerPoint 97-2003, Excel 4.0, Basic d'OpenDocument, contenu chiffré.
  - *Office chiffré et `.doc` RTF* : une extension admet plusieurs contenus ; un `.docx` chiffré par mot de passe ou
    étiquette de confidentialité (fichier composé `EncryptedPackage`) et un `.doc` en RTF étaient refusés, ils sont
    admis. Vérifié sur des fichiers produits par LibreOffice 24.2 (`.doc`, `.xls`, `.ppt`, `.docx`, `.xlsx`, `.pptx`,
    `.odt`, `.ods`, `.odp`, `.rtf`, ainsi que `.docx`, `.xlsx` et `.pptx` chiffrés et un `.doc` de 9 Mo dont le
    répertoire n'est atteint que par la chaîne DIFAT) : tous admis.
  - *Limites de clamd* : « INSTREAM size limit exceeded » était traité comme une panne passagère (« réessayez »,
    503 avec `Retry-After`). Il est classé à part (`ScanLimitError`), comme « Heuristics.Limits.Exceeded… » renvoyé
    avec `AlertExceedsMax` : refus qui en donne la cause, 413 `scan_too_large` sans `Retry-After` à l'import. La
    documentation corrige les valeurs par défaut de clamd (vérifiées dans `clamd.conf.sample` : `StreamMaxLength` et
    `MaxFileSize` 100 Mo depuis ClamAV 0.105, 25 Mo avant ; `MaxScanSize` 400 Mo, 100 Mo avant) et demande
    `MaxFileSize`, `MaxScanSize` et `AlertExceedsMax yes`, sans quoi clamd répond « OK » sans analyser un gros fichier.
  - *Modèles* : la copie d'un modèle dont le fichier n'est plus admis donne un message qui nomme le modèle et demande à
    son propriétaire d'en déposer une nouvelle version ; les fichiers déjà stockés ne sont ni recontrôlés ni réanalysés
    (README, `docs/decisions.md`).
  - *Vérifié* : `npm test` (47 fichiers, 819 tests), `npm run typecheck`, `npm run lint`, `npm run build`. Sur le
    serveur de développement, base du scratchpad et faux clamd : la Server Action postée en formulaire par jwagner
    avec `procedure.hta/` ne crée rien et ne stocke aucun `.hta`, celle avec `C:\fakepath\procedure.pdf` crée un
    document servi en `.pdf` ; l'import de `note.hta/` répond 415 ; dans Chromium, `.docx` à macros, ZIP renommé
    `.docx`, PDF de 2 Mo au-delà de la limite du faux clamd et EICAR nommé `PRO-ING-0001_A.1.txt` refusés avec leur
    message, `.docx` chiffré accepté ; journal lu par cbardet (nom et document) et par gcomte, validateur à qui le
    droit Administrer a été donné (`.txt`, sans `PRO-ING-0001`, à l'écran comme dans l'export CSV). Sur la build de
    production : mêmes refus de la Server Action en formulaire et du dialogue, en français et en anglais, sans
    erreur dans la console.
- **Reste** : une liste de formats par type dans le registre et le PDF/A (question M12) ; la réanalyse des fichiers
  déjà stockés ; l'essai sur un vrai clamd ; le dépôt d'un fichier refusé dans la fenêtre de l'app Mac (session
  macOS).

### 16.3 Fichiers servis en flux et nettoyage des fichiers orphelins

Points 46 et 36 de [reste-a-faire.md](reste-a-faire.md), vérifiés au commit `ab6711e` : la route fichier lisait tout le
fichier dans un `Buffer` (`readStored` : `readFile` en local, `arrayBuffer` pour SharePoint) puis le recopiait, sans
`Accept-Ranges` ni `Content-Range`, en `Cache-Control: private, no-store` : l'aperçu paginé, qui recrée son iframe à
chaque page, retéléchargeait tout le PDF. Aucun code ne comparait le stockage aux `working_versions.file_key`, alors
qu'un arrêt entre le dépôt et l'enregistrement, ou un renommage inachevé, laisse un fichier sans référence.

- **En flux** : `openStored` (src/lib/storage.ts) donne la taille et la date du fichier sans le lire ; le fichier
  local est ouvert avant la réponse (un renommage qui retire l'ancien nom ensuite ne coupe pas l'envoi) puis lu par
  morceaux ; pour SharePoint, le corps de `/content` est relayé avec l'en-tête Range, le délai ne couvrant que
  l'attente de la réponse (non essayé sur un vrai tenant). Le PDF de démonstration reste construit en mémoire.
- **Plages et validateurs** (`src/lib/ranges.ts`, appliqué une fois l'accès accordé) : 206 et `Content-Range`, 416 et
  `bytes */taille`, fichier entier pour plusieurs plages ou une autre unité, `If-Range` ; ETag (empreinte de la
  version, de sa taille, de sa date et du nom servi : identifiant, révision, état), Last-Modified du fichier local, 304
  sur `If-None-Match`, ou sur `If-Modified-Since` en son absence. HEAD donne les mêmes en-têtes que GET (304 compris,
  sans plage) et répond 404 pour un fichier manquant, comme GET.
- **Cache** : copie gardée par le navigateur (`private, no-cache, no-transform`) seulement pour le fichier final de la
  révision en vigueur sous Confidentiel (`browserMayKeep`, src/lib/access.ts) ; brouillons, confidentiels et
  téléchargements restent en `no-store`. `no-transform` empêche `next start` de compresser les réponses texte, ce qui
  fausserait les plages.
- **Journal des téléchargements** : inchangé pour un téléchargement entier ; une reprise (plage qui ne part pas du
  premier octet), un 416 ou un HEAD ne sont pas journalisés.
- **Fichiers orphelins** (`src/lib/orphans.ts`) : Administration › Journal d'audit, réservé aux gestionnaires
  documentaires ayant l'accès Administration (`mayCleanStorage`). « Rechercher » (`?tab=audit&orphans=1`) liste sans
  rien supprimer ; « Supprimer ces fichiers » (`purgeOrphanFiles`, confirmé) retire, parmi les fichiers que la liste a
  montrés et eux seuls, ceux qui sont encore orphelins : fichiers locaux nommés par Codex, sans référence, touchés
  depuis plus que le délai de grâce (`CODEX_ORPHAN_GRACE_HOURS`, 24 h ; date la plus récente de `mtime` et `ctime`),
  200 au plus par passage, chacun revérifié juste avant, un seul passage à la fois.
  Une entrée « Fichiers orphelins supprimés » (cible « Stockage des fichiers · local ») garde nom, taille et date de
  chaque fichier ; les noms ne sont montrés qu'aux gestionnaires (D-14). SharePoint (`_staging`) : liste seulement.
- **Tests** : `tests/unit/ranges.test.ts` (plages, validateurs, ordre des décisions, découpe d'un flux),
  `tests/unit/orphans.test.ts` (délai de grâce, noms de Codex, tri), `tests/integration/file-stream.test.ts` (fichier
  de 3 Mo lu en flux et interrompu, 206, 416, 200 pour plusieurs plages, `If-Range`, 304, accès contrôlé avant tout,
  brouillon et confidentiel jamais gardés, journal des téléchargements, suffixes, HEAD, fichier manquant),
  `tests/integration/orphans.test.ts` (simulation sans suppression, fichier récent, fichier ancien renommé à l'instant,
  SharePoint injoignable sans requête, suppression et journal, seuls les fichiers listés supprimés, fichier réécrit ou
  référencé entre l'analyse et la suppression conservé, 200 par passage, un passage à la fois, action réservée et
  liste reçue contrôlée, noms réservés aux gestionnaires). Journaliser une reprise, laisser le navigateur garder un brouillon, ou dater un
  fichier par son seul `mtime` fait échouer un test chacun.
- **Vérifié** : `npm test` (51 fichiers, 862 tests), `npm run typecheck`, `npm run lint`, `npm run build`. Sur le serveur
  de développement : fichier entier, plage, 416, 304 et HEAD identiques au fichier stocké ; brouillon `POL-HSE-0002`
  refusé (404) à jwagner et jholt, avec ou sans Range ou If-None-Match ; dans Chromium, le PDF de 2 pages importé en
  vigueur (`PRO-QUA-0006`) est revalidé (304 au journal du serveur) au changement de page ; téléchargement entier
  journalisé, reprise non. Panneau des orphelins en français et en anglais pour cbardet (un fichier récent compté et
  conservé), écran refusé à gcomte. Sur la build de production (`next start`, copie de la base, horloge du processus
  avancée de 25 h) : texte de 9,6 Ko servi sans compression, plage exacte ; suppression d'un orphelin depuis le
  panneau, confirmation, message, entrée au journal et ligne `[orphans] removed …` au journal du serveur ; gcomte, à
  qui le droit Administrer a été donné, lit l'entrée sans le nom du fichier, à l'écran comme dans l'export CSV, et n'a
  pas le panneau.
- **Relecture** (trois constats, tous retenus) :
  - la suppression refaisait l'analyse au moment du clic et supprimait les orphelins trouvés à cet instant, alors que
    la confirmation annonçait « les fichiers orphelins listés » : un fichier passé au-delà du délai de grâce pendant
    que la page restait ouverte était supprimé sans avoir été montré. Le bouton envoie désormais les noms affichés
    (`purgeOrphanFiles.bind(null, keys)`, 200 au plus, liste contrôlée par l'action) et `purgeOrphans` ne supprime
    que ceux qui sont encore orphelins au moment du clic ; les autres sont laissés en place et comptés dans le
    message (« Laissés en place, plus orphelins depuis la recherche : n ») ;
  - l'étape 3 du point 46 n'est faite que pour le fichier final en vigueur sous Confidentiel : pour un brouillon, une
    révision en circuit ou un document confidentiel ou très confidentiel, la réponse reste en `no-store` et l'aperçu
    paginé recrée son iframe à chaque page (`key={page}`, `src/app/documents/[id]/DocClient.tsx`), donc retélécharge
    tout le fichier. Changer de page sans recréer l'iframe dépend de la visionneuse PDF du navigateur et de celle de
    WebKit dans l'app Mac, qui ne se vérifie que sous macOS : ce reste est consigné ici, dans le point 46 de
    [reste-a-faire.md](reste-a-faire.md) et dans le README, plutôt que corrigé sans essai ;
  - aucun test ne vérifiait les deux contrôles refaits juste avant chaque suppression. Deux tests provoquent la
    course : un fichier que l'analyse date d'avant le délai de grâce mais réécrit depuis, et un fichier qu'une version
    de travail vient référencer entre l'analyse et la suppression ; retirer l'un ou l'autre contrôle, ou supprimer
    des orphelins qui n'étaient pas listés, fait échouer un test chacun.
  - *Vérifié* : `npm test` (51 fichiers, 865 tests), `npm run typecheck`, `npm run lint`, `npm run build`. Sur le
    serveur de développement (copie de la base) : fichier entier identique au fichier stocké, plage 206, 416, 304 et
    HEAD de `PRO-QUA-0006`, brouillon `POL-HSE-0002` refusé (404) à jwagner avec Range ; panneau des orphelins en
    français et en anglais (un fichier récent compté et conservé), absent pour gcomte. Sur la build de production
    (`next start`, horloge du processus avancée de 25 h), dans Chromium : la simulation liste un orphelin, un second
    fichier est écrit pendant que la page reste ouverte, la confirmation annonce « (1) » et seul le fichier listé est
    supprimé (message, entrée au journal et ligne `[orphans] removed …` à son seul nom) ; le second apparaît à la
    recherche suivante. Un fichier listé puis retiré du disque avant le clic est compté « Laissés en place… : 1 » ; en
    anglais, « Orphan files removed: 1 (6 B). Orphans left: 1. »
- **Reste** : l'aperçu paginé des brouillons, des révisions en circuit et des documents confidentiels ou très
  confidentiels retélécharge encore tout le fichier à chaque page (iframe recréée, `no-store`) : changer de page sans
  recréer l'iframe, à essayer dans Chromium et dans l'app Mac (point 46, étape 3) ; le dépôt en flux (étape 4 du point
  46, avec les points 98 et 106) ; le lancement du nettoyage par le planificateur (point 38) ; la reprise de
  `nameStoredFile` sur les noms provisoires ; la suppression sur SharePoint et l'essai du flux et des plages sur un
  vrai tenant (O-01) ; l'aperçu de l'app Mac (WebKit) à vérifier sous macOS.

### 16.4 Sauvegarde et restauration de la base et des fichiers

Point 48 de [reste-a-faire.md](reste-a-faire.md), vérifié au commit `42e2d34` : ni script ni procédure de sauvegarde
dans le dépôt, `npm run db:reset` efface `.data` entier (base et fichiers). PGlite ne laisse qu'un processus ouvrir la
base, et son `postmaster.pid` porte toujours -42 : rien ne dit si le serveur la tient.

- **Archive** (`src/lib/backup-core.mjs`, JavaScript pour tourner sous Node seul) : `codex-backup-<instant UTC>.tar`,
  tar POSIX sans compression (lisible par `tar`), écrit sous un nom provisoire, synchronisé, renommé puis relu en
  entier avant la rotation. Entrées : `database/pglite.tar.gz` (`dumpDataDir('gzip')`), `files/<clé>` pour chaque
  fichier local référencé par une version de travail de cette base, `manifest.json` en dernier (format, date,
  origine, version de Codex, PostgreSQL et PGlite, migration du schéma, nombres de documents, révisions, versions de
  travail, entrées de journal et personnes, fichiers sauvegardés, absents du stockage et sur SharePoint, taille et
  SHA-256 de chaque entrée). Noms longs en en-tête pax.
- **Cohérence** : `CHECKPOINT`, lecture des nombres et des clés référencées, puis vidage de la base, dans une
  transaction PGlite (aucune autre requête en cours : le vidage lit le dossier d'un seul tenant) ; les fichiers sont
  lus ensuite, sans tenir la base, puisqu'un fichier stocké n'est jamais réécrit et qu'un fichier référencé n'est
  retiré qu'après le changement de sa référence ; un fichier renommé entre le vidage et la copie est lu sous son
  nouveau nom (même UUID). Les liens durs ont été écartés : ils déplacent le `ctime`, que le nettoyage des orphelins
  lit (§16.3).
- **Commandes** (`scripts/codex-backup.mjs`, messages en français) : `npm run backup`, `backup:list`,
  `backup:check -- <archive|nom|latest>`, `restore -- <archive> [--replace]`. Variables lues comme Next les lit
  (`@next/env`, voir « Relecture »). Verrou `codex.lock` : écrit par le serveur à l'ouverture de la base
  (`src/db/index.ts`, `lockForServer`), retiré à sa sortie ; une commande refuse tant que ce processus vit, et le
  serveur refuse d'ouvrir la base pendant qu'une commande travaille. Verrou d'un processus disparu ignoré, d'une
  commande 10 minutes après son dernier rafraîchissement (voir « Relecture »).
- **Restauration** (`restoreBackup`) : archive vérifiée entière, migration cherchée dans `drizzle/` (une archive d'un
  schéma régénéré est refusée : drizzle rejouerait sa migration unique), refus d'un dossier qui contient déjà une base
  ou des fichiers sans `--replace`. Tout est écrit à côté (`.restore-…`) : fichiers dont le SHA-256 est recalculé à
  l'écriture, base chargée par PGlite (`loadDataDir`), qui rejoue son journal d'écriture, puis comparée au manifeste
  (nombres, migration, fichiers référencés) ; entrée « Base restaurée » (acteur Codex) écrite, base fermée proprement,
  puis l'existant déplacé dans `replaced-<instant>/` et la restauration mise en place, entrée par entrée avec retour
  arrière (voir « Relecture »).
- **Administration** : Journal d'audit › Sauvegardes, pour les gestionnaires documentaires ayant l'accès
  Administration (`mayBackUp`) : date de la dernière archive, puis (`?backups=1`) dossier, rotation, liste (date,
  origine, documents, fichiers, taille, archive illisible signalée) et « Sauvegarder maintenant » (`backUpData`,
  confirmé, limité comme toute action qui écrit, une à la fois). Entrée « Sauvegarde créée », cible « Sauvegarde ·
  <archive> » : nombres, taille et début du SHA-256 de l'archive, sans nom de document.
- **Tests** : `tests/unit/backup-core.test.ts` (dossier et rotation par défaut, noms d'archive, noms d'entrée admis,
  migrations, rotation sur disque, verrou : processus vivant ou disparu, délai d'une commande, refus du serveur
  pendant une commande) ; `tests/integration/backup.test.ts` (archive et manifeste d'une base de test, orphelin exclu,
  SharePoint compté, fichier référencé absent, fichier renommé entre le vidage et la copie, dossier de sauvegarde
  interdit, rotation ; octet changé, archive tronquée, en-tête altéré, fichier qui n'est pas une archive ; restauration
  sur disque rouverte par `openDb` avec documents, fichiers, termes de recherche, journal en ajout seul et entrée
  « Base restaurée » ; refus sans `--replace` puis mise de côté avec ; rien d'écrit pour une archive altérée, d'un
  autre schéma, ou dont la base ne correspond pas au manifeste ; action refusée aux autres rôles, y compris un
  validateur à qui le droit Administrer est donné, puis sauvegarde et entrée de journal pour un gestionnaire, SHA-256
  de l'archive conforme). Retirer le contrôle des empreintes, la comparaison au manifeste, le refus sans `--replace`
  de `restoreBackup` ou la réserve aux gestionnaires fait échouer un test chacun ; les commandes elles-mêmes n'étaient
  pas testées (voir « Relecture »).
- **Vérifié** : `npm test` (53 fichiers, 890 tests), `npm run typecheck`, `npm run lint`, `npm run build` (sans
  avertissement). Sur une copie de la base de démonstration (69 documents, 18 fichiers, 210 Mo) : `npm run backup`
  (3 s, archive de 216 Mo lisible par `tar -tvf`, SHA-256 identique à `sha256sum`), `backup:check`, archive altérée et
  tronquée refusées, restauration refusée sur un dossier occupé, puis faite dans un dossier vide et avec `--replace` ;
  commande refusée tant que le serveur de développement tourne. Dans Chromium, pour cbardet : panneau en français et
  en anglais, « Sauvegarder maintenant » confirmé, message, liste et entrée au journal ; panneau absent et écran refusé
  pour jwagner, gcomte, jholt et cbardet en rôle validateur. Serveur arrêté, archive faite depuis l'application
  restaurée dans un dossier vide ; le serveur relancé sur ce dossier sert le même export CSV de la recherche et les
  mêmes empreintes des 18 fichiers qu'avant la sauvegarde, avec l'entrée « Base restaurée » ; de même après une
  sauvegarde en ligne de commande restaurée avec `--replace`. Le serveur lancé pendant une restauration (verrou d'une
  commande vivante) répond 500 « busy: restore », puis sert la base une fois la commande finie. Sur la build de
  production (`next start`, port 3101) : sauvegarde depuis le panneau, ligne `[backup] …` au journal du serveur ;
  procédure « Tester une restauration » de `docs/sauvegarde.md` suivie telle quelle.
- **Relecture** (sept constats, dont deux identiques sur les fichiers `.env` ; tous retenus) :
  - la mise en place d'une restauration renommait `pglite/` puis `files/` en entier, sans retour arrière : un échec du
    second renommage (dossier `files/` monté à part, `EBUSY`, `EXDEV`, droits) laissait la base restaurée en place,
    sans ses fichiers, l'ancienne base mise de côté, et effaçait les fichiers extraits ; un `files/` lien symbolique
    était remplacé par un dossier local. Désormais le contenu des deux dossiers est déplacé entrée par entrée (les
    dossiers restent, points de montage ou liens), copié puis retiré d'un système de fichiers à l'autre, jamais par
    dessus une entrée existante ; si un déplacement échoue, ceux faits sont défaits du dernier au premier et la
    commande annonce que rien n'a été remplacé (`swap_failed`) ; si le retour arrière échoue aussi, elle s'arrête,
    garde le contenu extrait et dit ce qui est où (`swap_incomplete`) ;
  - « Sauvegarder maintenant » appliquait la rotation à chaque clic : quelques clics de suite écartaient toutes les
    archives d'avant, alors qu'elles servent à revenir sur une erreur faite dans l'application. Deux règles, signalées
    dans [decisions.md](decisions.md) (fréquence et conservation non décidées) : depuis l'application, une sauvegarde
    au plus 15 minutes après la dernière archive, quelle que soit son origine (message avec l'heure de la dernière et
    celle de la prochaine possible) ; la rotation garde, en plus des `CODEX_BACKUP_KEEP` plus récentes, la plus
    récente de chacun des `CODEX_BACKUP_KEEP` derniers jours (UTC), pour la commande comme pour l'application ;
  - une taille pax négative était acceptée et faisait reculer la lecture : `tarEntries` relisait sans fin les mêmes
    en-têtes (liste, vérification, restauration, panneau d'Administration bloqués, processus à 100 % du processeur).
    La taille pax doit être un nombre entier écrit en chiffres (vide : celle de l'en-tête) et chaque en-tête doit être
    après le précédent, sinon « Ce fichier n'est pas une archive tar lisible » ;
  - les entrées « Sauvegarde créée » et « Base restaurée » donnaient à tout lecteur du journal d'Administration le
    nombre total de documents (brouillons et confidentiels compris), de fichiers et leur volume : un validateur à qui
    le droit Administrer est donné apprenait combien de documents lui sont cachés, et quand l'un d'eux est créé.
    Nombres, tailles et empreinte ne sont plus montrés qu'aux gestionnaires documentaires (`backupL`, comme
    `purgeL`), à l'écran comme dans l'export CSV ;
  - les commandes ne lisaient que `.env.local` et `.env`, alors que `next start` lit aussi `.env.production.local` et
    `.env.production` (et `next dev` ses fichiers `.env.development*`) : une commande pouvait viser un autre dossier
    de données que le serveur, verrou compris. Elles lisent désormais les variables avec `loadEnvConfig` de
    `@next/env` (installé avec Next), en mode production par défaut et en mode développement avec `--dev`, et
    affichent en tête le dossier de données, le dossier des sauvegardes et les fichiers lus ;
  - aucun test ne lançait les commandes ni le verrou du serveur : retirer `lockForServer` de `init()`,
    `lockForCommand` de la commande, ou forcer `--replace`, laissait passer `npm test`.
    `tests/integration/backup-commands.test.ts` lance `node scripts/codex-backup.mjs` dans un processus à part :
    refus de `create` et de `restore` (avec ou sans `--replace`) tant que le serveur tient le dossier, rien d'écrit ;
    refus sans `--replace` puis mise de côté avec ; sauvegarde et vérification de la base restaurée ; fichiers `.env`
    lus comme Next ; et `getDb()` qui refuse d'ouvrir la base pendant une commande, puis écrit son verrou, que la
    commande respecte. Chacune de ces trois mutations fait maintenant échouer un test ;
  - un verrou de commande laissé par une commande tuée bloquait le serveur jusqu'à 24 h si son numéro de processus
    était repris, avec une erreur muette. La commande rafraîchit son verrou toutes les 30 s et il est ignoré 10 minutes
    après son dernier rafraîchissement ; l'erreur du serveur nomme `codex.lock` et dit de le supprimer si aucune
    commande ne tourne ; dépannage complété dans `docs/sauvegarde.md`, phrase du README nuancée.
  - *Vérifié* : `npm test` (54 fichiers, 904 tests), `npm run typecheck`, `npm run lint`, `npm run build` (sans
    avertissement : la lecture d'un dossier de la mise en place porte `turbopackIgnore`). Quatorze mutations (retour
    arrière, copie entre systèmes de fichiers, dossiers renommés en entier, taille pax, rotation par jour, délai de
    l'application, nombres du journal, rafraîchissement et délai du verrou, verrous du serveur et des commandes,
    `--replace` forcé, fichiers `.env`) font chacune échouer au moins un test. Sur une copie de la base de
    démonstration (69 documents, 18 fichiers, 210 Mo), serveur de développement : `npm run backup` et `npm run
    restore` refusés tant qu'il tourne ; dans Chromium, pour cbardet, « Sauvegarder maintenant » crée l'archive, les
    trois clics suivants sont refusés (« La dernière sauvegarde date du 15/10/2026 15:01, il y a moins de 15 minutes
    … »), en anglais aussi, et la liste reste la même ; une archive de 2,5 Ko à taille pax négative déposée dans le
    dossier est listée « manifeste illisible » sans bloquer (panneau en 2 s, `backup:list` et `backup:check` en
    0,5 s) ; gcomte, à qui cbardet donne le droit Administrer, lit l'entrée « Sauvegarde créée » sans nombres, à
    l'écran et dans l'export CSV, cbardet avec. Archive faite depuis l'application restaurée dans un dossier vide dont
    `files/` est un lien vers `/dev/shm` (autre système de fichiers) : lien conservé, 18 fichiers copiés ; le serveur
    relancé sert le même export de la recherche et les mêmes empreintes des 18 fichiers qu'avant la sauvegarde, avec
    l'entrée « Base restaurée ». Avec `files/` rendu non modifiable (`chattr +i`), `restore --replace` échoue au
    déplacement des fichiers : « La base et les fichiers d'origine ont été remis en place : rien n'a été remplacé »,
    l'ancienne base est intacte et rien ne traîne ; relancée après `chattr -i`, la restauration aboutit. Serveur lancé
    avec un verrou de commande d'un processus vivant (pid 1) : 500 et « busy: a backup command (pid 1) holds
    …/codex.lock; if no backup or restore command is running, delete that file » ; le même verrou daté de 11 minutes
    est ignoré (200). Build de production (`next start`, port 3101, dossier de sauvegardes vide) : sauvegarde depuis le
    panneau, second clic refusé, ligne `[backup] …` au journal du serveur ; puis, serveur arrêté, cette archive
    restaurée avec `--replace` sur le dossier au lien `/dev/shm` (ancien contenu copié vers `replaced-…/`), même
    export et mêmes empreintes après redémarrage.
- **Reste** (décisions de l'utilisateur, M22 et hébergement) : fréquence et planification (point 38), lieu de
  conservation et copie hors de la machine, chiffrement, perte de données et délai de reprise tolérés ; sauvegarde des
  fichiers SharePoint (O-01) ; `pg_dump` avec un Postgres serveur (point 51).

### 16.5 Journal technique, santé du serveur et contrôle de la configuration

Points 49 et 37 de [reste-a-faire.md](reste-a-faire.md), vérifiés au commit `55c0df4` : le serveur écrivait par 17 appels
`console.*` épars et non structurés (cinq à l'inventaire, les étapes précédentes en avaient ajouté ; sans compter
`src/lib/backup-core.mjs` ni le client), sans identifiant de requête ; `checkBearer` refusait les jetons sans rien écrire ; aucune route de santé ; pas de
`src/instrumentation.ts`, donc ni contrôle au démarrage ni `onRequestError` ; une valeur de `CODEX_STORAGE` autre que
`sharepoint` (par exemple `SharePoint`) basculait en silence sur le stockage local, et les `CODEX_SP_*` n'étaient lues
qu'au premier appel à Graph.

- **Journal technique** (`src/lib/log.ts`) : une entrée par ligne, JSON en production, lisible en développement
  (`CODEX_LOG_FORMAT`), niveau `CODEX_LOG_LEVEL` (`info`) ; `time`, `level`, `scope`, `msg`, et `requestId` pendant
  une requête (`AsyncLocalStorage`, partagé par `globalThis` entre le paquet d'`instrumentation.ts` et celui des
  routes). Les champs au nom de secret sont remplacés par `[redacted]`, les octets par leur nombre, les textes coupés à
  500 caractères ; d'une erreur, nom, message, code, `errno`, `digest`, début de la pile et cause, jamais ses autres
  propriétés (le `detail` d'une erreur Postgres cite des valeurs). Les `console.*` du serveur passent par lui
  (stockage, antivirus, orphelins, sauvegarde, limites de débit, routes), sauf ceux de `src/lib/backup-core.mjs`,
  partagé avec les commandes de sauvegarde.
- **Routes d'API** (`withRequestLog`) : les sept routes existantes et la nouvelle route de santé écrivent méthode,
  route (son modèle, sans identifiant de document ni chaîne de requête), statut, durée jusqu'au début de la réponse et
  taille ; l'identifiant est repris de `X-Request-Id` s'il est un simple jeton, sinon tiré, et renvoyé ; une erreur
  levée est écrite avec sa pile et répond 500 `{"error":"internal","requestId"}`.
- **Server Actions** : les 29 actions d'écriture passent par `traceAction` (`export async function x(...args)` qui
  appelle `xNow`) : nom, issue (`ok`, `refused`, `stale`), durée, jamais le message montré à l'utilisateur ; une
  erreur est écrite une fois avec sa pile puis relancée pour Next.js ; une redirection n'est pas une erreur. Une
  écriture refusée par la limite de débit est écrite avec l'utilisateur.
- **Jetons refusés** : `checkBearer` écrit en `warn` la route, l'adresse du client, la raison (`missing`, `invalid`,
  `disabled`, `blocked`) et le statut, jamais le jeton.
- **`src/instrumentation.ts`** : `register` lance le contrôle de configuration ; `onRequestError` écrit toute erreur
  serveur rattrapée par Next.js (chemin sans chaîne de requête, route, type, `digest`), sauf celles déjà écrites par
  une route ou une action, et une seule fois quand Next.js signale deux fois le même rendu en échec (vu sur `next
  start` : même `digest`, même chemin). Les modules sont importés dans les fonctions, comme le recommande le guide ;
  `process.exit` vit dans `config-check.ts`, pas dans `instrumentation.ts`, que Next.js analyse aussi pour l'Edge.
- **Santé** (`src/app/api/health/route.ts`, `force-dynamic`) : base (`select 1` par `getDb()`) puis stockage actif
  (`probeStore` : dossier `files/` lisible et inscriptible, ou lecteur SharePoint par Graph, sans nouvel essai et
  gardé une minute), l'un après l'autre, 5 s au plus chacun ; 200 ou 503 avec la version (`src/lib/version.ts`, aussi
  utilisé par la sauvegarde) et le résultat de chaque contrôle ; la raison n'est qu'au journal ; `HEAD` pareil sans
  corps ; une réponse 200 n'est écrite qu'au niveau `debug`. Pas de `/api/ready` (un seul processus).
- **Contrôle de la configuration** (`src/lib/config-check.ts`) : forme de chaque variable de `.env.example`, telle que
  le code la lit, et dossier de données ; erreurs, avertissements et informations écrits avec un code ; en production
  une erreur arrête le serveur (`ConfigRefusedError`, code de sortie 1 au tour suivant pour que les lignes atteignent un
  tube), sauf `CODEX_CONFIG_CHECK=warn`. Codes et corrections dans `docs/exploitation.md` §3.
- Choix signalés dans [decisions.md](decisions.md) (choix de l'assistant) : refus de démarrer et son seuil de jeton,
  santé sans authentification, JSON dans le journal de l'app Mac, contenu du journal (utilisateur d'une écriture
  freinée, adresse d'un jeton refusé), reprise de `X-Request-Id` sans `CODEX_TRUST_PROXY`.
- *Vérifié* : `npm test` (57 fichiers, 950 tests, un test sauté quand on est root : dossier en lecture seule),
  `npm run typecheck`, `npm run lint`, `npm run build` sans avertissement (deux avertissements Turbopack corrigés :
  `process.exit` dans `instrumentation.ts`, accès au disque à chemin variable sans `turbopackIgnore`). Trois mutations
  (mode `strict` par défaut en production, masquage des secrets, ligne du jeton refusé) font chacune échouer un test.
  `next start` : sans variable, démarrage normal, quatre lignes `config` (deux jetons absents, antivirus absent,
  authentification simulée) puis `configuration checked` ; avec `CODEX_IMPORT_TOKEN=change-me CODEX_STORAGE=SharePoint`,
  refus (`storage_unknown`, `token_weak`), code de sortie 1, aucune réponse sur le port, ni le jeton ni sa valeur dans le
  journal ; les mêmes avec `CODEX_CONFIG_CHECK=warn` et `CODEX_LOG_FORMAT=pretty` : démarrage, lignes lisibles, jeton
  faux sur `/api/import` avec `X-Request-Id: test-req-42` → 401, même identifiant renvoyé et sur les deux lignes
  (`auth`, `http`). Base cassée (`pglite` remplacé par un fichier) : `/api/health` 503 `database` sans détail, la
  raison au journal ; `/recherche?q=…` en 500 écrit une fois par `onRequestError` (sans la chaîne de requête) ;
  `/api/registry` 500 `{"error":"internal","requestId"}`. Base neuve : première sonde 200 en 3,8 s (ouverture et
  données de démonstration), suivantes en quelques millisecondes. Dans Chromium (développement et production),
  cbardet, gcomte, jwagner et jholt ouvrent Accueil, Explorateur, Recherche, Validations et une fiche (200, aucune
  erreur hormis l'absence connue de `favicon.ico`) ; deux bascules d'un droit dans Administration écrivent deux lignes
  `action togglePermission ok`, un téléchargement une ligne `http` avec `X-Request-Id`.
- **Relecture** (douze constats, dont deux identiques sur les erreurs de requête et deux sur `url_invalid` ; tous
  retenus) :
  - une erreur de requête de Drizzle a pour message « Failed query: <SQL> params: <valeurs> » : le texte d'un
    commentaire, un motif de rejet, un titre ou des termes de recherche passaient au journal, dans le message et dans
    la pile, à chaque échec d'écriture en base (octet nul refusé, disque plein, contrainte, verrou). `serializeError`
    ne garde plus que le SQL paramétré, masque la valeur citée par une erreur de PostgreSQL (« invalid input syntax for
    type integer: "…" »), ne lit jamais `params`, et refait la pile à partir de ce message et des seules lignes « at »,
    chacune coupée à 300 caractères. Next.js imprimant lui-même, dans la même sortie, l'erreur entière d'une Server
    Action (propriétés et cause comprises), `traceAction` lui remet une erreur refaite sans ces valeurs
    (`withoutQueryValues`). Une erreur de requête pendant le rendu d'une page reste imprimée telle quelle par Next.js :
    limite consignée dans `docs/exploitation.md` §5 ;
  - la 503 `disabled` d'un point d'entrée d'intégration sans jeton, état par défaut, était écrite au niveau `error` :
    n'importe quel client remplissait le journal d'erreurs. Elle est marquée prévue (`expectedAnswer`) et écrite en
    `info`, la ligne `auth` aussi ; `error` reste aux 500, au stockage injoignable (502) et à la santé en échec ;
  - la ligne `auth` d'un jeton refusé donnait comme `client` la dernière valeur de `X-Forwarded-For`, que le client
    choisit librement sans proxy de confiance : elle n'est `client` qu'avec `CODEX_TRUST_PROXY=1`, sinon
    `forwardedFor` avec `clientTrusted: false` ;
  - des sondes `/api/health` simultanées contournaient le cache d'une minute de la sonde SharePoint (une rafale :
    autant d'appels à Graph et d'appels de jeton à Entra ID, avec le secret client). La sonde en cours et l'obtention du
    jeton sont désormais partagées : 50 sondes simultanées, un appel à chacun ;
  - `url_invalid` recopiait la valeur de `VIGIE_API_URL` ou d'une adresse publique : sans `https://`, « admin:motdepasse@
    hôte » passait au journal. Le message dit seulement ce qui manque ; l'adresse de `CODEX_CLAMD` n'est citée que sans
    « utilisateur:motdepasse@ » ni chaîne de requête ;
  - aucun test ne chargeait `src/instrumentation.ts` : `tests/unit/instrumentation.test.ts` vérifie le refus de
    démarrer en production (rejet et `process.exit(1)`), le démarrage par défaut, l'absence d'effet sur l'Edge et la
    ligne `next` d'`onRequestError` ;
  - les exemples `jq` du guide d'exploitation s'arrêtaient à la première ligne non JSON (Next.js, app Mac) : ils
    passent par `jq -cR 'fromjson? | …'` (ou `grep '^{'`), et le guide dit quelles lignes ne sont pas du JSON ;
  - le seuil de 32 caractères des jetons n'était encodé par aucun test (tous les jetons refusés l'étaient aussi pour
    leurs caractères trop peu variés) : un jeton varié de 16, 23 ou 31 caractères est refusé, de 32 accepté ;
  - `/api/import` et `/api/integrations/vigie` répondaient 500 `{"error":"internal"}` sans `requestId`, contrairement à
    `docs/api.md` : le corps le porte désormais (pour Vigie, c'est l'identifiant de la requête HTTP, pas la référence
    de la demande ; précisé dans `docs/api.md`) ;
  - la journalisation n'était vérifiée que sur quelques actions et routes : un test appelle chaque export de
    `src/lib/actions.ts` (hors langue et utilisateur simulé) et attend sa ligne `action`, et chaque méthode de chaque
    `route.ts` de `src/app/api` (trouvés sur le disque) et attend `X-Request-Id` et sa ligne `http`. Retirer
    `traceAction` de `decideStep` le fait échouer.
  - *Vérifié* : `npm test` (58 fichiers, 965 tests dont un sauté), `npm run typecheck`, `npm run lint`, `npm run build`.
    `npm run dev` : commentaire contenant un octet nul envoyé depuis Validations dans Chromium (cbardet, W-305) → toast
    d'erreur, ligne `action failed` et ligne « ⨯ » de Next.js sans le texte (seule la ligne de développement
    « └─ ƒ addComment(…) » de Next.js le montre, absente en production) ; `/api/export/search?q=…%00` → 500 avec
    `requestId`, sans les termes. `next start` : `VIGIE_API_URL=admin:S3cretPass@…` et `CODEX_IMPORT_TOKEN=change-me` →
    refus (`token_weak`, `url_invalid`), code 1, ni l'un ni l'autre au journal ; démarré : webhook désactivé avec
    `X-Forwarded-For` forgé → deux lignes `info`, `forwardedFor`, `clientTrusted:false` ; même commentaire et même
    export → aucune trace des textes dans tout le journal ; `jq -c` sans `-R` s'arrête (« parse error », code 5),
    `jq -cR 'fromjson? | …'` trouve les deux erreurs et les deux lignes de `test-req-42`. Accueil, Explorateur,
    Recherche, Validations et une fiche s'ouvrent pour cbardet, gcomte, jwagner et jholt.
- **Reste**, selon l'hébergement (question 3 de l'audit) : métriques et alertes, conservation, rotation et
  centralisation du journal ; joignabilité de clamd non sondée (premier dépôt) ; sonde SharePoint non essayée sur un
  vrai tenant (O-01) ; lignes « ⨯ » de Next.js pour une erreur de requête pendant le rendu d'une page.

### 16.6 Administration du registre et des programmes de recherche

Points 61 et 58 de [reste-a-faire.md](reste-a-faire.md), vérifiés au commit `6823294` : `updateType` ne modifiait que
le circuit, la confidentialité, la conservation (sans son fondement), la périodicité de revue et l'état actif ; aucune
action ne créait de type, de famille, de fonction ni de programme (insertions dans `src/db/seed.ts` seulement) ;
l'onglet Registre n'avait pas de bouton « Nouveau type », et `TypeEditor` n'exposait ni les libellés, ni la famille,
ni les origines et rattachements, ni les sous-types, ni la clause ISO, ni le livrable client ; `research_programs`
n'était rempli que par le seed, sans état ni écran. Le constat sur le journal ne tenait plus : `audit_log.doc_id` est
facultatif depuis l'étape 6 du lot 2 (cibles sans document).

- **Règles** (`src/lib/registry-rules.ts`, sans dépendance au serveur, testées seules) : formats des codes (type de 2
  ou 3 lettres, programme d'une lettre puis 2 à 9 lettres ou chiffres, clés en minuscules et `_`) ; un code ne
  désigne qu'une chose dans `TYPE-CONTEXTE-SEQ` : type, département, projet, programme et `QMS` ne se reprennent pas
  (point 1 de `docs/registre-points-ouverts.md` : FIN, HSE et COM gardés, aucun nouveau cas ; l'ajout d'un département
  le vérifie aussi) ; lecture des formulaires de type (sous-types FR/EN appariés, 40 au plus), famille, fonction et
  programme ; documents qu'un réglage de type n'admettrait plus.
- **Usage** (`registryUsage`, `src/lib/queries.ts`) : ce qui fait référence à chaque entrée, tous documents
  confondus ; s'y ajoutent les entrées que les règles de Codex nomment (type FRM des modèles, fonctions chef de projet,
  validation client et responsable du département), qui gardent leur code même inutilisées.
- **Actions** (`src/lib/actions.ts`, droit « Administrer », limite d'écriture, `traceAction`) : `createType`,
  `updateType`, `deleteType`, et de même pour les familles, les fonctions et les programmes. Une entrée utilisée garde
  son code et ne se supprime pas ; la famille d'un type entraîne celle de ses documents ; restreindre les admissions
  d'un type demande une confirmation avec le nombre de documents concernés (leurs identifiants aux gestionnaires) ; la
  portée d'une fonction qui a des titulaires ne change pas ; un programme désactivé n'est plus proposé à un nouveau
  document (ni à un nouveau titulaire), ceux qui l'ont le gardent. Chaque écriture est journalisée comme entrée sans
  document (cibles `type`, `family`, `function`, `program`), champ par champ, affichée dans la langue du lecteur.
- **Écrans** : Registre des types (« Nouvelle famille », « Nouveau type » préréglé sur la famille filtrée, section
  « Familles »), Fonctions & circuits (« Nouvelle fonction », crayon par fonction, section « Programmes de
  recherche ») ; dialogue de type complet, aussi ouvert depuis Archivage › Règles ; code en lecture seule et
  « Supprimer » désactivé (avec la raison) pour une entrée utilisée. Colonne `research_programs.active`, migration
  unique régénérée.
- **Keystone** : `GET /api/registry` suit chaque changement (nouvel `ETag`), `source: codex` pour un type créé dans
  Codex ; règles de stabilité dans `docs/api.md`.
- *Vérifié* : `npm test` (60 fichiers, 999 tests dont un sauté), `npm run typecheck`, `npm run lint`. Retirer les
  entrées nommées par Codex de `registryUsage` fait échouer deux tests. `npm run dev` sur une base neuve, dans
  Chromium (cbardet) : type refusé pour un code de département puis créé (NTC, sous-type FR/EN, étape « Responsable de
  chantier », clause ISO), renommé NTD tant qu'inutilisé ; PRO (utilisé) en lecture seule, « Supprimer » désactivé ;
  « Interne » retiré de ses niveaux → 4 documents nommés et enregistrement bloqué jusqu'à la confirmation ;
  rattachement « Projet » retiré de MIN → `MIN-HLT-026-001` nommé, confirmé, enregistré ; famille créée puis supprimée
  (confirmation) ; fonction créée, portée de « Responsable qualité » verrouillée ; programme refusé pour le code QUA,
  R2603 créé, R2602 désactivé et absent du dialogue de création d'un document de recherche ; journal lisible ;
  `/api/registry` donne NTD (`source: codex`), plus NTC, et MIN avec `["none"]` ; dialogue « New type » en anglais ;
  aucune erreur de page ni de serveur. `npm run build` puis `next start` sur un autre port : Registre, Fonctions &
  circuits et Archivage › Règles en 200, avec leurs boutons et la section des programmes.
- **Relecture** (six constats, dont deux en double, tous retenus) :
  - la confirmation d'une restriction de type ne valait pas pour ce qu'elle annonçait : le dialogue gardait l'ancien
    avertissement après un nouveau changement d'admission, et le serveur acceptait `confirmOut=1` quel que soit le
    réglage. Le refus porte désormais un jeton (HMAC du type, du réglage et des identifiants exclus, clé tirée au
    démarrage, qui ne révèle aucun brouillon) que la confirmation doit renvoyer ; le serveur recalcule et redemande si
    le réglage ou les documents diffèrent. Le dialogue efface le refus à chaque changement d'admission (`clear` de
    `useSubmit`) ;
  - les entrées nommées par Codex gardaient leur code mais pas les réglages dont le code dépend : FRM admet désormais
    seulement « sans rattachement » (sinon un modèle rattaché à un projet recevait l'ID `FRM-HLT-026-001`), chef de
    projet et validation client restent « par projet », responsable du département « par département »
    (`builtInTypeIssue`, `builtInScopeIssue`), cases et liste grisées dans les dialogues ;
  - `addFunctionHolder` acceptait un programme désactivé ou inconnu : la valeur de portée est vérifiée dans la
    transaction (département ou projet existant, programme existant et actif) ;
  - `parseSubtypes` lisait toutes les lignes reçues et dédoublonnait en temps quadratique : au-delà de 80 lignes, refus
    sans lecture, dédoublonnage par ensemble ;
  - le droit « Administrer » des douze actions du registre et des programmes est testé une à une (collaborateur,
    validateur, auditeur), sans changement ni journal, puis l'appel passe en gestionnaire ; retirer le contrôle des
    douze fait échouer les douze cas.
  *Vérifié* : `npm test` (60 fichiers, 1 019 tests dont un sauté), `npm run typecheck`, `npm run lint`, `npm run
  build`. Dans Chromium sur une base neuve (cbardet) : CTR sans « Projet » nomme CTR-HLT-026-001 et CTR-HLT-026-002 ;
  décocher ensuite « Confidentiel » efface l'avertissement, et « Enregistrer » redemande avec trois documents, dont
  CTR-JUR-0001 ; annuler les deux retraits enregistre sans question ; CTR sans « Aucun » nomme CTR-JUR-0001, confirmé
  puis enregistré, `/api/registry` donne `["project"]`. Rattachements de FRM et portée de « Chef de projet » grisés,
  avec leur raison. Dialogue « Ajouter un titulaire » ouvert sur R2602 pendant qu'un autre onglet désactive R2602 :
  l'ajout est refusé. `next start` sur un autre port : Administration (registre, fonctions) en 200.
- **Reste** : la date de fin des programmes (déclencheur de conservation « fin de programme », point 3 du registre,
  O-05) ; la gouvernance des termes (A05) ; l'application des évolutions du registre à une base existante par script
  (point 60) ; les vocabulaires contrôlés des sous-types (point 59).

### 16.7 Administration de l'organisation : renommer ou retirer un département ou un site

Point 62 de [reste-a-faire.md](reste-a-faire.md), vérifié au commit `8171aa2` : l'onglet Organisation n'offrait que
« Nouveau département » et « Nouveau site » (et le réglage des filtres mis en avant) ; `departments` et `sites`
n'avaient pas de colonne `active`, les sites un seul libellé ; aucune action ne renommait ni ne retirait une valeur.
Deux éléments du constat ne tenaient plus : `addOrgValue` journalisait déjà ses ajouts, et `audit_log.doc_id` est
facultatif depuis le 10 octobre. `saved_searches.department` est aussi une clé étrangère vers `departments` depuis le
11 octobre.

- **Schéma** : `departments.active`, `sites.active`, libellés FR et EN des sites (`label_fr`, `label_en` au lieu de
  `label` ; seed : « Lyon — siège et atelier » / « Lyon — head office and workshop »…). Migration unique régénérée :
  une base existante repart de zéro (`npm run db:reset`).
- **Règles** (`src/lib/org-rules.ts`, sans dépendance au serveur, testées seules) : libellé FR obligatoire, EN repris
  du FR, 160 caractères au plus ; valeurs proposées à une nouvelle saisie (`offered` : les actives, plus celle que
  l'entrée a déjà) ; département d'un nouveau document (celui de l'utilisateur s'il est actif, sinon le premier
  actif) ; un département actif au moins (`lastActiveIssue`). `defaultDepartment` (`/departements`) ouvre toujours le
  département de l'utilisateur, même inactif, sinon le premier actif.
- **Usage** (`orgUsage`, `src/lib/queries.ts`) : par département, documents (tous états), personnes (acteurs système
  exclus), titulaires d'une fonction « par département », recherches partagées avec lui et identifiants attribués sous
  son code (compteurs `doc:TYPE-CONTEXTE` de `id_counters`, qui demeurent après un reclassement) ; par site, documents
  et personnes. Les nombres de personnes et de documents de l'onglet en viennent (au lieu de la liste de tous les
  documents).
- **Actions** (`src/lib/actions.ts`, droit « Administrer », limite d'écriture, `traceAction`) : `updateOrgValue`
  (libellés et état ; le code ou la clé, nommés par `original`, ne sont jamais lus du formulaire), `deleteOrgValue`
  (refus avec la raison pour une valeur utilisée ; un département actif au moins) ; `addOrgValue` donne aux sites leurs
  deux libellés et journalise désormais champ par champ. Journal : `org_add`, `org_edit` (« Valeur d'organisation
  modifiée »), `org_remove`, cibles département et site, code ou clé, libellés et état avant → après.
- **Valeur inactive** : `validateFields` refuse un département ou un site inactif sauf pour le document qui l'a déjà
  (message sous le champ) ; un document créé sans département explicite prend celui de l'utilisateur, et la création
  est refusée s'il est inactif plutôt que d'en choisir un autre ; `saveSearch` refuse de partager avec un département
  inactif. `addFunctionHolder` accepte en revanche un département inactif : ses documents passent encore par des
  circuits (contrairement à un programme clos, dont le responsable répond). Les dialogues (nouveau document,
  métadonnées, recherche enregistrée) ne proposent que les valeurs actives, plus la valeur actuelle du document ; celui
  du titulaire liste tous les départements, l'inactif marqué « (inactif) » (`markInactive`, comme le sélecteur de la
  page du département) ; le nouveau document part du département de l'utilisateur s'il est actif, sinon du premier
  actif. L'import accepte un département ou un site inactif (D-21).
- **Ordre** : un département ou un site ajouté prend le rang qui suit le plus grand (`nextSort`, comme les types,
  familles et fonctions) et non le nombre de valeurs, qui après une suppression pouvait redonner un rang déjà pris ;
  à rang égal, `getCtx` les range par code ou par clé, pour qu'un renommage ou une désactivation ne change plus
  l'ordre des listes.
- **Écrans** : un crayon par département et par site ouvre le dialogue de la valeur (code ou clé en lecture seule avec
  sa raison, libellés FR/EN, « Département actif (proposé à la création) », « Supprimer » désactivé avec la raison
  quand la valeur est utilisée, confirmation sinon) ; lignes inactives grisées et marquées « Inactif » ; libellé EN
  du site sous le libellé ; texte d'en-tête de l'onglet complété. Page d'un département inactif : étiquette
  « Inactif » et phrase d'explication, « (inactif) » dans le sélecteur ; ses documents et ses filtres mis en avant
  restent. Le libellé renommé suit partout (`ctx.label`), filtres mis en avant compris.
- *Vérifié* : `npm test` (62 fichiers, 1 047 tests dont un sauté), `npm run typecheck`, `npm run lint`. Retirer le
  refus d'une valeur inactive dans `validateFields`, le contrôle du dernier département actif ou les identifiants de
  `orgUsage` fait échouer cinq tests. `npm run dev` sur une base neuve, dans Chromium : en cbardet, CMN renommé
  « Communication & marque » / « Communication & brand » (code en lecture seule, « Supprimer » désactivé avec la
  raison), le nouveau libellé dans le dialogue de création et sur la page `/departements/CMN` ; ACH désactivé (ligne
  grisée « Inactif ») : absent du dialogue de création, toujours proposé et enregistrable dans les
  métadonnées de COC-HLT-026-001 (ACH), page `/departements/ACH` marquée « Inactif » ; LGO créé puis supprimé après
  confirmation ; site Marseille renommé et désactivé (Fabien Bertrand y est : non supprimable), absent du dialogue de
  création ; journal : « Valeur d'organisation modifiée / ajoutée / supprimée » avec chaque champ avant → après ;
  écran et dialogue en anglais. En jwagner : Administration refusée ; ING désactivé par cbardet → le dialogue de
  création part de DIR et `/departements` ouvre toujours ING ; ING réactivé → de nouveau proposé par défaut. Aucune
  erreur de page ni de serveur (seul `/favicon.ico` répond 404, comme avant).
- **Relecture** (trois points, tous retenus) :
  - la suppression du dernier département actif, même inutilisé, n'était testée que par la règle pure : un test
    d'intégration passe désormais par `deleteOrgValue` (LGO seul actif, refusé, rien au journal) ;
  - un département inactif refusait tout nouveau titulaire : le départ de son responsable bloquait les demandes de
    validation de ses documents, sauf à le réactiver. Il en prend désormais (ci-dessus), testé jusqu'au circuit
    lancé. Un programme clos garde la règle de l'étape 6 ; le cas restant est consigné dans `docs/decisions.md` ;
  - le rang d'un département ou d'un site ajouté était le nombre de valeurs, repris après une suppression, et l'ordre
    des listes changeait alors à chaque renommage : `nextSort` et clé secondaire (ci-dessus), testés.
  - *Vérifié* : `npm test` (62 fichiers, 1 051 tests dont un sauté), `npm run typecheck`, `npm run lint`. Retirer le
    contrôle du dernier département dans `deleteOrgValue`, accepter de nouveau seulement les départements actifs pour
    un titulaire, revenir au rang « nombre de valeurs » ou retirer la clé secondaire fait chacun échouer un test.
    `npm run dev` sur une base neuve, dans Chromium, en cbardet : ACH désactivé (le dialogue l'explique) puis proposé
    « ACH · Achats & stock (inactif) » dans le dialogue du titulaire, Gabriel Comte nommé (« Titulaire ajouté » au
    journal), ACH resté inactif et toujours absent du dialogue de création ; LGO et XYZ ajoutés, LGO supprimé, ABC
    ajouté : ABC suit XYZ, et l'ordre ne bouge plus quand XYZ est renommé ou ABC désactivé ; en anglais, dialogue du
    titulaire (« (inactive) ») et explication du dialogue du département. Aucune erreur de page ni de serveur.
- **Reste** : fusionner deux départements (le sort des brouillons jamais approuvés, qu'un reclassement renumérote,
  attend O-09) ; l'organigramme réel (O-04) ; qui peut renommer ou retirer une valeur (A05) ; le titulaire d'un
  programme clos dont le responsable est l'auteur de la révision (étape 6).

### 16.8 Export complet pour la réversibilité

Point 17 de [reste-a-faire.md](reste-a-faire.md), vérifié au commit `6063aed` : seuls deux exports existaient, le CSV
des résultats de recherche visibles et le CSV du journal (`src/app/api/export/search` et `audit`), sans fichiers,
révisions ni historique, et aucune dépendance ZIP. M22 de l'audit restait « Ouvert ». Le constat tenait entièrement.
Un premier essai, interrompu presque terminé (limite d'usage), a été relu et repris tel quel ; il restait la
documentation et la vérification réelle.

- **Archive** (`src/lib/export-core.mjs`, JavaScript sans dépendance, comme `backup-core.mjs`) : ZIP aux éléments
  stockés, écrit en flux (taille et CRC-32 après les octets, Zip64 au-delà de 4 Go ou de 65 534 éléments), relu et
  vérifié par le même module. Contenu : `LISEZMOI.txt`, chaque table en JSON sous `data/` (champs nommés comme dans
  `src/db/schema.ts`), dont le journal d'audit, `data/documents.csv`, le fichier de chaque version de travail sous
  `files/{ID}/{ID}_{lettre}.{n}.{ext}`, `import/documents.json` (chaque document au format de `POST /api/import`, avec
  son identifiant actuel comme `legacyRef` et le fichier à envoyer), `SHA256SUMS` et `manifest.json` (date, version de
  Codex, dernière migration, nombre de lignes de chaque table, fichiers manquants ou non inclus, taille et SHA-256 de
  chaque élément). L'index de recherche (`document_terms`) n'est pas exporté : la base le recalcule.
- **Instantané** : tables copiées en une transaction dans des tables temporaires, puis lues par lots ; journal lu
  jusqu'à la dernière entrée de cette transaction ; fichier renommé entre-temps par un reclassement retrouvé sous sa
  nouvelle clé. Tables temporaires supprimées à la fin, à l'interruption ou à l'échec.
- **Téléchargement** `GET /api/export/full` (`src/lib/full-export.ts`), lien « Télécharger l'archive (ZIP) » dans
  Administration › Journal d'audit : réservé aux gestionnaires documentaires ayant l'accès Administration
  (`mayExportAll`, `src/lib/access.ts`), 403 pour tout autre utilisateur, `HEAD` compris, et lien absent ; compté dans
  `CODEX_RATE_EXPORTS`. Journal : « Export complet » au début, écrit dans la transaction de la copie (l'archive le
  contient), « Export complet envoyé » quand le serveur a fini de l'envoyer, avec la taille et le SHA-256 de l'archive, ou « interrompu » / « échec » ;
  nombres et empreinte montrés aux seuls gestionnaires (`archiveL`, `src/lib/queries.ts`), aucun document nommé.
- **Commandes** (`scripts/codex-export.mjs`) : `npm run export`, serveur arrêté, sous le verrou du dossier de données
  (`codex.lock`, type `export` ajouté à `backup-core.mjs`), archive écrite sous un nom provisoire, relue puis nommée,
  dans `.data-exports/` par défaut (ignoré par git, dossier `0700`, archive `0600`) ou `--out` ; journalisée sous
  l'acteur Codex. `npm run export:check -- <archive>` relit une archive. Fichiers SharePoint jamais lus par la commande,
  signalés.
- **Docs** : format, champs, correspondance avec `POST /api/import` et boucle de réimport dans `docs/export.md` ;
  README (section « Export complet »), `docs/api.md`, `docs/sauvegarde.md` (export ≠ sauvegarde), `.env.example`
  (aucune variable nouvelle), M22 de l'audit, point 17 de `reste-a-faire.md`, choix non validés dans `decisions.md`.
- *Vérifié* : `npm test` (65 fichiers, 1 071 tests dont un sauté), `npm run typecheck`, `npm run lint`, `npm run
  build`. Tests : `tests/unit/export-core.test.ts` (ZIP écrit et relu, Zip64 par seuils abaissés, archive altérée,
  noms des champs et des fichiers, vue d'import), `tests/integration/full-export.test.ts` (archive relue, comptes et
  empreintes comparés à la base, instantané, droits, limite de débit, interruption, réimport d'un document dans une
  base vide par l'import : même identifiant, même révision, même fichier), `tests/integration/export-command.test.ts`
  (commande, vérification, refus serveur en marche, dossier par défaut). Ouvrir l'export aux administrateurs non
  gestionnaires, retirer l'entrée de début du journal ou fausser l'empreinte des éléments fait échouer chacun trois ou
  quatre tests. Exécution réelle, `npm run dev` sur une base neuve, deux documents importés avec fichier (dont un
  confidentiel en brouillon) : gcomte, jwagner et jholt reçoivent 403 (`GET` et `HEAD`) et ne voient pas le lien ; en
  cbardet, dans Chromium, lien visible (FR et EN), archive téléchargée (`codex-export-….zip`, 296 Ko) ; `unzip -t`,
  `zipfile` de Python, `sha256sum -c SHA256SUMS` après extraction et `npm run export:check` la trouvent intacte ; deux
  fichiers sous `files/PID-HLT-026-002/PID-HLT-026-002_C.1.pdf` et `files/PRO-ACH-0001/PRO-ACH-0001_A.1.pdf`, le
  brouillon confidentiel compris ; le SHA-256 inscrit au journal est celui du fichier téléchargé. `npm run export`
  refusé tant que le serveur tourne, puis, serveur arrêté, archive écrite et vérifiée dans `.data-exports/`. Base
  remise à zéro, la boucle de `docs/export.md` réimporte les deux documents sous leurs identifiants (même révision,
  même statut, fichier identique octet pour octet), puis répond 409 `duplicate` au second passage. `npm run start` :
  même téléchargement (200, `application/zip`), 403 pour jholt. Aucune erreur de serveur.
- **Relecture** : (1) la fin d'export est inscrite quand le serveur a fini d'envoyer l'archive, pas quand le client l'a
  reçue : une petite archive coupée après l'envoi était présentée comme « terminée ». L'entrée s'appelle désormais
  « Export complet envoyé », et `docs/export.md`, `decisions.md` et le README disent qu'un fichier téléchargé se
  vérifie par `npm run export:check` ou par son SHA-256. (2) `docs/exploitation.md` cite le `scope` `export`, la
  commande `npm run export` parmi les causes d'un `database` en échec et ses messages en texte ; les deux
  avertissements de `export-core.mjs` (fin non journalisée, tables temporaires non supprimées) passent, depuis
  l'application, par le journal technique structuré (option `warn`), testé.
- **Reste** (à l'utilisateur, M22) : délai de reprise, perte de données tolérée, hébergement, chiffrement et lieu de
  conservation des exports, export programmé ; contrat de reprise par l'import des révisions antérieures, des liens et
  des états (O-11) ; fichiers SharePoint (O-01).

### Bilan du lot 7

Huit étapes, huit points ou groupes de points de [reste-a-faire.md](reste-a-faire.md) (24, 25, 32, 64, 46, 36, 48, 49,
37, 61, 58, 62, 17), tous développables sans décision de l'utilisateur. Ensemble, ils rendent Codex exploitable par
une équipe informatique : en-têtes de sécurité et limites de débit (étape 1), contrôle des fichiers déposés et
antivirus (2), fichiers servis en flux et nettoyage des orphelins (3), sauvegarde et restauration (4), journal
technique, santé et contrôle de la configuration (5), administration complète du registre et de l'organisation (6,
7), export complet pour la réversibilité (8). Aucune question ouverte n'a été tranchée : chaque protection a une
configuration par défaut qui fonctionne en local (`npm run dev`, app Mac), décrite dans `.env.example` et le README, et
chaque choix qui dépend d'une question ouverte (O-01 SharePoint, O-02 authentification, hébergement et M22, A05 droits,
O-04 organigramme, O-09, O-11) prend l'option la plus prudente et figure dans « Choix de l'assistant non validés
explicitement » de [decisions.md](decisions.md).

## 17. Lot 8 (17 oct.)

Suite des points « développables maintenant » de [reste-a-faire.md](reste-a-faire.md), mêmes règles que les lots 6 et
7 : une étape par point ou groupe de points, relue avant son commit ; aucune question ouverte n'est tranchée, un choix
qui en dépend prend l'option la plus prudente et est consigné dans « Choix de l'assistant non validés explicitement »
de [decisions.md](decisions.md).

| Étape | Commit | Points | Ce qui change | Choix prudents |
|---|---|---|---|---|
| 1. Empreintes SHA-256 | `a44601a` | 31 | Empreinte calculée sur les octets reçus à chaque dépôt et import, gardée sur la version de travail ; affichée (Révisions, comparaison, fiche de visa) ; vérification d'intégrité depuis Administration et par `npm run integrity` ; téléchargement complet vérifié au passage ; avertissement de doublon ; colonne et fichiers altérés dans l'export complet | Vérification à la demande seulement (planification, point 38, et alertes, M22, non décidées) ; rien n'est réparé ni supprimé ; empreinte d'un fichier ancien établie à la première vérification ; doublon non bloquant, ne nommant que ce que l'utilisateur peut avoir (D-14) ; début de l'empreinte au journal pour le seul cercle de rédaction |
| 2. Consultations et historique des métadonnées | `cea4652` | 28, 22 | Ouverture d'une fiche et fichier affiché dans l'aperçu journalisés, dédoublonnés par demi-heure ; onglet Historique de la fiche en trois vues (activité, métadonnées avant → après, consultations) ; consultations filtrables dans le journal, retirées des fils d'activité | Tous les niveaux de confidentialité journalisés ; fiche journalisée par le navigateur une fois affichée, jamais au préchargement ; lecteurs du journal inchangés (D-14 ; restreindre la liste des consultants relève de M05) ; pas de réglage de la fenêtre par variable |
| 3. Auteur désigné et modèles rattachés aux types | `b13794a` | 4, 6 | Auteur choisi parmi les personnes du groupe ou saisi en texte libre (MET-10), partout le même (fiche, recherche, exports) ; types cibles d'un modèle FRM (FON-12), réglés depuis sa fiche ou Administration, proposés en tête de « Nouveau depuis un modèle » | L'auteur ne donne aucun droit et n'entre pas dans le cercle de rédaction ; créateur par défaut ; aucun refus d'un modèle prévu pour d'autres types ; type visé par un modèle compté comme utilisé |
| 4. Conservation par document et dates d'événement | `b6e825c` | 7, 18 | Date de l'événement déclencheur (fin de vie de l'actif, départ du salarié) saisie et journalisée ; classe de conservation modifiable par document (dérogation) et retour à la règle du type ; répercussion facultative de la règle d'un type sur ses documents, avec aperçu ; onglet Archivage › Dates d'événement | Fin de projet non saisissable (attend Keystone, O-03) ; durée nulle laissée « à fixer » (O-07) ; répercussion décochée par défaut, documents gelés laissés tels quels ; rien n'est archivé ni détruit automatiquement (O-07, M03) |
| 5. Pages d'erreur traçables et index de base | `c80d6ae` | 44, 39 | `global-error.tsx`, `error.tsx` (avec `retry`), `not-found.tsx` dans le style Nocturne, FR/EN, avec une référence reliée au journal technique et jamais le message ; document introuvable en 404 ; référence affichée par les dialogues et boutons d'action ; 17 index pour les requêtes ciblées et les cascades, mesurés avant et après | Référence = identifiant de requête pour une action, digest de Next.js pour un rendu ; erreur du navigateur non remontée au serveur (O-02) ; page d'erreur racine en deux langues ; document non lisible toujours « pas d'accès » en 200 ; coût des index à l'écriture accepté, aucun index pour les listes qui chargent encore toute la table |

### 17.5 Pages d'erreur traçables et index de base

Points 44 et 39 de [reste-a-faire.md](reste-a-faire.md), revérifiés au commit `b6e825c` : seul `src/app/error.tsx`
existait (avec `reset`, et le message de l'erreur quand elle n'avait pas de digest) ; une URL inconnue affichait la page
404 de Next.js en anglais, un document introuvable un message en HTTP 200 ; les dialogues et boutons d'action
remplaçaient toute erreur par « Une erreur est survenue », sans référence. Le journal technique du lot 7 notait déjà le
digest des erreurs de rendu, mais aucun écran ne le montrait, et une action en échec n'avait que son identifiant de
requête, que le navigateur ne recevait pas. Côté base, seuls `audit_log_at`, `audit_log_doc`, `working_versions_sha256`
et les index uniques existaient.

- **Référence d'erreur** (`src/lib/errors.ts`) : Next.js garde le digest qu'une erreur porte déjà et le transmet au
  navigateur, jamais le message en production. `traceAction` (`src/lib/log.ts`) pose donc l'identifiant de requête de
  l'action comme digest (`withDigest`) : la référence affichée est celle de l'entrée « action failed ». Pour un rendu,
  c'est le digest calculé par Next.js, que `logRequestError` écrit dans `err.digest`.
- **Écrans** : `global-error.tsx` (erreur du layout racine : base injoignable, migration en échec) a ses propres
  `<html>` et `<body>`, importe Nocturne et Inter et montre les deux langues ; ses textes viennent de
  `src/lib/i18n-errors.ts`, repris par les dictionnaires de `src/lib/i18n.ts`. `error.tsx` passe à `retry` (qui
  recharge l'écran depuis le serveur). `not-found.tsx` et `documents/[id]/not-found.tsx` s'affichent dans le shell, en
  404. `useSubmit`, `ActionButton`, `CommentBox` et `DueTable` affichent « Une erreur est survenue · Réf. … ».
- **Vérification** : en développement et en build de production (`next start`), avec une route de test temporaire,
  retirée avant le commit : rendu en échec (500, référence = digest de l'entrée du journal), action en échec (toast
  avec l'identifiant de requête de l'entrée « action failed »), base au schéma périmé (global-error, 500, référence
  retrouvée dans le journal), adresse et document inconnus (404, FR et EN). Aucun message interne dans le HTML.
- **Index** (`src/db/schema.ts`, migration unique régénérée) : GIN `jsonb_path_ops` sur `documents.aliases`, utilisé
  par `getDoc`, qui résout un ancien identifiant par `aliases @>` au lieu de charger toute la table ; par document et
  par clé de fichier sur `working_versions` ; par document et par révision sur `workflows` ; par personne sur
  `workflow_steps` et `document_readers` (sous-requêtes de visibilité) ; par circuit sur `workflow_comments` ; par
  document et par document de remplacement sur `change_requests` ; par extrémité sur `document_links` ; par projet et
  par document sur `project_expected` ; par personne, par action et par révision sur `audit_log`.
- **Mesures** (script hors dépôt, PGlite en mémoire, 5 000 documents, 5 714 révisions, 17 142 versions, 5 496
  circuits, 125 001 entrées de journal ; médiane de 15 exécutions) :

| Requête | Avant (ms) | Après (ms) |
|---|---|---|
| Document par ancien identifiant (table entière → `aliases @>`) | 198 | 1,1 |
| Versions d'un document | 2,7 | 0,6 |
| Version par clé de fichier (`nameStoredFile`) | 3,1 | 0,3 |
| Circuits d'un document / d'une révision | 1,2 / 1,1 | 0,5 / 0,4 |
| Journal d'une révision (fiche de visa) | 27,3 | 0,8 |
| Dernier contrôle d'intégrité | 13,3 | 0,6 |
| Journal filtré par personne (500 dernières entrées) | 23,1 | 5,9 |
| Journal filtré par action (500 dernières entrées) | 7,3 | 6,0 |
| Lecteurs désignés / étapes d'une personne | 2,2 / 3,0 | 0,6 / 1,1 |
| Documents lisibles par une personne (`readableSql`, compte) | 9,9 | 7,0 |
| Reclassement d'un document (cascades) | 6,0 | 1,1 |
| Écriture de 1 000 entrées du journal | 17,7 | 27,2 |

Les autres requêtes ciblées (demandes, liens, attendus d'un projet) restent sous la milliseconde sur ce volume. Les
écrans qui chargent des tables entières (`listDocs`, `listWorkflows`, index d'accès) n'en profitent pas encore : c'est
le point 47 de reste-a-faire.md (« Chaque navigation recharge toutes les tables »).

### Bilan du lot 8

Cinq étapes, neuf points de [reste-a-faire.md](reste-a-faire.md) (31, 28, 22, 4, 6, 7, 18, 44, 39), tous développables
sans décision de l'utilisateur : intégrité des fichiers (étape 1), traçabilité des lectures et des métadonnées (2),
métadonnées du deck encore manquantes (auteur, types cibles des modèles, 3), conservation document par document (4),
erreurs traçables et index (5). Aucune question ouverte n'a été tranchée ; chaque choix qui en dépend (O-01, O-02, O-03,
O-07, O-09, M03, M05, M22) prend l'option la plus prudente et figure dans « Choix de l'assistant non validés
explicitement » de [decisions.md](decisions.md).

## 18. Lot 9 (17 oct.)

Suite des points « développables maintenant » de [reste-a-faire.md](reste-a-faire.md), mêmes règles que les lots 6 à
8 : une étape par point ou groupe de points, relue avant son commit ; aucune question ouverte n'est tranchée, un choix
qui en dépend prend l'option la plus prudente et est consigné dans « Choix de l'assistant non validés explicitement »
de [decisions.md](decisions.md).

| Étape | Commit | Points | Ce qui change | Choix prudents |
|---|---|---|---|---|
| 1. Rechargement en boucle en développement et lectures ciblées par navigation | commit « Lot 9, étape 1 », qui suit `c80d6ae` | bogue, 47 | Cache disque de Turbopack désactivé pour `next dev` ; chaque écran lit ce qu'il montre au lieu de tous les documents et circuits, à l'identique pour chaque utilisateur | Cache de développement désactivé plutôt que montée de version de Next.js ; « Mis en vigueur cette semaine » compté sur toute la semaine ; fenêtres de l'activité récente gardées (60 et 500 entrées) |
| 2. Police locale, migrations incrémentales, amorçage séparé et application du registre | commit « Lot 9, étape 2 », qui suit `7d3db2e` | 42, 41, 45, 60 (et 52 en partie) | Inter servie depuis le dépôt (build sans réseau) ; migrations versionnées à partir de `0000_init`, contrôlées et précédées d'une sauvegarde ; `CODEX_SEED=demo|minimal` ; `npm run registry:apply` | Mêmes fichiers de police que Google, à l'octet ; refus d'une base d'un autre schéma, sauvegarde obligatoire avant migration ; démo par défaut partout, administrateur initial fictif en minimal ; simulation par défaut, l'administration l'emporte, codes figés, types retirés désactivés |
| 3. Postgres serveur en option et mesures sur gros volume | commit « Lot 9, étape 3 », qui suit `98b45db` | 51 (en partie), 56 | `DATABASE_URL` : serveur PostgreSQL 18 par node-postgres, mêmes migrations et compléments sous verrou consultatif ; suite de tests rejouée sur un serveur (`npm run test:pg`, CI) ; `npm run seed:large` et `npm run perf`, mesures dans `docs/performances.md` | PGlite par défaut ; PostgreSQL 18 exigé ; référentiel minimal par défaut sur un serveur ; sauvegarde, restauration, `export` et `integrity` en ligne de commande refusés sur un serveur ; migration d'une base serveur seulement avec `CODEX_MIGRATION_BACKUP=off` ; `READ COMMITTED` ; volume dans une base à part |
| 4. Planificateur interne et signature des échanges entre serveurs | commit « Lot 9, étape 4 », qui suit `ccf5940` | 38 (en partie), 23 | Mise en vigueur différée lancée par le serveur toutes les 5 minutes, tâches d'exploitation réglables ; signature HMAC avec fenêtre et anti-rejeu sur le webhook Vigie et l'import, rotation par `…_NEXT`, registre protégeable par jeton | Tâches d'exploitation désactivées par défaut ; pages qui ne mettent plus en vigueur tant que le planificateur le fait ; aucune relance ni envoi sortant ; registre ouvert par défaut ; tout ce qui est défini est exigé ; fenêtre de 5 minutes |
| 5. Comparaison du contenu des versions et aperçu des fichiers Office | commit « Lot 9, étape 5 », qui suit `3586ab8` | 14, 15 | « Comparer » montre, sous les attributs, le texte des deux versions comparé ligne à ligne (PDF, Word, Excel, PowerPoint, OpenDocument, texte), lu sur le serveur sous les droits du fichier ; aperçu PDF des fichiers Office par LibreOffice sans interface ou Gotenberg, converti à la première consultation, gardé (table `version_previews`, migration `0002_apercu_office`) et servi par la route fichier (`?preview=pdf`) | Texte et non visuel ; formats Office 97-2003 non lus ; bornes de taille, de temps et de lignes ; aperçu désactivé sans outil configuré, conversion à la demande plutôt qu'au dépôt, échec retenté après une heure, rendus dans le stockage local même avec SharePoint, sauvegardés mais hors de l'export complet ; ni PDF/A ni filigrane (M12) |
| 6. Reprise des documents d'une personne qui part et vocabulaires contrôlés | commit « Lot 9, étape 6 », qui suit `5f92467` | 19, 59 | Administration › Reprise (départ) : simulation puis transfert journalisé, à un remplaçant choisi, des documents et processus possédés, révisions à rédiger, étapes en attente, titulariats et lectures désignées ; réassignation d'une étape par un gestionnaire ; langue contrôlée ; référentiels des organismes sources et des mots-clés (tables `source_orgs`, `keyword_terms`, migration `0003_vocabulaires` avec reprise), autocomplétion et ajout confirmé, Administration › Vocabulaires (ajout, renommage, fusion, sous-types hors liste) | Aucun remplaçant proposé, aucun compte désactivé ; gestionnaires documentaires seulement ; simulation = transfert annulé, empreinte exigée ; documents verrouillés repris, étapes figées par un verrou laissées ; documents gardant le nom du terme en texte ; nouveau terme confirmé dans les formulaires, ajouté à l'import ; termes proposés selon la lecture (D-14) ; sous-types non fermés ; gel juridique respecté au renommage |
| 7. Finitions de l'interface : phases, Restaurer, compteur des modèles, écarts avec la maquette, bilinguisme | commit « Lot 9, étape 7 », qui suit `2d36d97` | 63, 64 (vérifié), 65, 66, 67, 68 | Phases Keystone en frise compacte ; « Restaurer » une version de travail du brouillon (`restoreWorkingVersion`) ; `documents.template_id` et compteur d'utilisations (migration `0004_modele_source` avec reprise sûre) ; onglet Projet toujours présent et « Rattacher à un projet » ; « Déposer » dans l'explorateur prérempli par l'arbre ; fondement de conservation en anglais, phases en anglais, détail du journal structuré et traduit, titres de page par écran et par fiche | Frise sans libellés sauf la phase courante, libellés EN des phases provisoires ; restauration limitée au brouillon ouvert, journalisée comme une version de travail ; compte limité aux documents lisibles, reprise seulement sur trois indices concordants ; projet non prérempli depuis l'arbre ; aucun fondement traduit, français suivi de « (FR) » ; anciennes entrées du journal non réécrites ; titre générique pour une fiche illisible ou introuvable |
| 8. Accessibilité, aide aux utilisateurs et documentation alignée sur le code | commit « Lot 9, étape 8 », qui suit `65af2e6` | 55, 69, 53, 54 | Lien « Aller au contenu » ; contrôle axe-core `npm run a11y` (30 écrans, 20 dialogues, base de démo jetable) ajouté à la CI ; contrastes et violations corrigés (82 éléments sérieux et 52 modérés ou mineurs → 0, FR et EN) ; page `/aide` bilingue et aides contextuelles des dialogues ; README, avancement, audit, décisions et modèle cible relus contre le code | WCAG 2.2 AA comme démarche de qualité, sans RGAA ; seules les couleurs qui échouaient changent, d'un cran, Nocturne intact ; titres `<h1>`/`<h2>` au même rendu ; aide limitée à ce que l'application fait, simulations signalées, liens selon le rôle ; notes de conception gardées (O-02) ; formation et pilote laissés à M14 |
| 9. Restes développables sans décision | commits « Lot 9, étape 9 », qui suivent `d0ed61e` | 43, 52, 47, 50, 51, 36, 46, 57 (restes) | Version de Node et audit des dépendances dans la CI ; index d'accès limité à la personne, Validations paginé en base ; `npm run db:migrate`, verrou du document dans les transactions qui relisent avant d'écrire ; reprise des noms provisoires ; aperçu paginé sans retéléchargement ; tests des réponses d'erreur des routes, `npm run e2e` | Version de référence 22 et tests sous Node 20.19 ; exception d'audit écrite et motivée, seulement pour un outil sans correction publiée ; aucun cache entre requêtes ; pages de 50 circuits ; le démarrage migre toujours, verrou de ligne plutôt que `SERIALIZABLE`, plusieurs processus laissés en limite ; noms provisoires : même délai de grâce et mêmes droits que les orphelins, tâche désactivée par défaut ; copie en mémoire plutôt que cache du navigateur ; un seul parcours, Chromium seul |

### 18.1 Rechargement en boucle en développement et lectures ciblées

**Le bogue.** Sous `npm run dev`, une page ouverte dans Chromium se rechargeait environ trois fois par seconde, sans
qu'aucun fichier source ne change ; la build de production n'était pas touchée. Le journal du serveur alternait
« GET / 200 » et « ✓ Compiled in 1ms ». Reproduit au commit `b6e825c` et au commit `c80d6ae`, mais pas à chaque
démarrage : seulement au premier démarrage après un changement des sources fait serveur arrêté (passage d'un commit à
un autre), environ un démarrage sur six, la boucle s'arrêtant d'elle-même après quelques secondes à une minute. Elle
n'apparaît jamais sur des sources inchangées (9 écrans × 4 personnes, ouverts à la suite pendant plusieurs minutes), ni après
`rm -rf .next`.

- **Cause** (relevée en journalisant, dans une copie modifiée du client de Next.js, chaque rechargement et sa raison,
  et les messages du WebSocket de rechargement à chaud) : à chaque nouvelle page, l'abonnement de rechargement à chaud
  à la liste de fragments du runtime client (React, client Next.js, outils de développement) recevait d'emblée une
  mise à jour de type `restart`, qui fait avancer la version de rechargement du serveur (« Compiled in 1ms ») ; le
  second abonnement de la même page, envoyé avec l'ancienne version, était alors refusé par « HMR hash mismatch », et
  le serveur demandait à la page de se recharger (`reloadPage`). La page rechargée s'abonnait de nouveau, et ainsi de
  suite. Ce « restart » vient de l'état que Turbopack restaure de son cache disque de développement
  (`.next/dev/cache/turbopack`, actif par défaut depuis Next.js 16) quand les sources ont changé depuis : il ne
  survient qu'au premier démarrage qui restaure un tel cache, jamais à froid.
- **Pistes écartées** : écritures sous le dossier surveillé (base `.data`, journal des consultations, `next typegen`
  et `npm run build` lancés pendant que le serveur tourne : aucun « Compiled ») ; `refresh()` en boucle (aucune requête
  RSC pendant la boucle, la consultation de fiche n'appelle pas `refresh()`) ; nonce de la CSP (aucune erreur
  d'hydratation) ; WebSocket bloqué par la CSP (« [HMR] connected » à chaque page). Le JavaScript de Next.js 16.4.2
  (version que le serveur annonce) ne change rien à ce mécanisme.
- **Correction** : `experimental.turbopackFileSystemCacheForDev: false` dans `next.config.ts`. Chaque démarrage du
  serveur de développement part d'un état neuf (environ 3 s de compilation à la première visite d'un écran) ; la build
  garde son cache. Choix consigné dans [decisions.md](decisions.md).
- **Vérification** (Chromium sans interface, `playwright-core`) : avant, 4 boucles relevées sur une vingtaine de
  premiers démarrages après changement de commit (15 à 23 chargements de « / » en 4 à 6 s au lieu d'un) ; après, même
  recette (passage entre `cea4652`, `b6e825c` et `c80d6ae` avec une modification nouvelle à chaque fois, nouvelle base),
  9 démarrages sur 9 sans rechargement ni « Compiled ». Faute d'affichage dans le conteneur, pas d'essai dans un
  navigateur avec interface ; le mécanisme ne dépend pas du navigateur.

**Le point 47.** Revérifié au commit `c80d6ae` : `listDocs` et `listWorkflows` étaient déjà en cache par requête, mais
le layout lisait encore tous les documents, et « À traiter » tous les documents et tous les circuits avec leurs étapes
et commentaires ; l'accueil, Archivage, les pages département et la fiche relisaient tous les documents.

- **Lectures ciblées** (`src/lib/queries.ts`) : `visibleWhere` lit, en SQL et avec les règles de `readableSql`, les
  seuls documents qu'une condition choisit, dans l'ordre de `listDocs`, et ne lit en entier que ceux-là. Dessus :
  `recentDocs`, `dueDeadlines` (documents qui peuvent avoir une échéance sous 90 jours : expiration, revue, fin de
  conservation par déclencheur, avec un jour de marge ; `deadlines` tranche), `departmentDocs`, `eventDocs`,
  `archivedDocs`, `typeCounts`, `readableBriefs` (cinq champs pour les dialogues de la fiche), `projectDocs`.
  `workflowsWhere` donne les circuits choisis comme `listWorkflows`, qui n'en est plus que le cas « tous ».
  `myActions` choisit les circuits en cours où l'utilisateur a une étape, les révisions en rédaction qui peuvent
  l'attendre (auteur désigné, propriétaire, rédacteur renvoyé par un circuit) et leurs documents, puis `actionsAmong`
  applique les règles d'avant. `recentActivity` lit l'activité par lots dans la même fenêtre qu'avant ;
  `inForceThisWeek` compte la semaine entière du journal par un agrégat SQL. L'index d'accès ne lit plus que les
  circuits en cours (les autres n'ouvraient déjà aucun brouillon).
- **Équivalence** : tests/integration/targeted-reads.test.ts compare chaque lecture à l'ancien calcul sur `listDocs`
  et `listWorkflows`, sur la démo et sur des documents variés (conservation, dates d'événement, entrées en vigueur
  autour de minuit, circuits renvoyés à un autre rédacteur) ; chaque comparaison doit rencontrer des éléments, et les
  mutations essayées (marge de conservation, rédacteur renvoyé, révision d'une entrée hors du cercle) le font échouer.
  Dans Chromium, sur une base de 3 843 documents (la démo et 60 copies de chacun de ses documents, 6 100 révisions,
  610 circuits, 10 248 entrées de journal), 16 écrans (accueil, Archivage et ses onglets, trois départements, quatre
  fiches, Validations, Explorateur, Recherche) pour cbardet (gestionnaire), jwagner (collaborateur et auditeur),
  gcomte et lfabre (validateurs), jholt (auditeur) : texte de la page, cloche, modèles, listes de remplacement et
  « À traiter » identiques avant et après (96 écrans), et HTML de même taille.
- **Mesures** (build de production, `next start`, même base ; médiane de 5 requêtes, en secondes) :

| Écran | cbardet avant | après | jwagner avant | après | gcomte avant | après | jholt avant | après |
|---|---|---|---|---|---|---|---|---|
| Accueil | 0,85 | 0,27 | 0,78 | 0,26 | 0,81 | 0,27 | 0,75 | 0,24 |
| Archivage | 0,79 | 0,25 | 0,75 | 0,19 | 0,73 | 0,22 | 0,78 | 0,21 |
| Département QUA | 0,73 | 0,29 | 0,76 | 0,26 | 0,70 | 0,26 | 0,78 | 0,25 |
| Fiche PRO-QUA-0001 | 0,83 | 0,30 | 0,74 | 0,26 | 0,74 | 0,25 | 0,75 | 0,23 |
| Fiche BOM-HLT-026-001 (projet) | 1,10 | 0,39 | 1,08 | 0,47 | 1,10 | 0,41 | 1,16 | 0,39 |
| Validations | 0,71 | 0,45 | 0,74 | 0,51 | 0,74 | 0,44 | 0,72 | 0,14 |
| Explorateur | 0,81 | 0,21 | 0,71 | 0,22 | 0,79 | 0,19 | 0,80 | 0,19 |
| Recherche | 0,87 | 0,26 | 0,86 | 0,29 | 0,82 | 0,22 | 0,83 | 0,21 |

  Validations lit encore tous les circuits : il ne gagne que le layout. Restent au point 47 : l'index d'accès (lecteurs,
  révisions ouvertes, titulaires de fonctions lus à chaque requête), /validations, la liste des documents lisibles
  que la fiche transmet à ses dialogues.
- **Vérifié** : `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`.

### 18.2 Police locale, migrations incrémentales, amorçage séparé, registre sur une base existante

Les quatre constats ont été revérifiés au commit `7d3db2e` : `next/font/google` dans `layout.tsx` et
`global-error.tsx` ; une seule migration, `drizzle/0000_init.sql` (commit `c80d6ae`), égale au schéma
(`drizzle-kit generate` : « No schema changes ») ; `seed()` amorce référentiel et démonstration ensemble dès que `users`
est vide ; aucune commande pour appliquer `src/db/registry.ts` à une base existante.

- **Police (point 42).** Les sept sous-ensembles woff2 d'Inter que `next/font/google` téléchargeait (Inter 4.001,
  Google Fonts v20, axe de graisse 100 à 900) sont dans `src/fonts/inter/`, identiques à l'octet à ceux de
  `.next/static/media`, avec la licence OFL 1.1. `src/fonts/inter.ts` les déclare par `next/font/local`, un appel par
  sous-ensemble (la fonction n'accepte pas de plage Unicode par fichier), avec les plages de Google ; le latin seul est
  préchargé et porte la variable `--font-inter`. Turbopack nomme la famille de la variable d'après la constante
  (`inter`), que CSS rapproche des faces `Inter` sans tenir compte de la casse. La police de secours reste l'Arial
  ajustée de `next/font/google` (`Inter Fallback`, mêmes valeurs, dans `globals.css`) : celle que `next/font/local`
  calcule depuis le fichier latin différait légèrement (89,79 % au lieu de 90,44 % de hauteur, 107,89 % au lieu de
  107,12 % de taille), et elle dessine les caractères qu'aucun sous-ensemble ne couvre (flèches). Vérifié : CSS
  produit (8 `@font-face`), fichier servi (48 432 octets), `npm run build` avec un proxy réseau inaccessible.
- **Migrations incrémentales (point 41).** `0000_init` est figée. `src/db/migrations.ts` lit les migrations
  appliquées (`drizzle.__drizzle_migrations`) et celles du code (journal, SHA-256 comme drizzle) : la base doit avoir
  appliqué les premières migrations du code, les mêmes fichiers, dans l'ordre. Sinon le démarrage s'arrête avant toute
  écriture (drizzle seul ne compare que des instants : il aurait rejoué `0000_init` sur une base faite par une version
  régénérée, ignoré une migration d'une autre branche datée plus tôt, ou rien dit d'une base faite par un Codex plus
  récent). S'il manque des migrations à une base qui a des données, `src/db/index.ts` écrit d'abord une sauvegarde
  (`createBackup` de `backup-core.mjs`, origine application, par Codex) et ne démarre pas s'il n'y arrive pas
  (`CODEX_MIGRATION_BACKUP=off` pour passer outre, signalé par le contrôle de la configuration) ; drizzle applique
  ensuite les migrations en une transaction, puis l'entrée « Sauvegarde créée » est journalisée avec « migration … ».
  Fonctions et déclencheurs restent hors migrations, posés à chaque démarrage. `npm run db:check` (`drizzle-kit
  check`) entre dans la CI. `tests/integration/migrations.test.ts` : diff vide entre le schéma et le dernier
  instantané ; une base créée par la chaîne de migrations et une base créée d'un coup depuis le schéma
  (`generateMigration` de `drizzle-kit/api`) ont les mêmes colonnes, contraintes et index dans le catalogue Postgres
  (`pushSchema` et `drizzle-kit pull`, essayés d'abord, donnent des faux écarts ou perdent les paramètres des requêtes
  sur PGlite) ; refus d'une base d'un autre schéma, laissée intacte.
- **Essai d'une migration incrémentale** (copie du dépôt dans le dossier temporaire de la session, pas dans le dépôt) :
  base de démo créée, colonne `users.nickname` ajoutée au schéma, `drizzle-kit generate --name factice` →
  `0001_factice.sql` ; `drizzle-kit check` et les tests de migration passent ; au démarrage, sauvegarde
  (`backup written before migrating`), migration appliquée, entrée « Sauvegarde créée · migration 0001_factice » ; le
  test échoue si l'on ajoute une colonne au schéma sans migration, ou si l'on retouche le SQL de `0001_factice` ;
  `npm run restore -- latest --replace` remet la base d'avant (`backup:check` : « migrations appliquées au démarrage :
  0001_factice »).
- **Amorçage (point 45).** `CODEX_SEED` (`src/lib/seed-mode.ts`) : `demo` par défaut, `minimal` sur demande, autre
  valeur refusée. `seed()` pose le référentiel commun (`seedReference` : départements et sites provisoires, acteurs
  système, familles, types, fonctions, matrice), puis la démonstration ou l'administrateur initial `admin`. Une base
  n'est amorcée que sans personne ni type. Démarrages réels : `npm run db:reset` puis `npm run dev` (« new database
  seeded mode=demo ») et `CODEX_SEED=minimal npm run dev` (« mode=minimal » ; accueil, explorateur, recherche,
  validations, archivage, administration et ses onglets, page QUA en 200, ouverts sur « Administrateur Codex »).
- **Registre sur une base existante (point 60).** `npm run registry:apply` (`scripts/codex-registry.mts`, par `tsx`,
  désormais en devDependency ; règles dans `src/lib/registry-apply.ts`, valeurs du journal partagées avec les Server
  Actions dans `src/lib/journal-values.ts`) : simulation par défaut, `-- --apply` après sauvegarde. L'historique de
  l'Administration est relu dans le journal (créations, renommages, suppressions, champs modifiés, par une personne) ;
  ce qu'elle a réglé l'emporte. Codes jamais renommés ni supprimés ; type absent désactivé ; collision de code
  refusée ; réglage plus étroit que les documents existants retenu ; portée d'une fonction à titulaires gardée ;
  chaque changement journalisé par Codex. Essayé dans la copie : libellé de PRO changé, type ajouté, type GA retiré
  (désactivé, ses documents gardés), refus tant que le serveur tourne ou que la base n'a pas les migrations, puis plus
  rien à faire au second passage.
- **Pour l'utilisateur sur son Mac** : rien à faire si sa base a été créée ou réinitialisée depuis le commit `c80d6ae`
  (lot 8, étape 5) ; sinon un dernier `npm run db:reset` (ou, pour l'app, la suppression de son dossier de données),
  le démarrage le lui dit. Ensuite, plus de réinitialisation à chaque changement de schéma.
- **Vérifié** : `npm test`, `npm run typecheck`, `npm run lint`, `npm run db:check`, `npm run build` (aussi sans
  réseau), démarrages réels en mode démo et en mode minimal.

### 18.3 Postgres serveur en option et mesures sur gros volume

Points 51 et 56 de [reste-a-faire.md](reste-a-faire.md), vérifiés au commit `98b45db` : seul pilote `drizzle-orm/pglite`
(`src/db/index.ts`), pas de `DATABASE_URL`, aucun générateur de volume ni script de mesure (constats exacts, sauf que les
recherches et filtres passaient déjà par SQL depuis le point 50).

- **Postgres serveur (point 51, en partie ; [postgres.md](postgres.md)).** `DATABASE_URL` choisit un serveur ; sans
  elle, rien ne change. `src/db/sql-client.ts` donne aux deux moteurs la même connexion brute (`query`, `exec`,
  `transaction`, `close` : l'interface de PGlite que le code utilisait), le pool node-postgres et ses réglages de
  lecture (`int8` en nombre, dates à minuit UTC, marque d'ordre d'octets retirée, comme PGlite), et met en file les
  requêtes envoyées en même temps sur une connexion (node-postgres 9 les refusera). `openDb` (`src/db/index.ts`) ouvre
  PGlite ou un serveur : version 18 exigée (`pg_unicode_fast`), `pg_trgm` créée, migrations, fonctions et
  déclencheurs posés sous `pg_advisory_lock`, amorçage d'une base neuve sous un second verrou. Ce qui suppose PGlite
  refuse proprement sur un serveur : « Sauvegarder maintenant » (message traduit), `npm run backup`, `restore`,
  `export`, `integrity` ; la migration d'une base qui a des données attend `CODEX_MIGRATION_BACKUP=off`.
  `registry:apply` marche sur un serveur (`--apply --no-backup`). L'export complet passe en `REPEATABLE READ` sur une
  connexion gardée (ses tables temporaires n'existent que sur elle). Le contrôle de la configuration vérifie
  `DATABASE_URL` et `CODEX_DB_POOL_MAX` ; `CODEX_SEED` vaut `minimal` par défaut sur un serveur.
- **Serveur dans le conteneur.** Le paquet Ubuntu donne PostgreSQL 16, sans la collation `pg_unicode_fast` ; le dépôt
  PGDG est inaccessible (proxy). PostgreSQL 18.3 a été lancé depuis les binaires npm `@embedded-postgres/linux-x64`
  (18.3.0-beta.17, hors du dépôt, dans un dossier temporaire), avec ICU 60 et `pg_trgm`.
- **Tests sur serveur.** `CODEX_TEST_DATABASE_URL` : `openDb()` sans dossier ouvre une base neuve sur ce serveur,
  supprimée à la fermeture ; `npm run test:pg` rejoue toute la suite (job « Tests on PostgreSQL 18 » de la CI, service
  `postgres:18`). Les tests de sauvegarde restent sur PGlite (`setupDb({ engine: 'pglite' })`). Premier passage : 5
  échecs, tous corrigés à la source : une marque d'ordre d'octets rendue par node-postgres et retirée par PGlite
  (réglage de lecture ajouté), l'export complet dont les tables temporaires étaient lues par d'autres connexions
  (connexion gardée), un test d'export qui espionnait la connexion du pool, et le test de tri `codex_fr`, qui
  diffère avec l'ICU 60 du serveur d'essai sur l'apostrophe droite et typographique (sauté pour un ICU antérieur à
  Unicode 16, vérifié partout ailleurs). Un second passage a fait apparaître une exception non interceptée de
  l'adaptateur `Readable.toWeb` (« Controller is already closed ») quand une réponse de fichier était annulée pendant
  qu'une écriture du journal la retenait : `src/lib/storage.ts` lit maintenant les fichiers locaux par un flux à la
  demande sur le descripteur ouvert. Résultat : 1 172 tests réussis sur PostgreSQL 18.3 (2 sautés), 1 165 sur PGlite
  (9 sautés, dont les 8 propres au serveur).
- **Concurrence réelle.** `tests/integration/postgres-server.test.ts` tient des transactions ouvertes sur des
  connexions distinctes : second tirage d'un compteur en attente puis numéro suivant, numéro d'une transaction annulée
  rendu, autres compteurs libres, 60 créations simultanées sans doublon et consécutives, ancien max + 1 en échec sur
  la clé primaire, huit imports simultanés d'une référence pour un seul document. Mesure : 1 000 créations envoyées
  ensemble en 3,0 s sur PGlite et 1,15 s sur le serveur (pool de 10), sans doublon ; deux serveurs Codex démarrés en
  même temps sur une base vide n'ont migré et amorcé qu'une fois.
- **Volume et mesures (point 56 ; [performances.md](performances.md)).** `npm run seed:large` (`.data-large/` par
  défaut, refus d'une base qui a des documents sans `--append`) : 10 000 documents, 18 417 révisions, 36 843 versions,
  8 418 circuits, 109 335 entrées de journal en 27 s (PGlite) ou 22 s (serveur). `npm run perf` sur une build de
  production : à 10 000 documents, 0,4 à 0,6 s par écran sur PGlite et 0,2 à 0,3 s sur le serveur (70 à 110 ms sur la
  démo) ; Validations 1,61 s et 0,63 s, export CSV complet 1,13 s et 0,44 s ; 10 requêtes simultanées prennent environ
  10 fois une requête sur les deux moteurs (le processus Node est le goulot) ; 40 à 55 requêtes SQL et plus de 20 000
  lignes lues par écran, surtout pour l'en-tête commun (point 50).
- **Vérifié** : `npm test`, `npm run test:pg` (PostgreSQL 18.3), `npm run typecheck`, `npm run lint`,
  `npm run db:check`, `npm run build` ; démarrages réels `npm run dev` sur PGlite (base de démo) et sur le serveur
  (démo et minimal), `npm run start` sur les deux bases de 10 000 documents ; refus des commandes en ligne avec
  `DATABASE_URL`.
- **Reste** : sauvegarde du serveur et hébergement (M22, O-03) ; migrations lancées au déploiement ; revue des
  transactions en `READ COMMITTED` ; plusieurs processus ; mesures avec les volumes réels (M18, O-11) et un serveur
  distant.

### 18.4 Planificateur interne et signature des échanges entre serveurs

Points 38 et 23 de [reste-a-faire.md](reste-a-faire.md), vérifiés au commit `ccf5940` : `promoteDue` appelé seulement
par `getCtx` (une révision approuvée n'entrait en vigueur à sa date qu'à l'ouverture d'une page), aucune boucle ni
cron ; `GET /api/registry` sans contrôle, `checkBearer` à une seule valeur par variable, aucune signature ni horodatage.
Seule différence : `src/instrumentation.ts` existait déjà (point 37).

- **Planificateur (point 38, en partie ; [exploitation.md](exploitation.md) §4).** `src/lib/scheduler.ts`, démarré
  par `register` une fois la configuration acceptée. Par défaut, une seule tâche : la mise en vigueur différée, toutes
  les 5 minutes (`promoteDue`, plus `applyDuePendingDecisions` qui applique une acceptation de Vigie restée en attente
  sans plus rien pour la retenir) ; `getCtx` ne la fait plus tant que le planificateur du processus la fait
  (`src/lib/scheduler-state.ts`, sur `globalThis` : l'instrumentation est empaquetée à part des pages). Les tâches
  d'exploitation existantes se branchent sans changer : `purgeOrphans`, `checkFilesNow`, `backUpNow`, et l'export
  complet, qui s'écrit maintenant aussi dans un fichier (`writeFullExport` : nom provisoire, relecture, rotation des
  seuls exports du planificateur). Chacune est désactivée tant que sa variable `CODEX_SCHEDULE_*` n'en donne pas la
  fréquence. Une exécution à la fois par tâche : bail dans `scheduler_runs` (migration `0001_planificateur_signatures`,
  première migration incrémentale), pris par une mise à jour conditionnelle, renouvelé pendant l'exécution, repris à
  échéance ; les verrous « déjà en cours » de ces tâches passent sur `globalThis` pour valoir entre l'Administration et
  le planificateur. Journal technique à chaque exécution ; état dans Administration › Journal d'audit › Planificateur.
  Relances, notifications et envois sortants : point d'extension documenté, rien d'inventé (M19, T-01).
- **Signature des échanges (point 23 ; [api.md](api.md), « Authentification »).** `src/lib/server-auth.ts` reprend
  `checkBearer` de `src/lib/importer.ts` et ajoute `checkSignature` : HMAC-SHA256 de `"<horodatage>." + corps brut`,
  fenêtre de 300 s, anti-rejeu dans `integration_signatures` (vidée de ce qui sort de la fenêtre). Le webhook lit son
  corps brut avant de le décoder ; l'import lit le sien (dans la limite de taille) quand un secret est défini, puis
  l'analyse. Variables `…_SECRET`, `…_NEXT` pour la rotation, `CODEX_REGISTRY_TOKEN` (registre ouvert sans elle,
  `Cache-Control: private` avec), `CODEX_SIGNATURE_WINDOW_S` ; règles et constats du contrôle de configuration
  étendus (`src/lib/integration-credentials.ts`, sans base, partagé avec lui).
- **Vérifié** : `npm test`, `npm run typecheck`, `npm run lint`, `npm run db:check`, `npm run build` ; `npm run dev` sur
  une copie de la base de démonstration avec des périodes de 10 à 20 s : migration `0001` appliquée au premier passage
  (sauvegarde avant), révision B approuvée du jour de `AUD-QUA-0001` mise en vigueur sans visite (« Mise en vigueur ·
  B », Codex), passages suivants toutes les 10 s, état visible dans l'Administration ; `curl` sur le webhook : sans
  signature 401 `signature_missing`, signé 200, rejoué 401 `signature_replayed`, expiré 401 `signature_expired`,
  re-signé 200 `alreadyApplied` ; registre 401 sans jeton, 200 `private` avec.
- **Reste** : relances et notifications (M19, canal), envois vers Vigie et Keystone (T-01, O-03, O-10), reprise des
  noms provisoires (point 36), fréquences d'exploitation et heure fixe éventuelle (M22), alignement du contrat de
  signature avec Vigie et Keystone, identifiants OAuth (O-02).

### 18.5 Comparaison du contenu des versions et aperçu des fichiers Office

Points 14 et 15 de [reste-a-faire.md](reste-a-faire.md) (G05, M12), vérifiés au commit `3586ab8` : le dialogue
`Compare` ne montrait que les attributs, aucune bibliothèque d'extraction n'était installée ; un fichier Office
n'avait que « Aperçu indisponible » et le téléchargement, `preview_note` n'était affiché nulle part, et
`working_versions` n'avait pas de place pour un rendu.

- **Comparer (point 14).** `GET /api/documents/[id]/compare?a=&b=` (`src/lib/compare.ts`) relit les deux versions sous
  les règles de la route fichier (`readableVersions`, `src/lib/queries.ts`, D-14), extrait leur texte
  (`src/lib/text-extract.ts`) et le compare ligne à ligne (`src/lib/line-diff.ts`, algorithme de Myers, borné). PDF
  par `unpdf` 1.7.0 (pdf.js ; la 1.9.0, publiée trois jours plus tôt, et la 1.8 exigent Node 22, alors que Codex
  admet Node 20.19) ; Office Open XML et OpenDocument par un lecteur de ZIP borné écrit pour l'occasion
  (`src/lib/zip-read.ts`), Excel feuille par feuille et PowerPoint diapositive par diapositive. Le dialogue garde le
  tableau des attributs et ajoute le contenu (CSS module `compare.module.css`, couleurs de Nocturne : la maquette ne
  prévoit ni rouge ni vert). Nouvelle limite de débit `CODEX_RATE_COMPARE`. Chaque version comparée est journalisée
  comme une consultation.
- **Aperçu des fichiers Office (point 15 ; [exploitation.md](exploitation.md) §6).** `src/lib/office-preview.ts` :
  `soffice --headless --convert-to pdf` (chemin dans `CODEX_PREVIEW_SOFFICE`, dossier, profil et environnement à lui,
  tué au-delà du délai) ou Gotenberg (`CODEX_PREVIEW_GOTENBERG_URL`), désactivé sans réglage. Conversion à la première
  demande de la route fichier avec `?preview=pdf`, hors transaction, une par version, deux par processus ; rendu dans
  le stockage local et dans `version_previews` (migration incrémentale `0002_apercu_office`, `0000` et `0001`
  inchangées), avec son nombre de pages (`countPdfPages`) et son empreinte, vérifiée à chaque envoi ; échec noté et
  retenté une heure plus tard. La fiche montre le rendu avec sa pagination et `preview_note` comme la maquette.
  Orphelins, sauvegarde (y compris celle d'avant migration, sur une base sans la table), export complet
  (`DERIVED_TABLES`) et contrôle de configuration suivent.
- **Vérifié** : `npm test` (88 fichiers, 1 260 tests passés, 10 ignorés), `npm run typecheck`, `npm run lint`,
  `npm run db:check`, `npm run build` ; avec `CODEX_TEST_SOFFICE=/usr/bin/soffice`, conversion réelle par le
  LibreOffice 24.2 du conteneur. `npm run dev` puis `npm start` sur une copie de la base de démonstration (migrations
  `0001` et `0002` appliquées après sauvegarde) : deux versions Word déposées sur `CTR-JUR-0001`, aperçu converti
  (« Page 1 sur 1 · Aperçu PDF généré par le service de conversion »), comparaison A.4 → A.5 dans le dialogue (« 2
  ligne(s) ajoutée(s), 1 ligne(s) supprimée(s) »), comparaison Word contre PDF par l'API ; pour deux personnes hors du
  cercle de rédaction, comparaison, aperçu et fichier répondent 404 ; sans outil configuré, « Aperçu indisponible »
  et le PDF de remplacement.
- **Reste** : comparaison visuelle côte à côte, fichiers Office 97-2003, PDF numérisés (reconnaissance de
  caractères) ; choix de l'outil de conversion avec l'hébergement et essai sur macOS (app Mac, D-22) ; conversion par
  Microsoft Graph si SharePoint est activé (O-01) ; PDF/A, filigrane et en-têtes générés (M12).

### 18.6 Reprise des documents d'une personne qui part et vocabulaires contrôlés

Points 19 et 59 de [reste-a-faire.md](reste-a-faire.md) (A15, M16, MET-07, MET-17, G32, G40, G03, A21, A05), vérifiés
au commit `5f92467` : les utilisateurs ne sont toujours ni administrables ni marqués actifs ou partis ; seul le
titulaire d'une étape la délègue ; mots-clés et organisme source sont du texte libre, la langue n'est contrôlée que par
le formulaire ; les sous-types sont éditables dans le registre (point 61) mais libres sur les documents.

- **Reprise (point 19).** `src/lib/transfer.ts` exécute le transfert nature par nature (propriété de documents,
  verrouillés compris ; propriété de processus ; lecteur désigné ; auteur désigné des révisions ouvertes ; étapes en
  attente ; titulariats), chaque objet contrôlé contre l'état que laissent les précédents (règles de `delegateStep`,
  `mayDraft`, exclusions du circuit), et journalise chaque objet puis la synthèse. La simulation est ce même transfert
  dans une transaction annulée ; la confirmation (`transferHoldings`) recalcule le plan sous un verrou consultatif et
  le refuse, sans rien écrire, si son empreinte n'est plus celle qui a été montrée. `circuitExclusions` et
  `approverCheck` sont passés de `src/lib/actions.ts` à `src/lib/lifecycle.ts` pour être partagés. `reassignStep`
  laisse un gestionnaire documentaire réassigner l'étape en cours (dialogue de délégation réutilisé). Onglet réservé aux
  gestionnaires documentaires (`mayTransferHoldings`), état dans l'URL (`person`, `replacement`).
- **Vocabulaires (point 59).** `src/lib/vocab-rules.ts` (règles pures : graphie repliée, alias, termes proches,
  sous-type, langue), `src/lib/vocab.ts` (lecture des valeurs d'un formulaire ou d'un import, ajout journalisé, valeurs
  des documents), tables `source_orgs` et `keyword_terms` par la migration incrémentale `0003_vocabulaires`, complétée à
  la main pour reprendre les valeurs existantes (repli écrit en SQL, `codex_fold` n'existant pas encore sur une base
  neuve à ce stade ; le test des migrations vérifie qu'il donne la clé de `vocabKey`). Formulaires : mots-clés en
  étiquettes avec autocomplétion, organisme source avec liste et termes proches, case de confirmation par nouveau terme
  (exigée aussi par le serveur), indication d'un sous-type hors liste (CSS module `vocab.module.css`). Suggestions
  lues par le layout racine en un passage sur les documents (`bothDocumentValues`) : environ 27 ms par page pour un
  contributeur sur la base de 10 000 documents de `docs/performances.md` (PGlite), rien à lire pour un gestionnaire ni
  pour qui ne peut ni déposer ni modifier. Import : langue contrôlée (`invalid_lang`), termes inconnus ajoutés
  (`term_added`), sous-type hors liste gardé (`subtype_unlisted`). Seed et `npm run seed:large` remplissent les
  vocabulaires (`seedVocabularies`). Recherche, termes de recherche, export complet, sauvegarde et `registry:apply`
  inchangés : les documents gardent le nom du terme en texte.
- **Vérifié** : `npm test` (91 fichiers dont 1 ignoré, 1 298 tests passés, 10 ignorés, aussi avec `.data` déplacé),
  `npm run typecheck`, `npm run lint`, `npm run db:check`, `npm run build`. `npm run dev` sur une copie de la base de
  démonstration (migrations `0001` à `0003` appliquées après sauvegarde automatique ; 8 organismes et 20 mots-clés
  repris) : reprise de Gabriel Comte par Hélène Sauvage simulée (12 transférables, 1 refusé : elle validait la
  révision en cours de `RPT-HLT-026-001`), confirmée (12 entrées `transfer` et la synthèse au journal), puis étape
  réassignée par Claire Bardet et dernier document devenu transférable ; création par Julien Wagner d'un courrier
  externe avec « Nordvolt » choisi parmi les termes proches de « Nordvolt Energy », « LEVAGE » ramené à « levage » et
  « essai vocabulaire » ajouté après confirmation (envoi bloqué tant que la case n'est pas cochée) ; ajout d'un
  doublon refusé, fusion de « Nordvolt Energy SAS » dans « Nordvolt », renommage d'« Apave » (document mis à jour et
  journalisé) ; écrans en français et en anglais.
- **Reste** : règle par défaut du remplaçant et obligations du propriétaire, de l'auteur et du propriétaire de
  processus (A15) ; désactivation des comptes et détection des départs (O-02) ; changement du chef de projet
  (Keystone, O-03) et de l'auteur désigné par Vigie (O-10) ; gouvernance des termes (A05), thésaurus fermé ou libre
  (A21) ; listes réelles d'organismes et de mots-clés (reprise de l'existant, O-11).

### 18.7 Finitions de l'interface : phases, Restaurer, compteur des modèles, écarts avec la maquette, bilinguisme

Points 63 à 68 de [reste-a-faire.md](reste-a-faire.md) (M15, D-12, D-16, G06, D-08, D-10, WCAG 2.4.2), vérifiés au
commit `2d36d97` : l'onglet Projet n'avait que l'étiquette de la phase et disparaissait sans projet ; aucun
« Restaurer » ; aucun lien d'un document à son modèle ; l'explorateur n'avait que « Nouveau » ; sites déjà en FR/EN
(point 62) mais fondement de conservation, phases, une partie du journal et le titre des pages dans une seule langue.
Le point 64 était déjà fait (15 octobre) : rien de changé.

- **Phases (point 63).** `HStepper` accepte un mode compact (`titleSize` 0 : points et traits, chaque étape nommée
  par `hint` au survol et pour les lecteurs d'écran, liste et `aria-current`) ; l'onglet Projet affiche les 12 phases
  de `PROJECT_PHASES` sur une ligne du panneau de 400 px et nomme la courante (« Chantier · Phase 9 sur 12 ») ; une
  phase inconnue garde son étiquette. `PROJECT_PHASES_EN` et `phaseLabel` (`src/lib/i18n.ts`, provisoires) servent à
  la fiche, aux facettes, au journal et au choix de la phase (valeur enregistrée inchangée).
- **Restaurer (point 65).** `restoreWorkingVersion` (`src/lib/actions.ts`) : contrôles d'`addWorkingVersion`, version
  de la révision en brouillon avec fichier et non la dernière, fichier relu, comparé à son empreinte et repassé par
  `stageFile`, version suivante « Restaurée depuis A.2 », entrée `working` avec un détail structuré. Bouton dans
  `RevisionsTab` (raison affichée quand il est inactif, confirmation). Ajoutée à `tests/integration/rate-limits.test.ts`.
- **Modèles (point 66).** `documents.template_id` (clé étrangère vers le modèle, en cascade sur un renommage, index
  partiel) et `doc_types.retention_basis_en` dans la migration incrémentale `drizzle/0004_modele_source.sql`, complétée à
  la main pour reprendre le modèle des documents existants quand le commentaire de A.1 (FR et EN) et le journal le
  nomment et qu'il existe en type FRM. `listTemplates` compte par `template_id` sous `readableSql` ; colonne
  « Utilisations » d'Administration › Modèles et « n utilisations » dans le choix du modèle. Le seed rattache trois
  documents à leur modèle.
- **Écarts avec la maquette (point 67).** Onglet Projet toujours présent ; sans projet, message et « Rattacher à un
  projet » (dialogue de métadonnées avec `attach: 'project'`) ; l'explorateur a « Déposer un fichier », et les deux
  boutons reçoivent le département, la famille ou le type choisis dans l'arbre (`preset.department`, `preset.family`).
- **Bilinguisme (point 68).** Fondement anglais : dialogue du type, Archivage, Administration, `GET /api/registry`
  (`basisEn`), `registry:apply`, journal (`retentionBasisEn`). Journal : `AuditData.text` (code et paramètres, types
  dans `src/db/schema.ts`), rendu par `auditTextL` (`src/lib/queries.ts`) à l'écran et dans l'export CSV ; écrit par
  le dépôt, la version de travail, la restauration, l'import, les lecteurs désignés, la délégation, la
  réassignation, le transfert d'une étape et l'auteur écarté par Codex ; la colonne `detail` garde une forme sans mots
  (la délégation garde la sienne, lue par la fiche de visa). Titres : `generateMetadata` du layout (titre et
  description par langue) et de chaque écran (`src/lib/titles.ts`), fiche « {ID} · {titre} — Codex » si `getDoc` la
  rend lisible, « Fiche document — Codex » sinon.

- **Vérifié** : `npm test` (93 fichiers dont 1 ignoré, 1 308 tests passés, 10 ignorés, aussi avec `.data` déplacé),
  `npm run typecheck`, `npm run lint`, `npm run db:check`, `npm run build`. `npm run dev` sur une copie de la base de
  démonstration (migrations `0001` à `0004` appliquées après sauvegarde automatique ; aucun document existant n'avait
  de modèle sûr à reprendre) : frise des phases de `PV-HLT-026-001` (« Chantier · Phase 9 sur 12 », « Site works ·
  Phase 9 of 12 ») ; « Rattacher à un projet » sur `PRO-QUA-0001` (dialogue avec « Projet » choisi, note d'identifiant
  figé) et refusé sur un document obsolète ; « Déposer un fichier » depuis HSE dans l'explorateur (département
  prérempli), puis A.2 et restauration de A.1 en A.3 (confirmation, commentaire, même empreinte, journal « restaurée
  depuis A.1 · 26 o » / « restored from A.1 · 26 B ») ; création depuis `FRM-QMS-002` : 1 utilisation pour Claire
  Bardet, 0 pour Julien Wagner (brouillon hors de son cercle) ; fondement anglais saisi pour POL, les autres en
  français suivis de « (FR) » ; titres « Recherche — Codex », « Browse — Codex », « PV-HLT-026-001 · PV de réception
  des fondations — Codex », « Fiche document — Codex » pour un brouillon illisible comme pour un identifiant inconnu.
- **Reste** : libellés anglais réels des phases et liste des phases avec Keystone (O-03) ; traduction des fondements
  après leur revue (O-07) ; titre des pages 404.

### 18.8 Accessibilité, aide aux utilisateurs et documentation alignée sur le code

Points 55, 69, 53 et 54 de [reste-a-faire.md](reste-a-faire.md), vérifiés au commit `65af2e6` : aucun lien
d'évitement, `<main>` sans id ; aucun contrôle d'accessibilité automatisé (Vitest existait, sans navigateur) ; aucune
aide hors des notes de conception ; les constats de documentation du 9 octobre étaient en partie déjà corrigés (T-03
local « à plat avec un préfixe unique », mentions d'Entra ID retirées d'`api.md` et d'`avancement-v2.md`, actions
d'administration journalisées), les autres restaient, avec de nouveaux écarts nés des lots 6 à 9.

- **Contrôle automatisé (point 55).** `scripts/codex-a11y.mts` (`npm run a11y`, dépendances `axe-core` 4.14.0 et
  `playwright-core` 1.56.1) : `next start` du build (ou `next dev` avec `--dev`, ou un serveur existant avec `--url`)
  sur une base de démo neuve dans un dossier temporaire ; axe (WCAG 2.0 à 2.2 A et AA, bonnes pratiques) sur 30 écrans
  et onglets et 20 dialogues, ouverts puis fermés par Échap sans rien envoyer ; contrôle du lien d'évitement, du focus
  des dialogues, des statuts HTTP et des erreurs JavaScript ; échec sur une violation sérieuse ou critique. Environ 70 s
  en français, 125 s avec l'anglais ; trois passages identiques ; ajouté à la CI après le build. Mesure au commit
  `65af2e6` (même script) : 82 éléments en violation sérieuse ou critique (contraste 65, contrôles imbriqués 8, cibles
  6, attribut ARIA interdit 3) et 52 modérés ou mineurs (pas de `<h1>` 30, en-têtes de tableau vides 14, ordre des
  titres 7, repère 1). Après : 0 et 0, en français et en anglais.
- **Corrections.** « Aller au contenu » vers `<main id="contenu" tabindex="-1">` ; nom de l'écran en `<h1>` et titres de
  section en `<h2>` (`.sec-title` reprend le dessin du `h6` de Nocturne : captures identiques) ; navigation et colonnes
  de l'Explorateur nommées ; étiquette de version de travail en bouton à bascule au lieu d'une ligne-bouton contenant
  un lien ; « page précédente » inactive en lien désactivé ; en-têtes « Actions » et « Attribut » lus seulement par les
  lecteurs d'écran ; cibles de 24 px. Contrastes mesurés sur les fonds Nocturne (`docs/accessibilite.md`) :
  `.text-muted` passe (5,19 et 4,83) ; corrigés au plus près : `.card-meta` 4,25 → 4,83 (dans `globals.css`, la copie
  de Nocturne intacte), portée des titulaires et usages des termes 4,47 → 5,47, nombre de termes dans un titre 3,18 →
  7,64, petites mentions de la page maquette 3,96 → 4,9.
- **Aide (point 69).** `/aide` (`src/app/aide/page.tsx`, `aide.module.css`, textes `HELP` de `src/lib/i18n.ts`) : dix
  parcours, en français et en anglais, de « ce qui est simulé » à la recherche, dont la demande à Vigie avec l'attente
  ou la greffe de D-26 ; chaque parcours ne décrit que ce que l'application fait et mène à son écran si le rôle y a
  accès ; lien « Aide » au-dessus de « Notes de conception ». Aides contextuelles : origine, rattachement, version de
  travail, circuit, délégation et réassignation.
- **Documentation (points 53 et 54).** README (recherche dans les métadonnées et non « plein texte », ce qui n'est pas
  journalisé, « Nouveau » de l'Explorateur, `/aide`, `npm run a11y`, organisation du code), `docs/avancement-v2.md`
  réécrit au 18 octobre, audit (G04, M16, M14, sauvegarde et PostgreSQL, conservation par document, consultations,
  historique des métadonnées, lectures ciblées), `docs/decisions.md` (Entra ID, déclencheur du journal),
  `docs/modele-cible.md` §3 (nom stocké en local), commentaires de `matches` et de `FileStore.rename`, constat 33 de ce
  fichier, « reste » des points 36 et 50 ; `docs/api.md` n'avait pas d'écart. Nouveau : `docs/accessibilite.md`.
- **Vérifié** : `npm test` (95 fichiers dont 1 ignoré, 1 319 tests passés, 10 ignorés, aussi avec `.data` déplacé ; nouveaux :
  `tests/integration/help-page.test.ts`, `shell-a11y.test.ts`), `npm run typecheck`, `npm run lint`, `npm run db:check`,
  `npm run build`, `npm run a11y` (0 violation). `npm run dev` sur une base de démo du scratchpad : `/aide` en français
  (« Aide — Codex ») et en anglais (« Help — Codex »), lien d'évitement au premier Tab, aides des dialogues « Nouveau
  document » et « Déléguer » ; 19 écrans capturés avant et après, différents seulement sur les éléments corrigés.
- **Reste** : test manuel avec un lecteur d'écran, zoom et affichage étroit, PDF générés non balisés, app Mac
  (macOS) ; formation, utilisateurs clés et pilote (M14) ; retrait des notes de conception en production (O-02).

### 18.9 Restes développables sans décision

Restes des points 36, 43, 46, 47, 50, 51, 52 et 57 de [reste-a-faire.md](reste-a-faire.md), ceux que l'état
récapitulatif classait « Rien : développable dans une session cloud », vérifiés au commit `d0ed61e`. Un commit par
groupe de points, chacun vérifié.

- **Version de Node et audit des dépendances (points 43 et 52).** Constats exacts : ni `.nvmrc` ni contrôle de version
  dans `desktop/build-app.sh`, `@types/node` en `^20` ; `npm audit` hors de la CI, 9 alertes (5 élevées, 4 modérées).
  `.nvmrc` (22) et `@types/node` `^22.12.0` ; la CI lit `.nvmrc` et lance en plus `npm test` sous Node 20.19 (la plus
  basse version d'`engines`, que les types 22 ne protègent plus ; toute la suite y passe, 95 fichiers).
  `scripts/codex-node-check.mjs`, appelé par `desktop/build-app.sh` (une ligne, non essayée sous macOS).
  `npm run deps:audit` (`scripts/codex-audit.mjs`) après `npm ci` : les 9 alertes viennent de deux avis, `braces`
  (élevé, lint, aucune version corrigée publiée : accepté avec sa raison) et `esbuild` (modéré, par `drizzle-kit`,
  signalé) ; aucun avis sur les dépendances de l'application.
- **Index d'accès et Validations (points 47 et 50).** Constats exacts : `getAccessIndex` lisait à chaque requête
  tous les lecteurs nommés, toutes les révisions ouvertes, tous les circuits en cours et leurs étapes et tous les
  titulaires (70 ms de requêtes sur PGlite à 10 000 documents) ; /validations chargeait tous les circuits
  (`listWorkflows`) et les filtrait en mémoire. L'index d'une requête ne lit plus que les lignes de la personne
  (`AccessScope`, `Members` : une question hors de portée lève une erreur), sans cache entre requêtes ;
  `validationsPage` fait visibilité, filtres, comptes, ordre et pages en SQL (pages de 50, `?p=`) ; index
  `revisions_open_modifier` et `workflows_requester` (migration `0005`). Comparé à l'ancien calcul pour chaque
  personne sous chaque rôle (démo, documents variés) ; Validations 1,60 s → 0,26 s à 10 000 documents, les autres
  écrans 10 à 30 % plus rapides ([performances.md](performances.md)).
- **Migrations au déploiement et transactions en `READ COMMITTED` (point 51, hors hébergement).** Constats exacts :
  migrations seulement au premier accès ; aucune revue des transactions pour un serveur. `npm run db:migrate`
  (`--check`, `--no-backup`), serveur arrêté sur PGlite, sauvegarde journalisée ; le démarrage migre toujours sans
  elle. Revue des 55 transactions ([postgres.md](postgres.md), « Transactions ») : verrou de la ligne du document en
  tête (`lockDoc`, `lockDocs`, `lockWorkflow`) partout où l'état d'un document est relu avant d'écrire, ligne
  verrouillée pour les droits et le registre, pièce attendue en mise à jour conditionnelle. Sur PostgreSQL 18.3,
  `read-committed.test.ts` échouait 6 fois sur 6 avec l'ancien code et passe ; plusieurs processus documentés comme
  limite ([exploitation.md](exploitation.md) §7).
- **Noms provisoires (point 36).** Constat exact : rien ne reprenait une clé restée `<uuid>-upload.<ext>` (local) ou
  dans `_staging` (SharePoint) après un arrêt entre l'enregistrement et `nameStoredFile`. `src/lib/provisional.ts` :
  simulation dans Administration › Journal d'audit, puis renommage des fichiers listés (`renameProvisionalFiles`),
  journalisé (« Fichiers renommés »), tâche `renames` du planificateur désactivée par défaut ; le renommage local
  reprend un lien déjà fait vers le même fichier et refuse tout autre fichier sous le nom final.
- **Aperçu paginé (point 46).** Constat exact : pour un brouillon ou un document confidentiel (`no-store`), la
  visionneuse recréait son cadre à chaque page et retéléchargeait le fichier. Essai dans Chromium : changer seulement
  le fragment `#page=` du même cadre ne tourne pas la page ; un cadre neuf sur une adresse `blob:` le fait sans
  réseau. La fiche télécharge donc le fichier une fois et pagine sur sa copie en mémoire (`useLocalCopy`), libérée à la
  fermeture ; `frame-src 'self' blob:`. Brouillon de 3 pages, pages 1 à 3 : 3 téléchargements avant, 1 après ; la page
  3 s'affiche (capture, Chromium complet).
- **Tests des routes et parcours de bout en bout (point 57).** Constat exact : les réponses d'erreur de l'import (401,
  400, 413, 415, 409, 500) et de la route fichier (404, 502, journal) n'étaient pas testées par leurs handlers ; aucun
  parcours dans un navigateur. `tests/integration/route-errors.test.ts` ; `npm run e2e` (`scripts/codex-e2e.mts`,
  outillage commun avec `npm run a11y` dans `scripts/codex-browser.mts`) : création avec un PDF, aperçu paginé
  téléchargé une fois, demande de validation, chaque étape approuvée par son titulaire lu à l'écran, en vigueur ;
  15 à 17 s, ajouté à la CI.
- **Vérifié** (à chaque commit, et en fin d'étape) : `npm run typecheck`, `npm run lint`, `npm run db:check`, `npm test`
  (101 fichiers, 1 356 tests passés, 11 sautés, aussi avec `.data` déplacé), `npm run test:pg` sur PostgreSQL 18.3
  (1 364 passés, 3 sautés), toute la suite sous Node 20.19.0, `npm run build`, `npm run a11y` (0 violation),
  `npm run e2e` (6 étapes, 18 s, passages identiques) ; `npm run db:migrate` sur une copie de la base de démonstration
  (cinq migrations en attente, sauvegarde, puis rien à faire) et sur une base PostgreSQL neuve ; Administration ›
  « Fichiers sous un nom provisoire » sur une copie de la démo ; mesures à 10 000 documents
  ([performances.md](performances.md)).
- **Reste** : essais sous macOS (contrôle de version de l'app, aperçu dans WebKit) ; SharePoint sur un vrai tenant
  (O-01) ; sauvegarde du serveur PostgreSQL et plusieurs processus (M22) ; contenu des fichiers non indexé (82).

### Bilan du lot 9

Neuf étapes, 24 points de [reste-a-faire.md](reste-a-faire.md) (47, 42, 41, 45, 60, 52 en partie, 51 en partie, 56, 38 en
partie, 23, 14, 15, 19, 59, 63 à 68, 55, 69, 53, 54) et un bogue (rechargement en boucle de `next dev`), tous
développables sans décision. Avec ce lot, les 69 points « développables maintenant » de l'inventaire du 9 octobre sont
traités : 55 entièrement, 14 en partie, leurs restes listés en tête de reste-a-faire.md avec ce qui les bloque.
L'étape 9 a repris les restes que rien ne bloquait (36, 43, 46, 47, 50, 51, 52, 57) : 58 points entièrement faits,
11 en partie, dont les restes attendent tous une décision, l'hébergement ou une session macOS ; plus aucun reste
n'est développable sans eux. Le lot a rendu Codex plus rapide (lectures ciblées, index d'accès, Validations paginé), déployable sur une vraie base (migrations incrémentales, PostgreSQL
serveur, amorçage minimal, planificateur, signatures entre serveurs), plus complet pour les utilisateurs (comparaison
du contenu, aperçu Office, reprise d'une personne qui part, vocabulaires, finitions de la maquette, bilinguisme, aide)
plus sûr sur un serveur (transactions revues pour `READ COMMITTED`, migrations au déploiement) et vérifié pour
l'accessibilité et de bout en bout. Aucune question ouverte n'a été tranchée ; chaque choix qui en dépend (O-01 à O-11,
M14, M22, A05) prend l'option la plus prudente et figure dans « Choix de l'assistant non validés explicitement » de
[decisions.md](decisions.md). Ce qui reste attend une décision de l'utilisateur (49 points), ses données (2) ou une
session sur macOS (9).

### 18.10 Revue du lot 9

Revue à charge du diff `d7ee1de..HEAD` (lot 9 entier), le 18 octobre 2026 : chaque constat suivi depuis un appelant
réel (route, Server Action, page, planificateur) ; chaque défaut confirmé d'abord par un test qui échoue, puis corrigé
au plus juste. Aucun choix de [decisions.md](decisions.md) n'a été changé, aucune question ouverte tranchée.

**Défauts confirmés et corrigés**

| Gravité | Défaut et chemin | Correction | Test |
|---|---|---|---|
| Moyenne | **Anti-rejeu contourné pendant une rotation de secret.** `checkSignature` retenait la signature reconnue ; une requête signée avec le secret et son `_NEXT` (ce que [api.md](api.md) recommande pendant une rotation), renvoyée avec la seconde signature seule, était acceptée une seconde fois (webhook Vigie, import). | La clé anti-rejeu porte sur l'horodatage et le SHA-256 du corps brut, quelle que soit la signature reconnue (`src/lib/server-auth.ts`). | `tests/integration/server-auth.test.ts` (rejeu avec chaque signature seule, dans l'autre ordre, en majuscules) |
| Faible à moyenne | **Corps du webhook Vigie lu sans borne avant toute authentification** quand seul `VIGIE_WEBHOOK_SECRET` est défini (avant le lot 9, un jeton était exigé avant la lecture) : un client quelconque pouvait faire lire un corps de plusieurs centaines de Mo en mémoire. | Corps borné à 64 Kio (`Content-Length` ou lecture coupée) : 413 `too_large` avant la signature (`src/app/api/integrations/vigie/route.ts`, [api.md](api.md)). | `server-auth.test.ts` (avec et sans `Content-Length`) |
| Moyenne (serveur PostgreSQL) | **Règle de conservation d'un type appliquée par-dessus un gel posé entre-temps.** `applyTypeRetention` (Administration › Registre, « appliquer aux documents ») lisait les documents sans verrou ; un gel juridique ou une dérogation engagés pendant la transaction étaient écrasés (`READ COMMITTED`). | Documents du type verrouillés dans l'ordre de leurs identifiants, puis relus (`src/lib/actions.ts`). | `tests/integration/read-committed.test.ts` (sur PostgreSQL 18.3 : échouait, passe) |
| Faible (serveur PostgreSQL) | **Mot-clé perdu au renommage ou à la fusion d'un terme.** `applyTerm` réécrivait les mots-clés d'après une lecture sans verrou : un mot-clé ajouté au document pendant le renommage disparaissait. | `documentsWith` verrouille les documents concernés, puis les relit (`src/lib/vocab.ts`). | `read-committed.test.ts` (sur PostgreSQL 18.3 : échouait, passe) |
| Faible à moyenne (D-14) | **Chiffres du planificateur montrés à tout administrateur.** Administration › Journal d'audit › Planificateur affichait à quiconque a l'accès Administration les chiffres de chaque exécution (fichiers vérifiés, altérés, absents, nom et taille des archives), que le journal réserve aux gestionnaires documentaires parce qu'ils comptent les brouillons (`integrityL`, `backupL`, `archiveL`). | `schedulerOverview(viewer, …)` ne donne les chiffres qu'aux gestionnaires documentaires ; les autres voient le résultat et la raison d'une exécution sautée (`summaryShown`, `src/lib/scheduler.ts` ; [exploitation.md](exploitation.md) §4). | `tests/integration/scheduler-panel.test.ts` |
| Faible (i18n) | **« Comparaison » en français dans le journal anglais** : la consultation d'une version comparée n'avait pas de détail structuré, alors que le lot a traduit le journal. | Détail structuré `compared` (`journalConsultation` accepte des données ; « Comparison » en anglais) ; le détail libre reste celui qui sert à ne journaliser qu'une fois. | `tests/integration/compare.test.ts` |

**Constats écartés**

- Signature HMAC : comparaisons en temps constant (empreintes de longueur fixe, `timingSafeEqual` sur chaque paire),
  fenêtre bornée dans les deux sens, empreinte gardée jusqu'à la fin de la fenêtre de son horodatage, corps brut signé
  tel que reçu : conformes.
- Secrets dans les journaux : les refus nomment la variable, jamais la valeur ; le contrôle de configuration ne cite
  aucun jeton ni secret.
- LibreOffice : arguments sans interpréteur de commandes, nom de fichier fixe, extension d'une liste fermée,
  environnement réduit, groupe de processus tué au délai, dossier temporaire supprimé dans tous les cas ; Gotenberg :
  redirections refusées, réponse bornée. Seul ajout, documentaire : isoler la conversion du réseau
  ([exploitation.md](exploitation.md) §6).
- ZIP et extraction de texte : taille dépliée bornée par entrée (`maxOutputLength`), lignes, caractères et durée bornés.
- Comparaison et aperçu (D-14) : `readableVersions` et la route fichier appliquent `readerMaySeeVersion` avant toute
  lecture ; le cache de textes, indexé par empreinte, ne sert qu'après ce contrôle.
- Autocomplétion, compte des modèles, comptes de Validations : filtrés par `readableSql` et `workflowVisibleSql`.
- Synthèse d'une reprise et fichiers renommés dans le journal : comptes et noms déjà réservés aux gestionnaires
  (`transferL`, `renameL`).
- Nouvelles Server Actions (`restoreWorkingVersion`, `reassignStep`, `renameProvisionalFiles`, `transferHoldings`,
  vocabulaires, `adoptSubtype`) : droits contrôlés côté serveur avant toute lecture, limitées (`throttled`), déjà dans
  `rate-limits.test.ts`.
- Migrations 0001 à 0005 : appliquées une fois par drizzle dans une transaction, contraintes et index égaux au schéma
  (`db:check`, `migrations.test.ts`) ; les mises à jour de 0003 et 0004 font avancer `documents.version` (déclencheur
  déjà posé sur une base existante), ce qui est voulu : un dialogue resté ouvert pendant le déploiement est averti.
- Copie en mémoire de l'aperçu : adresse `blob:` révoquée au démontage, `frame-src` limité à `'self' blob:`.
- Antérieurs au lot 9, hors de son diff : existence d'un circuit invisible signalée par `/validations?r=` ; noms des
  lecteurs désignés sur la fiche ; doublons possibles d'une consultation sur un serveur (déjà notés).
- Interblocage possible entre un renommage de terme (verrou de la table du vocabulaire) et une modification de fiche
  qui ajoute un terme de ce vocabulaire : PostgreSQL l'interrompt par une erreur, sans incohérence ; laissé.
- `npm run lint` signale deux erreurs dans `.claude/worktrees/` : copie de travail non versionnée d'un autre agent, hors
  du dépôt ; `eslint . --ignore-pattern '.claude/**'` ne trouve rien.

**Choix documentés qui méritent l'attention de l'utilisateur** (non changés)

- Vocabulaires : un terme qu'on ne propose pas est reconnu quand on le saisit. [decisions.md](decisions.md) dit que
  « seule la casse ou les accents pourraient trahir son existence » ; en fait l'absence de demande de confirmation le
  trahit aussi (un appel direct sans case cochée réussit si le terme existe, échoue sinon), donc l'existence d'un
  mot-clé porté seulement par des brouillons.
- Administration › Vocabulaires compte les documents de chaque terme, brouillons et confidentiels compris, pour toute
  personne qui a l'accès Administration, alors que le journal réserve ce genre de comptes aux gestionnaires
  documentaires (D-14).
- Import signé sans jeton : le corps (jusqu'à `CODEX_MAX_FILE_MB` + 1 Mo) est lu en mémoire avant que la signature
  puisse être vérifiée ; définir aussi `CODEX_IMPORT_TOKEN` fait refuser plus tôt un client inconnu.

**Vérifié** : `npm run typecheck`, `npm run lint` (hors `.claude/`), `npm run db:check`, `npm test` (102 fichiers dont 1
sauté, 1 360 tests passés, 13 sautés, aussi avec `.data` déplacé), `npm run test:pg` sur PostgreSQL 18.3 (102
fichiers, 1 370 passés, 3 sautés), `npm run build`. Chaque nouveau test a d'abord échoué sur le code du lot 9 (les deux
cas `READ COMMITTED` sur le serveur seulement).

## 19. Lot 10 (18 oct.)

Les points développables sans décision étant traités (fin du lot 9), le lot 10 prépare les réponses de l'utilisateur
aux questions ouvertes de [decisions.md](decisions.md), **sans en trancher aucune** : outils et documents qui
présentent l'état du code et recueillent les réponses ; rien n'est préréglé, recommandé ni appliqué.

| Étape | Commit | Points | Ce qui change | Choix prudents |
|---|---|---|---|---|
| 1. Fiches de décision pour les questions O-01 à O-11 | `79d2dc2` | 70 à 120 (préparation) | [fiches-decision.md](fiches-decision.md) : une fiche par question (question citée, état du code, options, effort, irréversible, points débloqués, données attendues) ; JUR relevé en collision type/département | Propositions de l'assistant étiquetées « non validée » ; aucune question reposée plus d'une fois |
| 2. Cahiers de validation du registre et de l'organigramme | commit « Lot 10, étape 2 », qui suit `79d2dc2` | 113 à 118 (préparation, toujours bloqués) | `npm run registry:review` (cahiers `types.csv` et `fonctions.csv`, contrôle d'un cahier rempli et écart avec le code) ; modèle `docs/modeles/organigramme.csv` et `npm run org:check` | Cahiers tirés du code, pas d'une base ; réponses vides ; aucune table société ; rien n'est écrit ni en base ni dans `registry.ts`, `seed-org.ts` |
| 3. SharePoint sans tenant | commits « Lot 10, étape 3 » (deux) | 36, 103 (préparation, O-01 toujours ouverte) | Faux Microsoft Graph et 26 tests du pilote ; quatre défauts corrigés (délai d'envoi non entier, jeton refusé gardé en cache, `Retry-After`, corps des réponses de limitation) ; `npm run storage:check` ; procédure d'essai sur un tenant (`docs/exploitation.md` §8) | `CODEX_STORAGE` reste `local` par défaut ; aucune suppression sur SharePoint ; pas de session d'envoi ; plafond de 250 Mo inchangé |
| 4. Constats remis à jour et corrections neutres | commit « Lot 10, étape 4 » | 70 à 120 (constats), 87, 88, 94 (avancés, toujours bloqués) | 50 constats revérifiés ; état récapitulatif recompté par question (O-01 : 5 points au lieu de 11, O-11 : 2 au lieu de 9) et annexe B des fiches alignée ; vocabulaires : un terme non proposé est traité comme inconnu, comptes réservés aux gestionnaires (D-14) ; indicateur « En retard » des circuits ; chiffrement au repos documenté ; bouton « Copier le lien du document » ; JUR dans la question 1 du registre | Aucune question tranchée ; délai de 7 jours, relances et « À traiter » inchangés ; rien de chiffré par Codex |
| 5. Parcours de bout en bout et simulation d'import | commit « Lot 10, étape 5 » | 57 (avancé), 106 (préparé, toujours bloqué) | `npm run e2e` : cinq parcours indépendants (approbation, rejet avec motif puis nouvelle demande, rappel, demande Vigie acceptée puis greffe ou attente, import simulé puis réel), chacun avec le contrôle D-14 hors du cercle de rédaction ; `POST /api/import?dryRun=1` | Simulation : transaction annulée, aucun fichier stocké, rien au journal d'audit, aucun champ ni limite de plus ; paramètre d'adresse inconnu refusé ; identifiant prévu non réservé ; parcours lancés tous dans la CI (stables sur trois passages) |
| 6. Affichage étroit et image générique | commits « Lot 10, étape 6 » (deux) | 79 (avancé), 112 (préparé), toujours bloqués | `npm run a11y -- --narrow` (320 px, 1 280 px à 200 %) ; quatre débordements corrigés sans effet sur le bureau ; `Dockerfile` et `.dockerignore`, sortie autonome seulement avec `CODEX_STANDALONE=1` ; image construite et essayée | Captures du bureau identiques avant et après ; ni mise en page mobile, ni barre repliable, ni PWA (M23) ; ni hébergeur, ni proxy, ni TLS, `CODEX_SEED` non posé (M22) ; build par défaut inchangé |
| 7. Verrou entre conteneurs et contraste au survol | commit « Lot 10, étape 7 » | 112 (préparé), 79 (avancé), toujours bloqués | `codex.lock` enregistre aussi un identifiant tiré au hasard par processus et l'espace de processus (démarrage du noyau, espace de noms, départ de son premier processus ; nom de machine hors Linux) ; le serveur rafraîchit son verrou toutes les 30 s ; une commande lancée dans un autre conteneur à côté du serveur refuse ; texte atténué à 60 % sur une ligne survolée (4,38 → 4,91:1) | Un verrou d'un autre espace n'est jugé que par son rafraîchissement (10 min) ; ancien format lu par son numéro, jamais pris pour le sien ; un serveur ne refuse toujours pas le verrou d'un serveur ; teinte de survol de Nocturne inchangée ; aucun hébergement choisi (M22) |

### 19.1 Cahiers de validation du registre et de l'organigramme

**Le besoin.** O-04 à O-08 attendent des tableaux de l'utilisateur (fiches, « Ce dont l'assistant a besoin ») : types
avec durées, circuits et niveaux, fonctions et titulaires, organigramme. Sans support, une réponse saisie à la main
pouvait reprendre un code déjà pris (FIN-FIN-0001) ou une valeur que Codex refuse, et l'écart avec le registre restait
à relever ligne à ligne.

- **Cahiers** (`src/lib/registry-review.ts`, règles pures sur `TYPES`, `FAMILIES`, `FUNCTIONS`, `HOLDERS`) :
  `npm run registry:review -- --out <dossier>` (`scripts/codex-registry-review.mts`) écrit `types.csv` (69 lignes : code,
  libellés, famille, origines, rattachements, sous-types, circuit, conservation, fondement FR et EN, niveaux, livrable
  client, ISO, source) et `fonctions.csv` (16 fonctions, portée, titulaires de démonstration, types qui les nomment),
  au format des exports (`src/lib/csv.ts` : BOM, point-virgule, formules neutralisées). Colonne « Question liée » ;
  colonnes « Validé (oui/non) », « Correction » et, pour les types, « Nouveau code (renommage) », laissées vides. Un
  cahier déjà présent n'est pas écrasé sans `--force`.
- **Drapeaux comptés dans le registre** : 16 types sans durée (O-07 ; 14 « durée de vie de l'actif », GOV et PUB
  permanents), 26 « fin de projet » (question 3 du registre), 5 admettant « Public » (O-08 : POL, REG, DTF, PUB,
  COL), 4 codes aussi codes de département (question 1 : FIN, HSE, COM et JUR, que la liste du registre omet), 3 sans
  circuit (O-06 : LET, RFQ, PHO).
- **Contrôle** : `-- --check <cahier>` (un ou deux cahiers, reconnus à leur en-tête ; `--org` pour les personnes et
  départements d'un organigramme) applique les règles de l'Administration (`src/lib/registry-rules.ts` : formats,
  collisions avec un type, un département, un projet, un programme ou `QMS`, valeurs admises, portée fixe des
  fonctions des règles de Codex, modèles sans rattachement), signale chaque refus au lieu de l'écarter, puis liste les
  réponses, l'écart champ par champ avec le code, les renommages demandés, les lignes ajoutées et absentes. Il n'écrit
  rien. Les quatre codes déjà en collision restent tels quels, comme dans l'Administration ; un nouveau code ou un
  renommage en collision est refusé.
- **Organigramme** : modèle `docs/modeles/organigramme.csv` (une ligne par département, site ou personne ; société en
  colonne facultative, Codex n'ayant pas de table société), rempli des 15 départements et 3 sites provisoires, sans
  personne. `npm run org:check -- <csv>` (`src/lib/org-review.ts`, `scripts/codex-org-check.mts`) : libellés
  (`orgLabels`), formats, un département au moins, doublons, références inconnues (département, site, responsable),
  collisions des codes de département avec les codes de type ; sur le modèle, les quatre collisions et rien d'autre.
  Aucune base n'est ouverte.
- **Lecture d'un CSV** : `parseCsv` et `unneutralise` ajoutés à `src/lib/csv.ts` (BOM, point-virgule ou virgule,
  guillemets, retours à la ligne, apostrophe de neutralisation retirée avant comparaison).
- **Documentation** : [registre-points-ouverts.md](registre-points-ouverts.md) (« Valider le registre avec le
  cahier », valeurs admises, format de l'organigramme), renvois dans les fiches O-04 à O-08
  ([fiches-decision.md](fiches-decision.md)), README, ligne « Préparé le 18 octobre 2026 » des points 113 à 118 de
  [reste-a-faire.md](reste-a-faire.md), qui restent bloqués.
- **Outillage** : `.claude/**` ignoré par ESLint et `.claude/worktrees/` par git (copies de travail d'autres agents).
- **Tests** : `tests/unit/registry-review.test.ts` (69 lignes, drapeaux, réponses vides, relecture du CSV, cahier
  inchangé sans écart, cahier modifié : réponses, écarts, renommage, valeurs refusées colonne par colonne, fonctions
  d'un cahier joint, titulaires d'un organigramme) et `tests/unit/org-review.test.ts` (fichier valide, société
  facultative, collisions FIN, HSE, COM, JUR et QMS, doublons, références inconnues, valeurs fautives, modèle).
- **Vérifié** : `npm run typecheck`, `npm run lint`, `npm run db:check`, `npm test` (104 fichiers dont 1 sauté, 1 385
  tests passés, 13 sautés, aussi avec `.data` déplacé), `npm run build` ; `npm run registry:review` et
  `npm run org:check` lancés sur les cahiers écrits, un cahier modifié et le modèle.

### 19.2 SharePoint sans tenant (lot 10, étape 3)

- **Demande** : tester le pilote SharePoint existant (`sharepoint()`, `src/lib/storage.ts`) sans tenant, sans activer
  SharePoint ni changer le défaut de `CODEX_STORAGE` (O-01 reste ouverte).
- **Faux Graph** : `tests/support/fake-graph.ts`, une bibliothèque en mémoire derrière `fetch`. Il répond au jeton
  Entra ID, à l'envoi dans `_staging` (`conflictBehavior=fail`), à la création de dossier, au renommage avec
  déplacement, à la lecture par redirection (Range conservé, Authorization retiré), à la suppression, à la liste
  paginée et à la sonde. Il sait injecter 429/503 avec Retry-After, 401 et des jetons révoqués.
- **Tests** : `tests/integration/sharepoint-store.test.ts` (26 tests). Dépôt et nommage, reclassement, route fichier
  avec plage, liste de `_staging` et reprise des noms provisoires, orphelins listés jamais supprimés, export complet,
  sonde et son cache, reprises, 401, commande d'essai.
- **Défauts prouvés puis corrigés** (test rouge d'abord) :
  - le délai d'envoi n'était pas un entier, donc `AbortSignal.timeout` levait une erreur et aucun envoi SharePoint
    n'aurait abouti ;
  - un jeton refusé (401) restait en cache jusqu'à son expiration ; il est maintenant oublié et redemandé une fois ;
  - `Retry-After: 0` était lu comme 2 s et une date HTTP n'était pas lue (`retryAfterSeconds`) ;
  - le corps des réponses 429/503 n'était pas libéré.
  `resetStores()` oublie aussi le stockage actif (accès de test), et `storeFor(name)` est ajouté.
- **Commande** : `npm run storage:check` (`scripts/codex-storage-check.mts`, `src/lib/storage-check.ts`). Elle essaie
  le stockage actif sans base : envoi, nommage, lecture complète et par plage, suppression, avec un message clair
  par étape.
- **Procédure** : `docs/exploitation.md` §8, « Essayer SharePoint sur un tenant » (inscription de l'application,
  Sites.Selected, consentement, accès au site en écriture, variables `CODEX_SP_*`, `storage:check`, retour arrière).
- **Reste** : l'essai sur un vrai tenant, notamment la forme du déplacement par `parentReference.path`. Restent aussi
  la décision O-01, la suppression des orphelins sur SharePoint, la session d'envoi au-delà de 250 Mo et la sauvegarde
  des fichiers SharePoint.

### 19.3 Constats remis à jour et corrections neutres (lot 10, étape 4)

Rien de ce qui suit ne tranche une question ouverte ; aucun point bloqué ne change d'état.

- **Constats des points 70 à 120** ([reste-a-faire.md](reste-a-faire.md)) : chacun revérifié dans le code ; une
  ligne « Revérifié le 18 octobre 2026 » ajoutée aux 50 points dont le constat ou les références avaient changé (75
  inchangé). Constats périmés confirmés : 93 (`src/proxy.ts` existe, mais ne pose que la CSP et HSTS, aucune session),
  104, 109 et 111 (planificateur `src/lib/scheduler.ts`, sans envoi sortant), 112 (`.github/workflows/ci.yml`, santé,
  journal, migrations au déploiement ; toujours ni image ni proxy), 113 (fondement modifiable, répercussion du point
  18, durée de vie de l'actif calculable une fois la date saisie), 114 et 115 (`createFunction`, `createType`,
  `createFamily`), 96 (c) et 105 (`retention_event_at` saisissable pour le départ du salarié et la fin de vie de
  l'actif ; la fin de projet reste incalculable), 98 (une seule limite `maxFileBytes`, 50 Mo par défaut, 250 Mo au
  plus avec SharePoint, au lieu du plafond propre à l'import), 81 (langue contrôlée, facette Langue), 86 (liste
  blanche commune et aperçu Office, pas de rendu figé), 107 (`.eml` et `.msg` admis, sans lecture), 116 (recherches
  enregistrées), 118 (`npm run registry:apply`) ; numéros de ligne remis à jour partout ailleurs.
- **État récapitulatif recompté** (tête de [reste-a-faire.md](reste-a-faire.md)) : chaque point rattaché aux
  questions que citent ses références et son constat. 73, 78, 79, 82, 86, 107 et 112 sortent des listes d'O-01 et
  d'O-11 (seul 86 cite O-01, aucun O-11) ; 82 et 112 rejoignent les points qui n'attendent qu'une question de l'audit
  (M10, M22) ; les restes de 46 et 50 rejoignent O-11. Décomptes (points, puis avec les restes) : O-01 5 (9), O-02 7
  (8), O-03 7 (9), O-04 6 (7), O-05 6 (7), O-06 4, O-07 6, O-08 1, O-09 4 (7), O-10 2 (3), O-11 2 (4) ; 13 points
  n'attendent qu'une question de l'audit. Annexe B de [fiches-decision.md](fiches-decision.md) alignée, l'écart qu'elle
  signalait est corrigé.
- **Vocabulaires, D-14** (choix documentés de la revue du lot 9, §18.10) : un terme qu'on ne propose pas à
  l'utilisateur (porté seulement par des documents qu'il ne peut pas lire) est traité comme un terme inconnu :
  `readVocab` demande la même confirmation avec le même message (`offeredTerms`, `src/lib/queries.ts` ; paramètre
  `offered` de `readTerms`, `src/lib/vocab.ts`) ; une fois la case cochée, le terme existant est écrit, sans doublon
  ni entrée « terme ajouté ». Administration › Vocabulaires : nombre de documents par terme réservé aux gestionnaires
  documentaires, comme les chiffres du planificateur (`summaryShown`) ; un autre administrateur voit « — » et, parmi
  les valeurs et sous-types hors liste, seulement ceux d'un document qu'il peut lire (`vocabOverview`). Mention
  correspondante de [decisions.md](decisions.md) mise à jour. Tests : `tests/integration/vocab.test.ts` (deux
  utilisateurs : réponse identique pour un terme caché et un terme inconnu, création et modification, pas de doublon ;
  administrateur non gestionnaire) ; les trois cas qui décrivent la correction échouaient sur le code d'avant.
- **Indicateur « En retard »** (point 87, affichage seul) : `isCircuitLate` et `circuitDaysLate` (`src/lib/review.ts`,
  même règle de jour que l'expiration : le lendemain de l'échéance, en heure de Paris) ; `daysLate`, `lateL` et
  `lateTitle` dans `workflowsWhere` ; étiquette dans Validations (liste et en-tête), l'onglet Validation de la fiche
  (cercle de rédaction) et la page de département, info-bulle avec la date prévue et le nombre de jours ; libellés
  `wf_late`, `wf_late_title` (FR/EN). Mêmes listes qu'avant, donc rien sur un circuit invisible (D-14). Tests :
  `tests/unit/review.test.ts`, `tests/integration/circuit-late.test.ts` (bascule à minuit à Paris, anglais, circuit
  terminé, utilisateur hors du circuit).
- **Chiffrement au repos** (point 88) : [exploitation.md](exploitation.md) §9 et [sauvegarde.md](sauvegarde.md)
  (« Chiffrement ») : volumes de `.data`, des sauvegardes et des exports chiffrés, clés hors du serveur et
  sauvegardées ; documentation seulement.
- **Bouton de la fiche** (point 94) : nom accessible et info-bulle « Copier le lien du document » (`copy_link`),
  visuel inchangé.
- **Registre** : JUR ajouté à la question 1 de [registre-points-ouverts.md](registre-points-ouverts.md) (la question
  ne change pas).
- **Vérifié** : `npm run typecheck`, `npm run lint`, `npm run db:check`, `npm test` (105 fichiers dont 1 sauté, 1 421
  tests passés, 13 sautés, aussi avec `.data` déplacé), `npm run build`, `npm run a11y` (30 écrans et 20 dialogues, 0
  violation). Essai réel sur une copie de la base de démonstration (serveur de production, `CODEX_DATA_DIR` dans le
  dossier de travail) : les 8 circuits en cours de Claire Bardet portent « En retard » (3 à 19 jours au 18 octobre),
  aucun circuit terminé ; même étiquette sur l'onglet Validation de `FDS-HLT-026-001` et sur la page du département
  QUA, « Overdue » en anglais ; un collaborateur hors de ces circuits n'en voit aucun ni sur la fiche ni sur la page
  du département.

### 19.4 Parcours de bout en bout et simulation d'import (lot 10, étape 5)

Rien de ce qui suit ne tranche une question ouverte ; aucun point bloqué ne change d'état.

- **Parcours** (`scripts/codex-e2e.mts`, outillage commun `scripts/codex-browser.mts` : build de production, base de
  démonstration jetable dans un dossier temporaire, jamais `.data/`) : cinq parcours indépendants, chacun dans son
  propre contexte de navigateur et sur ses propres documents ; un parcours en échec n'arrête pas les autres (code de
  sortie 1, capture de l'écran avec `CODEX_E2E_SHOTS`) ; `-- --only <noms>` en lance certains.
  - **approbation** (celui du lot 9) : création avec un PDF, aperçu paginé téléchargé une fois, chaque étape approuvée
    par son titulaire lu à l'écran, document en vigueur, alors visible de la lectrice hors du cercle ;
  - **rejet** : l'étape tenue par Gabriel Comte est rejetée avec un motif (obligatoire dans le dialogue) ; la fiche
    dit qui a rejeté et pourquoi, le circuit se dit « Rejeté », la révision revient en rédaction ; nouvelle version de
    travail A.2, nouvelle demande de validation (nouveau circuit) ;
  - **rappel** : Julien Wagner (collaborateur, pas gestionnaire) crée et soumet un document, puis rappelle sa demande
    avec un motif ; circuit « Rappelé », révision en rédaction, le titulaire de l'étape n'a plus rien à décider ;
  - **vigie** : un document en vigueur de Julien Wagner (préparé par l'import), une demande de modification acceptée
    par la simulation Vigie (gestionnaire documentaire, `simulateVigieDecision`) ouvre la révision B en brouillon pour
    lui ; une deuxième demande, acceptée pendant la rédaction de B, est **en attente** et la fiche propose la
    **greffe**, que Julien Wagner fait ; une troisième, acceptée une fois B.1 déposée et B en validation, est en
    attente **sans** greffe proposée (« en cours de validation »). C'est le comportement de l'application, testé tel
    quel : l'attente vaut par défaut, la greffe se choisit sur la fiche tant que la révision est en rédaction (D-26 et
    ses interprétations non confirmées) ;
  - **import** : `POST /api/import?dryRun=1` avec le jeton tiré pour ce serveur (variables posées pour la base jetable
    seulement), identifiant prévu, rien créé (la fiche répond 404) ; import réel : même identifiant, révision C en
    vigueur avec son fichier, vue avec son aperçu par la gestionnaire et la lectrice hors du cercle, ancienne référence
    résolue ; rejeu 409 ; brouillon importé vu de son seul propriétaire.
  - **D-14 dans chaque parcours** : Léa Marchand (collaboratrice PRJ, lectrice des documents du groupe, hors de ces
    circuits) reçoit « Vous n'avez pas accès à ce document » sur la fiche d'un brouillon et 404 sur son fichier ; sur
    le document en vigueur du parcours vigie, elle ne voit que la révision A : ni « Rév. B en cours », ni version B, ni
    révision ouverte ou greffée dans les demandes, ni bouton de greffe.
  - Durées (build de production, ce conteneur) : 72 à 73 s au total dont 5 s de démarrage ; approbation 15 s, rejet
    14 s, rappel 8 s, vigie 22 s, import 6 s ; 32 étapes, identiques sur trois passages : tous les parcours sont dans la
    CI.
  - Défauts trouvés par les parcours : aucun dans l'application. Un piège de l'outil corrigé en route (le parcours
    vigie cliquait la greffe sous l'identité de la lectrice laissée par le contrôle D-14 : bouton absent, comme il se
    doit).
- **Simulation d'import** (`POST /api/import?dryRun=1`, [api.md](api.md) « Simulation ») : mêmes contrôles que
  l'import (jeton, signature, débit, corps, fichier dont l'antivirus, métadonnées, rejeu, identifiant, avertissements),
  réponse **200** `{dryRun, id, warnings}`, mêmes refus. `importDocument(raw, file, { dryRun })` (`src/lib/importer.ts`)
  contrôle le fichier sans le déposer (`checkFile`, extrait de `stageFile` dans `src/lib/storage.ts`) puis exécute la
  même transaction, annulée à la fin par une exception qui porte le résultat (comme `simulateTransfer`,
  `src/lib/transfer.ts`) : ni document, ni compteur, ni terme de vocabulaire, ni entrée d'audit ; un fichier infecté
  n'est noté qu'au journal technique. Une ligne `import simulated (dry run), nothing written` au journal technique.
  - L'identifiant prévu n'est pas réservé : un document créé entre-temps le prend, l'import reçoit le suivant (testé et
    documenté).
  - La signature ne couvre pas l'adresse : la même requête signée renvoyée sans `?dryRun=1` est refusée comme rejeu
    (testé) ; l'import qui suit est signé à nouveau. La mémoire anti-rejeu (`integration_signatures`) est la seule
    ligne écrite par une simulation signée.
  - Paramètres : `dryRun` seul, valeurs `1`/`true`/`0`/`false` ; tout autre paramètre ou valeur → 400 `invalid_query`
    avant la lecture du corps (une faute de frappe n'importe pas pour de bon).
  - Aucun champ ni aucune limite de plus (ni état, ni gel, ni approbation d'origine, ni plusieurs révisions : points 99
    et 106 toujours bloqués par O-11).
  - Tests : `tests/integration/import-dry-run.test.ts` (10 tests, FILES_DIR jetable, clamd simulé) : réponse,
    avertissements identiques à ceux de l'import, aucun fichier stocké, toutes les tables inchangées (contenu de chaque
    table comparé avant et après), identifiant égal à celui de l'import qui suit, identifiant au format Codex,
    brouillon, fichier identique à un fichier en vigueur, identifiant pris entre-temps, mêmes réponses que l'import sur
    huit refus, 409, 422 sans journal d'audit, 503, signature et rejeu, paramètres d'adresse.
- **Documentation** : [api.md](api.md) (section « Simulation », réponses, exemple), README (`npm run e2e`, API), CI
  (commentaire), [reste-a-faire.md](reste-a-faire.md) (points 57 et 106).
- **Vérifié** : `npm run typecheck`, `npm run lint`, `npm run db:check`, `npm test` (106 fichiers dont 1 sauté, 1 431
  tests passés, 13 sautés, aussi avec `.data` déplacé), `npm run build`, `npm run a11y` (30 écrans et 20 dialogues, 0
  violation), `npm run e2e` trois fois (5 parcours sur 5, 32 étapes, 72 à 73 s).

### 19.5 Affichage étroit et image générique (lot 10, étape 6)

Rien de ce qui suit ne tranche une question ouverte : M22 (hébergement), M23 (accès terrain et mobile) et O-02
(authentification) restent ouvertes ; les points 79 et 112 restent bloqués.

- **Affichage étroit** (`npm run a11y -- --narrow`, `scripts/codex-narrow.mts`, [accessibilite.md](accessibilite.md)
  « Affichage étroit et zoom ») : les 30 écrans et 20 dialogues du contrôle d'accessibilité rendus à 1 440 × 900
  (référence), 320 × 256 (WCAG 1.4.10) et 640 × 400 px CSS à deux pixels par px (1 280 px zoomé à 200 %, WCAG 1.4.4) ;
  axe à chaque taille, puis débordement horizontal de la page, textes et contrôles hors fenêtre, masqués par un bloc,
  tronqués par des points de suspension, blocs à défilement horizontal et superpositions. Constats listés sans faire
  échouer la commande ; `--json` pour le détail, `--shots <dossier>` (aussi sans `--narrow`) pour une capture de chaque
  écran et dialogue.
  - **Mesures** (français) : à 200 %, écrans ou dialogues plus larges que la fenêtre 15 → 3 sur 50, éléments hors
    fenêtre 252 → 28 ; à 320 px, 30 écrans sur 30 restent plus larges (305 px de trop au lieu de 305 à 1 124), éléments
    hors fenêtre 1 162 → 529 ; au bureau, débordement invisible de 4 px du Registre supprimé, 0 violation.
  - **Corrections** (sans effet sur le bureau) : barre latérale qui défile (Aide, notes, profil étaient sous le bord à
    200 %) ; `Seg` prend `wrap` (`.seg-wrap`) pour les onglets d'Administration et d'Archivage et les filtres des
    échéances, qui vont à la ligne au lieu de pousser l'écran (une règle sur tous les contrôles segmentés déformait
    l'en-tête : écartée) ; en-têtes de colonne réservés aux lecteurs d'écran gardés dans le flux de leur cellule
    (`th > .sr-only`, ils prolongeaient la page jusqu'au bord d'un tableau large ; la cellule positionnée, essayée
    d'abord, couvrait le trait sous les en-têtes) ; référence d'un modèle tronquée dans « Nouveau document ».
  - **Bureau inchangé** : 30 écrans et 20 dialogues capturés à 1 440 px sur le code d'avant et d'après, 49 captures
    identiques au pixel près, la cinquantième ne différant que par les heures du planificateur.
  - **Reste, selon M23** : 320 px (barre latérale de 224 px et en-tête), panneau de fiche de 400 px, trois colonnes de
    l'Explorateur, colonne des filtres de la Recherche, tableaux qui défilent dans leur bloc, zone d'aperçu de la fiche
    sans focus à 320 px (axe, 14 écrans). Constat hors débordement : la référence d'un modèle sur une ligne survolée
    donne 4,38:1 (présent au bureau ; non corrigé à cette étape, corrigé à l'étape 7, §19.6).
- **Image générique** ([exploitation.md](exploitation.md) §10, `Dockerfile`, `.dockerignore`) : trois étapes (`npm ci`,
  build avec `CODEX_STANDALONE=1`, exécution sur `node:22-bookworm-slim`) ; l'image ne garde que `server.js`,
  `package.json`, `node_modules` réduit, `.next` et ses fichiers statiques, `drizzle/` et les commandes de sauvegarde,
  d'export et d'intégrité ; utilisateur `node` non root, `/app` à root ; volume `/var/lib/codex` (`CODEX_DATA_DIR`,
  sauvegardes et exports à côté) ; `HEALTHCHECK` sur `/api/health` par Node ; `CODEX_SEED` non posé ; aucun secret,
  `.env` ni donnée dans le contexte ; proxy TLS d'entreprise pris en charge au build (`HTTPS_PROXY`, secret `npm_ca`).
  - **`next.config.ts`** : `output: 'standalone'` seulement quand `CODEX_STANDALONE=1`. Deux builds par défaut, avant et
    après, ont les mêmes 560 fichiers et la même configuration serveur ; les écarts sont ceux de deux builds du même code
    (identifiant de build, noms de morceaux), plus l'empreinte de `next.config.ts` dans deux traces.
  - **Piège relevé** : Next.js trace tout le projet (le serveur lit `drizzle/` et `package.json` dans son dossier), donc
    `.next/standalone` reprend `.data/` en local ; `outputFileTracingExcludes` n'atteint pas la trace d'`instrumentation`
    (essayé, retiré). D'où la copie explicite dans le `Dockerfile` et l'avertissement dans la documentation.
  - **Limite relevée** : le verrou `codex.lock` compare des numéros de processus, qui ne traversent pas les conteneurs ;
    une commande lancée dans un autre conteneur, numéro 1 comme le serveur, prend son verrou pour le sien (vérifié).
    Documenté : arrêter le conteneur du serveur avant toute commande, jamais deux conteneurs sur un volume, sauvegarde
    depuis l'Administration pendant que le serveur tourne. Non corrigé à cette étape (le verrou est partagé par toutes les commandes) ; corrigé à l'étape 7 (§19.6).
  - **Essayé** : le démon Docker de la session lancé à la main, l'image de base prise sur `mirror.gcr.io` (quota de
    Docker Hub épuisé), build par le proxy de la session ; image de 436 Mo sur disque (106 Mo compressés), conteneur
    `healthy` en 15 s, `npm run a11y -- --url` sur le conteneur sans violation ni erreur au journal, arrêt en 0,3 s avec
    le verrou libéré, base conservée au redémarrage, redémarrage après `docker kill`, sauvegarde créée et listée depuis
    un autre conteneur, ni `.env` ni secret dans l'image ; hors Docker, sortie autonome copiée comme dans l'image,
    `/api/health` 200, `npm run a11y -- --url` sans violation, sauvegarde, vérification, restauration, export et
    intégrité.
- **Documentation** : [accessibilite.md](accessibilite.md), [exploitation.md](exploitation.md) §2 et §10, README
  (contrôles, exploitation, organisation du code), `.env.example` (`CODEX_STANDALONE`),
  [reste-a-faire.md](reste-a-faire.md) (lignes « Avancé » du point 79 et « Préparé » du point 112, état récapitulatif).
- **Vérifié** : `npm run typecheck`, `npm run lint`, `npm run db:check`, `npm test` (106 fichiers dont 1 sauté, 1 431
  tests passés, 13 sautés, aussi avec `.data` déplacé), `npm run build` (sans `.next/standalone`), `npm run a11y`
  (30 écrans et 20 dialogues, 0 violation), `npm run a11y -- --narrow` (190 s), `npm run e2e` (5 parcours sur 5,
  32 étapes, 73 s), `docker build` et le conteneur comme ci-dessus.

### 19.6 Verrou entre conteneurs et contraste au survol (lot 10, étape 7)

Deux défauts relevés à l'étape 6, corrigés sans rien décider (M22 reste ouverte).

- **Verrou du dossier de données** (`src/lib/backup-core.mjs`, [exploitation.md](exploitation.md) §10,
  [sauvegarde.md](sauvegarde.md)).
  - **Défaut** : `codex.lock` identifiait son détenteur par son seul numéro de processus. Dans deux conteneurs sur un
    même volume, le serveur et une commande ont tous deux le numéro 1 : la commande prenait le verrou du serveur pour
    le sien, et un numéro absent de son conteneur le lui faisait croire périmé. Reproduit d'abord par cinq tests
    (`tests/unit/backup-core.test.ts`, verrou d'un « autre espace » simulé : même numéro, autre identifiant et autre
    espace), tous en échec sur le code d'avant.
  - **Correction** : le verrou enregistre en plus `id`, tiré au hasard une fois par processus (gardé sur `globalThis`,
    commun aux copies du module dans un bundle), et `space`, l'espace de processus. Sous Linux, ce sont le démarrage du
    noyau (`boot_id`), l'espace de noms des processus (`/proc/self/ns/pid`) et l'instant de départ de son premier
    processus (`/proc/1/stat`) ; ailleurs, le nom de la machine. Un verrou est « le mien » par son `id` seulement.
    Un verrou d'un autre espace n'est jamais jugé par son numéro : il tient tant qu'il est rafraîchi, et cesse
    10 minutes après. Le serveur rafraîchit désormais son verrou toutes les 30 s, comme les commandes, pour qu'un autre
    conteneur sache qu'il vit. Les messages des commandes le disent : « processus 1, dans un autre conteneur ou sur
    une autre machine ».
  - **Compatibilité** : un verrou de l'ancien format (sans `id` ni `space`) est jugé par son numéro comme avant, mais
    n'est jamais pris pour celui du processus qui le lit : on ne sait pas d'où il vient. Un serveur démarre dessus ;
    une commande de même numéro refuse, avec la consigne de supprimer le fichier si aucun serveur ne tourne.
  - **Piège relevé à l'essai** : le noyau réutilise le numéro d'un espace de noms disparu. Le conteneur lancé après un
    serveur tué a reçu le même `pid:[…]` : sans autre indice, il aurait jugé le verrou par son numéro dans son propre
    espace. D'où l'instant de départ du premier processus, propre à chaque conteneur.
  - **Inchangé** : un serveur ne refuse jamais le verrou d'un serveur (redémarrage après un arrêt brutal) ; deux
    conteneurs serveurs sur un volume restent à proscrire, et arrêter le serveur avant une commande reste la règle.
  - **Essayé avec Docker** (démon de la session, image reconstruite) : serveur en marche, `backup create`,
    `restore latest --replace`, `export create` et `integrity check` dans un autre conteneur refusent (code 1) ;
    `docker exec` aussi. Battement relevé toutes les 30 s. Après `docker kill`, la commande refuse, puis passe une fois
    le verrou vieilli de 11 minutes ; le serveur relancé démarre. Après `docker stop` (0,2 s), plus de verrou. Verrou
    de l'ancien format : la commande refuse, le serveur démarre.
- **Contraste au survol** ([accessibilite.md](accessibilite.md)) : dans « Nouveau document », la référence d'un modèle
  (`.text-muted` à 55 %, 11 px) sur une ligne survolée (`hover-tint`) donnait 4,38:1 (axe : #95969e sur #2f313d).
  Sur une ligne survolée, le texte atténué passe à 60 %, le cran des en-têtes de tableau : 4,91:1 (#9f9fa7). Teinte
  de survol de Nocturne et rendu hors survol inchangés (`src/app/globals.css`). Mesuré par axe dans Chromium sur le
  build de production, ligne survolée, avant (règle neutralisée) et après.
- **Documentation** : [exploitation.md](exploitation.md) §10, [sauvegarde.md](sauvegarde.md) (verrou, dépannage),
  [accessibilite.md](accessibilite.md), README (image générique), [reste-a-faire.md](reste-a-faire.md) (points 79
  et 112).
- **Vérifié** : `npm run typecheck`, `npm run lint`, `npm run db:check`, `npm test` (106 fichiers dont 1 sauté,
  1 436 tests passés, 13 sautés, aussi avec `.data` déplacé), `npm run build`, `npm run a11y` (30 écrans et
  20 dialogues, 0 violation), `npm run e2e` (5 parcours sur 5, 32 étapes, 72 s), image Docker et scénarios ci-dessus.


### Bilan du lot 10

Le lot 10 a préparé, sans en trancher aucune, les réponses que Codex attend de l'utilisateur, et fait ce qui pouvait
l'être sans elles.

- **Pour décider** : une fiche par question O-01 à O-11 ([fiches-decision.md](fiches-decision.md)) ; cahiers de
  validation du registre et de l'organigramme (`npm run registry:review`, `npm run org:check`) ; procédure d'essai de
  SharePoint sur un tenant et `npm run storage:check` ; simulation d'import (`POST /api/import?dryRun=1`) ; image
  générique pour l'hébergement (M22).
- **Vérifié sans décision** : pilote SharePoint contre un faux Microsoft Graph (quatre défauts corrigés) ; constats
  des points 70 à 120 revérifiés et état récapitulatif recompté ; cinq parcours de bout en bout dans la CI ; affichage
  étroit et zoom mesurés, débordements neutres corrigés ; verrou du dossier de données essayé entre deux conteneurs.
- **Corrections neutres** : vocabulaires et D-14, indicateur « En retard », bouton de copie du lien, chiffrement au
  repos documenté, barre latérale, onglets et en-têtes de colonne à l'écran étroit, verrou du dossier de données
  valable d'un conteneur à l'autre, contraste de la référence d'un modèle sur une ligne survolée (§19.6).
- **Points** : aucun ne change d'état. Préparés : 36 (reste), 103, 106, 112, 113 à 118 ; avancés : 57, 79, 87, 88, 94.
- **Toujours ouvert** : O-01 à O-11 ; M22 (hébergement, exploitation) ; M23 (accès terrain et mobile) ; les autres
  questions de l'audit listées en tête de [reste-a-faire.md](reste-a-faire.md).
- **Suites possibles sans décision** : `--narrow --lang en`.

