"""Exercise the offline SQL export with synthetic, isolated PostgreSQL data.

PostgreSQL is optional developer tooling, never a Python/React runtime
requirement. The cluster listens on a temporary Unix socket only and contains
no user data or external connections. CI without server tools skips this file.
"""
import json
import os
from pathlib import Path
import subprocess
from uuid import uuid4

import pytest


EXPORT_SQL = Path(__file__).resolve().parents[1] / 'scripts' / 'export-legacy-income.sql'
H1 = '11111111-1111-4111-8111-111111111111'
H2 = '22222222-2222-4222-8222-222222222222'
P1 = '33333333-3333-4333-8333-333333333333'
P2 = '44444444-4444-4444-8444-444444444444'
F1 = '55555555-5555-4555-8555-555555555555'
E1 = '66666666-6666-4666-8666-666666666666'
E2 = '77777777-7777-4777-8777-777777777777'
PT = '88888888-8888-4888-8888-888888888888'


@pytest.fixture(scope='module')
def pg_tools(tmp_path_factory):
    if os.geteuid() == 0:
        pytest.skip('Temporary PostgreSQL server cannot run as root')
    versions = sorted(Path('/usr/lib/postgresql').glob('*/bin'), key=lambda path: int(path.parent.name), reverse=True)
    binaries = next((path for path in versions if all((path / tool).is_file() for tool in ('initdb', 'pg_ctl', 'psql'))), None)
    if binaries is None:
        pytest.skip('PostgreSQL developer tools are unavailable')
    directory = tmp_path_factory.mktemp('legacy-income-pg')
    data = directory / 'data'
    socket = directory / 'socket'
    socket.mkdir()
    run = lambda command: subprocess.run(command, capture_output=True, text=True, timeout=30, check=True)
    run([str(binaries / 'initdb'), '-D', str(data), '-A', 'trust', '--no-locale', '-E', 'UTF8', '--username=legacy_export_test'])
    run([str(binaries / 'pg_ctl'), '-D', str(data), '-l', str(directory / 'postgres.log'),
         '-o', f"-k {socket} -p 55431 -c listen_addresses='' -c max_connections=5", '-w', 'start'])
    yield [str(binaries / 'psql'), '-X', '-q', '-h', str(socket), '-p', '55431', '-U', 'legacy_export_test']
    run([str(binaries / 'pg_ctl'), '-D', str(data), '-m', 'fast', '-w', 'stop'])


@pytest.fixture
def pg(pg_tools):
    name = 'annual_export_' + uuid4().hex
    subprocess.run([*pg_tools, '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', f'CREATE DATABASE {name}'],
                   capture_output=True, text=True, timeout=10, check=True)
    command = [*pg_tools, '-d', name, '-v', 'ON_ERROR_STOP=1']
    schema = f"""
        CREATE TABLE public.household(id uuid PRIMARY KEY);
        CREATE TABLE public.person(id uuid PRIMARY KEY,household_id uuid,name text,color text,sort_order integer,is_active boolean,user_id uuid);
        CREATE TABLE public.annual_income_entry(id uuid PRIMARY KEY,household_id uuid,person_id uuid,year integer,source text,amount_cents bigint,
          fed_tax_cents bigint,state_tax_cents bigint,local_tax_cents bigint,medicare_cents bigint,social_security_cents bigint,note text,created_at timestamp,updated_at timestamp);
        CREATE TABLE public.income_forecast(id uuid PRIMARY KEY,household_id uuid,name text,model text,params jsonb,base_year integer,horizon_year integer,created_at timestamp);
        CREATE TABLE public.income_forecast_point(id uuid PRIMARY KEY,forecast_id uuid,person_id uuid,year integer,amount_cents bigint);
        INSERT INTO public.household VALUES('{H1}'),('{H2}');
        INSERT INTO public.person VALUES('{P1}','{H1}','Archived earner','chart-2',7,false,'{H1}'),('{P2}','{H2}','Other household secret',NULL,0,true,'{H2}');
        INSERT INTO public.annual_income_entry VALUES
          ('{E1}','{H1}','{P1}',2006,'w2',1234567,NULL,0,1200,NULL,1800,E'Preserve\\nnotes and café','2006-04-01 01:02:03.123456','2006-05-02 02:03:04.654321'),
          ('{E2}','{H1}','{P1}',2006,'w2',1234567,2000,NULL,NULL,NULL,NULL,NULL,'2006-04-02','2006-04-02'),
          ('99999999-9999-4999-8999-999999999999','{H1}','{P1}',2007,'other',0,NULL,NULL,NULL,NULL,NULL,NULL,'2007-04-02','2007-04-02');
        INSERT INTO public.income_forecast VALUES('{F1}','{H1}','Original vintage','unknown_legacy_model','{{"keep":[350,1000],"label":"exact"}}',2006,2036,'2006-12-01 10:20:30.012345');
        INSERT INTO public.income_forecast_point VALUES('{PT}','{F1}','{P1}',2007,1379999);
    """
    subprocess.run([*command, '-c', schema], capture_output=True, text=True, timeout=10, check=True)
    return command


def export(pg, household=H1):
    arguments = [*pg, '-f', str(EXPORT_SQL)]
    if household is not None:
        arguments += ['-v', 'household_id=' + household]
    return subprocess.run(arguments, capture_output=True, text=True, timeout=10)


def execute(pg, statement):
    return subprocess.run([*pg, '-c', statement], capture_output=True, text=True, timeout=10, check=True)


def test_export_preserves_exact_records_and_vintage_without_other_household(pg):
    result = export(pg)
    assert result.returncode == 0, result.stderr
    snapshot = json.loads(result.stdout)
    assert snapshot['format'] == 'budget-assistant-annual-income' and snapshot['version'] == 1
    assert snapshot['source']['kind'] == 'legacy-postgresql' and snapshot['source']['household_id'] == H1
    assert snapshot['people'] == [{'id': P1, 'name': 'Archived earner', 'color': 'chart-2', 'sort_order': 7, 'active': False}]
    assert 'Other household secret' not in result.stdout and 'user_id' not in result.stdout
    assert len(snapshot['entries']) == 3  # identical real W2 rows stay distinct
    first, second, zero = snapshot['entries']
    assert (first['id'], second['id']) == (E1, E2)
    assert first['amount_cents'] == second['amount_cents'] == 1234567
    assert first['fed_tax_cents'] is None and first['state_tax_cents'] == 0
    assert first['note'] == 'Preserve\nnotes and café'
    assert first['created_at'] == '2006-04-01T01:02:03.123456'
    assert first['updated_at'] == '2006-05-02T02:03:04.654321'
    assert zero['amount_cents'] == 0
    forecast = snapshot['forecasts'][0]
    assert forecast['id'] == F1 and forecast['model'] == 'unknown_legacy_model'
    assert forecast['params'] == {'keep': [350, 1000], 'label': 'exact'}
    assert forecast['created_at'] == '2006-12-01T10:20:30.012345'
    assert forecast['points'] == [{'id': PT, 'person_id': P1, 'year': 2007, 'amount_cents': 1379999}]
    assert 'baseline' not in forecast and 'baseline_source' not in forecast
    # Export is repeatable and does not mutate the saved vintage or actuals.
    again = json.loads(export(pg).stdout)
    assert again['entries'] == snapshot['entries'] and again['forecasts'] == snapshot['forecasts']


@pytest.mark.parametrize('table,change', [
    ('public.annual_income_entry', f"UPDATE public.annual_income_entry SET person_id='{P2}' WHERE id='{E1}'"),
    ('public.income_forecast_point', f"UPDATE public.income_forecast_point SET person_id='{P2}' WHERE id='{PT}'"),
])
def test_cross_household_references_fail_before_json_output(pg, table, change):
    execute(pg, change)
    result = export(pg)
    assert result.returncode != 0
    assert result.stdout == ''
    assert 'cross-household person references' in result.stderr
    assert 'Other household secret' not in result.stderr


def test_pre_person_id_schema_is_rejected_without_guessing(pg):
    execute(pg, 'ALTER TABLE public.annual_income_entry DROP COLUMN person_id')
    result = export(pg)
    assert result.returncode != 0 and result.stdout == ''
    assert 'migrations through 0016' in result.stderr


@pytest.mark.parametrize('household', [None, '', 'not-a-uuid', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', "'; DELETE FROM public.person; --"])
def test_household_must_be_explicit_valid_and_present(pg, household):
    result = export(pg, household)
    assert result.returncode != 0 and result.stdout == ''
    # Literal interpolation cannot turn the UUID selection into SQL commands.
    intact = json.loads(export(pg).stdout)
    assert intact['people'][0]['id'] == P1
