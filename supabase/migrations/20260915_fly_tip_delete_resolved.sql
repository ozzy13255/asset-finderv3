-- Asset Finder v3.8.4 — allow admins/owners to permanently delete resolved fly-tip reports.
alter table public.fly_tip_reports enable row level security;
drop policy if exists fly_tip_reports_delete on public.fly_tip_reports;
create policy fly_tip_reports_delete on public.fly_tip_reports for delete using (
  public.current_role()='owner'
  or (public.current_role()='patch_admin' and public.can_access_patch(patch_id))
);
