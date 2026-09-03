# Home Tunnel Android Client

The Android app is a **management client**. Sign in with the control-center
URL, username, and password to view your home devices and HTTP tunnels, copy
public addresses, and change connection settings. Tunnels run on Windows,
macOS, or Linux machines at home; this app does not start the managed Agent.

It supports Android 8.0 (API 26) and newer. The first public APK targets
`arm64-v8a`.

The immutable Android application ID is:

```text
io.github.zhanry.hometunnel
```

## Current scope

The app signs in with `client_type=mobile`, lists the account's home devices and
HTTP connections, and can create, edit, pause, or delete tunnels that run on
those devices. It does not enroll the phone as a tunnel endpoint and does not
package or start a managed Agent.

## Build requirements

- JDK 17
- Android SDK platform 35 and Build Tools 35

```sh
./gradlew --no-daemon test lint assembleDebug
```

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
The Gradle and emulator tests do not represent physical-device validation.
Before raising the Android support level above Experimental, exercise a signed
RC APK on physical arm64 devices, including offline sign-in, token refresh,
screen rotation, process death, and upgrade while keeping the same application
ID and release certificate.
