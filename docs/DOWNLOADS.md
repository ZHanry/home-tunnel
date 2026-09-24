# Home Tunnel 9.0.0 下载与兼容组合 / Downloads

入口、Server/Web、Client/CLI、Android 与自有 Agent 均为 **9.0.0**；FRP 保持独立版本 **0.70.1**。
以下链接、文件大小和 SHA-256 来自三个组件已公开的正式 Release，不由文件名推算。
[机器可读清单](../releases.json) · [9.0 功能与限制](RELEASE_NOTES.md) · [快速开始](GETTING_STARTED.md)。

**正式版本不等于全部远控场景通过验收。** Windows 锁屏、登录前与 UAC 安全桌面控制和音频尚不可用。
Android API 35 x86_64 模拟器曾验证局域网画面与输入，但发行的 arm64 APK 和真机未运行验收。
剪贴板跨端互通、真实跨网、长期在线及完整升级恢复仍未验收；详见各组件 Release 的证据。

## 安装与部署文件

普通 Android 用户安装 APK；AAB、原生 SDK 与验证材料保留在组件 Release 中。
运行前请核对所下载文件的 SHA-256。

| 平台 | 实际发行文件 | SHA-256 |
| --- | --- | --- |
| Windows x64 安装器 | [HomeTunnel-Setup-9.0.0-x64.exe](https://github.com/ZHanry/home-tunnel-client/releases/download/v9.0.0/HomeTunnel-Setup-9.0.0-x64.exe) | `9edd66e01ccabfd15c6c502eac749334fb0354fb87209f74cb73415c3366a8fb` |
| Windows x64 便携包 | [HomeTunnel-Windows-9.0.0-x64.zip](https://github.com/ZHanry/home-tunnel-client/releases/download/v9.0.0/HomeTunnel-Windows-9.0.0-x64.zip) | `9f679f66bcc7b600c74e7a95e518c9e2d59e17bfe62ae8fecfd0aac7fcfd779d` |
| Linux amd64 | [home-tunnel-linux-9.0.0-amd64.tar.gz](https://github.com/ZHanry/home-tunnel-client/releases/download/v9.0.0/home-tunnel-linux-9.0.0-amd64.tar.gz) | `080d3c8234f1376b246d262e8270caf36460c1de9c2549ba9e81514bb2db89e6` |
| Linux arm64 | [home-tunnel-linux-9.0.0-arm64.tar.gz](https://github.com/ZHanry/home-tunnel-client/releases/download/v9.0.0/home-tunnel-linux-9.0.0-arm64.tar.gz) | `4282bd85396e4cccde129c6fc74d79ccd13d8634d4c1ad9db11aeeb7ce19b987` |
| macOS Intel / amd64 | [home-tunnel-macos-9.0.0-amd64.tar.gz](https://github.com/ZHanry/home-tunnel-client/releases/download/v9.0.0/home-tunnel-macos-9.0.0-amd64.tar.gz) | `8658699b8db54cb0dafaca6583cec50e7da7cd2b63c400416208755ca3ba6b54` |
| macOS Apple Silicon / arm64 | [home-tunnel-macos-9.0.0-arm64.tar.gz](https://github.com/ZHanry/home-tunnel-client/releases/download/v9.0.0/home-tunnel-macos-9.0.0-arm64.tar.gz) | `73b8e838dbc6bdcd3dad09dfc96d4949ac585a43bb313ab5fa8b1915e7395123` |
| Android 8.0+ / arm64-v8a | [HomeTunnel-Android-9.0.0-arm64-v8a.apk](https://github.com/ZHanry/home-tunnel-android/releases/download/v9.0.0/HomeTunnel-Android-9.0.0-arm64-v8a.apk) | `83a96d399660d5136133029effbe4520240ccfabee34a1c386ef5f2cf514a841` |
| Linux 服务端 amd64/arm64 部署包 | [home-tunnel-server-9.0.0.tar.gz](https://github.com/ZHanry/home-tunnel-server/releases/download/v9.0.0/home-tunnel-server-9.0.0.tar.gz) | `55c5d92743691ddb57f6f359b8f3e3f7f86a608cf555b943071cc906d6353183` |
| 服务端固定镜像 Compose | [compose.release.yaml](https://github.com/ZHanry/home-tunnel-server/releases/download/v9.0.0/compose.release.yaml) | `44019ca07116a76dd6c1d25ec9266ebcc06239ee800213b6a995ac28cd62c0a2` |

## 源码与发布身份

| 组件 | Release | 源提交 |
| --- | --- | --- |
| hub | [v9.0.0](https://github.com/ZHanry/home-tunnel/releases/tag/v9.0.0) | 最终 v9.0.0 标签 |
| server | [v9.0.0](https://github.com/ZHanry/home-tunnel-server/releases/tag/v9.0.0) | `82b30aa2dc169e141bc5a4ae8c653aabb74fd96c` |
| client | [v9.0.0](https://github.com/ZHanry/home-tunnel-client/releases/tag/v9.0.0) | `ac48749044c0e761b21650539a0643fbeadb4ff2` |
| android | [v9.0.0](https://github.com/ZHanry/home-tunnel-android/releases/tag/v9.0.0) | `e67a9cca365366a74046432460c92f5f7db49f4a` |

入口仓库不在本页固化自身提交，避免文档与提交摘要自引用；由最终 `v9.0.0` 标签解析。
API 契约固定于 [`api-v1.3.0`](https://github.com/ZHanry/home-tunnel-server/tree/api-v1.3.0)，提交 `82b30aa2dc169e141bc5a4ae8c653aabb74fd96c`。
OpenAPI SHA-256：`a0892fb0263cb20fdb66f2d1d7497fa30d0a0ca7b8a5b28d46829cdfa83ba2fd`。契约提交和组件发行身份分别校验。

## 验证与签名

Client、Android、Server Release 保留 `SHA256SUMS.txt`、Sigstore bundle 和构建/验证证据。
桌面和 Android 的 SBOM 随 Release 保留；服务端镜像 SBOM/证明绑定 GHCR 镜像摘要。
核对时使用原始签名清单，不以开发构建或模拟器结果替代最终包及实机验收。
Windows/macOS 发行包未配置发行商证书；Android 保持既有 applicationId 与发行证书
`d7779e338be1039acee6dda9a43417cbf2baf4b0c9995578d9708501e95af702`。入口仓库汇总附件的 SHA-256 清单本身不带 Sigstore 签名。

升级前请备份并结束远控会话，参阅[服务端升级指南](https://github.com/ZHanry/home-tunnel-server/blob/main/docs/UPGRADING.md)。
9.0 保留旧隧道兼容路径，但旧服务端不提供新的三种远控授权方式。本轮未部署生产服务器。

## 历史下载

[8.0.0 入口](https://github.com/ZHanry/home-tunnel/releases/tag/v8.0.0) · [Server](https://github.com/ZHanry/home-tunnel-server/releases/tag/v8.0.0) · [Client](https://github.com/ZHanry/home-tunnel-client/releases/tag/v8.0.0) · [Android](https://github.com/ZHanry/home-tunnel-android/releases/tag/v8.0.0)。

[7.0.0 入口](https://github.com/ZHanry/home-tunnel/releases/tag/v7.0.0) · [Server](https://github.com/ZHanry/home-tunnel-server/releases/tag/v7.0.0) · [Client](https://github.com/ZHanry/home-tunnel-client/releases/tag/v7.0.0) · [Android](https://github.com/ZHanry/home-tunnel-android/releases/tag/v7.0.0)。
历史文件请使用各自 Release 的摘要，不能用上表的 9.0 摘要校验旧包。

## English

Use matching 9.0.0 components and verify each download against its listed SHA-256. The stable
Releases contain signed checksums and build evidence; the hub's summary inventory is unsigned.
Windows secure-desktop control and audio are unavailable. The API 35 x86_64 emulator run does
not validate the distributed arm64 APK or a physical phone. Clipboard interoperability,
cross-network reliability, long-running use and complete upgrade/restore remain unverified.
Back up before upgrading. No production server was deployed in this release task.
