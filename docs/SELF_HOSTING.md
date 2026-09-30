# 部署 / Deployment

公网 Linux 主机上有两件服务：控制面，以及 FRP 0.70.1。
远控的画面和输入不经过 FRP。家里的 HTTP、TCP 和 UDP 服务才走 FRP。
可选的 UDP TURN 中继（coturn，`deploy/compose.turn.yaml`）只为浏览器控制端转发加密后的远控 UDP，读不到内容。

当前要部署的包是 **10.0.0**。操作步骤以服务端仓库为准：

[自托管指南](https://github.com/ZHanry/home-tunnel-server/blob/main/docs/SELF_HOSTING.md)

部署包和摘要在 [下载](DOWNLOADS.md)。装完后改掉初始管理员密码，打开 MFA，再按 [快速开始](GETTING_STARTED.md) 登记家庭 Agent。

10.0.0 的备份恢复和长时间运行尚未验证，见 [发布说明](RELEASE_NOTES.md)。用 Release 的 `compose.release.yaml` 固定镜像摘要，不要用开发分支的源码树当生产安装介质。

备份、监控和账号安全仍使用服务端文档：

- [备份与恢复](https://github.com/ZHanry/home-tunnel-server/blob/main/docs/disaster-recovery.md)
- [监控](https://github.com/ZHanry/home-tunnel-server/blob/main/docs/MONITORING.md)
- [账号安全](https://github.com/ZHanry/home-tunnel-server/blob/main/docs/ACCOUNT_SECURITY.md)
- [FRP 0.70.1 兼容说明](https://github.com/ZHanry/home-tunnel-server/blob/main/docs/FRP_0.70.1_COMPATIBILITY.md)

## English

Deploy 10.0.0 from the server guide. The host runs the control plane and FRP, plus an optional UDP TURN relay (`deploy/compose.turn.yaml`) for browser viewers. Remote-control payloads are never carried by FRP, and the relay cannot read them. Backup restore and soaks were not run and remain unverified.
