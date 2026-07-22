ALTER TYPE "public"."account_kind" ADD VALUE 'property';--> statement-breakpoint
ALTER TYPE "public"."account_kind" ADD VALUE 'vehicle';--> statement-breakpoint
ALTER TABLE "account" ADD COLUMN "secured_asset_account_id" uuid;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_secured_asset_account_id_account_id_fk" FOREIGN KEY ("secured_asset_account_id") REFERENCES "public"."account"("id") ON DELETE set null ON UPDATE no action;