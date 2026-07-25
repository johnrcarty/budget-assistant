CREATE TABLE "transaction_exclusion" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"source" "transaction_source" NOT NULL,
	"external_id" text NOT NULL,
	"description" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"posted_date" date NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "transaction_exclusion_accountId_source_externalId_unique" UNIQUE("account_id","source","external_id")
);
--> statement-breakpoint
ALTER TABLE "transaction_exclusion" ADD CONSTRAINT "transaction_exclusion_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_exclusion" ADD CONSTRAINT "transaction_exclusion_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;