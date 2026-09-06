-- ============================================================================
-- Wick — schema for Pillars 2 (Desk Mode), 3 (Calibration), 6 (Circles)
--
-- Paste the whole file into the Supabase SQL editor and run it once.
-- Safe to re-run: everything is create-if-not-exists / create-or-replace.
--
-- Privacy posture encoded here, not just in the app:
--   • ppg_scans stores scalars only. Raw frames, waveforms and IBI lists never
--     leave the device, so there is no column for them.
--   • Every per-user table is RLS-locked to auth.uid().
--   • friendships can only be written by a SECURITY DEFINER function, so a
--     malicious client cannot forge a one-way "friendship" and start reading.
--   • get_circle_summary returns NULLs below MIN_CIRCLE_SIZE friends.
-- ============================================================================

-- ── Profiles ────────────────────────────────────────────────────────────────

create table if not exists profiles (
  id uuid primary key references auth.users on delete cascade,
  username text unique not null,
  invite_code text unique not null
    default 'WICK-' || upper(substr(md5(random()::text), 1, 4)),
  created_at timestamptz default now()
);

alter table profiles enable row level security;

drop policy if exists "profiles readable by authenticated" on profiles;
create policy "profiles readable by authenticated"
  on profiles for select using (auth.role() = 'authenticated');

drop policy if exists "users update own profile" on profiles;
create policy "users update own profile"
  on profiles for update using (auth.uid() = id);

-- Anonymous auth users have no metadata, so fall back to a readable handle.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data->>'username',
      'student_' || substr(new.id::text, 1, 6)
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();


-- ── Pillar 3: Calibration & Ground Truth ────────────────────────────────────

create table if not exists baselines (
  user_id uuid primary key references auth.users on delete cascade,
  rmssd_baseline double precision,
  scan_count int not null default 0,
  perceived_stress_baseline double precision,
  updated_at timestamptz default now()
);

alter table baselines enable row level security;
drop policy if exists "own baseline" on baselines;
create policy "own baseline" on baselines for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);


create table if not exists ppg_scans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  source text not null check (source in ('finger', 'face')),
  heart_rate double precision,
  hrv_rmssd double precision,
  stress_level text,
  deviation_pct double precision,
  signal_quality text not null check (signal_quality in ('good', 'poor')),
  created_at timestamptz default now()
);
-- Deliberately no columns for filtered_signal or ibi_list: those stay on-device.

create index if not exists ppg_scans_user_time on ppg_scans (user_id, created_at desc);

alter table ppg_scans enable row level security;
drop policy if exists "own scans" on ppg_scans;
create policy "own scans" on ppg_scans for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);


create table if not exists self_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  score double precision not null check (score >= 0 and score <= 100),
  raw_answers jsonb,
  created_at timestamptz default now()
);

create index if not exists self_reports_user_time on self_reports (user_id, created_at desc);

alter table self_reports enable row level security;
drop policy if exists "own self reports" on self_reports;
create policy "own self reports" on self_reports for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);


create table if not exists calibration_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  session_id uuid,
  scan_id uuid references ppg_scans on delete set null,
  verdict text not null check (verdict in ('spot_on', 'slightly_off', 'way_off')),
  created_at timestamptz default now()
);

create index if not exists calibration_feedback_user_time
  on calibration_feedback (user_id, created_at desc);

alter table calibration_feedback enable row level security;
drop policy if exists "own feedback" on calibration_feedback;
create policy "own feedback" on calibration_feedback for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);


-- ── Pillar 2: Desk Mode sessions ────────────────────────────────────────────

create table if not exists focus_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  planned_minutes int,
  actual_minutes int,
  breaks_taken int default 0,
  enforced_breaks int default 0,
  stress_delta_pct double precision,
  soundscape text,
  created_at timestamptz default now()
);

create index if not exists focus_sessions_user_time on focus_sessions (user_id, created_at desc);

alter table focus_sessions enable row level security;
drop policy if exists "own sessions" on focus_sessions;
create policy "own sessions" on focus_sessions for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);


-- ── Fused score (handoff point to Pillar 4) ─────────────────────────────────

create table if not exists stress_scores (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  fused_score double precision not null check (fused_score >= 0 and fused_score <= 100),
  confidence text check (confidence in ('Low', 'Medium', 'High')),
  signals_used int,
  biometric_score double precision,
  self_report_score double precision,
  load_score double precision,
  created_at timestamptz default now()
);

create index if not exists stress_scores_user_time on stress_scores (user_id, created_at desc);

alter table stress_scores enable row level security;
drop policy if exists "own stress scores" on stress_scores;
create policy "own stress scores" on stress_scores for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);


-- ── Pillar 6: Circles (flat friend list; no named circles in v1) ────────────

create table if not exists friend_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users on delete cascade,
  recipient_id uuid not null references auth.users on delete cascade,
  status text default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz default now(),
  unique (requester_id, recipient_id),
  check (requester_id <> recipient_id)
);

alter table friend_requests enable row level security;

drop policy if exists "see own requests" on friend_requests;
create policy "see own requests" on friend_requests for select
  using (auth.uid() = requester_id or auth.uid() = recipient_id);

drop policy if exists "send requests" on friend_requests;
create policy "send requests" on friend_requests for insert
  with check (auth.uid() = requester_id);

drop policy if exists "respond to requests" on friend_requests;
create policy "respond to requests" on friend_requests for update
  using (auth.uid() = recipient_id);


create table if not exists friendships (
  user_id uuid not null references auth.users on delete cascade,
  friend_id uuid not null references auth.users on delete cascade,
  created_at timestamptz default now(),
  primary key (user_id, friend_id)
);

alter table friendships enable row level security;

-- Read-only to clients. There is deliberately no insert/update/delete policy:
-- the only writer is accept_friend_request() below, which runs as definer.
drop policy if exists "see own friendships" on friendships;
create policy "see own friendships" on friendships for select
  using (auth.uid() = user_id);


create or replace function public.accept_friend_request(request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  req friend_requests%rowtype;
begin
  select * into req from friend_requests where id = request_id;
  if not found then
    raise exception 'Request not found';
  end if;
  if req.recipient_id <> auth.uid() then
    raise exception 'Not authorized to accept this request';
  end if;

  update friend_requests set status = 'accepted' where id = request_id;

  -- Symmetric, so neither side can end up able to read the other one-way.
  insert into friendships (user_id, friend_id)
    values (req.requester_id, req.recipient_id) on conflict do nothing;
  insert into friendships (user_id, friend_id)
    values (req.recipient_id, req.requester_id) on conflict do nothing;
end;
$$;


-- ── Circle aggregate ────────────────────────────────────────────────────────
--
-- The privacy decision, in code: below MIN_CIRCLE_SIZE friends the counts are
-- returned as NULL. With two friends, "1 of 2 in the red zone" plus one glance
-- at who looks tired is a re-identification. The copy in the app says
-- "anonymised signals only" rather than claiming differential privacy, because
-- suppression is what this actually implements and it is what we can defend.

create or replace function public.get_circle_summary(target_user_id uuid)
returns table (
  total_friends int,
  red_zone_count int,
  avg_capacity double precision
)
language plpgsql
security definer
set search_path = public
as $$
declare
  min_circle_size constant int := 3;
  n int;
begin
  if target_user_id <> auth.uid() then
    raise exception 'Not authorized';
  end if;

  select count(*) into n from friendships f where f.user_id = target_user_id;

  if n < min_circle_size then
    return query select n, null::int, null::double precision;
    return;
  end if;

  return query
  select
    n,
    count(*) filter (where latest.fused_score >= 60)::int,
    round(avg(latest.fused_score)::numeric, 1)::double precision
  from friendships f
  join lateral (
    select s.fused_score
    from stress_scores s
    where s.user_id = f.friend_id
    order by s.created_at desc
    limit 1
  ) latest on true
  where f.user_id = target_user_id;
end;
$$;


-- ── Shared recovery challenges ──────────────────────────────────────────────

create table if not exists challenges (
  id text primary key,
  title text not null,
  subtitle text not null,
  scheduled_for text,
  category text not null check (category in ('physical', 'social', 'mental')),
  notes text,
  -- Null for the three seeded challenges; set for anything a member creates.
  created_by uuid references auth.users on delete cascade,
  created_at timestamptz default now()
);

-- Idempotent upgrade for anyone who ran the earlier version of this file.
alter table challenges add column if not exists notes text;
alter table challenges add column if not exists created_by uuid references auth.users on delete cascade;
alter table challenges add column if not exists created_at timestamptz default now();

alter table challenges enable row level security;
-- Readable if it is a seeded challenge, yours, or created by someone in your
-- circle. A stranger's challenge is not your business.
drop policy if exists "challenges readable" on challenges;
create policy "challenges readable" on challenges for select
  using (
    created_by is null
    or created_by = auth.uid()
    or exists (
      select 1 from friendships f
      where f.user_id = auth.uid() and f.friend_id = challenges.created_by
    )
  );

insert into challenges (id, title, subtitle, scheduled_for, category) values
  ('walk-lakeside', 'Group Walk: Lakeside', 'Active recovery · 30 min', 'Tomorrow, 6:00 PM', 'physical'),
  ('tea-break', 'Screen-Free Tea Break', 'Mental downtime · 15 min', 'Today, 4:00 PM', 'mental'),
  ('reach-out', 'Reach Out to Someone', 'Social recovery · one message', null, 'social')
on conflict (id) do nothing;


create table if not exists challenge_participants (
  challenge_id text not null references challenges on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  joined_at timestamptz default now(),
  primary key (challenge_id, user_id)
);

alter table challenge_participants enable row level security;

-- A participant row is only visible to the person themselves; the join *counts*
-- other people see come from list_challenges(), which aggregates.
drop policy if exists "own participation" on challenge_participants;
create policy "own participation" on challenge_participants for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);


create or replace function public.list_challenges(target_user_id uuid)
returns table (
  id text,
  title text,
  subtitle text,
  scheduled_for text,
  category text,
  joined_count int,
  circle_size int,
  joined boolean,
  created_by uuid,
  created_by_me boolean,
  notes text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  if target_user_id <> auth.uid() then
    raise exception 'Not authorized';
  end if;

  select count(*) into n from friendships f where f.user_id = target_user_id;

  return query
  select
    c.id,
    c.title,
    c.subtitle,
    c.scheduled_for,
    c.category,
    (
      select count(*)::int
      from challenge_participants p
      where p.challenge_id = c.id
        and (
          p.user_id = target_user_id
          or exists (
            select 1 from friendships f
            where f.user_id = target_user_id and f.friend_id = p.user_id
          )
        )
    ),
    (n + 1),
    exists (
      select 1 from challenge_participants p
      where p.challenge_id = c.id and p.user_id = target_user_id
    ),
    c.created_by,
    (c.created_by = target_user_id),
    c.notes
  from challenges c
  where c.created_by is null
     or c.created_by = target_user_id
     or exists (
       select 1 from friendships f
       where f.user_id = target_user_id and f.friend_id = c.created_by
     )
  order by c.created_at desc nulls last, c.category;
end;
$$;


create or replace function public.toggle_challenge(challenge_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from challenge_participants p
    where p.challenge_id = toggle_challenge.challenge_id and p.user_id = auth.uid()
  ) then
    delete from challenge_participants p
    where p.challenge_id = toggle_challenge.challenge_id and p.user_id = auth.uid();
  else
    insert into challenge_participants (challenge_id, user_id)
    values (toggle_challenge.challenge_id, auth.uid());
  end if;
end;
$$;


create or replace function public.create_challenge(
  p_title text,
  p_subtitle text,
  p_scheduled_for text,
  p_category text,
  p_notes text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id text;
begin
  if coalesce(trim(p_title), '') = '' then
    raise exception 'Title is required';
  end if;

  new_id := 'ch_' || substr(md5(random()::text || auth.uid()::text), 1, 12);

  insert into challenges (id, title, subtitle, scheduled_for, category, notes, created_by)
  values (new_id, trim(p_title), p_subtitle, p_scheduled_for, p_category, p_notes, auth.uid());

  -- The creator is in by definition.
  insert into challenge_participants (challenge_id, user_id)
  values (new_id, auth.uid()) on conflict do nothing;

  return new_id;
end;
$$;


create or replace function public.delete_challenge(challenge_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Seeded challenges have created_by null and can never be deleted by a client.
  delete from challenges c
  where c.id = delete_challenge.challenge_id
    and c.created_by = auth.uid();
end;
$$;


-- ── Anonymous support nudges ────────────────────────────────────────────────
--
-- Note there is no recipient parameter on the client side. The function picks
-- the recipients itself, so the sender is never told which friend is
-- struggling; it returns only how many people were reached.

create table if not exists support_nudges (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references auth.users on delete cascade,
  body text not null,
  created_at timestamptz default now()
);

alter table support_nudges enable row level security;

drop policy if exists "see nudges sent to me" on support_nudges;
create policy "see nudges sent to me" on support_nudges for select
  using (auth.uid() = recipient_id);


create or replace function public.send_circle_support(body text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  sent int;
begin
  with flagged as (
    select f.friend_id
    from friendships f
    join lateral (
      select s.fused_score
      from stress_scores s
      where s.user_id = f.friend_id
      order by s.created_at desc
      limit 1
    ) latest on true
    where f.user_id = auth.uid()
      and latest.fused_score >= 60
  )
  insert into support_nudges (recipient_id, body)
  select flagged.friend_id, send_circle_support.body from flagged;

  get diagnostics sent = row_count;
  return sent;
end;
$$;


-- ── Grants ──────────────────────────────────────────────────────────────────

grant execute on function public.accept_friend_request(uuid) to authenticated;
grant execute on function public.get_circle_summary(uuid)  to authenticated;
grant execute on function public.list_challenges(uuid)     to authenticated;
grant execute on function public.toggle_challenge(text)    to authenticated;
grant execute on function public.create_challenge(text, text, text, text, text) to authenticated;
grant execute on function public.delete_challenge(text)    to authenticated;
grant execute on function public.send_circle_support(text) to authenticated;
