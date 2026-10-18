# Fiches de décision — questions O-01 à O-11

Ces fiches aident l'utilisateur à trancher les questions encore ouvertes de `docs/decisions.md`. **Elles ne tranchent
rien.** Chaque fiche donne la question telle qu'elle est écrite, ce que Codex fait aujourd'hui, les options possibles
avec leur coût, ce dont l'assistant a besoin pour avancer et, parfois, une proposition clairement étiquetée.

Lot 10, étape 1, 18 octobre 2026, sur la branche `codex-ged-v2-vkmf4l` (fin du lot 9).

## Comment lire ces fiches

- **Source de vérité** : `docs/decisions.md`. En cas d'écart, ce fichier prévaut. Les fiches ne citent l'utilisateur
  que par ses réponses de `docs/decisions.md`.
- **Code vérifié** : les fichiers et fonctions cités ont été relus dans le code le 18 octobre 2026 (recherche dans
  `src/`). Les numéros de ligne ne sont pas donnés : ils bougent à chaque lot.
- **Points débloqués** : numéros de `docs/reste-a-faire.md` (section « Attend une décision de l'utilisateur », points 70
  à 120, et restes des points faits en partie).
- **Effort** : estimation de l'assistant, en sessions de travail du même ordre qu'une étape de lot (code, tests,
  docs). Ce n'est pas un engagement : une réponse partielle ou un accès manquant l'allonge.
- **Irréversible** : ce qui ne se défait plus sans réécrire des données réelles une fois Codex en production
  (identifiants attribués, journal en ajout seul, codes figés). Avant la production, une base de démonstration se
  recrée (`npm run db:reset`) et rien n'est irréversible.
- **Proposition (assistant, non validée)** : un avis, jamais appliqué sans réponse de l'utilisateur. On peut l'ignorer.
- Une question se repose **une fois**, en citant son numéro (règle de `docs/decisions.md`).

## Sommaire

| N° | Sujet | Options présentées |
|---|---|---|
| O-01 | SharePoint | A pas de SharePoint · B un fichier par version de travail, sans accès direct (codé) · C un fichier par révision · D accès direct et coédition |
| O-02 | Authentification | A Entra ID (OIDC) · B autre fournisseur OIDC · C SAML · D comptes locaux ; rôles par groupes ou dans Codex |
| O-03 | Keystone | A API et tables miroir · B base partagée · C hybride |
| O-04 | Organigramme | A garder les codes provisoires · B nouveaux codes · C axe « société » |
| O-05 | Registre des types | 9 questions et 5 choix de fusion, dont les collisions de codes (avec JUR) |
| O-06 | Circuits et titulaires | A matrice saisie · B nouvelles fonctions ou portées · C étapes parallèles, délais, suppléance |
| O-07 | Durées de conservation | A valider telles quelles · B corriger type par type · C fichier de durées |
| O-08 | Types admettant « Public » | A liste actuelle · B règle par famille · C type « communication » |
| O-09 | Propositions de l'assistant | tableau irréversible / réversible |
| O-10 | ECR/ECO dans Vigie | A contrat Vigie complet · B demandes nées dans Keystone · C ECO sur plusieurs documents |
| O-11 | Migration et volumes | A API actuelle · B historique et états · C lots et flux |

Le nombre de points de `docs/reste-a-faire.md` que chaque question concerne est en annexe B.

---

## O-01 — SharePoint

### 1. La question

> **SharePoint** : faut-il l'activer ? Si oui, faut-il un fichier par version, sans accès direct des utilisateurs à la bibliothèque ? Sans cette restriction, les utilisateurs pourraient contourner les droits de Codex. Avec elle, on modifie un fichier en le téléchargeant puis en le redéposant, sans édition Office en ligne. Posée 4 fois (7 oct. à 17:33, 18:07 et 23:18 ; 8 oct. à 06:18), jamais répondue.

Contexte (D-06, citation exacte) : « la seule option ouverte si c'est plus simple est que le stockage des documents
soit sous une bibliothèque sharepoint gérée par Codex (les metadonnées et autres informations sont dans codex et
uniquement le document et son nom et sa version sont mises dans sharepoin) ».

À noter : la question d'origine (7 octobre, 17:33) disait « un fichier par **révision** » ; la table O-01 dit « un
fichier par version » ; `docs/modele-cible.md` §1 retient à titre provisoire « un fichier par **version de travail** ».
Ce sont deux options différentes (B et C ci-dessous).

### 2. Ce que Codex fait aujourd'hui

- **Stockage local par défaut** : `CODEX_STORAGE` absent ou `local`, fichiers dans `.data/files`
  (`src/lib/storage.ts`, `store()`, `activeStore()`).
- **Pilote SharePoint écrit, jamais essayé sur un vrai tenant** : `sharepoint()` dans `src/lib/storage.ts`,
  Microsoft Graph avec l'identité de l'application (`CODEX_SP_TENANT_ID`, `CODEX_SP_CLIENT_ID`,
  `CODEX_SP_CLIENT_SECRET`, `CODEX_SP_DRIVE_ID`). Il dépose sous `_staging/`, puis range le fichier dans un dossier au
  nom de l'ID sous `{ID}_{lettre}.{n}.{ext}` (`put`, `rename`, `get`, `open`, `remove`, `list`, `probe`).
- **Un fichier par version de travail** : chaque ligne de `working_versions` porte son `storage` et son `file_key`.
  Un fichier déjà stocké en local reste lisible après une bascule (le stockage est lu ligne par ligne).
- **Aucun accès direct** : les utilisateurs ne se connectent jamais à SharePoint ; Codex sert le fichier
  (`src/app/api/documents/[id]/file/route.ts`) après ses propres contrôles (`canRead`, `src/lib/access.ts`).
- **Taille** : 50 Mo par défaut (`DEFAULT_MAX_FILE_MB`), plafonnée à 250 Mo avec SharePoint
  (`SHAREPOINT_MAX_FILE_MB`, `src/lib/filetypes.ts`) : le pilote fait un envoi simple, sans session d'upload.
- **Ce qui ne suit pas SharePoint** : la sauvegarde compte les fichiers SharePoint sans les copier
  (`src/lib/backup-core.mjs`) ; le nettoyage des orphelins les liste sans les supprimer ; l'aperçu Office est gardé en
  local ; l'export complet les lit par Graph depuis l'application, pas depuis la commande.
- **Contrôle au démarrage** : une configuration SharePoint incomplète arrête le serveur en production
  (`src/lib/config-check.ts`).

### 3. Options

| | A. Pas de SharePoint | B. Un fichier par version de travail, sans accès direct (état codé) | C. Un fichier par révision approuvée seulement | D. Accès direct des utilisateurs (coédition) |
|---|---|---|---|---|
| **Ce que ça veut dire** | Les fichiers restent sur le disque du serveur de Codex. | Toutes les versions A.1, A.2… vont dans la bibliothèque ; seul Codex y accède. | Les versions de travail restent en local ; le fichier final de la révision part dans SharePoint à l'approbation. | Les utilisateurs ouvrent et modifient les fichiers dans SharePoint ou Office pour le web. |
| **Code à changer** | Rien. Le chiffrement au repos reste à traiter autrement (point 88 : volume chiffré, ou chiffrement dans `put`/`get` du store local). | Aucun changement de modèle. Essai réel de `sharepoint()` ; envoi par session d'upload au-delà de 250 Mo (`put`, point 98) ; lecture en flux de l'import (`src/app/api/import/route.ts`) ; suppression et renommage essayés sur le tenant (restes de 36). | `approveRevision` ou `putInForce` (`src/lib/lifecycle.ts`) copient le fichier final vers SharePoint et mettent à jour `working_versions.storage` et `file_key` ; `stageFile` garde le local pour les versions de travail ; nettoyage, intégrité et export à adapter. **Pas de migration** : la colonne `storage` existe par ligne. | Graph en mode délégué (suppose O-02, Entra ID) ; permissions SharePoint tenues au même niveau que `canRead` ; réconciliation des versions créées par SharePoint avec `working_versions` (D-12) ; hôte d'édition (point 84). |
| **Effort estimé** | 0 session (1 pour le chiffrement local si voulu). | 1 à 2 sessions, avec un accès à un tenant de test. | 2 à 3 sessions, plus l'essai du tenant. | Important, non chiffrable sans tenant ni réponse à O-02 (plusieurs lots). |
| **Irréversible en production** | Rien. | Rien de bloquant : les noms se renomment (`renameDocFiles`) et le local reste lisible. Les dossiers vides ne sont pas supprimés. La sauvegarde des fichiers SharePoint relève alors de Microsoft 365, pas de Codex. | Comme B. | Les droits posés dans SharePoint et les versions créées hors de Codex. Risque, écrit dans la question : contourner les droits de Codex. |
| **Points débloqués** | 103 (clos sans essai), 88 (voie locale), 98 sans objet, 84 (reste possible par un hôte d'édition dans Codex). | 103, 98, 88 (fichiers chiffrés par Microsoft 365, base à chiffrer à part), restes de 36, 46, 48, 50. | Comme B. | 84, en plus de B. |

Points liés : 82 et 86 (contenu des fichiers, moteur de conversion : la conversion Graph n'existe qu'avec SharePoint).

### 4. Ce dont l'assistant a besoin

- La réponse : A, B, C ou D (ou une autre formulation).
- Pour B, C ou D : un tenant de test, une inscription d'application avec une permission limitée au site (par exemple
  `Sites.Selected`, à confirmer par l'administrateur Microsoft 365), l'identifiant de la bibliothèque (`drive id`). Les
  secrets se posent en variables d'environnement, jamais dans le dépôt.
- Ce qu'on fait des fichiers déjà stockés en local au moment de la bascule (les laisser, ou les recopier).
- Pour D : la réponse à O-02 et le besoin réel d'édition en ligne (question 11 du §6.6 de l'audit).

### 5. Proposition (assistant, non validée)

Trancher d'abord « accès direct ou non » : c'est ce qui engage la sécurité (D-14, droits de Codex). Entre A, B et C,
rien n'est irréversible ; on peut commencer en A et passer en B ou C plus tard sans reprendre les données.

---

## O-02 — Fournisseur d'authentification

### 1. La question

> **Fournisseur d'authentification** pour remplacer la simulation. Entra ID est proposé, non confirmé.

Contexte : en D-03, l'utilisateur a choisi « Rôle simulé (Recommandé) », dont la description disait « L'authentification
réelle (SSO, etc.) viendra plus tard ». Entra ID a été proposé par l'assistant les 7 octobre (12:40, 17:33), sans
réponse.

### 2. Ce que Codex fait aujourd'hui

- **Identité choisie par cookie** : `getCtx` (`src/lib/context.ts`) lit `codex-user` et `codex-role` ; par défaut
  `cbardet` (Claire Bardet). Le rôle simulé est l'un des quatre de `SIM_ROLES` (`src/lib/i18n.ts`), relié à une ligne
  de la matrice par `MATRIX_ROLE`.
- **Changement d'utilisateur** : action `simulateUser` (`src/lib/actions.ts`), ouverte à tous, appelée par
  `UserSwitcher` (`src/components/dialogs/Dialogs.tsx`), ouvert depuis le profil en bas de la barre latérale
  (`src/components/shell/Sidebar.tsx`).
- **Routes d'API qui lisent la session** : `src/app/api/documents/[id]/file`, `.../compare`, `.../approval`,
  `src/app/api/export/full`, `.../audit`, `.../search` (toutes par `getCtx`).
- **`src/proxy.ts`** existe : il ne pose que la politique de sécurité du contenu ; c'est là qu'irait la redirection des
  visiteurs non connectés.
- **Personnes** : table `users` (`src/db/schema.ts`) sans e-mail, sans identifiant externe, sans état actif. Elles ne
  viennent que de l'amorçage ; le mode `CODEX_SEED=minimal` ajoute un administrateur fictif `admin` « parce que
  l'application simulée a besoin d'une personne pour s'ouvrir ».
- **Rôles** : `users.role` et la matrice `role_permissions` (modifiable dans Administration › Rôles, `togglePermission`).
  Aucun écran n'attribue un rôle à une personne.
- **Serveur à serveur** : déjà indépendant de ce choix (jeton et signature HMAC, `src/lib/server-auth.ts`).
- En production, un avertissement rappelle à chaque démarrage que les utilisateurs sont simulés.

### 3. Options

| | A. Entra ID (OIDC) — proposé, non confirmé | B. Autre fournisseur OIDC | C. SAML | D. Comptes locaux dans Codex |
|---|---|---|---|---|
| **Code à changer** (commun à A, B, C) | Connexion OIDC (code + PKCE), route de rappel, session signée en cookie `httpOnly`/`secure`, déconnexion ; redirection dans `src/proxy.ts` ; `getCtx` dérivé de la session ; même contrôle dans les routes d'API citées ; `simulateUser` et `UserSwitcher` réservés à un mode démo explicite. Migration : colonnes identifiant externe, e-mail, actif dans `users`. | Comme A, avec la configuration du fournisseur choisi. | Comme A, mais réponse SAML signée à vérifier (bibliothèque XML à ajouter). | Mots de passe hachés, réinitialisation, verrouillage après échecs ; écran de gestion des comptes. Migration sur `users`. |
| **Effort estimé** | 2 à 3 sessions, plus 1 à 2 pour les rôles et le provisionnement. | Comme A. | 3 à 4 sessions. | 3 sessions ; Codex porte alors la sécurité des mots de passe (pas d'authentification à plusieurs facteurs sans travail en plus). |
| **Ce que ça ouvre** | Graph délégué (O-01 D), notifications par Graph (point 104), complément Outlook (point 107). | Selon le fournisseur. | Selon le fournisseur. | Rien côté Microsoft. |

**Sous-question : rôles par groupes de l'annuaire, ou attribués dans Codex ?**

| | Rôles attribués dans Codex | Rôles dérivés des groupes de l'annuaire |
|---|---|---|
| Code | Écran d'attribution (point 89), action journalisée, rôles Lecteur et Administrateur rendus effectifs. | Table de correspondance groupe → rôle (et éventuellement département, site) ; lecture des groupes à la connexion. |
| Qui tient les droits | Un administrateur de Codex. | L'administrateur de l'annuaire. |

**Irréversible en production** : l'identifiant de personne que portent le journal (en ajout seul), l'import
(`ownerId`) et le webhook Vigie (`modifierId`). Il faut décider avant les premières données réelles s'il reste
l'identifiant court actuel (`cbardet`), complété par un identifiant externe, ou s'il devient l'identifiant de
l'annuaire. Le même identifiant doit être convenu avec Keystone et Vigie.

**Points débloqués** : 93, 89 (avec O-04), 94 (accès invités), 104 (avec M19), 107 (complément Outlook, avec M08),
117 (personnes, avec O-04), 79 (accès réseau depuis un chantier, avec M23), et le retrait des notes de conception en
production (reste de 69). La valeur probante du journal en dépend aussi (M05).

### 4. Ce dont l'assistant a besoin

- Le fournisseur, et l'accord pour une inscription d'application de test (identifiant de client, URL de rappel).
- Le choix « rôles dans Codex » ou « rôles par groupes » ; dans le second cas, la liste des groupes et leur rôle.
- L'identifiant de personne commun à Codex, Keystone et Vigie.
- Ce qu'on fait des comptes invités et des départs (M16).

### 5. Proposition (assistant, non validée)

Le deck indique que les outils Microsoft sont en place ; c'est pourquoi Entra ID a été proposé. Le reste de la
fiche ne dépend pas de ce choix : décider tôt l'identifiant de personne éviterait la seule partie irréversible.

---

## O-03 — Liaison avec Keystone

### 1. La question

> **Liaison avec Keystone** : API ou base partagée ? Il faut aussi définir le contrat de dépôt et de synchronisation des documents projet.

Contexte : en D-04, l'utilisateur a choisi « Affaires simulées (Recommandé) » plutôt que « Base partagée avec
Keystone ». Le « oui fusionne les deux bases » de D-07 porte sur les listes de types, pas sur les bases de données.

### 2. Ce que Codex fait aujourd'hui

- **Tables miroir** `projects`, `project_expected`, `project_events` (`src/db/schema.ts`), remplies seulement par
  l'amorçage (`PROJECTS` de `src/db/seed-org.ts` : `HLT-026`, `NDC-031`, `RCF-019`).
- **Frontière déclarée** : `src/lib/keystone.ts` (`getProject`, `keystoneUrl`). Mais d'autres lecteurs touchent la
  table directement : `ctx.projects` (`src/lib/context.ts`), `resolveFunction` (chef de projet, `src/lib/actions.ts`),
  l'import (`src/lib/importer.ts`), l'index d'accès (`src/lib/access.ts`), la reprise (`src/lib/transfer.ts`).
- **Ce que Keystone lit** : `GET /api/registry` (`src/app/api/registry/route.ts`), ouvert par défaut,
  `CODEX_REGISTRY_TOKEN` pour le fermer.
- **Authentification serveur à serveur** prête (`src/lib/server-auth.ts` : jeton, signature HMAC, anti-rejeu,
  `signRequest` pour les envois). Aucun point d'entrée « keystone » n'existe encore dans `ENDPOINTS`
  (`src/lib/integration-credentials.ts`), et Codex n'appelle jamais Keystone.
- **Lien « Ouvrir dans Keystone »** : `NEXT_PUBLIC_KEYSTONE_URL` + `/projects/{code}`, chemin non vérifié côté Keystone.
- **PostgreSQL serveur** possible depuis le 18 octobre (`DATABASE_URL`, PostgreSQL 18 au moins, `docs/postgres.md`) ;
  PGlite reste la base par défaut et n'ouvre la base que dans un seul processus.

### 3. Options

| | A. API Keystone et tables miroir | B. Base partagée PostgreSQL | C. Hybride |
|---|---|---|---|
| **Principe** | Keystone pousse (webhook signé) ou Codex tire (client HTTP) les projets ; Codex garde ses tables miroir et émet des événements vers Keystone. | Codex et Keystone sur le même serveur PostgreSQL ; Codex lit les projets de Keystone (vue ou schéma dédié). | Lecture des projets dans la base partagée ; dépôts, pièces attendues et événements par API. |
| **Code à changer** | Nouveau point d'entrée `keystone` dans `ENDPOINTS` et route `POST /api/integrations/keystone` ; écriture des tables miroir ; file d'envoi signée pour les événements sortants (point 111) ; identifiant stable des pièces attendues côté Keystone (aujourd'hui `serial` local). Migration : clôture du projet, identifiants Keystone. | Remplacer la lecture de `projects` par une vue sur les tables de Keystone ; garder les clés étrangères (`documents.project_code`, `projects.manager_id`) cohérentes ; plus de tables miroir. Suppose les deux applications sur PostgreSQL serveur (PGlite ne se partage pas) et des versions de schéma coordonnées. | Somme partielle de A et B. |
| **Effort estimé** | 3 à 5 sessions côté Codex, plus le travail côté Keystone. | 2 à 4 sessions côté Codex, plus l'hébergement (M22) et la coordination des migrations. | 4 à 6 sessions. |
| **Irréversible en production** | Rien de plus que les codes projet déjà dans les identifiants (D-09). | Le couplage des schémas : une évolution de Keystone peut casser Codex. | Comme B pour la partie partagée. |

**Sous-questions à trancher avec O-03**

| Sous-question | Aujourd'hui | Points |
|---|---|---|
| Dépôt depuis Keystone : lien profond vers le dialogue prérempli, ou API de création ? La spec Keystone laisse ouvert « deep link? API create? ». | Aucun point d'entrée : « Déposer » n'existe que sur la fiche d'un document déjà rattaché au projet. | 97 |
| Correspondance des personnes (chef de projet, équipe) | `projects.manager_id` doit exister dans `users` ; équipe projet saisie à la main (`addFunctionHolder`). | 102, 89 |
| Date de clôture du projet | Aucune colonne ; 26 types déclenchés par « fin de projet » n'ont pas de fin de conservation (`triggerDate`, `src/lib/retention.ts`). | 105 |
| Libellés anglais des phases | `PROJECT_PHASES_EN` écrits par Codex, provisoires (`src/lib/i18n.ts`). | 63 (fait, libellés à aligner) |
| Pièces attendues dans les deux sens | Seulement l'amorçage ; Keystone n'est jamais prévenu. | 101 |
| Effet du drapeau « livrable client » (portail client Keystone ?) | Aucun effet. | 80 (avec O-05) |

**Points débloqués** : 97, 101, 102, 105, 110, 111, 80 (en partie), restes de 38 (envois sortants) et 51 (plusieurs
processus, selon l'hébergement).

### 4. Ce dont l'assistant a besoin

- Le choix A, B ou C.
- L'accès au dépôt Keystone dans la session (lecture de `docs/spec/10-site-docs-mywork-settings.md` et du modèle de
  projet), ou à défaut le contrat d'API (champs du projet, événements, identifiants).
- L'identifiant de personne commun (voir O-02).
- Le comportement voulu sans titulaire projet pour une étape de circuit : repli sur le titulaire « groupe » (état
  actuel) ou refus.

---

## O-04 — Organigramme

### 1. La question

> **Organigramme** : sociétés, sites, départements.

Contexte (D-19, citation exacte) : « Je te donnerais un organigramme des services et des sites plus tard ».

### 2. Ce que Codex fait aujourd'hui

- **Valeurs provisoires** dans `src/db/seed-org.ts` : `DEPARTMENTS` (15 codes : DIR, COM, PRJ, ING, MEP, CHA, QUA,
  HSE, ACH, RHU, FIN, JUR, DSI, CMN, RDI), `SITES` (Lyon, Le Havre, Marseille), `USERS` (25 personnes et 3 acteurs
  système).
- **Les départements et les sites provisoires sont aussi chargés par le mode minimal** (`CODEX_SEED=minimal`), celui
  d'une vraie installation ; les personnes de démonstration ne le sont pas (un administrateur fictif `admin` à la
  place).
- **Format** : code de département de 3 lettres majuscules (`DEPARTMENT_CODE_RE`, `src/lib/registry-rules.ts`).
- **Administration › Organisation** : ajout, renommage FR/EN, désactivation, réactivation, suppression d'une valeur
  inutilisée (`addOrgValue`, `updateOrgValue`, `deleteOrgValue`, `src/lib/actions.ts`). **Le code d'un département ne
  change jamais** ; une valeur utilisée se désactive.
- **Pas de notion de société** : ni table ni colonne (`src/db/schema.ts`).
- `npm run registry:apply` ne touche ni départements ni sites.
- Le code du département entre dans l'identifiant des documents sans rattachement (`contextOf`, `src/lib/codes.ts`,
  par exemple `PRO-QUA-0003`).

### 3. Options

| | A. Garder les 15 codes, changer les libellés | B. Nouveaux codes de département | C. Ajouter un axe « société » |
|---|---|---|---|
| **Code à changer** | Aucun : saisie dans Administration › Organisation. | Avant la production : remplacer `DEPARTMENTS` dans `src/db/seed-org.ts` (et `HOLDERS`, `USERS`), base recréée. Après : nouveaux codes ajoutés, anciens désactivés (jamais renommés). | Table des sociétés ; colonne sur `documents` et `users` (migration) ; facette, filtre, droits par société (point 92), date de clôture d'exercice par société (point 120), lois applicables (point 96). |
| **Effort estimé** | Saisie, 0 session. | 1 session. | 2 à 4 sessions. |
| **Irréversible en production** | Les codes, déjà dans les identifiants. | Les nouveaux codes, dès le premier document sans rattachement. | Le rattachement des documents existants à une société. |

Collisions à trancher en même temps (point 1 de O-05) : FIN, JUR, COM et HSE sont à la fois des codes de type et de
département (`FIN-FIN-0001`, `JUR-JUR-0001`…).

**Points débloqués** : 117, 116 (recueil des besoins par département), 89 (rattachement des personnes, avec O-02), 92
(lecteurs par société ou site), 96 (lois applicables, avec M17), 120 (clôture d'exercice par société), reste de 62
(fusion de départements, liée à O-09).

### 4. Ce dont l'assistant a besoin

**Outil (18 octobre 2026)** : modèle `docs/modeles/organigramme.csv` (départements, sites, personnes ; société en
colonne facultative, sans table société) et `npm run org:check -- <fichier.csv>`, qui contrôle formats, doublons,
références inconnues et collisions avec les codes de type, sans rien écrire. Le modèle reprend les valeurs
provisoires ; il ne préjuge d'aucune option. La date de clôture d'exercice d'une société n'y a pas de colonne : à
donner à part. Mode d'emploi : `docs/registre-points-ouverts.md`, « Valider le
registre avec le cahier ».

Un tableau (CSV ou tableur) avec :
- **sociétés** : nom, et si elles clôturent leur exercice à une autre date que le 31 décembre ;
- **sites** : libellé FR et EN, société ;
- **départements** : code de 3 lettres, libellé FR et EN, société s'il y a lieu, responsable ;
- **personnes** : nom, département, site, fonction, rôle dans Codex (ou renvoi aux groupes de l'annuaire, O-02).

### 5. Proposition (assistant, non validée)

Fixer les codes de département avant tout document réel : ce sont les seules valeurs de l'organigramme qui se figent.
Les libellés, sites et personnes restent modifiables ensuite.

---

## O-05 — Registre des types

### 1. La question

> **Registre des types** : les 9 questions ouvertes et les choix de fusion à valider.

Contexte (D-07, citation exacte) : « 1- oui fusionne pour le moment on adaptera plus tard ». La seule liste qui fait
foi est `docs/registre-points-ouverts.md`.

### 2. Ce que Codex fait aujourd'hui

- **69 types dans 23 familles** (`TYPES`, `FAMILIES`, `src/db/registry.ts`), modifiables dans Administration › Registre
  des types (`createType`, `updateType`, `deleteType`, `src/lib/actions.ts`).
- **Codes figés** : un code utilisé ne se renomme pas et ne se supprime pas ; `npm run registry:apply` (`src/lib/registry-apply.ts`)
  désactive un type retiré du registre et refuse un code déjà pris par un département, un projet, un programme ou
  `QMS` (`src/lib/registry-rules.ts`).
- **Clé étrangère** : `documents.type_code` pointe vers le registre ; le code du type est le premier segment de l'ID.

### 3. Les 9 questions et les choix de fusion

Les questions sont reprises de `docs/registre-points-ouverts.md` (texte abrégé ; le fichier fait foi).

| N° | Question | Ce que fait Codex | Options | Code à changer | Irréversible en production |
|---|---|---|---|---|---|
| 1 | Codes identiques à des codes de département (FIN, HSE, COM). Garder ou renommer ? | Les trois sont gardés ; tout nouveau code en collision est refusé. **Vérifié dans le code : JUR est aussi en collision** (type « Acte juridique », département « Juridique » : `JUR-JUR-0001`). Le point 117 de `docs/reste-a-faire.md` le relève ; la liste du registre ne cite que trois codes. | Garder les quatre ; renommer les types ; renommer les départements (O-04). | `src/db/registry.ts` ou `DEPARTMENTS` (`src/db/seed-org.ts`), base recréée avant la production. Après la production, nouveau code et désactivation de l'ancien. | Oui : le code entre dans les identifiants. |
| 2 | MIN, PO, HSE et VIS admettent « sans rattachement » mais leur circuit a une étape « chef de projet » : hors projet, l'étape revient au titulaire « groupe » (Marie Lefebvre). OK ? | Repli sur le titulaire sans portée (`resolveFunction`). | Confirmer ; retirer l'étape hors projet ; refuser « sans rattachement » pour ces types. | `resolveFunction` (`src/lib/actions.ts`) ou `attachments` du type. | Non. |
| 3 | « Fin de projet » pour DQF, CER, COC, HSE hors projet, et 12 types recherche : déclencheur « fin de programme » et repli sur la date de création hors projet ? | Pas de date de fin calculée (`triggerDate`, `src/lib/retention.ts`) ; aucun programme n'a de date de fin. | Ajouter « fin de programme » ; ajouter un repli ; attendre Keystone (O-03). | `RetentionTrigger` (`src/db/schema.ts`, colonne texte : pas de migration pour la valeur) ; date de fin sur `research_programs` et clôture sur `projects` (migration) ; `triggerDate`. | Non. |
| 4 | Livrables client : LDC, AVT, DEF, CLO aussi ? | Drapeau sur 14 types (MIN, COC, EXG, FDS, HMI, PID, SCH, GA, MES, RPT, HSE, REM, PV, MAN), sans aucun effet. | Compléter la liste ; dire ce que le drapeau déclenche (point 80). | Données seules, puis selon l'effet voulu. | Non. |
| 5 | COC n'admet que l'origine externe : EPC2I émet-elle ses propres déclarations CE ? | `origins: externe` seulement. | Ajouter l'origine interne ; laisser. | Données (`origins`). | Non. |
| 6 | Durées : RSQ à 40 ans pour tous ses sous-types ; RHF « départ du salarié + 5 ans » aussi pour supports de formation et fiches de poste. | Appliqué tel quel. | Voir O-07. | Données. | Non. |
| 7 | Doublons conservés : « demande d'achat » (FIN / ADC), « journal de décisions » (GOV / PIL), « RFQ » (COM / RFQ). | Les six types existent. | Garder ; supprimer un des deux (désactivé s'il est utilisé). | Données ; désactivation si utilisé. | Le code d'un type utilisé reste. |
| 8 | Clauses ISO discutables : CER 8.4.3 (8.4.2 ?), CTR 8.2 (8.4 ?). | Reprises de Keystone. | Corriger ; garder. | Données (`iso`). | Non. |
| 9 | Sous-types ajoutés hors deck à valider ; sous-types du deck repris mot pour mot. | Liste ouverte (point 59 : une valeur inconnue est gardée et listée). | Valider ; reformuler ; fermer la liste (A05). | Données ; fermeture : contrôle dans `validateFields` et l'import. | Non. |

Choix de fusion à valider (même fichier) : éclatement de « Audit & Inspection » (AUD, NCR, REC, FRM) ; MIN
transversal ; codes d'ingénierie Keystone comme types à part ; FDS = spécification fonctionnelle (les fiches de données
de sécurité en sous-type de DTF) ; PER = permis de chantier, AUT = autorisations administratives.

**Questions d'audit rattachées au registre** : M02 (document maîtrisé ou enregistrement, point 78), A05 (qui gouverne
les termes), A06 (nature ou fonction).

**Effort estimé** : données, 1 session pour `src/db/registry.ts` et `npm run registry:apply` ; plus selon les points 3
et 4 (1 à 2 sessions chacun).

**Points débloqués** : 118, 78 (avec M02), 80 (avec O-03), 96 (avec M17), 105 (avec O-03, O-07), 117 (collisions),
reste de 58 (date de fin des programmes).

### 4. Ce dont l'assistant a besoin

**Outil (18 octobre 2026)** : `npm run registry:review -- --out <dossier>` écrit `types.csv`, une ligne par type
avec la question liée (dont la question 1 : FIN, HSE, COM, JUR) et des colonnes de réponse vides ;
`-- --check <types.csv>` contrôle le cahier rempli et montre l'écart avec `src/db/registry.ts`, sans rien écrire.
Mode d'emploi : `docs/registre-points-ouverts.md`, « Valider le registre avec le cahier ».

Une réponse par numéro (1 à 9) et par choix de fusion, même brève (« OK », « non », « renommer en … »). Pour un
renommage, le nouveau code (2 ou 3 lettres, `TYPE_CODE_RE`), qui ne doit reprendre aucun autre code de type, de
département, de projet, de programme ni `QMS`.

### 5. Proposition (assistant, non validée)

Répondre au point 1 avant la production : c'est le seul des neuf qui fige des identifiants. Les autres se corrigent
plus tard dans l'Administration.

---

## O-06 — Matrice type → circuit et titulaires des fonctions

### 1. La question

> **Matrice type → circuit et titulaires des fonctions** : ce sont des valeurs de démonstration.

Contexte (D-15, citation exacte) : « Nous devons construire cela en fonction des roles et des documents mais des
workflow differents sont a prévoir, il n'y a pas a proprement parler d'autorité d'approbation cela depend des
documents. »

### 2. Ce que Codex fait aujourd'hui

- **Circuit par type** : `circuit` de chaque type (`src/db/registry.ts`), liste ordonnée de fonctions. 66 types sur 69
  en ont un ; LET, RFQ et PHO n'en ont pas (approuvés dès la demande). 33 enchaînements différents.
- **16 fonctions** (`FUNCTIONS`, `src/db/seed-org.ts`), de portée groupe, département, projet ou programme ; pas de
  portée « site ».
- **Titulaires** de démonstration (`HOLDERS`). Le mode minimal charge les fonctions **sans titulaire** : une demande de
  validation échoue alors tant que personne n'est nommé.
- **Résolution** : `resolveFunction` (`src/lib/actions.ts`) cherche un titulaire de la portée, puis le chef de projet
  ou le responsable de programme, puis un titulaire sans portée. Le demandeur, le modificateur et les auteurs des
  versions de travail sont écartés (`circuitExclusions`, `src/lib/lifecycle.ts`, proposé, non confirmé, voir O-09).
- **Délai** unique de 7 jours pour tout circuit (`requestValidationNow`, `src/lib/actions.ts`) ; étapes strictement
  séquentielles ; délégation manuelle (`delegateStep`), pas de suppléance.
- **Administration** : circuit modifiable par type (`updateType`), titulaires (`addFunctionHolder`,
  `removeFunctionHolder`), fonctions créées depuis le 15 octobre (`createFunction`).

### 3. Options

| | A. Saisir la matrice et les titulaires | B. Nouvelles fonctions ou nouvelle portée | C. Étapes parallèles, délais par étape, suppléance |
|---|---|---|---|
| **Code à changer** | Aucun : Administration, ou `src/db/registry.ts` + `npm run registry:apply` pour les circuits. | Nouvelle fonction : aucun (`createFunction`). Portée « site » : migration (`function_holders`), `resolveFunction`, dialogues. | `workflow_steps` avec rang et échéance (migration), `circuit` devient une liste d'étapes {fonction, délai, mode}, `requestValidationNow`, `decideStep`, écran Validations ; suppléance par période. |
| **Effort estimé** | Saisie ; 1 session si l'assistant charge un fichier. | 0 à 2 sessions. | 3 à 5 sessions. |
| **Irréversible en production** | Rien : les circuits lancés gardent leurs étapes. | Rien. | Rien. |

**Points débloqués** : 114, 87 (avec A07), 102 (équipe projet, avec O-03), 118 (point 2 du registre).

### 4. Ce dont l'assistant a besoin

**Outil (18 octobre 2026)** : `fonctions.csv` (fonctions, portées, titulaires de démonstration, types qui les
nomment) et la colonne « Circuit » de `types.csv` (LET, RFQ, PHO signalés sans circuit), écrits par
`npm run registry:review -- --out <dossier>` et contrôlés par `-- --check` (avec `--org` pour les personnes d'un
organigramme). Mode d'emploi : `docs/registre-points-ouverts.md`, « Valider le registre avec le cahier ».

- Un tableau type → étapes : pour chaque type (code), la liste ordonnée des fonctions qui valident.
- Pour chaque fonction : sa portée (groupe, département, projet, programme ou autre) et ses titulaires par valeur de
  portée (identifiants de personnes, O-02 et O-04).
- Le RACI demandé par M01, s'il existe.
- Si voulu : délais, étapes parallèles, suppléance (A07).

---

## O-07 — Durées de conservation par type

### 1. La question

> **Durées de conservation par type** : proposées selon les règles d'usage, non validées une à une.

Contexte (D-20, citation exacte) : « La conservation des documents sera selon les règles d'usage par type de
document. »

### 2. Ce que Codex fait aujourd'hui

- **Une règle par type** : `retention` de chaque type (`src/db/registry.ts`) : durée, déclencheur, sort final,
  fondement (FR ; EN vide pour tous les types).
- **Répartition actuelle des déclencheurs** (compte du registre) : fin de projet 26, durée de vie de l'actif 14,
  création 11, remplacement 7, clôture d'exercice 3, fin de contrat 3, expiration 2, permanent 2, départ du salarié 1.
- **Sort final** : réexamen 41, destruction 23, archivage 3, permanent 2.
- **Sans durée** : 16 types (GOV et PUB permanents ; 14 types « durée de vie de l'actif »).
- **Calcul** : `triggerDate` et `retainUntil` (`src/lib/retention.ts`). Fin de projet : non calculée (O-03). Clôture
  d'exercice : 31 décembre de l'année d'émission. Dates d'événement saisies à la main pour l'actif et le départ.
- **Par document** : dérogation (`setRetentionClass`), date d'événement (`setRetentionEvent`), répercussion de la règle
  du type sur demande (case décochée par défaut, `updateType`).
- **Rien n'est archivé ni détruit automatiquement** ; aucune action de destruction (M03).

### 3. Options

| | A. Valider les durées telles quelles | B. Corriger type par type dans Codex | C. Fournir un fichier de durées |
|---|---|---|---|
| **Code à changer** | Aucun. | Aucun : Administration › Registre ou Archivage › Règles, avec répercussion sur les documents. | `src/db/registry.ts`, puis `npm run registry:apply` (qui ne change pas la classe des documents existants : la répercussion se fait dans l'Administration). |
| **Effort estimé** | 0. | Saisie. | 1 session. |
| **Irréversible en production** | Rien tant que rien n'est détruit. La destruction, quand elle existera (M03, point 90), le sera. | Idem. | Idem. |

Sous-questions : « durée de vie de l'actif » vaut-elle 0 an après l'événement ou une durée à fixer ? Fondements à
traduire en anglais ? Validation par le DPO pour les types à données personnelles (M17) ?

**Points débloqués** : 113, 90 (avec M03), 96 (avec M17), 105 (avec O-03), 118 (point 6 du registre), 120 (avec la
date de clôture, O-04).

### 4. Ce dont l'assistant a besoin

**Outil (18 octobre 2026)** : les colonnes « Durée (ans) », « Déclencheur », « Sort final », « Fondement » et
« Fondement EN » de `types.csv` (`npm run registry:review -- --out <dossier>`) ; les 16 types sans durée y sont
signalés, et `-- --check` contrôle les valeurs saisies. Mode d'emploi : `docs/registre-points-ouverts.md`,
« Valider le registre avec le cahier ».

Pour chaque type (code) : durée en années (ou « permanent »), déclencheur (parmi les dix de `RetentionTrigger`, ou un
nouveau à nommer), sort final (détruire, réexaminer, archiver, conserver), fondement. Un tableau suffit ; une simple
mention « OK » valide la ligne existante.

---

## O-08 — Types qui admettent « Public »

### 1. La question

> **Types qui admettent « Public »** : aujourd'hui POL, REG, DTF, PUB et COL. Le registre n'a pas de type « communication », alors que c'est l'exemple donné par l'utilisateur.

Contexte (D-13, citation exacte) : « Il peut y avoir un niveau publique, pour les documents de communication par
exemple, le type publique doit être restraint a certaines famille le reste doit être a minima restraint a la diffusion
a une extreprise externe ou un client. »

### 2. Ce que Codex fait aujourd'hui

- **Règle par type** : `confAllowed` (`src/db/registry.ts`). « Public » est admis pour POL (Gouvernance & Management),
  REG (Réglementaire & Normatif), DTF (Fournisseurs / Fabricants), PUB (Résultats & diffusion) et COL (Collaboration
  externe). L'utilisateur parle de familles ; le registre l'applique type par type.
- **Effet de « Public »** : aucun de plus qu'« Interne » aujourd'hui. `canRead` (`src/lib/access.ts`) traite Public,
  Restreint et Interne de la même façon ; il n'y a pas de diffusion sans connexion (point 92).
- **Pas de type « communication »** ; le département CMN « Communication » existe. Un type créé dans l'Administration
  ne pourrait reprendre ni le code CMN (département) ni COM (type « Échange commercial »), par la règle des collisions.

### 3. Options

| | A. Confirmer la liste actuelle | B. Règle par famille | C. Créer un type « communication » |
|---|---|---|---|
| **Code à changer** | Aucun ; liste ajustable dans Administration › Registre. | Un champ par famille et un contrôle dans `validateFields` et l'import (`src/lib/importer.ts`), ou la recopie de la règle de la famille sur ses types. | Aucun : création dans Administration › Registre (`createType`), avec un code libre. |
| **Effort estimé** | 0. | 1 session. | Saisie. |
| **Irréversible en production** | Rien. | Rien. | Le code du nouveau type, dès son premier document. |

**Points débloqués** : 115 ; le sens propre de Public (diffusion sans connexion ?) est une autre question (A12, point
92).

### 4. Ce dont l'assistant a besoin

**Outil (18 octobre 2026)** : les colonnes « Niveaux admis » et « Niveau par défaut » de `types.csv`
(`npm run registry:review -- --out <dossier>`) ; les 5 types qui admettent « Public » y sont signalés. Un nouveau
type peut y être ajouté en ligne, et `-- --check` contrôle son code (collisions comprises). Mode d'emploi :
`docs/registre-points-ouverts.md`, « Valider le registre avec le cahier ».

La liste des types ou des familles qui admettent Public ; pour un type « communication », son code, sa famille, ses
sous-types, son circuit (O-06) et sa règle de conservation (O-07).

---

## O-09 — Propositions de l'assistant à confirmer

### 1. La question

> **Propositions de l'assistant à confirmer** : voir « Choix de l'assistant non validés explicitement ».

### 2. Ce que Codex fait aujourd'hui

Tous ces choix sont appliqués dans le code. La liste complète et leur détail sont dans `docs/decisions.md`, section
« Choix de l'assistant non validés explicitement », et en tête de `docs/modele-cible.md`.

### 3. Les choix, séparés selon qu'ils se figent ou non

**Irréversibles en production** : ils écrivent des identifiants, des noms ou des entrées de journal qui restent.

| Choix | Où dans le code | À retoucher en cas de refus | Effort si refusé |
|---|---|---|---|
| Code du département pour les documents sans rattachement (`PRO-QUA-0003`) | `contextOf` (`src/lib/codes.ts`) | `contextOf`, `seqWidth`, tests de `tests/unit` sur les codes | 1 session avant production ; après, les ID attribués restent |
| Code du programme pour la recherche (`PRT-R2601-004`) | `contextOf` | idem | idem |
| Code projet complet (`HLT-026`) plutôt que le code client | `contextOf` | idem, et la liaison Keystone (O-03) | idem |
| Compteur par couple (type, contexte), 3 chiffres par projet ou programme, 4 par département | `seqWidth`, `formatId` (`src/lib/codes.ts`), `nextDocId` (`src/lib/codification.ts`) | idem | idem |
| ID attribué dès la création du brouillon | `createDocument` (`src/lib/actions.ts`), `nextDocId` | création et mise en vigueur ; les brouillons existants ont un ID | 1 à 2 sessions |
| Nouvel ID avec alias en cas de reclassement avant la première approbation ; ID figé ensuite | `updateMeta` (`src/lib/actions.ts`), colonne `aliases` | `updateMeta`, import (recherche par alias), liens et demandes qui suivent le reclassement | 1 à 2 sessions |
| Journal : ce qui est écrit, et comment (consultations, détail structuré, entrées non réécrites) | `audit`, `journalConsultation` (`src/lib/lifecycle.ts`) | les règles s'appliquent aux entrées futures ; le journal en ajout seul garde les anciennes | selon le point |
| Conservation comptée par document, pas par révision remplacée (point 72) | `triggerDate` (`src/lib/retention.ts`) | `retention.ts`, `deadlines` (`src/lib/queries.ts`), Archivage | 2 sessions ; irréversible seulement une fois des fichiers détruits |

**Réversibles** : ce sont des règles de comportement ; les changer n'efface rien.

| Choix (section de `docs/decisions.md`) | Où dans le code | À retoucher en cas de refus |
|---|---|---|
| Nom de fichier `{ID}_{version}.{ext}` | `nameStoredFile`, `renameDocFiles` (`src/lib/storage.ts`) | les mêmes ; les fichiers stockés se renomment |
| « Remplacé » pour la révision précédente (D-11) | `putInForce` (`src/lib/lifecycle.ts`) | `putInForce`, statuts de révision (données à reprendre par une migration) |
| Mise en vigueur automatique à la date d'effet (D-11) | `promoteDue` (`src/lib/lifecycle.ts`), `src/lib/scheduler.ts` | les mêmes |
| Demandeur, modificateur et auteurs écartés du circuit (D-15) | `circuitExclusions` (`src/lib/lifecycle.ts`) | la même |
| Retrait accepté : circuit clos, révisions ouvertes annulées (D-17) | `applyChangeDecision` (`src/lib/lifecycle.ts`) | la même |
| Interprétations de D-26 (greffe ou attente) | `applyChangeDecision`, `graftChange` | les mêmes |
| Modificateur désigné par Vigie : droit de rédiger exigé | `mayDraft` (`src/lib/lifecycle.ts`), webhook Vigie | les mêmes |
| Rejet motivé et rappel d'une demande | `decideStep`, `recallValidation` (`src/lib/actions.ts`) | les mêmes |
| Recherches enregistrées et leur partage | `saveSearch`, `mayShareSearches` (`src/lib/access.ts`) | les mêmes |
| Facettes, période et tri de la recherche | `src/lib/search.ts` | le même |
| Pages par département | `departmentPage` (`src/lib/queries.ts`) | la même |
| Cohérence des dates | `src/lib/dates.ts` | le même |
| Expiration et revue périodique | `recordReview` (`src/lib/actions.ts`), `src/lib/review.ts` | les mêmes |
| Liens entre documents | `src/lib/links.ts`, `addDocLink` | les mêmes |
| Fiche de visa | `src/lib/approval.ts`, route `approval` | les mêmes |
| Modifications simultanées (détection optimiste ; réservation proposée, non appliquée) | `src/lib/concurrency.ts` | le même |
| Documents obsolètes ou archivés : bandeau, suffixe du nom téléchargé | route `file`, fiche | les mêmes |
| Décision Vigie sur un document verrouillé | `applyChangeDecision`, `applyPendingDecision` | les mêmes |
| « À traiter » | `myActions` (`src/lib/queries.ts`) | la même |
| Journal d'audit : lecture, valeurs masquées | `auditForReader` (`src/lib/queries.ts`) | la même |
| Administration du registre, des programmes et de l'organisation | `src/lib/registry-rules.ts`, `src/lib/org-rules.ts` | les mêmes |
| Auteur désigné ; types cibles des modèles | `updateMeta`, `setTemplateTypes` (`src/lib/actions.ts`) | les mêmes |
| Conservation par document : date d'événement, dérogation, répercussion | `setRetentionEvent`, `setRetentionClass`, `updateType` | les mêmes |
| Vocabulaires contrôlés | `src/lib/vocab.ts`, `src/lib/vocab-rules.ts` | les mêmes |
| Reprise des responsabilités d'une personne qui part | `transferHoldings`, `src/lib/transfer.ts` | les mêmes |
| Comparaison des versions ; aperçu Office | `src/lib/compare.ts`, `src/lib/office-preview.ts` | les mêmes |
| Choix d'exploitation : en-têtes, limites, formats et antivirus, flux, nettoyage, sauvegarde, journal technique, export, empreintes, erreurs, planificateur, authentification entre serveurs, migrations, amorçage | `src/lib/security-headers.ts`, `ratelimit.ts`, `filetypes.ts`, `antivirus.ts`, `orphans.ts`, `backup-core.mjs`, `log.ts`, `config-check.ts`, `full-export.ts`, `integrity.ts`, `errors.ts`, `scheduler.ts`, `server-auth.ts`, `src/db/migrations.ts`, `seed-mode.ts` | les mêmes ; la plupart se règlent déjà par variable d'environnement |
| Écarts volontaires avec la maquette ; accessibilité | écrans de `src/app/`, `src/app/globals.css` | les mêmes |
| Git : premier commit sur `codex-ged-v2` | — | sans objet |

Restes de points faits en partie qui attendent O-09 : refus d'un modèle prévu pour d'autres types (reste de 6),
réservation d'un brouillon (reste de 20), fusion de départements (reste de 62).

**Points débloqués** : 76, 72, 73 (question nouvelle à poser, liée à O-09 : quels champs d'un document en vigueur
exigent une demande), 114 (exclusions du circuit), restes de 6, 20 et 62.

### 4. Ce dont l'assistant a besoin

Pour chaque ligne : « confirmé » ou « refusé, voici la règle voulue ». Les lignes irréversibles d'abord. Une
confirmation globale (« tout ce qui n'est pas cité est confirmé ») est aussi une réponse.

### 5. Proposition (assistant, non validée)

Ne faire confirmer avant la production que le premier tableau (huit lignes). Le second peut être revu au fil de
l'usage, sans perte.

---

## O-10 — ECR/ECO dans Vigie

### 1. La question

> **ECR/ECO** : quelles étapes, dans un module à créer dans Vigie ? Comment accepter les demandes nées dans Keystone, que le webhook de Codex refuse aujourd'hui ? Faut-il faire pointer vers Vigie le module ECO de Keystone ?

Contexte : D-16 (« Je pense que les ECR/ECO doivent être centralisées dans "Vigie", quelles soient projet ou
documentaires. »), D-17 (« 4- c'est un workflow vigie »), D-18 (« les demandes doivent pouvoir etre faites depuis
codex pour les documents ou depuis keystone pour les sujets liés au projets ou au projet lui meme. »).

### 2. Ce que Codex fait aujourd'hui

- **Envoi simulé** : `submitChange` (`src/lib/vigie.ts`) fabrique la référence `ECR-AAAA-NNN` et n'écrit que la table
  miroir `change_requests`. Aucun appel à Vigie.
- **Simulation des décisions** : `simulateVigieDecision` (`src/lib/actions.ts`) tant que `VIGIE_API_URL` n'est pas
  défini (`vigieSimulated`). Définir cette variable coupe la simulation alors que rien n'est envoyé (avertissement du
  contrôle de configuration).
- **Webhook** `POST /api/integrations/vigie` (`src/app/api/integrations/vigie/route.ts`) : corps
  `{ requestId, accepted, ecoRef?, modifierId?, note? }`. Une demande inconnue de Codex reçoit **404 `not_found`** : une
  demande née dans Keystone est donc refusée.
- **Une demande = un document** : `change_requests.doc_id` unique et obligatoire, une seule demande en attente par
  document (index `change_requests_pending`), demandeur obligatoire dans `users`.
- **Envois signés prêts** : `signRequest` (`src/lib/server-auth.ts`) ; point d'extension du planificateur
  (`docs/exploitation.md` §4). Aucune file d'envoi.
- **Remplacement proposé** à la demande de retrait : gardé par Codex (`replacement_id`), non transmis à Vigie.

### 3. Options

Ce ne sont pas des options exclusives : trois chantiers, chacun avec sa décision.

| | A. Contrat complet avec Vigie | B. Demandes nées dans Keystone | C. ECO portant sur plusieurs documents |
|---|---|---|---|
| **Décision attendue** | Étapes de l'ECR/ECO (dans Vigie) ; champs envoyés et renvoyés ; retours d'avancement attendus par Vigie. | Le webhook accepte-t-il une demande qu'il ne connaît pas, avec sa description ? Qui en est le demandeur côté Codex ? | Un ECO peut-il viser plusieurs documents ? Statut par document ? |
| **Code à changer** | Client HTTP signé ; file d'envoi écrite dans la transaction de `requestChange`, envoi et reprise par le planificateur ; retours (révision ouverte, mise en vigueur, retrait appliqué) ; `vigieSimulated` à revoir ; `docs/api.md`. | Corps du webhook étendu (documents, nature, demandeur, source `keystone`) ; création de la ligne miroir puis application avec les contrôles de `requestChange`. | Table de liaison demande ↔ document (migration), index d'unicité revu, écrans et webhook. |
| **Effort estimé** | 3 à 4 sessions côté Codex. | 1 à 2 sessions. | 2 à 3 sessions. |
| **Irréversible en production** | Les références ECR : aujourd'hui Codex les fabrique ; demain Vigie les donnera. Les références déjà émises restent. | Rien. | Rien. |

La question « faire pointer vers Vigie le module ECO de Keystone » se décide dans Keystone et Vigie, pas dans Codex.

**Points débloqués** : 109, 100, reste de 38 (envois sortants).

### 4. Ce dont l'assistant a besoin

- L'accès au dépôt Vigie dans la session, ou le contrat de son API (adresses, champs, références).
- La règle pour les demandes nées dans Keystone (B) et pour les ECO multi-documents (C).
- Les secrets d'échange avec Vigie, posés en variables d'environnement.

---

## O-11 — Migration : volumes et emplacements

### 1. La question

> **Migration** : quels volumes et quels emplacements reprendre, pour l'outil séparé ?

Contexte (D-21, citation exacte) : « La migration sera faite via un code dédié fait qpecifiquement pour cette tache et
ne sera pas intégré dans codex directement ».

### 2. Ce que Codex fait aujourd'hui

- **API d'import** `POST /api/import` (`src/app/api/import/route.ts`, `src/lib/importer.ts`, `docs/api.md`), fermée
  (503) tant que `CODEX_IMPORT_TOKEN` (ou son secret de signature) n'est pas défini.
- **Un document par appel**, une seule révision (`status` : `in_force` ou `draft`), au plus une version de travail.
- **Fichier entier en mémoire**, taille maximale 50 Mo par défaut (`CODEX_MAX_FILE_MB`, 250 Mo au plus avec
  SharePoint).
- **Identifiant** : Codex attribue `TYPE-CONTEXTE-SEQ` ; l'ancienne référence (`legacyRef`) est gardée en alias et
  dans `documents.legacy_ref` (une référence qui est déjà un identifiant libre au bon format, comme dans l'export
  complet d'un autre Codex, est reprise telle quelle).
- **Non repris** : états obsolète et archivé, gel juridique, approbateurs d'origine (`legacyApproval`, point 99),
  révisions antérieures (point 106), liens entre documents.
- **Volumes inconnus** : tailles de page et index choisis sans volume réel ; mesures faites sur 10 000 documents
  synthétiques (`docs/performances.md`).

### 3. Options

| | A. API actuelle | B. Reprendre l'historique et les états | C. Lots et envoi en flux |
|---|---|---|---|
| **Ce qui est repris** | La révision en vigueur (ou un brouillon) de chaque document. | En plus : révisions remplacées, documents obsolètes ou archivés, gel, approbation d'origine. | Comme A ou B, plus vite et pour de gros fichiers. |
| **Code à changer** | Aucun. | `parseImportMeta` et l'insertion (`src/lib/importer.ts`), plusieurs révisions par document, champs `state`, `obsoleteAt`, `archivedAt`, `legalHold`, `legacyApproval` ; fiche de visa ; `docs/api.md`. | Route d'import en flux ; appel par lot ; avec SharePoint, session d'upload (point 98). |
| **Effort estimé** | 0. | 2 à 3 sessions. | 1 à 2 sessions. |
| **Irréversible en production** | Les identifiants attribués aux documents importés. | Idem. | Idem. |

**Points débloqués** : 99, 106 ; réglage des index et des pages selon le volume (point 50) ; limite de taille ;
hébergement (point 112, avec M22).

### 4. Ce dont l'assistant a besoin

- **Volumes** : nombre de documents, taille totale, taille du plus gros fichier, croissance annuelle (M18).
- **Emplacements** : où sont les documents aujourd'hui (l'audit cite comme exemples SharePoint ou Teams et des serveurs
  de fichiers ; rien n'est confirmé).
- **Périmètre** (A23) : versions en vigueur seulement, ou aussi historique et documents périmés ; critères des vagues.
- **Statut** d'un document migré (A23 : « Quel statut reçoit un document migré ? »), et confirmation de la règle
  d'identifiant ci-dessus (ID Codex neuf, ancienne référence en alias).

---

## Annexe A — Questions de l'audit sans numéro O

Questions de `docs/audit-deck-epc2i.md` restées ouvertes ou répondues en partie, qui bloquent des points de
`docs/reste-a-faire.md`. On peut les poser en citant leur référence.

| Réf. | Question (abrégée) | État actuel | Ce qu'elle débloque |
|---|---|---|---|
| M22 | Délai de reprise, perte de données tolérée, lieu d'hébergement, export complet ? | Ouvert. Sauvegarde, restauration et export complet faits ; fréquence, lieu, chiffrement non fixés. | 112 ; restes de 38, 48, 49, 51 |
| M02 | Quels types sont des enregistrements figés dès le dépôt ? Registres continus ? | Ouvert. | 78 |
| M03 | Qui valide la destruction, quelle trace ? | Ouvert. Gel juridique fait ; aucune destruction. | 90 (avec O-07), 96 |
| M04 | Signature électronique : types, niveau eIDAS, prestataire ? | Ouvert. Champ `sign` jamais activé. | 95 |
| M05 | Quels événements tracer, combien de temps, qui lit le journal ? | Ouvert. Journal étendu (consultations) ; durée et lecteurs non décidés. | 91 |
| M06 | Diffusion à la publication, accusé de lecture, copie non maîtrisée ? | Ouvert. | 75 |
| M07 / P08 | Partage avec l'extérieur, registre des transmissions, accusé de réception client ? | Ouvert en partie (fiche de visa faite). | 94, 80 |
| M08 | Capture des e-mails ? | Ouvert. | 107 |
| M09 / M10 | Numérisation, OCR, valeur probante ; recherche dans le contenu ? | Ouvert. | 85, 82 |
| M11 | Autres relations entre documents, obligatoires ? | Ouvert en partie (« remplace », « voir aussi » faits). | 107 (pièces jointes) |
| M12 | PDF/A, formats par type, filigrane, en-têtes générés ? | Ouvert. Liste blanche commune et aperçu Office faits. | 86, 83 |
| M13 | Indicateurs, pour qui, à quelle fréquence ? | Ouvert. | 77 |
| M14 | Pilote, utilisateurs clés, formation, date d'interdiction des dépôts hors GED ? | Ouvert. Aide `/aide` faite. | reste de 69 |
| M17 | Types à données personnelles, durées, validation par le DPO ? | Ouvert. | 96 |
| M19 | Qui alerter, combien de temps avant, escalade ? | Répondu en partie (échéances dans l'application). | 104 |
| M23 | Accès terrain et mobile, hors ligne ? | Ouvert. | 79 |
| A05 | Qui crée, renomme, retire un terme ? | Ouvert. Droit « Administrer » en attendant. | registre et vocabulaires (points 59, 61 faits avec cette réserve) |
| A07 | Délais, étapes parallèles, délégations ? | Répondu en partie (D-15). | 87 |
| A12 / A13 | Qui voit, télécharge, partage par niveau ; révisions remplacées et obsolètes ? | Répondu en partie (échelle D-13, brouillons D-14). | 92 ; consultation des documents obsolètes ou archivés (P07) |
| A15 | Obligations de l'auteur et du propriétaire ; remplaçant par défaut au départ ? | Ouvert. Reprise manuelle faite. | règle par défaut du point 19 |
| A17 | Date d'émission d'un document externe ; effet de l'expiration ? | Répondu en partie. | 71, 70 |
| A18 | Traductions : document distinct ou variante ? Langues ? | Ouvert. | 81 |
| A21 | Mots-clés : thésaurus fermé ou libre ? | Ouvert. Vocabulaire géré à liste ouverte fait. | fermeture éventuelle de la liste |
| A22 | Modèles du lancement ; en-tête prérempli ? | Répondu en partie. | 83 ; 119 (données) |
| A23 | Vagues, historique, documents périmés à migrer ? | Répondu en partie (D-21). | 99, 106 (avec O-11) |
| A24 | Listes de valeurs des champs de niveau 4, champs obligatoires ? | Répondu en partie. | 74 |
| C11 / G43 | Garder ou écarter le champ « sens entrant / sortant » ? | Résolu en partie par D-08 ; l'utilisateur ne s'est pas prononcé. | 70 |
| P04 / Q06 | Frontière avec Vigie, Cursus, SolidWorks PDM, Sage X3 : GED maître, copie ou lien ? | Traité en partie (ECR/ECO dans Vigie). | 108 |

## Annexe B — Nombre de points débloqués par question

Compte fait le 18 octobre 2026 dans `docs/reste-a-faire.md`, refait le même jour (lot 10, étape 4) après la
correction de son état récapitulatif. C'est un constat, pas une recommandation : un point peut dépendre de plusieurs
questions, et une réponse ne suffit pas toujours à le débloquer.

Chaque point est rattaché aux questions que citent sa ligne « Références » et son constat ; l'état récapitulatif en
tête de `docs/reste-a-faire.md` suit désormais la même règle, et les deux colonnes « Points » disent la même chose. La
dernière colonne ne garde que la ligne « Références », pour montrer d'où vient chaque rattachement.

| Question | Points (Références et constat) | Restes de points faits en partie | Total | Dont la ligne Références cite la question |
|---|---|---|---|---|
| O-01 | 84, 86, 88, 98, 103 (5) | 36, 46, 48, 50 (4) | 9 | 84, 86, 88, 98, 103 (5) |
| O-02 | 79, 89, 93, 94, 104, 107, 117 (7) | 69 (1) | 8 | 89, 93, 94, 104, 107, 117 (6) ; 79 par son constat |
| O-03 | 80, 97, 101, 102, 105, 110, 111 (7) | 38, 51 (2) | 9 | les 7 |
| O-04 | 89, 92, 96, 116, 117, 120 (6) | 62 (1) | 7 | les 6 |
| O-05 | 78, 80, 96, 105, 117, 118 (6) | 58 (1) | 7 | 78, 80, 96, 105, 118 (5) ; 117 par son constat (question 1) |
| O-06 | 87, 102, 114, 118 (4) | — | 4 | 87, 102, 114 (3) ; 118 par son constat (question 2) |
| O-07 | 90, 96, 105, 113, 118, 120 (6) | — | 6 | 90, 96, 105, 113, 120 (5) ; 118 par son constat (questions 3 et 6) |
| O-08 | 115 (1) | — | 1 | 115 (1) |
| O-09 | 72, 73, 76, 114 (4) | 6, 20, 62 (3) | 7 | 72, 73, 76 (3) ; 114 par son constat (exclusion de l'auteur) |
| O-10 | 100, 109 (2) | 38 (1) | 3 | 100, 109 (2) |
| O-11 | 99, 106 (2) | 46, 50 (2) | 4 | 99, 106 (2) |

Corrigé le 18 octobre 2026 (lot 10, étape 4) : l'état récapitulatif comptait aussi 73, 78, 79, 82, 86, 107 et 112 sous
O-01 (11 points, 15 avec les restes) et sous O-11 (9 points). Leurs références citent d'autres questions : 73 (G09,
WFL-04, O-09), 78 (M02, O-05), 79 (M23, O-02), 82 (M10), 86 (M12 et O-01 pour le moteur de conversion), 107 (M08,
O-02), 112 (M22) ; seul 86 reste sous O-01, aucun sous O-11. 82 et 112 n'attendent qu'une question de l'audit (M10,
M22). Les restes de 46 (import par morceaux, avec 106) et de 50 (volume réel, M18) citent O-11 et y sont ajoutés. La
fiche O-11 cite le point 112 (hébergement) parmi ce que les volumes éclairent : il attend M22 et n'est pas compté sous
O-11.
