# NestLink 12 候选下载

Server 12.0.0-RC1；Client / Android 12.0.0-RC1。候选远控要求认证加密 P2P，失败终止，完整内网穿透保留。跨网与真机验收尚未完成，Windows 未 Authenticode 签名。构建与发布检查完成后，本节由实际 Release 校验结果生成附件表；不要将旧稳定包误认为新的原生 NestLink。

[Server 候选发布](https://github.com/ZHanry/home-tunnel-server/releases/tag/v12.0.0-RC1) · [Windows / CLI 候选发布](https://github.com/ZHanry/home-tunnel-client/releases/tag/v12.0.0-RC1) · [Android 候选发布](https://github.com/ZHanry/home-tunnel-android/releases/tag/v12.0.0-RC1)

<!-- homedesk-assets:start -->
候选发布与实际附件检查进行中；真实摘要将在完成后列出。
<!-- homedesk-assets:end -->

稳定通道、原字节和历史验证说明如下。12.x 不复用这些远控验收结果。

---

# 下载 / Downloads

当前稳定组合为 **Server / Client 10.1.0 + Android 10.0.0**。Android 使用兼容保留的 10.0.0 原文件，没有 10.1.0 APK。部分验收项目未运行，验证尚未完成，见 [发布说明](RELEASE_NOTES.md)。机器可读通道来源为 [distribution.json](../distribution.json)。

FRP 仍为 **0.70.1**；Server / Client 使用冻结的增量契约 [`api-v1.5.0`](https://github.com/ZHanry/home-tunnel-server/tree/api-v1.5.0)。Windows/macOS 仍无 Authenticode / Developer ID 发行签名。锁屏、登录前、UAC 安全桌面和麦克风回传不可用。

## 10.1 稳定组合的文件与校验

| 文件 | 组件版本 | 字节 | SHA-256 |
| --- | --- | --- | --- |
| [HomeTunnel-Setup-10.1.0-x64.exe](https://github.com/ZHanry/home-tunnel-client/releases/download/v10.1.0/HomeTunnel-Setup-10.1.0-x64.exe) | client 10.1.0 | 17463072 | `58340bcd7d799ab7e5deaccc6d284fb4313b322ac869bdfd2ad2368b03b13eb5` |
| [HomeTunnel-Windows-10.1.0-x64.zip](https://github.com/ZHanry/home-tunnel-client/releases/download/v10.1.0/HomeTunnel-Windows-10.1.0-x64.zip) | client 10.1.0 | 22861344 | `e1c04b5cd06dcd5ac4548bac0e1611d9a996e70ba71307bb05fdb82350b98df7` |
| [home-tunnel-linux-10.1.0-amd64.tar.gz](https://github.com/ZHanry/home-tunnel-client/releases/download/v10.1.0/home-tunnel-linux-10.1.0-amd64.tar.gz) | client 10.1.0 | 22729875 | `208aa80e574af12e51ca650792d45a8c3ae35e7e815d6f69ec04f8f6a90e0624` |
| [home-tunnel-linux-10.1.0-arm64.tar.gz](https://github.com/ZHanry/home-tunnel-client/releases/download/v10.1.0/home-tunnel-linux-10.1.0-arm64.tar.gz) | client 10.1.0 | 12071626 | `2562fc313130b937a230dd004cb11bc2a88bcc541aa2041ddf0b9bb85576470f` |
| [home-tunnel-macos-10.1.0-amd64.tar.gz](https://github.com/ZHanry/home-tunnel-client/releases/download/v10.1.0/home-tunnel-macos-10.1.0-amd64.tar.gz) | client 10.1.0 | 12757661 | `dc7066139287d1fdf9411da9a6ae3b09209c7c7682534ab6eeb6d7390cc40fce` |
| [home-tunnel-macos-10.1.0-arm64.tar.gz](https://github.com/ZHanry/home-tunnel-client/releases/download/v10.1.0/home-tunnel-macos-10.1.0-arm64.tar.gz) | client 10.1.0 | 11645377 | `6ba70b3d49c22ce4c47cc09685d252d7026c5ce3ac24cba3dae6fd8a13f13293` |
| [HomeTunnel-Android-10.0.0-arm64-v8a.apk](https://github.com/ZHanry/home-tunnel-android/releases/download/v10.0.0/HomeTunnel-Android-10.0.0-arm64-v8a.apk) | android 10.0.0 | 16387499 | `c37a64cfec83e45c3d4e03671d5a994053385b5533f2f8575ff7783b323c674d` |
| [HomeTunnel-Android-10.0.0-x86_64.apk](https://github.com/ZHanry/home-tunnel-android/releases/download/v10.0.0/HomeTunnel-Android-10.0.0-x86_64.apk) | android 10.0.0 | 20385493 | `b18550736aea2f0a21068bde53c27f899af5b8f38ad2ef8460ee86bda2b86922` |
| [home-tunnel-server-10.1.0.tar.gz](https://github.com/ZHanry/home-tunnel-server/releases/download/v10.1.0/home-tunnel-server-10.1.0.tar.gz) | server 10.1.0 | 878055 | `dea0300d37f275bc8b97a7069aad48df04c5ef424e9bbc484ffbd2b3d7ff2694` |
| [compose.release.yaml](https://github.com/ZHanry/home-tunnel-server/releases/download/v10.1.0/compose.release.yaml) | server 10.1.0 | 298 | `6e7b3a9894c59e7cfc2d2dbbc3e0cc41f55c58c33865af7d6b3e75af38c9bba3` |

同样的文件身份见 [releases.json](../releases.json) 和 [网站下载页](site/downloads.html)。服务端与 Android 的校验清单为 `SHA256SUMS.txt`；客户端提供逐文件 `.sha256` 与 `client-candidate.json`。使用对应版本摘要，不混用历史包与当前包。

## 10.1 源码身份与签名

API 契约 `api-v1.5.0` 指向 Server 提交 `194ae805f3569dc16d94b7fda71367e5d68fdff5`；OpenAPI SHA-256 为 `c447a23f72b9f72efc118d75cd7cf3e071e0533e2bf0773e9b34f0e1ec779f54`。

- [Server 10.1.0](https://github.com/ZHanry/home-tunnel-server/releases/tag/v10.1.0)：`194ae805f3569dc16d94b7fda71367e5d68fdff5`
- [Client 10.1.0](https://github.com/ZHanry/home-tunnel-client/releases/tag/v10.1.0)：`41c0e21fbb3a4c634fbc9d63fcd7453337e4d029`
- [Android 10.0.0](https://github.com/ZHanry/home-tunnel-android/releases/tag/v10.0.0)：保留原始标签、文件与发行证书
- [Hub 10.1.0](https://github.com/ZHanry/home-tunnel/releases/tag/v10.1.0)：由正式标签解析

Android 发行证书 SHA-256：`d7779e338be1039acee6dda9a43417cbf2baf4b0c9995578d9708501e95af702`。Windows Authenticode 与 macOS Developer ID 未配置；SHA-256、Sigstore 构建证明和恶意软件扫描不是发行商签名。入口汇总清单本身不带 Sigstore 签名。

## 历史版本：10.0.0

以下保留 10.0.0 的下载与源码身份，只用于该版本；不能替代 10.1.0 的摘要或证据。

### 10.0.0 文件

| 平台 | 文件 |
| --- | --- |
| Windows x64 安装器 | [HomeTunnel-Setup-10.0.0-x64.exe](https://github.com/ZHanry/home-tunnel-client/releases/download/v10.0.0/HomeTunnel-Setup-10.0.0-x64.exe) |
| Windows x64 便携包 | [HomeTunnel-Windows-10.0.0-x64.zip](https://github.com/ZHanry/home-tunnel-client/releases/download/v10.0.0/HomeTunnel-Windows-10.0.0-x64.zip) |
| Linux amd64 | [home-tunnel-linux-10.0.0-amd64.tar.gz](https://github.com/ZHanry/home-tunnel-client/releases/download/v10.0.0/home-tunnel-linux-10.0.0-amd64.tar.gz) |
| Linux arm64 | [home-tunnel-linux-10.0.0-arm64.tar.gz](https://github.com/ZHanry/home-tunnel-client/releases/download/v10.0.0/home-tunnel-linux-10.0.0-arm64.tar.gz) |
| macOS amd64 | [home-tunnel-macos-10.0.0-amd64.tar.gz](https://github.com/ZHanry/home-tunnel-client/releases/download/v10.0.0/home-tunnel-macos-10.0.0-amd64.tar.gz) |
| macOS arm64 | [home-tunnel-macos-10.0.0-arm64.tar.gz](https://github.com/ZHanry/home-tunnel-client/releases/download/v10.0.0/home-tunnel-macos-10.0.0-arm64.tar.gz) |
| Android arm64-v8a | [HomeTunnel-Android-10.0.0-arm64-v8a.apk](https://github.com/ZHanry/home-tunnel-android/releases/download/v10.0.0/HomeTunnel-Android-10.0.0-arm64-v8a.apk) |
| Android x86_64 | [HomeTunnel-Android-10.0.0-x86_64.apk](https://github.com/ZHanry/home-tunnel-android/releases/download/v10.0.0/HomeTunnel-Android-10.0.0-x86_64.apk) |
| 服务端部署包 | [home-tunnel-server-10.0.0.tar.gz](https://github.com/ZHanry/home-tunnel-server/releases/download/v10.0.0/home-tunnel-server-10.0.0.tar.gz) |
| 服务端 Compose | [compose.release.yaml](https://github.com/ZHanry/home-tunnel-server/releases/download/v10.0.0/compose.release.yaml) |

历史 SHA-256 和文件大小以各组件 v10.0.0 Release 附带的原始校验文件为准。服务端和 Android Release 提供 `SHA256SUMS.txt`；桌面 Release 提供逐文件 `.sha256` 校验文件与 `client-candidate.json`，没有汇总 `SHA256SUMS.txt`。

### 10.0.0 源码身份

| 组件 | Release |
| --- | --- |
| hub | [v10.0.0](https://github.com/ZHanry/home-tunnel/releases/tag/v10.0.0) |
| server | [v10.0.0](https://github.com/ZHanry/home-tunnel-server/releases/tag/v10.0.0) |
| client | [v10.0.0](https://github.com/ZHanry/home-tunnel-client/releases/tag/v10.0.0) |
| android | [v10.0.0](https://github.com/ZHanry/home-tunnel-android/releases/tag/v10.0.0) |

各组件的源提交由其 v10.0.0 标签解析。API 契约 [`api-v1.4.0`](https://github.com/ZHanry/home-tunnel-server/tree/api-v1.4.0)，提交 `74e140da43c88043d0db2aad7505ba75fd3a9a49`。

### 10.0.0 签名

组件 Release 保留校验文件、Sigstore bundle 和构建证据；文件名按上一节区分。
Windows/macOS 没有 Authenticode 或 Developer ID 发行证书，10.0.0 仍未签名。
Android 发行证书 SHA-256：`d7779e338be1039acee6dda9a43417cbf2baf4b0c9995578d9708501e95af702`。
入口仓库的汇总清单本身不带 Sigstore 签名。

## 历史版本：9.0.0

9.0.0 的文件和摘要保留如下。不要用 9.0.0 的摘要去校验 10.0.0 的包。已发布的 9.0.0 快照在 [docs/release/stable-9.0.0.json](release/stable-9.0.0.json)。

| 平台 | 文件 | SHA-256 |
| --- | --- | --- |
| Windows x64 安装器 | [HomeTunnel-Setup-9.0.0-x64.exe](https://github.com/ZHanry/home-tunnel-client/releases/download/v9.0.0/HomeTunnel-Setup-9.0.0-x64.exe) | `9edd66e01ccabfd15c6c502eac749334fb0354fb87209f74cb73415c3366a8fb` |
| Windows x64 便携包 | [HomeTunnel-Windows-9.0.0-x64.zip](https://github.com/ZHanry/home-tunnel-client/releases/download/v9.0.0/HomeTunnel-Windows-9.0.0-x64.zip) | `9f679f66bcc7b600c74e7a95e518c9e2d59e17bfe62ae8fecfd0aac7fcfd779d` |
| Linux amd64 | [home-tunnel-linux-9.0.0-amd64.tar.gz](https://github.com/ZHanry/home-tunnel-client/releases/download/v9.0.0/home-tunnel-linux-9.0.0-amd64.tar.gz) | `080d3c8234f1376b246d262e8270caf36460c1de9c2549ba9e81514bb2db89e6` |
| Linux arm64 | [home-tunnel-linux-9.0.0-arm64.tar.gz](https://github.com/ZHanry/home-tunnel-client/releases/download/v9.0.0/home-tunnel-linux-9.0.0-arm64.tar.gz) | `4282bd85396e4cccde129c6fc74d79ccd13d8634d4c1ad9db11aeeb7ce19b987` |
| macOS amd64 | [home-tunnel-macos-9.0.0-amd64.tar.gz](https://github.com/ZHanry/home-tunnel-client/releases/download/v9.0.0/home-tunnel-macos-9.0.0-amd64.tar.gz) | `8658699b8db54cb0dafaca6583cec50e7da7cd2b63c400416208755ca3ba6b54` |
| macOS arm64 | [home-tunnel-macos-9.0.0-arm64.tar.gz](https://github.com/ZHanry/home-tunnel-client/releases/download/v9.0.0/home-tunnel-macos-9.0.0-arm64.tar.gz) | `73b8e838dbc6bdcd3dad09dfc96d4949ac585a43bb313ab5fa8b1915e7395123` |
| Android arm64-v8a | [HomeTunnel-Android-9.0.0-arm64-v8a.apk](https://github.com/ZHanry/home-tunnel-android/releases/download/v9.0.0/HomeTunnel-Android-9.0.0-arm64-v8a.apk) | `83a96d399660d5136133029effbe4520240ccfabee34a1c386ef5f2cf514a841` |
| 服务端部署包 | [home-tunnel-server-9.0.0.tar.gz](https://github.com/ZHanry/home-tunnel-server/releases/download/v9.0.0/home-tunnel-server-9.0.0.tar.gz) | `55c5d92743691ddb57f6f359b8f3e3f7f86a608cf555b943071cc906d6353183` |
| 服务端 Compose | [compose.release.yaml](https://github.com/ZHanry/home-tunnel-server/releases/download/v9.0.0/compose.release.yaml) | `44019ca07116a76dd6c1d25ec9266ebcc06239ee800213b6a995ac28cd62c0a2` |

### 9.0.0 源码身份

| 组件 | Release | 源提交 |
| --- | --- | --- |
| hub | [v9.0.0](https://github.com/ZHanry/home-tunnel/releases/tag/v9.0.0) | 由标签解析 |
| server | [v9.0.0](https://github.com/ZHanry/home-tunnel-server/releases/tag/v9.0.0) | `82b30aa2dc169e141bc5a4ae8c653aabb74fd96c` |
| client | [v9.0.0](https://github.com/ZHanry/home-tunnel-client/releases/tag/v9.0.0) | `ac48749044c0e761b21650539a0643fbeadb4ff2` |
| android | [v9.0.0](https://github.com/ZHanry/home-tunnel-android/releases/tag/v9.0.0) | `e67a9cca365366a74046432460c92f5f7db49f4a` |

API 契约 [`api-v1.3.0`](https://github.com/ZHanry/home-tunnel-server/tree/api-v1.3.0)，提交 `82b30aa2dc169e141bc5a4ae8c653aabb74fd96c`。
OpenAPI SHA-256：`a0892fb0263cb20fdb66f2d1d7497fa30d0a0ca7b8a5b28d46829cdfa83ba2fd`。

## 更早的版本

[8.0.0](https://github.com/ZHanry/home-tunnel/releases/tag/v8.0.0) · [7.0.0](https://github.com/ZHanry/home-tunnel/releases/tag/v7.0.0)。旧包使用各自 Release 的摘要。

## English

Install Server / Client 10.1.0 with the unchanged compatible Android 10.0.0 APKs. No Android artifact is relabeled 10.1.0. Verify the exact size and SHA-256 above. Some acceptance gates were not run and remain unverified; read the release notes. Windows/macOS have no publisher signature. Historical 10.0.0, 9.0.0, 8.0 and 7.0 downloads remain available.
