-- Asset Finder v3.5.0 UI overhaul release marker
update public.app_config
set latest_version = '3.5.0', updated_at = now()
where id = 1;
