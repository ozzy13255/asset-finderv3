-- v3.10.0: immutable attribution snapshots for asset/report audit visibility.
alter table public.asset_approvals add column if not exists submitted_by_name text;
alter table public.asset_approvals add column if not exists submitted_by_employee_number text;
alter table public.asset_approvals add column if not exists approved_by_name text;
alter table public.asset_approvals add column if not exists approved_by_employee_number text;

alter table public.fly_tip_reports add column if not exists created_by_name text;
alter table public.fly_tip_reports add column if not exists created_by_employee_number text;
alter table public.fly_tip_reports add column if not exists completed_by_name text;
alter table public.fly_tip_reports add column if not exists completed_by_employee_number text;

alter table public.scrap_reports add column if not exists created_by_name text;
alter table public.scrap_reports add column if not exists created_by_employee_number text;
alter table public.scrap_reports add column if not exists completed_by_name text;
alter table public.scrap_reports add column if not exists completed_by_employee_number text;

update public.app_config set latest_version='3.10.0', updated_at=now() where id=1;
