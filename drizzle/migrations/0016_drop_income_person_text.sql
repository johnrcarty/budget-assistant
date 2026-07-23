ALTER TABLE "income_forecast_point" DROP CONSTRAINT "income_forecast_point_forecastId_person_year_unique";--> statement-breakpoint
ALTER TABLE "annual_income_entry" ALTER COLUMN "person_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "income_forecast_point" ALTER COLUMN "person_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "annual_income_entry" DROP COLUMN "person";--> statement-breakpoint
ALTER TABLE "income_forecast_point" DROP COLUMN "person";--> statement-breakpoint
ALTER TABLE "income_forecast_point" ADD CONSTRAINT "income_forecast_point_forecastId_personId_year_unique" UNIQUE("forecast_id","person_id","year");