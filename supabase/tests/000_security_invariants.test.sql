begin;

create extension if not exists pgtap with schema extensions;
set local role postgres;
set local search_path = extensions, public, pg_catalog;
select extensions.plan(12);

select extensions.is_empty(
  $$
    select c.relname
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and not c.relrowsecurity
    order by c.relname
  $$,
  'RLS is active on every public application table'
);

select extensions.is_empty(
  $$
    select format('%s.%s', schemaname, tablename)
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and ('anon' = any(roles) or 'public' = any(roles))
    order by tablename, policyname
  $$,
  'no public-table RLS policy authorizes anonymous clients'
);

select extensions.is_empty(
  $$
    with expected(table_name) as (
      values
        ('accounts'),
        ('ai_usage_events'),
        ('budget_rollovers'),
        ('card_settings'),
        ('card_statements'),
        ('category_templates'),
        ('daily_exchange_rates'),
        ('household_invitations'),
        ('ledger_entries'),
        ('receipts'),
        ('reconciliation_entries'),
        ('reconciliations'),
        ('template_fields'),
        ('transaction_drafts'),
        ('transaction_items'),
        ('transaction_tags'),
        ('transactions')
    )
    select expected.table_name
    from expected
    where to_regclass('public.' || expected.table_name) is null
    order by expected.table_name
  $$,
  'every immutable or server-managed table exists'
);

select extensions.is_empty(
  $$
    with protected(table_name) as (
      values
        ('accounts'),
        ('ai_usage_events'),
        ('budget_rollovers'),
        ('card_settings'),
        ('card_statements'),
        ('category_templates'),
        ('daily_exchange_rates'),
        ('household_invitations'),
        ('ledger_entries'),
        ('receipts'),
        ('reconciliation_entries'),
        ('reconciliations'),
        ('template_fields'),
        ('transaction_drafts'),
        ('transaction_items'),
        ('transaction_tags'),
        ('transactions')
    )
    select protected.table_name
    from protected
    join pg_catalog.pg_class c on c.oid = to_regclass('public.' || protected.table_name)
    where has_table_privilege('authenticated', c.oid, 'INSERT')
       or has_table_privilege('authenticated', c.oid, 'UPDATE')
       or has_table_privilege('authenticated', c.oid, 'DELETE')
    order by protected.table_name
  $$,
  'authenticated clients cannot mutate immutable or server-managed tables directly'
);

select extensions.is_empty(
  $$
    select c.relname
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and (
        has_table_privilege('authenticated', c.oid, 'SELECT')
        or has_table_privilege('authenticated', c.oid, 'INSERT')
        or has_table_privilege('authenticated', c.oid, 'UPDATE')
        or has_table_privilege('authenticated', c.oid, 'DELETE')
      )
      and not exists (
        select 1
        from pg_catalog.pg_policy policy
        where policy.polrelid = c.oid
          and (
            0 = any(policy.polroles)
            or (select oid from pg_catalog.pg_roles where rolname = 'authenticated') = any(policy.polroles)
          )
      )
    order by c.relname
  $$,
  'every authenticated-accessible public table has an applicable RLS policy'
);

select extensions.is_empty(
  $$
    select format('%s.%s', n.nspname, p.proname)
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and (
        has_function_privilege('anon', p.oid, 'EXECUTE')
        or has_function_privilege('authenticated', p.oid, 'EXECUTE')
      )
    order by p.proname
  $$,
  'public SECURITY DEFINER functions are unreachable from browser roles'
);

select extensions.is_empty(
  $$
    select format('%s.%s', n.nspname, p.proname)
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where p.prosecdef
      and n.nspname in ('public', 'private')
      and not exists (
        select 1
        from unnest(coalesce(p.proconfig, array[]::text[])) setting
        where setting like 'search_path=%'
      )
    order by n.nspname, p.proname
  $$,
  'every application SECURITY DEFINER function pins its search path'
);

select extensions.is_empty(
  $$
    with expected(function_name) as (
      values
        ('accept_household_invitation'),
        ('allocate_goal'),
        ('archive_finance_account'),
        ('archive_receipt'),
        ('checkout_shopping_list'),
        ('confirm_recurring_occurrence'),
        ('correct_owned_transaction'),
        ('create_account_reconciliation'),
        ('create_budget_envelope'),
        ('create_finance_account'),
        ('create_household'),
        ('create_household_invitation'),
        ('create_payee'),
        ('create_tag'),
        ('delete_category_template'),
        ('delete_transaction_draft'),
        ('finish_ai_request'),
        ('generate_recurring_occurrences'),
        ('post_category_workflow_transaction'),
        ('post_organized_transaction'),
        ('post_template_transaction'),
        ('post_transaction'),
        ('post_transaction_draft'),
        ('record_card_payment'),
        ('record_card_statement'),
        ('record_debt_payment'),
        ('register_receipt'),
        ('reserve_ai_request'),
        ('reserve_finance_export'),
        ('restore_receipt_after_storage_failure'),
        ('reverse_owned_transaction'),
        ('rollover_budget'),
        ('save_category_template'),
        ('save_transaction_draft'),
        ('skip_recurring_occurrence'),
        ('store_daily_exchange_rates'),
        ('update_finance_account'),
        ('void_owned_expense')
    )
    select expected.function_name
    from expected
    where not exists (
      select 1
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = expected.function_name
        and p.prosecdef
        and has_function_privilege('service_role', p.oid, 'EXECUTE')
        and not has_function_privilege('anon', p.oid, 'EXECUTE')
        and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
    )
    order by expected.function_name
  $$,
  'every privileged application RPC exists and is executable only by service_role'
);

select extensions.ok(
  exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'search_transaction_ids'
      and not p.prosecdef
      and has_function_privilege('authenticated', p.oid, 'EXECUTE')
      and not has_function_privilege('anon', p.oid, 'EXECUTE')
  ),
  'ledger search remains a SECURITY INVOKER authenticated RPC'
);

select extensions.ok(
  not has_schema_privilege('anon', 'private', 'USAGE'),
  'anonymous clients cannot use the private helper schema'
);

select extensions.ok(
  exists (
    select 1
    from storage.buckets
    where id = 'receipts'
      and public is false
      and file_size_limit = 10485760
      and allowed_mime_types @> array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']::text[]
  ),
  'receipt storage is private and bounded by MIME type and size'
);

select extensions.is_empty(
  $$
    select policyname
    from pg_catalog.pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
      and ('authenticated' = any(roles) or 'public' = any(roles))
  $$,
  'browser roles have no receipt object mutation policy'
);

select * from extensions.finish();

rollback;
