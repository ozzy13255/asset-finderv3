# Asset Finder v3.9.0 — Deployment

## Deploy

Upload/deploy the contents of `app/` to the existing Asset Finder site over HTTPS.

## Supabase

Keep the complete `supabase/migrations/` history. Apply only migrations that are not already recorded as applied in the target Supabase project.

The live database should contain the `public.fly_tip_reports` table and its RLS policies. The permanent-delete policy must also be present so authorised patch admins/owners can complete and delete Fly Tip reports.

## PWA

`app/manifest.webmanifest` and `app/sw.js` make Asset Finder installable as an app on Microsoft Edge, Chrome, Android and iPhone/iPad.

The header **↻ Refresh** button refreshes live Supabase data and checks for a newer PWA version. The service worker handles application-shell updates.

## Important

Supabase data is deliberately not cached by the service worker. Offline mode is limited to the application shell; live inventory, approvals, removals and Fly Tip operations still require connectivity.
