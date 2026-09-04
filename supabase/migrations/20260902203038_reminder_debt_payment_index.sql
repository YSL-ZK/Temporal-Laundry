-- Keep RLS debt lookups and the bounded current-month reminder query indexed.
create index if not exists debt_payments_debt_paid_on_idx
  on public.debt_payments (debt_id, paid_on desc);

create index if not exists debt_payments_paid_on_idx
  on public.debt_payments (paid_on desc);
