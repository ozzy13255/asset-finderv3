# Deploy Asset Finder v3.6.1

Replace `/app` and `/supabase` in the existing repository with this build, commit to `main`, and allow Vercel to redeploy.

Commit: `Add manifest importer and refine mobile layout`

The manifest importer uses PDF.js/Tesseract from public CDNs in the browser. No service-role credentials are embedded in the frontend.
