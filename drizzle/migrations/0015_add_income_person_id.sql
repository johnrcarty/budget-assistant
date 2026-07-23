ALTER TABLE "annual_income_entry" ADD COLUMN "person_id" uuid;--> statement-breakpoint
ALTER TABLE "income_forecast_point" ADD COLUMN "person_id" uuid;--> statement-breakpoint
ALTER TABLE "annual_income_entry" ADD CONSTRAINT "annual_income_entry_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "income_forecast_point" ADD CONSTRAINT "income_forecast_point_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
-- Backfill: match each entry's freeform person label to an existing Person
-- row in the same household, case-insensitively.
UPDATE "annual_income_entry" e
SET "person_id" = p.id
FROM "person" p
WHERE p.household_id = e.household_id
  AND lower(p.name) = lower(e.person)
  AND e.person_id IS NULL;--> statement-breakpoint
-- Any label with no matching Person (e.g. a fresh household with none yet)
-- gets one created - one row per household per case-insensitive-distinct
-- label, earliest entry's casing wins as the canonical name.
WITH missing AS (
  SELECT DISTINCT ON (e.household_id, lower(e.person))
    e.household_id, e.person AS name
  FROM "annual_income_entry" e
  WHERE e.person_id IS NULL
  ORDER BY e.household_id, lower(e.person), e.created_at ASC
)
INSERT INTO "person" (household_id, name, person_type, sort_order, is_active)
SELECT household_id, name, 'adult', 0, true
FROM missing
ON CONFLICT (household_id, name) DO NOTHING;--> statement-breakpoint
UPDATE "annual_income_entry" e
SET "person_id" = p.id
FROM "person" p
WHERE p.household_id = e.household_id
  AND lower(p.name) = lower(e.person)
  AND e.person_id IS NULL;--> statement-breakpoint
-- income_forecast_point has no household_id column of its own - join
-- through income_forecast. Run after the entries backfill above so any
-- Person rows it just created are already visible (same transaction).
UPDATE "income_forecast_point" fp
SET "person_id" = p.id
FROM "income_forecast" f, "person" p
WHERE fp.forecast_id = f.id
  AND p.household_id = f.household_id
  AND lower(p.name) = lower(fp.person)
  AND fp.person_id IS NULL;--> statement-breakpoint
WITH missing AS (
  SELECT DISTINCT ON (f.household_id, lower(fp.person))
    f.household_id, fp.person AS name
  FROM "income_forecast_point" fp
  JOIN "income_forecast" f ON f.id = fp.forecast_id
  WHERE fp.person_id IS NULL
  ORDER BY f.household_id, lower(fp.person), f.created_at ASC
)
INSERT INTO "person" (household_id, name, person_type, sort_order, is_active)
SELECT household_id, name, 'adult', 0, true
FROM missing
ON CONFLICT (household_id, name) DO NOTHING;--> statement-breakpoint
UPDATE "income_forecast_point" fp
SET "person_id" = p.id
FROM "income_forecast" f, "person" p
WHERE fp.forecast_id = f.id
  AND p.household_id = f.household_id
  AND lower(p.name) = lower(fp.person)
  AND fp.person_id IS NULL;