-- Give historical reports an explicit, conservative start point and protect
-- authenticated CSV generation from repeated data-heavy requests.

alter table public.accounts
  add column if not exists tracking_started_on date;

update public.accounts account_record
set tracking_started_on = coalesce(
  (
    select min(transaction_record.occurred_on)
    from public.ledger_entries ledger_entry
    join public.transactions transaction_record
      on transaction_record.id = ledger_entry.transaction_id
    where ledger_entry.account_id = account_record.id
  ),
  current_date
)
where account_record.tracking_started_on is null;

alter table public.accounts
  alter column tracking_started_on set default current_date,
  alter column tracking_started_on set not null;

alter table public.debts
  add column if not exists tracking_started_on date;

update public.debts debt_record
set tracking_started_on = coalesce(
  (
    select min(payment_record.paid_on)
    from public.debt_payments payment_record
    where payment_record.debt_id = debt_record.id
  ),
  current_date
)
where debt_record.tracking_started_on is null;

alter table public.debts
  alter column tracking_started_on set default current_date,
  alter column tracking_started_on set not null;

create function public.reserve_finance_export(
  actor_id uuid,
  target_household uuid,
  export_kind text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'Server-only operation';
  end if;

  if export_kind not in ('transactions', 'accounts', 'report') then
    raise exception 'Invalid export kind';
  end if;

  if not exists (select 1 from public.profiles profile where profile.id = actor_id)
    or not exists (
      select 1
      from public.household_members membership
      where membership.household_id = target_household
        and membership.user_id = actor_id
    ) then
    raise exception 'Export access denied';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('finance-export:' || actor_id::text, 0)
  );

  if (
    select count(*)
    from public.audit_events audit_record
    where audit_record.actor_id = reserve_finance_export.actor_id
      and audit_record.entity_type = 'finance_export'
      and audit_record.created_at > now() - interval '5 minutes'
  ) >= 20 then
    raise exception 'Too many exports. Wait a few minutes and try again.';
  end if;

  if (
    select count(*)
    from public.audit_events audit_record
    where audit_record.household_id = target_household
      and audit_record.entity_type = 'finance_export'
      and audit_record.created_at > now() - interval '5 minutes'
  ) >= 80 then
    raise exception 'Household export limit reached. Wait a few minutes and try again.';
  end if;

  insert into public.audit_events (
    household_id,
    actor_id,
    owner_id,
    visibility,
    entity_type,
    entity_id,
    action,
    data
  ) values (
    target_household,
    actor_id,
    actor_id,
    'private',
    'finance_export',
    target_household,
    'download',
    jsonb_build_object('kind', export_kind)
  );
end;
$$;

revoke all on function public.reserve_finance_export(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.reserve_finance_export(uuid, uuid, text)
  to service_role;
