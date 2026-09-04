-- Private transaction drafts and immutable correction/reversal workflows.
-- Posted ledger entries are never edited or deleted. Corrections create a new
-- transaction and mark the superseded record inactive for derived balances.

alter table public.transactions
  add column corrects_transaction_id uuid references public.transactions(id) on delete restrict,
  add column correction_reason text,
  add column reversal_reason text;

alter table public.transactions
  add constraint transactions_correction_reason_length
    check (correction_reason is null or length(trim(correction_reason)) between 3 and 500),
  add constraint transactions_reversal_reason_length
    check (reversal_reason is null or length(trim(reversal_reason)) between 3 and 500),
  add constraint transactions_correction_not_self
    check (corrects_transaction_id is null or corrects_transaction_id <> id),
  add constraint transactions_correction_fields_together
    check ((corrects_transaction_id is null) = (correction_reason is null)),
  add constraint transactions_reversal_is_voided
    check (reversal_reason is null or voided_at is not null);

create unique index transactions_active_correction_idx
  on public.transactions (corrects_transaction_id)
  where corrects_transaction_id is not null and voided_at is null;
create index transactions_owner_created_idx on public.transactions (owner_id, created_at desc);

create table public.transaction_drafts (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete restrict,
  transfer_account_id uuid references public.accounts(id) on delete restrict,
  category_id uuid references public.categories(id) on delete set null,
  payee_id uuid references public.payees(id) on delete set null,
  tag_ids uuid[] not null default '{}',
  kind public.transaction_kind not null,
  amount numeric(18,2) not null check (amount > 0 and amount <= 999999999999),
  currency char(3) not null check (currency in ('COP', 'USD', 'EUR')),
  occurred_on date not null check (occurred_on >= date '1900-01-01'),
  visibility public.visibility not null,
  payee text check (payee is null or length(trim(payee)) <= 120),
  note text check (note is null or length(trim(note)) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint transaction_drafts_tags_bounded check (cardinality(tag_ids) <= 12),
  constraint transaction_drafts_transfer_shape check (
    (kind = 'transfer' and transfer_account_id is not null and category_id is null and transfer_account_id <> account_id)
    or (kind <> 'transfer' and transfer_account_id is null)
  )
);

create index transaction_drafts_owner_updated_idx on public.transaction_drafts (owner_id, updated_at desc);
create index transaction_drafts_household_id_idx on public.transaction_drafts (household_id);
create index transaction_drafts_account_id_idx on public.transaction_drafts (account_id);
create index transaction_drafts_transfer_account_id_idx on public.transaction_drafts (transfer_account_id) where transfer_account_id is not null;
create index transaction_drafts_category_id_idx on public.transaction_drafts (category_id) where category_id is not null;
create index transaction_drafts_payee_id_idx on public.transaction_drafts (payee_id) where payee_id is not null;

alter table public.transaction_drafts enable row level security;
create policy "owners read transaction drafts" on public.transaction_drafts
  for select to authenticated
  using (
    owner_id = (select auth.uid())
    and exists (
      select 1 from public.household_members member_record
      where member_record.household_id = transaction_drafts.household_id
        and member_record.user_id = (select auth.uid())
    )
  );

revoke all on public.transaction_drafts from public, anon, authenticated;
grant select on public.transaction_drafts to authenticated;
grant select, insert, update, delete on public.transaction_drafts to service_role;

create function private.validate_posted_transaction_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  source_record public.accounts;
  target_record public.accounts;
begin
  if new.status <> 'posted'::public.transaction_status then return new; end if;

  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(hashtextextended('transaction-post:' || new.owner_id::text, 0));
    if (
      select count(*) from public.transactions transaction_record
      where transaction_record.owner_id = new.owner_id
        and transaction_record.created_at >= now() - interval '1 minute'
    ) >= 30 then
      raise exception 'Transaction limit reached. Try again shortly.';
    end if;
  end if;

  if new.amount <= 0 or new.amount > 999999999999 or new.reporting_exchange_rate <= 0
    or new.reporting_exchange_rate > 1000000 or new.occurred_on < date '1900-01-01'
    or new.occurred_on > current_date + 1 or new.currency not in ('COP', 'USD', 'EUR') then
    raise exception 'Invalid transaction values';
  end if;

  select * into source_record from public.accounts account_record where account_record.id = new.account_id;
  if not found or source_record.household_id <> new.household_id or source_record.archived_at is not null
    or source_record.currency <> new.currency
    or (source_record.visibility = 'private'::public.visibility
      and (new.visibility <> 'private'::public.visibility or source_record.owner_id <> new.owner_id)) then
    raise exception 'Source account must match household, currency, visibility, and owner';
  end if;

  if new.kind = 'transfer'::public.transaction_kind then
    select * into target_record from public.accounts account_record where account_record.id = new.transfer_account_id;
    if not found or target_record.id = source_record.id or target_record.household_id <> new.household_id
      or target_record.archived_at is not null or target_record.currency <> new.currency
      or (target_record.visibility = 'private'::public.visibility
        and (new.visibility <> 'private'::public.visibility or target_record.owner_id <> new.owner_id))
      or new.category_id is not null then
      raise exception 'Transfer account must match household, currency, visibility, and owner';
    end if;
  elsif new.transfer_account_id is not null then
    raise exception 'Destination account is only valid for transfers';
  end if;

  if new.category_id is not null and not exists (
    select 1 from public.categories category_record
    where category_record.id = new.category_id and category_record.household_id = new.household_id
      and (new.kind = 'adjustment'::public.transaction_kind or category_record.kind = new.kind::text)
  ) then
    raise exception 'Category access denied';
  end if;

  if new.corrects_transaction_id is not null and not exists (
    select 1 from public.transactions original_record
    where original_record.id = new.corrects_transaction_id
      and original_record.household_id = new.household_id
      and original_record.owner_id = new.owner_id
      and original_record.kind = new.kind
      and original_record.status = 'posted'::public.transaction_status
      and original_record.voided_at is not null
  ) then
    raise exception 'Corrected transaction must replace a voided record owned by the same user';
  end if;
  return new;
end;
$$;

revoke all on function private.validate_posted_transaction_scope() from public, anon, authenticated, service_role;

create trigger validate_posted_transaction_scope
before insert or update of household_id, owner_id, visibility, account_id, transfer_account_id,
  category_id, kind, status, amount, currency, reporting_exchange_rate, occurred_on,
  corrects_transaction_id, correction_reason
on public.transactions
for each row execute function private.validate_posted_transaction_scope();

create function public.save_transaction_draft(
  actor_id uuid,
  target_draft uuid,
  target_household uuid,
  source_account uuid,
  target_account uuid,
  target_category uuid,
  target_payee uuid,
  target_tags uuid[],
  transaction_kind public.transaction_kind,
  transaction_amount numeric,
  transaction_currency char(3),
  transaction_date date,
  transaction_visibility public.visibility,
  transaction_payee text,
  transaction_note text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  draft_record public.transaction_drafts;
  source_record public.accounts;
  target_record public.accounts;
  normalized_tags uuid[] := coalesce(target_tags, '{}'::uuid[]);
  normalized_currency char(3) := upper(trim(transaction_currency));
  normalized_payee text := nullif(trim(transaction_payee), '');
  normalized_note text := nullif(trim(transaction_note), '');
  selected_payee text;
  saved_draft_id uuid;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then raise exception 'Server-only operation'; end if;
  if actor_id is null or not exists (
    select 1 from public.household_members member_record
    where member_record.household_id = target_household and member_record.user_id = actor_id
  ) then raise exception 'Household access denied'; end if;

  perform pg_advisory_xact_lock(hashtextextended('transaction-draft:' || actor_id::text, 0));
  if (
    select count(*) from public.audit_events audit_record
    where audit_record.actor_id = actor_id and audit_record.action in ('save_transaction_draft', 'delete_transaction_draft', 'post_transaction_draft')
      and audit_record.created_at >= now() - interval '1 minute'
  ) >= 30 then raise exception 'Draft change limit reached'; end if;

  if transaction_amount <= 0 or transaction_amount > 999999999999 or normalized_currency not in ('COP', 'USD', 'EUR')
    or transaction_date is null or transaction_date < date '1900-01-01' or transaction_date > current_date + 1
    or cardinality(normalized_tags) > 12 or length(coalesce(normalized_payee, '')) > 120
    or length(coalesce(normalized_note, '')) > 2000 then raise exception 'Invalid transaction draft'; end if;

  select * into source_record from public.accounts account_record where account_record.id = source_account;
  if not found or source_record.household_id <> target_household or source_record.archived_at is not null
    or source_record.currency <> normalized_currency
    or (source_record.visibility = 'private'::public.visibility
      and (transaction_visibility <> 'private'::public.visibility or source_record.owner_id <> actor_id)) then
    raise exception 'Draft source account access denied';
  end if;

  if transaction_kind = 'transfer'::public.transaction_kind then
    select * into target_record from public.accounts account_record where account_record.id = target_account;
    if not found or target_record.id = source_record.id or target_record.household_id <> target_household
      or target_record.archived_at is not null or target_record.currency <> normalized_currency
      or (target_record.visibility = 'private'::public.visibility
        and (transaction_visibility <> 'private'::public.visibility or target_record.owner_id <> actor_id))
      or target_category is not null then raise exception 'Draft transfer account access denied'; end if;
  elsif target_account is not null then raise exception 'Draft destination is only valid for transfers'; end if;

  if target_category is not null and not exists (
    select 1 from public.categories category_record
    where category_record.id = target_category and category_record.household_id = target_household
      and (transaction_kind = 'adjustment'::public.transaction_kind or category_record.kind = transaction_kind::text)
  ) then raise exception 'Category access denied'; end if;

  if target_payee is not null then
    select payee_record.name into selected_payee from public.payees payee_record
    where payee_record.id = target_payee and payee_record.household_id = target_household;
    if selected_payee is null then raise exception 'Payee access denied'; end if;
    normalized_payee := selected_payee;
  end if;
  if exists (
    select 1 from unnest(normalized_tags) requested_tag
    left join public.tags household_tag on household_tag.id = requested_tag and household_tag.household_id = target_household
    where household_tag.id is null
  ) then raise exception 'Tag access denied'; end if;

  if target_draft is null then
    if (select count(*) from public.transaction_drafts existing_draft where existing_draft.owner_id = actor_id) >= 50 then
      raise exception 'Draft limit reached';
    end if;
    insert into public.transaction_drafts (
      household_id, owner_id, account_id, transfer_account_id, category_id, payee_id, tag_ids,
      kind, amount, currency, occurred_on, visibility, payee, note
    ) values (
      target_household, actor_id, source_account, target_account, target_category, target_payee,
      normalized_tags, transaction_kind, transaction_amount, normalized_currency, transaction_date,
      transaction_visibility, normalized_payee, normalized_note
    ) returning id into saved_draft_id;
  else
    select * into draft_record from public.transaction_drafts existing_draft
    where existing_draft.id = target_draft for update;
    if not found or draft_record.owner_id <> actor_id or draft_record.household_id <> target_household then
      raise exception 'Draft access denied';
    end if;
    update public.transaction_drafts set
      account_id = source_account, transfer_account_id = target_account, category_id = target_category,
      payee_id = target_payee, tag_ids = normalized_tags, kind = transaction_kind,
      amount = transaction_amount, currency = normalized_currency, occurred_on = transaction_date,
      visibility = transaction_visibility, payee = normalized_payee, note = normalized_note, updated_at = now()
    where id = target_draft returning id into saved_draft_id;
  end if;

  insert into public.audit_events (household_id, actor_id, owner_id, visibility, entity_type, entity_id, action, data)
  values (target_household, actor_id, actor_id, 'private', 'transaction_draft', saved_draft_id, 'save_transaction_draft', jsonb_build_object('intended_visibility', transaction_visibility, 'kind', transaction_kind));
  return saved_draft_id;
end;
$$;

create function public.delete_transaction_draft(actor_id uuid, target_draft uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare draft_record public.transaction_drafts;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then raise exception 'Server-only operation'; end if;
  perform pg_advisory_xact_lock(hashtextextended('transaction-draft:' || actor_id::text, 0));
  select * into draft_record from public.transaction_drafts existing_draft where existing_draft.id = target_draft for update;
  if not found or draft_record.owner_id <> actor_id or not exists (
    select 1 from public.household_members member_record
    where member_record.household_id = draft_record.household_id and member_record.user_id = actor_id
  ) then raise exception 'Draft access denied'; end if;
  delete from public.transaction_drafts where id = draft_record.id;
  insert into public.audit_events (household_id, actor_id, owner_id, visibility, entity_type, entity_id, action, data)
  values (draft_record.household_id, actor_id, actor_id, 'private', 'transaction_draft', draft_record.id, 'delete_transaction_draft', '{}'::jsonb);
  return draft_record.id;
end;
$$;

create function public.post_transaction_draft(actor_id uuid, target_draft uuid, transaction_rate numeric)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  draft_record public.transaction_drafts;
  posted_transaction_id uuid;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then raise exception 'Server-only operation'; end if;
  if transaction_rate <= 0 or transaction_rate > 1000000 then raise exception 'Invalid transaction values'; end if;
  perform pg_advisory_xact_lock(hashtextextended('transaction-draft:' || actor_id::text, 0));
  select * into draft_record from public.transaction_drafts existing_draft where existing_draft.id = target_draft for update;
  if not found or draft_record.owner_id <> actor_id or not exists (
    select 1 from public.household_members member_record
    where member_record.household_id = draft_record.household_id and member_record.user_id = actor_id
  ) then raise exception 'Draft access denied'; end if;

  posted_transaction_id := public.post_organized_transaction(
    actor_id, draft_record.household_id, draft_record.account_id, draft_record.transfer_account_id,
    draft_record.category_id, draft_record.payee_id, draft_record.tag_ids, draft_record.kind,
    draft_record.amount, draft_record.currency, transaction_rate, draft_record.occurred_on,
    draft_record.visibility, draft_record.payee, draft_record.note, '[]'::jsonb
  );
  delete from public.transaction_drafts where id = draft_record.id;
  insert into public.audit_events (household_id, actor_id, owner_id, visibility, entity_type, entity_id, action, data)
  values (draft_record.household_id, actor_id, actor_id, draft_record.visibility, 'transaction_draft', draft_record.id, 'post_transaction_draft', jsonb_build_object('transaction_id', posted_transaction_id));
  return posted_transaction_id;
end;
$$;

create function public.correct_owned_transaction(
  actor_id uuid,
  target_transaction uuid,
  source_account uuid,
  target_category uuid,
  target_payee uuid,
  target_tags uuid[],
  transaction_amount numeric,
  transaction_currency char(3),
  transaction_rate numeric,
  transaction_date date,
  transaction_visibility public.visibility,
  transaction_payee text,
  transaction_note text,
  correction_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  original_record public.transactions;
  corrected_transaction_id uuid;
  normalized_reason text := trim(coalesce(correction_reason, ''));
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then raise exception 'Server-only operation'; end if;
  if actor_id is null or length(normalized_reason) < 3 or length(normalized_reason) > 500 then raise exception 'Correction reason is required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('transaction-correction:' || actor_id::text, 0));
  if (
    select count(*) from public.audit_events audit_record
    where audit_record.actor_id = actor_id and audit_record.action in ('correct_transaction', 'reverse_transaction')
      and audit_record.created_at >= now() - interval '1 minute'
  ) >= 10 then raise exception 'Transaction correction limit reached'; end if;

  select * into original_record from public.transactions transaction_record
  where transaction_record.id = target_transaction for update;
  if not found or original_record.owner_id <> actor_id or original_record.status <> 'posted'::public.transaction_status
    or original_record.voided_at is not null or original_record.kind = 'transfer'::public.transaction_kind
    or original_record.shopping_list_id is not null or original_record.metadata <> '{}'::jsonb
    or exists (select 1 from public.transaction_items item_record where item_record.transaction_id = original_record.id)
    or exists (
      select 1 from public.reconciliation_entries reconciliation_entry
      join public.ledger_entries ledger_entry on ledger_entry.id = reconciliation_entry.ledger_entry_id
      where ledger_entry.transaction_id = original_record.id
    ) then raise exception 'Only unreconciled manual movements can be corrected'; end if;

  corrected_transaction_id := public.post_organized_transaction(
    actor_id, original_record.household_id, source_account, null, target_category, target_payee,
    coalesce(target_tags, '{}'::uuid[]), original_record.kind, transaction_amount,
    transaction_currency, transaction_rate, transaction_date, transaction_visibility,
    transaction_payee, transaction_note, '[]'::jsonb
  );
  update public.transactions set voided_at = now(), voided_by = actor_id, updated_at = now()
  where id = original_record.id;
  update public.transactions set corrects_transaction_id = original_record.id,
    correction_reason = normalized_reason, updated_at = now()
  where id = corrected_transaction_id;
  insert into public.audit_events (household_id, actor_id, owner_id, visibility, entity_type, entity_id, action, data)
  values (original_record.household_id, actor_id, actor_id, transaction_visibility, 'transaction', corrected_transaction_id, 'correct_transaction', jsonb_build_object('superseded_transaction_id', original_record.id, 'reason', normalized_reason));
  return corrected_transaction_id;
end;
$$;

create function public.reverse_owned_transaction(actor_id uuid, target_transaction uuid, reversal_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  transaction_record public.transactions;
  normalized_reason text := trim(coalesce(reversal_reason, ''));
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then raise exception 'Server-only operation'; end if;
  if actor_id is null or length(normalized_reason) < 3 or length(normalized_reason) > 500 then raise exception 'Reversal reason is required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('transaction-correction:' || actor_id::text, 0));
  if (
    select count(*) from public.audit_events audit_record
    where audit_record.actor_id = actor_id and audit_record.action in ('correct_transaction', 'reverse_transaction')
      and audit_record.created_at >= now() - interval '1 minute'
  ) >= 10 then raise exception 'Transaction correction limit reached'; end if;

  select * into transaction_record from public.transactions existing_transaction
  where existing_transaction.id = target_transaction for update;
  if not found or transaction_record.owner_id <> actor_id or transaction_record.status <> 'posted'::public.transaction_status
    or transaction_record.voided_at is not null or transaction_record.kind = 'transfer'::public.transaction_kind
    or transaction_record.shopping_list_id is not null or transaction_record.metadata <> '{}'::jsonb
    or exists (select 1 from public.transaction_items item_record where item_record.transaction_id = transaction_record.id)
    or exists (
      select 1 from public.reconciliation_entries reconciliation_entry
      join public.ledger_entries ledger_entry on ledger_entry.id = reconciliation_entry.ledger_entry_id
      where ledger_entry.transaction_id = transaction_record.id
    ) then raise exception 'Only unreconciled manual movements can be reversed'; end if;

  update public.transactions set voided_at = now(), voided_by = actor_id,
    reversal_reason = normalized_reason, updated_at = now()
  where id = transaction_record.id;
  insert into public.audit_events (household_id, actor_id, owner_id, visibility, entity_type, entity_id, action, data)
  values (transaction_record.household_id, actor_id, actor_id, transaction_record.visibility, 'transaction', transaction_record.id, 'reverse_transaction', jsonb_build_object('reason', normalized_reason));
  return transaction_record.id;
end;
$$;

create or replace function public.void_owned_expense(actor_id uuid, target_transaction uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then raise exception 'Server-only operation'; end if;
  if not exists (
    select 1 from public.transactions transaction_record
    where transaction_record.id = target_transaction and transaction_record.owner_id = actor_id
      and transaction_record.kind = 'expense'::public.transaction_kind
  ) then raise exception 'Expense cannot be removed'; end if;
  return public.reverse_owned_transaction(actor_id, target_transaction, 'Removed by creator');
end;
$$;

revoke all on function public.save_transaction_draft(uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid[], public.transaction_kind, numeric, char(3), date, public.visibility, text, text) from public, anon, authenticated;
revoke all on function public.delete_transaction_draft(uuid, uuid) from public, anon, authenticated;
revoke all on function public.post_transaction_draft(uuid, uuid, numeric) from public, anon, authenticated;
revoke all on function public.correct_owned_transaction(uuid, uuid, uuid, uuid, uuid, uuid[], numeric, char(3), numeric, date, public.visibility, text, text, text) from public, anon, authenticated;
revoke all on function public.reverse_owned_transaction(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.void_owned_expense(uuid, uuid) from public, anon, authenticated;

grant execute on function public.save_transaction_draft(uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid[], public.transaction_kind, numeric, char(3), date, public.visibility, text, text) to service_role;
grant execute on function public.delete_transaction_draft(uuid, uuid) to service_role;
grant execute on function public.post_transaction_draft(uuid, uuid, numeric) to service_role;
grant execute on function public.correct_owned_transaction(uuid, uuid, uuid, uuid, uuid, uuid[], numeric, char(3), numeric, date, public.visibility, text, text, text) to service_role;
grant execute on function public.reverse_owned_transaction(uuid, uuid, text) to service_role;
grant execute on function public.void_owned_expense(uuid, uuid) to service_role;
