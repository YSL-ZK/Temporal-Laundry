-- Dedicated expense workflows retain structured context on the immutable ledger
-- record. Only the server role can invoke this function; the actor and every
-- referenced finance record are re-authorized by post_organized_transaction.
create function public.post_category_workflow_transaction(
  actor_id uuid,
  target_household uuid,
  source_account uuid,
  target_category uuid,
  target_payee uuid,
  target_tags uuid[],
  transaction_amount numeric,
  transaction_currency char(3),
  transaction_rate numeric,
  transaction_date date,
  transaction_visibility public.visibility,
  transaction_payee text,
  transaction_note text,
  workflow_type text,
  workflow_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  posted_transaction_id uuid;
  normalized_workflow text := lower(trim(workflow_type));
  normalized_payload jsonb;
  participants jsonb := '[]'::jsonb;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception 'Server-only operation';
  end if;
  if normalized_workflow not in ('bills', 'transport', 'dining', 'health', 'travel')
    or jsonb_typeof(coalesce(workflow_payload, 'null'::jsonb)) <> 'object'
    or octet_length(workflow_payload::text) > 16384 then
    raise exception 'Invalid category workflow';
  end if;

  if normalized_workflow = 'bills' then
    if coalesce(length(trim(workflow_payload ->> 'provider')), 0) not between 1 and 120
      or coalesce(length(trim(workflow_payload ->> 'serviceReference')), 0) > 120
      or coalesce(length(trim(workflow_payload ->> 'billingPeriod')), 0) > 80
      or coalesce(workflow_payload ->> 'dueOn', '') !~ '^\d{4}-\d{2}-\d{2}$'
      or (workflow_payload ? 'recurringRuleId' and coalesce(workflow_payload ->> 'recurringRuleId', '') <> '' and not exists (
        select 1 from public.recurring_rules recurring_record
        where recurring_record.id = (workflow_payload ->> 'recurringRuleId')::uuid
          and recurring_record.household_id = target_household
          and (recurring_record.visibility = 'shared'::public.visibility or recurring_record.owner_id = actor_id)
      )) then raise exception 'Invalid bills workflow'; end if;
    normalized_payload := jsonb_strip_nulls(jsonb_build_object(
      'provider', trim(workflow_payload ->> 'provider'),
      'serviceReference', nullif(trim(workflow_payload ->> 'serviceReference'), ''),
      'billingPeriod', nullif(trim(workflow_payload ->> 'billingPeriod'), ''),
      'dueOn', workflow_payload ->> 'dueOn',
      'recurringRuleId', nullif(workflow_payload ->> 'recurringRuleId', '')
    ));
  elsif normalized_workflow = 'transport' then
    if coalesce(length(trim(workflow_payload ->> 'vehicleOrRoute')), 0) not between 1 and 120
      or coalesce(length(trim(workflow_payload ->> 'tripNotes')), 0) > 1000
      or coalesce((workflow_payload ->> 'distance')::numeric, 0) < 0
      or coalesce((workflow_payload ->> 'odometer')::numeric, 0) < 0
      or coalesce((workflow_payload ->> 'fuelQuantity')::numeric, 0) < 0
      or coalesce((workflow_payload ->> 'fare')::numeric, 0) < 0 then
      raise exception 'Invalid transport workflow';
    end if;
    normalized_payload := jsonb_strip_nulls(jsonb_build_object(
      'vehicleOrRoute', trim(workflow_payload ->> 'vehicleOrRoute'),
      'distance', case when nullif(workflow_payload ->> 'distance', '') is null then null else (workflow_payload ->> 'distance')::numeric end,
      'odometer', case when nullif(workflow_payload ->> 'odometer', '') is null then null else (workflow_payload ->> 'odometer')::numeric end,
      'fuelQuantity', case when nullif(workflow_payload ->> 'fuelQuantity', '') is null then null else (workflow_payload ->> 'fuelQuantity')::numeric end,
      'fare', case when nullif(workflow_payload ->> 'fare', '') is null then null else (workflow_payload ->> 'fare')::numeric end,
      'tripNotes', nullif(trim(workflow_payload ->> 'tripNotes'), '')
    ));
  elsif normalized_workflow = 'dining' then
    if coalesce(length(trim(workflow_payload ->> 'venue')), 0) not between 1 and 120
      or coalesce((workflow_payload ->> 'splitAmount')::numeric, 0) < 0
      or coalesce((workflow_payload ->> 'tip')::numeric, 0) < 0
      or coalesce((workflow_payload ->> 'tax')::numeric, 0) < 0
      or (workflow_payload ? 'participants' and jsonb_typeof(workflow_payload -> 'participants') <> 'array')
      or jsonb_array_length(coalesce(workflow_payload -> 'participants', '[]'::jsonb)) > 20
      or exists (
        select 1 from jsonb_array_elements(coalesce(workflow_payload -> 'participants', '[]'::jsonb)) participant
        where jsonb_typeof(participant) <> 'string' or length(trim(participant #>> '{}')) not between 1 and 80
      ) then raise exception 'Invalid dining workflow'; end if;
    select coalesce(jsonb_agg(trim(participant #>> '{}')), '[]'::jsonb) into participants
    from jsonb_array_elements(coalesce(workflow_payload -> 'participants', '[]'::jsonb)) participant;
    normalized_payload := jsonb_strip_nulls(jsonb_build_object(
      'venue', trim(workflow_payload ->> 'venue'),
      'participants', participants,
      'splitAmount', case when nullif(workflow_payload ->> 'splitAmount', '') is null then null else (workflow_payload ->> 'splitAmount')::numeric end,
      'tip', coalesce((workflow_payload ->> 'tip')::numeric, 0),
      'tax', coalesce((workflow_payload ->> 'tax')::numeric, 0)
    ));
  elsif normalized_workflow = 'health' then
    if coalesce(length(trim(workflow_payload ->> 'provider')), 0) not between 1 and 120
      or coalesce(length(trim(workflow_payload ->> 'service')), 0) not between 1 and 160
      or coalesce(length(trim(workflow_payload ->> 'patient')), 0) > 120
      or coalesce(length(trim(workflow_payload ->> 'claimReference')), 0) > 120
      or coalesce(workflow_payload ->> 'reimbursementStatus', 'not_applicable') not in ('not_applicable', 'pending', 'submitted', 'reimbursed', 'denied') then
      raise exception 'Invalid health workflow';
    end if;
    normalized_payload := jsonb_strip_nulls(jsonb_build_object(
      'provider', trim(workflow_payload ->> 'provider'),
      'service', trim(workflow_payload ->> 'service'),
      'patient', nullif(trim(workflow_payload ->> 'patient'), ''),
      'reimbursementStatus', coalesce(workflow_payload ->> 'reimbursementStatus', 'not_applicable'),
      'claimReference', nullif(trim(workflow_payload ->> 'claimReference'), '')
    ));
  else
    if coalesce(length(trim(workflow_payload ->> 'trip')), 0) not between 1 and 120
      or coalesce(length(trim(workflow_payload ->> 'reservationOrVendor')), 0) > 160
      or coalesce(workflow_payload ->> 'itineraryOn', '') !~ '^\d{4}-\d{2}-\d{2}$'
      or coalesce(workflow_payload ->> 'localCurrency', '') not in ('COP', 'USD', 'EUR')
      or coalesce((workflow_payload ->> 'tripBudget')::numeric, 0) < 0 then
      raise exception 'Invalid travel workflow';
    end if;
    normalized_payload := jsonb_strip_nulls(jsonb_build_object(
      'trip', trim(workflow_payload ->> 'trip'),
      'reservationOrVendor', nullif(trim(workflow_payload ->> 'reservationOrVendor'), ''),
      'itineraryOn', workflow_payload ->> 'itineraryOn',
      'localCurrency', workflow_payload ->> 'localCurrency',
      'tripBudget', case when nullif(workflow_payload ->> 'tripBudget', '') is null then null else (workflow_payload ->> 'tripBudget')::numeric end
    ));
  end if;

  posted_transaction_id := public.post_organized_transaction(
    actor_id, target_household, source_account, null, target_category,
    target_payee, coalesce(target_tags, '{}'::uuid[]),
    'expense'::public.transaction_kind, transaction_amount, transaction_currency,
    transaction_rate, transaction_date, transaction_visibility,
    transaction_payee, transaction_note, '[]'::jsonb
  );

  update public.transactions
  set metadata = jsonb_build_object(
    'categoryWorkflow', normalized_workflow,
    'workflowVersion', 1,
    'details', normalized_payload
  )
  where id = posted_transaction_id;

  insert into public.audit_events (
    household_id, actor_id, owner_id, visibility, entity_type, entity_id, action, data
  ) values (
    target_household, actor_id, actor_id, transaction_visibility,
    'transaction', posted_transaction_id, 'attach_category_workflow',
    jsonb_build_object('workflow', normalized_workflow, 'version', 1)
  );
  return posted_transaction_id;
end;
$$;

revoke all on function public.post_category_workflow_transaction(
  uuid, uuid, uuid, uuid, uuid, uuid[], numeric, char(3), numeric, date,
  public.visibility, text, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.post_category_workflow_transaction(
  uuid, uuid, uuid, uuid, uuid, uuid[], numeric, char(3), numeric, date,
  public.visibility, text, text, text, jsonb
) to service_role;
