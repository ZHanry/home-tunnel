# Home Tunnel 9.0.0 快速开始 / Quick start

## 先连接一个家庭服务

1. 在公网 Linux 主机准备域名和 Docker Compose，按 [Server 部署指南](https://github.com/ZHanry/home-tunnel-server/blob/main/docs/SELF_HOSTING.md)安装 9.0.0。向导生成配置，预检检查 DNS、端口和目录。
2. 登录 Web 修改管理员临时密码，启用 TOTP，安全保存恢复码，按需创建普通用户。
3. 在家庭电脑/NAS 安装同版客户端，输入服务器 HTTPS 地址。使用账号和 MFA，或从 Web/Android 生成的一次性接入码登记。
4. 先确认客户端主机能访问应用的本地地址，再创建连接。HTTP 填写子域、本地主机和端口；原始协议需要管理员的端口池与授权。
5. 等待在线，从手机移动网络打开公网地址。Android 管理隧道，家中客户端须保持运行。
6. 在 [Android](https://github.com/ZHanry/home-tunnel-android/releases/tag/v9.0.0) 保存多个服务器账号，使用标签、收藏和批量操作。

示例：[Home Assistant / Immich / Jellyfin](SCENARIOS.md)。失败时先运行客户端
`doctor`，根据 DNS、HTTPS、FRPS、授权、本地目标的分层结果排查。诊断包不会自动上传。

## 再尝试受支持的远程桌面

远程桌面使用独立身份和授权，登记隧道设备不会自动授予远控权限。
先阅读 [9.0 功能与限制](RELEASE_NOTES.md)，确认所用环境在当前实现范围内。

1. 使用 9.0.0 服务端和 Windows x64 桌面包，保持被控端处于已登录、未锁屏的图形桌面，在客户端远控入口注册设备。
2. 双方登录同一服务器。任选一种方式：由被控端批准临时请求；由被控端预先设置固定密码；或由被控端生成一次性临时密码。固定密码不是账号密码，请单独保护并在不再需要时停用。
3. 在独立远控窗口等待 UDP 直连和视频就绪后再输入。被控端可以用本机快捷键强制断开，配对与授权可以撤销。
4. 文件传输使用独立权限和用户选择的文件与接收位置；目录递归不在当前范围。剪贴板实际跨端互通尚未验收。

服务器只处理身份、授权、信令与 STUN。远控视频、输入和文件仅通过两端 UDP
直连传输；无法建立直连时会报错，不通过 TURN、FRP、HTTP 或 WSS 转发载荷。
当前同机互通结果不能保证每种 NAT、企业网络或移动网络都可连接。

Linux x64 X11 仅提供观看、键盘和鼠标，已验证范围是隔离 Xvfb 环境；实体桌面
及锁屏恢复待验收。Android 的 x86_64 模拟器测试不能证明 arm64 APK 或真机运行。
Windows 锁屏、登录前和 UAC 安全桌面控制尚未完成。macOS/Wayland 被控、
音频、麦克风回传、虚拟麦克风和 AV1/HEVC 尚未交付。

## 备份与升级

上线后配置 [异机备份与恢复演练](https://github.com/ZHanry/home-tunnel-server/blob/main/docs/disaster-recovery.md)
和 [监控](https://github.com/ZHanry/home-tunnel-server/blob/main/docs/MONITORING.md)。
从 7.0 升级前先备份，结束远控会话，并阅读组件 [升级说明](https://github.com/ZHanry/home-tunnel-server/blob/main/docs/UPGRADING.md)。
旧服务端不提供 9.0 的三种远控授权方式；[8.0 验收表](8.0/ACCEPTANCE.md)仅是历史记录，本版结果以组件 Release 为准。
不要把 NAS 管理口或无认证服务直接暴露出去，TCP/UDP 由目标应用负责认证和加密。

## English

Deploy the 9.0.0 server, change the bootstrap password and enable MFA. Enroll a
home host using a one-time code or account credentials, create a local service
and verify its address from another network. Keep the Agent running; Android
manages the tunnels. Configure backups, restore drills and monitoring. Use
`doctor` to identify a failing layer.

For remote desktop, use an unlocked Windows x64 host. Both parties sign in to
the same server. The host can approve a request, enable a fixed password, or
generate a one-use temporary password. Video, input and files require a direct
UDP path and have no relay fallback. The host can force a disconnect locally;
revoke credentials and grants when they are no longer needed.

Linux x64 X11 is limited to viewing, keyboard and pointer; its current evidence
comes from isolated Xvfb tests. Android x86_64 emulator checks do not establish
arm64 APK or physical-device runtime. Windows secure-desktop control, audio,
macOS/Wayland hosting and AV1/HEVC are not delivered. Read the
[release notes](RELEASE_NOTES.md) before enabling remote desktop.
