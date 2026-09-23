# Asset Finder v3.10.1

Railway access points and asset register platform.

## v3.10.1
- Added automatic submission and approval attribution for new assets.
- Pending approval cards now show the requested quantity for ballast, bearers, sleepers and other quantity-based assets.
- Pending asset approvals show the submitter.
- Approved asset cards show Submitted by and Approved by with date/time.
- Fly Tip and Scrap reports show submitter/handler attribution.
- Existing Asset Finder PWA, live refresh, OCR/manifest import, bearer/sleeper grouping and reporting features retained.

## Deployment
Deploy the contents of this ZIP to the existing Vercel project. The Supabase migration `20260915_v310_audit_attribution.sql` has already been applied to the connected database.
