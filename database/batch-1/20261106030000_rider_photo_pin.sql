-- Rider passport photos and phone/PIN authentication.
alter table public.rider_applications
  add column if not exists passport_photo_path text;

alter table public.riders
  add column if not exists passport_photo_path text,
  add column if not exists pin_salt text,
  add column if not exists pin_hash text;

create unique index if not exists riders_phone_unique_idx on public.riders (phone);
create index if not exists rider_applications_status_created_idx
  on public.rider_applications (status, created_at desc);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'rider-passports',
  'rider-passports',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

revoke all on table public.riders from anon, authenticated, public;
grant select, update on table public.riders to authenticated;
grant all on table public.riders to service_role;
