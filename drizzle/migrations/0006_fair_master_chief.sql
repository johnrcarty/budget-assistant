CREATE TABLE "annual_income_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"person" text NOT NULL,
	"year" integer NOT NULL,
	"source" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"fed_tax_cents" bigint,
	"state_tax_cents" bigint,
	"local_tax_cents" bigint,
	"medicare_cents" bigint,
	"social_security_cents" bigint,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "income_forecast_point" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"forecast_id" uuid NOT NULL,
	"person" text NOT NULL,
	"year" integer NOT NULL,
	"amount_cents" bigint NOT NULL,
	CONSTRAINT "income_forecast_point_forecastId_person_year_unique" UNIQUE("forecast_id","person","year")
);
--> statement-breakpoint
CREATE TABLE "income_forecast" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"name" text NOT NULL,
	"model" text NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"base_year" integer NOT NULL,
	"horizon_year" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "annual_income_entry" ADD CONSTRAINT "annual_income_entry_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "income_forecast_point" ADD CONSTRAINT "income_forecast_point_forecast_id_income_forecast_id_fk" FOREIGN KEY ("forecast_id") REFERENCES "public"."income_forecast"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "income_forecast" ADD CONSTRAINT "income_forecast_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;