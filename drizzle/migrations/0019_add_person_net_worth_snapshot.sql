CREATE TYPE "public"."person_net_worth_source" AS ENUM('computed');--> statement-breakpoint
CREATE TABLE "person_net_worth_snapshot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"as_of_date" date NOT NULL,
	"assets_cents" bigint NOT NULL,
	"liabilities_cents" bigint NOT NULL,
	"source" "person_net_worth_source" DEFAULT 'computed' NOT NULL,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "person_net_worth_snapshot_personId_asOfDate_source_unique" UNIQUE("person_id","as_of_date","source")
);
--> statement-breakpoint
ALTER TABLE "person_net_worth_snapshot" ADD CONSTRAINT "person_net_worth_snapshot_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_net_worth_snapshot" ADD CONSTRAINT "person_net_worth_snapshot_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE restrict ON UPDATE no action;