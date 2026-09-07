# Home Tunnel 5.0 experience validation

This release addresses the UI and interaction audit against 4.0.0. The table maps the findings to shipped changes and regression coverage. Browser tests execute the real web resources using local fixtures; service tests use an isolated SQLite database. Platform build and release evidence is produced by CI.

| Finding | Change | Verification |
| --- | --- | --- |
| F01 | Numeric steps accept integers and decimals | Browser bandwidth save and service policy tests |
| F02 | Canonical module imports prevent duplicate handlers | Theme and locale click plus reload |
| F03 | Background refresh preserves drafts and focus | Config event during audit input |
| F04 | Typed session errors restore the login flow | Expired resource and refresh responses |
| F05 | Settings show busy, failure and retry states | Delayed failed write, single request |
| F06 | Android editor closes only after a successful write | Repository callback and platform build |
| F07 | Health labels follow status, not the presence of latency | Unknown backup and degraded queue |
| F08 | Availability uses the authorized owner and excludes self | Real owner, conflict and prefix contracts |
| F09 | Domain removal requires confirmation; raw timing is explicit | Two-step removal and cancellation |
| F10 | Empty owner device selections clear and disable submission | Owner with no device fixture |
| F11 | Responsive cards replace overflowing connection tables | 375, 768, 1024, 1280, 1440 widths |
| F12 | Public home and console navigation have working destinations | Anonymous home and return link |
| F13 | Protected fields are grouped; non-secret drafts and inline errors are retained | Draft reopening and invalid form response |
| F14 | Connection diagnostics explain device and application stages | Details and protocol fixtures |
| F15 | Foreground refresh, reconnect and stale indicators | Browser events, platform lifecycle and local API |
| F16 | Desktop forms support Enter, busy state and guided password change | Real desktop web resources in browser tests |
| F17 | Drawer focus is contained; labels and theme contrast corrected | Keyboard navigation and desktop semantics |
| F18 | Resource names are excluded from system translation | Resource named with a translated status word |
| F19 | Raw forms bind only applicable fields and show correct protocols | Standard-user TCP edit |
| F20 | Account password and monthly usage are visible | Account browser and service contracts |
| F21 | Stable pagination and search replace the 250-item cutoff | 251-connection database fixture |
| F22 | Version conflict recovery preserves edit intent | Conflict, explicit latest-version load and retry |
| F23 | Preview supports both roles, settings and errors; docs follow the management app | Preview routes and documentation checks |
| F24 | Forms/connections modules and browser/desktop lint join the CI gate | Lint, browser, service, Go, Android and workflow checks |

## Release verification

CI retains the service coverage gates, Go tests and analysis, Android tests/lint, CodeQL, secret scanning, static site checks and dependency review. RC builds publish immutable image digests and signed artifact manifests. Stable promotes the exact accepted RC. Android keeps its persistent signing certificate and does not embed a tunnel Agent. Windows packages are Go binaries; Sigstore evidence does not imply Windows Authenticode trust.

Physical-device checks and production-path smoke are distinct: browser fixtures cannot prove a real tunnel or certify all device accessibility. Read the published release smoke and platform evidence for the exact tested scope.
