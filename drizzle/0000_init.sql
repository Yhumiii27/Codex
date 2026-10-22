CREATE TABLE "codex"."audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"user_id" text NOT NULL,
	"action" text NOT NULL,
	"doc_id" text,
	"target_kind" text,
	"target_id" text,
	"detail" text DEFAULT '' NOT NULL,
	"data" jsonb,
	"revision_id" integer,
	CONSTRAINT "audit_log_subject" CHECK ("codex"."audit_log"."doc_id" is not null or ("codex"."audit_log"."target_kind" is not null and "codex"."audit_log"."target_id" is not null))
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
	"revision_id" integer,
	"decision_note" text,
	"replacement_id" text,
	"source" text DEFAULT 'codex' NOT NULL,
	"created_at" timestamp NOT NULL,
	"decided_at" timestamp,
	CONSTRAINT "change_requests_replacement" CHECK ("codex"."change_requests"."replacement_id" is null or ("codex"."change_requests"."kind" = 'obsolescence' and "codex"."change_requests"."replacement_id" <> "codex"."change_requests"."doc_id"))
);
--> statement-breakpoint
CREATE TABLE "codex"."departments" (
	"code" text PRIMARY KEY NOT NULL,
	"label_fr" text NOT NULL,
	"label_en" text NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"featured" jsonb,
	"active" boolean DEFAULT true NOT NULL
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
	"retention_basis_en" text DEFAULT '' NOT NULL,
	"conf_allowed" jsonb NOT NULL,
	"conf_default" text NOT NULL,
	"review_months" integer,
	"iso" text,
	"client_deliverable" boolean DEFAULT false NOT NULL,
	"source" text DEFAULT 'deck' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "doc_types_review_months" CHECK ("codex"."doc_types"."review_months" is null or "codex"."doc_types"."review_months" between 1 and 240)
);
--> statement-breakpoint
CREATE TABLE "codex"."document_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"target_id" text NOT NULL,
	"kind" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" date NOT NULL,
	CONSTRAINT "document_links_kind" CHECK ("codex"."document_links"."kind" in ('replaces', 'see_also')),
	CONSTRAINT "document_links_distinct" CHECK ("codex"."document_links"."source_id" <> "codex"."document_links"."target_id")
);
--> statement-breakpoint
CREATE TABLE "codex"."document_readers" (
	"doc_id" text NOT NULL,
	"user_id" text NOT NULL,
	CONSTRAINT "document_readers_doc_id_user_id_pk" PRIMARY KEY("doc_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "codex"."document_terms" (
	"doc_id" text NOT NULL,
	"field" text NOT NULL,
	"term" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "codex"."documents" (
	"id" text PRIMARY KEY NOT NULL,
	"aliases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"legacy_ref" text,
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
	"retention_override" boolean DEFAULT false NOT NULL,
	"retention_event_at" date,
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
	"modified_at" date NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"template_id" text,
	CONSTRAINT "documents_legacy_ref_unique" UNIQUE("legacy_ref")
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
CREATE TABLE "codex"."id_counters" (
	"scope" text PRIMARY KEY NOT NULL,
	"last" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "codex"."integration_signatures" (
	"digest" text PRIMARY KEY NOT NULL,
	"endpoint" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "codex"."keyword_terms" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"key" text NOT NULL,
	"aliases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" date NOT NULL
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
	"manager_id" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL
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
	"owner_id" text NOT NULL,
	"scope" text DEFAULT 'personal' NOT NULL,
	"department" text,
	"period" jsonb,
	"order_by" text,
	"sort" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "saved_searches_scope" CHECK ("codex"."saved_searches"."scope" in ('personal', 'department', 'group')),
	CONSTRAINT "saved_searches_order_by" CHECK ("codex"."saved_searches"."order_by" in ('relevance', 'modified', 'issued', 'due', 'id', 'title')),
	CONSTRAINT "saved_searches_department" CHECK (("codex"."saved_searches"."scope" = 'department') = ("codex"."saved_searches"."department" is not null))
);
--> statement-breakpoint
CREATE TABLE "codex"."scheduler_runs" (
	"task" text PRIMARY KEY NOT NULL,
	"lease_owner" text,
	"lease_until" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"status" text,
	"summary" jsonb,
	"error" text,
	"next_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "codex"."sites" (
	"key" text PRIMARY KEY NOT NULL,
	"label_fr" text NOT NULL,
	"label_en" text NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "codex"."source_orgs" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"key" text NOT NULL,
	"aliases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" date NOT NULL
);
--> statement-breakpoint
CREATE TABLE "codex"."template_types" (
	"doc_id" text NOT NULL,
	"type_code" text NOT NULL,
	CONSTRAINT "template_types_doc_id_type_code_pk" PRIMARY KEY("doc_id","type_code")
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
CREATE TABLE "codex"."version_previews" (
	"working_version_id" integer PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"file_key" text,
	"size" integer,
	"pages" integer,
	"sha256" text,
	"error" text,
	"converter" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "version_previews_status" CHECK (("codex"."version_previews"."status" = 'ready' and "codex"."version_previews"."file_key" is not null) or ("codex"."version_previews"."status" = 'failed' and "codex"."version_previews"."file_key" is null))
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
	"closed_by" text,
	"closed_at" date,
	"reason" text,
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
	"pages" integer,
	"sha256" text
);
--> statement-breakpoint
ALTER TABLE "codex"."audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "codex"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex"."change_requests" ADD CONSTRAINT "change_requests_doc_id_documents_id_fk" FOREIGN KEY ("doc_id") REFERENCES "codex"."documents"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "codex"."change_requests" ADD CONSTRAINT "change_requests_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "codex"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex"."change_requests" ADD CONSTRAINT "change_requests_modifier_id_users_id_fk" FOREIGN KEY ("modifier_id") REFERENCES "codex"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex"."change_requests" ADD CONSTRAINT "change_requests_revision_id_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "codex"."revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex"."change_requests" ADD CONSTRAINT "change_requests_replacement_id_documents_id_fk" FOREIGN KEY ("replacement_id") REFERENCES "codex"."documents"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "codex"."doc_types" ADD CONSTRAINT "doc_types_family_families_key_fk" FOREIGN KEY ("family") REFERENCES "codex"."families"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex"."document_links" ADD CONSTRAINT "document_links_source_id_documents_id_fk" FOREIGN KEY ("source_id") REFERENCES "codex"."documents"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "codex"."document_links" ADD CONSTRAINT "document_links_target_id_documents_id_fk" FOREIGN KEY ("target_id") REFERENCES "codex"."documents"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "codex"."document_links" ADD CONSTRAINT "document_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "codex"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex"."document_readers" ADD CONSTRAINT "document_readers_doc_id_documents_id_fk" FOREIGN KEY ("doc_id") REFERENCES "codex"."documents"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "codex"."document_readers" ADD CONSTRAINT "document_readers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "codex"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex"."document_terms" ADD CONSTRAINT "document_terms_doc_id_documents_id_fk" FOREIGN KEY ("doc_id") REFERENCES "codex"."documents"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "codex"."documents" ADD CONSTRAINT "documents_project_code_projects_code_fk" FOREIGN KEY ("project_code") REFERENCES "codex"."projects"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex"."documents" ADD CONSTRAINT "documents_program_code_research_programs_code_fk" FOREIGN KEY ("program_code") REFERENCES "codex"."research_programs"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex"."documents" ADD CONSTRAINT "documents_family_families_key_fk" FOREIGN KEY ("family") REFERENCES "codex"."families"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex"."documents" ADD CONSTRAINT "documents_type_code_doc_types_code_fk" FOREIGN KEY ("type_code") REFERENCES "codex"."doc_types"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex"."documents" ADD CONSTRAINT "documents_department_departments_code_fk" FOREIGN KEY ("department") REFERENCES "codex"."departments"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex"."documents" ADD CONSTRAINT "documents_site_sites_key_fk" FOREIGN KEY ("site") REFERENCES "codex"."sites"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex"."documents" ADD CONSTRAINT "documents_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "codex"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex"."documents" ADD CONSTRAINT "documents_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "codex"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex"."documents" ADD CONSTRAINT "documents_process_owner_id_users_id_fk" FOREIGN KEY ("process_owner_id") REFERENCES "codex"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex"."documents" ADD CONSTRAINT "documents_template_id_documents_id_fk" FOREIGN KEY ("template_id") REFERENCES "codex"."documents"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
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
ALTER TABLE "codex"."saved_searches" ADD CONSTRAINT "saved_searches_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "codex"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex"."saved_searches" ADD CONSTRAINT "saved_searches_department_departments_code_fk" FOREIGN KEY ("department") REFERENCES "codex"."departments"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex"."template_types" ADD CONSTRAINT "template_types_doc_id_documents_id_fk" FOREIGN KEY ("doc_id") REFERENCES "codex"."documents"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "codex"."template_types" ADD CONSTRAINT "template_types_type_code_doc_types_code_fk" FOREIGN KEY ("type_code") REFERENCES "codex"."doc_types"("code") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "codex"."users" ADD CONSTRAINT "users_department_departments_code_fk" FOREIGN KEY ("department") REFERENCES "codex"."departments"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex"."users" ADD CONSTRAINT "users_site_sites_key_fk" FOREIGN KEY ("site") REFERENCES "codex"."sites"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex"."version_previews" ADD CONSTRAINT "version_previews_working_version_id_working_versions_id_fk" FOREIGN KEY ("working_version_id") REFERENCES "codex"."working_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex"."workflow_comments" ADD CONSTRAINT "workflow_comments_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "codex"."workflows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex"."workflow_comments" ADD CONSTRAINT "workflow_comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "codex"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex"."workflow_steps" ADD CONSTRAINT "workflow_steps_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "codex"."workflows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex"."workflow_steps" ADD CONSTRAINT "workflow_steps_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "codex"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex"."workflows" ADD CONSTRAINT "workflows_doc_id_documents_id_fk" FOREIGN KEY ("doc_id") REFERENCES "codex"."documents"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "codex"."workflows" ADD CONSTRAINT "workflows_revision_id_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "codex"."revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex"."workflows" ADD CONSTRAINT "workflows_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "codex"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex"."workflows" ADD CONSTRAINT "workflows_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "codex"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex"."working_versions" ADD CONSTRAINT "working_versions_revision_id_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "codex"."revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex"."working_versions" ADD CONSTRAINT "working_versions_doc_id_documents_id_fk" FOREIGN KEY ("doc_id") REFERENCES "codex"."documents"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "codex"."working_versions" ADD CONSTRAINT "working_versions_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "codex"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_at" ON "codex"."audit_log" USING btree ("at","id");--> statement-breakpoint
CREATE INDEX "audit_log_doc" ON "codex"."audit_log" USING btree ("doc_id","user_id","action","at");--> statement-breakpoint
CREATE INDEX "audit_log_user" ON "codex"."audit_log" USING btree ("user_id","at","id");--> statement-breakpoint
CREATE INDEX "audit_log_action" ON "codex"."audit_log" USING btree ("action","at","id");--> statement-breakpoint
CREATE INDEX "audit_log_revision" ON "codex"."audit_log" USING btree ("revision_id") WHERE "codex"."audit_log"."revision_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "change_requests_pending" ON "codex"."change_requests" USING btree ("doc_id") WHERE "codex"."change_requests"."status" in ('submitted', 'accepted');--> statement-breakpoint
CREATE INDEX "change_requests_doc" ON "codex"."change_requests" USING btree ("doc_id");--> statement-breakpoint
CREATE INDEX "change_requests_replacement" ON "codex"."change_requests" USING btree ("replacement_id") WHERE "codex"."change_requests"."replacement_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "document_links_pair" ON "codex"."document_links" USING btree (least("source_id", "target_id"),greatest("source_id", "target_id"));--> statement-breakpoint
CREATE INDEX "document_links_source" ON "codex"."document_links" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "document_links_target" ON "codex"."document_links" USING btree ("target_id");--> statement-breakpoint
CREATE INDEX "document_readers_user" ON "codex"."document_readers" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "document_terms_doc" ON "codex"."document_terms" USING btree ("doc_id");--> statement-breakpoint
CREATE INDEX "document_terms_term" ON "codex"."document_terms" USING gin ("term" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "documents_aliases" ON "codex"."documents" USING gin ("aliases" jsonb_path_ops);--> statement-breakpoint
CREATE INDEX "documents_template" ON "codex"."documents" USING btree ("template_id") WHERE "codex"."documents"."template_id" is not null;--> statement-breakpoint
CREATE INDEX "integration_signatures_expires" ON "codex"."integration_signatures" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "keyword_terms_key" ON "codex"."keyword_terms" USING btree ("key");--> statement-breakpoint
CREATE INDEX "project_expected_project" ON "codex"."project_expected" USING btree ("project_code");--> statement-breakpoint
CREATE INDEX "project_expected_doc" ON "codex"."project_expected" USING btree ("doc_id");--> statement-breakpoint
CREATE UNIQUE INDEX "revisions_doc_letter" ON "codex"."revisions" USING btree ("doc_id","letter");--> statement-breakpoint
CREATE UNIQUE INDEX "revisions_in_force" ON "codex"."revisions" USING btree ("doc_id") WHERE "codex"."revisions"."status" = 'in_force';--> statement-breakpoint
CREATE INDEX "revisions_open_modifier" ON "codex"."revisions" USING btree ("modifier_id") WHERE "codex"."revisions"."status" in ('draft', 'in_review', 'approved');--> statement-breakpoint
CREATE UNIQUE INDEX "source_orgs_key" ON "codex"."source_orgs" USING btree ("key");--> statement-breakpoint
CREATE INDEX "version_previews_file_key" ON "codex"."version_previews" USING btree ("file_key");--> statement-breakpoint
CREATE INDEX "workflow_comments_workflow" ON "codex"."workflow_comments" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "workflow_steps_assignee" ON "codex"."workflow_steps" USING btree ("assignee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflows_running" ON "codex"."workflows" USING btree ("revision_id") WHERE "codex"."workflows"."outcome" is null;--> statement-breakpoint
CREATE INDEX "workflows_doc" ON "codex"."workflows" USING btree ("doc_id");--> statement-breakpoint
CREATE INDEX "workflows_revision" ON "codex"."workflows" USING btree ("revision_id");--> statement-breakpoint
CREATE INDEX "workflows_requester" ON "codex"."workflows" USING btree ("requester_id");--> statement-breakpoint
CREATE UNIQUE INDEX "working_versions_rev_n" ON "codex"."working_versions" USING btree ("revision_id","n");--> statement-breakpoint
CREATE INDEX "working_versions_doc" ON "codex"."working_versions" USING btree ("doc_id");--> statement-breakpoint
CREATE INDEX "working_versions_file_key" ON "codex"."working_versions" USING btree ("file_key");--> statement-breakpoint
CREATE INDEX "working_versions_sha256" ON "codex"."working_versions" USING btree ("sha256");