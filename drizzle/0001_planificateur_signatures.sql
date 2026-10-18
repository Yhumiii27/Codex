CREATE TABLE "integration_signatures" (
	"digest" text PRIMARY KEY NOT NULL,
	"endpoint" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduler_runs" (
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
CREATE INDEX "integration_signatures_expires" ON "integration_signatures" USING btree ("expires_at");