# Audit du deck « Création de la GED EPC2I »

Audit réalisé le 7 octobre 2026 dans la session de travail locale, avant toute intégration du deck dans Codex. Ce fichier
le restaure dans le dépôt pour qu'une session cloud n'ait ni à redemander le deck, ni à relancer l'audit, ni à reposer
les questions déjà tranchées.

## 1. Contexte et méthode

| | |
|---|---|
| Date | 7 octobre 2026. Demande à 12:19, résultat à 12:39, synthèse rendue à l'utilisateur à 12:40 (heures UTC ; Paris = UTC+2). |
| Deck audité | `docs/sources/creation-ged-epc2i.pptx` (18 slides). Transcription texte : `docs/sources/deck-ged-epc2i.md`. |
| Code audité | Codex **v1**, c'est-à-dire l'application construite le matin même d'après la maquette Claude Design. Elle n'existe plus : le modèle v2 l'a remplacée avant le premier commit. Les références de code de l'audit d'origine (`src/db/seed-data.ts`, `actions.ts:74-82`…) ne correspondent donc plus au dépôt et ne sont pas reprises. |
| Méthode | Workflow multi-agents « audit-ged-epc2i-deck » en cinq volets menés en parallèle : exigences, modèle de métadonnées, écarts deck ↔ Codex (vérifiés dans le code), architecture, critique du deck. Puis une vérification contradictoire (relecture de la transcription du modèle de métadonnées ; revérification de chaque écart dans le code) et un critique de complétude qui a relu l'ensemble. |
| Résultat | 64 exigences ; un modèle de métadonnées sur 4 niveaux (transcription jugée exacte) ; 48 écarts (après vérification : 6 couverts, 21 partiels, 12 absents, 9 en conflit) ; 5 options d'architecture et une recommandation ; 24 ambiguïtés, 16 contradictions et 23 manques ; 12 points oubliés, 14 conflits entre analyses et 12 questions prioritaires. |
| Suites | L'utilisateur a répondu aux 10 questions de l'audit le 7 octobre à 13:38, puis aux confirmations 1 à 5 (sur 6) à 17:52 ; la 6e, sur SharePoint, est restée sans réponse (O-01). Ces décisions, citées mot pour mot, sont dans [decisions.md](decisions.md) (D-05 à D-21). Le modèle qui en découle a été intégré dans le code sous le nom de **modèle v2** : il est décrit dans [modele-cible.md](modele-cible.md), qui fait foi, et son état est dans [avancement-v2.md](avancement-v2.md). |

Comment lire ce document :

- Les sections 2 à 7 restituent l'audit tel qu'il a été produit le 7 octobre. Le texte des analyses est celui de
  l'assistant ; seules les réponses de l'utilisateur, citées entre guillemets ou en bloc de citation, font foi. Les
  ajouts du 9 octobre sont signalés : notes datées, §2.1, §2.2, §6.7, colonnes « Aujourd'hui » et mentions « Suite ».
- Là où les réponses de l'utilisateur diffèrent du deck ou des recommandations de l'audit, **ce sont les réponses qui
  priment**. La recommandation d'architecture de l'audit, en particulier, n'a pas été suivie (§6).
- Les colonnes et mentions « Aujourd'hui » et « Suite » ont été ajoutées le 9 octobre 2026, après lecture du code du
  dépôt (fichiers cités). Elles disent ce qui est intégré, partiel, non fait ou écarté par décision.
- Les renvois D-xx, O-xx et T-xx désignent les décisions, les questions ouvertes et les travaux en attente de
  [decisions.md](decisions.md). « Proposé, non confirmé » marque une proposition de l'assistant que l'utilisateur n'a
  ni validée ni contestée.
- Les questions encore ouvertes (O-01 à O-11) et les travaux en attente (T-01 à T-03) sont tenus à jour dans
  [decisions.md](decisions.md), pas ici.

## 2. Ce que j'ai compris du deck

À 12:21, pendant que l'audit tournait, l'assistant a écrit :

> J'ai lu le deck (18 slides : pourquoi, comment, étapes, usage, modèle de métadonnées sur 4 niveaux). L'audit multi-agents tourne en arrière-plan. Il couvre les exigences, le modèle de métadonnées, les écarts avec Codex vérifiés contre le code, l'architecture et les incohérences du deck. Je te fais le retour complet dès qu'il se termine.
>
> Point de vigilance déjà visible : le deck prévoit de construire la GED avec les outils Microsoft (SharePoint, Power Automate, Power Apps). Codex est une application autonome. Ce sera la première décision à trancher.

Voici la synthèse rendue à l'utilisateur à 12:40, reproduite telle quelle. Les mentions de Codex y décrivent la v1.

Je n'ai rien intégré pour l'instant. Le deck décrit une GED à monter avec les outils Microsoft, alors que Codex est une application autonome : c'est le premier point à trancher.

#### Ce que j'ai compris du deck

**Le but.** Une base centrale unique pour tous les documents du groupe, classés par métadonnées et non par arborescence de dossiers. Elle doit trouver vite, éviter les doublons et garantir la traçabilité et la conservation légale.

**Le moyen prévu.**
- **SharePoint** : une bibliothèque unique qui sert à la fois de base de données et de coffre-fort.
- **Banque de termes SharePoint** : elle porte les métadonnées.
- **Power Automate** : il porte les workflows.
- **Power Apps** : une interface unique « GED EPC2I », pour que les utilisateurs ne se perdent pas dans la bibliothèque.

**Les étapes (slides 6 à 9).**
1. Faire l'état des lieux des arborescences actuelles.
2. Créer la banque de termes, puis la bibliothèque unique.
3. Paramétrer la bibliothèque : filtres, codification automatique du nom selon le type, gestion des versions.
4. Créer les modèles de documents.
5. Migrer les documents par vagues, puis supprimer les anciennes arborescences.
6. Mettre en place les workflows : création avec codification, validation avec un circuit fixé par type, modification d'un document validé (principe ECR/ECO), passage à « obsolète ».
7. Livrer l'application : d'abord création, recherche et liens SharePoint, puis les workflows au fil de l'eau.

**L'usage (slides 10 et 11).**
- Une application commune, avec des pages dédiées par métier.
- Des accès restreints selon la confidentialité ou le statut (un brouillon n'est pas visible par tous).
- Les fonctions : créer un document et recevoir son ID unique, rechercher n'importe quel document, demander une modification, valider, demander le passage à obsolète, suivre mes demandes et mes actions en attente.

**Le modèle de métadonnées, sur 4 niveaux.**

| Niveau | Contenu |
| --- | --- |
| 1 | Un type parent « GED Document » et 4 domaines : Interne (DI), Externe (DE), Projet (DP), Recherche (DR) |
| 2 | 20 champs communs, dont : ID automatique et immuable, Titre, Domaine › Catégorie › Type › Sous-type, Propriétaire, Auteur, Statut, Département, Confidentialité, Version, 4 dates (émission, effet, révision, expiration), Classe de conservation, Organisme source (obligatoire pour les documents externes) |
| 3 | Classement par domaine : 23 catégories, 45 types, 157 exemples de sous-types. DI : 4 cat. / 10 types · DE : 5 / 10 · DP : 6 / 12 · DR : 8 / 13 |
| 4 | 4 champs obligatoires de plus par domaine (16 au total). Par exemple pour les projets : code projet, phase, lot, discipline |

- **Statuts (7)** : Brouillon / En révision / Approuvé / En vigueur / Remplacé / Archivé / Obsolète.
- **Confidentialité (4)** : Interne / Confidentiel / Très confidentiel / Restreint.

#### Ce que ça change pour Codex

J'ai comparé 48 éléments du deck au code actuel : **6 sont couverts, 21 partiels, 12 absents et 9 en conflit.**

Les conflits à trancher :
- **Architecture** : SharePoint + Power Platform, contre Codex autonome.
- **Classement** : Codex classe sur 4 axes (entité, service, processus, type). Le deck classe par Domaine › Catégorie › Type › Sous-type.
- **Statuts** : Codex en gère 4, le deck 7.
- **Confidentialité** : les listes diffèrent, et l'ordre aussi (le deck place « Restreint » au-dessus de « Très confidentiel »).
- **Modification d'un document validé** : Codex ne sait faire qu'une nouvelle version, sans demande de modification (ECR/ECO).
- **Date d'expiration** : elle est distincte de la date de fin de conservation dans le deck, confondues dans Codex.
- **Taxonomie** : les 45 types du deck ne recoupent pas ceux de Codex.

Ce qui manque surtout dans Codex : le Domaine, le Sous-type, l'Auteur distinct du propriétaire, les dates d'effet et de révision, l'Organisme source, les champs de niveau 4, le passage à obsolète, de vraies restrictions d'accès et l'outil de migration.

À savoir aussi : les données de démo de Codex (carrières, minage) sont fictives et sans rapport avec EPC2I.

> **Note du 9 octobre** : le décompte « 6 couverts, 21 partiels, 12 absents et 9 en conflit » est celui obtenu après
> la vérification contradictoire (le premier passage comptait 10 couverts et 17 partiels, voir §5.1). Les données de
> démonstration « carrières, minage » ont été remplacées par des données alignées sur Keystone.

**Une découverte** : la spécification de Keystone, dans `Keystone/docs/spec/10-site-docs-mywork-settings.md`, décrit déjà Codex avec un troisième modèle :
- un registre de 28 types codés (PRO, NCR, PID…), chacun avec son circuit, sa règle de conservation et sa clause ISO ;
- une numérotation `TYPE-PROJ-SEQ` (par exemple `PID-HLT-026`), mais `TYPE-CLIENT-SEQ` ailleurs dans la même spec ;
- des révisions en lettres (A, B, C) ;
- les statuts Brouillon / Gelé / Diffusion proposée / Diffusé / Obsolète.

Il y a donc trois modèles à réconcilier : la maquette Codex, la spec Keystone et ton deck.

#### Incohérences dans le deck
- **Statut « validé »** : les slides 8 à 11 en parlent, mais il n'existe pas dans la liste des 7. La différence entre Approuvé et En vigueur, et entre Remplacé, Archivé et Obsolète, n'est pas expliquée.
- **ID** : il doit être immuable, mais il est construit à partir du type. Que devient-il si on reclasse le document ? Et son format n'est défini nulle part.
- **Codification** : elle est attribuée tour à tour à la bibliothèque (slide 7), au flux de création (slides 8-9) et à l'application (slide 11).
- **Circuit de validation** : il doit être fixé par type (slide 8), mais la slide 18 fait aussi saisir une « autorité d'approbation » pour chaque document interne. Laquelle des deux règles s'applique ?
- **Domaine** : il mélange l'origine (interne ou externe) et le contexte (projet ou recherche). Un certificat de fournisseur lié à un projet, est-ce un document Externe ou Projet ?
- **Documents externes** : ils sont définis comme d'origine externe, mais portent un champ « sens entrant/sortant ». La date de réception est obligatoire, même pour un document sortant.
- **Doublons entre domaines** : « Demande d'achat » est à la fois en Interne et en Projet, et « RFQ » à la fois en Externe et en Projet. « Département » et « Confidentialité » sont répétés entre les niveaux 2 et 4.
- **Ordre des étapes** : la migration et la suppression des anciennes arborescences passent avant les workflows qui produisent la codification.
- **Non défini** : les classes de conservation, la matrice type → circuit, les étapes de l'ECR/ECO, qui voit quoi selon la confidentialité, la liste des pages métiers.
- **Absent** : les rôles (qui gère quoi), la signature électronique, la diffusion des documents et la preuve de lecture, le partage externe, la numérisation et l'OCR, la recherche dans le contenu des fichiers, les liens entre documents (« remplacé par »), le RGPD pour les documents RH, la frontière avec Keystone, Vigie et Cursus.

#### Ce que je propose
Garder le socle SharePoint du deck : bibliothèque unique, banque de termes, types de contenu, versions, Purview, édition Office. Codex devient l'application « GED EPC2I » à la place de Power Apps, et les workflows restent dans Codex plutôt que dans Power Automate. On y va par étapes : d'abord en lecture via Microsoft Graph, puis la création et les circuits.

Avant tout branchement, je préparerais Codex :
1. aligner le modèle sur le deck ;
2. isoler l'accès aux données pour pouvoir brancher SharePoint ensuite ;
3. passer à l'authentification Entra ID.

> **Note du 9 octobre** : cette proposition (garder SharePoint comme coffre-fort et source de vérité) **n'a pas été
> retenue**. L'utilisateur a choisi Codex comme source de vérité, SharePoint n'étant au plus qu'un stockage de fichiers
> piloté par Codex (D-06, §6.7). De même, Entra ID reste une proposition sans réponse (O-02).

#### Ce que j'ai besoin que tu tranches avant d'intégrer
1. **Socle technique** : SharePoint reste-t-il le coffre-fort et la source de vérité, avec Codex comme interface ? Ou Codex le remplace-t-il ? Les workflows tournent-ils dans Codex ou dans Power Automate ?
2. **Modèle de référence** : le deck, la spec Keystone, ou une fusion des deux en un registre unique ?
3. **Domaine** : doit-il être exclusif (un seul des 4 par document) ? Ou faut-il deux axes séparés, l'origine et le rattachement ?
4. **Format de l'ID** : quels segments, à quel moment il est attribué, ce qu'il devient si on reclasse le document, et doit-il s'aligner sur `TYPE-PROJ-SEQ` ?
5. **Cycle de vie et révisions** : une révision garde-t-elle le même ID ? L'ancienne passe-t-elle « Remplacé » ou « Obsolète » ? Indices en lettres ou en x.y ? Approuvé devient-il En vigueur automatiquement à la date d'effet ?
6. **Confidentialité** : dans quel ordre se rangent les 4 niveaux ? Faut-il un niveau Public ? Qui voit les brouillons ?
7. **Circuits** : quelle matrice type → circuit ? Et quel rôle exact pour l'« autorité d'approbation » ?
8. **ECR/ECO** : quelles étapes ? Quel lien avec le module ECO de Keystone ?
9. **Organisation réelle** : quelles sont les vraies sociétés, les vrais sites et les vrais départements ?
10. **Conservation et migration** : quelles classes de conservation, avec quelles durées ? Quels volumes et quels emplacements faut-il migrer ?

Je peux mettre l'audit détaillé (64 exigences, 48 écarts, taxonomie complète) dans une page à partager si tu veux.

### 2.1 Compléments tirés du résultat détaillé

- **Exigences** : 64, dont 54 explicites et 10 implicites (déduites du deck), en 7 catégories : architecture (5),
  accès et sécurité (6), fonctions utilisateur (12), workflows (7), paramétrage (5), métadonnées et classement (21),
  migration et déploiement (8). Liste complète au §3.
- **Modèle de métadonnées** : 5 types de contenu (le parent « GED Document » et ses 4 enfants), 20 champs de tronc commun
  dont 13 obligatoires, 7 statuts, 4 niveaux de confidentialité, 23 catégories, 45 types (DI 10, DE 10, DP 12, DR 13),
  157 exemples de sous-types et 16 champs de niveau 4. La relecture a jugé la transcription exacte (§4.7).
- **Logos sans usage** : la slide 4 montre aussi Power BI, Power Pages et Power Virtual Agents. Aucun usage n'en est
  décrit ; l'audit ne les a pas retenus comme exigences.
- **Coquilles du deck** : « hiérachie » (titre de la slide 12) ; « Règlementation » (type DE) à harmoniser avec
  « Réglementaire & Normatif » (graphie admise, mais incohérente).
- **Trois modèles à réconcilier** : la maquette Codex, la spec Keystone (`docs/spec/10-site-docs-mywork-settings.md` du
  dépôt Keystone, 28 types codés) et le deck. Le critique de complétude a relevé que les cinq analyses ne comparaient
  pas le deck à la spec Keystone (§7.4, P01) ; la question 2 posée à l'utilisateur en découle.

### 2.2 Les questions posées et les réponses de l'utilisateur

Les 10 questions de 12:40 (ci-dessus) ont reçu ces réponses à 13:38, citées mot pour mot :

| N° | Sujet | Réponse de l'utilisateur | Décision |
|---|---|---|---|
| 1 | Socle technique | « Codex prends toute la charge et les workflow, la seule option ouverte si c'est plus simple est que le stockage des documents soit sous une bibliothèque sharepoint gérée par Codex (les metadonnées et autres informations sont dans codex et uniquement le document et son nom et sa version sont mises dans sharepoin).. » | D-06 |
| 2 | Modèle de référence | « Exprime moi cette question autrement je ne comprends pas. » (question reformulée à 17:33, voir plus bas) | D-07 |
| 3 | Domaine | « Origine et rattachement me parait être la bonen solution » | D-08 |
| 4 | Format de l'ID | « TYPE-Proj-SEQ est une bonne codification pour les documents issus des projets fait moi une proposition pour les autres documents. » | D-09, D-10 |
| 5 | Cycle de vie et révisions | « Un document ne change pas de nom ni d'ID au passage de version. Il doit passer par un workflow de validation pour être approuvé. Nous n'utilisons que des indices en lettre et pas d'indices majeurs/mineurs. » | D-11 |
| 6 | Confidentialité | « Il peut y avoir un niveau publique, pour les documents de communication par exemple, le type publique doit être restraint a certaines famille le reste doit être a minima restraint a la diffusion a une extreprise externe ou un client. » et « La personne propriétaire ou qui modifiera un document via une ECO verra les brouillons des documents qui lui sont liés/attribués. » | D-13, D-14 |
| 7 | Circuits | « Nous devons construire cela en fonction des roles et des documents mais des workflow differents sont a prévoir, il n'y a pas a proprement parler d'autorité d'approbation cela depend des documents. » | D-15 |
| 8 | ECR/ECO | « Je pense que les ECR/ECO doivent être centralisées dans "Vigie", quelles soient projet ou documentaires. » | D-16 |
| 9 | Organisation réelle | « Je te donnerais un organigramme des services et des sites plus tard » | D-19 |
| 10 | Conservation et migration | « La conservation des documents sera selon les règles d'usage par type de document. » et « La migration sera faite via un code dédié fait qpecifiquement pour cette tache et ne sera pas intégré dans codex directement » | D-20, D-21 |

À 17:33, l'assistant a reformulé la question 2 (« Je fusionne les deux en une seule liste de référence, gérée dans
Codex ? »), proposé la codification `TYPE-CONTEXTE-SEQ`, un cycle de vie en lettres et une échelle de confidentialité à
5 niveaux, puis demandé 6 confirmations :

1. Je fusionne ton deck et la liste de Keystone en une seule liste de référence gérée dans Codex ?
2. Pour les documents sans rattachement, j'utilise le code du département propriétaire, ou un code unique `QMS` ?
3. L'échelle de confidentialité de la section 5 te convient ?
4. La demande de passage à « obsolète » passe-t-elle aussi par un ECR dans Vigie, ou reste-t-elle un workflow interne à Codex ?
5. En plus du propriétaire et du modificateur, les valideurs du circuit et les gestionnaires documentaires voient-ils les brouillons ?
6. Pour SharePoint : un fichier par révision, et aucun accès direct des utilisateurs à la bibliothèque ? Sans cela, ils pourraient contourner les droits de Codex. En contrepartie, la modification d'un fichier se fait en le téléchargeant puis en le redéposant, sans édition Office en ligne.

Réponses de l'utilisateur à 17:52, mot pour mot :

> 1- oui fusionne pour le moment on adaptera plus tard
>
> 2- QMS est le code pour les templates
>
> 3- oui
>
> 4- c'est un workflow vigie
>
> 5- oui
>
> pour la question 2: oui fusionne les deux bases
>
> pour le cycle de vie conserve les sous versions de travail
>
> pour vigie, il va gérer les ECO/ECR mais les demandes doivent pouvoir etre faites depuis codex pour les documents ou depuis keystone pour les sujets liés au projets ou au projet lui meme.

Elles donnent D-07, D-10, D-13, D-17, D-14, D-12 et D-18. La confirmation 6 (SharePoint : un fichier par version, sans
accès direct des utilisateurs) n'a jamais reçu de réponse, malgré trois relances : c'est O-01.

## 3. Exigences tirées du deck

64 exigences. « Nature » : *explicite* quand le deck l'énonce, *implicite* quand l'audit la déduit. Les formulations sont
celles de l'audit ; elles décrivent le deck, pas ce qui a été décidé ensuite (par exemple ARC-02 à ARC-05, PAR-01 et
FON-05 supposent la pile Microsoft, écartée par D-06).

### Architecture (5)

| ID | Exigence | Slides | Nature | Description |
|---|---|---|---|---|
| **ARC-01** | Base documentaire centralisée unique pour tout le groupe | 2, 3, 5 | explicite | La GED doit être la base centralisée de tous les documents d'EPC2I, avec des filtres optimisés pour la recherche. Elle remplace l'éparpillement actuel entre outils et dossiers cloisonnés, qui multiplie les sources et les doublons et fait perdre des documents. |
| **ARC-02** | Construire sur les outils Microsoft existants | 4, 5 | explicite | La GED doit s'appuyer sur les outils Microsoft déjà en place : SharePoint pour le stockage, Power Automate pour les flux et Power Apps pour l'interface. La slide 4 montre aussi les logos Power BI, Power Pages et Power Virtual Agents, mais aucun usage n'en est décrit : ce ne sont donc pas des exigences. Ce choix diffère de la pile technique actuelle de Codex (Next.js + PGlite) et doit être tranché. |
| **ARC-03** | Bibliothèque de documents unique, à la fois base de données et coffre-fort | 5, 6, 7 | explicite | Une seule bibliothèque de documents, créée dans le SharePoint global, sert à la fois de base de données (métadonnées) et de coffre-fort pour les fichiers. Il n'y a pas de bibliothèque par service ni d'arborescence de dossiers : le classement se fait par les métadonnées. |
| **ARC-04** | Moteur de flux pour la création, la validation, la modification et l'obsolescence | 5, 8 | explicite | Les workflows du cycle de vie documentaire (création, validation, modification, passage à l'état obsolète, etc.) doivent être portés par un moteur de flux automatisé. Le deck cite Power Automate. |
| **ARC-05** | Interface utilisateur unique qui masque la base | 5, 10 | explicite | Les utilisateurs passent par une interface applicative unique (Power Apps dans le deck) au lieu de naviguer directement dans la bibliothèque, « sans qu'ils ne puissent se perdre dans la BDD ». L'application s'appelle « GED EPC2I ». |

### Accès et sécurité (6)

| ID | Exigence | Slides | Nature | Description |
|---|---|---|---|---|
| **ACC-01** | Accès à tous les documents par l'application commune « GED EPC2I » | 10 | explicite | L'application commune « GED EPC2I » est le point d'accès à l'ensemble des documents, pour tous les utilisateurs et tous les domaines. |
| **ACC-02** | Restriction d'accès selon le niveau de confidentialité | 10, 13 | explicite | L'accès à un document peut être restreint selon sa classe de confidentialité. Les valeurs sont celles du tronc commun : Interne, Confidentiel, Très confidentiel, Restreint. |
| **ACC-03** | Restriction d'accès selon le statut du document | 10 | explicite | L'accès peut être restreint selon le statut du document. L'exemple donné est le statut « Brouillon » : un brouillon ne doit pas être visible par tous. |
| **ACC-04** | Règles de restriction activables au besoin et extensibles | 10 | implicite | Les accès « peuvent être restreints au besoin », et la liste des critères se termine par « … ». Les règles d'accès doivent donc pouvoir être réglées au cas par cas et accepter d'autres critères que la confidentialité et le statut. |
| **ACC-05** | Traçabilité des documents et des actions | 3 | implicite | La GED doit apporter une « meilleure traçabilité » et respecter les exigences légales de traçabilité. Il faut donc garder l'historique des actions et des workflows sur chaque document. Le deck ne décrit pas de fonction précise pour cela. |
| **ACC-06** | Conservation conforme aux exigences légales | 3, 13 | implicite | La GED doit respecter les exigences légales de conservation des documents. Chaque document porte pour cela une « Classe de conservation » obligatoire (rétention / conformité). Le deck ne détaille ni les durées ni les règles de sort final. |

### Fonctions utilisateur (12)

| ID | Exigence | Slides | Nature | Description |
|---|---|---|---|---|
| **FON-01** | Création de documents depuis l'application | 9, 11 | explicite | L'utilisateur crée un nouveau document depuis l'application. Cette fonction fait partie de l'application de base (première livraison). |
| **FON-02** | Remise de l'ID unique au créateur | 11, 13 | explicite | À la création, l'application génère l'identifiant unique du document et le communique à l'utilisateur. |
| **FON-03** | Recherche transversale de n'importe quel document | 9, 11 | explicite | Depuis l'application unique, l'utilisateur peut rechercher n'importe quel document, quel que soit le domaine ou le service : projets, R&D, commercial, RH, communication, etc. Cette fonction fait partie de l'application de base. |
| **FON-04** | Recherche filtrée par les métadonnées | 2, 7 | explicite | La recherche s'appuie sur des filtres optimisés, construits à partir des métadonnées de la bibliothèque (données de filtrage). |
| **FON-05** | Ouverture du document par un lien vers la bibliothèque SharePoint | 9 | explicite | L'application donne des liens qui ouvrent le document dans la bibliothèque SharePoint. Le fichier reste stocké dans la bibliothèque, l'application ne sert que de porte d'entrée. Cette fonction fait partie de l'application de base. |
| **FON-06** | Pages dédiées par métier avec leurs filtres principaux | 9, 10 | explicite | L'application propose des pages dédiées à chaque métier ou département. Chaque page met en avant les filtres principaux utiles à ses utilisateurs. Leur contenu découle de l'identification des besoins par département. |
| **FON-07** | Demande de modification d'un document validé | 11 | explicite | L'utilisateur peut déposer une demande de modification sur un document déjà validé. Cette demande lance le workflow ECR/ECO. |
| **FON-08** | Validation des documents nouveaux ou modifiés | 11 | explicite | Les valideurs donnent leur décision depuis l'application, aussi bien sur un nouveau document que sur une nouvelle révision d'un document modifié. |
| **FON-09** | Demande de passage au statut obsolète | 11 | explicite | L'utilisateur peut demander qu'un document passe au statut « Obsolète ». C'est une demande qui lance un workflow, pas un changement direct. |
| **FON-10** | Suivi des workflows lancés par l'utilisateur | 11 | explicite | L'utilisateur voit les workflows en cours qu'il a lui-même lancés (création, validation, modification, obsolescence) et où chacun en est. |
| **FON-11** | Suivi des actions en attente de l'utilisateur | 11 | explicite | L'utilisateur voit la liste des actions qu'il doit faire dans un workflow (validations, avis, etc.), comme une liste de tâches. |
| **FON-12** | Création à partir de modèles de documents | 7 | implicite | Des documents types (modèles) sont prévus au paramétrage. On en déduit que la création d'un document doit pouvoir partir d'un modèle adapté à son type. |

### Workflows (7)

| ID | Exigence | Slides | Nature | Description |
|---|---|---|---|---|
| **WFL-01** | Workflow de création avec codification automatique | 8, 9 | explicite | La création d'un document passe par un workflow qui génère automatiquement sa codification (nom ou référence codifiée selon le type). Le format de la codification n'est pas défini dans le deck. Le lien entre cette codification et le champ « ID document » n'est pas précisé non plus. |
| **WFL-02** | Circuit de validation prédéfini selon le type de document | 8, 9 | explicite | La validation suit un circuit défini à l'avance pour chaque type de document. Il faut donc une table de correspondance entre le type et le circuit (étapes et valideurs). Le deck ne la détaille pas. |
| **WFL-03** | Modification d'un document validé selon le principe ECR/ECO | 8, 9, 11 | explicite | La modification d'un document validé suit le principe ECR/ECO, c'est-à-dire en deux temps. D'abord une demande de modification (ECR) est instruite et acceptée. Ensuite un ordre de modification (ECO) est exécuté et produit une nouvelle révision. Cette révision repasse en validation. |
| **WFL-04** | Pas de modification directe d'un document validé | 8, 11 | implicite | Puisque toute modification passe par une demande (ECR/ECO), un document validé est verrouillé. On ne peut le modifier qu'au travers de ce workflow. |
| **WFL-05** | Remplacement de la révision précédente | 8, 13 | implicite | Le statut « Remplacé » existe dans la liste des statuts. Quand une nouvelle révision issue d'une modification entre en vigueur, l'ancienne doit donc passer à « Remplacé » et rester conservée. |
| **WFL-06** | Workflow de passage à l'état obsolète | 8, 9, 11 | explicite | Un workflow dédié fait passer un document au statut « Obsolète » à partir d'une demande d'utilisateur. Ce statut est distinct de « Archivé ». |
| **WFL-07** | Cycle de vie à sept statuts | 8, 13 | implicite | Le cycle de vie suit les statuts Brouillon, En révision, Approuvé, En vigueur, Remplacé, Archivé et Obsolète. Les passages d'un statut à l'autre ne sont pas décrits. On en déduit qu'« Approuvé » (validation obtenue) et « En vigueur » (applicable, sans doute à la date d'effet) sont deux états distincts. |

### Paramétrage (5)

| ID | Exigence | Slides | Nature | Description |
|---|---|---|---|---|
| **PAR-01** | Métadonnées créées dans la banque de termes SharePoint | 6 | explicite | Les métadonnées gérées (catégories, types, sous-types, départements, classes de conservation, organismes, mots-clés) sont créées dans la banque de termes SharePoint, avant la création de la bibliothèque. |
| **PAR-02** | Bibliothèque paramétrée pour utiliser les métadonnées | 7 | explicite | La bibliothèque unique est paramétrée pour utiliser les métadonnées : colonnes, types de contenu et données de filtrage. |
| **PAR-03** | Nommage automatique du document selon son type | 7 | explicite | La bibliothèque applique une codification automatique du nom de document qui dépend de son type. La règle exacte (préfixes, compteur, segments) reste à définir. |
| **PAR-04** | Gestion des versions des documents | 7, 13 | explicite | La bibliothèque est paramétrée pour gérer les versions des documents. En complément, le champ « Version / Révision » (texte, obligatoire) indique la révision métier. |
| **PAR-05** | Premiers modèles de documents | 7 | explicite | Les premiers documents types (modèles) sont créés pendant le paramétrage, avant la migration. |

### Métadonnées et classement (21)

| ID | Exigence | Slides | Nature | Description |
|---|---|---|---|---|
| **MET-01** | Modèle de métadonnées en quatre niveaux | 1, 12, 13, 14, 15, 16, 17, 18 | explicite | Le modèle de métadonnées comporte quatre niveaux : niveau 1, la hiérarchie des types de contenu ; niveau 2, le tronc commun ; niveau 3, la taxonomie propre à chaque domaine (DI, DE, DP, DR) ; niveau 4, les champs spécifiques à chaque domaine. |
| **MET-02** | Type parent « GED Document » et quatre types enfants | 12 | explicite | Le type de contenu parent « GED Document », commun à tous les documents contrôlés, hérite du type SharePoint « Document ». Il a quatre types enfants : Document interne (origine interne), Document externe (origine externe), Document projet (lié à un projet) et Document recherche (lié à la recherche). |
| **MET-03** | Tronc commun de 20 champs pour tous les documents | 13 | explicite | Chaque document porte 20 champs communs : ID document, Titre, Domaine, Catégorie, Type de document, Sous-type, Propriétaire, Auteur, Statut, Département / Fonction, Niveau de confidentialité, Mots-clés, Version / Révision, Date d'émission, Date d'effet, Date de révision prévue, Date d'expiration, Langue (gestion multilingue), Classe de conservation et Organisme source. |
| **MET-04** | Treize champs obligatoires dans le tronc commun | 13 | explicite | Treize champs sont obligatoires : ID document, Titre, Domaine, Catégorie, Type de document, Propriétaire du document, Auteur, Statut, Département / Fonction, Niveau de confidentialité, Version / Révision, Date d'émission et Classe de conservation. Six sont facultatifs : Sous-type, Mots-clés, Date d'effet, Date de révision, Date d'expiration et Langue. |
| **MET-05** | ID document généré automatiquement, unique et immuable | 11, 13 | explicite | L'ID document est un texte généré automatiquement. C'est une référence unique et immuable : il ne change jamais, même lors des révisions. |
| **MET-06** | Domaine déduit du type de contenu | 12, 13 | explicite | Le champ Domaine (Interne, Externe, Projet, Recherche) n'est pas saisi par l'utilisateur. Il est déduit du type de contenu choisi. |
| **MET-07** | Champs de classement en métadonnées gérées | 6, 13 | explicite | Catégorie, Type de document, Sous-type, Département / Fonction, Classe de conservation et Organisme source sont des métadonnées gérées : des listes contrôlées issues de la banque de termes. Mots-clés est une métadonnée gérée qui accepte plusieurs valeurs. |
| **MET-08** | Liste des sept valeurs de statut | 13 | explicite | Le champ Statut (liste de choix, obligatoire) accepte exactement sept valeurs : Brouillon, En révision, Approuvé, En vigueur, Remplacé, Archivé, Obsolète. |
| **MET-09** | Quatre niveaux de confidentialité | 13 | explicite | Le champ Niveau de confidentialité (liste de choix, obligatoire) accepte quatre valeurs : Interne, Confidentiel, Très confidentiel, Restreint. Aucune valeur « Public » n'est prévue. |
| **MET-10** | Propriétaire interne obligatoire, auteur personne ou texte | 13 | explicite | Le Propriétaire du document est obligatoire pour tout document, même externe. C'est une personne, responsable métier interne. L'Auteur peut être une personne ou un texte libre, pour indiquer l'auteur réel ou l'organisme émetteur d'un document externe. |
| **MET-11** | Organisme source obligatoire pour les documents externes | 13, 18 | explicite | Le champ Organisme source est conditionnel : il est obligatoire pour les documents du domaine Externe et facultatif pour les autres. |
| **MET-12** | Taxonomie des documents internes (DI) | 14 | explicite | Les documents internes se classent en 4 catégories et 10 types. Gouvernance & Management : Politique, Procédure, Enregistrement de gouvernance. Qualité / QHSE : Audit & Inspection, Sécurité & Risques. Opérations : Maîtrise opérationnelle, Maintenance & Actifs. Fonctions support : RH & Formation, Finance & Administration, IT & Sécurité de l'information. |
| **MET-13** | Taxonomie des documents externes (DE) | 15 | explicite | Les documents externes se classent en 5 catégories et 10 types. Réglementaire & Normatif : Règlementation, Permis / Certification, Norme / Référentiel. Contrats & Juridique : Accord, Acte juridique. Fournisseurs / Fabricants : Documentation technique, Documentation qualité. Clients / Partenaires : Correspondance, Échange commercial. Évaluations tierces : Rapport externe. |
| **MET-14** | Taxonomie des documents projet (DP) | 16 | explicite | Les documents projet se classent en 6 catégories et 12 types, qui suivent le cycle de vie d'un projet. Gouvernance projet : Définition du projet, Pilotage & Décisions. Planification & Contrôle : Planning & Coûts, Reporting d'avancement. Ingénierie & Conception : Exigences, Livrables de conception. Achats & Contrats : Consultation, Administration contractuelle. Exécution & Chantier : Exécution terrain, Essais & Mise en service. Handover & Clôture : Remise / Handover, Clôture. |
| **MET-15** | Taxonomie des documents recherche (DR) | 17 | explicite | Les documents recherche se classent en 8 catégories et 14 types. Gouvernance de la recherche : Proposition & Autorisation, Pilotage du programme. Revue de connaissances : Revue bibliographique, Antériorité & Benchmark. Conception d'étude : Protocoles, Planification des données. Données & Expériences : Preuves brutes, Données préparées. Analyse & Modélisation : Analyse quantitative, Simulation & Modélisation. PI & Savoir confidentiel : Protection intellectuelle. Résultats & Diffusion : Publication. Collaboration externe : Collaboration. *(Note : la liste ci-dessus compte 13 types, et le deck en a bien 13 pour DR ; « 14 » est une erreur de l'audit, voir §4.4.)* |
| **MET-16** | Classement en cascade : domaine, catégorie, type, sous-type | 13, 14, 15, 16, 17 | implicite | Chaque domaine a sa propre taxonomie. Les catégories proposées dépendent donc du domaine (type de contenu), et les types dépendent de la catégorie : la sélection doit se faire en cascade. |
| **MET-17** | Liste des sous-types à finaliser | 14, 15, 16, 17 | implicite | Les sous-types sont donnés comme « Exemples » : ce n'est pas une liste fermée. Le référentiel des sous-types reste à arrêter. Il doit pouvoir évoluer dans la banque de termes. |
| **MET-18** | Champs spécifiques obligatoires des documents internes | 18 | explicite | Un document interne doit aussi renseigner : Propriétaire de processus, Autorité d'approbation, Département et Niveau de confidentialité. Les deux derniers figurent déjà dans le tronc commun : il y a un doublon à clarifier. |
| **MET-19** | Champs spécifiques obligatoires des documents externes | 18 | explicite | Un document externe doit aussi renseigner : Organisme source, Référence externe, Sens du document (entrant ou sortant) et Date de réception. |
| **MET-20** | Champs spécifiques obligatoires des documents projet | 18 | explicite | Un document projet doit aussi renseigner : Code projet, Phase projet, Lot / work package et Discipline. |
| **MET-21** | Champs spécifiques obligatoires des documents recherche | 18 | explicite | Un document recherche doit aussi renseigner : Programme de recherche, Thème de recherche, ID étude / essai et Statut publication / PI. |

### Migration et déploiement (8)

| ID | Exigence | Slides | Nature | Description |
|---|---|---|---|---|
| **MIG-01** | État des lieux des arborescences de dossiers actuelles | 6 | explicite | Première étape : recenser et analyser les arborescences de dossiers utilisées aujourd'hui. Cet état des lieux prépare le modèle de métadonnées et la migration. |
| **MIG-02** | Migration des documents existants par vagues | 6, 7 | explicite | Les documents existants sont migrés vers la bibliothèque unique par vagues successives, pas en une seule fois. Cette étape vient après la création de la bibliothèque, le paramétrage des métadonnées et du versioning, et les premiers modèles. |
| **MIG-03** | Correspondance entre anciens dossiers et nouvelles métadonnées | 6, 13, 18 | implicite | Les documents migrés doivent recevoir les champs obligatoires du tronc commun et de leur domaine, dont l'ID document. Il faut donc établir une correspondance entre les anciennes arborescences et la taxonomie, à partir de l'état des lieux. |
| **MIG-04** | Suppression ou archivage des anciennes arborescences | 6 | explicite | Dernière étape : une fois la migration faite, les anciennes arborescences de dossiers sont supprimées ou archivées, pour ne garder qu'une seule source. |
| **MIG-05** | Recensement des besoins utilisateurs par département | 9, 10 | explicite | Avant de construire l'application, on recense les besoins des utilisateurs de chaque département. Ce recensement alimente notamment les pages métiers et leurs filtres. |
| **MIG-06** | Choix des workflows à créer selon les besoins | 8 | explicite | Les workflows à créer sont choisis selon les besoins. La liste citée (création, validation, modification, obsolescence) se termine par « … » : elle est ouverte, et d'autres workflows pourront s'ajouter. |
| **MIG-07** | Livraison progressive : application de base, puis workflows | 9, 11 | explicite | On livre d'abord une application de base : création, recherche, liens d'ouverture. Les workflows sont ensuite ajoutés progressivement (création codifiée, validation, modification ECR/ECO, obsolescence). Les fonctions de la slide 11 sont annoncées « à terme ». |
| **MIG-08** | Ordre des étapes de mise en place | 6, 7 | explicite | Les étapes s'enchaînent dans cet ordre : 1. état des lieux ; 2. métadonnées dans la banque de termes ; 3. bibliothèque unique (paramétrage des métadonnées, codification, versioning) ; 4. modèles ; 5. migration par vagues ; 6. suppression ou archivage des anciennes arborescences. |

## 4. Modèle de métadonnées du deck

Le deck décrit un modèle sur 4 niveaux (slides 12 à 18). Ce qui suit est la transcription de l'audit ; le modèle
retenu ensuite pour Codex est dans [modele-cible.md](modele-cible.md) (deux axes au lieu des domaines, 5 niveaux de
confidentialité, registre fusionné de 69 types).

### 4.1 Niveau 1 : types de contenu

| Type de contenu | Code | Rôle | Remarque de l'audit |
|---|---|---|---|
| GED Document | — (aucun code dans la présentation ; seuls DI/DE/DP/DR sont codifiés, diapo 1) | Type parent commun à tous les documents contrôlés | Hérite du type SharePoint “Document”. Type abstrait de fait : porte le tronc commun (niveau 2), aucun document n'est censé être créé directement avec ce type. |
| GED – Document interne | DI | Procédures, politiques, comptes rendus, documents de gestion | Origine interne. Enfant de GED Document ; Domaine = Interne ; taxonomie diapo 14 ; champs spécifiques niveau 4 « Interne ». |
| GED – Document externe | DE | Contrats, normes, documents fournisseurs, courriers officiels | Origine externe. Enfant de GED Document ; Domaine = Externe ; taxonomie diapo 15 ; Organisme source devient obligatoire. |
| GED – Document projet | DP | Documents liés à la gouvernance, la conception, l’exécution, la clôture | Lié à un projet. Enfant de GED Document ; Domaine = Projet ; taxonomie diapo 16 ; Code projet obligatoire (niveau 4). |
| GED – Document recherche | DR | Études, essais, analyses, publications, propriété intellectuelle | Lié à la recherche. Enfant de GED Document ; Domaine = Recherche ; taxonomie diapo 17 ; champs Programme/Thème/ID étude (niveau 4). |

### 4.2 Niveau 2 : tronc commun (20 champs)

| # | Champ | Type | Obligatoire | Utilité |
|---|---|---|---|---|
| 1 | ID document | Texte / généré automatiquement | Oui | Référence unique et immuable |
| 2 | Titre | Texte | Oui | Nom lisible du document |
| 3 | Domaine | Dérivé du type de contenu | Oui | Interne / Externe / Projet / Recherche |
| 4 | Catégorie | Métadonnée gérée | Oui | Famille fonctionnelle |
| 5 | Type de document | Métadonnée gérée | Oui | Classe principale |
| 6 | Sous-type de document | Métadonnée gérée | Non | Niveau de détail supplémentaire |
| 7 | Propriétaire du document | Personne | Oui | Responsable métier interne |
| 8 | Auteur | Personne ou texte | Oui | Auteur réel ou organisme émetteur |
| 9 | Statut | Choix | Oui | Brouillon / En révision / Approuvé / En vigueur / Remplacé / Archivé / Obsolète |
| 10 | Département / Fonction | Métadonnée gérée | Oui | Entité métier |
| 11 | Niveau de confidentialité | Choix | Oui | Interne / Confidentiel / Très confidentiel / Restreint |
| 12 | Mots-clés | Métadonnée gérée multiple | Non | Recherche complémentaire |
| 13 | Version / Révision | Texte | Oui | Suivi des versions |
| 14 | Date d’émission | Date | Oui | Première émission |
| 15 | Date d’effet | Date | Non | Début de validité |
| 16 | Date de révision | Date | Non | Révision prévue |
| 17 | Date d’expiration | Date | Non | Fin de validité |
| 18 | Langue | Choix | Non | Gestion multilingue |
| 19 | Classe de conservation | Métadonnée gérée | Oui | Rétention / conformité |
| 20 | Organisme source | Métadonnée gérée | Conditionnel | Obligatoire pour les documents externes |

### 4.3 Statuts et confidentialité

- **Statuts (7)** : Brouillon / En révision / Approuvé / En vigueur / Remplacé / Archivé / Obsolète.
- **Niveaux de confidentialité (4)**, dans l'ordre du deck : Interne / Confidentiel / Très confidentiel / Restreint. Pas de niveau « Public ».

### 4.4 Niveau 3 : taxonomie par domaine

23 catégories, 45 types et 157 exemples de sous-types. DI : 4 catégories, 10 types, 35 sous-types ; DE : 5 catégories, 10 types, 38 sous-types ; DP : 6 catégories, 12 types, 42 sous-types ; DR : 8 catégories, 13 types, 42 sous-types. Chaque domaine a ses propres catégories ; aucun nom de type ou de catégorie ne se répète d'un domaine à l'autre.

#### DI — Document interne

| Catégorie | Type | Exemples de sous-types |
|---|---|---|
| Gouvernance & Management | Politique | Politique groupe · politique départementale · politique sécurité |
| Gouvernance & Management | Procédure | Procédure standard · SOP · instruction de travail |
| Gouvernance & Management | Enregistrement de gouvernance | PV de comité · PV de réunion · journal de décisions · plan d’actions |
| Qualité / QHSE | Audit & Inspection | Rapport d’audit interne · checklist d’inspection · fiche de non-conformité |
| Qualité / QHSE | Sécurité & Risques | Analyse de risques · rapport d’incident · plan CAPA |
| Opérations | Maîtrise opérationnelle | Procédure d’exploitation · passation de consignes · guide de dépannage |
| Opérations | Maintenance & Actifs | Instruction de maintenance · journal de maintenance · certificat d’étalonnage · registre d’actifs |
| Fonctions support | RH & Formation | Fiche de poste · matrice de compétences · support de formation · feuille de présence |
| Fonctions support | Finance & Administration | Budget · demande d’achat · procédure de dépenses · fiche de contrôle d’actifs |
| Fonctions support | IT & Sécurité de l’information | Procédure d’accès · procédure de sauvegarde · PRA/PCA · standard système |

#### DE — Document externe

| Catégorie | Type | Exemples de sous-types |
|---|---|---|
| Réglementaire & Normatif | Règlementation | Loi · décret · circulaire · guide officiel |
| Réglementaire & Normatif | Permis / Certification | Permis · licence · certificat · notification d’approbation |
| Réglementaire & Normatif | Norme / Référentiel | Norme ISO · norme métier · standard client |
| Contrats & Juridique | Accord | NDA · contrat-cadre · contrat fournisseur · avenant |
| Contrats & Juridique | Acte juridique | Conditions générales · avis juridique · notification de réclamation |
| Fournisseurs / Fabricants | Documentation technique | Datasheet · manuel utilisateur · guide d’installation · manuel de maintenance |
| Fournisseurs / Fabricants | Documentation qualité | Certificat de conformité · certificat d’essai · rapport d’inspection |
| Clients / Partenaires | Correspondance | Courrier officiel · bordereau de transmission · email formalisé · note de réunion |
| Clients / Partenaires | Échange commercial | RFQ · offre · bon de commande · facture · bon de livraison |
| Évaluations tierces | Rapport externe | Rapport d’audit · rapport laboratoire · expertise · rapport d’enquête |

#### DP — Document projet

| Catégorie | Type | Exemples de sous-types |
|---|---|---|
| Gouvernance projet | Définition du projet | Charte projet · business case · PID · plan d’exécution |
| Gouvernance projet | Pilotage & Décisions | Dossier comité de pilotage · journal de décisions · RAID log |
| Planification & Contrôle | Planning & Coûts | Planning de référence · plan jalons · budget initial · rapport de coûts |
| Planification & Contrôle | Reporting d’avancement | Rapport hebdomadaire · rapport mensuel · tableau de bord KPI |
| Ingénierie & Conception | Exigences | Besoin métier · spécification fonctionnelle · spécification technique |
| Ingénierie & Conception | Livrables de conception | Plans · note de calcul · rapport de revue de conception |
| Achats & Contrats | Consultation | RFP · RFQ · évaluation d’offres · recommandation fournisseur |
| Achats & Contrats | Administration contractuelle | Demande d’achat · ordre de changement · dossier fournisseur |
| Exécution & Chantier | Exécution terrain | Méthode · dossier de travaux · instruction chantier · fiche d’installation |
| Exécution & Chantier | Essais & Mise en service | Plan de test · ITP · procédure de commissioning · enregistrement d’essai |
| Handover & Clôture | Remise / Handover | Dossier as-built · punch list · certificat de réception · dossier de transfert |
| Handover & Clôture | Clôture | Retour d’expérience · rapport de clôture · index d’archivage |

#### DR — Document recherche

| Catégorie | Type | Exemples de sous-types |
|---|---|---|
| Gouvernance de la recherche | Proposition & Autorisation | Proposition de recherche · dossier éthique · demande de financement |
| Gouvernance de la recherche | Pilotage du programme | Plan de recherche · revue de jalons · compte rendu de réunion scientifique |
| Revue de connaissances | Revue bibliographique | Bibliographie · revue annotée · état de l’art |
| Revue de connaissances | Antériorité & Benchmark | Revue brevets · étude comparative · veille technologique |
| Conception d’étude | Protocoles | Protocole expérimental · matrice d’essais · plan d’échantillonnage |
| Conception d’étude | Planification des données | Plan de gestion des données · dictionnaire de données · schéma de codification |
| Données & Expériences | Preuves brutes | Jeu de données brut · cahier de laboratoire · journal d’observation · export instrument |
| Données & Expériences | Données préparées | Jeu de données nettoyé · dataset dérivé · base d’images annotées |
| Analyse & Modélisation | Analyse quantitative | Analyse statistique · classeur de calcul · étude de sensibilité |
| Analyse & Modélisation | Simulation & Modélisation | Fichier modèle · journal d’hypothèses · rapport de validation |
| PI & Savoir confidentiel | Protection intellectuelle | Déclaration d’invention · brouillon de brevet · note technique confidentielle |
| Résultats & Diffusion | Publication | Résumé · manuscrit · poster · article publié · présentation conférence |
| Collaboration externe | Collaboration | Livrable de consortium · commentaires relecteurs · accord de collaboration |

### 4.5 Niveau 4 : champs supplémentaires obligatoires par domaine

| Domaine | Champs supplémentaires obligatoires |
|---|---|
| Interne (DI) | Propriétaire de processus, autorité d’approbation, département, niveau de confidentialité |
| Externe (DE) | Organisme source, référence externe, sens du document (entrant/sortant), date de réception |
| Projet (DP) | Code projet, phase projet, lot / work package, discipline |
| Recherche (DR) | Programme de recherche, thème de recherche, ID étude/essai, statut publication / PI |

La slide 18 intitule cette colonne « Champs supplémentaires obligatoires » : les 16 champs sont obligatoires pour leur
domaine. Le deck ne donne ni leur type ni leurs listes de valeurs.

### 4.6 Règles implicites relevées par l'audit

Les quatre dernières règles comparent le deck à Codex v1 ; l'état actuel est au §5.

1. Héritage (diapo 12) : tout document contrôlé porte exactement un type de contenu enfant (DI, DE, DP ou DR) qui hérite de « GED Document », lui-même hérité du type SharePoint « Document ». Les 20 champs du tronc commun (niveau 2) sont portés par le parent, donc présents sur les 4 domaines ; les champs du niveau 4 sont portés par chaque type enfant et s'ajoutent au tronc commun.
2. Domaine dérivé du type de contenu (diapo 13) : jamais saisi, calculé — DI → Interne, DE → Externe, DP → Projet, DR → Recherche. Changer de domaine revient à changer de type de contenu.
3. ID document : généré automatiquement à la création, unique et immuable (diapo 13). Les diapos 7, 8, 9 et 11 précisent que la création fournit l'ID et que la codification du nom est automatique « en fonction de son type » : le format de l'ID dépend donc du type (au moins du domaine), mais aucun format n'est donné. Point à trancher : immuabilité si le type/la catégorie change après création (l'ID ne doit pas bouger).
4. Taxonomie en cascade à 3 niveaux, filtrée par domaine : Catégorie (obligatoire) ∈ catégories du domaine → Type de document (obligatoire) ∈ types de la catégorie → Sous-type (facultatif) ∈ sous-types du type. Une catégorie ou un type n'appartient qu'à un seul domaine (les noms ne se répètent pas d'une diapo à l'autre).
5. Les sous-types sont présentés comme « Exemples de sous-types » : liste ouverte/non exhaustive, à compléter dans le magasin de termes ; le champ Sous-type reste facultatif.
6. Vocabulaires contrôlés : Catégorie, Type de document, Sous-type, Département / Fonction, Mots-clés (multivalué), Classe de conservation et Organisme source sont des « Métadonnées gérées » (bibliothèque de termes SharePoint, diapo 6 étape 2) : listes administrées centralement, pas de texte libre. Statut, Niveau de confidentialité et Langue sont des « Choix » (listes fermées).
7. Organisme source : conditionnel — obligatoire si Domaine = Externe (diapo 13), confirmé au niveau 4 Externe ; facultatif pour DI/DP/DR.
8. Auteur : « Personne ou texte » — personne interne pour DI/DP/DR, organisme émetteur (texte) possible pour DE. Propriétaire du document : toujours une personne interne (« Responsable métier interne »), y compris pour un document externe.
9. Redondances à résoudre au niveau 4 Interne : « département » et « niveau de confidentialité » sont déjà obligatoires dans le tronc commun (Département / Fonction, Niveau de confidentialité) ; de même « Organisme source » (Externe) existe déjà au tronc commun en conditionnel. Ces champs ne doivent pas être dupliqués : le niveau 4 les rend simplement obligatoires/visibles pour le domaine.
10. Cycle de vie (Statut, 7 valeurs) : Brouillon → En révision → Approuvé → En vigueur → Remplacé / Archivé / Obsolète. Les passages sont pilotés par workflows (diapos 8-9) : validation avec circuit prédéfini selon le type de document ; modification d'un document validé via demande de modification (principe ECR/ECO) ; passage à Obsolète via demande dédiée. Seuls l'état initial (Brouillon) et l'existence des 7 valeurs sont explicites ; les transitions exactes sont implicites.
11. Distinction Approuvé / En vigueur implicite : un document approuvé passe « En vigueur » à sa Date d’effet (début de validité) ; « Remplacé » suppose un lien vers le document ou la révision qui le remplace (aucun champ prévu pour ce lien).
12. Dates (diapo 13) : Date d’émission obligatoire = première émission (ne change pas aux révisions) ; Date d’effet, Date de révision (révision prévue → rappel/workflow de revue) et Date d’expiration (fin de validité → déclencheur vers Obsolète/Archivé) facultatives. Cohérence attendue : émission ≤ effet ≤ expiration.
13. Version / Révision : texte obligatoire, alimenté par le versioning de la bibliothèque (diapo 7 étape 3) ; une modification d'un document validé crée une nouvelle révision via ECR/ECO.
14. Classe de conservation obligatoire : pilote la rétention et la conformité (sort final, durée) ; valeurs non définies dans la présentation.
15. Accès (diapo 10) : restrictions possibles selon la classe de confidentialité et le statut — un document en « Brouillon » n'est pas visible de tous. L'ordre de sensibilité des 4 niveaux n'est pas explicite (« Restreint » est cité en dernier : à préciser par rapport à « Très confidentiel ») ; aucun niveau « Public » n'existe.
16. Bibliothèque unique (diapos 5-7) : tous les documents dans une seule bibliothèque ; le classement par dossiers est remplacé par les métadonnées, qui servent de filtres de recherche et alimentent des pages métiers pré-filtrées (diapo 10). Les anciennes arborescences sont migrées par vagues puis supprimées/archivées.
17. Modèles (diapo 7 étape 4) : des documents types (templates) sont rattachés aux types de document pour la création.
18. Niveau 4 Externe : « sens du document (entrant/sortant) » est un choix à 2 valeurs ; « date de réception » n'a de sens que pour un document entrant (obligation probablement conditionnée au sens). « référence externe » = référence de l'émetteur.
19. Niveau 4 Projet : « Code projet » rattache le document à un projet (dans Codex : le code d'affaire Keystone) ; « phase projet » est à aligner sur les catégories DP (Gouvernance → Clôture) ; listes de « discipline » et de « lot / work package » non définies.
20. Niveau 4 Recherche : listes de « Programme de recherche », « thème de recherche » et valeurs de « statut publication / PI » non définies ; « ID étude/essai » est un identifiant distinct de l'ID document.
21. Recouvrements de vocabulaire entre domaines à arbitrer : « journal de décisions » (DI Enregistrement de gouvernance et DP Pilotage & Décisions), « demande d’achat » (DI Finance & Administration et DP Administration contractuelle), « RFQ » (DE Échange commercial et DP Consultation), « Rapport d’audit » (DE) vs « Rapport d’audit interne » (DI). Le domaine (via le type de contenu) est le discriminant.
22. Coquilles de la source à corriger à l'intégration : « Règlementation » (type DE, alors que la catégorie dit « Réglementaire ») et « hiérachie » (titre diapo 12).
23. [Écart Codex] Statuts : Codex n'a que draft/review/published/archived (4) ; manquent Approuvé (distinct de En vigueur), Remplacé et Obsolète.
24. [Écart Codex] Confidentialité : Codex a public/interne/restreint/confidentiel ; la présentation n'a pas « Public » et ajoute « Très confidentiel ».
25. [Écart Codex] Classement : Codex utilise 4 axes plats (entité/site, service, processus, type parmi 22 types métier explosifs) ; la présentation impose Domaine → Catégorie → Type → Sous-type (45 types) et n'a ni axe processus ni axe entité/site (seul « Département / Fonction » ≈ service).
26. [Écart Codex] Table documents : manquent domaine/type de contenu, catégorie, sous-type, auteur distinct du propriétaire, dates d'émission/effet/révision/expiration, organisme source et tous les champs du niveau 4 (seul affaireCode ≈ Code projet). Classe de conservation ≈ ruleId (règle de rétention). ID Codex « D-#### » / « &lt;affaire>-DOC-### » : non codifié par type.

### 4.7 Contrôle de la transcription

Une relecture indépendante a comparé chaque cellule de la transcription au deck. Verdict : **transcription exacte**.

Erreurs et réserves relevées :

- Constat global : la transcription est exacte. J'ai comparé chaque cellule avec la transcription tabulaire du deck (fichier de travail de la session, non versionné) : 5 types de contenu (diapo 12), 20 champs du tronc commun avec type, caractère obligatoire et utilité (diapo 13), 7 statuts, 4 niveaux de confidentialité, 45 couples catégorie/type et 157 sous-types, chacun dans la bonne catégorie et le bon domaine (diapos 14-17 : DI 10 lignes et 35 sous-types, DE 10 et 38, DP 12 et 42, DR 13 et 42), et 16 champs de niveau 4 (diapo 18). Je n'ai trouvé aucun champ erroné, aucun type ou caractère obligatoire inversé, aucun mauvais rattachement catégorie/type, aucun sous-type fusionné ou scindé (« PRA/PCA », « contrat-cadre », « Remise / Handover », « Permis / Certification » sont bien conservés). Les compteurs sont justes : 23 catégories, 157 sous-types, 45 lignes, 20 champs. Les points ci-dessous portent uniquement sur les annotations et les règles dérivées.
- Règle dérivée en contradiction avec la source : « date de réception … obligation probablement conditionnée au sens » (règle « Niveau 4 Externe »). L'en-tête de la diapo 18 dit « Champs supplémentaires obligatoires » : la date de réception est donc obligatoire pour tout document externe. Rendre ce champ obligatoire seulement pour les documents entrants est une proposition d'assouplissement, à présenter comme une question pour l'utilisateur et non comme une règle implicite.
- Règle dérivée trop restrictive : « Auteur : personne interne pour DI/DP/DR, organisme émetteur (texte) possible pour DE ». La diapo 13 dit seulement « Personne ou texte », sans lien avec le domaine. Plusieurs sous-types hors DE ont un auteur externe : DR « Livrable de consortium », « commentaires relecteurs », « accord de collaboration » ; DP « dossier fournisseur ». L'option texte doit rester ouverte pour les 4 domaines.
- Qualification inexacte : « Règlementation » est présenté comme une coquille. Depuis les rectifications orthographiques de 1990, « règlementation » est une graphie admise. Ce n'est donc pas une faute mais une incohérence avec « Réglementaire & Normatif », à harmoniser. « hiérachie » (titre de la diapo 12) est bien une coquille ; la diapo 1 écrit correctement « hiérarchie ».
- Inférence présentée comme acquise (règle « ID document ») : la diapo 7 parle de « Codification automatique du nom de document en fonction de son type ». La diapo 11 parle de « fourniture de leur ID unique », les diapos 8-9 de « codification du document ». Conclure que « le format de l'ID dépend donc du type » mélange la codification du nom et l'identifiant. Il faut trancher si la codification porte sur l'ID document, sur le nom du fichier, ou sur les deux. Le tronc commun n'a pas de champ « nom de fichier » distinct du Titre.
- [Écart Codex] nuancé à tort : « auteur distinct du propriétaire » est déclaré manquant. Codex a déjà document_versions.authorId, l'auteur de chaque version, limité à un utilisateur interne. Ce qui manque vraiment, c'est un Auteur au niveau du document, de type « Personne ou texte ». De même, « date d'émission » n'est pas totalement absente : documents.createdAt en est une approximation. Restent réellement absentes les dates d'effet, de révision et d'expiration.
- [Écart Codex] incomplet : les Mots-clés de Codex sont du texte libre (jsonb string[]), alors que la diapo 13 en fait une « Métadonnée gérée multiple », issue d'un vocabulaire contrôlé. Langue (documents.lang) existe dans Codex mais n'est pas mentionnée comme couverte.

Omissions relevées :

- Caractère obligatoire du niveau 4 non transcrit : l'en-tête de la colonne de la diapo 18 est « Champs supplémentaires obligatoires », mais specificFields ne contient aucun indicateur obligatoire = Oui. Les 16 champs de niveau 4 sont tous obligatoires pour leur domaine. Cette information n'apparaît que partiellement dans les remarques des types de contenu (Organisme source pour DE, Code projet pour DP).
- Remarque du type « GED – Document recherche » incomplète : elle ne cite que « Programme/Thème/ID étude (niveau 4) » et oublie le 4e champ, « statut publication / PI ». La remarque DI ne nomme aucun des 4 champs (Propriétaire de processus, autorité d'approbation, département, niveau de confidentialité). La remarque DP ne cite que Code projet sur 4 (il manque phase projet, lot / work package et discipline).
- Statut « validé » absent de la liste : les diapos 8, 9 et 11 parlent de « document validé » et de « statut validé » (« demandes de modification d'un document déjà en statut validé »), mais « Validé » ne figure pas parmi les 7 valeurs du Statut (diapo 13). La règle sur le cycle de vie doit faire correspondre explicitement « validé » à Approuvé et/ou En vigueur.
- Types des champs de niveau 4 non signalés comme indéfinis : la diapo 18 n'a pas de colonne Type. Il faudrait noter que les types restent à fixer pour Propriétaire de processus (Personne ?), autorité d'approbation (Personne ou groupe ?), référence externe (Texte), date de réception (Date), phase projet (Choix ?), ID étude/essai (Texte) et statut publication / PI (Choix ?). Ce dernier libellé peut aussi désigner deux notions distinctes : statut de publication et statut de propriété intellectuelle.
- Redondance non relevée au niveau 4 Interne : « Propriétaire de processus » est distinct du champ « Propriétaire du document » du tronc commun (Responsable métier interne). Il faut préciser la différence pour éviter la confusion à la saisie. La règle sur les redondances ne traite que département, niveau de confidentialité et Organisme source.
- Recouvrements de vocabulaire, compléments non exacts : les 3 doublons exacts sont bien recensés (journal de décisions, demande d'achat, RFQ ; vérifié par script, il n'y en a pas d'autre). En revanche, la liste omet des quasi-doublons ou synonymes à arbitrer dans le magasin de termes : « Procédure standard » et « SOP » dans la même ligne (synonymes, DI Procédure) ; « accord de collaboration » (sous-type DR) face au type DE « Accord » ; « Budget » (DI) et « budget initial » (DP) ; « certificat » (DE Permis / Certification) face à « Certificat de conformité » et « certificat d'essai » (DE), « certificat d'étalonnage » (DI) et « certificat de réception » (DP) ; « note de réunion » (DE), « PV de réunion » (DI) et « compte rendu de réunion scientifique » (DR).
- Normalisation des libellés non faite : les sous-types gardent la casse de la source (seul le premier de chaque liste a une majuscule : « Politique groupe », puis « politique départementale »). Pour un magasin de termes, chaque terme devrait commencer par une majuscule de façon homogène.
- Écart de terminologie non relevé : la diapo 10 dit « classe de confidentialité », la diapo 13 « Niveau de confidentialité ». C'est sans conséquence, mais il faut un seul libellé dans l'application.
- Compteurs incomplets (mineur) : counts n'indique ni le nombre de types de document (45, tous uniques, aucun nom de type ou de catégorie partagé entre deux domaines : vérifié) ni le nombre de champs de niveau 4 (16 = 4 × 4).

## 5. Écarts deck ↔ Codex

### 5.1 Bilan

L'analyse a comparé 48 éléments du deck au code de la v1. Chaque écart a ensuite été revérifié dans le code par un
agent distinct.

| Statut | Proposé par l'analyse | Retenu après vérification |
|---|---|---|
| couvert | 10 | 6 |
| partiel | 17 | 21 |
| absent | 12 | 12 |
| en conflit | 9 | 9 |
| **Total** | 48 | 48 |

La vérification a ramené 4 écarts de « couvert » à « partiel » (G05, G15, G17, G48) et confirmé tous les autres. Effort estimé : 21 faibles, 21 moyens, 6 importants. C'est le décompte vérifié qui a été donné à l'utilisateur.

**Aujourd'hui (9 octobre 2026)** :

| Statut aujourd'hui | Nombre | Écarts |
|---|---|---|
| intégré | 30 | G04, G05, G06, G07, G08, G09, G10, G11, G14, G17, G20, G21, G22, G23, G24, G25, G26, G27, G28, G29, G30, G31, G33, G34, G35, G36, G37, G38, G41, G47 |
| partiel | 15 | G02, G03, G12, G13, G15, G18, G19, G32, G39, G40, G42, G43, G44, G45, G48 |
| non fait | 0 | — |
| écarté par décision | 3 | G01, G16, G46 |

« Intégré » veut dire que le code couvre le besoin du deck, éventuellement sous la forme fixée par une décision (par exemple les deux axes de D-08 à la place des domaines) ; les réserves restantes sont dans les fiches. « Écarté par décision » : l'utilisateur a choisi une autre voie que le deck.

### 5.2 Tableau des écarts

« Statut 7 oct. » : statut proposé, puis statut retenu après vérification. « Aujourd'hui » : état du code au
9 octobre 2026, déterminé en lisant le code (justification dans les fiches du §5.3).

| N° | Écart | Statut 7 oct. | Effort | Aujourd'hui |
|---|---|---|---|---|
| [G01](#g01) | Choix de la pile Microsoft (bibliothèque SharePoint + Power Automate + Power Apps) | en conflit | important | **écarté par décision** |
| [G02](#g02) | Bibliothèque de documents unique servant de base de données et de coffre-fort | partiel | moyen | **partiel** |
| [G03](#g03) | Métadonnées gérées dans la bibliothèque de termes (Term Store) | partiel | moyen | **partiel** |
| [G04](#g04) | Codification automatique du nom / de l'ID du document selon son type | partiel | moyen | intégré |
| [G05](#g05) | Gestion du versioning des documents | couvert → **partiel** | faible | intégré |
| [G06](#g06) | Création des premiers documents types (modèles / templates) | partiel | moyen | intégré |
| [G07](#g07) | Workflow de création de document (avec codification automatique) | partiel | moyen | intégré |
| [G08](#g08) | Workflow de validation avec circuit prédéfini selon le type de document | partiel | moyen | intégré |
| [G09](#g09) | Modification d'un document validé (principe ECR/ECO) et demandes de modification | en conflit | important | intégré |
| [G10](#g10) | Passage d'un document à l'état obsolète (et demandes associées) | absent | moyen | intégré |
| [G11](#g11) | Accès via l'application commune unique « GED EPC2I » | couvert | faible | intégré |
| [G12](#g12) | Pages dédiées par métier / département mettant en avant les filtres principaux | partiel | moyen | **partiel** |
| [G13](#g13) | Restriction des accès (classe de confidentialité, statut brouillon…) | absent | important | **partiel** |
| [G14](#g14) | Fonction : création de documents et fourniture de leur ID unique | partiel | moyen | intégré |
| [G15](#g15) | Fonction : recherche de n'importe quel document depuis l'app unique (filtres de recherche) | couvert → **partiel** | faible | **partiel** |
| [G16](#g16) | Liens pour ouvrir le document (vers la bibliothèque SharePoint) | partiel | moyen | **écarté par décision** |
| [G17](#g17) | Fonction : validations de documents (nouveaux ou modifiés) | couvert → **partiel** | faible | intégré |
| [G18](#g18) | Fonction : suivi des workflows en cours lancés par l'utilisateur | partiel | faible | **partiel** |
| [G19](#g19) | Fonction : suivi des actions en attente de l'utilisateur | couvert | faible | **partiel** |
| [G20](#g20) | Niveau 1 – Hiérarchie des types de contenu (GED Document parent + 4 types) | absent | moyen | intégré |
| [G21](#g21) | Tronc commun : ID document | couvert | faible | intégré |
| [G22](#g22) | Tronc commun : Titre | couvert | faible | intégré |
| [G23](#g23) | Tronc commun : Domaine (Interne / Externe / Projet / Recherche) | absent | moyen | intégré |
| [G24](#g24) | Tronc commun : Catégorie (famille fonctionnelle) | en conflit | moyen | intégré |
| [G25](#g25) | Tronc commun : Type de document (classe principale) | en conflit | moyen | intégré |
| [G26](#g26) | Tronc commun : Sous-type de document (facultatif) | absent | faible | intégré |
| [G27](#g27) | Tronc commun : Propriétaire du document (personne, responsable métier interne) | partiel | faible | intégré |
| [G28](#g28) | Tronc commun : Auteur (personne ou texte – auteur réel ou organisme émetteur) | absent | faible | intégré |
| [G29](#g29) | Tronc commun : Statut (liste à 7 valeurs : Brouillon / En révision / Approuvé / En vigueur / Remplacé / Archivé / Obsolète) | en conflit | important | intégré |
| [G30](#g30) | Tronc commun : Département / Fonction (entité métier) | partiel | faible | intégré |
| [G31](#g31) | Tronc commun : Niveau de confidentialité (liste à 4 valeurs : Interne / Confidentiel / Très confidentiel / Restreint) | en conflit | faible | intégré |
| [G32](#g32) | Tronc commun : Mots-clés (métadonnée gérée multiple, facultatif) | partiel | faible | **partiel** |
| [G33](#g33) | Tronc commun : Version / Révision | couvert | faible | intégré |
| [G34](#g34) | Tronc commun : Date d'émission (obligatoire, première émission) | partiel | faible | intégré |
| [G35](#g35) | Tronc commun : Date d'effet (début de validité) | absent | faible | intégré |
| [G36](#g36) | Tronc commun : Date de révision (prévue) | absent | moyen | intégré |
| [G37](#g37) | Tronc commun : Date d'expiration (fin de validité) | en conflit | moyen | intégré |
| [G38](#g38) | Tronc commun : Langue (choix, facultatif) | couvert | faible | intégré |
| [G39](#g39) | Tronc commun : Classe de conservation (métadonnée gérée, obligatoire) | partiel | moyen | **partiel** |
| [G40](#g40) | Tronc commun : Organisme source (conditionnel, obligatoire pour les documents externes) | absent | faible | **partiel** |
| [G41](#g41) | Niveau 3 – Taxonomie Domaine › Catégorie › Type › Sous-type (DI, DE, DP, DR) | en conflit | important | intégré |
| [G42](#g42) | Niveau 4 – Champs spécifiques DI (propriétaire de processus, autorité d'approbation, département, niveau de confidentialité) | partiel | moyen | **partiel** |
| [G43](#g43) | Niveau 4 – Champs spécifiques DE (organisme source, référence externe, sens entrant/sortant, date de réception) | absent | faible | **partiel** |
| [G44](#g44) | Niveau 4 – Champs spécifiques DP (code projet, phase projet, lot / work package, discipline) | partiel | moyen | **partiel** |
| [G45](#g45) | Niveau 4 – Champs spécifiques DR (programme de recherche, thème, ID étude/essai, statut publication / PI) | absent | moyen | **partiel** |
| [G46](#g46) | Migration des documents existants par vagues (état de l'art des arborescences, suppression/archivage des anciennes) | absent | important | **écarté par décision** |
| [G47](#g47) | Axes de Codex absents du deck : Entité/site (et espaces), Processus | en conflit | moyen | intégré |
| [G48](#g48) | Traçabilité et conformité (journal d'audit, conservation légale) | couvert → **partiel** | faible | **partiel** |

### 5.3 Fiches des écarts

Pour chaque écart : ce que l'audit a constaté sur la v1, ce que la vérification a confirmé ou corrigé, puis l'état
d'aujourd'hui. Les deux premiers points résument le texte du 7 octobre : sa version intégrale citait ligne à ligne le
code de la v1, qui n'existe plus, et n'est donc pas reprise. Les adaptations que l'audit proposait ont été remplacées
par les décisions D-06 à D-21 et par le modèle v2.

<a id="g01"></a>
#### G01 — Choix de la pile Microsoft (bibliothèque SharePoint + Power Automate + Power Apps)

*Deck* : Slides 4-5 (logos SharePoint, Power Automate, Power Apps, Power BI, Power Pages, Power Virtual Agents sur les slides 4 à 9). *Statut le 7 octobre* : en conflit. *Effort estimé* : important.

- **Constat sur la v1** : Codex v1 était une application Next.js autonome (PGlite embarqué, fichiers sur disque local, circuits en Server Actions), sans aucune dépendance Microsoft. Le deck construit la GED sur SharePoint, Power Automate et Power Apps.
- **Vérification** : « En conflit », confirmé. La vérification ajoute que Codex se présentait déjà comme « le coffre-fort documentaire du groupe », que la slide 9 prévoit des liens vers SharePoint et que la slide 12 fait hériter les types de contenu du type SharePoint « Document ».
- **Aujourd'hui — écarté par décision.** D-06 : Codex prend tout en charge, workflows compris ; ni Power Automate ni Power Apps (`docs/modele-cible.md` §1). Seule option ouverte : stocker les fichiers dans une bibliothèque SharePoint pilotée par Codex. Le pilote existe (`src/lib/storage.ts`, `CODEX_STORAGE=sharepoint`, Microsoft Graph avec l'identité de l'application) mais n'a jamais été essayé sur un vrai tenant (`docs/avancement-v2.md`, « Reste à faire »).

<a id="g02"></a>
#### G02 — Bibliothèque de documents unique servant de base de données et de coffre-fort

*Deck* : Slide 5 ; slide 6 étape 3 ; slide 7 étape 1. *Statut le 7 octobre* : partiel. *Effort estimé* : moyen.

- **Constat sur la v1** : Référentiel unique (une table `documents` et une table de versions), verrous sur les documents archivés ou gelés, journal d'audit. Mais aucun contrôle en lecture, aucun chiffrement, fichiers dans `.data/files`, PGlite dans un seul processus.
- **Vérification** : « Partiel », confirmé. Aucune action ne supprimait de document ni de fichier, ce qui allait dans le sens du coffre-fort ; la destruction n'était implémentée nulle part.
- **Aujourd'hui — partiel.** La forme « bibliothèque SharePoint = base + coffre » est écartée (D-06), mais le besoin d'un référentiel unique tient : une seule table `documents` (`src/db/schema.ts`). Le contrôle en lecture existe (`src/lib/access.ts`) et les documents archivés, obsolètes ou gelés sont verrouillés (`lockOf`, `src/lib/lifecycle.ts`). Reste : PGlite dans un seul processus (`src/db/index.ts`), fichiers par défaut sur le disque local sans chiffrement, stockage SharePoint jamais testé, ni Postgres serveur ni sauvegarde.

<a id="g03"></a>
#### G03 — Métadonnées gérées dans la bibliothèque de termes (Term Store)

*Deck* : Slide 6 étape 2 ; slide 7 étape 2. *Statut le 7 octobre* : partiel. *Effort estimé* : moyen.

- **Constat sur la v1** : Table `taxonomy` plate (axes entité, service, processus, type, confidentialité). On ne pouvait ajouter des valeurs que sur 4 axes, sans hiérarchie, renommage ni désactivation.
- **Vérification** : « Partiel », confirmé. Mots-clés en texte libre ; les 22 types de la maquette (activité explosifs) n'avaient aucun rapport avec la taxonomie du deck : tout le référentiel était à reprendre.
- **Aujourd'hui — partiel.** Par décision, le référentiel est le registre des types de Codex et non la banque de termes SharePoint (D-06, D-07) : 23 familles et 69 types avec leurs sous-types (`src/db/registry.ts`), départements et sites (`src/db/seed-org.ts`), fonctions. Administration › Registre des types modifie le circuit, la confidentialité, la conservation et l'activation d'un type (`updateType`, `src/lib/actions.ts`) ; Administration › Organisation ajoute des départements et des sites (`addOrgValue`). Reste : on ne peut ni créer un type ou une famille, ni modifier libellés et sous-types depuis l'écran, ni renommer ou retirer un département ; mots-clés et organisme source sont du texte libre.

<a id="g04"></a>
#### G04 — Codification automatique du nom / de l'ID du document selon son type

*Deck* : Slide 7 étape 2 ; slide 8 ; slide 9 ; slide 11. *Statut le 7 octobre* : partiel. *Effort estimé* : moyen.

- **Constat sur la v1** : `nextDocId` produisait `D-####` ou `<affaire>-DOC-###`, sans le type. Le fichier gardait son nom d'origine. Le type pouvait changer sans toucher à l'ID.
- **Vérification** : « Partiel », confirmé. Un document rattaché après coup à une affaire gardait son `D-####`.
- **Aujourd'hui — intégré.** Identifiant `TYPE-CONTEXTE-SEQ` (`formatId` et `contextOf` dans `src/lib/codes.ts`, `nextDocId` dans `src/lib/codification.ts`), attribué à la création du brouillon (D-09, D-10). Avant la première approbation, un reclassement donne un nouvel ID et garde l'ancien en alias (`updateMeta`, `src/lib/actions.ts`). Le fichier stocké est nommé `{ID}_{indice}` (`nameStoredFile`, `src/lib/storage.ts`), comme le nom proposé au téléchargement (`src/app/api/documents/[id]/file/route.ts`). Réserve : après un reclassement, les fichiers déjà stockés gardent leur ancien nom, `updateMeta` ne les renomme pas (T-03).

<a id="g05"></a>
#### G05 — Gestion du versioning des documents

*Deck* : Slide 7 étape 3. *Statut le 7 octobre* : couvert, ramené à partiel par la vérification. *Effort estimé* : faible.

- **Constat sur la v1** : Table `document_versions` (fichier, auteur, date, commentaire), versions mineures et majeures, restauration, comparaison.
- **Vérification** : « Couvert » ramené à « partiel ». Une publication ne produisait pas de version majeure ; la dernière version était toujours celle servie, donc aucune version approuvée ne restait en vigueur pendant la rédaction de la suivante ; les métadonnées n'étaient pas versionnées ; la comparaison ne portait que sur les attributs des versions.
- **Aujourd'hui — intégré.** Révisions en lettres et versions de travail A.1, A.2 (tables `revisions` et `working_versions` dans `src/db/schema.ts` ; `addWorkingVersion` dans `src/lib/actions.ts` ; `nextLetter` dans `src/lib/codes.ts`), selon D-11 et D-12. La révision en vigueur reste servie aux lecteurs pendant qu'on rédige la suivante (`src/app/api/documents/[id]/file/route.ts`). Réserves : les métadonnées ne sont toujours pas versionnées (`updateMeta` écrase, le journal ne garde que l'action) ; « Comparer » ne compare que les attributs des versions (dialogue `Compare`, `src/components/dialogs/Dialogs.tsx`).

<a id="g06"></a>
#### G06 — Création des premiers documents types (modèles / templates)

*Deck* : Slide 7 étape 4. *Statut le 7 octobre* : partiel. *Effort estimé* : moyen.

- **Constat sur la v1** : Table `templates` sans fichier : le brouillon créé depuis un modèle n'avait aucun contenu, s'appelait « Sans titre — … » et recevait un service et un processus codés en dur.
- **Vérification** : « Partiel », confirmé.
- **Aujourd'hui — intégré.** Un modèle est un document de type FRM au contexte QMS (D-10), versionné et validé comme les autres. « Nouveau depuis un modèle » copie le fichier de la révision en vigueur du modèle dans la version A.1 du nouveau document (`createDocument`, `src/lib/actions.ts` ; `isUsableTemplate`, `src/lib/access.ts`). Onglet Administration › Modèles (QMS). Reste : les modèles du jeu de démonstration n'ont pas de fichier (`src/db/seed-docs.ts`) ; les vrais modèles EPC2I sont à fournir.

<a id="g07"></a>
#### G07 — Workflow de création de document (avec codification automatique)

*Deck* : Slide 8 étape 1 ; slide 9 étape 3. *Statut le 7 octobre* : partiel. *Effort estimé* : moyen.

- **Constat sur la v1** : Création immédiate, sans flux. Au dépôt, un utilisateur ayant le droit Publier pouvait publier directement en v1.0. Codification indépendante du type.
- **Vérification** : « Partiel », confirmé. Le propriétaire était imposé (le créateur) et non modifiable.
- **Aujourd'hui — intégré.** `createDocument` (`src/lib/actions.ts`) : choix de l'origine et du rattachement, puis famille › type › sous-type (`DocFields`, `src/components/dialogs/Dialogs.tsx`), titre obligatoire, aperçu du préfixe d'ID, révision A en brouillon. La publication directe a disparu : toute révision passe par `requestValidation`. À la création, le propriétaire est le créateur ; il se transfère ensuite dans « Modifier les métadonnées ».

<a id="g08"></a>
#### G08 — Workflow de validation avec circuit prédéfini selon le type de document

*Deck* : Slide 8 étape 1 ; slide 9 étape 3. *Statut le 7 octobre* : partiel. *Effort estimé* : moyen.

- **Constat sur la v1** : Le moteur de circuit existait (étapes, délégation, commentaires), mais le demandeur choisissait librement un circuit parmi trois et les valideurs étaient codés en dur.
- **Vérification** : « Partiel », confirmé. L'« étape de signature » n'était qu'un indicateur ; toute personne ayant le droit Modifier pouvait lancer un circuit sur n'importe quel document.
- **Aujourd'hui — intégré.** Le circuit est porté par le type (`circuit` dans `src/db/registry.ts`, colonne `doc_types.circuit`). Ses étapes sont des fonctions résolues au lancement selon le département, le projet ou le programme du document (`resolveFunction` et `requestValidation`, `src/lib/actions.ts`) ; l'auteur et le demandeur sont exclus (`circuitExclusions`). C'est D-15. Le circuit d'un type se modifie dans Administration › Registre des types, les titulaires dans Administration › Fonctions & circuits. La matrice type → circuit et les titulaires sont des valeurs de démonstration (O-06).

<a id="g09"></a>
#### G09 — Modification d'un document validé (principe ECR/ECO) et demandes de modification

*Deck* : Slide 8 ; slide 9 ; slide 11 (« demandes de modification d'un document déjà en statut validé »). *Statut le 7 octobre* : en conflit. *Effort estimé* : important.

- **Constat sur la v1** : Aucune notion de demande ni d'ordre de modification. Une nouvelle version d'un document publié restait publiée sans validation si l'auteur avait le droit Publier ; sinon le document repassait en brouillon et la version validée n'était plus en vigueur.
- **Vérification** : « En conflit », confirmé et élargi : les métadonnées d'un document validé étaient modifiables sans demande, même pendant un circuit, et une revue annuelle retirait le document des « publiés ».
- **Aujourd'hui — intégré.** Intégré côté Codex. Par décision, les ECR/ECO sont gérés dans Vigie (D-16, D-18). Dans Codex : bouton « Demander une modification » (`requestChange`), table miroir `change_requests`, décision reçue par le webhook `POST /api/integrations/vigie` ou simulée par un gestionnaire (`simulateVigieDecision`). Une acceptation ouvre la révision suivante en brouillon pour le modificateur désigné, pendant que la révision en vigueur reste servie (`applyChangeDecision` et `openRevision`, `src/lib/lifecycle.ts`). Réserves : les métadonnées d'un document en vigueur restent modifiables sans demande par son propriétaire ou un gestionnaire (`updateMeta`) ; Vigie n'a pas encore de module ECR/ECO ; le branchement réel (`VIGIE_API_URL`, `src/lib/vigie.ts`) n'est pas fait (T-01) ; une demande née dans Keystone reçoit un 404 du webhook (O-10).

<a id="g10"></a>
#### G10 — Passage d'un document à l'état obsolète (et demandes associées)

*Deck* : Slide 8 ; slide 9 ; slide 11 (« demandes de passage d'un document au statut obsolète »). *Statut le 7 octobre* : absent. *Effort estimé* : moyen.

- **Constat sur la v1** : Ni statut Obsolète ni demande. Seul l'archivage existait, sans motif ni circuit, et une restauration remettait toujours le document en « publié ».
- **Vérification** : « Absent », confirmé.
- **Aujourd'hui — intégré.** Intégré côté Codex. Demande de retrait (`requestChange` de type `obsolescence`), décision dans Vigie (D-17), puis état `obsolete` : le circuit en cours est clos et les révisions ouvertes sont annulées (`applyChangeDecision`, `src/lib/lifecycle.ts`). C'est distinct de l'archivage (`archiveDocuments`) ; une restauration d'archive rend au document son état d'avant (`restoreArchived`). Mêmes réserves que G09 sur Vigie.

<a id="g11"></a>
#### G11 — Accès via l'application commune unique « GED EPC2I »

*Deck* : Slide 10. *Statut le 7 octobre* : couvert. *Effort estimé* : faible.

- **Constat sur la v1** : Codex était déjà le point d'accès unique (7 écrans), sous le nom « Codex — GED Groupe ».
- **Vérification** : « Couvert », confirmé, avec deux réserves : pas d'authentification, PGlite et fichiers locaux ; le deck pensait à une application Power Apps.
- **Aujourd'hui — intégré.** Codex est le point d'accès unique et tient le rôle de l'application « GED EPC2I » du deck (D-06). Le nom affiché reste « Codex — GED Groupe » (`src/app/layout.tsx`, `brand_sub` dans `src/lib/i18n.ts`) : le nom « GED EPC2I » n'a pas été repris et l'utilisateur ne s'est pas prononcé. L'identité reste simulée (voir G13).

<a id="g12"></a>
#### G12 — Pages dédiées par métier / département mettant en avant les filtres principaux

*Deck* : Slide 10 ; slide 9 étape 1 (besoins utilisateurs par département). *Statut le 7 octobre* : partiel. *Effort estimé* : moyen.

- **Constat sur la v1** : Aucune page par département. Briques : l'axe Service de l'explorateur, trois recherches enregistrées du jeu de démonstration ; la table `users` n'avait pas de département.
- **Vérification** : « Partiel », confirmé. Tout l'état d'écran est dans l'URL, donc partageable.
- **Aujourd'hui — partiel.** Toujours pas de page par département. Briques : axe Département de l'explorateur (`src/app/explorateur/page.tsx`), facettes de la recherche dans l'URL, département de chaque utilisateur (`users.department`). Depuis le 11 octobre 2026, les recherches enregistrées sont créables : personnelles pour chacun, partagées avec un département ou le groupe par les gestionnaires documentaires et les administrateurs (`saveSearch`, `src/lib/actions.ts` ; point 2 de `docs/reste-a-faire.md`). Le recueil des besoins par département (slide 9) n'est pas fait.

<a id="g13"></a>
#### G13 — Restriction des accès (classe de confidentialité, statut brouillon…)

*Deck* : Slide 10. *Statut le 7 octobre* : absent. *Effort estimé* : important.

- **Constat sur la v1** : Aucun filtrage en lecture : listes, fiche, fichiers et export servaient tout à tout le monde ; le droit « Lire » n'était jamais vérifié ; brouillons visibles de tous ; identité simulée par cookie.
- **Vérification** : « Absent », confirmé. L'historique et les notifications montraient en plus l'activité de tous les documents.
- **Aujourd'hui — partiel.** Les règles de `docs/modele-cible.md` §5 sont codées : `canRead` et `inDraftingCircle` (`src/lib/access.ts`), appliqués aux listes et à la fiche (`listDocs`, `getDoc`, `src/lib/queries.ts`), aux fichiers (`src/app/api/documents/[id]/file/route.ts`), à l'export CSV (`src/app/api/export/search/route.ts`) et aux actions. Brouillons réservés au cercle de rédaction (D-14) ; un document confidentiel est lisible par son département, l'équipe projet et ses lecteurs désignés, un très confidentiel par ses seuls lecteurs désignés ; le droit « Lire » de la matrice s'applique. Reste : l'identité est simulée par cookie (`src/lib/context.ts`). Tant qu'aucune authentification réelle n'est branchée (fournisseur non choisi, O-02), ces règles ne protègent rien en production.

<a id="g14"></a>
#### G14 — Fonction : création de documents et fourniture de leur ID unique

*Deck* : Slide 11 ; slide 9 étape 2. *Statut le 7 octobre* : partiel. *Effort estimé* : moyen.

- **Constat sur la v1** : Boutons de création présents, redirection vers la fiche qui affiche la référence. Le formulaire ignorait la plupart des champs obligatoires du deck.
- **Vérification** : « Partiel », confirmé. Certains champs existaient sous une forme approchée : règle de conservation déduite du type, auteur de chaque version, date de création.
- **Aujourd'hui — intégré.** La création renvoie l'ID attribué (message « Identifiant attribué : … », `createDocument`) et ouvre la fiche. Le dialogue présente le tronc commun et les champs de contexte ; le serveur contrôle les règles du registre (`validateFields`, `src/lib/actions.ts`).

<a id="g15"></a>
#### G15 — Fonction : recherche de n'importe quel document depuis l'app unique (filtres de recherche)

*Deck* : Slide 11 ; slide 2 (« filtres optimisés pour la recherche ») ; slide 7 étape 2 (données de filtrage) ; slide 9 étape 2. *Statut le 7 octobre* : couvert, ramené à partiel par la vérification. *Effort estimé* : faible.

- **Constat sur la v1** : Recherche plein texte insensible aux accents, facettes affaire, type, entité, service et statut, recherches enregistrées, export CSV, champ global dans l'en-tête.
- **Vérification** : « Couvert » ramené à « partiel ». Les facettes ignoraient presque toutes les métadonnées du deck ; les résultats et l'export n'étaient pas filtrés selon les droits ; les recherches enregistrées étaient figées ; le filtrage se faisait en mémoire et le contenu des fichiers n'était pas indexé.
- **Aujourd'hui — partiel.** Facettes du modèle v2 : projet ou programme, famille, type, origine, rattachement, département, statut, confidentialité (`FACET_KEYS`, `src/lib/search.ts`). Plein texte sur le titre, l'ID et les anciens ID, les mots-clés, le type, le sous-type, l'organisme source et la référence externe. Résultats et export limités aux documents visibles. Reste : pas de recherche dans le contenu des fichiers ; filtrage en mémoire sur tous les documents (`runSearch`) ; pas de facette site, auteur, date, langue ou mot-clé. Les recherches enregistrées sont créables depuis le 11 octobre 2026 (personnelles, de département ou de groupe ; elles ne gardent que des critères).

<a id="g16"></a>
#### G16 — Liens pour ouvrir le document (vers la bibliothèque SharePoint)

*Deck* : Slide 9 étape 2. *Statut le 7 octobre* : partiel. *Effort estimé* : moyen.

- **Constat sur la v1** : Aperçu intégré (PDF ou image) et téléchargement par `/api/documents/[id]/file` ; aucun lien vers SharePoint ni ouverture dans Office.
- **Vérification** : « Partiel », confirmé. La route fichier ne vérifiait aucun droit.
- **Aujourd'hui — écarté par décision.** Avec D-06, on ouvre les documents dans Codex (aperçu et téléchargement par `src/app/api/documents/[id]/file/route.ts`, qui contrôle désormais les droits), sans lien vers SharePoint. Reste ouvert : l'accès direct des utilisateurs à la bibliothèque SharePoint si elle est activée (O-01).

<a id="g17"></a>
#### G17 — Fonction : validations de documents (nouveaux ou modifiés)

*Deck* : Slide 11. *Statut le 7 octobre* : couvert, ramené à partiel par la vérification. *Effort estimé* : faible.

- **Constat sur la v1** : Écran Validations avec approuver, rejeter, déléguer, commentaires et mention de signature électronique.
- **Vérification** : « Couvert » ramené à « partiel ». Le circuit était choisi à la main, la validation pouvait être contournée (publication au dépôt, nouvelle version d'un document publié), et la « signature eIDAS » n'était qu'un libellé.
- **Aujourd'hui — intégré.** Écran Validations : approuver, rejeter, déléguer, commenter. Le circuit vient du type, et les contournements ont disparu : pas de publication au dépôt, pas de version de travail hors brouillon (`addWorkingVersion`), dernière approbation soumise au droit Publier (`decideStep`, `src/lib/actions.ts`). Depuis le 11 octobre 2026, un rejet exige un motif, que l'auteur et le propriétaire retrouvent sur la fiche et dans « À traiter », et le demandeur (ou un gestionnaire documentaire) peut rappeler sa demande avant la dernière approbation (`recallValidation`) ; points 5 et 9 de `docs/reste-a-faire.md`. Toujours aucune signature électronique : le champ `sign` des étapes n'est jamais activé (`requestValidation`) ; voir M04.

<a id="g18"></a>
#### G18 — Fonction : suivi des workflows en cours lancés par l'utilisateur

*Deck* : Slide 11. *Statut le 7 octobre* : partiel. *Effort estimé* : faible.

- **Constat sur la v1** : Filtres « À valider », « En cours » (tous les circuits de tous les utilisateurs) et « Terminées » ; pas de filtre « mes demandes ».
- **Vérification** : « Partiel », confirmé.
- **Aujourd'hui — partiel.** Le filtre « Mes demandes » de l'écran Validations montre les circuits lancés par l'utilisateur (`FILTERS`, `src/app/validations/page.tsx`). Le 9 octobre, ses demandes de modification et de retrait (Vigie) ne se voyaient que document par document, dans l'onglet Demandes de la fiche. Depuis le 11 octobre 2026, la vue « Mes demandes Vigie » de l'écran Validations les liste toutes avec leur statut, leur ECO et leur modificateur désigné, selon les règles de lecture de la fiche (`listChangeRequests(ctx, { mine: true })`, `src/lib/queries.ts`) : il ne manque plus rien à G18 côté Codex, le statut ci-dessus reste celui du 9 octobre (§5.1).

<a id="g19"></a>
#### G19 — Fonction : suivi des actions en attente de l'utilisateur

*Deck* : Slide 11. *Statut le 7 octobre* : couvert. *Effort estimé* : faible.

- **Constat sur la v1** : Indicateur « À valider » et liste « À traiter » sur l'accueil, pastille et notifications dans l'application.
- **Vérification** : « Couvert », confirmé, avec réserves : notifications seulement dans l'application ; pas de révisions planifiées.
- **Aujourd'hui — partiel.** Le 9 octobre, « À traiter » sur l'accueil et le filtre « À valider » ne montraient que les étapes de circuit assignées à l'utilisateur ; une révision ouverte à son nom par un ECO accepté n'était listée nulle part, et les échéances de revue et d'expiration s'affichaient pour tous les documents visibles, pas comme des tâches du propriétaire. Depuis le 11 octobre 2026, une seule liste (`myActions`, `src/lib/queries.ts`) alimente « À traiter », la pastille d'Accueil et la cloche : étapes à décider, révisions confiées par un ECO, renvoyées en rédaction ou jamais soumises, modifications acceptées à greffer (D-26), revues et expirations des documents dont l'utilisateur est propriétaire ou propriétaire de processus, chacune avec un lien vers l'endroit où agir, seulement s'il voit le document (D-14) et peut agir. Reste l'absence de notification hors de l'application (e-mail, Teams), de relance et d'escalade (point 104 de `docs/reste-a-faire.md`) : d'où « partiel », statut du 9 octobre maintenu (§5.1).

<a id="g20"></a>
#### G20 — Niveau 1 – Hiérarchie des types de contenu (GED Document parent + 4 types)

*Deck* : Slide 12. *Statut le 7 octobre* : absent. *Effort estimé* : moyen.

- **Constat sur la v1** : Une seule forme de document ; ni type de contenu parent, ni types enfants avec leurs champs.
- **Vérification** : « Absent », confirmé.
- **Aujourd'hui — intégré.** Intégré sous une forme adaptée par décision (D-08) : les 4 types de contenu sont remplacés par deux axes, l'origine et le rattachement. Les champs de contexte s'affichent et se contrôlent selon ces axes (table `documents` dans `src/db/schema.ts`, `DocFields`, `validateFields`). L'héritage du type SharePoint « Document » est sans objet depuis D-06.

<a id="g21"></a>
#### G21 — Tronc commun : ID document

*Deck* : Slide 13. *Statut le 7 octobre* : couvert. *Effort estimé* : faible.

- **Constat sur la v1** : ID clé primaire, généré automatiquement, jamais modifié.
- **Vérification** : « Couvert », confirmé. Format incohérent quand le rattachement à une affaire venait après coup ; compteur max+1 sans séquence.
- **Aujourd'hui — intégré.** `TYPE-CONTEXTE-SEQ`, figé dès la première approbation : `updateMeta` ne change l'ID que si aucune révision n'a encore été approuvée. Les anciens ID sont gardés en alias (`documents.aliases`) et restent résolus (`getDoc`, `src/lib/queries.ts`). Depuis le 10 octobre 2026, le numéro vient d'un compteur par couple (type, contexte), incrémenté atomiquement (`id_counters`, `nextDocId`), et les imports passent un par un (verrou consultatif) : l'attribution est sûre aussi avec un Postgres serveur en READ COMMITTED, imports compris.

<a id="g22"></a>
#### G22 — Tronc commun : Titre

*Deck* : Slide 13. *Statut le 7 octobre* : couvert. *Effort estimé* : faible.

- **Constat sur la v1** : Champ `name` obligatoire, libellé « Nom » ; « Sans titre — … » à la création depuis un modèle.
- **Vérification** : « Couvert », confirmé ; le champ du formulaire de dépôt n'était pas requis.
- **Aujourd'hui — intégré.** `documents.title` obligatoire, libellé « Titre », exigé aussi à la création depuis un modèle (`validateFields`, `src/lib/actions.ts`).

<a id="g23"></a>
#### G23 — Tronc commun : Domaine (Interne / Externe / Projet / Recherche)

*Deck* : Slide 13 ; slide 12. *Statut le 7 octobre* : absent. *Effort estimé* : moyen.

- **Constat sur la v1** : Ni colonne ni axe pour le domaine ; seul le code d'affaire désignait de fait un document projet.
- **Vérification** : « Absent », confirmé. Le domaine doit rester indépendant du rattachement à une affaire.
- **Aujourd'hui — intégré.** Intégré sous une forme adaptée par décision (D-08) : Origine (interne, externe) et Rattachement (aucun, projet, recherche) remplacent le Domaine. Chaque type du registre dit quelles origines et quels rattachements il admet (`doc_types.origins`, `doc_types.attachments`). Les familles gardent leur domaine d'origine du deck (`group`) dans `src/db/registry.ts`, pour le regroupement seulement.

<a id="g24"></a>
#### G24 — Tronc commun : Catégorie (famille fonctionnelle)

*Deck* : Slide 13 ; slides 14-17. *Statut le 7 octobre* : en conflit. *Effort estimé* : moyen.

- **Constat sur la v1** : Pas de catégorie ; l'axe Processus (12 valeurs de la maquette) en tenait lieu.
- **Vérification** : « En conflit », confirmé. La granularité de l'axe Processus était plus proche des types du deck que de ses catégories.
- **Aujourd'hui — intégré.** La Famille correspond à la Catégorie du deck (23 familles, `src/db/registry.ts`). L'axe Processus de la v1 a disparu.

<a id="g25"></a>
#### G25 — Tronc commun : Type de document (classe principale)

*Deck* : Slide 13 ; slides 14-17. *Statut le 7 octobre* : en conflit. *Effort estimé* : moyen.

- **Constat sur la v1** : Liste plate de 22 types issus de la maquette, orientés explosifs et HSE.
- **Vérification** : « En conflit », confirmé ; la plupart des types v1 correspondaient à des sous-types du deck.
- **Aujourd'hui — intégré.** Registre fusionné de 69 types : les 45 du deck et les types de la spec Keystone (D-07). Sélection en cascade famille › type dans le dialogue. Points à arbitrer : `docs/registre-points-ouverts.md` (O-05).

<a id="g26"></a>
#### G26 — Tronc commun : Sous-type de document (facultatif)

*Deck* : Slide 13 ; slides 14-17 (exemples de sous-types). *Statut le 7 octobre* : absent. *Effort estimé* : faible.

- **Constat sur la v1** : Aucun champ sous-type.
- **Vérification** : « Absent », confirmé.
- **Aujourd'hui — intégré.** `documents.subtype` : saisie libre, avec les sous-types du type proposés en suggestion. La liste reste ouverte, comme les « exemples » du deck.

<a id="g27"></a>
#### G27 — Tronc commun : Propriétaire du document (personne, responsable métier interne)

*Deck* : Slide 13. *Statut le 7 octobre* : partiel. *Effort estimé* : faible.

- **Constat sur la v1** : `ownerId` obligatoire mais toujours égal au créateur et non modifiable.
- **Vérification** : « Partiel », confirmé.
- **Aujourd'hui — intégré.** `documents.owner_id` transférable dans « Modifier les métadonnées » ; à la création, c'est le créateur. Personnes provisoires, alignées sur Keystone (`src/db/seed-org.ts`).

<a id="g28"></a>
#### G28 — Tronc commun : Auteur (personne ou texte – auteur réel ou organisme émetteur)

*Deck* : Slide 13. *Statut le 7 octobre* : absent. *Effort estimé* : faible.

- **Constat sur la v1** : Pas d'auteur au niveau du document ; seulement l'utilisateur qui déposait chaque version.
- **Vérification** : « Absent », confirmé.
- **Aujourd'hui — intégré.** `documents.author_id` (une personne) ou `documents.author_text` (texte libre : auteur réel, organisme émetteur).

<a id="g29"></a>
#### G29 — Tronc commun : Statut (liste à 7 valeurs : Brouillon / En révision / Approuvé / En vigueur / Remplacé / Archivé / Obsolète)

*Deck* : Slide 13. *Statut le 7 octobre* : en conflit. *Effort estimé* : important.

- **Constat sur la v1** : 4 statuts (brouillon, en validation, publié, archivé) ; ni Approuvé, ni Remplacé, ni Obsolète.
- **Vérification** : « En conflit », confirmé. Plusieurs chemins sautaient l'étape « Approuvé » ; une restauration d'archive remettait toujours « publié ».
- **Aujourd'hui — intégré.** Statuts de révision `draft`, `in_review`, `approved`, `in_force`, `superseded` (plus `cancelled`) et états de document `obsolete` et `archived` (`src/db/schema.ts`), libellés Brouillon, En révision, Approuvé, En vigueur, Remplacé, Obsolète, Archivé (`src/lib/i18n.ts`). Une révision approuvée passe En vigueur à sa date d'effet (`promoteDue`, `src/lib/lifecycle.ts`). Ce passage automatique et « Remplacé » pour la révision précédente sont proposés, non confirmés (D-11).

<a id="g30"></a>
#### G30 — Tronc commun : Département / Fonction (entité métier)

*Deck* : Slide 13 ; slide 11 (projets, R&D, commercial, RH, Com'). *Statut le 7 octobre* : partiel. *Effort estimé* : faible.

- **Constat sur la v1** : L'axe Service (12 valeurs de la maquette) en tenait lieu, sans R&D ni Communication.
- **Vérification** : « Partiel », confirmé.
- **Aujourd'hui — intégré.** `documents.department` obligatoire. Les départements ont un code de 3 lettres repris dans l'ID (table `departments`) ; la liste provisoire de 15 départements contient Commercial, Communication et Recherche & innovation (`src/db/seed-org.ts`). À remplacer par l'organigramme (D-19, O-04).

<a id="g31"></a>
#### G31 — Tronc commun : Niveau de confidentialité (liste à 4 valeurs : Interne / Confidentiel / Très confidentiel / Restreint)

*Deck* : Slide 13 ; slide 10. *Statut le 7 octobre* : en conflit. *Effort estimé* : faible.

- **Constat sur la v1** : Niveaux public, interne, restreint, confidentiel, sans effet sur l'accès ; « Très confidentiel » absent.
- **Vérification** : « En conflit », confirmé. L'ordre implicite de Codex (public < interne < restreint < confidentiel) plaçait Restreint sous Confidentiel, alors que le deck le cite en dernier.
- **Aujourd'hui — intégré.** 5 niveaux, Public < Restreint < Interne < Confidentiel < Très confidentiel (D-13). Niveaux admis et niveau par défaut fixés par type dans le registre ; « Public » est admis pour POL, REG, DTF, PUB et COL (O-08). Le niveau agit sur la lecture (`canRead`, `src/lib/access.ts`). Réserve : Restreint et Interne donnent aujourd'hui la même visibilité dans Codex, et aucun mécanisme de diffusion à un client ou partenaire n'existe.

<a id="g32"></a>
#### G32 — Tronc commun : Mots-clés (métadonnée gérée multiple, facultatif)

*Deck* : Slide 13. *Statut le 7 octobre* : partiel. *Effort estimé* : faible.

- **Constat sur la v1** : `keywords` facultatif, saisi en texte libre séparé par des virgules, cherché en plein texte.
- **Vérification** : « Partiel », confirmé ; pas de facette mot-clé.
- **Aujourd'hui — partiel.** Inchangé : texte libre séparé par des virgules (`readFields`, `src/lib/actions.ts`), cherché en plein texte. Ni vocabulaire géré ni facette.

<a id="g33"></a>
#### G33 — Tronc commun : Version / Révision

*Deck* : Slide 13. *Statut le 7 octobre* : couvert. *Effort estimé* : faible.

- **Constat sur la v1** : Version x.y, 0.1 depuis un modèle, 1.0 au dépôt.
- **Vérification** : « Couvert », confirmé, avec une réserve : `bump()` ne lisait que le format x.y, et la version ne se saisissait pas (gênant pour la migration).
- **Aujourd'hui — intégré.** Indices en lettres (D-11) et versions de travail A.1, A.2 (D-12). L'import de migration reprend la lettre de révision (`src/lib/importer.ts`).

<a id="g34"></a>
#### G34 — Tronc commun : Date d'émission (obligatoire, première émission)

*Deck* : Slide 13. *Statut le 7 octobre* : partiel. *Effort estimé* : faible.

- **Constat sur la v1** : Pas de date d'émission ; seulement `createdAt`, la date de création dans Codex.
- **Vérification** : « Partiel », confirmé.
- **Aujourd'hui — intégré.** `documents.issued_at` est rempli à la première mise en vigueur (`putInForce`, `src/lib/lifecycle.ts`) ; l'import de migration peut le reprendre (`src/lib/importer.ts`, `docs/api.md`). Cette règle est proposée par l'assistant, non confirmée.

<a id="g35"></a>
#### G35 — Tronc commun : Date d'effet (début de validité)

*Deck* : Slide 13. *Statut le 7 octobre* : absent. *Effort estimé* : faible.

- **Constat sur la v1** : Aucun champ ; publication immédiate à la dernière étape du circuit.
- **Vérification** : « Absent », confirmé.
- **Aujourd'hui — intégré.** `revisions.effective_at` est saisie à la demande de validation (`requestValidation`). Une révision approuvée attend cette date avant d'entrer en vigueur (`approveRevision`, `promoteDue`). La date est portée par la révision, pas par le document.

<a id="g36"></a>
#### G36 — Tronc commun : Date de révision (prévue)

*Deck* : Slide 13. *Statut le 7 octobre* : absent. *Effort estimé* : moyen.

- **Constat sur la v1** : Aucune date de révision planifiée ; un circuit « Revue annuelle » se lançait à la main.
- **Vérification** : « Absent », confirmé.
- **Aujourd'hui — intégré.** `documents.review_due_at` saisie à la main ; échéance « Réviser » sur l'accueil et dans Archivage (`deadlines`, `src/lib/queries.ts`). Pas de périodicité par type ni de lancement de la revue depuis l'échéance.

<a id="g37"></a>
#### G37 — Tronc commun : Date d'expiration (fin de validité)

*Deck* : Slide 13. *Statut le 7 octobre* : en conflit. *Effort estimé* : moyen.

- **Constat sur la v1** : Une seule date, la fin de conservation, qui servait aussi de fin de validité.
- **Vérification** : « En conflit », confirmé.
- **Aujourd'hui — intégré.** `documents.expires_at` est distincte de la conservation ; échéance « Renouveler ». Les déclencheurs de conservation « fin de contrat » et « expiration » partent de cette date (`src/lib/retention.ts`).

<a id="g38"></a>
#### G38 — Tronc commun : Langue (choix, facultatif)

*Deck* : Slide 13. *Statut le 7 octobre* : couvert. *Effort estimé* : faible.

- **Constat sur la v1** : `lang` (français ou anglais), français par défaut.
- **Vérification** : « Couvert », confirmé ; le champ ne pouvait pas rester vide.
- **Aujourd'hui — intégré.** `documents.lang` facultatif : français, anglais ou vide.

<a id="g39"></a>
#### G39 — Tronc commun : Classe de conservation (métadonnée gérée, obligatoire)

*Deck* : Slide 13. *Statut le 7 octobre* : partiel. *Effort estimé* : moyen.

- **Constat sur la v1** : Règles de rétention (durée, déclencheur, sort final) déduites du type avec repli sur une règle par défaut ; déclencheur réduit à un libellé ; aucune destruction exécutée.
- **Vérification** : « Partiel », confirmé. La disposition « Détruire » était proposée dans les échéances, mais rien ne l'exécutait.
- **Aujourd'hui — partiel.** Une règle par type dans le registre (durée, déclencheur, sort final, fondement), copiée sur le document à la création ou au changement de type (`createDocument`, `updateMeta`) ; la fin de conservation se calcule depuis le déclencheur (`src/lib/retention.ts`). C'est D-20. Reste : D-20 et `docs/modele-cible.md` §8 rendent la classe modifiable par un gestionnaire, mais aucun écran ni aucune action ne le permet document par document ; les déclencheurs « fin de projet », « durée de vie de l'actif » et « départ du salarié » ne sont pas calculables, ce qui laisse 41 des 69 types sans date de fin calculable ; les durées sont à confirmer (O-07, questions 3 et 6 de `docs/registre-points-ouverts.md`) ; la destruction n'est pas exécutée (droit Détruire absent de `ENFORCED_PERMS`, `src/lib/i18n.ts`).

<a id="g40"></a>
#### G40 — Tronc commun : Organisme source (conditionnel, obligatoire pour les documents externes)

*Deck* : Slide 13 ; slide 18 (DE). *Statut le 7 octobre* : absent. *Effort estimé* : faible.

- **Constat sur la v1** : Aucun champ.
- **Vérification** : « Absent », confirmé.
- **Aujourd'hui — partiel.** `documents.source_org`, obligatoire pour l'origine externe (`validateFields`, `src/lib/actions.ts`). C'est un texte libre, pas la « métadonnée gérée » (liste contrôlée) que prévoit le deck.

<a id="g41"></a>
#### G41 — Niveau 3 – Taxonomie Domaine › Catégorie › Type › Sous-type (DI, DE, DP, DR)

*Deck* : Slides 14 (DI), 15 (DE), 16 (DP), 17 (DR). *Statut le 7 octobre* : en conflit. *Effort estimé* : important.

- **Constat sur la v1** : 4 axes plats (entité, service, processus, type) avec les valeurs de la maquette.
- **Vérification** : « En conflit », confirmé, mais plusieurs valeurs de Codex correspondaient à des sous-types du deck : une table de correspondance était réaliste.
- **Aujourd'hui — intégré.** 23 familles (les catégories du deck), 69 types et leurs sous-types (`src/db/registry.ts`) ; cascade famille › type › sous-type dans le dialogue. Administration partielle (voir G03). Le découpage par domaine est remplacé par les deux axes (D-08).

<a id="g42"></a>
#### G42 — Niveau 4 – Champs spécifiques DI (propriétaire de processus, autorité d'approbation, département, niveau de confidentialité)

*Deck* : Slide 18. *Statut le 7 octobre* : partiel. *Effort estimé* : moyen.

- **Constat sur la v1** : Département et confidentialité existaient pour tous ; propriétaire de processus et autorité d'approbation absents.
- **Vérification** : « Partiel », confirmé.
- **Aujourd'hui — partiel.** Le propriétaire de processus existe (`documents.process_owner_id`) mais il est facultatif, comme l'écrit `docs/modele-cible.md` §7 (choix de l'assistant, non discuté), alors que le deck le rend obligatoire. L'autorité d'approbation est supprimée par décision (D-15). Département et confidentialité relèvent du tronc commun.

<a id="g43"></a>
#### G43 — Niveau 4 – Champs spécifiques DE (organisme source, référence externe, sens entrant/sortant, date de réception)

*Deck* : Slide 18. *Statut le 7 octobre* : absent. *Effort estimé* : faible.

- **Constat sur la v1** : Aucun des 4 champs.
- **Vérification** : « Absent », confirmé.
- **Aujourd'hui — partiel.** Organisme source (obligatoire), référence externe et date de réception (facultatives, alors que le deck les rend obligatoires). Le champ « sens entrant / sortant » n'existe pas et ne figure pas dans `docs/modele-cible.md` §7 ; l'utilisateur ne s'est pas prononcé. Avec D-08, un courrier émis par EPC2I est d'origine interne, ce qui retire une partie du besoin.

<a id="g44"></a>
#### G44 — Niveau 4 – Champs spécifiques DP (code projet, phase projet, lot / work package, discipline)

*Deck* : Slide 18. *Statut le 7 octobre* : partiel. *Effort estimé* : moyen.

- **Constat sur la v1** : Code projet couvert par le rattachement à une affaire Keystone simulée (`AFF-…`) ; phase réduite à l'étape de l'affaire ; lot et discipline absents.
- **Vérification** : « Partiel », confirmé. La vérification a montré que la vraie application Keystone (dépôt Keystone) a un cycle de vie en 12 étapes, des codes projet du type `HLT-026` et des lots (WBS), et que le miroir simulé de Codex v1 ne lui correspondait pas.
- **Aujourd'hui — partiel.** Code projet obligatoire (projets Keystone simulés, codes `HLT-026`, `NDC-031`, `RCF-019` ; D-04). Phase, lot et discipline sont facultatifs et en texte libre ; la phase propose les 12 étapes de Keystone (`PROJECT_PHASES`, `src/lib/i18n.ts`). Les lots ne sont pas lus depuis Keystone.

<a id="g45"></a>
#### G45 — Niveau 4 – Champs spécifiques DR (programme de recherche, thème, ID étude/essai, statut publication / PI)

*Deck* : Slide 18. *Statut le 7 octobre* : absent. *Effort estimé* : moyen.

- **Constat sur la v1** : Aucune notion de recherche.
- **Vérification** : « Absent », confirmé.
- **Aujourd'hui — partiel.** Programme de recherche obligatoire (table `research_programs`). Thème, ID étude / essai et statut publication / PI sont facultatifs et en texte libre.

<a id="g46"></a>
#### G46 — Migration des documents existants par vagues (état de l'art des arborescences, suppression/archivage des anciennes)

*Deck* : Slide 6 étapes 1, 4, 5 ; slide 7 étape 5. *Statut le 7 octobre* : absent. *Effort estimé* : important.

- **Constat sur la v1** : Aucun import en masse ; création document par document ; ni vague, ni référence d'origine, ni reprise des dates et auteurs historiques.
- **Vérification** : « Absent », confirmé.
- **Aujourd'hui — écarté par décision.** D-21 : la migration se fera par un programme dédié, hors de Codex. Côté Codex, l'interface d'import existe : `POST /api/import` (`src/app/api/import/route.ts`, `src/lib/importer.ts`, `docs/api.md`), fermée tant que `CODEX_IMPORT_TOKEN` n'est pas défini. Elle garde l'ancienne référence en alias et reprend les dates, l'auteur, la lettre de révision et le statut. L'inventaire des arborescences, les vagues, le dédoublonnage et la suppression des anciennes arborescences relèvent de l'outil de migration (O-11).

<a id="g47"></a>
#### G47 — Axes de Codex absents du deck : Entité/site (et espaces), Processus

*Deck* : Slides 12-13 (le tronc commun ne prévoit ni entité ni site, ni processus distinct de la catégorie). *Statut le 7 octobre* : en conflit. *Effort estimé* : moyen.

- **Constat sur la v1** : Codex organisait tout autour de l'Entité/site (6 entités fictives, un espace par entité) et d'un axe Processus, absents du deck.
- **Vérification** : « En conflit », confirmé. Le deck emploie « Entité métier » pour le Département / Fonction, ce qui correspond à l'axe Service de la v1.
- **Aujourd'hui — intégré.** L'axe Processus et les espaces par entité de la v1 ont disparu. Le classement suit `docs/modele-cible.md` §2 : Département (obligatoire) et Site (facultatif), valeurs provisoires en attendant l'organigramme (D-19, O-04).

<a id="g48"></a>
#### G48 — Traçabilité et conformité (journal d'audit, conservation légale)

*Deck* : Slides 2-3 (traçabilité, exigences légales de conservation). *Statut le 7 octobre* : couvert, ramené à partiel par la vérification. *Effort estimé* : faible.

- **Constat sur la v1** : Table `audit_log`, téléchargements journalisés, consultation et export CSV, onglet Historique, gel juridique et rétention.
- **Vérification** : « Couvert » ramené à « partiel ». Plusieurs actions n'étaient pas journalisées ; identité choisie par cookie ; consultations non journalisées ; conservation incomplète ; gel juridique impossible à lever.
- **Aujourd'hui — partiel.** Journal des actions sur les documents et des téléchargements (`audit`, `src/lib/lifecycle.ts` ; route fichier), export CSV réservé à l'administration (`src/app/api/export/audit/route.ts`), onglet Historique de la fiche ; le gel juridique se lève et c'est journalisé (`releaseHold`). Depuis le 10 octobre 2026, le journal est en ajout seul (la base refuse UPDATE, DELETE et TRUNCATE, déclencheurs posés au démarrage par `src/db/index.ts` ; un reclassement ne réécrit plus `audit_log.doc_id`), il reçoit les événements sans document (`target_kind`, `target_id`) : droits, organisation, titulaires de fonction, registre des types avec l'avant et l'après, ainsi que les commentaires de circuit, les exports CSV et les champs modifiés par `updateMeta` ; l'horodatage est en `timestamptz` (UTC, affiché à l'heure de Paris). Reste : les consultations ne sont pas journalisées ; l'identité est simulée, le journal n'a donc pas de valeur probante.

## 6. Architecture

### 6.1 L'approche du deck

Ce que j'ai compris du deck : construire la GED uniquement avec les outils Microsoft 365 déjà en place, sans développement ni hébergement. (1) Une bibliothèque de documents unique dans le SharePoint global sert à la fois de base de données (les colonnes) et de coffre-fort (droits, versions). On classe par métadonnées, plus par arborescence de dossiers. (2) Les métadonnées vivent dans la banque de termes SharePoint (métadonnées gérées) et sont structurées en 4 niveaux. Niv 1 : un type de contenu parent « GED Document » et 4 types enfants : Interne (DI), Externe (DE), Projet (DP), Recherche (DR). Niv 2 : un tronc commun de 20 champs, dont un ID immuable généré, le domaine dérivé du type de contenu, catégorie/type/sous-type en métadonnées gérées, propriétaire, auteur, 7 statuts (Brouillon, En révision, Approuvé, En vigueur, Remplacé, Archivé, Obsolète), département, 4 niveaux de confidentialité, mots-clés, version, 4 dates, langue, classe de conservation, et un organisme source obligatoire pour l'externe. Niv 3 : une taxonomie Catégorie > Type > Sous-types par domaine, soit 10 types DI, 10 DE, 12 DP et 13 DR. Niv 4 : des champs obligatoires propres à chaque domaine (par exemple code projet, phase, lot et discipline pour DP). (3) Le versioning natif SharePoint et des modèles de documents. (4) Power Automate pour les flux : création avec codification automatique selon le type, validation par un circuit prédéfini selon le type, modification d'un document validé sur le principe ECR/ECO, passage à l'état obsolète. (5) Une app Power Apps « GED EPC2I » comme point d'entrée unique : création avec ID unique, recherche dans toute la GED, pages par métier, liens qui ouvrent le document dans la bibliothèque SharePoint, suivi de mes workflows et de mes actions en attente, accès restreint selon la confidentialité et le statut brouillon. Déroulé prévu : inventaire des arborescences actuelles, création des termes, création et paramétrage de la bibliothèque, modèles, migration par vagues, puis suppression ou archivage des anciennes arborescences. Hypothèses implicites : licences déjà payées, rien à héberger, maintenance par la DSI ou un profil low-code, et on garde l'édition Office, la sécurité Entra et la conformité Purview.

### 6.2 Codex v1, tel qu'analysé le 7 octobre

<details>
<summary>Analyse de la v1 (dépassée, gardée pour mémoire)</summary>

Codex est une application web autonome (Next.js 16, React 19, Server Actions) qui est elle-même la base et le coffre. La base est PGlite, un Postgres embarqué dans un seul processus (.data/pglite). Les fichiers sont sur le disque local (.data/files), voir src/db/index.ts. Le modèle comprend une table documents (type, entité, service, processus, version, 4 statuts draft/review/published/archived, propriétaire, règle de rétention, confidentialité, mots-clés, gel juridique), une table document_versions (un fichier distinct par version), les tables workflows, workflow_steps et workflow_comments, ainsi que retention_rules, audit_log, role_permissions, templates, une taxonomy plate à 5 axes et un miroir Keystone (affaires).

Ce qui rejoint le deck : un référentiel unique sans arborescence, la recherche à facettes, les versions majeures et mineures avec restauration, les circuits de validation (délégation, commentaires, signature simulée), la rétention avec gel juridique, l'audit, les modèles et le lien Keystone.

Couplage au stockage, vérifié dans le code :
(a) Fichiers : il n'y a que 3 points d'entrée-sortie : storeFile (src/lib/actions.ts l.74-82), copyFile dans restoreVersion (l.225) et readFile dans src/app/api/documents/[id]/file/route.ts (l.32). Ils sont faciles à placer derrière une interface.
(b) Base : il n'y a aucune couche d'abstraction. getDb() est appelé 19 fois dans actions.ts, 10 fois dans queries.ts, et aussi dans context.ts, keystone.ts et la route fichier. Les règles métier (verrous, numérotation nextDocId, avancement des circuits) sont mêlées aux requêtes Drizzle dans les transactions. En revanche, les écrans ne lisent que les modèles de vue de queries.ts et n'écrivent que par les Server Actions. L'interface est donc réutilisable. La couche données (environ 850 lignes : queries.ts, actions.ts, route fichier) est à scinder ou réécrire. src/lib/keystone.ts montre le bon modèle à reproduire pour une frontière SharePoint.

Écarts à combler quelle que soit l'option :
- L'authentification est simulée par cookie (src/lib/context.ts) et les droits sont une matrice globale rôle × permission.
- La confidentialité et le statut brouillon ne filtrent pas la lecture : listDocs renvoie tout.
- La recherche se fait en mémoire sur tous les documents (src/lib/search.ts).
- Les valideurs sont codés en dur dans circuitSteps (actions.ts l.299-309) et l'utilisateur choisit parmi 3 circuits : il n'y a pas de circuit par type.
- Un document créé depuis un modèle n'a aucun fichier.
- Codex a 4 statuts au lieu de 7, et une taxonomie entité/service/processus/type au lieu de Domaine > Catégorie > Type > Sous-type.
- Les identifiants D-#### et AFF-…-DOC-### ne sont pas dérivés du type.
- Il n'y a pas d'import en masse ni d'édition Office : seulement un aperçu PDF ou image et le téléchargement.
- PGlite ne convient pas en production multi-utilisateur.

Enfin, la spec Keystone (Keystone/docs/spec/00-overview.md) attend déjà que Codex décide de la numérotation (TYPE-PROJ-SEQ), des circuits, de la rétention et du registre des types, avec des webhooks.

</details>

### 6.3 Étapes du deck et équivalents dans Codex

| Étape du deck | Sens dans le deck | Équivalent dans Codex v1 (7 octobre) | Aujourd'hui |
|---|---|---|---|
| Slide 5 · Bibliothèque de documents unique dans le SharePoint global | Un seul conteneur pour tous les documents contrôlés du groupe, classés par métadonnées plutôt que dans des dossiers et sites dispersés. | Même idée : une seule table documents, un classement multi-axes et un explorateur qui passe d'un axe à l'autre. Mais le stockage est propre à Codex (PGlite + .data/files), pas SharePoint. Les « espaces » Codex (un par entité) ne sont pas des bibliothèques distinctes. | Une seule table `documents` ; fichiers sur disque local ou dans une bibliothèque SharePoint pilotée par Codex (D-06). Voir G02. |
| Slide 5 · La bibliothèque fait office de base de données et de coffre-fort | Les colonnes SharePoint servent de base. Les droits hérités, les versions, la corbeille et la rétention Purview servent de coffre. | Codex est lui-même la base et le coffre : PGlite embarqué dans un seul processus, fichiers sur disque local, verrous applicatifs (archivé, gel juridique, circuit en cours). Il n'y a ni chiffrement, ni authentification réelle, ni filtrage des lectures. | Codex est la base ; contrôle en lecture en place, pas de chiffrement, identité simulée. Voir G02, G13. |
| Slide 5 · Power Automate pour les flux | Les automatismes du cycle de vie (création, validation, modification, obsolescence) sont faits en low-code. | Ce sont les Server Actions de src/lib/actions.ts (requestApproval, decideStep, delegateStep, archiveDocuments, holdDocuments), avec 3 circuits codés : simple, signature, revue annuelle. | Server Actions, circuit porté par le type et résolu par fonctions (D-15). Voir G08. |
| Slide 5 · IU Power Apps « GED EPC2I » | Une interface unique pour que les utilisateurs ne se perdent pas dans la bibliothèque. | C'est exactement le rôle de Codex : 7 écrans (accueil, explorateur, fiche, recherche, validations, archivage, administration), bilingues, avec des liens partageables. | Codex reste l'interface unique (D-06). Voir G11. |
| Slide 6 · 1 – État de l'art des arborescences existantes | Inventorier les dossiers actuels (emplacements, volumes, propriétaires) et préparer leur correspondance avec la nouvelle taxonomie. | Aucun équivalent : c'est un travail d'organisation. Les données Codex sont celles, fictives, de la maquette. | Hors de Codex : relève de l'outil de migration (D-21). |
| Slide 6 · 2 – Métadonnées dans la banque de termes SharePoint | Catégorie, type, sous-type, département, mots-clés, classe de conservation et organisme source deviennent des ensembles de termes hiérarchiques, gérés au même endroit et réutilisables partout. | La table taxonomy (axes entity/service/process/type/conf), plate et bilingue, modifiable dans Administration › Plan de classement. Il n'y a ni hiérarchie Catégorie > Type > Sous-type, ni synonymes, ni mots-clés gérés. Les valeurs sont celles de la maquette, pas celles du deck. | Registre des types de Codex (familles, types, sous-types), départements, sites, fonctions (D-07). Voir G03. |
| Slide 6 · 3 / Slide 7 · 1 – Création de la bibliothèque unique | Une bibliothèque portant le type de contenu parent « GED Document » et ses 4 types enfants DI, DE, DP et DR. Chacun a le tronc commun et ses champs de niveau 4. | Une seule table documents, mais sans notion de domaine ni de type de contenu : les mêmes colonnes pour tous, aucun champ propre à un domaine. Seul affaireCode existe ; il manque phase, lot, discipline, organisme source, sens entrant/sortant, programme de recherche, etc. | Pas de types de contenu : deux axes origine et rattachement, et des champs de contexte (D-08). Voir G20. |
| Slide 6 · 4 / Slide 7 · 5 – Migration des documents par vagues | Déplacer les documents existants par lots en renseignant leurs métadonnées. | Pas d'import en masse, seulement le dépôt fichier par fichier. Si SharePoint reste le coffre, la migration se fait avec les outils Microsoft (Migration Manager, PnP), qui gardent l'historique des versions. Vers un Codex autonome, il faudrait écrire un import. | Outil séparé qui appelle `POST /api/import` (D-21). Voir G46. |
| Slide 6 · 5 – Suppression ou archivage des anciennes arborescences | Fermer les anciens emplacements pour éviter les doublons. | Hors du périmètre de l'application. L'« archivage » de Codex concerne la rétention d'un document, pas des dossiers. | Hors de Codex (D-21). |
| Slide 7 · 2 – Paramétrage : données de filtrage | Colonnes indexées, navigation par métadonnées, filtres clés et vues de la bibliothèque. | Les facettes de /recherche (affaire, type, entité, service, statut), les filtres de l'explorateur, les recherches enregistrées et l'export CSV. Le calcul se fait en mémoire sur tous les documents (src/lib/search.ts). Il faudra un index, ou Microsoft Search si SharePoint est la source. | Facettes v2, filtrage selon les droits ; toujours en mémoire, sans le contenu des fichiers. Voir G15. |
| Slide 7 · 2 – Codification automatique du nom selon le type | Un ID unique et immuable, construit à partir du type de document. | nextDocId (actions.ts l.61-70) produit D-#### pour le groupe et &lt;affaire>-DOC-### pour les affaires (compteur max+1 dans une transaction). Ce n'est pas dérivé du type. De son côté, Keystone attend TYPE-PROJ-SEQ (par exemple PID-HLT-026). | `TYPE-CONTEXTE-SEQ` attribué par Codex (D-09, D-10). Voir G04. |
| Slide 7 · 3 – Gestion du versioning | Le versioning natif SharePoint : versions mineures pour les brouillons, majeures pour les publications, avec historique et restauration. | document_versions avec un fichier par version, passage mineure/majeure, restauration et comparaison. La logique est équivalente au versioning SharePoint, mais réécrite. | Révisions en lettres et versions de travail (D-11, D-12). Voir G05. |
| Slide 7 · 4 – Premiers documents types (modèles) | Des modèles Word ou Excel rattachés aux types de contenu. | La table templates et le bouton « Nouveau depuis un modèle ». Mais le document créé n'a aucun fichier : createFromTemplate n'enregistre pas de contenu. | Modèles = documents FRM au contexte QMS, fichier copié à la création (D-10). Voir G06. |
| Slide 8 · Flux de création (codification) | À la création, générer automatiquement la référence du document. | createFromTemplate et uploadDocument attribuent l'ID, déduisent la règle de rétention du type et écrivent l'audit. Équivalent partiel : le format de l'ID est à revoir. | `createDocument`, ID attribué au brouillon. Voir G07. |
| Slide 8 · Flux de validation (circuit prédéfini selon le type) | Chaque type de document a son circuit d'approbation. | requestApproval et decideStep gèrent les étapes, la délégation, les commentaires, une signature simulée et la publication automatique, et empêchent de valider son propre document. Mais l'utilisateur choisit le circuit parmi 3, et les valideurs sont des identifiants codés en dur (circuitSteps, l.299-309). Il n'y a pas de table de circuits par type. | Circuit par type, étapes par fonction (D-15). Voir G08. |
| Slide 8 · Modification d'un document validé (ECR/ECO) | Une demande de modification justifiée et approuvée (ECR) avant d'autoriser la nouvelle révision (ECO). | Il n'y a pas d'objet « demande de modification » : on dépose directement une nouvelle version (elle repasse en brouillon si l'auteur n'a pas le droit Publier), puis on lance un circuit. Keystone a son propre module ECO pour les pièces : la frontière entre les deux reste à définir. | ECR/ECO dans Vigie, appliqués par Codex (D-16). Voir G09. |
| Slide 8 · Passage à l'état obsolète | Une demande, puis une validation, pour retirer un document de la circulation (statuts Remplacé ou Obsolète). | Ni statut Obsolète ou Remplacé, ni demande associée. L'archivage (écran Archivage, droit Archiver) est ce qui s'en rapproche le plus. Codex a 4 statuts, le deck en a 7. | Retrait décidé dans Vigie, état Obsolète dans Codex (D-17). Voir G10. |
| Slide 9 · 1 – Besoins utilisateurs par département (et pages métier, slide 10) | Recueillir les besoins par département et proposer des pages dédiées avec les filtres principaux. | La maquette est pensée autour d'une seule utilisatrice de référence (HSE). Pas de pages par métier : seulement des recherches enregistrées et les axes de l'explorateur. | Pas de pages métiers ; recueil des besoins non fait. Voir G12. |
| Slide 9 · 2 – App de base : création, recherche, liens d'ouverture vers SharePoint | L'app crée et retrouve les documents, et l'ouverture renvoie au fichier dans la bibliothèque SharePoint (donc édition Office). | Création et recherche sont présentes. L'ouverture passe par /api/documents/[id]/file : aperçu PDF ou image et téléchargement enregistré dans l'audit, sans lien SharePoint ni édition Office. | Ouverture dans Codex, sans lien SharePoint (D-06). Voir G16. |
| Slide 9 · 3 / Slide 11 – Workflows progressifs, suivi de mes workflows et de mes actions | L'app suit les workflows lancés par l'utilisateur et les actions qui l'attendent. | L'écran /validations (à valider, en cours, terminées) et l'indicateur « À valider » de l'accueil. L'ID est bien fourni à la création. Les demandes de passage en obsolète et de modification manquent. | « Mes demandes », « À valider » et « Mes demandes Vigie » ; « À traiter » regroupe toutes les actions qui attendent l'utilisateur (depuis le 11 octobre). Voir G18, G19. |
| Slide 10 · Accès restreints (confidentialité, brouillon) | Masquer certains documents selon leur classe de confidentialité ou leur statut brouillon. | Les droits sont une matrice rôle × permission globale. La confidentialité n'est qu'une étiquette, et les brouillons sont visibles de tous. | `canRead` : brouillons réservés au cercle de rédaction, confidentialité appliquée ; identité simulée. Voir G13. |

### 6.4 Les cinq options étudiées

#### Option A – Le plan du deck tel quel (SharePoint + Power Automate + Power Apps), Codex sert de maquette

On réalise les slides 5 à 11 à la lettre : bibliothèque unique, banque de termes, types de contenu, versioning, flux Power Automate et app canvas Power Apps « GED EPC2I ». Codex sert seulement de référence d'ergonomie. Son code est abandonné.

**Avantages**

- Fidèle au deck à 100 %. Les connecteurs standard (SharePoint, Approvals, Outlook, Teams) sont inclus dans les licences Microsoft 365.
- Rien à héberger. SSO Entra, droits SharePoint, audit et rétention Purview, versioning : tout est natif.
- On garde l'édition et la co-édition Office sur le poste, la synchronisation OneDrive, la recherche Microsoft 365 et Copilot, et les approbations dans Teams ou Outlook.
- Outils low-code que la DSI connaît.

**Inconvénients**

- Power Apps sur une grosse bibliothèque bute sur la délégation : Search() et les filtres sur métadonnées gérées ne sont pas délégués (plafond de 500 à 2 000 lignes). La recherche dans toute la GED et les facettes de la maquette sont difficiles à reproduire, et l'écriture des métadonnées gérées est laborieuse.
- Circuits par type, ECR/ECO, 7 statuts et codification demandent beaucoup de flux, peu testables, exécutés sous un compte de service. Sans contrôle de concurrence, le compteur d'ID peut produire des doublons.
- L'intégration avec Keystone (webhooks, index, dépôt) passe par des connecteurs HTTP ou personnalisés, qui exigent une licence Premium.
- Ergonomie inférieure à la maquette. On s'écarte de la trajectoire « Système EPC2i » (Keystone, Vigie et Cursus sont en Next.js).

**Effort** : Moyen (M) à construire, mais long à fiabiliser. Le socle SharePoint est commun à toutes les options. S'y ajoutent une dizaine de flux et une app canvas. L'effort dépend surtout de l'inventaire et du volume à migrer.

**Adéquation au deck** : Totale : c'est le deck.

#### Option B – Codex devient l'app « GED EPC2I » au-dessus de SharePoint (Microsoft Graph), avec les workflows dans Codex

SharePoint garde la bibliothèque unique, les types de contenu (DI, DE, DP, DR), la banque de termes, les versions, les droits et Purview. Il reste la référence pour les fichiers et les métadonnées. Codex remplace Power Apps et Power Automate. Il lit et écrit par Microsoft Graph (fichiers, champs, versions, banque de termes, types de contenu) avec des jetons délégués Entra ID, donc avec les droits de l'utilisateur. Un Postgres managé ne garde que ce que SharePoint ne sait pas faire : circuits, commentaires, audit métier, compteurs d'ID, liens Keystone, recherches enregistrées, et un index des métadonnées synchronisé (delta ou webhooks) pour les facettes et les tableaux de bord. « Ouvrir » renvoie vers SharePoint ou vers Word sur le poste (ms-word:ofe|u|…).

**Avantages**

- Garde le socle du deck (étapes des slides 6 et 7) et tout ce qu'il apporte : édition Office, Purview, audit Microsoft 365, recherche et Copilot, droits hérités, migration avec historique.
- Réutilise l'interface Codex et ses règles métier : circuits, délégation, verrous, gel juridique, rétention, Keystone.
- Workflows en code : testables, versionnés, numérotation transactionnelle sans doublon, circuits par type configurables.
- Intégration Keystone native (webhooks, index) sans licence Premium. SSO Entra commun avec Vigie et Keystone.

**Inconvénients**

- Le plus gros développement côté Codex : réécrire la couche données (queries.ts, actions.ts, route fichier), écrire l'adaptateur Graph, la synchronisation et la gestion des jetons.
- Pièges de Graph : l'écriture des métadonnées gérées passe par un champ caché ou l'API REST ValidateUpdateListItem. Les raffineurs de recherche exigent qu'un administrateur mappe des propriétés gérées (RefinableString). Le seuil de 5 000 éléments impose des colonnes indexées. Graph limite aussi le débit des appels.
- Deux sources à garder cohérentes. Si les utilisateurs modifient le statut ou l'ID directement dans SharePoint, ils contournent Codex : il faut masquer ces colonnes dans les formulaires et ne les écrire que via l'identité de l'application.
- Une app sur mesure à héberger et exploiter (Azure App Service ou conteneur, Postgres managé, sauvegardes, supervision). PGlite est à remplacer. Il faut un consentement administrateur Graph (Sites.Selected ou Sites.ReadWrite.All, TermStore.ReadWrite.All).

**Effort** : Élevé (L à XL). Socle SharePoint identique à A, plus : SSO Entra (S), découpage de la couche données derrière une interface DocumentStore (M), adaptateur Graph pour fichiers, versions, champs et termes (L), index, synchronisation et recherche (M à L), et alignement du modèle sur le deck (M, nécessaire dans toutes les options avec Codex). Un court POC Graph au départ réduit le risque.

**Adéquation au deck** : Forte sur le fond. On garde la bibliothèque unique, la banque de termes, les types de contenu, le versioning, les modèles, la migration par vagues et les liens d'ouverture SharePoint. Seuls les moyens des slides 8 et 9 changent : Codex au lieu de Power Automate et de Power Apps.

#### Option C – Codex au-dessus de SharePoint, avec les workflows dans Power Automate

Les données et l'interface sont comme en B, mais les circuits restent dans Power Automate. Codex écrit une colonne « demande » qui déclenche le flux, les approbations passent par Teams ou Outlook, et Codex affiche l'état en relisant les colonnes SharePoint.

**Avantages**

- Respecte aussi la slide 8. Seul Power Apps est remplacé.
- Approbations natives dans Teams et Outlook mobile.
- Les métiers peuvent ajuster certains flux sans développeur.

**Inconvénients**

- La logique est répartie entre deux systèmes : débogage difficile, cohérence fragile des statuts.
- Les écrans Validations de Codex (délégation, commentaires, étapes) deviennent des copies à reconstruire. Les données d'approbation sont dans Dataverse, et les lire depuis Codex demande une licence Premium.
- Les déclencheurs SharePoint ont une latence de l'ordre de la minute. Lancer un flux depuis Codex par HTTP exige une licence Premium. Le compteur d'ID dans un flux reste sensible à la concurrence.
- On cumule le coût de l'adaptateur Graph et celui des flux.

**Effort** : Très élevé (XL) : le coût de B côté données, celui de A côté flux, plus l'intégration entre les deux.

**Adéquation au deck** : Très forte, au prix d'une double maintenance.

#### Option D – Codex autonome qui remplace SharePoint

On poursuit l'architecture actuelle : Codex est la base et le coffre. Pour la production, il faut un Postgres managé, un stockage objet chiffré (Azure Blob), le SSO Entra (connexion seule), des droits par espace et par confidentialité, un import en masse, l'extraction du texte des PDF et fichiers Office, et des sauvegardes. SharePoint ne sert plus que de source de migration.

**Avantages**

- Maîtrise totale. C'est le chemin de code le plus direct depuis l'existant.
- Recherche à facettes rapide dans Postgres. Intégration Keystone naturelle.
- Ni complexité Graph ni licence Power Platform.

**Inconvénients**

- Contredit le deck : pas de banque de termes, ni de types de contenu, ni de versioning SharePoint, ni de Purview.
- Perte de l'édition Office en place et de la co-édition (il faut télécharger, modifier puis redéposer), de OneDrive hors ligne, de la recherche Microsoft 365 et Copilot, des étiquettes de rétention et de sensibilité, et de l'eDiscovery.
- Codex devient responsable de la valeur de preuve : journal d'audit infalsifiable, intégrité des fichiers, plan de reprise, conservation légale.
- La migration perd l'historique des versions, sauf script dédié. SharePoint reste utilisé à côté pour Teams, d'où des doublons.

**Effort** : Moyen à élevé (M à L) pour passer en production, puis un coût d'exploitation et de conformité récurrent à porter soi-même.

**Adéquation au deck** : Faible. On garde l'intention (référentiel unique classé par métadonnées, workflows, app unique) mais on abandonne « via les outils Microsoft existants ».

#### Option E – Hybride progressif : socle SharePoint d'abord, Codex d'abord en lecture

On construit le socle SharePoint du deck (étapes des slides 6 et 7). Le premier Codex branché sur SharePoint ne fait que lire via Graph : recherche, fiche, tableau de bord, vue Keystone, bouton « Ouvrir dans SharePoint ». La création se fait dans SharePoint, avec un flux simple de codification. On fait ensuite basculer la création et les workflows dans Codex, ce qui mène à la cible B.

**Avantages**

- Valeur rapide et risque faible : la lecture via Graph est simple et ne pose pas le problème d'écriture des métadonnées gérées.
- Le socle SharePoint est utile quelle que soit l'interface retenue.
- Permet de comparer sur pièces avant d'investir dans l'écriture.

**Inconvénients**

- Pendant la transition, deux interfaces coexistent (SharePoint pour créer, Codex pour chercher), ce qui contredit la slide 10 (« accès via l'app commune »).
- Le flux de codification provisoire sera à réécrire au passage vers B.

**Effort** : Moyen (M) pour la première étape (socle + Codex en lecture avec SSO), puis des incréments vers B.

**Adéquation au deck** : Forte : on suit l'ordre des étapes du deck et on ne remplace que l'interface.

### 6.5 Recommandation de l'audit (non retenue)

Je recommande de garder le socle SharePoint du deck et de faire de Codex l'app « GED EPC2I » à la place de Power Apps (option B), en y allant par étapes (option E).

1) Le socle SharePoint des slides 6 et 7 se fait sans dépendre de Codex : inventaire, banque de termes construite à partir des slides 13 à 18, types de contenu DI, DE, DP et DR, bibliothèque unique, versioning majeur et mineur avec masquage des brouillons, modèles, migration par vagues avec les outils Microsoft. Il est utile quelle que soit l'interface retenue, et c'est lui qui garde l'édition Office, Purview, l'audit Microsoft 365 et la sécurité Entra.

2) Les workflows vont dans Codex, pas dans Power Automate. Codex a déjà les circuits, la délégation, les commentaires, l'audit métier et la frontière Keystone, et Keystone l'attend comme responsable de la numérotation et des circuits. Power Automate reste possible pour des automatismes simples, par exemple codifier un fichier déposé directement dans la bibliothèque.

3) Avant d'intégrer quoi que ce soit, trois chantiers préparent Codex :
- aligner le modèle sur le deck : Domaine > Catégorie > Type > Sous-type, les 7 statuts, les niveaux de confidentialité, les champs de niveau 4 et la règle de codification ;
- placer l'accès aux données derrière une interface DocumentStore, en gardant l'implémentation locale actuelle pour le développement et la démo, puis ajouter une implémentation Graph ;
- remplacer l'utilisateur simulé par le SSO Entra ID, commun avec Vigie et Keystone.

4) Un court POC Graph doit lever les trois risques techniques : écriture des métadonnées gérées, raffineurs de recherche, jetons délégués.

Je déconseille l'option D (Codex autonome). Elle contredit le deck et fait perdre l'édition Office, Purview et la recherche Microsoft 365, pour un coût d'exploitation et de conformité que SharePoint couvre déjà.

Condition pour B : la DSI doit accepter d'héberger et de maintenir une application sur mesure, et il faut une capacité de développement dans la durée. Sinon, l'option A (le deck tel quel, Codex servant de maquette) est le choix réaliste.

### 6.6 Questions clés de l'analyse d'architecture

1. Quelle est la source de vérité des fichiers et des métadonnées : SharePoint, comme dans le deck, ou Codex ?
    - **Suite** : **Répondu** (D-06) : Codex.
2. Où vivent les workflows (création, validation, ECR/ECO, obsolescence) : dans Codex ou dans Power Automate ? Les notifications et approbations doivent-elles apparaître dans Teams ou Outlook ?
    - **Suite** : **Répondu** (D-06) : dans Codex. Notifications dans Teams ou Outlook : non discuté.
3. La DSI accepte-t-elle d'héberger et d'exploiter une application sur mesure (Azure App Service ou conteneur, Postgres managé, sauvegardes) ? Qui la maintient ? Est-ce la trajectoire voulue pour tout le « Système EPC2i » (Keystone, Vigie, Cursus) ?
    - **Suite** : **Ouvert.** Le choix de Codex implique une application sur mesure à héberger ; qui l'héberge et la maintient n'a pas été dit.
4. Quelles licences Microsoft 365 avez-vous (Business Premium, E3, E5) ? L'application automatique d'étiquettes de rétention et la revue de destruction demandent E5 ou E5 Compliance. Les connecteurs HTTP ou personnalisés vers Keystone demandent Power Platform Premium.
    - **Suite** : **Sans objet en grande partie** : la Power Platform est abandonnée. Reste à voir pour SharePoint si l'option de stockage est retenue.
5. Identité : Codex passe-t-il au SSO Entra ID ? Graph doit-il agir avec les droits de chaque utilisateur (jetons délégués, droits SharePoint appliqués) ou avec une identité d'application (droits gérés par Codex) ? Quelle portée accorder (Sites.Selected ou Sites.ReadWrite.All, TermStore) ?
    - **Suite** : **Proposé, non confirmé** : Entra ID (O-02). Le pilote SharePoint écrit utilise l'identité de l'application (`src/lib/storage.ts`) ; la portée des droits Graph n'est pas décidée.
6. Confidentialité dans une bibliothèque unique : permissions élément par élément (déconseillé au-delà de quelques milliers d'éléments), site ou bibliothèque séparé pour le « Très confidentiel », ou étiquettes de sensibilité Purview ? Quel est l'ordre exact des niveaux, et faut-il garder un niveau « Public » comme dans Codex ?
    - **Suite** : **Répondu** pour l'ordre et le niveau Public (D-13). Le mécanisme dans SharePoint est sans objet si les utilisateurs n'ont pas accès à la bibliothèque (O-01).
7. Format de l'ID document : selon le type (deck), D-#### ou AFF-…-DOC-### (Codex actuel) ou TYPE-PROJ-SEQ (spec Keystone) ? Faut-il utiliser l'ID de document natif SharePoint ou un compteur Codex ? L'ID reste-t-il figé si le type change ?
    - **Suite** : **Répondu** (D-09, D-10) : compteur Codex ; ID figé à la première approbation (proposé, non confirmé).
8. Le modèle de métadonnées du deck (4 domaines, Catégorie > Type > Sous-type, Département/Fonction, champs de niveau 4) remplace-t-il les 4 axes de Codex (entité, service, processus, type) ? Où va l'axe Entité/site du groupe, que le deck ne mentionne pas ?
    - **Suite** : **Répondu** (D-07, D-08). Entité / site : en attente de l'organigramme (D-19).
9. Cycle de vie : faut-il passer aux 7 statuts du deck, avec un passage automatique d'Approuvé à En vigueur à la date d'effet ? La demande de modification ECR/ECO d'un document vit-elle dans Codex, ou réutilise-t-on le module ECO de Keystone ?
    - **Suite** : **Répondu** (D-11, D-12, D-16) : statuts du deck répartis entre révision et document ; ECR/ECO dans Vigie, pas dans le module ECO de Keystone. Passage automatique à la date d'effet : proposé, non confirmé.
10. Rétention : la « classe de conservation » doit-elle correspondre à des étiquettes de rétention Purview, et le gel juridique à une conservation eDiscovery, ou rester des règles Codex ?
    - **Suite** : **Répondu** (D-06, D-20) : règles de conservation dans Codex.
11. L'édition et la co-édition Office sur le poste, et l'accès hors ligne via OneDrive, sont-ils indispensables ? Si oui, SharePoint comme coffre est quasi obligatoire.
    - **Suite** : **Ouvert**, lié à O-01 : sans accès direct à la bibliothèque, on modifie un fichier en le téléchargeant puis en le redéposant, sans édition Office en ligne.
12. Migration : où sont les arborescences actuelles (SharePoint ou Teams, serveurs de fichiers), quel volume, et faut-il garder l'historique des versions ?
    - **Suite** : **Répondu en partie** (D-21) ; volumes, emplacements et historique des versions : O-11.

### 6.7 La décision de l'utilisateur

À la question 1 de l'audit (« Socle technique : SharePoint reste-t-il le coffre-fort et la source de vérité, avec
Codex comme interface ? Ou Codex le remplace-t-il ? Les workflows tournent-ils dans Codex ou dans Power Automate ? »),
l'utilisateur a répondu le 7 octobre à 13:38 :

> Codex prends toute la charge et les workflow, la seule option ouverte si c'est plus simple est que le stockage des documents soit sous une bibliothèque sharepoint gérée par Codex (les metadonnées et autres informations sont dans codex et uniquement le document et son nom et sa version sont mises dans sharepoin)..

Ce que cela veut dire (D-06) :

- **Codex prend tout en charge**, workflows compris : métadonnées, droits, révisions, circuits de validation, journal
  d'audit. Ni Power Automate, ni Power Apps, ni banque de termes SharePoint.
- **La seule option ouverte** est de ranger les fichiers dans une bibliothèque SharePoint **gérée par Codex**. Elle ne
  reçoit que le fichier, son nom et sa version ; toutes les métadonnées restent dans Codex.
- Cette décision ne correspond exactement à aucune des cinq options du §6.4. La plus proche est l'option D (Codex
  autonome), avec SharePoint comme stockage de fichiers possible. L'audit déconseillait l'option D et recommandait B
  puis E (§6.5) : **cette recommandation n'a pas été suivie**.

Mise en œuvre et points encore ouverts :

- `docs/modele-cible.md` §1 : Codex source de vérité ; stockage des fichiers derrière une interface unique.
- `src/lib/storage.ts` : `CODEX_STORAGE=local` par défaut (disque, `.data/files`) ; `CODEX_STORAGE=sharepoint` en
  option, par Microsoft Graph avec l'identité de l'application (`CODEX_SP_TENANT_ID`, `CODEX_SP_CLIENT_ID`,
  `CODEX_SP_CLIENT_SECRET`, `CODEX_SP_DRIVE_ID`). Dans SharePoint, chaque fichier est rangé dans un dossier au nom de
  l'ID et nommé `{ID}_{indice}.{ext}`. **Jamais testé sur un vrai tenant.**
- *Provisoire* (`docs/modele-cible.md` §1) : un fichier par version de travail et aucun accès direct des utilisateurs à
  la bibliothèque. La question a été posée quatre fois sans réponse (O-01).
- L'authentification reste simulée ; Entra ID est proposé, non confirmé (O-02).

## 7. Critique du deck et complétude

Chaque point garde le texte de l'audit. La mention **Suite** dit ce qu'il est devenu : répondu (avec la décision),
tranché dans le modèle ou le code, ouvert, ou sans objet.

### 7.1 Ambiguïtés (24)

#### A01 — Socle technique : M365 ou Codex (slides 4, 5, 9, 10)

- **Constat** : Le deck repose sur une bibliothèque SharePoint unique, des flux Power Automate et une IU Power Apps (slide 5). La slide 4 montre aussi Power BI, Power Pages et Power Virtual Agents sans leur donner de rôle. Or Codex est une application sur mesure (Next.js, Postgres embarqué) qui stocke elle-même les fichiers, les versions, les circuits et la taxonomie. Le deck ne dit pas lequel des deux est la cible.
- **Question** : Abandonnez-vous le socle Microsoft au profit de Codex ? Ou Codex doit-il devenir l'interface posée sur SharePoint, avec les fichiers, le versioning et la banque de termes qui restent dans M365 et sont lus par l'API Graph ? Quel rôle donnez-vous à Power BI, Power Pages et Power Virtual Agents (slide 4) ?
- **Suite** : **Répondu** (D-06) : Codex prend tout en charge, sans Power Automate ni Power Apps ; SharePoint au plus comme stockage de fichiers piloté par Codex. Le rôle de Power BI, Power Pages et Power Virtual Agents n'a pas été discuté ; ils sont hors périmètre (`docs/decisions.md`, « Ce qui est explicitement hors périmètre »).

#### A02 — Format de l'ID document (codification) (slides 7, 8, 11, 13)

- **Constat** : L'ID est 'généré automatiquement', 'unique et immuable' et construit 'en fonction de son type'. Le deck ne donne ni sa structure, ni le périmètre de son compteur, ni le moment où il est attribué. Codex produit aujourd'hui D-#### pour le groupe et AFF-xxxx-DOC-### pour les affaires.
- **Question** : Quel est le format exact de l'ID ? Quels segments, et dans quel ordre : domaine DI/DE/DP/DR, société ou site, code type, code projet, année, numéro chrono ? Le compteur est-il global, par type ou par projet ? L'indice de révision fait-il partie de l'ID ? L'ID est-il attribué dès le brouillon ou seulement à l'approbation, et accepte-t-on des trous de numérotation quand un brouillon est abandonné ? Garde-t-on le format actuel de Codex ?
- **Suite** : **Répondu** (D-09, D-10) : `TYPE-CONTEXTE-SEQ` ; l'indice de révision ne fait pas partie de l'ID (D-11). Proposé, non confirmé : compteur par couple (type, contexte) et sa largeur, ID attribué dès le brouillon, ID figé à la première approbation, alias en cas de reclassement. Les trous de numérotation n'ont pas été discutés.

#### A03 — ID, nom de fichier et Titre (slides 7, 13)

- **Constat** : La slide 7 parle de 'codification automatique du nom de document'. La slide 13 distingue pourtant un champ 'ID document' et un champ 'Titre'. On ne sait pas si le fichier physique est renommé.
- **Question** : La codification renomme-t-elle le fichier (nom de fichier = ID), ou l'ID n'est-il qu'une métadonnée, le nom de fichier restant libre ? Le Titre est-il libre ou suit-il une règle de nommage (par exemple « Type – Objet – Site ») ?
- **Suite** : **Répondu en partie** : le nom et l'ID ne changent pas d'une révision à l'autre (D-11). Proposé, non confirmé : nom du fichier stocké `{ID}_{indice}.{ext}` et titre libre (D-10).

#### A04 — Rôle de Catégorie, Type et Sous-type (slides 7, 8, 13, 14, 15, 16, 17)

- **Constat** : Les trois niveaux sont des métadonnées gérées, Catégorie et Type étant obligatoires. Le deck ne dit pas quel niveau pilote quel automatisme. La codification et le circuit sont dits 'en fonction du type'. Rien n'est dit pour la rétention, les modèles ou la confidentialité par défaut.
- **Question** : Pour chaque niveau (Catégorie, Type, Sous-type), quels automatismes déclenche-t-il : préfixe de codification, circuit de validation, classe de conservation, modèle, confidentialité par défaut, périodicité de revue ? Le Sous-type, facultatif, peut-il changer l'un de ces comportements ? Par exemple, une SOP et une instruction de travail suivent-elles le même circuit ?
- **Suite** : **Répondu par le registre** (D-07, « pour le moment ») : le type porte le code, le circuit, la conservation, les niveaux de confidentialité admis et, quand elle existe, la clause ISO (40 types sur 69) ; le sous-type ne déclenche aucun automatisme. Contenu du registre proposé par l'assistant, non validé type par type (O-05).

#### A05 — Gouvernance des sous-types et de la banque de termes (slides 6, 13, 14, 15, 16, 17)

- **Constat** : Les colonnes s'intitulent 'Exemples de sous-types'. On ne sait pas si la liste est fermée ou ouverte, ni qui la fait évoluer. Elle contient aussi des synonymes, comme 'Procédure standard' et 'SOP'.
- **Question** : Les sous-types forment-ils une liste fermée et validée, ou chacun peut-il en ajouter ? Qui peut créer, renommer, fusionner ou retirer une catégorie, un type ou un sous-type, et avec quelle validation ? Que deviennent les documents classés sous un terme retiré ?
- **Suite** : **Ouvert.** Les sous-types restent une liste ouverte ; personne n'a décidé qui crée, renomme ou retire des termes. L'écran ne permet pas de modifier libellés et sous-types (G03).

#### A06 — Deux axes mélangés dans la taxonomie DI (slides 13, 14)

- **Constat** : Dans les DI, certains 'Types' décrivent la nature du document (Politique, Procédure, Enregistrement de gouvernance). D'autres décrivent un domaine fonctionnel (RH & Formation, Finance & Administration, IT & Sécurité de l'information), ce qui fait aussi doublon avec le champ obligatoire 'Département / Fonction'. Une procédure de sauvegarde informatique peut donc se classer à deux endroits.
- **Question** : Une procédure IT se classe-t-elle en 'Gouvernance & Management / Procédure' ou en 'Fonctions support / IT & Sécurité de l'information' ? Acceptez-vous de séparer l'axe « nature du document » (politique, procédure, instruction, enregistrement, rapport) de l'axe « fonction », déjà porté par Département / Fonction ?
- **Suite** : **Ouvert.** Le registre garde les catégories du deck ; la question n'a pas été posée à l'utilisateur.

#### A07 — Circuit de validation par type (slides 8, 9, 11, 18)

- **Constat** : Le deck parle d'un 'circuit de validation prédéfini en fonction du type de document' sans donner aucune matrice. Codex a trois circuits figés (simple, signature, relecture), avec des étapes HSE et Direction codées en dur.
- **Question** : Pouvez-vous fournir la matrice type → circuit ? Elle doit préciser le nombre d'étapes, le rôle de chaque étape (rédaction, vérification, approbation, publication), si les étapes sont séquentielles ou parallèles, les délais, relances et délégations, et ce qui se passe en cas de refus. L'approbateur est-il une fonction (« responsable QHSE du site ») ou une personne nommée ? Les documents externes (DE) passent-ils par une validation, ou seulement par un enregistrement ou une revue de prise en compte ?
- **Suite** : **Répondu en partie** (D-15) : plusieurs circuits, construits à partir des rôles et des documents, sans autorité d'approbation. La matrice type → circuit du registre est provisoire (O-06). Délais, relances et circuits parallèles non décidés ; trois types sans circuit (LET, RFQ, PHO) sont approuvés dès la demande (choix de l'assistant).

#### A08 — ECR/ECO : définition et étapes (slides 8, 9, 11)

- **Constat** : Le 'principe de l'ECR/ECO' (Engineering Change Request / Order, issu de la gestion de configuration) est cité trois fois sans être défini : ni objet, ni étapes, ni acteurs.
- **Question** : Chez EPC2I, la demande de modification (ECR) est-elle un objet distinct avec son propre numéro ? Qui peut l'émettre, et qui l'accepte ou la refuse (le propriétaire, un comité) ? Faut-il une analyse d'impact (documents liés, formations, projets en cours) ? L'ECO consiste-t-il à ouvrir une nouvelle révision en brouillon pendant que la révision courante reste 'En vigueur' ? Ce mécanisme vaut-il pour les quatre domaines ou seulement pour les DI et DP techniques ?
- **Suite** : **Répondu** (D-16, D-18) : ECR/ECO centralisés dans Vigie ; les demandes se font depuis Codex (documents) ou Keystone (projets). Les étapes sont à définir dans Vigie (O-10).

#### A09 — Cycle de vie : transitions et déclencheurs (slides 8, 11, 13)

- **Constat** : La slide 13 liste sept statuts (Brouillon, En révision, Approuvé, En vigueur, Remplacé, Archivé, Obsolète) sans dire quelles transitions sont permises, ni qui ou quoi les déclenche. Codex n'en gère que quatre (brouillon, en validation, publié, archivé).
- **Question** : Pouvez-vous décrire le cycle de vie complet ? Pour chaque transition autorisée : qui la déclenche, ou quel événement (fin de circuit, date d'effet, date d'expiration, publication d'une nouvelle révision, demande d'obsolescence) ? Peut-on revenir en arrière, par exemple d'Obsolète à En vigueur ? Ces sept statuts s'appliquent-ils aux quatre domaines, y compris aux documents externes ?
- **Suite** : **Répondu en grande partie** (D-11, D-12, D-17). Le détail du cycle (`docs/modele-cible.md` §4 : mise en vigueur à la date d'effet, révision précédente « Remplacé », Obsolète = retrait, Archivé = fin de vie active) est proposé par l'assistant ; l'utilisateur n'a corrigé que les versions de travail. Le retour d'Obsolète à En vigueur n'a pas été discuté.

#### A10 — Sens de « En révision » (slides 8, 13)

- **Constat** : 'En révision' peut vouloir dire 'en cours de validation' (circuit lancé) ou 'en cours de modification après une ECR'. Ce sont deux états différents.
- **Question** : « En révision » désigne-t-il un document en circuit de validation, ou un document approuvé en cours de modification ? Faut-il deux statuts distincts, par exemple « En validation » et « En modification » ?
- **Suite** : **Tranché dans le modèle, non confirmé** : « En révision » = circuit lancé ; une modification ouvre la révision suivante en Brouillon (`docs/modele-cible.md` §4).

#### A11 — Classes de conservation non définies (slides 3, 13)

- **Constat** : 'Classe de conservation' est une métadonnée gérée obligatoire, et la conformité légale est un objectif annoncé (slide 3). Pourtant aucune classe, durée, point de départ ou sort final n'est défini. Codex contient cinq règles de démonstration (R-10, R-5, R-5c, R-perm, R-fin) encore à confirmer.
- **Question** : Quelle est la liste des classes de conservation ? Pour chacune : code, durée, événement de départ (création, fin de validité, clôture projet, fin de contrat, clôture d'exercice), sort final (destruction, archivage définitif, revue) et valideur (Juridique ?). La classe est-elle déduite du type ou choisie par l'utilisateur ? Les durées varient-elles selon le pays des filiales (France, Royaume-Uni, Maroc) ?
- **Suite** : **Répondu en partie** (D-20 : « selon les règles d'usage par type de document ») : une règle par type dans le registre. Durées à confirmer (O-07) ; la variation par pays n'a pas été discutée.

#### A12 — Confidentialité : qui voit quoi (slides 10, 13, 18)

- **Constat** : Quatre niveaux sont listés et la slide 10 dit que les accès 'peuvent être restreints au besoin', mais aucune règle de visibilité n'est donnée. Dans Codex, la confidentialité est seulement affichée et ne filtre pas encore les accès.
- **Question** : Pour chaque niveau, qui peut voir, télécharger, imprimer et partager le document : tout le groupe, une société ou un site, un département, une liste nominative ? Qui fixe le niveau, et peut-il changer après approbation ? Un document projet hérite-t-il du niveau de son projet ? Dans une bibliothèque unique, faut-il appliquer la restriction par permissions document par document ou par étiquettes de sensibilité ?
- **Suite** : **Répondu** (D-13) pour l'échelle et le niveau Public. Les règles de visibilité par niveau (`docs/modele-cible.md` §5) sont proposées par l'assistant. Qui fixe le niveau, et s'il peut changer après approbation : non décidé.

#### A13 — Visibilité des brouillons et des anciennes versions (slides 10, 13)

- **Constat** : La slide 10 cite le statut 'brouillon' comme motif de restriction, sans dire pour qui. Rien n'est dit sur la visibilité des révisions remplacées ou obsolètes.
- **Question** : Qui voit un brouillon : l'auteur et le propriétaire seulement, ou aussi les valideurs et le département ? Les révisions Remplacées et Obsolètes restent-elles consultables par tous, avec un bandeau d'avertissement, ou seulement par les gestionnaires documentaires ?
- **Suite** : **Répondu** pour les brouillons (D-14). Proposé, non confirmé : hors du cercle de rédaction, seul le fichier de la révision en vigueur est accessible, donc pas les révisions remplacées.

#### A14 — Département / Fonction et entités du groupe (slides 13, 18)

- **Constat** : 'Département / Fonction' a pour utilité 'Entité métier'. Le mot 'entité' peut désigner un service fonctionnel ou une société ou un site du groupe. Le deck n'a aucun champ Société ou Site, alors que Codex structure ses espaces par entité (Siège Lyon, usine de Cugny, Dépôt Nord, Dépôt Sud, filiale UK, agence Maroc). L'axe 'Processus' de Codex n'apparaît dans le deck qu'à travers le champ 'Propriétaire de processus'.
- **Question** : « Entité métier » désigne-t-elle un département (RH, Qualité, Achats…) ou une société ou un site ? Où renseigne-t-on la société ou le site, indispensable pour les droits, la rétention par pays et les espaces ? Faut-il garder dans Codex un axe « Processus » distinct, et d'où vient sa liste de valeurs ?
- **Suite** : **En attente** de l'organigramme (D-19, O-04). Le modèle v2 a un Département obligatoire et un Site facultatif ; l'axe Processus a disparu.

#### A15 — Auteur, Propriétaire, Propriétaire de processus (slides 13, 18)

- **Constat** : Le Propriétaire est un 'responsable métier interne'. L'Auteur est 'personne ou texte, auteur réel ou organisme émetteur'. La slide 18 ajoute un 'Propriétaire de processus' pour les DI. Les rôles et obligations de chacun ne sont pas distingués, pas plus que le déposant.
- **Question** : Pour un document interne, l'Auteur est-il le rédacteur, distinct du déposant et du propriétaire ? Peut-il y avoir plusieurs auteurs ? Quelles obligations porte le propriétaire (revue périodique, traitement des ECR, renouvellement) ? Qui reprend ses documents quand il quitte l'entreprise ? En quoi le Propriétaire de processus diffère-t-il du Propriétaire du document ?
- **Suite** : **Ouvert.** Les champs existent (propriétaire transférable, auteur personne ou texte, propriétaire de processus facultatif), mais les obligations de chacun et la reprise des documents d'une personne qui part ne sont pas définies.

#### A16 — Numérotation des versions et révisions (slides 7, 13)

- **Constat** : La slide 13 impose un champ 'Version / Révision' en texte obligatoire, et la slide 7 un 'paramétrage du versioning'. Le deck ne dit pas comment s'articulent la version technique (chaque enregistrement) et la révision métier (chaque approbation). Codex utilise un schéma majeur.mineur.
- **Question** : Quel schéma d'indice voulez-vous : A, B, C ; 00, 01 ; ou 1.0, 1.1 ? Les brouillons portent-ils des versions mineures (0.1, 0.2) et l'approbation une version majeure ? Une correction de forme sans changement de fond incrémente-t-elle l'indice ? L'indice est-il imprimé dans l'en-tête ou le pied de page du document ?
- **Suite** : **Répondu** (D-11, D-12) : indices en lettres, versions de travail A.1, A.2.

#### A17 — Sémantique des dates (slides 13, 18)

- **Constat** : La 'Date d'émission' est décrite comme 'Première émission', donc figée à la première révision, ce qui laisse sans date la révision courante. Les dates d'effet, de révision et d'expiration sont facultatives et sans automatisme décrit. Pour les DE, la slide 18 ajoute une date de réception.
- **Question** : Où se trouve la date d'approbation de la révision courante ? Pour un document externe, la date d'émission est-elle celle de l'émetteur, distincte de la date de réception ? La date de révision est-elle calculée selon une périodicité par type (par exemple procédures tous les trois ans) ? Que se passe-t-il automatiquement à la date d'effet (passage En vigueur ?) et à la date d'expiration (alerte, passage Obsolète, renouvellement) ?
- **Suite** : **Répondu en partie**, dans le code : date d'émission = première mise en vigueur, date d'effet et date d'approbation portées par chaque révision. Proposé, non confirmé. Date d'émission d'un document externe, périodicité de revue et effet de la date d'expiration : ouverts.

#### A18 — Gestion multilingue (slides 13)

- **Constat** : Le champ 'Langue' (choix, facultatif) est censé assurer la 'gestion multilingue', sans plus de détail. Le groupe a une filiale UK et une agence au Maroc, et Codex gère une interface FR/EN avec des documents en fr ou en.
- **Question** : Une traduction est-elle un document distinct, avec son propre ID, ou une variante linguistique du même ID ? Quelle langue fait foi ? Une nouvelle révision de la version maîtresse rend-elle les traductions obsolètes ? Quelles langues faut-il gérer (FR, EN, arabe ?) et le champ doit-il accepter plusieurs valeurs pour les documents bilingues ? Les libellés de la taxonomie doivent-ils être traduits ?
- **Suite** : **Ouvert.**

#### A19 — Pages dédiées métiers (slides 10)

- **Constat** : La slide 10 annonce des 'pages dédiées métiers' qui 'mettent en avant les filtres principaux', sans liste des métiers ni des filtres.
- **Question** : Quelles pages métiers faut-il au lancement ? Pour chacune, quels filtres par défaut, quels indicateurs et quels raccourcis de création ? Qui les définit et les maintient ? L'utilisateur arrive-t-il automatiquement sur sa page selon son département ou choisit-il ? Ces pages sont-elles de simples recherches enregistrées, comme dans Codex, ou des tableaux de bord distincts ?
- **Suite** : **Ouvert.**

#### A20 — Demande de passage à Obsolète (slides 8, 9, 11)

- **Constat** : Un flux d'obsolescence est prévu, mais ni le demandeur, ni l'approbateur, ni les conséquences ne sont définis.
- **Question** : Qui peut demander l'obsolescence et qui l'approuve ? Faut-il obligatoirement désigner un document de remplacement ? Que deviennent les documents et projets qui y font référence ? Le passage à Obsolète déclenche-t-il le décompte de conservation ?
- **Suite** : **Répondu en partie** (D-17 : « c'est un workflow vigie »). Qui demande, document de remplacement et effet sur les documents liés : à définir avec Vigie (O-10).

#### A21 — Mots-clés (slides 13)

- **Constat** : Le champ Mots-clés est une 'métadonnée gérée multiple', sans préciser s'il s'agit d'un thésaurus fermé ou de mots-clés libres.
- **Question** : Les mots-clés viennent-ils d'un thésaurus fermé tenu par le gestionnaire documentaire, ou chacun peut-il en saisir librement ? Qui fait le ménage dans les doublons ?
- **Suite** : **Ouvert** (mots-clés toujours libres, voir G32).

#### A22 — Création de document et modèles (slides 7, 9, 11)

- **Constat** : La slide 11 annonce 'la création de documents', la slide 7 des 'premiers documents type (templates)'. On ne sait pas si l'on crée depuis un modèle, si l'on dépose un fichier existant, ou les deux, ni quels modèles existent.
- **Question** : Créer un document, est-ce partir d'un modèle Word ou Excel dont l'en-tête est prérempli (ID, titre, révision, statut), déposer un fichier existant, ou les deux ? Quels types ont un modèle dès le lancement ? Qui possède les modèles, et comment sont-ils eux-mêmes versionnés ?
- **Suite** : **Répondu en partie** : on crée depuis un modèle, depuis un fichier ou sans fichier (`createDocument`) ; les modèles sont les documents FRM au contexte QMS (D-10). La liste des modèles du lancement reste à fournir ; l'en-tête des fichiers n'est pas prérempli.

#### A23 — Migration de l'existant (slides 6, 7)

- **Constat** : La 'migration par vagues' est citée deux fois sans critère de découpage, sans périmètre et sans méthode d'indexation des documents existants.
- **Question** : Selon quels critères découpez-vous les vagues (département, site, domaine) ? Migre-t-on seulement les versions en vigueur, ou aussi l'historique et les documents périmés ? Comment attribue-t-on les métadonnées obligatoires et un ID aux documents existants : saisie manuelle, ou règles automatiques à partir des anciennes arborescences ? Conserve-t-on l'ancienne référence dans un champ dédié ? Quel statut reçoit un document migré ?
- **Suite** : **Répondu en partie** (D-21) : outil séparé, hors de Codex, qui appelle `POST /api/import` ; l'ancienne référence est gardée en alias. Critères des vagues, versions à reprendre et volumes : ouverts (O-11).

#### A24 — Valeurs des champs spécifiques (niveau 4) (slides 16, 17, 18)

- **Constat** : La slide 18 rend obligatoires des champs dont aucune liste de valeurs n'est donnée : phase projet, lot / work package, discipline, programme et thème de recherche, ID étude/essai, statut publication / PI, sens entrant/sortant. Le champ 'statut publication / PI' crée en outre un second cycle de vie à côté du Statut.
- **Question** : Pouvez-vous fournir les listes de valeurs de chaque champ du niveau 4, et dire qui les maintient ? Ces listes viennent-elles d'une autre application (Keystone pour les projets, un référentiel R&D pour les programmes et études) ? Comment le 'statut publication / PI' s'articule-t-il avec le Statut documentaire ?
- **Suite** : **Répondu en partie** : la phase propose les 12 étapes de Keystone (choix de l'assistant). Les autres listes de valeurs sont ouvertes.

### 7.2 Contradictions (16)

#### C01 — Ordre des étapes entre les slides 6 et 7 (slides 6, 7)

- **Constat** : Les deux slides portent le même titre mais ordonnent les étapes différemment. En slide 6 : métadonnées dans la banque de termes (2), puis bibliothèque (3), puis migration (4). En slide 7 : bibliothèque d'abord (1), puis métadonnées (2), versioning (3), modèles (4) et migration (5). On ne sait pas si les slides 6 à 9 forment un plan unique ou quatre chantiers parallèles, un par outil.
- **Suite** : **Sans objet en grande partie** (D-06) : les étapes propres à SharePoint et à la Power Platform disparaissent.

#### C02 — Migration et suppression avant les flux et l'application (slides 6, 7, 8, 9)

- **Constat** : La migration (slides 6-7) et la suppression des anciennes arborescences (slide 6, étape 5) arrivent avant les flux (slide 8) et l'application (slide 9). Or la codification est produite par le flux de création (slides 8-9). Les documents migrés n'auraient donc pas d'ID, ou contourneraient le flux. Les utilisateurs perdraient aussi leurs anciens dossiers avant d'avoir l'application.
- **Suite** : **Tranché** (D-21) : la migration est un outil séparé qui reçoit ses ID de Codex à l'import (`POST /api/import`).

#### C03 — Analyse des besoins placée trop tard (slides 6, 8, 9)

- **Constat** : L'identification des besoins par département arrive à l'étape 1 de la slide 9, après la construction de la taxonomie et de la bibliothèque (slides 6-7). La slide 8 identifie déjà les flux 'en fonction des besoins' avant que ces besoins aient été recueillis.
- **Suite** : **Ouvert** : le recueil des besoins par département n'est pas fait.

#### C04 — Qui produit la codification (slides 7, 8, 9, 11)

- **Constat** : La codification est attribuée à trois composants différents : un paramétrage de la bibliothèque (slide 7), un flux Power Automate de création (slides 8-9) et l'application qui 'fournit l'ID unique' (slide 11).
- **Suite** : **Tranché** : Codex attribue l'ID (`nextDocId`, `src/lib/codification.ts`), D-06 et D-09.

#### C05 — ID immuable mais dépendant du type (slides 7, 13)

- **Constat** : L'ID est 'unique et immuable' (slide 13) mais construit 'en fonction de son type' (slide 7). Si un document est reclassé (erreur de type, changement de domaine ou de projet), soit l'ID devient trompeur, soit il doit changer, ce qui contredit l'immuabilité.
- **Suite** : **Tranché dans le modèle** : ID figé à la première approbation ; avant, un reclassement donne un nouvel ID et garde l'ancien en alias. Proposé, non confirmé (D-10).

#### C06 — « Validé » et « Approuvé / En vigueur » (slides 8, 11, 13)

- **Constat** : La slide 11 parle de documents 'en statut validé', alors que la liste de la slide 13 ne contient pas de statut 'Validé'. Elle contient 'Approuvé' et 'En vigueur', sans que leur différence soit expliquée (date d'effet ? diffusion ?).
- **Suite** : **Tranché de fait dans le code** : une demande de modification ou de retrait exige une révision en vigueur (`requestChange`). Non confirmé par l'utilisateur.

#### C07 — Remplacé, Obsolète et Archivé (slides 6, 7, 8, 11, 13)

- **Constat** : La slide 13 distingue trois statuts de fin de vie, mais les flux (slides 8, 9, 11) ne parlent que d'Obsolète. Avec le versioning de la slide 7, une nouvelle révision est une version du même élément : un statut 'Remplacé' au niveau du document n'a de sens que si le remplacement crée un nouvel ID. Le mot 'Archivage' sert aussi à la fois de statut (slide 13) et de traitement des anciennes arborescences (slide 6).
- **Suite** : **Tranché dans le modèle** (`docs/modele-cible.md` §4) : Remplacé = révision précédente, Obsolète = retrait décidé dans Vigie (D-17), Archivé = fin de vie active. « Remplacé » est proposé, non confirmé (D-11).

#### C08 — Échelle de confidentialité (slides 10, 13)

- **Constat** : L'ordre 'Interne / Confidentiel / Très confidentiel / Restreint' place Restreint au-dessus de Très confidentiel. C'est l'inverse de l'usage français, et de Codex, où Restreint est en dessous de Confidentiel. Il n'existe pas de niveau 'Public', alors que DE et DR contiennent des documents publics (lois, normes, articles publiés, FDS) et que Codex a ce niveau. La slide 10 parle de 'classe' de confidentialité, la slide 13 de 'niveau'.
- **Suite** : **Tranché** (D-13) : Public < Restreint < Interne < Confidentiel < Très confidentiel.

#### C09 — Domaine dérivé mais obligatoire, et deux axes confondus (slides 12, 13)

- **Constat** : Le Domaine est 'dérivé du type de contenu' mais marqué 'Obligatoire', alors qu'un champ calculé n'a pas à être saisi. Surtout, les quatre types de contenu mélangent l'origine (interne / externe) et le contexte (projet / recherche). Une datasheet fournisseur reçue pour un projet, ou un contrat client d'une affaire, appartient à la fois à DE et à DP.
- **Suite** : **Tranché** (D-08) : deux axes, origine et rattachement.

#### C10 — Recouvrements entre domaines (slides 14, 15, 16, 17)

- **Constat** : Plusieurs documents apparaissent dans deux domaines. 'Demande d'achat' figure en DI (Finance & Administration) et en DP (Administration contractuelle). 'RFQ' figure en DE (Échange commercial) et en DP (Consultation). 'Journal de décisions' figure en DI et en DP. 'Budget' figure en DI et 'budget initial' en DP. 'Accord' (DE) recoupe 'accord de collaboration' (DR). 'Note de réunion' (DE), 'PV de réunion' (DI) et 'compte rendu de réunion scientifique' (DR) se recoupent aussi. Le même document peut donc recevoir deux classements.
- **Suite** : **Ouvert** : les doublons sont gardés dans le registre (question 7 de `docs/registre-points-ouverts.md`, O-05).

#### C11 — DE d'origine externe mais avec des documents sortants (slides 12, 18)

- **Constat** : Le DE est défini comme 'Origine externe' (slide 12), mais la slide 18 lui ajoute un champ 'sens du document (entrant/sortant)'. Un courrier ou une offre émis par EPC2I sont d'origine interne : on ne sait pas s'ils relèvent du DE ou du DI.
- **Suite** : **Résolu en partie** par D-08 : un document émis par EPC2I est d'origine interne. Le champ « sens » n'est pas repris et l'utilisateur ne s'est pas prononcé (voir G43).

#### C12 — Doublons entre niveau 2 et niveau 4 (slides 13, 18)

- **Constat** : La slide 18 rend 'département' et 'niveau de confidentialité' obligatoires pour les DI, alors que la slide 13 les impose déjà à tous les documents. 'Organisme source', déjà conditionnel en slide 13, est redemandé en slide 18. 'Auteur – organisme émetteur' (slide 13) fait aussi doublon avec 'Organisme source' pour les DE.
- **Suite** : **Résolu dans le modèle v2** : les champs ne sont pas dupliqués (`docs/modele-cible.md` §7).

#### C13 — Circuit prédéfini ou autorité d'approbation saisie (slides 8, 9, 18)

- **Constat** : Le circuit est 'prédéfini en fonction du type' (slides 8-9), mais la slide 18 demande de saisir une 'autorité d'approbation' pour chaque document interne. On ne sait pas laquelle des deux règles s'applique.
- **Suite** : **Tranché** (D-15) : pas d'autorité d'approbation, circuit par type.

#### C14 — Catégories DP et champ Phase projet (slides 16, 18)

- **Constat** : Les catégories DP (Gouvernance, Planification, Ingénierie, Achats, Exécution & Chantier, Handover & Clôture) ressemblent à des phases. La slide 18 impose pourtant un champ 'Phase projet' distinct, ce qui permet des combinaisons incohérentes, par exemple la catégorie 'Handover & Clôture' en phase 'Exécution'.
- **Suite** : **Résolu en partie** : la phase reprend les étapes de Keystone, distinctes des familles ; des combinaisons incohérentes restent possibles (texte libre).

#### C15 — Périmètre : tous les documents ou documents contrôlés (slides 2, 11, 12)

- **Constat** : La slide 2 parle de 'tous les documents' et la slide 11 de 'n'importe quel document' (projets, R&D, commercial, RH, Com'). La slide 12 limite le type parent aux 'documents contrôlés'. Il faut trancher si les factures, e-mails, jeux de données bruts ou supports de communication suivent tous le même cycle maîtrisé.
- **Suite** : **Ouvert.** En pratique, trois types sans circuit (LET, RFQ, PHO) sont approuvés dès la demande ; c'est un choix de l'assistant.

#### C16 — Interface unique, mais liens vers SharePoint (slides 5, 9, 10)

- **Constat** : Les slides 5 et 10 promettent une interface unique, 'sans qu'ils ne puissent se perdre dans la BDD'. La slide 9 prévoit pourtant des 'liens vers la bibliothèque SharePoint' pour ouvrir les documents. Une fois dans SharePoint, l'utilisateur peut déposer, renommer ou déplacer des fichiers sans passer par l'application ni par ses contrôles.
- **Suite** : **Tranché** (D-06) : on ouvre les documents dans Codex. L'accès direct à la bibliothèque SharePoint reste une question ouverte (O-01).

### 7.3 Manques (23)

#### M01 — Gouvernance et RACI

- **Pourquoi** : Le deck ne nomme aucun rôle : responsable GED, gestionnaire documentaire par site ou département, administrateur de la taxonomie, comité de modification. Sans répartition des rôles, ni les circuits ni les ECR ne peuvent être paramétrés. Codex a six rôles et une matrice de droits qui restent à valider.
- **Question** : Qui porte la GED (sponsor, responsable records management) ? Y a-t-il un correspondant GED par site ou département ? Pouvez-vous fournir un RACI par activité : créer, vérifier, approuver, publier, demander une modification, rendre obsolète, archiver, détruire, administrer la taxonomie et les droits ?
- **Suite** : **Ouvert.** Les circuits reposent sur des fonctions et leurs titulaires (Administration › Fonctions & circuits), mais aucun RACI n'a été fourni (O-06).

#### M02 — Distinction entre document maîtrisé et enregistrement

- **Pourquoi** : Le deck applique le même cycle (Brouillon → … → Obsolète, ECR/ECO) aux procédures et aux preuves : factures, PV, rapports d'incident, cahiers de laboratoire, jeux de données bruts, registres. Une preuve se fige et ne se révise pas. Les registres tenus en continu (registre des explosifs, journal de maintenance) demandent en plus une clôture périodique.
- **Question** : Quels types sont des documents maîtrisés (révisables par ECR) et lesquels sont des enregistrements à figer dès leur dépôt ? Comment gérez-vous les registres tenus en continu (clôture mensuelle ou trimestrielle, figeage, horodatage) ?
- **Suite** : **Ouvert.**

#### M03 — Sort final, destruction et gel juridique

- **Pourquoi** : La slide 3 vise la conformité légale, et la slide 6 prévoit de supprimer les anciennes arborescences. Aucun processus de fin de conservation n'est décrit : proposition de destruction, validation, preuve de destruction, archivage définitif, gel pour litige ou contrôle.
- **Question** : À l'échéance de conservation, qui valide la destruction ou l'archivage définitif, et quelle trace conserve-t-on (procès-verbal de destruction) ? Faut-il un gel juridique qui bloque toute destruction, comme celui qu'a Codex ? Les anciennes arborescences seront-elles purgées selon les mêmes règles ?
- **Suite** : **Ouvert** pour la destruction, qui n'est pas exécutée. Le gel juridique existe et se lève, avec trace dans le journal (`holdDocuments`, `releaseHold`, `src/lib/actions.ts`).

#### M04 — Signature électronique

- **Pourquoi** : Contrats (DE Accord), certificats de réception (DP), approbations de politiques : aucune signature n'est prévue. Codex simule un circuit 'signature électronique' sans outil réel.
- **Question** : Quels types exigent une signature électronique, et de quel niveau eIDAS (simple, avancée, qualifiée) ? Avec quel outil (Yousign, DocuSign, Adobe Sign…) ? Une approbation dans un circuit vaut-elle signature pour les autres types ?
- **Suite** : **Ouvert.** Aucune signature électronique ; le champ `sign` des étapes n'est jamais activé.

#### M05 — Piste d'audit

- **Pourquoi** : La traçabilité est un objectif (slide 3) mais n'est pas spécifiée. Les audits ISO et les inspections ICPE ou pyrotechniques demandent de prouver qui a consulté, modifié ou approuvé quoi.
- **Question** : Quels événements faut-il tracer (consultation, téléchargement, modification de métadonnées, décisions, changement de droits) ? Combien de temps garde-t-on ce journal ? Qui peut le consulter ? Faut-il un export pour les auditeurs ?
- **Suite** : **Ouvert** : journal partiel, voir G48. L'export du journal est réservé à l'administration.

#### M06 — Diffusion et prise de connaissance

- **Pourquoi** : Une fois une procédure approuvée, rien ne dit qui en est informé, si une lecture attestée est requise (lien avec la matrice de compétences), ni comment on maîtrise les copies imprimées sur chantier ou en dépôt.
- **Question** : À la publication, qui est notifié ? Faut-il un accusé de lecture obligatoire pour certains types ? Les impressions doivent-elles porter la mention « copie non maîtrisée » ? Faut-il une liste de diffusion par document ?
- **Suite** : **Ouvert.**

#### M07 — Partage avec l'extérieur

- **Pourquoi** : Clients, fournisseurs, consortiums de recherche et autorités échangent des documents (bordereau de transmission en DE, livrables de consortium en DR). Power Pages figure sur la slide 4 sans explication.
- **Question** : Des tiers accèdent-ils à la GED (portail Power Pages, liens invités) ou échange-t-on seulement des fichiers ? Faut-il un registre des transmissions indiquant qui a reçu quelle révision, et un accusé de réception ?
- **Suite** : **Ouvert.** Le niveau Restreint désigne la diffusion à un client ou partenaire désigné (D-13), sans mécanisme de partage.

#### M08 — Capture des e-mails

- **Pourquoi** : Le sous-type 'email formalisé' (DE Correspondance) suppose une méthode de capture, que le deck ne décrit pas.
- **Question** : Comment un e-mail entre-t-il dans la GED : complément Outlook, glisser-déposer d'un .msg ou .eml, conversion PDF ? Les pièces jointes sont-elles classées séparément ? L'expéditeur et la date de réception doivent-ils être extraits automatiquement ?
- **Suite** : **Ouvert.**

#### M09 — Numérisation, OCR et valeur probante

- **Pourquoi** : La slide 2 cite la capture et la numérisation, et beaucoup de preuves papier existent (PV signés, bons de livraison, registres). Rien n'est prévu pour l'OCR ni pour la valeur probante des copies (norme NF Z42-026).
- **Question** : Qui numérise, avec quel matériel, et avec quel OCR ? Les originaux papier sont-ils détruits après numérisation, et si oui pour quels types, sous quelle norme de copie fiable ?
- **Suite** : **Ouvert.**

#### M10 — Recherche dans le contenu

- **Pourquoi** : La slide 2 résume la GED à des 'filtres optimisés pour la recherche'. On ne sait pas si la recherche porte seulement sur les métadonnées ou aussi sur le texte des fichiers, y compris les PDF scannés.
- **Question** : La recherche doit-elle couvrir le contenu des fichiers, scans compris, ou seulement les métadonnées ? Doit-elle fonctionner en plusieurs langues ? Les résultats doivent-ils être filtrés selon les droits et la confidentialité de l'utilisateur ?
- **Suite** : **Ouvert** pour le contenu des fichiers. Le filtrage des résultats selon les droits est fait (G15).

#### M11 — Liens entre documents

- **Pourquoi** : Les statuts 'Remplacé' et l'ECR/ECO supposent des relations : remplacé par, référence, formulaire lié à une procédure, documents impactés. Le modèle de métadonnées n'en prévoit aucune.
- **Question** : Quelles relations faut-il gérer : remplace / remplacé par, référence, annexe, enregistrement issu d'une procédure, document impacté par une ECR ? Doivent-elles être obligatoires pour certains statuts ?
- **Suite** : **Ouvert.** Le lien « remplacé par » proposé par l'assistant le 7 octobre à 17:33 n'est pas implémenté.

#### M12 — Formats et rendus

- **Pourquoi** : Rien ne dit s'il faut publier en PDF/A, conserver le fichier natif, ajouter un filigrane 'Brouillon', ni quels formats sont admis (plans CAO, jeux de données volumineux en DR, vidéos).
- **Question** : Une version approuvée est-elle publiée en PDF/A, à côté du fichier natif ? Quels formats sont acceptés ou refusés, et avec quelle taille maximale ? Les en-têtes et pieds de page (ID, révision, statut) sont-ils générés automatiquement ?
- **Suite** : **Ouvert.**

#### M13 — Indicateurs et pilotage

- **Pourquoi** : Power BI figure sur la slide 4, mais aucun indicateur n'est défini pour piloter la GED ni le projet de déploiement.
- **Question** : Quels indicateurs voulez-vous suivre : délais de validation, documents en retard de revue, documents expirés, circuits bloqués, avancement de la migration, complétude des métadonnées, adoption par site ? Pour qui, et à quelle fréquence ?
- **Suite** : **Ouvert.** L'accueil n'affiche que trois compteurs (à valider, échéances, mises en vigueur de la semaine).

#### M14 — Formation et conduite du changement

- **Pourquoi** : Le deck s'arrête aux outils. Il ne prévoit ni pilote, ni utilisateurs clés, ni formation, ni communication, ni gel des anciens dossiers et des stockages personnels.
- **Question** : Prévoyez-vous un site ou un département pilote ? Faut-il un utilisateur clé par département ? Quels supports de formation ? À partir de quand interdira-t-on le dépôt hors GED (dossiers partagés, Teams, postes personnels) ?
- **Suite** : **Ouvert.**

#### M15 — Lien avec Keystone (projets)

- **Pourquoi** : Les DP exigent un code projet et une phase (slide 18), alors que le groupe gère ses affaires dans Keystone. Codex lit déjà des affaires simulées (code AFF-…, étape, pièces attendues), mais le deck n'évoque pas cette intégration.
- **Question** : Le 'Code projet' est-il le code d'affaire Keystone ? La 'Phase projet' reprend-elle les étapes Keystone (devis, commande, réalisation, clôture) ? Qui est la source de référence pour chaque donnée ? Faut-il créer automatiquement l'espace documentaire à la création d'une affaire ? Les pièces attendues par étape sont-elles définies dans Keystone ? La clôture d'une affaire déclenche-t-elle l'archivage et le décompte de conservation ?
- **Suite** : **Répondu en partie**, par des choix de conception : le code projet est le code Keystone (ex. `HLT-026`), la phase reprend les étapes Keystone, Keystone lit le registre (`GET /api/registry`) et définit les pièces attendues (simulées). Intégration réelle non faite (O-03, T-01) ; la fin de projet n'est pas calculable comme déclencheur de conservation.

#### M16 — Identités, authentification et droits techniques

- **Pourquoi** : Codex n'a pas encore d'authentification, et le deck ne dit pas comment les rôles et les restrictions sont portés techniquement.
- **Question** : Les utilisateurs se connectent-ils via Entra ID (SSO Microsoft) ? Les rôles et périmètres (site, département) sont-ils alimentés par des groupes de l'annuaire ? Comment traite-t-on les départs, les intérimaires et les comptes invités ?
- **Suite** : **Proposé, non confirmé** : Entra ID (`docs/modele-cible.md` §1 : « simulée jusqu'au branchement Entra ID »). Groupes, départs et invités : ouverts (O-02).

#### M17 — Données personnelles (RGPD)

- **Pourquoi** : Les DI RH contiennent des données personnelles : fiches de poste, matrices de compétences, feuilles de présence, habilitations. Le groupe opère en France, au Royaume-Uni et au Maroc, donc sous plusieurs lois (RGPD, UK GDPR, loi marocaine 09-08).
- **Question** : Quels types contiennent des données personnelles ? Quelles durées maximales et restrictions d'accès s'appliquent ? Le DPO doit-il valider le référentiel de conservation ?
- **Suite** : **Ouvert.** La question citait France, Royaume-Uni et Maroc, qui viennent des données fictives de la maquette (voir P03).

#### M18 — Volumétrie et limites techniques

- **Pourquoi** : Une bibliothèque SharePoint unique avec des restrictions document par document atteint vite ses limites : seuil d'affichage de 5 000 éléments, nombre de permissions uniques, délégation dans Power Apps. Les jeux de données de R&D peuvent aussi être volumineux. Ces chiffres orientent l'architecture.
- **Question** : Combien de documents existent aujourd'hui et quelle croissance annuelle prévoyez-vous ? Quelle taille maximale de fichier ? Combien d'utilisateurs, et répartis sur combien de sites ?
- **Suite** : **Ouvert** (O-11 pour les volumes à migrer).

#### M19 — Échéances et relances

- **Pourquoi** : Les dates de révision et d'expiration (slide 13), ainsi que les permis et certificats (DE), n'ont de valeur que si elles déclenchent des alertes, que le deck ne prévoit pas.
- **Question** : Qui doit être alerté, et combien de temps avant l'échéance ou l'expiration ? Faut-il une escalade au manager quand une étape de circuit est en retard ?
- **Suite** : **Répondu en partie** : échéances de conservation, d'expiration et de revue dans l'application (`deadlines`, `src/lib/queries.ts`). Ni notification ni escalade.

#### M20 — Couverture métier de la taxonomie

- **Pourquoi** : La slide 11 cite le commercial et la communication, mais les DI n'ont ni catégorie Commercial pour les documents émis (devis, offres), ni catégorie Communication, ni catégorie Juridique corporate (statuts, PV d'assemblée). Les documents métier déjà présents dans Codex (FDS, registre des explosifs, plan et instruction de tir, plan de prévention, habilitation CPT, autorisation préfectorale ICPE) n'ont pas de place évidente dans les slides 14 à 17. Le vocabulaire DP (PID, RAID log, ITP, as-built) évoque de grands projets EPC plus que des campagnes de tir.
- **Question** : Pouvez-vous indiquer, pour chaque type documentaire actuel, sa place dans les quatre domaines (catégorie, type, sous-type) ? Faut-il ajouter des catégories Commercial, Communication, Juridique corporate et HSE pyrotechnie ? La taxonomie DP correspond-elle bien à vos affaires réelles ?
- **Suite** : **Répondu en partie** : registre fusionné de 69 types (types Keystone ajoutés) et données de démonstration alignées sur Keystone ; les documents de la maquette (explosifs) ont disparu. Il n'existe pas de type « communication » alors que c'est l'exemple de l'utilisateur pour le niveau Public (O-08). Catégories manquantes et doublons : `docs/registre-points-ouverts.md`.

#### M21 — Plan projet du déploiement

- **Pourquoi** : Les slides 6 à 9 listent des étapes sans calendrier, responsables, charge ni critères de fin. Rien ne dit quand un lot est considéré comme livré.
- **Question** : Quel calendrier visez-vous, avec quels jalons et quels responsables par chantier (taxonomie, bibliothèque, flux, application, migration) ? Quels critères permettent de dire qu'une vague de migration ou un flux est terminé ?
- **Suite** : **Ouvert.**

#### M22 — Continuité, sauvegarde et réversibilité

- **Pourquoi** : Une GED devient un actif critique, mais l'hébergement, les sauvegardes, le plan de reprise et la possibilité d'exporter toutes les données ne sont pas abordés.
- **Question** : Quelles exigences fixez-vous en délai de reprise et en perte de données tolérée ? Où les données doivent-elles être hébergées ? Faut-il pouvoir exporter l'ensemble des documents avec leurs métadonnées et leur historique, en cas de changement d'outil ou de contrôle ?
- **Suite** : **Ouvert.**

#### M23 — Accès terrain et mobile

- **Pourquoi** : Les DP 'Exécution & Chantier' et les documents de dépôt (instructions de tir, plans de prévention) sont consultés sur site, parfois sans réseau.
- **Question** : Faut-il un accès sur tablette ou smartphone en chantier et en dépôt ? Une consultation hors ligne des documents en vigueur est-elle nécessaire ? Peut-on déposer depuis le terrain (photo d'un PV signé, par exemple) ?
- **Suite** : **Ouvert.**

### 7.4 Points oubliés par les cinq analyses (12)

Relevés par le critique de complétude.

**P01.** Aucune des cinq analyses ne compare le deck au modèle documentaire que la spec Keystone a déjà écrit pour Codex (`docs/spec/10-site-docs-mywork-settings.md` du dépôt Keystone, §4 et §5). Ce modèle contient un « Registre des types de documents (Codex) » de 28 types codés (PID, PFD, SCH, GA, LST, BOM, FDS, VAR, HMI, RPT, MAN, PRO, FRM, REC, NCR, AUD, RFQ, PO, CER, COC, PER, PV, HSE, CTR, LET, MIN, PHO, VIS) répartis en 7 familles. Pour chaque type, il fixe un circuit par rôle, une règle de rétention, une clause ISO 9001 et un indicateur « livrable client ». Il prévoit 5 statuts (Brouillon, Gelé, Diffusion proposée, Diffusé, Obsolète), des révisions en lettres avec des versions de travail A.1, A.2, et le retrait automatique de la révision précédente en « Obsolète ». Il précise que ce registre appartient à Codex. Il existe donc trois modèles concurrents (deck, Codex actuel, spec Keystone). L'analyse d'architecture ne cite que la numérotation TYPE-PROJ-SEQ.

- **Suite** : **Traité** : fusion du deck et du registre Keystone en un registre unique dans Codex (D-07, `src/db/registry.ts`). Les statuts Keystone (Gelé, Diffusion proposée, Diffusé) n'ont pas été repris ; la révision précédente passe « Remplacé » et non « Obsolète » (D-11, proposé, non confirmé).

**P02.** La spec Keystone se contredit elle-même sur la numérotation : TYPE-PROJ-SEQ dans 00-overview.md (l.455 et 710, ex. PID-HLT-026), mais TYPE-CLIENT-SEQ dans le registre (10 §5.3), avec « QMS » comme code pour les documents hors projet. L'analyse d'écart affirme que le format &lt;affaire>-DOC-### de Codex est « cohérent avec Keystone » : c'est faux.

- **Suite** : **Tranché pour Codex** : `TYPE-CONTEXTE-SEQ` avec le code projet complet (ex. `PID-HLT-026-001`) ; le code projet complet est proposé, non confirmé (D-09). La spec Keystone reste à corriger, dans le dépôt Keystone.

**P03.** Les analyses prennent la fiction de démonstration pour la réalité d'EPC2I. Les données de Codex parlent de carrières et de minage : carrière de Montcel, plan de tir, sites Lyon, Cugny, dépôts, UK et Maroc (src/db/seed-data.ts). Keystone décrit une autre activité : ponts roulants et automatismes, atelier à Lyon, magasins au Havre et à Marseille, projets en Europe et Amérique du Nord, Afrique et Asie-Pacifique, P&ID, automates, essais FAT et SAT (00-overview.md l.39). Plusieurs propositions reposent sur cette fiction : les questions de la critique (RGPD France/UK/Maroc, ICPE et pyrotechnie, instructions de tir, catégorie « HSE pyrotechnie »), le reclassement des 30 documents de démo dans l'analyse d'écart, et l'« utilisatrice HSE » de l'analyse d'architecture. Des sigles entrent aussi en collision : FDS veut dire fiche de données de sécurité dans Codex mais spécification fonctionnelle dans Keystone ; PID veut dire Project Initiation Document dans le deck (slide 16) mais P&ID dans Keystone.

- **Suite** : **Traité en partie** : personnes et projets de démonstration alignés sur Keystone (`src/db/seed-org.ts`) ; organisation provisoire en attendant l'organigramme (D-19). FDS désigne la spécification fonctionnelle et les fiches de données de sécurité sont un sous-type de DTF ; le code PID désigne le P&ID, le sous-type de DEF s'appelle « PID (document d'initialisation de projet) » (`src/db/registry.ts`, `docs/registre-points-ouverts.md`).

**P04.** Aucune analyse ne trace la frontière avec les autres applications du Système EPC2i. La taxonomie du deck reprend des documents que d'autres outils produisent déjà : fiches de NC, rapports d'audit, plans CAPA, analyses de risques et rapports d'incident (DI QHSE) recoupent Vigie (événements, plan d'actions, DUERP, audits). La catégorie DE Règlementation recoupe la veille réglementaire de Vigie. Matrice de compétences, supports de formation et feuilles de présence (DI RH et Formation) recoupent Cursus. Journal de décisions, RAID, reporting, ordre de changement, punch list et ITP (DP) recoupent Keystone. Les plans (DP) recoupent SolidWorks PDM, et les bons de commande et factures (DE) recoupent Sage X3. Aucune analyse ne demande quel système fait foi. Vigie a d'ailleurs un écran /documents laissé hors périmètre.

- **Suite** : **Traité en partie** : les ECR/ECO vont dans Vigie (D-16). Les frontières avec Cursus, Sage X3, SolidWorks PDM et les modules qualité de Vigie restent ouvertes.

**P05.** Le sigle ECO a trois sens qui ne sont jamais rapprochés : le « principe ECR/ECO » du deck pour modifier un document, le sous-type DP « ordre de changement » (avenant contractuel), et le module ECO de Keystone (09-engineering-plm.md : modifications de pièces et de machines, analyse d'impact, dispositions, interchangeabilité), qui vient s'ajouter à ses ChangeRequest. Seule l'analyse d'architecture mentionne le module ECO de Keystone. Les exigences, l'analyse d'écart et la critique définissent l'ECR/ECO sans cette frontière.

- **Suite** : **Tranché** (D-16) : ECR/ECO centralisés dans Vigie, qu'ils portent sur un projet ou un document. Faire pointer vers Vigie le module ECO de Keystone et sa spec est proposé, non confirmé (O-10).

**P06.** Les doublons, problème cité en slide 3, ne donnent lieu à aucune exigence ni adaptation. Aucune analyse ne propose de détecter les doublons au dépôt ou à la migration (par empreinte de fichier), et Codex n'a aucun calcul d'empreinte dans src/lib.

- **Suite** : **Ouvert** : aucune détection de doublons (aucune empreinte de fichier). L'import ne détecte que le rejeu d'une même référence d'origine (`src/lib/importer.ts`).

**P07.** L'enjeu ISO 9001 n'est pas soulevé. Les « documents contrôlés » de la slide 12 correspondent à la maîtrise des informations documentées (§7.5 de la norme). Le registre Keystone associe chaque type à une clause ISO et présente le journal d'audit comme servant aux audits ISO 9001. Personne ne demande si EPC2I est certifié, ce qui fixerait d'office plusieurs exigences : approbation, diffusion, identification des révisions, prévention de l'usage de documents périmés.

- **Suite** : **Ouvert** : chaque type porte une clause ISO dans le registre, mais la certification d'EPC2I n'a pas été demandée.

**P08.** Diffusion, accusé de réception et partage client : la spec Keystone attend déjà de Codex une liste de diffusion, une preuve d'approbation, un journal de téléchargements et un accusé de réception client via le portail client Keystone (M14). La critique propose Power Pages pour le partage externe sans citer ce portail, et l'analyse d'écart ne traite pas du tout la diffusion.

- **Suite** : **Ouvert.**

**P09.** Lecture des slides 6 à 9 : chaque slide porte le logo d'un outil (6 SharePoint, 7 bibliothèque, 8 Power Automate, 9 à 11 Power Apps), ce qui suggère quatre chantiers découpés par outil plutôt qu'un plan unique. La critique y voit une contradiction d'ordre ; les exigences (MIG-08) fusionnent les étapes en une seule séquence. Aucune analyse ne relève non plus le « … » de la slide 7, qui laisse la liste des réglages de la bibliothèque ouverte.

- **Suite** : **Sans objet** après D-06.

**P10.** La slide 2 cite des opérations de GED (capture, acquisition, numérisation, diffusion, indexation) et la slide 3 la collaboration. Elles n'entrent ni dans les exigences ni dans l'analyse d'écart. Seules la critique (OCR, diffusion) et l'architecture (coédition Office) y touchent. Il reste à trancher s'il s'agit d'engagements ou d'une simple définition générique. Codex ne propose pas de coédition.

- **Suite** : **Ouvert.** Codex n'offre pas de coédition.

**P11.** Côté intégration Keystone : keystoneUrl de Codex construit /affaires/{code} (`src/lib/keystone.ts` de la v1, l.11-14), alors que Keystone utilise /projects/[code]. Codex emploie des codes AFF-2026-0142, Keystone des codes HLT-026. Plusieurs questions encore ouvertes dans la spec Keystone dépendent directement de la décision sur le deck : D-1 (contrat de dépôt, numérotation), D-2 (comportement du coffre), I-3 (« Is SharePoint a document target? ») et P-7 (approbations faites dans Keystone ou dans Codex). Aucune analyse ne fait le lien.

- **Suite** : **Corrigé dans le code** : `keystoneUrl` construit `/projects/{code}` (`src/lib/keystone.ts`) et les codes projet sont ceux de Keystone (`HLT-026`). Les questions D-1, I-3 et P-7 de la spec Keystone (sa propre numérotation, sans rapport avec les D-xx de `docs/decisions.md`) ont leur réponse côté Codex : numérotation (D-09, D-10), SharePoint seulement comme stockage de fichiers et approbations dans Codex (D-06). Elle reste à reporter dans la spec Keystone.

**P12.** La slide 18 rend la « date de réception » obligatoire pour tout document externe, alors que le même champ « sens » admet des documents sortants, qui n'ont pas de date de réception. Le contrôle des métadonnées l'a vu, mais la critique ne pose pas la question, et l'analyse d'écart rend les 4 champs DE obligatoires sans condition.

- **Suite** : **Ouvert** (voir G43) : la date de réception est facultative dans Codex et le champ « sens » n'existe pas.

### 7.5 Conflits entre les analyses (14)

**K01.** Couverture surestimée : l'analyse d'écart déclare « couverts » le versioning, la recherche, les validations et la traçabilité, alors que la vérification les ramène tous les quatre à « partiel ». Elle classe aussi « Version / Révision » en couvert, alors que la vérification montre que bump() ne lit que le format x.y : un indice « Rév. C » repart à 0. Or Keystone impose justement des révisions en lettres.

- **Suite** : **Pris en compte** : le tableau du §5 donne les statuts vérifiés.

**K02.** Les lettres d'options ne désignent pas les mêmes choses. L'option A « hybride » de l'analyse d'écart correspond à l'option B de l'architecture, son option B (Codex autonome) à l'option D, et son option C (100 % Power Platform) à l'option A. Présentées telles quelles à l'utilisateur, ces options seront confondues.

- **Suite** : **Pris en compte** : seules les options A à E de l'analyse d'architecture sont reprises (§6.4).

**K03.** Numérotation : l'analyse d'écart juge le format &lt;affaire>-DOC-### « cohérent avec Keystone ». L'architecture cite TYPE-PROJ-SEQ, la vérification relève que les vrais codes Keystone ressemblent à HLT-026, et la spec Keystone indique tantôt TYPE-PROJ-SEQ, tantôt TYPE-CLIENT-SEQ.

- **Suite** : **Sans objet** : numérotation tranchée (D-09, D-10).

**K04.** Phase projet : chaque analyse propose une source différente. Les métadonnées l'alignent sur les catégories DP. L'analyse d'écart et la critique partent des 4 étapes simulées dans Codex (devis, commande, réalisation, clôture). La vérification cite le cycle Keystone réel en 12 étapes (plus Annulé). La critique y voit en plus un doublon avec les catégories DP.

- **Suite** : **Tranché dans le code** : étapes de Keystone (`PROJECT_PHASES`, `src/lib/i18n.ts`), choix de l'assistant.

**K05.** Confidentialité : l'analyse d'écart dit que l'ordre des niveaux n'est « défini nulle part », alors que la vérification montre un ordre implicite dans Codex (public &lt; interne &lt; restreint &lt; confidentiel) et que la critique lit l'ordre du deck comme l'inverse de l'usage français. Sur le niveau « Public », les exigences (MET-09) et l'analyse d'écart le suppriment et reclassent les documents concernés, alors que la critique rappelle qu'il existe des documents publics (lois, normes, publications) et que l'architecture pose la question.

- **Suite** : **Tranché** (D-13).

**K06.** Domaine : les métadonnées en font le discriminant exclusif, et l'analyse d'écart le rend immuable en déduisant DP de la présence d'un affaireCode. La critique objecte que l'origine (interne/externe) et le contexte (projet/recherche) sont deux axes, et la vérification que le domaine doit rester indépendant de l'affaire. Le coffre Keystone range d'ailleurs des certificats matière, certificats de conformité, commandes et contrats dans le périmètre projet. Or, avec les champs de niveau 4, un document DE ne peut pas porter de code projet.

- **Suite** : **Tranché** (D-08).

**K07.** Statuts : l'analyse d'écart assimile « En révision » au statut review de Codex, que la vérification dit libellé « En validation » et que la critique juge ambigu. Le passage d'Approuvé à En vigueur à la date d'effet est posé comme une règle par les exigences (WFL-07), les métadonnées et l'analyse d'écart, mais seulement comme une question par la critique. Aucune analyse ne voit que le deck nomme « Remplacé » la révision supplantée, quand Keystone la passe automatiquement en « Obsolète ».

- **Suite** : **Tranché dans le modèle** (`docs/modele-cible.md` §4), non confirmé point par point (D-11).

**K08.** Statut par version : l'analyse d'écart propose de porter le statut sur chaque version, ce qui ne tient pas avec l'option B recommandée par l'architecture, où SharePoint reste la source de vérité. Dans SharePoint, les métadonnées sont portées par l'élément, pas par chaque version. La critique ajoute que « Remplacé » suppose un nouvel ID. Personne ne concilie ces points.

- **Suite** : **Sans objet** : Codex porte les métadonnées, et un statut par révision (D-06).

**K09.** L'option B de l'architecture se contredit : Graph y agit avec des jetons délégués, donc avec les droits de l'utilisateur, mais le statut et l'ID ne devraient être écrits que par l'identité de l'application. Avec des droits délégués en écriture, l'utilisateur peut modifier ces colonnes directement dans SharePoint.

- **Suite** : **Sans objet** : SharePoint n'est plus qu'un stockage de fichiers piloté par Codex avec l'identité de l'application (`src/lib/storage.ts`).

**K10.** Accès par l'application unique : l'analyse d'écart le déclare couvert, mais l'architecture prévoit « Ouvrir dans SharePoint » (option B) et reconnaît que l'option E contredit la slide 10. La critique voit une contradiction entre l'interface unique et les liens vers SharePoint.

- **Suite** : **Tranché** (D-06) : tout passe par Codex ; accès direct à la bibliothèque : O-01.

**K11.** Date de réception (DE) : selon les métadonnées, elle ne serait obligatoire que pour les documents entrants ; selon le contrôle, la slide 18 la rend obligatoire pour tous ; l'analyse d'écart la rend obligatoire pour tous les DE sans discuter le cas des documents sortants.

- **Suite** : **Ouvert** (voir G43).

**K12.** ID document : l'analyse d'écart le déclare « couvert » parce qu'il est immuable. Pourtant la critique juge son format indéfini et contradictoire (immuable mais construit selon le type), et le contrôle des métadonnées rappelle qu'on confond codification du nom et ID.

- **Suite** : **Tranché** (D-09, D-10).

**K13.** Power BI, Power Pages et Power Virtual Agents : les exigences (ARC-02) les excluent du périmètre, la critique demande leur rôle et les envisage pour le partage externe et les indicateurs, et l'architecture n'en parle pas.

- **Suite** : **Sans objet** après D-06 : non discuté, hors périmètre.

**K14.** Les estimations d'effort divergent : l'analyse d'écart classe le choix de la pile Microsoft en effort « important », tandis que l'architecture estime l'option A à « Moyen (M) ». Pour le versioning et la traçabilité, l'analyse d'écart dit « faible », la vérification « moyen ».

- **Suite** : **Sans objet.**

### 7.6 Les 12 questions prioritaires

Le critique de complétude a resserré l'ensemble en 12 questions. Les 10 questions posées à l'utilisateur à 12:40
(§2) en sont une version condensée.

**Q01.** Socle technique : la bibliothèque SharePoint unique reste-t-elle le coffre-fort et la source de vérité des fichiers et des métadonnées, Codex devenant l'application « GED EPC2I » à la place de Power Apps ? Ou bien Codex remplace-t-il SharePoint ? Et les workflows tournent-ils dans Codex ou dans Power Automate ? Tout en dépend : schéma, stockage, authentification et intégration Keystone. La spec Keystone suppose aujourd'hui que Codex possède les fichiers, la numérotation, les circuits et la rétention.

- **Suite** : **Répondu** (D-06).

**Q02.** Quel modèle documentaire fait foi ? Celui du deck (4 domaines, 45 types sans code, 7 statuts), ou le registre des types déjà spécifié côté Keystone pour Codex (28 types codés comme PRO, NCR, CER ou PID, avec circuit, rétention et clause ISO 9001 par type, statuts Brouillon / Gelé / Diffusion proposée / Diffusé / Obsolète, révisions A, B, C) ? Faut-il les fusionner en un registre unique, et qui l'administre : la banque de termes SharePoint ou Codex ?

- **Suite** : **Répondu** (D-07) : un registre unique, géré dans Codex, « pour le moment ». Les statuts de la spec Keystone ne sont pas repris.

**Q03.** Le domaine (DI, DE, DP, DR) est-il exclusif, avec un seul type de contenu par document ? Par exemple, un certificat matière fournisseur ou un contrat client d'une affaire est-il DE ou DP, et doit-il porter le code projet ? Ou préférez-vous deux axes indépendants : l'origine (interne / externe) et le rattachement (projet, programme de recherche) ?

- **Suite** : **Répondu** (D-08) : deux axes, origine et rattachement.

**Q04.** Quel est le format exact de l'ID ? Il faut fixer les segments (code type, projet ou « QMS », année, séquence), la portée du compteur, le moment d'attribution (dès le brouillon ou à l'approbation), le sort de l'ID en cas de reclassement et son lien avec le nom de fichier. Doit-il s'aligner sur TYPE-PROJ-SEQ (ex. PID-HLT-026) attendu par Keystone ? Faut-il créer un code pour chacun des 45 types du deck ?

- **Suite** : **Répondu** (D-09, D-10). Les codes donnés aux types du deck (POL, GOV, RSQ, DTF, PRT…) sont un choix de l'assistant (O-05).

**Q05.** Comment fonctionnent le cycle de vie et les révisions ? Une révision est-elle une nouvelle version du même document (même ID) ou un nouvel enregistrement ? À l'approbation d'une révision, la précédente passe-t-elle « Remplacé » (deck) ou « Obsolète » (Keystone) ? Les indices sont-ils en lettres (A, B, C) ou en x.y ? Le passage d'Approuvé à En vigueur se fait-il automatiquement à la date d'effet ? « En révision » signifie-t-il « en validation » ou « en modification » ?

- **Suite** : **Répondu** (D-11, D-12). La mise en vigueur automatique à la date d'effet et le passage de la révision précédente à « Remplacé » sont proposés, non confirmés. « En révision » = circuit lancé (modèle).

**Q06.** Où passe la frontière avec les autres outils ? Pour les NC, audits, plans CAPA, analyses de risques et la veille réglementaire (Vigie), les supports de formation et feuilles de présence (Cursus), les comptes rendus, NCR, ordres de changement et punch lists (Keystone), les plans (SolidWorks PDM), les commandes et factures (Sage X3) : la GED est-elle le maître, garde-t-elle une copie figée, ou seulement un lien ?

- **Suite** : **Répondu en partie** : ECR/ECO dans Vigie (D-16). Le reste de la frontière est ouvert.

**Q07.** Confidentialité et accès : dans quel ordre se rangent les 4 niveaux (Restreint au-dessus ou en dessous de Très confidentiel) ? Faut-il un niveau Public pour les lois, normes et publications ? Qui voit un brouillon ? Dans une bibliothèque unique, par quel mécanisme appliquer ces restrictions : droits élément par élément, bibliothèque séparée pour le très confidentiel, ou étiquettes de sensibilité ?

- **Suite** : **Répondu** (D-13, D-14). Le mécanisme côté SharePoint est sans objet si les utilisateurs n'ont pas accès à la bibliothèque (O-01, non répondue).

**Q08.** Circuits de validation : pouvez-vous fournir la matrice type → circuit par rôle ? Le registre Keystone en propose déjà une, par exemple Auteur → Responsable qualité → Direction pour les procédures. L'« autorité d'approbation » saisie sur les documents internes (slide 18) remplace-t-elle ce circuit ou le complète-t-elle ? Les documents externes passent-ils eux aussi en validation ?

- **Suite** : **Répondu en partie** (D-15) : pas d'autorité d'approbation ; matrice type → circuit provisoire dans le registre (O-06).

**Q09.** ECR/ECO : la demande de modification d'un document est-elle un objet à part dans la GED ? Comment s'articule-t-elle avec le module ECO de Keystone (modifications de pièces et de machines) et avec le sous-type DP « ordre de changement » ? Qui accepte une demande de modification, et pour quels domaines ?

- **Suite** : **Répondu** (D-16, D-17, D-18). Étapes à définir dans Vigie (O-10).

**Q10.** Organisation réelle : les données de démo de Codex (carrières, minage, sites Lyon, Cugny, dépôts, UK, Maroc) sont fictives et ne correspondent pas à Keystone (atelier de Lyon, magasins du Havre et de Marseille, projets en Europe, Afrique et Asie). Quelles sont les vraies sociétés, les vrais sites et les vrais départements (valeurs de Département / Fonction) ? Faut-il un champ Société / Site, absent du deck ? EPC2I est-il certifié ISO 9001 ?

- **Suite** : **En attente** de l'organigramme (D-19, O-04). Site facultatif dans le modèle. Certification ISO 9001 : non demandée.

**Q11.** Classes de conservation : quelle est la liste, avec pour chacune la durée, l'événement de départ et le sort final ? La classe est-elle déduite du type, comme dans le registre Keystone (durée de vie de l'actif, 10 ans, remplacé + 3 ans, projet + 5 ans), ou choisie par l'utilisateur ? Est-elle gérée dans Codex ou par des étiquettes de rétention Purview ?

- **Suite** : **Répondu en partie** (D-20) : une règle par type, gérée dans Codex ; durées à confirmer (O-07).

**Q12.** Migration : quels volumes et quels emplacements sont concernés ? Faut-il dédoublonner (la slide 3 cite les doublons), garder l'historique et l'ancienne référence ? Quel statut et quel ID reçoit un document migré ? La migration doit-elle vraiment passer avant les workflows et l'application, comme le placent les slides 6 à 9 ?

- **Suite** : **Répondu en partie** (D-21) : outil séparé. Volumes, emplacements et dédoublonnage : ouverts (O-11).
