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
  onboarded boolean not null default false,
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

-- Allow login by username: looks up the email for a given username so the
-- client can call signInWithPassword({ email }). SECURITY DEFINER because
-- the caller is unauthenticated at login time. Only returns email, nothing else.
create or replace function public.get_email_for_username(lookup_username text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  found_email text;
begin
  select au.email into found_email
  from public.profiles p
  join auth.users au on au.id = p.id
  where lower(p.username) = lower(lookup_username)
  limit 1;

  return found_email;
end;
$$;


-- ── Pillar 3: Calibration & Ground Truth ────────────────────────────────────

create table if not exists baselines (
  user_id uuid primary key references auth.users on delete cascade,
  rmssd_baseline double precision,
  scan_count int not null default 0,
  perceived_stress_baseline double precision,
  updated_at timestamptz default now()
);

-- Finger spot checks only. The RMSSD baseline is a RESTING reference, so it is
-- built from deliberate spot checks and never from Desk Mode readings, which
-- are taken mid-task by definition. scan_count stays as the display total.
alter table baselines add column if not exists calibration_scans int not null default 0;

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

-- Idempotent upgrade for anyone who ran an earlier version of this file.
alter table challenges add column if not exists notes text;
alter table challenges add column if not exists created_by uuid references auth.users on delete cascade;
alter table challenges add column if not exists created_at timestamptz default now();
-- 'meetup' = same place and time; 'solo' = same window, own space.
alter table challenges add column if not exists kind text not null default 'solo'
  check (kind in ('meetup', 'solo'));
alter table challenges add column if not exists location text;
alter table challenges add column if not exists capacity int check (capacity is null or capacity > 0);

-- How completion can be proved, if it can be at all.
--   'breathing'   -> finish a guided breathing session; Wick sees the HRV change
--   'spot_check'  -> take a finger spot check inside the challenge window
--   null          -> nothing to measure. A lakeside walk with four friends is
--                    not something a phone camera can witness, and inventing a
--                    proxy for it would be worse than trusting people.
alter table challenges add column if not exists verify_with text
  check (verify_with is null or verify_with in ('breathing', 'spot_check'));

-- Whether this person's completion was witnessed by a measurement, rather than
-- self-reported. Both are valid; they are simply not the same claim, so they
-- are stored and displayed as different things.
-- Cancelled, not deleted. Once anyone else has joined, the challenge is in
-- their history and possibly in their evening's plans; making it vanish leaves
-- them with a gap and no explanation. A cancelled challenge stays visible,
-- clearly marked, and cannot be joined.
alter table challenges add column if not exists cancelled_at timestamptz;
-- So a meetup whose time or place moved can say so.
alter table challenges add column if not exists updated_at timestamptz;

alter table challenge_participants add column if not exists verified boolean not null default false;
alter table challenge_participants add column if not exists completed_at timestamptz;

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

insert into challenges (id, title, subtitle, scheduled_for, category, kind, location, capacity, notes) values
  ('walk-lakeside', 'Group Walk: Lakeside', 'Active recovery · 30 min', 'Tomorrow, 6:00 PM', 'physical',
   'meetup', 'Lakeside path, main entrance', 6,
   'Gentle loop of the lake. No pace, no tracking — just moving somewhere that is not your desk.'),
  ('tea-break', 'Screen-Free Tea Break', 'Mental downtime · 15 min', 'Today, 4:00 PM', 'mental',
   'solo', null, null, 'Fifteen minutes, no screens, wherever you are. Phones face-down.'),
  ('reach-out', 'Reach Out to Someone', 'Social recovery · one message', null, 'social',
   'solo', null, null, 'Message one person you have not spoken to this week. That is the whole challenge.')
on conflict (id) do nothing;


create table if not exists challenge_participants (
  challenge_id text not null references challenges on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  joined_at timestamptz default now(),
  completed_at timestamptz,
  primary key (challenge_id, user_id)
);

alter table challenge_participants enable row level security;

alter table challenge_participants add column if not exists verified boolean not null default false;
alter table challenge_participants add column if not exists completed_at timestamptz;

alter table challenge_participants enable row level security;

-- Participation is visible to your circle by design: joining a challenge is a
-- voluntary social act, not a stress signal, and you cannot safely turn up to a
-- meetup without knowing who else is coming. The rules that stay anonymous are
-- the ones that reveal distress — get_circle_summary and send_circle_support.
drop policy if exists "own participation" on challenge_participants;
drop policy if exists "participation readable by circle" on challenge_participants;
create policy "participation readable by circle" on challenge_participants for select
  using (
    auth.uid() = user_id
    or exists (
      select 1 from friendships f
      where f.user_id = auth.uid() and f.friend_id = challenge_participants.user_id
    )
  );
drop policy if exists "own participation write" on challenge_participants;
create policy "own participation write" on challenge_participants for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);


-- ── Function signature changes ──────────────────────────────────────────────
-- `create or replace function` cannot change a return type, and adding an
-- argument creates an OVERLOAD rather than replacing the original — which then
-- leaves PostgREST with two candidates and no way to choose. Both cases apply
-- to the functions below, so the previous signatures are dropped explicitly.
-- Dropping a function does not touch any data.
drop function if exists public.list_challenges(uuid);
drop function if exists public.create_challenge(text, text, text, text, text, text, int, text);
drop function if exists public.create_challenge(text, text, text, text, text, text, int, text, text);
drop function if exists public.update_challenge(text, text, text, text, text, text, text, int, text);
drop function if exists public.update_challenge(text, text, text, text, text, text, text, int, text, text);
drop function if exists public.complete_challenge(text, boolean);
drop function if exists public.complete_challenge(text, boolean, boolean);

create or replace function public.list_challenges(target_user_id uuid)
returns table (
  id text,
  title text,
  subtitle text,
  scheduled_for text,
  category text,
  kind text,
  location text,
  capacity int,
  verify_with text,
  cancelled boolean,
  updated_at timestamptz,
  joined_count int,
  completed_count int,
  circle_size int,
  joined boolean,
  completed_by_me boolean,
  verified_by_me boolean,
  created_by uuid,
  created_by_me boolean,
  notes text,
  participants jsonb
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

  -- Participants the caller may see: themselves plus their own friends. A
  -- friend-of-the-author who is a stranger to the caller stays invisible, so
  -- the participant list never introduces people outside your circle.
  return query
  with visible_participants as (
    select p.*
    from challenge_participants p
    where p.user_id = target_user_id
       or exists (
         select 1 from friendships f
         where f.user_id = target_user_id and f.friend_id = p.user_id
       )
  )
  select
    c.id,
    c.title,
    c.subtitle,
    c.scheduled_for,
    c.category,
    c.kind,
    c.location,
    c.capacity,
    c.verify_with,
    (c.cancelled_at is not null),
    c.updated_at,
    (select count(*)::int from visible_participants vp where vp.challenge_id = c.id),
    (select count(*)::int from visible_participants vp
      where vp.challenge_id = c.id and vp.completed_at is not null),
    (n + 1),
    exists (
      select 1 from challenge_participants p
      where p.challenge_id = c.id and p.user_id = target_user_id
    ),
    exists (
      select 1 from challenge_participants p
      where p.challenge_id = c.id and p.user_id = target_user_id and p.completed_at is not null
    ),
    exists (
      select 1 from challenge_participants p
      where p.challenge_id = c.id and p.user_id = target_user_id and p.verified
    ),
    c.created_by,
    (c.created_by = target_user_id),
    c.notes,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'userId', vp.user_id,
            'username', pr.username,
            'completed', vp.completed_at is not null,
            'verified', vp.verified,
            'isMe', vp.user_id = target_user_id
          )
          order by (vp.user_id = target_user_id) desc, vp.joined_at
        )
        from visible_participants vp
        join profiles pr on pr.id = vp.user_id
        where vp.challenge_id = c.id
      ),
      '[]'::jsonb
    )
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
    if exists (
      select 1 from challenges c
      where c.id = toggle_challenge.challenge_id and c.cancelled_at is not null
    ) then
      raise exception 'This challenge was cancelled';
    end if;

    -- Capacity is enforced server-side; a client that ignores the full state
    -- still cannot squeeze in.
    if exists (
      select 1 from challenges c
      where c.id = toggle_challenge.challenge_id
        and c.capacity is not null
        and (select count(*) from challenge_participants p
             where p.challenge_id = c.id) >= c.capacity
    ) then
      raise exception 'This challenge is full';
    end if;

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
  p_kind text,
  p_location text,
  p_capacity int,
  p_notes text,
  p_verify_with text default null
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

  insert into challenges (id, title, subtitle, scheduled_for, category, kind, location, capacity, notes, verify_with, created_by)
  values (new_id, trim(p_title), p_subtitle, p_scheduled_for, p_category,
          coalesce(p_kind, 'solo'), p_location, p_capacity, p_notes, p_verify_with, auth.uid());

  -- The creator is in by definition.
  insert into challenge_participants (challenge_id, user_id)
  values (new_id, auth.uid()) on conflict do nothing;

  return new_id;
end;
$$;


create or replace function public.update_challenge(
  challenge_id text,
  p_title text,
  p_subtitle text,
  p_scheduled_for text,
  p_category text,
  p_kind text,
  p_location text,
  p_capacity int,
  p_notes text,
  p_verify_with text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  others int;
begin
  select count(*) into others
    from challenge_participants p
   where p.challenge_id = update_challenge.challenge_id
     and p.user_id <> auth.uid();

  -- Turning a meetup people committed to travel for into a "do it in your own
  -- space" challenge (or the reverse) changes what they agreed to. Everything
  -- else stays editable; plans move, and pretending otherwise just means people
  -- delete and re-create, which loses the participants.
  if others > 0 and exists (
    select 1 from challenges c
     where c.id = update_challenge.challenge_id
       and c.kind is distinct from coalesce(p_kind, c.kind)
  ) then
    raise exception 'Others have joined — a meetup cannot become a solo challenge, or the reverse';
  end if;

  update challenges c set
    title = trim(p_title),
    subtitle = p_subtitle,
    scheduled_for = p_scheduled_for,
    category = p_category,
    kind = coalesce(p_kind, c.kind),
    location = p_location,
    capacity = p_capacity,
    notes = p_notes,
    verify_with = p_verify_with,
    updated_at = case when others > 0 then now() else c.updated_at end
  where c.id = update_challenge.challenge_id
    and c.created_by = auth.uid();

  if not found then
    raise exception 'Only the creator can edit this challenge';
  end if;
end;
$$;


-- Self-reported. Wick can verify a breathing break from the user's own vitals;
-- it cannot verify that four friends walked round a lake, and inventing a proof
-- would be a worse lie than trusting them.
create or replace function public.complete_challenge(
  challenge_id text,
  p_done boolean,
  p_verified boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update challenge_participants p
  set completed_at = case when p_done then now() else null end,
      -- Verification is a property of THIS completion. Un-completing clears it,
      -- so a verified tick can never be left behind on a challenge the person
      -- later says they did not do.
      verified = case when p_done then p_verified else false end
  where p.challenge_id = complete_challenge.challenge_id
    and p.user_id = auth.uid();

  if not found then
    raise exception 'Join the challenge before marking it done';
  end if;
end;
$$;


/**
 * Hard delete, allowed only while you are the only participant.
 *
 * Once anyone else has joined, the challenge exists in their history and
 * possibly in their evening. Deleting it would remove rows from someone else's
 * record and leave a meetup they had planned around simply gone, with nothing
 * to explain it. cancel_challenge() is the operation for that case.
 */
create or replace function public.delete_challenge(challenge_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  others int;
begin
  select count(*) into others
    from challenge_participants p
   where p.challenge_id = delete_challenge.challenge_id
     and p.user_id <> auth.uid();

  if others > 0 then
    raise exception 'Others have joined — cancel it instead, so it stays in their history';
  end if;

  delete from challenges c
   where c.id = delete_challenge.challenge_id
     and c.created_by = auth.uid();

  if not found then
    raise exception 'Only the creator can remove this challenge';
  end if;
end;
$$;


/**
 * Calls it off without erasing it.
 *
 * The challenge stays visible to everyone who joined, marked cancelled and
 * closed to new joins. Completions already recorded are left alone: somebody
 * who did the thing before it was called off still did it.
 */
create or replace function public.cancel_challenge(challenge_id text, p_cancelled boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update challenges c
     set cancelled_at = case when p_cancelled then now() else null end
   where c.id = cancel_challenge.challenge_id
     and c.created_by = auth.uid();

  if not found then
    raise exception 'Only the creator can cancel this challenge';
  end if;
end;
$$;


create or replace function public.set_username(new_username text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  cleaned text;
begin
  cleaned := trim(new_username);
  if length(cleaned) < 2 or length(cleaned) > 24 then
    raise exception 'Pick a name between 2 and 24 characters';
  end if;

  update profiles set username = cleaned where id = auth.uid();
  return cleaned;
exception
  when unique_violation then
    raise exception 'Somebody already uses that name — try another';
end;
$$;


create or replace function public.remove_friend(other_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from friendships
   where (user_id = auth.uid() and friend_id = other_user_id)
      or (user_id = other_user_id and friend_id = auth.uid());

  -- Clear any pending request between the two, so removing someone does not
  -- leave a stale invitation that quietly re-adds them.
  delete from friend_requests
   where (requester_id = auth.uid() and recipient_id = other_user_id)
      or (requester_id = other_user_id and recipient_id = auth.uid());
end;
$$;


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
grant execute on function public.create_challenge(text, text, text, text, text, text, int, text, text) to authenticated;
grant execute on function public.update_challenge(text, text, text, text, text, text, text, int, text, text) to authenticated;
grant execute on function public.complete_challenge(text, boolean, boolean) to authenticated;
grant execute on function public.remove_friend(uuid) to authenticated;
grant execute on function public.set_username(text) to authenticated;
grant execute on function public.cancel_challenge(text, boolean) to authenticated;
grant execute on function public.send_circle_support(text) to authenticated;

-- â”€â”€ Pillar 5: recovery records â”€â”€
-- Coordinates are intentionally absent. A recovery action records only its
-- verified outcome, never a route, place, or location history.
create table if not exists recovery_days (
  user_id uuid not null references auth.users on delete cascade,
  recovery_date date not null,
  completed_plan_ids text[] not null default '{}',
  game_completed boolean not null default false,
  game_minutes integer not null default 0,
  outdoor_completed boolean not null default false,
  recovery_event_id text,
  recovery_event_start timestamptz,
  recovery_pct integer not null default 0 check (recovery_pct between 0 and 100),
  updated_at timestamptz not null default now(),
  primary key (user_id, recovery_date)
);

alter table recovery_days enable row level security;
drop policy if exists "own recovery days" on recovery_days;
create policy "own recovery days" on recovery_days for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── Recovery plan sessions ──────────────────────────────────────────────────
-- A started recovery plan and its real, measured progress. Seeds are earned
-- only when a plan's tracked progress reaches its target; the app never marks
-- one finished on a button press. One live session per (day, plan).
create table if not exists recovery_plan_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  recovery_date date not null,
  plan_key text not null,
  title text not null,
  emoji text not null,
  detail text,
  target_type text not null check (target_type in ('steps', 'minutes', 'none')),
  target_value integer not null default 0,
  progress_value integer not null default 0,
  status text not null default 'started' check (status in ('started', 'completed')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  reward_awarded boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, recovery_date, plan_key)
);

create index if not exists recovery_plan_sessions_user_date on recovery_plan_sessions (user_id, recovery_date);

alter table recovery_plan_sessions enable row level security;
drop policy if exists "own recovery plan sessions" on recovery_plan_sessions;
create policy "own recovery plan sessions" on recovery_plan_sessions for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── Garden: seed wallet & owned items ──────────────────────────────────────
-- Completing a recovery activity earns seeds; seeds buy catalogue items that
-- live permanently in the garden. Both are per-user and RLS-locked.
create table if not exists garden_wallet (
  user_id uuid primary key references auth.users on delete cascade,
  seeds integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table garden_wallet enable row level security;
drop policy if exists "own garden wallet" on garden_wallet;
create policy "own garden wallet" on garden_wallet for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists garden_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  item_key text not null,
  name text not null,
  emoji text not null,
  kind text not null check (kind in ('plant', 'flower', 'pet', 'decoration')),
  /** Relative position in garden as jsonb {x,y} (0-100%). Null = use default layout. */
  position jsonb,
  created_at timestamptz not null default now()
);

-- Older projects created garden_items before drag-to-decorate existed, so the
-- drawing position is added here as well: `create table if not exists` does
-- nothing when the table is already there, and every path that reads or writes
-- a placement would otherwise fail against a column that is missing.
alter table garden_items add column if not exists position jsonb;

create index if not exists garden_items_user on garden_items (user_id, created_at);

alter table garden_items enable row level security;
drop policy if exists "own garden items" on garden_items;
create policy "own garden items" on garden_items for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── Pillar 1: Calendar Sync & Workload Capacity ─────────────────────────────

create table if not exists calendar_connections (
  user_id uuid not null references auth.users on delete cascade,
  provider text not null default 'device' check (provider in ('device', 'google', 'outlook')),
  connected boolean not null default true,
  account_email text,
  access_token text,
  refresh_token text,
  expires_at timestamptz,
  last_synced_at timestamptz default now(),
  created_at timestamptz default now(),
  primary key (user_id, provider)
);

alter table calendar_connections enable row level security;
drop policy if exists "own calendar connections" on calendar_connections;
create policy "own calendar connections" on calendar_connections for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

alter table public.calendar_connections
drop constraint if exists calendar_connections_provider_check;

alter table public.calendar_connections
add constraint calendar_connections_provider_check
check (provider in ('device', 'google', 'outlook'));


create table if not exists workload_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  title text not null,
  category text not null default 'academic',
  estimated_hours double precision not null default 1.0,
  priority text not null default 'medium',
  source text not null default 'manual',
  status text not null default 'scheduled',
  scheduled_start timestamptz,
  scheduled_end timestamptz,
  calendar_event_id text,
  created_at timestamptz default now()
);
-- Loosen the fixed-list constraints that were rejecting AI-generated and
-- calendar-synced categories/sources. The app writes free-form categories
-- (e.g. "Engineering", "Health") and a "device" source; the old CHECK clauses
-- silently dropped every row.
alter table workload_items drop constraint if exists workload_items_category_check;
alter table workload_items drop constraint if exists workload_items_source_check;
alter table workload_items drop constraint if exists workload_items_status_check;
alter table workload_items drop constraint if exists workload_items_priority_check;
alter table workload_items add column if not exists calendar_event_id text;

create index if not exists workload_items_user_time on workload_items (user_id, status, scheduled_start);

alter table workload_items enable row level security;
drop policy if exists "own workload items" on workload_items;
create policy "own workload items" on workload_items for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── Pillar 1 Extensions: AI Analysis & Weekly Capacity ──────────────────────

create table if not exists ai_task_analysis (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  week_start date not null,
  title text not null,
  category text not null default 'academic',
  priority text not null default 'medium',
  estimated_duration_hours double precision not null default 1.0,
  scheduled_date date not null,
  scheduled_start_time time,
  scheduled_end_time time,
  capacity_hours double precision not null default 1.0,
  rank int not null default 0,
  ai_reasoning text,
  stress_score double precision,
  status text not null default 'pending',
  calendar_event_id text,
  calendar_provider text,
  created_at timestamptz default now()
);
-- Loosen fixed-list constraints that reject AI-generated dynamic categories.
alter table ai_task_analysis drop constraint if exists ai_task_analysis_category_check;
alter table ai_task_analysis drop constraint if exists ai_task_analysis_priority_check;
alter table ai_task_analysis drop constraint if exists ai_task_analysis_status_check;
alter table ai_task_analysis drop constraint if exists ai_task_analysis_calendar_provider_check;
alter table ai_task_analysis add column if not exists stress_score double precision;

create index if not exists ai_task_analysis_user_week on ai_task_analysis (user_id, week_start, rank);

alter table ai_task_analysis enable row level security;
drop policy if exists "own ai task analysis" on ai_task_analysis;
create policy "own ai task analysis" on ai_task_analysis for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists weekly_capacity_analyses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  week_start date not null,
  total_capacity_hours double precision not null default 40.0,
  used_capacity_hours double precision not null default 0.0,
  overload_warning boolean not null default false,
  category_breakdown jsonb not null default '{}',
  stress_score double precision,
  ai_reasoning text,
  created_at timestamptz default now(),
  unique (user_id, week_start)
);

alter table weekly_capacity_analyses enable row level security;
drop policy if exists "own weekly capacity" on weekly_capacity_analyses;
create policy "own weekly capacity" on weekly_capacity_analyses for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists task_chat_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  message text not null,
  sender text not null check (sender in ('user', 'ai')),
  task_id uuid references ai_task_analysis on delete set null,
  created_at timestamptz default now()
);

create index if not exists task_chat_logs_user_time on task_chat_logs (user_id, created_at);

alter table task_chat_logs enable row level security;
drop policy if exists "own chat logs" on task_chat_logs;
create policy "own chat logs" on task_chat_logs for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Allow the signup screen to probe username availability before submit.
-- SECURITY DEFINER because the caller is unauthenticated at signup time;
-- it returns only a boolean, never the profile row.
create or replace function public.is_username_taken(p_username text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  return exists (
    select 1 from public.profiles
    where lower(username) = lower(p_username)
  );
end;
$$;
