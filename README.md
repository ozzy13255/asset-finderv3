Asset Finder v3.8.2

Responsive mobile layout improvements plus delivery-note/manifest import with asset auto-detection, review-before-inventory workflow, robust grouping of identical manifest assets, one-at-a-time Bearer/Sleeper removal, and improved measurement/unit layout.


Fly tip reporting: users can submit a fly tip against an access point with either What3Words or a map pin, plus a description and optional photos. Admins get a separate Fly Tip Reports queue with New / In Progress / Resolved / Reopen controls.

Database: apply `supabase/migrations/20260915_fly_tip_reports.sql` to the existing Supabase project before using the feature.


## v3.8.2 — PWA installation
- Added a standards-based web app manifest with install metadata and 192px/512px icons.
- Added a service worker and app-shell caching so Edge/Chrome/Android can install Asset Finder as an app and the shell can reopen offline.
- Added iPhone/iPad web-app metadata and Apple touch icon support.
- Live Supabase API requests are deliberately not cached; inventory and report operations still require an internet connection.
