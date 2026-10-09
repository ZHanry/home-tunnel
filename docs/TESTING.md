# nestlink 13.0.0 验证记录

验收绑定实际安装包、APK、部署包与镜像，记录在各仓 `docs/release/acceptance-13.0.0.json`，并随材料 ZIP 发布。

- Server：账号/MFA/旧会话事务迁移及中断回滚；后台凭据与穿透配置保留；浏览器和原生许可；实际 HTTP/HTTPS、TCP/UDP 穿透。
- Client：Windows 安装、文件摘要、版本、协议入口、启动、卸载和隔离升级预检；Linux 两架构实际 DEB 安装启动与 Secret Service 跨进程、注销和损坏恢复。安装的 Linux x64 GUI 完成跨账号批准、真实画面和输入、成对直连、冷恢复、续期与撤销断开；1120×760 固定窗口检查通过。
- Browser：实际服务端连接安装的 Linux 客户端，验证画面、键盘输入、DTLS 与非中继 UDP 候选。拒绝、错误密码、离线时零帧；活动会话撤销后断开。
- Android：原证书、applicationId、通用 APK 实际字节与两种 ELF ABI；API26/35 Keystore 和启动检查。安装的最终签名 APK 完成登录冷恢复、真实设备管理、续期、同账号/跨账号远控画面与输入、横竖屏和撤销退出。
- 穿透生命周期：四种真实服务在关闭远控、撤销前台会话后继续运行，撤销其后台设备后停止。
- 总仓：独立下载组件字节，验证 SHA-256、对应源码与 Sigstore；当前安装版原图、中英文网站、浅深色、小屏布局、菜单、滚动和静态下载。

以上使用隔离的测试账号、X11 桌面和 Android 模拟器，不升级生产部署。Android 真机、运营商网络/NAT、长期媒体、Windows/ARM64 实际远控媒体、Wayland、多显示器/DPI、Android 到 Windows、正确固定密码连接，以及音频/文件/剪贴板尚未验收。浏览器当前 JPEG 上限为 1920×1080、约 6.7 fps。完整边界见 [发行说明](HOMEDESK_RELEASE.md)。历史 10.x 的长测和截图不作为本次验证。
