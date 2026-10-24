-- When a reminder email was last sent for a league night.
alter table public.events add column if not exists reminded_at timestamptz;

-- Icelandic names for the three winter competitions.
update public.seasons set name = 'Haustmót 2026' where name = 'Autumn 2026';
update public.seasons set name = 'Jólamót 2026' where name = 'Christmas 2026';
update public.seasons set name = 'Vormót 2027' where name = 'Spring 2027';
