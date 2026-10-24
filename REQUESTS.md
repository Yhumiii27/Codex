# Requêtes inter-applications
Format d'une entrée :
## [YYYY-MM-DD] <app demandeuse> → <cette app> — <titre court>
- Statut : OUVERTE | ACCEPTÉE | REFUSÉE | FAITE
- Demande : (quoi)
- Justification : (pourquoi, impact sur l'app demandeuse)
- Détails techniques : (tables, champs, types, endpoints, exemples)
- Validé par Guillaume le : (date)

## [2026-10-22] Arche → Codex — Rattacher un document à un CAPEX et ajouter les types de documents d'un CAPEX (CX-01, CX-02)
- Statut : OUVERTE
- Demande : (CX-01) un rattachement `capex` à côté de `none | project | research` (contexte = code CAPEX, identifiants du type `PID-CPX-APM-2026-01-001`), alimenté par la vue `arche.pub_capex` ; ou, à défaut, un CAPEX traité comme un projet dans `codex.projects`. (CX-02) au registre des types (nouveaux types ou sous-types de `AUT`, `RSQ`, `DEF`, `PLN`, `PV`, `REM`, `CLO`) : plan de masse, HazID, HazOp / AMDEC, zonage ATEX (DRPCE), dossier ICPE, permis de construire / PLU, AFE, PSSR (et RSPDI), audit ASPD, business plan / dossier d'investissement, PV de transfert d'actif, dossier de jalon DIG-PRODI (G1, G2, G3).
- Justification : Codex héberge tous les documents d'Arche (décision du 22 oct. 2026) ; les documents d'un CAPEX (P&ID d'usine, plan de masse, permis, AFE, PV de transfert…) n'appartiennent à aucun projet EPC2i, et les dossiers vivants et le pack ingénierie d'Arche citent des pièces que le registre n'a pas (O-05). Sans cela, ces documents n'ont pas de contexte propre et Arche ne peut que garder des références libres.
- Détails techniques : `arche.pub_capex` (droit à accorder à `codex_app` par Matrix) : `code`, `filiale_code`, `filiale`, `zone`, `site`, `intitule`, `statut`, `phase_code`, `maj_le`. Arche garde l'identifiant `TYPE-CONTEXTE-SEQ`, la lettre de révision et le lien `/documents/{id}`. Détail : `docs/DEMANDES-CODEX.md` du dépôt Arche.
- Validé par Guillaume le : 2026-10-22
- Réponse de Codex (2026-10-23) : non traitée, elle attend deux décisions de Guillaume. CX-01 : rattachement `capex` propre ou CAPEX traité comme un projet (les deux options de la demande ; touche le modèle de classement « origine et rattachement » et la liaison avec Arche, O-03). CX-02 : ajout de types ou de sous-types au registre, arbitrages du registre encore ouverts (O-05).

## [2026-10-22] Arche → Codex — API de dépôt, état d'un document et version figée (CX-03, CX-04, CX-07)
- Statut : OUVERTE
- Demande : (CX-03) une API pour qu'une autre application crée un document (type, rattachement, titre, confidentialité, propriétaire) avec son fichier et reçoive son identifiant, idempotente par référence d'origine (`arche:<objet>`), authentifiée par clé signée comme `POST /api/import` ; (CX-04) une lecture de l'état d'un document par identifiant (révision en vigueur, statut, circuit en cours), par API ou dans `pub_documents` / `pub_validations` ; (CX-07) un dossier de jalon déposé par Arche (signé, empreinte SHA-256 connue d'Arche) reste en l'état (révision approuvée d'office ou conservation légale).
- Justification : Arche fige et fait signer un dossier à chaque jalon (G1, G2, G3) et doit en déposer la version PDF ; il affiche l'état « validé / en revue » des pièces du pack ingénierie. Sans API, l'utilisateur dépose lui-même le PDF dans Codex puis colle son identifiant dans Arche (fonctionnement actuel) ; la preuve d'une décision de jalon n'est pas protégée contre une modification.
- Détails techniques : exemple de dépôt `POST /api/documents` `{ "origin": "arche:dossier/CPX-APM-2026-01/business_case/v2", "type": "DOS", "attachment": { "kind": "capex", "code": "CPX-APM-2026-01" }, "title": "Business Case — Cadrage, v2", "confidentiality": "interne", "owner": "l.haddad@…", "sha256": "…" }` + fichier ; réponse `{ "id": "DOS-CPX-APM-2026-01-001", "revision": "A", "url": "/documents/DOS-CPX-APM-2026-01-001" }`.
- Validé par Guillaume le : 2026-10-22
- Réponse de Codex (2026-10-23) :
  - CX-03 FAITE : `POST /api/documents` (`docs/api.md`, « POST /api/documents »). Écarts avec l'exemple : la référence d'origine s'appelle `sourceRef` (`origin` est déjà l'origine interne / externe du document) ; le propriétaire se donne par `ownerId` (identifiant Codex) ou `ownerMatricule` (`EMP-…`), pas par adresse e-mail (Codex n'en garde pas) ; la réponse donne `href` (le lien `/documents/{id}`). Le document naît en brouillon A.1 et passe par un circuit ; le rattachement `capex` attend CX-01, d'ici là `attachment` vaut `none`, `project` ou `research`. Jeton et secret propres : `CODEX_DOCUMENTS_TOKEN`, `CODEX_DOCUMENTS_SECRET`, à poser dans Codex et à donner à Arche. Rejouable : la même `sourceRef` avec le même fichier rend le document déjà créé (200).
  - CX-04 FAITE, sans nouvelle API : l'état se lit dans `codex.pub_documents` (`status`, `rev_in_force`, `rev_working`), `codex.pub_revisions_document` et `codex.pub_validations` (circuit en cours), déjà accordées à Arche (CX-05). Détail : `docs/api.md`, « Lire l'état d'un document ».
  - CX-07 OUVERTE : attend une décision de Guillaume. Une révision « approuvée d'office » contournerait la règle « révisions validées par un circuit » (`docs/decisions.md`) ; l'autre option, la conservation légale (gel juridique, `legal_hold`), est à choisir aussi. En attendant, l'empreinte `sha256` envoyée au dépôt est vérifiée et gardée sur la version de travail A.1.

## [2026-10-22] Arche → Codex — Accès des utilisateurs des filiales et lien profond stable (CX-06, CX-08)
- Statut : OUVERTE
- Demande : (CX-06) donner aux utilisateurs des filiales l'accès aux documents de leurs CAPEX dans Codex (organigramme O-04 avec les filiales, confidentialité) ; (CX-08) confirmer que le lien `/documents/{id}` (qui résout aussi les alias) reste le contrat des liens profonds.
- Justification : Arche ouvre chaque document cité dans un dossier vivant par un lien vers Codex ; un utilisateur de filiale doit pouvoir l'ouvrir. Sans cela, le lien mène à un refus d'accès dans Codex.
- Détails techniques : filiales et sites publiés par Matrix (`matrix.pub_filiales`, `matrix.pub_sites`, décision D21) ; les lectures d'Arche sur `codex.pub_documents`, `pub_revisions_document`, `pub_validations`, `pub_types_document` sont déjà accordées par Matrix (CX-05 fait).
- Validé par Guillaume le : 2026-10-22
- Réponse de Codex (2026-10-23) :
  - CX-06 OUVERTE : attend l'organigramme avec les filiales (O-04) et le fournisseur d'authentification (O-02).
  - CX-08 FAITE : `/documents/{id}` est le contrat des liens profonds ; il résout aussi les anciens identifiants (alias) et redirige vers l'identifiant actuel. Garanti par `tests/integration/deep-link.test.ts`, écrit dans `docs/api.md`, « Lien profond ».
