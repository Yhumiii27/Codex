-- Fonction d'édition codex.pub_editer (demande M-19 de Matrix, REQUESTS.md ; accord de Guillaume le 5 novembre 2026 :
-- « traite la demande M-19 » ; décision D-30). Écrite à la main. Convention : docs/edition-par-les-outils.md du dépôt
-- Matrix. Matrix n'écrit jamais lui-même dans les tables de Codex (M-18) : la DSI corrige depuis sa visionneuse, et
-- cette fonction applique les règles et le journal de Codex.
--
-- Tables ouvertes : celles que l'Administration de Codex modifie déjà, avec les mêmes règles :
--   departments       ajouter (code de 3 lettres, libre dans l'espace des codes d'identifiant), corriger (libellés,
--                     actif ; le code ne change jamais : il est dans les identifiants), retirer = rendre inactif ; un
--                     département actif au moins ;
--   sites             ajouter (clé), corriger (libellés, actif), retirer = rendre inactif ;
--   research_programs ajouter (code), corriger (libellé, responsable, actif), retirer = rendre inactif (clos) ;
--   function_holders  ajouter (fonction, valeur de portée, titulaire qui peut approuver), retirer (supprime le titulaire,
--                     comme l'Administration) ; pas de « corriger » : retirer puis ajouter.
-- Toute autre table est refusée : documents, révisions, versions de travail, circuits, demandes, gels et journal suivent
-- les règles documentaires (identifiants immuables, révisions validées par un circuit, journal en ajout seul) et ne se
-- modifient que dans Codex ; les personnes (users) portent des données personnelles.
-- Le journal de Codex (audit_log) reçoit chaque modification sous l'acteur système « matrix », avec la personne connectée
-- à Matrix et le motif. Colonnes inconnues et colonnes de droits.colonnes_sensibles refusées.
CREATE OR REPLACE FUNCTION codex.pub_editer(p_table text, p_action text, p_cle jsonb, p_valeurs jsonb, p_par text, p_motif text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = codex, pg_temp
AS $fn$
DECLARE
  v jsonb := coalesce(p_valeurs, '{}'::jsonb);
  allowed text[];
  k text;
  sensitive int := 0;
  res jsonb;
  before_row jsonb;
  after_row jsonb;
  target_kind text;
  target_id text;
  audit_action text;
  changes jsonb := '[]'::jsonb;
  f text;
  code_v text;
  lbl_fr text;
  lbl_en text;
  name_v text;
  manager text;
  fn_scope text;
  scope_v text;
  user_v text;
  holder_id int;
BEGIN
  IF coalesce(btrim(p_par), '') = '' THEN RAISE EXCEPTION 'Codex : la personne qui modifie (p_par) est obligatoire.'; END IF;
  IF coalesce(btrim(p_motif), '') = '' THEN RAISE EXCEPTION 'Codex : le motif est obligatoire.'; END IF;
  IF length(p_par) > 200 OR length(p_motif) > 2000 THEN RAISE EXCEPTION 'Codex : personne ou motif trop long.'; END IF;
  IF p_action IS NULL OR p_action NOT IN ('ajouter', 'corriger', 'retirer') THEN
    RAISE EXCEPTION 'Codex : action inconnue « % » (ajouter, corriger ou retirer).', p_action;
  END IF;
  IF jsonb_typeof(v) <> 'object' OR (p_cle IS NOT NULL AND jsonb_typeof(p_cle) <> 'object') THEN
    RAISE EXCEPTION 'Codex : la clé et les valeurs sont des objets JSON.';
  END IF;

  allowed := CASE p_table
    WHEN 'departments' THEN ARRAY['code', 'label_fr', 'label_en', 'active']
    WHEN 'sites' THEN ARRAY['key', 'label_fr', 'label_en', 'active']
    WHEN 'research_programs' THEN ARRAY['code', 'name', 'manager_id', 'active']
    WHEN 'function_holders' THEN ARRAY['function_key', 'scope_value', 'user_id']
    ELSE NULL END;
  IF allowed IS NULL THEN
    RAISE EXCEPTION 'Codex : la table « % » ne se modifie pas depuis Matrix. Tables ouvertes : departments, sites, research_programs, function_holders ; les documents, révisions, circuits et le journal suivent les règles documentaires et se modifient dans Codex.', p_table;
  END IF;

  -- Colonnes sensibles (RGPD) : refusées même si Matrix ne les envoie jamais. La liste est lue si Codex peut la lire.
  BEGIN
    IF to_regclass('droits.colonnes_sensibles') IS NOT NULL THEN
      EXECUTE 'SELECT count(*) FROM droits.colonnes_sensibles WHERE schema_nom = ''codex'' AND table_nom = $1 AND colonne_nom = ANY($2)'
        INTO sensitive USING p_table, ARRAY(SELECT jsonb_object_keys(v));
    END IF;
  EXCEPTION WHEN insufficient_privilege OR invalid_schema_name THEN
    sensitive := 0;
  END;
  IF sensitive > 0 THEN RAISE EXCEPTION 'Codex : colonne sensible refusée.'; END IF;
  FOR k IN SELECT jsonb_object_keys(v) LOOP
    IF NOT k = ANY(allowed) THEN RAISE EXCEPTION 'Codex : colonne « % » non modifiable dans % (admises : %).', k, p_table, array_to_string(allowed, ', '); END IF;
  END LOOP;

  -- ── departments ───────────────────────────────────────────────────────
  IF p_table = 'departments' THEN
    target_kind := 'department';
    IF p_action = 'ajouter' THEN
      code_v := upper(btrim(coalesce(v->>'code', '')));
      lbl_fr := btrim(coalesce(v->>'label_fr', ''));
      lbl_en := btrim(coalesce(v->>'label_en', lbl_fr));
      IF code_v !~ '^[A-Z]{3}$' THEN RAISE EXCEPTION 'Codex : code de département attendu : 3 lettres majuscules.'; END IF;
      IF EXISTS (SELECT 1 FROM departments WHERE code = code_v) OR EXISTS (SELECT 1 FROM doc_types WHERE code = code_v)
         OR EXISTS (SELECT 1 FROM projects WHERE code = code_v) OR EXISTS (SELECT 1 FROM research_programs WHERE code = code_v)
         OR EXISTS (SELECT 1 FROM capex WHERE code = code_v) OR code_v = 'QMS' THEN
        RAISE EXCEPTION 'Codex : le code % est déjà pris dans l''espace des codes d''identifiant.', code_v;
      END IF;
      IF lbl_fr = '' OR length(lbl_fr) > 160 OR length(lbl_en) > 160 THEN RAISE EXCEPTION 'Codex : libellé obligatoire, 160 caractères au plus.'; END IF;
      INSERT INTO departments (code, label_fr, label_en, sort)
        VALUES (code_v, lbl_fr, coalesce(nullif(lbl_en, ''), lbl_fr), coalesce((SELECT max(sort) + 1 FROM departments), 0));
      audit_action := 'org_add';
    ELSE
      code_v := p_cle->>'code';
      SELECT to_jsonb(d) INTO before_row FROM departments d WHERE code = code_v FOR UPDATE;
      IF before_row IS NULL THEN RAISE EXCEPTION 'Codex : département % introuvable.', code_v; END IF;
      IF v ? 'code' AND v->>'code' IS DISTINCT FROM code_v THEN RAISE EXCEPTION 'Codex : le code d''un département ne change jamais (il est dans les identifiants des documents).'; END IF;
      IF p_action = 'retirer' THEN v := jsonb_build_object('active', false); END IF;
      IF v ? 'label_fr' AND (btrim(v->>'label_fr') = '' OR length(v->>'label_fr') > 160) THEN RAISE EXCEPTION 'Codex : libellé obligatoire, 160 caractères au plus.'; END IF;
      IF v ? 'label_en' AND (btrim(v->>'label_en') = '' OR length(v->>'label_en') > 160) THEN RAISE EXCEPTION 'Codex : libellé obligatoire, 160 caractères au plus.'; END IF;
      IF v ? 'active' AND jsonb_typeof(v->'active') <> 'boolean' THEN RAISE EXCEPTION 'Codex : actif attendu en booléen.'; END IF;
      IF (before_row->>'active')::boolean AND v ? 'active' AND NOT (v->>'active')::boolean
         AND NOT EXISTS (SELECT 1 FROM departments WHERE active AND code <> code_v) THEN
        RAISE EXCEPTION 'Codex : un département actif au moins doit rester.';
      END IF;
      UPDATE departments SET
        label_fr = coalesce(btrim(v->>'label_fr'), departments.label_fr), label_en = coalesce(btrim(v->>'label_en'), departments.label_en),
        active = coalesce((v->>'active')::boolean, active)
        WHERE code = code_v;
      audit_action := 'org_edit';
    END IF;
    SELECT to_jsonb(d) INTO after_row FROM departments d WHERE code = code_v;
    target_id := code_v;
    FOREACH f IN ARRAY ARRAY['code', 'label_fr', 'label_en', 'active'] LOOP
      IF before_row IS NULL OR before_row->f IS DISTINCT FROM after_row->f THEN
        changes := changes || jsonb_build_array(jsonb_build_object('field', CASE f WHEN 'label_fr' THEN 'labelFr' WHEN 'label_en' THEN 'labelEn' ELSE f END,
          'before', CASE WHEN before_row IS NULL THEN NULL ELSE before_row->f END, 'after', after_row->f));
      END IF;
    END LOOP;
    res := after_row - 'featured';

  -- ── sites ─────────────────────────────────────────────────────────────
  ELSIF p_table = 'sites' THEN
    target_kind := 'site';
    IF p_action = 'ajouter' THEN
      code_v := btrim(coalesce(v->>'key', ''));
      lbl_fr := btrim(coalesce(v->>'label_fr', ''));
      lbl_en := btrim(coalesce(v->>'label_en', lbl_fr));
      IF code_v !~ '^[a-z0-9][a-z0-9_]{0,31}$' THEN RAISE EXCEPTION 'Codex : clé de site attendue : minuscules, chiffres et _ (32 au plus).'; END IF;
      IF EXISTS (SELECT 1 FROM sites WHERE key = code_v) THEN RAISE EXCEPTION 'Codex : le site % existe déjà.', code_v; END IF;
      IF lbl_fr = '' OR length(lbl_fr) > 160 OR length(lbl_en) > 160 THEN RAISE EXCEPTION 'Codex : libellé obligatoire, 160 caractères au plus.'; END IF;
      INSERT INTO sites (key, label_fr, label_en, sort)
        VALUES (code_v, lbl_fr, coalesce(nullif(lbl_en, ''), lbl_fr), coalesce((SELECT max(sort) + 1 FROM sites), 0));
      audit_action := 'org_add';
    ELSE
      code_v := p_cle->>'key';
      SELECT to_jsonb(x) INTO before_row FROM sites x WHERE key = code_v FOR UPDATE;
      IF before_row IS NULL THEN RAISE EXCEPTION 'Codex : site % introuvable.', code_v; END IF;
      IF v ? 'key' AND v->>'key' IS DISTINCT FROM code_v THEN RAISE EXCEPTION 'Codex : la clé d''un site ne change pas.'; END IF;
      IF p_action = 'retirer' THEN v := jsonb_build_object('active', false); END IF;
      IF v ? 'label_fr' AND (btrim(v->>'label_fr') = '' OR length(v->>'label_fr') > 160) THEN RAISE EXCEPTION 'Codex : libellé obligatoire, 160 caractères au plus.'; END IF;
      IF v ? 'label_en' AND (btrim(v->>'label_en') = '' OR length(v->>'label_en') > 160) THEN RAISE EXCEPTION 'Codex : libellé obligatoire, 160 caractères au plus.'; END IF;
      IF v ? 'active' AND jsonb_typeof(v->'active') <> 'boolean' THEN RAISE EXCEPTION 'Codex : actif attendu en booléen.'; END IF;
      UPDATE sites SET
        label_fr = coalesce(btrim(v->>'label_fr'), sites.label_fr), label_en = coalesce(btrim(v->>'label_en'), sites.label_en),
        active = coalesce((v->>'active')::boolean, active)
        WHERE key = code_v;
      audit_action := 'org_edit';
    END IF;
    SELECT to_jsonb(x) INTO after_row FROM sites x WHERE key = code_v;
    target_id := code_v;
    FOREACH f IN ARRAY ARRAY['key', 'label_fr', 'label_en', 'active'] LOOP
      IF before_row IS NULL OR before_row->f IS DISTINCT FROM after_row->f THEN
        changes := changes || jsonb_build_array(jsonb_build_object('field', CASE f WHEN 'label_fr' THEN 'labelFr' WHEN 'label_en' THEN 'labelEn' ELSE f END,
          'before', CASE WHEN before_row IS NULL THEN NULL ELSE before_row->f END, 'after', after_row->f));
      END IF;
    END LOOP;
    res := after_row;

  -- ── research_programs ─────────────────────────────────────────────────
  ELSIF p_table = 'research_programs' THEN
    target_kind := 'program';
    IF p_action = 'ajouter' THEN
      code_v := upper(btrim(coalesce(v->>'code', '')));
      name_v := btrim(coalesce(v->>'name', ''));
      manager := btrim(coalesce(v->>'manager_id', ''));
      IF code_v !~ '^[A-Z][A-Z0-9]{2,9}$' THEN RAISE EXCEPTION 'Codex : code de programme attendu : une majuscule puis 2 à 9 majuscules ou chiffres.'; END IF;
      IF EXISTS (SELECT 1 FROM research_programs WHERE code = code_v) OR EXISTS (SELECT 1 FROM doc_types WHERE code = code_v)
         OR EXISTS (SELECT 1 FROM projects WHERE code = code_v) OR EXISTS (SELECT 1 FROM departments WHERE code = code_v)
         OR EXISTS (SELECT 1 FROM capex WHERE code = code_v) OR code_v = 'QMS' THEN
        RAISE EXCEPTION 'Codex : le code % est déjà pris dans l''espace des codes d''identifiant.', code_v;
      END IF;
      IF name_v = '' OR length(name_v) > 160 THEN RAISE EXCEPTION 'Codex : libellé obligatoire, 160 caractères au plus.'; END IF;
      IF NOT EXISTS (SELECT 1 FROM users WHERE id = manager AND NOT is_system) THEN RAISE EXCEPTION 'Codex : responsable % inconnu.', manager; END IF;
      INSERT INTO research_programs (code, name, manager_id) VALUES (code_v, name_v, manager);
      audit_action := 'program_add';
    ELSE
      code_v := p_cle->>'code';
      SELECT to_jsonb(x) INTO before_row FROM research_programs x WHERE code = code_v FOR UPDATE;
      IF before_row IS NULL THEN RAISE EXCEPTION 'Codex : programme % introuvable.', code_v; END IF;
      IF v ? 'code' AND v->>'code' IS DISTINCT FROM code_v THEN RAISE EXCEPTION 'Codex : le code d''un programme ne change pas depuis Matrix (il est dans les identifiants des documents).'; END IF;
      IF p_action = 'retirer' THEN v := jsonb_build_object('active', false); END IF;
      IF v ? 'name' AND (btrim(v->>'name') = '' OR length(v->>'name') > 160) THEN RAISE EXCEPTION 'Codex : libellé obligatoire, 160 caractères au plus.'; END IF;
      IF v ? 'manager_id' AND NOT EXISTS (SELECT 1 FROM users WHERE id = v->>'manager_id' AND NOT is_system) THEN RAISE EXCEPTION 'Codex : responsable % inconnu.', v->>'manager_id'; END IF;
      IF v ? 'active' AND jsonb_typeof(v->'active') <> 'boolean' THEN RAISE EXCEPTION 'Codex : actif attendu en booléen.'; END IF;
      UPDATE research_programs SET
        name = coalesce(btrim(v->>'name'), name), manager_id = coalesce(v->>'manager_id', manager_id),
        active = coalesce((v->>'active')::boolean, active)
        WHERE code = code_v;
      audit_action := 'program';
    END IF;
    SELECT to_jsonb(x) INTO after_row FROM research_programs x WHERE code = code_v;
    target_id := code_v;
    FOREACH f IN ARRAY ARRAY['code', 'name', 'manager_id', 'active'] LOOP
      IF before_row IS NULL OR before_row->f IS DISTINCT FROM after_row->f THEN
        changes := changes || jsonb_build_array(jsonb_build_object('field', CASE f WHEN 'manager_id' THEN 'managerId' ELSE f END,
          'before', CASE WHEN before_row IS NULL THEN NULL ELSE before_row->f END, 'after', after_row->f));
      END IF;
    END LOOP;
    res := after_row;

  -- ── function_holders ──────────────────────────────────────────────────
  ELSE
    target_kind := 'function';
    IF p_action = 'corriger' THEN RAISE EXCEPTION 'Codex : un titulaire ne se corrige pas : retirez-le puis ajoutez le nouveau.'; END IF;
    IF p_action = 'ajouter' THEN
      k := btrim(coalesce(v->>'function_key', ''));
      user_v := btrim(coalesce(v->>'user_id', ''));
      scope_v := nullif(btrim(coalesce(v->>'scope_value', '')), '');
      SELECT scope INTO fn_scope FROM functions WHERE key = k;
      IF fn_scope IS NULL THEN RAISE EXCEPTION 'Codex : fonction % inconnue.', k; END IF;
      IF fn_scope = 'global' THEN scope_v := NULL; END IF;
      IF scope_v IS NOT NULL AND NOT (
           (fn_scope = 'department' AND EXISTS (SELECT 1 FROM departments WHERE code = scope_v))
        OR (fn_scope = 'project' AND EXISTS (SELECT 1 FROM projects WHERE code = scope_v))
        OR (fn_scope = 'research' AND EXISTS (SELECT 1 FROM research_programs WHERE code = scope_v AND active))) THEN
        RAISE EXCEPTION 'Codex : valeur de portée % non admise pour la fonction %.', scope_v, k;
      END IF;
      -- A holder decides approval steps: their default role must be able to approve (lib/lifecycle.ts approverCheck).
      IF NOT EXISTS (SELECT 1 FROM users u JOIN role_permissions rp
            ON rp.role = CASE u.role WHEN 'collaborateur' THEN 'contributeur' ELSE u.role END AND rp.perm = 'approve' AND rp.granted
          WHERE u.id = user_v AND NOT u.is_system) THEN
        RAISE EXCEPTION 'Codex : % ne peut pas être titulaire : personne inconnue ou dont le rôle ne peut pas approuver.', user_v;
      END IF;
      INSERT INTO function_holders (function_key, scope_value, user_id) VALUES (k, scope_v, user_v) RETURNING id INTO holder_id;
      SELECT to_jsonb(h) INTO after_row FROM function_holders h WHERE id = holder_id;
      audit_action := 'holder_add';
      changes := jsonb_build_array(jsonb_build_object('field', 'holder', 'scope', scope_v, 'before', NULL, 'after', user_v));
    ELSE
      IF jsonb_typeof(p_cle->'id') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'Codex : clé attendue : {"id": <numéro du titulaire>}.'; END IF;
      DELETE FROM function_holders WHERE id = (p_cle->>'id')::int RETURNING to_jsonb(function_holders.*) INTO before_row;
      IF before_row IS NULL THEN RAISE EXCEPTION 'Codex : titulaire % introuvable.', p_cle->>'id'; END IF;
      k := before_row->>'function_key';
      audit_action := 'holder_remove';
      changes := jsonb_build_array(jsonb_build_object('field', 'holder', 'scope', before_row->'scope_value', 'before', before_row->'user_id', 'after', NULL));
      after_row := before_row;
    END IF;
    target_id := k;
    res := after_row;
  END IF;

  -- Journal of Codex (append-only), under the system actor « matrix », created the first time it acts.
  INSERT INTO users (id, name, initials, role, is_system) VALUES ('matrix', 'Matrix', 'MX', 'system', true) ON CONFLICT (id) DO NOTHING;
  IF jsonb_array_length(changes) > 0 THEN
    INSERT INTO audit_log (at, user_id, action, target_kind, target_id, detail, data)
      VALUES (now(), 'matrix', audit_action, target_kind, target_id, '',
        jsonb_build_object('changes', changes, 'via', jsonb_build_object('app', 'matrix', 'person', btrim(p_par), 'reason', btrim(p_motif))));
  END IF;
  RETURN res;
END
$fn$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION codex.pub_editer(text, text, jsonb, jsonb, text, text) FROM PUBLIC;
