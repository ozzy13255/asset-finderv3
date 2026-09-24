# Asset Finder v3.13.2

Railway access points and asset register platform.

## v3.13.2
- Corrected Crossing sketch field alignment against the supplied engineering drawing.
- Removed duplicate/misaligned overlay borders by using the sketch's fixed coordinate system.
- Crossing sketch fields remain editable and optional.
- Removed fixed `mm` unit labels from the Crossing sketch; users may enter their preferred unit.
- Removed the temporary Switch technical sketch.
- Restored Stock Length and Switch Length for Switch assets without a fixed unit label.
- Cleaned unused legacy sketch/source assets from the deployment package.
- Updated PWA/service-worker versioning to v3.13.2.

## v3.13.1
- Removed the temporary Switch technical sketch from the Add/Edit Asset form and asset preview.
- Restored Stock Length and Switch Length fields for Switch assets.
- Corrected Crossing sketch board sizing so editable boxes align with the supplied diagram.

## v3.10.0
- Added automatic submission and approval attribution for new assets.
- Pending asset approvals show the submitter.
- Approved asset cards show Submitted by and Approved by with date/time.
- Fly Tip and Scrap reports show submitter/handler attribution.
- Existing Asset Finder PWA, live refresh, OCR/manifest import, bearer/sleeper grouping and reporting features retained.

## Deployment
Deploy the contents of this package to the existing Vercel project. Keep the existing Supabase URL and anon key configuration.
