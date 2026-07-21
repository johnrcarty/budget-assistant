CREATE TYPE "public"."account_kind" AS ENUM('checking', 'savings', 'credit_card', 'loan', 'line_of_credit', 'cash', 'other', 'investment', 'crypto');--> statement-breakpoint
CREATE TYPE "public"."transaction_source" AS ENUM('manual', 'simplefin');--> statement-breakpoint
CREATE TYPE "public"."balance_source" AS ENUM('manual', 'simplefin', 'statement_import');--> statement-breakpoint
CREATE TYPE "public"."debt_terms_type" AS ENUM('revolving', 'installment');--> statement-breakpoint
CREATE TYPE "public"."simplefin_connection_status" AS ENUM('active', 'error', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."sync_run_status" AS ENUM('success', 'partial', 'error');--> statement-breakpoint
CREATE TABLE "oauth_account" (
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text,
	CONSTRAINT "oauth_account_provider_provider_account_id_pk" PRIMARY KEY("provider","provider_account_id")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"session_token" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text,
	"email" text NOT NULL,
	"email_verified" timestamp,
	"image" text,
	"password_hash" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification_token" (
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" timestamp NOT NULL,
	CONSTRAINT "verification_token_identifier_token_pk" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
CREATE TABLE "household_member" (
	"household_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "household_member_household_id_user_id_pk" PRIMARY KEY("household_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "household" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budget_line_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"budget_month_id" uuid NOT NULL,
	"category_group_id" uuid NOT NULL,
	"template_item_id" uuid,
	"name" text NOT NULL,
	"planned_amount_cents" bigint DEFAULT 0 NOT NULL,
	"due_day" integer,
	"recurrence_rule" text DEFAULT 'monthly' NOT NULL,
	"is_favorite" boolean DEFAULT false NOT NULL,
	"note" text,
	"fund_target_cents" bigint,
	"fund_balance_cents" bigint,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budget_month" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"month" date NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "budget_month_householdId_month_unique" UNIQUE("household_id","month")
);
--> statement-breakpoint
CREATE TABLE "category_group" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"name" text NOT NULL,
	"icon" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "income_line_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"budget_month_id" uuid NOT NULL,
	"template_item_id" uuid,
	"name" text NOT NULL,
	"planned_amount_cents" bigint DEFAULT 0 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "income_template" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"name" text NOT NULL,
	"default_amount_cents" bigint DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "line_item_template" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"category_group_id" uuid NOT NULL,
	"name" text NOT NULL,
	"default_planned_amount_cents" bigint DEFAULT 0 NOT NULL,
	"due_day" integer,
	"recurrence_rule" text DEFAULT 'monthly' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" "account_kind" NOT NULL,
	"subtype" text,
	"is_liability" boolean DEFAULT false NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"current_balance_cents" bigint,
	"balance_as_of" timestamp,
	"is_manual" boolean DEFAULT true NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"icon" text,
	"color" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transaction" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"amount_cents" bigint NOT NULL,
	"description" text NOT NULL,
	"merchant" text,
	"posted_date" date NOT NULL,
	"pending" boolean DEFAULT false NOT NULL,
	"budget_line_item_id" uuid,
	"income_line_item_id" uuid,
	"source" "transaction_source" DEFAULT 'manual' NOT NULL,
	"external_id" text,
	"simplefin_account_ref" text,
	"raw_payload" jsonb,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "transaction_accountId_source_externalId_unique" UNIQUE("account_id","source","external_id")
);
--> statement-breakpoint
CREATE TABLE "debt_balance_snapshot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"as_of_date" date NOT NULL,
	"balance_cents" bigint NOT NULL,
	"source" "balance_source" DEFAULT 'manual' NOT NULL,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "debt_balance_snapshot_accountId_asOfDate_source_unique" UNIQUE("account_id","as_of_date","source")
);
--> statement-breakpoint
CREATE TABLE "debt_terms_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"effective_date" date NOT NULL,
	"terms_type" "debt_terms_type" NOT NULL,
	"apr_bps" integer,
	"min_payment_cents" bigint,
	"min_payment_is_percent" boolean DEFAULT false NOT NULL,
	"min_payment_percent_bps" integer,
	"fixed_payment_cents" bigint,
	"payoff_target_date" date,
	"due_day" integer,
	"servicer_name" text,
	"promo_end_date" date,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "simplefin_connection_account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"household_id" uuid NOT NULL,
	"simplefin_account_id" text NOT NULL,
	"account_id" uuid,
	"last_synced_balance_cents" bigint,
	"last_synced_at" timestamp,
	CONSTRAINT "simplefin_connection_account_connectionId_simplefinAccountId_unique" UNIQUE("connection_id","simplefin_account_id")
);
--> statement-breakpoint
CREATE TABLE "simplefin_connection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"access_url_ciphertext" text NOT NULL,
	"access_url_iv" text NOT NULL,
	"access_url_auth_tag" text NOT NULL,
	"bridge_info" jsonb,
	"status" "simplefin_connection_status" DEFAULT 'active' NOT NULL,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp,
	"status" "sync_run_status" DEFAULT 'success' NOT NULL,
	"accounts_synced" integer DEFAULT 0 NOT NULL,
	"transactions_imported" integer DEFAULT 0 NOT NULL,
	"error_detail" text
);
--> statement-breakpoint
ALTER TABLE "oauth_account" ADD CONSTRAINT "oauth_account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_member" ADD CONSTRAINT "household_member_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_member" ADD CONSTRAINT "household_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_line_item" ADD CONSTRAINT "budget_line_item_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_line_item" ADD CONSTRAINT "budget_line_item_budget_month_id_budget_month_id_fk" FOREIGN KEY ("budget_month_id") REFERENCES "public"."budget_month"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_line_item" ADD CONSTRAINT "budget_line_item_category_group_id_category_group_id_fk" FOREIGN KEY ("category_group_id") REFERENCES "public"."category_group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_line_item" ADD CONSTRAINT "budget_line_item_template_item_id_line_item_template_id_fk" FOREIGN KEY ("template_item_id") REFERENCES "public"."line_item_template"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_month" ADD CONSTRAINT "budget_month_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_group" ADD CONSTRAINT "category_group_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "income_line_item" ADD CONSTRAINT "income_line_item_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "income_line_item" ADD CONSTRAINT "income_line_item_budget_month_id_budget_month_id_fk" FOREIGN KEY ("budget_month_id") REFERENCES "public"."budget_month"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "income_line_item" ADD CONSTRAINT "income_line_item_template_item_id_income_template_id_fk" FOREIGN KEY ("template_item_id") REFERENCES "public"."income_template"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "income_template" ADD CONSTRAINT "income_template_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "line_item_template" ADD CONSTRAINT "line_item_template_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "line_item_template" ADD CONSTRAINT "line_item_template_category_group_id_category_group_id_fk" FOREIGN KEY ("category_group_id") REFERENCES "public"."category_group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_budget_line_item_id_budget_line_item_id_fk" FOREIGN KEY ("budget_line_item_id") REFERENCES "public"."budget_line_item"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_income_line_item_id_income_line_item_id_fk" FOREIGN KEY ("income_line_item_id") REFERENCES "public"."income_line_item"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debt_balance_snapshot" ADD CONSTRAINT "debt_balance_snapshot_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debt_terms_version" ADD CONSTRAINT "debt_terms_version_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "simplefin_connection_account" ADD CONSTRAINT "simplefin_connection_account_connection_id_simplefin_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."simplefin_connection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "simplefin_connection_account" ADD CONSTRAINT "simplefin_connection_account_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "simplefin_connection_account" ADD CONSTRAINT "simplefin_connection_account_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "simplefin_connection" ADD CONSTRAINT "simplefin_connection_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_run" ADD CONSTRAINT "sync_run_connection_id_simplefin_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."simplefin_connection"("id") ON DELETE cascade ON UPDATE no action;