# 10.0.0 product screenshots

这些是实际产品界面的原始 PNG 截图，已逐张检查，未重绘或编辑图片。
Web 使用本地示例数据；Android 使用模拟器 debug 测试数据。
界面截图不表示生产服务、真实远控会话或最终发行产物已通过验收。

These are original, visually reviewed PNG captures of the actual product UI.
No image has been generated, repainted, cropped or relabeled from an older version.

## Server / Web

- Source: [unchanged v10.0.0 release](https://github.com/ZHanry/home-tunnel-server/tree/9e5b4ff4e6381a42317c94618d1805b7398c558e)
- Captured: 2026-09-30, Chromium 145.0.7632.6 on Ubuntu, Chinese UI, light theme
- [Successful capture run](https://github.com/ZHanry/home-tunnel/actions/runs/36655463870)
- Artifact: `11072925181`, SHA-256 `39396a856677ade79a4f4e0ed807281a2f870e23def1a8e8a2d42030cc8433ff`
- [Original capture manifest](web-capture-manifest.json): source, fixture, lockfile, capture-script and PNG hashes
- [Capture helper and reproduction](../../../screenshots/README.md)

`admin-console.png` and `tunnel-wizard.png` use the release's own UI-preview
fixture. Counts, status, names and traffic are example data, not measurements of
a running deployment. The wizard was not submitted to publish a service.
`remote-entry.png` shows the actual empty remote-device state supplied with an
enabled capability and empty endpoint fixture. It is disconnected and does not
show a Windows window or a remote video stream.

The original manifest says `captured-awaiting-visual-review` because it was
written by the capture job. All three images were subsequently visually reviewed
on 2026-09-30; that original provenance file remains unchanged.

## Android

- [Successful API 35 capture run](https://github.com/ZHanry/home-tunnel-android/actions/runs/36653765208)
- Artifact: `android-runtime-api-35`, ID `11070704569`
- Actual clean CI merge source: `d84682d706a467b4a09741fd75afa62b340e5399`
- PR source: `e333d8734e8988d4155ad3de1ab9d4deed2ecfe8`
- Environment: API 35 x86_64 emulator, debug build, English UI, light theme
- Fixture: `ManagementUiTest.navigationFiltersByDeviceAndSearchesServices`
- [Original Android provenance](android-capture-manifest.json): APK, source and original PNG hashes

`android-overview.png` is the original artifact's `screenshots/overview.png`;
`android-devices.png` is `screenshots/devices.png`. Both remain 1080 × 2400 with
identical hashes. They show the current remote-control entry and device list with
synthetic accounts and devices. Instrumentation reported 21 passed, 0 failed and
2 skipped tests. This is not final signed-APK, physical-device, remote-media or
full-app acceptance, and it does not change the published owner waivers.

## Still awaiting capture

The Windows remote-window slot remains empty until a real, authorized Windows
capture is available. The historical 7.0.0 console remains separately labeled on
the site; it has not been relabeled as 10.0.0.
