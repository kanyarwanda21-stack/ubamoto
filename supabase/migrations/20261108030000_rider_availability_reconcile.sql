alter table public.riders
  add column if not exists is_available boolean,
  add column if not exists lat double precision,
  add column if not exists lng double precision,
  add column if not exists updated_at timestamptz default now();

alter table public.riders alter column is_available set default true;
