-- Player register, events and attendance.
-- Run after schema.sql (Supabase > SQL Editor > paste > Run). Safe to run again.

-- Everyone in the league, whether or not they sign in. trackman_ids are the
-- names a player shows up under on Trackman scorecards (e.g. "KIDDIEIKA66").
create table if not exists public.players (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (length(trim(name)) > 0),
  trackman_ids text[] not null default '{}',
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

-- A sign-in email (members row) belongs to one player.
alter table public.members add column if not exists player_id uuid unique references public.players(id) on delete set null;

-- Give every existing member a player record, named after the member.
do $$
declare m record; pid uuid;
begin
  for m in select email, name from public.members where player_id is null loop
    insert into public.players (name) values (coalesce(nullif(trim(m.name), ''), 'New player')) returning id into pid;
    update public.members set player_id = pid where email = m.email;
  end loop;
end $$;

-- League nights. The next one on or after today is the "active" event.
create table if not exists public.events (
  id         uuid primary key default gen_random_uuid(),
  event_date date not null,
  start_time time,
  location   text not null default '',
  notes      text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists events_date_idx on public.events (event_date);

-- Who is coming. One answer per player per event.
create table if not exists public.attendance (
  event_id   uuid not null references public.events(id) on delete cascade,
  player_id  uuid not null references public.players(id) on delete cascade,
  status     text not null check (status in ('yes', 'no')),
  updated_at timestamptz not null default now(),
  updated_by text default (auth.jwt() ->> 'email'),
  primary key (event_id, player_id)
);
create index if not exists attendance_player_idx on public.attendance (player_id);

-- The player linked to the signed-in email, if any.
create or replace function public.my_player_id() returns uuid
language sql stable security definer set search_path = public as $$
  select player_id from members where lower(email) = lower(auth.jwt() ->> 'email')
$$;
revoke execute on function public.my_player_id() from public, anon;
grant execute on function public.my_player_id() to authenticated;

alter table public.players    enable row level security;
alter table public.events     enable row level security;
alter table public.attendance enable row level security;

-- Names, events and answers are visible to anyone with the link, like the standings.
drop policy if exists "read players" on public.players;
create policy "read players" on public.players for select to anon, authenticated using (true);
drop policy if exists "read events" on public.events;
create policy "read events" on public.events for select to anon, authenticated using (true);
drop policy if exists "read attendance" on public.attendance;
create policy "read attendance" on public.attendance for select to anon, authenticated using (true);

-- Admins register players and plan events.
drop policy if exists "admins manage players" on public.players;
create policy "admins manage players" on public.players for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admins manage events" on public.events;
create policy "admins manage events" on public.events for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Members can link a scorecard name to a player while saving a round, without
-- being able to change anything else about players. Returns false if that
-- name already belongs to someone else.
create or replace function public.add_trackman_id(p_player uuid, p_card_name text) returns boolean
language plpgsql security definer set search_path = public as $$
declare clean text := upper(trim(regexp_replace(coalesce(p_card_name, ''), '(\.\.\.|…)\s*$', '')));
begin
  if not public.is_member() then raise exception 'not a league member'; end if;
  if clean = '' then return false; end if;
  if exists (select 1 from players where id <> p_player
             and clean = any (select upper(trim(regexp_replace(t, '(\.\.\.|…)\s*$', ''))) from unnest(trackman_ids) t)) then
    return false;
  end if;
  update players set trackman_ids = array_append(trackman_ids, clean)
   where id = p_player
     and not clean = any (select upper(trim(regexp_replace(t, '(\.\.\.|…)\s*$', ''))) from unnest(trackman_ids) t);
  return true;
end $$;
revoke execute on function public.add_trackman_id(uuid, text) from public, anon;
grant execute on function public.add_trackman_id(uuid, text) to authenticated;

-- Each player answers for themselves; admins can answer for anyone.
drop policy if exists "answer own attendance" on public.attendance;
create policy "answer own attendance" on public.attendance for all to authenticated
  using (player_id = public.my_player_id() or public.is_admin())
  with check (player_id = public.my_player_id() or public.is_admin());

-- Admins manage sign-in emails from the app (emails are never public).
drop policy if exists "admins read members" on public.members;
create policy "admins read members" on public.members for select to authenticated using (public.is_admin());
drop policy if exists "admins manage members" on public.members;
create policy "admins manage members" on public.members for all to authenticated using (public.is_admin()) with check (public.is_admin());
