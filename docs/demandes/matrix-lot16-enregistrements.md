# Brouillon de demande à Matrix — enregistrements du dossier du personnel dans les vues `pub_` de Codex

**Statut : brouillon** (26 novembre 2026). Rien n'est porté dans le `REQUESTS.md` de Matrix sans le « validé » du
propriétaire (Norma § 3). Origine : demande « lot 16 » de Cursus (`REQUESTS.md` de Codex, 10 novembre 2026), traitée
par Codex le 26 novembre 2026 (décision D-32 de `docs/decisions.md`).

## Ce qui change chez Codex

Codex reçoit désormais les pièces du dossier du personnel déposées par Cursus : type `DPE` « Dossier du personnel —
enregistrement », département `RHU`, propriétaire le compte de service `cursus`, confidentialité Confidentiel ou Très
confidentiel selon la catégorie. Le titre est neutre mais porte le matricule du salarié (« Attestation de formation —
EMP-0042 — 2026-11 »). Un enregistrement peut être **détruit** par Cursus : sa ligne de `codex.documents` disparaît, une
trace sans contenu reste dans `codex.destroyed_documents`.

## Ce que les vues `pub_` exposeraient aujourd'hui

| Vue | Très confidentiel | Confidentiel (`DPE`) |
| --- | --- | --- |
| `codex.pub_documents` | exclu (`conf <> 'tres_confidentiel'`) | **publié** : titre avec matricule, sous-type (catégorie), propriétaire « Cursus » |
| `codex.pub_revisions_document` | exclu | **publié** (révision A, nom et taille du fichier) |
| `codex.pub_validations` | exclu | aucun circuit : rien |
| `codex.pub_types_document` | — | le type `DPE` et ses catégories (attendu : Cursus le lit) |
| `codex.pub_journal` | **publié** : `objet` = identifiant, `detail` = `A · cursus:piece/<id>`, puis `retrait · cursus:piece/<id>` à la destruction | **publié**, idem |

`pub_journal` ne filtre aucun document : l'existence d'un enregistrement Très confidentiel (justificatif d'absence,
vaccination, note de frais de santé), sa date et la pièce de Cursus d'où il vient sont lisibles de `matrix_app`. Après une
destruction, la ligne de `documents` n'existe plus : un filtre sur `conf` ne la retrouve pas.

## Demande (proposée)

1. **`codex.pub_journal`** : ne plus publier les entrées des enregistrements du dossier du personnel, avant comme après
   leur destruction. Proposition de filtre (requête de référence à reprendre par Matrix) :
   ```sql
   WHERE a.doc_id IS NULL
      OR NOT (a.doc_id IN (SELECT x.id FROM codex.documents x WHERE x.type_code = 'DPE')
              OR a.doc_id IN (SELECT y.id FROM codex.destroyed_documents y))
   ```
   Aucune colonne ne change ; seules des lignes sortent de la vue.
2. **`codex.pub_documents`, `codex.pub_revisions_document`, `codex.pub_validations`** : exclure aussi les enregistrements
   `DPE` Confidentiel (`AND d.type_code <> 'DPE'`) : ce sont des pièces personnelles des salariés, que ni Keystone, ni
   Vigie, ni Matrix n'ont à lire. Aucune colonne ne change.
3. **Si Cursus doit lire l'état de ses enregistrements** (sa note parle de liens vers `codex.pub_documents`) : une
   publication propre, lue par `cursus_app` seul, plutôt que les vues communes, par exemple
   `codex.pub_enregistrements_personnel` (`id`, `source_ref` = `legacy_ref`, `type_code`, `subtype`,
   `subject_matricule`, `conf`, `state`, `legal_hold`, `created_at`, `expires_at`, `retention_years`,
   `retention_trigger`) ; et les destructions par `codex.destroyed_documents` (`id`, `source_ref`, `reason`,
   `destroyed_at`). Cursus a déjà tout cela par l'API (réponses du dépôt et de la destruction) : ce point ne vaut que si
   Cursus le demande.

## Raison

Les catégories Très confidentiel ne doivent figurer dans aucune vue `pub_` (demande de Cursus, point 5) ; le journal les
laisse passer. Les pièces Confidentiel nomment un salarié par son matricule et n'ont pas de lecteur dans les autres outils.

## Sans cette demande

Les vues gardent leur forme actuelle : `matrix_app` lit l'existence, la date et la référence Cursus de chaque
enregistrement (Très confidentiel compris) dans `pub_journal`, et tous les lecteurs de `pub_documents` voient les
enregistrements Confidentiel. Le contenu (fichier) n'est jamais publié.
