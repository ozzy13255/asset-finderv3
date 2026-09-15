create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  employee_number text not null unique,
  login_code text not null unique,
  role text not null check (role in ('owner','patch_admin','user')),
  status text not null default 'active' check (status in ('active','suspended','disabled')),
  must_change_password boolean not null default true,
  created_at timestamptz not null default now(),
  recovery_email text,
  profile_photo_data_url text
);

create table if not exists public.patches (
  id text primary key,
  name text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.user_patches (
  user_id uuid not null references public.profiles(id) on delete cascade,
  patch_id text not null references public.patches(id) on delete cascade,
  primary key (user_id,patch_id)
);

create table if not exists public.patch_inventories (
  patch_id text primary key references public.patches(id) on delete cascade,
  patch_name text not null,
  inventory jsonb not null default '{"accessPoints":[],"history":[]}'::jsonb,
  updated_at timestamptz not null default now()
);

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
  reviewed_at timestamptz,
  submitted_by_name text,
  submitted_by_employee_number text,
  approved_by_name text,
  approved_by_employee_number text
);

create table if not exists public.asset_removal_requests (
  id uuid primary key default gen_random_uuid(),
  patch_id text not null references public.patches(id) on delete cascade,
  access_point_id text not null,
  access_point_name text not null,
  asset_id text not null,
  asset_data jsonb not null,
  requested_by uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create index if not exists user_patches_user_idx on public.user_patches(user_id);
create index if not exists user_patches_patch_idx on public.user_patches(patch_id);
create index if not exists asset_approvals_patch_idx on public.asset_approvals(patch_id);
create index if not exists asset_removal_requests_patch_idx on public.asset_removal_requests(patch_id);

create or replace function public.current_role()
returns text language sql stable security definer set search_path=public
as $$ select role from public.profiles where id=auth.uid() $$;

create or replace function public.user_has_patch(p_user_id uuid,p_patch_id text)
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from public.user_patches where user_id=p_user_id and patch_id=p_patch_id) $$;

create or replace function public.user_shares_patch_with(p_target_user_id uuid)
returns boolean language sql stable security definer set search_path=public
as $$
  select exists(
    select 1 from public.user_patches mine join public.user_patches target on target.patch_id=mine.patch_id
    where mine.user_id=auth.uid() and target.user_id=p_target_user_id
  )
$$;

create or replace function public.can_access_patch(p_patch_id text)
returns boolean language sql stable security definer set search_path=public
as $$ select public.current_role()='owner' or public.user_has_patch(auth.uid(),p_patch_id) $$;

create or replace function public.lock_profile_identity()
returns trigger language plpgsql security definer set search_path=public
as $$
begin
  if auth.uid()=old.id and public.current_role()<>'owner' then
    new.name:=old.name; new.employee_number:=old.employee_number; new.login_code:=old.login_code; new.role:=old.role; new.status:=old.status;
  end if;
  return new;
end; $$;

drop trigger if exists profile_identity_lock on public.profiles;
create trigger profile_identity_lock before update on public.profiles for each row execute function public.lock_profile_identity();

create or replace function public.touch_inventory()
returns trigger language plpgsql set search_path=public
as $$ begin new.updated_at=now(); return new; end; $$;

drop trigger if exists patch_inventory_touch on public.patch_inventories;
create trigger patch_inventory_touch before update on public.patch_inventories for each row execute function public.touch_inventory();

alter table public.profiles enable row level security;
alter table public.patches enable row level security;
alter table public.user_patches enable row level security;
alter table public.patch_inventories enable row level security;
alter table public.asset_approvals enable row level security;
alter table public.asset_removal_requests enable row level security;

-- Profiles
 drop policy if exists profiles_select_self_owner_or_patch_admin on public.profiles;
create policy profiles_select_self_owner_or_patch_admin on public.profiles for select using (
 id=auth.uid() or public.current_role()='owner' or (public.current_role()='patch_admin' and public.user_shares_patch_with(id))
);
drop policy if exists profiles_update_owner on public.profiles;
create policy profiles_update_owner on public.profiles for update using (public.current_role()='owner') with check (public.current_role()='owner');
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles for update using (id=auth.uid()) with check (id=auth.uid());

-- Patches
drop policy if exists patches_select_allowed on public.patches;
create policy patches_select_allowed on public.patches for select using (public.can_access_patch(id));
drop policy if exists patches_owner_write on public.patches;
create policy patches_owner_write on public.patches for all using (public.current_role()='owner') with check (public.current_role()='owner');

-- User patch assignments
drop policy if exists user_patches_select on public.user_patches;
create policy user_patches_select on public.user_patches for select using (
 user_id=auth.uid() or public.current_role()='owner' or (public.current_role()='patch_admin' and public.user_has_patch(auth.uid(),patch_id))
);
drop policy if exists user_patches_owner_write on public.user_patches;
create policy user_patches_owner_write on public.user_patches for all using (public.current_role()='owner') with check (public.current_role()='owner');

-- Inventory
drop policy if exists inventories_select_allowed on public.patch_inventories;
create policy inventories_select_allowed on public.patch_inventories for select using (public.can_access_patch(patch_id));
drop policy if exists inventories_insert_admin_only on public.patch_inventories;
create policy inventories_insert_admin_only on public.patch_inventories for insert with check (public.current_role() in ('owner','patch_admin') and public.can_access_patch(patch_id));
drop policy if exists inventories_update_admin_only on public.patch_inventories;
create policy inventories_update_admin_only on public.patch_inventories for update using (public.current_role() in ('owner','patch_admin') and public.can_access_patch(patch_id)) with check (public.current_role() in ('owner','patch_admin') and public.can_access_patch(patch_id));
drop policy if exists inventories_delete_owner_only on public.patch_inventories;
create policy inventories_delete_owner_only on public.patch_inventories for delete using (public.current_role()='owner');

-- Asset approvals
drop policy if exists approvals_select on public.asset_approvals;
create policy approvals_select on public.asset_approvals for select using (requested_by=auth.uid() or public.current_role()='owner' or (public.current_role()='patch_admin' and public.can_access_patch(patch_id)));
drop policy if exists approvals_insert on public.asset_approvals;
create policy approvals_insert on public.asset_approvals for insert with check (public.current_role()='user' and requested_by=auth.uid() and public.can_access_patch(patch_id) and status='pending');
drop policy if exists approvals_update on public.asset_approvals;
create policy approvals_update on public.asset_approvals for update using (public.current_role()='owner' or (public.current_role()='patch_admin' and public.can_access_patch(patch_id))) with check (public.current_role()='owner' or (public.current_role()='patch_admin' and public.can_access_patch(patch_id)));
drop policy if exists approvals_delete on public.asset_approvals;
create policy approvals_delete on public.asset_approvals for delete using (public.current_role()='owner');

-- Asset removal requests
drop policy if exists asset_removal_select_allowed on public.asset_removal_requests;
create policy asset_removal_select_allowed on public.asset_removal_requests for select using (requested_by=auth.uid() or public.current_role()='owner' or (public.current_role()='patch_admin' and public.can_access_patch(patch_id)));
drop policy if exists asset_removal_user_insert on public.asset_removal_requests;
create policy asset_removal_user_insert on public.asset_removal_requests for insert with check (requested_by=auth.uid() and public.current_role()='user' and public.can_access_patch(patch_id));
drop policy if exists asset_removal_admin_update on public.asset_removal_requests;
create policy asset_removal_admin_update on public.asset_removal_requests for update using (public.current_role() in ('owner','patch_admin') and public.can_access_patch(patch_id)) with check (public.current_role() in ('owner','patch_admin') and public.can_access_patch(patch_id));

-- Fly tip reporting (Asset Finder v3.7.0)
create table if not exists public.fly_tip_reports (
  id uuid primary key default gen_random_uuid(),
  patch_id text not null references public.patches(id) on delete cascade,
  access_point_id text not null,
  access_point_name text not null,
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
  created_by_name text,
  created_by_employee_number text,
  completed_by_name text,
  completed_by_employee_number text,
  constraint fly_tip_location_required check (
    nullif(trim(coalesce(what3words,'')),'') is not null
    or (latitude is not null and longitude is not null)
  ),
  constraint fly_tip_latitude_valid check (latitude is null or latitude between -90 and 90),
  constraint fly_tip_longitude_valid check (longitude is null or longitude between -180 and 180)
);

create index if not exists fly_tip_reports_patch_idx on public.fly_tip_reports(patch_id);
create index if not exists fly_tip_reports_status_idx on public.fly_tip_reports(status);
create index if not exists fly_tip_reports_created_by_idx on public.fly_tip_reports(created_by);

alter table public.fly_tip_reports enable row level security;

drop policy if exists fly_tip_reports_select on public.fly_tip_reports;
create policy fly_tip_reports_select on public.fly_tip_reports for select using (
  created_by=auth.uid()
  or public.current_role()='owner'
  or (public.current_role()='patch_admin' and public.can_access_patch(patch_id))
);

drop policy if exists fly_tip_reports_insert on public.fly_tip_reports;
create policy fly_tip_reports_insert on public.fly_tip_reports for insert with check (
  created_by=auth.uid()
  and public.current_role() in ('user','patch_admin','owner')
  and public.can_access_patch(patch_id)
);

drop policy if exists fly_tip_reports_update on public.fly_tip_reports;
create policy fly_tip_reports_update on public.fly_tip_reports for update using (
  public.current_role()='owner'
  or (public.current_role()='patch_admin' and public.can_access_patch(patch_id))
) with check (
  public.current_role()='owner'
  or (public.current_role()='patch_admin' and public.can_access_patch(patch_id))
);

-- v3.8.4 Fly Tip permanent resolution deletion policy
alter table public.fly_tip_reports enable row level security;
drop policy if exists fly_tip_reports_delete on public.fly_tip_reports;
create policy fly_tip_reports_delete on public.fly_tip_reports for delete using (
  public.current_role()='owner'
  or (public.current_role()='patch_admin' and public.can_access_patch(patch_id))
);
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
  created_by_name text,
  created_by_employee_number text,
  completed_by_name text,
  completed_by_employee_number text,
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
