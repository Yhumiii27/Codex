// Interface strings. The first block of each language is copied from the design (design/GED Groupe.dc.html);
// the "Added" blocks cover the dialogs and states the mockup leaves implicit.

export type Lang = 'fr' | 'en';

const fr = {
  brand_sub:'GED Groupe', nav_home:'Accueil', nav_explorer:'Explorateur', nav_search:'Recherche', nav_workflow:'Validations', nav_retention:'Archivage & rétention', nav_admin:'Administration',
  search_ph:'Rechercher un document, une référence, un mot-clé…', notes:'Notes de conception', notif:'Notifications',
  role_collaborateur:'Collaboratrice', role_validateur:'Manager validatrice', role_auditeur:'Audit & conformité', role_gestionnaire:'Gestionnaire documentaire',
  hello:'Bonjour', home_sub:'Voici ce qui demande votre attention.', new_from_tpl:'Nouveau depuis un modèle', upload:'Déposer un fichier', adv_search:'Recherche avancée',
  kpi_todo:'À valider', kpi_todo_sub:'circuits en attente de votre décision', kpi_exp:'Échéances sous 90 jours', kpi_exp_sub:'conservation, expiration ou revue à échéance', kpi_in_force:'Mis en vigueur cette semaine', kpi_in_force_sub:'nouvelles révisions entrées en vigueur',
  todo:'À traiter', recents:'Documents récents', activity:'Activité du groupe', see_all:'Tout voir', open:'Ouvrir', due:'Échéance', requested_by:'Demandé par', step:'Étape', until:'Conservation jusqu’au',
  type:'Type', status:'Statut', owner:'Propriétaire', modified:'Modifié', retention:'Rétention', doc_type:'Type de document', all:'Tous', docs:'documents', cancel:'Annuler', create:'Créer', close:'Fermer', ref:'Référence', conf:'Confidentialité',
  act_upload:'Dépôt', act_edit:'Modification', act_request:'Demande de validation', act_sign:'Signature', act_download:'Téléchargement', act_approve:'Approbation', act_archive:'Archivage',
  x_renew:'Renouveler', x_review:'Réviser', x_archive:'Archiver', x_destroy:'Détruire',
  sc_home:'Tableau de bord', sc_explorer:'Explorateur documentaire', sc_search:'Recherche avancée', sc_document:'Fiche document', sc_workflow:'Circuits de validation', sc_retention:'Archivage & rétention', sc_admin:'Administration',
  classification:'Plan de classement', all_docs:'Tous les documents', new_doc_btn:'Nouveau', f_all:'Tous', f_draft:'Brouillons', f_archived:'Archivés', open_record:'Ouvrir la fiche', download:'Télécharger', quick_view:'Aperçu rapide',
  back:'Explorateur', share:'Partager', tab_meta:'Fiche', tab_approval:'Validation', tab_history:'Historique', page:'Page', of:'sur', preview_note:'Aperçu PDF généré par le service de conversion', keywords:'Mots-clés', language:'Langue', lang_fr:'Français', lang_en:'Anglais', edit_meta:'Modifier les métadonnées', current:'Courante', compare:'Comparer', restore:'Restaurer', no_workflow:'Aucun circuit en cours pour ce document.', by:'par', hold:'Gel juridique', hold_off:'Aucun', created:'Créé le',
  saved:'Recherches enregistrées', filters:'Filtres', clear:'Effacer', results:'résultats', export_list:'Exporter la liste', no_results:'Aucun document ne correspond à ces critères.',
  wf_mine:'À valider', wf_active:'En cours', wf_done:'Terminées', wf_finished:'Terminé', approve:'Approuver', reject:'Rejeter', delegate:'Déléguer', comments:'Commentaires', add_comment:'Ajouter un commentaire…', steps:'Étapes du circuit', sign_note:'Signature électronique avancée (eIDAS) requise à cette étape.', st_done:'Fait', st_current:'En cours', st_todo:'À venir', wf_empty:'Aucun circuit dans cette vue.', document:'Document', send:'Envoyer',
  ret_due:'Échéances', ret_rules:'Règles de conservation', ret_archives:'Archives', end_date:'Fin de conservation', proposed:'Action proposée', archive_sel:'Archiver la sélection', hold_sel:'Appliquer un gel juridique', selected:'sélectionné(s)', duration:'Durée', trigger:'Déclencheur', outcome:'Sort final', types_covered:'Types couverts', archived_on:'Archivé le', consult:'Consulter', days_left:'j restants',
  ad_roles:'Rôles & droits', ad_audit:'Journal d’audit', manager:'Responsable', count:'Documents', role:'Rôle', new_template:'Nouveau modèle', add_value:'Ajouter une valeur', export_csv:'Exporter (CSV)', when:'Horodatage', user:'Utilisateur', action:'Action', detail:'Détail', matrix_hint:'Cliquez une cellule pour accorder ou retirer le droit.',
  new_doc:'Nouveau document', choose_tpl:'Choisissez un modèle',
  open_keystone:'Ouvrir dans Keystone', client:'Client', pm:'Chef de projet', site:'Site d’intervention', tiers:'Tiers', expected_pieces:'Pièces attendues par Keystone', missing:'Manquante', later:'Attendue plus tard', provided:'Déposée', ks_feed:'Événements Keystone', synced:'Synchronisé depuis Keystone à', deposit:'Déposer', linked_app:'Application liée',
  // Added
  act_reject:'Rejet', act_delegate:'Délégation', act_hold:'Gel juridique', act_restore:'Restauration',
  st_draft:'Brouillon', st_archived:'Archivé',
  role_lecteur:'Lecteur', role_contributeur:'Contributeur', role_gestionnaire_doc:'Gestionnaire documentaire', role_validateur_r:'Validateur', role_auditeur_r:'Auditeur', role_administrateur:'Administrateur',
  perm_read:'Lire', perm_upload:'Déposer', perm_edit:'Modifier', perm_approve:'Valider', perm_publish:'Publier', perm_archive:'Archiver', perm_destroy:'Détruire', perm_admin:'Administrer',
  sim_title:'Simuler un utilisateur', sim_hint:'Sans authentification pour l’instant : choisissez la personne et le rôle simulés. La navigation et les droits s’adaptent.', sim_user:'Utilisateur', sim_role:'Rôle simulé', apply:'Appliquer',
  file:'Fichier', choose_file:'Choisir un fichier', save:'Enregistrer', deposit_for:'Pièce attendue', version_comment:'Commentaire de version',
  keywords_hint:'Séparés par des virgules', request_title:'Demander une validation', circuit:'Circuit',
  delegate_title:'Déléguer l’étape', delegate_to:'Déléguer à',
  hold_on:'Actif depuis le', link_copied:'Lien copié dans le presse-papiers', not_allowed:'Droit requis', no_file:'Aucun fichier joint à cette version — aperçu de démonstration.',
  saved_ok:'Modifications enregistrées', error:'Une erreur est survenue', forbidden:'Vous n’avez pas accès à cet écran avec le rôle simulé.',
  notif_empty:'Rien de nouveau.', notif_recent:'Activité récente',
  label_fr:'Libellé (FR)', label_en:'Libellé (EN)',
  years:'Durée (années)', disposition:'Action à échéance', rule_id:'Code',
  compare_title:'Comparer les versions', current_version:'Version courante', selected_version:'Version sélectionnée', size:'Taille', pages:'Pages', author:'Auteur', date:'Date',
  locked_archived:'Document archivé : modification impossible.', locked_hold:'Document sous gel juridique : modification impossible.', archive_skipped:'document(s) non archivé(s) : gel juridique ou circuit en cours.', wrong_step:'Le circuit a avancé entre-temps : la page a été actualisée.', no_self_approval:'L’auteur ou le demandeur d’une révision ne peut pas la valider.',
  days_late:'j de retard', not_found:'Document introuvable.', back_home:'Retour à l’accueil',
  // Model v2 (docs/modele-cible.md)
  st_in_review:'En révision', st_approved:'Approuvé', st_in_force:'En vigueur', st_superseded:'Remplacé', st_obsolete:'Obsolète',
  f_in_force:'En vigueur', f_in_review:'En révision', f_obsolete:'Obsolètes',
  origin:'Origine', or_interne:'Interne', or_externe:'Externe', attachment:'Rattachement', att_none:'Aucun', att_project:'Projet', att_research:'Recherche',
  family:'Famille', subtype:'Sous-type', department:'Département / Fonction', site_label:'Site', title_label:'Titre', author_label:'Auteur', revision:'Révision', working_version:'Version de travail',
  conf_public:'Public', conf_restreint:'Restreint', conf_interne:'Interne', conf_confidentiel:'Confidentiel', conf_tres_confidentiel:'Très confidentiel',
  conf_hint_restreint:'Diffusable au client ou partenaire désigné', issued_at:'Date d’émission', effective_at:'Date d’effet', review_due_at:'Date de révision', expires_at:'Date d’expiration', retention_class:'Classe de conservation',
  source_org:'Organisme source', external_ref:'Référence externe', received_at:'Date de réception', project:'Projet', project_phase:'Phase projet', work_package:'Lot / work package', discipline:'Discipline',
  program:'Programme de recherche', research_theme:'Thème de recherche', study_id:'ID étude / essai', ip_status:'Statut publication / PI', process_owner:'Propriétaire de processus',
  trig_creation:'Création', trig_in_force:'Mise en vigueur', trig_superseded:'Retrait ou archivage du document', trig_project_end:'Fin du projet', trig_contract_end:'Fin du contrat', trig_fiscal_year_end:'Clôture de l’exercice', trig_expiry:'Expiration', trig_asset_life:'Durée de vie de l’actif', trig_employee_departure:'Départ du salarié', trig_permanent:'Permanent',
  disp_destroy:'Destruction', disp_review:'Revue', disp_archive:'Archivage', disp_permanent:'Conservation permanente', years_short:'ans',
  rev_in_force:'Révision en vigueur', rev_working:'Révision en cours', no_rev_in_force:'Aucune révision en vigueur', new_working_version:'Nouvelle version de travail', request_validation:'Demander la validation',
  request_change:'Demander une modification', request_obsolete:'Demander le retrait', ecr_reason:'Motif', ecr_description:'Description', ecr_sent:'Demande transmise à Vigie',
  ecr_submitted:'Transmise à Vigie', ecr_accepted:'Acceptée', ecr_rejected:'Refusée', ecr_implemented:'Appliquée', kind_modification:'Modification', kind_obsolescence:'Retrait (obsolète)', modifier:'Modificateur désigné',
  vigie_sim:'Simulation Vigie', vigie_accept:'Simuler l’acceptation', vigie_reject:'Simuler le refus', open_vigie:'Ouvrir dans Vigie', eco_ref:'ECO',
  ecr_accepted_waiting:'Décision de Vigie acceptée, en attente d’application', ecr_pending_apply:'En attente d’application', vigie_deferred:'L’acceptation sera enregistrée',
  ecr_wait_hold:'elle s’appliquera à la levée du gel juridique', ecr_wait_archived:'elle s’appliquera à la restauration du document', ecr_wait_hold_archived:'elle s’appliquera à la levée du gel juridique puis à la restauration du document', ecr_wait_lock:'elle s’appliquera dès que le document ne sera plus verrouillé',
  ecr_wait_revision:'elle ouvrira la révision suivante à la mise en vigueur de la révision', ecr_wait_not_before_hold:'pas avant la levée du gel juridique', ecr_wait_not_before_archived:'pas avant la restauration du document', ecr_wait_not_before_hold_archived:'pas avant la levée du gel juridique et la restauration du document', ecr_wait_not_while_locked:'pas tant que le document est verrouillé',
  ecr_wait_no_earlier_hold:'elle ne s’appliquera pas avant la levée du gel juridique', ecr_wait_no_earlier_archived:'elle ne s’appliquera pas avant la restauration du document', ecr_wait_no_earlier_hold_archived:'elle ne s’appliquera pas avant la levée du gel juridique et la restauration du document', ecr_wait_no_earlier_lock:'elle ne s’appliquera pas tant que le document est verrouillé',
  ecr_accepted_l:'acceptée', vigie_graft_hint:'Tant que la révision en cours est en rédaction, la modification pourra aussi y être greffée depuis la fiche.',
  change_hint_sent:'La demande (ECR) est transmise à Vigie.', change_hint_open:'Une révision est déjà ouverte', change_hint_open_wait:'Si l’ECO est accepté, il ouvrira la révision suivante à la mise en vigueur de la révision', change_hint_open_graft:'il pourra aussi y être greffé tant qu’elle est en rédaction',
  open_rev_draft:'en rédaction', open_rev_in_review:'en validation', open_rev_approved:'approuvée, en attente de sa date d’effet',
  act_graft:'Greffe d’une modification', graft_done:'Modification greffée sur la révision en cours', graft_not_pending:'Aucune modification acceptée en attente à greffer sur une révision en cours.', graft_not_draft:'La révision en cours est en validation ou approuvée : la modification ne peut plus y être greffée. Elle ouvrira la révision suivante à la mise en vigueur de la révision en cours.',
  graft_on:'Greffer sur la révision', graft_confirm:'Greffer', graft_author:'Modificateur de la révision', graft_reserved:'Réservé au modificateur de la révision en cours et aux gestionnaires documentaires', draft_reserved:'Réservé au propriétaire, au modificateur de la révision en cours et aux gestionnaires documentaires : le modificateur désigné pour une modification en attente rédigera la révision suivante', graft_hint:'La révision en rédaction intègre la modification et porte aussi sa référence ECO ; la demande passe « Appliquée ». Le modificateur et les versions de travail de la révision ne changent pas. Sans greffe, la modification attend la mise en vigueur de la révision pour ouvrir la suivante.',
  graft_vigie_modifier:'Modificateur désigné par Vigie', graft_vigie_modifier_hint:'Une fois greffée, la modification est rédigée par le modificateur de la révision ; le journal garde la trace de ce changement.',
  graft_closed_review:'en validation : la modification ne peut plus y être greffée sans relancer le circuit, seule l’attente est possible.', graft_closed_approved:'approuvée, en attente de sa date d’effet : la modification ne peut plus y être greffée, seule l’attente est possible.',
  change_grafted_on:'Greffée sur la révision', change_opened:'A ouvert la révision',
  modifier_not_allowed:'Le modificateur désigné ne peut pas rédiger ce document (droit de dépôt de son rôle, accès au document)', modifier_set_aside:'Décision de Vigie appliquée : le modificateur désigné ne pouvait plus rédiger ce document, la révision est ouverte pour le modificateur par défaut', modifier_none_allowed:'Décision de Vigie appliquée, mais ni le modificateur désigné ni le modificateur par défaut ne peuvent rédiger ce document : la révision est ouverte pour le modificateur par défaut, qui ne peut pas y déposer', vigie_modifier_hint:'Seules les personnes qui peuvent rédiger ce document sont proposées : droit de dépôt de leur rôle et accès au document.',
  registry:'Registre des types', functions_tab:'Fonctions & circuits', organisation:'Organisation', circuit_steps:'Étapes du circuit', no_approval:'Approbation immédiate', holders:'Titulaires', scope_global:'Groupe', scope_department:'Par département', scope_project:'Par projet', scope_research:'Par programme',
  client_deliverable:'Livrable client', iso_clause:'Clause ISO 9001', retention_rule:'Règle de conservation', templates_qms:'Modèles (QMS)', readers:'Lecteurs désignés', aliases:'Anciennes références',
  act_ecr:'Demande de modification', act_obsolete:'Retrait', act_import:'Import', act_in_force:'Mise en vigueur', act_reclass:'Reclassement', act_working:'Version de travail',
  need_file:'Déposez au moins une version de travail avant de demander la validation.', not_draft:'Cette révision n’est pas en brouillon.', change_pending:'Une demande est déjà en cours pour ce document.',
  no_access:'Vous n’avez pas accès à ce document.',
  no_holder:'Aucun titulaire disponible pour la fonction', type_mismatch:'Ce type n’admet pas cette origine ou ce rattachement.', conf_not_allowed:'Niveau de confidentialité non admis pour ce type.', source_required:'L’organisme source est obligatoire pour un document externe.', project_required:'Choisissez le projet de rattachement.', program_required:'Choisissez le programme de recherche.', wf_rejected:'Rejeté', wf_approved:'Approuvé', need_in_force:'Seul un document en vigueur peut faire l’objet d’une demande de modification ou de retrait.', vigie_only:'Décision réservée à Vigie (simulation : gestionnaire documentaire).',
  create_doc:'Créer le document', id_preview:'Identifiant attribué', from_template:'Depuis un modèle', from_file:'Depuis un fichier', blank_doc:'Sans fichier pour l’instant',
  // Model v2 — dialogs
  initial_content:'Contenu initial', blank_hint:'Le document reçoit son identifiant tout de suite ; déposez la version de travail A.1 plus tard.', tpl_none:'Aucun modèle en vigueur.',
  id_seq_hint:'numéro attribué à la création', id_will_change:'L’identifiant sera recalculé', id_frozen:'Identifiant figé depuis la première approbation',
  no_type:'Aucun type actif n’admet cette origine et ce rattachement.', subtype_hint:'Choisir dans la liste ou saisir librement', conf_hint_tres:'Les lecteurs désignés se définissent sur la fiche du document.',
  ctx_externe:'Document externe', ctx_project:'Document de projet', ctx_research:'Document de recherche', ctx_interne:'Document interne',
  author_text:'Auteur (texte libre)', author_text_hint:'Vide : l’auteur est la personne qui a créé le document',
  effective_hint:'Vide : en vigueur dès l’approbation', change_hint_modification:'La demande (ECR) est transmise à Vigie. Si l’ECO est accepté, Codex ouvre la révision suivante en brouillon, attribuée au modificateur désigné.', change_hint_obsolescence:'La demande de retrait est transmise à Vigie. Si elle est acceptée, le document passe à l’état obsolète.',
  readers_hint:'En plus du cercle de rédaction, ces personnes voient le document : seules elles pour un document très confidentiel, en plus du département ou de l’équipe projet pour un document confidentiel.',
  vigie_hint:'Tant que Vigie n’est pas branché, sa décision est simulée ici par un gestionnaire documentaire.', vigie_decision:'Décision',
  step_author:'Rédaction (auteur)', add_step:'Ajouter une étape', move_up:'Monter', move_down:'Descendre', remove:'Retirer',
  conf_allowed:'Niveaux admis', conf_default:'Niveau par défaut', type_active:'Type actif (proposé à la création)', retention_basis:'Fondement',
  add_holder:'Ajouter un titulaire', dept_code:'Code (3 lettres)', dept_code_hint:'Contexte des identifiants sans rattachement (ex. PRO-QUA-0001)', new_department:'Nouveau département', new_site:'Nouveau site',
  default_role:'Rôle par défaut',
  // Model v2 — screens
  tab_revisions:'Révisions', tab_requests:'Demandes', rev_short:'Rév.', in_progress:'en cours', project_docs:'Documents du projet', no_version:'Aucune version de travail déposée.',
  locked_obsolete:'Document obsolète : modification impossible.', no_requests:'Aucune demande de modification ou de retrait pour ce document.',
  dl_expiry:'Expire le', dl_review:'Revue prévue le', ax_department_short:'Dépt.', department_short:'Département', no_attachment:'Sans rattachement', project_program:'Projet / programme', retention_short:'Conservation',
  wf_circuits:'Circuits', wf_vigie:'Mes demandes Vigie', vigie_empty:'Aucune demande de modification ou de retrait envoyée à Vigie.', ecr_sent_on:'Envoyée le', ecr_decided_on:'Décision de Vigie', ecr_note:'Note de Vigie', ecr_wait_vigie:'En attente de la décision de Vigie.',
  wf_requested:'Mes demandes', due_kind:'Nature', due_retention:'Conservation', due_expiry:'Expiration', due_review:'Révision périodique',
  all_families:'Toutes les familles', types_count:'types', inactive:'Inactif', people:'Personnes', function_label:'Fonction', scope:'Portée',
  org_provisional:'Valeurs provisoires, en attente de l’organigramme. Le code à 3 lettres du département entre dans l’identifiant des documents sans rattachement.',
  // Rules and states added after review
  st_cancelled:'Annulée', act_release:'Levée du gel', release_hold:'Lever le gel juridique', follow_workflow:'Suivre le circuit',
  invalid_date:'Date invalide : choisissez aujourd’hui ou une date à venir.',
  circuit_running:'Circuit de validation en cours : rejetez-le ou attendez sa décision avant de changer le type ou le contexte.',
  delegate_no_approve:'Cette personne ne peut pas valider avec son rôle par défaut.',
  admin_lockout:'Retrait impossible : votre rôle perdrait l’accès à l’administration.',
  not_enforced:'Non appliqué dans la simulation',
  matrix_not_enforced:'Cellules grisées : droit sans action dans Codex (Détruire) ou rôle sans équivalent simulé (Lecteur, Administrateur).',
  prev_page:'Page précédente', next_page:'Page suivante', original_file:'Fichier d’origine', preview_unavailable:'Aperçu indisponible pour ce format — téléchargez le fichier.',
  conf_hint_conf:'Visible du département ou de l’équipe projet ; des lecteurs désignés peuvent s’ajouter sur la fiche du document.',
  wf_closed_hint:'Document verrouillé : le circuit reprendra une fois le verrou levé.',
  piece_type_mismatch:'Cette pièce attend un document de type',
  obsolete_since:'Obsolète depuis le', do_not_apply:'ne plus appliquer',
  act_perm:'Droit modifié', act_org_add:'Valeur d’organisation ajoutée', act_holder_add:'Titulaire ajouté', act_holder_remove:'Titulaire retiré', act_type:'Type modifié', act_comment:'Commentaire', act_export:'Export CSV',
  target:'Objet', target_permission:'Droit', target_export:'Export', active_label:'Actif', export_rows:'lignes', export_full:'journal complet', export_unfiltered:'sans filtre', export_interrupted:'interrompu après',
  // « À traiter » (G19)
  todo_empty:'Rien à traiter pour le moment.', todo_eco:'à rédiger', todo_rejected:'renvoyée en rédaction par', todo_draft:'en brouillon, jamais soumise à validation', todo_assigned:'confiée à', todo_graft:'greffe possible sur la révision',
};

type Dict = Record<keyof typeof fr, string>;

const en: Dict = {
  brand_sub:'Group DMS', nav_home:'Home', nav_explorer:'Browse', nav_search:'Search', nav_workflow:'Approvals', nav_retention:'Archiving & retention', nav_admin:'Administration',
  search_ph:'Search documents, references, keywords…', notes:'Design notes', notif:'Notifications',
  role_collaborateur:'Employee', role_validateur:'Approving manager', role_auditeur:'Audit & compliance', role_gestionnaire:'Records manager',
  hello:'Good morning', home_sub:'Here is what needs your attention.', new_from_tpl:'New from template', upload:'Upload a file', adv_search:'Advanced search',
  kpi_todo:'To approve', kpi_todo_sub:'workflows waiting for your decision', kpi_exp:'Due within 90 days', kpi_exp_sub:'retention, expiry or review falling due', kpi_in_force:'In force this week', kpi_in_force_sub:'new revisions entered into force',
  todo:'To do', recents:'Recent documents', activity:'Group activity', see_all:'See all', open:'Open', due:'Due', requested_by:'Requested by', step:'Step', until:'Retained until',
  type:'Type', status:'Status', owner:'Owner', modified:'Modified', retention:'Retention', doc_type:'Document type', all:'All', docs:'documents', cancel:'Cancel', create:'Create', close:'Close', ref:'Reference', conf:'Confidentiality',
  act_upload:'Upload', act_edit:'Edit', act_request:'Approval request', act_sign:'Signed', act_download:'Download', act_approve:'Approved', act_archive:'Archived',
  x_renew:'Renew', x_review:'Review', x_archive:'Archive', x_destroy:'Destroy',
  sc_home:'Dashboard', sc_explorer:'Document browser', sc_search:'Advanced search', sc_document:'Document record', sc_workflow:'Approval workflows', sc_retention:'Archiving & retention', sc_admin:'Administration',
  classification:'Classification plan', all_docs:'All documents', new_doc_btn:'New', f_all:'All', f_draft:'Drafts', f_archived:'Archived', open_record:'Open record', download:'Download', quick_view:'Quick view',
  back:'Browser', share:'Share', tab_meta:'Record', tab_approval:'Approval', tab_history:'History', page:'Page', of:'of', preview_note:'PDF preview generated by the conversion service', keywords:'Keywords', language:'Language', lang_fr:'French', lang_en:'English', edit_meta:'Edit metadata', current:'Current', compare:'Compare', restore:'Restore', no_workflow:'No approval workflow in progress for this document.', by:'by', hold:'Legal hold', hold_off:'None', created:'Created',
  saved:'Saved searches', filters:'Filters', clear:'Clear', results:'results', export_list:'Export list', no_results:'No document matches these criteria.',
  wf_mine:'For me', wf_active:'In progress', wf_done:'Completed', wf_finished:'Completed', approve:'Approve', reject:'Reject', delegate:'Delegate', comments:'Comments', add_comment:'Add a comment…', steps:'Workflow steps', sign_note:'Advanced electronic signature (eIDAS) required at this step.', st_done:'Done', st_current:'In progress', st_todo:'Upcoming', wf_empty:'No workflow in this view.', document:'Document', send:'Send',
  ret_due:'Deadlines', ret_rules:'Retention rules', ret_archives:'Archives', end_date:'Retention end', proposed:'Proposed action', archive_sel:'Archive selection', hold_sel:'Apply legal hold', selected:'selected', duration:'Duration', trigger:'Trigger', outcome:'Final outcome', types_covered:'Document types', archived_on:'Archived on', consult:'View', days_left:'days left',
  ad_roles:'Roles & permissions', ad_audit:'Audit log', manager:'Manager', count:'Documents', role:'Role', new_template:'New template', add_value:'Add a value', export_csv:'Export (CSV)', when:'Timestamp', user:'User', action:'Action', detail:'Detail', matrix_hint:'Click a cell to grant or revoke the permission.',
  new_doc:'New document', choose_tpl:'Choose a template',
  open_keystone:'Open in Keystone', client:'Customer', pm:'Project manager', site:'Worksite', tiers:'Third parties', expected_pieces:'Documents expected by Keystone', missing:'Missing', later:'Expected later', provided:'Filed', ks_feed:'Keystone events', synced:'Synced from Keystone at', deposit:'Upload', linked_app:'Linked app',
  // Added
  act_reject:'Rejected', act_delegate:'Delegated', act_hold:'Legal hold', act_restore:'Restored',
  st_draft:'Draft', st_archived:'Archived',
  role_lecteur:'Reader', role_contributeur:'Contributor', role_gestionnaire_doc:'Records manager', role_validateur_r:'Approver', role_auditeur_r:'Auditor', role_administrateur:'Administrator',
  perm_read:'Read', perm_upload:'Upload', perm_edit:'Edit', perm_approve:'Approve', perm_publish:'Publish', perm_archive:'Archive', perm_destroy:'Destroy', perm_admin:'Administer',
  sim_title:'Simulate a user', sim_hint:'No sign-in yet: pick the simulated person and role. Navigation and permissions adapt.', sim_user:'User', sim_role:'Simulated role', apply:'Apply',
  file:'File', choose_file:'Choose a file', save:'Save', deposit_for:'Expected document', version_comment:'Version comment',
  keywords_hint:'Comma-separated', request_title:'Request approval', circuit:'Workflow',
  delegate_title:'Delegate the step', delegate_to:'Delegate to',
  hold_on:'Active since', link_copied:'Link copied to the clipboard', not_allowed:'Permission required', no_file:'No file attached to this version — demo preview.',
  saved_ok:'Changes saved', error:'Something went wrong', forbidden:'The simulated role cannot access this screen.',
  notif_empty:'Nothing new.', notif_recent:'Recent activity',
  label_fr:'Label (FR)', label_en:'Label (EN)',
  years:'Duration (years)', disposition:'Action when due', rule_id:'Code',
  compare_title:'Compare versions', current_version:'Current version', selected_version:'Selected version', size:'Size', pages:'Pages', author:'Author', date:'Date',
  locked_archived:'Archived document: it cannot be changed.', locked_hold:'Document under legal hold: it cannot be changed.', archive_skipped:'document(s) not archived: legal hold or approval in progress.', wrong_step:'The workflow moved on in the meantime: the page has been refreshed.', no_self_approval:'The author or requester of a revision cannot approve it.',
  days_late:'days overdue', not_found:'Document not found.', back_home:'Back to home',
  // Model v2 (docs/modele-cible.md)
  st_in_review:'In review', st_approved:'Approved', st_in_force:'In force', st_superseded:'Superseded', st_obsolete:'Obsolete',
  f_in_force:'In force', f_in_review:'In review', f_obsolete:'Obsolete',
  origin:'Origin', or_interne:'Internal', or_externe:'External', attachment:'Attachment', att_none:'None', att_project:'Project', att_research:'Research',
  family:'Family', subtype:'Sub-type', department:'Department / Function', site_label:'Site', title_label:'Title', author_label:'Author', revision:'Revision', working_version:'Working version',
  conf_public:'Public', conf_restreint:'Restricted', conf_interne:'Internal', conf_confidentiel:'Confidential', conf_tres_confidentiel:'Highly confidential',
  conf_hint_restreint:'May be shared with the designated client or partner', issued_at:'Issue date', effective_at:'Effective date', review_due_at:'Review date', expires_at:'Expiry date', retention_class:'Retention class',
  source_org:'Source organisation', external_ref:'External reference', received_at:'Received on', project:'Project', project_phase:'Project phase', work_package:'Work package', discipline:'Discipline',
  program:'Research programme', research_theme:'Research theme', study_id:'Study / trial ID', ip_status:'Publication / IP status', process_owner:'Process owner',
  trig_creation:'Creation', trig_in_force:'Entry into force', trig_superseded:'Document withdrawal or archiving', trig_project_end:'Project end', trig_contract_end:'Contract end', trig_fiscal_year_end:'Fiscal year close', trig_expiry:'Expiry', trig_asset_life:'Asset life', trig_employee_departure:'Employee departure', trig_permanent:'Permanent',
  disp_destroy:'Destruction', disp_review:'Review', disp_archive:'Archive', disp_permanent:'Permanent retention', years_short:'years',
  rev_in_force:'Revision in force', rev_working:'Revision in progress', no_rev_in_force:'No revision in force', new_working_version:'New working version', request_validation:'Request approval',
  request_change:'Request a change', request_obsolete:'Request withdrawal', ecr_reason:'Reason', ecr_description:'Description', ecr_sent:'Request sent to Vigie',
  ecr_submitted:'Sent to Vigie', ecr_accepted:'Accepted', ecr_rejected:'Rejected', ecr_implemented:'Applied', kind_modification:'Change', kind_obsolescence:'Withdrawal (obsolete)', modifier:'Designated author',
  vigie_sim:'Vigie simulation', vigie_accept:'Simulate acceptance', vigie_reject:'Simulate rejection', open_vigie:'Open in Vigie', eco_ref:'ECO',
  ecr_accepted_waiting:'Vigie decision accepted, pending application', ecr_pending_apply:'Pending application', vigie_deferred:'The acceptance will be recorded',
  ecr_wait_hold:'it will apply when the legal hold is released', ecr_wait_archived:'it will apply when the document is restored', ecr_wait_hold_archived:'it will apply once the legal hold is released and the document restored', ecr_wait_lock:'it will apply once the document is no longer locked',
  ecr_wait_revision:'it will open the next revision upon entry into force of revision', ecr_wait_not_before_hold:'not before the legal hold is released', ecr_wait_not_before_archived:'not before the document is restored', ecr_wait_not_before_hold_archived:'not before the legal hold is released and the document restored', ecr_wait_not_while_locked:'not while the document is locked',
  ecr_wait_no_earlier_hold:'it will not apply before the legal hold is released', ecr_wait_no_earlier_archived:'it will not apply before the document is restored', ecr_wait_no_earlier_hold_archived:'it will not apply before the legal hold is released and the document restored', ecr_wait_no_earlier_lock:'it will not apply while the document is locked',
  ecr_accepted_l:'accepted', vigie_graft_hint:'While the revision in progress is being drafted, the change may also be grafted onto it from the record.',
  change_hint_sent:'The change request (ECR) is sent to Vigie.', change_hint_open:'A revision is already open', change_hint_open_wait:'If the ECO is accepted, it will open the next revision upon entry into force of revision', change_hint_open_graft:'it may also be grafted onto it while it is being drafted',
  open_rev_draft:'being drafted', open_rev_in_review:'under review', open_rev_approved:'approved, waiting for its effective date',
  act_graft:'Change grafted', graft_done:'Change grafted onto the revision in progress', graft_not_pending:'No accepted change waiting to be grafted onto a revision in progress.', graft_not_draft:'The revision in progress is under review or approved: the change can no longer be grafted onto it. It will open the next revision upon entry into force of the revision in progress.',
  graft_on:'Graft onto revision', graft_confirm:'Graft', graft_author:'Author of revision', graft_reserved:'Reserved to the author of the revision in progress and to records managers', draft_reserved:'Reserved to the owner, the author of the revision in progress and records managers: the author designated for a waiting change will write the next revision', graft_hint:'The revision being drafted takes in the change and also carries its ECO reference; the request is marked as applied. The revision’s author and working versions do not change. Without a graft, the change waits for the revision to enter into force before opening the next one.',
  graft_vigie_modifier:'Author designated by Vigie', graft_vigie_modifier_hint:'Once grafted, the change is written by the revision’s author; the journal records the switch.',
  graft_closed_review:'under review: the change can no longer be grafted onto it without restarting the workflow, it can only wait.', graft_closed_approved:'approved, waiting for its effective date: the change can no longer be grafted onto it, it can only wait.',
  change_grafted_on:'Grafted onto revision', change_opened:'Opened revision',
  modifier_not_allowed:'The designated author cannot draft this document (upload permission of their role, access to the document)', modifier_set_aside:'Vigie decision applied: the designated author could no longer draft this document; the revision is opened for the default author', modifier_none_allowed:'Vigie decision applied, but neither the designated author nor the default one can draft this document: the revision is opened for the default author, who cannot upload to it', vigie_modifier_hint:'Only people who can draft this document are offered: upload permission of their role and access to the document.',
  registry:'Type register', functions_tab:'Functions & workflows', organisation:'Organisation', circuit_steps:'Workflow steps', no_approval:'Immediate approval', holders:'Holders', scope_global:'Group', scope_department:'Per department', scope_project:'Per project', scope_research:'Per programme',
  client_deliverable:'Client deliverable', iso_clause:'ISO 9001 clause', retention_rule:'Retention rule', templates_qms:'Templates (QMS)', readers:'Named readers', aliases:'Former references',
  act_ecr:'Change request', act_obsolete:'Withdrawal', act_import:'Import', act_in_force:'Entry into force', act_reclass:'Reclassification', act_working:'Working version',
  need_file:'Upload at least one working version before requesting approval.', not_draft:'This revision is not a draft.', change_pending:'A request is already pending for this document.',
  no_access:'You do not have access to this document.',
  no_holder:'No holder available for the function', type_mismatch:'This type does not admit this origin or attachment.', conf_not_allowed:'Confidentiality level not allowed for this type.', source_required:'The source organisation is required for an external document.', project_required:'Choose the project.', program_required:'Choose the research programme.', wf_rejected:'Rejected', wf_approved:'Approved', need_in_force:'Only a document in force can be the subject of a change or withdrawal request.', vigie_only:'Decision reserved to Vigie (simulation: records manager).',
  create_doc:'Create document', id_preview:'Assigned ID', from_template:'From a template', from_file:'From a file', blank_doc:'No file yet',
  // Model v2 — dialogs
  initial_content:'Initial content', blank_hint:'The document gets its ID right away; upload working version A.1 later.', tpl_none:'No template in force.',
  id_seq_hint:'number assigned on creation', id_will_change:'The ID will be recalculated', id_frozen:'ID frozen since the first approval',
  no_type:'No active type admits this origin and attachment.', subtype_hint:'Pick from the list or type freely', conf_hint_tres:'Named readers are set on the document record.',
  ctx_externe:'External document', ctx_project:'Project document', ctx_research:'Research document', ctx_interne:'Internal document',
  author_text:'Author (free text)', author_text_hint:'Empty: the author is the person who created the document',
  effective_hint:'Empty: in force as soon as approved', change_hint_modification:'The change request (ECR) is sent to Vigie. If the ECO is accepted, Codex opens the next revision as a draft, assigned to the designated author.', change_hint_obsolescence:'The withdrawal request is sent to Vigie. If it is accepted, the document becomes obsolete.',
  readers_hint:'Besides the drafting circle, these people can see the document: only them for a highly confidential document, in addition to the department or project team for a confidential one.',
  vigie_hint:'Until Vigie is connected, its decision is simulated here by a records manager.', vigie_decision:'Decision',
  step_author:'Drafting (author)', add_step:'Add a step', move_up:'Move up', move_down:'Move down', remove:'Remove',
  conf_allowed:'Allowed levels', conf_default:'Default level', type_active:'Active type (offered on creation)', retention_basis:'Basis',
  add_holder:'Add a holder', dept_code:'Code (3 letters)', dept_code_hint:'Context of IDs without attachment (e.g. PRO-QUA-0001)', new_department:'New department', new_site:'New site',
  default_role:'Default role',
  // Model v2 — screens
  tab_revisions:'Revisions', tab_requests:'Requests', rev_short:'Rev.', in_progress:'in progress', project_docs:'Project documents', no_version:'No working version uploaded yet.',
  locked_obsolete:'Obsolete document: it cannot be changed.', no_requests:'No change or withdrawal request for this document.',
  dl_expiry:'Expires', dl_review:'Review due', ax_department_short:'Dept.', department_short:'Department', no_attachment:'Not attached', project_program:'Project / programme', retention_short:'Retention',
  wf_circuits:'Workflows', wf_vigie:'My Vigie requests', vigie_empty:'No change or withdrawal request sent to Vigie.', ecr_sent_on:'Sent on', ecr_decided_on:'Vigie decision', ecr_note:'Vigie note', ecr_wait_vigie:'Waiting for Vigie’s decision.',
  wf_requested:'My requests', due_kind:'Kind', due_retention:'Retention', due_expiry:'Expiry', due_review:'Periodic review',
  all_families:'All families', types_count:'types', inactive:'Inactive', people:'People', function_label:'Function', scope:'Scope',
  org_provisional:'Provisional values, pending the organisation chart. The 3-letter department code is part of the ID of documents without attachment.',
  // Rules and states added after review
  st_cancelled:'Cancelled', act_release:'Hold released', release_hold:'Release legal hold', follow_workflow:'Follow the workflow',
  invalid_date:'Invalid date: pick today or a later date.',
  circuit_running:'Approval workflow in progress: reject it or wait for its decision before changing the type or context.',
  delegate_no_approve:'This person cannot approve with their default role.',
  admin_lockout:'Cannot revoke: your role would lose access to administration.',
  not_enforced:'Not enforced in the simulation',
  matrix_not_enforced:'Greyed cells: permission with no action in Codex (Destroy) or role with no simulated equivalent (Reader, Administrator).',
  prev_page:'Previous page', next_page:'Next page', original_file:'Original file', preview_unavailable:'No preview for this format — download the file.',
  conf_hint_conf:'Visible to the department or project team; named readers can be added on the document record.',
  wf_closed_hint:'Locked document: the workflow resumes once the lock is lifted.',
  piece_type_mismatch:'This piece expects a document of type',
  obsolete_since:'Obsolete since', do_not_apply:'no longer applicable',
  act_perm:'Permission changed', act_org_add:'Organisation value added', act_holder_add:'Holder added', act_holder_remove:'Holder removed', act_type:'Type changed', act_comment:'Comment', act_export:'CSV export',
  target:'Target', target_permission:'Permission', target_export:'Export', active_label:'Active', export_rows:'rows', export_full:'full log', export_unfiltered:'no filter', export_interrupted:'interrupted after',
  // « À traiter » (G19)
  todo_empty:'Nothing to do for now.', todo_eco:'to draft', todo_rejected:'sent back to drafting by', todo_draft:'drafted, never sent for approval', todo_assigned:'assigned to', todo_graft:'may be grafted onto revision',
};

export const DICT: Record<Lang, Dict> = { fr, en };
export type T = Dict;
export type TKey = keyof Dict;

/** Headline statuses of a document (lists, filters, facets). */
export const STATUS_KEYS = ['draft', 'in_review', 'approved', 'in_force', 'obsolete', 'archived'] as const;
export const TAGCLS: Record<string, string> = { draft: 'tag tag-neutral', in_review: 'tag tag-outline', approved: 'tag tag-outline', in_force: 'tag tag-accent', superseded: 'tag tag-neutral', cancelled: 'tag tag-neutral', obsolete: 'tag tag-neutral', archived: 'tag tag-neutral' };
/** Tag of a change request status (record › Demandes, Validations › Mes demandes Vigie). */
export const ECR_TAGCLS: Record<string, string> = { submitted: 'tag tag-outline', accepted: 'tag tag-accent', rejected: 'tag tag-neutral', implemented: 'tag tag-accent' };
export const CONF_LEVELS = ['public', 'restreint', 'interne', 'confidentiel', 'tres_confidentiel'] as const;
export const ORIGINS = ['interne', 'externe'] as const;
export const ATTACHMENTS = ['none', 'project', 'research'] as const;
/** Lifecycle stages of a Keystone project (Keystone's own labels), offered as project phases. */
export const PROJECT_PHASES = ['Initiative', 'APS', 'APD', 'Etudes', 'Approvisionnements', 'Fabrication & Assemblage', 'FAT', 'Expédition', 'Chantier', 'Mise Service & SAT', 'Garantie', 'Clos'] as const;
export const SIM_ROLES = ['collaborateur', 'validateur', 'auditeur', 'gestionnaire'] as const;
export type SimRole = (typeof SIM_ROLES)[number];
/** Row of the permission matrix that governs each simulated role. */
export const MATRIX_ROLE: Record<SimRole, string> = { collaborateur: 'contributeur', validateur: 'validateur', auditeur: 'auditeur', gestionnaire: 'gestionnaire' };
export const MATRIX_ROLES = ['lecteur', 'contributeur', 'gestionnaire', 'validateur', 'auditeur', 'administrateur'] as const;
export const MATRIX_ROLE_LABEL: Record<string, TKey> = { lecteur: 'role_lecteur', contributeur: 'role_contributeur', gestionnaire: 'role_gestionnaire_doc', validateur: 'role_validateur_r', auditeur: 'role_auditeur_r', administrateur: 'role_administrateur' };
export const PERMS = ['read', 'upload', 'edit', 'approve', 'publish', 'archive', 'destroy', 'admin'] as const;
export type Perm = (typeof PERMS)[number];
/** Permissions Codex checks somewhere; the others are shown in the matrix but have no action yet. */
export const ENFORCED_PERMS: readonly Perm[] = ['read', 'upload', 'edit', 'approve', 'publish', 'archive', 'admin'];
/** Rows of the matrix that a simulated role reads (the others have no simulated equivalent yet). */
export const SIMULATED_MATRIX_ROLES: readonly string[] = Object.values(MATRIX_ROLE);
