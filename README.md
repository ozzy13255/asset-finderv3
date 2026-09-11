# Asset Finder v3.0

Online, centrally managed Asset Finder application.

## Runtime architecture
- Supabase is the authoritative database for patches, inventories, profiles, approvals and removal requests.
- The browser does not use localStorage/sessionStorage for application data.
- Inventory changes are written directly to the central `patch_inventories` table.
- The UI refreshes central data automatically every 5 seconds and after every mutation.
- Normal users cannot write inventory directly; new assets and removals are submitted for approval.
- Owner and Patch Admin permissions are enforced both in the UI and by Supabase RLS / Edge Functions.
- Login uses the account's current Supabase Auth email resolved from the immutable login code.
