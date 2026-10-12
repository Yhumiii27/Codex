CREATE TABLE "audit_log" (
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
	CONSTRAINT "audit_log_subject" CHECK ("audit_log"."doc_id" is not null or ("audit_log"."target_kind" is not null and "audit_log"."target_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "change_requests" (
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
	CONSTRAINT "change_requests_replacement" CHECK ("change_requests"."replacement_id" is null or ("change_requests"."kind" = 'obsolescence' and "change_requests"."replacement_id" <> "change_requests"."doc_id"))
);
--> statement-breakpoint
CREATE TABLE "departments" (
	"code" text PRIMARY KEY NOT NULL,
	"label_fr" text NOT NULL,
	"label_en" text NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"featured" jsonb
);
--> statement-breakpoint
CREATE TABLE "doc_types" (
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
	"review_months" integer,
	"iso" text,
	"client_deliverable" boolean DEFAULT false NOT NULL,
	"source" text DEFAULT 'deck' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "doc_types_review_months" CHECK ("doc_types"."review_months" is null or "doc_types"."review_months" between 1 and 240)
);
--> statement-breakpoint
CREATE TABLE "document_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"target_id" text NOT NULL,
	"kind" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" date NOT NULL,
	CONSTRAINT "document_links_kind" CHECK ("document_links"."kind" in ('replaces', 'see_also')),
	CONSTRAINT "document_links_distinct" CHECK ("document_links"."source_id" <> "document_links"."target_id")
);
--> statement-breakpoint
CREATE TABLE "document_readers" (
	"doc_id" text NOT NULL,
	"user_id" text NOT NULL,
	CONSTRAINT "document_readers_doc_id_user_id_pk" PRIMARY KEY("doc_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "documents" (
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
	CONSTRAINT "documents_legacy_ref_unique" UNIQUE("legacy_ref")
);
--> statement-breakpoint
CREATE TABLE "families" (
	"key" text PRIMARY KEY NOT NULL,
	"label_fr" text NOT NULL,
	"label_en" text NOT NULL,
	"grp" text NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "function_holders" (
	"id" serial PRIMARY KEY NOT NULL,
	"function_key" text NOT NULL,
	"scope_value" text,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "functions" (
	"key" text PRIMARY KEY NOT NULL,
	"label_fr" text NOT NULL,
	"label_en" text NOT NULL,
	"scope" text NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "id_counters" (
	"scope" text PRIMARY KEY NOT NULL,
	"last" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_code" text NOT NULL,
	"at" timestamp NOT NULL,
	"text" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_expected" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_code" text NOT NULL,
	"label" jsonb NOT NULL,
	"type_code" text,
	"doc_id" text,
	"later" boolean DEFAULT false NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
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
CREATE TABLE "research_programs" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"manager_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "revisions" (
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
CREATE TABLE "role_permissions" (
	"role" text NOT NULL,
	"perm" text NOT NULL,
	"granted" boolean NOT NULL,
	CONSTRAINT "role_permissions_role_perm_pk" PRIMARY KEY("role","perm")
);
--> statement-breakpoint
CREATE TABLE "saved_searches" (
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
	CONSTRAINT "saved_searches_scope" CHECK ("saved_searches"."scope" in ('personal', 'department', 'group')),
	CONSTRAINT "saved_searches_order_by" CHECK ("saved_searches"."order_by" in ('relevance', 'modified', 'issued', 'due', 'id', 'title')),
	CONSTRAINT "saved_searches_department" CHECK (("saved_searches"."scope" = 'department') = ("saved_searches"."department" is not null))
);
--> statement-breakpoint
CREATE TABLE "sites" (
	"key" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
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
CREATE TABLE "workflow_comments" (
	"id" serial PRIMARY KEY NOT NULL,
	"workflow_id" text NOT NULL,
	"author_id" text NOT NULL,
	"at" date NOT NULL,
	"text" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_steps" (
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
CREATE TABLE "workflows" (
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
CREATE TABLE "working_versions" (
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
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_doc_id_documents_id_fk" FOREIGN KEY ("doc_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_modifier_id_users_id_fk" FOREIGN KEY ("modifier_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_revision_id_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_replacement_id_documents_id_fk" FOREIGN KEY ("replacement_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "doc_types" ADD CONSTRAINT "doc_types_family_families_key_fk" FOREIGN KEY ("family") REFERENCES "public"."families"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_source_id_documents_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_target_id_documents_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_readers" ADD CONSTRAINT "document_readers_doc_id_documents_id_fk" FOREIGN KEY ("doc_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "document_readers" ADD CONSTRAINT "document_readers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_project_code_projects_code_fk" FOREIGN KEY ("project_code") REFERENCES "public"."projects"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_program_code_research_programs_code_fk" FOREIGN KEY ("program_code") REFERENCES "public"."research_programs"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_family_families_key_fk" FOREIGN KEY ("family") REFERENCES "public"."families"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_type_code_doc_types_code_fk" FOREIGN KEY ("type_code") REFERENCES "public"."doc_types"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_department_departments_code_fk" FOREIGN KEY ("department") REFERENCES "public"."departments"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_site_sites_key_fk" FOREIGN KEY ("site") REFERENCES "public"."sites"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_process_owner_id_users_id_fk" FOREIGN KEY ("process_owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "function_holders" ADD CONSTRAINT "function_holders_function_key_functions_key_fk" FOREIGN KEY ("function_key") REFERENCES "public"."functions"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "function_holders" ADD CONSTRAINT "function_holders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_events" ADD CONSTRAINT "project_events_project_code_projects_code_fk" FOREIGN KEY ("project_code") REFERENCES "public"."projects"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_expected" ADD CONSTRAINT "project_expected_project_code_projects_code_fk" FOREIGN KEY ("project_code") REFERENCES "public"."projects"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_expected" ADD CONSTRAINT "project_expected_type_code_doc_types_code_fk" FOREIGN KEY ("type_code") REFERENCES "public"."doc_types"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_expected" ADD CONSTRAINT "project_expected_doc_id_documents_id_fk" FOREIGN KEY ("doc_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_manager_id_users_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_programs" ADD CONSTRAINT "research_programs_manager_id_users_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revisions" ADD CONSTRAINT "revisions_doc_id_documents_id_fk" FOREIGN KEY ("doc_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "revisions" ADD CONSTRAINT "revisions_modifier_id_users_id_fk" FOREIGN KEY ("modifier_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_searches" ADD CONSTRAINT "saved_searches_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_searches" ADD CONSTRAINT "saved_searches_department_departments_code_fk" FOREIGN KEY ("department") REFERENCES "public"."departments"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_department_departments_code_fk" FOREIGN KEY ("department") REFERENCES "public"."departments"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_site_sites_key_fk" FOREIGN KEY ("site") REFERENCES "public"."sites"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_comments" ADD CONSTRAINT "workflow_comments_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_comments" ADD CONSTRAINT "workflow_comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_steps" ADD CONSTRAINT "workflow_steps_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_steps" ADD CONSTRAINT "workflow_steps_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_doc_id_documents_id_fk" FOREIGN KEY ("doc_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_revision_id_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "working_versions" ADD CONSTRAINT "working_versions_revision_id_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "working_versions" ADD CONSTRAINT "working_versions_doc_id_documents_id_fk" FOREIGN KEY ("doc_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "working_versions" ADD CONSTRAINT "working_versions_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "change_requests_pending" ON "change_requests" USING btree ("doc_id") WHERE "change_requests"."status" in ('submitted', 'accepted');--> statement-breakpoint
CREATE UNIQUE INDEX "document_links_pair" ON "document_links" USING btree (least("source_id", "target_id"),greatest("source_id", "target_id"));--> statement-breakpoint
CREATE UNIQUE INDEX "revisions_doc_letter" ON "revisions" USING btree ("doc_id","letter");--> statement-breakpoint
CREATE UNIQUE INDEX "revisions_in_force" ON "revisions" USING btree ("doc_id") WHERE "revisions"."status" = 'in_force';--> statement-breakpoint
CREATE UNIQUE INDEX "workflows_running" ON "workflows" USING btree ("revision_id") WHERE "workflows"."outcome" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "working_versions_rev_n" ON "working_versions" USING btree ("revision_id","n");