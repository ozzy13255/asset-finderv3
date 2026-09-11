# Asset Finder v3.3.3

Centralised railway asset management application. Inventory, approvals, removals and patch data are stored in Supabase. Authentication sessions are persisted only for secure sign-in continuity; inventory is not stored locally.

## v3.3.3
- Automatic auth-token refresh and retry for Supabase requests.
- Password-reset flow with secure recovery link and new-password screen.
- Mobile header collapses while scrolling down and returns when scrolling up.
- Live approval/removal counters and sync/version status retained.
