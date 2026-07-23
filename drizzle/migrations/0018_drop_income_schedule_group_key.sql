ALTER TABLE "income_schedule" DROP CONSTRAINT "income_schedule_householdId_groupKey_unique";--> statement-breakpoint
ALTER TABLE "income_schedule" ALTER COLUMN "person_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "income_schedule" DROP COLUMN "group_key";--> statement-breakpoint
ALTER TABLE "income_schedule" ADD CONSTRAINT "income_schedule_householdId_personId_unique" UNIQUE("household_id","person_id");