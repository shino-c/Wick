-- Apply this to existing Wick Supabase projects created before Recovery.
-- It is safe to run more than once.
create table if not exists public.recovery_days (
  user_id uuid not null references auth.users on delete cascade,
  recovery_date date not null,
  completed_plan_ids text[] not null default '{}',
  game_completed boolean not null default false,
  outdoor_completed boolean not null default false,
  recovery_event_id text,
  recovery_event_start timestamptz,
  recovery_pct integer not null default 0 check (recovery_pct between 0 and 100),
  updated_at timestamptz not null default now(),
  primary key (user_id, recovery_date)
);

alter table public.recovery_days enable row level security;

drop policy if exists "own recovery days" on public.recovery_days;
create policy "own recovery days" on public.recovery_days for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
