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
  - Ces valeurs sont modifiables dans Administration › Organisation.
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
- **Retrait** (D-17) : effets d'un retrait accepté sur le travail en cours (circuit clos, révisions ouvertes annulées).
- **Documents obsolètes ou archivés** (D-17) : bandeau d'avertissement sur la fiche et dans l'aperçu rapide de
  l'explorateur, suffixe `_OBSOLETE` ou `_ARCHIVE` dans le nom proposé au téléchargement (`docs/modele-cible.md` §4).
  Qui peut encore les consulter ou les télécharger n'est pas tranché (A13, P07) : rien n'a changé de ce côté.
- **Décision Vigie sur un document verrouillé** (D-16, D-17) : une acceptation reçue pendant un gel juridique ou un
  archivage est enregistrée (demande « Acceptée ») et s'applique à la levée du gel ou à la restauration ; le webhook
  répond 202 au lieu de 409. La fiche signale la décision en attente ; hors du cercle de rédaction, elle ne nomme ni
  l'ECO ni le modificateur d'une modification (même règle que pour une révision ouverte, D-14). Vigie n'est pas
  prévenu quand la décision s'applique (O-10).
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
- **Écarts volontaires avec la maquette** (7 octobre) :
  - le rôle « Gestionnaire documentaire » a le droit « Valider » ;
  - les échéances sont triées par date ;
  - le point rouge des notifications n'apparaît que s'il y a des validations en attente ;
  - les documents de démonstration sans fichier affichent « aperçu de démonstration ».
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
