alter table public.category_templates
  add column if not exists version integer not null default 1;

alter table public.category_templates
  add constraint category_templates_name_length check (length(trim(name)) between 1 and 100),
  add constraint category_templates_description_length check (description is null or length(description) <= 500),
  add constraint category_templates_icon_length check (icon is null or length(icon) <= 40),
  add constraint category_templates_version_positive check (version > 0);

alter table public.template_fields drop constraint if exists template_fields_field_type_check;
alter table public.template_fields add column if not exists key text;
update public.template_fields
set key = 'field_' || replace(left(id::text, 8), '-', '')
where key is null;
alter table public.template_fields alter column key set not null;
alter table public.template_fields
  add constraint template_fields_field_type_check check (field_type in ('text','number','currency','amount','date','checkbox','select','multiselect','list','formula')),
  add constraint template_fields_key_format check (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  add constraint template_fields_label_length check (length(trim(label)) between 1 and 80),
  add constraint template_fields_formula_length check (formula is null or length(formula) <= 300),
  add constraint template_fields_sort_order_range check (sort_order between 0 and 49),
  add constraint template_fields_amount_prefill_formula check (not amount_prefill or field_type = 'formula'),
  add constraint template_fields_template_key_unique unique (template_id, key);

create index if not exists category_templates_category_idx on public.category_templates (category_id);
create index if not exists template_fields_template_sort_idx on public.template_fields (template_id, sort_order);

drop policy if exists "scoped templates" on public.category_templates;
drop policy if exists "template fields visible" on public.template_fields;
create policy "read scoped templates" on public.category_templates
  for select to authenticated
  using (private.can_access(household_id, owner_id, visibility));
create policy "read accessible template fields" on public.template_fields
  for select to authenticated
  using (exists (
    select 1 from public.category_templates template_record
    where template_record.id = template_id
      and private.can_access(template_record.household_id, template_record.owner_id, template_record.visibility)
  ));

revoke insert, update, delete on public.category_templates, public.template_fields from anon, authenticated;

create function public.save_category_template(
  actor_id uuid,
  target_template uuid,
  target_household uuid,
  target_category uuid,
  template_visibility public.visibility,
  template_name text,
  template_icon text,
  template_description text,
  template_fields jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_template public.category_templates;
  field_record jsonb;
  field_index integer := 0;
  field_options jsonb;
  field_formula text;
  field_type text;
  amount_prefill_count integer := 0;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then raise exception 'Server-only operation'; end if;
  if actor_id is null or not exists (
    select 1 from public.household_members member_record
    where member_record.household_id = target_household and member_record.user_id = actor_id
  ) then raise exception 'Household access denied'; end if;
  if not exists (
    select 1 from public.categories category_record
    where category_record.id = target_category and category_record.household_id = target_household
  ) then raise exception 'Category access denied'; end if;
  if coalesce(length(trim(template_name)), 0) not between 1 and 100
    or coalesce(length(template_description), 0) > 500
    or coalesce(length(template_icon), 0) > 40
    or jsonb_typeof(coalesce(template_fields, 'null'::jsonb)) <> 'array'
    or jsonb_array_length(template_fields) not between 1 and 30
    or octet_length(template_fields::text) > 65536 then
    raise exception 'Invalid category template';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('category-template:' || actor_id::text, 0));
  if (select count(*) from public.audit_events audit_record
      where audit_record.actor_id = $1 and audit_record.action in ('create_category_template', 'update_category_template', 'delete_category_template')
        and audit_record.created_at > now() - interval '1 minute') >= 20 then
    raise exception 'Category template mutation limit reached';
  end if;

  if target_template is null then
    insert into public.category_templates (household_id, owner_id, visibility, name, category_id, icon, description, is_builtin)
    values (target_household, actor_id, template_visibility, trim(template_name), target_category, nullif(trim(template_icon), ''), nullif(trim(template_description), ''), false)
    returning * into saved_template;
  else
    select * into saved_template from public.category_templates template_record
    where template_record.id = target_template and template_record.household_id = target_household
      and not template_record.is_builtin
      and (template_record.visibility = 'shared'::public.visibility or template_record.owner_id = actor_id)
    for update;
    if not found then raise exception 'Category template access denied'; end if;
    update public.category_templates
    set category_id = target_category, visibility = template_visibility, name = trim(template_name),
      icon = nullif(trim(template_icon), ''), description = nullif(trim(template_description), ''), version = version + 1
    where id = saved_template.id
    returning * into saved_template;
    delete from public.template_fields where template_id = saved_template.id;
  end if;

  for field_record in select value from jsonb_array_elements(template_fields) loop
    field_type := field_record ->> 'type';
    field_options := coalesce(field_record -> 'options', '[]'::jsonb);
    field_formula := nullif(trim(field_record ->> 'formula'), '');
    if coalesce(field_record ->> 'key', '') !~ '^[a-z][a-z0-9_]{0,39}$'
      or coalesce(length(trim(field_record ->> 'label')), 0) not between 1 and 80
      or field_type not in ('text','number','currency','date','checkbox','select','multiselect','list','formula')
      or jsonb_typeof(field_options) <> 'array' or jsonb_array_length(field_options) > 30
      or exists (
        select 1 from jsonb_array_elements(field_options) option_value
        where jsonb_typeof(option_value) <> 'string' or length(trim(option_value #>> '{}')) not between 1 and 80
      )
      or (field_type in ('select','multiselect') and jsonb_array_length(field_options) = 0)
      or (field_type not in ('select','multiselect') and jsonb_array_length(field_options) <> 0)
      or (field_type = 'formula' and coalesce(length(field_formula), 0) not between 1 and 300)
      or (field_type <> 'formula' and field_formula is not null)
      or octet_length(coalesce(field_record -> 'defaultValue', 'null'::jsonb)::text) > 2048 then
      raise exception 'Invalid template field';
    end if;
    if coalesce((field_record ->> 'amountPrefill')::boolean, false) then amount_prefill_count := amount_prefill_count + 1; end if;
    insert into public.template_fields (
      template_id, key, label, field_type, required, options, formula, sort_order,
      default_value, formula_definition, amount_prefill
    ) values (
      saved_template.id, field_record ->> 'key', trim(field_record ->> 'label'), field_type,
      coalesce((field_record ->> 'required')::boolean, false), field_options, field_formula, field_index,
      field_record -> 'defaultValue',
      case when field_formula is null then null else jsonb_build_object('expression', field_formula) end,
      coalesce((field_record ->> 'amountPrefill')::boolean, false)
    );
    field_index := field_index + 1;
  end loop;
  if amount_prefill_count > 1 then raise exception 'Only one formula can prefill the amount'; end if;

  insert into public.audit_events (household_id, actor_id, owner_id, visibility, entity_type, entity_id, action, data)
  values (
    target_household, actor_id, saved_template.owner_id, saved_template.visibility,
    'category_template', saved_template.id,
    case when target_template is null then 'create_category_template' else 'update_category_template' end,
    jsonb_build_object('version', saved_template.version, 'field_count', field_index)
  );
  return saved_template.id;
end;
$$;

create function public.delete_category_template(actor_id uuid, target_template uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare template_record public.category_templates;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then raise exception 'Server-only operation'; end if;
  perform pg_advisory_xact_lock(hashtextextended('category-template:' || actor_id::text, 0));
  select * into template_record from public.category_templates existing_template
  where existing_template.id = target_template and not existing_template.is_builtin
    and (existing_template.visibility = 'shared'::public.visibility or existing_template.owner_id = actor_id)
    and exists (
      select 1 from public.household_members member_record
      where member_record.household_id = existing_template.household_id and member_record.user_id = actor_id
    )
  for update;
  if not found then raise exception 'Category template access denied'; end if;
  if (select count(*) from public.audit_events audit_record
      where audit_record.actor_id = $1 and audit_record.action in ('create_category_template', 'update_category_template', 'delete_category_template')
        and audit_record.created_at > now() - interval '1 minute') >= 20 then
    raise exception 'Category template mutation limit reached';
  end if;
  insert into public.audit_events (household_id, actor_id, owner_id, visibility, entity_type, entity_id, action, data)
  values (template_record.household_id, actor_id, template_record.owner_id, template_record.visibility, 'category_template', template_record.id, 'delete_category_template', jsonb_build_object('name', template_record.name, 'version', template_record.version));
  delete from public.category_templates where id = template_record.id;
  return template_record.id;
end;
$$;

create function public.post_template_transaction(
  actor_id uuid,
  target_template uuid,
  source_account uuid,
  target_payee uuid,
  target_tags uuid[],
  transaction_amount numeric,
  transaction_currency char(3),
  transaction_rate numeric,
  transaction_date date,
  transaction_visibility public.visibility,
  transaction_payee text,
  transaction_note text,
  template_values jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  template_record public.category_templates;
  field_record public.template_fields;
  field_value jsonb;
  normalized_values jsonb := '{}'::jsonb;
  field_snapshot jsonb;
  posted_transaction_id uuid;
  category_kind public.transaction_kind;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then raise exception 'Server-only operation'; end if;
  select * into template_record from public.category_templates existing_template
  where existing_template.id = target_template
    and exists (
      select 1 from public.household_members member_record
      where member_record.household_id = existing_template.household_id and member_record.user_id = actor_id
    )
    and (existing_template.visibility = 'shared'::public.visibility or existing_template.owner_id = actor_id);
  if not found or template_record.category_id is null then raise exception 'Category template access denied'; end if;
  if jsonb_typeof(coalesce(template_values, 'null'::jsonb)) <> 'object'
    or octet_length(template_values::text) > 65536
    or exists (
      select 1 from jsonb_object_keys(template_values) value_key
      where not exists (
        select 1 from public.template_fields known_field
        where known_field.template_id = template_record.id and known_field.key = value_key
      )
    ) then raise exception 'Invalid template values'; end if;

  for field_record in select * from public.template_fields where template_id = template_record.id order by sort_order loop
    field_value := template_values -> field_record.key;
    if field_record.required and field_record.field_type <> 'formula' and (
      field_value is null or field_value = 'null'::jsonb
      or (jsonb_typeof(field_value) = 'string' and length(trim(field_value #>> '{}')) = 0)
      or (jsonb_typeof(field_value) = 'array' and jsonb_array_length(field_value) = 0)
    ) then raise exception 'Required template value missing'; end if;
    if field_value is null or field_value = 'null'::jsonb then continue; end if;

    if field_record.field_type = 'text' and (jsonb_typeof(field_value) <> 'string' or length(field_value #>> '{}') > 1000) then raise exception 'Invalid text template value';
    elsif field_record.field_type = 'date' and (jsonb_typeof(field_value) <> 'string' or (field_value #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$') then raise exception 'Invalid date template value';
    elsif field_record.field_type = 'checkbox' and jsonb_typeof(field_value) <> 'boolean' then raise exception 'Invalid checkbox template value';
    elsif field_record.field_type in ('number','currency','amount','formula') and (jsonb_typeof(field_value) <> 'number' or abs((field_value #>> '{}')::numeric) > 999999999999) then raise exception 'Invalid numeric template value';
    elsif field_record.field_type = 'select' and (jsonb_typeof(field_value) <> 'string' or not field_record.options @> jsonb_build_array(field_value)) then raise exception 'Invalid select template value';
    elsif field_record.field_type = 'multiselect' and (
      jsonb_typeof(field_value) <> 'array' or jsonb_array_length(field_value) > 30
      or exists (select 1 from jsonb_array_elements(field_value) selected_value where jsonb_typeof(selected_value) <> 'string' or not field_record.options @> jsonb_build_array(selected_value))
    ) then raise exception 'Invalid multiselect template value';
    elsif field_record.field_type = 'list' and (
      jsonb_typeof(field_value) <> 'array' or jsonb_array_length(field_value) > 100
      or exists (select 1 from jsonb_array_elements(field_value) list_value where jsonb_typeof(list_value) <> 'string' or length(trim(list_value #>> '{}')) not between 1 and 160)
    ) then raise exception 'Invalid list template value'; end if;
    normalized_values := normalized_values || jsonb_build_object(field_record.key, field_value);
  end loop;

  select category_record.kind::public.transaction_kind into category_kind
  from public.categories category_record
  where category_record.id = template_record.category_id and category_record.household_id = template_record.household_id;
  if category_kind not in ('income'::public.transaction_kind, 'expense'::public.transaction_kind) then raise exception 'Category access denied'; end if;

  posted_transaction_id := public.post_organized_transaction(
    actor_id, template_record.household_id, source_account, null, template_record.category_id,
    target_payee, coalesce(target_tags, '{}'::uuid[]), category_kind,
    transaction_amount, transaction_currency, transaction_rate, transaction_date,
    transaction_visibility, transaction_payee, transaction_note, '[]'::jsonb
  );
  select coalesce(jsonb_agg(jsonb_build_object('key', snapshot_field.key, 'label', snapshot_field.label, 'type', snapshot_field.field_type) order by snapshot_field.sort_order), '[]'::jsonb)
  into field_snapshot from public.template_fields snapshot_field where snapshot_field.template_id = template_record.id;
  update public.transactions set metadata = jsonb_build_object(
    'customTemplate', template_record.id,
    'templateName', template_record.name,
    'templateVersion', template_record.version,
    'fields', field_snapshot,
    'values', normalized_values
  ) where id = posted_transaction_id;
  insert into public.audit_events (household_id, actor_id, owner_id, visibility, entity_type, entity_id, action, data)
  values (template_record.household_id, actor_id, actor_id, transaction_visibility, 'transaction', posted_transaction_id, 'post_template_transaction', jsonb_build_object('template_id', template_record.id, 'template_version', template_record.version));
  return posted_transaction_id;
end;
$$;

revoke all on function public.save_category_template(uuid,uuid,uuid,uuid,public.visibility,text,text,text,jsonb) from public, anon, authenticated;
revoke all on function public.delete_category_template(uuid,uuid) from public, anon, authenticated;
revoke all on function public.post_template_transaction(uuid,uuid,uuid,uuid,uuid[],numeric,char(3),numeric,date,public.visibility,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.save_category_template(uuid,uuid,uuid,uuid,public.visibility,text,text,text,jsonb) to service_role;
grant execute on function public.delete_category_template(uuid,uuid) to service_role;
grant execute on function public.post_template_transaction(uuid,uuid,uuid,uuid,uuid[],numeric,char(3),numeric,date,public.visibility,text,text,jsonb) to service_role;
