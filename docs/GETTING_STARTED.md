# 开始使用 HomeDesk 11

先从 [下载与校验](DOWNLOADS.md) 选择候选组件，按 [自建部署](SELF_HOSTING.md) 配置 Server 11.0.0-rc.2。候选尚未完成跨网和真机验收；最后稳定下载仍保留原 10.x 组合。

## 远程控制

Windows 与 Android 都使用 Client 同源 Rust/Flutter 核心。填写自己的 hbbs 地址、公钥和家庭 CIDR，配置 HTTPS 管理台；登录与登记本机后，同账号目录显示有效设备。目录状态只证明近期登记，不能证明屏幕会话已连通。

选择设备或输入远控 ID，获得被控端密码或批准后建立认证加密的 P2P。Web 管理台的原生按钮通过 `homedesk://ID` 打开 HomeDesk，不传递账号令牌。任何直接连接失败都会终止，没有 hbbr/TURN/FRP/HTTP/WSS/VPN 或供应商回退。

Android 共享屏幕需同意系统 MediaProjection 提示；Android 14/15 要从可见应用重新授权。控制手机的具体系统权限与能力需要真机验收，不能把模拟器启动检查当作完整远控通过。

## 内网穿透

NAS 或家庭电脑运行独立 `home-tunnel-client` 与锁定的 Agent。先确认目标服务在本机可访问，登记设备，再通过 Web 或暖居“家庭服务”创建 HTTP/HTTPS 或管理员允许的 TCP/UDP 连接。公网端口由服务端端口池管理，HTTP ACL/登录保护与 TCP/UDP 目标应用认证按原规则配置。

用外部网络验证访问地址、诊断、流量限制与撤权。GUI 中的 Agent 跟随窗口；需要长期在线时使用 CLI 合集的各平台后台说明，先查看 `home-tunnel-client --help` 与 `home-tunnel-client status`。远控开关或打洞失败不影响独立隧道。
