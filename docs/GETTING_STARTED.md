# Home Tunnel 8.0.0 快速开始 / Quick start

## 先连接一个家庭服务

1. 在公网 Linux 主机准备域名和 Docker Compose，按 [Server 部署指南](https://github.com/ZHanry/home-tunnel-server/blob/main/docs/SELF_HOSTING.md)安装 8.0.0。向导生成配置，预检检查 DNS、端口和目录。
2. 登录 Web 修改管理员临时密码，启用 TOTP，安全保存恢复码，按需创建普通用户。
3. 在家庭电脑/NAS 安装同版客户端，输入服务器 HTTPS 地址。使用账号和 MFA，或从 Web/Android 生成的一次性接入码登记。
4. 先确认客户端主机能访问应用的本地地址，再创建连接。HTTP 填写子域、本地主机和端口；原始协议需要管理员的端口池与授权。
5. 等待在线，从手机移动网络打开公网地址。Android 管理隧道，家中客户端须保持运行。
6. 在 [Android](https://github.com/ZHanry/home-tunnel-android/releases/tag/v8.0.0) 保存多个服务器账号，使用标签、收藏和批量操作。

示例：[Home Assistant / Immich / Jellyfin](SCENARIOS.md)。失败时先运行客户端
`doctor`，根据 DNS、HTTPS、FRPS、授权、本地目标的分层结果排查。诊断包不会自动上传。

## 再尝试受支持的远程桌面

远程桌面使用独立身份和本机授权，登记隧道设备不会自动授予远控权限。
先阅读 [8.0 功能与限制](RELEASE_NOTES.md)，确认所用环境在当前实现范围内。

1. 使用 8.0.0 服务端和 Windows x64 桌面包，保持被控端处于已登录、未锁屏的图形桌面。在客户端远控入口注册被控端，并按界面检查本机能力。
2. 在浏览器登录同一账号，进入远控入口，注册控制端并发起配对。在两端核对配对码，由被控端用户明确批准。
3. 发起会话并在本机确认请求的权限。等待直连和视频就绪后再输入；只能向当前获得控制权的窗口发送键鼠或文本。
4. 收发文件需单独授权，并由用户选择文件与接收位置；检查进度与最终完整性结果。目录递归传输不在当前范围内。
5. 结束会话时关闭观看窗口或使用停止控制。被控端本机可停止远控；配对授权可撤销。

服务器只处理身份、授权、信令与 STUN。远控视频、输入和文件仅通过两端 UDP
直连传输；无法建立直连时会报错，不通过 TURN、FRP、HTTP 或 WSS 转发载荷。
当前同机互通结果不能保证每种 NAT、企业网络或移动网络都可连接。

Linux x64 X11 仅提供观看、键盘和鼠标，已验证范围是隔离 Xvfb 环境；实体桌面
及锁屏恢复待验收。Android 真机解码与输入尚未验收。macOS/Wayland 被控、
桌面原生观看窗口、音频、麦克风回传、虚拟麦克风和 AV1/HEVC 尚未交付。
Windows 文本剪贴板的系统互通、多窗口并发及长期在线仍未完成验收。

## 备份与升级

上线后配置 [异机备份与恢复演练](https://github.com/ZHanry/home-tunnel-server/blob/main/docs/disaster-recovery.md)
和 [监控](https://github.com/ZHanry/home-tunnel-server/blob/main/docs/MONITORING.md)。
从 7.0 升级前先备份，结束远控会话，并阅读组件 [升级说明](https://github.com/ZHanry/home-tunnel-server/blob/main/docs/UPGRADING.md)。
旧服务端不提供 8.0 远控能力；各平台完整升级与恢复验收的状态见 [验收表](8.0/ACCEPTANCE.md)。
不要把 NAS 管理口或无认证服务直接暴露出去，TCP/UDP 由目标应用负责认证和加密。

## English

Deploy the 8.0.0 server, change the bootstrap password and enable MFA. Enroll a
home host using a one-time code or account credentials, create a local service
and verify its address from another network. Keep the Agent running; Android
manages the tunnels. Configure backups, restore drills and monitoring. Use
`doctor` to identify a failing layer.

For remote desktop, use an unlocked Windows x64 host and a browser signed into
the same account. Register both endpoints, compare pairing codes and approve
access locally. Start a session with explicit permissions; video, input and files
require a direct UDP path and have no relay fallback. File sharing requires
separate permission and user-selected files/destinations. Stop control from the
viewer or the host when finished.

Linux x64 X11 is limited to viewing, keyboard and pointer; its current evidence
comes from isolated Xvfb tests. Android device decoding/input, cross-network
traversal and complete platform acceptance remain unverified. macOS/Wayland
hosting, native desktop viewers, audio, virtual microphones and AV1/HEVC are not
delivered. Read the [release notes](RELEASE_NOTES.md) before enabling remote desktop.
