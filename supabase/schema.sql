-- Trackman Winter League: database setup.
-- Paste this whole file into Supabase > SQL Editor and click Run. Safe to run again.

-- Who may add rounds. Add one row per player (their sign-in email).
-- is_admin = may create and edit competitions.
create table if not exists public.members (
  email    text primary key,
  name     text not null default '',
  is_admin boolean not null default false
);

-- Competitions (autumn, Christmas, spring...). Standings reset for each one.
create table if not exists public.seasons (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  start_date     date not null,
  end_date       date not null,
  planned_rounds int  check (planned_rounds is null or planned_rounds >= 1),
  best_of        int  not null check (best_of >= 1),
  check (end_date >= start_date)
);

-- One row per round played. scores is a list of
-- {"player": "Jon", "hcp": 12.4, "gross": 84, "points": 35}
create table if not exists public.rounds (
  id         uuid primary key default gen_random_uuid(),
  played_on  date not null,
  course     text not null default '',
  scores     jsonb not null default '[]'::jsonb check (jsonb_typeof(scores) = 'array'),
  created_by text default (auth.jwt() ->> 'email'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Helpers the access rules use. "security definer" lets them read members
-- even though members itself is locked down.
create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where lower(email) = lower(auth.jwt() ->> 'email'))
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where lower(email) = lower(auth.jwt() ->> 'email') and is_admin)
$$;

alter table public.members enable row level security;
alter table public.seasons enable row level security;
alter table public.rounds  enable row level security;

-- Standings are public: anyone with the link can read competitions and rounds.
-- (To make them members-only, change "to anon, authenticated using (true)"
--  to "to authenticated using (public.is_member())" in the two read rules.)
drop policy if exists "read seasons" on public.seasons;
create policy "read seasons" on public.seasons for select to anon, authenticated using (true);
drop policy if exists "read rounds" on public.rounds;
create policy "read rounds" on public.rounds for select to anon, authenticated using (true);

-- Any league member may add, fix or delete rounds.
drop policy if exists "members add rounds" on public.rounds;
create policy "members add rounds" on public.rounds for insert to authenticated with check (public.is_member());
drop policy if exists "members edit rounds" on public.rounds;
create policy "members edit rounds" on public.rounds for update to authenticated using (public.is_member()) with check (public.is_member());
drop policy if exists "members delete rounds" on public.rounds;
create policy "members delete rounds" on public.rounds for delete to authenticated using (public.is_member());

-- Only admins manage competitions.
drop policy if exists "admins manage seasons" on public.seasons;
create policy "admins manage seasons" on public.seasons for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- A signed-in person can see their own member row (so the page knows what they may do).
-- Members are managed in Supabase > Table Editor > members.
drop policy if exists "see own membership" on public.members;
create policy "see own membership" on public.members for select to authenticated
  using (lower(email) = lower(auth.jwt() ->> 'email'));

-- The three competitions for winter 2026-27. Edit numbers here or later in the page.
insert into public.seasons (name, start_date, end_date, planned_rounds, best_of)
select * from (values
  ('Autumn 2026',    date '2026-11-01', date '2026-12-15',  6,  4),
  ('Christmas 2026', date '2026-12-16', date '2027-01-15',  4,  3),
  ('Spring 2027',    date '2027-01-16', date '2027-04-30', 15, 10)
) v(name, start_date, end_date, planned_rounds, best_of)
where not exists (select 1 from public.seasons);

-- Members and admins are added in Supabase > Table Editor > members (see README),
-- so no email addresses end up in this public repository. Or uncomment and edit:
-- insert into public.members (email, name, is_admin) values ('you@example.com', 'Your name', true);
-- insert into public.members (email, name) values
--   ('player1@example.com', 'Player One'),
--   ('player2@example.com', 'Player Two');
