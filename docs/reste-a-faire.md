# Reste à faire sur Codex

Inventaire du 9 octobre 2026, sur la branche `codex-ged-v2-vkmf4l`.

## Méthode

- Cinq recensements indépendants ont été faits : la documentation, les 15 écarts « partiels » de l'audit, les 64 exigences du deck, le code et l'exploitation, la maquette et les intégrations.
- Ils ont produit 214 points bruts, ramenés à 112 après fusion des doublons.
- Chaque point a ensuite été vérifié dans le code par un agent chargé de le réfuter.
- Une critique de complétude a ajouté 20 points, vérifiés de la même façon.
- Les points écartés par une décision de l'utilisateur (`docs/decisions.md`) n'y figurent pas.

Ce fichier complète `docs/avancement-v2.md`. Il compte **129 points ouverts**, regroupés selon ce qui les bloque :

| Ce qui bloque | Points |
|---|---|
| Développable maintenant | 69 |
| Attend une décision de l'utilisateur | 49 |
| Attend des données de l'utilisateur | 2 |
| Demande une session sur macOS | 9 |

Deux autres points relevés par l'inventaire ont été corrigés le jour même : l'extension perdue au renommage SharePoint après un reclassement, et `npm run typecheck` qui échouait sur un clone neuf. Ils sont détaillés en annexe.

## Développable maintenant (69)

Aucune décision ni donnée n'est nécessaire : ces points peuvent être développés dans une session cloud.

### Fonctionnel (21)

#### 1. Liste « Mes demandes » (modification et retrait envoyées à Vigie)
- **Fait le 11 octobre 2026** : la vue « Mes demandes Vigie » de l'écran Validations (`/validations?f=vigie&c={ECR}`, `listChangeRequests(ctx, { mine: true })`, src/lib/queries.ts) liste les seules demandes de modification et de retrait envoyées par l'utilisateur, celles qui attendent d'abord, avec type, document (ID, titre), statut et ce qu'attend une demande acceptée, dates d'envoi et de décision avec l'année, ECO, modificateur désigné, note de Vigie, révision ouverte ou greffée, lien vers la fiche et, si `NEXT_PUBLIC_VIGIE_URL` est défini (`vigieLinkConfigured`), vers Vigie, selon les règles de lecture de la fiche (D-14, D-26 : hors du cercle de rédaction, ni ECO, ni modificateur, ni révision, ni date de décision d'une modification « Appliquée » tant que sa révision n'est pas en vigueur, `changeAsSeen`), sans rappel sur l'accueil, que la maquette réserve à ce qui attend une décision de l'utilisateur.

- **Effort** : faible · **Références** : G18, FON-10

Le manque est confirmé. Il reste à :
- ajouter un filtre `requesterId` à `listChangeRequests` (le filtrage par visibilité est déjà fait depuis 44bd1b8) ;
- l'afficher dans un onglet ou un filtre « Mes demandes Vigie » de Validations, ou dans un encart de l'Accueil, avec le type (modification ou retrait), le statut, la référence ECO, le modificateur désigné, la date et le lien Vigie (`vigieUrl`).

Statuts à afficher : « Transmise à Vigie », « Refusée », « Appliquée » et « Acceptée ». `applyChangeDecision` (src/lib/lifecycle.ts) écrit `accepted` quand Vigie accepte une demande sur un document archivé, obsolète ou sous gel juridique (point 35) et, depuis D-26, une modification alors qu'une révision du document est déjà ouverte. La demande passe `implemented` quand plus rien ne la retient (`applyPendingDecision` : levée du verrou, puis mise en vigueur ou annulation de la révision ouverte), ou quand elle est greffée sur la révision ouverte (`graftChange`, src/lib/actions.ts). La liste devra donc afficher « Acceptée » avec la mention d'attente (`decisionWaitL`, src/lib/queries.ts, qui ne nomme la révision ouverte qu'au cercle de rédaction). Le masquage hors du cercle de rédaction est déjà fait par `listChangeRequests` (`changeAsSeen`, src/lib/access.ts) : ni ECO, ni modificateur, ni révision tant que la révision qui porte la modification n'est pas en vigueur, et une modification greffée reste « Acceptée » tant que cette révision est ouverte (« Appliquée » si elle est annulée). Hors du cercle, la mention d'attente d'une modification ne promet jamais l'application à la levée d'un verrou (`acceptedWaitL`, src/lib/queries.ts).

<details><summary>Constat dans le code</summary>

src/lib/queries.ts:187 : `listChangeRequests(ctx, opts: { docId?: string })` n'a pas d'option `requesterId`. Son seul appel est src/app/documents/[id]/page.tsx:82, avec `docId`. src/app/validations/page.tsx:13-22 : les FILTERS ne portent que sur des circuits, et `requested` est `w.requesterId === ctx.user.id` sur les workflows (queries.ts:170). Aucune autre route ne lit change_requests.

</details>

#### 2. Recherches enregistrées : permettre d'en créer, d'en supprimer et d'en partager
- **Fait le 11 octobre 2026** : `saved_searches` a un propriétaire (`owner_id`) et une portée (`scope` : `personal`, `department` avec sa colonne `department`, `group`), contrôlées par deux contraintes ; migration unique régénérée. `saveSearch` et `deleteSavedSearch` (src/lib/actions.ts) appliquent les règles de src/lib/access.ts : toute personne qui a le droit Lire enregistre une recherche personnelle et supprime les siennes (`maySaveSearch`, `mayDeleteSearch`) ; partager avec un département ou avec le groupe, et supprimer une recherche partagée, est réservé aux gestionnaires documentaires et aux détenteurs du droit Administrer (`mayShareSearches`). `listSavedSearches` (src/lib/queries.ts) ne rend que ce que l'utilisateur voit (`seesSavedSearch`) : recherches du groupe, de son département, puis les siennes ; les gestionnaires voient aussi celles des autres départements, pour les gérer, jamais les recherches personnelles d'autrui. Seuls les critères sont gardés (`cleanCriteria`, src/lib/search.ts : facettes connues, valeurs bornées) : une recherche ouverte passe par les mêmes filtres de lecture que l'écran Recherche et ne révèle aucun document invisible (D-14). Dans /recherche, bouton « Enregistrer la recherche » (dès qu'un critère est choisi) qui ouvre un dialogue : libellé (80 caractères au plus), critères lus, portée et département pour qui peut partager ; marque « Perso » ou code du département, info-bulle « partagée avec … par … », suppression (×) au survol ou au clavier, avec confirmation. La liste est filtrée en SQL (`savedSearchesSeenBy`, même règle que `seesSavedSearch`) : les recherches personnelles d'autrui ne sont jamais chargées. Le seed reprend les 3 recherches comme recherches de groupe de Claire Bardet. L'enregistrement du tri, reporté au point 12, y est fait depuis : une recherche enregistrée garde aussi sa période (`period`) et l'ordre de ses résultats (`order_by`) ; la colonne `sort` reste l'ordre d'affichage. Tests : tests/integration/saved-searches.test.ts (dont l'accord entre `savedSearchesSeenBy` et `seesSavedSearch`), `mayShareSearches`, `maySaveSearch`, `seesSavedSearch`, `mayDeleteSearch` (tests/unit/access.test.ts), `cleanCriteria` et `hasCriteria` (tests/unit/search.test.ts).

- **Effort** : faible · **Références** : G12, G15, FON-06

Le manque est confirmé. Il reste à :
- ajouter `owner_id` et une portée (personnelle, département, groupe) à `saved_searches`, puis régénérer la migration unique (`rm -rf drizzle && npx drizzle-kit generate --name init`) ;
- créer `saveSearch` et `deleteSearch` dans `src/lib/actions.ts`, avec contrôle des droits : le propriétaire pour une recherche personnelle, un gestionnaire ou un administrateur pour une recherche partagée ;
- filtrer `listSavedSearches` selon la portée ;
- ajouter dans `/recherche` un bouton qui enregistre `q` et les facettes de l'URL, et une suppression ;
- adapter le seed.

<details><summary>Constat dans le code</summary>

La table `saved_searches` (src/db/schema.ts:339-345) n'a que id, label, q, facets et sort : ni propriétaire ni portée. Elle n'est remplie que par src/db/seed.ts:106 à partir de `SAVED` (src/db/seed-org.ts:127-131, 3 recherches). `listSavedSearches` (src/lib/queries.ts:281-285) lit toutes les lignes sans filtre. src/lib/actions.ts n'a aucune action sur savedSearches. src/app/recherche/page.tsx:47-56 se contente de lister les liens, sans bouton « Enregistrer ».

</details>

#### 3. Dates : contrôle de format côté serveur et cohérence émission ≤ effet ≤ expiration

- **Effort** : faible · **Références** : MET-03, règle 12 (§4.6)

Le manque est confirmé, avec une correction : l'import valide déjà le format AAAA-MM-JJ. Il reste à :
- appliquer `parseIsoDay` aux dates de `readFields`, avec un message `invalid_date` au lieu d'une erreur SQL ;
- ajouter des règles de cohérence dans `validateFields` et `parseImportMeta` :
  - expiration postérieure à l'émission (`issuedAt`) et à la date d'effet de la révision ;
  - date de réception ni future, ni postérieure à l'émission ;
  - date de revue postérieure à l'émission ;
- dans `requestValidation`, refuser une date d'effet postérieure à l'expiration du document ;
- prévoir des messages d'erreur dédiés dans i18n.

<details><summary>Constat dans le code</summary>

src/lib/actions.ts:99 et 102 : `reviewDueAt`, `expiresAt` et `receivedAt` sont pris par `opt()` sans `parseIsoDay`. `validateFields` (actions.ts:117-130) ne contrôle aucune date. Seule la date d'effet est validée (actions.ts:393-394). Le formulaire utilise `type="date"` (Dialogs.tsx:229, 232, 256), mais une Server Action reste appelable avec n'importe quelle valeur. L'import contrôle déjà le format, avec `date()` et `parseIsoDay` (src/lib/importer.ts:131-137 et 204-206), mais aucune cohérence entre les dates.

</details>

#### 4. Auteur : pouvoir désigner une autre personne que le créateur

- **Effort** : faible · **Références** : MET-10, G28

Le manque est confirmé dans l'interface et dans les Server Actions. Il reste à :
- ajouter `authorId` à `Fields`, `readFields` et `validateFields` (utilisateur existant et non système) ;
- dans `DocFields`, proposer à la création comme à l'édition un sélecteur de personne (`data.users`), avec une option texte, exclusive de la personne ;
- dans `updateMeta`, garder la cohérence : une personne choisie efface le texte, et inversement ;
- revoir le repli d'affichage sur le propriétaire.

Le deck exige un auteur (MET-10, « Personne ou texte », obligatoire).

<details><summary>Constat dans le code</summary>

src/lib/actions.ts:189 : `authorId: f.authorText ? null : ctx.user.id`. `Fields` et `readFields` (actions.ts:71-111) n'ont pas d'`authorId`, et `updateMeta` ne peut donc jamais changer la personne auteur. src/components/dialogs/Dialogs.tsx:240-241 et 259-260 ne proposent qu'un champ texte `authorText`. src/lib/queries.ts:32 : `author: d.authorText || ctx.userName(d.authorId ?? d.ownerId)`. Un document créé avec un auteur texte a `authorId` null : si l'on efface ce texte, c'est le propriétaire qui s'affiche. L'import accepte déjà un auteur personne ou texte (src/lib/importer.ts, `author`).

</details>

#### 5. Le demandeur ne peut pas rappeler sa demande de validation
- **Fait le 11 octobre 2026** : `recallValidation` (src/lib/actions.ts) permet au demandeur, ou à un gestionnaire documentaire, de rappeler un circuit en cours tant que la dernière approbation n'est pas faite (`mayRecall`, src/lib/access.ts : droit Modifier, cercle de rédaction ; refusé sur un document verrouillé), avec un motif facultatif ; le circuit est clos avec l'issue `recalled` (« Rappelé »), qui s'ajoute au type de `workflows.outcome` avec `closed_by`, `closed_at` et `reason` (migration régénérée), la révision revient en brouillon, un commentaire et une entrée `recall` du journal (rattachée à la révision) sont écrits, et `refreshHeadline` est appelé. Un clic périmé (étape décidée entre-temps, circuit déjà clos) ne fait rien (`expectedStep`). Bouton « Rappeler la demande » dans Validations › Mes demandes et dans l'onglet Validation de la fiche ; les valideurs dont l'étape attendait perdent le circuit de leur liste (D-14) ; la révision rappelée revient dans « À traiter » de son auteur et de son propriétaire (« demande de validation rappelée par … »). Tests : tests/integration/reject-recall.test.ts, `mayRecall` et `draftTodo` dans tests/unit/access.test.ts.

- **Effort** : faible

Une fois le circuit lancé, l'auteur reste bloqué jusqu'à ce qu'un valideur rejette. À faire :
- Une action `recallValidation(workflowId)` réservée au demandeur et aux gestionnaires documentaires, contrôlée côté serveur et sans effet si le document est verrouillé (`lockOf`).
- Elle clôt le circuit et renvoie la révision en brouillon, comme dans la branche de rejet de `decideStep`. Le circuit peut être clos avec `outcome` 'rejected' ou avec une nouvelle valeur 'recalled' : élargir le type (schema.ts:261) et régénérer la migration.
- Elle ajoute un commentaire, une entrée `recall` au journal avec son libellé i18n, et appelle `refreshHeadline`.
- Bouton dans Validations › Mes demandes et sur la fiche.
Abandonner un brouillon jamais mis en vigueur (le statut `cancelled` existe déjà, schema.ts:13) serait une nouvelle règle du cycle de vie, à faire valider par l'utilisateur.

<details><summary>Constat dans le code</summary>

src/lib/actions.ts:464-475 : `decideStep` exige que l'utilisateur soit le titulaire de l'étape en cours (`cur.assigneeId !== ctx.user.id` renvoie 'not_allowed'). Le demandeur est écarté du circuit par `circuitExclusions` (actions.ts:354-357), il ne peut donc jamais en être titulaire. Les boutons Approuver et Rejeter n'apparaissent que pour le titulaire de l'étape (src/app/validations/page.tsx:122-130). `addWorkingVersion` refuse une révision qui n'est plus en brouillon (actions.ts:233, 'not_draft'). Un circuit ne se ferme que par rejet (actions.ts:489-495) ou par retrait accepté (src/lib/lifecycle.ts:130-159). Pas d'action d'annulation, même pour un gestionnaire documentaire (grep recall, rappel, cancel : rien).

</details>

#### 6. Modèles : les rattacher aux types de document

- **Effort** : faible · **Références** : FON-12, PAR-05, G06

La création ne peut pas partir d'un modèle adapté au type (FON-12). À faire :
- un champ « types cibles » sur le document modèle FRM, modifiable dans « Modifier les métadonnées » quand le type est FRM (ou, à défaut, un modèle par défaut par type dans le registre) ;
- le filtrage de `data.templates` selon le type choisi dans `NewDocument` ;
- la présélection du type quand on choisit un modèle ;
- un contrôle serveur dans `createDocument` qui refuse un modèle non prévu pour le type ;
- l'option d'exclure le sous-type « Formulaire » de la liste des modèles.
Régénérer la migration. Les vrais modèles EPC2I restent à fournir par l'utilisateur ; ceux de la démo n'ont pas de fichier (G06).

<details><summary>Constat dans le code</summary>

src/lib/access.ts:89-91 : `isUsableTemplate` ne retient que `typeCode === 'FRM'` (en vigueur, actif, lisible). src/lib/queries.ts:287-292 : `listTemplates` renvoie tous les modèles. src/components/dialogs/Dialogs.tsx:362-375 : la liste ne dépend pas du type choisi (`st.typeCode`). src/lib/actions.ts:160-176 : `createDocument` accepte n'importe quel modèle pour n'importe quel type. Aucune colonne « types cibles » dans `documents` ni dans `doc_types` (schema.ts:57-78 et 120-174). De plus, FRM couvre les sous-types « Formulaire » et « Modèle de document » (src/db/registry.ts:336-355), si bien que les formulaires vierges sont aussi proposés comme modèles.

</details>

#### 7. Conservation « durée de vie de l'actif » et « départ du salarié » : date d'événement à saisir (15 types)

- **Effort** : faible · **Références** : G39, O-07

Aucune fin de conservation n'est calculée pour ces 15 types. À faire :
- une colonne « date de l'événement déclencheur » sur le document ;
- sa saisie par un gestionnaire (droit Archiver, avec l'action du point G39), journalisée ;
- sa lecture par `triggerDate` pour asset_life et employee_departure.
Pour RHF, cela donne tout de suite une date de fin (événement + 5 ans). Pour les 14 types asset_life, la durée nulle laisse `retainUntil` à null. Il faut décider si cela signifie « jusqu'à la fin de vie de l'actif » (0 an après l'événement) ou fixer des durées : c'est O-07, ainsi que le point 6 de docs/registre-points-ouverts.md pour l'étendue de RHF. Une alimentation automatique par un SI de maintenance ou RH viendra plus tard.
Hors de ce point : les 26 types à déclencheur project_end dépendent de Keystone (O-03) et du point 3 du registre.

<details><summary>Constat dans le code</summary>

src/lib/retention.ts:12-27 : `triggerDate` renvoie null par défaut (ligne 25) pour asset_life, employee_departure et project_end. retention.ts:31 : `retainUntil` renvoie null quand la durée est nulle. src/db/schema.ts:120-174 : aucune colonne de date d'événement sur le document. Lecture de src/db/registry.ts :
- 14 types `asset_life`, tous avec `years: null` : MNT, DTF, EXG, FDS, HMI, VAR, LDC, PID, PFD, SCH, GA, LST, BOM, MAN ;
- 1 type `employee_departure`, RHF, à 5 ans.

</details>

#### 8. Documents obsolètes ou archivés : aucun avertissement, et le fichier reste servi à tous
- **Fait le 10 octobre 2026** : un bandeau « Obsolète depuis le {date} ({ECO}) — ne plus appliquer » ou « Archivé le {date} » s'affiche au-dessus de l'aperçu de la fiche et, en plus court, dans l'aperçu rapide de l'explorateur (`stateNotice`, src/lib/queries.ts) ; le nom proposé par la route fichier prend le suffixe `_OBSOLETE` ou `_ARCHIVE` (`{ID}_{lettre}_OBSOLETE.ext`), sans modifier le contenu ; qui consulte et télécharge ces documents, les filtres par défaut et le filigrane restent inchangés en attendant A13, P07 et M12 (règle décrite dans `docs/modele-cible.md` §4).

- **Effort** : faible · **Références** : A13, P07, D-17, M12

Reste à faire sans décision :
- un bandeau « Obsolète depuis le {obsoleteAt} ({ECR/ECO}) — ne plus appliquer » ou « Archivé le {archivedAt} » sur la fiche (src/app/documents/[id]/page.tsx, au-dessus de <Preview>) et dans l'aperçu rapide de l'explorateur (explorateur/page.tsx, vers la ligne 205) ;
- un suffixe d'état dans le nom du fichier téléchargé (`{ID}_{lettre}_OBSOLETE.ext`, dans headers() de file/route.ts:80) ;
- éventuellement une marque plus visible que l'étiquette de statut, déjà présente dans les listes.
À décider avec l'utilisateur (A13, P07) : qui consulte encore les obsolètes, téléchargement réservé aux gestionnaires, filtre « En vigueur » par défaut dans l'explorateur et la recherche, filigrane (M12).

<details><summary>Constat dans le code</summary>

Constaté. src/lib/lifecycle.ts:159 n'annule que les révisions draft/in_review/approved : la révision in_force d'un document retiré le reste. archiveDocuments (src/lib/actions.ts:622) ne touche pas non plus aux révisions. canRead (src/lib/access.ts:73-78) ne regarde que revInForce et conf, jamais state. La route fichier (src/app/api/documents/[id]/file/route.ts:54-58 et 80) sert alors la révision en vigueur sous `{ID}_{lettre}{ext}`, sans aucune mention d'état. Sur la fiche, `lock` (src/app/documents/[id]/page.tsx:108) ne sert qu'aux infobulles deniedTitle (lignes 119, 129, 139, 374-375) ; aucun bandeau au-dessus de l'aperçu (lignes 227-233). L'explorateur s'ouvre sur `status = 'all'` (src/app/explorateur/page.tsx:64), et parseSearch n'applique aucune facette par défaut (src/lib/search.ts:7-15). Correctif : les listes affichent déjà l'étiquette de statut « Obsolète » / « Archivé » (explorateur/page.tsx:185 et 208, recherche/page.tsx:95, page.tsx:84), et l'explorateur a un filtre Obsolètes / Archivés (explorateur/page.tsx:13).

</details>

#### 9. Rejet d'une étape de validation sans motif
- **Fait le 11 octobre 2026** : `decideStep` (src/lib/actions.ts) refuse un rejet sans motif (vide ou blancs : « Le motif du rejet est obligatoire. ») ou de plus de 2 000 caractères ; le motif est gardé sur le circuit (`workflows.reason`, avec `closed_by` et `closed_at`), dans le commentaire du circuit et dans le détail de l'entrée `reject` du journal, rattachée à la révision (D-14). L'écran Validations ouvre un dialogue « Rejeter l'étape » qui demande le motif (`kind: 'reject'`, src/components/dialogs/Dialogs.tsx) ; l'auteur et le propriétaire le retrouvent sur la fiche (onglet Validation, « Rejeté · qui · date » et « Motif : … ») et dans « À traiter », sur l'Accueil comme dans la cloche (motif sur une ligne à part, abrégé à 140 caractères). Pas de commentaire à l'approbation (option non retenue). Tests : tests/integration/reject-recall.test.ts.

- **Effort** : faible · **Références** : G17, FON-08

À faire :
- un dialogue de rejet (nouveau `kind: 'reject'` dans src/components/dialogs/types.ts et Dialogs.tsx) avec un motif obligatoire de 2000 caractères au plus ;
- un paramètre `reason` dans decideStep, refusé côté serveur s'il est vide quand approve=false ;
- l'enregistrement du motif dans workflowComments et dans le détail de l'audit `reject` ;
- les clés FR/EN dans src/lib/i18n.ts ;
- en option, un commentaire facultatif à l'approbation.

<details><summary>Constat dans le code</summary>

Constaté. src/app/validations/page.tsx:128 lie directement `decideStep.bind(null, r.id, false, r.step)` à un ActionButton, sans dialogue. Dans src/lib/actions.ts:489-495, decideStep n'accepte pas de motif : il écrit le commentaire fixe « Rejeté — révision renvoyée en rédaction. » (ligne 492) et un audit `reject` dont le détail est l'ID du circuit (ligne 493). Seul un commentaire libre séparé est possible (CommentBox, validations/page.tsx:154).

</details>

#### 10. « À traiter » : révisions confiées par un ECO, rejets, brouillons et échéances du propriétaire
- **Fait le 11 octobre 2026** : une seule requête, `myActions` (src/lib/queries.ts), alimente l'encart « À traiter » de l'Accueil, la pastille (déplacée sur Accueil) et la cloche, qui suivent la liste de l'Accueil même après une navigation côté client, avec un lien vers l'endroit où agir pour les étapes de circuit à décider, les révisions en rédaction confiées par un ECO (avec sa référence), renvoyées en rédaction par un rejet ou jamais soumises (pour le propriétaire aussi, « confiée à … » quand un ECO a désigné quelqu'un d'autre), les modifications acceptées à greffer (D-26) et les revues et expirations dépassées ou à moins de 90 jours des documents dont l'utilisateur est propriétaire ou propriétaire de processus, chaque élément n'apparaissant que sur un document qu'il voit (D-14) et quand le serveur le laisserait agir ; les gestionnaires gardent la vue globale des échéances dans Archivage (tests : tests/integration/my-actions.test.ts, tests/unit/access.test.ts, tests/unit/todo.test.ts).

- **Effort** : moyen · **Références** : G19, FON-11

Le manque est confirmé. Il reste à créer une requête « mes actions » qui regroupe :
- les étapes de circuit (déjà faites) ;
- les révisions en brouillon dont `revisions.modifier_id` est l'utilisateur, avec `changeRef` ;
- les révisions renvoyées en rédaction après un rejet, pour l'auteur ou le propriétaire ;
- les brouillons jamais soumis dont il est propriétaire ;
- les échéances « Réviser » et « Renouveler » des documents dont il est propriétaire ou propriétaire de processus (`ownerId` / `processOwnerId`).

Ces éléments sont à brancher sur l'encart de l'Accueil, la pastille et la cloche. La vue globale des échéances reste dans Archivage pour les gestionnaires. L'effort passe à moyen, car il touche queries, page.tsx, layout.tsx et Header.

<details><summary>Constat dans le code</summary>

src/app/page.tsx:23 et src/app/layout.tsx:27 : `mine = workflows.filter((w) => w.mine && !w.locked)`. La pastille de la barre latérale (layout.tsx:62, Sidebar.tsx:50) et la cloche (layout.tsx:69) reprennent ce même tableau. `w.mine` exige `!w.outcome` (queries.ts:169) : une révision rejetée (decideStep, actions.ts:490-491, workflow clos et révision en `draft`) disparaît de la liste. openRevision (lifecycle.ts:96-100) enregistre `modifierId`, mais aucune vue ne le lit pour l'utilisateur courant. `deadlines()` (queries.ts:215-228) reçoit tous les documents visibles (page.tsx:24), sans filtre de propriétaire.

</details>

#### 11. Pages dédiées par département ou par métier

- **Effort** : moyen · **Références** : G12, FON-06

Le manque est confirmé. Il reste à créer une route `/departements/[code]`, ouverte par défaut sur le département de l'utilisateur. Elle montrerait les documents en vigueur du département, ses échéances, ses circuits en cours et ses recherches épinglées (les recherches partagées avec un département existent depuis le 11 octobre 2026, point 2). Il faudra aussi une configuration des filtres mis en avant pour chaque page, dans Administration, et une entrée dans la barre latérale.

Le squelette peut se construire dès maintenant sur la table `departments`, même provisoire (O-04). En revanche, le choix des filtres de chaque métier dépend du recueil des besoins par département (slide 9, étape 1), qui n'est pas fait.

<details><summary>Constat dans le code</summary>

src/components/shell/Sidebar.tsx:10-17 ne propose que home, explorer, search, workflow, retention et admin. src/app ne contient aucune route `/departements` (seulement administration, archivage, documents, explorateur, recherche et validations). Les briques existent : l'axe `department` (src/app/explorateur/page.tsx:10), les facettes dans l'URL (src/lib/search.ts) et `users.department` (src/db/schema.ts:41). docs/audit-deck-epc2i.md:699 classe G12 « partiel ». Le deck, ligne 348 de sa transcription, annonce des pages dédiées par métier.

</details>

#### 12. Recherche : facettes manquantes et tri
- **Fait le 11 octobre 2026** : onze facettes s'ajoutent aux huit existantes (`FACET_KEYS`, src/lib/search.ts) : sous-type, site, propriétaire, auteur (tel que la fiche l'affiche : texte libre, sinon l'utilisateur auteur, sinon le propriétaire), langue, mots-clés, organisme source, phase projet, lot, discipline et thème de recherche. `facetValues` renvoie une liste (plusieurs mots-clés par document) et `passes` garde un document qui a l'une des valeurs choisies ; `runSearch` compte toutes les valeurs d'une facette en un passage (`tally`). Une période porte sur une date au choix (modification, émission, effet de la révision en vigueur, révision, expiration ; `date`, `from`, `to` dans l'URL, bornes comprises, une borne peut manquer) ; un document sans cette date n'y entre pas. La date d'effet est celle de la révision en vigueur, comme sur la fiche (`effectiveDates`, src/lib/queries.ts), jamais la date prévue d'une révision approuvée en attente ; elle n'est lue que pour la recherche et son export (`listSearchDocs`), pas par les autres écrans. Le tri est choisi dans l'URL (`sort` : pertinence, date de modification, date d'émission, prochaine échéance de revue ou d'expiration, ID, titre) ; sans choix, pertinence s'il y a un texte, date de modification sinon (`sortOf`). La pertinence pondère où le texte est trouvé (ID et anciens ID, puis titre, mots-clés, référence externe et ID d'étude, puis type, sous-type, organisme source, propriétaire et auteur) et s'il occupe tout le champ, le début d'un mot ou l'intérieur d'un mot (`score`). Le plein texte couvre aussi le propriétaire, l'auteur et l'ID d'étude. Chaque valeur choisie a son propre paramètre dans l'URL (`?discipline=Électricité&discipline=Mécanique`) : une valeur en texte libre peut contenir une virgule (« Préfecture du Rhône, DDPP ») ; seules les facettes à codes acceptent encore `?type=PRO,NCR`. Écran : les nouvelles facettes ont la présentation de la maquette (case, libellé, nombre ; une valeur longue est coupée et se lit au survol) ; au-delà de 8 options, les autres se replient sous « N de plus » (les valeurs choisies restent visibles) ; bloc « Période » en bas de la colonne ; sélecteur « Trier par » au-dessus des résultats, dont la date affichée suit le tri (émission, échéance, sinon modification) ; « Effacer » garde le tri. L'export CSV suit les mêmes critères et le même ordre, gagne les colonnes site, mots-clés, dates d'émission, d'effet, de révision et d'expiration, et journalise la période et le tri. Les recherches enregistrées gardent la période et le tri (`saved_searches.period`, `saved_searches.order_by` avec contrainte ; migration unique régénérée) ; un tri seul n'est pas un critère. Une valeur de facette y tient jusqu'à 300 caractères (le plus long texte libre que l'import accepte) ; au-delà, ou avec plus de 50 valeurs par facette ou un texte de plus de 200 caractères, l'enregistrement est refusé avec un message (`beyondBounds`), au lieu de garder une autre recherche que celle affichée. D-14 : les comptes, la période et le tri ne portent que sur les documents que l'utilisateur peut lire, datés hors du cercle de rédaction par leur dernier changement visible. Reste : le filtrage et les comptes se font toujours en mémoire (point 50), une seule période à la fois. Tests : tests/unit/search.test.ts (`parseSearch`/`searchHref` aller-retour, valeurs avec virgule, période, tri, pertinence, facettes multivaluées, bornes) et tests/integration/search.test.ts (brouillon jamais compté ni exporté hors du cercle, date visible, date d'effet, export CSV et son journal, valeur avec virgule), tests/integration/saved-searches.test.ts (période et tri enregistrés, valeur longue ou avec virgule gardée, refus explicite au-delà des bornes).

- **Effort** : moyen · **Références** : G15, G32, FON-04

Le manque est confirmé. Il reste à ajouter des facettes : sous-type, site, propriétaire, auteur, langue, mots-clés (`facetValue` devra renvoyer une liste et `passes` tester l'intersection), organisme source, plages de dates (émission, effet, révision, expiration) et champs de contexte (phase, lot, discipline, thème).

Il faut aussi étendre le plein texte au propriétaire, à l'auteur et à l'ID d'étude, et proposer un tri choisi par l'utilisateur dans l'URL (date de modification, titre, ID, échéance). Le tri actuel est fixe, par date de modification décroissante.

Tout cela touche `parseSearch`, `searchHref`, `passes`, la colonne de facettes et l'export CSV. Passer au filtrage SQL est souhaitable : il se fait aujourd'hui en mémoire sur tous les documents.

Le tri devra aussi être enregistré par les recherches enregistrées (point 2 : `saveSearch`, `cleanCriteria`, `searchHref` ; nouvelle colonne de `saved_searches` distincte de `sort`, qui est l'ordre d'affichage, par exemple `order_by`).

<details><summary>Constat dans le code</summary>

src/lib/search.ts:3 : `FACET_KEYS = ['project','family','type','origin','attachment','department','status','conf']`. `facetValue` (search.ts:36-47) renvoie une seule valeur, ce qui exclut les mots-clés, qui en ont plusieurs. `matches` (search.ts:32) ignore owner, author, studyId, projectPhase, etc. src/app/recherche/page.tsx:16 et 86 affiche `results` dans l'ordre de `listDocs` (modifiedAt décroissant, queries.ts:69), sans paramètre de tri. src/app/api/export/search/route.ts suit les mêmes facettes.

</details>

#### 13. Dates d'expiration et de revue sans effet sur le cycle de vie

- **Effort** : moyen · **Références** : G36, G37, WFL-07

Le manque est confirmé, avec une nuance : depuis une échéance, le lien mène à la fiche, qui propose déjà « Demander une modification » et « Demander le retrait » (src/app/documents/[id]/page.tsx:136-139). Le lancement vers Vigie n'est donc qu'un raccourci. Il reste à faire :
- un indicateur et un filtre « expiré », dans l'explorateur, la recherche et la fiche, sans nouveau statut : le passage à Obsolète reste un workflow Vigie (D-17) ;
- une action « Revue effectuée », journalisée et réservée au propriétaire ou au gestionnaire, qui fixe la prochaine date de revue ;
- une périodicité de revue par type dans le registre (colonne de `doc_types` et écran Registre), avec le recalcul de `reviewDueAt` dans `putInForce`.

Les valeurs de périodicité par type seront à faire valider, comme les durées (O-07), mais le mécanisme peut se construire sans attendre.

<details><summary>Constat dans le code</summary>

src/lib/lifecycle.ts:37 : le statut de `refreshHeadline` ne dépend que de `state` et des révisions, et ignore `expiresAt`. src/lib/queries.ts:223-225 : `expiry` et `review` ne sont que des échéances. src/db/schema.ts:57-78 : `doc_types` n'a pas de périodicité de revue. putInForce (lifecycle.ts:45-54) ne recalcule pas `reviewDueAt`. src/app/archivage/DueTable.tsx:42-43 n'offre que « Archiver » et « Geler ». Aucune action « Revue effectuée » n'existe dans actions.ts. L'explorateur n'a pas de filtre « expiré » (src/app/explorateur/page.tsx:13).

</details>

#### 14. « Comparer » : comparer le contenu, pas seulement les attributs

- **Effort** : moyen · **Références** : G05

Aujourd'hui, « Comparer » ne compare que les attributs de deux versions (Dialogs.tsx:531-550). À faire :
1. Une route serveur qui extrait le texte des deux versions (PDF, DOCX, TXT), puis un affichage des écarts ligne à ligne. Il faut ajouter une bibliothèque d'extraction, et respecter `readerMaySeeVersion` : hors du cercle de rédaction, seule la révision en vigueur est lisible.
2. Pour une comparaison visuelle des fichiers Office, deux aperçus côte à côte, ce qui suppose le service de conversion (point M12).
Ni le deck ni la maquette ne fixent le niveau attendu (texte ou visuel). C'est à préciser avec l'utilisateur, mais aucune question O-xx n'en dépend.

<details><summary>Constat dans le code</summary>

src/components/dialogs/Dialogs.tsx:531-550 : le dialogue `Compare` n'affiche que le libellé, la date, l'auteur, le commentaire, le nom, la taille et le nombre de pages, et surligne les cellules qui diffèrent. Il est ouvert depuis `RevisionsTab` (src/app/documents/[id]/DocClient.tsx:135). Aucune bibliothèque d'extraction de texte n'est installée : package.json ne dépend que de pglite, drizzle-orm, next, react et server-only. L'audit garde cette réserve (docs/audit-deck-epc2i.md:636, G05). Dans la maquette, « Comparer » n'est qu'un bouton sans comportement défini (design/GED Groupe.dc.html:309) ; le deck n'exige pas de comparaison de contenu.

</details>

#### 15. Aperçu des fichiers Office : service de conversion en PDF

- **Effort** : moyen · **Références** : M12

Les fichiers .docx, .xlsx et .pptx n'ont pas d'aperçu. À faire :
- Conversion au dépôt, hors transaction comme `stageUpload`, avec LibreOffice sans interface ou Gotenberg.
- Stockage du rendu PDF à côté du fichier natif : nouvelle colonne de clé de rendu dans `working_versions`, et nombre de pages calculé sur le rendu (`countPdfPages`, src/lib/storage.ts:171).
- Service du rendu par `/api/documents/[id]/file`, avec repli sur le téléchargement si la conversion échoue ou si le service est absent.
- Affichage de `preview_note`.
Le même service servirait à la comparaison visuelle et à un éventuel rendu de publication (PDF/A). Ce dernier reste une question de l'audit (M12), qui ne bloque pas l'aperçu.
Point d'exploitation : l'outil de conversion doit être installé sur l'hôte, y compris pour l'app Mac (D-22).
Si SharePoint est activé (O-01), la conversion PDF de Microsoft Graph est une alternative, mais elle n'est pas nécessaire.

<details><summary>Constat dans le code</summary>

src/app/documents/[id]/DocClient.tsx:12-16 : le commentaire dit « no conversion exists ». Aux lignes 36-42, un fichier qui n'est ni PDF, ni image, ni texte affiche « Aperçu indisponible » et un bouton de téléchargement. La clé `preview_note` est définie (src/lib/i18n.ts:18 et 112) mais utilisée nulle part dans src/ (vérifié par grep) ; la maquette l'affiche sous la pagination (design/GED Groupe.dc.html:221). Aucune dépendance de conversion dans package.json. `working_versions` n'a pas de colonne pour un rendu PDF (src/db/schema.ts:239-244). M12 est marqué « Ouvert » dans l'audit (docs/audit-deck-epc2i.md:1568-1572).

</details>

#### 16. Lien « remplacé par » entre documents

- **Effort** : moyen · **Références** : M11

Le lien manque seulement entre documents distincts. Le cas principal : un document retiré par Vigie (D-17, statut Obsolète) et remplacé par un autre document, d'un autre ID. À faire :
- une table `document_links` (source, cible, nature : remplace / remplacé par, voir aussi) ;
- son affichage sur la Fiche, en masquant le document lié si le lecteur ne peut pas le voir (`canRead`) ;
- sa saisie lors de la demande de retrait (`requestChange` de nature obsolescence : document de remplacement proposé) ou lors de la création du document de remplacement, avec trace dans le journal.
Les autres relations (référence, annexe, enregistrement issu d'une procédure, documents touchés par une ECR) et leur caractère obligatoire restent une question de l'audit (M11) à poser à l'utilisateur.

<details><summary>Constat dans le code</summary>

src/db/schema.ts:120-174 : la table `documents` n'a aucune colonne de lien, et aucune table de relations n'existe parmi celles du schéma. Aucune occurrence de replacedBy, supersededBy ou d'un lien similaire dans src/. L'audit le confirme : « Ouvert. Le lien « remplacé par » proposé par l'assistant le 7 octobre à 17:33 n'est pas implémenté » (docs/audit-deck-epc2i.md:1562-1566). Nuance : au niveau des révisions, le statut « Remplacé » existe déjà (`revisions.supersededAt`, schema.ts:217). Comme une révision garde l'ID (D-11), la révision qui en remplace une autre est implicitement la lettre suivante du même document.

</details>

#### 17. Export complet pour la réversibilité

- **Effort** : moyen · **Références** : M22

On ne peut pas exporter l'ensemble des données de Codex. À faire : une route réservée à l'administration qui produit en flux une archive contenant :
- les documents et leurs métadonnées, les révisions, les versions de travail, les circuits et leurs étapes, les demandes Vigie, les lecteurs désignés et le journal, en JSON ;
- les fichiers, lus par `readStored`.
Un écrivain ZIP minimal sans compression, sur le modèle de src/lib/pdf.ts, éviterait une dépendance. Le reste de M22 (délai de reprise, perte de données tolérée, hébergement, sauvegardes) relève de l'exploitation et reste une question pour l'utilisateur.

<details><summary>Constat dans le code</summary>

Seuls deux exports existent. src/app/api/export/search/route.ts:7-23 produit un CSV des métadonnées des résultats visibles, sans fichiers, révisions ni historique. src/app/api/export/audit/route.ts:14-38 produit le CSV du journal, réservé à l'administration. Aucune autre route d'export dans src/app/api, aucune dépendance ZIP dans package.json. M22 est marqué « Ouvert » (docs/audit-deck-epc2i.md:1628-1632). Ce n'est pas écarté par D-21, qui ne vise que la migration entrante (import).

</details>

#### 18. Conservation : classe modifiable document par document et répercussion des règles du type

- **Effort** : moyen · **Références** : G39, D-20, ACC-06

La décision D-20 n'est qu'à moitié appliquée. À faire :
1. Une action réservée au droit Archiver qui modifie la durée, le déclencheur et le sort final d'un document. Elle est journalisée avec l'avant et l'après, et refusée sous gel juridique. Le champ correspondant s'ajoute sur la fiche.
2. Un marqueur de dérogation : colonne booléenne et migration à régénérer.
3. Dans `updateType`, l'option de répercuter la règle modifiée sur les documents de ce type sans dérogation, avec trace au journal. Sans elle, les valeurs provisoires resteront figées sur les documents existants le jour où O-07 sera tranchée.
Pas de blocage : seules les durées elles-mêmes attendent O-07.

<details><summary>Constat dans le code</summary>

src/lib/actions.ts:71-111 : `Fields` et `readFields` ne contiennent aucun champ de conservation. actions.ts:305 : `updateMeta` ne recopie la règle du type qu'au changement de type. actions.ts:759-779 : `updateType` ne met à jour que `doc_types` (ligne 777) et exige l'écran d'administration (`adminOnly`, 690-692), pas le droit Archiver. L'écran Archivage ne modifie que les règles par type (src/app/archivage/page.tsx:86-90, dialogue `type`). La fiche affiche la conservation sans pouvoir la modifier (src/app/documents/[id]/page.tsx:329-330). L'import copie la règle du type (src/lib/importer.ts:343). Pourtant, D-20 (docs/decisions.md:345-347), docs/modele-cible.md §8 et le commentaire de schema.ts:150 disent la classe « modifiable par un gestionnaire ».

</details>

#### 19. Reprise des documents d'une personne qui part

- **Effort** : moyen · **Références** : A15, M16 (la désactivation des comptes dépend de O-02)

Ce qui manque surtout, c'est un outil d'administration journalisé pour transférer d'un utilisateur à un remplaçant, en une seule fois :
- la propriété des documents (documents verrouillés compris) et le rôle de propriétaire de processus ;
- le modificateur désigné des révisions ouvertes ;
- les étapes de circuit en attente, avec les mêmes contrôles que delegateStep : pas d'auto-validation, droit d'approuver ;
- les titulariats de fonctions et les lecteurs désignés.
Il faudrait aussi qu'un gestionnaire puisse réassigner une étape bloquée. Cet outil ne demande pas de décision.
Trois points en demandent une :
- les obligations du propriétaire, de l'auteur et du propriétaire de processus (revue périodique, traitement des ECR) : question A15 de l'audit ;
- la règle par défaut du remplaçant (manager, gestionnaire) : question A15 ;
- la désactivation et la détection automatique des départs : elles relèvent du fournisseur d'authentification (O-02).

<details><summary>Constat dans le code</summary>

Le manque est réel. Aujourd'hui, on ne peut changer le propriétaire que document par document, par updateMeta (src/lib/actions.ts:278-290 et 94, 127), et c'est refusé sur un document verrouillé (archivé, obsolète ou gelé, actions.ts:286-287). Les titulaires de fonctions s'ajoutent ou se retirent un par un (addFunctionHolder et removeFunctionHolder, actions.ts:732-756). Seul le titulaire de l'étape en cours peut la déléguer (delegateStep, actions.ts:520-521) : personne ne peut donc débloquer une étape assignée à un absent. Il n'existe aucune action pour annuler un circuit ni pour changer le modificateur désigné d'une révision ouverte (liste des actions, actions.ts:52-759). La table users n'a pas d'indicateur actif ou parti (src/db/schema.ts:35-44), et les utilisateurs ne viennent que du seed (src/db/seed.ts:89). L'audit note A15 « Ouvert » et rattache les départs à O-02 (M16).

</details>

#### 20. Modifications simultanées : métadonnées écrasées sans avertissement, brouillon sans réservation

- **Effort** : moyen · **Références** : D-12

À faire :
- une colonne `version` (entier) sur documents, envoyée en champ caché par le dialogue de métadonnées et comparée dans la transaction de updateMeta, avec une erreur `stale` (clé FR/EN) qui invite à recharger ;
- une réservation de la révision en brouillon : colonnes `checked_out_by` et `checked_out_at` sur revisions, actions Réserver et Libérer, libération forcée par un gestionnaire, refus du dépôt dans addWorkingVersion pour toute autre personne que le titulaire, mention « Réservé par … » sur la fiche ;
- à défaut de réservation, au minimum une « version de base » envoyée par le dialogue de version de travail et un avertissement si une version plus récente existe.
C'est compatible avec D-12 : les versions de travail restent conservées. Il faut régénérer la migration (CLAUDE.md).

<details><summary>Constat dans le code</summary>

Constaté. updateMeta (src/lib/actions.ts:278-322) relit le document, puis réécrit tous les champs du formulaire (ligne 306) sans comparer de version. documents n'a pas de colonne de version, et `modifiedAt` est une date au jour (src/db/schema.ts:173). addWorkingVersion (src/lib/actions.ts:217-258) accepte tout membre du cercle de rédaction ayant le droit upload (lignes 219 et 228), c'est-à-dire le propriétaire, le modificateur désigné et les gestionnaires. Il prend le numéro max+1 (ligne 244) sans vérifier sur quelle version le déposant s'est appuyé. Il n'existe ni réservation ni colonne checked_out.

</details>

#### 21. Preuve d'approbation d'une révision (fiche de visa)

- **Effort** : moyen · **Références** : P08, P07, M05

À faire :
- une route GET `/api/documents/[id]/approval?rev=B`, contrôlée par getDoc/canRead et journalisée (`download` ou nouvelle action) ;
- elle génère une fiche PDF par révision : ID, titre, révision, type, circuit, chaque étape (fonction, titulaire, date, décision, délégations tirées du journal `delegate`), commentaires, dates d'approbation, d'effet et de mise en vigueur, référence ECO ;
- étendre src/lib/pdf.ts au retour à la ligne et à plusieurs pages, car les commentaires peuvent dépasser une page ;
- un bouton dans l'onglet Révisions ou Validation ;
- pour une révision importée (action `import`, pas de circuit), la fiche précise que l'approbation a eu lieu dans l'ancien système.

<details><summary>Constat dans le code</summary>

Constaté. src/app/api/documents/[id] ne contient que file/route.ts. Aucune route ni action n'exporte un circuit. simplePdf (src/lib/pdf.ts:19-52) n'est utilisé que pour le fichier de remplacement (file/route.ts:102) ; il ne produit qu'une page (`/Count 1`, ligne 37) et ne fait pas de retour à la ligne. Les données existent : étapes avec titulaire et date (workflow_steps), commentaires, approvedAt, inForceAt, changeRef (schema.ts). Le constat d'audit P08 est « Ouvert » (docs/audit-deck-epc2i.md:1672-1674).

</details>

### Sécurité et conformité (12)

#### 22. Historique des métadonnées (valeurs avant et après)

- **Effort** : faible · **Références** : G05, ACC-05

Le manque est confirmé. Dans `updateMeta`, il reste à comparer `d` (avant) et `f` (après) champ par champ, et à journaliser les champs modifiés avec leurs anciennes et nouvelles valeurs. Deux options : un `detail` structuré dans `audit_log`, ou une table `metadata_history` si l'on veut une restitution fine.

L'onglet Historique sait déjà afficher le détail. L'effort est donc faible pour la version « détail texte », et moyen avec une table dédiée et un affichage avant/après. Le point relève de la traçabilité (ACC-05).

<details><summary>Constat dans le code</summary>

src/lib/actions.ts:306 : `tx.update(s.documents).set({ ...f, ... })` écrase les champs. src/lib/actions.ts:307 : `audit(tx, ctx.user.id, 'edit', id, d.revInForce ?? d.revWorking ?? '')` ne journalise que la lettre de révision. L'onglet Historique (src/app/documents/[id]/page.tsx:460-465) affiche déjà `h.detail`. docs/audit-deck-epc2i.md:636 (G05) : « les métadonnées ne sont toujours pas versionnées ».

</details>

#### 23. Authentification entre serveurs : registre ouvert, jetons statiques sans signature ni rotation

- **Effort** : faible · **Références** : T-01

Côté Codex, à développer :
- un jeton de service (ex. `CODEX_REGISTRY_TOKEN`) contrôlé par `checkBearer` sur `GET /api/registry`, et réutilisé pour les futures API destinées à Keystone ;
- la vérification d'une signature HMAC-SHA256 du corps brut et d'un horodatage (fenêtre de quelques minutes) sur `POST /api/integrations/vigie`, puis la même signature sur les futurs appels sortants vers Vigie (`submitChange`, src/lib/vigie.ts:29) ;
- l'acceptation de deux valeurs pendant une rotation (variable `…_NEXT` ou liste séparée par des virgules) ;
- la journalisation des refus (401/503 : route, IP, horodatage, jamais le jeton) ;
- la documentation dans `.env.example` et `docs/api.md` (tableau l.5-9 et section registre l.38-42).
Le contrat de signature est à aligner avec Vigie (dépôt séparé), mais la vérification côté Codex ne dépend de rien. Le passage à des client credentials OAuth dépendra du fournisseur retenu (O-02).

<details><summary>Constat dans le code</summary>

Constaté : src/app/api/registry/route.ts:6-7 (commentaire « open within the group network ») et :11-12 (GET sans aucun contrôle) ; src/lib/importer.ts:32-41 (checkBearer : une seule valeur par variable, comparaison de condensés SHA-256 en temps constant, 401 renvoyé sans aucune trace) ; src/app/api/integrations/vigie/route.ts:29-31 et src/app/api/import/route.ts:17-19 (seul contrôle = Bearer) ; aucune occurrence de HMAC, d'horodatage ou de signature dans src/ ; docs/api.md:7 et :41 (registre « aucune » authentification) ; .env.example:6-12 (seuls CODEX_IMPORT_TOKEN et VIGIE_WEBHOOK_TOKEN). Aucun webhook sortant n'existe encore (src/lib/vigie.ts:29, appel à Vigie seulement en commentaire). Ni D-03 ni aucune autre décision n'écarte ce durcissement.

</details>

#### 24. Limitation de débit des API

- **Effort** : faible

À développer : une limitation par IP et par jeton sur `/api/import`, `/api/integrations/vigie`, `/api/registry`, `/api/documents/[id]/file` et `/api/export/*`, avec réponse 429 et `Retry-After`. Deux options :
- dans Codex, un `src/proxy.ts` (Next 16) ou un utilitaire appelé par chaque route, avec un compteur en mémoire tant que PGlite impose un seul processus ;
- au reverse proxy, à documenter dans le README.
Au passage, refuser une requête d'import sans `Content-Length` (ou plafonner le flux) : aujourd'hui, un envoi en transfert par morceaux contourne le contrôle de import/route.ts:20, et `formData()` met le corps entier en mémoire avant le contrôle de taille (l.43).

<details><summary>Constat dans le code</summary>

Constaté : aucun src/proxy.ts, src/middleware.ts, proxy.ts ni middleware.ts (ls) ; aucune occurrence de 429/Retry-After/rate limit côté serveur hormis la reprise des appels Graph (src/lib/storage.ts:85-91) et le 502 du fichier (src/app/api/documents/[id]/file/route.ts:98). src/app/api/import/route.ts:20 ne contrôle que l'en-tête Content-Length ; :28 `req.formData()` charge tout le corps en mémoire avant le contrôle de taille de :43. src/app/api/registry/route.ts:11 sans authentification. checkBearer (src/lib/importer.ts:32-41) ne freine pas les essais de jetons.

</details>

#### 25. En-têtes de sécurité HTTP absents

- **Effort** : faible

À ajouter dans `next.config.ts` (`headers()` sur `/:path*`, et `poweredByHeader: false`) :
- Content-Security-Policy avec `default-src 'self'`, `frame-ancestors 'self'` et `frame-src 'self'` pour l'iframe d'aperçu PDF de même origine. Les scripts inline de Next exigent un nonce (posé par `src/proxy.ts`) ou, à défaut, `'unsafe-inline'` ; vérifier aussi `next/font` (police auto-hébergée) ;
- Strict-Transport-Security, à n'activer que derrière HTTPS ;
- X-Frame-Options: SAMEORIGIN, Referrer-Policy: strict-origin-when-cross-origin, Permissions-Policy restrictive, X-Content-Type-Options: nosniff partout.
À vérifier ensuite dans l'app Mac (WebKit, port 3110), qui charge la même origine.

<details><summary>Constat dans le code</summary>

Constaté : next.config.ts:3-9 ne contient que serverExternalPackages et experimental.serverActions (pas de `headers()`, pas de `poweredByHeader: false`) ; aucune occurrence de Content-Security-Policy, frame-ancestors ou X-Frame-Options dans src/ ; seul src/app/api/documents/[id]/file/route.ts:82 pose X-Content-Type-Options: nosniff. L'aperçu PDF est une iframe de même origine (src/app/documents/[id]/DocClient.tsx:30 et :35).

</details>

#### 26. Brouillons : leur existence et leur activité restent visibles hors du cercle de rédaction
- **Fait le 10 octobre 2026** : hors du cercle de rédaction, la fiche, l'historique, l'accueil, les notifications, l'explorateur, la recherche, le journal et les exports CSV ne montrent plus rien d'une révision ouverte ou annulée (règle par `audit_log.revision_id`, `readerMaySeeRevision` et `readerMaySeeEntry` dans `src/lib/access.ts`).
- **Indices résiduels, à arbitrer** : une ECR de modification qui a ouvert une révision s'affiche « Appliquée » dans l'onglet Demandes et, pour son auteur, dans « Mes demandes Vigie » (sans date de décision depuis le 11 octobre), et « Acceptée » quand elle attend une révision ouverte, sans référence ECO, modificateur ni motif d'attente. Une modification greffée sur une révision ouverte (D-26) reste affichée « Acceptée » tant que cette révision est ouverte, comme si elle attendait (`changeAsSeen`, src/lib/access.ts), et « Appliquée » si elle est annulée ; pendant ce temps, le bouton « Demander une modification » reste grisé pour ce lecteur (« demande déjà en cours »), alors que `requestChange`, appelé directement, accepterait sa demande. Depuis D-26, le bouton est présent et `requestChange` accepte la demande quand une révision est ouverte : l'ancien refus `locked_working` n'existe plus ; les pièces attendues de Keystone affichent « en cours » pour un brouillon, et le fil du projet reçoit « Pièce … déposée » ou « … de nouveau attendue » (src/lib/actions.ts, `createDocument` et `releasePieces`), sans ID de document. Ils sont laissés en l'état en attendant une décision.

- **Effort** : faible · **Références** : ACC-03, D-14, G13

Filtrer avec `inDraftingCircle` (src/lib/access.ts) :
- `wip` et `revItems` : hors du cercle, ne garder que les révisions en vigueur et remplacées, sans le modificateur ni la référence ECO de la révision ouverte ;
- `listAudit` : prendre le contexte d'accès et masquer, hors du cercle, les actions liées au travail en cours (upload/working, request, approve/reject/delegate/sign, reclass d'un brouillon, ecr → lettre) ;
- les flux d'activité de l'accueil et des notifications (page.tsx:32, layout.tsx:29-30) ;
- `workingLabel` dans l'explorateur (l.183 et l.222) et dans l'export CSV de recherche (route.ts:17).

<details><summary>Constat dans le code</summary>

Constaté, contrairement à D-14 (« les autres lecteurs ne voient que la révision en vigueur ») :
- src/app/documents/[id]/page.tsx:116 (`wip` calculé sans `circle`) et :208 (étiquette affichée) ;
- :149-165 (`revItems` liste toutes les révisions, brouillon et en révision compris, avec le modificateur et la référence ECO ; seuls les fichiers sont filtrés, l.161-163) ;
- :83 et :460-468 (onglet Historique = `listAudit` complet) ;
- src/lib/queries.ts:233-245 (`listAudit` sans aucun contrôle de cercle) ;
- src/app/page.tsx:32 et src/app/layout.tsx:29-30 (activité et notifications filtrées seulement par document visible) ;
- src/app/explorateur/page.tsx:183 et :222 (« B.2 en cours » dans la liste et dans l'aperçu rapide) ;
- src/app/api/export/search/route.ts:17 (`workingLabel` exporté en CSV).
Déjà protégés : les fichiers (`readerMaySeeVersion`, route fichier l.62) et le circuit en cours (page.tsx:103, `running = circle ? runningAny : null`).

</details>

#### 27. Journal d'audit en ajout seul : un reclassement réécrit l'historique
- **Fait le 10 octobre 2026** : un reclassement ne réécrit plus `audit_log.doc_id` (la fiche lit l'ID courant et ses alias, l'accueil et les notifications ramènent chaque ligne à l'ID courant, l'onglet Journal et son export gardent l'ID de l'époque) et la base refuse UPDATE, DELETE et TRUNCATE sur `audit_log` par des déclencheurs posés à chaque démarrage dans `src/db/index.ts`.

- **Effort** : faible · **Références** : G48

À développer :
- supprimer la mise à jour de actions.ts:302 : la ligne 'reclass' (l.303) suffit à relier l'ancien ID au nouveau ;
- dans `listAudit` avec `docId`, interroger `inArray(auditLog.docId, [doc.id, ...doc.aliases])` ;
- dans les flux d'activité de l'accueil (src/app/page.tsx:32) et des notifications (src/app/layout.tsx:29-30), ramener chaque ligne à l'ID courant par une table alias → ID, sinon l'historique d'avant le reclassement disparaît de ces flux ;
- garder l'ancien ID tel quel dans l'onglet Journal de l'administration et dans l'export CSV, puisque c'est l'ID de l'époque.

<details><summary>Constat dans le code</summary>

Constaté : src/lib/actions.ts:302, dans updateMeta, avant la première approbation (l.296-298) : `tx.update(s.auditLog).set({ docId: id }).where(eq(s.auditLog.docId, docId))` réécrit toutes les lignes existantes. src/lib/queries.ts:236 filtre sur l'ID exact. getDoc résout déjà les alias (queries.ts:76-81). Les anciens ID ne sont jamais réattribués (src/lib/codification.ts:9-13), ce qui rend sûre une résolution par alias. C'est la seule écriture UPDATE sur audit_log du code (grep auditLog).

</details>

#### 28. Journaliser les consultations

- **Effort** : faible · **Références** : G48, M05

Dans GET de src/app/api/documents/[id]/file/route.ts, journaliser 'view' quand download vaut 0. Le détail porte le libellé de révision et de version (x.label, par exemple « B » ou « B.2 ») et le format. Il faut aussi ajouter la clé act_view, en FR et en EN, dans src/lib/i18n.ts, à côté de act_download (lignes 14 et 108). HEAD reste sans journal.

Point d'attention : l'iframe PDF est remontée à chaque changement de page (key={page}, DocClient.tsx:30) et la réponse est en Cache-Control no-store. Chaque page tournée referait donc un GET, donc une ligne de journal. Il faut dédoublonner, par exemple une seule entrée 'view' par utilisateur, document et version sur quelques minutes, ou journaliser une fois au rendu de la fiche (page.tsx) plutôt qu'à chaque requête de fichier.

Si le volume pose problème, on peut se limiter à Confidentiel et Très confidentiel. C'est un choix de réglage, à signaler à l'utilisateur sans en faire un blocage. La valeur probante reste limitée tant que l'identité est simulée (O-02), mais cela n'empêche pas de développer la journalisation.

<details><summary>Constat dans le code</summary>

Le manque est confirmé dans le code. Dans src/app/api/documents/[id]/file/route.ts, la ligne 112 n'appelle audit() que si x.download est vrai (lignes 112-115), et le commentaire de la ligne 86 le dit (« ?download=1 forces a download and is logged »). L'aperçu en ligne passe par cette même route sans download=1 : fileUrl est construit en src/app/documents/[id]/page.tsx:99, puis chargé par l'iframe PDF (src/app/documents/[id]/DocClient.tsx:30), par l'img (:33) et par l'iframe texte (:35). L'ouverture de la fiche (page.tsx:63, getDoc) n'écrit rien non plus. Les seuls appels à audit() sont la route fichier (download), src/lib/actions.ts, src/lib/lifecycle.ts et src/lib/importer.ts ; aucun ne porte l'action 'view'. HEAD ne journalise déjà rien (route.ts:119-124). G48 (docs/audit-deck-epc2i.md:1023) liste encore « les consultations ne sont pas journalisées ». M05 (:1526-1530) est une question d'audit sans numéro O-xx et ne fait l'objet d'aucune décision contraire dans docs/decisions.md.

</details>

#### 29. Validations : circuits, titres et commentaires visibles après la perte d'accès au document
- **Fait le 10 octobre 2026** : un circuit n'est plus visible d'un participant qui ne peut plus lire le document ou la révision (il disparaît de Validations, un lien vers lui ramène à la liste), et `addComment` répond `not_found` dans ce cas.

- **Effort** : faible · **Références** : D-14, ACC-02, ACC-03

À faire :
- dans listWorkflows, calculer `visible = ctx.seesAll || (involved && (circuit en cours || canRead(ctx, doc, ix)))`, ce qui demande de charger les colonnes d'accès des documents et getAccessIndex ;
- ou, à défaut, garder la ligne mais masquer le titre et les commentaires (« document non accessible ») ;
- dans addComment, refuser par `not_found` un document illisible (canRead) ;
- vérifier aussi le lien « Ouvrir » de l'onglet Validation de la fiche, qui suit déjà `w.visible`.

<details><summary>Constat dans le code</summary>

Constaté. listWorkflows (src/lib/queries.ts:152 et 172) calcule `visible: ctx.seesAll || involved` sans appeler canRead. Pour les circuits terminés ou rejetés, buildAccessIndex retire les valideurs du cercle (src/lib/access.ts:36). Dans src/app/validations/page.tsx, la liste (lignes 90-101) affiche w.docId et w.docTitle, et l'en-tête (lignes 108-109) r.docTitle, même quand getDoc renvoie 'hidden' (lignes 52-53, doc vaut alors null). Les commentaires restent affichés (lignes 148-153), et CommentBox reste offert (ligne 154). addComment (src/lib/actions.ts:550-551) ne vérifie que `seesAll || involved`, sans canRead.

</details>

#### 30. Exports CSV non journalisés
- **Fait le 10 octobre 2026** : chaque export CSV est journalisé (action `export`) avec sa requête et ses facettes, ou « journal complet », et le nombre de lignes envoyées, une requête HEAD ne journalisant rien.

- **Effort** : faible · **Références** : G48, M05

À faire :
- rendre `audit_log.doc_id` facultatif (schéma, migration régénérée), puis adapter listAudit, l'écran d'administration et l'export, qui construisent `href` à partir de docId ;
- journaliser chaque export avec l'action `export` et, en détail, la requête et les facettes (recherche) ou « journal complet » (audit), ainsi que le nombre de lignes ;
- ajouter `act_export` en FR et en EN.
Ce point partage sa dépendance (doc_id facultatif) avec le point sur la journalisation des actions d'administration.

<details><summary>Constat dans le code</summary>

Constaté. src/app/api/export/search/route.ts:8-22 et src/app/api/export/audit/route.ts:14-40 n'appellent jamais audit(). src/lib/i18n.ts ne contient pas de clé `act_export` (lignes 14, 26, 59 et 85 pour le FR). Dans src/db/schema.ts:325, `audit_log.doc_id` est `notNull()` : on ne peut donc pas écrire de ligne de journal sans document.

</details>

#### 31. Empreinte SHA-256 des fichiers : intégrité (« coffre-fort ») et détection des doublons

- **Effort** : moyen · **Références** : ARC-03, G02, §7.4, M09, P06

À développer :
- une colonne `sha256` dans `working_versions`, puis régénérer la migration unique et `npm run db:reset` ;
- le calcul dans `stageFile`, qui couvre à la fois le dépôt (`stageUpload`) et l'import ;
- une vérification dans la route fichier après `readStored` (src/app/api/documents/[id]/file/route.ts:94) : en cas d'écart, refuser de servir le fichier, journaliser et alerter ;
- l'affichage de l'empreinte dans l'onglet Révisions et dans le détail du journal ;
- un avertissement au dépôt et à l'import quand la même empreinte existe déjà sur un autre document visible ;
- un recalcul pour les fichiers déjà stockés, par un script de maintenance.

<details><summary>Constat dans le code</summary>

Constaté : src/db/schema.ts:229-247 (working_versions : storage, file_key, file_name, mime, size, pages, aucune colonne d'empreinte) ; src/lib/storage.ts:195-201 (stageFile ne calcule rien) et :258-260 (readStored renvoie les octets sans vérification) ; la seule utilisation de SHA-256 dans src/lib est la comparaison des jetons (src/lib/importer.ts:26) ; l'import ne détecte que le rejeu d'une legacyRef (importer.ts:279 et suivantes) ; docs/audit-deck-epc2i.md:1664-1666 (P06 : « aucune détection de doublons (aucune empreinte de fichier) »).

</details>

#### 32. Fichiers déposés : antivirus et formats admis

- **Effort** : moyen · **Références** : M12

À brancher sans attendre :
- une analyse antivirus avant `st.put` dans `stageFile`, qui couvre à la fois le dépôt et l'import : ClamAV (clamd en INSTREAM) ou un service équivalent. Un fichier infecté est refusé et l'événement journalisé ; si le service est indisponible, le dépôt est refusé ;
- un refus par défaut des exécutables et scripts (.exe, .bat, .js, .html, etc.), contrôlé par extension et par signature.
Quand l'utilisateur aura tranché M12 (formats acceptés, taille maximale, PDF/A) : une liste de formats par type dans le registre, l'attribut `accept` dans `FilePicker`, et le même contrôle côté serveur, y compris à l'import.

<details><summary>Constat dans le code</summary>

Constaté : src/lib/storage.ts:195-205 (stageFile/stageUpload stockent tout fichier, exécutables et archives compris, sans analyse) ; src/components/dialogs/Modal.tsx:127 (input file sans `accept`) ; next.config.ts:7 (Server Actions jusqu'à 50 Mo). Atténuation déjà en place : la route fichier ne sert inline que des types sûrs (src/app/api/documents/[id]/file/route.ts:14 et :76-82) et force les autres en téléchargement (octet-stream, nosniff). La liste des formats admis relève de la question d'audit M12 (docs/audit-deck-epc2i.md:1568-1572), qui n'est pas reprise dans O-01..O-11 ; l'antivirus n'en dépend pas.

</details>

#### 33. Journal d'audit : actions d'administration et commentaires non journalisés, horodatage sans fuseau
- **Fait le 10 octobre 2026** : `audit_log` accepte une cible sans document (`target_kind`, `target_id`), droits, organisation, titulaires, registre, commentaires de circuit et champs modifiés par `updateMeta` sont journalisés avec l'avant et l'après stockés en JSON (`audit_log.data`) et rendus dans la langue du lecteur selon les règles de lecture de `docs/modele-cible.md` §5, et `at` est un `timestamptz` affiché à l'heure de Paris (restent les consultations, point 28, et la valeur probante, O-02).

- **Effort** : moyen · **Références** : G48, M05, ACC-05

À développer :
- dans `audit_log`, rendre `doc_id` facultatif et ajouter `target_kind` et `target_id` (permission, département, site, fonction, type), puis régénérer la migration unique et faire `npm run db:reset` ;
- journaliser `togglePermission`, `addOrgValue`, `add/removeFunctionHolder` et `updateType` avec l'avant et l'après en JSON ;
- journaliser `addComment` : `audit(db, ctx.user.id, 'comment', wf.w.docId, workflowId)` ;
- enrichir l'audit 'edit' de `updateMeta` avec les champs modifiés ;
- adapter `listAudit` (lien selon la cible), l'onglet Journal de l'administration et l'export CSV (src/app/api/export/audit/route.ts) ;
- passer `at` en timestamptz (UTC stocké, affichage en Europe/Paris) ;
- interdire UPDATE et DELETE sur `audit_log` par un trigger ou des droits, ce qui suppose d'avoir traité le point suivant (actions.ts:302).

<details><summary>Constat dans le code</summary>

Constaté : src/lib/actions.ts:542-555 (addComment : insert sans audit) ; :694-780 (togglePermission, addOrgValue, addFunctionHolder, removeFunctionHolder, updateType : aucun appel à audit(), 0 occurrence dans ce bloc) ; :307 (l'audit 'edit' de updateMeta ne note que la lettre de révision, sans l'avant ni l'après) ; src/db/schema.ts:320-327 (doc_id notNull l.325, aucune cible générique) ; src/lib/lifecycle.ts:16-18 (audit exige un docId) ; src/lib/format.ts:32-39 (nowStamp = heure de Paris sans décalage ; la preuve citée format.ts:82-89 était erronée) ; schema.ts:322 (timestamp sans fuseau) ; src/lib/queries.ts:233-245 (href toujours /documents/…) ; README.md:71 (« Chaque action alimente le journal d'audit »).

</details>

### Intégrations (2)

#### 34. Modificateur désigné par Vigie : son droit de rédiger n'est pas contrôlé
- **Fait le 10 octobre 2026** : le modificateur désigné par Vigie passe, pour le webhook comme pour la simulation, le même contrôle que le défaut (`mayDraft`, src/lib/lifecycle.ts : droit `upload` de son rôle par défaut dans la matrice en base et document lisible), faute de quoi le webhook répond 400 `modifier_not_allowed` et la simulation affiche une erreur traduite sans repli sur le défaut, le dialogue de simulation ne propose que les personnes qui peuvent rédiger, et une acceptation en attente dont le modificateur a perdu ce droit s'applique pour le modificateur par défaut avec une ligne de journal et un message, distinct si ce dernier ne peut pas rédiger non plus ; reste : quand Vigie ne désigne personne, le repli du défaut sur le propriétaire n'est toujours ni contrôlé ni signalé.

- **Effort** : faible · **Références** : D-16, T-01

À faire :
- dans applyChangeDecision, ou en amont dans le webhook et la simulation, appliquer au modifierId explicite le même contrôle que defaultModifier : defaultPerms(role).has('upload') ;
- en cas d'échec, répondre 400 `modifier_not_allowed` (webhook) ou une erreur traduite (simulation), ou bien revenir au modificateur par défaut en le signalant dans la réponse ;
- filtrer la liste du dialogue VigieDecision aux personnes qui peuvent déposer ;
- documenter ce comportement dans docs/api.md (tableau des champs et des réponses).

<details><summary>Constat dans le code</summary>

Constaté. Le webhook (src/app/api/integrations/vigie/route.ts:43-45) ne vérifie que l'existence et le caractère non système du modifierId. simulateVigieDecision (src/lib/actions.ts:592-593) ne fait pas plus, et son dialogue propose tous les utilisateurs non système (src/components/dialogs/Dialogs.tsx:587-588, userOptions). À l'inverse, defaultModifier exige le droit upload avec le rôle par défaut, et un document lisible (src/lib/lifecycle.ts:117-123 ; docs/api.md:263). addWorkingVersion exige `upload` (actions.ts:219) : un auditeur ou un lecteur désigné par Vigie verrait le brouillon, puisqu'il est dans modifiersBy (access.ts:33), sans pouvoir rien déposer.

</details>

#### 35. Décision Vigie acceptée mais inapplicable : réponse 409 et décision perdue
- **Fait le 10 octobre 2026** : une acceptation de Vigie reçue pour un document archivé ou sous gel juridique est enregistrée (statut `accepted`, avec ECO, modificateur et note) et s'applique à la levée du gel ou à la restauration (`applyPendingDecision`, src/lib/lifecycle.ts), le webhook répond 202 au lieu de 409 (rejeu idempotent), la simulation fait de même avec un message traduit, la fiche signale la décision en attente et `docs/api.md` décrit ce comportement ; restent à prévenir Vigie quand la décision s'applique (O-10) et le cas théorique d'un document obsolète, où l'acceptation resterait en attente.

- **Effort** : moyen · **Références** : D-16, D-17, T-01

Le problème est confirmé, avec une précision sur sa cause. Pour une modification, le refus `locked_working` est pratiquement impossible : `requestChange` refuse déjà s'il existe une révision ouverte (actions.ts:576), seul un ECO peut ensuite ouvrir une révision (lifecycle.ts:150) et il n'y a qu'une demande en attente par document (schema.ts:315). Le cas réel est un document mis sous gel juridique (`holdDocuments`, actions.ts:632) ou archivé (`archiveDocuments`, actions.ts:610) pendant que sa demande attend la décision de Vigie. Vigie reçoit alors un 409 `document_locked`, rien n'est enregistré, et la fiche affiche toujours « Transmise à Vigie ».
À faire :
- écrire la décision même quand elle ne peut pas s'appliquer : status 'accepted', ecoRef, modificateur, note. Le statut existe déjà (schema.ts:293) et la fiche le traite déjà comme une demande en cours (src/app/documents/[id]/page.tsx:109) ;
- l'appliquer à la levée du verrou, c'est-à-dire dans `releaseHold` (actions.ts:649) et `restoreArchived` (actions.ts:668), ou bien la signaler sur la fiche et à Vigie ;
- répondre 202 (décision enregistrée, en attente d'application) plutôt que 409, et documenter ce comportement dans `docs/api.md:284`.

<details><summary>Constat dans le code</summary>

Constaté : src/lib/lifecycle.ts:141-149 (retour d'erreur sans écriture pour un document verrouillé ou une révision déjà ouverte), 164 (passage direct à 'implemented') ; src/app/api/integrations/vigie/route.ts:57-64 (409 sans rien écrire) ; schema.ts:293 et 315 (le statut 'accepted' existe et compte déjà comme « en attente ») ; grep : aucun `status: 'accepted'` écrit dans src/. Cas réels : holdDocuments (actions.ts:632) et archiveDocuments (actions.ts:610) ne vérifient pas les demandes en attente.

</details>

### Exploitation et déploiement (16)

#### 36. Nettoyage des fichiers orphelins

- **Effort** : faible · **Références** : T-01 (partie SharePoint)

À faire : une tâche de rapprochement, lancée par le planificateur (voir le point « Planificateur »).
- Elle liste les fichiers de `FILES_DIR` et, pour SharePoint, ceux de `_staging/`.
- Elle supprime les fichiers qu'aucun `working_versions.file_key` ne référence et qui sont plus anciens qu'un délai de grâce, pour ne pas toucher à un dépôt en cours.
- Elle relance `nameStoredFile` sur les clés restées sous leur nom provisoire : suffixe `-upload.ext` en local, dossier `_staging` sur SharePoint.
La partie SharePoint ne pourra être vérifiée que sur un vrai tenant (T-01).

<details><summary>Constat dans le code</summary>

Vérifié : le fichier est déposé avant la transaction (src/lib/actions.ts:185-186 ; addWorkingVersion l.236). `withStaged` (actions.ts:134-141) ne le supprime que si la transaction lève une exception : un arrêt du processus entre le dépôt et le commit le laisse sans enregistrement. `nameStoredFile` (src/lib/storage.ts:216-227) est fait « au mieux ». En local, il crée d'abord un lien dur (l.49) puis met la base à jour (l.221) : si la mise à jour échoue, le nouveau nom reste orphelin ; si `remove` échoue (l.222), l'ancien nom reste orphelin. Même schéma dans l'import (src/lib/importer.ts:372-376) et dans `renameDocFiles` (storage.ts:233-245). Aucun code ne compare le stockage (`.data/files` ou `_staging/` de SharePoint, storage.ts:100) aux `working_versions.file_key`.

</details>

#### 37. Vérifier la configuration au démarrage

- **Effort** : faible

À faire : un `src/instrumentation.ts` (fonction `register`) qui valide l'environnement au démarrage.
- Il refuse une valeur inconnue de `CODEX_STORAGE`, et `sharepoint` sans les quatre `CODEX_SP_*`.
- Il prévient si `VIGIE_API_URL` est défini alors que l'intégration réelle n'existe pas encore.
- Il vérifie que `CODEX_DATA_DIR` est accessible en écriture.
L'absence de `CODEX_IMPORT_TOKEN` ou de `VIGIE_WEBHOOK_TOKEN` est voulue (503 documenté dans .env.example) : un simple avertissement suffit.

<details><summary>Constat dans le code</summary>

Vérifié :
- Les variables `CODEX_SP_*` ne sont lues qu'au premier appel Graph (`env()`, src/lib/storage.ts:67-71 ; `drive()` l.94).
- Une valeur de `CODEX_STORAGE` autre que `sharepoint` bascule en silence sur le stockage local (storage.ts:128).
- Il n'y a pas de `src/instrumentation.ts` : aucun fichier de ce nom dans le dépôt.
- Autre incohérence possible : dès que `VIGIE_API_URL` est défini, `vigieSimulated()` renvoie faux (src/lib/vigie.ts:17-19) et la simulation des décisions disparaît, alors que `submitChange` n'appelle jamais Vigie (vigie.ts:29, simple commentaire).

</details>

#### 38. Planificateur : mise en vigueur différée, relances, nettoyage, envois sortants

- **Effort** : faible · **Références** : D-11, O-09, M19, T-01

Le cœur du point est réel : une révision approuvée n'entre en vigueur à sa date que si quelqu'un ouvre une page. À faire : une route `/api/cron` protégée par un jeton (ou une boucle lancée par `instrumentation.ts`) qui exécute `promoteDue` et le rapprochement des fichiers. Ensuite, `promoteDue` sort du chemin de chaque requête.
Trois réserves :
- La mise en vigueur automatique est une proposition non confirmée (O-09), même si elle est appliquée.
- Les relances supposent de savoir qui alerter et quand (M19, ouvert dans l'audit) et par quel canal (Teams ou Outlook, non discuté, §6.6 q2).
- Les envois vers Vigie et Keystone n'ont pas encore de table d'envoi : ils viendront avec les branchements réels (T-01).

<details><summary>Constat dans le code</summary>

Vérifié : `promoteDue` n'est appelé que dans `getCtx` (src/lib/context.ts:50 ; src/lib/lifecycle.ts:70-87). Les routes src/app/api/integrations/vigie/route.ts, src/app/api/import/route.ts et src/app/api/registry/route.ts n'importent pas `getCtx`. Aucun `setInterval`, cron ni `instrumentation.ts` dans src/. Correction : `promoteDue` fait une jointure en lecture à chaque requête ; il n'ouvre de transaction d'écriture que s'il y a une révision à mettre en vigueur. Aucune table d'envoi vers Vigie ou Keystone n'existe : `submitChange` écrit seulement le miroir local (src/lib/vigie.ts:29-30), et les tables du schéma ne comprennent aucune file d'attente (src/db/schema.ts). Les relances n'existent pas : audit M19, « Ni notification ni escalade ».

</details>

#### 39. Index de base de données manquants

- **Effort** : faible

Ajouter dans src/db/schema.ts les index listés, plus un GIN `jsonb_path_ops` sur `documents.aliases`, puis régénérer la migration. Réécrire la résolution d'alias de `getDoc` en `aliases @> [id]`, comme `findByRef`. Le gain restera faible tant que les écrans chargent les tables entières (points « Recherche… en SQL » et « Chaque navigation… ») : ces index servent les requêtes ciblées qui les remplaceront.

<details><summary>Constat dans le code</summary>

Vérifié : la migration ne crée que 5 index uniques (drizzle/0000_init.sql:295-299). Les clés primaires composites couvrent `document_readers(doc_id, user_id)` et `workflow_steps(workflow_id, idx)` (src/db/schema.ts), et `revisions_doc_letter` et `working_versions_rev_n` couvrent `revisions(doc_id)` et `working_versions(revision_id)`. Aucun index sur `audit_log(doc_id, at)` ni `audit_log(at, id)` (tri du journal et curseur de l'export), `working_versions(doc_id)`, `working_versions(file_key)` (cherché par `nameStoredFile`, src/lib/storage.ts:221), `workflows(doc_id)`, `workflow_steps(assignee_id)`, `workflow_comments(workflow_id)`, `project_expected(doc_id)`, ni d'index GIN sur `documents.aliases` (jsonb, schema.ts:124). Pour résoudre un ancien ID, `getDoc` charge toute la table (src/lib/queries.ts:78-80) ; `findByRef` fait `aliases @>` sans index (src/lib/importer.ts:283).

</details>

#### 40. Compteurs d'identifiants (max+1) non sûrs en concurrence
- **Fait le 10 octobre 2026** : les ID de document par couple (type, contexte), les circuits `W-n` et les références `ECR-AAAA-NNN` par année viennent d'une table `id_counters` incrémentée par une seule instruction `INSERT … ON CONFLICT (scope) DO UPDATE … RETURNING` dans la transaction appelante (`src/lib/codification.ts`), qui part à sa première utilisation du plus grand numéro existant (anciennes références comprises, si bien qu'un numéro gardé en alias n'est jamais réattribué), tandis que l'import passe un par un (verrou consultatif `pg_advisory_xact_lock`) et réserve le numéro de sa `legacyRef` au format `TYPE-CONTEXTE-SEQ` avant de vérifier qu'il est libre, sans changer les formats, les largeurs ni l'attribution dès le brouillon ; vérifié sur un Postgres 16 en READ COMMITTED (créations simultanées sans doublon ni trou, imports simultanés de la même référence réduits à un document et un 409, imports aux portées croisées sans interblocage).

- **Effort** : faible · **Références** : G21, T-01

Le risque n'existe qu'avec un Postgres serveur, en READ COMMITTED : deux créations simultanées obtiendraient le même ID et échoueraient sur la clé primaire, avec une erreur pour l'utilisateur. À faire avec le passage à Postgres : une table `id_counters(type, contexte, last)` mise à jour par `UPDATE … RETURNING` (ou `SELECT … FOR UPDATE`), sans réutiliser les ID gardés en alias ; une séquence pour `W-n` ; une nouvelle tentative en cas de conflit de clé. Le compteur `ECR-…` disparaîtra quand Vigie attribuera lui-même les références (vigie.ts:29, T-01).

<details><summary>Constat dans le code</summary>

Vérifié :
- `nextDocId` relit à chaque création tous les documents et leurs alias, puis prend max+1 (src/lib/codification.ts:10-16). L'import passe aussi par lui (src/lib/importer.ts:301).
- Les numéros `W-n` se calculent par max+1 sur toute la table `workflows` (src/lib/actions.ts:434-435), et `ECR-AAAA-NNN` de même (src/lib/vigie.ts:26-28).
- Aujourd'hui, l'unique connexion PGlite sérialise les transactions : pas de bug actuel.

</details>

#### 41. Passer aux migrations incrémentales avant la première base de production

- **Effort** : faible

Point confirmé, à faire au moment de la première base qui contient des données réelles : figer `0000_init`, ne plus produire que des migrations incrémentales (`drizzle-kit generate`), les relire, et prévoir un retour arrière. La vérification `drizzle-kit check` suppose de créer d'abord une CI, qui n'existe pas encore. Mettre à jour CLAUDE.md et docs/avancement-v2.md en conséquence.

<details><summary>Constat dans le code</summary>

Vérifié : la règle de CLAUDE.md (« rm -rf drizzle && npx drizzle-kit generate --name init », valable « tant qu'il n'y a pas de base de production ») est toujours appliquée ; il n'existe qu'une migration, drizzle/0000_init.sql, régénérée le 8 octobre (docs/avancement-v2.md:5-6). `migrate()` tourne au premier appel (src/db/index.ts:20). Le dépôt n'a pas de CI (pas de .github).

</details>

#### 42. Le build dépend de Google Fonts

- **Effort** : faible

À faire : ajouter Inter en woff2 (sous-ensemble latin, licence OFL) dans le dépôt, passer à `next/font/local` et garder la variable `--font-inter` pour ne rien changer au CSS Nocturne.

<details><summary>Constat dans le code</summary>

Vérifié : `import { Inter } from 'next/font/google'` (src/app/layout.tsx:2) et `Inter({ subsets: ['latin'], … })` (layout.tsx:14) ; aucune police dans le dépôt (pas de .woff2, pas de dossier public). L'app Mac lance elle aussi `next build` (desktop/build-app.sh:62), donc elle a besoin du réseau à la construction. CLAUDE.md signale déjà l'échec possible du build hors ligne.

</details>

#### 43. Version de Node non déclarée

- **Fait en partie le 10 octobre 2026** : package.json déclare `"engines": { "node": "^20.19.0 || >=22.12.0" }` et non `>=20.9`, car Vitest 4 s'appuie sur Vite 7, qui demande Node 20.19+ ou 22.12+ (Next seul accepterait 20.9) ; la CI tourne sous Node 22. Restent `.nvmrc`, l'alignement de `@types/node` (^20) et la vérification de version dans desktop/build-app.sh.
- **Effort** : faible

À faire : déclarer `"engines": { "node": ">=20.9" }`, choisir une version de référence (LTS) dans `.nvmrc`, aligner `@types/node` sur cette version et faire vérifier la version minimale par desktop/build-app.sh.

<details><summary>Constat dans le code</summary>

Vérifié : package.json n'a pas de champ `engines`, et le dépôt n'a ni .nvmrc ni .node-version (git ls-files). `@types/node` est en ^20 (package.json:24). Next exige `node >=20.9.0` (node_modules/next/package.json, champ engines). Le conteneur cloud a Node 22.22, la session locale Node 26. L'app Mac prend le premier `node` trouvé, sans en vérifier la version (desktop/build-app.sh:10-12).

</details>

#### 44. Erreurs : pas de global-error.tsx, messages non traçables

- **Effort** : faible

Il reste à faire :
(1) Ajouter src/app/global-error.tsx. C'est un composant client avec ses propres <html> et <body> : il ne reçoit ni nocturne.css ni la police. Il doit afficher un message bilingue, error.digest comme référence, et un bouton qui appelle retry().
(2) Ajouter src/app/not-found.tsx, en français et en anglais, dans le shell. Aujourd'hui, une URL inconnue affiche la page 404 par défaut de Next, en anglais. Un document introuvable affiche un message dans la page mais renvoie HTTP 200 (src/app/documents/[id]/page.tsx:64-71) : il faudrait appeler notFound().
(3) Dans useSubmit, ActionButton, CommentBox et DueTable, lire err.digest dans le catch et l'afficher (« Réf. xxx »). Next journalise déjà ce digest côté serveur : l'utilisateur pourrait alors le transmettre pour retrouver l'erreur.
(4) Point secondaire : src/app/error.tsx:6 utilise reset. Depuis Next 16.3, il faut retry, qui recharge les données serveur. Avec reset, « Réessayer » après une erreur de rendu serveur réaffiche la même erreur.

<details><summary>Constat dans le code</summary>

Constaté dans le code. Seul src/app/error.tsx existe : il n'y a ni global-error.tsx ni not-found.tsx dans src/app (vérifié par find). La doc Next 16.4 dit que error.js « ne couvre pas le layout.js au-dessus de lui » et qu'il faut global-error.js pour les erreurs du layout racine (node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md:96). Or src/app/layout.tsx:22-24 appelle getCtx(), qui appelle getDb() (src/lib/context.ts:46-48), puis listWorkflows, listDocs et listAudit. getDb() relance l'erreur si PGlite ou la migration échoue (src/db/index.ts:29-34). Côté client, le catch {} vide de src/components/dialogs/Modal.tsx:80-81 et de src/components/ui/client.tsx:65-66 remplace l'erreur par t.error (« Une erreur est survenue ») et jette error.digest. Même chose dans src/app/validations/CommentBox.tsx:19 et src/app/archivage/DueTable.tsx:31. Aucune décision de docs/decisions.md ne couvre ce point.

</details>

#### 45. Séparer l'amorçage du référentiel et les données de démonstration

- **Effort** : faible · **Références** : D-02, D-19

À faire : une variable CODEX_SEED=reference|demo|none, à documenter dans .env.example, avec demo par défaut en développement seulement.
- Le mode reference ne charge que le registre, les fonctions et la matrice des droits.
- Il faut changer la condition de déclenchement. Avec le test actuel (count(users) = 0), une base « reference » sans personne serait réamorcée à chaque démarrage. Il faut tester doc_types ou poser un marqueur.
- Il faut prévoir au moins un administrateur initial : getCtx plante s'il n'existe aucun utilisateur non système (src/lib/context.ts:66).
Départements, sites et personnes viendront de l'organigramme (O-04) et de l'authentification (O-02).

<details><summary>Constat dans le code</summary>

src/db/index.ts:21-22 lance seed() dès que la table users est vide. seed() (src/db/seed.ts:86-228) insère dans une même transaction le référentiel (familles, 69 types, fonctions, matrice des droits) et la démonstration : personnes, titulaires, projets, programmes, recherches enregistrées, documents, circuits, demandes Vigie, pièces attendues et journal. Aucune variable ne règle ce comportement : .env.example ne contient que NEXT_PUBLIC_KEYSTONE_URL en clair, et aucun CODEX_SEED ni test sur NODE_ENV n'existe dans src.

</details>

#### 46. Servir les fichiers en flux, avec les requêtes partielles (Range)

- **Effort** : moyen

Le constat est juste, mais la cause du rechargement à chaque page est surtout l'iframe recréée (`key={page}`, DocClient.tsx:30), combinée au `no-store` (route.ts:81). Range seul ne la corrige pas. À faire :
1. Servir le fichier en `ReadableStream` : `createReadStream` en local ; pour SharePoint, relayer le corps de `/content` et transmettre l'en-tête Range à Graph.
2. Gérer Range, avec 206, Content-Range et Accept-Ranges.
3. Rendre le fichier d'une version cacheable en privé (ETag sur l'id de version : une version de travail ne change jamais), ou changer de page sans recréer l'iframe.
4. Côté dépôt, le flux est plus délicat : `countPdfPages` (storage.ts:171-190) a besoin du fichier entier. Il faut écrire sur disque en flux, puis compter les pages à partir du fichier.

<details><summary>Constat dans le code</summary>

Vérifié : src/app/api/documents/[id]/file/route.ts:91-116 lit tout le fichier dans un Buffer puis le recopie (`new Uint8Array(body)`, l.116) ; aucun en-tête Accept-Ranges ni Content-Range (headers(), l.75-84) ; `Cache-Control: private, no-store` (l.81). Le stockage local fait `readFile` (src/lib/storage.ts:54), SharePoint fait `arrayBuffer` (storage.ts:116). La visionneuse paginée remonte l'iframe à chaque page : `<iframe key={page} ...#page=N>` (src/app/documents/[id]/DocClient.tsx:30). Comme la réponse est en no-store, tout le PDF est donc retéléchargé à chaque changement de page. En dépôt, tout est aussi chargé en mémoire : `stageUpload` (storage.ts:204), l'import (src/app/api/import/route.ts:28 et 44) et la limite des Server Actions à 50 Mo (next.config.ts:7).

</details>

#### 47. Chaque navigation recharge toutes les tables

- **Effort** : moyen

Le titre exagère : ce n'est pas « chaque navigation », mais chaque chargement complet et chaque mutation, plus `listDocs` dans chaque page. À faire :
- envelopper `listDocs` et `listWorkflows` dans `cache()` (avec des arguments stables, car `opts` est un nouvel objet à chaque appel) ;
- dans le layout, ne charger que ce qu'il affiche : validations qui m'attendent, cinq dernières activités visibles, modèles utilisables, avec des requêtes ciblées ;
- calculer le compteur hebdomadaire par un agrégat SQL sur `audit_log` (action `in_force`, date de moins de 7 jours) et non sur les 500 dernières lignes.

<details><summary>Constat dans le code</summary>

Vérifié :
- Le layout racine appelle `listWorkflows`, `listTemplates`, `listDocs`, `listAudit` et `getMatrix` (src/app/layout.tsx:24). `listTemplates` rappelle `listDocs` (src/lib/queries.ts:290), donc `listDocs` tourne deux fois dans le layout et une troisième fois dans la page.
- L'accueil rappelle `listDocs`, `listWorkflows` et `listAudit(500)` (src/app/page.tsx:19). Le compteur « mis en vigueur cette semaine » ne lit que ces 500 lignes (page.tsx:26-29).
- `listWorkflows` charge tous les circuits, étapes, commentaires, documents et révisions (queries.ts:127-135).
- Corrections : `getAccessIndex` est déjà mis en cache par requête (`cache()`, src/lib/access.ts:53), donc `buildAccessIndex` ne tourne qu'une fois par requête, mais il charge toujours les tables entières (access.ts:21-30). Le layout racine n'est pas réexécuté à chaque navigation côté client (rendu partiel, node_modules/next/dist/docs/01-app/02-guides/authentication.md:1358). Il l'est en revanche à chaque chargement complet et après chaque mutation : `refresh()` de next/cache est appelé 21 fois dans src/lib/actions.ts.

</details>

#### 48. Sauvegarde et restauration de la base et des fichiers

- **Effort** : moyen · **Références** : G02, M22

À faire :
1. Un script de sauvegarde cohérent : dump de la base (`dumpDataDir` de PGlite, serveur arrêté ou mis en pause ; `pg_dump` une fois sur Postgres), plus copie de `files/` au même instant (ou versionnage du stockage objet).
2. Rotation et chiffrement de la sauvegarde.
3. Une procédure de restauration testée.
Le script peut s'écrire dès maintenant. La perte de données tolérée, le délai de reprise et le lieu d'hébergement sont à fixer par l'utilisateur (M22, hors liste O-01..O-11).

<details><summary>Constat dans le code</summary>

Vérifié :
- La base est dans `DATA_DIR/pglite` et les fichiers dans `DATA_DIR/files` (src/db/index.ts:13-14 et 18).
- package.json n'a aucun script de sauvegarde ; `db:reset` vaut `rm -rf .data` et supprime aussi les fichiers (package.json:12).
- Le dépôt ne contient ni script ni procédure de sauvegarde (git ls-files).
- Les objectifs de reprise sont toujours ouverts dans l'audit (M22, « Ouvert »).

</details>

#### 49. Journalisation technique et supervision

- **Effort** : moyen

Ce qui peut se faire maintenant :
(1) Écrire un petit module de journal (src/lib/log.ts) qui écrit en JSON sur stdout avec un niveau, un horodatage, un identifiant de requête (x-request-id ou crypto.randomUUID) et, s'il y en a un, le digest. Remplacer les cinq console.error par ce module.
(2) Journaliser en warn les refus 401 et 503 de checkBearer, avec la route et l'IP, sans le jeton.
(3) Ajouter src/instrumentation.ts avec onRequestError, pour enregistrer toutes les erreurs serveur : rendu, Server Actions et routes.
(4) Ajouter GET /api/health, qui exécute un select 1 via getDb() et vérifie l'accès en écriture à FILES_DIR, ou à SharePoint quand ce stockage est actif. Elle répond 200 ou 503 et ne divulgue aucune donnée.

Les métriques et les alertes dépendent de la plateforme d'hébergement. Qui héberge et exploite Codex n'a pas été tranché (question 3 de l'audit, docs/audit-deck-epc2i.md:1217-1218). Ce n'est pas une des questions O-01 à O-11, donc ce point n'est pas classé comme bloqué par une décision.

<details><summary>Constat dans le code</summary>

Constaté dans le code. Il n'y a que cinq console.error côté serveur, tous non structurés et sans identifiant de requête : src/lib/storage.ts:225 et 253, src/app/api/documents/[id]/file/route.ts:97, src/app/api/import/route.ts:72 et src/app/api/integrations/vigie/route.ts:73. Le sixième, src/app/error.tsx:7, est côté client. checkBearer renvoie 401 ou 503 sans rien journaliser (src/lib/importer.ts:33-41). Il n'existe pas de route de santé (src/app/api ne contient que documents, export, import, integrations et registry). Il n'y a pas non plus de src/instrumentation.ts : le hook onRequestError, documenté dans node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation.md:36-46, n'est donc pas utilisé. Les erreurs des Server Actions de src/lib/actions.ts remontent au client sans être enregistrées par Codex : seul withStaged, aux lignes 135-141, intercepte une erreur, et c'est pour supprimer le fichier puis la relancer. Rien de cela n'est dans « Reste à faire » de docs/avancement-v2.md:40-50, et aucune décision ne l'écarte.

</details>

#### 50. Recherche, facettes et listes : filtrer et paginer en SQL plutôt qu'en mémoire

- **Effort** : important · **Références** : G15, M18, FON-04, ARC-01

Point confirmé. Correction : le journal est tronqué à 500 lignes à l'écran, mais son export CSV complet existe déjà, en flux avec un curseur (src/app/api/export/audit/route.ts:14-41). Il manque seulement un filtre et une pagination à l'écran.
À faire :
- traduire les règles de `canRead` (src/lib/access.ts) en conditions SQL, avec jointures sur `document_readers`, les révisions ouvertes, les étapes de circuit et les titulaires de fonction ;
- compter les facettes par `GROUP BY` ;
- créer un index plein texte (tsvector ou pg_trgm, avec unaccent) sur le titre, l'ID, les alias et les mots-clés ;
- paginer par curseur la recherche, l'explorateur, les validations et le journal.
Le contenu des fichiers n'est toujours pas indexé (G15). Le volume réel reste inconnu (M18, O-11), mais rien n'empêche de commencer. Ce chantier va de pair avec le passage à Postgres serveur.

<details><summary>Constat dans le code</summary>

Vérifié :
- `listDocs` charge toute la table `documents` puis applique `canRead` en JavaScript (src/lib/queries.ts:67-71).
- `runSearch` filtre en mémoire, et `count` reparcourt tous les documents pour chaque option de facette (src/lib/search.ts:54-57).
- Mêmes calculs en mémoire dans la recherche (src/app/recherche/page.tsx:15-16), l'export CSV de la recherche (src/app/api/export/search/route.ts:12) et l'explorateur (src/app/explorateur/page.tsx:69-71).
- Les validations n'ont pas de pagination (src/app/validations/page.tsx:30-31).
- Le journal d'administration est limité à 500 lignes, sans filtre (src/app/administration/page.tsx:300).

</details>

#### 51. Base Postgres serveur à la place de PGlite embarqué

- **Effort** : important · **Références** : D-02, G02, ARC-01, M22, O-03

Point confirmé. À faire :
- choisir le pilote selon `DATABASE_URL` : node-postgres avec un pool, et PGlite pour le développement, la démo et l'app Mac ;
- ne plus lancer de remplissage de démo en production ;
- lancer les migrations au déploiement et non au premier appel ;
- revoir le niveau d'isolation des transactions qui relisent avant d'écrire (les compteurs d'ID sont faits, point 40) ;
- déclarer `DATABASE_URL` dans .env.example.
La cible dépend de l'hébergement (audit §6.6 q3, M22). Une base partagée avec Keystone, si O-03 la retient, imposerait aussi ce passage. L'abstraction du pilote peut se faire dès maintenant.

<details><summary>Constat dans le code</summary>

Vérifié :
- Le seul pilote est `drizzle-orm/pglite`, avec une base dans `DATA_DIR/pglite` (src/db/index.ts:4-6 et 18). Une instance par processus est gardée sur `globalThis` (index.ts:26-35) ; les migrations et le remplissage de démo tournent au premier `getDb()` (index.ts:20-22).
- `@electric-sql/pglite` est la seule dépendance de base (package.json:16), et .env.example ne déclare pas `DATABASE_URL`.
- Le code suppose un verrou unique : storage.ts:14 (« PGlite holds one lock for the whole database »).
- D-02 a retenu PGlite pour la première version (« App locale persistée »), sans exclure un Postgres serveur pour la production.

</details>

### Qualité, tests et documentation (6)

#### 52. Intégration continue

- **Fait en partie le 10 octobre 2026** : `.github/workflows/ci.yml` (GitHub Actions, Node 22) lance `npm ci`, `npm run typecheck`, `npm run lint`, `npm test` et `npm run build` à chaque push et pull request, sur toutes les branches. Restent `drizzle-kit check` et `npm audit` (`npm ci` signale 9 vulnérabilités le 10 octobre : 4 modérées, 5 élevées).
- **Effort** : faible

Il faut un workflow GitHub Actions sur les pull requests vers main : npm ci, `next typegen` puis tsc (voir le point suivant), eslint, tests (dès que le point « Tests automatisés » existe), next build, `drizzle-kit check`, npm audit.

Une correction : se passer de Google Fonts n'est pas un prérequis. src/app/layout.tsx:2 et :14 charge Inter par next/font/google, et les runners hébergés par GitHub ont accès au réseau. Le problème ne touche que les sessions cloud sans réseau. Passer à next/font/local reste une option pour un build hors ligne.

Point pratique : pousser un fichier `.github/workflows/*` peut demander le droit « workflow » sur le jeton GitHub de la session. Le dépôt est privé, donc les minutes Actions sont décomptées du quota du compte.

<details><summary>Constat dans le code</summary>

Aucun dossier `.github/`, ni dans l'arbre de travail ni dans origin/main (`git ls-tree -r origin/main` ne contient aucun workflow). Les contrôles se lancent à la main (README.md:23, CLAUDE.md:72). drizzle.config.ts existe (schéma src/db/schema.ts, sortie ./drizzle), donc `drizzle-kit check` peut tourner.

</details>

#### 53. Docs en retard sur le code

- **Effort** : faible · **Références** : T-03, O-02

Ce ne sont que des corrections de documentation, sans développement :
(1) Dans l'audit, G04 (ligne 627) : remplacer la réserve par « corrigé le 9 octobre (renameDocFiles, 44bd1b8) ».
(2) docs/avancement-v2.md : changer la date, passer les trois corrections T-03 dans « Fait » et ne laisser dans « Reste à faire » que la conservation par révision remplacée (O-09). Ajouter à la ligne 3 la mention typegen, ou la retirer une fois le script corrigé.
(3) docs/decisions.md:451-454 et :541-543 : ne citer que docs/modele-cible.md (§1, ligne 22 : « proposé, non confirmé »). Dans l'audit M16 (ligne 1596), remplacer la citation disparue par la formule actuelle. Ne pas trancher O-02.
(4) docs/historique.md:308-309 : le texte dit déjà « sans objet après une remise à zéro de la base ». Il ne reste qu'à changer l'étiquette « Partiel » en « Corrigé (sans objet sur base neuve) ». C'est cosmétique.

<details><summary>Constat dans le code</summary>

(1) docs/audit-deck-epc2i.md:627 contient encore « Réserve : après un reclassement, les fichiers déjà stockés gardent leur ancien nom… (T-03) ». Or renameDocFiles existe (src/lib/storage.ts:233) et updateMeta l'appelle (src/lib/actions.ts:319).
(2) docs/avancement-v2.md:1 est daté du « 8 octobre 2026 » et range T-03 dans « Reste à faire » (lignes 43-45).
(3) Depuis 9986f2d, docs/api.md, docs/avancement-v2.md et src/app/api/registry/route.ts ne mentionnent plus Entra ID (dans d05d498, ils le faisaient : registry/route.ts:7, avancement-v2.md:43). docs/modele-cible.md:7 et :22 le présentent comme « proposé, non confirmé ». Pourtant docs/decisions.md:451-454 et :541-543 disent encore que ces fichiers le présentent comme la cible. L'audit M16 (docs/audit-deck-epc2i.md:1596) cite « simulée jusqu'au branchement Entra ID », une formule qui n'existait que dans d05d498:docs/modele-cible.md:17.
(4) docs/historique.md:308-309 marque le constat 33 « Partiel ». Or les pages sont comptées au dépôt (storage.ts:200, countPdfPages), et si le nombre est inconnu, le lecteur natif prend le relais (src/app/documents/[id]/DocClient.tsx:24).

</details>

#### 54. Incohérences entre documentation et code, non relevées ailleurs

- **Effort** : faible

Ce sont uniquement des corrections de documentation :
1. nuancer README.md:71, par exemple « les actions sur les documents alimentent le journal ; administration, commentaires et exports ne sont pas encore journalisés », tant que ces points ne sont pas faits ;
2. préciser dans docs/decisions.md (détail de T-03) que le rangement par dossier ne vaut que pour SharePoint, et que le stockage local garde un préfixe unique ;
3. remplacer « plein texte » par « recherche sur les métadonnées (titre, ID, anciennes références, mots-clés, type, sous-type, organisme source, référence externe) » dans README.md:54 ; corriger aussi le commentaire « Full-text match » de search.ts:36.

<details><summary>Constat dans le code</summary>

Constaté.
1. README.md:71 affirme « Chaque action alimente le journal d'audit ». Or togglePermission, addOrgValue, addFunctionHolder, removeFunctionHolder et updateType (src/lib/actions.ts:694-780), addComment (actions.ts:542-555) et les deux exports (src/app/api/export/*) n'appellent pas audit().
2. docs/decisions.md:595-597 parle d'un fichier rangé « dans le dossier du nouvel ID ». Le stockage local écrit `{uuid}-{ID}_{label}` à plat et ignore `folder` (src/lib/storage.ts:42-50) ; seul SharePoint crée un dossier (storage.ts, rename). docs/modele-cible.md:51 ne parle pas de dossier, mais omet le préfixe uuid du stockage local.
3. README.md:54 annonce une « Recherche plein texte ». matches() ne porte que sur des métadonnées (src/lib/search.ts:36-41).

</details>

#### 55. Accessibilité : audit systématique

- **Effort** : moyen

(1) Ajouter un lien « Aller au contenu » en tête de body, visible au focus, et donner un id au <main> de layout.tsx:72. (2) Mettre en place une première infrastructure de test, par exemple Playwright avec @axe-core/playwright, sur les 7 écrans et les dialogues principaux. C'est la plus grosse part de l'effort, puisqu'il n'existe aucun test aujourd'hui. (3) Mesurer le contraste de text-muted et des textes de 11 px sur les fonds Nocturne, puis ne corriger que ce qui échoue, sans s'écarter de la maquette (ni thème clair ni changement de tailles sans mesure). Le deck et docs/decisions.md ne posent aucune exigence RGAA. C'est une démarche de qualité, pas une exigence.

<details><summary>Constat dans le code</summary>

Une partie du manque est confirmée, mais deux constats doivent être corrigés. Confirmé : il n'y a pas de lien d'évitement. src/app/layout.tsx:57-72 enchaîne la Sidebar, le Header puis <main className="app-main">, et ce <main> n'a pas d'id. grep « skip / évitement » ne trouve rien. Le dépôt n'a aucune infrastructure de test : package.json ne déclare pas de script test, ni axe, ni Playwright, ni Vitest. docs/avancement-v2.md:38 ne traite que les dialogues et les listes. À corriger : le thème sombre seul (src/app/globals.css:5) vient du design system Nocturne, qui est sombre, et la maquette n'a pas de thème clair, donc ce n'est pas un écart. De même, les 59 fontSize inline de 10 à 11 px dans src/**/*.tsx reprennent la maquette (44 font-size de 10 à 11,5 px dans design/GED Groupe.dc.html). On ne peut parler de défaut qu'après une mesure de contraste.

</details>

#### 56. Pas de jeu de données volumineux ni de mesure des performances

- **Effort** : moyen · **Références** : M18, O-11

À faire dès maintenant :
- un générateur de données synthétiques (script npm séparé, base distincte de .data) : des dizaines de milliers de documents, avec révisions, versions de travail, circuits, commentaires et lignes de journal, répartis entre rôles, départements et niveaux de confidentialité ;
- un script qui mesure le temps de rendu des écrans principaux et des routes (/, /recherche, /explorateur, fiche document, /validations, exports CSV) ;
- relancer ces mesures avant et après le passage des recherches et filtres en SQL, et avant et après la base Postgres serveur.
Les volumes cibles viendront de M18 et O-11, mais le banc de mesure peut se construire sans eux.

<details><summary>Constat dans le code</summary>

Constaté. src/db/seed-docs.ts contient 63 entrées `title:`. package.json n'a aucun script de test, de génération ni de mesure (scripts : dev, build, start, lint, typecheck, db:generate, db:reset, app), et il n'existe aucun dossier tests ni scripts. Chaque page charge tout dans le layout (src/app/layout.tsx:24) : listWorkflows (tous les circuits, étapes et commentaires, queries.ts:127-135), listDocs (tous les documents, queries.ts:67-71), et listTemplates, qui rappelle listDocs (queries.ts:288-291). buildAccessIndex lit des tables entières (src/lib/access.ts:21-29). matches et runSearch filtrent en mémoire (search.ts:55-58).

</details>

#### 57. Tests automatisés

- **Fait en partie le 10 octobre 2026** : Vitest (`npm test`) lance des tests unitaires des règles pures (`tests/unit/`) et des tests d'intégration des règles métier et des Server Actions sur un PGlite en mémoire (`tests/integration/`, base ouverte par `openDb` dans `src/db/index.ts`, `next/headers` et `next/cache` simulés), dont le handler du webhook `/api/integrations/vigie`. Le 11 octobre, `tests/integration/files.test.ts` appelle les handlers `POST /api/import` et `GET`/`HEAD /api/documents/[id]/file` : type de fichier enregistré, `Content-Type` et `Content-Disposition` servis, nom proposé, aperçu correspondant. Restent : les autres réponses de ces deux routes par leurs handlers (401, 400, 413, 415 et 409 de l'import, dont seuls les cas 409 sont testés, par `importDocument` ; 404 de la route fichier pour un document ou une version non visibles, la règle étant testée par `readerMaySeeVersion` ; 502 du stockage ; ligne de journal d'un téléchargement), les parcours Playwright, et l'atomicité des compteurs entre connexions (PGlite n'a qu'une connexion : il faut un Postgres serveur).
- **Effort** : important

Le manque est réel. Il faut une base de tests, sans changer le périmètre :
- Tests unitaires purs. codes.ts, format.ts, retention.ts et search.ts n'importent pas 'server-only' et se testent directement. access.ts importe 'server-only' (comme lifecycle, queries, storage, vigie, codification et src/db/index.ts) : il faut un alias vers un module vide dans la config Vitest.
- Tests d'intégration. promoteDue et applyChangeDecision reçoivent la base ou la transaction en paramètre, on peut donc les lancer sur un PGlite avec la migration drizzle/0000_init.sql et seed(db). src/db/index.ts:13-18 crée toujours un PGlite sur fichier (CODEX_DATA_DIR) : soit un dossier temporaire par test, soit une petite refonte pour accepter 'memory://'. Les Server Actions (actions.ts:4-5) dépendent de next/headers (cookies) et de next/cache (refresh), qu'il faut simuler.
- Tests des routes /api/import, /api/integrations/vigie et /api/documents/[id]/file, en appelant directement les handlers.
- Parcours de bout en bout Playwright par rôle simulé (cookie), dont le circuit de validation complet.

<details><summary>Constat dans le code</summary>

package.json:5-13 : aucun script `test`, aucune dépendance Vitest, Jest ou Playwright. Une recherche de `*.test.*`, `*.spec.*`, `vitest.config*`, `jest.config*` et `playwright.config*` hors node_modules ne trouve rien. docs/avancement-v2.md:31-33 : la vérification a été faite à la main dans le navigateur. Les fonctions visées existent : canRead (access.ts:68), inDraftingCircle (access.ts:54), promoteDue(db) (lifecycle.ts:70), applyChangeDecision(tx, …) (lifecycle.ts:132), ainsi que les routes src/app/api/import, src/app/api/integrations/vigie et src/app/api/documents/[id]/file.

</details>

### Référentiels et données (5)

#### 58. Programmes de recherche : aucun écran pour les créer

- **Effort** : faible · **Références** : D-10, D-08

À faire :
- un écran Administration › Programmes avec code, nom, responsable (un utilisateur non système) et date de fin, et des actions de création et de modification protégées par adminOnly et journalisées ;
- la désactivation d'un programme clos plutôt que sa suppression, puisque le code entre dans les ID (PRT-R2601-004).
La date de fin servirait aussi au déclencheur de conservation « fin de programme », aujourd'hui non calculable pour les 12 types recherche (point 3 de docs/registre-points-ouverts.md). Si les programmes doivent finalement venir de Keystone, l'écran serait remplacé par une synchronisation (O-03), mais rien ne l'indique aujourd'hui.

<details><summary>Constat dans le code</summary>

research_programs n'est rempli que par src/db/seed.ts:104 (PROGRAMS, src/db/seed-org.ts:111-114). Il est seulement lu ensuite (src/lib/context.ts:60 ; src/lib/importer.ts:86). Aucun onglet de src/app/administration/page.tsx:15 ne le gère. La création refuse un programme inconnu (validateFields, src/lib/actions.ts:123), l'import aussi (importer.ts:222). La table n'a ni date de fin ni statut (src/db/schema.ts:112-116).

</details>

#### 59. Vocabulaires contrôlés : mots-clés, organisme source, sous-type, langue

- **Effort** : moyen · **Références** : MET-07, MET-17, G32, G40, G03, A21, A05

Sans dépendance, à faire tout de suite :
- contrôler la langue côté serveur (fr, en ou vide) dans validateFields et dans l'import ;
- créer un référentiel administré des organismes sources, avec autocomplétion, normalisation (casse, accents, « Siemens » / « SIEMENS SAS ») et reprise des valeurs existantes et importées ;
- créer une table de mots-clés, avec saisie par sélection et ajout contrôlé. La facette « Mots-clés » de la recherche existe depuis le 11 octobre 2026 (point 12 : `FACET_KEYS` et `facetValues`, src/lib/search.ts) ; elle lit les mots-clés des documents et n'est pas à refaire.
Pour les sous-types, il faut d'abord pouvoir les éditer dans l'administration (voir le point « Administration du registre »). Fermer la liste côté serveur contredirait MET-17 (« Exemples ») tant que la gouvernance des termes (A05) et le point 9 de O-05 (sous-types hors deck) ne sont pas tranchés. On s'en tient donc à une liste administrée avec ajout contrôlé. Les deux options de A21 (thésaurus fermé ou libre) restent compatibles avec une saisie par sélection et ajout contrôlé.

<details><summary>Constat dans le code</summary>

Chaque constat est vérifié dans le code :
- mots-clés : texte découpé sur les virgules (src/lib/actions.ts:97 ; src/components/dialogs/Dialogs.tsx:222-224 ; src/db/schema.ts:139) ;
- organisme source : texte libre (src/lib/actions.ts:100 ; Dialogs.tsx:249-251 ; schema.ts:155) ;
- sous-type : texte libre avec une simple datalist (Dialogs.tsx:209-211), lu par opt() sans contrôle (actions.ts:89) ; validateFields (actions.ts:117-130) ne le vérifie pas, l'import non plus (src/lib/importer.ts:202) ;
- langue : le formulaire ne propose que fr/en (Dialogs.tsx:225-226), mais le serveur accepte n'importe quelle chaîne (actions.ts:98 ; importer.ts:204, jusqu'à 10 caractères).
La recherche plein texte couvre bien ces champs (src/lib/search.ts:32), mais il n'existe ni référentiel ni facette dédiée.

</details>

#### 60. Appliquer les évolutions du registre à une base existante

- **Effort** : moyen · **Références** : O-05, O-07, D-07

Une modification de src/db/registry.ts (arbitrages O-05, durées O-07, « Public » O-08) n'atteint aucune base existante, y compris celle de l'app Mac (données séparées, port 3110), sauf à la réinitialiser et à perdre ses documents. À faire : un script idempotent (upsert des familles, types et fonctions par code), avec un rapport des écarts. Il doit savoir désactiver un type retiré plutôt que le supprimer (documents.type_code est une clé étrangère, src/db/schema.ts:131), et refuser ou signaler un renommage de code qui toucherait des documents existants. Variante : un import/export JSON du registre dans l'administration. Tant qu'il n'y a pas de base de production, le db:reset documenté suffit, d'où une priorité modérée.

<details><summary>Constat dans le code</summary>

Seul src/db/seed.ts:7 importe FAMILIES et TYPES (grep sur src). Le seed ne tourne que si la table users est vide (src/db/index.ts:21-22). Il n'y a ni dossier scripts ni script npm de mise à jour (package.json : seulement db:reset = rm -rf .data). Il n'y a qu'une migration, drizzle/0000_init.sql.

</details>

#### 61. Administration du registre : créer et modifier complètement types, familles et fonctions

- **Effort** : moyen · **Références** : G03, PAR-01, PAR-02, MET-17, A05

À faire :
- des actions createType, createFamily et createFunction (code de type unique de 3 lettres, refus d'un code déjà pris par un département, libellés FR/EN, famille, origines, rattachements, sous-types, circuit, conservation avec fondement, confidentialité, iso, livrable client), avec le contrôle adminOnly ;
- un dialogue de type complet et des boutons « Nouveau type » et « Nouvelle famille » ;
- l'édition des libellés et des sous-types d'un type existant ;
- avant de retirer une origine ou un rattachement admis, la liste des documents existants que validateFields (actions.ts:119-121) refuserait ensuite ;
- la journalisation des changements du registre, qui demande de rendre audit_log.doc_id nullable ou d'ajouter un journal d'administration (migration à régénérer).
Keystone voit le changement grâce à l'ETag de /api/registry (src/app/api/registry/route.ts:58-59). Qui peut créer, renommer ou retirer un terme (A05) reste à préciser, mais cela ne bloque pas le développement : par défaut, c'est le droit Administrer.

<details><summary>Constat dans le code</summary>

updateType (src/lib/actions.ts:758-780) se limite à un UPDATE du circuit, de confAllowed/confDefault, de la conservation (sans le fondement) et de active (l.777). Les insertions dans doc_types, families et functions n'existent que dans le seed (src/db/seed.ts:94-101). Aucune action ne les crée (grep sur insert(s.docTypes|families|functions) hors seed). L'onglet Registre n'a pas de bouton « Nouveau type » (src/app/administration/page.tsx:41-51). TypeEditor (src/components/dialogs/Dialogs.tsx:703-805) n'expose ni les libellés, ni les sous-types, ni iso, ni clientDeliverable, ni les origines et rattachements ; le fondement y est en lecture seule (l.792-795). Aucune action d'administration (l.688-780) n'appelle audit(), et audit_log.doc_id est NOT NULL (src/db/schema.ts:325).

</details>

#### 62. Administration de l'organisation : renommer ou retirer un département ou un site

- **Effort** : moyen · **Références** : G03, D-19

À faire :
- modifier les libellés FR/EN d'un département et le libellé d'un site ;
- retirer une valeur par désactivation (colonne active à ajouter, puis migration régénérée) : une valeur inactive disparaît des listes de saisie mais garde son libellé à l'affichage, et validateFields (actions.ts:125-126) refuse une valeur inactive sur un nouveau document ;
- fusionner deux départements : réaffecter documents, personnes et titulaires de fonction (scope_value) sans toucher aux ID figés. Le cas des brouillons jamais approuvés reste à trancher, car un reclassement leur donne un nouvel ID (D-10, proposition non confirmée, O-09) ;
- journaliser ces opérations (même contrainte audit_log.doc_id NOT NULL que pour le registre).
Le changement de code d'un département reste exclu.

<details><summary>Constat dans le code</summary>

addOrgValue (src/lib/actions.ts:711-730) ne fait qu'insérer et n'écrit rien au journal. L'onglet Organisation n'offre que deux boutons d'ajout (src/app/administration/page.tsx:52-57) ; ses tableaux sont en lecture seule (l.217-269). Les tables departments et sites n'ont pas de colonne active (src/db/schema.ts:21-32). departments.code est une clé étrangère de users.department (l.41) et de documents.department (l.133). function_holders.scope_value (l.94) le reprend en texte, sans clé étrangère. Le code entre dans l'ID des documents sans rattachement (D-10).

</details>

### Interface et maquette (7)

#### 63. Onglet Projet : remettre le stepper des phases de la maquette

- **Effort** : faible · **Références** : D-04, M15

Dans l'onglet Projet (page.tsx:249-257), remplacer ou compléter l'étiquette project.stage par un HStepper construit sur PROJECT_PHASES : les étapes avant l'index de project.stage sont « done », celle de project.stage est « current », les suivantes « todo ». Si l'étape reçue de Keystone n'est pas dans la liste, garder l'étiquette actuelle. Attention à la mise en page : la maquette n'a que 4 étapes, Codex en a 12, et le panneau latéral fait 400 px (src/app/documents/[id]/document.module.css:25). Il faut une version compacte : petit minWidth, libellé affiché seulement pour l'étape courante (les autres au survol), ou deux rangées de 6. La liste des phases suit Keystone tel qu'il est simulé (D-04). Le branchement réel (O-03) pourra la changer, mais ne bloque pas ce travail.

<details><summary>Constat dans le code</summary>

Le manque est confirmé. La maquette dessine le stepper aux lignes design/GED Groupe.dc.html:234-241 (sc-for affStages) et définit STAGES à la ligne 641. Codex n'affiche la phase qu'en étiquette : src/app/documents/[id]/page.tsx:254 (<span className="tag tag-outline">{project.stage}</span>), sans stepper dans l'onglet Projet. Les briques existent : HStepper dans src/components/ui/Stepper.tsx:22 (états done/current/todo, retour à la ligne) et PROJECT_PHASES dans src/lib/i18n.ts:203 (12 étapes). Les phases du seed, src/db/seed-org.ts:106-108 (« Chantier », « Etudes », « Mise Service & SAT »), figurent toutes dans cette liste.

</details>

#### 64. Limites de taille incohérentes et message d'erreur générique pour un gros fichier

- **Effort** : faible

(1) Dans FilePicker, comparer file.size à la limite de l'interface (constante partagée avec next.config.ts). Au-delà, afficher un message dédié qui donne la limite (nouvelle clé FR/EN dans i18n.ts) et désactiver l'envoi. (2) Afficher la limite sous le champ. (3) Ajouter un contrôle serveur lisible dans uploadedFile (src/lib/actions.ts:37) pour le cas limite (taille proche de 50 Mo avec les autres champs). (4) Documenter la limite de l'interface dans README.md. Il n'est pas nécessaire d'aligner les deux limites : elles servent deux canaux différents, l'interface et l'outil de migration hors Codex (D-21). Il suffit de documenter l'écart.

<details><summary>Constat dans le code</summary>

Le manque est confirmé. next.config.ts:7 fixe serverActions.bodySizeLimit à '50mb' pour tous les dépôts passant par l'interface. src/app/api/import/route.ts:8-13 accepte 100 Mo par défaut (CODEX_IMPORT_MAX_MB), 250 Mo au plus avec SharePoint. FilePicker (src/components/dialogs/Modal.tsx:122-133) affiche la taille mais ne la contrôle pas ; il sert aux lignes src/components/dialogs/Dialogs.tsx:377 et 448. Quand une Server Action dépasse la limite, elle lève une exception que useSubmit rattrape (Modal.tsx:80-81) avec seulement t.error, « Une erreur est survenue » (i18n.ts:35). La limite de 50 Mo n'est documentée nulle part : README et docs/api.md ne citent que CODEX_IMPORT_MAX_MB (docs/api.md:19 et 129).

</details>

#### 65. Onglet Révisions : bouton « Restaurer » de la maquette absent

- **Effort** : faible · **Références** : D-12, D-16

Ajouter une Server Action restoreWorkingVersion(docId, versionId) dans src/lib/actions.ts. Elle reprend les contrôles d'addWorkingVersion : droit upload, canRead, inDraftingCircle, lockOf, révision de travail au statut draft. Elle lit le fichier de la version choisie (readStored), le met en zone d'attente (stageFile), puis crée la version de travail suivante (lettre.n+1) avec un commentaire « Restaurée depuis A.2 » et une entrée au journal (action 'working' ou 'restore'). Côté interface, dans DocClient.tsx, ajouter un bouton btn-ghost « Restaurer » à côté de Comparer, actif seulement si une version non courante est sélectionnée et qu'un brouillon est ouvert. Revenir à une révision d'un document en vigueur reste hors de ce bouton : cela passe par une demande dans Vigie (D-16).

<details><summary>Constat dans le code</summary>

Le manque est confirmé. La maquette a deux boutons à la ligne design/GED Groupe.dc.html:309 : {{ t.compare }} et {{ t.restore }}. src/app/documents/[id]/DocClient.tsx:134-136 n'a que le bouton Comparer. La clé i18n restore (i18n.ts:18) ne sert qu'à l'archivage (src/app/archivage/page.tsx:120). Aucune action ne restaure une version : la seule restauration est restoreArchived (src/lib/actions.ts:668), qui concerne les archives. Les briques existent : readStored et stageFile (src/lib/storage.ts:195 et 258) servent déjà à createDocument pour copier le fichier d'un modèle (actions.ts:161-185), et addWorkingVersion (actions.ts:225-260) porte tous les contrôles (cercle de rédaction, verrou, brouillon ouvert).

</details>

#### 66. Modèles : compteur d'utilisations de la maquette

- **Effort** : faible · **Références** : G06

Ajouter une colonne nullable documents.template_id (référence à documents.id) dans src/db/schema.ts. Régénérer la migration unique (rm -rf drizzle && npx drizzle-kit generate --name init, puis npm run db:reset). Remplir la colonne dans createDocument quand le document part d'un modèle. Compter les utilisations dans listTemplates (count groupé par template_id) et afficher le compteur à deux endroits : la colonne Utilisations d'Administration › Modèles et le libellé du choix de modèle dans Dialogs.tsx. Les clés FR/EN uses et tpl_uses sont à ajouter. Si possible, rattacher quelques documents du seed à un modèle pour que le compteur ne soit pas toujours à 0.

<details><summary>Constat dans le code</summary>

Le manque est confirmé. La maquette a une colonne {{ t.uses }} dans Administration › Modèles (design/GED Groupe.dc.html:504-507) et affiche « {{ x.uses }} {{ t.tpl_uses }} » dans le choix du modèle (ligne 540). src/db/schema.ts ne contient aucune colonne liée aux modèles (grep « template » sans résultat). createDocument ne garde le modèle source que dans le commentaire de A.1 (src/lib/actions.ts:195) et dans le texte du journal (actions.ts:198). listTemplates (src/lib/queries.ts:288-292) ne compte rien. Le tableau Templates (src/app/administration/page.tsx:271-296) n'a pas de colonne Utilisations, et le choix du modèle (src/components/dialogs/Dialogs.tsx:371) affiche seulement « id · révision · propriétaire ».

</details>

#### 67. Petits écarts avec la maquette : rattachement à une affaire, dépôt depuis l'explorateur

- **Effort** : faible · **Références** : D-08, D-10

(a) Toujours afficher l'onglet Projet. Sans projet, il montre le message « Ce document n'est rattaché à aucune affaire » et, pour le propriétaire ou un gestionnaire, un bouton « Rattacher à un projet ». Ce bouton ouvre le dialogue de métadonnées avec le rattachement « projet » présélectionné, et l'onglet par défaut reste Fiche (page.tsx:89). Ajouter les clés FR/EN. Rappel : après la première approbation, l'identifiant ne change plus (D-10), donc un rattachement tardif garde l'ancien ID. (b) Ajouter dans l'explorateur, avant « Nouveau », un DialogButton spec={{ kind: 'new', preset: { mode: 'file' } }} avec l'icône upload, comme sur l'Accueil. Si possible, le préremplir avec le département ou le type sélectionné dans l'arbre.

<details><summary>Constat dans le code</summary>

Les deux écarts sont confirmés. (a) src/app/documents/[id]/page.tsx:87 (tabs.filter(k => k !== 'project' || project)) masque l'onglet quand le document n'a pas de projet. La maquette affiche alors {{ t.no_aff }} et le bouton {{ t.attach_aff }} (design/GED Groupe.dc.html:273-276), et i18n.ts n'a aucune clé équivalente. On peut déjà rattacher un document à un projet par « Modifier les métadonnées » : updateMeta le traite comme un reclassement (src/lib/actions.ts:292-313), réservé au propriétaire ou à un gestionnaire (actions.ts:285). (b) La barre de src/app/explorateur/page.tsx:162 n'a que DialogButton kind 'new', alors que la maquette y ajoute un bouton {{ t.upload }} (ligne 151). L'Accueil l'a déjà : src/app/page.tsx:46 (preset mode 'file').

</details>

#### 68. Interface bilingue incomplète : libellés en une seule langue, journal et titre de page

- **Effort** : moyen

À faire :
- des libellés FR/EN pour les sites (label_fr et label_en, comme les départements) et pour le fondement de conservation (retention_basis_fr et _en) ;
- pour les phases, des libellés EN, à aligner avec ceux de Keystone ;
- un détail de journal structuré (code et paramètres en JSON), traduit à l'affichage par listAudit et par l'export ;
- generateMetadata pour chaque écran et pour la fiche (`{ID} · {titre} — Codex`), selon la langue (WCAG 2.4.2).

<details><summary>Constat dans le code</summary>

Constaté. Les sites n'ont qu'un `label` (src/db/schema.ts:30), recopié tel quel par context.ts. Le fondement de conservation n'a qu'un `retentionBasis` (schema.ts:70), affiché dans src/app/archivage/page.tsx:81 et publié par /api/registry (route.ts:47). Les phases sont des chaînes uniques (src/lib/i18n.ts:203), proposées telles quelles (Dialogs.tsx:269-270). Le détail du journal est figé : fmtSize(…, 'fr') (src/lib/actions.ts:198 et 248, src/lib/importer.ts:368), `${ctx.t.readers}` dans la langue de la personne qui agit (actions.ts:311 et 340), loc(cur.name, 'fr') (actions.ts:534). Le `metadata` est statique et en français (src/app/layout.tsx:16-19), et aucun écran ne définit generateMetadata (grep).

</details>

#### 69. Pas d'aide pour les utilisateurs

- **Effort** : moyen · **Références** : M14, O-02

Faisable sans décision, à partir du modèle déjà tranché (docs/modele-cible.md) :
- une page d'aide bilingue (/aide) avec des parcours : créer un document (origine, rattachement, type, modèle), déposer une version de travail, demander une validation, valider, rejeter ou déléguer, demander une modification ou un retrait via Vigie ;
- des aides contextuelles dans les dialogues (`hint`), en complément de conf_hint_* et effective_hint.
Ce qui relève de M14 (formation, pilote, date d'interdiction des dépôts hors GED) et le retrait des notes de conception en production (lié à l'authentification réelle, O-02) restent à décider.

<details><summary>Constat dans le code</summary>

Constaté. La seule aide est le bouton « Notes » de la barre latérale (src/components/shell/Sidebar.tsx:64-65), qui ouvre NOTES (src/components/dialogs/Dialogs.tsx:624-641). Correctif au constat initial : ces notes ne sont pas seulement techniques. Elles résument le modèle (classement, identifiant, révisions, Vigie, confidentialité, simulation). En revanche, aucune page ne donne la marche à suivre pour créer, faire valider ou demander une modification, et aucune route d'aide n'existe dans src/app. M14 (formation, utilisateurs clés, pilote) est « Ouvert » (docs/audit-deck-epc2i.md:1580-1584).

</details>

## Attend une décision de l'utilisateur (49)

Ces points dépendent d'une question ouverte (O-01 à O-11 dans `docs/decisions.md`) ou d'une question de l'audit restée sans réponse. Ne pas les trancher à la place de l'utilisateur.

### Fonctionnel (18)

#### 70. Champ « sens entrant / sortant » absent pour les documents externes

- **Effort** : faible · **Références** : MET-19, G43, C11

L'absence est confirmée. D-08 (« Origine et rattachement ») réduit le besoin, puisqu'un document émis par EPC2I est d'origine interne, mais l'utilisateur n'a pas écarté explicitement le champ. Il faut lui demander de le garder ou de l'écarter. Ce n'est pas une question O-xx : elle relève de C11 et G43.

S'il est retenu :
- une colonne à deux valeurs (entrant, sortant), puis régénérer la migration ;
- le dialogue (section Externe) ;
- le contrôle dans `validateFields` et dans l'import ;
- une facette de recherche ;
- éventuellement, une date de réception exigée seulement pour un document entrant.

<details><summary>Constat dans le code</summary>

src/db/schema.ts:154-157 : documents.source_org, external_ref et received_at, sans colonne de sens. Aucune occurrence dans Dialogs.tsx (l.246-264), readFields (actions.ts:100-102) ni importer.ts. docs/modele-cible.md:97 ne cite pas le sens. Le deck, ligne 610 de sa transcription, l'exige pour l'origine externe. Dans l'audit, C11 et G43 (docs/audit-deck-epc2i.md:1473 et 978) notent : « l'utilisateur ne s'est pas prononcé ».

</details>

#### 71. Documents externes : ni l'édition ni la date d'émission de l'émetteur

- **Effort** : faible · **Références** : A17, G43, MET-19

À faire selon la réponse à A17 :
- deux champs par révision : « édition / indice de l'émetteur » et « date d'émission de l'émetteur » (chaque révision Codex d'un document externe correspond à une édition) ;
- ces champs dans le dialogue de version de travail ou de validation, dans l'import (docs/api.md), dans la recherche (fonction matches de search.ts) et sur la fiche ;
- un contrôle de cohérence : la date d'émission de l'émetteur est antérieure ou égale à la date de réception.

<details><summary>Constat dans le code</summary>

Constaté. issuedAt vaut la première mise en vigueur dans Codex (src/lib/lifecycle.ts:51). Les documents externes n'ont que sourceOrg, externalRef et receivedAt (src/db/schema.ts:155-157), affichés en src/app/documents/[id]/page.tsx:340-344. Il n'existe aucun champ d'édition ou d'indice de l'émetteur, ni par document ni par révision (revisions, schema.ts). Dans A17, la date d'émission d'un document externe est « ouverte » (docs/audit-deck-epc2i.md:1370-1374).

</details>

#### 72. Conservation comptée par révision remplacée (seul reste de T-03)

- **Effort** : moyen · **Références** : O-09, T-03, WFL-05

Constat confirmé : une révision remplacée suit la conservation de son document, et le déclencheur « superseded » ne part que du retrait ou de l'archivage du document entier. Il n'y a rien à développer tant que l'utilisateur n'a pas tranché, car le comptage par révision changerait le modèle (§8). S'il le valide, il faudra :
- calculer une fin de conservation par révision à partir de `revisions.superseded_at` (une variante de `retainUntil`) ;
- afficher des échéances par révision dans `deadlines()` et dans Archivage ;
- supprimer ou archiver les seuls fichiers de la révision concernée (`working_versions` de cette révision) ;
- mettre à jour `docs/modele-cible.md` §8.

<details><summary>Constat dans le code</summary>

src/lib/retention.ts:16-18 : `case 'superseded': return d.obsoleteAt ?? d.archivedAt`. `revisions.superseded_at` (src/db/schema.ts:217) est écrit par putInForce (src/lib/lifecycle.ts:48) et seulement affiché ensuite (src/lib/queries.ts:115, src/app/documents/[id]/page.tsx:154) : aucun calcul de conservation ne le lit. docs/modele-cible.md:108 fixe la conservation « par document ». Dans docs/decisions.md:602-603, ce point est « non fait, volontairement », car c'est une proposition à confirmer (O-09).

</details>

#### 73. Métadonnées d'un document en vigueur modifiables sans demande

- **Effort** : moyen · **Références** : G09, WFL-04 (question à poser, liée à O-09)

Le constat est confirmé et va plus loin que prévu : on peut aussi changer le type ou le département d'un document approuvé, et son ID garde alors l'ancien préfixe.

Le deck (WFL-04, slide 11) veut qu'un document validé ne se modifie que par une demande ECR/ECO, que Vigie traite (D-16). Aucune décision ne dit quels champs sont concernés. Il faut poser une question nouvelle, qui n'est pas dans O-01 à O-11 et se rattache aussi à O-09 (ID figé après la première approbation) :
- quels champs exigent une demande (au minimum le type, le rattachement, le département et la confidentialité) ;
- lesquels restent libres (mots-clés, date de révision, site).

Ensuite, il faudra restreindre `updateMeta` quand `revInForce` existe et faire passer les autres champs par la révision ouverte par l'ECO.

<details><summary>Constat dans le code</summary>

src/lib/actions.ts:278-322 : `updateMeta` ne vérifie que le droit edit, le statut de propriétaire ou de gestionnaire (l.285), `lockOf` (archivé, obsolète, gel, l.286-287) et, pour un reclassement, l'absence de circuit en cours (l.294). Rien ne vérifie `revInForce`. Dans le dialogue, seul `classificationLocked = !!runningAny` (src/app/documents/[id]/page.tsx:175, Dialogs.tsx:428) fige le classement. Le bouton est proposé sur toute fiche (page.tsx:374). Une conséquence : après la première approbation, l'ID est figé (actions.ts:296-298), mais le type et le département restent modifiables. L'ID ne correspond alors plus au `TYPE-CONTEXTE`.

</details>

#### 74. Champs de niveau 4 : obligatoires dans le deck, facultatifs et libres dans Codex

- **Effort** : moyen · **Références** : MET-18, MET-19, MET-20, MET-21, G42, G43, G44, G45, A24

L'écart est confirmé. Il dépend de l'utilisateur, car A24 (listes de valeurs et qui les maintient) n'a pas reçu de réponse, et `modele-cible` §7 rend explicitement facultatif le propriétaire de processus (choix de l'assistant). Il faut lui demander :
- quels champs deviennent obligatoires ;
- les listes de valeurs (disciplines, thèmes, statuts publication / PI, lots lus ou non depuis Keystone).

Ensuite, il faudra appliquer la règle dans `validateFields`, dans `DocFields` (`required`) et dans `parseImportMeta` (src/lib/importer.ts), et préremplir la phase avec `projects.stage`. Le préremplissage de la phase pourrait se faire tout de suite, sans décision.

<details><summary>Constat dans le code</summary>

src/lib/actions.ts:117-130 : `validateFields` n'exige que le projet (l.122), le programme (l.123) et l'organisme source pour un document externe (l.124). Dans src/components/dialogs/Dialogs.tsx:252-299, seul `sourceOrg` porte `required` (l.250). externalRef, receivedAt, projectPhase, workPackage, discipline, researchTheme, studyId, ipStatus et processOwnerId n'ont aucun `required`. La phase est une simple datalist de `PROJECT_PHASES` (src/lib/i18n.ts:203, Dialogs.tsx:269-270), jamais préremplie depuis `projects.stage`. docs/modele-cible.md:96-100 : « propriétaire de processus (facultatif) ». Le deck, ligne 607 de sa transcription, dit « Champs supplémentaires obligatoires ». A24 est « Répondu en partie » (docs/audit-deck-epc2i.md:1412-1416).

</details>

#### 75. Diffusion d'une révision et prise de connaissance (accusé de lecture)

- **Effort** : moyen · **Références** : M06

Rien n'existe pour diffuser une révision mise en vigueur ni pour tracer sa prise de connaissance. Avant de développer, l'utilisateur doit préciser :
- qui est notifié à la publication ;
- quels types exigent un accusé de lecture ;
- le niveau de preuve attendu ;
- s'il faut une mention « copie non maîtrisée » à l'impression ;
- s'il faut une liste de diffusion par document ou par fonction.
Ensuite : une liste de destinataires (personnes ou fonctions), une table d'accusés par révision, un écran « À lire » et la relance. Un canal de notification par e-mail n'existe pas encore.

<details><summary>Constat dans le code</summary>

src/db/schema.ts ne contient aucune table de diffusion, de destinataires ni d'accusé de lecture. src/lib/actions.ts n'a aucune notification (grep notif, diffus, accus : rien). La mise en vigueur (`approveRevision` et `putInForce`, src/lib/lifecycle.ts) change seulement les statuts et écrit au journal. L'audit marque M06 « Ouvert » (docs/audit-deck-epc2i.md:1532-1536), comme P10 (1682-1684).

</details>

#### 76. Propositions de l'assistant non confirmées (codification, cycle de vie, circuits, retrait)

- **Effort** : moyen · **Références** : O-09

Rien n'est à développer tant que l'utilisateur n'a pas répondu à O-09. S'il confirme, rien à faire. S'il refuse un choix, il faut retoucher `codes.ts`, `codification.ts`, `lifecycle.ts`, `actions.ts`, `storage.ts` ou le dialogue de création. Le seul développement identifié qui attend explicitement O-09 est la conservation comptée par révision remplacée (T-03) au lieu de par document : il touche `retention.ts`, `deadlines` dans `queries.ts` et l'écran Archivage. À reposer une fois en citant O-09.

<details><summary>Constat dans le code</summary>

docs/decisions.md:436-469 (« Choix de l'assistant non validés explicitement ») et O-09 (decisions.md:582) ; docs/historique.md:231-232 pour le filtrage croisé type/rattachement. Toutes ces propositions sont bien codées :
- codification : `contextOf` et `seqWidth` (src/lib/codes.ts) ;
- alias en cas de reclassement : actions.ts:298-304 ;
- nom de fichier : `nameStoredFile` et `renameDocFiles` (src/lib/storage.ts) ;
- mise en vigueur : `approveRevision` et `promoteDue` (src/lib/lifecycle.ts) ;
- exclusion des auteurs du circuit : `circuitExclusions` (actions.ts:354-357) ;
- effets d'un retrait : `applyChangeDecision` (lifecycle.ts:130-159) ;
- filtrage croisé : `normalize` et `applyPatch` (Dialogs.tsx:96-118).
La conservation par révision remplacée, laissée de côté dans T-03, dépend aussi de O-09 (decisions.md:602-603).

</details>

#### 77. Indicateurs et tableau de bord documentaire

- **Effort** : moyen · **Références** : M13

Il n'existe aucun tableau de bord : pas de volumes par type, département ou site, pas de délais de validation, pas de circuits en retard ni de documents en retard de revue, pas de complétude des métadonnées. L'utilisateur doit choisir les indicateurs, leurs destinataires et leur fréquence (M13). Ensuite : un écran réservé aux gestionnaires, avec des requêtes agrégées dans `queries.ts` filtrées selon la visibilité, et un export CSV.

<details><summary>Constat dans le code</summary>

src/app/page.tsx:51-55 : l'Accueil n'a que trois compteurs (à valider, échéances, mises en vigueur de la semaine). L'écran Archivage compte seulement les documents par type (src/app/archivage/page.tsx:85). Les onglets d'administration (src/app/administration/page.tsx:15) n'ont pas d'écran de statistiques. M13 est « Ouvert » (docs/audit-deck-epc2i.md:1574-1578). Power BI n'a pas été retenu comme exigence (docs/decisions.md:475-476) : un tableau de bord se ferait donc dans Codex.

</details>

#### 78. Distinction document maîtrisé / enregistrement

- **Effort** : moyen · **Références** : M02 (question d'audit non reprise dans O-01..O-11 ; à rattacher aux arbitrages du registre O-05)

Reste à faire :
- ajouter au registre une nature par type (document maîtrisé ou enregistrement) ;
- figer un enregistrement dès son dépôt, mis en vigueur sans circuit ;
- pour un enregistrement, refuser les nouvelles versions de travail et les ECR de modification, et n'admettre que le retrait via Vigie ;
- adapter les écrans ;
- éventuellement, gérer les registres tenus en continu (clôture périodique, figeage, horodatage).
Avant de coder, l'utilisateur doit dire quels types sont des enregistrements et comment clôturer les registres continus. C'est la question M02 de l'audit, qui n'a pas de réponse et n'est pas dans O-01..O-11 ; elle relèverait des arbitrages du registre (O-05).

<details><summary>Constat dans le code</summary>

Le manque est réel. Le registre ne distingue pas un document maîtrisé d'un enregistrement : aucun champ de nature dans RegistryType (src/db/registry.ts:7-12) ni dans la table doc_types (src/db/schema.ts, autour de 57-80). Les enregistrements suivent le cycle complet, avec circuit. Par exemple REC « Enregistrement qualité » (src/db/registry.ts:451) a un circuit resp_qualite (ligne 476) ; NCR, PV, MES et FIN ont aussi des circuits. requestChange (src/lib/actions.ts:563-586) accepte un ECR sur tout type en vigueur, sans contrôle du type. Seul le cas partiel des trois types sans étape d'approbation (LET :1218, RFQ :2009, PHO :2333) existe : ils sont approuvés dès la demande (actions.ts:416-417 et 441-446), mais ils passent quand même par un brouillon et une demande explicite, et restent révisables. M02 est noté « Ouvert » dans l'audit.

</details>

#### 79. Accès terrain et mobile

- **Effort** : moyen · **Références** : M23 (question de l'audit restée sans réponse, hors O-01..O-11)

Il faut d'abord la réponse de l'utilisateur à M23 : faut-il un accès en chantier ou en dépôt, la consultation hors ligne des révisions en vigueur, le dépôt d'une photo depuis le terrain ? Selon cette réponse : (1) adaptation à largeur mobile : barre latérale repliable, panneau de fiche en pleine largeur, tableaux en liste (effort moyen) ; (2) hors ligne éventuel : PWA avec un cache des révisions en vigueur, en respectant canRead et la confidentialité (effort important) ; (3) dépôt depuis le terrain : capture photo dans FilePicker (accept/capture). L'accès au réseau depuis un chantier dépend aussi de l'hébergement et de l'authentification (O-02).

<details><summary>Constat dans le code</summary>

Le besoin n'est pas tranché. M23 est marqué « Suite : Ouvert » dans docs/audit-deck-epc2i.md:1634-1638 : tablette ou smartphone, consultation hors ligne, dépôt depuis le terrain. L'utilisateur n'y a pas répondu, et la question n'est pas reprise dans O-01..O-11. Côté code, le manque est réel. src/app/globals.css:16 fixe une grille à barre latérale de 224 px, et la seule media query est src/app/administration/admin.module.css:12. Le panneau de la fiche document fait 400 px fixes (src/app/documents/[id]/document.module.css:25). Il n'y a ni manifeste ni service worker. La maquette ne prévoit que le bureau.

</details>

#### 80. Le drapeau « livrable client » du registre n'a aucun effet

- **Effort** : moyen · **Références** : O-05 (point 4 du registre), O-03, P08, M07

Il faut demander à l'utilisateur ce que ce drapeau doit déclencher. Exemples :
- un bordereau de transmission (révision, date, destinataire) ;
- un dossier de remise (handover) : archive des révisions en vigueur des livrables d'un projet, avec un index ;
- un visa du client par la fonction `validation_client` ;
- un accusé de réception via le portail client de Keystone, ce qui dépend aussi de la liaison Keystone (O-03).
Il faut aussi compléter la liste des types (LDC, AVT, DEF, CLO ?). Ce point complète M07 (partage externe) sans le recouper.

<details><summary>Constat dans le code</summary>

Constaté par grep. clientDeliverable n'apparaît que dans src/db/schema.ts:74 (colonne), src/db/seed.ts:99 (amorçage), src/app/api/registry/route.ts:52 (publication), src/app/administration/page.tsx:94 (affichage) et dans les libellés de src/lib/i18n.ts:58 et 152. Aucune logique ne le lit. La liste des types concernés est le point 4 de docs/registre-points-ouverts.md (O-05). P08 est « Ouvert » (docs/audit-deck-epc2i.md:1672-1674).

</details>

#### 81. Gestion multilingue : une seule langue par document et aucune traduction liée

- **Effort** : moyen · **Références** : A18, MET-03

Questions A18 à poser :
- une traduction est-elle un document distinct ou une variante du même ID ?
- quelle langue fait foi ?
- une nouvelle révision de l'original rend-elle la traduction caduque ?
- quelles langues faut-il gérer (FR, EN, arabe ?) ?
À développer selon la réponse :
- une liste de langues administrée et un champ à plusieurs valeurs ;
- un lien « traduction de » (ou des variantes par langue d'une même révision) ;
- une alerte sur les traductions quand l'original change de révision ;
- une facette Langue dans la recherche et dans l'import.

<details><summary>Constat dans le code</summary>

Constaté. `lang` est une valeur texte unique (src/db/schema.ts:140). Le dialogue ne propose que fr et en (src/components/dialogs/Dialogs.tsx:225-226). Aucune table ni colonne ne relie un original à sa traduction. FACET_KEYS (src/lib/search.ts:3) n'a pas de facette Langue. A18 est « Ouvert » (docs/audit-deck-epc2i.md:1376-1380).

</details>

#### 82. Recherche dans le contenu des fichiers

- **Effort** : important · **Références** : M10, G15 (question d'audit non numérotée en O-xx)

L'absence est réelle, mais le besoin n'est ni exigé par le deck ni confirmé par l'utilisateur : M10 est une question d'audit restée sans réponse, qui ne figure pas parmi O-01 à O-11. Il faut la faire trancher avant de lancer ce chantier coûteux. Si c'est validé :
- extraire le texte au dépôt (`stageFile`) et à l'import, et le stocker par version de travail ;
- l'indexer (tsvector Postgres sous PGlite) ;
- ne renvoyer que les versions que le lecteur peut voir (`readerMaySeeVersion`).

L'OCR des documents numérisés reste un point séparé (M09).

<details><summary>Constat dans le code</summary>

`matches` (src/lib/search.ts:29-34) ne porte que sur le titre, l'ID, les alias, les mots-clés, le type, l'organisme source, la référence externe et le sous-type. src/lib/pdf.ts:1-2 n'écrit qu'un PDF de remplacement. Aucune extraction de texte : pas de tsvector, pdf-parse ni mammoth dans src ou package.json. Le deck (transcription, l.115) ne demande que « des filtres optimisés pour la recherche ». La question M10 de l'audit (« La recherche doit-elle couvrir le contenu des fichiers, scans compris, ou seulement les métadonnées ? ») est toujours « Ouvert » (docs/audit-deck-epc2i.md:1556-1560).

</details>

#### 83. Préremplir l'en-tête du fichier créé depuis un modèle

- **Effort** : important · **Références** : A22, M12

Le fichier créé depuis un modèle est une copie brute : ni l'ID, ni la révision, ni le titre ne sont injectés. À faire, si l'utilisateur le confirme :
- à la création, puis à chaque nouvelle révision ou version de travail, renseigner dans le DOCX ou le XLSX des propriétés personnalisées ou des contrôles de contenu (ID, titre, révision, statut, propriétaire) ;
- outillage ZIP et XML à ajouter ;
- des modèles réels EPC2I préparés avec ces champs.
Règle à décider avec l'utilisateur : génère-t-on l'en-tête, ou appose-t-on un cartouche sur un rendu PDF (lien avec M12) ? Les modèles de lancement restent aussi à fournir (G06).

<details><summary>Constat dans le code</summary>

src/lib/actions.ts:169-176 et 185 : le contenu du modèle est lu (`readStored`) puis enregistré tel quel (`stageFile`) dans la version A.1, sans aucune transformation. Aucune bibliothèque DOCX ou XLSX dans package.json. Le besoin n'est pas tranché : la question A22 (« partir d'un modèle Word ou Excel dont l'en-tête est prérempli ? ») n'a reçu qu'une réponse partielle, avec la mention « l'en-tête des fichiers n'est pas prérempli » (docs/audit-deck-epc2i.md:1400-1404). La question M12, « Les en-têtes et pieds de page (ID, révision, statut) sont-ils générés automatiquement ? », est « Ouvert » (docs/audit-deck-epc2i.md:1568-1572).

</details>

#### 84. Édition Office en ligne et coédition

- **Effort** : important · **Références** : O-01

Aujourd'hui, on modifie un fichier en le téléchargeant puis en le redéposant comme version de travail. Correction au point : la coédition ne suppose pas forcément un accès direct à la bibliothèque SharePoint. Un hôte WOPI dans Codex le permettrait aussi (Office pour le web, sous programme partenaire Microsoft, ou Collabora / OnlyOffice). Mais cela créerait des versions hors du modèle de Codex : D-06 veut que SharePoint ne reçoive que le fichier, son nom et sa version, et que Codex fasse foi. Rien n'est à développer tant que l'utilisateur n'a pas dit si l'édition en ligne est nécessaire et n'a pas tranché O-01.

<details><summary>Constat dans le code</summary>

Aucune intégration d'édition en ligne (WOPI, Office pour le web, Collabora, OnlyOffice) dans src/. src/lib/storage.ts accède à SharePoint par Microsoft Graph en mode application, et les utilisateurs ne s'y connectent jamais (docs/decisions.md:514-516). Le besoin n'a jamais été exprimé : §6.6 q11 de l'audit « Ouvert, lié à O-01 » (docs/audit-deck-epc2i.md:1234-1235), P10 « Ouvert. Codex n'offre pas de coédition » (1682-1684), O-01 non répondue (decisions.md:574).

</details>

#### 85. Numérisation, OCR et valeur probante

- **Effort** : important · **Références** : M09, M10

Les scans ne sont pas cherchables, et rien n'encadre la valeur probante des copies (norme NF Z42-026, destruction des originaux papier). L'utilisateur doit d'abord décider :
- qui numérise, avec quel outil ;
- pour quels types les originaux sont détruits ;
- si la recherche doit couvrir le contenu des fichiers (M10).
Ensuite : OCR au dépôt (Tesseract ou service), stockage et indexation du texte extrait, recherche plein texte dans `runSearch` filtrée selon la visibilité, et empreinte et horodatage des copies si la valeur probante est retenue.

<details><summary>Constat dans le code</summary>

src/lib/search.ts:28-33 : la recherche ne porte que sur les métadonnées (titre, ID, alias, mots-clés, type, organisme source, référence externe, sous-type), jamais sur le contenu des fichiers. Aucune dépendance d'OCR ni d'extraction de texte dans package.json. Les fichiers sont stockés bruts (src/lib/storage.ts). M09 et M10 sont « Ouvert » (docs/audit-deck-epc2i.md:1550-1560).

</details>

#### 86. Rendu PDF de diffusion figé à la mise en vigueur

- **Effort** : important · **Références** : M12 (question d'audit non reprise dans O-01..O-11) ; O-01 pour le choix du moteur de conversion

Reste à faire :
- choisir les formats de diffusion admis par type (nouveau champ du registre et contrôle au dépôt, avec une taille maximale) ;
- générer à la mise en vigueur un rendu PDF (ou PDF/A) figé, stocké à côté du fichier natif ;
- éventuellement, ajouter un filigrane « Brouillon » sur les versions de travail et un cartouche (ID, révision, statut).
Attention : le « service de conversion » dont parlait la description n'existe pas. Il faut l'ajouter : un moteur externe (LibreOffice ou Gotenberg) ou, si SharePoint est activé (O-01), la conversion de Microsoft Graph. Il faut aussi une bibliothèque PDF pour le filigrane. Avant de coder, l'utilisateur doit répondre à la question M12 de l'audit : PDF/A ou non, formats acceptés, filigrane, en-têtes générés.

<details><summary>Constat dans le code</summary>

Le manque est réel. putInForce (src/lib/lifecycle.ts:45-53) change seulement des statuts et des dates : aucun rendu n'est produit. La route de fichier (src/app/api/documents/[id]/file/route.ts:93-99) sert le fichier stocké tel quel, sans filigrane ; simplePdf (src/lib/pdf.ts) ne sert qu'à fabriquer un PDF de remplacement pour les documents de démo sans fichier. Le registre n'a aucun champ de format (type RegistryType, src/db/registry.ts:7-12), et stageFile (src/lib/storage.ts:195-200) accepte tous les types MIME. Aucun service de conversion n'existe : DocClient.tsx:14 indique « no conversion exists », et la chaîne i18n preview_note (src/lib/i18n.ts:18) vient de la maquette et n'est utilisée nulle part. package.json n'a aucune bibliothèque PDF. L'audit (M12, docs/audit-deck-epc2i.md) dit « Ouvert ». La question M12 n'a jamais été tranchée et ne figure pas parmi O-01..O-11.

</details>

#### 87. Circuits : délai unique de 7 jours, étapes seulement séquentielles, pas de suppléance

- **Effort** : important · **Références** : O-06, A07, WFL-02

Faisable dès maintenant : un indicateur « en retard » dans Validations (liste et en-tête) et sur l'accueil, calculé à partir de workflows.due, déjà stocké.
À développer une fois A07 et O-06 tranchés :
- des délais par étape ou par type dans le registre : `circuit` devient une liste d'étapes {fonction, délai, mode} ;
- des étapes parallèles : plusieurs valideurs au même rang, tous requis ou un seul ;
- une suppléance d'absence : période et suppléant habilité à valider, appliquées par resolveFunction et réaffectant les étapes en attente.
Les relances et l'escalade restent dans le point Notifications (M19).

<details><summary>Constat dans le code</summary>

Constaté. src/lib/actions.ts:437 fixe `due: addDays(today, 7)` pour tout circuit. workflow_steps n'a ni échéance ni rang parallèle (src/db/schema.ts:268-281) ; workflows.step est un index unique (ligne 258), donc les étapes sont strictement séquentielles. delegateStep est manuel (actions.ts:513-540) ; il n'existe aucune notion d'absence. Validations n'affiche que « Échéance {date} » (src/app/validations/page.tsx:98 et 114), sans calcul de retard : aucune occurrence de retard pour les circuits dans src. A07 laisse ouverts les délais, le parallélisme et les délégations ; la matrice est provisoire (O-06).

</details>

### Sécurité et conformité (9)

#### 88. Chiffrement au repos des fichiers stockés

- **Effort** : moyen · **Références** : O-01, G02, M22

Si SharePoint est activé (O-01), Microsoft 365 chiffre les fichiers au repos ; il restera la base PGlite, à placer sur un volume chiffré. Sinon, deux options :
- un stockage objet chiffré (Azure Blob par exemple) derrière l'interface `FileStore` (storage.ts:24-35) ;
- un chiffrement AES-256-GCM dans `put` et `get` du store local, avec une clé hors du dépôt (variable d'environnement ou coffre de clés) et une procédure de rotation.
Dans tous les cas, documenter le chiffrement du volume `.data` (base et fichiers) pour l'exploitation.

<details><summary>Constat dans le code</summary>

Constaté : src/lib/storage.ts:40-63 (store local : writeFile/readFile/link en clair dans FILES_DIR) ; src/db/index.ts:13-14 (FILES_DIR = .data/files) ; aucun chiffrement applicatif dans put/get. La base PGlite (.data) n'est pas chiffrée non plus. docs/audit-deck-epc2i.md:609 (G02 : « fichiers par défaut sur le disque local sans chiffrement »). Le choix du stockage SharePoint, qui réglerait la question pour les fichiers, est la question ouverte O-01 (docs/decisions.md:574).

</details>

#### 89. Comptes et rôles : provisionnement, attribution des rôles, départs

- **Effort** : moyen · **Références** : O-02, O-04, M16

Le modèle et l'administration des comptes sont à écrire :
- colonnes `external_id` (oid/UPN), `email` et `active` (avec date de départ) dans `users` ;
- provisionnement à la première connexion ou synchronisation de l'annuaire et de ses groupes (dépend d'O-02) ;
- rattachement au département et au site (dépend de l'organigramme, O-04) ;
- écran d'attribution des rôles, avec mutation journalisée ;
- rôles Lecteur et Administrateur rendus effectifs ;
- désactivation sans suppression : on garde les références (propriétaire, étapes, journal), on exclut la personne des circuits (`resolveFunction`, titulaires de fonctions) et on signale les documents dont le propriétaire est parti.
Il faut aussi convenir avec Keystone et Vigie d'un identifiant de personne commun (`modifierId` du webhook, `ownerId` de l'import).

<details><summary>Constat dans le code</summary>

Constaté : src/db/schema.ts:35-44 (users : id, name, initials, role, title, department, site, isSystem ; ni oid/UPN, ni e-mail, ni statut actif) ; aucune action de création ou de modification d'utilisateur dans src/lib/actions.ts (liste des exports : simulateUser, togglePermission, addOrgValue, addFunctionHolder, removeFunctionHolder, updateType…) ; l'onglet Rôles de l'administration (src/app/administration/page.tsx:179-215) n'édite que la matrice rôle × droit ; users.role décide qui peut valider (src/lib/actions.ts:360-367, approverCheck) et le modificateur par défaut (src/lib/lifecycle.ts:117-123, defaultModifier) ; src/lib/i18n.ts:215 (SIMULATED_MATRIX_ROLES) et :91 (Lecteur et Administrateur sans équivalent simulé) ; src/lib/importer.ts:155 et src/app/api/integrations/vigie/route.ts:43-45 (identifiants de personnes supposés communs).

</details>

#### 90. Sort final à échéance : destruction et revue de conservation non exécutées

- **Effort** : moyen · **Références** : G39, M03, O-07, ACC-06

Une fois le processus de fin de conservation tranché (M03 : qui valide, quelle preuve) et les durées validées (O-07) :
- un circuit de destruction : proposition, puis validation par le droit Détruire, ajouté à `ENFORCED_PERMS`. Il est refusé sous gel juridique, avant l'échéance (`retainUntil`) ou si une révision est ouverte. Il supprime les fichiers dans le stockage (`remove`), efface ou anonymise la fiche en gardant un squelette (ID, type, dates) et laisse au journal un procès-verbal non effaçable ;
- une action « Revue à échéance » pour le sort « review » (41 types) : prolonger avec motif et nouvelle échéance, ou archiver ;
- une saisie obligatoire du motif de gel juridique, journalisé à la place du code du type (actions.ts:641) ;
- l'affichage dans `DueTable` des actions qui correspondent à la colonne « Proposé ».
Un motif de gel peut être ajouté dès maintenant, sans attendre M03.

<details><summary>Constat dans le code</summary>

Constaté : src/lib/queries.ts:222 (échéance de conservation proposée « destroy » ou « review ») ; src/db/registry.ts : 23 types (et non 24) ont `"disposition": "destroy"` ; src/app/archivage/DueTable.tsx:17 et :41-43 (seules actions : archiveDocuments et holdDocuments) ; src/lib/i18n.ts:213 (ENFORCED_PERMS sans 'destroy') ; src/lib/actions.ts:610-688 (archive, gel, levée, restauration ; aucune destruction ni revue) ; :641 (le gel journalise d.typeCode au lieu d'un motif). M03 est une question d'audit ouverte (docs/audit-deck-epc2i.md:1514-1518), et les durées attendent O-07 (docs/decisions.md:580).

</details>

#### 91. Rôle « Audit & conformité » : pas d'accès au journal, aux circuits ni aux documents confidentiels

- **Effort** : moyen · **Références** : M05, ACC-05, G48

Le rôle peut auditer un document à la fois, et seulement parmi ceux qu'il peut lire. Il n'a ni journal global, ni export, ni détail des circuits terminés, ni accès aux documents Confidentiels et Très confidentiels hors de son département.
À demander (M05, ouvert dans docs/audit-deck-epc2i.md:1526-1530) :
- qui consulte le journal, et avec quel périmètre (métadonnées seules, ou contenu des confidentiels) ;
- combien de temps on garde le journal.
Ensuite :
- un droit « Auditer » dans PERM_KEYS et la matrice, qui donne en lecture seule le journal et son export, le détail des circuits terminés (listWorkflows, `visible`) et les métadonnées de tous les documents, sans ouvrir les fichiers confidentiels ;
- la journalisation de ces consultations ;
- une purge ou un archivage du journal selon la durée retenue.

<details><summary>Constat dans le code</summary>

Constaté. Dans src/db/seed-org.ts:123, la ligne de l'auditeur n'a que Lire. src/lib/context.ts:85 fixe `workflow: role !== 'auditeur'` et `admin: perms.has('admin')`. Le journal global est réservé à l'administration, à l'écran (src/app/administration/page.tsx:25) comme à l'export (src/app/api/export/audit/route.ts:16). canRead ne fait aucune exception pour l'auditeur (src/lib/access.ts:68-86). Nuance par rapport au constat initial : sur un document qu'il peut lire, l'auditeur voit l'onglet Historique, c'est-à-dire le journal filtré sur ce document (src/app/documents/[id]/page.tsx:83 et 460-469), ainsi que la liste résumée des circuits terminés de l'onglet Validation (lignes 400-415). Il n'en voit ni les étapes ni les commentaires, car le lien n'apparaît que si `w.visible`.

</details>

#### 92. Droits fins : trois niveaux de confidentialité identiques, tout le Très confidentiel visible des gestionnaires

- **Effort** : moyen · **Références** : A12, ACC-04, D-13, D-14, O-04

À demander, puis à développer :
- le sens propre de Public (diffusion sans authentification ?) et de Restreint (diffusion externe désignée), aujourd'hui confondus avec Interne ;
- l'accès des gestionnaires et du propriétaire au Très confidentiel : métadonnées seules, ou contenu ? Il faut ensuite aligner le code ou le §5 de modele-cible.md, qui se contredisent aujourd'hui ;
- des lecteurs par fonction, groupe, site ou société (O-04 pour les sociétés) ;
- un droit de téléchargement distinct de la consultation (aperçu seul).

<details><summary>Constat dans le code</summary>

Constaté. Dans canRead (src/lib/access.ts:74-78), public, restreint et interne renvoient tous `true`. inDraftingCircle (access.ts:54-57) inclut `ctx.seesAll`, donc les gestionnaires, ainsi que le propriétaire : canRead rend true avant même le test de confidentialité (ligne 69). Or docs/modele-cible.md:70-77 dit que les lecteurs désignés « sont les seuls lecteurs d'un document très confidentiel », et D-14 ne vise que les brouillons. document_readers ne porte que userId (src/db/schema.ts:198-205). La route fichier ne distingue pas consulter et télécharger : `download=1` ne fait que changer l'en-tête et journaliser (file/route.ts:76-80 et 112-115). Côté décisions, A12 n'est « répondu » que pour l'échelle : les règles par niveau sont des propositions (docs/audit-deck-epc2i.md:1340-1344).

</details>

#### 93. Authentification réelle à la place de l'identité choisie par cookie

- **Effort** : important · **Références** : O-02, T-01, D-03, G13, G48, M16, ACC-01, ACC-02, ACC-03

Une fois le fournisseur choisi (O-02 ; Entra ID est proposé, pas confirmé) :
- connexion OIDC (code + PKCE), session signée en cookie httpOnly/secure/SameSite, route de rappel, déconnexion ;
- un `src/proxy.ts` qui redirige les visiteurs non authentifiés, et le même contrôle de session dans les routes `/api/documents/*` et `/api/export/*` ;
- `getCtx` dérivé de la session, plus jamais d'un cookie libre ;
- `simulateUser` et le sélecteur de profil réservés à un mode démo explicite (variable d'environnement), désactivés en production.
Tant que ce n'est pas fait, `src/lib/access.ts` et la matrice des droits ne protègent rien, et le journal n'a pas de valeur probante.

<details><summary>Constat dans le code</summary>

Constaté : src/lib/context.ts:46-68 (utilisateur et rôle lus dans les cookies codex-user/codex-role, rôle libre parmi SIM_ROLES l.67-68) ; src/lib/actions.ts:57-67 (simulateUser, ouvert à tous, cookies posés l.63-64 sans httpOnly ni secure) ; aucun src/proxy.ts ; src/app/api/documents/[id]/file/route.ts:42 (getCtx, donc le cookie, pour l'accès aux fichiers) ; src/app/api/export/audit/route.ts:15-16 (même chose). La simulation est un choix assumé pour la démo (D-03), et « l'authentification réelle viendra plus tard ». Le fournisseur n'est pas choisi (O-02, docs/decisions.md:575).

</details>

#### 94. Niveau « Restreint » : diffusion externe encadrée (« Partager » ne fait que copier l'URL)

- **Effort** : important · **Références** : D-13, ACC-02, G31, M07, O-02

Reste à faire trancher par l'utilisateur (M07 ; dépend aussi d'O-02 pour des accès invités) comment se fait la diffusion d'un document Restreint au client ou au partenaire désigné : lien de partage expirant, accès invité, export tracé avec filigrane ou cartouche, ou simple bordereau de transmission. Il faudra ensuite :
- le destinataire externe désigné sur le document ;
- le mécanisme choisi, refusé au-dessus de Restreint ;
- le registre des transmissions (qui a reçu quelle révision, quand) ;
- l'inscription au journal.
D'ici là, renommer ou réétiqueter le bouton « Partager » (« Copier le lien », avec une icône adaptée) pour ne pas laisser croire à un partage.

<details><summary>Constat dans le code</summary>

Constaté : src/lib/access.ts:74-78 (public, restreint et interne renvoient true de la même façon ; en interne c'est cohérent avec D-13, puisque Restreint est moins protégé qu'Interne) ; src/components/ui/client.tsx:76-91 (ShareButton copie window.location.href, icône « more ») ; src/app/api/documents/[id]/file/route.ts:75-84 (aucun marquage du niveau ni de la révision sur le fichier servi) ; aucun code de partage externe, d'invité ou de filigrane dans src/. docs/audit-deck-epc2i.md:870 (G31 : « aucun mécanisme de diffusion à un client ») et :1540-1542 (M07 ouvert). Le mode de diffusion est une question d'audit M07 non tranchée ; les accès invités dépendent d'O-02.

</details>

#### 95. Signature électronique des étapes de circuit

- **Effort** : important · **Références** : G17, M04

Une fois tranchée par l'utilisateur la question d'audit M04 (types concernés, niveau eIDAS simple, avancé ou qualifié, prestataire Yousign, DocuSign ou autre, et si une approbation vaut signature) :
- un attribut `sign` par étape de circuit dans le registre (`circuit` de src/db/registry.ts et écran Registre), repris par `requestValidation` à la place de `sign: false` ;
- l'intégration du prestataire : envoi du fichier final, webhook de statut signé (même durcissement que T-01), étape débloquée à la signature ;
- le fichier signé conservé comme version finale de la révision, avec son empreinte et le journal 'sign'.

<details><summary>Constat dans le code</summary>

Constaté : src/lib/actions.ts:438 (toutes les étapes sont insérées avec `sign: false`) ; src/db/schema.ts:278 (colonne sign) ; src/app/validations/page.tsx:124 (mention eIDAS affichée seulement si `r.current?.sign`, donc jamais) ; src/lib/actions.ts:502 (action d'audit 'sign' jamais atteinte) ; src/lib/i18n.ts:20 (sign_note) ; design/GED Groupe.dc.html:644, 656 et 722 (« Validation + signature »). docs/audit-deck-epc2i.md:744 (G17) et :1520-1524 (M04 ouvert : types concernés, niveau eIDAS, prestataire).

</details>

#### 96. Données personnelles (RGPD) des documents RH

- **Effort** : important · **Références** : M17 (pas de numéro O-xx) ; O-07, O-05, O-04 ; lien M03 (destruction)

Ce qui reste à développer, une fois que l'utilisateur a dit quels types ou sous-types contiennent des données personnelles et quelles durées s'appliquent (O-07, O-05 ; validation par le DPO, question M17 à poser) :
(a) un indicateur « données personnelles » par type ou sous-type dans le registre, recopié sur le document ;
(b) une restriction d'accès propre à ces documents, par exemple un plancher Confidentiel et une exclusion éventuelle des profils seesAll hors RH ;
(c) une date de départ du salarié, saisie ou fournie par une source RH ou l'annuaire, pour calculer le déclencheur employee_departure (retention.ts:25) ;
(d) une destruction effective (purge des fichiers dans storage.ts et des métadonnées, avec une trace minimale et un procès-verbal), qui n'existe pour aucun type (lien avec M03) ;
(e) un champ « personne concernée » qui permette la recherche et l'export pour l'exercice des droits.
Attention, la liste France / Royaume-Uni / Maroc citée par M17 vient des données fictives de la maquette (P03). Les lois applicables dépendent de l'organigramme réel (O-04).

<details><summary>Constat dans le code</summary>

Le manque est réel, et le cadrage attend l'utilisateur. M17 (docs/audit-deck-epc2i.md:1598-1602) est toujours « Ouvert » : quels types contiennent des données personnelles, quelles durées, validation par le DPO. Ce que montre le code :
(1) Aucun indicateur « données personnelles » sur le type ni sur le document (rien dans src/db/schema.ts ni dans src/db/registry.ts).
(2) Le seul type RH, RHF « RH & Formation » (registry.ts:636-683), a la règle 5 ans, déclencheur employee_departure, sort 'destroy'. Or triggerDate renvoie null pour « départ » (src/lib/retention.ts:25). Ces documents n'ont donc jamais de fin de conservation et n'apparaissent pas dans les échéances (queries.ts:222).
(3) Aucune destruction n'est exécutée. Il n'existe pas d'action destroy dans src/lib/actions.ts (archiveDocuments, holdDocuments, releaseHold et restoreArchived seulement, lignes 609-685), et 'destroy' est absent de ENFORCED_PERMS (src/lib/i18n.ts:213). La purge est donc impossible.
(4) Les accès suivent seulement la confidentialité (src/lib/access.ts:68-86). RHF est Confidentiel par défaut (registry.ts:681), donc visible par tout le département et par seesAll. Le niveau Interne reste permis (confAllowed, :676-680).
(5) Rien ne permet l'exercice des droits des personnes : aucun champ « personne concernée », ni recherche ni export par personne.
M17 n'a pas de numéro O-xx. Ses dépendances sont O-07 (durées par type), O-05 (registre) et O-04 (sociétés et pays, donc lois applicables).

</details>

### Intégrations (15)

#### 97. Dépôt depuis Keystone : lien profond vers le dialogue de création prérempli

- **Effort** : faible · **Références** : O-03

Le manque est confirmé, et il est un peu plus large que décrit. Aucune URL n'ouvre « Nouveau document » prérempli. Surtout, la liste des pièces attendues et le bouton « Déposer » n'existent que dans l'onglet Projet de la fiche d'un document déjà rattaché au projet (page.tsx:249-289). Pour un projet qui n'a encore aucun document dans Codex, il n'y a donc aucun point d'entrée.
À écrire :
- des paramètres d'URL (ex. `/documents/nouveau?project=…&expected=…`, ou `?new=1&project=…&expected=…` lus par l'AppProvider) qui ouvrent le dialogue prérempli, avec le type verrouillé comme le fait `lockType` (Dialogs.tsx:335) ;
- la revalidation côté serveur, déjà en place dans `createDocument` (actions.ts:177-180, 199-203) ;
- éventuellement une vue projet (`/projets/{code}`) qui liste les pièces attendues ;
- ou, à la place, une API de création réservée à Keystone. Le choix entre les deux relève de O-03.

<details><summary>Constat dans le code</summary>

Constaté : src/components/ui/client.tsx:11-18 (DialogButton → open(spec), état client seulement) ; aucun useSearchParams dans src/components/shell/AppProvider.tsx ; src/app/documents/[id]/page.tsx:285-289 (seul DialogButton avec expectedId) ; aucune page projet dans src/app (seuls administration, archivage, documents/[id], explorateur, recherche, validations) ; docs/decisions.md:558-559 (la spec Keystone laisse ouvert « deep link? API create? »).

</details>

#### 98. SharePoint : envoi par session d'upload au-delà de 250 Mo

- **Effort** : faible · **Références** : O-01

Le point est confirmé. Le pilote fait un PUT simple, d'où le plafond de 250 Mo de l'import quand SharePoint est actif (import/route.ts:12). À faire, si SharePoint est activé (O-01) :
- `put` par `createUploadSession` et envoi par plages (Content-Range), avec reprise par plage ;
- relever le plafond de l'import.
Pour en tirer profit, la route d'import devrait aussi lire le fichier en flux plutôt qu'en un seul `arrayBuffer` (route.ts:44). Le dépôt depuis l'interface reste limité à 50 Mo (next.config.ts).

<details><summary>Constat dans le code</summary>

Constaté : src/lib/storage.ts:98-104 (PUT simple sur /content, commentaire « ≤ 250 MB ») ; src/app/api/import/route.ts:8-13 (plafond 250 Mo avec SharePoint) et 44 (fichier entièrement chargé en mémoire) ; next.config.ts (serverActions.bodySizeLimit '50mb') ; docs/historique.md:324-326 (constat 44, « non fait »).

</details>

#### 99. Import : documents obsolètes ou archivés, gel juridique et approbation d'origine

- **Effort** : faible · **Références** : O-11, A23, D-21

Selon la réponse à A23 et O-11 (reprend-on les documents périmés et l'historique ?) :
- accepter `state: obsolete | archived` avec `obsoleteAt` ou `archivedAt`, ainsi que `legalHold` et `legalHoldAt`, puis refreshHeadline ;
- accepter un champ `legacyApproval` (approbateurs en texte, date), stocké et affiché sur la fiche et dans la future fiche de visa ;
- documenter ces champs dans docs/api.md.
C'est l'API d'import de Codex (D-21), pas le code de migration lui-même.

<details><summary>Constat dans le code</summary>

Constaté. Dans src/lib/importer.ts:181, `status` n'accepte que in_force et draft. L'insertion (importer.ts:337-348) n'écrit ni state, ni obsoleteAt, ni archivedAt, ni legalHold : le document reçoit les valeurs par défaut (state 'active', legalHold false). La révision n'a que approvedAt (ligne 351), sans approbateurs. Le déclencheur `superseded` de src/lib/retention.ts:18 dépend de obsoleteAt ou archivedAt, que l'import ne renseigne jamais. La question de reprendre ou non les documents périmés est ouverte (A23, docs/audit-deck-epc2i.md:1406-1410 ; O-11).

</details>

#### 100. Webhook Vigie : accepter les demandes nées dans Keystone et les ECO portant sur plusieurs documents

- **Effort** : moyen · **Références** : O-10, D-18, D-16

Le manque est confirmé, avec une correction. Ce n'est pas l'index `change_requests_pending` (schema.ts:315) qui limite une demande à un seul document : cet index n'autorise qu'une demande en attente par document. La limite vient de `doc_id`, une colonne unique et obligatoire (schema.ts:301). L'index pose en plus un problème : un ECO multi-documents entrerait en conflit avec une demande déjà en attente sur l'un de ces documents. Il faut aussi que le demandeur existe dans `users` (FK, schema.ts:302), ce qui suppose la correspondance des personnes avec Keystone.
À faire, une fois le contrat fixé avec Vigie (O-10) :
- accepter dans le corps du webhook la description de la demande : document(s), kind, demandeur, source keystone ou vigie, motif ;
- créer la ligne miroir puis appliquer la décision, avec les contrôles de `requestChange` (révision en vigueur requise, document non verrouillé, une seule demande en attente par document). Une révision déjà ouverte n'est plus un motif de refus (D-26) : la modification acceptée l'attend ou s'y greffe (`applyChangeDecision`, `graftChange`) ;
- relier une demande à plusieurs documents : table de liaison demande ↔ document, avec un statut par document ;
- mettre à jour `docs/api.md` (l.283).

<details><summary>Constat dans le code</summary>

Constaté : src/app/api/integrations/vigie/route.ts:48-49 (404 not_found si la requestId n'est pas dans change_requests) ; src/db/schema.ts:301 (doc_id text notNull, une seule colonne), 302 (requester_id notNull, FK vers users), 310 (source 'codex' par défaut ; requestChange ne passe jamais source, actions.ts:579) ; schema.ts:315 (index unique : une seule demande en attente par document) ; docs/api.md:283 (404 documenté) ; docs/decisions.md:326-327 (D-18 « À faire ») et O-10 (« Comment accepter les demandes nées dans Keystone… »).

</details>

#### 101. Pièces attendues : contrat dans les deux sens avec Keystone

- **Effort** : moyen · **Références** : O-03, D-18, M15

Le manque est confirmé. Tout reste local : la liste des pièces (libellé, type, « attendue plus tard ») vient uniquement du seed (seed.ts:226), et Keystone n'est jamais informé d'un dépôt ni d'une libération. L'import de migration ne rattache aucune pièce (importer.ts). La fiche ne marque une pièce « Déposée » qu'une fois sa révision en vigueur (page.tsx:145) : Keystone doit donc aussi apprendre les changements de statut.
À écrire :
- la réception des pièces attendues par projet et par phase (ajout, suppression, changement de type), avec un identifiant stable côté Keystone (aujourd'hui `project_expected.id` est un serial local) ;
- les notifications vers Keystone : pièce déposée (ID Codex), de nouveau attendue, mise en vigueur, remplacée ou retirée ;
- la transmission des anciens ID (alias) après un reclassement (actions.ts:264-274) ;
- éventuellement, un champ de pièce attendue dans l'API d'import.

<details><summary>Constat dans le code</summary>

Constaté : src/lib/actions.ts:199-208 (createDocument écrit project_expected.doc_id et un project_events local), 264-274 (releasePieces libère la pièce et écrit un événement local) ; project_expected n'est rempli que par src/db/seed.ts:226 ; aucune référence à projectExpected dans src/lib/importer.ts ; src/app/documents/[id]/page.tsx:143-147 (« Déposée » seulement si revInForce) ; aucun appel sortant vers Keystone dans src/.

</details>

#### 102. Équipe projet : alimenter depuis Keystone les fonctions de portée projet

- **Effort** : moyen · **Références** : O-03, O-06

Le manque est confirmé, avec une correction. Un nouveau projet n'échoue pas en `no_holder` (actions.ts:443) avec le seed actuel : les quatre fonctions de portée projet ont un titulaire « groupe » (seed-org.ts:92-94), et `resolveFunction` s'y rabat (actions.ts:383). Le vrai défaut, c'est que les étapes partent vers des personnes génériques :
- mkerviel pour referent_ingenierie, oblanc pour resp_chantier ;
- le chef de projet interne pour validation_client (actions.ts:381), ce qui est discutable pour une « validation client ».
`no_holder` n'arriverait que si ces titulaires « groupe » étaient retirés. Un administrateur peut aujourd'hui saisir à la main des titulaires par projet (`addFunctionHolder`, actions.ts:732).
À écrire, pendant la synchronisation Keystone :
- alimenter `function_holders` (`scopeValue` = code projet) avec l'équipe projet, et les retirer à la clôture ;
- définir la correspondance entre rôles Keystone et fonctions Codex ;
- fixer le comportement sans titulaire projet : repli groupe ou refus.

<details><summary>Constat dans le code</summary>

Constaté : src/db/seed-org.ts:67-70 (chef_projet, referent_ingenierie, resp_chantier, validation_client de portée 'project'), 92-94 (titulaires : HLT-026 seulement pour referent_ingenierie et resp_chantier, plus un titulaire « groupe » sans scopeValue pour les quatre fonctions) ; src/lib/actions.ts:374-387 (resolveFunction : portée projet, puis managerId pour chef_projet et validation_client l.381, puis titulaire groupe l.383) ; actions.ts:732-744 (addFunctionHolder, saisie manuelle en administration).

</details>

#### 103. SharePoint : décider de l'activation, puis tester le pilote sur un vrai tenant

- **Effort** : moyen · **Références** : O-01, D-06, T-01, ARC-03, G02

Le point est confirmé. Le pilote n'a jamais tourné sur un tenant, `renameDocFiles` non plus. Restent à décider (O-01) : l'activation, un fichier par version de travail ou par révision, et l'absence d'accès direct des utilisateurs à la bibliothèque.
Ensuite :
- inscrire l'application avec une permission limitée au site (ex. Sites.Selected) et renseigner `CODEX_SP_*` ;
- tester le put dans `_staging` (storage.ts:98-104), le déplacement par `parentReference.path` (l.105-111), get et remove ;
- purger les orphelins de `_staging`, et ceux de `.data/files` en local : `discardFile` n'est appelé qu'au mieux ;
- décider s'il faut reprendre les fichiers déjà stockés en local à la bascule. Ils restent lisibles grâce à `stores()` (l.132-134).
Correction : « supprimer les fichiers à la destruction » n'est pas propre à SharePoint. Codex n'a aucune action de destruction : le sort final 'destroy' ne sert qu'à afficher une échéance (queries.ts:222). C'est un manque de la conservation, à traiter à part.

<details><summary>Constat dans le code</summary>

Constaté : src/lib/storage.ts:65 (« Not exercised against a real tenant yet »), 66-123 (pilote Graph app-only), 132-134 (stores() choisit le stockage par ligne), 233-245 (renameDocFiles) ; .env.example:21-25 (CODEX_STORAGE et CODEX_SP_* en commentaire, vides) ; docs/decisions.md O-01 (posée 4 fois, sans réponse) ; docs/avancement-v2.md:46. Aucune action de destruction dans src/lib/actions.ts : 'destroy' n'apparaît qu'en libellé et dans les échéances (src/lib/queries.ts:222).

</details>

#### 104. Notifications hors de l'application, relances et escalade

- **Effort** : moyen · **Références** : G19, M19, O-02

Le manque est confirmé. Personne n'est prévenu hors de Codex :
- d'une étape de circuit assignée ou d'un rejet ;
- d'un ECO accepté qui le désigne ;
- d'une échéance de revue ou d'expiration.
Aucune relance ni escalade n'existe pour une étape en retard (due à +7 jours, actions.ts:437), et `users` n'a pas d'adresse e-mail (schema.ts:35-44).
À écrire, dans Codex et sans Power Automate (D-06) : une file d'événements, des gabarits FR/EN, des préférences, un déclenchement par planificateur (aucun aujourd'hui), branchés sur SMTP ou sur Microsoft Graph (sendMail, Teams). Restent à décider avec l'utilisateur : le canal (jamais discuté, §6.6 q2), qui alerter et combien de temps avant (M19). Graph suppose Entra ID (O-02).
La partie faisable sans décision est faite depuis le 11 octobre 2026 (point 10) : « À traiter » et la cloche listent les révisions ouvertes au nom de l'utilisateur par un ECO, les rejets, les brouillons et les échéances du propriétaire (G19). Restent les notifications hors de l'application, les relances et l'escalade.

<details><summary>Constat dans le code</summary>

Constaté : src/components/shell/Header.tsx:89-115 (cloche limitée aux étapes à valider et à l'activité récente) ; src/lib/actions.ts:437 (due = +7 jours, aucune relance) ; src/db/schema.ts:35-44 (users sans e-mail) ; aucune occurrence de smtp, sendMail, nodemailer ni relance dans src/ ; docs/audit-deck-epc2i.md:762 (G19 : révision ouverte par ECO listée nulle part), 1216 (§6.6 q2 : Teams/Outlook « non discuté »), 1610-1614 (M19 : ni notification ni escalade).

</details>

#### 105. Conservation « fin de projet » incalculable (26 types) : date de clôture à recevoir de Keystone

- **Effort** : moyen · **Références** : O-03, O-05, O-07, G39, M15

Le point est confirmé : 26 types déclenchés par `project_end` n'ont aucune date de fin de conservation (retention.ts:25) et n'apparaissent jamais dans les échéances d'Archivage (queries.ts:222). À faire :
- une colonne de clôture sur `projects` (schema.ts:101-110), alimentée par l'événement de clôture de Keystone, puis le cas `project_end` dans `triggerDate` ;
- une « fin de programme » sur `research_programs` (schema.ts:112-116), pour les 12 types recherche ;
- un repli pour les documents de ces types créés hors projet (point 3 du registre, O-05).
À noter : `asset_life` (14 types) et `employee_departure` (1 type) sont dans le même cas, mais ne dépendent pas de Keystone.

<details><summary>Constat dans le code</summary>

Constaté : src/lib/retention.ts:12-26 (triggerDate : default → null pour project_end, asset_life, employee_departure), 30-34 (retainUntil null) ; décompte dans src/db/registry.ts : 26 types project_end, 14 asset_life, 1 employee_departure ; src/lib/queries.ts:222 (seuls les documents qui ont un retainUntil entrent dans les échéances) ; src/db/schema.ts:101-110 (projects sans date ni statut de clôture), 112-116 (research_programs sans date de fin) ; docs/registre-points-ouverts.md:22-24 (point 3).

</details>

#### 106. API d'import : reprise des révisions antérieures et import par lot

- **Effort** : moyen · **Références** : O-11, D-21

Le point est confirmé. `POST /api/import` crée une seule révision, en vigueur, approuvée ou brouillon (importer.ts:349-354), avec au plus une version de travail. L'historique des révisions remplacées ne peut donc pas être repris. Il n'y a pas d'appel par lot (route.ts:4), et chaque fichier est chargé entièrement en mémoire (route.ts:44). Si l'utilisateur veut garder l'historique, ou si les volumes l'exigent (O-11), l'API devra accepter :
- plusieurs révisions par document, dont les révisions « Remplacé » avec leur date ;
- des lots ;
- l'envoi en flux.
Le programme de migration lui-même reste hors de Codex (D-21) : seule l'API est concernée.

<details><summary>Constat dans le code</summary>

Constaté : src/lib/importer.ts:181-183 (une seule lettre de révision, statut in_force ou draft), 349-354 (une seule insertion dans revisions), puis une seule version de travail ; src/app/api/import/route.ts:4 (« one legacy document per call »), 44 (fichier entièrement chargé en mémoire) ; docs/api.md:180-181 (« les révisions antérieures restent dans l'ancien système ») ; D-21 (migration hors de Codex, API d'import dans Codex) ; O-11 ouverte.

</details>

#### 107. Capture des e-mails

- **Effort** : moyen · **Références** : M08 (question d'audit ouverte, hors liste O-01 à O-11 ; liée à M11, à C15 et, pour un complément Outlook, à O-02)

Aujourd'hui, on peut seulement déposer à la main un fichier .eml ou .msg (ou un PDF imprimé depuis la messagerie) dans un document LET de sous-type « Email formalisé », en saisissant soi-même l'organisme source, la référence externe et la date de réception. Reste à développer, une fois la méthode choisie par l'utilisateur. 1) Reconnaître les formats .eml (message/rfc822) et .msg (application/vnd.ms-outlook) dans src/lib/storage.ts, avec un aperçu lisible : en-têtes et corps. 2) À l'analyse du fichier, pré-remplir les métadonnées dans le formulaire de dépôt et dans updateMeta : expéditeur vers sourceOrg, date vers receivedAt, Message-ID vers externalRef, objet vers le titre. 3) Selon le choix de l'utilisateur, soit garder les pièces jointes dans l'e-mail, soit les classer comme documents séparés. Ce second cas suppose une table de liens entre documents, qui n'existe pas (M11). 4) Un éventuel complément Outlook dépendrait en plus du fournisseur d'authentification (O-02). L'effort est moyen pour un dépôt .eml/.msg avec extraction automatique ; il devient important avec le classement séparé des pièces jointes ou un complément Outlook. La question est à reposer à l'utilisateur sous la référence M08, car elle n'a pas de numéro O-xx. Elle touche aussi C15 : les e-mails suivent-ils le cycle maîtrisé ?

<details><summary>Constat dans le code</summary>

Manque constaté dans le code. Le type LET a bien le sous-type « Email formalisé » (src/db/registry.ts:1191-1216). Les métadonnées d'un document externe existent, mais se saisissent à la main : sourceOrg, externalRef et receivedAt dans src/db/schema.ts:155-157, src/lib/actions.ts:100-102 et src/components/dialogs/Dialogs.tsx:250-256. En revanche, rien ne capture un e-mail. Le sélecteur de fichier n'accepte qu'un fichier, sans filtre de format (src/components/dialogs/Modal.tsx:127). Les tables de types de fichier ne connaissent ni .eml ni .msg (EXT_BY_MIME et MIME_BY_EXT, src/lib/storage.ts:142-150) : un e-mail déposé est donc stocké en application/octet-stream et ne s'affiche pas en aperçu, qui ne gère que PDF, images et texte (src/app/documents/[id]/DocClient.tsx:20-22). Aucun code ne lit l'expéditeur, la date ou le Message-ID, ni ne sépare les pièces jointes : une recherche de « eml|msg|rfc822|outlook|mailparser » dans src/ ne trouve rien. Une version de travail ne porte qu'un fichier (src/db/schema.ts:229-247), et aucune table ne relie des documents entre eux (src/db/schema.ts, liste des pgTable ; voir M11). La méthode de capture n'est pas tranchée : M08 est noté « Ouvert » dans docs/audit-deck-epc2i.md:1548, et la question ne figure pas parmi O-01 à O-11 (docs/decisions.md:572-584). Aucune décision de docs/decisions.md n'écarte ce besoin.

</details>

#### 108. Frontière avec les autres outils (Cursus, Sage X3, SolidWorks PDM, modules qualité de Vigie)

- **Effort** : moyen · **Références** : P04, Q06

À demander (P04, Q06) : pour les NC, audits, CAPA et la veille réglementaire (Vigie), les supports de formation (Cursus), les plans (SolidWorks PDM), les commandes et factures (Sage X3), la GED est-elle maître, garde-t-elle une copie figée, ou un lien seulement ?
Selon la réponse :
- un type de fiche « référence externe » (URL et identifiant dans le système maître), validable sans fichier ou sans circuit ;
- ou une API de dépôt pour ces applications, avec un jeton par application et une journalisation ;
- dans les deux cas, le marquage des types concernés dans le registre.

<details><summary>Constat dans le code</summary>

Constaté. requestValidation refuse une révision sans version de travail (src/lib/actions.ts:413, `need_file`). Aucun type ni champ ne décrit une « référence externe » vers un système maître : externalRef sert aux documents d'origine externe (schema.ts:156). La seule API de dépôt est POST /api/import, prévue pour la migration (D-21), avec un jeton unique CODEX_IMPORT_TOKEN. P04 est « Traité en partie » et Q06 « Répondu en partie » (docs/audit-deck-epc2i.md:1656-1658 et 1775-1777) : seuls les ECR/ECO sont tranchés (D-16).

</details>

#### 109. Vigie : envoyer réellement les demandes et suivre leur avancement

- **Effort** : important · **Références** : O-10, T-01, D-16, D-17

Le manque est réel. Aujourd'hui, `submitChange` (src/lib/vigie.ts:24-31) fabrique elle-même la référence ECR et n'écrit que dans la table miroir. Il y a aussi un piège : définir `VIGIE_API_URL` coupe la simulation (actions.ts:592) alors que rien n'est envoyé. Les demandes resteraient alors « Transmise à Vigie » indéfiniment. À faire, une fois le contrat de l'API Vigie connu :
(1) un client HTTP authentifié qui envoie le document, le titre, la révision en vigueur, le type, le propriétaire, le demandeur, le motif et le kind, puis enregistre la référence renvoyée par Vigie ;
(2) une table d'envoi (outbox) écrite dans la transaction de `requestChange` (actions.ts:570), puis un envoi hors transaction avec reprise sur erreur. Codex n'a aujourd'hui aucun mécanisme de tâche de fond, il faut donc aussi créer le déclencheur de reprise ;
(3) les retours d'avancement vers Vigie : révision ouverte par l'ECO, mise en vigueur (ECO réalisé), retrait appliqué ;
(4) ne plus faire dépendre `vigieSimulated()` de la seule présence de la variable ;
(5) vérifier le chemin du lien « Ouvrir dans Vigie » (`/changements/{id}`, vigie.ts:13, construit sur `NEXT_PUBLIC_VIGIE_URL`).
Les étapes ECR/ECO restent dans Vigie (D-16).

<details><summary>Constat dans le code</summary>

Constaté : src/lib/vigie.ts:24-31 (submitChange calcule ECR-AAAA-NNN l.27-28, n'écrit que dans change_requests l.30, l'appel réel n'est qu'un commentaire l.29) ; vigie.ts:17-19 (vigieSimulated = !VIGIE_API_URL) ; src/lib/actions.ts:592 (simulateVigieDecision refusée dès que VIGIE_API_URL est défini) ; actions.ts:570-582 (submitChange appelé dans db.transaction) ; aucun fetch vers Vigie dans src/ (seuls storage.ts:75 et :88 appellent l'extérieur) ; aucun planificateur ni tâche de fond (promoteDue tourne à chaque requête, src/lib/context.ts:50). D-16 : Vigie n'a pas encore de module ECR/ECO ; O-10 ouverte.

</details>

#### 110. Keystone : synchroniser les projets au lieu des tables miroir du seed

- **Effort** : important · **Références** : O-03, T-01, D-04, M15, G44

Le manque est confirmé. Les projets n'existent que par le seed (seed.ts:103). Un nouveau projet Keystone est donc refusé à la création (actions.ts:122) comme à l'import (importer.ts:221). Le libellé « Synchronisé depuis Keystone à … » (page.tsx:255) affiche une date figée. Le chef de projet doit exister dans `users` (schema.ts:106). Lot et work package sont saisis en texte libre (Dialogs.tsx:273, G44).
À faire, selon O-03 :
- un client de l'API projets de Keystone, ou une lecture de la base partagée ;
- une synchronisation périodique ou par webhook entrant (ex. `POST /api/integrations/keystone`) : création, modification et clôture d'un projet, phase, chef de projet, tiers, événements, lots ou WBS ;
- la correspondance des identifiants de personnes ;
- la vérification du chemin « Ouvrir dans Keystone » (`/projects/{code}`, keystone.ts:13).
Remplacer `src/lib/keystone.ts` ne suffit pas, contrairement à ce que dit D-04 : `ctx.projects` (context.ts:59), l'import (importer.ts:85) et `resolveFunction` (actions.ts:381) lisent la table directement.

<details><summary>Constat dans le code</summary>

Constaté : src/lib/keystone.ts:16-38 (lecture des tables locales, synced = projects.syncedAt l.33) ; seules écritures dans projects : src/db/seed.ts:103 (données de src/db/seed-org.ts:105-108, synced figé '2026-10-07 08:40') ; src/lib/context.ts:59 (ctx.projects lit la table) ; src/lib/actions.ts:122 (validateFields → project_required) ; src/lib/importer.ts:85 et 221 (import → project_required) ; src/db/schema.ts:101-110 (manager_id notNull, FK users) ; src/components/dialogs/Dialogs.tsx:272-274 (lot / work package en texte libre). Aucune route /api/integrations/keystone.

</details>

#### 111. Index des documents pour Keystone : événements sortants et API de lecture

- **Effort** : important · **Références** : O-03, T-01, M15

Le manque est confirmé. Codex n'expose que `GET /api/registry`, sans authentification (route.ts:6-7), et n'émet aucun événement.
À écrire, selon O-03 (avec une base partagée, la partie événements pourrait ne plus servir) :
- une table outbox et un émetteur signé avec reprise, pour la création, la nouvelle révision, la mise en vigueur, le remplacement, le retrait, l'archivage et le reclassement (avec l'ancien ID) ;
- et/ou une route `GET /api/projects/{code}/documents` authentifiée pour un client serveur, qui filtre la confidentialité pour qu'aucun document confidentiel ni brouillon ne fuie vers Keystone ;
- un planificateur. Aujourd'hui, une mise en vigueur différée ne se produit qu'à la première requête suivante (context.ts:50), et un événement partirait donc en retard.
Les jetons et le planificateur peuvent être mutualisés avec l'outbox Vigie.

<details><summary>Constat dans le code</summary>

Constaté : src/app/api/ ne contient que registry, import, integrations/vigie, documents/[id]/file, export/audit et export/search ; aucun fetch vers Keystone dans src/ (seuls src/lib/storage.ts:75 et :88 appellent l'extérieur) ; aucun planificateur : promoteDue n'est appelé qu'au début de chaque requête (src/lib/context.ts:50, src/lib/lifecycle.ts:70-87) ; docs/decisions.md:557-559 (la spec Keystone prévoit un index « Real time (webhooks) », O-03 ouverte).

</details>

### Exploitation et déploiement (1)

#### 112. Hébergement et déploiement

- **Effort** : moyen · **Références** : M22, audit §6.6 q3

Qui héberge, qui exploite et où sont les données n'a pas été décidé. Ce choix ne figure pas parmi O-01..O-11 : c'est la question §6.6 q3 de l'audit. Une fois le choix fait : une image (sortie `standalone` de Next), la procédure de déploiement avec migrations, le reverse proxy et TLS, la supervision (journaux, santé) et le plan de reprise. Seule une image générique pourrait être préparée avant.

<details><summary>Constat dans le code</summary>

Vérifié : package.json:8 (`next start --port 3100`) ; ni Dockerfile, ni compose, ni configuration de proxy, de TLS ou de gestionnaire de processus (git ls-files), ni dossier .github. Le seul autre mode d'exécution est l'app Mac (desktop/build-app.sh:62). L'audit laisse la question ouverte : docs/audit-deck-epc2i.md, §6.6 q3 (« Ouvert… qui l'héberge et la maintient n'a pas été dit ») et M22.

</details>

### Référentiels et données (6)

#### 113. Durées de conservation par type à valider

- **Effort** : faible · **Références** : O-07, ACC-06, G39, D-20

L'utilisateur doit valider type par type les durées, déclencheurs et sorts finaux (O-07, points 3 et 6 de docs/registre-points-ouverts.md). Une fois les durées validées, il reste du développement :
- updateType (src/lib/actions.ts:777) ne met à jour que doc_types, alors que chaque document a copié la règle à sa création (actions.ts:191) ou à son changement de type (actions.ts:305). Une durée corrigée ne s'appliquera donc pas aux documents existants : il faut une propagation, au moins proposée à la validation.
- Le fondement (retention_basis) n'est pas modifiable à l'écran (Dialogs.tsx:792-795).
- La destruction réelle n'est pas implémentée (G39).

<details><summary>Constat dans le code</summary>

src/db/registry.ts compte 16 "years": null :
- GOV et PUB sont en permanent/permanent, ce qui est voulu ;
- 14 sont en « durée de vie de l'actif / revue » (MNT, DTF, EXG, FDS, HMI, VAR, LDC, PID, PFD, SCH, GA, LST, BOM, MAN), sans date de fin calculable (src/lib/retention.ts:31).
RSQ fixe 40 ans à partir de la création pour ses 3 sous-types (analyse de risques, rapport d'incident, plan CAPA). RHF fixe « départ du salarié + 5 ans » pour ses 4 sous-types, supports de formation compris. Voir docs/registre-points-ouverts.md:27-28 et O-07 (docs/decisions.md:580).

</details>

#### 114. Matrice type → circuit et titulaires des fonctions définitifs

- **Effort** : faible · **Références** : O-06, D-15, WFL-02, M01

C'est surtout une saisie de données après validation de l'utilisateur (O-06), à faire dans Administration › Registre et Fonctions & circuits. Il faudra du développement seulement dans deux cas :
- le RACI introduit de nouvelles fonctions : aucune action ne crée de fonction, la table functions n'est remplie que par le seed (seed.ts:101) ;
- le RACI introduit un titulaire par site : les portées sont limitées à global, department, project et research (src/db/schema.ts:86).
La règle d'exclusion de l'auteur et du demandeur reste une proposition à confirmer (O-09).

<details><summary>Constat dans le code</summary>

Le mécanisme est en place. Le circuit est porté par le type et modifiable dans l'administration (updateType, src/lib/actions.ts:766 et 777 ; TypeEditor, Dialogs.tsx:735-767). Les titulaires s'ajoutent et se retirent (addFunctionHolder et removeFunctionHolder, actions.ts:732-756). Les valeurs sont de démonstration : FUNCTIONS et HOLDERS (src/db/seed-org.ts:62-103) et circuit (src/db/registry.ts). LET, RFQ et PHO ont un circuit vide. Aucun RACI n'a été fourni (M01, docs/audit-deck-epc2i.md:1502-1506 ; O-06).

</details>

#### 115. Types admettant « Public » et type « communication » absent

- **Effort** : faible · **Références** : O-08, D-13, MET-09, G31

Il faut que l'utilisateur dise quels types ou quelles familles admettent « Public ». Il parle de « familles », le registre applique la règle type par type. Ensuite :
- ajuster confAllowed : c'est possible sans développement dans Administration › Registre (TypeEditor, Dialogs.tsx:770-777) ;
- ajouter éventuellement un type ou une famille « communication ». Cela demande la création de type dans l'administration (absente) ou une modification de registry.ts suivie d'une réinitialisation de la base.
Si la règle doit porter sur la famille, il faudra aussi un contrôle par famille.

<details><summary>Constat dans le code</summary>

Dans src/db/registry.ts, seuls POL, REG, DTF, PUB et COL ont « public » dans confAllowed. Aucun type ni aucune famille ne porte sur la communication ; seul le département CMN « Communication » existe (src/db/seed-org.ts:20). Voir D-13 (docs/decisions.md:250-251) et O-08.

</details>

#### 116. Recueil des besoins par département

- **Effort** : moyen · **Références** : O-04, G12, MIG-05, FON-06

Le recueil lui-même n'est pas du développement : il revient aux départements, une fois la liste fixée par l'organigramme (O-04). Il conditionne ce qui reste à développer pour G12/FON-06 :
- des pages ou vues par département (aujourd'hui, seul l'axe Département de l'explorateur existe) ;
- des recherches enregistrées créables et administrables (fait le 11 octobre 2026, point 2 : recherches personnelles, de département et de groupe) ;
- les filtres et types suivis propres à chaque département.
Les deux premiers éléments peuvent se coder dès maintenant sur la liste provisoire ; leur contenu attend le recueil.

<details><summary>Constat dans le code</summary>

Point confirmé. Le recueil prévu par la slide 9 (MIG-05) n'est pas fait (docs/audit-deck-epc2i.md:699 et 1080). La liste des départements est provisoire (src/db/seed-org.ts:6-22, D-19, O-04). Côté code, il n'y a aucune page par département : src/app ne contient que administration, archivage, documents, explorateur, recherche et validations. Les recherches enregistrées sont les 3 du seed (src/db/seed-org.ts:127-131, insérées par src/db/seed.ts:106) ; elles sont en lecture seule (listSavedSearches, src/lib/queries.ts:281-285) et aucune action ne permet d'en créer. La table saved_searches n'a ni département ni propriétaire (src/db/schema.ts:339-345).

</details>

#### 117. Organigramme définitif : sociétés, sites, départements, personnes

- **Effort** : moyen · **Références** : O-04, O-02, D-19, MET-03, MET-04

Il faut attendre l'organigramme de l'utilisateur (O-04). Ensuite :
- remplacer départements, sites et personnes, par l'administration ou par le script du point « Appliquer les évolutions du registre » ;
- figer les codes de département avant la production.
Il reste du développement :
- un axe ou une table « société » si l'organigramme distingue plusieurs entités juridiques, ce que O-04 mentionne et que le modèle n'a pas ;
- une gestion des personnes (création, rattachement à un département et à un site, rôle), sauf si l'authentification (O-02) les provisionne.
À noter : 4 codes de type entrent en collision avec des codes de département (FIN, JUR, COM, HSE). C'est le point 1 de O-05, à trancher en même temps que les codes définitifs.

<details><summary>Constat dans le code</summary>

src/db/seed-org.ts contient des valeurs provisoires : DEPARTMENTS (l.6-22, 15 codes), SITES (l.24-28) et USERS (l.31-60) (D-19, docs/decisions.md:329-338 ; O-04, l.577). Le schéma n'a aucune notion de société (aucune table ni colonne ; grep sur société/entity vide dans src/db/schema.ts). Les personnes ne sont insérées que par le seed (src/db/seed.ts:89), et aucune action ne crée ni ne modifie un utilisateur. Le code de département entre dans les ID sans rattachement (D-10).

</details>

#### 118. Appliquer les arbitrages du registre des types

- **Effort** : moyen · **Références** : O-05

Il faut les réponses de l'utilisateur aux 9 questions et aux choix de fusion. Ensuite :
- modifier src/db/registry.ts ;
- faire passer les changements dans les bases existantes (script d'upsert ou administration complète du registre, voir ces points), puisque registry.ts n'est lu que par le seed.
Un renommage de code de type (collisions FIN, JUR, COM, HSE ; doublons FIN/ADC, GOV/PIL, COM/RFQ) doit se faire avant la production : documents.type_code est une clé étrangère (src/db/schema.ts:131) et l'ID d'un document ne change plus après la première approbation (D-10, D-11). Les questions de durée (points 3 et 6) relèvent aussi de O-07, et l'étape chef de projet hors projet (point 2) de O-06.

<details><summary>Constat dans le code</summary>

docs/registre-points-ouverts.md:7-32 liste 5 choix de fusion et 9 questions encore ouverts (O-05, docs/decisions.md:578). Vérification dans src/db/registry.ts : les codes de type FIN, JUR, COM et HSE sont aussi des codes de département (seed-org.ts:6-22). JUR manque dans la liste du point 1. MIN, PO, HSE et VIS admettent « sans rattachement » avec une étape chef_projet. LET, RFQ et PHO n'ont pas de circuit.

</details>

## Attend des données de l'utilisateur (2)

Il faut des contenus ou des règles réels d'EPC2I.

### Référentiels et données (2)

#### 119. Charger les vrais modèles EPC2I (FRM-QMS)

- **Effort** : faible · **Références** : PAR-05, G06, A22

Il n'y a rien à développer. Le dépôt passe déjà par Administration › Modèles (bouton « Nouveau modèle », src/app/administration/page.tsx:58) ou par POST /api/import. Il manque la liste et les fichiers Word/Excel des modèles du lancement, à fournir par l'utilisateur. Les 4 modèles fictifs seront ensuite à retirer de la démonstration. Le préremplissage de l'en-tête des fichiers (ID, révision), évoqué dans A22, n'est pas demandé.

<details><summary>Constat dans le code</summary>

Les 4 modèles FRM du jeu de démonstration (src/db/seed-docs.ts:67-70) reçoivent des versions de travail sans fichier : seed.ts:177-181 n'écrit aucun fileKey. isUsableTemplate (src/lib/access.ts:89-91) ne demande pas de fichier, et createDocument crée alors A.1 sans contenu (src/lib/actions.ts:168-175 et 194-196). A22 indique que la liste des modèles du lancement reste à fournir (docs/audit-deck-epc2i.md:1404).

</details>

#### 120. Conservation « clôture de l'exercice » fixée au 31 décembre

- **Effort** : faible · **Références** : O-07, O-04, G39

À faire :
- une date de clôture paramétrable (globale aujourd'hui, par société quand l'organigramme en distinguera plusieurs), lue par triggerDate et modifiable dans Administration ;
- vérifier la date de départ : aujourd'hui, la première mise en vigueur (issuedAt) ; faut-il plutôt la date de la pièce ?
Si toutes les sociétés clôturent au 31 décembre, le calcul actuel est juste et seul le paramétrage manque. La date de clôture est à fournir par l'utilisateur.

<details><summary>Constat dans le code</summary>

Constaté. Pour `fiscal_year_end`, triggerDate renvoie toujours `${année}-12-31` de issuedAt, à défaut createdAt (src/lib/retention.ts:21-24). Aucune date de clôture n'est paramétrable, ni par société ni globalement. Trois types du registre utilisent ce déclencheur : FIN, COM et PO (src/db/registry.ts:720, 1276, 2044). Les durées sont provisoires (O-07) et l'organigramme des sociétés est attendu (O-04).

</details>

## Demande une session sur macOS (9)

L'app Mac ne se construit que sous macOS (T-02).

### App Mac (9)

#### 121. App Mac : le message « Compilation de Codex… » ne s'affiche pas

- **Effort** : faible · **Références** : T-02

Il faut que le texte de statut arrive sur une page déjà chargée. Deux solutions possibles. (1) Mémoriser le dernier texte demandé dans une propriété (`pendingStatus`) et l'appliquer dans `webView(_:didFinish:)` quand l'URL n'est pas http. (2) Plus simple : faire appeler `showStatus(text)` par `status()` sur le fil principal, ce qui recharge la page de statut avec le bon texte au lieu de passer par `evaluateJavaScript`. À vérifier sur macOS en forçant une recompilation (toucher un fichier de `src/`).

<details><summary>Constat dans le code</summary>

desktop/CodexApp.swift:48-49 : `showStatus("Démarrage de Codex…")` appelle `loadHTMLString` (l. 203), qui est asynchrone, puis `start()` démarre aussitôt sur une file d'arrière-plan. Ligne 75, `status(...)` lance `evaluateJavaScript` sur le fil principal (l. 206-211). La garde `document.getElementById('s') &&` rend l'appel muet tant que la page de statut n'est pas chargée. Le message reste donc « Démarrage de Codex… ». On ne trouve aucune attente de `didFinish` : l. 251-253 ne fait que journaliser. La même course touche « Démarrage du serveur… » (l. 79) et le chemin « Réessayer » (l. 232). Noté dans docs/avancement-v2.md:55.

</details>

#### 122. App Mac : quitter pendant la compilation laisse `next build` tourner

- **Effort** : faible · **Références** : T-02

Ajouter une propriété `private var build: Process?`. `run()` (ou le bloc des l. 74-78) l'utilise, puis la remet à nil quand le build est terminé. Dans `stopServer()`, ou dans `applicationWillTerminate`, appeler `build.terminate()` sur ce processus, avec un délai suivi d'un SIGKILL comme pour le serveur (l. 172-180). En complément, `start()` doit sortir sans appeler `fail()` si l'app est en train de quitter. Autre solution : lancer le build derrière le même garde-fou `/bin/sh` que le serveur, qui surveille `CODEX_APP_PID`. Le build interrompu laisse un `.next/` incomplet. Il faut donc vérifier que `needsBuild()` relance bien la compilation au démarrage suivant (sinon, supprimer `.next/BUILD_ID` avant de compiler).

<details><summary>Constat dans le code</summary>

desktop/CodexApp.swift:76 lance `run(["node_modules/next/dist/bin/next", "build"], wait: true)`. `run()` (l. 131-137) crée un `Process` local `p` qui n'est gardé nulle part. `applicationWillTerminate` (l. 54) appelle `stopServer()`, dont la garde (l. 170) ne regarde que `server`, encore nil pendant la compilation. Le build n'a pas non plus le garde-fou shell de `launchServer` (l. 111-119), qui surveille `CODEX_APP_PID`. macOS ne tue pas les processus enfants quand le parent se termine : `next build` continue donc d'écrire dans `.next/`. Noté dans docs/avancement-v2.md:56.

</details>

#### 123. App Mac : needsBuild() ignore `.env*` et `tsconfig.json`

- **Effort** : faible · **Références** : T-02

Ajouter `tsconfig.json` à la liste des fichiers de la l. 150. Ajouter aussi les fichiers `.env*` à la racine du projet : énumérer `projectDir` au premier niveau et retenir les noms qui commencent par `.env`, `.env.example` inclus ou non. `next.config.ts` y figure déjà. Facultatif : `drizzle.config.ts`, qui ne change pas la build. À vérifier sur macOS : modifier `NEXT_PUBLIC_KEYSTONE_URL` dans `.env.local`, puis rouvrir l'app.

<details><summary>Constat dans le code</summary>

desktop/CodexApp.swift:144-152 : seuls les dossiers `src` et `drizzle` et les fichiers `package.json`, `next.config.ts` et `package-lock.json` sont comparés à la date de `.next/BUILD_ID`. Les fichiers `tsconfig.json` (chemins `@/`) et `.env*` sont absents. Ce manque compte : `NEXT_PUBLIC_KEYSTONE_URL` et `NEXT_PUBLIC_VIGIE_URL`, lus dans `src`, sont inlinés à la compilation. Modifier `.env.local` ou `.env.production` sans recompiler laisse donc les anciennes URL dans les pages. Le dépôt n'a ni `public/` ni configuration PostCSS à surveiller. Noté dans docs/avancement-v2.md:57.

</details>

#### 124. App Mac : un téléchargement (erreur WebKit 102) est pris pour une panne

- **Effort** : faible · **Références** : T-02

Dans `didFailProvisionalNavigation`, il faut ignorer deux erreurs : `NSURLErrorCancelled`, et le code 102 du domaine `WKErrorDomain`/`WebKitErrorDomain` (frame load interrupted). Il faut aussi remplacer le test `server?.isRunning != true` par un `ping()` lancé hors du fil principal, qui ne vaut que si le serveur ne répond vraiment pas. Ce test couvre le cas d'un serveur 3110 lancé par une autre instance ou à la main. À vérifier sur macOS avec un serveur déjà lancé sur 3110 : télécharger un fichier depuis l'explorateur, puis faire un export CSV.

<details><summary>Constat dans le code</summary>

desktop/CodexApp.swift:60 : si `ping()` répond, `start()` charge la page sans jamais créer `server`. Les l. 245-248 font passer en `.download` toute réponse `Content-Disposition: attachment`. C'est le cas de `/api/documents/[id]/file?download=1` (src/app/api/documents/[id]/file/route.ts:80, bouton de src/app/explorateur/page.tsx:229) et des exports CSV. WebKit termine alors la navigation provisoire avec l'erreur WebKitErrorDomain 102 (frame load interrupted by policy change). Or `didFailProvisionalNavigation` (l. 255-258) n'écarte que `NSURLErrorCancelled` (-999), sans tester le domaine d'erreur. Comme `server?.isRunning != true` quand `server` vaut nil, l'app affiche « Le serveur Codex ne répond plus. » à la place de la page en cours. Noté dans docs/avancement-v2.md:57.

</details>

#### 125. App Mac : démarrages en parallèle (⇧⌘H, « Réessayer »)

- **Effort** : faible · **Références** : T-02

Ajouter un indicateur `starting` (lu et écrit sur le fil principal). `start()` ne fait rien s'il est déjà vrai, le met à vrai, puis le remet à faux à chaque sortie : chargement réussi ou `fail()`. Tant que `starting` est vrai, `goHome()` ne fait rien, de même que `codex://retry`. Il faut aussi désactiver « Accueil » dans `validateMenuItem`. `didFailProvisionalNavigation` ne doit pas non plus appeler `fail()` pendant un démarrage. À vérifier sur macOS : appuyer sur ⇧⌘H pendant la compilation, puis cliquer « Réessayer ».

<details><summary>Constat dans le code</summary>

desktop/CodexApp.swift:230-232 : `codex://retry` exécute `stopServer(); showStatus(...); start()` sans aucune garde. `goHome()` (l. 378, raccourci ⇧⌘H de la l. 357) charge `baseURL` sans condition, alors que `reload()` (l. 377) se limite aux pages http. Pendant la compilation, `server` vaut nil, si bien qu'un ⇧⌘H échoue (connexion refusée). Sur cet échec, `didFailProvisionalNavigation` (l. 257) affiche la page d'erreur et son bouton « Réessayer ». Ce bouton lance un second `start()` pendant que le premier est encore dans `next build` (l. 76) : deux compilations écrivent alors dans le même `.next/`. Autre conséquence : `server` est réaffecté (l. 80) pendant que la boucle de la l. 84 du premier démarrage le lit. Noté dans docs/avancement-v2.md:58.

</details>

#### 126. App Mac : pas d'élément « Fermer » ⌘W

- **Effort** : faible · **Références** : T-02

Ajouter `item("Fermer", #selector(NSWindow.performClose(_:)), "w")` au menu Fenêtre, ou à un menu « Fichier ». Comme `applicationShouldTerminateAfterLastWindowClosed` renvoie true (l. 52), ⌘W quittera l'app et arrêtera le serveur. C'est le comportement voulu, à vérifier sur macOS. On peut ajouter au passage « Placer tout au premier plan » (`arrangeInFront`) et `NSApp.windowsMenu = …` pour un menu Fenêtre standard.

<details><summary>Constat dans le code</summary>

desktop/CodexApp.swift:370-373 : le menu Fenêtre ne contient que « Placer dans le Dock » (`performMiniaturize`, ⌘M) et « Réduire / agrandir » (`performZoom`). Aucun autre menu de `buildMenu()` (l. 328-375) n'a d'élément `performClose` ni de raccourci « w ». La fenêtre peut être fermée (`.closable`, l. 37), mais seulement avec le bouton rouge : avec un menu construit à la main, ⌘W ne fait rien. Noté dans docs/avancement-v2.md:59.

</details>

#### 127. App Mac : copie de l'app laissée dans desktop/dist

- **Effort** : faible · **Références** : T-02

Remplacer la l. 23 par `OUT="$TMP/Codex.app"` : le bundle est construit dans le dossier temporaire et le `trap` le supprime après l'installation. Pour les copies laissées par les constructions précédentes, la machine de l'utilisateur garde `desktop/dist/Codex.app`. Ajouter `if [[ -d desktop/dist/Codex.app ]] && ours desktop/dist/Codex.app; then rm -rf desktop/dist; fi`. Ajouter éventuellement `lsregister -u` sur l'ancien chemin. Il faut aussi vérifier que `codesign` (l. 65-66) fonctionne dans `$TMPDIR`, ce qui devrait être le cas puisque ce dossier n'est pas synchronisé par iCloud.

<details><summary>Constat dans le code</summary>

desktop/build-app.sh:23 construit le bundle dans `OUT="desktop/dist/Codex.app"`. Il est copié par `ditto` vers `~/Applications` (l. 70), puis laissé sur place : le `trap` de la l. 25 ne supprime que `$TMP`. Un dossier temporaire existe pourtant déjà (`TMP="$(mktemp -d)"`, l. 24). `.gitignore` exclut `/desktop/dist` du dépôt, mais pas de Spotlight ni de Launch Services : deux « Codex.app » de même identifiant `com.epc2i.codex` coexistent. Noté dans docs/avancement-v2.md:60.

</details>

#### 128. App Mac : reconstruire, puis tester le dépôt et le téléchargement dans la fenêtre

- **Effort** : faible · **Références** : T-02

Ce point est à faire après les 8 corrections ci-dessus, pour ne reconstruire qu'une fois. Sur macOS, quitter Codex, lancer `npm run app`, puis ouvrir l'app. Dans la fenêtre, tester trois choses. (1) Créer un document depuis un fichier, puis déposer une version de travail : la feuille NSOpenPanel doit s'ouvrir et le fichier arriver. (2) Télécharger un fichier depuis l'explorateur (`?download=1`) et faire un export CSV : le fichier doit arriver dans Téléchargements, sans page « Le serveur Codex ne répond plus ». (3) Ouvrir la prévisualisation d'un PDF en ligne. Le test du dépôt et du téléchargement revient à l'utilisateur ; tant qu'il n'est pas fait, T-02 reste ouvert dans docs/decisions.md.

<details><summary>Constat dans le code</summary>

Le code nécessaire existe. L'ouverture de fichier passe par `runOpenPanelWith` (desktop/CodexApp.swift:297-303, champ `<input type="file">` de src/components/dialogs/Modal.tsx:127). Les téléchargements passent par `decidePolicyFor response` → `.download` (l. 245-248) et `WKDownloadDelegate` (l. 271-293). Rien n'a été testé dans la fenêtre : docs/historique.md:356-358 note le dépôt et le téléchargement comme non vérifiés, et docs/historique.md:377-378 indique que `npm run app` n'a pas été relancé depuis les corrections du 8 octobre. docs/decisions.md:434 et :591 (T-02) attendent toujours le retour de l'utilisateur, et docs/avancement-v2.md:41-42 le confirme. Le test dans le navigateur est fait (`PRO-HSE-0003`, `PRO-QUA-0003`). Ce test ne peut se faire que sur macOS.

</details>

#### 129. App Mac : signature ad hoc, accès à Téléchargements redemandé à chaque reconstruction

- **Effort** : moyen · **Références** : T-02

Option 1 : signer avec une identité stable, choisie par une variable (`CODEX_SIGN_IDENTITY`). Ce peut être un certificat de signature de code auto-signé, créé une fois dans le Trousseau (Assistant de certification), ou un Developer ID si l'utilisateur en a un. Si l'identité est absente, le script revient à la signature ad hoc. Aucun certificat ni aucune clé ne doit entrer dans le dépôt : `.gitignore` exclut déjà `*.p12` et `*.cer`. Option 2, à envisager en complément : demander l'emplacement de téléchargement par `NSSavePanel`, dont le choix par l'utilisateur vaut autorisation, au lieu d'écrire en silence dans `~/Downloads`. Le certificat doit être créé par l'utilisateur sur son Mac.

<details><summary>Constat dans le code</summary>

desktop/build-app.sh:65 signe en ad hoc (`codesign --force --deep --sign -`). L'exigence désignée d'une signature ad hoc est le cdhash du binaire, qui change à chaque compilation Swift (l. 30). TCC prend donc chaque reconstruction pour une nouvelle app. Or l'app écrit directement dans `~/Downloads` sans demander l'emplacement (desktop/CodexApp.swift:271-281, `.downloadsDirectory`) : macOS repose donc la question de l'accès à Téléchargements après chaque `npm run app`. Noté dans docs/avancement-v2.md:61.

</details>

## Annexe

### Corrigé le 9 octobre pendant l'inventaire

- **Reclassement : le fichier renommé perd son extension (SharePoint)**. Constaté : src/lib/storage.ts:236 (select sans file_name ni mime), 242 (ext = path.extname(r.fileKey)), 103 et 110 (avec SharePoint, la clé est l'id du driveItem, sans extension), 48 (en local, clé `uuid-{ID}_{lettre}.{n}{ext}`), 197 (ext vide pour un fichier sans extension et de type inconnu) ; src/app/api/documents/[id]/file/route.ts:71 (bonne méthode : extension tirée de file_name, sinon de EXT
- **`npm run typecheck` échoue sur un clone neuf**. Constaté sur un clone neuf de 44bd1b8, fait dans le scratchpad. `tsc --noEmit` y donne 9 erreurs TS2304 : PageProps, LayoutProps et RouteContext sont introuvables (administration/page.tsx:21, archivage/page.tsx:15, documents/[id]/page.tsx:57, explorateur/page.tsx:59, recherche/page.tsx:10, validations/page.tsx:24, layout.tsx:21, api/documents/[id]/file/route.ts:87 et :120). Après `npx next typegen

### Point écarté par la vérification

- **Nom affiché « Codex — GED Groupe » au lieu de « GED EPC2I »** : Ce n'est pas un manque de développement. ACC-01 et G11 portent sur un point d'accès unique, et l'audit les classe « couvert » puis « intégré » (docs/audit-deck-epc2i.md:547 et 684-690). docs/decisions.md:474 l'acte : « Codex est l'application « GED EPC2I » (D-06) ». Le nom affiché reprend fidèlement la maquette, qui montre elle-même « Codex » et brand_sub « GED Groupe » (design/GED Groupe.dc.html:24 et 569). Les conventions imposent cette fidélité. L'utilisateur n'a jamais demandé de renommage, et la question ne fait pas partie des questions ouvertes O-01 à O-11 de docs/decisions.md.
