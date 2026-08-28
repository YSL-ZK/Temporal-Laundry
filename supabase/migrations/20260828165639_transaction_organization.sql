-- Payees and tags are reusable household data. Writes stay behind rate-limited,
-- service-role-only RPCs; browser clients retain RLS-scoped read access.

alter table public.transactions
  add column if not exists payee_id uuid references public.payees(id) on delete set null;

create index if not exists transactions_household_occurred_idx
  on public.transactions (household_id, occurred_on desc, created_at desc)
  where voided_at is null;
create index if not exists transactions_payee_id_idx on public.transactions (payee_id);
create index if not exists transaction_tags_tag_transaction_idx on public.transaction_tags (tag_id, transaction_id);

revoke insert, update, delete on public.payees, public.tags, public.transaction_tags from authenticated;

create or replace function public.create_payee(
  actor_id uuid,
  target_household uuid,
  payee_name text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_name text := trim(payee_name);
  new_payee_id uuid;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'Server-only operation';
  end if;
  if actor_id is null or not exists (
    select 1 from public.household_members
    where household_id = target_household and user_id = actor_id
  ) then
    raise exception 'Household access denied';
  end if;
  if length(normalized_name) < 1 or length(normalized_name) > 120 then
    raise exception 'Payee name must be between 1 and 120 characters';
  end if;
  if (
    select count(*) from public.audit_events
    where actor_id = $1 and action in ('create_payee', 'create_tag')
      and created_at >= now() - interval '1 minute'
  ) >= 30 then
    raise exception 'Organizer rate limit exceeded';
  end if;

  select id into new_payee_id from public.payees
  where household_id = target_household and lower(name) = lower(normalized_name)
  limit 1;
  if new_payee_id is null then
    insert into public.payees (household_id, name)
    values (target_household, normalized_name)
    returning id into new_payee_id;
  end if;

  insert into public.audit_events (
    household_id, actor_id, owner_id, visibility, entity_type, entity_id, action, data
  ) values (
    target_household, actor_id, actor_id, 'shared', 'payee', new_payee_id,
    'create_payee', jsonb_build_object('name', normalized_name)
  );
  return new_payee_id;
end;
$$;

create or replace function public.create_tag(
  actor_id uuid,
  target_household uuid,
  tag_name text,
  tag_color text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_name text := trim(tag_name);
  normalized_color text := lower(trim(tag_color));
  new_tag_id uuid;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'Server-only operation';
  end if;
  if actor_id is null or not exists (
    select 1 from public.household_members
    where household_id = target_household and user_id = actor_id
  ) then
    raise exception 'Household access denied';
  end if;
  if length(normalized_name) < 1 or length(normalized_name) > 40 then
    raise exception 'Tag name must be between 1 and 40 characters';
  end if;
  if normalized_color !~ '^#[0-9a-f]{6}$' then
    raise exception 'Tag color must be a six-digit hex color';
  end if;
  if (
    select count(*) from public.audit_events
    where actor_id = $1 and action in ('create_payee', 'create_tag')
      and created_at >= now() - interval '1 minute'
  ) >= 30 then
    raise exception 'Organizer rate limit exceeded';
  end if;

  select id into new_tag_id from public.tags
  where household_id = target_household and lower(name) = lower(normalized_name)
  limit 1;
  if new_tag_id is null then
    insert into public.tags (household_id, name, color)
    values (target_household, normalized_name, normalized_color)
    returning id into new_tag_id;
  end if;

  insert into public.audit_events (
    household_id, actor_id, owner_id, visibility, entity_type, entity_id, action, data
  ) values (
    target_household, actor_id, actor_id, 'shared', 'tag', new_tag_id,
    'create_tag', jsonb_build_object('name', normalized_name, 'color', normalized_color)
  );
  return new_tag_id;
end;
$$;

create or replace function public.post_organized_transaction(
  actor_id uuid,
  target_household uuid,
  source_account uuid,
  target_account uuid,
  target_category uuid,
  target_payee uuid,
  target_tags uuid[],
  transaction_kind public.transaction_kind,
  transaction_amount numeric,
  transaction_currency char(3),
  transaction_rate numeric,
  transaction_date date,
  transaction_visibility public.visibility,
  transaction_payee text,
  transaction_note text,
  transaction_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  transaction_id uuid;
  selected_payee text;
  normalized_tags uuid[] := coalesce(target_tags, '{}'::uuid[]);
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'Server-only operation';
  end if;
  if actor_id is null or not exists (
    select 1 from public.household_members
    where household_id = target_household and user_id = actor_id
  ) then
    raise exception 'Household access denied';
  end if;
  if cardinality(normalized_tags) > 12 then
    raise exception 'A transaction can have at most 12 tags';
  end if;
  if target_payee is not null then
    select name into selected_payee from public.payees
    where id = target_payee and household_id = target_household;
    if selected_payee is null then raise exception 'Payee access denied'; end if;
  end if;
  if exists (
    select 1 from unnest(normalized_tags) requested_tag
    left join public.tags household_tag
      on household_tag.id = requested_tag and household_tag.household_id = target_household
    where household_tag.id is null
  ) then
    raise exception 'Tag access denied';
  end if;

  transaction_id := public.post_transaction(
    actor_id, target_household, source_account, target_account, target_category,
    transaction_kind, transaction_amount, transaction_currency, transaction_rate,
    transaction_date, transaction_visibility,
    coalesce(selected_payee, nullif(trim(transaction_payee), '')),
    transaction_note, transaction_items
  );

  update public.transactions set payee_id = target_payee where id = transaction_id;
  insert into public.transaction_tags (transaction_id, tag_id)
  select transaction_id, distinct_tag
  from (select distinct unnest(normalized_tags) as distinct_tag) selected_tags;

  insert into public.audit_events (
    household_id, actor_id, owner_id, visibility, entity_type, entity_id, action, data
  ) values (
    target_household, actor_id, actor_id, transaction_visibility,
    'transaction', transaction_id, 'post_organized_transaction',
    jsonb_build_object('payee_id', target_payee, 'tag_count', cardinality(normalized_tags))
  );
  return transaction_id;
end;
$$;

revoke all on function public.create_payee(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.create_tag(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.post_organized_transaction(uuid, uuid, uuid, uuid, uuid, uuid, uuid[], public.transaction_kind, numeric, char(3), numeric, date, public.visibility, text, text, jsonb) from public, anon, authenticated;

grant execute on function public.create_payee(uuid, uuid, text) to service_role;
grant execute on function public.create_tag(uuid, uuid, text, text) to service_role;
grant execute on function public.post_organized_transaction(uuid, uuid, uuid, uuid, uuid, uuid, uuid[], public.transaction_kind, numeric, char(3), numeric, date, public.visibility, text, text, jsonb) to service_role;

-- Parameterized text search avoids constructing PostgREST filter expressions
-- from user input. SECURITY INVOKER keeps transaction and related-table RLS active.
create or replace function public.search_transaction_ids(
  target_household uuid,
  search_query text
)
returns table (transaction_id uuid)
language sql
stable
security invoker
set search_path = ''
as $$
  select transaction_record.id
  from public.transactions transaction_record
  left join public.accounts transaction_account on transaction_account.id = transaction_record.account_id
  left join public.categories transaction_category on transaction_category.id = transaction_record.category_id
  left join public.payees transaction_payee on transaction_payee.id = transaction_record.payee_id
  where transaction_record.household_id = target_household
    and transaction_record.voided_at is null
    and (
      transaction_record.payee ilike '%' || trim(search_query) || '%'
      or transaction_record.note ilike '%' || trim(search_query) || '%'
      or transaction_account.name ilike '%' || trim(search_query) || '%'
      or transaction_category.name ilike '%' || trim(search_query) || '%'
      or transaction_payee.name ilike '%' || trim(search_query) || '%'
      or exists (
        select 1 from public.transaction_tags transaction_tag
        join public.tags search_tag on search_tag.id = transaction_tag.tag_id
        where transaction_tag.transaction_id = transaction_record.id
          and search_tag.name ilike '%' || trim(search_query) || '%'
      )
    )
  order by transaction_record.occurred_on desc, transaction_record.created_at desc
  limit 500;
$$;

revoke all on function public.search_transaction_ids(uuid, text) from public, anon;
grant execute on function public.search_transaction_ids(uuid, text) to authenticated;
