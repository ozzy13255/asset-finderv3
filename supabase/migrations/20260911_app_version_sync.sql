create table if not exists public.app_config (
  id integer primary key check (id = 1),
  latest_version text not null,
  updated_at timestamptz not null default now()
);

alter table public.app_config enable row level security;

drop policy if exists app_config_select_authenticated on public.app_config;
create policy app_config_select_authenticated on public.app_config
for select using (auth.uid() is not null);

insert into public.app_config (id, latest_version)
values (1, '3.3.0')
on conflict (id) do update set latest_version=excluded.latest_version, updated_at=now();
