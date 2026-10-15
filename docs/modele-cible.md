# Codex — modèle cible (GED EPC2I)

Synthèse du deck « Création de la GED EPC2I », de la spec Keystone (`Keystone/docs/spec/10-site-docs-mywork-settings.md` §4-5)
et des arbitrages du 7 octobre 2026. Ce document fait foi pour l'implémentation ; les points marqués *provisoire* seront revus.

Certaines règles ci-dessous sont des propositions de l'assistant, implémentées mais **non confirmées par l'utilisateur** :
authentification Entra ID (§1), code département hors rattachement, largeur et portée du compteur, ID attribué au
brouillon, alias et nom de fichier (§3), « Remplacé », mise en vigueur automatique, bandeau et nom de téléchargement
d'un document obsolète ou archivé, liens « remplace » / « remplacé par » et « voir aussi » (§4), partage des recherches enregistrées et pages par département (§5), longueur du
motif de rejet, droit de rappeler une demande de validation et fiche de visa (§6), lecture stricte de la cohérence des dates,
indicateurs d'expiration et de revue, « Revue effectuée » et périodicité de revue par type, détection des
modifications simultanées (§4, §7).
Elles sont listées dans `docs/decisions.md` (« Choix de l'assistant non validés explicitement », question O-09), qui
prévaut en cas de doute.

## 1. Architecture

- **Codex est la source de vérité** : métadonnées, droits, révisions, workflows de validation, journal d'audit.
- **Stockage des fichiers** derrière une interface unique : disque local (par défaut, développement) ; bibliothèque
  SharePoint pilotée par Codex en option (seuls le fichier, son nom et sa révision y sont stockés). *Provisoire* : un
  fichier par version de travail, aucun accès direct des utilisateurs à la bibliothèque.
- Pas de Power Automate ni de Power Apps.
- **Vigie** gère les ECR/ECO et les demandes de passage à l'état obsolète. Les demandes sont créées depuis Codex
  (documents) ou depuis Keystone (sujets projet) ; Vigie renvoie ses décisions à Codex.
- **Keystone** fournit les projets (code, chef de projet, phase) et lit le registre des types de Codex.
- **Migration** : outil séparé, hors de Codex ; Codex expose une API d'import.
- Authentification : simulée ; fournisseur réel à choisir (Entra ID proposé, non confirmé — `docs/decisions.md` O-02).

## 2. Classement

Deux axes indépendants remplacent le « Domaine » du deck :

| Axe | Valeurs |
|---|---|
| Origine | Interne · Externe |
| Rattachement | Aucun · Projet (code projet Keystone) · Recherche (programme) |

Puis : **Famille** (catégorie du deck) › **Type** (porte un code) › **Sous-type** (facultatif). Plus : **Département /
Fonction** (obligatoire) et **Site** (facultatif) — valeurs *provisoires* jusqu'à l'organigramme.

Le **registre des types** fusionne les 45 types du deck et les 28 types de Keystone. Chaque type porte : code, libellés
FR/EN, famille, origines et rattachements admis, sous-types, circuit de validation, règle de conservation, niveaux de
confidentialité admis et par défaut, clause ISO 9001, livrable client. Codex est propriétaire du registre ; Keystone le lit.
Le registre (types, familles, fonctions) et les programmes de recherche s'administrent dans Codex : une entrée utilisée
garde son code et ne se supprime pas (un type ou un programme se désactive), et aucun nouveau code ne reprend celui d'un
autre segment d'identifiant (*proposé, non confirmé*, `docs/decisions.md`).

## 3. Identifiant : `TYPE-CONTEXTE-SEQ`

| Cas | CONTEXTE | SEQ | Exemple |
|---|---|---|---|
| Rattaché à un projet | code projet Keystone | 3 chiffres | `PID-HLT-026-001` |
| Rattaché à un programme de recherche | code programme | 3 chiffres | `PRT-R2601-004` |
| Modèle de document (template) | `QMS` | 3 chiffres | `FRM-QMS-012` |
| Sans rattachement | code du département propriétaire | 4 chiffres | `PRO-QUA-0012` |

Compteur par couple (type, contexte). ID attribué à la création du brouillon. Avant la première approbation, un
reclassement attribue un nouvel ID et conserve l'ancien comme alias ; après, l'ID ne change plus jamais.
Fichier stocké : `{ID}_{indice}.{ext}` (ex. `PRO-QHS-0012_B.2.pdf`).

## 4. Révisions et cycle de vie

- Révisions en lettres (A, B, … Z, AA…), **versions de travail** `A.1`, `A.2`… pendant la rédaction.
  Les dialogues de dépôt et de demande de validation renvoient la dernière version de travail qu'ils ont montrée : si
  une autre a été déposée depuis, le dépôt ou la demande est refusé avec son numéro et son auteur (« rechargez la
  fiche »), sans rien enregistrer ; un circuit ne part pas sur une version que le demandeur n'a pas vue. Le brouillon
  n'est pas réservé pendant la rédaction (réservation proposée, à confirmer). *Proposé, non confirmé*
  (`docs/decisions.md`).
- Une révision garde l'ID et le nom du document. Toute révision passe par un circuit de validation.
- Statuts de révision : **Brouillon** → **En révision** (circuit lancé) → **Approuvé** → **En vigueur** (à la date
  d'effet, ou immédiatement sans date) ; la révision précédente passe **Remplacé**.
- Statuts de document : **Obsolète** (retrait décidé dans Vigie) et **Archivé** (fin de vie active, conservation).
  Un document obsolète ou archivé reste consultable et téléchargeable par les mêmes lecteurs qu'avant (A13 et P07 non
  tranchés), mais il est signalé : un bandeau au-dessus de l'aperçu de la fiche, et en plus court dans l'aperçu rapide
  de l'explorateur, indique « Obsolète depuis le {date} ({ECO du retrait, sinon ECR}) — ne plus appliquer » ou
  « Archivé le {date} » (les deux pour un document retiré puis archivé) ; le fichier servi ou téléchargé est proposé
  sous `{ID}_{indice}_OBSOLETE.{ext}` ou `{ID}_{indice}_ARCHIVE.{ext}`. Son contenu et son nom de stockage (§3) ne
  changent pas. Les filtres par défaut et l'absence de filigrane (M12) restent inchangés. *Proposé, non confirmé.*
- Modifier un document en vigueur : demande ECR depuis Codex → décision dans Vigie → ECO accepté → Codex ouvre la
  révision suivante en brouillon, attribuée au modificateur désigné. Celui-ci doit pouvoir rédiger le document (droit
  de dépôt de son rôle, accès au document), sinon la décision est refusée ; s'il perd ce droit pendant qu'une
  acceptation attend la levée d'un verrou, la révision s'ouvre pour le modificateur par défaut et le journal le note,
  même si ce dernier ne peut pas rédiger non plus (*proposé, non confirmé*).
- Modification acceptée alors qu'une révision est déjà ouverte (D-26) : elle n'ouvre pas de seconde révision. Par
  défaut elle **attend** (demande **Acceptée**) et ouvre la révision suivante une fois la révision ouverte mise en
  vigueur ou annulée ; ou bien elle est **greffée** sur la révision ouverte, qui porte alors aussi sa référence ECO
  (demande **Appliquée**). La greffe se fait par un gestionnaire documentaire ou par le modificateur de la révision
  ouverte (à défaut le propriétaire), et seulement tant que celle-ci est en rédaction et le document non verrouillé.
  Une demande de modification peut être faite pendant qu'une révision est ouverte. Un verrou s'ajoute à l'attente
  (*interprétations proposées, non confirmées*, `docs/decisions.md`).
- Verrous : un document archivé, obsolète ou sous gel juridique ne change plus (ni version de travail, ni décision de
  circuit, ni mise en vigueur d'une révision approuvée). Une acceptation Vigie reçue pendant le verrou est enregistrée
  (demande **Acceptée**, avec ECO, modificateur et note) et s'applique à sa levée : levée du gel ou restauration de
  l'archive (*proposé, non confirmé*) ; un refus Vigie s'applique aussitôt. Un retrait accepté clôt le travail en
  cours : circuit clos, révisions ouvertes **Annulées**. Une restauration d'archive rend au
  document son état d'avant (obsolète s'il avait été retiré). La date d'effet est aujourd'hui ou plus tard ; une
  révision approuvée après sa date d'effet prend effet le jour de sa mise en vigueur.
- **Liens entre documents** (`document_links`, `src/lib/links.ts`). Une révision remplace la précédente sous le même ID
  (D-11) ; un document qui en remplace un autre, d'un autre ID, lui est lié. Deux natures : **remplace** (lue
  « remplacé par » depuis l'autre document) et **voir aussi**. Un seul lien par paire de documents, quel qu'en soit le
  sens, jamais vers soi-même ; les deux bouts suivent un reclassement. Les liens se créent :
  - à la **demande de retrait** : le demandeur peut proposer un document de remplacement (facultatif), actif et qu'il
    peut lire ; Codex le garde sur la demande (`change_requests.replacement_id`) et, quand le retrait accepté par Vigie
    s'applique, le document retiré devient « remplacé par » lui (au nom de Vigie, avec l'ECO). Un lien « voir aussi »
    entre les deux devient « remplace » ; un refus ne lie rien. Le remplaçant est revérifié à ce moment : s'il n'est
    plus actif, si l'un des deux documents est sous gel juridique ou si un « remplace » existe en sens inverse, aucun
    lien n'est créé ni modifié, et le journal du document retiré l'indique (« Remplacement non appliqué ») ;
  - depuis la **fiche** (onglet Fiche, section « Documents liés ») : ajout ou retrait d'un lien par qui a les droits
    sur les deux documents (leur propriétaire, ou un gestionnaire documentaire), avec le droit « Modifier », sur des
    documents qu'il peut lire. Seul un document déjà retiré par Vigie (obsolète, archivé ensuite ou non) peut être
    « remplacé », et par un document actif : pour un document en vigueur, on passe par la demande de retrait (D-17).
    Un gel juridique, sur l'un ou l'autre document, fige leurs liens, à l'ajout comme au retrait ; un document
    obsolète ou archivé en reçoit encore, puisqu'ils disent à ses lecteurs où aller.
  Chaque ajout ou retrait est journalisé sur les deux documents (« Lien ajouté », « Lien retiré »). La fiche affiche
  les liens ; le bandeau d'un document obsolète, et celui de l'aperçu rapide, ajoutent « Remplacé par {ID} ». Un
  document lié que le lecteur ne peut pas lire n'apparaît pas, ni l'entrée du journal qui le nomme, ni le
  remplacement proposé d'une demande : un brouillon jamais en vigueur reste dans son cercle de rédaction (D-14).
  Les autres relations (référence, annexe, enregistrement issu d'une procédure, documents touchés par une ECR) et leur
  caractère obligatoire restent une question de l'audit (M11). *Proposé, non confirmé* (`docs/decisions.md`).

## 5. Confidentialité et visibilité

Du moins au plus protégé : **Public** (réservé à certains types) < **Restreint** (diffusable au client ou partenaire
externe désigné ; minimum pour tout document non public) < **Interne** < **Confidentiel** (département ou équipe projet)
< **Très confidentiel** (personnes désignées).

Brouillons et versions de travail visibles par : le propriétaire, le modificateur désigné, les valideurs du circuit en
cours et les gestionnaires documentaires. Le modificateur désigné par un ECO accepté qui attend la révision ouverte
(D-26) en fait partie : il voit la révision ouverte, mais n'y dépose pas de version de travail et ne la soumet pas au
circuit, puisqu'il rédigera la suivante (*proposé, non confirmé*). Hors de ce cercle, un lecteur n'obtient que le fichier final de la révision
en vigueur, et ne voit que les révisions en vigueur et remplacées. Une révision en rédaction, en revue, approuvée en
attente de sa date d'effet, ou annulée n'existe pas pour lui, ni rien de ce qui s'y rapporte :
- l'étiquette « en cours » et le libellé de travail (« B.2 ») sur la fiche, dans l'explorateur, la recherche et
  l'export CSV ;
- le modificateur désigné et la référence ECO de cette révision, y compris ceux d'une modification greffée sur elle
  ou qui attend pour ouvrir la suivante (D-26) ; une modification greffée reste affichée « Acceptée », comme avant la
  greffe, tant que la révision est ouverte, et « Appliquée » si elle est annulée ; sous un verrou, la fiche dit qu'une
  modification acceptée « ne s'appliquera pas avant » la levée du verrou, jamais qu'elle s'appliquera à ce moment-là ;
- ses circuits, en cours ou terminés, avec leurs commentaires. Un valideur sort du cercle quand le circuit se termine :
  s'il ne voit pas la révision, le circuit disparaît de son écran Validations, et un commentaire lui est refusé ;
- les entrées du journal qui la concernent. Chaque entrée porte la révision dont elle parle (`audit_log.revision_id`)
  et suit son statut : elle apparaît quand la révision entre en vigueur. Une entrée sans révision concerne le document
  entier (métadonnées, lecteurs, demandes, retrait, gel, archivage) et reste visible ; une action propre à une
  révision (dépôt, demande de validation, visa, commentaire de circuit…) dont la révision est inconnue reste masquée.
  Cette règle vaut pour l'historique de la fiche, l'activité de l'accueil, les notifications, l'onglet Journal et son
  export CSV ;
- la date de modification due au travail en cours : la fiche et les listes datent le document de son dernier
  changement visible (mise en vigueur, ou modification de la fiche elle-même).

Les lecteurs désignés s'ajoutent au département ou à l'équipe projet d'un document confidentiel et sont les
seuls lecteurs d'un document très confidentiel ; en dessous de « Confidentiel », ils n'ont pas d'effet et sont retirés.
Le droit « Lire » de la matrice conditionne toute lecture hors du cercle de rédaction.

Le journal d'audit suit les mêmes règles, quel que soit l'identifiant sous lequel une entrée a été écrite (ancien ID
d'un document reclassé compris) :
- hors du cercle de rédaction, une entrée qui concerne une révision non visible est masquée (voir ci-dessus) ;
- sur un document que le lecteur ne peut pas lire (confidentialité, brouillon jamais en vigueur, D-14), un
  administrateur qui n'est pas gestionnaire documentaire voit dans l'onglet Journal et son export l'action, l'auteur,
  la date et l'identifiant de l'époque, mais pas le détail ; l'identifiant courant n'est pas donné ;
- les valeurs « avant → après » d'une modification de métadonnées ne sont montrées hors du cercle que si une révision
  était en vigueur au moment de la modification et si le document n'était pas alors d'un niveau plus strict
  qu'aujourd'hui (cas d'un abaissement de la confidentialité). Sinon, seuls les noms des champs modifiés apparaissent ;
- les entrées sans document (droits, organisation, fonctions, registre, exports) ne se lisent que depuis l'écran
  d'administration.
Les gestionnaires documentaires lisent tout le journal.

**Recherche.** Facettes, période et comptes ne portent que sur les documents que l'utilisateur peut lire ; hors du
cercle de rédaction, un document est daté par son dernier changement visible et sa date d'effet est celle de la
révision en vigueur.

**Recherches enregistrées.** Une recherche enregistrée ne garde que des critères (texte, facettes et période de
l'écran Recherche) et l'ordre choisi pour ses résultats, jamais de documents : chacun n'y trouve que ce qu'il a le
droit de lire. Sa portée dit qui la voit :
- **personnelle** : son propriétaire seul, qui peut la créer avec le droit « Lire » et la supprimer ;
- **département** : les membres du département choisi ;
- **groupe** : tout le monde.
Partager (département ou groupe) et supprimer une recherche partagée sont réservés aux gestionnaires documentaires et
aux détenteurs du droit « Administrer », qui voient aussi les recherches des autres départements ; personne ne voit
les recherches personnelles d'autrui. *Proposé, non confirmé* (`docs/decisions.md`).

**Pages par département.** La page d'un département (`/departements/[code]`) ne montre que ce que les autres écrans
montrent déjà à l'utilisateur, limité à ce département : ses documents en vigueur que l'utilisateur peut lire, leurs
échéances, les circuits en cours qu'il suit, les recherches partagées avec le département et avec le groupe. Ses
filtres mis en avant comptent les valeurs des seuls documents lisibles, et chaque lien mène à la recherche filtrée, dont
les résultats sont ces documents. Hors du cercle de rédaction, un brouillon n'y apparaît ni n'y est compté ; un document
confidentiel n'y apparaît que pour son département, l'équipe projet et ses lecteurs désignés. *Proposé, non confirmé* ;
le choix des filtres par métier attend le recueil des besoins (`docs/decisions.md`).

## 6. Circuits de validation

Plusieurs circuits, définis par type et composés d'étapes **par fonction** (pas d'« autorité d'approbation » saisie) :
l'auteur, puis des fonctions résolues au moment du lancement — globales (Responsable qualité, Direction…), du
département du document, ou du projet rattaché (chef de projet, référent ingénierie…). Un circuit sans étape
d'approbation approuve immédiatement. Ni l'auteur de la révision (modificateur désigné, sinon le propriétaire, et les
auteurs de ses versions de travail) ni le demandeur ne la valident ; l'étape « Rédaction » revient à l'auteur. Un
titulaire de fonction a un rôle qui permet de valider ; la dernière approbation exige aussi le droit « Publier ». Type et
contexte (projet, programme, département) ne changent pas pendant un circuit en cours.

Un circuit en cours s'arrête avant sa fin de deux façons ; la révision revient alors en rédaction et ses valideurs
sortent du cercle de rédaction (§5) :
- **Rejet** par le titulaire de l'étape en cours, avec un **motif obligatoire** (2 000 caractères au plus) : il est
  gardé sur le circuit, dans ses commentaires et au journal (entrée rattachée à la révision), et l'auteur et le
  propriétaire le retrouvent sur la fiche (onglet Validation) et dans « À traiter ».
- **Rappel** de la demande par le demandeur ou par un gestionnaire documentaire, tant que la dernière approbation n'est
  pas faite, avec le droit « Modifier » et sur un document non verrouillé ; motif facultatif. Le circuit est clos
  « Rappelé », issue distincte du rejet, et la révision peut être soumise de nouveau. Un clic sur une étape déjà
  décidée entre-temps ne fait rien.
*Proposé, non confirmé* : la longueur du motif et qui peut rappeler (`docs/decisions.md`).

**Preuve d'approbation (fiche de visa).** Une révision approuvée a une fiche PDF, `{ID}_{lettre}_VISA.pdf`, tirée du
journal (`GET /api/documents/[id]/approval?rev=B`, onglet Révisions) : identification de la révision, références ECO,
dates de création, d'approbation, d'effet, de mise en vigueur et de remplacement, puis chacun de ses circuits (rejetés
et rappelés compris) avec, par étape, la fonction, le titulaire, la décision, son moment et les délégations, l'issue,
le motif et les commentaires. Une révision importée déjà approuvée y est dite approuvée dans l'ancien système ; une
révision importée en brouillon puis approuvée dans Codex garde sa date d'approbation et son circuit. La fiche se donne
à qui lit le document et voit la révision (§5 : hors du cercle de rédaction, la révision en vigueur et celles qu'elle a
remplacées), et chaque édition est journalisée sur la révision. Elle ne montre à chacun que ce que Codex lui montre
déjà : le texte des commentaires d'un circuit et le titulaire d'une étape jamais décidée ne vont qu'à qui suit ce
circuit (gestionnaire documentaire, demandeur, titulaire d'une étape) ; les autres lecteurs lisent le nombre de
commentaires.
Sans signature électronique (M04 ouverte), elle se présente comme un extrait du journal de Codex. *Proposé, non
confirmé* (`docs/decisions.md`).

## 7. Métadonnées

Tronc commun : ID, Titre, Origine, Rattachement, Famille, Type, Sous-type, Propriétaire, Auteur (personne ou texte),
Statut, Département, Site, Confidentialité, Mots-clés, Révision, dates d'émission / d'effet / de révision /
d'expiration, Langue, Classe de conservation.

Champs selon le contexte :
- Externe : organisme source, référence externe, date de réception.
- Projet : code projet, phase, lot / work package, discipline.
- Recherche : programme, thème, ID étude / essai, statut publication / PI.
- Interne : propriétaire de processus (facultatif).

**Dates.** Chacune est un jour du calendrier (AAAA-MM-JJ). La date d'émission est la première mise en vigueur du
document et ne change plus ; elles se suivent ainsi : émission ≤ effet < expiration. L'expiration est postérieure à
l'émission et à la date d'effet de la révision (en vigueur, ou approuvée ou en revue) ; la date de révision est
postérieure à l'émission ; la réception d'un document externe n'est ni future ni postérieure à l'émission. Un
document pas encore émis le sera au plus tôt aujourd'hui, ou à la date d'effet de la révision qui l'émettra : son
expiration et sa date de révision suivent ce jour. Une révision en revue sans date d'effet prendra effet à son
approbation, au plus tôt aujourd'hui. Une demande de validation avec une date d'effet n'est acceptée que si cette date
précède l'expiration ; sans date d'effet, celle d'un document déjà émis est acceptée même s'il a expiré
(renouvellement : l'expiration se reporte une fois la nouvelle révision en vigueur). La saisie, la demande de
validation et l'import refusent une date qui enfreint ces règles, en disant laquelle corriger (`src/lib/dates.ts`) ;
les bornes qui dépendent du jour ne s'appliquent qu'à une date saisie ou modifiée. *Proposé, non confirmé* : le sens
strict de « postérieure », la date d'émission prise comme borne de la réception, et ces bornes (`docs/decisions.md`).

**Expiration et revue périodique** (`src/lib/review.ts`). Ni l'une ni l'autre ne change le statut : le retrait d'un
document reste une demande à Vigie (D-17), et rien ne part seul à l'échéance. Ce qui doit se passer à l'expiration
(alerte, passage Obsolète, renouvellement) reste ouvert (audit, A17).
- Indicateurs : un document actif dont la date d'expiration est passée est **Expiré** (le jour de l'expiration, il est
  encore valide) ; un document actif dont la révision en vigueur a passé sa date de révision a sa **revue en retard**.
  Ils portent sur des dates que tout lecteur de la fiche voit déjà, et ne s'affichent que sur les documents que
  l'utilisateur peut lire (D-14) : fiche, explorateur (filtre « Échéance dépassée » sous le plan de classement :
  « Expirés », « Revues en retard », combiné au statut), recherche (facette « Échéance dépassée »), Archivage et
  « À traiter », qui les nomment de la même façon. Un document expiré y est dit « valable jusqu'au » sa date
  d'expiration, jamais « expiré depuis » ce jour, où il était encore valide.
- La fiche d'un document expiré propose, en raccourci, « Demander une modification » (renouvellement) et « Demander le
  retrait » ; celle d'un document en retard de revue, « Revue effectuée ».
- **Revue effectuée** : le propriétaire, le propriétaire de processus ou un gestionnaire documentaire (droit
  « Modifier ») confirme que la révision en vigueur reste applicable, sans créer de révision, sur un document non
  verrouillé ; commentaire facultatif. Elle fixe la prochaine date de revue : celle saisie, postérieure à aujourd'hui,
  sinon la périodicité du type comptée depuis le jour de la revue. Elle est journalisée sur le document entier (ses
  lecteurs la voient, valeurs comprises) et date la fiche.
- **Périodicité de revue** : chaque type du registre peut en porter une, en mois (1 à 240) ; elle est vide par défaut,
  en attendant les arbitrages du registre. Un document qui entre en vigueur sans date de révision la reçoit, comptée
  depuis sa mise en vigueur (entrée de journal « Prochaine revue fixée ») ; une date déjà saisie, même passée, est
  gardée. À la création, et dans les métadonnées d'un document sans révision en vigueur, le dialogue l'annonce sous la
  date de révision. Modifier les métadonnées n'applique pas la périodicité : pour un document en vigueur, le dialogue
  prévient qu'une date vidée ne laisse aucune revue planifiée avant la mise en vigueur d'une prochaine révision.

*Proposé, non confirmé* : le jour où un document devient expiré, les personnes qui enregistrent une revue, l'unité et
l'usage de la périodicité, dont l'absence de recalcul quand les métadonnées vident la date (`docs/decisions.md`).

**Modifications simultanées** (`src/lib/concurrency.ts`). Chaque document porte une version, qui change à toute
modification de sa fiche, par n'importe quel chemin (métadonnées, lecteurs désignés, revue, circuit, mise en vigueur,
Vigie, gel, archivage). Les dialogues de métadonnées et de lecteurs désignés la renvoient : si la fiche a changé
depuis leur ouverture, l'enregistrement est refusé sans rien écrire, avec « Ce document a été modifié entre-temps
par … ; rechargez la fiche » (l'auteur de la dernière modification de la fiche, tel que le journal l'enregistre dans
la même opération ; personne quand elle n'y figure pas), et le dialogue garde la saisie en proposant de recharger.
La version ne va qu'au cercle de rédaction (D-14) : elle change aussi avec le travail sur le brouillon. Détection
optimiste seulement : rien n'est réservé. *Proposé, non confirmé* (`docs/decisions.md`).

## 8. Conservation

Une règle par type, selon les règles d'usage (durée, événement déclencheur, sort final) ; la classe de conservation du
document est proposée par le type et modifiable par un gestionnaire. Gel juridique inchangé ; un gestionnaire
documentaire peut le lever (journalisé), le circuit en cours reprend alors.

La conservation se compte **par document** : l'événement « remplacement » part du retrait du document (Vigie), à
défaut de son archivage ; les révisions remplacées suivent la conservation du document.
