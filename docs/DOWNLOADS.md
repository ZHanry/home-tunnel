# 下载 / Downloads

可安装的稳定版是 **9.0.0**。开发线 **10.0.0** 没有稳定包，验收尚未完成。
机器可读的唯一通道来源是 [distribution.json](../distribution.json)。
下面的链接和 SHA-256 是已发布 Release 的记录，网站上的 [下载页](site/downloads.html) 使用同一份稳定通道。

FRP 保持 **0.70.1**。Windows 锁屏、登录前和 UAC 安全桌面以及音频尚未交付。
Android API 35 x86_64 模拟器不能代替已发布的 arm64 APK 或真机。剪贴板跨端、跨网、长期在线和完整升级恢复仍未验收。

## 9.0.0 文件

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

## 源码身份

| 组件 | Release | 源提交 |
| --- | --- | --- |
| hub | [v9.0.0](https://github.com/ZHanry/home-tunnel/releases/tag/v9.0.0) | 由标签解析 |
| server | [v9.0.0](https://github.com/ZHanry/home-tunnel-server/releases/tag/v9.0.0) | `82b30aa2dc169e141bc5a4ae8c653aabb74fd96c` |
| client | [v9.0.0](https://github.com/ZHanry/home-tunnel-client/releases/tag/v9.0.0) | `ac48749044c0e761b21650539a0643fbeadb4ff2` |
| android | [v9.0.0](https://github.com/ZHanry/home-tunnel-android/releases/tag/v9.0.0) | `e67a9cca365366a74046432460c92f5f7db49f4a` |

API 契约 [`api-v1.3.0`](https://github.com/ZHanry/home-tunnel-server/tree/api-v1.3.0)，提交 `82b30aa2dc169e141bc5a4ae8c653aabb74fd96c`。
OpenAPI SHA-256：`a0892fb0263cb20fdb66f2d1d7497fa30d0a0ca7b8a5b28d46829cdfa83ba2fd`。

## 签名

组件 Release 保留 `SHA256SUMS.txt`、Sigstore bundle 和构建证据。
Windows/macOS 没有 Authenticode 或 Developer ID 发行证书。
Android 发行证书 SHA-256：`d7779e338be1039acee6dda9a43417cbf2baf4b0c9995578d9708501e95af702`。
入口仓库的汇总清单本身不带 Sigstore 签名。

## 历史版本

[8.0.0](https://github.com/ZHanry/home-tunnel/releases/tag/v8.0.0) · [7.0.0](https://github.com/ZHanry/home-tunnel/releases/tag/v7.0.0)。
旧包使用各自 Release 的摘要。已发布的 9.0.0 快照在 [docs/release/stable-9.0.0.json](release/stable-9.0.0.json)。

## English

Install 9.0.0 and check every file against the SHA-256 above. 10.0.0 has no stable download. Windows and macOS builds have no publisher certificate. The 8.0 and 7.0 release pages remain available.
