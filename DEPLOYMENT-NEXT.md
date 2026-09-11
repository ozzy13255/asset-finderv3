# Asset Finder v3.3.5 deployment

1. Replace the contents of the `asset-finder-v3` repository with `app/`, `supabase/`, `DEPLOYMENT-NEXT.md`, and `README.md` from this package.
2. Commit as `Fix iPhone layout and login recovery`.
3. Push to `main` and let Vercel deploy the production build.
4. The production Supabase version registry is already set to `3.3.5`.

Key fixes: iPhone header/status compaction, scroll-away header, robust email resolution on sign-in, direct Supabase Auth password recovery with Edge Function fallback, refreshed session handling, and preserved central inventory/approvals functionality.
