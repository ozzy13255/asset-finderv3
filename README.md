# Asset Finder v3.9.0

Railway access points and asset register platform for OGRT.

## Current features

- Access-point and asset register
- SC number, points, asset and location search
- Delivery-note / manifest import with OCR-assisted asset detection
- Review-before-inventory workflow
- Automatic grouping of identical manifest assets
- One-at-a-time Bearer and Sleeper removal
- Asset approval and removal request workflows
- Fly Tip reporting with access point, What3Words or map pin, description and photos
- Admin Fly Tip workflow with **New** and **In Progress** sections
- **Complete and Delete** permanently removes completed Fly Tip reports
- Live header refresh button
- Installable PWA for Edge, Chrome, Android and iPhone/iPad
- PWA service-worker update handling
- Responsive desktop and mobile UI
- Improved text contrast and admin form readability

## Deployment

Deploy the complete `app/` directory over HTTPS.

For an existing Supabase project, apply any migrations in `supabase/migrations/` that have not already been applied. The Fly Tip feature requires `20260915_fly_tip_reports.sql`; permanent Fly Tip deletion uses the later Fly Tip deletion migration.

## PWA

The app includes:

- `app/manifest.webmanifest`
- `app/sw.js`
- 192px and 512px install icons
- iPhone/iPad web-app metadata

Supabase API requests are not cached, so live inventory and report operations require an internet connection.

## Version

**3.9.0** — scrap reporting added alongside fly-tip reporting, with live admin queue management.
