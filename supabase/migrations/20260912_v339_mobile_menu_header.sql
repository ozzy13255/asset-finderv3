-- Asset Finder v3.3.9 central version marker.
update public.app_config
set latest_version = '3.3.9', updated_at = now()
where id = 1;
