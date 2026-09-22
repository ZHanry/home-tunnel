# Home Tunnel 8.0 implementation and verification

Status: development. The latest stable release remains 7.0.0. This document is
not evidence that remote desktop works on a particular platform.

## Accepted scope

The 8.0 release integrates Web, desktop and Android controllers with Windows,
macOS, X11 and GNOME/KDE Wayland hosts. The scope includes four concurrent desktop
controller windows (including browser windows), monitor selection, physical keys and Unicode text, system
audio, microphone forwarding into an installed virtual input device, opt-in text
clipboard, and selected-file transfers. H.264/VP8 are the interoperability
baseline; AV1/HEVC require negotiated and verified backend support.

All remote desktop payloads use authenticated direct UDP WebRTC. The server
provides account management, authorization, signaling and STUN address discovery;
it does not forward media, input, clipboard or files. Networks without a direct
path fail within the bounded connection deadline.

Each capability has a separate grant and visible switch. Input requires focus;
clipboard and microphone forwarding each bind to one explicitly selected session.
Android microphone capture and clipboard access stop in the background. Receiving
files requires an explicit destination; files are never automatically opened.

Windows virtual microphone support requires a product audio driver and Microsoft
driver signing. macOS uses an AudioServerPlugIn installed with administrator
consent. Linux uses a PipeWire user-session virtual source. The installer must
report missing prerequisites without claiming successful microphone injection.

## Compatibility and safety

- Existing HTTP/HTTPS/TCP/UDP tunnels and RDP presets retain their existing meaning.
- A host accepts one remote session. A controller and account default to four.
  Pending and closing sessions count until safely released. An endpoint cannot
  simultaneously host and control remote sessions.
- Capture, input and all new data features require local host consent. Account
  ownership and administrator privileges do not replace that consent.
- New API contract 1.2 is additive to API major 1. RD wire protocol and native ABI
  have independent versions. Contract tags, source revisions and artifact hashes
  are recorded separately.
- Releases preserve Android's application ID and signing certificate. Every
  published RC and stable build has a strictly increasing versionCode.
- Rollback first disables RD. Database restoration invalidates old RD credentials
  and sessions with a new restore epoch; local grant revocations remain binding.

## Verification gates

1. Reproduce the existing suite with pinned tools; distinguish baseline failures.
2. Build the pinned native dependencies and demonstrate a real Windows/browser
   direct session before treating platform integration as complete.
3. Exercise authorization, replay protection, transaction failure, quotas,
   revocation, path changes, epochs and the two-second input watchdog.
4. Verify the original 68 acceptance cases and the added audio, microphone,
   clipboard, transfer, multiwindow and codec cases.
5. Record real results for the eight controller types by five host environments,
   hardware/driver variants, real networks, two-hour active and 24-hour online runs.
6. Verify the exact installable artifacts, recovery, upgrade, signatures, SBOM,
   provenance, checksums and public download links.

An unrun check is **not verified**, never passed. Hosted runners, software video
fixtures and emulators do not prove physical GPU, TCC, Portal, driver, microphone,
touch or real-NAT behavior. A failed safety check blocks release. Missing physical
evidence limits a candidate's declared support and blocks the final stable release.

## Publication

Development uses `codex/8.0.0-remote-desktop` branches in the four original
repositories. Candidate tags use `v8.0.0-rc.N` and GitHub prerelease status, with
`latest=false`. The stable 7.0 manifest and default downloads remain intact until
8.0 passes its final gates. Candidate manifests must contain actual immutable
revisions, download URLs and checksums, with passed/failed/not-verified reports.

The publication order is the frozen candidate contract, desktop/native core,
Android consuming that core, server integration against the actual client artifact,
then the hub candidate manifest. A rebuilt artifact requires new verification.
Publishing a stable 8.0.0 release additionally requires physical-platform and
network evidence and the signing prerequisites for included drivers.

Excluded: Android hosting, login/UAC secure desktops, cross-account sharing,
image clipboard and recursive directory transfer. Deployment tests use isolated
environments.

The current implementation ledger is [SCOPE.md](SCOPE.md). The original 68
acceptance cases and 12 additions are recorded in [ACCEPTANCE.md](ACCEPTANCE.md)
and [acceptance.json](acceptance.json); every full platform acceptance remains
unverified until its actual evidence is recorded.
