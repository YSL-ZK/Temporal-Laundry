-- Keep RLS-only helpers out of the exposed Data API schema. These functions
-- must retain SECURITY DEFINER to break membership-policy recursion, but they
-- are not application RPC endpoints.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create or replace function private.is_household_member(target_household uuid)
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

create or replace function private.is_household_owner(target_household uuid)
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

create or replace function private.can_access(
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
  select private.is_household_member(target_household)
    and (target_visibility = 'shared' or target_owner = (select auth.uid()));
$$;

revoke all on function private.is_household_member(uuid) from public;
revoke all on function private.is_household_owner(uuid) from public;
revoke all on function private.can_access(uuid, uuid, public.visibility) from public;
grant execute on function private.is_household_member(uuid), private.is_household_owner(uuid), private.can_access(uuid, uuid, public.visibility) to authenticated;

drop policy if exists "members see households" on public.households;
drop policy if exists "owners update households" on public.households;
drop policy if exists "members see membership" on public.household_members;
drop policy if exists "owners manage membership" on public.household_members;
drop policy if exists "member categories" on public.categories;
drop policy if exists "scoped accounts" on public.accounts;
drop policy if exists "scoped transactions" on public.transactions;
drop policy if exists "scoped recurring" on public.recurring_rules;
drop policy if exists "scoped goals" on public.goals;
drop policy if exists "scoped debts" on public.debts;
drop policy if exists "scoped budgets" on public.budgets;
drop policy if exists "scoped templates" on public.category_templates;
drop policy if exists "scoped lists" on public.shopping_lists;
drop policy if exists "scoped receipts" on public.receipts;
drop policy if exists "member audits" on public.audit_events;
drop policy if exists "template fields visible" on public.template_fields;
drop policy if exists "shopping items visible" on public.shopping_items;

create policy "members see households" on public.households
  for select to authenticated using (private.is_household_member(id));
create policy "owners update households" on public.households
  for update to authenticated using (private.is_household_owner(id))
  with check (private.is_household_owner(id));
create policy "members see membership" on public.household_members
  for select to authenticated using (private.is_household_member(household_id));
create policy "owners manage membership" on public.household_members
  for all to authenticated using (private.is_household_owner(household_id))
  with check (private.is_household_owner(household_id));
create policy "member categories" on public.categories
  for all to authenticated using (private.is_household_member(household_id))
  with check (private.is_household_member(household_id));
create policy "scoped accounts" on public.accounts
  for all to authenticated using (private.can_access(household_id, owner_id, visibility))
  with check (private.can_access(household_id, owner_id, visibility));
create policy "scoped transactions" on public.transactions
  for all to authenticated using (private.can_access(household_id, owner_id, visibility))
  with check (private.can_access(household_id, owner_id, visibility));
create policy "scoped recurring" on public.recurring_rules
  for all to authenticated using (private.can_access(household_id, owner_id, visibility))
  with check (private.can_access(household_id, owner_id, visibility));
create policy "scoped goals" on public.goals
  for all to authenticated using (private.can_access(household_id, owner_id, visibility))
  with check (private.can_access(household_id, owner_id, visibility));
create policy "scoped debts" on public.debts
  for all to authenticated using (private.can_access(household_id, owner_id, visibility))
  with check (private.can_access(household_id, owner_id, visibility));
create policy "scoped budgets" on public.budgets
  for all to authenticated using (private.can_access(household_id, owner_id, visibility))
  with check (private.can_access(household_id, owner_id, visibility));
create policy "scoped templates" on public.category_templates
  for all to authenticated using (private.can_access(household_id, owner_id, visibility))
  with check (private.can_access(household_id, owner_id, visibility));
create policy "scoped lists" on public.shopping_lists
  for all to authenticated using (private.can_access(household_id, owner_id, visibility))
  with check (private.can_access(household_id, owner_id, visibility));
create policy "scoped receipts" on public.receipts
  for all to authenticated using (private.can_access(household_id, owner_id, visibility))
  with check (private.can_access(household_id, owner_id, visibility));
create policy "member audits" on public.audit_events
  for select to authenticated using (private.is_household_member(household_id));
create policy "template fields visible" on public.template_fields
  for all to authenticated
  using (exists (
    select 1 from public.category_templates t
    where t.id = template_id and private.can_access(t.household_id, t.owner_id, t.visibility)
  ))
  with check (exists (
    select 1 from public.category_templates t
    where t.id = template_id and private.can_access(t.household_id, t.owner_id, t.visibility)
  ));
create policy "shopping items visible" on public.shopping_items
  for all to authenticated
  using (exists (
    select 1 from public.shopping_lists l
    where l.id = list_id and private.can_access(l.household_id, l.owner_id, l.visibility)
  ))
  with check (exists (
    select 1 from public.shopping_lists l
    where l.id = list_id and private.can_access(l.household_id, l.owner_id, l.visibility)
  ));

drop function public.can_access(uuid, uuid, public.visibility);
drop function public.is_household_owner(uuid);
drop function public.is_household_member(uuid);

-- The existing automatic-RLS event trigger must never be exposed as an RPC.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke execute on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end;
$$;
