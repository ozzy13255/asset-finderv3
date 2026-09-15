-- Asset Finder v3.9.0: Scrap reporting
create table if not exists public.scrap_reports (
  id uuid primary key default gen_random_uuid(),
  patch_id text not null references public.patches(id) on delete cascade,
  access_point_id text not null,
  access_point_name text not null,
  scrap_type text not null default 'General scrap',
  approximate_amount text,
  what3words text,
  latitude double precision,
  longitude double precision,
  description text not null,
  photos jsonb not null default '[]'::jsonb,
  created_by uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'new' check (status in ('new','in_progress','resolved','rejected')),
  reviewed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  constraint scrap_location_required check (
    nullif(trim(coalesce(what3words,'')),'') is not null
    or (latitude is not null and longitude is not null)
  ),
  constraint scrap_latitude_valid check (latitude is null or latitude between -90 and 90),
  constraint scrap_longitude_valid check (longitude is null or longitude between -180 and 180)
);
create index if not exists scrap_reports_patch_idx on public.scrap_reports(patch_id);
create index if not exists scrap_reports_status_idx on public.scrap_reports(status);
create index if not exists scrap_reports_created_by_idx on public.scrap_reports(created_by);
alter table public.scrap_reports enable row level security;
drop policy if exists scrap_reports_select on public.scrap_reports;
create policy scrap_reports_select on public.scrap_reports for select using (
  created_by=auth.uid()
  or public.current_role()='owner'
  or (public.current_role()='patch_admin' and public.can_access_patch(patch_id))
);
drop policy if exists scrap_reports_insert on public.scrap_reports;
create policy scrap_reports_insert on public.scrap_reports for insert with check (
  created_by=auth.uid()
  and public.current_role() in ('user','patch_admin','owner')
  and public.can_access_patch(patch_id)
);
drop policy if exists scrap_reports_update on public.scrap_reports;
create policy scrap_reports_update on public.scrap_reports for update using (
  public.current_role()='owner'
  or (public.current_role()='patch_admin' and public.can_access_patch(patch_id))
) with check (
  public.current_role()='owner'
  or (public.current_role()='patch_admin' and public.can_access_patch(patch_id))
);
drop policy if exists scrap_reports_delete on public.scrap_reports;
create policy scrap_reports_delete on public.scrap_reports for delete using (
  public.current_role()='owner'
  or (public.current_role()='patch_admin' and public.can_access_patch(patch_id))
);
