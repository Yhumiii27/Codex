# Transcription du deck « Création de la GED EPC2I »

> **Source faisant foi : `docs/sources/creation-ged-epc2i.pptx`.** Ce fichier en est une transcription texte, produite pour pouvoir lire le deck sans outil PowerPoint. En cas de doute, c’est le `.pptx` qui fait foi. Rien n’a été résumé ni reformulé.

## Fiche de transcription

| Élément | Valeur |
|---|---|
| Fichier source | `docs/sources/creation-ged-epc2i.pptx` |
| Dernière modification enregistrée dans le fichier | 2026-04-14T12:24:43Z |
| Transcription réalisée le | 2026-10-09 |
| Diapositives transcrites | 18 (le fichier en déclare 18, dont 0 masquée(s)) |
| Tableaux transcrits | 12 (le XML des diapositives en contient 12) |
| Images listées | 14 |
| Notes du présentateur | 0 diapositive(s) avec notes (le fichier en déclare 0) |
| SmartArt / diagrammes | 0 |
| Diapositives masquées | aucune |
| Contrôle d’exhaustivité | chaque fragment de texte du XML de chaque diapositive a été retrouvé dans la transcription |

### Méthode

- Extraction par script Python (bibliothèque standard : `zipfile` + `xml.etree`), directement depuis le XML du `.pptx`.
- Ordre des diapositives : celui de `ppt/presentation.xml` (liste `sldIdLst`).
- Ordre de lecture dans une diapositive : le titre d’abord, puis les formes de haut en bas et de gauche à droite (formes à moins de 0,4 cm d’écart vertical considérées sur la même ligne).
- Hiérarchie : les niveaux de paragraphe PowerPoint (`lvl`) et les retraits par tabulation deviennent des listes Markdown imbriquées. Quand le deck contient un tiret tapé après une tabulation (« - texte »), ce tiret devient la puce Markdown.
- Mise en forme non reproduite : gras, italique, couleurs, tailles et polices. Les espaces insécables sont rendus comme des espaces normaux ; les tabulations internes servant d’alignement visuel sont remplacées par un espace.
- Tableaux : rendus en tableaux Markdown ; la 1re ligne de chaque tableau (celle des intitulés de colonnes dans le deck) sert d’en-tête Markdown. Le texte de chaque cellule est repris tel quel, y compris les valeurs répétées d’une ligne à l’autre ; aucune cellule fusionnée dans ce deck. Sur les diapositives 13 à 17, deux tableaux sont posés côte à côte : celui de gauche est transcrit avant celui de droite.
- Orthographe et typographie du deck conservées telles quelles (y compris les coquilles).
- Images : signalées à leur place dans l’ordre de lecture, par leur nom de fichier interne (`ppt/media/…`). Le fichier ne contient aucun texte alternatif pour les images des diapositives ; l’identification des logos est une *note de transcription* ajoutée en ouvrant les fichiers image, signalée comme telle. Les connecteurs (flèches, liens) sont listés en fin de diapositive.
- Chaque bloc est précédé d’un commentaire HTML invisible (`<!-- … -->`) qui donne le nom de la forme PowerPoint d’origine.

### Éléments répétés par les masques (non transcrits diapositive par diapositive)

Ces éléments sont portés par les masques de diapositive du modèle « EPC 2018 » (formes hors espaces réservés) et sont donc hérités par les diapositives qui utilisent ces masques. Ils ne sont pas répétés dans chaque section ci-dessous.

- `ppt/slideMasters/slideMaster2.xml` (diapositive 1) : textes « LES SYSTÈMES D’AMORCAGE [numéro de diapositive] », « EPC France » ; images `ppt/media/image1.jpeg` (texte alternatif : « Blast.jpg »), `ppt/media/image2.png` (texte alternatif : « logo-epcgroupe-W.png »)
- `ppt/slideMasters/slideMaster3.xml` (diapositives 2 à 18) : textes « EPC France », « LES SYSTÈMES D’AMORCAGE [numéro de diapositive] » ; images `ppt/media/image2.png` (texte alternatif : « logo-epcgroupe-W.png »)

## Table des matières

1. [Diapositive 1 — Création de la GED EPC2I](#diapositive-1)
2. [Diapositive 2 — Pourquoi ? — Qu’est ce qu’une GED ?](#diapositive-2)
3. [Diapositive 3 — Pourquoi ? — Quel intérêt ?](#diapositive-3)
4. [Diapositive 4 — Comment ? — Via les outils Microsoft existants](#diapositive-4)
5. [Diapositive 5 — Comment ? — Via les outils Microsoft existants](#diapositive-5)
6. [Diapositive 6 — Les étapes ? — Les créations / modifications dans l’existant](#diapositive-6)
7. [Diapositive 7 — Les étapes ? — Les créations / modifications dans l’existant](#diapositive-7)
8. [Diapositive 8 — Les étapes ? — Les créations / modifications dans l’existant](#diapositive-8)
9. [Diapositive 9 — Les étapes ? — Les créations / modifications dans l’existant](#diapositive-9)
10. [Diapositive 10 — L’usage — L’accès](#diapositive-10)
11. [Diapositive 11 — L’usage — Les fonctions visibles par l’utilisateur](#diapositive-11)
12. [Diapositive 12 — Les métadonnées — Architecture de niveau 1 – La hiérachie](#diapositive-12) (1 tableau)
13. [Diapositive 13 — Les métadonnées — Architecture de niveau 2 – Le tronc commun](#diapositive-13) (2 tableaux)
14. [Diapositive 14 — Les métadonnées — Architecture de niveau 3 – La taxonomie des DI](#diapositive-14) (2 tableaux)
15. [Diapositive 15 — Les métadonnées — Architecture de niveau 3 – La taxonomie des DE](#diapositive-15) (2 tableaux)
16. [Diapositive 16 — Les métadonnées — Architecture de niveau 3 – La taxonomie des DP](#diapositive-16) (2 tableaux)
17. [Diapositive 17 — Les métadonnées — Architecture de niveau 3 – La taxonomie des DR](#diapositive-17) (2 tableaux)
18. [Diapositive 18 — Les métadonnées — Architecture de niveau 4 – Champs spécifiques](#diapositive-18) (1 tableau)

---

<a id="diapositive-1"></a>

## Diapositive 1 — Création de la GED EPC2I

<!-- titre : forme « Titre 1 » -->
**Titre :** Création de la GED EPC2I

<!-- texte : forme « Espace réservé du texte 2 » -->
Pourquoi?

Comment?

Les étapes

L’usage

Les métadonnées
- Niv 1 – La hiérarchie
- Niv 2 – Le tronc commun
- Niv 3 – La taxonomie par type
  - Doc Interne (DI)
  - Doc Externe (DE)
  - Doc Projet (DP)
  - Doc Recherche (DR)
- Niv 4 – Les Champs Spécifiques

**Notes du présentateur :** aucune.

---

<a id="diapositive-2"></a>

## Diapositive 2 — Pourquoi ?

<!-- titre : forme « Titre 2 » -->
**Titre :** Pourquoi ?

<!-- texte : forme « Espace réservé du contenu 1 » -->
Qu’est ce qu’une GED ?

<!-- texte : forme « ZoneTexte 4 » -->
Selon le Larousse®, un document est une « Pièce écrite ou objet servant d’information, de témoignage ou de preuve. »

La GED – ou Gestion Electronique des Documents – s’intéresse donc aux documents et aux données associées, et permet d’optimiser leur gestion et leur exploitation par des moyens électroniques spécialisés et performants.

La GED est un procédé faisant intervenir des moyens électroniques – typiquement des logiciels et/ou des matériels – pour prendre en charge la gestion des documents, à savoir les opérations et actions destinées à traiter et à exploiter les documents, par exemple la capture, l’acquisition, la numérisation, la validation, la diffusion, le classement, l’indexation, l’archivage, Etc.

Les automatismes rendent plus fiables les documents, leur gestion, leur accès, leur exploitation, et permettent aux utilisateurs de se consacrer davantage à leurs tâches à valeur ajoutée tout en réduisant considérablement les risques d’oubli et d’erreur

<!-- texte : forme « Espace réservé du contenu 1 » -->
En bref ?

<!-- texte : forme « ZoneTexte 6 » -->
Une GED est une base de données centralisé de tous les documents avec des filtres optimisés pour la recherche.

**Notes du présentateur :** aucune.

---

<a id="diapositive-3"></a>

## Diapositive 3 — Pourquoi ?

<!-- titre : forme « Titre 2 » -->
**Titre :** Pourquoi ?

<!-- texte : forme « Espace réservé du contenu 1 » -->
Quel intérêt ?

<!-- texte : forme « ZoneTexte 4 » -->
Une GED offre de nombreux avantages : centralisation des documents, accès rapide à l’information, réduction des coûts liés au papier, automatisation des workflows, meilleure traçabilité et sécurité renforcée. Elle facilite aussi la collaboration, améliore la conformité réglementaire et optimise l’efficacité globale de l’organisation.

Les entreprises sont aujourd’hui confrontées à une multitude de données, souvent éparpillées entre différents outils où l’information reste cloisonnée. Sans GED, les sources d’information se multiplient, les doublons se créent et le risque de perdre des documents importants devient bien réel.

Dans ce contexte de dématérialisation croissante des fichiers, il devient indispensable de s’appuyer sur un outil de gestion électronique des documents adapté. Une GED permet non seulement de répondre aux problématiques spécifiques de chaque entreprise (organisation, accès à l’information, collaboration), mais aussi de respecter les exigences légales en matière de conservation et de traçabilité des documents.

<!-- texte : forme « Espace réservé du contenu 1 » -->
En bref ?

<!-- texte : forme « ZoneTexte 6 » -->
Une GED est un outil qui sécurise les documents et optimise le travail et la collaboration.

**Notes du présentateur :** aucune.

---

<a id="diapositive-4"></a>

## Diapositive 4 — Comment ?

<!-- titre : forme « Titre 2 » -->
**Titre :** Comment ?

<!-- texte : forme « Espace réservé du contenu 1 » -->
Via les outils Microsoft existants

<!-- image : forme « Image 7 » -->
**[Image « Image 7 »]** `ppt/media/image3.png` ; aucun texte alternatif dans le fichier — *note de transcription (identification visuelle) : logo SharePoint (mot « SharePoint » visible)*

<!-- image : forme « Image 9 » -->
**[Image « Image 9 »]** `ppt/media/image4.png`, avec calque de suppression d’arrière-plan `ppt/media/hdphoto1.wdp` ; aucun texte alternatif dans le fichier — *note de transcription (identification visuelle) : pictogramme base de données avec une clé (aucun texte)*

<!-- image : forme « Image 11 » -->
**[Image « Image 11 »]** `ppt/media/image5.png`, recadrée (droite 77,8 %) ; aucun texte alternatif dans le fichier — *note de transcription (identification visuelle) : logo Power Automate (mot « Power Automate » visible)*

<!-- image : forme « Image 12 » -->
**[Image « Image 12 »]** `ppt/media/image5.png`, recadrée (gauche 22,2 %, droite 60,4 %) ; aucun texte alternatif dans le fichier — *note de transcription (identification visuelle) : logo Power Apps (mot « Power Apps » visible)*

**Connecteurs** :

- « Connecteur : en angle 14 » : départ non accroché, posé près de « Image 9 » ; arrivée « Image 7 » (accroché)
- « Connecteur : en angle 16 » : départ non accroché, posé près de « Image 12 » ; arrivée « Image 7 » (accroché)

**Notes du présentateur :** aucune.

---

<a id="diapositive-5"></a>

## Diapositive 5 — Comment ?

<!-- titre : forme « Titre 2 » -->
**Titre :** Comment ?

<!-- texte : forme « Espace réservé du contenu 1 » -->
Via les outils Microsoft existants

<!-- image : forme « Image 7 » -->
**[Image « Image 7 »]** `ppt/media/image3.png` ; aucun texte alternatif dans le fichier — *note de transcription (identification visuelle) : logo SharePoint (mot « SharePoint » visible)*

<!-- texte : forme « ZoneTexte 3 » -->
Ajout d’une bibliothèque de documents unique dans le SharePoint global

<!-- image : forme « Image 11 » -->
**[Image « Image 11 »]** `ppt/media/image5.png`, recadrée (droite 77,8 %) ; aucun texte alternatif dans le fichier — *note de transcription (identification visuelle) : logo Power Automate (mot « Power Automate » visible)*

<!-- texte : forme « ZoneTexte 5 » -->
Power Automate pour la création des flux (création, validation, modification, obsolescence…)

<!-- image : forme « Image 9 » -->
**[Image « Image 9 »]** `ppt/media/image4.png`, avec calque de suppression d’arrière-plan `ppt/media/hdphoto1.wdp` ; aucun texte alternatif dans le fichier — *note de transcription (identification visuelle) : pictogramme base de données avec une clé (aucun texte)*

<!-- texte : forme « ZoneTexte 4 » -->
La bibliothèque de document fait office de base de données et de coffre fort pour les documents

<!-- image : forme « Image 12 » -->
**[Image « Image 12 »]** `ppt/media/image5.png`, recadrée (gauche 22,2 %, droite 60,4 %) ; aucun texte alternatif dans le fichier — *note de transcription (identification visuelle) : logo Power Apps (mot « Power Apps » visible)*

<!-- texte : forme « ZoneTexte 6 » -->
IU Power Apps pour une interface unique aux utilisateurs sans qu’ils ne puissent se perdre dans la BDD

**Notes du présentateur :** aucune.

---

<a id="diapositive-6"></a>

## Diapositive 6 — Les étapes ?

<!-- titre : forme « Titre 2 » -->
**Titre :** Les étapes ?

<!-- texte : forme « Espace réservé du contenu 1 » -->
Les créations / modifications dans l’existant

<!-- texte : forme « ZoneTexte 3 » -->
1 – Etat de l’art des arborescences dossiers actuellement utilisés

2 – Création des métadonnées dans la bibliothèque de termes du SharePoint

3 – Création de la bibliothèque de documents unique

4 – Migration des documents existants par vagues

5 – Suppression/Archivage des anciennes arborescences

<!-- image : forme « Image 7 » -->
**[Image « Image 7 »]** `ppt/media/image3.png` ; aucun texte alternatif dans le fichier — *note de transcription (identification visuelle) : logo SharePoint (mot « SharePoint » visible)*

**Notes du présentateur :** aucune.

---

<a id="diapositive-7"></a>

## Diapositive 7 — Les étapes ?

<!-- titre : forme « Titre 2 » -->
**Titre :** Les étapes ?

<!-- texte : forme « Espace réservé du contenu 1 » -->
Les créations / modifications dans l’existant

<!-- texte : forme « ZoneTexte 3 » -->
1 – Création de la bibliothèque unique de documents

2 – Paramétrages de la bibliothèque pour utilisation des métadonnées
- Données de filtrage
- Codification automatique du nom de document en fonction de son type
- …

3 – Paramétrage de la bibliothèque pour gestion du versioning des documents

4 – Création des premiers documents type (templates)

5 – Migration des documents par vagues

<!-- image : forme « Image 7 » -->
**[Image « Image 7 »]** `ppt/media/image6.png` ; aucun texte alternatif dans le fichier — *note de transcription (identification visuelle) : pictogramme base de données avec une clé (aucun texte)*

**Notes du présentateur :** aucune.

---

<a id="diapositive-8"></a>

## Diapositive 8 — Les étapes ?

<!-- titre : forme « Titre 2 » -->
**Titre :** Les étapes ?

<!-- texte : forme « Espace réservé du contenu 1 » -->
Les créations / modifications dans l’existant

<!-- texte : forme « ZoneTexte 3 » -->
1 – Identification des workflows a créer en fonction des besoins
- Création de documents (pour création automatique de la codification du document)
- Validation de documents (pour circuit de validation prédéfini en fonction du type de document)
- Modification de document validé (principe de l’ECR/ECO)
- Passage d’un document à l’état obsolète.
- …

2 – Mise en place des workflows

<!-- image : forme « Image 7 » -->
**[Image « Image 7 »]** `ppt/media/image7.png` ; aucun texte alternatif dans le fichier — *note de transcription (identification visuelle) : logo Power Automate (mot « Power Automate » visible)*

**Notes du présentateur :** aucune.

---

<a id="diapositive-9"></a>

## Diapositive 9 — Les étapes ?

<!-- titre : forme « Titre 2 » -->
**Titre :** Les étapes ?

<!-- texte : forme « Espace réservé du contenu 1 » -->
Les créations / modifications dans l’existant

<!-- texte : forme « ZoneTexte 3 » -->
1 – Identification besoins utilisateurs par département

2 – Création de l’app de base
- Création de documents
- Recherche de documents existants
- Liens pour ouverture du document (liens vers bibliothèque SharePoint)

3 – Mise en place progressive des workflows
- Création de documents (pour création automatique de la codification du document)
- Validation de documents (pour circuit de validation prédéfini en fonction du type de document)
- Modification de document validé (principe de l’ECR/ECO)
- Passage d’un document à l’état obsolète.
- …

<!-- image : forme « Image 7 » -->
**[Image « Image 7 »]** `ppt/media/image8.png` ; aucun texte alternatif dans le fichier — *note de transcription (identification visuelle) : logo Power Apps (mot « Power Apps » visible)*

**Notes du présentateur :** aucune.

---

<a id="diapositive-10"></a>

## Diapositive 10 — L’usage

<!-- titre : forme « Titre 2 » -->
**Titre :** L’usage

<!-- texte : forme « Espace réservé du contenu 1 » -->
L’accès

<!-- texte : forme « ZoneTexte 3 » -->
L’accès a l’ensemble des documents se fera via l’application commune « GED EPC2I ».

Des pages dédiées métiers seront disponibles dans l’app pour mettre en avant les filtres principaux liés aux utilisateurs.

Les accès peuvent être restreints au besoin (classe de confidentialité, statut du document en « brouillon », …)

<!-- image : forme « Image 7 » -->
**[Image « Image 7 »]** `ppt/media/image8.png` ; aucun texte alternatif dans le fichier — *note de transcription (identification visuelle) : logo Power Apps (mot « Power Apps » visible)*

**Notes du présentateur :** aucune.

---

<a id="diapositive-11"></a>

## Diapositive 11 — L’usage

<!-- titre : forme « Titre 2 » -->
**Titre :** L’usage

<!-- texte : forme « Espace réservé du contenu 1 » -->
Les fonctions visibles par l’utilisateur

<!-- texte : forme « ZoneTexte 3 » -->
A terme, l’app prendra en charge:
- La création de documents et la fourniture de leur ID unique
- La possibilité de recherche de n’importe quel document depuis l’app unique (projets, R&D, commercial, RH, Com’, …)
- Les demandes de modification d’un document déjà en statut validé
- Les validations de documents (nouveaux ou modifiés)
- Les demandes de passage d’un document aux statut obsolète
- Un suivi des workflows en cours lancés par l’utilisateur
- Un suivi des actions en attente de l’utilisateur (action à faire dans un workflow)

<!-- image : forme « Image 7 » -->
**[Image « Image 7 »]** `ppt/media/image8.png` ; aucun texte alternatif dans le fichier — *note de transcription (identification visuelle) : logo Power Apps (mot « Power Apps » visible)*

**Notes du présentateur :** aucune.

---

<a id="diapositive-12"></a>

## Diapositive 12 — Les métadonnées

<!-- titre : forme « Titre 2 » -->
**Titre :** Les métadonnées

<!-- texte : forme « Espace réservé du contenu 1 » -->
Architecture de niveau 1 – La hiérachie

**Tableau 12.1** (forme « Tableau 4 », 6 lignes × 3 colonnes)

| Type de contenu | Rôle | Remarque |
|---|---|---|
| GED Document | Type parent commun à tous les documents contrôlés | Hérite du type SharePoint “Document” |
| GED – Document interne | Procédures, politiques, comptes rendus, documents de gestion | Origine interne |
| GED – Document externe | Contrats, normes, documents fournisseurs, courriers officiels | Origine externe |
| GED – Document projet | Documents liés à la gouvernance, la conception, l’exécution, la clôture | Lié à un projet |
| GED – Document recherche | Études, essais, analyses, publications, propriété intellectuelle | Lié à la recherche |

**Notes du présentateur :** aucune.

---

<a id="diapositive-13"></a>

## Diapositive 13 — Les métadonnées

<!-- titre : forme « Titre 2 » -->
**Titre :** Les métadonnées

<!-- texte : forme « Espace réservé du contenu 1 » -->
Architecture de niveau 2 – Le tronc commun

**Tableau 13.1** (forme « Tableau 3 », moitié gauche de la diapositive, 11 lignes × 4 colonnes)

| Champ | Type | Obligatoire | Utilité |
|---|---|---|---|
| ID document | Texte / généré automatiquement | Oui | Référence unique et immuable |
| Titre | Texte | Oui | Nom lisible du document |
| Domaine | Dérivé du type de contenu | Oui | Interne / Externe / Projet / Recherche |
| Catégorie | Métadonnée gérée | Oui | Famille fonctionnelle |
| Type de document | Métadonnée gérée | Oui | Classe principale |
| Sous-type de document | Métadonnée gérée | Non | Niveau de détail supplémentaire |
| Propriétaire du document | Personne | Oui | Responsable métier interne |
| Auteur | Personne ou texte | Oui | Auteur réel ou organisme émetteur |
| Statut | Choix | Oui | Brouillon / En révision / Approuvé / En vigueur / Remplacé / Archivé / Obsolète |
| Département / Fonction | Métadonnée gérée | Oui | Entité métier |

**Tableau 13.2** (forme « Tableau 5 », moitié droite de la diapositive, 11 lignes × 4 colonnes)

| Champ | Type | Obligatoire | Utilité |
|---|---|---|---|
| Niveau de confidentialité | Choix | Oui | Interne / Confidentiel / Très confidentiel / Restreint |
| Mots-clés | Métadonnée gérée multiple | Non | Recherche complémentaire |
| Version / Révision | Texte | Oui | Suivi des versions |
| Date d’émission | Date | Oui | Première émission |
| Date d’effet | Date | Non | Début de validité |
| Date de révision | Date | Non | Révision prévue |
| Date d’expiration | Date | Non | Fin de validité |
| Langue | Choix | Non | Gestion multilingue |
| Classe de conservation | Métadonnée gérée | Oui | Rétention / conformité |
| Organisme source | Métadonnée gérée | Conditionnel | Obligatoire pour les documents externes |

**Notes du présentateur :** aucune.

---

<a id="diapositive-14"></a>

## Diapositive 14 — Les métadonnées

<!-- titre : forme « Titre 2 » -->
**Titre :** Les métadonnées

<!-- texte : forme « Espace réservé du contenu 1 » -->
Architecture de niveau 3 – La taxonomie des DI

**Tableau 14.1** (forme « Tableau 4 », moitié gauche de la diapositive, 6 lignes × 3 colonnes)

| Catégorie | Type de document | Exemples de sous-types |
|---|---|---|
| Gouvernance & Management | Politique | Politique groupe, politique départementale, politique sécurité |
| Gouvernance & Management | Procédure | Procédure standard, SOP, instruction de travail |
| Gouvernance & Management | Enregistrement de gouvernance | PV de comité, PV de réunion, journal de décisions, plan d’actions |
| Qualité / QHSE | Audit & Inspection | Rapport d’audit interne, checklist d’inspection, fiche de non-conformité |
| Qualité / QHSE | Sécurité & Risques | Analyse de risques, rapport d’incident, plan CAPA |

**Tableau 14.2** (forme « Tableau 6 », moitié droite de la diapositive, 6 lignes × 3 colonnes)

| Catégorie | Type de document | Exemples de sous-types |
|---|---|---|
| Opérations | Maîtrise opérationnelle | Procédure d’exploitation, passation de consignes, guide de dépannage |
| Opérations | Maintenance & Actifs | Instruction de maintenance, journal de maintenance, certificat d’étalonnage, registre d’actifs |
| Fonctions support | RH & Formation | Fiche de poste, matrice de compétences, support de formation, feuille de présence |
| Fonctions support | Finance & Administration | Budget, demande d’achat, procédure de dépenses, fiche de contrôle d’actifs |
| Fonctions support | IT & Sécurité de l’information | Procédure d’accès, procédure de sauvegarde, PRA/PCA, standard système |

**Notes du présentateur :** aucune.

---

<a id="diapositive-15"></a>

## Diapositive 15 — Les métadonnées

<!-- titre : forme « Titre 2 » -->
**Titre :** Les métadonnées

<!-- texte : forme « Espace réservé du contenu 1 » -->
Architecture de niveau 3 – La taxonomie des DE

**Tableau 15.1** (forme « Tableau 3 », moitié gauche de la diapositive, 7 lignes × 3 colonnes)

| Catégorie | Type de document | Exemples de sous-types |
|---|---|---|
| Réglementaire & Normatif | Règlementation | Loi, décret, circulaire, guide officiel |
| Réglementaire & Normatif | Permis / Certification | Permis, licence, certificat, notification d’approbation |
| Réglementaire & Normatif | Norme / Référentiel | Norme ISO, norme métier, standard client |
| Contrats & Juridique | Accord | NDA, contrat-cadre, contrat fournisseur, avenant |
| Contrats & Juridique | Acte juridique | Conditions générales, avis juridique, notification de réclamation |
| Fournisseurs / Fabricants | Documentation technique | Datasheet, manuel utilisateur, guide d’installation, manuel de maintenance |

**Tableau 15.2** (forme « Tableau 5 », moitié droite de la diapositive, 5 lignes × 3 colonnes)

| Catégorie | Type de document | Exemples de sous-types |
|---|---|---|
| Fournisseurs / Fabricants | Documentation qualité | Certificat de conformité, certificat d’essai, rapport d’inspection |
| Clients / Partenaires | Correspondance | Courrier officiel, bordereau de transmission, email formalisé, note de réunion |
| Clients / Partenaires | Échange commercial | RFQ, offre, bon de commande, facture, bon de livraison |
| Évaluations tierces | Rapport externe | Rapport d’audit, rapport laboratoire, expertise, rapport d’enquête |

**Notes du présentateur :** aucune.

---

<a id="diapositive-16"></a>

## Diapositive 16 — Les métadonnées

<!-- titre : forme « Titre 2 » -->
**Titre :** Les métadonnées

<!-- texte : forme « Espace réservé du contenu 1 » -->
Architecture de niveau 3 – La taxonomie des DP

**Tableau 16.1** (forme « Tableau 4 », moitié gauche de la diapositive, 8 lignes × 3 colonnes)

| Catégorie | Type de document | Exemples de sous-types |
|---|---|---|
| Gouvernance projet | Définition du projet | Charte projet, business case, PID, plan d’exécution |
| Gouvernance projet | Pilotage & Décisions | Dossier comité de pilotage, journal de décisions, RAID log |
| Planification & Contrôle | Planning & Coûts | Planning de référence, plan jalons, budget initial, rapport de coûts |
| Planification & Contrôle | Reporting d’avancement | Rapport hebdomadaire, rapport mensuel, tableau de bord KPI |
| Ingénierie & Conception | Exigences | Besoin métier, spécification fonctionnelle, spécification technique |
| Ingénierie & Conception | Livrables de conception | Plans, note de calcul, rapport de revue de conception |
| Achats & Contrats | Consultation | RFP, RFQ, évaluation d’offres, recommandation fournisseur |

**Tableau 16.2** (forme « Tableau 6 », moitié droite de la diapositive, 6 lignes × 3 colonnes)

| Catégorie | Type de document | Exemples de sous-types |
|---|---|---|
| Achats & Contrats | Administration contractuelle | Demande d’achat, ordre de changement, dossier fournisseur |
| Exécution & Chantier | Exécution terrain | Méthode, dossier de travaux, instruction chantier, fiche d’installation |
| Exécution & Chantier | Essais & Mise en service | Plan de test, ITP, procédure de commissioning, enregistrement d’essai |
| Handover & Clôture | Remise / Handover | Dossier as-built, punch list, certificat de réception, dossier de transfert |
| Handover & Clôture | Clôture | Retour d’expérience, rapport de clôture, index d’archivage |

**Notes du présentateur :** aucune.

---

<a id="diapositive-17"></a>

## Diapositive 17 — Les métadonnées

<!-- titre : forme « Titre 2 » -->
**Titre :** Les métadonnées

<!-- texte : forme « Espace réservé du contenu 1 » -->
Architecture de niveau 3 – La taxonomie des DR

**Tableau 17.1** (forme « Tableau 3 », moitié gauche de la diapositive, 8 lignes × 3 colonnes)

| Catégorie | Type de document | Exemples de sous-types |
|---|---|---|
| Gouvernance de la recherche | Proposition & Autorisation | Proposition de recherche, dossier éthique, demande de financement |
| Gouvernance de la recherche | Pilotage du programme | Plan de recherche, revue de jalons, compte rendu de réunion scientifique |
| Revue de connaissances | Revue bibliographique | Bibliographie, revue annotée, état de l’art |
| Revue de connaissances | Antériorité & Benchmark | Revue brevets, étude comparative, veille technologique |
| Conception d’étude | Protocoles | Protocole expérimental, matrice d’essais, plan d’échantillonnage |
| Conception d’étude | Planification des données | Plan de gestion des données, dictionnaire de données, schéma de codification |
| Données & Expériences | Preuves brutes | Jeu de données brut, cahier de laboratoire, journal d’observation, export instrument |

**Tableau 17.2** (forme « Tableau 5 », moitié droite de la diapositive, 7 lignes × 3 colonnes)

| Catégorie | Type de document | Exemples de sous-types |
|---|---|---|
| Données & Expériences | Données préparées | Jeu de données nettoyé, dataset dérivé, base d’images annotées |
| Analyse & Modélisation | Analyse quantitative | Analyse statistique, classeur de calcul, étude de sensibilité |
| Analyse & Modélisation | Simulation & Modélisation | Fichier modèle, journal d’hypothèses, rapport de validation |
| PI & Savoir confidentiel | Protection intellectuelle | Déclaration d’invention, brouillon de brevet, note technique confidentielle |
| Résultats & Diffusion | Publication | Résumé, manuscrit, poster, article publié, présentation conférence |
| Collaboration externe | Collaboration | Livrable de consortium, commentaires relecteurs, accord de collaboration |

**Notes du présentateur :** aucune.

---

<a id="diapositive-18"></a>

## Diapositive 18 — Les métadonnées

<!-- titre : forme « Titre 2 » -->
**Titre :** Les métadonnées

<!-- texte : forme « Espace réservé du contenu 1 » -->
Architecture de niveau 4 – Champs spécifiques

**Tableau 18.1** (forme « Tableau 4 », 5 lignes × 2 colonnes)

| Domaine | Champs supplémentaires obligatoires |
|---|---|
| Interne | Propriétaire de processus, autorité d’approbation, département, niveau de confidentialité |
| Externe | Organisme source, référence externe, sens du document (entrant/sortant), date de réception |
| Projet | Code projet, phase projet, lot / work package, discipline |
| Recherche | Programme de recherche, thème de recherche, ID étude/essai, statut publication / PI |

**Notes du présentateur :** aucune.

---
