# Asset Finder — Online foundation

This package is based on the supplied **Asset Finder v2.7.5 Patches** build.

## Security model

- **Owner**: can see and manage every patch, every user and every inventory.
- **Patch admin**: can only see/manage the patch(es) assigned to them. They cannot query another patch through the API/database.
- **User**: can only access the patch assigned to them.
- Employee name, employee number, login code and role are server-controlled. Users can change their password only.
- New accounts start with a temporary password and `must_change_password=true`.
- First login forces a password change.

## Important

The supplied app is still an offline-first v2.7.5 application. This package adds the online authentication/security foundation and cloud inventory bridge, but it is **not production-hosted yet** because it needs your own Supabase project and deployment credentials. Do not put the Supabase service-role key in the browser.

## Setup

1. Create a Supabase project.
2. Run `supabase/schema.sql` in the SQL editor.
3. Deploy the two Edge Functions under `supabase/functions/`.
4. Set the Edge Function secret `BOOTSTRAP_SECRET` before running `bootstrap-owner` once.
5. Create the owner account with `bootstrap-owner`.
6. Put the project's URL and **anon/public key** into `window.ASSET_FINDER_CLOUD` in `app/index.html` and set `enabled: true`.
7. Host the `app/` directory on HTTPS hosting.

### Account creation flow

Owner creates patch admins/users. A patch admin can create users only inside their assigned patch. The temporary password is never stored in `profiles`; Supabase Auth stores the password securely. The profile stores only the immutable employee identity and role plus the `must_change_password` flag.

### Patch isolation

Inventory is stored one row per patch. Row Level Security policies call `can_access_patch(patch_id)`. This means the separation is enforced by Postgres, not merely by hiding buttons in the UI.

## Next production step

The next implementation pass should move all existing inventory CRUD operations from the browser's local `db` object to authenticated cloud operations and add the Owner/Patch Admin user-management screens. The current bridge is deliberately conservative so the original v2.7.5 UI remains intact while the authentication foundation is established.


## Online configuration
The browser client uses the Supabase publishable key. Do not place the Supabase service-role key in this repository or any browser code.


UI update: added a persistent Log out button to the authenticated application header.
