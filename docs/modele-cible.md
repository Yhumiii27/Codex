# Codex — modèle cible (GED EPC2I)

Synthèse du deck « Création de la GED EPC2I », de la spec Keystone (`Keystone/docs/spec/10-site-docs-mywork-settings.md` §4-5)
et des arbitrages du 7 octobre 2026. Ce document fait foi pour l'implémentation ; les points marqués *provisoire* seront revus.

Certaines règles ci-dessous sont des propositions de l'assistant, implémentées mais **non confirmées par l'utilisateur** :
authentification Entra ID (§1), code département hors rattachement, largeur et portée du compteur, ID attribué au
brouillon, alias et nom de fichier (§3), « Remplacé », mise en vigueur automatique, bandeau et nom de téléchargement
d'un document obsolète ou archivé (§4), partage des recherches enregistrées et pages par département (§5), longueur du
motif de rejet et droit de rappeler une demande de validation (§6), lecture stricte de la cohérence des dates (§7).
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
Ce qui se passe à l'expiration reste ouvert (audit, A17).

## 8. Conservation

Une règle par type, selon les règles d'usage (durée, événement déclencheur, sort final) ; la classe de conservation du
document est proposée par le type et modifiable par un gestionnaire. Gel juridique inchangé ; un gestionnaire
documentaire peut le lever (journalisé), le circuit en cours reprend alors.

La conservation se compte **par document** : l'événement « remplacement » part du retrait du document (Vigie), à
défaut de son archivage ; les révisions remplacées suivent la conservation du document.
