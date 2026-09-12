-- v3.4.2: normal users only see their own pending removal requests.
-- Admins retain visibility across their permitted patch scope.
drop policy if exists asset_removal_select_allowed on public.asset_removal_requests;
create policy asset_removal_select_allowed on public.asset_removal_requests
for select using (
  requested_by = auth.uid()
  or public.current_role() = 'owner'
  or (public.current_role() = 'patch_admin' and public.can_access_patch(patch_id))
);

update public.app_config
set latest_version='3.4.2', updated_at=now()
where id=1;
