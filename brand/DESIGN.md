# NestLink 14.0.0 product design

The desktop baseline uses the supplied UU Remote image as a layout reference: a quiet left navigation and a grouped, full-width device list. NestLink keeps its own purple identity and existing account, remote approval and tunnel behavior.

## Tokens

| Role | Color |
| --- | --- |
| Eggplant purple / primary actions | `#7955CF` |
| Purple text / selected navigation | `#6842BB` |
| Pale lavender / navigation chrome | `#F2EFF9` |
| Canvas | `#FAF9FD` |
| Content | `#FFFFFF` |
| Text | `#282235` |

Use the existing system UI fonts. Titles are 24 px, device names 14 px, secondary information 12–13 px. Left-align names, groups and headings. Device rows have 8 px corners and no shadows; the list remains readable at narrow widths and larger text sizes.

```text
 [linked N] NestLink                      language / theme / version / window controls
 Device management  | All devices                                      Search devices
 Remote assistance  | Computers 2
 Tunnels            | [PC] This computer    local                                 info
                    | [PC] Another computer  online                    connect / info
                    | Phones / tablets 1
                    | [phone] Device name  offline                               info
                    |
 Account and settings |
```

The linked N is the only expressive brand element. Its two rounded brackets and joining stroke suggest devices being linked. A single SVG source exports the Windows executable, tray and installer icons, Flutter assets, Android launcher and monochrome notification icons, and Web branding. Large blue dashboards, repeated metric cards and decorative gradients have been removed from the desktop home.

Windows/Linux, the Web server and Android share the 14.0.0 product identity and action names. Web adapts the grouped device directory to a browser workspace; Android uses touch-sized navigation and controls. The underlying account, approval, revocation and tunnel boundaries remain intact. Release builds require version-specific installation and integration evidence, exact payload hashes and signed build provenance.

Run `packaging/windows/install-local-clean.ps1` before every local installation; it backs up and removes the prior install and configuration before running the installer. Local installation and published installer upgrade acceptance are recorded separately.
