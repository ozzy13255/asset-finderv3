# Deploy Asset Finder v3.6.2

Replace `/app` and `/supabase` in the existing repository with this build, commit to `main`, and allow Vercel to redeploy.

This build fixes manifest grouping so identical materials on the same order are combined into one asset line, supports removing one Bearer/Sleeper at a time, and places the measurement unit directly beside the measurement field on mobile.

The manifest importer uses PDF.js/Tesseract from public CDNs in the browser. No service-role credentials are embedded in the frontend.
