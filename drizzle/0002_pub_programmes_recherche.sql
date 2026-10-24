-- Vue pub_programmes_recherche : la liste des programmes de recherche de Codex, lue par Crucible pour relier ses projets
-- d'essais aux programmes (demande CX-2 de Crucible, docs/DEMANDES-CODEX.md de son dépôt ; accord de l'utilisateur le
-- 24 octobre 2026). Écrite à la main comme les vues de 0001_partage ; le droit de lecture de crucible_app est posé par
-- le socle Matrix (partage/90-droits.sql), hors de Codex.
-- Contrat : on n'en retire ni ne renomme de colonne (sinon nouvelle vue _v2) ; ajout en fin de liste seulement.
CREATE OR REPLACE VIEW codex.pub_programmes_recherche WITH (security_barrier) AS
SELECT p.code,                                 -- Crucible : code du programme (documents.program_code, rattachement « research »)
       p.name        AS libelle,               -- Crucible : libellé
       u.matricule   AS responsable_matricule, -- Crucible : responsable du programme ↔ matricule commun aux outils (D01)
       p.active      AS actif                  -- Crucible : un programme clos n'est plus proposé pour un nouveau document
FROM codex.research_programs p
JOIN codex.users u ON u.id = p.manager_id;--> statement-breakpoint
COMMENT ON VIEW codex.pub_programmes_recherche IS 'Contrat v1 (demande CX-2 de Crucible) : programmes de recherche de Codex. Lecteurs : crucible_app, matrix_app.';
