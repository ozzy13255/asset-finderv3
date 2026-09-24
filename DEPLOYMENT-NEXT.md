# Asset Finder v3.13.2 — deployment notes

- Crossing sketch input overlays are aligned to the supplied technical drawing using the same fixed 1060×442 coordinate system.
- Crossing sketch inputs no longer display or enforce `mm`; units are user-defined.
- Switch technical sketch has been removed from the Add/Edit Asset workflow.
- Switch assets retain Stock Length and Switch Length fields without a fixed unit in the label.
- Crossing sketch remains optional.
- PWA/service-worker cache version is v3.13.2.

Deploy the contents of this package to the existing Vercel project. Keep the existing Supabase configuration.
