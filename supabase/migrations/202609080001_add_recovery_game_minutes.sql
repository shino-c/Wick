alter table public.recovery_days
  add column if not exists game_minutes integer not null default 0;