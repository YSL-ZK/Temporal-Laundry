begin;

create extension if not exists pgtap with schema extensions;
set local role postgres;
set local search_path = extensions, public, pg_catalog;

select extensions.plan(12);

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
values
  ('fa100000-0000-4000-a000-000000000001', 'ai-owner@laundry.test', now(), '{"display_name":"AI owner"}'),
  ('fa100000-0000-4000-a000-000000000002', 'ai-outsider@laundry.test', now(), '{"display_name":"AI outsider"}');

insert into public.households (id, name, reporting_currency, default_tax_rate)
values ('fa200000-0000-4000-a000-000000000001', 'AI quota household', 'COP', 0);

insert into public.household_members (household_id, user_id, role)
values ('fa200000-0000-4000-a000-000000000001', 'fa100000-0000-4000-a000-000000000001', 'owner');

select extensions.throws_ok(
  $$select public.reserve_ai_request('fa100000-0000-4000-a000-000000000002', 'fa200000-0000-4000-a000-000000000001')$$,
  'P0001',
  'AI access denied',
  'assistant reservations require membership in the target household'
);

select extensions.is(
  (public.reserve_ai_request('fa100000-0000-4000-a000-000000000001', 'fa200000-0000-4000-a000-000000000001')->>'allowed')::boolean,
  true,
  'the first request is reserved'
);
select extensions.is(
  (public.reserve_ai_request('fa100000-0000-4000-a000-000000000001', 'fa200000-0000-4000-a000-000000000001')->>'allowed')::boolean,
  true,
  'the second request is reserved'
);
select extensions.is(
  (public.reserve_ai_request('fa100000-0000-4000-a000-000000000001', 'fa200000-0000-4000-a000-000000000001')->>'allowed')::boolean,
  true,
  'the third request is reserved'
);
select extensions.is(
  public.reserve_ai_request('fa100000-0000-4000-a000-000000000001', 'fa200000-0000-4000-a000-000000000001')->>'reason',
  'burst',
  'a fourth request inside five minutes is denied'
);

truncate table public.ai_usage_events;
insert into public.ai_usage_events (household_id, user_id, created_at)
select 'fa200000-0000-4000-a000-000000000001', 'fa100000-0000-4000-a000-000000000002', now()
from generate_series(1, 30);
select extensions.is(
  public.reserve_ai_request('fa100000-0000-4000-a000-000000000001', 'fa200000-0000-4000-a000-000000000001')->>'reason',
  'household_daily',
  'the household daily allowance cannot be bypassed with another member account'
);

truncate table public.ai_usage_events;
insert into public.ai_usage_events (household_id, user_id, created_at)
select 'fa200000-0000-4000-a000-000000000001', 'fa100000-0000-4000-a000-000000000001', now() - interval '1 day'
from generate_series(1, 10);
select extensions.is(
  (public.reserve_ai_request('fa100000-0000-4000-a000-000000000001', 'fa200000-0000-4000-a000-000000000001')->>'allowed')::boolean,
  true,
  'usage from a prior UTC day does not consume today allowance'
);

truncate table public.ai_usage_events;
create temporary table ai_test_reservation as
select (public.reserve_ai_request('fa100000-0000-4000-a000-000000000001', 'fa200000-0000-4000-a000-000000000001')->>'requestId')::uuid as id;

select public.finish_ai_request((select id from ai_test_reservation), 'groq', 'openai/gpt-oss-20b', true, 5000, 50000);
select extensions.is(
  (select status from public.ai_usage_events where id = (select id from ai_test_reservation)),
  'succeeded',
  'a reserved request can be completed once'
);
select extensions.is(
  (select prompt_chars from public.ai_usage_events where id = (select id from ai_test_reservation)),
  1200,
  'stored prompt metadata is clamped to the privacy limit'
);
select extensions.is(
  (select response_chars from public.ai_usage_events where id = (select id from ai_test_reservation)),
  12000,
  'stored response metadata is clamped to the privacy limit'
);

select public.finish_ai_request((select id from ai_test_reservation), 'tampered', 'tampered-model', false, 1, 1);
select extensions.is(
  (select provider from public.ai_usage_events where id = (select id from ai_test_reservation)),
  'groq',
  'completion metadata cannot be overwritten after the reservation is finished'
);

truncate table public.ai_usage_events;
insert into public.ai_usage_events (household_id, user_id)
select 'fa200000-0000-4000-a000-000000000001', 'fa100000-0000-4000-a000-000000000001'
from generate_series(1, 200);
select extensions.throws_ok(
  $$insert into public.ai_usage_events (household_id, user_id) values ('fa200000-0000-4000-a000-000000000001', 'fa100000-0000-4000-a000-000000000001')$$,
  'P0001',
  'AI global daily limit reached',
  'the project-wide daily ceiling is enforced for every insertion path'
);

select * from extensions.finish();

rollback;
