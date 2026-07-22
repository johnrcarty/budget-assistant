CREATE TABLE "income_schedule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"group_key" text NOT NULL,
	"frequency" text NOT NULL,
	"anchor_date" date,
	"second_day_of_month" integer,
	"per_check_amount_cents" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "income_schedule_householdId_groupKey_unique" UNIQUE("household_id","group_key")
);
--> statement-breakpoint
ALTER TABLE "income_line_item" ADD COLUMN "expected_date" date;--> statement-breakpoint
ALTER TABLE "income_schedule" ADD CONSTRAINT "income_schedule_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;