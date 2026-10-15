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
33. La pagination restait sur « Page 1 sur 1 » quand le nombre de pages était inconnu. **Partiel** : les PDF déjà
    stockés ne sont pas recomptés, ce qui est sans objet après une remise à zéro de la base.
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
