ALTER TABLE "codex"."users" ADD COLUMN "clavis_person_id" uuid;--> statement-breakpoint
ALTER TABLE "codex"."users" ADD CONSTRAINT "users_clavis_person_unique" UNIQUE("clavis_person_id");--> statement-breakpoint
ALTER TABLE "codex"."users" ADD CONSTRAINT "users_clavis_person_check" CHECK ("codex"."users"."clavis_person_id" IS NULL OR NOT "codex"."users"."is_system");