-- Ledgerly core schema. Run with `supabase db push` after linking a project.
create extension if not exists "pgcrypto";

create type public.visibility as enum ('private', 'shared');
create type public.member_role as enum ('owner', 'member');
create type public.account_kind as enum ('cash', 'bank', 'card', 'savings', 'loan');
create type public.transaction_kind as enum ('income', 'expense', 'transfer', 'adjustment');
create type public.transaction_status as enum ('posted', 'projected');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '', created_at timestamptz not null default now()
);
create table public.households (
  id uuid primary key default gen_random_uuid(), name text not null,
  reporting_currency char(3) not null default 'USD', default_tax_rate numeric(7,4) not null default 0,
  created_at timestamptz not null default now()
);
create table public.household_members (
  household_id uuid references public.households(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  role public.member_role not null default 'member', created_at timestamptz not null default now(),
  primary key (household_id, user_id)
);

create or replace function public.is_household_member(target_household uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.household_members where household_id = target_household and user_id = auth.uid());
$$;
create or replace function public.is_household_owner(target_household uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.household_members where household_id = target_household and user_id = auth.uid() and role = 'owner');
$$;

create table public.categories (
  id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id) on delete cascade,
  name text not null, kind text not null check (kind in ('income','expense')), parent_id uuid references public.categories(id), color text, icon text,
  unique(household_id, name, kind)
);
create table public.accounts (
  id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id) on delete cascade,
  owner_id uuid not null references public.profiles(id), visibility public.visibility not null default 'shared',
  name text not null, kind public.account_kind not null, currency char(3) not null, opening_balance numeric(18,2) not null default 0,
  credit_limit numeric(18,2), statement_balance numeric(18,2), closing_day smallint, due_day smallint, archived_at timestamptz
);
create table public.transactions (
  id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id) on delete cascade,
  owner_id uuid not null references public.profiles(id), visibility public.visibility not null default 'shared', account_id uuid not null references public.accounts(id),
  transfer_account_id uuid references public.accounts(id), category_id uuid references public.categories(id), kind public.transaction_kind not null,
  status public.transaction_status not null default 'posted', amount numeric(18,2) not null check(amount >= 0), currency char(3) not null,
  reporting_exchange_rate numeric(18,8) not null default 1, occurred_on date not null, payee text, note text, metadata jsonb not null default '{}',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.recurring_rules (
  id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id) on delete cascade,
  owner_id uuid not null references public.profiles(id), visibility public.visibility not null default 'shared', account_id uuid not null references public.accounts(id),
  category_id uuid references public.categories(id), name text not null, amount numeric(18,2) not null, currency char(3) not null, cadence text not null,
  next_due_on date not null, active boolean not null default true, metadata jsonb not null default '{}'
);
create table public.goals (
  id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id) on delete cascade, owner_id uuid not null references public.profiles(id), visibility public.visibility not null default 'shared',
  name text not null, target_amount numeric(18,2) not null, current_amount numeric(18,2) not null default 0, currency char(3) not null, target_date date, color text
);
create table public.debts (
  id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id) on delete cascade, owner_id uuid not null references public.profiles(id), visibility public.visibility not null default 'shared',
  account_id uuid references public.accounts(id), creditor text not null, balance numeric(18,2) not null, currency char(3) not null, interest_rate numeric(8,4), minimum_payment numeric(18,2), due_day smallint
);
create table public.budgets (
  id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id) on delete cascade, owner_id uuid not null references public.profiles(id), visibility public.visibility not null default 'shared',
  category_id uuid references public.categories(id), month date not null, amount numeric(18,2) not null, envelope_amount numeric(18,2) not null default 0, currency char(3) not null
);
create table public.category_templates (
  id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id) on delete cascade, owner_id uuid not null references public.profiles(id), visibility public.visibility not null default 'shared',
  name text not null, category_id uuid references public.categories(id), icon text, description text, is_builtin boolean not null default false
);
create table public.template_fields (
  id uuid primary key default gen_random_uuid(), template_id uuid not null references public.category_templates(id) on delete cascade,
  label text not null, field_type text not null check(field_type in ('text','amount','date','checkbox','select','multiselect','list','formula')),
  required boolean not null default false, options jsonb not null default '[]', formula text, sort_order integer not null default 0
);
create table public.shopping_lists (
  id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id) on delete cascade, owner_id uuid not null references public.profiles(id), visibility public.visibility not null default 'shared',
  name text not null, currency char(3) not null, default_tax_rate numeric(7,4) not null default 0, discount numeric(18,2) not null default 0, shipping numeric(18,2) not null default 0, tip numeric(18,2) not null default 0,
  status text not null default 'open' check(status in ('open','checked_out')), created_at timestamptz not null default now()
);
create table public.shopping_items (
  id uuid primary key default gen_random_uuid(), list_id uuid not null references public.shopping_lists(id) on delete cascade, category_id uuid references public.categories(id),
  name text not null, quantity numeric(12,3) not null default 1, estimated_price numeric(18,2) not null default 0, actual_price numeric(18,2), bought boolean not null default false,
  tax_rate numeric(7,4), fixed_tax numeric(18,2), sort_order integer not null default 0
);
create table public.receipts (
  id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id) on delete cascade, owner_id uuid not null references public.profiles(id), visibility public.visibility not null default 'shared',
  transaction_id uuid references public.transactions(id) on delete cascade, storage_path text not null, created_at timestamptz not null default now()
);
create table public.audit_events (
  id bigint generated always as identity primary key, household_id uuid not null references public.households(id) on delete cascade, actor_id uuid references public.profiles(id),
  entity_type text not null, entity_id uuid, action text not null, data jsonb not null default '{}', created_at timestamptz not null default now()
);
alter table public.transactions add column shopping_list_id uuid references public.shopping_lists(id);

-- Member access includes shared objects and each user's private objects.
create or replace function public.can_access(target_household uuid, target_owner uuid, target_visibility public.visibility)
returns boolean language sql stable security definer set search_path = public as $$
 select public.is_household_member(target_household) and (target_visibility = 'shared' or target_owner = auth.uid());
$$;
alter table public.households enable row level security; alter table public.household_members enable row level security;
alter table public.categories enable row level security; alter table public.accounts enable row level security; alter table public.transactions enable row level security;
alter table public.recurring_rules enable row level security; alter table public.goals enable row level security; alter table public.debts enable row level security; alter table public.budgets enable row level security;
alter table public.category_templates enable row level security; alter table public.shopping_lists enable row level security; alter table public.receipts enable row level security; alter table public.audit_events enable row level security;
create policy "members see households" on public.households for select using (public.is_household_member(id));
create policy "owners update households" on public.households for update using (public.is_household_owner(id));
create policy "members see membership" on public.household_members for select using (public.is_household_member(household_id));
create policy "owners manage membership" on public.household_members for all using (public.is_household_owner(household_id));
-- The following policy pattern is intentionally reusable for every scoped table above.
create policy "member categories" on public.categories for all using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));
create policy "scoped accounts" on public.accounts for all using (public.can_access(household_id, owner_id, visibility)) with check (public.can_access(household_id, owner_id, visibility));
create policy "scoped transactions" on public.transactions for all using (public.can_access(household_id, owner_id, visibility)) with check (public.can_access(household_id, owner_id, visibility));
create policy "scoped recurring" on public.recurring_rules for all using (public.can_access(household_id, owner_id, visibility)) with check (public.can_access(household_id, owner_id, visibility));
create policy "scoped goals" on public.goals for all using (public.can_access(household_id, owner_id, visibility)) with check (public.can_access(household_id, owner_id, visibility));
create policy "scoped debts" on public.debts for all using (public.can_access(household_id, owner_id, visibility)) with check (public.can_access(household_id, owner_id, visibility));
create policy "scoped budgets" on public.budgets for all using (public.can_access(household_id, owner_id, visibility)) with check (public.can_access(household_id, owner_id, visibility));
create policy "scoped templates" on public.category_templates for all using (public.can_access(household_id, owner_id, visibility)) with check (public.can_access(household_id, owner_id, visibility));
create policy "scoped lists" on public.shopping_lists for all using (public.can_access(household_id, owner_id, visibility)) with check (public.can_access(household_id, owner_id, visibility));
create policy "scoped receipts" on public.receipts for all using (public.can_access(household_id, owner_id, visibility)) with check (public.can_access(household_id, owner_id, visibility));
create policy "member audits" on public.audit_events for select using (public.is_household_member(household_id));
alter table public.template_fields enable row level security; alter table public.shopping_items enable row level security;
create policy "template fields visible" on public.template_fields for all using (exists(select 1 from public.category_templates t where t.id=template_id and public.can_access(t.household_id,t.owner_id,t.visibility))) with check (exists(select 1 from public.category_templates t where t.id=template_id and public.can_access(t.household_id,t.owner_id,t.visibility)));
create policy "shopping items visible" on public.shopping_items for all using (exists(select 1 from public.shopping_lists l where l.id=list_id and public.can_access(l.household_id,l.owner_id,l.visibility))) with check (exists(select 1 from public.shopping_lists l where l.id=list_id and public.can_access(l.household_id,l.owner_id,l.visibility)));
