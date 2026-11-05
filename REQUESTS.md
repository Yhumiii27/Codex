# Requêtes inter-applications
Format d'une entrée :
## [YYYY-MM-DD] <app demandeuse> → <cette app> — <titre court>
- Statut : OUVERTE | ACCEPTÉE | REFUSÉE | FAITE
- Demande : (quoi)
- Justification : (pourquoi, impact sur l'app demandeuse)
- Détails techniques : (tables, champs, types, endpoints, exemples)
- Validé par Guillaume le : (date)

## [2026-10-22] Arche → Codex — Rattacher un document à un CAPEX et ajouter les types de documents d'un CAPEX (CX-01, CX-02)
- Statut : FAITE
- Demande : (CX-01) un rattachement `capex` à côté de `none | project | research` (contexte = code CAPEX, identifiants du type `PID-CPX-APM-2026-01-001`), alimenté par la vue `arche.pub_capex` ; ou, à défaut, un CAPEX traité comme un projet dans `codex.projects`. (CX-02) au registre des types (nouveaux types ou sous-types de `AUT`, `RSQ`, `DEF`, `PLN`, `PV`, `REM`, `CLO`) : plan de masse, HazID, HazOp / AMDEC, zonage ATEX (DRPCE), dossier ICPE, permis de construire / PLU, AFE, PSSR (et RSPDI), audit ASPD, business plan / dossier d'investissement, PV de transfert d'actif, dossier de jalon DIG-PRODI (G1, G2, G3).
- Justification : Codex héberge tous les documents d'Arche (décision du 22 oct. 2026) ; les documents d'un CAPEX (P&ID d'usine, plan de masse, permis, AFE, PV de transfert…) n'appartiennent à aucun projet EPC2i, et les dossiers vivants et le pack ingénierie d'Arche citent des pièces que le registre n'a pas (O-05). Sans cela, ces documents n'ont pas de contexte propre et Arche ne peut que garder des références libres.
- Détails techniques : `arche.pub_capex` (droit à accorder à `codex_app` par Matrix) : `code`, `filiale_code`, `filiale`, `zone`, `site`, `intitule`, `statut`, `phase_code`, `maj_le`. Arche garde l'identifiant `TYPE-CONTEXTE-SEQ`, la lettre de révision et le lien `/documents/{id}`. Détail : `docs/DEMANDES-CODEX.md` du dépôt Arche.
- Validé par Guillaume le : 2026-10-22
- Réponse de Codex (2026-10-23) : non traitée, elle attend deux décisions de Guillaume. CX-01 : rattachement `capex` propre ou CAPEX traité comme un projet (les deux options de la demande ; touche le modèle de classement « origine et rattachement » et la liaison avec Arche, O-03). CX-02 : ajout de types ou de sous-types au registre, arbitrages du registre encore ouverts (O-05).
- Réponse de Codex (2026-11-05) : faite selon les choix du 1er novembre (entrée du 2026-11-01 ci-dessous) : rattachement `capex` propre (CX-01) et sous-types des types existants (CX-02).

## [2026-10-22] Arche → Codex — API de dépôt, état d'un document et version figée (CX-03, CX-04, CX-07)
- Statut : FAITE
- Demande : (CX-03) une API pour qu'une autre application crée un document (type, rattachement, titre, confidentialité, propriétaire) avec son fichier et reçoive son identifiant, idempotente par référence d'origine (`arche:<objet>`), authentifiée par clé signée comme `POST /api/import` ; (CX-04) une lecture de l'état d'un document par identifiant (révision en vigueur, statut, circuit en cours), par API ou dans `pub_documents` / `pub_validations` ; (CX-07) un dossier de jalon déposé par Arche (signé, empreinte SHA-256 connue d'Arche) reste en l'état (révision approuvée d'office ou conservation légale).
- Justification : Arche fige et fait signer un dossier à chaque jalon (G1, G2, G3) et doit en déposer la version PDF ; il affiche l'état « validé / en revue » des pièces du pack ingénierie. Sans API, l'utilisateur dépose lui-même le PDF dans Codex puis colle son identifiant dans Arche (fonctionnement actuel) ; la preuve d'une décision de jalon n'est pas protégée contre une modification.
- Détails techniques : exemple de dépôt `POST /api/documents` `{ "origin": "arche:dossier/CPX-APM-2026-01/business_case/v2", "type": "DOS", "attachment": { "kind": "capex", "code": "CPX-APM-2026-01" }, "title": "Business Case — Cadrage, v2", "confidentiality": "interne", "owner": "l.haddad@…", "sha256": "…" }` + fichier ; réponse `{ "id": "DOS-CPX-APM-2026-01-001", "revision": "A", "url": "/documents/DOS-CPX-APM-2026-01-001" }`.
- Validé par Guillaume le : 2026-10-22
- Réponse de Codex (2026-10-23) :
  - CX-03 FAITE : `POST /api/documents` (`docs/api.md`, « POST /api/documents »). Écarts avec l'exemple : la référence d'origine s'appelle `sourceRef` (`origin` est déjà l'origine interne / externe du document) ; le propriétaire se donne par `ownerId` (identifiant Codex) ou `ownerMatricule` (`EMP-…`), pas par adresse e-mail (Codex n'en garde pas) ; la réponse donne `href` (le lien `/documents/{id}`). Le document naît en brouillon A.1 et passe par un circuit ; le rattachement `capex` attend CX-01, d'ici là `attachment` vaut `none`, `project` ou `research`. Jeton et secret propres : `CODEX_DOCUMENTS_TOKEN`, `CODEX_DOCUMENTS_SECRET`, à poser dans Codex et à donner à Arche. Rejouable : la même `sourceRef` avec le même fichier rend le document déjà créé (200).
  - CX-04 FAITE, sans nouvelle API : l'état se lit dans `codex.pub_documents` (`status`, `rev_in_force`, `rev_working`), `codex.pub_revisions_document` et `codex.pub_validations` (circuit en cours), déjà accordées à Arche (CX-05). Détail : `docs/api.md`, « Lire l'état d'un document ».
  - CX-07 OUVERTE : attend une décision de Guillaume. Une révision « approuvée d'office » contournerait la règle « révisions validées par un circuit » (`docs/decisions.md`) ; l'autre option, la conservation légale (gel juridique, `legal_hold`), est à choisir aussi. En attendant, l'empreinte `sha256` envoyée au dépôt est vérifiée et gardée sur la version de travail A.1.
  - CX-07 FAITE le 2026-11-05, par la conservation légale (choix du 1er novembre, entrée du 2026-11-01 ci-dessous) : `legalHold: true` au dépôt.

## [2026-10-22] Arche → Codex — Accès des utilisateurs des filiales et lien profond stable (CX-06, CX-08)
- Statut : OUVERTE
- Demande : (CX-06) donner aux utilisateurs des filiales l'accès aux documents de leurs CAPEX dans Codex (organigramme O-04 avec les filiales, confidentialité) ; (CX-08) confirmer que le lien `/documents/{id}` (qui résout aussi les alias) reste le contrat des liens profonds.
- Justification : Arche ouvre chaque document cité dans un dossier vivant par un lien vers Codex ; un utilisateur de filiale doit pouvoir l'ouvrir. Sans cela, le lien mène à un refus d'accès dans Codex.
- Détails techniques : filiales et sites publiés par Matrix (`matrix.pub_filiales`, `matrix.pub_sites`, décision D21) ; les lectures d'Arche sur `codex.pub_documents`, `pub_revisions_document`, `pub_validations`, `pub_types_document` sont déjà accordées par Matrix (CX-05 fait).
- Validé par Guillaume le : 2026-10-22
- Réponse de Codex (2026-10-23) :
  - CX-06 OUVERTE : attend l'organigramme avec les filiales (O-04) et le fournisseur d'authentification (O-02).
  - CX-08 FAITE : `/documents/{id}` est le contrat des liens profonds ; il résout aussi les anciens identifiants (alias) et redirige vers l'identifiant actuel. Garanti par `tests/integration/deep-link.test.ts`, écrit dans `docs/api.md`, « Lien profond ».


## [2026-10-30] Matrix → Codex — M-17 : accès entre outils décidés par Matrix (plus de copie de vue, écritures par API ou fonction `pub_`)
- Statut : FAITE
- Demande : appliquer dans Codex la décision M-17 de Matrix (`docs/decisions.md` et `docs/architecture-postgres.md` § 8 sexies du dépôt Matrix) :
  1. **Lire** les données d'un autre outil uniquement par ses vues `pub_` (R2), jamais par ses tables ;
  2. **Écrire** chez un autre outil uniquement par son API ou par une fonction `pub_` qu'il fournit (R4), jamais par `INSERT` / `UPDATE` / `DELETE` dans son schéma ;
  3. pour un **nouvel échange**, ne plus demander à Matrix de recopier une vue dans `partage/` : la migration de Codex reste la seule définition de ses vues `pub_` (R3), et le besoin d'accès se déclare comme un lien du registre `matrix.liens` (R5) — en attendant l'API `POST /api/liens` (lot M17-4), par une entrée courte dans le `REQUESTS.md` de Matrix : lecteur, objet (`schéma.pub_…`), nature (`lecture` ou `execution`), justification ;
  4. pour une **écriture qu'un autre outil doit faire chez Codex** : lui fournir une API, ou une fonction `pub_<verbe>_<objet>` créée par migration (`SECURITY DEFINER`, `SET search_path = <schéma>, pg_temp`, appelant identifié par `session_user`, règles et journal de Codex appliqués, `REVOKE EXECUTE … FROM PUBLIC` ; § « Fonctions pub_ » de la note) ;
  5. reprendre ces règles dans le `CLAUDE.md` de Codex et dans ses documents de demandes à Matrix, et faire l'inventaire de ses échanges (point de départ ci-dessous), en signalant à Matrix tout accès qui n'y serait pas conforme.
- Justification : décision du responsable produit du 30/10/2026 (M-17) : Matrix décide de chaque accès d'un outil aux données d'un autre, PostgreSQL l'applique. Les vues `pub_` restent les contrats de lecture, mais leur copie par Matrix (quatre étapes par échange, dont deux à la main) disparaît, et l'écriture entre outils devient possible sous le contrôle de Matrix sans contourner les règles métier du propriétaire.
- Détails techniques : relevé du 30/10/2026 sur `main` de Codex (requêtes SQL vers d'autres schémas) : aucune lecture SQL d'un autre schéma ; écritures reçues par API (dépôt `POST /api/documents` d'Arche, webhook de Vigie) : conformes à R4. Toutes ces lectures passent déjà par des vues `pub_` et aucune écriture directe dans un autre schéma n'a été trouvée : aucune correction urgente. Les vues, droits et fichiers de partage actuels restent en place pendant la transition (lots M17-1 à M17-5 côté Matrix) ; une vue `pub_` existante ne change pas.
- Validé par Guillaume le : 2026-10-30
- Réponse de Codex (2026-11-01) :
  - Règles reprises dans `CLAUDE.md` (« Échanges entre outils sur le serveur commun ») et dans `docs/postgres.md` (« Échanges avec les autres outils »), avec la modification de M-18 : une nouvelle vue `pub_` de Codex se demande à Matrix au lieu de s'écrire dans une migration.
  - Inventaire (code de `main`, `796e315`) : aucune lecture SQL d'un autre schéma (Keystone et Vigie restent simulés par des tables de Codex) ; écritures sortantes par API seulement (déclaration du schéma à Matrix) ; écritures reçues par API (`POST /api/documents`, `POST /api/integrations/vigie`, `POST /api/import`) ; lectures reçues par `GET /api/registry` et par les 8 vues `codex.pub_*`. Tout est conforme à R2 et R4 : aucun accès à signaler à Matrix.
  - Codex ne fournit pas encore de fonction `pub_` : aucune écriture reçue ne s'y prête (toutes passent par une API). Le retrait des vues des migrations de Codex attend la demande de Matrix au titre de M-18 (lot P5).

## [2026-11-01] Matrix → Codex — M-18 : Matrix définit vos vues `pub_` et décide de vos écritures croisées (plus de vue `pub_` dans vos migrations)
- Statut : FAITE
- Demande : appliquer dans Codex la décision M-18 de Matrix (`docs/decisions.md` et `docs/architecture-postgres.md` § 8 septies du dépôt Matrix), qui **remplace le point 3 de la demande M-17** du 30/10/2026 (« la migration reste la seule définition des vues `pub_` ») :
  1. **ne plus créer, modifier ni supprimer de vue `pub_` dans vos migrations** (les migrations déjà appliquées ne changent pas) : une nouvelle publication, ou une colonne de plus, se demande à Matrix, qui la définit dans son écran « Publications » (`matrix.publications`) et l'applique lui-même (rôle `matrix_gestion`). Votre migration crée les tables et colonnes ; la vue est celle de Matrix ;
  2. **avant de modifier ou de supprimer une colonne lue par une vue `pub_`**, le signaler à Matrix (entrée dans son `REQUESTS.md`) : la migration échouerait, la vue en dépend. Une colonne publiée ne se retire ni ne se renomme ; un changement incompatible passe par une vue `…_v2` ;
  3. **écritures que d'autres outils font chez vous** : votre API reste permise ; pour une écriture en SQL, fournir une fonction `pub_<verbe>_<objet>` créée par migration (`SECURITY DEFINER`, `SET search_path = <schéma>, pg_temp`, appelant identifié par `session_user`, vos règles et votre journal appliqués, `REVOKE EXECUTE … FROM PUBLIC`). Le droit de l'exécuter est un lien « écriture » décidé dans Matrix ; une fonction exécutable par tous est signalée en erreur par `droits.verifier()` ;
  4. **vos besoins chez les autres** (lecture d'une vue, exécution d'une fonction) se déclarent comme liens dans Matrix (écran « Liens entre outils » ou entrée courte dans son `REQUESTS.md` : outil, objet `schéma.pub_…`, nature `lecture` ou `execution`, justification), plus par une demande de copie de vue ;
  5. reprendre ces règles dans votre `CLAUDE.md`, puis passer cette entrée à FAITE : Matrix reprend alors vos vues `pub_` (`partage/14-reprise-publications.sql` : elles passent au rôle `matrix_gestion`, leurs lecteurs gardent leur droit).
- Justification : décision du responsable produit du 01/11/2026 (M-18) : « matrix [doit] être le seul outil qui permette d'administrer la base de données postgre […] c'est matrix qui doit avoir la main sur ce que chaque outil publie, lie, écrit ». Matrix est en place (lots P1 à P4 fusionnés le 01/11/2026 : rôle `matrix_gestion`, registre et écran « Publications », liens appliqués tout de suite, liens d'écriture). Tant que la reprise n'est pas faite, rien ne change pour Codex ; après la reprise, une migration qui recréerait une vue `pub_` échouerait (« must be owner of view »), d'où le point 1 d'abord.
- Détails techniques : vues de Codex reprises par Matrix : pub_circuits_type, pub_documents, pub_journal, pub_programmes_recherche, pub_revisions_document, pub_titulaires_fonction, pub_types_document, pub_validations (8 vues). Écritures reçues d'autres outils : décision de Vigie sur une demande de modification (webhook, flux F05) : API, conforme, rien à changer. Une vue reprise garde son nom, ses colonnes, son commentaire et ses lecteurs ; seule sa propriété change. Contrôles : `droits.verifier()` (vue `pub_` encore à l'outil : attention, « pas encore reprise »). Pour un essai local (PGlite, base de démonstration), vos migrations anciennes continuent de créer les vues : seule une **nouvelle** migration ne doit plus en créer ni en modifier.
- Validé par Guillaume le : 2026-11-01
- Réponse de Codex (2026-11-01) :
  - Points 1 et 2 : règles reprises dans `CLAUDE.md` (« Échanges entre outils sur le serveur commun ») et `docs/postgres.md` (« Échanges avec les autres outils ») ; `tests/unit/migrations.test.ts` refuse désormais toute vue `pub_` (création, modification, commentaire, suppression) dans une migration postérieure à `0002`. `0001_partage` et `0002_pub_programmes_recherche` ne changent pas.
  - Point 3 : écritures reçues (décision de Vigie, dépôt d'Arche, import) par API ; aucune fonction `pub_` à fournir.
  - Point 4 : aucun besoin de lecture ou d'écriture chez les autres outils aujourd'hui.
  - Vérifié : au démarrage, Codex ne recrée ni ne modifie aucune vue (`openDb()` ne repose que ses fonctions et déclencheurs) et l'export complet ne lit que les tables : Matrix peut reprendre les 8 vues `codex.pub_*`.


## [2026-11-01] Arche → Codex — Décisions de Guillaume sur CX-01, CX-02 et CX-07 (rattachement CAPEX, sous-types, conservation légale)
- Statut : FAITE
- Demande : réaliser CX-01, CX-02 et CX-07 (entrées du 22 oct. 2026 ci-dessus) selon les choix du responsable produit du 1er nov. 2026 :
  1. **CX-01 — rattachement `capex` propre** (et non un CAPEX traité comme un projet) : 4ᵉ rattachement à côté de `none`, `project`, `research` ; contexte de l'identifiant = code CAPEX (`PID-CPX-APM-2026-01-001`) ; liste des CAPEX lue dans `arche.pub_capex` ; au dépôt (`POST /api/documents`) : `attachment: "capex"` et `capexCode: "CPX-…"` ;
  2. **CX-02 — sous-types des types existants** (et non de nouveaux types) ajoutés au registre, graphie ci-dessous : `GA` → Plan de masse ; `RSQ` → HazID, HazOp / AMDEC, Zonage ATEX (DRPCE), PSSR / RSPDI, Audit ASPD ; `AUT` → Dossier ICPE, Permis de construire / PLU ; `FIN` → AFE (autorisation de dépense) ; `DEF` → Business case (existe), Dossier d’investissement, Dossier de jalon G1, Dossier de jalon G2, Dossier de jalon G3 ; `REM` → PV de transfert d’actif ;
  3. **CX-07 — conservation légale** (et non une révision approuvée d'office) : au dépôt d'un dossier de jalon, `legalHold: true` place le document sous gel juridique (ni modification ni suppression, levée par l'archiviste de Codex seulement), sans contourner la règle « révisions validées par un circuit ».
- Justification : les documents d'un CAPEX (P&ID d'usine, permis, AFE, PV de transfert, dossiers de jalon) n'appartiennent à aucun projet EPC2i ; ils sont aujourd'hui déposés au contexte du département du propriétaire. La preuve d'une décision G1 / G2 / G3 (version figée, SHA-256 connue d'Arche) doit rester en l'état. Côté Arche, c'est prêt (Yhumiii27/Arche#45, fusionnée) : le formulaire de dépôt propose ces sous-types (champ `subtype`, déjà accepté), une version figée part en `DEF` « Dossier de jalon G1/G2/G3 », et `attachment: "capex"`, `capexCode` et `legalHold: true` seront envoyés dès que Codex les accepte (réglage `CODEX_CAPEX=on` côté Arche, coupé tant que Codex refuse les champs inconnus).
- Détails techniques : lecture de `arche.pub_capex` par `codex_app` (colonnes `code`, `filiale_code`, `filiale`, `zone`, `site`, `intitule`, `statut`, `phase_code`, `maj_le`) : lien à déclarer à Matrix (décision M-18). Champs de dépôt proposés, à ajouter au contrat de `POST /api/documents` (`docs/api.md`) : `attachment` (`capex`), `capexCode` (code connu de `arche.pub_capex`), `legalHold` (booléen, gel posé à la création). Rejouable comme aujourd'hui (`sourceRef`). CX-06 (accès des filiales) reste suspendue à O-04 et O-02. Détail : `docs/DEMANDES-CODEX.md` du dépôt Arche (section du 1er nov. 2026).
- Validé par Guillaume le : 2026-11-01
- Réponse de Codex (2026-11-05) ; accord de Guillaume pour la traiter : « traite les demande d'Arche » :
  - CX-01 FAITE : rattachement `capex` (`documents.capex_code`, migration `0003_capex`) ; identifiant `TYPE-<code CAPEX>-SEQ` sur 3 chiffres (`PID-CPX-APM-2026-01-001`) ; admis par chaque type qui admet `project`, et par `FIN` (AFE). Liste des CAPEX : miroir `codex.capex` rafraîchi toutes les 15 minutes depuis `arche.pub_capex` (tâche planifiée « CAPEX publiés par Arche », `CODEX_SCHEDULE_CAPEX`) ; un CAPEX qu'Arche ne publie plus devient inactif, ses documents le gardent. Au dépôt : `attachment: "capex"` et `capexCode` (`capex_required`, `capex_unknown`) ; à l'écran : choix du CAPEX dans « Nouveau document » et dans les métadonnées. **Reste à accorder par Matrix** : la lecture de `arche.pub_capex` par `codex_app` (lien du registre de Matrix) ; d'ici là, la tâche est « sautée » et aucun CAPEX n'est proposé sur le serveur commun.
  - CX-02 FAITE : sous-types ajoutés au registre dans la graphie demandée (`src/db/registry.ts`, et par la migration `0003_capex` sur une base existante, sans toucher aux sous-types réglés dans l'Administration). « Business case » existait déjà sous `DEF`.
  - CX-07 FAITE : `legalHold: true` au dépôt pose le gel juridique dès la création (journal « Gel juridique » sous `codex`), le document reste un brouillon A.1 ; la réponse 201 porte `"legalHold": true`. Levée par une personne qui a le droit Archiver (gestionnaires documentaires).
  - `docs/api.md` (« POST /api/import », « POST /api/documents ») décrit les nouveaux champs. La colonne `capex_code` n'est dans aucune vue `pub_` : si Arche veut la lire dans `pub_documents`, c'est une publication à demander à Matrix (M-18).

## [2026-11-05] Matrix → Codex — M-19 · Fonction d'édition `codex.pub_editer` : corriger les données de Codex depuis Matrix, par vos règles
- Statut : FAITE
- Demande : fournir, par une migration de Codex, la fonction
  `codex.pub_editer(p_table text, p_action text, p_cle jsonb, p_valeurs jsonb, p_par text, p_motif text) RETURNS jsonb`
  (`SECURITY DEFINER`, `SET search_path = codex, pg_temp`, `REVOKE EXECUTE … FROM PUBLIC`), qui ajoute, corrige ou retire une ligne
  d'une table de Codex en appliquant vos règles et votre journal :
  - `p_action` = `ajouter` | `corriger` | `retirer` (un retrait peut être un archivage) ; `p_cle` = clé primaire de la ligne
    (null pour `ajouter`) ; `p_valeurs` = colonnes à écrire (null pour `retirer`) ;
  - `p_par` = nom de la personne connectée à Matrix (Microsoft Entra ID, rôle Administrateur) ; `p_motif` = motif saisi
    (obligatoire) ;
  - refus par `RAISE EXCEPTION` (message montré tel quel dans Matrix) ; la fonction renvoie la ligne après modification,
    sans colonne sensible ;
  - elle refuse les tables que Codex ne veut pas ouvrir et toute colonne de `droits.colonnes_sensibles` (Matrix ne les
    transmet jamais, mais la fonction ne doit pas en dépendre) ;
  - règle propre à Codex à respecter : règles documentaires (identifiants `TYPE-CONTEXTE-SEQ` immuables, révisions validées par un circuit) : une table qui en dépend reste fermée ou passe par sa règle.
  Une fonction par table (`codex.pub_editer_<table>`, mêmes paramètres sans `p_table`) reste possible et passe avant la
  générique. Une fois la migration passée, passer cette entrée à FAITE : la DSI autorise alors le lien d'écriture dans Matrix.
- Justification : décision M-19 du 05/11/2026 (responsable produit) : « pour le moment, l'admin IT peut modifier toutes les
  données à l'exception des données sensibles RGPD », **par les outils** : Matrix n'écrit jamais lui-même dans vos tables
  (M-18) ; la DSI corrige depuis la visionneuse de Matrix, Codex garde ses règles et son journal.
- Détails techniques : convention complète et exemple dans `docs/edition-par-les-outils.md` du dépôt Matrix. Le droit
  d'exécution est un lien « écriture » `matrix_app` → `codex.pub_editer`, décidé dans Matrix (« Liens entre outils ») et posé
  par `droits.accorder_execution` ; `droits.verifier()` signale une fonction `pub_` exécutable par tous ou sans
  `search_path` fixé. Rien ne change pour Codex tant que la fonction n'existe pas : la visionneuse reste en lecture seule.
- Validé par Guillaume le : 2026-11-05
- Réponse de Codex (2026-11-05) ; accord de Guillaume : « traite la demande M-19 » :
  - Fonction générique `codex.pub_editer(p_table, p_action, p_cle, p_valeurs, p_par, p_motif) RETURNS jsonb` créée par la migration `0004_pub_editer` (`SECURITY DEFINER`, `SET search_path = codex, pg_temp`, `REVOKE EXECUTE … FROM PUBLIC`).
  - Tables ouvertes, avec les règles de l'Administration de Codex : `departments` (clé `{"code"}` ; colonnes `code` à l'ajout, `label_fr`, `label_en`, `active` ; le code ne change jamais ; « retirer » = inactif ; un département actif au moins), `sites` (clé `{"key"}` ; `key` à l'ajout, `label_fr`, `label_en`, `active` ; « retirer » = inactif), `research_programs` (clé `{"code"}` ; `code` à l'ajout, `name`, `manager_id`, `active` ; « retirer » = clos), `function_holders` (clé `{"id"}` ; `function_key`, `scope_value`, `user_id` à l'ajout ; pas de « corriger » ; « retirer » supprime le titulaire). Codes de département et de programme libres dans l'espace des codes d'identifiant (types, projets, programmes, CAPEX, `QMS`) ; titulaire dont le rôle peut approuver.
  - Toute autre table est refusée par un message qui le dit (documents, révisions, circuits et journal suivent les règles documentaires ; personnes : données personnelles) ; colonne inconnue ou de `droits.colonnes_sensibles` refusée ; motif et personne obligatoires.
  - Journal de Codex : chaque modification sous l'acteur système `matrix`, avec la personne et le motif (« depuis Matrix, par … — motif : … » dans Administration › Journal d'audit).
  - À faire dans Matrix : autoriser le lien « écriture » `matrix_app` → `codex.pub_editer` (« Liens entre outils »). La fonction existe sur le serveur commun dès le déploiement de cette version.

