# 快速开始 / Quick start

安装稳定版 **10.0.0**。部分项目尚未验证，清单见 [发布说明](RELEASE_NOTES.md)。两条路径分开做。

## 远控：授权后的 UDP 直连

登记隧道设备不会自动授予远控权限。先看 [10.0 范围](RELEASE_NOTES.md)。

1. 部署 10.0.0 服务端和 Windows x64 桌面包。被控端登录后即开启被控，保持已登录、未锁屏的图形桌面。
2. 双方登录同一台服务器。用分组显示的 9 位设备 ID 找到电脑。任选一种：右下角弹窗批准、固定密码（跳过审批）或一次性临时密码。这三者和一次性接入码不是一回事，固定密码也不是账号密码。不用时关掉。
3. 等连接和画面就绪后再输入。被控端会显示"正在被远程控制 · 断开"条，可以随时断开。配对和授权可以撤销。
4. 载荷走端到端加密的 UDP，优先直连。直连失败时，浏览器控制端可以经服务器可选的 UDP TURN 中继连接 10.0.0 被控端，中继读不到内容；Android 控制端只走直连。没有 TCP / FRP / HTTP / WSS 回退。

接受连接后，本次放行画面、键鼠、剪贴板、文件和系统声音，麦克风不会自动放行。锁屏、登录前和 UAC 安全桌面控制不可用。Android 控制 Windows 和实体 arm64 手机尚未验证。

## 内网穿透：用 FRP 发布家里的服务

1. 按 [部署说明](SELF_HOSTING.md) 在公网 Linux 主机安装 10.0.0。向导生成配置，预检检查 DNS、端口和目录。
2. 登录 Web，修改管理员临时密码，启用 TOTP，保存恢复码。
3. 在家庭电脑或 NAS 安装同版客户端。用账号和 MFA，或用一次性接入码登记。
4. 先在这台机器上打开目标服务，再创建连接。HTTP 填写子域、本地主机和端口。原始 TCP/UDP 需要管理员的端口池和授权。
5. 等到在线后，从另一张网络打开公网地址。Agent 需要保持运行。Android 管理隧道，不在手机上转发流量。

示例见 [家庭服务场景](SCENARIOS.md)。失败时运行客户端 `doctor`，按 DNS、HTTPS、FRPS、授权、本地目标分层看。诊断包不会自动上传。细节在 [排查](TROUBLESHOOTING.md)。

TCP/UDP 不附带 HTTP 白名单或 Basic Auth。不要把 NAS 管理口或没有认证的服务直接暴露出去。

## 备份

上线后配置 [异机备份](https://github.com/ZHanry/home-tunnel-server/blob/main/docs/disaster-recovery.md) 和 [监控](https://github.com/ZHanry/home-tunnel-server/blob/main/docs/MONITORING.md)。从 9.0 升级见 [升级](UPGRADING.md)；9→10 安装器升级和备份恢复没有验证，先确认备份能恢复。

## English

Install 10.0.0. Some acceptance gates were not run; the release notes list what remains unverified.

For remote control, use an unlocked Windows x64 host and the same server account on both sides. Find it by its grouped 9-digit device ID, then use the approval popup, a fixed password, or a one-time password. An enrollment code is not a device code or a remote password. Payloads use encrypted UDP, direct first; browser viewers can fall back to the optional UDP TURN relay, Android is direct-only, and there is no TCP fallback.

For FRP, deploy the server, enroll the home Agent, confirm the local target, then open the public address from another network. Use `doctor` when a layer fails. Raw TCP/UDP relies on the target application's own authentication.

Back up before upgrading. The 9-to-10 installer upgrade and restore were not run and remain unverified.
