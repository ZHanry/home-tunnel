# nestlink

[English](README.en.md) · [网站](https://zhanry.github.io/home-tunnel/) · [版本说明](docs/HOMEDESK_RELEASE.md)

登录自己的服务器，管理设备、直接远控，并让内网服务保持可访问。当前发行目标 **13.0.0 正式版**，正在实施与验收；完成后发布可核验的安装包、源码与镜像。

| 平台 | 能力 | 发行产物 |
| --- | --- | --- |
| Web / Server | 管理与浏览器内远控 | 部署包、amd64/arm64 镜像 |
| Windows x64 | 远控、被控、穿透中枢 | GUI 安装器 |
| Linux x64 / ARM64 | 远控、被控、穿透中枢 | 两种 GUI DEB |
| Android ARM64 / x86_64 | 管理与远控 | 一个通用 APK |

统一英文名称、图标和蓝白界面。客户端必须登录自建服务，连接配置自动获取。跨账号按设备 ID 协助仍须被控端批准或验证远控密码；远控只允许认证加密的 P2P 直连，失败即结束。

HTTP/HTTPS、受控 TCP/UDP、权限、端口池、访问控制、流量治理和诊断保留，在 Windows/Linux 客户端集中管理。远控和穿透分别启停。独立 CLI/NAS 与 macOS GUI 不再属于产品发行范围。

| 仓库 | 职责 |
| --- | --- |
| [home-tunnel-server](https://github.com/ZHanry/home-tunnel-server) | Web、认证、管理、信令与穿透服务 |
| [home-tunnel-client](https://github.com/ZHanry/home-tunnel-client) | Windows/Linux 原生客户端 |
| [home-tunnel-android](https://github.com/ZHanry/home-tunnel-android) | 固定 Client 同源代码的 Android 应用 |
| home-tunnel | 分发清单、站点和发行材料 |

认证迁移与验证范围见 [发行说明](docs/HOMEDESK_RELEASE.md)，部署见 [自建服务](docs/SELF_HOSTING.md)。历史标签、下载和证据仍属于各自历史发行，当前页面不展示旧界面截图。原 Go 代码采用 Apache-2.0，Rust/Flutter 整合代码遵循 AGPL-3.0，对应源码与许可证随发行提供。
