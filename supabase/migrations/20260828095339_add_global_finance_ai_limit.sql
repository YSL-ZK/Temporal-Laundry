-- Prevent account farming from exhausting the upstream free-model allowance.
-- This trigger covers every insert path, including future privileged callers.

create index ai_usage_created_idx on public.ai_usage_events (created_at desc);

create or replace function private.enforce_global_ai_daily_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  global_daily_count integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('laundry-ai-global', 7100));

  select count(*) into global_daily_count
  from public.ai_usage_events
  where created_at >= date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';

  if global_daily_count >= 200 then
    raise exception 'AI global daily limit reached';
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_global_ai_daily_limit() from public, anon, authenticated, service_role;

create trigger enforce_global_ai_daily_limit
before insert on public.ai_usage_events
for each row execute function private.enforce_global_ai_daily_limit();
