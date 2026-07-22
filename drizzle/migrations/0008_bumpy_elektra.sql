ALTER TABLE "categorization_rule" ADD COLUMN "account_id" uuid;--> statement-breakpoint
ALTER TABLE "categorization_rule" ADD COLUMN "amount_cents" bigint;--> statement-breakpoint
ALTER TABLE "categorization_rule" ADD CONSTRAINT "categorization_rule_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;