# Asset Finder v3.0 final deployment

This build removes the obsolete local Data & Backup / Team Cloud Sync controls, keeps one Profile/Log out account bar, persists access points/assets/history centrally to Supabase, improves admin-create-user errors, and adds recovery-email/password-reset support through the Supabase account-recovery Edge Function.

Frontend root: `app`.
Supabase function: `account-recovery`.
