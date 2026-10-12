# NestLink

[English](README.en.md) · [网站](https://zhanry.github.io/home-tunnel/) · [版本说明](docs/HOMEDESK_RELEASE.md)

**14.0.1 维护版已正式发布。** 已正式发布。三个组件的原始发行文件、签名和来源已独立核验；accepted_with_waivers 下的未测场景保持 not_run，授权和确切范围见发行说明。历史下载与记录继续保留。

登录自己的服务器，管理设备、直接远控，并让内网服务保持可访问。**14.0.0** 统一桌面、服务端和手机端的紫色界面、图标与名称，已正式发布。三个组件的原始发行文件、签名和本版可复现验收已独立核验；确切验证范围与未验证项见发行说明，详见 [发行文件](docs/DOWNLOADS.md)。

| 平台 | 能力 | 发行产物 |
| --- | --- | --- |
| Web / Server | 管理与浏览器内远控 | 部署包、amd64/arm64 镜像 |
| Windows x64 | 远控、被控、穿透中枢 | GUI 安装器 |
| Linux x64 / ARM64 | 远控、被控、穿透中枢 | 两种 GUI DEB |
| Android ARM64 / x86_64 | 管理与远控 | 一个通用 APK |

各端统一使用 NestLink 名称、同源图标、设备目录与操作名称。客户端登录自建 HTTPS 服务后自动获取配置，按设备能力显示远控、后台穿透和设备管理入口。跨账号按设备 ID 协助仍须被控端批准或验证远控密码，画面和输入使用认证加密的 P2P 直连。

HTTP/HTTPS、受控 TCP/UDP、权限、端口池、访问控制、流量治理和诊断在 Windows/Linux 客户端集中管理。远控与穿透分别启停，手机提供管理和控制能力。Windows 当前未配置 Authenticode 证书；Android 保留原应用 ID 和签名证书以支持升级。

| 仓库 | 职责 |
| --- | --- |
| [home-tunnel-server](https://github.com/ZHanry/home-tunnel-server) | Web、认证、管理、信令与穿透服务 |
| [home-tunnel-client](https://github.com/ZHanry/home-tunnel-client) | Windows/Linux 原生客户端及共享 Flutter 界面 |
| [home-tunnel-android](https://github.com/ZHanry/home-tunnel-android) | 固定 Client 同源代码的 Android 应用 |
| home-tunnel | 分发清单、站点和发行材料 |

本版验证与未验证范围见 [发行说明](docs/HOMEDESK_RELEASE.md)，部署见 [自建服务](docs/SELF_HOSTING.md)。历史标签、下载、源码与证据保留。原 Go 代码采用 Apache-2.0，Rust/Flutter 整合代码遵循 AGPL-3.0，对应源码、许可证与构建证据随发行提供。
