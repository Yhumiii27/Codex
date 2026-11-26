CREATE TABLE "codex"."destroyed_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"type_code" text NOT NULL,
	"subtype" text,
	"source_ref" text NOT NULL,
	"app" text NOT NULL,
	"reason" text NOT NULL,
	"filed_at" date NOT NULL,
	"destroyed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "destroyed_documents_source_ref_unique" UNIQUE("source_ref"),
	CONSTRAINT "destroyed_documents_reason_check" CHECK ("codex"."destroyed_documents"."reason" in ('retrait', 'conservation', 'effacement')),
	CONSTRAINT "destroyed_documents_source_ref_check" CHECK ("codex"."destroyed_documents"."source_ref" ~ '^[a-z][a-z0-9_-]{1,31}:')
);
--> statement-breakpoint
ALTER TABLE "codex"."documents" ADD COLUMN "subject_matricule" text;--> statement-breakpoint
ALTER TABLE "codex"."destroyed_documents" ADD CONSTRAINT "destroyed_documents_app_users_id_fk" FOREIGN KEY ("app") REFERENCES "codex"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "documents_subject" ON "codex"."documents" USING btree ("subject_matricule") WHERE "codex"."documents"."subject_matricule" is not null;--> statement-breakpoint
ALTER TABLE "codex"."documents" ADD CONSTRAINT "documents_subject_matricule_check" CHECK ("codex"."documents"."subject_matricule" IS NULL OR "codex"."documents"."subject_matricule" ~ '^(EMP-[0-9]{4,}|[IE][0-9]+)$');