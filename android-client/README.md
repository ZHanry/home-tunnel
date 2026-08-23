# Home Tunnel Android Client

The Android client is an **Experimental** foreground-service client for Home
Tunnel 3.2.0. It supports Android 8.0 (API 26) and newer. The first public APK
targets `arm64-v8a`; the build scripts can also produce an `x86_64` Agent for
emulator and compatibility testing.

The immutable Android application ID is:

```text
io.github.zhanry.hometunnel
```

## Current scope

The app implements secure HTTPS server discovery, user login and required
password change, Android device enrollment, Android Keystore-backed encrypted
device state, device login after process restart, connection management, a
foreground tunnel service, realtime configuration notifications, a three-minute
safety sync, 30-second heartbeat reports, lease expiry shutdown, and managed
Agent verification/rollback.

This Experimental release intentionally advertises only:

```json
{"supported_proxy_types":["http"]}
```

Administrator-assigned TCP and UDP records can be viewed and their local target
or enabled flag can be edited, but the Android Experimental client will not run
them. Unknown proxy types are always read-only and fail closed.

An active tunnel requires a persistent foreground-service notification. Android
Doze, force-stop, device-vendor battery management, network changes, and system
updates may interrupt long-running tunnels. This client is not equivalent to a
Linux systemd service and does not use Android `VpnService`. After Android kills
the application process, the user must explicitly start the tunnel again; the
service never resurrects a reverse tunnel from a sticky null-intent restart.

## Build requirements

- JDK 17
- Android SDK platform 35 and Build Tools 35
- Go 1.26.6
- Android NDK 27.2.12479018 for the `x86_64` Agent

Build the restricted Agent before assembling an installable APK. The scripts
download the exact FRP 0.70.1 source commit, verify the committed archive
SHA-256, copy the shared `windows-agent/main.go` restriction surface into that
pinned tree, and produce Android PIE executables under the APK native-library
directories.

Linux/macOS build host:

```sh
# Public release ABI
ANDROID_AGENT_ABIS=arm64-v8a ./scripts/build-agent.sh

# Development/test ABIs (x86_64 requires the pinned NDK)
ANDROID_AGENT_ABIS=arm64-v8a,x86_64 \
ANDROID_NDK_ROOT=/opt/android-sdk/ndk/27.2.12479018 \
./scripts/build-agent.sh
```

Windows build host:

```powershell
$env:ANDROID_AGENT_ABIS = "arm64-v8a,x86_64"
$env:ANDROID_NDK_ROOT = "$env:ANDROID_SDK_ROOT\ndk\27.2.12479018"
.\scripts\build-agent.ps1
```

Each successful ABI build emits machine-readable `ANDROID_AGENT_ABI`,
`ANDROID_AGENT_SHA256`, and `ANDROID_AGENT_PATH` lines. Outputs are fixed at:

```text
app/src/main/jniLibs/arm64-v8a/libhometunnel_agent.so
app/src/main/jniLibs/x86_64/libhometunnel_agent.so
```

Those native binaries are generated inputs and must never be committed.

Run the normal checks and packages:

```sh
./gradlew test lint assembleRelease bundleRelease
```

Gradle uses `HOME_TUNNEL_VERSION_NAME` and `HOME_TUNNEL_VERSION_CODE` from
`gradle.properties`. Release signing reads these environment variables (or the
matching `android.release.*` Gradle properties):

```text
ANDROID_RELEASE_STORE_FILE
ANDROID_RELEASE_STORE_PASSWORD
ANDROID_RELEASE_KEY_ALIAS
ANDROID_RELEASE_KEY_PASSWORD
```

When any value is absent, the release variant remains unsigned. The build never
falls back to the debug key or creates an ephemeral release identity.

## Release assets and signing identity

Public 3.2.0 assets are named:

```text
HomeTunnel-Android-3.2.0-arm64-v8a.apk
HomeTunnel-Android-3.2.0.aab
```

The APK is the GitHub Releases side-load artifact. The AAB is an audit/store
upload artifact: it cannot be installed directly and the presence of an AAB in
GitHub Releases does **not** mean this Experimental build is Play-ready or has
been published to Google Play.

The long-lived official Android release certificate SHA-256 is:

```text
d7779e338be1039acee6dda9a43417cbf2baf4b0c9995578d9708501e95af702
```

It is also recorded in `release-signing-cert.sha256`. Before installing a
GitHub APK, compare the certificate reported by Android Build Tools:

```sh
apksigner verify --verbose --print-certs HomeTunnel-Android-3.2.0-arm64-v8a.apk
```

The `Signer #1 certificate SHA-256 digest` must match the value above. Also
verify the adjacent artifact checksum or the aggregate `SHA256SUMS.txt` and its
Sigstore evidence from the same GitHub Release.

## Security notes

- Passwords and access/refresh tokens remain in memory only.
- The permanent device credential and cached state are encrypted with an
  Android Keystore AES-256-GCM key and stored under `noBackupFilesDir`.
- Android backup and device-to-device transfer are disabled for application
  data so a device credential cannot be cloned onto another phone.
- Server discovery rejects cleartext HTTP, subpaths, user-info, redirects,
  origin changes, oversized responses, malformed tunnel domains, and missing
  or invalid FRPS trust material. Android intentionally refuses compatibility
  deployments that do not publish the managed FRPS certificate.
- Refresh rotation uses a single-flight mutex. Concurrent 401 responses cannot
  replay an already-rotated refresh token and revoke the session family.
- The managed Agent runs only from Android's read-only `nativeLibraryDir`; it is
  never copied into and executed from a writable app directory.
- Pending configurations are verified by the same restricted Agent used by the
  desktop clients before replacing the last-known-good configuration.
- FRP's Apache-2.0 license and third-party notice are copied from the shared
  pinned Agent source into every Android package during `preBuild`.

The Gradle and emulator tests do not represent physical-device validation.
Before raising the Android support level above Experimental, exercise a signed
RC APK on physical arm64 devices, including screen-off, Doze, foreground
notification denial, network transitions, process death, server revocation,
lease expiry, upgrade, and vendor battery-management cases.
