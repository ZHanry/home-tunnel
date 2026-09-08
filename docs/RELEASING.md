# Release ownership

Each code repository owns its release workflow and version. See the release runbooks for
[server](https://github.com/ZHanry/home-tunnel-server/blob/main/docs/RELEASING.md),
[client](https://github.com/ZHanry/home-tunnel-client/blob/main/docs/RELEASING.md), and
[Android](https://github.com/ZHanry/home-tunnel-android/blob/main/docs/RELEASING.md).

This hub preserves historical releases and provides a manually dispatched stable-client
mirror for the legacy updater. It verifies the upstream client's signed checksum manifest,
copies the exact accepted artifacts, preserves legacy fixed-filename downloads, and signs
the combined mirror manifest. It never rebuilds or replaces an existing release.
