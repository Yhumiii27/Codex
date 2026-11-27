CREATE TABLE "codex"."project_team" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_code" text NOT NULL,
	"clavis_person_id" text,
	"matricule" text,
	"name" text NOT NULL,
	"email" text,
	"origin" text NOT NULL,
	"role" text,
	"synced_at" timestamp with time zone NOT NULL,
	CONSTRAINT "project_team_origin_check" CHECK ("codex"."project_team"."origin" IN ('equipe', 'affectation', 'partie_prenante')),
	CONSTRAINT "project_team_person_check" CHECK ("codex"."project_team"."clavis_person_id" IS NOT NULL OR "codex"."project_team"."matricule" IS NOT NULL),
	CONSTRAINT "project_team_name_check" CHECK (btrim("codex"."project_team"."name") <> '')
);
--> statement-breakpoint
ALTER TABLE "codex"."projects" ADD COLUMN "confidentiality" text DEFAULT 'normal' NOT NULL;--> statement-breakpoint
ALTER TABLE "codex"."project_team" ADD CONSTRAINT "project_team_project_code_projects_code_fk" FOREIGN KEY ("project_code") REFERENCES "codex"."projects"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_team_project" ON "codex"."project_team" USING btree ("project_code");--> statement-breakpoint
ALTER TABLE "codex"."projects" ADD CONSTRAINT "projects_confidentiality_check" CHECK ("codex"."projects"."confidentiality" IN ('normal', 'confidentiel'));