-- Laundry's finance assistant never stores prompts or model responses. This
-- table records only bounded usage metadata so quotas work across Vercel
-- instances and cannot be bypassed with parallel requests.

create table public.ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'reserved' check (status in ('reserved', 'succeeded', 'failed')),
  provider text check (provider is null or length(provider) between 1 and 40),
  model text check (model is null or length(model) between 1 and 120),
  prompt_chars integer not null default 0 check (prompt_chars between 0 and 1200),
  response_chars integer not null default 0 check (response_chars between 0 and 12000),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index ai_usage_user_created_idx on public.ai_usage_events (user_id, created_at desc);
create index ai_usage_household_created_idx on public.ai_usage_events (household_id, created_at desc);

alter table public.ai_usage_events enable row level security;
alter table public.ai_usage_events force row level security;
revoke all on public.ai_usage_events from public, anon, authenticated;
grant select, insert, update, delete on public.ai_usage_events to service_role;

create or replace function public.reserve_ai_request(actor_id uuid, target_household uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  burst_count integer;
  user_daily_count integer;
  household_daily_count integer;
  request_id uuid;
  reset_at timestamptz;
begin
  if actor_id is null or target_household is null
    or not exists (select 1 from public.profiles p where p.id = actor_id)
    or not exists (
      select 1 from public.household_members hm
      where hm.user_id = actor_id and hm.household_id = target_household
    ) then
    raise exception 'AI access denied';
  end if;

  -- The household lock is always acquired before the user lock. This keeps
  -- both household and user quotas atomic without deadlocking concurrent calls.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_household::text, 7101));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor_id::text, 7102));

  delete from public.ai_usage_events where created_at < now() - interval '90 days';
  reset_at := (date_trunc('day', now() at time zone 'UTC') + interval '1 day') at time zone 'UTC';

  select count(*) into burst_count
  from public.ai_usage_events
  where user_id = actor_id and created_at >= now() - interval '5 minutes';

  select count(*) into user_daily_count
  from public.ai_usage_events
  where user_id = actor_id and created_at >= date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';

  select count(*) into household_daily_count
  from public.ai_usage_events
  where household_id = target_household and created_at >= date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';

  if burst_count >= 3 then
    return jsonb_build_object('allowed', false, 'reason', 'burst', 'retryAfterSeconds', 300, 'remaining', greatest(0, 10 - user_daily_count), 'resetAt', reset_at);
  end if;
  if user_daily_count >= 10 then
    return jsonb_build_object('allowed', false, 'reason', 'user_daily', 'retryAfterSeconds', greatest(1, extract(epoch from (reset_at - now()))::integer), 'remaining', 0, 'resetAt', reset_at);
  end if;
  if household_daily_count >= 30 then
    return jsonb_build_object('allowed', false, 'reason', 'household_daily', 'retryAfterSeconds', greatest(1, extract(epoch from (reset_at - now()))::integer), 'remaining', 0, 'resetAt', reset_at);
  end if;

  insert into public.ai_usage_events (household_id, user_id)
  values (target_household, actor_id)
  returning id into request_id;

  return jsonb_build_object('allowed', true, 'requestId', request_id, 'remaining', greatest(0, 9 - user_daily_count), 'resetAt', reset_at);
end;
$$;

create or replace function public.finish_ai_request(
  request_id uuid,
  provider_name text,
  model_name text,
  request_succeeded boolean,
  input_chars integer,
  output_chars integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.ai_usage_events
  set status = case when request_succeeded then 'succeeded' else 'failed' end,
      provider = left(nullif(trim(provider_name), ''), 40),
      model = left(nullif(trim(model_name), ''), 120),
      prompt_chars = greatest(0, least(coalesce(input_chars, 0), 1200)),
      response_chars = greatest(0, least(coalesce(output_chars, 0), 12000)),
      completed_at = now()
  where id = request_id and status = 'reserved';
end;
$$;

revoke all on function public.reserve_ai_request(uuid, uuid) from public, anon, authenticated;
revoke all on function public.finish_ai_request(uuid, text, text, boolean, integer, integer) from public, anon, authenticated;
grant execute on function public.reserve_ai_request(uuid, uuid) to service_role;
grant execute on function public.finish_ai_request(uuid, text, text, boolean, integer, integer) to service_role;
