CREATE TABLE "codex"."capex" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"subsidiary_code" text,
	"subsidiary" text,
	"site" text,
	"status" text,
	"phase" text,
	"active" boolean DEFAULT true NOT NULL,
	"synced_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "codex"."documents" ADD COLUMN "capex_code" text;--> statement-breakpoint
ALTER TABLE "codex"."documents" ADD CONSTRAINT "documents_capex_code_capex_code_fk" FOREIGN KEY ("capex_code") REFERENCES "codex"."capex"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "documents_capex" ON "codex"."documents" USING btree ("capex_code") WHERE "codex"."documents"."capex_code" is not null;
--> statement-breakpoint
-- Données (écrit à la main ; demandes CX-01 et CX-02 d'Arche, choix de l'utilisateur du 1er novembre 2026, D-29). Sur une
-- base neuve, doc_types est vide ici : la graine écrit ensuite src/db/registry.ts, qui a les mêmes valeurs.
-- Le rattachement capex est admis par chaque type qui admet le rattachement projet, et par FIN (AFE).
UPDATE "codex"."doc_types" SET "attachments" = "attachments" || '["capex"]'::jsonb
 WHERE ("attachments" ? 'project' OR "code" = 'FIN') AND NOT "attachments" ? 'capex';
--> statement-breakpoint
UPDATE "codex"."doc_types" SET "subtypes" = "subtypes" || jsonb_build_array(jsonb_build_object('fr', 'Plan de masse'::text, 'en', 'Site plan'::text))
 WHERE "code" = 'GA' AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements("subtypes") e WHERE e->>'fr' = 'Plan de masse');
--> statement-breakpoint
UPDATE "codex"."doc_types" SET "subtypes" = "subtypes" || jsonb_build_array(jsonb_build_object('fr', 'HazID'::text, 'en', 'HAZID'::text))
 WHERE "code" = 'RSQ' AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements("subtypes") e WHERE e->>'fr' = 'HazID');
--> statement-breakpoint
UPDATE "codex"."doc_types" SET "subtypes" = "subtypes" || jsonb_build_array(jsonb_build_object('fr', 'HazOp / AMDEC'::text, 'en', 'HAZOP / FMECA'::text))
 WHERE "code" = 'RSQ' AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements("subtypes") e WHERE e->>'fr' = 'HazOp / AMDEC');
--> statement-breakpoint
UPDATE "codex"."doc_types" SET "subtypes" = "subtypes" || jsonb_build_array(jsonb_build_object('fr', 'Zonage ATEX (DRPCE)'::text, 'en', 'ATEX zoning (DRPCE)'::text))
 WHERE "code" = 'RSQ' AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements("subtypes") e WHERE e->>'fr' = 'Zonage ATEX (DRPCE)');
--> statement-breakpoint
UPDATE "codex"."doc_types" SET "subtypes" = "subtypes" || jsonb_build_array(jsonb_build_object('fr', 'PSSR / RSPDI'::text, 'en', 'PSSR / RSPDI'::text))
 WHERE "code" = 'RSQ' AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements("subtypes") e WHERE e->>'fr' = 'PSSR / RSPDI');
--> statement-breakpoint
UPDATE "codex"."doc_types" SET "subtypes" = "subtypes" || jsonb_build_array(jsonb_build_object('fr', 'Audit ASPD'::text, 'en', 'ASPD audit'::text))
 WHERE "code" = 'RSQ' AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements("subtypes") e WHERE e->>'fr' = 'Audit ASPD');
--> statement-breakpoint
UPDATE "codex"."doc_types" SET "subtypes" = "subtypes" || jsonb_build_array(jsonb_build_object('fr', 'Dossier ICPE'::text, 'en', 'ICPE file'::text))
 WHERE "code" = 'AUT' AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements("subtypes") e WHERE e->>'fr' = 'Dossier ICPE');
--> statement-breakpoint
UPDATE "codex"."doc_types" SET "subtypes" = "subtypes" || jsonb_build_array(jsonb_build_object('fr', 'Permis de construire / PLU'::text, 'en', 'Building permit / local plan'::text))
 WHERE "code" = 'AUT' AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements("subtypes") e WHERE e->>'fr' = 'Permis de construire / PLU');
--> statement-breakpoint
UPDATE "codex"."doc_types" SET "subtypes" = "subtypes" || jsonb_build_array(jsonb_build_object('fr', 'AFE (autorisation de dépense)'::text, 'en', 'AFE (authorisation for expenditure)'::text))
 WHERE "code" = 'FIN' AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements("subtypes") e WHERE e->>'fr' = 'AFE (autorisation de dépense)');
--> statement-breakpoint
UPDATE "codex"."doc_types" SET "subtypes" = "subtypes" || jsonb_build_array(jsonb_build_object('fr', 'Dossier d’investissement'::text, 'en', 'Investment file'::text))
 WHERE "code" = 'DEF' AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements("subtypes") e WHERE e->>'fr' = 'Dossier d’investissement');
--> statement-breakpoint
UPDATE "codex"."doc_types" SET "subtypes" = "subtypes" || jsonb_build_array(jsonb_build_object('fr', 'Dossier de jalon G1'::text, 'en', 'Gate file G1'::text))
 WHERE "code" = 'DEF' AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements("subtypes") e WHERE e->>'fr' = 'Dossier de jalon G1');
--> statement-breakpoint
UPDATE "codex"."doc_types" SET "subtypes" = "subtypes" || jsonb_build_array(jsonb_build_object('fr', 'Dossier de jalon G2'::text, 'en', 'Gate file G2'::text))
 WHERE "code" = 'DEF' AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements("subtypes") e WHERE e->>'fr' = 'Dossier de jalon G2');
--> statement-breakpoint
UPDATE "codex"."doc_types" SET "subtypes" = "subtypes" || jsonb_build_array(jsonb_build_object('fr', 'Dossier de jalon G3'::text, 'en', 'Gate file G3'::text))
 WHERE "code" = 'DEF' AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements("subtypes") e WHERE e->>'fr' = 'Dossier de jalon G3');
--> statement-breakpoint
UPDATE "codex"."doc_types" SET "subtypes" = "subtypes" || jsonb_build_array(jsonb_build_object('fr', 'PV de transfert d’actif'::text, 'en', 'Asset transfer record'::text))
 WHERE "code" = 'REM' AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements("subtypes") e WHERE e->>'fr' = 'PV de transfert d’actif');
