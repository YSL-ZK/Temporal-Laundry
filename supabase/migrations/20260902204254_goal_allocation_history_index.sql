-- Support RLS goal lookups and the bounded one-year forecasting query.
create index if not exists goal_allocations_goal_allocated_on_idx
  on public.goal_allocations (goal_id, allocated_on desc);

create index if not exists goal_allocations_allocated_on_idx
  on public.goal_allocations (allocated_on desc);
