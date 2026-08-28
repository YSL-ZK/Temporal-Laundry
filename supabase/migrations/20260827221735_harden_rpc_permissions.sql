-- Explicit role revocations prevent anonymous PostgREST RPC access to definer functions.
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.create_household(text, char(3), numeric) from public, anon;
revoke all on function public.create_household_invitation(uuid, text) from public, anon;
revoke all on function public.accept_household_invitation(uuid) from public, anon;
revoke all on function public.post_transaction(uuid, uuid, uuid, uuid, public.transaction_kind, numeric, char(3), numeric, date, public.visibility, text, text, jsonb) from public, anon;

grant execute on function public.create_household(text, char(3), numeric) to authenticated;
grant execute on function public.create_household_invitation(uuid, text) to authenticated;
grant execute on function public.accept_household_invitation(uuid) to authenticated;
grant execute on function public.post_transaction(uuid, uuid, uuid, uuid, public.transaction_kind, numeric, char(3), numeric, date, public.visibility, text, text, jsonb) to authenticated;

drop policy if exists "card settings follow account" on public.card_settings;
