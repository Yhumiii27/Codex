CREATE TABLE "keyword_terms" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"key" text NOT NULL,
	"aliases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" date NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_orgs" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"key" text NOT NULL,
	"aliases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" date NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "keyword_terms_key" ON "keyword_terms" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "source_orgs_key" ON "source_orgs" USING btree ("key");--> statement-breakpoint
-- Reprise des valeurs existantes (point 59 de docs/reste-a-faire.md) : un terme par valeur repliée (casse, accents et
-- espaces mis de côté, comme lib/vocab-rules.ts vocabKey), nommé d'après la graphie la plus fréquente parmi les
-- documents (à égalité, la première dans l'ordre binaire), daté du premier document qui la porte. Les documents gardent
-- leur valeur telle quelle. Écrit à la main : codex_fold n'existe pas encore sur une base neuve à cette étape.
INSERT INTO "source_orgs" ("name", "key", "created_at")
SELECT DISTINCT ON (k) n, k, first_at FROM (
  SELECT n, btrim(regexp_replace(lower(regexp_replace(normalize(n, nfd), '[̀-ͯ]', '', 'g') collate pg_unicode_fast), '[\u0009-\u000d  ]+', ' ', 'g'), ' ') AS k,
    count(*) AS uses, min(created_at) AS first_at
  FROM (SELECT btrim(regexp_replace(source_org, '[\u0009-\u000d  ]+', ' ', 'g'), ' ') AS n, created_at FROM "documents" WHERE source_org IS NOT NULL) v
  WHERE n <> ''
  GROUP BY n
) g
WHERE k <> ''
ORDER BY k, uses DESC, n COLLATE "C";
--> statement-breakpoint
INSERT INTO "keyword_terms" ("name", "key", "created_at")
SELECT DISTINCT ON (k) n, k, first_at FROM (
  SELECT n, btrim(regexp_replace(lower(regexp_replace(normalize(n, nfd), '[̀-ͯ]', '', 'g') collate pg_unicode_fast), '[\u0009-\u000d  ]+', ' ', 'g'), ' ') AS k,
    count(*) AS uses, min(created_at) AS first_at
  FROM (SELECT btrim(regexp_replace(e.v, '[\u0009-\u000d  ]+', ' ', 'g'), ' ') AS n, d.created_at FROM "documents" d CROSS JOIN LATERAL jsonb_array_elements_text(d.keywords) AS e(v)) v
  WHERE n <> ''
  GROUP BY n
) g
WHERE k <> ''
ORDER BY k, uses DESC, n COLLATE "C";
--> statement-breakpoint
-- Langue : seules fr et en sont admises (point 59) ; une valeur écrite en majuscules ou entourée d'espaces est ramenée
-- à sa forme, une autre valeur reste telle quelle (le document la garde, validateFields ne la refuse qu'à un changement).
UPDATE "documents" SET "lang" = lower(btrim("lang")) WHERE "lang" IS NOT NULL AND lower(btrim("lang")) IN ('fr', 'en') AND "lang" <> lower(btrim("lang"));
