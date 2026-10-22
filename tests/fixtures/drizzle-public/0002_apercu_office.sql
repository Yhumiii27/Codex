CREATE TABLE "version_previews" (
	"working_version_id" integer PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"file_key" text,
	"size" integer,
	"pages" integer,
	"sha256" text,
	"error" text,
	"converter" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "version_previews_status" CHECK (("version_previews"."status" = 'ready' and "version_previews"."file_key" is not null) or ("version_previews"."status" = 'failed' and "version_previews"."file_key" is null))
);
--> statement-breakpoint
ALTER TABLE "version_previews" ADD CONSTRAINT "version_previews_working_version_id_working_versions_id_fk" FOREIGN KEY ("working_version_id") REFERENCES "public"."working_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "version_previews_file_key" ON "version_previews" USING btree ("file_key");