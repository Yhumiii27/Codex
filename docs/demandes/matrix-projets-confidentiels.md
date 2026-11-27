# Brouillon de demande à Matrix — documents des projets confidentiels de Keystone dans les vues `pub_` de Codex

**Statut : brouillon** (27 novembre 2026). Rien n'est porté dans le `REQUESTS.md` de Matrix sans le « validé » du
propriétaire (Norma § 3). Origine : décision du propriétaire du 27 novembre 2026 (D-33 de `docs/decisions.md`) :
Keystone donne la confidentialité de ses projets, valable aussi pour les documents de Codex.

## Prérequis (liens à accorder)

- Lecture de `keystone.pub_projets` (colonne `confidentialite` ajoutée en fin, PR Keystone#90) et de la nouvelle vue
  `keystone.pub_equipes_projets` par `codex_app` : lien `lecture` du registre de Matrix (lecteur `codex_app`, objets
  `keystone.pub_projets`, `keystone.pub_equipes_projets`, raison : documents des projets confidentiels réservés à leur
  équipe). Codex lit ces vues par la tâche « keystone » ; sans elles, il ne change rien.

## Ce que les vues `pub_` exposeraient aujourd'hui

`codex.pub_documents`, `codex.pub_revisions_document`, `codex.pub_validations` et `codex.pub_journal` publient les
documents d'un projet confidentiel comme les autres : titre, propriétaire, révisions, circuits, entrées du journal.
Keystone, propriétaire du projet, applique son équipe ; Vigie et Matrix n'en ont pas.

## Demande (proposée)

1. **`codex.pub_documents`** : ajouter **en fin** une colonne `projet_confidentiel boolean`, pour que Keystone (et
   Ingenium plus tard) sachent appliquer leur équipe sans relire la confidentialité ailleurs :
   ```sql
   coalesce((SELECT p.confidentiality = 'confidentiel' FROM codex.projects p WHERE p.code = d.project_code), false)
     AS projet_confidentiel
   ```
2. **Lecteurs autres que Keystone** (Vigie, Matrix) : ne plus leur publier ces documents. Deux voies, au choix de
   Matrix :
   - une vue `codex.pub_documents_v2` (et `…_v2` pour les révisions, validations, journal) sans les documents des
     projets confidentiels, lue par `vigie_app` et `matrix_app`, `pub_documents` restant lue par `keystone_app` seul ;
   - ou, si Matrix préfère une vue par lecteur, le filtre suivant dans les vues lues par Vigie et Matrix :
     ```sql
     AND (d.project_code IS NULL
          OR d.project_code NOT IN (SELECT p.code FROM codex.projects p WHERE p.confidentiality = 'confidentiel'))
     ```
     (`pub_journal` : `a.doc_id` rapproché de `codex.documents.id` et de ses `aliases`).
   Aucune colonne publiée ne change ni ne disparaît.

## Raison

Un projet confidentiel n'est accessible qu'à son équipe et n'apparaît jamais pour les autres (décision du propriétaire) ;
Codex l'applique à ses écrans, ses exports et son journal ; les vues `pub_` sont le seul endroit où ces documents
sortent encore.

## Sans cette demande

Codex filtre tout ce qu'il montre ; Vigie et Matrix continuent de lire, par les vues `pub_`, l'existence, le titre et
les révisions des documents des projets confidentiels. Le fichier n'est jamais publié.
