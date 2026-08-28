-- Secure public user records and create the first household through a narrowly scoped RPC.
-- This migration follows the core schema migration in 001_finance_schema.sql.

alter table public.profiles enable row level security;

grant usage on schema public to authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.households, public.household_members,
  public.categories, public.accounts, public.transactions, public.recurring_rules,
  public.goals, public.debts, public.budgets, public.category_templates,
  public.template_fields, public.shopping_lists, public.shopping_items,
  public.receipts, public.audit_events to authenticated;

create policy "users view own profile" on public.profiles
  for select to authenticated using ((select auth.uid()) = id);
create policy "users update own profile" on public.profiles
  for update to authenticated using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(new.email, '@', 1)));
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- These functions read membership inside RLS policies, so they must bypass the
-- household_members policy itself. They are not callable by anonymous users.
create or replace function public.is_household_member(target_household uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.household_members
    where household_id = target_household and user_id = (select auth.uid())
  );
$$;

create or replace function public.is_household_owner(target_household uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.household_members
    where household_id = target_household
      and user_id = (select auth.uid())
      and role = 'owner'
  );
$$;

create or replace function public.can_access(
  target_household uuid,
  target_owner uuid,
  target_visibility public.visibility
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_household_member(target_household)
    and (target_visibility = 'shared' or target_owner = (select auth.uid()));
$$;

revoke all on function public.is_household_member(uuid) from public;
revoke all on function public.is_household_owner(uuid) from public;
revoke all on function public.can_access(uuid, uuid, public.visibility) from public;
grant execute on function public.is_household_member(uuid), public.is_household_owner(uuid), public.can_access(uuid, uuid, public.visibility) to authenticated;

drop policy if exists "owners update households" on public.households;
create policy "owners update households" on public.households
  for update to authenticated using (public.is_household_owner(id))
  with check (public.is_household_owner(id));

drop policy if exists "owners manage membership" on public.household_members;
create policy "owners manage membership" on public.household_members
  for all to authenticated using (public.is_household_owner(household_id))
  with check (public.is_household_owner(household_id));

create or replace function public.create_household(
  household_name text,
  household_currency char(3) default 'USD',
  household_tax_rate numeric default 0
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
  if (select auth.uid()) is null then
    raise exception 'You must be signed in to create a household';
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

  if not exists (select 1 from public.profiles where id = (select auth.uid())) then
    raise exception 'Your profile is not ready yet. Please sign out and sign in again.';
  end if;

  insert into public.households (name, reporting_currency, default_tax_rate)
  values (trim(household_name), normalized_currency, household_tax_rate)
  returning id into new_household_id;

  insert into public.household_members (household_id, user_id, role)
  values (new_household_id, (select auth.uid()), 'owner');

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

revoke all on function public.create_household(text, char(3), numeric) from public;
grant execute on function public.create_household(text, char(3), numeric) to authenticated;
