create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  employee_number text not null unique,
  login_code text not null unique,
  role text not null check (role in ('owner','patch_admin','user')),
  status text not null default 'active' check (status in ('active','suspended','disabled')),
  must_change_password boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.patches (
  id text primary key,
  name text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.user_patches (
  user_id uuid not null references public.profiles(id) on delete cascade,
  patch_id text not null references public.patches(id) on delete cascade,
  primary key (user_id, patch_id)
);

create table if not exists public.patch_inventories (
  patch_id text primary key references public.patches(id) on delete cascade,
  patch_name text not null,
  inventory jsonb not null default '{"accessPoints":[],"history":[]}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists user_patches_user_idx on public.user_patches(user_id);
create index if not exists user_patches_patch_idx on public.user_patches(patch_id);

create or replace function public.current_role()
returns text language sql stable security definer set search_path=public
as $$ select role from public.profiles where id=auth.uid() $$;

create or replace function public.can_access_patch(p_patch_id text)
returns boolean language sql stable security definer set search_path=public
as $$
  select public.current_role()='owner'
      or exists (select 1 from public.user_patches up where up.user_id=auth.uid() and up.patch_id=p_patch_id);
$$;

alter table public.profiles enable row level security;
alter table public.patches enable row level security;
alter table public.user_patches enable row level security;
alter table public.patch_inventories enable row level security;

-- Profiles: users can read their own immutable identity/role fields; owner can administer all.
drop policy if exists profiles_select_self_or_owner on public.profiles;
drop policy if exists profiles_select_self_owner_or_patch_admin on public.profiles;
create policy profiles_select_self_owner_or_patch_admin on public.profiles
for select using (
  id=auth.uid()
  or public.current_role()='owner'
  or (public.current_role()='patch_admin' and exists (
    select 1 from public.user_patches mine
    join public.user_patches target on target.patch_id=mine.patch_id
    where mine.user_id=auth.uid() and target.user_id=profiles.id
  ))
);

drop policy if exists profiles_update_owner on public.profiles;
create policy profiles_update_owner on public.profiles for update using (public.current_role()='owner') with check (public.current_role()='owner');

-- Patch list: owner sees all; others see only assigned patches.
drop policy if exists patches_select_allowed on public.patches;
create policy patches_select_allowed on public.patches for select using (public.can_access_patch(id));

drop policy if exists patches_owner_write on public.patches;
create policy patches_owner_write on public.patches for all using (public.current_role()='owner') with check (public.current_role()='owner');

-- Assignments: users see their own; owner sees all. Writes are performed by the protected admin function.
drop policy if exists user_patches_select on public.user_patches;
create policy user_patches_select on public.user_patches
for select using (
  user_id=auth.uid()
  or public.current_role()='owner'
  or (public.current_role()='patch_admin' and exists (
    select 1 from public.user_patches mine
    where mine.user_id=auth.uid() and mine.patch_id=user_patches.patch_id
  ))
);
drop policy if exists user_patches_owner_write on public.user_patches;
create policy user_patches_owner_write on public.user_patches for all using (public.current_role()='owner') with check (public.current_role()='owner');

-- Inventory is the hard security boundary. Patch admins/users can access only their patch; owner can access all.
drop policy if exists inventories_select_allowed on public.patch_inventories;
create policy inventories_select_allowed on public.patch_inventories for select using (public.can_access_patch(patch_id));
drop policy if exists inventories_insert_allowed on public.patch_inventories;
create policy inventories_insert_allowed on public.patch_inventories for insert with check (public.can_access_patch(patch_id));
drop policy if exists inventories_update_allowed on public.patch_inventories;
create policy inventories_update_allowed on public.patch_inventories for update using (public.can_access_patch(patch_id)) with check (public.can_access_patch(patch_id));
drop policy if exists inventories_delete_owner on public.patch_inventories;
create policy inventories_delete_owner on public.patch_inventories for delete using (public.current_role()='owner');

create or replace function public.touch_inventory()
returns trigger language plpgsql as $$ begin new.updated_at=now(); return new; end; $$;
drop trigger if exists patch_inventory_touch on public.patch_inventories;
create trigger patch_inventory_touch before update on public.patch_inventories for each row execute function public.touch_inventory();

-- Prevent non-owner users from changing their name, employee number, login code or role directly.
create or replace function public.lock_profile_identity()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() = old.id and public.current_role() <> 'owner' then
    new.name := old.name;
    new.employee_number := old.employee_number;
    new.login_code := old.login_code;
    new.role := old.role;
    new.status := old.status;
  end if;
  return new;
end; $$;
drop trigger if exists profile_identity_lock on public.profiles;
create trigger profile_identity_lock before update on public.profiles for each row execute function public.lock_profile_identity();

-- Storage/object permissions are intentionally not included: photos can remain in the app's local record initially.
