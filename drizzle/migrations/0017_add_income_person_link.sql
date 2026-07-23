ALTER TABLE "income_schedule" ADD COLUMN "person_id" uuid;--> statement-breakpoint
ALTER TABLE "income_template" ADD COLUMN "person_id" uuid;--> statement-breakpoint
ALTER TABLE "income_template" ADD COLUMN "slot_number" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "income_schedule" ADD CONSTRAINT "income_schedule_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "income_template" ADD CONSTRAINT "income_template_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "income_template" ADD CONSTRAINT "income_template_personId_slotNumber_unique" UNIQUE("person_id","slot_number");--> statement-breakpoint

-- One-time cleanup, not a general rule: "PGR" is a leftover employer
-- abbreviation (Progressive) from an old EveryDollar import, no longer
-- relevant. Renaming it away lets the backfill below be a plain exact
-- match instead of needing a fuzzy heuristic.
UPDATE "income_template" SET "name" = 'John 1' WHERE "name" = 'John PGR 1';--> statement-breakpoint
UPDATE "income_template" SET "name" = 'John 2' WHERE "name" = 'John PGR 2';--> statement-breakpoint
UPDATE "income_schedule" SET "group_key" = 'john' WHERE "group_key" = 'john pgr';--> statement-breakpoint

-- Templates: exact case-insensitive match of the legacy derived group key to
-- an existing person in the same household. No fuzzy tier, no auto-create -
-- an unmatched key (Advance/Interest/Tax Return/HSA) stays person_id = NULL
-- by design, since plenty of template names are legitimately not people.
-- person_id and slot_number are set TOGETHER in one UPDATE (via this CTE) -
-- setting person_id alone first would transiently give every member of a
-- group the same (person_id, 1) and trip the unique constraint immediately.
WITH matched AS (
  SELECT t.id AS template_id, p.id AS person_id,
    ROW_NUMBER() OVER (PARTITION BY p.id ORDER BY t.sort_order) AS rn
  FROM "income_template" t
  JOIN "person" p ON p.household_id = t.household_id
    AND lower(p.name) = regexp_replace(lower(trim(t.name)), '\s*\d+$', '')
)
UPDATE "income_template" t
SET "person_id" = matched.person_id, "slot_number" = matched.rn
FROM matched
WHERE t.id = matched.template_id;--> statement-breakpoint

-- Schedules: same exact match. Unlike templates, a schedule always
-- represents a real person by definition of the feature, so personId must
-- end up NOT NULL (stage 2) - keep one auto-create fallback tier for a
-- hypothetical household whose groupKey matches no person. group_key is
-- already lowercased at write time, so no regexp_replace needed here.
UPDATE "income_schedule" s
SET "person_id" = p.id
FROM "person" p
WHERE p.household_id = s.household_id
  AND lower(p.name) = s.group_key
  AND s.person_id IS NULL;--> statement-breakpoint

WITH missing AS (
  SELECT DISTINCT ON (s.household_id, s.group_key)
    s.household_id, initcap(s.group_key) AS name
  FROM "income_schedule" s
  WHERE s.person_id IS NULL
  ORDER BY s.household_id, s.group_key, s.created_at ASC
)
INSERT INTO "person" (household_id, name, person_type, sort_order, is_active)
SELECT household_id, name, 'adult', 0, true
FROM missing
ON CONFLICT (household_id, name) DO NOTHING;--> statement-breakpoint

UPDATE "income_schedule" s
SET "person_id" = p.id
FROM "person" p
WHERE p.household_id = s.household_id
  AND lower(p.name) = s.group_key
  AND s.person_id IS NULL;