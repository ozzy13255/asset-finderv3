# Asset Finder v3.13.1

Railway access points and asset register platform.

## v3.13.1
- Finalised the supplied Switch and Crossing engineering sketches in the Add Asset workflow.
- Crossing sketch is optional; every visible sketch entry box is editable.
- Crossing sketch is also shown beneath the asset when saved, alongside asset photos.
- Updated PWA/service-worker versioning for the new build.

## v3.10.0
- Added automatic submission and approval attribution for new assets.
- Pending asset approvals show the submitter.
- Approved asset cards show Submitted by and Approved by with date/time.
- Fly Tip and Scrap reports show submitter/handler attribution.
- Existing Asset Finder PWA, live refresh, OCR/manifest import, bearer/sleeper grouping and reporting features retained.

## Deployment
Deploy the contents of this ZIP to the existing Vercel project. The Supabase migration `20260915_v310_audit_attribution.sql` has already been applied to the connected database.


## v3.13.1
- Removed the temporary Switch technical sketch from the Add/Edit Asset form and asset preview.
- Restored Stock Length and Switch Length fields for Switch assets.
- Corrected Crossing sketch board sizing so editable boxes align with the supplied diagram.
