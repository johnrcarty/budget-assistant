CREATE TABLE "account_group" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "account_group_householdId_name_unique" UNIQUE("household_id","name")
);
--> statement-breakpoint
ALTER TABLE "account" ADD COLUMN "account_group_id" uuid;--> statement-breakpoint
ALTER TABLE "account_group" ADD CONSTRAINT "account_group_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_account_group_id_account_group_id_fk" FOREIGN KEY ("account_group_id") REFERENCES "public"."account_group"("id") ON DELETE set null ON UPDATE no action;