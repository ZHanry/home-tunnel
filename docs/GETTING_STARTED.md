# 从一个家庭服务开始 / Quick start

1. 在公网 Linux 主机准备域名和 Docker Compose，按 [Server 部署指南](https://github.com/ZHanry/home-tunnel-server/blob/main/docs/SELF_HOSTING.md)安装 7.0.0。向导生成配置，预检检查 DNS、端口和目录。
2. 登录 Web 修改管理员临时密码，启用 TOTP，安全保存恢复码，按需创建普通用户。
3. 在家庭电脑/NAS 安装同版客户端，输入服务器 HTTPS 地址。使用账号+MFA 或从 Web/Android 生成的一次性接入码登记。
4. 先确认客户端主机能访问应用的本地地址，再创建连接。HTTP 填写子域、本地主机和端口；原始协议需要管理员的端口池与授权。
5. 等待在线，从手机移动网络打开公网地址。Android 只远程管理，家中客户端须保持运行。
6. 在 [Android](https://github.com/ZHanry/home-tunnel-android) 保存多个服务器账号，使用标签、收藏和批量操作。

示例：[Home Assistant / Immich / Jellyfin](SCENARIOS.md)。失败时先运行客户端
`doctor`，根据 DNS、HTTPS、FRPS、授权、本地目标的分层结果排查。诊断包不会自动上传。

上线后配置 [异机备份与恢复演练](https://github.com/ZHanry/home-tunnel-server/blob/main/docs/disaster-recovery.md)
和 [监控](https://github.com/ZHanry/home-tunnel-server/blob/main/docs/MONITORING.md)。
不要把 NAS 管理口或无认证服务直接暴露出去，TCP/UDP 由目标应用负责认证/加密。

English: deploy the 7.0.0 server, change the bootstrap password and enable MFA.
Enroll a home host using a one-time code or account credentials, create a local
service and verify its address from another network. Keep the Agent running;
Android only manages it. Configure backup, restore drills and monitoring after
your first working connection. Use `doctor` to identify a failing layer.
