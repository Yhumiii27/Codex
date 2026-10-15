# Journal des décisions — Codex (GED EPC2I)

Ce fichier fait foi pour les décisions prises avec l'utilisateur pendant la session de travail locale du 7 au
9 octobre 2026. Il sert à ce qu'aucune session ne repose une question déjà tranchée. Le modèle détaillé qui en découle
est dans `docs/modele-cible.md`.

Règles de lecture :
- Les réponses de l'utilisateur sont citées mot pour mot, fautes de frappe comprises. Elles priment sur toute
  reformulation, y compris celles de ce fichier.
- « Proposé, non confirmé » désigne une proposition de l'assistant que l'utilisateur n'a ni validée ni contestée
  explicitement. Elle est appliquée dans le code, mais on peut la remettre en cause sans revenir sur une décision.
- Les heures sont en UTC, d'après le journal de la session. L'utilisateur est à Paris (UTC+2).
- Avant de poser une question à l'utilisateur, chercher ici, puis dans « Questions encore ouvertes ».

## À savoir pour reprendre dans une session cloud

- Le deck « Création de la GED EPC2I » est dans le dépôt : `docs/sources/creation-ged-epc2i.pptx`, avec sa
  transcription en texte dans `docs/sources/deck-ged-epc2i.md`. Inutile de le redemander.
- L'audit du deck a été fait le 7 octobre, et ses 10 questions ont reçu leurs réponses (D-06 à D-21). Inutile de le
  relancer avant de toucher au code : le modèle qui en découle est implémenté. Le rapport détaillé est dans
  `docs/audit-deck-epc2i.md`.
- `docs/modele-cible.md` contient aussi des propositions de l'assistant, implémentées mais non confirmées : Entra ID
  (§1), codification hors projet, ID attribué au brouillon, alias et nom de fichier (§3), « Remplacé » et mise en
  vigueur automatique (§4). Il les signale en tête et renvoie ici ; en cas de doute, la section « Choix de l'assistant
  non validés explicitement » de ce fichier fait foi (O-02, O-09). Exemples d'identifiants réels sans rattachement :
  `PRO-QUA-0003`, `PRO-HSE-0003`.
- Ordre de lecture conseillé : ce fichier, `docs/modele-cible.md`, `docs/avancement-v2.md` (état et reste à faire),
  `docs/registre-points-ouverts.md`, `docs/api.md`, `README.md`, `docs/historique.md`.
- Les dépôts voisins Keystone et Vigie ne font pas partie de ce dépôt. La spec Keystone citée plus bas
  (`docs/spec/10-site-docs-mywork-settings.md` du dépôt Keystone) n'est lisible que si ce dépôt est ajouté à la session.
- L'app Mac (`desktop/`, `npm run app`) ne se construit que sur macOS. Dans un conteneur Linux, utiliser `npm run dev`.

## Décisions

### D-01 — Construire Codex d'après la maquette Claude Design
- **Date** : 7 octobre 2026, 10:58.
- **Question** : aucune, c'est la demande de départ.
- **Demande de l'utilisateur** :
  > Regarde dansle dossier Codex et lance la création du software d'après l'extraction de l'IU faite depuis claude design. dit moi si tu as des questions.
- **Décision retenue** : Codex reproduit les 7 écrans de la maquette `design/GED Groupe.dc.html` (design system
  Nocturne), puis évolue vers le modèle issu du deck (D-05 et suivantes).
- **Mise en œuvre** : `design/`, `src/app/nocturne.css`, écrans `src/app/page.tsx`, `src/app/explorateur/`,
  `src/app/documents/[id]/`, `src/app/recherche/`, `src/app/validations/`, `src/app/archivage/`,
  `src/app/administration/`.

> **Source des réponses D-02 à D-04.** Le journal condensé de la session contient les trois questions posées à 10:59,
> mais pas la réponse brute du questionnaire. Les options choisies sont celles que rapporte le résumé de la session.
> L'assistant a répondu « Choix validés » à 11:01 et a construit en conséquence.

### D-02 — Périmètre de la première version : app locale persistée
- **Date** : 7 octobre 2026, 10:59 (questionnaire).
- **Question** : « Quel niveau de réalisation pour cette première version de Codex ? » Deux options : « App locale
  persistée (Recommandé) », avec la même stack que Keystone (Next.js 16 + PGlite/Drizzle), ou « Prototype front
  fidèle », sans base ni upload réel.
- **Réponse de l'utilisateur** (option choisie) : « App locale persistée (Recommandé) »
- **Décision retenue** : Codex a le même socle que Keystone, et chaque action est enregistrée en base.
- **Mise en œuvre** : `package.json` (`npm run dev` sur le port 3100, `npm run db:reset`), `src/db/index.ts` (PGlite
  dans `.data/`), `src/db/schema.ts`, `drizzle/0000_init.sql`.

### D-03 — Utilisateurs et rôles simulés
- **Date** : 7 octobre 2026, 10:59 (questionnaire).
- **Question** : « Comment gérer les utilisateurs et les rôles (collaborateur, validateur, auditeur, gestionnaire) ? »
  Deux options :
  - « Rôle simulé (Recommandé) » : « L'authentification réelle (SSO, etc.) viendra plus tard » ;
  - « Authentification réelle » : « Il faudra alors préciser le fournisseur (SSO entreprise, e-mail/mot de passe…) ».
- **Réponse de l'utilisateur** (option choisie) : « Rôle simulé (Recommandé) »
- **Décision retenue** : il n'y a pas de connexion ; on choisit l'utilisateur et le rôle depuis le profil en bas de la
  barre latérale, et le fournisseur d'authentification reste à choisir (O-02).
- **Mise en œuvre** : `src/lib/context.ts` (cookies `codex-user` et `codex-role`, utilisateur par défaut `cbardet`,
  Claire Bardet), action `simulateUser` dans `src/lib/actions.ts`, matrice des droits `MATRIX` dans
  `src/db/seed-org.ts`.

### D-04 — Affaires Keystone simulées
- **Date** : 7 octobre 2026, 10:59 (questionnaire).
- **Question** : « Keystone n'est encore qu'un squelette. Comment traiter les affaires (onglet Affaire, pièces
  attendues, événements) ? » Deux options :
  - « Affaires simulées (Recommandé) » : une table locale derrière une interface d'intégration isolée, et « Ouvrir dans
    Keystone » vers une URL configurable ;
  - « Base partagée avec Keystone » : « Concevoir dès maintenant un schéma commun / une API entre les deux apps ».
- **Réponse de l'utilisateur** (option choisie) : « Affaires simulées (Recommandé) »
- **Décision retenue** : les projets sont des tables locales lues par un seul module, sans base partagée avec Keystone
  pour l'instant.
- **Mise en œuvre** : `src/lib/keystone.ts` est le seul fichier à remplacer au branchement réel. Le lien est
  `NEXT_PUBLIC_KEYSTONE_URL` + `/projects/{code}`. Les projets `HLT-026`, `NDC-031` et `RCF-019` sont dans `PROJECTS`
  de `src/db/seed-org.ts`. Les tables sont `projects`, `project_expected` et `project_events` dans `src/db/schema.ts`.

### D-05 — Auditer le deck avant de l'intégrer
- **Date** : demande le 7 octobre 2026 à 12:19, audit rendu à 12:40.
- **Demande de l'utilisateur** (deck joint) :
  > Audit le fichier ci-joint qui décrit comment je voulais créer la GED.
  > Fait moi un retour de ce que tu as compris avant d'intégrer cela au projet.
- **Ce que l'audit a trouvé** :
  - Le deck compte 18 slides. L'audit en a tiré 64 exigences et a comparé 48 éléments au code : 6 couverts,
    21 partiels, 12 absents, 9 en conflit.
  - La spec Keystone décrit déjà Codex avec un troisième modèle : un registre de 28 types codés.
  - L'audit recommandait de garder SharePoint comme socle (bibliothèque, banque de termes, versions), Codex remplaçant
    Power Apps et faisant tourner les workflows. **Cette recommandation est écartée par D-06.**
  - L'audit a posé 10 questions à trancher (D-06 à D-21).
- **Décision retenue** : le deck décrit la GED voulue, et les réponses de l'utilisateur aux 10 questions priment sur
  le deck là où elles en diffèrent.
- **Mise en œuvre** : `docs/sources/creation-ged-epc2i.pptx` (le deck), `docs/sources/deck-ged-epc2i.md` (sa
  transcription), `docs/modele-cible.md` (synthèse du deck, de la spec Keystone et des arbitrages). Le rapport
  d'audit détaillé est dans `docs/audit-deck-epc2i.md`.

### D-06 — Socle technique : Codex fait tout, SharePoint en option pour les fichiers
- **Date** : question le 7 octobre à 12:40 (question 1 de l'audit), réponse à 13:38. L'assistant avait annoncé à
  12:21 que ce serait « la première décision à trancher ».
- **Question** : « Socle technique : SharePoint reste-t-il le coffre-fort et la source de vérité, avec Codex comme
  interface ? Ou Codex le remplace-t-il ? Les workflows tournent-ils dans Codex ou dans Power Automate ? »
- **Réponse de l'utilisateur** :
  > Codex prends toute la charge et les workflow, la seule option ouverte si c'est plus simple est que le stockage des documents soit sous une bibliothèque sharepoint gérée par Codex (les metadonnées et autres informations sont dans codex et uniquement le document et son nom et sa version sont mises dans sharepoin)..
- **Décision retenue** : Codex est la seule source de vérité (métadonnées, droits, révisions, circuits, journal
  d'audit), sans Power Automate ni Power Apps, et SharePoint n'est qu'une option de stockage des fichiers pilotée par
  Codex.
- **Mise en œuvre** :
  - `docs/modele-cible.md` §1.
  - `src/lib/storage.ts` : `CODEX_STORAGE=local` par défaut, ou `CODEX_STORAGE=sharepoint` en option. L'accès passe
    par Microsoft Graph en mode application. Il n'a jamais été testé sur un vrai tenant.
- **Reste ouvert** : faut-il activer SharePoint, et selon quelles modalités (O-01).

### D-07 — Un registre des types unique, fusion du deck et de la spec Keystone
- **Date** : question le 7 octobre à 12:40 (question 2 de l'audit), reformulée à 17:33, réponse à 17:52.
- **Question initiale** : « Modèle de référence : le deck, la spec Keystone, ou une fusion des deux en un registre
  unique ? »
- **Première réponse de l'utilisateur** : « Exprime moi cette question autrement je ne comprends pas. »
- **Question reformulée** (17:33) : « Je fusionne les deux en une seule liste de référence, gérée dans Codex ? »
  - Les deux listes sont les 45 types du deck et les 28 types codés de la spec Keystone.
  - La spec Keystone prévoit déjà que le registre appartient à Codex et que Keystone le lit.
  - Elle a été reposée dans les confirmations : « Je fusionne ton deck et la liste de Keystone en une seule liste de
    référence gérée dans Codex ? »
- **Réponses de l'utilisateur** (17:52) :
  > 1- oui fusionne pour le moment on adaptera plus tard

  > pour la question 2: oui fusionne les deux bases
- **Décision retenue** : un registre des types unique, propriété de Codex et provisoire, fusionne les deux listes de
  types. « Les deux bases » désigne ces deux listes, **pas** une base de données commune à Codex et Keystone.
- **Mise en œuvre** :
  - `src/db/registry.ts` : 69 types dans les 23 familles du deck. Chaque type porte son circuit, sa règle de
    conservation, ses niveaux de confidentialité et, quand elle existe, sa clause ISO (40 types sur 69).
  - Le registre est modifiable dans Administration › Registre des types.
  - Keystone le lit par `GET /api/registry` (`src/app/api/registry/route.ts`, `docs/api.md`).
  - Arbitrages restants : `docs/registre-points-ouverts.md` (O-05).

### D-08 — Deux axes : origine et rattachement
- **Date** : question le 7 octobre à 12:40 (question 3 de l'audit), réponse à 13:38.
- **Question** : « Domaine : doit-il être exclusif (un seul des 4 par document) ? Ou faut-il deux axes séparés,
  l'origine et le rattachement ? »
- **Réponse de l'utilisateur** : « Origine et rattachement me parait être la bonen solution »
- **Décision retenue** : le Domaine unique du deck (DI, DE, DP, DR) est remplacé par deux axes indépendants, l'origine
  (interne, externe) et le rattachement (aucun, projet, programme de recherche).
- **Mise en œuvre** :
  - Colonnes `origin` et `attachment` de la table `documents` dans `src/db/schema.ts`.
  - Origines et rattachements admis par type dans `src/db/registry.ts`.
  - `docs/modele-cible.md` §2.
  - Les familles gardent leur groupe d'origine dans le deck (`group: 'DI' | 'DE' | 'DP' | 'DR'` dans
    `src/db/registry.ts`).

### D-09 — Codification des documents de projet : `TYPE-PROJET-SEQ`
- **Date** : question le 7 octobre à 12:40 (question 4 de l'audit), réponse à 13:38.
- **Question** : « Format de l'ID : quels segments, à quel moment il est attribué, ce qu'il devient si on reclasse le
  document, et doit-il s'aligner sur `TYPE-PROJ-SEQ` ? »
- **Réponse de l'utilisateur** :
  > TYPE-Proj-SEQ est une bonne codification pour les documents issus des projets fait moi une proposition pour les autres documents.
- **Décision retenue** : un document rattaché à un projet est codé type, code projet Keystone et numéro de séquence,
  par exemple `PID-HLT-026-001`.
- **Mise en œuvre** : `src/lib/codes.ts` (`contextOf`, `seqWidth`, `formatId`), `src/lib/codification.ts`
  (`nextDocId`), `docs/modele-cible.md` §3.
- **Proposé, non confirmé** :
  - prendre le code projet complet (`HLT-026`) et non le seul code client (`HLT`), que la spec Keystone écrit par
    endroits (`TYPE-CLIENT-SEQ`) ;
  - un numéro sur 3 chiffres, compté par couple (type, projet). La largeur et la portée du compteur viennent de la
    proposition de 17:33 (§3), pas de la réponse de l'utilisateur.

### D-10 — Codification des autres documents ; `QMS` pour les modèles
- **Date** : proposition le 7 octobre à 17:33, réponse à 17:52.
- **Proposition de l'assistant** : `TYPE-CONTEXTE-SEQ`. CONTEXTE est le code projet, le code du programme de recherche
  ou le code du département propriétaire (3 lettres, numéro sur 4 chiffres). Variante : un code unique `QMS` pour tous
  les documents sans rattachement.
- **Question** : « Pour les documents sans rattachement, j'utilise le code du département propriétaire, ou un code
  unique `QMS` ? »
- **Réponse de l'utilisateur** : « 2- QMS est le code pour les templates »
- **Décision retenue** : les modèles de documents (type FRM) prennent le contexte `QMS`, par exemple `FRM-QMS-001`.
- **Interprétation appliquée** (proposé, non confirmé) : en réservant `QMS` aux modèles, l'utilisateur écarte la
  variante « `QMS` pour tout ». Les autres documents sans rattachement prennent donc le code du département
  propriétaire, par exemple `PRO-QUA-0003`, créé lors des tests du 8 octobre. Les documents de recherche prennent le
  code du programme, par exemple `PRT-R2601-004`.
- **Mise en œuvre** : `src/lib/codes.ts` (`TEMPLATE_TYPE = 'FRM'`, `TEMPLATE_CONTEXT = 'QMS'`, `contextOf`),
  `docs/modele-cible.md` §3.
- **Autres points proposés, non confirmés** :
  - Un reclassement avant la première approbation donne un nouvel ID, et l'ancien reste comme alias (colonne
    `aliases` dans `src/db/schema.ts`). Après la première approbation, l'ID ne change plus.
  - Le fichier stocké s'appelle `{ID}_{version}.{ext}`.
  - L'ID est attribué dès la création du brouillon, comme le prévoit le deck.
  - La collision entre codes de type et codes de département (`FIN-FIN-0001`) est le point 1 de
    `docs/registre-points-ouverts.md`.

### D-11 — Révisions : même ID, indices en lettres, validation obligatoire
- **Date** : question le 7 octobre à 12:40 (question 5 de l'audit), réponse à 13:38.
- **Question** : « Cycle de vie et révisions : une révision garde-t-elle le même ID ? L'ancienne passe-t-elle
  « Remplacé » ou « Obsolète » ? Indices en lettres ou en x.y ? Approuvé devient-il En vigueur automatiquement à la
  date d'effet ? »
- **Réponse de l'utilisateur** :
  > Un document ne change pas de nom ni d'ID au passage de version. Il doit passer par un workflow de validation pour être approuvé. Nous n'utilisons que des indices en lettre et pas d'indices majeurs/mineurs.
- **Décision retenue** : une révision garde l'ID et le nom du document, ses indices sont des lettres (A, B, … Z,
  AA…), et elle passe par un circuit de validation avant d'être approuvée.
- **Mise en œuvre** : `src/lib/codes.ts` (`nextLetter`, `lettersUpTo`, `revLabel`), `src/lib/lifecycle.ts`
  (`approveRevision`, `putInForce`, `promoteDue`), tables `revisions` et `workflows` dans `src/db/schema.ts`,
  `docs/modele-cible.md` §4.
- **Proposé, non confirmé** (deux sous-questions restées sans réponse) :
  - la révision précédente passe « Remplacé » ; « Obsolète » est réservé au retrait du document entier (D-17) ;
  - une révision approuvée passe « En vigueur » à sa date d'effet, ou tout de suite si aucune date n'est saisie.

### D-12 — Les versions de travail sont conservées
- **Date** : 7 octobre 2026, 17:52.
- **Contexte** : la proposition de 17:33 indiquait : « la spec Keystone prévoyait des sous-versions de travail (A.1,
  A.2…). Elles disparaissent avec ta règle. »
- **Réponse de l'utilisateur** : « pour le cycle de vie conserve les sous versions de travail »
- **Décision retenue** : pendant la rédaction, une révision a des versions de travail `A.1`, `A.2`… sans changer
  d'indice.
- **Mise en œuvre** :
  - Table `working_versions` dans `src/db/schema.ts` et action `addWorkingVersion` dans `src/lib/actions.ts`.
  - Fichier stocké sous `{ID}_{version}`, par exemple `PRO-HSE-0003_A.2.pdf` (testé le 7 octobre).
  - `docs/modele-cible.md` §4.

### D-13 — Cinq niveaux de confidentialité, « Public » réservé à certains types
- **Date** : question le 7 octobre à 12:40 (question 6 de l'audit), réponse à 13:38. Échelle proposée à 17:33,
  confirmée à 17:52.
- **Question** : « Confidentialité : dans quel ordre se rangent les 4 niveaux ? Faut-il un niveau Public ? Qui voit
  les brouillons ? »
- **Réponse de l'utilisateur** :
  > Il peut y avoir un niveau publique, pour les documents de communication par exemple, le type publique doit être restraint a certaines famille le reste doit être a minima restraint a la diffusion a une extreprise externe ou un client.
- **Proposition de l'assistant** (17:33), du moins au plus protégé :
  1. Public : certains types seulement.
  2. Restreint : diffusable au client ou au partenaire externe désigné ; c'est le minimum pour tout document non
     public.
  3. Interne.
  4. Confidentiel.
  5. Très confidentiel.

  Question posée : « L'échelle de confidentialité de la section 5 te convient ? »
- **Réponse de l'utilisateur** : « 3- oui »
- **Décision retenue** : il y a 5 niveaux dans cet ordre, et « Public » n'est admis que pour les types qui
  l'autorisent dans le registre. Ce classement change le sens de « Restreint » par rapport au deck, où c'était le
  niveau le plus protégé.
- **Mise en œuvre** :
  - Type `Conf` dans `src/db/schema.ts`.
  - `confAllowed` et `confDefault` de chaque type dans `src/db/registry.ts`.
  - `canRead` dans `src/lib/access.ts`.
  - `docs/modele-cible.md` §5.
- **À noter** : l'utilisateur parle de « familles », le registre l'applique type par type. Aujourd'hui, « Public » est
  admis pour 5 types : POL, REG, DTF, PUB et COL. Cette liste est provisoire (O-08).

### D-14 — Qui voit les brouillons
- **Date** : réponse le 7 octobre à 13:38 (question 6 de l'audit), complément à 17:52.
- **Réponse de l'utilisateur** :
  > La personne propriétaire ou qui modifiera un document via une ECO verra les brouillons des documents qui lui sont liés/attribués.
- **Question complémentaire** (17:33) : « En plus du propriétaire et du modificateur, les valideurs du circuit et les
  gestionnaires documentaires voient-ils les brouillons ? »
- **Réponse de l'utilisateur** : « 5- oui »
- **Décision retenue** : brouillons et versions de travail sont visibles par le propriétaire, le modificateur
  désigné, les valideurs du circuit en cours et les gestionnaires documentaires ; les autres lecteurs ne voient que la
  révision en vigueur.
- **Mise en œuvre** : `inDraftingCircle`, `canRead`, `readerMaySeeVersion`, `readerMaySeeRevision` et
  `readerMaySeeEntry` dans `src/lib/access.ts` ; colonne `audit_log.revision_id`, qui rattache une entrée du journal
  à sa révision ; `auditForReader` (écrans et export CSV du journal) et `visibleModified` (date « Modifié ») dans
  `src/lib/queries.ts` ; `docs/modele-cible.md` §5. Fait le 10 octobre 2026 (étape 1). Quelques indices de l'existence
  d'une révision ouverte restent visibles hors du cercle ; ils sont listés au point 26 de `docs/reste-a-faire.md` et
  attendent un arbitrage de l'utilisateur.

### D-15 — Circuits par fonction et par type, sans « autorité d'approbation »
- **Date** : question le 7 octobre à 12:40 (question 7 de l'audit), réponse à 13:38.
- **Question** : « Circuits : quelle matrice type → circuit ? Et quel rôle exact pour l'« autorité d'approbation » ? »
- **Réponse de l'utilisateur** :
  > Nous devons construire cela en fonction des roles et des documents mais des workflow differents sont a prévoir, il n'y a pas a proprement parler d'autorité d'approbation cela depend des documents.
- **Décision retenue** : il y a plusieurs circuits, définis par type et composés d'étapes par fonction résolues au
  lancement, sans champ « autorité d'approbation ».
  - Exemples de fonctions : Responsable qualité, Direction, chef de projet.
  - Le champ « autorité d'approbation » est celui de la slide 18 du deck.
- **Mise en œuvre** : `circuit` de chaque type dans `src/db/registry.ts`, `FUNCTIONS` et `HOLDERS` dans
  `src/db/seed-org.ts`, écran Administration › Fonctions & circuits, `docs/modele-cible.md` §6.
- **Provisoire** : la matrice type → circuit et les titulaires des fonctions sont des valeurs de démonstration, non
  validées par l'utilisateur (O-06).
- **Proposé, non confirmé** : le demandeur du circuit, le modificateur désigné (à défaut le propriétaire) et les
  auteurs des versions de travail ne valident jamais la révision ; ils sont écartés du circuit (`circuitExclusions`
  dans `src/lib/actions.ts`). Cette règle vient des relectures de code du 7 octobre (11:35) et du 8 octobre
  (constat 4 de la relecture v2, `docs/historique.md` §6). L'utilisateur ne l'a pas exprimée.

### D-16 — Les ECR/ECO sont centralisés dans Vigie
- **Date** : question le 7 octobre à 12:40 (question 8 de l'audit), réponse à 13:38.
- **Question** : « ECR/ECO : quelles étapes ? Quel lien avec le module ECO de Keystone ? »
- **Réponse de l'utilisateur** :
  > Je pense que les ECR/ECO doivent être centralisées dans "Vigie", quelles soient projet ou documentaires.
- **Décision retenue** : Vigie (application sœur, dépôt séparé) gère les demandes de modification (ECR/ECO) des
  projets comme des documents. Codex crée les demandes pour ses documents et applique les décisions : un ECO accepté
  ouvre la révision suivante en brouillon, attribuée au modificateur désigné.
- **Mise en œuvre** :
  - `src/lib/vigie.ts` (`submitChange`, références `ECR-AAAA-NNN`).
  - Table `change_requests` dans `src/db/schema.ts`.
  - `applyChangeDecision` dans `src/lib/lifecycle.ts`.
  - Webhook `POST /api/integrations/vigie` (`src/app/api/integrations/vigie/route.ts`, `docs/api.md`).
  - Tant que `VIGIE_API_URL` n'est pas défini, un gestionnaire documentaire simule la décision de Vigie depuis la
    fiche du document (`simulateVigieDecision` dans `src/lib/actions.ts`).
- **Non tranché** :
  - Les étapes de l'ECR/ECO relèvent de Vigie, qui n'a pas encore ce module.
  - L'assistant a proposé de faire pointer vers Vigie le module ECO de Keystone et sa spec ; ce n'est pas confirmé
    (O-10).

### D-17 — Le passage à « obsolète » est un workflow Vigie
- **Date** : question le 7 octobre à 17:33, réponse à 17:52.
- **Question** : « La demande de passage à « obsolète » passe-t-elle aussi par un ECR dans Vigie, ou reste-t-elle un
  workflow interne à Codex ? »
- **Réponse de l'utilisateur** : « 4- c'est un workflow vigie »
- **Décision retenue** : le retrait d'un document est une demande traitée par Vigie. Une fois la demande acceptée,
  Codex passe le document « Obsolète ».
- **Mise en œuvre** : `kind: 'obsolescence'` de la table `change_requests` dans `src/db/schema.ts`, `requestChange`
  dans `src/lib/actions.ts`, `applyChangeDecision` dans `src/lib/lifecycle.ts`, `docs/modele-cible.md` §4.
- **Proposé, non confirmé** : un retrait accepté clôt aussi le circuit en cours et annule les révisions ouvertes
  (`applyChangeDecision`, `src/lib/lifecycle.ts`). C'est un correctif de la relecture du 8 octobre (constat 5,
  `docs/historique.md` §6), pas une demande de l'utilisateur.

### D-18 — Les demandes se font depuis Codex ou depuis Keystone
- **Date** : 7 octobre 2026, 17:52. L'utilisateur a donné cette précision sans question préalable, en réponse à la
  section « Ce que ça implique dans les autres applications » de 17:33.
- **Réponse de l'utilisateur** :
  > pour vigie, il va gérer les ECO/ECR mais les demandes doivent pouvoir etre faites depuis codex pour les documents ou depuis keystone pour les sujets liés au projets ou au projet lui meme.
- **Décision retenue** : une demande se crée depuis Codex pour un document, ou depuis Keystone pour un sujet projet ou
  pour le projet lui-même, et c'est Vigie qui la traite.
- **Mise en œuvre** : côté Codex, `requestChange` dans `src/lib/actions.ts` ; la colonne `source` de
  `change_requests` vaut `codex` par défaut.
- **À faire** : prendre en compte les demandes nées dans Keystone. Aujourd'hui, le webhook Vigie répond 404
  (`not_found`) à une demande que Codex n'a pas enregistrée lui-même (`src/app/api/integrations/vigie/route.ts`).

### D-19 — Organisation réelle fournie plus tard
- **Date** : question le 7 octobre à 12:40 (question 9 de l'audit), réponse à 13:38.
- **Question** : « Organisation réelle : quelles sont les vraies sociétés, les vrais sites et les vrais départements ? »
- **Réponse de l'utilisateur** : « Je te donnerais un organigramme des services et des sites plus tard »
- **Décision retenue** : départements, sites et personnes restent provisoires jusqu'à l'organigramme.
- **Mise en œuvre** :
  - `src/db/seed-org.ts` : `DEPARTMENTS` (15 codes, de DIR à RDI), `SITES` (Lyon, Le Havre, Marseille) et personnes
    alignées sur le jeu de données de Keystone.
  - Ces valeurs sont modifiables dans Administration › Organisation : ajout, renommage (libellés FR/EN), désactivation
    et réactivation, suppression d'une valeur inutilisée (15 octobre ; règles non confirmées, voir « Choix de
    l'assistant non validés explicitement »).
  - En attente (O-04).

### D-20 — Conservation par type de document
- **Date** : question le 7 octobre à 12:40 (question 10 de l'audit), réponse à 13:38.
- **Question** : « Conservation et migration : quelles classes de conservation, avec quelles durées ? Quels volumes et
  quels emplacements faut-il migrer ? »
- **Réponse de l'utilisateur** : « La conservation des documents sera selon les règles d'usage par type de document. »
- **Décision retenue** : chaque type porte dans le registre une règle de conservation (durée, événement déclencheur,
  sort final, justification), que le document reçoit de son type et qu'un gestionnaire peut modifier.
- **Mise en œuvre** : `retention` de chaque type dans `src/db/registry.ts`, `src/lib/retention.ts`, écran Archivage,
  `docs/modele-cible.md` §8.
- **Provisoire** : les durées sont des propositions issues de la fusion deck + Keystone. L'utilisateur ne les a pas
  validées une à une (O-07).

### D-21 — La migration se fait hors de Codex
- **Date** : réponse le 7 octobre à 13:38 (question 10 de l'audit).
- **Réponse de l'utilisateur** :
  > La migration sera faite via un code dédié fait qpecifiquement pour cette tache et ne sera pas intégré dans codex directement
- **Décision retenue** : la reprise de l'existant est un programme séparé, hors de ce dépôt.
- **Mise en œuvre** :
  - Codex expose une API d'import que ce programme appellera : `POST /api/import` (`src/app/api/import/route.ts`,
    `src/lib/importer.ts`, `docs/api.md`). L'assistant l'a proposée à 17:33 ; elle n'a pas été contestée.
  - L'API est fermée (503) tant que `CODEX_IMPORT_TOKEN` n'est pas défini.
- **Non communiqué** : les volumes et emplacements à migrer (O-11).

### D-22 — Une app Mac lancée depuis le bureau
- **Date** : 8 octobre 2026, 06:21.
- **Demande de l'utilisateur** : « fait une app que je puisse lancer depuis le bureau de mon mac »
- **Décision retenue** : une app macOS native démarre le serveur de production de Codex et l'arrête quand on la quitte.
  - Elle est écrite en Swift (Cocoa et WebKit), sans Electron.
  - Le serveur tourne sur le port 3110.
  - L'app est installée dans le dossier Applications de l'utilisateur, avec un alias sur le bureau.
  - Ses données sont séparées de celles du serveur de développement.
- **Mise en œuvre** : `desktop/CodexApp.swift`, `desktop/build-app.sh`, `desktop/make-icon.swift`,
  `desktop/make-alias.swift`, script `npm run app`, section « Application Mac » de `README.md`.
- **Reste à faire** : les corrections restantes sont listées dans `docs/avancement-v2.md` (T-02). L'app ne se construit
  que sur macOS.

### D-23 — Premier commit
- **Date** : demande le 8 octobre 2026 à 07:44. Le commit a été réécrit le 9 octobre à 14:19.
- **Question** : « Veux-tu que je fasse le premier commit ? » (7 octobre, 11:39). Elle n'a pas eu de réponse directe.
- **Demande de l'utilisateur** (envoyée deux fois, la première s'étant heurtée à une limite d'usage) : « Commit the
  working tree changes with a sensible message. »
- **Décision retenue** : le premier commit est fait.
  - Commit local `db26518` du 8 octobre, « Codex GED: application Next.js, modèle documentaire v2 et app Mac »,
    99 fichiers.
  - Il est sur une nouvelle branche `codex-ged-v2`. C'est un choix de l'assistant, car `main` était alors vide.
  - Le 9 octobre, avant toute publication, il a été réécrit en `d05d498`. Le contenu est le même ; seule l'identité
    Git de l'auteur a changé.
  - Le commit qui figure dans l'historique est donc daté du 9 octobre 2026.
- **Mise en œuvre** : aucun secret n'est commité. `.data`, `.next`, `node_modules` et `desktop/dist` sont exclus.

### D-24 — `.gitignore`, dépôt GitHub privé et publication
- **Date** : demande le 9 octobre 2026 à 14:17, confirmation à 14:21.
- **Demande de l'utilisateur** :
  > Add a .gitignore that excludes secrets (.env, keys, passwords) and build folders, initialize git if needed, commit everything, create a private GitHub repository called Codex and push to it.
- **Question de l'assistant** : il fallait que l'utilisateur connecte lui-même `gh` à GitHub. « Dites-moi quand c'est
  fait. »
- **Réponse de l'utilisateur** : « c'est fait »
- **Décision retenue** : le code est publié dans le dépôt privé `Yhumiii27/Codex`, sur les branches `main` (par
  défaut) et `codex-ged-v2`, toutes deux sur le commit `ef1df85`.
- **Mise en œuvre** :
  - `.gitignore` exclut les fichiers `.env*` sauf `.env.example`, ainsi que les clés et certificats, les fichiers
    d'identifiants et de mots de passe, les dossiers de build et `.data`.
  - Commit `ef1df85` « Gitignore : exclure les secrets et les sorties de build ».

### D-25 — Continuer entièrement dans une session cloud
- **Date** : 9 octobre 2026, 15:00.
- **Demande de l'utilisateur** :
  > voici ce que me dit la session cloud après le tranfer, fait en sorte de corriger pour que je puisse continuer intégralement dans la session cloud
- **Décision retenue** : tout ce qui n'existait que dans la session locale est versionné dans le dépôt : le deck,
  l'audit, les décisions et l'historique.
- **Mise en œuvre** :
  - `CLAUDE.md` ;
  - `docs/sources/creation-ged-epc2i.pptx` et `docs/sources/deck-ged-epc2i.md` ;
  - ce fichier ;
  - `docs/historique.md` ;
  - le rapport d'audit, `docs/audit-deck-epc2i.md` ;
  - la section « Décisions et points ouverts » de `README.md`.

### D-26 — Modification acceptée alors qu'une révision est déjà ouverte : greffe ou attente
- **Date** : question le 10 octobre 2026 (fin du lot 2), réponse le 11 octobre.
- **Question** : « Que doit-il se passer quand Vigie accepte une modification pendant un gel, alors qu'une révision
  est déjà ouverte ? Aujourd'hui, la décision reste « acceptée » après la levée du gel et rien ne l'applique ensuite.
  Faut-il l'appliquer quand la révision ouverte entre en vigueur, ou la signaler pour qu'elle soit traitée à la
  main ? »
- **Réponse de l'utilisateur** :
  > si une ouverture de revision d'un document est en cours alors soit la modification vient se greffer sur la modification en cours soit il faudra attendre que la rvision soit validée avant d'en ouvrir une nouvelle
- **Décision retenue** : quand une modification acceptée par Vigie arrive alors qu'une révision du document est déjà
  ouverte, elle a deux issues :
  - **greffe** : la révision ouverte intègre la modification et porte aussi sa référence ECO ;
  - **attente** : la modification reste acceptée, puis ouvre la révision suivante une fois la révision en cours
    validée.
- **Interprétations appliquées** (proposé, non confirmé) :
  - le choix entre greffe et attente se fait sur la fiche du document, par un gestionnaire documentaire ou par le
    modificateur de la révision ouverte ; tant que personne n'a choisi, c'est l'attente qui vaut, sans rien perdre ;
  - la greffe n'est possible que si la révision ouverte est en rédaction ; en cours de validation, ou approuvée en
    attente de sa date d'effet, seule l'attente est possible (greffer obligerait à relancer le circuit) ;
  - « validée » s'entend « mise en vigueur » ; si la révision ouverte est annulée, la modification en attente ouvre
    alors la révision suivante ;
  - la règle vaut pour toute révision ouverte, pas seulement après un gel : une demande de modification peut donc être
    faite depuis Codex pendant qu'une révision est ouverte (elle était refusée jusque-là, `locked_working`).
- **Mise en œuvre** : voir `docs/historique.md` (section du 11 octobre) et `docs/api.md` (webhook Vigie).

## Questions posées restées sans réponse directe

| Date | Question de l'assistant | Suite |
|---|---|---|
| 7 oct., 11:39 | « Quelles durées de rétention et quels libellés de circuits sont les bons ? La maquette les note comme « à valider avec le Juridique ». » | Remplacée par D-15 et D-20. La mention du Juridique vient des notes de la maquette, pas de l'utilisateur. |
| 7 oct., 11:39 | « Quel fournisseur d'authentification veux-tu (SSO d'entreprise, autre) pour remplacer la simulation ? » | Jamais répondue (O-02). |
| 7 oct., 11:39 | « Keystone exposera-t-il une API, ou les deux applications partageront-elles une base ? » | Jamais répondue explicitement (O-03). |
| 7 oct., 11:39 | « Veux-tu que je fasse le premier commit ? » | Fait le 8 octobre à la demande de l'utilisateur (D-23). |
| 7 oct., 12:40 | Question 4 : « à quel moment il est attribué, ce qu'il devient si on reclasse le document » | Pas de réponse ; la proposition de l'assistant est appliquée (D-10). |
| 7 oct., 12:40 | Question 5 : « L'ancienne passe-t-elle « Remplacé » ou « Obsolète » ? » et « Approuvé devient-il En vigueur automatiquement à la date d'effet ? » | Pas de réponse ; la proposition de l'assistant est appliquée (D-11). |
| 7 oct., 12:40 | Question 7 : « quelle matrice type → circuit ? » | Principe tranché (D-15), matrice provisoire (O-06). |
| 7 oct., 12:40 | Question 8 : « quelles étapes ? » (ECR/ECO) | Relève de Vigie (D-16, O-10). |
| 7 oct., 12:40 | Question 10 : « Quels volumes et quels emplacements faut-il migrer ? » | Pas de réponse ; la migration est hors de Codex (D-21, O-11). |
| 7 oct., 12:40 | « Je peux mettre l'audit détaillé (64 exigences, 48 écarts, taxonomie complète) dans une page à partager si tu veux. » | Pas de réponse. Le rapport est dans `docs/audit-deck-epc2i.md`. |
| 7 oct., 17:33 ; reposée à 18:07, à 23:18 et le 8 oct. à 06:18 | « Pour SharePoint : un fichier par révision, et aucun accès direct des utilisateurs à la bibliothèque ? » | Jamais répondue (O-01). |
| 7 oct., 23:18 ; 8 oct., 06:18 | Arbitrages du registre, organigramme, branchements réels de Keystone, de Vigie et d'Entra ID | En attente (O-04, O-05, T-01). |
| 8 oct., 07:09 et 07:36 | Tester soi-même, dans la fenêtre de l'app Mac, le dépôt d'un fichier et un téléchargement | Pas de retour (T-02). |

## Choix de l'assistant non validés explicitement

Ces choix sont appliqués dans le code, mais l'utilisateur ne les a pas confirmés.
- **Codification** (D-09, D-10) :
  - code département pour les documents sans rattachement ;
  - code programme pour la recherche ;
  - code projet complet ;
  - compteur par couple (type, contexte), sur 3 chiffres par projet ou programme et 4 par département ;
  - ID attribué dès la création du brouillon ;
  - nouvel ID avec alias en cas de reclassement avant la première approbation ;
  - nom de fichier `{ID}_{version}.{ext}`.
- **Cycle de vie** (D-11) : « Remplacé » pour la révision précédente, mise en vigueur automatique à la date d'effet.
- **Circuits** (D-15) : le demandeur du circuit, le modificateur désigné et les auteurs des versions de travail sont
  écartés de la validation.
- **Rejet motivé et rappel d'une demande de validation** (G17, 11 octobre ; `docs/modele-cible.md` §6) : un rejet
  exige un motif de 2 000 caractères au plus, gardé sur le circuit, dans ses commentaires et au journal (entrée
  rattachée à la révision, donc masquée hors du cercle de rédaction tant qu'elle n'est pas en vigueur, D-14). Le
  demandeur, ou un gestionnaire documentaire, peut rappeler un circuit en cours tant que la dernière approbation n'est
  pas faite : il lui faut le droit « Modifier » (celui qui permet de demander la validation), une place dans le cercle
  de rédaction et un document non verrouillé ; le motif est facultatif. Le circuit est clos « Rappelé », issue
  distincte du rejet, et la révision revient en rédaction, comme après un rejet. Le propriétaire qui n'a pas fait la
  demande ne peut pas la rappeler. Abandonner un brouillon jamais mis en vigueur (statut « Annulée ») reste une règle
  à faire valider.
- **Recherches enregistrées** (G12, G15, 11 octobre ; `docs/modele-cible.md` §5) : toute personne qui a le droit
  « Lire » enregistre des recherches personnelles, visibles d'elle seule, et les supprime. Partager une recherche avec
  un département (ses membres) ou avec tout le groupe, et supprimer une recherche partagée, est réservé aux
  gestionnaires documentaires et aux détenteurs du droit « Administrer » ; ils voient aussi les recherches partagées
  avec les autres départements, pour les gérer, mais jamais les recherches personnelles d'autrui. Une recherche ne
  garde que des critères (texte, facettes, période) et l'ordre choisi, jamais de documents. Les trois recherches de
  démonstration sont partagées avec le groupe.
- **Recherche : facettes, période et tri** (G15, G32, 11 octobre ; point 12 de `docs/reste-a-faire.md`) :
  - l'auteur est celui que la fiche affiche (texte libre, sinon l'utilisateur auteur, sinon le propriétaire) ;
  - une seule période à la fois, sur une date au choix ; un document sans cette date n'y entre pas ; la date d'effet
    est celle de la révision en vigueur ;
  - sans tri choisi : pertinence s'il y a un texte, date de modification sinon ; « échéance » est la plus proche des
    dates de révision et d'expiration ;
  - pertinence : ID et anciens ID, puis titre, mots-clés, référence externe et ID d'étude, puis le reste ; un champ
    entier compte plus qu'un début de mot, qui compte plus qu'un morceau de mot ;
  - au-delà de 8 options, une facette replie les autres sous « N de plus » (écart avec la maquette, qui affiche
    tout) ; la période est en bas de la colonne des filtres.
- **Pages par département** (G12, FON-06, 11 octobre ; point 11 de `docs/reste-a-faire.md`, question A19 de l'audit) :
  un squelette, en attendant le recueil des besoins par département (slide 9) et l'organigramme (O-04) :
  - une page par département provisoire, `/departements` ouvrant celle du département de l'utilisateur (la première
    pour qui n'en a pas), chacun pouvant consulter les autres ; mise en page de l'Accueil, sans nouvelle identité ;
  - elle montre ce que les autres écrans montrent déjà à l'utilisateur, limité au département : documents en vigueur
    qu'il peut lire, échéances (règles de l'Accueil), circuits en cours qu'il suit (règle de Validations : tous pour un
    gestionnaire, sinon ceux auxquels il prend part), recherches partagées avec le département puis avec le groupe ;
  - les « filtres mis en avant » sont des facettes de la recherche, dont la page donne les valeurs les plus fréquentes
    avec un lien vers la recherche filtrée ; par défaut type de document, statut, projet ou programme, pour tous les
    départements ; 6 au plus par département ;
  - les régler est réservé à qui a le droit « Administrer » (Administration › Organisation), comme le reste de
    l'organisation ; aucun choix par métier n'est fait à la place des départements.
- **Cohérence des dates** (règle 12 de l'audit, « émission ≤ effet ≤ expiration », 12 octobre ; point 3 de
  `docs/reste-a-faire.md`) :
  - la date d'émission est la première mise en vigueur du document dans Codex (`docs/api.md`) : la réception d'un
    document externe ne peut pas la suivre, le même jour étant admis ;
  - « postérieure » est pris au sens strict : une expiration ou une revue le jour même de l'émission, et une
    expiration le jour de la date d'effet, sont refusées ;
  - un document pas encore émis le sera au plus tôt aujourd'hui, ou à la date d'effet de la révision qui l'émettra :
    son expiration et sa date de révision doivent suivre ce jour (création, métadonnées, demande de validation, import
    d'un brouillon ou d'une mise en vigueur à venir) ;
  - la date d'effet qui borne l'expiration est la plus tardive de la révision en vigueur et d'une révision approuvée
    ou en revue ; une révision en revue sans date d'effet prendra effet à son approbation, au plus tôt aujourd'hui :
    une expiration saisie pendant son circuit doit suivre ce jour ;
  - sans date d'effet, la demande de validation d'un document déjà émis est acceptée, même s'il a expiré
    (renouvellement) : la nouvelle expiration se saisit une fois la révision en vigueur, et les lecteurs ne la voient
    pas pendant le circuit (D-14). Le dialogue de métadonnées la demande alors. Ce qui se passe à l'expiration reste
    une question de l'audit (A17, « alerte, passage Obsolète, renouvellement ») ; rien n'est tranché ici ;
  - une date incohérente avec les dates enregistrées (émission, dates d'effet) bloque l'enregistrement des
    métadonnées tant qu'elle n'est pas corrigée, même si l'on ne la modifie pas ; le dialogue désigne le champ. Les
    bornes qui dépendent du jour (document pas encore émis, révision en revue sans date d'effet) ne s'appliquent qu'à
    une date saisie ou modifiée : le temps seul ne bloque pas l'enregistrement d'une date laissée telle quelle ;
  - les messages de la demande de validation ne supposent pas le droit de modifier les métadonnées : ils disent que
    le report se fait par le propriétaire du document ou un gestionnaire documentaire ;
  - l'import refuse aussi une mise en vigueur antérieure à la date d'émission.
- **Expiration et revue périodique** (G36, G37, question A17 de l'audit, 12 octobre ; point 13 de
  `docs/reste-a-faire.md`, `docs/modele-cible.md` §7) :
  - aucun nouveau statut ni automatisme : « Expiré » et « Revue en retard » sont des indicateurs ; le passage à
    Obsolète reste une demande à Vigie (D-17), que la fiche d'un document expiré propose en raccourci, comme la
    demande de modification qui le renouvellera. Ce qui doit se passer à l'expiration (A17 : alerte, passage Obsolète,
    renouvellement) n'est pas tranché ;
  - un document devient expiré le lendemain de sa date d'expiration : le jour même, il est encore valide, comme le
    comptent les échéances (« 0 j restants »), et les écrans le disent « valable jusqu'au » cette date ; seuls les
    documents actifs portent les indicateurs (un document obsolète ou archivé ne s'applique plus), et la revue en
    retard suppose une révision en vigueur ;
  - dans l'explorateur, « Expirés » et « Revues en retard » forment un filtre « Échéance dépassée » sous le plan de
    classement (`?due=`), combiné au filtre de statut, plutôt que deux valeurs de plus dans la barre de statut, qui
    garde la largeur de la maquette ;
  - « Revue effectuée » est réservée au propriétaire, au propriétaire de processus et aux gestionnaires documentaires
    (la fiche du point 13 nommait le propriétaire et le gestionnaire), avec le droit « Modifier », sur un document
    non verrouillé qui a une révision en vigueur. Elle ne crée pas de révision ; elle date la fiche (« Modifié ») et
    se journalise sur le document entier, visible de ses lecteurs, valeurs comprises (D-14) ; commentaire facultatif
    de 2 000 caractères au plus ; la prochaine date est postérieure à aujourd'hui, ou, sans date saisie, la
    périodicité du type comptée depuis le jour de la revue. Dans « À traiter », le propriétaire de processus reçoit
    désormais toujours ses revues (il peut les enregistrer) ; pour une expiration, il ne la reçoit toujours que s'il
    peut demander une modification ;
  - la périodicité de revue est un nombre de mois (1 à 240) porté par le type, vide pour tous les types : ni le deck,
    ni la spec Keystone, ni `docs/registre-points-ouverts.md` n'en donnent de valeur (O-05, comme les durées de
    conservation, O-07). Elle ne fixe la date de révision à la mise en vigueur que si celle-ci est vide : une date
    saisie, même passée, n'est pas recalculée, si bien qu'une nouvelle révision en vigueur ne vaut pas revue ; à la
    création, le dialogue l'annonce sans pré-remplir la date ; l'import (migration) reprend les dates telles quelles,
    sauf une révision approuvée à venir, qui reçoit la périodicité à sa mise en vigueur ;
  - modifier les métadonnées n'applique pas la périodicité : vider la date de révision d'un document en vigueur le
    laisse sans revue planifiée (ni « Revue en retard », ni échéance) jusqu'à la mise en vigueur d'une prochaine
    révision. Le dialogue des métadonnées le dit pour un document en vigueur, et n'annonce le calcul qu'avant toute
    mise en vigueur. Recalculer la date à l'enregistrement serait une règle nouvelle, non retenue sans accord ;
  - données de démo : une vérification périodique expirée (`MNT-CHA-0002`) et une revue en retard
    (`PRO-QUA-0002`, revue prévue le 30 septembre 2026) ont été ajoutées pour montrer les indicateurs.
- **Liens entre documents** (question M11 de l'audit, 12 octobre ; point 16 de `docs/reste-a-faire.md`,
  `docs/modele-cible.md` §4) :
  - trois natures seulement, celles de la fiche du point 16 : « remplace », « remplacé par » (le même lien lu depuis
    l'autre document) et « voir aussi ». Référence, annexe, enregistrement issu d'une procédure, documents touchés par
    une ECR et le caractère obligatoire d'un lien restent la question M11 ;
  - un seul lien par paire de documents, quel qu'en soit le sens ou la nature : un « voir aussi » ne double pas un
    « remplace », et un retrait accepté avec remplacement proposé transforme en « remplace » un « voir aussi » entre
    les deux (le journal garde le retrait de l'un et l'ajout de l'autre) ;
  - le remplacement proposé à la demande de retrait est facultatif, actif (ni obsolète ni archivé) et lisible par le
    demandeur ; un document qu'il ne peut pas lire reçoit la même réponse qu'un document inexistant. Le lien n'est
    créé qu'à l'application du retrait accepté (au nom de Vigie, avec l'ECO), pas à la demande : un document encore en
    vigueur ne se dit pas « remplacé ». Vigie ne reçoit ni ne renvoie ce remplacement : Codex le garde sur la demande
    (`change_requests.replacement_id`) ; le contrat avec Vigie reste à définir (O-10) ;
  - le remplacement est revérifié quand le retrait s'applique, parfois longtemps après la demande (acceptation en
    attente d'un verrou). Codex ne lie rien et ne touche à aucun lien existant entre les deux documents si le
    remplaçant n'est plus actif (obsolète, archivé) ou s'il est sous gel juridique, ou si un lien « remplace » existe
    déjà en sens inverse. Le journal du document retiré l'indique (« Remplacement non appliqué », avec la raison).
    Le lien n'est pas repris à la levée du gel : le propriétaire des deux documents ou un gestionnaire l'ajoute alors
    depuis la fiche ;
  - depuis la fiche, seul un document déjà retiré par Vigie (obsolète, archivé ensuite ou non) peut être « remplacé »,
    et seulement par un document actif, comme à la demande de retrait : un document obsolète ou archivé ne remplace
    rien. Pour un document en vigueur, il faut passer par la demande de retrait (D-17). Un lien s'affiche sur les deux
    fiches, et « remplacé par » dans le bandeau du document retiré : ajout et retrait demandent donc les droits sur
    **les deux documents**, c'est-à-dire en être le propriétaire, ou être gestionnaire documentaire, avec le droit
    « Modifier », et pouvoir les lire. Le propriétaire d'un remplaçant ne retire donc pas le « remplacé par » posé par
    Vigie sur un document retiré qui n'est pas à lui ; un « voir aussi » vers le document d'un autre propriétaire
    passe par un gestionnaire. Le verrou d'un document obsolète ou archivé ne bloque pas ses liens (ils disent à ses
    lecteurs où aller) ; un gel juridique, sur l'un ou l'autre document, les fige, à l'ajout comme au retrait. Un lien
    ne date pas la fiche (« Modifié ») ;
  - visibilité (D-14) : un document lié que le lecteur ne peut pas lire n'apparaît ni dans la section « Documents
    liés », ni dans le bandeau, ni dans le remplacement proposé d'une demande ; l'entrée de journal qui le nomme est
    retirée du journal de ce lecteur (fiche, onglet Journal, export). Quand le document lié devient lisible (mise en
    vigueur d'un brouillon), le lien et son entrée apparaissent ;
  - l'import (migration) ne transmet pas de liens : un champ de liens serait un contrat à définir avec l'outil de
    migration (O-11) ; en attendant, ils s'ajoutent depuis les fiches ;
  - données de démo : un lien « voir aussi » entre la procédure « Levage et manutention sur chantier » et l'arrêté du
    1er mars 2004 sur la vérification des appareils de levage.
- **Fiche de visa** (P08 et M05 de l'audit, 12 octobre ; point 21 de `docs/reste-a-faire.md`, `docs/modele-cible.md`
  §6) :
  - elle n'existe que pour une révision approuvée (en vigueur, remplacée, approuvée en attente de sa date d'effet, ou
    annulée après approbation) : une révision en rédaction ou en revue n'a pas de preuve d'approbation, même pour son
    cercle de rédaction, qui suit son circuit dans l'onglet Validation ;
  - elle se donne à qui lit le document et voit la révision (D-14) : hors du cercle de rédaction, la révision en
    vigueur et celles qu'elle a remplacées. Un auditeur l'obtient donc avec son seul droit « Lire ». Pour un document
    obsolète ou archivé, la règle est celle du fichier : qui peut encore le consulter n'est pas tranché (A13, P07), rien
    ne change de ce côté ;
  - elle ne montre à chacun que ce que Codex lui montre déjà ailleurs. Tout lecteur de la révision y lit les circuits,
    leur issue et leur motif (comme dans l'onglet Validation), ainsi que les décisions, leurs titulaires et les
    délégations (comme dans l'Historique). Le texte des commentaires d'un circuit, et le titulaire d'une étape jamais
    décidée (non atteinte, ou laissée sans décision par un rappel ou une clôture), ne vont qu'à qui suit ce circuit :
    gestionnaire documentaire, demandeur ou titulaire d'une de ses étapes, la règle de l'écran Validations. Les autres
    lecteurs, propriétaire et auditeurs compris, lisent seulement le nombre de commentaires et le fait qu'ils se lisent
    dans le circuit. Faut-il donner ces commentaires à tout lecteur de la révision, et donc élargir leur diffusion
    au-delà de ce que montre l'application ? La question est à poser à l'utilisateur ;
  - pas de signature électronique, ni cachet, ni empreinte : la question de la signature reste ouverte (M04). La fiche
    dit qu'elle est un extrait du journal de Codex, édité tel jour par telle personne, et qu'elle ne porte pas de
    signature électronique ;
  - chaque édition est journalisée sous une action propre, « Fiche de visa éditée » (plutôt que « Téléchargement »),
    rattachée à la révision : hors du cercle, elle n'apparaît qu'une fois la révision en vigueur. Une requête HEAD ne
    journalise rien ;
  - contenu : tous les circuits de la révision, dans l'ordre, rejetés et rappelés compris ; pour chaque étape, le
    titulaire final (après délégation), sa décision et son moment, pris dans le journal à la minute près, sinon le jour
    gardé sur l'étape ; les délégations lues dans le journal (« déléguée par … à … le … ») ; l'issue du circuit et son
    motif ; ses commentaires (pour qui suit le circuit), y compris ceux que Codex écrit au rejet ou au rappel, qui
    répètent le motif ;
  - une révision importée déjà approuvée dit que son approbation a eu lieu dans l'ancien système, sans date
    d'approbation : l'import ne transmet ni approbateurs ni date d'approbation (champ `legacyApproval`, point 99, qui
    attend O-11). Une révision importée en brouillon, puis approuvée par un circuit de Codex, garde sa date
    d'approbation et son circuit ; la fiche dit seulement quand elle a été reprise en brouillon de l'ancien système. On
    distingue les deux cas ainsi : seul un circuit de Codex approuve une révision dans Codex, donc une révision importée
    sans circuit approuvé l'a été dans l'ancien système. Une révision sans circuit ni import (l'historique des données
    de démo) dit qu'aucun circuit n'est enregistré dans Codex ;
  - langue de l'interface du lecteur, PDF en téléchargement (`{ID}_{lettre}_VISA.pdf`), même pour un document obsolète
    ou archivé (pas de suffixe `_OBSOLETE` ou `_ARCHIVE` : l'état du document figure dans la fiche).
- **Modifications simultanées** (12 octobre ; point 20 de `docs/reste-a-faire.md`, `docs/modele-cible.md` §4 et §7) :
  - détection optimiste seulement : rien n'est réservé pendant qu'un dialogue est ouvert. Une modification faite
    depuis une vue périmée de la fiche est refusée, sans rien écrire, et le dialogue garde la saisie en proposant
    « Recharger la fiche » ; la saisie n'est ni fusionnée ni reprise automatiquement ;
  - la version d'un document change à toute modification réelle de sa fiche, quel qu'en soit l'auteur ou le chemin
    (métadonnées, revue, lecteurs désignés, demande de validation, rejet ou rappel, approbation finale et mise en
    vigueur, décision de Vigie, gel, archivage, et le premier dépôt du jour, qui date la fiche « Modifié ») : un
    dialogue de métadonnées ouvert avant l'une d'elles est périmé, même si elle ne touche pas les champs saisis. Une
    écriture qui ne change rien à la fiche (approbation d'une étape intermédiaire, second dépôt du jour, demande de
    modification à Vigie) ne la fait pas changer : la base ignore une mise à jour sans effet ;
  - les métadonnées et les lecteurs désignés suivent cette règle (les lecteurs, rangés à part, changent la version de
    la fiche) ; les liens, la revue périodique et les décisions de circuit ne la vérifient pas : ils ne réécrivent pas
    un formulaire entier (un lien existe une fois par paire, une revue ne fixe que la prochaine date de revue, une
    décision vérifie déjà l'étape vue) ;
  - un dépôt de version de travail est refusé dès qu'une version plus récente que la dernière montrée par le dialogue
    existe, avec son numéro et son auteur, même si son auteur est la même personne (deux onglets) ; les deux versions
    restent conservées une fois la seconde déposée en connaissance de cause (D-12). Une demande de validation suit la
    même règle (« rechargez la fiche pour la voir avant de demander la validation ») : un circuit ne part pas, et un
    type sans circuit (correspondance, photos) n'entre pas en vigueur, sur une version que le demandeur n'a pas vue ;
  - la personne nommée est l'auteur de la dernière modification de la fiche : celui dont l'action l'a modifiée, que le
    journal enregistre dans la même opération ; une personne plutôt que Codex quand Codex met la révision en vigueur
    dans l'opération d'une approbation ; Codex, ou Vigie, quand ils l'ont modifiée seuls (mise en vigueur à la date
    d'effet, décision reçue). Une écriture qui n'a pas changé la fiche (téléchargement, demande de modification,
    second dépôt du jour) ne nomme pas son auteur ; une modification que le journal n'enregistre pas ne nomme
    personne. Seul le cercle de rédaction reçoit ce refus et la version de la fiche (D-14) : elle change aussi avec le
    travail sur le brouillon (dépôt, révision ouverte ou envoyée en validation), et vaut 0 pour les autres lecteurs ;
  - un formulaire sans version (page ouverte avant cette règle) est refusé de la même façon, sans nommer personne ;
    un formulaire sur l'ancien ID d'un document reclassé entre-temps reçoit ce refus plutôt que « Document
    introuvable », pour qui pouvait encore modifier le document ;
  - **proposé, non appliqué, à confirmer** : la réservation d'une révision en brouillon (« Réserver » et « Libérer »
    sur la fiche, libération forcée par un gestionnaire documentaire, dépôt refusé à toute autre personne que celle
    qui l'a réservée, mention « Réservé par … »). Elle change la façon de travailler du cercle de rédaction
    (propriétaire, modificateur désigné, gestionnaires) : elle attend l'accord de l'utilisateur.
- **Listes filtrées et paginées par la base** (12 octobre ; point 50 de `docs/reste-a-faire.md`) :
  - la recherche, son export, l'explorateur et l'onglet Journal donnent exactement ce que donnait la version en
    mémoire, gardée comme référence des tests, jusque dans les cas limites : une marque d'ordre d'octet en tête d'un
    texte libre est ignorée comme le faisait la lecture par PGlite, et un critère contenant un caractère NUL ne trouve
    rien au lieu de provoquer une erreur ;
  - 50 résultats par page dans Recherche et dans l'Explorateur ; le nombre de résultats et les comptes des facettes
    restent ceux de toute la recherche. Changer de critère, de tri ou de texte revient à la première page ; une page
    au-delà de la dernière montre la dernière. L'export CSV de la recherche garde tous les résultats (écart avec la
    maquette, qui ne pagine pas) ;
  - onglet Journal : 100 entrées par page (500 auparavant, sans suite), « Plus récentes » et « Plus anciennes » ;
    filtres par morceau d'ID de document ou de cible (casse ignorée), personne, action et période en jours, heure de
    Paris ; l'ID actuel d'un document retrouve les entrées écrites sous ses anciens ID seulement si le lecteur peut
    lire ce document (sinon il apprendrait son reclassement, D-14) ; l'export CSV reste complet et sans filtre ;
    un paramètre répété dans l'URL (explorateur, journal) garde sa première valeur, un curseur ou un jour hors de
    portée est ignoré plutôt que de provoquer une erreur ;
  - la base replie le texte cherché (accents, casse) et trie les titres selon ses propres tables Unicode et ICU
    (PGlite : Unicode 16.0, ICU 76), pour la requête comme pour les valeurs : la recherche reste cohérente quelle que
    soit la version de Node. La référence en mémoire suit celles de Node : identiques sous Node 22 ; sous Node 26
    (Unicode 17.0), un caractère ajouté par Unicode 17.0 peut être replié autrement par la référence que par la base
    (README, « Version de Node ») ;
  - tailles de page et index (trigrammes) choisis sans connaître le volume réel (O-11) : à revoir avec la migration.
- **Retrait** (D-17) : effets d'un retrait accepté sur le travail en cours (circuit clos, révisions ouvertes annulées).
- **Documents obsolètes ou archivés** (D-17) : bandeau d'avertissement sur la fiche et dans l'aperçu rapide de
  l'explorateur, suffixe `_OBSOLETE` ou `_ARCHIVE` dans le nom proposé au téléchargement (`docs/modele-cible.md` §4).
  Qui peut encore les consulter ou les télécharger n'est pas tranché (A13, P07) : rien n'a changé de ce côté.
- **Décision Vigie sur un document verrouillé** (D-16, D-17) : une acceptation reçue pendant un gel juridique ou un
  archivage est enregistrée (demande « Acceptée ») et s'applique à la levée du gel ou à la restauration ; le webhook
  répond 202 au lieu de 409. La fiche signale la décision en attente ; hors du cercle de rédaction, elle ne nomme ni
  l'ECO ni le modificateur d'une modification (même règle que pour une révision ouverte, D-14). Vigie n'est pas
  prévenu quand la décision s'applique (O-10).
- **Modification acceptée pendant une révision ouverte** (D-14, D-26) : le modificateur désigné par Vigie pour une
  modification qui attend la révision ouverte entre dans le cercle de rédaction, au sens de D-14 (« qui modifiera un
  document via une ECO ») : il voit la révision ouverte et l'attente, mais n'y dépose pas de version de travail, ne la
  soumet pas au circuit et ne greffe pas sa modification (réservé au modificateur de la révision ouverte et aux
  gestionnaires documentaires). Greffée, la modification est rédigée par le modificateur de la révision ouverte : celui
  désigné par Vigie sort alors du cercle, et seul le journal garde la trace de ce changement.
- **Modificateur désigné par Vigie** (D-16) : il doit pouvoir rédiger le document (droit de dépôt de son rôle par
  défaut, accès au document), comme le modificateur par défaut ; sinon la décision est refusée (webhook 400
  `modifier_not_allowed`, erreur dans la simulation). S'il perd ce droit pendant qu'une acceptation attend la levée
  d'un verrou, la révision s'ouvre pour le modificateur par défaut, avec une ligne de journal et un message à qui lève
  le verrou, plutôt que de laisser la décision en attente sans issue. C'est vrai même si le modificateur par défaut ne
  peut pas rédiger non plus (ou s'il est la personne écartée) : le journal et le message le signalent alors
  (`docs/api.md`).
- **Journal d'audit** (étape 6, G48) :
  - les entrées sans document (droits, organisation, titulaires de fonction, registre des types, exports) ne se
    lisent que depuis l'écran d'administration : un auditeur sans le droit « Administrer » n'en voit aucune ;
  - un commentaire de circuit est journalisé par l'ID du circuit, sans son texte, qui reste dans le circuit ;
  - l'avant et l'après sont stockés en codes (`audit_log.data`) et affichés dans la langue du lecteur ; hors du
    cercle de rédaction, les valeurs d'une modification de métadonnées sont retenues quand elles datent d'un
    brouillon ou d'un niveau de confidentialité plus strict, et le détail d'une entrée sur un document illisible est
    retiré (`docs/modele-cible.md` §5) ;
  - l'export du journal est inscrit à la fin du téléchargement (ou à son interruption, avec le nombre de lignes
    envoyées) : un arrêt brutal du serveur pendant l'export ne laisse pas de trace. Une requête HEAD sur un export
    ne journalise rien ;
  - le déclencheur qui rend le journal en ajout seul est posé à chaque démarrage (`src/db/index.ts`), pas dans la
    migration, que l'on régénère tant qu'il n'y a pas de base de production.
- **Authentification cible Entra ID** : proposée le 7 octobre à 12:40 (« passer à l'authentification Entra ID ») et à
  17:33 (lot 4 « Authentification Entra ID et organigramme »). L'utilisateur n'en a jamais parlé (O-02).
  `docs/modele-cible.md` §1, `docs/api.md`, `docs/avancement-v2.md` et le commentaire de
  `src/app/api/registry/route.ts` la présentent pourtant comme la cible.
- **API d'import** pour l'outil de migration (D-21).
- **Autres applications** (D-16) : créer un module ECR/ECO dans Vigie, et faire pointer vers Vigie le module ECO de
  Keystone et sa spec.
- **Contenu du registre** (D-07, D-13, D-15, D-20) :
  - 69 types ;
  - codes donnés aux types du deck (POL, GOV, RSQ, DTF, PRT…) ;
  - circuits ;
  - durées de conservation ;
  - types qui admettent « Public ».
- **« À traiter »** (G19, 11 octobre) : une seule liste pour l'encart de l'Accueil, la pastille et la cloche
  (`myActions`, `src/lib/queries.ts`). Une révision en rédaction jamais soumise attend son modificateur désigné par un
  ECO (« à rédiger ») et son propriétaire, qui peut aussi la soumettre (« en brouillon », avec « confiée à … » quand un
  ECO a désigné quelqu'un d'autre) ; renvoyée en rédaction par un rejet, elle attend l'auteur de l'étape Rédaction, le
  modificateur et le propriétaire. Une modification acceptée en attente (D-26) est proposée à la greffe au modificateur
  de la révision ouverte (à défaut le propriétaire) et à tous les gestionnaires documentaires, qui peuvent la greffer.
  Les revues et expirations retenues sont celles d'Archivage (dépassées ou à moins de 90 jours), pour le propriétaire
  et le propriétaire de processus ; la fin de conservation reste aux gestionnaires, dans Archivage. Un élément
  n'apparaît que si le serveur laisserait l'utilisateur agir (droits du rôle simulé, verrou, cercle de rédaction).
- **Écarts volontaires avec la maquette** (7 octobre) :
  - le rôle « Gestionnaire documentaire » a le droit « Valider » ;
  - les échéances sont triées par date ;
  - le point rouge des notifications n'apparaît que s'il y a quelque chose à traiter (le 7 octobre : des validations
    en attente ; depuis le 11 octobre : toute la liste « À traiter ») ;
  - les documents de démonstration sans fichier affichent « aperçu de démonstration » ;
  - depuis le 11 octobre, la pastille est sur Accueil, qui porte toute la liste « À traiter », et non plus sur
    Validations, qui ne montre que les circuits ; l'encart « À traiter » n'a plus de lien « Tout voir » ;
    l'indicateur « À valider » compte toujours les seules étapes à décider.
- **En-têtes de sécurité et limites de débit** (points 24 et 25 de `docs/reste-a-faire.md`, 15 octobre ; hébergement
  et authentification non décidés, O-02) :
  - HSTS et `upgrade-insecure-requests` ne sont envoyés qu'avec `CODEX_HTTPS=1`, coupés par défaut : on ne sait pas
    encore où ni derrière quel proxy TLS Codex sera servi, et en local comme dans l'app Mac il est en HTTP. Durée d'un
    an, sans `includeSubDomains` ni `preload` (d'autres applications du groupe peuvent vivre sur des sous-domaines) ;
  - politique de sécurité du contenu des pages avec un nonce par requête ; styles en ligne admis (le code et React en
    posent) ; pas de politique sur les réponses de l'API (JSON, fichiers) ni sur les appels de Server Actions, que
    `src/proxy.ts` ne voit pas (sinon Next.js recopie leur corps et coupe les dépôts au-delà de 10 Mo) ;
    `frame-ancestors 'self'` et `X-Frame-Options: SAMEORIGIN` ; `Referrer-Policy: strict-origin-when-cross-origin` ;
  - seuils par défaut (600 imports ou décisions Vigie, 300 lectures du registre, 600 fichiers, 30 exports et 120
    écritures par minute ; 20 jetons refusés par 15 minutes) choisis généreux pour l'usage local, sans mesure d'un
    usage réel ; réglables par `CODEX_RATE_*` ;
  - `X-Forwarded-For` n'est tenu pour fiable qu'avec `CODEX_TRUST_PROXY=1`, coupé par défaut : on ne sait pas encore
    s'il y aura un proxy inverse devant Codex, et sans lui le client écrit cet en-tête lui-même. Règle retenue : une clé
    que le client choisit ne bloque jamais un tiers. Par défaut, les budgets d'import et de Vigie ne sont comptés
    qu'une fois le jeton vérifié, le bon jeton passe toujours (seuls les jetons faux reçoivent 429 au-delà du quota),
    le registre n'est pas limité, et fichiers, fiches de visa et exports comptent par utilisateur résolu, jamais par la
    valeur brute du cookie. Avec `CODEX_TRUST_PROXY=1` s'ajoutent le registre par adresse, un plafond par adresse pour
    fichiers et exports, et le blocage d'une adresse qui a épuisé ses essais de jeton, même avec le bon (le jeton
    n'est plus comparé) ;
  - tant qu'il n'y a pas d'authentification (O-02), un client peut se faire passer pour un autre utilisateur et
    dépenser son budget de fichiers, d'exports ou d'écritures ;
  - compteurs en mémoire, pour une seule instance (PGlite l'impose déjà), une table par famille, au plus 10 000 clés
    chacune ; seul un seau redevenu plein est oublié. Plusieurs instances demanderaient un magasin partagé ou une limite
    au proxy.
- **Fichiers déposés : formats, taille, antivirus** (point 32 de `docs/reste-a-faire.md`, 15 octobre ; question M12 de
  l'audit non tranchée, hébergement non décidé) :
  - une seule liste blanche d'extensions pour tous les types de document (la liste par type attend M12), choisie
    d'après le registre : documents Office et OpenDocument, PDF, RTF, texte, CSV, Visio, Project, courriels, images
    (dont HEIC pour les photos de chantier), MP4 (supports de formation), plans et maquettes (DWG, DXF, STEP, IGES, IFC,
    STL), JSON et XML. Les archives (`.zip`…) sont refusées par défaut, puisqu'elles peuvent porter n'importe quoi
    au-delà du contrôle de format ; les extensions Office à macros (`.docm`, `.xlsm`…), les exécutables, scripts, pages
    web, SVG et images disque le sont toujours, même ajoutés par `CODEX_FILE_EXTENSIONS` ;
  - signature vérifiée pour les formats où elle est fiable, conteneurs compris : un fichier Office récent doit être le
    paquet qu'il annonce (`[Content_Types].xml` dans le ZIP ; `mimetype` ou le manifeste pour OpenDocument), un fichier
    Office 97-2003 un fichier composé dont le répertoire se lit. Une extension admet plusieurs contenus quand l'usage
    l'impose : un `.docx`, `.xlsx`, `.pptx` (et leurs modèles, `.vsdx`) **chiffré** par un mot de passe ou une étiquette
    de confidentialité est un fichier composé (`EncryptedPackage`) et reste admis, pour que les documents les plus
    sensibles puissent entrer dans la GED, bien que ni Codex ni clamd ne voient ce qu'il contient ; un `.doc` peut être
    du RTF. Un fichier sans extension n'est admis que si son contenu désigne un format admis sans ambiguïté (PDF, image,
    DWG ; pas un conteneur ZIP ou OLE2) ;
  - les macros VBA sont refusées quelle que soit l'extension (`vbaProject.bin` dans un ZIP, `_VBA_PROJECT` dans un
    fichier composé, y compris dans un message Outlook qui embarque un tel fichier). Les macros de PowerPoint 97-2003,
    les macros Excel 4.0 et les macros Basic d'OpenDocument ne sont pas détectées : elles relèvent de l'antivirus ;
  - le nom retenu est le dernier segment du nom reçu, sans caractères de contrôle ou bidirectionnels ni séparateurs,
    points ou espaces finaux, et c'est sous ce nom que le fichier est contrôlé, enregistré, nommé dans le stockage et
    téléchargé : l'extension contrôlée est celle que voit le poste qui ouvre le fichier. Un fichier sans extension
    prend celle de son contenu (PDF), jamais celle du type annoncé à l'envoi, qui n'est pas contrôlé ;
  - une seule taille maximale pour l'écran et l'import, **50 Mo** par défaut (`CODEX_MAX_FILE_MB`) : la limite que
    l'écran avait déjà. L'import, jusque-là à 100 Mo, descend à 50 Mo ; les volumes de la migration ne sont pas connus
    (O-11), et l'outil de migration peut relever la limite le temps de la reprise ;
  - l'analyse antivirus se branche par `CODEX_CLAMD` (clamd, `INSTREAM`) et reste **désactivée sans configuration**,
    pour ne pas casser l'usage local ni l'app Mac : le journal du serveur et l'onglet Journal d'audit de
    l'administration le disent. Un scanner configuré qui ne répond pas fait **refuser** le dépôt
    (`CODEX_CLAMD_ON_ERROR=accept` pour l'accepter sans analyse) ;
  - un fichier que clamd n'examine pas faute de limites suffisantes (au-delà de `StreamMaxLength`, ou signalé
    « Heuristics.Limits.Exceeded » avec `AlertExceedsMax`) est **refusé** comme tel, avec sa cause, et non comme une
    panne passagère (import : 413 `scan_too_large`, sans `Retry-After`). La documentation demande de régler
    `MaxFileSize` et `MaxScanSize` au moins à la taille maximale et d'activer `AlertExceedsMax`, faute de quoi clamd
    répond « OK » sans analyser ;
  - le fichier est contrôlé et analysé avant d'être écrit dans le stockage (local ou SharePoint) : un fichier infecté
    n'y entre jamais. Le refus est journalisé comme une entrée sans document (cible « Fichier déposé »), lisible
    seulement dans l'administration. Pour un dépôt à l'écran, le nom du fichier, qui peut donner l'identifiant et la
    version d'un brouillon (`PRO-ING-0007_A.2.docx`), et le document visé ne sont montrés qu'aux gestionnaires
    documentaires ; les autres administrateurs lisent la voie, l'extension, la taille et la menace, pour ne rien montrer
    du travail en cours hors du cercle de rédaction (D-14). L'entrée d'un import garde le nom et la référence ancienne.
    Les refus de format ne sont pas journalisés ;
  - les fichiers déjà stockés ne sont ni recontrôlés ni réanalysés. Seule la copie d'un modèle refait les contrôles,
    puisque son fichier entre dans un nouveau document : un modèle déposé dans un format désormais refusé n'est plus
    copiable, et le refus nomme le modèle et demande à son propriétaire d'en déposer une nouvelle version. La
    réanalyse de l'existant reste à faire (point 32 de `docs/reste-a-faire.md`).
- **Fichiers servis en flux et nettoyage du stockage** (points 46 et 36 de `docs/reste-a-faire.md`, 15 octobre ;
  hébergement, authentification (O-02) et SharePoint (O-01) non décidés) :
  - le navigateur ne garde une copie que du fichier final de la révision en vigueur, sous le niveau Confidentiel, et la
    revalide à chaque usage (`Cache-Control: private, no-cache`) : les droits sont contrôlés à chaque fois et l'aperçu
    ne retélécharge plus le PDF à chaque page. Brouillons (D-14), documents confidentiels et très confidentiels et
    téléchargements explicites restent en `no-store`, comme avant : l'historique d'un navigateur peut réafficher une
    copie gardée sans redemander, et un poste peut être partagé (utilisateurs simulés tant qu'O-02 est ouverte). Pour
    eux, l'aperçu paginé retélécharge encore tout le fichier à chaque page (point 46, reste) ;
  - un téléchargement (`?download=1`) est journalisé quand sa réponse part du premier octet (200, ou 206 à partir de
    0) : la reprise d'un téléchargement interrompu n'ajoute pas d'entrée. Il ne reçoit jamais 304 : il est toujours
    envoyé, donc toujours journalisé. La consultation dans l'aperçu n'est pas journalisée, comme avant ;
  - plusieurs plages dans une requête reçoivent le fichier entier (pas de `multipart/byteranges`) ; une plage mal
    formée reçoit 416, comme une plage au-delà du fichier ;
  - le nettoyage des fichiers orphelins est une action d'administration réservée aux gestionnaires documentaires qui
    ont l'accès Administration, parce que les noms stockés portent l'identifiant et la version des brouillons (D-14) ;
    la recherche est une simulation, la suppression demande un second clic confirmé et ne porte que sur les fichiers
    que la simulation a listés, chacun revérifié juste avant (un orphelin apparu depuis attend la recherche suivante) ;
    délai de grâce de 24 h (1 h au moins, `CODEX_ORPHAN_GRACE_HOURS`) compté depuis la dernière écriture, le dernier
    lien ou le dernier déplacement du fichier ; 200 fichiers au plus par passage, une entrée de journal par passage avec
    la liste ; seuls les noms que Codex donne sont examinés. SharePoint est listé, jamais nettoyé, tant que le pilote n'a pas été essayé sur un vrai
    tenant (O-01). Pas de commande npm : PGlite n'ouvre la base que dans un seul processus, celui du serveur ; le
    planificateur (point 38 de `docs/reste-a-faire.md`) appellera la même fonction.
- **Sauvegarde et restauration** (point 48 de `docs/reste-a-faire.md`, 15 octobre ; procédure dans
  `docs/sauvegarde.md`. Hébergement, fréquence, lieu de conservation, chiffrement, perte de données et délai de reprise
  tolérés (M22 de l'audit) non décidés ; SharePoint (O-01) non décidé) :
  - une archive tar par sauvegarde (`codex-backup-<instant UTC>.tar`) : la base telle que PGlite la vide
    (`dumpDataDir`, compressée), les fichiers locaux que ses versions de travail référencent, et un manifeste (date,
    origine, version, migration du schéma, nombres, taille et SHA-256 de chaque entrée). Les fichiers qu'aucune
    version ne référence (orphelins, dépôts en cours) ne sont pas sauvegardés ; les fichiers stockés sur SharePoint
    sont comptés, pas copiés ;
  - cohérence : la base est vidée pendant que sa connexion unique est tenue (transaction PGlite), après un
    `CHECKPOINT` ; les écritures attendent pendant ce temps (quelques secondes). Les fichiers sont lus ensuite, sans
    bloquer la base : un fichier stocké n'est jamais réécrit, un fichier référencé n'est retiré qu'après que la
    référence a changé, et un fichier renommé entre-temps est lu sous son nouveau nom (même UUID, mêmes octets). Pas de
    lien dur vers les fichiers : il déplacerait leur `ctime` et retarderait d'autant leur nettoyage comme orphelins ;
  - archives dans `CODEX_BACKUP_DIR`, par défaut à côté du dossier de données (`.data-backups/`), hors de `.data/`
    pour survivre à `npm run db:reset`, sur le même disque : cela protège d'une erreur ou d'une base abîmée, pas de la
    perte du disque. Non chiffrées, lisibles par le seul compte qui fait tourner Codex (dossier `0700`, fichiers
    `0600`) : la clé et la copie hors de la machine dépendent de l'hébergement. Rotation, après relecture de la
    nouvelle : les 7 plus récentes (`CODEX_BACKUP_KEEP`) et la plus récente de chacun des 7 derniers jours (UTC) où une
    sauvegarde a été faite, soit 14 au plus : des sauvegardes faites à la suite n'écartent jamais les jours d'avant ;
  - aucune sauvegarde programmée, faute de fréquence décidée ; le planificateur (point 38) pourra appeler la même
    fonction ;
  - sauvegarde depuis Administration (serveur en marche) réservée aux gestionnaires documentaires ayant l'accès
    Administration, comme le nettoyage du stockage : l'archive contient tous les brouillons et son manifeste nomme les
    fichiers (D-14). Entrée de journal « Sauvegarde créée » avec l'archive, sa taille, le début de son SHA-256 et des
    nombres, sans nommer de document ; ces nombres et tailles ne sont montrés qu'aux gestionnaires documentaires, car
    le nombre total de documents dirait à un autre lecteur du journal combien lui sont cachés (D-14). Une sauvegarde
    depuis l'application au plus tous les quarts d'heure (après la dernière archive, quelle que soit son origine), pour
    qu'une suite de clics n'écarte pas par la rotation les archives d'avant ; la commande n'a pas ce délai. Ni
    téléchargement ni restauration depuis l'application ;
  - restauration seulement en ligne de commande, serveur arrêté (`npm run restore`). Refus d'une base ou de fichiers
    déjà présents sans `--replace` ; avec `--replace`, l'existant est déplacé dans `replaced-<instant>/`, jamais
    supprimé. Refus d'une archive altérée ou dont la migration n'est pas dans `drizzle/` (schéma régénéré) : drizzle
    rejouerait sinon la migration unique sur la base restaurée. La base est chargée à côté, ses nombres, sa migration
    et ses fichiers comparés au manifeste avant de remplacer quoi que ce soit ; entrée « Base restaurée » au journal de
    la base restaurée, au nom de l'acteur système Codex. Mise en place entrée par entrée (les dossiers `pglite/` et
    `files/` restent, qu'ils soient des points de montage ou des liens symboliques ; copie d'un système de fichiers à
    l'autre), jamais par-dessus une entrée existante ; si un déplacement échoue, ceux faits sont défaits et rien n'est
    remplacé ; si le retour arrière échoue aussi, la commande s'arrête et dit ce qui est où, sans rien supprimer ;
  - verrou `codex.lock` dans le dossier de données (PGlite n'ouvre la base que dans un processus, et son propre
    `postmaster.pid` porte toujours -42) : les commandes refusent de tourner tant que le serveur qui l'a écrit vit, et
    le serveur refuse d'ouvrir la base pendant une sauvegarde ou une restauration en ligne de commande, et son erreur
    nomme le fichier à supprimer si aucune commande ne tourne. Un verrou dont le processus n'existe plus est ignoré ;
    une commande rafraîchit le sien toutes les 30 s, et il est ignoré 10 minutes après son dernier rafraîchissement
    (commande tuée, numéro de processus repris). Un verrou que le serveur ne peut pas écrire ne l'empêche pas de
    démarrer ;
  - commandes en JavaScript (`src/lib/backup-core.mjs`, `scripts/codex-backup.mjs`), lancées par Node seul, sans
    chargeur TypeScript : elles marchent avec toute version de Node admise par `engines` (20.19 compris). Elles lisent
    les variables comme Next (`@next/env`, installé avec Next), en mode production par défaut (`next start` et l'app
    Mac) et en mode développement avec `--dev`, et affichent d'abord les dossiers sur lesquels elles travaillent. Le
    jour où la base passera sur un Postgres serveur (point 51), la sauvegarde passera à `pg_dump` ou aux outils de
    l'hébergeur.
- **Journal technique, santé et contrôle de la configuration** (points 37 et 49 de `docs/reste-a-faire.md`,
  15 octobre ; procédure dans `docs/exploitation.md`. Hébergement et exploitation non décidés (question 3 de l'audit),
  authentification simulée (O-02), SharePoint non décidé (O-01)) :
  - **refus de démarrer en production** : une configuration classée « erreur » arrête le serveur au démarrage
    (`next start`, app Mac), code de sortie 1, la raison écrite au journal : `CODEX_STORAGE` inconnu, SharePoint
    incomplet ou mal formé, jeton d'intégration de moins de 32 caractères ou de moins de 10 caractères différents (ou
    contenant un espace), adresse Vigie ou Keystone qui n'est pas une URL `http(s)` ou qui porte un identifiant ou un
    mot de passe, `CODEX_CLAMD` illisible, dossier de données non inscriptible. Le reste n'est qu'un avertissement. En
    développement, rien n'arrête le serveur. `CODEX_CONFIG_CHECK=warn` lève le refus (dépannage), `strict` l'impose
    aussi en développement. La configuration par défaut (aucune variable) n'a aucune erreur : rien ne change pour
    `npm run dev` ni pour l'app Mac ; un `.env.local` qui garderait un jeton d'exemple (`change-me`) empêcherait en
    revanche l'app Mac de démarrer, avec la raison dans son journal. Seuil de 32 caractères : la moitié de ce que donne
    `openssl rand -base64 32` (44), recommandé par `docs/api.md` ;
  - le contrôle vérifie la forme des valeurs, sans contacter clamd ni SharePoint ; `VIGIE_API_URL` défini alors que
    Codex n'appelle pas encore Vigie est un avertissement, pas une erreur (la simulation des décisions disparaît ; les
    décisions passent alors par le webhook) ; en production, un avertissement rappelle à chaque démarrage que les
    utilisateurs sont simulés par cookie (O-02) ;
  - **`GET /api/health` sans authentification** : elle répond 200 ou 503, la version de Codex (`package.json`) et le
    résultat de chaque contrôle (base, stockage), jamais la raison d'un échec, ni chemin, ni adresse, ni document.
    SharePoint y est sondé au plus une fois par minute. Pas de route `/api/ready` distincte : un seul processus, qui ne
    répond qu'après le contrôle de configuration. La joignabilité de clamd n'y figure pas (premier dépôt) ;
  - **journal en JSON en production**, app Mac comprise (son `server.log` change donc de forme ; `CODEX_LOG_FORMAT=pretty`
    le rend lisible), lisible en développement, niveau `info` par défaut ; sur la sortie standard, sans rotation ni
    envoi ailleurs (hébergement) ;
  - **contenu du journal** : une ligne par requête d'API (route par son modèle, sans identifiant de document ni chaîne
    de requête ; statut ; durée jusqu'au début de la réponse) et par Server Action d'écriture (nom, issue : `ok`,
    `refused`, `stale`, durée ; jamais le message montré à l'utilisateur, qui peut nommer des personnes ou des
    documents) ; y figurent l'identifiant de l'utilisateur dont une écriture est refusée par la limite de débit,
    l'adresse du client dont un jeton est refusé (avec la raison, jamais le jeton ; `client` derrière un proxy de
    confiance seulement, sinon `forwardedFor` marqué non fiable, puisque le client a pu l'écrire), la clé ou le nom
    d'un fichier dont le stockage ou l'analyse échoue (comme avant), mais aucun jeton, cookie, corps de requête ni
    contenu de document ; d'une erreur, nom, message, code et lignes « at » de la pile, jamais les valeurs d'une
    requête de base en échec (le message de Drizzle est réduit au SQL paramétré, la valeur citée par PostgreSQL masquée)
    ni le `detail` d'une erreur de base. Une Server Action qui échoue ainsi remet à Next.js une erreur refaite sans ces
    valeurs, puisque Next.js imprime lui-même, dans la même sortie, l'erreur entière ; une erreur pendant le rendu d'une
    page reste imprimée par Next.js telle quelle (limite signalée dans `docs/exploitation.md` §4). Une requête d'API
    qui lève une erreur répond 500 `{"error":"internal","requestId"}` au lieu de la page d'erreur de Next.js, comme
    `/api/import` et `/api/integrations/vigie` pour l'erreur qu'elles rattrapent. La 503 `disabled` d'un point
    d'entrée sans jeton, état par défaut, est écrite au niveau `info`, pas `error` : un client anonyme ne peut pas
    remplir le journal d'erreurs ;
  - identifiant de requête : l'en-tête `X-Request-Id` d'un reverse proxy est repris s'il est un simple jeton, sans
    exiger `CODEX_TRUST_PROXY` (il ne sert qu'à relier des journaux), sinon un UUID ; renvoyé sur les réponses d'API.
    Une Server Action reçoit un UUID, non renvoyé au navigateur. Next.js signalant parfois deux fois l'échec d'un même
    rendu, une erreur de même `digest` sur le même chemin n'est écrite qu'une fois par 2 secondes.
- **Administration du registre et des programmes de recherche** (points 61 et 58 de `docs/reste-a-faire.md`,
  15 octobre ; D-07, D-08, D-10, D-15. Gouvernance des termes (A05 de l'audit), arbitrages du registre (O-05), date de
  fin des programmes (point 3 de `docs/registre-points-ouverts.md`) non tranchés) :
  - créer, modifier et supprimer types, familles, fonctions et programmes est réservé au droit « Administrer », comme
    le reste de l'administration : qui peut créer, renommer ou retirer un terme (A05) reste à décider ;
  - le contenu du registre ne change pas : aucun type n'est ajouté ni retiré, les 69 types restent provisoires (O-05) ;
  - formats : code de type de 2 ou 3 lettres majuscules (comme tous les codes du registre, GA et PO compris) ; code de
    programme fait d'une lettre majuscule puis de 2 à 9 lettres majuscules ou chiffres, sans tiret (R2601) ; clé de
    famille ou de fonction en minuscules, chiffres et `_` (`resp_qualite`). Libellé FR obligatoire, libellé EN repris
    du FR s'il est vide ;
  - **un code ne désigne qu'une chose dans un identifiant** `TYPE-CONTEXTE-SEQ` : un nouveau code de type, de
    département ou de programme ne peut reprendre ni un autre code de type, ni un code de département, de projet ou de
    programme, ni `QMS`. C'est l'option prudente du point 1 de `docs/registre-points-ouverts.md` (« FIN-FIN-0001 :
    garder ou renommer ? », O-05) : les codes déjà partagés (FIN, HSE, COM, types et départements) sont gardés, aucun
    nouveau n'est créé. Pour deux contextes (un département et un programme du même code), le compteur serait de plus
    commun ;
  - **une entrée utilisée garde son code et ne se supprime pas** : un type qu'un document (quel que soit son état) ou une
    pièce attendue sur un projet utilise ; une famille qui contient un type ou un document ; une fonction qui figure
    dans un circuit, a des titulaires ou a servi dans un circuit lancé (ses étapes gardent sa clé) ; un programme qu'un
    document ou un titulaire de fonction « par programme » utilise. Les entrées que les règles de Codex nomment comptent
    comme utilisées, même sans document : le type des modèles FRM (contexte `QMS`, D-10) et les fonctions chef de
    projet, validation client (le chef du projet y répond à défaut de titulaire) et responsable du département. Elles
    gardent aussi les réglages dont le code dépend : FRM n'admet que « sans rattachement » (rattaché à un projet ou à un
    programme, un modèle prendrait ce contexte au lieu de `QMS`) ; chef de projet et validation client restent « par
    projet », responsable du département « par département ». Un type ou un programme utilisé se désactive : il
    n'est plus proposé à un nouveau document, et ceux qui l'ont le gardent. Une entrée que rien n'utilise peut changer de
    code ou être supprimée (créée par erreur, par exemple), ce qui est journalisé ;
  - changer la famille d'un type change celle de ses documents (la famille d'un document est celle de son type) ;
  - restreindre les origines, rattachements ou niveaux de confidentialité admis par un type est refusé tant qu'on ne
    confirme pas, avec le nombre de documents de ce type qui ne seraient plus admis ; leurs identifiants ne sont donnés
    qu'aux gestionnaires documentaires, la liste nommant des brouillons (D-14). La confirmation ne vaut que pour les
    documents annoncés : si le réglage change ou qu'un autre document serait exclu entre-temps, la question est reposée
    avec le nouveau nombre. Ces documents gardent leurs valeurs ; leur prochaine modification de métadonnées demande de
    les reclasser ;
  - la portée d'une fonction ne change pas tant qu'elle a des titulaires (chacun est nommé pour une valeur de la
    portée) ; ses libellés changent pour les circuits à venir, les circuits lancés gardent ceux de leur lancement ;
  - un titulaire de fonction est nommé pour un département ou un projet connu, pour un programme connu et actif, ou
    pour tout le groupe : un programme désactivé garde ses titulaires mais n'en reçoit plus de nouveau ;
  - un programme a un code, un libellé, un responsable (une personne, pas un acteur système), qui valide les étapes
    « par programme » sans titulaire désigné, et un état actif. Pas de date de fin : elle servirait au déclencheur de
    conservation « fin de programme » (point 3 de `docs/registre-points-ouverts.md`, O-05). Un programme désactivé reste
    accepté par l'import (`POST /api/import`) : la migration reprend aussi les documents des programmes terminés (O-11) ;
  - un type créé dans Codex porte `source: codex` dans `GET /api/registry` ; les programmes n'y figurent pas
    (`docs/api.md`) ;
  - chaque création, modification et suppression est journalisée comme une entrée sans document (cibles type, famille,
    fonction, programme), avec chaque champ avant → après, lisible dans l'administration seulement.
- **Administration de l'organisation** (point 62 de `docs/reste-a-faire.md`, 15 octobre ; D-10, D-19. Organigramme
  (O-04), gouvernance des termes (A05 de l'audit) et sort des brouillons reclassés (O-09) non tranchés) :
  - renommer, désactiver, réactiver ou supprimer un département ou un site est réservé au droit « Administrer », comme
    le reste de l'administration ; les valeurs restent les valeurs provisoires du seed tant que l'organigramme n'est
    pas fourni ;
  - **le code d'un département ne change jamais**, même tant que rien ne l'utilise : il entre dans les identifiants des
    documents sans rattachement (`PRO-QUA-0003`). Un département créé par erreur se supprime et se recrée. La clé d'un
    site (tirée de son libellé à la création, enregistrée sur les documents et les personnes) ne change pas non plus ;
  - les sites ont désormais un libellé FR et un libellé EN, comme les départements (« Lyon — siège et atelier » /
    « Lyon — head office and workshop ») ;
  - **une valeur utilisée ne se supprime pas, elle se désactive**. Un département est utilisé par des documents (quel
    que soit leur état), des personnes, des titulaires d'une fonction « par département », des recherches partagées
    avec lui, ou des identifiants déjà attribués sous son code, même si le document a été reclassé depuis (son ancien
    identifiant reste en alias et son compteur demeure) : c'est l'option prudente, qui évite qu'un code ayant servi
    dans des identifiants soit repris par un type ou un programme. Un site est utilisé par des documents ou des
    personnes ;
  - **une valeur inactive n'est plus proposée** pour un nouveau document ni le partage d'une recherche (le serveur le
    refuse aussi), mais reste affichée et acceptée là où elle figure déjà : un document qui l'a la garde, y compris à
    sa prochaine modification ; les titulaires et recherches existants restent ; la page du département reste
    ouverte, marquée « Inactif », avec ses documents ; elle reste dans les facettes de la recherche et l'explorateur
    tant que des documents l'ont. La réactivation la propose de nouveau ;
  - **un département inactif prend encore des titulaires de fonction** « par département », proposé marqué
    « (inactif) » dans le dialogue du titulaire : ses documents restent et passent encore par des circuits, qui
    cherchent le responsable de leur département. Sans cela, le départ de son responsable bloquait toute demande de
    validation sur ses documents, sauf à le réactiver le temps de nommer un successeur (relecture du 15 octobre) ;
  - un programme clos (étape 6) ne prend toujours pas de nouveau titulaire ; son responsable, modifiable même
    programme clos, répond pour lui des fonctions « par programme ». Reste bloqué le cas où ce responsable est l'auteur
    de la révision et où personne ne tient la fonction pour tout le groupe : à arbitrer avec le reste des programmes ;
  - un document créé sans département explicite prend celui de l'utilisateur : s'il est inactif, la création est
    refusée avec le message, plutôt que de prendre un autre département à son insu ; le dialogue propose alors le
    premier département actif. `/departements` ouvre toujours la page du département de l'utilisateur, même inactif ;
  - **un département au moins reste actif** : un nouveau document sans rattachement prend le code de son département ;
  - l'import (`POST /api/import`) accepte un département ou un site inactif : la migration reprend aussi les documents
    des services fermés (D-21), comme pour les programmes ;
  - chaque ajout, modification et suppression est journalisé comme une entrée sans document (cibles département et
    site), avec chaque champ avant → après (code ou clé, libellés, état), lisible dans l'administration seulement ;
  - la fusion de deux départements n'est pas faite : elle réaffecterait documents, personnes et titulaires, mais un
    brouillon jamais approuvé changerait d'identifiant (D-10, O-09).
- **Export complet pour la réversibilité** (point 17 de `docs/reste-a-faire.md`, 15 octobre ; format dans
  `docs/export.md`. Délai de reprise, perte de données tolérée et hébergement (M22 de l'audit), SharePoint (O-01) et
  contrat de migration (O-11) non décidés) :
  - **réservé aux gestionnaires documentaires ayant l'accès Administration**, comme la sauvegarde : l'archive contient
    tout, brouillons et documents confidentiels compris, sans le filtre de D-14, et seuls les gestionnaires
    documentaires voient déjà tous les brouillons. Un administrateur qui n'est pas gestionnaire documentaire n'y a pas
    accès (403), ni la ligne qui le propose ;
  - **journalisé deux fois** : « Export complet » au début, écrit dans la transaction de la copie (l'archive contient
    donc sa propre entrée, et un téléchargement coupé ou un serveur arrêté laisse une trace), puis « Export
    complet envoyé » avec la taille et le SHA-256 de l'archive quand le serveur a fini de l'envoyer (ils permettent
    de reconnaître plus tard une archive comme celle que le serveur a envoyée), ou « interrompu » (coupure pendant
    l'envoi), ou « échec ». Le serveur ne sait pas si le client a tout reçu : une petite archive coupée après l'envoi
    est inscrite comme envoyée, et un fichier téléchargé se vérifie par `npm run export:check` ou par son SHA-256. Nombres, tailles et empreinte montrés aux seuls
    gestionnaires documentaires, aucun document nommé, comme pour la sauvegarde ;
  - **instantané** : toutes les tables sauf le journal sont copiées en une transaction dans des tables temporaires
    (les écritures attendent quelques secondes, comme pour une sauvegarde), puis lues par lots ; le journal, en ajout
    seul, est lu jusqu'à la dernière entrée de cette transaction. Ce qui change pendant le téléchargement n'entre pas
    dans l'archive ;
  - **format** : ZIP sans compression ni chiffrement, écrit en flux (descripteurs de données, Zip64 au-delà de 4 Go),
    sans dépendance (`src/lib/export-core.mjs`) ; une table par fichier JSON, champs nommés comme dans
    `src/db/schema.ts` (ceux de l'API d'import), dates telles que la base les garde (heure de Paris pour les
    horodatages sans fuseau, UTC pour le journal) ; CSV des seuls documents, au format des autres exports (point-virgule,
    BOM, formules neutralisées) ; fichiers sous `files/{ID}/{ID}_{lettre}.{n}.{ext}` (toutes les versions de travail,
    pas seulement le fichier final) ; `SHA256SUMS` pour vérifier sans Codex. L'index de recherche (`document_terms`)
    n'est pas exporté : la base le recalcule ;
  - **vue d'import** (`import/documents.json`) : pour chaque document, le `meta` de `POST /api/import` et le fichier à
    envoyer, avec son identifiant actuel comme `legacyRef` (gardé comme identifiant par le Codex qui importe quand il
    est libre et au format de son type et de son contexte) ; la révision prise est celle en vigueur, sinon une révision
    approuvée avec sa date d'effet, sinon la dernière, en brouillon ; état, gel juridique, révisions antérieures,
    circuits, demandes, liens et journal restent dans `data/` sans équivalent dans l'import (O-11) ;
  - **fichiers SharePoint** : depuis l'application, lus par Graph quand SharePoint est configuré ; sinon (O-01 non
    tranché) listés comme non inclus dans le manifeste et le journal plutôt que de faire échouer tout l'export. La
    commande ne les lit jamais (comme la sauvegarde) et le dit. Un stockage local illisible ou un SharePoint configuré
    mais injoignable fait échouer l'export ;
  - **commande** `npm run export`, serveur arrêté, sous le verrou du dossier de données ; archive par défaut à côté du
    dossier de données (`.data-exports/`, ignoré par git), dossier `0700` et archive `0600`, écrite sous un nom
    provisoire et relue avant d'être nommée ; aucune variable nouvelle (`--out` pour un autre endroit). Pas
    d'export programmé, pas de chiffrement : à décider avec l'hébergement ;
  - le téléchargement compte dans le budget des exports (`CODEX_RATE_EXPORTS`), sans autre limite : deux exports
    simultanés sont possibles (chacun sa copie temporaire).
- **Git** (D-23) : premier commit sur une branche `codex-ged-v2` plutôt que sur `main`.

## Ce qui est explicitement hors périmètre

- **Power Automate et Power Apps** : on ne s'en sert pas.
  - Les circuits tournent dans Codex, et Codex est l'application « GED EPC2I » (D-06).
  - Le deck montre aussi les logos de Power BI, Power Pages et Power Virtual Agents. Il ne décrit aucun usage, et
    l'audit ne les a pas retenus comme exigences.
- **SharePoint comme base ou source de vérité** : SharePoint ne porte ni métadonnées, ni banque de termes, ni droits,
  ni versions, ni workflows. Au plus, Codex y pilote une bibliothèque de fichiers qui ne reçoit que le fichier, son nom
  et sa version (D-06).
- **Le code de migration** : c'est un programme séparé, hors de ce dépôt. Codex n'expose que `POST /api/import`
  (D-21).
- **La gestion des ECR/ECO et du passage à « obsolète »** : elle est dans Vigie, pas dans Codex. Codex crée les
  demandes pour ses documents et applique les décisions (D-16, D-17).
- **Les données projet** : elles appartiennent à Keystone, et Codex n'en garde qu'un miroir (D-04).
- **Les indices majeurs/mineurs (x.y)** : ils sont exclus. Les révisions sont en lettres, avec des versions de travail
  A.1, A.2 (D-11, D-12).
- **Le champ « autorité d'approbation »** de la slide 18 du deck : il est supprimé (D-15).
- **Le « Domaine » unique** (DI, DE, DP, DR) comme champ de classement : il est remplacé par l'origine et le
  rattachement (D-08).

## Réponses aux questions que la session cloud a reposées

### « Le deck et l'audit n'ont pas survécu au transfert »
Le deck est versionné dans `docs/sources/creation-ged-epc2i.pptx`, et sa transcription dans
`docs/sources/deck-ged-epc2i.md`. Il n'y a pas à redemander le fichier ni à relancer l'audit avant de toucher au code :
- les 10 questions de l'audit ont reçu leurs réponses (D-06 à D-21) ;
- le modèle qui en découle est implémenté (`docs/modele-cible.md`, `docs/avancement-v2.md`) ;
- le rapport d'audit est dans `docs/audit-deck-epc2i.md`.

### Pile Microsoft 365 ou Codex autonome ?
**Tranché le 7 octobre (D-06) : Codex autonome.**
- Des trois options proposées par la session cloud, c'est la première : garder Codex et se servir du deck comme
  spécification fonctionnelle, corrigée par D-07 à D-21.
- Il s'y ajoute un seul élément optionnel : une bibliothèque SharePoint, pilotée par Codex, qui sert uniquement à
  stocker les fichiers.
- Ce n'est pas la combinaison « Codex en façade, SharePoint comme base documentaire ». Aucune métadonnée, aucun
  droit, aucune version ni aucun workflow ne vit dans SharePoint.
- Power Automate et Power Apps ne sont pas utilisés.
- La recommandation de l'audit du 7 octobre (SharePoint source de vérité, Codex en façade) a été écartée par cette
  réponse.

**Entra ID n'est pas confirmé.**
- L'assistant l'a proposé le 7 octobre ; l'utilisateur ne s'est jamais prononcé.
- Activer SharePoint ne règle pas la question. `src/lib/storage.ts` accède à SharePoint par Microsoft Graph en mode
  application (`CODEX_SP_TENANT_ID`, `CODEX_SP_CLIENT_ID`, `CODEX_SP_CLIENT_SECRET`, `CODEX_SP_DRIVE_ID`), et les
  utilisateurs ne se connectent jamais à SharePoint.
- Le deck indique que les outils Microsoft sont déjà en place, ce qui fait d'Entra ID le candidat naturel. Le choix
  reste à l'utilisateur (O-02).

### Durées de conservation et libellés des circuits « en attente d'une revue juridique »
**L'utilisateur n'a jamais parlé de revue juridique.**
- La mention vient des notes de conception de la maquette (`design/GED Groupe.dc.html`) : « Durées de rétention
  (valeurs de maquette à confirmer avec le Juridique), libellés des circuits, et le découpage des entités ».
- L'assistant l'a relayée le 7 octobre à 11:39.
- La réponse de l'utilisateur est D-20 : « La conservation des documents sera selon les règles d'usage par type de
  document. »

Les valeurs de la maquette n'existent plus dans le modèle v2 :
- Les durées sont portées par type dans le registre (`retention` dans `src/db/registry.ts`, calcul dans
  `src/lib/retention.ts`).
- Les circuits sont des listes de fonctions par type (D-15).
- Restent à faire valider : les durées (O-07, en particulier les points 3 et 6 de `docs/registre-points-ouverts.md`)
  et la matrice des circuits (O-06).

### Fournisseur d'authentification
- **Aujourd'hui** : l'utilisateur et le rôle sont simulés (D-03), par cookies (`src/lib/context.ts`). Les droits sont
  contrôlés côté serveur, selon la matrice des rôles et `src/lib/access.ts`.
- **Cible** : rien n'a été décidé par l'utilisateur.
  - Au démarrage, il a écarté « Authentification réelle » au profit de « Rôle simulé (Recommandé) », dont la
    description disait « L'authentification réelle (SSO, etc.) viendra plus tard ».
  - L'assistant a ensuite proposé Entra ID, sans réponse.
  - Les mentions d'Entra ID dans `docs/modele-cible.md`, `docs/api.md`, `docs/avancement-v2.md` et
    `src/app/api/registry/route.ts` reflètent cette proposition, pas une décision.
  - Question ouverte O-02.

### Liaison avec Keystone : API ou base partagée ?
- **Aujourd'hui** (D-04) :
  - Les projets `HLT-026`, `NDC-031` et `RCF-019` sont des tables locales, remplies par `src/db/seed-org.ts` et lues
    par `src/lib/keystone.ts`.
  - Le lien « Ouvrir dans Keystone » mène à `NEXT_PUBLIC_KEYSTONE_URL` + `/projects/{code}`.
  - Keystone lit le registre des types par `GET /api/registry`.
- **API ou base partagée** : l'utilisateur n'a pas tranché explicitement.
  - Au démarrage, il a choisi « Affaires simulées (Recommandé) » plutôt que « Base partagée avec Keystone ».
  - Le code suppose donc des échanges par API. Codex expose le registre, et `src/lib/keystone.ts` est prévu pour être
    remplacé par des appels à l'API de Keystone.
  - Le « oui fusionne les deux bases » du 7 octobre porte sur les listes de types (D-07), pas sur les bases de données.
  - La spec Keystone décrit un index synchronisé depuis Codex (« Real time (webhooks) »). Elle laisse elle aussi
    ouvert le contrat de dépôt (« deep link? API create? »).
  - Question ouverte O-03.

### Premier commit
**Fait** (D-23, D-24).
- Le premier commit date du 8 octobre. Il a été réécrit le 9 octobre en `d05d498`, suivi de `ef1df85` (`.gitignore`).
- Le tout est publié dans le dépôt privé `Yhumiii27/Codex`, sur les branches `main` et `codex-ged-v2`.
- La branche `codex-ged-v2-vkmf4l` de la session cloud part de `ef1df85`.

## Questions encore ouvertes

Toutes ces questions attendent une réponse de l'utilisateur. Ne pas les trancher à sa place. On peut les lui
reposer, une fois, en citant leur numéro.

| N° | Question | Responsable | Suivi |
|---|---|---|---|
| O-01 | **SharePoint** : faut-il l'activer ? Si oui, faut-il un fichier par version, sans accès direct des utilisateurs à la bibliothèque ? Sans cette restriction, les utilisateurs pourraient contourner les droits de Codex. Avec elle, on modifie un fichier en le téléchargeant puis en le redéposant, sans édition Office en ligne. Posée 4 fois (7 oct. à 17:33, 18:07 et 23:18 ; 8 oct. à 06:18), jamais répondue. | utilisateur | `docs/modele-cible.md` §1 (provisoire : un fichier par version de travail, aucun accès direct) ; `src/lib/storage.ts` |
| O-02 | **Fournisseur d'authentification** pour remplacer la simulation. Entra ID est proposé, non confirmé. | utilisateur | ce fichier ; `docs/avancement-v2.md` (Reste à faire) |
| O-03 | **Liaison avec Keystone** : API ou base partagée ? Il faut aussi définir le contrat de dépôt et de synchronisation des documents projet. | utilisateur | ce fichier ; spec Keystone (dépôt Keystone) |
| O-04 | **Organigramme** : sociétés, sites, départements. | utilisateur | `src/db/seed-org.ts` (valeurs provisoires) |
| O-05 | **Registre des types** : les 9 questions ouvertes et les choix de fusion à valider. | utilisateur | `docs/registre-points-ouverts.md` (seule liste qui fait foi) |
| O-06 | **Matrice type → circuit et titulaires des fonctions** : ce sont des valeurs de démonstration. | utilisateur | `src/db/registry.ts` (`circuit`), `src/db/seed-org.ts` (`FUNCTIONS`, `HOLDERS`) |
| O-07 | **Durées de conservation par type** : proposées selon les règles d'usage, non validées une à une. | utilisateur | `src/db/registry.ts` (`retention`) ; points 3 et 6 de `docs/registre-points-ouverts.md` |
| O-08 | **Types qui admettent « Public »** : aujourd'hui POL, REG, DTF, PUB et COL. Le registre n'a pas de type « communication », alors que c'est l'exemple donné par l'utilisateur. | utilisateur | `src/db/registry.ts` (`confAllowed`) |
| O-09 | **Propositions de l'assistant à confirmer** : voir « Choix de l'assistant non validés explicitement ». | utilisateur | ce fichier ; `docs/modele-cible.md` §3-4 |
| O-10 | **ECR/ECO** : quelles étapes, dans un module à créer dans Vigie ? Comment accepter les demandes nées dans Keystone, que le webhook de Codex refuse aujourd'hui ? Faut-il faire pointer vers Vigie le module ECO de Keystone ? | utilisateur (décision) ; dépôts Vigie et Keystone | D-16, D-18 ; `src/lib/vigie.ts` |
| O-11 | **Migration** : quels volumes et quels emplacements reprendre, pour l'outil séparé ? | utilisateur | D-21 ; `docs/api.md` (`POST /api/import`) |

### Travaux en attente (pas des questions)

| N° | Travail | Ce qui le débloque | Suivi |
|---|---|---|---|
| T-01 | **Branchements réels** : API projets de Keystone, Vigie (`VIGIE_API_URL`, webhook), SharePoint sur un vrai tenant, authentification réelle. | les adresses, accès et jetons fournis par l'utilisateur, et les réponses à O-01, O-02, O-03 | `docs/avancement-v2.md` (Reste à faire) ; `docs/api.md` ; `.env.example` ; `src/lib/storage.ts` (variables `CODEX_STORAGE` et `CODEX_SP_*`, documentées dans `.env.example`) |
| T-02 | **App Mac** : 8 corrections restantes. L'utilisateur doit aussi tester lui-même, dans la fenêtre de l'app, le dépôt d'un fichier et un téléchargement. | une session sur macOS | `docs/avancement-v2.md` (section « App Mac ») |
| T-03 | **Corrections restées partielles après la revue du 8 octobre** : trois sur quatre faites le 9 octobre en session cloud ; voir le détail sous ce tableau. | développement (fait) ; utilisateur pour la conservation (O-09) | `docs/modele-cible.md` §8 (conservation comptée par document) |

Détail de T-03 (état au 9 octobre, session cloud) :
- **Fait** : après un reclassement, les fichiers déjà stockés prennent le nouvel identifiant (`{ID}_{lettre}.{n}.{ext}` ;
  dans SharePoint, rangés dans le dossier du nouvel ID ; en local, à plat avec un préfixe unique) : `renameDocFiles`
  dans `src/lib/storage.ts`, appelé par `updateMeta`. L'extension vient du nom d'origine ou du type MIME, comme au dépôt
  (une clé SharePoint n'en porte pas). Vérifié en local (`PRO-QUA-0003` → `PRO-HSE-0003_A.1.pdf`) ; non testé sur
  SharePoint, comme tout le pilote, et l'ancien dossier SharePoint, vide, n'est pas supprimé.
- **Fait** : lors du dépôt d'une pièce attendue par Keystone, le formulaire verrouille la famille et le type de la pièce
  (`lockType` dans `src/components/dialogs/Dialogs.tsx`) ; le serveur continue de refuser un mauvais type.
- **Fait** : la liste des demandes de modification ne contient que les demandes sur des documents que l'utilisateur
  peut voir (`listChangeRequests` dans `src/lib/queries.ts`).
- **Non fait, volontairement** : la conservation reste comptée par document, comme le dit `docs/modele-cible.md` §8.
  La compter par révision remplacée changerait le modèle ; c'est une proposition à confirmer (O-09), pas un correctif.

Le dépôt et le téléchargement de fichiers réels ont été testés dans le navigateur le 7 octobre (`PRO-HSE-0003`) et
le 8 octobre (`PRO-QUA-0003`) ; seuls ceux de la fenêtre de l'app Mac restent à tester (T-02). `docs/avancement-v2.md`
reprend ces points et ceux de T-03.

## Annexe : le message de réponse du 7 octobre à 17:52, en entier

Toutes les réponses du 7 octobre à 13:38 sont citées intégralement dans D-06 à D-21. Le message de 17:52 répond aux
confirmations 1 à 5 (sur 6) de 17:33 et à trois sections de cette proposition ; le voici sans coupure :

> 1- oui fusionne pour le moment on adaptera plus tard
> 2- QMS est le code pour les templates
> 3- oui
> 4- c'est un workflow vigie
> 5- oui
> pour la question 2: oui fusionne les deux bases
> pour le cycle de vie conserve les sous versions de travail
> pour vigie, il va gérer les ECO/ECR mais les demandes doivent pouvoir etre faites depuis codex pour les documents ou depuis keystone pour les sujets liés au projets ou au projet lui meme.

La 6e confirmation, sur SharePoint, n'a pas reçu de réponse (O-01).
