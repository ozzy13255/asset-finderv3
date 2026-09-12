-- Asset Finder v3.5.1 mobile contrast/search update
insert into public.app_config (id, latest_version, updated_at) values (1, '3.5.1', now()) on conflict (id) do update set latest_version=excluded.latest_version, updated_at=now();
