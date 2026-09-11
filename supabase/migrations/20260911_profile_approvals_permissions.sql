-- Source-control migration for profile fields, asset approvals and role restrictions.
-- This migration has already been applied to the production Asset Finder Supabase project.

alter table public.profiles add column if not exists recovery_email text;
alter table public.profiles add column if not exists profile_photo_data_url text;

create table if not exists public.asset_approvals (
  id uuid primary key default gen_random_uuid(),
  patch_id text not null references public.patches(id) on delete cascade,
  access_point_id text not null,
  access_point_name text not null,
  asset_data jsonb not null,
  requested_by uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create index if not exists asset_approvals_patch_idx on public.asset_approvals(patch_id);
create index if not exists asset_approvals_requested_by_idx on public.asset_approvals(requested_by);

alter table public.asset_approvals enable row level security;

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
for update using (id=auth.uid()) with check (id=auth.uid());

drop policy if exists inventories_insert_allowed on public.patch_inventories;
drop policy if exists inventories_update_allowed on public.patch_inventories;
create policy inventories_insert_allowed on public.patch_inventories
for insert with check (public.current_role() in ('owner','patch_admin') and public.can_access_patch(patch_id));
create policy inventories_update_allowed on public.patch_inventories
for update using (public.current_role() in ('owner','patch_admin') and public.can_access_patch(patch_id))
with check (public.current_role() in ('owner','patch_admin') and public.can_access_patch(patch_id));

drop policy if exists approvals_select on public.asset_approvals;
create policy approvals_select on public.asset_approvals
for select using (
  requested_by=auth.uid()
  or public.current_role()='owner'
  or (public.current_role()='patch_admin' and public.can_access_patch(patch_id))
);

drop policy if exists approvals_insert on public.asset_approvals;
create policy approvals_insert on public.asset_approvals
for insert with check (
  public.current_role()='user'
  and requested_by=auth.uid()
  and public.can_access_patch(patch_id)
  and status='pending'
);

drop policy if exists approvals_update on public.asset_approvals;
create policy approvals_update on public.asset_approvals
for update using (
  public.current_role()='owner'
  or (public.current_role()='patch_admin' and public.can_access_patch(patch_id))
) with check (
  public.current_role()='owner'
  or (public.current_role()='patch_admin' and public.can_access_patch(patch_id))
);

drop policy if exists approvals_delete on public.asset_approvals;
create policy approvals_delete on public.asset_approvals for delete using (public.current_role()='owner');
