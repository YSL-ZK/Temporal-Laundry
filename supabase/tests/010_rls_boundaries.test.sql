begin;

create extension if not exists pgtap with schema extensions;
set local role postgres;
set local search_path = extensions, public, pg_catalog;

select extensions.plan(10);

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
values
  ('f1000000-0000-4000-a000-000000000001', 'owner@laundry.test', now(), '{"display_name":"Test owner"}'),
  ('f1000000-0000-4000-a000-000000000002', 'member@laundry.test', now(), '{"display_name":"Test member"}'),
  ('f1000000-0000-4000-a000-000000000003', 'outsider@laundry.test', now(), '{"display_name":"Test outsider"}');

insert into public.households (id, name, reporting_currency, default_tax_rate)
values
  ('f2000000-0000-4000-a000-000000000001', 'Test household one', 'COP', 19),
  ('f2000000-0000-4000-a000-000000000002', 'Test household two', 'COP', 0);

insert into public.household_members (household_id, user_id, role)
values
  ('f2000000-0000-4000-a000-000000000001', 'f1000000-0000-4000-a000-000000000001', 'owner'),
  ('f2000000-0000-4000-a000-000000000001', 'f1000000-0000-4000-a000-000000000002', 'member'),
  ('f2000000-0000-4000-a000-000000000002', 'f1000000-0000-4000-a000-000000000003', 'owner');

insert into public.categories (id, household_id, name, kind, color)
values
  ('f3000000-0000-4000-a000-000000000001', 'f2000000-0000-4000-a000-000000000001', 'Test expense one', 'expense', '#123456'),
  ('f3000000-0000-4000-a000-000000000002', 'f2000000-0000-4000-a000-000000000002', 'Test expense two', 'expense', '#654321');

insert into public.accounts (id, household_id, owner_id, visibility, name, kind, currency, opening_balance, credit_limit)
values
  ('f4000000-0000-4000-a000-000000000001', 'f2000000-0000-4000-a000-000000000001', 'f1000000-0000-4000-a000-000000000001', 'shared',  'Shared bank',        'bank', 'COP', 1000, null),
  ('f4000000-0000-4000-a000-000000000002', 'f2000000-0000-4000-a000-000000000001', 'f1000000-0000-4000-a000-000000000001', 'private', 'Owner private bank', 'bank', 'COP', 1000, null),
  ('f4000000-0000-4000-a000-000000000003', 'f2000000-0000-4000-a000-000000000001', 'f1000000-0000-4000-a000-000000000002', 'private', 'Member private bank','bank', 'COP', 1000, null),
  ('f4000000-0000-4000-a000-000000000004', 'f2000000-0000-4000-a000-000000000002', 'f1000000-0000-4000-a000-000000000003', 'shared',  'Other bank',         'bank', 'COP', 1000, null),
  ('f4000000-0000-4000-a000-000000000005', 'f2000000-0000-4000-a000-000000000001', 'f1000000-0000-4000-a000-000000000001', 'shared',  'Shared card',        'card', 'COP', 0, 5000),
  ('f4000000-0000-4000-a000-000000000006', 'f2000000-0000-4000-a000-000000000001', 'f1000000-0000-4000-a000-000000000001', 'private', 'Owner private card', 'card', 'COP', 0, 5000),
  ('f4000000-0000-4000-a000-000000000007', 'f2000000-0000-4000-a000-000000000001', 'f1000000-0000-4000-a000-000000000002', 'private', 'Member private card','card', 'COP', 0, 5000),
  ('f4000000-0000-4000-a000-000000000008', 'f2000000-0000-4000-a000-000000000002', 'f1000000-0000-4000-a000-000000000003', 'shared',  'Other card',         'card', 'COP', 0, 5000);

insert into public.card_settings (account_id, payment_account_id, statement_balance, closing_day, due_day)
values
  ('f4000000-0000-4000-a000-000000000005', 'f4000000-0000-4000-a000-000000000001', 100, 10, 20),
  ('f4000000-0000-4000-a000-000000000006', 'f4000000-0000-4000-a000-000000000002', 100, 10, 20),
  ('f4000000-0000-4000-a000-000000000007', 'f4000000-0000-4000-a000-000000000003', 100, 10, 20),
  ('f4000000-0000-4000-a000-000000000008', 'f4000000-0000-4000-a000-000000000004', 100, 10, 20);

insert into public.card_statements
  (id, account_id, household_id, owner_id, visibility, period_start, closing_on, due_on, statement_balance)
values
  ('f4100000-0000-4000-a000-000000000001', 'f4000000-0000-4000-a000-000000000005', 'f2000000-0000-4000-a000-000000000001', 'f1000000-0000-4000-a000-000000000001', 'shared', current_date - 30, current_date - 5, current_date + 10, 100),
  ('f4100000-0000-4000-a000-000000000002', 'f4000000-0000-4000-a000-000000000006', 'f2000000-0000-4000-a000-000000000001', 'f1000000-0000-4000-a000-000000000001', 'private', current_date - 30, current_date - 5, current_date + 10, 100),
  ('f4100000-0000-4000-a000-000000000003', 'f4000000-0000-4000-a000-000000000007', 'f2000000-0000-4000-a000-000000000001', 'f1000000-0000-4000-a000-000000000002', 'private', current_date - 30, current_date - 5, current_date + 10, 100),
  ('f4100000-0000-4000-a000-000000000004', 'f4000000-0000-4000-a000-000000000008', 'f2000000-0000-4000-a000-000000000002', 'f1000000-0000-4000-a000-000000000003', 'shared', current_date - 30, current_date - 5, current_date + 10, 100);

insert into public.transactions
  (id, household_id, owner_id, visibility, account_id, category_id, kind, status, amount, currency, reporting_exchange_rate, occurred_on)
values
  ('f5000000-0000-4000-a000-000000000001', 'f2000000-0000-4000-a000-000000000001', 'f1000000-0000-4000-a000-000000000001', 'shared',  'f4000000-0000-4000-a000-000000000001', 'f3000000-0000-4000-a000-000000000001', 'expense', 'posted', 10, 'COP', 1, current_date),
  ('f5000000-0000-4000-a000-000000000002', 'f2000000-0000-4000-a000-000000000001', 'f1000000-0000-4000-a000-000000000001', 'private', 'f4000000-0000-4000-a000-000000000002', 'f3000000-0000-4000-a000-000000000001', 'expense', 'posted', 10, 'COP', 1, current_date),
  ('f5000000-0000-4000-a000-000000000003', 'f2000000-0000-4000-a000-000000000001', 'f1000000-0000-4000-a000-000000000002', 'private', 'f4000000-0000-4000-a000-000000000003', 'f3000000-0000-4000-a000-000000000001', 'expense', 'posted', 10, 'COP', 1, current_date),
  ('f5000000-0000-4000-a000-000000000004', 'f2000000-0000-4000-a000-000000000002', 'f1000000-0000-4000-a000-000000000003', 'shared',  'f4000000-0000-4000-a000-000000000004', 'f3000000-0000-4000-a000-000000000002', 'expense', 'posted', 10, 'COP', 1, current_date);

insert into public.ledger_entries (id, transaction_id, account_id, amount)
values
  ('f5100000-0000-4000-a000-000000000001', 'f5000000-0000-4000-a000-000000000001', 'f4000000-0000-4000-a000-000000000001', -10),
  ('f5100000-0000-4000-a000-000000000002', 'f5000000-0000-4000-a000-000000000002', 'f4000000-0000-4000-a000-000000000002', -10),
  ('f5100000-0000-4000-a000-000000000003', 'f5000000-0000-4000-a000-000000000003', 'f4000000-0000-4000-a000-000000000003', -10),
  ('f5100000-0000-4000-a000-000000000004', 'f5000000-0000-4000-a000-000000000004', 'f4000000-0000-4000-a000-000000000004', -10);

insert into public.payees (id, household_id, name)
values
  ('f5200000-0000-4000-a000-000000000001', 'f2000000-0000-4000-a000-000000000001', 'Test payee one'),
  ('f5200000-0000-4000-a000-000000000002', 'f2000000-0000-4000-a000-000000000002', 'Test payee two');

insert into public.tags (id, household_id, name, color)
values
  ('f5300000-0000-4000-a000-000000000001', 'f2000000-0000-4000-a000-000000000001', 'Test tag one', '#123456'),
  ('f5300000-0000-4000-a000-000000000002', 'f2000000-0000-4000-a000-000000000002', 'Test tag two', '#654321');

insert into public.transaction_tags (transaction_id, tag_id)
values
  ('f5000000-0000-4000-a000-000000000001', 'f5300000-0000-4000-a000-000000000001'),
  ('f5000000-0000-4000-a000-000000000002', 'f5300000-0000-4000-a000-000000000001'),
  ('f5000000-0000-4000-a000-000000000003', 'f5300000-0000-4000-a000-000000000001'),
  ('f5000000-0000-4000-a000-000000000004', 'f5300000-0000-4000-a000-000000000002');

insert into public.transaction_items (id, transaction_id, category_id, name, quantity, unit_price)
values
  ('f5400000-0000-4000-a000-000000000001', 'f5000000-0000-4000-a000-000000000001', 'f3000000-0000-4000-a000-000000000001', 'Shared item', 1, 10),
  ('f5400000-0000-4000-a000-000000000002', 'f5000000-0000-4000-a000-000000000002', 'f3000000-0000-4000-a000-000000000001', 'Owner item', 1, 10),
  ('f5400000-0000-4000-a000-000000000003', 'f5000000-0000-4000-a000-000000000003', 'f3000000-0000-4000-a000-000000000001', 'Member item', 1, 10),
  ('f5400000-0000-4000-a000-000000000004', 'f5000000-0000-4000-a000-000000000004', 'f3000000-0000-4000-a000-000000000002', 'Other item', 1, 10);

insert into public.recurring_rules
  (id, household_id, owner_id, visibility, account_id, category_id, name, amount, currency, cadence, next_due_on)
values
  ('f6000000-0000-4000-a000-000000000001', 'f2000000-0000-4000-a000-000000000001', 'f1000000-0000-4000-a000-000000000001', 'shared',  'f4000000-0000-4000-a000-000000000001', 'f3000000-0000-4000-a000-000000000001', 'Shared recurring', 10, 'COP', 'monthly', current_date + 10),
  ('f6000000-0000-4000-a000-000000000002', 'f2000000-0000-4000-a000-000000000001', 'f1000000-0000-4000-a000-000000000001', 'private', 'f4000000-0000-4000-a000-000000000002', 'f3000000-0000-4000-a000-000000000001', 'Owner recurring', 10, 'COP', 'monthly', current_date + 10),
  ('f6000000-0000-4000-a000-000000000003', 'f2000000-0000-4000-a000-000000000001', 'f1000000-0000-4000-a000-000000000002', 'private', 'f4000000-0000-4000-a000-000000000003', 'f3000000-0000-4000-a000-000000000001', 'Member recurring', 10, 'COP', 'monthly', current_date + 10),
  ('f6000000-0000-4000-a000-000000000004', 'f2000000-0000-4000-a000-000000000002', 'f1000000-0000-4000-a000-000000000003', 'shared',  'f4000000-0000-4000-a000-000000000004', 'f3000000-0000-4000-a000-000000000002', 'Other recurring', 10, 'COP', 'monthly', current_date + 10);

insert into public.recurring_occurrences (id, rule_id, due_on, amount)
values
  ('f6100000-0000-4000-a000-000000000001', 'f6000000-0000-4000-a000-000000000001', current_date + 10, 10),
  ('f6100000-0000-4000-a000-000000000002', 'f6000000-0000-4000-a000-000000000002', current_date + 10, 10),
  ('f6100000-0000-4000-a000-000000000003', 'f6000000-0000-4000-a000-000000000003', current_date + 10, 10),
  ('f6100000-0000-4000-a000-000000000004', 'f6000000-0000-4000-a000-000000000004', current_date + 10, 10);

insert into public.goals (id, household_id, owner_id, visibility, name, target_amount, current_amount, currency)
values
  ('f6200000-0000-4000-a000-000000000001', 'f2000000-0000-4000-a000-000000000001', 'f1000000-0000-4000-a000-000000000001', 'shared',  'Shared goal', 100, 10, 'COP'),
  ('f6200000-0000-4000-a000-000000000002', 'f2000000-0000-4000-a000-000000000001', 'f1000000-0000-4000-a000-000000000001', 'private', 'Owner goal', 100, 10, 'COP'),
  ('f6200000-0000-4000-a000-000000000003', 'f2000000-0000-4000-a000-000000000001', 'f1000000-0000-4000-a000-000000000002', 'private', 'Member goal', 100, 10, 'COP'),
  ('f6200000-0000-4000-a000-000000000004', 'f2000000-0000-4000-a000-000000000002', 'f1000000-0000-4000-a000-000000000003', 'shared',  'Other goal', 100, 10, 'COP');

insert into public.goal_allocations (id, goal_id, amount, allocated_on)
values
  ('f6300000-0000-4000-a000-000000000001', 'f6200000-0000-4000-a000-000000000001', 10, current_date),
  ('f6300000-0000-4000-a000-000000000002', 'f6200000-0000-4000-a000-000000000002', 10, current_date),
  ('f6300000-0000-4000-a000-000000000003', 'f6200000-0000-4000-a000-000000000003', 10, current_date),
  ('f6300000-0000-4000-a000-000000000004', 'f6200000-0000-4000-a000-000000000004', 10, current_date);

insert into public.debts (id, household_id, owner_id, visibility, account_id, creditor, balance, currency, direction)
values
  ('f6400000-0000-4000-a000-000000000001', 'f2000000-0000-4000-a000-000000000001', 'f1000000-0000-4000-a000-000000000001', 'shared',  'f4000000-0000-4000-a000-000000000001', 'Shared debt', 100, 'COP', 'payable'),
  ('f6400000-0000-4000-a000-000000000002', 'f2000000-0000-4000-a000-000000000001', 'f1000000-0000-4000-a000-000000000001', 'private', 'f4000000-0000-4000-a000-000000000002', 'Owner debt', 100, 'COP', 'payable'),
  ('f6400000-0000-4000-a000-000000000003', 'f2000000-0000-4000-a000-000000000001', 'f1000000-0000-4000-a000-000000000002', 'private', 'f4000000-0000-4000-a000-000000000003', 'Member debt', 100, 'COP', 'payable'),
  ('f6400000-0000-4000-a000-000000000004', 'f2000000-0000-4000-a000-000000000002', 'f1000000-0000-4000-a000-000000000003', 'shared',  'f4000000-0000-4000-a000-000000000004', 'Other debt', 100, 'COP', 'payable');

insert into public.debt_payments (id, debt_id, amount, paid_on)
values
  ('f6500000-0000-4000-a000-000000000001', 'f6400000-0000-4000-a000-000000000001', 10, current_date),
  ('f6500000-0000-4000-a000-000000000002', 'f6400000-0000-4000-a000-000000000002', 10, current_date),
  ('f6500000-0000-4000-a000-000000000003', 'f6400000-0000-4000-a000-000000000003', 10, current_date),
  ('f6500000-0000-4000-a000-000000000004', 'f6400000-0000-4000-a000-000000000004', 10, current_date);

insert into public.budgets (id, household_id, owner_id, visibility, category_id, month, amount, currency)
values
  ('f6600000-0000-4000-a000-000000000001', 'f2000000-0000-4000-a000-000000000001', 'f1000000-0000-4000-a000-000000000001', 'shared',  'f3000000-0000-4000-a000-000000000001', date_trunc('month', current_date)::date, 100, 'COP'),
  ('f6600000-0000-4000-a000-000000000002', 'f2000000-0000-4000-a000-000000000001', 'f1000000-0000-4000-a000-000000000001', 'private', 'f3000000-0000-4000-a000-000000000001', (date_trunc('month', current_date) - interval '1 month')::date, 100, 'COP'),
  ('f6600000-0000-4000-a000-000000000003', 'f2000000-0000-4000-a000-000000000001', 'f1000000-0000-4000-a000-000000000002', 'private', 'f3000000-0000-4000-a000-000000000001', (date_trunc('month', current_date) - interval '2 months')::date, 100, 'COP'),
  ('f6600000-0000-4000-a000-000000000004', 'f2000000-0000-4000-a000-000000000002', 'f1000000-0000-4000-a000-000000000003', 'shared',  'f3000000-0000-4000-a000-000000000002', date_trunc('month', current_date)::date, 100, 'COP');

insert into public.budget_envelopes (id, budget_id, name, allocated_amount)
values
  ('f6700000-0000-4000-a000-000000000001', 'f6600000-0000-4000-a000-000000000001', 'Shared envelope', 10),
  ('f6700000-0000-4000-a000-000000000002', 'f6600000-0000-4000-a000-000000000002', 'Owner envelope', 10),
  ('f6700000-0000-4000-a000-000000000003', 'f6600000-0000-4000-a000-000000000003', 'Member envelope', 10),
  ('f6700000-0000-4000-a000-000000000004', 'f6600000-0000-4000-a000-000000000004', 'Other envelope', 10);

insert into public.category_templates (id, household_id, owner_id, visibility, name, category_id)
values
  ('f7000000-0000-4000-a000-000000000001', 'f2000000-0000-4000-a000-000000000001', 'f1000000-0000-4000-a000-000000000001', 'shared',  'Shared template', 'f3000000-0000-4000-a000-000000000001'),
  ('f7000000-0000-4000-a000-000000000002', 'f2000000-0000-4000-a000-000000000001', 'f1000000-0000-4000-a000-000000000001', 'private', 'Owner template', 'f3000000-0000-4000-a000-000000000001'),
  ('f7000000-0000-4000-a000-000000000003', 'f2000000-0000-4000-a000-000000000001', 'f1000000-0000-4000-a000-000000000002', 'private', 'Member template', 'f3000000-0000-4000-a000-000000000001'),
  ('f7000000-0000-4000-a000-000000000004', 'f2000000-0000-4000-a000-000000000002', 'f1000000-0000-4000-a000-000000000003', 'shared',  'Other template', 'f3000000-0000-4000-a000-000000000002');

insert into public.template_fields (id, template_id, key, label, field_type, sort_order)
values
  ('f7100000-0000-4000-a000-000000000001', 'f7000000-0000-4000-a000-000000000001', 'shared_field', 'Shared field', 'text', 0),
  ('f7100000-0000-4000-a000-000000000002', 'f7000000-0000-4000-a000-000000000002', 'owner_field', 'Owner field', 'text', 0),
  ('f7100000-0000-4000-a000-000000000003', 'f7000000-0000-4000-a000-000000000003', 'member_field', 'Member field', 'text', 0),
  ('f7100000-0000-4000-a000-000000000004', 'f7000000-0000-4000-a000-000000000004', 'other_field', 'Other field', 'text', 0);

insert into public.shopping_lists (id, household_id, owner_id, visibility, name, currency)
values
  ('f7200000-0000-4000-a000-000000000001', 'f2000000-0000-4000-a000-000000000001', 'f1000000-0000-4000-a000-000000000001', 'shared',  'Shared list', 'COP'),
  ('f7200000-0000-4000-a000-000000000002', 'f2000000-0000-4000-a000-000000000001', 'f1000000-0000-4000-a000-000000000001', 'private', 'Owner list', 'COP'),
  ('f7200000-0000-4000-a000-000000000003', 'f2000000-0000-4000-a000-000000000001', 'f1000000-0000-4000-a000-000000000002', 'private', 'Member list', 'COP'),
  ('f7200000-0000-4000-a000-000000000004', 'f2000000-0000-4000-a000-000000000002', 'f1000000-0000-4000-a000-000000000003', 'shared',  'Other list', 'COP');

insert into public.shopping_items (id, list_id, category_id, name, estimated_price)
values
  ('f7300000-0000-4000-a000-000000000001', 'f7200000-0000-4000-a000-000000000001', 'f3000000-0000-4000-a000-000000000001', 'Shared shopping item', 10),
  ('f7300000-0000-4000-a000-000000000002', 'f7200000-0000-4000-a000-000000000002', 'f3000000-0000-4000-a000-000000000001', 'Owner shopping item', 10),
  ('f7300000-0000-4000-a000-000000000003', 'f7200000-0000-4000-a000-000000000003', 'f3000000-0000-4000-a000-000000000001', 'Member shopping item', 10),
  ('f7300000-0000-4000-a000-000000000004', 'f7200000-0000-4000-a000-000000000004', 'f3000000-0000-4000-a000-000000000002', 'Other shopping item', 10);

insert into public.receipts
  (id, household_id, owner_id, visibility, transaction_id, storage_path, mime_type, size_bytes, original_filename)
values
  ('f7400000-0000-4000-a000-000000000001', 'f2000000-0000-4000-a000-000000000001', 'f1000000-0000-4000-a000-000000000001', 'shared',  'f5000000-0000-4000-a000-000000000001', 'tests/shared-receipt.pdf', 'application/pdf', 100, 'shared.pdf'),
  ('f7400000-0000-4000-a000-000000000002', 'f2000000-0000-4000-a000-000000000001', 'f1000000-0000-4000-a000-000000000001', 'private', 'f5000000-0000-4000-a000-000000000002', 'tests/owner-receipt.pdf', 'application/pdf', 100, 'owner.pdf'),
  ('f7400000-0000-4000-a000-000000000003', 'f2000000-0000-4000-a000-000000000001', 'f1000000-0000-4000-a000-000000000002', 'private', 'f5000000-0000-4000-a000-000000000003', 'tests/member-receipt.pdf', 'application/pdf', 100, 'member.pdf'),
  ('f7400000-0000-4000-a000-000000000004', 'f2000000-0000-4000-a000-000000000002', 'f1000000-0000-4000-a000-000000000003', 'shared',  'f5000000-0000-4000-a000-000000000004', 'tests/other-receipt.pdf', 'application/pdf', 100, 'other.pdf');

insert into public.audit_events (household_id, actor_id, owner_id, visibility, entity_type, entity_id, action)
values
  ('f2000000-0000-4000-a000-000000000001', 'f1000000-0000-4000-a000-000000000001', 'f1000000-0000-4000-a000-000000000001', 'shared',  'test', 'f5000000-0000-4000-a000-000000000001', 'shared_test'),
  ('f2000000-0000-4000-a000-000000000001', 'f1000000-0000-4000-a000-000000000001', 'f1000000-0000-4000-a000-000000000001', 'private', 'test', 'f5000000-0000-4000-a000-000000000002', 'owner_test'),
  ('f2000000-0000-4000-a000-000000000001', 'f1000000-0000-4000-a000-000000000002', 'f1000000-0000-4000-a000-000000000002', 'private', 'test', 'f5000000-0000-4000-a000-000000000003', 'member_test'),
  ('f2000000-0000-4000-a000-000000000002', 'f1000000-0000-4000-a000-000000000003', 'f1000000-0000-4000-a000-000000000003', 'shared',  'test', 'f5000000-0000-4000-a000-000000000004', 'other_test');

insert into public.reconciliations
  (id, account_id, household_id, owner_id, statement_ending_balance, statement_ending_on, period_start, ledger_balance, discrepancy, status, matched_entry_count)
values
  ('f7500000-0000-4000-a000-000000000001', 'f4000000-0000-4000-a000-000000000002', 'f2000000-0000-4000-a000-000000000001', 'f1000000-0000-4000-a000-000000000001', 990, current_date, current_date, 990, 0, 'balanced', 1),
  ('f7500000-0000-4000-a000-000000000002', 'f4000000-0000-4000-a000-000000000003', 'f2000000-0000-4000-a000-000000000001', 'f1000000-0000-4000-a000-000000000002', 990, current_date, current_date, 990, 0, 'balanced', 1),
  ('f7500000-0000-4000-a000-000000000003', 'f4000000-0000-4000-a000-000000000004', 'f2000000-0000-4000-a000-000000000002', 'f1000000-0000-4000-a000-000000000003', 990, current_date, current_date, 990, 0, 'balanced', 1);

insert into public.reconciliation_entries (reconciliation_id, ledger_entry_id)
values
  ('f7500000-0000-4000-a000-000000000001', 'f5100000-0000-4000-a000-000000000002'),
  ('f7500000-0000-4000-a000-000000000002', 'f5100000-0000-4000-a000-000000000003'),
  ('f7500000-0000-4000-a000-000000000003', 'f5100000-0000-4000-a000-000000000004');

insert into public.household_invitations (id, household_id, invited_by, email)
values
  ('f7600000-0000-4000-a000-000000000001', 'f2000000-0000-4000-a000-000000000001', 'f1000000-0000-4000-a000-000000000001', 'invite-one@laundry.test'),
  ('f7600000-0000-4000-a000-000000000002', 'f2000000-0000-4000-a000-000000000002', 'f1000000-0000-4000-a000-000000000003', 'invite-two@laundry.test');

insert into public.transaction_drafts
  (id, household_id, owner_id, account_id, category_id, kind, amount, currency, occurred_on, visibility)
values
  ('f7700000-0000-4000-a000-000000000001', 'f2000000-0000-4000-a000-000000000001', 'f1000000-0000-4000-a000-000000000001', 'f4000000-0000-4000-a000-000000000002', 'f3000000-0000-4000-a000-000000000001', 'expense', 10, 'COP', current_date, 'private'),
  ('f7700000-0000-4000-a000-000000000002', 'f2000000-0000-4000-a000-000000000001', 'f1000000-0000-4000-a000-000000000002', 'f4000000-0000-4000-a000-000000000003', 'f3000000-0000-4000-a000-000000000001', 'expense', 10, 'COP', current_date, 'private'),
  ('f7700000-0000-4000-a000-000000000003', 'f2000000-0000-4000-a000-000000000002', 'f1000000-0000-4000-a000-000000000003', 'f4000000-0000-4000-a000-000000000004', 'f3000000-0000-4000-a000-000000000002', 'expense', 10, 'COP', current_date, 'shared');

insert into public.daily_exchange_rates (valuation_date, currency, cop_per_unit, source, source_observed_on)
values (date '1900-01-01', 'COP', 1, 'identity', date '1900-01-01')
on conflict (valuation_date, currency) do update set cop_per_unit = excluded.cop_per_unit;

create temporary table rls_test_results (
  identity_name text not null,
  entity_name text not null,
  visible_count bigint not null,
  primary key (identity_name, entity_name)
) on commit drop;
grant select, insert, update on pg_temp.rls_test_results to anon, authenticated;

select set_config('request.jwt.claims', '{"sub":"f1000000-0000-4000-a000-000000000001","role":"authenticated"}', true);
set local role authenticated;
insert into pg_temp.rls_test_results
select 'owner', entity_name, visible_count
from (
  values
    ('accounts', (select count(*) from public.accounts where id::text like 'f4%')),
    ('audit_events', (select count(*) from public.audit_events where entity_type = 'test')),
    ('budget_envelopes', (select count(*) from public.budget_envelopes where id::text like 'f67%')),
    ('budgets', (select count(*) from public.budgets where id::text like 'f66%')),
    ('card_settings', (select count(*) from public.card_settings where account_id::text like 'f4%')),
    ('card_statements', (select count(*) from public.card_statements where id::text like 'f41%')),
    ('categories', (select count(*) from public.categories where id::text like 'f3%')),
    ('category_templates', (select count(*) from public.category_templates where id::text like 'f70%')),
    ('daily_exchange_rates', (select count(*) from public.daily_exchange_rates where valuation_date = date '1900-01-01')),
    ('debt_payments', (select count(*) from public.debt_payments where id::text like 'f65%')),
    ('debts', (select count(*) from public.debts where id::text like 'f64%')),
    ('goal_allocations', (select count(*) from public.goal_allocations where id::text like 'f63%')),
    ('goals', (select count(*) from public.goals where id::text like 'f62%')),
    ('household_invitations', (select count(*) from public.household_invitations where id::text like 'f76%')),
    ('household_members', (select count(*) from public.household_members where household_id::text like 'f2%')),
    ('households', (select count(*) from public.households where id::text like 'f2%')),
    ('ledger_entries', (select count(*) from public.ledger_entries where id::text like 'f51%')),
    ('payees', (select count(*) from public.payees where id::text like 'f52%')),
    ('profiles', (select count(*) from public.profiles where id::text like 'f1%')),
    ('receipts', (select count(*) from public.receipts where id::text like 'f74%')),
    ('reconciliation_entries', (select count(*) from public.reconciliation_entries where reconciliation_id::text like 'f75%')),
    ('reconciliations', (select count(*) from public.reconciliations where id::text like 'f75%')),
    ('recurring_occurrences', (select count(*) from public.recurring_occurrences where id::text like 'f61%')),
    ('recurring_rules', (select count(*) from public.recurring_rules where id::text like 'f60%')),
    ('shopping_items', (select count(*) from public.shopping_items where id::text like 'f73%')),
    ('shopping_lists', (select count(*) from public.shopping_lists where id::text like 'f72%')),
    ('tags', (select count(*) from public.tags where id::text like 'f53%')),
    ('template_fields', (select count(*) from public.template_fields where id::text like 'f71%')),
    ('transaction_drafts', (select count(*) from public.transaction_drafts where id::text like 'f77%')),
    ('transaction_items', (select count(*) from public.transaction_items where id::text like 'f54%')),
    ('transaction_tags', (select count(*) from public.transaction_tags where transaction_id::text like 'f5%')),
    ('transactions', (select count(*) from public.transactions where id::text like 'f5%'))
) counts(entity_name, visible_count);

with changed as (
  update public.households set name = 'Owner-authorized update'
  where id = 'f2000000-0000-4000-a000-000000000001'
  returning 1
)
insert into pg_temp.rls_test_results
select 'owner', 'household_update', count(*) from changed;
reset role;

select set_config('request.jwt.claims', '{"sub":"f1000000-0000-4000-a000-000000000002","role":"authenticated"}', true);
set local role authenticated;
insert into pg_temp.rls_test_results
select 'member', entity_name, visible_count
from (
  values
    ('accounts', (select count(*) from public.accounts where id::text like 'f4%')),
    ('audit_events', (select count(*) from public.audit_events where entity_type = 'test')),
    ('budget_envelopes', (select count(*) from public.budget_envelopes where id::text like 'f67%')),
    ('budgets', (select count(*) from public.budgets where id::text like 'f66%')),
    ('card_settings', (select count(*) from public.card_settings where account_id::text like 'f4%')),
    ('card_statements', (select count(*) from public.card_statements where id::text like 'f41%')),
    ('categories', (select count(*) from public.categories where id::text like 'f3%')),
    ('category_templates', (select count(*) from public.category_templates where id::text like 'f70%')),
    ('daily_exchange_rates', (select count(*) from public.daily_exchange_rates where valuation_date = date '1900-01-01')),
    ('debt_payments', (select count(*) from public.debt_payments where id::text like 'f65%')),
    ('debts', (select count(*) from public.debts where id::text like 'f64%')),
    ('goal_allocations', (select count(*) from public.goal_allocations where id::text like 'f63%')),
    ('goals', (select count(*) from public.goals where id::text like 'f62%')),
    ('household_invitations', (select count(*) from public.household_invitations where id::text like 'f76%')),
    ('household_members', (select count(*) from public.household_members where household_id::text like 'f2%')),
    ('households', (select count(*) from public.households where id::text like 'f2%')),
    ('ledger_entries', (select count(*) from public.ledger_entries where id::text like 'f51%')),
    ('payees', (select count(*) from public.payees where id::text like 'f52%')),
    ('profiles', (select count(*) from public.profiles where id::text like 'f1%')),
    ('receipts', (select count(*) from public.receipts where id::text like 'f74%')),
    ('reconciliation_entries', (select count(*) from public.reconciliation_entries where reconciliation_id::text like 'f75%')),
    ('reconciliations', (select count(*) from public.reconciliations where id::text like 'f75%')),
    ('recurring_occurrences', (select count(*) from public.recurring_occurrences where id::text like 'f61%')),
    ('recurring_rules', (select count(*) from public.recurring_rules where id::text like 'f60%')),
    ('shopping_items', (select count(*) from public.shopping_items where id::text like 'f73%')),
    ('shopping_lists', (select count(*) from public.shopping_lists where id::text like 'f72%')),
    ('tags', (select count(*) from public.tags where id::text like 'f53%')),
    ('template_fields', (select count(*) from public.template_fields where id::text like 'f71%')),
    ('transaction_drafts', (select count(*) from public.transaction_drafts where id::text like 'f77%')),
    ('transaction_items', (select count(*) from public.transaction_items where id::text like 'f54%')),
    ('transaction_tags', (select count(*) from public.transaction_tags where transaction_id::text like 'f5%')),
    ('transactions', (select count(*) from public.transactions where id::text like 'f5%'))
) counts(entity_name, visible_count);

with changed as (
  update public.households set name = 'Member-forbidden update'
  where id = 'f2000000-0000-4000-a000-000000000001'
  returning 1
)
insert into pg_temp.rls_test_results
select 'member', 'household_update', count(*) from changed;

do $$
begin
  begin
    insert into public.shopping_lists
      (id, household_id, owner_id, visibility, name, currency)
    values
      ('f7200000-0000-4000-a000-000000000010', 'f2000000-0000-4000-a000-000000000001', 'f1000000-0000-4000-a000-000000000001', 'private', 'Forbidden owner list', 'COP');
    insert into pg_temp.rls_test_results values ('member', 'forbidden_private_insert', 0);
  exception when insufficient_privilege then
    insert into pg_temp.rls_test_results values ('member', 'forbidden_private_insert', 1);
  end;
end
$$;

insert into public.shopping_lists
  (id, household_id, owner_id, visibility, name, currency)
values
  ('f7200000-0000-4000-a000-000000000011', 'f2000000-0000-4000-a000-000000000001', 'f1000000-0000-4000-a000-000000000002', 'private', 'Allowed member list', 'COP');
insert into pg_temp.rls_test_results values ('member', 'own_private_insert', 1);
reset role;

select set_config('request.jwt.claims', '{"sub":"f1000000-0000-4000-a000-000000000003","role":"authenticated"}', true);
set local role authenticated;
insert into pg_temp.rls_test_results
select 'outsider', entity_name, visible_count
from (
  values
    ('accounts', (select count(*) from public.accounts where id::text like 'f4%')),
    ('audit_events', (select count(*) from public.audit_events where entity_type = 'test')),
    ('budget_envelopes', (select count(*) from public.budget_envelopes where id::text like 'f67%')),
    ('budgets', (select count(*) from public.budgets where id::text like 'f66%')),
    ('card_settings', (select count(*) from public.card_settings where account_id::text like 'f4%')),
    ('card_statements', (select count(*) from public.card_statements where id::text like 'f41%')),
    ('categories', (select count(*) from public.categories where id::text like 'f3%')),
    ('category_templates', (select count(*) from public.category_templates where id::text like 'f70%')),
    ('daily_exchange_rates', (select count(*) from public.daily_exchange_rates where valuation_date = date '1900-01-01')),
    ('debt_payments', (select count(*) from public.debt_payments where id::text like 'f65%')),
    ('debts', (select count(*) from public.debts where id::text like 'f64%')),
    ('goal_allocations', (select count(*) from public.goal_allocations where id::text like 'f63%')),
    ('goals', (select count(*) from public.goals where id::text like 'f62%')),
    ('household_invitations', (select count(*) from public.household_invitations where id::text like 'f76%')),
    ('household_members', (select count(*) from public.household_members where household_id::text like 'f2%')),
    ('households', (select count(*) from public.households where id::text like 'f2%')),
    ('ledger_entries', (select count(*) from public.ledger_entries where id::text like 'f51%')),
    ('payees', (select count(*) from public.payees where id::text like 'f52%')),
    ('profiles', (select count(*) from public.profiles where id::text like 'f1%')),
    ('receipts', (select count(*) from public.receipts where id::text like 'f74%')),
    ('reconciliation_entries', (select count(*) from public.reconciliation_entries where reconciliation_id::text like 'f75%')),
    ('reconciliations', (select count(*) from public.reconciliations where id::text like 'f75%')),
    ('recurring_occurrences', (select count(*) from public.recurring_occurrences where id::text like 'f61%')),
    ('recurring_rules', (select count(*) from public.recurring_rules where id::text like 'f60%')),
    ('shopping_items', (select count(*) from public.shopping_items where id::text like 'f73%')),
    ('shopping_lists', (select count(*) from public.shopping_lists where id::text like 'f72%')),
    ('tags', (select count(*) from public.tags where id::text like 'f53%')),
    ('template_fields', (select count(*) from public.template_fields where id::text like 'f71%')),
    ('transaction_drafts', (select count(*) from public.transaction_drafts where id::text like 'f77%')),
    ('transaction_items', (select count(*) from public.transaction_items where id::text like 'f54%')),
    ('transaction_tags', (select count(*) from public.transaction_tags where transaction_id::text like 'f5%')),
    ('transactions', (select count(*) from public.transactions where id::text like 'f5%'))
) counts(entity_name, visible_count);
reset role;

select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
insert into pg_temp.rls_test_results
select 'anonymous', entity_name, visible_count
from (
  values
    ('accounts', (select count(*) from public.accounts where id::text like 'f4%')),
    ('households', (select count(*) from public.households where id::text like 'f2%')),
    ('transactions', (select count(*) from public.transactions where id::text like 'f5%'))
) counts(entity_name, visible_count);
reset role;

set local role postgres;
set local search_path = extensions, public, pg_catalog;

select extensions.is(
  (select jsonb_object_agg(entity_name, visible_count) from pg_temp.rls_test_results where identity_name = 'owner' and entity_name <> 'household_update'),
  '{"accounts":4,"audit_events":2,"budget_envelopes":2,"budgets":2,"card_settings":2,"card_statements":2,"categories":1,"category_templates":2,"daily_exchange_rates":1,"debt_payments":2,"debts":2,"goal_allocations":2,"goals":2,"household_invitations":1,"household_members":2,"households":1,"ledger_entries":2,"payees":1,"profiles":1,"receipts":2,"reconciliation_entries":1,"reconciliations":1,"recurring_occurrences":2,"recurring_rules":2,"shopping_items":2,"shopping_lists":2,"tags":1,"template_fields":2,"transaction_drafts":1,"transaction_items":2,"transaction_tags":2,"transactions":2}'::jsonb,
  'owner sees shared records, their private records, and owner-only administration'
);

select extensions.is(
  (select jsonb_object_agg(entity_name, visible_count) from pg_temp.rls_test_results where identity_name = 'member' and entity_name not in ('household_update', 'forbidden_private_insert', 'own_private_insert')),
  '{"accounts":4,"audit_events":2,"budget_envelopes":2,"budgets":2,"card_settings":2,"card_statements":2,"categories":1,"category_templates":2,"daily_exchange_rates":1,"debt_payments":2,"debts":2,"goal_allocations":2,"goals":2,"household_invitations":0,"household_members":2,"households":1,"ledger_entries":2,"payees":1,"profiles":1,"receipts":2,"reconciliation_entries":1,"reconciliations":1,"recurring_occurrences":2,"recurring_rules":2,"shopping_items":2,"shopping_lists":2,"tags":1,"template_fields":2,"transaction_drafts":1,"transaction_items":2,"transaction_tags":2,"transactions":2}'::jsonb,
  'member sees shared records and only their own private records'
);

select extensions.is(
  (select jsonb_object_agg(entity_name, visible_count) from pg_temp.rls_test_results where identity_name = 'outsider'),
  '{"accounts":2,"audit_events":1,"budget_envelopes":1,"budgets":1,"card_settings":1,"card_statements":1,"categories":1,"category_templates":1,"daily_exchange_rates":1,"debt_payments":1,"debts":1,"goal_allocations":1,"goals":1,"household_invitations":1,"household_members":1,"households":1,"ledger_entries":1,"payees":1,"profiles":1,"receipts":1,"reconciliation_entries":1,"reconciliations":1,"recurring_occurrences":1,"recurring_rules":1,"shopping_items":1,"shopping_lists":1,"tags":1,"template_fields":1,"transaction_drafts":1,"transaction_items":1,"transaction_tags":1,"transactions":1}'::jsonb,
  'an unrelated household owner sees only the unrelated household fixture'
);

select extensions.is(
  (select jsonb_object_agg(entity_name, visible_count) from pg_temp.rls_test_results where identity_name = 'anonymous'),
  '{"accounts":0,"households":0,"transactions":0}'::jsonb,
  'anonymous clients see no finance rows'
);

select extensions.is(
  (select visible_count from pg_temp.rls_test_results where identity_name = 'owner' and entity_name = 'household_update'),
  1::bigint,
  'household owner can update household settings'
);

select extensions.is(
  (select visible_count from pg_temp.rls_test_results where identity_name = 'member' and entity_name = 'household_update'),
  0::bigint,
  'household member cannot update household settings'
);

select extensions.is(
  (select visible_count from pg_temp.rls_test_results where identity_name = 'member' and entity_name = 'forbidden_private_insert'),
  1::bigint,
  'member cannot forge a private shopping list owned by another user'
);

select extensions.is(
  (select visible_count from pg_temp.rls_test_results where identity_name = 'member' and entity_name = 'own_private_insert'),
  1::bigint,
  'member can create their own private shopping list'
);

select extensions.is(
  (select count(*) from public.shopping_lists where id = 'f7200000-0000-4000-a000-000000000010'),
  0::bigint,
  'forbidden RLS insert left no row behind'
);

select extensions.is(
  (select count(*) from public.shopping_lists where id = 'f7200000-0000-4000-a000-000000000011'),
  1::bigint,
  'authorized RLS insert exists only inside the rollback test transaction'
);

select * from extensions.finish();

rollback;
