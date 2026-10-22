ALTER TABLE "doc_types" ADD COLUMN "retention_basis_en" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "template_id" text;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_template_id_documents_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "documents_template" ON "documents" USING btree ("template_id") WHERE "documents"."template_id" is not null;--> statement-breakpoint
-- Reprise : le modèle source d'un document créé avant cette migration n'est retenu que s'il se lit sans doute possible.
-- createDocument écrivait le commentaire de A.1 « Créé depuis le modèle {ID} « {titre} » » (et son anglais) et
-- terminait le détail de l'entrée « upload » du journal (sous l'identifiant d'alors) par « · {ID} ». Les trois doivent nommer le même document,
-- qui existe sous cet identifiant et est de type FRM ; sinon template_id reste nul (docs/decisions.md).
UPDATE "documents" d SET "template_id" = src.tpl
FROM (
  SELECT w."doc_id", substring(w."comment"->>'fr' from '^Créé depuis le modèle (\S+) « ') AS tpl
  FROM "working_versions" w
  JOIN "revisions" r ON r."id" = w."revision_id" AND r."letter" = 'A'
  WHERE w."n" = 1 AND jsonb_typeof(w."comment") = 'object'
    AND w."comment"->>'fr' ~ '^Créé depuis le modèle \S+ « '
    AND substring(w."comment"->>'en' from '^Created from template (\S+) “') = substring(w."comment"->>'fr' from '^Créé depuis le modèle (\S+) « ')
) src
WHERE d."id" = src."doc_id" AND d."template_id" IS NULL AND src.tpl <> d."id"
  AND EXISTS (SELECT 1 FROM "documents" t WHERE t."id" = src.tpl AND t."type_code" = 'FRM')
  AND EXISTS (SELECT 1 FROM "audit_log" a WHERE (a."doc_id" = d."id" OR d."aliases" @> jsonb_build_array(a."doc_id")) AND a."action" = 'upload' AND right(a."detail", length(src.tpl) + 3) = ' · ' || src.tpl);
