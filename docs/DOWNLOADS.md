# Home Tunnel 8.0.0 下载与兼容组合 / Downloads

版本组合：入口、Server/Web、Client/CLI、Android 与自有 Agent 为 **8.0.0**，FRP 保持 **0.70.1**。
以下链接和 SHA-256 来自已验证的实际发布清单，未从文件名推算或填写占位摘要。
[机器可读清单](../releases.json) · [8.0 功能与限制](RELEASE_NOTES.md) · [逐项验收](8.0/ACCEPTANCE.md)。

**版本一致不代表全部远控平台已验收。** Windows 与浏览器支持直连视频、输入和文件；
Linux x64 X11 仅观看、键盘和鼠标，当前证据来自隔离 Xvfb 环境。Android 真机解码/输入未验收。
macOS/Wayland 被控、桌面原生观看、音频、麦克风回传、虚拟麦克风和 AV1/HEVC 未交付。
Windows 系统剪贴板、多窗口媒体、真实跨网、完整升级恢复和长期在线仍有待验项目。

## 安装与部署文件

普通 Android 用户安装 APK；AAB、共享原生 SDK 与验证材料可在组件 Release 中查看。
请按 CPU 架构选择文件，并在运行前与下面的 SHA-256 核对。

| 平台 | 实际发行文件 | SHA-256 |
| --- | --- | --- |
| Windows x64 安装器 | [HomeTunnel-Setup-8.0.0-x64.exe](https://github.com/ZHanry/home-tunnel-client/releases/download/v8.0.0/HomeTunnel-Setup-8.0.0-x64.exe) | `a7a92045fa6fc6bbf26e3c7c797a0a4d6d6604b9f33cf8bc986941ae82fff3f3` |
| Windows x64 便携包 | [HomeTunnel-Windows-8.0.0-x64.zip](https://github.com/ZHanry/home-tunnel-client/releases/download/v8.0.0/HomeTunnel-Windows-8.0.0-x64.zip) | `a700adbedb562a7a7a243fc39f115117c011e103d82926d5172d16b430c05a5d` |
| Linux amd64 | [home-tunnel-linux-8.0.0-amd64.tar.gz](https://github.com/ZHanry/home-tunnel-client/releases/download/v8.0.0/home-tunnel-linux-8.0.0-amd64.tar.gz) | `ff68081e94be047e1a731864036f96bfd6181dd80b37e0622de63a90e13b5f52` |
| Linux arm64 | [home-tunnel-linux-8.0.0-arm64.tar.gz](https://github.com/ZHanry/home-tunnel-client/releases/download/v8.0.0/home-tunnel-linux-8.0.0-arm64.tar.gz) | `854cf29432e68f47706fd2381bd6fd5dc6d884b7ad188e98f51905781a79f490` |
| macOS Intel / amd64 | [home-tunnel-macos-8.0.0-amd64.tar.gz](https://github.com/ZHanry/home-tunnel-client/releases/download/v8.0.0/home-tunnel-macos-8.0.0-amd64.tar.gz) | `7f50ddf2239b5612580c82dc5df5f48daddbb28be7f5d8f67aa8023582094772` |
| macOS Apple Silicon / arm64 | [home-tunnel-macos-8.0.0-arm64.tar.gz](https://github.com/ZHanry/home-tunnel-client/releases/download/v8.0.0/home-tunnel-macos-8.0.0-arm64.tar.gz) | `7026c8a385436a44b0b5dd3c9afe81e2960d75b8b5eadee0bc1b37606e955053` |
| Android 8.0+ / arm64-v8a | [HomeTunnel-Android-8.0.0-arm64-v8a.apk](https://github.com/ZHanry/home-tunnel-android/releases/download/v8.0.0/HomeTunnel-Android-8.0.0-arm64-v8a.apk) | `550f5846c009c012f2c0e3f25d5e4e19c4fbf6d424e9c02d883ade53f286dc70` |
| Linux 服务端 amd64 / arm64 部署包 | [home-tunnel-server-8.0.0.tar.gz](https://github.com/ZHanry/home-tunnel-server/releases/download/v8.0.0/home-tunnel-server-8.0.0.tar.gz) | `0335a6c9fd912e20d0ddf6193ae36f5d07b54b82bb1edc731eb16b71e0c8180f` |
| 服务端固定镜像 Compose | [compose.release.yaml](https://github.com/ZHanry/home-tunnel-server/releases/download/v8.0.0/compose.release.yaml) | `6ca44003190e42009820f2fc9dad08bffac6d2b0db50552ab59a519431b35e49` |

## 源码与发布身份

| 组件 | Release | 源提交 |
| --- | --- | --- |
| hub | [v8.0.0](https://github.com/ZHanry/home-tunnel/releases/tag/v8.0.0) | [以最终 v8.0.0 标签为准](https://github.com/ZHanry/home-tunnel/tree/v8.0.0) |
| server | [v8.0.0](https://github.com/ZHanry/home-tunnel-server/releases/tag/v8.0.0) | `15fd9de2a8f8e984d68472877753dbbf6cf60775` |
| client | [v8.0.0](https://github.com/ZHanry/home-tunnel-client/releases/tag/v8.0.0) | `16d55f0e65b8d0f61d21d9770ecf0f6e94115af3` |
| android | [v8.0.0](https://github.com/ZHanry/home-tunnel-android/releases/tag/v8.0.0) | `618e3b9d2676361e1aff47935a53d59105179dc1` |

入口仓库不在本页固化自身提交，以避免文档与提交摘要自引用；其源提交由最终 `v8.0.0` 标签解析。

API 契约固定于 [`api-v1.2.0`](https://github.com/ZHanry/home-tunnel-server/tree/api-v1.2.0)，提交 `4319f8d0cf2c6dcad0cc06d322e8a55ac83edf50`。
OpenAPI SHA-256：`5a97a9fb6f7b28cb0f3fd32f0f54ba79b4b809c164bdadd93413569c030b5ec9`。契约提交与服务端产品提交分别管理。

## 验证与签名

Client、Android、Server Release 保留 `SHA256SUMS.txt`、Sigstore bundle 和验证证据。桌面/Android 的 SBOM 为 Release 附件；
服务端镜像 SBOM/构建证明保存在清单引用的 GHCR 固定镜像摘要上。校验清单覆盖交付物和证据，
核对时保持原始签名清单完整。开发构建、云端或模拟器结果不能替代最终包/实机验收。
入口仓库 Release 提供未签名的 SHA-256 清单、源码和汇总材料，其自身附件不带 Sigstore 签名。

Windows/macOS 平台签名状态以具体产物报告为准；源码摘要和 CI 不等同于发行证书。
Android 保持既有 applicationId 和发行证书。参阅 [平台安全说明](https://github.com/ZHanry/home-tunnel-client/blob/main/docs/PLATFORM_SECURITY.md)。

## 从 7.0 升级与历史下载

升级前备份并结束远控会话，按 [升级指南](https://github.com/ZHanry/home-tunnel-server/blob/main/docs/UPGRADING.md)操作。
8.0 保留 7.0 隧道兼容路径；旧服务端不提供新的远控能力。完整升级与恢复验收仍未覆盖全部平台。

7.0.0 版本下载继续保留：[入口](https://github.com/ZHanry/home-tunnel/releases/tag/v7.0.0) · [Server](https://github.com/ZHanry/home-tunnel-server/releases/tag/v7.0.0) · [Client](https://github.com/ZHanry/home-tunnel-client/releases/tag/v7.0.0) · [Android](https://github.com/ZHanry/home-tunnel-android/releases/tag/v7.0.0)。
历史文件的摘要以对应 7.0 Release 为准，不使用上表的 8.0 摘要校验旧包。

## English

Use the matching 8.0.0 component versions and choose your CPU architecture. Each download above names an actual
versioned Release asset and its verified SHA-256. Component source commits, the hub tag and the separately frozen API contract
are listed explicitly. Client, Android and Server publish signed checksum manifests and artifact evidence.
The hub's own source and summary attachments have an unsigned SHA-256 inventory.

Remote-desktop platform coverage is incomplete. The final distributed Windows worker has same-machine browser evidence
for H.264 video, input and bidirectional fixture file transfer, plus VP8 video. File checks use a confined fixture and
browser origin-private storage; native/browser user file pickers and real cross-network traversal remain unverified.
Linux x64 X11 is limited to viewing, keyboard and pointer with isolated Xvfb evidence. Android device decoding/input
remain unverified. macOS/Wayland hosting, native desktop viewers, audio, virtual microphones and AV1/HEVC are not delivered.
Check actual packages for Windows/macOS publisher-signature status; Android retains its established identity.
Back up before upgrading. Historical 7.0.0 links remain available above, with their own checksums.
