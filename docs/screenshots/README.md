# Product screenshot capture

Product screenshots must come from the running product. The historical 7.0.0
console image must not be relabeled as 10.0.0. A rendered UI with example data is
acceptable when the caption and provenance explicitly identify that data; it is
not evidence that a live tunnel or remote session worked.

## Reproducible 10.0.0 Web captures

The capture helper uses the **unchanged release UI** from
[Home Tunnel Server v10.0.0](https://github.com/ZHanry/home-tunnel-server/tree/9e5b4ff4e6381a42317c94618d1805b7398c558e),
with the server repository's own loopback-only UI-preview fixture. It checks the
source revision before capturing. It does not connect to a production server or
publish a service.

### GitHub Actions

[Product screenshot capture](../../.github/workflows/product-screenshots.yml)
runs on pull requests that change the capture workflow/helper and can be started
manually after the workflow is available on the default branch. It uses a
read-only GitHub token, no custom secrets, and an Ubuntu runner. The job installs
only the locked control-center dependencies and Chromium headless shell, then
uploads the three PNGs and their manifest as a 14-day Actions artifact.

The workflow does not update repository files, create releases, publish the
documentation site, connect to real devices, or complete a remote session.
Download the artifact from the successful run and complete the review below
before copying images into documentation. The manifest records the exact
capture-script, preview-fixture and lockfile hashes, source revision, browser,
workflow commit and run, and image dimensions and hashes.

### Local capture

In an environment that permits a local browser to access the preview:

```sh
git clone https://github.com/ZHanry/home-tunnel-server.git ../home-tunnel-server
git -C ../home-tunnel-server checkout 9e5b4ff4e6381a42317c94618d1805b7398c558e
pnpm --dir ../home-tunnel-server/control-center install --frozen-lockfile
# Use the supported Playwright browser installation, or point the variable below
# to an existing Chromium/Chrome/Edge executable.
PLAYWRIGHT_CHROME_EXECUTABLE=/path/to/chromium \
  node docs/screenshots/capture-product.mjs ../home-tunnel-server ./product-captures-v10
```

Node 24.19.0 and the server's locked Playwright dependency are used. Install a
Chinese-capable font before capture. Do not disable browser or network security
policies to make the preview reachable; use a permitted development environment.

Expected output:

- `admin-console.png`: current Web console with the first-party example data
- `tunnel-wizard.png`: current publishing wizard, device/template step
- `remote-entry.png`: current Web remote entry with no configured remote hosts
- `manifest.json`: exact source, browser, capture date, fixture scope, file sizes,
  and SHA-256 hashes

The empty remote fixture only exposes the product's existing empty state. It
must not be described as a Windows remote window or active remote session.
The helper does not alter the UI source, paint over images, synthesize a desktop,
or submit the wizard's final publish step.

## Review and integration

1. Open every resulting image and confirm readable Chinese text, complete
   controls, no loading/error view, and no real user data or credentials.
2. Preserve `manifest.json` with the published captures; compare each SHA-256
   with its image after copying.
3. Put the wizard capture at the exact `replacement_file` in
   [screenshot-slots.json](../site/screenshot-slots.json). Only then mark the slot
   captured and replace its placeholder with an image and a caption identifying
   version, platform, and example data.
4. Add separate slots for the current console and disconnected remote entry.
   Preserve the historical figure and its 7.0.0 label.
5. Update both Chinese and English landing/preview pages and README links.
   Explicitly allow only the new reviewed assets in the site policy checker.
6. Run `python3 scripts/check-site-policy.py` and the repository checks.

## Windows remote-window capture

`assets/v10/remote-window.png` is reserved for a real Windows remote-window
capture. It needs a permitted Windows environment and an authorized test host.
Record client/server revisions, capture date, state, dimensions, and digest.
Do not substitute the empty Web entry, a historical image, or a generated mockup.
A screenshot alone does not establish keyboard, clipboard, audio, file-transfer,
secure-desktop, or long-duration acceptance.
