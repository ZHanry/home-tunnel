# nestlink 13.0.0 正式版

统一使用 nestlink 英文名称、桥形图标与蓝白工作台。Web Server 提供管理和浏览器内远控；Windows x64、Linux x64/ARM64 GUI 提供远控、被控和内网穿透中枢；Android ARM64/x86_64 使用一个通用 APK，提供管理和远控。不再分发独立 CLI/NAS，不开发 macOS。

桌面主工作台固定 1120×760，按屏幕和 DPI 缩小，禁止自由缩放和最大化；远控窗口保留全屏。远控、内网穿透、设备、设置统一组织，整合本机共享、设备 ID、最近连接与会话状态。浅深色、空状态、分页、表单和更新弹窗统一，隐藏可见滚动条并保留滚轮、触控和键盘操作。网站采用紧凑图文布局，当前站点和文档仅展示 13.0 实际运行界面的原图。

所有客户端登录自建 HTTPS 服务后使用，连接配置自动获取。账号密码、自动续期、可撤销设备凭据取代旧入口；Windows 使用 DPAPI，Linux 使用 Secret Service，Android 使用 Keystore。MFA、恢复码和设备接入码的旧秘密由事务迁移清除，旧管理会话失效；有效后台凭据、设备身份和穿透配置保留。认证契约冻结为 api-v2.0.0，原穿透必要兼容接口保留。

同账号目录隔离，跨账号按设备 ID 协助仍须被控端批准或验证密码。服务端签发短期许可，原生核心在发起和接受连接时检查。原生远控认证加密 P2P，Web 使用直接 WebRTC 数据通道传输画面和输入；服务端只处理认证、授权和信令，直连失败明确结束。退出或撤销前台会话立即断开相关远控。独立后台凭据维持的 HTTP/HTTPS、TCP/UDP 穿透继续运行，撤销后台设备停止对应服务。

发行使用完成验收的原始构建字节：Server 构建 37947684952 attempt 2、Client 构建 37960914602、Android 构建 37960996185。Android 固定 Client 4cf3d160 的已验收运行源码，保留 io.github.zhanry.hometunnel、原发行证书及 versionCode 13000000。最终组件标签仅增加验收/发行文档，运行代码与实际验收构建一致。

Windows runner 通过实际安装、115 个文件、PE 版本、协议入口、启动、卸载及隔离升级预检；Linux 两架构通过 DEB 安装启动、Secret Service 跨进程、注销和损坏恢复。安装的 Linux x64 原生两端通过跨账号批准、真实画面/键盘输入、成对直连、冷恢复、续期和撤销断开。浏览器验证真实画面/输入、DTLS、非中继 UDP 候选，以及拒绝、错误密码、离线零帧与撤销断开。安装的最终签名 Android APK 通过冷恢复、设备管理、续期、同账号/跨账号真实远控与输入、横竖屏和撤销退出；API26/35 Keystore 和启动检查通过。四类穿透在远控关闭、前台撤销后继续运行，在后台设备撤销后停止。

三组件共 11 个公开附件经过独立下载、SHA-256、对应源码、Sigstore 工作流签名和内嵌实际验收核验。网站中英文八页在 320/390/768/1440 宽度及浅深色通过布局、菜单、主题、滚动、原图、静态下载和摘要检查；离线/错误状态仍保留准确下载链接。详情见 [总体验收](release/acceptance-13.0.0.json)、[组件下载核验](release/components-13.0.0.json) 和 [下载文件](DOWNLOADS.md)。材料随各 GitHub 正式版发布，包含对应源码、许可证、构建与安装/联调证据。生产部署升级另行执行，历史标签和发行字节保留。

Android 真机、运营商网络/NAT、长期媒体、Windows/ARM64 实际远控媒体、Wayland、多显示器/DPI、Android 到 Windows，以及正确固定密码连接尚未验收。浏览器当前 JPEG 上限 1920×1080、约 6.7 fps；音频、文件与剪贴板未纳入本次验收。Windows 没有 Authenticode 发布者签名。

Physical Android devices, carrier networks and long-duration media were not run and remain unverified. Windows/ARM64 remote media, Wayland, multiple-monitor/DPI, Android-to-Windows, successful fixed-password sessions and audio/file/clipboard are outside the recorded acceptance.
