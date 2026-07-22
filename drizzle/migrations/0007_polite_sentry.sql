CREATE TYPE "public"."rule_match_type" AS ENUM('contains', 'starts_with', 'exact');--> statement-breakpoint
CREATE TABLE "categorization_rule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"pattern" text NOT NULL,
	"match_type" "rule_match_type" DEFAULT 'contains' NOT NULL,
	"line_item_template_id" uuid,
	"income_template_id" uuid,
	"priority" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "categorization_rule" ADD CONSTRAINT "categorization_rule_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categorization_rule" ADD CONSTRAINT "categorization_rule_line_item_template_id_line_item_template_id_fk" FOREIGN KEY ("line_item_template_id") REFERENCES "public"."line_item_template"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categorization_rule" ADD CONSTRAINT "categorization_rule_income_template_id_income_template_id_fk" FOREIGN KEY ("income_template_id") REFERENCES "public"."income_template"("id") ON DELETE cascade ON UPDATE no action;