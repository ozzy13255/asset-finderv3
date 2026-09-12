-- Asset Finder v3.3.7 header layout release
-- Production app_config was updated during the release deployment.
update public.app_config
set latest_version = '3.3.7',
    updated_at = now()
where id = 1;
