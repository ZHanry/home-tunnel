# 下载与兼容组合 / Downloads

当前正式组合：主仓库、Server/Web、Client/CLI、Android、自有 Agent 均为 **7.0.0**。
FRP 独立为 0.70.1。[机器可读清单](../releases.json)。6.x 客户端不支持 7.0 的分页与安全流程，需一起升级。

| 平台 | 主要安装资产 | 入口 |
| --- | --- | --- |
| Windows x64 | `HomeTunnel-Setup-7.0.0-x64.exe` / `HomeTunnel-Windows-7.0.0-x64.zip` | [Client Release](https://github.com/ZHanry/home-tunnel-client/releases/tag/v7.0.0) |
| macOS Intel / Apple Silicon | `home-tunnel-macos-7.0.0-amd64.tar.gz` / `arm64.tar.gz` | [Client Release](https://github.com/ZHanry/home-tunnel-client/releases/tag/v7.0.0) |
| Linux amd64 / arm64 | `home-tunnel-linux-7.0.0-amd64.tar.gz` / `arm64.tar.gz` | [Client Release](https://github.com/ZHanry/home-tunnel-client/releases/tag/v7.0.0) |
| Android 8.0+ arm64-v8a | `HomeTunnel-Android-7.0.0-arm64-v8a.apk` | [Android Release](https://github.com/ZHanry/home-tunnel-android/releases/tag/v7.0.0) |
| Linux 服务端 amd64 / arm64 | `home-tunnel-server-7.0.0.tar.gz` + `compose.release.yaml` | [Server Release](https://github.com/ZHanry/home-tunnel-server/releases/tag/v7.0.0) |

每个 Release 保留 SHA256SUMS、Sigstore bundle、SBOM、检查和签名证据，AAB 供
Android 分发工程使用，普通用户安装 APK。核对文件名/版本和哈希，不要下载随机网盘镜像。

Windows/macOS 没有平台发行证书，当前包为明确标注的未签名包。Android 保持原正式签名。
取得证书后可启用已接入的 Authenticode / Developer ID / 公证流程，不会伪称已签名。

English: use the 7.0.0 combination across all first-party components. Choose your
CPU architecture, verify checksums and consult the durable release evidence.
Windows/macOS are currently unsigned; Android keeps its established identity.
Older product releases remain available for recovery, not as a supported mixed stack.
