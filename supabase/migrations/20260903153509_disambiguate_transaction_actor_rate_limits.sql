-- Resolve PL/pgSQL parameter/column ambiguity in the three rate-limit queries.
-- The positional parameter is intentional here: audit_events also has an
-- actor_id column, so `$1` is unambiguously the function caller argument.

create or replace function public.save_transaction_draft(
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
    where audit_record.actor_id = $1
      and audit_record.action in ('save_transaction_draft', 'delete_transaction_draft', 'post_transaction_draft')
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

create or replace function public.correct_owned_transaction(
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
    where audit_record.actor_id = $1
      and audit_record.action in ('correct_transaction', 'reverse_transaction')
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

create or replace function public.reverse_owned_transaction(actor_id uuid, target_transaction uuid, reversal_reason text)
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
    where audit_record.actor_id = $1
      and audit_record.action in ('correct_transaction', 'reverse_transaction')
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

-- CREATE OR REPLACE retains the existing restricted execute grants, but repeat
-- the revocation so the migration remains safe if defaults change.
revoke all on function public.save_transaction_draft(uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid[], public.transaction_kind, numeric, char(3), date, public.visibility, text, text) from public, anon, authenticated;
revoke all on function public.correct_owned_transaction(uuid, uuid, uuid, uuid, uuid, uuid[], numeric, char(3), numeric, date, public.visibility, text, text, text) from public, anon, authenticated;
revoke all on function public.reverse_owned_transaction(uuid, uuid, text) from public, anon, authenticated;

grant execute on function public.save_transaction_draft(uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid[], public.transaction_kind, numeric, char(3), date, public.visibility, text, text) to service_role;
grant execute on function public.correct_owned_transaction(uuid, uuid, uuid, uuid, uuid, uuid[], numeric, char(3), numeric, date, public.visibility, text, text, text) to service_role;
grant execute on function public.reverse_owned_transaction(uuid, uuid, text) to service_role;
