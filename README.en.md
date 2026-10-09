# nestlink

[中文](README.md) · [Website](https://zhanry.github.io/home-tunnel/en/) · [Release scope](docs/HOMEDESK_RELEASE.md)

Manage devices, control a remote desktop directly, and keep local services accessible through your own server. **13.0.0 is the stable release target**; implementation and acceptance are in progress.

| Platform | Role | Package |
| --- | --- | --- |
| Web / Server | Management and in-browser remote control | Deployment archive and amd64/arm64 images |
| Windows x64 | Controller, host and tunnel hub | GUI installer |
| Linux x64 / ARM64 | Controller, host and tunnel hub | Two GUI DEBs |
| Android ARM64 / x86_64 | Management and remote control | One universal APK |

One English identity, icon and blue workspace across platforms. Sign in to your self-hosted service; connection settings are retrieved automatically. Device-ID assistance can cross accounts on the same server and still requires host approval or a remote password. Remote media is encrypted direct P2P; failed direct connections end without a relay fallback.

HTTP/HTTPS, governed TCP/UDP, port pools, authorization, access control, traffic governance and diagnostics remain. Windows/Linux clients own tunnel execution, independently of remote sessions. Standalone CLI/NAS products and macOS GUI packages are removed from the release scope.

Client releases contain a Windows installer, two Linux DEBs, materials and checksums. Android retains its application ID and original release certificate. Windows currently has no Authenticode publisher signature. Sources, licenses, exact binary hashes and build/integration evidence accompany the release. Historical releases remain in GitHub history; current pages show only current UI. Production deployment upgrades are separate.
