-- Asset Finder v3.8.5 — robust permanent deletion for completed fly-tip reports.
-- Uses direct auth.uid()/profile role checks so deletion does not depend on a client-side role helper.
alter table public.fly_tip_reports enable row level security;
drop policy if exists fly_tip_reports_delete on public.fly_tip_reports;
create policy fly_tip_reports_delete on public.fly_tip_reports
for delete using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (
        p.role = 'owner'
        or (p.role = 'patch_admin' and exists (
          select 1 from public.user_patches up
          where up.user_id = auth.uid() and up.patch_id = fly_tip_reports.patch_id
        ))
      )
  )
);

update public.app_config set latest_version='3.8.5', updated_at=now() where id=1;
