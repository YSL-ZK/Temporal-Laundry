-- The following mutation RPCs need elevated database privileges to preserve
-- atomic ledger writes and immutable invitations. They are deliberately
-- executable only by the server's service-role key, never browser JWTs.

drop function public.create_household(text, char(3), numeric);
drop function public.create_household_invitation(uuid, text);
drop function public.accept_household_invitation(uuid);
drop function public.post_transaction(uuid, uuid, uuid, uuid, public.transaction_kind, numeric, char(3), numeric, date, public.visibility, text, text, jsonb);

create function public.create_household(
  actor_id uuid,
  household_name text,
  household_currency char(3),
  household_tax_rate numeric
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_household_id uuid;
  normalized_currency char(3);
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'Server-only operation';
  end if;
  if actor_id is null or not exists (select 1 from public.profiles where id = actor_id) then
    raise exception 'A verified user profile is required';
  end if;
  if length(trim(household_name)) = 0 or length(trim(household_name)) > 80 then
    raise exception 'Household name must be between 1 and 80 characters';
  end if;
  normalized_currency := upper(trim(household_currency));
  if normalized_currency !~ '^[A-Z]{3}$' then
    raise exception 'Reporting currency must be a three-letter ISO code';
  end if;
  if household_tax_rate < 0 or household_tax_rate > 100 then
    raise exception 'Default tax rate must be between 0 and 100';
  end if;

  insert into public.households (name, reporting_currency, default_tax_rate)
  values (trim(household_name), normalized_currency, household_tax_rate)
  returning id into new_household_id;

  insert into public.household_members (household_id, user_id, role)
  values (new_household_id, actor_id, 'owner');

  insert into public.categories (household_id, name, kind, color)
  values
    (new_household_id, 'Salary', 'income', '#378f7b'),
    (new_household_id, 'Other income', 'income', '#7789ca'),
    (new_household_id, 'Groceries', 'expense', '#de9d4e'),
    (new_household_id, 'Shopping', 'expense', '#c86d55'),
    (new_household_id, 'Dining', 'expense', '#d6809a'),
    (new_household_id, 'Transport', 'expense', '#6c91c9'),
    (new_household_id, 'Bills', 'expense', '#8a78ba'),
    (new_household_id, 'Subscriptions', 'expense', '#9c8a73'),
    (new_household_id, 'Health', 'expense', '#5a9b8a'),
    (new_household_id, 'Travel', 'expense', '#608ac2'),
    (new_household_id, 'Home', 'expense', '#8b9b67'),
    (new_household_id, 'Other', 'expense', '#7b808c');

  return new_household_id;
end;
$$;

create function public.create_household_invitation(
  actor_id uuid,
  target_household uuid,
  invite_email text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  invitation_id uuid;
  normalized_email text;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'Server-only operation';
  end if;
  if actor_id is null or not exists (
    select 1 from public.household_members
    where household_id = target_household and user_id = actor_id and role = 'owner'
  ) then
    raise exception 'Only household owners can invite members';
  end if;
  if coalesce((select count(*) from public.household_invitations
    where invited_by = actor_id and created_at > now() - interval '1 hour'), 0) >= 10 then
    raise exception 'Invitation limit reached. Try again later.';
  end if;
  normalized_email := lower(trim(invite_email));
  if normalized_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Invalid email address';
  end if;
  insert into public.household_invitations (household_id, invited_by, email)
  values (target_household, actor_id, normalized_email)
  on conflict (household_id, email, status) do update
    set status = 'pending', expires_at = now() + interval '7 days', created_at = now()
  returning id into invitation_id;
  return invitation_id;
end;
$$;

create function public.accept_household_invitation(
  actor_id uuid,
  invitation_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  invite public.household_invitations;
  account_email text;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'Server-only operation';
  end if;
  if actor_id is null then
    raise exception 'You must be signed in';
  end if;
  select lower(email) into account_email
  from auth.users
  where id = actor_id and email_confirmed_at is not null;
  if account_email is null then
    raise exception 'A verified email address is required';
  end if;
  select * into invite from public.household_invitations where id = invitation_id for update;
  if not found or invite.status <> 'pending' or invite.expires_at <= now() or invite.email <> account_email then
    raise exception 'Invitation is invalid or expired';
  end if;
  insert into public.household_members (household_id, user_id, role)
  values (invite.household_id, actor_id, 'member') on conflict do nothing;
  update public.household_invitations set status = 'accepted', accepted_at = now() where id = invitation_id;
  return invite.household_id;
end;
$$;

create function public.post_transaction(
  actor_id uuid,
  target_household uuid,
  source_account uuid,
  target_account uuid,
  target_category uuid,
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
  item jsonb;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'Server-only operation';
  end if;
  if actor_id is null or not exists (
    select 1 from public.household_members where household_id = target_household and user_id = actor_id
  ) then
    raise exception 'Household access denied';
  end if;
  if transaction_amount <= 0 or transaction_rate <= 0 or transaction_date is null or upper(trim(transaction_currency)) !~ '^[A-Z]{3}$' then
    raise exception 'Invalid transaction values';
  end if;
  if transaction_payee is not null and length(trim(transaction_payee)) > 120 then
    raise exception 'Payee must be 120 characters or fewer';
  end if;
  if transaction_note is not null and length(trim(transaction_note)) > 2000 then
    raise exception 'Note must be 2000 characters or fewer';
  end if;
  if jsonb_typeof(coalesce(transaction_items, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(transaction_items, '[]'::jsonb)) > 250 then
    raise exception 'Invalid transaction items';
  end if;
  if not exists (
    select 1 from public.accounts a
    where a.id = source_account and a.household_id = target_household
      and (a.visibility = 'shared'::public.visibility or a.owner_id = actor_id)
  ) then
    raise exception 'Source account access denied';
  end if;
  if transaction_kind = 'transfer' then
    if target_category is not null or target_account is null or target_account = source_account or not exists (
      select 1 from public.accounts a
      where a.id = target_account and a.household_id = target_household
        and (a.visibility = 'shared'::public.visibility or a.owner_id = actor_id)
    ) then
      raise exception 'A different accessible destination account is required';
    end if;
  elsif target_account is not null then
    raise exception 'Destination account is only valid for transfers';
  end if;
  if target_category is not null and not exists (
    select 1 from public.categories
    where id = target_category and household_id = target_household
      and (transaction_kind = 'adjustment' or kind = transaction_kind::text)
  ) then
    raise exception 'Category access denied';
  end if;

  insert into public.transactions (household_id, owner_id, visibility, account_id, transfer_account_id, category_id, kind, status, amount, currency, reporting_exchange_rate, occurred_on, payee, note)
  values (target_household, actor_id, transaction_visibility, source_account, target_account, target_category, transaction_kind, 'posted', transaction_amount, upper(transaction_currency), transaction_rate, transaction_date, nullif(trim(transaction_payee), ''), nullif(trim(transaction_note), ''))
  returning id into transaction_id;

  if transaction_kind = 'income' or transaction_kind = 'adjustment' then
    insert into public.ledger_entries (transaction_id, account_id, amount)
    values (transaction_id, source_account, transaction_amount);
  elsif transaction_kind = 'expense' then
    insert into public.ledger_entries (transaction_id, account_id, amount)
    values (transaction_id, source_account, -transaction_amount);
  else
    insert into public.ledger_entries (transaction_id, account_id, amount)
    values (transaction_id, source_account, -transaction_amount), (transaction_id, target_account, transaction_amount);
  end if;

  for item in select value from jsonb_array_elements(coalesce(transaction_items, '[]'::jsonb)) loop
    if jsonb_typeof(item) <> 'object'
      or coalesce(length(trim(item ->> 'name')), 0) = 0
      or length(trim(item ->> 'name')) > 160
      or coalesce((item ->> 'quantity')::numeric, 1) <= 0
      or coalesce((item ->> 'unitPrice')::numeric, 0) < 0
      or coalesce((item ->> 'discount')::numeric, 0) < 0
      or coalesce((item ->> 'tax')::numeric, 0) < 0
      or (item ? 'categoryId' and not exists (
        select 1 from public.categories
        where id = nullif(item ->> 'categoryId', '')::uuid and household_id = target_household and kind = 'expense'
      )) then
      raise exception 'Invalid transaction item';
    end if;
    insert into public.transaction_items (transaction_id, category_id, name, quantity, unit_price, discount, tax)
    values (transaction_id, nullif(item ->> 'categoryId', '')::uuid, left(trim(item ->> 'name'), 160), coalesce((item ->> 'quantity')::numeric, 1), coalesce((item ->> 'unitPrice')::numeric, 0), coalesce((item ->> 'discount')::numeric, 0), coalesce((item ->> 'tax')::numeric, 0));
  end loop;
  return transaction_id;
end;
$$;

-- Browser roles have read access only to immutable ledger-derived records.
revoke insert, update, delete on public.transactions, public.ledger_entries, public.transaction_items, public.transaction_tags, public.household_invitations from authenticated;

revoke all on function public.create_household(uuid, text, char(3), numeric) from public, anon, authenticated;
revoke all on function public.create_household_invitation(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.accept_household_invitation(uuid, uuid) from public, anon, authenticated;
revoke all on function public.post_transaction(uuid, uuid, uuid, uuid, uuid, public.transaction_kind, numeric, char(3), numeric, date, public.visibility, text, text, jsonb) from public, anon, authenticated;

grant execute on function public.create_household(uuid, text, char(3), numeric) to service_role;
grant execute on function public.create_household_invitation(uuid, uuid, text) to service_role;
grant execute on function public.accept_household_invitation(uuid, uuid) to service_role;
grant execute on function public.post_transaction(uuid, uuid, uuid, uuid, uuid, public.transaction_kind, numeric, char(3), numeric, date, public.visibility, text, text, jsonb) to service_role;
