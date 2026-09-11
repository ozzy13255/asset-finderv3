-- Asset Finder v3.3.5
-- Central version + tighter RPC execution grants.
insert into public.app_config (id, latest_version, updated_at)
values (1, '3.3.5', now())
on conflict (id) do update set latest_version = excluded.latest_version, updated_at = excluded.updated_at;

revoke execute on function public.can_access_patch(text) from public, anon, authenticated;
revoke execute on function public.current_role() from public, anon, authenticated;
revoke execute on function public.lock_profile_identity() from public, anon, authenticated;
revoke execute on function public.user_has_patch(uuid,text) from public, anon, authenticated;
revoke execute on function public.user_shares_patch_with(uuid) from public, anon, authenticated;
