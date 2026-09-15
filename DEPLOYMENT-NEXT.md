Asset Finder v3.8.2

Responsive mobile layout improvements plus delivery-note/manifest import with asset auto-detection, review-before-inventory workflow, robust grouping of identical manifest assets, one-at-a-time Bearer/Sleeper removal, and improved measurement/unit layout.


Fly tip reporting: users can submit a fly tip against an access point with either What3Words or a map pin, plus a description and optional photos. Admins get a separate Fly Tip Reports queue with New / In Progress / Resolved / Reopen controls.

Database: apply `supabase/migrations/20260915_fly_tip_reports.sql` to the existing Supabase project before using the feature.


## Fly Tip Reporting
Apply `supabase/migrations/20260915_fly_tip_reports.sql` to the existing Supabase database before testing fly tip submissions. It creates the `fly_tip_reports` table, indexes and RLS policies.


## v3.8.2 PWA
The app now includes `app/manifest.webmanifest`, `app/sw.js`, and install icons. Deploy the full `app/` directory over HTTPS. Edge/Chrome should then offer **Install this site as an app**. iPhone/iPad can use Safari → Share → Add to Home Screen.

The service worker caches the local app shell but does not cache Supabase API requests, so live inventory/report changes still require connectivity.
