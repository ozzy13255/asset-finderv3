# Asset Finder v3.1 — Centralized Online Build

This is the cleaned, cumulative Asset Finder build. The browser application uses Supabase as the authoritative data store for patches, inventories, approvals, removal requests and profiles.

## Included
- Supabase Auth login with persistent browser session and recovery-email password reset
- Owner / Patch Admin / User role isolation enforced by Postgres RLS
- Central patch inventory with periodic refresh
- Asset approvals and removal approvals
- Partial ballast removal (remaining tonnage stays in inventory)
- Patch-wide inventory print / Save PDF report
- Responsive mobile search layout
- Dynamic Add Asset forms for Switch, Crossing, IRJ, Ballast, Rail and Miscellaneous
- User/admin deletion controls with server-side authorization
- Profile, recovery email and password change
- Single account bar with Profile and Log out
- No offline/local inventory database

## Dynamic asset fields
### Switch
SC Number, Point Number, Rail Type, Left Hand / Right Hand / Full Set, Stock Length, Switch Length, Switch Type (Straight cut / Chamfered / Undercut).

### Crossing
SC Number, Point Number, Crossing Type, Rail Weight. Crossing-specific dimension fields are intentionally deferred until the real crossing order form is supplied.

### IRJ
SC Number, Rail Length, Rail Type, IRJ Type.

### Ballast
Amount in tonnes. Partial removals reduce the live quantity and create history/approval records.

### Rail
SC Number, Rail Type, Rail Length, Rail Weight.

### Miscellaneous
Free-text description of the asset.

## Deployment
Vercel Root Directory should be `app`. Keep the Supabase service-role key server-side only; the browser uses the publishable key.
