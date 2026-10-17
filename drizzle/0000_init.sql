CREATE TABLE "codex"."audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"at" timestamp NOT NULL,
	"user_id" text NOT NULL,
	"action" text NOT NULL,
	"doc_id" text NOT NULL,
	"detail" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "codex"."change_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"doc_id" text NOT NULL,
	"requester_id" text NOT NULL,
	"reason" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" text NOT NULL,
	"eco_ref" text,
	"modifier_id" text,
	"decision_note" text,
	"source" text DEFAULT 'codex' NOT NULL,
	"created_at" timestamp NOT NULL,
	"decided_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "codex"."departments" (
	"code" text PRIMARY KEY NOT NULL,
	"label_fr" text NOT NULL,
	"label_en" text NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "codex"."doc_types" (
	"code" text PRIMARY KEY NOT NULL,
	"label_fr" text NOT NULL,
	"label_en" text NOT NULL,
	"family" text NOT NULL,
	"origins" jsonb NOT NULL,
	"attachments" jsonb NOT NULL,
	"subtypes" jsonb NOT NULL,
	"circuit" jsonb NOT NULL,
	"retention_years" integer,
	"retention_trigger" text NOT NULL,
	"retention_disposition" text NOT NULL,
	"retention_basis" text DEFAULT '' NOT NULL,
	"conf_allowed" jsonb NOT NULL,
	"conf_default" text NOT NULL,
	"iso" text,
	"client_deliverable" boolean DEFAULT false NOT NULL,
	"source" text DEFAULT 'deck' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "codex"."document_readers" (
	"doc_id" text NOT NULL,
	"user_id" text NOT NULL,
	CONSTRAINT "document_readers_doc_id_user_id_pk" PRIMARY KEY("doc_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "codex"."documents" (
	"id" text PRIMARY KEY NOT NULL,
	"aliases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"title" text NOT NULL,
	"origin" text NOT NULL,
	"attachment" text NOT NULL,
	"project_code" text,
	"program_code" text,
	"family" text NOT NULL,
	"type_code" text NOT NULL,
	"subtype" text,
	"department" text NOT NULL,
	"site" text,
	"owner_id" text NOT NULL,
	"author_id" text,
	"author_text" text,
	"conf" text NOT NULL,
	"keywords" jsonb NOT NULL,
	"lang" text,
	"state" text DEFAULT 'active' NOT NULL,
	"status" text NOT NULL,
	"rev_in_force" text,
	"rev_working" text,
	"issued_at" date,
	"review_due_at" date,
	"expires_at" date,
	"retention_years" integer,
	"retention_trigger" text NOT NULL,
	"retention_disposition" text NOT NULL,
	"source_org" text,
	"external_ref" text,
	"received_at" date,
	"project_phase" text,
	"work_package" text,
	"discipline" text,
	"research_theme" text,
	"study_id" text,
	"ip_status" text,
	"process_owner_id" text,
	"legal_hold" boolean DEFAULT false NOT NULL,
	"legal_hold_at" date,
	"obsolete_at" date,
	"archived_at" date,
	"created_at" date NOT NULL,
	"modified_at" date NOT NULL
);
--> statement-breakpoint
CREATE TABLE "codex"."families" (
	"key" text PRIMARY KEY NOT NULL,
	"label_fr" text NOT NULL,
	"label_en" text NOT NULL,
	"grp" text NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "codex"."function_holders" (
	"id" serial PRIMARY KEY NOT NULL,
	"function_key" text NOT NULL,
	"scope_value" text,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "codex"."functions" (
	"key" text PRIMARY KEY NOT NULL,
	"label_fr" text NOT NULL,
	"label_en" text NOT NULL,
	"scope" text NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "codex"."project_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_code" text NOT NULL,
	"at" timestamp NOT NULL,
	"text" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "codex"."project_expected" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_code" text NOT NULL,
	"label" jsonb NOT NULL,
	"type_code" text,
	"doc_id" text,
	"later" boolean DEFAULT false NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "codex"."projects" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"client" text NOT NULL,
	"stage" text NOT NULL,
	"manager_id" text NOT NULL,
	"site" text NOT NULL,
	"tiers" text NOT NULL,
	"synced_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "codex"."research_programs" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"manager_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "codex"."revisions" (
	"id" serial PRIMARY KEY NOT NULL,
	"doc_id" text NOT NULL,
	"letter" text NOT NULL,
	"status" text NOT NULL,
	"effective_at" date,
	"approved_at" date,
	"in_force_at" date,
	"superseded_at" date,
	"modifier_id" text,
	"change_ref" text,
	"created_at" date NOT NULL
);
--> statement-breakpoint
CREATE TABLE "codex"."role_permissions" (
	"role" text NOT NULL,
	"perm" text NOT NULL,
	"granted" boolean NOT NULL,
	CONSTRAINT "role_permissions_role_perm_pk" PRIMARY KEY("role","perm")
);
--> statement-breakpoint
CREATE TABLE "codex"."saved_searches" (
	"id" serial PRIMARY KEY NOT NULL,
	"label" jsonb NOT NULL,
	"q" text DEFAULT '' NOT NULL,
	"facets" jsonb NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "codex"."sites" (
	"key" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "codex"."users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"initials" text NOT NULL,
	"role" text NOT NULL,
	"title" jsonb,
	"department" text,
	"site" text,
	"is_system" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "codex"."workflow_comments" (
	"id" serial PRIMARY KEY NOT NULL,
	"workflow_id" text NOT NULL,
	"author_id" text NOT NULL,
	"at" date NOT NULL,
	"text" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "codex"."workflow_steps" (
	"workflow_id" text NOT NULL,
	"idx" integer NOT NULL,
	"function_key" text,
	"name" jsonb NOT NULL,
	"assignee_id" text NOT NULL,
	"date" date,
	"sign" boolean DEFAULT false NOT NULL,
	CONSTRAINT "workflow_steps_workflow_id_idx_pk" PRIMARY KEY("workflow_id","idx")
);
--> statement-breakpoint
CREATE TABLE "codex"."workflows" (
	"id" text PRIMARY KEY NOT NULL,
	"doc_id" text NOT NULL,
	"revision_id" integer NOT NULL,
	"requester_id" text NOT NULL,
	"due" date NOT NULL,
	"step" integer NOT NULL,
	"outcome" text,
	"created_at" date NOT NULL
);
--> statement-breakpoint
CREATE TABLE "codex"."working_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"revision_id" integer NOT NULL,
	"doc_id" text NOT NULL,
	"n" integer NOT NULL,
	"comment" jsonb NOT NULL,
	"author_id" text NOT NULL,
	"date" date NOT NULL,
	"storage" text,
	"file_key" text,
	"file_name" text,
	"mime" text,
	"size" integer,
	"pages" integer
);
--> statement-breakpoint
ALTER TABLE "codex"."audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "codex"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex"."change_requests" ADD CONSTRAINT "change_requests_doc_id_documents_id_fk" FOREIGN KEY ("doc_id") REFERENCES "codex"."documents"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "codex"."change_requests" ADD CONSTRAINT "change_requests_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "codex"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex"."change_requests" ADD CONSTRAINT "change_requests_modifier_id_users_id_fk" FOREIGN KEY ("modifier_id") REFERENCES "codex"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex"."doc_types" ADD CONSTRAINT "doc_types_family_families_key_fk" FOREIGN KEY ("family") REFERENCES "codex"."families"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex"."document_readers" ADD CONSTRAINT "document_readers_doc_id_documents_id_fk" FOREIGN KEY ("doc_id") REFERENCES "codex"."documents"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "codex"."document_readers" ADD CONSTRAINT "document_readers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "codex"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex"."documents" ADD CONSTRAINT "documents_project_code_projects_code_fk" FOREIGN KEY ("project_code") REFERENCES "codex"."projects"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex"."documents" ADD CONSTRAINT "documents_program_code_research_programs_code_fk" FOREIGN KEY ("program_code") REFERENCES "codex"."research_programs"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex"."documents" ADD CONSTRAINT "documents_family_families_key_fk" FOREIGN KEY ("family") REFERENCES "codex"."families"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex"."documents" ADD CONSTRAINT "documents_type_code_doc_types_code_fk" FOREIGN KEY ("type_code") REFERENCES "codex"."doc_types"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex"."documents" ADD CONSTRAINT "documents_department_departments_code_fk" FOREIGN KEY ("department") REFERENCES "codex"."departments"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex"."documents" ADD CONSTRAINT "documents_site_sites_key_fk" FOREIGN KEY ("site") REFERENCES "codex"."sites"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex"."documents" ADD CONSTRAINT "documents_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "codex"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex"."documents" ADD CONSTRAINT "documents_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "codex"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex"."documents" ADD CONSTRAINT "documents_process_owner_id_users_id_fk" FOREIGN KEY ("process_owner_id") REFERENCES "codex"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex"."function_holders" ADD CONSTRAINT "function_holders_function_key_functions_key_fk" FOREIGN KEY ("function_key") REFERENCES "codex"."functions"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex"."function_holders" ADD CONSTRAINT "function_holders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "codex"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex"."project_events" ADD CONSTRAINT "project_events_project_code_projects_code_fk" FOREIGN KEY ("project_code") REFERENCES "codex"."projects"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex"."project_expected" ADD CONSTRAINT "project_expected_project_code_projects_code_fk" FOREIGN KEY ("project_code") REFERENCES "codex"."projects"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex"."project_expected" ADD CONSTRAINT "project_expected_type_code_doc_types_code_fk" FOREIGN KEY ("type_code") REFERENCES "codex"."doc_types"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex"."project_expected" ADD CONSTRAINT "project_expected_doc_id_documents_id_fk" FOREIGN KEY ("doc_id") REFERENCES "codex"."documents"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "codex"."projects" ADD CONSTRAINT "projects_manager_id_users_id_fk" FOREIGN KEY ("manager_id") REFERENCES "codex"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex"."research_programs" ADD CONSTRAINT "research_programs_manager_id_users_id_fk" FOREIGN KEY ("manager_id") REFERENCES "codex"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex"."revisions" ADD CONSTRAINT "revisions_doc_id_documents_id_fk" FOREIGN KEY ("doc_id") REFERENCES "codex"."documents"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "codex"."revisions" ADD CONSTRAINT "revisions_modifier_id_users_id_fk" FOREIGN KEY ("modifier_id") REFERENCES "codex"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex"."users" ADD CONSTRAINT "users_department_departments_code_fk" FOREIGN KEY ("department") REFERENCES "codex"."departments"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex"."users" ADD CONSTRAINT "users_site_sites_key_fk" FOREIGN KEY ("site") REFERENCES "codex"."sites"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex"."workflow_comments" ADD CONSTRAINT "workflow_comments_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "codex"."workflows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex"."workflow_comments" ADD CONSTRAINT "workflow_comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "codex"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex"."workflow_steps" ADD CONSTRAINT "workflow_steps_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "codex"."workflows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex"."workflow_steps" ADD CONSTRAINT "workflow_steps_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "codex"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex"."workflows" ADD CONSTRAINT "workflows_doc_id_documents_id_fk" FOREIGN KEY ("doc_id") REFERENCES "codex"."documents"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "codex"."workflows" ADD CONSTRAINT "workflows_revision_id_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "codex"."revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex"."workflows" ADD CONSTRAINT "workflows_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "codex"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex"."working_versions" ADD CONSTRAINT "working_versions_revision_id_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "codex"."revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex"."working_versions" ADD CONSTRAINT "working_versions_doc_id_documents_id_fk" FOREIGN KEY ("doc_id") REFERENCES "codex"."documents"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "codex"."working_versions" ADD CONSTRAINT "working_versions_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "codex"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "change_requests_pending" ON "codex"."change_requests" USING btree ("doc_id") WHERE "codex"."change_requests"."status" in ('submitted', 'accepted');--> statement-breakpoint
CREATE UNIQUE INDEX "revisions_doc_letter" ON "codex"."revisions" USING btree ("doc_id","letter");--> statement-breakpoint
CREATE UNIQUE INDEX "revisions_in_force" ON "codex"."revisions" USING btree ("doc_id") WHERE "codex"."revisions"."status" = 'in_force';--> statement-breakpoint
CREATE UNIQUE INDEX "workflows_running" ON "codex"."workflows" USING btree ("revision_id") WHERE "codex"."workflows"."outcome" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "working_versions_rev_n" ON "codex"."working_versions" USING btree ("revision_id","n");