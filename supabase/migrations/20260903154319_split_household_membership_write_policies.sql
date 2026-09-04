-- Owners are household members, so their SELECT access is already covered by
-- "members see membership". Splitting the old FOR ALL policy prevents Postgres
-- from evaluating two permissive policies for every membership read.

drop policy if exists "owners manage membership" on public.household_members;

create policy "owners insert membership" on public.household_members
  for insert to authenticated
  with check (private.is_household_owner(household_id));

create policy "owners update membership" on public.household_members
  for update to authenticated
  using (private.is_household_owner(household_id))
  with check (private.is_household_owner(household_id));

create policy "owners delete membership" on public.household_members
  for delete to authenticated
  using (private.is_household_owner(household_id));
