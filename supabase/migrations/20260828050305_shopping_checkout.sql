-- Checkout is server-only so totals, list ownership, and ledger entries remain atomic.
create function public.checkout_shopping_list(
  actor_id uuid,
  target_list uuid,
  source_account uuid,
  target_category uuid,
  transaction_date date,
  transaction_visibility public.visibility,
  selected_items jsonb,
  list_discount numeric,
  list_shipping numeric,
  list_tip numeric,
  transaction_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  list_record public.shopping_lists;
  selected_item jsonb;
  item_record public.shopping_items;
  transaction_id uuid;
  selected_ids uuid[] := '{}';
  selected_category uuid;
  item_id uuid;
  item_quantity numeric;
  item_price numeric;
  item_discount numeric;
  item_tax_rate numeric;
  item_fixed_tax numeric;
  line_subtotal numeric;
  line_tax numeric;
  subtotal numeric := 0;
  tax_total numeric := 0;
  item_discount_total numeric := 0;
  applied_list_discount numeric;
  total numeric;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'Server-only operation';
  end if;
  if actor_id is null or transaction_date is null then
    raise exception 'Invalid checkout';
  end if;
  if jsonb_typeof(coalesce(selected_items, '[]'::jsonb)) <> 'array'
    or jsonb_array_length(coalesce(selected_items, '[]'::jsonb)) = 0
    or jsonb_array_length(coalesce(selected_items, '[]'::jsonb)) > 250 then
    raise exception 'Select between 1 and 250 items';
  end if;
  if coalesce((select count(*) from public.transactions
    where owner_id = actor_id and created_at > now() - interval '1 minute'), 0) >= 30 then
    raise exception 'Checkout limit reached. Try again shortly.';
  end if;

  select * into list_record from public.shopping_lists where id = target_list for update;
  if not found or not exists (
    select 1 from public.household_members
    where household_id = list_record.household_id and user_id = actor_id
  ) or (list_record.visibility = 'private'::public.visibility and list_record.owner_id <> actor_id) then
    raise exception 'Shopping list access denied';
  end if;
  if not exists (
    select 1 from public.accounts a
    where a.id = source_account and a.household_id = list_record.household_id
      and (a.visibility = 'shared'::public.visibility or a.owner_id = actor_id)
  ) then
    raise exception 'Payment account access denied';
  end if;
  if target_category is null or not exists (
    select 1 from public.categories
    where id = target_category and household_id = list_record.household_id and kind = 'expense'
  ) then
    raise exception 'An expense category is required';
  end if;
  if coalesce(list_discount, 0) < 0 or coalesce(list_shipping, 0) < 0 or coalesce(list_tip, 0) < 0 then
    raise exception 'Checkout adjustments cannot be negative';
  end if;
  if transaction_note is not null and length(trim(transaction_note)) > 2000 then
    raise exception 'Note must be 2000 characters or fewer';
  end if;

  for selected_item in select value from jsonb_array_elements(selected_items) loop
    if jsonb_typeof(selected_item) <> 'object' or coalesce(selected_item ->> 'id', '') = '' then
      raise exception 'Invalid selected item';
    end if;
    item_id := (selected_item ->> 'id')::uuid;
    if item_id = any(selected_ids) then raise exception 'An item can be checked out once'; end if;
    selected_ids := array_append(selected_ids, item_id);
    select * into item_record from public.shopping_items where id = item_id and list_id = target_list for update;
    if not found then raise exception 'Shopping item not found'; end if;

    item_quantity := coalesce((selected_item ->> 'quantity')::numeric, item_record.quantity);
    item_price := coalesce((selected_item ->> 'actualPrice')::numeric, item_record.actual_price, item_record.estimated_price);
    item_discount := coalesce((selected_item ->> 'discount')::numeric, 0);
    item_tax_rate := coalesce((selected_item ->> 'taxRate')::numeric, item_record.tax_rate, list_record.default_tax_rate);
    item_fixed_tax := nullif(selected_item ->> 'fixedTax', '')::numeric;
    selected_category := coalesce(nullif(selected_item ->> 'categoryId', '')::uuid, item_record.category_id, target_category);
    if item_quantity <= 0 or item_price < 0 or item_discount < 0 or item_tax_rate < 0 or item_tax_rate > 100
      or (item_fixed_tax is not null and item_fixed_tax < 0) then
      raise exception 'Invalid item pricing';
    end if;
    if not exists (
      select 1 from public.categories
      where id = selected_category and household_id = list_record.household_id and kind = 'expense'
    ) then raise exception 'Item category access denied'; end if;

    line_subtotal := round(item_quantity * item_price, 2);
    item_discount := least(item_discount, line_subtotal);
    line_tax := round(coalesce(item_fixed_tax, line_subtotal * item_tax_rate / 100), 2);
    subtotal := subtotal + line_subtotal;
    tax_total := tax_total + line_tax;
    item_discount_total := item_discount_total + item_discount;
  end loop;

  applied_list_discount := least(coalesce(list_discount, 0), greatest(0, subtotal - item_discount_total));
  total := round(greatest(0, subtotal - item_discount_total - applied_list_discount + tax_total + coalesce(list_shipping, 0) + coalesce(list_tip, 0)), 2);
  if total <= 0 then raise exception 'Checkout total must be greater than zero'; end if;

  insert into public.transactions (
    household_id, owner_id, visibility, account_id, category_id, kind, status,
    amount, currency, reporting_exchange_rate, occurred_on, payee, note, shopping_list_id, metadata
  ) values (
    list_record.household_id, actor_id, transaction_visibility, source_account, target_category, 'expense', 'posted',
    total, list_record.currency, 1, transaction_date, list_record.name, nullif(trim(transaction_note), ''), target_list,
    jsonb_build_object('shopping_checkout', true, 'subtotal', subtotal, 'item_discount', item_discount_total,
      'list_discount', applied_list_discount, 'tax', tax_total, 'shipping', coalesce(list_shipping, 0), 'tip', coalesce(list_tip, 0))
  ) returning id into transaction_id;
  insert into public.ledger_entries (transaction_id, account_id, amount)
  values (transaction_id, source_account, -total);

  for selected_item in select value from jsonb_array_elements(selected_items) loop
    item_id := (selected_item ->> 'id')::uuid;
    select * into item_record from public.shopping_items where id = item_id and list_id = target_list;
    item_quantity := coalesce((selected_item ->> 'quantity')::numeric, item_record.quantity);
    item_price := coalesce((selected_item ->> 'actualPrice')::numeric, item_record.actual_price, item_record.estimated_price);
    item_discount := least(coalesce((selected_item ->> 'discount')::numeric, 0), round(item_quantity * item_price, 2));
    item_tax_rate := coalesce((selected_item ->> 'taxRate')::numeric, item_record.tax_rate, list_record.default_tax_rate);
    item_fixed_tax := nullif(selected_item ->> 'fixedTax', '')::numeric;
    selected_category := coalesce(nullif(selected_item ->> 'categoryId', '')::uuid, item_record.category_id, target_category);
    line_tax := round(coalesce(item_fixed_tax, round(item_quantity * item_price, 2) * item_tax_rate / 100), 2);
    insert into public.transaction_items (transaction_id, category_id, name, quantity, unit_price, discount, tax, sort_order, metadata)
    values (transaction_id, selected_category, item_record.name, item_quantity, item_price, item_discount, line_tax,
      item_record.sort_order, jsonb_build_object('shopping_item_id', item_record.id, 'shopping_list_id', target_list));
  end loop;

  update public.shopping_lists
  set discount = applied_list_discount, shipping = coalesce(list_shipping, 0), tip = coalesce(list_tip, 0), status = 'open'
  where id = target_list;
  delete from public.shopping_items where list_id = target_list and id = any(selected_ids);
  return transaction_id;
end;
$$;

revoke all on function public.checkout_shopping_list(uuid, uuid, uuid, uuid, date, public.visibility, jsonb, numeric, numeric, numeric, text) from public, anon, authenticated;
grant execute on function public.checkout_shopping_list(uuid, uuid, uuid, uuid, date, public.visibility, jsonb, numeric, numeric, numeric, text) to service_role;
