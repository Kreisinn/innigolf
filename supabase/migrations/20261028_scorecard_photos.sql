-- Keep the scorecard photos behind each round, in a private storage bucket.
-- Only league members (signed in and on the members list) can view, add or delete them.

alter table public.rounds add column if not exists photos text[] not null default '{}';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('scorecards', 'scorecards', false, 5242880, array['image/jpeg'])
on conflict (id) do nothing;

drop policy if exists "members read scorecards" on storage.objects;
create policy "members read scorecards" on storage.objects for select to authenticated
  using (bucket_id = 'scorecards' and public.is_member());
drop policy if exists "members upload scorecards" on storage.objects;
create policy "members upload scorecards" on storage.objects for insert to authenticated
  with check (bucket_id = 'scorecards' and public.is_member());
drop policy if exists "members delete scorecards" on storage.objects;
create policy "members delete scorecards" on storage.objects for delete to authenticated
  using (bucket_id = 'scorecards' and public.is_member());
