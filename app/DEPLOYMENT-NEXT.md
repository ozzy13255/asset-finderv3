# Asset Finder v3.0 — deployment

## GitHub
Repository: `ozzy13255/asset-finder-v3`

## Vercel
- Application Preset: Other
- Root Directory: `app`
- No build command required for the static app.

## Supabase
Project ID: `qajpyjdeozydtzdcxhqd`

Required Edge Functions:
- `admin-create-user`
- `admin-delete-user`
- `account-recovery`
- `bootstrap-owner`

## Important
The `app/index.html` in v3.0 contains no browser localStorage/sessionStorage code. Application records are loaded from and written to Supabase only.
