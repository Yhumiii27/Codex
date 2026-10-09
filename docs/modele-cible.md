# Codex — modèle cible (GED EPC2I)

Synthèse du deck « Création de la GED EPC2I », de la spec Keystone (`Keystone/docs/spec/10-site-docs-mywork-settings.md` §4-5)
et des arbitrages du 7 octobre 2026. Ce document fait foi pour l'implémentation ; les points marqués *provisoire* seront revus.

Certaines règles ci-dessous sont des propositions de l'assistant, implémentées mais **non confirmées par l'utilisateur** :
authentification Entra ID (§1), code département hors rattachement, largeur et portée du compteur, ID attribué au
brouillon, alias et nom de fichier (§3), « Remplacé » et mise en vigueur automatique (§4). Elles sont listées dans
`docs/decisions.md` (« Choix de l'assistant non validés explicitement », question O-09), qui prévaut en cas de doute.

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
- Modifier un document en vigueur : demande ECR depuis Codex → décision dans Vigie → ECO accepté → Codex ouvre la
  révision suivante en brouillon, attribuée au modificateur désigné.
- Verrous : un document archivé, obsolète ou sous gel juridique ne change plus (ni version de travail, ni décision de
  circuit, ni mise en vigueur d'une révision approuvée, ni acceptation Vigie ; un refus Vigie reste possible). Un retrait
  accepté clôt le travail en cours : circuit clos, révisions ouvertes **Annulées**. Une restauration d'archive rend au
  document son état d'avant (obsolète s'il avait été retiré). La date d'effet est aujourd'hui ou plus tard ; une
  révision approuvée après sa date d'effet prend effet le jour de sa mise en vigueur.

## 5. Confidentialité et visibilité

Du moins au plus protégé : **Public** (réservé à certains types) < **Restreint** (diffusable au client ou partenaire
externe désigné ; minimum pour tout document non public) < **Interne** < **Confidentiel** (département ou équipe projet)
< **Très confidentiel** (personnes désignées).

Brouillons et versions de travail visibles par : le propriétaire, le modificateur désigné, les valideurs du circuit en
cours et les gestionnaires documentaires. Hors de ce cercle, un lecteur n'obtient que le fichier final de la révision
en vigueur. Les lecteurs désignés s'ajoutent au département ou à l'équipe projet d'un document confidentiel et sont les
seuls lecteurs d'un document très confidentiel ; en dessous de « Confidentiel », ils n'ont pas d'effet et sont retirés.
Le droit « Lire » de la matrice conditionne toute lecture hors du cercle de rédaction.

## 6. Circuits de validation

Plusieurs circuits, définis par type et composés d'étapes **par fonction** (pas d'« autorité d'approbation » saisie) :
l'auteur, puis des fonctions résolues au moment du lancement — globales (Responsable qualité, Direction…), du
département du document, ou du projet rattaché (chef de projet, référent ingénierie…). Un circuit sans étape
d'approbation approuve immédiatement. Ni l'auteur de la révision (modificateur désigné, sinon le propriétaire, et les
auteurs de ses versions de travail) ni le demandeur ne la valident ; l'étape « Rédaction » revient à l'auteur. Un
titulaire de fonction a un rôle qui permet de valider ; la dernière approbation exige aussi le droit « Publier ». Type et
contexte (projet, programme, département) ne changent pas pendant un circuit en cours.

## 7. Métadonnées

Tronc commun : ID, Titre, Origine, Rattachement, Famille, Type, Sous-type, Propriétaire, Auteur (personne ou texte),
Statut, Département, Site, Confidentialité, Mots-clés, Révision, dates d'émission / d'effet / de révision /
d'expiration, Langue, Classe de conservation.

Champs selon le contexte :
- Externe : organisme source, référence externe, date de réception.
- Projet : code projet, phase, lot / work package, discipline.
- Recherche : programme, thème, ID étude / essai, statut publication / PI.
- Interne : propriétaire de processus (facultatif).

## 8. Conservation

Une règle par type, selon les règles d'usage (durée, événement déclencheur, sort final) ; la classe de conservation du
document est proposée par le type et modifiable par un gestionnaire. Gel juridique inchangé ; un gestionnaire
documentaire peut le lever (journalisé), le circuit en cours reprend alors.

La conservation se compte **par document** : l'événement « remplacement » part du retrait du document (Vigie), à
défaut de son archivage ; les révisions remplacées suivent la conservation du document.
