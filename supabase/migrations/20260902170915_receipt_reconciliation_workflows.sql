-- Secure receipt lifecycle and account reconciliation workflows.
-- Receipt binaries remain in a private bucket. Browser roles may only read
-- active metadata/objects permitted by household scope; all mutations are
-- service-role RPCs that independently validate the actor.

alter table public.receipts
  add column if not exists original_filename text,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.profiles(id);

alter table public.receipts
  add constraint receipts_storage_path_length check (length(storage_path) between 10 and 500),
  add constraint receipts_original_filename_length check (original_filename is null or length(original_filename) between 1 and 180),
  add constraint receipts_mime_type_allowed check (mime_type is null or mime_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf'));

create index receipts_transaction_id_idx on public.receipts (transaction_id);
create index receipts_owner_id_idx on public.receipts (owner_id);
create index receipts_household_active_created_idx on public.receipts (household_id, created_at desc)
  where deleted_at is null;

drop policy if exists "scoped receipts" on public.receipts;
create policy "read active scoped receipts" on public.receipts
  for select to authenticated
  using (deleted_at is null and private.can_access(household_id, owner_id, visibility));

revoke all on public.receipts from public, anon, authenticated;
grant select on public.receipts to authenticated;
grant select, insert, update, delete on public.receipts to service_role;

drop policy if exists "read scoped receipt objects" on storage.objects;
create policy "read scoped receipt objects" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'receipts'
    and exists (
      select 1
      from public.receipts receipt
      where receipt.storage_path = name
        and receipt.deleted_at is null
        and private.can_access(receipt.household_id, receipt.owner_id, receipt.visibility)
    )
  );

alter table public.reconciliations
  add column if not exists period_start date,
  add column if not exists ledger_balance numeric(18,2),
  add column if not exists discrepancy numeric(18,2),
  add column if not exists status text,
  add column if not exists matched_entry_count integer,
  add column if not exists adjustment_transaction_id uuid references public.transactions(id);

update public.reconciliations
set period_start = coalesce(period_start, statement_ending_on),
    ledger_balance = coalesce(ledger_balance, statement_ending_balance),
    discrepancy = coalesce(discrepancy, 0),
    matched_entry_count = coalesce(matched_entry_count, 0),
    status = coalesce(status, 'balanced');

alter table public.reconciliations
  alter column period_start set not null,
  alter column ledger_balance set not null,
  alter column discrepancy set not null,
  alter column matched_entry_count set not null,
  alter column matched_entry_count set default 0,
  alter column status set not null,
  alter column status set default 'balanced',
  add constraint reconciliations_period_valid check (period_start <= statement_ending_on),
  add constraint reconciliations_status_valid check (status in ('balanced', 'discrepancy', 'adjusted')),
  add constraint reconciliations_note_length check (note is null or length(note) <= 1000);

create unique index reconciliations_account_ending_idx on public.reconciliations (account_id, statement_ending_on);
create index reconciliations_household_ending_idx on public.reconciliations (household_id, statement_ending_on desc);
create index reconciliations_owner_id_idx on public.reconciliations (owner_id);
create unique index reconciliation_entries_ledger_entry_idx on public.reconciliation_entries (ledger_entry_id);

drop policy if exists "scoped reconciliations" on public.reconciliations;
create policy "read own reconciliations" on public.reconciliations
  for select to authenticated
  using (owner_id = (select auth.uid()) and private.is_household_member(household_id));

revoke all on public.reconciliations, public.reconciliation_entries from public, anon, authenticated;
grant select on public.reconciliations, public.reconciliation_entries to authenticated;
grant select, insert, update, delete on public.reconciliations, public.reconciliation_entries to service_role;

create function public.register_receipt(
  actor_id uuid,
  target_transaction uuid,
  receipt_storage_path text,
  receipt_mime_type text,
  receipt_size_bytes bigint,
  receipt_original_filename text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  transaction_record public.transactions;
  receipt_id uuid;
  normalized_filename text;
begin
  if actor_id is null or receipt_storage_path is null or length(receipt_storage_path) not between 10 and 500
    or receipt_mime_type not in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')
    or receipt_size_bytes not between 1 and 10485760 then
    raise exception 'Invalid receipt metadata';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(actor_id::text || ':receipt_mutation', 0));
  if coalesce((
    select count(*) from public.receipts receipt
    where receipt.owner_id = register_receipt.actor_id
      and receipt.created_at > now() - interval '1 minute'
  ), 0) >= 10 then
    raise exception 'Receipt upload limit reached. Try again shortly.';
  end if;

  select * into transaction_record
  from public.transactions transaction_row
  where transaction_row.id = target_transaction
  for update;

  if not found or transaction_record.status <> 'posted' or transaction_record.voided_at is not null
    or not exists (
      select 1 from public.household_members member
      where member.household_id = transaction_record.household_id and member.user_id = actor_id
    )
    or (transaction_record.visibility = 'private'::public.visibility and transaction_record.owner_id <> actor_id) then
    raise exception 'Receipt transaction access denied';
  end if;

  if receipt_storage_path !~ ('^' || transaction_record.household_id::text || '/' || actor_id::text || '/[0-9a-f-]{36}\.(jpe?g|png|webp|pdf)$') then
    raise exception 'Invalid receipt storage path';
  end if;
  if (receipt_mime_type = 'application/pdf' and receipt_storage_path !~ '\.pdf$')
    or (receipt_mime_type = 'image/png' and receipt_storage_path !~ '\.png$')
    or (receipt_mime_type = 'image/webp' and receipt_storage_path !~ '\.webp$')
    or (receipt_mime_type = 'image/jpeg' and receipt_storage_path !~ '\.jpe?g$') then
    raise exception 'Receipt type does not match its storage path';
  end if;
  if (select count(*) from public.receipts receipt where receipt.transaction_id = target_transaction and receipt.deleted_at is null) >= 5 then
    raise exception 'Receipt limit reached for this transaction';
  end if;

  normalized_filename := left(regexp_replace(trim(coalesce(receipt_original_filename, 'receipt')), '[[:cntrl:]/\\]+', '_', 'g'), 180);
  if normalized_filename = '' then normalized_filename := 'receipt'; end if;

  insert into public.receipts (
    household_id, owner_id, visibility, transaction_id, storage_path, mime_type, size_bytes, original_filename
  ) values (
    transaction_record.household_id, actor_id, transaction_record.visibility, transaction_record.id,
    receipt_storage_path, receipt_mime_type, receipt_size_bytes, normalized_filename
  ) returning id into receipt_id;

  insert into public.audit_events (household_id, actor_id, owner_id, visibility, entity_type, entity_id, action, data)
  values (
    transaction_record.household_id, actor_id, actor_id, transaction_record.visibility,
    'receipt', receipt_id, 'create', jsonb_build_object('transaction_id', transaction_record.id, 'mime_type', receipt_mime_type, 'size_bytes', receipt_size_bytes)
  );
  return receipt_id;
end;
$$;

create function public.archive_receipt(actor_id uuid, target_receipt uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  receipt_record public.receipts;
begin
  if actor_id is null then raise exception 'Invalid receipt deletion'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor_id::text || ':receipt_mutation', 0));
  select * into receipt_record from public.receipts receipt where receipt.id = target_receipt for update;
  if not found or receipt_record.deleted_at is not null or receipt_record.owner_id <> actor_id
    or not exists (
      select 1 from public.household_members member
      where member.household_id = receipt_record.household_id and member.user_id = actor_id
    ) then
    raise exception 'Receipt deletion access denied';
  end if;

  update public.receipts set deleted_at = now(), deleted_by = actor_id where id = target_receipt;
  insert into public.audit_events (household_id, actor_id, owner_id, visibility, entity_type, entity_id, action, data)
  values (receipt_record.household_id, actor_id, receipt_record.owner_id, receipt_record.visibility, 'receipt', receipt_record.id, 'delete', jsonb_build_object('transaction_id', receipt_record.transaction_id));
  return receipt_record.storage_path;
end;
$$;

create function public.restore_receipt_after_storage_failure(actor_id uuid, target_receipt uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  receipt_record public.receipts;
begin
  select * into receipt_record from public.receipts receipt where receipt.id = target_receipt for update;
  if not found or receipt_record.owner_id <> actor_id or receipt_record.deleted_by <> actor_id
    or receipt_record.deleted_at is null or receipt_record.deleted_at < now() - interval '10 minutes' then
    raise exception 'Receipt restore access denied';
  end if;
  update public.receipts set deleted_at = null, deleted_by = null where id = target_receipt;
  return target_receipt;
end;
$$;

create function public.create_account_reconciliation(
  actor_id uuid,
  target_account uuid,
  reconciliation_period_start date,
  reconciliation_ending_on date,
  reconciliation_statement_balance numeric,
  create_adjustment boolean,
  transaction_rate numeric,
  reconciliation_note text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  account_record public.accounts;
  reconciliation_id uuid := gen_random_uuid();
  computed_ledger_balance numeric(18,2);
  computed_discrepancy numeric(18,2);
  adjustment_id uuid;
  reconciliation_status text;
  matched_entries integer := 0;
begin
  if actor_id is null or reconciliation_period_start is null or reconciliation_ending_on is null
    or reconciliation_period_start > reconciliation_ending_on or reconciliation_ending_on > current_date
    or reconciliation_period_start < current_date - 3650
    or reconciliation_statement_balance < -999999999999 or reconciliation_statement_balance > 999999999999
    or create_adjustment is null
    or transaction_rate <= 0 or transaction_rate > 1000000
    or length(coalesce(reconciliation_note, '')) > 1000 then
    raise exception 'Invalid reconciliation';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target_account::text || ':reconciliation', 0));
  if coalesce((
    select count(*) from public.audit_events event
    where event.actor_id = create_account_reconciliation.actor_id
      and event.entity_type = 'reconciliation'
      and event.created_at > now() - interval '1 minute'
  ), 0) >= 10 then
    raise exception 'Reconciliation limit reached. Try again shortly.';
  end if;

  select * into account_record from public.accounts account where account.id = target_account for update;
  if not found or account_record.archived_at is not null
    or not exists (
      select 1 from public.household_members member
      where member.household_id = account_record.household_id and member.user_id = actor_id
    )
    or (account_record.visibility = 'private'::public.visibility and account_record.owner_id <> actor_id) then
    raise exception 'Reconciliation account access denied';
  end if;
  if exists (
    select 1 from public.reconciliations reconciliation
    where reconciliation.account_id = target_account and reconciliation.statement_ending_on = reconciliation_ending_on
  ) then
    raise exception 'This account and statement date are already reconciled';
  end if;

  select round(account_record.opening_balance + coalesce(sum(entry.amount), 0), 2)
  into computed_ledger_balance
  from public.ledger_entries entry
  join public.transactions transaction_row on transaction_row.id = entry.transaction_id
  where entry.account_id = target_account
    and transaction_row.status = 'posted'
    and transaction_row.voided_at is null
    and transaction_row.occurred_on <= reconciliation_ending_on;

  computed_discrepancy := round(reconciliation_statement_balance - computed_ledger_balance, 2);
  reconciliation_status := case when abs(computed_discrepancy) < 0.005 then 'balanced' else 'discrepancy' end;

  if create_adjustment and abs(computed_discrepancy) >= 0.005 then
    insert into public.transactions (
      household_id, owner_id, visibility, account_id, kind, status, amount, currency,
      reporting_exchange_rate, occurred_on, payee, note, metadata
    ) values (
      account_record.household_id, actor_id, account_record.visibility, account_record.id,
      'adjustment', 'posted', abs(computed_discrepancy), account_record.currency,
      transaction_rate, reconciliation_ending_on, 'Reconciliation adjustment',
      nullif(trim(reconciliation_note), ''), jsonb_build_object('reconciliation_id', reconciliation_id, 'signed_amount', computed_discrepancy)
    ) returning id into adjustment_id;
    insert into public.ledger_entries (transaction_id, account_id, amount)
    values (adjustment_id, account_record.id, computed_discrepancy);
    reconciliation_status := 'adjusted';
  end if;

  insert into public.reconciliations (
    id, account_id, household_id, owner_id, period_start, statement_ending_on,
    statement_ending_balance, ledger_balance, discrepancy, status, adjustment_transaction_id, note
  ) values (
    reconciliation_id, account_record.id, account_record.household_id, actor_id,
    reconciliation_period_start, reconciliation_ending_on, reconciliation_statement_balance,
    computed_ledger_balance, computed_discrepancy, reconciliation_status, adjustment_id, nullif(trim(reconciliation_note), '')
  );

  insert into public.reconciliation_entries (reconciliation_id, ledger_entry_id)
  select reconciliation_id, entry.id
  from public.ledger_entries entry
  join public.transactions transaction_row on transaction_row.id = entry.transaction_id
  where entry.account_id = target_account
    and transaction_row.status = 'posted'
    and transaction_row.voided_at is null
    and transaction_row.occurred_on between reconciliation_period_start and reconciliation_ending_on
    and not exists (
      select 1 from public.reconciliation_entries existing where existing.ledger_entry_id = entry.id
    )
  order by entry.id
  on conflict (ledger_entry_id) do nothing;
  get diagnostics matched_entries = row_count;
  update public.reconciliations set matched_entry_count = matched_entries where id = reconciliation_id;

  insert into public.audit_events (household_id, actor_id, owner_id, visibility, entity_type, entity_id, action, data)
  values (
    account_record.household_id, actor_id, actor_id, 'private', 'reconciliation', reconciliation_id,
    'create', jsonb_build_object('account_id', account_record.id, 'status', reconciliation_status, 'discrepancy', computed_discrepancy, 'adjustment_transaction_id', adjustment_id)
  );
  return reconciliation_id;
end;
$$;

revoke all on function public.register_receipt(uuid, uuid, text, text, bigint, text) from public, anon, authenticated;
revoke all on function public.archive_receipt(uuid, uuid) from public, anon, authenticated;
revoke all on function public.restore_receipt_after_storage_failure(uuid, uuid) from public, anon, authenticated;
revoke all on function public.create_account_reconciliation(uuid, uuid, date, date, numeric, boolean, numeric, text) from public, anon, authenticated;
grant execute on function public.register_receipt(uuid, uuid, text, text, bigint, text) to service_role;
grant execute on function public.archive_receipt(uuid, uuid) to service_role;
grant execute on function public.restore_receipt_after_storage_failure(uuid, uuid) to service_role;
grant execute on function public.create_account_reconciliation(uuid, uuid, date, date, numeric, boolean, numeric, text) to service_role;
