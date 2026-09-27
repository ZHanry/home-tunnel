# 快速开始 / Quick start

安装现在能用的 **9.0.0**。10.0.0 验收尚未完成，不要把开发分支当成稳定包。两条路径分开做。

## 远控：授权后的 UDP 直连

登记隧道设备不会自动授予远控权限。先看 [9.0 范围](RELEASE_NOTES.md)。

1. 部署 9.0.0 服务端和 Windows x64 桌面包。被控端保持已登录、未锁屏的图形桌面，再从客户端注册远控设备。
2. 双方登录同一台服务器。用设备码找到电脑。任选一种：本机批准、固定密码或一次性密码。这三者和一次性接入码不是一回事，固定密码也不是账号密码。不用时关掉。
3. 在独立远控窗口里等 UDP 直连和画面就绪后再输入。被控端可以用本机快捷键断开。配对和授权可以撤销。
4. 连不上就是失败。服务器只做身份、授权、信令和 STUN，不转发画面或输入，也没有 TURN / FRP / HTTP / WSS 回退。

Linux x64 X11 只提供观看、键盘和鼠标，证据来自隔离环境。Android 的 x86_64 模拟器不能证明已发布 arm64 APK 或真机。锁屏、登录前、UAC 安全桌面和音频都还没有交付。10.0.0 计划补这些能力，验收尚未完成。

## 内网穿透：用 FRP 发布家里的服务

1. 按 [部署说明](SELF_HOSTING.md) 在公网 Linux 主机安装 9.0.0。向导生成配置，预检检查 DNS、端口和目录。
2. 登录 Web，修改管理员临时密码，启用 TOTP，保存恢复码。
3. 在家庭电脑或 NAS 安装同版客户端。用账号和 MFA，或用一次性接入码登记。
4. 先在这台机器上打开目标服务，再创建连接。HTTP 填写子域、本地主机和端口。原始 TCP/UDP 需要管理员的端口池和授权。
5. 等到在线后，从另一张网络打开公网地址。Agent 需要保持运行。Android 管理隧道，不在手机上转发流量。

示例见 [家庭服务场景](SCENARIOS.md)。失败时运行客户端 `doctor`，按 DNS、HTTPS、FRPS、授权、本地目标分层看。诊断包不会自动上传。细节在 [排查](TROUBLESHOOTING.md)。

TCP/UDP 不附带 HTTP 白名单或 Basic Auth。不要把 NAS 管理口或没有认证的服务直接暴露出去。

## 备份

上线后配置 [异机备份](https://github.com/ZHanry/home-tunnel-server/blob/main/docs/disaster-recovery.md) 和 [监控](https://github.com/ZHanry/home-tunnel-server/blob/main/docs/MONITORING.md)。从 9.0 再往上的升级见 [升级](UPGRADING.md)。10.0 迁移验收尚未完成。

## English

Install 9.0.0. 10.0.0 acceptance is pending.

For remote control, use an unlocked Windows x64 host and the same server account on both sides. Find it with the device code, then use local approval, a fixed password, or a one-time password. An enrollment code is not a device code or a remote password. Wait for direct UDP before typing. There is no relay fallback.

For FRP, deploy the server, enroll the home Agent, confirm the local target, then open the public address from another network. Use `doctor` when a layer fails. Raw TCP/UDP relies on the target application's own authentication.

Back up before any later upgrade. The 9-to-10 migration has not been accepted.
