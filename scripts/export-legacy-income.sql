-- Export annual history from an isolated restore of the OLD PostgreSQL app.
-- Requires its current schema (through migration 0016), PostgreSQL/psql 15+.
-- The output is a single versioned JSON document. No login, bank connection,
-- encryption key, transaction, or monthly budget data is selected.
--
-- Use an existing local psql service/Unix socket for the isolated database:
--   psql -X -q -v household_id=SELECTED_UUID -f scripts/export-legacy-income.sql \
--     --output=annual-income.json ISOLATED_DATABASE
-- Select the UUID explicitly; the script never chooses the first household.
-- Restore/migrate an older backup only in the isolated copy before exporting.

\set ON_ERROR_STOP on
\set QUIET on
\pset format unaligned
\pset tuples_only on
\pset pager off

BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL TIME ZONE 'UTC';
SET LOCAL search_path = pg_catalog;

\if :{?household_id}
SELECT set_config('budget_assistant.export_household', :'household_id', true) AS export_setting \gset
\else
DO $guard$
BEGIN
    RAISE EXCEPTION 'Pass the selected legacy household UUID with psql -v household_id=UUID';
END
$guard$;
\endif

-- Schema guards fail before any financial rows reach the output file.
DO $guard$
DECLARE
    selected_household uuid;
BEGIN
    IF EXISTS (
        SELECT 1 FROM (VALUES
            ('household', 'id'),
            ('person', 'id'), ('person', 'household_id'), ('person', 'name'),
            ('person', 'color'), ('person', 'sort_order'), ('person', 'is_active'),
            ('annual_income_entry', 'id'), ('annual_income_entry', 'household_id'),
            ('annual_income_entry', 'person_id'), ('annual_income_entry', 'year'),
            ('annual_income_entry', 'source'), ('annual_income_entry', 'amount_cents'),
            ('annual_income_entry', 'fed_tax_cents'), ('annual_income_entry', 'state_tax_cents'),
            ('annual_income_entry', 'local_tax_cents'), ('annual_income_entry', 'medicare_cents'),
            ('annual_income_entry', 'social_security_cents'), ('annual_income_entry', 'note'),
            ('annual_income_entry', 'created_at'), ('annual_income_entry', 'updated_at'),
            ('income_forecast', 'id'), ('income_forecast', 'household_id'),
            ('income_forecast', 'name'), ('income_forecast', 'model'), ('income_forecast', 'params'),
            ('income_forecast', 'base_year'), ('income_forecast', 'horizon_year'),
            ('income_forecast', 'created_at'),
            ('income_forecast_point', 'id'), ('income_forecast_point', 'forecast_id'),
            ('income_forecast_point', 'person_id'), ('income_forecast_point', 'year'),
            ('income_forecast_point', 'amount_cents')
        ) AS required(table_name, column_name)
        LEFT JOIN information_schema.columns c ON c.table_schema='public'
            AND c.table_name=required.table_name AND c.column_name=required.column_name
        WHERE c.column_name IS NULL
    ) OR EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name IN ('annual_income_entry', 'income_forecast_point')
            AND column_name='person_id' AND data_type<>'uuid'
    ) THEN
        RAISE EXCEPTION 'Unsupported legacy annual-income schema: requires UUID person_id and migrations through 0016. Restore and migrate an isolated copy with the old app; do not guess person names.';
    END IF;

    BEGIN
        selected_household := current_setting('budget_assistant.export_household')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'The selected legacy household must be a valid UUID';
    END;
    IF NOT EXISTS (SELECT 1 FROM public.household h WHERE h.id=selected_household) THEN
        RAISE EXCEPTION 'The selected legacy household was not found';
    END IF;
    IF EXISTS (
        SELECT 1 FROM public.annual_income_entry e
        WHERE e.household_id=selected_household
            AND NOT EXISTS (SELECT 1 FROM public.person p
                WHERE p.id=e.person_id AND p.household_id=selected_household)
    ) OR EXISTS (
        SELECT 1 FROM public.income_forecast_point point
        JOIN public.income_forecast forecast ON forecast.id=point.forecast_id
        WHERE forecast.household_id=selected_household
            AND NOT EXISTS (SELECT 1 FROM public.person p
                WHERE p.id=point.person_id AND p.household_id=selected_household)
    ) THEN
        RAISE EXCEPTION 'Legacy annual-income records contain missing or cross-household person references. Repair the isolated copy before exporting.';
    END IF;
END
$guard$;

WITH selected AS (
    SELECT current_setting('budget_assistant.export_household')::uuid AS household_id
)
SELECT jsonb_build_object(
    'format', 'budget-assistant-annual-income',
    'version', 1,
    'source', jsonb_build_object(
        'kind', 'legacy-postgresql',
        'household_id', selected.household_id,
        'exported_at', transaction_timestamp()
    ),
    'people', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'id', p.id, 'name', p.name, 'color', p.color,
            'sort_order', p.sort_order, 'active', p.is_active
        ) ORDER BY p.sort_order, p.name, p.id)
        FROM public.person p WHERE p.household_id=selected.household_id
    ), '[]'::jsonb),
    'entries', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'id', e.id, 'person_id', e.person_id, 'year', e.year,
            'source', e.source, 'amount_cents', e.amount_cents,
            'fed_tax_cents', e.fed_tax_cents, 'state_tax_cents', e.state_tax_cents,
            'local_tax_cents', e.local_tax_cents, 'medicare_cents', e.medicare_cents,
            'social_security_cents', e.social_security_cents,
            'note', e.note, 'created_at', e.created_at, 'updated_at', e.updated_at
        ) ORDER BY e.year, e.created_at, e.id)
        FROM public.annual_income_entry e WHERE e.household_id=selected.household_id
    ), '[]'::jsonb),
    'forecasts', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'id', forecast.id, 'name', forecast.name, 'model', forecast.model,
            'params', forecast.params, 'base_year', forecast.base_year,
            'horizon_year', forecast.horizon_year, 'created_at', forecast.created_at,
            'points', COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                    'id', point.id, 'person_id', point.person_id,
                    'year', point.year, 'amount_cents', point.amount_cents
                ) ORDER BY point.year, point.person_id, point.id)
                FROM public.income_forecast_point point
                JOIN public.person p ON p.id=point.person_id AND p.household_id=selected.household_id
                WHERE point.forecast_id=forecast.id
            ), '[]'::jsonb)
        ) ORDER BY forecast.created_at, forecast.id)
        FROM public.income_forecast forecast WHERE forecast.household_id=selected.household_id
    ), '[]'::jsonb)
)
FROM selected;

ROLLBACK;
