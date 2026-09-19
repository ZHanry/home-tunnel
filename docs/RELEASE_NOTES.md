# Home Tunnel 7.0.0

All first-party components and the managed Agent now use 7.0.0. Upgrade the server,
desktop/CLI and Android together; FRP remains at its independent 0.70.1 version.

- Fix Web multi-tab refresh, stale access-policy writes and persistent backup health.
- Reject unverified/incomplete desktop updates and use stable semantic versions.
- Add full REST OpenAPI/JSON Schema and capability-driven Android transport controls.
- Add TOTP/recovery codes, session management and single-use enrollment codes.
- Add OS credential protection, redacted diagnostics and host-only admin recovery.
- Add encrypted off-host backup, verified fresh-volume restore, preflight/NAS
  templates, monitoring and alert rules.
- Add encrypted Android server profiles, tags/favorites and per-item batch operations.
- Publish checksums, SBOMs, provenance and verification evidence as durable assets.

Windows/macOS have no publisher certificates configured and are explicitly unsigned;
their signing/notarization workflow is ready. Android retains its release signing
identity. Read the migration and platform-security guides before upgrading.
