create or replace function public.touch_inventory()
returns trigger language plpgsql set search_path=public as $$
begin new.updated_at=now(); return new; end; $$;

grant execute on function public.current_role() to anon, authenticated;
grant execute on function public.can_access_patch(text) to anon, authenticated;
revoke execute on function public.touch_inventory() from anon, authenticated;
revoke execute on function public.lock_profile_identity() from anon, authenticated;

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
create index if not exists asset_removal_requests_patch_idx on public.asset_removal_requests(patch_id);
create index if not exists asset_removal_requests_requested_by_idx on public.asset_removal_requests(requested_by);
alter table public.asset_removal_requests enable row level security;
drop policy if exists asset_removal_select_allowed on public.asset_removal_requests;
create policy asset_removal_select_allowed on public.asset_removal_requests for select using (public.can_access_patch(patch_id));
drop policy if exists asset_removal_user_insert on public.asset_removal_requests;
create policy asset_removal_user_insert on public.asset_removal_requests for insert with check (requested_by=auth.uid() and public.current_role()='user' and public.can_access_patch(patch_id));
drop policy if exists asset_removal_admin_update on public.asset_removal_requests;
create policy asset_removal_admin_update on public.asset_removal_requests for update using ((public.current_role() in ('owner','patch_admin')) and public.can_access_patch(patch_id)) with check ((public.current_role() in ('owner','patch_admin')) and public.can_access_patch(patch_id));
