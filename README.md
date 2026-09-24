<img src="docs/site/assets/HomeTunnel.svg" alt="" width="64" height="64">

# Home Tunnel 9.0.0

**自托管的家庭服务连接与远程桌面平台**

[![Version 9.0.0](https://img.shields.io/badge/version-9.0.0-595AD7)](https://github.com/ZHanry/home-tunnel/releases/tag/v9.0.0) [![License Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

[English](README.en.md) · [项目网站](https://zhanry.github.io/home-tunnel/) · [下载](docs/DOWNLOADS.md) · [快速开始](docs/GETTING_STARTED.md) · [9.0 功能与限制](docs/RELEASE_NOTES.md)

用自己的公网服务器，将家里的 NAS、Home Assistant、Immich、Jellyfin 和其他
本地服务连接到外部网络。电脑/NAS 运行隧道，浏览器和 Android 管理连接。
支持 HTTP/HTTPS、TCP、UDP，以及 SSH/RDP/RTSP 预设。
9.0 将远程桌面和内网穿透分开，提供独立远控窗口及三种连接方式：临时请求并批准、固定密码和一次性临时密码。远控载荷只走 UDP P2P；无法直连时明确失败。

## 从这里开始

| 你要做的事 | 入口 |
| --- | --- |
| 部署自己的公网服务端 | [部署指南](https://github.com/ZHanry/home-tunnel-server/blob/main/docs/SELF_HOSTING.md) · [Server 9.0.0](https://github.com/ZHanry/home-tunnel-server/releases/tag/v9.0.0) |
| 连接家中电脑或 NAS | [桌面/CLI 9.0.0](https://github.com/ZHanry/home-tunnel-client/releases/tag/v9.0.0) · [NAS 模板](https://github.com/ZHanry/home-tunnel-client/tree/main/packaging/nas) |
| 手机远程管理多台服务器 | [Android 9.0.0 APK](https://github.com/ZHanry/home-tunnel-android/releases/tag/v9.0.0) |
| 给家庭应用配置连接 | [Home Assistant / Immich / Jellyfin 场景](docs/SCENARIOS.md) |

## 9.0.0 的交付范围

- **Windows 与浏览器**：远控独立窗口、临时请求并批准、固定密码与一次性临时密码；签名授权、租约和即时撤销。H.264/VP8 视频、键鼠、Unicode 文本及文件路径的验证结果以本版组件 Release 证据为准。
- **Linux x64 X11**：被控端只开放观看、键盘和鼠标。已完成隔离 Xvfb 环境验证；实体桌面、锁屏恢复仍待验收，文本、剪贴板、文件在此配置中不可用。Linux arm64/NAS/CLI 继续用于隧道。
- **Android**：保留多服务器管理，提供三种连接方式及独立远控画面。API 35 x86_64 模拟器验证不代表 arm64 APK 或真机运行验收；剪贴板互通仍未验收，音频与文件不可用。
- **原有管理与运维**：继续提供一次性设备接入码、TOTP/恢复码、会话撤销、标签/收藏、批量操作、部署预检、脱敏诊断、加密异机备份和监控。
- **共享接口与发布证据**：REST 保持 `/api/v1`，契约固定为 `api-v1.3.0`；各组件 Release 保存实际产物、摘要和验证材料。

Windows 登录前、锁屏和 UAC 安全桌面控制尚未完成；音频、macOS/Wayland 被控、AV1/HEVC 也未交付。剪贴板实际跨端互通、arm64 APK 运行、跨网、完整升级恢复及长期在线验收仍未完成。

**正式版本号不代表全部远控能力已验收。** 查看 [发布说明](docs/RELEASE_NOTES.md) 与各组件 Release 证据；[8.0 历史验收](docs/8.0/ACCEPTANCE.md) 不可替代本版产物验证。

四个仓库与自有 Agent 使用 **9.0.0**，FRP 保持独立的 **0.70.1**。
Windows/macOS 包没有 Authenticode / Developer ID 发行签名，提供 SHA-256 和 Sigstore 构建证明；Android 沿用原 applicationId 和发行证书。
[验证与签名说明](https://github.com/ZHanry/home-tunnel-client/blob/main/docs/PLATFORM_SECURITY.md)。

## 三步连接

1. 准备公网 Linux 主机、域名和 Docker Compose，部署服务端并修改初始管理员密码。
2. 在家庭电脑/NAS 安装客户端，通过账号或一次性接入码登记设备。
3. 添加本地服务，等待在线，复制地址并从外部网络验证访问。

TCP/UDP 隧道需要管理员开放端口池并授权，公网端口由服务端分配。原始 TCP/UDP
不附带 HTTP 白名单或 Basic Auth，使用目标应用的认证与加密。

远程桌面要求双方登录同一服务器；被控端可以批准临时请求，或预先启用固定密码、生成一次性临时密码。服务器负责身份、授权和信令；画面、输入与文件只走两端 UDP 直连，不提供 TURN 或隧道中转回退。具体操作见 [快速开始](docs/GETTING_STARTED.md)。

## 界面与架构

以下保留 7.0.0 控制台示例截图，未将历史图片作为 9.0 远程桌面演示。

![Home Tunnel 7.0.0 控制台（历史截图，示例数据）](docs/site/assets/admin-dashboard-7.jpg)

```mermaid
flowchart LR
  Visitor[浏览器 / 远程应用] --> Edge[自己的公网服务器]
  Edge --> Agent[家庭电脑 / NAS Agent]
  Agent --> App[Home Assistant / 相册 / 媒体库]
  Manager[Web / Android 管理] --> Edge
  Controller[远控浏览器] <-->|UDP P2P| Host[受支持的被控端]
```

[下载与兼容性](docs/DOWNLOADS.md) · [升级](https://github.com/ZHanry/home-tunnel-server/blob/main/docs/UPGRADING.md) · [账号安全](https://github.com/ZHanry/home-tunnel-server/blob/main/docs/ACCOUNT_SECURITY.md) · [备份恢复](https://github.com/ZHanry/home-tunnel-server/blob/main/docs/disaster-recovery.md) · [监控](https://github.com/ZHanry/home-tunnel-server/blob/main/docs/MONITORING.md) · [API](https://github.com/ZHanry/home-tunnel-server/blob/main/docs/API.md)

7.0.0 和 8.0.0 历史产物继续保留。升级前先备份；旧服务端不提供 9.0 的三种远控授权方式。

## 参与项目

先阅读 [贡献指南](CONTRIBUTING.md)。问题反馈请提供组件版本、平台、复现步骤和脱敏
诊断结果，切勿公开密码/接入码。安全问题按 [SECURITY.md](SECURITY.md) 私下报告。
欢迎分享实际部署经验、提交可复现问题或改进文档。
