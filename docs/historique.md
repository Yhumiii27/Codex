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
| 11 oct. | « Mes demandes Vigie » dans l'écran Validations | 14 |

La session a été coupée plusieurs fois par une limite d'usage ou de dépense :
- le 7 octobre à 13:38, reprise à 17:31 sur « Try again » ;
- le 7 octobre à 18:07, reprise à 22:43 sur « Try again » ;
- le 8 octobre à 07:35, pendant les corrections de l'app Mac ;
- le 8 octobre à 07:44, sur la limite de dépense. La demande de commit, renvoyée aussitôt, a abouti.

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

## 14. Mes demandes Vigie (11 oct.)

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
