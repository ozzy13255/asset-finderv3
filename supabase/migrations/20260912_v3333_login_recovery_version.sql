update public.app_config set latest_version='3.3.3', updated_at=now() where id=1;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='profiles_login_code_lower_unique') THEN CREATE UNIQUE INDEX profiles_login_code_lower_unique ON public.profiles (lower(login_code)); END IF; END $$;
create or replace function public.sync_profile_login_email() returns trigger language plpgsql set search_path=public as $$ begin if new.login_code is distinct from old.login_code then new.recovery_email := new.login_code; end if; return new; end; $$;
drop trigger if exists sync_profile_login_email on public.profiles;
create trigger sync_profile_login_email before update of login_code on public.profiles for each row execute function public.sync_profile_login_email();
