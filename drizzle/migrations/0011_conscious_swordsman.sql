CREATE TABLE "account_balance_snapshot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"as_of_date" date NOT NULL,
	"balance_cents" bigint NOT NULL,
	"source" "balance_source" DEFAULT 'simplefin' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "account_balance_snapshot_accountId_asOfDate_source_unique" UNIQUE("account_id","as_of_date","source")
);
--> statement-breakpoint
ALTER TABLE "account_balance_snapshot" ADD CONSTRAINT "account_balance_snapshot_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;