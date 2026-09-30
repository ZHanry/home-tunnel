# 下载 / Downloads

当前稳定版是 **10.0.0**。部分验收项目未运行，验证尚未完成，清单见 [发布说明](RELEASE_NOTES.md)。
机器可读的唯一通道来源是 [distribution.json](../distribution.json)。

FRP 保持 **0.70.1**。锁屏、登录前和 UAC 安全桌面控制不可用，没有麦克风回传。
远控的 TURN 中继只服务浏览器控制端；Android 控制端和 9.x 被控端只走直连。升级前先读 [升级](UPGRADING.md)。

## 10.0.0 文件

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

SHA-256 和文件大小以 [releases.json](../releases.json) 为准，网站 [下载页](site/downloads.html) 从同一份清单读取。服务端和 Android Release 提供 `SHA256SUMS.txt`；桌面 Release 提供逐文件 `.sha256` 校验文件与 `client-candidate.json`，没有汇总 `SHA256SUMS.txt`。

## 源码身份

| 组件 | Release |
| --- | --- |
| hub | [v10.0.0](https://github.com/ZHanry/home-tunnel/releases/tag/v10.0.0) |
| server | [v10.0.0](https://github.com/ZHanry/home-tunnel-server/releases/tag/v10.0.0) |
| client | [v10.0.0](https://github.com/ZHanry/home-tunnel-client/releases/tag/v10.0.0) |
| android | [v10.0.0](https://github.com/ZHanry/home-tunnel-android/releases/tag/v10.0.0) |

各组件的源提交记录在 [releases.json](../releases.json)。API 契约 [`api-v1.4.0`](https://github.com/ZHanry/home-tunnel-server/tree/api-v1.4.0)，提交 `74e140da43c88043d0db2aad7505ba75fd3a9a49`。

## 签名

组件 Release 保留校验文件、Sigstore bundle 和构建证据；文件名按上一节区分。
Windows/macOS 没有 Authenticode 或 Developer ID 发行证书，10.0.0 仍未签名。
Android 发行证书 SHA-256：`d7779e338be1039acee6dda9a43417cbf2baf4b0c9995578d9708501e95af702`。
入口仓库的汇总清单本身不带 Sigstore 签名。

## 上一版本：9.0.0

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

Install 10.0.0 and check each file against the SHA-256 in `releases.json`. Server and Android Releases have `SHA256SUMS.txt`; the desktop Release has per-file `.sha256` files and `client-candidate.json`. Some 10.0.0 acceptance gates were not run; the release notes list what remains unverified. Windows and macOS builds have no publisher certificate. The 9.0.0, 8.0 and 7.0 release pages remain available.
