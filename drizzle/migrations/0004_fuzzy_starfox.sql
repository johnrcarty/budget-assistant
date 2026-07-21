CREATE TYPE "public"."debt_strategy" AS ENUM('snowball', 'avalanche');--> statement-breakpoint
CREATE TYPE "public"."payment_frequency" AS ENUM('monthly', 'semimonthly', 'biweekly', 'weekly');--> statement-breakpoint
CREATE TABLE "debt_plan" (
	"household_id" uuid PRIMARY KEY NOT NULL,
	"strategy" "debt_strategy" DEFAULT 'snowball' NOT NULL,
	"extra_monthly_cents" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "category_group" ADD COLUMN "system_key" text;--> statement-breakpoint
ALTER TABLE "line_item_template" ADD COLUMN "debt_account_id" uuid;--> statement-breakpoint
ALTER TABLE "debt_terms_version" ADD COLUMN "payment_frequency" "payment_frequency" DEFAULT 'monthly' NOT NULL;--> statement-breakpoint
ALTER TABLE "debt_plan" ADD CONSTRAINT "debt_plan_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "line_item_template" ADD CONSTRAINT "line_item_template_debt_account_id_account_id_fk" FOREIGN KEY ("debt_account_id") REFERENCES "public"."account"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_group" ADD CONSTRAINT "category_group_householdId_systemKey_unique" UNIQUE("household_id","system_key");--> statement-breakpoint
ALTER TABLE "line_item_template" ADD CONSTRAINT "line_item_template_debtAccountId_unique" UNIQUE("debt_account_id");